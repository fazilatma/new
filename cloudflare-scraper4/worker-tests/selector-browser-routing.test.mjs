import test from 'node:test';
import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),read=f=>readFile(join(root,f),'utf8');
async function compile(source,names,io={}){const js=(await transform(source,{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names.join(',')+'};')(...Object.values(io))}
const temp=await mkdtemp(join(root,'node_modules/.cache/selector-worker-'));
await build({entryPoints:[join(root,'worker-src/scraper.ts')],outfile:join(temp,'worker.cjs'),bundle:true,platform:'browser',format:'cjs',logLevel:'silent'});
const worker=createRequire(import.meta.url)(join(temp,'worker.cjs'));
for(const engine of ['playwright','puppeteer','crawlee_playwright','network_api'])test('Worker rejects '+engine+' on all four tools before fetching',async()=>{
 const calls=[()=>worker.suggestSelectors('https://shop.example','list',engine),()=>worker.suggestSelectors('https://shop.example','detail',engine),()=>worker.testSelector('https://shop.example','.sku','text',engine),()=>worker.testGallery('https://shop.example','.gallery',5,false,engine),()=>worker.testVariations('https://shop.example','.variations',engine)];
 for(const call of calls)await assert.rejects(call(),/Node.*VPS.*Termux/);
});
for(const runtime of ['render','worker'])test(runtime+': real HTTP handlers forward the selected engine on suggestions and all selector test kinds',async()=>{
 const source=await read(runtime+'-src/'+(runtime==='render'?'server.ts':'app.ts')),handlers={},calls=[];
 const spy=name=>async(...args)=>{calls.push({name,args});return{count:1,values:['value']}};
 const io={app:{post:(path,handler)=>handlers[path]=handler},jsonBody:c=>c.req.json(),suggestSelectors:spy('suggest'),testSelector:spy('test'),testGallery:spy('gallery'),testVariations:spy('variations')};
 for(const route of ['/api/suggest-selectors','/api/test-selector']){const start=source.indexOf("app.post('"+route+"'");let end=source.indexOf('\n',start);if(runtime==='render'&&route==='/api/test-selector')end=source.indexOf('\n});',start)+4;await compile(source.slice(start,end),[],io)}
 for(const engine of ['playwright','puppeteer','crawlee_playwright','network_api'])for(const type of ['text','link','image','gallery','variations']){
  const body={url:'https://shop.example',selector:'.sku',mode:'detail',type,engine,max:3,skipFirst:true},ctx={req:{json:async()=>body},json:x=>x};
  await handlers['/api/suggest-selectors'](ctx);assert.deepEqual(calls.at(-1).args,[body.url,'detail',engine]);
  await handlers['/api/test-selector'](ctx);assert.ok(calls.at(-1).args.includes(engine));if(runtime==='render')assert.deepEqual(calls.at(-1).args.at(-1),{max:3,skipFirst:true});
 }
});
test('actual subtab 2 and 3 buttons use the current unsaved dropdown, not the saved profile or parser',async()=>{
 const source=await read('worker-src/dashboard.ts'),start=source.indexOf('async function suggestSelectorFields()'),end=source.indexOf('const dest=',start),calls=[],elements=new Map();
 const $=id=>{if(!elements.has(id))elements.set(id,{value:id==='extractionEngine'?'puppeteer':id.toLowerCase().includes('url')?'https://shop.example':'.sku',textContent:'',classList:{add:()=>{},toggle:()=>{}},disabled:false});return elements.get(id)};
 const io={$,busy:()=>{},api:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return{count:1,values:['rendered'],selectors:{title:'h2',sku:'.sku'},evidence:{}}},listFields:[['title','Title']],detailFields:[['sku','SKU'],['variations','Variants']],fa:String,notice:()=>{},output:()=>{},openResultModal:()=>{},updateDetailSummary:()=>{},galleryConfig:()=>({max:3,skip_first:true}),gallerySelector:()=>'.gallery',galModeChanged:()=>{},loadGallery:()=>{}};
 const names=['suggestSelectorFields','suggestDetailFields','testSelectors','testDetailSelectors','testGallery'],ui=await compile(source.slice(start,end),names,io);
 for(const engine of ['playwright','puppeteer','crawlee_playwright','network_api','cheerio']){
  $('extractionEngine').value=engine;
  for(const name of names){calls.length=0;await ui[name]();assert.ok(calls.length,name);for(const call of calls)assert.equal(call.body.engine,engine,name)}
 }
});
