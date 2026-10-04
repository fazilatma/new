import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
const bundle=await build({entryPoints:[new URL('../worker-src/dashboard.ts',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node'}),module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);const {DASHBOARD,DASHBOARD_JS:js}=module.exports;
const a=js.indexOf('function browserWorkbenchHtml()'),b=js.indexOf('const INSTALLED_LIBRARY_HTML=',a);
const html=new Function('mButton','browserManualHtml',js.slice(a,b)+';return browserWorkbenchHtml()')((text,action)=>'<button data-ma="'+action+'">'+text+'</button>',()=>'<p>Manual instructions</p>');
const make=()=>parseHTML('<html><body>'+html+'</body></html>');
test('workbench preserves IDs, actions and opt-in permissions with clear technical disclosure',()=>{
 const {document}=make();for(const id of ['browserRuntimeEngine','browserRuntimeStatus','browserRuntimeReport','browserRepairLog','browserRepairReport','browserRepairMirror','browserRepairRoot'])assert.equal(document.querySelectorAll('#'+id).length,1,id);
 for(const action of ['browser-runtime-open','browser-runtime-close','browser-runtime-status','browser-runtime-report','browser-repair-start','browser-cache-reuse','browser-repair-status','browser-repair-copy'])assert.equal(document.querySelectorAll('[data-ma="'+action+'"]').length,1,action);
 for(const id of ['browserRepairMirror','browserRepairRoot'])assert.equal(document.getElementById(id).hasAttribute('checked'),false);
 assert.equal(document.getElementById('browserRuntimeStatus').closest('details').hasAttribute('open'),false);assert.equal(document.getElementById('browserRepairLog').closest('details').hasAttribute('open'),false);assert.match(document.body.textContent,/headless/);assert.match(document.body.textContent,/RAM/);
 assert.match(DASHBOARD,/@media\(max-width:60em\).*browser-layout/);assert.match(DASHBOARD,/@media\(max-width:32em\)/);
});
function renderFixture(){const {document}=make(),$=id=>document.getElementById(id),a=js.indexOf('function renderBrowserSummary('),b=js.indexOf('let browserRuntimeTimer=',a),render=new Function('$','document',js.slice(a,b)+';return renderBrowserSummary')($,document);return {document,$,render}}
test('runtime summary shows live metrics and capped event timeline without executing source content',()=>{
 const {$,document,render}=renderFixture();render('runtime',{phase:'open',running:true,connected:true,pageLoaded:true,engine:'playwright',browserVersion:'152',events:Array.from({length:12},(_,i)=>({at:'2026-09-26T10:00:00Z',kind:'ready',message:'event '+i+' <img src=x onerror=bad()>'}))});
 assert.equal($('browserRuntimeBadge').dataset.tone,'good');assert.match($('browserRuntimeBadge').textContent,/باز/);assert.equal($('browserRuntimePage').textContent,'تأیید شد');assert.match($('browserRuntimeVersion').textContent,/152/);assert.equal($('browserRuntimeTimeline').children.length,8);assert.match($('browserRuntimeTimeline').firstElementChild.textContent,/event 11/);assert.equal(document.querySelectorAll('img').length,0);
 render('runtime',{},'Connection lost');assert.equal($('browserRuntimeConnection').textContent,'نامشخص');assert.equal($('browserRuntimeError').hidden,false);assert.match($('browserRuntimeUpdated').textContent,/قدیمی/);
});
test('historical errors are explicitly identified while a current browser remains healthy',()=>{
 const {$,render}=renderFixture();render('runtime',{phase:'open',connected:true,pageLoaded:true,lastFailure:{stage:'navigation',at:'2026-09-26',error:'Page crashed'}});assert.equal($('browserRuntimeBadge').dataset.tone,'good');assert.match($('browserRuntimeError').textContent,/آخرین خطای ثبت‌شده/);assert.match($('browserRuntimeError').textContent,/Page crashed/);
 render('runtime',{phase:'closed',connected:false,pageLoaded:false});assert.equal($('browserRuntimeError').hidden,true);assert.equal($('browserRuntimeBadge').textContent,'بسته شد');
});
test('repair summary distinguishes failed, successful and skipped engines',()=>{
 const {$,render}=renderFixture();render('repair',{phase:'failed',success:false,results:{playwright:{success:true},puppeteer:{success:false},crawlee:{skipped:true}}});assert.equal($('browserRepairBadge').dataset.tone,'bad');const rows=$('browserRepairResults').querySelectorAll('.browser-state');assert.deepEqual([...rows].map(r=>r.dataset.tone),['good','bad','neutral']);render('repair',{running:true,results:{}});assert.match($('browserRepairResults').textContent,/در حال اجرا/);
});
