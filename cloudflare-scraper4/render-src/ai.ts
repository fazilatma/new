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
export async function recordVote(task:string,winner:string,candidates:string[]){const votes=await getState<any>('ai_votes',{scores:{},history:[]});for(const key of candidates){votes.scores[key]??={wins:0,tests:0};votes.scores[key].tests++;if(key===winner)votes.scores[key].wins++}votes.history.push({at:new Date().toISOString(),task,winner,candidates});votes.history=votes.history.slice(-1000);await setState('ai_votes',votes);return leaderboard(votes)}
export async function getLeaderboard(){return leaderboard(await getState<any>('ai_votes',{scores:{},history:[]}))}
function leaderboard(votes:any){return Object.entries(votes.scores||{}).map(([key,v]:any)=>({key,wins:v.wins||0,tests:v.tests||0,score:v.tests?Math.round(v.wins/v.tests*1000)/10:0})).sort((a,b)=>b.score-a.score||b.wins-a.wins)}
async function networkFetch(url:string,init:RequestInit,net:Network):Promise<Response>{await assertPublicUrl(url);if(net.mode==='worker'&&net.workerUrl){const target=net.workerUrl.includes('{url}')?net.workerUrl.replace('{url}',encodeURIComponent(url)):net.workerUrl+(net.workerUrl.includes('?')?'&':'?')+'url='+encodeURIComponent(url);return safeFetch(target,init,3_000_000)}if(net.mode==='proxy'&&net.proxyUrl){return undiciFetch(url,{...(init as any),dispatcher:new ProxyAgent(net.proxyUrl)}) as unknown as Response}if((net.mode==='dns'||net.mode==='doh')&&(net.resolveIp||net.dohUrl)){const host=new URL(url).hostname,ip=net.resolveIp||await doh(host,net.dohUrl);if(privateIp(ip))throw Error('IP خصوصی برای اتصال دستی/DoH مجاز نیست');const dispatcher=new Agent({connect:{lookup(_host:any,_opts:any,callback:any){callback(null,[{address:ip,family:ip.includes(':')?6:4}])}} as any});return undiciFetch(url,{...(init as any),dispatcher}) as unknown as Response}return safeFetch(url,init,3_000_000)}
async function doh(host:string,url:string){const endpoint=url+(url.includes('?')?'&':'?')+'name='+encodeURIComponent(host)+'&type=A',r=await safeFetch(endpoint,{headers:{accept:'application/dns-json'}},500_000),j=await r.json() as any,ip=(j.Answer||[]).find((x:any)=>x.type===1)?.data;if(!ip)throw Error('DoH پاسخی برای دامنه نداد');return String(ip)}
