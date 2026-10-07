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
  /** Running bucket totals, so the panel can draw live counters without re-counting rows. */
  tally?: Record<string, number>;
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
    if (event.tally && typeof event.tally === 'object') {
      const tally: Record<string, number> = {};
      for (const [key, value] of Object.entries(event.tally)) if (Number.isFinite(Number(value))) tally[String(key).slice(0, 20)] = Number(value);
      if (Object.keys(tally).length) out.tally = tally;
    }
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

/** Add one batch of bucket counts into a running total. */
export function mergeTally(into: Record<string, number>, add: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...into };
  for (const [key, value] of Object.entries(add || {})) out[key] = (out[key] || 0) + Number(value || 0);
  return out;
}

/** «۱۲۰٬۰۰۰ → انتظار ۱۳۸٬۰۰۰ · مقصد ۱۲۵٬۰۰۰ · کم‌تر از انتظار ۱۳٬۰۰۰ (۹٪)» — the whole arithmetic, visible. */
export function diffLine(row: any): string {
  const title = clip(row?.title || row?.remoteTitle || '—', 44);
  const expected = Number(row?.expectedPrice);
  const remote = Number(row?.remotePrice);
  const source = Number(row?.sourcePrice);
  const parts = [title, 'مبدأ ' + faPrice(source)];
  if (Number.isFinite(expected) && expected !== source) parts.push('انتظار ' + faPrice(expected));
  parts.push('مقصد ' + faPrice(remote));
  if (Number.isFinite(expected) && Number.isFinite(remote) && expected !== 0) {
    const delta = remote - expected;
    const percent = Math.round(Math.abs(delta) / Math.abs(expected) * 100);
    parts.push((delta > 0 ? 'بیشتر از انتظار ' : 'کم‌تر از انتظار ') + faPrice(Math.abs(delta)) + ' (' + fa(percent) + '٪)');
  }
  if (row?.remoteId) parts.push('شناسه ' + fa(row.remoteId));
  return parts.join(' · ');
}

/** Example lines for ONE bucket, so each kind of difference is shown with its own numbers. */
export function bucketLines(rows: any[], bucket: string, limit = 4): string[] {
  const picked = (rows || []).filter(row => String(row?.bucket) === bucket).slice(0, limit);
  if (bucket === 'priceDiff') return picked.map(diffLine);
  if (bucket === 'missing') return picked.map(row => clip(row?.title, 48) + ' · باید با قیمت ' + faPrice(row?.expectedPrice ?? row?.sourcePrice) + ' ساخته شود' + (row?.profileName ? ' (پروفایل ' + clip(row.profileName, 24) + ')' : ''));
  if (bucket === 'extra') return picked.map(row => clip(row?.remoteTitle || row?.title, 48) + ' · فقط در مقصد · قیمت ' + faPrice(row?.remotePrice) + (row?.remoteId ? ' · شناسه ' + fa(row.remoteId) : ''));
  if (bucket === 'noPrice') return picked.map(row => clip(row?.title, 48) + ' · قیمت مبدأ خوانده نشد، پس مقایسه نشد');
  if (bucket === 'unreachable') return picked.map(row => clip(row?.title, 48) + ' · مقصد پاسخ نداد' + (row?.why ? ' — ' + clip(row.why, 60) : ''));
  return picked.map(rowLine);
}

/** «۴۲ محصول در ثانیه» — honest throughput, so a slow destination is visibly slow. */
export function throughput(count: number, ms: number): string {
  const seconds = Math.max(0.001, (Number(ms) || 0) / 1000);
  const rate = Number(count || 0) / seconds;
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  if (rate >= 1) return fa(Math.round(rate)) + ' محصول در ثانیه';
  return fa((rate * 60).toFixed(rate * 60 < 10 ? 1 : 0)) + ' محصول در دقیقه';
}

/** «برف باکس: ۴۰ · عطر سرا: ۱۲» — where the local products come from. */
export function countLines(counts: Map<string, number> | Record<string, number>, names: Record<string, string>, limit = 5): string[] {
  const entries = counts instanceof Map ? [...counts.entries()] : Object.entries(counts || {});
  return entries
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, limit)
    .map(([key, value]) => clip(names?.[key] || key, 34) + ': ' + fa(value) + ' محصول');
}

/** A compact per-destination ledger note: did we call the destination, or reuse the stored ledger? */
export function sourceNote(pages: number, fromLedger: boolean): string {
  if (fromLedger) return 'از دفتر ذخیره‌شده خوانده شد (بدون تماس تازه با مقصد)';
  return 'همین حالا از مقصد خوانده شد' + (pages ? ' · ' + fa(pages) + ' صفحه' : '');
}

/** How the destination rows were paired with local products — the step people trust least. */
export function matchLines(rows: any[]): string[] {
  const labels: Record<string, string> = { title: 'تطبیق با عنوانِ پسوندخورده', id: 'تطبیق با شناسهٔ ذخیره‌شده', sku: 'تطبیق با کد کالا (SKU)', none: 'بدون تطبیق' };
  const counts: Record<string, number> = {};
  for (const row of rows || []) { const key = String(row?.matchedBy || 'none'); counts[key] = (counts[key] || 0) + 1; }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, value]) => (labels[key] || key) + ': ' + fa(value));
}

/** Proof lines for products that are genuinely in sync — the evidence that the run really works. */
export function matchedProofLines(rows: any[], limit = 4): string[] {
  return (rows || []).filter(row => String(row?.bucket) === 'matched').slice(0, limit)
    .map(row => '✓ ' + clip(row?.title, 46) + ' · مبدأ ' + faPrice(row?.expectedPrice ?? row?.sourcePrice) + ' = مقصد ' + faPrice(row?.remotePrice) + (row?.remoteId ? ' · شناسه ' + fa(row.remoteId) : ''));
}

/** One line per profile: how its products compared across every destination. */
export function profileLines(groups: any[], limit = 5): string[] {
  return (groups || []).slice(0, limit).map(group => clip(group?.profileName || group?.profileId, 28) + ': ' + tallySummary({
    matched: Number(group?.matched) || 0, priceDiff: Number(group?.priceDiff) || 0, missing: Number(group?.missing) || 0,
    extra: Number(group?.extra) || 0, noPrice: Number(group?.noPrice) || 0, unreachable: Number(group?.unreachable) || 0
  }));
}
