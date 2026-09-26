import assert from 'node:assert/strict';
import test from 'node:test';
import {EventEmitter} from 'node:events';
import {createBrowserRuntime} from '../scripts/browser-runtime.mjs';
import {reportRedactor} from '../scripts/browser-repair-report.mjs';
function fixture({gotoError,title='Scraper4 browser runtime OK'}={}){
 const page=new EventEmitter(),browser=new EventEmitter();let closes=0,navigations=0;
 page.goto=async(url,options)=>{navigations++;assert.ok(url.startsWith('data:text/html'));assert.equal(options.waitUntil,'domcontentloaded');assert.equal(options.timeout,20000);if(gotoError)throw gotoError};page.title=async()=>title;
 browser.newPage=async()=>page;browser.close=async()=>{closes++;browser.emit('disconnected')};
 return {page,browser,closes:()=>closes,navigations:()=>navigations};
}
for(const engine of ['playwright','puppeteer'])test(engine+': successful local page stays open, duplicate starts reuse it, explicit close preserves events',async()=>{
 const f=fixture();let launches=0;const manager=createBrowserRuntime({uid:1000,launch:async(e)=>{assert.equal(e,engine);launches++;return f.browser}});
 assert.equal(manager.start({engine}).phase,'starting');manager.start({engine});const result=await manager.settled();assert.equal(result.phase,'open');assert.equal(result.connected,true);assert.equal(result.pageLoaded,true);assert.equal(f.closes(),0);assert.equal(f.navigations(),1);manager.start({engine});assert.equal(launches,1);
 await manager.close();assert.equal(f.closes(),1);assert.equal(manager.status().phase,'closed');assert.ok(manager.status().events.some(e=>e.kind==='ready'));assert.equal(manager.status().connected,false);
});
test('navigation crash and nested launch failures are retained and redacted in the report',async()=>{
 const f=fixture({gotoError:new Error('Page crashed',{cause:new Error('https://user:pass@shop.test/?token=secret Bearer abcdef')})});const manager=createBrowserRuntime({uid:1000,launch:async()=>f.browser,redact:reportRedactor({SECRET:'sensitive-value'})});manager.start({engine:'playwright'});let s=await manager.settled();assert.equal(s.phase,'failed');assert.equal(s.lastFailure.stage,'navigation');assert.match(s.lastFailure.error,/Page crashed/);assert.match(s.lastFailure.error,/Cause:/);assert.doesNotMatch(JSON.stringify(s),/user:pass|token=secret|Bearer abcdef/);assert.equal(f.closes(),1);await manager.close();assert.equal(manager.status().lastFailure.stage,'navigation');
 const fail=createBrowserRuntime({uid:1000,launch:async()=>{throw Error('libatk missing')}});fail.start({engine:'playwright'});s=await fail.settled();assert.equal(s.lastFailure.stage,'launch');assert.equal(s.connected,false);
});
test('later page crash or browser disconnection is recorded and releases the retained browser',async()=>{
 for(const event of ['crash','disconnected']){const f=fixture(),m=createBrowserRuntime({uid:1000,launch:async()=>f.browser});m.start({engine:'playwright'});await m.settled();(event==='crash'?f.page:f.browser).emit(event);await new Promise(r=>setImmediate(r));assert.equal(m.status().phase,'failed');assert.equal(m.status().pageLoaded,false);assert.equal(f.closes(),1);assert.equal(m.status().lastFailure.stage,event==='crash'?'page-crash':'disconnected')}
});
test('close during pending launch cancels retention, duplicate close shares cleanup, and later restart works',async()=>{
 const f=fixture();let resolve,launches=0;const gate=new Promise(r=>resolve=r),m=createBrowserRuntime({uid:1000,launch:async()=>{launches++;await gate;return f.browser}});m.start({engine:'playwright'});const a=m.close(),b=m.close();assert.equal(a,b);assert.equal(m.start({engine:'puppeteer'}).phase,'closing');resolve();await a;assert.equal(m.status().phase,'closed');assert.equal(f.navigations(),0);assert.equal(f.closes(),1);assert.equal(launches,1);m.start({engine:'playwright'});await m.settled();assert.equal(m.status().phase,'open');await m.close();
});
test('options and root consent are strict; status/report never launches',()=>{
 let launches=0;const m=createBrowserRuntime({uid:0,launch:()=>launches++});for(const options of [{engine:'bad'},{engine:'playwright',url:'https://x.test'},{engine:'playwright',allowRoot:'true'},{engine:'playwright'}])assert.throws(()=>m.start(options));assert.equal(m.status().phase,'idle');assert.equal(launches,0);
});
test('event history is bounded and snapshots cannot mutate the manager',async()=>{
 const f=fixture(),m=createBrowserRuntime({uid:1000,launch:async()=>f.browser});m.start({engine:'playwright'});await m.settled();for(let i=0;i<80;i++)f.page.emit('pageerror',Error('x'.repeat(9000)));assert.equal(m.status().events.length,60);assert.ok(m.status().events.every(e=>e.message.length<=6000));const s=m.status();s.events.length=0;assert.equal(m.status().events.length,60);await m.close();
});
test('close failure is not reported as closed and can be retried',async()=>{
 const f=fixture();let failClose=true;f.browser.isConnected=()=>true;f.browser.close=async()=>{if(failClose)throw Error('close failed')};const m=createBrowserRuntime({uid:1000,launch:async()=>f.browser});m.start({engine:'playwright'});await m.settled();await m.close();assert.equal(m.status().phase,'failed');assert.equal(m.status().connected,true);assert.equal(m.status().lastFailure.stage,'close');failClose=false;await m.close();assert.equal(m.status().phase,'closed');assert.equal(m.status().connected,false);
});
