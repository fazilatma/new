import test from 'node:test';
import assert from 'node:assert/strict';
import {createScraperKeepalive} from '../scripts/scraper-keepalive.mjs';
import {serviceConfig} from '../scripts/keepalive-service.mjs';
function harness(options={}){
 let now=0,restarts=0,alive=false;const timers=new Map();let id=0;
 const policy=createScraperKeepalive({now:()=>now,setTimer:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimer:id=>timers.delete(id),probe:async()=>alive,restart:async()=>{restarts++;policy.started()}},options);
 return {policy,timers,setTime:n=>{now=n},setAlive:n=>{alive=n},get restarts(){return restarts},fire:async()=>{const [id,t]=[...timers][0];timers.delete(id);now+=t.ms;await t.fn()}};
}
test('unexpected clean/crash/signal exits recover with capped backoff and preserve stop',async()=>{
 const h=harness();h.policy.enable();h.policy.started();
 for(const reason of ['code 0','code 1','SIGKILL','code 75']){h.policy.exited(reason);h.policy.exited(reason);assert.equal(h.timers.size,1);await h.fire()}
 assert.equal(h.restarts,4);assert.equal(h.policy.status().failures,4);
 h.policy.exited('crash');h.policy.stop();assert.equal(h.timers.size,0);h.policy.exited('late event');assert.equal(h.timers.size,0);
});
test('watchdog allows slow builds, waits repeated misses, and leaves responding ports alone',async()=>{
 const h=harness();h.policy.enable();h.policy.started();await h.policy.check();assert.equal(h.policy.status().misses,0);
 h.setTime(300001);for(let i=0;i<5;i++)await h.policy.check();assert.equal(h.timers.size,0);await h.policy.check();assert.equal(h.timers.size,1);await h.fire();
 h.setTime(700000);h.setAlive(true);for(let i=0;i<10;i++)await h.policy.check();assert.equal(h.timers.size,0);
});
test('manual stop during a pending health probe cannot resurrect the scraper',async()=>{
 let release;const timers=[];const p=createScraperKeepalive({now:()=>1000,probe:()=>new Promise(r=>release=r),restart:()=>assert.fail(),setTimer:fn=>timers.push(fn),clearTimer:()=>{}},{graceMs:0,missLimit:1});
 p.enable();p.started();const pending=p.check();p.stop();release(false);await pending;assert.equal(timers.length,0);
});
test('keepalive opt-out and shutdown prevent timers',()=>{
 const h=harness({enabled:false});h.policy.enable();h.policy.exited('crash');assert.equal(h.timers.size,0);
 const a=harness();a.policy.enable();a.policy.exited('crash');a.policy.close();a.policy.enable();a.policy.exited('late');assert.equal(a.timers.size,0);
});
test('stable running resets crash backoff; prolonged failures remain capped',async()=>{
 const h=harness();h.policy.enable();h.policy.started();for(let i=0;i<12;i++){h.policy.exited('crash');assert.ok([...h.timers.values()][0].ms<=60000);await h.fire()}
 h.setTime(1000000);h.policy.exited('later crash');assert.equal([...h.timers.values()][0].ms,5000);
});
test('generated persistent services supervise the deployer without shelling out or embedding secrets',()=>{
 const config={cwd:'/home/user/scraper space',node:'/opt/node',path:'/opt/bin',home:'/home/user'};
 assert.match(serviceConfig('systemd',config),/Restart=always/);assert.match(serviceConfig('systemd',config),/DEPLOYER_SUPERVISED=true/);
 assert.match(serviceConfig('termux',config),/termux-wake-lock/);assert.match(serviceConfig('termux',config),/exec '\/opt\/node'/);
 assert.match(serviceConfig('systemd',config),/KillMode=control-group/);
});

test('real deployer restarts a crashed scraper and manual Stop cancels recovery', {timeout:30000},async()=>{
 const {spawn}=await import('node:child_process'),{mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os'),{createServer}=await import('node:net'),{once}=await import('node:events');
 async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port}
 const port=await freePort(),scraperPort=await freePort(),dir=await mkdtemp(join(tmpdir(),'keepalive-live-'));
 await writeFile(join(dir,'package.json'),JSON.stringify({name:'scraper4-test',version:'0.0.0',scripts:{}}));
 await writeFile(join(dir,'fixture.cjs'),`const fs=require('fs'),http=require('http');let n=0;try{n=+fs.readFileSync('attempts','utf8')}catch{}fs.writeFileSync('attempts',String(++n));if(n===1)process.exit(1);http.createServer((q,s)=>s.end('ok')).listen(+process.env.PORT,'127.0.0.1',()=>fs.writeFileSync('ready','yes'));`);
 const child=spawn(process.execPath,[new URL('../scripts/local-deployer-ui.mjs',import.meta.url).pathname],{cwd:dir,env:{...process.env,DEPLOYER_UI_HOST:'127.0.0.1',DEPLOYER_UI_PORT:String(port),SCRAPER_PORT:String(scraperPort),DEPLOYER_UI_TOKEN:'keepalive-test',DEPLOYER_HANDSHAKE_FILE:join(dir,'handshake'),LOCAL_SCRAPER_COMMAND:process.execPath+' fixture.cjs',LOCAL_SCRAPER_AUTOSTART:'true',LOCAL_SCRAPER_STOP_WITH_UI:'true',LOCAL_SCRAPER_KEEPALIVE:'true',LOCAL_DEPLOYER_AUTO_UPDATE:'false',LOCAL_DEPLOYER_AUTO_INSTALL_LATEST:'false'},stdio:'ignore'});
 try{
  const deadline=Date.now()+16000;let ready=false;while(Date.now()<deadline){try{ready=(await readFile(join(dir,'ready'),'utf8'))==='yes'}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100))}
  assert.equal(ready,true);assert.equal(await readFile(join(dir,'attempts'),'utf8'),'2');
  const response=await fetch('http://127.0.0.1:'+port+'/api/scraper/stop',{method:'POST',headers:{'x-local-deployer-token':'keepalive-test'}});assert.equal(response.status,200);assert.equal((await response.json()).keepalive.desired,false);
  await new Promise(r=>setTimeout(r,6000));assert.equal(await readFile(join(dir,'attempts'),'utf8'),'2');
 }finally{if(child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}await rm(dir,{recursive:true,force:true});}
});
