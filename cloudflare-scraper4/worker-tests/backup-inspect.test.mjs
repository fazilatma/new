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
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/settings-export') return json(bundle);
  if (url.pathname === '/api/connections') return json({ ok: true, connections: { ai: { providers: [], candidates: [] }, woo: {}, basalam: { shops: [] } } });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [] });
  if (url.pathname === '/api/status') return json({ ok: true, version: '1.167.0', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '1.167.0', databaseReady: true });
  if (url.pathname === '/api/settings') return json({ ok: true, settings: {} });
  if (url.pathname === '/api/jobs') return json({ ok: true, jobs: [] });
  if (url.pathname === '/api/ai/test-runs/current' || url.pathname === '/api/destination/basalam/category-runs/current') return json({ ok: true, run: null });
  if (url.pathname === '/api/import/history') return json({ ok: true, items: [] });
  if (url.pathname === '/api/runtime/libraries') return json({ ok: true, libraries: [] });
  if (url.pathname === '/api/ai/test-results') return json({ ok: true, results: [] });
  if (url.pathname === '/api/deployer/branches') {
    const repo = url.searchParams.get('repo') || 'fazilatma/new';
    if (!repo.includes('/')) return json({ ok: false, stage: 'list', error: 'INVALID', detail: 'Repo must look like owner/name.' }, 400);
    fetched.push('branches:' + repo);
    return json({ ok: true, repo, running: '1.167.0', cached: false, latest: 'arena/01a09468-new', branches: [
      { name: 'main', version: '1.160.0', status: 'older' },
      { name: 'arena/01a09468-new', version: '1.167.0', status: 'equal' }
    ] });
  }
  if (url.pathname === '/api/branch-files') {
    fetched.push('files:' + url.searchParams.get('branch') + ':' + url.searchParams.get('path'));
    return json({ ok: true, repo: 'fazilatma/new', branch: 'arena/01a09468-new', path: 'backups', files: [
      { name: 'nightly-new.json', path: 'backups/nightly-new.json', size: 42, sha: 'n' },
      { name: 'nightly-old.json', path: 'backups/nightly-old.json', size: 40, sha: 'o' }
    ] });
  }
  if (url.pathname === '/api/branch-file') {
    fetched.push('file:' + url.searchParams.get('path'));
    return json({ ok: true, name: 'nightly-new.json', size: bundle.total_bytes, bundle });
  }
  return json({ ok: true });
};
const fetched = [];

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
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__backupTest={state,$,inspectSettingsBundle,renderBackupSummaryHtml,openRestoreSectionsModal,inspectBackupFile,doFullBackup,renderLastBackup,doBootstrapDownload,renderBootstrapStatus,scanDeployerBranches,refreshBranchFiles,doBranchRestore,syncBranchDropdown,currentBranchRepo};'); } catch (error) { failures.push(error); }
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

test('boot shows the unified backup panel and a menu shortcut', async () => {
  await waitFor(() => document.getElementById('unifiedBackupDetails'), 'unified backup panel');
  await waitFor(() => backup.state.connected, 'dashboard boot');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  assert.ok(document.querySelector('[data-ma="goto-backup"]'), 'the menu keeps a shortcut to the unified panel');
  assert.equal(document.getElementById('backupLastLine'), null, 'no second last-backup line anymore');
  assert.equal(document.getElementById('sxFile'), null, 'no second restore file input anymore');
  assert.match(document.getElementById('bkLastLine').textContent, /هنوز بکاپی گرفته نشده/);
  assert.ok(document.querySelector('[data-ma="backup-full"]'), 'one-click full backup button is rendered');
  assert.ok(document.querySelector('[data-ma="backup-inspect"]'), 'inspect button is rendered');
  assert.ok(document.querySelector('[data-ma="branch-restore"]'), 'branch restore button is rendered');
  assert.equal(document.getElementById('bkRepo'), null, 'dead scheduled-push controls are gone');
  const push = [...document.querySelectorAll('#unifiedBackupDetails button')].find(b => b.textContent.includes('پوش بکاپ'));
  assert.ok(push && push.disabled, 'branch push stays disabled without a token');
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
  assert.match(document.getElementById('bkLastLine').textContent, /آخرین بکاپ/);
  assert.match(document.getElementById('bkLastLine').textContent, new RegExp(remembered.name));
  assert.match(document.querySelector('#resultModal .result-body').textContent, /بستهٔ تنظیمات/);
  assert.equal(failures.length, 0, 'no late failures: ' + failures.map(error => error?.stack || String(error)).join('\n'));
});

test('bootstrap restore controls live in the unified panel', async () => {
  assert.equal(document.querySelectorAll('[data-ma="backup-bootstrap"]').length, 1, 'the unified panel offers the bootstrap download');
  await backup.renderBootstrapStatus();
  assert.equal(document.getElementById('backupBootstrapLine'), null, 'no second bootstrap line anymore');
  assert.match(document.getElementById('bkBootstrapLine').textContent, /بوت‌استرپ/);
});

test('one-click bootstrap download uses the fixed name and shows the Render guide', async () => {
  await backup.doBootstrapDownload();
  assert.ok(downloadedBlob, 'a file download was triggered');
  assert.deepEqual(JSON.parse(await downloadedBlob.text()), bundle, 'the bootstrap file is the unfiltered full bundle');
  const remembered = JSON.parse(store.get('scraper4:last-backup'));
  assert.equal(remembered.name, 'render-bootstrap.json');
  assert.equal(remembered.sections, 'بوت‌استرپ رندر (نام ثابت)');
  assert.match(document.getElementById('transferStatus').textContent, /بوت‌استرپ آماده شد/);
  assert.match(document.querySelector('#resultModal .result-head').textContent, /راهنمای بوت‌استرپ/);
  const body = document.querySelector('#resultModal .result-body').textContent;
  assert.match(body, /render-bootstrap\.json/);
  assert.match(body, /Secret Files/);
  assert.match(body, /کامیت نکنید/);
  assert.equal(failures.length, 0, 'no late failures: ' + failures.map(error => error?.stack || String(error)).join('\n'));
});

test('branch scan fills the table and auto-selects the latest-version branch', async () => {
  await backup.scanDeployerBranches();
  const rows = [...document.querySelectorAll('#deployerBranches tbody tr')];
  assert.equal(rows.length, 2, 'both scanned branches render');
  assert.ok(rows.some(r => r.textContent.includes('arena/01a09468-new')), 'the session branch renders');
  assert.match(document.getElementById('deployerRunningVer').textContent, /۱\.۱۶۷\.۰|1\.167\.0/);
  assert.equal(document.getElementById('vcBranch').value, 'arena/01a09468-new', 'the latest-version branch is auto-selected');
  assert.match(document.getElementById('vcBranchStatus').textContent, /آخرین نسخه/);
  assert.ok(fetched.includes('branches:fazilatma/new'), 'the default repo is scanned');
});

test('branch files fill newest-first and the newest is pre-selected', async () => {
  await waitFor(() => document.getElementById('vcFile').value === 'backups/nightly-new.json', 'branch file list');
  const options = [...document.getElementById('vcFile').querySelectorAll('option')];
  assert.deepEqual(options.map(o => o.getAttribute('value')), ['backups/nightly-new.json', 'backups/nightly-old.json']);
  assert.match(document.getElementById('vcFileStatus').textContent, /۲ فایل/);
});

test('branch restore downloads the file and opens the section picker', async () => {
  await backup.doBranchRestore();
  assert.match(document.getElementById('transferStatus').textContent, /nightly-new\.json/);
  assert.match(document.querySelector('#resultModal .result-head').textContent, /انتخاب بخش/);
  const body = document.querySelector('#resultModal .result-body').textContent;
  assert.match(body, /بستهٔ تنظیمات/);
  assert.match(body, /arena\/01a09468-new\/nightly-new\.json/);
  assert.ok(document.querySelector('#resultModal [data-restore-confirm]'), 'explicit confirm is intact');
  assert.ok(fetched.includes('file:backups/nightly-new.json'), 'the selected file downloads');
});

test('a custom repo is validated and used for the scan', async () => {
  const repo = document.getElementById('vcRepo'), custom = document.getElementById('vcRepoCustom');
  repo.value = 'custom';
  repo.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(custom.closest('.crow').style.display, '', 'the custom input appears');
  assert.equal(backup.currentBranchRepo(), '', 'an empty custom repo is invalid');
  custom.value = 'acme/widgets';
  assert.equal(backup.currentBranchRepo(), 'acme/widgets');
  await backup.scanDeployerBranches();
  assert.ok(fetched.includes('branches:acme/widgets'), 'the custom repo is scanned');
  custom.value = 'not a repo';
  assert.equal(backup.currentBranchRepo(), '', 'a malformed custom repo is rejected');
  repo.value = 'fazilatma/new';
  repo.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(custom.closest('.crow').style.display, 'none', 'the custom input hides again');
  assert.equal(failures.length, 0, 'no late failures: ' + failures.map(error => error?.stack || String(error)).join('\n'));
});

test('the menu shortcut opens the unified panel', async () => {
  const details = document.getElementById('unifiedBackupDetails');
  details.open = false;
  document.querySelector('[data-ma="goto-backup"]').click();
  await sleep(20);
  assert.equal(details.open, true, 'the shortcut opens the unified panel');
});
