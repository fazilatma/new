import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

/**
 * Real-DOM tests for the enriched backup section: the file inspector counts
 * every section of a settings bundle (plus legacy/unknown formats), the
 * restore picker shows that summary before importing, one-click full backup
 * downloads and remembers itself, and both panels show the last backup.
 * The dashboard bundle is the real worker-src/dashboard.ts served to every
 * environment; only network and timers are stubbed.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-backup-inspect-'));
await build({ entryPoints: { dashboard: new URL('../worker-src/dashboard.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')));

const enc = value => { const text = JSON.stringify(value); return { size: Buffer.byteLength(text), b64: Buffer.from(text, 'utf8').toString('base64') }; };
const bundle = {
  app: 'scraper', version: 'cloudflare-1.0', created_at: 1757800000, created_at_h: '2026-09-13T20:26:40.000Z',
  host: 'backup-test-box', kind: 'settings-export', format: 'scraper4-php-compatible',
  files: {
    'profiles.json': enc({ p1: { id: 'p1', name: 'فروشگاه یک' }, p2: { id: 'p2', name: 'فروشگاه دو' } }),
    'profile_products.json': enc({ p1: [['k1', {}], ['k2', {}]], p2: [['k3', {}]] }),
    'connections.json': enc({ woocommerce: { url: 'https://woo.example' }, basalam: { token: 't', shops: [{}, {}] }, ai: { providers: [{ id: 'x' }], candidates: ['x::m'], master: 'x::m' }, notifications: { bale: { token: 'b' } } }),
    'category_learning.json': enc([{}, {}]),
    'autoreply_log.json': enc([{}]),
    'mystery.json': enc({ a: 1 }),
    'broken.json': { size: 5, b64: '!!!not-base64!!!' },
  },
};
bundle.total_files = Object.keys(bundle.files).length;
bundle.total_bytes = Object.values(bundle.files).reduce((sum, x) => sum + (x.size || 0), 0);

const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://backup.test'), method = String(init.method || 'GET').toUpperCase();
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/settings-export') return json(bundle);
  if (url.pathname === '/api/connections') return json({ ok: true, connections: { ai: { providers: [], candidates: [] }, woo: {}, basalam: { shops: [] } } });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [] });
  if (url.pathname === '/api/status') return json({ ok: true, version: '1.165.0', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '1.165.0', databaseReady: true });
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
let downloadedBlob = null;
Object.defineProperty(URL, 'createObjectURL', { value: blob => { downloadedBlob = blob; return 'blob:backup-test'; }, writable: true, configurable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true, configurable: true });
const failures = [];
process.on('unhandledRejection', error => failures.push(error));
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__backupTest={state,$,inspectSettingsBundle,renderBackupSummaryHtml,openRestoreSectionsModal,inspectBackupFile,doFullBackup,renderLastBackup};'); } catch (error) { failures.push(error); }
const backup = globalThis.__backupTest;
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

test('boot shows the empty last-backup line in both panels', async () => {
  await waitFor(() => document.getElementById('backupLastLine'), 'menu backup section');
  await waitFor(() => backup.state.connected, 'dashboard boot');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  assert.match(document.getElementById('backupLastLine').textContent, /هنوز بکاپی گرفته نشده/);
  assert.match(document.getElementById('bkLastLine').textContent, /هنوز بکاپی گرفته نشده/);
  assert.ok(document.querySelector('[data-ma="backup-full"]'), 'one-click full backup button is rendered');
  assert.ok(document.querySelector('[data-ma="backup-inspect"]'), 'inspect button is rendered');
  assert.equal(document.getElementById('bkRepo'), null, 'dead scheduled-push controls are gone');
});

test('the inspector counts every section of a settings bundle', () => {
  const s = backup.inspectSettingsBundle(bundle);
  assert.equal(s.format, 'settings-bundle');
  assert.equal(s.exportedAt, '2026-09-13T20:26:40.000Z');
  assert.equal(s.host, 'backup-test-box');
  assert.equal(s.profiles, 2);
  assert.equal(s.products, 3);
  assert.equal(s.providers, 1);
  assert.equal(s.candidates, 1);
  assert.equal(s.master, 'x::m');
  assert.equal(s.hasWoo, true);
  assert.equal(s.hasBasalam, true);
  assert.equal(s.basalamShops, 2);
  assert.equal(s.hasNotif, true);
  assert.equal(s.learning, 2);
  assert.equal(s.autoreplyLog, 1);
  assert.deepEqual(s.unknownFiles, ['mystery.json']);
  assert.deepEqual(s.unreadable, ['broken.json']);
  assert.equal(s.warnings.length, 2);
  const html = backup.renderBackupSummaryHtml(s);
  assert.match(html, /بستهٔ تنظیمات/);
  assert.match(html, /فروشگاه یک/);
  assert.match(html, /۳ محصول در ۲ پروفایل/);
  assert.match(html, /۲ غرفه/);
  assert.match(html, /mystery\.json/);
  assert.match(html, /broken\.json/);
});

test('the inspector recognizes legacy and unknown formats', () => {
  const legacy = backup.inspectSettingsBundle({ app: 'scraper4-backup', version: 1, profiles: [{}, {}], products: [{}], jobs: [], states: [{}, {}, {}] });
  assert.equal(legacy.format, 'legacy-backup');
  assert.equal(legacy.profiles, 2);
  assert.equal(legacy.products, 1);
  const unknown = backup.inspectSettingsBundle({ hello: 'world' });
  assert.equal(unknown.format, 'unknown');
  assert.equal(unknown.rows.length, 0);
  assert.match(backup.renderBackupSummaryHtml(unknown), /ساختار ناشناخته/);
  assert.equal(backup.inspectSettingsBundle(null).format, 'unknown');
});

test('the restore picker shows the file summary above the section list', () => {
  backup.openRestoreSectionsModal({ name: 'nightly.json' }, bundle);
  const body = document.querySelector('#resultModal .result-body').textContent;
  assert.match(body, /بستهٔ تنظیمات/);
  assert.match(body, /nightly\.json/);
  assert.match(body, /۲ پروفایل/);
  assert.match(body, /connections\.json/);
  assert.ok(document.querySelector('#resultModal [data-restore-sec="profiles-settings"]'), 'section checkboxes are intact');
  assert.ok(document.querySelector('#resultModal [data-restore-confirm]'), 'explicit confirm is intact');
});

test('inspecting a file opens the summary with a continue path', async () => {
  const file = new File([JSON.stringify(bundle)], 'picked.json', { type: 'application/json' });
  await backup.inspectBackupFile(file);
  assert.match(document.querySelector('#resultModal .result-head').textContent, /بررسی فایل بکاپ/);
  assert.match(document.querySelector('#resultModal .result-body').textContent, /backup-test-box/);
  assert.ok(document.querySelector('#resultModal [data-inspect-restore]'), 'continue-to-restore button is offered');
  assert.match(document.getElementById('transferStatus').textContent, /picked\.json/);
  await assert.rejects(() => backup.inspectBackupFile(new File(['   '], 'empty.json')), /خالی است/);
});

test('one-click full backup downloads, reports and remembers itself', async () => {
  await backup.doFullBackup();
  assert.ok(downloadedBlob, 'a file download was triggered');
  assert.deepEqual(JSON.parse(await downloadedBlob.text()), bundle, 'the full bundle downloads unfiltered');
  assert.match(document.getElementById('transferStatus').textContent, /بکاپ کامل شد/);
  const remembered = JSON.parse(store.get('scraper4:last-backup'));
  assert.match(remembered.name, /^backup_full_.*\.json$/);
  assert.equal(remembered.sections, 'کامل (همهٔ بخش‌ها)');
  assert.match(document.getElementById('backupLastLine').textContent, /آخرین بکاپ/);
  assert.match(document.getElementById('backupLastLine').textContent, new RegExp(remembered.name));
  assert.match(document.getElementById('bkLastLine').textContent, new RegExp(remembered.name));
  assert.match(document.querySelector('#resultModal .result-body').textContent, /بستهٔ تنظیمات/);
  assert.equal(failures.length, 0, 'no late failures: ' + failures.map(error => error?.stack || String(error)).join('\n'));
});
