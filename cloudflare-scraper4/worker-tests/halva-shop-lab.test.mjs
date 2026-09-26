import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { load } from 'cheerio';

// Synthetic halva store; actual twin parsers with fixture transport, not a live browser.
// --- worker twin bundle (same approach as engine-diagnosis.test.mjs) ---
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-halva-'));
await build({ entryPoints: { scraper: join(ROOT, 'worker-src', 'scraper.ts') }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const HTML_VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
class CheerioHTMLRewriter {
  constructor() { this.registrations = []; }
  on(selector, handler) { load('<i></i>')(selector); this.registrations.push({ selector, handler }); return this; }
  transform(response) { return new Response(new ReadableStream({ start: async controller => { try { const source = await response.text(), $ = load(source, { decodeEntities: true }), roots = $.root().contents().toArray(); for (const root of roots) this.#walk($, root, []); controller.enqueue(new TextEncoder().encode($.html())); controller.close(); } catch (error) { controller.error(error); } } })); }
  #walk($, node, active) {
    if (node.type === 'text') { for (const handler of active) handler.text?.({ text: node.data || '', lastInTextNode: true }); return; }
    if (node.type === 'comment') return;
    const matching = [];
    if (node.type === 'tag') for (const registration of this.registrations) if ($(node).is(registration.selector)) matching.push(registration.handler);
    const callbacks = [], wrapper = {
      tagName: node.name, getAttribute: name => node.attribs?.[name] ?? null, setAttribute: (name, value) => $(node).attr(name, value), removeAttribute: name => $(node).removeAttr(name),
      before: (value) => $(node).before(value), after: (value) => $(node).after(value), remove: () => $(node).remove(), onEndTag: callback => { if (HTML_VOID_TAGS.has(String(node.name).toLowerCase())) throw Error('Parser error: No end tag.'); callbacks.push(callback); },
      get attributes() { return Object.entries(node.attribs || {}); }
    };
    for (const handler of matching) handler.element?.(wrapper);
    const scoped = [...active, ...matching]; for (const child of [...(node.children || [])]) this.#walk($, child, scoped);
    for (const callback of callbacks.reverse()) callback();
  }
}
globalThis.HTMLRewriter = CheerioHTMLRewriter;
const worker = await import(pathToFileURL(join(temporary, 'scraper.mjs')));

// --- render twin bundle (same approach as scripts/lab-probe.mjs) ---
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-render-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));


await build({entryPoints:[join(ROOT,'worker-src/benchmark-pagination.ts')],bundle:true,platform:'node',format:'esm',outfile:join(temporary,'pagination.mjs'),logLevel:'silent'});
const {benchmarkPagination}=await import(pathToFileURL(join(temporary,'pagination.mjs')));
test.after(async()=>{await rm(temporary,{recursive:true,force:true});await rm(rtmp,{recursive:true,force:true});});
const BASE='https://halva.example/page-1.html';
const selectors={container:'li.product',title:'.product-title',price:'.price',link:'a.product-link',image:'img'};
const pages=await Promise.all([1,2,3].map(n=>readFile(join(ROOT,'worker-tests/fixtures/halva-shop/page-'+n+'.html'),'utf8')));
for(const [name,twin,engine,parse] of [['worker',worker,'htmlrewriter',worker.parseCards],['render',render,'cheerio',render.scrapeListCheerioFromHtml]]){
 test(name+': halva shop has 36 complete products with exact prices, images and product URLs',async()=>{
  const all=[];for(let i=0;i<3;i++){
   const rows=await parse(pages[i],BASE,selectors);assert.equal(rows.length,12);all.push(...rows);
   const verified=await twin.verifyListSelectors(pages[i],BASE,selectors);assert.equal(verified.ok,true);
   const diagnosis=await twin.diagnoseBenchmarkEngine(engine,pages[i],BASE,selectors,rows);assert.ok(diagnosis.hint.includes('12'));
  }
  assert.equal(new Set(all.map(p=>p.url)).size,36);
  for(let i=0;i<36;i++){assert.equal(all[i].price,105000+i*5000);assert.equal(all[i].url,'https://halva.example/product/halva-'+(i+1));assert.equal(all[i].image,'https://halva.example/halva.svg');assert.ok(all[i].title.includes('halva box'));}
 });
 for(const mode of ['next_selector','query_page','full_pattern'])test(name+': halva three-page '+mode+' verifies both transitions using extracted products',async()=>{
  const visited=[],profile={url:BASE,pagination:mode,paginationValue:mode==='next_selector'?'a.next':mode==='query_page'?'page':'https://halva.example/page-{page}.html'};
  const report=await benchmarkPagination(profile,{pageUrl:twin.pageUrl,scrape:async(url,nextSelector)=>{
   visited.push(url);const u=new URL(url),n=Number(u.searchParams.get('page')||u.pathname.match(/page-(\d+)/)?.[1]||1),html=pages[n-1];assert.ok(html);
   const $=load(html),nextUrl=nextSelector?$(nextSelector).attr('href'):undefined;
   return {products:await parse(html,url,selectors),nextUrl};
  }});
  assert.equal(report.pagesScanned,3);assert.equal(report.transitionsVerified,2);assert.equal(report.verified,true);assert.equal(report.products.length,36);assert.equal(new Set(visited).size,3);assert.deepEqual(report.records.map(r=>r.newProducts),[12,12,12]);
 });
 test(name+': repeated halva page cannot masquerade as three-page success',async()=>{
  const rows=await parse(pages[0],BASE,selectors);
  const report=await benchmarkPagination({url:BASE,pagination:'query_page',paginationValue:'page'},{pageUrl:twin.pageUrl,scrape:async()=>({products:rows})});
  assert.equal(report.verified,false);assert.equal(report.transitionsVerified,0);assert.equal(report.products.length,12);
 });
}
