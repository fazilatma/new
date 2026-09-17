import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {parseHTML} from 'linkedom';
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
async function compile(source,names,io={}){const js=(await transform(source.replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,''),{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names.join(',')+'};')(...Object.values(io))}
const tick=()=>new Promise(r=>setImmediate(r));
for(const runtime of ['render','worker'])test(runtime+': three-page benchmark emits real progress before the first page completes',async()=>{
 const src=await read(runtime+'-src/'+(runtime==='render'?'server.ts':'app.ts')),a=src.indexOf('async function benchmarkProfileEngines('),b=src.indexOf('\napp.post(',a);
 let release,calls=0;const events=[],saved=[];
 const scrape=async()=>{const n=++calls;if(n===1)await new Promise(r=>release=r);return{products:[{sourceKey:'a'+n},{sourceKey:'b'+n}]}};
 const io={BENCHMARK_ENGINES:['cheerio','missing'],MIN_BENCHMARK_PRODUCTS:2,BROWSER_ENGINES:new Set(['missing']),WORKER_UNAVAILABLE_ENGINES:new Set(['missing']),browserEngineAvailable:()=>false,benchmarkProbeUrl:p=>p.url,pageUrl:(p,n)=>p.url+'?page='+n,safeText:async()=>({text:'fixture',url:'https://shop.test'}),sourceText:async()=>({text:'fixture',url:'https://shop.test'}),scrapeListWithMeta:scrape,scrapeListPage:scrape,diagnoseBenchmarkEngine:async()=>({hint:'fixture'}),saveBenchmarkProfile:async(...args)=>{saved.push(args);return true},message:e=>e.message};
 const {benchmarkProfileEngines}=await compile(src.slice(a,b),['benchmarkProfileEngines'],io);
 const pending=benchmarkProfileEngines({id:'p',url:'https://shop.test',selectors:{},pagination:'query_page'},e=>events.push(e));await tick();assert.equal(calls,1);assert.ok(events.some(e=>e.page===1&&e.status==='running'));assert.equal(saved.length,0);
 release();const result=await pending;assert.equal(calls,3);assert.equal(result.fastest.products,6);assert.ok(events.some(e=>e.page===3&&e.pagesScanned===3));assert.ok(events.some(e=>e.name==='missing'&&e.status==='skipped'));assert.equal(saved.length,1);
});
test('benchmark merge preserves a new price, explicitly changed engine and selector edits',async()=>{
 const {mergeBenchmarkProfile}=await compile(await read('worker-src/benchmark-profile.ts'),['mergeBenchmarkProfile']);
 const original={priceValue:10,extractionEngine:'auto',selectors:{title:'old',image:'old'}},result={...original,extractionEngine:'cheerio',extractionEngineBenchmarks:[{engine:'cheerio'}]},current={...original,priceValue:20,extractionEngine:'jsonld',selectors:{title:'user',image:'old'}};
 const merged=mergeBenchmarkProfile(current,original,result,{title:'probe',image:'probe'});assert.equal(merged.priceValue,20);assert.equal(merged.extractionEngine,'jsonld');assert.equal(merged.selectors.title,'user');assert.equal(merged.selectors.image,'probe');
});
async function autosaveHarness(api){
 const {window}=parseHTML('<html><body><span id="autoSaveState"></span><input id="profileId" value="a"><input id="priceValue" type="number" value="10"><input id="name" value="A"><input id="homeProfile" value="a"><input id="homeProfileName" value="Home A"><input id="homeUrl" value="https://a.test"><input id="filter" value=""></body></html>');
 const $=id=>window.document.getElementById(id),state={connected:true,profiles:[{id:'a',name:'A',url:'https://a.test',priceValue:0},{id:'b',name:'B',url:'https://b.test',priceValue:0}],settings:{},connections:{}},applied=[];
 const io={document:window.document,window,state,$,profileBody:()=>({id:$('profileId').value,name:$('name').value,url:'https://'+$('profileId').value+'.test',priceValue:Number($('priceValue').value)}),homeProfileBody:()=>({id:$('homeProfile').value,name:$('homeProfileName').value,url:$('homeUrl').value}),api,applySavedResults:async id=>applied.push(id),watchJob:()=>{},loadJobs:async()=>{},nestedSet:(obj,key,value)=>obj[key]=value};
 const src=await read('worker-src/dashboard.ts'),a=src.indexOf('let autoSaveTimer='),b=src.indexOf('async function saveConnections(',a);
 const mod=await compile(src.slice(a,b),['initAutoSave','scheduleAutoSave','flushAutoSave','autoSaveDrafts'],io);mod.initAutoSave();return{...mod,$,state,applied,window};
}
test('autosave snapshots the original profile, applies prices and never overlaps requests',async()=>{
 let release,active=0,max=0;const sent=[];
 const h=await autosaveHarness(async(path,options)=>{active++;max=Math.max(max,active);const body=JSON.parse(options.body);sent.push(body);if(sent.length===1)await new Promise(r=>release=r);active--;return{profile:body}});
 h.scheduleAutoSave('profile',true,'priceValue');const running=h.flushAutoSave();await tick();
 h.$('priceValue').value='20';h.scheduleAutoSave('profile',true,'priceValue');
 h.$('profileId').value='b';h.$('name').value='B';h.$('priceValue').value='30';h.scheduleAutoSave('profile',true,'priceValue');
 release();await running;assert.equal(max,1);assert.deepEqual(sent.map(x=>[x.id,x._autosavePatch.priceValue]),[['a',10],['a',20],['b',30]]);assert.deepEqual(h.applied,['a','a','b']);assert.match(h.$('autoSaveState').textContent,/ذخیره و اعمال/);
});
test('autosave retains a failed snapshot and reports the error until a retry succeeds',async()=>{
 let fail=true;const h=await autosaveHarness(async(_p,o)=>{if(fail)throw Error('offline');return{profile:JSON.parse(o.body)}});
 h.scheduleAutoSave('profile',true,'priceValue');await h.flushAutoSave();assert.equal(h.autoSaveDrafts.size,1);assert.match(h.$('autoSaveState').textContent,/offline/);
 fail=false;await h.flushAutoSave();assert.equal(h.autoSaveDrafts.size,0);assert.match(h.$('autoSaveState').textContent,/ذخیره و اعمال/);
});
test('home fields save the home form, and filters do not become profile updates',async()=>{
 const sent=[],h=await autosaveHarness(async(_p,o)=>{const body=JSON.parse(o.body);sent.push(body);return{profile:body}});
 h.$('homeProfileName').value='Edited home';h.$('homeProfileName').dispatchEvent(new h.window.Event('change',{bubbles:true}));await tick();await h.flushAutoSave();assert.equal(sent[0]._autosavePatch.name,'Edited home');
 h.$('filter').dispatchEvent(new h.window.Event('change',{bubbles:true}));await tick();assert.equal(sent.length,1);
});
test('equivalent PostgreSQL jsonb objects do not become false Results conflicts',async()=>{
 const {sameResultData}=await compile(await read('worker-src/result-adjustments.ts'),['sameResultData']);assert.ok(sameResultData({title:'x',resultBase:{title:'x',price:10}},{resultBase:{price:10,title:'x'},title:'x'}));assert.equal(sameResultData({price:10},{price:20}),false);
});
