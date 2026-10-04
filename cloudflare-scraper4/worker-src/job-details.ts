/** Bounded summary for the three-second Task Manager poll; never ship the full log. */
export function extractionDetails(job:any,now=Date.now()){
 const log=Array.isArray(job.log)?job.log:[],cache=log.filter((r:any)=>r.event==='source-cache'),last=[...log].reverse().find((r:any)=>r.item?.sourceKey),pages=new Set(log.map((r:any)=>String(r.message||'').match(/صفحه\s+([۰-۹٠-٩\d]+)/)?.[1]).filter(Boolean));
 const started=Date.parse(job.startedAt||''),end=['queued','running'].includes(job.status)?now:Date.parse(job.finishedAt||job.updatedAt||'');
 return {processed:Number(job.processed)||0,total:Number(job.total)||0,added:Number(job.added)||0,updated:Number(job.updated)||0,failed:Number(job.failed)||0,pages:pages.size,
 listCount:cache.length?cache.reduce((n:number,r:any)=>n+(Number(r.item?.listCount)||0),0):null,reusedCount:cache.length?cache.reduce((n:number,r:any)=>n+(Number(r.item?.reusedCount)||0),0):null,
 elapsedMs:Number.isFinite(started)&&Number.isFinite(end)?Math.max(0,end-started):null,lastProduct:String(last?.item?.title||'').slice(0,200),lastEventAt:last?.at||null,
 sent:log.filter((r:any)=>['sync-created','sync-updated'].includes(r.event)).length,sendSkipped:log.filter((r:any)=>r.event==='sync-skipped').length,zeroPrice:log.filter((r:any)=>r.event==='zero-price').length,
 waiting:job.status==='queued'?(job.startedAt?'نقطهٔ بازیابی ذخیره شده؛ منتظر اجراکننده برای ادامهٔ همین مرحله.':'منتظر دریافت توسط اجراکننده و ظرفیت آزاد صف؛ هنوز شروع نشده است.'):'',
 note:'شمارنده‌های کش، صفحات و ارسال از رویدادهای موجود در گزارش وظیفه هستند.'};
}
