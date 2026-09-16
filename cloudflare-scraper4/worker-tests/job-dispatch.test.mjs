import assert from 'node:assert/strict';
import test from 'node:test';
import { build, transform } from 'esbuild';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const js=(await transform(await read('render-src/job-dispatcher.ts'),{loader:'ts',format:'cjs'})).code;
const mod={exports:{}};new Function('module','exports',js)(mod,mod.exports);
const {createJobDispatcher}=mod.exports;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(processOneJob){
  const tasks=new Map(),errors=[];let id=0;
  const dispatcher=createJobDispatcher({processOneJob,pollMs:500,onError:e=>errors.push(e),schedule(fn,delay){const key={id:++id,unref(){}};tasks.set(key,{fn,delay});return key},cancel:key=>tasks.delete(key)});
  return {dispatcher,tasks,errors,async tick(){assert.ok(tasks.size,'a follow-up must be scheduled');const[key,task]=tasks.entries().next().value;tasks.delete(key);task.fn();await flush();return task.delay}};
}
test('manual queue wake retries a failed claim without needing another click',async()=>{
  let calls=0;
  const h=harness(async()=>{if(++calls===1)throw Error('transient db error');return false});
  h.dispatcher.wake();await h.tick();assert.equal(h.errors.length,1);assert.equal(h.dispatcher.status().lastError,true);
  h.dispatcher.wake();assert.equal(await h.tick(),2000,'polling must not cancel error backoff');
  assert.equal(calls,2);assert.equal(h.dispatcher.status().lastError,false);assert.equal(h.tasks.size,0);h.dispatcher.stop();
});
test('a 30-job queue continues after yielding at the 25-job batch limit',async()=>{
  let remaining=30,calls=0;
  const h=harness(async()=>{calls++;if(!remaining)return false;remaining--;return true});
  h.dispatcher.wake();await h.tick();assert.equal(remaining,5);await h.tick();assert.equal(remaining,0);assert.equal(calls,31);assert.equal(h.dispatcher.status().processed,30);assert.equal(h.tasks.size,0);
});
test('manual clicks and continuous polling share one runner; empty-claim wake-ups are retained',async()=>{
  let release,calls=0;
  const h=harness(async()=>{calls++;if(calls===1)await new Promise(resolve=>release=resolve);return false});
  h.dispatcher.start();h.dispatcher.wake();await h.tick();assert.equal(calls,1);assert.equal(h.dispatcher.status().running,true);
  for(let i=0;i<20;i++)h.dispatcher.wake();assert.equal(h.tasks.size,0);
  release();await flush();assert.equal(await h.tick(),0);assert.equal(calls,2);assert.equal(h.tasks.size,1,'continuous runner resumes idle polling');
  h.dispatcher.stop();assert.equal(h.tasks.size,0);h.dispatcher.wake();assert.equal(h.tasks.size,0);
});
test('stopping an active dispatcher does not schedule another job',async()=>{
  let release,calls=0;const h=harness(async()=>{calls++;await new Promise(resolve=>release=resolve);return true});
  h.dispatcher.wake();await h.tick();h.dispatcher.stop();release();await flush();assert.equal(calls,1);assert.equal(h.tasks.size,0);
});

const cache=new URL('../node_modules/.cache/queue-tests/',import.meta.url).pathname;
await mkdir(cache,{recursive:true});
const dir=await mkdtemp(join(cache,'db-')),outfile=join(dir,'db.cjs'),database=join(dir,'queue.sqlite');
await build({entryPoints:[new URL('../render-src/db.ts',import.meta.url).pathname],outfile,bundle:true,platform:'node',format:'cjs',packages:'external'});
const run=promisify(execFile);
async function databaseScript(code){
  const {stdout}=await run(process.execPath,['--input-type=module','-e',`import {createRequire} from 'node:module';const db=createRequire(import.meta.url)(${JSON.stringify(outfile)});${code}`],{env:{...process.env,DATABASE_URL:'sqlite:'+database,SCRAPER4_SQLITE_PATH:database}});
  return JSON.parse(stdout);
}
const sqliteAvailable=await import('node:sqlite').then(()=>true,()=>false);
test('real SQLite concurrent claims never nest transactions or claim a job twice',{skip:!sqliteAvailable},async()=>{
  const data=await databaseScript(`await db.migrate();await db.saveProfile({id:'p',name:'Queue',url:'https://shop.example',enabled:true,intervalMinutes:0,createdAt:new Date().toISOString()});
    const job=await db.createJob('p','scrape','none');
    const result=await Promise.all(Array.from({length:12},()=>db.claimJob()));
    console.log(JSON.stringify({claimed:result.filter(Boolean).map(x=>x.id),status:(await db.getJob(job.id)).status}));await db.pool.end();`);
  assert.equal(data.claimed.length,1);assert.equal(data.status,'running');
});
test('real SQLite claims are exclusive between separate worker processes',{skip:!sqliteAvailable},async()=>{
  await databaseScript(`await db.pool.query("DELETE FROM jobs");for(let i=0;i<20;i++)await db.pool.query("INSERT INTO jobs(id,profile_id,kind) VALUES($1,'p','sync')",['job-'+i]);console.log('true');await db.pool.end();`);
  const worker=`const ids=[];for(;;){const job=await db.claimJob();if(!job)break;ids.push(job.id);await db.updateJob(job.id,{status:'done'})}console.log(JSON.stringify(ids));await db.pool.end();`;
  const ids=(await Promise.all([databaseScript(worker),databaseScript(worker)])).flat();
  assert.equal(ids.length,20);assert.equal(new Set(ids).size,20);
});

async function routeHandler(file,route,io){
  const source=await read(file),at=source.indexOf(`app.${route}`);assert.ok(at>=0);
  const end=source.indexOf('\napp.',at+4);
  const body=(await transform(source.slice(at,end),{loader:'ts'})).code;
  let handler;new Function('app',...Object.keys(io),body)({get:(_p,fn)=>handler=fn,post:(_p,fn)=>handler=fn},...Object.values(io));return handler;
}
const context={req:{param:()=> 'j',query:()=> '100'},json:(body,status=200)=>({body,status}),executionCtx:{waitUntil:()=>{}}};
for(const file of ['render-src/server.ts','worker-src/app.ts']){
  test(`${file}: start action reuses queued job, refuses running/completed jobs`,async()=>{
    let current={id:'j',status:'queued'},wakes=0;
    const fn=await routeHandler(file,"post('/api/jobs/:id/start'",{getJob:async()=>current,triggerLocalJobDrain:()=>wakes++,enqueueJob:async j=>{assert.equal(j.id,'j');wakes++}});
    assert.equal((await fn(context)).status,202);assert.equal(wakes,1);
    for(const status of ['running','done','failed','stopped']){current={id:'j',status};assert.equal((await fn(context)).status,409)}
    current=null;assert.equal((await fn(context)).status,404);assert.equal(wakes,1);
  });
}
test('Node: clicking sync wakes an existing queued scrape without duplicating it',async()=>{
  let wakes=0;
  const fn=await routeHandler('render-src/server.ts',"post('/api/profiles/:id/sync'",{getProfile:async()=>({id:'p'}),createJob:async()=>({id:'existing',kind:'scrape',status:'queued'}),validTarget:x=>x,triggerLocalJobDrain:()=>wakes++});
  const result=await fn({...context,req:{...context.req,json:async()=>({})}});
  assert.equal(wakes,1);assert.equal(result.body.job.id,'existing');assert.equal(result.body.processor,'triggered');
});
test('Node: viewing a persisted queue wakes the dispatcher and exposes claim failures safely',async()=>{
  let wakes=0;
  const fn=await routeHandler('render-src/server.ts',"get('/api/jobs'",{listJobs:async()=>[{status:'queued'}],triggerLocalJobDrain:()=>wakes++,jobDispatcher:{status:()=>({lastError:true})}});
  const result=await fn(context);assert.equal(wakes,1);assert.equal(result.body.processor.lastError,true);
});
test('queue UI offers recovery only for queued jobs and never renders raw processor errors',async()=>{
  const source=await read('worker-src/dashboard.ts'),a=source.indexOf('function jobQueueRecoveryHtml'),b=source.indexOf('function jobLiveMeta',a);
  const state={jobProcessor:{lastError:true}},esc=s=>String(s).replaceAll('<','&lt;');
  const render=new Function('state','esc','escAttr',source.slice(a,b)+';return jobQueueRecoveryHtml;')(state,esc,esc);
  assert.equal(render({status:'running'}),'');assert.equal(render({status:'done'}),'');
  const html=render({id:'j',status:'queued'});assert.match(html,/data-job-action="start"/);assert.match(html,/تلاش مجدد خودکار/);
  assert.ok(source.includes('jobDispatcher')===false); // no browser-side background processor
});
test('real SQLite sync product loader uses portable SQL and ignores null/corrupt rows',{skip:!sqliteAvailable},async()=>{
  const rows=await databaseScript(`await db.upsertProduct('p',{sourceKey:'good',title:'Good',price:100,url:'https://shop.example/good'});
    await db.pool.query("INSERT INTO products(profile_id,source_key,data,title) VALUES('p','null','null','Null'),('p','corrupt','broken','Bad'),('p','array','[]','Array')");
    console.log(JSON.stringify(await db.allProducts('p')));await db.pool.end();`);
  assert.deepEqual(rows.map(row=>row.sourceKey),['good']);
});
test('price changes queue one follow-up behind an active profile and coalesce pending sends',{skip:!sqliteAvailable},async()=>{
 const data=await databaseScript(`await db.pool.query("DELETE FROM jobs");const active=await db.createJob('p','scrape','none');await db.claimJob();const send=await db.createJob('p','sync','woo',{priceSync:true});const again=await db.createJob('p','sync','woo',{priceSync:true});const blocked=await db.claimJob();await db.updateJob(active.id,{status:'done'});const next=await db.claimJob();console.log(JSON.stringify({active:active.id,send:send.id,again:again.id,blocked,next:next.id}));await db.pool.end();`);
 assert.notEqual(data.active,data.send);assert.equal(data.send,data.again);assert.equal(data.blocked,null);assert.equal(data.next,data.send);
});
