/**
 * Shared settings for periodic Basalam bulk category correction.
 * Used by Worker cron/automation and Node automationTick so both runtimes
 * schedule the same job with the same defaults.
 *
 * Modes (UI labels in Persian):
 *   master              → مستر تکی
 *   master-candidates   → پشتیبان (مستر + کاندیدها)
 *   ensemble            → اجماعی (لیست مدل‌ها قابل حذف/اضافه)
 */
import { normalizeCategoryMode, type CategoryVoteMode } from './destination-core.js';

export type CategoryCorrectionSettings = {
  enabled: boolean;
  /** Hours between automatic runs. Default 6. */
  intervalHours: number;
  mode: CategoryVoteMode;
  /** Explicit model keys (provider::model) for ensemble mode — user can add/remove. */
  models: string[];
  /** ISO timestamp of last successful/started scheduled run. */
  lastRunAt: string | null;
};

export const DEFAULT_CATEGORY_CORRECTION: CategoryCorrectionSettings = {
  enabled: false,
  intervalHours: 6,
  mode: 'ensemble',
  models: [],
  lastRunAt: null,
};

export function normalizeCategoryCorrection(raw: any): CategoryCorrectionSettings {
  const src = raw && typeof raw === 'object' ? raw : {};
  const hours = Number(src.intervalHours ?? src.interval_hours ?? DEFAULT_CATEGORY_CORRECTION.intervalHours);
  const models = Array.isArray(src.models)
    ? [...new Set(src.models.map((m: any) => String(m || '').trim()).filter(Boolean))].slice(0, 12)
    : [];
  return {
    enabled: Boolean(src.enabled),
    intervalHours: Number.isFinite(hours) ? Math.max(1, Math.min(168, Math.round(hours))) : 6,
    mode: normalizeCategoryMode(src.mode),
    models,
    lastRunAt: src.lastRunAt ? String(src.lastRunAt) : null,
  };
}

/** True when enough time has passed since lastRunAt (or never run). */
export function categoryCorrectionDue(settings: CategoryCorrectionSettings, nowMs = Date.now()): boolean {
  if (!settings.enabled) return false;
  if (!settings.lastRunAt) return true;
  const last = Date.parse(settings.lastRunAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= settings.intervalHours * 3_600_000;
}

/**
 * Resolve which model keys to use for a run.
 * Ensemble: prefer explicit settings.models if non-empty, else fall through to caller.
 */
export function ensembleModelsFromSettings(settings: CategoryCorrectionSettings): string[] | null {
  if (settings.mode !== 'ensemble') return null;
  if (settings.models.length) return settings.models.slice(0, 5);
  return null;
}
