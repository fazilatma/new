/**
 * Port of agent-python/app/auth.py — session auth, RBAC, the auth middleware
 * and the user-management handlers, expressed as Hono middleware/helpers.
 */

import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AuthUser, Env, Vars } from './types';
import { isAuthEnabled, getRawConfig } from './config';
import {
  ROLE_ADMIN,
  ROLE_DEVELOPER,
  ROLE_VIEWER,
  SESSION_TTL_HOURS,
  checkRateLimit,
  createSession,
  deleteSession,
  logSecurityEvent,
  validateSession,
} from './security';
import { HttpError } from './workspaces';
import { first, run } from './db';
import { hashPassword, verifyPassword, randomHex } from './crypto';

export const SESSION_COOKIE = 'arena_session';
export type AppContext = Context<{ Bindings: Env; Variables: Vars }>;

export const ANONYMOUS_ADMIN: AuthUser = {
  id: 'anonymous-admin',
  username: 'admin',
  role: ROLE_ADMIN,
  full_name: 'Anonymous Superuser',
};

/** Public routes — port of `public_paths` in auth_middleware. */
export const PUBLIC_PATHS = new Set([
  '/health',
  '/api/version',
  '/api/auth/status',
  '/api/auth/login',
  '/docs',
  '/openapi.json',
  '/redoc',
]);

export function getClientIp(c: AppContext): string {
  const forwarded = c.req.header('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Real-IP') || 'unknown';
}

export function getSessionToken(c: AppContext): string {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;
  const authHeader = c.req.header('Authorization') ?? '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return c.req.header('X-Auth-Token') ?? '';
}

export async function getCurrentUserOptional(c: AppContext): Promise<AuthUser | null> {
  const token = getSessionToken(c);
  if (!token) return null;
  return await validateSession(c.env, token);
}

/**
 * Port of `auth_middleware`: rate limiting on /api/*, then session enforcement
 * for everything outside the public path list. Also populates `c.var.user`.
 */
export const authMiddleware: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (
  c,
  next,
) => {
  const path = new URL(c.req.url).pathname;
  const ip = getClientIp(c as AppContext);
  c.set('clientIp', ip);

  if (path.startsWith('/api/')) {
    const configured = Number(await getRawConfig(c.env, 'RATE_LIMIT_PER_MINUTE', '200')) || 200;
    const limit = path.includes('login') ? 30 : configured;
    if (!checkRateLimit(`rate:${ip}:${path}`, limit, 60)) {
      await logSecurityEvent(
        c.env,
        'RATE_LIMIT_EXCEEDED',
        'blocked',
        `Rate limit exceeded on ${path}`,
        ip,
      );
      return c.json({ detail: 'Rate limit exceeded. Please try again later.' }, 429);
    }
  }

  if (!(await isAuthEnabled(c.env))) {
    c.set('user', ANONYMOUS_ADMIN);
    return next();
  }

  const user = await getCurrentUserOptional(c as AppContext);
  if (user) c.set('user', user);

  if (PUBLIC_PATHS.has(path)) return next();

  if (!user && path.startsWith('/api/')) {
    await logSecurityEvent(
      c.env,
      'UNAUTHORIZED_API_ACCESS',
      'failed',
      `Unauthorized access to ${path}`,
      ip,
    );
    return c.json({ detail: 'Authentication required' }, 401);
  }

  return next();
};

/** Port of `get_current_user` — throws 401 when auth is on and no session exists. */
export function currentUser(c: AppContext): AuthUser {
  const user = c.get('user');
  if (!user) throw new HttpError(401, 'Authentication required');
  return user;
}

/** Port of `require_role([...])`. */
export function requireRole(
  allowedRoles: string[],
): MiddlewareHandler<{ Bindings: Env; Variables: Vars }> {
  return async (c, next) => {
    if (!(await isAuthEnabled(c.env))) {
      if (!c.get('user')) c.set('user', ANONYMOUS_ADMIN);
      return next();
    }
    const user = c.get('user');
    if (!user) return c.json({ detail: 'Authentication required' }, 401);
    if (!allowedRoles.includes(user.role)) {
      await logSecurityEvent(
        c.env,
        'PERMISSION_DENIED',
        'failed',
        `${c.req.method} ${new URL(c.req.url).pathname} requires ${allowedRoles.join(', ')}`,
        c.get('clientIp') ?? '',
        user.id,
      );
      return c.json(
        { detail: `Permission denied. Required role: ${allowedRoles.join(', ')}` },
        403,
      );
    }
    return next();
  };
}

export const requireAdmin = requireRole([ROLE_ADMIN]);
export const requireDeveloper = requireRole([ROLE_ADMIN, ROLE_DEVELOPER]);
export const requireViewer = requireRole([ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER]);

/* ------------------------------------------------------------------ */
/* Login / logout                                                      */
/* ------------------------------------------------------------------ */

function setSessionCookie(c: AppContext, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: new URL(c.req.url).protocol === 'https:',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 3600,
  });
}

export async function login(
  c: AppContext,
  payload: { username?: string; password?: string; token?: string },
): Promise<Record<string, unknown>> {
  const ip = c.get('clientIp') ?? getClientIp(c);
  const ua = c.req.header('User-Agent') ?? '';

  // 1. Direct environment token login.
  if (payload.token) {
    const envToken = await getRawConfig(c.env, 'AGENT_AUTH_TOKEN', '');
    if (envToken && payload.token.trim() === envToken) {
      const sessionToken = await createSession(c.env, 'env-admin', ip, ua);
      setSessionCookie(c, sessionToken);
      await logSecurityEvent(
        c.env,
        'LOGIN_SUCCESS_TOKEN',
        'success',
        'Admin logged in via token',
        ip,
        'env-admin',
      );
      return {
        ok: true,
        token: sessionToken,
        user: { username: 'admin', role: ROLE_ADMIN },
      };
    }
  }

  // 2. Username / password login.
  if (payload.username && payload.password) {
    const row = await first<any>(
      c.env,
      'SELECT id, username, password_hash, salt, role, full_name FROM users WHERE username = ?',
      payload.username,
    );
    if (row && (await verifyPassword(payload.password, row.password_hash, row.salt))) {
      const sessionToken = await createSession(c.env, row.id, ip, ua);
      setSessionCookie(c, sessionToken);
      await logSecurityEvent(
        c.env,
        'LOGIN_SUCCESS',
        'success',
        `User ${row.username} logged in`,
        ip,
        row.id,
      );
      return {
        ok: true,
        token: sessionToken,
        user: {
          id: row.id,
          username: row.username,
          role: row.role,
          full_name: row.full_name,
        },
      };
    }
  }

  await logSecurityEvent(
    c.env,
    'LOGIN_FAILED',
    'failed',
    `Failed login attempt for username: ${payload.username ?? ''}`,
    ip,
  );
  throw new HttpError(401, 'Invalid username or password');
}

export async function logout(c: AppContext): Promise<void> {
  const token = getSessionToken(c);
  if (token) await deleteSession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
}

export async function changePassword(
  c: AppContext,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  const user = currentUser(c);
  if (user.id === 'env-admin' || user.id === 'anonymous-admin') {
    throw new HttpError(
      400,
      'Cannot change password for environment admin. Update AGENT_AUTH_TOKEN in configuration.',
    );
  }
  const row = await first<any>(
    c.env,
    'SELECT password_hash, salt FROM users WHERE id = ?',
    user.id,
  );
  if (!row || !(await verifyPassword(oldPassword, row.password_hash, row.salt))) {
    throw new HttpError(400, 'Incorrect current password');
  }
  const { hash, salt } = await hashPassword(newPassword);
  await run(
    c.env,
    "UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE id = ?",
    hash,
    salt,
    user.id,
  );
  await logSecurityEvent(
    c.env,
    'PASSWORD_CHANGED',
    'success',
    `User ${user.username} changed password`,
    c.get('clientIp') ?? '',
    user.id,
  );
}

/* ------------------------------------------------------------------ */
/* User management                                                     */
/* ------------------------------------------------------------------ */

export const VALID_ROLES = [ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER];

export async function createUser(
  env: Env,
  username: string,
  password: string,
  role = ROLE_DEVELOPER,
  fullName = '',
): Promise<{ id: string; username: string; role: string }> {
  if (!VALID_ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
  const name = (username ?? '').trim();
  if (!name || !password) throw new HttpError(400, 'Username and password are required');

  const { hash, salt } = await hashPassword(password);
  const id = `user-${randomHex(6)}`;
  try {
    await run(
      env,
      `INSERT INTO users (id, username, password_hash, salt, role, full_name)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      name,
      hash,
      salt,
      role,
      fullName ?? '',
    );
  } catch (e: any) {
    throw new HttpError(400, `Could not create user: ${e?.message ?? e}`);
  }
  return { id, username: name, role };
}

export async function updateUserRole(env: Env, userId: string, role: string): Promise<void> {
  if (!VALID_ROLES.includes(role)) throw new HttpError(400, 'Invalid role');
  await run(
    env,
    "UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?",
    role,
    userId,
  );
}

export async function deleteUser(env: Env, userId: string, actingUserId: string): Promise<void> {
  if (userId === actingUserId) {
    throw new HttpError(400, 'Cannot delete your own active account');
  }
  await run(env, 'DELETE FROM sessions WHERE user_id = ?', userId);
  await run(env, 'DELETE FROM users WHERE id = ?', userId);
}

export { ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER };
