import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
async function load(file,names){const {code}=await transform((await read(file)).replace(/\bexport /g,''),{loader:'ts'});return new Function(code+';return {'+names+'}')()}
const {waitForVisualContent,visualDomState}=await load('render-src/visual-readiness.ts','waitForVisualContent,visualDomState');
for(const driver of ['playwright','puppeteer'])test(driver+': waits for content without changing URL, rejects permanent loading, disposes handles',async()=>{
 let ready=false,waited=0,disposed=0;const page={evaluate:async()=>({ready}),waitForFunction:async(...args)=>{assert.equal(args.at(-1).timeout,12000);waited++;ready=true;return{dispose:()=>{disposed++}}}};
 assert.equal((await waitForVisualContent(page,driver)).ready,true);assert.equal(waited,1);assert.equal(disposed,1);await waitForVisualContent(page,driver);assert.equal(waited,1);
 ready=false;page.waitForFunction=async()=>{throw Error('timeout')};await assert.rejects(waitForVisualContent(page,driver),/بارگذاری/);
});
test('visible loading-only text is not ready, while actual content is',()=>{
 const before=globalThis.document;try{for(const text of ['', 'Loading...', 'در حال بارگذاری…', 'Please wait']){globalThis.document={body:{innerText:text},querySelectorAll:()=>[]};assert.equal(visualDomState().ready,false)}globalThis.document.body.innerText='Product catalogue with visible product titles and prices';assert.equal(visualDomState().ready,true)}finally{globalThis.document=before}
});
const {selectorDiagnosticAdvice,initialSelectorEvidenceApplies}=await load('worker-src/selector-diagnostic-advice.ts','selectorDiagnosticAdvice,initialSelectorEvidenceApplies');
test('title-only first article selection yields read-only advice; initial HTML cannot fail browser selector validation',()=>{
 const selectors={container:'//div/a[1]/article',image:'div.product__image'};const advice=selectorDiagnosticAdvice(selectors,[{title:'Pot',price:0,url:'',image:''}]);assert.equal(advice.length,4);assert.match(advice.join(' '),/img/);assert.match(advice.join(' '),/a\[1\]/);assert.equal(selectors.container,'//div/a[1]/article');assert.equal(initialSelectorEvidenceApplies('playwright'),false);assert.equal(initialSelectorEvidenceApplies('puppeteer'),false);assert.equal(initialSelectorEvidenceApplies('cheerio'),true);
});

test('catalogue readiness must not accept only a store logo, header and splash',async()=>{
 const {parseHTML}=await import('linkedom'),{document}=parseHTML(await read('worker-tests/fixtures/spa-splash-catalog.html'));
 const old=globalThis.document;try{globalThis.document=document;for(const el of document.querySelectorAll('*'))el.getBoundingClientRect=()=>({width:100,height:40,top:0,left:0,right:100,bottom:40});const logo=document.querySelector('img');Object.defineProperty(logo,'complete',{value:true});Object.defineProperty(logo,'naturalWidth',{value:80});assert.equal(visualDomState({context:'list'}).ready,false);}finally{globalThis.document=old}
});

test('delayed catalogue fixture becomes ready only after hydration removes the splash; bad manual selector is not overwritten',async()=>{
 const {parseHTML}=await import('linkedom'),{document}=parseHTML(await read('worker-tests/fixtures/spa-splash-catalog.html'));
 const keys=['document','innerWidth','innerHeight'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 try{
  globalThis.document=document;globalThis.innerWidth=800;globalThis.innerHeight=600;
  const layout=()=>{for(const el of document.querySelectorAll('*'))el.getBoundingClientRect=()=>({width:el.id==='splash'?800:100,height:el.id==='splash'?600:40,top:0,left:0,right:800,bottom:600});};layout();
  const options={context:'list',container:'.not-the-card'},before=visualDomState(options);assert.equal(before.ready,false);assert.equal(before.blockingOverlays,1);
  let hydrate;new Function('document','setTimeout',document.querySelector('script').textContent)(document,fn=>{hydrate=fn});hydrate();layout();
  const after=visualDomState(options);assert.equal(after.ready,true);assert.equal(after.productLinks,3);assert.equal(after.blockingOverlays,0);assert.equal(after.selectorMismatch,true);assert.equal(options.container,'.not-the-card');
  assert.equal(visualDomState({context:'list',container:'.product-card'}).configuredMatches,3);
 }finally{for(const key of keys){if(old[key]===undefined)delete globalThis[key];else globalThis[key]=old[key];}}
});
for(const driver of ['playwright','puppeteer'])test(driver+': catalogue wait is bounded, nudges once and restores scroll even on failure',async()=>{
 let moves=0,restores=0,waits=0;const page={evaluate:async(fn,arg)=>{if(fn.name==='visualDomState')return {ready:false,candidates:0};if(arg){restores++;assert.deepEqual(arg,{x:4,y:8});return;}if(String(fn).includes('scrollBy')){moves++;return;}return {x:4,y:8};},waitForFunction:async(...args)=>{waits++;assert.equal(args.at(-1).timeout,20000);assert.match(args[0],/configuredMatches/);throw Error('timeout')}};
 await assert.rejects(waitForVisualContent(page,driver,{context:'list',container:'.cards'}),error=>error.visualReadiness.candidates===0);assert.equal(moves,1);assert.equal(restores,1);assert.equal(waits,1);
});
