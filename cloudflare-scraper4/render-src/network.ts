import { sourceWorkerUrl, fetchSourceGateway, sourceGatewayAttempts } from '../worker-src/source-network.js';
import { mirrorById, unwrapMirror, type MirrorId } from '../worker-src/source-mirrors.js';
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
let sourceNetworkLoader: ((url: string) => Promise<SourceNetwork>) | undefined;
export function registerSourceNetworkLoader(loader: (url: string) => Promise<SourceNetwork>): void { sourceNetworkLoader = loader; }
export function configureSourceNetwork(value: Partial<SourceNetwork> | null | undefined): void {
  sourceNetwork = { mode: String(value?.mode || 'direct'), proxyUrl: String(value?.proxyUrl || ''), workerUrl: String(value?.workerUrl || '') };
}
export function sourceNetworkConfig(): SourceNetwork { return sourceNetwork; }
/**
 * Which route a source fetch would take. Reported by the extraction
 * diagnostic, so a site block can be traced to direct device egress instead
 * of guessing. Twin of the routing decision in worker-src/scraper.ts
 * sourceText(): per-profile indirect or global worker mode wins, then the
 * global proxy, otherwise direct.
 */
export function sourceRoute(indirect = false): 'worker' | 'proxy' | 'direct' {
  if ((indirect || sourceNetwork.mode === 'worker') && sourceNetwork.workerUrl) return 'worker';
  if (sourceNetwork.mode === 'proxy' && sourceNetwork.proxyUrl) return 'proxy';
  return 'direct';
}
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
 * The guard for AI provider base URLs — deliberately looser than assertPublicUrl.
 *
 * assertPublicUrl exists so an untrusted scrape target can never make this server knock on an
 * internal port. An AI base URL is not untrusted input: the person who owns the dashboard typed
 * it, and the documented Termux / VPS setup points at Ollama on 127.0.0.1:11434 (or LM Studio,
 * llama.cpp and vLLM on the LAN). Applying the scrape-site guard to it made every model row fail
 * with "Private or unresolved destination is not allowed" on Linux and Termux, while the same
 * configuration worked on Cloudflare — where the Worker has no such guard.
 *
 * Still enforced: http/https only, no credentials smuggled into the URL, and the link-local range
 * that carries cloud metadata (169.254.0.0/16) stays closed, so a saved provider row cannot be
 * turned into a metadata-service hop.
 */
export async function assertAiEndpointUrl(raw: string): Promise<URL> {
  const url = new URL(String(raw || ''));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('آدرس ارائه‌دهنده باید با http:// یا https:// شروع شود.');
  if (url.username || url.password) throw new Error('نام کاربری/رمز در آدرس ارائه‌دهنده مجاز نیست؛ کلید API را در فیلد خودش وارد کنید.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const metadata = (ip: string) => ip.startsWith('169.254.') || ip.toLowerCase() === 'fe80::1';
  if (net.isIP(host)) { if (metadata(host)) throw new Error('آدرس IP سرویس ابر (metadata) مجاز نیست.'); return url; }
  if (host === 'localhost' || host.endsWith('.localhost') || host === 'host.docker.internal') return url;
  let addresses: Array<{ address: string }> = [];
  try { addresses = await dns.lookup(host, { all: true }); } catch { throw new Error('آدرس ارائه‌دهنده «' + host + '» resolve نشد؛ سرور AI را روشن کنید یا آدرس را درست کنید.'); }
  if (!addresses.length) throw new Error('آدرس ارائه‌دهنده «' + host + '» هیچ IP‌ای ندارد.');
  if (addresses.every(item => metadata(item.address))) throw new Error('آدرس ارائه‌دهنده به محدودهٔ metadata سرویس ابر می‌رسد و اجازه ندارد.');
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
   * Validate with assertAiEndpointUrl instead of assertPublicUrl: an AI provider base URL is typed
   * by the dashboard owner and may legitimately point at Ollama / llama.cpp / vLLM on this machine
   * or the LAN (the normal Termux and self-hosted setup). Never set this for a URL from scraped content.
   */
  aiEndpoint?: boolean;
  /**
   * Per-profile «اتصال غیرمستقیم» for SOURCE extraction. Forces this request
   * through the configured Worker gateway even when the global mode is
   * direct. Without a gateway (and no global proxy) the request fails with
   * the missing-gateway error instead of silently going direct — a silent
   * direct fetch is exactly how a sanction-blocked shop answers 403 while
   * the same profile works on the Worker.
   */
  indirect?: boolean;
  /**
   * Skip the learned connection recipe. Set by the connection feedback loop itself: while the
   * loop is measuring one request shape, silently merging a remembered shape on top of it
   * would make every attempt untrustworthy.
   */
  noRecipe?: boolean;
};

/**
 * Hooks installed by render-src/connection-heal.ts so every source fetch of this runtime
 * replays the request shape the host already accepted, and one block-shaped failure heals
 * itself instead of failing identically forever. Twin: sourceText() in worker-src/scraper.ts.
 */
export type LearnedRequestShape = { headers: Record<string, string>; route: 'direct' | 'worker' | 'mirror'; url?: string; mirror?: MirrorId };
export type HealedRequestShape = Partial<LearnedRequestShape> & { advice?: string };
export type ConnectionRecipeHooks = {
  learned: (url: string) => Promise<LearnedRequestShape | null>;
  heal: (url: string, message: string) => Promise<HealedRequestShape | null>;
};
let recipeHooks: ConnectionRecipeHooks | null = null;
export function registerConnectionRecipe(hooks: ConnectionRecipeHooks | null): void { recipeHooks = hooks; }
export function connectionRecipeHooks(): ConnectionRecipeHooks | null { return recipeHooks; }

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

const sourceResponses = new WeakMap<Response, { url: string; route: string }>();
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
  const network = init.directRoute !== true && init.aiEndpoint !== true && sourceNetworkLoader ? await sourceNetworkLoader(raw) : sourceNetwork;
  if (init.directRoute !== true) configureSourceNetwork(network);
  let url = await (init.aiEndpoint === true ? assertAiEndpointUrl(raw) : assertPublicUrl(raw)), throttleRetries = 0;
  // Replay the request shape this host already accepted (see connection-heal.ts).
  const learned = recipeHooks && init.directRoute !== true && init.aiEndpoint !== true && init.apiMode !== true && init.noRecipe !== true
    ? await recipeHooks.learned(url.href).catch(() => null) : null;
  if (learned) {
    init = { ...init, headers: { ...(learned.headers as any), ...(init.headers as any) }, indirect: init.indirect || learned.route === 'worker' };
    // The remembered recipe may also respell the address (e.g. a Persian query with + instead
    // of %20); keep the host/origin checks by re-validating the respelled URL.
    if (learned.url && learned.url !== url.href) url = await assertPublicUrl(learned.url);
  }
  for (let redirects = 0; redirects < 5; redirects++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      // Honour the configured indirect route. `worker` rewrites the URL (the
      // gateway fetches the target for us); `proxy` keeps the URL and sends the
      // request through an HTTP(S) proxy via undici.
      const routed = init.directRoute !== true && init.aiEndpoint !== true;
      const forceWorker = (init as ApiRequestInit).indirect === true;
      const useProxy = routed && network.mode === 'proxy' && network.proxyUrl && !(forceWorker && network.workerUrl);
      if (routed && network.mode === 'worker' && !network.workerUrl) throw new Error('Worker URL در تنظیمات اتصال مبدأ خالی است.');
      if (routed && forceWorker && !network.workerUrl && !useProxy)
        throw new Error('برای اتصال غیرمستقیم، Worker URL را در تنظیمات روش اتصال وارد کنید.');
      const useWorker = routed && (network.mode === 'worker' || forceWorker) && network.workerUrl;
      const requestUrl = useWorker ? sourceWorkerUrl(network.workerUrl, url.href) : url.href;
      const doFetch: typeof fetch = useProxy
        ? ((input: any, options: any) => undiciFetch(input, { ...options, dispatcher: new ProxyAgent(network.proxyUrl) }) as any)
        : fetch;
      const requestInit: RequestInit = {
        ...init,
        redirect: 'manual',
        signal: init.signal?AbortSignal.any([controller.signal,init.signal]):controller.signal,
        // Browser-shaped defaults are for SCRAPING shop pages. They must never be
        // sent to a JSON API: a desktop-Chrome user-agent with no matching browser
        // fingerprint is a WAF signature, and Basalam/Cloudflare reject it with
        // 401 "invalid authorization header" / 522 before reading the token.
        // scraper4.php sends only Accept, Authorization and Content-Type.
        headers: (init as ApiRequestInit).apiMode
          ? { ...(useWorker ? { 'x-scraper-target': url.href, 'x-target-url': url.href } : null), ...init.headers }
          : {
            'user-agent': config.userAgent,
            accept: 'text/html,application/xhtml+xml,application/json;q=0.9,application/xml;q=0.8,*/*;q=0.5',
            'accept-language': 'fa-IR,fa;q=0.9,en-US;q=0.7,en;q=0.6',
            'cache-control': 'no-cache',
            // The gateway contract (scripts/ai-proxy-worker.js): the target
            // travels in ?url= AND these headers, like the Worker's
            // safeTextViaWorker. A gateway that reads only headers would
            // otherwise answer 400 for every Node-routed request.
            ...(useWorker ? { 'x-scraper-target': url.href, 'x-target-url': url.href } : null),
            ...init.headers
          }
      };
      const send = (options: RequestInit) => doFetch(requestUrl, options);
      const response = useWorker && !init.apiMode
        ? await fetchSourceGateway(url.href, requestUrl, requestInit, send)
        : await send(requestInit);
      if ([301,302,303,307,308].includes(response.status)) {
        if(init.redirect==='error'){await response.body?.cancel();throw Error('Unexpected redirect for API request');}
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
      sourceResponses.set(response, { url: url.href, route: useWorker ? 'worker' : useProxy ? 'proxy' : 'direct' });
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

export async function safeText(raw: string, maxBytes = 8_000_000, init: ApiRequestInit = {}): Promise<{ text: string; url: string; route: string }> {
  try {
    const viaMirror = await mirrorRoute(raw, init);
    return viaMirror || await safeTextOnce(raw, maxBytes, init);
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const healed = recipeHooks && init.noRecipe !== true ? await recipeHooks.heal(raw, message).catch(() => null) : null;
    if (!healed) throw error;
    // Healing failed but diagnosed the block: that sentence is more useful than «HTTP 403».
    if (!healed.headers) throw new Error(`${message} — تشخیص حلقهٔ بازخورد اتصال: ${healed.advice || 'هیچ روشی جواب نداد.'}`);
    if (healed.route === 'mirror') {
      const mirror = mirrorById(String(healed.mirror || ''));
      if (mirror) {
        const page = await safeTextOnce(mirror.build(healed.url || raw), maxBytes, { ...init, headers: { ...mirror.headers, ...(healed.headers as any) }, noRecipe: true, directRoute: true });
        return { text: unwrapMirror(mirror.id, page.text), url: raw, route: 'mirror' };
      }
    }
    return safeTextOnce(healed.url || raw, maxBytes, { ...init, headers: { ...(healed.headers as any), ...(init.headers as any) }, indirect: init.indirect || healed.route === 'worker', noRecipe: true });
  }
}
/**
 * A learned public mirror fetches the page from its own address. The body is normalised back
 * towards the original markup and reported under the ORIGINAL url, so relative links in the
 * page keep resolving against the real site. Twin: sourceText() in worker-src/scraper.ts.
 */
async function mirrorRoute(raw: string, init: ApiRequestInit, maxBytes = 8_000_000): Promise<{ text: string; url: string; route: string } | null> {
  if (!recipeHooks || init.noRecipe === true || init.apiMode === true || init.directRoute === true) return null;
  const learned = await recipeHooks.learned(raw).catch(() => null);
  const mirror = learned?.route === 'mirror' ? mirrorById(String(learned.mirror || '')) : undefined;
  if (!mirror) return null;
  const page = await safeTextOnce(mirror.build(learned!.url || raw), maxBytes, {
    ...init, headers: { ...mirror.headers, ...(learned!.headers as any), ...(init.headers as any) }, noRecipe: true, directRoute: true
  });
  return { text: unwrapMirror(mirror.id, page.text), url: raw, route: 'mirror' };
}

async function safeTextOnce(raw: string, maxBytes: number, init: ApiRequestInit): Promise<{ text: string; url: string; route: string }> {
  const response = await safeFetch(raw, init, maxBytes);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${raw} (route: ${sourceResponses.get(response)?.route || 'direct'}, attempts: ${sourceGatewayAttempts(response).join(' → ')}); در مسیر worker، این وضعیت می‌تواند از پراکسی یا سایت مبدأ باشد. قرارداد مسیر /https://site یا الگوی ?url={url} و مجوز دامنه در پراکسی را بررسی کنید.`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
  const text = new TextDecoder().decode(buffer);
  ensureTextResponse(text, response.headers.get('content-type') || '', raw);
  return { text, url: sourceResponses.get(response)?.url || raw, route: sourceResponses.get(response)?.route || 'direct' };
}

/**
 * Raw probe for the connection feedback loop (worker-src/connection-loop.ts).
 *
 * Twin of probeSource() in worker-src/network.ts: it NEVER throws on a refusal, because the
 * loop has to read the refusal (status, challenge markup, empty body) to choose the next
 * request shape. `route` picks the transport explicitly instead of following the saved mode.
 */
export type SourceProbe = { status: number; text: string; url: string; contentType: string; cookie: string };
function cookieJar(response: Response): string {
  const raw = (response.headers as any).getSetCookie?.().join(', ') || response.headers.get('set-cookie') || '';
  return String(raw).split(/,(?=[^;=]+=)/).map(part => part.split(';')[0]!.trim()).filter(Boolean).join('; ');
}
export async function probeSource(raw: string, init: ApiRequestInit = {}, maxBytes = 4_000_000): Promise<SourceProbe> {
  const response = await safeFetch(raw, init, maxBytes);
  const contentType = response.headers.get('content-type') || '';
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes`);
  return {
    status: response.status, text: new TextDecoder().decode(buffer), contentType, cookie: cookieJar(response),
    url: sourceResponses.get(response)?.url || raw
  };
}
