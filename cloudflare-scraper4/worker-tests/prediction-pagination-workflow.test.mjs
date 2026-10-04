import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {build,transform} from 'esbuild';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
const dir=await mkdtemp(join(tmpdir(),'scraper203-'));
await build({entryPoints:['category-prediction','benchmark-pagination','scroll-collector'].map(n=>new URL('../worker-src/'+n+'.ts',import.meta.url).pathname),bundle:true,platform:'node',format:'esm',outdir:dir,outExtension:{'.js':'.mjs'},logLevel:'silent'});
const {predictBasalamCategory,validatedPrediction,CATEGORY_PREDICTION_URL}=await import(pathToFileURL(join(dir,'category-prediction.mjs')));
const {benchmarkPagination}=await import(pathToFileURL(join(dir,'benchmark-pagination.mjs')));
const {collectScrollProducts}=await import(pathToFileURL(join(dir,'scroll-collector.mjs')));
test.after(()=>rm(dir,{recursive:true,force:true}));
async function compile(source,names,io={}){const js=(await transform(source.replace(/^import .*;\s*$/gm,'').replaceAll('export ',''),{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names+'};')(...Object.values(io))}
const categories=[{id:1,name:'Root',leaf:false},{id:2,name:'Shoes',leaf:true},{id:3,name:'Other',leaf:true}];
test('native category responses must resolve to a known leaf and ambiguity triggers fallback',()=>{
 assert.equal(validatedPrediction({result:[{cat_id:2}]},categories),2);
 for(const result of [[{cat_id:999}],[{cat_id:2,confidence:.2}],[{cat_id:1}],[{cat_id:2},{cat_id:3}],[]])assert.equal(validatedPrediction({result},categories),null);
 assert.equal(validatedPrediction({result:[{cat_id:2,confidence:.95},{cat_id:3,confidence:.6}]},categories),2);
 assert.equal(validatedPrediction({result:[{cat_id:2,confidence:.7},{cat_id:3,confidence:.6}]},categories),null);
});
test('prediction uses encoded GET on the documented v2 route and caches validated IDs without tokens',async()=>{
 let calls=0;const state=new Map(),io={getState:async(k,f)=>state.get(k)??f,setState:async(k,v)=>state.set(k,v),fetch:async(url,init,max)=>{calls++;assert.equal(new URL(url).origin,new URL(CATEGORY_PREDICTION_URL).origin);assert.equal(new URL(url).searchParams.get('title'),'Shoe & bag');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.authorization,'Bearer private-token');assert.equal(max,500000);return new Response(JSON.stringify({result:[{cat_id:2}]}))}};
 assert.equal((await predictBasalamCategory({title:'Shoe & bag (کد: 12)'},categories,io,'private-token')).categoryId,2);
 assert.equal((await predictBasalamCategory({title:'Shoe & bag (کد: 13)'},categories,io,'private-token')).cached,true);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify([...state]),/private-token|Shoe/);
 for(const v of state.values())v.at='2020-01-01';await predictBasalamCategory({title:'Shoe & bag'},categories,io,'private-token');assert.equal(calls,2);
 await predictBasalamCategory({title:'Shoe & bag'},categories.slice(0,2),io,'private-token');assert.equal(calls,3);
});
test('prediction HTTP errors, malformed JSON and timeout are recoverable and never cached',async()=>{
 for(const response of [()=>new Response('{}',{status:403}),()=>new Response('bad json'),()=>new Response('{"result":[{"cat_id":999}]}')]){
  let writes=0;const result=await predictBasalamCategory({title:'Shoe'},categories,{getState:async()=>null,setState:async()=>{writes++},fetch:async()=>response()},'');assert.equal(result.ok,false);assert.equal(writes,0);
 }
 const result=await predictBasalamCategory({title:'Shoe'},categories,{getState:async()=>null,setState:async()=>assert.fail('timeout cannot cache'),fetch:async(_u,i)=>new Promise((_r,reject)=>i.signal.addEventListener('abort',()=>reject(Error('abort'))))},'',100);assert.equal(result.ok,false);
});
for(const runtime of ['worker','render']){
 const source=await read(runtime+'-src/scraper.ts'),a=source.indexOf('export function pageUrl('),b=source.indexOf('export function benchmarkProbeUrl(',a);
 const {pageUrl}=await compile(source.slice(a,b),'pageUrl');
 for(const [mode,value,expected] of [['query_page','page','?page=2'],['query_custom','offset','?offset=2'],['path_page','','/page/2/'],['path_pattern','/p/{page}','/p/2'],['full_pattern','https://shop.test/catalog/{page}','/catalog/2']])test(runtime+': benchmark exercises '+mode+' and verifies new products on both transitions',async()=>{
  const urls=[],report=await benchmarkPagination({url:'https://shop.test/',pagination:mode,paginationValue:value},{pageUrl,scrape:async url=>{urls.push(url);return{products:[{sourceKey:url}]}}});
  assert.equal(urls.length,3);assert.ok(urls[1].endsWith(expected));assert.equal(report.transitionsVerified,2);assert.equal(report.verified,true);
 });
 test(runtime+': next-selector follows returned links, not the profile URL',async()=>{
  const urls=[],report=await benchmarkPagination({url:'https://shop.test/',pagination:'next_selector',paginationValue:'a.next'},{pageUrl,scrape:async(url,selector)=>{assert.equal(selector,'a.next');urls.push(url);return{products:[{sourceKey:url}],nextUrl:urls.length===1?'?cursor=second':'/third'}}});
  assert.deepEqual(urls,['https://shop.test/','https://shop.test/?cursor=second','https://shop.test/third']);assert.equal(report.verified,true);
 });
 test(runtime+': none reads once, repeated URLs/content and absent next links do not pass three pages',async()=>{
  let calls=0;const none=await benchmarkPagination({url:'https://shop.test/',pagination:'none'},{pageUrl,scrape:async()=>{calls++;return{products:[{sourceKey:'x'}]}}});assert.equal(calls,1);assert.equal(none.status,'disabled');assert.equal(none.transitionsVerified,0);
  for(const pagination of ['next_selector','query_page']){calls=0;const r=await benchmarkPagination({url:'https://shop.test/',pagination,paginationValue:'a.next'},{pageUrl,scrape:async()=>{calls++;return{products:[{sourceKey:'same'}],nextUrl:'/'}}});assert.equal(r.verified,false);assert.ok(calls<=2);assert.equal(r.transitionsVerified,0)}
  const terminal=await benchmarkPagination({url:'https://shop.test/',pagination:'next_selector'},{pageUrl,scrape:async()=>({products:[{sourceKey:'x'}]})});assert.equal(terminal.verified,false);assert.match(terminal.error,/یافت نشد/);
 });
}
test('scroll benchmark stops after three genuinely new batches, not three reads of the same DOM',async()=>{
 let round=0,clock=0;const batches=[];
 const products=await collectScrollProducts({snapshot:async()=>[{sourceKey:'p'+Math.floor(round/2)}],key:p=>p.sourceKey,step:async()=>{round++;return{height:100,top:0,atEnd:false}},wait:async ms=>{clock+=ms},now:()=>clock,observe:(rows,added)=>{if(added)batches.push({products:rows.length,newProducts:added,status:'verified'})}},{maxBatches:3,maxRounds:10});
 assert.equal(products.length,3);assert.equal(batches.length,3);assert.equal(round,4);
 const r=await benchmarkPagination({pagination:'scroll'},{pageUrl:()=>'',scrape:async()=>assert.fail('must use real scroll adapter'),scroll:async()=>({products,batches})});assert.equal(r.verified,true);
 const unsupported=await benchmarkPagination({pagination:'scroll'},{pageUrl:()=>'',scrape:async()=>assert.fail('must not fake scroll with HTTP')});assert.equal(unsupported.status,'unsupported');
});
test('home buttons explicitly request list-only or full scrape, ignoring the send-only checkbox',async()=>{
 const source=await read('worker-src/dashboard.ts'),a=source.indexOf('async function startHomeExtraction('),b=source.indexOf('\n',a),calls=[],errors=[];let target='both';
 const {startHomeExtraction}=await compile(source.slice(a,b),'startHomeExtraction',{$:id=>({checked:true}),busy:()=>{},saveHomeProfile:async()=>({id:'p',url:'https://shop.test/'}),homeJobTarget:()=>target,createJob:async(...args)=>{calls.push(args);return{}},output:()=>{},notice:()=>{},loadJobs:async()=>{},openResultModal:(_t,e)=>errors.push(e)});
 await startHomeExtraction('backend');await startHomeExtraction('manual');assert.deepEqual(calls,[['p','scrape','none',false,{workflow:'list-only'}],['p','scrape','both',false,{workflow:'full'}]]);
 target='none';await startHomeExtraction('manual');assert.equal(calls.length,2);assert.equal(errors.length,1);
});
test('benchmark engine selection does not overwrite a concurrently changed pagination configuration',async()=>{
 const {mergeBenchmarkProfile}=await compile(await read('worker-src/benchmark-profile.ts'),'mergeBenchmarkProfile');
 const original={url:'https://shop.test',pagination:'query_page',paginationValue:'page',selectors:{},extractionEngine:'auto'},current={...original,pagination:'next_selector',paginationValue:'a.next'};
 const result=mergeBenchmarkProfile(current,original,{...original,extractionEngine:'cheerio',extractionEngineBenchmarks:[]},{});assert.equal(result.extractionEngine,'auto');assert.equal(result.pagination,'next_selector');
});

test('list-only merge preserves manual category and descriptions without retaining a detail-cache acknowledgement',async()=>{
 const {mergeListOnly}=await compile(await read('worker-src/source-list-ledger.ts'),'mergeListOnly');
 const result=mergeListOnly({title:'New',price:120,shortDesc:''},{title:'Old',price:100,shortDesc:'Manual description',basalamCategoryId:42,sourceList:{valid:true}});
 assert.equal(result.title,'New');assert.equal(result.price,120);assert.equal(result.shortDesc,'Manual description');assert.equal(result.basalamCategoryId,42);assert.equal(result.sourceList,undefined);
});
