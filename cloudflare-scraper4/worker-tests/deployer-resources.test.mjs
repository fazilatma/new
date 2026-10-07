import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourceMonitor,memoryFromProc,cpuTotals,readResources} from '../scripts/deployer-resources.mjs';

test('host RAM uses reclaimable MemAvailable; fallback labels cache and never invents missing RAM',()=>{
 const m=memoryFromProc('MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB\n',1,0);
 assert.equal(m.percent,60);assert.equal(m.total,1024000);assert.match(m.source,/MemAvailable/);
 assert.match(memoryFromProc('',1000,100).source,/includes cache/);
 assert.equal(memoryFromProc('',0,0),null);assert.equal(memoryFromProc('',1000,NaN),null);
});
test('CPU totals tolerate Android restrictions and reject malformed counters',()=>{
 assert.equal(cpuTotals([]),null);assert.equal(cpuTotals([{times:{user:NaN,idle:1}}]),null);
 assert.deepEqual(cpuTotals([{times:{user:10,sys:20,idle:70}}]),{idle:70,total:100});
});
const row=n=>({at:n*2000,elapsed:n*2000,cpu:{total:n*100,idle:n*75},processCpu:{user:n*1000000,system:0},rss:123,memory:{percent:60},containerMemory:null,platform:'linux',termux:true});
test('CPU is an interval delta, process CPU is separate, history is bounded',async()=>{
 let n=0;const monitor=createResourceMonitor(async()=>row(++n),{maxSamples:3});
 await monitor.sample();assert.equal((await monitor.snapshot()).samples[0].cpuPercent,null);
 for(let i=0;i<5;i++)await monitor.sample();
 const data=await monitor.snapshot();assert.equal(data.samples.length,3);assert.equal(data.termux,true);
 assert.equal(data.samples.at(-1).cpuPercent,25);assert.equal(data.samples.at(-1).processCpuPercent,50);
});
test('counter reset or inaccessible host data is unavailable rather than zero CPU',async()=>{
 const rows=[row(2),row(1),{...row(3),cpu:null,memory:null}];const m=createResourceMonitor(async()=>rows.shift());
 for(let i=0;i<3;i++)await m.sample();assert.ok((await m.snapshot()).samples.every(s=>s.cpuPercent===null));
});
test('concurrent readers share a sample and read failures remain bounded',async()=>{
 let count=0,release;const m=createResourceMonitor(()=>{count++;return new Promise(r=>{release=r})});
 const a=m.sample(),b=m.sample();release(row(1));await Promise.all([a,b]);assert.equal(count,1);
 const failure=createResourceMonitor(async()=>{throw Error('permission denied')},{maxSamples:2});
 for(let i=0;i<4;i++)await failure.sample();const data=await failure.snapshot();assert.equal(data.samples.length,2);assert.equal(data.samples[0].rss,null);
});
test('real host sampling provides process RSS without any external service',async()=>{
 const r=await readResources();assert.ok(r.rss>0);assert.ok(r.elapsed>=0);assert.equal(typeof r.platform,'string');
});

test('live deployer resource API is token protected, uncached, and returns real samples', {timeout:20000}, async()=>{
 const {spawn}=await import('node:child_process');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {createServer}=await import('node:net');const {once}=await import('node:events');
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const dir=await mkdtemp(join(tmpdir(),'resource-api-'));await writeFile(join(dir,'package.json'),JSON.stringify({name:'resource-fixture',version:'0.0.0',scripts:{}}));
 const child=spawn(process.execPath,[new URL('../scripts/local-deployer-ui.mjs',import.meta.url).pathname],{cwd:dir,env:{...process.env,DEPLOYER_UI_HOST:'127.0.0.1',DEPLOYER_UI_PORT:String(port),DEPLOYER_UI_TOKEN:'resource-test-token',DEPLOYER_HANDSHAKE_FILE:join(dir,'handshake.json'),LOCAL_DEPLOYER_AUTO_UPDATE:'false',LOCAL_DEPLOYER_AUTO_INSTALL_LATEST:'false',LOCAL_SCRAPER_AUTOSTART:'false'},stdio:['ignore','pipe','pipe']});
 child.stderr.resume();
 try{
  await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('deployer startup timeout')),10000);child.once('error',e=>{clearTimeout(timer);reject(e)});child.once('exit',()=>{clearTimeout(timer);reject(Error('deployer exited before listening'))});child.stdout.on('data',b=>{text+=b;if(text.includes('Local Deployer UI is running:')){clearTimeout(timer);resolve()}})});
  const url='http://127.0.0.1:'+port+'/api/resources';
  assert.equal((await fetch(url)).status,401);
  const response=await fetch(url,{headers:{'x-local-deployer-token':'resource-test-token'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();assert.ok(data.samples.length>=1);assert.ok(data.samples.at(-1).rss>0);assert.equal(data.maxSamples,180);assert.equal(data.intervalMs,2000);
  assert.doesNotMatch(JSON.stringify(data),/resource-test-token|handshake/);
 }finally{if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}await rm(dir,{recursive:true,force:true});}
});

const {scraperInterval,readScraperResources}=await import('../scripts/deployer-resources.mjs');
const scraperRow=n=>({status:'available',instanceId:'boot-a',pid:123,uptimeMs:1000*n,cpuMicros:2000000*n,rss:1024,heapUsed:512});
test('scraper CPU keeps multi-core percentages and resets across restart or reconnect',()=>{
 assert.equal(scraperInterval(scraperRow(2),scraperRow(1)).cpuPercent,200);
 assert.equal(scraperInterval({...scraperRow(2),instanceId:'boot-b'},scraperRow(1)).cpuPercent,null);
 assert.equal(scraperInterval(scraperRow(2),{status:'unavailable'}).cpuPercent,null);
 assert.equal(scraperInterval(scraperRow(1),scraperRow(2)).cpuPercent,null);
 assert.equal(scraperInterval({status:'unavailable'},scraperRow(1)).rss,null);
});
test('scraper readings remain separate from host and deployer usage in history',async()=>{
 let n=0;const monitor=createResourceMonitor(async()=>({...row(++n),scraper:scraperRow(n)}));
 await monitor.sample();await monitor.sample();const s=(await monitor.snapshot()).samples.at(-1);
 assert.equal(s.scraper.cpuPercent,200);assert.equal(s.scraper.rss,1024);assert.equal(s.rss,123);assert.equal(s.cpuPercent,25);
});
test('live scraper health transport handles metrics, old servers, malformed data and timeouts',async()=>{
 const http=await import('node:http');const {once}=await import('node:events');let mode='valid';
 const server=http.createServer((req,res)=>{
  assert.equal(req.url,'/health');assert.equal(req.headers.authorization,undefined);
  if(mode==='timeout')return;
  const resources={...scraperRow(1),scope:'scraper-node-process'};
  if(mode==='malformed')resources.rss='not-a-number';
  res.end(JSON.stringify({app:'scraper4',...(mode==='old'?{}:{resources})}));
 });server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
 try{
  assert.equal((await readScraperResources(port)).rss,1024);
  mode='old';assert.match((await readScraperResources(port)).reason,/update and restart/);
  mode='malformed';assert.equal((await readScraperResources(port)).status,'unavailable');
  mode='timeout';assert.match((await readScraperResources(port,50)).reason,/time/);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 assert.equal((await readScraperResources(port)).status,'unavailable');
});
test('Node scraper self-report uses real process counters without procfs access',async()=>{
 const {readFile}=await import('node:fs/promises'),{transform}=await import('esbuild'),{randomUUID}=await import('node:crypto');
 const src=await readFile(new URL('../render-src/process-resources.ts',import.meta.url),'utf8');
 const code=(await transform(src.replace(/^import .*;$/m,'').replace('export function','function'),{loader:'ts'})).code;
 const get=new Function('randomUUID',code+';return processResources')(randomUUID),a=get(),b=get();
 assert.equal(a.pid,process.pid);assert.equal(a.instanceId,b.instanceId);assert.ok(a.rss>0);assert.ok(b.cpuMicros>=a.cpuMicros);
 const server=await readFile(new URL('../render-src/server.ts',import.meta.url),'utf8');assert.match(server,/resources: processResources\(\)/);
});
