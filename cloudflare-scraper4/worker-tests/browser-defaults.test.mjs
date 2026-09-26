import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {resolveBrowserDefaults,applyBrowserDefaults,browserDefaultsReport} from '../scripts/browser-defaults.mjs';

test('Linux managed private temp is replaced with /tmp; root compatibility is explicit in report',()=>{
 const env={TMPDIR:'/private/webconsole/runtime/tmp',HOME:'/private/home',PLAYWRIGHT_BROWSERS_PATH:'/private/cache'},settings=applyBrowserDefaults(env,{platform:'linux',uid:0});
 for(const key of ['TMPDIR','TMP','TEMP'])assert.equal(env[key],'/tmp');assert.equal(env.VISUAL_BROWSER_NO_SANDBOX,'true');assert.equal(env.DEBUG,undefined);assert.equal(settings.sandboxPolicy,'auto');assert.ok(settings.warnings.length);assert.equal(env.HOME,'/private/home');assert.equal(env.PLAYWRIGHT_BROWSERS_PATH,'/private/cache');
});
test('ordinary non-root preserves sandbox unless explicitly disabled; false wins over root auto',()=>{
 assert.equal(resolveBrowserDefaults({env:{},platform:'linux',uid:1000}).noSandbox,false);
 assert.equal(resolveBrowserDefaults({env:{VISUAL_BROWSER_NO_SANDBOX:'false'},platform:'linux',uid:0}).noSandbox,false);
 assert.equal(resolveBrowserDefaults({env:{VISUAL_BROWSER_NO_SANDBOX:'true'},platform:'linux',uid:1000}).noSandbox,true);
 assert.throws(()=>resolveBrowserDefaults({env:{VISUAL_BROWSER_NO_SANDBOX:'maybe'},platform:'linux'}),/true or false/);
});
test('Termux and Windows use native locations instead of Linux /tmp',()=>{
 const termux=resolveBrowserDefaults({env:{PREFIX:'/data/data/com.termux/files/usr',TMPDIR:'/bad'},platform:'android',uid:10000});assert.equal(termux.temporaryDirectory,'/data/data/com.termux/files/usr/tmp');assert.equal(termux.noSandbox,true);
 const win=resolveBrowserDefaults({env:{TEMP:'C:\\Users\\tester\\Temp'},platform:'win32',uid:undefined,systemTemp:'C:\\Temp'});assert.equal(win.temporaryDirectory,'C:\\Users\\tester\\Temp');assert.equal(win.noSandbox,false);
});
test('custom browser directory is supported, diagnostics are read-only and invalid relative paths rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'browser-defaults-'));try{const env={BROWSER_TMPDIR:dir,DEBUG:'pw:browser'};applyBrowserDefaults(env,{platform:'linux',uid:1000});assert.equal(env.TMPDIR,dir);assert.equal(env.DEBUG,'pw:browser');const before={...env};browserDefaultsReport(env);assert.deepEqual(env,before);assert.throws(()=>resolveBrowserDefaults({env:{BROWSER_TMPDIR:'relative'},platform:'linux'}),/absolute/)}finally{await rm(dir,{recursive:true,force:true})}
});
test('actual Node config applies parent and child temp variables before a browser SDK would launch',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'browser-config-build-'));try{const out=join(dir,'config.mjs');await build({entryPoints:[new URL('../render-src/config.ts',import.meta.url).pathname],outfile:out,bundle:true,platform:'node',format:'esm'});
 const script=`await import(${JSON.stringify('file://'+out)});console.log(JSON.stringify({temp:(await import('node:os')).tmpdir(),env:[process.env.TMPDIR,process.env.TMP,process.env.TEMP],flag:process.env.VISUAL_BROWSER_NO_SANDBOX}));`;
 const env={...process.env,TMPDIR:'/private/wconsole/tmp',VISUAL_BROWSER_NO_SANDBOX:'false'};delete env.BROWSER_TMPDIR;const result=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{env,encoding:'utf8'}));assert.equal(result.temp,'/tmp');assert.deepEqual(result.env,['/tmp','/tmp','/tmp']);assert.equal(result.flag,'false');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('explicit sandbox enforcement reaches Playwright as an option as well as Chromium flags',async()=>{
 const {browserLaunchArguments,playwrightSandboxOptions}=await import('../scripts/browser-defaults.mjs');
 for(const uid of [0,1000])for(const policy of ['auto','true','false']){const options={env:{VISUAL_BROWSER_NO_SANDBOX:policy},uid,platform:'linux'},disabled=policy==='true'||policy==='auto'&&uid===0;
 assert.equal(browserLaunchArguments(options).includes('--no-sandbox'),disabled);assert.equal(browserLaunchArguments(options).includes('--disable-setuid-sandbox'),disabled);assert.equal(playwrightSandboxOptions(options).chromiumSandbox,!disabled);assert.ok(browserLaunchArguments(options).includes('--disable-dev-shm-usage'))}
});
