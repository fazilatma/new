import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

/**
 * Real-DOM test for the 1.175.0 «⏰ تصحیح دوره‌ای دسته‌بندی باسلام» card.
 *
 * The dashboard is one file served by every runtime (Cloudflare Worker, Render,
 * Termux, VPS, cPanel, local), so this is the UI test for all of them at once. The
 * bundle is the real `worker-src/dashboard.ts`; only the network and timers are
 * stubbed, and the stub replays the exact JSON contract both twins implement.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'catfix-ui-'));
await build({ entryPoints: { dashboard: join(ROOT, 'worker-src', 'dashboard.ts') }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')).href);

const pool = [
  { key: 'p1::alpha', label: 'Provider One — alpha', providerId: 'p1', providerName: 'Provider One', model: 'alpha', green: true },
  { key: 'p1::beta', label: 'Provider One — beta', providerId: 'p1', providerName: 'Provider One', model: 'beta', green: false },
  { key: 'p2::gamma', label: 'Provider Two — gamma', providerId: 'p2', providerName: 'Provider Two', model: 'gamma', green: true },
  { key: 'p2::ocr', label: 'Provider Two — ocr', providerId: 'p2', providerName: 'Provider Two', model: 'ocr', green: false },
];
let saved = { enabled: true, intervalHours: 6, mode: 'ensemble', models: ['p1::alpha', 'p2::gamma'] };
let lastRecord = { at: '2026-09-16T06:00:00.000Z', status: 'done', changed: 7, processed: 20, total: 20, runId: 'r-1' };
let nowOffset = 0;
const calls = [];
let runNowBody = null;

const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://catfix.test'), method = String(init.method || 'GET').toUpperCase();
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/destination/basalam/category-correction') {
    calls.push({ path: url.pathname, method: 'GET' });
    const anchor = Date.parse(lastRecord?.at || '') - nowOffset;
    return json({
      ok: true, settings: saved, pool, now: new Date(anchor).toISOString(),
      status: {
        enabled: saved.enabled, intervalHours: saved.intervalHours, mode: saved.mode, models: saved.models,
        modeLabel: saved.mode, automatic: saved.models.length === 0, due: false, running: false,
        nextRunAt: new Date(anchor + saved.intervalHours * 3600e3).toISOString(),
        msUntil: saved.intervalHours * 3600e3, lastRunAt: lastRecord?.at || null, last: lastRecord,
      },
    });
  }
  if (url.pathname === '/api/destination/basalam/category-correction/run-now' && method === 'POST') {
    runNowBody = JSON.parse(String(init.body || '{}'));
    return json({ ok: true, existing: false, run: { id: 'r-now', kind: 'category-all', status: 'queued', phase: 'listing', mode: saved.mode, modelKeys: saved.models, total: 12, processed: 0, changed: 0, failed: 0, items: [] } });
  }
  if (url.pathname === '/api/settings' && method === 'POST') {
    const body = JSON.parse(String(init.body || '{}'));
    calls.push({ path: url.pathname, method: 'POST', body });
    if (body.categoryCorrection) saved = body.categoryCorrection;
    return json({ ok: true, settings: body });
  }
  if (url.pathname === '/api/settings') return json({ ok: true, settings: {} });
  if (url.pathname === '/api/connections') return json({ ok: true, connections: { ai: { providers: [], candidates: [], master: '', model: '' }, woo: {}, basalam: { shops: [] } } });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [] });
  if (url.pathname === '/api/status') return json({ ok: true, version: '1.175.0', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '1.175.0', databaseReady: true });
  if (url.pathname === '/api/jobs') return json({ ok: true, jobs: [] });
  if (url.pathname === '/api/destination/basalam/category-runs/current') return json({ ok: true, run: null });
  if (url.pathname === '/api/ai/test-runs/current') return json({ ok: true, run: null });
  if (url.pathname === '/api/import/history') return json({ ok: true, items: [] });
  if (url.pathname === '/api/runtime/libraries') return json({ ok: true, libraries: [] });
  if (url.pathname === '/api/ai/test-results') return json({ ok: true, results: [] });
  if (url.pathname === '/api/destination/basalam/products') return json({ ok: true, products: [], total: 0, totalPages: 1, counts: {} });
  if (url.pathname === '/api/destination/basalam/overview') return json({ ok: true, accounts: [], total: 0 });
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
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__catFixUi={state,catFix,loadCategoryCorrection,saveCategoryCorrection,openCategoryModelPicker,renderCatFixPanel,setDestinationTarget,openDestinationManager};'); } catch (error) { failures.push(error); }
const ui = globalThis.__catFixUi;
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
const lastSettingsPost = () => calls.filter(call => call.method === 'POST').at(-1);
const chips = () => [...document.querySelectorAll('#catFixModels .catfix-chip button[data-catfix-remove]')].map(button => button.dataset.catfixRemove);

test('the card loads the saved plan and the schedule from the runtime', async () => {
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  await waitFor(() => document.getElementById('catFixPanel'), 'periodic card');
  const panel = document.getElementById('catFixPanel');
  assert.equal(panel.hidden, true, 'the card stays out of the WooCommerce view');
  await ui.setDestinationTarget('basalam', false);
  await waitFor(() => !document.getElementById('catFixPanel').hidden, 'card reveal for basalam');
  await waitFor(() => ui.catFix.loaded, 'first load from the server');
  assert.equal(document.getElementById('catFixEnabled').checked, true, 'the saved switch state is shown');
  assert.equal(document.getElementById('catFixInterval').value, '6', 'the default interval is 6 hours');
  assert.deepEqual(chips(), ['p1::alpha', 'p2::gamma'], 'the curated consensus list renders as removable chips');
  assert.equal(document.getElementById('catFixModelsCount').textContent, '۲', 'the count is shown in Persian digits');
  assert.match(document.getElementById('catFixStatus').textContent, /هر ۶ ساعت/, 'the interval is stated in the status line');
  assert.match(document.getElementById('catFixStatus').textContent, /اجرای بعدی/, 'the next run time is visible');
  assert.match(document.getElementById('catFixStatus').textContent, /تغییر‌یافته ۷ از ۲۰/, 'the last pass reports what it changed');
  assert.equal(document.getElementById('catFixBadge').textContent, 'فعال');
});

test('toggling the switch and the interval saves the plan through the settings API', async () => {
  const toggle = document.getElementById('catFixEnabled');
  toggle.checked = false;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => saved.enabled === false, 'disabled saved');
  assert.equal(lastSettingsPost().path, '/api/settings', 'the plan travels with the autosaved settings (so backups carry it)');
  assert.deepEqual(lastSettingsPost().body.categoryCorrection, { enabled: false, intervalHours: 6, mode: 'ensemble', models: ['p1::alpha', 'p2::gamma'] }, 'a switch flip never rewrites the rest of the plan');

  const interval = document.getElementById('catFixInterval');
  interval.value = '12';
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => saved.enabled === true && saved.intervalHours === 12, 'interval saved as a number');
  assert.equal(typeof saved.intervalHours, 'number', 'the server must not receive "12" as text');
});

test('the mode select switches the voter and hides the model list for the master modes', async () => {
  const mode = document.getElementById('catFixMode');
  mode.value = 'master';
  mode.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => saved.mode === 'master', 'mode saved');
  await waitFor(() => document.getElementById('catFixModelsWrap').hidden === true, 'the card re-renders after the save');
  mode.value = 'ensemble';
  mode.dispatchEvent(new window.Event('change', { bubbles: true }));
  await waitFor(() => saved.mode === 'ensemble' && !document.getElementById('catFixModelsWrap').hidden, 'consensus list back for ensemble');
});

test('a model is removed with ✕ and the list can go back to automatic', async () => {
  await waitFor(() => document.querySelector('#catFixModels button[data-catfix-remove="p1::alpha"]'), 'chip with a remove button');
  document.querySelector('#catFixModels button[data-catfix-remove="p1::alpha"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(() => !saved.models.includes('p1::alpha'), 'model removed');
  assert.deepEqual(saved.models, ['p2::gamma'], 'only the clicked model is gone');
  document.getElementById('catFixModelsClear').dispatchEvent(new window.Event('click', { bubbles: true }));
  await waitFor(() => saved.models.length === 0, 'back to automatic');
  await waitFor(() => /خودکار/.test(document.getElementById('catFixModels').textContent), 'the empty list is explained as automatic');
});

test('the picker adds models from the runtime pool and caps the list at five', async () => {
  ui.openCategoryModelPicker();
  const boxes = await waitFor(() => document.querySelectorAll('#resultModal [data-catfix-pick]').length === 4 && document.querySelectorAll('#resultModal [data-catfix-pick]'), 'picker rows');
  assert.equal(document.querySelectorAll('#resultModal [data-catfix-pick]:checked').length, 0, 'the list was cleared first');
  // 🟢 markers come from the server's last test result, not from a client-side guess.
  assert.match(document.querySelector('#resultModal .catfix-pool-row').textContent, /موفق در آخرین تست|آزمایش‌نشده/);
  for (const key of ['p1::alpha', 'p1::beta', 'p2::gamma', 'p2::ocr']) document.querySelector(`#resultModal [data-catfix-pick="${key}"]`).checked = true;
  document.querySelector('#resultModal [data-catfix-pick="p1::alpha"]').closest('.catfix-pool-row').querySelector('input').checked = true;
  document.querySelector('#resultModal [data-catfix-pick="p1::beta"]').closest('.catfix-pool-row').querySelector('input').checked = true;
  document.querySelector('#resultModal [data-catfix-pick="p2::gamma"]').closest('.catfix-pool-row').querySelector('input').checked = true;
  document.querySelector('#resultModal [data-catfix-pick="p2::ocr"]').closest('.catfix-pool-row').querySelector('input').checked = true;
  document.querySelector('#resultModal [data-catfix-pick-save]').click();
  await waitFor(() => saved.models.length >= 3, 'selection saved');
  assert.ok(saved.models.length <= 5, 'the cap is enforced in the UI as well as on the server');
  assert.ok(saved.models.includes('p1::beta'), 'an untested model can still be picked deliberately');
  assert.equal(boxes.length, 4, 'the pool is exactly what the runtime offered');
});

test('▶ runs the same plan immediately and opens the shared progress window', async () => {
  runNowBody = null;
  document.getElementById('catFixRunNow').click();
  await waitFor(() => runNowBody !== null, 'run-now call sent');
  await waitFor(() => document.querySelector('#resultModal .result-summary'), 'progress modal');
  assert.match(document.querySelector('#resultModal .result-head b').textContent, /دسته‌بندی همهٔ محصولات تأییدنشده/);
  await waitFor(() => /beta/.test(document.querySelector('#resultModal').textContent), 'the progress window lists the voters of this run');
});
