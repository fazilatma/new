/**
 * Port of agent-python/app/security.py — sessions, rate limiting, audit log,
 * secret masking and the initial-admin bootstrap.
 */

import type { Env, AuthUser } from './types';
import { all, first, run, changes } from './db';
import { getRawConfig } from './config';
import { hashPassword, verifyPassword, randomHex, randomUrlSafe, timingSafeEqual } from './crypto';

export const ROLE_ADMIN = 'Admin';
export const ROLE_DEVELOPER = 'Developer';
export const ROLE_VIEWER = 'Viewer';

export const SESSION_TTL_HOURS = 24;

export { hashPassword, verifyPassword };

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export async function createSession(
  env: Env,
  userId: string,
  ip = '',
  userAgent = '',
): Promise<string> {
  const token = randomUrlSafe(32);
  const expiresAt = Date.now() / 1000 + SESSION_TTL_HOURS * 3600;
  const sessionId = randomHex(16);

  const existing = await first(env, `SELECT id FROM users WHERE id = ?`, userId);
  if (!existing) {
    await run(
      env,
      `INSERT OR IGNORE INTO users (id, username, password_hash, salt, role, full_name)
       VALUES (?, ?, 'env', 'env', 'Admin', ?)`,
      userId,
      userId,
      userId,
    );
  }

  await run(
    env,
    `INSERT INTO sessions (id, user_id, token, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    sessionId,
    userId,
    token,
    expiresAt,
    ip,
    userAgent,
  );
  return token;
}

export async function validateSession(env: Env, token: string): Promise<AuthUser | null> {
  if (!token) return null;

  const envToken = await getRawConfig(env, 'AGENT_AUTH_TOKEN', '');
  if (envToken && timingSafeEqual(token, envToken)) {
    return {
      id: 'env-admin',
      username: 'env-admin',
      role: ROLE_ADMIN,
      full_name: 'Environment Admin',
    };
  }

  const now = Date.now() / 1000;
  const row = await first<any>(
    env,
    `SELECT u.id, u.username, u.role, u.full_name, s.id AS session_id, s.expires_at
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > ?`,
    token,
    now,
  );
  if (!row) return null;

  await run(
    env,
    `UPDATE sessions SET last_active = datetime('now') WHERE id = ?`,
    row.session_id,
  ).catch(() => undefined);

  return {
    id: row.id,
    username: row.username,
    role: row.role,
    full_name: row.full_name,
    session_id: row.session_id,
  };
}

export async function renewSession(env: Env, token: string): Promise<boolean> {
  const now = Date.now() / 1000;
  const res = await run(
    env,
    `UPDATE sessions SET expires_at = ? WHERE token = ? AND expires_at > ?`,
    now + SESSION_TTL_HOURS * 3600,
    token,
    now,
  );
  return changes(res) > 0;
}

export async function deleteSession(env: Env, token: string): Promise<boolean> {
  const res = await run(env, `DELETE FROM sessions WHERE token = ?`, token);
  return changes(res) > 0;
}

export async function deleteAllUserSessions(env: Env, userId: string): Promise<number> {
  const res = await run(env, `DELETE FROM sessions WHERE user_id = ?`, userId);
  return changes(res);
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

/**
 * Sliding-window limiter. The Python original kept the window in process
 * memory; on Workers the equivalent scope is the isolate. That is intentionally
 * best-effort — see README "Known differences". For hard multi-isolate limits,
 * bind a Durable Object or Cloudflare's Rate Limiting rules in front.
 */
const RATE_STORE = new Map<string, number[]>();

export function checkRateLimit(key: string, limit = 120, windowSeconds = 60): boolean {
  const now = Date.now() / 1000;
  const cutoff = now - windowSeconds;
  const stamps = (RATE_STORE.get(key) ?? []).filter((t) => t > cutoff);
  if (stamps.length >= limit) {
    RATE_STORE.set(key, stamps);
    return false;
  }
  stamps.push(now);
  RATE_STORE.set(key, stamps);
  if (RATE_STORE.size > 5000) {
    // Cheap pressure valve so a long-lived isolate cannot grow unbounded.
    for (const [k, v] of RATE_STORE) {
      if (!v.length || v[v.length - 1] < cutoff) RATE_STORE.delete(k);
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Audit log + masking                                                 */
/* ------------------------------------------------------------------ */

const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/(Bearer\s+)([A-Za-z0-9_\-.]{8,})/gi, '$1••••••••'],
  [
    /((?:key|token|password|secret|authorization)["']?\s*[:=]\s*["']?)([A-Za-z0-9_\-.]{8,})(["']?)/gi,
    '$1••••••••$3',
  ],
  [/(sk-[A-Za-z0-9_-]{10,})/gi, '••••••••'],
  [/(ghp_[A-Za-z0-9]{20,})/gi, '••••••••'],
];

export function maskLogTokens(text: string): string {
  if (!text) return '';
  let out = text;
  for (const [re, rep] of SENSITIVE_PATTERNS) out = out.replace(re, rep);
  return out;
}

export async function logSecurityEvent(
  env: Env,
  event: string,
  status: string,
  details = '',
  ip = '',
  userId = '',
): Promise<void> {
  try {
    await run(
      env,
      `INSERT INTO security_logs (ip, user_id, event, status, details) VALUES (?, ?, ?, ?, ?)`,
      ip,
      userId,
      event,
      status,
      maskLogTokens(details),
    );
  } catch {
    /* audit logging must never break the request */
  }
}

/* ------------------------------------------------------------------ */
/* Initial admin                                                       */
/* ------------------------------------------------------------------ */

export async function ensureInitialAdmin(env: Env): Promise<void> {
  const row = await first<{ c: number }>(env, `SELECT COUNT(*) AS c FROM users`);
  if ((row?.c ?? 0) > 0) return;

  const initialPassword =
    (await getRawConfig(env, 'AGENT_INITIAL_ADMIN_PASSWORD', '')) || 'admin123';
  const { hash, salt } = await hashPassword(initialPassword);
  const adminId = `user-admin-${randomHex(4)}`;
  await run(
    env,
    `INSERT OR IGNORE INTO users (id, username, password_hash, salt, role, full_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    adminId,
    'admin',
    hash,
    salt,
    ROLE_ADMIN,
    'System Administrator',
  );
  await logSecurityEvent(
    env,
    'INITIAL_ADMIN_CREATED',
    'success',
    "Default admin account created: username 'admin'",
    '',
    adminId,
  );
}

export async function listUsers(env: Env) {
  return await all(
    env,
    `SELECT id, username, role, full_name, created_at, updated_at FROM users ORDER BY created_at ASC`,
  );
}
