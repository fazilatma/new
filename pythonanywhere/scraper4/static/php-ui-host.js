/* Trusted parent: the original PHP client never receives cookie/CSRF authority. */
(()=>{'use strict';
const frame=document.getElementById('php-original-ui'),status=document.getElementById('php-ui-status'),revisions=new Map();
const reads=new Set(['app_ready','load_profile','load_connections','start_product_stats','extract_queue_status','tasks_list','whoami','python_capabilities']);
const writes=new Set(['save_profile','python_enqueue']);let busy=false;
document.getElementById('php-ui-capabilities').onclick=()=>{const help=document.getElementById('php-ui-help');help.open=!help.open;};
function action(query,fields){return fields.action||query.action||Object.keys(query).find(k=>k!=='_'&&k!=='_v'&&k!=='_ready')||'';}
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||event.origin!=='null')return;
 const m=event.data;if(!m||m.type!=='s4-php-request'||typeof m.id!=='string'||m.id.length>100)return;
 const answer=(code,data)=>frame.contentWindow.postMessage({type:'s4-php-response',id:m.id,status:code,data},'*');
 try{
  if(typeof m.url!=='string'||m.url.length>10000||!['GET','POST'].includes(m.method)||!m.fields||typeof m.fields!=='object'||Array.isArray(m.fields))throw Error('درخواست رابط معتبر نیست.');
  const u=new URL(m.url,location.origin+'/php-ui/frame');
  if(u.origin!==location.origin||u.pathname!=='/php-ui/frame'||u.username||u.password)throw Error('شبکهٔ بیرونی در رابط جداشده مجاز نیست.');
  const query=Object.fromEntries(u.searchParams),op=action(query,m.fields);
  if(typeof op!=='string'||op.length>100)throw Error('نام عملیات معتبر نیست.');
  if(!reads.has(op)&&!writes.has(op)){status.textContent='این عملیات هنوز متصل نیست: '+op;answer(501,{ok:false,error:'این عملیات PHP هنوز به پایتون متصل نشده است: '+op,unsupported:true});return;}
  if(JSON.stringify(m.fields).length>1500000)throw Error('اندازهٔ درخواست بیش از حد است.');
  const write=writes.has(op);
  if(write){
   if(JSON.stringify(m.fields).length>100000)throw Error('فرم ذخیره بیش از حد بزرگ است.');
   if(m.fields.autosave==='1'){answer(409,{ok:false,error:'native_explicit_save_required'});return;}
   if(busy){answer(409,{ok:false,error:'عملیات دیگری منتظر تأیید یا ذخیره است.'});return;}
   busy=true;
   const summary={operation:op==='save_profile'?'ذخیرهٔ صریح پروفایل؛ محصولات تغییر نمی‌کنند':'افزودن استخراج به صف؛ ارسال مقصد ندارد',fields:m.fields};
   if(!confirm('تأیید عملیات پایتون از رابط PHP\n\n'+JSON.stringify(summary,null,2))){busy=false;answer(409,{ok:false,error:'با درخواست شما لغو شد.'});return;}
  }
  try{
   const payload={action:op,query,fields:m.fields};
   if(op==='save_profile')payload.revision=revisions.get(m.fields.target_key)||null;
   const response=await fetch('/api/php-ui/'+(write?'write':'read'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]').content},body:JSON.stringify(payload)});
   const data=await response.json();
   if(data.key&&data.revision)revisions.set(data.key,data.revision);
   status.textContent=data.ok?(write?'عملیات پایتون انجام شد؛ اطلاعات واقعی ذخیره/صف شد.':'رابط اصلی PHP · اتصال‌های فعال از پایتون پاسخ می‌گیرند.'):(data.error||'خطای اتصال');
   answer(response.status,data);
  }finally{if(write)busy=false;}
 }catch(e){busy=false;status.textContent=e.message;answer(400,{ok:false,error:e.message});}
});
})();
