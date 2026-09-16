import { loadConnections } from './connections.js';
import { findLearnedCategory, getDestinationId, getRemoteId, getState, setDestinationId, setRemoteId } from './db.js';
import { safeBasalamFetch, safeFetch, safeWooFetch } from './network.js';
import { basicAuth, toRemoteId } from './utils.js';
import type { Product, Profile, VariationGroup } from './types.js';

export async function syncWoo(product:Product,profile:Profile):Promise<'created'|'updated'> {
  const c=(await loadConnections()).woo;
  if(!c.url||!c.key||!c.secret)throw new Error('تنظیمات ووکامرس کامل نیست');
  const base=c.url.replace(/\/$/,'')+'/wp-json/wc/v3/products',auth=basicAuth(c.key,c.secret);
  let id=await getRemoteId(profile.id,product.sourceKey,'woo');
  const sku=product.sku||`s4-${profile.id}-${product.sourceKey}`.slice(0,100);
  if(!id){
    const search=await safeWooFetch(`${base}?sku=${encodeURIComponent(sku)}`,{headers:{authorization:auth,accept:'application/json'}},2_000_000);
    if(search.ok){const found=await search.json() as any[];id=toRemoteId(found[0]?.id)}
  }
  const groups=(product.variationGroups||[]).filter(group=>group.name&&group.values?.length);
  const contentSync=(await getState<any>('settings',{}))?.general?.contentSync!==false;
  // The configured WooCommerce adjustment percentage, applied to every price
  // pushed to the destination (0 = send the source price unchanged).
  const wooPercent=Number(c.pricePercent)||0;
  const wooPrice=(value:number)=>String(Math.round((Number(value)||0)*(1+wooPercent/100)));
  const payload:any={name:product.title,sku,type:groups.length?'variable':'simple',regular_price:wooPrice(product.price)};
  if(!id||contentSync){payload.description=product.longDesc||'';payload.short_description=product.shortDesc||'';if(product.images.length)payload.images=product.images.map(src=>({src}))}
  if(product.destinationStatus)payload.status=product.destinationStatus;
  if(product.stock!==undefined)Object.assign(payload,{manage_stock:true,stock_quantity:product.stock});
  if(product.weight)payload.weight=String(product.weight);
  if(groups.length)payload.attributes=groups.map(group=>({name:group.name,visible:true,variation:true,options:group.values.slice(0,100)}));
  const category=profile.wooCategoryId||c.categoryId;if(category)payload.categories=[{id:category}];
  const response=await safeWooFetch(id?`${base}/${id}`:base,{method:'POST',headers:{authorization:auth,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},3_000_000),body=await response.json().catch(()=>({})) as any;
  if(!response.ok)throw new Error(`WooCommerce HTTP ${response.status}: ${body.message||JSON.stringify(body).slice(0,300)}`);
  const remoteId=toRemoteId(body.id||id) ?? 0;
  if(remoteId){
    await setRemoteId(profile.id,product.sourceKey,'woo',remoteId);
    await setDestinationId(profile.id,product.sourceKey,'woo','default',remoteId);
    if(groups.length)await syncWooVariations(base,remoteId,sku,groups,product,auth,wooPercent);
  }
  return id?'updated':'created';
}

async function syncWooVariations(base:string,parentId:number|string,parentSku:string,groups:VariationGroup[],product:Product,auth:string,pricePercent=0):Promise<void>{
  const wooPrice=(value:number)=>String(Math.round((Number(value)||0)*(1+pricePercent/100)));
  const combinations=cartesian(groups).slice(0,100);
  for(let index=0;index<combinations.length;index++){
    const options=combinations[index],sku=`${parentSku}-v${index+1}`.slice(0,100);
    const search=await safeWooFetch(`${base}/${parentId}/variations?sku=${encodeURIComponent(sku)}&per_page=1`,{headers:{authorization:auth,accept:'application/json'}},1_000_000);
    const found=search.ok?await search.json().catch(()=>[]) as any[]:[],existing=Number(found[0]?.id)||0;
    const keyedPrices=options.map(option=>product.variationPrices?.[option.value]).filter((price):price is number=>Number(price)>0);
    const payload:any={sku,regular_price:wooPrice(keyedPrices[0]||product.price),attributes:options.map(({name,option})=>({name,option}))};
    if(product.stock!==undefined)Object.assign(payload,{manage_stock:true,stock_quantity:product.stock});
    if(product.image)payload.image={src:product.image};
    const result=await safeWooFetch(existing?`${base}/${parentId}/variations/${existing}`:`${base}/${parentId}/variations`,{method:'POST',headers:{authorization:auth,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},2_000_000);
    if(!result.ok){const error=await result.json().catch(()=>({})) as any;throw new Error(`WooCommerce variation HTTP ${result.status}: ${error.message||JSON.stringify(error).slice(0,300)}`)}
  }
}

function cartesian(groups:VariationGroup[]):Array<Array<{name:string;option:string;value:string}>>{
  let rows:Array<Array<{name:string;option:string;value:string}>>=[[]];
  for(const group of groups)rows=rows.flatMap(row=>group.values.slice(0,100).map(value=>[...row,{name:group.name,option:value,value}])).slice(0,100);
  return rows;
}

function basalamPrice(product:Product,percent=0):number{
  const base=Math.round(product.price*(1+percent/100));
  return /(?:ریال|rial|irr)/i.test(product.priceText||'')?base:base*10;
}

type BasalamAccount={name:string;token:string;vendorId:string;pricePercent?:number};
type BasalamSyncResult={shop:string;action:'created'|'updated';id:number|string;transport:'sdk'|'api';fallback?:string;error?:string;price?:number};
/**
 * Basalam's product schema (openapi.basalam.com/v1). Three fields were wrong and
 * made every real send fail with HTTP 400:
 *   - `photo` is the INTEGER id of a file uploaded to /v1/files, not an image URL
 *     ("Input should be a valid integer, unable to parse string as an integer").
 *   - `status` is required ("Field required"); 2976 = PUBLISHED.
 *   - the price field is `primary_price`, not `price`.
 */
const BASALAM_STATUS_PUBLISHED=2976;
/** Basalam draft status. The PHP reference creates every product here first. */
const BASALAM_STATUS_DRAFT=3790;
type BasalamPayload={name:string;primary_price:number;stock:any;description:string;status:number;photo?:number;photos?:number[];category_id?:number;weight:any;package_weight:any;preparation_days:any;sku?:string};

/**
 * A raw `401 invalid authorization header` tells the user nothing about what to
 * fix, and the usual cause is a pasted token that still carries its "Bearer "
 * prefix or an expired personal access token.
 */
/**
 * Explains a Basalam token WITHOUT calling the network.
 *
 * `401 invalid authorization header` is a malformed-header complaint, so the
 * useful question is what we actually put after "Bearer ". Basalam personal
 * access tokens are JWTs, so an expired or truncated one can be identified
 * locally and reported precisely instead of echoing Basalam's opaque message.
 */
export function describeBasalamToken(raw:string):{ok:boolean;reason:string;expiresAt?:string;scopes?:string[]}{
  const token=String(raw||'');
  if(!token)return{ok:false,reason:'توکن باسلام ذخیره نشده است؛ فیلد Token خالی است.'};
  if(/\s/.test(token))return{ok:false,reason:'توکن فاصله یا خط جدید دارد؛ آن را دوباره و بدون فاصله کپی کنید.'};
  if(/^bearer/i.test(token))return{ok:false,reason:'توکن هنوز با واژهٔ Bearer ذخیره شده است؛ فقط خود توکن را وارد کنید.'};
  const parts=token.split('.');
  if(parts.length!==3)return{ok:true,reason:'توکن قالب JWT ندارد؛ اگر باسلام آن را نمی‌پذیرد، از پنل توسعه‌دهندگان یک توکن دسترسی شخصی تازه بسازید.'};
  try{
    const pad=(s:string)=>s+'='.repeat((4-s.length%4)%4);
    const json=atob(pad(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    const payload=JSON.parse(json) as any;
    const exp=Number(payload?.exp)||0;
    const scopes=Array.isArray(payload?.scopes)?payload.scopes.map(String):(typeof payload?.scope==='string'?payload.scope.split(' '):[]);
    const expiresAt=exp?new Date(exp*1000).toISOString():undefined;
    if(exp&&exp*1000<Date.now())
      return{ok:false,reason:`توکن در ${expiresAt} منقضی شده است؛ از پنل توسعه‌دهندگان باسلام یک توکن تازه بسازید.`,expiresAt,scopes};
    const needed='vendor.product.write';
    if(scopes.length&&!scopes.includes(needed))
      return{ok:false,reason:`توکن دسترسی «${needed}» را ندارد (دسترسی‌های فعلی: ${scopes.join('، ')||'—'}); توکن را با این Scope بسازید.`,expiresAt,scopes};
    if(!scopes.length)
      return{ok:true,reason:'ساختار و تاریخ توکن سالم است، اما فهرست دسترسی‌ها داخل توکن نیست؛ اگر باسلام ۴۰۱ می‌دهد، توکن را با Scope «vendor.product.write» و برای همین غرفه بسازید.',expiresAt,scopes};
    return{ok:true,reason:'توکن از نظر ساختار، تاریخ و دسترسی سالم است.',expiresAt,scopes};
  }catch{return{ok:true,reason:'محتوای توکن قابل خواندن نبود؛ ساختار آن را بررسی کنید.'}}
}
/**
 * Asks Basalam about the very token that just failed, using the read-only
 * `users/me` endpoint. This is the only way to separate the two causes a local
 * inspection cannot tell apart:
 *   - `users/me` also 401 -> the token itself is dead/revoked/not a Basalam PAT;
 *   - `users/me` is 200   -> the token is valid but not allowed to write this
 *     vendor's products (missing `vendor.product.write`, or it belongs to a
 *     different account than the vendorId configured for this stall).
 * Any failure here is swallowed: this runs only to enrich an existing error.
 */
async function basalamTokenProbe(c:any,account:BasalamAccount):Promise<string>{
  try{
    const base=String(c.api||'https://openapi.basalam.com/v1').replace(/\/$/,'');
    const response=await safeBasalamFetch(`${base}/users/me`,{headers:{authorization:`Bearer ${account.token}`,accept:'application/json'}},2_000_000);
    if(response.status===401)
      return 'همین توکن روی users/me هم ۴۰۱ گرفت، یعنی خود توکن نامعتبر یا باطل شده است؛ از پنل توسعه‌دهندگان باسلام یک توکن تازه بسازید.';
    if(!response.ok)return `users/me کد ${response.status} برگرداند.`;
    const body=await response.json().catch(()=>({})) as any;
    const vendor=body?.vendor||body?.data?.vendor||{};
    const vendorId=String(vendor.id||body?.vendor_id||body?.data?.vendor_id||'');
    if(vendorId&&String(account.vendorId)&&vendorId!==String(account.vendorId))
      return `توکن معتبر است اما به غرفهٔ ${vendorId} تعلق دارد، نه غرفهٔ ${account.vendorId} که اینجا تنظیم شده؛ شناسهٔ غرفه را اصلاح کنید یا توکن همان غرفه را بگذارید.`;
    return 'توکن روی users/me معتبر است، پس مشکل نبودِ دسترسی «vendor.product.write» روی این توکن است؛ توکن را با این Scope دوباره بسازید.';
  }catch{return ''}
}
function basalamPhotoHint(status:number,body:any):string{
  if(status!==422)return '';
  const text=JSON.stringify(body||{});
  if(!/photo|تصویر/i.test(text))return '';
  return lastPhotoFailure
    ? `آپلود تصویر ناموفق بود، برای همین باسلام محصول را رد کرد. علت: ${lastPhotoFailure} — `
    : 'این محصول هیچ تصویری ندارد و باسلام بدون تصویر محصول را نمی‌پذیرد؛ برای محصولات بدون عکس، تصویر مبدأ را بررسی کنید. — ';
}
function basalamAuthHint(status:number,token=''):string{
  if(status===401){
    // Say WHY, using what can be determined from the token itself.
    const verdict=describeBasalamToken(token);
    return `${verdict.reason} — `;
  }
  if(status===403)return 'توکن دسترسی (Scope) لازم برای این عملیات را ندارد. — ';
  return '';
}
function basalamPayload(product:Product,c:any,account:BasalamAccount,categoryId:number|undefined,photoIds:number[]=[],creating=false):BasalamPayload{
  const payload:BasalamPayload={
    name:product.title,
    primary_price:basalamPrice(product,account.pricePercent||0),
    stock:product.stock??c.stock,
    description:(product.longDesc||product.shortDesc||'')+(product.variations?.length?`\n\nتنوع‌ها: ${product.variations.join('، ')}`:''),
    // Create as a draft, exactly like scraper4.php; the PATCH below publishes it.
    status:BASALAM_STATUS_PUBLISHED,
    category_id:categoryId,
    weight:product.weight||c.weight,
    package_weight:c.packageWeight,
    preparation_days:c.preparationDays,
  };
  if(product.sku)payload.sku=String(product.sku).slice(0,100);
  // Only send photo ids we actually obtained; an empty/failed upload must not
  // put a string (or a 0) into an integer field.
  // The reference implementation never sends photo ids on create — only on update.
  const ids=photoIds.filter(id=>Number.isFinite(id)&&id>0);
  if(ids.length){payload.photo=ids[0];payload.photos=ids.slice(0,10)}
  // scraper4.php publishes (2976) only when a photo uploaded AND both texts are
  // real; otherwise it creates a draft (3790) so the product still lands rather
  // than being rejected. Basalam requires `photo` for a published product:
  // 422 {"fields":["photo"],"message":"شناسه تصویر الزامی است"}.
  const briefText=String(product.shortDesc||product.title||'').trim();
  const descText=String(product.longDesc||product.shortDesc||'').trim();
  payload.status=(ids.length&&briefText.length>=3&&descText.length>=3)?BASALAM_STATUS_PUBLISHED:BASALAM_STATUS_DRAFT;
  return payload;
}

/**
 * Uploads product images to Basalam and returns their integer file ids.
 * Failures are non-fatal: the product is still published, just without photos,
 * which is far better than losing the whole send to an HTTP 400.
 */
/** Last photo-upload failure, surfaced in the 422 that Basalam raises when `photo` is missing. */
let lastPhotoFailure='';
const shortUrl=(u:unknown)=>String(u).split('/').pop()?.split('?')[0]?.slice(0,40)||String(u).slice(0,40);
async function uploadBasalamPhotos(product:Product,c:any,account:BasalamAccount,limit=3):Promise<number[]> {
  const urls=[product.image,...(product.images||[])].filter(Boolean).filter((url,index,all)=>all.indexOf(url)===index).slice(0,limit);
  const base=String(c.api||'https://openapi.basalam.com/v1').replace(/\/$/,'');
  const ids:number[]=[];
  const failures:string[]=[];
  for(const url of urls){
    try{
      const image=await safeFetch(String(url),{headers:{accept:'image/*'}},12_000_000);
      if(!image.ok)continue;
      const blob=await image.blob();
      if(!blob.size)continue;
      const form=new FormData();
      form.append('file',blob,(String(url).split('/').pop()||'photo.jpg').split('?')[0]);
      form.append('file_type','product.photo');
      const uploaded=await safeBasalamFetch(`${base}/files`,{method:'POST',headers:{authorization:`Bearer ${account.token}`,accept:'application/json'},body:form},3_000_000);
      const body=await uploaded.json().catch(()=>({})) as any;
      const id=Number(body?.id);
      if(uploaded.ok&&Number.isFinite(id)&&id>0){ids.push(id);continue}
      failures.push(`${shortUrl(url)}: HTTP ${uploaded.status} ${String(body?.message||body?.error||'').slice(0,80)}`);
    }catch(error){failures.push(`${shortUrl(url)}: ${error instanceof Error?error.message.slice(0,80):String(error)}`)}
  }
  if(!ids.length&&failures.length)lastPhotoFailure=failures.join(' | ');
  else lastPhotoFailure='';
  return ids;
}

async function tryImportBasalamSdk():Promise<any>{
  const importer=new Function('specifier','return import(specifier)') as (specifier:string)=>Promise<any>;
  const candidates=['@basalam/sdk','@basalam/node-sdk','basalam-sdk','basalam'];
  const errors:string[]=[];
  for(const name of candidates)try{return{module:await importer(name),name}}catch(error){errors.push(`${name}: ${error instanceof Error?error.message:String(error)}`)}
  return{module:null,name:'',error:errors.join(' | ')};
}

async function callMaybe(fn:any,...args:any[]):Promise<any>{return typeof fn==='function'?fn(...args):undefined}
async function sendBasalamWithSdk(product:Product,profile:Profile,c:any,account:BasalamAccount,existing:number|string|null,categoryId:number|undefined,photoIds:number[]=[]):Promise<{id:number|string;body:any;packageName:string}>{
  const loaded=await tryImportBasalamSdk();
  if(!loaded.module)throw new Error(`Basalam SDK package is not installed/available in this runtime (${loaded.error||'no candidates'}).`);
  const mod=loaded.module,Exported=mod.BasalamClient||mod.Basalam||mod.Client||mod.default,create=mod.createClient||mod.createBasalamClient;
  const options={accessToken:account.token,token:account.token,bearerToken:account.token,vendorId:account.vendorId,baseUrl:c.api,apiBase:c.api};
  const client=typeof create==='function'?await create(options):typeof Exported==='function'?new Exported(options):Exported;
  if(!client)throw new Error(`Basalam SDK ${loaded.name} did not expose a usable client.`);
  const payload=basalamPayload(product,c,account,categoryId,photoIds);
  const productApi=client.products||client.product||client.core?.products||client.core||client;
  const methods=existing?
    [['updateProduct',existing,payload],['update',existing,payload],['patch',existing,payload],['products.update',existing,payload]]:
    [['createProduct',payload],['create',payload],['store',payload],['products.create',payload]];
  let last='';
  for(const [method,...args] of methods){
    try{
      const target=String(method).split('.').reduce((obj:any,key:string)=>obj?.[key],productApi);
      const body=await callMaybe(target?.bind?.(productApi),...args);
      if(body!==undefined)return{id:toRemoteId(body?.id||body?.product?.id||existing) ?? 0,body,packageName:loaded.name};
    }catch(error){last=error instanceof Error?error.message:String(error)}
  }
  throw new Error(last||`Basalam SDK ${loaded.name} has no supported product create/update method.`);
}

async function sendBasalamWithApi(product:Product,profile:Profile,c:any,account:BasalamAccount,existing:number|string|null,categories:Array<number|undefined>,photoIds:number[]=[]):Promise<{id:number|string;body:any;categoryId:number|undefined}> {
  const base=`${c.api}/vendors/${encodeURIComponent(account.vendorId)}/products`;
  let response:Response|undefined,body:any={},usedCategory: number|undefined;
  for(const categoryId of categories){
    usedCategory=categoryId;
    const payload=basalamPayload(product,c,account,categoryId,photoIds,!existing);
    response=await safeBasalamFetch(existing?`${base}/${existing}`:base,{method:existing?'PATCH':'POST',headers:{authorization:`Bearer ${account.token}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},3_000_000);
    body=await response.json().catch(()=>({}));
    if(response.ok)break;
  }
  if(!response?.ok)throw new Error(`Basalam ${account.name} API HTTP ${response?.status||0}: ${basalamAuthHint(response?.status||0,account.token)}${basalamPhotoHint(response?.status||0,body)}${response?.status===401?(await basalamTokenProbe(c,account))+' ':''}${body.message||JSON.stringify(body).slice(0,300)}`);
  const newId=toRemoteId(body.id||body.product?.id||existing) ?? 0;
  return{id:newId,body,categoryId:usedCategory};
}

export async function syncBasalam(product:Product,profile:Profile):Promise<BasalamSyncResult[]>{
  const c=(await loadConnections()).basalam;
  if(!c.token||!c.vendorId)throw new Error('تنظیمات باسلام کامل نیست');
  const learned=c.autoCategory?await findLearnedCategory(product.title):null;
  const categories=[product.basalamCategoryId,profile.basalamCategoryId,learned?.categoryId,c.categoryId,...(profile.basalamFallbackCategoryIds||[]),...c.fallbackCategoryIds].map(Number).filter((id,index,all)=>id>0&&all.indexOf(id)===index);
  const categoryAttempts=(categories.length?categories:[undefined]) as Array<number|undefined>;
  const accounts=[{name:'پیش‌فرض',token:c.token,vendorId:c.vendorId,pricePercent:Number(c.pricePercent)||0},...c.shops.filter(s=>s.token&&s.vendorId)],results:BasalamSyncResult[]=[];
  for(const account of accounts){
    const accountKey=String(account.vendorId),legacy=account===accounts[0]?await getRemoteId(profile.id,product.sourceKey,'basalam'):null;
    const existing=await getDestinationId(profile.id,product.sourceKey,'basalam',accountKey)||legacy;
    const action=existing?'updated':'created';
    const price=basalamPrice(product,Number(account.pricePercent)||0);
    let remoteId:number|string=0,transport:BasalamSyncResult['transport']='sdk',fallback='';
    try{
      // Photos are uploaded once per stall and reused by both transports, because
      // Basalam wants integer file ids in `photo`/`photos`, not image URLs.
      const photoIds=await uploadBasalamPhotos(product,c,account);
      // SDK first, REST API as the fallback.
      try{
        const sdk=await sendBasalamWithSdk(product,profile,c,account,existing,categoryAttempts[0],photoIds);
        remoteId=toRemoteId(sdk.id||existing) ?? 0;transport='sdk';
      }catch(error){
        fallback=error instanceof Error?error.message:String(error);
        const api=await sendBasalamWithApi(product,profile,c,account,existing,categoryAttempts,photoIds);
        remoteId=toRemoteId(api.id||existing) ?? 0;transport='api';
      }
    }catch(error){
      // This stall failed on BOTH transports. Record it and keep going so the
      // remaining stalls still receive the product.
      results.push({shop:account.name,action,id:0,transport:'api',price,error:error instanceof Error?error.message:String(error),fallback:fallback||undefined});
      continue;
    }
    if(remoteId){await setDestinationId(profile.id,product.sourceKey,'basalam',accountKey,remoteId);if(account===accounts[0])await setRemoteId(profile.id,product.sourceKey,'basalam',remoteId)}
    results.push({shop:account.name,action,id:remoteId,transport,price,fallback:transport==='api'?fallback:undefined});
  }
  return results;
}
