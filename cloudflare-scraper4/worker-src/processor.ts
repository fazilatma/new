import { reuseSourceList, sourceDetailFailed, mergeListOnly } from './source-list-ledger.js';
import { createAiStageRunner } from './job-ai-stage.js';
import { applyStoredResultSettings, claimJob, deleteState, findMissingProducts, getJob, getProduct, getProfile, getState, listProducts, markMissingProducts, markProfileRun, saveProfile, setState, stopRequested, updateJob, upsertProduct } from './db.js';
import { getEnv } from './env.js';
import { assignProductBasalamCategory, generateProductDescription, productNeedsBasalamCategory, productNeedsEnrichment } from './ai.js';
import { destinationCategories, ledgerMissing } from './maintenance.js';
import { listSelectorsStatus, mapLimit, pageUrl, scrapeDetails, scrapeListPage, suggestSelectors } from './scraper.js';
import { syncBasalam, syncWoo } from './sync.js';
import { hasCodeSuffix, parseSuffixFormats, suffixPatterns } from './dedup.js';
import { message } from './utils.js';
import type { Job, Product, Profile } from './types.js';

type ProcessResult='complete'|'continue'|'ignored';
type ScrapeCheckpoint={rawPricing?:boolean;page:number;url:string;nextUrl:string;index:number;products?:Product[];seen:string[];retireSafe?:boolean;listSelectorsFilled?:boolean;listRescued?:boolean;detailRescued?:boolean;detailSelectorsFilled?:boolean;autoSelectorsAllowed?:boolean;engineSelectorsSaved?:boolean};
type SyncCheckpoint={offset:number;applied?:boolean;applyAfter?:string};
const stateKey=(jobId:string)=>`job_checkpoint:${jobId}`;
// Small chunks leave room for stage progress, AI checkpoints and destination requests.
function chunkSize():number{return Math.min(50,Math.max(1,Number(getEnv().JOB_CHUNK_SIZE)||2))}
function preserveExisting(fresh:Product,previous:Product|null):Product{
  if(!previous)return fresh;
  return {...fresh,
    title:fresh.title||(previous as any).resultBase?.title||previous.title,price:fresh.price,priceText:fresh.priceText,url:fresh.url||previous.url,
    basalamCategoryId:fresh.basalamCategoryId||previous.basalamCategoryId,
    basalamCategoryName:fresh.basalamCategoryId?fresh.basalamCategoryName:previous.basalamCategoryName,
    basalamCategoryPath:fresh.basalamCategoryId?fresh.basalamCategoryPath:previous.basalamCategoryPath,
    image:fresh.image||previous.image,images:[...new Set([fresh.image,...(previous.images||[]),...(fresh.images||[])].filter(Boolean))],
    shortDesc:fresh.shortDesc||previous.shortDesc,longDesc:fresh.longDesc||previous.longDesc,sku:fresh.sku||previous.sku,brand:fresh.brand||previous.brand,
    stock:fresh.stock??previous.stock,weight:fresh.weight??previous.weight,category:fresh.category||previous.category,tags:fresh.tags||previous.tags,
    variations:fresh.variations?.length?fresh.variations:previous.variations,variationGroups:fresh.variationGroups?.length?fresh.variationGroups:previous.variationGroups?.map((group,i)=>({...group,prices:(previous as any).resultBase?.groupPrices?.[i]||group.prices})),
    variationPrices:Object.keys(fresh.variationPrices||{}).length?fresh.variationPrices:(previous as any).resultBase?.variationPrices||previous.variationPrices
  };
}
const MANUAL_LIST_ENGINES=new Set(['htmlrewriter','cheerio']);
function isManualListEngine(engine?:string):boolean{return !!engine&&MANUAL_LIST_ENGINES.has(engine)}
const DETAIL_KEYS=['shortDesc','longDesc','sku','brand','category','stock','weight','gallery','detailImage','variations'] as const;
/** True when the profile actually configures detail extraction. */
function hasDetailSelectors(selectors:any):boolean{return DETAIL_KEYS.some(key=>String(selectors?.[key]||'').trim())}
/** Scrapes one product and reports whether ANY detail field was populated. */
async function detailProbe(sample:Product,selectors:any,indirect:boolean):Promise<boolean>{
  try{
    const before=JSON.stringify(DETAIL_KEYS.map(key=>(sample as any)[key]??null));
    const probe=await scrapeDetails({...sample},selectors,indirect);
    return JSON.stringify(DETAIL_KEYS.map(key=>(probe as any)[key]??null))!==before;
  }catch{return false}
}
async function applySelectorSuggestions(profile:Profile,url:string,mode:'list'|'detail',job?:Job,onlyMissing=true):Promise<number>{
  try{
    const suggested=(await runAiStage(job!,mode+'-selectors',{},async()=>({ok:true,value:await suggestSelectors(url,mode)}))).value||{selectors:{}},selectors=suggested.selectors||{},entries=Object.entries(selectors).filter(([key,value])=>String(value||'').trim()&&(!onlyMissing||!String((profile.selectors as any)?.[key]||'').trim()));
    if(!entries.length)return 0;
    profile.selectors={...profile.selectors,...Object.fromEntries(entries)} as Profile['selectors'];
    await saveProfile({...profile,updatedAt:new Date().toISOString()});
    if(job)append(job,`${mode==='list'?'سلکتورهای ناقص فهرست':'سلکتورهای ناقص جزئیات'} با کشف خودکار تکمیل شد: ${entries.map(([key])=>key).join(', ')}`,'info');
    return entries.length;
  }catch(error){if(job)append(job,`شناسایی خودکار سلکتورهای ${mode==='list'?'فهرست':'جزئیات'} ناموفق بود: ${message(error)}`,'warning');return 0}
}
type JobLog=Job['log'][number];
function reportItem(product:Product,extra:Partial<NonNullable<JobLog['item']>>={}):NonNullable<JobLog['item']>{return{sourceKey:product.sourceKey,title:product.title,url:product.url,price:Number(product.price)||undefined, basePrice:(product as any).resultBase?.price,basePriceText:(product as any).resultBase?.priceText,...extra}}
function append(job:Job,text:string,level='info',event?:JobLog['event'],item?:JobLog['item']){job.log.push({at:new Date().toISOString(),level,message:text,event,item});if(job.log.length>1500)job.log=[...job.log.filter(x=>x.event==='workflow').slice(0,1),...job.log.filter(x=>x.event!=='workflow').slice(-1499)]}
async function save(job:Job){const lastStage=[...job.log].reverse().find(row=>row.level==='stage');if(lastStage?.message!==job.phase)append(job,job.phase,'stage');const current=await getJob(job.id);if(current&&['stopped','failed','done'].includes(current.status)&&current.status!==job.status)return;if(current?.stopRequested&&job.status==='running'){job.status='stopped';job.phase='finished';job.finishedAt=new Date().toISOString();append(job,'عملیات با توقف اجباری کاربر بسته شد.','warning')}await updateJob(job.id,{status:job.status,phase:job.phase,total:job.total,processed:job.processed,added:job.added,updated:job.updated,failed:job.failed,error:job.error,log:job.log,finishedAt:job.finishedAt});if(['done','failed','stopped'].includes(job.status))await deleteState('job_ai:'+job.id);}

export async function enqueueJob(job:Job,waitUntil?:(promise:Promise<unknown>)=>void):Promise<void>{
  const queue=getEnv().JOBS;
  if(queue){await queue.send({jobId:job.id});return}
  const promise=drainInline(job.id);
  if(waitUntil){waitUntil(promise);return}
  await promise;
}
async function drainInline(jobId:string):Promise<void>{
  // Local fallback is intentionally bounded. Production deployments should bind JOBS;
  // any remaining queued checkpoint is recovered by the scheduled handler.
  for(let i=0;i<5;i++){const result=await processJob(jobId);if(result!=='continue')return}
}

export async function processJob(id:string):Promise<ProcessResult>{
  const job=await claimJob(id);
  if(!job)return'ignored';
  try{
    const profile=await getProfile(job.profileId);
    if(!profile)throw new Error('Profile not found');
    if(job.workflow==='list-only')job.target='none';
    append(job,`شروع/ادامه ${job.kind==='scrape'?'استخراج':'همگام‌سازی'} «${profile.name}»`);
    const more=job.kind==='scrape'?await runScrapeChunk(job,profile):await runSyncChunk(job,profile);
    if(job.status==='stopped'){
      await deleteState(stateKey(job.id));
      job.finishedAt=new Date().toISOString();job.phase='finished';append(job,'عملیات متوقف شد','warning');await save(job);return'complete';
    }
    if(more){job.status='queued';append(job,'نقطهٔ بازیابی ذخیره شد؛ ادامه در پیام بعدی صف');await save(job);return'continue'}
    job.status='done';job.finishedAt=new Date().toISOString();job.phase='finished';if(job.skippedNoPrice)append(job,`${job.skippedNoPrice} محصول بدون قیمت نادیده گرفته شد.`,'warning');append(job,'عملیات با موفقیت تمام شد');await deleteState(stateKey(job.id));await save(job);return'complete';
  }catch(error){
    job.status='failed';job.error=message(error);job.finishedAt=new Date().toISOString();job.phase='finished';append(job,job.error,'error');await save(job);return'complete';
  }
}

async function runScrapeChunk(job:Job,profile:Profile):Promise<boolean>{
  const key=stateKey(job.id);
  const checkpoint=await getState<ScrapeCheckpoint>(key,{page:1,url:pageUrl(profile,1),nextUrl:'',index:0,seen:[],retireSafe:true});
  checkpoint.retireSafe ??= true;
  if(checkpoint.page===1&&checkpoint.index===0&&!checkpoint.products)await setState('source_scan:'+profile.id,{jobId:job.id,complete:false});
  // Old releases checkpointed adjusted prices. Re-fetch pending source data on upgrade.
  if(checkpoint.products&&!checkpoint.rawPricing){delete checkpoint.products;checkpoint.index=0;append(job,'قالب قیمت نقطهٔ بازیابی قدیمی است؛ دادهٔ خام این صفحه دوباره استخراج می‌شود.')}

  if(await stopRequested(job.id)){job.status='stopped';return false}
  if(!checkpoint.products){
    job.phase='list';
    // TRIGGER 1 (selectors not configured): profiles created through the API
    // always carry the WooCommerce DEFAULT_SELECTORS (empty list selectors
    // are rejected), so the old pre-fill only ever completed detail selectors
    // and a shop the discovery engines could not read ended with 0 products.
    // Since 1.129.0 the engines repair unconfigured (empty, partial, or still
    // default) selectors themselves from page 1 — reusing the same fetch —
    // and the run persists what the page verified (see below). No separate
    // suggestion fetch is needed before the loop anymore.
    if(!checkpoint.listSelectorsFilled){
      const selectorStatus=listSelectorsStatus(profile.selectors);
      if(selectorStatus!=='custom')append(job,`سلکتورهای فهرست هنوز برای این فروشگاه تنظیم نشده (${selectorStatus==='empty'?'خالی':selectorStatus==='partial'?'ناقص':'پیش‌فرض'})؛ موتور استخراج ابتدا آن‌ها را از صفحهٔ اول پیدا می‌کند…`);
      checkpoint.listSelectorsFilled=true;
    }
    append(job,`صفحه ${checkpoint.page}: ${checkpoint.url}`);
    let page=await scrapeListPage(checkpoint.url,profile.selectors,profile.pagination==='next_selector'?profile.paginationValue:'',Boolean(profile.networkIndirect),profile.extractionEngine,profile.extractionEngineMaster,true,true,profile.pagination==='scroll');
    // 1.129.0 — persist engine-discovered selectors once: later pages of
    // this run (and every later run) then extract with the selector engine
    // instead of re-discovering.
    if(page.discoveredSelectors&&!checkpoint.engineSelectorsSaved){
      const entries=Object.entries(page.discoveredSelectors).filter(([,value])=>String(value||'').trim());
      if(entries.length){
        checkpoint.engineSelectorsSaved=true;
        profile.selectors={...profile.selectors,...Object.fromEntries(entries)} as Profile['selectors'];
        await saveProfile({...profile,updatedAt:new Date().toISOString()});
        append(job,`سلکتورهای فهرست به‌صورت خودکار پیدا و ذخیره شد (${entries.map(([key])=>key).join('، ')}؛ روش: ${page.discoveryMethod==='structural'?'تحلیل ساختاری صفحه':page.discoveryMethod==='mixed'?'ترکیبی':'الگوهای آماده'})؛ استخراج با آن‌ها ادامه می‌یابد.`);
      }
    }
    if(page.usedEngine&&page.products.length&&(profile.extractionEngine==='auto'||profile.extractionEngineMaster!==page.usedEngine)){
      profile.extractionEngineMaster=page.usedEngine;profile.extractionEngineHost=new URL(page.url).hostname;profile.extractionEngineMs=page.elapsedMs||0;
      await saveProfile({...profile,updatedAt:new Date().toISOString()});
      append(job,`موتور مستر این پروفایل: ${page.usedEngine}${page.elapsedMs?` · ${page.elapsedMs}ms`:''}`);
    }
    // The requested engine threw and every fallback came up empty: say WHAT
    // broke (usually one bad saved selector) before the rescue below tries
    // to repair it.
    if(!page.products.length&&page.engineError)append(job,page.engineError,'warning');
    // LAST-RESORT FALLBACK: the page was fetched but produced nothing. Before
    // failing the run, rediscover the selectors exactly like the "auto suggest"
    // button and retry this page once. onlyMissing=false because selectors that
    // exist but no longer match are precisely the failure being recovered from.
    if(!page.products.length&&!checkpoint.listRescued){
      checkpoint.listRescued=true;
      append(job,'هیچ محصولی استخراج نشد؛ پیشنهاد خودکار سلکتورها به‌عنوان آخرین راه اجرا می‌شود…','warning');
      const filled=await applySelectorSuggestions(profile,page.url,'list',job,false);
      if(filled){
        const retry=await scrapeListPage(page.url,profile.selectors,profile.pagination==='next_selector'?profile.paginationValue:'',Boolean(profile.networkIndirect),profile.extractionEngine,profile.extractionEngineMaster,true,true,profile.pagination==='scroll');
        if(retry.products.length){append(job,`پیشنهاد خودکار جواب داد: ${retry.products.length} محصول پس از بازتنظیم سلکتورها پیدا شد.`);page=retry}
        else append(job,'پیشنهاد خودکار هم محصولی پیدا نکرد؛ سلکتورها را دستی بررسی کنید.','warning');
      }
    }
    checkpoint.autoSelectorsAllowed=!!(page.usedEngine&&page.products.length&&!isManualListEngine(page.usedEngine));
    if(checkpoint.autoSelectorsAllowed&&!checkpoint.listSelectorsFilled){await applySelectorSuggestions(profile,page.url,'list',job,true);checkpoint.listSelectorsFilled=true}
    checkpoint.url=page.url;checkpoint.nextUrl=page.nextUrl;checkpoint.index=0;
    checkpoint.rawPricing=true;
    const pageProducts=page.products;
    checkpoint.products=pageProducts.filter(product=>!checkpoint.seen.includes(product.sourceKey));
    if(!pageProducts.length){
      checkpoint.retireSafe=false;
      if(checkpoint.page===1)throw new Error('در صفحهٔ اول هیچ محصولی استخراج نشد. سلکتور ظرف/فیلدها، پاسخ ضدربات و HTML مبدأ را بررسی کنید؛ محصولات قبلی بازنشسته نشدند.');
      append(job,`صفحه ${checkpoint.page} خالی بود؛ برای جلوگیری از حذف اشتباه، بازنشسته‌سازی محصولات انجام نمی‌شود.`,'warning');await finishScrape(job,profile,checkpoint);return false;
    }
    if(!checkpoint.products.length){checkpoint.retireSafe=false;append(job,`صفحه ${checkpoint.page} فقط محصولات تکراری داشت؛ حلقهٔ صفحه‌بندی متوقف شد و بازنشسته‌سازی انجام نمی‌شود.`,'warning');await finishScrape(job,profile,checkpoint);return false}
    if(job.workflow!=='list-only')for(let i=0;i<checkpoint.products.length;i++){const fresh=checkpoint.products[i];checkpoint.products[i]=await reuseSourceList(fresh,await getProduct(profile.id,fresh.sourceKey),profile)}
    if(job.workflow!=='list-only')append(job,'مقایسهٔ فهرست اولیه با دفتر مبدأ','info','source-cache',{sourceKey:'',title:'کش فهرست',listCount:checkpoint.products.length,reusedCount:checkpoint.products.filter(p=>(p as any)._reuseDetails).length});
    job.total+=checkpoint.products.length;
    await setState(key,checkpoint);await save(job);
  }
  if(job.workflow==='list-only'){
    job.phase='list-save';checkpoint.retireSafe=false;
    const end=Math.min(checkpoint.products.length,checkpoint.index+chunkSize());
    for(;checkpoint.index<end;checkpoint.index++){
      if(await stopRequested(job.id)){job.status='stopped';await setState(key,checkpoint);return false}
      const raw=checkpoint.products[checkpoint.index],product=mergeListOnly(raw,await getProduct(profile.id,raw.sourceKey));
      const result=await upsertProduct(profile.id,product,{source:true});result==='added'?job.added++:job.updated++;job.processed++;checkpoint.seen.push(product.sourceKey);
      append(job,`${product.title}: فقط دادهٔ فهرست ذخیره شد.`,'info',result,reportItem(product));
    }
  }else{
  job.phase='details-save-sync';
  if(!checkpoint.detailSelectorsFilled){const sample=checkpoint.products.find(p=>p.url&&!(p as any)._reuseDetails);if(sample?.url&&checkpoint.autoSelectorsAllowed)await applySelectorSuggestions(profile,sample.url,'detail',job,true);checkpoint.detailSelectorsFilled=true;await setState(key,checkpoint)}
  // LAST-RESORT FALLBACK for the detail stage: if the configured detail
  // selectors enrich nothing on a real product, every product would be saved
  // with empty descriptions. Rediscover them once and re-probe.
  if(!checkpoint.detailRescued&&hasDetailSelectors(profile.selectors)){
    const sample=checkpoint.products.find(p=>p.url&&!(p as any)._reuseDetails);
    if(sample?.url&&!await detailProbe(sample,profile.selectors,Boolean(profile.networkIndirect))){
      checkpoint.detailRescued=true;
      append(job,'سلکتورهای جزئیات هیچ فیلدی را پر نکردند؛ پیشنهاد خودکار به‌عنوان آخرین راه اجرا می‌شود…','warning');
      const filled=await applySelectorSuggestions(profile,sample.url,'detail',job,false);
      if(filled&&await detailProbe(sample,profile.selectors,Boolean(profile.networkIndirect)))append(job,'پیشنهاد خودکار جواب داد: سلکتورهای جزئیات بازتنظیم شدند.');
      else if(filled)append(job,'پیشنهاد خودکار هم فیلدی پیدا نکرد؛ سلکتورهای جزئیات را دستی بررسی کنید.','warning');
      await setState(key,checkpoint);
    }
  }
  const start=checkpoint.index,end=Math.min(checkpoint.products.length,start+chunkSize()),batch=checkpoint.products.slice(start,end).map(product=>({...product})),previousByKey=new Map<string,Product|null>(),rawPriceByKey=new Map<string,number>();
  await mapLimit(batch,Math.min(4,Math.max(1,Number(getEnv().DETAIL_CONCURRENCY)||2)),async product=>{
    const previous=await getProduct(profile.id,product.sourceKey);previousByKey.set(product.sourceKey,previous);rawPriceByKey.set(product.sourceKey,product.price);Object.assign(product,preserveExisting(product,previous));
    if((product as any)._reuseDetails||!hasDetailSelectors(profile.selectors))return;
    try{Object.assign(product,await scrapeDetails(product,profile.selectors,Boolean(profile.networkIndirect)));append(job,`${product.title}: جزئیات خوانده شد.`,'info','updated',reportItem(product,{price:Number(product.price)||undefined}))}catch(error){sourceDetailFailed(product);const errorText=message(error);job.failed++;append(job,`${product.title}: جزئیات: ${errorText}؛ اطلاعات معتبر قبلی حفظ شد.`,'error','failed',reportItem(product,{error:errorText}))}
  });
  // SCRAPER-FIRST RESCUE (before any AI): an empty description usually means
  // the detail selectors do not match THIS product's template, not that the
  // page has no text. Rediscover the detail selectors from a product that is
  // actually missing data and re-scrape those products; the AI generator below
  // is the fallback, because real page content beats generated text.
  const needsDetail=batch.filter(product=>!(product as any)._reuseDetails&&product.url&&productNeedsEnrichment(product).any);
  if(needsDetail.length&&!checkpoint.detailRescued){
    checkpoint.detailRescued=true;
    append(job,`${needsDetail.length} محصول بدون توضیحات ماند؛ ابتدا موتور استخراج دوباره سلکتورهای جزئیات را پیدا می‌کند…`);
    const filled=await applySelectorSuggestions(profile,needsDetail[0].url,'detail',job,false);
    if(filled){
      let recovered=0;
      await mapLimit(needsDetail,Math.min(4,Math.max(1,Number(getEnv().DETAIL_CONCURRENCY)||2)),async product=>{
        if(await stopRequested(job.id))return;
        const before=productNeedsEnrichment(product).any;
        try{Object.assign(product,await scrapeDetails(product,profile.selectors,Boolean(profile.networkIndirect)))}catch{return}
        if(before&&!productNeedsEnrichment(product).any)recovered++;
      });
      append(job,recovered
        ?`${recovered} محصول با سلکتورهای بازتنظیم‌شده از خود صفحه تکمیل شد (بدون نیاز به هوش مصنوعی).`
        :'سلکتورهای بازتنظیم‌شده هم چیزی اضافه نکردند؛ توضیح‌ساز هوشمند به‌عنوان فال‌بک اجرا می‌شود.',
        recovered?'info':'warning');
    }
    await setState(key,checkpoint);
  }
  // Work on copies: checkpoints retain unadjusted source prices across retries.
  for (const product of batch) {
    rawPriceByKey.set(product.sourceKey, product.price);
  }
  await categorizeExtractedProducts(job, profile, batch.filter(p=>!(p as any)._reuseDetails));
  // AI enrichment FALLBACK: fill only what the page itself could not provide,
  // using the pinned master model. Runs after the scraper-first rescue above
  // and before save/sync, and can never fail the scrape.
  const aiSettings=await getState<any>('ai_description_settings',{enabled:true});
  if(aiSettings?.enabled!==false&&profile?.aiDescriptions!==false){
    const pending=batch.filter(product=>!(product as any)._reuseDetails&&product.price>0&&productNeedsEnrichment(product).any);
    if(pending.length){
      const previousPhase=job.phase;job.phase='ai-descriptions';await save(job);
      let filled=0,failed=0,reported='';
      await mapLimit(pending,1,async product=>{
        if(await stopRequested(job.id))return;
        try{const result=await runAiStage(job,'ai-descriptions',product,(copy,timeoutMs)=>generateProductDescription(copy,{skipCategory:true,timeoutMs}));if(result.changed)filled++;else if(!result.ok){failed++;if(!reported&&result.error)reported=result.error}}
        catch(error){failed++;if(!reported)reported=message(error)}
      });
      if(filled)append(job,`توضیحات ${filled} محصول با مدل مستر هوش مصنوعی تکمیل شد`);
      if(failed)append(job,`تکمیل توضیحات برای ${failed} محصول انجام نشد${reported?': '+reported:''}`,'warning');
      job.phase=previousPhase;await save(job);
    }
  }
  for(const product of batch){
    if(await stopRequested(job.id)){job.status='stopped';await setState(key,checkpoint);return false}
    checkpoint.index++;job.processed++;
    const previous=previousByKey.get(product.sourceKey)||null,rawPrice=rawPriceByKey.get(product.sourceKey)??product.price;
    if(rawPrice<=0||product.price<=0){
      checkpoint.retireSafe=false;
      job.skippedNoPrice=(job.skippedNoPrice||0)+1;
      append(job,`${product.title}: قیمت ندارد؛ نادیده گرفته و ذخیره نشد.`,'warning','zero-price',reportItem(product,{newPrice:rawPrice}));
      continue;
    }
    if(product.stock===0)append(job,`${product.title}: موجودی مبدأ به صفر رسیده است.`,'warning','out-of-stock',reportItem(product));

    job.phase='save';append(job,'save','stage');
    let saved=false;
    try{delete (product as any)._reuseDetails;const result=await upsertProduct(profile.id,product,{source:true});result==='added'?job.added++:job.updated++;append(job,`${product.title}: ${result==='added'?'محصول جدید ثبت شد':'اطلاعات محصول به‌روزرسانی شد'}`,'info',result,reportItem(product));saved=true}
    catch(error){const errorText=message(error);checkpoint.retireSafe=false;job.failed++;append(job,`${product.title}: ذخیره: ${errorText}`,'error','failed',reportItem(product,{error:errorText}))}
    if(saved&&previous&&previous.price>0&&product.price>0&&previous.price!==product.price){const delta=product.price-previous.price,percent=Number((delta/previous.price*100).toFixed(2));append(job,`${product.title}: قیمت ${delta>0?'افزایش':'کاهش'} یافت (${percent}٪).`,delta>0?'warning':'info',delta>0?'price-increased':'price-decreased',reportItem(product,{oldPrice:previous.price,newPrice:product.price,delta,percent}))}
    if(saved){const stored=await getProduct(profile.id,product.sourceKey);if(stored)await syncProduct(job,profile,stored);checkpoint.seen.push(product.sourceKey)}
  }
  }
  checkpoint.seen=[...new Set(checkpoint.seen)];
  if(checkpoint.index<checkpoint.products.length){await setState(key,checkpoint);await save(job);return true}
  const pageLimit=profile.pages>0?profile.pages:100;
  const hasNext=checkpoint.page<pageLimit&&(profile.pagination==='next_selector'?Boolean(checkpoint.nextUrl):profile.pagination!=='none'&&profile.pagination!=='scroll');
  if(hasNext){checkpoint.page++;checkpoint.url=profile.pagination==='next_selector'?checkpoint.nextUrl:pageUrl(profile,checkpoint.page);checkpoint.nextUrl='';checkpoint.index=0;delete checkpoint.products;await setState(key,checkpoint);await save(job);return true}
  checkpoint.retireSafe=!!checkpoint.retireSafe&&(profile.pagination==='none'||profile.pagination==='next_selector'&&!checkpoint.nextUrl);
  await finishScrape(job,profile,checkpoint);return false;
}
async function finishScrape(job:Job,profile:Profile,checkpoint:ScrapeCheckpoint):Promise<void>{
  if(job.workflow==='list-only'){checkpoint.retireSafe=false;append(job,'پایان استخراج فهرست؛ جزئیات، دسته‌بندی، توضیح‌سازی، بازنشستگی و ارسال اجرا نشد.');await setState('source_scan:'+profile.id,{jobId:job.id,complete:false,listOnly:true});return}
  job.phase='retire';
  if(checkpoint.retireSafe&&checkpoint.seen.length){
    const missing=await findMissingProducts(profile.id,checkpoint.seen),retired=await markMissingProducts(profile.id,checkpoint.seen);
    for(const product of missing.slice(0,1000))append(job,`${product.title}: دیگر در مبدأ دیده نشد و بازنشسته شد.`,'warning','removed',reportItem(product));
    if(retired)append(job,`${retired} محصول دیگر در مبدأ دیده نشد`,'warning');
  }else append(job,'اسکن کامل و قابل‌اعتماد نبود؛ برای ایمنی هیچ محصولی بازنشسته نشد.','warning');
  await setState('source_scan:'+profile.id,{jobId:job.id,complete:!!checkpoint.retireSafe&&!!checkpoint.seen.length&&!job.failed,at:new Date().toISOString(),count:checkpoint.seen.length});
  if(checkpoint.retireSafe&&job.target!=='none'){const removal=await ledgerMissing(profile.id,true,job.target==='both'?'both':job.target);if(removal.planned)append(job,`دفتر حساب: ${removal.planned} مورد حذف‌شده از مبدأ؛ ${removal.changed} اقدام طبق سیاست بازنشستگی.`)}
  await markProfileRun(profile.id);
}

async function runSyncChunk(job:Job,profile:Profile):Promise<boolean>{
  const key=stateKey(job.id),checkpoint=await getState<SyncCheckpoint>(key,{offset:0});
  if(await stopRequested(job.id)){job.status='stopped';return false}
  if(!checkpoint.applied){job.phase='apply-results';await save(job);const applied=await applyStoredResultSettings(profile,checkpoint.applyAfter||'');if(applied.conflicts)throw Error('محصولات همزمان تغییر کردند؛ برای اعمال کامل قیمت دوباره اجرا کنید.');checkpoint.applyAfter=applied.next||'';checkpoint.applied=!applied.next;await setState(key,checkpoint);await save(job);return true}
  job.phase='sync';
  const result=await listProducts(profile.id,chunkSize(),checkpoint.offset,'');job.total=result.total;
  const patterns=await codeSuffixPatterns();
  for(const product of result.products){
    if(await stopRequested(job.id)){job.status='stopped';await setState(key,checkpoint);return false}
    if(!hasCodeSuffix(String(product.title||''),patterns)){
      append(job,`${product.title}: بدون پسوند «(کد ایکس)» — هماهنگ‌سازی نشد.`,'info','sync-skipped',reportItem(product,{target:job.target,error:'پسوند کد ارسال معتبر نیست'}));
      checkpoint.offset++;job.processed++;continue;
    }
    await syncProduct(job,profile,product);
    checkpoint.offset++;job.processed++;
  }
  await setState(key,checkpoint);await save(job);
  return checkpoint.offset<result.total;
}

/**
 * Only products whose title carries a «(کد ایکس)» suffix are published. Titles
 * without one are base/draft entries that must never reach a destination shop.
 */
async function codeSuffixPatterns():Promise<RegExp[]>{
  const settings=await getState<any>('settings',{});
  return suffixPatterns(parseSuffixFormats(settings?.dedup?.suffixFormats||''));
}
async function syncProduct(job:Job,profile:Profile,product:Product):Promise<void>{
  if(job.target==='none')return;job.phase='sync';await save(job);
  if(product.price<=0||(profile.minPrice&&product.price<profile.minPrice)){append(job,`${product.title}: قیمت نهایی معتبر یا بالاتر از حداقل ارسال نیست؛ در نتایج باقی ماند و ارسال نشد.`,'warning','sync-skipped',reportItem(product,{target:job.target,error:'قیمت کمتر از حداقل ارسال'}));return;}
  if(job.target==='woo'||job.target==='both'){job.phase='sync-woo';await save(job);try{const action=await syncWoo(product,profile);append(job,`${product.title} [WooCommerce]: ${action==='unchanged'?'مطابق دفتر حساب؛ بدون ارسال':action==='created'?'ایجاد':'به‌روزرسانی'} شد.`,'info',action==='unchanged'?'sync-skipped':action==='created'?'sync-created':'sync-updated',reportItem(product,{target:'woo',shop:'فروشگاه ووکامرس'}))}catch(error){const errorText=message(error);job.failed++;append(job,`${product.title} [WooCommerce]: ${errorText}`,'error','failed',reportItem(product,{target:'woo',error:errorText}))}}
  // Basalam publishes to EVERY stall. Each stall is reported on its own line and
  // a failure in one must not abandon the others: the whole loop used to sit in
  // a single try/catch, so one bad stall silently cancelled the rest and hid the
  // successes that had already happened.
  if(job.target==='basalam'||job.target==='both'){
    job.phase='sync-basalam';await save(job);
    let results:Awaited<ReturnType<typeof syncBasalam>>=[];
    try{results=await syncBasalam(product,profile)}
    catch(error){const errorText=message(error);job.failed++;append(job,`${product.title} [Basalam]: ${errorText}`,'error','failed',reportItem(product,{target:'basalam',error:errorText}))}
    for(const result of results){
      if(result.error){
        job.failed++;
        append(job,`${product.title} [Basalam · ${result.shop}]: ${result.error}`,'error','failed',reportItem(product,{target:'basalam',shop:result.shop,price:result.price,error:result.error,transport:result.transport}));
        continue;
      }
      append(job,`${product.title} [Basalam · ${result.shop}]: ${result.action==='unchanged'?'مطابق دفتر حساب؛ بدون ارسال':result.action==='created'?'ایجاد':'به‌روزرسانی'} شد.${result.action!=='unchanged'&&result.transport?` (${result.transport==='sdk'?'SDK':'API'})`:''}`,'info',result.action==='unchanged'?'sync-skipped':result.action==='created'?'sync-created':'sync-updated',reportItem(product,{target:'basalam',shop:result.shop,price:result.price,transport:result.transport}));
    }
  }
}

export async function retryAndEnqueue(id:string,waitUntil?:(promise:Promise<unknown>)=>void):Promise<Job|null>{
  const job=await getJob(id);if(!job)return null;
  await deleteState(stateKey(id));
  await updateJob(id,{status:'queued',phase:'waiting',stopRequested:false,error:null,finishedAt:null,processed:0,added:0,updated:0,failed:0,log:[]});
  const queued=await getJob(id);if(queued)await enqueueJob(queued,waitUntil);return queued;
}

/** Category assignment is a separate post-extraction stage, not a description toggle. */
async function categorizeExtractedProducts(job: Job, profile: { basalamCategoryId: number; minPrice: number }, products: Product[]): Promise<void> {
  const pending = products.filter(product => product.price > 0 && productNeedsBasalamCategory(product));
  if (!pending.length) return;
  const previousPhase = job.phase;
  job.phase = 'basalam-categories'; await save(job);
  let enrichCategories: any[] = [];
  try { enrichCategories = (await runAiStage(job,'category-taxonomy',{},async()=>({ok:true,value:await destinationCategories()}))).value?.items||[]; } catch { /* manual/learned categories still work offline */ }
  let filled = 0, failed = 0, reported = '';
  await mapLimit(pending, 1, async product => {
    if (await stopRequested(job.id)) return;
    try {
      const result = await runAiStage(job,'basalam-categories',product,(copy,timeoutMs)=>assignProductBasalamCategory(copy, { categories: enrichCategories, profileCategoryId: profile.basalamCategoryId, timeoutMs }));
      if (result.changed) filled++;
      if (!result.ok) { failed++; if (!reported) reported = result.error || ''; }
    } catch (error) { failed++; if (!reported) reported = message(error); }
  });
  if (filled) append(job, `دسته‌بندی باسلام ${filled} محصول پیش از تولید توضیحات تعیین شد.`);
  if (failed) append(job, `دسته‌بندی باسلام ${failed} محصول تعیین نشد${reported ? ': ' + reported : ''}؛ استخراج ادامه دارد.`, 'warning');
  job.phase = previousPhase; await save(job);
}

const aiStageRunners=new WeakMap<Job,ReturnType<typeof createAiStageRunner>>();
async function runAiStage(job:Job,stage:string,product:any,work:(copy:any,timeoutMs:number)=>Promise<any>):Promise<any>{
 let runner=aiStageRunners.get(job);
 if(!runner){const key='job_ai:'+job.id,states=await getState<any>(key,{}),settings=await getState<any>('settings',{});runner=createAiStageRunner({settings,states,persist:()=>setState(key,states),log:(_stage,text)=>append(job,text,'warning'),progress:()=>save(job)});aiStageRunners.set(job,runner)}
 return runner(stage,product,work);
}
