const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process'),{JSDOM,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'../..'),env={...process.env,PYTHONPATH:path.join(root,'pythonanywhere')};
const boot=`
import json,sys
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
base=Path(sys.argv[1]);app=create_app(Settings(base_dir=base,db_path=base/'ui.db',secret_key='ui',password='test'));db=app.extensions['s4_db']
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
r=c.open(req['url'],method='POST',json=req['body'],headers={'X-CSRF-Token':'ui-csrf'})
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
 const request=(url,body)=>JSON.parse(execFileSync('python3',['-c',bridge,dir,JSON.stringify({url,body})],{cwd:root,env,encoding:'utf8',maxBuffer:16000000}));
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
