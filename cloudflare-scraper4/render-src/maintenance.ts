import { basicAuth, normalizePersianText } from '../worker-src/utils.js';
import { byAccount, byProfile, planActions, planDuplicateDeletions, reconcileAccount, unreachableAccountRows, summarize } from '../worker-src/recon-core.js';
import type { ReconAccount, ReconLocal, ReconRemote, UnifiedReconRow } from '../worker-src/recon-core.js';
import { loadConnections } from './connections.js';
import { getProduct, getProfile, getState, learnCategory, listProfiles, maintenanceRows, setDestinationId, setRemoteId, setState } from './db.js';
import { safeBasalamFetch, safeFetch } from './network.js';
import { hasCodeSuffix, parseSuffixFormats, suffixPatterns } from '../worker-src/dedup.js';
import { syncBasalam, syncWoo } from './sync.js';
import { basalamStatuses, bulkPayload, categoryRoots, clamp, dedupeCategories, directPayload, flattenCategoryTree, normalizeCategoryAssignments, normalizeRefs, normalizeRemote, rowsFrom, selectShops, unwrapProduct, wooListStatus } from '../worker-src/destination-core.js';
import type { BasalamShopStall, CatalogQuery, DestinationCategory, ProductRef, RichRemote } from '../worker-src/destination-core.js';
type Target='woo'|'basalam';
type Shop=BasalamShopStall;

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
    actions: planActions(rows, suffixFormats).length, failures, rows,
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
  const actions = planActions(report.rows as UnifiedReconRow[], report.suffixFormats).slice(0, Math.max(1, Math.min(1000, limit)));
  if (!apply) return { ok: true, dryRun: true, planned: actions.length, actions: actions.slice(0, 200),
    matched: report.matched, priceDiff: report.priceDiff, missing: report.missing, extra: report.extra,
    noPrice: report.noPrice, unreachable: report.unreachable, inSync: report.inSync, local: report.local, localAll: report.localAll, skippedNoCode: report.skippedNoCode, accounts: report.accounts,
    accountsBreakdown: report.accountsBreakdown, profiles: report.profiles, failures: report.failures,
    rows: report.rows };
  let changed = 0; const failed: any[] = [];
  const products = new Map<string, any>();
  for (const action of actions) {
    try {
      if (action.kind === 'updatePrice' && action.remoteId && action.toPrice) {
        if (action.target === 'woo') await wooUpdate(action.remoteId, { regular_price: String(action.toPrice) });
        else await basalamUpdateShop(action.accountKey, action.remoteId, { primary_price: action.toPrice });
        changed++;
      } else if (action.kind === 'create') {
        const key = `${action.profileId}\u0000${action.sourceKey}`;
        if (!products.has(key)) products.set(key, await getProduct(action.profileId, action.sourceKey));
        const product = products.get(key);
        const profile = await getProfile(action.profileId);
        if (!product || !profile) { failed.push({ title: action.title, error: 'محصول یا پروفایل پیدا نشد' }); continue; }
        if (action.target === 'woo') await syncWoo(product, profile); else await syncBasalam(product, profile);
        changed++;
      } else if (action.kind === 'remove' && action.remoteId) {
        // Only at the destination: Woo deletes, Basalam archives (4184).
        await destinationDelete(action.target, action.remoteId, true, action.target === 'basalam' ? action.accountKey : '');
        changed++;
      }
    } catch (error) { failed.push({ title: action.title, account: action.accountName, error: msg(error) }); }
  }
  const after = changed ? await unifiedRecon(profileId) : report;
  return { ok: failed.length === 0, dryRun: false, planned: actions.length, changed, failed: failed.slice(0, 20),
    matched: after.matched, priceDiff: after.priceDiff, missing: after.missing, extra: after.extra,
    noPrice: after.noPrice, unreachable: after.unreachable, inSync: after.inSync, local: after.local, localAll: after.localAll, skippedNoCode: after.skippedNoCode, accounts: after.accounts,
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

/** Single-destination table, kept for the existing per-target buttons.
 * Same legacy scope as the Worker's reconTable (PHP v10.170 parity): every
 * product is compared, raw price against raw price, with no code-suffix
 * filtering — the unified table is the filtered, adjustment-aware one. */
const reconPrice = (value: unknown): number | null => { const n = Math.round(Number(value) || 0); return n > 0 ? n : null; };
export async function reconTable(target: 'woo' | 'basalam', profileId = '') {
  const local = await maintenanceRows(profileId), remote = await remoteProducts(target);
  const rows: any[] = [];
  const byTitle = new Map<string, any[]>(), bySku = new Map<string, any>(), byRemoteId = new Map<number, any>();
  for (const row of local) {
    const key = reconNormTitle(row.title);
    if (key) { const list = byTitle.get(key) || []; list.push(row); byTitle.set(key, list); }
    const sku = row.data?.sku || `s4-${row.profile_id}-${row.source_key}`.slice(0, 100);
    if (sku && !bySku.has(sku)) bySku.set(sku, row);
    let fromMapId = 0;
    for (const m of (row.maps || [])) { if (String(m.target || '') === target && Number(m.remote_id) > 0) { fromMapId = Number(m.remote_id); break; } }
    const mapped = fromMapId || (target === 'woo' ? Number(row.remote_woo_id || 0) : Number(row.remote_basalam_id || 0));
    if (mapped > 0 && !byRemoteId.has(mapped)) byRemoteId.set(mapped, row);
  }
  const consumed = new Set<any>();
  for (const item of remote) {
    const key = reconNormTitle(item.name || (item as any).title || '');
    let source = (byTitle.get(key) || []).find(row => !consumed.has(row)) || null, matchedBy = source ? 'title' : 'none';
    if (!source && item.sku && bySku.has(item.sku)) { const candidate = bySku.get(item.sku); if (!consumed.has(candidate)) { source = candidate; matchedBy = 'sku'; } }
    if (!source && byRemoteId.has(item.id)) { const candidate = byRemoteId.get(item.id); if (!consumed.has(candidate)) { source = candidate; matchedBy = 'id'; } }
    const remotePrice = reconPrice(item.price);
    if (!source) {
      rows.push({ bucket: 'extra', title: item.name || (item as any).title || '', remoteTitle: item.name || (item as any).title || '', remoteId: item.id || null, profileId: '', sourceKey: '', sourcePrice: null, remotePrice, delta: null, matchedBy: 'none', shopId: String((item as any).shopId || ''), shopName: String((item as any).shopName || ''), status: String(item.status || ''), why: 'در هیچ پروفایل/مبدأ نیست' });
      continue;
    }
    consumed.add(source);
    const sourcePrice = reconPrice(source.price);
    const base = { title: source.title || '', remoteTitle: item.name || (item as any).title || '', remoteId: item.id || null, profileId: String(source.profile_id || ''), sourceKey: String(source.source_key || ''), sourcePrice, remotePrice, matchedBy, shopId: String((item as any).shopId || ''), shopName: String((item as any).shopName || ''), status: String(item.status || '') };
    if (sourcePrice === null) rows.push({ ...base, bucket: 'noPrice', delta: null, why: 'قیمت مبدأ ثبت نشده — مقایسه نشد' });
    else if (remotePrice !== sourcePrice) rows.push({ ...base, bucket: 'priceDiff', delta: (remotePrice || 0) - sourcePrice, why: 'قیمت مقصد با مبدأ یکی نیست' });
    else rows.push({ ...base, bucket: 'matched', delta: 0, why: '' });
  }
  for (const row of local) {
    if (consumed.has(row)) continue;
    if (!row.active) continue;
    rows.push({ bucket: 'missing', title: row.title || '', remoteTitle: '', remoteId: null, profileId: String(row.profile_id || ''), sourceKey: String(row.source_key || ''), sourcePrice: reconPrice(row.price), remotePrice: null, delta: null, matchedBy: 'none', shopId: '', shopName: '', status: '', why: 'در مبدأ هست ولی در مقصد نیست' });
  }
  const count = (bucket: string) => rows.filter(row => row.bucket === bucket).length;
  const summary = { matched: count('matched'), priceDiff: count('priceDiff'), extra: count('extra'), missing: count('missing'), noPrice: count('noPrice') };
  const matchedByTitle = rows.filter(row => row.matchedBy === 'title').length, matchedBySku = rows.filter(row => row.matchedBy === 'sku').length, matchedById = rows.filter(row => row.matchedBy === 'id').length;
  const inSync = summary.priceDiff === 0 && summary.extra === 0 && summary.missing === 0;
  const report = { ok: true, target, at: new Date().toISOString(), profileId, local: local.length, remote: remote.length, ...summary, inSync, matchedByTitle, matchedBySku, matchedById, rows };
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
export async function destinationChangeStatus(target:'woo'|'basalam',id:number,status:string,shopId=''){const allowed=target==='woo'?['publish','draft','private','pending','trash']:['2976','3790','3567','3568','4184'];if(!allowed.includes(String(status)))throw Error('وضعیت انتخاب‌شده معتبر نیست.');if(target==='woo')await wooUpdate(id,{status});else await basalamUpdate(id,{status:Number(status)},shopId);return{ok:true,id,status,shopId:shopId||'default'}}
export async function destinationDelete(target:'woo'|'basalam',id:number,force=false,shopId=''){
  const c=await loadConnections();
  if(target==='woo'){
    const x=c.woo,auth=`Basic ${Buffer.from(`${x.key}:${x.secret}`).toString('base64')}`;
    const r=await safeFetch(`${x.url}/wp-json/wc/v3/products/${id}?force=${force?'true':'false'}`,{method:'DELETE',headers:{authorization:auth},apiMode:true,directRoute:true},2_000_000);
    if(!r.ok)throw Error(`Woo delete HTTP ${r.status}`);
    return{ok:true,id,deleted:true,force,product:await r.json().catch(()=>null)};
  }
  // Basalam has no permanent DELETE endpoint; archive status 4184 is the
  // reversible equivalent, and it must target the stall that owns the product.
  await basalamUpdateShop(shopId||String(c.basalam.vendorId),id,{status:4184});
  return{ok:true,id,deleted:false,archived:true,status:4184,shopId:shopId||'default',message:'باسلام حذف دائمی ندارد؛ محصول با وضعیت ۴۱۸۴ بایگانی شد.'};
}
async function remoteProducts(target:'woo'|'basalam'):Promise<Remote[]>{return listDestinationProducts(target)}
async function wooProducts(){const c=(await loadConnections()).woo;if(!c.url||!c.key||!c.secret)throw Error('اتصال ووکامرس کامل نیست');const auth=`Basic ${Buffer.from(`${c.key}:${c.secret}`).toString('base64')}`,out:Remote[]=[];for(let page=1;page<=100;page++){const r=await safeFetch(`${c.url}/wp-json/wc/v3/products?per_page=100&page=${page}&status=any`,{headers:{authorization:auth,accept:'application/json'},apiMode:true,directRoute:true},10_000_000),data=await r.json() as any[];if(!r.ok)throw Error(`Woo HTTP ${r.status}`);for(const x of data)out.push({id:Number(x.id),name:String(x.name||''),sku:String(x.sku||''),images:x.images||[],status:String(x.status||''),price:Number(x.price||0),raw:x});if(data.length<100)break}return out}
async function basalamProducts(){const c=(await loadConnections()).basalam;if(!c.token||!c.vendorId)throw Error('اتصال باسلام کامل نیست');const out:Remote[]=[];for(let page=1;page<=100;page++){const r=await safeFetch(`${c.api}/vendors/${encodeURIComponent(c.vendorId)}/products?per_page=100&page=${page}`,{headers:{authorization:`Bearer ${c.token}`,accept:'application/json'}},10_000_000),body=await r.json() as any;if(!r.ok)throw Error(`Basalam HTTP ${r.status}`);const data=body.data||body.products||body.results||body.items||[];for(const x of data)out.push({id:Number(x.id),name:String(x.name||x.title||''),sku:String(x.sku||''),images:x.photos||x.images||(x.photo?[x.photo]:[]),status:String(x.status||''),price:Math.round(Number(x.price||0)/10),raw:x});if(data.length<100)break}return out}
async function wooUpdate(id:number,payload:any){const c=(await loadConnections()).woo,auth=basicAuth(c.key,c.secret),result=await fetchJson(`${wooBase(c)}/${id}`,{method:'PUT',headers:{authorization:auth,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},true);return result.body}
async function basalamUpdate(id:number,payload:any,shopId=''){const shops=selectShops(await basalamShops(),shopId||'all');if(!shops.length)throw Error('غرفهٔ باسلام پیدا نشد.');let last:unknown;for(const shop of shops){for(const endpoint of [`${(await loadConnections()).basalam.api}/products/${id}`,`${(await loadConnections()).basalam.api}/vendors/${encodeURIComponent(shop.vendorId)}/products/${id}`])try{return(await basalamFetch(shop,endpoint,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).body}catch(error){last=error;if(!(error instanceof DestinationHttpError&&error.status===404))throw error}}throw last instanceof Error?last:Error(`ویرایش محصول باسلام #${id} ناموفق بود.`)}
const msg=(e:unknown)=>e instanceof Error?e.message:String(e);

// ─── Destination catalog + category parity ────────────────────────────────────
// Mirrors worker-src/maintenance.ts in behavior: same endpoints, same response
// shapes, same 20-product bulk cap. The pure builders (payloads, category tree,
// status maps) are the shared worker-src/destination-core.ts; only this HTTP
// layer is Node-specific (safeFetch / safeBasalamFetch instead of Worker fetch).
class DestinationHttpError extends Error{constructor(public status:number,public body:any,url:string){super(`HTTP ${status} از ${new URL(url).hostname}: ${String(body?.message||body?.error||JSON.stringify(body)).slice(0,300)}`)}}
async function fetchJson(url:string,init:RequestInit={},woo:boolean|'basalam'=false){const response=await(woo==='basalam'?safeBasalamFetch(url,init,10_000_000):woo?safeFetch(url,{...init,apiMode:true,directRoute:true},10_000_000):safeFetch(url,init,10_000_000)),text=await response.text();let body:any;try{body=text?JSON.parse(text):{}}catch{body={message:text.slice(0,500)}}if(!response.ok)throw new DestinationHttpError(response.status,body,url);return{response,body}}
async function basalamShops():Promise<Shop[]>{const c=(await loadConnections()).basalam;if(!c.token||!c.vendorId)throw Error('اتصال باسلام کامل نیست');const rows:Shop[]=[{name:'غرفه پیش‌فرض',token:c.token,vendorId:String(c.vendorId),pricePercent:0,primary:true},...(c.shops||[]).filter(shop=>shop.token&&shop.vendorId).map(shop=>({name:shop.name,token:shop.token,vendorId:String(shop.vendorId),pricePercent:shop.pricePercent||0,primary:false}))],seen=new Set<string>();return rows.filter(row=>row.vendorId&&!seen.has(row.vendorId)&&(seen.add(row.vendorId),true))}
function wooBase(c:{url:string;key:string;secret:string}){if(!c.url||!c.key||!c.secret)throw Error('اتصال ووکامرس کامل نیست');return c.url.replace(/\/$/,'')+'/wp-json/wc/v3/products'}
async function basalamFetch(shop:Shop,url:string,init:RequestInit={}){return fetchJson(url,{...init,headers:{authorization:`Bearer ${shop.token}`,accept:'application/json',...init.headers}},'basalam')}
async function wooCatalog(query:{page:number;perPage:number;q:string;status:string}){
  const c=(await loadConnections()).woo;if(!c.url||!c.key||!c.secret)throw Error('اتصال ووکامرس کامل نیست');const auth=basicAuth(c.key,c.secret);
  if(/^\d+$/.test(query.q)){try{const product=await wooGet(Number(query.q));return{products:[product],total:1,totalPages:1,foundBy:'id'}}catch{/* continue with server search */}}
  const url=new URL(wooBase(c));url.searchParams.set('page',String(query.page));url.searchParams.set('per_page',String(query.perPage));url.searchParams.set('status',wooListStatus(query.status));if(query.q)url.searchParams.set('search',query.q);
  const result=await fetchJson(url.toString(),{headers:{authorization:auth,accept:'application/json'}},true),rows=Array.isArray(result.body)?result.body:[];
  return{products:rows.map(row=>normalizeRemote('woo',row,'default','فروشگاه ووکامرس')),total:Number(result.response.headers.get('x-wp-total')||rows.length),totalPages:Math.max(1,Number(result.response.headers.get('x-wp-totalpages')||1)),foundBy:query.q?'search':'list'};
}
async function wooStatusCounts(){const statuses=['all','publish','draft','pending','private','trash'],entries=await Promise.all(statuses.map(async status=>{try{const result=await wooCatalog({page:1,perPage:10,q:'',status});return[status,result.total] as const}catch{return[status,0] as const}}));return Object.fromEntries(entries)}
async function wooGet(id:number){const c=(await loadConnections()).woo,auth=basicAuth(c.key,c.secret),result=await fetchJson(`${wooBase(c)}/${id}`,{headers:{authorization:auth,accept:'application/json'}},true);return normalizeRemote('woo',unwrapProduct(result.body),'default','فروشگاه ووکامرس')}
async function basalamCatalog(query:{page:number;perPage:number;q:string;status:string;shopId:string}){
  const shops=selectShops(await basalamShops(),query.shopId);if(!shops.length)throw Error('غرفهٔ باسلام پیدا نشد.');
  if(/^\d+$/.test(query.q)){for(const shop of shops)try{const product=await basalamGet(Number(query.q),shop.vendorId);return{products:[product],total:1,totalPages:1,foundBy:'id'}}catch{/* next shop */}}
  const products:RichRemote[]=[];let total=0,totalPages=1,successful=0;for(const shop of shops){const url=new URL(`${(await loadConnections()).basalam.api}/vendors/${encodeURIComponent(shop.vendorId)}/products`);url.searchParams.set('page',String(query.page));url.searchParams.set('per_page',String(query.perPage));for(const value of basalamStatuses(query.status))url.searchParams.append('statuses',value);if(query.q)url.searchParams.set('title',query.q);try{const result=await basalamFetch(shop,url.toString()),rows=rowsFrom(result.body);products.push(...rows.map(row=>normalizeRemote('basalam',row,shop.vendorId,shop.name)));total+=Number(result.body?.total_count??result.body?.meta?.total??rows.length);totalPages=Math.max(totalPages,Number(result.body?.total_page??result.body?.meta?.last_page??1));successful++}catch(error){if(shops.length===1)throw error}}
  if(!successful)throw Error('دریافت فهرست محصولات از هیچ غرفه‌ای موفق نبود.');return{products,total,totalPages,foundBy:query.q?'title':'list'};
}
async function basalamStatusCounts(shopId:string){const statuses=['all','2976','3790','3567','3568','4184'],entries=await Promise.all(statuses.map(async status=>{try{const result=await basalamCatalog({page:1,perPage:10,q:'',status,shopId});return[status,result.total] as const}catch{return[status,0] as const}}));return Object.fromEntries(entries)}
async function basalamGet(id:number,shopId=''){const shops=selectShops(await basalamShops(),shopId||'all');let last:unknown;for(const shop of shops){for(const endpoint of [`${(await loadConnections()).basalam.api}/products/${id}`,`${(await loadConnections()).basalam.api}/vendors/${encodeURIComponent(shop.vendorId)}/products/${id}`])try{const result=await basalamFetch(shop,endpoint),raw=unwrapProduct(result.body);if(Number(raw?.id||0)>0)return normalizeRemote('basalam',raw,shop.vendorId,shop.name)}catch(error){last=error}}throw last instanceof Error?last:Error(`محصول باسلام #${id} پیدا نشد.`)}
async function basalamBatchUpdate(shopId:string,items:any[]){const shop=(await basalamShops()).find(item=>item.vendorId===shopId);if(!shop)throw Error('غرفهٔ باسلام پیدا نشد.');return(await basalamFetch(shop,`${(await loadConnections()).basalam.api}/vendors/${encodeURIComponent(shop.vendorId)}/products/batch-updates`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({data:items})})).body}
export async function destinationCatalog(target:Target,query:CatalogQuery={}){
  const page=clamp(query.page,1,10_000,1),perPage=clamp(query.perPage,10,100,25),q=String(query.q||'').trim(),status=String(query.status||'all'),shopId=String(query.shopId||'all');
  if(target==='woo'){
    const result=await wooCatalog({page,perPage,q,status}),counts=query.counts?await wooStatusCounts():undefined;
    return{ok:true,target,page,perPage,q,status,shopId:'default',shops:[{id:'default',name:'فروشگاه ووکامرس'}],...result,...(counts?{counts}:{}),priceUnit:'تومان'};
  }
  const result=await basalamCatalog({page,perPage,q,status,shopId}),counts=query.counts?await basalamStatusCounts(shopId):undefined;
  return{ok:true,target,page,perPage,q,status,shopId,shops:(await basalamShops()).map(shop=>({id:shop.vendorId,name:shop.name,primary:shop.primary})),...result,...(counts?{counts}:{}),priceUnit:'تومان',remotePriceUnit:'ریال',archiveInsteadOfDelete:true};
}
export async function destinationCategories(refresh=false):Promise<{items:DestinationCategory[];cached:boolean;updatedAt:string}>{
  const cacheKey='basalam_categories_v1',cached=await getState<any>(cacheKey,null),maxAge=24*60*60*1000;
  if(!refresh&&Array.isArray(cached?.items)&&cached.items.length&&Date.now()-Date.parse(String(cached.updatedAt||0))<maxAge)return{items:cached.items,cached:true,updatedAt:String(cached.updatedAt)};
  const connection=(await loadConnections()).basalam;if(!connection.token)throw Error('توکن باسلام خالی است.');const shop:Shop={name:'غرفه پیش‌فرض',token:connection.token,vendorId:String(connection.vendorId||''),pricePercent:0,primary:true},api=connection.api;
  const result=await basalamFetch(shop,`${String(api).replace(/\/$/,'')}/categories`),roots=categoryRoots(result.body),items:DestinationCategory[]=[];
  flattenCategoryTree(roots,items,[],0,null);
  if(!items.length)throw Error('فهرست دسته‌بندی باسلام خالی است. اتصال و پاسخ API را بررسی کنید.');
  const record={items:dedupeCategories(items),updatedAt:new Date().toISOString()};await setState(cacheKey,record);return{...record,cached:false};
}
export async function destinationProduct(target:Target,id:number,shopId=''){if(!Number.isInteger(id)||id<=0)throw Error('شناسه محصول نامعتبر است.');return target==='woo'?wooGet(id):basalamGet(id,shopId)}
/** Applies one already-validated category without an extra product GET, so bulk
 * runs stay fast while category learning stays consistent with manual edits. */
export async function applyBasalamCategory(id:number,shopId:string,categoryId:number,title:string,categoryName:string,source='هوش مصنوعی سرورساید'){
  if(!Number.isInteger(id)||id<=0||!Number.isInteger(categoryId)||categoryId<=0)throw Error('شناسهٔ محصول یا دسته‌بندی نامعتبر است.');
  const raw=await basalamUpdate(id,{category_id:categoryId},shopId);const learned=await learnCategory(title,categoryId,categoryName);
  return{ok:true,id,shopId,categoryId,categoryName,source,learned,raw};
}
export async function destinationUpdate(target:Target,id:number,input:any,apply=false,shopId=''){
  const current=await destinationProduct(target,id,shopId),payload=directPayload(target,input,current);
  if(!Object.keys(payload).length)return{ok:true,dryRun:!apply,id,shopId:current.shopId,changed:false,current,changes:{}};
  if(!apply)return{ok:true,dryRun:true,id,shopId:current.shopId,changed:true,current,changes:payload,summary:'پیش‌نمایش است؛ چیزی روی مقصد تغییر نکرد.'};
  const raw=target==='woo'?await wooUpdate(id,payload):await basalamUpdate(id,payload,current.shopId);let learningRecords=0;if(target==='basalam'&&Number(payload.category_id)>0)learningRecords=await learnCategory(current.title,Number(payload.category_id),String(input.categoryName||current.category||`#${payload.category_id}`));return{ok:true,dryRun:false,id,shopId:current.shopId,changed:true,product:normalizeRemote(target,unwrapProduct(raw),current.shopId,current.shopName),learningRecords};
}
export async function destinationBulkEdit(target:Target,input:any,apply=false){
  const refs=normalizeRefs(input.ids,input.shopId);if(!refs.length)throw Error('محصولی انتخاب نشده است.');
  if(refs.length>20)throw Error('در هر نوبت ویرایش حداکثر ۲۰ محصول است. انتخاب را به چند نوبت تقسیم کنید.');
  const ops=input.ops&&typeof input.ops==='object'?input.ops:input,assignments=normalizeCategoryAssignments(ops.categoryAssignments),items:any[]=[],updates:Array<{ref:ProductRef;payload:any;row:any}>=[],failures:any[]=[];
  for(const ref of refs)try{
    const current=await destinationProduct(target,ref.id,ref.shopId),assignment=assignments.get(`${ref.shopId||current.shopId}:${ref.id}`)||assignments.get(`:${ref.id}`),effective=assignment?{...ops,categoryId:assignment.categoryId}:ops,built=bulkPayload(target,effective,current),row={id:ref.id,shopId:current.shopId,title:current.title,oldPrice:current.price,...built.summary,...(assignment?{categoryName:assignment.categoryName,categorySource:assignment.source}:{})};
    if(ops.delete){row.action=target==='basalam'?'بایگانی با وضعیت ۴۱۸۴':'حذف'+(ops.force?' همیشگی':' به زباله‌دان');updates.push({ref:{...ref,shopId:current.shopId},payload:target==='basalam'?{status:4184}:{delete:true,force:Boolean(ops.force)},row})}
    else if(Object.keys(built.payload).length){row.action='ویرایش';updates.push({ref:{...ref,shopId:current.shopId},payload:built.payload,row})}else row.action='بدون تغییر';
    items.push(row);
  }catch(error){const row={id:ref.id,shopId:ref.shopId,error:msg(error)};items.push(row);failures.push(row)}
  if(!apply)return{ok:failures.length===0,dryRun:true,target,total:refs.length,changed:updates.filter(x=>!x.payload.delete).length,deleted:updates.filter(x=>x.payload.delete||x.payload.status===4184&&ops.delete).length,skipped:refs.length-updates.length-failures.length,failed:failures.length,items,limit:20,summary:'پیش‌نمایش کامل شد؛ هیچ تغییری روی مقصد اعمال نشد.'};
  const applied=await applyBulk(target,updates),failed=[...failures,...applied.failed],failedKeys=new Set(applied.failed.map(row=>`${row.shopId}:${row.id}`));for(const failure of applied.failed){const row=items.find(item=>item.id===failure.id&&item.shopId===failure.shopId);if(row)row.error=failure.error}
  let learningRecords=0;if(target==='basalam')for(const item of updates)if(Number(item.payload.category_id)>0&&!failedKeys.has(`${item.ref.shopId}:${item.ref.id}`))learningRecords+=await learnCategory(item.row.title,Number(item.payload.category_id),String(item.row.categoryName||`#${item.payload.category_id}`));
  return{ok:failed.length===0,dryRun:false,target,total:refs.length,changed:applied.changed,deleted:applied.deleted,skipped:refs.length-updates.length-failures.length,failed:failed.length,items,limit:20,archiveInsteadOfDelete:target==='basalam',learningRecords};
}
async function applyBulk(target:Target,updates:Array<{ref:ProductRef;payload:any;row:any}>){
  let changed=0,deleted=0;const failed:any[]=[];
  if(target==='basalam'){
    const groups=new Map<string,typeof updates>();for(const item of updates){const rows=groups.get(item.ref.shopId)||[];rows.push(item);groups.set(item.ref.shopId,rows)}
    for(const [shopId,rows] of groups)try{await basalamBatchUpdate(shopId,rows.map(item=>({id:item.ref.id,...item.payload})));for(const item of rows)item.payload.status===4184&&item.row.action?.includes('بایگانی')?deleted++:changed++}catch{
      for(const item of rows)try{await basalamUpdate(item.ref.id,item.payload,shopId);item.payload.status===4184&&item.row.action?.includes('بایگانی')?deleted++:changed++}catch(error){failed.push({id:item.ref.id,shopId,error:msg(error)})}
    }
    return{changed,deleted,failed};
  }
  for(const item of updates)try{if(item.payload.delete){await destinationDelete('woo',item.ref.id,item.payload.force);deleted++}else{await wooUpdate(item.ref.id,item.payload);changed++}}catch(error){failed.push({id:item.ref.id,shopId:'default',error:msg(error)})}return{changed,deleted,failed};
}

