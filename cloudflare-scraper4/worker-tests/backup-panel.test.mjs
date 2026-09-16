import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

/**
 * Real-DOM tests for the redesigned backup/version panel: three numbered
 * step tabs (each pane visible alone), every pane split into numbered step
 * cards, long guides collapsed, and a mobile layout that stacks tabs and
 * stretches action buttons full-width. Same controls, same IDs, same
 * actions — only the structure and styling changed.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-backup-panel-'));
await build({ entryPoints: { dashboard: new URL('../worker-src/dashboard.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')));

const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://panel.test'), method = String(init.method || 'GET').toUpperCase();
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/connections') return json({ ok: true, connections: { ai: { providers: [], candidates: [] }, woo: {}, basalam: { shops: [] } } });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [] });
  if (url.pathname === '/api/status') return json({ ok: true, version: '9.9.9-test', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '9.9.9-test', databaseReady: true });
  if (url.pathname === '/api/settings') return json({ ok: true, settings: {} });
  if (url.pathname === '/api/github/token-status') return json({ ok: true, active: null, env: false, stored: false, hint: null });
  if (url.pathname === '/api/branch-push-status') return json({ ok: true, last: null });
  if (url.pathname === '/api/jobs') return json({ ok: true, jobs: [] });
  if (url.pathname === '/api/ai/test-runs/current' || url.pathname === '/api/destination/basalam/category-runs/current') return json({ ok: true, run: null });
  if (url.pathname === '/api/import/history') return json({ ok: true, items: [] });
  if (url.pathname === '/api/runtime/libraries') return json({ ok: true, environment: 'test', groups: [] });
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
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__panelTest={state,$};'); } catch (error) { failures.push(error); }
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

test('backup panel: three numbered step tabs, one pane visible at a time', async () => {
  await waitFor(() => document.getElementById('unifiedBackupDetails'), 'unified backup panel');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  const tabs = [...document.querySelectorAll('.utabs [data-utab]')];
  assert.deepEqual(tabs.map(b => b.getAttribute('data-utab')), ['backup', 'branch', 'version']);
  assert.deepEqual(tabs.map(b => b.querySelector('.utab-num')?.textContent), ['۱', '۲', '۳'], 'every tab carries its step number');
  for (const tab of tabs) assert.ok(tab.querySelector('.utab-text small')?.textContent.length > 2, 'every tab explains itself in one line');
  // The panes must actually hide: the tab CSS was missing entirely, so all
  // three panes used to render stacked no matter which tab was active.
  const css = document.querySelector('style').textContent;
  assert.ok(css.includes('.utup{display:none}'), 'inactive panes hide');
  assert.ok(css.includes('.utup.active{display:block}'), 'the active pane shows');
  assert.ok(document.getElementById('utup-backup').classList.contains('active'));
  document.querySelector('[data-utab="version"]').click();
  await sleep(30);
  assert.ok(document.getElementById('utup-version').classList.contains('active'));
  assert.ok(!document.getElementById('utup-backup').classList.contains('active'));
  document.querySelector('[data-utab="backup"]').click();
  await sleep(30);
});

test('backup panel: every pane splits into three numbered step cards', async () => {
  await waitFor(() => document.getElementById('unifiedBackupDetails'), 'unified backup panel');
  for (const pane of ['utup-backup', 'utup-branch', 'utup-version']) {
    const steps = [...document.querySelectorAll(`#${pane} .ustep`)];
    assert.equal(steps.length, 3, `${pane} must hold exactly three step cards`);
    assert.deepEqual(steps.map(s => s.querySelector('.ustep-num')?.textContent), ['۱', '۲', '۳'], `${pane} steps are numbered`);
    for (const s of steps) assert.ok(s.querySelector('.ustep-title')?.textContent.length > 2, `${pane} step heads carry a title`);
  }
  assert.equal(document.getElementById('bkLastLine').closest('.ustep').querySelector('.ustep-num').textContent, '۱', 'last-backup line lives in backup step 1');
  assert.equal(document.getElementById('bkFile').closest('.ustep').querySelector('.ustep-num').textContent, '۲', 'restore picker lives in backup step 2');
  assert.equal(document.getElementById('bkBootstrapLine').closest('.ustep').querySelector('.ustep-num').textContent, '۳', 'bootstrap lives in backup step 3');
  assert.equal(document.getElementById('vcRepo').closest('.ustep').querySelector('.ustep-num').textContent, '۱', 'repo picker lives in branch step 1');
  assert.equal(document.getElementById('vcFile').closest('.ustep').querySelector('.ustep-num').textContent, '۲', 'backup picker lives in branch step 2');
  assert.ok(document.querySelector('#utup-branch .ustep:nth-of-type(3) [data-ma="branch-push"]'), 'push lives in branch step 3');
  assert.ok(document.querySelector('#utup-version [data-ma="version-info"]').closest('.ustep').querySelector('.ustep-num').textContent === '۱', 'version check lives in version step 1');
  assert.equal(document.getElementById('deployerBranches').closest('.ustep').querySelector('.ustep-num').textContent, '۳', 'branch table lives in version step 3');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
});

test('backup panel: long guides collapse and the status line keeps its card', async () => {
  await waitFor(() => document.getElementById('unifiedBackupDetails'), 'unified backup panel');
  const helps = [...document.querySelectorAll('#unifiedBackupDetails details.uhelp')];
  assert.equal(helps.length, 2, 'the two long guides collapse into one row each');
  assert.ok(helps.every(d => d.querySelector('summary') && d.querySelector('.help-box')), 'each collapsed guide keeps its help text');
  assert.ok(document.querySelector('#unifiedBackupDetails details.sched-push'), 'the scheduled-push fold survives the redesign');
  const status = document.getElementById('transferStatus');
  assert.equal(status.closest('.ustep').querySelector('.ustep-title').textContent, 'وضعیت آخرین عملیات', 'the shared status line keeps its own card');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
});

test('backup panel: the mobile layout stacks tabs and stretches buttons', async () => {
  const css = document.querySelector('style').textContent;
  const mobile = css.slice(css.indexOf('@media(max-width:700px){.utabs{grid-template-columns:1fr}'));
  assert.ok(mobile.startsWith('@media(max-width:700px){.utabs{grid-template-columns:1fr}'), 'tabs stack full-width on phones');
  assert.ok(mobile.includes('.utup .menu-actions{display:grid;grid-template-columns:1fr'), 'actions stack on phones');
  assert.ok(mobile.includes('.utup .menu-actions .btn{width:100%;min-height:46px'), 'buttons become full-width touch targets');
});
