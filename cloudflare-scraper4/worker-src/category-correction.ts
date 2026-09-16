/**
 * Periodic Basalam bulk category correction — the settings, the schedule math and
 * the shared tick.
 *
 * The bulk «تصحیح جمعی محصولات تأییدنشده» used to be a button a human had to press.
 * This makes the same job run by itself every N hours (default 6), with the same
 * three voter modes the manual dialog offers (مستر تکی / پشتیبان / اجماعی) and, in
 * consensus mode, a model list the user can add to and remove from.
 *
 * Both twins drive it through `automationTick()`, so a single implementation covers
 * every environment: the Cloudflare Worker cron, and the Node build on Termux, VPS,
 * Render, cPanel/Passenger, Windows and local runs (external cron included).
 *
 * Storage split, on purpose:
 *   - `settings.categoryCorrection` is edited by the browser (it autosaves the whole
 *     settings object), so the server must never write into it.
 *   - `app_state['category_correction_last']` is the server-side bookkeeping record
 *     (when the last scheduled attempt ran, its run id, counters or failure). A
 *     separate key means a browser autosave can never clobber the schedule.
 */
import { normalizeCategoryMode, type CategoryVoteMode } from './destination-core.js';

export const CATEGORY_CORRECTION_SETTINGS_KEY = 'categoryCorrection';
export const CATEGORY_CORRECTION_LAST_KEY = 'category_correction_last';
/** The user asked for a 6-hour default; clamped to a sane 1h..7d window. */
export const DEFAULT_CATEGORY_CORRECTION_INTERVAL_HOURS = 6;
export const MIN_CATEGORY_CORRECTION_INTERVAL_HOURS = 1;
export const MAX_CATEGORY_CORRECTION_INTERVAL_HOURS = 168;
export const CATEGORY_CORRECTION_MAX_MODELS = 5;
export const CATEGORY_CORRECTION_MODES: CategoryVoteMode[] = ['master', 'master-candidates', 'ensemble'];
export const CATEGORY_CORRECTION_MODE_LABELS: Record<CategoryVoteMode, string> = {
  master: '👑 مدل مستر فقط',
  'master-candidates': '👑➕ مستر با پشتیبانی کاندیدها',
  ensemble: '🤝 اجماعی (فهرست مدل‌ها دست خودتان)',
};
export type CategoryCorrectionRunStatus = 'started' | 'done' | 'failed';
export type CategoryCorrectionSettings = {
  enabled: boolean;
  intervalHours: number;
  mode: CategoryVoteMode;
  /** Explicit `provider::model` voters for consensus mode; empty = automatic. */
  models: string[];
};
export type CategoryCorrectionLast = {
  status: CategoryCorrectionRunStatus;
  /** ISO timestamp of the attempt that set this record — the schedule anchor. */
  at: string;
  runId?: string | null;
  mode?: CategoryVoteMode;
  models?: string[];
  intervalHours?: number;
  error?: string | null;
  total?: number;
  processed?: number;
  changed?: number;
  finishedAt?: string | null;
};

const HOUR_MS = 3_600_000;
const parseTime = (value: any): number => { const at = Date.parse(String(value ?? '')); return Number.isFinite(at) ? at : NaN; };

/** Tolerant of the PHP-era snake_case and of hand-edited JSON. */
export function normalizeCategoryCorrection(raw: any): CategoryCorrectionSettings {
  const src = raw && typeof raw === 'object' ? raw : {};
  const hours = Number(src.intervalHours ?? (src as any).interval_hours ?? (src as any).intervalHours ?? DEFAULT_CATEGORY_CORRECTION_INTERVAL_HOURS);
  const models: string[] = Array.isArray(src.models)
    ? [...new Set((src.models as any[]).map((key: any) => String(key ?? '').trim().replace(/::k\d+$/i, '')).filter(Boolean) as string[])].slice(0, CATEGORY_CORRECTION_MAX_MODELS)
    : [];
  return {
    enabled: Boolean(src.enabled),
    intervalHours: Number.isFinite(hours) ? Math.min(MAX_CATEGORY_CORRECTION_INTERVAL_HOURS, Math.max(MIN_CATEGORY_CORRECTION_INTERVAL_HOURS, Math.round(hours))) : DEFAULT_CATEGORY_CORRECTION_INTERVAL_HOURS,
    mode: normalizeCategoryMode(src.mode),
    models,
  };
}

/** True when the anchor record is older than the interval (or no run ever happened). */
export function categoryCorrectionDue(settings: any, last: any, nowMs = Date.now()): boolean {
  const cfg = normalizeCategoryCorrection(settings);
  if (!cfg.enabled) return false;
  const anchor = parseTime(last?.at);
  if (!Number.isFinite(anchor)) return true;
  return nowMs - anchor >= cfg.intervalHours * HOUR_MS;
}

/** Everything the dashboard card shows: the config, the schedule and the last result. */
export function categoryCorrectionStatus(settings: any, last: any, nowMs = Date.now()) {
  const cfg = normalizeCategoryCorrection(settings), anchor = parseTime(last?.at);
  const nextRunAt = Number.isFinite(anchor) ? anchor + cfg.intervalHours * HOUR_MS : nowMs;
  return {
    enabled: cfg.enabled, intervalHours: cfg.intervalHours, mode: cfg.mode, models: cfg.models,
    modeLabel: CATEGORY_CORRECTION_MODE_LABELS[cfg.mode],
    automatic: cfg.models.length === 0,
    due: categoryCorrectionDue(cfg, last, nowMs),
    running: Boolean(last && last.status === 'started'),
    nextRunAt: new Date(nextRunAt).toISOString(),
    msUntil: Math.max(0, nextRunAt - nowMs),
    lastRunAt: Number.isFinite(anchor) ? new Date(anchor).toISOString() : null,
    last: last || null,
    limits: { minHours: MIN_CATEGORY_CORRECTION_INTERVAL_HOURS, maxHours: MAX_CATEGORY_CORRECTION_INTERVAL_HOURS, maxModels: CATEGORY_CORRECTION_MAX_MODELS },
  };
}

export type CategoryCorrectionTickInput = {
  /** The whole `settings` object (the `categoryCorrection` child is read from it). */
  settings: any;
  readLast: () => Promise<CategoryCorrectionLast | null>;
  writeLast: (record: CategoryCorrectionLast) => Promise<void>;
  startRun: (plan: { mode: CategoryVoteMode; models: string[]; scheduled: true }) => Promise<{ run: any; existing: boolean }>;
  /** Resolves the live `category-all` run so a finished one can be closed out. */
  currentRun?: () => Promise<any>;
  now?: number;
  log?: (message: string) => void;
};

/**
 * One scheduler step: close out a finished run, then start the next one when due.
 * Returns `null` when the feature is off, so a runtime that never enabled it keeps
 * its automation log as quiet as before.
 */
export async function categoryCorrectionTick(input: CategoryCorrectionTickInput): Promise<any | null> {
  const cfg = normalizeCategoryCorrection(input.settings?.[CATEGORY_CORRECTION_SETTINGS_KEY]);
  if (!cfg.enabled) return null;
  const nowMs = input.now ?? Date.now(), iso = new Date(nowMs).toISOString();
  let last = await input.readLast();
  // A scheduled run that is still working must never be doubled, and its bookkeeping
  // closes only once the run itself reports a final state (both twins checkpoint it).
  if (last && last.status === 'started') {
    const run = input.currentRun ? await input.currentRun() : null;
    if (run && ['queued', 'running', 'paused'].includes(String(run.status))) return { skipped: 'busy', reason: 'اجرای قبلی هنوز روی سرور در جریان است.', runId: last.runId || null };
    last = {
      ...last, status: String(run?.status) === 'failed' ? 'failed' : 'done',
      ...(run ? { total: Number(run.total) || 0, processed: Number(run.processed) || 0, changed: Number(run.changed) || 0, error: run.error ? String(run.error) : null, finishedAt: String(run.finishedAt || iso) } : { finishedAt: iso }),
    };
    await input.writeLast(last);
    input.log?.(`scheduled category correction ${last.status}: ${last.changed || 0} of ${last.processed || 0} product(s) changed`);
  }
  if (!categoryCorrectionDue(cfg, last, nowMs)) return { skipped: 'not-due', intervalHours: cfg.intervalHours, nextRunAt: categoryCorrectionStatus(cfg, last, nowMs).nextRunAt };
  try {
    const started = await input.startRun({ mode: cfg.mode, models: cfg.models, scheduled: true });
    // A manual run owns the server-side slot right now; keep the anchor untouched so the
    // scheduled pass fires on the next tick instead of being pushed a whole interval away.
    if (started?.existing) return { skipped: 'busy', reason: 'یک اجرای دستی در حال اجراست؛ اجرای زمان‌بندی‌شده پس از آن شروع می‌شود.' };
    await input.writeLast({ at: iso, status: 'started', runId: started?.run?.id || null, mode: cfg.mode, models: cfg.models, intervalHours: cfg.intervalHours });
    input.log?.(`scheduled category correction started (${cfg.mode}, every ${cfg.intervalHours}h)`);
    return { started: true, runId: started?.run?.id || null, mode: cfg.mode, intervalHours: cfg.intervalHours, models: cfg.models };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Stamping the anchor on failure too: a missing token or a stale model list must not
    // be retried once a minute for hours — the user sees the reason and fixes it.
    await input.writeLast({ at: iso, status: 'failed', error: message, mode: cfg.mode, intervalHours: cfg.intervalHours, models: cfg.models });
    input.log?.(`scheduled category correction failed: ${message}`);
    return { error: message };
  }
}

/**
 * The periodic block's payload for both runtimes: the raw `settings` object plus the
 * server-side record. `pool` is filled in by each twin from its own provider list.
 */
export function categoryCorrectionView(settings: any, last: any, pool: any[], nowMs = Date.now()) {
  return { ok: true, settings: normalizeCategoryCorrection(settings?.[CATEGORY_CORRECTION_SETTINGS_KEY]), status: categoryCorrectionStatus(settings?.[CATEGORY_CORRECTION_SETTINGS_KEY], last, nowMs), pool, now: new Date(nowMs).toISOString() };
}
