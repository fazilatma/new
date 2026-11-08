// NODE_PATH=tools/ui-tests/node_modules node --test pythonanywhere/tests/product_browser_ui.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..');
const env={...process.env,PYTHONPATH:path.join(root,'pythonanywhere')};
const html=execFileSync('python3',['-c',`
from tempfile import TemporaryDirectory
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
with TemporaryDirectory() as directory:
    base=Path(directory)
    app=create_app(Settings(base_dir=base,db_path=base/'ui.sqlite',secret_key='ui-only',password='test'))
    app.extensions['s4_db'].upsert_profile('shop','https://example.com/shop','فروشگاه')
    client=app.test_client()
    with client.session_transaction() as session: session['authenticated']=True
    print(client.get('/').text)
`],{cwd:root,env,encoding:'utf8'});
const counts={all:201,priced:100,no_price:101,with_image:20,linked:201,sku:10,woo_linked:4,bsl_linked:5,woo_missing:197,bsl_missing:196};
const sample={id:1,title:'محصول یک',price:'100 تومان',profile_name:'فروشگاه',sku:'SKU',link:'https://example.com/item',extra:{}};
const overview={ok:true,totals:counts,by_profile:[{id:1,name:'فروشگاه',enabled:1,counts}]};
const detail={ok:true,product:{...sample,woo_id:34,basalam_id:56},details:{images:['https://example.com/a.jpg'],specs:[{k:'رنگ',v:'آبی'}],category:'کتاب',brand:'Brand',tags:'برچسب',longDesc_text:'توضیحات ذخیره‌شده',shortDesc_text:'کوتاه',specs_text:''}};
function setup(t) {
  const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window,d=w.document,timers=new Map(),calls=[];
  let timerId=0;
  w.setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;};
  w.clearTimeout=id=>timers.delete(id);
  w.setInterval=()=>0;
  w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  const e={w,d,calls,timers};
  e.reply=async url=>{
    if(url==='/api/products/overview') return overview;
    if(/^\/api\/products\/\d+$/.test(url)) return detail;
    if(url.startsWith('/api/products?')) {const query=new URL(url,w.location.origin).searchParams;return {ok:true,total:201,offset:Number(query.get('offset')),products:[sample]};}
    if(url==='/api/jobs') return {ok:true,jobs:[],stats:{profiles:1,products:201,queue_alive:0}};
    if(url.startsWith('/api/connections/')) return {fields:{}};
    if(url==='/api/deploy/config') return {config:{enabled:true},host:'example.test',ready:true};
    if(url==='/api/cron/config') return {config:{public_get:false}};
    if(url==='/api/system/status') return {runtime:{},platform:{},updates:{config:{},state:{}}};
    return {ok:true};
  };
  w.fetch=async(url,options={})=>{calls.push({url,options});const data=await e.reply(url,options);return {ok:!data.httpError,status:data.httpError||200,json:async()=>data};};
  for(const name of ['app.js','product-browser.js']) w.eval(fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static',name),'utf8'));
  Object.assign(e,{
    async flush(){for(let i=0;i<6;i++) await new Promise(setImmediate);},
    input(selector,value,event='input'){const el=d.querySelector(selector);el.value=value;el.dispatchEvent(new w.Event(event,{bubbles:true}));},
    async search(value){e.input('#products-search',value);for(const [id,timer] of [...timers]) if(timer.delay===250){timers.delete(id);timer.callback();} await e.flush();},
    lists(){return calls.filter(item=>item.url.startsWith('/api/products?'));},
    query(){return new URL(e.lists().at(-1).url,w.location.origin).searchParams;},
  });
  return e;
}

test('eight real metric cards and per-profile drilldowns open correctly scoped server results',async t=>{
  const e=setup(t);await e.flush();
  assert.equal(e.d.querySelectorAll('.metric-card').length,8);
  assert.equal(e.d.querySelectorAll('#overview-profiles tr').length,1);
  assert(e.d.querySelector('[data-metric="all"] .metric-value').textContent.includes('۲۰۱'));
  e.d.querySelector('[data-metric="priced"]').click();await e.flush();
  assert.equal(e.w.location.hash,'#results');assert.equal(e.query().get('filter'),'priced');
  assert.equal(e.query().has('profile_id'),false);
  e.d.querySelectorAll('#overview-profiles .count-drilldown')[2].click();await e.flush();
  assert.equal(e.query().get('filter'),'with_image');assert.equal(e.query().get('profile_id'),'1');
  assert.equal(e.query().get('offset'),'0');
  assert(e.calls.every(item=>(item.options.method||'GET')==='GET'));
});

test('search is debounced server-side, preserves literal query, and resets page with sort/filter',async t=>{
  const e=setup(t);await e.flush();e.d.querySelector('#tab-results').click();await e.flush();
  e.d.querySelector('#products-next').click();await e.flush();assert.equal(e.query().get('offset'),'100');
  const before=e.lists().length;e.input('#products-search','کتاب %_');
  assert.equal(e.lists().length,before);assert.equal(e.d.querySelector('#products-next').disabled,true);
  await e.search('کتاب %_');
  assert.equal(e.query().get('q'),'کتاب %_');assert.equal(e.query().get('offset'),'0');
  e.input('#products-sort','price_asc','change');await e.flush();assert.equal(e.query().get('sort'),'price_asc');
  e.input('#products-filter','woo_missing','change');await e.flush();assert.equal(e.query().get('filter'),'woo_missing');
  // The server result is not wrongly removed by a second, current-page-only JS search.
  assert.equal(e.d.querySelectorAll('.product-card').length,1);
  e.d.querySelector('#products-clear').click();await e.flush();
  assert.equal(e.query().get('q'),'');assert.equal(e.query().get('filter'),'all');assert.equal(e.query().get('sort'),'newest');
});

test('late old search response cannot paint during the next debounce or replace newer results',async t=>{
  const e=setup(t);await e.flush();const original=e.reply;let resolveOld;
  e.reply=(url,options)=>url.startsWith('/api/products?')&&new URL(url,e.w.location.origin).searchParams.get('q')==='old' ? new Promise(resolve=>resolveOld=resolve):original(url,options);
  e.d.querySelector('#tab-results').click();await e.flush();await e.search('old');
  e.input('#products-search','new');resolveOld({total:1,offset:0,products:[{...sample,title:'STALE'}]});await e.flush();
  assert(!e.d.querySelector('#product-grid').textContent.includes('STALE'));
  await e.search('new');assert.equal(e.query().get('q'),'new');assert.equal(e.d.querySelectorAll('.product-card').length,1);
});

test('server-clamped offset and request errors give usable accurate pagination',async t=>{
  const e=setup(t);await e.flush();const original=e.reply;
  e.reply=(url,options)=>url.startsWith('/api/products?')?{total:1,offset:0,products:[sample]}:original(url,options);
  e.d.querySelector('#tab-results').click();await e.flush();
  assert.equal(e.d.querySelector('#products-prev').disabled,true);assert.equal(e.d.querySelector('#products-next').disabled,true);
  assert.equal(e.d.querySelector('#products-page').textContent,'1–1 از 1');
  e.reply=(url,options)=>url.startsWith('/api/products?')?{httpError:503,error:'تلاش دوباره'}:original(url,options);
  e.d.querySelector('#products-refresh').click();await e.flush();
  assert.equal(e.d.querySelectorAll('.product-card').length,0);assert.equal(e.d.querySelector('#products-count').textContent,'—');
  assert.equal(e.d.querySelector('#products-status').textContent,'تلاش دوباره');
  assert.equal(e.d.querySelector('#products-next').disabled,true);
});

test('table/card toggle and profile exports continue working with filters',async t=>{
  const e=setup(t);await e.flush();e.w.S4Browse('sku',1);await e.flush();
  assert.equal(e.d.querySelector('#products-json').getAttribute('href'),'/api/export/1?format=json');
  e.d.querySelector('#products-view').click();
  assert.equal(e.d.querySelector('#product-grid').hidden,true);assert.equal(e.d.querySelector('#product-table-wrap').hidden,false);
  assert.equal(e.d.querySelectorAll('#product-rows .product-detail-button').length,1);
  e.d.querySelector('#products-view').click();assert.equal(e.d.querySelector('#product-grid').hidden,false);
});

test('detail dialog renders existing gallery/specs/IDs, Escape closes and returns keyboard focus',async t=>{
  const e=setup(t);await e.flush();e.d.querySelector('#tab-results').click();await e.flush();
  const button=e.d.querySelector('.product-card .product-detail-button');button.focus();button.click();await e.flush();
  const dialog=e.d.querySelector('#product-detail');assert.equal(dialog.open,true);
  assert(e.calls.some(item=>item.url==='/api/products/1'));assert.equal(e.d.querySelector('#product-detail-title').textContent,sample.title);
  assert.equal(e.d.querySelectorAll('.detail-gallery img').length,1);assert(e.d.querySelector('#product-detail-body').textContent.includes('توضیحات ذخیره‌شده'));
  assert(e.d.querySelector('#product-detail-body').textContent.includes('34'));assert(e.d.querySelector('.detail-specs').textContent.includes('آبی'));
  dialog.dispatchEvent(new e.w.Event('cancel',{cancelable:true}));assert.equal(dialog.open,false);assert.equal(e.d.activeElement,button);
  assert(e.calls.every(item=>(item.options.method||'GET')==='GET'));
});

test('closing a pending detail request prevents stale rendering, including a subsequent opening',async t=>{
  const e=setup(t);await e.flush();const original=e.reply;let resolveOld;
  e.reply=(url,options)=>url==='/api/products/2'?new Promise(resolve=>resolveOld=resolve):original(url,options);
  e.w.S4Products.open(2);await e.flush();e.d.querySelector('#product-detail-close').click();
  e.w.S4Products.open(1);await e.flush();resolveOld({...detail,product:{...sample,title:'OLD DETAIL'}});await e.flush();
  assert.equal(e.d.querySelector('#product-detail-title').textContent,sample.title);
  assert.equal(e.d.querySelector('#product-detail-body').getAttribute('aria-busy'),'false');
});

test('external data stays text and unsafe image/link schemes cannot produce executable DOM',async t=>{
  const e=setup(t);await e.flush();const original=e.reply;
  e.reply=(url,options)=>/^\/api\/products\/\d+$/.test(url)?{...detail,
    product:{...sample,title:'<img onerror=evil()>',link:'javascript:evil()'},
    details:{...detail.details,images:['javascript:evil()','data:image/svg+xml,evil','http://example.com/a.jpg','https://user:pass@example.com/a.jpg','https://example.com/good.jpg'],
      longDesc_text:'<script>evil()</script>',specs:[{k:'<b>key</b>',v:'<img onerror=evil()>'}]}}:original(url,options);
  e.w.S4Products.open(1);await e.flush();
  assert.equal(e.d.querySelectorAll('#product-detail-body script, #product-detail-body [onerror], #product-detail-body iframe').length,0);
  assert.equal(e.d.querySelectorAll('.detail-gallery img').length,1);
  assert.equal(e.d.querySelectorAll('.detail-source').length,0);
  assert(e.d.querySelector('#product-detail-body').textContent.includes('<script>evil()</script>'));
});

test('empty catalog and failed overview remain honest with a working retry',async t=>{
  const e=setup(t);await e.flush();const original=e.reply;
  e.reply=(url,options)=>url==='/api/products/overview'?{httpError:503,error:'Unavailable'}:original(url,options);
  e.d.querySelector('#overview-refresh').click();await e.flush();assert(e.d.querySelector('#overview-status').textContent.includes('قدیمی'));
  e.reply=(url,options)=>url==='/api/products/overview'?{totals:Object.fromEntries(Object.keys(counts).map(key=>[key,0])),by_profile:[]}:original(url,options);
  e.d.querySelector('#overview-refresh').click();await e.flush();
  assert(e.d.querySelector('#overview-profiles').textContent.includes('هنوز پروفایلی'));
  assert.equal(e.d.querySelector('[data-metric="priced"] .metric-percent').textContent,'۰٪ از کل');
});

test('real Flask temporary-DB bridge: overview → scoped global search → stored details',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'s4-browser-ui-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const bridge=`
import sys,json
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
base=Path(sys.argv[1]);app=create_app(Settings(base_dir=base,db_path=base/'bridge.sqlite',secret_key='ui-only',password='test'))
app.config.update(TESTING=True,SESSION_COOKIE_SECURE=False)
db=app.extensions['s4_db']
if not db.list_profiles():
    p=db.upsert_profile('shop','https://example.com/shop','فروشگاه')
    for index in range(105):
        db.upsert_product(p['id'],str(index),{'title':f'کتاب {index}','price_num':index,'price':str(index),'extra':{'longDesc':'<p>توضیح واقعی</p>','images':['https://example.com/a.jpg'],'specs_rows':[{'k':'رنگ','v':'آبی'}]}})
client=app.test_client()
with client.session_transaction() as session: session['authenticated']=True
response=client.get(sys.argv[2]);value=response.json
if response.status_code>=400: value['httpError']=response.status_code
print(json.dumps(value))
`;
  const e=setup(t);await e.flush();const original=e.reply;
  e.reply=async(url,options)=>url.startsWith('/api/products')?JSON.parse(execFileSync('python3',['-c',bridge,directory,url],{cwd:root,env,encoding:'utf8'})):original(url,options);
  e.d.querySelector('#overview-refresh').click();await e.flush();
  assert.equal(e.d.querySelector('[data-metric="all"] .metric-value').textContent,'۱۰۵');
  e.d.querySelector('[data-metric="priced"]').click();await e.flush();
  assert.equal(e.d.querySelectorAll('.product-card').length,100);
  await e.search('کتاب 1');assert.equal(e.d.querySelectorAll('.product-card').length,16);
  assert.equal(e.d.querySelector('#products-next').disabled,true);
  e.d.querySelector('.product-card .product-detail-button').click();await e.flush();
  assert(e.d.querySelector('#product-detail-body').textContent.includes('توضیح واقعی'));
  assert(e.d.querySelector('.detail-specs').textContent.includes('آبی'));
  assert.equal(e.d.querySelectorAll('.detail-gallery img').length,1);
  assert(e.calls.every(item=>(item.options.method||'GET')==='GET'));
});
