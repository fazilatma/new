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
  const factory = new Function('$', 'api', 'fetch', 'esc', 'escAttr', 'location', 'window', 'navigator', 'document', 'notice',
    `${extractFns(src, ['deployerEnvKind', 'compareBranchVersions', 'scanDeployerBranches', 'deployerBranchAction'])}
     return { deployerEnvKind, compareBranchVersions, scanDeployerBranches, deployerBranchAction };`);
  return factory(stubs.$, stubs.api, stubs.fetch, stubs.esc, stubs.escAttr, stubs.location,
    stubs.window, stubs.navigator, stubs.document, stubs.notice);
}

const TRIVIAL = { $: () => null, api: async () => ({}), fetch: async () => { throw Error('no network'); }, esc: s => s, escAttr: s => s, window: {}, navigator: {}, document: {}, notice: () => {} };

test('version tab: the deployer block is present and complete', async () => {
  const text = await dashboard();
  for (const token of ['🚀 دیپلویر و انتشار', 'deployerEnvHint', 'renderDeployerEnvHint();',
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

test('branches table: compare and environment logic behave', async () => {
  const { deployerEnvKind, compareBranchVersions } = loadBranchTable(await dashboard(),
    { ...TRIVIAL, location: { hostname: 'localhost' } });
  assert.equal(compareBranchVersions('1.159.0', '1.127.0'), 1);
  assert.equal(compareBranchVersions('1.127.0', '1.159.0'), -1);
  assert.equal(compareBranchVersions('1.159.0', '1.159.0'), 0);
  assert.equal(compareBranchVersions('g1.152.0', '1.159.0'), -1, 'odd tags compare by their numeric core');
  assert.equal(compareBranchVersions('', '1.159.0'), 0, 'missing versions are unknown, never newer');
  assert.equal(compareBranchVersions('1.159.0', '?'), 0);
  for (const [host, kind] of [['localhost', 'local'], ['127.0.0.1', 'local'], ['', 'local'],
    ['my.workers.dev', 'worker'], ['svc.onrender.com', 'render'], ['91.99.0.1', 'remote']]) {
    const { deployerEnvKind: kindOf } = loadBranchTable(await dashboard(), { ...TRIVIAL, location: { hostname: host } });
    assert.equal(kindOf(), kind, `${host || '(empty)'} must resolve to ${kind}`);
  }
  assert.equal(deployerEnvKind(), 'local');
});

test('branches table: scan renders versions, statuses and per-env actions', async () => {
  const src = await dashboard();
  const branches = [{ name: 'arena/01a09468-new' }, { name: 'arena/01a0803e-new' }, { name: 'main' }];
  const versions = { 'arena/01a09468-new': '1.159.0', 'arena/01a0803e-new': '1.127.0' };
  const fetchCalls = [];
  const fetch = async url => {
    fetchCalls.push(url);
    if (url.includes('api.github.com')) return { json: async () => branches };
    const name = branches.find(b => url.includes(encodeURIComponent(b.name)))?.name;
    return versions[name] ? { ok: true, json: async () => ({ version: versions[name] }) } : { ok: false };
  };
  const box = { innerHTML: '' }, run = { textContent: '' };
  const opened = [], notices = [];
  const stubs = {
    ...TRIVIAL, fetch, notice: (m, k) => notices.push([m, k]),
    $: id => ({ deployerBranches: box, deployerRunningVer: run }[id] || null),
    api: async () => ({ version: '1.127.0' }),
    location: { hostname: 'localhost' }, window: { open: (...a) => opened.push(a), isSecureContext: true },
    navigator: { clipboard: { writeText: async () => {} } }
  };
  const { scanDeployerBranches, deployerBranchAction } = loadBranchTable(src, stubs);
  await scanDeployerBranches();
  assert.ok(run.textContent.includes('1.127.0'), 'the running version must be shown');
  assert.equal(fetchCalls.filter(u => u.includes('api.github.com')).length, 1, 'one branch-list call per scan');
  assert.equal(fetchCalls.filter(u => u.includes('raw.githubusercontent.com')).length, 3, 'one manifest fetch per branch');
  for (const token of ['pdest-table', 'arena/01a09468-new', '1.159.0', '1.127.0', '—', 'جدیدتر', 'برابر', 'نامشخص', 'data-deployer-branch']) {
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
});

test('branches table: wiring and deployer deep-link are in place', async () => {
  const text = await dashboard();
  for (const token of ['deployer-scan-branches', 'scanDeployerBranches();return', 'data-deployer-branch',
    'deployerBranchAction(dbr.dataset.deployerBranch)', 'api.github.com/repos/fazilatma/new/branches',
    'raw.githubusercontent.com', 'localhost:8790/#branches']) {
    assert.ok(text.includes(token), `the branches table must include ${token}`);
  }
  const deployer = await readFile(new URL('../scripts/local-deployer-ui.mjs', import.meta.url), 'utf8');
  assert.ok(deployer.includes("location.hash==='#branches'"), 'the deployer must honor the #branches deep-link');
});
