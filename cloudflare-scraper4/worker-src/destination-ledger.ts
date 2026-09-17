/** Persistent destination snapshots and acknowledged-write receipts. No credentials are stored. */
export const LEDGER_TTL=6*60*60*1000;
export type LedgerEntry={remote:any;at:string;desiredHash?:string;observedHash?:string;invalid?:boolean;deleted?:boolean;profileId?:string;sourceKey?:string};
export type LedgerIO={getState<T>(key:string,fallback:T):Promise<T>;setState(key:string,value:unknown):Promise<void>;ledgerRows(scope:string,generation:string):Promise<LedgerEntry[]>;ledgerPut(scope:string,generation:string,entries:LedgerEntry[]):Promise<void>;ledgerGet(scope:string,generation:string,id:string):Promise<LedgerEntry|null>;ledgerPrune(scope:string,keep:string[]):Promise<void>};
export function stable(value:any):string{return JSON.stringify(value===undefined?null:Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,JSON.parse(stable(value[k]))])):value)}
export async function digest(value:unknown):Promise<string>{return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value))))].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function ledgerScope(target:string,endpoint:string,accountKey:string){const u=new URL(endpoint);return target+':'+await digest([u.origin,u.pathname.replace(/\/+$/,''),accountKey])}
/** Only destination-owned product data, excluding counters/last-modified timestamps. */
export function observed(remote:any){const raw=remote.raw||{};return {name:remote.name,sku:remote.sku||'',price:Number(remote.price)||0,status:String(remote.status||''),stock:raw.stock_quantity??raw.stock,description:raw.description,short:raw.short_description,weight:raw.weight,categories:raw.categories??raw.category_id,images:raw.images??raw.photos,attributes:raw.attributes,variations:raw.variations}}
export function desiredProduct(product:any,profile:any,config:any){return {product:Object.fromEntries(['title','price','priceText','sku','shortDesc','longDesc','image','images','stock','weight','basalamCategoryId','variationGroups','variationPrices','destinationStatus'].map(k=>[k,product[k]])),profile:{id:profile.id,wooCategoryId:profile.wooCategoryId,basalamCategoryId:profile.basalamCategoryId,basalamFallbackCategoryIds:profile.basalamFallbackCategoryIds},config:Object.fromEntries(['replaceImages','target','pricePercent','categoryId','preparationDays','weight','packageWeight','stock','autoCategory','fallbackCategoryIds','contentSync'].map(k=>[k,config[k]]))}}
export function equivalentDesired(remote:any,desired:any):boolean{
 const p=desired?.product,c=desired?.config,profile=desired?.profile;if(!p||!c||!remote?.raw)return false;
 const raw=remote.raw,basalam=c.target==='basalam',price=Math.round(Number(p.price)*(1+(Number(c.pricePercent)||0)/100))*(basalam&&!/ریال|rial|irr/i.test(p.priceText||'')?10:1);
 if(remote.name!==p.title||Number(remote.price)!==price||!(price>0)||(p.variationGroups||[]).length)return false;
 if(basalam&&String(remote.status)!=='2976'||!basalam&&p.destinationStatus&&remote.status!==p.destinationStatus)return false;
 const stock=p.stock??(basalam?c.stock:undefined);if(stock!==undefined&&Number(raw.stock_quantity??raw.stock)!==Number(stock))return false;
 if(c.contentSync!==false){if(String(raw.description??'')!==String(basalam?(p.longDesc||p.shortDesc||''):(p.longDesc||'')))return false;if(!basalam&&String(raw.short_description||'')!==String(p.shortDesc||''))return false;
 const images=(p.images||[]).map(String);if(images.length||c.replaceImages){if(basalam)return false;const actual=(raw.images||[]).map((x:any)=>String(x.src||''));if(stable(images)!==stable(actual))return false}}
 const category=basalam?(p.basalamCategoryId||profile.basalamCategoryId||c.categoryId):(profile.wooCategoryId||c.categoryId);if(category){const actual=basalam?(raw.category_id??raw.category?.id):raw.categories?.[0]?.id;if(String(actual)!==String(category))return false}
 if(p.weight&&Number(raw.weight)!==Number(p.weight))return false;
 // Missing detail fields in list responses are not proof that those details match.
 if((p.longDesc||p.shortDesc)&&raw.description===undefined)return false;
 return true;
}
export function cleanRemote(remote:any){const raw=remote.raw||{},keys=['id','name','title','sku','price','primary_price','regular_price','sale_price','status','stock','stock_quantity','manage_stock','catalog_visibility','description','short_description','weight','dimensions','categories','category_id','category','images','photos','photo','attributes','variations'];return {...remote,raw:Object.fromEntries(keys.filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]))}}
export function createDestinationLedger(io:LedgerIO){
 const inflight=new Map<string,Promise<any>>();
 const key=(scope:string)=>'ledger_meta:'+scope;
 async function metadata(scope:string){return io.getState<any>(key(scope),null)}
 async function entries(scope:string){const meta=await metadata(scope),base:LedgerEntry[]=meta?await io.ledgerRows(scope,meta.generation):[],live=await io.ledgerRows(scope,'live');if(meta&&base.length!==meta.count)throw Error('نسخهٔ دفتر حساب ناقص است؛ تازه‌سازی لازم است.');const map=new Map(base.map(x=>[String(x.remote.id),x]));for(const x of live)if(!meta||x.at>=meta.startedAt){if(x.deleted)map.delete(String(x.remote.id));else map.set(String(x.remote.id),x)}return [...map.values()]}
 async function refresh(scope:string,fetchAll:()=>Promise<any[]>,force=false){
  const meta=await metadata(scope);if(!force&&meta?.inventoryPolicy==='customer-visible-v1'&&Date.now()-Date.parse(meta.startedAt)<LEDGER_TTL)return {cached:true,...meta};
  if(inflight.has(scope))return inflight.get(scope);
  const task=(async()=>{const startedAt=new Date().toISOString(),generation=crypto.randomUUID();const all=await fetchAll(),unique=new Map<string,any>();for(const remote of all){if(!remote?.id)throw Error('شناسهٔ محصول مقصد در اسکن دفتر حساب نامعتبر است.');const id=String(remote.id);if(unique.has(id))throw Error('صفحهٔ تکراری مقصد؛ کامل بودن دفتر حساب تأیید نشد.');unique.set(id,cleanRemote(remote))}
   const rows=[...unique.values()].map(remote=>({remote,at:startedAt}));for(let i=0;i<rows.length;i+=20)await io.ledgerPut(scope,generation,rows.slice(i,i+20));
   const next={generation,previous:meta?.generation,startedAt,completedAt:new Date().toISOString(),count:rows.length,complete:true,inventoryPolicy:'customer-visible-v1',durationMs:Math.max(0,Date.now()-Date.parse(startedAt))};await io.setState(key(scope),next);
   // Keep the previous immutable generation for concurrent readers; writes live separately.
   await io.ledgerPrune(scope,[generation,meta?.generation||'', 'live']).catch(()=>{});return {cached:false,...next};
  })();inflight.set(scope,task);try{return await task}finally{inflight.delete(scope)}
 }
 async function find(scope:string,id:unknown,sku=''){const meta=await metadata(scope);if(id){const live=await io.ledgerGet(scope,'live',String(id));const base=meta?await io.ledgerGet(scope,meta.generation,String(id)):null;if(live&&(!meta||live.at>=meta.startedAt))return live;if(base){if(live?.desiredHash&&!live.invalid&&!live.deleted&&live.observedHash===await digest(observed(base.remote)))return {...base,desiredHash:live.desiredHash,profileId:live.profileId,sourceKey:live.sourceKey};return {...base,profileId:live?.profileId,sourceKey:live?.sourceKey}}return null}
  if(!sku||!meta||Date.now()-Date.parse(meta.startedAt)>=LEDGER_TTL)return null;const matches=(await entries(scope)).filter(x=>x.remote.sku===sku&&!x.invalid&&!x.deleted);return matches.length===1?matches[0]:null;
 }
 async function matches(entry:LedgerEntry|null,desired:unknown){return !!entry&&!entry.invalid&&!entry.deleted&&Date.now()-Date.parse(entry.at)<LEDGER_TTL&&(entry.desiredHash===await digest(desired)||!entry.desiredHash&&equivalentDesired(entry.remote,desired))}
 async function invalidate(scope:string,id:unknown){if(id){const before=await find(scope,id);await io.ledgerPut(scope,'live',[{remote:before?.remote||{id:String(id)},profileId:before?.profileId,sourceKey:before?.sourceKey,at:new Date().toISOString(),invalid:true}])}}
 async function confirm(scope:string,remote:any,desired:unknown,profileId:string,sourceKey:string,observedAt?:string){if(!remote?.id)return;remote=cleanRemote(remote);await io.ledgerPut(scope,'live',[{remote,at:observedAt||new Date().toISOString(),desiredHash:await digest(desired),observedHash:await digest(observed(remote)),profileId,sourceKey}])}
 async function patch(scope:string,id:unknown,changes:any,deleted=false){const previous=await find(scope,id);await io.ledgerPut(scope,'live',[{profileId:previous?.profileId,sourceKey:previous?.sourceKey,remote:{...previous?.remote,...changes,id:String(id),raw:{...previous?.remote?.raw,...changes}},at:new Date().toISOString(),deleted,invalid:!previous?.remote?.name&&!deleted}])}
 return {metadata,entries,refresh,find,matches,invalidate,confirm,patch};
}
