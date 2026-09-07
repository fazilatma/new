import { loadConnections } from './connections.js';
import { findLearnedCategory, getDestinationId, getRemoteId, setDestinationId, setRemoteId } from './db.js';
import { safeFetch } from './network.js';
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
  const payload: any = { name: product.title, sku, type: 'simple', regular_price: String(product.price), description: product.longDesc || '',
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
type BasalamSyncResult={shop:string;action:'created'|'updated';id:number;transport:'sdk'|'api';fallback?:string};
type BasalamPayload={name:string;price:number;stock:any;description:string;photo?:string;category_id?:number;weight:any;package_weight:any;preparation_days:any};
function basalamPayload(product:Product,c:any,account:BasalamAccount,categoryId:number|undefined):BasalamPayload{return{name:product.title,price:basalamPrice(product,account.pricePercent||0),stock:product.stock??c.stock,description:product.longDesc||product.shortDesc||'',photo:product.image||undefined,category_id:categoryId,weight:product.weight||c.weight,package_weight:c.packageWeight,preparation_days:c.preparationDays}}
async function tryImportBasalamSdk():Promise<any>{const importer=new Function('specifier','return import(specifier)') as (specifier:string)=>Promise<any>;const candidates=['@basalam/sdk','@basalam/node-sdk','basalam-sdk','basalam'];const errors:string[]=[];for(const name of candidates)try{return{module:await importer(name),name}}catch(error){errors.push(`${name}: ${error instanceof Error?error.message:String(error)}`)}return{module:null,name:'',error:errors.join(' | ')}}
async function callMaybe(fn:any,...args:any[]):Promise<any>{return typeof fn==='function'?fn(...args):undefined}
async function sendBasalamWithSdk(product:Product,c:any,account:BasalamAccount,existing:number|null,categoryId:number|undefined):Promise<{id:number;body:any;packageName:string}>{const loaded=await tryImportBasalamSdk();if(!loaded.module)throw new Error(`Basalam SDK package is not installed/available in this runtime (${loaded.error||'no candidates'}).`);const mod=loaded.module,Exported=mod.BasalamClient||mod.Basalam||mod.Client||mod.default,create=mod.createClient||mod.createBasalamClient,options={accessToken:account.token,token:account.token,bearerToken:account.token,vendorId:account.vendorId,baseUrl:c.api,apiBase:c.api};const client=typeof create==='function'?await create(options):typeof Exported==='function'?new Exported(options):Exported;if(!client)throw new Error(`Basalam SDK ${loaded.name} did not expose a usable client.`);const payload=basalamPayload(product,c,account,categoryId),productApi=client.products||client.product||client.core?.products||client.core||client,methods=existing?[['updateProduct',existing,payload],['update',existing,payload],['patch',existing,payload],['products.update',existing,payload]]:[['createProduct',payload],['create',payload],['store',payload],['products.create',payload]];let last='';for(const[method,...args]of methods)try{const target=String(method).split('.').reduce((obj:any,key:string)=>obj?.[key],productApi);const body=await callMaybe(target?.bind?.(productApi),...args);if(body!==undefined)return{id:Number(body?.id||body?.product?.id||existing),body,packageName:loaded.name}}catch(error){last=error instanceof Error?error.message:String(error)}throw new Error(last||`Basalam SDK ${loaded.name} has no supported product create/update method.`)}
async function sendBasalamWithApi(product:Product,c:any,account:BasalamAccount,existing:number|null,categories:Array<number|undefined>):Promise<{id:number;body:any}>{const base=`${c.api}/vendors/${encodeURIComponent(account.vendorId)}/products`;let response:Response|undefined,body:any={};for(const categoryId of categories){const payload=basalamPayload(product,c,account,categoryId);response=await safeFetch(existing?`${base}/${existing}`:base,{method:existing?'PATCH':'POST',headers:{authorization:`Bearer ${account.token}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},3_000_000);body=await response.json().catch(()=>({}));if(response.ok)break}if(!response?.ok)throw Error(`Basalam ${account.name} API HTTP ${response?.status||0}: ${body.message||JSON.stringify(body).slice(0,300)}`);return{id:Number(body.id||body.product?.id||existing),body}}

export async function syncBasalam(product: Product, profile: Profile): Promise<BasalamSyncResult[]> {
  const c=(await loadConnections()).basalam;if(!c.token||!c.vendorId)throw Error('تنظیمات باسلام در منوی همبرگری کامل نیست');
  const learned=c.autoCategory?await findLearnedCategory(product.title):null,categoryId=profile.basalamCategoryId||learned?.categoryId||c.categoryId||undefined;
  const categories=([categoryId,...((profile as any).basalamFallbackCategoryIds||[]),...((c as any).fallbackCategoryIds||[])].map(Number).filter((id,index,all)=>id>0&&all.indexOf(id)===index));
  const categoryAttempts=(categories.length?categories:[undefined]) as Array<number|undefined>;
  const accounts=[{name:'پیش‌فرض',token:c.token,vendorId:c.vendorId,pricePercent:0},...c.shops.filter(s=>s.token&&s.vendorId)];const results:BasalamSyncResult[]=[];
  for(const account of accounts){const accountKey=String(account.vendorId),legacy=account===accounts[0]?await getRemoteId(profile.id,product.sourceKey,'basalam'):null;const existing=await getDestinationId(profile.id,product.sourceKey,'basalam',accountKey)||legacy;const action=existing?'updated':'created';let remoteId=0,transport:BasalamSyncResult['transport']='sdk',fallback='';try{const sdk=await sendBasalamWithSdk(product,c,account,existing,categoryAttempts[0]);remoteId=Number(sdk.id||existing);transport='sdk'}catch(error){fallback=error instanceof Error?error.message:String(error);const api=await sendBasalamWithApi(product,c,account,existing,categoryAttempts);remoteId=Number(api.id||existing);transport='api'}if(remoteId){await setDestinationId(profile.id,product.sourceKey,'basalam',accountKey,remoteId);if(account===accounts[0])await setRemoteId(profile.id,product.sourceKey,'basalam',remoteId)}results.push({shop:account.name,action,id:remoteId,transport,fallback:transport==='api'?fallback:undefined});}
  return results;
}
