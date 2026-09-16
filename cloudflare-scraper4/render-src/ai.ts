import { randomUUID } from 'node:crypto';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { assertAiEndpointUrl, privateIp, safeFetch, viaWorkerUrl } from './network.js';
import {
  adjustChatPayload, aiKeySuffixLabel, aiModelEndpoint, canonicalAiModel, isChatCompatibleAiModel, isCreditAiStatus,
  isPayloadShapeError, isReasoningAiModel, openAiEndpoint, parseModelKeySuffix, providerKeys, providerWithKey,
} from '../worker-src/ai-model-capabilities.js';
import { loadConnections } from './connections.js';
import { getState, setState } from './db.js';
import { categoryPrompt, parseCategoryId } from '../worker-src/destination-core.js';
import type { AiCategoryOption } from '../worker-src/destination-core.js';

type CfAccountKey={accountId:string;token:string};
/**
 * Same shape as the Worker's Provider: `apiKeys` / `reasoningModels` / `nonChatModels`
 * come straight from the vault, and the shared capability helpers (which both twins now
 * use for chat compatibility, reasoning budgets and per-key selection) read them.
 */
type Provider={id:string;name:string;baseUrl:string;apiKey:string;apiKeys?:Array<string|CfAccountKey>;models:string[];reasoningModels?:string[];nonChatModels?:string[];enabled:boolean};
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
 * Builds the request for one AI call and enforces the caller's watchdog budget.
 *
 * `ai.skipTimeoutMs` (the «مهلت رد مدل گیرکرده» field) already gates the Worker's test
 * queue; on Node it was accepted and silently ignored, so one hung local model could
 * stall the whole pass. An abort is translated into an honest Persian message that says
 * what to raise instead of a bare TimeoutError.
 */
function aiRequestInit(provider:Provider,payload:any,timeoutMs?:number):RequestInit{
  const init:any={method:'POST',headers:{authorization:`Bearer ${provider.apiKey}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)};
  const budget=Math.round(Number(timeoutMs)||0);
  if(budget>0&&typeof (globalThis as any).AbortSignal?.timeout==='function')init.signal=(globalThis as any).AbortSignal.timeout(Math.max(1000,budget));
  return init;
}
function aiTimeoutError(error:unknown):Error{
  const name=error instanceof Error?error.name:'';
  if(name==='TimeoutError'||name==='AbortError')return Error(`مهلت پاسخ این مدل تمام شد؛ اگر مدل محلی یا استدلالی است، «مهلت رد مدل گیرکرده» را در بخش تست مدل‌ها زیاد کنید.`);
  return error instanceof Error?error:Error(String(error));
}
function isAiTimeout(error:unknown):boolean{const name=error instanceof Error?error.name:'';return name==='TimeoutError'||name==='AbortError'}

/**
 * One chat-completions call against any OpenAI-compatible provider.
 *
 * 1.175.0 parity with the Worker twin: the endpoint comes from the shared
 * `openAiEndpoint()` (it appends `/v1` for Ollama on :11434 — without it every local
 * model install got a 404), a `~model` preview prefix is canonicalised, reasoning
 * models get the bigger token budget, and a provider that rejects `temperature` or
 * `max_tokens` gets its payload rewritten and retried instead of failing the row.
 * The result also carries `providerName`, which the shared dashboard table shows.
 */
export async function aiCall(provider:Provider,model:string,prompt:string,maxTokens=200,networkOverride?:Network,timeoutMs?:number){
  const ai=(await loadConnections()).ai;{const problem=aiConfigProblem(provider,model);if(problem)throw Error(problem);}
  const network=networkOverride||ai.network,endpoint=openAiEndpoint(provider.baseUrl),reasoning=isReasoningAiModel(provider,model);
  const payload:any={model:canonicalAiModel(model),messages:[{role:'user',content:prompt}],max_tokens:Math.max(1,Number(maxTokens)||(reasoning?1600:200))};
  if(!reasoning)payload.temperature=.2;
  const started=Date.now();
  let used=payload,response:Response|null=null,body:any=null;
  for(let attempt=0;attempt<4;attempt++){
    let raw:Response;
    try{raw=await networkFetch(endpoint,aiRequestInit(provider,used,timeoutMs),network)}catch(error){throw isAiTimeout(error)?aiTimeoutError(error):error}
    response=raw;
    body=parseAiBody(await response.text().catch(()=>''));
    if(response.ok)break;
    const errorText=aiErrorText(body)||response.statusText||'AI error';
    if(!isPayloadShapeError(response.status,errorText)||isCreditAiStatus(response.status,errorText))break;
    const adapted=adjustChatPayload(used,errorText);if(!adapted)break;used=adapted;
  }
  const latencyMs=Date.now()-started;
  if(!response!.ok)throw Object.assign(Error(`HTTP ${response!.status}: ${aiErrorText(body)||response!.statusText||'AI error'}`),{detail:{ok:false,phase:'http',httpStatus:response!.status,endpoint:reportedEndpoint(endpoint),provider:provider.id,providerName:provider.name,model,prompt,latencyMs,raw:body}});
  const text=body?.choices?.[0]?.message?.content||body?.result?.response||body?.response||'';
  if(!String(text).trim())throw Object.assign(Error('مدل با وجود پاسخ HTTP موفق، هیچ متن یا پاسخ نهایی برنگرداند.'),{detail:{ok:false,phase:'validation',endpoint:reportedEndpoint(endpoint),provider:provider.id,providerName:provider.name,model,prompt,latencyMs,raw:body}});
  return{ok:true,text:String(text),latencyMs,provider:provider.id,providerName:provider.name,model:canonicalAiModel(model),endpoint:reportedEndpoint(endpoint),endpointType:'chat-completions',chatCompatible:isChatCompatibleAiModel(provider,model),reasoning,prompt}
}
function parseAiBody(rawText:string):any{try{return JSON.parse(rawText)}catch{return null}}
function aiErrorText(body:any):string{return String(body?.error?.message||body?.error||body?.message||body?.detail||'').slice(0,600)}
/** Never echo a key or a query string back through a diagnostic panel. */
function reportedEndpoint(endpoint:string):string{try{const url=new URL(endpoint);return `${url.protocol}//${url.host}${url.pathname}`}catch{return ''}}
export async function testAllModels(prompt='سلام',onlyCandidates=false){const ai=(await loadConnections()).ai,providers=await aiProviders(),wanted=new Set(ai.candidates),tasks=providers.filter(p=>p.enabled).flatMap(p=>p.models.map(model=>({p,model,key:`${p.id}::${model}`}))).filter(x=>!onlyCandidates||wanted.has(x.key));const results:any[]=[];let cursor=0;await Promise.all(Array.from({length:Math.min(3,tasks.length)},async()=>{while(cursor<tasks.length){const task=tasks[cursor++];try{results.push({...await aiCall(task.p,task.model,prompt),key:task.key})}catch(error){results.push({ok:false,key:task.key,provider:task.p.id,model:task.model,error:error instanceof Error?error.message:String(error)})}}}));await setState('ai_test_results',{at:new Date().toISOString(),results});return results}
/**
 * Chat with a full conversation history — the twin of the Worker's `aiChat`.
 *
 * The «چت با مدل‌ها» tab is shared by every environment, but the Node route used to
 * flatten the whole thread into one prompt string (`user: ...\nassistant: ...`), so the
 * model saw a transcript instead of a conversation, the last-turn rule was not enforced,
 * and a picker choice like `provider::model::k2` (the 2nd API key) silently used key 1.
 * This keeps the roles, honours the key suffix and answers with the same
 * `{ok,text,provider,providerName,model,latencyMs}` payload plus `AiResponseError`-style
 * `detail`, so the bubble footer and the error panel behave identically everywhere.
 */
export async function aiChatWithMessages(provider:Provider,rawModel:string,messages:any[],options:{maxTokens?:number;timeoutMs?:number;keyIndex?:number}={}){
  const parsed=parseModelKeySuffix(String(rawModel||'')),keyIndex=Number.isInteger(Number(options.keyIndex))&&Number(options.keyIndex)>=0?Number(options.keyIndex):parsed.keyIndex;
  const providerUsed=providerWithKey(provider,keyIndex) as Provider,model=String(parsed.model||'').trim();
  const chatMessages=(Array.isArray(messages)?messages:[]).slice(-40).map(m=>({role:String(m?.role||'user'),content:String(m?.content??'')})).filter(m=>m.content);
  if(!chatMessages.length||chatMessages[chatMessages.length-1].role!=='user')throw Error('آخرین پیام باید از سمت کاربر باشد.');
  {const problem=aiConfigProblem(providerUsed,model);if(problem)throw Error(problem);}
  const ai=(await loadConnections()).ai,reasoning=isReasoningAiModel(providerUsed,model),maxTokens=Math.max(64,Number(options.maxTokens)||1200);
  const endpoint=openAiEndpoint(providerUsed.baseUrl),payload:any={model:canonicalAiModel(model),messages:chatMessages,max_tokens:reasoning?maxTokens:Math.min(maxTokens,800)};
  if(!reasoning)payload.temperature=.7;
  const started=Date.now();
  let used=payload,response:Response|null=null,body:any=null;
  for(let attempt=0;attempt<4;attempt++){
    try{response=await networkFetch(endpoint,aiRequestInit(providerUsed,used,options.timeoutMs),ai.network)}catch(error){throw isAiTimeout(error)?aiTimeoutError(error):error}
    body=parseAiBody(await response.text().catch(()=>''));
    if(response.ok)break;
    const errorText=aiErrorText(body)||response.statusText||'AI error';
    if(!isPayloadShapeError(response.status,errorText)||isCreditAiStatus(response.status,errorText))break;
    const adapted=adjustChatPayload(used,errorText);if(!adapted)break;used=adapted;
  }
  const latencyMs=Date.now()-started,last=chatMessages[chatMessages.length-1].content;
  if(!response!.ok)throw Object.assign(Error(`HTTP ${response!.status}: ${aiErrorText(body)||response!.statusText||'AI error'}`),{detail:{ok:false,phase:'http',httpStatus:response!.status,provider:providerUsed.id,providerName:providerUsed.name,model,prompt:last,endpoint:reportedEndpoint(endpoint),latencyMs,raw:body}});
  const text=String(body?.choices?.[0]?.message?.content||body?.result?.response||'').trim();
  if(!text)throw Object.assign(Error('مدل پاسخی برنگرداند.'),{detail:{ok:false,phase:'validation',provider:providerUsed.id,providerName:providerUsed.name,model,prompt:last,endpoint:reportedEndpoint(endpoint),latencyMs,raw:body}});
  return{ok:true,text,provider:providerUsed.id,providerName:providerUsed.name,model:canonicalAiModel(model),latencyMs,keyIndex,keyLabel:aiKeySuffixLabel(keyIndex)};
}

/** Rows for the shared dashboard's model pickers (chat tab and the curated model list). */
export async function aiChatModelRowsFor():Promise<any[]>{
  const { AGENT_TOOL_MODELS } = await import('../worker-src/agent.js');
  const toolIds=new Set(AGENT_TOOL_MODELS.filter(m=>m.id!=='*configured').map(m=>m.id));
  const { aiChatModelRows } = await import('../worker-src/ai-model-capabilities.js');
  return aiChatModelRows(await aiProviders(),toolIds);
}

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
  /** Watchdog budget per model call (ms) — the same `ai.skipTimeoutMs` setting the Worker uses. */
  skipTimeoutMs?:number;
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

/**
 * Tasks for one test pass — the Node mirror of the Worker's `aiTestTasks`.
 *
 * Two rules matter for the shared dashboard: one task per provider *and* per API
 * key (models of the 2nd+ key get the visible `[K۲]` suffix), and the columns are
 * interleaved so a round never hits the same provider twice at once. Without the
 * key expansion, a Termux/VPS install with several OpenRouter keys tested one key
 * and the results table silently showed a third of the models.
 */
export type AiTestTask={p:Provider;model:string;key:string;keyIndex:number;keyLabel:string};
export function aiTestTasks(ai:any,providers:Provider[],onlyCandidates=false):AiTestTask[]{
  const wanted=new Set<string>(Array.isArray(ai?.candidates)?ai.candidates.map(String):[]),columns:AiTestTask[][]=[];
  for(const p of providers){
    if((p as any).enabled===false)continue;
    const column:AiTestTask[]=[],keyCount=Math.max(1,providerKeys(p).length);
    for(const rawModel of p.models||[]){
      const model=String(rawModel||'').trim();if(!model)continue;
      const primaryKey=`${p.id}::${model}`;
      if(onlyCandidates&&(!wanted.has(primaryKey)||!isChatCompatibleAiModel(p,model)))continue;
      for(let ki=0;ki<keyCount;ki++)column.push({p:providerWithKey(p,ki) as Provider,model,key:ki===0?primaryKey:`${p.id}::${model}::k${ki+1}`,keyIndex:ki,keyLabel:aiKeySuffixLabel(ki)});
    }
    if(column.length)columns.push(column);
  }
  const tasks:AiTestTask[]=[],max=columns.reduce((n,column)=>Math.max(n,column.length),0);
  for(let i=0;i<max;i++)for(const column of columns)if(column[i])tasks.push(column[i]);
  return tasks;
}

/**
 * Runs one model through both probes the dashboard's table shows: the plain
 * message answer and (when a category title is set) a real Basalam category
 * suggestion. The Worker already reported `categoryResult` per row; Node answered
 * with none, so the «دسته‌بندی: موفق / ناموفق» counters stayed at zero, the
 * category column was empty for every model, and the ensemble gate of the bulk
 * category correction had nothing to rank — on Termux and Linux servers only.
 */
async function runAiTestTask(task:AiTestTask,prompt:string,categoryTitle:string,categories:any[],timeoutMs?:number):Promise<any>{
  const base={key:task.key,keyIndex:task.keyIndex,keyLabel:task.keyLabel,provider:task.p.id,providerName:task.p.name,model:task.model};
  const configProblem=aiConfigProblem(task.p,task.model);
  if(configProblem)return{...base,ok:false,phase:'configuration',prompt,latencyMs:0,error:configProblem,raw:{reason:'config'},categoryTitle,categoryResult:categoryTitle?{ok:false,skipped:true,phase:'configuration',...base,error:configProblem}:null,catResponse:''};
  let message:any;
  try{message={...await aiCall(task.p,task.model,prompt,200,undefined,timeoutMs),key:task.key}}
  catch(error){message={ok:false,...base,prompt,latencyMs:0,error:error instanceof Error?error.message:String(error),raw:(error as any)?.detail?.raw??null,phase:(error as any)?.detail?.phase||'unknown'}}
  let categoryResult:any=null;
  if(!isChatCompatibleAiModel(task.p,task.model))categoryResult={ok:false,skipped:true,...base,phase:'unsupported-task',endpointType:aiModelEndpoint(task.p,task.model),chatCompatible:false,latencyMs:0,error:'این مدل endpoint اختصاصی دارد و برای دسته‌بندی گفت‌وگویی مناسب نیست.'};
  else if(!categoryTitle)categoryResult=null;
  else if(!categories.length)categoryResult={ok:false,...base,phase:'configuration',prompt:categoryTitle,latencyMs:0,error:'فهرست دسته‌بندی در دسترس نیست',raw:{reason:'no-categories'}};
  else try{
    const prepared=categoryPrompt(categoryTitle,categories),started=Date.now(),answer=await aiCall(task.p,task.model,prepared.prompt,200,undefined,timeoutMs),categoryId=parseCategoryId(answer.text,prepared.allowed),row=prepared.allowed.find((item:any)=>Number(item.id)===categoryId);
    categoryResult=row?{ok:true,...base,text:answer.text,latencyMs:Date.now()-started,categoryTitle,categoryId,categoryName:String(row.name),categoryPath:String(row.path||row.name),allowedCategoryCount:prepared.allowed.length}
      :{ok:false,...base,text:answer.text,latencyMs:Date.now()-started,categoryTitle,categoryId:0,allowedCategoryCount:prepared.allowed.length,error:'مدل هیچ شناسهٔ معتبر از فهرست دسته‌بندی باسلام برنگرداند.'};
  }catch(error){categoryResult={ok:false,...base,phase:'network',prompt:categoryTitle,latencyMs:0,error:error instanceof Error?error.message:String(error)}}
  const row:any={...base,...message,categoryTitle,categoryResult,catResponse:categoryResult&&!categoryResult.ok?String(categoryResult.error||''):''};
  row.retryable=!row.ok;
  return row;
}

const aiTestCounters=(stored:any,tasks:number,results:any[])=>{
  const messageSucceeded=results.filter(x=>x.ok).length,messageFailed=results.filter(x=>!x.ok).length;
  const attempted=Boolean(stored?.categoryTitle),categorySucceeded=attempted?results.filter(x=>x.categoryResult?.ok).length:0,categorySkipped=attempted?results.filter(x=>x.categoryResult?.skipped).length:0;
  return{ok:messageSucceeded>0,prompt:stored?.prompt||'',categoryTitle:stored?.categoryTitle||'',total:tasks,nextCursor:results.length,done:true,succeeded:messageSucceeded,failed:messageFailed,messageSucceeded,messageFailed,categorySucceeded,categoryFailed:attempted?Math.max(0,results.length-categorySucceeded-categorySkipped):0,categorySkipped,startedAt:stored?.at||null,updatedAt:stored?.at||null};
};

/** Loads the Basalam category list, tolerating a destination that is not configured. */
async function aiTestCategories():Promise<any[]>{
  try{const { destinationCategories } = await import('./maintenance.js');return (await destinationCategories()).items||[]}catch{return[]}
}

/** Start a run, or return the live one so a double click cannot fork two runs. */
export async function startAiTestRun(input:{prompt?:string;categoryTitle?:string;onlyCandidates?:boolean;delayMs?:number;skipTimeoutMs?:number}={}):Promise<{run:AiTestRunState;existing:boolean}>{
  const current=await getCurrentAiRun();
  if(current&&(current.status==='queued'||current.status==='running')) return {run:current,existing:true};
  const id=randomUUID(),timestamp=nowIso();
  const ai=(await loadConnections()).ai,providers=await aiProviders(),onlyCandidates=Boolean(input?.onlyCandidates);
  const tasks=aiTestTasks(ai,providers,onlyCandidates);
  aiRun={ id,kind:'ai-test',status:'queued',phase:'waiting',stopRequested:false,createdAt:timestamp,updatedAt:timestamp,
    startedAt:null,finishedAt:null,attempts:0,error:null,
    prompt:String(input?.prompt||'Reply with exactly: SCRAPER4_OK'),categoryTitle:String(input?.categoryTitle||'').trim(),
    onlyCandidates,delayMs:Math.max(0,Math.min(60_000,Number(input?.delayMs)||0)),skipTimeoutMs:Math.max(0,Number(input?.skipTimeoutMs)||0),
    cursor:0,currentStartedAt:null,
    result:{runId:id,total:tasks.length,nextCursor:0,results:[]} };
  await persistAiRun();
  // Deliberately not awaited: the HTTP response returns immediately so the UI
  // can start polling, exactly like the Worker's queue-backed behaviour.
  aiRunTask=runAiTests(tasks).catch(async error=>{
    if(aiRun){ aiRun.status='failed'; aiRun.error=error instanceof Error?error.message:String(error); aiRun.finishedAt=nowIso(); await persistAiRun(); }
  });
  return {run:aiRun,existing:false};
}

async function runAiTests(tasks:AiTestTask[],startIndex=0):Promise<void>{
  if(!aiRun) return;
  aiRun.status='running'; aiRun.phase='testing'; aiRun.startedAt||=nowIso(); await persistAiRun();
  const ai=(await loadConnections()).ai,timeoutMs=aiRun.skipTimeoutMs?Math.max(2000,aiRun.skipTimeoutMs):undefined;
  const categories=aiRun.categoryTitle?await aiTestCategories():[];
  for(let index=0;index<tasks.length;index++){
    if(!aiRun) return;
    if(aiRun.stopRequested){ aiRun.status='paused'; aiRun.phase='stopped'; await persistAiRun(); return; }
    const task=tasks[index];
    aiRun.cursor=index+startIndex; aiRun.currentStartedAt=nowIso();
    aiRun.phase=`testing ${task.p.id}::${task.model}${task.keyLabel}`;
    await persistAiRun();
    aiRun.result.results.push(await runAiTestTask(task,aiRun.prompt,aiRun.categoryTitle,categories,timeoutMs));
    aiRun.result.nextCursor=aiRun.result.results.length;
    aiRun.attempts=0;
    await persistAiRun();
    if(aiRun.delayMs&&index<tasks.length-1) await sleepMs(aiRun.delayMs);
  }
  if(!aiRun) return;
  aiRun.status='done'; aiRun.phase='finished'; aiRun.currentStartedAt=null; aiRun.finishedAt=nowIso();
  await persistAiRun();
  try{ await setState('ai_test_results',{at:nowIso(),runId:aiRun.id,prompt:aiRun.prompt,categoryTitle:aiRun.categoryTitle,onlyCandidates:aiRun.onlyCandidates,total:aiRun.result.total,results:aiRun.result.results}); }catch{/* results still live on the run */}
}

/**
 * Retries ONE part (message or category) of one model, mirroring the Worker's
 * `retryAiTestPart`. The dashboard's ↻ buttons per table row and per detail row
 * used to answer 501 on every Node install, so a model that timed out once could
 * only be re-proved by re-testing the whole list — hours on a Termux box.
 */
export async function retryAiTestPart(key:string,part:'message'|'category'='message'):Promise<any>{
  const retryKey=String(key||'').trim();
  if(!retryKey)throw Error('شناسه مدل برای تلاش مجدد لازم است.');
  const stored=await getState<any>('ai_test_results',null),results=Array.isArray(stored?.results)?[...stored.results]:[];
  if(!results.length)throw Error('نتیجهٔ ذخیره‌شده‌ای برای تلاش مجدد نیست؛ ابتدا تست مدل‌ها را اجرا کنید.');
  const ai=(await loadConnections()).ai,providers=await aiProviders(),task=aiTestTasks(ai,providers,false).find(item=>item.key===retryKey);
  if(!task)throw Error('مدل برای تلاش مجدد در ارائه‌دهنده‌های فعال پیدا نشد.');
  const existing=results.find((row:any)=>row.key===retryKey)||{key:retryKey},categoryTitle=String(stored.categoryTitle||'').trim();
  if(part==='message'){
    const row=await runAiTestTask({p:task.p,model:task.model,key:task.key,keyIndex:task.keyIndex,keyLabel:task.keyLabel},String(stored.prompt||'Reply with exactly: SCRAPER4_OK'),'',[],undefined);
    const merged={...existing,...row,categoryResult:existing.categoryResult??row.categoryResult,catResponse:existing.catResponse||row.catResponse||'',messageRetryCount:Number(existing.messageRetryCount||0)+1};
    replaceAiResult(results,merged);
  }else if(part==='category'){
    const categories=categoryTitle?await aiTestCategories():[];
    const row=await runAiTestTask(task,categoryTitle||String(stored.prompt||''),categoryTitle,categories,undefined);
    replaceAiResult(results,{...existing,categoryResult:row.categoryResult,catResponse:row.categoryResult&&!row.categoryResult.ok?String(row.categoryResult.error||''):'' ,categoryRetryCount:Number(existing.categoryRetryCount||0)+1});
  }
  const at=nowIso();
  await setState('ai_test_results',{...stored,at,results});
  if(aiRun&&aiRun.kind==='ai-test'){aiRun.result={...aiRun.result,results,nextCursor:results.length};await persistAiRun();}
  return {...aiTestCounters({...stored,at},Number(stored.total||results.length),results),runId:stored.runId||aiRun?.id||'',batchResults:[],replayed:false,results};
}
function replaceAiResult(results:any[],row:any){const index=results.findIndex((item:any)=>item.key===row.key);if(index>=0)results[index]=row;else results.push(row)}

export async function controlAiTestRun(action:string):Promise<AiTestRunState|null>{
  const run=await getCurrentAiRun(); if(!run) return null;
  if(action==='stop'){ run.stopRequested=true; }
  else if(action==='resume'&&run.status==='paused'){
    run.stopRequested=false;
    const ai=(await loadConnections()).ai,providers=await aiProviders();
    const all=aiTestTasks(ai,providers,run.onlyCandidates);
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
async function networkFetch(url:string,init:RequestInit,net:Network):Promise<Response>{await assertAiEndpointUrl(url);if(net.mode==='worker'&&net.workerUrl){const target=viaWorkerUrl(net.workerUrl,url);return safeFetch(target,{...init,directRoute:true},3_000_000)}if(net.mode==='proxy'&&net.proxyUrl){return undiciFetch(url,{...(init as any),dispatcher:new ProxyAgent(net.proxyUrl)}) as unknown as Response}if((net.mode==='dns'||net.mode==='doh')&&(net.resolveIp||net.dohUrl)){const host=new URL(url).hostname,ip=net.resolveIp||await doh(host,net.dohUrl);if(String(ip).startsWith('169.254.'))throw Error('IP مقولهٔ ابر (metadata) برای اتصال دستی/DoH مجاز نیست');const dispatcher=new Agent({connect:{lookup(_host:any,_opts:any,callback:any){callback(null,[{address:ip,family:ip.includes(':')?6:4}])}} as any});return undiciFetch(url,{...(init as any),dispatcher}) as unknown as Response}return safeFetch(url,{...init,aiEndpoint:true},3_000_000)}
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
