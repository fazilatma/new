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
import {localCli,MIRROR,CHROME_MIRROR,smokeScript} from './browser-repair.mjs';
import {applyBrowserPaths} from './browser-paths.mjs';
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
 try{applyBrowserPaths(base,{create:!termux});}catch(error){console.error(error.message);return false;}
 console.log('Browser paths: '+JSON.stringify({playwright:base.PLAYWRIGHT_BROWSERS_PATH,puppeteer:base.PUPPETEER_CACHE_DIR}));
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

export function verifyInstalledBrowsers({env=process.env,run=spawnSync,cwd=resolve(dirname(fileURLToPath(import.meta.url)),'..')}={}){
 const runtimeEnv={...env};applyBrowserDefaults(runtimeEnv,{root:cwd});
 let ok=true;
 for(const driver of ['playwright','puppeteer']){
  const executable=runtimeEnv.BROWSER_EXECUTABLE_PATH||(driver==='playwright'?runtimeEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:runtimeEnv.PUPPETEER_EXECUTABLE_PATH)||runtimeEnv.CHROME_BIN||(isTermux(runtimeEnv)?TERMUX_CHROMIUM:undefined);
  const resolveCode=executable?JSON.stringify(executable):driver==='playwright'?"(await import('playwright')).chromium.executablePath()":"(await import('puppeteer')).default.executablePath()";
  const inspect=`const executable=await ${resolveCode};console.log('Resolved ${driver} executable:',executable);const fs=await import('node:fs');fs.accessSync(executable,fs.constants.R_OK|fs.constants.X_OK);`;
  for(const engine of [driver,'crawlee-'+driver]){
   console.log('Verifying installed '+engine+' with the runtime cache and sandbox policy.');
   const result=run(process.execPath,['--input-type=module','-e',inspect+smokeScript(engine,executable,runtimeEnv)],{cwd,env:runtimeEnv,stdio:'inherit',timeout:45000,killSignal:'SIGKILL'});
   if(result.status!==0){ok=false;console.error(engine+': verification failed. Inspect the resolved executable, permissions and OS shared libraries; downloading elsewhere is not a fix.');}
  }
 }
 return ok;
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
  if(!dryRun&&okAll)okAll=verifyInstalledBrowsers();
  if (!okAll) console.log('[browsers:install] Setup or runtime verification failed; inspect the log (--strict returns a failure exit code).');
  return argv.includes('--strict')&&!okAll?1:0;
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
