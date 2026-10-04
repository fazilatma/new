import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
const script=source.slice(source.indexOf('const diagnosticLabels='),source.indexOf('function productSuffixFormats()'));
const {document}=parseHTML('<html><body></body></html>');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const timers=new Map();let tick=0;
const context=vm.createContext({localTasks:new Map(),responseActivities:new WeakMap(),activityResponseResult:()=>{},document,TextDecoder,Uint8Array,Map,Date,JSON,Error,console,esc:escape,pretty:x=>JSON.stringify(x,null,2),fa:String,$:id=>document.getElementById(id),notice:()=>{},setInterval:fn=>{timers.set(++tick,fn);return tick},clearInterval:id=>timers.delete(id),modalShell:(_title,html)=>{let root=document.getElementById('resultModal');if(!root){root=document.createElement('div');root.id='resultModal';document.body.appendChild(root)}root.innerHTML='<div class="result-body">'+html+'</div>'}});
vm.runInContext(script,context);
const encode=rows=>new TextEncoder().encode(rows.map(x=>JSON.stringify(x)).join('\n')+'\n');

test('actual UI displays running and finished stages, escapes data and cleans its timer',()=>{
  const run=context.openDiagnosticProgress({name:'آزمون'},'fixture');
  assert.equal(run.panel.querySelectorAll('.waiting').length,5);
  run.observe({type:'progress',name:'network',status:'running',summary:'در حال دریافت…',elapsedMs:1});
  assert.ok(run.panel.querySelector('.running'));
  run.observe({type:'progress',name:'network',status:'success',summary:'<img src=x onerror=alert(1)>',bytes:100,elapsedMs:500});
  assert.equal(run.panel.querySelectorAll('.success').length,1);
  assert.equal(run.panel.querySelectorAll('img').length,0);
  assert.equal(run.panel.querySelectorAll('[data-diag-activity] li').length,2);
  assert.match(run.panel.querySelector('[data-diag-counts]').textContent,/1/);
  run.finish();assert.equal(timers.size,0);assert.equal(run.panel.querySelector('[role="progressbar"]'),null);
});

test('closing and reopening observes the same run rather than launching another',()=>{
  const run=context.openDiagnosticProgress({name:'آزمون'},'fixture');
  document.getElementById('resultModal').remove();
  run.observe({type:'progress',name:'network',status:'success',summary:'صفحه دریافت شد'});
  assert.equal(context.openDiagnosticProgress({name:'other'},'other'),null);
  assert.equal(document.querySelector('.diagnostic-live'),run.panel);
  assert.ok(run.panel.querySelector('.success'));
  run.finish(new Error('interrupted'));
  assert.match(run.panel.textContent,/interrupted/);assert.equal(timers.size,0);
});

test('stream decoder handles split UTF-8 and emits progress before final result',async()=>{
  let controller;const response=new Response(new ReadableStream({start(c){controller=c}}),{headers:{'content-type':'application/x-ndjson'}});
  const events=[];const pending=context.readDiagnosticStream(response,e=>events.push(e));
  const bytes=encode([{type:'progress',name:'network',status:'running',summary:'دریافت صفحه'}]);
  for(const byte of bytes)controller.enqueue(new Uint8Array([byte]));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(events.length,1);assert.equal(events[0].summary,'دریافت صفحه');
  controller.enqueue(encode([{type:'result',report:{ok:true,productCount:2}}]));controller.close();
  assert.equal((await pending).productCount,2);
});

test('stream errors and truncation cannot look like success; legacy JSON is read without rerunning',async()=>{
  for(const rows of [[{type:'progress',name:'network',status:'running'}],[{type:'error',error:'fixture failed'}]]){
    const response=new Response(encode(rows),{headers:{'content-type':'application/x-ndjson'}});
    await assert.rejects(context.readDiagnosticStream(response,()=>{}));
  }
  const report=await context.readDiagnosticStream(new Response('{"ok":true}',{headers:{'content-type':'application/json'}}),()=>{});
  assert.equal(report.ok,true);
});
