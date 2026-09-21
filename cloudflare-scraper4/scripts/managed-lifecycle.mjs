import {timingSafeEqual} from 'node:crypto';
import {writeFileSync} from 'node:fs';
export const INSTANCE='scraper4-managed',REQUEST='/var/lib/scraper4-managed/control-request.json';
export const equalSecret=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length>0&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function managedSession(req,res,token){
 const url=new URL(req.url,'http://'+req.headers.host);
 const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('sc4_managed_session='))?.slice('sc4_managed_session='.length)||'';
 if(url.pathname==='/'&&equalSecret(url.searchParams.get('token'),token)){
  const secure=req.socket?.encrypted||req.headers['x-forwarded-proto']==='https';
  res.writeHead(303,{'location':'/','set-cookie':'sc4_managed_session='+encodeURIComponent(token)+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'+(secure?'; Secure':''),'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return false;
 }
 let decoded='';try{decoded=decodeURIComponent(cookie)}catch{}
 if(equalSecret(req.headers['x-local-deployer-token'],token)||equalSecret(decoded,token))return true;
 res.writeHead(401,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});
 res.end('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Scraper4 sign in</title><body><h1>Independent Scraper4</h1><p>Enter the Deployer token from your root-only runtime.env file. Use HTTPS or an SSH tunnel; HTTP is not encrypted.</p><form method="get" action="/"><label>Deployer token <input name="token" type="password" required autocomplete="current-password"></label><button>Sign in</button></form></body></html>');return false;
}
export function validateLifecycle(payload){
 if(!payload||Object.keys(payload).some(k=>!['action','confirmation'].includes(k))||!['stop','uninstall'].includes(payload.action)||payload.confirmation!==INSTANCE)throw Error('Type scraper4-managed to confirm Stop or Uninstall.');
 return {action:payload.action,confirmation:INSTANCE};
}
export function queueLifecycle(payload,write=writeFileSync){const request=validateLifecycle(payload);write(REQUEST,JSON.stringify(request),{flag:'wx',mode:0o600});return {ok:true,accepted:true,action:request.action,message:'Request queued. The panel will disconnect. This is not a completion receipt; verify the control service journal through SSH.'};}
export function lifecycleRequestAllowed(req,token){
 if(!equalSecret(req.headers['x-local-deployer-token'],token))return false;
 if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return false;}catch{return false;}}
 return true;
}
