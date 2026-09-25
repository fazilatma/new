import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';
import {browserRepairReport,reportRedactor} from '../scripts/browser-repair-report.mjs';
import {createBrowserRepair} from '../scripts/browser-repair.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
await mkdir(join(root,'node_modules/.cache'),{recursive:true});
const temp=await mkdtemp(join(root,'node_modules/.cache/repair-report-'));
test('complete report includes runtime/cache/versions/permissions/job context but no credentials',async()=>{
 const env={ADMIN_TOKEN:'example-admintoken-123',VAULT_SECRET:'example-vault-secret',ADMIN_AUTH_DISABLED:'true',HTTPS_PROXY:'https://proxyuser:proxypass@proxy.example/private?key=hidden',PLAYWRIGHT_BROWSERS_PATH:join(temp,'pw'),PUPPETEER_CACHE_DIR:join(temp,'pup'),NODE_OPTIONS:'--require /secret/custom-hook.js'};
 await mkdir(env.PLAYWRIGHT_BROWSERS_PATH);await mkdir(env.PUPPETEER_CACHE_DIR);await mkdir(join(env.PLAYWRIGHT_BROWSERS_PATH,'chromium-1234'));
 const network={mode:'worker',workerUrl:'https://worker.example/secret-gateway-path?url={url}&key=hidden'};
 const report=await browserRepairReport({cwd:root,env,network,version:'test-release',head:'abc123',state:{phase:'failed',log:'example-admintoken-123 example-vault-secret Bearer bearerSecret https://user:pass@cdn.example/file.zip?anything=hidden-query https://worker.example/secret-gateway-path?url=x',options:{allowMirror:true},logTruncated:true},resolveExecutable:()=>process.execPath});
 for(const secret of ['example-admintoken-123','example-vault-secret','proxypass','proxyuser','bearerSecret','hidden-query','secret-gateway-path','custom-hook'])assert.ok(!report.includes(secret),secret);
 const parsed=JSON.parse(report.slice(report.indexOf('\n')+1));assert.equal(parsed.application.version,'test-release');assert.equal(parsed.runtime.node,process.version);assert.ok(parsed.disk.availableBytes>=0);assert.equal(parsed.job.logTruncated,true);assert.equal(parsed.currentNetwork.mode,'worker');assert.ok(parsed.libraries.find(x=>x.name==='playwright').installedVersion);assert.equal(parsed.executables.playwright.exists,true);assert.equal(parsed.caches[0].revisions[0],'chromium-1234');assert.equal(parsed.projectPermissions.readable,true);
});
test('missing libraries and invalid cache configuration still produce a useful idle report',async()=>{
 await writeFile(join(temp,'package.json'),'{"version":"fixture"}');
 const result=await browserRepairReport({cwd:temp,env:{PLAYWRIGHT_BROWSERS_PATH:'0'},state:{phase:'idle'},resolveExecutable:()=>'/does-not-exist/chrome'});assert.match(result,/package-local/);assert.match(result,/"phase": "idle"/);assert.match(result,/"exists": false/);
});
test('redaction handles secret assignments, authorization, credential URLs and unrecognized query keys',()=>{
 const clean=reportRedactor({API_KEY:'very-private-value'});const text=clean('API_KEY=unknown-secret Authorization: Bearer abc.def https://name:password@host.example/a?strange=private very-private-value');
 for(const secret of ['unknown-secret','abc.def','name:password','strange=private','very-private-value'])assert.ok(!text.includes(secret),secret);
});
test('repair status records actual requested options, selected download route and log truncation',async()=>{
 const job=createBrowserRepair({uid:1000,env:{},plan:()=>[{name:'playwright',version:'1.2.3',installed:false}],resolveNpm:()=>'/npm',resolveExecutable:()=>undefined,resolveDownloadEnv:async()=>({SCRAPER_BROWSER_GATEWAY:'https://gateway.example/?url='}),run:async(args,opts)=>{opts.log('X'.repeat(25000));return true}});job.start({allowMirror:true});while(job.status().running)await new Promise(r=>setImmediate(r));const s=job.status();assert.equal(s.options.allowMirror,true);assert.equal(s.options.reuseExisting,false);assert.equal(s.downloadRoute,'cloudflare-gateway');assert.equal(s.logTruncated,true);assert.equal(s.log.length,24000);
});
async function uiHarness({secure=true,clipboardFails=false,execSuccess=true,apiFails=false}={}){
 const s=await readFile(join(root,'worker-src/dashboard.ts'),'utf8'),start=s.indexOf('async function copyBrowserRepairReport()'),end=s.indexOf('async function menuAction(',start),{document}=parseHTML('<textarea id="browserRepairReport" hidden></textarea><input id="browserRepairMirror"><input id="browserRepairRoot">');let copied='',requests=0;const notices=[];const box=document.getElementById('browserRepairReport');box.focus=()=>{};box.select=()=>{};document.execCommand=()=>{copied=box.value;return execSuccess};
 const fn=new Function('$','api','navigator','window','document','notice',s.slice(start,end)+';return copyBrowserRepairReport;')(id=>document.getElementById(id),async()=>{requests++;if(apiFails)throw Error('offline');return{ok:true,report:'SANITIZED SERVER REPORT'}},{userAgent:'Test browser',clipboard:{writeText:async text=>{if(clipboardFails)throw Error('denied');copied=text}}},{isSecureContext:secure},document,(...args)=>notices.push(args));await fn();return{copied,requests,box,notices};
}
test('copy button obtains a fresh server report, includes client conditions and makes text reviewable',async()=>{const h=await uiHarness();assert.equal(h.requests,1);assert.match(h.copied,/SANITIZED SERVER REPORT/);assert.match(h.copied,/CLIENT UI/);assert.equal(h.box.hidden,false);assert.equal(h.notices.at(-1)[1],'ok')});
test('HTTP copy fallback and denied clipboard leave selectable report without false success',async()=>{assert.equal((await uiHarness({secure:false})).notices.at(-1)[1],'ok');for(const options of [{secure:false,execSuccess:false},{clipboardFails:true}]){const h=await uiHarness(options);assert.equal(h.notices.at(-1)[1],'info');assert.equal(h.box.hidden,false);assert.match(h.box.value,/SANITIZED SERVER REPORT/)}const h=await uiHarness({apiFails:true});assert.equal(h.copied,'');assert.equal(h.notices.at(-1)[1],'error')});
