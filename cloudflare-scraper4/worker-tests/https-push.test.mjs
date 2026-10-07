import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { mkdtemp, rm, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { caddyConfig } from '../scripts/prepare-https.mjs';
import webpush from 'web-push';
const root=new URL('..',import.meta.url).pathname,temp=await mkdtemp(join(root,'node_modules/.cache/push-test-'));
const store=new Map(),sent=[];globalThis.__pushStore=store;globalThis.__pushSend=async(sub,body)=>{sent.push({sub,body:JSON.parse(body)});return {statusCode:201}};
const keys=webpush.generateVAPIDKeys();const env={...process.env};
Object.assign(process.env,{WEB_PUSH_PUBLIC_KEY:keys.publicKey,WEB_PUSH_PRIVATE_KEY:keys.privateKey,WEB_PUSH_SUBJECT:'mailto:fixture@example.com'});
await build({entryPoints:[join(root,'render-src/web-push.ts')],outfile:join(temp,'push.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'deps',setup(b){
  b.onResolve({filter:/^(web-push|\.\/(db|config|network)\.js)$/},a=>({path:a.path,namespace:'mock'}));
  b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path==='web-push'?'export default {sendNotification:(...args)=>globalThis.__pushSend(...args)}':a.path.includes('config')?'export const config={adminToken:"fixture-admin-token"};':a.path.includes('network')?'export const assertPublicUrl=async raw=>new URL(raw);':`export const getState=async(k,f)=>globalThis.__pushStore.has(k)?JSON.parse(globalThis.__pushStore.get(k)):f;export const setState=async(k,v)=>globalThis.__pushStore.set(k,JSON.stringify(v));export const deleteState=async k=>globalThis.__pushStore.delete(k);export const pool={query:async()=>({rows:[...globalThis.__pushStore].filter(([k])=>k.startsWith('web_push_sub:')).map(([key,value])=>({key,value})).slice(0,101)})};`}));
}}]});
const push=await import(pathToFileURL(join(temp,'push.mjs')));
const subscription=(suffix='1')=>({endpoint:'https://fcm.googleapis.com/fcm/send/fixture-'+suffix,keys:{p256dh:keys.publicKey,auth:Buffer.alloc(16,1).toString('base64url')}});

test('Caddy generator validates hostname/port, retains live streams and never exposes deployer',()=>{
  const cfg=caddyConfig('scraper.example.com',3000);assert.match(cfg,/127\.0\.0\.1:3000/);assert.match(cfg,/flush_interval -1/);assert.match(cfg,/Strict-Transport-Security/);assert.ok(!cfg.includes('8790'));
  for(const name of ['localhost','127.0.0.1','https://site.test','site.test\n{ reverse_proxy evil }','*.site.test','site.test/path'])assert.throws(()=>caddyConfig(name));
  assert.throws(()=>caddyConfig('site.test',80));assert.throws(()=>caddyConfig('site.test',NaN));
});
test('subscription storage survives reload, remains encrypted, deduplicates and never exposes private VAPID key',async()=>{
  const a=await push.subscribePush(subscription());await push.subscribePush(subscription());
  assert.equal(store.size,1);assert.ok(![...store.values()][0].includes(subscription().endpoint));
  assert.ok(!JSON.stringify(push.pushConfiguration()).includes(keys.privateKey));
  const fresh=await import(pathToFileURL(join(temp,'push.mjs')).href+'?restart=1');
  const result=await fresh.deliverPush({title:'test',body:'works'},a.id);assert.equal(result.sent,1);assert.equal(sent.at(-1).body.body,'works');
});
test('untrusted endpoints and invalid keys are rejected before registration',async()=>{
  const count=store.size;for(const endpoint of ['https://127.0.0.1/push','https://metadata.internal/push','https://fcm.googleapis.com.evil.test/push','http://fcm.googleapis.com/push','https://fcm.googleapis.com:8443/push','https://user:pass@fcm.googleapis.com/push'])await assert.rejects(push.subscribePush({...subscription(),endpoint}));
  await assert.rejects(push.subscribePush({...subscription(),keys:{p256dh:'bad',auth:'bad'}}));assert.equal(store.size,count);
});
test('expired subscriptions are removed, temporary failures retained, unsubscribe only removes the chosen device',async()=>{
  const a=await push.subscribePush(subscription('a')),b=await push.subscribePush(subscription('b'));
  globalThis.__pushSend=async()=>{throw Object.assign(Error('expired'),{statusCode:410})};
  assert.equal((await push.deliverPush({title:'test',body:'body'},a.id)).removed,1);
  assert.ok(store.has('web_push_sub:'+b.id));
  globalThis.__pushSend=async()=>{throw Object.assign(Error('unavailable'),{statusCode:503})};
  assert.equal((await push.deliverPush({title:'test',body:'body'},b.id)).failed,1);assert.ok(store.has('web_push_sub:'+b.id));
  await push.unsubscribePush(b.id);assert.ok(!store.has('web_push_sub:'+b.id));
  await assert.rejects(push.unsubscribePush('../other'));
});
test('job completion and deployer events send without any open browser; version notices deduplicate',async()=>{
  globalThis.__pushSend=async(sub,body)=>{sent.push({sub,body:JSON.parse(body)});return {statusCode:201}};
  const before=sent.length;await push.pushJobFinished({id:'job-fixture',status:'done'});assert.ok(sent.length>before);
  const load=async()=>({recent:[{key:'fixture-version',kind:'newer-branch',title:'New release',body:'Available'}]});
  await push.pushDeployerNotices(load);const count=sent.length;await push.pushDeployerNotices(load);assert.equal(sent.length,count);
});
test('public assets do not cache authenticated resources; backend routes follow admin middleware',async()=>{
  const assets=await readFile(join(root,'worker-src/push-assets.ts'),'utf8');assert.ok(!assets.includes("addEventListener('fetch'"));assert.match(assets,/event\.waitUntil\(self\.registration\.showNotification/);assert.match(assets,/self\.registration\.scope/);
  const server=await readFile(join(root,'render-src/server.ts'),'utf8');assert.ok(server.indexOf("app.get('/api/web-push/config'")>server.indexOf("const auth = c.req.header('authorization')"));
  assert.match(server,/pushNoticeTimer/);assert.match(await readFile(join(root,'render-src/processor.ts'),'utf8'),/pushJobFinished\(job\)/);
});
test('HTTPS environment preparation preserves the existing vault password and refuses overwrite',async()=>{
  const project=join(temp,'env-fixture');await mkdir(join(project,'data'),{recursive:true});
  const secret='fixture-existing-vault-password-123456789';await writeFile(join(project,'data/vault.key'),secret+'\n');
  const childEnv={...process.env};delete childEnv.ADMIN_TOKEN;delete childEnv.VAULT_KEY_FILE;
  const run=()=>spawnSync(process.execPath,[join(root,'scripts/prepare-https-env.mjs'),'--project-dir',project],{encoding:'utf8',env:childEnv});
  const first=run();assert.equal(first.status,0,first.stderr);assert.ok(!first.stdout.includes(secret));
  const content=await readFile(join(project,'data/https.env'),'utf8');assert.ok(content.includes(JSON.stringify(secret)));assert.match(content,/SCRAPER_BIND_HOST=127.0.0.1/);
  assert.equal((await stat(join(project,'data/https.env'))).mode&0o077,0);assert.notEqual(run().status,0);assert.equal(await readFile(join(project,'data/https.env'),'utf8'),content);
});
test('VAPID generator creates a private file without exposing or rotating its key',async()=>{
  const output=join(temp,'vapid.env'),run=()=>spawnSync(process.execPath,[join(root,'scripts/push-keys.mjs'),'--subject','mailto:fixture@example.com','--out',output],{encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);const content=await readFile(output,'utf8');
  const privateKey=content.match(/WEB_PUSH_PRIVATE_KEY=(.+)/)[1];assert.ok(!first.stdout.includes(privateKey));assert.equal((await stat(output)).mode&0o077,0);assert.notEqual(run().status,0);assert.equal(await readFile(output,'utf8'),content);
});
test.after(async()=>{for(const key of ['WEB_PUSH_PUBLIC_KEY','WEB_PUSH_PRIVATE_KEY','WEB_PUSH_SUBJECT']){if(env[key]===undefined)delete process.env[key];else process.env[key]=env[key]}delete globalThis.__pushStore;delete globalThis.__pushSend;await rm(temp,{recursive:true,force:true})});
