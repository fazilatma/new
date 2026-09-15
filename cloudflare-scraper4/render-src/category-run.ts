/**
 * Node-runtime Basalam bulk category correction (parity with Worker category-all).
 *
 * Worker runs this via Queue + background.ts; Node runs in-process like dedup-run.
 * Modes: master | master-candidates | ensemble (with optional explicit model list).
 */
import { randomUUID } from 'node:crypto';
import { aiCall, aiProviders, getLeaderboard } from './ai.js';
import { loadConnections } from './connections.js';
import { getState, setState } from './db.js';
import {
  categoryPrompt,
  normalizeCategoryMode,
  parseCategoryId,
  selectCategoryModels,
  type CategoryVoteMode,
} from '../worker-src/destination-core.js';
import { normalizeCategoryCorrection, type CategoryCorrectionSettings } from '../worker-src/category-correction-settings.js';
import { applyBasalamCategory, destinationCatalog, destinationCategories } from './maintenance.js';

type CategoryProduct = { id: number; shopId: string; title: string; categoryId?: number };
type CategoryRunItem = {
  id: number; shopId: string; title: string; ok: boolean;
  categoryId?: number; categoryName?: string; source?: string; confidence?: number; error?: string;
};

export type CategoryRun = {
  id: string; kind: 'category-all';
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  phase: string; stopRequested: boolean;
  createdAt: string; updatedAt: string; startedAt: string | null; finishedAt: string | null;
  attempts: number; error: string | null;
  modelKeys: string[]; mode: string;
  page: number; totalPages: number; products: CategoryProduct[];
  cursor: number; total: number; processed: number; changed: number; failed: number;
  items: CategoryRunItem[];
};

const RUN_KEY = 'background_run:category-all';
const now = () => new Date().toISOString();
const active = (run: CategoryRun | null) => Boolean(run && ['queued', 'running', 'paused'].includes(run.status));

function publicRun(run: CategoryRun | null): any {
  if (!run) return null;
  const { products, ...safe } = run;
  return safe;
}

async function readRun(): Promise<CategoryRun | null> {
  return getState<CategoryRun | null>(RUN_KEY, null);
}
async function writeRun(run: CategoryRun): Promise<void> {
  run.updatedAt = now();
  await setState(RUN_KEY, run);
}

export async function getPublicCategoryRun(): Promise<any> {
  return publicRun(await readRun());
}

export async function resetCategoryRun(): Promise<void> {
  await setState(RUN_KEY, null);
}

async function resolveModelKeys(mode: CategoryVoteMode, explicit?: string[]): Promise<string[]> {
  if (mode === 'ensemble' && Array.isArray(explicit) && explicit.length) {
    return [...new Set(explicit.map(String).filter(Boolean))].slice(0, 5);
  }
  const connections = await loadConnections();
  const ai = connections.ai;
  const providers = await aiProviders();
  const configured: string[] = [];
  for (const p of providers) {
    if ((p as any).enabled === false) continue;
    for (const model of p.models || []) configured.push(`${p.id}::${model}`);
  }
  // Prefer green-ish models from leaderboard scores when available
  let green = new Set<string>(configured);
  try {
    const board = await getLeaderboard();
    if (Array.isArray(board) && board.length) {
      const ok = new Set(board.filter((r: any) => Number(r.score) >= 50 || Number(r.wins) > 0).map((r: any) => String(r.key)));
      if (ok.size) green = ok;
    }
  } catch { /* use all configured */ }
  const candidates = Array.isArray(ai.candidates) ? ai.candidates.map(String) : [];
  return selectCategoryModels({
    mode,
    master: (ai as any).master,
    candidates,
    configured,
    green,
  });
}

let running = false;

export async function startCategoryAllRun(input?: any): Promise<{ run: any; existing: boolean }> {
  const previous = await readRun();
  if (previous && active(previous)) return { run: publicRun(previous), existing: true };

  const mode = normalizeCategoryMode(input?.mode);
  const explicit = Array.isArray(input?.models) ? input.models : Array.isArray(input?.modelKeys) ? input.modelKeys : undefined;
  const modelKeys = await resolveModelKeys(mode, explicit);
  if (!modelKeys.length) {
    throw new Error('هیچ مدلی برای دسته‌بندی پیدا نشد؛ مدل مستر/کاندیدها را تنظیم یا تست کنید.');
  }

  await destinationCategories();

  const timestamp = now();
  const run: CategoryRun = {
    id: `cat-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`,
    kind: 'category-all',
    status: 'queued',
    phase: 'listing',
    stopRequested: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    startedAt: null,
    finishedAt: null,
    attempts: 0,
    error: null,
    modelKeys,
    mode,
    page: 1,
    totalPages: 1,
    products: [],
    cursor: 0,
    total: 0,
    processed: 0,
    changed: 0,
    failed: 0,
    items: [],
  };
  await writeRun(run);
  void drive();
  return { run: publicRun(run), existing: false };
}

export async function controlCategoryRun(action: 'stop' | 'resume'): Promise<any> {
  const run = await readRun();
  if (!run) throw new Error('اجرای پس‌زمینه‌ای پیدا نشد.');
  if (action === 'stop') {
    if (['done', 'failed'].includes(run.status)) return publicRun(run);
    run.stopRequested = true;
    run.status = 'paused';
    run.phase = 'paused';
    await writeRun(run);
    return publicRun(run);
  }
  if (!['paused', 'failed'].includes(run.status)) return publicRun(run);
  run.stopRequested = false;
  run.status = 'queued';
  run.error = null;
  run.finishedAt = null;
  run.phase = run.products.length === 0 ? 'listing' : 'categorizing';
  await writeRun(run);
  void drive();
  return publicRun(run);
}

async function drive(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const run = await readRun();
      if (!run || ['done', 'failed', 'paused'].includes(run.status) || run.stopRequested) return;
      run.status = 'running';
      run.startedAt ||= now();
      try {
        if (run.products.length === 0) await listProducts(run);
        else if (!(await categorizeBatch(run))) {
          await writeRun(run);
          return;
        }
        await writeRun(run);
      } catch (error) {
        run.attempts = (run.attempts || 0) + 1;
        run.error = error instanceof Error ? error.message : String(error);
        run.status = 'failed';
        run.phase = 'failed';
        run.finishedAt = now();
        await writeRun(run);
        return;
      }
    }
  } finally {
    running = false;
  }
}

async function listProducts(run: CategoryRun): Promise<void> {
  run.phase = 'listing';
  const products: CategoryProduct[] = [];
  // Basalam unapproved / pending statuses commonly need category fix
  const statuses = ['3567', '3568', '2976'];
  for (const status of statuses) {
    let page = 1;
    for (let guard = 0; guard < 50; guard++) {
      const catalog = await destinationCatalog('basalam', { page, perPage: 50, status, counts: false });
      const rows = Array.isArray(catalog?.items) ? catalog.items : Array.isArray(catalog?.products) ? catalog.products : [];
      for (const row of rows) {
        const id = Number(row.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        products.push({
          id,
          shopId: String(row.shopId || row.shop_id || ''),
          title: String(row.title || row.name || ''),
          categoryId: row.categoryId != null ? Number(row.categoryId) : undefined,
        });
      }
      const totalPages = Number(catalog?.totalPages || catalog?.pages || 1) || 1;
      if (page >= totalPages || rows.length === 0) break;
      page++;
    }
  }
  // de-dupe
  const seen = new Set<string>();
  run.products = products.filter((p) => {
    const k = `${p.shopId}:${p.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  run.total = run.products.length;
  run.cursor = 0;
  run.phase = run.total ? 'categorizing' : 'done';
  if (!run.total) {
    run.status = 'done';
    run.finishedAt = now();
  }
}

async function categorizeBatch(run: CategoryRun): Promise<boolean> {
  const BATCH = 3;
  const categories = (await destinationCategories()).items || [];
  let n = 0;
  while (n < BATCH && run.cursor < run.products.length) {
    if (run.stopRequested) {
      run.status = 'paused';
      run.phase = 'paused';
      return false;
    }
    const product = run.products[run.cursor++];
    n++;
    try {
      const result = await voteCategory(product.title, categories, run.modelKeys);
      if (!result.categoryId) throw new Error('شناسه دسته معتبر برنگشت');
      await applyBasalamCategory(product.id, result.categoryId, product.shopId);
      run.changed++;
      run.processed++;
      run.items.push({
        id: product.id,
        shopId: product.shopId,
        title: product.title,
        ok: true,
        categoryId: result.categoryId,
        categoryName: result.categoryName,
        source: result.source,
        confidence: result.confidence,
      });
    } catch (error) {
      run.failed++;
      run.processed++;
      run.items.push({
        id: product.id,
        shopId: product.shopId,
        title: product.title,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (run.items.length > 400) run.items = run.items.slice(-400);
  }
  if (run.cursor >= run.products.length) {
    run.status = 'done';
    run.phase = 'done';
    run.finishedAt = now();
    return false;
  }
  run.phase = 'categorizing';
  return true;
}

async function voteCategory(title: string, categories: any[], modelKeys: string[]) {
  const { allowed, prompt } = categoryPrompt(title, categories);
  const providers = await aiProviders();
  const tallies = new Map<number, { count: number; name: string; sources: string[] }>();

  for (const key of modelKeys) {
    const [providerId, ...rest] = key.split('::');
    const model = rest.join('::');
    const provider = providers.find((p) => p.id === providerId);
    if (!provider || !model) continue;
    try {
      const response = await aiCall(provider, model, prompt, 300);
      const id = parseCategoryId(response.text, allowed);
      if (!id) continue;
      const name = String(allowed.find((c) => Number(c.id) === id)?.name || id);
      const row = tallies.get(id) || { count: 0, name, sources: [] };
      row.count++;
      row.sources.push(key);
      tallies.set(id, row);
    } catch {
      /* try next model */
    }
  }

  let best: { id: number; count: number; name: string; sources: string[] } | null = null;
  for (const [id, row] of tallies) {
    if (!best || row.count > best.count) best = { id, ...row };
  }
  if (!best) throw new Error('هیچ مدلی دسته معتبری پیشنهاد نداد');
  return {
    categoryId: best.id,
    categoryName: best.name,
    source: best.sources.join(','),
    confidence: Math.round((best.count / Math.max(1, modelKeys.length)) * 100),
  };
}

export async function recoverCategoryRun(): Promise<void> {
  const run = await readRun();
  if (run && ['queued', 'running'].includes(run.status) && !run.stopRequested) void drive();
}

/** Called from automationTick when periodic correction is due. */
export async function maybeStartScheduledCategoryCorrection(): Promise<any> {
  const settings = await getState<any>('settings', {});
  const cfg = normalizeCategoryCorrection(settings.categoryCorrection || settings.category_correction);
  if (!cfg.enabled) return { skipped: true, reason: 'disabled' };

  const { categoryCorrectionDue } = await import('../worker-src/category-correction-settings.js');
  if (!categoryCorrectionDue(cfg)) return { skipped: true, reason: 'not-due', lastRunAt: cfg.lastRunAt, intervalHours: cfg.intervalHours };

  const previous = await readRun();
  if (previous && active(previous)) return { skipped: true, reason: 'already-running' };

  const result = await startCategoryAllRun({
    mode: cfg.mode,
    models: cfg.models,
  });

  const next: CategoryCorrectionSettings = { ...cfg, lastRunAt: now() };
  await setState('settings', { ...settings, categoryCorrection: next });
  return { started: true, run: result.run, mode: cfg.mode, intervalHours: cfg.intervalHours };
}
