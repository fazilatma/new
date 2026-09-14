// Branch backup files for every runtime (read-only; no token needed for public
// repos). The dashboard CSP forbids the browser from calling api.github.com,
// so the server lists and downloads backup files same-origin. Both runtimes
// inject their own safeFetch; the logic stays single-source.
import { DEFAULT_REPO, normalizeRepo, type BranchFetcher } from './deployer-branches.js';

export const DEFAULT_BACKUP_REPO = DEFAULT_REPO;
export const DEFAULT_BACKUP_PATH = 'backups';
export const BRANCH_FILE_MAX_BYTES = 5 * 1024 * 1024;

export function normalizeBranch(raw: unknown): string | null {
  const branch = String(raw || '').trim();
  if (!branch || branch.length > 200 || branch.includes('..') || /[\s?]/.test(branch)) return null;
  return branch;
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
  stage: 'params' | 'list' | 'fetch';
}

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
  if (response.status === 403) {
    try {
      const body = (await response.json()) as { message?: unknown };
      if (typeof body?.message === 'string' && /rate limit/i.test(body.message)) return failure('list', 'GitHub API rate limit exceeded; try again in a few minutes.');
    } catch { /* fall through */ }
    return failure('list', 'GitHub refused the listing (private repo or blocked token).');
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
