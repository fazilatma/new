import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {activateSystemService,systemUnit,healthUnits,parseEnv,migrateEnvironment,runtimeEnvironment,requireFreePort,validateSource,install,TARGET} from '../scripts/install-system-service.mjs';
import {healthDecision,probe} from '../scripts/system-service-health.mjs';

test('system service starts non-root, uses boot target and applies cgroup recovery/limits',()=>{
 const unit=systemUnit('/usr/bin/node');
 for(const s of ['User=scraper4-node','Group=scraper4-node','WantedBy=multi-user.target','Restart=always','RestartSec=10','KillMode=control-group','OOMPolicy=kill','MemoryMax=50%','MemorySwapMax=0','CPUQuota=100%','TasksMax=512','StartLimitBurst=5','ProtectHome=true','EnvironmentFile=/etc/scraper4-node/runtime.env'])assert.ok(unit.includes(s),s);
 assert.ok(!unit.includes('User=root'));assert.ok(!unit.includes('npm start'));assert.ok(!unit.includes('ExecStartPre='));
 assert.throws(()=>systemUnit('/usr/bin/node\nUser=root'));
 const health=healthUnits();assert.match(health.timer,/OnBootSec=5min/);assert.match(health.service,/\/etc\/scraper4-node\/healthcheck.mjs/);
});
test('runtime has correct independent ports, loopback, fixed token and no build-on-restart',()=>{
 const env=runtimeEnvironment('/usr/bin/node','token-with-"quote');
 for(const s of ['DEPLOYER_UI_PORT="8790"','SCRAPER_PORT="3000"','DEPLOYER_UI_HOST="127.0.0.1"','LOCAL_SCRAPER_COMMAND="/usr/bin/node render-dist/server.js"','LOCAL_DEPLOYER_AUTO_UPDATE="false"','DEPLOYER_SUPERVISED="true"'])assert.ok(env.includes(s),s);
 assert.ok(!env.includes('ADMIN_TOKEN='),'do not change vault encryption credentials');assert.throws(()=>runtimeEnvironment('/usr/bin/node','bad\nTOKEN=x'));
});
test('migration preserves auth and relocates SQLite/vault paths, refuses external files',()=>{
 const a=parseEnv('ADMIN_TOKEN="keep"\nDATABASE_URL=sqlite:data/db.sqlite\n# comment\n');
 const b=parseEnv('ADMIN_TOKEN=keep-wcp\nVAULT_KEY_FILE=/old/data/vault.key\n',{literal:true});
 const result=migrateEnvironment({...a,...b},'/old');assert.equal(result.ADMIN_TOKEN,'keep-wcp');assert.equal(result.DATABASE_URL,'sqlite:'+TARGET+'/data/db.sqlite');assert.equal(result.VAULT_KEY_FILE,TARGET+'/data/vault.key');
 assert.throws(()=>migrateEnvironment({DATABASE_URL:'sqlite:/outside/db'},'/old'),/External/);
 assert.throws(()=>migrateEnvironment({VAULT_KEY_FILE:'../outside/key'},'/old'),/External/);
 assert.equal(migrateEnvironment({DATABASE_URL:'postgresql://host/db'},'/old').DATABASE_URL,'postgresql://host/db');
});
test('source must be actual installed scraper and no source file is changed by validation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'system-source-'));try{writeFileSync(join(dir,'package.json'),'{}');assert.throws(()=>validateSource(dir));mkdirSync(join(dir,'scripts'));writeFileSync(join(dir,'scripts/local-deployer-ui.mjs'),'');writeFileSync(join(dir,'package-lock.json'),'{}');writeFileSync(join(dir,'package.json'),'{"name":"scraper4-cloudflare"}');assert.equal(validateSource(dir),dir);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('occupied port is refused without stopping its owner; HTTP errors still prove responsiveness',async()=>{
 const server=createServer((req,res)=>{res.statusCode=503;res.end('alive but unavailable')});await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
 try{await assert.rejects(requireFreePort(port),/occupied/);assert.equal(await probe(port),true);assert.ok(server.listening);}finally{await new Promise(r=>server.close(r));}
 assert.equal(await probe(port),false);
});
test('HTTP monitor respects manual stop, startup grace, invocation changes and three failures',()=>{
 const info={ActiveState:'active',InvocationID:'A',ActiveEnterTimestampMonotonic:'1000000'};
 assert.equal(healthDecision(info,{},false,200e6).restart,false);
 let state={};for(let i=1;i<=3;i++){state=healthDecision(info,state,false,600e6);assert.equal(state.restart,i===3);}
 assert.equal(healthDecision(info,state,true,601e6).failures,0);
 assert.equal(healthDecision({...info,InvocationID:'B'},state,false,600e6).failures,1);
 assert.equal(healthDecision({...info,ActiveState:'inactive'},state,false,600e6).restart,false);
});
test('installer has explicit consent, never root npm, and preserves source/rollback data',async()=>{
 const code=readFileSync(new URL('../scripts/install-system-service.mjs',import.meta.url),'utf8');
 for(const s of ['--confirm-old-supervisor-stopped','requireIdleSource(src)','--no-perms','process.umask(0o077)','--no-links','--no-devices','--no-specials','--no-dereference','--no-create-home',"'-p','User='+ACCOUNT","'-p','MemoryMax='+MEMORY",'prepared:true','--resume'])assert.ok(code.includes(s),s);
 assert.ok(!code.includes("run('npm'"));assert.ok(!code.includes("'--delete'"));assert.ok(!code.includes("run('rm'"));
 await assert.rejects(install('/does-not-exist',false),/root SSH|First stop/);
});
test('systemd parser verifies generated units when available',{skip:!process.env.WCP_SYSTEMD_VERIFY},()=>{
 const dir=mkdtempSync(join(tmpdir(),'system-unit-'));try{
 // /bin/true is used only to let the sandbox verifier resolve an existing executable.
 const main=systemUnit('/bin/true');writeFileSync(join(dir,'scraper4-node.service'),main);
 const health=healthUnits('/bin/true');writeFileSync(join(dir,'scraper4-node-health.service'),health.service);writeFileSync(join(dir,'scraper4-node-health.timer'),health.timer);
 execFileSync('systemd-analyze',['verify',join(dir,'scraper4-node.service'),join(dir,'scraper4-node-health.service'),join(dir,'scraper4-node-health.timer')],{stdio:'pipe'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

 test('unresponsive HTTP listener times out instead of occupying the health check indefinitely',async()=>{
 const server=createServer(()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{assert.equal(await probe(server.address().port,50),false);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 });

test('first installation continues when reset-failed has no loaded/failed unit state',()=>{
 const calls=[],warnings=[];
 activateSystemService((cmd,args)=>{calls.push([cmd,...args]);if(args[0]==='reset-failed')throw Error('Unit not loaded');},message=>warnings.push(message));
 assert.deepEqual(calls.map(c=>c.slice(1)),[['daemon-reload'],['reset-failed','scraper4-node.service'],['enable','--now','scraper4-node.service'],['enable','--now','scraper4-node-health.timer']]);
 assert.equal(warnings.length,1);
});
test('reload and enable/start failures still stop installation; success does not warn',()=>{
 for(const step of ['daemon-reload','enable']){const calls=[];assert.throws(()=>activateSystemService((cmd,args)=>{calls.push(args);if(args[0]===step)throw Error('required step failed')},()=>{}),/required step failed/);assert.equal(calls.some(a=>a.includes('scraper4-node-health.timer')),false);}
 const warnings=[];activateSystemService(()=>{},m=>warnings.push(m));assert.equal(warnings.length,0);
 assert.throws(()=>activateSystemService((cmd,args)=>{if(args.includes('scraper4-node-health.timer'))throw Error('timer failed')},()=>{}),/timer failed/);
});
