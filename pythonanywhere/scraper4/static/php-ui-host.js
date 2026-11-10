/* Trusted parent: the original PHP client never receives cookie/CSRF authority. */
(()=>{'use strict';
const frame=document.getElementById('php-original-ui'),status=document.getElementById('php-ui-status'),revisions=new Map();
const reads=new Set(['python_extract_row','python_cleanup_preview','app_ready','load_profile','load_connections','start_product_stats','extract_queue_status','tasks_list','whoami','python_capabilities','woo_queue_status','bsl_queue_status','poll_woo','poll_basalam','poll_bsl','poll_extract','python_contracts','runtime_health','python_start_status','python_github_catalog','sync_diagnose','sync_pipeline_status','python_sync_audit']);
const writes=new Set(['python_detail_start','python_extract_resume','python_cleanup_products','save_profile','python_enqueue','python_send_enqueue','python_manual_sync','python_queue_control','python_queue_clear','python_profile_duplicate','python_profile_delete','python_extract_start','python_extract_step']);let busy=false,selectionTicket=0;
document.getElementById('php-ui-capabilities').onclick=()=>{const help=document.getElementById('php-ui-help');help.open=!help.open;};
function action(query,fields){return fields.action||query.action||Object.keys(query).find(k=>k!=='_'&&k!=='_v'&&k!=='_ready')||'';}
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||event.origin!=='null')return;
 const m=event.data;if(!m||m.type!=='s4-php-request'||typeof m.id!=='string'||m.id.length>100)return;
 let ownsBusy=false;
 const answer=(code,data)=>frame.contentWindow.postMessage({type:'s4-php-response',id:m.id,status:code,data},'*');
 try{
  if(typeof m.url!=='string'||m.url.length>10000||!['GET','POST'].includes(m.method)||!m.fields||typeof m.fields!=='object'||Array.isArray(m.fields))throw Error('درخواست رابط معتبر نیست.');
  const u=new URL(m.url,location.origin+'/php-ui/frame');
  if(u.origin!==location.origin||u.pathname!=='/php-ui/frame'||u.username||u.password)throw Error('شبکهٔ بیرونی در رابط جداشده مجاز نیست.');
  const query=Object.fromEntries(u.searchParams),op=action(query,m.fields);
  if(typeof op!=='string'||op.length>100)throw Error('نام عملیات معتبر نیست.');
  if(op==='python_open_panel'){const opened=window.S4NativeTools?.open(m.fields.panel);answer(opened?200:400,{ok:!!opened,error:opened?'':'پنل متصل معتبر نیست.'});return;}
  if(!reads.has(op)&&!writes.has(op)){status.textContent='این عملیات هنوز متصل نیست: '+op;answer(501,{ok:false,error:'این عملیات PHP هنوز به پایتون متصل نشده است: '+op,unsupported:true});return;}
  if(JSON.stringify(m.fields).length>1500000)throw Error('اندازهٔ درخواست بیش از حد است.');
  if(op==='load_profile'&&window.S4ProfileOptions?.canSwitch()===false){answer(409,{ok:false,error:'ابتدا تغییرات تنظیمات پروفایل را ذخیره/لغو کنید.'});return;}
  const ticket=op==='load_profile'?++selectionTicket:0;
  const write=writes.has(op);
  if(write){
   if(JSON.stringify(m.fields).length>100000)throw Error('فرم ذخیره بیش از حد بزرگ است.');
   if(m.fields.autosave==='1'){answer(409,{ok:false,error:'native_explicit_save_required'});return;}
   if(busy){answer(409,{ok:false,error:'عملیات دیگری منتظر تأیید یا ذخیره است.'});return;}
   busy=true;ownsBusy=true;
   const summary={operation:op==='python_detail_start'?'جزئیات محصولات دارای لینک همین پروفایل از دادهٔ ذخیره‌شده؛ یک مرحلهٔ واقعی و ادامه با worker/صف. فهرست از نو خوانده نمی‌شود، محصولات/قیمت/شناسهٔ مقصد پاک نمی‌شوند و هیچ ارسال اجرا نمی‌شود':op==='python_extract_resume'?'ادامهٔ همین ردیف استخراج از checkpoint ذخیره‌شده و اجرای یک مرحلهٔ واقعی؛ بدون ساخت کار تازه، تغییر پروفایل انتخاب‌شده یا اجرای صف ارسال. ردیف running فقط با ضربان قدیمی و قفل آزاد قابل بازیابی است':op==='python_cleanup_products'?'حذف محصولات محلی مطابق پیش‌نمایش، حداکثر ۱۰۰۰ مورد؛ برگشت‌ناپذیر و شامل شناسه‌های محلی مقصد است. محصولات فروشگاه مقصد حذف نمی‌شوند':op==='python_extract_start'?'شروع یا اجرای یک مرحله از کار در انتظار همین پروفایل؛ کار در انتظار از ابتدا ساخته نمی‌شود و checkpoint آن حفظ می‌شود. ادامهٔ صفحات/جزئیات با worker/کران یا دکمهٔ مرحلهٔ بعد. هیچ صف ارسالی اجرا نمی‌شود':op==='python_extract_step'?'اجرای یک مرحله از استخراج مشخص‌شده؛ بدون اجرای ارسال و بدون ادامهٔ خودکار کار ناموفق':op==='save_profile'?'ذخیرهٔ صریح پروفایل؛ محصولات تغییر نمی‌کنند':op==='python_profile_delete'?'حذف برگشت‌ناپذیر پروفایل و همهٔ محصولات و شناسه‌های محلی آن؛ محصولات فروشگاه مقصد حذف نمی‌شوند':op==='python_profile_duplicate'?'کپی فقط تنظیمات ذخیره‌شدهٔ پروفایل؛ بدون محصولات و شناسه‌های مقصد':'تغییر صف/پروفایل؛ صف ارسال روی همهٔ محصولات ذخیره‌شدهٔ همین پروفایل است، نه فقط نمای فیلترشده. ادامهٔ ارسال ناموفق نیاز به بررسی مقصد و شناسه‌ها دارد؛ مکث/لغو درخواست درحال پرواز را برنمی‌گرداند.',fields:m.fields};
   if(!confirm('تأیید عملیات پایتون از رابط PHP\n\n'+JSON.stringify(summary,null,2))){busy=false;answer(409,{ok:false,error:'با درخواست شما لغو شد.'});return;}
  }
  try{
   const payload={action:op,query,fields:m.fields};
   if(op==='save_profile')payload.revision=revisions.get(m.fields.target_key)||null;
   const response=await fetch('/api/php-ui/'+(write?'write':'read'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content},body:JSON.stringify(payload)});
   let data,code=response.status;
   try{data=await response.json();if(!data||typeof data!=='object'||typeof data.ok!=='boolean')throw Error('invalid envelope');}
   catch{code=response.status>=400?response.status:502;data={ok:false,error:response.status===401?'نشست پایان یافته است؛ دوباره وارد شوید.':`پاسخ endpoint معتبر نیست (HTTP ${response.status})؛ وضعیت سرور را بررسی و دوباره تلاش کنید.`};}

   if(op==='app_ready'&&response.ok&&data.ok)document.body.classList.remove('php-ui-loading');
   if(data.key&&data.revision)revisions.set(data.key,data.revision);
   if(op==='load_profile'&&response.ok&&data.profile&&ticket===selectionTicket){window.S4NativeSelection=data.profile;window.S4NativeTools?.select(data.profile);}
   status.textContent=data.ok?(write?'عملیات پایتون انجام شد؛ اطلاعات واقعی ذخیره/صف شد.':'رابط اصلی PHP · اتصال‌های فعال از پایتون پاسخ می‌گیرند.'):(data.error||'خطای اتصال');
   answer(code,data);
  }finally{if(write)busy=false;}
 }catch(e){if(ownsBusy)busy=false;status.textContent=e.message;answer(400,{ok:false,error:e.message});}
});
})();
