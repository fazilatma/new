import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,symlink,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {reuseBrowserCaches as current} from '../scripts/browser-cache-reuse.mjs';
import {createBrowserRepair} from '../scripts/browser-repair.mjs';
const cwd=fileURLToPath(new URL('..',import.meta.url));await mkdir(join(cwd,'node_modules/.cache'),{recursive:true});const temp=await mkdtemp(join(cwd,'node_modules/.cache/cache-alias-'));
let reuseBrowserCaches=current;
if(process.env.CACHE_REPRO_BEFORE){const file=join(temp,'before.mjs');await writeFile(file,execFileSync('git',['show','3baddc3:cloudflare-scraper4/scripts/browser-cache-reuse.mjs'],{cwd,encoding:'utf8'}));reuseBrowserCaches=(await import(pathToFileURL(file))).reuseBrowserCaches;}
async function fixture(){const dir=await mkdtemp(join(temp,'case-')),sourceHome=join(dir,'root'),home=join(dir,'runtime'),source=join(sourceHome,'.cache/ms-playwright'),target=join(home,'.cache/ms-playwright');await mkdir(join(sourceHome,'.cache'),{recursive:true});return {dir,sourceHome,home,source,target,env:{BROWSER_CACHE_SOURCE_HOME:sourceHome}};}
test('source and target aliases of the same cache are a verified no-op, not a symlink failure',async()=>{
 const f=await fixture();await mkdir(f.target,{recursive:true});await writeFile(join(f.target,'chrome'),'keep');await symlink(f.target,f.source);
 const result=await reuseBrowserCaches(f);assert.equal(result[0].status,'already-runtime-cache');assert.equal(result[0].copied,0);assert.equal(result[0].resolvedSource,result[0].resolvedTarget);assert.equal(await readFile(join(f.target,'chrome'),'utf8'),'keep');
});
test('distinct root aliases and contained browser file links copy safely into regular files',async()=>{
 const f=await fixture(),actual=join(f.dir,'staging/ms-playwright'),runtime=join(f.dir,'actual/ms-playwright');await mkdir(actual,{recursive:true});await writeFile(join(actual,'real-browser'),'browser',{mode:0o755});await symlink('real-browser',join(actual,'chrome'));await symlink(actual,f.source);await mkdir(runtime,{recursive:true});await mkdir(join(f.home,'.cache'),{recursive:true});await symlink(runtime,f.target);
 const result=await reuseBrowserCaches(f);assert.equal(result[0].copied,2);assert.equal(await readFile(join(runtime,'chrome'),'utf8'),'browser');assert.equal((await lstat(join(runtime,'chrome'))).isSymbolicLink(),false);assert.equal((await lstat(join(actual,'chrome'))).isSymbolicLink(),true);
});
test('escaping source links, directory cycles and destination aliases to system-like folders remain blocked',async()=>{
 for(const mode of ['escape','cycle','destination']){const f=await fixture();await mkdir(f.source,{recursive:true});await writeFile(join(f.source,'chrome'),'browser');if(mode==='escape')await symlink(f.dir,join(f.source,'escape'));if(mode==='cycle')await symlink('.',join(f.source,'loop'));if(mode==='destination'){const outside=join(f.dir,'unrelated');await mkdir(outside);await mkdir(join(f.home,'.cache'),{recursive:true});await symlink(outside,f.target);}await assert.rejects(reuseBrowserCaches(f),/escapes|cycle|unrelated/);}
});
test('one cache error is recorded while the other cache can still be copied',async()=>{
 const f=await fixture();await mkdir(f.source,{recursive:true});await symlink(f.dir,join(f.source,'escape'));const other=join(f.sourceHome,'.cache/puppeteer');await mkdir(other);await writeFile(join(other,'chrome'),'browser');const result=await reuseBrowserCaches({...f,continueOnError:true});assert.equal(result[0].status,'failed');assert.match(result[0].error,/escapes/);assert.equal(result[1].copied,1);
});
const wait=async job=>{while(job.status().running)await new Promise(r=>setImmediate(r));return job.status();};
const libraries=()=>['playwright','puppeteer','crawlee'].map(name=>({name,version:'1.2.3',installed:true}));
test('reported libatk failure is classified and never causes a redundant browser download',async()=>{
 const calls=[],job=createBrowserRepair({uid:1000,env:{},plan:libraries,resolveExecutable:()=>undefined,resolveCli:()=>{throw Error('must not download')},resolveDownloadEnv:async()=>{throw Error('must not access network')},run:async(args,opts)=>{calls.push(args);if(args.at(-1).includes("import('playwright')")){opts.log('chrome-headless-shell: error while loading shared libraries: libatk-1.0.so.0: cannot open shared object file: No such file or directory');return false}return true}});
 job.start();const result=await wait(job);assert.equal(result.success,false);assert.equal(result.results.playwright.errorCategory,'missing-os-libraries');assert.deepEqual(result.results.playwright.missingLibraries,['libatk-1.0.so.0']);assert.match(result.results.playwright.action,/install-deps chromium/);assert.equal(result.results.puppeteer.success,true);assert.equal(result.results['crawlee-playwright'].skipped,true);assert.equal(calls.length,3);assert.ok(calls.every(args=>args.includes('--input-type=module')));
});
test('cache-copy failure does not hide launch results behind an empty results object',async()=>{
 const job=createBrowserRepair({uid:1000,env:{},plan:libraries,resolveExecutable:()=>undefined,reuseCaches:async()=>[{driver:'playwright',status:'failed',error:'unsafe symlink'},{driver:'puppeteer',status:'source-missing'}],run:async()=>true});job.start({reuseExisting:true});const result=await wait(job);assert.equal(result.success,false);assert.equal(Object.keys(result.results).length,4);assert.equal(result.results.playwright.success,true);
});
