/* Adapter runs BEFORE the byte-preserved PHP client in an opaque sandbox. */
(()=>{'use strict';
function storage(){const values=new Map();return {getItem:k=>values.has(String(k))?values.get(String(k)):null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(String(k)),clear:()=>values.clear(),key:i=>[...values.keys()][i]||null,get length(){return values.size;}};}
for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{value:storage(),configurable:false});
const pending=new Map(),blocked=new Map();let sequence=0;
// Explicitly unported background consumers. Reject locally (never success),
// without sending recurring PHP scheduler/chat/AI/matrix requests to the host.
const passive=new Set(['push_status','live_feed','sync_status','selagent_status','agent_status','notif_health','sync_matrix_status','sync_pipeline_status','cron_visual_pulse','code_auto_update','bsl_chats','store_chat_api','ar_rules','ai_content_auto_status','ops_feedback','internal_cron_feedback','internal_extract_feedback','internal_matrix_feedback']);
window.S4NativeDiagnostics=Object.freeze({blockedBackground:()=>Object.fromEntries(blocked),pendingRequests:()=>pending.size});
function unsupported(action){const e=new Error('این قابلیت PHP هنوز متصل نیست: '+action);e.name='NotSupportedError';e.status=501;return e;}
function response(status,data){if(typeof Response==='function')return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8'}});return {ok:status>=200&&status<300,status,headers:{get:name=>String(name).toLowerCase()==='content-type'?'application/json; charset=utf-8':null},json:()=>Promise.resolve(data),text:()=>Promise.resolve(JSON.stringify(data))};}
function finish(id){const item=pending.get(id);if(!item)return;clearTimeout(item.timer);item.signal?.removeEventListener('abort',item.abort);pending.delete(id);return item;}

window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;const m=event.data;if(!m||m.type!=='s4-php-response')return;const item=finish(m.id);if(!item)return;if(m.status===501){const error=unsupported(item.action);if(m.data?.error)error.message=m.data.error;if(typeof window.showToast==='function')window.showToast(m.data.error||error.message,true);item.reject(error);return;}item.resolve(response(m.status,m.data));});
window.fetch=(input='',options={})=>new Promise((resolve,reject)=>{
 const fields={};if(options.body){if(typeof options.body.entries!=='function'){reject(Error('فقط فرم‌های متن پشتیبانی می‌شوند.'));return;}for(const [k,v] of options.body.entries()){if(typeof v!=='string'){reject(Error('آپلود فایل در این رابط متصل نیست.'));return;}fields[k]=v;}}
 const url=typeof input==='string'?input:input.url,u=new URL(url,location.href),query=Object.fromEntries(u.searchParams),action=fields.action||query.action||Object.keys(query).find(k=>!k.startsWith('_'))||'';
 if((passive.has(action)&&!(action==='sync_pipeline_status'&&fields.action===action))||(action==='cron_run'&&query.internal_browser_keep==='1')){blocked.set(action,(blocked.get(action)||0)+1);reject(unsupported(action));return;}
 const signal=options.signal,abortError=()=>new DOMException('درخواست لغو شد.','AbortError');if(signal?.aborted){reject(abortError());return;}
 const id='php-'+(++sequence),abort=()=>{if(finish(id))reject(abortError());},timer=setTimeout(()=>{if(finish(id))reject(Error('مهلت پاسخ لایهٔ اتصال تمام شد.'));},120000);
 pending.set(id,{resolve,reject,timer,signal,abort,action});signal?.addEventListener('abort',abort,{once:true});
 try{parent.postMessage({type:'s4-php-request',id,url,method:String(options.method||'GET').toUpperCase(),fields},location.origin);}catch(e){finish(id);reject(e);}
});
// No native XHR/EventSource/service-worker networking can escape the broker.
window.EventSource=class{constructor(){setTimeout(()=>{if(this.onerror)this.onerror(new Event('error'));},0);}close(){}addEventListener(){}};
window.XMLHttpRequest=class{open(){throw Error('XHR این عملیات هنوز به پایتون متصل نیست.');}};
const F={system:{label:'پیش‌فرض سیستم',stack:'Tahoma,system-ui,sans-serif'},vazirmatn:{label:'وزیرمتن — Vazirmatn',stack:'Vazirmatn,Tahoma,sans-serif'},sahel:{label:'ساحل — Sahel',stack:'Sahel,Tahoma,sans-serif'}};
window.APP_FONTS=F;window.APP_FONT_KEY='s4-native-font';window.APP_FONT_FALLBACK=F.system.stack;
let font='vazirmatn';window.appFontCurrent=()=>font;window.appFontApply=k=>{font=F[k]?k:'vazirmatn';document.documentElement.style.setProperty('--app-font',F[font].stack);window.APP_FONT_CURRENT=font;return font;};window.appFontApply(font);
window.APP_THEMES={ocean:{label:'🌊 اقیانوس شب (پیش‌فرض)',skin:''}};window.APP_THEME_DEFAULT='ocean';window.APP_THEME_KEY='s4-native-theme';window.appThemeCurrent=()=> 'ocean';window.appThemeApply=()=> 'ocean';
window.APP_FX_KEY='s4-native-fx';let fx='on';window.appFxCurrent=()=>fx;window.appFxApply=v=>{fx=v==='off'?'off':'on';document.documentElement.dataset.fx=fx;window.APP_FX_CURRENT=fx;return fx;};window.appFxApply(fx);
})();
