import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),temp=await mkdtemp(join(root,'node_modules/.cache/parser-browser-'));
await writeFile(join(temp,'chromium'),'fixture');process.env.BROWSER_EXECUTABLE_PATH=join(temp,'chromium');
const selectors={container:'.product-card',title:'.card-title',price:'.card-price',link:'.card-title',image:'img'},BASE='https://shop.example/catalog',cards=await readFile(join(root,'worker-tests/fixtures/patris-cards.html'),'utf8');
const ld=n=>'<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Product '+n,url:'/product/'+n,image:'/image.jpg',offers:{price:1000+n}})+'</script>';
await build({entryPoints:[join(root,'render-src/scraper.ts')],outfile:join(temp,'scraper.cjs'),bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'browser-fixtures',setup(b){
 b.onResolve({filter:/^(\.\/network\.js|\.\/playwright-python\.js|\.\/visual-browser\.js|puppeteer|crawlee|\.\.\/worker-src\/scroll-collector\.js)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>{let contents='';
 if(a.path.includes('network'))contents=`export const safeText=async()=>{globalThis.__browserSeen.downloads++;throw Error('Extra HTML fetch')},sourceRoute=()=> 'direct',assertPublicUrl=async()=>{};`;
 else if(a.path.includes('playwright-python'))contents=`export const renderPythonPlaywright=async url=>{globalThis.__browserSeen.loads++;return {html:globalThis.__browserHtml,finalUrl:url,httpStatus:200}};`;
 else if(a.path==='puppeteer')contents=`export default {launch:async()=>({newPage:async()=>globalThis.__browserPage,close:async()=>{globalThis.__browserSeen.closed++}})};`;
 else if(a.path==='crawlee')contents=`export class PlaywrightCrawler{constructor(options){this.options=options}async run(){globalThis.__browserSeen.loads++;await this.options.requestHandler({page:globalThis.__browserPage})}}`;
 else if(a.path.includes('visual-browser'))contents=`export const renderBrowserSnapshot=async(url,driver,indirect,options)=>{globalThis.__browserSeen.loads++;await options.prepare(globalThis.__browserPage);return {collected:await options.collect(globalThis.__browserPage)}};`;
 else contents=`import {collectScrollProducts as collect} from ${JSON.stringify(join(root,'worker-src/scroll-collector.ts'))};export const collectScrollProducts=(io,limits)=>{let time=0;return collect({...io,now:()=>time,wait:async ms=>{time+=ms}},limits)};`;
 return {contents,resolveDir:root};});
 }}]});
const scraper=createRequire(import.meta.url)(join(temp,'scraper.cjs'));
function setup(html,batches){const seen=globalThis.__browserSeen={loads:0,downloads:0,closed:0,snapshots:0};globalThis.__browserHtml=html;globalThis.__browserPage={goto:async()=>{seen.loads++;return {status:()=>200}},url:()=>BASE,content:async()=>{const index=seen.snapshots++;return batches?batches[Math.min(index,batches.length-1)]:html},waitForNetworkIdle:async()=>{},waitForLoadState:async()=>{},on:()=>{},off:()=>{},evaluate:async()=>({height:1000,top:1000,atEnd:true})};return seen;}
for(const engine of ['playwright','puppeteer','crawlee_playwright'])test(engine+': parser consumes rendered HTML once; empty pin never invokes rendered rescue',async()=>{
 let seen=setup(ld(1)+cards);let result=await scraper.scrapeListWithMeta(BASE,selectors,engine,undefined,true,'',true,false,false,undefined,undefined,'jsonld');assert.equal(result.products.length,1);assert.equal(result.products[0].title,'Product 1');assert.equal(seen.loads,1);assert.equal(seen.downloads,0);
 seen=setup(cards);result=await scraper.scrapeListWithMeta(BASE,selectors,engine,undefined,true,'',true,false,false,undefined,undefined,'jsonld');assert.equal(result.products.length,0);assert.equal(seen.loads,1);assert.equal(seen.downloads,0);
});
for(const benchmark of [false,true])test((benchmark?'benchmark':'job')+': scroll parses every snapshot and retains virtualized union without another fetch',async()=>{
 const seen=setup('',[ld(1)+cards,ld(2)+cards,ld(3)+cards]);
 const result=benchmark?await scraper.benchmarkScroll(BASE,selectors,'playwright',false,'jsonld'):await scraper.scrapeListWithMeta(BASE,selectors,'playwright',undefined,true,'',true,false,true,undefined,undefined,'jsonld');
 assert.deepEqual(result.products.map(p=>p.title),['Product 1','Product 2','Product 3']);assert.ok(seen.snapshots>=3);assert.equal(seen.loads,1);assert.equal(seen.downloads,0);
});
test('network_api incompatibility is explicit before loading, even in scrolling mode',async()=>{for(const scroll of [false,true]){const seen=setup(cards);await assert.rejects(scraper.scrapeListWithMeta(BASE,selectors,'network_api',undefined,true,'',true,false,scroll,undefined,undefined,'jsonld'),/network_api.*HTML/);assert.equal(seen.loads+seen.downloads,0)}});
