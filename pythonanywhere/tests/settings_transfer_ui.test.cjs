// npm ci --prefix tools/ui-tests
// NODE_PATH=tools/ui-tests/node_modules node --test pythonanywhere/tests/settings_transfer_ui.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname,'../..');
const html = execFileSync('python3',['-c',`
from tempfile import TemporaryDirectory
from pathlib import Path
from scraper4 import create_app
from scraper4.config import Settings
with TemporaryDirectory() as directory:
    base=Path(directory)
    app=create_app(Settings(base_dir=base,db_path=base/'test.sqlite',secret_key='ui-test-only',password='test'))
    app.config['SESSION_COOKIE_SECURE']=False
    client=app.test_client()
    with client.session_transaction() as session: session['authenticated']=True
    print(client.get('/settings/backup').text)
`],{cwd:root,env:{...process.env,PYTHONPATH:path.join(root,'pythonanywhere')},encoding:'utf8'});
function setup(t) {
  const dom=new JSDOM(html,{url:'https://example.test/settings/backup',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window,d=w.document,calls=[],timers=new Map(),downloads=[];
  let id=0;
  w.setTimeout=(callback,delay)=>{timers.set(++id,{callback,delay});return id;};
  w.clearTimeout=id=>timers.delete(id);
  w.confirm=()=>true;
  w.Blob=Blob;
  w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test';};
  w.URL.revokeObjectURL=()=>{};
  w.HTMLAnchorElement.prototype.click=function(){downloads.at(-1).filename=this.download;};
  const env={w,d,calls,downloads};
  const inspection={ok:true,available:['profiles','basalam','pythonanywhere'],counts:{profiles:1,basalam:1,pythonanywhere:1},warnings:['فایل بررسی شد']};
  env.reply=async url=>{
    if(url.startsWith('/healthz?')) return {ok:true,version:'1.8.0',commit:'a'.repeat(40)};
    if(url.endsWith('/sections')) return {ok:true,undo_available:true};
    if(url.endsWith('/export')) return {format:'scraper4-settings-encrypted',schema:1,ciphertext:'opaque'};
    if(url.endsWith('/inspect')) return inspection;
    if(url.endsWith('/preview')) return {ok:true,token:'signed-preview',changes:[{section:'profiles',added:1,updated:2,disabled:0}],
      active_jobs:0,warnings:['هیچ محصولی حذف نمی‌شود.'],public_cron:true};
    return {ok:true,changed:true,undo_available:true};
  };
  w.fetch=async(url,options={})=>{
    calls.push({url,options,data:options.body?JSON.parse(options.body):null});
    const value=await env.reply(url,options);
    return {ok:!value.httpError,status:value.httpError||200,headers:{get:()=> 'a'.repeat(40)},json:async()=>value};
  };
  for(const name of ['auto-refresh.js','settings-transfer.js']) w.eval(fs.readFileSync(path.join(root,'pythonanywhere/scraper4/static',name),'utf8'));
  const exporting=d.querySelector('#settings-export-form'), importing=d.querySelector('#settings-import-form');
  Object.assign(env,{exporting,importing,
    async flush() {for(let i=0;i<8;i++) {await new Promise(setImmediate);for(const [key,timer] of [...timers]) if(timer.delay===0) {timers.delete(key);timer.callback();}}},
    input(node,value,type='input') {node.value=value;node.dispatchEvent(new w.Event(type,{bubbles:true}));},
    submit(form) {form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));},
    file(size=100) {Object.defineProperty(importing.elements.file,'files',{configurable:true,value:[{size,text:async()=>'{"format":"scraper4-settings-encrypted"}'}]});
      importing.elements.file.dispatchEvent(new w.Event('change',{bubbles:true}));},
    async inspect() {env.file();env.input(importing.elements.password,'backup-password-123');d.querySelector('#settings-inspect').click();await env.flush();},
    async preview() {d.querySelector('#settings-preview').click();await env.flush();}
  });
  return env;
}

test('encrypted export downloads, defaults omit hosting, clears passwords without storing secrets',async t=>{
  const e=setup(t);await e.flush();
  e.input(e.exporting.elements.password,'backup-password-123');e.input(e.exporting.elements.repeat,'backup-password-123');
  e.submit(e.exporting);await e.flush();
  const call=e.calls.find(call=>call.url.endsWith('/export'));
  assert(call.data.sections.includes('profiles'));assert(!call.data.sections.includes('pythonanywhere'));
  assert.equal(call.options.headers['X-CSRF-Token'].length>0,true);
  assert.equal(e.downloads.length,1);assert.equal(JSON.parse(await e.downloads[0].text()).ciphertext,'opaque');
  assert(e.downloads[0].filename.startsWith('scraper4-settings-'));
  assert.equal(e.exporting.elements.password.value,'');assert.equal(e.exporting.elements.repeat.value,'');
  assert.equal(e.w.S4Refresh.isDirty(e.exporting),false);
  assert.equal(e.w.localStorage.length,0);assert.equal(e.w.sessionStorage.length,0);
});
test('mismatched passwords and oversized files never reach the transfer API',async t=>{
  const e=setup(t);await e.flush();e.input(e.exporting.elements.password,'backup-password-123');e.input(e.exporting.elements.repeat,'different-password');
  e.submit(e.exporting);await e.flush();assert(!e.calls.some(call=>call.url.endsWith('/export')));
  e.file(1500001);e.d.querySelector('#settings-inspect').click();await e.flush();
  assert(!e.calls.some(call=>call.url.endsWith('/inspect')));assert(e.d.querySelector('#transfer-message').textContent.includes('حجم'));
});
test('inspection enables only available sections; hosting and credential import require opt-in',async t=>{
  const e=setup(t);await e.flush();await e.inspect();
  assert.equal(e.d.querySelector('#transfer-import-sections').disabled,false);
  assert.equal(e.importing.querySelector('[value="profiles"]').checked,true);
  assert.equal(e.importing.querySelector('[value="updates"]').disabled,true);
  assert.equal(e.importing.querySelector('[value="pythonanywhere"]').checked,false);
  await e.preview();
  const call=e.calls.find(call=>call.url.endsWith('/preview'));
  assert.deepEqual(call.data.sections,['profiles','basalam']);assert.equal(call.data.credentials,false);
  assert.equal(e.d.querySelector('#settings-apply').disabled,false);
  assert(e.d.querySelector('#settings-preview-result').textContent.includes('1 جدید'));
  assert(e.d.querySelector('#settings-preview-result').textContent.includes('روشن'));
});
test('changing options invalidates preview; cancellation never writes and successful apply clears draft',async t=>{
  const e=setup(t);await e.flush();await e.inspect();await e.preview();
  e.importing.elements.credentials.checked=true;e.importing.elements.credentials.dispatchEvent(new e.w.Event('change',{bubbles:true}));
  assert.equal(e.d.querySelector('#settings-apply').disabled,true);
  e.submit(e.importing);await e.flush();assert(!e.calls.some(call=>call.url.endsWith('/import')));
  await e.preview();e.w.confirm=()=>false;e.submit(e.importing);await e.flush();assert(!e.calls.some(call=>call.url.endsWith('/import')));
  e.w.confirm=()=>true;e.submit(e.importing);await e.flush();
  const call=e.calls.find(call=>call.url.endsWith('/import'));assert.equal(call.data.token,'signed-preview');assert.equal(call.data.credentials,true);
  assert.equal(e.importing.elements.password.value,'');assert.equal(e.w.S4Refresh.isDirty(e.importing),false);
  assert.equal(e.d.querySelector('#transfer-previous').disabled,false);assert.equal(e.d.querySelector('#settings-apply').disabled,true);
});
test('failed/stale imports keep file/password drafts and require a fresh preview',async t=>{
  const e=setup(t);await e.flush();await e.inspect();await e.preview();
  const original=e.reply;e.reply=(url,options)=>url.endsWith('/import')?{httpError:409,error:'پیش‌نمایش تغییر کرده است'}:original(url,options);
  e.submit(e.importing);await e.flush();
  assert.equal(e.importing.elements.password.value,'backup-password-123');assert.equal(e.w.S4Refresh.isDirty(e.importing),true);
  assert.equal(e.d.querySelector('#settings-apply').disabled,true);assert(e.d.querySelector('#transfer-message').textContent.includes('تغییر'));
});
test('editing while inspect is pending cannot enable a stale preview',async t=>{
  const e=setup(t);await e.flush();let resolve;
  const original=e.reply;e.reply=(url,options)=>url.endsWith('/inspect')?new Promise(r=>resolve=r):original(url,options);
  e.file();e.input(e.importing.elements.password,'backup-password-123');e.d.querySelector('#settings-inspect').click();await e.flush();
  e.input(e.importing.elements.password,'new-backup-password');resolve({ok:true,available:['profiles'],counts:{profiles:1},warnings:[]});await e.flush();
  assert.equal(e.d.querySelector('#settings-preview').disabled,true);assert.equal(e.importing.elements.password.value,'new-backup-password');
});
test('previous-version restore uses the same inspect/preview flow without uploading a file',async t=>{
  const e=setup(t);await e.flush();e.input(e.importing.elements.source,'previous','change');
  assert.equal(e.d.querySelector('#transfer-file-fields').hidden,true);
  e.d.querySelector('#settings-inspect').click();await e.flush();await e.preview();
  const call=e.calls.find(call=>call.url.endsWith('/preview'));assert.equal(call.data.source,'previous');assert.equal('file' in call.data,false);
});
