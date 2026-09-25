#!/usr/bin/env node
import http from 'node:http';
import {managedSession,lifecycleRequestAllowed,queueLifecycle} from './managed-lifecycle.mjs';
const managedInstance=process.env.SCRAPER4_MANAGED_INSTANCE==='scraper4-managed';
import { createScraperKeepalive } from './scraper-keepalive.mjs';
import { createResourceMonitor, readResources, readScraperResources } from './deployer-resources.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pyExtract, pyStatus } from './py-extract-run.mjs';
import { notifyEnabledFor, pendingNotices, pickNotifyChannel, pushNotice, sendNotification } from './deployer-notify.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Scraper4 Local Deployer UI

Usage:
  npm run deployer:ui
  DEPLOYER_UI_PORT=8790 npm run deployer:ui
  DEPLOYER_UI_TOKEN=my-local-token npm run deployer:ui

Scraper (starts automatically, on its own address):
  SCRAPER_PORT=3000                        the scraper serves http://localhost:3000/
                                           with no token; it is a separate process and
                                           keeps running after the deployer is closed
  LOCAL_SCRAPER_AUTOSTART=false            do not start the scraper automatically
  LOCAL_SCRAPER_PROXY_WAIT_MS=180000       how long "Open scraper" waits for the first
                                           render:build before giving up (Termux/ARM is slow)
  LOCAL_SCRAPER_STOP_WITH_UI=true          also stop the scraper when the deployer exits

Branch auto-update (defaults):
  LOCAL_DEPLOYER_SCAN_INTERVAL_MS=60000   scan all repo branches every 1 minute
  LOCAL_DEPLOYER_AUTO_INSTALL_LATEST=true  automatically install the branch with
                                           the newest Scraper4 package version
  LOCAL_DEPLOYER_AUTO_UPDATE=false         disable the automatic branch scanner
  Branch scanning needs an 'origin' remote pointing at
  https://github.com/fazilatma/new.git; if a checkout lacks
  it, the Branches panel offers a one-click repair.
  Auto-update is skipped while the git worktree has uncommitted changes, so it can
  never discard local work; commit or stash, then press Update now.

Open the printed URL in your browser. In GitHub Codespaces, forward the printed port and keep the token query string.
`);
  process.exit(0);
}

const projectDir = resolve(process.cwd());
const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
// The deployer is a long-lived process: it loads its own source once and keeps
// serving it. After a git update the files on disk change but THIS process is
// still the old code, so it keeps reproducing bugs that are already fixed --
// and reports the old version, which makes the two indistinguishable. Compare
// what is on disk with what we booted, and say so loudly.
const bootVersion = pkg.version;
function diskVersion() {
  try { return JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version || ''; } catch { return ''; }
}
function staleCode() {
  const onDisk = diskVersion();
  return onDisk && onDisk !== bootVersion ? { stale: true, running: bootVersion, onDisk } : { stale: false, running: bootVersion, onDisk: onDisk || bootVersion };
}

const INSTALLED_LIBRARY_GROUPS_BY_ENV = {
  'cloudflare-worker': [
    { type: 'Runtime / API', label: 'Cloudflare Worker runtime and API', items: ['Cloudflare Workers runtime', 'hono'] },
    { type: 'Extraction / edge parsing', label: 'Cloudflare-compatible extraction', items: ['HTMLRewriter', 'JSON-LD parser', '__NEXT_DATA__ parser', 'metadata parser', 'inline-script JSON parser', 'heuristic product-card parser', 'linkedom-compatible selectors'] },
    { type: 'Storage / queue', label: 'Cloudflare storage and queue', items: ['Cloudflare D1', 'Cloudflare Queues', 'Cron Triggers', 'Web Crypto vault'] },
    { type: 'Build bundle only', label: 'Build-time tools', items: ['wrangler', 'esbuild', 'typescript'] }
  ],
  vscode: [
    { type: 'Runtime / API', label: 'Node runtime and API', items: ['hono', '@hono/node-server'] },
    { type: 'Extraction / HTML parsing', label: 'Extraction and HTML parsing', items: ['cheerio', 'linkedom', 'undici'] },
    { type: 'Browser rendering / crawling', label: 'Browser engines and crawling', items: ['playwright', 'puppeteer', 'crawlee'] },
    { type: 'Data import / backup', label: 'Data import, export, backup', items: ['read-excel-file', 'fflate'] },
    { type: 'Storage', label: 'Local/server storage', items: ['pg', 'node:sqlite'] },
    { type: 'Build / deploy / types', label: 'Build, deploy, and TypeScript', items: ['wrangler', 'esbuild', 'typescript', '@types/node', '@types/pg'] }
  ],
  render: [
    { type: 'Runtime / API', label: 'Render Node runtime and API', items: ['hono', '@hono/node-server'] },
    { type: 'Extraction / HTML parsing', label: 'Extraction and HTML parsing', items: ['cheerio', 'linkedom', 'undici'] },
    { type: 'Browser rendering / crawling', label: 'Browser engines and crawling', items: ['playwright', 'puppeteer', 'crawlee'] },
    { type: 'Data import / backup', label: 'Data import, export, backup', items: ['read-excel-file', 'fflate'] },
    { type: 'Storage', label: 'Render storage', items: ['pg', 'node:sqlite fallback'] },
    { type: 'Build / deploy / types', label: 'Build tools', items: ['esbuild', 'typescript'] }
  ],
  vps: [
    { type: 'System packages', label: 'VPS system packages', items: ['git', 'curl', 'nginx', 'build-essential', 'postgresql', 'nodejs'] },
    { type: 'Node scraper libraries', label: 'Node scraping stack', items: ['hono', '@hono/node-server', 'cheerio', 'linkedom', 'undici', 'playwright', 'puppeteer', 'crawlee', 'read-excel-file', 'fflate', 'pg'] },
    { type: 'Storage', label: 'VPS storage', items: ['PostgreSQL', 'node:sqlite fallback'] }
  ],
  'termux-offline': [
    { type: 'Termux system packages', label: 'Termux system packages', items: ['git', 'gh', 'openssh', 'nodejs-lts', 'python', 'make', 'clang', 'chromium'] },
    { type: 'Node scraping runtime', label: 'npm libraries that run in Termux', items: ['hono', '@hono/node-server', 'cheerio', 'linkedom', 'undici', 'playwright', 'puppeteer', 'crawlee', 'read-excel-file', 'fflate', 'pg'] },
    { type: 'Storage', label: 'Termux storage', items: ['node:sqlite', 'PostgreSQL optional'] }
  ],
  vercel: [
    { type: 'Serverless runtime', label: 'Vercel/serverless compatible', items: ['Node runtime', 'hono', 'cheerio', 'linkedom', 'undici'] },
    { type: 'Not suitable for long-running jobs', label: 'Use Render/VPS for these', items: ['Playwright runtime', 'Puppeteer runtime', 'long crawler workers'] }
  ],
  deployer: [
    { type: 'Node built-ins', label: 'Local deployer runtime', items: ['node:http', 'node:child_process', 'node:fs', 'node:path', 'node:crypto'] },
    { type: 'Managed project deps', label: 'Installed for scraper by deployer', items: ['package.json dependencies', 'Playwright browser install', 'Puppeteer browser install', 'Termux chromium pkg','Basalam SDK install (npm run basalam:install)'] }
  ]
};
function installedLibraryGroups(envId = 'vscode') {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const groups = INSTALLED_LIBRARY_GROUPS_BY_ENV[envId] || INSTALLED_LIBRARY_GROUPS_BY_ENV.vscode;
  return groups.map(group => ({
    ...group,
    items: group.items.map(name => ({ name, installed: Boolean(deps[name]) || name.includes('runtime') || name.startsWith('Cloudflare ') || name.startsWith('node:') || !/^[a-z@][a-z0-9@/_-]*$/i.test(name), version: deps[name] || '' }))
  }));
}
function installedLibraryCatalog() {
  return Object.fromEntries(Object.keys(INSTALLED_LIBRARY_GROUPS_BY_ENV).map(env => [env, installedLibraryGroups(env)]));
}
let port = Number(process.env.DEPLOYER_UI_PORT || process.env.PORT || 8790);
const host = process.env.DEPLOYER_UI_HOST || '0.0.0.0';
const token = process.env.DEPLOYER_UI_TOKEN || randomBytes(18).toString('base64url');
const scraperPort = Number(process.env.SCRAPER_PORT || 3000);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Termux/Android cannot run several install scripts (puppeteer Chrome
// download, wrangler workerd setup) and npm aborts the WHOLE install when one
// fails — leaving node_modules half-written and every update stuck on old
// code. The Termux guides already mandate --ignore-scripts; every AUTOMATED
// install below must do the same. esbuild (the one install script the build
// needs) is repaired right after via scripts/esbuild-check.mjs.
const isTermuxInstall = process.platform === 'android' || Boolean(process.env.TERMUX_VERSION) || /com\.termux/i.test(String(process.env.PREFIX || ''));
const npmInstallArgs = isTermuxInstall ? ['install', '--ignore-scripts', '--no-audit', '--prefer-online'] : ['install', '--no-audit', '--prefer-online'];
const scraperCommand = process.env.LOCAL_SCRAPER_COMMAND || `${npmCommand} run render:build && ${npmCommand} run render:start`;
// Settings saved by the UI live in .env.local, so they must be read back on
// startup - otherwise "scan every 30 minutes" silently reverted to the default
// after every restart (and the deployer restarts itself after each install).
const startupEnv = { ...parseDotEnvFile(join(projectDir, '.env.local')), ...process.env };
const MIN_BRANCH_SCAN_INTERVAL_MS = 15_000;
const DEFAULT_BRANCH_SCAN_INTERVAL_MS = 60_000; // default: scan all repo branches every 1 minute
// A page refresh triggers a scan too, but never more often than this.
const REFRESH_SCAN_MIN_MS = 10_000;
function readIntervalMs(value, fallback = DEFAULT_BRANCH_SCAN_INTERVAL_MS) {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback; // ignore garbage instead of turning the timer into NaN
  if (parsed === 0) return 0;                                  // 0 means "never scan automatically"
  return Math.max(MIN_BRANCH_SCAN_INTERVAL_MS, Math.round(parsed));
}
// 0 / no / off are what people actually type in a shell profile; only 'false' used to work, so
// `LOCAL_DEPLOYER_AUTO_UPDATE=0` left the branch scanner running git operations on a timer.
const autoUpdateEnabled = !/^(?:false|0|no|off)$/i.test(String(startupEnv.LOCAL_DEPLOYER_AUTO_UPDATE ?? 'true').trim());
let branchScanIntervalMs = readIntervalMs(startupEnv.LOCAL_DEPLOYER_SCAN_INTERVAL_MS || startupEnv.LOCAL_DEPLOYER_AUTO_UPDATE_MS);
let autoInstallLatestEnabled = startupEnv.LOCAL_DEPLOYER_AUTO_INSTALL_LATEST !== 'false';
let autoUpdateRunning = false;
let lastAutoUpdate = null;
let lastDirtySkipLogged = -1;
let lastUnpushedSkipLogged = -1;
// A background deployer has to reach the operating system, not only its own log: every scan that
// finds a newer version announces it once, through whichever notifier this platform has (see
// scripts/deployer-notify.mjs). LOCAL_DEPLOYER_NOTIFY=0 turns that off; the page keeps announcing
// through the browser Notifications API, which lands in the same OS notification centre.
const notifyEnabled = notifyEnabledFor(startupEnv.LOCAL_DEPLOYER_NOTIFY);
const notifyChannel = pickNotifyChannel({ env: startupEnv });
// Which events were already announced, so a one-minute scanner cannot spam the same notice. The
// ledger is a file, not a Set that dies with the process: a watchdog that restarts the deployer must
// not wake the phone for a release that was already announced, and «the last notices» should still be
// there after an update. LOCAL_DEPLOYER_NOTIFY_STATE moves it (tests, or a read-only checkout).
const notifyStateFile = resolve(startupEnv.LOCAL_DEPLOYER_NOTIFY_STATE || join(projectDir, 'data', '.deployer-notices.json'));
function readNotifyState() {
  try {
    const raw = JSON.parse(readFileSync(notifyStateFile, 'utf8'));
    return {
      seen: Array.isArray(raw.seen) ? raw.seen.map(String).filter(Boolean) : [],
      recent: Array.isArray(raw.recent) ? raw.recent.filter(entry => entry && entry.key) : []
    };
  } catch {
    return { seen: [], recent: [] };
  }
}
const notifyStored = readNotifyState();
const notifySeen = new Set(notifyStored.seen.slice(-200));
const notifyLog = notifyStored.recent.slice(0, 20);
function saveNotifyState() {
  if (!notifyEnabled) return;
  try {
    mkdirSync(resolve(notifyStateFile, '..'), { recursive: true });
    writeFileSync(notifyStateFile, JSON.stringify({ seen: [...notifySeen].slice(-200), recent: notifyLog }, null, 2) + '\n', { mode: 0o600 });
  } catch (error) {
    console.log('[deployer] could not store the notice ledger: ' + (error && error.message ? error.message : error));
  }
}
let branchScannerTimer = null;
const branchMetaCache = new Map(); // branch name -> { sha, version, hasCode }
const branchState = { scanning: false, lastScanAt: null, lastScanMs: null, lastScanError: null, lastAction: null, branches: [], latest: null, current: null, origin: null };
function shellValue(command, args = []) {
  const result = spawnSync(command, args, { cwd: projectDir, encoding: 'utf8', env: process.env });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}
function commandPath(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [command], { encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout || '').trim().split(/\r?\n/)[0] : '';
}
function commandExists(command) { return Boolean(commandPath(command)); }
function currentOsUser() {
  return process.env.USER || process.env.LOGNAME || process.env.USERNAME || shellValue('whoami') || 'postgres';
}
function termuxDatabaseUrl() {
  return `postgresql://${currentOsUser()}@localhost:5432/scraper4`;
}
function dockerDatabaseUrl() {
  return 'postgresql://postgres:postgres@localhost:5432/scraper4';
}
function normalizeDatabaseUrl(value = '') {
  const detected = detectEnvironment();
  const raw = String(value || '').trim();
  const hasPlaceholder = /@HOST(?::|\/|$)/i.test(raw);
  const usesBuiltInSqlite = !raw || /^(sqlite:|file:)/i.test(raw);
  if (usesBuiltInSqlite) {
    // No external database configured: the built-in Node.js SQLite file is the
    // local/Termux/Windows default (render-src/db.ts opens data/scraper4.sqlite).
    // Termux is included on purpose. It used to be forced onto a local
    // PostgreSQL, but a stock phone has no postgres server, so every refresh
    // failed with connect ECONNREFUSED 127.0.0.1:5432 and the status light
    // never turned green. PostgreSQL stays available when the user configures
    // it explicitly (the branch below keeps any real URL untouched).
    return detected.id === 'windows' || detected.id === 'termux' || detected.method === 'sqlite' ? 'sqlite:data/scraper4.sqlite' : '';
  }
  // A Termux install that still carries the @HOST placeholder gets SQLite too,
  // rather than a postgres URL that cannot connect.
  if (detected.id === 'termux' && hasPlaceholder) return 'sqlite:data/scraper4.sqlite';
  if (hasPlaceholder) {
    // DATABASE_URL still contains the literal placeholder HOST. Machines that
    // cannot run Docker/PostgreSQL (e.g. Windows) fall back to built-in SQLite.
    if (detected.id === 'windows' || detected.method === 'sqlite') return 'sqlite:data/scraper4.sqlite';
    return dockerDatabaseUrl();
  }
  return raw;
}
function parseDotEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    out[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}
function localEnv() { return { ...parseDotEnvFile(join(projectDir, '.env.local')), ...process.env }; }
function saveLocalEnv(patch) {
  const current = parseDotEnvFile(join(projectDir, '.env.local'));
  const next = { ...current, ...patch };
  writeFileSync(join(projectDir, '.env.local'), Object.entries(next).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
  return next;
}
function detectEnvironment() {
  const env = process.env;
  const prefix = String(env.PREFIX || '');
  if (env.CODESPACES === 'true') return { id: 'codespaces', label: 'GitHub Codespaces', canInstallDatabase: true, method: 'docker' };
  if (/com\.termux|\/data\/data\/com\.termux/i.test(prefix + projectDir)) return { id: 'termux', label: 'Termux / Android', canInstallDatabase: true, method: 'termux-postgresql' };
  if (env.RENDER || env.RENDER_SERVICE_ID) return { id: 'render', label: 'Render', canInstallDatabase: false, method: 'panel' };
  if (env.VERCEL || env.VERCEL_ENV) return { id: 'vercel', label: 'Vercel', canInstallDatabase: false, method: 'panel' };
  if (process.platform === 'win32') return { id: 'windows', label: 'Windows local', canInstallDatabase: true, method: 'sqlite' };
  if (existsSync('/.dockerenv')) return { id: 'desktop', label: 'Local desktop / VPS (container)', canInstallDatabase: true, method: 'manual' };
  return { id: 'desktop', label: 'Local desktop / VPS', canInstallDatabase: true, method: commandExists('docker') ? 'docker' : 'sqlite' };
}
function databaseInstallPlan() {
  const detected = detectEnvironment();
  if (detected.id === 'termux') return {
    ...detected,
    command: `pkg install -y postgresql && mkdir -p "$PREFIX/var/lib/postgresql" && ([ -f "$PREFIX/var/lib/postgresql/PG_VERSION" ] || initdb "$PREFIX/var/lib/postgresql") && (pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$HOME/scraper4-postgres.log" start || true) && sleep 2 && (createdb scraper4 || true) && node -e "import {writeFileSync} from 'node:fs';import {execSync} from 'node:child_process';const user=execSync('whoami').toString().trim();writeFileSync('.env.local', 'DATABASE_URL=postgresql://'+user+'@localhost:5432/scraper4\\nRUN_WORKER_IN_WEB=true\\n');console.log('Wrote .env.local for Termux PostgreSQL (optional) user '+user+'. Do not use postgres:postgres on Termux unless you created that role manually.')"`,
    instructions: 'Termux can install PostgreSQL with pkg. If pkg cannot find postgresql, use a remote PostgreSQL and put its DATABASE_URL in .env.local.'
  };
  if (detected.method === 'docker') return {
    ...detected,
    command: `docker rm -f scraper4-postgres >/dev/null 2>&1 || true; docker run --name scraper4-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=scraper4 -p 5432:5432 -d postgres:16 && node -e "import {writeFileSync} from 'node:fs';writeFileSync('.env.local','DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scraper4\\nRUN_WORKER_IN_WEB=true\\n');console.log('Wrote .env.local for Docker PostgreSQL')"`,
    instructions: 'Docker PostgreSQL will be started on localhost:5432 and .env.local will be written automatically.'
  };
  if (detected.method === 'sqlite') return {
    ...detected,
    command: '',
    sqlite: true,
    databaseUrl: 'sqlite:data/scraper4.sqlite',
    instructions: detected.id === 'windows'
      ? 'Windows: the deployer now uses the SQLite database built into Node.js — nothing extra to install and no PostgreSQL service/pg_hba/Docker setup. This button creates the data folder and writes DATABASE_URL=sqlite:data/scraper4.sqlite into .env.local, so you can start the local scraper immediately. If you already have a managed PostgreSQL, put its URL in .env.local instead.'
      : 'No Docker/PostgreSQL is available on this machine, so the built-in Node.js SQLite database is used. This button creates the data folder and writes DATABASE_URL=sqlite:data/scraper4.sqlite into .env.local. To use PostgreSQL instead, install Docker or set DATABASE_URL to a managed PostgreSQL URL.'
  };
  return {
    ...detected,
    command: '',
    instructions: detected.id === 'render'
      ? 'Render: create New → PostgreSQL, copy Internal Database URL, add it to the web service Environment as DATABASE_URL, set RUN_WORKER_IN_WEB=true, then redeploy.'
      : detected.id === 'vercel'
        ? 'Vercel/serverless is not recommended for the long-running scraper. Use Render/VPS, or attach a managed PostgreSQL and set DATABASE_URL in Environment Variables.'
        : 'Install PostgreSQL manually or use a managed PostgreSQL URL. Then create .env.local with DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/scraper4'
  };
}
const maxLog = 120_000;
const jobs = new Map();
let scraper = null;
const scraperKeepalive = createScraperKeepalive({
  probe: () => scraperIsListening(1500),
  restart: () => { if(scraper?.running)stopScraper(false); const result=startScraper(0,true); if(!result?.running)throw Error('Scraper could not start'); },
  log: text => { scraperLog=(scraperLog+'[local scraper] '+text+'\n').slice(-maxLog); }
},{enabled: !/^(false|0|no|off)$/i.test(String(startupEnv.LOCAL_SCRAPER_KEEPALIVE??'true'))});

let scraperLog = '';

function appendLog(name, chunk) {
  const job = jobs.get(name);
  if (!job) return;
  job.log += chunk;
  if (job.log.length > maxLog) job.log = job.log.slice(-maxLog);
}


function runSync(command, args = []) {
  const result = spawnSync(command, args, { cwd: projectDir, encoding: 'utf8', env: process.env });
  return {
    command: [command, ...args].join(' '),
    status: result.status ?? 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    ok: (result.status ?? 0) === 0
  };
}

function currentGitInfo() {
  const branch = runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const commit = runSync('git', ['log', '-1', '--oneline']);
  const dirty = runSync('git', ['status', '--short']);
  return {
    branch: branch.ok ? branch.stdout.trim() : '',
    commit: commit.ok ? commit.stdout.trim() : '',
    dirty: dirty.ok ? dirty.stdout.trim() : '',
    ok: branch.ok && commit.ok && dirty.ok
  };
}

function gitSha(ref = 'HEAD') {
  const result = runSync('git', ['rev-parse', ref]);
  return result.ok ? result.stdout.trim() : '';
}


function updateFromGit({ branch, force = false, install = false } = {}) {
  const current = currentGitInfo();
  const target = (branch && String(branch).trim()) || current.branch || 'arena/01a09468-new';
  const before = gitSha('HEAD');
  const steps = [];
  steps.push({ ...runSync('git', ['config', '--local', '--unset-all', 'credential.helper']), optional: true, ok: true });
  steps.push(runSync('git', ['config', '--local', '--replace-all', 'credential.helper', '!gh auth git-credential']));
  steps.push(runSync('gh', ['auth', 'setup-git']));
  steps.push(runSync('git', ['fetch', 'origin', target]));
  if (!steps.at(-1).ok) {
    const hint = originRemoteUrl()
      ? 'If Termux still asks for a GitHub password, run: gh auth setup-git && git config --local --replace-all credential.helper "!gh auth git-credential"'
      : missingOriginMessage('update from GitHub') + ' Then press Update now again.';
    return { ok: false, branch: target, steps, hint };
  }
  const remote = gitSha(`origin/${target}`);
  if (current.ok && current.branch && target !== current.branch) {
    // Switch the local checkout to the requested remote branch, reset to its tip.
    steps.push(runSync('git', ['checkout', '-B', target, `origin/${target}`]));
  } else {
    steps.push(force
      ? runSync('git', ['reset', '--hard', `origin/${target}`])
      : runSync('git', ['pull', '--ff-only', 'origin', target]));
  }
  const after = gitSha('HEAD');
  const changed = Boolean(before && after && before !== after);
  if (install && changed && steps.at(-1).ok) {
    steps.push(runSync(npmCommand, npmInstallArgs));
    steps.push(runSync(process.execPath, ['scripts/esbuild-check.mjs']));
  }
  return { ok: steps.every(step => step.ok), branch: target, force, install, changed, before, remote, after: gitSha('HEAD'), steps, git: currentGitInfo() };
}

function autoUpdateFromGit({ branch, reason = 'timer', force = true, install = true } = {}) {
  if (!autoUpdateEnabled || autoUpdateRunning) return null;
  // A background timer must never run `git reset --hard` over local work: that
  // silently deletes uncommitted edits with no way back. Skip the automatic
  // update while the tree is dirty and say so; the manual button still works.
  // package-lock.json is rewritten by `npm install` itself (the deployer runs it
  // on every install/update), so it is machine churn rather than user work. If
  // it were counted as "local work", the auto-update would be permanently
  // blocked on any device that has ever installed dependencies -- which is every
  // device -- and the user would silently keep running old code. Restore it and
  // ignore it; every other dirty path still pauses the update.
  // Files git tracks but a build regenerates byte-for-byte. These are machine
  // churn, never user work, so they are restored instead of blocking forever.
  const GENERATED = /(?:^|\/)(?:package-lock\.json|scraper4\.worker\.js|scraper4\.ts)$/;
  const dirtyProbe = runSync('git', ['status', '--porcelain', '--untracked-files=no']);
  if (dirtyProbe.ok && dirtyProbe.stdout.trim()) {
    const dirtyPaths = dirtyProbe.stdout.split('\n')
      .map(line => (line.match(/^..\s+(.*)$/) || [])[1] || '')
      .map(path => path.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
    const generated = dirtyPaths.filter(path => GENERATED.test(path));
    // Only restore when EVERY change is generated: if the user also edited real
    // source, nothing is touched and the update still pauses as before.
    if (generated.length && generated.length === dirtyPaths.length) {
      // `git status --porcelain` prints paths relative to the REPO ROOT, but
      // runSync executes in the project subdirectory, so a bare path fails with
      // "pathspec did not match". The ':/' prefix makes each path repo-root
      // relative regardless of the working directory.
      runSync('git', ['checkout', '--', ...generated.map(path => `:/${path}`)]);
    }
  }
  // Untracked files are excluded deliberately: `git reset --hard` leaves them
  // alone, so they are never at risk and must never pause the update.
  const dirty = runSync('git', ['status', '--porcelain', '--untracked-files=no']);
  if (dirty.ok && dirty.stdout.trim()) {
    const files = dirty.stdout.trim().split('\n').length;
    lastAutoUpdate = {
      ok: false, reason, at: new Date().toISOString(), skipped: 'dirty-worktree',
      error: `Auto-update skipped: ${files} uncommitted change(s) in the working tree. Commit or stash them, then press Update now.`,
    };
    if (lastDirtySkipLogged !== files) {
      lastDirtySkipLogged = files;
      console.log(`[deployer] auto-update paused: ${files} uncommitted change(s) would be lost by git reset --hard. Commit or stash to resume.`);
    }
    return lastAutoUpdate;
  }
  lastDirtySkipLogged = -1;
  // A clean tree is not enough: `git reset --hard origin/<branch>` also destroys
  // commits that exist only locally. Refuse to discard unpushed history.
  // Compare against the exact reset target (origin/<branch>), not @{upstream}:
  // this branch often has no upstream configured, and a failed lookup must not
  // be read as "nothing to lose".
  const head = runSync('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const localBranch = head.ok ? head.stdout.trim() : '';
  const target = branch || localBranch;
  runSync('git', ['fetch', 'origin', target]);
  const ahead = target ? runSync('git', ['rev-list', '--count', `origin/${target}..HEAD`]) : { ok: false, stdout: '' };
  const unpushed = ahead.ok ? Number(ahead.stdout.trim()) || 0 : 0;
  if (unpushed > 0) {
    lastAutoUpdate = {
      ok: false, reason, at: new Date().toISOString(), skipped: 'unpushed-commits',
      error: `Auto-update skipped: ${unpushed} local commit(s) are not pushed yet and would be lost. Push them, then press Update now.`,
    };
    if (lastUnpushedSkipLogged !== unpushed) {
      lastUnpushedSkipLogged = unpushed;
      console.log(`[deployer] auto-update paused: ${unpushed} unpushed commit(s) would be lost by git reset --hard. Push them to resume.`);
    }
    return lastAutoUpdate;
  }
  lastUnpushedSkipLogged = -1;
  autoUpdateRunning = true;
  try {
    const result = updateFromGit({ branch, force, install });
    lastAutoUpdate = { reason, at: new Date().toISOString(), ...result };
    if (result.ok && result.changed) {
      console.log(`Auto-updated from GitHub to ${result.branch} (${result.before} -> ${result.after}); rebuilding scraper and restarting deployer UI...`);
      restartUiSoon({ restartScraper: scraperWasRunning() });
    }
    return result;
  } catch (error) {
    lastAutoUpdate = { ok: false, reason, at: new Date().toISOString(), error: error?.message || String(error) };
    return null;
  } finally {
    autoUpdateRunning = false;
  }
}

// ---------------------------------------------------------------------------
// All-branch scanning + newest-version auto install
// ---------------------------------------------------------------------------
const SCRAPER_PACKAGE_PATH = 'cloudflare-scraper4/package.json';
// Branch scanning/installing always tracks this repo through the 'origin'
// remote. Checkouts without it (copied .git folders, removed remotes) fail
// every fetch with: fatal: 'origin' does not appear to be a git repository.
const UPSTREAM_REPO_URL = 'https://github.com/fazilatma/new.git';

function originRemoteUrl() {
  const probe = runSync('git', ['remote', 'get-url', 'origin']);
  return probe.ok ? String(probe.stdout || '').trim() : '';
}
function missingOriginMessage(action) {
  return `Cannot ${action}: this checkout has no 'origin' remote, so 'git fetch origin' fails. Press "Repair origin remote" in the Branches panel, or run: git remote add origin ${UPSTREAM_REPO_URL}`;
}

function semverParts(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || '').trim());
  return m ? m.slice(1, 4).map(Number) : null;
}
function compareSemver(a, b) {
  const pa = semverParts(a), pb = semverParts(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1; }
  return 0;
}

function branchMetaFor(ref) {
  // ref: { name, sha, date } with name already stripped of the origin/ prefix.
  const hit = branchMetaCache.get(ref.name);
  if (hit && hit.sha === ref.sha) return hit;
  const entry = { branch: ref.name, sha: ref.sha, date: ref.date || '', hasCode: false, version: null };
  const show = runSync('git', ['show', `origin/${ref.name}:${SCRAPER_PACKAGE_PATH}`]);
  if (show.ok) {
    entry.hasCode = true;
    const versionMatch = String(show.stdout).match(/"version"\s*:\s*"([^"]+)"/);
    entry.version = versionMatch ? versionMatch[1] : null;
  }
  branchMetaCache.set(ref.name, entry);
  return entry;
}

function chooseLatestBranch(codeBranches) {
  let best = null;
  for (const b of codeBranches) {
    if (!b.hasCode || !b.version) continue;
    if (!best) { best = b; continue; }
    const cmp = compareSemver(b.version, best.version);
    if (cmp > 0 || (cmp === 0 && String(b.date || '') > String(best.date || ''))) best = b;
  }
  return best;
}

function branchCatalogPayload() {
  return {
    ok: true,
    enabled: autoUpdateEnabled,
    scanning: branchState.scanning,
    intervalMs: branchScanIntervalMs,
    autoInstallLatestEnabled,
    lastScanAt: branchState.lastScanAt,
    lastScanMs: branchState.lastScanMs,
    lastScanError: branchState.lastScanError,
    lastAction: branchState.lastAction,
    origin: branchState.origin,
    current: branchState.current || null,
    latest: branchState.latest || null,
    branches: branchState.branches || [],
    installed: {
      branch: (branchState.current && branchState.current.branch) || currentGitInfo().branch || '',
      version: pkg.version || '',
      sha: gitSha('HEAD') || ''
    }
  };
}

function scanAllBranches(reason = 'manual') {
  if (branchState.scanning) return branchCatalogPayload();
  branchState.scanning = true;
  const startedAt = Date.now();
  try {
    const cur = currentGitInfo();
    if (!cur.ok) throw new Error('This folder is not a git checkout of fazilatma/new, so branches cannot be scanned.');
    const originUrl = originRemoteUrl();
    branchState.origin = { present: Boolean(originUrl), url: originUrl };
    if (!originUrl) throw new Error(missingOriginMessage('scan branches'));
    const head = gitSha('HEAD') || '';
    // 1) Fetch every remote branch (incremental, keeps the fetch small).
    const fetch = runSync('git', ['fetch', 'origin', '--prune', '--quiet', '+refs/heads/*:refs/remotes/origin/*']);
    if (!fetch.ok) {
      if (!originRemoteUrl()) throw new Error(missingOriginMessage('scan branches'));
      throw new Error('git fetch origin (all branches) failed: ' + String(fetch.stderr || fetch.stdout || '').trim() +
        ` (origin is ${originUrl}; check the remote URL with 'git remote -v', plus network access and GitHub credentials).`);
    }
    // 2) Enumerate remote branches.
    const refsOut = runSync('git', ['for-each-ref', '--format=%(refname:short)%00%(objectname)%00%(creatordate:iso8601)', 'refs/remotes/origin']);
    const refs = [];
    if (refsOut.ok) {
      for (const line of String(refsOut.stdout || '').split('\n')) {
        const [full, sha, date] = line.trim().split('\0');
        const name = full && full.startsWith('origin/') ? full.slice('origin/'.length) : full;
        if (name && name !== 'HEAD' && sha) refs.push({ name, sha, date: date || '' });
      }
    }
    // 3) Version of the scraper code on each branch (cached by commit sha).
    const branches = refs.map(ref => ({ ...branchMetaFor(ref), name: ref.name, sha: ref.sha, date: ref.date || '', isCurrent: ref.name === cur.branch, isLatest: false }));
    const current = { branch: cur.branch || '', sha: head, version: pkg.version || '', hasCode: true };
    const codeBranches = branches.filter(b => b.hasCode && b.version);
    const latest = chooseLatestBranch(codeBranches);
    for (const b of branches) b.isLatest = Boolean(latest && b.name === latest.name);
    branchState.branches = branches;
    branchState.latest = latest;
    branchState.current = current;
    branchState.lastScanAt = new Date().toISOString();
    branchState.lastScanMs = Date.now() - startedAt;
    branchState.lastScanError = null;
    // Announcing is a side quest of the scan: it must not change what the scan reports, and a slow
    // or missing notifier must not delay the table or the auto-install.
    announceVersions({ reason }).catch(error => console.log('[deployer] notification pass failed: ' + (error?.message || error)));
    if (reason !== 'timer') console.log(`[deployer] branch scan (${reason}): ${branches.length} branch(es), newest ${latest ? latest.name + ' v' + latest.version : '-'}`);
    return branchCatalogPayload();
  } catch (error) {
    branchState.lastScanError = error?.message || String(error);
    return branchCatalogPayload();
  } finally {
    branchState.scanning = false;
  }
}

// Sends one notification per newly noticed event. Fire-and-forget by design: a machine without a
// notifier, or one where notify-send hangs, must never stall a scan or an auto-install.
async function announceVersions({ reason = 'scan' } = {}) {
  if (!notifyEnabled) return { ok: false, skipped: 'disabled', sent: [] };
  const pending = pendingNotices({
    branchState,
    code: staleCode(),
    installedVersion: (branchState.current && branchState.current.version) || pkg.version || '',
    seen: notifySeen
  });
  const sent = [];
  for (const notice of pending) {
    notifySeen.add(notice.key);
    const result = await sendNotification(notifyChannel, notice.title, notice.body);
    pushNotice(notifyLog, { at: new Date().toISOString(), reason, key: notice.key, kind: notice.kind, title: notice.title, body: notice.body, ...result });
    console.log('[deployer] new version noticed (' + notice.kind + ') via ' + (notifyChannel ? notifyChannel.id : 'no notifier') + ': ' + notice.title + (result.ok ? '' : ' [' + result.error + ']'));
    sent.push({ key: notice.key, kind: notice.kind, ok: Boolean(result.ok), channel: result.channel, error: result.error || '' });
  }
  if (sent.length) saveNotifyState();
  return { ok: true, sent, announced: sent.length, restored: notifyStored.seen.length };
}
function notifyPayload() {
  return {
    enabled: notifyEnabled,
    channel: notifyChannel ? { id: notifyChannel.id, label: notifyChannel.label } : null,
    seen: notifySeen.size,
    restored: notifyStored.seen.length,
    file: notifyStateFile.startsWith(projectDir + '/') ? notifyStateFile.slice(projectDir.length + 1) : notifyStateFile,
    recent: notifyLog.slice(0, 10)
  };
}

function maybeAutoInstallNewest() {
  if (!autoInstallLatestEnabled || autoUpdateRunning || branchState.scanning) return;
  const latest = branchState.latest;
  const current = branchState.current || {};
  if (!latest || !latest.hasCode || !latest.version) return;
  const installed = current.version || pkg.version || '';
  const currentHasCode = Boolean(current.hasCode) && semverParts(installed) !== null;
  if (latest.name === current.branch) {
    // Current branch already carries the newest version: refresh if behind its remote tip.
    const head = gitSha('HEAD') || '';
    if (latest.sha && head && latest.sha !== head) {
      console.log(`[deployer] newest version stays on current branch ${latest.name}; pulling the newest commit...`);
      autoUpdateFromGit({ branch: latest.name, reason: 'same-branch-refresh' });
    }
    return;
  }
  if (!currentHasCode || compareSemver(latest.version, installed) > 0) {
    branchState.lastAction = {
      type: 'auto-install-newest',
      at: new Date().toISOString(),
      from: current.branch || '',
      fromVersion: currentHasCode ? installed : '(no code installed)',
      to: latest.name,
      toVersion: latest.version
    };
    console.log(`[deployer] branch ${latest.name} has the newest version ${latest.version} (installed: ${installed || 'none'}); installing it automatically...`);
    autoUpdateFromGit({ branch: latest.name, reason: 'newest-version' });
  }
}

function repairOriginRemote() {
  const existing = originRemoteUrl();
  if (existing) {
    // Nothing to repair: rescan so the table reflects the current state.
    const payload = scanAllBranches('repair');
    return { ...payload, repair: { repaired: false, url: existing, message: `The 'origin' remote is already set to ${existing}; rescanned instead.` } };
  }
  // Config-only change: it touches no branch, file, or commit, so a single
  // click is safe (no two-step guard needed, unlike branch installs).
  const add = runSync('git', ['remote', 'add', 'origin', UPSTREAM_REPO_URL]);
  if (!add.ok) {
    const detail = String(add.stderr || add.stdout || '').trim();
    return { ...branchCatalogPayload(), repair: { repaired: false, url: '', message: `Could not add the 'origin' remote: ${detail || 'unknown git error'}` } };
  }
  console.log(`[deployer] added missing origin remote (-> ${UPSTREAM_REPO_URL}); rescanning branches...`);
  const payload = scanAllBranches('repair');
  return {
    ...payload,
    repair: {
      repaired: true,
      url: UPSTREAM_REPO_URL,
      message: payload.lastScanError
        ? `Origin remote added, but the rescan still fails: ${payload.lastScanError}`
        : `Origin remote added (-> ${UPSTREAM_REPO_URL}); ${payload.branches.length} branch(es) scanned.`
    }
  };
}

function scheduleBranchScanner() {
  if (branchScannerTimer) { clearInterval(branchScannerTimer); branchScannerTimer = null; }
  if (!autoUpdateEnabled || branchScanIntervalMs <= 0) return;
  branchScannerTimer = setInterval(() => { scanAllBranches('timer'); maybeAutoInstallNewest(); }, branchScanIntervalMs);
  if (branchScannerTimer.unref) branchScannerTimer.unref();
  const firstRun = setTimeout(() => { scanAllBranches('startup'); maybeAutoInstallNewest(); }, 3000);
  if (firstRun.unref) firstRun.unref();
}

function updateBranchConfig({ intervalSeconds, autoInstallLatest } = {}) {
  const seconds = Number(intervalSeconds);
  if (Number.isFinite(seconds) && seconds >= 0) {
    // intervalSeconds is seconds; 0 disables the timer, otherwise clamp to a 15s floor.
    branchScanIntervalMs = readIntervalMs(seconds * 1000, branchScanIntervalMs);
  }
  if (typeof autoInstallLatest === 'boolean') autoInstallLatestEnabled = autoInstallLatest;
  try {
    saveLocalEnv({
      LOCAL_DEPLOYER_SCAN_INTERVAL_MS: String(branchScanIntervalMs),
      LOCAL_DEPLOYER_AUTO_INSTALL_LATEST: autoInstallLatestEnabled ? 'true' : 'false'
    });
  } catch { /* .env.local is optional */ }
  scheduleBranchScanner();
  return branchCatalogPayload();
}

function databasePlanLabel(plan) {
  if (plan.method === 'sqlite') return plan.id === 'windows' ? 'SQLite built-in (Windows default - no PostgreSQL)' : 'SQLite built-in (no Docker/PostgreSQL)';
  if (plan.method === 'docker') return 'PostgreSQL via Docker';
  if (plan.method === 'termux-postgresql') return 'PostgreSQL on Termux';
  return 'PostgreSQL (manual / panel)';
}

/** True when a scraper process is currently alive (exitCode stays null while running). */
function scraperWasRunning() { return Boolean(scraper && scraper.child && scraper.exitCode === null); }

function restartUiSoon({ restartScraper = false } = {}) {
  setTimeout(() => {
    if(startupEnv.DEPLOYER_SUPERVISED==='true'){scraperKeepalive.close();stopScraper();server.close(()=>process.exit(75));return;}
    const child = spawn(process.execPath, [process.argv[1]], {
      cwd: projectDir,
      detached: true,
      stdio: 'ignore',
      // The successor deployer autostarts the scraper, which runs render:build
      // first, so the freshly pulled code is compiled without any user action.
      env: {
        ...process.env,
        DEPLOYER_UI_PORT: String(port),
        DEPLOYER_UI_HOST: host,
        DEPLOYER_UI_TOKEN: token,
        ...(restartScraper ? { LOCAL_SCRAPER_AUTOSTART: 'true' } : {})
      }
    });
    child.unref();
    stopScraper();
    server.close(() => process.exit(0));
  }, 800);
}

function runJob(name, command, args = [], options = {}) {
  const existing = jobs.get(name);
  if (existing?.running) return existing;
  const job = { name, command: [command, ...args].join(' '), running: true, exitCode: null, startedAt: new Date().toISOString(), finishedAt: null, log: '' };
  jobs.set(name, job);
  const child = spawn(command, args, { cwd: projectDir, shell: Boolean(options.shell), env: { ...process.env, ...options.env } });
  job.pid = child.pid;
  child.stdout.on('data', d => appendLog(name, d.toString()));
  child.stderr.on('data', d => appendLog(name, d.toString()));
  child.on('error', e => { appendLog(name, `\nERROR: ${e.message}\n`); job.running = false; job.exitCode = 1; job.finishedAt = new Date().toISOString(); });
  child.on('exit', code => { job.running = false; job.exitCode = code ?? 0; job.finishedAt = new Date().toISOString(); appendLog(name, `\n[process exited with code ${job.exitCode}]\n`); });
  return job;
}

// A scraper the deployer did not spawn (manual `npm run render:start`, or an
// orphan from a previous deployer) keeps holding the port after an update, so
// the fresh build crashes with EADDRINUSE and the box silently keeps serving
// the old release. Before starting, find whatever listens on the scraper port
// (Linux/Android via /proc) and stop it — but ONLY when its command line
// proves it is our own stale scraper; anything else is reported, never
// touched. Fail-open: any error means "unknown", and start proceeds as before.
function freeScraperPort() {
  const outcome = { freed: [], foreign: [], swept: [], tablesRead: false, tableError: '' };
  try {
    if (process.platform !== 'linux' && process.platform !== 'android') return outcome;
    const want = Number(scraperPort).toString(16).toUpperCase().padStart(4, '0');
    const inodes = new Set();
    // Lab hook: DEPLOYER_PORT_SCAN_BLIND=1 skips the socket tables to prove
    // the command-line sweep below works where /proc/net is unreadable.
    const blindTables = Boolean(process.env.DEPLOYER_PORT_SCAN_BLIND);
    for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
      let text = '';
      try {
        if (blindTables) throw new Error('blind (DEPLOYER_PORT_SCAN_BLIND)');
        text = readFileSync(table, 'utf8');
        outcome.tablesRead = true;
      } catch (error) { if (!outcome.tableError) outcome.tableError = `${table}: ${error?.message || error}`; continue; }
      for (const line of text.split('\n').slice(1)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 10) continue;
        const local = String(parts[1] || ''), state = String(parts[3] || '');
        if (state !== '0A' || !local.toUpperCase().endsWith(':' + want)) continue;
        inodes.add(String(parts[9] || ''));
      }
    }
    if (inodes.size) for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      let fds = [];
      try { fds = readdirSync(`/proc/${pid}/fd`); } catch { continue; }
      let holds = false;
      for (const fd of fds) {
        let link = '';
        try { link = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
        const m = /^socket:\[(\d+)\]$/.exec(link);
        if (m && inodes.has(m[1])) { holds = true; break; }
      }
      if (!holds) continue;
      let cmd = '';
      try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim(); } catch { cmd = ''; }
      if (/render-dist\/server/.test(cmd)) {
        try {
          process.kill(Number(pid), 'SIGTERM');
          outcome.freed.push(Number(pid));
          const timer = setTimeout(() => { try { process.kill(Number(pid), 0); process.kill(Number(pid), 'SIGKILL'); } catch { /* exited */ } }, 4000);
          if (timer.unref) timer.unref();
        } catch { /* already gone */ }
      } else {
        outcome.foreign.push({ pid: Number(pid), cmd: cmd.slice(0, 160) });
      }
    }
    // Tables can be blind (unreadable /proc/net on some Android builds) while
    // the port is still held: also sweep our own server processes by command
    // line AND the PORT they were started with, so a sibling scraper on
    // another port is never touched. Anything else is left alone.
    const wantPort = `PORT=${scraperPort}`;
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      const id = Number(pid);
      if (id === process.pid || outcome.freed.includes(id)) continue;
      let cmd = '';
      try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim(); } catch { continue; }
      if (!/render-dist\/server/.test(cmd)) continue;
      let env = '';
      try { env = readFileSync(`/proc/${pid}/environ`, 'utf8'); } catch { continue; }
      if (!env.split('\0').includes(wantPort)) continue;
      try {
        process.kill(id, 'SIGTERM');
        outcome.freed.push(id);
        outcome.swept.push(id);
        const timer = setTimeout(() => { try { process.kill(id, 0); process.kill(id, 'SIGKILL'); } catch { /* exited */ } }, 4000);
        if (timer.unref) timer.unref();
      } catch { /* already gone */ }
    }
  } catch { /* fail-open: start proceeds and reports whatever happens */ }
  return outcome;
}

// One honest line for the scraper log: what the port scan saw and did. This
// is the remote diagnosis when a start still fails (blind tables? foreign
// holder? nothing found but the bind fails?).
function portScanSummary(portState) {
  const tables = portState.tablesRead ? 'tables ok' : `tables unreadable (${portState.tableError || 'unknown'})`;
  const parts = [`port ${scraperPort} scan: ${tables}`];
  if (portState.freed.length) parts.push(`stopped ours pid ${portState.freed.join(',')}${portState.swept.length === portState.freed.length ? ' (cmdline sweep)' : ''}`);
  for (const holder of portState.foreign) parts.push(`foreign pid ${holder.pid} (${(holder.cmd || 'unknown').slice(0, 60)}) left alone`);
  if (!portState.freed.length && !portState.foreign.length) parts.push('no holders found');
  return parts.join('; ');
}
function startScraper(retryDepth = 0, automatic = false) {
  if(!automatic)scraperKeepalive.enable();
  if (scraper?.running && scraper.child && scraper.exitCode === null) return scraper;
  // An EADDRINUSE retry is one story, not a new one: keep attempt #1 visible.
  if (retryDepth === 0 && !automatic) scraperLog = '';
  const portState = freeScraperPort();
  scraperLog += '[local scraper] ' + portScanSummary(portState) + '\n';
  if (portState.foreign.length) {
    const holder = portState.foreign[0];
    scraperLog += `[local scraper] Port ${scraperPort} is held by another program (pid ${holder.pid}: ${holder.cmd || 'unknown'}), not by a stale scraper — refusing to kill it. Stop that program or change PORT, then press Build & start again.\n`;
    scraper = { running: false, pid: null, startedAt: new Date().toISOString(), exitCode: null, child: null, blocked: 'port-held', port: scraperPort };
    return scraper;
  }
  const baseEnv = localEnv();
  // DEPLOYER_MANAGED tells the scraper a deployer will restart it (exit 75),
  // so when the checkout moves under it, it rebuilds and exits instead of
  // warning forever. A manually started scraper keeps warn-only behavior.
  const env = {
    ...baseEnv,
    PORT: String(scraperPort),
    DEPLOYER_MANAGED: 'true',
    DEPLOYER_UI_TOKEN: token,
    DEPLOYER_UI_PORT: String(port),
    RUN_WORKER_IN_WEB: baseEnv.RUN_WORKER_IN_WEB || 'true',
    LOCAL_SCRAPER_AUTO_UPDATE: baseEnv.LOCAL_SCRAPER_AUTO_UPDATE || 'true',
    DATABASE_URL: normalizeDatabaseUrl(baseEnv.DATABASE_URL)
  };
  // detached: the scraper gets its own process group so it keeps serving its own
  // URL after the deployer exits. Opening the scraper must never depend on the
  // deployer still running.
  const child = spawn(scraperCommand, { cwd: projectDir, shell: true, env, detached: true });
  // Do not hold the deployer's event loop open waiting on the scraper.
  child.unref();
  scraper = { running: true, pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, child, command: scraperCommand, port: scraperPort };
  const managed = scraper;
  scraperKeepalive.started();
  let sawEaddr = false;
  const add = d => {
    const text = d.toString();
    scraperLog += text;
    if (scraperLog.length > maxLog) scraperLog = scraperLog.slice(-maxLog);
    if (text.includes('EADDRINUSE')) sawEaddr = true;
  };
  for (const pid of portState.freed) add(`[local scraper] stopped stale scraper process ${pid} that was holding port ${scraperPort}\n`);
  add(`[local scraper] ${scraperCommand}\n[local scraper] PORT=${scraperPort} DATABASE_URL=${env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}\n\n`);
  child.stdout.on('data', add); child.stderr.on('data', add);
  child.on('exit', (code,signal) => {
    managed.running=false;managed.exitCode=code??0;managed.signal=signal||null;
    add('\n[scraper exited: code '+String(code)+'; signal '+String(signal||'none')+']\n');
    if(scraper!==managed||managed.intentionalStop)return;
    scraperKeepalive.exited(code===75?'Auto-update completed':sawEaddr?'Bind failed (EADDRINUSE)':'Unexpected exit: code '+String(code)+', signal '+String(signal||'none'));
  });
  child.on('error', e => { managed.running=false;managed.exitCode=1;add('\nERROR: '+e.message+'\n');if(scraper===managed&&!managed.intentionalStop)scraperKeepalive.exited('Process launch failed'); });
  return scraper;
}

function stopScraper(intentional = true) {
  if(intentional)scraperKeepalive.stop();
  if(scraper){scraper.intentionalStop=true;scraper.running=false;}
  if (scraper?.child && !scraper.child.killed) {
    // The scraper runs detached in its own process group (so it survives the
    // deployer), which means `npm` and the node server it spawns are children.
    // Signal the whole group with -pid, or Stop would only kill the shell and
    // leave the real server holding the port.
    try {
      if (process.platform === 'win32') runSync('taskkill', ['/pid', String(scraper.child.pid), '/t', '/f']);
      else process.kill(-scraper.child.pid, 'SIGTERM');
    } catch { scraper.child.kill('SIGTERM'); }
  }
  // The group signal can miss the real server (Termux: killing the shell
  // leaves the node grandchild holding the port). Reap by command line so a
  // stop is actually a stop; foreign holders are reported, never touched.
  const reaped = freeScraperPort();
  for (const pid of reaped.freed) scraperLog += `[local scraper] stopped stale scraper process ${pid} still holding port ${scraperPort}\n`;
  for (const holder of reaped.foreign) scraperLog += `[local scraper] port ${scraperPort} is also held by another program (pid ${holder.pid}), left running\n`;
  return scraper || { running: false };
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body, null, 2) : body);
}

async function readJson(req, maxBytes = Infinity) {
  let raw = '';
  let size=0;
  for await (const chunk of req) {size+=Buffer.byteLength(chunk);if(size>maxBytes)throw Error('Request body too large');raw+=chunk;}
  return raw ? JSON.parse(raw) : {};
}

// `npm run render:build && npm run render:start` needs a while before the port
// is listening -- on Termux/ARM that is tens of seconds. The proxy used to fire
// the request immediately after startScraper() and hand the user a raw
// ECONNREFUSED, which looked like the scraper was broken when it was merely
// still building. Buffer the request body, wait for the port, then forward.
function scraperIsListening(timeoutMs = 1500) {
  return new Promise(resolve => {
    const probe = http.request({ hostname: '127.0.0.1', port: scraperPort, path: '/', method: 'HEAD', timeout: timeoutMs }, response => { response.resume(); resolve(true); });
    const no = () => { probe.destroy(); resolve(false); };
    probe.on('timeout', no);
    probe.on('error', no);
    probe.end();
  });
}

// The process on the scraper port is often NOT this deployer's child (a manual
// start, or an orphan the previous deployer failed to stop), so the tracked
// `running` flag cannot say what localhost actually serves. Ask the port
// itself: /api/version reports the RUNNING build (version and git head are
// baked at boot), diskVersion()/gitSha() the checkout. Cached briefly so the
// 5s status poll stays cheap; force=true at boot and after (re)start decisions.
let servingCache = { at: 0, reachable: false, version: '', head: '' };
const SERVING_CACHE_MS = 10000;
function probeServingVersion(timeoutMs = 1500) {
  return new Promise(resolve => {
    const done = outcome => resolve(outcome);
    let req;
    try {
      req = http.request({ hostname: '127.0.0.1', port: scraperPort, path: '/api/version', method: 'GET', timeout: timeoutMs }, res => {
        let body = '';
        res.on('data', d => { body += d; if (body.length > 4000) req.destroy(); });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            done({ reachable: true, version: String(parsed.version || ''), head: String(parsed.head || '') });
          } catch { done({ reachable: true, version: '', head: '' }); }
        });
      });
    } catch { return done({ reachable: false, version: '', head: '' }); }
    req.on('timeout', () => { req.destroy(); done({ reachable: false, version: '', head: '' }); });
    req.on('error', () => done({ reachable: false, version: '', head: '' }));
    req.end();
  });
}
async function refreshServingCache(force = false) {
  if (!force && Date.now() - servingCache.at < SERVING_CACHE_MS) return servingCache;
  const probed = await probeServingVersion();
  servingCache = { at: Date.now(), ...probed };
  return servingCache;
}
// Stale when the running build provably differs from the checkout: a version
// mismatch, or (for same-version rebuilds) a git-sha mismatch. A reachable
// port with neither is someone else's program, never our stale scraper.
function servingState() {
  const onDisk = diskVersion(), diskHead = gitSha('HEAD');
  const { reachable, version, head } = servingCache;
  const stale = Boolean(reachable && ((version && onDisk && version !== onDisk) || (head && diskHead && head !== diskHead)));
  return { reachable, version, head, onDisk, diskHead, stale, identified: Boolean(reachable && (version || head)) };
}
async function waitForScraperPort(deadlineMs) {
  while (Date.now() < deadlineMs) {
    if (await scraperIsListening()) return true;
    // A scraper that exited (build failure, bad DATABASE_URL) will never bind;
    // stop waiting and report the real reason instead of stalling the browser.
    if (scraper && scraper.exitCode !== null && scraper.exitCode !== 75) return false;
    await new Promise(r => setTimeout(r, 700));
  }
  return false;
}

async function proxyScraper(req, res, url) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  if (!(await scraperIsListening())) {
    if(scraperKeepalive.status().lastReason==='Stopped intentionally')return send(res,503,{ok:false,error:'Scraper was stopped intentionally. Press Start in the deployer.'});
    startScraper();
    const budget = Number(process.env.LOCAL_SCRAPER_PROXY_WAIT_MS || 180000);
    if (!(await waitForScraperPort(Date.now() + budget))) {
      const exited = scraper && scraper.exitCode !== null && scraper.exitCode !== 75;
      const tail = String(scraperLog || '').split('\n').filter(Boolean).slice(-12).join('\n');
      return send(res, 503, {
        ok: false,
        error: exited
          ? `The local scraper exited with code ${scraper.exitCode} before it could serve http://localhost:${scraperPort}/.`
          : `The local scraper is still starting and did not answer on port ${scraperPort} within ${Math.round(budget / 1000)}s.`,
        hint: exited
          ? 'Open the Scraper tab in this deployer and read the log; a failed render:build or an unusable DATABASE_URL is the usual cause.'
          : 'The first start runs render:build, which is slow on Termux/ARM. Wait for "Scraper is ready" in the terminal, or raise LOCAL_SCRAPER_PROXY_WAIT_MS.',
        port: scraperPort,
        scraperExitCode: scraper ? scraper.exitCode : null,
        log: tail
      });
    }
  }

  const targetPath = (url.pathname === '/scraper' ? '/' : url.pathname.replace(/^\/scraper/, '')) + url.search;
  const headers = { ...req.headers, host: `127.0.0.1:${scraperPort}` };
  delete headers['content-length'];
  if (body.length) headers['content-length'] = String(body.length);
  const upstream = http.request({ hostname: '127.0.0.1', port: scraperPort, path: targetPath || '/', method: req.method, headers }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on('error', error => send(res, 502, {
    ok: false,
    error: `Local scraper proxy failed: ${error.message}`,
    // Stamp the running code's identity into the error itself. Without this a
    // stale deployer and a live bug produce byte-identical output, and the only
    // way to tell them apart is to ask the user to run git commands.
    deployerVersion: pkg.version,
    ...(staleCode().stale ? {
      staleDeployer: staleCode(),
      staleWarning: `This deployer process is running v${staleCode().running} but v${staleCode().onDisk} is on disk. Restart it (Ctrl+C, then npm run deployer:ui) -- you are hitting old code.`
    } : {}),
    port: scraperPort,
    scraperRunning: Boolean(scraper?.running),
    scraperExitCode: scraper ? scraper.exitCode : null,
    hint: 'The scraper answered the readiness probe but dropped this request; check the Scraper tab log.',
    log: String(scraperLog || '').split('\n').filter(Boolean).slice(-12).join('\n')
  }));
  upstream.end(body);
}

function requireAuth(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const supplied = req.headers['x-local-deployer-token'] || url.searchParams.get('token') || '';
  if (supplied !== token) { send(res, 401, { ok: false, error: 'Unauthorized local deployer UI request.' }); return false; }
  return true;
}

function universalArgs(body, mode = 'plan') {
  const allowedEnvs = new Set(['termux-offline', 'vscode', 'cloudflare-worker', 'vercel', 'render', 'vps']);
  const env = allowedEnvs.has(body.env) ? body.env : 'vscode';
  const args = ['scripts/universal-deployer.mjs', '--project-dir', projectDir, '--env', env, '--mode', mode];
  if (body.scrapingLibs && ['minimal','edge','node','browser','full','list'].includes(body.scrapingLibs)) args.push('--scraping-libs', body.scrapingLibs);
  if (body.packageManager && ['npm','pnpm','yarn','bun'].includes(body.packageManager)) args.push('--package-manager', body.packageManager);
  if (body.dryRun !== false) args.push('--dry-run');
  if (body.name) args.push('--name', String(body.name).replace(/[^a-z0-9_-]/gi, '-').slice(0, 60));
  if (body.port) args.push('--port', String(Number(body.port) || 3000));
  return args;
}

function installedLibraryProbe(envId = 'vscode') {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const moduleAvailable = name => existsSync(join(projectDir, 'node_modules', name, 'package.json')) || Boolean(deps[name]);
  const command = name => {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
    return result.status === 0 ? String(result.stdout || '').trim().split(/\r?\n/)[0] : '';
  };
  const item = (name, available, version = '', source = 'runtime', note = '') => ({ name, available: Boolean(available), installed: Boolean(available), version, source, note });
  const npm = name => item(name, moduleAvailable(name), deps[name] || '', 'npm dependency');
  const env = detectEnvironment();
  return { ok: true, dynamic: true, environment: envId || env.runtime, detected: env, queriedAt: new Date().toISOString(), groups: [
    { label: 'Local deployer runtime', items: [item('Node.js', true, process.version, 'runtime'), item('npm', Boolean(command('npm')), command('npm'), 'system command'), item('git', Boolean(command('git')), command('git'), 'system command'), item('gh', Boolean(command('gh')), command('gh'), 'system command')] },
    { label: 'Project npm libraries installed/declared', items: ['hono','@hono/node-server','cheerio','linkedom','undici','playwright','puppeteer','crawlee','read-excel-file','fflate','pg','@basalam/sdk','@basalam/node-sdk','basalam-sdk','basalam','typescript','esbuild','wrangler'].map(npm) },
    { label: 'Browser/database system tools', items: ['chromium','chromium-browser','google-chrome','psql','sqlite3','python','make','clang'].map(name => { const path = command(name); return item(name, Boolean(path), path, 'system command'); }) },
    { label: 'Selected environment catalog', items: installedLibraryGroups(envId).flatMap(group => group.items.map(name => item(name, true, '', group.type, group.label))) }
  ] };
}

function status() {
  return {
    ok: true,
    projectDir,
    package: { name: pkg.name, version: pkg.version, scripts: pkg.scripts },
    code: staleCode(),
    node: process.version,
    autoUpdate: { enabled: autoUpdateEnabled, intervalMs: branchScanIntervalMs, running: autoUpdateRunning, last: lastAutoUpdate, autoInstallLatest: autoInstallLatestEnabled },
    environment: detectEnvironment(),
    libraries: installedLibraryProbe().groups,
    branches: { enabled: autoUpdateEnabled, scanning: branchState.scanning, intervalMs: branchScanIntervalMs, autoInstallLatestEnabled, lastScanAt: branchState.lastScanAt, lastScanError: branchState.lastScanError, lastAction: branchState.lastAction, count: (branchState.branches || []).length, latest: branchState.latest, current: branchState.current },
    database: (() => { const plan = databaseInstallPlan(); const databaseUrl = normalizeDatabaseUrl(localEnv().DATABASE_URL); return {
      configured: Boolean(databaseUrl) || plan.method === 'sqlite',
      method: plan.method,
      methodLabel: databasePlanLabel(plan),
      effectiveUrl: databaseUrl,
      maskedUrl: String(databaseUrl || '').replace(/:[^:@/]+@/, ':***@'),
      rawHasPlaceholder: /@HOST(?::|\/|$)/i.test(String(localEnv().DATABASE_URL || '')),
      instructions: plan.instructions || ''
    }; })(),
    git: currentGitInfo(),
    files: {
      wrangler: existsSync(join(projectDir, 'wrangler.toml')),
      packageLock: existsSync(join(projectDir, 'package-lock.json')),
      staticHtmlDeployer: existsSync(join(projectDir, 'deploy-setup/static-universal-deployer.html'))
    },
    keepalive: scraperKeepalive.status(),
    notify: notifyPayload(),
    jobs: [...jobs.values()].map(({ child, ...j }) => j),
    scraper: scraper ? { running: scraper.running, pid: scraper.pid, startedAt: scraper.startedAt, exitCode: scraper.exitCode, port: scraperPort, command: scraper.command || scraperCommand, serving: servingState() } : { running: false, port: scraperPort, command: scraperCommand, serving: servingState() }
  };
}

const resourceMonitor = createResourceMonitor(async()=>{const [host,scraper]=await Promise.all([readResources(),readScraperResources(scraperPort)]);return {...host,scraper};});
resourceMonitor.start();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if(managedInstance&&!managedSession(req,res,token))return;
    const ref = req.headers.referer ? new URL(req.headers.referer, `http://${req.headers.host}`) : null;
    const fromScraperProxy = ref?.pathname?.startsWith('/scraper');
    if (url.pathname === '/scraper') {
      res.writeHead(302, { location: '/scraper/' + url.search });
      return res.end();
    }
    if (url.pathname.startsWith('/scraper') || (fromScraperProxy && (url.pathname === '/app-icon-192.png' || url.pathname === '/app-icon-512.png' || url.pathname === '/sw.js' || url.pathname === '/manifest.webmanifest' || url.pathname === '/app-icon.svg' || url.pathname === '/dashboard.js' || url.pathname === '/health' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/') || url.pathname === '/visual'))) return await proxyScraper(req, res, url);
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page(token), 'text/html; charset=utf-8');
    if (!requireAuth(req, res)) return;
    if (req.method === 'POST' && url.pathname === '/api/installation/action') {
      if(!managedInstance)return send(res,403,{ok:false,error:'Lifecycle controls are available only for the independent scraper4-managed installation.'});
      if(!lifecycleRequestAllowed(req,token))return send(res,403,{ok:false,error:'Authenticated same-origin request required.'});
      return send(res,202,queueLifecycle(await readJson(req,512)));
    }

    if (req.method === 'GET' && url.pathname === '/api/resources') return send(res, 200, await resourceMonitor.snapshot());
    if (req.method === 'GET' && url.pathname === '/api/status') { await refreshServingCache(); return send(res, 200, status()); }
    if (req.method === 'GET' && url.pathname === '/api/branches') {
      // Refreshing the deployer page must be enough to pick up a new version:
      // the background timer can be disabled, throttled, or simply not have
      // fired yet, and users reported sitting on an old version indefinitely.
      // Rescan (at most once per REFRESH_SCAN_MIN_MS) and install the newest
      // branch before answering, so the table the user sees is already current.
      const lastScan = Date.parse(branchState.lastScanAt || '') || 0;
      if (autoUpdateEnabled && !branchState.scanning && Date.now() - lastScan > REFRESH_SCAN_MIN_MS) {
        scanAllBranches('page-refresh');
        maybeAutoInstallNewest();
      }
      return send(res, 200, branchCatalogPayload());
    }
    if (req.method === 'POST' && url.pathname === '/api/branches/scan') {
      const payload = scanAllBranches('manual');
      // Same follow-up the timer does: seeing a newer version is only useful
      // if it then gets installed.
      maybeAutoInstallNewest();
      return send(res, 200, payload);
    }
    if (req.method === 'POST' && url.pathname === '/api/branches/repair-origin') {
      const payload = repairOriginRemote();
      // Same follow-up the scan route does: a repaired scan may reveal a
      // newer version that should then get installed.
      maybeAutoInstallNewest();
      return send(res, 200, payload);
    }
    if (req.method === 'POST' && url.pathname === '/api/branches/config') {
      const body = await readJson(req);
      return send(res, 200, updateBranchConfig(body));
    }
    if (req.method === 'POST' && url.pathname === '/api/branches/install') {
      const body = await readJson(req);
      const name = String(body.branch || '').replace(/^origin\//, '').trim();
      if (!name || /[^\w./-]/.test(name) || name === 'HEAD') return send(res, 400, { ok: false, error: 'Invalid branch name.' });
      if (!originRemoteUrl()) return send(res, 400, { ok: false, error: missingOriginMessage('install branches') });
      const exists = runSync('git', ['ls-remote', '--heads', 'origin', name]);
      if (!exists.ok || !/refs\/heads/.test(String(exists.stdout || ''))) return send(res, 404, { ok: false, error: 'Branch not found on origin.' });
      const result = updateFromGit({ branch: name, force: true, install: true });
      if (result.ok) restartUiSoon();
      return send(res, 200, { ...result, restarting: Boolean(result.ok), message: result.ok ? 'Branch ' + name + ' installed. This UI restarts in a few seconds.' : 'Install failed. See step output below.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/notifications') return send(res, 200, { ok: true, ...notifyPayload() });
    if (req.method === 'POST' && url.pathname === '/api/notifications/test') {
      if (!notifyEnabled) return send(res, 200, { ok: false, channel: 'off', error: 'Announcements are off (LOCAL_DEPLOYER_NOTIFY=0/no/off).' });
      const result = await sendNotification(notifyChannel, 'Scraper4 deployer', 'This is your machine talking to itself: system notifications work.');
      pushNotice(notifyLog, { at: new Date().toISOString(), reason: 'test', key: 'test:' + Date.now(), kind: 'test', title: 'Test notification', body: 'sent from the deployer page', ...result });
      saveNotifyState();
      console.log('[deployer] test notification ' + (result.ok ? 'sent via ' + result.channel : 'failed: ' + result.error));
      return send(res, 200, { ok: Boolean(result.ok), ...result, label: notifyChannel ? notifyChannel.label : '' });
    }
    if (req.method === 'POST' && url.pathname === '/api/notifications/scan') {
      const catalog = scanAllBranches('notify');
      const announce = await announceVersions({ reason: 'notify' });
      return send(res, 200, { ok: true, ...catalog, announce, notify: notifyPayload() });
    }
    if (req.method === 'GET' && url.pathname === '/api/libraries') return send(res, 200, installedLibraryProbe(url.searchParams.get('env') || 'vscode'));
    if (req.method === 'GET' && url.pathname === '/api/jobs') return send(res, 200, { ok: true, jobs: [...jobs.values()].map(({ child, ...j }) => j) });
    if (req.method === 'GET' && url.pathname === '/api/scraper/logs') return send(res, 200, { ok: true, log: scraperLog, scraper: status().scraper });
    if (req.method === 'POST' && url.pathname === '/api/update') {
      const body = await readJson(req);
      const result = updateFromGit({ force: Boolean(body.force), install: body.install !== false });
      if (result.ok && body.restart !== false) restartUiSoon();
      return send(res, 200, { ...result, restarting: Boolean(result.ok && body.restart !== false), message: result.ok ? 'Project updated from GitHub. Refresh this page after a few seconds.' : 'Update failed. See step output.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/job') {
      const body = await readJson(req);
      if (body.action === 'databaseInstall') {
        const plan = databaseInstallPlan();
        if (plan.method === 'sqlite' || plan.sqlite) {
          // Windows / docker-less machines: configure the built-in SQLite file
          // directly from Node - no shell command, no PostgreSQL, no Docker.
          try {
            mkdirSync(join(projectDir, 'data'), { recursive: true });
            const next = saveLocalEnv({ DATABASE_URL: plan.databaseUrl || 'sqlite:data/scraper4.sqlite', RUN_WORKER_IN_WEB: 'true', LOCAL_SCRAPER_AUTO_UPDATE: 'true', PORT: String(scraperPort) });
            return send(res, 200, { ok: true, applied: true, detected: plan, database: normalizeDatabaseUrl(next.DATABASE_URL), message: 'Built-in SQLite database configured in .env.local - no PostgreSQL needed. Start the local scraper now.' });
          } catch (error) {
            return send(res, 500, { ok: false, error: error?.message || String(error) });
          }
        }
        if (!plan.command) return send(res, 200, { ok: true, instructions: plan.instructions, detected: plan });
        const job = runJob(body.action, plan.command, [], { shell: true });
        return send(res, 200, { ok: true, detected: plan, job: (({ child, ...j }) => j)(job) });
      }
      const map = {
        install: ['npm', npmInstallArgs],
        test: ['npm', ['run', 'worker:test']],
        build: ['npm', ['run', 'worker:build']],
        localBuild: ['npm', ['run', 'render:build']],
        deployerPlan: ['node', universalArgs(body, 'plan')],
        deployerPrepare: ['node', universalArgs(body, 'prepare')]
      };
      if (!map[body.action]) return send(res, 400, { ok: false, error: 'Unknown action' });
      const job = runJob(body.action, map[body.action][0], map[body.action][1]);
      return send(res, 200, { ok: true, job: (({ child, ...j }) => j)(job) });
    }
    if (req.method === 'GET' && url.pathname === '/api/py/status') return send(res, 200, { ok: true, status: pyStatus(projectDir) });
    if (req.method === 'POST' && url.pathname === '/api/py/extract') {
      // Synchronous by design: extraction takes seconds and the UI needs the
      // parsed products, not a log tail. pyExtract caps runtime and response.
      const body = await readJson(req);
      const result = pyExtract({ projectDir, url: String(body.url || ''), base: String(body.base || ''), selectors: String(body.selectors || '') });
      return send(res, result.ok ? 200 : 400, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/py/install') {
      // Long job with visible logs (Logs tab), like the npm install action.
      // Plain pip first (Termux); --break-system-packages fallback (Debian).
      const job = runJob('py-deps', 'python3 -m pip install -q beautifulsoup4 lxml requests || python3 -m pip install -q --break-system-packages beautifulsoup4 lxml requests', [], { shell: true });
      return send(res, 200, { ok: true, job: (({ child, ...j }) => j)(job) });
    }
    if (req.method === 'POST' && url.pathname === '/api/scraper/start') return send(res, 200, { ok: true, scraper: (({ child, ...s }) => ({ ...s, port: scraperPort }))(startScraper()) });
    if (req.method === 'POST' && url.pathname === '/api/scraper/stop') {const {child,...stopped}=stopScraper();return send(res,200,{ok:true,scraper:stopped,keepalive:scraperKeepalive.status()});}
    if (req.method === 'POST' && url.pathname === '/api/scraper/restart') {
      stopScraper();
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline && await scraperIsListening(500)) {
        freeScraperPort();
        await new Promise(r => setTimeout(r, 700));
      }
      const started = startScraper();
      await refreshServingCache(true);
      const { child, ...s } = started || {};
      return send(res, 200, { ok: true, scraper: { ...s, port: scraperPort }, serving: servingState() });
    }
    send(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    send(res, 500, { ok: false, error: error?.message || String(error) });
  }
});

function listenWithRetry(attempt = 0) {
  server.once('error', error => {
    if (error?.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      port += 1;
      listenWithRetry(attempt + 1);
      return;
    }
    console.error(`Local Deployer UI failed to start: ${error?.message || error}`);
    console.error('Try another port, for example: DEPLOYER_UI_PORT=8791 npm run deployer:ui');
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`
Local Deployer UI is running:`);
    console.log(`  http://localhost:${port}/?token=${token}`);
    console.log(`
Scraper (independent of the deployer, no token needed):`);
    console.log(`  http://localhost:${scraperPort}/`);
    console.log(`
Codespaces: open forwarded ports ${port} and ${scraperPort}; keep the token in the deployer URL.`);
    console.log(`Project: ${projectDir}
`);
    const bootCode = staleCode();
    if (bootCode.stale) console.log(`[deployer] WARNING: this process is running v${bootCode.running} but v${bootCode.onDisk} is on disk. Restart the deployer (Ctrl+C, then npm run deployer:ui) to pick up the update.\n`);
    // The scraper dashboard proxies this server (see /api/deployer/local/* in render-src/server.ts)
    // and needs the port - which listenWithRetry may have moved - plus the token. A file in the
    // gitignored data/ dir, readable only by this user, is how two local processes hand that over
    // without anyone copying a secret by hand.
    writeDeployerHandshake({ port, host, token, pid: process.pid, version: pkg.version || '' });
    autoStartScraper();
  });
}

// The scraper must come up on its own address as soon as the deployer is
// installed or updated, so opening it never depends on the deployer page
// (which used to be the only way to trigger startScraper()).
// Where the port and token are published for the scraper dashboard to pick up (it proxies this
// server through /api/deployer/local/*). DEPLOYER_HANDSHAKE_FILE lets a test or a second install
// point it somewhere else, so a scratch run cannot overwrite the handshake of the real one.
export const DEPLOYER_HANDSHAKE_FILE = startupEnv.DEPLOYER_HANDSHAKE_FILE || join(projectDir, 'data', '.deployer-token');
function writeDeployerHandshake(info) {
  try {
    mkdirSync(resolve(DEPLOYER_HANDSHAKE_FILE, '..'), { recursive: true });
    writeFileSync(DEPLOYER_HANDSHAKE_FILE, JSON.stringify({ ...info, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  } catch (error) {
    // Nothing downstream is security-critical enough to justify killing the UI over a scratch file.
    console.log('[deployer] could not write ' + DEPLOYER_HANDSHAKE_FILE + ': ' + (error?.message || error));
  }
}

function autoStartScraper() {
  if (String(process.env.LOCAL_SCRAPER_AUTOSTART || '').toLowerCase() === 'false') {
    console.log('[deployer] scraper autostart disabled (LOCAL_SCRAPER_AUTOSTART=false).');
    return;
  }
  scraperKeepalive.enable();
  // The scraper outlives the deployer, so a restarted deployer may find one
  // already serving the port. Adopt it instead of starting a second copy that
  // would fail with EADDRINUSE.
  const probe = http.request({ hostname: '127.0.0.1', port: scraperPort, path: '/', method: 'HEAD', timeout: 1500 }, async response => {
    response.resume();
    // Adopting blindly is how a stale build survives updates forever: the
    // checkout moves on while localhost keeps serving the orphan. Only adopt
    // what provably matches the checkout; a stale OURS occupant is stopped
    // and rebuilt, anything else is reported and left alone.
    const serving = await refreshServingCache(true);
    const state = servingState();
    if(!scraperKeepalive.status().desired)return;
    if (!state.stale && state.identified) {
      scraperKeepalive.started();
      console.log(`[deployer] a scraper is already serving http://localhost:${scraperPort}/ (HTTP ${response.statusCode}, v${serving.version || '?'}); leaving it running.`);
      return;
    }
    if (!state.identified) {
      console.log(`[deployer] WARNING: something answers on port ${scraperPort} (HTTP ${response.statusCode}) but it is not our scraper (no /api/version). Leaving it running — stop that program or change PORT, then press Build & start.`);
      return;
    }
    console.log(`[deployer] localhost:${scraperPort} serves stale v${serving.version || '?'} (${(serving.head || '?').slice(0, 7)}) but the checkout is v${state.onDisk} (${(state.diskHead || '?').slice(0, 7)}); stopping it and rebuilding...`);
    const portState = freeScraperPort();
    if (portState.foreign.length && !portState.freed.length) {
      console.log(`[deployer] WARNING: the stale occupant reports our version scheme but is not our process (pid ${portState.foreign[0].pid}) — refusing to kill it. Stop it, then press Build & start.`);
      return;
    }
    startFresh();
  });
  let launching=false;
  const startFresh = () => {
    if(launching||!scraperKeepalive.status().desired)return;launching=true;
    probe.destroy();
    try {
      startScraper();
      console.log(`[deployer] building and starting the scraper on port ${scraperPort}...`);
      waitForScraper();
    } catch (error) {
      console.error(`[deployer] could not autostart the scraper: ${error?.message || error}`);
    }
  };
  probe.on('timeout', startFresh);
  probe.on('error', startFresh);
  probe.end();
}

// Report readiness once, so the terminal tells the user when the URL is live
// instead of leaving them to guess while `render:build` runs.
function waitForScraper(attempt = 0) {
  if (!scraper?.running) {
    if (scraper && scraper.exitCode !== null) console.error(`[deployer] scraper exited with code ${scraper.exitCode}; open the deployer's Scraper tab for the log.`);
    return;
  }
  const request = http.request({ hostname: '127.0.0.1', port: scraperPort, path: '/', method: 'HEAD', timeout: 2000 }, response => {
    response.resume();
    console.log(`\n  Scraper is ready:  http://localhost:${scraperPort}/  (HTTP ${response.statusCode})\n`);
  });
  const retry = () => {
    request.destroy();
    if (attempt < 150) setTimeout(() => waitForScraper(attempt + 1), 2000);
    else console.error(`[deployer] scraper did not answer on port ${scraperPort} after 5 minutes; check the Scraper tab log.`);
  };
  request.on('timeout', retry);
  request.on('error', retry);
  request.end();
}

listenWithRetry();
scheduleBranchScanner();
const scraperWatchdog=setInterval(()=>void scraperKeepalive.check(),15000);
scraperWatchdog.unref?.();

// Closing the deployer must NOT take the scraper down with it: the scraper owns
// its own URL and has to stay reachable on its own. Set LOCAL_SCRAPER_STOP_WITH_UI=true
// to restore the old behaviour; the Stop button still stops it on demand.
const stopScraperWithUi = String(process.env.LOCAL_SCRAPER_STOP_WITH_UI || '').toLowerCase() === 'true';
function shutdownUi() {
  scraperKeepalive.close();clearInterval(scraperWatchdog);resourceMonitor.close();
  if (stopScraperWithUi) stopScraper();
  else if (scraper?.running) console.log(`\n[deployer] closing the deployer; the scraper keeps running on http://localhost:${scraperPort}/ (pid ${scraper.pid}).`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdownUi);
process.on('SIGTERM', shutdownUi);

function page(token) {
  const commands = {"Update existing clone": "cd \"$HOME/new\"\ngit config --local --unset-all credential.helper || true\ngit config --local --replace-all credential.helper '!gh auth git-credential'\ngh auth setup-git || true\ngit fetch origin arena/01a09468-new\ngit reset --hard origin/arena/01a09468-new\ncd \"$HOME/new/cloudflare-scraper4\"\nnpm install --no-audit --prefer-online\n# On Termux add --ignore-scripts to the npm install (Android cannot run install scripts)\nnode scripts/esbuild-check.mjs\nnpm run browsers:install || true\nnpm run basalam:install || true\nnpm run version:check\ngrep '\"version\"' package.json | head -1\n# Expected: 1.219.0+\nnpm run deployer:ui", "VS Code / Desktop": "git clone --branch arena/01a09468-new https://github.com/fazilatma/new.git\ncd new\nnpm install\ncd cloudflare-scraper4\nnpm install\nnode scripts/esbuild-check.mjs\nnpm run version:check\n# Expected: 1.219.0+\nnpm run basalam:install\nnpm run deployer:ui", "Windows PowerShell": "# Choose the install directory yourself. Example: D:\\Scraper4 or E:\\Apps\\Scraper4\n$InstallRoot = Read-Host \"Install folder for Scraper4 (not forced to C:)\"\nif ([string]::IsNullOrWhiteSpace($InstallRoot)) { throw \"Install folder is required\" }\nNew-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null\nSet-Location $InstallRoot\n# Install prerequisites if winget is available. You can also install Node.js LTS, Git, and GitHub CLI manually.\nif (Get-Command winget -ErrorAction SilentlyContinue) {\n  winget install --id Git.Git -e --source winget\n  winget install --id GitHub.cli -e --source winget\n  winget install --id OpenJS.NodeJS.LTS -e --source winget\n  winget install --id Python.Python.3.12 -e --source winget\n}\n# Restart PowerShell after first installing Node/Git if commands are not found.\nif (-not (Test-Path \"$InstallRoot\\new\\.git\")) {\n  git clone --branch arena/01a09468-new https://github.com/fazilatma/new.git \"$InstallRoot\\new\"\n} else {\n  Set-Location \"$InstallRoot\\new\"\n  git fetch origin arena/01a09468-new\n  git reset --hard origin/arena/01a09468-new\n}\nSet-Location \"$InstallRoot\\new\\cloudflare-scraper4\"\nnpm install --no-audit --prefer-online\nnpm run browsers:install\nnpm run basalam:install\nnode scripts/esbuild-check.mjs\nnpm run version:check\n# Expected: 1.219.0+\n@\"\nDATABASE_URL=sqlite:data/scraper4.sqlite\nRUN_WORKER_IN_WEB=true\nLOCAL_SCRAPER_AUTO_UPDATE=true\nPORT=3000\n\"@ | Set-Content -Encoding UTF8 .env.local\n# Windows uses Node built-in SQLite - no PostgreSQL install/service needed.\n# Remove DATABASE_URL only if you prefer a remote/managed PostgreSQL URL.\nnpm run deployer:ui\n# Open the printed http://localhost:8790/?token=... URL. The app files stay under $InstallRoot\\new, not the default C: path.", "Windows Command Prompt": "REM Choose the install directory yourself. Example: D:\\Scraper4 or E:\\Apps\\Scraper4\nset /p INSTALL_ROOT=Install folder for Scraper4 (not forced to C:): \nif \"%INSTALL_ROOT%\"==\"\" echo Install folder is required && exit /b 1\nmkdir \"%INSTALL_ROOT%\" 2>nul\ncd /d \"%INSTALL_ROOT%\"\nREM Install Node.js LTS, Git, and GitHub CLI manually, or use winget before running this block.\nwhere git || winget install --id Git.Git -e --source winget\nwhere node || winget install --id OpenJS.NodeJS.LTS -e --source winget\nwhere gh || winget install --id GitHub.cli -e --source winget\nwhere python || winget install --id Python.Python.3.12 -e --source winget\nif not exist \"%INSTALL_ROOT%\\new\\.git\" (\n  git clone --branch arena/01a09468-new https://github.com/fazilatma/new.git \"%INSTALL_ROOT%\\new\"\n) else (\n  cd /d \"%INSTALL_ROOT%\\new\"\n  git fetch origin arena/01a09468-new\n  git reset --hard origin/arena/01a09468-new\n)\ncd /d \"%INSTALL_ROOT%\\new\\cloudflare-scraper4\"\nnpm install --no-audit --prefer-online\nnpm run browsers:install\nnpm run basalam:install\nnode scripts\\esbuild-check.mjs\nnpm run version:check\nREM Expected: 1.219.0+\n(\n  echo DATABASE_URL=sqlite:data/scraper4.sqlite\n  echo RUN_WORKER_IN_WEB=true\n  echo LOCAL_SCRAPER_AUTO_UPDATE=true\n  echo PORT=3000\n) > .env.local\nREM Windows uses Node built-in SQLite - no PostgreSQL install/service needed.\nREM Remove DATABASE_URL only if you prefer a remote/managed PostgreSQL URL.\nnpm run deployer:ui\nREM Open the printed http://localhost:8790/?token=... URL. The app files stay under %INSTALL_ROOT%\\new, not the default C: path.", "Termux / Android": "cd \"$HOME\"\npkg update -y\npkg upgrade -y\npkg install -y git gh openssh nodejs-lts python make clang chromium\npip install -q beautifulsoup4 lxml requests  # deps for the deployer Python extract tab\nrm -rf \"$HOME/new\"\ngit config --global --unset-all credential.helper || true\ngh auth login --web -h github.com -p https\ngh auth setup-git\ngh repo clone fazilatma/new \"$HOME/new\" -- --branch arena/01a09468-new --depth 1\ncd \"$HOME/new\"\ngit config --local --unset-all credential.helper || true\ngit config --local --replace-all credential.helper '!gh auth git-credential'\ngit config --local --get-all credential.helper\n# Correct output: !gh auth git-credential\n# Do NOT set: gh auth setup-git auth git-credential\ngit pull --ff-only origin arena/01a09468-new\ncd \"$HOME/new/cloudflare-scraper4\"\nnpm config set fetch-retries 5\nnpm config set fetch-retry-mintimeout 20000\nnpm config set fetch-retry-maxtimeout 90000\n# --ignore-scripts: wrangler's workerd setup has no Android build and fails the whole install. Nothing the scraper runs needs install scripts here.\nnpm install --ignore-scripts --no-audit --prefer-online\nnpm run browsers:install || true\nnpm run basalam:install || true\nnode scripts/esbuild-check.mjs\nnpm run version:check\n# Expected: 1.219.0+\nCHROME_BIN=\"$(command -v chromium-browser || command -v chromium || true)\"\nif [ -n \"$CHROME_BIN\" ]; then printf \"BROWSER_EXECUTABLE_PATH=$CHROME_BIN\nPLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$CHROME_BIN\nPUPPETEER_EXECUTABLE_PATH=$CHROME_BIN\nLOCAL_SCRAPER_AUTO_UPDATE=true\n\" >> .env.local; fi\n# No ADMIN_TOKEN needed locally: the vault key is generated at data/vault.key on first save.\n# Keep that file - deleting it makes already-saved API keys unreadable.\nnpm run deployer:ui", "Database: Docker local": "docker rm -f scraper4-postgres || true\ndocker run --name scraper4-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=scraper4 -p 5432:5432 -d postgres:16\nprintf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scraper4\nRUN_WORKER_IN_WEB=true\n' > .env.local\n# No Docker? Leave DATABASE_URL empty (or sqlite:data/scraper4.sqlite) to use built-in Node SQLite.", "Database: Termux PostgreSQL (optional)": "pkg install -y postgresql\n# If you saw role \"postgres\" does not exist, use the Termux user from whoami, not postgres:postgres.\nmkdir -p \"$PREFIX/var/lib/postgresql\"\n[ -f \"$PREFIX/var/lib/postgresql/PG_VERSION\" ] || initdb \"$PREFIX/var/lib/postgresql\"\npg_ctl -D \"$PREFIX/var/lib/postgresql\" -l \"$HOME/scraper4-postgres.log\" start\ncreatedb scraper4 || true\nprintf \"DATABASE_URL=postgresql://$(whoami)@localhost:5432/scraper4\nRUN_WORKER_IN_WEB=true\n\" > .env.local\n# Windows: skip this - the deployer configures built-in Node SQLite automatically.", "Render.com panel": "1) Render Dashboard → New → PostgreSQL\n2) Copy Internal Database URL\n3) Your Web Service → Environment:\n   DATABASE_URL = Internal Database URL\n   RUN_WORKER_IN_WEB = true\n   ADMIN_TOKEN = long-random-secret\n4) Save Changes → Manual Deploy / Redeploy\n5) Open https://YOUR-SERVICE.onrender.com/health → expected version: 1.219.0+\n6) The build also installs the Python basalam-sdk; verify it in the libraries card", "Cloudflare Worker": "Cloudflare Dashboard → Workers & Pages → your Worker\nSettings → Variables and Secrets:\n  VAULT_SECRET = long-random-secret\nBindings:\n  D1 DB binding name = DB\n  Queue binding name = JOBS\nDeployments → Redeploy\nOpen https://YOUR-WORKER.workers.dev/api/version → expected version: 1.219.0+\nCheck daily D1 usage: https://YOUR-WORKER.workers.dev/api/quota\n  Free plan: 5,000,000 rows read + 100,000 rows written per day, reset 00:00 UTC.\nwrangler.toml WORKER_VERSION is kept in sync by: npm run version:sync", "API examples": "curl -X POST http://127.0.0.1:3000/api/profiles/PROFILE_ID/run -H 'content-type: application/json' -d '{\"target\":\"none\",\"pages\":1}'\ncurl -X POST http://127.0.0.1:3000/api/profiles/PROFILE_ID/run -H 'content-type: application/json' -d '{\"target\":\"both\",\"extract\":false,\"limit\":100}' \ncurl -s http://127.0.0.1:3000/health\n# Expected version: 1.219.0+"};
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="dark light"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#04070f"><meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3f6fd"><title>Scraper4 Local Deployer</title>
<style>
*,*::before,*::after{box-sizing:border-box}
:root{color-scheme:dark;--bg:#04070f;--bg2:#0a1322;--card:#0d1728;--card2:#0a1322;--line:#1f2f49;--line2:#2c4166;--text:#e8eefb;--muted:#a6b7d1;--brand:#4cc2ff;--brand2:#a78bfa;--ok:#3ddc84;--warn:#fbbf24;--bad:#ff6b6b;--glow:#0e3a5566;--shadow:0 20px 45px -22px #000d;--tap:2.85rem;--r:1.05rem;--r-sm:.75rem;--pad:1.05rem}
:root[data-theme=light]{--bg:#f3f6fd;--bg2:#ffffff;--card:#ffffff;--card2:#f7f9ff;--line:#dbe4f3;--line2:#c4d3ea;--text:#0f1728;--muted:#4d5f78;--brand:#0a76b8;--brand2:#6a49cf;--ok:#0e8b4c;--warn:#9a5806;--bad:#c22a2a;--glow:#cfe3f7aa;--shadow:0 16px 36px -24px #16233d66}
@media(prefers-color-scheme:light){:root:not([data-theme=dark]){--bg:#f3f6fd;--bg2:#ffffff;--card:#ffffff;--card2:#f7f9ff;--line:#dbe4f3;--line2:#c4d3ea;--text:#0f1728;--muted:#4d5f78;--brand:#0a76b8;--brand2:#6a49cf;--ok:#0e8b4c;--warn:#9a5806;--bad:#c22a2a;--glow:#cfe3f7aa;--shadow:0 16px 36px -24px #16233d66}}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;padding:0 env(safe-area-inset-right) 0 env(safe-area-inset-left);color:var(--text);line-height:1.7;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Noto Sans,Arial,sans-serif;font-size:1rem;background:radial-gradient(115% 52% at 6% -14%,var(--glow) 0,transparent 60%) no-repeat,var(--bg);min-height:100dvh;transition:background .2s ease,color .2s ease}
body{-webkit-tap-highlight-color:transparent}
h1{font-size:clamp(1.34rem,1.06rem + 1.5vw,1.9rem);line-height:1.18;margin:0;font-weight:800;letter-spacing:-.018em}
h2{font-size:clamp(1.1rem,1rem + .5vw,1.32rem);line-height:1.32;margin:0 0 .45rem;font-weight:750;letter-spacing:-.01em}
h3{font-size:1.03rem;font-weight:720;margin:0 0 .4rem;line-height:1.4}
p{margin:.3rem 0 0;max-width:72ch}
a{color:var(--brand);overflow-wrap:anywhere}
code,pre,.kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.shell{width:100%;max-width:84rem;margin:0 auto;padding:clamp(.85rem,3vw,1.4rem)}
.hero{display:grid;gap:.75rem;align-items:center;padding:.95rem 0 .35rem}
@media(min-width:52em){.hero{grid-template-columns:minmax(0,1fr) auto;gap:1rem;padding-top:1.15rem}}
.brand{display:flex;gap:.8rem;align-items:center;min-width:0}
.logo{width:2.7rem;height:2.7rem;flex:none;border-radius:.9rem;background:linear-gradient(140deg,var(--brand),var(--brand2));box-shadow:0 10px 26px -12px var(--brand);display:grid;place-items:center;font-size:1.3rem;line-height:1;color:#04121f}
.tagline{color:var(--muted);font-size:.97rem;margin:.1rem 0 0;max-width:52ch}
.pills{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}
.pill{display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--line);border-radius:999px;background:var(--card2);color:var(--text);padding:.42rem .72rem;font-size:.87rem;line-height:1.4;font-variant-numeric:tabular-nums}
.pill.live{border-color:var(--ok)}
.grid{display:grid;gap:.85rem;grid-template-columns:minmax(0,1fr);margin-top:.9rem;align-items:start}
@media(min-width:62em){.grid{grid-template-columns:minmax(0,20rem) minmax(0,1fr);gap:1rem}.side{position:sticky;top:1rem;order:0}.stack{order:0}}
.stack{order:-1;min-width:0;display:grid;gap:.85rem}
.card{border:1px solid var(--line);border-radius:var(--r);background:linear-gradient(180deg,var(--card),var(--card2));padding:var(--pad);box-shadow:var(--shadow);min-width:0}
.tabs{display:flex;gap:.35rem;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch;padding:.34rem;border:1px solid var(--line);border-radius:999px;background:var(--card);box-shadow:var(--shadow);position:sticky;top:.35rem;z-index:5;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
@media(min-width:62em){.tabs{position:static;flex-wrap:wrap}}
.tabs button{flex:0 0 auto;scroll-snap-align:center;border:0;background:transparent;color:var(--muted);border-radius:999px;padding:.5rem .95rem;min-height:2.55rem;font:inherit;font-size:.94rem;font-weight:680;white-space:nowrap;box-shadow:none}
.tabs button.active{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#04121f;font-weight:750}
.panel{display:none;min-width:0}
.panel.active{display:grid;gap:.85rem;animation:rise .16s ease-out}
@keyframes rise{from{opacity:0;transform:translateY(.3rem)}to{opacity:1;transform:none}}
button{font:inherit;font-size:.96rem;font-weight:720;line-height:1.25;border:1px solid transparent;border-radius:var(--r-sm);background:linear-gradient(135deg,var(--brand),#6ab6f5);color:#04121f;padding:.72rem 1.05rem;min-height:var(--tap);cursor:pointer;box-shadow:0 10px 22px -16px #000c;transition:filter .14s ease,transform .1s ease,background-color .18s ease;-webkit-tap-highlight-color:transparent}
button:active{transform:translateY(1px)}
button.secondary{background:var(--bg2);color:var(--text);border-color:var(--line2);box-shadow:none}
button.success{background:linear-gradient(135deg,var(--ok),#7fe6ac);color:#04140a}
button.danger{background:linear-gradient(135deg,#e23b3b,var(--bad));color:#fff}
button.warn{background:linear-gradient(135deg,var(--warn),#fcd34d);color:#231000}
button.chip{background:transparent;border:1px solid var(--line2);color:var(--muted);border-radius:999px;padding:.4rem .8rem;min-height:2.4rem;font-size:.86rem;font-weight:640;box-shadow:none}
button[disabled]{opacity:.6;cursor:progress}
@media(hover:hover) and (pointer:fine){button:hover{filter:brightness(1.06)}}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;margin-top:.75rem}
.row>button{flex:1 1 min(100%,10.5rem)}
@media(min-width:47em){.row>button{flex:0 1 auto}}
label{display:block;margin:.8rem 0 .3rem;font-weight:720;font-size:.9rem;color:var(--muted);letter-spacing:.01em}
select,input{width:100%;border:1px solid var(--line2);border-radius:var(--r-sm);background:var(--bg2);color:var(--text);padding:.68rem .8rem;font:inherit;font-size:1rem;min-height:var(--tap);transition:border-color .15s ease}
input[type=checkbox]{width:1.35rem;height:1.35rem;min-height:0;padding:0;accent-color:var(--brand);flex:none}
.check{display:inline-flex;align-items:center;gap:.5rem;margin:0;font-weight:640;font-size:.94rem;color:var(--text)}
select.auto{width:auto;min-width:0;padding:.5rem 2rem .5rem .7rem}
select:focus-visible,input:focus-visible,button:focus-visible,a:focus-visible,summary:focus-visible{outline:.2rem solid var(--brand);outline-offset:.14rem}
.status{display:grid;gap:.6rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,10.5rem),1fr));margin-top:.75rem}
.metric{border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg2);padding:.75rem .85rem;min-width:0;overflow-wrap:anywhere}
.metric small{display:block;color:var(--muted);font-size:.8rem;font-weight:640}
.metric b{display:block;font-size:1.05rem;margin-top:.25rem;line-height:1.4}
.dot{width:.7rem;height:.7rem;flex:none;border-radius:99px;background:var(--muted);display:inline-block;box-shadow:0 0 10px -2px var(--muted)}
.dot.ok{background:var(--ok);box-shadow:0 0 12px -1px var(--ok)}
.dot.warn{background:var(--warn);box-shadow:0 0 12px -1px var(--warn)}
.dot.err{background:var(--bad);box-shadow:0 0 12px -1px var(--bad)}
/* updateRail names the third state "bad"; the rest of the page says "err" — both must be red. */
.dot.bad{background:var(--bad);box-shadow:0 0 12px -1px var(--bad)}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg2);border:1px solid var(--line);border-radius:var(--r-sm);padding:.85rem;min-height:5rem;max-height:max(14rem,58vh);overflow:auto;overscroll-behavior:contain;color:var(--text);font-size:.89rem;line-height:1.55;margin:.75rem 0 0;-webkit-overflow-scrolling:touch}
.guide-grid{display:grid;gap:.7rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,17.5rem),1fr));margin-top:.7rem}
.guide-card{border:1px solid var(--line);border-radius:var(--r-sm);padding:.85rem;background:var(--bg2);min-width:0;display:grid;gap:.5rem;align-content:start}
.guide-card .row{margin-top:0}
.guide-card pre{min-height:7rem;max-height:max(13rem,52vh);margin:0}
.lib-grid{display:grid;gap:.55rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));margin-top:.7rem}
.lib-card{border:1px solid var(--line);border-radius:var(--r-sm);padding:.75rem;background:var(--bg2);min-width:0}
.lib-card small{display:block;color:var(--muted);margin-bottom:.45rem;font-size:.82rem}
.lib-card code{display:inline-block;margin:.12rem;padding:.22rem .5rem;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:.83rem;overflow-wrap:anywhere}
.guide-card code,.lib-card code{background:var(--card)}
.kbd{font-size:.86em;background:var(--bg2);border:1px solid var(--line);border-radius:.4rem;padding:.08em .38em;overflow-wrap:anywhere}
.muted{color:var(--muted)}
.small{font-size:.87rem}
.copy-ok{color:var(--ok);font-size:.86rem;font-weight:680}
.banner{border:1px solid var(--line2);background:var(--bg2);border-radius:var(--r-sm);padding:.7rem .85rem;margin-top:.75rem;font-size:.95rem;overflow-wrap:anywhere;min-width:0}
.banner.bad{border-color:var(--bad);background:color-mix(in srgb,var(--bad) 12%,transparent)}
.steps{display:grid;gap:.5rem;margin-top:.85rem}
.step{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.6rem;align-items:start;padding:.6rem .7rem;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg2);min-width:0}
.step .num{width:1.8rem;height:1.8rem;border-radius:.6rem;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#04121f;display:grid;place-items:center;font-weight:850;font-size:.86rem;font-variant-numeric:tabular-nums}
.step div{min-width:0;font-size:.93rem}
details.note{border:1px dashed var(--line2);border-radius:var(--r-sm);padding:.35rem .8rem;margin-top:.75rem;background:var(--card2)}
details.note>summary{cursor:pointer;font-weight:720;color:var(--muted);padding:.35rem 0;min-height:1.9rem;font-size:.92rem;list-style:none}
details.note>summary::-webkit-details-marker{display:none}
details.note>summary::before{content:"⌄ ";display:inline-block;transition:transform .15s ease}
details.note[open]>summary::before{transform:rotate(180deg)}
details.note>div{padding-bottom:.55rem;max-width:74ch}
.scrollx{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:var(--r-sm);margin-top:.75rem;overscroll-behavior-x:contain}
.tbl{width:100%;border-collapse:collapse;font-size:.92rem;min-width:0}
.tbl th,.tbl td{border-bottom:1px solid var(--line);padding:.6rem .5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere;min-width:0}
.tbl th{color:var(--muted);font-size:.8rem;font-weight:750;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.tbl tr.current td{background:color-mix(in srgb,var(--brand) 12%,transparent)}
.tbl .num{font-variant-numeric:tabular-nums;white-space:nowrap}
@media(max-width:47em){.scrollx{overflow:visible}.tbl,.tbl tbody,.tbl tr,.tbl td,.tbl th{display:block;width:100%}.tbl thead{display:none}.tbl tr{border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg2);padding:.35rem .7rem;margin-bottom:.6rem}.tbl tr.current{border-color:var(--brand)}.tbl td{border:0;padding:.3rem 0;display:grid;grid-template-columns:minmax(0,7rem) minmax(0,1fr);gap:.5rem;align-items:start}.tbl td:only-child{display:block}.tbl td::before{content:attr(data-label);color:var(--muted);font-size:.78rem;font-weight:750;letter-spacing:.03em;text-transform:uppercase;padding-top:.15rem}.tbl td>button{width:100%;margin-top:.25rem}.tbl td code{font-size:.86rem}}
.dock{position:fixed;inset-inline:0;bottom:0;display:grid;grid-template-columns:1fr 1fr;gap:.45rem;padding:.55rem .8rem calc(.55rem + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--card) 92%,transparent);border-top:1px solid var(--line);z-index:7;box-shadow:0 -14px 32px -24px #000d;backdrop-filter:blur(10px)}
.dock .primary{grid-column:1/-1}
@media(min-width:62em){.dock{display:none}}
@media(max-width:61.99em){body{padding-bottom:8.5rem}}
.skip{position:absolute;left:.6rem;top:-4rem;z-index:20;background:var(--brand);color:#04121f;padding:.55rem .85rem;border-radius:.6rem;font-weight:750;transition:top .15s ease}
.skip:focus{top:.6rem}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important}}
@media(prefers-contrast:more){:root{--line:var(--line2);--muted:var(--text)}.card,.banner,.metric,.step,.lib-card,.guide-card{border-width:2px}}
/* v2 additions — the parts that turn a restyled page into an instrument you can read at 400%.
   A persistent status rail (you should never have to scroll to learn whether anything is up),
   tab badges (which panel wants attention), skeleton tiles (the page must not look broken while
   the first /api/status is in flight), a toast (feedback without hunting for a 12px span),
   filters for the two long lists, and an in-page text-size control, because the em/rem cascade
   above means that control scales the whole interface the way OS zoom should. */
.rail{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.65rem;align-items:center}
.stat{display:inline-flex;align-items:center;gap:.42rem;border:1px solid var(--line);background:var(--card2);border-radius:999px;padding:.34rem .66rem;font-size:.84rem;line-height:1.45;min-width:0}
.stat b{font-weight:720;overflow-wrap:anywhere}
.stat.ok{border-color:color-mix(in srgb,var(--ok) 45%,var(--line))}
.stat.bad{border-color:color-mix(in srgb,var(--bad) 55%,var(--line))}
.stat.warn{border-color:color-mix(in srgb,var(--warn) 50%,var(--line))}
.upd{font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums;margin-left:auto}
.controls{display:flex;flex-wrap:wrap;gap:.35rem;align-items:center}
.stepper{display:inline-flex;align-items:center;border:1px solid var(--line2);border-radius:999px;background:var(--card2);overflow:hidden}
.stepper button{border:0;background:transparent;color:var(--text);border-radius:0;min-height:var(--tap);padding:.25rem .75rem;box-shadow:none;font-weight:800;font-size:1rem}
.stepper .val{font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums;min-width:3.1rem;text-align:center}
.card-head{display:grid;gap:.3rem;margin-bottom:.15rem}
.card-head .row{margin-top:0}
.head-in{display:flex;flex-wrap:wrap;gap:.5rem .85rem;align-items:flex-start;justify-content:space-between}
.card-head p{margin:0;font-size:.9rem;color:var(--muted);max-width:70ch}
.tabs button{display:inline-flex;align-items:center;gap:.42rem}
.tabs .ico{font-size:1.05em;line-height:1}
.tabs .badge{font-size:.72rem;font-weight:800;background:#ffffff21;border-radius:999px;padding:.04rem .42rem;min-width:1.4rem;text-align:center;font-variant-numeric:tabular-nums}
.tabs button.active .badge{background:#04121f2e}
.tabs .attn{width:.45rem;height:.45rem;border-radius:99px;background:var(--bad);box-shadow:0 0 10px -1px var(--bad)}
.skel{position:relative;overflow:hidden;background:var(--card2);border-color:transparent;color:transparent}
.skel::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,#ffffff14,transparent);transform:translateX(-60%);animation:shimmer 1.4s linear infinite}
@keyframes shimmer{to{transform:translateX(60%)}}
.toast{position:fixed;left:50%;bottom:calc(.7rem + env(safe-area-inset-bottom));transform:translate(-50%,.6rem);z-index:30;display:flex;align-items:center;gap:.55rem;max-width:min(94vw,34rem);border:1px solid var(--line2);background:var(--card);color:var(--text);border-radius:999px;padding:.6rem .95rem;box-shadow:var(--shadow);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;font-size:.92rem}
.toast.show{opacity:1;transform:translate(-50%,0)}
.toast[data-kind=bad]{border-color:color-mix(in srgb,var(--bad) 60%,var(--line))}
.toast[data-kind=ok]{border-color:color-mix(in srgb,var(--ok) 55%,var(--line))}
@media(max-width:61.99em){.toast{bottom:calc(6.4rem + env(safe-area-inset-bottom))}}
.filter{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-top:.75rem}
.filter input{flex:1 1 12rem;min-width:0}
.filter .small{color:var(--muted)}
.guide-card .cmdwrap{display:grid;gap:.35rem}
.guide-card pre{max-height:max(9rem,34vh);transition:max-height .18s ease}
.guide-card.tall pre{max-height:none}
.guide-card .twist{display:inline-block;transition:transform .15s ease;font-size:.8rem}
.guide-card.tall .twist{transform:rotate(180deg)}
.ok-ico{color:var(--ok);font-weight:800}
.bad-ico{color:var(--bad);font-weight:800}
.tbl tr[hidden],.guide-card[hidden]{display:none}
.logbar{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;justify-content:space-between;margin-bottom:.5rem}
@media(prefers-reduced-motion:reduce){.skel::after{animation:none}.toast{transition:none}}
@media(min-width:52em){.hero{grid-template-columns:minmax(0,1fr)}}


.resource-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
.resource-chart{min-width:0;padding:1rem;border:1px solid var(--line);border-radius:.8rem}
.resource-chart h3{margin:0 0 .5rem;font-size:1rem}.resource-value{font-size:1.5rem;font-weight:700;font-variant-numeric:tabular-nums}
.resource-chart svg{display:block;width:100%;height:9rem;margin:.5rem 0;color:#22c55e;background:#64748b12;border-radius:.4rem}
.resource-chart .memory-line{color:#38bdf8}.resource-chart .gridline{stroke:#64748b55;stroke-width:1}
.resource-chart path{fill:none;stroke:currentColor;stroke-width:3;vector-effect:non-scaling-stroke}
@media(max-width:42em){.resource-grid{grid-template-columns:1fr}}
</style></head><body>
<a class="skip" href="#main">Skip to the deployer panels</a>
<noscript><div class="shell"><div class="banner bad" style="margin-top:0">This page needs JavaScript: every button here calls the local deployer API, and without it the page is only text.</div></div></noscript>
<main class="shell">
<header class="hero">
<div class="head-in">
<div class="brand"><span class="logo" aria-hidden="true">⚙</span><div><h1>Scraper4 Local Deployer</h1><p class="tagline">Install, database, local scraper, cloud deploy — one guided dashboard</p></div></div>
<div class="controls">
<span class="stepper" role="group" aria-label="Text size"><button type="button" onclick="bumpFont(-1)" title="Smaller text" aria-label="Smaller text">A−</button><span class="val" id="fontVal" role="status">100%</span><button type="button" onclick="bumpFont(1)" title="Larger text" aria-label="Larger text">A+</button></span>
<button class="chip" id="themeBtn" onclick="toggleTheme()" type="button" title="Switch between the dark and light palette">Light palette</button>
<button class="chip" id="notifyBtn" onclick="armNotify()" type="button" title="Let the browser raise new-version notices in your OS notification centre">🔔 arm notifications</button>
<button class="chip" onclick="refresh()" type="button">Refresh now</button>
</div>
</div>
<div class="pills"><span class="pill">Node ${process.version}</span><span class="pill" title="package.json version — a trailing + is the agent-built release marker">v${pkg.version || '-'}</span><span class="pill" id="autoPill" aria-live="polite">Auto-update: checking…</span><span class="pill">Token protected</span></div>
<div class="rail" id="rail">
<span class="stat" id="railDb"><span class="dot"></span>database <b>checking…</b></span>
<span class="stat" id="railScraper"><span class="dot"></span>scraper <b>checking…</b></span>
<span class="stat" id="railGit"><span class="dot"></span>git <b>checking…</b></span>
<span class="stat" id="railBranch"><span class="dot"></span>newest branch <b>checking…</b></span>
<span class="stat" id="railNotify"><span class="dot"></span>notify <b>checking…</b></span>
<span class="upd" id="updated">not updated yet</span>
</div>
</header>
<div class="grid">
<section id="main" class="stack">
<nav class="tabs" role="tablist" aria-label="Deployer sections"><button role="tab" aria-selected="true" aria-controls="dash" class="active" onclick="tab('dash',this)" type="button"><span class="ico" aria-hidden="true">◧</span>Overview</button><button role="tab" aria-selected="false" aria-controls="database" onclick="tab('database',this)" type="button"><span class="ico" aria-hidden="true">▤</span>Database</button><button role="tab" aria-selected="false" aria-controls="scraper" onclick="tab('scraper',this)" type="button"><span class="ico" aria-hidden="true">▶</span>Local scraper<span class="badge" id="badgeScraper"></span></button><button role="tab" aria-selected="false" aria-controls="guide" onclick="tab('guide',this)" type="button"><span class="ico" aria-hidden="true">⧉</span>Copy commands<span class="badge" id="badgeGuide"></span></button><button role="tab" aria-selected="false" aria-controls="branches" onclick="tab('branches',this)" type="button"><span class="ico" aria-hidden="true">⌥</span>Branches<span class="badge" id="badgeBranches"></span></button><button role="tab" aria-selected="false" aria-controls="jobs" onclick="tab('jobs',this)" type="button"><span class="ico" aria-hidden="true">≡</span>Logs<span class="badge" id="badgeJobs"></span></button><button role="tab" aria-selected="false" aria-controls="pyextract" onclick="tab('pyextract',this)" type="button"><span class="ico" aria-hidden="true">⌛</span>Python extract</button></nav>
<div id="dash" class="panel active" role="tabpanel">
${managedInstance ? '<section class="card" id="managedInstallation"><h2>Independent installation</h2><p>scraper4-managed · separate from WebConsole and scraper4-node. Stop disconnects this panel until SSH start or reboot. Uninstall disables this instance and archives its code, database, vault key and configuration; it does not erase data.</p><label>Type scraper4-managed to confirm <input id="managedConfirm" autocomplete="off"></label><div class="row"><button class="secondary" onclick="installationAction(&quot;stop&quot;)">Stop installation</button><button class="danger" onclick="installationAction(&quot;uninstall&quot;)">Uninstall and archive</button></div><p id="managedResult" role="status"></p></section>' : ''}

<div class="card" id="resourceMonitor">
<div class="card-head"><div class="head-in"><h2>Live environment resources</h2><button id="resourcePause" type="button" class="secondary" aria-pressed="false">Pause charts</button></div>
<p class="muted small">The VPS / Android device running this deployer, not your viewing browser. Updates every 2 seconds; last 6 minutes, held in memory only.</p></div>
<div class="resource-grid">
<div class="resource-chart"><h3>Host CPU · all cores</h3><div class="resource-value" id="resourceCpu">—</div><svg viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label="Host CPU usage history, 0 to 100 percent"><path class="gridline" d="M0 25H600 M0 50H600 M0 75H600"></path><path id="resourceCpuPath"></path></svg><small id="resourceCpuNote">Waiting for two CPU samples…</small></div>
<div class="resource-chart"><h3>Host RAM</h3><div class="resource-value" id="resourceMemory">—</div><svg class="memory-line" viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label="Host memory usage history, 0 to 100 percent"><path class="gridline" d="M0 25H600 M0 50H600 M0 75H600"></path><path id="resourceMemoryPath"></path></svg><small id="resourceMemoryNote">Waiting for memory samples…</small></div>
</div>
<div class="resource-grid">
<div class="resource-chart"><h3>Scraper Node CPU</h3><div class="resource-value" id="resourceScraperCpu">—</div><svg viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label="Scraper CPU history"><path id="resourceScraperCpuPath"></path></svg><small id="resourceScraperCpuScale">100% = one core; chart scales for multiple cores</small></div>
<div class="resource-chart"><h3>Scraper Node RAM · RSS</h3><div class="resource-value" id="resourceScraperRam">—</div><svg class="memory-line" viewBox="0 0 600 100" preserveAspectRatio="none" role="img" aria-label="Scraper memory history"><path id="resourceScraperRamPath"></path></svg><small id="resourceScraperRamScale">Waiting for samples…</small></div>
</div>
<p class="small" id="scraperKeepaliveStatus" role="status">Scraper keepalive: checking…</p>
<p class="small" id="resourceScraperStatus" role="status">Connecting to scraper…</p>
<p class="muted small">Scraper metrics are self-reported by its Node process, including in-process extraction. Chromium, separate workers and other child processes are excluded. Available even when Android blocks host counters.</p>
<p class="small" id="resourceProcess">Deployer process: waiting…</p><p class="small" id="resourceContainer">Container memory: checking…</p>
<p class="muted small">Host totals include other apps and services. Deployer process metrics exclude the scraper, Chromium and other child processes. Android may restrict host counters; missing data is not zero usage.</p>
<p class="muted small" id="resourceStatus" role="status">Connecting to resource monitor…</p>
</div>

<div class="card">
<div class="card-head"><div class="head-in"><h2><span class="ico" aria-hidden="true">◧</span> Project status</h2><span class="pill" id="servingPill">serving: checking…</span></div><p class="muted small">Everything here comes from the local deployer API and refreshes on its own.</p></div>
<div id="status" class="status" aria-live="polite"><div class="metric skel"><small>Package</small><b>·</b></div><div class="metric skel"><small>Version</small><b>·</b></div><div class="metric skel"><small>Database</small><b>·</b></div><div class="metric skel"><small>Scraper</small><b>·</b></div><div class="metric skel"><small>Git</small><b>·</b></div><div class="metric skel"><small>Project</small><b>·</b></div></div>
<div class="row"><button onclick="run('install')" type="button">Install / retry npm</button><button class="success" onclick="run('databaseInstall')" type="button">Install / connect database</button><button onclick="run('localBuild')" type="button">Build local scraper</button><button class="secondary" onclick="updateCode(false)" type="button">Update from GitHub</button><button class="secondary" onclick="refresh()" type="button">Refresh</button></div>
<details class="note"><summary>When the database address is wrong</summary><div><p class="muted">If you see <span class="kbd">getaddrinfo ENOTFOUND HOST</span>, your DATABASE_URL still contains the placeholder HOST. On Windows (and on machines without Docker) the database button now configures the <b>SQLite database built into Node.js</b> automatically - no PostgreSQL install/service is needed.</p></div></details>
</div>
</div>
<div id="database" class="panel" role="tabpanel">
<div class="card">
<div class="card-head"><div class="head-in"><h2><span class="ico" aria-hidden="true">▤</span> Database setup</h2><span class="pill" id="dbPill">method: checking…</span></div><p class="muted small">The deployer auto-detects Termux, Codespaces, desktop, Render, Vercel and Windows, and picks the database that needs no server on that platform.</p></div>
<div class="row"><button class="success" onclick="run('databaseInstall')" type="button">Install database now</button><button class="secondary" onclick="showDbHelp()" type="button">Show panel instructions</button></div>
<details class="note"><summary>How each platform is handled</summary><div><p class="muted">On Windows / machines without Docker it configures the <b>built-in SQLite database</b> (nothing to install). On Docker/Codespaces it starts PostgreSQL automatically; on Render/Cloudflare/Vercel it shows panel instructions.</p></div></details>
<pre id="dbHelp"></pre>
</div>
</div>
<div id="scraper" class="panel" role="tabpanel">
<div class="card">
<div class="card-head"><div class="head-in"><h2><span class="ico" aria-hidden="true">▶</span> Run scraper locally</h2><span class="pill" id="scraperPill">state: checking…</span></div>${managedInstance ? '<p>Use <a href="/scraper/" target="_blank" rel="noreferrer">the authenticated scraper proxy</a>. The scraper port is private; no separate public port is needed.</p>' : '<p>Its own address: <a href="http://localhost:' + scraperPort + '/" target="_blank" rel="noreferrer">http://localhost:' + scraperPort + '/</a> — no token needed, and it stays up after you close this page.</p>'}</div>
<div class="row"><button class="success" onclick="scraperStart()" type="button">Build &amp; start local scraper</button><button class="secondary" onclick="openScraper('/')" type="button">Open scraper dashboard</button><button class="secondary" onclick="openScraper('/health')" type="button">Open /health</button><button class="danger" onclick="scraperStop()" type="button">Stop</button><button class="secondary" onclick="scraperLogs()" type="button">Refresh logs</button></div>
<div id="scraperStale" aria-live="polite"></div>
<details class="note"><summary>What happens on the first start (and the knobs that change it)</summary><div><p class="muted">The scraper starts automatically with the deployer, and the terminal prints its URL under the deployer URL. Use the database button first if DATABASE_URL is missing or contains HOST. Set <span class="kbd">LOCAL_SCRAPER_AUTOSTART=false</span> to stop it starting on its own, or <span class="kbd">LOCAL_SCRAPER_STOP_WITH_UI=true</span> to shut it down together with the deployer. The first start runs <span class="kbd">render:build</span>, which takes tens of seconds on Termux/ARM; Open scraper now waits for that build instead of failing with ECONNREFUSED. The dashboard works the same whether you open it here under /scraper/ or directly on its own port, because it resolves its API calls relative to the address you opened it at. Raise <span class="kbd">LOCAL_SCRAPER_PROXY_WAIT_MS</span> (default 180000) on a very slow device.</p></div></details>
<pre id="scraperLog" aria-live="polite"></pre>
</div>
</div>
<div id="guide" class="panel" role="tabpanel">
<div class="card">
<div class="card-head"><div class="head-in"><h2><span class="ico" aria-hidden="true">⧉</span> Installed libraries by type</h2><span class="pill">from package.json + live probe</span></div><p class="muted small">Generated from package.json plus the required runtime/platform packages, so you can see what is already installed before copying commands.</p></div>
<div id="libraryGroups" class="lib-grid"><div class="lib-card skel"><h3>Loading</h3><small>·</small></div></div>
</div>
<div class="card">
<div class="card-head"><div class="head-in"><h2>One-click copy commands</h2><span class="pill">each card copies on its own</span></div><p class="muted small">Each environment has its own copy button. Paste only plain text into Termux; never paste Markdown links.</p></div>
<div class="filter"><input id="guideFilter" type="text" placeholder="Filter environments — try termux or windows" dir="ltr" autocomplete="off" aria-label="Filter command guides"><span class="small" id="guideCount"></span></div>
<div id="guideCards" class="guide-grid"></div>
</div>
</div>
<div id="branches" class="panel" role="tabpanel">
<div class="card">
<div class="card-head"><div class="head-in"><h2><span class="ico" aria-hidden="true">⌥</span> Repo branches — newest version tracking</h2><span class="pill" id="branchPill">last scan: never</span></div><p class="muted">Every <b id="branchIntervalLabel">1 minute</b> the deployer lists all branches of <span class="kbd">fazilatma/new</span>, reads the Scraper4 version of each one and - when enabled - installs the branch with the <b>newest version</b>. A row button installs a specific branch.</p></div>
<div class="row"><label class="check"><input type="checkbox" id="autoInstallLatest" checked> Auto-install newest version</label><select id="branchInterval" class="auto" aria-label="Scan interval"><option value="1">every 1 minute</option><option value="5">every 5 minutes</option><option value="10">every 10 minutes</option><option value="30">every 30 minutes</option><option value="0">never (manual only)</option></select><button class="secondary" onclick="scanNow()" type="button">Scan now</button><button class="secondary" onclick="renderBranches(true)" type="button">Refresh table</button><button class="secondary" onclick="testNotify()" type="button" title="Send one notification through whichever channel this machine has">Test system notification</button></div>
<div id="branchSummary" class="banner" aria-live="polite"></div>
<div class="filter"><input id="branchFilter" type="text" placeholder="Filter branches" dir="ltr" autocomplete="off" aria-label="Filter branches"><span class="small" id="branchCount"></span></div>
<div class="scrollx"><table class="tbl"><caption class="small muted" style="caption-side:bottom;text-align:left;padding:.5rem 0">On a narrow screen every row turns into a card, so nothing needs sideways scrolling.</caption><thead><tr><th scope="col">Branch</th><th scope="col">Version on branch</th><th scope="col">Installed</th><th scope="col">Last commit</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody id="branchRows"><tr><td colspan="6" class="muted">Loading branches…</td></tr></tbody></table></div>
</div>
</div>
<div id="jobs" class="panel" role="tabpanel">
<div class="card">
<div class="card-head"><div class="head-in"><h2><span class="ico" aria-hidden="true">≡</span> Command output</h2><label class="check"><input type="checkbox" id="logFollow" checked> Follow the log</label></div><p class="muted small">Job output lands here while it runs; the log keeps the last lines of the current job.</p></div>
<pre id="log" aria-live="polite"></pre>
</div>
</div>
<div id="pyextract" class="panel" role="tabpanel">
<div class="card">
<div class="card-head"><div class="head-in"><h2><span class="ico" aria-hidden="true">⌛</span> Automatic extraction with Python</h2><span class="pill" id="pyPill">python: checking…</span></div></div>
<div id="pyStatus" class="banner" style="margin-top:0" aria-live="polite">Checking Python…</div>
<div class="row"><button class="secondary" onclick="pyRefresh()" type="button">Refresh status</button><button onclick="pyInstall()" type="button">Install Python deps</button></div>
<label for="pyUrl">List page URL</label><input id="pyUrl" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://shop.example/category/shoes">
<label for="pySelectors">Explicit selectors (optional JSON)</label><input id="pySelectors" dir="ltr" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder='{"container": "//div[@class=card]"}'>
<div class="row"><button class="success" onclick="pyRun()" type="button">Extract with Python</button></div>
<div id="pyResult"></div>
<details class="note"><summary>What this runner needs and what it does</summary><div><p class="muted">Runs <span class="kbd">scripts/py-auto-extract.py</span> on one list page: no manual selectors needed — the structural parser plus auto-discovery find the products (explicit selectors, including XPath, are optional). Needs <span class="kbd">python3</span> with <span class="kbd">beautifulsoup4</span> (<span class="kbd">lxml</span> for XPath, <span class="kbd">requests</span> for live URLs).</p></div></details>
</div>
</div>
</section>
<aside class="card side" aria-label="Smart setup">
<div class="card-head"><div class="head-in"><h2><span class="ico" aria-hidden="true">✦</span> Smart setup</h2></div></div>
<div id="detected" class="banner" style="margin-top:0" aria-live="polite">Detecting environment…</div>
<label for="env">Environment</label><select id="env"><option value="vscode">VS Code / Desktop</option><option value="windows">Windows local</option><option value="termux-offline">Termux / Android</option><option value="cloudflare-worker">Cloudflare Worker</option><option value="vercel">Vercel</option><option value="render">Render</option><option value="vps">VPS</option></select>
<label for="libs">Scraping libraries</label><select id="libs"><option value="minimal">Minimal</option><option value="edge">Edge / Cloudflare-friendly</option><option value="node" selected>Node scraping stack</option><option value="browser">Browser rendering stack</option><option value="full">Full stack</option></select>
<p class="small muted">The installed library inventory is grouped in the Copy commands tab.</p>
<label for="pm">Package manager</label><select id="pm"><option>npm</option><option>pnpm</option><option>yarn</option><option>bun</option></select>
<label for="port">Port</label><input id="port" value="3000" inputmode="numeric" pattern="[0-9]*" dir="ltr" autocomplete="off">
<div class="steps"><div class="step"><span class="num">1</span><div><b>Install deps</b><br><span class="muted small">npm dependencies and scraper libraries.</span></div></div><div class="step"><span class="num">2</span><div><b>Install/connect database</b><br><span class="muted small">Automatic where possible; panel instructions elsewhere.</span></div></div><div class="step"><span class="num">3</span><div><b>Start scraper</b><br><span class="muted small">Open the scraper dashboard after it starts.</span></div></div></div>
</aside>
</div>
</main>
<output class="toast" id="toast" aria-live="polite"><span class="msg"></span></output>
<nav class="dock" aria-label="Primary actions">
<button class="success primary" onclick="scraperStart()" type="button">Build &amp; start local scraper</button>
<button class="secondary" onclick="openScraper('/')" type="button">Open scraper</button>
<button class="secondary" onclick="refresh()" type="button">Refresh</button>
</nav>
<script>
const TOKEN = ${JSON.stringify(token)};
const COMMANDS = ${JSON.stringify(commands)};
const LIBRARY_GROUPS_BY_ENV = ${JSON.stringify(installedLibraryCatalog())};
let activeJob = '';
const $ = id => document.getElementById(id);
const logError = err => {
  const msg = 'UI/API error: ' + (err && err.message ? err.message : String(err));
  const log = $('log');
  const db = $('dbHelp');
  if (log) log.textContent = msg;
  toast(msg, 'bad');
  if (db && !db.textContent) db.textContent = msg;
  console.error(err);
};
const THEME_KEY = 'scraper4-deployer-theme';
function applyDeployerTheme(mode) {
  // One attribute on the root element switches palettes; the stylesheet owns every colour,
  // so nothing here needs to know a single value.
  document.documentElement.dataset.theme = mode;
  const btn = $('themeBtn');
  if (btn) btn.textContent = mode === 'light' ? 'Dark palette' : 'Light palette';
  try { localStorage.setItem(THEME_KEY, mode); } catch (err) { /* private mode: not important */ }
}
function toggleTheme() {
  applyDeployerTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}
(function initDeployerTheme() {
  let saved = '';
  try { saved = localStorage.getItem(THEME_KEY) || ''; } catch (err) { saved = ''; }
  applyDeployerTheme(saved === 'light' || saved === 'dark' ? saved
    : (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
})();

const TEXT_KEY = 'scraper4-deployer-text';
// Browser zoom and the OS slider already work because every length in this page is rem/em, but on
// a phone at 400% zoom people still ask for one more notch. Root font-size is the only knob that
// scales text, padding, tap targets and the em breakpoints together, so this is real zoom rather
// than a text-only hack that breaks the layout.
const TEXT_STEPS = [100, 112.5, 125, 137.5];
let textStep = 0;
function applyTextSize(step) {
  textStep = Math.max(0, Math.min(TEXT_STEPS.length - 1, step));
  document.documentElement.style.fontSize = TEXT_STEPS[textStep] + '%';
  const val = $('fontVal');
  if (val) val.textContent = TEXT_STEPS[textStep] + '%';
  try { localStorage.setItem(TEXT_KEY, String(textStep)); } catch (err) { /* private mode */ }
}
function bumpFont(delta) { applyTextSize(textStep + (delta > 0 ? 1 : -1)); toast('Text size ' + TEXT_STEPS[textStep] + '%'); }
(function initTextSize() {
  let saved = NaN;
  try { saved = Number(localStorage.getItem(TEXT_KEY)); } catch (err) { saved = NaN; }
  applyTextSize(Number.isFinite(saved) ? saved : 0);
})();

let toastTimer = 0;
function toast(message, kind) {
  const el = $('toast');
  if (!el) return;
  const msg = el.querySelector('.msg');
  if (msg) msg.textContent = String(message);
  el.dataset.kind = kind || '';
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2800);
}

function followLog(el, force) {
  if (!el) return;
  if (!force) {
    const cb = $('logFollow');
    if (cb && !cb.checked) return;
  }
  el.scrollTop = el.scrollHeight;
}

// The browser half of the announcement. The server fires the OS notifier; this covers a machine
// with no CLI notifier, or a headless VPS where somebody is nevertheless watching the page. The
// "already told you" memory is kept per version key in localStorage, so the five-second poll
// cannot nag about the same release.
const NOTIFY_SEEN_KEY = 'scraper4-deployer-notified';
function notifySeenKeys() {
  try { return String(localStorage.getItem(NOTIFY_SEEN_KEY) || '').split('|').filter(Boolean); } catch (err) { return []; }
}
function notifySeenBefore(key) { return notifySeenKeys().includes(key); }
function markNotifySeen(key) {
  try { localStorage.setItem(NOTIFY_SEEN_KEY, notifySeenKeys().concat(key).slice(-12).join('|')); } catch (err) { /* private mode */ }
}
function notifyPermission() { return (window.Notification && Notification.permission) || 'unsupported'; }
function paintNotifyButton(state) {
  const btn = $('notifyBtn');
  if (!btn) return;
  const value = state || notifyPermission();
  btn.textContent = value === 'granted' ? '🔔 notifications armed' : value === 'denied' ? '🔕 notifications blocked' : value === 'unsupported' ? '🔕 no browser notifications' : '🔔 arm notifications';
  btn.title = value === 'granted' ? 'The browser raises new-version notices in your OS notification centre'
    : value === 'denied' ? 'Your browser is blocking notifications for this site; unblock it in site settings'
    : 'Let the browser raise new-version notices in your OS notification centre';
  btn.dataset.state = value;
}
function armNotify() {
  if (!window.Notification) { toast('This browser has no Notification API — the deployer still notifies through your system notifier', 'bad'); return; }
  if (Notification.permission === 'granted') { try { new Notification('Scraper4 deployer', { body: 'Notifications are armed from this page.', tag: 'scraper4-arm' }); } catch (err) { /* ignored */ } toast('Browser notifications armed', 'ok'); paintNotifyButton('granted'); return; }
  Promise.resolve(Notification.requestPermission()).then(function (state) {
    paintNotifyButton(state);
    toast(state === 'granted' ? 'Browser notifications armed' : 'Permission not granted — notices stay with the system channel', state === 'granted' ? 'ok' : 'bad');
  }).catch(function (error) { logError(error); });
}
function announceBrowserNotice(d) {
  const notify = (d && d.notify) || {};
  const chip = $('railNotify');
  const recent = notify.recent || [];
  if (chip) {
    const label = notify.channel ? notify.channel.label : (notify.enabled === false ? 'off' : 'no notifier');
    const delivered = recent.some(function (entry) { return entry.ok; });
    chip.className = 'stat' + (delivered ? ' ok' : ' warn');
    chip.innerHTML = '<span class="dot"></span>notify <b>' + escHtml(label) + (recent.length ? ' · ' + recent.length + ' noticed' : '') + '</b>';
  }
  const latest = recent[0];
  if (!latest || notifySeenBefore(latest.key)) return;
  markNotifySeen(latest.key);
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification(latest.title, { body: latest.body, tag: 'scraper4-' + latest.kind, requireInteraction: latest.kind === 'newer-branch' }); } catch (err) { /* some platforms need a service worker */ }
  }
  toast(latest.title, 'ok');
  badge('branches', '!');
}
async function testNotify() {
  try {
    const d = await api('/api/notifications/test', { method: 'POST', body: '{}' });
    toast(d.ok ? 'Test notification sent via ' + (d.label || d.channel) : 'No system notification: ' + (d.error || 'unknown'), d.ok ? 'ok' : 'bad');
    refresh();
  } catch (error) { logError(error); }
}
window.armNotify = armNotify;
window.testNotify = testNotify;
paintNotifyButton();

let lastRefreshAt = 0;
function tickUpdated() {
  const el = $('updated');
  if (!el) return;
  el.textContent = lastRefreshAt
    ? 'updated ' + Math.max(0, Math.round((Date.now() - lastRefreshAt) / 1000)) + 's ago'
    : 'not updated yet';
}

function statChip(id, kind, label, valueHtml) {
  const el = $(id);
  if (!el) return;
  el.className = 'stat' + (kind ? ' ' + kind : '');
  el.innerHTML = '<span class="dot ' + (kind || '') + '"></span>' + escHtml(label) + ' <b>' + valueHtml + '</b>';
}

function badge(panelId, text) {
  const el = $('badge' + panelId.charAt(0).toUpperCase() + panelId.slice(1));
  if (el) el.textContent = text || '';
  const tabBtn = document.querySelector('.tabs button[aria-controls="' + panelId + '"]');
  if (!tabBtn) return;
  const has = Boolean(tabBtn.querySelector('.attn'));
  if (text === '!' && !has) {
    const dot = document.createElement('span');
    dot.className = 'attn';
    tabBtn.appendChild(dot);
  } else if (text !== '!' && has) {
    tabBtn.querySelector('.attn').remove();
  }
}

function updateRail(d) {
  const db = d.database || {}, scraper = d.scraper || {}, git = d.git || {}, code = d.code || {}, br = d.branches || {};
  const keep=d.keepalive||{};if($('scraperKeepaliveStatus'))$('scraperKeepaliveStatus').textContent='Scraper keepalive: '+(keep.enabled?(keep.desired?'enabled':'paused'):'disabled')+' · restarts '+(keep.restarts||0)+' · '+(keep.lastReason||'unknown')+(keep.nextRestartAt?' · retry '+new Date(keep.nextRestartAt).toLocaleTimeString():'');
  const serving = scraper.serving || {};
  const dirtyCount = String(git.dirty || '').split(String.fromCharCode(10)).filter(Boolean).length;
  const dbOk = Boolean(db.configured) && !db.rawHasPlaceholder;
  statChip('railDb', dbOk ? 'ok' : 'warn', 'database', escHtml(db.methodLabel || (db.configured ? 'configured' : 'missing')));
  statChip('railScraper', scraper.running ? (serving.stale ? 'warn' : 'ok') : 'bad', 'scraper',
    escHtml(scraper.running ? (serving.stale ? 'stale build on :' + scraper.port : 'live on :' + scraper.port) : (scraper.exitCode ? 'stopped (exit ' + scraper.exitCode + ')' : 'stopped')));
  statChip('railGit', dirtyCount ? 'warn' : 'ok', 'git',
    escHtml((git.branch || '-') + (git.commit ? ' ' + String(git.commit).slice(0, 40) : '')) + (dirtyCount ? ' <b>' + dirtyCount + ' changed</b>' : ''));
  statChip('railBranch', br.latest && br.latest.version ? 'ok' : 'warn', 'newest branch',
    br.latest ? escHtml((br.latest.name || '?') + ' v' + (br.latest.version || '?')) : 'not scanned yet');
  const servingPill = $('servingPill');
  if (servingPill) servingPill.textContent = code.stale
    ? 'running v' + (code.running || '?') + ', disk has v' + (code.onDisk || '?')
    : 'running v' + (code.running || (d.package && d.package.version) || '?');
  const dbPill = $('dbPill');
  if (dbPill) dbPill.textContent = 'method: ' + (db.methodLabel || db.method || 'unknown');
  const scraperPill = $('scraperPill');
  if (scraperPill) scraperPill.textContent = scraper.running ? ('pid ' + (scraper.pid || '?') + ' · port ' + scraper.port) : 'not running';
  badge('scraper', scraper.running ? (serving.stale ? '!' : 'live') : '');
  badge('jobs', (d.jobs || []).some(function (j) { return j.running; }) ? 'running' : '');
  const branchPill = $('branchPill');
  if (branchPill) branchPill.textContent = 'last scan: ' + (br.lastScanAt ? new Date(br.lastScanAt).toLocaleTimeString() : 'never')
    + (br.scanning ? ' (scanning now)' : '') + (br.count ? ' · ' + br.count + ' branches' : '');
}

function toggleCmd(btn) {
  const card = btn && btn.closest ? btn.closest('.guide-card') : null;
  if (!card) return;
  card.classList.toggle('tall');
  const twist = card.querySelector('.twist');
  if (twist) twist.textContent = card.classList.contains('tall') ? '▲' : '▼';
}

function filterGuides() {
  const needle = String(($('guideFilter') || {}).value || '').trim().toLowerCase();
  let shown = 0;
  const cards = document.querySelectorAll('#guideCards .guide-card');
  Array.prototype.forEach.call(cards, function (card) {
    const hit = !needle || String(card.textContent || '').toLowerCase().indexOf(needle) >= 0;
    card.hidden = !hit;
    if (hit) shown++;
  });
  const count = $('guideCount');
  if (count) count.textContent = needle ? shown + ' of ' + cards.length + ' environments match' : cards.length + ' environments';
}


// Bounded server history, relative authenticated URL, and no overlapping polls.
let resourcesBusy=false, resourcesPaused=false;
function resourcePercent(value){return Number.isFinite(value)?value.toFixed(1)+'%':'Unavailable';}
function resourceBytes(value){if(!Number.isFinite(value))return 'Unavailable';return (value/1073741824).toFixed(2)+' GiB';}
function resourcePath(samples,field,maximum=100){
  let drawing=false;return samples.map(function(sample,index){const value=field(sample);if(!Number.isFinite(value)){drawing=false;return '';}
    const x=samples.length>1?index/(samples.length-1)*600:0,y=100-Math.max(0,Math.min(100,value/maximum*100));
    const point=(drawing?'L':'M')+x.toFixed(1)+' '+y.toFixed(1);drawing=true;return point;
  }).join(' ');
}
function renderResources(data){
  const rows=Array.isArray(data.samples)?data.samples.slice(-180):[],last=rows[rows.length-1];
  if(!last){$('resourceStatus').textContent='Resource data unavailable';return;}
  $('resourceCpu').textContent=resourcePercent(last.cpuPercent);
  $('resourceMemory').textContent=resourcePercent(last.memory&&last.memory.percent);
  $('resourceCpuPath').setAttribute('d',resourcePath(rows,function(r){return r.cpuPercent;}));
  $('resourceMemoryPath').setAttribute('d',resourcePath(rows,function(r){return r.memory&&r.memory.percent;}));
  $('resourceCpuNote').textContent=Number.isFinite(last.cpuPercent)?'0–100% of all host cores combined':'CPU counters unavailable or warming up (Android may restrict them).';
  $('resourceMemoryNote').textContent=last.memory?resourceBytes(last.memory.used)+' / '+resourceBytes(last.memory.total)+' · '+last.memory.source:'Host RAM counters unavailable';
  const scraper=last.scraper;
  const cpuMax=Math.max(100,...rows.map(function(r){return Number.isFinite(r.scraper&&r.scraper.cpuPercent)?r.scraper.cpuPercent:0;}));
  const ramMax=Math.max(1048576,...rows.map(function(r){return Number.isFinite(r.scraper&&r.scraper.rss)?r.scraper.rss:0;}));
  $('resourceScraperCpu').textContent=resourcePercent(scraper&&scraper.cpuPercent);
  $('resourceScraperRam').textContent=resourceBytes(scraper&&scraper.rss);
  $('resourceScraperCpuPath').setAttribute('d',resourcePath(rows,function(r){return r.scraper&&r.scraper.cpuPercent;},cpuMax));
  $('resourceScraperRamPath').setAttribute('d',resourcePath(rows,function(r){return r.scraper&&r.scraper.rss;},ramMax));
  $('resourceScraperCpuScale').textContent='Scale: 0–'+resourcePercent(cpuMax)+' · 100% = one core';
  $('resourceScraperRamScale').textContent='Scale: 0–'+resourceBytes(ramMax)+' · RSS includes Node heap and native allocations';
  $('resourceScraperStatus').textContent=scraper&&scraper.status==='available'?'Scraper PID '+scraper.pid+' · Node process only'+(scraper.cpuPercent===null?' · CPU warming up after start/reconnect':''):(scraper&&scraper.reason||'Scraper metrics unavailable');
  $('resourceProcess').textContent='Deployer process only: RAM '+resourceBytes(last.rss)+' · CPU '+resourcePercent(last.processCpuPercent)+' (100% = one core)';
  $('resourceContainer').textContent=last.containerMemory?'Container RAM (cgroup v2): '+resourceBytes(last.containerMemory.used)+' / '+resourceBytes(last.containerMemory.total)+' · '+resourcePercent(last.containerMemory.percent):'Container RAM limit: unavailable or not configured';
  $('resourceStatus').textContent=(Date.now()-last.at>10000?'Stale sample · ':'Live · ')+(data.termux?'Termux / Android':String(data.platform||'host'))+' · '+new Date(last.at).toLocaleTimeString()+' · '+rows.length+' samples';
}
async function refreshResources(){
  if(resourcesBusy||resourcesPaused||document.hidden)return;
  resourcesBusy=true;const controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},5000);
  try{const data=await api('/api/resources',{signal:controller.signal});if(!resourcesPaused)renderResources(data);}
  catch(error){if(!resourcesPaused)$('resourceStatus').textContent='Resource connection unavailable; chart may be stale. '+error.message;}
  finally{clearTimeout(timeout);resourcesBusy=false;}
}
function toggleResources(){resourcesPaused=!resourcesPaused;$('resourcePause').textContent=resourcesPaused?'Resume charts':'Pause charts';$('resourcePause').setAttribute('aria-pressed',String(resourcesPaused));if(resourcesPaused)$('resourceStatus').textContent='Charts paused';else refreshResources();}
async function installationAction(action) {
  const result=$('managedResult'),confirmation=$('managedConfirm').value.trim();
  if(confirmation!=='scraper4-managed'){result.textContent='Type scraper4-managed exactly. Nothing was requested.';return;}
  const buttons=document.querySelectorAll('#managedInstallation button');buttons.forEach(b=>b.disabled=true);result.textContent='Submitting '+action+' request…';
  try{const d=await api('/api/installation/action',{method:'POST',body:JSON.stringify({action,confirmation})});result.textContent=d.message;}catch(e){result.textContent=e.message+' If the panel disconnected, check the control journal through SSH before retrying.';buttons.forEach(b=>b.disabled=false);}
}
async function api(path, opt = {}) {
  const r = await fetch(path, { ...opt, headers: { 'content-type': 'application/json', 'x-local-deployer-token': TOKEN, ...(opt.headers || {}) } });
  const d = await r.json();
  if (!r.ok || d.ok === false) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}
function selectTab(id, btn) {
  document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
  const panel = $(id);
  if (panel) panel.classList.add('active');
  document.querySelectorAll('.tabs button').forEach(x => {
    x.classList.remove('active');
    x.setAttribute('aria-selected', 'false');
  });
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const flag = btn.querySelector('.attn');
    if (flag) flag.remove();
    // On a phone (or at 400% zoom) the tab strip scrolls sideways; bring the chosen tab into
    // view without disturbing the vertical scroll the user was reading at.
    try { btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch (err) { /* older engines */ }
  }
}
function tab(id, btn) { selectTab(id, btn); }
function tabByIndex(id, index) { selectTab(id, document.querySelectorAll('.tabs button')[index]); }
function requestBody(action) {
  return JSON.stringify({
    action,
    env: $('env')?.value || 'vscode',
    scrapingLibs: $('libs')?.value || 'node',
    packageManager: $('pm')?.value || 'npm',
    port: $('port')?.value || '3000',
    dryRun: true
  });
}
async function run(action) {
  try {
    activeJob = action;
    $('log').textContent = 'Starting ' + action + '...';
    selectTab('jobs');
    const d = await api('/api/job', { method: 'POST', body: requestBody(action) });
    if (d.instructions) {
      $('log').textContent = d.instructions;
      $('dbHelp').textContent = d.instructions;
      return;
    }
    pollJobs();
  } catch (err) { logError(err); }
}
async function pollJobs() {
  try {
    const data = await api('/api/jobs');
    const job = data.jobs.find(j => j.name === activeJob) || data.jobs.at(-1);
    if (job) $('log').textContent = '$ ' + job.command + String.fromCharCode(10,10) + job.log;
    followLog($('log'), false);
    if (job?.running) { badge('jobs', 'running'); setTimeout(pollJobs, 1200); } else badge('jobs', job && job.ok === false ? '!' : '');
    refresh();
  } catch (err) { logError(err); }
}
function servingLabel(scraper) {
  const serving = scraper.serving || {};
  if (serving.stale && serving.version !== serving.onDisk) return 'STALE v' + (serving.version || '?') + '->v' + (serving.onDisk || '?');
  if (serving.stale) return 'STALE v' + (serving.version || '?') + ' (old commit)';
  if (serving.reachable && serving.version) return 'Running v' + serving.version;
  if (serving.reachable) return 'Occupied (not our scraper)';
  return scraper.running ? 'Starting...' : 'Stopped';
}
async function pyRefresh() {
  try {
    const d = await api('/api/py/status');
    const s = d.status || {};
    const pill = (label, good) => '<span class="pill">' + (good ? '✓ ' : '✗ ') + label + '</span>';
    $('pyStatus').innerHTML = (s.python ? pill('Python ' + s.version, true) : pill('Python missing', false))
      + pill('bs4', s.hasBs4) + pill('lxml', s.hasLxml) + pill('requests', s.hasRequests)
      + (s.scriptExists ? '' : pill('py-auto-extract.py missing', false));
    const pyPill = $('pyPill');
    if (pyPill) pyPill.textContent = s.python ? ('python ' + (s.version || '?') + ' ready') : 'python missing';
  } catch (err) { $('pyStatus').textContent = 'Status check failed: ' + (err && err.message ? err.message : err); }
}
async function pyInstall() {
  try { $('pyStatus').textContent = 'Installing beautifulsoup4 lxml requests (watch the Logs tab)…'; await api('/api/py/install', { method: 'POST', body: '{}' }); setTimeout(pyRefresh, 15000); }
  catch (err) { $('pyStatus').textContent = 'Install failed: ' + (err && err.message ? err.message : err); }
}
async function pyRun() {
  const box = $('pyResult');
  const url = ($('pyUrl') && $('pyUrl').value || '').trim();
  if (!url) { box.innerHTML = '<div class="banner">Enter a list page URL first.</div>'; return; }
  box.innerHTML = '<div class="banner">Extracting with Python…</div>';
  try {
    const d = await api('/api/py/extract', { method: 'POST', body: JSON.stringify({ url: url, selectors: ($('pySelectors') && $('pySelectors').value || '') }) });
    const products = Array.isArray(d.products) ? d.products : [];
    let html = '<div class="banner">' + d.total + ' products · ' + (d.elapsedMs || 0) + 'ms · parser ' + escHtml(String((d.diag || {}).parser || '?')) + (d.truncated ? ' · truncated to ' + products.length : '') + '</div>';
    const disc = d.discovered || {};
    html += '<h3>Discovered selectors (' + escHtml(String(disc.method || 'none')) + (disc.ok ? ', verified' : '') + ')</h3><pre>' + escHtml(JSON.stringify(disc.selectors || {}, null, 1)) + '</pre>';
    if (!products.length) { html += '<div class="banner">No products on this page. The fetch may have hit a shell/bot wall — check the URL in a browser.</div>'; }
    else {
      html += '<div style="overflow:auto"><table class="tbl"><thead><tr><th>#</th><th>Title</th><th>Price</th><th>Link</th><th>Image</th></tr></thead><tbody>';
      products.forEach((p, i) => {
        html += '<tr><td data-label="#">' + i + '</td><td data-label="Title">' + escHtml(String(p.title || '')) + '</td><td data-label="Price">' + escHtml(String(p.price || '')) + '</td><td data-label="Link">' + (p.link ? '<a href="' + escHtml(String(p.link)) + '" target="_blank" rel="noreferrer">open</a>' : '<span class="muted">—</span>') + '</td><td data-label="Image">' + (p.image ? 'yes' : 'NO') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    box.innerHTML = html;
  } catch (err) { box.innerHTML = '<div class="banner">Extraction failed: ' + escHtml(err && err.message ? err.message : String(err)) + '</div>'; }
}
async function scraperStart() { try { await api('/api/scraper/start', { method: 'POST', body: '{}' }); scraperLogs(); } catch (err) { logError(err); } }
function scraperUrl(path = '/') {
  const clean = path.startsWith('/') ? path : '/' + path;
  return '/scraper' + (clean === '/' ? '/' : clean);
}
function openScraper(path = '/') { window.open(scraperUrl(path), '_blank', 'noopener,noreferrer'); }
async function scraperRestart() { try { await api('/api/scraper/restart', { method: 'POST', body: '{}' }); scraperLogs(); } catch (err) { logError(err); } }
async function scraperStop() { try { await api('/api/scraper/stop', { method: 'POST', body: '{}' }); scraperLogs(); } catch (err) { logError(err); } }
async function scraperLogs() {
  try {
    const d = await api('/api/scraper/logs');
    $('scraperLog').textContent = d.log || 'No logs yet.';
    followLog($('scraperLog'), Boolean(d.scraper?.running));
    refresh();
    if (d.scraper?.running) setTimeout(scraperLogs, 1500);
  } catch (err) { logError(err); }
}
async function updateCode(force) {
  try {
    $('log').textContent = 'Updating from GitHub...';
    selectTab('jobs');
    const d = await api('/api/update', { method: 'POST', body: JSON.stringify({ force, restart: true }) });
    $('log').textContent = JSON.stringify(d, null, 2) + String.fromCharCode(10,10) + 'If update succeeded, wait a few seconds and refresh.';
    setTimeout(() => location.reload(), 3500);
  } catch (err) { logError(err); }
}


function escHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch;
  });
}
async function scanNow() {
  try {
    const sum = $('branchSummary'); if (sum) sum.textContent = 'Scanning all branches...';
    const d = await api('/api/branches/scan', { method: 'POST', body: '{}' });
    await renderBranchesData(d, true);
  } catch (err) { logError(err); }
}
async function installBranch(name, btn) {
  try {
    // No blocking popup. Installing resets the checkout to origin/<branch>, so the
    // button arms itself on the first click and installs on a second click within
    // 5 seconds: non-modal, but impossible to trigger with one stray click.
    if (btn && btn.dataset.armed !== '1') {
      const label = btn.dataset.label || btn.textContent;
      btn.dataset.label = label;
      btn.dataset.armed = '1';
      btn.textContent = 'Click again to confirm';
      btn.classList.add('warn');
      const armSum = $('branchSummary');
      if (armSum) armSum.textContent = 'Installing ' + name + ' resets local changes to origin/' + name + ' and reinstalls dependencies. Click the button again within 5 seconds to continue.';
      clearTimeout(btn.armTimer);
      btn.armTimer = setTimeout(function () { btn.dataset.armed = ''; btn.textContent = label; btn.classList.remove('warn'); }, 5000);
      return;
    }
    if (btn) { clearTimeout(btn.armTimer); btn.dataset.armed = ''; btn.classList.remove('warn'); btn.disabled = true; btn.textContent = 'Installing...'; }
    const sum = $('branchSummary'); if (sum) sum.textContent = 'Installing branch ' + name + ' - the UI restarts automatically.';
    const d = await api('/api/branches/install', { method: 'POST', body: JSON.stringify({ branch: name }) });
    if (!d.ok) throw new Error(d.error || 'Install failed');
    setTimeout(function () { location.reload(); }, 3000);
  } catch (err) { logError(err); }
}
async function repairOrigin() {
  try {
    const sum = $('branchSummary'); if (sum) sum.textContent = 'Adding the missing origin remote and rescanning...';
    const d = await api('/api/branches/repair-origin', { method: 'POST', body: '{}' });
    await renderBranchesData(d, true);
  } catch (err) { logError(err); }
}
async function branchConfigChanged() {
  try {
    const minutes = Number($('branchInterval')?.value || '1');
    const intervalSeconds = minutes > 0 ? Math.round(minutes * 60) : 0;
    const auto = Boolean($('autoInstallLatest')?.checked);
    const d = await api('/api/branches/config', { method: 'POST', body: JSON.stringify({ intervalSeconds: intervalSeconds, autoInstallLatest: auto }) });
    await renderBranchesData(d, true);
  } catch (err) { logError(err); }
}
function shortSha(sha) { return sha ? String(sha).slice(0, 7) : ''; }
let lastBranchPayload = null;
function renderBranchesData(d, force) {
  const rows = $('branchRows');
  if (!rows) return;
  lastBranchPayload = d;
  const summary = $('branchSummary');
  const latest = d.latest || null;
  const currentName = (d.current && d.current.branch) || '';
  const installedVersion = (d.installed && d.installed.version) || '';
  const parts = [];
  if (d.repair && d.repair.message) parts.push(escHtml(d.repair.message));
  if (d.origin && d.origin.present === false) parts.push('No "origin" remote in this checkout <button class="secondary" onclick="repairOrigin()">Repair origin remote</button>');
  if (!d.enabled) parts.push('Auto scan disabled (LOCAL_DEPLOYER_AUTO_UPDATE=false) - use Scan now / Install manually.');
  if (latest) parts.push('Newest version: ' + escHtml(latest.version) + ' on branch ' + escHtml(latest.name));
  parts.push('Installed: v' + escHtml(installedVersion || '-'));
  parts.push(d.intervalMs > 0 ? 'Auto scan: every ' + Math.max(1, Math.round(d.intervalMs / 60000)) + ' min' : 'Auto scan timer: off');
  parts.push('Auto-install newest: ' + (d.autoInstallLatestEnabled ? 'ON' : 'OFF'));
  if (d.lastScanAt) parts.push('Last scan: ' + String(d.lastScanAt).replace('T', ' ').slice(0, 19) + (d.lastScanMs != null ? ' (' + d.lastScanMs + ' ms)' : ''));
  if (d.lastScanError) parts.push('Last scan error: ' + escHtml(d.lastScanError));
  if (summary) summary.innerHTML = '<b>Branches:</b> ' + parts.join(' \\u00b7 ');
  const autoEl = $('autoInstallLatest'); const ivEl = $('branchInterval');
  if (autoEl) autoEl.checked = Boolean(d.autoInstallLatestEnabled);
  if (ivEl) {
    const mins = d.intervalMs > 0 ? Math.max(1, Math.round(d.intervalMs / 60000)) : 0;
    ivEl.value = String([1, 5, 10, 30, 0].indexOf(mins) >= 0 ? mins : 1);
    const lab = $('branchIntervalLabel');
    if (lab) lab.textContent = d.intervalMs > 0 ? String(Math.max(1, Math.round(d.intervalMs / 60000))) + ' minute(s)' : 'manual (timer off)';
  }
  const needle = String(($('branchFilter') || {}).value || '').trim().toLowerCase();
  const all = d.branches || [];
  const list = needle
    ? all.filter(function (b) { return String(b.name || '').toLowerCase().indexOf(needle) >= 0 || String(b.version || '').toLowerCase().indexOf(needle) >= 0; })
    : all;
  const countEl = $('branchCount');
  if (countEl) countEl.textContent = needle ? list.length + ' of ' + all.length + ' branches match' : all.length + ' branches';
  badge('branches', String(all.length));
  if (!list.length && needle) {
    rows.innerHTML = '<tr><td colspan="6" class="muted">No branch name or version contains “' + escHtml(needle) + '”.</td></tr>';
    return;
  }
  if (!list.length) {
    rows.innerHTML = '<tr><td colspan="6" class="muted">No remote branches found yet. If this is a fresh clone wait for the first scan or press Scan now.</td></tr>';
    return;
  }
  const sorted = list.slice().sort(function (a, b) {
    const ai = a.isCurrent ? 0 : 1; const bi = b.isCurrent ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return String(b.name).localeCompare(String(a.name));
  });
  rows.innerHTML = sorted.map(function (b) {
    const isCurrent = b.name === currentName;
    const isLatest = Boolean(latest && b.name === latest.name);
    const hasCode = Boolean(b.hasCode);
    const versionCell = !hasCode ? '- (no scraper code)' : (b.version ? escHtml(b.version) : '- (no version field)');
    const statusCell = isCurrent ? (isLatest ? '\\u2713 current + newest' : '\\u2713 current') : (isLatest ? '\\u2605 newest (auto target)' : '');
    let actionCell = '-';
    if (hasCode) {
      actionCell = isCurrent
        ? '<span class="muted small">installed</span> <button class="secondary" onclick="updateCode(true)">Update branch</button>'
        : '<button class="success" onclick="installBranch(' + String.fromCharCode(39) + b.name + String.fromCharCode(39) + ', this)">Install</button>';
    }
    return '<tr' + (isCurrent ? ' class="current"' : '') + '>' +
      '<td data-label="Branch"><code>' + escHtml(b.name) + '</code></td>' +
      '<td data-label="On branch" class="num"><b>' + versionCell + '</b></td>' +
      '<td data-label="Installed" class="num">' + escHtml(installedVersion) + '</td>' +
      '<td data-label="Last commit"><code>' + escHtml(shortSha(b.sha)) + '</code><br><small>' + escHtml(b.date || '') + '</small></td>' +
      '<td data-label="Status">' + statusCell + '</td><td data-label="Action">' + actionCell + '</td></tr>';
  }).join('');
  if (d.scanning) setTimeout(function () { renderBranches(true); }, 1800);
}
async function renderBranches(force) {
  try {
    const d = await api('/api/branches');
    await renderBranchesData(d, Boolean(force));
  } catch (err) { logError(err); }
}

async function renderLibraries() {
  const root = $('libraryGroups');
  if (!root) return;
  const env = $('env')?.value || 'vscode';
  root.innerHTML = '<div class="lib-card"><h3>Live query</h3><small>checking installed libraries…</small></div>';
  try {
    const data = await api('/api/libraries?env=' + encodeURIComponent(env));
    const groups = data.groups || [];
    root.innerHTML = groups.map(group => '<div class="lib-card"><h3>' + group.label + '</h3><small>' + (data.dynamic ? 'live query · ' : '') + (data.environment || env) + '</small><div>' + (group.items || []).map(item => '<code title="' + (item.version || item.source || '') + '">' + (item.available ? '✅ ' : '❌ ') + item.name + '</code>').join(' ') + '</div></div>').join('');
  } catch (error) {
    const groups = LIBRARY_GROUPS_BY_ENV[env] || LIBRARY_GROUPS_BY_ENV.vscode;
    root.innerHTML = groups.map(group => '<div class="lib-card"><h3>' + group.label + '</h3><small>' + group.type + ' · fallback</small><div>' + group.items.map(item => '<code title="' + (item.version || '') + '">' + item.name + '</code>').join(' ') + '</div></div>').join('');
  }
}
function renderGuides() {
  const container = $('guideCards');
  if (!container) return;
  const names = Object.keys(COMMANDS);
  container.innerHTML = names.map((name, i) => '<div class="guide-card"><h3>' + name + '</h3><div class="row"><button class="secondary" onclick="copyCommand(' + i + ',this)">Copy all</button><button class="secondary" onclick="downloadCommand(' + i + ')">Download executable script</button><button class="chip" onclick="toggleCmd(this)" type="button"><span class="twist">▼</span> full script</button><span class="copy-ok" id="copied' + i + '"></span></div><pre id="cmd' + i + '"></pre></div>').join('');
  Object.values(COMMANDS).forEach((cmd, i) => { $('cmd' + i).textContent = cmd; });
  filterGuides();
  badge('guide', String(names.length));
}
function commandFileName(name) {
  if (/PowerShell/i.test(name)) return 'scraper4-install-windows.ps1';
  if (/Command Prompt/i.test(name)) return 'scraper4-install-windows.cmd';
  if (/Termux/i.test(name)) return 'scraper4-install-termux.sh';
  if (/VPS/i.test(name)) return 'scraper4-install-vps.sh';
  return 'scraper4-' + String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.txt';
}
function windowsLauncherCmd(ps1Text, scriptName) {
  const b64 = btoa(unescape(encodeURIComponent(ps1Text))), chunks = [];
  for (let i = 0; i < b64.length; i += 400) chunks.push(b64.slice(i, i + 400));
  const L = [];
  L.push('@echo off');
  L.push('setlocal EnableExtensions EnableDelayedExpansion');
  L.push('REM Scraper4 - double-click launcher.');
  L.push('REM Windows opens .ps1 files in Notepad instead of running them, so this .cmd');
  L.push('REM carries the installer inside it and runs it with -ExecutionPolicy Bypass.');
  L.push('title Scraper4 installer');
  L.push('cd /d "%~dp0"');
  L.push('set "B64="');
  for (const c of chunks) L.push('set "B64=!B64!' + c + '"');
  L.push('set "PS1=%TEMP%\\' + scriptName + '"');
  L.push('set "PSEXE=powershell"');
  L.push('where pwsh >nul 2>&1 && set "PSEXE=pwsh"');
  L.push('"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -Command "[IO.File]::WriteAllText($env:PS1, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:B64)))"');
  L.push('if not exist "%PS1%" (echo [X] Could not unpack the installer.& pause& exit /b 1)');
  L.push('echo ==========================================================');
  L.push('echo   Scraper4 installer   ^(engine: %PSEXE%^)');
  L.push('echo ==========================================================');
  L.push('echo.');
  L.push('"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS1%"');
  L.push('set "RC=%ERRORLEVEL%"');
  L.push('del "%PS1%" >nul 2>&1');
  L.push('echo.');
  L.push('if "%RC%"=="0" (echo [OK] Installer finished successfully.) else (echo [X] Installer exited with code %RC%.)');
  L.push('echo.');
  L.push('echo This window stays open so you can read the output.');
  L.push('pause');
  L.push('endlocal');
  return L.join('\r\n') + '\r\n';
}
function saveBlobAs(text, name, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
}
function downloadCommand(i) {
  const entries = Object.entries(COMMANDS), entry = entries[i];
  if (!entry) return;
  const [name, text] = entry, file = commandFileName(name);
  saveBlobAs(text, file, 'text/plain;charset=utf-8');
  if (file.endsWith('.ps1')) {
    const launcher = file.replace(/\.ps1$/, '-RUN-ME.cmd');
    setTimeout(function () {
      saveBlobAs(windowsLauncherCmd(text, file), launcher, 'application/octet-stream');
      const sum = $('branchSummary');
      if (sum) sum.textContent = 'Downloaded ' + launcher + ' - double-click that file (.ps1 files do not run on double-click).';
    }, 400);
  }
}
async function copyCommand(i, btn) {
  try {
    const text = Object.values(COMMANDS)[i];
    await navigator.clipboard.writeText(text);
    $('copied' + i).textContent = 'Copied';
    toast('Copied ' + (Object.keys(COMMANDS)[i] || 'command') + ' to the clipboard', 'ok');
    setTimeout(() => { const el = $('copied' + i); if (el) el.textContent = ''; }, 1800);
  } catch (err) { logError(err); }
}
function showDbHelp() {
  $('dbHelp').textContent = [COMMANDS['Database: Docker local'], '--- Termux ---', COMMANDS['Database: Termux PostgreSQL (optional)'], '--- Render ---', COMMANDS['Render.com panel']].join(String.fromCharCode(10,10));
}
async function refresh() {
  try {
    const d = await api('/api/status');
    const scraper = d.scraper || {};
    const db = d.database || {};
    const det = d.environment || {};
    const detectedEl = $('detected');
    if (detectedEl) detectedEl.innerHTML = '<b>Detected:</b> ' + (det.label || '-') + ' · database: ' + (det.canInstallDatabase ? 'auto/installable' : 'panel/manual');
    const envSelect = $('env');
    if (envSelect && det.id === 'termux') envSelect.value = 'termux-offline';
    else if (envSelect && det.id === 'render') envSelect.value = 'render';
    else if (envSelect && det.id === 'vercel') envSelect.value = 'vercel';
    else if (envSelect && det.id === 'codespaces') envSelect.value = 'vscode';
    renderLibraries();
    if ($('branchRows')) renderBranches();
    const dbLabel = db.methodLabel || (db.configured ? (/HOST/i.test(db.maskedUrl || '') ? 'Placeholder HOST' : 'Configured') : 'Missing');
    const autoPill = $('autoPill');
    if (autoPill) autoPill.textContent = 'Auto-update: ' + (d.autoUpdate && d.autoUpdate.enabled ? (d.autoUpdate.intervalMs > 0 ? 'every ' + Math.max(1, Math.round(d.autoUpdate.intervalMs / 60000)) + ' min' : 'off') : 'off');
    const staleEl = $('scraperStale');
    if (staleEl) {
      const serving = scraper.serving || {};
      const sameVersion = serving.version && serving.version === serving.onDisk;
      const staleText = sameVersion
        ? 'serves <b>v' + serving.version + '</b> from an older commit (' + String(serving.head || '?').slice(0, 7) + ' vs ' + String(serving.diskHead || '?').slice(0, 7) + ')'
        : 'serves <b>v' + (serving.version || '?') + '</b> but the checkout is <b>v' + (serving.onDisk || '?') + '</b>';
      staleEl.innerHTML = serving.stale
        ? '<div class="banner">localhost:' + scraper.port + ' ' + staleText + '. <button class="success" onclick="scraperRestart()">Rebuild & restart</button></div>'
        : '';
    }
    const statusEl = $('status');
    if (statusEl) statusEl.innerHTML = '<div class="metric"><small>Package</small><b>' + d.package.name + '</b></div><div class="metric"><small>Version</small><b>' + (d.package.version || '-') + '</b></div><div class="metric"><small>Database</small><b>' + dbLabel + '</b><small>' + (db.maskedUrl || db.methodLabel || 'Use Database tab') + '</small></div><div class="metric"><small>Scraper</small><b>' + servingLabel(scraper) + '</b></div><div class="metric"><small>Git</small><b class="small">' + (d.git?.commit || '-') + '</b></div><div class="metric"><small>Project</small><b class="small">' + d.projectDir + '</b></div>';
    updateRail(d);
    announceBrowserNotice(d);
    lastRefreshAt = Date.now();
    tickUpdated();
  } catch (err) { logError(err); }
}
window.tab = tab;
window.bumpFont = bumpFont;
window.toggleCmd = toggleCmd;
window.filterGuides = filterGuides;
window.run = run;
window.scraperStart = scraperStart;
window.openScraper = openScraper;
window.scraperStop = scraperStop;
window.scraperRestart = scraperRestart;
window.scraperLogs = scraperLogs;
window.updateCode = updateCode;
window.copyCommand = copyCommand;
window.downloadCommand = downloadCommand;
window.showDbHelp = showDbHelp;
window.scanNow = scanNow;
window.installBranch = installBranch;
window.repairOrigin = repairOrigin;
window.branchConfigChanged = branchConfigChanged;
window.renderBranches = renderBranches;
window.pyRefresh = pyRefresh;
window.pyInstall = pyInstall;
window.pyRun = pyRun;
$('env')?.addEventListener('change', renderLibraries);
$('autoInstallLatest')?.addEventListener('change', branchConfigChanged);
$('branchInterval')?.addEventListener('change', branchConfigChanged);
renderLibraries();
renderGuides();
renderBranches();
showDbHelp();
pyRefresh();
refresh();
if(location.hash==='#branches')tab('branches',document.querySelectorAll('.tabs button')[4]);
$('branchFilter')?.addEventListener('input', function () { if (lastBranchPayload) renderBranchesData(lastBranchPayload, true); });
$('guideFilter')?.addEventListener('input', filterGuides);
$('logFollow')?.addEventListener('change', function () { followLog($('log'), true); });
$('resourcePause')?.addEventListener('click',toggleResources);
refreshResources();
setInterval(refreshResources,2000);
document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshResources();});
setInterval(tickUpdated, 1000);
// A phone backgrounding the browser must not keep hammering the local API; the 5s poll is the
// difference between "live" and "frozen at whatever I last looked at", so it resumes on focus.
setInterval(function () { if (!document.hidden) refresh(); }, 5000);
window.addEventListener('focus', function () { refresh(); });
// The bell label is a fact about the browser, not the server: repaint it whenever the page is seen.
window.addEventListener('focus', function () { paintNotifyButton(); });
</script></body></html>`;
}
