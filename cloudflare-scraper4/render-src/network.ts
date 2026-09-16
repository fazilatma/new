import dns from 'node:dns/promises';
import net from 'node:net';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { config } from './config.js';

/**
 * Outbound proxy for ALL source-site traffic.
 *
 * The «روش اتصال» setting configured a proxy that only the AI model calls ever
 * used: scraping the source shop went through the bare global fetch(), so a
 * user who entered a Cloudflare Worker / proxy URL to get around a sanction
 * block still got the block on every extraction. safeFetch() is the single
 * choke point for source traffic, so the proxy is applied here.
 *
 * Set lazily by configureSourceNetwork() to avoid importing the vault (and its
 * database) from this low-level module.
 */
type SourceNetwork = { mode: string; proxyUrl: string; workerUrl: string };
let sourceNetwork: SourceNetwork = { mode: 'direct', proxyUrl: '', workerUrl: '' };
export function configureSourceNetwork(value: Partial<SourceNetwork> | null | undefined): void {
  sourceNetwork = { mode: String(value?.mode || 'direct'), proxyUrl: String(value?.proxyUrl || ''), workerUrl: String(value?.workerUrl || '') };
}
export function sourceNetworkConfig(): SourceNetwork { return sourceNetwork; }
/** Wraps a target URL in the configured Worker/gateway URL. */
/**
 * Normalises a user-entered proxy/Worker address.
 *
 * A bare hostname like "proxy.example.workers.dev" is a RELATIVE URL: it used to
 * resolve against our own origin, so every proxied request returned 404.
 */
export function normalizeProxyUrl(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) throw new Error(`آدرس پراکسی «${value}» نسبی است؛ باید با https:// شروع شود.`);
  return 'https://' + value.replace(/^\/+/, '');
}

export function viaWorkerUrl(workerUrl: string, target: string): string {
  const base = normalizeProxyUrl(workerUrl);
  return base.includes('{url}')
    ? base.replace('{url}', encodeURIComponent(target))
    : base + (base.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(target);
}

export function privateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a,b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const value = ip.toLowerCase();
  return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:') || value === '::';
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP/HTTPS URLs are allowed');
  if (url.username || url.password) throw new Error('Credentials in URLs are not allowed');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private hosts are not allowed');
  const addresses = await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(item => privateIp(item.address))) throw new Error('Private or unresolved destination is not allowed');
  return url;
}

/**
 * The guard for AI provider base URLs — deliberately looser than `assertPublicUrl`.
 *
 * `assertPublicUrl` exists so an untrusted scrape target can never make this server
 * knock on an internal port. An AI base URL is not untrusted input: the person who
 * owns the dashboard typed it, and the documented Termux / VPS setup points at
 * Ollama on `127.0.0.1:11434` (or LM Studio, llama.cpp and vLLM on the LAN).
 * Applying the scrape-site guard to it made every model row fail with
 * "Private hosts are not allowed" on Linux and Termux, while the exact same
 * configuration worked on Cloudflare — where the Worker has no such guard.
 *
 * Still enforced: http/https only, no credentials smuggled into the URL, and the
 * link-local range that carries cloud metadata (`169.254.0.0/16`) stays closed, so
 * a saved provider row cannot be turned into a metadata-service hop.
 */
export async function assertAiEndpointUrl(raw: string): Promise<URL> {
  const url = new URL(String(raw || ''));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('آدرس ارائه‌دهنده باید با http:// یا https:// شروع شود.');
  if (url.username || url.password) throw new Error('نام کاربری/رمز در آدرس ارائه‌دهنده مجاز نیست؛ کلید API را در فیلد خودش وارد کنید.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const metadata = (ip: string) => ip.startsWith('169.254.') || ip.toLowerCase() === 'fe80::1';
  if (net.isIP(host)) { if (metadata(host)) throw new Error('آدرس IP مقولهٔ ابر (metadata) مجاز نیست.'); return url; }
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'host.docker.internal') return url;
  let addresses: Array<{ address: string }> = [];
  try { addresses = await dns.lookup(host, { all: true }); } catch { throw new Error(`آدرس ارائه‌دهنده «${host}» resolve نشد؛ سرور AI را روشن کنید یا آدرس را بررسی کنید.`); }
  if (!addresses.length) throw new Error(`آدرس ارائه‌دهنده «${host}» هیچ IP‌ای ندارد.`);
  if (addresses.every(item => metadata(item.address))) throw new Error('آدرس ارائه‌دهنده به محدودهٔ metadata ابر می‌رسد و اجازه ندارد.');
  return url;
}

/**
 * Basalam-aware request path. The «اتصال غیرمستقیم» checkbox was stored but never
 * read, so enabling it changed nothing. When it is on, Basalam calls are routed
 * through the configured reverse Worker so they do not leave from a datacenter
 * IP that Basalam's edge rejects (which surfaces as a 401 for a valid token).
 */
/** Send only the caller's headers (JSON APIs), with no browser defaults. */
export type ApiRequestInit = RequestInit & {
  apiMode?: boolean;
  /**
   * Never reroute through `sourceNetwork`. That config belongs to SCRAPING the
   * source shop; applying it to a destination API sent authenticated Basalam
   * calls through the AI proxy Worker, which does not forward Authorization —
   * so Basalam saw no token and answered 401 for a token that is provably
   * valid (all four doctor probes return 200 on a direct request).
   */
  directRoute?: boolean;
  /**
   * Validate with `assertAiEndpointUrl` instead of `assertPublicUrl`: an AI provider
   * base URL is typed by the dashboard owner and may legitimately point at Ollama,
   * llama.cpp or vLLM on this machine or the LAN (the normal Termux / self-hosted
   * setup). Never set this for a URL that came from scraped content.
   */
  aiEndpoint?: boolean;
};

export async function safeBasalamFetch(raw: string, init: ApiRequestInit = {}, maxBytes = 8_000_000): Promise<Response> {
  const { loadConnections } = await import('./connections.js');
  const connections = await loadConnections();
  const indirect = Boolean((connections.basalam as any)?.netIndirect);
  const workerUrl = (connections as any).ai?.network?.workerUrl || sourceNetwork.workerUrl || '';
  if (indirect && !workerUrl)
    throw new Error('«اتصال غیرمستقیم» برای باسلام روشن است اما آدرس Worker واسط وارد نشده؛ آن را در «🤖 هوش مصنوعی ← روش اتصال» تنظیم کنید.');
  if (indirect && workerUrl) {
    const headers = new Headers(init.headers);
    headers.set('x-scraper-target', raw);
    headers.set('x-target-url', raw);
    return safeFetch(viaWorkerUrl(workerUrl, raw), { ...init, headers, apiMode: true, directRoute: true }, maxBytes);
  }
  return safeFetch(raw, { ...init, apiMode: true, directRoute: true }, maxBytes);
}

function sleepMs(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, Math.max(0, ms))); }
/**
 * Retry-After in milliseconds: a seconds value (capped at 10s so one rude
 * header cannot stall a whole benchmark) or an HTTP date; default 2s.
 */
function retryAfterMs(response: Response): number {
  const raw = (response.headers.get('retry-after') || '').trim();
  if (/^\d+$/.test(raw)) return Math.min(10_000, Number(raw) * 1000);
  const when = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(when)) return Math.min(10_000, Math.max(0, when - Date.now()));
  return 2_000;
}
export async function safeFetch(raw: string, init: ApiRequestInit = {}, maxBytes = 8_000_000): Promise<Response> {
  let url = await (init.aiEndpoint === true ? assertAiEndpointUrl(raw) : assertPublicUrl(raw)), throttleRetries = 0;
  for (let redirects = 0; redirects < 5; redirects++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      // Honour the configured indirect route. `worker` rewrites the URL (the
      // gateway fetches the target for us); `proxy` keeps the URL and sends the
      // request through an HTTP(S) proxy via undici.
      const routed = init.directRoute !== true;
      const useWorker = routed && sourceNetwork.mode === 'worker' && sourceNetwork.workerUrl;
      const useProxy = routed && sourceNetwork.mode === 'proxy' && sourceNetwork.proxyUrl;
      const requestUrl = useWorker ? viaWorkerUrl(sourceNetwork.workerUrl, url.href) : url.href;
      const doFetch: typeof fetch = useProxy
        ? ((input: any, options: any) => undiciFetch(input, { ...options, dispatcher: new ProxyAgent(sourceNetwork.proxyUrl) }) as any)
        : fetch;
      const response = await doFetch(requestUrl, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
        // Browser-shaped defaults are for SCRAPING shop pages. They must never be
        // sent to a JSON API: a desktop-Chrome user-agent with no matching browser
        // fingerprint is a WAF signature, and Basalam/Cloudflare reject it with
        // 401 "invalid authorization header" / 522 before reading the token.
        // scraper4.php sends only Accept, Authorization and Content-Type.
        headers: (init as ApiRequestInit).apiMode
          ? { ...init.headers }
          : {
            'user-agent': config.userAgent,
            accept: 'text/html,application/xhtml+xml,application/json;q=0.9,application/xml;q=0.8,*/*;q=0.5',
            'accept-language': 'fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.6',
            'cache-control': 'no-cache',
            ...init.headers
          }
      });
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect without location');
        url = await (init.aiEndpoint === true ? assertAiEndpointUrl(new URL(location, url).href) : assertPublicUrl(new URL(location, url).href));
        continue;
      }
      // 1.141.0 — one bounded retry on 429 (rate-limit). Shops throttle bursts
      // (a benchmark fires ~30 fetches in seconds) and the throttle is usually
      // a seconds-long window, so honour Retry-After (capped) or wait 2s once.
      // Anything else (403 bans, 5xx) fails fast: retrying a ban digs deeper.
      if (response.status === 429 && throttleRetries < 1) {
        throttleRetries++;
        await response.arrayBuffer().catch(() => undefined);
        await sleepMs(retryAfterMs(response));
        continue;
      }
      const length = Number(response.headers.get('content-length') || 0);
      if (length > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
      return response;
    } finally { clearTimeout(timeout); }
  }
  throw new Error('Too many redirects');
}

/**
 * Detects an anti-bot/challenge page returned instead of real content, so the
 * user gets an actionable message instead of a silent zero-product run.
 * Mirrors ensureTextResponse() in worker-src/network.ts.
 */
export function ensureTextResponse(text: string, contentType: string, url: string): void {
  if (contentType && !/(?:text\/|json|xml|xhtml|javascript|octet-stream)/i.test(contentType)) throw new Error(`نوع پاسخ مبدأ برای استخراج مناسب نیست (${contentType}).`);
  const sample = text.slice(0, 200_000);
  if (/(?:cf-chl-|challenge-platform|cdn-cgi\/challenge-platform|g-recaptcha|hcaptcha)/i.test(sample) || /<title[^>]*>\s*(?:Just a moment|Attention Required|Access denied)/i.test(sample)) throw new Error(`صفحهٔ ضدربات/چالش به‌جای محتوای محصول از ${url} دریافت شد. روش اتصال غیرمستقیم را بررسی کنید.`);
}

export async function safeText(raw: string, maxBytes = 8_000_000): Promise<{ text: string; url: string }> {
  const response = await safeFetch(raw, {}, maxBytes);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${raw}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
  const text = new TextDecoder().decode(buffer);
  ensureTextResponse(text, response.headers.get('content-type') || '', raw);
  return { text, url: response.url || raw };
}
