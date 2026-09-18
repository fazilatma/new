import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Script} from 'node:vm';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const source=await readFile(new URL('./webconsole.php',import.meta.url),'utf8');

test('deliverable is a complete PHP console, not a patcher or loader',()=>{
 assert.ok(source.startsWith('<?php'));
 assert.ok(source.includes("define('WCP_VERSION', '1.1.2');"));
 for(const name of ['wcp_php_cli','job_start','wcp_cli','handle_api','render_body','render_login','render_css','page_head','term_create','fs_scan_dir','cli_backup','cli_restore','cli_deploy','cli_service'])assert.match(source,new RegExp('function '+name+'\\('));
 assert.ok(source.endsWith('echo render_body();\n'));
 assert.ok(!source.includes('repair.mjs'));
 assert.ok(!/\b(?:require|include)(?:_once)?\s*\(/.test(source));
});
test('all supplied API areas and UI views are present',()=>{
 for(const action of ['auth.setup','auth.login','auth.change','auth.logout','sysinfo','proc.list','proc.info','proc.kill','fs.list','fs.read','fs.save','fs.create','fs.delete','fs.rename','fs.transfer','fs.chmod','fs.chown','fs.zip','fs.unzip','fs.search','fs.du','fs.info','fs.download','fs.upload','fs.upload_chunk','term.list','term.create','term.read','term.write','term.resize','term.kill','gh.save','gh.get','gh.test','gh.profiles','gh.backup','gh.snapshots','gh.manifest','gh.restore','gh.user_repos','gh.repo_branches','gh.inspect_branch','proj.list','proj.save','proj.quick_deploy','proj.delete','proj.deploy','proj.service','jobs.status','jobs.log','jobs.stop','jobs.list','settings.get','settings.save','activity'])assert.ok(source.includes("case '"+action+"':"),action);
 for(const view of ['dash','term','files','proc','backup','proj','jobs','set'])assert.ok(source.includes('id="v-'+view+'"'));
});
test('inline login and console JavaScript compile',()=>{
 let count=0;for(const m of source.matchAll(/<script>([\s\S]*?)<\/script>/g)){if(m[1].includes('json_encode'))continue;new Script(m[1]);count++;}assert.equal(count,2);
});
test('launcher fix and failure reporting are integrated',()=>{
 for(const text of ['--wcp-data-dir=','hash_equals($job[\'launch_token\']','getmypid()','PHP_SAPI === "cli"','register_argc_argv=1',"file_put_contents($exitFile, \"127\\n\"",'function wcp_job_alive','term_kill($id);'])assert.ok(source.includes(text),text);
 assert.ok(!source.includes('esc(PHP_BINARY)'));
 assert.ok(!source.includes('term_close('));
 assert.ok(source.includes("'offset' => $off + strlen($data)"));
 assert.ok(source.includes('catch (Throwable $e) { jout(false'));
});
test('new private data is not world-writable and GitHub TLS checks are enabled',()=>{
 assert.ok(source.includes('umask(0077)'));assert.ok(!source.includes('0777'));assert.ok(!source.includes('0666'));
 assert.ok(source.includes('CURLOPT_SSL_VERIFYPEER=>true'));
 assert.ok(source.includes('CURLOPT_SSL_VERIFYHOST=>2'));
 assert.ok(source.includes('JSON_HEX_TAG|JSON_HEX_AMP|JSON_HEX_APOS|JSON_HEX_QUOT'));
});
test('PHP 7.4 syntax parse', {skip:!process.env.PHP_PARSER_PATH},()=>{
 const require=createRequire(import.meta.url),Engine=require(process.env.PHP_PARSER_PATH);
 const parser=new Engine({parser:{version:'7.4',suppressErrors:false}});
 assert.equal(parser.parseCode(source).kind,'program');
});
test('PHP engine lint and isolated persistence / launcher-preflight failure', {skip:!process.env.PHP_BIN,timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'webconsole-test-'));
 try{
  const file=join(dir,'webconsole.php');await writeFile(file,source);
  const lint=execFileSync(process.env.PHP_BIN,['-l',file],{encoding:'utf8',timeout:20000});assert.match(lint,/No syntax errors/);
  const harness=String.raw`<?php
  define('WCP_LIBRARY_ONLY',true);
  require __DIR__.'/webconsole.php';
  ini_set('display_errors','1');error_reporting(E_ALL);
  function check($condition,$label){if(!$condition)throw new RuntimeException($label);}
  check(cfg()['pass_hash']==='', 'fresh defaults');
  cfg_save(['theme'=>'light']);check(cfg()['theme']==='light','config save');
  check(norm_path('/a/../b//c')==='/b/c','path normalization');
  $new=DATA_DIR.'/child-data';mkdir($new,0700);
  $_SERVER['argv']=['test','--wcp-data-dir='.base64_encode($new)];
  check(wcp_init_data_dir()===$new,'inherited data path');
  $_SERVER['argv']=['test'];
  $p=['id'=>'fixture','name'=>'Fixture','repo_url'=>'/local-fixture'];
  proj_save_all([$p]);check(proj_find(proj_all(),'fixture')['name']==='Fixture','project persistence');
  check(!isset(public_project(['id'=>'fixture','auth_token'=>'secret'])['auth_token']),'token redaction');
  putenv('WCP_PHP_CLI=/definitely-missing-php-binary');
  $job=job_create('service','Failure fixture',['project_id'=>'fixture']);
  $failed=false;try{job_start($job);}catch(RuntimeException $e){$failed=strpos($e->getMessage(),'No usable PHP CLI')!==false;}
  check($failed,'invalid CLI fails explicitly');
  $status=job_status(job_get($job['id']));
  check($status['status']==='failed' && $status['exit']===127,'persisted failure state');
  check(strpos(file_get_contents($job['log']),'launcher ERROR')!==false,'diagnostic log');
  check(job_pid_alive(1)===false,'protected PID');
  file_put_contents(DATA_DIR.'/fixture.txt','abc');
  check(count(fs_search(DATA_DIR,'fixture.txt'))===1,'file search');
  $html=render_body();check(strpos($html,'id="v-proj"')!==false,'complete UI render');
  echo "WCP_HELPERS_OK\n";
  `;
  const path=join(dir,'test.php');await writeFile(path,harness);
  const output=execFileSync(process.env.PHP_BIN,[path],{encoding:'utf8',timeout:30000});
  assert.match(output,/WCP_HELPERS_OK/);assert.ok(!/Fatal error|Warning:/.test(output),output);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('rendered console initializes and opens project / file / job views',async()=>{
 const require=createRequire(import.meta.url);
 const {parseHTML}=require('../../cloudflare-scraper4/node_modules/linkedom');
 const {window,document}=parseHTML(source.slice(source.indexOf('<div id="app">'),source.indexOf("<?php return ob_get_clean();}",source.indexOf('<div id="app">'))));
 const scripts=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)],code=scripts[scripts.length-1][1];
 const calls=[];
 const data={sysinfo:{host:'test',kernel:'Linux',php:'8.2',user:'fixture',ip:'127.0.0.1',mem:{total:1024,used:512},disk:{total:4096,free:2048},cores:2,load:[0,0,0],uptime:60,cpu_pct:0,tools:{git:true,node:true}},'proj.list':{projects:[{id:'abc',name:'Fixture',repo_url:'https://github.com/example/app',branch:'main',deploy_path:'/opt/fixture',port:'3000',env:{},start_cmd:'node app.js'}]},'fs.list':{path:'/opt',items:[{name:'fixture.txt',dir:false,perms:'0600',owner:'test',group:'test',size:3,mtime:1}]},'jobs.list':{jobs:[{id:'abc',name:'Launch failure',type:'deploy',created:'2026-09-18',status:{status:'failed',exit:127}}]}};
 const context={window,document,__BOOT:{csrf:'fixture',v:'1.1.2',theme:'dark',host:'test',fs_start:'/opt'},location:{pathname:'/webconsole.php'},navigator:{},TextDecoder,Uint8Array,setTimeout(){},setInterval(){return 1},clearTimeout(){},clearInterval(){},console,fetch:async(url,options)=>{const q=JSON.parse(options.body);calls.push(q.api);return {status:200,json:async()=>({ok:true,data:data[q.api]??{}})}}};
 new Script(code+'\nglobalThis.TEST={switchTab,renderProj,renderFm,renderJobs,projectDlg};').runInNewContext(context);
 await new Promise(r=>setImmediate(r));
 assert.match(document.querySelector('#v-dash').textContent,/test/);
 context.TEST.switchTab('proj');await context.TEST.renderProj();assert.match(document.querySelector('#v-proj').textContent,/Fixture/);
 context.TEST.projectDlg({id:'abc',name:'Fixture',type:'node',env:{PORT:'3000'}});assert.equal(document.querySelector('#jq-name').value,'Fixture');
 context.TEST.switchTab('files');await context.TEST.renderFm();assert.match(document.querySelector('#fmlist').textContent,/fixture.txt/);
 context.TEST.switchTab('jobs');await context.TEST.renderJobs();assert.match(document.querySelector('#v-jobs').textContent,/127/);
 for(const action of ['sysinfo','proj.list','fs.list','jobs.list'])assert.ok(calls.includes(action));
});

function importHarness(){
 const require=createRequire(import.meta.url),{parseHTML}=require('../../cloudflare-scraper4/node_modules/linkedom');
 const {window,document}=parseHTML(source.slice(source.indexOf('<div id="app">'),source.indexOf("<?php return ob_get_clean();}",source.indexOf('<div id="app">'))));
 // Linkedom exposes a read-only select value; browsers also have its setter.
 const proto=window.HTMLSelectElement.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'value');
 if(!descriptor.set)Object.defineProperty(proto,'value',{...descriptor,set(v){for(const o of this.options)o.selected=o.value===v;}});
 const code=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
 const calls=[];
 const context={window,document,__BOOT:{csrf:'test',v:'1.1.2',theme:'dark',host:'test',fs_start:'/var/www'},location:{pathname:'/webconsole.php'},navigator:{},TextEncoder,TextDecoder,Uint8Array,setTimeout(){},setInterval(){return 1},clearTimeout(){},clearInterval(){},console,fetch:async(url,options)=>{const q=JSON.parse(options.body);calls.push(q);const data=q.api==='proj.list'?{projects:[]}:q.api==='gh.user_repos'?{repos:[]}:{};return {status:200,json:async()=>({ok:true,data})}}};
 new Script(code+'\nglobalThis.TEST={parseProjectJson,projectDlg};').runInNewContext(context);
 return {...context,calls,$:id=>document.querySelector('#'+id)};
}

test('pasted sample JSON fills editable form, merges env and saves only on explicit Save',async()=>{
 const h=importHarness(),sample=await readFile(new URL('./examples/scraper4-project.json',import.meta.url),'utf8');
 h.TEST.projectDlg({id:'existing',name:'Old',type:'node',repo_url:'https://example.com/old',env:{ADMIN_TOKEN:'keep-me',DATABASE_URL:'keep-db',SCRAPER_PORT:'9999'},auto_start:true});
 h.$('jq-token').value='pending-token';h.$('tab-json').onclick();
 assert.equal(h.$('json-exp').classList.contains('hide'),false);
 h.$('jq-json-text').value=sample;h.$('jq-json-apply').onclick();
 assert.equal(h.$('jq-name').value,'Scraper4 + Deployer');assert.equal(h.$('jq-port').value,'8790');
 assert.equal(h.$('jq-auto').checked,false);assert.equal(h.$('jq-daemon').checked,true);
 assert.match(h.$('jq-env').value,/ADMIN_TOKEN=keep-me/);assert.match(h.$('jq-env').value,/DATABASE_URL=keep-db/);
 assert.match(h.$('jq-env').value,/SCRAPER_PORT=3000/);assert.ok(!h.$('jq-env').value.includes('9999'));
 assert.equal(h.$('jq-token').value,'pending-token');assert.equal(h.$('man-exp').classList.contains('hide'),false);
 assert.ok(!h.calls.some(q=>q.api.startsWith('proj.')));
 await h.$('jq-save').onclick();const saved=h.calls.find(q=>q.api==='proj.save');
 assert.equal(saved.project.id,'existing');assert.equal(saved.project.auto_start,false);
 assert.equal(saved.project.start_cmd,'node scripts/local-deployer-ui.mjs');
 assert.ok(!h.calls.some(q=>['proj.deploy','proj.quick_deploy','proj.service'].includes(q.api)));
});

test('file chooser stages content without auto-applying; BOM, wrapper, numeric port supported',async()=>{
 const h=importHarness();h.TEST.projectDlg({id:'target',name:'Before',type:'node',env:{}});
 const json='\uFEFF'+JSON.stringify({project:{id:'foreign-id',name:'Imported',repo_url:'https://example.com/repo',port:8790,env:{FLAG:false,COUNT:2}}});
 await h.$('jq-json-file').onchange({target:{files:[{size:json.length,text:async()=>json}]}});
 assert.equal(h.$('jq-name').value,'Before');assert.equal(h.$('jq-json-text').value,json);
 h.$('jq-json-apply').onclick();assert.equal(h.$('jq-name').value,'Imported');assert.equal(h.$('jq-port').value,'8790');
 assert.match(h.$('jq-env').value,/FLAG=false/);assert.match(h.$('jq-env').value,/COUNT=2/);
 await h.$('jq-save').onclick();assert.equal(h.calls.find(q=>q.api==='proj.save').project.id,'target');
});

test('invalid imports fail before any form mutation; rejects dangerous keys and wrong types',()=>{
 const h=importHarness();h.TEST.projectDlg({id:'target',name:'Unchanged',type:'node',env:{SECRET:'retained'}});
 const base={name:'Changed',repo_url:'https://example.com/repo'};
 const bad=['{','[]','null','{}',JSON.stringify({...base,auto_start:'false'}),JSON.stringify({...base,env:{BAD:'x\nINJECTED=y'}}),JSON.stringify({...base,env:{FLAG:null}}),JSON.stringify({...base,env:[]}),JSON.stringify({...base,port:65536}),JSON.stringify({...base,type:'invalid'}),JSON.stringify({...base,deploy_path:'/'}),JSON.stringify({...base,install_cmd:{}}),JSON.stringify({...base,unknown:true}),'\u007b"name":"x","repo_url":"https://example.com","__proto__":{"polluted":true}}'];
 for(const text of bad){h.$('jq-json-text').value=text;h.$('jq-json-apply').onclick();assert.ok(h.$('jq-json-status').textContent,text);assert.equal(h.$('jq-name').value,'Unchanged');assert.equal(h.$('jq-env').value,'SECRET=retained');}
 assert.equal({}.polluted,undefined);
 assert.throws(()=>h.TEST.parseProjectJson(' '.repeat(262145)),/۲۵۶/);
 assert.throws(()=>h.TEST.parseProjectJson('ش'.repeat(140000)),/۲۵۶/);
 assert.ok(!h.calls.some(q=>q.api.startsWith('proj.')));
});

test('oversized files are not read, and a late file read cannot replace newly pasted content',async()=>{
 const h=importHarness();h.TEST.projectDlg({id:'target',name:'Before',type:'node',env:{}});
 let read=false;await h.$('jq-json-file').onchange({target:{files:[{size:262145,text:async()=>{read=true;return '{}'}}]}});
 assert.equal(read,false);assert.match(h.$('jq-json-status').textContent,/۲۵۶/);
 let resolve;const pending=h.$('jq-json-file').onchange({target:{files:[{size:2,text:()=>new Promise(r=>resolve=r)}]}});
 h.$('jq-json-text').value='newly pasted';h.$('jq-json-text').oninput();resolve('{}');await pending;
 assert.equal(h.$('jq-json-text').value,'newly pasted');
});
