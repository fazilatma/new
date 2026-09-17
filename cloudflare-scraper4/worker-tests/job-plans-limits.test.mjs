import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
async function compile(source,names,io={}){const code=(await transform(source.replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,''),{loader:'ts'})).code;return new Function(...Object.keys(io),code+';return {'+names.join(',')+'};')(...Object.values(io))}
const {createAiStageRunner}=await compile(await read('worker-src/job-ai-stage.ts'),['createAiStageRunner']);
test('AI circuit breaker counts consecutive failures, persists across chunks and isolates substages',async()=>{
 const states={},logs=[];let stored={},calls=0;
 const io={settings:{general:{aiStageFailureLimit:2}},states,persist:async()=>{stored=structuredClone(states)},log:(s,m)=>logs.push(m),progress:async()=>{}};
 let run=createAiStageRunner(io);
 const fail=async()=>{calls++;return{ok:false,error:'offline'}};
 await run('category',{},fail);await run('category',{},async()=>({ok:true}));assert.equal(states.category.failures,0);
 await run('category',{},fail);run=createAiStageRunner({...io,states:stored});
 await run('category',{},fail);await run('category',{},fail);assert.equal(calls,3,'no fourth model request after two consecutive failures');
 const p={};await run('description',p,async copy=>{copy.longDesc='safe';return{ok:true,changed:true}});assert.equal(p.longDesc,'safe');assert.ok(logs.some(s=>s.includes('رد شد')));
});
test('a timed-out AI response cannot mutate the product after the next stage begins',async()=>{
 const states={};let finish;const p={title:'unchanged'};
 const run=createAiStageRunner({settings:{general:{aiStageTimeoutSeconds:1,aiStageFailureLimit:1}},states,persist:async()=>{},log:()=>{},progress:async()=>{}});
 const result=await run('description',p,copy=>new Promise(resolve=>{finish=()=>{copy.title='late';resolve({ok:true})}}));
 assert.equal(result.skipped,true);finish();await new Promise(r=>setImmediate(r));assert.equal(p.title,'unchanged');assert.equal(states.description.skipped,true);
});
const sqlite=await import('node:sqlite').catch(()=>null);
for(const runtime of ['worker','render'])test(runtime+': atomic admission reserves two profile slots through continuation and queues a third',{skip:!sqlite},async()=>{
 const db=new sqlite.DatabaseSync(':memory:');
 db.exec("CREATE TABLE jobs(id TEXT PRIMARY KEY,profile_id TEXT,status TEXT,phase TEXT,started_at TEXT,updated_at TEXT,created_at TEXT)");
 const add=(id,profile=id)=>db.prepare("INSERT INTO jobs VALUES(?,?,'queued','waiting',NULL,'2026-09-16','2026-09-16')").run(id,profile);
 add('a');add('b');add('c');add('a-followup','a');let limit=2;
 const src=await read(runtime+'-src/db.ts'),a=src.indexOf('export async function claimJob('),b=src.indexOf('\nexport async function updateJob',a);
 const io={useSqlite:true,getState:async()=>({general:{maxConcurrentProfiles:limit}}),now:()=>new Date().toISOString(),getJob:async id=>db.prepare('SELECT * FROM jobs WHERE id=?').get(id),jobFromRow:r=>r,
 statement:(q,args=[])=>({first:async()=>db.prepare(q).get(...args)}),run:async(q,args=[])=>db.prepare(q).run(...args).changes,query:async q=>({rows:db.prepare(q).all()})};
 const {claimJob}=await compile(src.slice(a,b),['claimJob'],io);
 const first=await claimJob('a'),second=await claimJob('b');assert.ok(first);assert.ok(second);assert.equal(await claimJob('c'),null);
 db.prepare("UPDATE jobs SET status='queued',phase='ai-descriptions' WHERE id=?").run(first.id);
 if(runtime==='worker')assert.equal(await claimJob('c'),null,'a checkpoint still owns its slot');
 const continued=await claimJob(first.id);assert.equal(continued.id,first.id);assert.equal(continued.phase,'ai-descriptions');assert.equal(continued.started_at,first.started_at);
 limit=1;assert.equal(await claimJob('c'),null,'lowering capacity does not admit more running jobs');
 db.prepare("UPDATE jobs SET status='done' WHERE id IN (?,?)").run(first.id,second.id);
 assert.ok(await claimJob('c'));assert.equal(Number(db.prepare("SELECT count(*) n FROM jobs WHERE status='running'").get().n),1);
 db.close();
});
test('a displaced queue message is retained even when the priority job continues',async()=>{
 const source=await read('worker-src/main.ts');const code=(await transform(source.replace(/^import .*;\s*$/gm,''),{loader:'ts',format:'cjs'})).code;
 const sent=[],mod={exports:{}};let ack=0;
 const io={meterInvocation:()=>{},configureEnv:()=>{},ensureSchema:async()=>{},listQueuedJobs:async()=>[{id:'priority'}],processJob:async()=> 'continue',getJob:async()=>null,flushD1Usage:()=>{},isWriteQuotaError:()=>false};
 new Function('module','exports',...Object.keys(io),code)(mod,mod.exports,...Object.values(io));
 await mod.exports.default.queue({messages:[{body:{jobId:'original'},ack:()=>ack++,retry:()=>assert.fail('unexpected retry')}]},{DB:{},JOBS:{send:async msg=>sent.push(msg.jobId)}},{waitUntil:()=>{}});
 assert.deepEqual(sent,['priority','original']);assert.equal(ack,1);
});
test('job plans distinguish slot waits from continuation and show product delivery outcomes',async()=>{
 const src=await read('worker-src/dashboard.ts'),a=src.indexOf('function jobPlanHtml('),b=src.indexOf('function miniJobsHtml(',a);
 const state={settings:{general:{maxConcurrentProfiles:2}},jobs:[{id:'a',profileId:'a',status:'running'},{id:'b',profileId:'b',status:'running'}]};
 const io={state,fa:String,esc:String,$:()=>null,profileName:id=>id};const ui=await compile(src.slice(a,b),['jobPlanHtml','deliveryProductCardsHtml'],io);
 const job={id:'c',profileId:'c',kind:'scrape',target:'both',status:'queued',phase:'ai-descriptions',log:[]};
 assert.match(ui.jobPlanHtml(job),/آزادشدن ظرفیت/);assert.match(ui.jobPlanHtml({...job,startedAt:'now'}),/پیام ادامه/);assert.match(ui.jobPlanHtml(job),/aria-current="step"/);
 state.jobs=[{profileId:'p',log:[{at:'now',event:'sync-updated',item:{sourceKey:'1',title:'Shoe',target:'woo',price:120}},{at:'now',event:'failed',item:{sourceKey:'1',title:'Shoe',target:'basalam',shop:'Shop',error:'offline'}}]}];
 const html=ui.deliveryProductCardsHtml();assert.equal((html.match(/<article/g)||[]).length,1);assert.match(html,/offline/);assert.match(html,/به‌روزرسانی شد/);
});
test('Node dispatcher runs two lanes concurrently, rather than only limiting a serial loop',async()=>{
 const {createJobDispatcher}=await compile(await read('render-src/job-dispatcher.ts'),['createJobDispatcher']);
 let started=0,active=0,max=0;const release=[];
 const dispatcher=createJobDispatcher({pollMs:500,concurrency:async()=>2,onError:e=>{throw e},processOneJob:async()=>{if(started===3)return false;started++;active++;max=Math.max(max,active);await new Promise(resolve=>release.push(resolve));active--;return true}});
 dispatcher.wake();await new Promise(r=>setTimeout(r,20));assert.equal(started,2);assert.equal(active,2);
 release[0]();await new Promise(r=>setTimeout(r,20));assert.equal(started,3);assert.equal(max,2);
 dispatcher.stop();release[1]();release[2]();await new Promise(r=>setTimeout(r,20));assert.equal(dispatcher.status().running,false);
});
