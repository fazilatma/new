/**
 * Host environment feedback loop.
 *
 * Why this exists: the very same build behaves differently on a VPS (app mounted on the domain
 * root, free outbound network) and on shared hosting (app mounted in a subfolder behind a proxy,
 * outbound network filtered, source sites blocking the shared IP). The symptoms the user sees are
 * vague — "fonts are not applied", "the size does not change", "the source answers 403" — and the
 * panel used to stay silent about which of those environments it is actually running in.
 *
 * So instead of guessing, we probe: every check below asks ONE question, reads the real answer and
 * the answer decides what the next question is (a 403 from the source means "ask a mirror", a 502
 * from our own font route means "ask the font CDNs directly", HTML coming back from an asset URL
 * means "the request left the mount"). The result is a short Persian diagnosis with the next step,
 * never a bare status code.
 *
 * Runtime free on purpose (same contract as api-loop.ts / connection-loop.ts): every side effect is
 * injected, so both worker-src/app.ts and render-src/server.ts drive the identical logic and the
 * lab tests can run it without a network.
 */

export type ProbeVerdict = 'ok' | 'missing' | 'wrong-type' | 'blocked' | 'offline' | 'empty' | 'skipped';

export type ProbeAnswer = {
  status: number;
  contentType?: string;
  body?: string;
  bytes?: number;
  error?: string;
};

export type HostProbe = {
  id: string;
  label: string;
  url: string;
  status: number;
  contentType: string;
  bytes: number;
  verdict: ProbeVerdict;
  note: string;
};

export type HostMount = {
  origin: string;
  prefix: string;
  publicBase: string;
  atRoot: boolean;
  source: 'header' | 'path' | 'root';
};

export type HostDiagnosis = {
  ok: boolean;
  runtime: string;
  version: string;
  mount: HostMount;
  scraperPath: string;
  appearance: { font: string; fontSize: string; writable: boolean | null; error: string };
  probes: HostProbe[];
  findings: string[];
  advice: string[];
  summary: string;
};

export type HostDiagnosisDeps = {
  runtime: string;
  version: string;
  /** Full URL of the diagnosis request itself; the mount prefix is read back from it. */
  requestUrl: string;
  forwardedPrefix?: string;
  /** Folder the dashboard is served from inside the app, e.g. "scraper" (no slashes). */
  scraperPath?: string;
  /** One real source URL (the first profile) so the 403 question is asked about the user's site. */
  sourceUrl?: string;
  /** Appearance currently stored server side plus whether a write round trip succeeded. */
  appearance?: { font?: string; fontSize?: string; writable?: boolean | null; error?: string };
  probe: (url: string, init?: { headers?: Record<string, string> }) => Promise<ProbeAnswer>;
};

const FONT_MIRRORS: Array<[string, string]> = [
  ['cdn.fontcdn.ir', 'https://cdn.fontcdn.ir/Fonts/Vazirmatn/Vazirmatn-Regular.woff2'],
  ['cdn.jsdelivr.net', 'https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/fonts/webfonts/Vazirmatn-Regular.woff2'],
  ['unpkg.com', 'https://unpkg.com/vazirmatn@33.003/fonts/webfonts/Vazirmatn-Regular.woff2']
];

/** Public mirrors reused from the source side loop: they answer with the page of another site. */
export function mirrorUrl(target: string): string {
  return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(target);
}

/** Strip the API suffix (or trust X-Forwarded-Prefix) to learn where the app is really mounted. */
export function readMount(requestUrl: string, forwardedPrefix?: string, apiPath = '/api/diag/host'): HostMount {
  let origin = '', path = '/';
  try { const url = new URL(requestUrl); origin = url.origin; path = url.pathname || '/'; } catch { origin = ''; path = requestUrl || '/'; }
  const header = normalizePrefix(forwardedPrefix || '');
  let prefix = header, source: HostMount['source'] = header ? 'header' : 'root';
  if (!prefix && path.endsWith(apiPath)) {
    const candidate = normalizePrefix(path.slice(0, path.length - apiPath.length));
    if (candidate) { prefix = candidate; source = 'path'; }
  }
  return { origin, prefix, publicBase: (origin + prefix) || prefix || '', atRoot: !prefix, source };
}

function normalizePrefix(value: string): string {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === '/') return '';
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed;
}

function looksHtml(answer: ProbeAnswer): boolean {
  const type = String(answer.contentType || '').toLowerCase();
  if (type.includes('html')) return true;
  return /^\s*(<!doctype html|<html)/i.test(String(answer.body || ''));
}

function size(answer: ProbeAnswer): number {
  if (Number.isFinite(answer.bytes)) return Number(answer.bytes);
  return answer.body ? answer.body.length : 0;
}

/** One answer in, one verdict plus a Persian sentence out. No HTTP knowledge leaks to the caller. */
export function classifyProbe(kind: 'font-css' | 'font-file' | 'mirror-cdn' | 'source' | 'mirror', answer: ProbeAnswer): { verdict: ProbeVerdict; note: string } {
  if (answer.error && !answer.status) return { verdict: 'offline', note: 'پاسخی نرسید: ' + answer.error };
  const status = Number(answer.status || 0), bytes = size(answer);
  if (kind === 'font-css') {
    if (status === 200 && looksHtml(answer)) return { verdict: 'wrong-type', note: 'به‌جای CSS، صفحهٔ HTML برگشت؛ یعنی این آدرس از مسیر برنامه بیرون رفته و به سایت اصلی خورده است.' };
    if (status === 404) return { verdict: 'missing', note: 'آدرس شیت فونت روی این میزبانی پیدا نشد (۴۰۴).' };
    if (status >= 500) return { verdict: 'blocked', note: 'سرور هنگام ساخت شیت فونت خطا داد (' + status + ').' };
    if (status !== 200) return { verdict: 'blocked', note: 'پاسخ غیرمنتظره: ' + status };
    if (!/@font-face/.test(String(answer.body || ''))) return { verdict: 'empty', note: 'شیت برگشت ولی هیچ @font-face نداشت.' };
    return { verdict: 'ok', note: 'شیت فونت سالم است.' };
  }
  if (kind === 'font-file') {
    if (status === 200 && looksHtml(answer)) return { verdict: 'wrong-type', note: 'به‌جای فایل فونت، HTML برگشت؛ درخواست به سایت اصلی رسیده نه به برنامه.' };
    if (status === 404) return { verdict: 'missing', note: 'فایل woff2 روی این میزبانی سرو نشد (۴۰۴).' };
    if (status === 502 || status === 504) return { verdict: 'blocked', note: 'برنامه نتوانست فایل فونت را از CDN بگیرد؛ خروجی اینترنت این سرور بسته یا فیلتر است.' };
    if (status !== 200) return { verdict: 'blocked', note: 'پاسخ غیرمنتظره: ' + status };
    if (bytes < 2000) return { verdict: 'empty', note: 'فایل فونت برگشت ولی حجمش بسیار کم است (' + bytes + ' بایت).' };
    return { verdict: 'ok', note: 'فایل فونت با حجم ' + bytes + ' بایت سرو شد.' };
  }
  if (kind === 'mirror-cdn') {
    if (status === 200) return { verdict: 'ok', note: 'این CDN از سرور قابل دسترس است.' };
    if (status === 403 || status === 451) return { verdict: 'blocked', note: 'این CDN درخواست سرور را رد کرد (' + status + ').' };
    if (!status) return { verdict: 'offline', note: 'ارتباط با این CDN برقرار نشد.' };
    return { verdict: 'blocked', note: 'پاسخ ' + status + ' از این CDN.' };
  }
  // source + mirror answers
  if (!status) return { verdict: 'offline', note: 'ارتباط برقرار نشد' + (answer.error ? ': ' + answer.error : '.') };
  if (status === 403 || status === 401) return { verdict: 'blocked', note: 'منبع درخواست این سرور را رد کرد (' + status + ').' };
  if (status === 429) return { verdict: 'blocked', note: 'منبع محدودیت نرخ گذاشت (۴۲۹).' };
  if (status >= 500) return { verdict: 'blocked', note: 'منبع خطای سرور داد (' + status + ').' };
  if (status !== 200) return { verdict: 'blocked', note: 'پاسخ ' + status + ' از منبع.' };
  if (bytes < 500) return { verdict: 'empty', note: 'پاسخ ۲۰۰ بود ولی تقریباً خالی (' + bytes + ' بایت).' };
  return { verdict: 'ok', note: 'صفحه با ' + bytes + ' بایت خوانده شد.' };
}

function probeOf(id: string, label: string, url: string, answer: ProbeAnswer, kind: Parameters<typeof classifyProbe>[0]): HostProbe {
  const { verdict, note } = classifyProbe(kind, answer);
  return { id, label, url, status: Number(answer.status || 0), contentType: String(answer.contentType || ''), bytes: size(answer), verdict, note };
}

const skipped = (id: string, label: string, note: string): HostProbe =>
  ({ id, label, url: '', status: 0, contentType: '', bytes: 0, verdict: 'skipped', note });

/** Deterministic Persian verdict: every line names the cause and the next step, never a bare code. */
export function hostAdvice(diagnosis: Omit<HostDiagnosis, 'advice' | 'summary' | 'ok'>): { findings: string[]; advice: string[] } {
  const findings: string[] = [], advice: string[] = [];
  const probe = (id: string) => diagnosis.probes.find(p => p.id === id);
  const css = probe('font-css'), file = probe('font-file');
  const cdns = diagnosis.probes.filter(p => p.id.startsWith('cdn:'));
  const source = probe('source'), mirror = probe('source-mirror');
  const mount = diagnosis.mount;

  if (!mount.atRoot) findings.push('برنامه در زیرپوشهٔ «' + mount.prefix + '» سرو می‌شود (نه ریشهٔ دامنه)؛ هر آدرس مطلقی که با / شروع شود از این پوشه بیرون می‌زند.');
  else findings.push('برنامه روی ریشهٔ دامنه سرو می‌شود.');

  if (css && (css.verdict === 'wrong-type' || css.verdict === 'missing')) {
    findings.push('شیت فونت از آدرس عمومی خوانده نشد: ' + css.note);
    advice.push(mount.atRoot
      ? 'مسیر assets/fonts روی این میزبانی به برنامه نمی‌رسد؛ قانون پراکسی یا .htaccess را طوری تنظیم کنید که کل مسیر به همین برنامه برود.'
      : 'پراکسی این هاست باید «' + mount.prefix + '/assets/fonts/…» را هم به برنامه بدهد؛ از این نسخه، خود صفحه آدرس فونت را نسبی می‌خواهد تا داخل همین پوشه بماند.');
  }
  if (file && file.verdict === 'blocked') {
    findings.push('فایل فونت سرو نشد: ' + file.note);
    const openCdn = cdns.filter(c => c.verdict === 'ok');
    if (!openCdn.length) advice.push('هیچ‌کدام از CDNهای فونت از این سرور باز نشدند؛ یعنی خروجی اینترنت هاست بسته است. یک‌بار فایل‌های woff2 را دستی در پوشهٔ data/fonts (یا مسیر FONT_CACHE_DIR) بگذارید تا برنامه از همان‌جا سرو کند، یا در «فونت کل سایت» گزینهٔ «پیش‌فرض سیستم» را انتخاب کنید.');
    else advice.push('این CDNها از سرور باز هستند: ' + openCdn.map(c => c.label).join('، ') + '؛ پس مشکل در خود مسیر سرو فونت است نه در شبکه.');
  }
  if (file && file.verdict === 'wrong-type') advice.push('درخواست فایل فونت به سایت اصلی رسیده است؛ یعنی پیشوند نصب در آدرس‌ها رعایت نشده — صفحه را یک‌بار با آدرس کامل همین پوشه (با / پایانی) باز کنید.');

  if (diagnosis.appearance.writable === false) {
    findings.push('نوشتن تنظیمات ظاهری روی این میزبانی شکست خورد' + (diagnosis.appearance.error ? ': ' + diagnosis.appearance.error : '.'));
    advice.push('تا وقتی ذخیرهٔ تنظیمات کار نکند، انتخاب فونت و اندازه بعد از بارگذاری دوباره برمی‌گردد؛ دسترسی نوشتن پایگاه‌داده یا پوشهٔ داده را بررسی کنید.');
  }

  if (source) {
    if (source.verdict === 'skipped') findings.push('بررسی منبع انجام نشد: ' + source.note);
    else if (source.verdict === 'ok') findings.push('منبع از همین سرور مستقیم باز شد.');
    else {
      findings.push('منبع از این سرور باز نشد: ' + source.note);
      if (mirror && mirror.verdict === 'ok') advice.push('همان صفحه از آینهٔ عمومی باز شد؛ یعنی آدرس و سلکتورها سالم‌اند و IP این هاست توسط منبع مسدود شده است. حلقهٔ بازخورد اتصال خودش از آینه استفاده می‌کند؛ فقط مطمئن شوید کلید «آینه‌های عمومی» در روش اتصال مبدأ روشن است.');
      else if (mirror && mirror.verdict !== 'skipped') advice.push('نه مسیر مستقیم و نه آینهٔ عمومی از این هاست جواب نداد؛ یعنی خروجی اینترنت این میزبانی محدود است. اگر همین پروفایل روی VPS یا Worker شما باز می‌شود، در «روش اتصال مبدأ» حالت Worker را انتخاب و آدرس همان نصب سالم را به‌عنوان واسط وارد کنید.');
    }
  }
  if (!advice.length) advice.push('در این اجرا همهٔ بررسی‌ها سالم بودند؛ اگر باز هم فونت یا اندازه عوض نشد، یک‌بار حافظهٔ مرورگر (Ctrl+F5) را پاک کنید.');
  return { findings, advice };
}

export async function runHostDiagnosis(deps: HostDiagnosisDeps): Promise<HostDiagnosis> {
  const mount = readMount(deps.requestUrl, deps.forwardedPrefix);
  const base = mount.publicBase;
  const probes: HostProbe[] = [];

  // 1) Ask our own public address for the font stylesheet exactly like a browser would.
  const cssUrl = base + '/assets/fonts/vazir.css';
  const cssAnswer = await deps.probe(cssUrl, { headers: { accept: 'text/css,*/*' } });
  const cssProbe = probeOf('font-css', 'شیت فونت وزیر', cssUrl, cssAnswer, 'font-css');
  probes.push(cssProbe);

  // 2) Only if the sheet exists does asking for the file itself mean anything.
  let fileProbe: HostProbe;
  if (cssProbe.verdict === 'ok' || cssProbe.verdict === 'empty') {
    const fileUrl = base + '/assets/fonts/vazir-400.woff2';
    fileProbe = probeOf('font-file', 'فایل فونت وزیر (۴۰۰)', fileUrl, await deps.probe(fileUrl, { headers: { accept: 'font/woff2' } }), 'font-file');
  } else {
    fileProbe = skipped('font-file', 'فایل فونت وزیر (۴۰۰)', 'چون خود شیت فونت خوانده نشد، فایل فونت پرسیده نشد.');
  }
  probes.push(fileProbe);

  // 3) The answer decides: a 502 on our own file means the question belongs to the CDNs.
  if (fileProbe.verdict === 'blocked' || fileProbe.verdict === 'empty') {
    for (const [label, url] of FONT_MIRRORS) {
      probes.push(probeOf('cdn:' + label, label, url, await deps.probe(url, { headers: { accept: 'font/woff2' } }), 'mirror-cdn'));
    }
  }

  // 4) The source side of the same environment question (the 403 the user reports).
  if (deps.sourceUrl) {
    const sourceProbe = probeOf('source', 'منبع (مستقیم)', deps.sourceUrl, await deps.probe(deps.sourceUrl, { headers: { accept: 'text/html,*/*' } }), 'source');
    probes.push(sourceProbe);
    if (sourceProbe.verdict !== 'ok') {
      const url = mirrorUrl(deps.sourceUrl);
      probes.push(probeOf('source-mirror', 'منبع (آینهٔ عمومی)', url, await deps.probe(url, { headers: { accept: 'text/html,*/*' } }), 'mirror'));
    }
  } else {
    probes.push(skipped('source', 'منبع (مستقیم)', 'هیچ پروفایلی با آدرس مبدأ ثبت نشده بود.'));
  }

  const appearance = {
    font: String(deps.appearance?.font || ''),
    fontSize: String(deps.appearance?.fontSize || ''),
    writable: deps.appearance?.writable === undefined ? null : deps.appearance.writable,
    error: String(deps.appearance?.error || '')
  };
  const core = {
    runtime: deps.runtime,
    version: deps.version,
    mount,
    scraperPath: String(deps.scraperPath || ''),
    appearance,
    probes,
    findings: [] as string[]
  };
  const { findings, advice } = hostAdvice(core);
  const bad = probes.filter(p => p.verdict !== 'ok' && p.verdict !== 'skipped');
  return {
    ok: bad.length === 0 && appearance.writable !== false,
    runtime: core.runtime,
    version: core.version,
    mount,
    scraperPath: core.scraperPath,
    appearance,
    probes,
    findings,
    advice,
    summary: bad.length
      ? 'تعداد بررسی‌های ناموفق: ' + bad.length + ' از ' + probes.filter(p => p.verdict !== 'skipped').length
      : 'همهٔ بررسی‌های محیط میزبانی سالم بودند.'
  };
}
