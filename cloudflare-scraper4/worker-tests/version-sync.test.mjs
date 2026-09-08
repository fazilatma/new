import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const projectUrl = new URL('../', import.meta.url);
const readProjectFile = name => readFile(new URL(name, projectUrl), 'utf8');
const pkg = JSON.parse(await readProjectFile('package.json'));
const version = pkg.version;
const faVersion = String(version).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

test('package.json exposes a concrete semver as the single source of truth', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('sync-version --check passes, so no version reference has drifted', () => {
  const output = execFileSync(process.execPath, ['scripts/sync-version.mjs', '--check'], {
    cwd: new URL('.', projectUrl).pathname,
    encoding: 'utf8'
  });
  assert.match(output, /version OK/);
  assert.ok(output.includes(version), `check output should mention ${version}`);
});

test('dashboard header badge shows the current version, not a hardcoded old one', async () => {
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  const header = dashboard.match(/<b id="topVersionNum">([^<]*)<\/b>/);
  assert.ok(header, 'header must keep a topVersionNum slot');
  assert.equal(header[1], faVersion);
});

test('changelog documents the current version and its footer matches it', async () => {
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  const firstEntry = dashboard.match(/<div class="change-list"><div class="change-item"><time>([^<]*)<\/time>/);
  assert.ok(firstEntry, 'the change list must start with a dated entry');
  assert.ok(firstEntry[1].includes(faVersion), `newest changelog entry should mention ${faVersion}, got ${firstEntry[1]}`);
  for (const label of ['نسخهٔ فعلی Worker: ', 'نسخهٔ فعلی: ']) {
    const footer = dashboard.match(new RegExp(label + '([۰-۹.]+)'));
    assert.ok(footer, `footer "${label}" must exist`);
    assert.equal(footer[1], faVersion);
  }
});

test('version fallbacks used before /health responds are current', async () => {
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  for (const match of dashboard.matchAll(/faVersion\((?:value|health\.version)\s*\|\|\s*'(\d+\.\d+\.\d+)'/g)) {
    assert.equal(match[1], version);
  }
  const server = await readProjectFile('render-src/server.ts');
  for (const match of server.matchAll(/\|\|\s*'(\d+\.\d+\.\d+)'/g)) assert.equal(match[1], version);
  const app = await readProjectFile('worker-src/app.ts');
  for (const match of app.matchAll(/WORKER_VERSION\|\|'(\d+\.\d+\.\d+)'/g)) assert.equal(match[1], version);
});

test('every environment install guide carries a version verification step', async () => {
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  const groups = JSON.parse(dashboard.match(/const INSTALL_COMMAND_GROUPS=(\[[\s\S]*?\]);\n/)[1]);
  assert.ok(groups.length >= 11, 'all environment cards must be present');
  for (const group of groups) {
    assert.ok(
      group.body.includes('version:check') || group.body.includes('Expected version'),
      `install guide "${group.key}" must verify the running version`
    );
  }
  // The guides must not advertise a version other than the current one.
  for (const group of groups) {
    for (const match of group.body.matchAll(/(?:# Expected: |REM Expected: |Expected version: )(\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], version, `guide "${group.key}" mentions a stale version`);
    }
  }
});

test('deployer guides stay aligned with the dashboard guides', async () => {
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  const commands = JSON.parse(deployer.match(/const commands = (\{[\s\S]*?\});\n/)[1]);
  for (const [name, body] of Object.entries(commands)) {
    for (const match of body.matchAll(/(?:# Expected: |REM Expected: |expected version: )(\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], version, `deployer guide "${name}" mentions a stale version`);
    }
  }
  for (const key of ['Windows PowerShell', 'Windows Command Prompt']) {
    assert.ok(commands[key].includes('sqlite:data/scraper4.sqlite'), `${key} must configure the Windows SQLite database`);
    assert.ok(commands[key].includes('esbuild-check.mjs'), `${key} must verify esbuild`);
    assert.ok(!commands[key].includes('--ignore-scripts'), `${key} must not skip install scripts (breaks esbuild)`);
  }
});
