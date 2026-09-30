/**
 * R2-backed workspace filesystem — replacement for the `pathlib` / `shutil`
 * usage in agent-python/app/workspaces.py.
 *
 * Key layout:
 *   ws/<workspaceId>/<relative/path>      workspace files
 *   uploads/<id>_<name>                   chat uploads
 *   job_outputs/<jobId>.json              job artifacts
 *
 * Directories are implicit. An explicit empty directory is represented by a
 * zero-byte `<dir>/.keep` marker so the UI can still create folders.
 */

import type { Env } from './types';

export const WS_PREFIX = 'ws';
export const UPLOADS_PREFIX = 'uploads';
export const JOB_OUTPUTS_PREFIX = 'job_outputs';
export const DIR_MARKER = '.keep';

const IGNORED_SEGMENTS = new Set([
  '.git',
  '.venv',
  '__pycache__',
  'node_modules',
  '.pytest_cache',
  '.cache',
  '.DS_Store',
]);

export class PathTraversalError extends Error {}

/**
 * Port of workspaces.safe_path: normalises a user supplied path and refuses to
 * escape the workspace root. Returns '' for the workspace root itself.
 */
export function normalizeRel(raw: string | null | undefined): string {
  let clean = (raw ?? '.').toString().trim();
  if (clean === '' || clean === '.' || clean === './') return '';
  clean = clean.replace(/\\/g, '/');
  // An absolute path is interpreted as workspace-relative (same as Python did
  // for paths already inside the root).
  clean = clean.replace(/^\/+/, '');

  const parts: string[] = [];
  for (const seg of clean.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) {
        throw new PathTraversalError(
          `Path traversal detected: '${raw}' is outside the workspace root`,
        );
      }
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

export function isIgnored(rel: string): boolean {
  return rel.split('/').some((s) => IGNORED_SEGMENTS.has(s));
}

export function wsPrefix(workspaceId: string): string {
  return `${WS_PREFIX}/${workspaceId}/`;
}

export function wsKey(workspaceId: string, rel: string): string {
  const norm = normalizeRel(rel);
  return norm ? `${wsPrefix(workspaceId)}${norm}` : wsPrefix(workspaceId);
}

export function basename(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export function dirname(rel: string): string {
  const parts = rel.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function extname(rel: string): string {
  const name = basename(rel);
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

export interface FsEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  size: number;
  extension?: string;
  modified: number;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function statFile(
  env: Env,
  workspaceId: string,
  rel: string,
): Promise<{ size: number; modified: number; contentType?: string } | null> {
  const norm = normalizeRel(rel);
  if (!norm) return null;
  const head = await env.FILES.head(wsKey(workspaceId, norm));
  if (!head) return null;
  return {
    size: head.size,
    modified: head.uploaded ? head.uploaded.getTime() / 1000 : Date.now() / 1000,
    contentType: head.httpMetadata?.contentType,
  };
}

export async function fileExists(env: Env, workspaceId: string, rel: string): Promise<boolean> {
  const norm = normalizeRel(rel);
  if (!norm) return true; // root always "exists"
  const head = await env.FILES.head(wsKey(workspaceId, norm));
  if (head) return true;
  return await dirExists(env, workspaceId, norm);
}

export async function dirExists(env: Env, workspaceId: string, rel: string): Promise<boolean> {
  const norm = normalizeRel(rel);
  if (!norm) return true;
  const listing = await env.FILES.list({
    prefix: `${wsPrefix(workspaceId)}${norm}/`,
    limit: 1,
  });
  return listing.objects.length > 0 || (listing as any).delimitedPrefixes?.length > 0;
}

export async function readFileText(
  env: Env,
  workspaceId: string,
  rel: string,
): Promise<string | null> {
  const norm = normalizeRel(rel);
  if (!norm) return null;
  const obj = await env.FILES.get(wsKey(workspaceId, norm));
  if (!obj) return null;
  return await obj.text();
}

export async function readFileBytes(
  env: Env,
  workspaceId: string,
  rel: string,
): Promise<{ bytes: ArrayBuffer; contentType: string; size: number } | null> {
  const norm = normalizeRel(rel);
  if (!norm) return null;
  const obj = await env.FILES.get(wsKey(workspaceId, norm));
  if (!obj) return null;
  const bytes = await obj.arrayBuffer();
  return {
    bytes,
    contentType: obj.httpMetadata?.contentType || guessMime(norm),
    size: obj.size,
  };
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function writeFileText(
  env: Env,
  workspaceId: string,
  rel: string,
  content: string,
): Promise<number> {
  const norm = normalizeRel(rel);
  if (!norm) throw new Error('Cannot write to the workspace root');
  const body = new TextEncoder().encode(content ?? '');
  await env.FILES.put(wsKey(workspaceId, norm), body, {
    httpMetadata: { contentType: guessMime(norm) },
  });
  return body.byteLength;
}

export async function writeFileBytes(
  env: Env,
  workspaceId: string,
  rel: string,
  body: ArrayBuffer | Uint8Array,
  contentType?: string,
): Promise<number> {
  const norm = normalizeRel(rel);
  if (!norm) throw new Error('Cannot write to the workspace root');
  await env.FILES.put(wsKey(workspaceId, norm), body as any, {
    httpMetadata: { contentType: contentType || guessMime(norm) },
  });
  return (body as any).byteLength ?? (body as any).length ?? 0;
}

export async function makeDir(env: Env, workspaceId: string, rel: string): Promise<void> {
  const norm = normalizeRel(rel);
  if (!norm) return;
  await env.FILES.put(`${wsPrefix(workspaceId)}${norm}/${DIR_MARKER}`, new Uint8Array(0));
}

/** Delete a single file or, when `rel` is a directory, everything below it. */
export async function deletePath(
  env: Env,
  workspaceId: string,
  rel: string,
): Promise<{ deleted: number; type: 'file' | 'dir' }> {
  const norm = normalizeRel(rel);
  if (!norm) throw new Error('Refusing to delete the workspace root');

  const head = await env.FILES.head(wsKey(workspaceId, norm));
  if (head) {
    await env.FILES.delete(wsKey(workspaceId, norm));
    return { deleted: 1, type: 'file' };
  }

  const keys = await listAllKeys(env, `${wsPrefix(workspaceId)}${norm}/`);
  if (!keys.length) throw new Error(`Path '${rel}' does not exist.`);
  await deleteKeys(env, keys);
  return { deleted: keys.length, type: 'dir' };
}

export async function renamePath(
  env: Env,
  workspaceId: string,
  oldRel: string,
  newRel: string,
): Promise<{ moved: number; type: 'file' | 'dir' }> {
  const from = normalizeRel(oldRel);
  const to = normalizeRel(newRel);
  if (!from || !to) throw new Error('Both oldPath and newPath are required');
  if (await fileExists(env, workspaceId, to)) throw new Error(`Target '${newRel}' already exists.`);

  const head = await env.FILES.head(wsKey(workspaceId, from));
  if (head) {
    const obj = await env.FILES.get(wsKey(workspaceId, from));
    if (!obj) throw new Error(`Source '${oldRel}' does not exist.`);
    await env.FILES.put(wsKey(workspaceId, to), await obj.arrayBuffer(), {
      httpMetadata: { contentType: guessMime(to) },
    });
    await env.FILES.delete(wsKey(workspaceId, from));
    return { moved: 1, type: 'file' };
  }

  const keys = await listAllKeys(env, `${wsPrefix(workspaceId)}${from}/`);
  if (!keys.length) throw new Error(`Source '${oldRel}' does not exist.`);
  for (const key of keys) {
    const suffix = key.slice(`${wsPrefix(workspaceId)}${from}/`.length);
    const obj = await env.FILES.get(key);
    if (!obj) continue;
    await env.FILES.put(`${wsPrefix(workspaceId)}${to}/${suffix}`, await obj.arrayBuffer(), {
      httpMetadata: obj.httpMetadata,
    });
  }
  await deleteKeys(env, keys);
  return { moved: keys.length, type: 'dir' };
}

export async function copyPath(
  env: Env,
  srcWorkspaceId: string,
  srcRel: string,
  dstWorkspaceId: string,
  dstRel: string,
): Promise<{ copied: number; type: 'file' | 'dir'; bytes: number }> {
  const from = normalizeRel(srcRel);
  const to = normalizeRel(dstRel);
  if (!from) throw new Error('Source path is required');

  const head = await env.FILES.head(wsKey(srcWorkspaceId, from));
  if (head) {
    const obj = await env.FILES.get(wsKey(srcWorkspaceId, from));
    if (!obj) throw new Error(`Source file not found: ${srcRel}`);
    const buf = await obj.arrayBuffer();
    await env.FILES.put(wsKey(dstWorkspaceId, to || basename(from)), buf, {
      httpMetadata: { contentType: guessMime(to || from) },
    });
    return { copied: 1, type: 'file', bytes: buf.byteLength };
  }

  const keys = await listAllKeys(env, `${wsPrefix(srcWorkspaceId)}${from}/`);
  if (!keys.length) throw new Error(`Source not found: ${srcRel}`);
  let bytes = 0;
  const destRoot = to || basename(from);
  for (const key of keys) {
    const suffix = key.slice(`${wsPrefix(srcWorkspaceId)}${from}/`.length);
    const obj = await env.FILES.get(key);
    if (!obj) continue;
    const buf = await obj.arrayBuffer();
    bytes += buf.byteLength;
    await env.FILES.put(`${wsPrefix(dstWorkspaceId)}${destRoot}/${suffix}`, buf, {
      httpMetadata: obj.httpMetadata,
    });
  }
  return { copied: keys.length, type: 'dir', bytes };
}

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export async function listAllKeys(env: Env, prefix: string, cap = 10000): Promise<string[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const res: R2Objects = await env.FILES.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects) keys.push(o.key);
    cursor = res.truncated ? (res as any).cursor : undefined;
  } while (cursor && keys.length < cap);
  return keys;
}

async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 900) {
    await env.FILES.delete(keys.slice(i, i + 900));
  }
}

/** Port of workspaces.list_workspace_files (single directory level). */
export async function listDir(
  env: Env,
  workspaceId: string,
  subpath = '.',
): Promise<FsEntry[]> {
  const norm = normalizeRel(subpath);
  const prefix = norm ? `${wsPrefix(workspaceId)}${norm}/` : wsPrefix(workspaceId);

  const entries = new Map<string, FsEntry>();
  let cursor: string | undefined;
  do {
    const res: R2Objects = await env.FILES.list({ prefix, delimiter: '/', cursor, limit: 1000 });
    for (const dp of (res as any).delimitedPrefixes ?? []) {
      const rel = (dp as string).slice(wsPrefix(workspaceId).length).replace(/\/$/, '');
      if (!rel || isIgnored(rel)) continue;
      entries.set(rel, {
        path: rel,
        name: basename(rel),
        type: 'dir',
        size: 0,
        modified: 0,
      });
    }
    for (const o of res.objects) {
      const rel = o.key.slice(wsPrefix(workspaceId).length);
      if (!rel || isIgnored(rel)) continue;
      if (basename(rel) === DIR_MARKER) continue;
      entries.set(rel, {
        path: rel,
        name: basename(rel),
        type: 'file',
        size: o.size,
        extension: extname(rel),
        modified: o.uploaded ? o.uploaded.getTime() / 1000 : 0,
      });
    }
    cursor = res.truncated ? (res as any).cursor : undefined;
  } while (cursor);

  return [...entries.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });
}

/** Recursive listing — port of workspaces.list_reference_files. */
export async function listRecursive(
  env: Env,
  workspaceId: string,
  subpath = '.',
): Promise<FsEntry[]> {
  const norm = normalizeRel(subpath);
  const prefix = norm ? `${wsPrefix(workspaceId)}${norm}/` : wsPrefix(workspaceId);

  const files: FsEntry[] = [];
  const dirs = new Set<string>();
  let cursor: string | undefined;
  do {
    const res: R2Objects = await env.FILES.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects) {
      const rel = o.key.slice(wsPrefix(workspaceId).length);
      if (!rel || isIgnored(rel)) continue;
      const parentParts = rel.split('/').slice(0, -1);
      for (let i = 1; i <= parentParts.length; i++) dirs.add(parentParts.slice(0, i).join('/'));
      if (basename(rel) === DIR_MARKER) continue;
      files.push({
        path: rel,
        name: basename(rel),
        type: 'file',
        size: o.size,
        extension: extname(rel),
        modified: o.uploaded ? o.uploaded.getTime() / 1000 : 0,
      });
    }
    cursor = res.truncated ? (res as any).cursor : undefined;
  } while (cursor);

  const dirEntries: FsEntry[] = [...dirs]
    .filter((d) => d && !isIgnored(d))
    .map((d) => ({ path: d, name: basename(d), type: 'dir' as const, size: 0, modified: 0 }));

  return [...dirEntries, ...files].sort((a, b) => a.path.localeCompare(b.path));
}

/** Port of workspaces.get_workspace_metrics. */
export async function workspaceMetrics(env: Env, workspaceId: string) {
  let fileCount = 0;
  let totalSize = 0;
  let cursor: string | undefined;
  do {
    const res: R2Objects = await env.FILES.list({ prefix: wsPrefix(workspaceId), cursor, limit: 1000 });
    for (const o of res.objects) {
      const rel = o.key.slice(wsPrefix(workspaceId).length);
      if (isIgnored(rel) || basename(rel) === DIR_MARKER) continue;
      fileCount += 1;
      totalSize += o.size;
    }
    cursor = res.truncated ? (res as any).cursor : undefined;
  } while (cursor);

  return {
    fileCount,
    totalSizeBytes: totalSize,
    totalSizeMB: Math.round((totalSize / (1024 * 1024)) * 100) / 100,
    root: `r2://${wsPrefix(workspaceId)}`,
  };
}

export async function deleteWorkspaceTree(env: Env, workspaceId: string): Promise<number> {
  const keys = await listAllKeys(env, wsPrefix(workspaceId));
  await deleteKeys(env, keys);
  return keys.length;
}

/* ------------------------------------------------------------------ */
/* MIME                                                                */
/* ------------------------------------------------------------------ */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.py': 'text/x-python; charset=utf-8',
  '.pyw': 'text/x-python; charset=utf-8',
  '.php': 'text/x-php; charset=utf-8',
  '.sh': 'text/x-shellscript; charset=utf-8',
  '.bash': 'text/x-shellscript; charset=utf-8',
  '.sql': 'application/sql; charset=utf-8',
  '.toml': 'text/plain; charset=utf-8',
  '.ini': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
};

export function guessMime(rel: string): string {
  return MIME[extname(rel)] || 'application/octet-stream';
}

export const TEXT_EXTENSIONS = new Set(Object.keys(MIME).filter((e) => MIME[e].startsWith('text/')));
