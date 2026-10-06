/**
 * Destination API feedback loop («حلقهٔ بازخورد ارسال»).
 *
 * The twin of worker-src/connection-loop.ts, for the other direction of traffic: instead of
 * reading a source page that refuses us, it WRITES a product to a destination API that can
 * answer «۴۰۴ Not Found» simply because the endpoint we learned once has moved.
 *
 *     attempt → classify the answer → let that answer choose the next request shape →
 *     remember the shape that worked → reuse it next time.
 *
 * The reason this exists: Basalam replaced its per-microservice APIs with one gateway, and the
 * two product-write endpoints no longer look alike —
 *
 *     create: POST  https://openapi.basalam.com/v1/vendors/{vendor_id}/products
 *     update: PATCH https://openapi.basalam.com/v1/products/{product_id}      ← no vendor!
 *
 * A sender that keeps PATCHing `/vendors/{v}/products/{id}` gets a 404 forever, and so does a
 * sender whose stored product id was deleted inside Basalam's own panel. Those two causes look
 * identical from one request, which is exactly why a loop — not a single call — is needed: if
 * EVERY known update shape answers 404, the endpoint is not the problem, the id is, and the
 * product has to be created again.
 *
 * Runtime free on purpose: both twins inject their own transport, state storage and clock, so
 * the identical loop runs in the Worker, in Node, and in tests with no network at all.
 */

export type ApiVerdict =
  | 'ok'          // the destination accepted the write
  | 'path'        // 404/405 — this endpoint shape does not exist (or the product id is gone)
  | 'auth'        // 401 — the token itself is not accepted
  | 'scope'       // 403 — a valid token without permission for this write
  | 'payload'     // 400/422 — the endpoint is right, the body is not
  | 'throttled'   // 429 — same shape, just slower
  | 'server'      // 5xx — the destination is having trouble
  | 'network';    // the request never completed

export type WriteKind = 'create' | 'update';

export type ApiShape = {
  id: string;
  label: string;
  kind: WriteKind;
  method: 'POST' | 'PATCH';
  url: string;
};

export type BasalamWriteContext = {
  /** The configured API base, e.g. https://openapi.basalam.com/v1 */
  base: string;
  vendorId: string | number;
  /** Only for «update»: the remote product id we believe exists. */
  productId?: string | number | null;
};

export const BASALAM_GATEWAY = 'https://openapi.basalam.com/v1';
const BASALAM_CORE_V4 = 'https://core.basalam.com/v4';

/**
 * A base that is empty, has a trailing slash, or lost its version segment turns every write
 * into a 404 before the loop even starts, so it is repaired first.
 */
export function normalizeApiBase(raw: string): string {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return BASALAM_GATEWAY;
  try {
    const url = new URL(value);
    if (/(^|\.)openapi\.basalam\.com$/i.test(url.hostname) && !/\/v\d+/i.test(url.pathname))
      return url.origin + '/v1';
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch { return BASALAM_GATEWAY; }
}

const encodeId = (value: string | number | null | undefined) => encodeURIComponent(String(value ?? ''));

/**
 * The ordered pool of write shapes, documented gateway first and the legacy microservice last.
 * Shapes that resolve to the same address (the usual case when the configured base already is
 * the gateway) are collapsed, so the loop never asks the same question twice.
 */
export function basalamWriteShapes(kind: WriteKind, context: BasalamWriteContext): ApiShape[] {
  const base = normalizeApiBase(context.base);
  const vendor = encodeId(context.vendorId);
  const product = encodeId(context.productId);
  const shapes: ApiShape[] = kind === 'create'
    ? [
      { id: 'create-base-vendor', label: 'ساخت محصول روی مسیر تنظیم‌شده', kind, method: 'POST', url: `${base}/vendors/${vendor}/products` },
      { id: 'create-gateway-vendor', label: 'ساخت محصول روی Gateway رسمی باسلام', kind, method: 'POST', url: `${BASALAM_GATEWAY}/vendors/${vendor}/products` },
      { id: 'create-core-v4', label: 'ساخت محصول روی سرویس قدیمی core v4', kind, method: 'POST', url: `${BASALAM_CORE_V4}/vendors/${vendor}/products` },
    ]
    : [
      // The documented gateway shape: a product is edited by its own id, without the vendor.
      { id: 'update-base-product', label: 'ویرایش با شناسهٔ محصول (مسیر رسمی)', kind, method: 'PATCH', url: `${base}/products/${product}` },
      { id: 'update-base-vendor', label: 'ویرایش زیر مسیر غرفه', kind, method: 'PATCH', url: `${base}/vendors/${vendor}/products/${product}` },
      { id: 'update-gateway-product', label: 'ویرایش روی Gateway رسمی باسلام', kind, method: 'PATCH', url: `${BASALAM_GATEWAY}/products/${product}` },
      { id: 'update-core-v4', label: 'ویرایش روی سرویس قدیمی core v4', kind, method: 'PATCH', url: `${BASALAM_CORE_V4}/products/${product}` },
    ];
  const seen = new Set<string>();
  return shapes.filter(shape => {
    const key = shape.method + ' ' + shape.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** What did the destination actually answer? The verdict is what drives the next move. */
export function classifyApiAnswer(input: { status?: number; body?: any; text?: string; error?: string }): { verdict: ApiVerdict; note: string } {
  const status = Number(input.status || 0);
  const message = String(
    (input.body && (input.body.message || input.body.error || input.body.detail)) ||
    input.text || ''
  ).replace(/\s+/g, ' ').slice(0, 180);
  if (input.error) return { verdict: 'network', note: String(input.error).slice(0, 180) };
  if (!status) return { verdict: 'network', note: 'درخواست به مقصد نرسید.' };
  if (status >= 200 && status < 300) return { verdict: 'ok', note: `وضعیت ${status}: پذیرفته شد.` };
  if (status === 404 || status === 405 || status === 410 || status === 501)
    return { verdict: 'path', note: `وضعیت ${status}: این مسیر وجود ندارد یا این شناسه روی مقصد نیست.${message ? ' ' + message : ''}` };
  if (status === 401) return { verdict: 'auth', note: `وضعیت ۴۰۱: توکن پذیرفته نشد.${message ? ' ' + message : ''}` };
  if (status === 403) return { verdict: 'scope', note: `وضعیت ۴۰۳: توکن اجازهٔ این عملیات را ندارد.${message ? ' ' + message : ''}` };
  if (status === 429) return { verdict: 'throttled', note: 'وضعیت ۴۲۹: محدودیت نرخ درخواست.' };
  if (status >= 500) return { verdict: 'server', note: `وضعیت ${status}: خطای سرور مقصد.${message ? ' ' + message : ''}` };
  return { verdict: 'payload', note: `وضعیت ${status}: مقصد محتوای محصول را نپذیرفت.${message ? ' ' + message : ''}` };
}

export type ApiAttempt = {
  round: number; shape: string; label: string; method: string; url: string;
  status: number; verdict: ApiVerdict; note: string; ms: number;
};

export type ApiWriteReport = {
  ok: boolean;
  target: string;
  kind: WriteKind;
  shape: string | null;
  label: string | null;
  url: string | null;
  status: number;
  verdict: ApiVerdict;
  body: any;
  attempts: ApiAttempt[];
  advice: string;
  learned: boolean;
  /** Every known update shape answered 404: the remote product is gone, build it again. */
  retryAsCreate: boolean;
};

export type ApiTransport = (input: { url: string; method: 'POST' | 'PATCH'; shape: string })
  => Promise<{ status: number; body?: any; text?: string; error?: string }>;

export type ApiLoopDeps = {
  transport: ApiTransport;
  getState: <T>(key: string, fallback: T) => Promise<T>;
  setState: (key: string, value: unknown) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type LearnedApiShape = { shape: string; url: string; at: number; kind: WriteKind };

/** Where the winning shape and the last diagnosis live, per destination and per write kind. */
export function apiShapeKey(target: string, kind: WriteKind): string { return `api.shape:${target}:${kind}`; }
export function apiLoopKey(target: string, kind: WriteKind): string { return `api.loop:${target}:${kind}`; }

export function summarizeApiAttempts(attempts: ApiAttempt[]): string {
  return attempts.map(attempt => {
    let path = attempt.url;
    try { path = new URL(attempt.url).pathname; } catch { /* keep the raw string */ }
    return `${attempt.method} ${path} → ${attempt.status || '—'}`;
  }).join(' | ');
}

export function apiFailureAdvice(kind: WriteKind, attempts: ApiAttempt[]): string {
  const verdicts = attempts.map(attempt => attempt.verdict);
  const last = attempts[attempts.length - 1];
  if (verdicts.length && verdicts.every(verdict => verdict === 'path')) {
    return kind === 'update'
      ? 'هیچ‌کدام از مسیرهای شناخته‌شدهٔ ویرایش این محصول را پیدا نکردند؛ یعنی این شناسه دیگر روی باسلام وجود ندارد (در پنل باسلام حذف شده است). محصول به‌جای ویرایش، دوباره ساخته می‌شود.'
      : 'هیچ‌کدام از مسیرهای ساخت محصول پاسخ ندادند؛ آدرس پایهٔ API باسلام را در «اتصال‌ها» برابر https://openapi.basalam.com/v1 بگذارید و شناسهٔ غرفه را بررسی کنید.';
  }
  if (verdicts.includes('auth'))
    return 'مسیر درست پیدا شد ولی توکن پذیرفته نشد؛ از پنل توسعه‌دهندگان باسلام یک توکن تازه بسازید.';
  if (verdicts.includes('scope'))
    return 'مسیر درست است اما توکن دسترسی «vendor.product.write» را ندارد؛ توکن را با همین Scope و برای همین غرفه بسازید.';
  if (verdicts.includes('payload'))
    return `مسیر ارسال درست است و ایراد از محتوای خود محصول است: ${last?.note || ''}`.trim();
  if (verdicts.includes('throttled'))
    return 'باسلام محدودیت نرخ اعمال کرد؛ ارسال را با فاصلهٔ زمانی بیشتر دوباره اجرا کنید.';
  if (verdicts.includes('server'))
    return 'سرور باسلام خطای داخلی داد؛ کمی بعد دوباره تلاش کنید.';
  if (verdicts.length && verdicts.every(verdict => verdict === 'network'))
    return 'هیچ درخواستی به باسلام نرسید؛ دسترسی شبکهٔ میزبان یا تنظیم «اتصال غیرمستقیم» را بررسی کنید.';
  return 'ارسال انجام نشد؛ جدول تلاش‌ها را برای دیدن پاسخ هر مسیر ببینید.';
}

const MAX_ROUNDS = 6;

/**
 * Runs the write loop until the destination accepts the product or every known shape has
 * answered. Always returns a report — the attempt table is the diagnosis, even on failure.
 */
export async function runApiWriteLoop(
  deps: ApiLoopDeps,
  options: { kind: WriteKind; context: BasalamWriteContext; target?: string; maxRounds?: number }
): Promise<ApiWriteReport> {
  const target = options.target || 'basalam';
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const kind = options.kind;
  const pool = basalamWriteShapes(kind, options.context);
  // Start from the shape that worked last time: the loop pays its research cost once.
  const learned = await deps.getState<LearnedApiShape | null>(apiShapeKey(target, kind), null);
  const ordered = learned?.shape && pool.some(shape => shape.id === learned.shape)
    ? [...pool.filter(shape => shape.id === learned.shape), ...pool.filter(shape => shape.id !== learned.shape)]
    : pool;
  const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(options.maxRounds) || MAX_ROUNDS));
  const attempts: ApiAttempt[] = [];
  let round = 0;
  // The last body is kept even on failure: a 422 explains itself in its own fields.
  let lastBody: any = {};

  for (const shape of ordered) {
    if (round >= rounds) break;
    let waits = 0, retries = 0;
    // The same shape is repeated only for the two verdicts that ask for patience, never for
    // a 404 — repeating a missing endpoint is how a loop turns into a spin.
    for (;;) {
      round++;
      const started = now();
      let raw: { status: number; body?: any; text?: string; error?: string };
      try { raw = await deps.transport({ url: shape.url, method: shape.method, shape: shape.id }); }
      catch (error) { raw = { status: 0, error: error instanceof Error ? error.message : String(error) }; }
      const { verdict, note } = classifyApiAnswer(raw);
      lastBody = raw.body ?? {};
      attempts.push({
        round, shape: shape.id, label: shape.label, method: shape.method, url: shape.url,
        status: Number(raw.status || 0), verdict, note, ms: Math.max(0, now() - started)
      });

      if (verdict === 'ok') {
        const win: LearnedApiShape = { shape: shape.id, url: shape.url, at: now(), kind };
        await deps.setState(apiShapeKey(target, kind), win);
        const report: ApiWriteReport = {
          ok: true, target, kind, shape: shape.id, label: shape.label, url: shape.url,
          status: Number(raw.status || 0), verdict, body: raw.body ?? {}, attempts, learned: true,
          retryAsCreate: false,
          advice: `این مسیر جواب داد: «${shape.label}». از این پس همین شکل درخواست برای ${kind === 'create' ? 'ساخت' : 'ویرایش'} محصول استفاده می‌شود.`
        };
        await deps.setState(apiLoopKey(target, kind), { ok: true, at: now(), shape: shape.id, attempts, advice: report.advice });
        return report;
      }
      if (verdict === 'throttled' && waits < 2) { waits++; await sleep(1500 * waits); continue; }
      if (verdict === 'server' && retries < 1) { retries++; await sleep(800); continue; }
      break;
    }
    const lastVerdict = attempts[attempts.length - 1]!.verdict;
    // 404/405 is the only answer that means «ask somewhere else»; everything else is about us,
    // so trying further addresses would only hide the real reason.
    if (lastVerdict !== 'path') break;
  }

  const verdict = attempts.length ? attempts[attempts.length - 1]!.verdict : 'network';
  const retryAsCreate = kind === 'update'
    && attempts.length > 0
    && attempts.every(attempt => attempt.verdict === 'path')
    && attempts.some(attempt => attempt.status === 404 || attempt.status === 410);
  const advice = apiFailureAdvice(kind, attempts);
  await deps.setState(apiLoopKey(target, kind), { ok: false, at: now(), attempts, advice });
  return {
    ok: false, target, kind, shape: null, label: null,
    url: attempts.length ? attempts[attempts.length - 1]!.url : null,
    status: attempts.length ? attempts[attempts.length - 1]!.status : 0,
    verdict, body: lastBody, attempts, advice, learned: false, retryAsCreate
  };
}
