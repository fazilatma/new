// NODE_PATH=tools/ui-tests/node_modules node --test pythonanywhere/tests/selector_preview_ui.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'../..');
const env={...process.env,PYTHONPATH:path.join(root,'pythonanywhere')};
const html=execFileSync('python3',['-c',`
from pathlib import Path
from tempfile import TemporaryDirectory
from scraper4 import create_app
from scraper4.config import Settings
with TemporaryDirectory() as directory:
    base=Path(directory)
    app=create_app(Settings(base_dir=base,db_path=base/'ui.sqlite',secret_key='local-ui-only',password='test'))
    client=app.test_client()
    with client.session_transaction() as session: session['authenticated']=True
    print(client.get('/').text)
`],{cwd:root,env,encoding:'utf8'});
const result={ok:true,mode:'list',automatic:false,persisted:false,total:2,products:[{title:'کتاب اول',price:'۱۲۵ تومان',sku:'',link:'https://example.com/p/1',image:'https://example.com/a.jpg'}],fields:[{field:'title',selector:'h2',count:2,status:'matched',value:'کتاب اول'},{field:'sku',selector:'.none',count:0,status:'missing',value:''}],warnings:['HTML ایستا']};
function setup(t) {
  const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const w=dom.window,d=w.document,calls=[],timers=new Map(),hooks={begin:0,end:0,clean:0};let id=0;
  w.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id;};w.clearTimeout=id=>timers.delete(id);
  w.S4Refresh={beginMutation(){hooks.begin++;},endMutation(){hooks.end++;},clean(){hooks.clean++;}};
  const e={w,d,calls,timers,hooks};e.reply=async()=>result;
  w.fetch=async(url,options)=>{calls.push({url,options,data:JSON.parse(options.body)});const value=await e.reply(url,options);return {ok:!value.httpError,status:value.httpError||200,json:async()=>value};};
  w.eval(fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static/selector-preview.js'),'utf8'));
  Object.assign(e,{form:d.querySelector('#profile-form'),
    async flush(){for(let i=0;i<5;i++) await new Promise(setImmediate);},
    input(name,value){const input=e.form.elements[name]||d.querySelector('#'+name);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));},
    click(mode='list'){d.querySelector('#selector-test-'+mode).click();},
  });
  return e;
}

test('only explicit click fetches one POST with current unsaved inputs and CSRF; never saves or submits',async t=>{
  const e=setup(t);e.input('url','https://example.com/shop');e.input('container','.product');e.input('title','h2');
  assert.equal(e.calls.length,0);let submits=0;e.form.addEventListener('submit',()=>submits++);
  e.click();await e.flush();assert.equal(e.calls.length,1);assert.equal(submits,0);
  const call=e.calls[0];assert.equal(call.url,'/api/selectors/preview');assert.equal(call.options.method,'POST');
  assert.equal(call.options.headers['X-CSRF-Token'],e.d.querySelector('meta[name="csrf"]').content);
  assert.deepEqual(call.data,{mode:'list',url:'https://example.com/shop',selectors:{container:'.product',title:'h2'}});
  assert.equal(e.d.querySelectorAll('.selector-diagnostics tbody tr').length,2);
  assert(e.d.querySelector('#selector-test-status').textContent.includes('چیزی ذخیره نشده'));
  assert.deepEqual(e.hooks,{begin:1,end:1,clean:0});
});

test('detail test uses separate sample URL and all eight current detail selectors',async t=>{
  const e=setup(t);e.input('url','https://example.com/list');e.input('selector-sample-url','https://example.com/detail');
  e.input('detail_shortDesc','.short');e.input('detail_tags','.tags');e.reply=async()=>({...result,mode:'detail',products:[],fields:[{field:'shortDesc',selector:'.short',count:1,status:'empty',value:''}]});
  e.click('detail');await e.flush();assert.deepEqual(e.calls[0].data,{mode:'detail',url:'https://example.com/detail',selectors:{shortDesc:'.short',tags:'.tags'}});
  assert(e.d.querySelector('.selector-diagnostics').textContent.includes('مقدار خالی'));
  assert.equal(e.d.querySelectorAll('.selector-sample').length,0);
  assert(!new e.w.FormData(e.form).has('selector-sample-url'));
});

test('missing URL or detail selector explains locally without sending a request',async t=>{
  const e=setup(t);e.click();await e.flush();assert.equal(e.calls.length,0);
  e.input('selector-sample-url','https://example.com/detail');e.click('detail');await e.flush();assert.equal(e.calls.length,0);
  assert(e.d.querySelector('#selector-test-status').textContent.includes('حداقل یک سلکتور'));
});

test('input changes invalidate pending and rendered results, and prevent overlap',async t=>{
  const e=setup(t);e.input('url','https://example.com/shop');let resolve;
  e.reply=()=>new Promise(done=>resolve=done);e.click();await e.flush();e.click();assert.equal(e.calls.length,1);
  assert.equal(e.d.querySelector('#selector-test-detail').disabled,true);assert.equal(e.hooks.begin,1);assert.equal(e.hooks.end,0);
  e.input('title','.new');resolve(result);await e.flush();assert.equal(e.d.querySelectorAll('.selector-sample').length,0);
  assert(e.d.querySelector('#selector-test-status').textContent.includes('تغییر'));
  assert.equal(e.d.querySelector('#selector-test-list').disabled,false);assert.equal(e.hooks.end,1);
  e.reply=async()=>result;e.click();await e.flush();assert.equal(e.d.querySelectorAll('.selector-sample').length,1);
  e.input('title','.newer');assert.equal(e.d.querySelectorAll('.selector-sample').length,0);
});

test('silent programmatic profile edits also discard stale response; reset invalidates existing output',async t=>{
  const e=setup(t);e.input('url','https://example.com/shop');let resolve;e.reply=()=>new Promise(done=>resolve=done);
  e.click();await e.flush();e.form.elements.url.value='https://example.com/other';resolve(result);await e.flush();
  assert.equal(e.d.querySelectorAll('.selector-sample').length,0);
  e.reply=async()=>result;e.click();await e.flush();assert.equal(e.d.querySelectorAll('.selector-sample').length,1);
  e.form.reset();assert.equal(e.d.querySelectorAll('.selector-sample').length,0);
});

test('HTML-looking field values/selector samples stay text; no image or link is loaded',async t=>{
  const e=setup(t);e.input('url','https://example.com/shop');e.reply=async()=>({...result,
    fields:[{field:'title',selector:'<img onerror=evil()>',count:1,status:'matched',value:'<script>evil()</script>'}],
    products:[{title:'<img onerror=evil()>',image:'javascript:evil()',link:'data:text/html,evil',price:'<b>1</b>'}]});
  e.click();await e.flush();const output=e.d.querySelector('#selector-test-result');
  assert.equal(output.querySelectorAll('img,a,script,[onerror],iframe').length,0);assert(output.textContent.includes('<script>evil()</script>'));
});

test('upstream/session failures release busy guards and preserve all form drafts',async t=>{
  const e=setup(t);e.input('url','https://example.com/shop');e.input('title','.mine');
  e.reply=async()=>({httpError:502,error:'شبکه در دسترس نیست'});e.click();await e.flush();assert(e.d.querySelector('#selector-test-status').textContent.includes('شبکه'));
  assert.equal(e.form.elements.title.value,'.mine');assert.equal(e.hooks.clean,0);assert.equal(e.hooks.begin,e.hooks.end);
  e.reply=async()=>({httpError:401});e.click();await e.flush();assert(e.d.querySelector('#selector-test-status').textContent.includes('نشست'));
});

test('client timeout aborts and offers retry without leaving refresh guards stuck',async t=>{
  const e=setup(t);e.input('url','https://example.com/shop');e.reply=(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new e.w.DOMException('timeout','AbortError'))));
  e.click();await e.flush();[...e.timers.values()].find(item=>item.ms===20000).fn();await e.flush();
  assert(e.d.querySelector('#selector-test-status').textContent.includes('مهلت'));
  assert.equal(e.d.querySelector('#selector-test-list').disabled,false);assert.equal(e.hooks.begin,e.hooks.end);
});

test('actual Flask+fixture parser bridge renders list and detail without persisting anything',async t=>{
  const e=setup(t);const bridge=`
import sys,json
from pathlib import Path
from tempfile import TemporaryDirectory
from scraper4 import create_app
from scraper4.config import Settings
from scraper4.services.scraping.fetch import HtmlFetcher
item=json.load(sys.stdin)
source=Path(sys.argv[1]).read_text()
HtmlFetcher.get=lambda *a,**k: {'ok':True,'html':source,'url':'https://example.com/shop/page','code':200}
with TemporaryDirectory() as directory:
    base=Path(directory);app=create_app(Settings(base_dir=base,db_path=base/'test.sqlite',secret_key='bridge-only',password='test'))
    client=app.test_client()
    with client.session_transaction() as session:
        session['authenticated']=True
        session['csrf']=item['csrf']
    response=client.post('/api/selectors/preview',json=item['data'],headers={'X-CSRF-Token':item['csrf']})
    result=response.json
    result['httpError']=response.status_code if response.status_code>=400 else None
    assert app.extensions['s4_db'].stats()['products']==0
    assert not app.extensions['s4_db'].list_entries()
    assert not app.extensions['s4_db'].list_profiles()
    print(json.dumps(result))
`;
  e.reply=async(url,options)=>JSON.parse(execFileSync('python3',['-c',bridge,path.join(__dirname,'fixtures/selector_preview.html')],{cwd:root,env,encoding:'utf8',input:JSON.stringify({data:JSON.parse(options.body),csrf:options.headers['X-CSRF-Token']})}));
  e.input('url','https://example.com/shop');e.input('container','.product');e.input('title','h2');e.input('price','.price');e.click();await e.flush();
  assert.equal(e.d.querySelectorAll('.selector-sample').length,2);assert(e.d.querySelector('#selector-test-result').textContent.includes('۱۲۵٬۰۰۰ تومان'));
  e.input('selector-sample-url','https://example.com/p/1');e.input('detail_shortDesc','.short');e.input('detail_specs','.specs');e.click('detail');await e.flush();
  assert(e.d.querySelector('.selector-diagnostics').textContent.includes('خلاصه'));assert(e.d.querySelector('.selector-diagnostics').textContent.includes('آبی'));
  assert(!e.d.querySelector('#selector-test-result').textContent.includes('evil()'));assert.equal(e.calls.length,2);
});
