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
