// The picker is one big INLINE <script>. If its sha256 does not appear in the response CSP
// the browser silently refuses to run it: the toolbar renders, but no control does anything
// (the "pause button is stuck on active" report). Two real bugs lived here:
//  * the script was injected with String.replace(..., string), so its `$&` sequences were
//    expanded by the regex engine -> different bytes than the hashed source;
//  * full mode listed stale hashes, and ANY hash makes the browser ignore 'unsafe-inline',
//    so every inline script was blocked instead of allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root=new URL('..',import.meta.url).pathname, temp=await mkdtemp(join(root,'node_modules/.cache/visual-csp-'));
const fixture='<html><head><title>t</title></head><body><main><article class="product"><h2 class="title">One</h2><b class="price">1</b></article><article class="product"><h2 class="title">Two</h2><b class="price">2</b></article></main><script>window.__sourceScript=1;</script></body></html>';
const tickets=new Map();globalThis.__cspTickets=tickets;
for(const runtime of ['render','worker'])await build({entryPoints:[join(root,runtime+'-src/visual.ts')],outfile:join(temp,runtime+'.mjs'),bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent',plugins:[{name:'offline',setup(b){b.onResolve({filter:/^\.\/(network|config|visual-browser|db|scraper)\.js$/},a=>({path:a.path,namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('config')?'export const config={adminToken:"fixture"};':a.path.includes('visual-browser')?'export const VISUAL_BROWSER_ENGINES=new Set(); export const renderBrowserSnapshot=()=>{};':a.path.includes('db')?'export const getState=async key=>globalThis.__cspTickets.get(key);export const setState=async(key,value)=>globalThis.__cspTickets.set(key,value);':`export const assertPublicUrl=()=>{};export const safeText=async()=>(${JSON.stringify({text:fixture,url:'https://shop.test/',contentType:'text/html'})});export const sourceText=safeText;`}));}}]});
const modules={};for(const runtime of ['render','worker'])modules[runtime]=await import(pathToFileURL(join(temp,runtime+'.mjs')));

function inlineScripts(html){return [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);}
function allows(csp,source){
 const directive=(csp.match(/script-src([^;]*)/)||[,''])[1];
 const hashes=[...directive.matchAll(/'sha256-([^']+)'/g)].map(m=>m[1]);
 if(hashes.length)return hashes.includes(createHash('sha256').update(source).digest('base64'));
 return directive.includes("'unsafe-inline'");
}

for(const runtime of ['render','worker']){
 for(const full of [false,true]){
  test(runtime+': the CSP of the '+(full?'full':'simple')+' picker actually allows the injected picker script',async()=>{
   const visual=modules[runtime];
   let html,csp;
   if(runtime==='worker'){
    const response=await visual.renderVisualSelector(await visual.createVisualTicket('https://shop.test/'),'list',full);
    html=await response.text();csp=response.headers.get('content-security-policy');
   }else{
    const ticket=visual.createVisualTicket('https://shop.test/',{context:'list',full});
    html=await visual.renderVisualSelector(ticket,full);csp=visual.visualSelectorCsp(ticket,full);
   }
   const scripts=inlineScripts(html);
   const picker=scripts.find(s=>s.includes('__s4pause'));
   assert.ok(picker,'the picker script must be injected into the page');
   assert.ok(allows(csp,picker),'the CSP must allow the picker script byte for byte');
   assert.doesNotMatch(picker,/<\/body\s*>/i,'the injection must not splice the matched </body> into the script via $&');
   assert.match(csp,/sandbox allow-scripts/,'the frame must still be sandboxed');
   if(full)for(const source of scripts)assert.ok(allows(csp,source),'full mode must run the page scripts too');
   else assert.equal(scripts.length,1,'simple mode must ship exactly one script: the picker');
  });
 }
}
test.after(()=>rm(temp,{recursive:true,force:true}));
