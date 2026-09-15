// Branch backup files for every runtime. Reads need no token on public repos;
// push writes through the Contents API and needs a token with contents:write.
// The dashboard CSP forbids the browser from calling api.github.com, so the
// server lists, downloads and uploads backup files same-origin. Both runtimes
// inject their own safeFetch; the logic stays single-source.
import { DEFAULT_REPO, classifyGitHubDenial, normalizeRepo, type BranchFetcher } from './deployer-branches.js';

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

export interface BranchFileList {
  ok: true;
  repo: string;
  branch: string;
  path: string;
  files: BranchBackupFile[];
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
  if (response.status === 404) return { ok: true, repo, branch, path, files: [] };
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
  if (!Array.isArray(entries)) return { ok: true, repo, branch, path, files: [] };
  const files = (entries as Record<string, unknown>[])
    .filter(entry => entry && entry.type === 'file' && typeof entry.name === 'string' && (entry.name as string).toLowerCase().endsWith('.json'))
    .map(entry => ({ name: String(entry.name), path: String(entry.path || `${path}/${entry.name}`), size: Number(entry.size) || 0, sha: typeof entry.sha === 'string' ? entry.sha : '' }))
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  return { ok: true, repo, branch, path, files };
}

export interface BranchBackupDownload {
  ok: true;
  name: string;
  size: number;
  bundle: unknown;
}

/** Download one backup file from a branch and parse it as JSON. */
export async function fetchBranchBackupFile(fetcher: BranchFetcher, repoRaw: unknown, branchRaw: unknown, pathRaw: unknown): Promise<BranchBackupDownload | BranchFileFailure> {
  const repo = normalizeRepo(repoRaw);
  if (!repo) return failure('params', 'Repo must look like owner/name.');
  const branch = normalizeBranch(branchRaw);
  if (!branch) return failure('params', 'Pick a branch first.');
  const path = normalizeBackupPath(pathRaw);
  if (!path) return failure('params', 'Pick a backup file first.');
  if (!path.toLowerCase().endsWith('.json')) return failure('params', 'Only .json backup files can be restored.');
  let response: Response;
  try {
    response = await fetcher(apiUrl(repo, path, branch));
  } catch {
    return failure('fetch', 'GitHub is unreachable from this server.');
  }
  if (response.status === 404) return failure('fetch', 'That file is no longer on the branch; refresh the file list.');
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
  if (size > BRANCH_FILE_MAX_BYTES) return failure('fetch', 'That backup file is larger than 5 MB; download and restore it by hand.');
  const content = typeof entry?.content === 'string' ? entry.content : '';
  if (!content) return failure('fetch', 'GitHub returned an empty file.');
  let text: string;
  try {
    const clean = content.replace(/\s+/g, '');
    text = typeof Buffer !== 'undefined' ? Buffer.from(clean, 'base64').toString('utf8') : atob(clean);
  } catch {
    return failure('fetch', 'GitHub returned a file with broken encoding.');
  }
  if (text.length > BRANCH_FILE_MAX_BYTES) return failure('fetch', 'That backup file is larger than 5 MB; download and restore it by hand.');
  try {
    const bundle: unknown = JSON.parse(text);
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return failure('fetch', 'That file is not a settings bundle.');
    const name = typeof entry?.name === 'string' && entry.name ? entry.name : path.split('/').pop() || 'branch-backup.json';
    return { ok: true, name, size: text.length, bundle };
  } catch {
    return failure('fetch', 'That file is not valid JSON.');
  }
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
}

/**
 * Push a backup bundle onto a branch: pre-read for the current sha (create
 * vs update), then PUT through the Contents API. The caller must guarantee a
 * token with contents:write; without one GitHub answers 401/404 and the
 * honest denial below is what the user sees.
 */
export async function pushBranchBackupFile(getter: BranchFetcher, putter: BranchPutter, repoRaw: unknown, branchRaw: unknown, folderRaw: unknown, nameRaw: unknown, bundle: unknown): Promise<BranchPushResult | BranchFileFailure> {
  const repo = normalizeRepo(repoRaw);
  if (!repo) return failure('params', 'Repo must look like owner/name.');
  const branch = normalizeBranch(branchRaw);
  if (!branch) return failure('params', 'Pick a branch first.');
  const folder = normalizeBackupPath(folderRaw ?? DEFAULT_BACKUP_PATH);
  if (!folder) return failure('params', 'Backup folder is not valid.');
  const name = normalizeBackupName(nameRaw);
  if (!name) return failure('params', 'Backup file name must be a safe .json name.');
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return failure('params', 'The backup bundle is empty or not an object.');
  const text = JSON.stringify(bundle, null, 2);
  if (text.length > BRANCH_FILE_MAX_BYTES) return failure('params', 'That backup is larger than 5 MB; push it by hand.');
  const fullPath = `${folder}/${name}`;
  let current: Response;
  try {
    current = await getter(apiUrl(repo, fullPath, branch));
  } catch {
    return failure('push', 'GitHub is unreachable from this server.');
  }
  let sha: string | null = null;
  if (current.status === 401 || current.status === 403 || current.status === 429) {
    return failure('push', (await classifyGitHubDenial(current)).detail);
  }
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
  const payload: Record<string, unknown> = { message: `scraper4 backup ${name}`, content: utf8ToBase64(text), branch };
  if (sha) payload.sha = sha;
  let pushed: Response;
  try {
    pushed = await putter(putUrl(repo, fullPath), payload);
  } catch {
    return failure('push', 'GitHub is unreachable from this server.');
  }
  if (pushed.status === 401 || pushed.status === 403 || pushed.status === 429) {
    return failure('push', (await classifyGitHubDenial(pushed)).detail);
  }
  if (pushed.status === 422) {
    let message = '';
    try {
      const body = (await pushed.json()) as { message?: unknown };
      if (body && typeof body.message === 'string') message = body.message.trim();
    } catch { /* non-JSON refusal */ }
    return failure('push', message ? `GitHub refused the write: ${message.slice(0, 180)}` : 'GitHub refused the write (HTTP 422).');
  }
  if (!pushed.ok) return failure('push', `GitHub push failed (HTTP ${pushed.status}).`);
  let fileSha = '', commitSha = '';
  try {
    const done = (await pushed.json()) as { content?: { sha?: unknown }; commit?: { sha?: unknown } };
    if (typeof done?.content?.sha === 'string') fileSha = done.content.sha;
    if (typeof done?.commit?.sha === 'string') commitSha = done.commit.sha;
  } catch { /* metadata unreadable; the write itself succeeded */ }
  return { ok: true, repo, branch, path: fullPath, sha: fileSha, commit: commitSha, updated: pushed.status === 200 };
}
