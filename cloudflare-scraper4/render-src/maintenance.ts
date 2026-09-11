import { normalizePersianText } from '../worker-src/utils.js';
import { byAccount, byProfile, planActions, planDuplicateDeletions, reconcileAccount, unreachableAccountRows, summarize } from '../worker-src/recon-core.js';
import type { ReconAccount, ReconLocal, ReconRemote, UnifiedReconRow } from '../worker-src/recon-core.js';
import { loadConnections } from './connections.js';
import { getProduct, getProfile, getState, listProfiles, maintenanceRows, setDestinationId, setRemoteId, setState } from './db.js';
import { safeBasalamFetch, safeFetch } from './network.js';
import { hasCodeSuffix, parseSuffixFormats, suffixPatterns } from '../worker-src/dedup.js';
import { syncBasalam, syncWoo } from './sync.js';

const norm=(v:string)=>normalizePersianText(v).replace(/\s*[\[(](?:کد|code|sku)?\s*[:：]?\s*\d+[\])]]\s*$/i,'').trim();

type Remote={id:number;name:string;sku:string;images:any[];status:string;price:number;raw:any};
/* The comparison ALGORITHM is shared (worker-src/recon-core.ts, no database of
   its own); only the data access below is runtime-specific. Re-exporting the
   Worker's reconTable used to drag its D1 helpers into the Node runtime, so the
   button failed with "D1 binding DB is not configured" on Termux/VPS/Render. */
export { reconNormTitle } from '../worker-src/recon-core.js';

/** Every destination account: the WooCommerce site plus each Basalam stall. */
export async function reconAccounts(): Promise<ReconAccount[]> {
  const c = await loadConnections();
  const accounts: ReconAccount[] = [];
  if (c.woo?.url && c.woo?.key && c.woo?.secret) accounts.push({ target: 'woo', accountKey: 'default', name: 'ووکامرس', pricePercent: Number(c.woo.pricePercent) || 0 });
  if (c.basalam?.token && c.basalam?.vendorId) {
    accounts.push({ target: 'basalam', accountKey: String(c.basalam.vendorId), name: 'باسلام — غرفهٔ پیش‌فرض', pricePercent: Number(c.basalam.pricePercent) || 0, toRial: true });
    for (const shop of (c.basalam.shops || [])) {
      if (!shop.token || !shop.vendorId) continue;
      if (String(shop.vendorId) === String(c.basalam.vendorId)) continue;
      accounts.push({ target: 'basalam', accountKey: String(shop.vendorId), name: `باسلام — ${shop.name || shop.vendorId}`, pricePercent: Number(shop.pricePercent) || 0, toRial: true });
    }
  }
  return accounts;
}

async function remoteForAccount(account: ReconAccount): Promise<ReconRemote[]> {
  if (account.target === 'woo') return (await wooProducts()).map(x => ({ id: x.id, name: x.name, sku: x.sku, price: x.price, status: x.status }));
  const c = (await loadConnections()).basalam;
  const shop = String(account.accountKey) === String(c.vendorId)
    ? { token: c.token, vendorId: String(c.vendorId) }
    : (c.shops || []).find(s => String(s.vendorId) === String(account.accountKey));
  if (!shop?.token) throw Error(`توکن غرفهٔ ${account.name} در دسترس نیست`);
  const out: ReconRemote[] = [];
  for (let page = 1; page <= 100; page++) {
    const r = await safeBasalamFetch(`${c.api}/vendors/${encodeURIComponent(shop.vendorId)}/products?per_page=100&page=${page}`, { headers: { authorization: `Bearer ${shop.token}`, accept: 'application/json' } }, 10_000_000);
    const body = await r.json() as any;
    if (!r.ok) throw Error(`Basalam ${account.name} HTTP ${r.status}`);
    const data = body.data || body.products || body.results || body.items || [];
    for (const x of data) out.push({ id: Number(x.id), name: String(x.name || x.title || ''), sku: String(x.sku || ''), price: Number(x.price || 0), status: String(x.status || ''), shopId: String(shop.vendorId), shopName: account.name });
    if (data.length < 100) break;
  }
  return out;
}

/**
 * Unified reconciliation across profiles, the WooCommerce site and every
 * Basalam stall. One row per (product, destination), prices compared after each
 * destination's own adjustment.
 */
export async function unifiedRecon(profileId = '') {
  const local = await maintenanceRows(profileId) as ReconLocal[];
  const profileNames: Record<string, string> = {};
  for (const profile of await listProfiles()) profileNames[profile.id] = profile.name || profile.id;
  // Same rule as the Worker runtime: only products whose title carries a
  // «(کد ایکس)» suffix are reconciled.
  const settings = await getState<any>('settings', {});
  const suffixFormats = (settings as any)?.dedup?.suffixFormats || '';
  const patterns = suffixPatterns(parseSuffixFormats(suffixFormats));
  const eligible = local.filter(row => hasCodeSuffix(String(row.title || ''), patterns));
  const skippedNoCode = local.length - eligible.length;
  const accounts = await reconAccounts();
  const rows: UnifiedReconRow[] = [];
  const failures: Array<{ account: string; error: string }> = [];
  for (const account of accounts) {
    try { rows.push(...reconcileAccount(local, await remoteForAccount(account), account, profileNames, suffixFormats)); }
    // Keep the table intact when a destination fails (see worker-src/maintenance.ts).
    catch (error) { const message = msg(error); failures.push({ account: account.name, error: message });
      rows.push(...unreachableAccountRows(local, account, profileNames, suffixFormats, message)); }
  }
  const report = {
    ok: failures.length === 0, at: new Date().toISOString(), profileId,
    local: eligible.length, localAll: local.length, skippedNoCode, suffixFormats, accounts: accounts.length,
    ...summarize(rows), accountsBreakdown: byAccount(rows), profiles: byProfile(rows),
    actions: planActions(rows).length, failures, rows,
  };
  await setState('recon_unified', report);
  return report;
}

/**
 * Apply the differences the table found. Price mismatches are pushed to the
 * destination; products missing at a destination are re-published through the
 * normal sync path so category/photo/stock rules stay identical. Products that
 * exist only at the destination are reported but never auto-deleted.
 */
export async function unifiedReconApply(profileId = '', apply = false, limit = 200) {
  const report = await unifiedRecon(profileId);
  const actions = planActions(report.rows as UnifiedReconRow[]).slice(0, Math.max(1, Math.min(1000, limit)));
  if (!apply) return { ok: true, dryRun: true, planned: actions.length, actions: actions.slice(0, 200),
    matched: report.matched, priceDiff: report.priceDiff, missing: report.missing, extra: report.extra,
    noPrice: report.noPrice, inSync: report.inSync, local: report.local, localAll: report.localAll, skippedNoCode: report.skippedNoCode, accounts: report.accounts,
    accountsBreakdown: report.accountsBreakdown, profiles: report.profiles, failures: report.failures,
    rows: report.rows };
  let changed = 0; const failed: any[] = [];
  const products = new Map<string, any>();
  for (const action of actions) {
    try {
      if (action.kind === 'updatePrice' && action.remoteId && action.toPrice) {
        if (action.target === 'woo') await wooUpdate(action.remoteId, { regular_price: String(action.toPrice) });
        else await basalamUpdateShop(action.accountKey, action.remoteId, { price: action.toPrice });
        changed++;
      } else if (action.kind === 'create') {
        const key = `${action.profileId}\u0000${action.sourceKey}`;
        if (!products.has(key)) products.set(key, await getProduct(action.profileId, action.sourceKey));
        const product = products.get(key);
        const profile = await getProfile(action.profileId);
        if (!product || !profile) { failed.push({ title: action.title, error: 'محصول یا پروفایل پیدا نشد' }); continue; }
        if (action.target === 'woo') await syncWoo(product, profile); else await syncBasalam(product, profile);
        changed++;
      }
    } catch (error) { failed.push({ title: action.title, account: action.accountName, error: msg(error) }); }
  }
  const after = changed ? await unifiedRecon(profileId) : report;
  return { ok: failed.length === 0, dryRun: false, planned: actions.length, changed, failed: failed.slice(0, 20),
    matched: after.matched, priceDiff: after.priceDiff, missing: after.missing, extra: after.extra,
    noPrice: after.noPrice, inSync: after.inSync, local: after.local, localAll: after.localAll, skippedNoCode: after.skippedNoCode, accounts: after.accounts,
    accountsBreakdown: after.accountsBreakdown, profiles: after.profiles, failures: after.failures,
    rows: after.rows };
}

/**
 * Request 36b — duplicate cleanup across EVERY destination (Node runtime twin of
 * the Worker implementation). Groups destination listings by their «(کد ایکس)»-
 * stripped title and plans deletion of all but the most expensive copy.
 * Local scraped products are never touched.
 */
export async function destinationDuplicates(apply = false, limit = 200, keep: 'expensive' | 'cheapest' = 'expensive', accountKey = '') {
  const accounts = (await reconAccounts()).filter(a => !accountKey || String(a.accountKey) === String(accountKey));
  const settings = await getState<any>('settings', {});
  const suffixFormats = (settings as any)?.dedup?.suffixFormats || '';
  const actions: any[] = [], failures: any[] = [];
  for (const account of accounts) {
    try {
      const remotes = await remoteForAccount(account);
      actions.push(...planDuplicateDeletions(remotes, account, suffixFormats, keep));
    } catch (error) { failures.push({ account: account.name, error: error instanceof Error ? error.message : String(error) }); }
  }
  const byDestination = accounts.map(account => ({
    account: account.name, accountKey: account.accountKey, target: account.target,
    duplicates: actions.filter(a => String(a.accountKey) === String(account.accountKey) && a.target === account.target).length,
  }));
  const capped = actions.slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
  if (!apply) return { ok: failures.length === 0, dryRun: true, keep, planned: actions.length, willDelete: capped.length,
    accounts: accounts.length, byDestination, failures, actions: capped.slice(0, 200) };
  let deleted = 0, archived = 0; const failed: any[] = [];
  for (const action of capped) {
    try {
      const result = await destinationDelete(action.target, action.remoteId, true, action.target === 'basalam' ? action.accountKey : '');
      if ((result as any)?.archived) archived++; else deleted++;
    } catch (error) { failed.push({ title: action.title, account: action.accountName, id: action.remoteId, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { ok: failed.length === 0 && failures.length === 0, dryRun: false, keep, planned: actions.length, processed: capped.length,
    deleted, archived, accounts: accounts.length, byDestination, failures, failed: failed.slice(0, 20), actions: capped.slice(0, 200) };
}
async function basalamUpdateShop(accountKey: string, id: number, payload: any) {
  const c = (await loadConnections()).basalam;
  const shop = String(accountKey) === String(c.vendorId) ? { token: c.token, vendorId: String(c.vendorId) } : (c.shops || []).find(s => String(s.vendorId) === String(accountKey));
  if (!shop?.token) throw Error('توکن این غرفه در دسترس نیست');
  const r = await safeBasalamFetch(`${c.api}/vendors/${encodeURIComponent(shop.vendorId)}/products/${id}`, { method: 'PATCH', headers: { authorization: `Bearer ${shop.token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }, 3_000_000);
  if (!r.ok) throw Error(`Basalam update ${id}: HTTP ${r.status}`);
}

/** Single-destination table, kept for the existing per-target buttons. */
export async function reconTable(target: 'woo' | 'basalam', profileId = '') {
  const local = await maintenanceRows(profileId) as ReconLocal[];
  const profileNames: Record<string, string> = {};
  for (const profile of await listProfiles()) profileNames[profile.id] = profile.name || profile.id;
  const accounts = (await reconAccounts()).filter(a => a.target === target);
  if (!accounts.length) throw Error(target === 'woo' ? 'اتصال ووکامرس کامل نیست' : 'اتصال باسلام کامل نیست');
  const rows: UnifiedReconRow[] = [];
  for (const account of accounts) rows.push(...reconcileAccount(local, await remoteForAccount(account), account, profileNames));
  const report = { ok: true, target, at: new Date().toISOString(), profileId, local: local.length, remote: rows.filter(r => r.remoteId).length, ...summarize(rows), accountsBreakdown: byAccount(rows), rows };
  await setState(`recon_table_${target}`, report);
  return report;
}
export async function recon(target:'woo'|'basalam',profileId=''){const local=await maintenanceRows(profileId),remote=await remoteProducts(target),byId=new Map(remote.map(x=>[x.id,x])),bySku=new Map(remote.filter(x=>x.sku).map(x=>[x.sku,x])),byName=new Map(remote.map(x=>[norm(x.name),x])),used=new Set<number>(),items:any[]=[];for(const row of local){const mapped=target==='woo'?Number(row.remote_woo_id||0):Number(row.remote_basalam_id||0),sku=row.data?.sku||`s4-${row.profile_id}-${row.source_key}`.slice(0,100);const match=byId.get(mapped)||bySku.get(sku)||byName.get(norm(row.title));if(match)used.add(match.id);items.push({profileId:row.profile_id,sourceKey:row.source_key,title:row.title,active:row.active,remoteId:match?.id||null,matchedBy:match?(match.id===mapped?'id':match.sku===sku?'sku':'title'):'none',remoteTitle:match?.name||''})}const result={target,at:new Date().toISOString(),local:local.length,remote:remote.length,matched:items.filter(x=>x.remoteId).length,missingRemote:items.filter(x=>!x.remoteId&&x.active).length,retired:items.filter(x=>!x.active).length,extraRemote:remote.filter(x=>!used.has(x.id)).map(x=>({id:x.id,title:x.name,status:x.status})),items};await setState(`recon_${target}`,result);return result}
export async function rebuildMap(target:'woo'|'basalam',profileId=''){const report=await recon(target,profileId);let mapped=0;for(const item of report.items)if(item.remoteId){await setDestinationId(item.profileId,item.sourceKey,target,'default',item.remoteId);await setRemoteId(item.profileId,item.sourceKey,target,item.remoteId);mapped++}return{ok:true,target,mapped,unmatched:report.items.length-mapped}}
export async function retire(target:'woo'|'basalam',profileId:string,action:string,apply=false){const rows=(await maintenanceRows(profileId)).filter(x=>!x.active),preview=rows.map(x=>({profileId:x.profile_id,sourceKey:x.source_key,title:x.title,remoteId:target==='woo'?x.remote_woo_id:x.remote_basalam_id,missingSince:x.missing_since,action}));if(!apply||action==='report')return{ok:true,dryRun:true,count:preview.length,items:preview};let changed=0,failed:any[]=[];for(const item of preview){if(!item.remoteId)continue;try{if(target==='woo')await wooUpdate(item.remoteId,action==='trash'?{status:'trash'}:{status:action==='draft'?'draft':'private'});else await basalamUpdate(item.remoteId,{status:action==='trash'?'archived':action});changed++}catch(error){failed.push({title:item.title,error:msg(error)})}}return{ok:failed.length===0,dryRun:false,changed,failed}}
export async function bulkEdit(target:'woo'|'basalam',input:any,apply=false){const rows=(await maintenanceRows(String(input.profileId||''))).filter(x=>x.active).filter(x=>!input.query||norm(x.title).includes(norm(input.query))).slice(0,Math.min(1000,Number(input.limit)||200)),items=rows.map(row=>{let title=String(row.title);if(input.prefix)title=String(input.prefix)+title;if(input.suffix)title+=String(input.suffix);let price=Number(row.price);if(Number(input.pricePercent))price=Math.round(price*(1+Number(input.pricePercent)/100));return{row,title,price,remoteId:target==='woo'?row.remote_woo_id:row.remote_basalam_id}});if(!apply)return{ok:true,dryRun:true,count:items.length,items:items.slice(0,100).map(x=>({title:x.row.title,newTitle:x.title,oldPrice:x.row.price,newPrice:x.price,remoteId:x.remoteId}))};let changed=0,failed:any[]=[];for(const item of items){if(!item.remoteId)continue;try{const payload:any={name:item.title};if(item.price)target==='woo'?payload.regular_price=String(item.price):payload.price=item.price;if(input.stock!==''&&input.stock!=null)target==='woo'?Object.assign(payload,{manage_stock:true,stock_quantity:Number(input.stock)}):payload.stock=Number(input.stock);if(target==='woo')await wooUpdate(item.remoteId,payload);else await basalamUpdate(item.remoteId,payload);changed++}catch(error){failed.push({title:item.row.title,error:msg(error)})}}return{ok:failed.length===0,dryRun:false,changed,failed}}
export async function photoFix(profileId:string,apply=false){const rows=(await maintenanceRows(profileId)).filter(x=>x.active&&x.remote_woo_id&&x.data?.image),remote=await remoteProducts('woo'),byId=new Map(remote.map(x=>[x.id,x])),items=rows.filter(x=>!(byId.get(Number(x.remote_woo_id))?.images||[]).length).map(x=>({id:Number(x.remote_woo_id),title:x.title,image:x.data.image}));if(!apply)return{ok:true,dryRun:true,count:items.length,items:items.slice(0,200)};let changed=0,failed:any[]=[];for(const item of items)try{await wooUpdate(item.id,{images:[{src:item.image}]});changed++}catch(error){failed.push({title:item.title,error:msg(error)})}return{ok:failed.length===0,dryRun:false,changed,failed}}
export async function listDestinationProducts(target:'woo'|'basalam'):Promise<Remote[]>{return target==='woo'?wooProducts():basalamProducts()}
export async function destinationOverview(target:'woo'|'basalam'){const items=await listDestinationProducts(target),statuses:Record<string,number>={};for(const item of items)statuses[item.status]=(statuses[item.status]||0)+1;return{target,total:items.length,statuses,withoutImage:items.filter(x=>!x.images.length).length,withoutSku:items.filter(x=>!x.sku).length}}
export async function findDestinationDuplicates(target:'woo'|'basalam'){const items=await listDestinationProducts(target),groups=new Map<string,Remote[]>();for(const item of items){const key=norm(item.name);if(!key)continue;const rows=groups.get(key)||[];rows.push(item);groups.set(key,rows)}return[...groups.entries()].filter(([,rows])=>rows.length>1).map(([title,rows])=>({title,count:rows.length,items:rows.map(x=>({id:x.id,name:x.name,status:x.status,sku:x.sku}))}))}
export async function destinationChangeStatus(target:'woo'|'basalam',id:number,status:string){if(target==='woo')await wooUpdate(id,{status});else await basalamUpdate(id,{status});return{ok:true,id,status}}
export async function destinationDelete(target:'woo'|'basalam',id:number,force=false,shopId=''){
  const c=await loadConnections();
  if(target==='woo'){
    const x=c.woo,auth=`Basic ${Buffer.from(`${x.key}:${x.secret}`).toString('base64')}`;
    const r=await safeFetch(`${x.url}/wp-json/wc/v3/products/${id}?force=${force?'true':'false'}`,{method:'DELETE',headers:{authorization:auth},apiMode:true},2_000_000);
    if(!r.ok)throw Error(`Woo delete HTTP ${r.status}`);
    return{ok:true,id,deleted:true,force};
  }
  // Basalam has no permanent DELETE endpoint; archive status 4184 is the
  // reversible equivalent, and it must target the stall that owns the product.
  await basalamUpdateShop(shopId||String(c.basalam.vendorId),id,{status:4184});
  return{ok:true,id,deleted:false,archived:true,status:4184,shopId:shopId||'default',message:'باسلام حذف دائمی ندارد؛ محصول با وضعیت ۴۱۸۴ بایگانی شد.'};
}
async function remoteProducts(target:'woo'|'basalam'):Promise<Remote[]>{return listDestinationProducts(target)}
async function wooProducts(){const c=(await loadConnections()).woo;if(!c.url||!c.key||!c.secret)throw Error('اتصال ووکامرس کامل نیست');const auth=`Basic ${Buffer.from(`${c.key}:${c.secret}`).toString('base64')}`,out:Remote[]=[];for(let page=1;page<=100;page++){const r=await safeFetch(`${c.url}/wp-json/wc/v3/products?per_page=100&page=${page}&status=any`,{headers:{authorization:auth,accept:'application/json'},apiMode:true},10_000_000),data=await r.json() as any[];if(!r.ok)throw Error(`Woo HTTP ${r.status}`);for(const x of data)out.push({id:Number(x.id),name:String(x.name||''),sku:String(x.sku||''),images:x.images||[],status:String(x.status||''),price:Number(x.price||0),raw:x});if(data.length<100)break}return out}
async function basalamProducts(){const c=(await loadConnections()).basalam;if(!c.token||!c.vendorId)throw Error('اتصال باسلام کامل نیست');const out:Remote[]=[];for(let page=1;page<=100;page++){const r=await safeFetch(`${c.api}/vendors/${encodeURIComponent(c.vendorId)}/products?per_page=100&page=${page}`,{headers:{authorization:`Bearer ${c.token}`,accept:'application/json'}},10_000_000),body=await r.json() as any;if(!r.ok)throw Error(`Basalam HTTP ${r.status}`);const data=body.data||body.products||body.results||body.items||[];for(const x of data)out.push({id:Number(x.id),name:String(x.name||x.title||''),sku:String(x.sku||''),images:x.photos||x.images||(x.photo?[x.photo]:[]),status:String(x.status||''),price:Number(x.price||0),raw:x});if(data.length<100)break}return out}
async function wooUpdate(id:number,payload:any){const c=(await loadConnections()).woo,auth=`Basic ${Buffer.from(`${c.key}:${c.secret}`).toString('base64')}`,r=await safeFetch(`${c.url}/wp-json/wc/v3/products/${id}`,{method:'PUT',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(payload),apiMode:true},3_000_000);if(!r.ok)throw Error(`Woo update ${id}: HTTP ${r.status}`)}
async function basalamUpdate(id:number,payload:any){const c=(await loadConnections()).basalam,r=await safeBasalamFetch(`${c.api}/vendors/${encodeURIComponent(c.vendorId)}/products/${id}`,{method:'PATCH',headers:{authorization:`Bearer ${c.token}`,'content-type':'application/json'},body:JSON.stringify(payload)},3_000_000);if(!r.ok)throw Error(`Basalam update ${id}: HTTP ${r.status}`)}
const msg=(e:unknown)=>e instanceof Error?e.message:String(e);
