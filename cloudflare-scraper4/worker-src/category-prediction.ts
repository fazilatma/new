import { digest } from './destination-ledger.js';
import { stripCodeSuffix, suffixPatterns } from './dedup.js';
/** Contract observed in Woosalam GetCategoryId.php / Config/Endpoints.php.
 * Source: https://github.com/WordPressBugBounty/plugins-sync-basalam/blob/9b3a9490661b82fd6a3827bed9c2d9d12c337ef3/sync-basalam/includes/Config/Endpoints.php
 * Only GET predictions; never mutate a destination or cache credentials. */
export const CATEGORY_PREDICTION_URL='https://categorydetection.basalam.com/category_detection/api_v2.0/predict/';
export function validatedPrediction(body:any,categories:any[]){
 const rows=Array.isArray(body?.result)?body.result:[];
 const valid=rows.map((r:any)=>({id:Number(r.cat_id),score:Number(r.score??r.confidence??NaN)})).filter((r:any)=>Number.isInteger(r.id)&&r.id>0&&categories.some(c=>Number(c.id)===r.id&&c.leaf!==false));
 const distinct=[...new Map(valid.map((r:any)=>[r.id,r])).values()] as Array<{id:number;score:number}>;
 if(distinct.length===1){const row=distinct[0];return Number.isFinite(row.score)&&(row.score<.8||row.score>1)?null:row.id;}
 // The plugin assumes rank order. Without an unambiguous score we prefer fallback.
 if(distinct.length>1){distinct.sort((a,b)=>b.score-a.score);const [a,b]=distinct;if(a.score>=.8&&a.score<=1&&b.score>=0&&b.score<=1&&a.score-b.score>=.15)return a.id}
 return null;
}
export async function predictBasalamCategory(product:any,categories:any[],io:{getState(key:string,fallback:any):Promise<any>;setState(key:string,value:any):Promise<void>;fetch(url:string,init:RequestInit,maxBytes:number):Promise<Response>},token='',timeoutMs=8000){
 if(!categories.length)return {ok:false,error:'فهرست معتبر دسته‌بندی در دسترس نیست.'};
 const title=stripCodeSuffix(String(product.title||''),suffixPatterns([])).trim().slice(0,500);if(!title)return {ok:false,error:'عنوان محصول خالی است.'};
 const key='category_prediction:'+await digest({title,taxonomy:categories.map(c=>[c.id,c.leaf,c.parentId]).sort((a,b)=>Number(a[0])-Number(b[0]))});
 try{const cached=await io.getState(key,null);if(cached&&Date.now()-Date.parse(cached.at)<86400000&&categories.some(c=>Number(c.id)===cached.categoryId&&c.leaf!==false))return {ok:true,categoryId:cached.categoryId,cached:true}}catch{/* cache is optional */}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.max(100,Math.min(8000,timeoutMs)));
 try{
  const url=new URL(CATEGORY_PREDICTION_URL);url.searchParams.set('title',title);
  const response=await io.fetch(url.href,{method:'GET',redirect:'error',headers:{accept:'application/json',...(token?{authorization:'Bearer '+token}:{})},signal:controller.signal},500000);
  if(!response.ok)return {ok:false,error:'پیشنهاد دسته‌بندی باسلام: HTTP '+response.status};
  const categoryId=validatedPrediction(await response.json(),categories);
  if(!categoryId)return {ok:false,error:'پیشنهاد دسته‌بندی نامعتبر یا مبهم بود؛ مسیر جایگزین استفاده می‌شود.'};
  try{await io.setState(key,{categoryId,at:new Date().toISOString()})}catch{/* a valid response remains usable */}
  return {ok:true,categoryId,cached:false};
 }catch{return {ok:false,error:'سرویس پیشنهاد دسته‌بندی در دسترس نبود؛ مسیر جایگزین استفاده می‌شود.'}}
 finally{clearTimeout(timer)}
}
