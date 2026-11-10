// NODE_PATH=tools/ui-tests/node_modules node --test pythonanywhere/tests/extraction_control_ui.test.cjs
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {execFileSync}=require('node:child_process');const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..'),env={...process.env,PYTHONPATH:path.join(root,'pythonanywhere')};
const html=execFileSync('python3',['-c',`
from pathlib import Path
from tempfile import TemporaryDirectory
from scraper4 import create_app
from scraper4.config import Settings
with TemporaryDirectory() as directory:
    base=Path(directory);app=create_app(Settings(base_dir=base,db_path=base/'test.sqlite',secret_key='ui-only',password='test'))
    c=app.test_client()
    with c.session_transaction() as s:s['authenticated']=True
    print(c.get('/').text)
`],{cwd:root,env,encoding:'utf8'});
const snapshot={ok:true,counts:{waiting:1},public_cron:false,last_cron_at:null,note:'ثبت در صف به‌تنهایی کار را اجرا نمی‌کند.',jobs:[{id:1,profile_name:'فروشگاه',status:'waiting',error:'',counters:{}}]};
function setup(t){
  const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document,calls=[],hooks={begin:0,end:0},intervals=[];
  w.confirm=()=>true;w.setInterval=fn=>{intervals.push(fn);return 1;};w.S4Refresh={beginMutation(){hooks.begin++;},endMutation(){hooks.end++;}};
  const e={w,d,calls,hooks,intervals};e.reply=async(url)=>url.endsWith('/status')?snapshot:{ok:true,ran:1,message:'یک مرحله اجرا شد'};
  w.fetch=async(url,options)=>{calls.push({url,options});const data=await e.reply(url,options);return {ok:!data.httpError,status:data.httpError||200,json:async()=>data};};
  w.eval(fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static/extraction-control.js'),'utf8'));
  e.flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};e.click=()=>d.querySelector('#extraction-step').click();return e;
}
test('initial status check never advances queue; cron disabled and waiting state are explicit',async t=>{
  const e=setup(t);await e.flush();assert(e.calls.every(c=>c.options.method==='GET'));assert(e.d.querySelector('#extraction-status').textContent.includes('خاموش'));
  assert(e.d.querySelector('#extraction-jobs').textContent.includes('در انتظار اجرا'));assert.deepEqual(e.hooks,{begin:0,end:0});
});
test('confirmation and CSRF protect one explicit extraction POST; polling never creates a loop of writes',async t=>{
  const e=setup(t);await e.flush();e.w.confirm=()=>false;e.click();await e.flush();assert.equal(e.calls.length,1);
  e.w.confirm=()=>true;e.click();await e.flush();const post=e.calls.filter(c=>c.options.method==='POST');assert.equal(post.length,1);
  assert.equal(post[0].url,'/api/extraction/step');assert.equal(post[0].options.body,'{}');assert(post[0].options.headers['X-CSRF-Token']);
  assert.equal(e.d.querySelector('#extraction-action-status').textContent,'یک مرحله اجرا شد');assert.deepEqual(e.hooks,{begin:1,end:1});
  for(const fn of e.intervals)fn();await e.flush();assert.equal(e.calls.filter(c=>c.options.method==='POST').length,1);
});
test('pending execution blocks duplicate clicks and holds build-refresh guard until followup status',async t=>{
  const e=setup(t);await e.flush();const original=e.reply;let finish;e.reply=(url,options)=>options.method==='POST'?new Promise(resolve=>finish=resolve):original(url);
  e.click();e.click();await e.flush();assert.equal(e.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(e.d.querySelector('#extraction-step').disabled,true);assert.deepEqual(e.hooks,{begin:1,end:0});
  finish({ok:true,ran:0,throttled:true,message:'۴۵ ثانیه صبر کنید'});await e.flush();assert.equal(e.d.querySelector('#extraction-step').disabled,false);assert.deepEqual(e.hooks,{begin:1,end:1});
});
test('failed step is shown as error while subsequent status is still fetched',async t=>{
  const e=setup(t);await e.flush();const old=e.reply;e.reply=(url,options)=>options.method==='POST'?{httpError:422,error:'HTTP 403'}:old(url);
  e.click();await e.flush();assert.equal(e.d.querySelector('#extraction-action-status').textContent,'HTTP 403');assert.equal(e.calls.at(-1).url,'/api/extraction/status');assert.equal(e.hooks.begin,e.hooks.end);
});
test('zero-result warning and JS shell hints are visible and HTML-looking fields stay text',async t=>{
  const e=setup(t);await e.flush();e.reply=async()=>({...snapshot,jobs:[{id:1,status:'done',profile_name:'<img onerror=evil()>',error:'',counters:{found:0,last_page_products:0,warning:'هیچ محصولی یافت نشد',js_shell:true}}]});
  e.d.querySelector('#extraction-refresh').click();await e.flush();const rows=e.d.querySelector('#extraction-jobs');assert(rows.textContent.includes('هیچ محصولی'));assert(rows.textContent.includes('JavaScript'));assert.equal(rows.querySelectorAll('img,script,[onerror]').length,0);
});
test('actual Flask endpoint progresses only extraction with preserved destination send job',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'s4-extract-ui-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const bridge=`
import sys,json
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
from scraper4.services.scraping.smart_fetch import SmartFetcher
item=json.load(sys.stdin);base=Path(sys.argv[1]);app=create_app(Settings(base_dir=base,db_path=base/'ui.sqlite',secret_key='bridge-only',password='test'))
db=app.extensions['s4_db']
if not db.list_profiles():
    p=db.upsert_profile('test','https://example.com/shop',selectors={'container':'.product','title':'h2'})
    db.enqueue('woo_send',p['id']);db.enqueue('extract',p['id'],{'pages':1})
SmartFetcher.get=lambda url,**k:{'ok':True,'code':200,'url':url,'html':'<article class="product"><h2>محصول واقعی تست</h2><a href="/p/1">view</a></article>'}
c=app.test_client()
with c.session_transaction() as s:s.update(authenticated=True,csrf=item['csrf'])
r=c.post(item['url'],json={},headers={'X-CSRF-Token':item['csrf']}) if item['method']=='POST' else c.get(item['url'])
assert db.get_entry(1)['status']=='waiting'
value=r.json
if r.status_code>=400:value['httpError']=r.status_code
print(json.dumps(value))
`;
  const e=setup(t);await e.flush();e.reply=async(url,options)=>JSON.parse(execFileSync('python3',['-c',bridge,dir],{cwd:root,env,encoding:'utf8',input:JSON.stringify({url,method:options.method,csrf:e.d.querySelector('meta[name="csrf"]').content})}));
  e.d.querySelector('#extraction-refresh').click();await e.flush();e.click();await e.flush();assert(e.d.querySelector('#extraction-jobs').textContent.includes('پایان‌یافته'));assert(e.d.querySelector('#extraction-action-status').textContent.includes('یک مرحله'));
  assert.equal(e.calls.filter(c=>c.options.method==='POST').length,1);
});

test('selected stuck row resumes in place, blocks duplicate clicks and keeps feedback over status polls',async t=>{
 const e=setup(t);await e.flush();const row={id:11,profile_key:'one',profile_name:'stuck profile',status:'failed',counters:{current:2,found:3},error:''};let finish;
 e.reply=(url,options)=>options.method==='GET'?{...snapshot,jobs:[row]}:new Promise(resolve=>finish=resolve);
 e.d.querySelector('#extraction-refresh').click();await e.flush();const b=e.d.querySelector('[data-extract-resume="11"]');b.click();b.click();await e.flush();
 const writes=e.calls.filter(c=>c.options.method==='POST');assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/php-ui/write');assert.deepEqual(JSON.parse(writes[0].options.body),{action:'python_extract_resume',query:{},fields:{profile:'one',id:'11'}});
 assert.equal(e.w.location.pathname,'/');assert(e.d.querySelector('[data-extract-row-message="11"]').textContent.includes('همین ردیف'));
 finish({ok:true,ran:1,message:'صفحهٔ بعدی همین کار اجرا شد'});await e.flush();e.d.querySelector('#extraction-refresh').click();await e.flush();assert.equal(e.d.querySelector('[data-extract-row-message="11"]').textContent,'صفحهٔ بعدی همین کار اجرا شد');
 for(const fn of e.intervals)fn();await e.flush();assert.equal(e.calls.filter(c=>c.options.method==='POST').length,1);assert.deepEqual(e.hooks,{begin:1,end:1});
});
