#!/usr/bin/env node
// esbuild-loader.mjs
// ---------------------------------------------------------------------------
// Resilient esbuild loader used by build-render.mjs and build-worker.mjs.
//
// Why this exists:
//   esbuild >= 0.17 ships its native binary through optional platform
//   packages (@esbuild/win32-x64, @esbuild/linux-x64, ...) plus a postinstall
//   fallback (node install.js). On Windows (PowerShell / Command Prompt) an
//   interrupted `npm install --ignore-scripts`, a stale node_modules, a
//   partial network download or an antivirus quarantine can leave esbuild
//   without its binary, producing errors such as:
//     - Cannot find module 'esbuild'
//     - The esbuild binary is not installed / cannot be found
//     - You installed esbuild for another platform
//   Instead of failing the whole build with a cryptic message, we repair the
//   install once (removing the broken package and reinstalling WITHOUT
//   --ignore-scripts so the postinstall can run) and then retry the import.
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function platformBinaryPackage() {
  if (process.platform === 'win32') return process.arch === 'arm64' ? '@esbuild/win32-arm64' : '@esbuild/win32-x64';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? '@esbuild/darwin-arm64' : '@esbuild/darwin-x64';
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') return '@esbuild/linux-arm64';
    if (process.arch === 'arm') return '@esbuild/linux-arm';
    return '@esbuild/linux-x64';
  }
  return '';
}

function desiredEsbuildVersion() {
  // Prefer the exact version recorded in package-lock.json so the automatic
  // repair installs exactly what `npm ci` would install.
  try {
    const lock = JSON.parse(readFileSync(join(projectRoot, 'package-lock.json'), 'utf8'));
    const locked = lock && lock.packages && lock.packages['node_modules/esbuild'] && lock.packages['node_modules/esbuild'].version;
    if (locked) return String(locked);
  } catch { /* fall through to package.json */ }
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
    const range = String((pkg.devDependencies && pkg.devDependencies.esbuild) || (pkg.dependencies && pkg.dependencies.esbuild) || '0.25.9');
    const exact = range.match(/(\d+\.\d+\.\d+)/);
    return exact ? exact[1] : '0.25.9';
  } catch {
    return '0.25.9';
  }
}

function runNpm(args) {
  return spawnSync(npmCommand, args, { cwd: projectRoot, encoding: 'utf8', env: { ...process.env, npm_config_ignore_scripts: 'false' } });
}

function removeBrokenEsbuildPackages() {
  for (const name of ['esbuild', platformBinaryPackage()].filter(Boolean)) {
    const target = join(projectRoot, 'node_modules', ...name.split('/'));
    if (existsSync(target)) {
      try { rmSync(target, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

function repairEsbuild() {
  const pin = desiredEsbuildVersion();
  console.error(`[esbuild-loader] Reinstalling esbuild@${pin} for ${process.platform}-${process.arch} (without --ignore-scripts)...`);
  removeBrokenEsbuildPackages();
  const install = runNpm(['install', `esbuild@${pin}`, '--no-save', '--no-audit', '--prefer-online']);
  if (install.status !== 0) {
    console.error('[esbuild-loader] Targeted install failed; trying a full esbuild install without --ignore-scripts...');
    const full = runNpm(['install', `esbuild@${pin}`, '--save-dev', '--no-audit', '--prefer-online']);
    if (full.status !== 0) {
      throw new Error(
        '[esbuild] Automatic repair failed. Run this manually inside cloudflare-scraper4:\n' +
        `  ${npmCommand} install esbuild@${pin} --no-audit\n` +
        '(do NOT use --ignore-scripts; esbuild needs its postinstall/optional binary to run on Windows)'
      );
    }
  }
}

// Importing esbuild succeeds even when the native binary is missing: the JS
// wrapper only resolves its platform package on the FIRST build/transform call.
// That is exactly the Windows symptom ("Cannot find module 'esbuild'" /
// "The esbuild binary was not found"), so a bare import() is not a real check.
// We therefore run a tiny transform to force the binary to load.
async function verifyEsbuildBinary(module) {
  if (!module || typeof module.transform !== 'function') throw new Error('esbuild module does not expose transform()');
  await module.transform('0;', { loader: 'js' });
  return module;
}

function isMissingBinaryError(error) {
  const message = String((error && error.message) || error || '');
  return /cannot find module|binary|not installed|another platform|host environment|EACCES|ENOENT|spawn|dlopen|is not a valid Win32 application/i.test(message);
}

export async function loadEsbuild() {
  let module = null;
  try {
    module = await import('esbuild');
    return await verifyEsbuildBinary(module);
  } catch (firstError) {
    const reason = (firstError && firstError.message) || String(firstError);
    if (module && !isMissingBinaryError(firstError)) throw firstError; // a genuine transform bug, not a broken install
    console.error(`[esbuild-loader] esbuild is not usable: ${reason}`);
    repairEsbuild();
    try {
      // Bust the ESM cache so the freshly installed copy is loaded.
      const fresh = await import(`esbuild?repaired=${Date.now()}`).catch(() => import('esbuild'));
      return await verifyEsbuildBinary(fresh);
    } catch (secondError) {
      throw new Error(
        '[esbuild] esbuild still cannot be loaded after repair: ' + ((secondError && secondError.message) || secondError) +
        '\nOn Windows make sure Node.js LTS is installed and that this folder was not copied from another OS, then run:\n' +
        `  ${npmCommand} install esbuild@${desiredEsbuildVersion()} --no-audit --prefer-online`
      );
    }
  }
}
