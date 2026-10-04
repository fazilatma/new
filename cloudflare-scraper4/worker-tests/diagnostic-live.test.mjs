import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(root, 'node_modules/.cache/diagnostic-live-'));
const twins = {};
const fixture = await readFile(join(root,'worker-tests/fixtures/jsonld-list.html'),'utf8');
for (const runtime of ['worker','render']) {
  const outfile=join(temp,runtime+'.mjs');
  await build({entryPoints:[join(root,runtime+'-src/scraper.ts')],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'offline',setup(b){
    b.onResolve({filter:/^\.\/(network|connections|db)\.js$/},a=>({path:a.path,namespace:'offline'}));
    b.onLoad({filter:/.*/,namespace:'offline'},a=>({contents:a.path.includes('network')
      ? 'export const safeText=(...args)=>globalThis.__diagnosticFetch(...args); export const safeTextViaWorker=safeText; export const assertPublicUrl=async()=>{throw Error("Unexpected browser network in static fixture")}; export const safeFetch=assertPublicUrl; export const sourceRoute=()=>"direct";'
      : a.path.includes('connections') ? 'export const loadConnections=async()=>({ai:{network:{mode:"direct"}}});'
      : 'export const getState=async()=>({});'}));
  }}]});
  twins[runtime]=await import(pathToFileURL(outfile));
}
for (const runtime of ['worker','render']) {
  test(runtime+': progress arrives while the network is still pending',async()=>{
    let release,entered;
    const waiting=new Promise(r=>entered=r),gate=new Promise(r=>release=r),events=[];
    globalThis.__diagnosticFetch=async()=>{entered();await gate;throw Error('fixture HTTP 403')};
    const task=twins[runtime].diagnoseExtraction({id:'fixture',url:'https://fixture.test/list',selectors:{},extractionEngine:'jsonld'},'',e=>events.push(e));
    await waiting;
    const before=events.slice();
    release();
    const report=await task;
    assert.ok(before.some(e=>e.name==='network'&&e.status==='running'),'network start must reach the observer BEFORE the fetch completes');
    assert.ok(events.some(e=>e.name==='network'&&e.status==='error'));
    assert.equal(report.ok,false);
    assert.match(report.stages[0].summary,/403/);
  });
  test(runtime+': fixture report is unchanged when an observer is attached',async()=>{
    globalThis.__diagnosticFetch=async url=>({text:fixture,url,contentType:'text/html'});
    const profile={id:'fixture',url:'https://fixture.test/list',selectors:{},extractionEngine:'jsonld'};
    const events=[];
    const report=await twins[runtime].diagnoseExtraction(profile,'https://fixture.test/override',e=>events.push(e));
    const plain=await twins[runtime].diagnoseExtraction(profile,'https://fixture.test/override');
    assert.equal(report.productCount,plain.productCount);
    assert.deepEqual(report.stages,plain.stages);
    for(const stage of report.stages) assert.ok(events.some(e=>e.name===stage.name&&e.status!=='running'),stage.name);
  });
}
test.after(async()=>{delete globalThis.__diagnosticFetch;await rm(temp,{recursive:true,force:true});});

await build({entryPoints:[join(root,'worker-src/diagnostic-progress.ts')],outfile:join(temp,'stream.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {diagnosticStream}=await import(pathToFileURL(join(temp,'stream.mjs')));
const {transform}=await import('esbuild');
for(const runtime of ['worker','render']){
  const source=await readFile(join(root,runtime==='worker'?'worker-src/app.ts':'render-src/server.ts'),'utf8');
  const line=source.split('\n').find(x=>x.startsWith("app.post('/api/profiles/:id/extraction-diagnostic'"));
  const {code}=await transform(line,{loader:'ts'});
  test(runtime+': real route streams progress before completion and selector save before final report',async()=>{
    let handler,release;const gate=new Promise(resolve=>release=resolve),saved=[];
    const profile={id:'fixture',selectors:{title:'.old'}};
    const diagnose=async(_p,_url,observe)=>{observe?.({name:'network',status:'running',summary:'waiting'});await gate;return {ok:true,stages:[],selectorsToSave:{price:'.price'}}};
    new Function('app','getProfile','diagnoseExtraction','saveLearnedProfile','diagnosticStream','jsonBody',code)({post:(_path,h)=>handler=h},async()=>profile,diagnose,async(_original,p)=>{saved.push(p);Object.assign(profile,p);return true},diagnosticStream,async()=>({}));
    const context={req:{param:()=>profile.id,query:()=> '1',json:async()=>({})},json:r=>Response.json(r)};
    const response=await handler(context);
    assert.match(response.headers.get('content-type'),/ndjson/);
    assert.equal(response.headers.get('x-accel-buffering'),'no');
    const reader=response.body.getReader(),decoder=new TextDecoder();
    const first=JSON.parse(decoder.decode((await reader.read()).value));assert.equal(first.type,'started');
    const next=JSON.parse(decoder.decode((await reader.read()).value));assert.equal(next.status,'running');
    assert.equal(saved.length,0,'save must not happen before diagnosis completes');
    release();const events=[];while(true){const chunk=await reader.read();if(chunk.done)break;events.push(...decoder.decode(chunk.value).trim().split('\n').map(JSON.parse))}
    assert.equal(events.at(-1).type,'result');assert.equal(events.at(-1).report.selectorsSaved.price,'.price');
    assert.equal(saved.length,1);assert.equal(saved[0].selectors.title,'.old');
    assert.ok(events.find(e=>e.name==='selectors-auto-saved'&&e.status==='running'));
    assert.ok(events.find(e=>e.name==='selectors-auto-saved'&&e.status==='success'));
    assert.deepEqual(events.map(e=>e.sequence),[3,4,5]);
    context.req.query=()=>undefined;
    const legacy=await (await handler(context)).json();assert.equal(legacy.ok,true);assert.equal(legacy.selectorsSaved.price,'.price');
  });
}

test('stream serializes fatal errors and stops writes after cancellation',async()=>{
  const failed=diagnosticStream(async()=>{throw Error('fixture persistence error')});
  const events=(await failed.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).type,'error');assert.match(events.at(-1).error,/persistence/);
  let release,emit;const gate=new Promise(resolve=>release=resolve);
  const cancelled=diagnosticStream(async observe=>{emit=observe;await gate;observe({name:'network',status:'success'});return {ok:true}});
  const reader=cancelled.body.getReader();await reader.read();await reader.cancel();emit({name:'network',status:'running'});release();
  await new Promise(resolve=>setImmediate(resolve));
});
