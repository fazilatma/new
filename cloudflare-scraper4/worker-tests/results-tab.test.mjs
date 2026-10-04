import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

// End to end through the real dashboard bundle: pressing "show results" must
// render every product card — including plain products whose title carries no
// (code...) suffix. A stray async on the suffix-format lookup used to throw
// inside rows.map(productRowHtml), so one plain product blanked the whole tab.
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-results-tab-'));
await build({ entryPoints: { dashboard: new URL('../worker-src/dashboard.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')));

const profiles = [{ id: 'p1', name: 'Probe shop', url: 'https://shop.example/cats', enabled: true, pages: 0, pagination: 'query_page', extractionEngine: 'auto', extractionEngineHost: '', extractionEngineMs: 0, extractionEngineBenchmarks: [], paginationValue: 'page', selectors: { container: '', title: '', price: '', link: '', image: '' }, titleSuffix: '', priceMode: 'none', priceValue: 0, roundPrice: 0, minPrice: 0, wooCategoryId: 0, basalamCategoryId: 0, basalamFallbackCategoryIds: [], networkIndirect: false, noExtract: false, syncWoo: false, syncBasalam: false, aiDescriptions: true, intervalMinutes: 0, lastRunAt: null, createdAt: '', updatedAt: '' }];
const products = [
  { title: 'Plain Shoe', sourceKey: 's1', price: 100, priceText: '100', url: 'https://shop.example/p/1', image: '', images: [] },
  { title: 'Coded Shoe (کد 9)', sourceKey: 's2', price: 200, priceText: '200', url: 'https://shop.example/p/2', image: '', images: [] },
];
const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://results.test'), method = String(init.method || 'GET').toUpperCase();
  const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/profiles' && method === 'GET') return json({ ok: true, profiles });
  if (url.pathname === '/api/profiles/p1/products') return json({ ok: true, total: products.length, products });
  if (url.pathname === '/api/connections' && method === 'POST') return json({ ok: true, connections: {} });
  if (url.pathname === '/api/connections') return json({ ok: true, connections: {} });
  if (url.pathname === '/api/status') return json({ ok: true, version: '9.9.9-test', databaseReady: true, connections: {} });
  if (url.pathname === '/health') return json({ ok: true, version: '9.9.9-test', databaseReady: true });
  if (url.pathname === '/api/settings') return json({ ok: true, settings: {} });
  if (url.pathname === '/api/jobs') return json({ ok: true, jobs: [] });
  if (url.pathname === '/api/import/history') return json({ ok: true, items: [] });
  if (url.pathname === '/api/runtime/libraries') return json({ ok: true, libraries: [] });
  return json({ ok: true });
};

const { window } = parseHTML(DASHBOARD);
const store = new Map();
const localStorage = { getItem: (key) => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key), clear: () => store.clear() };
for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location || { pathname: '/' }, history: window.history, HTMLElement: window.HTMLElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, CustomEvent: window.CustomEvent, localStorage, alert: () => {}, confirm: () => true, fetch: mockFetch, requestAnimationFrame: (callback) => setTimeout(callback, 0), setInterval: () => 0, clearInterval: () => {} })) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.focus = () => {};
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, get() { return this.querySelector('option[selected]')?.getAttribute('value') ?? this.querySelector('option')?.getAttribute('value') ?? ''; }, set(value) { for (const option of this.querySelectorAll('option')) { if ((option.getAttribute('value') ?? option.textContent) === String(value)) option.setAttribute('selected', ''); else option.removeAttribute('selected'); } } });
const failures = [];
process.on('unhandledRejection', (error) => failures.push(error));
try { (0, eval)(`${DASHBOARD_JS}\n;globalThis.__resultsTest={state,$};`); } catch (error) { failures.push(error); }
const view = globalThis.__resultsTest;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(fn, label, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(10);
  }
}

test('results tab: show-results renders plain and coded products alike', async () => {
  await waitFor(() => document.getElementById('loadProducts'), 'show-results button');
  await waitFor(() => view.state.connected, 'dashboard boot');
  assert.equal(failures.length, 0, failures.map((error) => error?.stack || String(error)).join('\n'));
  const sel = document.getElementById('productProfile');
  await waitFor(() => sel.querySelector('option[value="p1"]'), 'profile option');
  sel.value = 'p1';
  document.getElementById('loadProducts').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('#products .product').length === 2, 'both product cards');
  const titles = [...document.querySelectorAll('#products .product .ptitle')].map((el) => el.textContent);
  assert.ok(titles[0] === 'Plain Shoe', `plain product shows its stored title without a display-only suffix, got: ${titles[0]}`);
  assert.ok(titles[1].includes('(کد 9)'), `coded product keeps its title suffix, got: ${titles[1]}`);
  assert.equal(failures.length, 0, failures.map((error) => error?.stack || String(error)).join('\n'));
});
