import { Window } from 'happy-dom';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(dir,'..');
const php=process.env.PHP_BINARY || 'php';
const raw=execFileSync(php,[path.join(root,'tests/render-visitor-tracker.php')],{encoding:'utf8'});
const native=raw.replace(/^<script[^>]*>/,'').replace(/<\/script>$/,'');
const boot=fs.readFileSync(path.join(dir,'boot-sample.js'),'utf8');
const js=fs.readFileSync(path.join(root,'asset/js/storefront/storefront.js'),'utf8');
const wait=()=>new Promise(r=>setTimeout(r,180));
const makeWindow=()=>{
 const w=new Window({url:'https://store.example/product/name/?product=123&key=TOPSECRET',width:390,height:844});
 w.document.write('<!doctype html><html dir="rtl"><body><div id="amphp-storefront-root"></div></body></html>');
 Object.defineProperty(w.document,'referrer',{value:'https://google.example/private?token=SECRET',configurable:true});
 const calls=[];w.fetch=async(url,opts)=>{if(opts?.body?.get?.('event_type')==='site_visit') calls.push(Object.fromEntries(opts.body.entries()));return {ok:true,json:async()=>({success:true})};};
 w.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});w.requestAnimationFrame=cb=>setTimeout(cb,0);w.scrollTo=()=>{};
 return {w,calls};
};
{
 const {w,calls}=makeWindow(); w.eval(native); await wait();
 assert.equal(calls.length,1); assert.equal(calls[0].visit_page_type,'product');assert.equal(calls[0].visit_referrer_host,'google.example');assert.equal(calls[0].visit_screen,'small');
 assert.ok(!JSON.stringify(calls).includes('SECRET')); w.eval(native); await wait();assert.equal(calls.length,1,'Native tracker deduplicates');w.happyDOM.abort();
}
{
 const {w,calls}=makeWindow();w.eval(boot);w.eval(native);await wait();assert.equal(calls.length,0,'Native tracker does not duplicate storefront');
 w.eval(js);await wait(); assert.equal(calls.length,1);assert.equal(calls[0].visit_page_type,'product');assert.equal(calls[0].visit_referrer_host,'google.example');assert.ok(!JSON.stringify(calls).includes('SECRET'));w.happyDOM.abort();
}
{
 const {w,calls}=makeWindow();w.document.getElementById('amphp-storefront-root').remove();
 w.document.body.innerHTML='<div id="amphp-support-chat-root"></div>';w.AMPHP_STOREFRONT={mode:'chat-only',settings:{enable_support_chat:true}};
 w.eval(native);await wait();assert.equal(calls.length,1,'Native page with chat-only boot still tracks visits');w.happyDOM.abort();
}
console.log('Visitor tracker smoke tests passed');
