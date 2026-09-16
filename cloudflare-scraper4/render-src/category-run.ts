/**
 * Server-side bulk Basalam category runs for the Node runtime (Termux / VPS /
 * Render / local / Passenger).
 *
 * The Cloudflare Worker has had «دسته‌بندی همهٔ تأییدنشده‌ها» for a long time,
 * but the Node runtime answered every category endpoint with 501, so the
 * shared dashboard's category buttons silently did nothing on every
 * non-Cloudflare install.
 *
 * The Worker version is built around Queues + D1 checkpoints because a Worker
 * invocation has a hard CPU budget. Node has no such limit, so the run executes
 * in-process here (the same pattern as ./dedup-run.ts), while persisting the
 * very same state shape through `getState`/`setState` so the run survives a
 * restart and the dashboard — which is shared by both runtimes — sees exactly
 * the fields it already expects. The voting algorithm, tried-category memory,
 * and per-product PATCH flow mirror worker-src/background.ts product for
 * product (including the majority-threshold early stop), so both runtimes
 * categorize identically.
 */
import { randomUUID } from 'node:crypto';
import { isChatCompatibleAiModel } from '../worker-src/ai-catalog.js';
import { CATEGORY_FIX_LAST_KEY, categoryFixPinnedModels, normalizeCategoryFixPinned, normalizeCategoryMode, selectCategoryModels } from '../worker-src/destination-core.js';
import { aiProviders, suggestCategoryWithModel } from './ai.js';
import { loadConnections } from './connections.js';
import { getState, getTriedBasalamCategories, markBasalamCategoriesTried, setState } from './db.js';
import { applyBasalamCategory, destinationCatalog, destinationCategories } from './maintenance.js';

export type CategoryRunStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed';
type CategoryProduct = { id: number; shopId: string; title: string; categoryId?: number };
export type CategoryRunItem = { id: number; shopId: string; title: string; ok: boolean; categoryId?: number; categoryName?: string; source?: string; confidence?: number; error?: string };
export type CategoryRun = {
  id: string; kind: 'category-all'; status: CategoryRunStatus; phase: string; stopRequested: boolean;
  createdAt: string; updatedAt: string; startedAt: string | null; finishedAt: string | null;
  attempts: number; error: string | null; modelKeys: string[]; mode: string;
  page: number; totalPages: number; products: CategoryProduct[]; cursor: number;
  total: number; processed: number; changed: number; failed: number; items: CategoryRunItem[];
};

const RUN_KEY = 'background_run:category-all';
const CATEGORY_BATCH = 5;
const now = () => new Date().toISOString();
const active = (run: CategoryRun | null) => Boolean(run && ['queued', 'running', 'paused'].includes(run.status));

/** Strips the heavy product list the dashboard never renders, exactly like the Worker. */
function publicRun(run: CategoryRun | null): any {
  if (!run) return null;
  const { products, ...safe } = run;
  return safe;
}

async function readRun(): Promise<CategoryRun | null> { return await getState<CategoryRun | null>(RUN_KEY, null); }
async function writeRun(run: CategoryRun): Promise<void> { run.updatedAt = now(); await setState(RUN_KEY, run); }

export async function getPublicCategoryRun(): Promise<any> { return publicRun(await readRun()); }

export async function resetCategoryRun(): Promise<void> { await setState(RUN_KEY, null); }

/**
 * Models eligible to vote, capped at 5. Mirrors the Worker's
 * successfulCategoryModels(): every enabled chat-compatible model is configured,
 * the green set from the last server-side AI test only gates the automatic
 * ensemble, and manually pinned masters/candidates always run. Candidates the
 * user pinned come first, then every other configured model. Node providers are
 * OpenAI-compatible chat endpoints, so only the explicit non-chat lists opt a
 * model out (per-provider nonChatModels plus OpenRouter's dedicated models).
 */
export async function successfulCategoryModels(mode?: any, pinned: string[] = []): Promise<string[]> {
  const [tests, connections] = await Promise.all([getState<any>('ai_test_results', null), loadConnections()]);
  const green = new Set((Array.isArray(tests?.results) ? tests.results : []).filter((row: any) => row?.ok === true).map((row: any) => `${row.provider}::${row.model}`));
  const ai = connections.ai, candidates = Array.isArray(ai.candidates) ? ai.candidates.map(String) : [], providers = await aiProviders(), configured: string[] = [];
  for (const provider of providers) if (provider.enabled !== false) for (const model of provider.models || []) {
    const key = `${provider.id}::${model}`;
    if (model && isChatCompatibleAiModel(provider, model)) configured.push(key);
  }
  return selectCategoryModels({ mode, master: (ai as any).master, candidates, configured, green, pinned });
}

let running = false;

export async function startCategoryRun(input?: any): Promise<{ run: any; existing: boolean }> {
  const previous = await readRun();
  if (previous && active(previous)) return { run: publicRun(previous), existing: true };
  const mode = normalizeCategoryMode(input?.mode), explicit = normalizeCategoryFixPinned(input?.consensusModels), stored = categoryFixPinnedModels(await getState<any>('settings', {})), pinned = explicit.length ? explicit : stored, modelKeys = await successfulCategoryModels(mode, pinned);
  if (!modelKeys.length) throw new Error(pinned.length ? 'مدل‌های انتخاب‌شده در اجتماع دیگر در میان مدل‌های پیکربندی‌شده نیستند؛ فهرست اجتماع را به‌روزرسانی کنید یا آن را خالی بگذارید.' : 'هیچ مدل موفقی برای دسته‌بندی پیدا نشد؛ ابتدا تست سرورساید مدل‌ها را کامل کنید.');
  // Fail fast before starting a long job when the category connection is incomplete.
  await destinationCategories();
  const timestamp = now();
  const run: CategoryRun = {
    id: randomUUID(), kind: 'category-all', status: 'queued', phase: 'listing', stopRequested: false,
    createdAt: timestamp, updatedAt: timestamp, startedAt: null, finishedAt: null,
    attempts: 0, error: null, modelKeys, mode, page: 1, totalPages: 1, products: [], cursor: 0,
    total: 0, processed: 0, changed: 0, failed: 0, items: [],
  };
  await writeRun(run);
  await setState(CATEGORY_FIX_LAST_KEY, { at: timestamp, ok: true, trigger: input?.trigger === 'periodic' ? 'periodic' : 'manual', mode, runId: run.id });
  void drive();
  return { run: publicRun(run), existing: false };
}

export async function controlCategoryRun(action: 'stop' | 'resume'): Promise<any> {
  const run = await readRun();
  if (!run) throw new Error('اجرای پس‌زمینه‌ای پیدا نشد.');
  if (action === 'stop') {
    if (['done', 'failed'].includes(run.status)) return publicRun(run);
    run.stopRequested = true; run.status = 'paused'; run.phase = 'paused';
    await writeRun(run); return publicRun(run);
  }
  if (!['paused', 'failed'].includes(run.status)) return publicRun(run);
  run.stopRequested = false; run.status = 'queued';
  run.phase = run.products.length === 0 ? 'listing' : 'categorizing';
  run.error = null; run.finishedAt = null; run.attempts = 0;
  await writeRun(run);
  void drive();
  return publicRun(run);
}

/** Runs the whole job in-process, checkpointing after each step. */
async function drive(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const run = await readRun();
      if (!run || ['done', 'failed', 'paused'].includes(run.status) || run.stopRequested) return;
      run.status = 'running'; run.startedAt ||= now();
      try {
        if (run.phase === 'listing') await listCategoryProducts(run);
        else await categorizeBatch(run);
        await writeRun(run);
      } catch (error) {
        run.attempts = (run.attempts || 0) + 1;
        run.error = error instanceof Error ? error.message : String(error);
        run.status = 'failed'; run.phase = 'failed'; run.finishedAt = now();
        await writeRun(run);
        return;
      }
    }
  } finally { running = false; }
}

async function listCategoryProducts(run: CategoryRun): Promise<void> {
  const data: any = await destinationCatalog('basalam', { page: run.page, perPage: 100, status: '3567', shopId: 'all' });
  const seen = new Set(run.products.map(row => `${row.shopId}:${row.id}`));
  for (const raw of data.products || []) {
    const row = { id: Number(raw.id), shopId: String(raw.shopId || ''), title: String(raw.title || raw.name || '').trim(), categoryId: Number(raw.categoryId || raw.category_id || raw.raw?.category_id || 0) || undefined };
    const key = `${row.shopId}:${row.id}`;
    if (row.id > 0 && row.title && !seen.has(key)) { seen.add(key); run.products.push(row); }
  }
  run.totalPages = Math.max(run.totalPages, Number(data.totalPages) || 1);
  run.total = Math.max(Number(data.total) || 0, run.products.length);
  run.attempts = 0;
  if (run.page < run.totalPages) { run.page++; run.phase = 'listing'; }
  else { run.total = run.products.length; run.phase = 'categorizing'; }
}

function compactCategoryItem(row: any): CategoryRunItem {
  return {
    id: Number(row.id), shopId: String(row.shopId || ''), title: String(row.title || ''), ok: Boolean(row.ok),
    ...(row.categoryId ? { categoryId: Number(row.categoryId) } : {}),
    ...(row.categoryName ? { categoryName: String(row.categoryName) } : {}),
    ...(row.source ? { source: String(row.source) } : {}),
    ...(row.confidence ? { confidence: Number(row.confidence) } : {}),
    ...(row.error ? { error: String(row.error).slice(0, 500) } : {}),
  };
}

function appendCategoryItem(run: CategoryRun, item: CategoryRunItem): void {
  run.items.push(compactCategoryItem(item));
  if (run.items.length > 300) run.items = run.items.slice(-300);
}

async function categorizeProduct(run: CategoryRun, product: CategoryProduct, categories: any[]): Promise<boolean> {
  // Returns false when the user asked to stop.
  const currentCategory = Number(product.categoryId) || 0;
  const tried = new Set(await getTriedBasalamCategories(product.shopId, product.id));
  // Sequential voting with early stop: models answer one by one; as soon as a category
  // reaches the majority threshold we stop asking the remaining models.
  const modelKeys = run.modelKeys, threshold = Math.floor(modelKeys.length / 2) + 1, votes = new Map<number, { count: number; row: any }>(), triedHits: number[] = [];
  let responded = 0;
  for (const key of modelKeys) {
    responded++;
    let suggestion: any;
    try { suggestion = await suggestCategoryWithModel(product.title, key, categories); }
    catch (error) { suggestion = { ok: false, key, error: error instanceof Error ? error.message : String(error) }; }
    if (!suggestion?.ok) continue;
    const id = Number(suggestion.categoryId);
    if (!(Number.isInteger(id) && id > 0)) continue;
    if (tried.has(id)) { triedHits.push(id); continue; }
    const vote = votes.get(id) || { count: 0, row: suggestion };
    vote.count++; votes.set(id, vote);
    if (vote.count >= threshold) break;
  }
  const winner = [...votes.values()].sort((a, b) => b.count - a.count)[0];
  if (winner && currentCategory && Number(winner.row.categoryId) === currentCategory) {
    // The model's majority already matches the product's stored category: nothing to do.
    appendCategoryItem(run, { ...product, ok: true, categoryId: currentCategory, categoryName: String(winner.row.categoryName || ''), source: `دستهٔ فعلی تأیید شد (${winner.count} از ${responded} مدل)`, confidence: responded ? Math.round(winner.count / responded * 100) : 0, error: undefined });
  } else if (winner) {
    try {
      const source = `هوش مصنوعی سرورساید: ${winner.count} از ${responded} مدل`;
      await applyBasalamCategory(product.id, product.shopId, Number(winner.row.categoryId), product.title, String(winner.row.categoryName || ''), source);
      run.changed++;
      appendCategoryItem(run, { ...product, ok: true, categoryId: Number(winner.row.categoryId), categoryName: String(winner.row.categoryName || ''), source, confidence: responded ? Math.round(winner.count / responded * 100) : 0 });
    } catch (error) {
      await markBasalamCategoriesTried(product.shopId, product.id, [Number(winner.row.categoryId)]);
      run.failed++;
      appendCategoryItem(run, { ...product, ok: false, error: (error instanceof Error ? error.message : String(error)) + ' (دستهٔ پیشنهادی برای این محصول ثبت شد تا دوباره امتحان نشود.)' });
    }
  } else if (triedHits.length) {
    // Every suggestion the models made for this product was already tried before.
    run.failed++;
    appendCategoryItem(run, { ...product, ok: false, error: 'همهٔ دسته‌بندی‌های پیشنهادی مدل‌ها قبلاً برای این محصول امتحان شده‌اند و نتیجهٔ قطعی نداشتند؛ در اجرای بعدی از آنها صرف‌نظر می‌شود.' });
  } else {
    run.failed++;
    appendCategoryItem(run, { ...product, ok: false, error: 'هیچ مدل فعال، شناسهٔ دسته‌بندی معتبر برنگرداند.' });
  }
  run.cursor++; run.processed++; run.attempts = 0;
  const latest = await readRun();
  if (latest?.stopRequested) { run.stopRequested = true; run.status = 'paused'; run.phase = 'paused'; }
  return !run.stopRequested;
}

async function categorizeBatch(run: CategoryRun): Promise<void> {
  if (run.cursor >= run.products.length) { run.status = 'done'; run.phase = 'finished'; run.finishedAt = now(); return; }
  const categories = (await destinationCategories()).items;
  const end = Math.min(run.products.length, run.cursor + CATEGORY_BATCH);
  for (let i = run.cursor; i < end; i++) {
    const keepGoing = await categorizeProduct(run, run.products[i], categories);
    if (!keepGoing) break;
  }
  if (run.status === 'paused') return;
  if (run.cursor >= run.products.length) { run.status = 'done'; run.phase = 'finished'; run.finishedAt = now(); }
  else run.phase = 'categorizing';
}

/** Resumes an interrupted run after a process restart. */
export async function recoverCategoryRun(): Promise<void> {
  const run = await readRun();
  if (run && ['queued', 'running'].includes(run.status) && !run.stopRequested) void drive();
}
