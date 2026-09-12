#!/usr/bin/env node
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

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
    { type: 'Managed project deps', label: 'Installed for scraper by deployer', items: ['package.json dependencies', 'Playwright browser install', 'Puppeteer browser install', 'Termux chromium pkg','Basalam SDK optional adapter (if installed)'] }
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
const autoUpdateEnabled = startupEnv.LOCAL_DEPLOYER_AUTO_UPDATE !== 'false';
let branchScanIntervalMs = readIntervalMs(startupEnv.LOCAL_DEPLOYER_SCAN_INTERVAL_MS || startupEnv.LOCAL_DEPLOYER_AUTO_UPDATE_MS);
let autoInstallLatestEnabled = startupEnv.LOCAL_DEPLOYER_AUTO_INSTALL_LATEST !== 'false';
let autoUpdateRunning = false;
let lastAutoUpdate = null;
let lastDirtySkipLogged = -1;
let lastUnpushedSkipLogged = -1;
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
    if (reason !== 'timer') console.log(`[deployer] branch scan (${reason}): ${branches.length} branch(es), newest ${latest ? latest.name + ' v' + latest.version : '-'}`);
    return branchCatalogPayload();
  } catch (error) {
    branchState.lastScanError = error?.message || String(error);
    return branchCatalogPayload();
  } finally {
    branchState.scanning = false;
  }
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
function startScraper(retryDepth = 0) {
  if (scraper?.running && scraper.child && scraper.exitCode === null) return scraper;
  // An EADDRINUSE retry is one story, not a new one: keep attempt #1 visible.
  if (retryDepth === 0) scraperLog = '';
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
  child.on('exit', code => { scraper.running = false; scraper.exitCode = code ?? 0; add(`\n[scraper exited with code ${scraper.exitCode}]\n`); if (scraper.exitCode === 75) { add('[local scraper] Auto-update finished; restarting scraper process...\n'); setTimeout(() => startScraper(), 1500); return; }
    // The bind can lose a race the pre-start scan cannot see (a second start,
    // a dying holder). Retry ONCE after freeing again; a foreign holder still
    // refuses as before, and the retry is logged so the log shows the count.
    if (sawEaddr && retryDepth < 1) { add('[local scraper] first bind hit EADDRINUSE; freeing the port and retrying once...\n'); freeScraperPort(); setTimeout(() => startScraper(retryDepth + 1), 1500); return; }
    if (sawEaddr) add(`\n[local scraper] EADDRINUSE persists on port ${scraperPort}: another process still holds it. If it is an old scraper that survived, kill it by hand (pkill -f render-dist/server \u2014 on Termux install procps first if pkill is missing), then press Build & start again.\n`); });
  child.on('error', e => { scraper.running = false; scraper.exitCode = 1; add(`\nERROR: ${e.message}\n`); });
  return scraper;
}

function stopScraper() {
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

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
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
    jobs: [...jobs.values()].map(({ child, ...j }) => j),
    scraper: scraper ? { running: scraper.running, pid: scraper.pid, startedAt: scraper.startedAt, exitCode: scraper.exitCode, port: scraperPort, command: scraper.command || scraperCommand, serving: servingState() } : { running: false, port: scraperPort, command: scraperCommand, serving: servingState() }
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const ref = req.headers.referer ? new URL(req.headers.referer, `http://${req.headers.host}`) : null;
    const fromScraperProxy = ref?.pathname?.startsWith('/scraper');
    if (url.pathname === '/scraper') {
      res.writeHead(302, { location: '/scraper/' + url.search });
      return res.end();
    }
    if (url.pathname.startsWith('/scraper') || (fromScraperProxy && (url.pathname === '/dashboard.js' || url.pathname === '/health' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/assets/') || url.pathname === '/visual'))) return await proxyScraper(req, res, url);
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page(token), 'text/html; charset=utf-8');
    if (!requireAuth(req, res)) return;
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
    if (req.method === 'POST' && url.pathname === '/api/scraper/start') return send(res, 200, { ok: true, scraper: (({ child, ...s }) => ({ ...s, port: scraperPort }))(startScraper()) });
    if (req.method === 'POST' && url.pathname === '/api/scraper/stop') return send(res, 200, { ok: true, scraper: stopScraper() });
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
    autoStartScraper();
  });
}

// The scraper must come up on its own address as soon as the deployer is
// installed or updated, so opening it never depends on the deployer page
// (which used to be the only way to trigger startScraper()).
function autoStartScraper() {
  if (String(process.env.LOCAL_SCRAPER_AUTOSTART || '').toLowerCase() === 'false') {
    console.log('[deployer] scraper autostart disabled (LOCAL_SCRAPER_AUTOSTART=false).');
    return;
  }
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
    if (!state.stale && state.identified) {
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
  const startFresh = () => {
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

// Closing the deployer must NOT take the scraper down with it: the scraper owns
// its own URL and has to stay reachable on its own. Set LOCAL_SCRAPER_STOP_WITH_UI=true
// to restore the old behaviour; the Stop button still stops it on demand.
const stopScraperWithUi = String(process.env.LOCAL_SCRAPER_STOP_WITH_UI || '').toLowerCase() === 'true';
function shutdownUi() {
  if (stopScraperWithUi) stopScraper();
  else if (scraper?.running) console.log(`\n[deployer] closing the deployer; the scraper keeps running on http://localhost:${scraperPort}/ (pid ${scraper.pid}).`);
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdownUi);
process.on('SIGTERM', shutdownUi);

function page(token) {
  const commands = {"Update existing clone": "cd \"$HOME/new\"\ngit config --local --unset-all credential.helper || true\ngit config --local --replace-all credential.helper '!gh auth git-credential'\ngh auth setup-git || true\ngit fetch origin arena/01a09468-new\ngit reset --hard origin/arena/01a09468-new\ncd \"$HOME/new/cloudflare-scraper4\"\nnpm install --no-audit --prefer-online\n# On Termux add --ignore-scripts to the npm install (Android cannot run install scripts)\nnode scripts/esbuild-check.mjs\nnpm run browsers:install || true\nnpm run version:check\ngrep '\"version\"' package.json | head -1\n# Expected: 1.142.0\nnpm run deployer:ui", "VS Code / Desktop": "git clone --branch arena/01a09468-new https://github.com/fazilatma/new.git\ncd new\nnpm install\ncd cloudflare-scraper4\nnpm install\nnode scripts/esbuild-check.mjs\nnpm run version:check\n# Expected: 1.142.0\nnpm run deployer:ui", "Windows PowerShell": "# Choose the install directory yourself. Example: D:\\Scraper4 or E:\\Apps\\Scraper4\n$InstallRoot = Read-Host \"Install folder for Scraper4 (not forced to C:)\"\nif ([string]::IsNullOrWhiteSpace($InstallRoot)) { throw \"Install folder is required\" }\nNew-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null\nSet-Location $InstallRoot\n# Install prerequisites if winget is available. You can also install Node.js LTS, Git, and GitHub CLI manually.\nif (Get-Command winget -ErrorAction SilentlyContinue) {\n  winget install --id Git.Git -e --source winget\n  winget install --id GitHub.cli -e --source winget\n  winget install --id OpenJS.NodeJS.LTS -e --source winget\n}\n# Restart PowerShell after first installing Node/Git if commands are not found.\nif (-not (Test-Path \"$InstallRoot\\new\\.git\")) {\n  git clone --branch arena/01a09468-new https://github.com/fazilatma/new.git \"$InstallRoot\\new\"\n} else {\n  Set-Location \"$InstallRoot\\new\"\n  git fetch origin arena/01a09468-new\n  git reset --hard origin/arena/01a09468-new\n}\nSet-Location \"$InstallRoot\\new\\cloudflare-scraper4\"\nnpm install --no-audit --prefer-online\nnpm run browsers:install\nnode scripts/esbuild-check.mjs\nnpm run version:check\n# Expected: 1.142.0\n@\"\nDATABASE_URL=sqlite:data/scraper4.sqlite\nRUN_WORKER_IN_WEB=true\nLOCAL_SCRAPER_AUTO_UPDATE=true\nPORT=3000\n\"@ | Set-Content -Encoding UTF8 .env.local\n# Windows uses Node built-in SQLite - no PostgreSQL install/service needed.\n# Remove DATABASE_URL only if you prefer a remote/managed PostgreSQL URL.\nnpm run deployer:ui\n# Open the printed http://localhost:8790/?token=... URL. The app files stay under $InstallRoot\\new, not the default C: path.", "Windows Command Prompt": "REM Choose the install directory yourself. Example: D:\\Scraper4 or E:\\Apps\\Scraper4\nset /p INSTALL_ROOT=Install folder for Scraper4 (not forced to C:): \nif \"%INSTALL_ROOT%\"==\"\" echo Install folder is required && exit /b 1\nmkdir \"%INSTALL_ROOT%\" 2>nul\ncd /d \"%INSTALL_ROOT%\"\nREM Install Node.js LTS, Git, and GitHub CLI manually, or use winget before running this block.\nwhere git || winget install --id Git.Git -e --source winget\nwhere node || winget install --id OpenJS.NodeJS.LTS -e --source winget\nwhere gh || winget install --id GitHub.cli -e --source winget\nif not exist \"%INSTALL_ROOT%\\new\\.git\" (\n  git clone --branch arena/01a09468-new https://github.com/fazilatma/new.git \"%INSTALL_ROOT%\\new\"\n) else (\n  cd /d \"%INSTALL_ROOT%\\new\"\n  git fetch origin arena/01a09468-new\n  git reset --hard origin/arena/01a09468-new\n)\ncd /d \"%INSTALL_ROOT%\\new\\cloudflare-scraper4\"\nnpm install --no-audit --prefer-online\nnpm run browsers:install\nnode scripts\\esbuild-check.mjs\nnpm run version:check\nREM Expected: 1.142.0\n(\n  echo DATABASE_URL=sqlite:data/scraper4.sqlite\n  echo RUN_WORKER_IN_WEB=true\n  echo LOCAL_SCRAPER_AUTO_UPDATE=true\n  echo PORT=3000\n) > .env.local\nREM Windows uses Node built-in SQLite - no PostgreSQL install/service needed.\nREM Remove DATABASE_URL only if you prefer a remote/managed PostgreSQL URL.\nnpm run deployer:ui\nREM Open the printed http://localhost:8790/?token=... URL. The app files stay under %INSTALL_ROOT%\\new, not the default C: path.", "Termux / Android": "cd \"$HOME\"\npkg update -y\npkg upgrade -y\npkg install -y git gh openssh nodejs-lts python make clang chromium\nrm -rf \"$HOME/new\"\ngit config --global --unset-all credential.helper || true\ngh auth login --web -h github.com -p https\ngh auth setup-git\ngh repo clone fazilatma/new \"$HOME/new\" -- --branch arena/01a09468-new --depth 1\ncd \"$HOME/new\"\ngit config --local --unset-all credential.helper || true\ngit config --local --replace-all credential.helper '!gh auth git-credential'\ngit config --local --get-all credential.helper\n# Correct output: !gh auth git-credential\n# Do NOT set: gh auth setup-git auth git-credential\ngit pull --ff-only origin arena/01a09468-new\ncd \"$HOME/new/cloudflare-scraper4\"\nnpm config set fetch-retries 5\nnpm config set fetch-retry-mintimeout 20000\nnpm config set fetch-retry-maxtimeout 90000\n# --ignore-scripts: wrangler's workerd setup has no Android build and fails the whole install. Nothing the scraper runs needs install scripts here.\nnpm install --ignore-scripts --no-audit --prefer-online\nnpm run browsers:install || true\nnode scripts/esbuild-check.mjs\nnpm run version:check\n# Expected: 1.142.0\nCHROME_BIN=\"$(command -v chromium-browser || command -v chromium || true)\"\nif [ -n \"$CHROME_BIN\" ]; then printf \"BROWSER_EXECUTABLE_PATH=$CHROME_BIN\nPLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$CHROME_BIN\nPUPPETEER_EXECUTABLE_PATH=$CHROME_BIN\nLOCAL_SCRAPER_AUTO_UPDATE=true\n\" >> .env.local; fi\n# No ADMIN_TOKEN needed locally: the vault key is generated at data/vault.key on first save.\n# Keep that file - deleting it makes already-saved API keys unreadable.\nnpm run deployer:ui", "Database: Docker local": "docker rm -f scraper4-postgres || true\ndocker run --name scraper4-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=scraper4 -p 5432:5432 -d postgres:16\nprintf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scraper4\nRUN_WORKER_IN_WEB=true\n' > .env.local\n# No Docker? Leave DATABASE_URL empty (or sqlite:data/scraper4.sqlite) to use built-in Node SQLite.", "Database: Termux PostgreSQL (optional)": "pkg install -y postgresql\n# If you saw role \"postgres\" does not exist, use the Termux user from whoami, not postgres:postgres.\nmkdir -p \"$PREFIX/var/lib/postgresql\"\n[ -f \"$PREFIX/var/lib/postgresql/PG_VERSION\" ] || initdb \"$PREFIX/var/lib/postgresql\"\npg_ctl -D \"$PREFIX/var/lib/postgresql\" -l \"$HOME/scraper4-postgres.log\" start\ncreatedb scraper4 || true\nprintf \"DATABASE_URL=postgresql://$(whoami)@localhost:5432/scraper4\nRUN_WORKER_IN_WEB=true\n\" > .env.local\n# Windows: skip this - the deployer configures built-in Node SQLite automatically.", "Render.com panel": "1) Render Dashboard → New → PostgreSQL\n2) Copy Internal Database URL\n3) Your Web Service → Environment:\n   DATABASE_URL = Internal Database URL\n   RUN_WORKER_IN_WEB = true\n   ADMIN_TOKEN = long-random-secret\n4) Save Changes → Manual Deploy / Redeploy\n5) Open https://YOUR-SERVICE.onrender.com/health → expected version: 1.142.0", "Cloudflare Worker": "Cloudflare Dashboard → Workers & Pages → your Worker\nSettings → Variables and Secrets:\n  VAULT_SECRET = long-random-secret\nBindings:\n  D1 DB binding name = DB\n  Queue binding name = JOBS\nDeployments → Redeploy\nOpen https://YOUR-WORKER.workers.dev/api/version → expected version: 1.142.0\nCheck daily D1 usage: https://YOUR-WORKER.workers.dev/api/quota\n  Free plan: 5,000,000 rows read + 100,000 rows written per day, reset 00:00 UTC.\nwrangler.toml WORKER_VERSION is kept in sync by: npm run version:sync", "API examples": "curl -X POST http://127.0.0.1:3000/api/profiles/PROFILE_ID/run -H 'content-type: application/json' -d '{\"target\":\"none\",\"pages\":1}'\ncurl -X POST http://127.0.0.1:3000/api/profiles/PROFILE_ID/run -H 'content-type: application/json' -d '{\"target\":\"both\",\"extract\":false,\"limit\":100}' \ncurl -s http://127.0.0.1:3000/health\n# Expected version: 1.142.0"};
  return String.raw`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scraper4 Local Deployer</title>
<style>
:root{color-scheme:dark;--bg:#050814;--bg2:#0b1220;--card:#111c31cc;--card2:#0f172acc;--line:#263854;--text:#e7eefb;--muted:#93a4bc;--brand:#38bdf8;--brand2:#a78bfa;--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444;--shadow:0 24px 80px #0009}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 12% -10%,#164e63 0,#0f172a 33%,#020617 78%);color:var(--text);font:14px/1.55 Inter,ui-sans-serif,system-ui,Segoe UI,Arial}.shell{max-width:1320px;margin:0 auto;padding:22px}.hero{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:center;padding:20px;border:1px solid #ffffff18;border-radius:28px;background:linear-gradient(135deg,#0f172add,#111827aa);box-shadow:var(--shadow);position:sticky;top:12px;z-index:5;backdrop-filter:blur(16px)}.brand{display:flex;gap:14px;align-items:center}.logo{width:52px;height:52px;border-radius:18px;background:linear-gradient(135deg,var(--brand),var(--brand2));box-shadow:0 0 45px #38bdf866}.hero h1{font-size:24px;margin:0}.muted{color:var(--muted)}.pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;background:#02061799;color:#dbeafe;padding:7px 11px;margin:3px}.grid{display:grid;grid-template-columns:330px 1fr;gap:18px;margin-top:18px}.card{border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,var(--card),var(--card2));padding:18px;box-shadow:var(--shadow)}.side{position:sticky;top:120px;align-self:start}.steps{display:grid;gap:10px}.step{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid #263854;border-radius:16px;background:#07111f}.step b{color:#bfdbfe}.step .num{width:28px;height:28px;border-radius:10px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#00111f;display:grid;place-items:center;font-weight:900;flex:none}label{display:block;margin:12px 0 5px;color:#cbd5e1;font-weight:700}select,input{width:100%;border:1px solid var(--line);border-radius:14px;background:#020817;color:var(--text);padding:12px}button{border:0;border-radius:14px;background:linear-gradient(135deg,var(--brand),#60a5fa);color:#00111f;font-weight:900;padding:11px 15px;cursor:pointer;margin:4px 4px 4px 0;box-shadow:0 10px 25px #0004}button:hover{filter:brightness(1.08)}.secondary{background:#24344e;color:#e5edf7}.success{background:linear-gradient(135deg,#22c55e,#86efac);color:#04140a}.danger{background:#ef4444;color:white}.warn{background:#f59e0b;color:#1c0a00}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.tabs button{background:#0f1b31;color:#cbd5e1}.tabs button.active{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#00111f}.panel{display:none}.panel.active{display:block}.status{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.metric{background:#06101e;border:1px solid var(--line);border-radius:18px;padding:14px;min-height:76px}.metric small{display:block;color:var(--muted);font-size:12px}.metric b{display:block;font-size:17px;margin-top:5px}.dot{width:10px;height:10px;border-radius:99px;background:var(--muted);display:inline-block}.dot.ok{background:var(--ok);box-shadow:0 0 15px #22c55e}.dot.warn{background:var(--warn)}pre{white-space:pre-wrap;word-break:break-word;background:#020617;border:1px solid var(--line);border-radius:18px;padding:15px;min-height:220px;max-height:520px;overflow:auto;color:#dbeafe}.guide-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.guide-card{border:1px solid var(--line);border-radius:20px;padding:14px;background:#07111f}.guide-card h3{margin:0 0 8px}.lib-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:10px;margin-top:10px}.lib-card{border:1px solid var(--line);border-radius:16px;padding:12px;background:#06101e}.lib-card h3{margin:0 0 8px;color:#bfdbfe}.lib-card code{display:inline-block;margin:2px;padding:2px 6px;border-radius:999px;background:#020617;border:1px solid #334155;color:#dbeafe;font-size:11px}.lib-card small{display:block;color:var(--muted);margin-bottom:7px}.guide-card pre{min-height:160px;max-height:260px;font-size:12px}.copy-ok{color:#86efac;font-size:12px;margin-left:8px}.banner{border:1px solid #f59e0b66;background:#42200688;color:#fde68a;border-radius:18px;padding:12px;margin-bottom:14px}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.kbd{font-family:ui-monospace,Menlo,Consolas,monospace;background:#020617;border:1px solid var(--line);border-radius:7px;padding:2px 7px}.small{font-size:12px}@media(max-width:900px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.side{position:static}.shell{padding:12px}.hero h1{font-size:20px}}
.tbl{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}.tbl th,.tbl td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top;background:#06101e}.tbl th{background:#0b1c31;color:#bfdbfe;font-size:12px}.tbl tr.current td{background:#052e1666}.tbl .num{font-family:ui-monospace,Menlo,Consolas,monospace;color:#93c5fd}.tbl small{color:var(--muted)}
</style></head><body><main class="shell"><section class="hero"><div class="brand"><div class="logo"></div><div><h1>Scraper4 Local Deployer</h1><div class="muted">Install, database, local scraper, cloud deploy — one guided dashboard</div></div></div><div><span class="pill">Node ${process.version}</span><span class="pill">v${pkg.version || '-'}</span><span class="pill">Token protected</span><span class="pill" id="autoPill">Auto-update on</span></div></section>
<section class="grid"><aside class="card side"><h2>Smart setup</h2><div id="detected" class="banner">Detecting environment…</div><label>Environment</label><select id="env"><option value="vscode">VS Code / Desktop</option><option value="windows">Windows local</option><option value="termux-offline">Termux / Android</option><option value="cloudflare-worker">Cloudflare Worker</option><option value="vercel">Vercel</option><option value="render">Render</option><option value="vps">VPS</option></select><label>Scraping libraries</label><select id="libs"><option value="minimal">Minimal</option><option value="edge">Edge / Cloudflare-friendly</option><option value="node" selected>Node scraping stack</option><option value="browser">Browser rendering stack</option><option value="full">Full stack</option></select><div class="small muted" style="margin-top:8px">Installed library inventory is grouped in the Copy commands tab.</div><label>Package manager</label><select id="pm"><option>npm</option><option>pnpm</option><option>yarn</option><option>bun</option></select><label>Port</label><input id="port" value="3000"><div class="steps"><div class="step"><span class="num">1</span><div><b>Install deps</b><br><span class="muted small">npm dependencies and scraper libraries.</span></div></div><div class="step"><span class="num">2</span><div><b>Install/connect database</b><br><span class="muted small">Automatic where possible; panel instructions elsewhere.</span></div></div><div class="step"><span class="num">3</span><div><b>Start scraper</b><br><span class="muted small">Open the scraper dashboard after it starts.</span></div></div></div></aside>
<section><div class="tabs"><button class="active" onclick="tab('dash',this)">Overview</button><button onclick="tab('database',this)">Database</button><button onclick="tab('scraper',this)">Local scraper</button><button onclick="tab('guide',this)">Copy commands</button><button onclick="tab('branches',this)">Branches</button><button onclick="tab('jobs',this)">Logs</button></div>
<div id="dash" class="panel active"><div class="card"><h2>Project status</h2><p class="muted">If you see <span class="kbd">getaddrinfo ENOTFOUND HOST</span>, your DATABASE_URL still contains the placeholder HOST. On Windows (and on machines without Docker) the database button now configures the <b>SQLite database built into Node.js</b> automatically - no PostgreSQL install/service is needed.</p><div id="status" class="status"></div><div class="row" style="margin-top:14px"><button onclick="run('install')">Install / retry npm</button><button class="success" onclick="run('databaseInstall')">Install / connect database</button><button onclick="run('localBuild')">Build local scraper</button><button class="secondary" onclick="updateCode(false)">Update from GitHub</button><button class="secondary" onclick="refresh()">Refresh</button></div></div></div>
<div id="database" class="panel"><div class="card"><h2>Database setup</h2><p class="muted">The deployer auto-detects Termux, Codespaces, desktop, Render, Vercel and Windows. On Windows / machines without Docker it configures the <b>built-in SQLite database</b> (nothing to install). On Docker/Codespaces it starts PostgreSQL automatically; on Render/Cloudflare/Vercel it shows panel instructions.</p><div class="row"><button class="success" onclick="run('databaseInstall')">Install database now</button><button class="secondary" onclick="showDbHelp()">Show panel instructions</button></div><pre id="dbHelp"></pre></div></div>
<div id="scraper" class="panel"><div class="card"><h2>Run scraper locally</h2><p class="muted">The scraper starts automatically with the deployer and keeps its own address: <a href="http://localhost:${scraperPort}/" target="_blank" rel="noreferrer">http://localhost:${scraperPort}/</a> (no token needed). It is a separate process, so it stays up after you close the deployer, and the terminal prints its URL under the deployer URL. Use the database button first if DATABASE_URL is missing or contains HOST. Set <span class="kbd">LOCAL_SCRAPER_AUTOSTART=false</span> to stop it starting on its own, or <span class="kbd">LOCAL_SCRAPER_STOP_WITH_UI=true</span> to shut it down together with the deployer. The first start runs <span class="kbd">render:build</span>, which takes tens of seconds on Termux/ARM; Open scraper now waits for that build instead of failing with ECONNREFUSED. The dashboard works the same whether you open it here under /scraper/ or directly on its own port, because it resolves its API calls relative to the address you opened it at. Raise <span class="kbd">LOCAL_SCRAPER_PROXY_WAIT_MS</span> (default 180000) on a very slow device.</p><div class="row"><button class="success" onclick="scraperStart()">Build & start local scraper</button><button class="secondary" onclick="openScraper('/')">Open scraper dashboard</button><button class="secondary" onclick="openScraper('/health')">Open /health</button><button class="danger" onclick="scraperStop()">Stop</button><button class="secondary" onclick="scraperLogs()">Refresh logs</button></div><div id="scraperStale"></div><pre id="scraperLog"></pre></div></div>
<div id="guide" class="panel"><div class="card"><h2>Installed libraries by type</h2><p class="muted">This inventory is generated from package.json plus required runtime/platform packages, so you can see what is already installed before copying commands.</p><div id="libraryGroups" class="lib-grid"></div></div><div class="card"><h2>One-click copy commands</h2><p class="muted">Each environment has its own copy button. Paste only plain text into Termux; never paste Markdown links.</p><div id="guideCards" class="guide-grid"></div></div></div>
<div id="branches" class="panel"><div class="card"><h2>Repo branches - newest version tracking</h2><p class="muted">Every <b id="branchIntervalLabel">1 minute</b> the deployer fetches all branches of <span class="kbd">fazilatma/new</span>, reads the Scraper4 version from each branch (<span class="kbd">cloudflare-scraper4/package.json</span>) and - when enabled - automatically installs the branch carrying the <b>newest version</b>. Use the row button to install a specific branch.</p><div class="row" style="margin:10px 0"><label style="margin:0 10px 0 0;width:auto;font-weight:600"><input type="checkbox" id="autoInstallLatest" style="width:auto" checked> Auto-install newest version</label><select id="branchInterval" style="width:auto"><option value="1">every 1 minute</option><option value="5">every 5 minutes</option><option value="10">every 10 minutes</option><option value="30">every 30 minutes</option><option value="0">never (manual only)</option></select><button class="secondary" onclick="scanNow()">Scan now</button><button class="secondary" onclick="renderBranches(true)">Refresh table</button></div><div id="branchSummary" class="banner"></div><div style="overflow:auto"><table class="tbl"><thead><tr><th>Branch</th><th>Version on branch</th><th>Installed version</th><th>Last commit</th><th>Status</th><th>Action</th></tr></thead><tbody id="branchRows"><tr><td colspan="6" class="muted">Loading branches…</td></tr></tbody></table></div></div></div>
<div id="jobs" class="panel"><div class="card"><h2>Command output</h2><pre id="log"></pre></div></div></section></section></main>
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
  if (db && !db.textContent) db.textContent = msg;
  console.error(err);
};
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
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
  if (btn) btn.classList.add('active');
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
    if (job?.running) setTimeout(pollJobs, 1200);
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
function renderBranchesData(d, force) {
  const rows = $('branchRows');
  if (!rows) return;
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
  const list = d.branches || [];
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
    return '<tr' + (isCurrent ? ' class="current"' : '') + '><td><code>' + escHtml(b.name) + '</code></td>' +
      '<td class="num"><b>' + versionCell + '</b></td>' +
      '<td class="num">' + escHtml(installedVersion) + '</td>' +
      '<td><code>' + escHtml(shortSha(b.sha)) + '</code><br><small>' + escHtml(b.date || '') + '</small></td>' +
      '<td>' + statusCell + '</td><td>' + actionCell + '</td></tr>';
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
  container.innerHTML = names.map((name, i) => '<div class="guide-card"><h3>' + name + '</h3><button class="secondary" onclick="copyCommand(' + i + ',this)">Copy all</button><button class="secondary" onclick="downloadCommand(' + i + ')">Download executable script</button><span class="copy-ok" id="copied' + i + '"></span><pre id="cmd' + i + '"></pre></div>').join('');
  Object.values(COMMANDS).forEach((cmd, i) => { $('cmd' + i).textContent = cmd; });
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
  } catch (err) { logError(err); }
}
window.tab = tab;
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
$('env')?.addEventListener('change', renderLibraries);
$('autoInstallLatest')?.addEventListener('change', branchConfigChanged);
$('branchInterval')?.addEventListener('change', branchConfigChanged);
renderLibraries();
renderGuides();
renderBranches();
showDbHelp();
refresh();
setInterval(refresh, 5000);
</script></body></html>`;
}
