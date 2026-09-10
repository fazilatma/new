import { randomUUID } from 'node:crypto';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { assertPublicUrl, privateIp, safeFetch } from './network.js';
import { loadConnections } from './connections.js';
import { getState, setState } from './db.js';

type Provider={id:string;name:string;baseUrl:string;apiKey:string;models:string[];enabled:boolean};
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

export async function aiCall(provider:Provider,model:string,prompt:string){const ai=(await loadConnections()).ai;{const problem=aiConfigProblem(provider,model);if(problem)throw Error(problem);}const endpoint=provider.baseUrl+(provider.baseUrl.includes('/chat/completions')?'':'/chat/completions'),started=Date.now();const response=await networkFetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${provider.apiKey}`,'content-type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],max_tokens:200,temperature:.2})},ai.network);const body=await response.json().catch(()=>null) as any;if(!response.ok)throw Error(`HTTP ${response.status}: ${body?.error?.message||body?.message||'AI error'}`);const text=body?.choices?.[0]?.message?.content||body?.result?.response||body?.response||'';return{ok:true,text:String(text),latencyMs:Date.now()-started,provider:provider.id,model}}
export async function testAllModels(prompt='سلام',onlyCandidates=false){const ai=(await loadConnections()).ai,providers=await aiProviders(),wanted=new Set(ai.candidates),tasks=providers.filter(p=>p.enabled).flatMap(p=>p.models.map(model=>({p,model,key:`${p.id}::${model}`}))).filter(x=>!onlyCandidates||wanted.has(x.key));const results:any[]=[];let cursor=0;await Promise.all(Array.from({length:Math.min(3,tasks.length)},async()=>{while(cursor<tasks.length){const task=tasks[cursor++];try{results.push({...await aiCall(task.p,task.model,prompt),key:task.key})}catch(error){results.push({ok:false,key:task.key,provider:task.p.id,model:task.model,error:error instanceof Error?error.message:String(error)})}}}));await setState('ai_test_results',{at:new Date().toISOString(),results});return results}
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
  await persistAiRun();
  try{ await setState('ai_test_results',{at:nowIso(),results:aiRun.result.results}); }catch{/* results still live on the run */}
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

export async function recordVote(task:string,winner:string,candidates:string[]){const votes=await getState<any>('ai_votes',{scores:{},history:[]});for(const key of candidates){votes.scores[key]??={wins:0,tests:0};votes.scores[key].tests++;if(key===winner)votes.scores[key].wins++}votes.history.push({at:new Date().toISOString(),task,winner,candidates});votes.history=votes.history.slice(-1000);await setState('ai_votes',votes);return leaderboard(votes)}
export async function getLeaderboard(){return leaderboard(await getState<any>('ai_votes',{scores:{},history:[]}))}
function leaderboard(votes:any){return Object.entries(votes.scores||{}).map(([key,v]:any)=>({key,wins:v.wins||0,tests:v.tests||0,score:v.tests?Math.round(v.wins/v.tests*1000)/10:0})).sort((a,b)=>b.score-a.score||b.wins-a.wins)}
async function networkFetch(url:string,init:RequestInit,net:Network):Promise<Response>{await assertPublicUrl(url);if(net.mode==='worker'&&net.workerUrl){const target=net.workerUrl.includes('{url}')?net.workerUrl.replace('{url}',encodeURIComponent(url)):net.workerUrl+(net.workerUrl.includes('?')?'&':'?')+'url='+encodeURIComponent(url);return safeFetch(target,init,3_000_000)}if(net.mode==='proxy'&&net.proxyUrl){return undiciFetch(url,{...(init as any),dispatcher:new ProxyAgent(net.proxyUrl)}) as unknown as Response}if((net.mode==='dns'||net.mode==='doh')&&(net.resolveIp||net.dohUrl)){const host=new URL(url).hostname,ip=net.resolveIp||await doh(host,net.dohUrl);if(privateIp(ip))throw Error('IP خصوصی برای اتصال دستی/DoH مجاز نیست');const dispatcher=new Agent({connect:{lookup(_host:any,_opts:any,callback:any){callback(null,[{address:ip,family:ip.includes(':')?6:4}])}} as any});return undiciFetch(url,{...(init as any),dispatcher}) as unknown as Response}return safeFetch(url,init,3_000_000)}
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
  if (mode === 'worker' && net.workerUrl) {
    const probeTarget = 'https://api.openai.com/v1/models';
    const target = String(net.workerUrl).includes('{url}')
      ? String(net.workerUrl).replace('{url}', encodeURIComponent(probeTarget))
      : String(net.workerUrl) + (String(net.workerUrl).includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(probeTarget);
    try {
      const response = await safeFetch(target, { headers: { accept: 'application/json' } }, 2_000_000);
      const text = (await response.text().catch(() => '')).slice(0, 400);
      // A forwarding proxy reaches the provider, which then complains about the
      // missing key. That is a HEALTHY proxy: it proves the hop works.
      const forwarded = /authenticat|api key|bearer|unauthorized/i.test(text) || response.ok;
      add('worker-proxy', forwarded,
        forwarded
          ? `Worker واسط درخواست را به مقصد رساند (کد ${response.status}). مسیر غیرمستقیم سالم است.`
          : `Worker واسط پاسخ داد ولی درخواست را به مقصد نرساند (کد ${response.status}).`,
        { target, status: response.status, sample: text });
      if (!forwarded) recommendations.push('Worker واسط باید پارامتر url را بگیرد و متد، هدرها (به‌ویژه authorization) و بدنهٔ درخواست را بدون تغییر ارسال کند.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      add('worker-proxy', false, `Worker واسط در دسترس نیست: ${detail}`, { target });
      recommendations.push('آدرس Worker واسط را بررسی کنید؛ اگر مستقر نیست روش اتصال را روی «مستقیم» بگذارید تا تست مدل‌ها کار کند.');
    }
  } else if (mode === 'proxy' && net.proxyUrl) {
    add('proxy', true, 'حالت proxy انتخاب شده است؛ درخواست‌ها از این پروکسی عبور می‌کنند.', { proxy: 'set' });
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
