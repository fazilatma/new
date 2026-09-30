/**
 * Port of agent-python/app/observability.py.
 *
 * The Python version kept a 1000-entry in-process ring buffer plus a JSONL
 * file. Workers isolates are ephemeral, so logs are persisted in the D1
 * `app_logs` table (trimmed to the most recent 2000 rows) and mirrored into a
 * small in-isolate buffer to keep reads cheap.
 */

import type { Env } from './types';
import { all, first, run } from './db';
import { APP_VERSION } from './config';
import { workspaceMetrics } from './storage';

export interface LogEntry {
  id?: number;
  timestamp: string;
  level: string;
  category: string;
  message: string;
  meta: Record<string, unknown>;
}

const RING: LogEntry[] = [];
const RING_MAX = 200;
let sinceTrim = 0;

export async function logEvent(
  env: Env,
  level: string,
  category: string,
  message: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  const entry: LogEntry = {
    timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
    level: (level || 'INFO').toUpperCase(),
    category,
    message,
    meta,
  };
  RING.push(entry);
  if (RING.length > RING_MAX) RING.shift();

  try {
    await run(
      env,
      `INSERT INTO app_logs (level, category, message, meta) VALUES (?, ?, ?, ?)`,
      entry.level,
      entry.category,
      entry.message,
      JSON.stringify(meta ?? {}),
    );
    sinceTrim += 1;
    if (sinceTrim >= 100) {
      sinceTrim = 0;
      await run(
        env,
        `DELETE FROM app_logs WHERE id <= (SELECT MAX(id) - 2000 FROM app_logs)`,
      ).catch(() => undefined);
    }
  } catch {
    /* never fail a request because of logging */
  }
}

export async function getLogs(
  env: Env,
  level?: string | null,
  search?: string | null,
  limit = 100,
): Promise<LogEntry[]> {
  let sql = `SELECT id, timestamp, level, category, message, meta FROM app_logs WHERE 1=1`;
  const params: unknown[] = [];
  if (level) {
    sql += ` AND level = ?`;
    params.push(level.toUpperCase());
  }
  if (search) {
    sql += ` AND (lower(message) LIKE ? OR lower(category) LIKE ?)`;
    const t = `%${search.toLowerCase()}%`;
    params.push(t, t);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(Math.max(limit, 1), 1000));

  try {
    const rows = await all<any>(env, sql, ...params);
    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      level: r.level,
      category: r.category,
      module: r.category,
      message: r.message,
      details: r.meta,
      meta: safeJson(r.meta),
    })) as LogEntry[];
  } catch {
    return [...RING].reverse().slice(0, limit);
  }
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

/**
 * Port of observability.get_system_metrics.
 *
 * `os.statvfs` has no Workers equivalent; the "disk" card is filled with R2
 * usage of the active workspace instead, which is the meaningful quota here.
 */
export async function getSystemMetrics(env: Env, activeWorkspaceId: string) {
  const [active, completed, failed] = await Promise.all([
    first<{ c: number }>(env, `SELECT COUNT(*) AS c FROM jobs WHERE status IN ('running','queued')`),
    first<{ c: number }>(env, `SELECT COUNT(*) AS c FROM jobs WHERE status = 'done'`),
    first<{ c: number }>(env, `SELECT COUNT(*) AS c FROM jobs WHERE status = 'failed'`),
  ]);

  let storage = { fileCount: 0, totalSizeBytes: 0, totalSizeMB: 0, root: '' };
  try {
    storage = await workspaceMetrics(env, activeWorkspaceId);
  } catch {
    /* ignore */
  }

  // R2 has no hard per-bucket cap; report against a soft 1 GiB display budget
  // so the existing UI gauge keeps working.
  const displayBudget = 1024 * 1024 * 1024;
  const used = storage.totalSizeBytes;

  return {
    activeJobs: active?.c ?? 0,
    completedJobs: completed?.c ?? 0,
    failedJobs: failed?.c ?? 0,
    disk: {
      totalBytes: displayBudget,
      freeBytes: Math.max(displayBudget - used, 0),
      usedBytes: used,
      usedPercent: Math.round((used / displayBudget) * 1000) / 10,
      backend: 'cloudflare-r2',
      note: 'R2 object storage — no fixed quota; percentage is against a 1 GiB display budget.',
    },
    storage,
    runtime: 'cloudflare-workers',
    pythonVersion: null,
    workerdVersion: APP_VERSION,
    uptimeSeconds: Math.round((Date.now() - ISOLATE_STARTED) / 1000),
  };
}

const ISOLATE_STARTED = Date.now();
