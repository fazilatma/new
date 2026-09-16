import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

/**
 * Per-profile enricher switch: the profile form carries an AI-descriptions
 * checkbox (default ON), editProfile reflects the stored flag, and
 * profileBody persists it. The dashboard bundle is the real
 * worker-src/dashboard.ts; only network and timers are stubbed.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-ai-profile-switch-'));
await build({ entryPoints: { dashboard: new URL('../worker-src/dashboard.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')));

const connections = { ai: { providers: [], candidates: [], master: '', model: '' }, woo: {}, basalam: { shops: [] } };
const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://profile.test'), method = String(init.method || 'GET').toUpperCase();
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/connections' && method === 'POST') return json({ ok: true, connections });
  if (url.pathname === '/api/connections') return json({ ok: true, connections });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [] });
  if (url.pathname === '/api/status') return json({ ok: true, version: '1.179.0', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '1.179.0', databaseReady: true });
  if (url.pathname === '/api/settings') return json({ ok: true, settings: {} });
  if (url.pathname === '/api/jobs') return json({ ok: true, jobs: [] });
  if (url.pathname === '/api/ai/test-runs/current' || url.pathname === '/api/destination/basalam/category-runs/current') return json({ ok: true, run: null });
  if (url.pathname === '/api/import/history') return json({ ok: true, items: [] });
  if (url.pathname === '/api/runtime/libraries') return json({ ok: true, libraries: [] });
  if (url.pathname === '/api/ai/test-results') return json({ ok: true, results: [] });
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
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__profileTest={state,editProfile,profileBody,clearForm};'); } catch (error) { failures.push(error); }
const ui = globalThis.__profileTest;
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
const fakeProfile = (over = {}) => ({
  id: 'p1', name: 'P1', url: 'https://shop.example', pages: 0, pagination: 'query_page', paginationValue: 'page',
  extractionEngine: 'auto', intervalMinutes: 60, titleSuffix: '', priceMode: 'none', priceValue: 0,
  roundPrice: 0, minPrice: 0, wooCategoryId: 0, basalamCategoryId: 0, basalamFallbackCategoryIds: [],
  enabled: true, networkIndirect: false, noExtract: false, syncWoo: false, syncBasalam: false,
  selectors: {}, gallery: null, ...over,
});

test('the profile form carries the enricher switch, defaulting ON', async () => {
  await waitFor(() => ui.state.connected, 'dashboard boot');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  const box = document.getElementById('aiDescriptions');
  assert.ok(box, 'the aiDescriptions checkbox exists');
  assert.equal(box.type, 'checkbox');
  ui.clearForm();
  assert.equal(box.checked, true, 'a fresh form leaves the enricher ON');
});

test('editProfile reflects the stored per-profile flag', async () => {
  ui.state.profiles = [fakeProfile({ id: 'off', aiDescriptions: false }), fakeProfile({ id: 'legacy' })];
  ui.editProfile('off', false);
  assert.equal(document.getElementById('aiDescriptions').checked, false);
  ui.editProfile('legacy', false);
  assert.equal(document.getElementById('aiDescriptions').checked, true, 'profiles stored before the switch stay ON');
});

test('profileBody persists the switch with the profile', async () => {
  document.getElementById('aiDescriptions').checked = false;
  assert.equal(ui.profileBody().aiDescriptions, false);
  document.getElementById('aiDescriptions').checked = true;
  assert.equal(ui.profileBody().aiDescriptions, true);
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
});
