const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{JSDOM}=require('jsdom');const root=path.resolve(__dirname,'../..'),env={...process.env,PYTHONPATH:path.join(root,'pythonanywhere')};
const boot=`
import json,sys
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
from scraper4.services.profile_options import DEFAULTS
base=Path(sys.argv[1]);app=create_app(Settings(base_dir=base,db_path=base/'ui.db',secret_key='ui',password='test'));db=app.extensions['s4_db']
db.upsert_profile('one','https://example.com','اول');db.upsert_profile('two','https://example.org','دوم')
c=app.test_client()
with c.session_transaction() as s:s['authenticated']=True;s['csrf']='ui-csrf'
print(json.dumps({'html':c.get('/').text,'options':DEFAULTS}))
`;
const bridge=`
import json,sys
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
base=Path(sys.argv[1]);req=json.loads(sys.argv[2]);app=create_app(Settings(base_dir=base,db_path=base/'ui.db',secret_key='ui',password='test'));c=app.test_client()
with c.session_transaction() as s:s['authenticated']=True;s['csrf']='ui-csrf'
r=c.open(req['url'],method=req.get('method','GET'),json=req.get('body'),headers={'X-CSRF-Token':'ui-csrf'})
print(json.dumps({'status':r.status_code,'data':r.json}))
`;
function setup(t,scripts,real=false){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'menu-profile-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const seed=JSON.parse(execFileSync('python3',['-c',boot,dir],{cwd:root,env,encoding:'utf8'})),dom=new JSDOM(seed.html,{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,d=w.document,calls=[],errors=[];w.confirm=()=>true;w.setInterval=()=>0;w.setTimeout=()=>0;w.clearTimeout=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.addEventListener('error',e=>errors.push(e.message));const e={w,d,calls,seed,errors};
  e.reply=async(url,options={},body)=>{
    if(real){const out=JSON.parse(execFileSync('python3',['-c',bridge,dir,JSON.stringify({url,method:options.method||'GET',body})],{cwd:root,env,encoding:'utf8'}));return {...out.data,...(out.status>=400?{httpError:out.status}:{})};}
    if(url.includes('/api/profile-settings/')){if(url.endsWith('/preview'))return {ok:true,profile_price:120000,woo_price:120000};if(url.endsWith('/cleanup-preview'))return {ok:true,count:2,proof:'signed'};if(url.endsWith('/cleanup'))return {ok:true,removed:2};return {ok:true,options:seed.options,name:url.endsWith('/1')?'اول':'دوم',active:true};}
    if(url==='/api/profiles')return {ok:true,profiles:[]};if(url==='/api/system/status')return {runtime:{},platform:{},updates:{config:{enabled:true},state:{}}};
    if(url.startsWith('/api/connections/'))return {ok:true,fields:{},credential_status:{}};if(url==='/api/deploy/config')return {config:{enabled:true},ready:true};
    if(url==='/api/cron/config')return {config:{public_get:true}};if(url==='/api/products?filter=gallery&limit=50&offset=0&summary=1')return {ok:true,products:[{id:1,title:'کالا',price:'100'}],total:1,offset:0};
    if(url==='/api/extraction/diagnostics')return {ok:true,read_only:true,jobs:[{error_code:'source_access_denied'}]};return {ok:true};
  };
  w.fetch=async(url,options={})=>{const body=options.body?JSON.parse(options.body):undefined;calls.push({url,options,body});const data=await e.reply(url,options,body);return {ok:!data.httpError,status:data.httpError||200,json:async()=>data};};
  d.querySelector('#start-profile').value='1';
  e.eval=name=>w.eval(fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static',name),'utf8'));
  for(const script of scripts)e.eval(script);
  e.flush=async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate);};e.submit=async selector=>{d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await e.flush();};
  e.input=(name,value)=>{const el=d.querySelector('#profile-options-form').elements[name];el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));};return e;
}

test('hamburger renders and operates actual global forms without changing the active tab',async t=>{
  const e=setup(t,['menu.js','global-settings.js']);await e.flush();e.w.S4Menu.open('woocommerce');assert.equal(e.d.querySelector('#settings-menu').open,true);assert.equal(e.d.querySelector('[data-menu-key=woocommerce]').open,true);
  const form=e.d.querySelector('#connection-woocommerce');form.elements.store_url.value='https://example.org';form.elements.consumer_key.value='key';form.elements.consumer_secret.value='local-test-secret';await e.submit('#connection-woocommerce');
  const write=e.calls.find(c=>c.url==='/api/connections/woocommerce'&&c.options.method==='POST');assert.ok(write);assert.equal(write.options.headers['X-CSRF-Token'],'ui-csrf');assert.ok(e.d.querySelector('#pane-start').classList.contains('active'));assert.ok(!e.d.querySelector('#pane-settings #connection-woocommerce'));
  assert.match(e.d.querySelector('#menu-message').textContent,/ذخیره/);
});

test('menu mounts original queue nodes, preserves drafts, restores nodes on close',async t=>{
  const e=setup(t,['menu.js']);const original=e.d.querySelector('#queue-panel'),parent=original.parentNode,field=e.d.querySelector('#connection-woocommerce [name=consumer_key]');field.value='draft';
  e.w.S4Menu.open('guardian');assert.equal(e.d.querySelector('#settings-menu #queue-panel'),original);assert.equal(e.d.querySelector('#settings-menu').open,true);
  e.d.querySelector('#settings-menu-close').click();assert.equal(original.parentNode,parent);assert.equal(field.value,'draft');
});

test('metrics opened inside hamburger stay inside menu, not navigation to hidden tab',async t=>{
  const e=setup(t,['menu.js']);e.w.S4Menu.open('profile-stats');assert.equal(e.w.S4Menu.browse('gallery','',''),true);await e.flush();assert.match(e.d.querySelector('#menu-product-results').textContent,/کالا/);assert.ok(e.d.querySelector('#settings-menu').open);
});

test('profile save and preview are scoped to selected id and never use connections endpoint',async t=>{
  const e=setup(t,['profile-settings.js']);await e.flush();e.input('priceMode','percent');e.input('priceVal','20');e.input('titleSuffix','فروشگاه');
  await e.submit('#profile-options-form');const call=e.calls.find(c=>c.options.method==='POST');assert.equal(call.url,'/api/profile-settings/1');assert.equal(call.body.priceVal,20);assert.equal(call.body.titleSuffix,'فروشگاه');
  e.d.querySelector('#profile-options-preview').click();await e.flush();assert.match(e.d.querySelector('#profile-options-result').textContent,/120000/);assert.ok(!e.calls.some(c=>c.url.includes('/connections/')));
});

test('profile draft blocks a switch when consent is declined and cleanup is explicitly confirmed',async t=>{
  const e=setup(t,['profile-settings.js']);await e.flush();e.input('titleSuffix','پیش‌نویس');e.w.confirm=()=>false;assert.equal(e.w.S4ProfileOptions.canSwitch(),false);
  assert.equal(e.d.querySelector('#profile-options-form').elements.titleSuffix.value,'پیش‌نویس');
  e.d.querySelector('[data-profile-cleanup=no_price]').click();await e.flush();assert.ok(!e.calls.some(c=>c.url.endsWith('/cleanup-preview')));
  await e.submit('#profile-options-form');e.d.querySelector('[data-profile-cleanup=no_price]').click();await e.flush();assert.ok(e.calls.some(c=>c.url.endsWith('/cleanup-preview')));assert.ok(!e.calls.some(c=>c.url.endsWith('/cleanup')));
  e.w.confirm=()=>true;e.d.querySelector('[data-profile-cleanup=no_price]').click();await e.flush();assert.equal(e.calls.find(c=>c.url.endsWith('/cleanup')).body.proof,'signed');
});

test('local fonts default to Vazirmatn and user selection persists with a strict font allowlist',async t=>{
  const e=setup(t,['fonts.js']);assert.match(e.d.documentElement.style.getPropertyValue('--app-font'),/Vazirmatn/);
  const select=e.d.querySelector('#app-font');select.value='sahel';select.dispatchEvent(new e.w.Event('change'));assert.equal(e.w.localStorage.getItem('s4-app-font'),'sahel');assert.match(e.d.documentElement.style.getPropertyValue('--app-font'),/Sahel/);
  e.w.localStorage.setItem('s4-app-font','url(https://bad.test)');e.eval('fonts.js');assert.match(e.d.documentElement.style.getPropertyValue('--app-font'),/Vazirmatn/);
});

test('diagnosis is read-only and displays structured safe errors inside the guardian',async t=>{
  const e=setup(t,['menu.js','global-settings.js']);await e.flush();e.w.S4Menu.open('guardian');e.d.querySelector('#extraction-diagnose').click();await e.flush();assert.match(e.d.querySelector('#extraction-diagnostics').textContent,/source_access_denied/);
  assert.equal(e.calls.filter(c=>c.url==='/api/extraction/diagnostics').length,1);assert.ok(!e.calls.some(c=>c.url.includes('/cron/run')));
});

test('all actual dashboard controllers work together against real Flask APIs with in-menu profile pricing preview',async t=>{
  const names=['menu.js','fonts.js','global-settings.js','platform.js','worker-runtime.js','basalam-shops.js','settings-transfer.js','app.js','product-browser.js','selector-preview.js','extraction-control.js','extraction-audit.js','start.js','profile-settings.js'];
  const e=setup(t,names,true);await e.flush();assert.deepEqual(e.errors,[]);assert.equal(e.d.querySelectorAll('.start-metric').length,16);
  e.w.S4Menu.open('general');assert.equal(e.d.querySelector('[data-menu-key=general]').open,true);assert.ok(e.d.querySelector('#settings-menu #platform-form'));
  e.d.querySelector('#settings-menu-close').click();e.d.querySelector('#tab-settings').click();assert.ok(e.d.querySelector('#pane-settings').classList.contains('active'));e.input('priceMode','percent');e.input('priceVal','20');await e.submit('#profile-options-form');assert.match(e.d.querySelector('#profile-options-message').textContent,/ذخیره شد/);
  e.d.querySelector('#profile-options-preview').click();await e.flush();assert.match(e.d.querySelector('#profile-options-result').textContent,/120000/);assert.deepEqual(e.errors,[]);
});
