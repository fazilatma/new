import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

/**
 * Real-DOM tests for the searchable master-model dropdown: the candidates
 * panel renders a search box over a hidden bound select, typing filters the
 * model list case-insensitively, picking stores the model key through the
 * same change/autosave path the old select used, and Escape/Enter behave.
 * The dashboard bundle is the real worker-src/dashboard.ts served to every
 * environment; only network and timers are stubbed.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-master-combo-'));
await build({ entryPoints: { dashboard: new URL('../worker-src/dashboard.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')));

const providers = [
  { id: 'p1', name: 'Provider One', baseUrl: 'https://ai.example', apiKey: 'k', models: ['alpha', 'beta'], enabled: true },
  { id: 'p2', name: 'Provider Two', baseUrl: 'https://ai.example', apiKey: 'k', models: ['gamma'], enabled: true },
];
let connections = { ai: { providers, candidates: [], master: 'p1::beta', model: '' }, woo: {}, basalam: { shops: [] } };
const postedBodies = [];
const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://combo.test'), method = String(init.method || 'GET').toUpperCase();
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/connections' && method === 'POST') { postedBodies.push(JSON.parse(String(init.body || '{}'))); connections = postedBodies[postedBodies.length - 1]; return json({ ok: true, connections }); }
  if (url.pathname === '/api/connections') return json({ ok: true, connections });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [] });
  if (url.pathname === '/api/status') return json({ ok: true, version: '1.175.0', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '1.175.0', databaseReady: true });
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
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__comboTest={state,$,saveConnections,pickMasterValue,renderMasterList,get autoSaveTimer(){return autoSaveTimer}};'); } catch (error) { failures.push(error); }
const combo = globalThis.__comboTest;
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
const visibleItems = () => [...document.querySelectorAll('#aiMasterList .combo-item')].map(item => item.textContent);

test('the master picker keeps a hidden bound select and shows the current label', async () => {
  await waitFor(() => document.getElementById('aiMasterSearch'), 'master search box');
  await waitFor(() => combo.state.connected, 'dashboard boot');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  const select = document.getElementById('aiMasterPin');
  assert.ok(select, 'hidden select exists');
  assert.equal(select.tagName, 'SELECT');
  assert.equal(select.dataset.connection, 'ai.master', 'the save/apply binding still points at ai.master');
  assert.equal(select.value, 'p1::beta');
  assert.equal(document.getElementById('aiMasterSearch').value, 'Provider One / beta', 'search box shows the pinned master label');
});

test('typing filters the model list case-insensitively', async () => {
  const input = document.getElementById('aiMasterSearch'), list = document.getElementById('aiMasterList');
  input.dispatchEvent(new window.Event('focus'));
  assert.equal(list.hidden, false);
  assert.deepEqual(visibleItems(), ['خودکار (بهترین مدل گفت‌وگویی)', 'Provider One / alpha', 'Provider One / beta', 'Provider Two / gamma']);
  input.value = 'GAM';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(visibleItems(), ['Provider Two / gamma']);
  input.value = 'provider one';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(visibleItems(), ['Provider One / alpha', 'Provider One / beta']);
  input.value = 'zzz-no-such-model';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(visibleItems(), []);
  assert.match(list.textContent, /موردی پیدا نشد/);
});

test('picking a model stores its key through autosave', async () => {
  const input = document.getElementById('aiMasterSearch'), list = document.getElementById('aiMasterList'), select = document.getElementById('aiMasterPin');
  input.value = 'gamma';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const item = list.querySelector('[data-master-value="p2::gamma"]');
  assert.ok(item, 'the filtered model is clickable');
  item.dispatchEvent(new window.Event('mousedown', { bubbles: true }));
  assert.equal(select.value, 'p2::gamma', 'the hidden select carries the model key, not the label');
  assert.equal(input.value, 'Provider Two / gamma');
  assert.equal(list.hidden, true);
  await waitFor(() => postedBodies.length > 0, 'autosave POST');
  assert.equal(postedBodies[postedBodies.length - 1].ai.master, 'p2::gamma', 'the picked key is persisted to the server');
  assert.equal(combo.state.connections.ai.master, 'p2::gamma');
});

test('Escape reverts the text and Enter picks the first match', async () => {
  const input = document.getElementById('aiMasterSearch'), list = document.getElementById('aiMasterList'), select = document.getElementById('aiMasterPin');
  input.dispatchEvent(new window.Event('focus'));
  input.value = 'half-typed query';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const escape = new window.Event('keydown', { bubbles: true, cancelable: true });
  escape.key = 'Escape';
  input.dispatchEvent(escape);
  assert.equal(list.hidden, true);
  assert.equal(input.value, 'Provider Two / gamma', 'abandoned text reverts to the stored choice');
  input.dispatchEvent(new window.Event('focus'));
  input.value = 'alpha';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  const enter = new window.Event('keydown', { bubbles: true, cancelable: true });
  enter.key = 'Enter';
  input.dispatchEvent(enter);
  assert.equal(select.value, 'p1::alpha', 'Enter picks the first filtered model');
  assert.equal(input.value, 'Provider One / alpha');
  clearTimeout(combo.autoSaveTimer);
  await sleep(50);
  assert.equal(failures.length, 0, 'no late failures: ' + failures.map(error => error?.stack || String(error)).join('\n'));
});
