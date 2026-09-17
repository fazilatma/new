import { digest, LEDGER_TTL } from './destination-ledger.js';
/** Compare the initial list before fetching detail pages or invoking AI again.
 * A periodic detail audit is still needed: detail-only changes cannot be seen in a list.
 */
export async function reuseSourceList<T extends {sourceKey:string;price:number;title:string;priceText:string}>(fresh:T,previous:any,profile:any):Promise<T>{
 const row=fresh as any;
 const signature=await digest({list:Object.fromEntries(['title','price','priceText','url','sku','image','images','stock','brand','shortDesc','longDesc','weight','category','variationGroups','variationPrices'].map(k=>[k,row[k]])),selectors:profile.selectors,gallery:profile.gallery});
 if(previous?.sourceList?.valid&&previous.sourceList.signature===signature&&Date.now()-Date.parse(previous.sourceList.checkedAt)<LEDGER_TTL&&previous.resultBase){
  return {...structuredClone(previous),price:previous.resultBase.price,priceText:previous.resultBase.priceText,title:previous.resultBase.title,variationPrices:previous.resultBase.variationPrices??previous.variationPrices,variationGroups:previous.variationGroups?.map((g:any,i:number)=>({...g,prices:previous.resultBase.groupPrices?.[i]??g.prices})),sourceList:previous.sourceList,_reuseDetails:true};
 }
 if(Number(previous?.basalamCategoryId)>0&&!(Number(row.basalamCategoryId)>0))for(const key of ['basalamCategoryId','basalamCategoryName','basalamCategoryPath','basalamCategorySource'])row[key]=previous[key];
 row.sourceList={signature,checkedAt:new Date().toISOString(),valid:true};return fresh;
}
export function sourceDetailFailed(product:any){if(product.sourceList)product.sourceList.valid=false}

/** A list-only refresh must not erase an existing manual category or descriptions. */
export function mergeListOnly<T>(fresh:T,previous:any):T {
 const product:any={...fresh};
 for(const key of ['shortDesc','longDesc','basalamCategoryId','basalamCategoryName','basalamCategoryPath','basalamCategorySource','aiEnrichedAt']){
  if((product[key]===undefined||product[key]===null||product[key]===''||key==='basalamCategoryId'&&!Number(product[key]))&&previous?.[key]!==undefined)product[key]=previous[key];
 }
 delete product.sourceList;delete product.resultBase;delete product._reuseDetails;
 return product;
}
