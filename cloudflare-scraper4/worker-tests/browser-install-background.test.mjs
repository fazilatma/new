import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startBrowserInstall} from '../scripts/browser-install-background.mjs';
import {downloadAttempts,installPlan} from '../scripts/browsers-install.mjs';
test('download mirrors are fallback only, preserve proxy/cache, and can be disabled',()=>{
 const env={HTTPS_PROXY:'https://proxy.invalid',PLAYWRIGHT_BROWSERS_PATH:'/cache',PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST:'https://custom.invalid'};
 const steps=downloadAttempts('playwright',env);
 assert.deepEqual(steps[0],env);assert.equal(steps[1].PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST,undefined);
 assert.match(steps[1].PLAYWRIGHT_DOWNLOAD_HOST,/npmmirror/);assert.equal(steps[1].HTTPS_PROXY,env.HTTPS_PROXY);
 assert.equal(steps[1].PLAYWRIGHT_BROWSERS_PATH,'/cache');assert.equal(downloadAttempts('puppeteer',{BROWSER_INSTALL_MIRRORS:'false'}).length,1);
 assert.match(downloadAttempts('puppeteer',{})[1].PUPPETEER_CHROME_DOWNLOAD_BASE_URL,/chrome-for-testing/);
 assert.deepEqual(installPlan(true)[0].slice(1),['pkg',['install','-y','chromium']]);
});
for(const exit of [0,1])test(`detached install returns before completion, deduplicates and records exit ${exit}`,async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'browser-background-'));
 try{
  mkdirSync(join(cwd,'scripts'));writeFileSync(join(cwd,'scripts/browsers-install.mjs'),`console.log('fixture install');setTimeout(()=>process.exit(${exit}),600);`);
  const job=startBrowserInstall({cwd});
  assert.equal(JSON.parse(readFileSync(job.status)).running,true);
  assert.equal(startBrowserInstall({cwd}).alreadyRunning,true);
  let state;for(let i=0;i<150;i++){await delay(100);state=JSON.parse(readFileSync(job.status));if(!state.running)break;}
  assert.equal(state.running,false);assert.equal(state.phase,exit?'failed':'ready');assert.equal(state.exitCode,exit);
  assert.match(readFileSync(join(cwd,'data/browser-install/install.log'),'utf8'),/fixture install/);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
test('core installation skips browser postinstall downloads and queues separate setup',()=>{
 const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
 assert.equal(pkg.scripts.postinstall,'node scripts/browsers-install.mjs');
 assert.match(readFileSync(new URL('../.puppeteerrc.cjs',import.meta.url),'utf8'),/skipDownload: true/);
});
