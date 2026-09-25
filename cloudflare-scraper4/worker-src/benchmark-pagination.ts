/** Preserve nested Crawlee causes without serializing a browser/process object. */
export function benchmarkError(error:unknown):string{
 const seen=new Set<unknown>(),messages:string[]=[];let current:any=error;
 for(let depth=0;current!=null&&depth<5&&!seen.has(current);depth++){
  seen.add(current);const message=String(current?.message??current).replace(/\x1b\[[0-9;]*m/g,'').slice(0,8000);
  if(!messages.includes(message))messages.push(message);current=current?.cause;
 }
 return messages.join('\nCause: ').slice(0,24000);
}
/** Evidence-based three-page probe shared by the Worker and Node runtimes. */
export async function benchmarkPagination(profile:any,io:{pageUrl(profile:any,page:number):string;scrape(url:string,nextSelector:string):Promise<any>;onPage?(result:any,index:number):void;emit?(event:any):void;scroll?():Promise<any>}){
 const mode=profile.pagination||'query_page',records:any[]=[],products:any[]=[],seen=new Set<string>(),urls=new Set<string>();let error='';
 const add=(rows:any[])=>{let added=0;for(const p of rows){const key=p.sourceKey||p.url||p.sku||p.title;if(key&&!seen.has(key)){seen.add(key);products.push(p);added++}}return added};
 if(mode==='scroll'){
  if(!io.scroll)return {products,records,pagesScanned:0,error:'این موتور آزمون اسکرول واقعی ندارد؛ سه دریافت یک URL جای صفحه‌بندی نیست.',mode,status:'unsupported',transitionsVerified:0,verified:false};
  try{io.emit?.({status:'running',page:1,pagesScanned:0,summary:'آزمون واقعی اسکرول؛ تا سه دستهٔ دارای محصول تازه'});const result=await io.scroll();add(result.products||[]);records.push(...result.batches);if(records.length<3)error='سه دستهٔ تازه در اسکرول مشاهده نشد؛ نتیجهٔ سه‌صفحه‌ای تأیید نشد.'}catch(e){error=benchmarkError(e)}
  return {products,records,pagesScanned:records.length,error,mode,status:error?'incomplete':'verified',transitionsVerified:Math.max(0,records.length-1),verified:!error&&records.length===3};
 }
 let url=io.pageUrl(profile,1);const limit=mode==='none'?1:3;
 for(let page=1;page<=limit;page++){
  const from=records.at(-1)?.url||null;
  try{
   const normalized=new URL(url);normalized.hash='';url=normalized.href;
   if(urls.has(url))throw Error('لینک صفحهٔ بعد تکراری است؛ حلقهٔ صفحه‌بندی متوقف شد.');urls.add(url);
   io.emit?.({status:'running',page,pagesScanned:records.length,products:products.length,summary:'در حال آزمون صفحهٔ '+page+' و بررسی محصول تازه'});
   const result=await io.scrape(url,mode==='next_selector'?String(profile.paginationValue||''):'');io.onPage?.(result,page);
   const added=add(result.products||[]);records.push({page,url,from,products:(result.products||[]).length,newProducts:added,status:added?'verified':'repeated-or-empty',nextUrl:result.nextUrl||null});
   io.emit?.({status:added?'running':'error',page,pagesScanned:records.length,products:products.length,newProducts:added,summary:added?'صفحه با محصول تازه تأیید شد.':'محصول تازه دیده نشد؛ تغییر URL به‌تنهایی موفقیت نیست.'});
   if(!added)throw Error(page===1?'صفحهٔ اول محصول قابل شناسایی نداشت.':'صفحهٔ بعد محصول تازه نداشت؛ صفحه‌بندی تأیید نشد.');
   if(page===limit)break;
   if(mode==='next_selector'){
    if(!result.nextUrl)throw Error('لینک صفحهٔ بعد یافت نشد؛ ممکن است پایان فهرست باشد، اما سه صفحه تأیید نشد.');
    url=new URL(result.nextUrl,url).href;
   }else url=io.pageUrl(profile,page+1);
  }catch(e){error=benchmarkError(e);if(records.at(-1)?.page!==page)records.push({page,url,from,status:'failed',error});break}
 }
 const pagesScanned=records.filter(r=>r.products!==undefined).length,transitionsVerified=records.filter(r=>r.page>1&&r.status==='verified').length;
 return {products,records,pagesScanned,error,mode,status:mode==='none'&&!error?'disabled':error?'incomplete':'verified',transitionsVerified,verified:!error&&(mode==='none'||transitionsVerified===2)};
}
