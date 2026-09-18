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
 assert.ok(source.includes("define('WCP_VERSION', '1.2.1');"));
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
  $pages=[];$branches=gh_repo_branches('owner','repo','',function($url,$token)use(&$pages){$pages[]=$url;if(strpos($url,'/branches?')===false)return ['default_branch'=>'release'];if(preg_match('/&page=1$/',$url))return array_map(fn($i)=>['name'=>'branch-'.$i],range(1,100));return [['name'=>'release']];});
  check(count($branches)===101 && $branches[100]['default'],'all branch pages and real default');
  $failedPage=false;try{gh_repo_branches('owner','repo','',fn($u,$t)=>null);}catch(RuntimeException $e){$failedPage=true;}check($failedPage,'listing failures not silently empty');
  $was=$GLOBALS['__NOEXEC'];$GLOBALS['__NOEXEC']=true;
  $target=DATA_DIR.'/not-created-by-preflight';
  $pre=proj_preflight(['deploy_path'=>$target,'type'=>'node','install_cmd'=>'npm ci']);
  check($pre['ok']===false && !file_exists($target),'preflight is read-only and reports missing tools');
  file_put_contents(DATA_DIR.'/not-a-directory','file');
  $pre=proj_preflight(['deploy_path'=>DATA_DIR.'/not-a-directory']);
  check($pre['checks'][0]['ok']===false,'file cannot be deployment directory');
  $pre=proj_preflight(['deploy_path'=>'/']);check($pre['checks'][0]['ok']===false,'root target blocked');
  $GLOBALS['__NOEXEC']=$was;
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
 const context={window,document,__BOOT:{csrf:'fixture',v:'1.2.1',theme:'dark',host:'test',fs_start:'/opt'},location:{pathname:'/webconsole.php'},navigator:{},TextDecoder,Uint8Array,setTimeout(){},setInterval(){return 1},clearTimeout(){},clearInterval(){},console,fetch:async(url,options)=>{const q=JSON.parse(options.body);calls.push(q.api);return {status:200,json:async()=>({ok:true,data:data[q.api]??{}})}}};
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
 if(!descriptor.set)Object.defineProperty(proto,'value',{...descriptor,set(v){for(const o of this.options)o.removeAttribute('selected');const chosen=[...this.options].find(o=>o.value===v);if(chosen)chosen.setAttribute('selected','');}});
 const code=[...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
 const calls=[];
 const context={window,document,__BOOT:{csrf:'test',v:'1.2.1',theme:'dark',host:'test',fs_start:'/var/www'},location:{pathname:'/webconsole.php'},navigator:{},URL,Blob,atob,TextEncoder,TextDecoder,Uint8Array,setTimeout(){},setInterval(){return 1},clearTimeout(){},clearInterval(){},console,fetch:async(url,options)=>{const q=JSON.parse(options.body);calls.push(q);const data=q.api==='proj.list'?{projects:[]}:q.api==='gh.user_repos'?{repos:[]}:{};return {status:200,json:async()=>({ok:true,data})}}};
 new Script(code+'\nglobalThis.TEST={parsedProjectVersion,compareProjectVersions,branchVersion,sortedBranchRows,parseProjectJson,projectDlg,applyAppearance,readAppearance,appearanceDlg,commandPalette,projectExport,presetProject,projectPreflight,openJob,__closeSheet};').runInNewContext(context);
 return {...context,vm:context,calls,$:id=>document.querySelector('#'+id)};
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

test('appearance previews all palettes/layouts, cancels cleanly, and explicitly persists',async()=>{
 const h=importHarness();
 for(const theme of ['dark','light','ocean','forest','amber'])for(const layout of ['classic','studio','focus']){
  h.TEST.applyAppearance({theme,layout,density:'compact'});
  assert.equal(h.document.documentElement.getAttribute('data-theme'),theme);
  assert.equal(h.document.documentElement.getAttribute('data-layout'),layout);
 }
 h.TEST.applyAppearance({theme:'bad',layout:'bad',density:'bad'});
 assert.equal(h.TEST.readAppearance().theme,'dark');assert.equal(h.TEST.readAppearance().layout,'classic');
 h.TEST.appearanceDlg();h.document.querySelector('[data-skin="forest"]').onclick();await Promise.resolve();
 assert.equal(h.TEST.readAppearance().theme,'forest');assert.ok(!h.calls.some(x=>x.api==='settings.save'));
 h.TEST.__closeSheet();assert.equal(h.TEST.readAppearance().theme,'dark');
 h.TEST.appearanceDlg();h.document.querySelector('[data-skin="ocean"]').onclick();h.document.querySelector('[data-layout-choice="studio"]').onclick();
 await h.$('appearance-save').onclick();const saved=h.calls.find(x=>x.api==='settings.save');
 assert.equal(saved.theme,'ocean');assert.equal(saved.layout,'studio');assert.equal(h.TEST.readAppearance().theme,'ocean');
 assert.equal(h.document.querySelector('.msheet').getAttribute('role'),'dialog');
});

test('navigation palette filters sections without executing server commands',()=>{
 const h=importHarness();h.TEST.commandPalette();h.$('command-query').value='files';h.$('command-query').oninput();
 assert.equal(h.$('command-results').querySelectorAll('button').length,1);
 assert.match(h.$('command-results').textContent,/فایل/);
 h.$('command-query').value='no-such-section';h.$('command-query').oninput();assert.equal(h.$('command-results').querySelectorAll('button').length,0);
 assert.ok(!h.calls.some(x=>['term.write','proj.deploy','proj.service'].includes(x.api)));
});

test('portable project export strips identity, token, env and URL credentials; requires review',()=>{
 const h=importHarness();const q=h.TEST.projectExport({id:'secret-id',name:'Export',repo_url:'https://user:password@example.com/repo?token=secret#private',auth_token:'private-pat',env:{API_KEY:'secret'},install_cmd:'npm ci',auto_start:true,is_daemon:true});
 assert.equal(q.repo_url,'https://example.com/repo');assert.equal(q.auto_start,false);
 for(const field of ['id','auth_token','env'])assert.equal(q[field],undefined);
 assert.ok(!h.$('project-export').value.includes('private-pat'));
 const downloads=[];h.vm.downloadText=(...args)=>downloads.push(args);
 assert.equal(downloads.length,0);h.$('project-export-save').onclick();assert.equal(downloads.length,1);
 assert.ok(!h.calls.some(x=>x.api==='proj.save'));
});

test('project presets match committed sample and never auto-start',async()=>{
 const h=importHarness(),sample=JSON.parse(await readFile(new URL('./examples/scraper4-project.json',import.meta.url),'utf8'));
 assert.deepEqual(JSON.parse(JSON.stringify(h.TEST.presetProject('scraper4'))),sample);
 for(const kind of ['node','static','scraper4'])assert.equal(h.TEST.presetProject(kind).auto_start,false);
 assert.equal(h.TEST.presetProject('static').start_cmd,'');
});

test('preflight UI displays escaped diagnostics and does not deploy',async()=>{
 const h=importHarness();h.vm.fetch=async(url,opts)=>{const q=JSON.parse(opts.body);h.calls.push(q);return {status:200,json:async()=>({ok:true,data:{ok:false,user:'www-data',target:'/var/www/example',checks:[{name:'Directory',ok:false,detail:'Permission denied <script>bad</script>'}],notes:['Read-only check']}})}};
 await h.TEST.projectPreflight('fixture');assert.match(h.document.querySelector('.msheet').textContent,/Permission denied/);
 assert.equal(h.document.querySelector('.msheet script'),null);assert.ok(h.calls.some(x=>x.api==='proj.preflight'));
 assert.ok(!h.calls.some(x=>x.api==='proj.deploy'));
 assert.ok(source.indexOf('$preflight=proj_preflight($p)')<source.indexOf("cli_checked('git clone --depth 1 --branch",source.indexOf("function cli_deploy(")));
});

test('job log filtering, pause, follow, download and clear operate on loaded buffer',async()=>{
 const h=importHarness(),downloads=[];h.vm.downloadText=(...args)=>downloads.push(args);
 let requests=0,poll;h.vm.setInterval=fn=>{poll=fn;return 1};
 h.vm.fetch=async()=>{requests++;return {status:200,json:async()=>({ok:true,data:{offset:12,b64:Buffer.from('OK ready\nERROR permission\n').toString('base64'),status:{status:'running'}}})}};
 await h.TEST.openJob('fixture','Fixture log');assert.match(h.$('jlog').textContent,/OK ready/);
 h.$('jfilter').value='error';h.$('jfilter').oninput();assert.equal(h.$('jlog').textContent,'ERROR permission');
 h.$('jdownload').onclick();assert.match(downloads[0][1],/OK ready/);
 h.$('jpause').onclick({target:h.$('jpause')});const before=requests;await poll();assert.equal(requests,before);
 h.$('jclr').onclick();assert.equal(h.$('jlog').textContent,'');h.TEST.__closeSheet();await poll();assert.equal(requests,before);
});

test('branch versions sort numerically, newest first, with prereleases and unknown last',()=>{
 const h=importHarness(),sort=h.TEST.compareProjectVersions;
 assert.deepEqual(['1.9.0','1.210.0+','unknown','1.210.0-rc.10','1.210.0-rc.2','1.100.0'].sort(sort),['1.210.0+','1.210.0-rc.10','1.210.0-rc.2','1.100.0','1.9.0','unknown']);
 assert.equal(sort('v2.0.0+build.2','2.0.0+build.1'),0);
 const rows=[{name:'v999',apps:[{subfolder:'',version:'9.0.0'},{subfolder:'cloudflare-scraper4',version:'1.9.0'}]},{name:'older-name',apps:[{subfolder:'',version:'1.0.0'},{subfolder:'cloudflare-scraper4',version:'1.210.0+'}]}];
 assert.equal(h.TEST.sortedBranchRows(rows,'cloudflare-scraper4')[0].name,'older-name');
 assert.equal(h.TEST.sortedBranchRows(rows,'')[0].name,'v999');
});

test('repository selection opens all branch rows and sorts by scanned project version',async()=>{
 const h=importHarness();h.TEST.projectDlg({id:'fixture',name:'Fixture',type:'node',env:{}});
 const calls=[];h.vm.fetch=async(url,options)=>{const q=JSON.parse(options.body);calls.push(q);let data={};
 if(q.api==='gh.user_repos')data={repos:[{name:'repo',language:'JS'}]};
 if(q.api==='gh.repo_branches')data={branches:[{name:'old',default:true},{name:'new'},{name:'unknown'}]};
 if(q.api==='gh.inspect_branch')data={apps:[{name:'App',subfolder:'cloudflare-scraper4',version:q.branch==='new'?'1.210.0+':q.branch==='old'?'1.9.0':'',type:'node'}]};
 return {status:200,json:async()=>({ok:true,data})};};
 await h.$('gh-load').onclick();
 const rows=[...h.$('gh-branch-table').querySelectorAll('tbody tr')];assert.equal(rows.length,3);assert.match(rows[0].textContent,/new/);assert.match(rows[1].textContent,/old/);assert.match(rows[2].textContent,/unknown/);
 await rows[0].querySelector('button').onclick();await new Promise(r=>setImmediate(r));
 h.$('gh-apps-list').querySelector('[data-custom]').onclick();await Promise.resolve();assert.equal(h.$('jq-branch').value,'new');assert.equal(h.$('jq-repo_url').value,'https://github.com/fazilatma/repo');
 assert.equal(calls.filter(q=>q.api==='gh.inspect_branch').length,3,'selected scanned branch uses cache');
 assert.ok(!calls.some(q=>q.api==='proj.quick_deploy'));
});

test('switching repository ignores delayed previous branch listings',async()=>{
 const h=importHarness();h.TEST.projectDlg({id:'fixture',type:'node',name:'Fixture',env:{}});let finish;
 h.vm.fetch=async(url,options)=>{const q=JSON.parse(options.body);if(q.api==='gh.repo_branches'&&q.repo==='first')await new Promise(r=>finish=r);return {status:200,json:async()=>({ok:true,data:q.api==='gh.repo_branches'?{branches:[{name:q.repo}]}:{apps:[]}})}};
 h.$('gh-repo-sel').innerHTML='<option value="first">first</option><option value="second">second</option>';h.$('gh-repo-sel').value='first';const pending=h.$('gh-repo-sel').onchange();await Promise.resolve();h.$('gh-repo-sel').value='second';await h.$('gh-repo-sel').onchange();finish();await pending;
 assert.match(h.$('gh-branch-table').textContent,/second/);assert.ok(!h.$('gh-branch-table').textContent.includes('first'));
});
