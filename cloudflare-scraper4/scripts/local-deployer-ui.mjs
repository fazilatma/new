#!/usr/bin/env node
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
const scraperPort = Number(process.env.SCRAPER_PORT || 8787);
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
  steps.push(runSync('git', ['fetch', 'origin', branch]));
  if (!steps.at(-1).ok) return { ok: false, branch, steps };
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
  const child = spawn(command, args, { cwd: projectDir, shell: false, env: { ...process.env, ...options.env } });
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
  const child = spawn('npm', ['run', 'worker:dev'], { cwd: projectDir, shell: false, env: { ...process.env, PORT: String(scraperPort) } });
  scraper = { running: true, pid: child.pid, startedAt: new Date().toISOString(), exitCode: null, child };
  const add = d => { scraperLog += d.toString(); if (scraperLog.length > maxLog) scraperLog = scraperLog.slice(-maxLog); };
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
    git: currentGitInfo(),
    files: {
      wrangler: existsSync(join(projectDir, 'wrangler.toml')),
      packageLock: existsSync(join(projectDir, 'package-lock.json')),
      staticHtmlDeployer: existsSync(join(projectDir, 'deploy-setup/static-universal-deployer.html'))
    },
    jobs: [...jobs.values()].map(({ child, ...j }) => j),
    scraper: scraper ? { running: scraper.running, pid: scraper.pid, startedAt: scraper.startedAt, exitCode: scraper.exitCode, port: scraperPort } : { running: false, port: scraperPort }
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
      const map = {
        install: ['npm', ['ci']],
        test: ['npm', ['run', 'worker:test']],
        build: ['npm', ['run', 'worker:build']],
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

function page(token) { return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Scraper4 Local Deployer</title>
<style>
:root{--bg:#07111f;--panel:#0f172a;--panel2:#111c31;--line:#26364f;--text:#e5edf7;--muted:#91a4bd;--brand:#38bdf8;--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444;--shadow:0 18px 55px #0007}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#12335b 0,#07111f 38%,#030712 100%);color:var(--text);font:14px/1.5 Inter,ui-sans-serif,system-ui,Segoe UI,Arial}header{position:sticky;top:0;z-index:3;backdrop-filter:blur(14px);background:#07111fcc;border-bottom:1px solid var(--line)}.wrap{max-width:1280px;margin:auto;padding:18px}.hero{display:flex;gap:16px;align-items:center;justify-content:space-between}.logo{width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg,#38bdf8,#a78bfa);box-shadow:0 0 35px #38bdf866}.title{display:flex;gap:12px;align-items:center}h1,h2,h3{margin:.1rem 0}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:360px 1fr;gap:18px}@media(max-width:900px){.grid{grid-template-columns:1fr}.hero{align-items:flex-start;flex-direction:column}}.card{background:linear-gradient(180deg,#101b30ee,#0b1222ee);border:1px solid var(--line);border-radius:20px;padding:16px;box-shadow:var(--shadow)}label{display:block;margin:10px 0 5px;color:#cbd5e1;font-weight:650}select,input{width:100%;border:1px solid var(--line);border-radius:12px;background:#06101e;color:var(--text);padding:11px}button{border:0;border-radius:12px;background:var(--brand);color:#00111f;font-weight:800;padding:11px 14px;cursor:pointer;margin:4px 4px 4px 0}.secondary{background:#24344e;color:#e5edf7}.danger{background:var(--bad);color:white}.success{background:var(--ok);color:#04140a}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.pill{display:inline-flex;gap:6px;align-items:center;border:1px solid var(--line);border-radius:999px;padding:5px 10px;background:#06101e;color:#cdeafe;margin:3px}.status{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.metric{background:#07111f;border:1px solid var(--line);border-radius:14px;padding:12px}.dot{width:10px;height:10px;border-radius:99px;background:var(--muted);display:inline-block}.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}pre{white-space:pre-wrap;word-break:break-word;background:#020617;border:1px solid var(--line);border-radius:16px;padding:14px;min-height:280px;max-height:480px;overflow:auto;color:#dbeafe}.tabs button{background:#111c31;color:#dbeafe}.tabs button.active{background:var(--brand);color:#00111f}.panel{display:none}.panel.active{display:block}.small{font-size:12px}.kbd{font-family:ui-monospace,Menlo,Consolas,monospace;background:#020617;border:1px solid var(--line);border-radius:6px;padding:2px 6px}</style></head>
<body><header><div class="wrap hero"><div class="title"><div class="logo"></div><div><h1>Scraper4 Local Deployer</h1><div class="muted">Advanced local UI for VS Code and GitHub Codespaces</div></div></div><div class="row"><span class="pill">Node ${process.version}</span><span class="pill">Protected by local token</span></div></div></header>
<main class="wrap grid"><aside class="card"><h2>Wizard</h2><label>Environment</label><select id="env"><option value="vscode">VS Code</option><option value="termux-offline">Termux offline</option><option value="cloudflare-worker">Cloudflare Worker</option><option value="vercel">Vercel</option><option value="render">Render</option><option value="vps">VPS</option></select><label>Scraping libraries</label><select id="libs"><option value="minimal">Minimal</option><option value="edge">Edge / Cloudflare-friendly</option><option value="node" selected>Node scraping stack</option><option value="browser">Browser rendering stack</option><option value="full">Full stack</option></select><label>Package manager</label><select id="pm"><option>npm</option><option>pnpm</option><option>yarn</option><option>bun</option></select><label>Service name</label><input id="name" value="${pkg.name || 'scraper4-cloudflare'}"><label>Port</label><input id="port" value="3000"><div class="row" style="margin-top:14px"><button onclick="run('deployerPlan')">Plan</button><button class="secondary" onclick="run('deployerPrepare')">Prepare</button></div><p class="muted small">Plan is read-only. Prepare writes generated helper files under <span class="kbd">.deploy/</span> and may create project config files depending on the selected environment.</p></aside>
<section><div class="tabs row"><button class="active" onclick="tab('dash',this)">Dashboard</button><button onclick="tab('scraper',this)">Local scraper</button><button onclick="tab('jobs',this)">Logs</button><button onclick="tab('guide',this)">Guide</button></div>
<div id="dash" class="panel active"><div class="card"><h2>Project status</h2><div id="status" class="status"></div><div class="row" style="margin-top:14px"><button onclick="run('install')">npm ci</button><button onclick="run('test')">Run tests</button><button onclick="run('build')">Build Worker</button><button class="secondary" onclick="updateCode(false)">Update from GitHub</button><button class="secondary" onclick="refresh()">Refresh</button></div></div></div>
<div id="scraper" class="panel"><div class="card"><h2>Run scraper locally</h2><p class="muted">This starts <span class="kbd">npm run worker:dev</span>, which launches Wrangler on port 8787. In Codespaces, open forwarded port 8787.</p><div class="row"><button class="success" onclick="scraperStart()">Start local scraper</button><button class="danger" onclick="scraperStop()">Stop</button><button class="secondary" onclick="scraperLogs()">Refresh logs</button><a class="pill" href="http://localhost:8787/health" target="_blank">Open /health</a><a class="pill" href="http://localhost:8787/" target="_blank">Open dashboard</a></div><pre id="scraperLog"></pre></div></div>
<div id="jobs" class="panel"><div class="card"><h2>Command output</h2><pre id="log"></pre></div></div>
<div id="guide" class="panel"><div class="card"><h2>Quick start</h2><pre>cd cloudflare-scraper4
npm ci
npm run deployer:ui

Open the printed URL. In Codespaces, forward port ${port} and keep ?token=... in the URL. If port 8790 is busy, the server automatically tries the next ports.

To run manually without UI:
npm run worker:dev
npm run deploy:universal -- --help</pre></div></div></section></main>
<script>
const TOKEN=${JSON.stringify(token)};let activeJob='';
async function api(path,opt={}){try{const r=await fetch(path,{...opt,headers:{'content-type':'application/json','x-local-deployer-token':TOKEN,...(opt.headers||{})}});const d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.error||('HTTP '+r.status));return d}catch(e){const el=document.getElementById('log')||document.getElementById('scraperLog');if(el)el.textContent='UI/API error: '+(e.message||e);throw e}}
function tab(id,btn){document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));document.getElementById(id).classList.add('active');document.querySelectorAll('.tabs button').forEach(x=>x.classList.remove('active'));btn.classList.add('active')}
function body(action){return JSON.stringify({action,env:env.value,scrapingLibs:libs.value,packageManager:pm.value,name:name.value,port:port.value,dryRun:true})}
async function run(action){activeJob=action;document.getElementById('log').textContent='Starting '+action+'...';tab('jobs',document.querySelectorAll('.tabs button')[2]);await api('/api/job',{method:'POST',body:body(action)});pollJobs()}
async function pollJobs(){const data=await api('/api/jobs');const job=data.jobs.find(j=>j.name===activeJob)||data.jobs.at(-1);if(job)document.getElementById('log').textContent='$ '+job.command+String.fromCharCode(10,10)+job.log;if(job?.running)setTimeout(pollJobs,1200);refresh()}
async function scraperStart(){await api('/api/scraper/start',{method:'POST',body:'{}'});scraperLogs()}
async function scraperStop(){await api('/api/scraper/stop',{method:'POST',body:'{}'});scraperLogs()}
async function scraperLogs(){const d=await api('/api/scraper/logs');document.getElementById('scraperLog').textContent=d.log||'No logs yet.';refresh();if(d.scraper?.running)setTimeout(scraperLogs,1500)}
async function updateCode(force){if(force&&!confirm('Force update discards local uncommitted changes. Continue?'))return;document.getElementById('log').textContent='Updating from GitHub...';tab('jobs',document.querySelectorAll('.tabs button')[2]);const d=await api('/api/update',{method:'POST',body:JSON.stringify({force,restart:true})});document.getElementById('log').textContent=JSON.stringify(d,null,2)+String.fromCharCode(10,10)+'If update succeeded, wait a few seconds and refresh this page.';setTimeout(()=>location.reload(),3500)}
async function refresh(){const d=await api('/api/status');const s=d.scraper;document.getElementById('status').innerHTML='<div class="metric"><span class="dot ok"></span> '+d.package.name+'</div><div class="metric">Version: '+(d.package.version||'-')+'</div><div class="metric">Wrangler: '+(d.files.wrangler?'yes':'no')+'</div><div class="metric">Scraper: '+(s.running?'running on '+s.port:'stopped')+'</div><div class="metric">Git: <span class="small">'+(d.git?.commit||'-')+'</span></div><div class="metric">Project: <span class="small">'+d.projectDir+'</span></div>'}
refresh();setInterval(refresh,5000);
</script></body></html>`; }
