const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');const {JSDOM}=require('jsdom');const root=path.resolve(__dirname,'../..');
const html=execFileSync('python3',['-c',`
from pathlib import Path
from tempfile import TemporaryDirectory
from scraper4 import create_app
from scraper4.config import Settings
with TemporaryDirectory() as directory:
    base=Path(directory);app=create_app(Settings(base_dir=base,db_path=base/'ui.sqlite',secret_key='ui',password='test'))
    db=app.extensions['s4_db'];db.upsert_profile('first','https://example.com/1',name='اول');db.upsert_profile('second','https://example.com/2',name='دوم',enabled=False)
    c=app.test_client()
    with c.session_transaction() as s:s['authenticated']=True
    print(c.get('/').text)
`],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'pythonanywhere')},encoding:'utf8'});
const engines=['selectors','auto','heuristic','jsonld','jina','digikala_api','basalam_api','playwright','selenium'];
const profiles=[{id:1,name:'اول',extraction_engine:'basalam_api'},{id:2,name:'دوم',extraction_engine:'jsonld',enabled:false}];
function setup(t,script){const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document,calls=[],hooks={begin:0,end:0,dirty:0,clean:0};w.confirm=()=>true;
  let revision=0;d.addEventListener('input',()=>revision++);w.S4Refresh={beginMutation(){hooks.begin++;},endMutation(){hooks.end++;},changed(){hooks.dirty++;},revision(){return revision;},clean(){hooks.clean++;}};
  const e={w,d,calls,hooks};e.vendors=[{vendor_id:'10',shop_name:'اصلی',is_default:true,token_configured:true},{vendor_id:'20',shop_name:'دوم',is_default:false,token_configured:true,price_mode:'percent',price_val:10}];
  e.reply=async(url,options,data)=>{
    if(url==='/api/profiles')return {ok:true,profiles};if(url==='/api/extraction/engines')return {ok:true,engines:engines.map(id=>({id}))};
    if(url==='/api/extraction/probe')return {ok:true,report:{profile_id:data.profile_id,name:profiles.find(p=>p.id===data.profile_id).name,engine:data.engine,status:'passed',count:3,priced:2,linked:3,imaged:1,elapsed_ms:25}};
    return {ok:true,vendors:e.vendors};
  };
  w.fetch=async(url,options={})=>{const data=options.body?JSON.parse(options.body):null;calls.push({url,options,data});const result=await e.reply(url,options,data);return {ok:!result.httpError,status:result.httpError||200,json:async()=>result};};
  w.eval(fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static/'+script),'utf8'));
  e.flush=async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate);};e.submit=id=>d.querySelector(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));return e;
}
test('benchmark never runs on page load; all nine engine choices are present in the real editor',async t=>{
  const e=setup(t,'extraction-audit.js');await e.flush();assert.equal(e.calls.length,0);assert.deepEqual([...e.d.querySelectorAll('#profile-form [name=extractionEngine] option')].map(v=>v.value),engines);
});
test('all-profile configured-engine audit includes disabled profiles and never enqueues or sends',async t=>{
  const e=setup(t,'extraction-audit.js');e.submit('#extraction-audit-form');await e.flush();const probes=e.calls.filter(c=>c.url.endsWith('/probe'));assert.deepEqual(probes.map(c=>c.data),[{profile_id:1,engine:'basalam_api'},{profile_id:2,engine:'jsonld'}]);
  assert(probes.every(c=>c.options.headers['X-CSRF-Token']));assert.equal(e.d.querySelector('#audit-done').textContent,'2');assert.equal(e.d.querySelectorAll('#audit-results tr').length,2);assert.equal(e.hooks.begin,e.hooks.end);assert(e.calls.every(c=>!c.url.includes('/jobs')));
});
test('nine-engine comparison has exactly one sequential request per actual engine',async t=>{
  const e=setup(t,'extraction-audit.js');const form=e.d.querySelector('#extraction-audit-form');form.elements.profile_id.value='1';form.elements.engine.value='all';let pending=0,max=0;const old=e.reply;e.reply=async(...args)=>{pending++;max=Math.max(max,pending);const r=await old(...args);pending--;return r;};
  e.submit('#extraction-audit-form');await e.flush();assert.deepEqual(e.calls.filter(c=>c.url.endsWith('/probe')).map(c=>c.data.engine),engines);assert.equal(e.d.querySelector('#audit-done').textContent,'9');assert.equal(max,2); // only the two metadata GETs run in parallel
});
test('failure and zero products stay distinct and do not stop the next profile',async t=>{
  const e=setup(t,'extraction-audit.js');const old=e.reply;e.reply=async(url,options,data)=>url.endsWith('/probe')?{ok:true,report:{name:profiles[data.profile_id-1].name,engine:data.engine,status:data.profile_id===1?'failed':'empty',count:0,hint:'نیاز به بررسی'}}:old(url,options,data);
  e.submit('#extraction-audit-form');await e.flush();assert.equal(e.d.querySelector('#audit-failed').textContent,'1');assert.equal(e.d.querySelector('#audit-empty').textContent,'1');assert.equal(e.d.querySelector('#audit-passed').textContent,'0');
});
test('stop waits for the current request and does not begin another one',async t=>{
  const e=setup(t,'extraction-audit.js');let release;const old=e.reply;e.reply=(url,...args)=>url.endsWith('/probe')?new Promise(resolve=>{release=()=>resolve({ok:true,report:{name:'اول',engine:'auto',status:'empty',count:0}});}):old(url,...args);
  e.submit('#extraction-audit-form');await e.flush();e.d.querySelector('#audit-stop').click();release();await e.flush();assert.equal(e.calls.filter(c=>c.url.endsWith('/probe')).length,1);assert(e.d.querySelector('#audit-message').textContent.includes('متوقف شد'));assert.equal(e.hooks.begin,e.hooks.end);
});
test('audit output is text, never executable source HTML, and consent cancellation is inert',async t=>{
  const e=setup(t,'extraction-audit.js');e.w.confirm=()=>false;e.submit('#extraction-audit-form');await e.flush();assert.equal(e.calls.length,0);e.w.confirm=()=>true;const old=e.reply;e.reply=(url,...args)=>url.endsWith('/probe')?{report:{name:'<img src=x onerror=evil()>',engine:'auto',status:'failed',hint:'<script>evil()</script>'}}:old(url,...args);
  e.submit('#extraction-audit-form');await e.flush();assert.equal(e.d.querySelector('#audit-results img'),null);assert.equal(e.d.querySelector('#audit-results script'),null);
});
test('shop cards expose no token and populate explicit send destination options',async t=>{
  const e=setup(t,'basalam-shops.js');await e.flush();assert.equal(e.d.querySelectorAll('.shop-card').length,2);assert.deepEqual([...e.d.querySelectorAll('#send-form [name=vendor_id] option')].map(o=>o.value),['10','20']);assert(e.calls.every(c=>c.options.method==='GET'));
});
test('shop save transmits CSRF and token only in POST body and clears it after successful save',async t=>{
  const e=setup(t,'basalam-shops.js');await e.flush();const f=e.d.querySelector('#basalam-shop-form');f.elements.vendor_id.value='30';f.elements.token.value='local-private-token';e.submit('#basalam-shop-form');await e.flush();const call=e.calls.find(c=>c.options.method==='POST');assert.equal(call.data.vendor_id,'30');assert.equal(call.data.token,'local-private-token');assert(call.options.headers['X-CSRF-Token']);assert.equal(f.elements.token.value,'');assert.equal(e.hooks.begin,e.hooks.end);
});
test('editing a shop uses blank token to retain its saved secret, with no implicit remote operation',async t=>{
  const e=setup(t,'basalam-shops.js');await e.flush();e.d.querySelectorAll('.shop-card')[1].querySelector('button').click();const f=e.d.querySelector('#basalam-shop-form');assert.equal(f.elements.vendor_id.value,'20');assert.equal(f.elements.token.value,'');assert.equal(f.elements.price_mode.value,'percent');assert.equal(e.calls.length,1);
});
test('failed save retains drafts; delete requires consent and never deletes destination products',async t=>{
  const e=setup(t,'basalam-shops.js');await e.flush();const old=e.reply;e.reply=(url,options,...args)=>options.method==='POST'?{httpError:400,error:'توکن لازم است'}:old(url,options,...args);const f=e.d.querySelector('#basalam-shop-form');f.elements.vendor_id.value='30';f.elements.token.value='draft';e.submit('#basalam-shop-form');await e.flush();assert.equal(f.elements.token.value,'draft');
  e.w.confirm=()=>false;e.d.querySelectorAll('.shop-card')[1].querySelectorAll('button')[1].click();await e.flush();assert.equal(e.calls.filter(c=>c.options.method==='DELETE').length,0);assert.equal(e.hooks.begin,e.hooks.end);
});

test('five-page comprehensive audit follows signed continuation sequentially and stops at its real end',async t=>{
  const e=setup(t,'extraction-audit.js'),form=e.d.querySelector('#extraction-audit-form');form.elements.profile_id.value='1';form.elements.pages.value='5';
  let page=0;const old=e.reply;e.reply=async(url,options,data)=>url.endsWith('/probe')?{ok:true,report:{profile_id:1,name:'اول',engine:'basalam_api',page:++page,status:'passed',count:3,next:page<5?'signed-'+(page+1):null}}:old(url,options,data);
  e.submit('#extraction-audit-form');await e.flush();const probes=e.calls.filter(c=>c.url.endsWith('/probe'));
  assert.equal(probes.length,5);assert.equal(probes[0].data.continuation,undefined);assert.equal(probes[1].data.continuation,'signed-2');assert.equal(probes[4].data.continuation,'signed-5');assert.equal(e.d.querySelectorAll('#audit-results tr').length,5);assert.equal(e.d.querySelector('#audit-done').textContent,'1');
  assert.ok(e.calls.every(c=>!c.url.includes('/jobs')));assert.equal(e.hooks.begin,e.hooks.end);
});
