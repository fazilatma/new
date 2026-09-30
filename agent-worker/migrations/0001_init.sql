-- Arena AI Coding Agent — Cloudflare D1 schema
-- Direct port of agent-python/app/database.py (SQLite) to D1.

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Developer',
    full_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    last_active TEXT DEFAULT (datetime('now')),
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    ip TEXT DEFAULT '',
    user_id TEXT DEFAULT '',
    event TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    level TEXT DEFAULT 'INFO',
    category TEXT DEFAULT 'SYSTEM',
    message TEXT NOT NULL,
    meta TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    path TEXT NOT NULL,
    git_url TEXT DEFAULT '',
    default_branch TEXT DEFAULT 'main',
    default_provider TEXT DEFAULT 'openrouter',
    default_model TEXT DEFAULT '',
    instructions TEXT DEFAULT '',
    agent_rules TEXT DEFAULT '',
    env_vars TEXT DEFAULT '{}',
    custom_commands TEXT DEFAULT '[]',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT UNIQUE NOT NULL,
    instructions TEXT DEFAULT '',
    agent_rules TEXT DEFAULT '',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS changesets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by TEXT DEFAULT '',
    approved_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS changeset_files (
    id TEXT PRIMARY KEY,
    changeset_id TEXT NOT NULL,
    path TEXT NOT NULL,
    old_content TEXT DEFAULT '',
    new_content TEXT DEFAULT '',
    diff TEXT DEFAULT '',
    change_type TEXT NOT NULL DEFAULT 'modified',
    status TEXT NOT NULL DEFAULT 'pending',
    applied_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS file_versions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    path TEXT NOT NULL,
    version_num INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_by TEXT DEFAULT '',
    changeset_id TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS file_locks (
    path TEXT PRIMARY KEY,
    locked_by TEXT NOT NULL,
    locked_at REAL NOT NULL,
    expires_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT DEFAULT '',
    user_id TEXT DEFAULT '',
    conversation_id TEXT DEFAULT '',
    provider_id TEXT DEFAULT '',
    model_id TEXT DEFAULT '',
    title TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    progress REAL DEFAULT 0.0,
    step_count INTEGER DEFAULT 0,
    max_steps INTEGER DEFAULT 8,
    max_timeout_sec INTEGER DEFAULT 600,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    error TEXT DEFAULT '',
    result_ref TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    control TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    started_at TEXT DEFAULT NULL,
    finished_at TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS job_steps (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    arguments TEXT DEFAULT '{}',
    result TEXT DEFAULT '',
    status TEXT DEFAULT 'success',
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    level TEXT DEFAULT 'INFO',
    message TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT DEFAULT '',
    user_id TEXT DEFAULT '',
    title TEXT NOT NULL,
    provider_id TEXT DEFAULT '',
    model_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT DEFAULT '',
    tool_calls TEXT DEFAULT NULL,
    tool_call_id TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_references (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    title TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversation_checkpoints (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    step_index INTEGER NOT NULL DEFAULT 0,
    provider_id TEXT DEFAULT '',
    model_id TEXT DEFAULT '',
    accumulated_content TEXT DEFAULT '',
    accumulated_reasoning TEXT DEFAULT '',
    chat_history_json TEXT DEFAULT '[]',
    saved_files_json TEXT DEFAULT '[]',
    execution_results_json TEXT DEFAULT '[]',
    status TEXT DEFAULT 'in_progress',
    error_message TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS provider_metrics (
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    request_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_latency_ms REAL DEFAULT 0.0,
    last_latency_ms REAL DEFAULT 0.0,
    last_status TEXT DEFAULT 'ok',
    circuit_breaker_tripped INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_changeset_files_cs ON changeset_files(changeset_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_job_steps_job ON job_steps(job_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_refs ON conversation_references(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_checkpoints ON conversation_checkpoints(conversation_id);
CREATE INDEX IF NOT EXISTS idx_projects_default ON projects(is_default);
CREATE INDEX IF NOT EXISTS idx_file_versions_ws_path ON file_versions(workspace_id, path);
CREATE INDEX IF NOT EXISTS idx_app_logs_ts ON app_logs(id DESC);
