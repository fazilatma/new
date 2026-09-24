import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
test('dashboard button submits consent, polls results and displays logs as text',async()=>{
 const s=readFileSync(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
 const code=s.slice(s.indexOf('let browserRepairTimer=null;'),s.indexOf('async function menuAction('));
 const {document}=parseHTML('<input type="checkbox" id="browserRepairMirror"><input type="checkbox" id="browserRepairRoot"><pre id="browserRepairLog"></pre>');
 document.getElementById('browserRepairMirror').checked=true;document.getElementById('browserRepairRoot').checked=true;
 const calls=[];let poll;
 const action=new Function('$','api','setTimeout','clearTimeout',code+';return browserRepairAction;')(id=>document.getElementById(id),async(path,options)=>{calls.push({path,options});return {phase:calls.length===1?'libraries':'ready',running:calls.length===1,success:calls.length===1?null:true,results:{puppeteer:{success:true}},log:'<img src=x onerror=alert(1)>'};},fn=>{poll=fn;return 1;},()=>{});
 await action(true);assert.equal(calls[0].path,'/api/runtime/browser-repair');assert.equal(calls[0].options.headers['x-browser-repair'],'1');assert.deepEqual(JSON.parse(calls[0].options.body),{allowMirror:true,allowRoot:true});assert.equal(typeof poll,'function');
 await poll();assert.deepEqual(calls[1].options,{});assert.match(document.getElementById('browserRepairLog').textContent,/puppeteer/);assert.match(document.getElementById('browserRepairLog').textContent,/Browser launch verified/);assert.equal(document.querySelector('img'),null);
});
test('dashboard reports authentication/network failure without false success',async()=>{
 const s=readFileSync(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8'),code=s.slice(s.indexOf('let browserRepairTimer=null;'),s.indexOf('async function menuAction('));
 const el={textContent:''};let polls=0;
 const action=new Function('$','api','setTimeout','clearTimeout',code+';return browserRepairAction;')(()=>el,async()=>{throw Error('Unauthorized')},()=>{polls++},()=>{});
 await action(false);assert.match(el.textContent,/Unauthorized/);assert.equal(polls,0);
});
const sqlite=await import('node:sqlite').then(()=>true,()=>false);
test('real Node HTTP repair route rejects unauthenticated installation and arbitrary commands',{skip:!sqlite,timeout:60000},async()=>{
 for(const token of ['browser-repair-fixture-secret','']){
  const dir=mkdtempSync(join(tmpdir(),'browser-repair-http-'));
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const child=spawn(process.execPath,[fileURLToPath(new URL('../render-dist/server.js',import.meta.url))],{cwd:dir,env:{...process.env,ADMIN_TOKEN:token,PORT:String(port),SCRAPER_BIND_HOST:'127.0.0.1',DATABASE_URL:'sqlite:'+join(dir,'test.sqlite'),SCRAPER4_SQLITE_PATH:join(dir,'test.sqlite'),RUN_WORKER_IN_WEB:'false',LOCAL_SCRAPER_AUTO_UPDATE:'false'},stdio:['ignore','pipe','pipe']});
  let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',d=>logs=(logs+String(d)).slice(-4000));const ended=once(child,'exit');
  const base='http://127.0.0.1:'+port;
  try{
   let ready=false;for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error(logs);try{const h=await fetch(base+'/health',{signal:AbortSignal.timeout(1000)});if((await h.json()).databaseReady){ready=true;break;}}catch{}await delay(100);}assert.equal(ready,true,logs);
   const path=base+'/api/runtime/browser-repair';
   assert.equal((await fetch(path)).status,token?401:403);
   const headers={authorization:'Bearer '+token,'content-type':'application/json'};
   const status=await fetch(path,{headers});assert.equal(status.status,token?200:403);
   if(token){assert.equal((await status.json()).running,false);assert.equal((await fetch(path,{method:'POST',headers,body:'{}'})).status,403);assert.equal((await fetch(path,{method:'POST',headers:{...headers,'x-browser-repair':'1'},body:JSON.stringify({command:'touch /tmp/never-execute'})})).status,400);assert.equal((await (await fetch(path,{headers})).json()).running,false);}
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');const kill=setTimeout(()=>child.kill('SIGKILL'),3000);await ended;clearTimeout(kill);}rmSync(dir,{recursive:true,force:true});}
 }
});
