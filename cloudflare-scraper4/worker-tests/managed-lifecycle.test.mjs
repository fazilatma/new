import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {queueLifecycle,lifecycleRequestAllowed,validateLifecycle} from '../scripts/managed-lifecycle.mjs';
import {parseControl,uninstallUnits,performAction} from '../scripts/managed-control.mjs';
import {lifecycleUnits} from '../scripts/install-system-service.mjs';
const installer=fileURLToPath(new URL('../scripts/install-system-service.mjs',import.meta.url));
const deployer=fileURLToPath(new URL('../scripts/local-deployer-ui.mjs',import.meta.url));
test('parallel profile has independent paths, ports, resource limits and public Deployer only',()=>{
 const env=execFileSync(process.execPath,[installer,'--parallel','--public-bind','--print-env'],{encoding:'utf8'});
 for(const item of ['HOME="/var/lib/scraper4-managed"','DEPLOYER_UI_HOST="0.0.0.0"','DEPLOYER_UI_PORT="8890"','SCRAPER_PORT="3100"','SCRAPER_BIND_HOST="127.0.0.1"','SCRAPER4_MANAGED_INSTANCE="scraper4-managed"'])assert.ok(env.includes(item),item);
 const unit=execFileSync(process.execPath,[installer,'--parallel','--print-unit'],{encoding:'utf8'});
 for(const item of ['User=scraper4-managed','WorkingDirectory=/opt/scraper4-managed','MemoryMax=30%','CPUQuota=50%'])assert.ok(unit.includes(item),item);
 assert.ok(!unit.includes('scraper4-node'));
 const privateEnv=execFileSync(process.execPath,[installer,'--parallel','--print-env'],{encoding:'utf8'});assert.match(privateEnv,/DEPLOYER_UI_HOST="127.0.0.1"/);
});
test('lifecycle request accepts only fixed actions and exact confirmation; never arbitrary paths',()=>{
 for(const action of ['stop','uninstall']){
  const p={action,confirmation:'scraper4-managed'};assert.equal(parseControl(JSON.stringify(p)),action);assert.deepEqual(validateLifecycle(p),p);
  let written;const result=queueLifecycle(p,(...args)=>written=args);assert.equal(result.accepted,true);assert.equal(written[0],'/var/lib/scraper4-managed/control-request.json');assert.equal(written[2].flag,'wx');assert.equal(written[2].mode,0o600);
 }
 for(const p of [null,[],{action:'shell',confirmation:'scraper4-managed'},{action:'stop',confirmation:'scraper4-node'},{action:'stop',confirmation:'scraper4-managed',path:'/opt/webconsole'}]){assert.throws(()=>validateLifecycle(p));assert.throws(()=>parseControl(JSON.stringify(p)));}
 assert.throws(()=>queueLifecycle({action:'stop',confirmation:'scraper4-managed'},()=>{throw Error('pending request')}),/pending/);
 assert.ok(uninstallUnits().every(u=>u.startsWith('scraper4-managed')));
});
test('lifecycle requires secret header and rejects cross-origin browser actions',()=>{
 const req={headers:{host:'example.test:8890',origin:'http://example.test:8890','x-local-deployer-token':'secret'}};
 assert.equal(lifecycleRequestAllowed(req,'secret'),true);
 assert.equal(lifecycleRequestAllowed({headers:{...req.headers,origin:'https://evil.test'}},'secret'),false);
 assert.equal(lifecycleRequestAllowed({headers:{...req.headers,'x-local-deployer-token':'wrong'}},'secret'),false);
 assert.equal(lifecycleRequestAllowed({headers:{host:req.headers.host,cookie:'sc4_managed_session=secret'}},'secret'),false);
});
test('root control implementation is standalone, bounded and never executes app-owned code',()=>{
 const s=readFileSync(new URL('../scripts/managed-control.mjs',import.meta.url),'utf8');
 for(const pin of ['O_NOFOLLOW','O_NONBLOCK','st.nlink!==1','Buffer.alloc(513)','rootFile(CONFIG','renameSync(dir,archive','mode:0o700','ops.ctl(\'disable\',\'--now\',NAME+\'-health.timer\''])assert.ok(s.includes(pin),pin);
 assert.ok(!s.includes('rmSync'));assert.ok(!s.includes('shell:'));assert.ok(!s.includes("from './"));
 const u=lifecycleUnits();assert.match(u.service,/ExecStart=.*\/etc\/scraper4-managed\/control.mjs/);assert.match(u.timer,/OnUnitInactiveSec=5s/);
});
test('systemd validates the narrow root control units',{skip:!process.env.WCP_SYSTEMD_VERIFY},()=>{
 const dir=mkdtempSync(join(tmpdir(),'managed-unit-'));try{const units=lifecycleUnits('/bin/true');for(const [type,text]of Object.entries(units))writeFileSync(join(dir,'scraper4-managed-control.'+type),text);execFileSync('systemd-analyze',['verify',join(dir,'scraper4-managed-control.service'),join(dir,'scraper4-managed-control.timer')],{stdio:'pipe'});}finally{rmSync(dir,{recursive:true,force:true});}
});
test('live managed Deployer gates root, proxy and APIs; login strips query and serves controls',{timeout:20000},async t=>{
 const temp=mkdtempSync(join(tmpdir(),'managed-ui-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));writeFileSync(join(temp,'package.json'),JSON.stringify({name:'scraper4-cloudflare',version:'1.0.0',scripts:{}}));
 const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const token='test-token-not-a-real-credential';
 const child=spawn(process.execPath,[deployer,'--no-browser'],{cwd:temp,env:{...process.env,DEPLOYER_UI_HOST:'127.0.0.1',DEPLOYER_UI_PORT:String(port),PORT:String(port),DEPLOYER_UI_TOKEN:token,SCRAPER4_MANAGED_INSTANCE:'scraper4-managed',LOCAL_SCRAPER_AUTOSTART:'false',LOCAL_DEPLOYER_AUTO_UPDATE:'false',LOCAL_DEPLOYER_AUTO_INSTALL_LATEST:'false'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const ended=once(child,'exit');child.kill('SIGTERM');await ended;}});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Deployer startup timeout')),10000);child.stdout.on('data',chunk=>{if(String(chunk).includes(`localhost:${port}/?token=`)){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Deployer exited before readiness'));});child.stderr.resume();});
 const base='http://127.0.0.1:'+port;
 for(const path of ['/','/scraper/','/scraper/api/status','/api/status']){const r=await fetch(base+path);assert.equal(r.status,401,path);assert.ok(!(await r.text()).includes(token));}
 const login=await fetch(base+'/?token='+token,{redirect:'manual'});assert.equal(login.status,303);assert.equal(login.headers.get('location'),'/');const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 const r=await fetch(base,{headers:{cookie:cookie.split(';')[0]}});assert.equal(r.status,200);const html=await r.text();assert.ok(html.includes('Uninstall and archive'));assert.ok(html.includes('Stop installation'));assert.ok(html.includes('authenticated scraper proxy'));new Function(html.slice(html.indexOf('<script>')+8,html.indexOf('</script>')));
 const bad=await fetch(base+'/api/installation/action',{method:'POST',headers:{cookie:cookie.split(';')[0],'x-local-deployer-token':token,origin:'http://attacker.invalid','content-type':'application/json'},body:JSON.stringify({action:'stop',confirmation:'scraper4-managed'})});assert.equal(bad.status,403);
});

test('stop is scoped; uninstall stops units before archival; stop failure never archives',()=>{
 const calls=[];
 const ops={ctl:(...a)=>{calls.push(a);return '';},archive:()=>{calls.push(['archive']);return ['fixture archive'];},remove:p=>calls.push(['remove',p]),log:()=>{}};
 performAction('stop',ops);assert.deepEqual(calls,[['stop','scraper4-managed.service']]);calls.length=0;
 performAction('uninstall',ops);
 assert.deepEqual(calls[0],['disable','--now','scraper4-managed-health.timer','scraper4-managed.service']);
 assert.equal(calls[4][0],'archive');assert.equal(calls.at(-1)[0],'daemon-reload');
 assert.deepEqual(calls.filter(c=>c[0]==='remove').map(c=>c[1]),uninstallUnits());
 let archived=false;
 assert.throws(()=>performAction('uninstall',{...ops,ctl:()=>{throw Error('stop failed')},archive:()=>{archived=true;return []}}),/stop failed/);assert.equal(archived,false);
 assert.throws(()=>performAction('uninstall',{...ops,ctl:(...a)=>{if(a[0]==='list-units')return 'scraper4-managed-build.service';if(a[0]==='stop'&&a[1]==='scraper4-managed-build.service')throw Error('build stop failed');return '';},archive:()=>{archived=true;return []}}),/build stop failed/);assert.equal(archived,false);
});
