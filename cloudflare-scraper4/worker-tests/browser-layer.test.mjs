import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Pins the browser second layer (1.145.0): Playwright/Puppeteer/Crawlee run
// the configured selectors on the rendered DOM first (layer 1); when that
// finds nothing, the SAME rendered HTML is read selector-free — structural
// first, heuristic as the final net. No browser exists in this sandbox, so
// these tests pin the pure layer logic (rescueRenderedProducts) plus the
// driver wiring; the live proof (Snappshop category via Termux Chromium) is a
// device run, where the winning layer is printed to the log.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-browser-layer-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));

const wooHtml = await readFile(join(ROOT, 'worker-tests', 'fixtures', 'woocommerce-cards.html'), 'utf8');

test('browser layer: working selectors pass through untouched', () => {
  const first = [{ title: 'Configured selectors win', url: 'https://x.test/p/1' }];
  const rescued = render.rescueRenderedProducts(wooHtml, 'https://shop.example/', first);
  assert.equal(rescued.layer, 'selectors');
  assert.equal(rescued.products, first, 'layer 1 products must not be merged or reordered');
});

test('browser layer: structural rescues rendered WooCommerce cards', () => {
  const rescued = render.rescueRenderedProducts(wooHtml, 'https://shop.example/', []);
  assert.equal(rescued.layer, 'structural');
  assert.equal(rescued.products.length, 3, 'all 3 cards must be rescued without selectors');
  assert.deepEqual(rescued.products.map(p => p.price), [2100000, 950000, 4750000]);
});

test('browser layer: heuristic is the final net where structural sees nothing', () => {
  // /p/ URLs are outside structural's climb list but inside heuristic's URL
  // pattern, so only the third layer can read this card.
  const html = `<html><body><article class="card"><a href="/p/123-nice-hat"><img src="https://x.test/i.jpg" alt="Nice wool hat"></a><span class="pr">45,000 تومان</span></article></body></html>`;
  const rescued = render.rescueRenderedProducts(html, 'https://x.test/', []);
  assert.equal(rescued.layer, 'heuristic');
  assert.equal(rescued.products.length, 1);
  assert.equal(rescued.products[0].title, 'Nice wool hat');
  assert.equal(rescued.products[0].price, 45000);
});

test('browser layer: Snappshop-shaped rendered cards resolve structurally', () => {
  const html = `<html><body><div id="__next"><div class="grid">`
    + `<div class="cell"><a href="/product/snp-1001"><img src="https://sn.test/a.jpg" alt="قابلمه"><h3>قابلمه گرانیتی</h3><span>۱,۹۰۰,۰۰۰ تومان</span></a></div>`
    + `<div class="cell"><a href="/product/snp-1002"><img src="https://sn.test/b.jpg" alt="کتری"><h3>کتری استیل</h3><span>۸۵۰,۰۰۰ تومان</span></a></div>`
    + `</div></div></body></html>`;
  const rescued = render.rescueRenderedProducts(html, 'https://snappshop.ir/', []);
  assert.equal(rescued.layer, 'structural', 'rendered snp- cards must not need manual selectors');
  assert.equal(rescued.products.length, 2);
  assert.deepEqual(rescued.products.map(p => p.title), ['قابلمه گرانیتی', 'کتری استیل']);
  assert.deepEqual(rescued.products.map(p => p.price), [1900000, 850000]);
  assert.ok(rescued.products.every(p => p.url.includes('/product/snp-')), 'snp links must survive the climb');
});

test('browser layer: a page with no products reports none honestly', () => {
  const rescued = render.rescueRenderedProducts('<html><body><p>hello</p></body></html>', 'https://x.test/', []);
  assert.equal(rescued.layer, 'none');
  assert.deepEqual(rescued.products, []);
});

test('browser layer: all three drivers rescue and report the winning layer', async () => {
  const scraper = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');
  assert.ok(scraper.includes('export function rescueRenderedProducts('), 'the rescue must be exported for tests and drivers');
  assert.equal(
    scraper.split('rescueRenderedProducts(html, finalUrl, parseProductsFromHtml(html, finalUrl, selectors))').length - 1,
    2, 'Playwright and Puppeteer must both rescue the same way',
  );
  assert.ok(
    scraper.includes('rescueRenderedProducts(html, page.url(), parseProductsFromHtml(html, page.url(), selectors))'),
    'Crawlee must rescue the rendered page too',
  );
  for (const driver of ['playwright', 'puppeteer', 'crawlee']) {
    assert.ok(scraper.includes(`[${'scraper4'}] ${driver} extraction layer:`), `${driver} must log the winning layer`);
  }
  assert.ok(scraper.includes('browserLayer?:string'), 'ScrapeListResult must carry the winning layer');
  assert.equal(scraper.split('{browserLayer:lastBrowserLayer}').length - 1, 2, 'both result returns must report the layer');
  assert.ok(scraper.includes("lastBrowserLayer='';"), 'each run must reset the layer before picking engines');
});
