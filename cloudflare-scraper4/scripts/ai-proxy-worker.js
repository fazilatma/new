/**
 * Scraper4 — AI reverse-proxy Worker (paste-and-deploy)
 * =====================================================
 *
 * Deploy this as its own Cloudflare Worker (for example
 * `proxy.<your-subdomain>.workers.dev`) and put that address in
 *   تنظیمات ← هوش مصنوعی ← روش اتصال ← «آدرس Worker»
 * with the mode set to «Cloudflare Worker / پروکسی معکوس».
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Scraper4 asks the proxy for a target in one of two ways:
 *   1. `https://your-proxy.workers.dev/?url=<url-encoded target>`
 *   2. the `x-scraper-target` request header (also `x-target-url`)
 * A Worker that does not implement that contract answers 404 for every request,
 * which looks exactly like "all models return 404" in the AI settings.
 *
 * It forwards the method, body and Authorization header unchanged, so an
 * OpenAI/Anthropic/OpenRouter endpoint behaves identically to a direct call
 * while the actual connection is made from Cloudflare's network.
 */

// Only allow proxying to real AI endpoints so this Worker cannot be abused as
// an open relay. Add your own provider hosts here.
const ALLOWED_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
  'api.groq.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.together.xyz',
  'api.cohere.ai',
  'api.x.ai',
  'gateway.ai.cloudflare.com',
  // Basalam — needed when «اتصال غیرمستقیم» is enabled for Basalam.
  'openapi.basalam.com',
  'auth.basalam.com',
  'core.basalam.com',
];

// Add your own WooCommerce shop host here if you route Woo through this proxy,
// e.g. 'shop.example.com'. Alternatively set ENFORCE_ALLOWLIST to false.

// Set to false to allow ANY https host (simpler, but an open relay).
const ENFORCE_ALLOWLIST = true;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
};

function bad(status, message) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const incoming = new URL(request.url);

    // Health check so you can confirm the deployment in a browser.
    if (incoming.pathname === '/health' || incoming.pathname === '/__health') {
      return new Response(JSON.stringify({ ok: true, proxy: 'scraper4-ai-proxy', version: 1 }), {
        headers: { 'content-type': 'application/json; charset=utf-8', ...CORS },
      });
    }

    // Accept every shape Scraper4 might use.
    let target =
      incoming.searchParams.get('url') ||
      request.headers.get('x-scraper-target') ||
      request.headers.get('x-target-url') ||
      '';

    // Also support the path form: https://proxy/https://api.openai.com/v1/...
    if (!target && incoming.pathname.length > 1) {
      const raw = incoming.pathname.slice(1);
      if (/^https?:\/\//i.test(raw)) target = raw + incoming.search;
      else if (/^https?:\/[^/]/i.test(raw)) target = raw.replace(/^(https?:\/)/i, '$1/') + incoming.search;
    }

    if (!target) {
      return bad(400, 'No target. Call /?url=<encoded-url> or send the x-scraper-target header.');
    }

    let url;
    try {
      url = new URL(target);
    } catch {
      return bad(400, `Invalid target URL: ${target}`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return bad(400, 'Only http(s) targets are allowed.');
    }
    if (ENFORCE_ALLOWLIST && !ALLOWED_HOSTS.includes(url.hostname)) {
      return bad(403, `Host not allowed: ${url.hostname}. Add it to ALLOWED_HOSTS in the proxy Worker.`);
    }

    // Rebuild the outbound request, dropping hop-by-hop and proxy-control headers.
    const headers = new Headers(request.headers);
    for (const name of ['host', 'cf-connecting-ip', 'cf-ray', 'cf-visitor', 'x-forwarded-for',
      'x-forwarded-proto', 'x-real-ip', 'x-scraper-target', 'x-target-url', 'content-length']) {
      headers.delete(name);
    }

    const init = {
      method: request.method,
      headers,
      redirect: 'follow',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

    try {
      const response = await fetch(url.toString(), init);
      const out = new Headers(response.headers);
      for (const [key, value] of Object.entries(CORS)) out.set(key, value);
      out.set('x-scraper-proxy', 'ai-proxy-worker');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: out });
    } catch (error) {
      return bad(502, `Upstream fetch failed: ${error && error.message ? error.message : String(error)}`);
    }
  },
};
