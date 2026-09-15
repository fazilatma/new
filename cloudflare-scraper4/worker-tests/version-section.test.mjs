import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The version tab's legacy PHP-compatibility block (GitHub token, legacy
// deploy.php inputs) is retired: the deployer block takes its place with
// the same install-guide copy pipeline the other tabs already use.

async function dashboard() {
  return readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
}

// The branch-table logic ships as plain JS inside the dashboard bundle;
// slice it out (brace-balanced) and execute it with stubbed browser APIs.
function extractFns(src, names) {
  return names.map(name => {
    let start = src.indexOf(`function ${name}(`);
    assert.ok(start !== -1, `${name} must exist in the dashboard`);
    if (src.slice(start - 6, start) === 'async ') start -= 6;
    let depth = 0, end = src.indexOf('{', start);
    for (; end < src.length; end++) {
      if (src[end] === '{') depth++;
      else if (src[end] === '}') { depth--; if (!depth) break; }
    }
    return src.slice(start, end + 1);
  }).join('\n');
}

function loadBranchTable(src, stubs) {
  const factory = new Function('$', 'api', 'fetch', 'esc', 'escAttr', 'location', 'window', 'navigator', 'document', 'notice', 'localStorage', 'fa', 'confirm', 'openResultModal',
    `${extractFns(src, ['deployerEnvKind', 'deployerBranchChip', 'deployerBranchErrorText', 'scanDeployerBranches', 'deployerBranchAction', 'currentBranchRepo', 'syncBranchDropdown', 'refreshBranchFiles', 'loadBranchBackup', 'saveBranchBackup', 'installBranchVersion', 'branchInstallSnippet', 'copyTextToClipboard'])}
     return { deployerEnvKind, deployerBranchChip, deployerBranchErrorText, scanDeployerBranches, deployerBranchAction, installBranchVersion, branchInstallSnippet };`);
  return factory(stubs.$, stubs.api, stubs.fetch, stubs.esc, stubs.escAttr, stubs.location,
    stubs.window, stubs.navigator, stubs.document, stubs.notice, stubs.localStorage, stubs.fa, stubs.confirm, stubs.openResultModal);
}

const TRIVIAL = { $: () => null, api: async () => ({}), fetch: async () => { throw Error('no network'); }, esc: s => s, escAttr: s => s, window: {}, navigator: {}, document: {}, notice: () => {}, localStorage: { getItem: () => null, setItem: () => {} }, fa: s => s, confirm: () => true, openResultModal: () => {} };

test('version tab: the unified backup panel hosts the deployer block', async () => {
  const text = await dashboard();
  for (const token of ['💾 بکاپ، بازیابی، نسخه و انتشار', 'unifiedBackupDetails', '🚀 دیپلویر و جدول برنچ‌ها', 'deployerEnvHint', 'renderDeployerEnvHint();',
    'data-copy-install=\\"deployer\\"', 'copyInstall-deployer', 'http://localhost:8790',
    '/api/version', 'CLOUDFLARE-WORKER.md']) {
    assert.ok(text.includes(token), `the deployer block must include ${token}`);
  }
  for (const probe of ['.workers.dev', '.onrender.com', 'localhost']) {
    assert.ok(text.includes(probe), `the environment hint must probe ${probe}`);
  }
});

test('version tab: the legacy PHP block is gone', async () => {
  const text = await dashboard();
  const start = text.indexOf('<div class="change-list">');
  const end = text.indexOf('<div id="changesResult"', start);
  const history = text.slice(start, end);
  // The live UI must not host PHP-compat controls; changelog history may mention them.
  for (const token of ['سازگاری PHP', 'vcDeployFile', 'vcGhToken', 'vcDepToken', 'deploy.php']) {
    const total = text.split(token).length - 1;
    const inHistory = history.split(token).length - 1;
    assert.equal(total, inHistory, `no live PHP-compat remnant may remain: ${token}`);
  }
});

test('version tab: the deployer install guide is a first-class group', async () => {
  const [text, pkg] = await Promise.all([
    dashboard(),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  const version = JSON.parse(pkg).version;
  const groups = JSON.parse(text.match(/const INSTALL_COMMAND_GROUPS=(\[[\s\S]*?\]);\n/)[1]);
  const group = groups.find(g => g.key === 'deployer');
  assert.ok(group, 'a deployer install group must exist');
  assert.ok(group.body.includes('npm run deployer:ui'), 'the group must run the local deployer');
  const claimed = group.body.match(/# Expected: (\d+\.\d+\.\d+)/);
  assert.ok(claimed, 'the group must state its expected version');
  assert.equal(claimed[1], version, 'the deployer guide must track the current version');
});

test('branches table: environment, chips and error text behave', async () => {
  const src = await dashboard();
  for (const [host, kind] of [['localhost', 'local'], ['127.0.0.1', 'local'], ['', 'local'],
    ['my.workers.dev', 'worker'], ['svc.onrender.com', 'render'], ['91.99.0.1', 'remote']]) {
    const { deployerEnvKind } = loadBranchTable(src, { ...TRIVIAL, location: { hostname: host } });
    assert.equal(deployerEnvKind(), kind, `${host || '(empty)'} must resolve to ${kind}`);
  }
  const { deployerBranchChip, deployerBranchErrorText } = loadBranchTable(src, { ...TRIVIAL, location: { hostname: '' } });
  assert.ok(deployerBranchChip('newer').includes('جدیدتر'));
  assert.ok(deployerBranchChip('older').includes('قدیمی‌تر'));
  assert.ok(deployerBranchChip('equal').includes('برابر'));
  assert.ok(deployerBranchChip('unknown').includes('نامشخص'));
  assert.ok(deployerBranchChip('bogus').includes('نامشخص'), 'an unknown status must degrade, not blank the cell');
  const rate = deployerBranchErrorText({ ok: false, stage: 'list', error: 'RATE_LIMIT', detail: 'HTTP 403' });
  assert.ok(rate.includes('محدودیت') && rate.includes('GH_BACKUP_TOKEN') && rate.includes('فهرست برنچ‌ها') && rate.includes('HTTP 403'));
  const forbidden = deployerBranchErrorText({ ok: false, stage: 'list', error: 'FORBIDDEN', detail: 'GitHub says: blocked' });
  assert.ok(forbidden.includes('رد کرد') && forbidden.includes('محدودیت نرخ نیست') && forbidden.includes('blocked'));
  assert.ok(deployerBranchErrorText({ ok: false, stage: 'list', error: 'UNREACHABLE', detail: 'boom' }).includes('از دست سرور'));
  assert.ok(deployerBranchErrorText(null).includes('پاسخ خالی'));
});

test('branches table: scan renders the server reply and per-env actions', async () => {
  const src = await dashboard();
  const box = { innerHTML: '' }, run = { textContent: '' };
  const opened = [], notices = [];
  const reply = {
    ok: true, running: '1.127.0', cached: true,
    branches: [
      { name: 'arena/01a09468-new', version: '1.160.0', status: 'newer' },
      { name: 'main', version: '', status: 'unknown' }
    ]
  };
  const branchSel = { innerHTML: '', value: '' }, fileSel = { innerHTML: '', value: '' };
  const stubs = {
    ...TRIVIAL, notice: (m, k) => notices.push([m, k]),
    $: id => ({ deployerBranches: box, deployerRunningVer: run, vcBranchStatus: { textContent: '' }, vcRepo: { value: 'fazilatma/new' }, vcBranch: branchSel, vcFile: fileSel, vcFileStatus: { textContent: '' }, vcPath: { value: 'backups' } }[id] || null),
    api: async path => {
      assert.ok(path.startsWith('/api/'), 'every call must be same-origin');
      if (path.startsWith('/api/branch-files')) return { ok: true, files: [] };
      assert.ok(path.startsWith('/api/deployer/branches?repo='), 'the scan must carry the selected repo');
      return reply;
    },
    fetch: async () => { throw Error('the client must never call GitHub directly'); },
    location: { hostname: 'localhost' }, window: { open: (...a) => opened.push(a), isSecureContext: true },
    navigator: { clipboard: { writeText: async () => {} } }
  };
  const { scanDeployerBranches, deployerBranchAction } = loadBranchTable(src, stubs);
  await scanDeployerBranches();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(branchSel.value, 'arena/01a09468-new', 'the newest-version branch must be pre-selected');
  assert.ok(run.textContent.includes('1.127.0'), 'the running version must be shown');
  assert.ok(run.textContent.includes('از کش'), 'a cached reply must say so');
  for (const token of ['pdest-table', 'arena/01a09468-new', '1.160.0', '—', 'جدیدتر', 'نامشخص', 'data-deployer-branch']) {
    assert.ok(box.innerHTML.includes(token), `the table must render ${token}`);
  }
  assert.ok(box.innerHTML.includes('نصب در دیپلویر'), 'localhost rows must offer the deployer install');
  await deployerBranchAction('arena/01a0803e-new');
  assert.deepEqual(opened, [['http://localhost:8790/#branches', '_blank', 'noreferrer']], 'localhost must deep-link the deployer branches tab');
  // Off-device the same button copies the branch name for the production-branch field.
  let copied = '';
  const remote = loadBranchTable(src, {
    ...stubs, location: { hostname: 'my.workers.dev' },
    navigator: { clipboard: { writeText: async t => { copied = t; } } }
  });
  await remote.scanDeployerBranches();
  assert.ok(box.innerHTML.includes('کپی نام برنچ'), 'remote rows must offer the branch-name copy');
  await remote.deployerBranchAction('arena/01a0803e-new');
  assert.equal(copied, 'arena/01a0803e-new');
  assert.ok(notices.some(([m, k]) => k === 'ok' && m.includes('کپی شد')), 'the copy must be acknowledged');
  // A failed scan names the stage and the cause instead of a bare error.
  await loadBranchTable(src, {
    ...stubs, api: async () => ({ ok: false, stage: 'list', error: 'RATE_LIMIT', detail: 'HTTP 403' })
  }).scanDeployerBranches();
  assert.ok(box.innerHTML.includes('خطا در خواندن برنچ‌ها'), 'the failure must keep its heading');
  assert.ok(box.innerHTML.includes('محدودیت') && box.innerHTML.includes('نرخ') && box.innerHTML.includes('HTTP 403'), 'the failure must name the cause');
});

test('branches table: wiring and deployer deep-link are in place', async () => {
  const text = await dashboard();
  for (const token of ['deployer-scan-branches', 'scanDeployerBranches();return', 'data-deployer-branch',
    'deployerBranchAction(dbr.dataset.deployerBranch)', '/api/deployer/branches', 'deployerBranchErrorText(data)',
    'deployerBranchChip(r.status)', 'localhost:8790/#branches', 'data-install-branch', 'اجرای نسخه',
    'installBranchVersion(ins.dataset.installBranch)', '/api/deployer/install-branch', 'branchInstallSnippet']) {
    assert.ok(text.includes(token), `the branches table must include ${token}`);
  }
  assert.ok(!text.includes('api.github.com'), 'the dashboard must not call GitHub from the browser (CSP)');
  assert.ok(!text.includes('raw.githubusercontent.com'), 'the dashboard must not fetch manifests from the browser (CSP)');
  const deployer = await readFile(new URL('../scripts/local-deployer-ui.mjs', import.meta.url), 'utf8');
  assert.ok(deployer.includes("location.hash==='#branches'"), 'the deployer must honor the #branches deep-link');
  assert.ok(deployer.includes('DEPLOYER_UI_TOKEN: token'), 'the deployer must share its control token with the scraper it spawns');
  assert.ok(deployer.includes('DEPLOYER_UI_PORT: String(port)'), 'the deployer must share its port with the scraper it spawns');
  const server = await readFile(new URL('../render-src/server.ts', import.meta.url), 'utf8');
  assert.ok(server.includes("app.post('/api/deployer/install-branch'"), 'the node scraper must proxy one install call to its deployer');
  assert.ok(server.includes('normalizeInstallBranch'), 'the proxy must validate the branch name');
  assert.ok(server.includes('x-local-deployer-token'), 'the proxy must authenticate to the deployer');
  const app = await readFile(new URL('../worker-src/app.ts', import.meta.url), 'utf8');
  assert.ok(app.includes("app.post('/api/deployer/install-branch'"), 'the worker must answer the route honestly instead of 404');
});

test('branches table: every row offers a one-click version install', async () => {
  const src = await dashboard();
  const box = { innerHTML: '' };
  const reply = { ok: true, running: '1.171.0', cached: false, branches: [{ name: 'arena/01a09468-new', version: '1.171.0', status: 'equal' }] };
  const stubs = {
    ...TRIVIAL,
    $: id => ({ deployerBranches: box, deployerRunningVer: { textContent: '' }, vcBranchStatus: { textContent: '' }, vcRepo: { value: 'fazilatma/new' }, vcBranch: { innerHTML: '', value: '' }, vcFile: { innerHTML: '', value: '' }, vcFileStatus: { textContent: '' }, vcPath: { value: 'backups' } }[id] || null),
    api: async path => (path.startsWith('/api/branch-files') ? { ok: true, files: [] } : reply),
    location: { hostname: 'localhost' }
  };
  await loadBranchTable(src, stubs).scanDeployerBranches();
  await new Promise(resolve => setTimeout(resolve, 20));
  for (const token of ['اجرای نسخه', 'data-install-branch="arena/01a09468-new"', '▶️ اجرای این نسخه']) {
    assert.ok(box.innerHTML.includes(token), `localhost rows must offer ${token}`);
  }
  await loadBranchTable(src, { ...stubs, location: { hostname: 'my.workers.dev' } }).scanDeployerBranches();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(box.innerHTML.includes('📋 کپی دستور نصب'), 'remote rows must offer the install-command copy');
});

test('version install: local confirm posts to the deployer proxy and reports', async () => {
  const src = await dashboard();
  const calls = [], notices = [], modals = [];
  const stubs = {
    ...TRIVIAL, location: { hostname: 'localhost' },
    notice: (m, k) => notices.push([m, k]),
    openResultModal: (title, body) => modals.push([title, body]),
    api: async (path, opts) => {
      calls.push([path, JSON.parse(opts.body)]);
      assert.equal(path, '/api/deployer/install-branch');
      return { ok: true, branch: 'arena/01a09468-new', changed: true, restarting: true, message: 'Branch installed.' };
    }
  };
  await loadBranchTable(src, stubs).installBranchVersion('arena/01a09468-new');
  assert.deepEqual(calls, [['/api/deployer/install-branch', { branch: 'arena/01a09468-new' }]], 'one proxied install call');
  assert.equal(modals.length, 1);
  assert.ok(modals[0][0].includes('arena/01a09468-new'), 'the report names the installed branch');
  assert.ok(notices.some(([m, k]) => k === 'ok'), 'success is acknowledged');
  // Cancelling the confirm must not touch the network.
  await loadBranchTable(src, { ...stubs, confirm: () => false, api: async () => { throw Error('must not post'); } }).installBranchVersion('main');
  assert.equal(calls.length, 1, 'no second call after cancel');
});

test('version install: off-device and unmanaged setups get the install commands', async () => {
  const src = await dashboard();
  let copied = '';
  const notices = [];
  const stubs = {
    ...TRIVIAL, location: { hostname: 'my.workers.dev' },
    window: { isSecureContext: true }, navigator: { clipboard: { writeText: async t => { copied = t; } } },
    notice: (m, k) => notices.push([m, k]),
    api: async () => { throw Error('must not post off-device'); }
  };
  const fns = loadBranchTable(src, stubs);
  await fns.installBranchVersion('arena/01a09468-new');
  for (const line of ['git fetch origin arena/01a09468-new', 'git checkout -B arena/01a09468-new origin/arena/01a09468-new', 'cd cloudflare-scraper4', 'npm install', 'esbuild-check']) {
    assert.ok(copied.includes(line), `the copied commands must include ${line}`);
  }
  assert.ok(notices.some(([m, k]) => k === 'ok' && m.includes('کپی شد')), 'the copy must be acknowledged');
  // A local scraper without a managing deployer degrades to the same copy.
  copied = '';
  await loadBranchTable(src, {
    ...stubs, location: { hostname: 'localhost' },
    api: async () => ({ ok: false, code: 'NO_DEPLOYER', error: 'No local deployer manages this scraper.' })
  }).installBranchVersion('main');
  assert.ok(copied.includes('git fetch origin main'), 'the unmanaged fallback must copy branch-specific commands');
  assert.ok(notices.some(([m, k]) => k === 'info' && m.includes('دیپلویر محلی در دسترس نیست')), 'the fallback must say why');
});
