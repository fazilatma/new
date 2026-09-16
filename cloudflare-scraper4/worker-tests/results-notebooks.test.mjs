import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
import {parseHTML} from 'linkedom';
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
async function functions(source,names,io={}){
 const js=(await transform(source.replace(/\bexport /g,''),{loader:'ts'})).code;
 return new Function(...Object.keys(io),js+';return {'+names.join(',')+'};')(...Object.values(io));
}
const {applyResultAdjustments}=await functions(await read('worker-src/result-adjustments.ts'),['applyResultAdjustments']);
const profile={titleSuffix:' (کد:20)',priceMode:'percent',priceValue:10,roundPrice:0};
test('stored Results settings replace previous settings instead of compounding them',()=>{
 const p={title:'Shoe',price:100000,priceText:'100000 تومان',sourceKey:'shoe'};
 applyResultAdjustments(p,profile);assert.equal(p.price,110000);
 applyResultAdjustments(p,profile);assert.equal(p.price,110000);assert.equal(p.title,'Shoe (کد:20)');
 applyResultAdjustments(p,{...profile,priceValue:20,titleSuffix:' (کد:30)'});assert.equal(p.price,120000);assert.equal(p.title,'Shoe (کد:30)');
 applyResultAdjustments(p,{...profile,priceMode:'none',titleSuffix:''});assert.equal(p.price,100000);assert.equal(p.title,'Shoe');
});
test('generated code suffix is actually stored, with a stable saved baseline',()=>{
 const p={title:'Shoe',price:100,priceText:'100 ریال',sku:'ABC'};
 applyResultAdjustments(p,{...profile,titleSuffix:''},'(کد:x)');assert.equal(p.title,'Shoe (کد:ABC)');assert.match(p.priceText,/ریال/);
 applyResultAdjustments(p,{...profile,titleSuffix:''},'#x');assert.equal(p.title,'Shoe #ABC');assert.equal(p.price,110);
});
for(const runtime of ['render','worker']){
 test(`${runtime}: per-product notebooks survive repeated rounds and are deleted only by complete-inventory cleanup`,async()=>{
  const src=await read(`${runtime}-src/db.ts`),a=src.indexOf('const CATEGORY_NOTEBOOK_PREFIX'),b=src.indexOf(runtime==='render'?'export async function addAutoreplyLog':'export async function getState',a),state=new Map();
  const entries=()=>[...state.keys()].filter(key=>key.startsWith('basalam_category_notebook_v2:')).map(key=>({key}));
  const prune=async(q,params)=>{assert.match(q,/DELETE FROM app_state/);const keep=new Set(JSON.parse(params[0]));let count=0;for(const {key} of entries())if(!keep.has(key)){state.delete(key);count++}return count};
  const io={useSqlite:true,run:prune,getState:async(k,f)=>structuredClone(state.get(k)??f),setState:async(k,v)=>state.set(k,structuredClone(v)),deleteState:async k=>state.delete(k),pool:{query:async(q,p)=>({rowCount:await prune(q,p)})},rows:async()=>entries()};
  const db=await functions(src.slice(a,b),['getTriedBasalamCategories','markBasalamCategoriesTried','pruneBasalamCategoryNotebooks'],io);
  await Promise.all([db.markBasalamCategoriesTried('a',1,[101,102]),db.markBasalamCategoriesTried('b',1,[201])]);
  assert.deepEqual(await db.getTriedBasalamCategories('a',1),[101,102]);assert.deepEqual(await db.getTriedBasalamCategories('b',1),[201]);
  await db.markBasalamCategoriesTried('a',1,Array.from({length:70},(_,i)=>1000+i));assert.equal((await db.getTriedBasalamCategories('a',1)).length,72,'older attempts must not be evicted and retried');
  assert.equal(await db.pruneBasalamCategoryNotebooks([{shopId:'a',id:1}]),1);assert.deepEqual(await db.getTriedBasalamCategories('b',1),[]);
  await db.pruneBasalamCategoryNotebooks([]);assert.equal(entries().length,0);
 });
 test(`${runtime}: models see only untried categories, and successful/ambiguous attempts are remembered`,async()=>{
  const path=runtime==='render'?'render-src/category-run.ts':'worker-src/background.ts',src=await read(path),a=src.indexOf('async function categorizeProduct('),b=src.indexOf('async function categorizeBatch(',a),attempts=new Set([101]),applied=[],offered=[];
  let fail=false;
  const io={getTriedBasalamCategories:async()=>[...attempts],markBasalamCategoriesTried:async(s,id,ids)=>ids.forEach(x=>attempts.add(x)),suggestCategoryWithModel:async(t,k,cats)=>{offered.push(cats.map(c=>c.id));return{ok:true,categoryId:cats[0].id}},applyBasalamCategory:async(id,s,cat)=>{assert.ok(attempts.has(cat),'record before the network call');applied.push(cat);if(fail)throw Error('ambiguous timeout')},appendCategoryItem:(run,item)=>run.items.push(item),readRun:async()=>null};
  const {categorizeProduct}=await functions(src.slice(a,b),['categorizeProduct'],io);
  const run=()=>({modelKeys:['p::m'],items:[],cursor:0,processed:0,changed:0,failed:0});const p={id:1,shopId:'a',title:'Shoe',categoryId:102},cats=[101,102,103,104].map(id=>({id}));
  await categorizeProduct(run(),p,cats);assert.deepEqual(offered[0],[103,104]);assert.deepEqual(applied,[103]);
  fail=true;await categorizeProduct(run(),p,cats);assert.deepEqual(offered[1],[104]);assert.ok(attempts.has(104));
  const last=run();await categorizeProduct(last,p,cats);assert.equal(offered.length,2,'exhaustion must not spend an AI call or repeat an old category');assert.equal(last.failed,1);
 });
 test(`${runtime}: notebook pruning waits for all pages and skips partially failed shop listings`,async()=>{
  const path=runtime==='render'?'render-src/category-run.ts':'worker-src/background.ts',src=await read(path),a=src.indexOf('async function listCategoryProducts('),end=src.indexOf('\n}',a)+2;
  let complete=false,pruned=0;
  const fn=await functions(src.slice(a,end),['listCategoryProducts'],{destinationCatalog:async()=>({products:[],totalPages:2,complete}),pruneBasalamCategoryNotebooks:async()=>pruned++,writeRun:async()=>{}});
  const run={page:1,totalPages:1,products:[]};await fn.listCategoryProducts(run);assert.equal(pruned,0);complete=true;await fn.listCategoryProducts(run);assert.equal(pruned,0,'a failed first page remains unsafe at the final page');
  const fresh={page:1,totalPages:1,products:[]};await fn.listCategoryProducts(fresh);assert.equal(pruned,0);await fn.listCategoryProducts(fresh);assert.equal(pruned,1);
 });
}
test('live category-dialog refresh preserves both vertical and horizontal scroll offsets',async()=>{
 const src=await read('worker-src/dashboard.ts'),a=src.indexOf('function modalShell('),b=src.indexOf('\n',a),{document}=parseHTML('<html><body></body></html>');
 const modal=new Function('document','$','esc',src.slice(a,b)+';return modalShell;')(document,id=>document.getElementById(id),String);
 const html='<div class="result-table-wrap"><table><tr><td>Rows</td></tr></table></div>';
 modal('Category',html);const root=document.getElementById('resultModal');root.scrollTop=44;root.querySelector('.result-box').scrollTop=321;root.querySelector('.result-body').scrollTop=250;root.querySelector('.result-table-wrap').scrollLeft=180;
 modal('Progress',html,false,true);assert.equal(root.scrollTop,44);assert.equal(root.querySelector('.result-box').scrollTop,321);assert.equal(root.querySelector('.result-body').scrollTop,250);assert.equal(root.querySelector('.result-table-wrap').scrollLeft,180);
 const start=src.indexOf('function renderCategoryAllRun('),line=src.slice(start,src.indexOf('\n',start));assert.match(line,/dataset.categoryRun===String\(run.id\)/,'only polling the same run should preserve its previous position');
});
test('variant-specific prices use the same stable saved baseline',()=>{
 const p={title:'Shoe',price:100,priceText:'100 تومان',variationPrices:{red:200},variationGroups:[{name:'Color',prices:{red:200}}]};
 applyResultAdjustments(p,profile);assert.equal(p.variationPrices.red,220);assert.equal(p.variationGroups[0].prices.red,220);
 applyResultAdjustments(p,{...profile,priceValue:20});assert.equal(p.variationPrices.red,240);assert.equal(p.variationGroups[0].prices.red,240);
});
for(const runtime of ['render','worker'])test(`${runtime}: stored Results apply paginates stably and protects concurrent edits`,async()=>{
 const source=await read(`${runtime}-src/db.ts`),a=source.indexOf('export async function applyStoredResultSettings('),records=new Map(Array.from({length:45},(_,i)=>{const key=String(i).padStart(3,'0');return[key,JSON.stringify({sourceKey:key,title:'Shoe',price:100000,priceText:'100000 تومان'})]}));
 let conflict=false;
 const query=async(sql,params=[])=>{
  if(sql.startsWith('SELECT')){assert.match(sql,/ORDER BY source_key/);return{rows:[...records].filter(([key])=>key>params[1]).slice(0,20).map(([source_key,data])=>({source_key,data:runtime==='render'?JSON.parse(data):data}))}}
  const key=params.at(-2),old=params.at(-1);
  if(conflict&&key==='007')return{rowCount:0};
  assert.equal(old,records.get(key),'optimistic compare uses the original JSON, including on PostgreSQL');records.set(key,params[0]);return{rowCount:1};
 };
 const io={pool:{query},rows:async(q,p)=>(await query(q,p)).rows,run:async(q,p)=>(await query(q,p)).rowCount,getState:async()=>({}),now:()=>new Date().toISOString(),parseJson:(x)=>typeof x==='string'?JSON.parse(x):x,json:x=>JSON.parse(x),validProductRow:p=>p&&typeof p==='object',applyResultAdjustments};
 const {applyStoredResultSettings}=await functions(source.slice(a),['applyStoredResultSettings'],io);
 const apply=async(p)=>{let after='',changed=0,conflicts=0;do{const result=await applyStoredResultSettings(p,after);changed+=result.changed;conflicts+=result.conflicts;after=result.next}while(after);return{changed,conflicts}};
 assert.deepEqual(await apply({...profile,id:'p'}),{changed:45,conflicts:0});assert.ok([...records.values()].every(raw=>JSON.parse(raw).price===110000));
 conflict=true;assert.deepEqual(await apply({...profile,id:'p',priceValue:20}),{changed:44,conflicts:1});assert.equal(JSON.parse(records.get('007')).price,110000);assert.equal(JSON.parse(records.get('008')).price,120000);
});
test('a Results card headline is the stored price, not an unlabeled destination markup',async()=>{
 const src=await read('worker-src/dashboard.ts'),a=src.indexOf('function headlineFinalPrice('),b=src.indexOf('\n',a);
 const headline=new Function(src.slice(a,b)+';return headlineFinalPrice;')();assert.equal(headline({price:120000}),120000);
});
