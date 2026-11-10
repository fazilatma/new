/* Real Chromium + real Flask, timers/events/CSP enabled, temporary data only. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {spawn}=require('node:child_process'),{chromium:playwright}=require('playwright-core'),chromium=require('@sparticuz/chromium').default;
const root=path.resolve(__dirname,'../..');
async function setup(t,mode="",open=false){
 const server=spawn('python3',[path.join(__dirname,'server.py')],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'pythonanywhere'),S4_BROWSER_EXTRACTION_FIXTURE:mode,S4_BROWSER_OPEN:open?'1':''},stdio:['ignore','pipe','pipe']});let log='';server.stderr.on('data',s=>log+=s);t.after(()=>server.kill());
 const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Flask startup timeout: '+log)),15000);server.once('exit',code=>{clearTimeout(timer);reject(Error('Flask exited '+code+': '+log));});server.stdout.once('data',s=>{clearTimeout(timer);try{resolve(JSON.parse(s).port);}catch(e){reject(e);}});});
 // On non-Lambda Linux these three libraries may not be installed. The pinned
 // npm package already ships them. No OS install/network dependency is needed.
 const libDir=fs.mkdtempSync(path.join(os.tmpdir(),'s4-chromium-libs-'));t.after(()=>fs.rmSync(libDir,{recursive:true,force:true}));
 const packageRoot=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'..');
 const tar=path.join(libDir,'al2023.tar');fs.writeFileSync(tar,zlib.brotliDecompressSync(fs.readFileSync(path.join(packageRoot,'bin/al2023.tar.br'))));
 const {execFileSync}=require('node:child_process');execFileSync('tar',['-xf',tar,'-C',libDir]);
 const browser=await playwright.launch({headless:true,executablePath:await chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],env:{...process.env,LD_LIBRARY_PATH:[path.join(libDir,'lib'),process.env.LD_LIBRARY_PATH||''].join(':')}});t.after(()=>browser.close());
 const page=await browser.newPage(),origin='http://127.0.0.1:'+port;
 if(open){await page.goto(origin+'/');await page.waitForLoadState('networkidle');return {page,origin,log:()=>log};}
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
 assert.ok(!actions.some(a=>a.startsWith('python_')&&!['python_contracts','python_capabilities','python_start_status'].includes(a)));
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

test('original Start buttons save dirty settings, extract the selected profile, continue real pages, diagnose and stop without running unrelated jobs', {timeout:90000},async t=>{
 const {page,origin}=await setup(t,'success'),errors=[],dialogs=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('dialog',async d=>{dialogs.push(d.message());await d.accept();});
 await page.goto(origin+'/php-ui');const f=page.frameLocator('#php-original-ui');await f.locator('#python-start-control').waitFor();
 await f.locator('#hdrProfileSelect').selectOption('one');await f.locator('#profileName').filter({visible:true}).waitFor();
 const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await page.waitForFunction(()=>true);
 await child.waitForFunction(()=>profileFormReady&&currentProfileKey==='one');await page.waitForTimeout(1200);await child.waitForFunction(()=>profileFormReady);await child.evaluate(()=>switchMainTab('start'));
 await f.locator('#pages').fill('2');await f.locator('#startBtn').click();
 await f.locator('#python-start-jobs').getByText('▶ مرحلهٔ بعد',{exact:true}).waitFor({timeout:5000}).catch(async e=>{t.diagnostic(JSON.stringify({message:await f.locator('#python-start-message').innerText(),state:await(await page.request.get(origin+'/__test__/extract-state')).json(),dialogs}));throw e;});
 let state=await(await page.request.get(origin+'/__test__/extract-state')).json();let selected=state.jobs.filter(j=>j.profile_id===1&&j.kind==='extract');
 assert.equal(selected.length,1);assert.equal(selected[0].status,'waiting');assert.equal(selected[0].payload._page,2);assert.equal(state.products.length,2);
 assert.ok(state.jobs.filter(j=>j.id!==selected[0].id).every(j=>j.status==='waiting'));await child.waitForFunction(()=>profileFormReady);
 await f.locator('#python-start-jobs').getByText('▶ مرحلهٔ بعد',{exact:true}).click();await f.locator('#python-start-message').filter({hasText:'ثانیه'}).waitFor();
 assert.equal((await(await page.request.get(origin+'/__test__/extract-state')).json()).products.length,2);
 const csrf=await page.locator('meta[name=csrf]').getAttribute('content');assert.equal((await page.request.post(origin+'/__test__/age-step',{data:{},headers:{'X-CSRF-Token':csrf}})).status(),200);
 await f.locator('#python-start-jobs').getByText('▶ مرحلهٔ بعد',{exact:true}).click();await f.locator('#python-start-jobs').getByText(/پایان‌یافته/).waitFor({timeout:5000}).catch(async e=>{t.diagnostic(JSON.stringify({message:await f.locator('#python-start-message').innerText(),state:await(await page.request.get(origin+'/__test__/extract-state')).json()}));throw e;});
 state=await(await page.request.get(origin+'/__test__/extract-state')).json();assert.equal(state.products.length,3);assert.equal(state.jobs.find(j=>j.id===selected[0].id).status,'done');
 await child.evaluate(()=>switchMainTab('start'));await f.locator('[onclick="comprehensiveTestStart()"]').click();await page.locator('#php-tools[open]').waitFor();await page.locator('#audit-message').filter({hasText:'پایان تست'}).waitFor();
 assert.ok(Number(await page.locator('#audit-done').innerText())>=2);await page.locator('#php-tools-close').click();
 await child.waitForFunction(()=>profileFormReady);await child.evaluate(()=>switchMainTab('start'));await f.locator('#startBackendBtn').click();
 await f.locator('#python-start-jobs').getByText('مکث',{exact:true}).waitFor();await f.locator('#python-start-jobs').getByText('مکث',{exact:true}).click();
 await f.locator('#python-start-jobs').getByText(/مکث‌شده/).waitFor();
 assert.ok(dialogs.some(s=>s.includes('checkpoint')));assert.deepEqual(errors,[]);
});

test('original Start displays actual safe HTTP403 diagnosis, blocks duplicate/automatic retries and opens explicit source test', {timeout:60000},async t=>{
 const {page,origin}=await setup(t,'denied'),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+'/php-ui');const f=page.frameLocator('#php-original-ui');await f.locator('#python-start-control').waitFor();await f.locator('#hdrProfileSelect').selectOption('one');
 const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await child.waitForFunction(()=>profileFormReady);await child.evaluate(()=>switchMainTab('start'));
 await f.locator('#startBackendBtn').click();await f.locator('#python-start-jobs').getByText(/HTTP 403/).waitFor();
 assert.match(await f.locator('#python-start-message').innerText(),/دسترسی/);assert.ok(!(await f.locator('#python-start-control').innerText()).includes('PRIVATE-FIXTURE'));
 await f.locator('#startBtn').click();await f.locator('#python-start-message').filter({hasText:'ناموفق'}).waitFor();
 const feedback=await f.locator('#python-start-message').boundingBox();assert.ok(feedback.y>=0&&feedback.y<(await child.evaluate(()=>innerHeight)),'blocked-start error must be visible beside Start, not hidden below the run cards');
 const state=await(await page.request.get(origin+'/__test__/extract-state')).json();assert.equal(state.jobs.filter(j=>j.profile_id===1&&j.kind==='extract').length,1);
 await f.locator('#python-start-jobs').getByText('آزمایش مبدأ / عیب‌یابی',{exact:true}).click();await page.locator('#audit-results').filter({hasText:'خطا'}).waitFor();
 assert.deepEqual(errors,[]);
});

test('original Start public GitHub search/import and no-selector trial are real opt-in actions, not boot traffic', {timeout:60000},async t=>{
 const {page,origin}=await setup(t,'success'),errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 page.on('request',r=>{if(r.url().includes('/api/php-ui/'))actions.push(r.postDataJSON()?.action);});
 await page.goto(origin+'/php-ui');const f=page.frameLocator('#php-original-ui');await f.locator('#python-start-control').waitFor();await f.locator('#hdrProfileSelect').selectOption('one');
 const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await child.waitForFunction(()=>profileFormReady);await page.waitForTimeout(1200);await child.waitForFunction(()=>profileFormReady);await child.evaluate(()=>switchMainTab('start'));
 const before=await(await page.request.get(origin+'/__test__/extract-state')).json();
 await f.locator('#startManualBtn').click();await page.locator('#audit-message').filter({hasText:'پایان تست'}).waitFor();
 assert.equal(await page.locator('#extraction-audit-form [name=engine]').inputValue(),'heuristic');await page.locator('#php-tools-close').click();
 assert.deepEqual((await(await page.request.get(origin+'/__test__/extract-state')).json()).products,before.products);
 await child.evaluate(()=>loadStartProductOverview(true));await f.locator('.spo-card').first().waitFor();
 await f.locator('.spo-card').first().click();await page.locator('#php-tools[open]').waitFor();await page.locator('#product-grid .product-card').first().waitFor();assert.equal(await page.locator('#results-profile').inputValue(),'');await page.locator('#php-tools-close').click();
 await f.locator('#profileProductSource').selectOption('github');assert.ok(!actions.includes('python_github_catalog'));
 await f.locator('[onclick="ghSourceRefresh()"]').first().click();await f.locator('#ghFileSelect').selectOption('products.csv');
 await f.locator('#ghImportBtn').click();await f.locator('#python-start-jobs').getByText(/پایان‌یافته/).waitFor();
 const state=await(await page.request.get(origin+'/__test__/extract-state')).json();assert.ok(state.products.some(p=>p.title==='CSV fixture'));assert.equal(state.jobs.filter(j=>j.profile_id===1&&j.kind==='extract').length,1);
 assert.ok(state.jobs.filter(j=>j.profile_id!==1).every(j=>j.status==='waiting'));assert.deepEqual(errors,[]);
});


test('Start on an existing waiting profile actually runs that job instead of rejecting it as a duplicate', {timeout:30000},async t=>{
 const {page,origin}=await setup(t,'waiting');page.on('dialog',d=>d.accept());
 await page.goto(origin+'/php-ui');const f=page.frameLocator('#php-original-ui');await f.locator('#python-start-control').waitFor();
 await f.locator('#profileSelect').selectOption('one');const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));
 await child.waitForFunction(()=>profileFormReady&&currentProfileKey==='one');await page.waitForTimeout(1000);await child.waitForFunction(()=>profileFormReady);await child.evaluate(()=>switchMainTab('start'));
 assert.equal(await f.locator('#profileName').inputValue(),'مانتو پاتریس');
 await f.locator('#startBtn').click();
 await f.locator('#python-start-jobs').getByText(/پایان‌یافته/).waitFor({timeout:4000}).catch(async e=>{t.diagnostic(await f.locator('#python-start-message').innerText());throw e;});
 const state=await(await page.request.get(origin+'/__test__/extract-state')).json();
 assert.equal(state.jobs.filter(j=>j.profile_id===1&&j.kind==='extract').length,1);assert.equal(state.jobs.find(j=>j.profile_id===1&&j.kind==='extract').status,'done');assert.equal(state.products.length,2);
 assert.ok(state.jobs.filter(j=>j.profile_id!==1).every(j=>j.status==='waiting'));
});

test('human diagnostic link uses normal login, exports reviewed JSON without credentials and opens complete source inventory', {timeout:60000},async t=>{
 const {page,origin}=await setup(t,'waiting');const context=await page.context().browser().newContext();t.after(()=>context.close());const human=await context.newPage(),errors=[];human.on('pageerror',e=>errors.push(e.message));human.on('dialog',d=>d.accept());
 await human.goto(origin+'/api/php-ui/start-report?name='+encodeURIComponent('مانتو پاتریس'));assert.equal(new URL(human.url()).pathname,'/login');
 await human.locator('[name=password]').fill('test');await Promise.all([human.waitForURL(origin+'/php-ui?report=*'),human.locator('form button').click()]);
 await human.locator('#php-tools[open]').waitFor();await human.locator('#native-diagnostic-download').waitFor();
 const preview=JSON.parse(await human.locator('#native-diagnostic-preview').inputValue());assert.equal(preview.profile.name,'مانتو پاتریس');assert.equal(preview.snapshot,true);assert.equal(preview.processed,false);assert.equal(preview.source_reachability_tested,false);
 const before=await(await human.request.get(origin+'/__test__/extract-state')).json();
 const download=human.waitForEvent('download');await human.locator('#native-diagnostic-download').click();const file=await download;
 assert.equal(file.suggestedFilename(),'scraper4-diagnostic-1.json');const content=fs.readFileSync(await file.path(),'utf8');assert.deepEqual(JSON.parse(content),preview);
 assert.ok(!/temporary-browser-fixture|https:\/\/example\.com|csrf|consumer_secret/.test(content));
 await human.locator('#php-tools-close').click();const child=human.frames().find(f=>f.url().endsWith('/php-ui/frame'));await human.frameLocator('#php-original-ui').locator('html[data-s4-ready="1"]').waitFor();
 await child.evaluate(()=>toggleSettingsPanel());await human.frameLocator('#php-original-ui').locator('[data-python-panel="endpoint-inventory"]').click();
 await human.locator('#native-endpoints-status').filter({hasText:'712'}).waitFor();await human.locator('#native-endpoints-search').fill('sync_diagnose');
 await human.locator('#native-endpoints-body').filter({hasText:'sync_diagnose'}).waitFor();
 const inventory=await(await human.request.get(origin+'/api/php-ui/endpoint-inventory')).json();assert.equal(inventory.inventory.entries.length,712);assert.equal(inventory.connected.full_php_parity,false);assert.ok(inventory.connected.read_actions.includes('sync_diagnose'));
 const after=await(await human.request.get(origin+'/__test__/extract-state')).json();assert.deepEqual(after,before);assert.deepEqual(errors,[]);
});

test('native extraction-send pipeline shows verified children, product errors and missing queues without running or repairing work', {timeout:60000},async t=>{
 const {page,origin}=await setup(t,'pipeline'),errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('request',r=>{if(r.url().includes('/api/php-ui/')){const b=r.postDataJSON();if(b?.action)actions.push(b.action);}});
 const before=await(await page.request.get(origin+'/__test__/snapshot')).json();
 await page.goto(origin+'/php-ui');const f=page.frameLocator('#php-original-ui');await f.locator('html[data-s4-ready="1"]').waitFor();
 await f.locator('#hdrProfileSelect').selectOption('one');await f.locator('#profileName').filter({visible:true}).waitFor();
 const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await child.evaluate(()=>switchMainTab('start'));
 await f.locator('#python-pipeline-refresh').click();await f.locator('#syncPipelineCards').filter({hasText:'زنجیرهٔ ناقص'}).waitFor({timeout:5000});
 const cards=f.locator('#syncPipelineCards article');assert.equal(await cards.count(),2);
 assert.match(await f.locator('#syncPipelineCards').innerText(),/پایان با خطای محصول/);
 for(const card of await cards.all())await card.locator('summary').click();
 const text=await f.locator('#syncPipelineCards').innerText();assert.match(text,/ووکامرس/);assert.match(text,/خطا: 1/);assert.ok(!text.includes('PIPELINE-PRIVATE'));
 const reads=actions.filter(a=>a==='sync_pipeline_status').length;await child.evaluate(()=>{syncPipelineRender();syncPipelineRender();});await page.waitForTimeout(4000);
 assert.equal(actions.filter(a=>a==='sync_pipeline_status').length,reads);assert.ok(!actions.some(a=>['python_extract_start','python_extract_step','python_manual_sync','python_send_enqueue','python_queue_control'].includes(a)));
 const after=await(await page.request.get(origin+'/__test__/snapshot')).json();assert.deepEqual(after,before);assert.deepEqual(errors,[]);
});

for(const route of ['/','/php-ui'])test('shared real report/probe/inventory in '+route+' uses the same services, opt-in network, reviewed export and unchanged products/queues',{timeout:60000},async t=>{
 const {page,origin}=await setup(t,'pipeline'),errors=[],probes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/extraction/probe'))probes.push(r.postDataJSON());});page.on('dialog',d=>d.accept());
 await page.goto(origin+route);if(route==='/php-ui'){const f=page.frameLocator('#php-original-ui');await f.locator('html[data-s4-ready="1"]').waitFor();const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await child.evaluate(()=>toggleSettingsPanel());await f.locator('[data-python-panel="shared-workspace"]').click();}
 else await page.locator('#start-profile option[value="1"]').waitFor({state:'attached'});
 const before=await(await page.request.get(origin+'/__test__/extract-state')).json();assert.equal(probes.length,0);
 await page.locator('#shared-php-profile').selectOption('1');await page.locator('#shared-php-report').click();await page.locator('#shared-php-download').waitFor();let report=JSON.parse(await page.locator('#shared-php-preview').inputValue());assert.equal(report.pipeline.reconciliation_performed,false);assert.equal(report.source_reachability_tested,false);assert.equal(probes.length,0);
 await page.locator('#shared-php-probe').click();await page.locator('#shared-php-status').filter({hasText:'آخرین آزمایش صریح'}).waitFor();
 report=JSON.parse(await page.locator('#shared-php-preview').inputValue());assert.equal(probes.length,1);assert.deepEqual(probes[0],{profile_id:1});assert.equal(report.live_probe.status,'passed');assert.equal(report.live_probe.count,1);assert.equal(report.live_probe.products_changed,false);assert.ok(!('next' in report.live_probe));
 const event=page.waitForEvent('download');await page.locator('#shared-php-download').click();const download=await event;assert.equal(download.suggestedFilename(),'scraper4-diagnostic-1.json');const content=fs.readFileSync(await download.path(),'utf8');assert.deepEqual(JSON.parse(content),report);assert.ok(!/PIPELINE-PRIVATE|temporary-browser-fixture|https:\/\/example.com|csrf/.test(content));
 const after=await(await page.request.get(origin+'/__test__/extract-state')).json();assert.deepEqual(after,before);
 await page.locator('#shared-php-contracts').click();await page.locator('#shared-php-status').filter({hasText:'712'}).waitFor();const inventory=JSON.parse(await page.locator('#shared-php-preview').inputValue());assert.equal(inventory.inventory.source_version,'10.685');assert.equal(inventory.connected.full_php_parity,false);
 await page.locator('#shared-php-profile').selectOption('');assert.equal(await page.locator('#shared-php-preview').inputValue(),'');assert.equal(await page.locator('#shared-php-download').isVisible(),false);assert.deepEqual(errors,[]);
});

for(const route of ['/','/php-ui'])test('all-profile synchronization audit and sequential opt-in probes with stop/incomplete export in '+route,{timeout:60000},async t=>{
 const {page,origin}=await setup(t,'pipeline'),errors=[],probes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(r.url().includes('/api/extraction/probe'))probes.push(r.postDataJSON());});
 await page.goto(origin+route);if(route==='/php-ui'){const f=page.frameLocator('#php-original-ui');await f.locator('html[data-s4-ready="1"]').waitFor();const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await child.evaluate(()=>syncDiagnose());await page.locator('#shared-php-status').filter({hasText:'پایان بررسی'}).waitFor();}
 else await page.locator('#start-profile option[value="1"]').waitFor({state:'attached'});
 const before=await(await page.request.get(origin+'/__test__/extract-state')).json();
 await page.locator('#shared-php-audit-all').click();await page.locator('#shared-php-status').filter({hasText:'پایان بررسی'}).waitFor();let report=JSON.parse(await page.locator('#shared-php-preview').inputValue());
 assert.equal(report.profiles.length,2);assert.equal(report.complete,true);assert.equal(report.local_audit_complete,true);assert.equal(report.source_reachability_tested,false);assert.equal(probes.length,0);assert.equal(report.destination_reachability_tested,false);
 assert.ok(report.profiles.every(p=>p.checks.some(c=>c.stage==='pricing')&&p.checks.some(c=>c.stage==='queues')));
 let once=true;await page.route('**/api/extraction/probe',async r=>{if(once){once=false;await page.locator('#shared-php-stop-all').click();}await r.continue();});
 await page.locator('#shared-php-probe-all').click();await page.locator('#shared-php-status').filter({hasText:'گزارش ناقص'}).waitFor();report=JSON.parse(await page.locator('#shared-php-preview').inputValue());assert.equal(report.complete,false);assert.equal(report.stopped,true);assert.equal(report.live_probe_count,1);assert.equal(probes.length,1);await page.unroute('**/api/extraction/probe');
 await page.locator('#shared-php-probe-all').click();await page.locator('#shared-php-status').filter({hasText:'پایان بررسی'}).waitFor();report=JSON.parse(await page.locator('#shared-php-preview').inputValue());assert.equal(report.complete,true);assert.equal(report.live_probe_count,2);assert.equal(probes.length,3);assert.ok(report.profiles.every(p=>['passed','empty'].includes(p.live_probe.status)));assert.ok(report.profiles.some(p=>p.live_probe.status==='passed'));
 const event=page.waitForEvent('download');await page.locator('#shared-php-download').click();const download=await event;assert.equal(download.suggestedFilename(),'scraper4-synchronization-all.json');const content=fs.readFileSync(await download.path(),'utf8');assert.deepEqual(JSON.parse(content),report);assert.ok(!/PIPELINE-PRIVATE|https:\/\/example.com|csrf|consumer_secret/.test(content));
 assert.deepEqual(await(await page.request.get(origin+'/__test__/extract-state')).json(),before);assert.deepEqual(errors,[]);
});


for(const route of ['/','/php-ui'])test('owner open mode in '+route+' needs no login, API token, CSRF or persistent admin cookie',{timeout:60000},async t=>{
 const {page,origin}=await setup(t,'pipeline',true),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(origin+route);if(route==='/php-ui'){const f=page.frameLocator('#php-original-ui');await f.locator('html[data-s4-ready="1"]').waitFor();const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await child.evaluate(()=>toggleSettingsPanel());await f.locator('[data-python-panel="shared-workspace"]').click();}else assert.match(await page.locator('header').innerText(),/دسترسی باز/);
 assert.equal(await page.locator('meta[name=csrf]').getAttribute('content'),'');await page.locator('#shared-php-profile').selectOption('1');await page.locator('#shared-php-report').click();await page.locator('#shared-php-download').waitFor();assert.ok(JSON.parse(await page.locator('#shared-php-preview').inputValue()).pipeline);
 const read=await page.request.post(origin+'/api/php-ui/read',{data:{action:'python_sync_audit',fields:{},query:{}}});assert.equal(read.status(),200);assert.ok((await read.json()).profiles.length===2);
 const before=await(await page.request.get(origin+'/__test__/extract-state')).json();
 const probe=await page.request.post(origin+'/api/extraction/probe',{data:{profile_id:1}});assert.equal(probe.status(),200);assert.equal((await probe.json()).report.status,'passed');
 assert.deepEqual(await(await page.request.get(origin+'/__test__/extract-state')).json(),before);
 assert.equal((await page.request.get(origin+'/api/deploy/run')).status(),401);assert.equal((await page.context().cookies()).filter(c=>c.name==='session').length,0);assert.deepEqual(errors,[]);
});

for(const route of ['/','/php-ui'])test('real local product cleanup in '+route+' confirms, persists and needs no login in open mode',{timeout:60000},async t=>{
 const {page,origin}=await setup(t,'success',true),errors=[];page.on('pageerror',e=>errors.push(e.message));let accept=false,dialogs=0;
 page.on('dialog',async d=>{dialogs++;if(accept)await d.accept();else await d.dismiss();});
 await page.goto(origin+route);const before=await(await page.request.get(origin+'/__test__/extract-state')).json();assert.equal(before.products.length,1);
 if(route==='/php-ui'){
  const f=page.frameLocator('#php-original-ui');await f.locator('#python-start-control').waitFor();await f.locator('#hdrProfileSelect').selectOption('one');const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await child.waitForFunction(()=>profileFormReady&&currentProfileKey==='one');await page.waitForTimeout(1200);
  await child.evaluate(()=>removeBelowMinPrice());assert.equal((await(await page.request.get(origin+'/__test__/extract-state')).json()).products.length,1);
  accept=true;const done=page.waitForResponse(r=>r.url().endsWith('/api/php-ui/write')&&r.request().postDataJSON()?.action==='python_cleanup_products');await child.evaluate(()=>removeBelowMinPrice());assert.equal((await(await done).json()).removed,1);await child.waitForFunction(()=>products.size===0);
 }else{
  await page.locator('#start-profile option[value="1"]').waitFor({state:'attached'});accept=true;await page.locator('#start-profile').selectOption('1');await page.locator('#profile-settings-name').filter({hasText:'مرجع آزمایشی'}).waitFor({state:'attached'});accept=false;await page.locator('#tab-settings').click();const button=page.locator('[data-profile-cleanup="all"]');await button.waitFor();await page.waitForFunction(()=>!document.querySelector('[data-profile-cleanup="all"]').disabled);
  const preview=page.waitForResponse(r=>r.url().endsWith('/cleanup-preview'));await button.click();assert.equal((await(await preview).json()).count,1);await page.waitForTimeout(150);assert.equal((await(await page.request.get(origin+'/__test__/extract-state')).json()).products.length,1);
  accept=true;const done=page.waitForResponse(r=>r.url().endsWith('/cleanup'));await button.click();assert.equal((await(await done).json()).removed,1);
 }
 const after=await(await page.request.get(origin+'/__test__/extract-state')).json();assert.equal(after.products.length,0);assert.deepEqual(after.jobs,before.jobs);assert.ok(dialogs>=2);assert.deepEqual(errors,[]);
});

for(const route of ['/','/php-ui'])test('stuck extraction resumes inside its exact queue row in '+route+' without navigation, new job or unrelated sends',{timeout:60000},async t=>{
 const {page,origin}=await setup(t,'resume',true),errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.on('request',r=>{if(r.url().endsWith('/api/php-ui/write'))actions.push(r.postDataJSON()?.action);});
 await page.goto(origin+route);const before=await(await page.request.get(origin+'/__test__/extract-state')).json(),url=page.url();assert.equal((await(await page.request.get(origin+'/__test__/source-calls')).json()).urls.length,0);
 let f,child;
 if(route==='/php-ui'){
  f=page.frameLocator('#php-original-ui');await f.locator('html[data-s4-ready="1"]').waitFor();child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));
  await f.locator('#hdrProfileSelect').selectOption('other');await child.waitForFunction(()=>profileFormReady&&currentProfileKey==='other');await page.waitForTimeout(1200);await child.evaluate(()=>switchMainTab('start'));
  await f.locator('#profileName').filter({visible:true}).fill('unsaved draft keep');
  const row=f.locator('[data-python-extract-id="1"]');await row.waitFor();await row.locator('button[onclick*="resumeExtractQueue"]').click();
  await row.locator('[data-python-extract-message]').filter({hasText:'یک مرحلهٔ واقعی اجرا شد'}).waitFor();
  assert.equal(await child.evaluate(()=>currentProfileKey),'other');assert.equal(await f.locator('#profileName').inputValue(),'unsaved draft keep');assert.equal(await page.locator('#settings-menu').evaluate(e=>e.open),false);
  // Read the original row report in place; automatic callback cannot write.
  await child.evaluate(()=>showExtractLogModal('1'));await row.locator('[data-python-extract-message]').filter({hasText:'گزارش محلی همین ردیف'}).waitFor();
  await child.evaluate(()=>resumeExtractQueue('one','1',999,true));
 }else{
  const row=page.locator('#extraction-jobs tr[data-extract-id="1"]');await row.waitFor();await row.locator('[data-extract-resume="1"]').click();await row.locator('[data-extract-row-message="1"]').filter({hasText:'یک مرحلهٔ واقعی اجرا شد'}).waitFor();
 }
 let after=await(await page.request.get(origin+'/__test__/extract-state')).json();const resumed=after.jobs.find(j=>j.id===1);assert.equal(resumed.payload._page,3);assert.equal(resumed.status,'waiting');assert.equal(after.jobs.length,before.jobs.length);assert.deepEqual(after.jobs.filter(j=>j.id!==1),before.jobs.filter(j=>j.id!==1));assert.equal(page.url(),url);assert.equal((await(await page.request.get(origin+'/__test__/source-calls')).json()).urls.length,1);assert.deepEqual(actions,['python_extract_resume']);
 // Immediate explicit retry is throttled, and feedback remains in that row.
 if(route==='/php-ui'){const row=f.locator('[data-python-extract-id="1"]');await row.locator('[data-python-extract-continue="1"]').waitFor();await row.locator('[data-python-extract-continue="1"]').click();await row.locator('[data-python-extract-message]').filter({hasText:'۴۵ ثانیه'}).waitFor();}
 else{const row=page.locator('#extraction-jobs tr[data-extract-id="1"]');await row.locator('[data-extract-resume="1"]').click();await row.locator('[data-extract-row-message="1"]').filter({hasText:'۴۵ ثانیه'}).waitFor();}
 assert.equal((await(await page.request.get(origin+'/__test__/source-calls')).json()).urls.length,1);assert.deepEqual(errors,[]);
});

test('native resume denial and cancelled confirmation stay in row without false success or automatic retry',{timeout:60000},async t=>{
 const {page,origin}=await setup(t,'resume-denied',true);let accept=false;page.on('dialog',d=>accept?d.accept():d.dismiss());await page.goto(origin+'/php-ui');const f=page.frameLocator('#php-original-ui');await f.locator('html[data-s4-ready="1"]').waitFor();const child=page.frames().find(f=>f.url().endsWith('/php-ui/frame'));await child.evaluate(()=>switchMainTab('start'));const row=f.locator('[data-python-extract-id="1"]');await row.waitFor();
 await row.locator('button[onclick*="resumeExtractQueue"]').click();await row.locator('[data-python-extract-message]').filter({hasText:'لغو شد'}).waitFor();assert.equal((await(await page.request.get(origin+'/__test__/source-calls')).json()).urls.length,0);
 accept=true;await row.locator('button[onclick*="resumeExtractQueue"]').click();await row.locator('[data-python-extract-message]').filter({hasText:'403'}).waitFor();assert.ok(!(await row.innerText()).includes('PRIVATE-FIXTURE-TOKEN'));await page.waitForTimeout(3500);assert.equal((await(await page.request.get(origin+'/__test__/source-calls')).json()).urls.length,1);assert.equal((await(await page.request.get(origin+'/__test__/extract-state')).json()).jobs.find(j=>j.id===1).status,'failed');assert.equal(await page.locator('#settings-menu').evaluate(e=>e.open),false);
});
