import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build,transform} from 'esbuild';
import {parseHTML} from 'linkedom';
import vm from 'node:vm';
const root=new URL('..',import.meta.url).pathname;
const result=await build({entryPoints:[root+'/worker-src/dashboard.ts'],bundle:true,write:false,format:'cjs',platform:'node'}),module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
const {DASHBOARD_JS}=module.exports;
async function compile(source,names,io){const js=(await transform(source,{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names+'}')( ...Object.values(io))}
test('dashboard compiles, displays persistent-session caveats and wires all four buttons',()=>{
 new vm.Script(DASHBOARD_JS);
 for(const action of ['open','close','status','report'])assert.match(DASHBOARD_JS,new RegExp('browser-runtime-'+action));
 assert.match(DASHBOARD_JS,/headless/);assert.match(DASHBOARD_JS,/browserRuntimeEngine/);assert.match(DASHBOARD_JS,/copyBrowserRuntimeReport/);
});
test('launch, status and close use explicit actions; successful browser keeps polling; reports have manual fallback',async()=>{
 const {document}=parseHTML('<html><body><input id="browserRepairRoot"><select id="browserRuntimeEngine"><option selected value="puppeteer">Puppeteer</option></select><pre id="browserRuntimeStatus"></pre><textarea id="browserRuntimeReport" hidden></textarea></body></html>');
 const $=id=>document.getElementById(id);$('browserRepairRoot').checked=true;const calls=[],timers=[],notices=[];let state={running:true,phase:'open'},copied='';
 const area=$('browserRuntimeReport');area.focus=()=>{};area.select=()=>{};document.execCommand=()=>false;
 const a=DASHBOARD_JS.indexOf('let browserRuntimeTimer='),b=DASHBOARD_JS.indexOf('let browserRepairTimer=',a);
 const ui=await compile(DASHBOARD_JS.slice(a,b),'browserRuntimeAction,copyBrowserRuntimeReport',{$,document,window:{isSecureContext:false},navigator:{},pretty:JSON.stringify,notice:(...args)=>notices.push(args),clearTimeout:()=>{},setTimeout:(fn,ms)=>{timers.push(ms);return 1},api:async(path,options)=>{calls.push({path,options});return path.endsWith('/report')?{ok:true,report:'Failure at navigation: Page crashed'}:state}});
 await ui.browserRuntimeAction('open');assert.equal(calls[0].options.headers['x-browser-runtime'],'1');assert.deepEqual(JSON.parse(calls[0].options.body),{action:'open',engine:'puppeteer',allowRoot:true});assert.deepEqual(timers,[4000]);
 await ui.browserRuntimeAction('status');assert.deepEqual(calls[1].options,{});state={running:false,phase:'closed'};await ui.browserRuntimeAction('close');assert.deepEqual(JSON.parse(calls[2].options.body),{action:'close'});assert.equal(timers.length,2);
 await ui.copyBrowserRuntimeReport();assert.equal(area.hidden,false);assert.match(area.value,/Page crashed/);assert.equal(notices.at(-1)[1],'error');assert.match($('browserRuntimeStatus').textContent,/closed/);
});
const server=await readFile(root+'/render-src/server.ts','utf8');
test('runtime action route rejects absent consent header, oversized inputs and unknown actions',async()=>{
 const a=server.indexOf("app.post('/api/runtime/browser-session'"),b=server.indexOf("app.get('/api/runtime/browser-session/report'",a);let handler;const actions=[];
 await compile(server.slice(a,b),'',{app:{post:(path,h)=>handler=h},browserRuntime:{start:options=>{actions.push(options);return{phase:'starting'}},close:async()=>{actions.push('close');return{phase:'closed'}}}});
 const req={header:()=>undefined,text:async()=>JSON.stringify({action:'open',engine:'playwright',allowRoot:true})};const ctx={req,header:()=>{},json:(body,status=200)=>({body,status})};assert.equal((await handler(ctx)).status,403);assert.equal(actions.length,0);
 req.header=()=> '1';assert.equal((await handler(ctx)).status,202);assert.deepEqual(actions[0],{engine:'playwright',allowRoot:true});req.text=async()=> 'x'.repeat(257);assert.equal((await handler(ctx)).status,413);req.text=async()=>JSON.stringify({action:'whatever'});assert.equal((await handler(ctx)).status,400);req.text=async()=>JSON.stringify({action:'close'});assert.equal((await handler(ctx)).body.phase,'closed');
});
test('report is read-only, includes current environment and retained runtime error; shutdown closes it',()=>{
 const a=server.indexOf("app.get('/api/runtime/browser-session/report'"),b=server.indexOf("app.get('/api/runtime/browser-repair/report'",a),src=server.slice(a,b);assert.match(src,/browserRuntime.status\(\)/);assert.match(src,/browserRepairReport/);assert.doesNotMatch(src,/browserRuntime\.(?:start|close)\(/);assert.match(src,/no-store/);assert.match(server,/shutdown = async.*await browserRuntime.close\(\)/);
});
