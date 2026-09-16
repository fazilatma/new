import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = new URL('..', import.meta.url).pathname;
const dir = await mkdtemp(join(root, '.tmp-source-panel-'));
const state = { source: { mode: 'worker', worker: 'proxy.fazilat-ma.workers.dev' } };
const plugins = [{name:'offline-source', setup(b) {
  b.onResolve({filter:/^node:dns\/promises$/}, () => ({path:'dns', namespace:'stub'}));
  b.onLoad({filter:/.*/, namespace:'stub'}, () => ({contents:'export default {lookup:async()=>[{address:"93.184.215.14",family:4}]};'}));
}}];
await build({entryPoints:{network:join(root,'render-src/network.ts'),'source-network':join(root,'worker-src/source-network.ts')},outdir:dir,bundle:true,format:'esm',platform:'node',packages:'external',plugins,logLevel:'silent'});
const node = await import(pathToFileURL(join(dir,'network.js')));
const {resolveSourceNetwork,sourceWorkerUrl,fetchSourceGateway} = await import(pathToFileURL(join(dir,'source-network.js')));
const target='https://emalls.ir/لیست-قیمت_کفش-زنانه~Category~13145';
const canonical=new URL(target).href;
const html=await readFile(join(root,'worker-tests/fixtures/list-fa.html'),'utf8');
await build({entryPoints:[join(root,'worker-src/scraper.ts')],outfile:join(dir,'worker.mjs'),bundle:true,format:'esm',platform:'node',packages:'external',logLevel:'silent',plugins:[{name:'worker-state',setup(b){
  b.onResolve({filter:/^\.\/(db|connections|env)\.js$/},args=>({path:args.path,namespace:'worker-state'}));
  b.onLoad({filter:/.*/,namespace:'worker-state'},args=>({contents:args.path.includes('connections')
    ? 'export async function loadConnections(){return {ai:{network:{mode:"direct",workerUrl:"",proxyUrl:""}}}}'
    : args.path.includes('env') ? 'export function getEnv(){return {}}'
    : 'export async function getState(){return globalThis.__sourcePanelState} export function meterSubrequest(){}'}));
}}]});
const worker=await import(pathToFileURL(join(dir,'worker.mjs')));


test('gateway addresses upgrade Cloudflare HTTP and preserve explicit query templates',()=>{
  assert.equal(sourceWorkerUrl('http://proxy.fazilat-ma.workers.dev',canonical),sourceWorkerUrl('proxy.fazilat-ma.workers.dev',canonical));
  const gateway = sourceWorkerUrl('https://proxy.test/?url={url}',canonical);
  assert.equal(new URL(gateway).searchParams.get('url'),canonical);
});

test('query templates survive browser-encoded braces and normalize existing url parameters',()=>{
  for(const base of ['https://proxy.test/?url=%7Burl%7D','https://proxy.test/?url=','https://proxy.test/?url=https%3A%2F%2Fold.test']) {
    assert.equal(new URL(sourceWorkerUrl(base,canonical)).searchParams.get('url'),canonical);
  }
});

test('source settings override AI, explicit direct stays direct, legacy remains compatible',()=>{
  const ai={mode:'worker',workerUrl:'https://ai.test',proxyUrl:''};
  assert.equal(resolveSourceNetwork(state.source,ai,target).workerUrl,state.source.worker);
  assert.equal(resolveSourceNetwork({mode:'direct'},ai,target).mode,'direct');
  assert.deepEqual(resolveSourceNetwork(undefined,ai,target),ai);
  assert.equal(resolveSourceNetwork({mode:'worker',worker:'gw.test',hosts:'emalls.ir'},ai,target).mode,'worker');
  assert.equal(resolveSourceNetwork({mode:'worker',worker:'gw.test',hosts:'emalls.ir'},ai,'https://notemalls.ir').mode,'direct');
  assert.equal(resolveSourceNetwork({mode:'proxy',proxy:'proxy.fazilat-ma.workers.dev'},ai,target).mode,'worker');
});

test('Node uses the working Worker path contract; source redirects preserve origin URLs',async()=>{
  const calls=[],original=globalThis.fetch;
  node.registerSourceNetworkLoader(async url=>resolveSourceNetwork(state.source,{},url));
  globalThis.fetch=async (url,init)=>{
    calls.push(String(url));
    assert.equal(new Headers(init.headers).get('x-target-url'),calls.length===1?canonical:'https://emalls.ir/page2');
    // A path-only reverse gateway rejects the previous Node ?url= contract.
    if(!String(url).startsWith('https://proxy.fazilat-ma.workers.dev/https://'))return new Response('Forbidden',{status:403});
    return calls.length===1 ? new Response(null,{status:302,headers:{location:'/page2'}}) : new Response(html,{headers:{'content-type':'text/html'}});
  };
  try {
    const result=await node.safeText(target);
    assert.equal(result.text,html);
    assert.equal(result.url,'https://emalls.ir/page2');
    assert.equal(calls[0],sourceWorkerUrl(state.source.worker,canonical));
    state.source={mode:'worker',worker:'https://proxy.fazilat-ma.workers.dev/?url={url}'};
    assert.equal(sourceWorkerUrl(state.source.worker,canonical),'https://proxy.fazilat-ma.workers.dev/?url='+encodeURIComponent(canonical));
  } finally {globalThis.fetch=original;state.source={mode:'worker',worker:'proxy.fazilat-ma.workers.dev'};}
});

test('fresh settings apply without restart; missing gateway does not leak direct traffic',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('Forbidden',{status:403})};
  try {
    state.source={mode:'worker',worker:''};
    await assert.rejects(node.safeText(target),/Worker URL/);
    assert.equal(calls,0);
    state.source={mode:'worker',worker:'proxy.fazilat-ma.workers.dev'};
    await assert.rejects(node.safeText(target),/HTTP 403.*route: worker/);
    state.source={mode:'direct'};
    await assert.rejects(node.safeText(target),/HTTP 403.*route: direct/);
  } finally {globalThis.fetch=original;}
});

test('Worker executes the same saved source-panel route against the offline gateway',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.__sourcePanelState={source:{mode:'worker',worker:'http://proxy.fazilat-ma.workers.dev'}};
  globalThis.fetch=async (url,init)=>{
    calls.push(String(url));
    assert.equal(new Headers(init.headers).get('x-target-url'),canonical);
    return new Response(html,{headers:{'content-type':'text/html'}});
  };
  try {
    const page=await worker.sourceText(target);
    assert.equal(page.text,html);assert.equal(page.route,'worker');assert.equal(page.url,canonical);
    assert.deepEqual(calls,[sourceWorkerUrl('proxy.fazilat-ma.workers.dev',canonical)]);
    globalThis.__sourcePanelState.source.worker='';
    await assert.rejects(worker.sourceText(target),/Worker URL/);
    assert.equal(calls.length,1);
  } finally {globalThis.fetch=original;delete globalThis.__sourcePanelState;}
});

for (const runtime of ['node','worker']) {
  test(runtime + ': query gateway retries 403 once with upstream control headers, never direct',async()=>{
    const original=globalThis.fetch,calls=[];
    state.source={mode:'worker',worker:'https://proxy.fazilat-ma.workers.dev/?url={url}'};
    globalThis.__sourcePanelState={source:state.source};
    globalThis.fetch=async (url,init)=>{
      const headers=new Headers(init.headers);calls.push({url:String(url),headers});
      assert.equal(new URL(String(url)).origin,'https://proxy.fazilat-ma.workers.dev');
      assert.equal(new URL(String(url)).searchParams.get('url'),canonical);
      if (!headers.has('x-proxy-ua')) return new Response('blocked request signature',{status:403});
      assert.equal(headers.get('x-proxy-referer'),'https://emalls.ir/');
      assert.equal(headers.get('x-target-url'),null);
      assert.equal(headers.get('x-scraper-target'),null);
      return new Response(html,{headers:{'content-type':'text/html'}});
    };
    try {
      const page=await (runtime==='node'?node.safeText(target):worker.sourceText(target));
      assert.equal(page.text,html);assert.equal(page.route,'worker');assert.equal(calls.length,2);
      assert.equal(calls[0].url,calls[1].url);
      let failedCalls=0;
      globalThis.fetch=async()=>{failedCalls++;return new Response('forbidden',{status:403})};
      await assert.rejects(runtime==='node'?node.safeText(target):worker.sourceText(target),/attempts: 403 → 403/);
      assert.equal(failedCalls,2,'a persistent rejection must stop after one retry');
      let successCalls=0;
      globalThis.fetch=async()=>{successCalls++;return new Response(html)};
      await (runtime==='node'?node.safeText(target):worker.sourceText(target));
      assert.equal(successCalls,1,'successful requests must not be repeated');
    } finally {globalThis.fetch=original;delete globalThis.__sourcePanelState;}
  });
}

test('compatibility retry excludes POST, non-403, mismatched targets and path gateways',async()=>{
  for (const [gateway,method,status] of [
    ['https://gw.test/?url='+encodeURIComponent(canonical),'POST',403],
    ['https://gw.test/?url='+encodeURIComponent(canonical),'GET',429],
    ['https://gw.test/?url=https%3A%2F%2Fother.test','GET',403],
    ['https://gw.test/'+canonical,'GET',403]
  ]) {
    let calls=0;
    await fetchSourceGateway(canonical,gateway,{method},async()=>{calls++;return new Response('',{status})});
    assert.equal(calls,1);
  }
});

test('compatibility retry preserves gateway credentials and explicit controls',async()=>{
  let calls=0;
  await fetchSourceGateway(canonical,'https://gw.test/?url='+encodeURIComponent(canonical),{headers:{authorization:'Bearer fixture-only','x-proxy-key':'fixture-key','x-proxy-ua':'custom-agent','x-proxy-referer':'https://emalls.ir/custom'}},async init=>{
    const headers=new Headers(init.headers);
    assert.equal(headers.get('authorization'),'Bearer fixture-only');
    assert.equal(headers.get('x-proxy-key'),'fixture-key');
    assert.equal(headers.get('x-proxy-ua'),'custom-agent');
    assert.equal(headers.get('x-proxy-referer'),'https://emalls.ir/custom');
    return new Response('',{status:++calls===1?403:200});
  });
  assert.equal(calls,2);
});

test('AI endpoints do not inherit the source-site gateway',async()=>{
  const original=globalThis.fetch;
  state.source={mode:'worker',worker:'proxy.fazilat-ma.workers.dev'};
  let called='';
  globalThis.fetch=async url=>{called=String(url);return new Response('{}')};
  try {await node.safeFetch('https://api.example.com/v1/models',{aiEndpoint:true});assert.equal(called,'https://api.example.com/v1/models');}
  finally {globalThis.fetch=original;}
});

test('both runtime entrypoints and dashboard use saved source settings and profile flags',async()=>{
  const read=p=>readFile(join(root,p),'utf8');
  const worker=await read('worker-src/scraper.ts');
  assert.match(worker,/resolveSourceNetwork\(\(await getState<any>\('settings',\{\}\)\)\?\.source/);
  assert.match(await read('render-src/connections.ts'),/registerSourceNetworkLoader\(async url/);
  assert.match(await read('worker-src/network.ts'),/sourceWorkerUrl\(base,target\)/);
  for(const file of ['worker-src/app.ts','render-src/server.ts']){
    const route=(await read(file)).split("app.post('/api/source-test'")[1].split('\n')[0];
    assert.match(route,/profileId/);assert.match(route,/networkIndirect/);
  }
  const dashboard=await read('worker-src/dashboard.ts');
  assert.ok(dashboard.includes("if(action==='source-test'){await saveSettings({silent:true});"));
  assert.ok(dashboard.includes("try{await saveSettings({silent:true});const response=await fetch(U('/api/profiles/'+encodeURIComponent(id)+'/extraction-diagnostic?live=1'"));
});

test.after(async()=>{await rm(dir,{recursive:true,force:true});});
