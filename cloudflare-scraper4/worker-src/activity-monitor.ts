/** Names are fixed labels: never persist request bodies, URLs, tokens or prompts. */
export function activityRequestName(path:string,method='GET'):string|null{
 const p=path.split('?')[0];
 if(!p.startsWith('/api/')||/\/(activity|quota|status|version)$|\/current$|\/test-results$/.test(p))return null;
 if(method==='GET'&&!/backup|export|diagnos|selftest|\/debug$|branch-file|\/destination\//.test(p))return null;
 if(/benchmark/.test(p))return 'تست سرعت سه‌صفحه‌ای';
 if(/diagnostic|diagnos|selftest|\/debug$/.test(p))return 'عیب‌یابی و خودآزمون';
 if(/branch|backup|export|restore/.test(p))return 'پشتیبان‌گیری و انتقال تنظیمات';
 if(/import/.test(p))return 'ورود و پردازش فایل‌ها';
 if(/\/ai\//.test(p))return 'عملیات هوش مصنوعی';
 if(/\/agent\//.test(p))return 'عملیات ایجنت';
 if(/destination|recon|retire|photo|dedup|category/.test(p))return 'مدیریت و اصلاح محصولات مقصد';
 if(/deployer/.test(p))return 'نصب و مدیریت سرویس';
 if(/autoreply|digest|automation/.test(p))return 'پاسخ خودکار و گزارش دوره‌ای';
 if(/results\/apply/.test(p))return 'اعمال قیمت و پسوند روی نتایج';
 if(/settings|connections|profiles$/.test(p))return 'ذخیره و اعمال تنظیمات';
 if(/scrape|sync|jobs/.test(p))return 'درخواست صف استخراج و ارسال';
 return 'عملیات مدیریتی';
}
export type ActivityIO={setState(key:string,value:unknown):Promise<void>;deleteState(key:string):Promise<void>};
export async function beginActivity(io:ActivityIO,name:string,requestedId?:string){
 const id=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestedId||'')?requestedId!:crypto.randomUUID(),key='activity_live:'+id,startedAt=new Date().toISOString();
 let ended=false,pending=Promise.resolve();
 const row={id,kind:'operation:'+id,name,status:'running',phase:'در حال اجرا',scope:'server',readOnly:true,progress:null,startedAt,updatedAt:startedAt};
 const safe=async(work:()=>Promise<void>)=>{try{await work()}catch{}};
 const write=()=>safe(()=>io.setState(key,{...row,updatedAt:new Date().toISOString()}));
 await write();
 const timer=setInterval(()=>{pending=pending.then(()=>ended?undefined:write())},20000);timer.unref?.();
 return {id,async finish(unknown=false){if(ended)return;ended=true;clearInterval(timer);await pending;if(unknown)await safe(()=>io.setState(key,{...row,status:'unknown',phase:'ارتباط قطع شد؛ پایان عملیات تأیید نشده',updatedAt:new Date().toISOString()}));else await safe(()=>io.deleteState(key))}};
}
/** Optional instrumentation never changes an operation's outcome. */
export async function monitored<T>(io:ActivityIO,name:string,work:()=>Promise<T>):Promise<T>{const activity=await beginActivity(io,name);try{return await work()}finally{await activity.finish()}}
export function activityMiddleware(io:ActivityIO){return async(c:any,next:()=>Promise<void>)=>{
 const name=activityRequestName(c.req.path,c.req.method);if(!name)return next();
 const activity=await beginActivity(io,name,c.req.header('x-scraper-activity'));let streaming=false;
 try{
  await next();const response=c.res as Response;
  if(response.body&&(response.headers.get('content-type')||'').includes('application/x-ndjson')){
   streaming=true;const reader=response.body.getReader();
   c.res=new Response(new ReadableStream({async pull(controller){try{const next=await reader.read();if(next.done){await activity.finish();controller.close()}else controller.enqueue(next.value)}catch(error){await activity.finish();controller.error(error)}},async cancel(reason){await activity.finish(true);await reader.cancel(reason)}}),{status:response.status,statusText:response.statusText,headers:response.headers});
  }
 }finally{if(!streaming)await activity.finish()}
}}
