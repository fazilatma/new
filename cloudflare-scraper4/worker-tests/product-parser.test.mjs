import test from 'node:test';
import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {readFile,mkdtemp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CheerioHTMLRewriter} from './product-parser-html-rewriter.mjs';
globalThis.HTMLRewriter=CheerioHTMLRewriter;
const root=fileURLToPath(new URL('..',import.meta.url)),read=f=>readFile(join(root,f),'utf8');
const temp=await mkdtemp(join(root,'node_modules/.cache/product-parser-')),req=createRequire(import.meta.url);
let downloads=0;globalThis.__parserDownload=async url=>{downloads++;return{text:globalThis.__parserHtml,url,contentType:'text/html'}};
async function bundle(runtime,before=false){
 const original=before?execFileSync('git',['show',`2a7f7da:cloudflare-scraper4/${runtime}-src/scraper.ts`],{cwd:root,encoding:'utf8'}):null;
 const outfile=join(temp,`${runtime}-${before}.cjs`);
 await build({entryPoints:[join(root,runtime+'-src/scraper.ts')],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'offline',setup(b){
 if(original)b.onLoad({filter:new RegExp(runtime+'-src/scraper.ts$')},()=>({contents:original,loader:'ts',resolveDir:join(root,runtime+'-src')}));
 b.onResolve({filter:/^(\.\/network\.js|\.\/db\.js|\.\/connections\.js)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('network')?`export const safeText=(...a)=>globalThis.__parserDownload(...a),safeTextViaWorker=safeText,sourceRoute=()=> 'direct',assertPublicUrl=async()=>{},safeFetch=async()=>{throw Error('Unexpected network')};`:a.path.includes('connections')?'export const loadConnections=async()=>({ai:{network:{}}});':'export const getState=async(_k,value)=>value;'}));
 }}]});return req(outfile);
}
await build({entryPoints:[join(root,'worker-src/product-parser.ts')],outfile:join(temp,'options.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const options=req(join(temp,'options.cjs'));
const BASE='https://shop.example/catalog',selectors={container:'.product-card',title:'.card-title',price:'.card-price',link:'.card-title',image:'img'};
const cards=await read('worker-tests/fixtures/patris-cards.html');
const product={name:'Embedded product sample',price:125000,url:'/product/embedded',image:'/embedded.jpg'};
const ld='<script type="application/ld+json">'+JSON.stringify({'@type':'Product',...product,offers:{price:125000,url:product.url}})+'</script>';
const next='<script id="__NEXT_DATA__" type="application/json">'+JSON.stringify({props:{pageProps:{products:[product]}}})+'</script>';
const nuxt='<script>window.__NUXT__='+JSON.stringify({products:[product]})+';</script>';
const plain='<script type="application/json">'+JSON.stringify({products:[product]})+'</script>';
const meta='<meta property="og:type" content="product"><meta property="og:title" content="Metadata product"><meta property="product:price:amount" content="125000"><meta property="og:image" content="/meta.jpg">';
test('missing/false switch ignores stored parser; only literal true enables; invalid pin rejected',()=>{
 for(const raw of [{},{productParser:'jsonld'},{productParserEnabled:false,productParser:'invalid'},{productParserEnabled:'true'}])assert.equal(options.selectedProductParser(raw),undefined);
 assert.deepEqual(options.normalizeProductParser({}),{productParserEnabled:false,productParser:'auto'});
 assert.equal(options.selectedProductParser({productParserEnabled:true,productParser:'jsonld'}),'jsonld');
 assert.throws(()=>options.selectedProductParser({productParserEnabled:true,productParser:'invalid'}),/Unknown/);
});
test('dispatcher calls only the pinned strategy, including empty results and exceptions',async()=>{
 for(const parser of options.PRODUCT_PARSERS.filter(x=>x!=='auto')){const calls=[],readers=Object.fromEntries(options.PRODUCT_PARSERS.filter(x=>x!=='auto').map(x=>[x,()=>{calls.push(x);return []}]));assert.deepEqual(await options.parseDownloadedProducts(parser,readers),[]);assert.deepEqual(calls,[parser]);readers[parser]=()=>{throw Error('broken')};await assert.rejects(options.parseDownloadedProducts(parser,readers),/broken/);}
});
for(const runtime of ['render','worker']){
 const current=await bundle(runtime),before=await bundle(runtime,true);
 const scrape=(mod,parser,sel=selectors)=>runtime==='render'?mod.scrapeListWithMeta(BASE,sel,'auto',undefined,true,'.next',true,false,false,undefined,undefined,parser):mod.scrapeListPage(BASE,sel,'.next',false,'auto',undefined,true,true,false,parser);
 for(const [parser,html] of [['auto',ld],['lxml',cards],['selectolax',cards],['jsonld',ld],['next_data',next],['script_json',plain],['metadata',meta],['heuristic',cards]])test(runtime+': '+parser+' extracts downloaded HTML',async()=>{downloads=0;const rows=await current.parseProductDocument(html,BASE,selectors,parser);assert.ok(rows.length>0,parser);assert.ok(rows[0].price>0);assert.equal(downloads,0)});
 test(runtime+': anchor-wrapped cards need repeating anchor container and real image nodes',async()=>{
 const html=await read('worker-tests/fixtures/snapp-like-rendered-cards.html');
 const bad={container:'//*[@id="dq6e01"]/div[1]/div/div/div[3]/a[1]/article',title:'#dq6e01 > div.pt-l.pb-xxl-4.container > div > div > div.PLPSection_plp-products-container__HSjLH.pt-l.pb-s > a:nth-child(1) > article > div > div.ProductCard_product-card__content-container__J8M0n.border-gray-300 > h3',price:'div.productPrice__new',link:'li.product-scroll',image:'div.product__image'};
 const rows=await current.parseProductDocument(html,BASE,bad,'lxml');assert.equal(rows.length,1);assert.ok(rows[0].title);if(runtime==='render')assert.equal(rows[0].image,''); // Worker retains its existing image fallback.
 assert.equal(rows[0].price,0);
 const corrected={container:'div[class*="PLPSection_plp-products-container"] > a',title:'[class*="ProductCard_product-card__content-container"] h3',price:'.fixture-price',link:'a',image:'img'};
 const good=await current.parseProductDocument(html,BASE,corrected,'lxml');assert.equal(good.length,2);for(const row of good){assert.match(row.url,/\/product\/pot-/);assert.match(row.image,/https:\/\/shop.example\/images\/pot-/);assert.ok(row.price>0)}
 assert.equal(bad.container,'//*[@id="dq6e01"]/div[1]/div/div/div[3]/a[1]/article');
 });
 test(runtime+': Next/Nuxt and script JSON families are explicit JSON-only readers',async()=>{for(const html of [next,nuxt])assert.equal((await current.parseProductDocument(html,BASE,selectors,'next_data')).length,1);for(const html of [ld,next,nuxt,plain])assert.equal((await current.parseProductDocument(html,BASE,selectors,'script_json')).length,1);assert.equal((await current.parseProductDocument('<script>window.__NUXT__=(()=>{throw Error("never evaluate")})()</script>',BASE,selectors,'next_data')).length,0)});
 test(runtime+': pinned JSON-LD never rescues cards, metadata or next data',async()=>{for(const html of [cards,meta,next])assert.equal((await current.parseProductDocument(html,BASE,selectors,'jsonld')).length,0)});
 test(runtime+': stage shares one fetched page with next-link extraction and does not learn selectors',async()=>{downloads=0;globalThis.__parserHtml=ld+'<a class="next" href="?page=2">Next</a>';const r=await scrape(current,'jsonld');assert.equal(downloads,1);assert.equal(r.products.length,1);assert.equal(r.nextUrl,BASE+'?page=2');assert.equal(r.discoveredSelectors,undefined)});
 test(runtime+': OFF matches published 1.214.1 extraction, fallback and discoveries',async()=>{
 const stable=value=>JSON.parse(JSON.stringify(value,(key,value)=>['elapsedMs','scrapedAt'].includes(key)?undefined:value));
 for(const html of [cards,ld,next,meta,'<html>Nothing here</html>'])for(const sel of [selectors,{container:'li.product',title:'h2',price:'.price',link:'a',image:'img'}]){
  globalThis.__parserHtml=html;downloads=0;const old=await scrape(before,undefined,sel),oldCount=downloads;downloads=0;const now=await scrape(current,options.selectedProductParser({productParserEnabled:false,productParser:'jsonld'}),sel);assert.deepEqual(stable(now),stable(old));assert.equal(downloads,oldCount);
 }
 });
}
async function compile(source,names,io={}){const js=(await transform(source.replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,''),{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names.join(',')+'};')(...Object.values(io))}
for(const runtime of ['render','worker'])test(runtime+': actual profile normalization preserves JSON round trips, defaults OFF and ignores disabled selection',async()=>{
 const source=await read(runtime+'-src/'+(runtime==='render'?'server.ts':'app.ts')),a=source.indexOf('function normalizeProfile('),b=source.indexOf('\n}',a)+2;
 const {normalizeProfile}=await compile(source.slice(a,b),['normalizeProfile'],{normalizeProductParser:options.normalizeProductParser,DEFAULT_SELECTORS:selectors,idFromUrl:()=> 'profile',on:x=>x===true,booleanValue:x=>x===true,selectorRecord:x=>x||{},normalizedGallery:()=>undefined});
 for(const parser of options.PRODUCT_PARSERS){const profile=normalizeProfile({id:'p',url:BASE,productParserEnabled:true,productParser:parser});const again=normalizeProfile(JSON.parse(JSON.stringify(profile)));assert.equal(again.productParserEnabled,true);assert.equal(again.productParser,parser);assert.equal(normalizeProfile({...again,productParserEnabled:false}).productParser,parser)}
 assert.equal(normalizeProfile({url:BASE}).productParserEnabled,false);
});
test('both dashboard dropdowns have precisely the eight IDs and honest disabled-by-default labels',async()=>{
 const {load}=await import('cheerio'),source=await read('worker-src/dashboard.ts');
 for(const id of ['productParser','homeProductParser']){const start=source.indexOf('<select id="'+id+'"'),end=source.indexOf('</select>',start)+9,$=load(source.slice(start,end));assert.equal($('select').prop('disabled'),true);assert.deepEqual($('option').toArray().map(x=>$(x).attr('value')),options.PRODUCT_PARSERS);assert.match($('option[value="lxml"]').text(),/JS-compatible/);assert.match($('option[value="selectolax"]').text(),/JS-compatible/)}
});
test('actual dashboard render, switch listeners and both save bodies preserve enablement and selection',async()=>{
 const {parseHTML}=await import('linkedom'),source=await read('worker-src/dashboard.ts');
 const names=['renderHomeProfile','homeProfileBody','profileBody'];const code=source.split('\n').filter(line=>names.some(name=>line.startsWith('function '+name+'('))||line.startsWith("for(const pair of [['homeProductParserEnabled'")).join('\n');
 const ids=[...new Set([...code.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]))];let html=ids.map(id=>'<input id="'+id+'" value="">').join('');
 for(const id of ['productParser','homeProductParser']){const start=source.indexOf('<select id="'+id+'"');html+=source.slice(start,source.indexOf('</select>',start)+9);html+='<input type="checkbox" id="'+(id==='productParser'?'productParserEnabled':'homeProductParserEnabled')+'">';}
 const {window}=parseHTML(html),$=id=>window.document.getElementById(id);
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.value||'auto'},set(value){for(const option of this.querySelectorAll('option'))if(option.value===value)option.setAttribute('selected','');else option.removeAttribute('selected')}});
 const p={id:'p',name:'Shop',url:BASE,selectors,productParserEnabled:true,productParser:'jsonld'},state={profiles:[p]};
 const ui=await compile(code,names,{$,state,listFields:[],detailFields:[],galleryConfig:()=>({}),applyEngineBenchmarkLabels:()=>{},ensureHomeInterval:()=>{},applyHomeTarget:()=>{},homeTargetFromProfile:()=>{},updateHomeSyncUi:()=>{}});
 ui.renderHomeProfile(p);$('profileId').value=p.id;for(const id of ['productParser','homeProductParser']){assert.equal($(id).value,'jsonld');assert.equal($(id).disabled,false)}
 for(const body of [ui.profileBody(),ui.homeProfileBody()]){assert.equal(body.productParserEnabled,true);assert.equal(body.productParser,'jsonld')}
 for(const prefix of ['','home']){const enabled=prefix?'homeProductParserEnabled':'productParserEnabled',parser=prefix?'homeProductParser':'productParser';$(enabled).checked=false;$(enabled).dispatchEvent(new window.Event('change'));assert.equal($(parser).disabled,true);assert.equal($(parser).value,'jsonld')}
 $('homeProductParser').value='metadata';$('homeProductParser').dispatchEvent(new window.Event('change'));assert.equal($('productParser').value,'metadata');assert.equal($('productParserEnabled').checked,false);ui.renderHomeProfile(null);assert.equal($('productParserEnabled').checked,false);assert.equal($('homeProductParser').disabled,true);
});
