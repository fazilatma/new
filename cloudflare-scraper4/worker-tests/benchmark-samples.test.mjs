import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {load} from 'cheerio';
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
async function compile(source,names,io={}){const js=(await transform(source.replace(/\bexport /g,''),{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names+'};')(...Object.values(io))}
const {benchmarkEvidence,incompatibleBenchmark}=await compile(await read('worker-src/benchmark-evidence.ts'),'benchmarkEvidence,incompatibleBenchmark');
const {benchmarkPagination,benchmarkError}=await compile(await read('worker-src/benchmark-pagination.ts'),'benchmarkPagination,benchmarkError');
const row={sourceKey:'one',title:'Real sample',price:1200,priceText:'1200 تومان',url:'https://shop.example/p/one',image:'https://shop.example/one.jpg',sku:'one'};
test('samples and completeness come from actual engine products, even with a pinned parser',()=>{
 const d=benchmarkEvidence('playwright',[row],'','auto',{sample:{title:'Wrong initial HTML product'},hint:'old'});assert.equal(d.sample.title,'Real sample');assert.deepEqual(d.complete,{title:1,price:1,link:1,image:1});assert.equal(d.signals.loader,'playwright');assert.equal(d.signals.productParser,'auto');assert.equal(benchmarkEvidence('cheerio',[],'','auto',d).sample,null);
});
test('missing OS libraries, missing Chrome and generic launch failures have distinct remedies',()=>{
 const d=benchmarkEvidence('playwright',[],'error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file','auto');assert.equal(d.failure.category,'missing-os-libraries');assert.deepEqual(d.failure.missingLibraries,['libatk-1.0.so.0']);assert.match(d.failure.command,/install-deps chromium/);assert.equal(d.sample,null);
 assert.equal(benchmarkEvidence('puppeteer',[],'Could not find Chrome (ver. 152.0.7977.75)').failure.category,'missing-browser');assert.equal(benchmarkEvidence('crawlee_playwright',[],'Failed to launch browser').failure.category,'browser-launch');
});
test('Crawlee nested causes survive pagination and ANSI noise is removed for both twins',async()=>{
 const e=new Error('Failed to launch browser',{cause:new Error('\x1b[2merror while loading shared libraries: libatk-1.0.so.0: missing\x1b[22m')});const result=await benchmarkPagination({pagination:'query_page'},{pageUrl:()=> 'https://shop.example/',scrape:async()=>{throw e}});assert.match(result.error,/libatk/);assert.doesNotMatch(result.error,/\x1b/);assert.equal(result.verified,false);assert.equal(result.pagesScanned,0);assert.equal(benchmarkEvidence('crawlee_playwright',[],result.error).failure.category,'missing-os-libraries');e.cause=e;assert.equal(benchmarkError(e),'Failed to launch browser');
});
test('network API conflict is skipped explicitly without changing the switch or inventing a sample',()=>{
 const r=incompatibleBenchmark('network_api','auto');assert.equal(r.status,'incompatible');assert.equal(r.skipped,true);assert.equal(r.ok,false);assert.equal(r.sample,null);assert.equal(incompatibleBenchmark('network_api',undefined),null);assert.equal(incompatibleBenchmark('playwright','jsonld'),null);
});
const source=await read('worker-src/dashboard.ts'),a=source.indexOf('function benchmarkSampleCard('),b=source.indexOf('async function benchmarkHomeEngines',a),escape=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const {benchmarkSampleCard}=await compile(source.slice(a,b),'benchmarkSampleCard',{esc:escape,escAttr:escape});
test('sample card displays actual title, image, price and product link; missing sample is explicit',()=>{
 const $=load(benchmarkSampleCard({engine:'playwright',sample:row}));assert.equal($('h4').text(),row.title);assert.equal($('img').attr('src'),row.image);assert.equal($('a').attr('href'),row.url);assert.match($.text(),/1200/);assert.equal($('a').attr('rel'),'noopener noreferrer');assert.match(benchmarkSampleCard({engine:'puppeteer'}),/محصول نمونه‌ای استخراج نشد/);
});
test('sample renderer escapes stored HTML and refuses executable image/link schemes',()=>{
 const $=load(benchmarkSampleCard({engine:'<script>alert(1)</script>',sample:{...row,title:'<img src=x onerror=alert(1)>',url:'javascript:alert(1)',image:'data:text/html,bad'}}));assert.equal($('script').length,0);assert.equal($('img').length,0);assert.equal($('a').length,0);assert.equal($('h4').text(),'<img src=x onerror=alert(1)>');
});
test('benchmark modal and copy report are wired to samples and failure actions',()=>{
 const line=source.split('\n').find(l=>l.startsWith('async function benchmarkHomeEngines'));assert.match(line,/diagnosticSampleCard\(r,/);assert.match(line,/<th>محصول نمونه<\/th>/);assert.match(line,/failure.command/);const report=source.split('\n').find(l=>l.startsWith('function benchmarkReportText'));assert.match(report,/sample:/);assert.match(report,/action:/);
});
