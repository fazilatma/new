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
export function viaWorkerUrl(workerUrl: string, target: string): string {
  return workerUrl.includes('{url}')
    ? workerUrl.replace('{url}', encodeURIComponent(target))
    : workerUrl + (workerUrl.includes('?') ? '&' : '?') + 'url=' + encodeURIComponent(target);
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

export async function safeFetch(raw: string, init: RequestInit = {}, maxBytes = 8_000_000): Promise<Response> {
  let url = await assertPublicUrl(raw);
  for (let redirects = 0; redirects < 5; redirects++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      // Honour the configured indirect route. `worker` rewrites the URL (the
      // gateway fetches the target for us); `proxy` keeps the URL and sends the
      // request through an HTTP(S) proxy via undici.
      const useWorker = sourceNetwork.mode === 'worker' && sourceNetwork.workerUrl;
      const useProxy = sourceNetwork.mode === 'proxy' && sourceNetwork.proxyUrl;
      const requestUrl = useWorker ? viaWorkerUrl(sourceNetwork.workerUrl, url.href) : url.href;
      const doFetch: typeof fetch = useProxy
        ? ((input: any, options: any) => undiciFetch(input, { ...options, dispatcher: new ProxyAgent(sourceNetwork.proxyUrl) }) as any)
        : fetch;
      const response = await doFetch(requestUrl, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
        // Match the Cloudflare Worker's request shape: several shops return a
        // stripped page or a challenge when these browser headers are missing.
        headers: {
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
        url = await assertPublicUrl(new URL(location, url).href);
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
