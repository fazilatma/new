// Browser-only fixture tests: real console HTML/CSS/JS, mocked authenticated APIs.
// Does not run PHP, shell commands, GitHub operations, or a real deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
const source=await readFile(new URL('./webconsole.php',import.meta.url),'utf8');
const sample=JSON.parse(await readFile(new URL('./examples/scraper4-project.json',import.meta.url),'utf8'));

test('Chromium: responsive skins, every section, appearance persistence and import/export',{
 skip:!process.env.PLAYWRIGHT_PATH,timeout:120000
},async()=>{
 const {chromium}=await import(process.env.PLAYWRIGHT_PATH);
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_BIN||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],calls=[];
 page.on('pageerror',e=>errors.push(e.message));
 const css=source.match(/<style>([\s\S]*?)<\/style>/)[1];
 const start=source.indexOf('<div id="app">');
 const body=source.slice(start,source.indexOf('<?php return ob_get_clean();}',start)).replace(/<script src=[^>]+><\/script>/g,'');
 const appearance={theme:'dark',layout:'classic',density:'comfortable'};
 const fixtures={
  sysinfo:{host:'UI fixture · not a live server',kernel:'Linux',php:'8.2',user:'www-data',ip:'127.0.0.1',mem:{total:8589934592,used:2147483648},disk:{total:107374182400,free:64424509440},cores:4,load:[.2,.4,.3],uptime:86300,cpu_pct:12,tools:{git:true,node:true,npm:true,rsync:true},term_mode:'fallback'},
  'proj.list':{projects:[{...sample,id:'fixture',service:null}]},
  'fs.list':{path:'/var/www',items:[{name:'example.txt',dir:false,perms:'0600',owner:'www-data',group:'www-data',size:256,mtime:1}]},
  'gh.user_repos':{repos:[{name:'fixture-repo',language:'JS'}]},'gh.repo_branches':{branches:[{name:'release-99',default:true},{name:'arena/newer'},{name:'unversioned'}]},
  'proc.list':{list:[],count:0,total_cpu:0,total_mem:0,my_pid:20},
  'term.list':{sessions:[]},'gh.get':{gh_repo:'example/private-backups',gh_branch:'backups'},'gh.profiles':{profiles:[]},'gh.snapshots':{snapshots:[]},
  'jobs.list':{jobs:[{id:'fixture',name:'Installation diagnostic',created:'2026-09-18',type:'deploy',status:{status:'failed',exit:1}}]},
  'proj.preflight':{ok:false,user:'www-data',target:'/var/www/scraper4-cloudflare',checks:[{name:'Deployment directory',ok:false,detail:'Permission denied. Ask an administrator to create the directory.'}],notes:['Read-only fixture.']}
 };
 await page.route('**/*',async route=>{
  const req=route.request();if(req.method()==='POST'){
   const q=req.postDataJSON();calls.push(q);
   if(q.api==='settings.save')for(const k of ['theme','layout','density'])if(q[k])appearance[k]=q[k];
   const data=q.api==='settings.get'?{...appearance,fs_start:'/var/www',session_minutes:180,allowed_ips:''}:q.api==='gh.inspect_branch'?{apps:[{name:'Root',subfolder:'',type:'node',version:q.branch==='release-99'?'9.0.0':'1.0.0'},{name:'Scraper',subfolder:'cloudflare-scraper4',type:'node',version:q.branch==='arena/newer'?'1.210.0+':q.branch==='release-99'?'1.9.0':''}]}:fixtures[q.api]??{};
   return route.fulfill({json:{ok:true,data}});
  }
  if(req.url()==='http://wcp.test/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><script>const __BOOT='+JSON.stringify({...appearance,csrf:'fixture',host:'UI fixture',v:'1.2.1',fs_start:'/var/www'})+';</script></head><body>'+body});
  return route.abort();
 });
 await page.goto('http://wcp.test/');await page.locator('#v-dash .stat').first().waitFor();assert.match(await page.locator('#topbar').innerText(),/وب‌کنسول/);
 // Widths include narrow mobile, tablet, and desktop. Every palette/layout is applied.
 for(const width of [320,390,768,1024,1440]){
  await page.setViewportSize({width,height:1000});
  for(const layout of ['classic','studio','focus'])for(const theme of ['dark','light','ocean','forest','amber']){
   await page.evaluate(p=>applyAppearance(p),{layout,theme,density:'comfortable'});
   const metrics=await page.evaluate(()=>({body:document.documentElement.scrollWidth,viewport:innerWidth,view:document.querySelector('.view.on').getBoundingClientRect().width}));
   assert.ok(metrics.body<=width+1,`${width}/${layout}/${theme}: page overflow`);assert.ok(metrics.view>200,`${width}/${layout}: collapsed view`);
  }
 }
 await page.setViewportSize({width:1440,height:1000});
 // All original navigation destinations still render with mock data.
 for(const id of ['files','proc','backup','proj','jobs','set','term','dash']){
  await page.evaluate(id=>switchTab(id),id);await page.locator('#v-'+id+'.on').waitFor();
 }
 await page.evaluate(()=>switchTab('proj'));await page.locator('.project-card').waitFor();
 await page.locator('#project-filter').fill('not-a-project');assert.equal(await page.locator('.project-card:visible').count(),0);await page.locator('#project-filter').fill('Scraper4');assert.equal(await page.locator('.project-card:visible').count(),1);
 await page.locator('[data-check]').click();await page.getByText('Permission denied. Ask an administrator to create the directory.').waitFor();await page.keyboard.press('Escape');
 await page.locator('#appearancebtn').click();await page.locator('[data-skin="ocean"]').click();await page.locator('[data-layout-choice="studio"]').click();await page.locator('#appearance-save').click();await page.locator('#modals.on').waitFor({state:'hidden'});
 assert.equal(appearance.theme,'ocean');assert.equal(appearance.layout,'studio');
 await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'ocean');assert.equal(await page.locator('html').getAttribute('data-layout'),'studio');
 await page.keyboard.press('Control+k');await page.locator('#command-query').fill('project');await page.locator('[data-command]').first().click();await page.locator('#project-preset').selectOption('scraper4');await page.locator('#preset-new').click();assert.equal(await page.locator('#jq-start_cmd').inputValue(),sample.start_cmd);await page.keyboard.press('Escape');
 await page.locator('[data-edit]').click();await page.locator('#tab-json').click();await page.locator('#jq-json-file').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...sample,name:'Imported fixture'}))});
 await page.waitForFunction(()=>document.querySelector('#jq-json-text').value.includes('Imported fixture'));await page.locator('#jq-json-apply').click();assert.equal(await page.locator('#jq-name').inputValue(),'Imported fixture');await page.keyboard.press('Escape');
 await page.locator('[data-edit]').click();await page.locator('#tab-gh').click();await page.locator('#gh-load').click();await page.waitForFunction(()=>document.querySelector('#gh-branch-progress').textContent.includes('3 / 3'));
 assert.equal(await page.locator('#gh-branch-table tbody tr').count(),3);
 assert.match(await page.locator('#gh-branch-table tbody tr').first().innerText(),/release-99/);
 await page.locator('#gh-version-path').selectOption('cloudflare-scraper4');assert.match(await page.locator('#gh-branch-table tbody tr').first().innerText(),/arena\/newer/);
 await page.locator('#gh-branch-table tbody tr').first().locator('button').click();await page.locator('#gh-apps-list [data-custom]').last().click();assert.equal(await page.locator('#jq-branch').inputValue(),'arena/newer');assert.equal(await page.locator('#jq-subfolder').inputValue(),'cloudflare-scraper4');await page.keyboard.press('Escape');
 await page.locator('[data-export]').click();const exported=JSON.parse(await page.locator('#project-export').inputValue());assert.equal(exported.env,undefined);assert.equal(exported.auth_token,undefined);await page.keyboard.press('Escape');
 assert.equal(await page.locator('.toast.err').count(),0,'no failed section render');await page.evaluate(()=>document.querySelector('#toasts').replaceChildren());
 if(process.env.WCP_SCREENSHOT_DIR){await mkdir(process.env.WCP_SCREENSHOT_DIR,{recursive:true});for(const [layout,theme]of [['classic','dark'],['studio','light'],['focus','forest']]){await page.evaluate(p=>applyAppearance(p),{layout,theme});await page.screenshot({path:process.env.WCP_SCREENSHOT_DIR+'/'+layout+'.png'});}}
 assert.ok(!calls.some(q=>['proj.deploy','proj.save','proj.service','term.write','gh.backup'].includes(q.api)),'fixture interactions must not trigger execution');
 assert.deepEqual(errors,[]);
 assert.equal(await page.locator('.toast.err').count(),0,'no failed section render');
 }finally{await browser.close()}
});
