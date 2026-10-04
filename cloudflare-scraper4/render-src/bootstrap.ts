/**
 * Fresh-database bootstrap restore (Node runtimes only).
 *
 * Render's free plan has an ephemeral filesystem: every deploy wipes the local
 * SQLite database and with it all profiles, connections and AI models. To
 * survive deploys, the operator stores one full settings bundle outside the
 * deploy — a Render Secret File is the recommended place — and this module
 * imports it automatically on boot, but ONLY when the database is completely
 * fresh. A configured database is never touched, and any failure is reported
 * through the status endpoint instead of crashing the boot.
 *
 * Enablement: BOOTSTRAP_RESTORE=1/0 forces on/off. When unset, restore is ON
 * on Render (RENDER=true is injected by the platform) and ON anywhere an
 * explicit BOOTSTRAP_PATH is set, otherwise OFF.
 *
 * File lookup: explicit BOOTSTRAP_PATH first, then Render's secret-file path,
 * then ./bootstrap/render-bootstrap.json next to the running code (handy for
 * VPS/Termux; never commit a real bundle to public git — it holds secrets).
 */

export interface BootstrapEnv {
  RENDER?: string;
  BOOTSTRAP_RESTORE?: string;
  BOOTSTRAP_PATH?: string;
}

export const BOOTSTRAP_FILENAME = 'render-bootstrap.json';
export const RENDER_SECRET_PATH = `/etc/secrets/${BOOTSTRAP_FILENAME}`;
export const REPO_BOOTSTRAP_RELATIVE = `bootstrap/${BOOTSTRAP_FILENAME}`;
export const BOOTSTRAP_MARKER_KEY = 'bootstrap_restored_at';

export function shouldAutoRestoreBootstrap(env: BootstrapEnv): { enabled: boolean; reason: string } {
  const flag = String(env.BOOTSTRAP_RESTORE ?? '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(flag)) return { enabled: true, reason: 'BOOTSTRAP_RESTORE=1' };
  if (['0', 'false', 'no', 'off'].includes(flag)) return { enabled: false, reason: 'BOOTSTRAP_RESTORE=0' };
  if (String(env.RENDER ?? '').trim().toLowerCase() === 'true') return { enabled: true, reason: 'Render default (RENDER=true)' };
  if (String(env.BOOTSTRAP_PATH ?? '').trim()) return { enabled: true, reason: 'explicit BOOTSTRAP_PATH' };
  return { enabled: false, reason: 'not on Render and no explicit path (set BOOTSTRAP_RESTORE=1 to opt in)' };
}

export function bootstrapCandidates(env: BootstrapEnv, cwd: string): string[] {
  const out: string[] = [];
  const explicit = String(env.BOOTSTRAP_PATH ?? '').trim();
  if (explicit) out.push(explicit);
  out.push(RENDER_SECRET_PATH);
  out.push(`${String(cwd || '.').replace(/\/+$/, '')}/${REPO_BOOTSTRAP_RELATIVE}`);
  return [...new Set(out)];
}

export interface BootstrapDeps {
  env: BootstrapEnv;
  cwd: string;
  exists(path: string): boolean;
  readFile(path: string): string;
  isFresh(): Promise<boolean>;
  importBundle(bundle: unknown): Promise<Record<string, unknown>>;
  setMarker(at: string, path: string): Promise<void>;
}

export interface BootstrapResult {
  ok: boolean;
  restored: boolean;
  path: string | null;
  imported?: Record<string, unknown>;
  error?: string;
  reason: string;
}

export async function maybeRestoreBootstrap(deps: BootstrapDeps): Promise<BootstrapResult> {
  const { enabled, reason } = shouldAutoRestoreBootstrap(deps.env);
  if (!enabled) return { ok: true, restored: false, path: null, reason };
  const path = bootstrapCandidates(deps.env, deps.cwd).find(candidate => {
    try { return deps.exists(candidate); } catch { return false; }
  }) || null;
  if (!path) return { ok: true, restored: false, path: null, reason: `${reason}; no bootstrap file found` };
  let fresh = false;
  try { fresh = await deps.isFresh(); } catch (error) {
    return { ok: false, restored: false, path, error: `freshness check failed: ${error instanceof Error ? error.message : String(error)}`, reason };
  }
  if (!fresh) return { ok: true, restored: false, path, reason: 'database is already configured; bootstrap only applies to a fresh database' };
  let bundle: unknown;
  try { bundle = JSON.parse(deps.readFile(path)); } catch (error) {
    return { ok: false, restored: false, path, error: `bootstrap file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, reason };
  }
  try {
    const imported = await deps.importBundle(bundle);
    const at = new Date().toISOString();
    await deps.setMarker(at, path);
    return { ok: true, restored: true, path, imported, reason };
  } catch (error) {
    return { ok: false, restored: false, path, error: error instanceof Error ? error.message : String(error), reason };
  }
}
