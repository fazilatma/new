import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Pins the `network_api` engine (1.147.0): Playwright sniffs the page's own
// XHR/fetch JSON (DevTools-network style) and the shared JSON walker reads
// the products — for JS shops whose API answers where the DOM stays empty.
// No browser exists in this sandbox, so these tests pin the pure parsing
// (networkApiProducts) plus the driver wiring; the live Snappshop proof is a
// device run with Termux Chromium, where captured endpoints hit the log.
// 1.151.0 also pins reliable body draining (Promise.allSettled) and
// product-URL prioritisation under the capture caps.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-network-api-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));

const apiJson = await readFile(join(ROOT, 'worker-tests', 'fixtures', 'snappshop-api.json'), 'utf8');

test('network_api: a Snappshop-shaped envelope yields its products', () => {
  const products = render.networkApiProducts([apiJson], 'https://snappshop.test/');
  assert.equal(products.length, 4, `must read the 4 complete rows, got ${products.length}`);
  assert.deepEqual(products.map(p => p.title), ['قابلمه گرانیتی', 'کتری استیل', 'سرویس قاشق و چنگال', 'قوری چینی']);
  assert.deepEqual(products.map(p => p.price), [1900000, 850000, 1250000, 640000]);
  assert.ok(products.every(p => p.url.startsWith('https://snappshop.test/product/snp-')), 'relative, absolute, slug and href links must all resolve');
  assert.ok(products.every(p => p.image), 'every kept product carries its API image');
});

test('network_api: garbage bodies are skipped, never fatal', () => {
  const products = render.networkApiProducts(['not json{{{', '', JSON.stringify({ hello: 'world' }), '[1,2,3]', apiJson], 'https://snappshop.test/');
  assert.equal(products.length, 4, 'one good envelope among garbage still yields its 4 products');
  assert.deepEqual(render.networkApiProducts([], 'https://x.test/'), []);
  assert.deepEqual(render.networkApiProducts(null, 'https://x.test/'), []);
});

test('network_api: runaway catalogues are capped, not exploded', () => {
  const big = JSON.stringify({ products: Array.from({ length: 1500 }, (_, i) => ({ title: 'Item ' + i, price: 1000 + i, url: '/p/' + i, image: 'https://x.test/i.jpg' })) });
  const products = render.networkApiProducts([big], 'https://x.test/');
  assert.ok(products.length > 1000 && products.length < 1500, `the walker cap must engage, got ${products.length}`);
  assert.ok(products.every(p => p.title && p.url), 'capped output stays complete');
});

test('network_api: product URLs outrank noise when capture slots run out', () => {
  const { scoreUrl } = render;
  assert.equal(typeof scoreUrl, 'function', 'the URL ranker must be exported for testing');
  assert.ok(scoreUrl('https://shop.test/api/products?page=1') > scoreUrl('https://shop.test/api/telemetry/collect'), 'a product API must beat a telemetry call');
  assert.ok(scoreUrl('https://shop.test/search?q=pan') > scoreUrl('https://shop.test/static/app.js'), 'a search API must beat a plain asset');
  assert.ok(scoreUrl('https://shop.test/x') > scoreUrl('https://analytics.test/beacon'), 'a neutral URL must beat pure noise');
  assert.equal(scoreUrl(''), 0, 'an empty URL scores nothing');
});

test('network_api: the engine is wired into chains, benchmark, UI and gates', async () => {
  const scraper = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');
  assert.ok(scraper.includes("if (name === 'network_api') return withBrowserSlot(() => scrapeListWithNetworkApi(url));"), 'pick() must dispatch network_api inside the browser slot');
  assert.ok(scraper.includes("'crawlee_playwright','network_api'"), 'the auto chain must end with network_api after the browsers');
  assert.ok(scraper.includes("page.on('response'"), 'the driver must listen on network responses');
  assert.ok(scraper.includes("type !== 'xhr' && type !== 'fetch'"), 'only XHR/fetch responses may be captured');
  assert.ok(scraper.includes('NETWORK_API_MAX_RESPONSES'), 'capture must be bounded');
  assert.ok(scraper.includes('[scraper4] network_api endpoints'), 'captured endpoints must hit the log for API discovery');
  // 1.151.0 reliability pins
  assert.ok(scraper.includes('Promise.allSettled'), 'in-flight response.body() must be awaited after settle (no fire-and-forget race)');
  assert.ok(scraper.includes('pendingBodies'), 'body reads must be collected for draining');
  assert.ok(scraper.includes('productUrlRe') || scraper.includes('scoreUrl'), 'product-like URLs must be prioritised under the capture caps');
  assert.ok(scraper.includes('isJsonish') || scraper.includes('application/json'), 'Content-Type application/json must be preferred');
  const server = await readFile(join(ROOT, 'render-src', 'server.ts'), 'utf8');
  assert.ok(server.includes("'crawlee_playwright','network_api'"), 'the Node benchmark must probe network_api');
  const app = await readFile(join(ROOT, 'worker-src', 'app.ts'), 'utf8');
  assert.ok(app.includes("'structural','network_api'"), 'the Worker must list network_api as unavailable');
  const dash = await readFile(join(ROOT, 'worker-src', 'dashboard.ts'), 'utf8');
  assert.ok(dash.includes("['network_api','Network API sniffing — Node only']"), 'the JS dropdown must offer network_api');
  assert.equal(dash.split('<option value=\"network_api\">').length - 1, 2, 'both static dropdowns must offer network_api');
});

test('network_api: both runtimes agree it is Node-only', async () => {
  for (const file of ['render-src/scraper.ts', 'render-src/server.ts']) {
    const src = await readFile(join(ROOT, file), 'utf8');
    assert.ok(src.includes("'crawlee_playwright','network_api'"), `${file} must gate network_api on browser availability`);
  }
  const wScraper = await readFile(join(ROOT, 'worker-src/scraper.ts'), 'utf8');
  assert.ok(wScraper.includes("'structural','network_api'"), 'the Worker must refuse network_api loudly');
  for (const file of ['worker-src/types.ts', 'render-src/types.ts']) {
    const src = await readFile(join(ROOT, file), 'utf8');
    assert.ok(src.includes("'crawlee_playwright' | 'network_api'"), `${file} union must carry network_api`);
  }
});

test('network_api: the API walker recurses fully, not by key allow-list', () => {
  const row = i => ({ title: 'T' + i, price: 1000, url: '/p/' + i, image: 'https://x.test/i.jpg' });
  // Keys the DOM walker never descends into must still yield their products.
  assert.equal(render.networkApiProducts([JSON.stringify({ data: { search: { hits: [row(1), row(2)] } } })], 'https://x.test/').length, 2);
  assert.equal(render.networkApiProducts([JSON.stringify({ docs: [row(3)] })], 'https://x.test/').length, 1);
  let deep = row(4);
  for (let i = 0; i < 6; i++) deep = { wrap: deep };
  assert.equal(render.networkApiProducts([JSON.stringify(deep)], 'https://x.test/').length, 1, 'deep envelopes must resolve');
  assert.deepEqual(render.networkApiProducts([JSON.stringify({ meta: { a: 1 }, tags: ['x', { label: 'y' }] })], 'https://x.test/'), [], 'junk must stay junk');
});

test('network_api: capture stats and the API dump are plumbed to the report', async () => {
  const scraper = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');
  assert.ok(scraper.includes('export type NetworkApiStats='), 'the stats shape must be exported');
  assert.ok(scraper.includes('lastNetworkApiStats=null;'), 'each run must reset the stats');
  assert.equal(scraper.split('networkApiStats:lastNetworkApiStats').length - 1, 2, 'both result returns must report the stats');
  assert.ok(scraper.includes('{ networkApi: result.networkApiStats }'), 'the diagnostic must surface the capture stats');
  assert.ok(scraper.includes('هیچ درخواست API (XHR/fetch) دیده نشد'), 'zero traffic must get its own summary');
  assert.ok(scraper.includes('پاسخ API گرفت ولی محصولی از آن‌ها خوانده نشد'), 'unparsed traffic must get its own summary');
  assert.ok(scraper.includes('SCRAPER4_DUMP_API_DIR'), 'captured bodies must be dumpable for schema forensics');
  assert.ok(scraper.includes('api-endpoints.txt'), 'the dump must manifest its endpoint URLs');
});

test('network_api: failed API responses are counted, not silently skipped', async () => {
  const scraper = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');
  assert.ok(scraper.includes('failedResponses:number'), 'the stats must count failed responses');
  assert.ok(scraper.includes('failedEndpoints:string[]'), 'the stats must keep failed URLs with statuses');
  assert.ok(scraper.includes('failedResponses++'), 'non-ok XHR/fetch must increment the failure counter');
  assert.ok(scraper.includes('response.status()'), 'failed entries must record the HTTP status');
  assert.ok(scraper.includes('failedResponses === 0'), 'the no-traffic summary must require zero failures too');
  assert.ok(scraper.includes('درخواست API زد ولی همه ناموفق بودند'), 'all-failed runs must get their own summary');
  assert.ok(scraper.includes('[scraper4] network_api failed ('), 'failed endpoints must be logged');
});
