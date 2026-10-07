/**
 * Live detail for every reconciliation operation (1.336.0).
 *
 * «جزئیات تفصیلی‌تر زنده از مراحل انجام نشان داده شوند تا واقعاً کار کردن این سیستم را تأیید کنم.»
 *
 * The panel used to receive stage names («account-done») and little else, so a long run looked
 * identical to a stuck one. This module turns every internal step into ONE event shape carrying
 * what actually happened — which destination, which page of how many, how many products were read,
 * how long it took, and concrete example lines (product title, source price, destination price).
 *
 * Runtime free on purpose: both runtimes build identical events, and the lab can assert the exact
 * Persian sentences without a server. Every field is bounded, because these events travel through
 * the background-run store (worker-src/maintenance-runs.ts) and must stay small.
 */

export type ReconProgressEvent = {
  /** Short machine name the panel groups cards by. */
  name: string;
  stage: string;
  status: 'running' | 'success' | 'error';
  /** One Persian sentence describing what just happened. */
  summary: string;
  account?: string;
  target?: string;
  count?: number;
  total?: number;
  page?: number;
  totalPages?: number;
  /** Milliseconds since the operation started — the honest proof that work is moving. */
  elapsedMs: number;
  /** Sequence number, so a poller can tell «nothing new» from «nothing happening». */
  seq: number;
  /** Up to six short lines of real evidence (product titles, prices, ids). */
  detail?: string[];
  type: 'progress';
};

export const DETAIL_MAX_LINES = 6;
export const DETAIL_MAX_CHARS = 160;
export const SUMMARY_MAX_CHARS = 220;

const DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function fa(value: unknown): string {
  return String(value ?? '').replace(/\d/g, d => DIGITS[Number(d)]);
}
/** Prices are long; group them so a human can read them at a glance. */
export function faPrice(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return fa(Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '٬'));
}
export function clip(value: unknown, max = DETAIL_MAX_CHARS): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}
export function faDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(Number(ms) || 0) / 1000);
  if (seconds < 60) return fa(seconds.toFixed(seconds < 10 ? 1 : 0)) + ' ثانیه';
  const minutes = Math.floor(seconds / 60);
  return fa(minutes) + ' دقیقه و ' + fa(Math.round(seconds - minutes * 60)) + ' ثانیه';
}

export type ReconProgress = {
  emit: (event: Partial<ReconProgressEvent> & { stage: string }) => ReconProgressEvent;
  /** Pipe the ledger scanner's own events through, translated into Persian. */
  ledger: (account: string, raw: any, target?: string) => void;
  elapsed: () => number;
  seq: () => number;
};

/**
 * One reporter per operation. Every event it produces is normalized, bounded and stamped with the
 * elapsed time, so the panel can show «کجا هستیم و چقدر طول کشیده» without guessing.
 */
export function createReconProgress(onProgress?: (e: any) => void, now: () => number = () => Date.now()): ReconProgress {
  const startedAt = now();
  let seq = 0;
  const emit = (event: Partial<ReconProgressEvent> & { stage: string }): ReconProgressEvent => {
    const detail = Array.isArray(event.detail)
      ? event.detail.filter(line => String(line ?? '').trim()).slice(0, DETAIL_MAX_LINES).map(line => clip(line))
      : undefined;
    const out: ReconProgressEvent = {
      type: 'progress',
      name: String(event.name || event.stage || 'step'),
      stage: String(event.stage || 'step'),
      status: event.status || 'running',
      summary: clip(event.summary ?? '', SUMMARY_MAX_CHARS),
      elapsedMs: Math.max(0, now() - startedAt),
      seq: ++seq
    };
    if (event.account) out.account = clip(event.account, 120);
    if (event.target) out.target = String(event.target);
    if (Number.isFinite(Number(event.count))) out.count = Number(event.count);
    if (Number.isFinite(Number(event.total))) out.total = Number(event.total);
    if (Number.isFinite(Number(event.page))) out.page = Number(event.page);
    if (Number.isFinite(Number(event.totalPages))) out.totalPages = Number(event.totalPages);
    if (detail && detail.length) out.detail = detail;
    try { onProgress?.(out); } catch { /* a listener must never break the operation */ }
    return out;
  };
  return {
    emit,
    ledger: (account, raw, target) => { const described = describeLedgerEvent(raw, account); if (described) emit({ ...described, target }); },
    elapsed: () => Math.max(0, now() - startedAt),
    seq: () => seq
  };
}

/** Translate one raw ledger-scanner event into a readable step. Returns null for noise. */
export function describeLedgerEvent(raw: any, account: string): (Partial<ReconProgressEvent> & { stage: string }) | null {
  const type = String(raw?.type || '');
  const page = Number(raw?.page) || undefined;
  const totalPages = Number(raw?.totalPages) || undefined;
  const fetched = Number(raw?.fetched);
  const base = { name: 'ledger', account, page, totalPages, stage: 'ledger-fetch' } as Partial<ReconProgressEvent> & { stage: string };
  switch (type) {
    case 'ledger-page-start':
      return { ...base, summary: 'خواندن صفحهٔ ' + fa(page || 1) + (totalPages && totalPages > 1 ? ' از ' + fa(totalPages) : '') + '…' };
    case 'ledger-page-done':
      return { ...base, count: Number.isFinite(fetched) ? fetched : undefined, total: raw?.total,
        summary: 'صفحهٔ ' + fa(page || 1) + (totalPages ? ' از ' + fa(totalPages) : '') + ' خوانده شد · تا اینجا ' + fa(Number.isFinite(fetched) ? fetched : 0) + ' محصول' + (raw?.duplicate ? ' · ' + fa(raw.duplicate) + ' تکراری نادیده گرفته شد' : '') };
    case 'ledger-page-retry':
      return { ...base, status: 'error', summary: 'صفحهٔ ' + fa(page || 1) + ' ناموفق بود (تلاش ' + fa(raw?.attempt || 1) + ') — ' + clip(raw?.error) + '؛ دوباره تلاش می‌شود' };
    case 'ledger-page-incomplete':
      return { ...base, status: 'error', summary: 'صفحهٔ ' + fa(page || 1) + ' ناقص برگشت؛ شمارش این مقصد ممکن است کامل نباشد' };
    case 'ledger-total-mismatch':
      return { ...base, status: 'error', summary: 'مقصد ' + fa(raw?.expected) + ' محصول اعلام کرد ولی ' + fa(raw?.actual) + ' محصول خوانده شد' };
    case 'ledger-max-pages':
      return { ...base, status: 'error', summary: 'سقف ' + fa(raw?.totalPages) + ' صفحه رسید؛ ' + fa(raw?.fetched) + ' محصول خوانده شد' };
    case 'ledger-invalid-remaining':
      return { ...base, status: 'error', summary: 'بخشی از دفتر این مقصد ناقص ماند؛ با تازه‌سازی دوباره امتحان می‌شود' };
    case 'refresh-account-start':
      return { ...base, stage: 'account-start', name: 'account', summary: 'شروع اسکن ' + clip(account, 60) };
    case 'refresh-account-done':
      return { ...base, stage: 'account-done', name: 'account', status: 'success', count: Number(raw?.total) || undefined,
        summary: clip(account, 60) + ': ' + (raw?.cached ? 'دفتر تازه بود و دوباره خوانده نشد' : 'اسکن شد') + ' · ' + fa(Number(raw?.total) || 0) + ' محصول' };
    case 'refresh-account-error':
      return { ...base, stage: 'account-error', name: 'account', status: 'error', summary: clip(account, 60) + ': ' + clip(raw?.error) };
    default:
      return null;
  }
}

/** Count the comparison buckets of a batch of rows — the running totals the panel shows. */
export function bucketTally(rows: Array<{ bucket?: string }>): Record<string, number> {
  const tally: Record<string, number> = { matched: 0, priceDiff: 0, missing: 0, extra: 0, noPrice: 0, unreachable: 0 };
  for (const row of rows || []) { const bucket = String(row?.bucket || ''); if (bucket in tally) tally[bucket]++; }
  return tally;
}

export function tallySummary(tally: Record<string, number>): string {
  const labels: Array<[string, string]> = [['matched', 'هماهنگ'], ['priceDiff', 'اختلاف قیمت'], ['missing', 'در مقصد نیست'], ['extra', 'فقط در مقصد'], ['noPrice', 'بدون قیمت'], ['unreachable', 'پاسخ نداد']];
  return labels.filter(([key]) => tally[key]).map(([key, label]) => label + ' ' + fa(tally[key])).join(' · ') || 'بدون تفاوت';
}

/** One evidence line per compared product: title, both prices, and the verdict. */
export function rowLine(row: any): string {
  const labels: Record<string, string> = { matched: 'هماهنگ', priceDiff: 'اختلاف قیمت', missing: 'در مقصد نیست', extra: 'فقط در مقصد', noPrice: 'بدون قیمت مبدأ', unreachable: 'پاسخ نداد' };
  const title = clip(row?.title || row?.remoteTitle || '—', 60);
  const verdict = labels[String(row?.bucket || '')] || String(row?.bucket || '');
  if (row?.bucket === 'missing') return title + ' — ' + verdict + ' · مبدأ ' + faPrice(row?.sourcePrice);
  if (row?.bucket === 'extra') return title + ' — ' + verdict + ' · مقصد ' + faPrice(row?.remotePrice) + (row?.remoteId ? ' (شناسه ' + fa(row.remoteId) + ')' : '');
  return title + ' — ' + verdict + ' · مبدأ ' + faPrice(row?.sourcePrice) + ' · مقصد ' + faPrice(row?.remotePrice);
}

/** Up to `limit` example lines, preferring the rows that need work over the ones already in sync. */
export function sampleLines(rows: any[], limit = 3): string[] {
  const order = ['priceDiff', 'missing', 'extra', 'noPrice', 'unreachable', 'matched'];
  const sorted = [...(rows || [])].sort((a, b) => order.indexOf(String(a?.bucket)) - order.indexOf(String(b?.bucket)));
  return sorted.slice(0, limit).map(rowLine);
}

/** One line per write the apply pass performs, with the real before → after values. */
export function actionLine(action: any): string {
  const title = clip(action?.title || '—', 60);
  if (action?.kind === 'updatePrice') return '💰 ' + title + ' · ' + faPrice(action?.fromPrice) + ' ← ' + faPrice(action?.toPrice) + (action?.remoteId ? ' (شناسه ' + fa(action.remoteId) + ')' : '');
  if (action?.kind === 'create') return '➕ ' + title + ' · ساخت دوباره در ' + clip(action?.accountName || action?.target, 40);
  return '• ' + title;
}
