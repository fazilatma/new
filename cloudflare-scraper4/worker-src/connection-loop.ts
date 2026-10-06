/**
 * Connection feedback loop ("حلقهٔ بازخورد اتصال").
 *
 * A source such as emalls.ir answers 403 (or a Cloudflare/WAF challenge page) to the plain
 * scraper request, and the only way to find the one request shape it accepts is to try, look
 * at the answer, and let that answer choose the next attempt. That is what this module does:
 *
 *     attempt → classify the answer → plan the next attempt from that verdict → verify the
 *     winner against real page content → remember the recipe for that host → reuse it.
 *
 * It is deliberately runtime free: both twins (Cloudflare Worker and Node/Render) inject their
 * own transport, state storage and clock, so the identical loop runs in both and in tests
 * against fixtures with no network at all.
 */

import { shapeUrl, urlEncodingNotes, URL_SHAPE_LABELS, type UrlShape } from './url-shapes.js';

export type LoopVerdict =
  | 'ok'            // real page content came back
  | 'forbidden'     // 401/403 — the edge refused this request shape
  | 'challenge'     // an anti-bot interstitial instead of the page
  | 'throttled'     // 429 — slow down and try the same shape again
  | 'server'        // 5xx / Cloudflare 52x — origin or edge trouble
  | 'empty'         // 200 but nothing usable in the body
  | 'mismatch'      // a real page, but not the expected content (selector found nothing)
  | 'network';      // DNS/TLS/timeout — the request never completed

export type RecipeRoute = 'direct' | 'worker';

export type ConnectionRecipe = {
  id: string;
  label: string;
  route: RecipeRoute;
  /** Warm up by requesting the site root first and reusing its cookies + referer. */
  warm?: boolean;
  /**
   * Spell the URL differently for this attempt. Encoding is part of the request fingerprint:
   * a Persian query written with `+` instead of `%20`, or an address that was pasted already
   * encoded, is a different request as far as a WAF or an IIS pipeline is concerned.
   */
  url?: UrlShape;
  headers: (target: URL) => Record<string, string>;
};

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const BROWSER_NAV: Record<string, string> = {
  'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate', 'sec-fetch-user': '?1',
  'sec-fetch-dest': 'document', 'upgrade-insecure-requests': '1'
};
const CLIENT_HINTS: Record<string, string> = {
  'sec-ch-ua': '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  'sec-ch-ua-mobile': '?0', 'sec-ch-ua-platform': '"Windows"'
};

/** Ordered pool of request shapes, cheapest and most "normal" first. */
export const CONNECTION_RECIPES: ConnectionRecipe[] = [
  { id: 'direct', label: 'مستقیم (پیش‌فرض)', route: 'direct', headers: () => ({}) },
  {
    id: 'direct-referer', label: 'مستقیم + ارجاع و هدرهای ناوبری', route: 'direct',
    headers: target => ({ referer: target.origin + '/', ...BROWSER_NAV })
  },
  {
    id: 'direct-hints', label: 'مستقیم + Client Hints کروم', route: 'direct',
    headers: target => ({ referer: target.origin + '/', ...BROWSER_NAV, ...CLIENT_HINTS, 'accept-language': 'fa-IR,fa;q=0.9,en;q=0.6' })
  },
  {
    id: 'direct-mobile', label: 'مستقیم با مرورگر موبایل', route: 'direct',
    headers: target => ({ 'user-agent': MOBILE_UA, referer: target.origin + '/', ...BROWSER_NAV,
      'sec-ch-ua-mobile': '?1', 'sec-ch-ua-platform': '"Android"' })
  },
  {
    id: 'direct-search-bot', label: 'مستقیم با عامل موتور جست‌وجو', route: 'direct',
    headers: () => ({ 'user-agent': BOT_UA, from: 'googlebot(at)googlebot.com', 'accept-language': 'fa-IR,fa;q=0.9' })
  },
  {
    id: 'direct-warm', label: 'گرم‌کردن صفحهٔ اصلی و سپس درخواست', route: 'direct', warm: true,
    headers: target => ({ referer: target.origin + '/', ...BROWSER_NAV, ...CLIENT_HINTS })
  },
  {
    id: 'url-unescape', label: 'آدرس با یک لایه رمزگذاری کمتر', route: 'direct', url: 'unescape-once',
    headers: target => ({ referer: target.origin + '/', ...BROWSER_NAV })
  },
  {
    id: 'url-plus-space', label: 'فاصلهٔ کوئری به‌صورت +', route: 'direct', url: 'plus-space',
    headers: target => ({ referer: target.origin + '/', ...BROWSER_NAV })
  },
  {
    id: 'url-space-20', label: 'فاصلهٔ کوئری به‌صورت %20', route: 'direct', url: 'space-20',
    headers: target => ({ referer: target.origin + '/', ...BROWSER_NAV })
  },
  {
    id: 'url-lower-escapes', label: 'کدهای درصدی با حروف کوچک', route: 'direct', url: 'lower-escapes',
    headers: target => ({ referer: target.origin + '/', ...BROWSER_NAV })
  },
  { id: 'worker', label: 'از مسیر Worker واسط', route: 'worker', headers: () => ({}) },
  {
    id: 'worker-ua', label: 'Worker واسط + هدرهای مرورگر بالادست', route: 'worker',
    headers: target => ({ 'x-proxy-ua': DESKTOP_UA, 'x-proxy-referer': target.origin + '/' })
  }
];

export function recipeById(id: string): ConnectionRecipe | undefined {
  return CONNECTION_RECIPES.find(recipe => recipe.id === id);
}

const CHALLENGE = /(cf-chl-|challenge-platform|cdn-cgi\/challenge-platform|g-recaptcha|hcaptcha|__cf_chl|turnstile)/i;
const CHALLENGE_TITLE = /<title[^>]*>\s*(just a moment|attention required|access denied|lütfen bekleyin|دسترسی غیرمجاز|صفحه در دسترس نیست)/i;

/** What did the site actually answer? The verdict is what drives the next attempt. */
export function classifyAttempt(input: { status?: number; text?: string; error?: string }): { verdict: LoopVerdict; note: string } {
  const status = Number(input.status || 0);
  const text = String(input.text || '');
  if (input.error) {
    if (/timeout|مهلت/i.test(input.error)) return { verdict: 'network', note: 'مهلت درخواست تمام شد.' };
    return { verdict: 'network', note: input.error.slice(0, 180) };
  }
  const sample = text.slice(0, 200_000);
  if (CHALLENGE.test(sample) || CHALLENGE_TITLE.test(sample))
    return { verdict: 'challenge', note: 'صفحهٔ چالش ضدربات به‌جای محتوا برگشت.' };
  if (status === 401 || status === 403) return { verdict: 'forbidden', note: `وضعیت ${status}: این شکل درخواست پذیرفته نشد.` };
  if (status === 429) return { verdict: 'throttled', note: 'وضعیت ۴۲۹: محدودیت نرخ درخواست.' };
  if (status >= 500) return { verdict: 'server', note: `وضعیت ${status}: خطای سرور/لبه.` };
  if (status && (status < 200 || status >= 400)) return { verdict: 'forbidden', note: `وضعیت ${status}.` };
  if (text.trim().length < 500 || !/<html|<body|<div|<main/i.test(sample))
    return { verdict: 'empty', note: 'پاسخ خالی یا بدون ساختار HTML بود.' };
  return { verdict: 'ok', note: `پاسخ سالم (${text.length} کاراکتر).` };
}

/**
 * The feedback step. Each verdict points at the family of request shapes that can plausibly
 * fix it, so the loop converges instead of brute forcing the whole table.
 */
export const VERDICT_PLAN: Record<LoopVerdict, string[]> = {
  // A challenge is an IP/JS problem: header cosmetics never solve it, leave the network.
  challenge: ['worker', 'worker-ua', 'direct-warm'],
  // A plain refusal is usually about how the request looks.
  forbidden: ['direct-referer', 'direct-hints', 'url-unescape', 'url-plus-space', 'url-space-20', 'url-lower-escapes',
    'direct-warm', 'direct-mobile', 'direct-search-bot', 'worker', 'worker-ua'],
  throttled: ['direct-referer', 'direct-hints', 'worker'],
  server: ['direct-referer', 'worker', 'worker-ua'],
  empty: ['direct-hints', 'url-unescape', 'url-plus-space', 'direct-warm', 'direct-mobile', 'worker'],
  mismatch: ['url-unescape', 'url-plus-space', 'direct-hints', 'direct-warm', 'direct-mobile', 'worker', 'worker-ua'],
  network: ['direct-referer', 'worker', 'worker-ua'],
  ok: []
};

export type PlanOptions = {
  hasGateway: boolean;
  /**
   * False when the installation is configured for indirect access only (mode «worker» or the
   * profile's «اتصال غیرمستقیم»). A direct request would then leak the server's own IP to a
   * source the user deliberately routes around, so the loop must never plan one.
   */
  allowDirect?: boolean;
};

function usable(recipe: ConnectionRecipe, tried: string[], options: PlanOptions): boolean {
  if (tried.includes(recipe.id)) return false;
  if (recipe.route === 'worker' && !options.hasGateway) return false;
  if (recipe.route === 'direct' && options.allowDirect === false) return false;
  return true;
}

export function planNext(verdict: LoopVerdict, tried: string[], options: PlanOptions): ConnectionRecipe | null {
  for (const id of VERDICT_PLAN[verdict] || []) {
    const recipe = recipeById(id);
    if (recipe && usable(recipe, tried, options)) return recipe;
  }
  // Nothing left in the targeted pool: fall back to any untried shape before giving up.
  return CONNECTION_RECIPES.find(recipe => usable(recipe, tried, options)) || null;
}

/**
 * Content check for the loop: a 200 that does not contain the profile's own list selector is
 * NOT a healed connection — it is usually the "soft block" page a WAF serves with status 200.
 * Only the stable signals of the selector are looked for (ids, classes, attributes, tags), so
 * this stays a cheap string test that works in both runtimes without a DOM.
 */
export function selectorSignals(selector: string): RegExp[] {
  const first = String(selector || '').split(',')[0] || '';
  const out: RegExp[] = [];
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const match of first.matchAll(/#([\w-]+)/g)) out.push(new RegExp(`id\\s*=\\s*["']?${escape(match[1]!)}["'\\s>]`, 'i'));
  for (const match of first.matchAll(/\.([\w-]+)/g)) out.push(new RegExp(`class\\s*=\\s*["'][^"']*\\b${escape(match[1]!)}\\b`, 'i'));
  for (const match of first.matchAll(/\[([\w-]+)/g)) out.push(new RegExp(`${escape(match[1]!)}\\s*=`, 'i'));
  if (!out.length) for (const match of first.matchAll(/(^|[\s>+~])([a-zA-Z][\w-]*)/g)) out.push(new RegExp(`<${escape(match[2]!)}[\\s>]`, 'i'));
  return out;
}

export function pageMatchesSelector(text: string, selector: string): boolean {
  const signals = selectorSignals(selector);
  if (!signals.length) return true;
  return signals.every(signal => signal.test(text));
}

export function selectorVerifier(selector?: string): LoopDeps['verify'] {
  if (!String(selector || '').trim()) return undefined;
  return ({ text }) => pageMatchesSelector(text, String(selector))
    ? { ok: true, note: 'محتوای فهرست محصولات در پاسخ پیدا شد.' }
    : { ok: false, note: `صفحه باز شد ولی نشانه‌های سلکتور فهرست («${String(selector).slice(0, 60)}») در آن نبود.` };
}

export type LoopAttempt = {
  round: number; recipe: string; label: string; route: RecipeRoute;
  /** The exact address this attempt sent — the spelling matters, so it is reported. */
  url: string; shape: UrlShape; shapeLabel: string;
  status: number; verdict: LoopVerdict; note: string; ms: number; bytes: number;
};

export type LoopReport = {
  ok: boolean; url: string; host: string;
  recipe: string | null; route: RecipeRoute | null;
  /** The spelling that worked (or was last tried) and what is unusual about the address. */
  shape: UrlShape | null; sentUrl: string | null; urlNotes: string[];
  attempts: LoopAttempt[];
  advice: string;
  learned: boolean;
};

export type LoopTransport = (input: {
  url: string; route: RecipeRoute; headers: Record<string, string>; warm: boolean;
}) => Promise<{ status: number; text: string; url?: string; error?: string }>;

export type LoopDeps = {
  transport: LoopTransport;
  hasGateway: boolean;
  /** See PlanOptions.allowDirect — mirrors the configured source-connection mode. */
  allowDirect?: boolean;
  getState: <T>(key: string, fallback: T) => Promise<T>;
  setState: (key: string, value: unknown) => Promise<void>;
  /** Content check that decides whether a 200 really is the page we wanted. */
  verify?: (result: { text: string; url: string }) => Promise<{ ok: boolean; note: string }> | { ok: boolean; note: string };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export type LearnedRecipe = { recipe: string; route: RecipeRoute; shape: UrlShape; at: number; verdictBefore: LoopVerdict | null };

export function recipeKey(url: string): string {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { host = String(url).toLowerCase(); }
  return 'net.recipe:' + host;
}

export async function learnedRecipe(getState: LoopDeps['getState'], url: string): Promise<LearnedRecipe | null> {
  const saved = await getState<LearnedRecipe | null>(recipeKey(url), null);
  return saved && recipeById(saved.recipe) ? saved : null;
}

export async function forgetRecipe(setState: LoopDeps['setState'], url: string): Promise<void> {
  await setState(recipeKey(url), null);
}

const MAX_ROUNDS = 8;

/**
 * Runs the loop until the source answers with verified content or the pool is exhausted.
 * Always returns a report — the attempt table is the diagnosis, even when nothing worked.
 */
export async function runConnectionLoop(deps: LoopDeps, options: { url: string; maxRounds?: number; startWith?: string }): Promise<LoopReport> {
  const now = deps.now || (() => Date.now());
  const sleep = deps.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const target = new URL(options.url);
  const canonical = target.href;
  const rounds = Math.max(1, Math.min(MAX_ROUNDS, Number(options.maxRounds) || MAX_ROUNDS));
  const attempts: LoopAttempt[] = [];
  const tried: string[] = [];
  const sent = new Set<string>();
  const plan = { hasGateway: deps.hasGateway, allowDirect: deps.allowDirect !== false };
  const urlNotes = urlEncodingNotes(options.url);
  const first = recipeById(options.startWith || '');
  // Start from the remembered shape when there is one, otherwise from the plain request —
  // unless direct access is not allowed at all, in which case start at the gateway.
  let recipe: ConnectionRecipe | null = first && usable(first, [], plan) ? first
    : plan.allowDirect ? CONNECTION_RECIPES[0]! : planNext('forbidden', [], plan);
  let throttleWaits = 0;
  let lastVerdict: LoopVerdict = 'forbidden';

  /** Skips a planned recipe whose URL spelling is identical to one already sent: no new information. */
  const pick = (candidate: ConnectionRecipe | null): { recipe: ConnectionRecipe; url: string } | null => {
    while (candidate) {
      const url = shapeUrl(canonical, candidate.url || 'canonical');
      const duplicate = Boolean(candidate.url) && sent.has(candidate.route + ':' + url);
      if (!duplicate && !tried.includes(candidate.id)) return { recipe: candidate, url };
      tried.push(candidate.id);
      candidate = planNext(lastVerdict, tried, plan);
    }
    return null;
  };

  let current = pick(recipe);
  for (let round = 1; round <= rounds && current; round++) {
    const started = now();
    const { recipe: active, url: sentUrl } = current;
    tried.push(active.id);
    sent.add(active.route + ':' + sentUrl);
    let raw: { status: number; text: string; url?: string; error?: string };
    try {
      raw = await deps.transport({ url: sentUrl, route: active.route, headers: active.headers(target), warm: Boolean(active.warm) });
    } catch (error) {
      raw = { status: 0, text: '', error: error instanceof Error ? error.message : String(error) };
    }
    let { verdict, note } = classifyAttempt(raw);
    if (verdict === 'ok' && deps.verify) {
      const checked = await deps.verify({ text: raw.text, url: raw.url || sentUrl });
      if (!checked.ok) { verdict = 'mismatch'; note = checked.note || 'محتوای مورد انتظار در صفحه پیدا نشد.'; }
      else note = checked.note || note;
    }
    const shape: UrlShape = active.url || 'canonical';
    attempts.push({
      round, recipe: active.id, label: active.label, route: active.route,
      url: sentUrl, shape, shapeLabel: URL_SHAPE_LABELS[shape],
      status: Number(raw.status || 0), verdict, note, ms: Math.max(0, now() - started),
      bytes: String(raw.text || '').length
    });
    lastVerdict = verdict;

    if (verdict === 'ok') {
      const learned: LearnedRecipe = { recipe: active.id, route: active.route, shape, at: now(), verdictBefore: attempts[0]?.verdict ?? null };
      await deps.setState(recipeKey(canonical), learned);
      const spelling = shape === 'canonical' ? '' : ` با نگارش آدرس «${URL_SHAPE_LABELS[shape]}»`;
      return {
        ok: true, url: canonical, host: target.hostname, recipe: active.id, route: active.route,
        shape, sentUrl, urlNotes, attempts, learned: true,
        advice: `این روش جواب داد: «${active.label}»${spelling}. از این پس همین روش برای ${target.hostname} به‌صورت خودکار استفاده می‌شود.`
      };
    }

    // 429 is the one verdict that asks for patience rather than a different shape.
    if (verdict === 'throttled' && throttleWaits < 2) { throttleWaits++; tried.pop(); await sleep(1500 * throttleWaits); continue; }

    current = pick(planNext(verdict, tried, plan));
  }

  return {
    ok: false, url: canonical, host: target.hostname, recipe: null, route: null,
    shape: null, sentUrl: attempts.length ? attempts[attempts.length - 1]!.url : null, urlNotes,
    attempts, learned: false,
    advice: failureAdvice(attempts, deps.hasGateway, urlNotes)
  };
}

export function failureAdvice(attempts: LoopAttempt[], hasGateway: boolean, urlNotes: string[] = []): string {
  const verdicts = attempts.map(a => a.verdict);
  // An address that is spelled oddly is the cheapest explanation of a refusal, so it is said first.
  if (urlNotes.length && verdicts.every(v => v === 'forbidden' || v === 'empty' || v === 'mismatch'))
    return 'هیچ شکلی از درخواست پذیرفته نشد و نگارش خود آدرس هم مشکوک است: ' + urlNotes[0] + ' آدرس پروفایل را مستقیم از نوار آدرس مرورگر کپی کنید.';
  if (!hasGateway && (verdicts.includes('challenge') || verdicts.includes('forbidden')))
    return 'همهٔ شکل‌های درخواست مستقیم رد شدند. این یعنی مسدودسازی بر اساس IP است: در «روش اتصال مبدأ» آدرس Worker واسط را وارد کنید تا حلقه بتواند مسیر غیرمستقیم را هم امتحان کند.';
  if (verdicts.includes('challenge'))
    return 'حتی از مسیر Worker هم صفحهٔ چالش برگشت. یک Worker/پراکسی با IP ایران یا موتور مرورگر (Playwright) برای این دامنه لازم است.';
  if (verdicts.every(v => v === 'network'))
    return 'هیچ درخواستی به مقصد نرسید؛ DNS یا دسترسی شبکهٔ میزبان را بررسی کنید.';
  if (verdicts.includes('mismatch'))
    return 'صفحه باز می‌شود ولی محتوای مورد انتظار داخلش نیست؛ این دیگر مشکل اتصال نیست، سلکتورها یا موتور استخراج را بررسی کنید.';
  if (verdicts.includes('server'))
    return 'سایت مبدأ خطای سرور می‌دهد؛ کمی بعد دوباره امتحان کنید.';
  return 'هیچ‌کدام از روش‌های موجود جواب نداد؛ جدول تلاش‌ها را برای انتخاب روش بعدی ببینید.';
}

/** Should a failed fetch trigger a fresh loop? Only for block-shaped failures, and not too often. */
export function shouldAutoHeal(message: string): boolean {
  const text = String(message || '');
  // The source gateway already runs the same two worker shapes (plain, then x-proxy-ua) and
  // reports them as «attempts: 403 → 403». Re-running the loop would repeat exactly those two
  // requests for nothing, so an exhausted gateway is a dead end, not a healing opportunity.
  if (/attempts:\s*\d+\s*→/.test(text)) return false;
  return /HTTP (401|403|429)\b|ضدربات|چالش|challenge|Access denied|Forbidden/i.test(text);
}

export const AUTO_HEAL_COOLDOWN_MS = 10 * 60 * 1000;

export async function autoHealAllowed(deps: Pick<LoopDeps, 'getState' | 'setState'>, url: string, now = Date.now()): Promise<boolean> {
  const key = recipeKey(url) + ':healed';
  const last = Number(await deps.getState<number>(key, 0)) || 0;
  if (now - last < AUTO_HEAL_COOLDOWN_MS) return false;
  await deps.setState(key, now);
  return true;
}
