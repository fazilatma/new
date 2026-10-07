/**
 * Host environment repair loop — the second half of host-diagnosis.ts.
 *
 * The diagnosis already asks the environment real questions and answers in Persian, but it ended
 * with homework for the user: «کلید آینه‌های عمومی را روشن کنید»، «فایل‌های فونت را دستی بگذارید».
 * On the shared host that started all of this (fonts not applied, size control dead, source 403 —
 * all healthy on the VPS) every one of those steps is a setting this app owns. So the loop now
 * closes: the probe answers decide a repair, the repair is applied to the stored settings, and the
 * SAME probes are asked again to prove whether it actually helped. Nothing is claimed as fixed
 * before the second round of answers comes back.
 *
 * Runtime free on purpose (same contract as host-diagnosis.ts / photo-loop.ts): the settings
 * reader, the writer and the re-verification are injected, so both runtimes share this logic and
 * the lab can run it with no network and no database.
 */

import type { HostDiagnosis, HostProbe } from './host-diagnosis.js';

export type RepairId = 'mirrors-on' | 'font-cdn' | 'font-system' | 'font-local-restore';

export type RepairStep = {
  id: RepairId;
  label: string;
  /** Dotted path inside the settings object, e.g. "appearance.fontDelivery". */
  path: string;
  from: string;
  to: string;
  /** Persian: what the probes answered that makes this step the right next move. */
  why: string;
};

export type RepairOutcome = RepairStep & { applied: boolean; note: string };

export type RepairReport = {
  ok: boolean;
  plan: RepairStep[];
  applied: RepairOutcome[];
  skipped: RepairOutcome[];
  settings: any;
  /** Second round of probes, only when something was really written. */
  verify: { before: number; after: number; healed: string[]; remaining: string[]; summary: string } | null;
  summary: string;
  advice: string[];
};

export type HostRepairDeps = {
  diagnosis: HostDiagnosis;
  settings: any;
  saveSettings: (settings: any) => Promise<void>;
  /** Re-run the very same diagnosis after the write; omitted in dry runs. */
  verify?: () => Promise<HostDiagnosis>;
  /** false = plan only, change nothing (the panel shows the plan before the user agrees). */
  apply?: boolean;
};

export const FONT_DELIVERIES = ['local', 'cdn', 'system'] as const;
export type FontDelivery = (typeof FONT_DELIVERIES)[number];

export function readPath(source: any, path: string): any {
  return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), source);
}

/** Immutable write: the caller keeps the original object so a failed save changes nothing. */
export function writePath(source: any, path: string, value: any): any {
  const keys = path.split('.');
  const clone = Array.isArray(source) ? [...source] : { ...(source && typeof source === 'object' ? source : {}) };
  let cursor: any = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i], next = cursor[key];
    cursor[key] = next && typeof next === 'object' ? { ...next } : {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  return clone;
}

const broken = (probe?: HostProbe): boolean => Boolean(probe) && probe!.verdict !== 'ok' && probe!.verdict !== 'skipped';

export function fontDeliveryOf(settings: any): FontDelivery {
  const value = String(readPath(settings, 'appearance.fontDelivery') || 'local');
  return (FONT_DELIVERIES as readonly string[]).includes(value) ? (value as FontDelivery) : 'local';
}

/**
 * Probe answers in, concrete setting changes out. Every branch names the answer it reacts to, so
 * the panel can show WHY a switch is proposed and the user can refuse it.
 */
export function planHostRepair(diagnosis: HostDiagnosis, settings: any): RepairStep[] {
  const probe = (id: string) => diagnosis.probes.find(p => p.id === id);
  const css = probe('font-css'), file = probe('font-file');
  const cdns = diagnosis.probes.filter(p => p.id.startsWith('cdn:'));
  const openCdns = cdns.filter(p => p.verdict === 'ok');
  const source = probe('source'), mirror = probe('source-mirror');
  const steps: RepairStep[] = [];

  const delivery = fontDeliveryOf(settings);
  const font = String(readPath(settings, 'appearance.font') || 'vazir');
  const fontBroken = broken(css) || broken(file);

  if (font !== 'system') {
    if (delivery === 'local' && fontBroken) {
      const reason = broken(css)
        ? 'آدرس شیت فونت از مسیر نصب بیرون می‌زند (' + (css?.note || '') + ')'
        : 'سرور نتوانست فایل فونت را بیاورد (' + (file?.note || '') + ')';
      steps.push({
        id: 'font-cdn', label: 'تحویل فونت از CDN به‌جای مسیر خود برنامه', path: 'appearance.fontDelivery', from: delivery, to: 'cdn',
        why: reason + '؛ در این حالت خودِ مرورگر فایل فونت را از CDN می‌گیرد و دیگر به مسیر assets این میزبانی وابسته نیست.'
      });
    } else if (delivery === 'cdn' && fontBroken && cdns.length > 0 && openCdns.length === 0) {
      steps.push({
        id: 'font-system', label: 'بازگشت به فونت پیش‌فرض سیستم', path: 'appearance.font', from: font, to: 'system',
        why: 'نه مسیر خود برنامه و نه هیچ‌کدام از CDNهای فونت از این شبکه باز نشدند؛ تا وقتی این وضع برقرار است، فونت دانلودی فقط صفحه را کند می‌کند.'
      });
    } else if (delivery === 'cdn' && !fontBroken) {
      steps.push({
        id: 'font-local-restore', label: 'بازگشت تحویل فونت به مسیر خود برنامه', path: 'appearance.fontDelivery', from: delivery, to: 'local',
        why: 'حالا هم شیت و هم فایل فونت از خود برنامه سالم سرو می‌شوند؛ تحویل هم‌دامنه از CDN بیرونی بهتر است (حریم خصوصی و سرعت).'
      });
    }
  }

  if (source && source.verdict !== 'ok' && source.verdict !== 'skipped' && mirror?.verdict === 'ok' && readPath(settings, 'source.mirrors') === false) {
    steps.push({
      id: 'mirrors-on', label: 'روشن‌کردن آینه‌های عمومی برای مبدأ', path: 'source.mirrors', from: 'false', to: 'true',
      why: 'منبع درخواست مستقیم این هاست را رد کرد ولی همان صفحه از آینهٔ عمومی خوانده شد؛ با روشن‌بودن این کلید، حلقهٔ اتصال خودش سراغ آینه می‌رود.'
    });
  }
  return steps;
}

function countBad(diagnosis: HostDiagnosis): number {
  return diagnosis.probes.filter(p => p.verdict !== 'ok' && p.verdict !== 'skipped').length;
}

/** Plan → write → ask again. The verdict is whatever the SECOND round of probes says. */
export async function applyHostRepair(deps: HostRepairDeps): Promise<RepairReport> {
  const plan = planHostRepair(deps.diagnosis, deps.settings);
  const applied: RepairOutcome[] = [], skipped: RepairOutcome[] = [];
  const advice: string[] = [];
  let settings = deps.settings;

  if (!plan.length) {
    return {
      ok: true, plan, applied, skipped, settings, verify: null,
      summary: countBad(deps.diagnosis) ? 'چیزی برای اصلاح خودکار پیدا نشد.' : 'محیط میزبانی سالم است؛ اصلاحی لازم نبود.',
      advice: [countBad(deps.diagnosis)
        ? 'مشکل‌های باقی‌مانده از جنس تنظیماتِ این برنامه نیستند (مثلاً دسترسی نوشتن یا قانون پراکسی هاست)؛ متن تشخیص را به پشتیبانی میزبان بدهید.'
        : 'اگر باز هم فونت یا اندازه عوض نشد، یک‌بار حافظهٔ مرورگر را با Ctrl+F5 پاک کنید.']
    };
  }

  if (deps.apply === false) {
    for (const step of plan) skipped.push({ ...step, applied: false, note: 'فقط پیش‌نمایش؛ چیزی ذخیره نشد.' });
    return { ok: true, plan, applied, skipped, settings, verify: null, summary: 'نقشهٔ اصلاح آماده است: ' + plan.length + ' تغییر پیشنهادی.', advice: ['برای اجرا دکمهٔ «اصلاح خودکار» را بزنید؛ هر تغییر بعد از اجرا دوباره آزمایش می‌شود.'] };
  }

  // A host whose settings write fails is exactly the host that needs this most, so the write is
  // attempted once and its failure is reported as the finding it is — never silently swallowed.
  if (deps.diagnosis.appearance.writable === false) {
    for (const step of plan) skipped.push({ ...step, applied: false, note: 'ذخیرهٔ تنظیمات روی این میزبانی کار نمی‌کند، پس این تغییر پایدار نمی‌ماند.' });
    return {
      ok: false, plan, applied, skipped, settings, verify: null,
      summary: 'هیچ اصلاحی اعمال نشد چون نوشتن تنظیمات شکست می‌خورد.',
      advice: ['اول دسترسی نوشتن پایگاه‌داده یا پوشهٔ داده را درست کنید' + (deps.diagnosis.appearance.error ? ' (' + deps.diagnosis.appearance.error + ')' : '') + '؛ تا آن موقع هر تغییری بعد از بارگذاری دوباره برمی‌گردد.']
    };
  }

  let next = settings;
  for (const step of plan) next = writePath(next, step.path, step.to === 'true' ? true : step.to === 'false' ? false : step.to);
  try {
    await deps.saveSettings(next);
    settings = next;
    for (const step of plan) applied.push({ ...step, applied: true, note: 'اعمال شد: ' + step.path + ' = ' + step.to });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const step of plan) skipped.push({ ...step, applied: false, note: 'ذخیره نشد: ' + message });
    return { ok: false, plan, applied, skipped, settings: deps.settings, verify: null, summary: 'ذخیرهٔ تنظیمات شکست خورد؛ هیچ تغییری اعمال نشد.', advice: ['خطای ذخیره: ' + message] };
  }

  let verify: RepairReport['verify'] = null;
  if (deps.verify) {
    try {
      const after = await deps.verify();
      const wasBad = new Set(deps.diagnosis.probes.filter(p => p.verdict !== 'ok' && p.verdict !== 'skipped').map(p => p.id));
      const stillBad = after.probes.filter(p => p.verdict !== 'ok' && p.verdict !== 'skipped').map(p => p.id);
      const healed = [...wasBad].filter(id => !stillBad.includes(id));
      verify = {
        before: wasBad.size, after: stillBad.length, healed, remaining: stillBad,
        summary: stillBad.length
          ? 'پس از اصلاح، ' + healed.length + ' مورد درست شد و ' + stillBad.length + ' مورد هنوز باقی است.'
          : 'پس از اصلاح، همهٔ بررسی‌ها سالم شدند.'
      };
      if (stillBad.length) advice.push('موارد باقی‌مانده: ' + stillBad.join('، ') + '؛ متن تشخیص تازه را بخوانید، شاید قدم بعدی از جنس تنظیمات خود هاست باشد.');
    } catch (error) {
      verify = { before: countBad(deps.diagnosis), after: countBad(deps.diagnosis), healed: [], remaining: [], summary: 'آزمایش دوباره انجام نشد: ' + (error instanceof Error ? error.message : String(error)) };
    }
  }

  if (applied.some(step => step.id === 'font-cdn')) advice.push('اگر مرورگر شما هم به cdn.fontcdn.ir دسترسی نداشته باشد، فونت باز هم نمی‌آید؛ در آن صورت «پیش‌فرض سیستم» را انتخاب کنید.');
  if (applied.some(step => step.id === 'mirrors-on')) advice.push('آینهٔ عمومی فقط برای خواندن صفحه است؛ اگر منبع لاگین می‌خواهد، همچنان باید از Worker یا پراکسی استفاده کنید.');
  if (!advice.length) advice.push('صفحه را یک‌بار با Ctrl+F5 تازه کنید تا تغییرها را ببینید.');

  return {
    ok: !verify || verify.after <= verify.before,
    plan, applied, skipped, settings, verify,
    summary: (verify ? verify.summary + ' ' : '') + applied.length + ' تغییر اعمال شد.',
    advice
  };
}

/** One-line log/report form, same spirit as summarizeApiAttempts/summarizePhotoAttempts. */
export function summarizeRepair(report: RepairReport): string {
  const rows = [...report.applied, ...report.skipped].map(step => (step.applied ? '✔' : '✖') + ' ' + step.path + ': ' + step.from + '→' + step.to);
  return rows.length ? rows.join(' | ') : 'بدون تغییر';
}
