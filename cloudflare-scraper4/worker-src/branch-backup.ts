// Branch backup files for every runtime. Reads need no token on public repos;
// push writes through the Contents API and needs a token with contents:write.
// The dashboard CSP forbids the browser from calling api.github.com, so the
// server lists, downloads and uploads backup files same-origin. Both runtimes
// inject their own safeFetch; the logic stays single-source.
import { DEFAULT_REPO, classifyGitHubDenial, normalizeRepo, pickGithubToken, type BranchFetcher } from './deployer-branches.js';
import { base64ToUtf8, byteLength } from './utils.js';

export const DEFAULT_BACKUP_REPO = DEFAULT_REPO;
export const DEFAULT_BACKUP_PATH = 'backups';
export const BRANCH_FILE_MAX_BYTES = 5 * 1024 * 1024;

export function normalizeBranch(raw: unknown): string | null {
  const branch = String(raw || '').trim();
  if (!branch || branch.length > 200 || branch.includes('..') || /[\s?]/.test(branch)) return null;
  return branch;
}

export function normalizeBackupName(raw: unknown): string | null {
  const name = String(raw || '').trim();
  if (!name || name.length > 100 || name.includes('/') || name.includes('\\') || name.includes('..') || /[\s?]/.test(name)) return null;
  if (!name.toLowerCase().endsWith('.json')) return null;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(name)) return null;
  return name;
}

export function normalizeBackupPath(raw: unknown): string | null {
  const path = String(raw || '').trim().replace(/^\/+|\/+$/g, '');
  if (!path || path.length > 200 || path.includes('..') || /[\s?]/.test(path)) return null;
  return path;
}

export interface BranchBackupFile {
  name: string;
  path: string;
  size: number;
  sha: string;
}

export interface BranchBackupFolder {
  name: string;
  path: string;
}

export interface BranchFileList {
  ok: true;
  repo: string;
  branch: string;
  path: string;
  files: BranchBackupFile[];
  folders: BranchBackupFolder[];
}

export interface BranchFileFailure {
  ok: false;
  error: string;
  stage: 'params' | 'list' | 'fetch' | 'push';
}

/** PUT proving the write path: same headers as reads, plus a JSON body. */
export type BranchPutter = (url: string, body: Record<string, unknown>) => Promise<Response>;

function failure(stage: BranchFileFailure['stage'], error: string): BranchFileFailure {
  return { ok: false, stage, error };
}

function apiUrl(repo: string, path: string, branch: string): string {
  const encoded = path.split('/').map(part => encodeURIComponent(part)).join('/');
  return `https://api.github.com/repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`;
}

/** List the JSON backup files inside a folder on a branch, newest name first. */
export async function listBranchBackupFiles(fetcher: BranchFetcher, repoRaw: unknown, branchRaw: unknown, pathRaw: unknown): Promise<BranchFileList | BranchFileFailure> {
  const repo = normalizeRepo(repoRaw);
  if (!repo) return failure('params', 'Repo must look like owner/name.');
  const branch = normalizeBranch(branchRaw);
  if (!branch) return failure('params', 'Pick a branch first.');
  const path = normalizeBackupPath(pathRaw ?? DEFAULT_BACKUP_PATH);
  if (!path) return failure('params', 'Backup folder is not valid.');
  let response: Response;
  try {
    response = await fetcher(apiUrl(repo, path, branch));
  } catch {
    return failure('list', 'GitHub is unreachable from this server.');
  }
  if (response.status === 404) return { ok: true, repo, branch, path, files: [], folders: [] };
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    const denial = await classifyGitHubDenial(response);
    return failure('list', denial.detail);
  }
  if (!response.ok) return failure('list', `GitHub listing failed (HTTP ${response.status}).`);
  let entries: unknown;
  try {
    entries = await response.json();
  } catch {
    return failure('list', 'GitHub returned an unreadable listing.');
  }
  if (!Array.isArray(entries)) return { ok: true, repo, branch, path, files: [], folders: [] };
  const files = (entries as Record<string, unknown>[])
    .filter(entry => entry && entry.type === 'file' && typeof entry.name === 'string' && (entry.name as string).toLowerCase().endsWith('.json'))
    .map(entry => ({ name: String(entry.name), path: String(entry.path || `${path}/${entry.name}`), size: Number(entry.size) || 0, sha: typeof entry.sha === 'string' ? entry.sha : '' }))
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const folders = (entries as Record<string, unknown>[])
    .filter(entry => entry && entry.type === 'dir' && typeof entry.name === 'string' && (entry.name as string).trim() !== '' && !(entry.name as string).includes('/') && !(entry.name as string).includes('..'))
    .map(entry => ({ name: String(entry.name), path: String(entry.path || `${path}/${entry.name}`) }))
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return { ok: true, repo, branch, path, files, folders };
}

export interface BranchBackupDownload {
  ok: true;
  name: string;
  size: number;
  bundle: unknown;
}

/** Download one backup file from a branch and parse it as JSON. */
/** Download one file from a branch through the Contents API and decode it. */
async function readBranchText(fetcher: BranchFetcher, repo: string, branch: string, fullPath: string, maxBytes: number, notFound: string, tooBig: string): Promise<{ ok: true; text: string; name: string; size: number } | BranchFileFailure> {
  let response: Response;
  try {
    response = await fetcher(apiUrl(repo, fullPath, branch));
  } catch {
    return failure('fetch', 'GitHub is unreachable from this server.');
  }
  if (response.status === 404) return failure('fetch', notFound);
  if (response.status === 401 || response.status === 403 || response.status === 429) {
    const denial = await classifyGitHubDenial(response);
    return failure('fetch', denial.detail);
  }
  if (!response.ok) return failure('fetch', `GitHub download failed (HTTP ${response.status}).`);
  let entry: Record<string, unknown>;
  try {
    entry = (await response.json()) as Record<string, unknown>;
  } catch {
    return failure('fetch', 'GitHub returned an unreadable file.');
  }
  const size = Number(entry?.size) || 0;
  if (size > maxBytes) return failure('fetch', tooBig);
  const content = typeof entry?.content === 'string' ? entry.content : '';
  if (!content) return failure('fetch', 'GitHub returned an empty file.');
  let text: string;
  try {
    text = base64ToUtf8(content.replace(/\s+/g, ''));
  } catch {
    return failure('fetch', 'GitHub returned a file with broken encoding.');
  }
  if (text.length > maxBytes) return failure('fetch', tooBig);
  const name = typeof entry?.name === 'string' && entry.name ? entry.name : fullPath.split('/').pop() || 'branch-backup.json';
  return { ok: true, text, name, size: text.length };
}

export async function fetchBranchBackupFile(fetcher: BranchFetcher, repoRaw: unknown, branchRaw: unknown, pathRaw: unknown): Promise<BranchBackupDownload | BranchFileFailure> {
  const repo = normalizeRepo(repoRaw);
  if (!repo) return failure('params', 'Repo must look like owner/name.');
  const branch = normalizeBranch(branchRaw);
  if (!branch) return failure('params', 'Pick a branch first.');
  const path = normalizeBackupPath(pathRaw);
  if (!path) return failure('params', 'Pick a backup file first.');
  if (!path.toLowerCase().endsWith('.json')) return failure('params', 'Only .json backup files can be restored.');
  const read = await readBranchText(fetcher, repo, branch, path, BRANCH_FILE_MAX_BYTES, 'That file is no longer on the branch; refresh the file list.', 'That backup file is larger than 5 MB; download and restore it by hand.');
  if (!read.ok) return read;
  try {
    const bundle: unknown = JSON.parse(read.text);
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return failure('fetch', 'That file is not a settings bundle.');
    return { ok: true, name: read.name, size: read.size, bundle };
  } catch {
    return failure('fetch', 'That file is not valid JSON.');
  }
}

/**
 * Restore a split backup folder: read manifest.json, download every listed
 * part, and reassemble the same bundle object a legacy single-file backup
 * carries, so the dashboard restore path stays untouched.
 */
export async function fetchBranchBackupSplit(fetcher: BranchFetcher, repoRaw: unknown, branchRaw: unknown, folderRaw: unknown): Promise<BranchBackupDownload | BranchFileFailure> {
  const repo = normalizeRepo(repoRaw);
  if (!repo) return failure('params', 'Repo must look like owner/name.');
  const branch = normalizeBranch(branchRaw);
  if (!branch) return failure('params', 'Pick a branch first.');
  const folder = normalizeBackupPath(folderRaw);
  if (!folder) return failure('params', 'Pick a backup folder first.');
  const manifestRead = await readBranchText(fetcher, repo, branch, `${folder}/${SPLIT_MANIFEST_NAME}`, 1024 * 1024, 'That folder has no manifest.json; it is not a split backup.', 'That manifest is larger than 1 MB; download and restore it by hand.');
  if (!manifestRead.ok) return manifestRead;
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(manifestRead.text) as Record<string, unknown>;
  } catch {
    return failure('fetch', 'That manifest is not valid JSON.');
  }
  if (!manifest || typeof manifest !== 'object' || manifest.kind !== 'split-backup' || manifest.format !== SPLIT_FORMAT || !Array.isArray(manifest.parts) || !manifest.parts.length) {
    return failure('fetch', 'That manifest is not a scraper4 split backup.');
  }
  const files: Record<string, { size: number; b64: string }> = {};
  let total = 0;
  for (const rawName of manifest.parts as unknown[]) {
    const partName = normalizePartName(rawName);
    if (!partName) return failure('fetch', `That manifest lists an unsafe part (${String(rawName).slice(0, 60)}).`);
    const part = await readBranchText(fetcher, repo, branch, `${folder}/${partName}`, BRANCH_FILE_MAX_BYTES, `Part ${partName} is missing from the split backup.`, 'That backup file is larger than 5 MB; download and restore it by hand.');
    if (!part.ok) return part;
    try {
      JSON.parse(part.text);
    } catch {
      return failure('fetch', `Part ${partName} is not valid JSON.`);
    }
    total += byteLength(part.text);
    if (total > BRANCH_FILE_MAX_BYTES) return failure('fetch', 'That backup file is larger than 5 MB; download and restore it by hand.');
    files[partName] = { size: byteLength(part.text), b64: utf8ToBase64(part.text) };
  }
  const bundle = {
    app: 'scraper',
    version: typeof manifest.version === 'string' ? manifest.version : 'cloudflare-1.0',
    created_at: typeof manifest.created_at === 'number' ? manifest.created_at : Math.floor(Date.now() / 1000),
    created_at_h: typeof manifest.created_at_h === 'string' ? manifest.created_at_h : new Date().toISOString(),
    host: typeof manifest.host === 'string' ? manifest.host : 'unknown',
    kind: 'settings-export', format: 'scraper4-php-compatible',
    files, total_files: Object.keys(files).length, total_bytes: total,
  };
  return { ok: true, name: folder, size: total, bundle };
}

function utf8ToBase64(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function putUrl(repo: string, fullPath: string): string {
  const encoded = fullPath.split('/').map(part => encodeURIComponent(part)).join('/');
  return `https://api.github.com/repos/${repo}/contents/${encoded}`;
}

export interface BranchPushResult {
  ok: true;
  repo: string;
  branch: string;
  path: string;
  sha: string;
  commit: string;
  updated: boolean;
  parts: number;
  database: string;
}

/**
 * Push a backup bundle onto a branch: pre-read for the current sha (create
 * vs update), then PUT through the Contents API. The caller must guarantee a
 * token with contents:write; without one GitHub answers 401/404 and the
 * honest denial below is what the user sees.
 */
export type PushStage = 'reading' | 'uploading';
export type PushStageCallback = (stage: PushStage, info?: { bytes?: number }) => void;

/** Split-backup layout: one folder per backup holding manifest.json, one
 *  .json file per bundle section, and (Node+SQLite runtimes only) the raw
 *  database.sqlite right next to them. Every part stays readable on GitHub
 *  and downloadable on its own, which is what makes branch backups usable
 *  for testing and debugging; restore reassembles the same bundle object
 *  the legacy single-file backups carry, so old backups keep restoring. */
export const SPLIT_MANIFEST_NAME = 'manifest.json';
export const SPLIT_FORMAT = 'scraper4-split-1';
export const SPLIT_DB_NAME = 'database.sqlite';
export const SPLIT_DB_MAX_BYTES = 48 * 1024 * 1024;

export type SplitDatabaseInput = { b64: string } | { skipped: string };

function splitFolderFor(name: string): string {
  return name.replace(/\.json$/i, '');
}

function normalizePartName(raw: unknown): string | null {
  const name = String(raw || '').trim();
  if (!name || name.length > 100 || name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  if (!name.toLowerCase().endsWith('.json')) return null;
  if (name === SPLIT_MANIFEST_NAME) return null;
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(name)) return null;
  return name;
}

function sanitizeSkipReason(raw: unknown): string {
  const clean = String(raw || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
  return clean || 'unavailable';
}

interface PutOneSuccess { ok: true; sha: string; commit: string; updated: boolean; }

/** Pre-read one file for its sha (create vs update), then PUT it. */
async function putBranchFile(getter: BranchFetcher, putter: BranchPutter, repo: string, branch: string, fullPath: string, message: string, b64: string, onStage?: PushStageCallback, bytes?: number): Promise<PutOneSuccess | BranchFileFailure> {
  let current: Response;
  try {
    current = await getter(apiUrl(repo, fullPath, branch));
  } catch {
    return failure('push', 'GitHub is unreachable from this server.');
  }
  if (current.status === 401 || current.status === 403 || current.status === 429) {
    return failure('push', (await classifyGitHubDenial(current)).detail);
  }
  let sha: string | null = null;
  if (current.status !== 404) {
    if (!current.ok) return failure('push', `GitHub lookup failed (HTTP ${current.status}).`);
    let entry: Record<string, unknown>;
    try {
      entry = (await current.json()) as Record<string, unknown>;
    } catch {
      return failure('push', 'GitHub returned an unreadable file.');
    }
    if (typeof entry?.sha !== 'string' || !entry.sha) return failure('push', 'GitHub did not return the file version; refresh and retry.');
    sha = entry.sha;
  }
  const payload: Record<string, unknown> = { message, content: b64, branch };
  if (sha) payload.sha = sha;
  let pushed: Response;
  try {
    onStage?.('uploading', { bytes: bytes ?? 0 });
    pushed = await putter(putUrl(repo, fullPath), payload);
  } catch {
    return failure('push', 'GitHub is unreachable from this server.');
  }
  if (pushed.status === 401 || pushed.status === 403 || pushed.status === 429) {
    return failure('push', (await classifyGitHubDenial(pushed)).detail);
  }
  if (pushed.status === 422) {
    let messageText = '';
    try {
      const body = (await pushed.json()) as { message?: unknown };
      if (body && typeof body.message === 'string') messageText = body.message.trim();
    } catch { /* non-JSON refusal */ }
    return failure('push', messageText ? `GitHub refused the write: ${messageText.slice(0, 180)}` : 'GitHub refused the write (HTTP 422).');
  }
  if (!pushed.ok) return failure('push', `GitHub push failed (HTTP ${pushed.status}).`);
  let fileSha = '', commitSha = '';
  try {
    const done = (await pushed.json()) as { content?: { sha?: unknown }; commit?: { sha?: unknown } };
    if (typeof done?.content?.sha === 'string') fileSha = done.content.sha;
    if (typeof done?.commit?.sha === 'string') commitSha = done.commit.sha;
  } catch { /* metadata unreadable; the write itself succeeded */ }
  return { ok: true, sha: fileSha, commit: commitSha, updated: pushed.status === 200 };
}

export interface SplitPushInput {
  repoRaw: unknown;
  branchRaw: unknown;
  folderRaw: unknown;
  nameRaw: unknown;
  bundle: unknown;
  database: SplitDatabaseInput;
}

/**
 * Push a backup as a split folder: one readable .json per bundle section,
 * the raw database.sqlite next to them when the runtime has one, and
 * manifest.json last, so a folder only claims to be a backup once every
 * part is up. The caller must guarantee a token with contents:write.
 */
export async function pushBranchBackupSplit(getter: BranchFetcher, putter: BranchPutter, input: SplitPushInput, onStage?: PushStageCallback): Promise<BranchPushResult | BranchFileFailure> {
  const repo = normalizeRepo(input.repoRaw);
  if (!repo) return failure('params', 'Repo must look like owner/name.');
  const branch = normalizeBranch(input.branchRaw);
  if (!branch) return failure('params', 'Pick a branch first.');
  const folder = normalizeBackupPath(input.folderRaw ?? DEFAULT_BACKUP_PATH);
  if (!folder) return failure('params', 'Backup folder is not valid.');
  const name = normalizeBackupName(input.nameRaw);
  if (!name) return failure('params', 'Backup file name must be a safe .json name.');
  const bundle = input.bundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return failure('params', 'The backup bundle is empty or not an object.');
  const rawFiles = (bundle as { files?: unknown }).files;
  if (!rawFiles || typeof rawFiles !== 'object' || Array.isArray(rawFiles)) return failure('params', 'The backup bundle has no files to split.');
  const parts: { name: string; text: string }[] = [];
  let total = 0;
  for (const [rawName, meta] of Object.entries(rawFiles as Record<string, unknown>)) {
    const partName = normalizePartName(rawName);
    const b64 = (meta as { b64?: unknown } | null)?.b64;
    if (!partName || typeof b64 !== 'string' || !b64) return failure('params', `Backup part ${String(rawName).slice(0, 60)} is not valid.`);
    let text: string;
    try {
      text = base64ToUtf8(b64);
    } catch {
      return failure('params', `Backup part ${partName} has broken encoding.`);
    }
    try {
      JSON.parse(text);
    } catch {
      return failure('params', `Backup part ${partName} is not valid JSON.`);
    }
    total += byteLength(text);
    if (total > BRANCH_FILE_MAX_BYTES) return failure('params', 'That backup is larger than 5 MB; push it by hand.');
    parts.push({ name: partName, text });
  }
  if (!parts.length) return failure('params', 'The backup bundle has no files to split.');
  parts.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // The database file is a debugging bonus, never a push failure: too big
  // or unavailable means the JSON parts still go up with an honest note.
  let dbB64: string | null = null;
  let dbBytes = 0;
  let database: string;
  if (input.database && typeof (input.database as { b64?: unknown }).b64 === 'string' && (input.database as { b64: string }).b64) {
    const raw = (input.database as { b64: string }).b64;
    dbBytes = Math.floor(raw.length * 3 / 4);
    if (dbBytes > SPLIT_DB_MAX_BYTES) {
      database = 'skipped:too-large';
    } else {
      dbB64 = raw;
      database = 'pushed';
    }
  } else {
    database = `skipped:${sanitizeSkipReason((input.database as { skipped?: unknown } | null)?.skipped)}`;
  }
  const src = bundle as Record<string, unknown>;
  const manifest = {
    app: 'scraper', kind: 'split-backup', format: SPLIT_FORMAT,
    version: typeof src.version === 'string' ? src.version : 'cloudflare-1.0',
    created_at: typeof src.created_at === 'number' ? src.created_at : Math.floor(Date.now() / 1000),
    created_at_h: typeof src.created_at_h === 'string' ? src.created_at_h : new Date().toISOString(),
    host: typeof src.host === 'string' ? src.host : 'unknown',
    parts: parts.map(part => part.name),
    database: dbB64 ? SPLIT_DB_NAME : null,
    total_bytes: total,
  };
  onStage?.('reading');
  const writes: { name: string; b64: string; bytes: number }[] = parts.map(part => ({ name: part.name, b64: utf8ToBase64(part.text), bytes: byteLength(part.text) }));
  if (dbB64) writes.push({ name: SPLIT_DB_NAME, b64: dbB64, bytes: dbBytes });
  const manifestText = JSON.stringify(manifest, null, 2);
  writes.push({ name: SPLIT_MANIFEST_NAME, b64: utf8ToBase64(manifestText), bytes: byteLength(manifestText) });
  const splitPath = `${folder}/${splitFolderFor(name)}`;
  let sent = 0, updated = false, commit = '', manifestSha = '';
  for (const write of writes) {
    sent += write.bytes;
    const done = await putBranchFile(getter, putter, repo, branch, `${splitPath}/${write.name}`, `scraper4 backup ${splitPath}/${write.name}`, write.b64, onStage, sent);
    if (!done.ok) return done;
    updated = updated || done.updated;
    commit = done.commit || commit;
    if (write.name === SPLIT_MANIFEST_NAME) manifestSha = done.sha;
  }
  return { ok: true, repo, branch, path: splitPath, sha: manifestSha, commit, updated, parts: parts.length, database };
}

export const SCHEDULED_PUSH_NAME = 'scheduled-backup.json';
export const SCHEDULED_PUSH_MIN_MINUTES = 5;
export const SCHEDULED_PUSH_MAX_MINUTES = 10080;
export const SCHEDULED_PUSH_STATE_KEY = 'branch_push_last';

export interface ScheduledPushDeps {
  settings: unknown;
  envToken: unknown;
  lastAt: string | null;
  now?: number;
  buildBundle: () => Promise<unknown>;
  connect: (token: string) => { getter: BranchFetcher; putter: BranchPutter };
  snapshotDatabase?: () => Promise<SplitDatabaseInput>;
  onStage?: PushStageCallback;
}

export interface ScheduledPushOutcome {
  ran: boolean;
  skipped?: 'disabled' | 'not-due' | 'no-token' | 'no-target';
  result?: BranchPushResult | BranchFileFailure;
}

/**
 * One scheduled-push decision. Pure apart from the injected IO: the bundle is
 * built only when a push really goes out, and the branch has no default (the
 * repo falls back to the default, the folder to backups).
 */
export async function runScheduledBranchPush(deps: ScheduledPushDeps): Promise<ScheduledPushOutcome> {
  const root = deps.settings && typeof deps.settings === 'object' ? (deps.settings as Record<string, unknown>).branchPush : null;
  const cfg = root && typeof root === 'object' ? (root as Record<string, unknown>) : null;
  if (!cfg || cfg.enabled !== true) return { ran: false, skipped: 'disabled' };
  const everyMin = Math.min(SCHEDULED_PUSH_MAX_MINUTES, Math.max(SCHEDULED_PUSH_MIN_MINUTES, Number(cfg.intervalMin) || 360));
  const now = typeof deps.now === 'number' ? deps.now : Date.now();
  const last = deps.lastAt ? Date.parse(deps.lastAt) : NaN;
  if (Number.isFinite(last) && now - last < everyMin * 60_000) return { ran: false, skipped: 'not-due' };
  const token = pickGithubToken(deps.envToken, deps.settings);
  if (!token) return { ran: false, skipped: 'no-token' };
  const branch = normalizeBranch(cfg.branch);
  if (!branch) return { ran: false, skipped: 'no-target' };
  const repo = normalizeRepo(cfg.repo) || DEFAULT_REPO;
  const folder = normalizeBackupPath((cfg.path ?? DEFAULT_BACKUP_PATH) as unknown) || DEFAULT_BACKUP_PATH;
  const { getter, putter } = deps.connect(token);
  const bundle = await deps.buildBundle();
  const database = deps.snapshotDatabase
    ? await deps.snapshotDatabase().catch((): SplitDatabaseInput => ({ skipped: 'unavailable' }))
    : { skipped: 'unavailable' };
  const result = await pushBranchBackupSplit(getter, putter, { repoRaw: repo, branchRaw: branch, folderRaw: folder, nameRaw: SCHEDULED_PUSH_NAME, bundle, database }, deps.onStage);
  return { ran: true, result };
}

export interface ScheduledPushTickIO {
  settings: unknown;
  envToken: unknown;
  loadLast: () => Promise<{ at?: unknown } | null>;
  saveLast: (rec: Record<string, unknown>) => Promise<void>;
  buildBundle: () => Promise<unknown>;
  connect: (token: string) => { getter: BranchFetcher; putter: BranchPutter };
  snapshotDatabase?: () => Promise<SplitDatabaseInput>;
  log?: (message: string) => void;
}

let scheduledPushRunning = false;

/**
 * Scheduler entry shared by the Worker cron, the Node in-web scheduler and
 * the standalone cron script. Never throws; records the outcome for the
 * dashboard and refuses to overlap itself (a push can outlast the 60s tick).
 */
export async function scheduledBranchPushTick(io: ScheduledPushTickIO): Promise<void> {
  if (scheduledPushRunning) return;
  scheduledPushRunning = true;
  try {
    const last = await io.loadLast().catch(() => null);
    const lastAt = last && typeof last.at === 'string' ? last.at : null;
    const outcome = await runScheduledBranchPush({
      settings: io.settings, envToken: io.envToken, lastAt,
      buildBundle: io.buildBundle, connect: io.connect, snapshotDatabase: io.snapshotDatabase,
    });
    if (!outcome.ran) {
      if (outcome.skipped === 'no-token' || outcome.skipped === 'no-target') {
        await io.saveLast({ at: new Date().toISOString(), ok: false, skipped: outcome.skipped }).catch(() => {});
      }
      return;
    }
    const r = outcome.result as BranchPushResult | BranchFileFailure;
    if (r.ok) {
      await io.saveLast({ at: new Date().toISOString(), ok: true, path: `${r.branch}/${r.path}`, sha: r.sha, updated: r.updated, parts: r.parts, database: r.database }).catch(() => {});
      io.log?.(`scheduled branch push: ${r.branch}/${r.path} ${r.updated ? 'updated' : 'created'} (${r.parts} parts, db ${r.database})`);
    } else {
      await io.saveLast({ at: new Date().toISOString(), ok: false, stage: r.stage, error: r.error }).catch(() => {});
      io.log?.(`scheduled branch push failed (${r.stage}): ${r.error}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await io.saveLast({ at: new Date().toISOString(), ok: false, error: message }).catch(() => {});
    io.log?.(`scheduled branch push crashed: ${message}`);
  } finally {
    scheduledPushRunning = false;
  }
}
