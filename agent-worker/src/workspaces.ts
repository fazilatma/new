/**
 * Port of agent-python/app/workspaces.py.
 *
 * The Python module used module-level mutable state (`CURRENT_WORKSPACE_ID`)
 * and real directories. Here the active workspace lives in the D1 `app_state`
 * table and the "directory" is an R2 key prefix.
 */

import type { Env, WorkspaceRecord } from './types';
import {
  all,
  first,
  run,
  getState,
  setState,
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_PATH,
} from './db';
import {
  copyPath,
  deleteWorkspaceTree,
  listDir,
  listRecursive,
  makeDir,
  normalizeRel,
  readFileText,
  writeFileText,
  basename,
  FsEntry,
} from './storage';

export const ACTIVE_WORKSPACE_STATE_KEY = 'active_workspace_id';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fallbackWorkspace(): WorkspaceRecord {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: 'Default Project',
    path: DEFAULT_WORKSPACE_PATH,
    instructions: '',
    agent_rules: '',
    is_default: 1,
  };
}

export async function getActiveWorkspace(env: Env): Promise<WorkspaceRecord> {
  const wsId = await getState(env, ACTIVE_WORKSPACE_STATE_KEY, DEFAULT_WORKSPACE_ID);
  let row = await first<WorkspaceRecord>(
    env,
    `SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE id = ?`,
    wsId,
  );
  if (!row) {
    row = await first<WorkspaceRecord>(
      env,
      `SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE is_default = 1`,
    );
  }
  return row ?? fallbackWorkspace();
}

export async function setActiveWorkspace(env: Env, workspaceId: string): Promise<WorkspaceRecord> {
  const row = await first<WorkspaceRecord>(
    env,
    `SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE id = ?`,
    workspaceId,
  );
  if (!row) throw new HttpError(404, 'Workspace not found');
  await setState(env, ACTIVE_WORKSPACE_STATE_KEY, workspaceId);
  return row;
}

export function sessionWorkspaceId(sessionId: string): string {
  const clean = (sessionId || '')
    .split('')
    .filter((c) => /[a-zA-Z0-9\-_]/.test(c))
    .join('')
    .trim();
  return `session_${clean || `conv_${Date.now()}`}`;
}

/** Port of workspaces.get_or_create_session_workspace. */
export async function getOrCreateSessionWorkspace(
  env: Env,
  sessionId: string,
  title = '',
): Promise<WorkspaceRecord> {
  const wsId = sessionWorkspaceId(sessionId);
  const wsName = `Session Workspace (${title || wsId.replace('session_', '').slice(0, 8)})`;

  let row = await first<WorkspaceRecord>(
    env,
    `SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE id = ?`,
    wsId,
  );
  if (!row) {
    await run(
      env,
      `INSERT OR IGNORE INTO workspaces (id, name, path, instructions, agent_rules, is_default)
       VALUES (?, ?, ?, '', '', 0)`,
      wsId,
      wsName,
      `r2://ws/${wsId}`,
    );
    row = await first<WorkspaceRecord>(
      env,
      `SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE id = ?`,
      wsId,
    );
  }
  await setState(env, ACTIVE_WORKSPACE_STATE_KEY, wsId);
  return row ?? fallbackWorkspace();
}

export async function resetSessionWorkspace(env: Env, sessionId: string): Promise<WorkspaceRecord> {
  const wsId = sessionWorkspaceId(sessionId);
  await deleteWorkspaceTree(env, wsId);
  return await getOrCreateSessionWorkspace(env, sessionId);
}

/**
 * Resolves the active workspace for a request, honouring an optional
 * `conversation_id` query/body parameter exactly like the FastAPI routes did.
 */
export async function resolveWorkspace(
  env: Env,
  conversationId?: string | null,
): Promise<WorkspaceRecord> {
  if (conversationId) {
    try {
      return await getOrCreateSessionWorkspace(env, conversationId);
    } catch {
      /* fall through */
    }
  }
  return await getActiveWorkspace(env);
}

export async function listWorkspaces(env: Env) {
  return await all(
    env,
    `SELECT id, name, path, instructions, agent_rules, is_default, created_at
     FROM workspaces ORDER BY is_default DESC, created_at DESC`,
  );
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

const TEMPLATES: Record<string, (name: string) => Record<string, string>> = {
  fastapi: (name) => ({
    'main.py': `from fastapi import FastAPI\n\napp = FastAPI(title="Sample Service")\n\n@app.get("/")\ndef read_root():\n    return {"message": "Hello from your agent-generated FastAPI project!"}\n`,
    'requirements.txt': 'fastapi>=0.115\nuvicorn>=0.30\n',
    'README.md': `# ${name}\n\nFastAPI workspace created with Arena Agent.\n`,
  }),
  'python-cli': (name) => ({
    'cli.py': `import argparse\n\ndef main():\n    parser = argparse.ArgumentParser(description="CLI Tool")\n    parser.add_argument("--name", default="World", help="Name to greet")\n    args = parser.parse_args()\n    print(f"Hello, {args.name}!")\n\nif __name__ == "__main__":\n    main()\n`,
    'README.md': `# ${name}\n\nPython CLI workspace created with Arena Agent.\n`,
  }),
  'node-vite': () => ({
    'package.json': `{\n  "name": "sample-project",\n  "version": "1.0.0",\n  "scripts": {\n    "dev": "vite",\n    "build": "vite build"\n  }\n}\n`,
    'index.html': `<!doctype html>\n<html>\n  <head><title>App</title></head>\n  <body><div id="app">Hello Vite</div></body>\n</html>\n`,
  }),
  worker: (name) => ({
    'src/index.ts': `export default {\n  async fetch(request: Request): Promise<Response> {\n    return new Response("Hello from ${name} on Cloudflare Workers!");\n  },\n};\n`,
    'wrangler.toml': `name = "${name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}"\nmain = "src/index.ts"\ncompatibility_date = "2024-11-06"\n`,
    'README.md': `# ${name}\n\nCloudflare Worker workspace created with Arena Agent.\n`,
  }),
};

/** Port of workspaces.create_workspace_from_template. */
export async function createWorkspaceFromTemplate(
  env: Env,
  name: string,
  template: string,
  instructions = '',
  agentRules = '',
): Promise<WorkspaceRecord> {
  const wsId = `ws-${Math.floor(Date.now() / 1000)}`;
  const files = (TEMPLATES[template] ?? (() => ({
    'README.md': `# ${name}\n\nWorkspace created with Arena Agent.\n`,
  })))(name);

  for (const [rel, content] of Object.entries(files)) {
    await writeFileText(env, wsId, rel, content);
  }
  if (agentRules) await writeFileText(env, wsId, '.agentrules', agentRules);

  await run(
    env,
    `INSERT INTO workspaces (id, name, path, instructions, agent_rules, is_default)
     VALUES (?, ?, ?, ?, ?, 0)`,
    wsId,
    name,
    `r2://ws/${wsId}`,
    instructions,
    agentRules,
  );

  return {
    id: wsId,
    name,
    path: `r2://ws/${wsId}`,
    instructions,
    agent_rules: agentRules,
    is_default: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Cross-chat / cross-project references                               */
/* ------------------------------------------------------------------ */

/**
 * Port of workspaces.resolve_reference_root — returns the *workspace id*
 * (R2 prefix) that backs a referenced chat or project.
 */
export async function resolveReferenceWorkspaceId(
  env: Env,
  targetType: string,
  targetId: string,
): Promise<string> {
  const t = (targetType || '').trim().toLowerCase();
  const id = (targetId || '').trim();

  if (['chat', 'session', 'conversation'].includes(t)) {
    const cleanId = id.replace(/^session_/, '');
    const wsId = `session_${cleanId}`;
    const exists = await first(env, `SELECT id FROM workspaces WHERE id = ?`, wsId);
    if (exists) return wsId;
    const conv = await first<{ id: string }>(
      env,
      `SELECT id FROM conversations WHERE id = ? OR title = ?`,
      id,
      id,
    );
    if (conv) return `session_${conv.id.replace(/^session_/, '')}`;
    return wsId;
  }

  if (['project', 'proj'].includes(t)) {
    if (!id || id === 'default' || id === 'proj-default') return DEFAULT_WORKSPACE_ID;
    const proj = await first<{ id: string; path: string }>(
      env,
      `SELECT id, path FROM projects WHERE id = ? OR name = ?`,
      id,
      id,
    );
    if (proj) {
      const m = /^r2:\/\/ws\/(.+)$/.exec(proj.path || '');
      if (m) return m[1];
      return `proj_${proj.id}`;
    }
    const ws = await first<{ id: string }>(env, `SELECT id FROM workspaces WHERE id = ?`, id);
    if (ws) return ws.id;
    return DEFAULT_WORKSPACE_ID;
  }

  if (id.startsWith('session_') || id.startsWith('conv-')) {
    return `session_${id.replace(/^session_/, '')}`;
  }
  return DEFAULT_WORKSPACE_ID;
}

export async function listReferenceFiles(
  env: Env,
  targetType: string,
  targetId: string,
  subpath = '.',
): Promise<FsEntry[]> {
  const wsId = await resolveReferenceWorkspaceId(env, targetType, targetId);
  return await listRecursive(env, wsId, subpath);
}

export async function readReferenceFile(
  env: Env,
  targetType: string,
  targetId: string,
  filePath: string,
): Promise<string> {
  const wsId = await resolveReferenceWorkspaceId(env, targetType, targetId);
  const text = await readFileText(env, wsId, filePath);
  if (text === null) {
    throw new HttpError(404, `Referenced file not found: ${filePath} in ${targetType}:${targetId}`);
  }
  return text;
}

export async function copyReferenceFile(
  env: Env,
  targetType: string,
  targetId: string,
  sourcePath: string,
  destPath: string | null | undefined,
  activeWorkspaceId: string,
) {
  const srcWs = await resolveReferenceWorkspaceId(env, targetType, targetId);
  const dest = destPath || basename(normalizeRel(sourcePath));
  const res = await copyPath(env, srcWs, sourcePath, activeWorkspaceId, dest);
  return {
    ok: true,
    copied: true,
    type: res.type === 'dir' ? 'directory' : 'file',
    source: sourcePath,
    dest,
    bytes: res.bytes,
    targetType,
    targetId,
  };
}

/* ------------------------------------------------------------------ */
/* Conversation references                                             */
/* ------------------------------------------------------------------ */

export async function addConversationReference(
  env: Env,
  convId: string,
  targetType: string,
  targetId: string,
  title = '',
) {
  const t = (targetType || '').trim().toLowerCase();
  const id = (targetId || '').trim();
  let refTitle = title;

  if (!refTitle) {
    if (t === 'chat') {
      const r = await first<{ title: string }>(
        env,
        `SELECT title FROM conversations WHERE id = ?`,
        id.replace(/^session_/, ''),
      );
      refTitle = r?.title ?? `Chat ${id}`;
    } else if (t === 'project') {
      const r = await first<{ name: string }>(
        env,
        `SELECT name FROM projects WHERE id = ? OR name = ?`,
        id,
        id,
      );
      refTitle = r?.name ?? `Project ${id}`;
    } else {
      refTitle = `${t}:${id}`;
    }
  }

  await run(
    env,
    `INSERT OR IGNORE INTO conversations (id, title) VALUES (?, ?)`,
    convId,
    `Chat ${convId}`,
  );

  const existing = await first<{ id: string }>(
    env,
    `SELECT id FROM conversation_references WHERE conversation_id = ? AND target_type = ? AND target_id = ?`,
    convId,
    t,
    id,
  );
  if (existing) {
    return {
      id: existing.id,
      conversation_id: convId,
      target_type: t,
      target_id: id,
      title: refTitle,
      already_linked: true,
    };
  }

  const refId = `ref_${Date.now()}`;
  await run(
    env,
    `INSERT INTO conversation_references (id, conversation_id, target_type, target_id, title)
     VALUES (?, ?, ?, ?, ?)`,
    refId,
    convId,
    t,
    id,
    refTitle,
  );
  return { id: refId, conversation_id: convId, target_type: t, target_id: id, title: refTitle };
}

export async function removeConversationReference(
  env: Env,
  convId: string,
  targetType: string,
  targetId: string,
) {
  await run(
    env,
    `DELETE FROM conversation_references WHERE conversation_id = ? AND target_type = ? AND target_id = ?`,
    convId,
    targetType,
    targetId,
  );
  return { ok: true, removed: `${targetType}:${targetId}` };
}

export async function getConversationReferences(env: Env, convId: string) {
  const rows = await all<any>(
    env,
    `SELECT id, conversation_id, target_type, target_id, title, created_at
     FROM conversation_references WHERE conversation_id = ? ORDER BY created_at ASC`,
    convId,
  );
  for (const ref of rows) {
    try {
      const files = await listReferenceFiles(env, ref.target_type, ref.target_id);
      ref.file_count = files.filter((f) => f.type === 'file').length;
      ref.files = files;
    } catch {
      ref.file_count = 0;
      ref.files = [];
    }
  }
  return rows;
}

export { listDir, listRecursive, makeDir };
