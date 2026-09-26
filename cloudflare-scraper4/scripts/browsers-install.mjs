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
// Background setup is the default. --foreground --strict reports a failure exit.
// In the historical non-strict foreground mode it never fails hard: install guides chain follow-up commands after
// `browsers:install` (the Windows guide without `|| true`), so problems are
// printed as guidance and the process still exits 0. A missing browser is
// reported again, loudly, by the engines themselves at runtime.
import { spawnSync } from 'node:child_process';
import {startBrowserInstall} from './browser-install-background.mjs';
import {localCli,MIRROR,CHROME_MIRROR} from './browser-repair.mjs';
import {applyBrowserDefaults} from './browser-defaults.mjs';
import {gatewayDownloadEnvironment} from './browser-download-gateway.mjs';
import {dirname,resolve} from 'node:path';
import fs, { existsSync } from 'node:fs';
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

export function downloadAttempts(driver,env=process.env){
 const primary={...env};
 const mirror={...env};
 if(driver==='playwright'){
  delete mirror.PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST;
  mirror.PLAYWRIGHT_DOWNLOAD_HOST=MIRROR;
 }else mirror.PUPPETEER_CHROME_DOWNLOAD_BASE_URL=CHROME_MIRROR;
 return env.BROWSER_INSTALL_MIRRORS==='false'?[primary]:[primary,mirror];
}
function runStep([label, command, args], dryRun) {
 console.log(`\n=== ${label} ===`);
 console.log(`$ ${command} ${args.join(' ')}`);
 if(dryRun)return true;
 const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const driver=args[0],termux=command==='pkg';
 const base={...process.env};applyBrowserDefaults(base);
 const attempts=termux?[base]:downloadAttempts(driver,base);
 for(let i=0;i<attempts.length;i++){
  console.log(i?'Trying third-party npmmirror; the pinned revision may be unavailable.':'Trying configured/official source.');
  let env={...attempts[i],PUPPETEER_SKIP_DOWNLOAD:'false'};
  if(env.SCRAPER_BROWSER_GATEWAY)env=gatewayDownloadEnvironment(env,env.SCRAPER_BROWSER_GATEWAY,cwd);
  try{
   const cli=termux?command:process.execPath;
   const argv=termux?args:[localCli(cwd,driver),...args.slice(1),...(driver==='puppeteer'&&i?['--base-url',CHROME_MIRROR]:[])];
   const result=spawnSync(cli,argv,{cwd,env,stdio:'inherit',shell:false,timeout:240000,killSignal:'SIGKILL'});
   if(result.status===0)return true;
   console.log('[browsers:install] attempt failed or timed out; no version downgrade.');
  }catch(error){console.log('[browsers:install] '+error.message);}
 }
 return false;
}

export function main(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run');
  if(argv.includes('--status')){
    const {readFileSync}=fs;try{console.log(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)),'../data/browser-install/status.json'),'utf8'));}catch{console.log('No browser installation recorded.');}return 0;
  }
  if(!dryRun&&!argv.includes('--foreground')){
    try{const job=startBrowserInstall();console.log('[browsers:install] Background setup started or already running. App startup need not wait. Status: '+job.status);}catch(error){console.error('[browsers:install] Could not start background setup: '+error.message);}
    return 0;
  }
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
  return argv.includes('--strict')&&!okAll?1:0;
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
