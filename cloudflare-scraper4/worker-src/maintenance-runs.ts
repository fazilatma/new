/**
 * Maintenance runs: the reconciliation operations as background work plus short polls.
 *
 * Why: «همهٔ عملیات‌های مغایرت‌گیری خطای Network error می‌دهند». These operations read every product
 * of every destination, so one request can stay open for minutes — and the browser never sees the
 * end of it, because something between the browser and the app (shared-host proxy, Cloudflare,
 * Codespaces port forwarder, a phone switching network) closes an idle-looking connection. The
 * server was usually fine: it was still working when the browser gave up with a bare
 * "Network error", which says nothing about what happened.
 *
 * The transport loop in the panel already walks shapes (stream → plain → smaller batch). This
 * module adds the shape that no proxy can cut: START the work with one short request, then ASK
 * about it with short polls. The long connection disappears entirely.
 *
 * Runtime free, like the other loops: state access, time, ids and the background scheduler are all
 * injected, so both runtimes share this logic and the lab can run it without a server.
 */

export type RunStatus = 'running' | 'done' | 'failed';

export type RunEvent = {
  at: string;
  name: string;
  status?: string;
  summary?: string;
  count?: number;
  total?: number;
  account?: string;
  target?: string;
};

export type MaintenanceRun = {
  id: string;
  op: string;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  /** Capped: a poll must stay small even for a run that reports thousands of steps. */
  events: RunEvent[];
  /** How many events were produced in total, including the ones already trimmed away. */
  eventCount: number;
  result?: any;
  error?: string;
};

export type RunDeps = {
  getState: <T>(key: string, fallback: T) => Promise<T>;
  setState: (key: string, value: unknown) => Promise<void>;
  now?: () => number;
  newId?: () => string;
  /** Keeps the background task alive on Workers (executionCtx.waitUntil); plain promise on Node. */
  background?: (promise: Promise<unknown>) => void;
};

export const RUN_EVENT_CAP = 200;
export const RUN_POINTER = 'maintenance.run.last';
export const runKey = (id: string) => 'maintenance.run:' + id;

const clock = (deps: RunDeps) => (deps.now ? deps.now() : Date.now());
const stamp = (deps: RunDeps) => new Date(clock(deps)).toISOString();

export function newRunId(deps: RunDeps): string {
  if (deps.newId) return deps.newId();
  return 'mr-' + clock(deps).toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/** Shrink one observer event to the few fields the panel actually draws. */
export function compactEvent(raw: any, at: string): RunEvent {
  const event: RunEvent = { at, name: String(raw?.name || raw?.stage || raw?.type || 'step') };
  if (raw?.status) event.status = String(raw.status);
  if (raw?.summary || raw?.account) event.summary = String(raw.summary || raw.account).slice(0, 300);
  if (Number.isFinite(Number(raw?.count))) event.count = Number(raw.count);
  if (Number.isFinite(Number(raw?.total))) event.total = Number(raw.total);
  if (raw?.account) event.account = String(raw.account).slice(0, 120);
  if (raw?.target) event.target = String(raw.target).slice(0, 60);
  return event;
}

export async function readMaintenanceRun(id: string, deps: RunDeps): Promise<MaintenanceRun | null> {
  if (!id) return null;
  return await deps.getState<MaintenanceRun | null>(runKey(id), null);
}

/** What a poll returns: only the events the caller has not seen yet. */
export function runSlice(run: MaintenanceRun | null, since = 0): any {
  if (!run) return null;
  const dropped = Math.max(0, run.eventCount - run.events.length);
  const from = Math.max(0, Math.min(run.events.length, since - dropped));
  return {
    id: run.id, op: run.op, status: run.status,
    startedAt: run.startedAt, updatedAt: run.updatedAt, finishedAt: run.finishedAt || '',
    eventCount: run.eventCount,
    events: run.events.slice(from),
    result: run.status === 'done' ? run.result : undefined,
    error: run.error || ''
  };
}

/**
 * Start `work` in the background and return the run row immediately, so the HTTP request that
 * started it is short no matter how long the work takes.
 */
export async function startMaintenanceRun(op: string, work: (observe: (event: any) => void) => Promise<any>, deps: RunDeps): Promise<MaintenanceRun> {
  const at = stamp(deps);
  const run: MaintenanceRun = { id: newRunId(deps), op, status: 'running', startedAt: at, updatedAt: at, events: [], eventCount: 0 };
  await deps.setState(runKey(run.id), run);
  await deps.setState(RUN_POINTER, run.id);

  // Progress writes are coalesced: a run that reports hundreds of steps must not turn into
  // hundreds of state writes (D1/SQLite would become the bottleneck instead of the network).
  let pending: RunEvent[] = [], lastWrite = 0, writing: Promise<void> = Promise.resolve();
  const flush = async (force: boolean) => {
    if (!pending.length) return;
    const elapsed = clock(deps) - lastWrite;
    if (!force && elapsed < 1000) return;
    const batch = pending; pending = []; lastWrite = clock(deps);
    run.events = [...run.events, ...batch].slice(-RUN_EVENT_CAP);
    run.eventCount += batch.length;
    run.updatedAt = stamp(deps);
    await deps.setState(runKey(run.id), run);
  };
  const observe = (event: any) => {
    pending.push(compactEvent(event, stamp(deps)));
    writing = writing.then(() => flush(false)).catch(() => {});
  };

  const task = (async () => {
    try {
      const result = await work(observe);
      await writing.catch(() => {});
      await flush(true);
      run.status = 'done'; run.result = result; run.finishedAt = stamp(deps); run.updatedAt = run.finishedAt;
    } catch (error) {
      await writing.catch(() => {});
      await flush(true).catch(() => {});
      run.status = 'failed';
      run.error = error instanceof Error ? error.message : String(error);
      run.finishedAt = stamp(deps); run.updatedAt = run.finishedAt;
    }
    await deps.setState(runKey(run.id), run).catch(() => {});
  })();

  if (deps.background) deps.background(task); else void task;
  return run;
}

/** A run whose host died mid-work must not look «running» forever. */
export function staleRun(run: MaintenanceRun | null, nowMs: number, maxIdleMs = 15 * 60 * 1000): boolean {
  if (!run || run.status !== 'running') return false;
  return nowMs - Date.parse(run.updatedAt || run.startedAt || '') > maxIdleMs;
}

export function runAdvice(run: MaintenanceRun | null, nowMs: number): string {
  if (!run) return 'این اجرا پیدا نشد؛ ممکن است سرویس دوباره راه‌اندازی شده باشد. عملیات را از نو شروع کنید.';
  if (run.status === 'done') return '';
  if (run.status === 'failed') return 'خود عملیات روی سرور خطا داد؛ متن خطا همان چیزی است که سرویس گفت، تکرار بدون تغییر همان نتیجه را می‌دهد.';
  if (staleRun(run, nowMs)) return 'بیش از ۱۵ دقیقه هیچ پیشرفتی ثبت نشده است؛ احتمالاً سرویس وسط کار راه‌اندازی دوباره شده. عملیات را از نو شروع کنید.';
  return '';
}
