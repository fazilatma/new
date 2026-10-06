/**
 * URL encoding is part of the request fingerprint.
 *
 * A Persian source URL (`https://emalls.ir/جستجو/کفش-زنانه?q=کفش زنانه`) can be written in
 * several byte-for-byte different ways that all "mean" the same page — and a WAF, a CDN cache
 * or an IIS/ASP.NET pipeline does NOT treat them the same. Two separate problems live here:
 *
 * 1. We must never change the encoding of a URL the user gave us. `URLSearchParams.set()`
 *    re-serialises the WHOLE query (`%20`→`+`, `/`→`%2F`, `,`→`%2C`), so appending `page=2`
 *    used to send page 1 and page 2 with different encodings of the same Persian search term.
 *    `setQueryParam()` below edits one parameter and leaves every other byte untouched.
 *
 * 2. When a site refuses us, the encoding itself is a suspect worth testing. `shapeUrl()`
 *    produces the handful of equivalent spellings a real browser or a different client would
 *    send, so the connection feedback loop can try them as deliberate experiments.
 *
 * Runtime free on purpose: both twins and the offline tests share this file.
 */

export type UrlShape = 'canonical' | 'plus-space' | 'space-20' | 'unescape-once' | 'lower-escapes';

function splitUrl(href: string): { head: string; query: string; hash: string } {
  const hashAt = href.indexOf('#');
  const hash = hashAt >= 0 ? href.slice(hashAt) : '';
  const rest = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = rest.indexOf('?');
  return queryAt >= 0 ? { head: rest.slice(0, queryAt), query: rest.slice(queryAt + 1), hash } : { head: rest, query: '', hash };
}

function joinUrl(parts: { head: string; query: string; hash: string }): string {
  return parts.head + (parts.query ? '?' + parts.query : '') + parts.hash;
}

function sameParam(rawName: string, param: string): boolean {
  if (rawName === param) return true;
  try { return decodeURIComponent(rawName.replace(/\+/g, ' ')) === param; } catch { return false; }
}

/**
 * Sets (or appends) ONE query parameter without touching the encoding of the others.
 * This is the encoding-safe replacement for `url.searchParams.set(...)`.
 */
export function setQueryParam(href: string, param: string, value: string): string {
  const parts = splitUrl(href);
  const pairs = parts.query ? parts.query.split('&') : [];
  const encoded = encodeURIComponent(param) + '=' + encodeURIComponent(value);
  let replaced = false;
  const next = pairs.filter(Boolean).map(pair => {
    if (!sameParam(pair.split('=')[0] || '', param)) return pair;
    if (replaced) return '';
    replaced = true;
    return encoded;
  }).filter(Boolean);
  if (!replaced) next.push(encoded);
  return joinUrl({ ...parts, query: next.join('&') });
}

/** Removes query parameters, again without re-encoding anything that stays. */
export function deleteQueryParams(href: string, params: string[]): string {
  const parts = splitUrl(href);
  if (!parts.query) return href;
  const next = parts.query.split('&').filter(pair => pair && !params.some(param => sameParam(pair.split('=')[0] || '', param)));
  return joinUrl({ ...parts, query: next.join('&') });
}

/** Reads a query parameter value (decoded) without building a URLSearchParams. */
export function readQueryParam(href: string, param: string): string {
  const { query } = splitUrl(href);
  for (const pair of query ? query.split('&') : []) {
    const equals = pair.indexOf('=');
    const name = equals >= 0 ? pair.slice(0, equals) : pair;
    if (!sameParam(name, param)) continue;
    const raw = equals >= 0 ? pair.slice(equals + 1) : '';
    try { return decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { return raw; }
  }
  return '';
}

/** True when the URL carries a doubly percent-encoded sequence such as `%25D8%25AC`. */
export function doubleEncoded(href: string): boolean {
  return /%25[0-9A-Fa-f]{2}/.test(href);
}

const PERCENT = /%[0-9A-Fa-f]{2}/g;

/** The equivalent spellings of one URL that the loop is allowed to try. */
export function shapeUrl(href: string, shape: UrlShape): string {
  const parts = splitUrl(href);
  switch (shape) {
    case 'plus-space':
      return joinUrl({ ...parts, query: parts.query.replace(/%20/g, '+') });
    case 'space-20':
      return joinUrl({ ...parts, query: parts.query.replace(/\+/g, '%20') });
    case 'unescape-once': {
      if (!doubleEncoded(href)) return href;
      try { return href.replace(/%25([0-9A-Fa-f]{2})/g, (_m, hex) => '%' + hex); } catch { return href; }
    }
    case 'lower-escapes':
      return href.replace(PERCENT, match => match.toLowerCase());
    default:
      return href;
  }
}

export const URL_SHAPE_LABELS: Record<UrlShape, string> = {
  canonical: 'آدرس استاندارد',
  'plus-space': 'فاصله به‌صورت +',
  'space-20': 'فاصله به‌صورت %20',
  'unescape-once': 'رفع رمزگذاری دوباره',
  'lower-escapes': 'کدهای درصدی با حروف کوچک'
};

/**
 * Plain-Persian notes about the encoding of a URL, shown next to a failed connection so the
 * user can see WHY the loop is trying different spellings.
 */
export function urlEncodingNotes(href: string): string[] {
  const notes: string[] = [];
  const parts = splitUrl(href);
  if (doubleEncoded(href)) notes.push('آدرس دوبار رمزگذاری شده است (مثل %25D8)؛ معمولاً از کپی‌کردن آدرسِ از قبل انکدشده می‌آید و سایت آن را صفحهٔ دیگری می‌بیند.');
  if (/[^\x00-\x7F]/.test(href)) notes.push('آدرس حرف غیرانگلیسی خام دارد؛ هنگام ارسال به شکل درصدی (UTF-8) تبدیل می‌شود.');
  if (/%20/.test(parts.query)) notes.push('فاصله در کوئری به‌صورت %20 است؛ بعضی سایت‌های ASP.NET شکل + را می‌پذیرند.');
  if (/\+/.test(parts.query)) notes.push('کوئری شامل + است؛ اگر + واقعاً «فاصله» نیست باید %2B باشد.');
  if (PERCENT.test(href) && /%[0-9a-f]{2}/.test(href.replace(/%[0-9A-F]{2}/g, ''))) notes.push('کدهای درصدی با حروف کوچک نوشته شده‌اند؛ چند CDN آن را متفاوت از حروف بزرگ کش می‌کنند.');
  if (/\s/.test(href)) notes.push('آدرس فاصلهٔ خام دارد؛ حتماً باید به %20 یا + تبدیل شود.');
  return notes;
}
