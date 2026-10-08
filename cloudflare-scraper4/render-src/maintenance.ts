import { actionLine, bucketTally, bucketLines, liveRows, matchLines, planOrder, matchedProofLines, profileLines, clip as clipText, countLines, createReconProgress, describeLedgerEvent, fa as faN, faDuration, faPrice, mergeTally, sampleLines, sourceNote, tallySummary, throughput } from '../worker-src/recon-progress.js';
import { planProfileRemovals } from '../worker-src/profile-sync-core.js';
import { customerVisible } from '../worker-src/ledger-inventory.js';
import { destinationLedger, destinationScope } from './ledger.js';
import { basicAuth, normalizePersianText } from '../worker-src/utils.js';
import { byAccount, byProfile, findProfileBySuffix, planActions, planDuplicateDeletions, reconPlan, reconcileAccount, unreachableAccountRows, summarize } from '../worker-src/recon-core.js';
import type { ReconAccount, ReconLocal, ReconRemote, UnifiedReconRow, ProfileSuffixInfo } from '../worker-src/recon-core.js';
import { loadConnections } from './connections.js';
import { deleteProduct, getProduct, getProfile, getState, learnCategory, listProfiles, maintenanceRows, setDestinationId, setRemoteId, setState } from './db.js';
import { safeBasalamFetch, safeFetch } from './network.js';
import { normalizeApiBase, runApiWriteLoop, summarizeApiAttempts } from '../worker-src/api-loop.js';
import { hasCodeSuffix, parseSuffixFormats, stripCodeSuffix, suffixPatterns } from '../worker-src/dedup.js';
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
import { reconNormTitle } from '../worker-src/recon-core.js';
export { reconNormTitle };

/** Every destination account: the WooCommerce site plus each Basalam stall. */
export async function reconAccounts():Promise<ReconAccount[]>{
 const c=await loadConnections(),accounts:ReconAccount[]=[];
 if(c.woo?.url&&c.woo?.key&&c.woo?.secret)accounts.push({target:'woo',accountKey:'default',name:'ووکامرس',pricePercent:Number(c.woo.pricePercent)||0});
 const shops=[...(c.basalam?.token&&c.basalam?.vendorId?[{...c.basalam,name:'غرفهٔ پیش‌فرض'}]:[]),...(c.basalam?.shops||[])],seen=new Set<string>();
 for(const shop of shops){const id=String(shop.vendorId||'');if(!id||!shop.token||seen.has(id))continue;seen.add(id);accounts.push({target:'basalam',accountKey:id,name:'باسلام — '+(shop.name||id),pricePercent:Number(shop.pricePercent)||0,toRial:true})}
 return accounts;
}
// Twin of worker-src/maintenance.ts: removals are reported, never applied by the sync pass.
const fa0=(value:number)=>String(value).replace(/\d/g,d=>'۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const PLAN_NOTE='محصولاتی که فقط در مقصد هستند گزارش می‌شوند ولی با «اعمال هماهنگ‌سازی» حذف نمی‌شوند؛ برای حذف از «تکراری‌های مقصد» یا «محصولات حذف‌شده از مبدأ» استفاده کنید.';
const LEDGER_MAX_PAGES=500;
const LEDGER_RETRY=3;
const LEDGER_TTL_MS_DEFAULT=3600000;
const LEDGER_MAX_AGE_HOURS_DEFAULT=1;
function ledgerTtlFromSettings(settings:any){const raw=settings?.general?.ledgerEveryHours;const h=Number(raw);if(!Number.isFinite(h)||h<=0)return LEDGER_TTL_MS_DEFAULT;return Math.round(Math.min(168,Math.max(0.25,h))*3600000)}
function ledgerMaxAgeHoursFromSettings(settings:any){return Math.max(0.25,ledgerTtlFromSettings(settings)/3600000)}
const LEDGER_TTL_MS=LEDGER_TTL_MS_DEFAULT;
const LEDGER_MAX_AGE_HOURS=LEDGER_MAX_AGE_HOURS_DEFAULT;
type LedgerProgressEvent={type:string;account?:string;page?:number;totalPages?:number;fetched?:number;duplicate?:number;incomplete?:boolean;error?:string;attempt?:number;[k:string]:any};
function sleep(ms:number){return new Promise<void>(r=>setTimeout(r,ms))}
const LEDGER_PAGE_PARALLEL=4;
// ۱.۳۴۱.۰ — صفحه‌های ۱۰۰تایی دیگر یکی‌یکی خوانده نمی‌شوند: صفحهٔ اول تعداد کل صفحه‌ها را می‌گوید و
// بقیه چهارتا‌چهارتا هم‌زمان درخواست می‌شوند. ادغام همچنان به‌ترتیب صفحه انجام می‌شود تا حذف
// تکراری‌ها و شمارش‌ها دقیقاً مثل قبل و قطعی بماند.
async function scanLedgerAccount(account:ReconAccount,onProgress?:(e:LedgerProgressEvent)=>void):Promise<ReconRemote[]>{
 const all:any[]=[],seen=new Set<string>();
 let totalPages=1,duplicate=0,incomplete=false,lastTotal:number|null=null;
 const take=(page:number,result:any)=>{
  if(result.complete===false){
   incomplete=true;
   onProgress?.({type:'ledger-page-incomplete',account:account.name,page});
  }
  for(const x of result.products){
   const idStr=String(x.id||'');
   if(!idStr||idStr==='0'){
    continue;
   }
   if(seen.has(idStr)){
    duplicate++;
    continue;
   }
   seen.add(idStr);
   all.push({id:x.id,name:x.name,sku:x.sku,price:x.priceRaw,status:x.status,shopId:account.accountKey,shopName:account.name,raw:x.raw});
  }
  totalPages=Math.max(1,Number(result.totalPages)||totalPages);
  if(Number.isFinite(result.total))lastTotal=Number(result.total);
  onProgress?.({type:'ledger-page-done',account:account.name,page,totalPages,fetched:all.length,duplicate,incomplete});
 };
 take(1,await fetchLedgerPage(account,1,totalPages,onProgress));
 for(let next=2;next<=Math.min(totalPages,LEDGER_MAX_PAGES);){
  const last=Math.min(next+LEDGER_PAGE_PARALLEL-1,Math.min(totalPages,LEDGER_MAX_PAGES));
  const pages:number[]=[];
  for(let page=next;page<=last;page++)pages.push(page);
  const results=await Promise.all(pages.map(page=>fetchLedgerPage(account,page,totalPages,onProgress)));
  for(let i=0;i<pages.length;i++)take(pages[i],results[i]);
  next=last+1;
 }
 if(totalPages>LEDGER_MAX_PAGES)onProgress?.({type:'ledger-max-pages',account:account.name,totalPages:LEDGER_MAX_PAGES,fetched:all.length});
 else if(lastTotal!==null&&Math.abs(all.length-lastTotal)>Math.max(5,Math.floor(lastTotal*0.02)))onProgress?.({type:'ledger-total-mismatch',account:account.name,expected:lastTotal,actual:all.length});
 return all;
}
async function fetchLedgerPage(account:ReconAccount,page:number,totalPages:number,onProgress?:(e:LedgerProgressEvent)=>void):Promise<any>{
 let lastError:any;
 for(let attempt=1;attempt<=LEDGER_RETRY;attempt++){
  try{
   onProgress?.({type:'ledger-page-start',account:account.name,page,totalPages,attempt});
   return await destinationCatalog(account.target,{page,perPage:100,status:account.target==='woo'?'publish':'all',shopId:account.accountKey});
  }catch(error){
   lastError=error;
   if(attempt<LEDGER_RETRY){
    onProgress?.({type:'ledger-page-retry',account:account.name,page,attempt,error:error instanceof Error?error.message:String(error)});
    await sleep(500*attempt+Math.random()*200);
   }
  }
 }
 throw lastError||Error(`فهرست مقصد برای ${account.name} صفحه ${page} پس از ${LEDGER_RETRY} تلاش ناموفق بود.`);
}
async function remoteForAccount(account:ReconAccount,force=false,onProgress?:(e:LedgerProgressEvent)=>void,ttlMs?:number):Promise<ReconRemote[]>{
 const scope=await destinationScope(account.target,account.accountKey);
 await destinationLedger.refresh(scope,()=>scanLedgerAccount(account,onProgress),force,ttlMs);
 let entries=await destinationLedger.entries(scope);
 if(entries.some(x=>x.invalid)){
  await destinationLedger.refresh(scope,()=>scanLedgerAccount(account,onProgress),true,ttlMs);
  entries=await destinationLedger.entries(scope);
  if(entries.some(x=>x.invalid)){
   onProgress?.({type:'ledger-invalid-remaining',account:account.name});
  }
 }
 return entries.map(x=>x.remote).filter(x=>customerVisible(account.target,x));
}
export async function refreshDestinationLedger(force=false,onProgress?:(e:LedgerProgressEvent)=>void){
 const p=createReconProgress(onProgress as any);
 const settings=await getState<any>('settings',{}),ttlMs=ledgerTtlFromSettings(settings),maxAgeHours=ledgerMaxAgeHoursFromSettings(settings);
 const startedAt=new Date().toISOString(),accounts=await reconAccounts(),items:any[]=[];
 for(const account of accounts){
  try{
   const before=await destinationLedger.metadata(await destinationScope(account.target,account.accountKey));
   p.emit({stage:'account-start',name:'account',account:account.name,target:account.target,
     summary:'شروع اسکن '+account.name+(force?' (تازه‌سازی اجباری)':' (اگر دفتر تازه باشد دوباره خوانده نمی‌شود)')});
   await remoteForAccount(account,force,(e)=>p.ledger(account.name,e,account.target),ttlMs);
   const meta=await destinationLedger.metadata(await destinationScope(account.target,account.accountKey));
   items.push({...account,...meta,cached:before?.generation===meta?.generation,ok:true});
   p.emit({stage:'account-done',name:'account',status:'success',account:account.name,target:account.target,count:Number(meta?.count)||0,
     summary:account.name+': '+(before?.generation===meta?.generation?'دفتر تازه بود و دوباره خوانده نشد':'اسکن شد')+' · '+faN(Number(meta?.count)||0)+' محصول · زمان سپری‌شده '+faDuration(p.elapsed())});
  }catch(error){
   items.push({...account,ok:false,error:error instanceof Error?error.message:String(error)});
   p.emit({stage:'account-error',name:'account',status:'error',account:account.name,target:account.target,
     summary:account.name+' ناموفق: '+(error instanceof Error?error.message:String(error))+' — دفتر قبلی این مقصد دست‌نخورده ماند'});
  }
 }
 const durationMs=Math.max(0,Date.now()-Date.parse(startedAt)),report={ok:items.every(x=>x.ok),items,maxAgeHours,startedAt,completedAt:new Date().toISOString(),durationMs,durationMinutes:durationMs/60000,scannedAccounts:items.filter(x=>x.ok&&!x.cached).length,cachedAccounts:items.filter(x=>x.cached).length};
 p.emit({stage:'report-ready',name:'report',status:report.ok?'success':'error',count:items.filter(x=>x.ok).length,total:items.length,
   summary:'تازه‌سازی دفتر تمام شد در '+faDuration(report.durationMs)+' · اسکن‌شده: '+faN(report.scannedAccounts)+' · از دفتر تازه: '+faN(report.cachedAccounts)+' · ناموفق: '+faN(items.filter(x=>!x.ok).length),
   detail:items.map((x:any)=>x.name+': '+(x.ok?faN(Number(x.count)||0)+' محصول':'ناموفق — '+clipText(x.error)))});
 await setState('destination_ledger:last_refresh',report);if(report.ok&&accounts.length&&report.scannedAccounts===accounts.length)await setState('destination_ledger:last_full_refresh',report);return report;
}
export async function destinationLedgerStatus(){const settings=await getState<any>('settings',{}),ttlMs=ledgerTtlFromSettings(settings),maxAgeHours=ledgerMaxAgeHoursFromSettings(settings);const items=[];for(const account of await reconAccounts()){const meta=await destinationLedger.metadata(await destinationScope(account.target,account.accountKey));items.push({...account,...meta,ready:!!meta,stale:!meta||meta.inventoryPolicy!=='customer-visible-v1'||Date.now()-Date.parse(meta.startedAt)>=ttlMs})}return {ok:true,items,maxAgeHours,lastRefresh:await getState<any>('destination_ledger:last_refresh',null),lastFullRefresh:await getState<any>('destination_ledger:last_full_refresh',null)}}


/**
 * Unified reconciliation across profiles, the WooCommerce site and every
 * Basalam stall. One row per (product, destination), prices compared after each
 * destination's own adjustment.
 */
/**
 * Single implementation (1.335.0): the silent variant is the live one without a
 * listener. Twin of worker-src/maintenance.ts.
 */
export async function unifiedRecon(profileId = '') { return unifiedReconLive(profileId); }

export async function unifiedReconLive(profileId='',onProgress?:(e:any)=>void){
  const p=createReconProgress(onProgress);
  p.emit({stage:'start',name:'scope',summary:'شروع مقایسهٔ مبدأ و مقصد'+(profileId?' برای یک پروفایل':' برای همهٔ پروفایل‌ها')+' · هیچ چیزی در این مرحله نوشته یا حذف نمی‌شود'});
  p.emit({stage:'profiles-loading',name:'local',summary:'خواندن فهرست پروفایل‌ها…'});
  const allProfilesRaw=await listProfiles();
  p.emit({stage:'local-loading',name:'local',count:allProfilesRaw.length,summary:'پروفایل‌ها: '+faN(allProfilesRaw.length)+' · خواندن محصولات ذخیره‌شدهٔ محلی…'});
  const local = await maintenanceRows(profileId) as ReconLocal[];
  const profileNames: Record<string,string>={};
  for(const profile of allProfilesRaw) profileNames[profile.id]=profile.name||profile.id;
  const settings=await getState<any>('settings',{}) as any;
  const suffixFormats=settings?.dedup?.suffixFormats||'';
  const patterns=suffixPatterns(parseSuffixFormats(suffixFormats));

  const profilesInfo:ProfileSuffixInfo[]=allProfilesRaw.map((p:any)=>({id:String(p.id),name:String(p.name||p.id),titleSuffix:String(p.titleSuffix||'')}));
  let allLocalForCounts:ReconLocal[];
  if(profileId) allLocalForCounts=await maintenanceRows('') as ReconLocal[];
  else allLocalForCounts=local as ReconLocal[];
  const counts=new Map<string,number>();
  for(const row of allLocalForCounts){
    if(row.active===false||row.active===0)continue;
    const pid=String(row.profile_id||'');
    counts.set(pid,(counts.get(pid)||0)+1);
  }
  const zeroCountIds=new Set<string>();
  for(const p of profilesInfo){ if((counts.get(p.id)||0)===0) zeroCountIds.add(p.id); }

  const eligible=local.filter(row=>hasCodeSuffix(String(row.title||''),patterns));
  const skippedNoCode=local.length-eligible.length;
  const eligibleByProfile=new Map<string,number>();
  for(const row of eligible)eligibleByProfile.set(String(row.profile_id||''),(eligibleByProfile.get(String(row.profile_id||''))||0)+1);
  p.emit({stage:'local-loaded',name:'local',count:eligible.length,total:local.length,
    summary:'محصولات محلی خوانده شد: '+faN(local.length)+' مورد · قابل مقایسه (دارای پسوند کد): '+faN(eligible.length)+(skippedNoCode?' · بدون پسوند کد و نادیده‌گرفته‌شده: '+faN(skippedNoCode):''),
    detail:countLines(eligibleByProfile,profileNames,5)});
  // Why some products are not compared at all — named, with real examples, instead of a silent subtraction.
  p.emit({stage:'suffix-rule',name:'rule',count:skippedNoCode,total:local.length,
    summary:'قاعدهٔ مقایسه: فقط محصولاتی که پسوند کد دارند با مقصد مقایسه می‌شوند'+(suffixFormats?' · الگوی تنظیم‌شده: '+clipText(suffixFormats,60):' · الگوی پیش‌فرض «(کد ایکس)»')+(skippedNoCode?' · '+faN(skippedNoCode)+' محصول بدون پسوند، دست‌نخورده می‌مانند':' · همهٔ محصولات پسوند دارند'),
    detail:[...eligible.slice(0,2).map((row:any)=>'مقایسه می‌شود: '+clipText(row.title,70)),
      ...local.filter((row:any)=>!hasCodeSuffix(String(row.title||''),patterns)).slice(0,2).map((row:any)=>'نادیده: '+clipText(row.title,70))]});
  if(zeroCountIds.size)p.emit({stage:'profiles-protected',name:'rule',count:zeroCountIds.size,
    summary:'محافظت: '+faN(zeroCountIds.size)+' پروفایل هیچ محصول فعالی ندارد (هنوز استخراج نشده)، پس هیچ اقدامی برایشان برنامه‌ریزی نمی‌شود',
    detail:[...zeroCountIds].slice(0,5).map(id=>clipText(profileNames[id]||id,40))});
  const accounts=await reconAccounts();
  p.emit({stage:'accounts-listed',name:'accounts',total:accounts.length,
    summary:'مقصدهای فعال: '+faN(accounts.length)+' · هر مقصد جداگانه خوانده و با همین '+faN(eligible.length)+' محصول محلی مقایسه می‌شود',
    detail:accounts.map(a=>a.name+' — '+(a.target==='woo'?'ووکامرس':'باسلام')+' (کلید '+clipText(a.accountKey,18)+')')});
  // ۱.۳۴۱.۰ — همهٔ مقصدها هم‌زمان خوانده می‌شوند: ووکامرس و هر غرفهٔ باسلام با هم شروع می‌کنند و
  // هرکدام زودتر پاسخ داد، همان لحظه مقایسه می‌شود و سطرهایش به جدول زنده می‌روند. ترتیب سطرهای
  // گزارش نهایی همان ترتیب مقصدهاست تا شمارش‌ها قطعی بماند.
  const rows: UnifiedReconRow[]=[]; const failures: Array<{account:string;error:string}>=[];
  let totalFetched=0,runningTally:Record<string,number>={},streamed=0,finished=0;
  const perAccount:UnifiedReconRow[][]=accounts.map(()=>[]);
  p.emit({stage:'accounts-parallel',name:'accounts',count:accounts.length,total:accounts.length,
    summary:'هر '+faN(accounts.length)+' مقصد هم‌زمان خوانده می‌شوند (نه یکی‌یکی) و هر مقصد صفحه‌های ۱۰۰تایی را '+faN(LEDGER_PAGE_PARALLEL)+'تا‌'+faN(LEDGER_PAGE_PARALLEL)+'تا موازی می‌گیرد · هر پاسخی زودتر برسد، همان لحظه در جدول می‌نشیند',
    accounts:accounts.map(a=>({target:a.target,accountKey:a.accountKey,name:a.name})),
    detail:accounts.map(a=>'هم‌زمان شروع شد: '+a.name+' — '+(a.target==='woo'?'ووکامرس':'باسلام'))});
  await Promise.all(accounts.map(async(account,idx)=>{
    p.emit({stage:'account-start',name:'account',account:account.name,target:account.target,accountKey:account.accountKey,count:idx+1,total:accounts.length,tally:runningTally,
      summary:'مقصد '+faN(idx+1)+' از '+faN(accounts.length)+': '+account.name+' ('+(account.target==='woo'?'ووکامرس':'باسلام')+') — هم‌زمان با بقیهٔ مقصدها شروع شد'});
    try{
      const readStart=p.elapsed();let pagesSeen=0;
      const remote=await remoteForAccount(account,false,(e)=>{if(String(e?.type||'').startsWith('ledger-page'))pagesSeen=Math.max(pagesSeen,Number(e?.page)||0);p.ledger(account.name,e,account.target)});
      const readMs=p.elapsed()-readStart;
      totalFetched+=remote.length;
      p.emit({stage:'account-fetched',name:'account',account:account.name,target:account.target,count:remote.length,total:totalFetched,tally:runningTally,
        summary:account.name+': '+faN(remote.length)+' محصول قابل فروش خوانده شد در '+faDuration(readMs)+' ('+throughput(remote.length,readMs)+') · مجموع خوانده‌شده تا اینجا '+faN(totalFetched),
        detail:[sourceNote(pagesSeen,pagesSeen===0),
          ...remote.slice(0,3).map((item:any)=>'نمونهٔ مقصد: '+clipText(item?.name??item?.title,46)+' · '+faPrice(item?.price)+(item?.id?' · شناسه '+faN(item.id):''))]});
      const compareStart=p.elapsed();
      const reconciled=reconcileAccount(local,remote,account,profileNames,suffixFormats,{profiles:profilesInfo,zeroCountIds,profileFilter:profileId});
      // Stream the comparison in small batches: a long destination now scrolls past product by
      // product with its running totals, instead of jumping from «started» to «finished».
      // Fine-grained for a small destination, bounded for a huge one: at most ~40 batches each.
      const CHUNK=Math.max(10,Math.ceil(reconciled.length/40));
      for(let at=0;at<reconciled.length;at+=CHUNK){
        const batch=reconciled.slice(at,at+CHUNK);
        runningTally=mergeTally(runningTally,bucketTally(batch));
        p.emit({stage:'compare',name:'compare',account:account.name,target:account.target,count:Math.min(at+CHUNK,reconciled.length),total:reconciled.length,tally:runningTally,
          summary:account.name+': '+faN(Math.min(at+CHUNK,reconciled.length))+' از '+faN(reconciled.length)+' محصول مقایسه شد · '+tallySummary(bucketTally(batch)),
          detail:sampleLines(batch,3)});
        // 1.338.0 — the compared rows themselves, so the panel's matrix fills while the run is
        // still going instead of appearing only at the end.
        onProgress?.({type:'partial',stage:'rows-chunk',account:account.name,target:account.target,
          rows:liveRows(batch),rowsCount:Math.min(at+CHUNK,reconciled.length),total:reconciled.length,totalRows:streamed+Math.min(at+CHUNK,reconciled.length)});
      }
      perAccount[idx]=reconciled;streamed+=reconciled.length;
      const tally=bucketTally(reconciled);
      const compareMs=p.elapsed()-compareStart;
      // One event per kind of difference, each with its own arithmetic.
      for(const [bucket,label] of [['priceDiff','اختلاف قیمت'],['missing','در مقصد نیست'],['extra','فقط در مقصد'],['noPrice','بدون قیمت مبدأ']] as Array<[string,string]>){
        if(!tally[bucket])continue;
        p.emit({stage:'bucket-'+bucket,name:'bucket',account:account.name,target:account.target,count:tally[bucket],total:reconciled.length,tally:runningTally,
          summary:account.name+' · '+label+': '+faN(tally[bucket])+' مورد'+(bucket==='priceDiff'?' (قیمت مقصد با قیمت انتظاری این مقصد فرق دارد)':bucket==='missing'?' (در مبدأ هست، در مقصد نیست)':bucket==='extra'?' (در مقصد هست، در مبدأ نیست — فقط گزارش می‌شود)':' (قیمت مبدأ خوانده نشده، پس مقایسه نشد)'),
          detail:bucketLines(reconciled,bucket,4)});
      }
      p.emit({stage:'match-methods',name:'match',account:account.name,target:account.target,count:reconciled.length,total:remote.length,tally:runningTally,
        summary:account.name+' · چگونه محصول‌ها جفت شدند (از '+faN(remote.length)+' محصول مقصد)',
        detail:matchLines(reconciled)});
      if(tally.matched)p.emit({stage:'bucket-matched',name:'bucket',status:'success',account:account.name,target:account.target,count:tally.matched,total:reconciled.length,tally:runningTally,
        summary:account.name+' · هماهنگ: '+faN(tally.matched)+' محصول دقیقاً همان قیمتی را دارند که باید (نمونه‌ها در پایین، برای اطمینان از درستی مقایسه)',
        detail:matchedProofLines(reconciled,4)});
      finished++;
      p.emit({stage:'account-done',name:'account',status:'success',account:account.name,target:account.target,accountKey:account.accountKey,count:reconciled.length,total:reconciled.length,tally:runningTally,
        summary:account.name+' تمام شد ('+faN(finished)+' از '+faN(accounts.length)+' مقصد) · خواندن '+faDuration(readMs)+' + مقایسه '+faDuration(compareMs)+' · '+tallySummary(tally),
        detail:sampleLines(reconciled,4)});
      if(reconciled.length){
        // سطرها همین حالا دسته‌دسته (rows-chunk) رفته‌اند؛ این رویداد فقط شمارش پایانی مقصد است.
        onProgress?.({type:'partial',stage:'rows-partial',account:account.name,target:account.target,rowsCount:reconciled.length,totalRows:streamed});
      }
    }catch(error){
      const message=msg(error);
      failures.push({account:account.name,error:message});
      const fallback=unreachableAccountRows(local,account,profileNames,suffixFormats,message);
      perAccount[idx]=fallback;streamed+=fallback.length;finished++;
      runningTally=mergeTally(runningTally,bucketTally(fallback));
      onProgress?.({type:'partial',stage:'rows-chunk',account:account.name,target:account.target,
        rows:liveRows(fallback),rowsCount:fallback.length,total:fallback.length,totalRows:streamed});
      p.emit({stage:'account-error',name:'account',status:'error',account:account.name,target:account.target,accountKey:account.accountKey,count:fallback.length,total:accounts.length,tally:runningTally,
        summary:account.name+' پاسخ نداد: '+clipText(message,90)+' — '+faN(fallback.length)+' محصول این مقصد «پاسخ نداد» علامت خوردند و گزارش «هماهنگ» اعلام نمی‌شود',
        detail:['علت خام: '+clipText(message,120),'راه‌حل: «تازه‌سازی دفتر حساب» یا بررسی اتصال این مقصد در بخش اتصال‌ها']});
    }
  }));
  for(const list of perAccount)rows.push(...list);

  p.emit({stage:'plan-building',name:'plan',count:rows.length,tally:runningTally,
    summary:'ساخت برنامهٔ اقدام از '+faN(rows.length)+' سطر مقایسه‌شده…'});
  const plan=reconPlan(rows,suffixFormats,{profiles:profilesInfo,zeroCountIds});
  const planByAccount=new Map<string,number>();
  for(const action of plan.applicable)planByAccount.set(String(action.accountName||action.target),(planByAccount.get(String(action.accountName||action.target))||0)+1);
  p.emit({stage:'plan-ready',name:'plan',status:'success',count:plan.applicable.length,total:plan.all.length,tally:runningTally,
    summary:'برنامهٔ اجرا آماده شد: '+faN(plan.applicable.length)+' اقدام قابل‌اجرا ('+faN(plan.counts.updatePrice)+' اصلاح قیمت، '+faN(plan.counts.create)+' ساخت دوباره)'+(plan.counts.remove?' · '+faN(plan.counts.remove)+' مورد فقط گزارش می‌شود و هرگز حذف نمی‌شود':''),
    detail:plan.applicable.slice(0,6).map(actionLine)});
  if(planByAccount.size)p.emit({stage:'plan-by-destination',name:'plan',count:plan.applicable.length,tally:runningTally,
    summary:'تقسیم اقدام‌ها بین مقصدها',
    detail:[...planByAccount.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,count])=>clipText(name,34)+': '+faN(count)+' اقدام')});
  const report={
    ok:failures.length===0,at:new Date().toISOString(),profileId,
    local:eligible.length,localAll:local.length,skippedNoCode,suffixFormats,accounts:accounts.length,
    zeroCountProfiles:[...zeroCountIds],
    protectedBySuffix:true,
    ...summarize(rows),accountsBreakdown:byAccount(rows),profiles:byProfile(rows),
    // planned = exactly what «اعمال هماهنگ‌سازی» will do; removals are reported, never applied.
    actions:plan.all.length,planned:plan.applicable.length,plannedPrice:plan.counts.updatePrice,
    plannedCreate:plan.counts.create,plannedRemove:plan.counts.remove,planNote:PLAN_NOTE,
    failures,rows,
  };
  const profileGroups=byProfile(rows);
  if(profileGroups.length)p.emit({stage:'profiles-summary',name:'report',count:profileGroups.length,tally:bucketTally(rows),
    summary:'نتیجه به تفکیک پروفایل ('+faN(profileGroups.length)+' پروفایل)',
    detail:profileLines(profileGroups,5)});
  const finalTally=bucketTally(rows);
  p.emit({stage:'report-ready',name:'report',status:'success',count:rows.length,total:rows.length,tally:finalTally,
    summary:'مقایسه تمام شد در '+faDuration(p.elapsed())+' · '+tallySummary(finalTally)+' · اقدام قابل اجرا: '+faN(plan.applicable.length),
    detail:[
      (failures.length?'مقصد بی‌پاسخ: '+faN(failures.length)+' — '+clipText(failures.map(f=>f.account).join('، '),80):'همهٔ '+faN(accounts.length)+' مقصد پاسخ دادند'),
      'محصول محلی '+faN(local.length)+' · قابل مقایسه '+faN(eligible.length)+' · خوانده‌شده از مقصدها '+faN(totalFetched)+' · سطر مقایسه '+faN(rows.length),
      'اصلاح قیمت: '+faN(plan.counts.updatePrice)+' · ساخت دوباره: '+faN(plan.counts.create)+' · فقط گزارش: '+faN(plan.counts.remove),
      'سرعت کلی: '+throughput(totalFetched,p.elapsed()),
      (plan.applicable.length?'قدم بعدی: دکمهٔ «اعمال هماهنگ‌سازی» همین '+faN(plan.applicable.length)+' اقدام را اجرا می‌کند':'قدم بعدی لازم نیست؛ مبدأ و مقصد هماهنگ‌اند')]});
  await setState('recon_unified',report);
  return report;
}

/**
 * Apply the differences the table found. Price mismatches are pushed to the
 * destination; products missing at a destination are re-published through the
 * normal sync path so category/photo/stock rules stay identical. Products that
 * exist only at the destination are reported but never auto-deleted.
 */
export async function unifiedReconApply(profileId = '', apply = false, limit = 200, onProgress?: (e: any) => void) {
  const p=createReconProgress(onProgress);
  const step=(event:any)=>{try{onProgress?.(event)}catch{}};
  const phases=apply?4:2;
  p.emit({stage:'apply-start',name:'apply',summary:(apply?'شروع اعمال هماهنگ‌سازی':'شروع پیش‌نمایش هماهنگ‌سازی (هیچ چیزی در مقصد تغییر نمی‌کند)')+' · سقف هر نوبت '+faN(Math.max(1,Math.min(1000,Number(limit)||200)))+' اقدام'});
  if(apply){
    p.emit({stage:'ledger-refresh',name:'ledger',summary:'مرحلهٔ ۱ از '+faN(phases)+': تازه‌سازی اجباری دفتر همهٔ مقصدها تا اعمال روی داده‌های کهنه انجام نشود…'});
    await refreshDestinationLedger(true,(e:any)=>{const d=describeLedgerEvent(e,String(e?.account||''));if(d)p.emit({...d,stage:'ledger-refresh'});});
    p.emit({stage:'ledger-refresh-done',name:'ledger',status:'success',summary:'دفتر مقصدها تازه شد در '+faDuration(p.elapsed())});
  }
  p.emit({stage:'recon-start',name:'recon',summary:'مرحلهٔ '+faN(apply?2:1)+' از '+faN(phases)+': مقایسهٔ کامل محصولات محلی با محصولات هر مقصد…'});
  const report=await unifiedReconLive(profileId,(e:any)=>step(e));
  const allProfilesRaw=await listProfiles();
  const profilesInfo:ProfileSuffixInfo[]=allProfilesRaw.map((p:any)=>({id:String(p.id),name:String(p.name||p.id),titleSuffix:String(p.titleSuffix||'')}));
  const zeroCountIds=new Set<string>(Array.isArray((report as any).zeroCountProfiles)?(report as any).zeroCountProfiles:[]);
  // Preview and apply share one plan, so the number on screen is the number that runs.
  const plan=reconPlan(report.rows as UnifiedReconRow[],report.suffixFormats,{profiles:profilesInfo,zeroCountIds});
  const cap=Math.max(1,Math.min(1000,Number(limit)||200));
  // ۱.۳۴۰.۰ — همان ترتیبی که در جدول دیده می‌شود: اول اصلاح قیمت‌ها، بعد ساخت دوباره، هر کدام
  // به‌ترتیب نام محصول؛ پس «اجرا از ردیف اول» دقیقاً همان چیزی است که اتفاق می‌افتد.
  const ordered=planOrder(plan.applicable);
  const actions=ordered.slice(0,cap);
  const remaining=Math.max(0,plan.applicable.length-actions.length);
  const planDetail=ordered.slice(0,6).map(actionLine);
  p.emit({stage:'plan-ready',name:'plan',status:'success',count:plan.applicable.length,total:plan.all.length,
    summary:(apply?'برنامهٔ اجرا آماده شد':'پیش‌نمایش آماده شد')+' در '+faDuration(p.elapsed())+' · '+faN(plan.applicable.length)+' اقدام قابل‌اجرا ('+faN(plan.counts.updatePrice)+' اصلاح قیمت، '+faN(plan.counts.create)+' ساخت دوباره)'+(plan.removals.length?' · '+faN(plan.removals.length)+' مورد فقط-در-مقصد که اعمال هرگز حذفشان نمی‌کند':''),
    detail:planDetail.length?planDetail:['هیچ اقدامی لازم نیست؛ همه‌چیز هماهنگ است.']});
  const shared={matched:report.matched,priceDiff:report.priceDiff,missing:report.missing,extra:report.extra,
    noPrice:report.noPrice,unreachable:report.unreachable,inSync:report.inSync,local:report.local,localAll:report.localAll,
    skippedNoCode:report.skippedNoCode,accounts:report.accounts,accountsBreakdown:report.accountsBreakdown,
    profiles:report.profiles,failures:report.failures,plannedRemove:plan.removals.length,planNote:PLAN_NOTE};
  if(!apply)return{ok:true,dryRun:true,planned:plan.applicable.length,willApply:actions.length,remaining,
    plannedPrice:plan.counts.updatePrice,plannedCreate:plan.counts.create,
    actions:actions.slice(0,200),...shared,rows:report.rows};
  p.emit({stage:'apply-run',name:'apply',summary:'مرحلهٔ ۳ از '+faN(phases)+': اجرای '+faN(actions.length)+' اقدام از '+faN(plan.applicable.length)+(remaining?' (بقیه در نوبت بعد: '+faN(remaining)+')':'')});
  let changed=0,created=0;const failed:any[]=[];
  const products=new Map<string,any>();
  for(let index=0;index<actions.length;index++){
    const action=actions[index];
    p.emit({stage:'apply',name:'apply',count:index+1,total:actions.length,account:action.accountName,target:action.target,profileId:action.profileId,sourceKey:action.sourceKey,accountKey:action.accountKey,price:action.toPrice,
      summary:'اقدام '+faN(index+1)+' از '+faN(actions.length)+' در '+clipText(action.accountName||action.target,40)+': '+actionLine(action)});
    try{
      if(action.kind==='updatePrice'&&action.remoteId&&action.toPrice){
        if(action.target==='woo')await wooUpdate(action.remoteId,{regular_price:String(action.toPrice)});
        else await basalamUpdateShop(action.accountKey,action.remoteId,{primary_price:action.toPrice});
        changed++;
        p.emit({stage:'apply-written',name:'apply',status:'success',count:index+1,total:actions.length,account:action.accountName,target:action.target,profileId:action.profileId,sourceKey:action.sourceKey,accountKey:action.accountKey,price:action.toPrice,
          summary:'نوشته شد: '+clipText(action.title,60)+' · قیمت مقصد از '+faPrice(action.fromPrice)+' به '+faPrice(action.toPrice)+' تغییر کرد (شناسه '+faN(action.remoteId)+')'});
      }else if(action.kind==='create'){
        const key=`${action.profileId}\u0000${action.sourceKey}`;
        if(!products.has(key))products.set(key,await getProduct(action.profileId,action.sourceKey));
        const product=products.get(key);
        const profile=await getProfile(action.profileId);
        if(!product||!profile){failed.push({title:action.title,error:'محصول یا پروفایل پیدا نشد'});continue}
        p.emit({stage:'create',name:'create',count:index+1,total:actions.length,account:action.accountName,target:action.target,profileId:action.profileId,sourceKey:action.sourceKey,accountKey:action.accountKey,
          summary:'ساخت دوباره در '+(action.target==='woo'?'ووکامرس':'باسلام')+': '+clipText(action.title,60)+' (پروفایل '+clipText(profile.name||action.profileId,30)+')'});
        if(action.target==='woo')await syncWoo(product,profile);else await syncBasalam(product,profile);
        created++;changed++;
        p.emit({stage:'create-done',name:'create',status:'success',count:index+1,total:actions.length,account:action.accountName,target:action.target,profileId:action.profileId,sourceKey:action.sourceKey,accountKey:action.accountKey,
          summary:'ساخته شد: '+clipText(action.title,60)+' · قیمت ارسالی '+faPrice(action.toPrice||product.price)});
      }
    }catch(error){
      const message=msg(error);
      failed.push({title:action.title,account:action.accountName,error:message});
      p.emit({stage:'apply-error',name:'apply',status:'error',count:index+1,total:actions.length,account:action.accountName,target:action.target,profileId:action.profileId,sourceKey:action.sourceKey,accountKey:action.accountKey,
        summary:'ناموفق: '+clipText(action.title,60)+' — '+clipText(message,90)});
    }
  }
  p.emit({stage:'apply-done',name:'apply',status:failed.length?'error':'success',count:actions.length,total:actions.length,
    summary:'اجرا تمام شد در '+faDuration(p.elapsed())+' · نوشته‌شده '+faN(changed)+' · ساخته‌شده '+faN(created)+' · ناموفق '+faN(failed.length),
    detail:failed.slice(0,4).map((f:any)=>'✖ '+clipText(f.title,50)+' — '+clipText(f.error,80))});
  if(changed)p.emit({stage:'verify-start',name:'verify',summary:'مرحلهٔ ۴ از '+faN(phases)+': مقایسهٔ دوباره برای تأیید اینکه نوشتن‌ها واقعاً در مقصد ثبت شده‌اند…'});
  else p.emit({stage:'verify-skip',name:'verify',status:'success',summary:'چیزی در مقصد نوشته نشد، پس مقایسهٔ دوباره لازم نیست.'});
  const after=changed?await unifiedReconLive(profileId,(e:any)=>step({...e,stage:'verify-'+(e.stage||'')})):report;
  const notes:string[]=[];
  if(created)notes.push(fa0(created)+' محصول نبود-در-مقصد همین‌جا ساخته شد.');
  if(remaining)notes.push(fa0(remaining)+' اقدام به‌خاطر سقف هر نوبت باقی ماند؛ دوباره «اعمال هماهنگ‌سازی» را بزنید.');
  if(plan.removals.length)notes.push(PLAN_NOTE);
  if(!changed&&!failed.length)notes.push('هیچ اقدام قابل‌اجرایی وجود نداشت.');
  p.emit({stage:'report-ready',name:'report',status:failed.length?'error':'success',count:changed,total:actions.length,
    summary:'پایان در '+faDuration(p.elapsed())+' · هماهنگ '+faN(after.matched)+' · اختلاف قیمت '+faN(after.priceDiff)+' · در مقصد نیست '+faN(after.missing)+' · فقط در مقصد '+faN(after.extra),
    detail:notes.slice(0,4)});
  return{ok:failed.length===0,dryRun:false,planned:plan.applicable.length,processed:actions.length,changed,
    created,queuedJobs:0,queuedProducts:0,remaining,failed:failed.slice(0,20),note:notes.join(' '),
    matched:after.matched,priceDiff:after.priceDiff,missing:after.missing,extra:after.extra,
    noPrice:after.noPrice,unreachable:after.unreachable,inSync:after.inSync,local:after.local,localAll:after.localAll,
    skippedNoCode:after.skippedNoCode,accounts:after.accounts,accountsBreakdown:after.accountsBreakdown,
    profiles:after.profiles,failures:after.failures,plannedRemove:plan.removals.length,planNote:PLAN_NOTE,
    verified:changed>0,rows:after.rows};
}

/**
 * Request 36b — duplicate cleanup across EVERY destination (Node runtime twin of
 * the Worker implementation). Groups destination listings by their «(کد ایکس)»-
 * stripped title and plans deletion of all but the most expensive copy.
 * Local scraped products are never touched.
 */
export async function destinationDuplicates(apply = false, limit = 200, keep: 'expensive' | 'cheapest' = 'expensive', accountKey = '', onProgress?: (e: any) => void) {
  const step=(event:any)=>{try{onProgress?.(event)}catch{}};
  const p=createReconProgress(onProgress);
  const keepLabel=keep==='cheapest'?'ارزان‌ترین نسخه نگه داشته می‌شود':'گران‌ترین نسخه نگه داشته می‌شود';
  p.emit({stage:'start',name:'duplicates',summary:(apply?'شروع حذف تکراری‌ها':'شروع بررسی تکراری‌ها (هیچ چیزی حذف نمی‌شود)')+' · '+keepLabel});
  const accounts = (await reconAccounts()).filter(a => !accountKey || String(a.accountKey) === String(accountKey));
  const settings = await getState<any>('settings', {});
  const suffixFormats = (settings as any)?.dedup?.suffixFormats || '';
  const actions: any[] = [], failures: any[] = [];
  p.emit({stage:'accounts-listed',name:'accounts',total:accounts.length,
    summary:'مقصدهای بررسی‌شونده: '+faN(accounts.length)+(accountKey?' (فقط حساب انتخاب‌شده)':''),
    detail:accounts.map(a=>a.name+' — '+(a.target==='woo'?'ووکامرس':'باسلام'))});
  for (let index = 0; index < accounts.length; index++) {
    const account = accounts[index];
    p.emit({stage:'account-start',name:'scan',account:account.name,target:account.target,count:index+1,total:accounts.length,
      summary:'مقصد '+faN(index+1)+' از '+faN(accounts.length)+': '+account.name+' — خواندن فهرست محصولات'+(apply?' (تازه‌سازی اجباری دفتر)':'')+'…'});
    try {
      const remotes = await remoteForAccount(account,apply,(e:any)=>p.ledger(account.name,e,account.target));
      const planned = planDuplicateDeletions(remotes, account, suffixFormats, keep);
      actions.push(...planned);
      p.emit({stage:'account-done',name:'scan',status:'success',account:account.name,target:account.target,count:index+1,total:accounts.length,
        summary:account.name+': '+faN(remotes.length)+' محصول خوانده شد · '+faN(planned.length)+' نسخهٔ تکراری برای حذف شناسایی شد (در '+faDuration(p.elapsed())+')',
        detail:planned.slice(0,4).map((a:any)=>clipText(a.title,60)+' · '+faPrice(a.price)+(a.remoteId?' (شناسه '+faN(a.remoteId)+')':''))});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ account: account.name, error: message });
      p.emit({stage:'account-error',name:'scan',status:'error',account:account.name,target:account.target,count:index+1,total:accounts.length,
        summary:account.name+' خوانده نشد: '+clipText(message,110)+' — تکراری‌های این مقصد در این نوبت بررسی نشدند'});
    }
  }
  const byDestination = accounts.map(account => ({
    account: account.name, accountKey: account.accountKey, target: account.target,
    duplicates: actions.filter(a => String(a.accountKey) === String(account.accountKey) && a.target === account.target).length,
  }));
  p.emit({stage:'plan-ready',name:'plan',status:'success',count:actions.length,total:accounts.length,
    summary:'بررسی '+faN(accounts.length)+' مقصد در '+faDuration(p.elapsed())+' تمام شد · '+faN(actions.length)+' نسخهٔ تکراری برای حذف'+(failures.length?' · '+faN(failures.length)+' مقصد پاسخ نداد':''),
    detail:byDestination.map((d:any)=>d.account+': '+faN(d.duplicates)+' تکراری')});
  const capped = actions.slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
  if (!apply) return { source: 'ledger', ok: failures.length === 0, dryRun: true, keep, planned: actions.length, willDelete: capped.length,
    remaining: Math.max(0, actions.length - capped.length), accounts: accounts.length, byDestination, failures, actions: capped.slice(0, 200) };
  let deleted = 0, archived = 0; const failed: any[] = [];
  for (let index = 0; index < capped.length; index++) {
    const action = capped[index];
    p.emit({stage:'delete',name:'delete',count:index+1,total:capped.length,account:action.accountName,target:action.target,
      summary:'حذف '+faN(index+1)+' از '+faN(capped.length)+': '+clipText(action.title,60)+' · '+faPrice(action.price)+' (شناسه '+faN(action.remoteId)+')'});
    try {
      const result = await destinationDelete(action.target, action.remoteId, true, action.target === 'basalam' ? action.accountKey : '');
      if((result as any)?.archived)archived++;else deleted++;
      p.emit({stage:'delete-done',name:'delete',status:'success',count:index+1,total:capped.length,account:action.accountName,target:action.target,
        summary:((result as any)?.archived?'بایگانی شد (مقصد اجازهٔ حذف کامل نداد): ':'حذف شد: ')+clipText(action.title,60)+' (شناسه '+faN(action.remoteId)+')'});
    } catch (error) { failed.push({ title: action.title, account: action.accountName, id: action.remoteId, error: error instanceof Error ? error.message : String(error) }); }
  }
  p.emit({stage:'report-ready',name:'report',status:failed.length||failures.length?'error':'success',count:deleted+archived,total:capped.length,
    summary:'پایان در '+faDuration(p.elapsed())+' · حذف‌شده '+faN(deleted)+' · بایگانی‌شده '+faN(archived)+' · ناموفق '+faN(failed.length)+' · باقی‌مانده '+faN(Math.max(0,actions.length-capped.length)),
    detail:failed.slice(0,4).map((f:any)=>'✖ '+clipText(f.title,50)+' — '+clipText(f.error,80))});
  return { source: 'ledger', ok: failed.length === 0 && failures.length === 0, dryRun: false, keep, planned: actions.length, processed: capped.length,
    deleted, archived, remaining: Math.max(0, actions.length - capped.length), accounts: accounts.length, byDestination, failures, failed: failed.slice(0, 20), actions: capped.slice(0, 200) };
}
async function rawbasalamUpdateShop(accountKey:string,id:number|string,payload:any){
  const c=(await loadConnections()).basalam;
  const shop=String(accountKey)===String(c.vendorId)?{token:c.token,vendorId:String(c.vendorId)}:(c.shops||[]).find(s=>String(s.vendorId)===String(accountKey));
  if(!shop?.token)throw Error('توکن این غرفه در دسترس نیست');
  // 1.328.0 — same destination feedback loop as the sender: the gateway edits by product id,
  // the vendor-scoped path is only a legacy fallback, and the winner is remembered.
  const report=await runApiWriteLoop({getState,setState,transport:async({url,method})=>{
    const r=await safeBasalamFetch(url,{method,headers:{authorization:`Bearer ${shop.token}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},3_000_000);
    return{status:r.status,body:await r.json().catch(()=>({}))};
  }},{kind:'update',context:{base:normalizeApiBase(String(c.api||'')),vendorId:shop.vendorId,productId:id}});
  if(!report.ok)throw Error(`Basalam update ${id}: HTTP ${report.status} — ${report.advice} [${summarizeApiAttempts(report.attempts)}]`);
}

/** Single-destination table, kept for the existing per-target buttons.
 * Same legacy scope as the Worker's reconTable (PHP v10.170 parity): every
 * product is compared, raw price against raw price, with no code-suffix
 * filtering — the unified table is the filtered, adjustment-aware one. */
const reconPrice = (value: unknown): number | null => { const n = Math.round(Number(value) || 0); return n > 0 ? n : null; };
export async function reconTable(target: 'woo' | 'basalam', profileId = '') {
  const allProfilesRaw=await listProfiles();
  const local = await maintenanceRows(profileId), remote = await remoteProducts(target);
  const settings=await getState<any>('settings',{});
  const suffixFormats=settings?.dedup?.suffixFormats||'';
  const profilesInfo:ProfileSuffixInfo[]=allProfilesRaw.map((p:any)=>({id:String(p.id),name:String(p.name||p.id),titleSuffix:String(p.titleSuffix||'')}));
  let allLocalForCounts:any[];
  if(profileId) allLocalForCounts=await maintenanceRows('') as any[];
  else allLocalForCounts=local as any[];
  const counts=new Map<string,number>();
  for(const row of allLocalForCounts){
    if(row.active===false||row.active===0)continue;
    const pid=String(row.profile_id||'');
    counts.set(pid,(counts.get(pid)||0)+1);
  }
  const zeroCountIds=new Set<string>();
  for(const p of profilesInfo){ if((counts.get(p.id)||0)===0) zeroCountIds.add(p.id); }

  const shouldIgnoreForFilter=(title:string):boolean=>{
    if(!profileId) return false;
    const owner=findProfileBySuffix(String(title||''),profilesInfo,suffixFormats);
    if(owner) return owner.id!==profileId;
    const filterProfile=profilesInfo.find(p=>p.id===profileId);
    const filterSuffix=String(filterProfile?.titleSuffix||'').trim();
    if(filterSuffix) return true;
    return false;
  };
  const isZeroCountOwner=(title:string):boolean=>{
    const owner=findProfileBySuffix(String(title||''),profilesInfo,suffixFormats);
    if(owner && zeroCountIds.has(owner.id)) return true;
    if(!owner){
      const hasEmptyZero=profilesInfo.some(p=>!String(p.titleSuffix||'').trim() && zeroCountIds.has(p.id));
      if(hasEmptyZero) return true;
    }
    return false;
  };

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
    if(shouldIgnoreForFilter(String(item.name||(item as any).title||''))) continue;
    const key = reconNormTitle(item.name || (item as any).title || '');
    let source = (byTitle.get(key) || []).find(row => !consumed.has(row)) || null, matchedBy = source ? 'title' : 'none';
    if (!source && item.sku && bySku.has(item.sku)) { const candidate = bySku.get(item.sku); if (!consumed.has(candidate)) { source = candidate; matchedBy = 'sku'; } }
    if (!source && byRemoteId.has(item.id)) { const candidate = byRemoteId.get(item.id); if (!consumed.has(candidate)) { source = candidate; matchedBy = 'id'; } }
    const remotePrice = reconPrice(item.price);
    if (!source) {
      if(isZeroCountOwner(String(item.name||(item as any).title||''))) continue;
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
  const report = { ok: true, target, at: new Date().toISOString(), profileId, local: local.length, remote: remote.length, zeroCountProfiles:[...zeroCountIds], protectedBySuffix:true, ...summary, inSync, matchedByTitle, matchedBySku, matchedById, rows };
  await setState(`recon_table_${target}`, report);
  return report;
}


export async function reconTableLive(target:'woo'|'basalam',profileId='',onProgress?:(e:any)=>void){
  const p=createReconProgress(onProgress);
  const targetName=target==='woo'?'ووکامرس':'باسلام';
  p.emit({stage:'local-loading',name:'local',target,summary:'خواندن محصولات محلی برای مقایسه با '+targetName+'…'});
  const allProfilesRaw=await listProfiles();
  const local=await maintenanceRows(profileId);
  p.emit({stage:'local-loaded',name:'local',target,count:local.length,summary:'محصولات محلی: '+faN(local.length)+' مورد'});
  let remote:any[]=[];
  try{
    const accounts=await reconAccounts();
    const matchedAccounts=accounts.filter(a=>a.target===target);
    if(matchedAccounts.length){
      p.emit({stage:'accounts-listed',name:'accounts',target,total:matchedAccounts.length,summary:'حساب‌های '+targetName+': '+faN(matchedAccounts.length),detail:matchedAccounts.map(a=>a.name)});
      for(let i=0;i<matchedAccounts.length;i++){
        const acc=matchedAccounts[i];
        p.emit({stage:'account-start',name:'account',account:acc.name,target,count:i+1,total:matchedAccounts.length,summary:'حساب '+faN(i+1)+' از '+faN(matchedAccounts.length)+': '+acc.name+' — شروع خواندن'});
        const part=await remoteForAccount(acc,false,(e)=>p.ledger(acc.name,e,target));
        remote.push(...part);
        p.emit({stage:'account-done',name:'account',status:'success',account:acc.name,target,count:part.length,summary:acc.name+': '+faN(part.length)+' محصول خوانده شد · مجموع '+faN(remote.length)});
      }
    }else{
      p.emit({stage:'remote-direct',name:'remote',target,summary:'حسابی برای '+targetName+' تنظیم نشده؛ محصولات مستقیم از API خوانده می‌شوند…'});
      remote=await remoteProducts(target);
    }
  }catch{
    p.emit({stage:'remote-fallback',name:'remote',status:'error',target,summary:'خواندن از دفتر حساب ناموفق بود؛ همین حالا مستقیم از '+targetName+' خوانده می‌شود…'});
    remote=await remoteProducts(target);
  }
  p.emit({stage:'remote-loaded',name:'remote',status:'success',target,count:remote.length,summary:'محصولات '+targetName+': '+faN(remote.length)+' مورد خوانده شد در '+faDuration(p.elapsed())});

  const settings=await getState<any>('settings',{});
  const suffixFormats=settings?.dedup?.suffixFormats||'';
  const profilesInfo:ProfileSuffixInfo[]=allProfilesRaw.map((p:any)=>({id:String(p.id),name:String(p.name||p.id),titleSuffix:String(p.titleSuffix||'')}));
  let allLocalForCounts:any[];
  if(profileId) allLocalForCounts=await maintenanceRows('') as any[];
  else allLocalForCounts=local as any[];
  const counts=new Map<string,number>();
  for(const row of allLocalForCounts){
    if(row.active===false||row.active===0)continue;
    const pid=String(row.profile_id||'');
    counts.set(pid,(counts.get(pid)||0)+1);
  }
  const zeroCountIds=new Set<string>();
  for(const p of profilesInfo){ if((counts.get(p.id)||0)===0) zeroCountIds.add(p.id); }

  const shouldIgnoreForFilter=(title:string):boolean=>{
    if(!profileId) return false;
    const owner=findProfileBySuffix(String(title||''),profilesInfo,suffixFormats);
    if(owner) return owner.id!==profileId;
    const filterProfile=profilesInfo.find(p=>p.id===profileId);
    const filterSuffix=String(filterProfile?.titleSuffix||'').trim();
    if(filterSuffix) return true;
    return false;
  };
  const isZeroCountOwner=(title:string):boolean=>{
    const owner=findProfileBySuffix(String(title||''),profilesInfo,suffixFormats);
    if(owner && zeroCountIds.has(owner.id)) return true;
    if(!owner){
      const hasEmptyZero=profilesInfo.some(p=>!String(p.titleSuffix||'').trim() && zeroCountIds.has(p.id));
      if(hasEmptyZero) return true;
    }
    return false;
  };

  const rows:any[]=[];
  const byTitle=new Map<string,any[]>(),bySku=new Map<string,any>(),byRemoteId=new Map<number,any>();
  for(const row of local){
    const key=reconNormTitle(row.title);
    if(key){const list=byTitle.get(key)||[];list.push(row);byTitle.set(key,list)}
    const sku=row.data?.sku||`s4-${row.profile_id}-${row.source_key}`.slice(0,100);
    if(sku&&!bySku.has(sku))bySku.set(sku,row);
    let fromMapId=0;for(const m of (row.maps||[])){if(String(m.target||'')===target&&Number(m.remote_id)>0){fromMapId=Number(m.remote_id);break}}
    const mapped=fromMapId||(target==='woo'?Number(row.remote_woo_id||0):Number(row.remote_basalam_id||0));
    if(mapped>0&&!byRemoteId.has(mapped))byRemoteId.set(mapped,row);
  }
  const consumed=new Set<any>();
  let processed=0;
  for(const item of remote){
    if(shouldIgnoreForFilter(String(item.name||(item as any).title||''))) { processed++; continue; }
    const key=reconNormTitle(item.name||(item as any).title||'');
    let source=(byTitle.get(key)||[]).find(row=>!consumed.has(row))||null,matchedBy=source?'title':'none';
    if(!source&&item.sku&&bySku.has(item.sku)){const candidate=bySku.get(item.sku);if(!consumed.has(candidate)){source=candidate;matchedBy='sku'}}
    if(!source&&byRemoteId.has(item.id)){const candidate=byRemoteId.get(item.id);if(!consumed.has(candidate)){source=candidate;matchedBy='id'}}
    const remotePrice=reconPrice(item.price);
    if(!source){
      if(isZeroCountOwner(String(item.name||(item as any).title||''))) { processed++; continue; }
      rows.push({bucket:'extra',title:item.name||(item as any).title||'',remoteTitle:item.name||(item as any).title||'',remoteId:item.id||null,profileId:'',sourceKey:'',sourcePrice:null,remotePrice,delta:null,matchedBy:'none',shopId:String((item as any).shopId||''),shopName:String((item as any).shopName||''),status:String(item.status||''),why:'در هیچ پروفایل/مبدأ نیست'});
    }else{
      consumed.add(source);
      const sourcePrice=reconPrice(source.price);
      const base={title:source.title||'',remoteTitle:item.name||(item as any).title||'',remoteId:item.id||null,profileId:String(source.profile_id||''),sourceKey:String(source.source_key||''),sourcePrice,remotePrice,matchedBy,shopId:String((item as any).shopId||''),shopName:String((item as any).shopName||''),status:String(item.status||'')};
      if(sourcePrice===null)rows.push({...base,bucket:'noPrice',delta:null,why:'قیمت مبدأ ثبت نشده — مقایسه نشد'});
      else if(remotePrice!==sourcePrice)rows.push({...base,bucket:'priceDiff',delta:(remotePrice||0)-sourcePrice,why:'قیمت مقصد با مبدأ یکی نیست'});
      else rows.push({...base,bucket:'matched',delta:0,why:''});
    }
    processed++;
    if(processed%50===0){
      onProgress?.({type:'partial',stage:'rows-partial',target,processed,total:remote.length,rows:rows.slice(-50),rowsCount:rows.length});
      p.emit({stage:'compare',name:'compare',target,count:processed,total:remote.length,
        summary:'مقایسه: '+faN(processed)+' از '+faN(remote.length)+' محصول مقصد · '+tallySummary(bucketTally(rows)),detail:sampleLines(rows.slice(-50),3)});
    }
  }
  for(const row of local){
    if(consumed.has(row))continue;
    if(!row.active)continue;
    rows.push({bucket:'missing',title:row.title||'',remoteTitle:'',remoteId:null,profileId:String(row.profile_id||''),sourceKey:String(row.source_key||''),sourcePrice:reconPrice(row.price),remotePrice:null,delta:null,matchedBy:'none',shopId:'',shopName:'',status:'',why:'در مبدأ هست ولی در مقصد نیست'});
  }
  const count=(bucket:string)=>rows.filter(r=>r.bucket===bucket).length;
  const summary={matched:count('matched'),priceDiff:count('priceDiff'),extra:count('extra'),missing:count('missing'),noPrice:count('noPrice')};
  const matchedByTitle=rows.filter(r=>r.matchedBy==='title').length,matchedBySku=rows.filter(r=>r.matchedBy==='sku').length,matchedById=rows.filter(r=>r.matchedBy==='id').length;
  const inSync=summary.priceDiff===0&&summary.extra===0&&summary.missing===0;
  const report={ok:true,target,at:new Date().toISOString(),profileId,local:local.length,remote:remote.length,zeroCountProfiles:[...zeroCountIds],protectedBySuffix:true,...summary,inSync,matchedByTitle,matchedBySku,matchedById,rows};
  await setState(`recon_table_${target}`,report);
  p.emit({stage:'report-ready',name:'report',status:'success',target,count:rows.length,total:rows.length,
    summary:'جدول '+targetName+' آماده شد در '+faDuration(p.elapsed())+' · '+tallySummary(bucketTally(rows)),
    detail:sampleLines(rows,4)});
  return report;
}


export async function recon(target:'woo'|'basalam',profileId='',onProgress?:(e:any)=>void){
  const p=createReconProgress(onProgress);
  const targetName=target==='woo'?'ووکامرس':'باسلام';
  p.emit({stage:'local-loading',name:'local',target,summary:'نقشهٔ شناسه‌ها برای '+targetName+': خواندن محصولات محلی…'});
  const local=await maintenanceRows(profileId);
  p.emit({stage:'local-loaded',name:'local',target,count:local.length,summary:'محصولات محلی: '+faN(local.length)+' مورد'});
  p.emit({stage:'remote-loading',name:'remote',target,summary:'خواندن فهرست محصولات '+targetName+'…'});
  const remote=await remoteProducts(target);
  p.emit({stage:'remote-loaded',name:'remote',status:'success',target,count:remote.length,summary:'محصولات '+targetName+': '+faN(remote.length)+' مورد خوانده شد در '+faDuration(p.elapsed())});
  const byId=new Map(remote.map(x=>[x.id,x])),bySku=new Map(remote.filter(x=>x.sku).map(x=>[x.sku,x])),byName=new Map(remote.map(x=>[norm(x.name),x])),used=new Set<number>(),items:any[]=[];
  for(const row of local){const mapped=target==='woo'?Number(row.remote_woo_id||0):Number(row.remote_basalam_id||0),sku=row.data?.sku||`s4-${row.profile_id}-${row.source_key}`.slice(0,100);const match=byId.get(mapped)||bySku.get(sku)||byName.get(norm(row.title));if(match)used.add(match.id);items.push({profileId:row.profile_id,sourceKey:row.source_key,title:row.title,active:row.active,remoteId:match?.id||null,matchedBy:match?(match.id===mapped?'id':match.sku===sku?'sku':'title'):'none',remoteTitle:match?.name||''});
    if(items.length%100===0)p.emit({stage:'match',name:'match',target,count:items.length,total:local.length,summary:'تطبیق: '+faN(items.length)+' از '+faN(local.length)+' محصول محلی بررسی شد'});}
  const byIdCount=items.filter(x=>x.matchedBy==='id').length,bySkuCount=items.filter(x=>x.matchedBy==='sku').length,byTitleCount=items.filter(x=>x.matchedBy==='title').length;
  const result={target,at:new Date().toISOString(),local:local.length,remote:remote.length,matched:items.filter(x=>x.remoteId).length,missingRemote:items.filter(x=>!x.remoteId&&x.active).length,retired:items.filter(x=>!x.active).length,extraRemote:remote.filter(x=>!used.has(x.id)).map(x=>({id:x.id,title:x.name,status:x.status})),items};
  p.emit({stage:'report-ready',name:'report',status:'success',target,count:result.matched,total:local.length,
    summary:'نقشهٔ '+targetName+' آماده شد در '+faDuration(p.elapsed())+' · متصل '+faN(result.matched)+' · بدون جفت '+faN(result.missingRemote)+' · فقط در مقصد '+faN(result.extraRemote.length),
    detail:['تطبیق با شناسه: '+faN(byIdCount),'تطبیق با کد کالا: '+faN(bySkuCount),'تطبیق با عنوان: '+faN(byTitleCount),
      ...items.filter(x=>!x.remoteId&&x.active).slice(0,2).map((x:any)=>'بدون جفت: '+clipText(x.title,60))]});
  await setState(`recon_${target}`,result);return result;
}
export async function rebuildMap(target:'woo'|'basalam',profileId='',onProgress?:(e:any)=>void){
  const p=createReconProgress(onProgress);
  const targetName=target==='woo'?'ووکامرس':'باسلام';
  p.emit({stage:'start',name:'rebuild',summary:'بازسازی نقشهٔ شناسه‌های '+targetName+': اول مبدأ و مقصد مقایسه می‌شوند…'});
  const report=await recon(target,profileId,(e:any)=>{try{onProgress?.(e)}catch{}});
  let mapped=0;const samples:string[]=[];
  for(const item of report.items)if(item.remoteId){
    await setDestinationId(item.profileId,item.sourceKey,target,'default',item.remoteId);
    await setRemoteId(item.profileId,item.sourceKey,target,item.remoteId);
    mapped++;
    if(samples.length<4)samples.push(clipText(item.title,50)+' → شناسه '+faN(item.remoteId)+' (تطبیق با '+({id:'شناسه',sku:'کد کالا',title:'عنوان'} as Record<string,string>)[item.matchedBy]+')');
    if(mapped%50===0)p.emit({stage:'write',name:'rebuild',target,count:mapped,total:report.items.length,summary:'ذخیرهٔ نقشه: '+faN(mapped)+' شناسه نوشته شد'});
  }
  p.emit({stage:'report-ready',name:'report',status:'success',target,count:mapped,total:report.items.length,
    summary:'نقشهٔ '+targetName+' بازسازی شد در '+faDuration(p.elapsed())+' · '+faN(mapped)+' شناسه ذخیره شد · '+faN(report.items.length-mapped)+' محصول هنوز جفت ندارد',
    detail:samples});
  return{ok:true,target,mapped,unmatched:report.items.length-mapped};
}
export async function retire(target:'woo'|'basalam',profileId:string,action:string,apply=false){const rows=(await maintenanceRows(profileId)).filter(x=>!x.active),preview=rows.map(x=>({profileId:x.profile_id,sourceKey:x.source_key,title:x.title,remoteId:target==='woo'?x.remote_woo_id:x.remote_basalam_id,missingSince:x.missing_since,action}));if(!apply||action==='report')return{ok:true,dryRun:true,count:preview.length,items:preview};let changed=0,failed:any[]=[];for(const item of preview){if(!item.remoteId)continue;try{if(target==='woo')await wooUpdate(item.remoteId,action==='trash'?{status:'trash'}:{status:action==='draft'?'draft':'private'});else await basalamUpdate(item.remoteId,{status:action==='trash'?'archived':action});changed++}catch(error){failed.push({title:item.title,error:msg(error)})}}return{ok:failed.length===0,dryRun:false,changed,failed}}
export async function bulkEdit(target:'woo'|'basalam',input:any,apply=false){const rows=(await maintenanceRows(String(input.profileId||''))).filter(x=>x.active).filter(x=>!input.query||norm(x.title).includes(norm(input.query))).slice(0,Math.min(1000,Number(input.limit)||200)),items=rows.map(row=>{let title=String(row.title);if(input.prefix)title=String(input.prefix)+title;if(input.suffix)title+=String(input.suffix);let price=Number(row.price);if(Number(input.pricePercent))price=Math.round(price*(1+Number(input.pricePercent)/100));return{row,title,price,remoteId:target==='woo'?row.remote_woo_id:row.remote_basalam_id}});if(!apply)return{ok:true,dryRun:true,count:items.length,items:items.slice(0,100).map(x=>({title:x.row.title,newTitle:x.title,oldPrice:x.row.price,newPrice:x.price,remoteId:x.remoteId}))};let changed=0,failed:any[]=[];for(const item of items){if(!item.remoteId)continue;try{const payload:any={name:item.title};if(item.price)target==='woo'?payload.regular_price=String(item.price):payload.price=item.price;if(input.stock!==''&&input.stock!=null)target==='woo'?Object.assign(payload,{manage_stock:true,stock_quantity:Number(input.stock)}):payload.stock=Number(input.stock);if(target==='woo')await wooUpdate(item.remoteId,payload);else await basalamUpdate(item.remoteId,payload);changed++}catch(error){failed.push({title:item.row.title,error:msg(error)})}}return{ok:failed.length===0,dryRun:false,changed,failed}}
export async function photoFix(profileId:string,apply=false){const rows=(await maintenanceRows(profileId)).filter(x=>x.active&&x.remote_woo_id&&x.data?.image),remote=await remoteProducts('woo'),byId=new Map(remote.map(x=>[x.id,x])),items=rows.filter(x=>!(byId.get(Number(x.remote_woo_id))?.images||[]).length).map(x=>({id:Number(x.remote_woo_id),title:x.title,image:x.data.image}));if(!apply)return{ok:true,dryRun:true,count:items.length,items:items.slice(0,200)};let changed=0,failed:any[]=[];for(const item of items)try{await wooUpdate(item.id,{images:[{src:item.image}]});changed++}catch(error){failed.push({title:item.title,error:msg(error)})}return{ok:failed.length===0,dryRun:false,changed,failed}}
export async function listDestinationProducts(target:'woo'|'basalam'):Promise<Remote[]>{return target==='woo'?wooProducts():basalamProducts()}
export async function destinationOverview(target:'woo'|'basalam'){const items=await listDestinationProducts(target),statuses:Record<string,number>={};for(const item of items)statuses[item.status]=(statuses[item.status]||0)+1;return{target,total:items.length,statuses,withoutImage:items.filter(x=>!x.images.length).length,withoutSku:items.filter(x=>!x.sku).length}}
export async function findDestinationDuplicates(target:'woo'|'basalam'){const items=await listDestinationProducts(target),groups=new Map<string,Remote[]>();for(const item of items){const key=norm(item.name);if(!key)continue;const rows=groups.get(key)||[];rows.push(item);groups.set(key,rows)}return[...groups.entries()].filter(([,rows])=>rows.length>1).map(([title,rows])=>({title,count:rows.length,items:rows.map(x=>({id:x.id,name:x.name,status:x.status,sku:x.sku}))}))}
export async function destinationChangeStatus(target:'woo'|'basalam',id:number,status:string,shopId=''){const allowed=target==='woo'?['publish','draft','private','pending','trash']:['2976','3790','3567','3568','4184'];if(!allowed.includes(String(status)))throw Error('وضعیت انتخاب‌شده معتبر نیست.');if(target==='woo')await wooUpdate(id,{status});else await basalamUpdate(id,{status:Number(status)},shopId);return{ok:true,id,status,shopId:shopId||'default'}}
export async function rawdestinationDelete(target:'woo'|'basalam',id:number,force=false,shopId=''){
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
async function wooProducts(){
  const c=(await loadConnections()).woo;if(!c.url||!c.key||!c.secret)throw Error('اتصال ووکامرس کامل نیست');
  const auth=`Basic ${Buffer.from(`${c.key}:${c.secret}`).toString('base64')}`,out:Remote[]=[];
  for(let page=1;page<=LEDGER_MAX_PAGES;page++){
    const r=await fetchWithRetry(()=>safeFetch(`${c.url}/wp-json/wc/v3/products?per_page=100&page=${page}&status=any`,{headers:{authorization:auth,accept:'application/json'},apiMode:true,directRoute:true},10_000_000),`wooProducts p${page}`);
    const data=await r.json() as any[];
    if(!r.ok)throw Error(`Woo HTTP ${r.status}`);
    for(const x of data)out.push({id:Number(x.id),name:String(x.name||''),sku:String(x.sku||''),images:x.images||[],status:String(x.status||''),price:Number(x.price||0),raw:x});
    if(data.length<100)break;
  }
  return out;
}
async function basalamProducts(){
  const c=(await loadConnections()).basalam;if(!c.token||!c.vendorId)throw Error('اتصال باسلام کامل نیست');
  const out:Remote[]=[];
  for(let page=1;page<=LEDGER_MAX_PAGES;page++){
    const r=await fetchWithRetry(()=>safeFetch(`${c.api}/vendors/${encodeURIComponent(c.vendorId)}/products?per_page=100&page=${page}`,{headers:{authorization:`Bearer ${c.token}`,accept:'application/json'}},10_000_000),`basalamProducts p${page}`);
    const body=await r.json() as any;
    if(!r.ok)throw Error(`Basalam HTTP ${r.status}`);
    const data=body.data||body.products||body.results||body.items||[];
    for(const x of data)out.push({id:Number(x.id),name:String(x.name||x.title||''),sku:String(x.sku||''),images:x.photos||x.images||(x.photo?[x.photo]:[]),status:String(x.status||''),price:Math.round(Number(x.price||0)/10),raw:x});
    if(data.length<100)break;
  }
  return out;
}
async function rawwooUpdate(id:number|string,payload:any){const c=(await loadConnections()).woo,auth=basicAuth(c.key,c.secret),result=await fetchJson(`${wooBase(c)}/${id}`,{method:'PUT',headers:{authorization:auth,'content-type':'application/json',accept:'application/json'},body:JSON.stringify(payload)},true);return result.body}
async function rawbasalamUpdate(id:number|string,payload:any,shopId=''){const shops=selectShops(await basalamShops(),shopId||'all');if(!shops.length)throw Error('غرفهٔ باسلام پیدا نشد.');let last:unknown;for(const shop of shops){for(const endpoint of [`${(await loadConnections()).basalam.api}/products/${id}`,`${(await loadConnections()).basalam.api}/vendors/${encodeURIComponent(shop.vendorId)}/products/${id}`])try{return(await basalamFetch(shop,endpoint,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})).body}catch(error){last=error;if(!(error instanceof DestinationHttpError&&error.status===404))throw error}}throw last instanceof Error?last:Error(`ویرایش محصول باسلام #${id} ناموفق بود.`)}
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
async function fetchWithRetry<T>(fn:()=>Promise<T>,label:string,retries=3):Promise<T>{
  let last:any;
  for(let attempt=1;attempt<=retries;attempt++){
    try{return await fn()}catch(error){
      last=error;
      const status=(error as any)?.status||0;
      const retryable=status===0||status===429||status>=500;
      if(attempt<retries&&retryable){
        await sleep(400*attempt+Math.random()*300);
        continue;
      }
      if(attempt===retries)throw error;
      if(!retryable)throw error;
    }
  }
  throw last;
}
async function wooCatalog(query:{page:number;perPage:number;q:string;status:string}){
  const c=(await loadConnections()).woo;if(!c.url||!c.key||!c.secret)throw Error('اتصال ووکامرس کامل نیست');const auth=basicAuth(c.key,c.secret);
  if(/^\d+$/.test(query.q)){try{const product=await wooGet(Number(query.q));return{products:[product],total:1,totalPages:1,foundBy:'id'}}catch{/* continue with server search */}}
  const url=new URL(wooBase(c));url.searchParams.set('page',String(query.page));url.searchParams.set('per_page',String(query.perPage));url.searchParams.set('status',wooListStatus(query.status));if(query.q)url.searchParams.set('search',query.q);
  const result=await fetchWithRetry(()=>fetchJson(url.toString(),{headers:{authorization:auth,accept:'application/json'}},true),`woo-catalog p${query.page}`);
  const rows=Array.isArray(result.body)?result.body:[];
  return{products:rows.map(row=>normalizeRemote('woo',row,'default','فروشگاه ووکامرس')),total:Number(result.response.headers.get('x-wp-total')||rows.length),totalPages:Math.max(1,Number(result.response.headers.get('x-wp-totalpages')||1)),complete:Array.isArray(result.body)&&(!!result.response.headers.get('x-wp-totalpages')||rows.length<query.perPage),foundBy:query.q?'search':'list'};
}
async function wooStatusCounts(){const statuses=['all','publish','draft','pending','private','trash'],entries=await Promise.all(statuses.map(async status=>{try{const result=await wooCatalog({page:1,perPage:10,q:'',status});return[status,result.total] as const}catch{return[status,0] as const}}));return Object.fromEntries(entries)}
async function wooGet(id:number){const c=(await loadConnections()).woo,auth=basicAuth(c.key,c.secret),result=await fetchJson(`${wooBase(c)}/${id}`,{headers:{authorization:auth,accept:'application/json'}},true);return normalizeRemote('woo',unwrapProduct(result.body),'default','فروشگاه ووکامرس')}
async function basalamCatalog(query:{page:number;perPage:number;q:string;status:string;shopId:string}){
  const shops=selectShops(await basalamShops(),query.shopId);if(!shops.length)throw Error('غرفهٔ باسلام پیدا نشد.');
  if(/^\d+$/.test(query.q)){for(const shop of shops)try{const product=await basalamGet(Number(query.q),shop.vendorId);return{products:[product],total:1,totalPages:1,foundBy:'id'}}catch{/* next shop */}}
  const products:RichRemote[]=[];let total=0,totalPages=1,successful=0,inventorySafe=true;
  for(const shop of shops){
    const url=new URL(`${(await loadConnections()).basalam.api}/vendors/${encodeURIComponent(shop.vendorId)}/products`);
    url.searchParams.set('page',String(query.page));url.searchParams.set('per_page',String(query.perPage));
    for(const value of basalamStatuses(query.status))url.searchParams.append('statuses',value);
    if(query.q)url.searchParams.set('title',query.q);
    try{
      const result=await fetchWithRetry(()=>basalamFetch(shop,url.toString()),`basalam-catalog ${shop.vendorId} p${query.page}`);
      const rows=rowsFrom(result.body);
      const bodyRows=result.body?.data??result.body?.products??result.body?.results??result.body?.items??result.body;
      const pages=Number(result.body?.total_page??result.body?.meta?.last_page),count=Number(result.body?.total_count??result.body?.meta?.total);
      if(!Array.isArray(bodyRows)||(rows.length>=query.perPage&&!pages&&!Number.isFinite(count)))inventorySafe=false;
      if(Number.isFinite(count))totalPages=Math.max(totalPages,Math.ceil(count/query.perPage));
      products.push(...rows.map(row=>normalizeRemote('basalam',row,shop.vendorId,shop.name)));
      total+=Number(result.body?.total_count??result.body?.meta?.total??rows.length);
      totalPages=Math.max(totalPages,Number(result.body?.total_page??result.body?.meta?.last_page??1));
      successful++;
    }catch(error){
      if(shops.length===1)throw error;
      // For multi-shop, log and continue; don't fail whole batch if one shop transiently fails
      console.warn(`basalamCatalog shop ${shop.vendorId} page ${query.page} failed:`,error instanceof Error?error.message:String(error));
    }
  }
  if(!successful)throw Error('دریافت فهرست محصولات از هیچ غرفه‌ای موفق نبود.');
  return{products,total,totalPages,complete:successful===shops.length&&inventorySafe,foundBy:query.q?'title':'list'};
}
async function basalamStatusCounts(shopId:string){const statuses=['all','2976','3790','3567','3568','4184'],entries=await Promise.all(statuses.map(async status=>{try{const result=await basalamCatalog({page:1,perPage:10,q:'',status,shopId});return[status,result.total] as const}catch{return[status,0] as const}}));return Object.fromEntries(entries)}
async function basalamGet(id:number,shopId=''){const shops=selectShops(await basalamShops(),shopId||'all');let last:unknown;for(const shop of shops){for(const endpoint of [`${(await loadConnections()).basalam.api}/products/${id}`,`${(await loadConnections()).basalam.api}/vendors/${encodeURIComponent(shop.vendorId)}/products/${id}`])try{const result=await basalamFetch(shop,endpoint),raw=unwrapProduct(result.body);if(Number(raw?.id||0)>0)return normalizeRemote('basalam',raw,shop.vendorId,shop.name)}catch(error){last=error}}throw last instanceof Error?last:Error(`محصول باسلام #${id} پیدا نشد.`)}
async function rawbasalamBatchUpdate(shopId:string,items:any[]){const shop=(await basalamShops()).find(item=>item.vendorId===shopId);if(!shop)throw Error('غرفهٔ باسلام پیدا نشد.');return(await basalamFetch(shop,`${(await loadConnections()).basalam.api}/vendors/${encodeURIComponent(shop.vendorId)}/products/batch-updates`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({data:items})})).body}
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
  const connection=(await loadConnections()).basalam;const selected=connection.token?connection:(connection.shops||[]).find(x=>x.token);if(!selected?.token)throw Error('توکن باسلام خالی است.');const shop:Shop={name:'غرفه پیش‌فرض',token:selected.token,vendorId:String(selected.vendorId||''),pricePercent:0,primary:true},api=connection.api;
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


async function ledgerMutation(target:'woo'|'basalam',id:unknown,accountKey:string,payload:any,work:()=>Promise<any>,deleted=false){
 const accounts=(await reconAccounts()).filter(a=>a.target===target&&(target==='woo'||!accountKey||a.accountKey===accountKey));
 const scopes=await Promise.all(accounts.map(a=>destinationScope(a.target,a.accountKey)));
 for(const scope of scopes)await destinationLedger.invalidate(scope,id);
 const result=await work();
 const responseProduct=result?.id&&String(result.id)===String(id)?result:{};
 const change={...payload,...(payload.regular_price!==undefined?{price:Number(payload.regular_price)}:{}),...(payload.primary_price!==undefined?{price:Number(payload.primary_price)}:{}),...(responseProduct.price!==undefined?{price:Number(responseProduct.price)}:{}),...(responseProduct.name?{name:responseProduct.name}:{}),...(responseProduct.status!==undefined?{status:String(responseProduct.status)}:{})};
 if(scopes.length===1)await destinationLedger.patch(scopes[0],id,change,deleted);return result;
}
async function wooUpdate(id:number|string,payload:any){return ledgerMutation('woo',id,'default',payload,()=>rawwooUpdate(id,payload))}
async function basalamUpdateShop(accountKey:string,id:number|string,payload:any){return ledgerMutation('basalam',id,accountKey,payload,()=>rawbasalamUpdateShop(accountKey,id,payload))}
async function basalamUpdate(id:number|string,payload:any,shopId=''){return ledgerMutation('basalam',id,shopId,payload,()=>rawbasalamUpdate(id,payload,shopId))}
async function basalamBatchUpdate(shopId:string,items:any[]){for(const item of items)await destinationLedger.invalidate(await destinationScope('basalam',shopId),item.id);return rawbasalamBatchUpdate(shopId,items)}
export async function destinationDelete(target:'woo'|'basalam',id:number,force=false,shopId=''){return ledgerMutation(target,id,shopId,{status:target==='woo'?'trash':'4184'},()=>rawdestinationDelete(target,id,force,shopId),target==='woo'&&force)}

/** Removal is restricted to acknowledged scraper ownership + a complete source scan.
 * The existing retirement policy decides report/draft/out-of-stock/trash; never hard-delete automatically.
 */
export async function ledgerMissing(profileId='',apply=false,target='both',onProgress?:(e:any)=>void){
 const step=(event:any)=>{try{onProgress?.(event)}catch{}};
 const p=createReconProgress(onProgress);
 p.emit({stage:'start',name:'missing',summary:(apply?'شروع رسیدگی به محصولات حذف‌شده از مبدأ':'شروع بررسی محصولات حذف‌شده از مبدأ (هیچ چیزی در مقصد تغییر نمی‌کند)')});
 const local=await maintenanceRows(''),settings=await getState<any>('settings',{}),mode=String(settings.retire?.mode||'report'),items:any[]=[],failed:any[]=[];let changed=0;
 const MODE_LABELS:Record<string,string>={report:'فقط گزارش',draft:'پیش‌نویس کردن',delete:'حذف',trash:'انتقال به زباله‌دان',outofstock:'ناموجود کردن'};
 const modeLabel=MODE_LABELS[mode]||mode;
 p.emit({stage:'local-loaded',name:'local',count:local.length,summary:'محصولات محلی خوانده شد: '+faN(local.length)+' · شیوهٔ رسیدگی: '+modeLabel});
 const manifests=new Map<string,any>();for(const row of local)if(!manifests.has(row.profile_id))manifests.set(row.profile_id,await getState<any>('source_scan:'+row.profile_id,null));
 const chosen=(await reconAccounts()).filter(a=>target==='both'||a.target===target);
 p.emit({stage:'accounts-listed',name:'accounts',total:chosen.length,summary:'مقصدهای بررسی‌شونده: '+faN(chosen.length),detail:chosen.map(a=>a.name+' — '+(a.target==='woo'?'ووکامرس':'باسلام'))});
 for(const account of chosen){
  p.emit({stage:'account-start',name:'scan',account:account.name,target:account.target,count:items.length,total:local.length,
    summary:'مقصد '+account.name+': بررسی دفتر حساب در برابر '+faN(local.length)+' محصول محلی…'});
  const scope=await destinationScope(account.target,account.accountKey);const meta=await destinationLedger.metadata(scope);
  if(!meta||!Number.isFinite(Date.parse(meta.startedAt))||Date.now()-Date.parse(meta.startedAt)>=LEDGER_TTL_MS){failed.push({account:account.name,error:'دفتر حساب باید تازه‌سازی شود؛ حذف انجام نشد.'});
   p.emit({stage:'account-error',name:'scan',status:'error',account:account.name,target:account.target,
     summary:account.name+': دفتر این مقصد کهنه است؛ برای جلوگیری از حذف اشتباه، این مقصد رد شد — اول «تازه‌سازی دفتر» را بزنید'});continue}
  for(const row of local){if(profileId&&row.profile_id!==profileId||(row.active!==false&&row.active!==0)||!manifests.get(row.profile_id)?.complete)continue;
   const mapped=row.maps?.find((m:any)=>m.target===account.target&&String(m.account_key)===account.accountKey)?.remote_id||(account.target==='woo'?row.remote_woo_id:null);if(!mapped)continue;
   const entry=await destinationLedger.find(scope,mapped);if(!entry||entry.deleted||entry.invalid||entry.profileId!==row.profile_id||entry.sourceKey!==row.source_key)continue;
   if(local.some(other=>other.active&&(other.maps?.some((m:any)=>m.target===account.target&&String(m.account_key)===account.accountKey&&String(m.remote_id)===String(mapped))||(account.target==='woo'&&String(other.remote_woo_id)===String(mapped)))))continue;
   if(['delete','trash'].includes(mode)&&['trash','4184'].includes(String(entry.remote.status)))continue;if(mode==='draft'&&['draft','3790'].includes(String(entry.remote.status)))continue;if(mode==='outofstock'&&Number(entry.remote.raw?.stock_quantity??entry.remote.raw?.stock??-1)===0)continue;
   const item={profileId:row.profile_id,sourceKey:row.source_key,title:row.title,target:account.target,accountKey:account.accountKey,remoteId:String(mapped),mode};items.push(item);
   p.emit({stage:'candidate',name:'candidate',account:account.name,target:account.target,count:items.length,
     summary:'نامزد '+faN(items.length)+': '+clipText(row.title,60)+' (شناسهٔ مقصد '+faN(String(mapped))+') — در مبدأ دیگر نیست'+(apply&&mode!=='report'?'':' · فقط گزارش')});
   if(!apply||mode==='report'||changed>=20)continue;
   try{
    const latest=await getState<any>('source_scan:'+row.profile_id,null),current=(await maintenanceRows(row.profile_id)).find((x:any)=>x.source_key===row.source_key);
    if(!latest?.complete||latest.jobId!==manifests.get(row.profile_id)?.jobId||!current||(current.active!==false&&current.active!==0))continue;
    // Verify the destination still exists before an irreversible-looking action.
    await destinationProduct(account.target,mapped,account.target==='basalam'?account.accountKey:'');
    if(mode==='delete'||mode==='trash')await destinationDelete(account.target,mapped,false,account.target==='basalam'?account.accountKey:'');
    else if(mode==='outofstock'){if(account.target==='woo')await wooUpdate(mapped,{manage_stock:true,stock_quantity:0});else await basalamUpdateShop(account.accountKey,mapped,{stock:0})}
    else if(mode==='draft'){if(account.target==='woo')await wooUpdate(mapped,{status:'draft'});else await basalamUpdateShop(account.accountKey,mapped,{status:3790})}
    else continue;
    changed++;
    p.emit({stage:'applied',name:'applied',status:'success',account:account.name,target:account.target,count:changed,total:20,
      summary:(({delete:'حذف شد',trash:'به زباله‌دان رفت',draft:'پیش‌نویس شد',outofstock:'ناموجود شد'} as Record<string,string>)[mode]||modeLabel)+': '+clipText(row.title,60)+' (شناسهٔ مقصد '+faN(String(mapped))+')'});
   }catch(error){const message=error instanceof Error?error.message:String(error);failed.push({...item,error:message});
    p.emit({stage:'apply-error',name:'applied',status:'error',account:account.name,target:account.target,
      summary:'ناموفق: '+clipText(row.title,60)+' — '+clipText(message,90)});}
  }
 }
 p.emit({stage:'report-ready',name:'report',status:failed.length?'error':'success',count:changed,total:items.length,
   summary:'پایان در '+faDuration(p.elapsed())+' · نامزد '+faN(items.length)+' · انجام‌شده '+faN(changed)+' · باقی‌مانده '+faN(Math.max(0,items.length-changed))+' · ناموفق '+faN(failed.length)+(mode==='report'?' · شیوه روی «فقط گزارش» است، پس چیزی در مقصد تغییر نکرد':''),
   detail:items.slice(0,4).map((i:any)=>clipText(i.title,55)+' — '+(i.target==='woo'?'ووکامرس':'باسلام')+' · شناسه '+faN(i.remoteId))});
 return {ok:!failed.length,dryRun:!apply||mode==='report',mode,planned:items.length,changed,remaining:Math.max(0,items.length-changed),items,failed,limit:20};
}

/**
 * ۱.۳۴۲.۰ — حذف بر پایهٔ پروفایل (نه دفتر حساب).
 *
 * هرچه در پروفایلِ ذخیره‌شده نیست، در مقصد هم نباید باشد. این تابع محصولات
 * «رفته از مبدأ» را از روی خودِ پروفایل پیدا می‌کند (نه از روی دفتر حساب)، آن‌ها
 * را از هر مقصدی که به آن ارسال شده بودند برمی‌دارد و بعد ردیفشان را از پروفایل
 * پاک می‌کند. دفتر حساب فقط برای یافتن شناسهٔ مقصد کمک می‌کند و اگر کهنه باشد
 * جلوی کار را نمی‌گیرد؛ شناسهٔ مقصد از نقشهٔ ارسال (destination_map) خوانده می‌شود.
 *
 * نرده‌های ایمنی که سر جایشان می‌مانند: اسکن مبدأ باید کامل بوده باشد، و سقف
 * درصد/تعداد حذف («محصولات رفته از مبدأ» در تنظیمات) رعایت می‌شود.
 */
export async function profileSyncRemovals(profileId='',apply=false,target:'woo'|'basalam'|'both'='both',onProgress?:(e:any)=>void){
 const p=createReconProgress(onProgress);
 p.emit({stage:'start',name:'profile-sync',summary:(apply?'شروع هماهنگ‌سازی حذف بر پایهٔ پروفایل':'بررسی حذف بر پایهٔ پروفایل (هیچ چیزی تغییر نمی‌کند)')+' · مرجع تصمیم: پروفایل ذخیره‌شده، نه دفتر حساب'});
 const rows=await maintenanceRows(profileId) as any[];
 const settings=await getState<any>('settings',{}) as any;
 const scan=profileId?await getState<any>('source_scan:'+profileId,null):null;
 const accounts=(await reconAccounts()).filter(a=>target==='both'||a.target===target);
 p.emit({stage:'accounts-listed',name:'accounts',total:accounts.length,
   summary:'مقصدهای این حذف: '+faN(accounts.length)+' · محصولات ذخیره‌شدهٔ پروفایل: '+faN(rows.length),
   accounts:accounts.map(a=>({target:a.target,accountKey:a.accountKey,name:a.name})),
   detail:accounts.map(a=>a.name+' — '+(a.target==='woo'?'ووکامرس':'باسلام'))});
 const mode=String(settings?.retire?.mode||'')||'delete';
 const plan=planProfileRemovals(rows,accounts,{
   scanComplete:!!scan?.complete,profileId,
   maxPct:Number(settings?.retire?.maxPct)||30,maxCount:Number(settings?.retire?.maxCount)||50});
 const REASON_TALLY='در مبدأ نبود: '+faN(plan.stats.missing)+' · ناموجود: '+faN(plan.stats.outOfStock)+' · بی‌قیمت: '+faN(plan.stats.noPrice);
 if(plan.blocked){
  p.emit({stage:'plan-ready',name:'plan',status:'error',count:0,total:plan.stats.gone,
    summary:'حذف انجام نشد — '+plan.blocked,detail:[REASON_TALLY,'محصولات زندهٔ پروفایل: '+faN(plan.stats.alive)]});
  return {ok:false,dryRun:true,mode,blocked:plan.blocked,planned:0,candidates:plan.stats.gone,
    removedFromDestination:0,removedFromProfile:0,items:[],failed:[],stats:plan.stats};
 }
 p.emit({stage:'plan-ready',name:'plan',status:'success',count:plan.removals.length,total:plan.stats.rows,
   summary:'محصولات رفته از مبدأ: '+faN(plan.removals.length)+' از '+faN(plan.stats.rows)+' ('+faN(plan.stats.percent)+'٪) · '+REASON_TALLY+(apply?' · شیوهٔ مقصد: '+mode:' · فقط گزارش'),
   detail:plan.removals.slice(0,6).map(item=>clipText(item.title,50)+' — '+item.reasonLabel+' · مقصدها: '+(item.targets.length?item.targets.map(t=>t.accountName).join('، '):'هیچ‌جا ارسال نشده بود'))});
 const items:any[]=[],failed:any[]=[];let removedFromDestination=0,removedFromProfile=0;
 for(const removal of plan.removals){
  const record:any={...removal,destinations:[],profileRemoved:false};
  items.push(record);
  if(!apply){
   p.emit({stage:'candidate',name:'candidate',count:items.length,total:plan.removals.length,
     profileId:removal.profileId,sourceKey:removal.sourceKey,
     summary:'نامزد حذف '+faN(items.length)+': '+clipText(removal.title,55)+' — '+removal.reasonLabel});
   continue;
  }
  let allGood=true;
  for(const destination of removal.targets){
   p.emit({stage:'apply',name:'remove',status:'running',account:destination.accountName,target:destination.target,accountKey:destination.accountKey,
     profileId:removal.profileId,sourceKey:removal.sourceKey,count:removedFromDestination+1,total:plan.removals.length,
     summary:clipText(removal.title,45)+' → '+destination.accountName+': در حال حذف از مقصد…'});
   try{
    const remoteId=Number(destination.remoteId);
    const shopId=destination.target==='basalam'?destination.accountKey:'';
    if(mode==='draft'){if(destination.target==='woo')await wooUpdate(remoteId,{status:'draft'});else await basalamUpdateShop(destination.accountKey,remoteId,{status:3790})}
    else if(mode==='outofstock'){if(destination.target==='woo')await wooUpdate(remoteId,{manage_stock:true,stock_quantity:0});else await basalamUpdateShop(destination.accountKey,remoteId,{stock:0})}
    else if(mode==='report'){allGood=false;continue}
    else await destinationDelete(destination.target as any,remoteId,false,shopId);
    removedFromDestination++;record.destinations.push({...destination,done:true});
    p.emit({stage:'apply-written',name:'remove',status:'success',account:destination.accountName,target:destination.target,accountKey:destination.accountKey,
      profileId:removal.profileId,sourceKey:removal.sourceKey,count:removedFromDestination,total:plan.removals.length,
      summary:clipText(removal.title,45)+' → '+destination.accountName+': '+(mode==='draft'?'پیش‌نویس شد':mode==='outofstock'?'ناموجود شد':'از مقصد حذف شد')});
   }catch(error){
    allGood=false;const message=error instanceof Error?error.message:String(error);
    failed.push({...removal,account:destination.accountName,error:message});record.destinations.push({...destination,done:false,error:message});
    p.emit({stage:'apply-error',name:'remove',status:'error',account:destination.accountName,target:destination.target,accountKey:destination.accountKey,
      profileId:removal.profileId,sourceKey:removal.sourceKey,
      summary:clipText(removal.title,45)+' → '+destination.accountName+': حذف نشد — '+clipText(message,70)});
   }
  }
  // محصول فقط وقتی از پروفایل پاک می‌شود که دیگر در هیچ مقصدی باقی نمانده باشد؛
  // در شیوه‌های «پیش‌نویس/ناموجود» محصول در مقصد می‌ماند، پس ردیف پروفایل هم می‌ماند.
  if(allGood&&(mode==='delete'||mode==='trash'||!removal.targets.length)){
   try{
    await deleteProduct(removal.profileId,removal.sourceKey);
    removedFromProfile++;record.profileRemoved=true;
    p.emit({stage:'applied',name:'profile',status:'success',count:removedFromProfile,total:plan.removals.length,
      profileId:removal.profileId,sourceKey:removal.sourceKey,
      summary:clipText(removal.title,50)+': از پروفایل هم پاک شد'+(removal.targets.length?' (بعد از حذف در '+faN(removal.targets.length)+' مقصد)':' (هیچ‌جا ارسال نشده بود)')});
   }catch(error){const message=error instanceof Error?error.message:String(error);failed.push({...removal,error:message});}
  }
 }
 p.emit({stage:'report-ready',name:'report',status:failed.length?'error':'success',count:removedFromProfile,total:plan.removals.length,
   summary:'پایان در '+faDuration(p.elapsed())+' · نامزد '+faN(plan.removals.length)+' · حذف از مقصد '+faN(removedFromDestination)+' · حذف از پروفایل '+faN(removedFromProfile)+' · ناموفق '+faN(failed.length)+(apply?'':' · فقط گزارش بود'),
   detail:[REASON_TALLY,'مرجع تصمیم: پروفایل ذخیره‌شده (دفتر حساب فقط برای یافتن شناسهٔ مقصد به کار رفت)']});
 return {ok:!failed.length,dryRun:!apply,mode,blocked:'',planned:plan.removals.length,candidates:plan.stats.gone,
   removedFromDestination,removedFromProfile,items,failed,stats:plan.stats};
}

export async function destinationLedgerProducts(target:string,accountKey:string,offset=0){const account=(await reconAccounts()).find(a=>a.target===target&&a.accountKey===accountKey);if(!account)throw Error('مقصد دفتر حساب پیدا نشد.');const scope=await destinationScope(account.target,account.accountKey),meta=await destinationLedger.metadata(scope),entries=(await destinationLedger.entries(scope)).filter(x=>customerVisible(account.target,x.remote));const start=Math.max(0,Math.floor(offset)||0);return {ok:true,account,meta,total:entries.length,offset:start,limit:50,items:entries.slice(start,start+50),next:start+50<entries.length?start+50:null}}
