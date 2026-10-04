/** Shared source-panel precedence; AI connection settings remain a legacy fallback only. */
export type SourceNetwork = { mode: string; proxyUrl: string; workerUrl: string };
export function resolveSourceNetwork(source: any, legacy: Partial<SourceNetwork> = {}, target = ''): SourceNetwork {
  const explicit = source && typeof source === 'object' && typeof source.mode === 'string';
  const result = explicit
    ? { mode: String(source.mode), proxyUrl: String(source.proxy || '').trim(), workerUrl: String(source.worker || '').trim() }
    : { mode: String(legacy.mode || 'direct'), proxyUrl: String(legacy.proxyUrl || '').trim(), workerUrl: String(legacy.workerUrl || '').trim() };
  const hosts = explicit ? String(source.hosts || '').split(/[\s,،]+/).filter(Boolean).map((h: string) => h.toLowerCase()) : [];
  if (hosts.length && target) {
    const host = new URL(target).hostname.toLowerCase();
    if (!hosts.some((h: string) => host === h || host.endsWith('.' + h))) return { mode: 'direct', proxyUrl: '', workerUrl: '' };
  }
  // A workers.dev reverse gateway is not a CONNECT proxy.
  if (result.mode === 'proxy' && result.proxyUrl) {
    try {
      const url = new URL(/^https?:\/\//i.test(result.proxyUrl) ? result.proxyUrl : 'https://' + result.proxyUrl);
      if (url.hostname.endsWith('.workers.dev')) { result.mode = 'worker'; result.workerUrl = result.proxyUrl; result.proxyUrl = ''; }
    } catch { /* transport reports malformed addresses */ }
  }
  return result;
}

/** Source gateway contract used by the Worker twin (AI gateways keep their own query contract). */
export function sourceWorkerUrl(raw: string, target: string): string {
  const value = String(raw || '').trim().replace(/%7Burl%7D/ig, '{url}');
  if (!value || value.startsWith('/')) throw new Error('برای اتصال غیرمستقیم، Worker URL معتبر را وارد کنید.');
  let base = /^https?:\/\//i.test(value) ? value : 'https://' + value;
  if (new URL(base.replace('{url}', 'target')).hostname.endsWith('.workers.dev')) base = base.replace(/^http:/i, 'https:');
  if (base.includes('{url}')) return base.replace('{url}', encodeURIComponent(target));
  const parsed = new URL(base);
  if (parsed.searchParams.has('url')) { parsed.searchParams.set('url', target); return parsed.href; }
  return base.replace(/\/$/, '') + '/' + target;
}

/** Query gateways can define upstream headers independently from transport headers.
 * One compatibility retry, GET/HEAD only, same gateway and target, never direct.
 * Do not retry path gateways whose target exists only in proprietary headers.
 */
const gatewayAttempts = new WeakMap<Response, number[]>();
export function sourceGatewayAttempts(response: Response): number[] { return gatewayAttempts.get(response) || [response.status]; }
export async function fetchSourceGateway(
  target: string, gateway: string, init: RequestInit,
  send: (init: RequestInit) => Promise<Response>
): Promise<Response> {
  let response = await send(init);
  const statuses = [response.status];
  const query = new URL(gateway).searchParams.get('url');
  if (response.status === 403 && /^(GET|HEAD)$/i.test(init.method || 'GET') && query === target) {
    await response.body?.cancel();
    const headers = new Headers(init.headers);
    const ua = headers.get('user-agent') || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    // Keep gateway authentication and explicitly supplied control headers intact.
    if (!headers.has('x-proxy-ua')) headers.set('x-proxy-ua', ua);
    if (!headers.has('x-proxy-referer')) headers.set('x-proxy-referer', headers.get('referer') || new URL(target).origin + '/');
    for (const name of ['user-agent', 'referer', 'accept-language', 'cache-control', 'x-target-url', 'x-scraper-target', 'x-scraper-target-url']) headers.delete(name);
    headers.set('accept', 'text/html,application/xhtml+xml');
    response = await send({ ...init, headers });
    statuses.push(response.status);
  }
  gatewayAttempts.set(response, statuses);
  return response;
}
