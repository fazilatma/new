/**
 * Server-side duplicate-removal runs for the Node runtime (Termux / VPS /
 * Render / Codespaces).
 *
 * The Cloudflare Worker has had these runs since v1.8x, but the Node runtime
 * never implemented them, so the dashboard's «حذف تکراری‌ها» buttons issued
 * requests to routes that did not exist and silently did nothing on every
 * non-Cloudflare install.
 *
 * The Worker version is built around Queues + D1 checkpoints because a Worker
 * invocation has a hard CPU budget. Node has no such limit, so the run executes
 * in-process here, while persisting the very same state shape through
 * `getState`/`setState` so the run survives a restart and the dashboard — which
 * is shared by both runtimes — sees exactly the fields it already expects.
 */
import { buildDedupGroups, normalizeDedupKeep, parseSuffixFormats } from '../worker-src/dedup.js';
import type { DedupCandidate, DedupGroup, DedupKeep } from '../worker-src/dedup.js';
import { loadConnections } from './connections.js';
import { getState, setState } from './db.js';
import { destinationDelete, listDestinationProducts } from './maintenance.js';

export type DedupTarget = 'woo' | 'basalam';
type DedupItemLog = { title: string; id: number; ok: boolean; error?: string };

export type DedupRun = {
  id: string; kind: 'dedup'; status: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  phase: string; stopRequested: boolean;
  createdAt: string; updatedAt: string; startedAt: string | null; finishedAt: string | null;
  attempts: number; error: string | null;
  target: DedupTarget; keep: DedupKeep; suffixFormats: string[]; apply: boolean;
  page: number; totalPages: number; listingDone: boolean; grouped: boolean;
  products: DedupCandidate[]; groups: DedupGroup[];
  groupCursor: number; removeCursor: number;
  scanned: number; groupsFound: number; duplicates: number; removed: number; failed: number;
  items: DedupItemLog[];
};

const RUN_KEY = 'background_run:dedup';
const now = () => new Date().toISOString();
const active = (run: DedupRun | null) => Boolean(run && ['queued', 'running', 'paused'].includes(run.status));

/** Strips the heavy arrays the dashboard never renders, exactly like the Worker. */
function publicRun(run: DedupRun | null): any {
  if (!run) return null;
  const { products, groups, ...safe } = run;
  return {
    ...safe,
    groups: groups.slice(0, 250).map(group => ({ title: group.title, count: group.remove.length + 1, keep: group.keep, remove: group.remove.slice(0, 25) })),
    groupsTruncated: groups.length > 250,
  };
}

async function readRun(): Promise<DedupRun | null> { return await getState<DedupRun | null>(RUN_KEY, null); }
async function writeRun(run: DedupRun): Promise<void> { run.updatedAt = now(); await setState(RUN_KEY, run); }

export async function getPublicDedupRun(): Promise<any> { return publicRun(await readRun()); }

export async function resetDedupRun(): Promise<void> { await setState(RUN_KEY, null); }

let running = false;

export async function startDedupRun(target: DedupTarget, input: any): Promise<{ run: any; existing: boolean }> {
  const previous = await readRun();
  if (previous && active(previous)) {
    // A run for the other shop is not "current" for this request.
    if (previous.target !== target) await resetDedupRun();
    else if (previous.status === 'paused' || previous.stopRequested) return { run: publicRun(previous), existing: true };
    else return { run: publicRun(previous), existing: true };
  }
  // Fail fast with a clear connection error before starting a long job.
  const connections = await loadConnections();
  if (target === 'woo') {
    const woo = connections.woo;
    if (!woo.url || !woo.key || !woo.secret) throw new Error('اتصال ووکامرس کامل نیست؛ آدرس و کلیدهای API را در بخش اتصال‌ها ذخیره کنید.');
  } else {
    const basalam = connections.basalam;
    if (!basalam.token || !basalam.vendorId) throw new Error('اتصال باسلام کامل نیست؛ توکن و شناسهٔ غرفه را در بخش اتصال‌ها ذخیره کنید.');
  }
  const timestamp = now();
  const run: DedupRun = {
    id: `dedup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'dedup', status: 'queued', phase: 'listing', stopRequested: false,
    createdAt: timestamp, updatedAt: timestamp, startedAt: null, finishedAt: null,
    attempts: 0, error: null, target,
    keep: normalizeDedupKeep(input?.keep), suffixFormats: parseSuffixFormats(input?.suffixFormats),
    apply: Boolean(input?.apply), page: 1, totalPages: 0, listingDone: false, grouped: false,
    products: [], groups: [], groupCursor: 0, removeCursor: 0,
    scanned: 0, groupsFound: 0, duplicates: 0, removed: 0, failed: 0, items: [],
  };
  await writeRun(run);
  void drive();
  return { run: publicRun(run), existing: false };
}

export async function controlDedupRun(action: 'stop' | 'resume'): Promise<any> {
  const run = await readRun();
  if (!run) throw new Error('اجرای پس‌زمینه‌ای پیدا نشد.');
  if (action === 'stop') {
    if (['done', 'failed'].includes(run.status)) return publicRun(run);
    run.stopRequested = true; run.status = 'paused'; run.phase = 'paused';
    await writeRun(run); return publicRun(run);
  }
  if (!['paused', 'failed'].includes(run.status)) return publicRun(run);
  run.stopRequested = false; run.status = 'queued'; run.error = null; run.finishedAt = null;
  run.phase = !run.listingDone ? 'listing' : !run.grouped ? 'grouping' : 'removing';
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
        if (!run.listingDone) await listProducts(run);
        else if (!run.grouped) groupProducts(run);
        else if (!(await removeBatch(run))) { await writeRun(run); return; }
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

async function listProducts(run: DedupRun): Promise<void> {
  const remote = await listDestinationProducts(run.target);
  run.products = remote.map(item => ({
    id: Number(item.id), shopId: String((item as any).shopId || 'default'), name: String(item.name || ''),
    price: Number(item.price) || 0, date: String((item as any).raw?.date_created || (item as any).raw?.created_at || ''),
    status: String(item.status || ''), sku: String(item.sku || ''),
  }));
  run.scanned = run.products.length;
  run.listingDone = true; run.totalPages = 1; run.phase = 'grouping';
}

function groupProducts(run: DedupRun): void {
  run.groups = buildDedupGroups(run.products, run.keep, run.suffixFormats);
  run.groupsFound = run.groups.length;
  run.duplicates = run.groups.reduce((total, group) => total + group.remove.length, 0);
  run.grouped = true;
  run.phase = run.apply ? 'removing' : 'done';
  if (!run.apply) { run.status = 'done'; run.finishedAt = now(); }
}

/** Deletes one batch; returns false when the run is finished. */
async function removeBatch(run: DedupRun): Promise<boolean> {
  const BATCH = 10;
  let processed = 0;
  while (processed < BATCH) {
    const group = run.groups[run.groupCursor];
    if (!group) {
      run.status = 'done'; run.phase = 'done'; run.finishedAt = now();
      return false;
    }
    const victim = group.remove[run.removeCursor];
    if (!victim) { run.groupCursor++; run.removeCursor = 0; continue; }
    try {
      await destinationDelete(run.target, Number(victim.id), true, run.target === 'basalam' ? String(victim.shopId || '') : '');
      run.removed++;
      run.items.push({ title: victim.name, id: Number(victim.id), ok: true });
    } catch (error) {
      run.failed++;
      run.items.push({ title: victim.name, id: Number(victim.id), ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    if (run.items.length > 500) run.items = run.items.slice(-500);
    run.removeCursor++; processed++;
  }
  return true;
}

/** Resumes an interrupted run after a process restart. */
export async function recoverDedupRun(): Promise<void> {
  const run = await readRun();
  if (run && ['queued', 'running'].includes(run.status) && !run.stopRequested) void drive();
}
