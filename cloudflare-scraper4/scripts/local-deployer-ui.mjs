#!/usr/bin/env node
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Scraper4 Local Deployer UI

Usage:
  npm run deployer:ui
  DEPLOYER_UI_PORT=8790 npm run deployer:ui
  DEPLOYER_UI_TOKEN=my-local-token npm run deployer:ui

Open the printed URL in your browser. In GitHub Codespaces, forward the printed port and keep the token query string.
`);
  process.exit(0);
}

const projectDir = resolve(process.cwd());
const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
let port = Number(process.env.DEPLOYER_UI_PORT || process.env.PORT || 8790);
const host = process.env.DEPLOYER_UI_HOST || '0.0.0.0';
const token = process.env.DEPLOYER_UI_TOKEN || randomBytes(18).toString('base64url');
const scraperPort = Number(process.env.SCRAPER_PORT || 3000);
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const scraperCommand = process.env.LOCAL_SCRAPER_COMMAND || `${npmCommand} run render:build && ${npmCommand} run render:start`;
function shellValue(command, args = []) {
  const result = spawnSync(command, args, { cwd: projectDir, encoding: 'utf8', env: process.env });
  return result.status === 0 ? String(result.stdout || '').trim() : '';
}
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
  if (detected.id === 'termux') {
    if (!raw || /@HOST(?::|\/|$)/i.test(raw) || /postgres(?::postgres)?@(?:localhost|127\.0\.0\.1):5432\/scraper4/i.test(raw)) return termuxDatabaseUrl();
  }
  if (!raw || /@HOST(?::|\/|$)/i.test(raw)) return detected.id === 'termux' ? termuxDatabaseUrl() : dockerDatabaseUrl();
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
  if (process.platform === 'win32') return { id: 'windows', label: 'Windows local', canInstallDatabase: false, method: 'manual' };
  return { id: 'desktop', label: 'Local desktop / VPS', canInstallDatabase: true, method: existsSync('/.dockerenv') ? 'manual' : 'docker' };
}
function databaseInstallPlan() {
  const detected = detectEnvironment();
  if (detected.id === 'termux') return {
    ...detected,
    command: `pkg install -y postgresql && mkdir -p "$PREFIX/var/lib/postgresql" && ([ -f "$PREFIX/var/lib/postgresql/PG_VERSION" ] || initdb "$PREFIX/var/lib/postgresql") && (pg_ctl -D "$PREFIX/var/lib/postgresql" -l "$HOME/scraper4-postgres.log" start || true) && sleep 2 && (createdb scraper4 || true) && node -e "import {writeFileSync} from 'node:fs';import {execSync} from 'node:child_process';const user=execSync('whoami').toString().trim();writeFileSync('.env.local', 'DATABASE_URL=postgresql://'+user+'@localhost:5432/scraper4\\nRUN_WORKER_IN_WEB=true\\n');console.log('Wrote .env.local for Termux PostgreSQL user '+user+'. Do not use postgres:postgres on Termux unless you created that role manually.')"`,
    instructions: 'Termux can install PostgreSQL with pkg. If pkg cannot find postgresql, use a remote PostgreSQL and put its DATABASE_URL in .env.local.'
  };
  if (detected.method === 'docker') return {
    ...detected,
    command: `docker rm -f scraper4-postgres >/dev/null 2>&1 || true; docker run --name scraper4-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=scraper4 -p 5432:5432 -d postgres:16 && node -e "import {writeFileSync} from 'node:fs';writeFileSync('.env.local','DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scraper4\\nRUN_WORKER_IN_WEB=true\\n');console.log('Wrote .env.local for Docker PostgreSQL')"`,
    instructions: 'Docker PostgreSQL will be started on localhost:5432 and .env.local will be written automatically.'
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

function updateFromGit({ force = false } = {}) {
  const branch = currentGitInfo().branch || 'arena/01a0765b-new';
  const steps = [];
  steps.push(runSync('git', ['config', '--local', '--unset-all', 'credential.helper']));
  steps.push(runSync('gh', ['auth', 'setup-git']));
  steps.push(runSync('git', ['fetch', 'origin', branch]));
  if (!steps.at(-1).ok) return { ok: false, branch, steps, hint: 'If Termux still asks for a GitHub password, run: gh auth setup-git && git config --local --replace-all credential.helper "!gh auth git-credential"' };
  steps.push(force
    ? runSync('git', ['reset', '--hard', `origin/${branch}`])
    : runSync('git', ['pull', '--ff-only', 'origin', branch]));
  return { ok: steps.every(step => step.ok), branch, force, steps, git: currentGitInfo() };
}

function restartUiSoon() {
  setTimeout(() => {
    const child = spawn(process.execPath, [process.argv[1]], {
      cwd: projectDir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, DEPLOYER_UI_PORT: String(port), DEPLOYER_UI_HOST: host, DEPLOYER_UI_TOKEN: token }
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

function startScraper() {
  if (scraper?.child && !scraper.child.killed) return scraper;
  scraperLog = '';
  const baseEnv = localEnv();
  const env = {
    ...baseEnv,
    PORT: String(scraperPort),
    RUN_WORKER_IN_WEB: baseEnv.RUN_WORKER_IN_WEB || 'true',
    DATABASE_URL: normalizeDatabaseUrl(baseEnv.DATABASE_URL)
  };
  const child = spawn(scraperCommand, { cwd: projectDir, shell: true, env });
  scraper = { running: true, pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, child, command: scraperCommand, port: scraperPort };
  const add = d => { scraperLog += d.toString(); if (scraperLog.length > maxLog) scraperLog = scraperLog.slice(-maxLog); };
  add(`[local scraper] ${scraperCommand}\n[local scraper] PORT=${scraperPort} DATABASE_URL=${env.DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}\n\n`);
  child.stdout.on('data', add); child.stderr.on('data', add);
  child.on('exit', code => { scraper.running = false; scraper.exitCode = code ?? 0; add(`\n[scraper exited with code ${scraper.exitCode}]\n`); });
  child.on('error', e => { scraper.running = false; scraper.exitCode = 1; add(`\nERROR: ${e.message}\n`); });
  return scraper;
}

function stopScraper() {
  if (scraper?.child && !scraper.child.killed) scraper.child.kill('SIGTERM');
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

function status() {
  return {
    ok: true,
    projectDir,
    package: { name: pkg.name, version: pkg.version, scripts: pkg.scripts },
    node: process.version,
    environment: detectEnvironment(),
    database: { configured: Boolean(localEnv().DATABASE_URL), effectiveUrl: normalizeDatabaseUrl(localEnv().DATABASE_URL), maskedUrl: String(normalizeDatabaseUrl(localEnv().DATABASE_URL) || '').replace(/:[^:@/]+@/, ':***@'), rawHasPlaceholder: /@HOST(?::|\/|$)/i.test(String(localEnv().DATABASE_URL || '')) },
    git: currentGitInfo(),
    files: {
      wrangler: existsSync(join(projectDir, 'wrangler.toml')),
      packageLock: existsSync(join(projectDir, 'package-lock.json')),
      staticHtmlDeployer: existsSync(join(projectDir, 'deploy-setup/static-universal-deployer.html'))
    },
    jobs: [...jobs.values()].map(({ child, ...j }) => j),
    scraper: scraper ? { running: scraper.running, pid: scraper.pid, startedAt: scraper.startedAt, exitCode: scraper.exitCode, port: scraperPort, command: scraper.command || scraperCommand } : { running: false, port: scraperPort, command: scraperCommand }
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page(token), 'text/html; charset=utf-8');
    if (!requireAuth(req, res)) return;
    if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, status());
    if (req.method === 'GET' && url.pathname === '/api/jobs') return send(res, 200, { ok: true, jobs: [...jobs.values()].map(({ child, ...j }) => j) });
    if (req.method === 'GET' && url.pathname === '/api/scraper/logs') return send(res, 200, { ok: true, log: scraperLog, scraper: status().scraper });
    if (req.method === 'POST' && url.pathname === '/api/update') {
      const body = await readJson(req);
      const result = updateFromGit({ force: Boolean(body.force) });
      if (result.ok && body.restart !== false) restartUiSoon();
      return send(res, 200, { ...result, restarting: Boolean(result.ok && body.restart !== false), message: result.ok ? 'Project updated from GitHub. Refresh this page after a few seconds.' : 'Update failed. See step output.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/job') {
      const body = await readJson(req);
      if (body.action === 'databaseInstall') {
        const plan = databaseInstallPlan();
        if (!plan.command) return send(res, 200, { ok: true, instructions: plan.instructions, detected: plan });
        const job = runJob(body.action, plan.command, [], { shell: true });
        return send(res, 200, { ok: true, detected: plan, job: (({ child, ...j }) => j)(job) });
      }
      const map = {
        install: ['npm', ['install', '--ignore-scripts', '--no-audit', '--prefer-online']],
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
Codespaces: open forwarded port ${port}; keep the token in the URL.`);
    console.log(`Project: ${projectDir}
`);
  });
}

listenWithRetry();

process.on('SIGINT', () => { stopScraper(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { stopScraper(); server.close(() => process.exit(0)); });

function page(token) {
  const commands = {"VS Code / Desktop": "git clone --branch arena/01a0765b-new https://github.com/fazilatma/new.git\ncd new\nnpm install\ncd cloudflare-scraper4\nnpm install\nnpm run deployer:ui", "Termux / Android": "cd \"$HOME\"\npkg update -y\npkg upgrade -y\npkg install -y git gh openssh nodejs-lts python make clang\nrm -rf \"$HOME/new\"\ngit config --global --unset-all credential.helper || true\ngh auth login --web -h github.com -p https\ngh auth setup-git\ngh repo clone fazilatma/new \"$HOME/new\" -- --branch arena/01a0765b-new --depth 1\ncd \"$HOME/new\"\ngit config --local --unset-all credential.helper || true\ngit config --local --replace-all credential.helper \"!gh auth git-credential\"\ngit pull --ff-only origin arena/01a0765b-new\ncd \"$HOME/new/cloudflare-scraper4\"\nnpm config set fetch-retries 5\nnpm config set fetch-retry-mintimeout 20000\nnpm config set fetch-retry-maxtimeout 120000\nnpm install --ignore-scripts --no-audit --prefer-online\nnpm run deployer:ui", "Database: Docker local": "docker rm -f scraper4-postgres || true\ndocker run --name scraper4-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=scraper4 -p 5432:5432 -d postgres:16\nprintf 'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scraper4\nRUN_WORKER_IN_WEB=true\n' > .env.local", "Database: Termux PostgreSQL": "pkg install -y postgresql\nmkdir -p \"$PREFIX/var/lib/postgresql\"\n[ -f \"$PREFIX/var/lib/postgresql/PG_VERSION\" ] || initdb \"$PREFIX/var/lib/postgresql\"\npg_ctl -D \"$PREFIX/var/lib/postgresql\" -l \"$HOME/scraper4-postgres.log\" start\ncreatedb scraper4 || true\nprintf \"DATABASE_URL=postgresql://$(whoami)@localhost:5432/scraper4\nRUN_WORKER_IN_WEB=true\n\" > .env.local", "Render.com panel": "1) Render Dashboard → New → PostgreSQL\n2) Copy Internal Database URL\n3) Your Web Service → Environment:\n   DATABASE_URL = Internal Database URL\n   RUN_WORKER_IN_WEB = true\n   ADMIN_TOKEN = long-random-secret\n4) Save Changes → Manual Deploy / Redeploy", "Cloudflare Worker": "Cloudflare Dashboard → Workers & Pages → your Worker\nSettings → Variables and Secrets:\n  VAULT_SECRET = long-random-secret\nBindings:\n  D1 DB binding name = DB\n  Queue binding name = JOBS\nDeployments → Redeploy", "API examples": "curl -X POST http://127.0.0.1:3000/api/profiles/PROFILE_ID/run -H 'content-type: application/json' -d '{\"target\":\"none\",\"pages\":1}'\ncurl -X POST http://127.0.0.1:3000/api/profiles/PROFILE_ID/run -H 'content-type: application/json' -d '{\"target\":\"both\",\"extract\":false,\"limit\":100}' "};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scraper4 Local Deployer</title>
<style>
:root{color-scheme:dark;--bg:#050814;--bg2:#0b1220;--card:#111c31cc;--card2:#0f172acc;--line:#263854;--text:#e7eefb;--muted:#93a4bc;--brand:#38bdf8;--brand2:#a78bfa;--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444;--shadow:0 24px 80px #0009}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 12% -10%,#164e63 0,#0f172a 33%,#020617 78%);color:var(--text);font:14px/1.55 Inter,ui-sans-serif,system-ui,Segoe UI,Arial}.shell{max-width:1320px;margin:0 auto;padding:22px}.hero{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:center;padding:20px;border:1px solid #ffffff18;border-radius:28px;background:linear-gradient(135deg,#0f172add,#111827aa);box-shadow:var(--shadow);position:sticky;top:12px;z-index:5;backdrop-filter:blur(16px)}.brand{display:flex;gap:14px;align-items:center}.logo{width:52px;height:52px;border-radius:18px;background:linear-gradient(135deg,var(--brand),var(--brand2));box-shadow:0 0 45px #38bdf866}.hero h1{font-size:24px;margin:0}.muted{color:var(--muted)}.pill{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:999px;background:#02061799;color:#dbeafe;padding:7px 11px;margin:3px}.grid{display:grid;grid-template-columns:330px 1fr;gap:18px;margin-top:18px}.card{border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,var(--card),var(--card2));padding:18px;box-shadow:var(--shadow)}.side{position:sticky;top:120px;align-self:start}.steps{display:grid;gap:10px}.step{display:flex;gap:10px;align-items:flex-start;padding:12px;border:1px solid #263854;border-radius:16px;background:#07111f}.step b{color:#bfdbfe}.step .num{width:28px;height:28px;border-radius:10px;background:linear-gradient(135deg,var(--brand),var(--brand2));color:#00111f;display:grid;place-items:center;font-weight:900;flex:none}label{display:block;margin:12px 0 5px;color:#cbd5e1;font-weight:700}select,input{width:100%;border:1px solid var(--line);border-radius:14px;background:#020817;color:var(--text);padding:12px}button{border:0;border-radius:14px;background:linear-gradient(135deg,var(--brand),#60a5fa);color:#00111f;font-weight:900;padding:11px 15px;cursor:pointer;margin:4px 4px 4px 0;box-shadow:0 10px 25px #0004}button:hover{filter:brightness(1.08)}.secondary{background:#24344e;color:#e5edf7}.success{background:linear-gradient(135deg,#22c55e,#86efac);color:#04140a}.danger{background:#ef4444;color:white}.warn{background:#f59e0b;color:#1c0a00}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.tabs button{background:#0f1b31;color:#cbd5e1}.tabs button.active{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#00111f}.panel{display:none}.panel.active{display:block}.status{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.metric{background:#06101e;border:1px solid var(--line);border-radius:18px;padding:14px;min-height:76px}.metric small{display:block;color:var(--muted);font-size:12px}.metric b{display:block;font-size:17px;margin-top:5px}.dot{width:10px;height:10px;border-radius:99px;background:var(--muted);display:inline-block}.dot.ok{background:var(--ok);box-shadow:0 0 15px #22c55e}.dot.warn{background:var(--warn)}pre{white-space:pre-wrap;word-break:break-word;background:#020617;border:1px solid var(--line);border-radius:18px;padding:15px;min-height:220px;max-height:520px;overflow:auto;color:#dbeafe}.guide-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}.guide-card{border:1px solid var(--line);border-radius:20px;padding:14px;background:#07111f}.guide-card h3{margin:0 0 8px}.guide-card pre{min-height:160px;max-height:260px;font-size:12px}.copy-ok{color:#86efac;font-size:12px;margin-left:8px}.banner{border:1px solid #f59e0b66;background:#42200688;color:#fde68a;border-radius:18px;padding:12px;margin-bottom:14px}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.kbd{font-family:ui-monospace,Menlo,Consolas,monospace;background:#020617;border:1px solid var(--line);border-radius:7px;padding:2px 7px}.small{font-size:12px}@media(max-width:900px){.hero{grid-template-columns:1fr}.grid{grid-template-columns:1fr}.side{position:static}.shell{padding:12px}.hero h1{font-size:20px}}
</style></head><body><main class="shell"><section class="hero"><div class="brand"><div class="logo"></div><div><h1>Scraper4 Local Deployer</h1><div class="muted">Install, database, local scraper, cloud deploy — one guided dashboard</div></div></div><div><span class="pill">Node ${process.version}</span><span class="pill">v${pkg.version || '-'}</span><span class="pill">Token protected</span></div></section>
<section class="grid"><aside class="card side"><h2>Smart setup</h2><div id="detected" class="banner">Detecting environment…</div><label>Environment</label><select id="env"><option value="vscode">VS Code / Desktop</option><option value="termux-offline">Termux / Android</option><option value="cloudflare-worker">Cloudflare Worker</option><option value="vercel">Vercel</option><option value="render">Render</option><option value="vps">VPS</option></select><label>Scraping libraries</label><select id="libs"><option value="minimal">Minimal</option><option value="edge">Edge / Cloudflare-friendly</option><option value="node" selected>Node scraping stack</option><option value="browser">Browser rendering stack</option><option value="full">Full stack</option></select><label>Package manager</label><select id="pm"><option>npm</option><option>pnpm</option><option>yarn</option><option>bun</option></select><label>Port</label><input id="port" value="3000"><div class="steps"><div class="step"><span class="num">1</span><div><b>Install deps</b><br><span class="muted small">npm dependencies and scraper libraries.</span></div></div><div class="step"><span class="num">2</span><div><b>Install/connect database</b><br><span class="muted small">Automatic where possible; panel instructions elsewhere.</span></div></div><div class="step"><span class="num">3</span><div><b>Start scraper</b><br><span class="muted small">Open the scraper dashboard after it starts.</span></div></div></div></aside>
<section><div class="tabs"><button class="active" onclick="tab('dash',this)">Overview</button><button onclick="tab('database',this)">Database</button><button onclick="tab('scraper',this)">Local scraper</button><button onclick="tab('guide',this)">Copy commands</button><button onclick="tab('jobs',this)">Logs</button></div>
<div id="dash" class="panel active"><div class="card"><h2>Project status</h2><p class="muted">If you see <span class="kbd">getaddrinfo ENOTFOUND HOST</span>, your DATABASE_URL still contains the placeholder HOST. Install PostgreSQL here or paste a real managed PostgreSQL URL in <span class="kbd">.env.local</span>.</p><div id="status" class="status"></div><div class="row" style="margin-top:14px"><button onclick="run('install')">Install / retry npm</button><button class="success" onclick="run('databaseInstall')">Install / connect database</button><button onclick="run('localBuild')">Build local scraper</button><button class="secondary" onclick="updateCode(false)">Update from GitHub</button><button class="secondary" onclick="refresh()">Refresh</button></div></div></div>
<div id="database" class="panel"><div class="card"><h2>Database setup</h2><p class="muted">The deployer can auto-detect Termux, Codespaces, desktop, Render, and Vercel. It installs PostgreSQL automatically only when the current environment supports shell/database commands. For Render/Cloudflare/Vercel it shows panel instructions.</p><div class="row"><button class="success" onclick="run('databaseInstall')">Install database now</button><button class="secondary" onclick="showDbHelp()">Show panel instructions</button></div><pre id="dbHelp"></pre></div></div>
<div id="scraper" class="panel"><div class="card"><h2>Run scraper locally</h2><p class="muted">This starts the real Node/Render scraper on port ${scraperPort}. Use the database button first if DATABASE_URL is missing or contains HOST.</p><div class="row"><button class="success" onclick="scraperStart()">Build & start local scraper</button><button class="secondary" onclick="openScraper('/')">Open scraper dashboard</button><button class="secondary" onclick="openScraper('/health')">Open /health</button><button class="danger" onclick="scraperStop()">Stop</button><button class="secondary" onclick="scraperLogs()">Refresh logs</button></div><pre id="scraperLog"></pre></div></div>
<div id="guide" class="panel"><div class="card"><h2>One-click copy commands</h2><p class="muted">Each environment has its own copy button. Paste only plain text into Termux; never paste Markdown links.</p><div id="guideCards" class="guide-grid"></div></div></div>
<div id="jobs" class="panel"><div class="card"><h2>Command output</h2><pre id="log"></pre></div></div></section></section></main>
<script>
const TOKEN = ${JSON.stringify(token)};
const COMMANDS = ${JSON.stringify(commands)};
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
    tabByIndex('jobs', 4);
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
async function scraperStart() { try { await api('/api/scraper/start', { method: 'POST', body: '{}' }); scraperLogs(); } catch (err) { logError(err); } }
function scraperUrl(path = '/') {
  const h = location.hostname;
  const proto = location.protocol || 'http:';
  if (h === 'localhost' || h === '127.0.0.1') return proto + '//' + h + ':${scraperPort}' + path;
  return 'http://localhost:${scraperPort}' + path;
}
function openScraper(path = '/') { window.open(scraperUrl(path), '_blank', 'noopener,noreferrer'); }
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
    tabByIndex('jobs', 4);
    const d = await api('/api/update', { method: 'POST', body: JSON.stringify({ force, restart: true }) });
    $('log').textContent = JSON.stringify(d, null, 2) + String.fromCharCode(10,10) + 'If update succeeded, wait a few seconds and refresh.';
    setTimeout(() => location.reload(), 3500);
  } catch (err) { logError(err); }
}
function renderGuides() {
  const container = $('guideCards');
  if (!container) return;
  const names = Object.keys(COMMANDS);
  container.innerHTML = names.map((name, i) => '<div class="guide-card"><h3>' + name + '</h3><button class="secondary" onclick="copyCommand(' + i + ',this)">Copy all</button><span class="copy-ok" id="copied' + i + '"></span><pre id="cmd' + i + '"></pre></div>').join('');
  Object.values(COMMANDS).forEach((cmd, i) => { $('cmd' + i).textContent = cmd; });
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
  $('dbHelp').textContent = [COMMANDS['Database: Docker local'], '--- Termux ---', COMMANDS['Database: Termux PostgreSQL'], '--- Render ---', COMMANDS['Render.com panel']].join(String.fromCharCode(10,10));
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
    const dbLabel = db.configured ? (/HOST/i.test(db.maskedUrl || '') ? 'Placeholder HOST' : 'Configured') : 'Missing';
    const statusEl = $('status');
    if (statusEl) statusEl.innerHTML = '<div class="metric"><small>Package</small><b>' + d.package.name + '</b></div><div class="metric"><small>Version</small><b>' + (d.package.version || '-') + '</b></div><div class="metric"><small>Database</small><b>' + dbLabel + '</b><small>' + (db.maskedUrl || 'Use Database tab') + '</small></div><div class="metric"><small>Scraper</small><b>' + (scraper.running ? 'Running:' + scraper.port : 'Stopped') + '</b></div><div class="metric"><small>Git</small><b class="small">' + (d.git?.commit || '-') + '</b></div><div class="metric"><small>Project</small><b class="small">' + d.projectDir + '</b></div>';
  } catch (err) { logError(err); }
}
window.tab = tab;
window.run = run;
window.scraperStart = scraperStart;
window.openScraper = openScraper;
window.scraperStop = scraperStop;
window.scraperLogs = scraperLogs;
window.updateCode = updateCode;
window.copyCommand = copyCommand;
window.showDbHelp = showDbHelp;
renderGuides();
showDbHelp();
refresh();
setInterval(refresh, 5000);
</script></body></html>`;
}
