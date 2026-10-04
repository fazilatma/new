import test from 'node:test';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),temp=await mkdtemp(join(root,'node_modules/.cache/selector-browser-'));
await writeFile(join(temp,'chromium'),'fixture');process.env.BROWSER_EXECUTABLE_PATH=join(temp,'chromium');
const rendered=await readFile(join(root,'worker-tests/fixtures/browser-selector-tools.html'),'utf8');
const BASE='https://shop.example/catalog';
await build({entryPoints:[join(root,'render-src/scraper.ts')],outfile:join(temp,'scraper.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'browser-fixtures',setup(b){
 if(process.env.SELECTOR_REPRO_BEFORE)b.onLoad({filter:/render-src\/scraper\.ts$/},()=>({contents:execFileSync('git',['show','9af3cd2:cloudflare-scraper4/render-src/scraper.ts'],{cwd:root,encoding:'utf8'}),loader:'ts',resolveDir:join(root,'render-src')}));
 b.onResolve({filter:/^(\.\/network\.js|\.\/playwright-python\.js|puppeteer|crawlee)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>{let contents='';
 if(a.path.includes('network'))contents=`export const safeText=async()=>{globalThis.__browserSeen.downloads++;return {text:'<html><div id="root"></div></html>',url:'https://shop.example/catalog'}},sourceRoute=()=> 'direct',assertPublicUrl=async()=>{},safeFetch=async()=>{throw Error('Unexpected resource fetch')};`;
 else if(a.path.includes('playwright-python'))contents=`export const renderPythonPlaywright=async url=>{globalThis.__browserSeen.loads++;if(globalThis.__selectorFail)throw Error('browser failed');return {html:globalThis.__browserHtml,finalUrl:url,httpStatus:200}};`;
 else if(a.path==='puppeteer')contents=`export default {launch:async()=>({newPage:async()=>{if(globalThis.__selectorFail)throw Error('browser failed');return globalThis.__browserPage},close:async()=>{globalThis.__browserSeen.closed++}})};`;
 else if(a.path==='crawlee')contents=`export class PlaywrightCrawler{constructor(options){this.options=options}async run(){globalThis.__browserSeen.loads++;if(globalThis.__selectorFail)throw Error('browser failed');await this.options.requestHandler({page:globalThis.__browserPage})}}`;
 return {contents,resolveDir:root};});
 }}]});
const scraper=createRequire(import.meta.url)(join(temp,'scraper.cjs'));
function setup(html){globalThis.__selectorFail=false;const seen=globalThis.__browserSeen={loads:0,downloads:0,closed:0,snapshots:0};globalThis.__browserHtml=html;globalThis.__browserPage={goto:async()=>{seen.loads++;return {status:()=>200}},url:()=>BASE,content:async()=>{seen.snapshots++;return html},waitForNetworkIdle:async()=>{},waitForLoadState:async()=>{},on:()=>{},off:()=>{},evaluate:async()=>({height:1000,top:1000,atEnd:true})};return seen;}

for(const engine of ['playwright','puppeteer','crawlee_playwright','network_api']){
 test(engine+': both suggestion modes discover rendered-only fields',async()=>{
  const seen=setup(rendered);const list=await scraper.suggestSelectors(BASE,'list',engine),detail=await scraper.suggestSelectors(BASE,'detail',engine);
  assert.ok(list.selectors.container);assert.ok(list.selectors.title);assert.ok(detail.selectors.shortDesc);assert.ok(detail.selectors.sku);assert.ok(detail.selectors.gallery);assert.equal(seen.downloads,0);assert.equal(seen.loads,2);
 });
 test(engine+': tests text, links, images, variations and gallery from rendered DOM',async()=>{
  const seen=setup(rendered);
  assert.equal((await scraper.testSelector(BASE,'li.product h2','text',engine)).count,2);
  assert.equal((await scraper.testSelector(BASE,'.sku','text',engine)).values[0],'RENDERED-123');
  assert.equal((await scraper.testSelector(BASE,'li.product a','link',engine)).values[0],'https://shop.example/product/one');
  assert.equal((await scraper.testSelector(BASE,'li.product img','image',engine)).values[0],'https://shop.example/one.jpg');
  assert.match((await scraper.testSelector(BASE,'.variations','variations',engine)).values[0],/Red/);
  assert.deepEqual((await scraper.testSelector(BASE,'.woocommerce-product-gallery','gallery',engine,{max:1,skipFirst:true})).values,['https://shop.example/gallery-two.jpg']);
  assert.equal(seen.downloads,0);assert.equal(seen.loads,6);if(engine==='puppeteer')assert.equal(seen.closed,6);
 });
 test(engine+': browser failure never falls back to initial HTML',async()=>{
  const seen=setup(rendered);globalThis.__selectorFail=true;await assert.rejects(scraper.suggestSelectors(BASE,'list',engine),/browser failed/);await assert.rejects(scraper.testSelector(BASE,'.sku','text',engine),/browser failed/);assert.equal(seen.downloads,0);
 });
}
test('non-browser selector tools still read initial HTML without launching a browser',async()=>{
 const seen=setup(rendered);for(const engine of [undefined,'auto','cheerio','jsonld']){assert.equal((await scraper.testSelector(BASE,'.sku','text',engine)).count,0);const r=await scraper.suggestSelectors(BASE,'detail',engine);assert.equal(r.selectors.sku,undefined)}assert.equal(seen.loads,0);assert.equal(seen.downloads,8);
});
