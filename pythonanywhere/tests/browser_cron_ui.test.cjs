const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
const script=fs.readFileSync(path.join(__dirname,'../scraper4/static/browser-cron.js'),'utf8');
function setup(t){
 const dom=new JSDOM('<meta name="csrf" content="CSRF"><aside id="browser-cron"><input type="checkbox" data-browser-cron-toggle checked><span data-browser-cron-status></span></aside>',{url:'https://example.test/',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window,calls=[],timers=new Map();let seq=0;
 w.setTimeout=(fn,ms)=>{const id=++seq;timers.set(id,{fn,ms});return id;};w.clearTimeout=id=>timers.delete(id);
 const e={w,calls,timers,config:{enabled:true},run:{ok:true,ran:1},priority:null};
 w.fetch=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>{
  if(url.endsWith('/config')){if(options.method==='POST')e.config=JSON.parse(options.body);return {ok:true,config:e.config,priority:e.priority};}return e.run;
 }}};w.eval(script);e.flush=async()=>{for(let i=0;i<10;i++)await new Promise(setImmediate);};
 e.fire=async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();await e.flush();};
 e.toggle=w.document.querySelector('input');e.label=w.document.querySelector('span');return e;
}
test('boot hydrates before timer, then uses authenticated POST only; next tick is bounded',async t=>{
 const e=setup(t);assert.equal(e.calls.length,0);assert.equal([...e.timers.values()][0].ms,5000);await e.fire();
 assert.deepEqual(e.calls.map(c=>[c.url,c.options.method]),[['/api/cron/browser/config','GET'],['/api/cron/browser/run','POST']]);
 assert.equal(e.calls[1].options.headers['X-CSRF-Token'],'CSRF');assert.equal(e.calls[1].options.credentials,'same-origin');assert.equal(e.calls[1].options.body,'{}');assert.equal([...e.timers.values()][0].ms,45000);assert.match(e.label.textContent,/یک مرحله/);
});
test('observed external cron or active worker keeps browser on standby',async t=>{
 const e=setup(t);e.priority={reason:'external_fresh',retry_after_seconds:91};await e.fire();assert.equal(e.calls.length,1);assert.equal([...e.timers.values()][0].ms,91000);assert.match(e.label.textContent,/بیرونی/);
 e.priority={reason:'worker_active',retry_after_seconds:45};await e.fire();assert.equal(e.calls.length,2);assert.match(e.label.textContent,/worker/);
});
test('disable persists explicit setting and disabled poll never triggers execution',async t=>{
 const e=setup(t);e.toggle.checked=false;e.priority={reason:'disabled',retry_after_seconds:45};e.toggle.dispatchEvent(new e.w.Event('change'));await e.flush();assert.equal(e.config.enabled,false);assert.equal(e.calls[0].options.method,'POST');await e.fire();assert.ok(e.calls.every(c=>c.url.endsWith('/config')));assert.match(e.label.textContent,/خاموش/);
});
test('network failure backs off rather than retry-looping or claiming success',async t=>{
 const e=setup(t);e.w.fetch=async()=>{throw Error('offline');};await e.fire();assert.match(e.label.textContent,/نتوانست/);assert.equal([...e.timers.values()][0].ms,60000);assert.equal(e.toggle.disabled,false);
});
test('page lifecycle suspends timers and pageshow resumes after bfcache',async t=>{
 const e=setup(t);e.w.dispatchEvent(new e.w.Event('pagehide'));assert.equal(e.timers.size,0);e.w.dispatchEvent(new e.w.Event('pageshow'));assert.equal(e.timers.size,1);await e.fire();assert.equal(e.calls.length,2);
});
