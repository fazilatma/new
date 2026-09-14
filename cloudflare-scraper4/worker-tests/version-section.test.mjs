import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// The version tab's legacy PHP-compatibility block (GitHub token, legacy
// deploy.php inputs) is retired: the deployer block takes its place with
// the same install-guide copy pipeline the other tabs already use.

async function dashboard() {
  return readFile(new URL('../worker-src/dashboard.ts', import.meta.url), 'utf8');
}

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
