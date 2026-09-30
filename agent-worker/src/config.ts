/**
 * Port of agent-python/app/config.py.
 *
 * The Python version persisted mutable configuration in `data/environment.json`
 * and the encryption master key in `data/master.key`. Neither exists on Workers,
 * so:
 *   - mutable config      -> KV key `environment.json` (env.CONFIG)
 *   - master key          -> `AGENT_MASTER_KEY` secret (falls back to a
 *                            deterministic per-deployment key so the app still
 *                            boots; a warning is surfaced through /health)
 */

import type { Env } from './types';
import { decryptSecret, encryptSecret, maskSecret } from './crypto';

export const APP_VERSION = '1.0.0';
export const PORTED_FROM_VERSION = '0.16.1';

export const DEFAULT_PROXY_URL = 'https://proxy.fazilat-ma.workers.dev/?url={url}';

export const ENV_KV_KEY = 'environment.json';

export const CONFIG_KEYS = [
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'TOGETHER_API_KEY',
  'MISTRAL_API_KEY',
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ANTHROPIC_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'GITHUB_TOKEN',
  'OLLAMA_BASE_URL',
  'PROVIDERS_FILE',
  'AGENT_PROXY_URL',
  'AGENT_PROXY_ENABLED',
  'AGENT_AUTH_TOKEN',
  'AUTH_ENABLED',
  'REQUIRE_FILE_APPROVAL',
  'MAX_CONCURRENT_JOBS',
  'RATE_LIMIT_PER_MINUTE',
  'CORS_ORIGINS',
] as const;

const SECRET_WORDS = ['KEY', 'TOKEN', 'SECRET', 'PASSWORD'];

export function isSecretKey(key: string): boolean {
  if (key === 'CLOUDFLARE_ACCOUNT_ID') return false;
  return SECRET_WORDS.some((w) => key.includes(w));
}

/** Small in-isolate cache so we do not hit KV on every single request. */
type CacheEntry = { at: number; data: Record<string, string> };
let envCache: CacheEntry | null = null;
const ENV_CACHE_TTL_MS = 5000;

export function invalidateEnvCache(): void {
  envCache = null;
}

async function readStore(env: Env): Promise<Record<string, string>> {
  const now = Date.now();
  if (envCache && now - envCache.at < ENV_CACHE_TTL_MS) return envCache.data;
  let data: Record<string, string> = {};
  try {
    const raw = await env.CONFIG.get(ENV_KV_KEY);
    if (raw) data = JSON.parse(raw) as Record<string, string>;
  } catch {
    data = {};
  }
  envCache = { at: now, data };
  return data;
}

async function writeStore(env: Env, data: Record<string, string>): Promise<void> {
  await env.CONFIG.put(ENV_KV_KEY, JSON.stringify(data, null, 2));
  envCache = { at: Date.now(), data };
}

export function getMasterKey(env: Env): string {
  const k = (env.AGENT_MASTER_KEY || '').trim();
  if (k) return k;
  // Deterministic development fallback so the Worker still boots without the
  // secret configured. Values encrypted with this key are NOT portable.
  return 'arena-agent-insecure-dev-master-key';
}

export function hasMasterKey(env: Env): boolean {
  return Boolean((env.AGENT_MASTER_KEY || '').trim());
}

/**
 * Port of config.get_raw_config: KV override wins, then wrangler var/secret,
 * then the supplied default.
 */
export async function getRawConfig(env: Env, key: string, fallback = ''): Promise<string> {
  let def = fallback;
  if (key === 'AGENT_PROXY_URL' && !def) def = DEFAULT_PROXY_URL;

  const store = await readStore(env);
  const stored = store[key];
  if (stored !== undefined && stored !== null && String(stored).trim() !== '') {
    const val = String(stored);
    if (val.startsWith('enc:')) return await decryptSecret(val, getMasterKey(env));
    return val;
  }
  const fromEnv = env[key];
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv;
  return def;
}

/** Port of config.read_environment (masked view for the settings UI). */
export async function readEnvironment(env: Env): Promise<Record<string, string>> {
  const store = await readStore(env);
  const master = getMasterKey(env);
  const out: Record<string, string> = {};
  for (const k of CONFIG_KEYS) {
    let val = store[k];
    if (val === undefined || val === null || String(val).trim() === '') {
      const fromEnv = env[k];
      val = typeof fromEnv === 'string' ? fromEnv : '';
    }
    if (k === 'AGENT_PROXY_URL' && !val) val = DEFAULT_PROXY_URL;
    out[k] = isSecretKey(k) ? (val ? await maskSecret(String(val), master) : '') : String(val ?? '');
  }
  return out;
}

/** Port of config.write_environment. */
export async function writeEnvironment(
  env: Env,
  incoming: Record<string, unknown>,
): Promise<Record<string, string>> {
  const current = { ...(await readStore(env)) };
  const master = getMasterKey(env);

  for (const [k, raw] of Object.entries(incoming)) {
    if (!(CONFIG_KEYS as readonly string[]).includes(k)) continue;
    const val = String(raw ?? '').trim();
    if (isSecretKey(k)) {
      // Only replace a secret when the user typed a real (non-masked) value.
      if (val && !val.includes('••••')) current[k] = await encryptSecret(val, master);
    } else {
      current[k] = val;
    }
  }

  await writeStore(env, current);
  return await readEnvironment(env);
}

export async function isAuthEnabled(env: Env): Promise<boolean> {
  const val = (await getRawConfig(env, 'AUTH_ENABLED', '')).toLowerCase();
  const token = await getRawConfig(env, 'AGENT_AUTH_TOKEN', '');
  return ['1', 'true', 'yes', 'on'].includes(val) || Boolean(token);
}

export async function isFileApprovalRequired(env: Env): Promise<boolean> {
  const val = (await getRawConfig(env, 'REQUIRE_FILE_APPROVAL', 'true')).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(val);
}

/**
 * Port of config.parse_proxy_setting.
 *
 * On Workers there is no socket-level forward proxy, so a `http://host:port`
 * style value cannot be honoured. It is reported back as `proxyClient` and the
 * caller falls through to a direct request (see chat.ts).
 */
export function parseProxySetting(
  proxyVal: string,
  targetUrl: string,
): { effectiveUrl: string; proxyClient: string | null } {
  const v = (proxyVal || '').trim();
  if (!v) return { effectiveUrl: targetUrl, proxyClient: null };

  for (const ph of ['{url}', '{URL}', '{target}', '{TARGET}']) {
    if (v.includes(ph)) {
      return { effectiveUrl: v.split(ph).join(encodeURIComponent(targetUrl)), proxyClient: null };
    }
  }

  if (v.includes('workers.dev') || v.includes('?') || v.endsWith('=')) {
    if (v.endsWith('=') || v.endsWith('?')) {
      return { effectiveUrl: `${v}${encodeURIComponent(targetUrl)}`, proxyClient: null };
    }
    if (v.includes('?')) {
      return { effectiveUrl: `${v}&url=${encodeURIComponent(targetUrl)}`, proxyClient: null };
    }
    const base = v.replace(/\/+$/, '');
    return { effectiveUrl: `${base}/?url=${encodeURIComponent(targetUrl)}`, proxyClient: null };
  }

  if (/^(https?|socks5h?|socks4):\/\//i.test(v)) {
    // Not supported by the Workers runtime — surfaced to the caller.
    return { effectiveUrl: targetUrl, proxyClient: v };
  }

  return { effectiveUrl: targetUrl, proxyClient: null };
}

/** Port of config.get_proxy_config. */
export async function getProxyConfig(
  env: Env,
  targetUrl: string,
  customProxyUrl?: string | null,
): Promise<{ effectiveUrl: string; proxyClient: string | null }> {
  if (customProxyUrl) return parseProxySetting(customProxyUrl, targetUrl);

  const enabled = (await getRawConfig(env, 'AGENT_PROXY_ENABLED', 'false')).toLowerCase();
  if (['0', 'false', 'no', 'off', ''].includes(enabled)) {
    return { effectiveUrl: targetUrl, proxyClient: null };
  }
  const proxyVal = (await getRawConfig(env, 'AGENT_PROXY_URL', DEFAULT_PROXY_URL)).trim();
  return parseProxySetting(proxyVal, targetUrl);
}
