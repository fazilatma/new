import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
const root=new URL('..',import.meta.url).pathname,source=await readFile(join(root,'worker-src/dashboard.ts'),'utf8');
const script=source.slice(source.indexOf('function pushIdKey()'),source.indexOf('async function menuAction('));
function browser(secure=true){
  const calls=[],storage=new Map(),box={textContent:''};let subscribed=null,subscriptions=0;
  const manager={getSubscription:async()=>subscribed,subscribe:async options=>{subscriptions++;subscribed={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',options,toJSON(){return {endpoint:this.endpoint,keys:{}}},unsubscribe:async()=>{subscribed=null}};return subscribed}};
  const registration={active:{},pushManager:manager},Notification={permission:'default',requestPermission:async()=>{Notification.permission='granted';return 'granted'}};
  const ctx=vm.createContext({APP_BASE:'/',window:{isSecureContext:secure,PushManager:function(){},Notification},Notification,navigator:{serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration),getRegistration:async()=>registration}},U:x=>x,$:()=>box,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},notice:()=>{},atob,Uint8Array,TextEncoder,crypto:globalThis.crypto,api:async(path,init)=>{calls.push({path,init});if(path.endsWith('/config'))return {configured:true,publicKey:Buffer.alloc(65,1).toString('base64url')};if(path.endsWith('/subscribe'))return {id:'fixture-id'};if(path.endsWith('/test'))return {sent:1};return {ok:true}}});
  vm.runInContext(script,ctx);return {ctx,calls,box,get subscriptions(){return subscriptions}};
}
test('HTTP is rejected clearly before subscription or network calls',async()=>{const b=browser(false);await b.ctx.pushAction('enable');assert.match(b.box.textContent,/HTTPS/);assert.equal(b.calls.length,0)});
test('enable is idempotent, test uses this device, and disable revokes backend plus browser',async()=>{
  const b=browser();await b.ctx.pushAction('enable');await b.ctx.pushAction('enable');assert.equal(b.subscriptions,1);
  await b.ctx.pushAction('test');assert.equal(JSON.parse(b.calls.at(-1).init.body).id,'fixture-id');assert.match(b.box.textContent,/پذیرفت/);
  await b.ctx.pushAction('disable');assert.equal(b.calls.at(-1).path,'/api/web-push/unsubscribe');assert.match(b.box.textContent,/غیرفعال/);
});
test('sandbox selector messages require both window identity and ticket channel',()=>{
  const start=source.indexOf('function visualMessage(event)'),line=source.slice(start,source.indexOf('\n',start)),frameWindow={},accepted=[];
  const ctx=vm.createContext({$:()=>({contentWindow:frameWindow}),state:{visualChannel:'ticket-channel'},location:{origin:'https://app.test'},applyVisualSelection:(mode,item)=>{accepted.push(item);return true},subTab:()=>{},notice:()=>{},detailFields:[]});vm.runInContext(line,ctx);
  const data={type:'scraper4-selector',mode:'title',selector:'.title',channel:'ticket-channel'};
  ctx.visualMessage({source:{},origin:'https://app.test',data});ctx.visualMessage({source:frameWindow,origin:'null',data:{...data,channel:'wrong'}});assert.equal(accepted.length,0);
  ctx.visualMessage({source:frameWindow,origin:'null',data});assert.equal(accepted.length,1);
});
const temp=await mkdtemp(join(root,'node_modules/.cache/push-worker-'));await build({entryPoints:[join(root,'worker-src/push-assets.ts')],outfile:join(temp,'assets.mjs'),bundle:true,format:'esm',logLevel:'silent'});const assets=await import(pathToFileURL(join(temp,'assets.mjs')));
test('service worker shows OS notifications without a page and rejects external click destinations',async()=>{
  const handlers={},shown=[],opened=[],pending=[];
  const self={addEventListener:(name,fn)=>handlers[name]=fn,registration:{scope:'https://app.test/scraper/',showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url),claim:async()=>{}},skipWaiting:async()=>{}};
  vm.runInNewContext(assets.PUSH_SERVICE_WORKER,{self,URL});assert.equal(handlers.fetch,undefined);
  handlers.push({data:{json:()=>({title:'Finished',body:'Task done',url:'https://evil.test'})},waitUntil:p=>pending.push(p)});await Promise.all(pending);assert.equal(shown[0].title,'Finished');
  handlers.notificationclick({notification:{close:()=>{},data:{url:'https://evil.test'}},waitUntil:p=>pending.push(p)});await Promise.all(pending);assert.deepEqual(opened,['https://app.test/scraper/']);
  for(const size of ['192','512']){const png=new Uint8Array(assets.pushIconPng(size));assert.deepEqual([...png.slice(0,8)],[137,80,78,71,13,10,26,10])}
});
test.after(async()=>{await rm(temp,{recursive:true,force:true})});
