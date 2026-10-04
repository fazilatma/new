import {benchmarkError} from './benchmark-pagination.js';
/** One real product per engine, sequential and opt-in; list timing/results stay independent. */
export async function diagnosticDetails(product:any,profile:any,engine:string,extract:(p:any,profile:any,engine:string)=>Promise<any>){
 const started=Date.now();
 if(!product?.url)return {ok:false,skipped:true,engine,error:'محصول دارای لینک برای استخراج جزئیات پیدا نشد.',product:product||null,elapsedMs:0};
 try{
  const result=await extract(structuredClone(product),structuredClone(profile),engine);
  const bounded=boundedDiagnosticProduct(result.product);
  return {ok:true,engine,loader:['playwright','puppeteer','crawlee_playwright'].includes(engine)?engine:engine==='network_api'?'playwright DOM (API JSON has no detail selectors)':'http',...result,...bounded,...(bounded.truncated?{warning:'نمونهٔ بسیار بزرگ برای گزارش محدود شد؛ توضیحات حداکثر ۱۰۰هزار نویسه و آرایه‌ها حداکثر ۶۰ مورد دارند.'}:{}),elapsedMs:Date.now()-started};
 }catch(error){return {ok:false,engine,error:benchmarkError(error),product:structuredClone(product),elapsedMs:Date.now()-started}}
}

/** Bound transient reports; do not let an unusually large page exhaust the live stream. */
export function boundedDiagnosticProduct(product:any){
 let budget=180000,truncated=false;
 function trim(value:any,depth=0):any{
  if(typeof value==='string'){const size=Math.max(0,Math.min(budget,100000));const text=value.slice(0,size);budget-=text.length;if(text.length<value.length)truncated=true;return text}
  if(value===null||typeof value!=='object')return value;
  if(depth>5){truncated=true;return null}
  if(Array.isArray(value)){if(value.length>60)truncated=true;return value.slice(0,60).map(v=>trim(v,depth+1))}
  const entries=Object.entries(value);if(entries.length>60)truncated=true;return Object.fromEntries(entries.slice(0,60).map(([k,v])=>[k,trim(v,depth+1)]));
 }
 return {product:trim(product),truncated};
}
