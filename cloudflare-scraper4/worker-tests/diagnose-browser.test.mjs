import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Pins diagnostic honesty for browser runs (1.146.0): a playwright/puppeteer
// profile that extracts nothing must say WHY — no browser on the device, or
// rendered-but-empty (the second layer names the outcome) — instead of the
// generic "no products" plus a misleading "fix your selectors". A deep page
// (?page=336) gets its own warning ahead of the selector blame. The network
// is stubbed (Snappshop-like JS shell); browser presence itself is
// environment-dependent, so assertions branch on the reported availability
// instead of assuming this sandbox has no Chromium.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, 'package.json'));
const SHELL = '<html><head><title></title><script id="__NEXT_DATA__" type="application/json">{"props":{}}</script></head><body><div id="__next"></div></body></html>';
const stubDir = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-diag-net-'));
await writeFile(join(stubDir, 'stub-network.mjs'),
  `const SHELL=${JSON.stringify(SHELL)};\n` +
  `export async function safeText(raw){ const u=String(raw); return { text: globalThis.__diagFixture||SHELL, url: u }; }\n` +
  `export const assertPublicUrl=async()=>{throw Error("Unexpected browser network in static fixture")}; export const safeFetch=assertPublicUrl; export function sourceRoute(){ return 'direct'; }`);
const outdir = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-diag-'));
const stubPlugin = { name: 'stub-network', setup(b) { b.onResolve({ filter: /network\.js$/ }, () => ({ path: join(stubDir, 'stub-network.mjs') })); } };
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir, entryNames: '[name]', outExtension: { '.js': '.cjs' }, plugins: [stubPlugin] });
const render = require(join(outdir, 'scraper.cjs'));

const DEEP_URL = 'https://snappshop.diag.test/category/kitchen-appliances?is_available=true&page=336';
const PAGE1_URL = 'https://snappshop.diag.test/category/kitchen-appliances?is_available=true';
const profileFor = (url, engine) => ({ id: 'diag-snapp', name: 'diag', url, selectors: {}, extractionEngine: engine });

const deep = await render.diagnoseExtraction(profileFor(DEEP_URL, 'playwright'));
const listStage = deep.stages.find(s => s.name === 'list-extraction');

test('diagnose: a browser run reports availability, layer and error', () => {
  assert.ok(listStage, 'the list-extraction stage must exist');
  assert.equal(listStage.ok, false, 'the shell yields no products');
  assert.equal(typeof listStage.browserAvailable, 'boolean', 'browser availability must be reported');
  assert.ok(listStage.engineError, 'the engine error must be surfaced, not swallowed');
  assert.ok(!('browserLayer' in listStage), 'a browser that never produced must not claim a layer');
  if (listStage.browserAvailable === false) {
    assert.match(listStage.summary, /مرورگری روی این دستگاه پیدا نشد/, 'the summary must name the missing browser');
    assert.match(String(listStage.engineError), /مرورگر/, 'the error must be the loud no-browser refusal');
  }
});

test('diagnose: a deep page is flagged ahead of the selector blame', () => {
  const recs = deep.recommendations.join('\n');
  assert.match(recs, /صفحهٔ ۳۳۶/, 'page 336 must be flagged in Persian digits');
  assert.match(recs, /صفحهٔ اول/, 'the fix must be to re-run on page 1');
  const deepIdx = deep.recommendations.findIndex(r => r.includes('صفحهٔ ۳۳۶'));
  const selIdx = deep.recommendations.findIndex(r => r.includes('سلکتور ظرف محصول'));
  assert.ok(deepIdx >= 0 && deepIdx < selIdx, 'the deep-page warning must come before the selector blame');
});

test('diagnose: page 1 without a browser engine stays quiet', async () => {
  const page1 = await render.diagnoseExtraction(profileFor(PAGE1_URL, 'auto'));
  assert.ok(!page1.recommendations.some(r => r.includes('صفحهٔ ۳۳۶') || r.includes('بدون پارامتر صفحه')), 'page 1 must not warn about deep pages');
  const stage = page1.stages.find(s => s.name === 'list-extraction');
  assert.ok(!('browserAvailable' in stage), 'non-browser profiles must not carry browser fields');
});

test('diagnose: the Worker twin reports engine errors and deep pages too', async () => {
  const worker = await readFile(join(ROOT, 'worker-src', 'scraper.ts'), 'utf8');
  assert.ok(
    worker.includes('...(engineResult.engineError?{engineError:engineResult.engineError}:{})'),
    'the Worker list stage must surface engineError like the Node twin',
  );
  assert.ok(worker.includes('page_number)=(\\d+)'), 'the Worker twin must share the deep-page detector');
  const renderSrc = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');
  assert.ok(renderSrc.includes('page_number)=(\\d+)'), 'guard: the detector regex must survive intact');
});

test('Emalls-like cards remain valid when scrolling browser fails; samples exclude the header',async()=>{
 globalThis.__diagFixture=await readFile(join(ROOT,'worker-tests/fixtures/emalls-like-scroll.html'),'utf8');
 try{
  const report=await render.diagnoseExtraction({id:'emalls-fixture',url:'https://shop.test/list',pagination:'scroll',networkIndirect:true,extractionEngine:'playwright',selectors:{container:'div.item.product-block',title:'h2',price:'[class*="price"]',link:'a[href]',image:'img'}});
  assert.equal(report.ok,false);assert.equal(report.productCount,0);
  assert.equal(report.stages.find(s=>s.name==='list-extraction').ok,false);
  const stage=report.stages.find(s=>s.name==='selector-evidence');
  assert.equal(stage.ok,true);assert.equal(stage.containerCount,100);assert.equal(stage.cardsSampled,12);
  assert.match(stage.evidence.link.sample,/product/);assert.doesNotMatch(stage.evidence.image.sample,/logo/);
  assert.ok(!report.recommendations.some(s=>s.includes('دکمهٔ «پیشنهاد')||s.includes('سلکتور ظرف محصول')));
  assert.doesNotMatch(JSON.stringify(stage),/nth-of-type/);
  assert.ok(!report.recommendations.some(s=>s.includes('قیمت صفر')||s.includes('لینک محصول پیدا نشده')||s.includes('تصویر پیدا نشده')));
 }finally{delete globalThis.__diagFixture}
});
