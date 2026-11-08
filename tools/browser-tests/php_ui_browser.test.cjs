/* Real Chromium + real Flask, timers/events/CSP enabled, temporary data only. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {spawn}=require('node:child_process'),{chromium:playwright}=require('playwright-core'),chromium=require('@sparticuz/chromium').default;
const root=path.resolve(__dirname,'../..');
async function setup(t){
 const server=spawn('python3',[path.join(__dirname,'server.py')],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'pythonanywhere')},stdio:['ignore','pipe','pipe']});let log='';server.stderr.on('data',s=>log+=s);t.after(()=>server.kill());
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Flask startup timeout: '+log)),15000);server.once('exit',code=>{clearTimeout(timer);reject(Error('Flask exited '+code+': '+log));});server.stdout.once('data',s=>{clearTimeout(timer);try{resolve(JSON.parse(s).port);}catch(e){reject(e);}});});
 // On non-Lambda Linux these three libraries may not be installed. The pinned
 // npm package already ships them. No OS install/network dependency is needed.
 const libDir=fs.mkdtempSync(path.join(os.tmpdir(),'s4-chromium-libs-'));t.after(()=>fs.rmSync(libDir,{recursive:true,force:true}));
 const packageRoot=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'..');
 const tar=path.join(libDir,'al2023.tar');fs.writeFileSync(tar,zlib.brotliDecompressSync(fs.readFileSync(path.join(packageRoot,'bin/al2023.tar.br'))));
 const {execFileSync}=require('node:child_process');execFileSync('tar',['-xf',tar,'-C',libDir]);
 const browser=await playwright.launch({headless:true,executablePath:await chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],env:{...process.env,LD_LIBRARY_PATH:[path.join(libDir,'lib'),process.env.LD_LIBRARY_PATH||''].join(':')}});t.after(()=>browser.close());
 const page=await browser.newPage(),origin='http://127.0.0.1:'+port;
 await page.goto(origin+'/login');await page.locator('[name=password]').fill('test');await Promise.all([page.waitForURL(origin+'/'),page.locator('form button').click()]);await page.waitForLoadState('networkidle');
 return {page,origin,log:()=>log};
}

test('opaque original client boots and restores/selects profiles with real timers: no JS/HTTP/CSP errors and no jobs', {timeout:90000},async t=>{
 const {page,origin}=await setup(t),errors=[],warnings=[],httpErrors=[],actions=[],messages=[];
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()});});
 page.on('request',r=>{if(r.url().includes('/api/php-ui/')){const b=r.postDataJSON();if(b?.action)actions.push(b.action);}});
 await page.exposeFunction('recordBrokerRequest',data=>messages.push(data));
 await page.addInitScript(()=>{if(window===top)window.addEventListener('message',event=>{if(event.data?.type==='s4-php-request')window.recordBrokerRequest(event.data);});});
 const before=await(await page.request.get(origin+'/__test__/snapshot')).json();
 await page.goto(origin+'/php-ui');const frame=page.frameLocator('#php-original-ui');await frame.locator('html[data-s4-ready="1"]').waitFor();
 const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));
 assert.equal(await page.locator('#php-original-ui').getAttribute('sandbox'),'allow-scripts allow-modals');
 // Real opaque origin: serviceWorker/cookie access throws, not a jsdom stub.
 assert.equal(await child.evaluate(()=>{try{void navigator.serviceWorker;return false;}catch(e){return e.name==='SecurityError';}}),true);
 assert.equal(await child.evaluate(()=>{try{void document.cookie;return false;}catch(e){return e.name==='SecurityError';}}),true);
 assert.equal(await child.evaluate(()=>s4RegisterShellWorker()),null);
 await frame.locator('#hdrProfileSelect').selectOption('one');await frame.locator('#profileName').filter({visible:true}).waitFor();
 await page.waitForTimeout(1500);
 for(const tab of ['settings','selectors','results','send','start'])await child.evaluate(name=>switchMainTab(name),tab);
 await child.evaluate(()=>toggleSettingsPanel());await page.waitForTimeout(18000);await child.evaluate(()=>toggleSettingsPanel());
 const health=await child.evaluate(async()=>{const r=await fetch('?runtime_health=1');return {headers:r.headers.get('content-type'),status:r.status,data:await r.clone().json(),text:await r.text()};});
 assert.equal(health.status,200);assert.match(health.headers,/application\/json/);assert.equal(health.data.runtime,'Python');assert.equal(health.data.processed,false);assert.ok(health.text.includes('Python'));
 assert.equal((await child.evaluate(()=>safeFetchJson('?app_ready=1'))).ready,true);
 assert.match(await frame.locator('#runtimePulse').getAttribute('title'),/Python v/);
 assert.match(await frame.locator('#prev-container').innerText(),/آزمایش خودکار غیرفعال/);
 // The explicit original test button opens the functioning trusted lab; it
 // never auto-probes during profile hydration.
 await child.evaluate(()=>switchMainTab('selectors'));await frame.locator('[onclick="testSel(\'container\')"]').click();await page.locator('#php-tools[open]').waitFor();assert.equal(await page.locator('[data-python-tool=selectors]').isVisible(),true);await page.locator('#php-tools-close').click();
 const diagnostics=await child.evaluate(()=>S4NativeDiagnostics.blockedBackground());assert.ok(diagnostics.sync_matrix_status>0&&diagnostics.internal_cron_feedback>0);
 assert.ok(!actions.some(a=>['test_selector','cron_run','ops_feedback','sync_matrix_status','internal_cron_feedback'].includes(a)),JSON.stringify(actions));
 assert.ok(!actions.some(a=>a.startsWith('python_')&&a!=='python_contracts'&&a!=='python_capabilities'));
 const after=await(await page.request.get(origin+'/__test__/snapshot')).json();assert.deepEqual(after,before);
 assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);
 // This stale v8.22 assertion is literally in upstream; do not filter console,
 // falsify the version, or change the pinned original client to hide it.
 assert.ok(warnings.every(w=>w.startsWith('⚠️ Version mismatch! HTML shows:')),JSON.stringify(warnings));
 t.diagnostic(JSON.stringify({javascript_errors:errors.length,http_errors:httpErrors.length,upstream_stale_version_warnings:warnings.length,endpoint_actions:[...new Set(actions)],blocked_background_actions:Object.keys(diagnostics),broker_requests:messages.length}));
});

test('original interface fills desktop/mobile viewports; title, all tabs, secure menu and help remain reachable', {timeout:90000},async t=>{
 const {page,origin}=await setup(t),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const before=await(await page.request.get(origin+'/__test__/snapshot')).json();
 await page.goto(origin+'/php-ui');const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await page.frameLocator('#php-original-ui').locator('html[data-s4-ready="1"]').waitFor();
 for(const size of [{width:1920,height:1080},{width:1280,height:800},{width:900,height:700},{width:899,height:700},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
  await page.setViewportSize(size);await child.evaluate(()=>{scrollTo(0,0);switchMainTab('start');});
  const box=await page.locator('#php-original-ui').boundingBox(),metrics=await child.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};};return {title:box('body>.container>h1'),toolbar:box('#hdrTools'),content:box('body>.container'),tabs:box('#mainTabs'),width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth};});
  t.diagnostic(JSON.stringify({viewport:size,frame:box,child:metrics}));
  assert.ok(Math.abs(box.x)<1&&Math.abs(box.y)<1,JSON.stringify({size,box}));
  assert.ok(Math.abs(box.width-size.width)<1&&Math.abs(box.height-size.height)<1,JSON.stringify({size,box}));
  assert.ok(metrics.title.y>=metrics.toolbar.bottom+3,'fixed toolbar must not cover title on desktop or mobile');
  assert.ok(metrics.width-metrics.content.width<=40,'no desktop-only 1400px content cap');
  assert.ok(metrics.scrollWidth<=metrics.width+1,'no clipped horizontal document');
  for(const tab of ['start','settings','selectors','results','send']){
   const button=page.frameLocator('#php-original-ui').locator(`#mainTabs [data-tab="${tab}"]`);await button.click();assert.equal(await page.frameLocator('#php-original-ui').locator('#pane-'+tab).evaluate(el=>getComputedStyle(el).display!=='none'),true);
  }
  // Real original hamburger -> same-page parent help, not a persistent host bar.
  await child.evaluate(()=>scrollTo(0,0));await page.frameLocator('#php-original-ui').locator('#hdrTools #hamburgerBtn').click();
  await page.frameLocator('#php-original-ui').locator('[data-python-panel="help"]').click();await page.locator('#php-ui-about[open]').waitFor();
  assert.equal(await page.locator('#php-ui-about').isVisible(),true);await page.locator('#php-ui-about-close').click();
  assert.ok((await page.locator('#php-ui-recovery').boundingBox()).y<0,'no permanent host overlay after successful boot')
  await child.evaluate(()=>toggleSettingsPanel());
 }
 // Keyboard-only recovery stays accessible without covering healthy content.
 await page.locator('#php-ui-recovery').focus();assert.ok((await page.locator('#php-ui-recovery').boundingBox()).y>=0);
 await page.keyboard.press('Enter');await page.locator('#php-ui-about[open]').waitFor();await page.keyboard.press('Escape');
 assert.equal(await page.locator('#php-ui-about').evaluate(el=>el.open),false);
 // Restoring a compact viewport cannot change data or start jobs.
 const after=await(await page.request.get(origin+'/__test__/snapshot')).json();assert.deepEqual(after,before);assert.deepEqual(errors,[]);
});


test('failed original frame retains visible recovery; help can close with Escape and open usable secure settings', {timeout:30000},async t=>{
 const {page,origin}=await setup(t);await page.route('**/php-ui/frame',route=>route.abort());
 await page.goto(origin+'/php-ui');await page.locator('#php-ui-recovery').click();await page.locator('#php-ui-about[open]').waitFor();
 await page.keyboard.press('Escape');assert.equal(await page.locator('#php-ui-about').evaluate(el=>el.open),false);
 await page.locator('#php-ui-recovery').click();await page.locator('#hamburgerBtn').click();
 assert.equal(await page.locator('#php-ui-about').evaluate(el=>el.open),false);
 await page.locator('#settings-menu-close').click();
 assert.equal(await page.locator('#settings-menu').evaluate(el=>el.open),false);
});
