/* Adapter runs BEFORE the byte-preserved PHP client in an opaque sandbox. */
(()=>{'use strict';
function storage(){const values=new Map();return {getItem:k=>values.has(String(k))?values.get(String(k)):null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(String(k)),clear:()=>values.clear(),key:i=>[...values.keys()][i]||null,get length(){return values.size;}};}
for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{value:storage(),configurable:false});
const pending=new Map();let sequence=0;
window.addEventListener('message',event=>{if(event.source!==parent||event.origin!==location.origin)return;const m=event.data;if(!m||m.type!=='s4-php-response')return;const item=pending.get(m.id);if(!item)return;clearTimeout(item.timer);pending.delete(m.id);if(m.status===501){const error=new Error(m.data.error||'این عملیات هنوز متصل نیست.');if(typeof window.showToast==='function')window.showToast(error.message,true);item.reject(error);return;}item.resolve({ok:m.status>=200&&m.status<300,status:m.status,json:()=>Promise.resolve(m.data),text:()=>Promise.resolve(JSON.stringify(m.data))});});
window.fetch=(input,options={})=>new Promise((resolve,reject)=>{
 const fields={};if(options.body){if(typeof options.body.entries!=='function'){reject(Error('فقط فرم‌های متن پشتیبانی می‌شوند.'));return;}for(const [k,v] of options.body.entries()){if(typeof v!=='string'){reject(Error('آپلود فایل در این رابط متصل نیست.'));return;}fields[k]=v;}}
 const id='php-'+(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(Error('مهلت پاسخ لایهٔ اتصال تمام شد.'));},120000);
 pending.set(id,{resolve,reject,timer});parent.postMessage({type:'s4-php-request',id,url:typeof input==='string'?input:input.url,method:String(options.method||'GET').toUpperCase(),fields},location.origin);
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
