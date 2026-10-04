import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
  installPlan, main, probePlan, pythonCandidates, runProbe,
} from '../scripts/basalam-sdk-install.mjs';

/**
 * The Basalam SDK ships as a Python package, so the Node runtime installs
 * it through scripts/basalam-sdk-install.mjs (npm run basalam:install) and
 * reports it through the Python / Basalam SDK libraries group. These tests
 * pin the installer plan, the bridge probe, the status helper (against a
 * stub interpreter so no network is needed), and the guide/probe wiring
 * across every Node environment.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dashboardSrc = () => readFileSync(join(ROOT, 'worker-src/dashboard.ts'), 'utf8');
const dashboardGroups = () => JSON.parse(dashboardSrc().match(/const INSTALL_COMMAND_GROUPS=(\[[\s\S]*?\]);\n/)[1]);
const deployerCommands = () => {
  const src = readFileSync(join(ROOT, 'scripts/local-deployer-ui.mjs'), 'utf8');
  return JSON.parse(src.match(/const commands = (\{[\s\S]*?\});\n/)[1]);
};
const noShell = process.platform === 'win32' ? 'needs a POSIX shell for the stub interpreter' : false;

test('installer: interpreter candidates prefer BASALAM_PYTHON, then PYTHON, then PATH lookup', () => {
  assert.deepEqual(pythonCandidates({ BASALAM_PYTHON: '/custom/py', PYTHON: '/other/py', PATH: '' }).slice(0, 4),
    ['/custom/py', '/other/py', 'python3', 'python']);
  assert.deepEqual(pythonCandidates({ PATH: '' }).slice(0, 2), ['python3', 'python']);
});

test('installer: plan installs basalam-sdk with pip, then the externally-managed fallback', () => {
  const plan = installPlan('python3');
  assert.equal(plan.length, 2);
  assert.deepEqual(plan[0], ['python3 -m pip install basalam-sdk', 'python3', ['-m', 'pip', 'install', 'basalam-sdk']]);
  assert.deepEqual(plan[1][2], ['-m', 'pip', 'install', '--break-system-packages', 'basalam-sdk']);
  const probe = probePlan('python3');
  assert.equal(probe.command, 'python3');
  assert.ok(probe.args[0].endsWith('basalam-sdk-bridge.py'));
  assert.deepEqual(JSON.parse(probe.input), { action: 'probe' });
});

test('installer: dry run never fails and prints the interpreter plus both steps', () => {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/basalam-sdk-install.mjs'), '--dry-run'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.match(String(run.stdout), /\[basalam:install\] interpreter: \S+/);
  assert.match(String(run.stdout), /-m pip install basalam-sdk/);
  assert.match(String(run.stdout), /basalam-sdk-bridge\.py \(probe\)/);
});

test('installer: the real bridge probe answers with the documented shape', () => {
  const answer = runProbe('python3', 30000);
  assert.equal(typeof answer, 'object');
  assert.equal(typeof answer.ok, 'boolean');
  if (answer.ok) {
    assert.equal(typeof answer.sdkVersion, 'string');
    assert.ok(answer.sdkVersion.length > 0);
  } else {
    // No SDK on this machine: the failure must say why (missing package vs
    // missing interpreter), never an empty shrug.
    assert.equal(typeof answer.error, 'string');
    assert.ok(answer.error.length > 0);
  }
});

function writeStubProbe(dir) {
  const stub = join(dir, 'stub-python');
  writeFileSync(stub, '#!/bin/sh\nprintf \'%s\' \'{"ok":true,"sdkVersion":"9.9.9-stub","python":"3.99.0","executable":"/stub/python"}\'\n');
  chmodSync(stub, 0o755);
  return stub;
}

test('installer: probe reports a stub interpreter deterministically', { skip: noShell }, () => {
  const dir = join(tmpdir(), `scraper4-sdk-stub-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    const answer = runProbe(writeStubProbe(dir), 15000);
    assert.equal(answer.ok, true);
    assert.equal(answer.sdkVersion, '9.9.9-stub');
    assert.equal(answer.python, '3.99.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// basalamSdkStatus resolves the bridge relative to the BUNDLED file
// (render-dist/server.js in production), so the test bundle must sit one
// directory below the project root, exactly like the real build.
async function loadSdkStatus() {
  const dir = join(ROOT, 'tmp-sdk-status-probe');
  mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: [join(ROOT, 'render-src/sync.ts')], bundle: true, platform: 'node',
    format: 'esm', packages: 'external', outfile: join(dir, 'sync-bundle.mjs'), logLevel: 'error',
  });
  const mod = await import(pathToFileURL(join(dir, 'sync-bundle.mjs')).href);
  rmSync(dir, { recursive: true, force: true });
  return mod.basalamSdkStatus;
}

test('status helper: stub SDK is available, missing interpreter fails loudly, cache holds', { skip: noShell }, async () => {
  const basalamSdkStatus = await loadSdkStatus();
  const saved = process.env.BASALAM_PYTHON;
  const dir = join(tmpdir(), `scraper4-sdk-status-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  try {
    process.env.BASALAM_PYTHON = writeStubProbe(dir);
    const up = basalamSdkStatus(true);
    assert.equal(up.available, true);
    assert.equal(up.version, '9.9.9-stub');
    assert.equal(up.python, '3.99.0');
    assert.equal(basalamSdkStatus(), up, 'unforced calls return the cached status');
    process.env.BASALAM_PYTHON = join(dir, 'no-such-python');
    const down = basalamSdkStatus(true);
    assert.equal(down.available, false);
    assert.ok(down.error.length > 0);
  } finally {
    if (saved === undefined) delete process.env.BASALAM_PYTHON; else process.env.BASALAM_PYTHON = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('guides: every Node install guide runs npm run basalam:install', () => {
  const groups = Object.fromEntries(dashboardGroups().map(g => [g.key, g.body]));
  for (const key of ['update', 'desktop', 'windows-powershell', 'windows-cmd', 'termux', 'vps']) {
    assert.ok(groups[key].includes('npm run basalam:install'), `${key} guide must install the Basalam SDK`);
  }
  assert.ok(groups.render.includes('basalam-sdk'), 'render guide must mention the automatic SDK install');
  assert.ok(groups['windows-powershell'].includes('Python.Python.3.12'), 'powershell guide must provision Python itself');
  assert.ok(groups['windows-cmd'].includes('Python.Python.3.12'), 'cmd guide must provision Python itself');
  assert.ok(groups.termux.includes('python'), 'termux pkg list already carries python');
  assert.ok(groups.vps.includes('python3-pip'), 'vps apt line must carry pip');

  // The standalone deployer UI prints its own copy of the guides: it must
  // stay in lockstep with the dashboard.
  const commands = deployerCommands();
  for (const key of ['Update existing clone', 'VS Code / Desktop', 'Windows PowerShell', 'Windows Command Prompt', 'Termux / Android']) {
    assert.ok(commands[key].includes('npm run basalam:install'), `deployer "${key}" must install the Basalam SDK`);
  }
  assert.ok(commands['Render.com panel'].includes('basalam-sdk'));
  assert.ok(commands['Windows PowerShell'].includes('Python.Python.3.12'));
  assert.ok(commands['Windows Command Prompt'].includes('Python.Python.3.12'));
});

test('wiring: package script, Render build, VPS bundle, probes, and catalog agree', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['basalam:install'], 'node scripts/basalam-sdk-install.mjs');
  assert.ok(readFileSync(join(ROOT, '..', 'render.yaml'), 'utf8').includes('npm run basalam:install'),
    'Render buildCommand must install the SDK on every deploy');
  const deployerSrc = readFileSync(join(ROOT, 'scripts/universal-deployer.mjs'), 'utf8');
  assert.ok(deployerSrc.includes('python3-pip'), 'VPS bundle must apt-install pip');
  assert.ok(deployerSrc.includes('pip install --break-system-packages basalam-sdk'),
    'VPS bundle must pip-install the SDK without aborting the deploy');

  const serverSrc = readFileSync(join(ROOT, 'render-src/server.ts'), 'utf8');
  assert.ok(serverSrc.includes("label:'Python / Basalam SDK'"), 'Node probe must carry the SDK group');
  const syncSrc = readFileSync(join(ROOT, 'render-src/sync.ts'), 'utf8');
  assert.ok(syncSrc.includes('export function basalamSdkStatus'), 'sync.ts must export the cached status helper');
  const appSrc = readFileSync(join(ROOT, 'worker-src/app.ts'), 'utf8');
  const notInstalled = appSrc.match(/Not installed in Worker runtime',items:\[([^\]]*)\]/)[1];
  assert.ok(notInstalled.includes("'python3'") && notInstalled.includes("'basalam-sdk'"),
    'Worker probe must list Python/SDK as honestly unavailable');

  assert.ok(!dashboardSrc().includes('optional adapter'), 'dashboard catalog must not call the SDK optional anymore');
  const groups = new Function(`return (${dashboardSrc().match(/INSTALLED_LIBRARY_GROUPS_BY_ENV=(\[[\s\S]*?\n\]);/)[1]});`)();
  const nodeEnv = groups.find(g => String(g.env).startsWith('Node runtime'));
  const sdkGroup = nodeEnv.groups.find(g => g.type === 'Basalam SDK / Python bridge');
  assert.ok(sdkGroup, 'Node catalog must carry the SDK bridge group');
  assert.ok(sdkGroup.items.includes('basalam-sdk (pip)'));
});
