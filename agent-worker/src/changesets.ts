/**
 * Port of agent-python/app/changesets.py — change sets, approvals, file
 * version history, locks and rollbacks. Files live in R2, metadata in D1.
 */

import type { Env } from './types';
import { all, first, run } from './db';
import { uuidHex } from './crypto';
import { computeDiff, parseDiffHunks } from './diff';
import { deletePath, readFileText, writeFileText } from './storage';

export { computeDiff, parseDiffHunks };

export interface ChangeSetFileInput {
  path: string;
  new_content?: string;
  change_type?: string;
}

/* ------------------------------------------------------------------ */
/* File locks                                                          */
/* ------------------------------------------------------------------ */

export async function acquireFileLock(
  env: Env,
  relPath: string,
  userId: string,
  ttlSeconds = 300,
): Promise<boolean> {
  const now = Date.now() / 1000;
  const expires = now + ttlSeconds;
  const row = await first<{ locked_by: string; expires_at: number }>(
    env,
    `SELECT locked_by, expires_at FROM file_locks WHERE path = ?`,
    relPath,
  );
  if (row) {
    if (row.expires_at > now && row.locked_by !== userId) return false;
    await run(
      env,
      `UPDATE file_locks SET locked_by = ?, locked_at = ?, expires_at = ? WHERE path = ?`,
      userId,
      now,
      expires,
      relPath,
    );
    return true;
  }
  await run(
    env,
    `INSERT INTO file_locks (path, locked_by, locked_at, expires_at) VALUES (?, ?, ?, ?)`,
    relPath,
    userId,
    now,
    expires,
  );
  return true;
}

export async function releaseFileLock(env: Env, relPath: string, userId: string): Promise<boolean> {
  await run(
    env,
    `DELETE FROM file_locks WHERE path = ? AND (locked_by = ? OR expires_at < ?)`,
    relPath,
    userId,
    Date.now() / 1000,
  );
  return true;
}

/* ------------------------------------------------------------------ */
/* Versions                                                            */
/* ------------------------------------------------------------------ */

export async function saveFileVersionSnapshot(
  env: Env,
  workspaceId: string,
  relPath: string,
  content: string,
  createdBy = '',
  changesetId: string | null = null,
): Promise<string> {
  const verId = `v-${Date.now()}-${uuidHex(6)}`;
  const row = await first<{ m: number | null }>(
    env,
    `SELECT MAX(version_num) AS m FROM file_versions WHERE workspace_id = ? AND path = ?`,
    workspaceId,
    relPath,
  );
  const nextNum = (row?.m ?? 0) + 1;
  await run(
    env,
    `INSERT INTO file_versions (id, workspace_id, path, version_num, content, created_by, changeset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    verId,
    workspaceId,
    relPath,
    nextNum,
    content,
    createdBy,
    changesetId,
  );
  return verId;
}

export async function listFileVersions(env: Env, workspaceId: string, relPath: string) {
  return await all(
    env,
    `SELECT id, workspace_id, path, version_num, created_by, changeset_id, created_at,
            length(content) AS size
     FROM file_versions WHERE workspace_id = ? AND path = ? ORDER BY version_num DESC`,
    workspaceId,
    relPath,
  );
}

export async function compareFileVersions(env: Env, relPath: string, v1Id: string, v2Id: string) {
  const r1 = await first<any>(
    env,
    `SELECT content, version_num FROM file_versions WHERE id = ?`,
    v1Id,
  );
  const r2 = await first<any>(
    env,
    `SELECT content, version_num FROM file_versions WHERE id = ?`,
    v2Id,
  );
  if (!r1 || !r2) throw new Error('One or both version records not found');
  return {
    path: relPath,
    v1: { id: v1Id, version_num: r1.version_num },
    v2: { id: v2Id, version_num: r2.version_num },
    diff: computeDiff(
      r1.content,
      r2.content,
      `${relPath} (v${r1.version_num} -> v${r2.version_num})`,
    ),
  };
}

export async function rollbackToVersion(
  env: Env,
  workspaceId: string,
  relPath: string,
  versionId: string,
) {
  const r = await first<any>(
    env,
    `SELECT content, version_num, workspace_id FROM file_versions WHERE id = ?`,
    versionId,
  );
  if (!r) throw new Error('Version record not found');
  await writeFileText(env, workspaceId, relPath, r.content);
  await saveFileVersionSnapshot(
    env,
    workspaceId,
    relPath,
    r.content,
    `rollback-to-v${r.version_num}`,
  );
  return { ok: true, path: relPath, restored_version: r.version_num };
}

/* ------------------------------------------------------------------ */
/* Change sets                                                         */
/* ------------------------------------------------------------------ */

export async function createChangeset(
  env: Env,
  workspaceId: string,
  title: string,
  files: ChangeSetFileInput[],
  createdBy = 'agent',
) {
  const csId = `cs-${Date.now()}-${uuidHex(6)}`;
  await run(
    env,
    `INSERT INTO changesets (id, workspace_id, title, status, created_by) VALUES (?, ?, ?, 'pending', ?)`,
    csId,
    workspaceId,
    title,
    createdBy,
  );

  const createdFiles: any[] = [];
  for (const f of files) {
    const relPath = (f.path || '').trim().replace(/^\/+/, '');
    if (!relPath) continue;
    const newContent = f.new_content ?? '';
    const existing = await readFileText(env, workspaceId, relPath);
    const oldContent = existing ?? '';

    let changeType = f.change_type;
    if (!changeType) {
      if (existing === null) changeType = 'added';
      else if (!newContent && oldContent) changeType = 'deleted';
      else changeType = 'modified';
    }

    const diff = computeDiff(oldContent, newContent, relPath);
    const fileId = `cf-${uuidHex(8)}`;
    await run(
      env,
      `INSERT INTO changeset_files (id, changeset_id, path, old_content, new_content, diff, change_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      fileId,
      csId,
      relPath,
      oldContent,
      newContent,
      diff,
      changeType,
    );
    createdFiles.push({
      id: fileId,
      path: relPath,
      change_type: changeType,
      diff,
      old_size: oldContent.length,
      new_size: newContent.length,
    });
  }

  return {
    id: csId,
    title,
    status: 'pending',
    created_by: createdBy,
    files: createdFiles,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  };
}

export async function getChangeset(env: Env, csId: string) {
  const cs = await first<any>(
    env,
    `SELECT id, workspace_id, title, status, created_by, approved_by, created_at, updated_at
     FROM changesets WHERE id = ?`,
    csId,
  );
  if (!cs) return null;
  const files = await all<any>(
    env,
    `SELECT id, changeset_id, path, old_content, new_content, diff, change_type, status, applied_at
     FROM changeset_files WHERE changeset_id = ?`,
    csId,
  );
  return { ...cs, files };
}

export async function listChangesets(env: Env, workspaceId: string, limit = 50) {
  const rows = await all<any>(
    env,
    `SELECT c.id, c.workspace_id, c.title, c.status, c.created_by, c.approved_by,
            c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM changeset_files f WHERE f.changeset_id = c.id) AS file_count
     FROM changesets c WHERE c.workspace_id = ? ORDER BY c.created_at DESC LIMIT ?`,
    workspaceId,
    limit,
  );
  return rows;
}

export async function approveChangesetFile(
  env: Env,
  workspaceId: string,
  csId: string,
  fileId: string,
  approvedBy = 'user',
) {
  const f = await first<any>(
    env,
    `SELECT id, changeset_id, path, old_content, new_content, change_type, status
     FROM changeset_files WHERE id = ? AND changeset_id = ?`,
    fileId,
    csId,
  );
  if (!f) throw new Error('File change not found');

  const relPath = f.path;
  const current = await readFileText(env, workspaceId, relPath);
  if (current !== null) {
    await saveFileVersionSnapshot(
      env,
      workspaceId,
      relPath,
      f.old_content,
      `before-${csId}`,
      csId,
    );
  }

  if (f.change_type === 'deleted') {
    await deletePath(env, workspaceId, relPath).catch(() => undefined);
  } else {
    await writeFileText(env, workspaceId, relPath, f.new_content);
  }

  await saveFileVersionSnapshot(env, workspaceId, relPath, f.new_content, approvedBy, csId);
  await run(
    env,
    `UPDATE changeset_files SET status = 'approved', applied_at = datetime('now') WHERE id = ?`,
    fileId,
  );

  const statuses = (
    await all<{ status: string }>(
      env,
      `SELECT status FROM changeset_files WHERE changeset_id = ?`,
      csId,
    )
  ).map((x) => x.status);

  let newStatus = 'pending';
  if (statuses.every((s) => s === 'approved')) newStatus = 'approved';
  else if (statuses.some((s) => s === 'approved')) newStatus = 'partially_approved';

  await run(
    env,
    `UPDATE changesets SET status = ?, approved_by = ?, updated_at = datetime('now') WHERE id = ?`,
    newStatus,
    approvedBy,
    csId,
  );

  return { ok: true, file_id: fileId, path: relPath, status: 'approved' };
}

export async function rejectChangesetFile(env: Env, csId: string, fileId: string) {
  await run(
    env,
    `UPDATE changeset_files SET status = 'rejected' WHERE id = ? AND changeset_id = ?`,
    fileId,
    csId,
  );
  const statuses = (
    await all<{ status: string }>(
      env,
      `SELECT status FROM changeset_files WHERE changeset_id = ?`,
      csId,
    )
  ).map((x) => x.status);
  if (statuses.length && statuses.every((s) => s === 'rejected')) {
    await run(
      env,
      `UPDATE changesets SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`,
      csId,
    );
  }
  return { ok: true, file_id: fileId, status: 'rejected' };
}

export async function approveChangeset(
  env: Env,
  workspaceId: string,
  csId: string,
  approvedBy = 'user',
) {
  const cs = await getChangeset(env, csId);
  if (!cs) throw new Error('ChangeSet not found');

  const appliedFiles: string[] = [];
  for (const f of cs.files) {
    if (f.status !== 'rejected') {
      const res = await approveChangesetFile(env, workspaceId, csId, f.id, approvedBy);
      appliedFiles.push(res.path);
    }
  }
  await run(
    env,
    `UPDATE changesets SET status = 'approved', approved_by = ?, updated_at = datetime('now') WHERE id = ?`,
    approvedBy,
    csId,
  );
  return { ok: true, changeset_id: csId, status: 'approved', applied_files: appliedFiles };
}

export async function rejectChangeset(env: Env, csId: string) {
  await env.DB.batch([
    env.DB.prepare(`UPDATE changeset_files SET status = 'rejected' WHERE changeset_id = ?`).bind(
      csId,
    ),
    env.DB.prepare(
      `UPDATE changesets SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`,
    ).bind(csId),
  ]);
  return { ok: true, changeset_id: csId, status: 'rejected' };
}

export async function rejectChangesetWithFeedback(env: Env, csId: string, feedback: string) {
  await rejectChangeset(env, csId);
  return { ok: true, changeset_id: csId, status: 'rejected', feedback };
}

export async function rollbackChangeset(env: Env, workspaceId: string, csId: string) {
  const cs = await getChangeset(env, csId);
  if (!cs) throw new Error('ChangeSet not found');

  const reverted: string[] = [];
  for (const f of cs.files) {
    if (f.status !== 'approved') continue;
    if (f.change_type === 'added') {
      await deletePath(env, workspaceId, f.path).catch(() => undefined);
    } else {
      await writeFileText(env, workspaceId, f.path, f.old_content);
    }
    await saveFileVersionSnapshot(
      env,
      cs.workspace_id || workspaceId,
      f.path,
      f.old_content,
      `rollback-${csId}`,
    );
    reverted.push(f.path);
  }
  await run(
    env,
    `UPDATE changesets SET status = 'rolled_back', updated_at = datetime('now') WHERE id = ?`,
    csId,
  );
  return { ok: true, changeset_id: csId, status: 'rolled_back', reverted_files: reverted };
}

export async function exportChangesetPatch(env: Env, csId: string): Promise<string> {
  const cs = await getChangeset(env, csId);
  if (!cs) throw new Error('ChangeSet not found');
  return cs.files
    .map((f: any) => f.diff || computeDiff(f.old_content ?? '', f.new_content ?? '', f.path))
    .join('\n');
}

/** Port of workflow.preview. */
export async function previewFileChange(
  env: Env,
  workspaceId: string,
  path: string,
  content: string,
) {
  const old = await readFileText(env, workspaceId, path);
  const oldContent = old ?? '';
  const diff = computeDiff(oldContent, content, path);
  return {
    path,
    exists: old !== null,
    changed: oldContent !== content,
    diff,
    hunks: parseDiffHunks(diff),
  };
}

/** Port of workflow.backup. */
export async function backupFile(env: Env, workspaceId: string, path: string): Promise<string> {
  const content = await readFileText(env, workspaceId, path);
  if (content === null) return '';
  return await saveFileVersionSnapshot(env, workspaceId, path, content, 'backup');
}
