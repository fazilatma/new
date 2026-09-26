import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { load } from 'cheerio';
const root=new URL('..',import.meta.url).pathname,temp=await mkdtemp(join(root,'node_modules/.cache/visual-snapshot-'));
const fixture=await readFile(join(root,'worker-tests/fixtures/list-fa.html'),'utf8');
const calls=[];
globalThis.__visualText=async(url,...options)=>{calls.push({kind:'fetch',url,options});return {text:fixture,url}};
globalThis.__visualBrowser=async(url,engine,indirect)=>{calls.push({kind:'browser',url,engine,indirect});return {text:fixture.replace('</body>','<div class="js-generated">رندر جاوااسکریپت</div></body>'),url}};
await build({entryPoints:[join(root,'render-src/visual.ts')],outfile:join(temp,'visual.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'offline',setup(b){
  b.onResolve({filter:/^\.\/(network|config|visual-browser)\.js$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('visual-browser')?'export const VISUAL_BROWSER_ENGINES=new Set(["playwright","puppeteer","crawlee_playwright","network_api"]); export const renderBrowserSnapshot=(...args)=>globalThis.__visualBrowser(...args);':a.path.includes('config')?'export const config={adminToken:"fixture-admin"};':'export const safeText=(...args)=>globalThis.__visualText(...args);'}));
}}]});
const visual=await import(pathToFileURL(join(temp,'visual.mjs')));
test('ticket binds engine and indirect route; all browser engine families use a rendered snapshot',async()=>{
  for(const engine of ['playwright','puppeteer','crawlee_playwright','network_api']){
    const ticket=visual.createVisualTicket('https://shop.test/list',{engine,indirect:true}),data=visual.readVisualTicket(ticket);
    assert.equal(data.engine,engine);assert.equal(data.indirect,true);assert.match(data.channel,/^[a-f0-9]{48}$/);
    const html=await visual.renderVisualSelector(ticket);assert.match(html,/js-generated/);assert.equal(calls.at(-1).kind,'browser');assert.equal(calls.at(-1).engine,engine);assert.equal(calls.at(-1).indirect,true);
  }
  const html=await visual.renderVisualSelector(visual.createVisualTicket('https://shop.test/list',{engine:'jsonld',indirect:true}));assert.match(html,/__s4bar/);assert.equal(calls.at(-1).kind,'fetch');assert.equal(calls.at(-1).options[1].indirect,true);
});
test('tampered and expired tickets cannot change engine or target',()=>{
  const ticket=visual.createVisualTicket('https://shop.test/list',{engine:'playwright'}),[payload,signature]=ticket.split('.');
  const data=JSON.parse(Buffer.from(payload,'base64url'));data.url='http://127.0.0.1';
  assert.throws(()=>visual.readVisualTicket(Buffer.from(JSON.stringify(data)).toString('base64url')+'.'+signature),/signature/);
  const now=Date.now;try{Date.now=()=>now()+600000;assert.throws(()=>visual.readVisualTicket(ticket),/expired/)}finally{Date.now=now}
});
test('snapshot sanitization preserves rendered elements but strips source execution and protects the picker',()=>{
  const ticket=visual.createVisualTicket('https://shop.test/list',{engine:'playwright'}),channel=visual.readVisualTicket(ticket).channel;
  const html=visual.sanitizeVisualSnapshot({url:'https://shop.test/list',text:'<html><head><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"></head><body><div id="__s4bar">fake toolbar</div><script>top.localStorage.clear()</script><iframe srcdoc="evil"></iframe><form action="https://evil.test"><input></form><div class="js-product" onclick="evil()">product</div><a href="/product/1">product</a><img src="http://127.0.0.1/private"></body></html>'},'playwright',channel);
  const $=load(html);assert.equal($('script').length,1);assert.equal($('iframe,form,base').length,0);assert.equal($('[onclick]').length,0);assert.equal($('#__s4bar').length,1);assert.equal($('.js-product').length,1);assert.equal($('a').attr('data-s4-href'),'https://shop.test/product/1');assert.equal($('img').attr('src'),undefined);
  const csp=visual.visualSelectorCsp(ticket);const hash=createHash('sha256').update($('script').html()).digest('base64');assert.ok(csp.includes("script-src 'sha256-"+hash+"'"));assert.match(csp,/sandbox allow-scripts/);assert.ok(!csp.includes('allow-same-origin'));assert.ok(!csp.includes("script-src 'unsafe-inline'"));
});
test('browser snapshot failures do not silently substitute static HTML',async()=>{
  const original=globalThis.__visualBrowser;globalThis.__visualBrowser=async()=>{throw Error('browser unavailable')};
  try{await assert.rejects(visual.renderVisualSelector(visual.createVisualTicket('https://shop.test/list',{engine:'playwright'})),/unavailable/)}finally{globalThis.__visualBrowser=original}
});
test('parent/child isolation and profile engine are wired on both runtimes',async()=>{
  const dash=await readFile(join(root,'worker-src/dashboard.ts'),'utf8');assert.match(dash,/sandbox="allow-scripts"/);assert.match(dash,/event\.source!==frame\.contentWindow/);assert.match(dash,/event\.data\?\.channel!==state\.visualChannel/);assert.match(dash,/profileId:state\.selected,engine,indirect/);
  const worker=await readFile(join(root,'worker-src/visual.ts'),'utf8');assert.match(worker,/sha256-\$\{hash\}/);assert.match(worker,/sandbox allow-scripts/);assert.match(worker,/channel:'__S4_CHANNEL__'/);
  const app=await readFile(join(root,'worker-src/app.ts'),'utf8');assert.match(app,/نمایش DOM با موتور مرورگری به نسخهٔ VPS\/Node نیاز دارد/);
});
test.after(async()=>{delete globalThis.__visualText;delete globalThis.__visualBrowser;await rm(temp,{recursive:true,force:true})});
test('recovered visual snapshot reports reduced resource loading and escapes URL warnings',()=>{
 const html=visual.sanitizeVisualSnapshot({text:fixture,url:'https://shop.test/list',browserDiagnostics:{crashRecovered:true,urlWarning:'Check is_available <script>alert(1)</script>'}},'playwright');
 const $=load(html);assert.match($('#__s4bar').text(),/بازیابی پس از crash/);assert.match($('#__s4bar').text(),/Check is_available <script>/);assert.equal($('#__s4bar script').length,0);
});

test('signed visual ticket carries list/detail context and manual container to the renderer',async()=>{
 const old=globalThis.__visualBrowser;let received;
 globalThis.__visualBrowser=async(...args)=>{received=args;return {url:args[0],text:fixture}};
 try{const ticket=visual.createVisualTicket('https://shop.test/list',{engine:'playwright',context:'list',container:'.my-cards'});await visual.renderVisualSelector(ticket);assert.deepEqual(received[4],{context:'list',container:'.my-cards'});
 const detail=visual.createVisualTicket('https://shop.test/product/1',{engine:'playwright',context:'detail'});await visual.renderVisualSelector(detail);assert.equal(received[4].context,'detail');}finally{globalThis.__visualBrowser=old;}
});
test('snapshot exposes readiness limits and escaped JavaScript errors without claiming completeness',()=>{
 const html=visual.sanitizeVisualSnapshot({text:fixture,url:'https://shop.test/list',browserDiagnostics:{visualReadiness:{context:'list',candidates:3,selectorMismatch:true},pendingCriticalResources:1,javascriptErrors:['<script>failure</script>']}},'playwright'),$=load(html);
 assert.match($('#__s4bar').text(),/تضمین کامل/);assert.match($('#__s4bar').text(),/سلکتور ذخیره‌شده تغییر نکرد/);assert.match($('#__s4bar').text(),/JavaScript/);assert.equal($('#__s4bar script').length,0);
});
