import { loadConnections } from './connections.js';
import { findLearnedCategory, getDestinationId, getRemoteId, getState, setDestinationId, setRemoteId } from './db.js';
import { safeFetch, safeWooFetch } from './network.js';
import { basicAuth } from './utils.js';
import type { Product, Profile, VariationGroup } from './types.js';

export async function syncWoo(product:Product,profile:Profile):Promise<'created'|'updated'> {
  const c=(await loadConnections()).woo;
  if(!c.url||!c.key||!c.secret)throw new Error('تنظیمات ووکامرس کامل نیست');
  const base=c.url.replace(/\/$/,'')+'/wp-json/wc/v3/products',auth=basicAuth(c.key,c.secret);
  let id=await getRemoteId(profile.id,product.sourceKey,'woo');
  const sku=product.sku||`s4-${profile.id}-${product.sourceKey}`.slice(0,100);
  if(!id){
    const search=await safeWooFetch(`${base}?sku=${encodeURIComponent(sku)}`,{headers:{authorization:auth,accept:'application/json'}},2_000_000);
    if(search.ok){const found=await search.json() as any[];id=found[0]?.id?Number(found[0].id):null}
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
  const remoteId=Number(body.id||id);
  if(remoteId){
    await setRemoteId(profile.id,product.sourceKey,'woo',remoteId);
    await setDestinationId(profile.id,product.sourceKey,'woo','default',remoteId);
    if(groups.length)await syncWooVariations(base,remoteId,sku,groups,product,auth,wooPercent);
  }
  return id?'updated':'created';
}

async function syncWooVariations(base:string,parentId:number,parentSku:string,groups:VariationGroup[],product:Product,auth:string,pricePercent=0):Promise<void>{
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
type BasalamSyncResult={shop:string;action:'created'|'updated';id:number;transport:'sdk'|'api';fallback?:string;error?:string;price?:number};
type BasalamPayload={name:string;price:number;stock:any;description:string;photo?:string;category_id?:number;weight:any;package_weight:any;preparation_days:any};

function basalamPayload(product:Product,c:any,account:BasalamAccount,categoryId:number|undefined):BasalamPayload{
  return {name:product.title,price:basalamPrice(product,account.pricePercent||0),stock:product.stock??c.stock,description:(product.longDesc||product.shortDesc||'')+(product.variations?.length?`\n\nتنوع‌ها: ${product.variations.join('، ')}`:''),photo:product.image||undefined,category_id:categoryId,weight:product.weight||c.weight,package_weight:c.packageWeight,preparation_days:c.preparationDays};
}

async function tryImportBasalamSdk():Promise<any>{
  const importer=new Function('specifier','return import(specifier)') as (specifier:string)=>Promise<any>;
  const candidates=['@basalam/sdk','@basalam/node-sdk','basalam-sdk','basalam'];
  const errors:string[]=[];
  for(const name of candidates)try{return{module:await importer(name),name}}catch(error){errors.push(`${name}: ${error instanceof Error?error.message:String(error)}`)}
  return{module:null,name:'',error:errors.join(' | ')};
}

async function callMaybe(fn:any,...args:any[]):Promise<any>{return typeof fn==='function'?fn(...args):undefined}
async function sendBasalamWithSdk(product:Product,profile:Profile,c:any,account:BasalamAccount,existing:number|null,categoryId:number|undefined):Promise<{id:number;body:any;packageName:string}>{
  const loaded=await tryImportBasalamSdk();
  if(!loaded.module)throw new Error(`Basalam SDK package is not installed/available in this runtime (${loaded.error||'no candidates'}).`);
  const mod=loaded.module,Exported=mod.BasalamClient||mod.Basalam||mod.Client||mod.default,create=mod.createClient||mod.createBasalamClient;
  const options={accessToken:account.token,token:account.token,bearerToken:account.token,vendorId:account.vendorId,baseUrl:c.api,apiBase:c.api};
  const client=typeof create==='function'?await create(options):typeof Exported==='function'?new Exported(options):Exported;
  if(!client)throw new Error(`Basalam SDK ${loaded.name} did not expose a usable client.`);
  const payload=basalamPayload(product,c,account,categoryId);
  const productApi=client.products||client.product||client.core?.products||client.core||client;
  const methods=existing?
    [['updateProduct',existing,payload],['update',existing,payload],['patch',existing,payload],['products.update',existing,payload]]:
    [['createProduct',payload],['create',payload],['store',payload],['products.create',payload]];
  let last='';
  for(const [method,...args] of methods){
    try{
      const target=String(method).split('.').reduce((obj:any,key:string)=>obj?.[key],productApi);
      const body=await callMaybe(target?.bind?.(productApi),...args);
      if(body!==undefined)return{id:Number(body?.id||body?.product?.id||existing),body,packageName:loaded.name};
    }catch(error){last=error instanceof Error?error.message:String(error)}
  }
  throw new Error(last||`Basalam SDK ${loaded.name} has no supported product create/update method.`);
}

async function sendBasalamWithApi(product:Product,profile:Profile,c:any,account:BasalamAccount,existing:number|null,categories:Array<number|undefined>):Promise<{id:number;body:any;categoryId:number|undefined}> {
  const base=`${c.api}/vendors/${encodeURIComponent(account.vendorId)}/products`;
  let response:Response|undefined,body:any={},usedCategory: number|undefined;
  for(const categoryId of categories){
    usedCategory=categoryId;
    const payload=basalamPayload(product,c,account,categoryId);
    response=await safeFetch(existing?`${base}/${existing}`:base,{method:existing?'PATCH':'POST',headers:{authorization:`Bearer ${account.token}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},3_000_000);
    body=await response.json().catch(()=>({}));
    if(response.ok)break;
  }
  if(!response?.ok)throw new Error(`Basalam ${account.name} API HTTP ${response?.status||0}: ${body.message||JSON.stringify(body).slice(0,300)}`);
  return{id:Number(body.id||body.product?.id||existing),body,categoryId:usedCategory};
}

export async function syncBasalam(product:Product,profile:Profile):Promise<BasalamSyncResult[]>{
  const c=(await loadConnections()).basalam;
  if(!c.token||!c.vendorId)throw new Error('تنظیمات باسلام کامل نیست');
  const learned=c.autoCategory?await findLearnedCategory(product.title):null;
  const categories=[profile.basalamCategoryId,learned?.categoryId,c.categoryId,...(profile.basalamFallbackCategoryIds||[]),...c.fallbackCategoryIds].map(Number).filter((id,index,all)=>id>0&&all.indexOf(id)===index);
  const categoryAttempts=(categories.length?categories:[undefined]) as Array<number|undefined>;
  const accounts=[{name:'پیش‌فرض',token:c.token,vendorId:c.vendorId,pricePercent:Number(c.pricePercent)||0},...c.shops.filter(s=>s.token&&s.vendorId)],results:BasalamSyncResult[]=[];
  for(const account of accounts){
    const accountKey=String(account.vendorId),legacy=account===accounts[0]?await getRemoteId(profile.id,product.sourceKey,'basalam'):null;
    const existing=await getDestinationId(profile.id,product.sourceKey,'basalam',accountKey)||legacy;
    const action=existing?'updated':'created';
    const price=basalamPrice(product,Number(account.pricePercent)||0);
    let remoteId=0,transport:BasalamSyncResult['transport']='sdk',fallback='';
    try{
      // SDK first, REST API as the fallback.
      try{
        const sdk=await sendBasalamWithSdk(product,profile,c,account,existing,categoryAttempts[0]);
        remoteId=Number(sdk.id||existing);transport='sdk';
      }catch(error){
        fallback=error instanceof Error?error.message:String(error);
        const api=await sendBasalamWithApi(product,profile,c,account,existing,categoryAttempts);
        remoteId=Number(api.id||existing);transport='api';
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
