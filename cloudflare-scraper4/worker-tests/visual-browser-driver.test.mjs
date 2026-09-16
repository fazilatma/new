import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=new URL('..',import.meta.url).pathname,temp=await mkdtemp(join(root,'node_modules/.cache/visual-driver-'));
const fixture=await readFile(join(root,'worker-tests/fixtures/list-fa.html'),'utf8');
await build({entryPoints:[join(root,'render-src/visual-browser.ts')],outfile:join(temp,'driver.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'offline',setup(b){
  b.onResolve({filter:/^(playwright|puppeteer|\.\/(scraper|network)\.js)$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='playwright'?'export const chromium={launch:options=>globalThis.__visualLaunch("playwright",options)};':a.path==='puppeteer'?'export default {launch:options=>globalThis.__visualLaunch("puppeteer",options)};':a.path.includes('scraper')?'export const withBrowserSlot=async task=>task();export const browserExecutable=()=>"/fixture/chromium";':`export const assertPublicUrl=async raw=>{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.hostname==='127.0.0.1'||url.hostname==='localhost')throw Error('Private host');return url};export const safeText=async url=>({text:globalThis.__visualFixture,url});export const safeFetch=async()=>new Response('resource');`}));
}}]});
const driver=await import(pathToFileURL(join(temp,'driver.mjs')));
globalThis.__visualFixture=fixture;
for(const engine of ['playwright','puppeteer','crawlee_playwright','network_api']){
  test(engine+': selected driver renders guarded resources and closes the browser',async()=>{
    let route,requestHandler,closed=0,fulfilled=0,blocked=0,launched;
    const page={on:(event,fn)=>{if(event==='request')requestHandler=fn},context:()=>({route:async(_pattern,handler)=>{route=handler}}),routeWebSocket:async()=>{},setBypassServiceWorker:async()=>{},setRequestInterception:async()=>{},url:()=> 'https://shop.test/list',content:async()=>fixture,waitForLoadState:async()=>{},waitForNetworkIdle:async()=>{},goto:async()=>{
      for(const url of ['https://shop.test/list','http://127.0.0.1/private']){
        const req={url:()=>url,method:()=> 'GET',isNavigationRequest:()=>true,headers:()=>({}),postData:()=>undefined,respond:async()=>{fulfilled++},abort:async()=>{blocked++}};
        if(route)await route({request:()=>req,fulfill:async()=>{fulfilled++},abort:async()=>{blocked++}});else await requestHandler(req);
      }
    }};
    globalThis.__visualLaunch=async(kind,options)=>{launched=kind;assert.ok(options.args.includes('--proxy-server=http://127.0.0.1:9'));assert.ok(!options.args.includes('--no-sandbox'));return {newPage:async()=>page,close:async()=>{closed++}}};
    const result=await driver.renderBrowserSnapshot('https://shop.test/list',engine);
    assert.equal(launched,engine==='puppeteer'?'puppeteer':'playwright');assert.equal(fulfilled,1);assert.equal(blocked,1);assert.equal(closed,1);assert.equal(result.text,fixture);assert.equal(result.blockedResources,1);
  });
}
test('failed navigation closes the browser; private initial destinations never launch',async()=>{
  let closed=0,launched=0;
  globalThis.__visualLaunch=async()=>{launched++;return {newPage:async()=>({on:()=>{},context:()=>({route:async()=>{}}),goto:async()=>{throw Error('fixture timeout')}}),close:async()=>{closed++}}};
  await assert.rejects(driver.renderBrowserSnapshot('http://127.0.0.1','playwright'),/Private/);assert.equal(launched,0);
  await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','playwright'),/timeout/);assert.equal(closed,1);
  await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','invented'),/Unknown/);
});
test.after(async()=>{delete globalThis.__visualFixture;delete globalThis.__visualLaunch;await rm(temp,{recursive:true,force:true})});
