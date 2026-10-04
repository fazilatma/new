import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {parseHTML} from 'linkedom';
const source=await readFile(new URL('../worker-src/dashboard.ts',import.meta.url),'utf8');
const line=name=>source.split('\n').find(x=>x.startsWith('function '+name+'(')||x.startsWith('async function '+name+'('));
function compile(names,io){return new Function(...Object.keys(io),names.map(line).join('\n')+';return {'+names.join(',')+'}')( ...Object.values(io));}
test('visual selector changes enter the field-level autosave queue without requiring a DOM input event',()=>{
 const {document}=parseHTML('<input id="sel-title"><div id="result-title"></div><div id="wrap-title"></div>'),calls=[];
 const fn=compile(['applyVisualSelection'],{$:id=>document.getElementById(id),scheduleAutoSave:(...args)=>calls.push(args),fa:String,detailFields:[],updateDetailSummary:()=>{}}).applyVisualSelection;
 assert.equal(fn('title',{selector:'.manual-title',count:3}),true);assert.equal(document.getElementById('sel-title').value,'.manual-title');assert.deepEqual(calls,[['profile',true,'sel-title']]);
});
test('diagnosis/job preparation waits for autosave and aborts if an edit remains unsaved',async()=>{
 const drafts=new Map([['profile:p',{}]]),order=[];
 const fn=compile(['flushProfileEdits'],{flushAutoSave:async()=>order.push('flush'),autoSaveDrafts:drafts,autoSaveInvalid:new Map()}).flushProfileEdits;
 await assert.rejects(fn('p'),/ذخیره/);assert.deepEqual(order,['flush']);drafts.clear();await fn('p');
 assert.match(line('runExtractionDiagnostic'),/await flushProfileEdits\(id\).*activateProfile\(id\)/);
 assert.match(line('createJob'),/await flushProfileEdits\(id\);activateProfile\(id\)/);
});
test('parser results render eight separate sample cards, escaped errors, and per-parser detail selection',()=>{
 const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 const fn=compile(['parserComparisonHtml'],{esc,escAttr:esc,fa:String,pretty:JSON.stringify,diagnosticSampleCard:(row,kind,index)=>'<div data-card="'+kind+'-'+index+'">'+esc(row.sample?.title||'No product')+'</div>'}).parserComparisonHtml;
 const rows=['auto','lxml','selectolax','jsonld','next_data','script_json','metadata','heuristic'].map(parser=>({parser,ok:false,status:'empty',count:0,error:'<script>bad</script>',sample:null}));rows[1]={...rows[1],ok:true,status:'success',count:1,sample:{title:'Manual product'}};
 const {document}=parseHTML(fn(rows));assert.equal(document.querySelectorAll('[data-parser-result]').length,8);assert.equal(document.querySelectorAll('[data-card]').length,8);assert.equal(document.querySelectorAll('script').length,0);assert.match(document.querySelector('[data-parser-result="lxml"]').textContent,/Manual product/);assert.equal(fn(undefined),'');
 assert.match(line('openDiagnosticProduct'),/kind==='parser'\?lastDiagnosticReport\?\.report\?\.parserResults\?\.\[index\]/);
});
const dir=await mkdtemp(join(tmpdir(),'selector-learning-'));
await build({entryPoints:[new URL('../worker-src/profile-learning.ts',import.meta.url).pathname],outfile:join(dir,'learning.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const {mergeLearnedProfile}=await import(pathToFileURL(join(dir,'learning.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));
test('background discovery cannot restore stale manual selectors or unrelated profile fields',()=>{
 const original={url:'https://shop.example',selectors:{container:'li.product',title:'.manual-title',price:''},priceValue:1,extractionEngine:'auto'},current={...original,selectors:{...original.selectors,container:'.new-manual-card'},priceValue:99,productParserEnabled:true,productParser:'lxml',extractionEngineBenchmarks:[{ok:true}]},snapshot=structuredClone(current);
 const merged=mergeLearnedProfile(current,original,{...original,extractionEngineMaster:'heuristic'},{container:'.discovered',title:'.guessed',price:'.price'});
 assert.equal(merged.selectors.container,'.new-manual-card');assert.equal(merged.selectors.title,'.manual-title');assert.equal(merged.selectors.price,'.price');assert.equal(merged.priceValue,99);assert.equal(merged.productParser,'lxml');assert.equal(merged.extractionEngineMaster,undefined);assert.deepEqual(current,snapshot);assert.deepEqual(merged.extractionEngineBenchmarks,[{ok:true}]);
});
test('empty discovered values and a changed source URL never modify a current profile',()=>{
 const original={url:'https://old.example',selectors:{price:''}},current={url:'https://new.example',selectors:{price:''}};
 assert.deepEqual(mergeLearnedProfile(current,original,original,{price:'.found'}),current);assert.equal(mergeLearnedProfile(original,original,original,{price:''}).selectors.price,'');
});
