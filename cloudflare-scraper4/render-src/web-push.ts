import webpush from 'web-push';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { getState, setState, deleteState, pool } from './db.js';
import { assertPublicUrl } from './network.js';

const PREFIX = 'web_push_sub:';
const MAX_SUBSCRIPTIONS = 100;
export function pushConfiguration() {
  const publicKey=String(process.env.WEB_PUSH_PUBLIC_KEY||''),privateKey=String(process.env.WEB_PUSH_PRIVATE_KEY||''),subject=String(process.env.WEB_PUSH_SUBJECT||'');
  const configured=Boolean(config.adminToken && /^[\w-]{87}$/.test(publicKey) && /^[\w-]{43}$/.test(privateKey) && /^(mailto:|https:\/\/)/.test(subject));
  return {supported:true,configured,publicKey:configured?publicKey:'',reason:configured?'':'Set ADMIN_TOKEN and WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY / WEB_PUSH_SUBJECT on the VPS.'};
}
// Push endpoints are capability URLs. Keep them encrypted at rest, never return them in lists/logs.
function cipherKey(){if(!config.adminToken)throw Error('ADMIN_TOKEN is required for Web Push.');return createHash('sha256').update('scraper4-web-push:'+config.adminToken).digest()}
function seal(value:unknown){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',cipherKey(),iv);const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),body:body.toString('base64')}}
function open(value:any){const decipher=createDecipheriv('aes-256-gcm',cipherKey(),Buffer.from(value.iv,'base64'));decipher.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.body,'base64')),decipher.final()]).toString('utf8'))}
export function pushSubscriptionId(endpoint:string){return createHash('sha256').update(endpoint).digest('hex')}
export async function validatePushSubscription(raw:any) {
  if(!raw||typeof raw.endpoint!=='string'||raw.endpoint.length>2048)throw Error('Invalid push subscription.');
  const url=new URL(raw.endpoint);
  // An authenticated registration must not turn the server into an arbitrary POST relay.
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!(host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||host==='web.push.apple.com'||host.endsWith('.notify.windows.com')))throw Error('Unsupported push-service endpoint.');
  await assertPublicUrl(url.href);
  const p256dh=String(raw.keys?.p256dh||''),auth=String(raw.keys?.auth||'');
  if(!/^[\w-]+={0,2}$/.test(p256dh)||Buffer.from(p256dh,'base64url').length!==65||! /^[\w-]+={0,2}$/.test(auth)||Buffer.from(auth,'base64url').length!==16)throw Error('Invalid subscription encryption keys.');
  return {endpoint:url.href,keys:{p256dh,auth}};
}
async function rows(){return (await pool.query('SELECT key,value FROM app_state WHERE key LIKE $1 LIMIT 101',[PREFIX+'%'])).rows}
export async function subscribePush(raw:any){if(!pushConfiguration().configured)throw Error(pushConfiguration().reason);const subscription=await validatePushSubscription(raw),id=pushSubscriptionId(subscription.endpoint);const existing=await getState<any>(PREFIX+id,null);if(!existing&&(await rows()).length>=MAX_SUBSCRIPTIONS)throw Error('Too many notification subscriptions. Remove an old device first.');await setState(PREFIX+id,seal({subscription,createdAt:Date.now()}));return {ok:true,id}}
export async function unsubscribePush(id:string){if(!config.adminToken)throw Error('ADMIN_TOKEN is required for Web Push.');if(!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid subscription ID.');await deleteState(PREFIX+id);return {ok:true}}
export async function deliverPush(message:{title:string;body:string;tag?:string},onlyId?:string){
  if(!pushConfiguration().configured)return {ok:false,sent:0,failed:0,removed:0,reason:'not-configured'};
  let sent=0,failed=0,removed=0;
  const all=onlyId?[{key:PREFIX+onlyId,value:await getState(PREFIX+onlyId,null)}]:await rows();
  for(const row of all.slice(0,MAX_SUBSCRIPTIONS)){
    if(!row.value)continue;
    try{
      const record=open(typeof row.value==='string'?JSON.parse(row.value):row.value);
      const subscription=await validatePushSubscription(record.subscription);
      await webpush.sendNotification(subscription,JSON.stringify({title:message.title.slice(0,120),body:message.body.slice(0,400),tag:String(message.tag||'scraper4').slice(0,120),url:'./'}),{TTL:3600,timeout:8000,vapidDetails:{subject:process.env.WEB_PUSH_SUBJECT!,publicKey:process.env.WEB_PUSH_PUBLIC_KEY!,privateKey:process.env.WEB_PUSH_PRIVATE_KEY!}});
      sent++;
    }catch(error:any){if(error?.statusCode===404||error?.statusCode===410){await deleteState(row.key);removed++}else failed++}
  }
  return {ok:sent>0&&failed===0,sent,failed,removed};
}
export async function pushJobFinished(job:{id:string;status:string}){
  if(!['done','failed','stopped'].includes(job.status)||!pushConfiguration().configured)return;
  await deliverPush({title:'Scraper4',body:job.status==='done'?'وظیفهٔ اسکریپر به پایان رسید.':job.status==='failed'?'وظیفهٔ اسکریپر با خطا پایان یافت؛ گزارش را بررسی کنید.':'وظیفهٔ اسکریپر متوقف شد.',tag:'job-'+job.id});
}
let noticeScanRunning=false;
export async function pushDeployerNotices(load:()=>Promise<any>){
  if(noticeScanRunning||!pushConfiguration().configured)return;
  noticeScanRunning=true;
  try{
    if(!(await rows()).length)return;
    const payload=await load(),seen=await getState<string[]>('web_push_notices_seen',[]);
    for(const notice of (payload.recent||payload.notify?.recent||[]).slice(0,10).reverse()){
      if(!notice.key||seen.includes(notice.key)||!['newer-branch','new-commit','restart-needed'].includes(notice.kind))continue;
      const outcome=await deliverPush({title:String(notice.title||'Scraper4'),body:String(notice.body||'نسخهٔ تازه‌ای در دسترس است.'),tag:'version-'+String(notice.key)});
      if(outcome.sent>0){seen.push(notice.key);await setState('web_push_notices_seen',seen.slice(-100))}
    }
  } finally {noticeScanRunning=false}
}
