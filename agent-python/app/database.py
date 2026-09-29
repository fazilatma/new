"""SQLite Database Engine with full schema management and migration."""
import sqlite3
import json
import uuid
import time
from pathlib import Path
from contextlib import contextmanager
from typing import Generator, Any, List, Dict, Optional
from .config import DATA_DIR, get_default_workspace

DB_PATH = DATA_DIR / "agent.sqlite3"

@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'Developer', -- Admin, Developer, Viewer
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
            user_agent TEXT DEFAULT '',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
            status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, applied, rolled_back
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
            change_type TEXT NOT NULL DEFAULT 'modified', -- added, modified, deleted
            status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
            applied_at TEXT DEFAULT NULL,
            FOREIGN KEY (changeset_id) REFERENCES changesets(id) ON DELETE CASCADE
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
            status TEXT NOT NULL DEFAULT 'queued', -- queued, running, paused, done, failed, cancelled
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
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS job_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id TEXT NOT NULL,
            level TEXT DEFAULT 'INFO',
            message TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
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
            role TEXT NOT NULL, -- system, user, assistant, tool
            content TEXT DEFAULT '',
            tool_calls TEXT DEFAULT NULL,
            tool_call_id TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
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
        CREATE INDEX IF NOT EXISTS idx_changeset_files_cs ON changeset_files(changeset_id);
        CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
        CREATE INDEX IF NOT EXISTS idx_job_steps_job ON job_steps(job_id);
        CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs(job_id);
        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
        CREATE INDEX IF NOT EXISTS idx_projects_default ON projects(is_default);
        """)

        # Ensure default project exists
        def_ws_path = str(get_default_workspace())
        proj = conn.execute("SELECT id FROM projects WHERE is_default = 1").fetchone()
        if not proj:
            conn.execute("""
            INSERT OR IGNORE INTO projects (id, name, description, path, default_branch, default_provider, instructions, agent_rules, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            """, (
                "proj-default",
                "Primary Project",
                "Main coding workspace with full file, terminal, and browser capabilities.",
                def_ws_path,
                "arena/01a0ed4c-new",
                "openrouter",
                "You are an expert AI Coding Agent working on this project. Inspect existing code before modifying, follow standard patterns, and test your work.",
                "- Verify dependencies before running tests.\n- Maintain clean modular code structure.\n- Create explicit commit messages."
            ))

        # Ensure default workspace exists
        r = conn.execute("SELECT id FROM workspaces WHERE is_default = 1").fetchone()
        if not r:
            conn.execute("""
            INSERT OR IGNORE INTO workspaces (id, name, path, instructions, agent_rules, is_default)
            VALUES (?, ?, ?, ?, ?, 1)
            """, (
                "default",
                "Main Project",
                def_ws_path,
                "Standard coding agent workspace. Inspect and modify files safely.",
                "- Always check existing files before creating new ones.\n- Test code changes after modifying.\n- Create clear commit messages.",
            ))

# Run initialization immediately on import
init_db()
