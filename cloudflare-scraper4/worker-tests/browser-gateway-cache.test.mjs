import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {gatewayUrl,downloadTarget,gatewayDownloadEnvironment} from '../scripts/browser-download-gateway.mjs';
import {cacheReusePlan,reuseBrowserCaches} from '../scripts/browser-cache-reuse.mjs';
import {createBrowserRepair,runBrowserCommand,npmCli} from '../scripts/browser-repair.mjs';
const cwd=fileURLToPath(new URL('..',import.meta.url));
await mkdir(join(cwd,'node_modules/.cache'),{recursive:true});
const temp=await mkdtemp(join(cwd,'node_modules/.cache/gateway-cache-'));
test('gateway contract supports query, placeholder and path; rejects unsafe download targets',()=>{
 const target='https://registry.npmjs.org/playwright';assert.equal(new URL(gatewayUrl('proxy.example.workers.dev/?url=',target)).searchParams.get('url'),target);
 assert.equal(gatewayUrl('https://proxy.example/?url={url}',target),'https://proxy.example/?url='+encodeURIComponent(target));assert.equal(gatewayUrl('https://proxy.example',target),'https://proxy.example/'+target);
 for(const url of ['file:///etc/passwd','http://127.0.0.1/','https://evil.example/file','https://registry.npmjs.org.evil.example/','https://u:p@registry.npmjs.org/','https://registry.npmjs.org:444/'])assert.throws(()=>downloadTarget(url));
 assert.throws(()=>gatewayUrl('http://proxy.example',target));
 const env=gatewayDownloadEnvironment({HTTPS_PROXY:'https://old.example',HTTP_PROXY:'old',NODE_OPTIONS:'--no-warnings'},'https://proxy.example/?url=',cwd);assert.equal(env.HTTPS_PROXY,undefined);assert.match(env.NODE_OPTIONS,/--no-warnings.*--import=file:/);assert.match(env.NODE_OPTIONS,/cloudflare-scraper4\/scripts\/browser-download-gateway.mjs/);
});
test('real child HTTPS, builtin fetch and npm metadata are routed through a TLS gateway, with no credentials forwarded',{timeout:30000},async()=>{
 const key=join(temp,'key.pem'),cert=join(temp,'cert.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const packageDir=join(temp,'package');await mkdir(packageDir);await writeFile(join(packageDir,'package.json'),JSON.stringify({name:'playwright',version:'1.2.3'}));const archive=join(temp,'fixture.tgz');execFileSync('tar',['-czf',archive,'-C',temp,'package']);const tarball=await readFile(archive),integrity='sha512-'+createHash('sha512').update(tarball).digest('base64');
 const hits=[];const server=createServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{const target=new URL(req.url,'https://proxy.example').searchParams.get('url');hits.push({target,headers:req.headers});if(target.endsWith('.tgz')){res.end(tarball);return;}res.setHeader('content-type','application/json');res.end(JSON.stringify(target.includes('registry.npmjs.org')?{name:'playwright','dist-tags':{latest:'1.2.3'},versions:{'1.2.3':{name:'playwright',version:'1.2.3',dist:{tarball:'https://registry.npmjs.org/playwright/-/playwright-1.2.3.tgz',integrity}}}}:{ok:true}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const env=gatewayDownloadEnvironment({...process.env,NODE_EXTRA_CA_CERTS:cert},'https://127.0.0.1:'+server.address().port+'/?url=',cwd),logs=[];
 try{
  assert.equal(await runBrowserCommand(['--input-type=module','-e',`import https from 'node:https';await new Promise((resolve,reject)=>https.get('https://cdn.playwright.dev/file.zip',{headers:{authorization:'Bearer secret',cookie:'secret',range:'bytes=0-9'}},r=>{r.resume();r.on('end',resolve)}).on('error',reject));if(!(await fetch('https://storage.googleapis.com/chrome-for-testing-public/file.zip')).ok)throw Error('fetch failed');`],{cwd,env,log:x=>logs.push(x),timeout:10000}),true,logs.join('\n'));
  assert.equal(await runBrowserCommand([npmCli(process.env),'view','playwright','version','--registry=https://registry.npmjs.org','--cache='+join(temp,'npm-cache'),'--fetch-retries=0'],{cwd,env,log:x=>logs.push(x),timeout:10000}),true,logs.join('\n'));
  const installDir=join(temp,'install');await mkdir(installDir);await writeFile(join(installDir,'package.json'),'{"name":"gateway-install-test","version":"1.0.0"}');
  assert.equal(await runBrowserCommand([npmCli(process.env),'install','playwright@1.2.3','--ignore-scripts','--no-audit','--no-fund','--no-save','--package-lock=false','--registry=https://registry.npmjs.org','--cache='+join(temp,'npm-cache'),'--fetch-retries=0'],{cwd:installDir,env,log:x=>logs.push(x),timeout:10000}),true,logs.join('\n'));
  assert.equal(JSON.parse(await readFile(join(installDir,'node_modules/playwright/package.json'),'utf8')).version,'1.2.3');assert.ok(hits.some(h=>h.target.endsWith('playwright-1.2.3.tgz')));
  assert.ok(hits.some(h=>h.target==='https://cdn.playwright.dev/file.zip'));assert.ok(hits.some(h=>h.target.includes('registry.npmjs.org/playwright')));assert.ok(hits.some(h=>h.target.includes('storage.googleapis.com')));assert.ok(hits.every(h=>!h.headers.authorization&&!h.headers.cookie));assert.equal(hits[0].headers.range,'bytes=0-9');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
});
test('same-server reuse copies executable files, retains source and existing destination, and is repeatable',async()=>{
 const sourceHome=join(temp,'source'),home=join(temp,'service'),env={BROWSER_CACHE_SOURCE_HOME:sourceHome};
 for(const p of cacheReusePlan(env,home)){await mkdir(join(p.source,'revision'),{recursive:true});await writeFile(join(p.source,'revision','chrome'),'binary',{mode:0o755})}
 let report=await reuseBrowserCaches({env,home});assert.equal(report.reduce((n,r)=>n+r.copied,0),2);
 for(const row of report){assert.equal(await readFile(join(row.source,'revision/chrome'),'utf8'),'binary');assert.ok((await stat(join(row.target,'revision/chrome'))).mode&0o100);await writeFile(join(row.target,'revision/chrome'),'keep')}
 report=await reuseBrowserCaches({env,home});assert.equal(report.reduce((n,r)=>n+r.copied,0),0);assert.equal(report.reduce((n,r)=>n+r.existing,0),2);assert.equal(await readFile(join(report[0].target,'revision/chrome'),'utf8'),'keep');
});
test('reuse rejects symlink escapes and overlapping destinations',async()=>{
 const home=join(temp,'bad-source');await mkdir(join(home,'.cache/ms-playwright'),{recursive:true});await symlink('/etc/passwd',join(home,'.cache/ms-playwright','escape'));
 await assert.rejects(reuseBrowserCaches({env:{BROWSER_CACHE_SOURCE_HOME:home},home:join(temp,'bad-target')}),/symlink/);
 await assert.rejects(reuseBrowserCaches({env:{BROWSER_CACHE_SOURCE_HOME:home,PLAYWRIGHT_BROWSERS_PATH:join(home,'.cache/ms-playwright/nested')},home:join(temp,'bad-target')}),/overlap/);
});
const done=async job=>{while(job.status().running)await new Promise(r=>setImmediate(r));return job.status()};
test('installer uses resolved gateway env for npm and browser downloads, but never for offline launch verification',async()=>{
 const calls=[];const env={TEST:'base'},job=createBrowserRepair({uid:1000,cwd,env,plan:()=>[{name:'playwright',version:'1.2.3',installed:false}],resolveNpm:()=>'/npm.js',resolveCli:()=>'/cli.js',exists:()=>true,resolveExecutable:()=>undefined,resolveDownloadEnv:async()=>({...env,SCRAPER_BROWSER_GATEWAY:'https://proxy.example/?url='}),run:async(args,options)=>{calls.push({args,env:options.env});return !args.includes('--input-type=module')||calls.filter(x=>x.args.includes('--input-type=module')).length>1;}});
 job.start();await done(job);assert.ok(calls.some(c=>c.args.includes('install')&&c.env.SCRAPER_BROWSER_GATEWAY));assert.ok(calls.filter(c=>c.args.includes('--input-type=module')).every(c=>!c.env.SCRAPER_BROWSER_GATEWAY));
});
test('reuse mode never resolves network or downloads; all four engines are verified',async()=>{
 let copied=0;const calls=[],job=createBrowserRepair({uid:1000,env:{},plan:()=>[{name:'playwright',installed:true}],reuseCaches:async()=>{copied++;return[]},resolveExecutable:()=>undefined,resolveDownloadEnv:async()=>{throw Error('must not access network')},run:async args=>{calls.push(args);return true}});
 job.start({reuseExisting:true});assert.equal((await done(job)).success,true);assert.equal(copied,1);assert.equal(calls.length,4);assert.ok(calls.every(args=>args.includes('--input-type=module')));
});
test('configured gateway resolution failure cannot run a direct installer fallback',async()=>{
 const calls=[],job=createBrowserRepair({uid:1000,env:{},plan:()=>[{name:'playwright',version:'1.2.3',installed:false}],resolveNpm:()=>'/npm.js',resolveDownloadEnv:async()=>{throw Error('gateway unavailable')},run:async args=>{calls.push(args);return true}});
 job.start({allowMirror:true});const result=await done(job);assert.equal(result.success,false);assert.equal(calls.length,0);assert.match(result.log,/gateway unavailable/);
});
