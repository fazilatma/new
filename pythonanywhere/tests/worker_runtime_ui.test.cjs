// NODE_PATH=tools/ui-tests/node_modules node --test pythonanywhere/tests/worker_runtime_ui.test.cjs
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');const {JSDOM}=require('jsdom');const root=path.resolve(__dirname,'../..');
const html=execFileSync('python3',['-c',`
from pathlib import Path
from tempfile import TemporaryDirectory
from scraper4 import create_app
from scraper4.config import Settings
with TemporaryDirectory() as directory:
    base=Path(directory);app=create_app(Settings(base_dir=base,db_path=base/'ui.sqlite',secret_key='ui-only',password='test'))
    c=app.test_client()
    with c.session_transaction() as s:s['authenticated']=True
    print(c.get('/settings/pythonanywhere').text)
`],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'pythonanywhere')},encoding:'utf8'});
const base={ok:true,config:{enabled:false,poll_seconds:5},state:{},observed_running:false,heartbeat_age_seconds:null,native_schedule:{},commands:{always_on:'cd /safe && /venv/python -m scraper4 worker'}};
function setup(t){
  const dom=new JSDOM(html,{url:'https://example.test/settings/pythonanywhere',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,d=w.document,calls=[],hooks={begin:0,end:0,clean:0};
  w.setInterval=()=>0;w.confirm=()=>true;w.S4Refresh={beginMutation(){hooks.begin++;},endMutation(){hooks.end++;},revision(){return 1;},clean(){hooks.clean++;},isDirty(){return false;}};
  const e={w,d,calls,hooks};e.reply=async(url)=>url.endsWith('/status')?base:{ok:true,process_started:false,note:'تنظیم ذخیره شد؛ پردازشی شروع نشده است.'};
  w.fetch=async(url,options)=>{calls.push({url,options,data:options.body?JSON.parse(options.body):null});const value=await e.reply(url,options);return {ok:!value.httpError,status:value.httpError||200,json:async()=>value};};
  w.eval(fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static/worker-runtime.js'),'utf8'));
  e.form=d.querySelector('#worker-runtime-form');e.flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};e.submit=()=>e.form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));return e;
}
test('initial status never launches a process; commands are server text only',async t=>{
  const e=setup(t);await e.flush();assert.equal(e.calls.length,1);assert.equal(e.calls[0].url,'/api/worker/status');assert(e.d.querySelector('#worker-runtime-message').textContent.includes('غیرفعال'));
  assert(e.d.querySelector('#worker-runtime-commands').textContent.includes('-m scraper4 worker'));assert.deepEqual(e.hooks,{begin:0,end:0,clean:0});
});
test('enabled setting requires consent and CSRF; no arbitrary command is transmitted',async t=>{
  const e=setup(t);await e.flush();e.form.elements.enabled.checked=true;e.w.confirm=()=>false;e.submit();await e.flush();assert.equal(e.calls.length,1);
  e.w.confirm=()=>true;e.submit();await e.flush();const call=e.calls.find(c=>c.url.endsWith('/config'));assert.deepEqual(call.data,{enabled:true,poll_seconds:5});assert(call.options.headers['X-CSRF-Token']);
  assert.deepEqual(e.hooks,{begin:1,end:1,clean:1});assert(e.d.querySelector('#worker-runtime-message').textContent.includes('پردازشی شروع نشده'));
});
test('native Task activation is explicit, reports setup not running, and refreshes state',async t=>{
  const e=setup(t);await e.flush();e.d.querySelector('#worker-native-schedule').click();await e.flush();const call=e.calls.find(c=>c.url.endsWith('/schedule'));assert.deepEqual(call.data,{});
  assert.equal(e.calls.at(-1).url,'/api/worker/status');assert(e.d.querySelector('#worker-runtime-message').textContent.includes('شروع نشده'));assert.equal(e.hooks.begin,e.hooks.end);
});
test('unsaved worker settings block Task activation instead of silently discarding them',async t=>{
  const e=setup(t);await e.flush();e.w.S4Refresh.isDirty=()=>true;e.d.querySelector('#worker-native-schedule').click();await e.flush();assert.equal(e.calls.length,1);assert(e.d.querySelector('#worker-runtime-message').textContent.includes('ذخیره کنید'));
});
test('plan errors are visible and never produce successful activation',async t=>{
  const e=setup(t);await e.flush();const old=e.reply;e.reply=(url)=>url.endsWith('/schedule')?{httpError:400,error:'حساب Tasks ندارد'}:old(url);e.d.querySelector('#worker-native-schedule').click();await e.flush();assert.equal(e.d.querySelector('#worker-runtime-message').textContent,'حساب Tasks ندارد');assert.equal(e.d.querySelector('#worker-native-schedule').disabled,false);assert.equal(e.hooks.begin,e.hooks.end);
});
test('status refresh cannot overwrite typed settings; executable-looking commands stay text',async t=>{
  const e=setup(t);await e.flush();e.form.elements.poll_seconds.value='15';e.form.elements.poll_seconds.dispatchEvent(new e.w.Event('input',{bubbles:true}));e.reply=async()=>({...base,observed_running:true,state:{phase:'idle'},commands:{always_on:'<img src=x onerror=evil()>'}});
  e.d.querySelector('#worker-runtime-refresh').click();await e.flush();assert.equal(e.form.elements.poll_seconds.value,'15');assert.equal(e.d.querySelector('#worker-runtime-commands img'),null);assert(e.d.querySelector('#worker-runtime-message').textContent.includes('مشاهده'));
});
