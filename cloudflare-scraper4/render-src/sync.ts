import { loadConnections } from './connections.js';
import { findLearnedCategory, getDestinationId, getRemoteId, setDestinationId, setRemoteId } from './db.js';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { safeBasalamFetch, safeFetch } from './network.js';
import type { Product, Profile } from './types.js';

export async function syncWoo(product: Product, profile: Profile): Promise<'created'|'updated'> {
  const c = (await loadConnections()).woo; if (!c.url || !c.key || !c.secret) throw new Error('تنظیمات ووکامرس در منوی همبرگری کامل نیست');
  const base = c.url.replace(/\/$/, '') + '/wp-json/wc/v3/products';
  const auth = `Basic ${Buffer.from(`${c.key}:${c.secret}`).toString('base64')}`;
  let id = await getRemoteId(profile.id, product.sourceKey, 'woo');
  const sku = product.sku || `s4-${profile.id}-${product.sourceKey}`.slice(0, 100);
  if (!id) {
    const search = await safeFetch(`${base}?sku=${encodeURIComponent(sku)}`, { headers: { authorization: auth, accept: 'application/json' } }, 2_000_000);
    if (search.ok) { const rows = await search.json() as any[]; id = rows[0]?.id ? Number(rows[0].id) : null; }
  }
  // The configured WooCommerce adjustment percentage (0 = unchanged).
  const wooPercent = Number(c.pricePercent) || 0;
  const payload: any = { name: product.title, sku, type: 'simple', regular_price: String(Math.round(product.price * (1 + wooPercent / 100))), description: product.longDesc || '',
    short_description: product.shortDesc || '', images: product.images.map(src => ({ src })) };
  if (product.stock !== undefined) Object.assign(payload, { manage_stock: true, stock_quantity: product.stock });
  if (product.weight) payload.weight = String(product.weight);
  const wooCategory=profile.wooCategoryId||c.categoryId;if(wooCategory) payload.categories = [{ id: wooCategory }];
  const response = await safeFetch(id ? `${base}/${id}` : base, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) }, 3_000_000);
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(`WooCommerce HTTP ${response.status}: ${body.message || JSON.stringify(body).slice(0,300)}`);
  const remoteId = Number(body.id || id); if (remoteId) await setRemoteId(profile.id, product.sourceKey, 'woo', remoteId);
  return id ? 'updated' : 'created';
}

function basalamPrice(product:Product,percent=0):number{const base=Math.round(product.price*(1+percent/100));return /(?:ریال|rial|irr)/i.test(product.priceText||'')?base:base*10;}

type BasalamAccount={name:string;token:string;vendorId:string;pricePercent?:number};
type BasalamSyncResult={shop:string;action:'created'|'updated';id:number;transport:'sdk'|'api';fallback?:string;error?:string;price?:number};
/**
 * Basalam's product schema. `photo` must be the INTEGER id of a file uploaded to
 * /v1/files (not a URL), `status` is required (2976 = PUBLISHED) and the price
 * field is `primary_price`. Sending a URL string produced
 * "Input should be a valid integer" and omitting status produced "Field required".
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
  const payload:BasalamPayload={name:product.title,primary_price:basalamPrice(product,account.pricePercent||0),stock:product.stock??c.stock,description:product.longDesc||product.shortDesc||'',status:creating?BASALAM_STATUS_DRAFT:BASALAM_STATUS_PUBLISHED,category_id:categoryId,weight:product.weight||c.weight,package_weight:c.packageWeight,preparation_days:c.preparationDays};
  if(product.sku)payload.sku=String(product.sku).slice(0,100);
  const ids=creating?[]:photoIds.filter(id=>Number.isFinite(id)&&id>0);
  if(ids.length){payload.photo=ids[0];payload.photos=ids.slice(0,10)}
  return payload;
}
/** Uploads images to /v1/files and returns integer ids; failures are non-fatal. */
async function uploadBasalamPhotos(product:Product,c:any,account:BasalamAccount,limit=3):Promise<number[]>{
  const urls=[product.image,...(product.images||[])].filter(Boolean).filter((url,index,all)=>all.indexOf(url)===index).slice(0,limit);
  const base=String(c.api||'https://openapi.basalam.com/v1').replace(/\/$/,'');
  const ids:number[]=[];
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
      if(uploaded.ok&&Number.isFinite(id)&&id>0)ids.push(id);
    }catch{/* one bad image must not abort the product */}
  }
  return ids;
}
async function tryImportBasalamSdk():Promise<any>{const importer=new Function('specifier','return import(specifier)') as (specifier:string)=>Promise<any>;const candidates=['@basalam/sdk','@basalam/node-sdk','basalam-sdk','basalam'];const errors:string[]=[];for(const name of candidates)try{return{module:await importer(name),name}}catch(error){errors.push(`${name}: ${error instanceof Error?error.message:String(error)}`)}return{module:null,name:'',error:errors.join(' | ')}}
// Basalam ships an official SDK for Python only (`pip install basalam-sdk`);
// no npm package exists. We therefore run the real SDK through a short-lived
// python3 bridge process and fall back to REST when Python or the SDK is absent.
export function basalamSdkBridgePath():string{
  return fileURLToPath(new URL('../scripts/basalam-sdk-bridge.py',import.meta.url));
}
export async function runBasalamSdkBridge(request:any,timeoutMs=Number(process.env.BASALAM_SDK_TIMEOUT_MS)||45000):Promise<any>{
  const python=process.env.BASALAM_PYTHON||process.env.PYTHON||'python3';
  const script=basalamSdkBridgePath();
  if(!existsSync(script))throw new Error(`Basalam SDK bridge script is missing at ${script}`);
  return await new Promise((resolve,reject)=>{
    let child:ReturnType<typeof spawn>;
    try{child=spawn(python,[script],{stdio:['pipe','pipe','pipe']})}
    catch(error){reject(new Error(`cannot start ${python}: ${error instanceof Error?error.message:String(error)}`));return}
    let out='',err='',settled=false;
    const finish=(fn:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);fn()};
    const timer=setTimeout(()=>finish(()=>{try{child.kill('SIGKILL')}catch{}reject(new Error(`Basalam SDK bridge timed out after ${timeoutMs}ms`))}),timeoutMs);
    child.stdout?.on('data',chunk=>{out+=String(chunk)});
    child.stderr?.on('data',chunk=>{err+=String(chunk)});
    child.on('error',error=>finish(()=>reject(new Error(`cannot run ${python}: ${error instanceof Error?error.message:String(error)}`))));
    child.on('close',()=>finish(()=>{
      const text=out.trim();
      if(!text){reject(new Error(err.trim()||'Basalam SDK bridge returned no output'));return}
      try{resolve(JSON.parse(text))}catch{reject(new Error(`Basalam SDK bridge returned invalid JSON: ${text.slice(0,300)}`))}
    }));
    try{child.stdin?.end(JSON.stringify(request))}catch(error){finish(()=>reject(error instanceof Error?error:new Error(String(error))))}
  });
}
async function callMaybe(fn:any,...args:any[]):Promise<any>{return typeof fn==='function'?fn(...args):undefined}
async function sendBasalamWithSdk(product:Product,c:any,account:BasalamAccount,existing:number|null,categoryId:number|undefined,photoIds:number[]=[]):Promise<{id:number;body:any;packageName:string}>{
  const payloadForSdk=basalamPayload(product,c,account,categoryId,photoIds);
  try{
    const answer=await runBasalamSdkBridge({action:existing?'update':'create',token:account.token,refreshToken:c.refreshToken||'',vendorId:account.vendorId,productId:existing||0,payload:payloadForSdk});
    if(answer?.ok)return{id:Number(answer.id||existing||0),body:answer,packageName:`basalam-sdk (python${answer.sdkVersion?' '+answer.sdkVersion:''})`};
    throw new Error(String(answer?.error||'Basalam Python SDK bridge failed'));
  }catch(bridgeError){
    const bridgeText=bridgeError instanceof Error?bridgeError.message:String(bridgeError);
    const loaded=await tryImportBasalamSdk();
    if(!loaded.module)throw new Error(`Basalam SDK unavailable — python bridge: ${bridgeText}`);
    return await sendBasalamWithNpmSdk(loaded,product,c,account,existing,categoryId,photoIds);
  }
}
async function sendBasalamWithNpmSdk(loaded:any,product:Product,c:any,account:BasalamAccount,existing:number|null,categoryId:number|undefined,photoIds:number[]=[]):Promise<{id:number;body:any;packageName:string}>{const mod=loaded.module,Exported=mod.BasalamClient||mod.Basalam||mod.Client||mod.default,create=mod.createClient||mod.createBasalamClient,options={accessToken:account.token,token:account.token,bearerToken:account.token,vendorId:account.vendorId,baseUrl:c.api,apiBase:c.api};const client=typeof create==='function'?await create(options):typeof Exported==='function'?new Exported(options):Exported;if(!client)throw new Error(`Basalam SDK ${loaded.name} did not expose a usable client.`);const payload=basalamPayload(product,c,account,categoryId,photoIds),productApi=client.products||client.product||client.core?.products||client.core||client,methods=existing?[['updateProduct',existing,payload],['update',existing,payload],['patch',existing,payload],['products.update',existing,payload]]:[['createProduct',payload],['create',payload],['store',payload],['products.create',payload]];let last='';for(const[method,...args]of methods)try{const target=String(method).split('.').reduce((obj:any,key:string)=>obj?.[key],productApi);const body=await callMaybe(target?.bind?.(productApi),...args);if(body!==undefined)return{id:Number(body?.id||body?.product?.id||existing),body,packageName:loaded.name}}catch(error){last=error instanceof Error?error.message:String(error)}throw new Error(last||`Basalam SDK ${loaded.name} has no supported product create/update method.`)}
async function sendBasalamWithApi(product:Product,c:any,account:BasalamAccount,existing:number|null,categories:Array<number|undefined>,photoIds:number[]=[]):Promise<{id:number;body:any}>{const base=`${c.api}/vendors/${encodeURIComponent(account.vendorId)}/products`;let response:Response|undefined,body:any={};for(const categoryId of categories){const payload=basalamPayload(product,c,account,categoryId,photoIds,!existing);response=await safeBasalamFetch(existing?`${base}/${existing}`:base,{method:existing?'PATCH':'POST',headers:{authorization:`Bearer ${account.token}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},3_000_000);body=await response.json().catch(()=>({}));if(response.ok)break}if(!response?.ok)throw Error(`Basalam ${account.name} API HTTP ${response?.status||0}: ${basalamAuthHint(response?.status||0,account.token)}${response?.status===401?(await basalamTokenProbe(c,account))+' ':''}${body.message||JSON.stringify(body).slice(0,300)}`);const newId=Number(body.id||body.product?.id||existing);
  // scraper4.php parity: publish the freshly created draft and attach the photo
  // ids in a second PATCH. A failure here must not lose the created product.
  if(!existing&&newId>0){
    const finish:Record<string,any>={status:BASALAM_STATUS_PUBLISHED};
    const ids=photoIds.filter(id=>Number.isFinite(id)&&id>0);
    if(ids.length){finish.photo=ids[0];finish.photos=ids.slice(0,10)}
    try{await safeBasalamFetch(`${base}/${newId}`,{method:'PATCH',headers:{authorization:`Bearer ${account.token}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(finish)},3_000_000)}catch{}
  }
  return{id:newId,body}}

export async function syncBasalam(product: Product, profile: Profile): Promise<BasalamSyncResult[]> {
  const c=(await loadConnections()).basalam;if(!c.token||!c.vendorId)throw Error('تنظیمات باسلام در منوی همبرگری کامل نیست');
  const learned=c.autoCategory?await findLearnedCategory(product.title):null,categoryId=profile.basalamCategoryId||learned?.categoryId||c.categoryId||undefined;
  const categories=([categoryId,...((profile as any).basalamFallbackCategoryIds||[]),...((c as any).fallbackCategoryIds||[])].map(Number).filter((id,index,all)=>id>0&&all.indexOf(id)===index));
  const categoryAttempts=(categories.length?categories:[undefined]) as Array<number|undefined>;
  const accounts=[{name:'پیش‌فرض',token:c.token,vendorId:c.vendorId,pricePercent:Number(c.pricePercent)||0},...c.shops.filter(s=>s.token&&s.vendorId)];const results:BasalamSyncResult[]=[];
  for(const account of accounts){
    const accountKey=String(account.vendorId),legacy=account===accounts[0]?await getRemoteId(profile.id,product.sourceKey,'basalam'):null;
    const existing=await getDestinationId(profile.id,product.sourceKey,'basalam',accountKey)||legacy;
    const action=existing?'updated':'created';
    const price=basalamPrice(product,Number(account.pricePercent)||0);
    let remoteId=0,transport:BasalamSyncResult['transport']='sdk',fallback='';
    try{
      // Photos are uploaded once per stall and reused by both transports.
      const photoIds=await uploadBasalamPhotos(product,c,account);
      // SDK first, REST API as the fallback.
      try{const sdk=await sendBasalamWithSdk(product,c,account,existing,categoryAttempts[0],photoIds);remoteId=Number(sdk.id||existing);transport='sdk'}
      catch(error){fallback=error instanceof Error?error.message:String(error);const api=await sendBasalamWithApi(product,c,account,existing,categoryAttempts,photoIds);remoteId=Number(api.id||existing);transport='api'}
    }catch(error){
      // Both transports failed for THIS stall; keep publishing to the others.
      results.push({shop:account.name,action,id:0,transport:'api',price,error:error instanceof Error?error.message:String(error),fallback:fallback||undefined});
      continue;
    }
    if(remoteId){await setDestinationId(profile.id,product.sourceKey,'basalam',accountKey,remoteId);if(account===accounts[0])await setRemoteId(profile.id,product.sourceKey,'basalam',remoteId)}
    results.push({shop:account.name,action,id:remoteId,transport,price,fallback:transport==='api'?fallback:undefined});
  }
  return results;
}
