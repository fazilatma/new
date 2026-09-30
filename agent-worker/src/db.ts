/**
 * D1 helpers — replacement for agent-python/app/database.py.
 *
 * D1 has no `executescript`, so the schema lives in migrations/0001_init.sql
 * and is mirrored here as a statement array for the lazy bootstrap used in
 * local dev / first request after a fresh deploy.
 */

import type { Env } from './types';
import { uuidHex } from './crypto';

export const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'Developer', full_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token TEXT UNIQUE NOT NULL, expires_at REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')), last_active TEXT DEFAULT (datetime('now')),
    ip_address TEXT DEFAULT '', user_agent TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT DEFAULT (datetime('now')),
    ip TEXT DEFAULT '', user_id TEXT DEFAULT '', event TEXT NOT NULL, status TEXT NOT NULL,
    details TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT DEFAULT (datetime('now')),
    level TEXT DEFAULT 'INFO', category TEXT DEFAULT 'SYSTEM', message TEXT NOT NULL,
    meta TEXT DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY, value TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', path TEXT NOT NULL,
    git_url TEXT DEFAULT '', default_branch TEXT DEFAULT 'main',
    default_provider TEXT DEFAULT 'openrouter', default_model TEXT DEFAULT '',
    instructions TEXT DEFAULT '', agent_rules TEXT DEFAULT '', env_vars TEXT DEFAULT '{}',
    custom_commands TEXT DEFAULT '[]', is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL,
    instructions TEXT DEFAULT '', agent_rules TEXT DEFAULT '', is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS changesets (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_by TEXT DEFAULT '', approved_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS changeset_files (
    id TEXT PRIMARY KEY, changeset_id TEXT NOT NULL, path TEXT NOT NULL,
    old_content TEXT DEFAULT '', new_content TEXT DEFAULT '', diff TEXT DEFAULT '',
    change_type TEXT NOT NULL DEFAULT 'modified', status TEXT NOT NULL DEFAULT 'pending',
    applied_at TEXT DEFAULT NULL)`,
  `CREATE TABLE IF NOT EXISTS file_versions (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL,
    version_num INTEGER NOT NULL, content TEXT NOT NULL, created_by TEXT DEFAULT '',
    changeset_id TEXT DEFAULT NULL, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS file_locks (
    path TEXT PRIMARY KEY, locked_by TEXT NOT NULL, locked_at REAL NOT NULL, expires_at REAL NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, workspace_id TEXT DEFAULT '', user_id TEXT DEFAULT '',
    conversation_id TEXT DEFAULT '', provider_id TEXT DEFAULT '', model_id TEXT DEFAULT '',
    title TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', progress REAL DEFAULT 0.0,
    step_count INTEGER DEFAULT 0, max_steps INTEGER DEFAULT 8, max_timeout_sec INTEGER DEFAULT 600,
    retry_count INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 3, error TEXT DEFAULT '',
    result_ref TEXT DEFAULT '', summary TEXT DEFAULT '', payload TEXT DEFAULT '{}',
    control TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')), started_at TEXT DEFAULT NULL,
    finished_at TEXT DEFAULT NULL)`,
  `CREATE TABLE IF NOT EXISTS job_steps (
    id TEXT PRIMARY KEY, job_id TEXT NOT NULL, step_index INTEGER NOT NULL, tool_name TEXT NOT NULL,
    arguments TEXT DEFAULT '{}', result TEXT DEFAULT '', status TEXT DEFAULT 'success',
    duration_ms INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, level TEXT DEFAULT 'INFO',
    message TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, workspace_id TEXT DEFAULT '', user_id TEXT DEFAULT '', title TEXT NOT NULL,
    provider_id TEXT DEFAULT '', model_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT DEFAULT '',
    tool_calls TEXT DEFAULT NULL, tool_call_id TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS conversation_references (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, target_type TEXT NOT NULL,
    target_id TEXT NOT NULL, title TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS conversation_checkpoints (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, step_index INTEGER NOT NULL DEFAULT 0,
    provider_id TEXT DEFAULT '', model_id TEXT DEFAULT '', accumulated_content TEXT DEFAULT '',
    accumulated_reasoning TEXT DEFAULT '', chat_history_json TEXT DEFAULT '[]',
    saved_files_json TEXT DEFAULT '[]', execution_results_json TEXT DEFAULT '[]',
    status TEXT DEFAULT 'in_progress', error_message TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS provider_metrics (
    provider_id TEXT NOT NULL, model_id TEXT NOT NULL, request_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0, total_tokens INTEGER DEFAULT 0, total_latency_ms REAL DEFAULT 0.0,
    last_latency_ms REAL DEFAULT 0.0, last_status TEXT DEFAULT 'ok',
    circuit_breaker_tripped INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (provider_id, model_id))`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_changeset_files_cs ON changeset_files(changeset_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_job_steps_job ON job_steps(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_refs ON conversation_references(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_conv_checkpoints ON conversation_checkpoints(conversation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_default ON projects(is_default)`,
  `CREATE INDEX IF NOT EXISTS idx_file_versions_ws_path ON file_versions(workspace_id, path)`,
];

export const DEFAULT_WORKSPACE_ID = 'default';
export const DEFAULT_PROJECT_ID = 'proj-default';
/** Logical "path" of a workspace; on Workers this is an R2 key prefix, not a POSIX path. */
export const DEFAULT_WORKSPACE_PATH = 'r2://workspaces/default';

let bootstrapped = false;

/**
 * Port of database.init_db(). Runs once per isolate; safe to call repeatedly.
 */
export async function ensureDb(env: Env): Promise<void> {
  if (bootstrapped) return;
  try {
    // Fast path: if the marker row exists we are already migrated.
    const probe = await env.DB.prepare(
      `SELECT value FROM app_state WHERE key = 'schema_version'`,
    )
      .first<{ value: string }>()
      .catch(() => null);
    if (probe?.value) {
      bootstrapped = true;
      return;
    }
  } catch {
    /* table missing -> continue to create */
  }

  for (const stmt of SCHEMA_STATEMENTS) {
    await env.DB.prepare(stmt).run();
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO projects
        (id, name, description, path, default_branch, default_provider, instructions, agent_rules, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    ).bind(
      DEFAULT_PROJECT_ID,
      'Primary Project',
      'Main coding workspace backed by R2 object storage.',
      DEFAULT_WORKSPACE_PATH,
      'main',
      'openrouter',
      'You are an expert AI Coding Agent working on this project. Inspect existing code before modifying, follow standard patterns, and test your work.',
      '- Verify dependencies before running tests.\n- Maintain clean modular code structure.\n- Create explicit commit messages.',
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO workspaces (id, name, path, instructions, agent_rules, is_default)
       VALUES (?, ?, ?, ?, ?, 1)`,
    ).bind(
      DEFAULT_WORKSPACE_ID,
      'Main Project',
      DEFAULT_WORKSPACE_PATH,
      'Standard coding agent workspace. Inspect and modify files safely.',
      '- Always check existing files before creating new ones.\n- Test code changes after modifying.\n- Create clear commit messages.',
    ),
    env.DB.prepare(
      `INSERT OR REPLACE INTO app_state (key, value, updated_at) VALUES ('schema_version', '1', datetime('now'))`,
    ),
  ]);

  bootstrapped = true;
}

/* ------------------------------------------------------------------ */
/* Small query helpers                                                 */
/* ------------------------------------------------------------------ */

export async function all<T = Record<string, any>>(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const res = await env.DB.prepare(sql)
    .bind(...(params as any[]))
    .all<T>();
  return res.results ?? [];
}

export async function first<T = Record<string, any>>(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (await env.DB.prepare(sql)
    .bind(...(params as any[]))
    .first<T>()) as T | null;
}

export async function run(env: Env, sql: string, ...params: unknown[]): Promise<D1Result> {
  return await env.DB.prepare(sql)
    .bind(...(params as any[]))
    .run();
}

/** Number of rows touched by the last statement (D1 exposes `meta.changes`). */
export function changes(res: D1Result): number {
  return (res as any)?.meta?.changes ?? 0;
}

/* ------------------------------------------------------------------ */
/* app_state: replaces the Python module-level globals                 */
/* CURRENT_WORKSPACE_ID / ACTIVE_PROJECT_ID (impossible on Workers).    */
/* ------------------------------------------------------------------ */

export async function getState(env: Env, key: string, fallback = ''): Promise<string> {
  const row = await first<{ value: string }>(env, `SELECT value FROM app_state WHERE key = ?`, key);
  return row?.value ?? fallback;
}

export async function setState(env: Env, key: string, value: string): Promise<void> {
  await run(
    env,
    `INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    key,
    value,
  );
}

/* ------------------------------------------------------------------ */
/* Conversation checkpoints (database.py tail)                         */
/* ------------------------------------------------------------------ */

export interface CheckpointInput {
  conversationId: string;
  stepIndex?: number;
  providerId?: string;
  modelId?: string;
  accumulatedContent?: string;
  accumulatedReasoning?: string;
  chatHistory?: unknown[];
  savedFiles?: unknown[];
  executionResults?: unknown[];
  status?: string;
  errorMessage?: string;
}

export async function saveConversationCheckpoint(
  env: Env,
  input: CheckpointInput,
): Promise<string> {
  if (!input.conversationId) return '';
  const cpId = `cp-${Date.now()}-${uuidHex(6)}`;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO conversations (id, title, provider_id, model_id) VALUES (?, 'Conversation', ?, ?)`,
      ).bind(input.conversationId, input.providerId ?? '', input.modelId ?? ''),
      env.DB.prepare(
        `INSERT INTO conversation_checkpoints (
            id, conversation_id, step_index, provider_id, model_id,
            accumulated_content, accumulated_reasoning,
            chat_history_json, saved_files_json, execution_results_json,
            status, error_message, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).bind(
        cpId,
        input.conversationId,
        input.stepIndex ?? 0,
        input.providerId ?? '',
        input.modelId ?? '',
        input.accumulatedContent ?? '',
        input.accumulatedReasoning ?? '',
        JSON.stringify(input.chatHistory ?? []),
        JSON.stringify(input.savedFiles ?? []),
        JSON.stringify(input.executionResults ?? []),
        input.status ?? 'in_progress',
        input.errorMessage ?? '',
      ),
    ]);
    return cpId;
  } catch {
    return '';
  }
}

function mapCheckpoint(r: any) {
  const parse = (s: string, d: any) => {
    try {
      return JSON.parse(s || 'null') ?? d;
    } catch {
      return d;
    }
  };
  return {
    id: r.id,
    conversationId: r.conversation_id,
    stepIndex: r.step_index,
    providerId: r.provider_id,
    modelId: r.model_id,
    accumulatedContent: r.accumulated_content,
    accumulatedReasoning: r.accumulated_reasoning,
    chatHistory: parse(r.chat_history_json, []),
    savedFiles: parse(r.saved_files_json, []),
    executionResults: parse(r.execution_results_json, []),
    status: r.status,
    errorMessage: r.error_message,
    updatedAt: r.updated_at,
  };
}

export async function getLatestConversationCheckpoint(env: Env, conversationId: string) {
  if (!conversationId) return null;
  const row = await first(
    env,
    `SELECT * FROM conversation_checkpoints WHERE conversation_id = ?
     ORDER BY step_index DESC, updated_at DESC, id DESC LIMIT 1`,
    conversationId,
  );
  return row ? mapCheckpoint(row) : null;
}

export async function getConversationCheckpoints(env: Env, conversationId: string, limit = 20) {
  if (!conversationId) return [];
  const rows = await all(
    env,
    `SELECT * FROM conversation_checkpoints WHERE conversation_id = ?
     ORDER BY step_index DESC, updated_at DESC, id DESC LIMIT ?`,
    conversationId,
    limit,
  );
  return rows.map(mapCheckpoint);
}

export async function clearConversationCheckpoints(env: Env, conversationId: string) {
  if (!conversationId) return;
  try {
    await run(env, `DELETE FROM conversation_checkpoints WHERE conversation_id = ?`, conversationId);
  } catch {
    /* ignore */
  }
}
