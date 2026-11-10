/* Trusted parent only. A browser timer, not a background service/daemon. */
(()=>{
'use strict';
const panel=document.getElementById('browser-cron');if(!panel||window!==window.top)return;
const toggle=panel.querySelector('[data-browser-cron-toggle]'),label=panel.querySelector('[data-browser-cron-status]');
let timer=null,busy=false,stopped=false;
async function api(path,data){
 const response=await fetch(path,{method:data===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf"]').content},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const value=await response.json();if(!response.ok||value.ok===false)throw Error(value.error||`HTTP ${response.status}`);return value;
}
function later(seconds=45){clearTimeout(timer);if(!stopped)timer=setTimeout(cycle,Math.max(5,seconds)*1000);}
function show(value){
 const reason=value.reason||(value.throttled?'throttled':value.busy?'busy':'');
 const messages={disabled:'کران مرورگر خاموش است.',external_fresh:'کران بیرونی تازه مشاهده شد؛ مرورگر در حالت آماده‌باش است.',worker_active:'worker سمت سرور فعال است؛ مرورگر کار موازی اجرا نمی‌کند.',idle:'کران مرورگر آماده است؛ کار قابل‌اجرایی در صف نیست.',busy:'پردازش دیگری قفل صف را دارد؛ منتظر نوبت بعد.',throttled:'مرحلهٔ بعد پس از فاصلهٔ مشترک اجرا می‌شود.'};
 label.textContent=messages[reason]||(value.ran?`کران مرورگر یک مرحله از صف را اجرا کرد؛ نتیجه و خطاها را در همان ردیف صف بررسی کنید.`:'کران مرورگر آمادهٔ اجرای مرحلهٔ بعد است.');
}
async function cycle(){
 if(busy||stopped)return;busy=true;toggle.disabled=true;let delay=45;
 try{
  const state=await api('/api/cron/browser/config');toggle.checked=state.config.enabled;
  if(state.priority){show(state.priority);delay=state.priority.retry_after_seconds;}
  else{const value=await api('/api/cron/browser/run',{});show(value);delay=value.retry_after_seconds||45;}
 }catch(error){label.textContent='کران مرورگر نتوانست اجرا را تأیید کند؛ '+error.message;delay=60;}
 finally{busy=false;toggle.disabled=false;later(delay);}
}
toggle.addEventListener('change',async()=>{
 if(busy)return;busy=true;toggle.disabled=true;clearTimeout(timer);
 try{const value=await api('/api/cron/browser/config',{enabled:toggle.checked});toggle.checked=value.config.enabled;show(value.priority||{});}
 catch(error){label.textContent=error.message;toggle.checked=!toggle.checked;}
 finally{busy=false;toggle.disabled=false;later(5);}
});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy)later(5);});
window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);});
window.addEventListener('pageshow',()=>{if(stopped){stopped=false;later(5);}});
// Let the interface hydrate first. Each tab is sequential; the shared server
// lock and 45-second throttle arbitrate all tabs, users and cron sources.
later(5);
})();
