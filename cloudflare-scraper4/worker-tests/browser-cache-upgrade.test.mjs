import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,chmodSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {browserPaths} from '../scripts/browser-paths.mjs';
import {cacheRequirements,inspectBrowserCache,compatibleCachePath} from '../scripts/browser-cache-compatibility.mjs';
import {browserRepairReport} from '../scripts/browser-repair-report.mjs';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'browser-upgrade-')),home=join(root,'old-home'),project=join(root,'data/browsers/ms-playwright'),legacy=join(home,'.cache/ms-playwright');
 const manifest=join(root,'node_modules/playwright-core/browsers.json');mkdirSync(dirname(manifest),{recursive:true});writeFileSync(manifest,JSON.stringify({browsers:[{name:'chromium',revision:'1243'},{name:'chromium-headless-shell',revision:'1243'}]}));
 mkdirSync(project,{recursive:true});mkdirSync(legacy,{recursive:true});
 const put=(folder,revision='1243',shell=true)=>{for(const relative of [`chromium-${revision}/chrome-linux64/chrome`,...(shell?[`chromium_headless_shell-${revision}/chrome-headless-shell-linux64/chrome-headless-shell`]:[])]){const file=join(folder,relative);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'fixture executable, never launched');chmodSync(file,0o755);}};
 return {root,home,project,legacy,put,env:{HOME:join(root,'private-panel-home'),BROWSER_CACHE_SOURCE_HOME:home},close:()=>rmSync(root,{recursive:true,force:true})};
}
test('upgrade reproduces empty project cache and preserves exact existing full Chromium plus headless shell',()=>{
 const f=fixture();try{f.put(f.legacy);const selected=browserPaths(f.env,f.root);assert.equal(selected.PLAYWRIGHT_BROWSERS_PATH,f.legacy);assert.ok(existsSync(f.project));assert.equal(compatibleCachePath('playwright',f.project,f.env,f.root,{platform:'linux',uid:1000}),f.legacy);}
 finally{f.close();}
});
test('wrong revision, headless-shell missing and permissionless executable are not valid migration sources',()=>{
 const f=fixture();try{f.put(f.legacy,'1242');f.put(f.legacy,'1243',false);const req=cacheRequirements(f.root,{platform:'linux'}).playwright;
 assert.equal(inspectBrowserCache(f.legacy,req,'playwright').compatible,false);
 f.put(f.legacy);chmodSync(join(f.legacy,'chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell'),0o600);
 assert.equal(inspectBrowserCache(f.legacy,req,'playwright').compatible,false);
 }finally{f.close();}
});
test('complete project cache wins, explicit paths and hermetic zero are never silently redirected',()=>{
 const f=fixture();try{f.put(f.legacy);f.put(f.project);assert.equal(browserPaths(f.env,f.root).PLAYWRIGHT_BROWSERS_PATH,f.project);
 assert.equal(browserPaths({...f.env,PLAYWRIGHT_BROWSERS_PATH:'/explicit/empty'},f.root).PLAYWRIGHT_BROWSERS_PATH,'/explicit/empty');
 assert.equal(browserPaths({...f.env,PLAYWRIGHT_BROWSERS_PATH:'0'},f.root).PLAYWRIGHT_BROWSERS_PATH,'0');
 }finally{f.close();}
});
test('diagnostic separates idle repair job from failed background install and names missing shell with bounded redacted log',async()=>{
 const f=fixture();try{f.put(f.legacy);const dir=join(f.root,'data/browser-install');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'status.json'),JSON.stringify({running:false,phase:'failed',exitCode:1}));writeFileSync(join(dir,'install.log'),'x'.repeat(26000)+'\nDownload failed https://user:password@host.example/file?token=private\n');
 const text=await browserRepairReport({cwd:f.root,env:{...f.env,PLAYWRIGHT_BROWSERS_PATH:f.project,PUPPETEER_CACHE_DIR:join(f.root,'pup')},state:{phase:'idle'}}),report=JSON.parse(text.slice(text.indexOf('\n')+1));
 assert.equal(report.backgroundInstall.state.phase,'failed');assert.equal(report.job.phase,'idle');assert.equal(report.backgroundInstall.logTruncated,true);assert.ok(report.backgroundInstall.log.length<=24000);assert.ok(!text.includes('user:password'));assert.ok(!text.includes('token=private'));assert.match(text,/chromium_headless_shell-1243/);assert.equal(report.caches[0].compatibility.compatible,false);assert.ok(report.caches[0].legacyCandidates.some(c=>c.compatible));assert.ok(report.warnings.length);
 }finally{f.close();}
});
test('Puppeteer migration accepts only the SDK-pinned Chrome build',()=>{
 const f=fixture();try{const metadata=join(f.root,'node_modules/puppeteer-core/lib/puppeteer/revisions.js');mkdirSync(dirname(metadata),{recursive:true});writeFileSync(metadata,"export const PUPPETEER_REVISIONS={chrome: '152.0.7977.75'};");
 const cache=join(f.home,'.cache/puppeteer'),file=join(cache,'chrome/linux-152.0.7977.75/chrome-linux64/chrome');mkdirSync(dirname(file),{recursive:true});writeFileSync(file,'not launched');chmodSync(file,0o755);
 assert.equal(compatibleCachePath('puppeteer',join(f.root,'new-pup'),f.env,f.root,{platform:'linux',arch:'x64',uid:1000}),cache);
 }finally{f.close();}
});
