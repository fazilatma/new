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
  // Termux reports process.platform === 'android'. Without this branch the
  // repair installed nothing useful and the build died with a message telling
  // an Android user to fix their "Windows" install.
  if (process.platform === 'android') {
    if (process.arch === 'arm64') return '@esbuild/android-arm64';
    if (process.arch === 'arm') return '@esbuild/android-arm';
    return '@esbuild/android-x64';
  }
  if (process.platform === 'linux') {
    if (process.arch === 'arm64') return '@esbuild/linux-arm64';
    if (process.arch === 'arm') return '@esbuild/linux-arm';
    return '@esbuild/linux-x64';
  }
  return '';
}

const isTermux = process.platform === 'android' || /com\.termux/.test(process.env.PREFIX || '') || /com\.termux/.test(projectRoot);

// Termux ships a native esbuild through `pkg install esbuild`. esbuild's own
// loader honours ESBUILD_BINARY_PATH, so an existing system binary is by far
// the most reliable way to build on Android -- no npm optional package, no
// postinstall download.
function systemEsbuildBinary() {
  const candidates = [
    process.env.ESBUILD_BINARY_PATH,
    join(projectRoot, 'node_modules', ...(platformBinaryPackage() || 'x').split('/'), 'bin', 'esbuild'),
    process.env.PREFIX ? join(process.env.PREFIX, 'bin', 'esbuild') : '',
    '/data/data/com.termux/files/usr/bin/esbuild'
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { if (existsSync(candidate) && candidate !== '/usr/bin/esbuild') return candidate; } catch { /* keep looking */ }
  }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['esbuild'], { encoding: 'utf8' });
  const found = which.status === 0 ? String(which.stdout || '').split('\n')[0].trim() : '';
  return found && found !== '/usr/bin/esbuild' && existsSync(found) ? found : '';
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
        (isTermux
          ? '(on Termux the simplest fix is the system build: pkg install esbuild)'
          : '(do NOT use --ignore-scripts; esbuild needs its postinstall/optional binary to run)')
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

// Last resort: esbuild-wasm is pure WebAssembly, so it runs anywhere Node runs.
// Slower than the native binary, but a slow build beats a build that cannot run
// at all -- which is what Termux users were hitting.
async function loadWasmFallback(reason) {
  const pin = desiredEsbuildVersion();
  console.error(`[esbuild-loader] Falling back to esbuild-wasm@${pin} (${reason}).`);
  try {
    return await verifyEsbuildBinary(await import('esbuild-wasm'));
  } catch {
    const install = runNpm(['install', `esbuild-wasm@${pin}`, '--no-save', '--no-audit', '--prefer-online']);
    if (install.status !== 0) return null;
    try {
      return await verifyEsbuildBinary(await import(`esbuild-wasm?fresh=${Date.now()}`).catch(() => import('esbuild-wasm')));
    } catch { return null; }
  }
}

export async function loadEsbuild() {
  // A usable binary already on the machine beats any download. On Termux this
  // is `pkg install esbuild`, which is the officially supported route.
  if (!process.env.ESBUILD_BINARY_PATH) {
    const system = systemEsbuildBinary();
    if (system) process.env.ESBUILD_BINARY_PATH = system;
  }
  let module = null;
  try {
    module = await import('esbuild');
    return await verifyEsbuildBinary(module);
  } catch (firstError) {
    const reason = (firstError && firstError.message) || String(firstError);
    if (module && !isMissingBinaryError(firstError)) throw firstError; // a genuine transform bug, not a broken install
    console.error(`[esbuild-loader] esbuild is not usable: ${reason}`);
    try {
      repairEsbuild();
      // Bust the ESM cache so the freshly installed copy is loaded.
      const fresh = await import(`esbuild?repaired=${Date.now()}`).catch(() => import('esbuild'));
      return await verifyEsbuildBinary(fresh);
    } catch (secondError) {
      // The native binary is unavailable on this device. Rather than failing the
      // whole build (which stops the scraper from ever starting), run the
      // WebAssembly build, which needs no platform-specific executable.
      const wasm = await loadWasmFallback((secondError && secondError.message) || String(secondError));
      if (wasm) return wasm;
      const productionInstall = process.env.NODE_ENV === 'production';
      throw new Error(
        '[esbuild] esbuild still cannot be loaded after repair: ' + ((secondError && secondError.message) || secondError) +
        (productionInstall
          ? `\nNODE_ENV=production is set, so "npm install" skipped devDependencies.`
            + `\nesbuild must be a normal dependency for the build to run on Render/Heroku-style hosts,`
            + `\nor install it explicitly:\n  ${npmCommand} install esbuild@${desiredEsbuildVersion()} --no-audit`
          : '') +
        (isTermux
          ? `\nOn Termux install the system build, then start the deployer again:\n  pkg install esbuild\n  ${npmCommand} install esbuild-wasm@${desiredEsbuildVersion()} --no-audit`
          : `\nMake sure Node.js LTS is installed and that this folder was not copied from another OS, then run:\n  ${npmCommand} install esbuild@${desiredEsbuildVersion()} --no-audit --prefer-online`)
      );
    }
  }
}
