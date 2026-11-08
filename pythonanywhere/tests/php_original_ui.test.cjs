const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..'),env={...process.env,PYTHONPATH:path.join(root,'pythonanywhere')};
const boot=`
import json,sys
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
base=Path(sys.argv[1]);app=create_app(Settings(base_dir=base,db_path=base/'ui.db',secret_key='ui',password='test'));db=app.extensions['s4_db']
db.put_config('woocommerce',{'store_url':'https://store.example','consumer_key':'private-key','consumer_secret':'private-secret'});db.put_config('basalam',{'vendor_id':'10','token':'private-bsl','category_id':'3','vendors':[{'vendor_id':'20','token':'private-second','category_id':'4'}]})
p=db.upsert_profile('one','https://example.com/shop','اول');db.upsert_product(p['id'],'a',{'title':'محصول خام','price_num':1000,'price':'1000 تومان'});db.mark_product_target(db.list_products(p['id'])[0]['id'],'woo',77)
c=app.test_client()
with c.session_transaction() as s:s['authenticated']=True;s['csrf']='ui-csrf'
print(json.dumps({'html':c.get('/php-ui/frame').text,'host':c.get('/php-ui').text},ensure_ascii=False))
`;
const bridge=`
import json,sys
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
base=Path(sys.argv[1]);req=json.loads(sys.argv[2]);app=create_app(Settings(base_dir=base,db_path=base/'ui.db',secret_key='ui',password='test'));c=app.test_client()
with c.session_transaction() as s:s['authenticated']=True;s['csrf']='ui-csrf'
from scraper4.services.scraping.fetch import HtmlFetcher
HtmlFetcher.get=staticmethod(lambda url,**kw:{'html':'<article class=product><h2>Fixture</h2><span class=price>1000</span></article>','url':url,'code':200,'render_error':'','ok':True})
r=c.open(req['url'],method=req.get('method','POST'),json=req.get('body'),headers={'X-CSRF-Token':'ui-csrf'})
print(json.dumps({'status':r.status_code,'data':r.json},ensure_ascii=False))
`;
const script=name=>fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static',name),'utf8');
function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'original-php-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const seed=JSON.parse(execFileSync('python3',['-c',boot,dir],{cwd:root,env,encoding:'utf8',maxBuffer:16000000}));
 const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',e=>{if(!e.message.includes('Could not parse CSS'))errors.push(e.message);});
 const dom=new JSDOM(seed.html,{url:'https://example.test/php-ui/frame',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});t.after(()=>dom.window.close());
 const w=dom.window;w.setTimeout=()=>1;w.setInterval=()=>1;w.confirm=()=>false;w.scrollTo=()=>{};w.requestAnimationFrame=()=>1;w.postMessage=()=>{};w.matchMedia=()=>({matches:false,addEventListener(){}});
 w.eval(script('php-ui-frame.js'));w.eval([...w.document.querySelectorAll('script:not([src])')].map(s=>s.textContent).join('\n')+'\n'+script('php-ui-attach.js')+'\nwindow.__inspect=()=>({currentProfileKey,profiles,profileFormReady,dirty:window._profileProductsDirty,cleared:window._userClearedProducts,pruned:window._userPrunedProducts});');
 const request=(url,body,method='POST')=>JSON.parse(execFileSync('python3',['-c',bridge,dir,JSON.stringify({url,body,method})],{cwd:root,env,encoding:'utf8',maxBuffer:16000000}));
 const flush=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
 return {w,d:w.document,seed,request,flush,errors};
}

test('both full original scripts boot against their original markup; tabs and hamburger use original functions',t=>{
 const {w,d,errors}=setup(t);assert.equal(w._jsOk,true);w.switchMainTab('settings');assert.ok(d.querySelector('#pane-settings').classList.contains('active'));
 w.toggleSettingsPanel();assert.ok(d.querySelector('#settingsPanel').classList.contains('open'));w.toggleSettingsPanel();assert.ok(!d.querySelector('#settingsPanel').classList.contains('open'));
 w.renderProfileDropdown();assert.ok(d.querySelector('#hdrProfileSelect option[value="one"]'));assert.deepEqual(errors,[]);
});

test('isolated storage and font/fx boot APIs work without granting origin storage or server writes',t=>{
 const {w,d}=setup(t);w.localStorage.setItem('x','value');assert.equal(w.localStorage.getItem('x'),'value');w.setAppFont('sahel');assert.match(d.documentElement.style.getPropertyValue('--app-font'),/Sahel/);
 w.appFontApply('url(https://evil.test)');assert.match(d.documentElement.style.getPropertyValue('--app-font'),/Vazirmatn/);w.appFxApply('off');assert.equal(d.documentElement.dataset.fx,'off');
});

test('original selection/results/save flow works with actual Flask compatibility APIs and preserves raw price/remote ID',async t=>{
 const e=setup(t),{w,d}=e,revisions=new Map(),calls=[];
 w.fetch=async(input,opts={})=>{
  const query=Object.fromEntries(new URL(input||'',w.location.href).searchParams),fields=Object.fromEntries(opts.body?.entries?.()||[]),action=fields.action||query.action||Object.keys(query).find(k=>!k.startsWith('_'));
  const write=['save_profile','python_enqueue'].includes(action),body={action,query,fields};if(action==='save_profile')body.revision=revisions.get(fields.target_key)||null;
  const r=e.request('/api/php-ui/'+(write?'write':'read'),body);calls.push({action,status:r.status,error:r.data.error,...(action==='save_profile'?{fields}: {})});if(r.data.key&&r.data.revision)revisions.set(r.data.key,r.data.revision);
  return {ok:r.status<300,status:r.status,json:async()=>r.data,text:async()=>JSON.stringify(r.data)};
 };
 w.selectProfile('one');await e.flush();assert.equal(d.querySelector('#profileName').value,'اول');assert.equal(w.collectProfileData(true).products.length,1);assert.equal(w.collectProfileData(true).products[0][1].woo_id,77);
 d.querySelector('#titleSuffix').value='پایتون';d.querySelector('#priceMode').value='percent';d.querySelector('#priceVal').value='15';w.saveProfile();await e.flush();
 assert.ok(calls.some(x=>x.action==='save_profile'&&x.status===200),JSON.stringify({calls,state:w.__inspect()}));
 const loaded=e.request('/api/php-ui/read',{action:'load_profile',query:{load_profile:'one'},fields:{}}).data;
 assert.equal(loaded.profile.titleSuffix,'پایتون');assert.equal(loaded.profile.priceVal,15);assert.equal(loaded.profile.products[0][1].price_num,1000);assert.equal(loaded.profile.products[0][1].woo_id,77);
 await w.backendExtractFor();await e.flush();assert.ok(calls.some(x=>x.action==='python_enqueue'&&x.status===200));assert.deepEqual(e.errors,[]);
});

test('original statistics renderer accepts real local metrics without inventing remote matrix inventory',t=>{
 const {w,d,request}=setup(t),data=request('/api/php-ui/read',{action:'start_product_stats',query:{},fields:{}}).data;
 assert.equal(data.totals.total,1);assert.equal(data.remote_inventory,false);assert.equal(data.matrix.destinations.length,0);
 w.renderStartProfileBreakdown(data);assert.match(d.querySelector('#startProfileBreakdownBody').textContent,/اول/);assert.match(d.querySelector('#startProfileBreakdownMeta').textContent,/ذخیره‌شده/);
});

test('frame broker verifies parent source and origin before resolving requests',async t=>{
 const e=setup(t),dom=new JSDOM('<iframe src="https://example.test/php-ui/frame"></iframe>',{url:'https://example.test/php-ui',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window.document.querySelector('iframe').contentWindow;let outgoing;dom.window.postMessage=m=>{outgoing=m;};w.document.open();w.document.write('<html><head></head><body></body></html>');w.document.close();w.setTimeout=()=>1;w.eval(script('php-ui-frame.js'));const flush=e.flush;let done=false;
 const promise=w.fetch('?app_ready=1').then(r=>r.json()).then(x=>{done=true;return x;});assert.ok(outgoing);
 w.dispatchEvent(new w.MessageEvent('message',{source:w,origin:'https://evil.test',data:{type:'s4-php-response',id:outgoing.id,status:200,data:{ok:true}}}));await flush();assert.equal(done,false);
 w.dispatchEvent(new w.MessageEvent('message',{source:dom.window,origin:'https://example.test',data:{type:'s4-php-response',id:outgoing.id,status:200,data:{ok:true}}}));assert.equal((await promise).ok,true);
 const failed=w.fetch('?cron_run=1');w.dispatchEvent(new w.MessageEvent('message',{source:dom.window,origin:'https://example.test',data:{type:'s4-php-response',id:outgoing.id,status:501,data:{ok:false,error:'Not attached'}}}));await assert.rejects(failed,/Not attached/);
});

test('trusted parent rejects foreign sources, unsupported cron/remote requests and cancelled writes',async t=>{
 const e=setup(t),dom=new JSDOM(e.seed.host,{url:'https://example.test/php-ui',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,frame=w.document.querySelector('iframe'),answers=[],calls=[];frame.contentWindow.postMessage=m=>answers.push(m);w.confirm=()=>false;w.fetch=async(...args)=>{calls.push(args);throw Error('must not forward');};w.eval(script('php-ui-host.js'));
 const send=async(data,source=frame.contentWindow,origin='null')=>{w.dispatchEvent(new w.MessageEvent('message',{source,origin,data:{type:'s4-php-request',id:'r1',method:'GET',url:'?app_ready=1',fields:{},...data}}));await e.flush();};
 await send({},w,'https://evil.test');assert.equal(answers.length,0);
 await send({url:'?cron_run=1'});assert.equal(answers.pop().status,501);assert.equal(calls.length,0);
 await send({url:'https://evil.test/?load_profile=one'});assert.equal(answers.pop().status,400);
 await send({url:'',method:'POST',fields:{action:'save_profile',name:'A',url:'https://example.com'}});assert.equal(answers.pop().status,409);assert.equal(calls.length,0);
});

test('trusted parent forwards approved saves with CSRF and stored revision through real Flask API',async t=>{
 const e=setup(t),dom=new JSDOM(e.seed.host,{url:'https://example.test/php-ui',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,frame=w.document.querySelector('iframe'),answers=[],calls=[];frame.contentWindow.postMessage=m=>answers.push(m);w.confirm=()=>true;
 w.fetch=async(url,opts)=>{calls.push({url,opts});const r=e.request(url,JSON.parse(opts.body));return {status:r.status,json:async()=>r.data};};w.eval(script('php-ui-host.js'));
 const send=async(url,fields={})=>{w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:'null',data:{type:'s4-php-request',id:'r',method:fields.action?'POST':'GET',url,fields}}));await e.flush();return answers.pop();};
 const loaded=await send('?load_profile=one');assert.equal(loaded.status,200);
 const saved=await send('',{action:'save_profile',target_key:'one',name:'نام تازه',url:'https://example.com/shop',selectors:'{}',detailSelectors:'{}'});assert.equal(saved.status,200);assert.equal(saved.data.products_changed,false);
 const req=calls.find(c=>c.url==='/api/php-ui/write');assert.equal(req.opts.headers['X-CSRF-Token'],'ui-csrf');assert.equal(JSON.parse(req.opts.body).revision,loaded.data.revision);
});

function connectNative(e){const {w}=e,calls=[],revisions=new Map();w.fetch=async(input,opts={})=>{
 const query=Object.fromEntries(new URL(input||'',w.location.href).searchParams),fields=Object.fromEntries(opts.body?.entries?.()||[]),action=fields.action||query.action||Object.keys(query).find(k=>!k.startsWith('_'));
 const write=['save_profile','python_enqueue','python_send_enqueue','python_manual_sync','python_queue_control','python_queue_clear','python_profile_duplicate','python_profile_delete'].includes(action),body={action,query,fields};if(action==='save_profile')body.revision=revisions.get(fields.target_key)||null;
 if(action==='python_open_panel'){calls.push({action,fields});return {ok:true,status:200,json:async()=>({ok:true})};}
 const r=e.request('/api/php-ui/'+(write?'write':'read'),body);calls.push({action,fields,status:r.status});if(r.data.key&&r.data.revision)revisions.set(r.data.key,r.data.revision);
 return {ok:r.status<300,status:r.status,headers:{get:()=> 'application/json'},json:async()=>r.data,text:async()=>JSON.stringify(r.data)};};return calls;}

test('actual send buttons enqueue both destinations, native queues render real rows, pause/cancel/clear work',async t=>{
 const e=setup(t),{w,d}=e,calls=connectNative(e);w.selectProfile('one');w.loadConn();await e.flush();
 await w.sendWoo();await e.flush();assert.ok(calls.some(c=>c.action==='python_send_enqueue'&&c.fields.target==='woo'&&c.status===200),JSON.stringify(calls));assert.match(d.querySelector('#wooQueueList').textContent,/اول/);
 await w.sendBsl();await e.flush();assert.ok(calls.some(c=>c.action==='python_send_enqueue'&&c.fields.target==='bsl'&&c.fields.vendor_ids==='["10","20"]'&&c.status===200),JSON.stringify(calls));
 await w.wooStop();await e.flush();const q=e.request('/api/php-ui/read',{action:'woo_queue_status',fields:{},query:{}}).data;assert.equal(q.entries[0].status,'paused');
 await w.deleteWooQueue(q.entries[0].id);await e.flush();assert.equal(e.request('/api/php-ui/read',{action:'woo_queue_status',fields:{},query:{}}).data.entries[0].status,'cancelled');
 await w.clearWooQueueDone();await e.flush();assert.equal(e.request('/api/php-ui/read',{action:'woo_queue_status',fields:{},query:{}}).data.entries.length,0);assert.deepEqual(e.errors,[]);
});

test('actual manual-sync, duplicate and delete controls use normalized real contracts, never copy products',async t=>{
 const e=setup(t),{w,d}=e,calls=connectNative(e);w.selectProfile('one');await e.flush();w.prompt=()=> 'کپی واقعی';await w.openDuplicateProfileModal();await e.flush();
 const all=e.request('/api/profiles',undefined,'GET').data.profiles,copy=all.find(p=>p.name==='کپی واقعی');assert.ok(copy);assert.equal(e.request('/api/products?profile_id='+copy.id,undefined,'GET').data.total,0);
 const remove=d.createElement('button');remove.dataset.delProfile=copy.key;await w.deleteStartBreakdownProfile(remove);await e.flush();assert.equal(e.request('/api/profiles',undefined,'GET').data.profiles.length,1);
 d.querySelector('#profileSyncTarget').value='none';d.querySelector('#profileSyncNoExtract').checked=false;await w.startManualSync();await e.flush();assert.ok(calls.some(c=>c.action==='python_manual_sync'&&c.status===200));
 const task=e.request('/api/php-ui/read',{action:'tasks_list',fields:{},query:{}}).data.tasks[0];await w.tmStop(task.key);await e.flush();assert.equal(e.request('/api/jobs',undefined,'GET').data.jobs[0].status,'paused');
 await w.tmResume(task.key);assert.ok(calls.some(c=>c.action==='python_open_panel'&&c.fields.panel==='guardian'));assert.deepEqual(e.errors,[]);
});

async function trustedHost(t){const e=setup(t),dom=new JSDOM(e.seed.host,{url:'https://example.test/php-ui',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document,calls=[],errors=[];
 w.setTimeout=()=>1;w.setInterval=()=>1;w.confirm=()=>true;w.HTMLElement.prototype.scrollIntoView=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};w.addEventListener('error',e=>errors.push(e.message));
 const frame=d.querySelector('iframe'),answers=[],childMessages=[];frame.contentWindow.postMessage=m=>{answers.push(m);childMessages.push(m);};
 w.fetch=async(url,opts={})=>{const body=opts.body?JSON.parse(opts.body):undefined;calls.push({url,opts,body});const r=e.request(url,body,opts.method||'GET');return {ok:r.status<300,status:r.status,json:async()=>r.data};};
 for(const el of d.querySelectorAll('script[src]'))w.eval(script(new URL(el.src).pathname.split('/').pop()));await e.flush();
 const send=async fields=>{w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:'null',data:{type:'s4-php-request',id:'trusted',url:'',method:'POST',fields}}));await e.flush();return answers.pop();};
 return {...e,w,d,calls,errors,send,answers,childMessages,frame};}

test('all trusted host controllers boot; original hamburger messages open real same-page panels; secrets never return to child',async t=>{
 const e=await trustedHost(t),{w,d}=e;assert.deepEqual(e.errors,[]);
 const selected=e.request('/api/php-ui/read',{action:'load_profile',query:{load_profile:'one'},fields:{}}).data.profile;w.S4NativeTools.select(selected);await e.flush();
 for(const key of ['woocommerce','basalam','backup','general','version','render','guardian','profile-stats']){const answer=await e.send({action:'python_open_panel',panel:key});assert.equal(answer.status,200,key);assert.ok(d.querySelector('#settings-menu').open);assert.ok(d.querySelector(`[data-menu-key="${key}"]`).open);d.querySelector('#settings-menu-close').click();}
 assert.ok(!e.calls.some(c=>c.url==='/api/worker-runtime/enable'||c.url==='/api/cron/run'));
 for(const key of ['profile','selectors','audit','results']){assert.equal((await e.send({action:'python_open_panel',panel:key})).status,200);assert.equal(d.querySelector(`[data-python-tool=${key}]`).hidden,false);assert.ok(d.querySelector('#php-tools').open);d.querySelector('#php-tools-close').click();}
 assert.equal((await e.send({action:'python_open_panel',panel:'arbitrary-url'})).status,400);
 assert.ok(!JSON.stringify(e.childMessages).includes('private-secret'));assert.ok(!e.calls.some(c=>(c.opts.method||'GET')!=='GET'&&!c.url.startsWith('/api/php-ui/read')));assert.deepEqual(e.errors,[]);
});

test('trusted same-page Woo save, profile preview/save, selector lab and paginated product detail use actual Flask APIs',async t=>{
 const e=await trustedHost(t),{w,d}=e;const selected=e.request('/api/php-ui/read',{action:'load_profile',query:{load_profile:'one'},fields:{}}).data.profile;w.S4NativeTools.select(selected);await e.flush();
 const submit=async id=>{d.querySelector(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await e.flush();};
 w.S4NativeTools.open('woocommerce');const wc=d.querySelector('#connection-woocommerce');wc.elements.store_url.value='https://new-store.example';wc.elements.consumer_key.value='new-key';wc.elements.consumer_secret.value='new-private-secret';await submit('#connection-woocommerce');assert.match(d.querySelector('#menu-message').textContent,/ذخیره/);d.querySelector('#settings-menu-close').click();
 w.S4NativeTools.open('profile');const form=d.querySelector('#profile-options-form');form.elements.titleSuffix.value='پیشوند';form.elements.titleSuffix.dispatchEvent(new w.Event('input',{bubbles:true}));d.querySelector('#profile-options-preview').click();await e.flush();assert.ok(e.calls.some(c=>c.url==='/api/profile-settings/1/preview'));assert.match(d.querySelector('#profile-options-message').textContent,/پیش‌نمایش/);await submit('#profile-options-form');assert.equal(e.request('/api/profile-settings/1',undefined,'GET').data.options.titleSuffix,'پیشوند');d.querySelector('#php-tools-close').click();
 w.S4NativeTools.open('selectors');const lab=d.querySelector('#profile-form');lab.elements.container.value='.product';lab.elements.title.value='h2';d.querySelector('#selector-test-list').click();await e.flush();assert.match(d.querySelector('#selector-test-result').textContent,/Fixture/);d.querySelector('#php-tools-close').click();
 w.S4NativeTools.open('results');await e.flush();assert.equal(d.querySelectorAll('.product-card').length,1,d.querySelector('#products-status').textContent);d.querySelector('.product-detail-button').click();await e.flush();assert.ok(d.querySelector('#product-detail').open);assert.ok(e.calls.some(c=>c.url==='/api/products/1'));assert.deepEqual(e.errors,[]);
});

test('parent guards dirty profile options and ignores late selections; unknown panel keys cannot access inherited properties',async t=>{
 const e=await trustedHost(t),{w,d}=e,selected=[];let allow=false;w.S4ProfileOptions={canSwitch:()=>allow};w.S4NativeTools.select=p=>selected.push(p.id);
 const original=w.fetch;const pending=[];w.fetch=(url,opts)=>{const body=JSON.parse(opts.body);if(body.action==='load_profile')return new Promise(resolve=>pending.push({body,resolve}));return original(url,opts);};
 const send=key=>{w.dispatchEvent(new w.MessageEvent('message',{source:e.frame.contentWindow,origin:'null',data:{type:'s4-php-request',id:key,url:'?load_profile='+key,method:'GET',fields:{}}}));};
 send('one');await e.flush();assert.equal(e.answers.pop().status,409);assert.equal(pending.length,0);
 allow=true;send('one');send('two');await e.flush();assert.equal(pending.length,2);
 pending[1].resolve({ok:true,status:200,json:async()=>({ok:true,key:'two',revision:'r2',profile:{id:2}})});await e.flush();
 pending[0].resolve({ok:true,status:200,json:async()=>({ok:true,key:'one',revision:'r1',profile:{id:1}})});await e.flush();assert.deepEqual(selected,[2]);
 assert.equal((await e.send({action:'python_open_panel',panel:'constructor'})).status,400);assert.equal(d.querySelector('#php-tools').open,false);
});
