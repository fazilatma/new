import {applyBrowserDefaults} from '../scripts/browser-defaults.mjs';
// Apply before any browser SDK creates profiles or child processes.
const browserDefaults=applyBrowserDefaults();

/**
 * The Node runtime is NOT only Render: the same build runs on Termux, Windows,
 * a VPS and Codespaces. Hardcoding "Render" into errors, hints and file names
 * confused users who never touched Render.com, so every message now names the
 * environment the user is actually on.
 */
function detectRuntimeEnvironment() {
  const env = process.env;
  if (env.RENDER || env.RENDER_SERVICE_ID) return { id: 'render', label: 'Render', dbHint: 'Render Dashboard → New → PostgreSQL, then set DATABASE_URL to the Internal Database URL.', tokenHint: 'Render Dashboard → your service → Environment' };
  if (process.platform === 'android' || /com\.termux/.test(env.PREFIX || '')) return { id: 'termux', label: 'Termux', dbHint: 'Leave DATABASE_URL empty to use the built-in SQLite database, or run: pkg install -y postgresql', tokenHint: 'the .env.local file in cloudflare-scraper4' };
  if (env.CODESPACES) return { id: 'codespaces', label: 'Codespaces', dbHint: 'Run the Docker PostgreSQL command, or leave DATABASE_URL empty to use the built-in SQLite database.', tokenHint: 'the .env.local file in cloudflare-scraper4' };
  if (process.platform === 'win32') return { id: 'windows', label: 'Windows', dbHint: 'Set DATABASE_URL=sqlite:data/scraper4.sqlite to use the built-in SQLite database (no PostgreSQL service needed).', tokenHint: 'the .env.local file in cloudflare-scraper4' };
  return { id: 'local', label: 'Node', dbHint: 'Set DATABASE_URL to a PostgreSQL URL, or leave it empty to use the built-in SQLite database.', tokenHint: 'the .env.local file in cloudflare-scraper4' };
}

export const runtimeEnvironment = detectRuntimeEnvironment();

/**
 * Local copy of the token cleaner (vault.ts imports this file, so importing it
 * back would create a cycle). Strips a pasted "Bearer " prefix and invisible
 * characters that make Basalam answer `401 invalid authorization header`.
 */
function envToken(value: string | undefined): string {
  return String(value || '')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim()
    .replace(/^authorization\s*:\s*/i, '')
    .replace(/^(?:bearer|token)\s+/i, '')
    .trim()
    .replace(/[^\x21-\x7e]/g, '');
}

export const config = {
  browser: browserDefaults,
  port: Math.max(1, Number(process.env.PORT || 3000)),
  host: process.env.SCRAPER_BIND_HOST || '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL || '',
  adminToken: process.env.ADMIN_TOKEN || '',
  // Explicit owner opt-out; keep adminToken intact because the vault uses it.
  adminAuthDisabled: process.env.ADMIN_AUTH_DISABLED === 'true',
  runWorkerInWeb: process.env.RUN_WORKER_IN_WEB !== 'false',
  workerPollMs: Math.max(500, Number(process.env.WORKER_POLL_MS || 2000)),
  requestTimeoutMs: Math.max(5_000, Number(process.env.REQUEST_TIMEOUT_MS || 30_000)),
  userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  woo: {
    url: process.env.WOO_URL || '',
    key: process.env.WOO_KEY || '',
    secret: process.env.WOO_SECRET || ''
  },
  basalam: {
    token: envToken(process.env.BASALAM_TOKEN),
    vendorId: process.env.BASALAM_VENDOR_ID || '',
    api: (process.env.BASALAM_API || 'https://openapi.basalam.com/v1').replace(/\/$/, '')
  }
};

export function assertConfig(): void {
  for(const warning of config.browser.warnings)console.warn('BROWSER CONFIG: '+warning);
  // v1.55+ parity with scraper4.php v10.170: local/Termux can run without PostgreSQL.
  // When DATABASE_URL is empty, render-src/db.ts opens a local SQLite database automatically.
  if (!config.adminToken || config.adminAuthDisabled) console.warn('WARNING: Admin authentication is disabled; the dashboard, API and browser installation controls are public.');
}
