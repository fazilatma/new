// Dependency-free browser-controller tests: node --test tests/auto_refresh.test.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../scraper4/static/auto-refresh.js'),'utf8');
const OLD = 'a'.repeat(40), NEXT = 'b'.repeat(40), LAST = 'c'.repeat(40);
function browser({commit=OLD, version='1.7.0', url='https://shop.example/?section=profile-form#selectors', stored='', blocked=false}={}) {
  const handlers = {}, timers = new Map(), values = new Map(stored ? [['s4:last-auto-refresh',stored]] : []);
  const nodes = {'#build-update-notice':{hidden:true}, '#build-update-text':{}, '#build-refresh-now':{}, '#message':{}, '#platform-message':{}};
  let timerId=0;
  const env = {calls:[], navigations:[], values, timers, nodes, confirmed:true};
  const doc = {hidden:false, querySelector(selector) {
    if(selector==='meta[name="csrf"]') return {content:'csrf-test'};
    if(selector==='meta[name="s4-build"]') return {content:commit};
    if(selector==='meta[name="s4-version"]') return {content:version};
    return nodes[selector];
  }, addEventListener(name,callback) {handlers['doc:'+name]=callback;}};
  env.response = () => ({body:{ok:true,commit:NEXT,version:'1.7.0'},installed:NEXT});
  const win = {document:doc, AbortController, URL,
    location:{href:url,replace(value) {env.navigations.push(value);this.href=value;}},
    history:{replaceState(_state,_title,value) {win.location.href=String(value);}},
    sessionStorage:{getItem(key) {if(blocked) throw Error('blocked');return values.get(key);},
      setItem(key,value) {if(blocked) throw Error('blocked');values.set(key,value);},
      removeItem(key) {if(blocked) throw Error('blocked');values.delete(key);}},
    setTimeout(callback,delay) {timers.set(++timerId,{callback,delay});return timerId;},
    clearTimeout(id) {timers.delete(id);},
    addEventListener(name,callback) {handlers['win:'+name]=callback;},
    confirm() {env.confirmations=(env.confirmations||0)+1;return env.confirmed;},
    async fetch(url,options) {
      env.calls.push([url,options]);
      const value = await env.response(options,url);
      if(value instanceof Error) throw value;
      return {ok:value.status===undefined || value.status===200,headers:{get:()=>value.installed},
        async json() {if(value.invalidJSON) throw Error('invalid JSON');return value.body;}};
    }
  };
  vm.runInNewContext(source,{window:win,URL});
  Object.assign(env,{win,doc,api:win.S4Refresh,form:()=>({isConnected:true}),
    emit(name,event={}) {handlers[name](event);},
    check:()=>win.S4Refresh.checkNow(),
    click:()=>nodes['#build-refresh-now'].onclick()});
  return env;
}
async function twice(env) {await env.check();await env.check();}

test('activated build requires two observations and final readiness check; URL/tab preserved',async()=>{
  const e=browser();await e.check();assert.equal(e.navigations.length,0);
  await e.check();assert.equal(e.navigations.length,1);assert.equal(e.calls.length,3);
  const url=new URL(e.navigations[0]);assert.equal(url.searchParams.get('section'),'profile-form');
  assert.equal(url.hash,'#selectors');assert.equal(url.searchParams.get('__s4_refresh'),NEXT);
  assert.equal(e.values.get('s4:last-auto-refresh'),NEXT);
  assert.deepEqual([...e.values.keys()],['s4:last-auto-refresh']);
  assert(e.calls.every(([url,o])=>url.startsWith('/healthz?')&&o.cache==='no-store'&&o.credentials==='same-origin'));
  await e.check();assert.equal(e.navigations.length,1);
});
test('same version and same SHA never reload; same version with new SHA does',async()=>{
  const e=browser();e.response=()=>({body:{ok:true,commit:OLD,version:'1.7.0'},installed:OLD});
  await twice(e);assert.equal(e.navigations.length,0);
  e.response=()=>({body:{ok:true,commit:NEXT,version:'1.7.0'},installed:NEXT});
  await twice(e);assert.equal(e.navigations.length,1);
});
test('old worker cannot impersonate installed new code; rollback to a different SHA works',async()=>{
  const e=browser({commit:NEXT});e.response=()=>({body:{ok:true,commit:NEXT,version:'1.7.0'},installed:LAST});
  await twice(e);assert.equal(e.navigations.length,0);
  e.response=()=>({body:{ok:true,commit:OLD,version:'1.6.0'},installed:OLD});
  await twice(e);assert.equal(e.navigations.length,1);
});
test('maintenance, absent header, invalid bodies, offline and malformed JSON never reload',async()=>{
  const e=browser();
  for(const result of [new Error('offline'),{status:503},{invalidJSON:true},{body:{ok:true,commit:NEXT,version:'1.7.0'}},
    {body:{ok:false,commit:NEXT,version:'1.7.0'},installed:NEXT},
    {body:{ok:true,commit:'bad',version:'1.7.0'},installed:'bad'},
    {body:{ok:true,commit:NEXT,version:17},installed:NEXT}]) {
    e.response=()=>result;await twice(e);assert.equal(e.navigations.length,0);
  }
});
test('an interrupted observation does not count toward stable readiness',async()=>{
  const e=browser();await e.check();e.response=()=>({status:503});await e.check();
  e.response=()=>({body:{ok:true,commit:NEXT,version:'1.7.0'},installed:NEXT});
  await e.check();assert.equal(e.navigations.length,0);await e.check();assert.equal(e.navigations.length,1);
});
test('input/change drafts survive failed saves; all forms must be clean',async()=>{
  const e=browser(),one=e.form(),two=e.form();
  e.emit('doc:input',{target:{closest:()=>one}});e.emit('doc:change',{target:{closest:()=>two}});
  await twice(e);assert.equal(e.navigations.length,0);assert.equal(e.nodes['#build-update-notice'].hidden,false);
  e.api.submitting(one,true);e.api.submitting(one,false); // failed save: no clean call
  await e.check();assert.equal(e.navigations.length,0);
  e.api.clean(one);await e.check();assert.equal(e.navigations.length,0);
  e.emit('doc:reset',{target:two});await e.check();assert.equal(e.navigations.length,1);
});
test('successful save cannot clear edits made while its request was pending',async()=>{
  const e=browser(),form=e.form();e.api.changed(form);const before=e.api.revision(form);
  e.api.changed(form);e.api.clean(form,before);assert.equal(e.api.isDirty(form),true);
  await twice(e);assert.equal(e.navigations.length,0);
  e.api.clean(form,e.api.revision(form));await e.check();assert.equal(e.navigations.length,1);
});
test('mutations nest and block both automatic and explicit refresh',async()=>{
  const e=browser();e.api.beginMutation();e.api.beginMutation();await twice(e);
  assert.equal(e.nodes['#build-refresh-now'].disabled,true);await e.click();assert.equal(e.navigations.length,0);
  e.api.endMutation();await e.check();assert.equal(e.navigations.length,0);
  e.api.endMutation();await e.check();assert.equal(e.navigations.length,1);
});
test('whole-form submit remains guarded between mutation completion and follow-up GET',async()=>{
  const e=browser(),form=e.form();e.api.changed(form);e.api.submitting(form,true);
  e.api.beginMutation();e.api.endMutation();e.api.clean(form);await twice(e);
  assert.equal(e.navigations.length,0);e.api.submitting(form,false);await e.check();assert.equal(e.navigations.length,1);
});
test('hidden tabs defer navigation and use slower polling',async()=>{
  const e=browser();e.doc.hidden=true;await twice(e);assert.equal(e.navigations.length,0);
  assert([...e.timers.values()].some(t=>t.delay===60000));
  e.doc.hidden=false;e.emit('doc:visibilitychange');await e.check();assert.equal(e.navigations.length,1);
});
test('manual refresh asks before discarding drafts; cancellation retains them',async()=>{
  const e=browser(),form=e.form();e.api.changed(form);await twice(e);
  e.confirmed=false;await e.click();assert.equal(e.navigations.length,0);assert.equal(e.api.isDirty(form),true);
  e.confirmed=true;await e.click();assert.equal(e.navigations.length,1);assert.equal(e.confirmations,2);
});
test('new input during final readiness check cancels even a confirmed navigation',async()=>{
  const e=browser(),form=e.form();e.api.changed(form);await twice(e);
  let resolve;e.response=()=>new Promise(r=>resolve=r);const click=e.click();
  e.api.changed(form);resolve({body:{ok:true,commit:NEXT,version:'1.7.0'},installed:NEXT});await click;
  assert.equal(e.navigations.length,0);
});
test('rollout changes during final preflight do not navigate to the obsolete target',async()=>{
  const e=browser();let n=0;e.response=()=>{const commit=++n<3?NEXT:LAST;return {body:{ok:true,commit,version:'1.7.0'},installed:commit};};
  await twice(e);assert.equal(e.navigations.length,0);await twice(e);
  assert.equal(new URL(e.navigations[0]).searchParams.get('__s4_refresh'),LAST);
});
test('stale HTML and blocked storage cannot cause an automatic reload loop',async()=>{
  const e=browser({url:`https://shop.example/?__s4_refresh=${NEXT}#results`,blocked:true});
  await twice(e);assert.equal(e.navigations.length,0);assert.equal(e.nodes['#build-update-notice'].hidden,false);
  await e.click();assert.equal(e.navigations.length,1);
});
test('session marker also bounds retries and successful new build cleans markers',async()=>{
  const old=browser({stored:NEXT});await twice(old);assert.equal(old.navigations.length,0);
  const e=browser({commit:NEXT,stored:NEXT,url:`https://shop.example/?foo=1&__s4_refresh=${NEXT}#results`});
  assert.equal(e.values.size,0);assert.equal(new URL(e.win.location.href).searchParams.has('__s4_refresh'),false);
  assert.equal(new URL(e.win.location.href).searchParams.get('foo'),'1');assert.equal(new URL(e.win.location.href).hash,'#results');
  await twice(e);assert.equal(e.navigations.length,0);
});
test('native login/logout submission blocks navigation; BFCache return resumes observation',async()=>{
  const e=browser();e.emit('doc:submit',{defaultPrevented:false});await twice(e);assert.equal(e.navigations.length,0);
  e.emit('win:pageshow',{persisted:true});await e.check();assert.equal(e.navigations.length,1);
  const managed=browser();managed.emit('doc:submit',{defaultPrevented:true});await twice(managed);assert.equal(managed.navigations.length,1);
});
test('health requests time out and never overlap',async()=>{
  const e=browser();e.response=options=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted'))));
  const pending=e.check();await e.check();assert.equal(e.calls.length,1);
  const timeout=[...e.timers.values()].find(t=>t.delay===5000);assert(timeout);timeout.callback();await pending;
  assert.equal(e.navigations.length,0);assert([...e.timers.values()].some(t=>t.delay===10000));
});

function managedHelpers(env,filename) {
  let code=fs.readFileSync(path.join(__dirname,'../scraper4/static/',filename),'utf8');
  if(filename==='platform.js') code=code.replace('(() => {','');
  code=code.slice(0,code.indexOf('const '+(filename==='app.js'?'profileForm':'platformForm')));
  const context={window:env.win,document:env.doc,fetch:env.win.fetch,location:env.win.location,
    FormData:class {constructor(form) {return new Map(Object.entries(form.fields));}}};
  if(filename==='platform.js') context.message=text=>{env.nodes['#platform-message'].textContent=text;};
  vm.runInNewContext(code,context);
  const form=env.form();form.fields={name:'draft'};
  form.addEventListener=(_name,callback)=>{form.submit=()=>callback({preventDefault(){}});};
  return {context,form};
}
for(const filename of ['app.js','platform.js']) {
  test(filename+' actual api/handle hooks protect an entire successful async save',async()=>{
    const e=browser(),{context,form}=managedHelpers(e,filename);
    let resolvePost,finishFollowup;
    const followup=new Promise(resolve=>finishFollowup=resolve);
    e.response=(_options,url)=>url==='/save'?new Promise(resolve=>resolvePost=resolve):{body:{ok:true,commit:NEXT,version:'1.7.0'},installed:NEXT};
    context.handle(form,async data=>{assert.equal(data.name,'draft');await context.api('/save','POST',data);await followup;});
    e.api.changed(form);const saving=form.submit();await twice(e);
    assert.equal(e.navigations.length,0);assert.equal(e.nodes['#build-refresh-now'].disabled,true);
    resolvePost({body:{ok:true}});await new Promise(setImmediate);await e.check();
    assert.equal(e.navigations.length,0); // POST finished, follow-up still running
    finishFollowup();await saving;await e.check();assert.equal(e.navigations.length,1);
  });
  test(filename+' failed writes and cancelled saves retain drafts and release pending guards',async()=>{
    const e=browser(),{context,form}=managedHelpers(e,filename);
    e.api.changed(form);context.handle(form,async()=>false);await form.submit();
    assert.equal(e.api.isDirty(form),true);
    e.response=(_options,url)=>url==='/save'?{status:500,body:{error:'Save failed'}}:{body:{ok:true,commit:NEXT,version:'1.7.0'},installed:NEXT};
    context.handle(form,async data=>context.api('/save','POST',data));await form.submit();
    await twice(e);assert.equal(e.navigations.length,0);assert.equal(e.api.isDirty(form),true);
    assert.equal(e.nodes[filename==='app.js'?'#message':'#platform-message'].textContent,'Save failed');
    e.api.clean(form);await e.check();assert.equal(e.navigations.length,1);
  });
}
test('overlapping submits on one form remain blocked until both finish',async()=>{
  const e=browser(),form=e.form();e.api.submitting(form,true);e.api.submitting(form,true);
  e.api.submitting(form,false);await twice(e);assert.equal(e.navigations.length,0);
  e.api.submitting(form,false);await e.check();assert.equal(e.navigations.length,1);
});
