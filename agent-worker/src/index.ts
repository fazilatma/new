/**
 * Port of agent-python/app/main.py — the FastAPI application, expressed with
 * Hono on Cloudflare Workers. Route paths, HTTP verbs and JSON response shapes
 * are preserved so the existing single-page UI runs unmodified.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Vars, ChatMessage } from './types';
import { APP_VERSION, readEnvironment, writeEnvironment, getRawConfig } from './config';
import { ensureDb, all, first, run, DEFAULT_WORKSPACE_ID } from './db';
import {
  getConversationCheckpoints,
  getLatestConversationCheckpoint,
  clearConversationCheckpoints,
} from './db';
import {
  authMiddleware,
  currentUser,
  login,
  logout,
  changePassword,
  createUser,
  updateUserRole,
  deleteUser,
  requireAdmin,
  requireDeveloper,
  requireViewer,
  getSessionToken,
  getClientIp,
  ANONYMOUS_ADMIN,
} from './auth';
import {
  ensureInitialAdmin,
  listUsers,
  deleteAllUserSessions,
  renewSession,
  logSecurityEvent,
} from './security';
import { isAuthEnabled } from './config';
import {
  HttpError,
  getActiveWorkspace,
  setActiveWorkspace,
  getOrCreateSessionWorkspace,
  resetSessionWorkspace,
  listWorkspaces,
  createWorkspaceFromTemplate,
  listReferenceFiles,
  readReferenceFile,
  copyReferenceFile,
  resolveReferenceWorkspaceId,
  addConversationReference,
  removeConversationReference,
  getConversationReferences,
} from './workspaces';
import {
  listDir,
  listRecursive,
  readFileText,
  readFileBytes,
  writeFileText,
  makeDir,
  deletePath,
  renamePath,
  statFile,
  fileExists,
  dirExists,
  guessMime,
  basename,
  extname,
  normalizeRel,
  workspaceMetrics,
  wsPrefix,
  UPLOADS_PREFIX,
  DIR_MARKER,
} from './storage';
import { createZip } from './zip';
import {
  getActiveProject,
  setActiveProject,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
} from './projects';
import {
  listChangesets,
  getChangeset,
  approveChangeset,
  rejectChangeset,
  rejectChangesetWithFeedback,
  approveChangesetFile,
  rejectChangesetFile,
  rollbackChangeset,
  exportChangesetPatch,
  createChangeset,
  listFileVersions,
  compareFileVersions,
  rollbackToVersion,
  previewFileChange,
  backupFile,
  saveFileVersionSnapshot,
} from './changesets';
import {
  executeSandboxedCommand,
  listActiveProcesses,
  killProcess,
  executeFileInWorkspace,
} from './terminal';
import {
  getGitStatus,
  getGitDiff,
  listBranches,
  createBranch,
  switchBranch,
  renameBranch,
  deleteBranch,
  gitCommit,
  gitPush,
  gitPull,
  gitFetch,
  listCommitHistory,
  getCommitDetails,
  listStashes,
  gitStashSave,
  gitStashApply,
  listRemotes,
  getMergeConflicts,
  resolveConflictFile,
} from './git';
import {
  getGithubUser,
  listUserRepos,
  listRepoBranches,
  getRepoTree,
  getRepoFile,
  createOrUpdateRepoFile,
  listPullRequests,
  createPullRequest,
  mergePullRequest,
  createPrReview,
  listWorkflowRuns,
  rerunWorkflowRun,
  listIssues,
  createIssue,
} from './github';
import {
  createBrowserSession,
  browserNavigate,
  browserScreenshot,
  browserClick,
  browserFill,
  browserLogs,
  browserEvaluate,
  browserFetch,
} from './browser';
import { ProviderStore, normalizeProvider, normalizeModel, CIRCUIT_BREAKER } from './providers';
import { testProviderModel, testAllModels, testProxy } from './models';
import { completeChat, streamCompleteChat } from './chat';
import {
  createJob,
  getJobDetails,
  listAllJobs,
  cancelJob,
  pauseJob,
  resumeJob,
  retryJob,
  deleteOldJobs,
  executeJobTask,
  drainJobQueue,
} from './worker-jobs';
import { getLogs, getSystemMetrics, logEvent } from './observability';
import { bytesToBase64 } from './crypto';

type App = { Bindings: Env; Variables: Vars };
const app = new Hono<App>();

/* ------------------------------------------------------------------ */
/* Global middleware                                                   */
/* ------------------------------------------------------------------ */

app.use('*', async (c, next) => {
  const origins = (c.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim());
  const handler = cors({
    origin: origins.includes('*') ? '*' : origins,
    credentials: !origins.includes('*'),
    allowHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  });
  return handler(c, next);
});

// Schema bootstrap (isolate-cached, effectively once per cold start).
app.use('*', async (c, next) => {
  await ensureDb(c.env);
  await ensureInitialAdmin(c.env).catch(() => undefined);
  return next();
});

app.use('*', authMiddleware);

app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ detail: err.message }, err.status as any);
  }
  const message = String((err as any)?.message ?? err);
  c.executionCtx?.waitUntil?.(
    logEvent(c.env, 'ERROR', 'API', message, { path: new URL(c.req.url).pathname }).catch(
      () => undefined,
    ),
  );
  return c.json({ detail: message }, 400);
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Mirror of the `if conversation_id: activate session workspace` prelude. */
async function wsFor(c: any, conversationId?: string | null): Promise<string> {
  if (conversationId) {
    try {
      const ws = await getOrCreateSessionWorkspace(c.env, conversationId);
      await setActiveWorkspace(c.env, ws.id);
      return ws.id;
    } catch {
      /* fall through to the active workspace */
    }
  }
  return (await getActiveWorkspace(c.env)).id;
}

const q = (c: any, key: string): string | undefined => c.req.query(key) || undefined;

async function body(c: any): Promise<Record<string, any>> {
  try {
    return (await c.req.json()) ?? {};
  } catch {
    return {};
  }
}

function username(c: any): string {
  return c.get('user')?.username ?? 'user';
}

/* ------------------------------------------------------------------ */
/* Meta                                                                */
/* ------------------------------------------------------------------ */

app.get('/api/version', (c) =>
  c.json({ name: 'Arena Coding Agent', version: APP_VERSION, apiVersion: 'v1', status: 'ok' }),
);

app.get('/health', (c) => c.json({ status: 'ok', version: APP_VERSION }));

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

app.get('/api/auth/status', async (c) => {
  const enabled = await isAuthEnabled(c.env);
  const user = c.get('user') ?? null;
  return c.json({ enabled, authenticated: Boolean(user), user });
});

app.post('/api/auth/login', async (c) => c.json(await login(c as any, await body(c))));

app.post('/api/auth/logout', async (c) => {
  await logout(c as any);
  return c.json({ ok: true });
});

app.post('/api/auth/logout-all', requireViewer, async (c) => {
  const user = currentUser(c as any);
  await deleteAllUserSessions(c.env, user.id);
  await logout(c as any);
  await logSecurityEvent(
    c.env,
    'LOGOUT_ALL_SESSIONS',
    'success',
    `User ${user.username} logged out of all sessions`,
    getClientIp(c as any),
    user.id,
  );
  return c.json({ ok: true, message: 'All sessions terminated' });
});

app.post('/api/auth/renew', async (c) => {
  const token = getSessionToken(c as any);
  if (!token || !(await renewSession(c.env, token))) {
    throw new HttpError(401, 'Session expired or invalid');
  }
  return c.json({ ok: true });
});

app.post('/api/auth/change-password', requireViewer, async (c) => {
  const p = await body(c);
  await changePassword(c as any, String(p.oldPassword ?? ''), String(p.newPassword ?? ''));
  return c.json({ ok: true, message: 'Password updated successfully' });
});

app.get('/api/auth/me', requireViewer, (c) => c.json({ user: c.get('user') ?? ANONYMOUS_ADMIN }));

// Convenience alias used by the SPA login screen when no users exist yet.
app.post('/api/auth/register', async (c) => {
  const p = await body(c);
  const count = await first<{ c: number }>(c.env, 'SELECT COUNT(*) AS c FROM users');
  const isBootstrap = (count?.c ?? 0) === 0;
  if (!isBootstrap) {
    const user = c.get('user');
    if (!user || user.role !== 'Admin') {
      throw new HttpError(403, 'Only an administrator can register new users.');
    }
  }
  const created = await createUser(
    c.env,
    String(p.username ?? ''),
    String(p.password ?? ''),
    String(p.role ?? (isBootstrap ? 'Admin' : 'Developer')),
    String(p.fullName ?? ''),
  );
  return c.json({ ok: true, ...created });
});

app.get('/api/users', requireAdmin, async (c) => c.json({ users: await listUsers(c.env) }));

app.post('/api/users', requireAdmin, async (c) => {
  const p = await body(c);
  const created = await createUser(
    c.env,
    String(p.username ?? ''),
    String(p.password ?? ''),
    String(p.role ?? 'Developer'),
    String(p.fullName ?? ''),
  );
  await logSecurityEvent(
    c.env,
    'USER_CREATED',
    'success',
    `User ${created.username} created with role ${created.role}`,
    getClientIp(c as any),
    currentUser(c as any).id,
  );
  return c.json({ ok: true, ...created });
});

app.put('/api/users/:userId/role', requireAdmin, async (c) => {
  const p = await body(c);
  await updateUserRole(c.env, c.req.param('userId'), String(p.role ?? ''));
  return c.json({ ok: true });
});

app.delete('/api/users/:userId', requireAdmin, async (c) => {
  await deleteUser(c.env, c.req.param('userId'), currentUser(c as any).id);
  return c.json({ ok: true });
});

app.get('/api/security/logs', requireAdmin, async (c) => {
  const limit = Number(q(c, 'limit') ?? 100);
  const logs = await all(
    c.env,
    'SELECT id, timestamp, ip, user_id, event, status, details FROM security_logs ORDER BY id DESC LIMIT ?',
    Math.min(limit, 1000),
  );
  return c.json({ logs });
});

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/projects', requireViewer, async (c) =>
  c.json({ projects: await listProjects(c.env), active: await getActiveProject(c.env) }),
);

app.get('/api/projects/:projId', requireViewer, async (c) => {
  const proj = await getProject(c.env, c.req.param('projId'));
  if (!proj) throw new HttpError(404, 'Project not found');
  return c.json(proj);
});

app.post('/api/projects', requireDeveloper, async (c) =>
  c.json(await createProject(c.env, (await body(c)) as any)),
);

app.put('/api/projects/:projId', requireDeveloper, async (c) =>
  c.json(await updateProject(c.env, c.req.param('projId'), (await body(c)) as any)),
);

app.delete('/api/projects/:projId', requireDeveloper, async (c) => {
  const projId = c.req.param('projId');
  const active = await getActiveProject(c.env);
  if (active?.id === projId) {
    throw new HttpError(
      400,
      'Cannot delete the currently active project. Switch to another project first.',
    );
  }
  const ok = await deleteProject(c.env, projId);
  if (!ok) throw new HttpError(404, 'Project not found');
  return c.json({ ok: true });
});

app.post('/api/projects/:projId/activate', requireDeveloper, async (c) =>
  c.json(await setActiveProject(c.env, c.req.param('projId'))),
);

/* ------------------------------------------------------------------ */
/* Workspaces                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/workspaces', requireViewer, async (c) =>
  c.json({ workspaces: await listWorkspaces(c.env), active: await getActiveWorkspace(c.env) }),
);

app.get('/api/workspace/session/:sessionId', requireViewer, async (c) =>
  c.json(await getOrCreateSessionWorkspace(c.env, c.req.param('sessionId'))),
);

app.post('/api/workspace/session/:sessionId/activate', requireDeveloper, async (c) => {
  const ws = await getOrCreateSessionWorkspace(c.env, c.req.param('sessionId'));
  await setActiveWorkspace(c.env, ws.id);
  return c.json(ws);
});

app.post('/api/workspace/session/:sessionId/reset', requireDeveloper, async (c) =>
  c.json(await resetSessionWorkspace(c.env, c.req.param('sessionId'))),
);

app.post('/api/workspaces', requireDeveloper, async (c) => {
  const p = await body(c);
  const name = String(p.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Workspace name is required');
  return c.json(
    await createWorkspaceFromTemplate(
      c.env,
      name,
      String(p.template ?? 'blank'),
      String(p.instructions ?? ''),
      String(p.agentRules ?? p.agent_rules ?? ''),
    ),
  );
});

app.post('/api/workspaces/switch', requireDeveloper, async (c) => {
  const p = await body(c);
  const id = String(p.id ?? p.workspaceId ?? '').trim();
  if (!id) throw new HttpError(400, 'Workspace id is required');
  return c.json(await setActiveWorkspace(c.env, id));
});

app.get('/api/workspaces/metrics', requireViewer, async (c) => {
  const ws = await getActiveWorkspace(c.env);
  return c.json(await workspaceMetrics(c.env, ws.id));
});

/* ------------------------------------------------------------------ */
/* Workspace files                                                     */
/* ------------------------------------------------------------------ */

app.get('/api/workspace/files', requireViewer, async (c) => {
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  return c.json(await listDir(c.env, wsId, q(c, 'path') ?? '.'));
});

app.get('/api/workspace/file', requireViewer, async (c) => {
  const path = q(c, 'path');
  if (!path) throw new HttpError(400, 'path is required');
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  const content = await readFileText(c.env, wsId, path);
  if (content === null) throw new HttpError(404, 'File not found');
  const st = await statFile(c.env, wsId, path);
  return c.json({ path, content, size: st?.size ?? content.length });
});

app.get('/api/workspace/raw', requireViewer, async (c) => {
  const path = q(c, 'path');
  if (!path) throw new HttpError(400, 'path is required');
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  const file = await readFileBytes(c.env, wsId, path);
  if (!file) throw new HttpError(404, 'File not found');
  return new Response(file.bytes, {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'no-store',
      'Content-Length': String(file.size),
    },
  });
});

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'];
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.aac', '.flac'];
const VIDEO_EXT = ['.mp4', '.webm', '.ogv'];
const EXEC_EXT = ['.py', '.sh', '.bash', '.js', '.ts', '.html', '.pyw'];

function parseCsv(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function buildPreview(
  env: Env,
  wsId: string,
  path: string,
  rawUrlBase: string,
): Promise<Record<string, any>> {
  const rel = normalizeRel(path);
  const isDir = !(await statFile(env, wsId, rel)) && (await dirExists(env, wsId, rel));
  if (isDir) {
    return {
      path,
      filename: basename(rel) || '.',
      isDir: true,
      type: 'dir',
      items: await listDir(env, wsId, rel),
    };
  }

  const file = await readFileBytes(env, wsId, rel);
  if (!file) throw new HttpError(404, 'File not found');

  const suffix = extname(rel).toLowerCase();
  const mime = file.contentType || guessMime(rel) || 'application/octet-stream';
  const isExecutable = EXEC_EXT.includes(suffix);

  let previewType = 'code';
  let contentText: string | null = null;
  let base64Data: string | null = null;
  let csvData: Record<string, any> | null = null;

  if (IMAGE_EXT.includes(suffix)) {
    previewType = 'image';
    base64Data = bytesToBase64(new Uint8Array(file.bytes));
  } else if (suffix === '.pdf') {
    previewType = 'pdf';
  } else if (AUDIO_EXT.includes(suffix)) {
    previewType = 'audio';
  } else if (VIDEO_EXT.includes(suffix)) {
    previewType = 'video';
  } else if (['.html', '.htm'].includes(suffix)) {
    previewType = 'html';
    contentText = new TextDecoder().decode(file.bytes);
  } else if (['.md', '.markdown'].includes(suffix)) {
    previewType = 'markdown';
    contentText = new TextDecoder().decode(file.bytes);
  } else if (['.csv', '.tsv'].includes(suffix)) {
    previewType = 'csv';
    contentText = new TextDecoder().decode(file.bytes);
    const rows = parseCsv(contentText, suffix === '.tsv' ? '\t' : ',');
    csvData = {
      headers: rows[0] ?? [],
      rows: rows.length > 1 ? rows.slice(1, 101) : [],
      totalRows: rows.length,
    };
  } else {
    const decoded = new TextDecoder().decode(file.bytes);
    // Heuristic binary detection (Python relied on decode errors).
    if (decoded.includes('\u0000')) previewType = 'binary';
    else contentText = decoded;
  }

  return {
    path,
    filename: basename(rel),
    size: file.size,
    type: previewType,
    mimeType: mime,
    isExecutable,
    content: contentText,
    base64: base64Data,
    csvData,
    rawUrl: `${rawUrlBase}${encodeURIComponent(path)}`,
  };
}

app.get('/api/workspace/file-preview', requireViewer, async (c) => {
  const path = q(c, 'path');
  if (!path) throw new HttpError(400, 'path is required');
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  return c.json(await buildPreview(c.env, wsId, path, '/api/workspace/raw?path='));
});

app.get('/api/workspace/reference-files', requireViewer, async (c) => {
  const targetType = q(c, 'target_type') ?? 'chat';
  const targetId = q(c, 'target_id') ?? '';
  const files = await listReferenceFiles(c.env, targetType, targetId, q(c, 'path') ?? '.');
  return c.json({ target_type: targetType, target_id: targetId, files });
});

app.get('/api/workspace/reference-raw', requireViewer, async (c) => {
  const targetType = q(c, 'target_type') ?? 'chat';
  const targetId = q(c, 'target_id') ?? '';
  const path = q(c, 'path');
  if (!path) throw new HttpError(400, 'path is required');
  const wsId = await resolveReferenceWorkspaceId(c.env, targetType, targetId);
  const file = await readFileBytes(c.env, wsId, path);
  if (!file) throw new HttpError(404, 'File not found in reference workspace');
  return new Response(file.bytes, {
    headers: { 'Content-Type': file.contentType, 'Cache-Control': 'no-store' },
  });
});

app.get('/api/workspace/reference-preview', requireViewer, async (c) => {
  const targetType = q(c, 'target_type') ?? 'chat';
  const targetId = q(c, 'target_id') ?? '';
  const path = q(c, 'path');
  if (!path) throw new HttpError(400, 'path is required');
  const wsId = await resolveReferenceWorkspaceId(c.env, targetType, targetId);
  const rawBase =
    `/api/workspace/reference-raw?target_type=${encodeURIComponent(targetType)}` +
    `&target_id=${encodeURIComponent(targetId)}&path=`;
  const preview = await buildPreview(c.env, wsId, path, rawBase);
  return c.json({
    ...preview,
    targetType,
    targetId,
    isReferenced: true,
  });
});

app.post('/api/workspace/import-reference-file', requireDeveloper, async (c) => {
  const p = await body(c);
  const targetId = String(p.target_id ?? '').trim();
  const sourcePath = String(p.source_path ?? '').trim();
  if (!targetId || !sourcePath) {
    throw new HttpError(400, 'target_id and source_path are required');
  }
  const wsId = await wsFor(c, p.conversation_id ?? p.session_id);
  return c.json(
    await copyReferenceFile(
      c.env,
      String(p.target_type ?? 'chat'),
      targetId,
      sourcePath,
      p.dest_path ?? null,
      wsId,
    ),
  );
});

app.post('/api/workspace/execute', requireDeveloper, async (c) => {
  const p = await body(c);
  const path = String(p.path ?? '').trim();
  if (!path) throw new HttpError(400, 'File path is required');
  const conversationId = p.conversation_id ?? p.session_id ?? null;
  const wsId = await wsFor(c, conversationId);

  // Reference-prefixed path: @chat:<id>/file or @project:<id>/file
  if (path.startsWith('@') && path.includes(':') && path.includes('/')) {
    const [prefix, relFile] = [path.slice(0, path.indexOf('/')), path.slice(path.indexOf('/') + 1)];
    const [targetType, targetId] = prefix.slice(1).split(':');
    const refWs = await resolveReferenceWorkspaceId(c.env, targetType, targetId);
    return c.json(await executeFileInWorkspace(c.env, refWs, relFile, conversationId));
  }

  return c.json(await executeFileInWorkspace(c.env, wsId, path, conversationId));
});

app.post('/api/workspace/preview', requireViewer, async (c) => {
  const p = await body(c);
  const wsId = await wsFor(c, p.conversation_id ?? p.session_id);
  return c.json(
    await previewFileChange(c.env, wsId, String(p.path ?? ''), String(p.content ?? '')),
  );
});

app.put('/api/workspace/file', requireDeveloper, async (c) => {
  const p = await body(c);
  const wsId = await wsFor(c, p.conversation_id ?? p.session_id);
  const path = String(p.path ?? '');
  const content = String(p.content ?? '');
  if (!path) throw new HttpError(400, 'path is required');

  if (p.requireApproval) {
    const cs = await createChangeset(
      c.env,
      wsId,
      `Manual edit: ${path}`,
      [{ path, new_content: content }],
      username(c),
    );
    return c.json({ requiresApproval: true, changeset: cs });
  }

  await backupFile(c.env, wsId, path);
  const size = await writeFileText(c.env, wsId, path, content);
  await saveFileVersionSnapshot(c.env, wsId, path, content, username(c));
  return c.json({ ok: true, path, size });
});

app.post('/api/workspace/create', requireDeveloper, async (c) => {
  const p = await body(c);
  const wsId = await wsFor(c, p.conversation_id ?? p.session_id);
  const path = String(p.path ?? '').trim();
  if (!path) throw new HttpError(400, 'Path is required');

  if (p.isDir) {
    await makeDir(c.env, wsId, path);
    return c.json({ ok: true, path, type: 'dir', isDir: true, created: true });
  }
  if (await fileExists(c.env, wsId, path)) {
    throw new HttpError(400, `Path '${path}' already exists.`);
  }
  const size = await writeFileText(c.env, wsId, path, String(p.content ?? ''));
  return c.json({ ok: true, path, type: 'file', isDir: false, created: true, size });
});

app.delete('/api/workspace/file', requireDeveloper, async (c) => {
  const path = q(c, 'path');
  if (!path) throw new HttpError(400, 'Path is required');
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  const res = await deletePath(c.env, wsId, path);
  return c.json({ ok: true, path, ...res });
});

app.post('/api/workspace/rename', requireDeveloper, async (c) => {
  const p = await body(c);
  const wsId = await wsFor(c, p.conversation_id ?? p.session_id);
  const oldPath = String(p.oldPath ?? '').trim();
  const newPath = String(p.newPath ?? '').trim();
  if (!oldPath || !newPath) throw new HttpError(400, 'Both oldPath and newPath are required');
  const res = await renamePath(c.env, wsId, oldPath, newPath);
  return c.json({ ok: true, old_path: oldPath, new_path: newPath, ...res });
});

app.get('/api/workspace/export-zip', requireViewer, async (c) => {
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  const files = (await listRecursive(c.env, wsId)).filter((f) => f.type === 'file');
  const entries: { name: string; data: Uint8Array }[] = [];
  for (const f of files.slice(0, 2000)) {
    const data = await readFileBytes(c.env, wsId, f.path);
    if (data) entries.push({ name: f.path, data: new Uint8Array(data.bytes) });
  }
  const zip = createZip(entries);
  return new Response(zip, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename=workspace.zip',
    },
  });
});

/* ------------------------------------------------------------------ */
/* ChangeSets & versions                                               */
/* ------------------------------------------------------------------ */

app.get('/api/changesets', requireViewer, async (c) => {
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  const limit = Number(q(c, 'limit') ?? 50);
  return c.json({ changesets: await listChangesets(c.env, wsId, limit) });
});

app.get('/api/changesets/:csId', requireViewer, async (c) => {
  const cs = await getChangeset(c.env, c.req.param('csId'));
  if (!cs) throw new HttpError(404, 'ChangeSet not found');
  return c.json(cs);
});

app.get('/api/changesets/:csId/patch', requireViewer, async (c) => {
  const csId = c.req.param('csId');
  const patch = await exportChangesetPatch(c.env, csId);
  return new Response(patch, {
    headers: {
      'Content-Type': 'text/x-patch; charset=utf-8',
      'Content-Disposition': `attachment; filename=${csId}.patch`,
    },
  });
});

app.post('/api/changesets/:csId/reject-with-feedback', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(
    await rejectChangesetWithFeedback(c.env, c.req.param('csId'), String(p.feedback ?? '')),
  );
});

app.post('/api/changesets/:csId/approve', requireDeveloper, async (c) => {
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  return c.json(await approveChangeset(c.env, wsId, c.req.param('csId'), username(c)));
});

app.post('/api/changesets/:csId/reject', requireDeveloper, async (c) =>
  c.json(await rejectChangeset(c.env, c.req.param('csId'))),
);

app.post('/api/changesets/:csId/files/:fileId/approve', requireDeveloper, async (c) => {
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  return c.json(
    await approveChangesetFile(
      c.env,
      wsId,
      c.req.param('csId'),
      c.req.param('fileId'),
      username(c),
    ),
  );
});

app.post('/api/changesets/:csId/files/:fileId/reject', requireDeveloper, async (c) =>
  c.json(await rejectChangesetFile(c.env, c.req.param('csId'), c.req.param('fileId'))),
);

app.post('/api/changesets/:csId/rollback', requireDeveloper, async (c) => {
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  return c.json(await rollbackChangeset(c.env, wsId, c.req.param('csId')));
});

app.get('/api/workspace/versions', requireViewer, async (c) => {
  const path = q(c, 'path');
  if (!path) throw new HttpError(400, 'path is required');
  const wsId = await wsFor(c, q(c, 'conversation_id'));
  return c.json({ versions: await listFileVersions(c.env, wsId, path) });
});

app.post('/api/workspace/versions/compare', requireViewer, async (c) => {
  const p = await body(c);
  return c.json(
    await compareFileVersions(
      c.env,
      String(p.path ?? ''),
      String(p.v1 ?? p.version1 ?? ''),
      String(p.v2 ?? p.version2 ?? ''),
    ),
  );
});

app.post('/api/workspace/versions/rollback', requireDeveloper, async (c) => {
  const p = await body(c);
  const wsId = await wsFor(c, p.conversation_id ?? p.session_id);
  return c.json(
    await rollbackToVersion(c.env, wsId, String(p.path ?? ''), String(p.versionId ?? p.id ?? '')),
  );
});

/* ------------------------------------------------------------------ */
/* Terminal                                                            */
/* ------------------------------------------------------------------ */

app.post('/api/terminal/exec', requireDeveloper, async (c) => {
  const p = await body(c);
  const wsId = await wsFor(c, p.conversation_id ?? p.session_id);
  const res = await executeSandboxedCommand(
    c.env,
    wsId,
    String(p.command ?? ''),
    String(p.cwd ?? '.'),
    Number(p.timeout ?? 60),
    Boolean(p.confirmed ?? p.confirmedDangerous),
  );
  return c.json(res);
});

app.get('/api/terminal/processes', requireViewer, (c) =>
  c.json({ processes: listActiveProcesses() }),
);

app.post('/api/terminal/processes/:pid/kill', requireDeveloper, (c) =>
  c.json({
    ok: killProcess(Number(c.req.param('pid'))),
    message:
      'The Workers runtime has no child processes, so there is nothing to kill. ' +
      'Long-running commands are not supported in this deployment.',
  }),
);

/* ------------------------------------------------------------------ */
/* Git                                                                 */
/* ------------------------------------------------------------------ */

app.get('/api/git/status', requireViewer, async (c) => c.json(await getGitStatus(c.env)));

app.get('/api/git/diff', requireViewer, async (c) =>
  c.json(await getGitDiff(c.env, q(c, 'staged') === 'true', q(c, 'path') ?? null)),
);

app.get('/api/git/branches', requireViewer, async (c) => c.json(await listBranches(c.env)));

app.post('/api/git/branch/create', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(await createBranch(c.env, String(p.name ?? ''), p.from ?? undefined));
});

app.post('/api/git/branch/switch', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(await switchBranch(c.env, String(p.name ?? '')));
});

app.post('/api/git/branch/rename', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(await renameBranch(c.env, String(p.oldName ?? ''), String(p.newName ?? '')));
});

app.post('/api/git/branch/delete', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(await deleteBranch(c.env, String(p.name ?? '')));
});

app.post('/api/git/commit', requireDeveloper, async (c) => {
  const p = await body(c);
  const message = String(p.message ?? '').trim();
  if (!message) throw new HttpError(400, 'Commit message is required');
  return c.json(await gitCommit(c.env, message, p.paths ?? p.files ?? undefined));
});

app.get('/api/git/log', requireViewer, async (c) =>
  c.json(await listCommitHistory(c.env, Number(q(c, 'limit') ?? 50))),
);

app.get('/api/git/commit/:commitHash', requireViewer, async (c) =>
  c.json(await getCommitDetails(c.env, c.req.param('commitHash'))),
);

app.post('/api/git/pull', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(await gitPull(c.env, String(p.remote ?? 'origin'), String(p.branch ?? '')));
});

app.post('/api/git/push', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(
    await gitPush(c.env, String(p.remote ?? 'origin'), String(p.branch ?? ''), Boolean(p.force)),
  );
});

app.post('/api/git/fetch', requireDeveloper, async (c) => c.json(await gitFetch(c.env)));

app.get('/api/git/stash', requireViewer, async (c) => c.json({ stashes: await listStashes() }));
app.post('/api/git/stash', requireDeveloper, async (c) => c.json(await gitStashSave()));
app.post('/api/git/stash/apply', requireDeveloper, async (c) => c.json(await gitStashApply()));
app.get('/api/git/remotes', requireViewer, async (c) =>
  c.json({ remotes: await listRemotes(c.env) }),
);
app.get('/api/git/conflicts', requireViewer, async (c) =>
  c.json({ conflicts: await getMergeConflicts() }),
);
app.post('/api/git/resolve-conflict', requireDeveloper, async (c) =>
  c.json(await resolveConflictFile()),
);

/* ------------------------------------------------------------------ */
/* GitHub                                                              */
/* ------------------------------------------------------------------ */

app.get('/api/github/user', requireViewer, async (c) => c.json(await getGithubUser(c.env)));
app.get('/api/github/repos', requireViewer, async (c) => c.json(await listUserRepos(c.env)));

app.get('/api/github/repo/:owner/:repo/branches', requireViewer, async (c) =>
  c.json(await listRepoBranches(c.env, c.req.param('owner'), c.req.param('repo'))),
);

app.get('/api/github/repo/:owner/:repo/tree', requireViewer, async (c) =>
  c.json(
    await getRepoTree(c.env, c.req.param('owner'), c.req.param('repo'), q(c, 'branch') ?? 'main'),
  ),
);

app.get('/api/github/repo/:owner/:repo/contents/*', requireViewer, async (c) => {
  const path = c.req.path.split('/contents/')[1] ?? '';
  return c.json(
    await getRepoFile(
      c.env,
      c.req.param('owner'),
      c.req.param('repo'),
      decodeURIComponent(path),
      q(c, 'ref') ?? null,
    ),
  );
});

app.put('/api/github/repo/:owner/:repo/contents/*', requireDeveloper, async (c) => {
  const path = c.req.path.split('/contents/')[1] ?? '';
  const p = await body(c);
  return c.json(
    await createOrUpdateRepoFile(
      c.env,
      c.req.param('owner'),
      c.req.param('repo'),
      decodeURIComponent(path),
      String(p.content ?? ''),
      String(p.message ?? ''),
      p.branch ?? undefined,
      p.sha ?? undefined,
    ),
  );
});

app.get('/api/github/repo/:owner/:repo/pulls', requireViewer, async (c) =>
  c.json(
    await listPullRequests(c.env, c.req.param('owner'), c.req.param('repo'), q(c, 'state') ?? 'open'),
  ),
);

app.post('/api/github/pull-request', requireDeveloper, async (c) => {
  const p = await body(c);
  const owner = String(p.owner ?? '');
  const repo = String(p.repo ?? '');
  if (!owner || !repo) throw new HttpError(400, 'owner and repo are required');
  return c.json(
    await createPullRequest(c.env, owner, repo, {
      title: p.title,
      head: p.head,
      base: p.base ?? 'main',
      body: p.body ?? '',
      draft: Boolean(p.draft),
    }),
  );
});

app.post('/api/github/repo/:owner/:repo/pulls/:pullNumber/merge', requireDeveloper, async (c) =>
  c.json(
    await mergePullRequest(
      c.env,
      c.req.param('owner'),
      c.req.param('repo'),
      Number(c.req.param('pullNumber')),
      await body(c),
    ),
  ),
);

app.post('/api/github/repo/:owner/:repo/pulls/:pullNumber/review', requireDeveloper, async (c) =>
  c.json(
    await createPrReview(
      c.env,
      c.req.param('owner'),
      c.req.param('repo'),
      Number(c.req.param('pullNumber')),
      await body(c),
    ),
  ),
);

app.get('/api/github/repo/:owner/:repo/actions/runs', requireViewer, async (c) =>
  c.json(await listWorkflowRuns(c.env, c.req.param('owner'), c.req.param('repo'))),
);

app.post('/api/github/repo/:owner/:repo/actions/runs/:runId/rerun', requireDeveloper, async (c) =>
  c.json(
    await rerunWorkflowRun(
      c.env,
      c.req.param('owner'),
      c.req.param('repo'),
      Number(c.req.param('runId')),
    ),
  ),
);

app.get('/api/github/repo/:owner/:repo/issues', requireViewer, async (c) =>
  c.json(await listIssues(c.env, c.req.param('owner'), c.req.param('repo'), q(c, 'state') ?? 'open')),
);

app.post('/api/github/repo/:owner/:repo/issues', requireDeveloper, async (c) =>
  c.json(await createIssue(c.env, c.req.param('owner'), c.req.param('repo'), await body(c))),
);

/* ------------------------------------------------------------------ */
/* Browser automation                                                  */
/* ------------------------------------------------------------------ */

app.post('/api/browser/session', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(await createBrowserSession(c.env, String(p.sessionId ?? 'default')));
});

app.post('/api/browser/navigate', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(
    await browserNavigate(c.env, String(p.url ?? ''), String(p.sessionId ?? 'default')),
  );
});

app.post('/api/browser/screenshot', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(
    await browserScreenshot(c.env, String(p.sessionId ?? 'default'), Boolean(p.fullPage)),
  );
});

app.post('/api/browser/click', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(
    await browserClick(c.env, String(p.selector ?? ''), String(p.sessionId ?? 'default')),
  );
});

app.post('/api/browser/fill', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(await browserFill(c.env, String(p.selector ?? ''), String(p.text ?? '')));
});

app.get('/api/browser/logs', requireViewer, async (c) =>
  c.json(await browserLogs(c.env, q(c, 'sessionId') ?? 'default')),
);

app.post('/api/browser/eval', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(
    await browserEvaluate(
      c.env,
      String(p.expression ?? p.script ?? ''),
      String(p.sessionId ?? 'default'),
    ),
  );
});

app.post('/api/browser/fetch', requireDeveloper, async (c) => {
  const p = await body(c);
  return c.json(await browserFetch(c.env, String(p.url ?? '')));
});

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

function chatArgs(p: Record<string, any>) {
  const messages: ChatMessage[] = p.messages ?? [
    { role: 'user', content: String(p.message ?? '') },
  ];
  return {
    messages,
    providerId: String(p.provider ?? 'openrouter'),
    modelId: String(p.model ?? ''),
    maxSteps: Number(p.maxSteps ?? 30) || 30,
    conversationId: p.conversationId ?? p.conversation_id ?? null,
    references: p.references ?? null,
  };
}

app.post('/api/chat', requireDeveloper, async (c) => {
  const p = await body(c);
  const store = await ProviderStore.load(c.env);
  const args = chatArgs(p);
  return c.json(await completeChat(c.env, store, { ...args, userId: username(c) }));
});

app.post('/api/chat/stream', requireDeveloper, async (c) => {
  const p = await body(c);
  const args = chatArgs(p);
  const env = c.env;
  const user = username(c);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const store = await ProviderStore.load(env);
        for await (const event of streamCompleteChat(env, store, { ...args, userId: user })) {
          send(String((event as any).type ?? 'message'), event);
        }
      } catch (e: any) {
        const message = String(e?.message ?? e);
        send('error', {
          error: message,
          errorDetails: {
            provider: args.providerId,
            model: args.modelId,
            error: message,
            timestamp: `${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
            remediation:
              '1. Check provider API key and internet connectivity.\n' +
              '2. In Providers & Models, test your model connection.\n' +
              '3. Verify your proxy server settings.',
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

app.post('/api/chat/upload', requireDeveloper, async (c) => {
  const form = await c.req.formData();
  const file = form.get('file') as unknown as
    | { name?: string; type?: string; arrayBuffer(): Promise<ArrayBuffer> }
    | null;
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new HttpError(400, 'A file upload is required');
  }

  const filename = file.name || `upload_${Date.now()}`;
  const safeFn = filename.replace(/[^a-zA-Z0-9._-]/g, '').trim() || 'upload';
  const key = `${UPLOADS_PREFIX}/${Date.now()}_${safeFn}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || 'application/octet-stream';

  await c.env.FILES.put(key, bytes, { httpMetadata: { contentType } });

  const isImage = contentType.startsWith('image/');
  let imageBase64: string | null = null;
  let textSnippet: string | null = null;
  if (isImage) {
    imageBase64 = bytesToBase64(bytes);
  } else {
    try {
      textSnippet = new TextDecoder().decode(bytes).slice(0, 4000);
    } catch {
      textSnippet = `[Binary file: ${filename}, size: ${bytes.length} bytes]`;
    }
  }

  return c.json({
    ok: true,
    filename,
    savedPath: `r2://${key}`,
    contentType,
    isImage,
    sizeBytes: bytes.length,
    imageBase64,
    textSnippet,
  });
});

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

app.get('/api/conversations', requireViewer, async (c) =>
  c.json({
    conversations: await all(
      c.env,
      `SELECT id, title, provider_id, model_id, created_at, updated_at
       FROM conversations ORDER BY updated_at DESC`,
    ),
  }),
);

app.post('/api/conversations', requireDeveloper, async (c) => {
  const p = await body(c);
  const convId = `conv-${Date.now()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
  const title = String(p.title ?? 'New Conversation');
  await run(
    c.env,
    'INSERT INTO conversations (id, title, provider_id, model_id) VALUES (?, ?, ?, ?)',
    convId,
    title,
    String(p.provider ?? ''),
    String(p.model ?? ''),
  );
  return c.json({ id: convId, title });
});

app.get('/api/conversations/:convId/messages', requireViewer, async (c) =>
  c.json({
    messages: await all(
      c.env,
      `SELECT id, conversation_id, role, content, tool_calls, created_at
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      c.req.param('convId'),
    ),
  }),
);

app.post('/api/conversations/:convId/messages', requireDeveloper, async (c) => {
  const convId = c.req.param('convId');
  const p = await body(c);
  const msgId = `msg-${Date.now()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`;
  const role = String(p.role ?? 'user');
  const content = String(p.content ?? '');
  await run(
    c.env,
    'INSERT INTO messages (id, conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?, ?)',
    msgId,
    convId,
    role,
    content,
    p.tool_calls ? JSON.stringify(p.tool_calls) : null,
  );
  await run(c.env, "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", convId);
  return c.json({ id: msgId, role, content });
});

app.put('/api/conversations/:convId/messages/sync', requireDeveloper, async (c) => {
  const convId = c.req.param('convId');
  const p = await body(c);
  const msgs: any[] = p.messages ?? [];
  await run(c.env, 'DELETE FROM messages WHERE conversation_id = ?', convId);
  for (const [idx, m] of msgs.entries()) {
    await run(
      c.env,
      'INSERT INTO messages (id, conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?, ?)',
      `msg-${Date.now()}-${idx}`,
      convId,
      String(m.role ?? 'user'),
      String(m.content ?? ''),
      m.tool_calls ? JSON.stringify(m.tool_calls) : null,
    );
  }
  await run(c.env, "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", convId);
  return c.json({ ok: true, count: msgs.length });
});

app.put('/api/conversations/:convId', requireDeveloper, async (c) => {
  const convId = c.req.param('convId');
  const p = await body(c);
  if (p.title) {
    await run(
      c.env,
      "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?",
      String(p.title),
      convId,
    );
  }
  return c.json({ ok: true, id: convId });
});

app.delete('/api/conversations/:convId', requireDeveloper, async (c) => {
  const convId = c.req.param('convId');
  await run(c.env, 'DELETE FROM conversations WHERE id = ?', convId);
  await run(c.env, 'DELETE FROM messages WHERE conversation_id = ?', convId);
  await clearConversationCheckpoints(c.env, convId);
  return c.json({ ok: true });
});

app.get('/api/conversations/:convId/checkpoints', requireViewer, async (c) =>
  c.json({
    checkpoints: await getConversationCheckpoints(
      c.env,
      c.req.param('convId'),
      Number(q(c, 'limit') ?? 10),
    ),
  }),
);

app.get('/api/conversations/:convId/checkpoints/latest', requireViewer, async (c) => {
  const cp = await getLatestConversationCheckpoint(c.env, c.req.param('convId'));
  if (!cp) throw new HttpError(404, 'No checkpoint found for conversation');
  return c.json({ checkpoint: cp });
});

app.delete('/api/conversations/:convId/checkpoints', requireDeveloper, async (c) => {
  await clearConversationCheckpoints(c.env, c.req.param('convId'));
  return c.json({ ok: true });
});

app.get('/api/conversations/:convId/references', requireViewer, async (c) => {
  const convId = c.req.param('convId');
  const references = await getConversationReferences(c.env, convId);
  const available_chats = await all(
    c.env,
    'SELECT id, title, created_at FROM conversations WHERE id != ? ORDER BY updated_at DESC',
    convId,
  );
  const available_projects = await all(
    c.env,
    'SELECT id, name, description FROM projects ORDER BY name ASC',
  );
  return c.json({ references, available_chats, available_projects });
});

app.post('/api/conversations/:convId/references', requireDeveloper, async (c) => {
  const p = await body(c);
  const targetId = String(p.target_id ?? '').trim();
  if (!targetId) throw new HttpError(400, 'target_id is required');
  return c.json(
    await addConversationReference(
      c.env,
      c.req.param('convId'),
      String(p.target_type ?? 'chat').trim(),
      targetId,
      String(p.title ?? '').trim(),
    ),
  );
});

app.delete(
  '/api/conversations/:convId/references/:targetType/:targetId',
  requireDeveloper,
  async (c) =>
    c.json(
      await removeConversationReference(
        c.env,
        c.req.param('convId'),
        c.req.param('targetType'),
        c.req.param('targetId'),
      ),
    ),
);

app.get('/api/references/search', requireViewer, async (c) => {
  const term = `%${(q(c, 'q') ?? '').trim()}%`;
  const convs = await all<any>(
    c.env,
    'SELECT id, title FROM conversations WHERE title LIKE ? OR id LIKE ? LIMIT 10',
    term,
    term,
  );
  const projs = await all<any>(
    c.env,
    'SELECT id, name, description FROM projects WHERE name LIKE ? OR id LIKE ? LIMIT 10',
    term,
    term,
  );
  return c.json({
    chats: convs.map((x) => ({ id: x.id, title: x.title, type: 'chat' })),
    projects: projs.map((x) => ({ id: x.id, name: x.name, type: 'project' })),
  });
});

/* ------------------------------------------------------------------ */
/* Jobs                                                                */
/* ------------------------------------------------------------------ */

app.get('/api/jobs', requireViewer, async (c) =>
  c.json({
    jobs: await listAllJobs(c.env, {
      status: q(c, 'status'),
      provider: q(c, 'provider'),
      model: q(c, 'model'),
      limit: Number(q(c, 'limit') ?? 50),
    }),
  }),
);

app.delete('/api/jobs/cleanup', requireAdmin, async (c) =>
  c.json({ ok: true, deletedCount: await deleteOldJobs(c.env, Number(q(c, 'days') ?? 7)) }),
);

app.post('/api/jobs/chat', requireDeveloper, async (c) => {
  const p = await body(c);
  const title = String(p.title ?? String(p.message ?? 'Chat Task').slice(0, 60));
  const ws = await getActiveWorkspace(c.env);
  const job = await createJob(c.env, {
    title,
    providerId: String(p.provider ?? 'openrouter'),
    modelId: String(p.model ?? ''),
    payload: p,
    workspaceId: ws.id,
    userId: username(c),
    conversationId: p.conversationId ?? p.conversation_id ?? '',
    maxSteps: Number(p.maxSteps ?? 8),
    maxTimeoutSec: Number(p.timeoutSec ?? 600),
  });
  // Replaces the asyncio worker loop: run immediately after the response.
  if (job?.id) c.executionCtx.waitUntil(executeJobTask(c.env, job.id));
  return c.json(job);
});

app.get('/api/jobs/:jobId', requireViewer, async (c) => {
  const job = await getJobDetails(c.env, c.req.param('jobId'));
  if (!job) throw new HttpError(404, 'Job not found');
  return c.json(job);
});

app.post('/api/jobs/:jobId/cancel', requireDeveloper, async (c) =>
  c.json({ ok: await cancelJob(c.env, c.req.param('jobId')) }),
);
app.post('/api/jobs/:jobId/pause', requireDeveloper, async (c) =>
  c.json({ ok: await pauseJob(c.env, c.req.param('jobId')) }),
);
app.post('/api/jobs/:jobId/resume', requireDeveloper, async (c) => {
  const jobId = c.req.param('jobId');
  const ok = await resumeJob(c.env, jobId);
  c.executionCtx.waitUntil(executeJobTask(c.env, jobId));
  return c.json({ ok });
});
app.post('/api/jobs/:jobId/retry', requireDeveloper, async (c) => {
  const jobId = c.req.param('jobId');
  const ok = await retryJob(c.env, jobId);
  c.executionCtx.waitUntil(executeJobTask(c.env, jobId));
  return c.json({ ok });
});

/* ------------------------------------------------------------------ */
/* Providers & models                                                  */
/* ------------------------------------------------------------------ */

app.get('/api/providers', requireViewer, async (c) => {
  const store = await ProviderStore.load(c.env);
  return c.json(await store.allPublic());
});

app.get('/api/providers/export', requireAdmin, async (c) => {
  const store = await ProviderStore.load(c.env);
  return new Response(store.exportJson(), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename=providers.json',
    },
  });
});

app.post('/api/providers/import-text', requireAdmin, async (c) => {
  const p = await body(c);
  const store = await ProviderStore.load(c.env);
  await store.importJson(String(p.json ?? ''), Boolean(p.replace));
  return c.json({ ok: true, count: store.data.size });
});

app.post('/api/providers/import', requireAdmin, async (c) => {
  const form = await c.req.formData();
  const file = form.get('file') as unknown as { text(): Promise<string> } | null;
  if (!file || typeof file.text !== 'function') {
    throw new HttpError(400, 'A providers.json upload is required');
  }
  const store = await ProviderStore.load(c.env);
  await store.importJson(await file.text(), q(c, 'replace') === 'true');
  return c.json({ ok: true, count: store.data.size });
});

app.post('/api/providers/test-all', requireDeveloper, async (c) => {
  const store = await ProviderStore.load(c.env);
  return c.json(await testAllModels(c.env, store));
});

app.put('/api/providers/:pid', requireAdmin, async (c) => {
  const pid = c.req.param('pid');
  const p = await body(c);
  if (p.id && p.id !== pid) throw new HttpError(400, 'Provider ID mismatch');
  const store = await ProviderStore.load(c.env);
  return c.json(await store.upsert(normalizeProvider({ ...p, id: pid }, pid)));
});

app.delete('/api/providers/:pid', requireAdmin, async (c) => {
  const store = await ProviderStore.load(c.env);
  await store.delete(c.req.param('pid'));
  return c.json({ ok: true });
});

app.post('/api/providers/:pid/models', requireAdmin, async (c) => {
  const pid = c.req.param('pid');
  const store = await ProviderStore.load(c.env);
  if (!store.data.has(pid)) throw new HttpError(404, 'Provider not found');
  const model = normalizeModel(await body(c));
  await store.addModel(pid, model);
  return c.json(model);
});

app.put('/api/providers/:pid/models/:mid', requireAdmin, async (c) => {
  const pid = c.req.param('pid');
  const store = await ProviderStore.load(c.env);
  if (!store.data.has(pid)) throw new HttpError(404, 'Provider not found');
  const model = normalizeModel(await body(c));
  await store.updateModel(pid, decodeURIComponent(c.req.param('mid')), model);
  return c.json(model);
});

app.delete('/api/providers/:pid/models/:mid', requireAdmin, async (c) => {
  const pid = c.req.param('pid');
  const store = await ProviderStore.load(c.env);
  if (!store.data.has(pid)) throw new HttpError(404, 'Provider not found');
  await store.deleteModel(pid, decodeURIComponent(c.req.param('mid')));
  return c.json({ ok: true });
});

app.post('/api/providers/:pid/test', requireDeveloper, async (c) => {
  const pid = c.req.param('pid');
  const store = await ProviderStore.load(c.env);
  const provider = store.data.get(pid);
  if (!provider) throw new HttpError(404, 'Provider not found');
  const model = provider.models[0];
  if (!model) throw new HttpError(400, `Provider '${pid}' has no models configured.`);
  return c.json(await testProviderModel(c.env, store, provider, model));
});

app.post('/api/providers/:pid/reset-circuit', requireDeveloper, (c) => {
  const pid = c.req.param('pid');
  CIRCUIT_BREAKER.recordSuccess(pid);
  return c.json({ ok: true, message: `Circuit breaker for provider ${pid} reset.` });
});

// Model IDs contain slashes (e.g. "meta-llama/llama-3-8b"), hence the wildcard.
app.post('/api/providers/:pid/models/*', requireDeveloper, async (c) => {
  const pid = c.req.param('pid');
  const path = c.req.path;
  const marker = `/api/providers/${pid}/models/`;
  let rest = path.slice(path.indexOf(marker) + marker.length);
  if (!rest.endsWith('/test')) throw new HttpError(404, 'Not found');
  const mid = decodeURIComponent(rest.slice(0, -'/test'.length));

  const store = await ProviderStore.load(c.env);
  const provider = store.data.get(pid);
  if (!provider) throw new HttpError(404, 'Provider not found');
  const model =
    provider.models.find((m) => m.id === mid) ?? normalizeModel({ id: mid, name: mid });
  return c.json(await testProviderModel(c.env, store, provider, model));
});

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

app.get('/api/config/environment', requireAdmin, async (c) =>
  c.json(await readEnvironment(c.env)),
);

app.put('/api/config/environment', requireAdmin, async (c) =>
  c.json(await writeEnvironment(c.env, await body(c))),
);

app.post('/api/config/test-proxy', requireAdmin, async (c) => {
  const p = await body(c);
  return c.json(await testProxy(c.env, p.proxy_url ?? null, p.target_url ?? undefined));
});

/* ------------------------------------------------------------------ */
/* Observability                                                       */
/* ------------------------------------------------------------------ */

app.get('/api/observability/logs', requireViewer, async (c) =>
  c.json({
    logs: await getLogs(c.env, q(c, 'level'), q(c, 'search'), Number(q(c, 'limit') ?? 100)),
  }),
);

app.get('/api/observability/metrics', requireViewer, async (c) => {
  const ws = await getActiveWorkspace(c.env);
  return c.json(await getSystemMetrics(c.env, ws.id));
});

app.get('/api/observability/export', requireViewer, async (c) => {
  const logs = await getLogs(c.env, null, null, 1000);
  if (q(c, 'format') === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['ID', 'Timestamp', 'Level', 'Module', 'Message', 'Details'].join(',')];
    for (const l of logs as any[]) {
      lines.push(
        [l.id, l.timestamp, l.level, l.module, l.message, l.details].map(esc).join(','),
      );
    }
    return new Response(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename=audit-logs.csv',
      },
    });
  }
  return new Response(JSON.stringify(logs, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename=audit-logs.json',
    },
  });
});

/* ------------------------------------------------------------------ */
/* Static UI (assets binding)                                          */
/* ------------------------------------------------------------------ */

async function serveAsset(c: any, pathname: string): Promise<Response> {
  const url = new URL(c.req.url);
  url.pathname = pathname;
  const res = await c.env.ASSETS.fetch(new Request(url.toString(), { headers: c.req.raw.headers }));
  if (res.status === 404) return c.text('Not found', 404);
  return res;
}

app.get('/', (c) => serveAsset(c, '/index.html'));
app.get('/chat', (c) => serveAsset(c, '/index.html'));
app.get('/ui', (c) => serveAsset(c, '/index.html'));

app.all('/api/*', (c) => c.json({ detail: `No API route for ${c.req.path}` }, 404));

app.all('*', async (c) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    return c.json({ detail: 'Method not allowed' }, 405);
  }
  return serveAsset(c, new URL(c.req.url).pathname);
});

/* ------------------------------------------------------------------ */
/* Worker entrypoints                                                  */
/* ------------------------------------------------------------------ */

export default {
  fetch: app.fetch,

  /** Replaces `persistent_worker_loop` — configured as a 1-minute cron. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await ensureDb(env);
        await drainJobQueue(env);
      })(),
    );
  },
};

export { app };
