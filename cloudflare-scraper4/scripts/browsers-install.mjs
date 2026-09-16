#!/usr/bin/env node
// Installs a runnable Chromium for the Playwright/Puppeteer/Crawlee engines,
// choosing the method that can actually work on this machine:
//
// - Termux/Android: `playwright install` downloads desktop-Linux (glibc)
//   binaries that can NEVER execute on Android (Bionic libc), so install the
//   Termux `chromium` package instead. The engines auto-detect its path
//   (/data/data/com.termux/files/usr/bin/chromium); BROWSER_EXECUTABLE_PATH
//   still overrides it.
// - Everywhere else: download the bundled browsers (the historical behavior).
//
// Never fails hard: install guides chain follow-up commands after
// `browsers:install` (the Windows guide without `|| true`), so problems are
// printed as guidance and the process still exits 0. A missing browser is
// reported again, loudly, by the engines themselves at runtime.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TERMUX_CHROMIUM = '/data/data/com.termux/files/usr/bin/chromium';
export const TERMUX_PKG = '/data/data/com.termux/files/usr/bin/pkg';

export function isTermux(env = process.env) {
  return String(env.PREFIX || '').includes('com.termux') || existsSync(TERMUX_PKG);
}

// Pure plan (no side effects) so tests can assert the Termux branch without
// running a package manager. Each step is [label, command, args].
export function installPlan(termux) {
  if (termux) {
    return [
      ['Termux system browser (runnable on Android)', 'pkg', ['install', '-y', 'chromium']],
    ];
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return [
    ['Playwright bundled Chromium', npx, ['playwright', 'install', 'chromium']],
    ['Puppeteer bundled Chrome', npx, ['puppeteer', 'browsers', 'install', 'chrome']],
  ];
}

function runStep([label, command, args], dryRun) {
  console.log(`\n=== ${label} ===`);
  console.log(`$ ${command} ${args.join(' ')}`);
  if (dryRun) return true;
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false });
  if ((result.status ?? 1) !== 0) {
    console.log(`[browsers:install] step failed (${command} exited ${result.status ?? 'with a signal'}); continuing with guidance only.`);
    return false;
  }
  return true;
}

export function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  const termux = isTermux();
  console.log(`[browsers:install] platform: ${termux ? 'Termux/Android — installing the system browser (desktop downloads cannot run here)' : `${process.platform} — downloading bundled browsers`}${dryRun ? ' (dry run, nothing executed)' : ''}`);
  let okAll = true;
  for (const step of installPlan(termux)) okAll = runStep(step, dryRun) && okAll;
  if (termux && !dryRun) {
    if (existsSync(TERMUX_CHROMIUM)) {
      console.log(`\n[browsers:install] Chromium ready at ${TERMUX_CHROMIUM} — the engines detect it automatically.`);
      console.log('[browsers:install] Next: start the scraper and pick the playwright/puppeteer/crawlee_playwright engine, or run the extraction diagnostic.');
    } else {
      console.log('\n[browsers:install] Chromium was not found after install. Run manually: pkg update && pkg install -y chromium');
      console.log('[browsers:install] Then verify with: ls -l /data/data/com.termux/files/usr/bin/chromium');
      okAll = false;
    }
  }
  if (!okAll) console.log('[browsers:install] Finished with warnings (exit 0 by design; see guidance above).');
  return 0;
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
