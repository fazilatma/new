#!/usr/bin/env node
// Installs the official Basalam Python SDK (pip package `basalam-sdk`) so the
// Node runtime sends products through the real SDK instead of always falling
// back to the REST API. Basalam publishes no npm package, so the SDK-first
// path runs through scripts/basalam-sdk-bridge.py, which needs:
//
//   1. a Python 3.9+ interpreter (python3), and
//   2. the `basalam-sdk` pip package importable by that interpreter.
//
// This script resolves the interpreter the bridge will use (BASALAM_PYTHON,
// PYTHON, then python3/python), installs the SDK with pip, and verifies the
// result by running the bridge's own `probe` action.
//
// Never fails hard: install guides chain follow-up commands after
// `basalam:install`, so problems are printed as guidance and the process
// still exits 0. A missing SDK is reported again, loudly, by the runtime
// libraries probe and by every Basalam send (which keeps working via REST).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), 'basalam-sdk-bridge.py');
export const PROBE_REQUEST = JSON.stringify({ action: 'probe' });

export function pythonCandidates(env = process.env) {
  const list = [];
  for (const key of ['BASALAM_PYTHON', 'PYTHON']) {
    const value = String(env[key] || '').trim();
    if (value) list.push(value);
  }
  list.push('python3', 'python');
  if (process.platform === 'win32') list.push('py');
  return [...new Set(list)];
}

export function findPython(env = process.env) {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  for (const name of pythonCandidates(env)) {
    if (name.includes('/') || name.includes('\\')) {
      if (existsSync(name)) return name;
      continue;
    }
    try {
      const found = spawnSync(probe, [name], { encoding: 'utf8' });
      if (found.status === 0 && String(found.stdout || '').trim()) return name;
    } catch { /* missing `which`: try the next candidate */ }
  }
  return '';
}

// Pure plan (no side effects) so tests can assert the steps without running
// a package manager. Each step is [label, command, args]: plain pip first,
// then the PEP 668 fallback for externally-managed interpreters.
export function installPlan(python) {
  return [
    [`${python} -m pip install basalam-sdk`, python, ['-m', 'pip', 'install', 'basalam-sdk']],
    [`${python} -m pip install --break-system-packages basalam-sdk`, python, ['-m', 'pip', 'install', '--break-system-packages', 'basalam-sdk']],
  ];
}

export function probePlan(python) {
  return { command: python, args: [BRIDGE], input: PROBE_REQUEST };
}

function runStep([label, command, args], dryRun) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ ${command} ${args.join(' ')}`);
  if (dryRun) return true;
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if ((result.status ?? 1) !== 0) {
    console.log(`[basalam:install] step failed (${command} exited ${result.status ?? 'with a signal'}); trying the next fallback.`);
    return false;
  }
  return true;
}

export function runProbe(python, timeoutMs = 30000) {
  const plan = probePlan(python);
  const result = spawnSync(plan.command, plan.args, { input: plan.input, encoding: 'utf8', timeout: timeoutMs });
  const text = String(result.stdout || '').trim();
  try {
    const answer = JSON.parse(text);
    if (answer && typeof answer === 'object') return answer;
  } catch { /* fall through to the error below */ }
  return { ok: false, error: text || String(result.stderr || '').trim() || `the probe produced no JSON output (exit ${result.status ?? 'killed'})` };
}

function printNoPythonGuidance() {
  console.log('\n[basalam:install] No Python interpreter found (looked for BASALAM_PYTHON, PYTHON, python3, python).');
  console.log('[basalam:install] Install Python 3.9+ first, then re-run: npm run basalam:install');
  console.log('  Ubuntu/Debian VPS: sudo apt-get install -y python3 python3-pip');
  console.log('  Termux:            pkg install -y python');
  console.log('  macOS:             brew install python3');
  console.log('  Windows:           winget install --id Python.Python.3.12 -e --source winget   (or python.org, tick "Add to PATH")');
}

export function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const python = findPython();
  if (!python) {
    printNoPythonGuidance();
    console.log('[basalam:install] Finished with warnings (exit 0 by design; see guidance above).');
    return 0;
  }
  console.log(`[basalam:install] interpreter: ${python}${dryRun ? ' (dry run, nothing executed)' : ''}`);
  let installed = dryRun;
  for (const step of installPlan(python)) {
    if (runStep(step, dryRun)) { installed = true; break; }
  }
  if (!installed) {
    console.log('\n[basalam:install] pip could not install basalam-sdk. Try manually on this machine:');
    console.log(`  ${python} -m pip install basalam-sdk`);
    console.log('[basalam:install] Finished with warnings (exit 0 by design; see guidance above).');
    return 0;
  }
  if (dryRun) {
    console.log(`\n=== verify: ${python} ${BRIDGE} (probe) ===`);
    console.log('[basalam:install] Dry run: the install and the probe were not executed.');
    return 0;
  }
  if (!existsSync(BRIDGE)) {
    console.log(`\n[basalam:install] WARNING: the bridge script is missing at ${BRIDGE}; cannot verify the install.`);
    return 0;
  }
  console.log(`\n=== verify: ${python} ${BRIDGE} (probe) ===`);
  const answer = runProbe(python);
  if (answer.ok) {
    console.log(`[basalam:install] Basalam SDK ready: basalam-sdk${answer.sdkVersion ? ` ${answer.sdkVersion}` : ''} on Python ${answer.python || '?'} (${answer.executable || python}).`);
    console.log('[basalam:install] Next: send a product to Basalam — the sync report shows transport "sdk" instead of the REST fallback.');
  } else {
    console.log(`[basalam:install] The SDK is still not importable: ${answer.error || 'unknown probe failure'}.`);
    console.log(`[basalam:install] Make sure the pip above and the bridge use the SAME interpreter (${python}), then re-run: npm run basalam:install`);
  }
  return 0;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) process.exit(main());
