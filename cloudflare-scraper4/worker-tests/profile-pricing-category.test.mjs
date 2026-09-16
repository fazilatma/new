import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { build, transform } from 'esbuild';
import { load } from 'cheerio';

const read = path => readFile(new URL('../'+path,import.meta.url),'utf8');
const fixture = await read('worker-tests/fixtures/profile-pricing.html');
const $ = load(fixture);
const detailHtml = $('#detail').prop('outerHTML');
const BASE='https://shop.example/';
const profileBase={id:'p',name:'pricing',url:BASE,pages:1,pagination:'none',paginationValue:'',extractionEngine:'cheerio',extractionEngineMaster:'cheerio',titleSuffix:' (code)',priceMode:'percent',priceValue:10,roundPrice:0,minPrice:0,basalamCategoryId:0,aiDescriptions:true,selectors:{container:'.product',title:'h2',price:'.price, .detail-price',link:'a',image:'img',shortDesc:'.short'}};
// Real Worker parser on the same offline DOM as the extraction lab.
const HTML_VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
class CheerioHTMLRewriter {
  constructor() { this.registrations = []; }
  on(selector, handler) { load('<i></i>')(selector); this.registrations.push({ selector, handler }); return this; }
  transform(response) { return new Response(new ReadableStream({ start: async controller => { try { const source = await response.text(), $ = load(source, { decodeEntities: true }), roots = $.root().contents().toArray(); for (const root of roots) this.#walk($, root, []); controller.enqueue(new TextEncoder().encode($.html())); controller.close(); } catch (error) { controller.error(error); } } })); }
  #walk($, node, active) {
    if (node.type === 'text') { for (const handler of active) handler.text?.({ text: node.data || '', lastInTextNode: true }); return; }
    if (node.type === 'comment') return;
    const matching = [];
    if (node.type === 'tag') for (const registration of this.registrations) if ($(node).is(registration.selector)) matching.push(registration.handler);
    const callbacks = [], wrapper = {
      tagName: node.name, getAttribute: name => node.attribs?.[name] ?? null, setAttribute: (name, value) => $(node).attr(name, value), removeAttribute: name => $(node).removeAttr(name),
      before: (value) => $(node).before(value), after: (value) => $(node).after(value), remove: () => $(node).remove(), onEndTag: callback => { if (HTML_VOID_TAGS.has(String(node.name).toLowerCase())) throw Error('Parser error: No end tag.'); callbacks.push(callback); },
      get attributes() { return Object.entries(node.attribs || {}); }
    };
    for (const handler of matching) handler.element?.(wrapper);
    const scoped = [...active, ...matching]; for (const child of [...(node.children || [])]) this.#walk($, child, scoped);
    for (const callback of callbacks.reverse()) callback();
  }
}
globalThis.HTMLRewriter = CheerioHTMLRewriter;

const cache=new URL('../node_modules/.cache/scraper4-tests/',import.meta.url).pathname;
await mkdir(cache,{recursive:true});
const temp=await mkdtemp(join(cache,'price-category-'));
const twins={};
for(const runtime of ['render','worker']){
  const outfile=join(temp,runtime+'.cjs');
  await build({entryPoints:[new URL(`../${runtime}-src/scraper.ts`,import.meta.url).pathname],outfile,bundle:true,format:'cjs',platform:'node',packages:'external',plugins:[{name:'offline-fixture',setup(b){
    b.onResolve({filter:/^\.\/(network|db|connections)\.js$/},args=>({path:args.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path.includes('network')?`export const safeText=async url=>globalThis.__pricingPage(url); export const safeTextViaWorker=safeText; export const sourceRoute=async()=>({mode:'direct'});`:args.path.includes('db')?`export const getState=async(k,f)=>f;`:`export const loadConnections=async()=>({ai:{network:{mode:'direct'}}});`}));
  }}]});
  twins[runtime]=createRequire(import.meta.url)(outfile);
}
function pageFixture({detail=true}={}){
  globalThis.__pricingPage=async url=>({url,text:url.includes('/product/')?(detail?detailHtml:'<html></html>'):fixture,status:200});
}
async function compileFunctions(source,names,io={}){
  const code=(await transform(source.replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,''),{loader:'ts',target:'es2022'})).code;
  return new Function(...Object.keys(io),code+`;return {${names.join(',')}};`)(...Object.values(io));
}
async function aiHarness(runtime,overrides={}){
  const source=await read(`${runtime}-src/ai.ts`);
  const at=source.indexOf('export function productNeedsBasalamCategory');
  const end=source.indexOf('\n/**\n * Asks one configured',at);
  // Node helper/generator section is at EOF before the standalone suggester;
  // Worker ends this section immediately before leaderboard.
  const chunk=source.slice(at,runtime==='render'?end:source.indexOf('\nexport async function getLeaderboard',at));
  const events=[];
  const reply=async(...args)=>{const prompt=runtime==='render'?args[2]:args[2][0].content;events.push({type:'description',prompt});return {text:JSON.stringify({shortDesc:'Generated description',longDesc:'<p>'+('content '.repeat(12))+'</p>',variations:['large']})}};
  const io={findLearnedCategory:async()=>null,learnCategory:async()=>events.push({type:'learn'}),preferredAiChatModel:async()=>({provider:{id:'provider'},model:'model'}),suggestCategoryWithModel:async()=>{events.push({type:'category'});return{ok:true,categoryId:42,categoryName:'Shoes',categoryPath:'Clothing / Shoes'}},aiCall:reply,aiChat:reply,...overrides};
  return {...await compileFunctions(chunk,['generateProductDescription','assignProductBasalamCategory','productNeedsEnrichment','productNeedsBasalamCategory'],io),events};
}
const categories=[{id:42,name:'Shoes',path:'Clothing / Shoes',leaf:true},{id:17,name:'Manual',path:'Manual path',leaf:true}];
function product(extra={}){return{sourceKey:'shoe',title:'Shoe',url:BASE+'product/shoe',price:100000,priceText:'100000 تومان',images:[],image:'',...extra}}

for(const runtime of ['render','worker']){
  test(`${runtime}: actual detail parser then profile adjustment uses final source price and matching text`,async()=>{
    pageFixture();
    const p=await twins[runtime].scrapeDetails(product(),profileBase.selectors);
    assert.equal(p.price,200000);
    twins[runtime].transformProduct(p,profileBase);
    assert.equal(p.price,220000);
    assert.equal(twins[runtime].numberFromText?.(p.priceText) ?? Number(p.priceText.replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/\D/g,'')),220000);
    assert.equal(p.title,'Shoe (code)');
  });
  test(`${runtime}: all price modes, discounts, rounding, missing price and currency marker`,()=>{
    for(const [priceMode,priceValue,roundPrice,expected] of [['none',99,0,1010],['add',100,0,1110],['add',-100,0,910],['percent',10,100,1200],['percent',-10,0,909],['multiply',1.5,0,1515],['none',0,100,1100],['add',-2000,0,0]]){
      const p=twins[runtime].transformProduct(product({price:1010,priceText:'1010 ریال'}),{...profileBase,priceMode,priceValue,roundPrice});
      assert.equal(p.price,expected);assert.match(p.priceText,/ریال/,'Basalam must not multiply a rial price by ten');
    }
    assert.equal(twins[runtime].transformProduct(product({price:0}),{...profileBase,priceMode:'add',priceValue:500}).price,0);
  });
  test(`${runtime}: category model runs before description, and prompt includes Basalam path/id`,async()=>{
    const ai=await aiHarness(runtime),p=product();
    const result=await ai.generateProductDescription(p,{categories});
    assert.equal(result.ok,true);assert.deepEqual(ai.events.map(x=>x.type),['category','learn','description']);
    assert.match(ai.events.at(-1).prompt,/Clothing \/ Shoes/);assert.match(ai.events.at(-1).prompt,/42/);
    assert.equal(p.basalamCategoryId,42);assert.ok(result.fields.includes('basalamCategory'));
  });
  test(`${runtime}: category survives malformed/failed description and is reported for persistence`,async()=>{
    for(const fail of ['malformed','throw']){
      const answer=async()=>{if(fail==='throw')throw Error('offline model');return{text:'bad JSON'}};
      const ai=await aiHarness(runtime,{aiCall:answer,aiChat:answer}),p=product();
      const result=await ai.generateProductDescription(p,{categories});
      assert.equal(result.ok,false);assert.equal(result.changed,true);assert.deepEqual(result.fields,['basalamCategory']);assert.equal(p.basalamCategoryId,42);
    }
  });
  test(`${runtime}: existing/manual/learned categories are respected and category-only makes no description call`,async()=>{
    const ai=await aiHarness(runtime,{findLearnedCategory:async()=>({categoryId:42,categoryName:'Learned'})});
    for(const [extra,opts,id] of [[{basalamCategoryId:17},{},17],[{},{profileCategoryId:17},17],[{},{},42]]){
      const p=product(extra),result=await ai.generateProductDescription(p,{categories,categoryOnly:true,...opts});
      assert.equal(result.ok,true);assert.equal(p.basalamCategoryId,id);
    }
    assert.deepEqual(ai.events,[]);
  });
  test(`${runtime}: complete source description needs only category; invalid model IDs never stored`,async()=>{
    const ai=await aiHarness(runtime),p=product({shortDesc:'Real short description',longDesc:'Real long description '.repeat(5),variations:['real']});
    await ai.generateProductDescription(p,{categories});assert.deepEqual(ai.events.map(x=>x.type),['category','learn']);
    const bad=await aiHarness(runtime,{suggestCategoryWithModel:async()=>({ok:true,categoryId:999})}),q=product();
    const result=await bad.assignProductBasalamCategory(q,{categories});assert.equal(result.ok,false);assert.equal(q.basalamCategoryId,undefined);
    await bad.generateProductDescription(q,{skipCategory:true});assert.ok(q.shortDesc,'category failure must not block description fallback');
  });
}

async function pipeline(runtime,options={}){
  pageFixture({detail:options.detail!==false});
  if(options.rescue){
    let reads=0;
    const page=globalThis.__pricingPage;
    globalThis.__pricingPage=async url=>{const result=await page(url);if(url.includes('/product/')&&++reads>=3)result.text=result.text.replace('۲۰۰٬۰۰۰','۲۵۰٬۰۰۰');return result};
  }
  const ai=await aiHarness(runtime);
  const profile={...structuredClone(profileBase),...options.profile};
  const job={id:'j',profileId:'p',kind:options.syncOnly?'sync':'scrape',target:options.target||'none',status:'running',log:[],total:0,processed:0,added:0,updated:0,failed:0};
  const saved=[],states=new Map(),snapshots=[],syncs=[];
  const list=async()=>({url:BASE,nextUrl:'',usedEngine:'cheerio',products:structuredClone(options.products||[product()])});
  const {createAiStageRunner}=await compileFunctions(await read('worker-src/job-ai-stage.ts'),['createAiStageRunner']);
  const io={...ai,...twins[runtime],createAiStageRunner,applyStoredResultSettings:async()=>({changed:0,conflicts:0,next:null}),
    scrapeListPage:list,scrapeListWithMeta:list,
    listSelectorsStatus:()=> 'custom',suggestSelectors:async()=>({selectors:options.rescue?{shortDesc:'.short',price:'.detail-price'}:{}}),
    claimJob:async()=>{job.status='running';return job},getJob:async()=>job,getProfile:async()=>profile,
    getState:async(k,f)=>k==='ai_description_settings'?{enabled:options.enabled!==false}:structuredClone(states.get(k)??f),
    setState:async(k,v)=>{states.set(k,structuredClone(v));snapshots.push(structuredClone(v))},deleteState:async k=>states.delete(k),
    updateJob:async(id,patch)=>Object.assign(job,patch),stopRequested:async()=>false,saveProfile:async()=>{},markProfileRun:async()=>{},
    upsertProduct:async(id,p,opts)=>{assert.equal(opts?.source,true);twins[runtime].transformProduct(p,profile);saved.push(structuredClone(p));return'added'},getProduct:async(id,key)=>saved.findLast(p=>p.sourceKey===key)||options.previous||null,
    allProducts:async()=>structuredClone(saved.length?saved:options.products||[]),listProducts:async()=>({products:structuredClone(options.products||[]),total:(options.products||[]).length}),
    findMissingProducts:async()=>[],markMissingProducts:async()=>0,destinationCategories:async()=>({items:categories}),
    syncWoo:async p=>{syncs.push(structuredClone(p));return'updated'},syncBasalam:async()=>[],
    getEnv:()=>({JOB_CHUNK_SIZE:options.chunkSize||1}),pushJobFinished:async()=>{},
    message:e=>e.message,hasCodeSuffix:()=>true,parseSuffixFormats:()=>[],suffixPatterns:()=>[]
  };
  if(options.aiFailure){io.assignProductBasalamCategory=async()=>{ai.events.push({type:'category-failed'});return{ok:false,error:'offline'}};io.generateProductDescription=async()=>{ai.events.push({type:'description-failed'});return{ok:false,error:'offline'}}}
  if(runtime==='render')delete io.message;
  const source=await read(`${runtime}-src/processor.ts`);
  const name=runtime==='render'?'processOneJob':'processJob';
  if(options.inline){
    const api=await read(runtime==='render'?'render-src/server.ts':'worker-src/app.ts');
    const start=api.indexOf('async function runProfileApi('),end=api.indexOf(runtime==='render'?'\nfunction normalizeProfile':'\nasync function createProfileJob',start);
    const inline=await compileFunctions(api.slice(start,end),['runProfileApi'],{...io,jsonBody:c=>c.req.json(),validTarget:x=>x,isManualListEngine:()=>true,applyInlineSelectorSuggestions:async()=>null,message:e=>e.message});
    const result=await inline.runProfileApi({req:{json:async()=>options.body||{}},env:{DETAIL_CONCURRENCY:1},json:(body,status=200)=>({body,status})},'p');
    return {saved,syncs,events:ai.events,...result};
  }
  const mod=await compileFunctions(source,[name],io);
  if(options.checkpoint)states.set('job_checkpoint:j',structuredClone(options.checkpoint));
  let result,runs=0;
  do{result=await mod[name]('j');assert.ok(++runs<10,'checkpoint must advance over skipped products')}while(result==='continue');
  assert.notEqual(job.status,'failed',job.error);
  return {job,saved,snapshots,syncs,events:ai.events};
}
for(const runtime of ['render','worker']){
  test(`${runtime}: real queued pipeline keeps adjustment after details, category before description, minPrice after final pricing`,async()=>{
    const run=await pipeline(runtime,{profile:{minPrice:210000}});
    assert.equal(run.saved.length,1);assert.equal(run.saved[0].price,220000);assert.equal(run.saved[0].title,'Shoe (code)');
    assert.deepEqual(run.events.map(x=>x.type),['category','learn','description']);
    assert.ok(run.job.log.some(x=>x.message.includes('باسلام')));
  });
  test(`${runtime}: category stage still runs with either description switch off`,async()=>{
    for(const options of [{enabled:false},{profile:{aiDescriptions:false}}]){
      const run=await pipeline(runtime,options);assert.equal(run.saved[0].basalamCategoryId,42);assert.deepEqual(run.events.map(x=>x.type),['category','learn']);
    }
  });
  test(`${runtime}: list-only fallback and stored-only sync do not compound prices/suffixes`,async()=>{
    const run=await pipeline(runtime,{detail:false});assert.equal(run.saved[0].price,110000);
    const sync=await pipeline(runtime,{syncOnly:true,target:'woo',products:run.saved});assert.equal(sync.syncs[0].price,110000);assert.equal(sync.syncs[0].title,'Shoe (code)');assert.deepEqual(sync.events,[]);
  });
  test(`${runtime}: minimum price limits delivery without discarding stored Results`,async()=>{
    const run=await pipeline(runtime,{profile:{minPrice:215000,priceValue:-10},target:'woo'});assert.equal(run.saved.length,1);assert.equal(run.saved[0].price,180000);assert.equal(run.syncs.length,0);
  });
}
test('worker: raw checkpoints survive multiple chunks; missing prices advance without using previous adjusted price',async()=>{
  const run=await pipeline('worker',{detail:false,profile:{priceMode:'add',priceValue:100},products:[product({sourceKey:'zero',price:0}),product({sourceKey:'a'}),product({sourceKey:'b'})],previous:product({price:110000,title:'Shoe (code)',basalamCategoryId:17})});
  assert.equal(run.saved.length,2);assert.ok(run.saved.every(p=>p.price===100100&&p.title==='Shoe (code)'&&p.basalamCategoryId===17));
  for(const cp of run.snapshots.filter(x=>x.products))assert.deepEqual(cp.products.map(p=>p.price),[0,100000,100000]);
});
test('worker: replaying a raw checkpoint never reapplies markup to a stored price',async()=>{
  const checkpoint={rawPricing:true,page:1,url:BASE,nextUrl:'',index:0,seen:[],retireSafe:true,detailRescued:true,products:[product()]};
  for(let retry=0;retry<2;retry++){
    const run=await pipeline('worker',{detail:false,checkpoint,previous:product({price:110000})});assert.equal(run.saved[0].price,110000);
  }
});
for(const runtime of ['render','worker']){
  test(`${runtime}: inline extraction prices final details, assigns category and supports nonpersisted preview`,async()=>{
    for(const persist of [true,false]){
      const run=await pipeline(runtime,{inline:true,body:{persist},profile:{minPrice:210000,basalamCategoryId:17,aiDescriptions:false}});
      assert.equal(run.status,200);assert.equal(run.body.products.length,1);assert.equal(run.body.products[0].price,persist?220000:200000);assert.equal(run.body.products[0].basalamCategoryId,17);assert.equal(run.saved.length,persist?1:0);assert.deepEqual(run.events,[]);
    }
  });
  test(`${runtime}: inline stored-only delivery never re-transforms or reclassifies products`,async()=>{
    const p=product({price:220000,title:'Shoe (code)',basalamCategoryId:17});
    const run=await pipeline(runtime,{inline:true,body:{extract:false,target:'woo'},products:[p]});
    assert.equal(run.syncs[0].price,220000);assert.equal(run.syncs[0].title,'Shoe (code)');assert.equal(run.saved.length,0);assert.deepEqual(run.events,[]);
  });
}
for(const runtime of ['render','worker']){
  test(`${runtime}: selector rescue replaces the source price BEFORE the single adjustment`,async()=>{
    const run=await pipeline(runtime,{rescue:true});assert.equal(run.saved[0].price,275000);assert.equal(run.saved[0].title,'Shoe (code)');
  });
  test(`${runtime}: unavailable model does not lose an assigned manual category`,async()=>{
    for(const lookup of [async()=>null,async()=>{throw Error('lookup offline')}]){
      const ai=await aiHarness(runtime,{preferredAiChatModel:lookup}),p=product();
      const result=await ai.generateProductDescription(p,{profileCategoryId:17});assert.equal(result.changed,true);assert.equal(result.ok,false);assert.deepEqual(result.fields,['basalamCategory']);assert.equal(p.basalamCategoryId,17);
    }
  });
}
test('worker: legacy adjusted checkpoint is re-extracted instead of compounded',async()=>{
  const checkpoint={page:1,url:BASE,nextUrl:'',index:0,seen:[],retireSafe:true,products:[product({price:110000,title:'Shoe (code)'})]};
  const run=await pipeline('worker',{detail:false,checkpoint});assert.equal(run.saved[0].price,110000);assert.equal(run.saved[0].title,'Shoe (code)');
});

for(const runtime of ['render','worker'])test(runtime+': failed AI substages are skipped while saved-product delivery continues',async()=>{
 const run=await pipeline(runtime,{aiFailure:true,target:'woo',products:Array.from({length:5},(_,i)=>product({sourceKey:'p'+i}))});
 assert.equal(run.saved.length,5);assert.equal(run.syncs.length,5);assert.equal(run.events.filter(e=>e.type==='category-failed').length,3);assert.equal(run.events.filter(e=>e.type==='description-failed').length,3);assert.equal(run.job.status,'done');
});
