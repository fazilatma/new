import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const temp=await mkdtemp(join(root,'node_modules/.cache/python-playwright-'));
await writeFile(join(temp,'chromium'),'fixture');process.env.BROWSER_EXECUTABLE_PATH=join(temp,'chromium');
const fixture=await readFile(join(root,'worker-tests/fixtures/patris-cards.html'),'utf8');
const before=process.env.REPRO_BEFORE?execFileSync('git',['show','HEAD:cloudflare-scraper4/render-src/scraper.ts'],{cwd:root,encoding:'utf8'}):null;
await build({entryPoints:{scraper:join(root,'render-src/scraper.ts'),profile:join(root,'render-src/playwright-python.ts')},outdir:temp,outExtension:{'.js':'.cjs'},bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'offline-python-parity',setup(b){
 if(before)b.onLoad({filter:/render-src\/scraper\.ts$/},()=>({contents:before,loader:'ts',resolveDir:join(root,'render-src')}));
 b.onResolve({filter:/^playwright$/},()=>({path:'playwright',namespace:'fixture'}));
 b.onResolve({filter:/\/network\.js$/},()=>({path:'network',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='playwright'?'export const chromium={launch:o=>globalThis.__pwLaunch(o),executablePath:()=>globalThis.__pwExpected||"/missing/chrome"};':`export const safeText=async url=>({text:'<html><body><div id="app"></div></body></html>',url});export const sourceRoute=()=> 'direct';export const assertPublicUrl=async url=>{if(!/^https?:/.test(url)||new URL(url).hostname==='127.0.0.1')throw Error('Private URL blocked');};export const safeFetch=async()=>{throw Error('No live network')};`}));
}}]});
const req=createRequire(import.meta.url),render=req(join(temp,'scraper.cjs')),profile=req(join(temp,'profile.cjs'));
const TARGET_URL='https://snappshop.ir/category/kitchen-appliances?page=1';
function setup({timeouts=0,status=200,html,blob='',blank=false,aborted=false}={}){
 const seen={launch:null,context:null,closed:0,waits:[],scrolls:0,navigation:[],scripts:[],selector:null,route:null,events:{}};
 let remaining=timeouts;
 globalThis.__pwLaunch=async options=>{seen.launch=options;return {close:async()=>{seen.closed++},newPage:async options=>{
  seen.context=options;
  const page={context:()=>({on:(name,fn)=>seen.events[name]=fn,route:async(_pattern,fn)=>{seen.route=fn}}),on:(name,fn)=>seen.events[name]=fn,addInitScript:async s=>seen.scripts.push(s),goto:async(url,o)=>{seen.navigation.push(o);if(aborted)throw Error('net::ERR_ABORTED');if(remaining-->0)throw Error('Timeout while navigating');return {status:()=>status}},waitForLoadState:async()=>{},waitForTimeout:async ms=>seen.waits.push(ms),waitForSelector:async(selector,opts)=>{seen.selector={selector,...opts}},url:()=>blank?'about:blank':TARGET_URL,evaluate:async fn=>{if(String(fn).includes('scrollTo')){seen.scrolls++;return;}return blob;},content:async()=>html??(seen.context?.userAgent?.includes('Chrome/131')&&seen.context?.timezoneId==='Asia/Tehran'?fixture:'<html><body>403 Forbidden</body></html>')};return page;}}};return seen;
}
test('Python browser context resolves the fixture that default Node context cannot extract',{timeout:5000},async()=>{
 const seen=setup();const result=await render.scrapeListWithMeta(TARGET_URL,{container:'.product-card',title:'.card-title',price:'.card-price',link:'.card-title',image:'img'},'playwright',undefined,false,'',false);
 assert.equal(result.products.length,4);assert.equal(seen.closed,1);assert.equal(seen.context.locale,'fa-IR');assert.deepEqual(seen.context.viewport,{width:1366,height:768});assert.equal(seen.context.timezoneId,'Asia/Tehran');assert.ok(seen.launch.args.includes('--disable-blink-features=AutomationControlled'));assert.equal(seen.navigation[0].waitUntil,'load');assert.equal(seen.scrolls,8);assert.equal(seen.waits[0],1800);assert.equal(seen.selector.timeout,12000);
});
test('navigation timeout sequence, hydration data and actual response status are retained',async()=>{
 const seen=setup({timeouts:2,status:403,html:'<html><body>Denied</body></html>',blob:JSON.stringify({title:'</script><bad>'})});const result=await profile.renderPythonPlaywright(TARGET_URL,'/fixture/browser');
 assert.deepEqual(seen.navigation.map(x=>x.waitUntil),['load','domcontentloaded','commit']);assert.ok(seen.navigation.every(x=>x.timeout===20000));assert.equal(result.httpStatus,403);assert.ok(result.html.includes('\\u003c/script>'));assert.equal(seen.closed,1);
});
test('page/dialog guards and public URL request checking match scoped Python behavior',async()=>{
 const seen=setup();await profile.renderPythonPlaywright(TARGET_URL);let closed=0,dismissed=0,aborted=0,continued=0;
 await seen.events.page({close:async()=>{closed++}});await seen.events.dialog({dismiss:async()=>{dismissed++}});
 const route=url=>({request:()=>({url:()=>url}),continue:async()=>{continued++},abort:async()=>{aborted++}});
 await seen.route(route('http://127.0.0.1/private'));await seen.route(route('https://shop.example/script.js'));
 assert.equal(closed,1);assert.equal(dismissed,1);assert.equal(aborted,1);assert.equal(continued,1);assert.equal(seen.context.serviceWorkers,'block');assert.match(seen.scripts[0],/webdriver/);assert.match(seen.scripts[0],/window.open/);
});
test('cancellation and terminal navigation failure always close the browser',async()=>{
 let seen=setup();await assert.rejects(profile.renderPythonPlaywright(TARGET_URL,undefined,async()=>true),/cancelled/);assert.equal(seen.closed,1);
 seen=setup({timeouts:3});await assert.rejects(profile.renderPythonPlaywright(TARGET_URL),/Timeout/);assert.equal(seen.closed,1);
});
test('site-specific waits use hostname matching rather than arbitrary URL substrings',()=>{
 assert.equal(profile.pythonPlaywrightPlan('https://example.com/?site=snappshop.ir').scrolls,4);
 assert.equal(profile.pythonPlaywrightPlan('https://snappshop.ir.evil.test/').scrolls,4);
 assert.equal(profile.pythonPlaywrightPlan('https://www.snappshop.ir/').scrolls,8);
 assert.equal(profile.pythonPlaywrightPlan('https://digikala.com/').digi,true);
});
test('Puppeteer and Crawlee extraction stay unchanged apart from optional readers and shared sandbox configuration',async()=>{
 const current=await readFile(join(root,'render-src/scraper.ts'),'utf8');
 const original=execFileSync('git',['show','b11727f:cloudflare-scraper4/render-src/scraper.ts'],{cwd:root,encoding:'utf8'});
 const pup=s=>s.slice(s.indexOf("  const puppeteer = await import('puppeteer');",s.indexOf('async function scrapeRenderedHtml(')),s.indexOf('async function scrapeListWithPlaywright('));
 const crawlee=s=>s.slice(s.indexOf('async function scrapeListWithCrawleePlaywright('),s.indexOf('function parseProductsFromHtml('));
 const withoutOptionalReader=s=>s.replace(/\.\.\.playwrightSandboxOptions\(\), /g,'').replace(/,reader\?:\(html:string,url:string\)=>Promise<Product\[\]>/g,'').replace(/\n    if\(reader\)return reader\(html,finalUrl\);/g,'').replace(/\n    if\(reader\)\{found=await reader\(html,page.url\(\)\);return;\}/g,'');
 assert.equal(withoutOptionalReader(pup(current)),pup(original));assert.equal(withoutOptionalReader(crawlee(current)),crawlee(original));
});

test('uses the current Playwright full Chromium when present, while explicit paths win',async()=>{
 globalThis.__pwExpected=join(temp,'chromium');let seen=setup();await profile.renderPythonPlaywright(TARGET_URL);assert.equal(seen.launch.executablePath,globalThis.__pwExpected);
 seen=setup();await profile.renderPythonPlaywright(TARGET_URL,'/explicit/browser');assert.equal(seen.launch.executablePath,'/explicit/browser');delete globalThis.__pwExpected;
});

test('blank landings are retried and fail; aborted redirects retain readable landing',async()=>{
 let seen=setup({blank:true});await assert.rejects(profile.renderPythonPlaywright(TARGET_URL),/did not reach/);assert.equal(seen.navigation.length,3);assert.equal(seen.closed,1);
 seen=setup({aborted:true});const r=await profile.renderPythonPlaywright(TARGET_URL);assert.equal(r.finalUrl,TARGET_URL);assert.equal(r.httpStatus,0);assert.equal(seen.closed,1);
});
