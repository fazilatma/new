import { serve } from '@hono/node-server';
import { timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { aiCall, aiProviders, getLeaderboard, recordVote, testAllModels } from './ai.js';
import { automationTick, autoreplyLogs, autoreplyRun, basalamChats, basalamOrders, digest, generateReply } from './automation.js';
import { config, assertConfig } from './config.js';
import { connectionStatus, loadConnections, saveConnections } from './connections.js';
import { DASHBOARD, DASHBOARD_JS, setupPage } from './dashboard.js';
import { fontFile, fontStylesheet } from './fonts.js';
import { clearProducts, createBackup, createJob, databaseDriver, databaseLabel, deleteProduct, deleteProfile, enqueueDueProfiles, findLearnedCategory, getJob, getProduct, getProfile, getState, importAutoreplyLog, importCategoryLearning, learnCategory, listCategoryLearning, listJobs, listProducts, listProfiles, markProfileRun, migrate, pool, profileStats, reapStalledJobs, recoverFailedAndStalledJobs, restoreBackup, retryJob, deleteJob, clearFinishedJobs, saveProfile, setState, stopJob, updateJob, upsertProduct } from './db.js';
import { DEFAULT_SELECTORS, type ExtractionEngine, type Product, type Profile } from './types.js';
import { safeFetch, safeText } from './network.js';
import { sendNotification } from './notifications.js';
import { PHP_MENU_CAPABILITIES, runSelftest } from './parity.js';
import { bulkEdit, destinationChangeStatus, destinationDelete, destinationOverview, findDestinationDuplicates, listDestinationProducts, photoFix, rebuildMap, recon, retire } from './maintenance.js';
import { mapLimit, numberFromText, pageUrl, scrapeDetails, scrapeListWithMeta, suggestSelectors, testSelector, transformProduct } from './scraper.js';
import { syncBasalam, syncWoo } from './sync.js';
import { createPhpSettingsBundle, decodePhpSettingsBundle, stateKeyForFile } from './settings-transfer.js';
import { createVisualTicket, renderVisualSelector } from './visual.js';
import { workerLoop, requestWorkerStop, processOneJob } from './processor.js';

const PACKAGE_VERSION = (() => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '1.62.0'; } catch { return process.env.npm_package_version || '1.62.0'; } })();
const runtimeVersion = () => process.env.WORKER_VERSION || PACKAGE_VERSION;
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
    {label:'Storage configuration',items:[item(databaseLabel,true,databaseDriver,'database'),item('DATABASE_URL',Boolean(process.env.DATABASE_URL),'configured','environment'),item('RUN_WORKER_IN_WEB',config.runWorkerInWeb,'configured','environment')]}
  ];
  return{ok:true,environment:process.env.TERMUX_VERSION?'termux-node':process.env.RENDER?'render-node':'local-node',queriedAt:new Date().toISOString(),dynamic:true,projectDir:String(root.pathname),groups};
}
const localScraperAutoUpdate = process.env.LOCAL_SCRAPER_AUTO_UPDATE !== 'false' && process.env.RENDER !== 'true';
const localScraperAutoUpdateMs = Math.max(60_000, Number(process.env.LOCAL_SCRAPER_AUTO_UPDATE_MS || 600_000));
let localScraperUpdateRunning = false;
function runLocal(command: string, args: string[] = []) { return spawnSync(command, args, { cwd: new URL('..', import.meta.url), encoding: 'utf8', env: process.env }); }
function maybeAutoUpdateLocalScraper(reason = 'timer') {
  if (!localScraperAutoUpdate || localScraperUpdateRunning) return;
  localScraperUpdateRunning = true;
  try {
    const branch = (runLocal('git', ['rev-parse', '--abbrev-ref', 'HEAD']).stdout || 'arena/01a0765b-new').trim() || 'arena/01a0765b-new';
    const before = (runLocal('git', ['rev-parse', 'HEAD']).stdout || '').trim();
    const fetched = runLocal('git', ['fetch', 'origin', branch]);
    if (fetched.status !== 0) return console.warn(`[auto-update:${reason}] git fetch failed: ${fetched.stderr || fetched.stdout}`);
    const remote = (runLocal('git', ['rev-parse', `origin/${branch}`]).stdout || '').trim();
    if (!before || !remote || before === remote) return;
    console.log(`[auto-update:${reason}] New scraper code found ${before.slice(0,7)} -> ${remote.slice(0,7)}. Updating and restarting local scraper...`);
    runLocal('git', ['config', '--local', '--replace-all', 'credential.helper', '!gh auth git-credential']);
    const reset = runLocal('git', ['reset', '--hard', `origin/${branch}`]);
    if (reset.status !== 0) return console.warn(`[auto-update:${reason}] git reset failed: ${reset.stderr || reset.stdout}`);
    runLocal(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--prefer-online']);
    runLocal(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'render:build']);
    setTimeout(() => process.exit(75), 500);
  } finally { localScraperUpdateRunning = false; }
}
let databaseReady = false;
let databaseError = '';
async function initializeDatabase(): Promise<boolean> {
  try {
    assertConfig();
    await migrate();
    await pool.query('SELECT 1');
    databaseReady = true; databaseError = '';
    console.log(`${databaseLabel} connected and schema is ready`);
    return true;
  } catch (error) {
    databaseReady = false;
    databaseError = error instanceof Error ? error.message : String(error);
    console.error(`DATABASE NOT READY: ${databaseError}`);
    return false;
  }
}
await initializeDatabase();

const app = new Hono();
const dashboardHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'https:'], objectSrc: ["'none'"], frameAncestors: ["'none'"]
  }
});
app.use('*', async (c, next) => c.req.path === '/visual' ? next() : dashboardHeaders(c, next));
app.use('/api/*', cors({ origin: origin => origin, allowHeaders: ['authorization','content-type'], allowMethods: ['GET','POST','PUT','DELETE'] }));
app.onError((error, c) => { console.error(error); return c.json({ ok: false, error: error.message }, 500); });
app.get('/health', c => c.json({
  ok: true,
  app: 'scraper4-render',
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
      'content-security-policy': "default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline' https: http:; font-src https: http: data:; script-src 'unsafe-inline'; frame-ancestors 'self';",
      'referrer-policy': 'no-referrer'
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.html(`<html dir="rtl"><body style="background:#0f172a;color:#fca5a5;font-family:Tahoma;padding:30px"><h2>خطای انتخاب‌گر بصری</h2><p>${message.replace(/[&<>]/g, '')}</p></body></html>`, 400);
  }
});

app.use('/api/*', async (c, next) => {
  if (!databaseReady) return c.json({ ok: false, error: 'Database is not configured', detail: databaseError, setup: 'Create Render PostgreSQL and set DATABASE_URL to its Internal Database URL.' }, 503);
  if (!config.adminToken) return next();
  const auth = c.req.header('authorization') || '';
  if (!safeEqual(auth.replace(/^Bearer\s+/i, ''), config.adminToken)) return c.json({ ok: false, error: 'Unauthorized' }, 401);
  await next();
});

app.post('/api/visual-ticket', async c => {
  const body = await c.req.json() as { url?: string };
  const url = new URL(String(body.url || ''));
  if (!['http:', 'https:'].includes(url.protocol)) return c.json({ ok: false, error: 'Invalid visual selector URL' }, 400);
  return c.json({ ok: true, ticket: createVisualTicket(url.href), expiresIn: 300 });
});
app.get('/api/status', async c => { const connections=await loadConnections(); return c.json({ ok:true,profiles:(await listProfiles()).length,jobs:await listJobs(10),connections:connectionStatus(connections) }); });
app.get('/api/version', c => c.json({ ok: true, version: runtimeVersion(), runtime: 'local-node-render', ui: 'cloudflare-compatible' }));
app.get('/api/runtime/libraries', c => c.json(nodeLibraryProbe()));
app.get('/api/libraries', c => c.json(nodeLibraryProbe()));
app.get('/api/activity', async c => {
  const [profiles, jobs] = await Promise.all([listProfiles(), listJobs(Math.min(30, Number(c.req.query('limit')) || 15))]);
  const active = jobs.filter((j: any) => ['queued', 'running'].includes(j.status));
  return c.json({ ok: true, ts: new Date().toISOString(), queue: true, version: runtimeVersion(), counts: { profiles: profiles.length, jobs: jobs.length, active: active.length, runningRuns: 0 }, activeJobs: active.slice(0, 15), runs: [], quota: { writeExceeded: false } });
});
app.get('/api/ai/chat-models', async c => c.json({ ok: true, providers: await aiProviders(), models: [] }));
app.get('/api/ai/test-results', async c => c.json({ ok: true, results: [], leaderboard: await getLeaderboard() }));
app.get('/api/ai/test-runs/current', c => c.json({ ok: true, run: null }));
app.post('/api/ai/test-runs', async c => { const body = await c.req.json().catch(() => ({})) as any; return c.json({ ok: true, results: await testAllModels(String(body.prompt || 'سلام'), Boolean(body.onlyCandidates)) }); });
app.post('/api/ai/test-runs/control', c => c.json({ ok: true, status: 'noop' }));
app.post('/api/ai/test-runs/reset', c => c.json({ ok: true }));
app.post('/api/ai/test-runs/retry', c => c.json({ ok: false, error: 'Retry individual AI test parts is only available on Cloudflare Worker runtime.' }, 501));
app.post('/api/ai/chat', async c => { const body = await c.req.json().catch(() => ({})) as any, providers = await aiProviders(); const key = String(body.providerId || body.provider || '').split('::')[0]; const provider = providers.find((p: any) => p.id === key) || providers[0]; if (!provider) return c.json({ ok: false, error: 'No AI provider configured' }, 400); const messages = Array.isArray(body.messages) ? body.messages : []; const prompt = messages.map((m: any) => `${m.role || 'user'}: ${m.content || ''}`).join('\n') || String(body.prompt || 'سلام'); return c.json(await aiCall(provider, String(body.model || provider.models?.[0] || ''), prompt)); });
app.get('/api/agent/templates', c => c.json({ ok: true, templates: [] }));
app.get('/api/agent/tools', c => c.json({ ok: true, tools: [] }));
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
app.get('/api/parity',c=>c.json({ok:true,total:PHP_MENU_CAPABILITIES.length,capabilities:PHP_MENU_CAPABILITIES}));
app.get('/api/connections', async c => c.json({ok:true,connections:await loadConnections(true)}));
app.post('/api/connections', async c => c.json({ok:true,connections:await saveConnections(await c.req.json())}));
app.get('/api/ai/providers',async c=>c.json({ok:true,providers:await aiProviders(),leaderboard:await getLeaderboard()}));
app.post('/api/ai/test-all',async c=>{const body=await c.req.json().catch(()=>({})) as any;return c.json({ok:true,results:await testAllModels(String(body.prompt||'سلام'),Boolean(body.onlyCandidates))})});
app.post('/api/ai/call',async c=>{const body=await c.req.json() as any,providers=await aiProviders(),provider=providers.find(p=>p.id===body.provider);if(!provider)return c.json({ok:false,error:'Provider not found'},404);return c.json(await aiCall(provider,String(body.model||''),String(body.prompt||'سلام')))});
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
app.get('/api/backup', async c => c.json(await createBackup(), 200, { 'content-disposition': `attachment; filename="scraper4-render-${Date.now()}.json"` }));
app.post('/api/restore', async c => c.json({ok:true,result:await restoreBackup(await c.req.json())}));
app.get('/api/settings-export', async c => {
  const bundle=await createPhpSettingsBundle(new URL(c.req.url).host),stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,15);
  return c.json(bundle,200,{'content-disposition':`attachment; filename="settings_${stamp}.json"`});
});
app.post('/api/settings-import', async c => {
  const files=decodePhpSettingsBundle(await c.req.json());let profiles=0,products=0,states=0,categories=0,autoreplyLogs=0,connections=false;const warnings:string[]=[];
  const rawProfiles=files['profiles.json'];
  if(rawProfiles&&typeof rawProfiles==='object')for(const [id,raw] of Object.entries(rawProfiles as Record<string,any>)){
    try{const profile=normalizeProfile({...raw,id});await saveProfile(profile);profiles++;for(const product of legacyProducts(raw?.products)){await upsertProduct(profile.id,product);products++;}}
    catch(error){warnings.push(`${id}: ${error instanceof Error?error.message:String(error)}`)}
  }
  const rawConnections=files['connections.json'] as any;
  if(rawConnections){const woo=rawConnections.woocommerce||rawConnections.woo||{},basalam=rawConnections.basalam||{},ai=rawConnections.ai||{};await saveConnections({woo:{url:woo.url||woo.store_url||'',key:woo.consumer_key||woo.ck||woo.key||'',secret:woo.consumer_secret||woo.cs||woo.secret||'',categoryId:woo.category_id||0},basalam:{token:basalam.token||'',vendorId:String(basalam.vendor_id||basalam.vendorId||''),api:basalam.api_base||basalam.api||'https://openapi.basalam.com/v1',preparationDays:basalam.preparation_days,weight:basalam.weight,packageWeight:basalam.package_weight,stock:basalam.stock,categoryId:basalam.category_id,autoCategory:basalam.auto_category,netIndirect:basalam.net_indirect,shops:basalam.shops},ai:{baseUrl:ai.base_url||ai.baseUrl||'',apiKey:ai.api_key||ai.apiKey||'',model:ai.model||'',providers:ai.providers,candidates:ai.candidates,master:ai.master,network:ai.network},notifications:rawConnections.notifications||{}});connections=true;}
  if(files['category_learning.json'])categories=await importCategoryLearning(files['category_learning.json']);
  if(files['autoreply_log.json'])autoreplyLogs=await importAutoreplyLog(files['autoreply_log.json']);
  for(const [file,value] of Object.entries(files)){const key=stateKeyForFile(file);if(key){await setState(key,value);states++;}}
  return c.json({ok:true,format:'scraper4-php-compatible',imported:{profiles,products,states,categories,autoreplyLogs,connections},warnings});
});
app.get('/api/profile-stats', async c => c.json({ok:true,items:await profileStats()}));
app.post('/api/maintenance/recon/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json().catch(()=>({})) as any;return c.json({ok:true,report:await recon(target as any,String(body.profileId||''))})});
app.post('/api/maintenance/rebuild/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json().catch(()=>({})) as any;return c.json(await rebuildMap(target as any,String(body.profileId||'')))});
app.post('/api/maintenance/retire/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json() as any,apply=body.confirm==='APPLY';return c.json(await retire(target as any,String(body.profileId||''),String(body.action||'report'),apply))});
app.post('/api/maintenance/bulk/:target',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const body=await c.req.json() as any;return c.json(await bulkEdit(target as any,body,body.confirm==='APPLY'))});
app.post('/api/maintenance/photo-fix',async c=>{const body=await c.req.json() as any;return c.json(await photoFix(String(body.profileId||''),body.confirm==='APPLY'))});
app.get('/api/destination/:target/products',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);const all=await listDestinationProducts(target as any),q=String(c.req.query('q')||'').toLowerCase(),filtered=q?all.filter(x=>x.name.toLowerCase().includes(q)||String(x.id)===q):all,limit=Math.min(200,Number(c.req.query('limit'))||50),offset=Math.max(0,Number(c.req.query('offset'))||0);return c.json({ok:true,total:filtered.length,items:filtered.slice(offset,offset+limit)})});
app.get('/api/destination/:target/overview',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);return c.json({ok:true,...await destinationOverview(target as any)})});
app.get('/api/destination/:target/duplicates',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);return c.json({ok:true,groups:await findDestinationDuplicates(target as any)})});
app.post('/api/destination/:target/:id/status',async c=>{const target=c.req.param('target'),body=await c.req.json() as any;if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);if(body.confirm!=='APPLY')return c.json({ok:false,error:'confirm APPLY is required'},400);return c.json(await destinationChangeStatus(target as any,Number(c.req.param('id')),String(body.status||'')))});
app.delete('/api/destination/:target/:id',async c=>{const target=c.req.param('target');if(!['woo','basalam'].includes(target))return c.json({ok:false,error:'Invalid target'},400);if(c.req.query('confirm')!=='DELETE')return c.json({ok:false,error:'confirm DELETE is required'},400);return c.json(await destinationDelete(target as any,Number(c.req.param('id')),c.req.query('force')==='true'))});
app.post('/api/products/:profileId/:sourceKey/sync/:target',async c=>{const profile=await getProfile(c.req.param('profileId')),product=await getProduct(c.req.param('profileId'),c.req.param('sourceKey')),target=c.req.param('target');if(!profile||!product)return c.json({ok:false,error:'Product/profile not found'},404);if(target==='woo')return c.json({ok:true,result:await syncWoo(product,profile)});if(target==='basalam')return c.json({ok:true,result:await syncBasalam(product,profile)});return c.json({ok:false,error:'Invalid target'},400)});
app.post('/api/queue-watchdog', async c => { const body=await c.req.json().catch(()=>({})) as any,settings=await getState<any>('settings',{}),stallMin=Number(body.minutes)||Math.max(1,Math.ceil(Number(settings.watchdog?.stallAfter||300)/60)),autoContinue=body.autoContinue??settings.watchdog?.autoContinue!==false;return c.json({ok:true,autoContinue,recovered:autoContinue?await recoverFailedAndStalledJobs(stallMin):0,reaped:autoContinue?0:await reapStalledJobs(stallMin)}); });
app.post('/api/source-test', async c => { const body=await c.req.json() as any; const result=await safeText(String(body.url||''),1_000_000); return c.json({ok:true,bytes:Buffer.byteLength(result.text),url:result.url,title:(result.text.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]||'').replace(/<[^>]+>/g,'').trim()}); });
app.post('/api/test-connection/:target', async c => {
  const target=c.req.param('target'),connections=await loadConnections(true);
  if(target==='woo') { const x=connections.woo;if(!x.url||!x.key||!x.secret)return c.json({ok:false,error:'تنظیمات ووکامرس کامل نیست'},400);const auth=`Basic ${Buffer.from(`${x.key}:${x.secret}`).toString('base64')}`,r=await safeFetch(x.url+'/wp-json/wc/v3/system_status',{headers:{authorization:auth,accept:'application/json'}},2_000_000);return c.json({ok:r.ok,code:r.status}); }
  if(target==='basalam') { const x=connections.basalam;if(!x.token)return c.json({ok:false,error:'توکن باسلام خالی است'},400);const r=await safeFetch(x.api+'/categories',{headers:{authorization:`Bearer ${x.token}`,accept:'application/json'}},2_000_000);return c.json({ok:r.ok,code:r.status}); }
  if(target==='ai') { const ai=connections.ai;if(!ai.baseUrl||!ai.apiKey||!ai.model)return c.json({ok:false,error:'تنظیمات هوش مصنوعی کامل نیست'},400);const endpoint=ai.baseUrl+(ai.baseUrl.includes('/chat/completions')?'':'/chat/completions'),r=await safeFetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${ai.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:ai.model,messages:[{role:'user',content:'سلام'}],max_tokens:20})},2_000_000);return c.json({ok:r.ok,code:r.status,body:await r.json().catch(()=>null)}); }
  return c.json({ok:false,error:'Unknown connection'},404);
});
app.get('/api/categories/:target',async c=>{const target=c.req.param('target'),connections=await loadConnections();if(target==='woo'){const x=connections.woo;if(!x.url||!x.key||!x.secret)return c.json({ok:false,error:'اتصال ووکامرس کامل نیست'},400);const auth=`Basic ${Buffer.from(`${x.key}:${x.secret}`).toString('base64')}`,items:any[]=[];for(let page=1;page<=20;page++){const r=await safeFetch(`${x.url}/wp-json/wc/v3/products/categories?per_page=100&page=${page}`,{headers:{authorization:auth,accept:'application/json'}},3_000_000),rows=await r.json() as any[];if(!r.ok)return c.json({ok:false,error:`Woo HTTP ${r.status}`},502);items.push(...rows);if(rows.length<100)break}return c.json({ok:true,items})}if(target==='basalam'){const x=connections.basalam;if(!x.token)return c.json({ok:false,error:'توکن باسلام خالی است'},400);const r=await safeFetch(`${x.api}/categories`,{headers:{authorization:`Bearer ${x.token}`,accept:'application/json'}},5_000_000),body=await r.json() as any;return c.json({ok:r.ok,items:body?.data||body?.categories||body})}return c.json({ok:false,error:'Invalid target'},400)});
app.get('/api/profiles', async c => c.json({ ok: true, profiles: await listProfiles() }));
app.post('/api/profiles', async c => {
  const profile = normalizeProfile(await c.req.json()); return c.json({ ok: true, profile: await saveProfile(profile) });
});
app.delete('/api/profiles/:id', async c => c.json({ ok: await deleteProfile(c.req.param('id')) }));
app.post('/api/profiles/:id/scrape', async c => {
  const profile = await getProfile(c.req.param('id')); if (!profile) return c.json({ ok: false, error: 'Profile not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as any; const target = validTarget(body.target || 'none');
  const job=await createJob(profile.id, 'scrape', target);
  if(job.kind==='scrape'&&job.status==='queued')triggerLocalJobDrain();
  return c.json({ ok: true, job, processor:job.kind==='scrape'&&job.status==='queued'?'triggered':'existing-active', dedupProfile:true }, 202);
});
app.post('/api/profiles/:id/sync', async c => {
  const profile = await getProfile(c.req.param('id')); if (!profile) return c.json({ ok: false, error: 'Profile not found' }, 404);
  const body = await c.req.json().catch(() => ({})) as any;
  const job=await createJob(profile.id, 'sync', validTarget(body.target || 'both'));
  if(job.kind==='sync'&&job.status==='queued')triggerLocalJobDrain();
  return c.json({ ok: true, job, processor:job.kind==='sync'&&job.status==='queued'?'triggered':'existing-active', dedupProfile:true }, 202);
});
app.post('/api/profiles/:id/run',async c=>runProfileApi(c,c.req.param('id')));
app.post('/api/profiles/:id/extract',async c=>runProfileApi(c,c.req.param('id')));
app.post('/api/extract/:id',async c=>runProfileApi(c,c.req.param('id')));
app.get('/api/jobs', async c => c.json({ ok: true, jobs: await listJobs(Math.min(200, Number(c.req.query('limit')) || 50)) }));
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
app.post('/api/profiles/:id/import',async c=>{const profile=await getProfile(c.req.param('id'));if(!profile)return c.json({ok:false,error:'Profile not found'},404);const body=await c.req.json() as any,rows=Array.isArray(body.rows)?body.rows:typeof body.csv==='string'?parseCsv(body.csv):[];let imported=0,failed=0;const errors:string[]=[];for(const [index,row] of rows.entries())try{const title=String(row.title||row.name||'').trim();if(!title)throw Error('title is empty');const key=String(row.sourceKey||row.key||crypto.randomUUID()),image=String(row.image||'');await upsertProduct(profile.id,{sourceKey:key,title,price:numberFromText(String(row.price||0)),priceText:String(row.price||''),url:String(row.url||row.link||''),image,images:image?[image]:[],sku:String(row.sku||''),brand:String(row.brand||''),stock:row.stock==null?undefined:Number(row.stock),weight:row.weight==null?undefined:Number(row.weight),category:String(row.category||''),shortDesc:String(row.shortDesc||''),longDesc:String(row.longDesc||''),sourcePage:'import',scrapedAt:new Date().toISOString()});imported++}catch(error){failed++;if(errors.length<50)errors.push(`row ${index+1}: ${error instanceof Error?error.message:String(error)}`)}return c.json({ok:failed===0,imported,failed,errors})});
app.post('/api/test-selector', async c => {
  const body = await c.req.json() as any; return c.json({ ok: true, ...await testSelector(String(body.url || ''), String(body.selector || ''), String(body.type || 'text')) });
});
app.post('/api/import-php', async c => {
  const body = await c.req.json() as any; const source = typeof body.profiles === 'string' ? JSON.parse(body.profiles) : body.profiles;
  const imported: Profile[] = [];
  for (const [id, value] of Object.entries(source || {})) imported.push(await saveProfile(normalizeProfile({ ...(value as any), id })));
  return c.json({ ok: true, imported: imported.length, profiles: imported });
});

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, info => console.log(`Scraper4 Render listening on http://${info.address}:${info.port}`));
let scheduler: NodeJS.Timeout | undefined;
let backgroundStarted = false;
let localDrainRunning = false;
function triggerLocalJobDrain(): void {
  if (localDrainRunning) return;
  localDrainRunning = true;
  setImmediate(async () => {
    try { for (let i = 0; i < 25; i++) if (!await processOneJob()) break; }
    catch (error) { console.error('Manual job drain error', error); }
    finally { localDrainRunning = false; }
  });
}
function startBackground(): void {
  if (!config.runWorkerInWeb || !databaseReady || backgroundStarted) return;
  backgroundStarted = true;
  void workerLoop(config.workerPollMs);
  const schedule = async () => { try { const settings=await getState<any>('settings',{}),stallMin=Math.max(1,Math.ceil(Number(settings.watchdog?.stallAfter||300)/60));if(settings.watchdog?.enabled!==false){const recovered=settings.watchdog?.autoContinue!==false?await recoverFailedAndStalledJobs(stallMin):await reapStalledJobs(stallMin);if(recovered)console.log(`Recovered ${recovered} stalled/failed job(s)`)}const count=await enqueueDueProfiles();if(count)console.log(`Scheduled ${count} profile(s)`);const automation=await automationTick();if(Object.keys(automation).length)console.log('Automation',JSON.stringify(automation)); } catch (error) { console.error('Scheduler error', error); } };
  void schedule(); scheduler = setInterval(schedule, 60_000); scheduler.unref();
}
startBackground();
if (localScraperAutoUpdate) {
  setTimeout(() => maybeAutoUpdateLocalScraper('startup'), 10_000).unref();
  setInterval(() => maybeAutoUpdateLocalScraper('timer'), localScraperAutoUpdateMs).unref();
}
const databaseRetry = setInterval(async () => { if (!databaseReady && config.databaseUrl && await initializeDatabase()) startBackground(); }, 30_000);
databaseRetry.unref();
const shutdown = async () => { requestWorkerStop(); clearInterval(databaseRetry); if (scheduler) clearInterval(scheduler); server.close(); await pool.end(); process.exit(0); };
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
  const body=await c.req.json().catch(()=>({})) as any,target=validTarget(body.target||(body.sync?'both':'none')),persist=body.persist!==false,withDetails=body.details!==false,extract=body.extract!==false&&!Boolean((profile as any).noExtract);
  const requestedPages=body.pages!==undefined?Number(body.pages):Number(profile.pages),pages=requestedPages>0?Math.min(100,Math.max(1,requestedPages)):100,limit=Math.min(2000,Math.max(1,Number(body.limit)||Number(body.limitProducts)||1000));
  const products:Product[]=[],seen=new Set<string>(),syncResults:any[]=[],errors:string[]=[];let usedEngine:ExtractionEngine|undefined,engineMs=0,pagesScanned=0,added=0,updated=0,listSelectorUpdate:any=null,detailSelectorUpdate:any=null,autoSelectorsAllowed=false;
  if(extract){
    for(let pageNo=1;pageNo<=pages&&products.length<limit;pageNo++)try{const scraped=await scrapeListWithMeta(pageUrl(profile,pageNo),profile.selectors,profile.extractionEngine,profile.extractionEngineMaster);pagesScanned++;usedEngine=scraped.usedEngine||usedEngine;engineMs+=scraped.elapsedMs||0;if(scraped.usedEngine&&scraped.products.length&&(profile.extractionEngine==='auto'||profile.extractionEngineMaster!==scraped.usedEngine)){profile.extractionEngineMaster=scraped.usedEngine;profile.extractionEngineHost=new URL(pageUrl(profile,pageNo)).hostname;profile.extractionEngineMs=scraped.elapsedMs||0;await saveProfile({...profile,updatedAt:new Date().toISOString()})}if(scraped.usedEngine&&scraped.products.length&&!isManualListEngine(scraped.usedEngine)){autoSelectorsAllowed=true;listSelectorUpdate=await applyInlineSelectorSuggestions(profile,pageUrl(profile,pageNo),'list',errors,true)}const before=products.length;for(const raw of scraped.products){const product=transformProduct(raw,profile);if((profile.minPrice&&product.price<profile.minPrice)||seen.has(product.sourceKey))continue;seen.add(product.sourceKey);products.push(product);if(products.length>=limit)break}if(products.length===before){if(pageNo===1)throw new Error('در صفحهٔ اول هیچ محصول تازه‌ای استخراج نشد؛ این اجرا موفقِ صفرمحصول محسوب نمی‌شود. سلکتورها، موتور استخراج و محدودیت دسترسی/ضدربات سایت را بررسی کنید.');break}}catch(error){errors.push(`page ${pageNo}: ${error instanceof Error?error.message:String(error)}`);if(pageNo===1)break}
    if(!products.length&&errors.length)throw new Error(errors[0]);
    if(withDetails&&products.length){const sample=products.find(p=>p.url);if(sample?.url&&autoSelectorsAllowed)detailSelectorUpdate=await applyInlineSelectorSuggestions(profile,sample.url,'detail',errors,true);await mapLimit(products,Math.min(4,Math.max(1,Number(process.env.DETAIL_CONCURRENCY||2))),async product=>{try{Object.assign(product,await scrapeDetails(product,profile.selectors))}catch(error){errors.push(`${product.title}: details: ${error instanceof Error?error.message:String(error)}`)}});}
    if(persist)for(const product of products)try{(await upsertProduct(profile.id,product))==='added'?added++:updated++}catch(error){errors.push(`${product.title}: save: ${error instanceof Error?error.message:String(error)}`)}
    if(persist)await markProfileRun(profile.id);
  }else products.push(...(await listProducts(profile.id,limit,0,String(body.q||''))).products);
  if(target!=='none')for(const product of products)try{if(target==='woo'||target==='both')syncResults.push({sourceKey:product.sourceKey,title:product.title,target:'woo',action:await syncWoo(product,profile)});if(target==='basalam'||target==='both')syncResults.push({sourceKey:product.sourceKey,title:product.title,target:'basalam',results:await syncBasalam(product,profile)})}catch(error){errors.push(`${product.title}: sync: ${error instanceof Error?error.message:String(error)}`)}
  return c.json({ok:errors.length===0,mode:'inline-api',profileId:profile.id,target,engine:{requested:profile.extractionEngine,master:profile.extractionEngineMaster,used:usedEngine||profile.extractionEngineMaster||profile.extractionEngine,elapsedMs:engineMs,pagesScanned},summary:{total:products.length,added,updated,synced:syncResults.length,failed:errors.length,persisted:persist,details:withDetails},products,syncResults,errors,selectors:{list:listSelectorUpdate?.selectors||{},detail:detailSelectorUpdate?.selectors||{}}},errors.length?207:200);
}
function normalizeProfile(raw: any): Profile {
  const url = new URL(String(raw.url || '').replace(/&amp;/g, '&')); if (!['http:','https:'].includes(url.protocol)) throw new Error('Invalid profile URL');
  const now = new Date().toISOString(); const engine=String(raw.extractionEngine||raw.scrapingEngine||raw.engine||'auto') as ExtractionEngine; const rawMaster=String(raw.extractionEngineMaster||raw.fetch_engine_master||raw.engineMaster||'') as ExtractionEngine; const master=(['cheerio','htmlrewriter','jsonld','next_data','metadata','script_json','heuristic','playwright','puppeteer','crawlee_playwright'].includes(rawMaster)?rawMaster:undefined); const selectors = { ...DEFAULT_SELECTORS, ...(typeof raw.selectors === 'string' ? JSON.parse(raw.selectors) : raw.selectors || {}) };
  for (const key of ['container','title','price','link','image']) if (!selectors[key]) throw new Error(`selectors.${key} is required`);
  return { id: String(raw.id || idFromUrl(url.href)), name: String(raw.name || url.hostname), url: url.href, enabled: raw.enabled !== false,
    pages: Math.min(100,Math.max(0,Number(raw.pages)||0)), pagination: ['query_page','path_page','none'].includes(raw.pagination || raw.pagType) ? raw.pagination || raw.pagType : 'query_page',
    extractionEngine: ['auto','cheerio','htmlrewriter','jsonld','next_data','metadata','script_json','heuristic','playwright','puppeteer','crawlee_playwright'].includes(engine)?engine:'auto',
    paginationValue: String(raw.paginationValue || raw.pagVal || 'page'), selectors, titleSuffix: String(raw.titleSuffix || ''),
    priceMode: ['none','add','percent','multiply'].includes(raw.priceMode) ? raw.priceMode : 'none', priceValue: Number(raw.priceValue ?? raw.priceVal) || 0,
    roundPrice: Math.max(0,Number(raw.roundPrice)||0), minPrice: Math.max(0,Number(raw.minPrice)||0), wooCategoryId: Number(raw.wooCategoryId)||0,
    basalamCategoryId: Number(raw.basalamCategoryId ?? raw.bslCategoryId)||0, syncWoo: Boolean(raw.syncWoo), syncBasalam: Boolean(raw.syncBasalam),
    intervalMinutes: Math.max(0,Number(raw.intervalMinutes)||0), lastRunAt: raw.lastRunAt || null, createdAt: raw.createdAt || now, updatedAt: now };
}
