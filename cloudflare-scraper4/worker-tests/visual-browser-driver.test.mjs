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
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='playwright'?'export const chromium={launch:options=>globalThis.__visualLaunch("playwright",options)};':a.path==='puppeteer'?'export default {launch:options=>globalThis.__visualLaunch("puppeteer",options)};':a.path.includes('scraper')?'export const withBrowserSlot=async task=>task();export const browserExecutable=()=>"/fixture/chromium";':`export const assertPublicUrl=async raw=>{const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||url.hostname==='127.0.0.1'||url.hostname==='localhost')throw Error('Private host');return url};export const safeText=async url=>({text:globalThis.__visualFixture,url});export const safeFetch=async(url,init)=>globalThis.__visualFetch?globalThis.__visualFetch(url,init):new Response('resource');`}));
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
test('guarded scroll session prepares before navigation, keeps browser open during collection, and closes on failure',async()=>{
 let closed=0,prepared=false,collected=false;
 const page={on:()=>{},context:()=>({route:async()=>{}}),url:()=> 'https://shop.test/list',content:async()=>fixture,waitForLoadState:async()=>{},goto:async()=>{assert.equal(prepared,true)}};
 globalThis.__visualLaunch=async()=>({newPage:async()=>page,close:async()=>{closed++}});
 const result=await driver.renderBrowserSnapshot('https://shop.test/list','playwright',true,{prepare:()=>{prepared=true},collect:async()=>{assert.equal(closed,0);collected=true;return [{id:'all-products'}]}});
 assert.equal(collected,true);assert.equal(closed,1);assert.deepEqual(result.collected,[{id:'all-products'}]);
 await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','playwright',false,{prepare:()=>{},collect:async()=>{throw Error('incomplete scroll')}}),/incomplete scroll/);assert.equal(closed,2);
});
test.after(async()=>{delete globalThis.__visualFixture;delete globalThis.__visualLaunch;await rm(temp,{recursive:true,force:true})});

test('scroll recovers a DOMContentLoaded timeout only after its guarded document was served and DOM is ready',async()=>{
 let route,collected=false,closed=0;
 const page={on:()=>{},context:()=>({route:async(_p,fn)=>{route=fn}}),url:()=> 'https://shop.test/list',content:async()=>fixture,evaluate:async()=>({readyState:'complete',textLength:500,htmlLength:fixture.length}),waitForLoadState:async()=>{},goto:async()=>{
  const req={url:()=> 'https://shop.test/list',method:()=> 'GET',isNavigationRequest:()=>true,resourceType:()=> 'document',headers:()=>({})};
  await route({request:()=>req,fulfill:async()=>{},abort:async()=>{}});const e=Error('page.goto: Timeout 30000ms exceeded');e.name='TimeoutError';throw e;
 }};
 globalThis.__visualLaunch=async()=>({newPage:async()=>page,close:async()=>{closed++}});
 const result=await driver.renderBrowserSnapshot('https://shop.test/list','playwright',true,{prepare:()=>{},collect:async()=>{collected=true;return ['initial','next']}});
 assert.equal(collected,true);assert.equal(closed,1);assert.equal(result.browserDiagnostics.navigationRecovered,true);
 page.evaluate=async()=>({readyState:'loading',textLength:500,htmlLength:fixture.length});
 await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','playwright',true,{prepare:()=>{},collect:async()=>assert.fail('unready DOM cannot be complete')}),/Timeout/);
});

test('scroll resource deadline aborts the guarded indirect fetch and reports incomplete scripts without query secrets',async()=>{
 let route,aborted=false,closed=0;
 const page={on:()=>{},context:()=>({route:async(_p,fn)=>{route=fn}}),url:()=> 'https://shop.test/list',content:async()=>fixture,waitForLoadState:async()=>{},goto:async()=>{
  const req={url:()=> 'https://shop.test/slow.js?secret=hidden',method:()=> 'GET',isNavigationRequest:()=>false,resourceType:()=> 'script',headers:()=>({cookie:'never-forward',authorization:'never-forward'})};
  await route({request:()=>req,fulfill:async()=>assert.fail('hanging request cannot succeed'),abort:async()=>{aborted=true}});
 }};
 globalThis.__visualLaunch=async()=>({newPage:async()=>page,close:async()=>{closed++}});
 globalThis.__visualFetch=async(url,init)=>{assert.equal(init.indirect,true);assert.ok(init.signal);assert.equal(init.headers.cookie,undefined);assert.equal(init.headers.authorization,undefined);return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Error('resource deadline')),{once:true}))};
 const set=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>set(fn,ms===12000?5:ms,...args);
 try{await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','playwright',true,{prepare:()=>{},collect:async()=>['initial-only']}),e=>{
  assert.equal(e.browserDiagnostics.failedResources[0].type,'script');assert.doesNotMatch(JSON.stringify(e.browserDiagnostics),/secret|hidden/);return /تأیید نشد/.test(e.message);
 });assert.equal(aborted,true);assert.equal(closed,1)}finally{globalThis.setTimeout=set;delete globalThis.__visualFetch}
});

test('legacy resilience: an aborted first navigation with no intercepted request retries once before collecting',async()=>{
 let route,attempts=0,current='about:blank',collected=0,closed=0;
 const page={on:()=>{},context:()=>({route:async(_p,fn)=>{route=fn}}),url:()=>current,content:async()=>fixture,waitForLoadState:async()=>{},goto:async()=>{
  if(++attempts===1)throw Error('page.goto: net::ERR_ABORTED');
  const req={url:()=> 'https://shop.test/list',method:()=> 'GET',isNavigationRequest:()=>true,resourceType:()=> 'document',headers:()=>({})};
  await route({request:()=>req,fulfill:async()=>{current='https://shop.test/list'},abort:async()=>assert.fail('main document must be fulfilled')});
 }};
 globalThis.__visualLaunch=async()=>({newPage:async()=>page,close:async()=>{closed++}});
 const session={prepare:()=>{},collect:async()=>{collected++;return ['first','next']}};
 const result=await driver.renderBrowserSnapshot('https://shop.test/list','playwright',true,session);
 assert.equal(attempts,2);assert.equal(collected,1);assert.equal(result.browserDiagnostics.navigationRetried,true);assert.equal(closed,1);
 attempts=0;current='about:blank';page.goto=async()=>{attempts++;throw Error('page.goto: net::ERR_ABORTED')};
 await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','playwright',true,session),e=>{
  assert.equal(e.browserDiagnostics.requests,0);assert.equal(e.browserDiagnostics.documentServed,false);assert.equal(e.browserDiagnostics.navigationRetried,true);return /ERR_ABORTED/.test(e.message);
 });assert.equal(attempts,2);assert.equal(collected,1);assert.equal(closed,2);
});

for(const engine of ['playwright','puppeteer'])test(engine+': crashed visual tab retries once in a fresh browser with guarded lightweight resources',async()=>{
 let launches=0,closed=0,skipped=0;const urls=[],fetches=[];
 globalThis.__visualFetch=async(url,init)=>{fetches.push(url);assert.equal(init.indirect,true);return new Response('resource')};
 globalThis.__visualLaunch=async()=>{const attempt=++launches;assert.equal(closed,attempt-1,'close crashed browser before relaunch');let route,requestHandler;const page={on:(name,fn)=>{if(name==='request')requestHandler=fn},context:()=>({route:async(_,fn)=>route=fn}),setBypassServiceWorker:async()=>{},setRequestInterception:async()=>{},routeWebSocket:async()=>{},waitForLoadState:async()=>{},waitForNetworkIdle:async()=>{},url:()=> 'https://shop.test/list',content:async()=>fixture,goto:async url=>{
  urls.push(url);if(attempt===1)throw Error('page.goto: Page crashed');
  for(const [url,type] of [['https://shop.test/list','document'],['https://shop.test/app.js','script'],['https://shop.test/image.jpg','image'],['https://shop.test/movie.mp4','media'],['https://shop.test/font.woff','font']]){
   const req={url:()=>url,method:()=> 'GET',isNavigationRequest:()=>type==='document',resourceType:()=>type,headers:()=>({}),respond:async()=>{},abort:async()=>{skipped++}};
   if(route)await route({request:()=>req,fulfill:async()=>{},abort:async()=>{skipped++}});else await requestHandler(req);
  }
 }};return {newPage:async()=>page,close:async()=>{closed++}}};
 try{const result=await driver.renderBrowserSnapshot('https://shop.test/list',engine,true);assert.equal(launches,2);assert.equal(closed,2);assert.equal(skipped,3);assert.deepEqual(urls,['https://shop.test/list','https://shop.test/list']);assert.deepEqual(fetches,['https://shop.test/app.js']);assert.equal(result.browserDiagnostics.crashRecovered,true);assert.equal(result.browserDiagnostics.lowResource,true);assert.equal(result.text,fixture)}finally{delete globalThis.__visualFetch}
});
test('repeated visual crash is bounded, actionable, preserves malformed URL and never returns initial HTML',async()=>{
 let launches=0,closed=0;const url='https://snappshop.ir/category/kitchen-appliances?is_available=truesort=50aLgWpage=336';
 globalThis.__visualLaunch=async()=>{launches++;return {newPage:async()=>({on:()=>{},context:()=>({route:async()=>{}}),goto:async target=>{assert.equal(target,url);throw Error('page.goto: Page crashed')}}),close:async()=>{closed++}}};
 await assert.rejects(driver.renderBrowserSnapshot(url,'playwright'),e=>{assert.equal(e.browserDiagnostics.crashAttempts,2);assert.equal(e.browserDiagnostics.crashRecovered,false);assert.match(e.message,/RAM/);assert.match(e.message,/is_available/);return /Page crashed/.test(e.message)});assert.equal(launches,2);assert.equal(closed,2);
});
test('scroll crashes do not restart an extraction session',async()=>{
 let launches=0,closed=0;globalThis.__visualLaunch=async()=>{launches++;return {newPage:async()=>({on:()=>{},context:()=>({route:async()=>{}}),goto:async()=>{throw Error('page.goto: Page crashed')}}),close:async()=>{closed++}}};
 await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','playwright',false,{prepare:()=>{},collect:async()=>assert.fail('crashed page cannot collect')}),/Page crashed/);assert.equal(launches,1);assert.equal(closed,1);
});
test('retry launch failure retains original crash evidence without a third attempt',async()=>{
 let launches=0,closed=0;
 globalThis.__visualLaunch=async()=>{if(++launches===2)throw Error('launch failure');return {newPage:async()=>({on:()=>{},context:()=>({route:async()=>{}}),goto:async()=>{throw Error('Page crashed')}}),close:async()=>closed++}};
 await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','playwright'),e=>{assert.equal(e.browserDiagnostics.crashAttempts,2);assert.equal(e.browserDiagnostics.previousAttempt.pageCrashed,true);return /crash/.test(e.message)});assert.equal(launches,2);assert.equal(closed,1);
});
test('loading-only visual snapshot reports failed API resources without query secrets',async()=>{
 let route,closed=0;
 const page={on:()=>{},context:()=>({route:async(_,fn)=>route=fn}),url:()=> 'https://shop.test/list',content:async()=>'<body>Loading...</body>',waitForLoadState:async()=>{},evaluate:async()=>({ready:false,loadingOnly:true}),waitForFunction:async()=>{throw Error('timeout')},goto:async()=>{
  const req={url:()=> 'https://shop.test/api/products?secret=hidden',method:()=> 'GET',isNavigationRequest:()=>false,resourceType:()=> 'fetch',headers:()=>({})};await route({request:()=>req,fulfill:async()=>{},abort:async()=>{}});
 }};
 globalThis.__visualLaunch=async()=>({newPage:async()=>page,close:async()=>closed++});globalThis.__visualFetch=async()=>new Response('Forbidden',{status:403});
 try{await assert.rejects(driver.renderBrowserSnapshot('https://shop.test/list','playwright'),e=>{assert.match(e.message,/بارگذاری/);assert.match(e.message,/HTTP 403/);assert.match(e.message,/api\/products/);assert.doesNotMatch(e.message,/secret|hidden/);return true});assert.equal(closed,1)}finally{delete globalThis.__visualFetch}
});
