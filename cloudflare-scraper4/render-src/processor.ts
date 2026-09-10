import { allProducts, claimJob, getJob, getProfile, getState, markMissingProducts, markProfileRun, saveProfile, stopRequested, updateJob, upsertProduct } from './db.js';
import { mapLimit, pageUrl, scrapeDetails, scrapeListWithMeta, suggestSelectors, transformProduct } from './scraper.js';
import { syncBasalam, syncWoo } from './sync.js';
import { generateProductDescription, productNeedsEnrichment } from './ai.js';
import type { Job, Product } from './types.js';

let stopping = false;
export function requestWorkerStop(): void { stopping = true; }

function append(job: Job, message: string, level = 'info'): void {
  job.log.push({ at: new Date().toISOString(), level, message });
  if (job.log.length > 200) job.log = job.log.slice(-200);
}
async function save(job: Job): Promise<void> { const current=await getJob(job.id); if(current&&['stopped','failed','done'].includes(current.status)&&current.status!==job.status)return; if(current?.stopRequested&&job.status==='running'){job.status='stopped';job.phase='finished';job.finishedAt=new Date().toISOString();append(job,'عملیات با توقف اجباری کاربر بسته شد.','warning')} await updateJob(job.id, { status: job.status, phase: job.phase, total: job.total, processed: job.processed, added: job.added, updated: job.updated, failed: job.failed, error: job.error, log: job.log, finishedAt: job.finishedAt }); }
const MANUAL_LIST_ENGINES=new Set(['htmlrewriter','cheerio']);
function isManualListEngine(engine?: string): boolean { return !!engine && MANUAL_LIST_ENGINES.has(engine); }
async function applySelectorSuggestions(profile: NonNullable<Awaited<ReturnType<typeof getProfile>>>, url: string, mode: 'list'|'detail', job: Job, onlyMissing = true): Promise<void> { try { const suggested=await suggestSelectors(url,mode),entries=Object.entries(suggested.selectors||{}).filter(([key,value])=>String(value||'').trim()&&(!onlyMissing||!String((profile.selectors as any)?.[key]||'').trim())); if(!entries.length)return; profile.selectors={...profile.selectors,...Object.fromEntries(entries)} as any; await saveProfile({...profile,updatedAt:new Date().toISOString()}); append(job,`${mode==='list'?'سلکتورهای ناقص فهرست':'سلکتورهای ناقص جزئیات'} با کشف خودکار تکمیل شد: ${entries.map(([key])=>key).join(', ')}`); } catch(error) { append(job,`شناسایی خودکار سلکتورهای ${mode==='list'?'فهرست':'جزئیات'} ناموفق بود: ${message(error)}`,'warning'); } }

export async function processOneJob(): Promise<boolean> {
  const job = await claimJob(); if (!job) return false;
  try {
    const profile = await getProfile(job.profileId); if (!profile) throw new Error('Profile not found');
    append(job, `شروع ${job.kind === 'scrape' ? 'استخراج' : 'همگام‌سازی'} «${profile.name}»`);
    if (job.kind === 'scrape') {
      job.phase = 'list'; await save(job); const found = new Map<string, Product>(); let autoSelectorsAllowed=false;
      for (let page = 1; page <= profile.pages; page++) {
        if (await stopRequested(job.id)) { job.status = 'stopped'; break; }
        const url = pageUrl(profile, page); append(job, `صفحه ${page}: ${url}`);
        const scraped = await scrapeListWithMeta(url, profile.selectors, profile.extractionEngine, profile.extractionEngineMaster);
        const list = scraped.products;
        if (scraped.usedEngine && list.length && (profile.extractionEngine === 'auto' || profile.extractionEngineMaster !== scraped.usedEngine)) {
          profile.extractionEngineMaster = scraped.usedEngine;
          profile.extractionEngineHost = new URL(url).hostname;
          profile.extractionEngineMs = scraped.elapsedMs;
          await saveProfile({...profile, updatedAt: new Date().toISOString()});
          append(job, `موتور مستر این پروفایل: ${scraped.usedEngine}${scraped.elapsedMs ? ` · ${scraped.elapsedMs}ms` : ''}`);
        }
        if (scraped.usedEngine && list.length && !isManualListEngine(scraped.usedEngine)) { autoSelectorsAllowed=true; await applySelectorSuggestions(profile,url,'list',job,true); }
        if (!list.length) { append(job, 'محصولی پیدا نشد', 'warning'); break; }
        for (const raw of list) { const p = transformProduct(raw, profile); if (!profile.minPrice || p.price >= profile.minPrice) found.set(p.sourceKey, p); }
        job.total = found.size; job.processed += list.length; await save(job);
      }
      if (job.status !== 'stopped') {
        job.phase = 'details'; const products = [...found.values()]; const sample=products.find(p=>p.url); if(sample?.url&&autoSelectorsAllowed)await applySelectorSuggestions(profile,sample.url,'detail',job,true); await save(job);
        await mapLimit(products, Math.max(1, Number(process.env.DETAIL_CONCURRENCY || 4)), async product => {
          if (await stopRequested(job.id)) return;
          try { await scrapeDetails(product, profile.selectors); }
          catch (error) { job.failed++; append(job, `${product.title}: ${message(error)}`, 'error'); }
        });
        // AI enrichment: fill descriptions / variations the source page did not
        // provide, using the pinned master model. Always-on by default; a
        // failure here must never fail the scrape, so each product is guarded.
        const aiSettings = await getState<any>('ai_description_settings', { enabled: true });
        if (aiSettings?.enabled !== false) {
          const pending = products.filter(product => productNeedsEnrichment(product).any);
          if (pending.length) {
            job.phase = 'ai-descriptions'; await save(job);
            let filled = 0, failed = 0; let reported = '';
            await mapLimit(pending, Math.max(1, Number(process.env.AI_DESCRIPTION_CONCURRENCY || 2)), async product => {
              if (await stopRequested(job.id)) return;
              try {
                const result = await generateProductDescription(product);
                if (result.changed) filled++;
                else if (!result.ok) { failed++; if (!reported && result.error) reported = result.error; }
              } catch (error) { failed++; if (!reported) reported = message(error); }
            });
            if (filled) append(job, `توضیحات ${filled} محصول با مدل مستر هوش مصنوعی تکمیل شد`);
            if (failed) append(job, `تکمیل توضیحات برای ${failed} محصول انجام نشد${reported ? ': ' + reported : ''}`, 'warning');
          }
        }
        job.phase = 'save'; await save(job);
        for (const product of products) { const result = await upsertProduct(profile.id, product); result === 'added' ? job.added++ : job.updated++; }
        const retired=await markMissingProducts(profile.id,products.map(p=>p.sourceKey));if(retired)append(job,`${retired} محصول دیگر در مبدأ دیده نشد`,'warning');
        await markProfileRun(profile.id);
        if (job.target !== 'none') await runSync(job, profile, products);
      }
    } else {
      await runSync(job, profile, await allProducts(profile.id));
    }
    if (job.status !== 'stopped') job.status = 'done';
    append(job, job.status === 'done' ? 'عملیات با موفقیت تمام شد' : 'عملیات متوقف شد');
  } catch (error) { job.status = 'failed'; job.error = message(error); append(job, job.error, 'error'); }
  job.finishedAt = new Date().toISOString(); job.phase = 'finished'; await save(job); return true;
}

async function runSync(job: Job, profile: Awaited<ReturnType<typeof getProfile>> & {}, products: Product[]): Promise<void> {
  job.phase = 'sync'; job.total = products.length; job.processed = 0; await save(job);
  for (const product of products) {
    if (await stopRequested(job.id)) { job.status = 'stopped'; return; }
    try {
      if (job.target === 'woo' || job.target === 'both') await syncWoo(product, profile);
      if (job.target === 'basalam' || job.target === 'both') await syncBasalam(product, profile);
    } catch (error) { job.failed++; append(job, `${product.title}: ${message(error)}`, 'error'); }
    job.processed++; if (job.processed % 5 === 0) await save(job);
  }
}

export async function workerLoop(pollMs: number): Promise<void> {
  console.log(`Scraper worker started; poll=${pollMs}ms`);
  while (!stopping) {
    try { if (!await processOneJob()) await sleep(pollMs); }
    catch (error) { console.error('Worker loop error', error); await sleep(Math.max(2000, pollMs)); }
  }
  console.log('Scraper worker stopped');
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
