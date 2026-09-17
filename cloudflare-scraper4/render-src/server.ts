import { benchmarkPagination } from '../worker-src/benchmark-pagination.js';
import { extractionDetails } from '../worker-src/job-details.js';
import { refreshDestinationLedger, destinationLedgerStatus, destinationLedgerProducts, ledgerMissing } from './maintenance.js';
import { maintenanceResponse } from '../worker-src/maintenance-response.js';
import { saveConnectionsAndReprice, drainWooReprice } from '../worker-src/woo-reprice.js';
import { mergeConnections } from './vault.js';
import { activityMiddleware, monitored } from '../worker-src/activity-monitor.js';
import { listActiveJobs, listLiveActivities, deleteState } from './db.js';
import { saveBenchmarkProfile } from './db.js';
import { applyStoredResultSettings } from './db.js';
import { PUSH_SERVICE_WORKER, PUSH_MANIFEST, PUSH_ICON, pushIconPng } from '../worker-src/push-assets.js';
import { pushConfiguration, subscribePush, unsubscribePush, deliverPush, pushDeployerNotices } from './web-push.js';
import { diagnosticStream, type DiagnosticObserver } from '../worker-src/diagnostic-progress.js';
import { serve } from '@hono/node-server';
import { timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { assignProductBasalamCategory, aiCall, aiChatWithMessages, aiConnectionDiagnostic, aiProviders, controlAiTestRun, generateProductDescription, getCurrentAiRun, getLeaderboard, isChatCompatibleAiModel, isReasoningAiModel, parseModelKeySuffix, preferredAiChatModel, productNeedsBasalamCategory, productNeedsEnrichment, providerKeys, providerWithKey, recordVote, resetAiTestRun, retryAiTestPart, startAiTestRun, suggestCategoryWithModel, testAllModels } from './ai.js';
import { automationTick as rawautomationTick, autoreplyLogs, autoreplyRun, basalamChats, basalamOrders, digest, generateReply } from './automation.js';
import { config, assertConfig, runtimeEnvironment } from './config.js';
import { BOOTSTRAP_MARKER_KEY, bootstrapCandidates, maybeRestoreBootstrap, shouldAutoRestoreBootstrap } from './bootstrap.js';
import { DEFAULT_REPO, normalizeInstallBranch, normalizeRepo, pickGithubToken, scanDeployerBranches } from '../worker-src/deployer-branches.js';
import { fetchBranchBackupFile, fetchBranchBackupSplit, listBranchBackupFiles, pushBranchBackupSplit, scheduledBranchPushTick as rawscheduledBranchPushTick, type SplitDatabaseInput } from '../worker-src/branch-backup.js';
import { AGENT_TOOL_MODELS } from '../worker-src/ai-catalog.js';
import { CATEGORY_FIX_LAST_KEY, categoryFixTick } from '../worker-src/destination-core.js';
import { AI_ENRICH_LAST_KEY, aiEnrichTick as rawaiEnrichTick } from '../worker-src/ai-enrich.js';
import { connectionStatus, loadConnections, saveConnections } from './connections.js';
import { DASHBOARD, DASHBOARD_JS, setupPage } from './dashboard.js';
import { fontFile, fontStylesheet } from './fonts.js';
import { githubApiFetch, githubApiPut } from './github-client.js';
import { fallbackToSqlite, sqliteFallbackReason, isLoopbackPostgres, listStalestProducts, clearFinishedJobs, clearImportHistory, clearProducts, createBackup, createJob, databaseDriver, databaseLabel, deleteJob, deleteProduct, deleteProfile, enqueueDueProfiles, findLearnedCategory, getImportHistory, getJob, getJobPriorities, getProduct, getProfile, getRunPriorities, getState, getTriedBasalamCategories, importAutoreplyLog, importCategoryLearning, isFreshDatabase, learnCategory, listCategoryLearning, listJobs, listProducts, listProfiles, markProfileRun, markBasalamCategoriesTried, migrate, pool, profileStats, reapStalledJobs, recoverFailedAndStalledJobs, restoreBackup, retryJob, saveProfile, setJobPriorities, setRunPriorities, setState, snapshotSqliteDatabase, stopJob, updateJob, upsertProduct } from './db.js';
import { DEFAULT_SELECTORS, type ExtractionEngine, type Product, type Profile } from './types.js';
import { safeFetch, safeText } from './network.js';
import { sendNotification } from './notifications.js';
import { PHP_MENU_CAPABILITIES, runSelftest } from './parity.js';
import { controlDedupRun, getPublicDedupRun, recoverDedupRun, resetDedupRun, startDedupRun } from './dedup-run.js';
import { controlCategoryRun, getPublicCategoryRun, recoverCategoryRun, resetCategoryRun, startCategoryRun } from './category-run.js';
import { bulkEdit, destinationBulkEdit, destinationCatalog, destinationCategories, destinationChangeStatus, destinationDelete, destinationOverview, destinationProduct, destinationUpdate, findDestinationDuplicates, listDestinationProducts, photoFix, rebuildMap, recon, reconAccounts, reconTable, retire, unifiedRecon, unifiedReconApply, destinationDuplicates } from './maintenance.js';
import { benchmarkScroll, benchmarkProbeUrl, browserEngineAvailable, diagnoseBenchmarkEngine, diagnoseExtraction, mapLimit, numberFromText, pageUrl, scrapeDetails, scrapeListWithMeta, suggestSelectors, testSelector } from './scraper.js';
import { runDiagnostics } from './diagnostics.js';
import { basalamSdkBridgePath, basalamSdkStatus, describeBasalamToken, syncBasalam, syncWoo } from './sync.js';
import { createPhpSettingsBundle, decodePhpSettingsBundle, stateKeyForFile } from './settings-transfer.js';
import { createVisualTicket, readVisualTicket, visualSelectorCsp, renderVisualSelector } from './visual.js';
import { requestWorkerStop, processOneJob } from './processor.js';
import { createJobDispatcher } from './job-dispatcher.js';

const PACKAGE_VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '1.204.0+'; } catch { return process.env.npm_package_version || '1.204.0+'; } })();
const runtimeVersion = () => process.env.WORKER_VERSION || PACKAGE_VERSION;
type LibraryItem=(name:string,available:boolean,version?:string,source?:string,note?:string)=>{name:string;available:boolean;installed:boolean;version:string;source:string;note:string};
function pythonSdkItems(item:LibraryItem,command:(name:string)=>string){
  const pythonName=process.env.BASALAM_PYTHON||process.env.PYTHON||'python3';
  const pythonPath=/[/\\]/.test(pythonName)?(existsSync(pythonName)?pythonName:''):command(pythonName);
  let pythonVersion='';
  if(pythonPath){try{const v=spawnSync(pythonName,['--version'],{encoding:'utf8',timeout:10000});pythonVersion=String(v.stdout||v.stderr||'').trim().split(/\s+/).pop()||''}catch{/* version probe is best-effort */}}
  let sdk={available:false,version:'',python:'',executable:'',error:''};
  try{sdk=basalamSdkStatus()}catch(error){sdk={available:false,version:'',python:'',executable:pythonName,error:error instanceof Error?error.message:String(error)}}
  const bridge=(()=>{try{return basalamSdkBridgePath()}catch{return''}})();
  return[
    item('python3 interpreter',Boolean(pythonPath),pythonVersion||pythonPath||pythonName,'system command',pythonPath?'':'set BASALAM_PYTHON or install python3, then: npm run basalam:install'),
    item('basalam-sdk-bridge.py',Boolean(bridge&&existsSync(bridge)),bridge?'scripts/basalam-sdk-bridge.py':'','project script'),
    item('basalam-sdk (pip)',sdk.available,sdk.version||(sdk.available?'installed':''),'python bridge',sdk.available?`via ${sdk.executable||pythonName}`:(sdk.error?`missing: ${sdk.error.slice(0,160)}`:'run: npm run basalam:install')),
  ];
}
function nodeLibraryProbe(){
  const root=new URL('..',import.meta.url),pkgJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const deps={...(pkgJson.dependencies||{}),...(pkgJson.devDependencies||{})};
  const resolvePackage=(name:string)=>Boolean(deps[name]);
  const command=(name:string)=>{const r=spawnSync(process.platform==='win32'?'where':'which',[name],{encoding:'utf8'});return r.status===0?(r.stdout||'').trim().split(/\r?\n/)[0]:''};
  const item=(name:string,available:boolean,version='',source='runtime',note='')=>({name,available,installed:available,version,source,note});
  const npm=(name:string)=>item(name,resolvePackage(name),String(deps[name]||''),'npm dependency');
  const groups=[
    {label:'Node runtime',items:[item('Node.js',true,process.version,'runtime'),item('node:sqlite',true,process.versions.node,'built-in'),item('undici/fetch',typeof fetch==='function',process.versions.node,'built-in')]},
    {label:'Installed npm scraping/runtime libraries',items:['hono','@hono/node-server','cheerio','linkedom','undici','playwright','puppeteer','crawlee','read-excel-file','fflate','pg','@basalam/sdk','@basalam/node-sdk','basalam-sdk','basalam'].map(npm)},
    {label:'Build/deploy dependencies',items:['typescript','esbuild','wrangler'].map(npm)},
    {label:'System browser/tools',items:['chromium','chromium-browser','google-chrome','git','gh','psql'].map(name=>{const path=command(name);return item(name,Boolean(path),path,'system command')})},
    {label:'Python / Basalam SDK',items:pythonSdkItems(item,command)},
    {label:'Storage configuration',items:[item(databaseLabel,true,databaseDriver,'database'),item('DATABASE_URL',Boolean(process.env.DATABASE_URL),'configured','environment'),item('RUN_WORKER_IN_WEB',config.runWorkerInWeb,'configured','environment')]}
  ];
  return{ok:true,environment:process.env.TERMUX_VERSION?'termux-node':process.env.RENDER?'render-node':'local-node',queriedAt:new Date().toISOString(),dynamic:true,projectDir:String(root.pathname),groups};
}
// '0', 'no' and 'off' are what people actually type in an .env file; only 'false' used to work,
// so a Termux box that meant "leave my working tree alone" kept running git reset --hard on a timer.
const localScraperAutoUpdate = !/^(?:false|0|no|off)$/i.test(String(process.env.LOCAL_SCRAPER_AUTO_UPDATE ?? 'true').trim()) && process.env.RENDER !== 'true';
const localScraperAutoUpdateMs = Math.max(60_000, Number(process.env.LOCAL_SCRAPER_AUTO_UPDATE_MS || 600_000));
let localScraperUpdateRunning = false;
let localScraperDirtySkipLogged = -1;
let localScraperUnpushedSkipLogged = -1;
let localScraperBootHead = '';
let localScraperMovedWarnedHead = '';
const isTermuxInstall = process.platform === 'android' || Boolean(process.env.TERMUX_VERSION) || /com\.termux/i.test(String(process.env.PREFIX || ''));
function runLocal(command: string, args: string[] = []) { return spawnSync(command, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: process.env }); }
// Boot-baked identity for the deployer's stale-serving check: the git head is
// read ONCE here, so a stale build keeps reporting what it booted even after
// the checkout moves on. Never read this per-request.
const BOOT_HEAD = (() => { try { return String(runLocal('git', ['rev-parse', 'HEAD']).stdout || '').trim(); } catch { return ''; } })();
function maybeAutoUpdateLocalScraper(reason = 'timer') {
  if (!localScraperAutoUpdate || localScraperUpdateRunning) return;
  localScraperUpdateRunning = true;
  try {
    // Never `git reset --hard` over uncommitted work: the auto-updater would
    // silently delete edits that only exist in the working tree.
    const dirty = runLocal('git', ['status', '--porcelain']);
    if (dirty.status === 0 && String(dirty.stdout || '').trim()) {
      const files = String(dirty.stdout).trim().split('\n').length;
      if (localScraperDirtySkipLogged !== files) {
        localScraperDirtySkipLogged = files;
        console.warn(`[auto-update:${reason}] paused: ${files} uncommitted change(s) would be lost by git reset --hard. Commit or stash to resume.`);
      }
      return;
    }
    localScraperDirtySkipLogged = -1;
    // A clean tree still hides local commits that were never pushed; resetting
    // to origin would erase them too.
    const headBranch = (runLocal('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || '').trim();
    runLocal('git', ['fetch', 'origin', headBranch]);
    const ahead = headBranch ? runLocal('git', ['rev-list', '--count', `origin/${headBranch}..HEAD`]) : { status: 1, stdout: '' };
    const unpushed = ahead.status === 0 ? Number(String(ahead.stdout || '').trim()) || 0 : 0;
    if (unpushed > 0) {
      if (localScraperUnpushedSkipLogged !== unpushed) {
        localScraperUnpushedSkipLogged = unpushed;
        console.warn(`[auto-update:${reason}] paused: ${unpushed} unpushed commit(s) would be lost by git reset --hard. Push them to resume.`);
      }
      return;
    }
    localScraperUnpushedSkipLogged = -1;
    const branch = (runLocal('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || 'arena/01a09468-new').trim() || 'arena/01a09468-new';
    const before = (runLocal('git', ['rev-parse', 'HEAD']).stdout || '').trim();
    const fetched = runLocal('git', ['fetch', 'origin', branch]);
    if (fetched.status !== 0) return console.warn(`[auto-update:${reason}] git fetch failed: ${fetched.stderr || fetched.stdout}`);
    const remote = (runLocal('git', ['rev-parse', `origin/${branch}`]).stdout || '').trim();
    // The deployer can move the checkout under a running scraper (branch
    // install) while this process keeps serving its old build: before then
    // equals remote, so the updater below would stay silent forever. Never
    // exit here (a manually started scraper has nothing to restart it) — warn
    // loudly instead so the operator restarts it.
    if (!localScraperBootHead) localScraperBootHead = before;
    if (before && before !== localScraperBootHead && before === remote && localScraperMovedWarnedHead !== before) {
      localScraperMovedWarnedHead = before;
      // A deployer-managed scraper HAS something to restart it (exit 75), so
      // converge instead of warning forever; a manual start keeps warn-only.
      if (process.env.DEPLOYER_MANAGED === 'true') {
        console.log(`[auto-update:${reason}] the checkout moved under this deployer-managed scraper (${localScraperBootHead.slice(0, 7)} -> ${before.slice(0, 7)}); rebuilding and exiting so the deployer restarts the new build...`);
        runLocal(process.platform === 'win32' ? 'npm.cmd' : 'npm', isTermuxInstall ? ['install', '--ignore-scripts', '--no-audit', '--prefer-online'] : ['install', '--no-audit', '--prefer-online']);
        runLocal(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'render:build']);
        setTimeout(() => process.exit(75), 500);
        return;
      }
      console.warn(`[auto-update:${reason}] the git checkout moved under this running scraper (${localScraperBootHead.slice(0, 7)} -> ${before.slice(0, 7)}) but it still serves the old build. Restart the scraper (deployer: Stop, then Build & start) to apply the new code.`);
    }
    if (!before || !remote || before === remote) return;
    console.log(`[auto-update:${reason}] New scraper code found ${before.slice(0,7)} -> ${remote.slice(0,7)}. Updating and restarting local scraper...`);
    runLocal('git', ['config', '--local', '--replace-all', 'credential.helper', '!gh auth git-credential']);
    const reset = runLocal('git', ['reset', '--hard', `origin/${branch}`]);
    if (reset.status !== 0) return console.warn(`[auto-update:${reason}] git reset failed: ${reset.stderr || reset.stdout}`);
    runLocal(process.platform === 'win32' ? 'npm.cmd' : 'npm', isTermuxInstall ? ['install', '--ignore-scripts', '--no-audit', '--prefer-online'] : ['install', '--no-audit', '--prefer-online']);
    runLocal(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'render:build']);
    setTimeout(() => process.exit(75), 500);
  } finally { localScraperUpdateRunning = false; }
}
let databaseReady = false;
let databaseError = '';
function describeDatabaseError(error: unknown): string {
  const parts: string[] = [];
  const collect = (value: any) => {
    if (!value) return;
    if (typeof value.message === 'string' && value.message.trim()) parts.push(value.message.trim());
    // AggregateError (node-postgres retries IPv6 then IPv4) has an empty own
    // message; every real reason is inside .errors.
    if (Array.isArray(value.errors)) for (const inner of value.errors) collect(inner);
    else if (value.cause) collect(value.cause);
  };
  collect(error);
  const anyError = error as any;
  if (!parts.length && anyError?.code) parts.push(String(anyError.code));
  let detail = [...new Set(parts)].join('; ') || 'Unknown database error';
  if (/ECONNREFUSED/i.test(detail) && databaseDriver === 'postgres') {
    detail += ' — PostgreSQL is not running at this address. On Termux/Android, PostgreSQL is optional: remove DATABASE_URL from .env.local (or set DATABASE_URL=sqlite:data/scraper4.sqlite) to use the built-in SQLite database, which needs no server.';
  }
  return detail;
}
async function initializeDatabase(): Promise<boolean> {
  try {
    assertConfig();
    await migrate();
    await pool.query('SELECT 1');
    databaseReady = true; databaseError = '';
    console.log(`${databaseLabel} connected and schema is ready`);
    return true;
  } catch (error) {
    const detail = describeDatabaseError(error);
    // A refused connection to a PostgreSQL on THIS device means no server is
    // installed (the default situation on Termux/Android). Rather than looping
    // on ECONNREFUSED forever with a red status light, fall back to the
    // built-in SQLite database and carry on.
    if (/ECONNREFUSED|ENOENT|EAI_AGAIN/i.test(detail) && fallbackToSqlite(detail)) {
      console.warn(`Local PostgreSQL is unreachable; switching to the built-in SQLite database. Reason: ${detail}`);
      try {
        await migrate();
        await pool.query('SELECT 1');
        databaseReady = true;
        databaseError = '';
        console.log(`${databaseLabel} connected and schema is ready (automatic fallback)`);
        return true;
      } catch (fallbackError) {
        databaseReady = false;
        databaseError = describeDatabaseError(fallbackError);
        console.error(`DATABASE NOT READY: ${databaseError}`);
        return false;
      }
    }
    databaseReady = false;
    databaseError = detail;
    console.error(`DATABASE NOT READY: ${databaseError}`);
    return false;
  }
}
await initializeDatabase();
// Fresh-database bootstrap restore (see render-src/bootstrap.ts): on by default
// on Render so every deploy re-seeds settings from the secret file. A configured
// database is never touched, and failures are surfaced via the status endpoint
// instead of crashing the boot.
let bootstrapLastError: string | null = null;
try {
  const boot = await maybeRestoreBootstrap({
    env: process.env as unknown as Record<string, string>, cwd: process.cwd(),
    exists: (path: string) => { try { return existsSync(path); } catch { return false; } },
    readFile: (path: string) => readFileSync(path, 'utf8'),
    isFresh: isFreshDatabase,
    importBundle: (bundle: unknown) => importSettingsBundle(bundle),
    setMarker: async (at: string, path: string) => { await setState(BOOTSTRAP_MARKER_KEY, { at, path }); },
  });
  if (!boot.ok) { bootstrapLastError = boot.error || 'unknown error'; console.error(`[bootstrap] restore failed: ${bootstrapLastError}`); }
  else if (boot.restored) console.log(`[bootstrap] settings restored from ${boot.path}`);
} catch (error) { bootstrapLastError = error instanceof Error ? error.message : String(error); console.error(`[bootstrap] restore failed: ${bootstrapLastError}`); }

const app = new Hono();
const dashboardHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'], objectSrc: ["'none'"], frameAncestors: ["'none'"]
  }
});
app.use('*', async (c, next) => c.req.path === '/visual' ? next() : dashboardHeaders(c, next));
app.use('/api/*', cors({ origin: origin => origin, allowHeaders: ['authorization','content-type','x-scraper-activity'], allowMethods: ['GET','POST','PUT','DELETE'] }));
app.onError((error, c) => { console.error(error); return c.json({ ok: false, error: error.message }, 500); });
app.get('/sw.js',c=>c.body(PUSH_SERVICE_WORKER,200,{'content-type':'application/javascript; charset=utf-8','cache-control':'no-store','service-worker-allowed':'/'}));
app.get('/manifest.webmanifest',c=>c.json(PUSH_MANIFEST,200,{'content-type':'application/manifest+json'}));
app.get('/app-icon-192.png',c=>c.body(pushIconPng('192'),200,{'content-type':'image/png'}));
app.get('/app-icon-512.png',c=>c.body(pushIconPng('512'),200,{'content-type':'image/png'}));
app.get('/app-icon.svg',c=>c.body(PUSH_ICON,200,{'content-type':'image/svg+xml'}));
app.get('/health', c => c.json({
  ok: true,
  app: 'scraper4',
  environment: runtimeEnvironment.label,
  runtime: process.version,
  version: runtimeVersion(),
  packageVersion: PACKAGE_VERSION,
  autoUpdate: { enabled: localScraperAutoUpdate, intervalMs: localScraperAutoUpdateMs, running: localScraperUpdateRunning },
  databaseReady,
  databaseDriver,
  databaseLabel,
  databaseError: databaseReady ? null : databaseError,
  workerInWeb: config.runWorkerInWeb,
  time: new Date().toISOString()
}));
app.get('/', c => c.html(DASHBOARD, 200, { 'cache-control': 'no-store' }));
app.get('/setup', c => c.html(setupPage(databaseError || 'Database is ready.')));
app.get('/dashboard.js', c => c.body(DASHBOARD_JS, 200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' }));
app.get('/assets/fonts/:file', async c => {
  const file = c.req.param('file');
  const css = file.match(/^([a-z]+)\.css$/i);
  const woff = file.match(/^([a-z]+)-(\d+)\.woff2$/i);
  if (css) return fontStylesheet(css[1]);
  return woff ? fontFile(woff[1], woff[2]) : c.notFound();
});
app.get('/visual', async c => {
  try {
    const content = await renderVisualSelector(c.req.query('ticket') || '');
    return c.html(content, 200, {
      'cache-control': 'no-store',
      'content-security-policy': visualSelectorCsp(c.req.query('ticket') || ''),
      'referrer-policy': 'no-referrer'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.html(`<html dir="rtl"><body style="background:#0f172a;color:#fca5a5;font-family:Tahoma;padding:30px"><h2>خطای انتخاب‌گر بصری</h2><p>${message.replace(/[&<>]/g, '')}</p></body></html>`, 400);
  }
});

app.use('/api/*', async (c, next) => {
  if (!databaseReady) return c.json({ ok: false, error: 'Database is not configured', detail: databaseError, setup: runtimeEnvironment.dbHint, environment: runtimeEnvironment.label }, 503);
  if (!config.adminToken) return next();
  const auth = c.req.header('authorization') || '';
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), config.adminToken)) return c.json({ ok: false, error: 'Unauthorized' }, 401);
  await next();
});

app.use('/api/*',activityMiddleware({setState,deleteState}));
app.get('/api/web-push/config',c=>c.json({ok:true,...pushConfiguration()}));
app.post('/api/web-push/subscribe',async c=>c.json(await subscribePush(await c.req.json())));
app.post('/api/web-push/unsubscribe',async c=>{const b=await c.req.json() as any;return c.json(await unsubscribePush(String(b.id||'')))});
app.post('/api/web-push/test',async c=>{const b=await c.req.json() as any;if(!/^[a-f0-9]{64}$/.test(String(b.id||'')))return c.json({ok:false,error:'Subscribe this browser first.'},400);return c.json(await deliverPush({title:'Scraper4',body:'اعلان آزمایشی از سرور دریافت شد.',tag:'scraper4-test'},b.id))});
app.post('/api/visual-ticket', async c => {
  const body = await c.req.json() as { url?: string; profileId?: string; engine?: string; indirect?: boolean };
  const url = new URL(String(body.url || ''));
  if (!['http:', 'https:'].includes(url.protocol)) return c.json({ ok: false, error: 'Invalid visual selector URL' }, 400);
  const profile=body.profileId?await getProfile(String(body.profileId)):null;
  const engine=String(body.engine||profile?.extractionEngine||'auto'),indirect=body.indirect??Boolean(profile?.networkIndirect);
  const ticket=createVisualTicket(url.href,{engine,indirect});
  return c.json({ ok:true,ticket,channel:readVisualTicket(ticket).channel,engine,expiresIn:300 });
});
app.get('/api/status', async c => { const connections=await loadConnections(); return c.json({ ok:true,profiles:(await listProfiles()).length,jobs:await listJobs(10),connections:connectionStatus(connections) }); });
app.get('/api/version', c => c.json({ ok: true, version: runtimeVersion(), head: BOOT_HEAD, runtime: `local-node-${runtimeEnvironment.id}`, environment: runtimeEnvironment.label, ui: 'cloudflare-compatible' }));

app.get('/api/deployer/branches',async c=>{const raw=c.req.query('repo'),repo=raw===undefined||raw==='' ?DEFAULT_REPO:normalizeRepo(raw);if(!repo)return c.json({ok:false,stage:'list',error:'INVALID',detail:'Repo must look like owner/name.'},400);return c.json(await scanDeployerBranches(githubApiFetch(pickGithubToken(process.env.GH_BACKUP_TOKEN,await getState('settings',{}).catch(()=>({}))),runtimeVersion()),runtimeVersion(),repo))});
app.get('/api/branch-files',async c=>{const r=await listBranchBackupFiles(githubApiFetch(pickGithubToken(process.env.GH_BACKUP_TOKEN,await getState('settings',{}).catch(()=>({})))),c.req.query('repo')??DEFAULT_REPO,c.req.query('branch'),c.req.query('path'));return c.json(r,!r.ok&&r.stage==='params'?400:200)});
app.get('/api/branch-file',async c=>{const fetcher=githubApiFetch(pickGithubToken(process.env.GH_BACKUP_TOKEN,await getState('settings',{}).catch(()=>({})))),repo=c.req.query('repo')??DEFAULT_REPO,branch=c.req.query('branch'),path=String(c.req.query('path')||'');const r=path.toLowerCase().endsWith('.json')||(path.split('/').pop()||'').includes('.')?await fetchBranchBackupFile(fetcher,repo,branch,path):await fetchBranchBackupSplit(fetcher,repo,branch,path);return c.json(r,!r.ok&&r.stage==='params'?400:200)});
async function nodeSnapshotDatabase(): Promise<SplitDatabaseInput> {
  const snap = await snapshotSqliteDatabase().catch((): { skipped: string } => ({ skipped: 'unavailable' }));
  return 'b64' in snap ? { b64: snap.b64 } : { skipped: snap.skipped };
}
const BRANCH_PUSH_AUTH_ERROR='Push needs a GitHub token with contents:write on this repo: save one in the branch tab or set GH_BACKUP_TOKEN on the server.';
app.post('/api/branch-push',async c=>{const b:any=await c.req.json().catch(()=>({}));const token=pickGithubToken(process.env.GH_BACKUP_TOKEN,await getState('settings',{}).catch(()=>({})));if(c.req.query('live')==='1'){const enc=new TextEncoder(),send=(obj:unknown)=>enc.encode(JSON.stringify(obj)+'\n');const auth=!token?{ok:false,stage:'auth',error:BRANCH_PUSH_AUTH_ERROR}:null;const stream=new ReadableStream<Uint8Array>({async start(controller){try{if(auth){controller.enqueue(send(auth));return}const r=await pushBranchBackupSplit(githubApiFetch(token),githubApiPut(token),{repoRaw:b?.repo,branchRaw:b?.branch,folderRaw:b?.path,nameRaw:b?.name,bundle:b?.bundle,database:await nodeSnapshotDatabase()},(stage,info)=>controller.enqueue(send(stage==='reading'?{stage}:{stage,bytes:info?.bytes||0})));controller.enqueue(send(r))}catch(error){controller.enqueue(send({ok:false,stage:'push',error:error instanceof Error?error.message:String(error)}))}finally{controller.close()}}});return new Response(stream,{headers:{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-cache'}})}if(!token)return c.json({ok:false,stage:'auth',error:BRANCH_PUSH_AUTH_ERROR},400);const r=await pushBranchBackupSplit(githubApiFetch(token),githubApiPut(token),{repoRaw:b?.repo,branchRaw:b?.branch,folderRaw:b?.path,nameRaw:b?.name,bundle:b?.bundle,database:await nodeSnapshotDatabase()});return c.json(r,!r.ok&&r.stage==='params'?400:200)});
app.get('/api/branch-push-status',async c=>c.json({ok:true,last:await getState<any>('branch_push_last',null)}));
app.post('/api/deployer/install-branch',async c=>{const b:any=await c.req.json().catch(()=>({}));const name=normalizeInstallBranch(b?.branch);if(!name)return c.json({ok:false,error:'Invalid branch name.'},400);if(process.env.DEPLOYER_MANAGED!=='true')return c.json({ok:false,code:'NO_DEPLOYER',error:'No local deployer manages this scraper.'});const token=process.env.DEPLOYER_UI_TOKEN||'',port=Number(process.env.DEPLOYER_UI_PORT);if(!token||!Number.isInteger(port)||port<1||port>65535)return c.json({ok:false,code:'NO_DEPLOYER',error:'The deployer did not share its control token with this scraper; stop it and press Build & start again.'});const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10*60*1000);try{const r=await fetch(`http://127.0.0.1:${port}/api/branches/install`,{method:'POST',headers:{'content-type':'application/json','x-local-deployer-token':token},body:JSON.stringify({branch:name}),signal:controller.signal});const data:any=await r.json().catch(()=>null);if(!data||typeof data!=='object')return c.json({ok:false,error:'The deployer answered unreadably.'});return c.json(data,r.status)}catch{return c.json({ok:false,code:'DEPLOYER_DOWN',error:'The local deployer is not reachable.'})}finally{clearTimeout(timer)}});
// --- Local deployer proxy --------------------------------------------------------------
// The dashboard's «دیپلویر» section drives the separate deployer process. The browser must not
// learn that process's token, and this server must not become an open proxy, so only the fixed
// actions below are forwarded — the request never contributes a path, only an allowlist key.
// The port and token come from the handshake file the deployer writes when it binds (its port can
// move when 8790 is busy), or from DEPLOYER_URL / DEPLOYER_UI_TOKEN for someone running it
// elsewhere.
const DEPLOYER_LOCAL_CALLS = {
  status: { method: 'GET', path: '/api/status' },
  branches: { method: 'GET', path: '/api/branches' },
  jobs: { method: 'GET', path: '/api/jobs' },
  logs: { method: 'GET', path: '/api/scraper/logs' },
  libraries: { method: 'GET', path: '/api/libraries' },
  pyStatus: { method: 'GET', path: '/api/py/status' },
  notifications: { method: 'GET', path: '/api/notifications' },
  scan: { method: 'POST', path: '/api/branches/scan' },
  install: { method: 'POST', path: '/api/branches/install', branch: true },
  update: { method: 'POST', path: '/api/update' },
  job: { method: 'POST', path: '/api/job', jobAction: true },
  scraperStart: { method: 'POST', path: '/api/scraper/start' },
  scraperStop: { method: 'POST', path: '/api/scraper/stop' },
  scraperRestart: { method: 'POST', path: '/api/scraper/restart' },
  notifyTest: { method: 'POST', path: '/api/notifications/test' },
  notifyScan: { method: 'POST', path: '/api/notifications/scan' }
};
const DEPLOYER_LOCAL_JOB_ACTIONS = new Set(['install', 'test', 'build', 'localBuild', 'databaseInstall']);
/* normalizeInstallBranch() only knows GitHub ref syntax, so `../../../etc` and `-x` survive it.
 * This route is a localhost endpoint anyone on the machine can reach and its value ends up in a git
 * argv, so refuse traversal, option-looking names and anything with a path separator surprise. */
const DEPLOYER_LOCAL_BRANCH_SAFE = /^[\w][\w.\/\-]*$/;
function deployerLocalBranchSafe(value) {
  const name = normalizeInstallBranch(value);
  if (!name || name.startsWith('-') || name.includes('..') || !DEPLOYER_LOCAL_BRANCH_SAFE.test(name)) return null;
  return name;
}
function deployerLocalHandshake(): { base: string; token: string; source: string } {
  /* A deployer-managed install already receives DEPLOYER_UI_TOKEN + DEPLOYER_UI_PORT as env vars
   * (see /api/deployer/install-branch below), so honour that pair first: a manual
   * `npm run deployer:ui` and a deployer-installed scraper then behave identically here. */
  const envToken = String(process.env.DEPLOYER_UI_TOKEN || '').trim();
  const envPort = Number(process.env.DEPLOYER_UI_PORT);
  if (envToken && Number.isInteger(envPort) && envPort > 0 && envPort <= 65535) {
    return { base: `http://127.0.0.1:${envPort}`, token: envToken, source: 'DEPLOYER_UI_PORT' };
  }
  const explicit = String(process.env.DEPLOYER_URL || process.env.LOCAL_DEPLOYER_URL || '').trim().replace(/\/+$/, '');
  const tokenEnv = String(process.env.DEPLOYER_UI_TOKEN || '').trim();
  if (explicit) return { base: explicit, token: tokenEnv, source: 'DEPLOYER_URL' };
  try {
    const raw = JSON.parse(readFileSync(new URL('../data/.deployer-token', import.meta.url), 'utf8'));
    const port = Number(raw && raw.port) || 8790;
    return { base: `http://127.0.0.1:${port}`, token: tokenEnv || String((raw && raw.token) || ''), source: 'data/.deployer-token' };
  } catch {
    return { base: 'http://127.0.0.1:8790', token: tokenEnv, source: 'default' };
  }
}
async function deployerLocalUnavailable(detail: string) {
  const { base, source } = deployerLocalHandshake();
  return {
    ok: false,
    code: 'DEPLOYER_UNREACHABLE',
    error: 'دیپلویر محلی روی این دستگاه پاسخ نمی‌دهد (' + detail + ').',
    hint: 'روی همین ماشین «npm run deployer:ui» را اجرا کنید؛ آدرسی که امتحان شد ' + base + ' (از ' + source + ').',
    tried: base,
    source
  };
}

app.on(['GET', 'POST'], '/api/deployer/local/:action', async c => {
  const name = String(c.req.param('action') || '');
  const call = (DEPLOYER_LOCAL_CALLS as any)[name];
  if (!call) return c.json({ ok: false, code: 'UNKNOWN_ACTION', error: 'این فرمان در فهرست مجاز دیپلویر نیست.' }, 400);
  const { base, token, source } = deployerLocalHandshake();
  let payload: any = {};
  if (c.req.method === 'POST') {
    payload = await c.req.json().catch(() => ({})) as any;
    if (call.branch) {
      const branch = deployerLocalBranchSafe(payload?.branch);
      if (!branch) return c.json({ ok: false, error: 'نام برنچ معتبر نیست.' }, 400);
      payload = { branch };
    } else if (call.jobAction) {
      const action = String(payload?.action || '');
      if (!DEPLOYER_LOCAL_JOB_ACTIONS.has(action)) return c.json({ ok: false, error: 'اجرای هر فرمانی از این‌جا مجاز نیست.', allowed: [...DEPLOYER_LOCAL_JOB_ACTIONS] }, 400);
      payload = { action };
    } else {
      payload = {};
    }
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
  try {
    const response = await fetch(base + call.path, {
      method: call.method,
      headers: { 'content-type': 'application/json', 'x-local-deployer-token': token },
      body: call.method === 'POST' ? JSON.stringify(payload) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let data: any;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text.slice(0, 300) || ('HTTP ' + response.status) }; }
    if (response.status === 401) {
      return c.json({ ok: false, code: 'DEPLOYER_TOKEN', error: 'توکن دیپلویر محلی با این سرور هم‌خوان نیست.', hint: 'DEPLOYER_UI_TOKEN را برای هر دو طرف یکسان بگذارید یا فایل data/.deployer-token را پاک کنید و دیپلویر را دوباره اجرا کنید.' }, 401);
    }
    return c.json({ ...data, deployer: { base, source: token ? source : 'unsigned' } }, response.ok ? 200 : 502);
  } catch (error) {
    return c.json(await deployerLocalUnavailable(timedOut ? 'بی‌پاسخ ماند (۲۰ ثانیه)' : String((error as Error)?.message || error).slice(0, 160)), 503);
  } finally {
    clearTimeout(timer);
  }
});

app.get('/api/github/token-status', async c => { const settings = await getState<any>('settings', {}); const env = String(process.env.GH_BACKUP_TOKEN || '').trim(), stored = typeof settings?.githubBackupToken === 'string' ? settings.githubBackupToken.trim() : ''; const active = env || stored; return c.json({ ok: true, active: env ? 'env' : stored ? 'stored' : null, env: Boolean(env), stored: Boolean(stored), hint: active ? active.slice(-4) : null }); });
app.get('/api/runtime/libraries', c => c.json(nodeLibraryProbe()));
app.get('/api/libraries', c => c.json(nodeLibraryProbe()));
app.get('/api/activity', async c => {
 const [profiles,jobs,active,ai,category,dedup,operations,priorities,runPriorities]=await Promise.all([listProfiles(),listJobs(Math.min(30,Number(c.req.query('limit'))||15)),listActiveJobs(),getCurrentAiRun(),getPublicCategoryRun(),getPublicDedupRun(),listLiveActivities(),getJobPriorities(),getRunPriorities()]);
 active.sort((a,b)=>a.status!==b.status?(a.status==='queued'?-1:1):(Number(priorities[b.id])||0)-(Number(priorities[a.id])||0)||a.createdAt.localeCompare(b.createdAt));
 const runs=[ai&&{...ai,kind:'ai-test',name:'تست مدل‌های هوش مصنوعی'},category&&{...category,kind:'category-all',name:'دسته‌بندی باسلام'},dedup&&{...dedup,kind:'dedup',name:'حذف تکراری‌های مقصد'}].filter(Boolean).map((r:any)=>({id:r.id,kind:r.kind,name:r.name,status:r.status,phase:r.phase,scope:'server',progress:r.total?Math.min(100,Math.round(Number(r.processed??r.cursor??0)/r.total*100)):null,detail:r.total?`${r.processed??r.cursor??0}/${r.total}`:'',updatedAt:r.updatedAt}));
 runs.sort((a,b)=>a.status!==b.status?(a.status==='queued'?-1:1):(Number(runPriorities[b.kind])||0)-(Number(runPriorities[a.kind])||0));runs.push(...operations);
 return c.json({ok:true,ts:new Date().toISOString(),queue:true,version:runtimeVersion(),counts:{profiles:profiles.length,jobs:jobs.length,active:active.length,runningRuns:runs.filter(r=>['queued','running'].includes(r.status)).length},activeJobs:active.map(j=>({...j,extraction:extractionDetails(j),profileName:profiles.find(p=>p.id===j.profileId)?.name||j.profileId,log:undefined,progress:j.total?Math.min(100,Math.round(j.processed/j.total*100)):null,detail:`${j.processed}/${j.total}`})),runs,lastJobs:jobs.filter(j=>!['queued','running'].includes(j.status)).slice(0,8).map(j=>({id:j.id,kind:j.kind,status:j.status,phase:j.phase,at:j.updatedAt})),quota:{writeExceeded:false}});
});

// Runtime parity: the real per-model chat list. The dashboard's chat picker reads
// d.models, so the old hardcoded `models: []` left the dropdown empty on every
// Node runtime (Termux / VPS / Render / local). Shape mirrors worker-src/app.ts.
app.get('/api/ai/chat-models', async c => { try {
  const providers=(await aiProviders()).filter(p=>p.enabled!==false),toolIds=new Set(AGENT_TOOL_MODELS.filter(m=>m.id!=='*configured').map(m=>m.id)),models:any[]=[];
  for(const p of providers)for(const model of p.models||[])models.push({providerId:p.id,providerName:p.name,model,chat:isChatCompatibleAiModel(p,model),toolCalling:toolIds.has(model),reasoning:isReasoningAiModel(p,model),keyCount:Math.max(1,providerKeys(p).length)});
  models.sort((a,b)=>String(a.providerName).localeCompare(String(b.providerName))||a.model.localeCompare(b.model));
  return c.json({ok:true,providers,models});
} catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)} });
app.get('/api/ai/test-results', async c => { const stored = await getState<any>('ai_test_results', null), rows = Array.isArray(stored?.results) ? stored.results : []; return c.json({ ok: true, at: stored?.at || stored?.updatedAt || null, prompt: stored?.prompt || '', categoryTitle: stored?.categoryTitle || '', total: rows.length, results: rows, leaderboard: await getLeaderboard() }); });
app.get('/api/ai/test-runs/current', async c => c.json({ ok: true, run: await getCurrentAiRun() }));
app.post('/api/ai/test-runs', async c => { const body = await c.req.json().catch(() => ({})) as any; const { run, existing } = await startAiTestRun(body); return c.json({ ok: true, run, existing, results: run.result.results }); });
app.post('/api/ai/test-runs/control', async c => { const body = await c.req.json().catch(() => ({})) as any; const run = await controlAiTestRun(String(body.action || '')); return c.json({ ok: true, status: run?.status || 'idle', run }); });
app.post('/api/ai/test-runs/reset', async c => { await resetAiTestRun(); return c.json({ ok: true }); });
app.post('/api/ai/test-runs/retry', async c => { try { const body = await c.req.json().catch(() => ({})) as any, part = String(body.part) === 'category' ? 'category' : 'message'; return c.json({ ok: true, part, ...await retryAiTestPart(String(body.key || ''), part) }); } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); } });
app.post('/api/ai/chat', async c => { try { const body = await c.req.json().catch(() => ({})) as any, provider = (await aiProviders()).find(p => p.id === String(body.providerId || body.provider || '')); if (!provider) return c.json({ ok: false, error: 'ارائه‌دهنده پیدا نشد.' }, 404); const model = String(body.model || '').trim(); if (!model) return c.json({ ok: false, error: 'نام مدل لازم است.' }, 400); const { model: cleanModel, keyIndex } = parseModelKeySuffix(model); const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-40).map((m: any) => ({ role: String(m.role || 'user'), content: String(m.content ?? '') })).filter((m: any) => m.content); if (!messages.length || messages[messages.length - 1].role !== 'user') return c.json({ ok: false, error: 'آخرین پیام باید از سمت کاربر باشد.' }, 400); return c.json({ ...(await aiChatWithMessages(providerWithKey(provider, keyIndex), cleanModel, messages, 1200)), keyIndex }); } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400); } });
app.get('/api/agent/templates', c => c.json({ ok: true, templates: [] }));
app.get('/api/agent/tools', async c => { const { AGENT_TOOLS } = await import('../worker-src/agent.js'); return c.json({ ok: true, tools: AGENT_TOOLS }); });
app.get('/api/agent/tasks', async c => { const { AGENT_TOOLS } = await import('../worker-src/agent.js'); return c.json({ ok: true, tools: AGENT_TOOLS }); });
app.get('/api/ai/workers-catalog', async c => { const catalog = await import('../worker-src/workers-ai-catalog.js'); return c.json({ ok: true, groups: catalog.workersAiTaskGroups(), total: catalog.WORKERS_AI_MODELS.length }); });
app.get('/api/agent/models', c => c.json({ ok: true, models: [] }));
app.get('/api/agent/prompts', c => c.json({ ok: true, prompts: [] }));
app.post('/api/agent/prompts', c => c.json({ ok: false, error: 'Agent prompts are only available on Cloudflare Worker runtime.' }, 501));
app.delete('/api/agent/prompts/:id', c => c.json({ ok: true }));
app.get('/api/agent/runs', c => c.json({ ok: true, runs: [] }));
app.get('/api/agent/runs/current', c => c.json({ ok: true, run: null }));
app.post('/api/agent/runs', c => c.json({ ok: false, error: 'Agent runs are only available on Cloudflare Worker runtime.' }, 501));
app.post('/api/agent/runs/control', c => c.json({ ok: true, status: 'noop' }));
app.post('/api/agent/runs/reset', c => c.json({ ok: true }));

app.get('/api/selftest',async c=>c.json(await runSelftest()));
app.get('/api/debug',async c=>c.json(await runDiagnostics()));
app.get('/api/ai/diagnose',async c=>c.json(await aiConnectionDiagnostic()));
const nodeUnsupported = (feature: string) => ({ ok: false, unsupported: true, runtime: 'node',
  error: feature + ' روی این محیط (اجرای محلی/نود) پیاده‌سازی نشده و فقط روی Cloudflare Worker کار می‌کند.',
  recommendations: ['برای این قابلیت از نسخهٔ Cloudflare استفاده کنید.', 'بقیهٔ بخش‌های مدیریت مقصد در همین محیط کار می‌کنند.'] });
// Runtime parity: server-side bulk Basalam category runs. These routes existed only
// in the Cloudflare Worker, so the dashboard's category buttons were dead on
// Termux / VPS / Render installs. Shapes mirror worker-src/app.ts exactly.
app.get('/api/destination/basalam/category-runs/current',async c=>{try{await recoverCategoryRun();return c.json({ok:true,run:await getPublicCategoryRun()})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.post('/api/destination/basalam/category-runs',async c=>{try{const b=await c.req.json().catch(()=>({}))as any,started=await startCategoryRun(b);return c.json({ok:true,...started},started.existing?200:202)}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.post('/api/destination/basalam/category-runs/control',async c=>{try{const b=await c.req.json().catch(()=>({}))as any;return c.json({ok:true,run:await controlCategoryRun(String(b.action)==='resume'?'resume':'stop')})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.post('/api/destination/basalam/category-runs/reset',async c=>{try{await resetCategoryRun();return c.json({ok:true,run:await getPublicCategoryRun()})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.get('/api/category-fix-status',async c=>{try{return c.json({ok:true,last:await getState<any>(CATEGORY_FIX_LAST_KEY,null)})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.post('/api/destination/basalam/category/suggest',async c=>{try{const b=await c.req.json().catch(()=>({}))as any,title=String(b.title||'').trim(),mode=String(b.mode||'learned');if(!title)return c.json({ok:false,error:'عنوان محصول خالی است.'},400);if(mode==='learned')return c.json({ok:true,mode,result:await findLearnedCategory(title,Number(b.maxWords)||5)});if(mode!=='ai')return c.json({ok:false,error:'روش پیشنهاد دسته‌بندی نامعتبر است.'},400);const categories=(await destinationCategories(Boolean(b.refreshCategories))).items,result=await suggestCategoryWithModel(title,String(b.modelKey||''),categories);return c.json({mode,categories:categories.length,...result})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.get('/api/destination/basalam/category-tried',async c=>{try{const shopId=String(c.req.query('shopId')||''),id=Number(c.req.query('id'));return c.json({ok:true,tried:await getTriedBasalamCategories(shopId,id)})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.post('/api/destination/basalam/category-tried',async c=>{try{const b=await c.req.json().catch(()=>({}))as any;return c.json({ok:true,tried:await markBasalamCategoriesTried(String(b.shopId||''),Number(b.id),Array.isArray(b.ids)?b.ids:[])})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.post('/api/import/analyze', c => c.json(nodeUnsupported('تحلیل فایل ورودی'), 501));
app.post('/api/ai/diagnose',async c=>c.json(await aiConnectionDiagnostic()));
// --- AI description generator -------------------------------------------
// Always-on by default: it fills descriptions/variations that the source page
// did not provide, using the pinned master model.
app.get('/api/ai/description-settings',async c=>{
  const settings=await getState<any>('ai_description_settings',{enabled:true});
  const picked=await preferredAiChatModel();
  const last=await getState<any>(AI_ENRICH_LAST_KEY,null);
  return c.json({ok:true,settings:{enabled:settings?.enabled!==false},master:picked?{provider:picked.provider.id,model:picked.model}:null,last});
});
app.post('/api/ai/description-settings',async c=>{
  const body=await c.req.json().catch(()=>({}))as any;
  const enabled=body.enabled!==false&&body.enabled!=='false';
  await setState('ai_description_settings',{enabled});
  return c.json({ok:true,settings:{enabled}});
});
app.post('/api/profiles/:id/ai-descriptions',async c=>{
  const profile=await getProfile(c.req.param('id'));
  if(!profile)return c.json({ok:false,error:'پروفایل پیدا نشد.'},404);
  const body=await c.req.json().catch(()=>({}))as any;
  const force=body.force===true||body.force==='true';
  const limit=Math.max(1,Math.min(200,Number(body.limit)||25));
  const picked=await preferredAiChatModel();
  if(!picked)return c.json({ok:false,error:'هیچ مدل هوش مصنوعی فعالی پیدا نشد. ابتدا یک ارائه‌دهنده و مدل مستر تنظیم کنید.'},400);
  const stored=(await listProducts(profile.id,1000,0,'')).products||[];
  const targets=stored.filter((row:any)=>force||productNeedsEnrichment(row.data||row).any||productNeedsBasalamCategory(row.data||row)).slice(0,limit);
  let enrichCategories:any[]=[];try{enrichCategories=(await destinationCategories()).items}catch{}
  let filled=0;const failures:any[]=[];
  for(const row of targets){
    const product=(row as any).data||row;
    const result=await generateProductDescription(product,{force,categories:enrichCategories,profileCategoryId:profile.basalamCategoryId});
    if(result.changed){await upsertProduct(profile.id,product);filled++}
    else if(!result.ok)failures.push({title:product.title,error:result.error});
  }
  return c.json({ok:true,profileId:profile.id,model:picked.model,provider:picked.provider.id,
    candidates:targets.length,filled,failed:failures.length,failures:failures.slice(0,5)});
});
app.get('/api/import/history',async c=>c.json({ok:true,items:await getImportHistory()}));
app.post('/api/import/history/clear',async c=>{await clearImportHistory();return c.json({ok:true})});
app.post('/api/jobs/priority',async c=>{const b=await c.req.json().catch(()=>({}))as any,ids=Array.isArray(b.ids)?b.ids.map(String):[];if(!ids.length)return c.json({ok:false,error:'هیچ کاری برای اولویت‌بندی ارسال نشد.'},400);const valid:string[]=[];for(const id of ids){const job=await getJob(id);if(job&&job.status==='queued')valid.push(id)}
  // An empty result (every dragged job already started) must never wipe the saved order.
  if(!valid.length)return c.json({ok:true,count:0,priorities:await getJobPriorities()});return c.json({ok:true,count:valid.length,priorities:await setJobPriorities(valid)})});
app.post('/api/runs/priority',async c=>{const b=await c.req.json().catch(()=>({}))as any,kinds=Array.isArray(b.kinds)?b.kinds.map(String):[];if(!kinds.length)return c.json({ok:false,error:'هیچ اجرایی برای اولویت‌بندی ارسال نشد.'},400);const known=new Set(['ai-test','category-all','dedup','agent']),valid=kinds.filter((kind:string)=>known.has(kind));if(!valid.length)return c.json({ok:true,count:0,priorities:await getRunPriorities()});return c.json({ok:true,count:valid.length,priorities:await setRunPriorities(valid)})});
app.post('/api/category-learning/import',async c=>c.json({ok:true,imported:await importCategoryLearning(await c.req.json())}));
app.post('/api/suggest-selectors',async c=>{const b=await c.req.json().catch(()=>({}))as any,mode=['list','detail'].includes(b.mode)?b.mode:'all';return c.json({ok:true,...await suggestSelectors(String(b.url||''),mode)})});
app.post('/api/profiles/:id/extraction-diagnostic',async c=>{const profile=await getProfile(c.req.param('id'));if(!profile)return c.json({ok:false,error:'پروفایل پیدا نشد.'},404);const b=await c.req.json().catch(()=>({}))as any;const run=async(onProgress?:DiagnosticObserver)=>{const report:any=await diagnoseExtraction(profile,String(b.url||''),onProgress);const toSave=report.selectorsToSave||{},keys=Object.keys(toSave).filter(key=>String(toSave[key]||'').trim());if(keys.length){onProgress?.({name:'selectors-auto-saved',status:'running',summary:'در حال ذخیرهٔ سلکتورهای پیدا‌شده در پروفایل…',count:keys.length});const selectors={...profile.selectors}as any;for(const key of keys)selectors[key]=toSave[key];await saveProfile({...profile,selectors,updatedAt:new Date().toISOString()});report.selectorsSaved=Object.fromEntries(keys.map(key=>[key,toSave[key]]));report.stages.push({name:'selectors-auto-saved',ok:true,summary:'سلکتورهای پیداشده به‌صورت خودکار در تب سلکتورها ذخیره شدند.',selectors:report.selectorsSaved});onProgress?.({...report.stages[report.stages.length-1],status:'success'})}else onProgress?.({name:'selectors-auto-saved',status:'skipped',summary:'سلکتور تازه‌ای برای ذخیره وجود ندارد.'});return report};if(c.req.query('live')==='1')return diagnosticStream(run);return c.json(await run())});
app.get('/api/parity',c=>c.json({ok:true,total:PHP_MENU_CAPABILITIES.length,capabilities:PHP_MENU_CAPABILITIES}));
app.get('/api/connections', async c => c.json({ok:true,connections:await loadConnections(true)}));
app.get('/api/quota', async c => c.json({ok:true,d1:null,unlimited:true,note:'این محیط از پایگاه‌دادهٔ محلی استفاده می‌کند و سقف روزانهٔ D1 روی آن اعمال نمی‌شود.'}));
app.post('/api/connections', async c => {
  const body=await c.req.json().catch(()=>null);
  if(!body||typeof body!=='object')return c.json({ok:false,error:'بدنهٔ درخواست باید JSON معتبر باشد.'},400);
  return c.json({ok:true,...await saveConnectionsAndReprice(body,wooRepriceIO())});
});
app.get('/api/ai/providers',async c=>c.json({ok:true,providers:await aiProviders(),leaderboard:await getLeaderboard()}));
app.post('/api/ai/test-all',async c=>{const body=await c.req.json().catch(()=>({})) as any;return c.json({ok:true,results:await testAllModels(String(body.prompt||'Reply with exactly: SCRAPER4_OK'),Boolean(body.onlyCandidates))})});
app.post('/api/ai/call',async c=>{const body=await c.req.json() as any,providers=await aiProviders(),provider=providers.find(p=>p.id===body.provider);if(!provider)return c.json({ok:false,error:'Provider not found'},404);return c.json(await aiCall(provider,String(body.model||''),String(body.prompt||'Reply with exactly: SCRAPER4_OK')))});
app.post('/api/ai/vote',async c=>{const body=await c.req.json() as any;return c.json({ok:true,leaderboard:await recordVote(String(body.task||'manual'),String(body.winner||''),Array.isArray(body.candidates)?body.candidates.map(String):[])})});
app.get('/api/ai/leaderboard',async c=>c.json({ok:true,leaderboard:await getLeaderboard()}));
app.post('/api/notifications/test',async c=>{const body=await c.req.json() as any;return c.json(await sendNotification(body.channel||'webhook',String(body.text||'پیام آزمایشی اسکرپر ۴')))});
app.get('/api/category-learning',async c=>c.json({ok:true,items:await listCategoryLearning(Math.min(5000,Number(c.req.query('limit'))||1000))}));
app.post('/api/category-learning/record',async c=>{const b=await c.req.json() as any;return c.json({ok:true,saved:await learnCategory(String(b.title||''),Number(b.categoryId),String(b.categoryName||''),Number(b.maxWords)||5)})});
app.post('/api/category-learning/test',async c=>{const b=await c.req.json() as any;return c.json({ok:true,result:await findLearnedCategory(String(b.title||''),Number(b.maxWords)||5)})});
app.post('/api/autoreply/test',async c=>{const b=await c.req.json() as any;return c.json({ok:true,result:await generateReply(String(b.text||''))})});
app.post('/api/autoreply/run',async c=>{const b=await c.req.json().catch(()=>({})) as any;return c.json(await autoreplyRun(b.confirm!=='APPLY'))});
app.get('/api/autoreply/log',async c=>c.json({ok:true,items:await autoreplyLogs()}));
app.post('/api/digest',async c=>{const b=await c.req.json().catch(()=>({})) as any;return c.json(await digest(b.confirm!=='SEND'))});
app.get('/api/basalam/chats',async c=>c.json({ok:true,items:await basalamChats(Number(c.req.query('limit'))||20)}));
app.get('/api/basalam/orders',async c=>c.json({ok:true,items:await basalamOrders(Number(c.req.query('limit'))||20)}));
app.get('/api/settings', async c => c.json({ ok:true, settings: await getState('settings', {}) }));
app.post('/api/settings', async c => { const settings=await c.req.json(); await setState('settings',settings); return c.json({ok:true}); });
app.get('/api/backup', async c => c.json(await createBackup(), 200, { 'content-disposition': `attachment; filename="scraper4-backup-${Date.now()}.json"` }));
app.post('/api/restore', async c => c.json({ok:true,result:await restoreBackup(await c.req.json())}));
app.get('/api/settings-export', async c => {
  const bundle=await createPhpSettingsBundle(new URL(c.req.url).host),stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,15);
  return c.json(bundle,200,{'content-disposition':`attachment; filename="settings_${stamp}.json"`});
});
// Shared by the manual import route and the fresh-database bootstrap restore.
async function importSettingsBundle(bundle: unknown): Promise<Record<string, unknown>> {
  const files=decodePhpSettingsBundle(bundle);let profiles=0,products=0,states=0,categories=0,autoreplyLogs=0,connections=false;const warnings:string[]=[];
  const rawProfiles=files['profiles.json'],rawProfileProducts=files['profile_products.json'] as Record<string,unknown>|undefined;
  if(rawProfiles&&typeof rawProfiles==='object')for(const [id,raw] of Object.entries(rawProfiles as Record<string,any>)){
    try{const profile=normalizeProfile({...raw,id});await saveProfile(profile);profiles++;for(const product of legacyProducts(rawProfileProducts?.[id]??raw?.products)){await upsertProduct(profile.id,product);products++;}}
    catch(error){warnings.push(`${id}: ${error instanceof Error?error.message:String(error)}`)}
  }
  const rawConnections=files['connections.json'] as any;
  if(rawConnections){const partialConn:any={};const woo=rawConnections.woocommerce||rawConnections.woo;if(woo)partialConn.woo={url:woo.url||woo.store_url||'',key:woo.consumer_key||woo.ck||woo.key||'',secret:woo.consumer_secret||woo.cs||woo.secret||'',categoryId:woo.category_id||0};const basalam=rawConnections.basalam;if(basalam)partialConn.basalam={token:basalam.token||'',vendorId:String(basalam.vendor_id||basalam.vendorId||''),api:basalam.api_base||basalam.api||'https://openapi.basalam.com/v1',preparationDays:basalam.preparation_days,weight:basalam.weight,packageWeight:basalam.package_weight,stock:basalam.stock,categoryId:basalam.category_id,autoCategory:basalam.auto_category,netIndirect:basalam.net_indirect,shops:basalam.shops};if(rawConnections.ai||rawConnections.src_network){const ai=rawConnections.ai||{};partialConn.ai={baseUrl:ai.base_url||ai.baseUrl||'',apiKey:ai.api_key||ai.apiKey||'',model:ai.model||'',providers:ai.providers,candidates:ai.candidates,master:ai.master,network:ai.network||(rawConnections.src_network?{mode:rawConnections.src_network.mode,proxyUrl:rawConnections.src_network.proxy||'',workerUrl:rawConnections.src_network.worker_url||'',dohUrl:rawConnections.src_network.doh_url||'',resolveIp:rawConnections.src_network.resolve_ip||''}:undefined)}};if(rawConnections.notifications)partialConn.notifications=rawConnections.notifications;if(Object.keys(partialConn).length){await saveConnections(partialConn);connections=true;}}
  if(files['category_learning.json'])categories=await importCategoryLearning(files['category_learning.json']);
  if(files['autoreply_log.json'])autoreplyLogs=await importAutoreplyLog(files['autoreply_log.json']);
  for(const [file,value] of Object.entries(files)){const key=stateKeyForFile(file);if(key){await setState(key,value);states++;}}
  return ({ok:true,format:'scraper4-php-compatible',imported:{profiles,products,states,categories,autoreplyLogs,connections},warnings});
}
app.post('/api/settings-import', async c => c.json(await importSettingsBundle(await c.req.json())));
app.get('/api/bootstrap/status', async c => {
  const env = process.env as unknown as Record<string, string>, decision = shouldAutoRestoreBootstrap(env);
  let path: string | null = null;
  for (const candidate of bootstrapCandidates(env, process.cwd())) { try { if (existsSync(candidate)) { path = candidate; break; } } catch { /* unreadable */ } }
  let fresh = true, marker: unknown = null;
  try { if (databaseReady) { fresh = await isFreshDatabase(); marker = await getState(BOOTSTRAP_MARKER_KEY, null); } } catch { /* report what we have */ }
  return c.json({ ok: true, supported: true, enabled: decision.enabled, reason: decision.reason, path, fileFound: Boolean(path), databaseReady, fresh, lastRestored: marker, lastError: bootstrapLastError });
});
app.get('/api/profile-stats', async c => c.json({ok:true,items:await profileStats()}));
app.post('/api/maintenance/recon/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json().catch(()=>({})) as any;return c.json({ok:true,report:await recon(target as any,String(body.profileId||''))})});
// Unified reconciliation: every profile against WooCommerce and every Basalam
// stall at once, with prices compared after each destination's own adjustment.
app.get('/api/maintenance/recon-accounts',async c=>c.json({ok:true,accounts:await reconAccounts()}));
app.post('/api/maintenance/ledger/products',async c=>{const b=await c.req.json().catch(()=>({})) as any;return c.json(await destinationLedgerProducts(String(b.target||'woo'),String(b.accountKey||'default'),Number(b.offset)||0))});
app.get('/api/maintenance/ledger',async c=>c.json(await destinationLedgerStatus()));
app.post('/api/maintenance/ledger/refresh',async c=>{const b=await c.req.json().catch(()=>({})) as any;return maintenanceResponse(c,()=>refreshDestinationLedger(b.force!==false))});
app.post('/api/maintenance/ledger/missing',async c=>{const b=await c.req.json().catch(()=>({})) as any;return maintenanceResponse(c,()=>ledgerMissing(String(b.profileId||''),b.confirm==='APPLY'))});
app.post('/api/maintenance/recon-unified',async c=>{const b=await c.req.json().catch(()=>({}))as any;return maintenanceResponse(c,()=>unifiedRecon(String(b.profileId||'')))});
app.post('/api/maintenance/recon-unified/apply',async c=>{const b=await c.req.json().catch(()=>({}))as any;return maintenanceResponse(c,()=>unifiedReconApply(String(b.profileId||''),b.confirm==='APPLY',Number(b.limit)||200))});
// Request 36b: preview (no confirm) or delete duplicates in every destination,
// keeping the most expensive copy by default.
app.post('/api/maintenance/duplicates',async c=>{const b=await c.req.json().catch(()=>({}))as any;return maintenanceResponse(c,()=>destinationDuplicates(b.confirm==='APPLY',Number(b.limit)||200,b.keep==='cheapest'?'cheapest':'expensive',String(b.accountKey||'')))});
app.post('/api/maintenance/recon-table/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json().catch(()=>({}));return c.json(await reconTable(target as 'woo'|'basalam',String(body.profileId||'')))});
app.post('/api/maintenance/rebuild/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json().catch(()=>({})) as any;return c.json(await rebuildMap(target as any,String(body.profileId||'')))});
app.post('/api/maintenance/retire/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json() as any,apply=body.confirm==='APPLY';return c.json(await retire(target as any,String(body.profileId||''),String(body.action||'report'),apply))});
app.post('/api/maintenance/bulk/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json() as any;return c.json(await bulkEdit(target as any,body,body.confirm==='APPLY'))});
app.post('/api/maintenance/photo-fix',async c=>{const body=await c.req.json() as any;return c.json(await photoFix(String(body.profileId||''),body.confirm==='APPLY'))});
app.get('/api/destination/:target/products',async c=>{try{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const legacyLimit=Math.min(100,Number(c.req.query('limit'))||25),legacyOffset=Math.max(0,Number(c.req.query('offset'))||0),perPage=Math.min(100,Number(c.req.query('per_page'))||legacyLimit),page=Math.max(1,Number(c.req.query('page'))||Math.floor(legacyOffset/perPage)+1),catalog=await destinationCatalog(target as any,{page,perPage,q:c.req.query('q')||'',status:c.req.query('status')||'all',shopId:c.req.query('shop')||'all',counts:c.req.query('counts')==='1'});const{products,...meta}=catalog;return c.json({...meta,items:products})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.get('/api/destination/:target/product/:id',async c=>{try{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);return c.json({ok:true,product:await destinationProduct(target as any,Number(c.req.param('id')),c.req.query('shop')||'')})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.post('/api/destination/:target/bulk',async c=>{try{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const b=await c.req.json().catch(()=>({}))as any;if(Array.isArray(b.ids)&&b.ids.length>20)return c.json({ok:false,error:'در هر نوبت حداکثر ۲۰ محصول قابل ویرایش است.'},400);return c.json(await destinationBulkEdit(target as any,b,b.confirm==='APPLY'))}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.post('/api/destination/:target/:id/update',async c=>{try{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const b=await c.req.json().catch(()=>({}))as any;return c.json(await destinationUpdate(target as any,Number(c.req.param('id')),b,b.confirm==='APPLY',String(b.shopId||'')))}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}});
app.get('/api/destination/:target/overview',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);return c.json({ok:true,...await destinationOverview(target as any)})});
app.get('/api/destination/:target/duplicates',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);return c.json({ok:true,groups:await findDestinationDuplicates(target as any)})});
// Request 36 / runtime parity: server-side duplicate-removal runs. These four
// routes existed only in the Cloudflare Worker, so the dashboard's duplicate
// buttons were dead on Termux / VPS / Render installs.
const dedupTarget=(value:string)=>{if(!['woo','basalam'].includes(value))throw Error('Invalid target');return value as 'woo'|'basalam'};
app.post('/api/destination/:target/dedup-runs',async c=>{
  try{const target=dedupTarget(c.req.param('target')),b=await c.req.json().catch(()=>({}))as any;
    const started=await startDedupRun(target,b);
    return c.json({ok:true,...started},started.existing?200:202);
  }catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}
});
app.get('/api/destination/:target/dedup-runs/current',async c=>{
  try{dedupTarget(c.req.param('target'));await recoverDedupRun();return c.json({ok:true,run:await getPublicDedupRun()})}
  catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}
});
app.post('/api/destination/:target/dedup-runs/control',async c=>{
  try{dedupTarget(c.req.param('target'));const b=await c.req.json().catch(()=>({}))as any;
    return c.json({ok:true,run:await controlDedupRun(String(b.action)==='resume'?'resume':'stop')});
  }catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}
});
app.post('/api/destination/:target/dedup-runs/reset',async c=>{
  try{dedupTarget(c.req.param('target'));await resetDedupRun();return c.json({ok:true,run:await getPublicDedupRun()})}
  catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}
});
app.post('/api/destination/:target/:id/status',async c=>{const target=c.req.param('target'),body=await c.req.json() as any;if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);if(body.confirm!=='APPLY')return c.json({ok:false,error:'confirm APPLY is required'},400);return c.json(await destinationChangeStatus(target as any,Number(c.req.param('id')),String(body.status||''),String(body.shopId||'')))});
app.delete('/api/destination/:target/:id',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);if(c.req.query('confirm')!=='DELETE')return c.json({ok:false,error:'confirm DELETE is required'},400);return c.json(await destinationDelete(target as any,Number(c.req.param('id')),c.req.query('force')==='true',c.req.query('shop')||''))});
app.post('/api/products/:profileId/:sourceKey/sync/:target',async c=>{const profile=await getProfile(c.req.param('profileId')),product=await getProduct(c.req.param('profileId'),c.req.param('sourceKey')),target=c.req.param('target');if(!profile||!product)return c.json({ok:false,error:'Product/profile not found'},404);if(target==='woo')return c.json({ok:true,result:await syncWoo(product,profile)});if(target==='basalam')return c.json({ok:true,result:await syncBasalam(product,profile)});return c.json({ok:false,error:'Invalid target'},400)});
app.post('/api/queue-watchdog', async c => { const body=await c.req.json().catch(()=>({})) as any,settings=await getState<any>('settings',{}),stallMin=Number(body.minutes)||Math.max(1,Math.ceil(Number(settings.watchdog?.stallAfter||300)/60)),autoContinue=body.autoContinue??settings.watchdog?.autoContinue!==false;return c.json({ok:true,autoContinue,recovered:autoContinue?await recoverFailedAndStalledJobs(stallMin):0,reaped:autoContinue?0:await reapStalledJobs(stallMin)}); });
app.post('/api/source-test', async c => { const body=await c.req.json() as any; const profile=body.profileId?await getProfile(String(body.profileId)):null; const result=await safeText(String(body.url||''),1_000_000,{indirect:Boolean(profile?.networkIndirect)}); return c.json({ok:true,bytes:Buffer.byteLength(result.text),url:result.url,route:result.route,title:(result.text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]||'').replace(/<[^>]+>/g,'').trim()}); });
app.post('/api/test-connection/:target', async c => {
  const target=c.req.param('target'),connections=await loadConnections(true);
  if(target==='woo') { const x=connections.woo;if(!x.url||!x.key||!x.secret)return c.json({ok:false,error:'تنظیمات ووکامرس کامل نیست'},400);const auth=`Basic ${Buffer.from(`${x.key}:${x.secret}`).toString('base64')}`,r=await safeFetch(x.url+'/wp-json/wc/v3/system_status',{headers:{authorization:auth,accept:'application/json'}},2_000_000);return c.json({ok:r.ok,code:r.status}); }
  if(target==='basalam'){
    // Mirror the Worker: query users/me so a single token test can also fill in
    // the vendor id, stall name and preparation days for the settings form.
    const x=connections.basalam,body=await c.req.json().catch(()=>({}))as any;
    const index=Number(body?.shopIndex),shop=Number.isInteger(index)&&index>=0?(x.shops||[])[index]:null;
    const token=shop?.token||x.token,expectedVendorId=shop?.vendorId||x.vendorId;
    if(!token)return c.json({ok:false,error:'توکن باسلام خالی است'},400);
    const endpoint=String(x.api||'').replace(/\/$/,'')+'/users/me';
    const tokenVerdict=describeBasalamToken(token);
    let r:Response;
    try{r=await safeFetch(endpoint,{headers:{authorization:`Bearer ${token}`,accept:'application/json'}},2_000_000)}
    catch(error){return c.json({ok:false,target,service:'Basalam OpenAPI',
      error:`${tokenVerdict.reason} — ${error instanceof Error?error.message:String(error)}`,
      summary:{tokenCheck:tokenVerdict.reason,tokenExpiresAt:tokenVerdict.expiresAt||null,tokenScopes:tokenVerdict.scopes||null}},200)}
    const raw=await r.json().catch(()=>({}))as any;
    const vendor=raw?.vendor||raw?.data?.vendor||{},user=raw?.data||raw||{},vendorId=String(vendor.id||user.vendor_id||'');
    const autofill:Record<string,any>={};
    if(vendorId)autofill.vendorId=vendorId;
    const vendorTitle=vendor.title||user.vendor_title||'';if(vendorTitle)autofill.name=String(vendorTitle);
    const prep=Number(vendor.preparation_days??vendor.default_preparation_days);if(Number.isFinite(prep)&&prep>0)autofill.preparationDays=prep;
    const city=vendor.city?.id??vendor.city_id;if(Number(city))autofill.cityId=Number(city);
    const identifier=vendor.identifier||vendor.slug||'';if(identifier)autofill.identifier=String(identifier);
    return c.json({ok:r.ok,code:r.status,target,service:'Basalam OpenAPI',
      http:{status:r.status,statusText:r.statusText},
      summary:{userId:user.id||null,userName:user.name||user.username||null,vendorId:vendorId||null,
        vendorTitle:vendorTitle||shop?.name||null,vendorActive:vendor.is_active??null,
        configuredVendorId:expectedVendorId||null,
        vendorIdMatches:!expectedVendorId||!vendorId?null:String(expectedVendorId)===vendorId,
        tokenCheck:tokenVerdict.reason,tokenExpiresAt:tokenVerdict.expiresAt||null,tokenScopes:tokenVerdict.scopes||null,autofill}});
  }
  if(target==='ai') { const ai=connections.ai;if(!ai.baseUrl||!ai.apiKey||!ai.model)return c.json({ok:false,error:'تنظیمات هوش مصنوعی کامل نیست'},400);const endpoint=ai.baseUrl+(ai.baseUrl.includes('/chat/completions')?'':'/chat/completions'),r=await safeFetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${ai.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:ai.model,messages:[{role:'user',content:'Reply with exactly: SCRAPER4_OK'}],max_tokens:20})},2_000_000);return c.json({ok:r.ok,code:r.status,body:await r.json().catch(()=>null)}); }
  return c.json({ok:false,error:'Unknown connection'},404);
});
app.get('/api/categories/:target',async c=>{const target=c.req.param('target'),connections=await loadConnections();if(target==='woo'){const x=connections.woo;if(!x.url||!x.key||!x.secret)return c.json({ok:false,error:'اتصال ووکامرس کامل نیست'},400);const auth=`Basic ${Buffer.from(`${x.key}:${x.secret}`).toString('base64')}`,items:any[]=[];for(let page=1;page<=20;page++){const r=await safeFetch(`${x.url}/wp-json/wc/v3/products/categories?per_page=100&page=${page}`,{headers:{authorization:auth,accept:'application/json'},apiMode:true,directRoute:true},3_000_000),rows=await r.json() as any[];if(!r.ok)return c.json({ok:false,error:`Woo HTTP ${r.status}`},502);items.push(...rows);if(rows.length<100)break}return c.json({ok:true,items})}if(target==='basalam'){try{const result=await destinationCategories(c.req.query('refresh')==='1');return c.json({ok:true,...result,total:result.items.length})}catch(error){return c.json({ok:false,error:error instanceof Error?error.message:String(error)},400)}}return c.json({ok:false,error:'Invalid target'},400)});
app.get('/api/profiles', async c => c.json({ ok: true, profiles: await listProfiles() }));
app.post('/api/profiles',async c=>{
 const input=await c.req.json() as any,existing=input.id?await getProfile(String(input.id)):null;
 if(input._autosavePatch&&!existing)return c.json({ok:false,error:'Profile no longer exists'},404);
 const patch=input._autosavePatch,merged=patch?{...existing,...patch,id:existing!.id,selectors:{...existing!.selectors,...patch.selectors},gallery:{...existing!.gallery,...patch.gallery}}:input;
 const profile=normalizeProfile(merged),before=existing;

 const saved=await saveProfile(profile);let job=null;
 if(before&&['priceMode','priceValue','roundPrice'].some(key=>String((before as any)[key]??'')!==String((saved as any)[key]??''))){
  const connections=await loadConnections(),woo=Boolean(connections.woo.url&&connections.woo.key&&connections.woo.secret),basalam=Boolean(connections.basalam.token&&connections.basalam.vendorId||connections.basalam.shops.some(s=>s.token&&s.vendorId));
  const target=woo&&basalam?'both':woo?'woo':basalam?'basalam':'none';
  if(target!=='none'){job=await createJob(saved.id,'sync',target,{priceSync:true});triggerLocalJobDrain();}
 }
 return c.json({ok:true,profile:saved,priceSyncJob:job,priceSync:job?'queued':'not-requested'});
});
app.post('/api/profiles/:id/results/apply',async c=>{
  const profile=await getProfile(c.req.param('id'));if(!profile)return c.json({ok:false,error:'Profile not found'},404);
  const body=await c.req.json().catch(()=>({})) as any;
  return c.json({ok:true,...await applyStoredResultSettings(profile,String(body.after||''),body.previousSuffix===undefined?profile.titleSuffix:String(body.previousSuffix))});
});
app.delete('/api/profiles/:id', async c => c.json({ ok: await deleteProfile(c.req.param('id')) }));
app.post('/api/profiles/:id/scrape', async c => {
  const profile = await getProfile(c.req.param('id')); if (!profile) return c.json({ ok: false, error: 'Profile not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as any; const target = validTarget(body.target || 'none');
  const job=await createJob(profile.id, 'scrape', target,{workflow:body.workflow==='list-only'?'list-only':body.workflow==='full'?'full':undefined});
  if(job.status==='queued')triggerLocalJobDrain();
  return c.json({ ok: true, job, processor:job.status==='queued'?'triggered':'existing-active', dedupProfile:true }, 202);
});
app.post('/api/profiles/:id/sync', async c => {
  const profile = await getProfile(c.req.param('id')); if (!profile) return c.json({ ok: false, error: 'Profile not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as any;
  const job=await createJob(profile.id, 'sync', validTarget(body.target || 'both'));
  if(job.status==='queued')triggerLocalJobDrain();
  return c.json({ ok: true, job, processor:job.status==='queued'?'triggered':'existing-active', dedupProfile:true }, 202);
});

// A 3-page scan that yields a single product means the engine matched a stray
// card, not the product grid; saving it as the default breaks every later run.
const MIN_BENCHMARK_PRODUCTS=2;
// Browser engines need a real Chromium. On Termux there is no Playwright
// browser download, but a system Chromium (pkg install chromium, or
// BROWSER_EXECUTABLE_PATH) runs fine -- so gate on actual availability, the
// same check pick() uses, instead of blocking the whole platform.
const BROWSER_ENGINES=new Set<ExtractionEngine>(['playwright','puppeteer','crawlee_playwright','network_api']);
const BENCHMARK_ENGINES:ExtractionEngine[]=['jsonld','next_data','script_json','heuristic','structural','metadata','cheerio','htmlrewriter','playwright','puppeteer','crawlee_playwright','network_api'];
async function benchmarkProfileEngines(profile:Profile,onProgress?:DiagnosticObserver){
  const originalProfile=structuredClone(profile);
  const emit=(event:any)=>{try{onProgress?.(event)}catch{}};
  emit({name:'benchmark-network',status:'running',summary:'دریافت صفحهٔ مبنا برای تست سه‌صفحه‌ای…'});
  const pages=3,results:any[]=[],startedAt=new Date().toISOString(),benchmarkDiscovered:Record<string,string>={};
  // 1.137.0 — one shared first-page fetch for every engine's diagnosis (signal
  // checks run on this HTML; the per-engine products come from the loop below).
  let diagHtml='',diagUrl='';
  const probe: Profile = { ...profile, url: benchmarkProbeUrl(profile) };
  try{const first=await safeText(pageUrl(probe,1),1_000_000,{indirect:Boolean(profile.networkIndirect)});diagHtml=first.text;diagUrl=first.url||pageUrl(probe,1)}catch{/* diagnosis degrades to product-only signals */}
  emit({name:'benchmark-network',status:diagHtml?'success':'error',summary:diagHtml?'صفحهٔ مبنا دریافت شد.':'دریافت صفحهٔ مبنا ناموفق بود؛ آزمون مستقل موتورها ادامه دارد.'});
  for(const engine of BENCHMARK_ENGINES){
    emit({name:engine,status:'running',summary:'شروع تست موتور '+engine,pages:3});
    const start=Date.now();let products=0,pagesScanned=0,error='',seen=new Set<string>();const engineProducts:any[]=[];let engineSelectors:any=null;let paginationReport:any=null;
    if(!browserEngineAvailable()&&BROWSER_ENGINES.has(engine)){const unavailable='مرورگری روی این دستگاه پیدا نشد؛ موتورهای مرورگر بدون آن اجرا نمی‌شوند. روی Termux دستور pkg install chromium را اجرا کنید یا BROWSER_EXECUTABLE_PATH را تنظیم کنید.';results.push({engine,ok:false,available:false,elapsedMs:0,pagesScanned:0,products:0,productsPerMinute:0,error:unavailable,diagnosis:{engine,candidates:0,extracted:0,complete:{title:0,price:0,link:0,image:0},sample:null,dropReasons:[unavailable],hint:'کرومیوم نصب کنید (pkg install chromium) یا BROWSER_EXECUTABLE_PATH را تنظیم کنید؛ تا آن زمان از htmlrewriter، cheerio یا heuristic استفاده کنید.',signals:{available:false}}});emit({name:engine,status:'skipped',summary:unavailable,result:results[results.length-1]});continue}
    paginationReport=await benchmarkPagination(probe,{pageUrl,scroll:['playwright','puppeteer'].includes(engine)?()=>benchmarkScroll(probe.url,profile.selectors,engine,Boolean(profile.networkIndirect)):undefined,
      scrape:(url,nextSelector)=>scrapeListWithMeta(url,profile.selectors,engine,undefined,false,nextSelector,true,Boolean(profile.networkIndirect)),
      emit:event=>emit({name:engine,...event}),
      onPage:(scraped,pageNo)=>{
        if(scraped.discoveredSelectors&&Object.keys(scraped.discoveredSelectors).length){profile.selectors={...profile.selectors,...scraped.discoveredSelectors};Object.assign(benchmarkDiscovered,scraped.discoveredSelectors)}
        if(pageNo===1&&scraped.selectorsUsed)engineSelectors=scraped.selectorsUsed;
      }
    });
    engineProducts.push(...paginationReport.products);products=engineProducts.length;pagesScanned=paginationReport.pagesScanned;error=paginationReport.error;
    const elapsedMs=Date.now()-start,minutes=Math.max(1/60,elapsedMs/60000);
    let diagnosis:any=null;
    try{diagnosis=await diagnoseBenchmarkEngine(engine,diagHtml,diagUrl||pageUrl(probe,1),engineSelectors||profile.selectors,engineProducts,error)}catch{diagnosis=null}
    results.push({engine,ok:products>0&&!error,available:true,elapsedMs,pagesScanned,products,pagination:{...paginationReport,products:undefined},productsPerMinute:Number((products/minutes).toFixed(2)),...(error?{error}:{}),...(diagnosis?{diagnosis}:{})});
    emit({name:engine,status:products>0&&!error?'success':'error',summary:error||('پایان تست؛ '+products+' محصول'),result:results[results.length-1]});
  }
  const usable=results.filter(r=>r.ok&&r.available);
  // Rank by coverage first. Ranking purely by products/minute let a shallow
  // engine that found a single stray card beat the selector engine that found
  // hundreds, and the winner was then saved as the profile default -- so every
  // later run extracted almost nothing.
  const best=usable.sort((a,b)=>b.products-a.products||a.elapsedMs-b.elapsedMs)[0]||null;
  const bestCount=best?best.products:0;
  // A single product from a 3-page scan is noise, not a working engine.
  const fastest=best&&bestCount>=MIN_BENCHMARK_PRODUCTS?best:null;
  emit({name:'benchmark-save',status:'running',summary:'ذخیرهٔ نتیجهٔ مقایسه و موتور منتخب…'});
  (profile as any).extractionEngineBenchmarks=results;
  if(fastest){profile.extractionEngine=fastest.engine;profile.extractionEngineMaster=undefined;profile.extractionEngineMs=fastest.elapsedMs;profile.extractionEngineHost=new URL(profile.url).hostname;}
  const profileUpdated=await saveBenchmarkProfile(originalProfile,profile,benchmarkDiscovered);
  emit({name:'benchmark-save',status:profileUpdated?'success':'error',summary:profileUpdated?'گزارش ذخیره شد؛ ویرایش‌های همزمان حفظ شدند.':'پروفایل همزمان تغییر کرد یا حذف شد؛ نتیجه روی تنظیمات جدید نوشته نشد.'});
  return{ok:Boolean(fastest),profileUpdated,profileId:profile.id,startedAt,pages,pagination:profile.pagination,fastest,results,discoveredSelectors:benchmarkDiscovered,recommendations:fastest?[`بهترین موتور به‌عنوان پیش‌فرض پروفایل ذخیره شد: ${fastest.engine} (${fastest.products} محصول در ${fastest.pagesScanned} صفحه/دسته).`]:(bestCount>0?[`هیچ موتوری به اندازهٔ کافی محصول پیدا نکرد (بیشترین: ${bestCount}). موتور پیش‌فرض پروفایل تغییر نکرد تا یک نتیجهٔ نادرست جایگزین تنظیم درست شما نشود.`,'سلکتور ظرف محصول را بررسی کنید؛ اگر روی Cloudflare درست کار می‌کند، همان htmlrewriter را دستی انتخاب کنید.']:['هیچ موتوری در سه صفحهٔ اول محصولی استخراج نکرد. دسترسی شبکه، پاسخ ضدربات و سلکتورها را بررسی کنید.','موتور پیش‌فرض پروفایل بدون تغییر باقی ماند.'])};
}
app.post('/api/profiles/:id/benchmark-engines',async c=>{const profile=await getProfile(c.req.param('id'));if(!profile)return c.json({ok:false,error:'Profile not found'},404);if(c.req.query('live')==='1')return diagnosticStream(observe=>benchmarkProfileEngines(profile,observe));return c.json(await benchmarkProfileEngines(profile))});
app.post('/api/profiles/:id/run',async c=>runProfileApi(c,c.req.param('id')));
app.post('/api/profiles/:id/extract',async c=>runProfileApi(c,c.req.param('id')));
app.post('/api/extract/:id',async c=>runProfileApi(c,c.req.param('id')));
app.get('/api/jobs', async c => {
  const jobs = await listJobs(Math.min(200, Number(c.req.query('limit')) || 50));
  // Recover persisted/manual queued work after a web restart, including when
  // continuous processing is disabled. This does not change or duplicate jobs.
  if (jobs.some(job => job.status === 'queued')) triggerLocalJobDrain();
  return c.json({ ok: true, jobs, processor: jobDispatcher.status() });
});
app.post('/api/jobs/:id/start', async c => {
  const job = await getJob(c.req.param('id'));
  if (!job) return c.json({ ok: false, error: 'Job not found' }, 404);
  if (job.status !== 'queued') return c.json({ ok: false, error: 'Only queued jobs can be started' }, 409);
  triggerLocalJobDrain();
  return c.json({ ok: true, job, processor: 'triggered' }, 202);
});
app.get('/api/jobs/:id', async c => { const job = await getJob(c.req.param('id')); return job ? c.json({ ok: true, job }) : c.json({ ok: false, error: 'Job not found' }, 404); });
app.post('/api/jobs/:id/stop', async c => { const job=await stopJob(c.req.param('id')); if(job)return c.json({ok:true,job,forced:true}); await updateJob(c.req.param('id'), { stopRequested: true }); return c.json({ ok: true, forced:false }); });
app.post('/api/jobs/:id/retry',async c=>{const job=await retryJob(c.req.param('id'));if(job)triggerLocalJobDrain();return job?c.json({ok:true,job,processor:'triggered'}):c.json({ok:false,error:'Job cannot be retried'},409)});
app.delete('/api/jobs/:id',async c=>c.json({ok:await deleteJob(c.req.param('id'))}));
app.delete('/api/jobs',async c=>c.json({ok:true,deleted:await clearFinishedJobs()}));
app.get('/api/profiles/:id/products', async c => {
  const limit = Math.min(500, Number(c.req.query('limit')) || 100), offset = Math.max(0, Number(c.req.query('offset')) || 0);
  return c.json({ ok: true, ...await listProducts(c.req.param('id'), limit, offset, c.req.query('q') || '') });
});
app.delete('/api/profiles/:id/products/:sourceKey',async c=>c.json({ok:await deleteProduct(c.req.param('id'),decodeURIComponent(c.req.param('sourceKey')))}));
app.delete('/api/profiles/:id/products',async c=>{if(c.req.query('confirm')!=='DELETE')return c.json({ok:false,error:'confirm=DELETE is required'},400);return c.json({ok:true,deleted:await clearProducts(c.req.param('id'))})});
app.get('/api/profiles/:id/export.csv',async c=>{const result=await listProducts(c.req.param('id'),100000,0,''),fields=['sourceKey','title','price','url','image','sku','brand','stock','weight','category','shortDesc','longDesc'],csv='\uFEFF'+fields.join(',')+'\n'+result.products.map(p=>fields.map(field=>csvCell((p as any)[field])).join(',')).join('\n');return c.body(csv,200,{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="${c.req.param('id').replace(/[^a-z0-9_.-]/gi,'_')}.csv"`})});
app.post('/api/profiles/:id/import',async c=>{const profile=await getProfile(c.req.param('id'));if(!profile)return c.json({ok:false,error:'Profile not found'},404);const body=await c.req.json().catch(()=>null) as any;if(!body||typeof body!=='object')return c.json({ok:false,error:'بدنهٔ درخواست باید JSON با فیلد rows یا csv باشد.'},400);const rows=Array.isArray(body.rows)?body.rows:typeof body.csv==='string'?parseCsv(body.csv):[];let imported=0,failed=0,skippedNoPrice=0;const errors:string[]=[];for(const [index,row] of rows.entries())try{const title=String(row.title||row.name||'').trim();if(!title)throw Error('title is empty');const key=String(row.sourceKey||row.key||crypto.randomUUID()),image=String(row.image||'');const importedPrice=numberFromText(String(row.price||0));if(!(importedPrice>0)){skippedNoPrice++;errors.push(`${title}: قیمت ندارد؛ نادیده گرفته شد.`);continue}await upsertProduct(profile.id,{sourceKey:key,title,price:numberFromText(String(row.price||0)),priceText:String(row.price||''),url:String(row.url||row.link||''),image,images:image?[image]:[],sku:String(row.sku||''),brand:String(row.brand||''),stock:row.stock==null?undefined:Number(row.stock),weight:row.weight==null?undefined:Number(row.weight),category:String(row.category||''),specs:Array.isArray(row.specs)?row.specs.filter((x:any)=>x&&x.name&&x.value).map((x:any)=>({name:String(x.name),value:String(x.value)})).slice(0,60):undefined,shortDesc:String(row.shortDesc||''),longDesc:String(row.longDesc||''),sourcePage:'import',scrapedAt:new Date().toISOString()},{source:true});imported++}catch(error){failed++;if(errors.length<50)errors.push(`row ${index+1}: ${error instanceof Error?error.message:String(error)}`)}return c.json({ok:failed===0,imported,failed,skippedNoPrice,errors})});
app.post('/api/test-selector', async c => {
  const body = await c.req.json() as any; return c.json({ ok: true, ...await testSelector(String(body.url || ''), String(body.selector || ''), String(body.type || 'text')) });
});
app.post('/api/import-php', async c => {
  const body = await c.req.json() as any; const source = typeof body.profiles === 'string' ? JSON.parse(body.profiles) : body.profiles;
  const imported: Profile[] = [];
  for (const [id, value] of Object.entries(source || {})) imported.push(await saveProfile(normalizeProfile({ ...(value as any), id })));
  return c.json({ ok: true, imported: imported.length, profiles: imported });
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, info => console.log(`Scraper4 (${runtimeEnvironment.label}) listening on http://${info.address}:${info.port}`));
let aiEnrichRunning=false;
let scheduler: NodeJS.Timeout | undefined;
let backgroundStarted = false;
const jobDispatcher = createJobDispatcher({ processOneJob, concurrency:async()=>Number((await getState<any>('settings',{}))?.general?.maxConcurrentProfiles)||2, pollMs: config.workerPollMs, onError: error => console.error('Job dispatcher error', error) });
function triggerLocalJobDrain(): void { jobDispatcher.wake(); }
function startBackground(): void {
  if (!config.runWorkerInWeb || !databaseReady || backgroundStarted) return;
  backgroundStarted = true;
  jobDispatcher.start();
  const schedule = async () => { try { const settings=await getState<any>('settings',{}),stallMin=Math.max(1,Math.ceil(Number(settings.watchdog?.stallAfter||300)/60));if(settings.watchdog?.enabled!==false){const recovered=settings.watchdog?.autoContinue!==false?await recoverFailedAndStalledJobs(stallMin):await reapStalledJobs(stallMin);if(recovered)console.log(`Recovered ${recovered} stalled/failed job(s)`)}await drainWooReprice(wooRepriceIO());await refreshDestinationLedger(false);const count=await enqueueDueProfiles();if(count)console.log(`Scheduled ${count} profile(s)`);await scheduledBranchPushTick({settings,envToken:process.env.GH_BACKUP_TOKEN,loadLast:()=>getState<any>('branch_push_last',null),saveLast:rec=>setState('branch_push_last',rec),buildBundle:()=>createPhpSettingsBundle(),connect:token=>({getter:githubApiFetch(token),putter:githubApiPut(token)}),snapshotDatabase:nodeSnapshotDatabase,log:m=>console.log('[scheduled-push]',m)});await recoverCategoryRun();await categoryFixTick({settings,loadLast:()=>getState<any>(CATEGORY_FIX_LAST_KEY,null),saveLast:rec=>setState(CATEGORY_FIX_LAST_KEY,rec),start:input=>startCategoryRun(input),log:m=>console.log('[category-fix]',m)});if(!aiEnrichRunning){aiEnrichRunning=true;try{await aiEnrichTick({enabled:async()=>(await getState<any>('ai_description_settings',{enabled:true}))?.enabled!==false,modelReady:async()=>Boolean(await preferredAiChatModel()),listProfileIds:async()=>(await listProfiles()).map(p=>p.id),profileEnabled:async id=>(await getProfile(id))?.aiDescriptions!==false,loadCursor:()=>getState<any>(AI_ENRICH_LAST_KEY,null),saveCursor:rec=>setState(AI_ENRICH_LAST_KEY,rec),listStalest:(profileId,limit)=>listStalestProducts(profileId,limit),categories:async()=>{try{return(await destinationCategories()).items}catch{return[]}},enrich:(product,cats)=>generateProductDescription(product,{categories:cats}),saveProduct:(profileId,product)=>upsertProduct(profileId,product as any),log:m=>console.log('[ai-enrich]',m)});}finally{aiEnrichRunning=false;}}const automation=await automationTick();if(Object.keys(automation).length)console.log('Automation',JSON.stringify(automation)); } catch (error) { console.error('Scheduler error', error); } };
  void schedule(); scheduler = setInterval(schedule, 60_000); scheduler.unref();
}
startBackground();
const pushNoticeTimer=setInterval(()=>{if(!databaseReady)return;void pushDeployerNotices(async()=>{const {base,token}=deployerLocalHandshake();const response=await fetch(base+'/api/notifications',{headers:{'x-local-deployer-token':token},signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Deployer notices unavailable');return response.json()}).catch(()=>undefined)},60_000);pushNoticeTimer.unref();
if (localScraperAutoUpdate) {
  setTimeout(() => maybeAutoUpdateLocalScraper('startup'), 10_000).unref();
  setInterval(() => maybeAutoUpdateLocalScraper('timer'), localScraperAutoUpdateMs).unref();
}
const databaseRetry = setInterval(async () => { if (!databaseReady && config.databaseUrl && await initializeDatabase()) startBackground(); }, 30_000);
databaseRetry.unref();
const shutdown = async () => { jobDispatcher.stop(); requestWorkerStop(); clearInterval(databaseRetry); if (scheduler) clearInterval(scheduler); server.close(); await pool.end(); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

function csvCell(value:unknown){return `"${String(value??'').replace(/"/g,'""')}"`}
function parseCsv(text:string):Record<string,string>[] {const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;const input=text.replace(/^\uFEFF/,'');for(let i=0;i<input.length;i++){const ch=input[i];if(quoted){if(ch==='"'&&input[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}else if(ch==='"')quoted=true;else if(ch===','){row.push(cell);cell=''}else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell=''}else if(ch!=='\r')cell+=ch}if(cell||row.length){row.push(cell);rows.push(row)}const headers=rows.shift()?.map(x=>x.trim())||[];return rows.filter(x=>x.some(Boolean)).map(values=>Object.fromEntries(headers.map((key,i)=>[key,values[i]||''])))}
function validTarget(value: string): 'none'|'woo'|'basalam'|'both' { return ['none','woo','basalam','both'].includes(value) ? value as any : 'none'; }
function safeEqual(a: string, b: string): boolean { const aa=Buffer.from(a),bb=Buffer.from(b); return aa.length===bb.length && timingSafeEqual(aa,bb); }
function idFromUrl(raw: string): string { const url = new URL(raw); return `${url.hostname}_${url.pathname}`.toLowerCase().replace(/[^a-z0-9_.-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,120); }
function legacyProducts(raw: unknown): Product[] {
  const entries:Array<[string,any]>=[];
  if(Array.isArray(raw))for(const item of raw){if(Array.isArray(item)&&item.length>=2)entries.push([String(item[0]),item[1]]);else if(item&&typeof item==='object')entries.push([String((item as any).sourceKey||(item as any).key||crypto.randomUUID()),item]);}
  else if(raw&&typeof raw==='object')for(const [key,value] of Object.entries(raw as Record<string,any>))entries.push([key,value]);
  return entries.filter(([,p])=>p&&p.title).map(([key,p])=>{const images=Array.isArray(p.images)?p.images.filter((x:unknown)=>typeof x==='string'&&!String(x).startsWith('data:')):[];const image=String(p.image||images[0]||'');if(image&&!images.includes(image)&&!image.startsWith('data:'))images.unshift(image);return{sourceKey:key,title:String(p.title),price:numberFromText(String(p.finalPrice??p.price??0)),priceText:String(p.priceText??p.price??''),url:String(p.url||p.link||''),image:image.startsWith('data:')?'':image,images,shortDesc:String(p.shortDesc||''),longDesc:String(p.longDesc||''),sku:String(p.sku||''),brand:String(p.brand||''),stock:p.stock==null?undefined:Number(p.stock),weight:p.weight==null?undefined:Number(p.weight),category:String(p.category||''),sourcePage:String(p.sourcePage||''),scrapedAt:new Date().toISOString()}});
}

const MANUAL_LIST_ENGINES=new Set(['htmlrewriter','cheerio']);
function isManualListEngine(engine?:string){return !!engine&&MANUAL_LIST_ENGINES.has(engine)}
async function applyInlineSelectorSuggestions(profile:Profile,url:string,mode:'list'|'detail',errors:string[],onlyMissing=true){try{const suggested=await suggestSelectors(url,mode),entries=Object.entries(suggested.selectors||{}).filter(([key,value])=>String(value||'').trim()&&(!onlyMissing||!String((profile.selectors as any)?.[key]||'').trim()));if(entries.length){profile.selectors={...profile.selectors,...Object.fromEntries(entries)} as Profile['selectors'];await saveProfile({...profile,updatedAt:new Date().toISOString()});return {...suggested,selectors:Object.fromEntries(entries)}}}catch(error){errors.push(`selectors ${mode}: ${error instanceof Error?error.message:String(error)}`)}return null}
async function runProfileApi(c:any,id:string){
  const profile=await getProfile(id);if(!profile)return c.json({ok:false,error:'Profile not found'},404);
  const body=await c.req.json().catch(()=>({})) as any,target=validTarget(body.target||(body.sync?'both':'none')),persist=body.persist!==false||target!=='none',withDetails=body.details!==false,extract=body.extract!==false&&!profile.noExtract;
  const requestedPages=body.pages!==undefined?Number(body.pages):Number(profile.pages),pages=['none','scroll'].includes(profile.pagination)?1:requestedPages>0?Math.min(100,Math.max(1,requestedPages)):100,limit=Math.min(2000,Math.max(1,Number(body.limit)||Number(body.limitProducts)||1000));
  const products:Product[]=[],seen=new Set<string>(),syncResults:any[]=[],errors:string[]=[];let usedEngine:ExtractionEngine|undefined,engineMs=0,pagesScanned=0,added=0,updated=0,listSelectorUpdate:any=null,detailSelectorUpdate:any=null,autoSelectorsAllowed=false;const engineDiscovered:Record<string,string>={};
  if(extract){
    for(let pageNo=1;pageNo<=pages&&products.length<limit;pageNo++)try{const scraped=await scrapeListWithMeta(pageUrl(profile,pageNo),profile.selectors,profile.extractionEngine,profile.extractionEngineMaster,true,'',true,Boolean(profile.networkIndirect),profile.pagination==='scroll'||(profile.pagination==='none'&&['playwright','puppeteer','crawlee_playwright','network_api'].includes(profile.extractionEngine||'auto')));pagesScanned++;usedEngine=scraped.usedEngine||usedEngine;engineMs+=scraped.elapsedMs||0;if(scraped.usedEngine&&scraped.products.length&&(profile.extractionEngine==='auto'||profile.extractionEngineMaster!==scraped.usedEngine)){profile.extractionEngineMaster=scraped.usedEngine;profile.extractionEngineHost=new URL(pageUrl(profile,pageNo)).hostname;profile.extractionEngineMs=scraped.elapsedMs||0;await saveProfile({...profile,updatedAt:new Date().toISOString()})}if(scraped.discoveredSelectors&&Object.keys(scraped.discoveredSelectors).length){profile.selectors={...profile.selectors,...scraped.discoveredSelectors};await saveProfile({...profile,updatedAt:new Date().toISOString()});Object.assign(engineDiscovered,scraped.discoveredSelectors)}if(scraped.usedEngine&&scraped.products.length&&!isManualListEngine(scraped.usedEngine)){autoSelectorsAllowed=true;listSelectorUpdate=await applyInlineSelectorSuggestions(profile,pageUrl(profile,pageNo),'list',errors,true)}const before=products.length;for(const raw of scraped.products){const product=raw;if(seen.has(product.sourceKey))continue;seen.add(product.sourceKey);products.push(product);if(products.length>=limit)break}if(products.length===before){if(pageNo===1)throw new Error('در صفحهٔ اول هیچ محصول تازه‌ای استخراج نشد؛ این اجرا موفقِ صفرمحصول محسوب نمی‌شود. سلکتورها، موتور استخراج و محدودیت دسترسی/ضدربات سایت را بررسی کنید.');break}}catch(error){errors.push(`page ${pageNo}: ${error instanceof Error?error.message:String(error)}`);if(pageNo===1)break}
    if(!products.length&&errors.length)throw new Error(errors[0]);
    if(withDetails&&products.length){const sample=products.find(p=>p.url);if(sample?.url&&autoSelectorsAllowed)detailSelectorUpdate=await applyInlineSelectorSuggestions(profile,sample.url,'detail',errors,true);await mapLimit(products,Math.min(4,Math.max(1,Number(process.env.DETAIL_CONCURRENCY||2))),async product=>{try{Object.assign(product,await scrapeDetails(product,profile.selectors,Boolean(profile.networkIndirect)))}catch(error){errors.push(`${product.title}: details: ${error instanceof Error?error.message:String(error)}`)}});}
    const categoryPending=products.filter(product=>product.price>0&&productNeedsBasalamCategory(product));
    if(categoryPending.length){
      let enrichCategories:any[]=[];try{enrichCategories=(await destinationCategories()).items}catch{/* manual and learned categories remain available */}
      await mapLimit(categoryPending,2,async product=>{
        try{const result=await assignProductBasalamCategory(product,{categories:enrichCategories,profileCategoryId:profile.basalamCategoryId});if(!result.ok)errors.push(`${product.title}: category: ${result.error||'unresolved'}`)}
        catch(error){errors.push(`${product.title}: category: ${error instanceof Error?error.message:String(error)}`)}
      });
    }
    if(persist)for(const product of products)try{(await upsertProduct(profile.id,product,{source:true}))==='added'?added++:updated++}catch(error){errors.push(`${product?.title||'?'}: save: ${error instanceof Error?error.message:String(error)}`)}
    if(persist)await markProfileRun(profile.id);
  }else products.push(...(await listProducts(profile.id,limit,0,String(body.q||''))).products);
  if(target!=='none'&&extract){const stored=await Promise.all(products.map(product=>getProduct(profile.id,product.sourceKey)));products.splice(0,products.length,...stored.filter((product):product is Product=>Boolean(product)));}
  if(target!=='none')for(const product of products)try{if(product.price<=0||(profile.minPrice&&product.price<profile.minPrice))continue;if(target==='woo'||target==='both')syncResults.push({sourceKey:product.sourceKey,title:product.title,target:'woo',action:await syncWoo(product,profile)});if(target==='basalam'||target==='both')syncResults.push({sourceKey:product.sourceKey,title:product.title,target:'basalam',results:await syncBasalam(product,profile)})}catch(error){errors.push(`${product.title}: sync: ${error instanceof Error?error.message:String(error)}`)}
  return c.json({ok:errors.length===0,mode:'inline-api',profileId:profile.id,target,engine:{requested:profile.extractionEngine,master:profile.extractionEngineMaster,used:usedEngine||profile.extractionEngineMaster||profile.extractionEngine,elapsedMs:engineMs,pagesScanned},summary:{total:products.length,added,updated,synced:syncResults.length,failed:errors.length,persisted:persist,details:withDetails},products,syncResults,errors,selectors:{list:{...engineDiscovered,...(listSelectorUpdate?.selectors||{})},detail:detailSelectorUpdate?.selectors||{}}},errors.length?207:200);
}
function normalizeProfile(raw: any): Profile {
  const url = new URL(String(raw.url || '').replace(/&amp;/g, '&')); if (!['http:','https:'].includes(url.protocol)) throw new Error('Invalid profile URL');
  const now = new Date().toISOString(); const engine=String(raw.extractionEngine||raw.scrapingEngine||raw.engine||'auto') as ExtractionEngine; const rawMaster=String(raw.extractionEngineMaster||raw.fetch_engine_master||raw.engineMaster||'') as ExtractionEngine; const master=(['cheerio','htmlrewriter','jsonld','next_data','metadata','script_json','heuristic','structural','playwright','puppeteer','crawlee_playwright','network_api'].includes(rawMaster)?rawMaster:undefined); const selectors = { ...DEFAULT_SELECTORS, ...(typeof raw.selectors === 'string' ? JSON.parse(raw.selectors) : raw.selectors || {}) };
  for (const key of ['container','title','price','link','image']) if (!selectors[key]) throw new Error(`selectors.${key} is required`);
  return { id: String(raw.id || idFromUrl(url.href)), name: String(raw.name || url.hostname), url: url.href, enabled: raw.enabled !== false,
    pages: Math.min(100,Math.max(0,Number(raw.pages)||0)), pagination: ['query_page','query_custom','path_page','path_pattern','full_pattern','next_selector','none','scroll'].includes(raw.pagination || raw.pagType) ? raw.pagination || raw.pagType : 'query_page',
    extractionEngine: ['auto','cheerio','htmlrewriter','jsonld','next_data','metadata','script_json','heuristic','structural','playwright','puppeteer','crawlee_playwright','network_api'].includes(engine)?engine:'auto',
    extractionEngineMaster:master,extractionEngineHost:String(raw.extractionEngineHost||raw.fetch_engine_host||''),extractionEngineMs:Math.max(0,Number(raw.extractionEngineMs||raw.fetch_engine_ms)||0),extractionEngineBenchmarks:Array.isArray(raw.extractionEngineBenchmarks)?raw.extractionEngineBenchmarks:[],
    paginationValue: String(raw.paginationValue || raw.pagVal || 'page'), selectors, gallery: (raw.gallery && typeof raw.gallery === 'object' ? raw.gallery : undefined), titleSuffix: String(raw.titleSuffix || ''),
    priceMode: ['none','add','percent','multiply'].includes(raw.priceMode) ? raw.priceMode : 'none', priceValue: Number(raw.priceValue ?? raw.priceVal) || 0,
    roundPrice: Math.max(0,Number(raw.roundPrice)||0), minPrice: Math.max(0,Number(raw.minPrice)||0), wooCategoryId: Number(raw.wooCategoryId)||0,
    basalamCategoryId: Number(raw.basalamCategoryId ?? raw.bslCategoryId)||0, basalamFallbackCategoryIds: Array.isArray(raw.basalamFallbackCategoryIds ?? raw.bslFallbackCatIds) ? (raw.basalamFallbackCategoryIds ?? raw.bslFallbackCatIds).map(Number).filter(Boolean) : [], networkIndirect: Boolean(raw.networkIndirect ?? raw.net_indirect), noExtract: Boolean(raw.noExtract ?? (raw.syncConfig as any)?.noExtract), syncWoo: Boolean(raw.syncWoo), syncBasalam: Boolean(raw.syncBasalam), aiDescriptions: raw.aiDescriptions!==false,
    intervalMinutes: Math.max(0,Number(raw.intervalMinutes)||0), lastRunAt: raw.lastRunAt || null, createdAt: raw.createdAt || now, updatedAt: now };
}

function automationTick(...args:Parameters<typeof rawautomationTick>):ReturnType<typeof rawautomationTick>{return monitored({setState,deleteState},'پاسخ خودکار و گزارش دوره‌ای',()=>rawautomationTick(...args))}

function aiEnrichTick(...args:Parameters<typeof rawaiEnrichTick>):ReturnType<typeof rawaiEnrichTick>{return monitored({setState,deleteState},'تکمیل دوره‌ای محتوای محصولات با هوش مصنوعی',()=>rawaiEnrichTick(...args))}

function scheduledBranchPushTick(...args:Parameters<typeof rawscheduledBranchPushTick>):ReturnType<typeof rawscheduledBranchPushTick>{return monitored({setState,deleteState},'پشتیبان‌گیری دوره‌ای شاخه',()=>rawscheduledBranchPushTick(...args))}

function wooRepriceIO(){return {loadConnections,saveConnections,mergeConnections,listProfiles,getState,setState,createJob,dispatch:async(_job:any)=>{triggerLocalJobDrain()}}}
