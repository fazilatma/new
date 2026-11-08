// NODE_PATH=tools/ui-tests/node_modules node --test pythonanywhere/tests/start_ui.test.cjs
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..'),env={...process.env,PYTHONPATH:path.join(root,'pythonanywhere')};
const bootstrap=`
import json,sys
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
base=Path(sys.argv[1]);app=create_app(Settings(base_dir=base,db_path=base/'ui.sqlite',secret_key='start-ui',password='test'))
db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com/shop','فروشگاه اول',selectors={'container':'.card'},settings={'detailSelectors':{'longDesc':'.desc'},'startPages':0})
db.upsert_profile('two','https://example.org/shop','فروشگاه دوم')
db.upsert_product(p['id'],'a',{'title':'کالا','price_num':100,'link':'https://example.com/a','extra':{'images':['https://example.com/a.jpg','https://example.com/b.jpg'],'stock':3}})
db.put_config('basalam',{'vendor_id':'7','token':'never-echo','shop_name':'غرفه اول'})
client=app.test_client()
with client.session_transaction() as s:s['authenticated']=True;s['csrf']='start-ui-csrf'
print(json.dumps({'html':client.get('/').text,'overview':client.get('/api/start/overview').json,'profiles':client.get('/api/profiles').json['profiles'],'vendors':client.get('/api/basalam/vendors').json['vendors']}))
`;
const bridge=`
import json,sys
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
base=Path(sys.argv[1]);req=json.loads(sys.argv[2]);app=create_app(Settings(base_dir=base,db_path=base/'ui.sqlite',secret_key='start-ui',password='test'));client=app.test_client()
with client.session_transaction() as s:s['authenticated']=True;s['csrf']='start-ui-csrf'
r=client.open(req['url'],method=req.get('method','GET'),json=req.get('body'),headers={'X-CSRF-Token':'start-ui-csrf'})
print(json.dumps({'status':r.status_code,'data':r.json}))
`;
function setup(t,real=false,stored={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'start-ui-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const seed=JSON.parse(execFileSync('python3',['-c',bootstrap,dir],{cwd:root,env,encoding:'utf8'}));
  const dom=new JSDOM(seed.html,{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,d=w.document,calls=[],browses=[],intervals=[];w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.confirm=()=>true;w.setInterval=(fn,ms)=>{intervals.push({fn,ms});return 0;};
  for(const [key,v]of Object.entries(stored))w.localStorage.setItem(key,v);
  const e={w,d,calls,browses,intervals,seed,real};let profiles=structuredClone(seed.profiles),id=2;
  w.S4Browse=(...args)=>browses.push(args);
  e.reply=async(url,options={})=>{
    const method=options.method||'GET',body=options.body?JSON.parse(options.body):undefined;
    if(real&&(/^\/api\/start\//.test(url)||url==='/api/profiles'||url==='/api/basalam/vendors'||url.startsWith('/api/products?'))){const r=JSON.parse(execFileSync('python3',['-c',bridge,dir,JSON.stringify({url,method,body})],{cwd:root,env,encoding:'utf8'}));return {...r.data,...(r.status>=400?{httpError:r.status}:{})};}
    if(url==='/api/profiles')return {ok:true,profiles};
    if(url==='/api/start/overview'||url==='/api/start/snapshot')return seed.overview;
    if(url==='/api/basalam/vendors')return {ok:true,vendors:seed.vendors};
    if(url==='/api/start/profile'){
      const old=profiles.find(p=>p.id===body.id),p={...old,id:old?.id||++id,key:old?.key||'new',name:body.name,url:body.url,pagination:body.pagination,settings:{...(old?.settings||{}),extractionEngine:body.engine,startPages:body.pages,startWithDetail:body.with_detail,detailExtractMode:body.detail_mode,productSource:body.source,sourceGithub:body.github}};profiles=profiles.filter(v=>v.id!==p.id);profiles.push(p);return {ok:true,profile:p};
    }
    if(url==='/api/start/enqueue')return {ok:true,id:44};
    if(url==='/api/extraction/probe')return {ok:true,report:{status:'passed',count:3}};
    if(url.includes('/pause'))return {ok:true,paused:1};
    if(url==='/api/start/queues/clear-finished')return {ok:true,removed:2};
    if(url.startsWith('/api/pagination/preview'))return {ok:true,urls:['https://example.com/shop','https://example.com/shop?page=2','https://example.com/shop?page=3']};
    return {ok:true};
  };
  w.fetch=async(url,options={})=>{calls.push({url,options,body:options.body?JSON.parse(options.body):undefined});const data=await e.reply(url,options);return {ok:!data.httpError,status:data.httpError||200,json:async()=>data};};
  w.eval(fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static/start.js'),'utf8'));
  e.flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
  e.input=(name,value,type='input')=>{const element=d.querySelector('#start-profile-form').elements[name];element.value=value;element.dispatchEvent(new w.Event(type,{bubbles:true}));};
  e.click=async(selector)=>{d.querySelector(selector).click();await e.flush();};
  e.submit=async(selector)=>{d.querySelector(selector).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await e.flush();};
  return e;
}

test('PHP-order Start controls, 16 real cards, counts, detail and profile drilldowns',async t=>{
  const e=setup(t);await e.flush();assert.equal(e.d.querySelectorAll('.start-metric').length,16);
  assert.equal(e.d.querySelector('#start-profile').value,'2'); // most recently created profile
  await e.click('.start-metric[data-metric=gallery]');assert.equal(e.browses.at(-1)[0],'gallery');
  assert.equal(e.d.querySelector('#products-filter option[value=gallery]').textContent,'دارای گالری');
  assert.match(e.d.querySelector('#start-breakdown-body').textContent,/فروشگاه اول/);
  assert.equal(e.d.querySelectorAll('#start-breakdown-head th').length,9);
  assert.equal(e.d.querySelectorAll('#start-sync-vendor option').length,2);
  assert.match(e.d.querySelector('#start-overview-card').textContent,/موجودی زنده/);
  assert.ok(!e.calls.some(c=>(c.options.method||'GET')!=='GET'),'initial render must not enqueue, save or send');
});

test('profile switch fills correct existing record; URL edit updates same id and keeps selectors',async t=>{
  const e=setup(t);await e.flush();e.d.querySelector('#start-profile').value='1';e.d.querySelector('#start-profile').dispatchEvent(new e.w.Event('change',{bubbles:true}));
  assert.equal(e.d.querySelector('#start-profile-form').elements.pages.value,'0');
  e.input('url','https://example.com/new');await e.submit('#start-profile-form');
  const write=e.calls.find(c=>c.url==='/api/start/profile');assert.equal(write.body.id,1);assert.equal(write.body.pages,0);assert.equal(write.body.detail_mode,'two_stage');
  assert.match(e.d.querySelector('#start-action-status').textContent,/ذخیره شد/);
});

test('new profile saves before enqueue, correct page zero, no send without explicit destination',async t=>{
  const e=setup(t);await e.flush();await e.click('#start-new');e.input('name','جدید');e.input('url','https://example.com/new');e.input('pages','0');
  assert.equal(await e.w.S4Start.enqueue({render:'static'}),true);await e.flush();
  const writes=e.calls.filter(c=>c.options.method==='POST');assert.deepEqual(writes.map(c=>c.url),['/api/start/profile','/api/start/enqueue']);
  assert.equal(writes[0].body.id,null);assert.equal(writes[1].body.profile_id,3);assert.equal(writes[1].body.pages,0);assert.deepEqual(writes[1].body.send_after,[]);
  assert.ok(writes.every(c=>c.options.headers['X-CSRF-Token']==='start-ui-csrf'));
});

test('API auto-selection is host-safe and manually overridable',async t=>{
  const e=setup(t);await e.flush();e.input('url','https://www.digikala.com/search/','change');assert.equal(e.d.querySelector('[name=engine]').value,'digikala_api');
  e.input('engine','heuristic','change');assert.equal(e.d.querySelector('[name=engine]').value,'heuristic');
  e.input('url','https://basalam.com/shop','change');assert.equal(e.d.querySelector('[name=engine]').value,'basalam_api');
  e.input('engine','auto','change');e.input('url','https://basalam.com.attacker.test/','change');assert.equal(e.d.querySelector('[name=engine]').value,'auto');
});

test('dirty profile switch can be cancelled and collapse persists DOM/input values',async t=>{
  const e=setup(t,false,{'s4-start-collapse:start-range-card':'1'});await e.flush();
  const input=e.d.querySelector('[name=url]');assert.ok(e.d.querySelector('#start-range-card').classList.contains('start-collapsed'));
  await e.click('#start-range-card .start-collapse-toggle');e.input('name','ذخیره نشده');e.w.confirm=()=>false;
  const select=e.d.querySelector('#start-profile');select.value='1';select.dispatchEvent(new e.w.Event('change',{bubbles:true}));assert.equal(select.value,'2');assert.equal(e.d.querySelector('#start-profile-form').elements.name.value,'ذخیره نشده');
  await e.click('#start-range-card .start-collapse-toggle');assert.equal(e.w.localStorage.getItem('s4-start-collapse:start-range-card'),'1');assert.equal(e.d.querySelector('[name=url]'),input);
});

test('invalid hidden required field unfolds and prevents any profile or queue write',async t=>{
  const e=setup(t,false,{'s4-start-collapse:start-profile-card':'1'});await e.flush();e.input('name','');assert.equal(await e.w.S4Start.enqueue({render:'static'}),false);assert.ok(!e.calls.some(c=>c.options.method==='POST'));assert.ok(!e.d.querySelector('#start-profile-card').classList.contains('start-collapsed'));
});

test('manual sync requires destination + consent; pins shop and queues draft Woo',async t=>{
  const e=setup(t);await e.flush();await e.click('#start-sync');assert.ok(!e.calls.some(c=>c.url==='/api/start/enqueue'));
  e.d.querySelector('#start-sync-bsl').checked=true;e.d.querySelector('#start-sync-woo').checked=true;e.d.querySelector('#start-sync-vendor').value='7';e.w.confirm=()=>false;await e.click('#start-sync');assert.ok(!e.calls.some(c=>c.url==='/api/start/enqueue'));
  e.w.confirm=()=>true;await e.click('#start-sync');const body=e.calls.find(c=>c.url==='/api/start/enqueue').body;assert.deepEqual(body.send_after,[{kind:'woo_send',status:'draft'},{kind:'bsl_send',vendor_id:'7'}]);
});

test('pause and cleanup have explicit scope; no cron or sender invoked',async t=>{
  const e=setup(t);await e.flush();await e.click('#start-stop');await e.click('#start-sync-stop');await e.click('#start-clear-finished');
  assert.deepEqual(e.calls.filter(c=>c.url.endsWith('/pause')).map(c=>c.body),[{chain:false},{chain:true}]);assert.ok(e.calls.some(c=>c.url==='/api/start/queues/clear-finished'));
  assert.ok(!e.calls.some(c=>/\/api\/(cron\/run|extraction\/step|jobs)$/.test(c.url)));
});

test('GitHub source exposes true required fields and saves CSV/XLSX config',async t=>{
  const e=setup(t);await e.flush();e.input('source','github','change');assert.equal(e.d.querySelector('#start-github').hidden,false);e.input('github_repo','owner/repo');e.input('github_path','products.xlsx');
  await e.submit('#start-profile-form');const body=e.calls.find(c=>c.url==='/api/start/profile').body;assert.equal(body.source,'github');assert.deepEqual(body.github,{repo:'owner/repo',branch:'main',path:'products.xlsx'});
});

test('charts show actual stored points only, daily mode, and preserve last good data on refresh error',async t=>{
  const e=setup(t);e.seed.overview.history={updates:[{at:'2026-11-08T12:00:00Z',date:'2026-11-08',total:3,shops:1}],daily:[{at:'2026-11-07T12:00:00Z',date:'2026-11-07',total:2,shops:1}]};await e.flush();
  assert.equal(e.d.querySelectorAll('#start-chart circle').length,1);
  e.d.querySelector('#start-chart-mode').value='daily';e.d.querySelector('#start-chart-mode').dispatchEvent(new e.w.Event('change'));assert.match(e.d.querySelector('#start-chart-values').textContent,/2026-11-07/);
  const original=e.reply;e.reply=async(url,options)=>url==='/api/start/snapshot'?{httpError:503,error:'not ready'}:original(url,options);await e.click('#start-overview-refresh');assert.match(e.d.querySelector('#start-overview-status').textContent,/قدیمی/);assert.equal(e.d.querySelectorAll('.start-metric').length,16);
});

test('overview/profile labels are text, not executable source HTML',async t=>{
  const e=setup(t);e.seed.overview.by_profile[0].name='<img src=x onerror=alert(1)>';await e.flush();assert.equal(e.d.querySelectorAll('#start-breakdown-body img').length,0);assert.match(e.d.querySelector('#start-breakdown-body').textContent,/<img/);
});

test('Start audit shortcut selects all profiles and real five-page diagnostic mode',async t=>{
  const e=setup(t);await e.flush();await e.click('#start-audit-link');assert.equal(e.d.querySelector('#extraction-audit-form').elements.profile_id.value,'all');assert.equal(e.d.querySelector('#extraction-audit-form').elements.pages.value,'5');
});

test('real Flask+SQLite Start save/enqueue, extended gallery drilldown and durable snapshot',async t=>{
  const e=setup(t,true);await e.flush();assert.equal(e.d.querySelectorAll('.start-metric').length,16);
  await e.click('#start-new');e.input('name','پروفایل واقعی');e.input('url','https://example.net/products');e.input('pages','0');assert.equal(await e.w.S4Start.enqueue({render:'static'}),true);await e.flush();
  const response=await e.reply('/api/start/overview');assert.equal(response.by_profile.length,3);assert.equal(response.totals.gallery,1);
  const listing=await e.reply('/api/products?filter=gallery');assert.equal(listing.total,1);
  await e.click('#start-overview-refresh');const snap=await e.reply('/api/start/overview');assert.equal(snap.history.updates.length,1);assert.equal(snap.history.daily.length,1);assert.equal(snap.remote_inventory,false);
});

test('edits during pending save survive, block enqueue and retain the created profile identity',async t=>{
  const e=setup(t);await e.flush();let release;const old=e.reply;e.reply=(url,options)=>url==='/api/start/profile'?new Promise(resolve=>{release=async()=>resolve(await old(url,options));}):old(url,options);
  const pending=e.w.S4Start.enqueue({render:'static'});await e.flush();e.input('name','پیش‌نویس تازه');await release();assert.equal(await pending,false);await e.flush();
  assert.equal(e.d.querySelector('#start-profile-form').elements.name.value,'پیش‌نویس تازه');assert.ok(!e.calls.some(c=>c.url==='/api/start/enqueue'));assert.match(e.d.querySelector('#start-action-status').textContent,/پیش‌نویس حفظ شد/);
});
