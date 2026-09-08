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

test('Windows download produces a double-clickable .cmd launcher that unpacks the .ps1', async () => {
  globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');

  const cut = (source, head) => {
    const start = source.indexOf(head);
    assert.ok(start > 0, `missing ${head}`);
    return source.slice(start, source.indexOf('function saveBlobAs(', start));
  };
  const workerFn = new Function(cut(dashboard, 'function windowsLauncherCmd(ps1Text,scriptName){') + '; return windowsLauncherCmd;')();
  const deployerFn = new Function(cut(deployer, 'function windowsLauncherCmd(ps1Text, scriptName) {') + '; return windowsLauncherCmd;')();

  const commands = JSON.parse(deployer.match(/const commands = (\{[\s\S]*?\});\n/)[1]);
  const ps1 = commands['Windows PowerShell'];
  const launcher = workerFn(ps1, 'scraper4-install-windows.ps1');

  assert.equal(launcher, deployerFn(ps1, 'scraper4-install-windows.ps1'), 'both UIs must emit the same launcher');
  assert.ok(launcher.startsWith('@echo off'), 'must be a batch file');
  assert.ok(launcher.includes('\r\n'), 'Windows needs CRLF line endings');
  assert.match(launcher, /-ExecutionPolicy Bypass/, 'must bypass the policy that blocks downloaded .ps1 files');
  assert.match(launcher, /\npause\r?\n?/, 'window must stay open so errors are readable');
  assert.ok(!launcher.split('\r\n').some(line => line.includes('\\\\')), 'no double-escaped paths');
  for (const line of launcher.split('\r\n')) assert.ok(line.length < 8000, 'batch lines must stay under the cmd limit');

  const payload = launcher.split('\r\n').filter(line => line.startsWith('set "B64=!B64!')).map(line => line.slice(14, -1)).join('');
  assert.ok(payload.length > 0, 'installer payload must be embedded');
  assert.equal(Buffer.from(payload, 'base64').toString('utf8'), ps1, 'embedded payload must decode back to the exact installer');
});

test('intrusive confirmation popups are gone from safe/local actions', async () => {
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  assert.ok(!deployer.includes('confirm('), 'the deployer UI must not use blocking confirm() popups');
  assert.match(deployer, /dataset\.armed/, 'destructive branch install keeps a non-modal two-step guard');

  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  for (const gone of [
    'همهٔ سلکتورهای جزئیات و تنظیم گالری پاک شود؟',
    'همه کارهای تمام‌شده پاک شوند؟',
    'تاریخچهٔ درون‌ریزی پاک شود؟',
    'اجرای فعلی ایجنتیک پاک شود؟'
  ]) assert.ok(!dashboard.includes(`confirm('${gone}'`), `local action should not prompt: ${gone}`);

  // Starting a job is safe and reversible: it reports through the non-blocking
  // toast, not a modal the user has to dismiss before seeing the job list.
  assert.ok(!dashboard.includes("openResultModal(source==='backend'"),
    'starting an extraction must not open a blocking result modal');
  assert.match(dashboard, /notice\(source==='backend'/,
    'starting an extraction reports through the non-blocking notice toast');
  // Failures are still worth interrupting for.
  assert.ok(dashboard.includes('شروع استخراج ناموفق بود'),
    'a failed extraction start must still surface a modal');

  // Genuinely destructive/irreversible remote operations must still confirm.
  for (const kept of [
    'پروفایل و محصولات آن حذف شود؟',
    'محصول مقصد حذف شود؟',
    'پاسخ‌ها واقعاً برای مشتریان ارسال شوند؟'
  ]) assert.ok(dashboard.includes(`confirm('${kept}'`), `destructive action must keep its guard: ${kept}`);
});
