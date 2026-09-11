import { allProducts, claimJob, getJob, getProfile, getState, markMissingProducts, markProfileRun, saveProfile, stopRequested, updateJob, upsertProduct } from './db.js';
import { mapLimit, pageUrl, scrapeDetails, scrapeListWithMeta, suggestSelectors, transformProduct } from './scraper.js';
import { syncBasalam, syncWoo } from './sync.js';
import { hasCodeSuffix, parseSuffixFormats, suffixPatterns } from '../worker-src/dedup.js';
import { generateProductDescription, productNeedsEnrichment } from './ai.js';
import type { Job, Product } from './types.js';

let stopping = false;
export function requestWorkerStop(): void { stopping = true; }

function append(job: Job, message: string, level = 'info', event?: Job['log'][number]['event'], item?: Job['log'][number]['item']): void {
  job.log.push({ at: new Date().toISOString(), level, message, event, item });
  // The dashboard counters are clickable and read this log to list the product
  // name, its price and the error text, so the Node runtime keeps as much
  // history as the Worker instead of the old 200-line window.
  if (job.log.length > 1500) job.log = job.log.slice(-1500);
}
function reportItem(product: Product, extra: Partial<NonNullable<Job['log'][number]['item']>> = {}): NonNullable<Job['log'][number]['item']> {
  return { sourceKey: product.sourceKey, title: product.title, url: product.url, price: Number(product.price) || undefined, ...extra };
}
async function save(job: Job): Promise<void> { const current=await getJob(job.id); if(current&&['stopped','failed','done'].includes(current.status)&&current.status!==job.status)return; if(current?.stopRequested&&job.status==='running'){job.status='stopped';job.phase='finished';job.finishedAt=new Date().toISOString();append(job,'عملیات با توقف اجباری کاربر بسته شد.','warning')} await updateJob(job.id, { status: job.status, phase: job.phase, total: job.total, processed: job.processed, added: job.added, updated: job.updated, failed: job.failed, error: job.error, log: job.log, finishedAt: job.finishedAt }); }
const MANUAL_LIST_ENGINES=new Set(['htmlrewriter','cheerio']);
function isManualListEngine(engine?: string): boolean { return !!engine && MANUAL_LIST_ENGINES.has(engine); }
async function applySelectorSuggestions(profile: NonNullable<Awaited<ReturnType<typeof getProfile>>>, url: string, mode: 'list'|'detail', job: Job, onlyMissing = true): Promise<number> { try { const suggested=await suggestSelectors(url,mode),entries=Object.entries(suggested.selectors||{}).filter(([key,value])=>String(value||'').trim()&&(!onlyMissing||!String((profile.selectors as any)?.[key]||'').trim())); if(!entries.length)return 0; profile.selectors={...profile.selectors,...Object.fromEntries(entries)} as any; await saveProfile({...profile,updatedAt:new Date().toISOString()}); append(job,`${mode==='list'?'سلکتورهای ناقص فهرست':'سلکتورهای ناقص جزئیات'} با کشف خودکار تکمیل شد: ${entries.map(([key])=>key).join(', ')}`); return entries.length; } catch(error) { append(job,`شناسایی خودکار سلکتورهای ${mode==='list'?'فهرست':'جزئیات'} ناموفق بود: ${message(error)}`,'warning'); return 0; } }

const LIST_KEYS = ['container','title','price','link','image'] as const;
const DETAIL_KEYS = ['shortDesc','longDesc','sku','brand','category','stock','weight','gallery','detailImage','variations'] as const;
/** True when the profile actually configures detail extraction. */
function hasDetailSelectors(selectors: any): boolean {
  return DETAIL_KEYS.some(key => String(selectors?.[key] || '').trim());
}
/** Scrapes one product and reports whether ANY detail field was populated. */
async function detailProbe(sample: Product, selectors: any): Promise<boolean> {
  try {
    const before = JSON.stringify(DETAIL_KEYS.map(key => (sample as any)[key] ?? null));
    const probe = await scrapeDetails({ ...sample }, selectors);
    return JSON.stringify(DETAIL_KEYS.map(key => (probe as any)[key] ?? null)) !== before;
  } catch { return false; }
}

export async function processOneJob(): Promise<boolean> {
  const job = await claimJob(); if (!job) return false;
  try {
    const profile = await getProfile(job.profileId); if (!profile) throw new Error('Profile not found');
    append(job, `شروع ${job.kind === 'scrape' ? 'استخراج' : 'همگام‌سازی'} «${profile.name}»`);
    if (job.kind === 'scrape') {
      job.phase = 'list'; await save(job); const found = new Map<string, Product>(); let autoSelectorsAllowed=false; let listRescued=false; let detailRescued=false;
      // pages === 0 means "auto" everywhere in the UI: keep paging until an
      // empty page, with the same 100-page safety cap the Worker uses. Looping
      // to profile.pages directly made a 0-page profile scan nothing at all and
      // report a successful run with zero products.
      const pageLimit = profile.pages > 0 ? profile.pages : 100;
      // TRIGGER 1 (selectors empty): the Worker already fills blank list
      // selectors before the first fetch; Node did not, so a fresh profile with
      // no selectors relied purely on the discovery engines.
      if (!LIST_KEYS.some(key => String((profile.selectors as any)?.[key] || '').trim())) {
        append(job, 'سلکتورهای فهرست خالی است؛ پیشنهاد خودکار اجرا می‌شود…');
        await applySelectorSuggestions(profile, pageUrl(profile, 1), 'list', job, true);
      }
      for (let page = 1; page <= pageLimit; page++) {
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
        if (!list.length) {
          // LAST-RESORT FALLBACK: the page was fetched but nothing came out of
          // it -- empty selectors, selectors that no longer match the site, or
          // an engine that found no cards. Before giving up, run the same
          // discovery the "auto suggest" button uses and retry the page ONCE.
          // onlyMissing=false because selectors that exist but match nothing are
          // exactly the failure being recovered from.
          if (page === 1 && !listRescued) {
            listRescued = true;
            append(job, 'هیچ محصولی استخراج نشد؛ پیشنهاد خودکار سلکتورها به‌عنوان آخرین راه اجرا می‌شود…', 'warning');
            const filled = await applySelectorSuggestions(profile, url, 'list', job, false);
            if (filled) {
              const retry = await scrapeListWithMeta(url, profile.selectors, profile.extractionEngine, profile.extractionEngineMaster);
              if (retry.products.length) {
                append(job, `پیشنهاد خودکار جواب داد: ${retry.products.length} محصول پس از بازتنظیم سلکتورها پیدا شد.`);
                if (retry.usedEngine) { profile.extractionEngineMaster = retry.usedEngine; await saveProfile({ ...profile, updatedAt: new Date().toISOString() }); }
                page--; continue; // re-run this page with the repaired selectors
              }
              append(job, 'پیشنهاد خودکار هم محصولی پیدا نکرد؛ سلکتورها را دستی بررسی کنید.', 'warning');
            }
          }
          append(job, 'محصولی پیدا نشد', 'warning'); break;
        }
        const before = found.size;
        for (const raw of list) { const p = transformProduct(raw, profile); if (!profile.minPrice || p.price >= profile.minPrice) found.set(p.sourceKey, p); }
        job.total = found.size; job.processed += list.length; await save(job);
        // Auto paging (pages = 0) stops as soon as a page adds nothing new.
        // Misconfigured pagination often returns page 1 forever, which would
        // otherwise re-scan the same page up to the safety cap.
        if (profile.pages === 0 && page > 1 && found.size === before) { append(job, `صفحهٔ ${page} محصول تازه‌ای نداشت؛ صفحه‌بندی همین‌جا پایان یافت.`); break; }
      }
      if (job.status !== 'stopped') {
        job.phase = 'details'; const products = [...found.values()]; const sample=products.find(p=>p.url); if(sample?.url&&autoSelectorsAllowed)await applySelectorSuggestions(profile,sample.url,'detail',job,true); await save(job);
        // LAST-RESORT FALLBACK for the detail stage: probe one real product
        // first. If the configured detail selectors enrich nothing at all, the
        // whole stage would silently return empty descriptions for every
        // product, so rediscover the detail selectors and re-probe once.
        // No detail selectors at all: discovering them is the only way this
        // stage can enrich anything, so do it before fetching every product.
        if (sample?.url && !hasDetailSelectors(profile.selectors) && !detailRescued) {
          detailRescued = true;
          append(job, 'هیچ سلکتور جزئیاتی تنظیم نشده؛ ابتدا به‌صورت خودکار کشف می‌شوند…', 'warning');
          const filled = await applySelectorSuggestions(profile, sample.url, 'detail', job, false);
          append(job, filled && hasDetailSelectors(profile.selectors)
            ? 'سلکتورهای جزئیات خودکار پیدا شدند؛ استخراج جزئیات ادامه می‌یابد.'
            : 'سلکتور جزئیاتی پیدا نشد؛ مرحلهٔ جزئیات رد می‌شود تا صفحات بی‌دلیل دانلود نشوند.',
            filled && hasDetailSelectors(profile.selectors) ? 'info' : 'warning');
        }
        if (sample?.url && hasDetailSelectors(profile.selectors)) {
          const probe = await detailProbe(sample, profile.selectors);
          if (!probe && !detailRescued) {
            detailRescued = true;
            append(job, 'سلکتورهای جزئیات هیچ فیلدی را پر نکردند؛ پیشنهاد خودکار به‌عنوان آخرین راه اجرا می‌شود…', 'warning');
            const filled = await applySelectorSuggestions(profile, sample.url, 'detail', job, false);
            if (filled && await detailProbe(sample, profile.selectors)) append(job, 'پیشنهاد خودکار جواب داد: سلکتورهای جزئیات بازتنظیم شدند.');
            else if (filled) append(job, 'پیشنهاد خودکار هم فیلدی پیدا نکرد؛ سلکتورهای جزئیات را دستی بررسی کنید.', 'warning');
          }
        }
        if (hasDetailSelectors(profile.selectors)) {
          await mapLimit(products, Math.max(1, Number(process.env.DETAIL_CONCURRENCY || 4)), async product => {
            if (await stopRequested(job.id)) return;
            try { await scrapeDetails(product, profile.selectors); }
            catch (error) { job.failed++; append(job, `${product.title}: ${message(error)}`, 'error'); }
          });
          append(job, `استخراج جزئیات ${products.length} محصول انجام شد.`);
        }
        // SCRAPER-FIRST RESCUE (before any AI): products can come back with an
        // empty description simply because the detail selectors do not match
        // THIS product's template (shops routinely mix layouts). Rediscover the
        // detail selectors from a product that is actually missing data and
        // re-scrape just those products. The AI description generator below is
        // the fallback, not the first responder -- real page content always
        // beats generated text.
        const needsDetail = products.filter(product => product.url && productNeedsEnrichment(product).any);
        if (needsDetail.length && !detailRescued) {
          detailRescued = true;
          const probeUrl = needsDetail[0].url;
          append(job, `${needsDetail.length} محصول بدون توضیحات ماند؛ ابتدا موتور استخراج دوباره سلکتورهای جزئیات را پیدا می‌کند…`);
          const filled = await applySelectorSuggestions(profile, probeUrl, 'detail', job, false);
          if (filled) {
            let recovered = 0;
            await mapLimit(needsDetail, Math.max(1, Number(process.env.DETAIL_CONCURRENCY || 4)), async product => {
              if (await stopRequested(job.id)) return;
              const before = productNeedsEnrichment(product).any;
              try { await scrapeDetails(product, profile.selectors); } catch { return; }
              if (before && !productNeedsEnrichment(product).any) recovered++;
            });
            append(job, recovered
              ? `${recovered} محصول با سلکتورهای بازتنظیم‌شده از خود صفحه تکمیل شد (بدون نیاز به هوش مصنوعی).`
              : 'سلکتورهای بازتنظیم‌شده هم چیزی اضافه نکردند؛ توضیح‌ساز هوشمند به‌عنوان فال‌بک اجرا می‌شود.',
              recovered ? 'info' : 'warning');
          }
        }
        // AI enrichment FALLBACK: fill only what the page itself could not
        // provide, using the pinned master model. A failure here must never
        // fail the scrape, so each product is guarded.
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
  // Only products whose title carries a «(کد ایکس)» suffix are published; the
  // rest are base/draft titles that must never reach a destination shop.
  const settings = await getState<any>('settings', {});
  const patterns = suffixPatterns(parseSuffixFormats((settings as any)?.dedup?.suffixFormats || ''));
  for (const product of products) {
    if (await stopRequested(job.id)) { job.status = 'stopped'; return; }
    if (!hasCodeSuffix(String(product.title || ''), patterns)) {
      append(job, `${product.title}: بدون پسوند «(کد ایکس)» — هماهنگ‌سازی نشد.`, 'info');
      job.processed++; if (job.processed % 5 === 0) await save(job);
      continue;
    }
    if (job.target === 'woo' || job.target === 'both') {
      try {
        const action = await syncWoo(product, profile);
        append(job, `${product.title} [WooCommerce]: ${action === 'created' ? 'ایجاد' : 'به‌روزرسانی'} شد.`, 'info', action === 'created' ? 'sync-created' : 'sync-updated', reportItem(product, { target: 'woo', shop: 'فروشگاه ووکامرس' }));
      } catch (error) {
        const errorText = message(error); job.failed++;
        append(job, `${product.title} [WooCommerce]: ${errorText}`, 'error', 'failed', reportItem(product, { target: 'woo', error: errorText }));
      }
    }
    if (job.target === 'basalam' || job.target === 'both') {
      // Every stall gets its own log line so a failure in one stall neither
      // hides the others' success nor stops the send.
      let results: Awaited<ReturnType<typeof syncBasalam>> = [];
      try { results = await syncBasalam(product, profile); }
      catch (error) {
        const errorText = message(error); job.failed++;
        append(job, `${product.title} [Basalam]: ${errorText}`, 'error', 'failed', reportItem(product, { target: 'basalam', error: errorText }));
      }
      for (const result of results) {
        if (result.error) {
          job.failed++;
          append(job, `${product.title} [Basalam · ${result.shop}]: ${result.error}`, 'error', 'failed', reportItem(product, { target: 'basalam', shop: result.shop, price: result.price, error: result.error, transport: result.transport }));
          continue;
        }
        append(job, `${product.title} [Basalam · ${result.shop}]: ${result.action === 'created' ? 'ایجاد' : 'به‌روزرسانی'} شد.${result.transport ? ` (${result.transport === 'sdk' ? 'SDK' : 'API'})` : ''}`, 'info', result.action === 'created' ? 'sync-created' : 'sync-updated', reportItem(product, { target: 'basalam', shop: result.shop, price: result.price, transport: result.transport }));
      }
    }
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
