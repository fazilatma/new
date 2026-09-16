import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

const sqliteAvailable=await import('node:sqlite').then(()=>true,()=>false);
test('real Node HTTP extraction and sync buttons drain SQLite with continuous worker disabled', {skip:!sqliteAvailable,timeout:30000}, async()=>{
  const cache=new URL('../node_modules/.cache/queue-http/',import.meta.url).pathname;
  await mkdir(cache,{recursive:true});const dir=await mkdtemp(join(cache,'server-'));
  const outfile=join(dir,'server.mjs'),sentFile=join(dir,'sent.json');
  const fixture=await readFile(new URL('./fixtures/profile-pricing.html',import.meta.url),'utf8');
  // Mock only source HTTP and the category catalog, never the dispatcher,
  // processor, database, extraction engines or HTTP routes.
  await build({entryPoints:[new URL('../render-src/server.ts',import.meta.url).pathname],outfile,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'offline-source',setup(b){
    b.onResolve({filter:/^\.\/network\.js$/},args=>args.importer.endsWith('/render-src/scraper.ts')?{path:'source',namespace:'fixture'}:undefined);
    b.onResolve({filter:/^\.\/maintenance\.js$/},args=>args.importer.endsWith('/render-src/processor.ts')?{path:'categories',namespace:'fixture'}:undefined);
    b.onResolve({filter:/^\.\/sync\.js$/},args=>args.importer.endsWith('/render-src/processor.ts')?{path:'delivery',namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='delivery'?`import {writeFile} from 'node:fs/promises';export const syncWoo=async product=>{await writeFile(${JSON.stringify(sentFile)},JSON.stringify(product));return 'updated'};export const syncBasalam=async()=>[];`:args.path==='categories'?'export const destinationCategories=async()=>({items:[{id:17,name:"Shoes"}]});':`export const safeText=async url=>({url,text:${JSON.stringify(fixture)},status:200});export const sourceRoute=async()=>({mode:'direct'});`}));
  }}]});
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[outfile],{cwd:dir,env:{...process.env,PORT:String(port),SCRAPER_BIND_HOST:'127.0.0.1',DATABASE_URL:'sqlite:'+join(dir,'test.sqlite'),SCRAPER4_SQLITE_PATH:join(dir,'test.sqlite'),RUN_WORKER_IN_WEB:'false',LOCAL_SCRAPER_AUTO_UPDATE:'false',ADMIN_TOKEN:'offline-queue-test'},stdio:['ignore','pipe','pipe']});
  let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{logs=(logs+chunk).slice(-12000)});
  const exited=once(child,'exit');
  const api=async(path,body)=>{
    const response=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{authorization:'Bearer offline-queue-test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(2000)});
    const result=await response.json();assert.ok(response.ok,JSON.stringify(result));return result;
  };
  try{
    let ready=false;
    for(let i=0;i<100;i++){
      if(child.exitCode!==null)throw Error(logs);
      try{const health=await api('/health');if(health.databaseReady){ready=true;break}}catch{}
      await delay(100);
    }
    assert.equal(ready,true,logs);
    const {profile}=await api('/api/profiles',{name:'Queue HTTP regression',url:'https://shop.example/',pages:1,enabled:false,aiDescriptions:false,basalamCategoryId:17,extractionEngine:'cheerio',selectors:{container:'.product',title:'h2',price:'.price, .detail-price',link:'a',image:'img',shortDesc:'.short'}});
    // No extraction or destination calls: sync over this empty local profile is fully offline.
    const created=await api(`/api/profiles/${profile.id}/sync`,{target:'none'});
    assert.equal(created.processor,'triggered');
    let job;
    for(let i=0;i<50;i++){({job}=await api('/api/jobs/'+created.job.id));if(job.status!=='queued'&&job.status!=='running')break;await delay(50)}
    assert.equal(job.status,'done',JSON.stringify(job)+'\n'+logs);assert.ok(job.startedAt);
    const queue=await api('/api/jobs');assert.equal(queue.jobs.length,1,'one click must create only one job');assert.equal(queue.processor.continuous,false);assert.equal(queue.processor.lastError,false);
    const extraction=await api(`/api/profiles/${profile.id}/scrape`,{target:'none'});
    for(let i=0;i<50;i++){({job}=await api('/api/jobs/'+extraction.job.id));if(!['queued','running'].includes(job.status))break;await delay(50)}
    assert.equal(job.status,'done',JSON.stringify(job)+'\n'+logs);assert.ok(job.added>0,'real fixture extraction must save products');
    const products=await api(`/api/profiles/${profile.id}/products`);assert.ok(products.products.length>0);assert.equal(products.products[0].basalamCategoryId,17);
    const base=products.products[0].resultBase.price;
    await api('/api/profiles',{...profile,priceMode:'percent',priceValue:10,titleSuffix:' (کد:21)'});
    await api(`/api/profiles/${profile.id}/results/apply`,{});
    let adjusted=await api(`/api/profiles/${profile.id}/products`);assert.equal(adjusted.products[0].price,Math.round(base*1.1));
    await api('/api/profiles',{...profile,priceMode:'percent',priceValue:20,titleSuffix:' (کد:31)'});
    await api(`/api/profiles/${profile.id}/results/apply`,{});await api(`/api/profiles/${profile.id}/results/apply`,{});
    adjusted=await api(`/api/profiles/${profile.id}/products`);assert.equal(adjusted.products[0].price,Math.round(base*1.2));assert.match(adjusted.products[0].title,/\(کد:31\)$/);assert.doesNotMatch(adjusted.products[0].title,/کد:21/);
    const delivery=await api(`/api/profiles/${profile.id}/sync`,{target:'woo'});
    for(let i=0;i<50;i++){({job}=await api('/api/jobs/'+delivery.job.id));if(!['queued','running'].includes(job.status))break;await delay(50)}
    assert.equal(job.status,'done',JSON.stringify(job));const sent=JSON.parse(await readFile(sentFile,'utf8'));assert.equal(sent.price,adjusted.products[0].price);assert.equal(sent.title,adjusted.products[0].title);


  }finally{
    child.kill('SIGTERM');
    const timer=setTimeout(()=>child.kill('SIGKILL'),2000);timer.unref();
    await exited;clearTimeout(timer);await rm(dir,{recursive:true,force:true});
  }
});
