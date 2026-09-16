import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

/**
 * Real-DOM test for the 1.176.0 fix: the results section must actually show scraped products.
 *
 * Reported as "after extraction, products are not shown in the results section (at least on Node)".
 * The rows were in the database and `GET /api/profiles/:id/products` returned them, so this had to be
 * tested where it actually broke: the shared dashboard, rendering real rows. Since 1.174.0
 * `productSuffixFormats` was `async` while `productCodeSuffix` read it synchronously, so every product
 * carrying a `sku`/`sourceKey` threw inside `rows.map(productRowHtml)` and the whole list was discarded —
 * the counter updated, the cards never appeared, and the product modal would not open either.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'results-ui-'));
await build({ entryPoints: { dashboard: join(ROOT, 'worker-src', 'dashboard.ts') }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')).href);

/** Exactly what the Node runtime answers for `GET /api/profiles/:id/products` (rows read back from `products.data`). */
const nodeRows = [
  { sourceKey: 'p1', title: 'کفش مردانه', price: 1250000, priceText: '1,250,000', url: 'https://shop.example/p/p1', image: 'https://shop.example/1.jpg', images: ['https://shop.example/1.jpg'], sku: 'SKU-1', brand: 'نمونه', category: '', shortDesc: '', longDesc: '', sourcePage: 'https://shop.example/', scrapedAt: '2026-09-16T06:00:00.000Z' },
  // No sku at all: the code suffix has to fall back to sourceKey, which used to be the crash trigger too.
  { sourceKey: 'p2', title: 'کفش زنانه', price: 980000, priceText: '980,000', url: 'https://shop.example/p/p2', image: '', images: [], sku: '', brand: '', category: '', shortDesc: '', longDesc: '', sourcePage: 'https://shop.example/', scrapedAt: '2026-09-16T06:00:00.000Z' },
];
const profileId = 'shop.example';
const calls = [];

const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://results.test'), method = String(init.method || 'GET').toUpperCase();
  calls.push({ path: url.pathname, method, search: url.search });
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === `/api/profiles/${profileId}/products`) return json({ ok: true, products: nodeRows, total: nodeRows.length });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [{ id: profileId, name: 'Shop Example', url: 'https://shop.example/', enabled: true, pages: 1, selectors: {}, extractionEngine: 'auto' }] });
  if (url.pathname === '/api/settings') return json({ ok: true, settings: { dedup: { suffixFormats: 'کد:x' } } });
  if (url.pathname === '/api/connections') return json({ ok: true, connections: { ai: { providers: [], candidates: [] }, woo: {}, basalam: { shops: [] } } });
  if (url.pathname === '/api/status') return json({ ok: true, version: '1.176.0', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '1.176.0', databaseReady: true });
  if (url.pathname === '/api/jobs') return json({ ok: true, jobs: [] });
  return json({ ok: true });
};

const { window } = parseHTML(DASHBOARD);
const store = new Map();
const localStorage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key), clear: () => store.clear() };
for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location || { pathname: '/' }, history: window.history, HTMLElement: window.HTMLElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, CustomEvent: window.CustomEvent, localStorage, alert: () => {}, confirm: () => true, fetch: mockFetch, requestAnimationFrame: callback => setTimeout(callback, 0), setInterval: () => 0, clearInterval: () => {} })) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.focus = () => {};
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, get() { return this.querySelector('option[selected]')?.getAttribute('value') ?? this.querySelector('option')?.getAttribute('value') ?? ''; }, set(value) { for (const option of this.querySelectorAll('option')) { if ((option.getAttribute('value') ?? option.textContent) === String(value)) option.setAttribute('selected', ''); else option.removeAttribute('selected'); } } });

const failures = [];
process.on('unhandledRejection', error => failures.push(error));
// The helpers are top-level in the served bundle; exposing them keeps the contract checks honest.
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__resultsUi={state,loadProducts,productSuffixFormats,productCodeSuffix,productRowHtml,productRowFailureHtml};'); } catch (error) { failures.push(error); }
const ui = globalThis.__resultsUi;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + label);
    await sleep(10);
  }
}

test('the results list renders the rows the runtime returned, not just the counter', async () => {
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  const select = document.getElementById('productProfile');
  await waitFor(() => [...select.querySelectorAll('option')].some(option => option.getAttribute('value') === profileId), 'profile option');
  select.value = profileId;
  await ui.loadProducts();

  const cards = [...document.querySelectorAll('#products article.product')];
  assert.equal(cards.length, 2, 'both scraped products are shown (the 1.174.0 regression left the list empty)');
  assert.equal(document.getElementById('productCount').textContent, '۲ محصول', 'the counter and the list agree');
  assert.match(cards[0].textContent, /کفش مردانه/);
  // The code suffix comes from the configured format: this is the very expression that used to throw.
  // The configured format — not the built-in default — must reach the row: a Promise handed to
  // productCodeSuffix silently degrades to the default and that is exactly what used to kill the list.
  assert.equal(cards[0].querySelector('.psuffix').textContent, 'کد:SKU-1', 'settings.dedup.suffixFormats drives the code suffix');
  assert.match(cards[1].innerHTML, /بدون تصویر/, 'a product without an image still gets a card');
  assert.equal(cards[1].querySelector('.psuffix').textContent, 'کد:p2', 'no sku falls back to sourceKey');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
});

test('clicking a result still opens the product modal', async () => {
  document.querySelector('#products article.product').dispatchEvent(new window.Event('click', { bubbles: true }));
  // The modal renders through the same suffix helper, so the 1.174.0 bug closed it silently too.
  const modal = await waitFor(() => (document.getElementById('resultModal')?.hidden === false && document.getElementById('resultModal').textContent.length > 20 ? document.getElementById('resultModal') : null), 'product modal to open');
  assert.match(modal.textContent, /کفش مردانه/, 'the modal shows the product the row was built from');
});

test('the formats helper stays synchronous, because its caller reads the value', () => {
  assert.match(DASHBOARD_JS, /(^|[^a-zA-Z])function productSuffixFormats\(\)/, 'the served dashboard must not await it');
  assert.doesNotMatch(DASHBOARD_JS, /async function productSuffixFormats\(/, 'a stray async here once blanked every result list');
  const formats = ui.productSuffixFormats();
  assert.ok(Array.isArray(formats) && formats.length, 'the caller receives a real list of formats, never a Promise');
  assert.equal(ui.productCodeSuffix({ title: 'کفش', sku: 'A-9' }), 'کد:A-9', 'the configured format is applied to the code');
  assert.equal(ui.productCodeSuffix({ title: 'کفش (کد: 77)', sku: 'A-9' }), '(کد: 77)', 'a code already in the title wins');
  assert.equal(ui.productCodeSuffix({ title: 'کفش' }), '', 'nothing to render when there is no code at all');
});

test('one unrenderable row can never blank the whole list again', () => {
  // The guard is what turns "list silently empty" into "one warning card with the reason".
  assert.match(DASHBOARD_JS, /rows\.map\(p=>\{try\{return productRowHtml\(p\)\}catch\(error\)\{return productRowFailureHtml\(p,error\)\}\}\)/, 'each result is rendered inside its own guard');
  const card = ui.productRowFailureHtml({ title: 'کفش گمشده' }, new Error('boom'));
  assert.match(card, /^<article class="product"/, 'the failure is still a row of the same list');
  assert.match(card, /کفش گمشده/, 'the failed product is named, not swallowed');
  assert.match(card, /boom/, 'the error text is shown to the user');
});
