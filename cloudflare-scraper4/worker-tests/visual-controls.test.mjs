import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=new URL('..',import.meta.url).pathname, temp=await mkdtemp(join(root,'node_modules/.cache/visual-controls-'));
const fixture='<html><body><main><article class="product"><h2 class="title">One</h2><b class="price">100</b></article><article class="product"><h2 class="title">Two</h2><b class="price">200</b></article></main><div role="dialog" id="advert"><button aria-label="Close advertisement"><span id="close-icon">×</span></button><p id="ad-content">Advertisement</p></div><div role="tablist"><button role="tab" id="tab-one" aria-controls="panel-one">First</button><button role="tab" id="tab-two" aria-controls="panel-two">Second</button></div><section id="panel-one">First panel</section><section id="panel-two" hidden>Second panel</section><details><summary id="disclosure">More</summary>Native details</details></body></html>';
const tickets=new Map();
globalThis.__controlTickets=tickets;
for(const runtime of ['render','worker'])await build({entryPoints:[join(root,runtime+'-src/visual.ts')],outfile:join(temp,runtime+'.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'offline',setup(b){b.onResolve({filter:/^\.\/(network|config|visual-browser|db|scraper)\.js$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('config')?'export const config={adminToken:"fixture"};':a.path.includes('visual-browser')?'export const VISUAL_BROWSER_ENGINES=new Set(); export const renderBrowserSnapshot=()=>{};':a.path.includes('db')?'export const getState=async key=>globalThis.__controlTickets.get(key);export const setState=async(key,value)=>globalThis.__controlTickets.set(key,value);':`export const assertPublicUrl=()=>{};export const safeText=async()=>(${JSON.stringify({text:fixture,url:'https://shop.test/',contentType:'text/html'})});export const sourceText=safeText;`}));}}]});
const modules={};for(const runtime of ['render','worker'])modules[runtime]=await import(pathToFileURL(join(temp,runtime+'.mjs')));
async function picker(runtime,context='list'){
 const visual=modules[runtime],ticket=await visual.createVisualTicket('https://shop.test/');
 const html=runtime==='render'?await visual.renderVisualSelector(ticket):(await visual.renderVisualSelector(ticket,context)).text();
 const {window}=parseHTML(await html),{document}=window;
 // Linkedom select.value has no setter; browsers do. Supply the native contract.
 const select=document.getElementById('__s4mode');Object.defineProperty(select,'value',{configurable:true,writable:true,value:select.options[0].value});
 const messages=[],parent={postMessage:data=>messages.push(data)};
 const script=document.querySelector('script').textContent;
 new Function('window','document','parent','Element','HTMLInputElement','HTMLTextAreaElement','HTMLSelectElement',script)(window,document,parent,window.Element,window.HTMLInputElement,window.HTMLTextAreaElement,window.HTMLSelectElement);
 const $=id=>document.getElementById(id),click=el=>el.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}));
 return {window,document,$,select,messages,click,ticket,script};
}
for(const runtime of ['render','worker']){
 test(runtime+': save advances immediately, including already picked fields; empty selection does not advance',async()=>{
  const p=await picker(runtime);p.click(p.$('__s4save'));assert.equal(p.select.value,'container');assert.equal(p.messages.length,0);
  p.click(p.document.querySelector('article'));p.click(p.$('__s4save'));assert.equal(p.messages[0].mode,'container');assert.equal(p.select.value,'title');
  p.click(p.$('__s4save'));assert.equal(p.messages.length,1);assert.equal(p.select.value,'title');
  p.click(p.document.querySelector('h2'));p.click(p.$('__s4save'));assert.equal(p.messages[1].mode,'title');assert.equal(p.select.value,'price');
  p.select.value='container';p.select.dispatchEvent(new p.window.Event('change'));p.click(p.document.querySelector('article'));p.click(p.$('__s4save'));assert.equal(p.select.value,'title','must not skip an existing title');
  const last=Array.from(p.select.options).at(-1).value;p.select.value=last;p.select.dispatchEvent(new p.window.Event('change'));p.click(p.document.querySelector('h2'));p.click(p.$('__s4save'));assert.equal(p.select.value,last,'last field must not wrap to container');
 });
 test(runtime+': pause disables picking/hover/keyboard; local popup and ARIA controls work',async()=>{
  const p=await picker(runtime);p.click(p.document.querySelector('h2'));p.click(p.$('__s4pause'));assert.equal(p.document.querySelectorAll('.__s4picked,.__s4hover').length,0);
  p.document.querySelector('b').dispatchEvent(new p.window.Event('mouseover',{bubbles:true}));assert.equal(p.document.querySelectorAll('.__s4hover').length,0);
  const key=new p.window.Event('keydown',{bubbles:true,cancelable:true});key.key='Enter';p.document.dispatchEvent(key);assert.equal(key.defaultPrevented,false);assert.equal(p.messages.length,0);
  p.click(p.$('close-icon'));assert.equal(p.$('advert').hidden,true);assert.equal(p.messages.length,0);
  p.click(p.$('tab-two'));assert.equal(p.$('panel-one').hidden,true);assert.equal(p.$('panel-two').hidden,false);
  const event=new p.window.Event('click',{bubbles:true,cancelable:true});p.$('disclosure').dispatchEvent(event);assert.equal(event.defaultPrevented,false,'native disclosures pass through');
  p.$('advert').hidden=false;p.click(p.$('__s4dismiss'));p.click(p.$('ad-content'));assert.equal(p.$('advert').hidden,true);
  p.click(p.$('__s4pause'));p.click(p.document.querySelector('h2'));assert.equal(p.document.querySelectorAll('.__s4picked').length,1);
 });
 test(runtime+': refresh sends channel-bound request rather than reloading consumed ticket',async()=>{
  const p=await picker(runtime);p.click(p.$('__s4refresh'));assert.equal(p.messages[0].type,'scraper4-refresh');assert.ok(p.messages[0].channel);assert.doesNotMatch(p.script,/location\.reload/);
  if(runtime==='worker')await assert.rejects(modules.worker.renderVisualSelector(p.ticket),/منقضی|نامعتبر/);
 });
}
test('Worker detail save uses next dropdown field',async()=>{const p=await picker('worker','detail');p.click(p.document.querySelector('h2'));p.click(p.$('__s4save'));assert.equal(p.messages[0].mode,'shortDesc');assert.equal(p.select.value,'longDesc');});
test.after(()=>rm(temp,{recursive:true,force:true}));
test('dashboard refresh validates sender/channel/origin, coalesces requests and preserves detail context and saved selectors',async()=>{
 const source=await readFile(join(root,'worker-src/dashboard.ts'),'utf8'),script=source.slice(source.indexOf('async function openVisual('),source.indexOf('async function suggestSelectorFields('));
 const state={selected:'profile-one'},elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,textContent:'',src:'',contentWindow:{},classList:{add(){},remove(){}}});return elements.get(id);};
 $('detailSampleUrl').value='https://shop.test/product';$('url').value='https://shop.test/list';$('sel-title').value='.saved-title';$('sel-container').value='article.product';$('profileId').value='profile-one';
 let requests=[],flushes=0,release;const api=async(path,options)=>{requests.push({path,body:JSON.parse(options.body)});if(release)await new Promise(resolve=>{release.resolve=resolve});return {ticket:'ticket-'+requests.length,channel:'channel-'+requests.length};};
 const ui=new Function('state','$','api','saveSettings','flushProfileEdits','busy','notice','U','location',script+';return {openVisual,closeVisual,visualMessage,refreshVisualSelector};')(state,$,api,async()=>{},async()=>{flushes++},()=>{},()=>{},value=>value,{origin:'https://app.test'});
 await ui.openVisual('detail');assert.equal(requests.length,1);
 const message={source:$('visualFrame').contentWindow,origin:'null',data:{type:'scraper4-refresh',channel:state.visualChannel}};
 for(const bad of [{...message,source:{}},{...message,origin:'https://evil.test'},{...message,data:{...message.data,channel:'wrong'}}])ui.visualMessage(bad);
 await new Promise(setImmediate);assert.equal(requests.length,1);
 release={};ui.visualMessage(message);ui.visualMessage(message);await new Promise(setImmediate);assert.equal(requests.length,2);assert.equal(flushes,1);assert.equal(requests[1].body.context,'detail');assert.equal(requests[1].body.url,'https://shop.test/product');release.resolve();release=null;await new Promise(setImmediate);
 assert.equal(state.visualChannel,'channel-2');assert.match($('visualFrame').src,/context=detail&ticket=ticket-2/);assert.equal($('sel-title').value,'.saved-title');assert.equal($('sel-container').value,'article.product');
 ui.visualMessage(message);await new Promise(setImmediate);assert.equal(requests.length,2,'stale channel cannot refresh again');
 release={};const pending=ui.openVisual('list');await new Promise(setImmediate);ui.closeVisual();release.resolve();await pending;assert.equal($('visualFrame').src,'about:blank','closing during ticket request must not reopen modal');
});
for(const runtime of ['render','worker'])test(runtime+': compact toolbar, flow toggle and height control preserve picking',async()=>{
 const p=await picker(runtime),bar=p.$('__s4bar'),tools=p.$('__s4tools'),pin=p.$('__s4pin'),height=p.$('__s4height');
 assert.equal(p.document.body.firstElementChild,bar,'flow toolbar must precede source content');
 assert.equal(tools.hasAttribute('open'),false,'secondary controls start folded');
 for(const id of ['__s4mode','__s4save','__s4pause','__s4pin'])assert.ok(p.$(id).closest('.__s4primary'),id+' stays outside the folded tools');
 assert.ok(p.$('__s4refresh').closest('#__s4tools'));assert.ok(pin.checked);
 bar.getBoundingClientRect=()=>({height:112});pin.checked=false;pin.dispatchEvent(new p.window.Event('change'));assert.ok(bar.classList.contains('__s4flow'));assert.equal(p.document.body.style.getPropertyValue('padding-top'),'0px');
 pin.checked=true;pin.dispatchEvent(new p.window.Event('change'));assert.equal(bar.classList.contains('__s4flow'),false);assert.equal(p.document.body.style.getPropertyValue('padding-top'),'112px');
 height.value='45';height.dispatchEvent(new p.window.Event('input'));assert.equal(bar.style.getPropertyValue('--s4-height'),'45vh');assert.equal(bar.style.getPropertyValue('--s4-height-dynamic'),'45dvh');assert.equal(p.$('__s4heightValue').textContent,'45%');
 height.value='90';height.dispatchEvent(new p.window.Event('input'));assert.equal(bar.style.getPropertyValue('--s4-height'),'50vh','height is bounded');
 const styles=[...p.document.querySelectorAll('style')].map(el=>el.textContent).join('');assert.match(styles,/max-height:var\(--s4-height,30vh\)!important/);assert.match(styles,/overflow:auto!important/);assert.match(styles,/\.__s4flow\{position:relative!important/);
 const key=new p.window.Event('keydown',{bubbles:true,cancelable:true});key.key='Enter';tools.firstElementChild.dispatchEvent(key);assert.equal(key.defaultPrevented,false,'keyboard can open the tools disclosure');
 p.click(p.document.querySelector('article'));p.click(p.$('__s4save'));assert.equal(p.messages[0].mode,'container');assert.equal(p.select.value,'title');
});
