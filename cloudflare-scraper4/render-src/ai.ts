import { randomUUID } from 'node:crypto';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { assertPublicUrl, privateIp, safeFetch, viaWorkerUrl } from './network.js';
import { loadConnections, saveConnections } from './connections.js';
import { getState, setState } from './db.js';
import { categoryPrompt, parseCategoryId } from '../worker-src/destination-core.js';
import type { AiCategoryOption } from '../worker-src/destination-core.js';
import { greenTestedCandidateKeys, isChatCompatibleAiModel, isReasoningAiModel, parseModelKeySuffix } from '../worker-src/ai-catalog.js';
import { destinationCategories } from './maintenance.js';

type Provider={id:string;name:string;baseUrl:string;apiKey:string;models:string[];enabled:boolean;apiKeys?:any[];nonChatModels?:string[];reasoningModels?:string[]};
export { isChatCompatibleAiModel, isReasoningAiModel, parseModelKeySuffix };
type Network={mode:string;proxyUrl:string;workerUrl:string;dohUrl:string;resolveIp:string};

/**
 * The hamburger menu still exposes a single shared Base URL/API key, and many
 * saved vaults only have that one filled in. A provider row without its own key
 * may therefore still be usable: borrow the shared key when it points at the
 * same service, otherwise every model reports a missing key even though the
 * user did enter one.
 */
function sharedKeyFitsProvider(ai:any,provider:any):boolean{
  const host=(value:string)=>{try{return new URL(String(value)).host.toLowerCase()}catch{return ''}};
  const shared=host(ai?.baseUrl||'');const own=host(provider?.baseUrl||'');
  if(!String(ai?.apiKey||'').trim())return false;
  return !own||!shared||own===shared;
}
export async function aiProviders():Promise<Provider[]>{const ai=(await loadConnections()).ai;if(!ai.providers.length)return [{id:'default',name:'Default',baseUrl:ai.baseUrl,apiKey:ai.apiKey,models:ai.model?[ai.model]:[],enabled:true}];
  return ai.providers.map((provider:any)=>{const borrow=sharedKeyFitsProvider(ai,provider);
    const rawKeys=Array.isArray(provider.apiKeys)?provider.apiKeys:[];
    const active=rawKeys.filter((k:any)=>k&&(typeof k==='string'?String(k).trim():(k.enabled!==false&&String(k.token||k.key||'').trim())));
    const usable=active.length?active:rawKeys;
    const first=usable[0];
    const fromList=typeof first==='string'?first.trim():String(first?.token||first?.key||'').trim();
    return {...provider,
      baseUrl:String(provider.baseUrl||'').trim()||(borrow?String(ai.baseUrl||''):''),
      apiKey:String(provider.apiKey||'').trim()||fromList||(borrow?String(ai.apiKey||''):'')};
  })}
/**
 * Mirrors worker-src/ai.ts: report exactly which field is missing instead of one
 * opaque "provider/model config is incomplete" message. Local runtimes (Ollama)
 * legitimately have no API key.
 */
function isKeylessAiProvider(provider:{id?:string;baseUrl?:string}):boolean{
  const base=String(provider.baseUrl||'');
  return provider.id==='ollama'||/(^|\/\/)(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)/i.test(base)||/(^|\.)ollama\b/i.test(base);
}
export function aiConfigProblem(provider:Provider,model:string):string{
  const name=String(provider.name||provider.id||'ارائه‌دهنده');
  if(!String(provider.baseUrl||'').trim())return `آدرس سرویس (Base URL) برای «${name}» تنظیم نشده است.`;
  if(!String(model||'').trim())return `برای «${name}» هیچ مدلی انتخاب نشده است.`;
  if(!String(provider.apiKey||'').trim()&&!isKeylessAiProvider(provider))return `کلید API برای «${name}» وارد نشده است؛ در بخش ارائه‌دهنده‌ها کلید را ثبت کنید.`;
  return '';
}
/**
 * Active API keys of a provider (fallback to the single apiKey). Mirrors the
 * Worker's providerKeys(); only the entry shape differs (Node stores plain
 * `{token|key}` objects, never Cloudflare account keys).
 */
export function providerKeys(provider:Provider):string[]{
  const keys=Array.isArray(provider.apiKeys)&&provider.apiKeys.length?provider.apiKeys:(provider.apiKey?[provider.apiKey]:[]);
  return keys.map(k=>typeof k==='string'?String(k).trim():String((k as any)?.token||(k as any)?.key||'').trim()).filter(Boolean);
}
/** Clone of the provider bound to the n-th key (falls back to the first key). */
export function providerWithKey(provider:Provider,index=0):Provider{
  const keys=Array.isArray(provider.apiKeys)&&provider.apiKeys.length?provider.apiKeys:(provider.apiKey?[provider.apiKey]:[]);
  const chosen=keys[index]??keys[0]??(provider.apiKey||'');
  const token=typeof chosen==='string'?chosen:String((chosen as any)?.token||(chosen as any)?.key||'');
  return{...provider,apiKey:token||provider.apiKey};
}

export async function aiCall(provider:Provider,model:string,prompt:string,maxTokens=200){const ai=(await loadConnections()).ai;{const problem=aiConfigProblem(provider,model);if(problem)throw Error(problem);}const endpoint=provider.baseUrl+(provider.baseUrl.includes('/chat/completions')?'':'/chat/completions'),started=Date.now();const response=await networkFetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${provider.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],max_tokens:Math.max(1,Number(maxTokens)||200),temperature:.2})},ai.network);const body=await response.json().catch(()=>null) as any;if(!response.ok)throw Error(`HTTP ${response.status}: ${body?.error?.message||body?.message||'AI error'}`);const text=body?.choices?.[0]?.message?.content||body?.result?.response||body?.response||'';return{ok:true,text:String(text),latencyMs:Date.now()-started,provider:provider.id,model}}
export async function testAllModels(prompt='سلام',onlyCandidates=false){const ai=(await loadConnections()).ai,providers=await aiProviders(),wanted=new Set(ai.candidates),tasks=providers.filter(p=>p.enabled).flatMap(p=>p.models.map(model=>({p,model,key:`${p.id}::${model}`}))).filter(x=>!onlyCandidates||wanted.has(x.key));const results:any[]=[];let cursor=0;await Promise.all(Array.from({length:Math.min(3,tasks.length)},async()=>{while(cursor<tasks.length){const task=tasks[cursor++];try{results.push({...await aiCall(task.p,task.model,prompt),key:task.key})}catch(error){results.push({ok:false,key:task.key,provider:task.p.id,model:task.model,error:error instanceof Error?error.message:String(error)})}}}));await setState('ai_test_results',{at:new Date().toISOString(),runId:randomUUID(),prompt,categoryTitle:'',onlyCandidates,results});return results}
/**
 * Server-side AI test run for the Node runtime.
 *
 * The dashboard is shared with the Worker, which runs model tests as a
 * background "run" and polls /api/ai/test-runs/current for progress. The Node
 * build had no such consumer: it ran every model inside one HTTP request and
 * the poll endpoint always answered run:null, so the UI sat on "queued" (در صف
 * سرور) forever and never showed a single model -- even though the models were
 * in fact being called. This gives Node the same run object, driven by a plain
 * in-process async loop instead of a Cloudflare queue.
 */
export type AiTestRunState = {
  id:string; kind:'ai-test'; status:'queued'|'running'|'done'|'failed'|'paused'; phase:string;
  stopRequested:boolean; createdAt:string; updatedAt:string; startedAt:string|null; finishedAt:string|null;
  attempts:number; error:string|null; prompt:string; categoryTitle:string; onlyCandidates:boolean; delayMs:number;
  cursor:number; currentStartedAt:string|null;
  result:{ runId:string; total:number; nextCursor:number; results:any[] };
};

const AI_RUN_KEY='ai_test_run';
let aiRun:AiTestRunState|null=null;
let aiRunTask:Promise<void>|null=null;

const nowIso=()=>new Date().toISOString();
const sleepMs=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

async function persistAiRun(){ if(aiRun) { aiRun.updatedAt=nowIso(); try{ await setState(AI_RUN_KEY,aiRun);}catch{/* keep serving from memory */} } }

export async function getCurrentAiRun():Promise<AiTestRunState|null>{
  if(aiRun) return aiRun;
  try{ const stored=await getState<AiTestRunState|null>(AI_RUN_KEY,null); if(stored&&stored.id){ aiRun=stored; return aiRun; } }catch{/* nothing stored yet */}
  return null;
}

/** Start a run, or return the live one so a double click cannot fork two runs. */
export async function startAiTestRun(input:{prompt?:string;categoryTitle?:string;onlyCandidates?:boolean;delayMs?:number}):Promise<{run:AiTestRunState;existing:boolean}>{
  const current=await getCurrentAiRun();
  if(current&&(current.status==='queued'||current.status==='running')) return {run:current,existing:true};
  const id=randomUUID(),timestamp=nowIso();
  const ai=(await loadConnections()).ai,providers=await aiProviders(),wanted=new Set(ai.candidates);
  const onlyCandidates=Boolean(input?.onlyCandidates);
  const tasks=providers.filter(p=>p.enabled).flatMap(p=>p.models.map(model=>({p,model,key:`${p.id}::${model}`}))).filter(x=>!onlyCandidates||wanted.has(x.key));
  aiRun={ id,kind:'ai-test',status:'queued',phase:'waiting',stopRequested:false,createdAt:timestamp,updatedAt:timestamp,
    startedAt:null,finishedAt:null,attempts:0,error:null,
    prompt:String(input?.prompt||'Reply with exactly: SCRAPER4_OK'),categoryTitle:String(input?.categoryTitle||'').trim(),
    onlyCandidates,delayMs:Math.max(0,Math.min(60_000,Number(input?.delayMs)||0)),cursor:0,currentStartedAt:null,
    result:{runId:id,total:tasks.length,nextCursor:0,results:[]} };
  await persistAiRun();
  // Deliberately not awaited: the HTTP response returns immediately so the UI
  // can start polling, exactly like the Worker's queue-backed behaviour.
  aiRunTask=runAiTests(tasks).catch(async error=>{
    if(aiRun){ aiRun.status='failed'; aiRun.error=error instanceof Error?error.message:String(error); aiRun.finishedAt=nowIso(); await persistAiRun(); }
  });
  return {run:aiRun,existing:false};
}

/**
 * After every finished model test, green-light models become candidates — unless
 * the user turned the `ai.autoCandidates` setting off. Additive only: models the
 * user removed by hand are never resurrected, and red models never join.
 */
async function autoAddGreenTestCandidates(results:any):Promise<string[]>{
  const settings=await getState<any>('settings',{});
  if(settings?.ai?.autoCandidates===false)return [];
  const vault=await loadConnections(),keys=greenTestedCandidateKeys(results,vault.ai.providers||[]),have=new Set((vault.ai.candidates||[]).map(String)),fresh=keys.filter(key=>!have.has(key));
  if(!fresh.length)return [];
  await saveConnections({ai:{...vault.ai,candidates:[...(vault.ai.candidates||[]).map(String),...fresh]}});
  return fresh;
}
async function runAiTests(tasks:Array<{p:Provider;model:string;key:string}>):Promise<void>{
  if(!aiRun) return;
  aiRun.status='running'; aiRun.phase='testing'; aiRun.startedAt=nowIso(); await persistAiRun();
  for(let index=0;index<tasks.length;index++){
    if(!aiRun) return;
    if(aiRun.stopRequested){ aiRun.status='paused'; aiRun.phase='stopped'; await persistAiRun(); return; }
    const task=tasks[index];
    aiRun.cursor=aiRun.result.results.length; aiRun.currentStartedAt=nowIso();
    aiRun.phase=`testing ${task.p.id}::${task.model}`;
    await persistAiRun();
    try{ aiRun.result.results.push({...await aiCall(task.p,task.model,aiRun.prompt),key:task.key}); }
    catch(error){ aiRun.result.results.push({ok:false,key:task.key,provider:task.p.id,model:task.model,error:error instanceof Error?error.message:String(error)}); }
    aiRun.result.nextCursor=aiRun.result.results.length;
    await persistAiRun();
    if(aiRun.delayMs&&index<tasks.length-1) await sleepMs(aiRun.delayMs);
  }
  if(!aiRun) return;
  aiRun.status='done'; aiRun.phase='finished'; aiRun.currentStartedAt=null; aiRun.finishedAt=nowIso();
  try{ (aiRun.result as any).autoCandidatesAdded=await autoAddGreenTestCandidates(aiRun.result.results); }catch{ (aiRun.result as any).autoCandidatesAdded=[]; }
  await persistAiRun();
  try{ await setState('ai_test_results',{at:nowIso(),runId:aiRun.id,prompt:aiRun.prompt,categoryTitle:aiRun.categoryTitle,onlyCandidates:aiRun.onlyCandidates,results:aiRun.result.results}); }catch{/* results still live on the run */}
}

export async function controlAiTestRun(action:string):Promise<AiTestRunState|null>{
  const run=await getCurrentAiRun(); if(!run) return null;
  if(action==='stop'){ run.stopRequested=true; }
  else if(action==='resume'&&run.status==='paused'){
    run.stopRequested=false;
    const ai=(await loadConnections()).ai,providers=await aiProviders(),wanted=new Set(ai.candidates);
    const all=providers.filter(p=>p.enabled).flatMap(p=>p.models.map(model=>({p,model,key:`${p.id}::${model}`}))).filter(x=>!run.onlyCandidates||wanted.has(x.key));
    const done=new Set(run.result.results.map((r:any)=>r.key));
    aiRun=run; aiRunTask=runAiTests(all.filter(t=>!done.has(t.key))).catch(()=>{});
  }
  await persistAiRun();
  return run;
}

export async function resetAiTestRun():Promise<void>{
  if(aiRun) aiRun.stopRequested=true;
  aiRun=null; aiRunTask=null;
  try{ await setState(AI_RUN_KEY,null); }catch{/* nothing to clear */}
}

/**
 * Re-runs one model's failed part of the last server-side test. Mirrors the
 * Worker's retryAiTestPart(): the stored prompt/category title are reused so
 * the retry tests exactly what the run tested, the live run row is patched
 * too, and the full results array is returned for the dashboard table.
 */
export async function retryAiTestPart(key:string,part:string):Promise<{runId:string;results:any[];autoCandidatesAdded?:string[]}>{
  const modelKey=String(key||'').trim();
  if(!modelKey)throw new Error('کلید مدل خالی است.');
  if(part!=='message'&&part!=='category')throw new Error('بخش نامعتبر است.');
  const stored=await getState<any>('ai_test_results',null),results=Array.isArray(stored?.results)?[...stored.results]:[];
  const index=results.findIndex((row:any)=>String(row?.key||'')===modelKey||`${row?.provider}::${row?.model}`===modelKey);
  if(index<0)throw new Error('این مدل در آخرین نتیجهٔ تست پیدا نشد؛ ابتدا تست مدل‌ها را اجرا کنید.');
  const row=results[index],providers=await aiProviders();
  const provider=providers.find(p=>p.id===row.provider&&p.enabled!==false)||providers.find(p=>p.id===row.provider);
  if(!provider)throw new Error('ارائه‌دهنده پیدا نشد.');
  if(part==='message'){
    const prompt=String(stored?.prompt||'Reply with exactly: SCRAPER4_OK');
    try{results[index]={...await aiCall(provider,row.model,prompt),key:String(row.key||modelKey)}}
    catch(error){results[index]={ok:false,key:String(row.key||modelKey),provider:provider.id,model:row.model,error:error instanceof Error?error.message:String(error)}}
  }else{
    const categoryTitle=String(stored?.categoryTitle||'').trim();
    if(!categoryTitle)throw new Error('عنوان دسته‌بندی در آخرین تست ذخیره نشده است؛ تست را با عنوان دسته تکرار کنید.');
    const categories=(await destinationCategories()).items;
    results[index]={...row,categoryResult:await suggestCategoryWithModel(categoryTitle,`${provider.id}::${row.model}`,categories)};
  }
  const live=await getCurrentAiRun();
  if(live){const at=live.result.results.findIndex((r:any)=>String(r?.key||'')===modelKey||`${r?.provider}::${r?.model}`===modelKey);if(at>=0){live.result.results[at]=results[index];await persistAiRun()}}
  await setState('ai_test_results',{...(stored||{}),at:nowIso(),results});
  let autoCandidatesAdded:string[]=[];try{autoCandidatesAdded=await autoAddGreenTestCandidates(results)}catch{/* stored results already updated */}
  return{runId:String(stored?.runId||live?.id||randomUUID()),results,autoCandidatesAdded};
}

export async function recordVote(task:string,winner:string,candidates:string[]){const votes=await getState<any>('ai_votes',{scores:{},history:[]});for(const key of candidates){votes.scores[key]??={wins:0,tests:0};votes.scores[key].tests++;if(key===winner)votes.scores[key].wins++}votes.history.push({at:new Date().toISOString(),task,winner,candidates});votes.history=votes.history.slice(-1000);await setState('ai_votes',votes);return leaderboard(votes)}
export async function getLeaderboard(){return leaderboard(await getState<any>('ai_votes',{scores:{},history:[]}))}
function leaderboard(votes:any){return Object.entries(votes.scores||{}).map(([key,v]:any)=>({key,wins:v.wins||0,tests:v.tests||0,score:v.tests?Math.round(v.wins/v.tests*1000)/10:0})).sort((a,b)=>b.score-a.score||b.wins-a.wins)}
async function networkFetch(url:string,init:RequestInit,net:Network):Promise<Response>{await assertPublicUrl(url);if(net.mode==='worker'&&net.workerUrl){const target=viaWorkerUrl(net.workerUrl,url);return safeFetch(target,{...init,directRoute:true},3_000_000)}if(net.mode==='proxy'&&net.proxyUrl){return undiciFetch(url,{...(init as any),dispatcher:new ProxyAgent(net.proxyUrl)}) as unknown as Response}if((net.mode==='dns'||net.mode==='doh')&&(net.resolveIp||net.dohUrl)){const host=new URL(url).hostname,ip=net.resolveIp||await doh(host,net.dohUrl);if(privateIp(ip))throw Error('IP خصوصی برای اتصال دستی/DoH مجاز نیست');const dispatcher=new Agent({connect:{lookup(_host:any,_opts:any,callback:any){callback(null,[{address:ip,family:ip.includes(':')?6:4}])}} as any});return undiciFetch(url,{...(init as any),dispatcher}) as unknown as Response}return safeFetch(url,init,3_000_000)}
async function doh(host:string,url:string){const endpoint=url+(url.includes('?')?'&':'?')+'name='+encodeURIComponent(host)+'&type=A',r=await safeFetch(endpoint,{headers:{accept:'application/dns-json'}},500_000),j=await r.json() as any,ip=(j.Answer||[]).find((x:any)=>x.type===1)?.data;if(!ip)throw Error('DoH پاسخی برای دامنه نداد');return String(ip)}

/**
 * Real AI connectivity diagnostic.
 *
 * The dashboard's AI "عیب‌یابی" button used to call /api/debug, which reports
 * installation health (database, tables, browsers) and never touches the AI
 * settings at all -- so it always answered "ok" even when every model test was
 * failing. It also could not see the indirect-connection setting: a Worker/proxy
 * URL is applied to model calls but was not exercised by any test, so a broken
 * proxy stayed invisible. This checks the path the model calls actually take.
 */
export async function aiConnectionDiagnostic() {
  const started = Date.now(), checks: any[] = [], recommendations: string[] = [];
  const add = (name: string, ok: boolean, detail: string, data?: any) => checks.push({ name, ok, detail, ...(data === undefined ? {} : { data }) });
  const ai = (await loadConnections()).ai;
  const net: any = ai.network || {};
  const mode = String(net.mode || 'direct');

  const providers = await aiProviders();
  const enabled = providers.filter((p: any) => p.enabled);
  const models = enabled.flatMap((p: any) => (p.models || []).map((m: string) => `${p.id}::${m}`));
  add('providers', enabled.length > 0,
    enabled.length ? `${enabled.length} ارائه‌دهندهٔ فعال با ${models.length} مدل.` : 'هیچ ارائه‌دهندهٔ فعالی وجود ندارد؛ تست مدل‌ها چیزی برای اجرا ندارد.',
    { enabled: enabled.map((p: any) => p.id), models: models.length });
  if (!enabled.length) recommendations.push('در بخش ارائه‌دهنده‌ها حداقل یک ارائه‌دهنده را فعال کنید.');

  const missingKey = enabled.filter((p: any) => !String(p.apiKey || '').trim() && !isKeylessAiProvider(p));
  add('api-keys', missingKey.length === 0,
    missingKey.length ? `${missingKey.length} ارائه‌دهندهٔ فعال کلید API ندارند: ${missingKey.map((p: any) => p.id).join(', ')}` : 'همهٔ ارائه‌دهنده‌های فعال کلید دارند یا بدون‌کلید هستند.',
    { missing: missingKey.map((p: any) => p.id) });
  if (missingKey.length) recommendations.push('برای ارائه‌دهنده‌های بدون کلید، کلید API را ثبت کنید یا آن‌ها را غیرفعال کنید.');

  add('connection-mode', true, mode === 'direct'
    ? 'روش اتصال: مستقیم. درخواست‌های مدل‌ها مستقیم به ارائه‌دهنده می‌روند.'
    : `روش اتصال: ${mode}. همهٔ درخواست‌های مدل‌ها از این مسیر عبور می‌کنند.`, { mode, workerUrl: net.workerUrl || null, proxyUrl: net.proxyUrl ? 'set' : null });

  // The indirect path is the thing that silently breaks model tests, so probe it
  // exactly the way aiCall() would build the request.
  const probeTarget = 'https://api.openai.com/v1/models';
  if (mode === 'worker' && net.workerUrl) {
    const target = viaWorkerUrl(String(net.workerUrl), probeTarget);
    try {
      const response = await safeFetch(target, { headers: { accept: 'application/json' }, directRoute: true }, 2_000_000);
      const text = (await response.text().catch(() => '')).slice(0, 400);
      // A forwarding proxy reaches the provider, which then complains about the
      // missing key. That is a HEALTHY proxy: it proves the hop works.
      const forwarded = /authenticat|api key|bearer|unauthorized/i.test(text) || response.ok;
      add('worker-proxy', forwarded,
        forwarded
          ? `Worker واسط درخواست را به مقصد رساند (کد ${response.status}). مسیر غیرمستقیم سالم است.`
          : `Worker واسط پاسخ داد ولی درخواست را به مقصد نرساند (کد ${response.status}).`,
        { target, status: response.status, sample: text });
      if (!forwarded) {
        // Cloudflare error 1042 is emitted by the EDGE, before the proxy Worker
        // runs: a Worker may not fetch another Worker on the same account unless
        // the global_fetch_strictly_public compatibility flag is set on both.
        // Without naming it, this looks like a broken proxy and is unfixable.
        if (/error code:\s*1042/i.test(text) || response.status === 1042) {
          // 1042 means Cloudflare saw a Worker fetching a Worker on the same
          // zone. From this Node runtime that can only happen if the target URL
          // is ALREADY a proxy URL, i.e. it got wrapped twice and the proxy was
          // asked to fetch itself. That double-wrap is fixed (directRoute), so
          // if it still appears the saved Worker address is itself a proxy link.
          recommendations.push('خطای ۱۰۴۲ کلودفلر یعنی پراکسی در نهایت خودش را صدا زده است. مطمئن شوید در فیلد «آدرس Worker» فقط آدرس سادهٔ پراکسی باشد (مثل https://proxy.example.workers.dev/) و خودش شامل ?url= نباشد.');
          recommendations.push('اگر آدرس درست است، این نسخه اشکال «دوبار بسته‌بندی شدن آدرس» را رفع کرده؛ کافی است به‌روزرسانی کنید و دوباره تست بگیرید.');
        } else {
          recommendations.push('Worker واسط باید پارامتر url را بگیرد و متد، هدرها (به‌ویژه authorization) و بدنهٔ درخواست را بدون تغییر ارسال کند.');
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      add('worker-proxy', false, `Worker واسط در دسترس نیست: ${detail}`, { target });
      recommendations.push('آدرس Worker واسط را بررسی کنید؛ اگر مستقر نیست روش اتصال را روی «مستقیم» بگذارید تا تست مدل‌ها کار کند.');
    }
  } else if (mode === 'proxy' && net.proxyUrl) {
    // Previously this only printed a message, so a dead or mistyped proxy still
    // looked "healthy" here while every real request failed. Probe it for real.
    try {
      const response = await networkFetch(probeTarget, { method: 'GET', headers: { accept: 'application/json' } }, net);
      const text = (await response.text().catch(() => '')).slice(0, 400);
      const forwarded = /authenticat|api key|bearer|unauthorized/i.test(text) || response.ok;
      add('proxy', forwarded,
        forwarded
          ? `پروکسی درخواست را به مقصد رساند (کد ${response.status}). مسیر غیرمستقیم سالم است.`
          : `پروکسی پاسخ داد ولی درخواست را به مقصد نرساند (کد ${response.status}).`,
        { proxy: 'set', status: response.status, sample: text });
      if (!forwarded) recommendations.push('پروکسی باید درخواست HTTPS را بدون تغییر عبور دهد؛ آدرس و پورت را بررسی کنید.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      add('proxy', false, `پروکسی در دسترس نیست: ${detail}`, { proxy: 'set' });
      recommendations.push('آدرس پروکسی را بررسی کنید (قالب درست: http://host:port). اگر کار نمی‌کند روش اتصال را روی «مستقیم» یا «Worker» بگذارید.');
    }
  }

  // One real end-to-end model call through the very same path aiCall() uses.
  const first = enabled[0];
  if (first && (first.models || []).length) {
    const model = first.models[0];
    try {
      const result = await aiCall(first, model, 'Reply with exactly: SCRAPER4_OK');
      add('live-call', true, `تماس واقعی با ${first.id}::${model} موفق بود (${result.latencyMs} میلی‌ثانیه).`, { provider: first.id, model, reply: String(result.text || '').slice(0, 120) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      add('live-call', false, `تماس واقعی با ${first.id}::${model} شکست خورد: ${detail}`, { provider: first.id, model });
      recommendations.push(mode === 'direct'
        ? 'کلید API، آدرس پایه و نام مدل را بررسی کنید.'
        : 'چون روش اتصال غیرمستقیم است، ابتدا سالم‌بودن Worker/پروکسی را بررسی کنید؛ همین خطا در تست مدل‌ها هم تکرار می‌شود.');
    }
  }

  const failed = checks.filter(check => !check.ok);
  return { ok: failed.length === 0, target: 'ai', mode, durationMs: Date.now() - started, checks, recommendations, summary: { passed: checks.length - failed.length, failed: failed.length } };
}

/**
 * Resolve the model the user pinned as "master" (ai.master), falling back to
 * ai.model, then the candidate list, then any enabled chat model. Mirrors the
 * Worker's preferredAiChatModel() so both runtimes pick the same model.
 */
export async function preferredAiChatModel(): Promise<{ provider: Provider; model: string } | null> {
  const ai = (await loadConnections()).ai as any;
  const providers = (await aiProviders()).filter(provider => provider.enabled !== false);
  const preferred = [ai.master, ai.model, ...(Array.isArray(ai.candidates) ? ai.candidates : [])].map(String).filter(Boolean);
  for (const key of preferred) {
    const [providerId, ...parts] = key.split('::');
    const model = parts.length ? parts.join('::') : key;
    const provider = parts.length ? providers.find(item => item.id === providerId) : providers.find(item => item.models.includes(model));
    if (provider && provider.models.includes(model) && !aiConfigProblem(provider, model)) return { provider, model };
  }
  for (const provider of providers) {
    const model = provider.models.find(item => !aiConfigProblem(provider, item));
    if (model) return { provider, model };
  }
  return null;
}

/** A product needs enrichment when the scraper could not fill these in. */
export function productNeedsEnrichment(product: any): { longDesc: boolean; shortDesc: boolean; images: boolean; variations: boolean; any: boolean } {
  const text = (value: unknown) => String(value ?? '').trim();
  const longDesc = text(product?.longDesc).length < 40;
  const shortDesc = text(product?.shortDesc).length < 10;
  const images = !Array.isArray(product?.images) || product.images.filter((x: unknown) => text(x)).length < 2;
  const variations = !Array.isArray(product?.variations) || product.variations.length === 0;
  return { longDesc, shortDesc, images, variations, any: longDesc || shortDesc || variations };
}

function firstJsonObject(text: string): any {
  const raw = String(text || '').replace(/```json/gi, '```').replace(/```/g, '');
  const start = raw.indexOf('{');
  if (start < 0) return null;
  for (let end = raw.lastIndexOf('}'); end > start; end = raw.lastIndexOf('}', end - 1)) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* keep shrinking */ }
  }
  return null;
}

export type DescriptionResult = {
  ok: boolean;
  changed: boolean;
  fields: string[];
  model?: string;
  provider?: string;
  error?: string;
};

/**
 * Fill missing description / gallery / variation data for ONE product using the
 * master AI model. Only empty fields are written: a real value scraped from the
 * source site is never overwritten by generated text.
 */
export async function generateProductDescription(product: any, options: { force?: boolean } = {}): Promise<DescriptionResult> {
  const need = productNeedsEnrichment(product);
  if (!options.force && !need.any) return { ok: true, changed: false, fields: [] };
  const picked = await preferredAiChatModel();
  if (!picked) return { ok: false, changed: false, fields: [], error: 'هیچ مدل هوش مصنوعی فعالی برای تولید توضیحات پیدا نشد.' };

  const context = [
    `نام محصول: ${String(product?.title || '').trim()}`,
    product?.brand ? `برند: ${product.brand}` : '',
    product?.category ? `دسته‌بندی: ${product.category}` : '',
    product?.priceText ? `قیمت: ${product.priceText}` : '',
    product?.sku ? `کد کالا: ${product.sku}` : '',
    String(product?.shortDesc || '').trim() ? `توضیح کوتاه موجود: ${product.shortDesc}` : ''
  ].filter(Boolean).join('\n');

  const prompt = `تو یک کارشناس تولید محتوای فروشگاهی فارسی هستی. بر اساس اطلاعات زیر، محتوای فروشگاهی بنویس.
${context}

فقط و فقط یک شیء JSON معتبر برگردان، بدون هیچ متن اضافه و بدون بلوک کد، دقیقاً با این کلیدها:
{"shortDesc":"یک جملهٔ کوتاه جذاب","longDesc":"<p>توضیح کامل در دو تا سه پاراگراف HTML ساده</p>","variations":["تنوع ۱","تنوع ۲"]}

قوانین: همه‌چیز فارسی و روان باشد. اگر تنوع مشخصی از نام محصول قابل استنباط نیست، آرایهٔ variations را خالی بگذار. هیچ ادعای نادرست یا مشخصات فنی ساختگی ننویس.`;

  try {
    const answer = await aiCall(picked.provider, picked.model, prompt, 900);
    const parsed = firstJsonObject(answer.text);
    if (!parsed) return { ok: false, changed: false, fields: [], provider: picked.provider.id, model: picked.model, error: 'پاسخ مدل قابل تبدیل به JSON نبود.' };
    const fields: string[] = [];
    const clean = (value: unknown) => String(value ?? '').trim();
    if ((options.force || need.shortDesc) && clean(parsed.shortDesc)) { product.shortDesc = clean(parsed.shortDesc); fields.push('shortDesc'); }
    if ((options.force || need.longDesc) && clean(parsed.longDesc)) { product.longDesc = clean(parsed.longDesc); fields.push('longDesc'); }
    if ((options.force || need.variations) && Array.isArray(parsed.variations)) {
      const list = parsed.variations.map(clean).filter(Boolean).slice(0, 20);
      if (list.length) { product.variations = list; fields.push('variations'); }
    }
    // The gallery is never invented: images must come from the source site.
    if (need.images && Array.isArray(product?.images) && product.image && !product.images.includes(product.image)) {
      product.images = [product.image, ...product.images];
    }
    product.aiEnrichedAt = new Date().toISOString();
    return { ok: true, changed: fields.length > 0, fields, provider: picked.provider.id, model: picked.model };
  } catch (error) {
    return { ok: false, changed: false, fields: [], provider: picked.provider.id, model: picked.model, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Asks one configured model for a Basalam category id. Mirrors the Worker's
 * suggestCategoryWithModel(): the prompt builder and id parser are the shared
 * worker-src/destination-core.ts, only the HTTP call below is Node-specific.
 * Always resolves (never throws on model errors) so bulk voting can continue
 * with the remaining models; only a missing title or unknown modelKey throws.
 */
export async function suggestCategoryWithModel(title:string,modelKey:string,categories:AiCategoryOption[]){
  const providers=await aiProviders(),[providerId,...modelParts]=String(modelKey||'').split('::'),model=modelParts.join('::'),provider=providers.find(item=>item.id===providerId&&item.enabled!==false&&item.models.includes(model));
  if(!String(title||'').trim())throw new Error('عنوان محصول برای دسته‌بندی لازم است.');
  if(!provider||!model)throw new Error('مدل انتخاب‌شده در تنظیمات فعال هوش مصنوعی پیدا نشد.');
  const key=`${provider.id}::${model}`,categoryTitle=String(title).trim();
  try{
    const prepared=categoryPrompt(categoryTitle,categories),detail=await aiCall(provider,model,prepared.prompt),categoryId=parseCategoryId(detail.text,prepared.allowed),category=prepared.allowed.find(row=>Number(row.id)===categoryId);
    if(!category)return{ok:false,key,provider:provider.id,model,categoryTitle,categoryId:0,allowedCategoryCount:prepared.allowed.length,text:detail.text,latencyMs:detail.latencyMs,error:'مدل هیچ شناسهٔ معتبر از فهرست دسته‌بندی باسلام برنگرداند.'};
    return{ok:true,key,provider:provider.id,model,text:detail.text,latencyMs:detail.latencyMs,categoryTitle,categoryId,categoryName:String(category.name),categoryPath:String(category.path||category.name),allowedCategoryCount:prepared.allowed.length};
  }catch(error){return{ok:false,key,provider:provider.id,model,categoryTitle,error:error instanceof Error?error.message:String(error)}}
}
