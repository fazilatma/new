/**
 * =============================================================================
 * Proxy + Full-Screen Browser — Cloudflare Workers Edition
 * Two-tab UI: (1) Proxy Server control/test panel, (2) Full-screen iframe browser.
 *
 * Usage:
 *   /                                  -> Tabbed UI (Proxy panel + Browser)
 *   /browse?url=https://example.com    -> Proxied view of a URL (used by iframe)
 *   /proxy?url=https://example.com     -> Raw proxy passthrough (minimal rewrite)
 *   /go?url=...                        -> Alias for /browse (address-bar submit)
 *   /api/status                        -> JSON status
 *
 * Deploy:
 *   npx wrangler deploy
 * =============================================================================
 */

const DEFAULT_TARGET = 'https://example.com';

// Attribute rewriter – rewrites any HTML attribute that could contain a URL
class AttrRewriter {
  constructor(proxyUrl, baseOrigin, attrNames) {
    this.proxyUrl = proxyUrl;       // e.g. https://worker.workers.dev/browse?url=
    this.baseOrigin = baseOrigin;   // e.g. https://target.com
    this.attrNames = attrNames;
  }
  element(el) {
    for (const name of this.attrNames) {
      const v = el.getAttribute(name);
      if (!v) continue;
      el.setAttribute(name, rewriteUrl(v, this.baseOrigin, this.proxyUrl));
    }
    // Also catch inline event handlers (best-effort: rewrite absolute URLs inside)
    for (const name of ['onclick', 'onload', 'onerror', 'onmouseover', 'onsubmit']) {
      const v = el.getAttribute(name);
      if (v && /https?:\/\//.test(v)) {
        el.setAttribute(name, v.replace(/(https?:\/\/[^\s'"`]+)/g, (m) =>
          this.proxyUrl + encodeURIComponent(resolveUrl(m, this.baseOrigin))
        ));
      }
    }
  }
}

// CSS rewriter – rewrites url(...) inside inline <style> tags and style attrs
class CssUrlRewriter {
  constructor(proxyUrl, baseOrigin) {
    this.proxyUrl = proxyUrl;
    this.baseOrigin = baseOrigin;
    this.chunks = [];
  }
  text(chunk) {
    let s = chunk.text;
    s = s.replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (m, q, u) => {
      if (/^(data:|blob:|javascript:|#)/i.test(u)) return m;
      const resolved = resolveUrl(u.trim(), this.baseOrigin);
      return `url(${q}${this.proxyUrl}${encodeURIComponent(resolved)}${q})`;
    });
    // Also handle @import "..."
    s = s.replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => {
      if (/^(https?:)?\/\//.test(u) || u.startsWith('/')) {
        return `@import ${q}${this.proxyUrl}${encodeURIComponent(resolveUrl(u, this.baseOrigin))}${q}`;
      }
      return m;
    });
    this.chunks.push(s);
    if (chunk.lastInTextNode) {
      chunk.replace(this.chunks.join(''), { html: false });
      this.chunks = [];
    } else {
      chunk.replace('', { html: false });
    }
  }
}

// -- Helpers ----------------------------------------------------------------
function resolveUrl(u, baseOrigin) {
  try {
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/')) return baseOrigin + u;
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    if (u.startsWith('?') || u.startsWith('#')) return baseOrigin + u;
    // relative
    return new URL(u, baseOrigin + '/').href;
  } catch { return u; }
}

function rewriteUrl(u, baseOrigin, proxyUrl) {
  if (!u) return u;
  u = u.trim();
  if (!u) return u;
  if (/^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(u)) return u;
  const abs = resolveUrl(u, baseOrigin);
  if (!abs.startsWith('http://') && !abs.startsWith('https://')) return u;
  return proxyUrl + encodeURIComponent(abs);
}

function setCors(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', '*');
  headers.set('Access-Control-Expose-Headers', '*');
}

function stripHopByHop(headers) {
  const hop = ['content-encoding', 'content-length', 'transfer-encoding',
               'connection', 'keep-alive', 'proxy-authenticate',
               'proxy-authorization', 'te', 'trailers', 'upgrade'];
  for (const h of hop) headers.delete(h);
  // Also remove security headers that would break framing / operation
  const blocking = ['content-security-policy', 'content-security-policy-report-only',
                    'x-frame-options', 'strict-transport-security',
                    'permissions-policy', 'cross-origin-opener-policy',
                    'cross-origin-embedder-policy', 'cross-origin-resource-policy'];
  for (const h of blocking) headers.delete(h);
}

// -- Main Worker ------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);
    const workerOrigin = reqUrl.origin;

    // Optional password gate
    const password = env.ACCESS_PASSWORD || '';
    if (password && !checkAuth(request, password)) {
      if (reqUrl.pathname.startsWith('/api/')) {
        return json({ ok: false, error: 'Unauthorized' }, 401);
      }
      return loginPage(password);
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      const h = new Headers();
      setCors(h);
      return new Response(null, { status: 204, headers: h });
    }

    // Routes
    const path = reqUrl.pathname;

    if (path === '/api/status') {
      return json({
        ok: true,
        worker: 'proxy-browser',
        version: '1.0.0',
        colo: request.cf?.colo || 'unknown',
        country: request.cf?.country || 'unknown',
        ip: request.headers.get('cf-connecting-ip') || ''
      });
    }

    // Raw proxy passthrough (no HTML rewriting, just fetch + CORS)
    if (path === '/proxy') {
      const target = reqUrl.searchParams.get('url') || reqUrl.searchParams.get('target');
      if (!target) return json({ ok: false, error: 'Missing ?url= parameter' }, 400);
      return rawProxy(request, target, env);
    }

    // Full proxied browse path (rewrites HTML/CSS links)
    if (path === '/browse' || path === '/go') {
      let target = reqUrl.searchParams.get('url');
      if (!target) return Response.redirect(workerOrigin + '/', 302);
      return browseProxy(request, target, env, workerOrigin);
    }

    // Root / everything else: serve the UI
    return serveUI(request, env, workerOrigin);
  }
};

// -- Auth -------------------------------------------------------------------
function checkAuth(request, password) {
  const url = new URL(request.url);
  if (url.searchParams.get('p') === password) return true;
  const cookie = request.headers.get('Cookie') || '';
  if (cookie.includes(`pb_auth=${password}`)) return true;
  const auth = request.headers.get('Authorization') || '';
  if (auth.includes(password)) return true;
  return false;
}

function loginPage(password) {
  const html = `<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ورود</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{background:#0b0f19;color:#f3f4f6;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}.card{background:#151d30;border:1px solid #1f293d;border-radius:16px;padding:32px;width:100%;max-width:400px;box-shadow:0 20px 40px rgba(0,0,0,.5);text-align:center}h1{font-size:22px;margin-bottom:8px;color:#38bdf8}p{font-size:14px;color:#94a3b8;margin-bottom:24px;line-height:1.6}input{width:100%;padding:12px 16px;background:#0a0f1d;border:1px solid #334155;border-radius:10px;color:#fff;font-size:15px;margin-bottom:16px;outline:none}input:focus{border-color:#38bdf8}button{width:100%;padding:12px;background:linear-gradient(135deg,#0284c7,#2563eb);border:none;border-radius:10px;color:#fff;font-size:15px;font-weight:700;cursor:pointer}</style></head>
<body><div class="card"><h1>🔐 پروکسی و مرورگر ابری</h1><p>برای دسترسی رمز عبور را وارد کنید:</p>
<form method="get" action="/"><input type="password" name="p" placeholder="رمز عبور" autofocus required><button type="submit">ورود</button></form></div></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// -- Raw Proxy (passthrough + CORS, no rewriting) ---------------------------
async function rawProxy(request, targetUrlStr, env) {
  try {
    const target = new URL(targetUrlStr);
    const headers = new Headers();
    const skip = new Set(['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
                          'x-forwarded-proto', 'x-real-ip', 'origin', 'referer', 'cookie']);
    for (const [k, v] of request.headers.entries()) {
      if (!skip.has(k.toLowerCase())) headers.set(k, v);
    }
    headers.set('Host', target.host);
    headers.set('User-Agent', env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
    headers.set('Origin', target.origin);
    headers.set('Referer', target.origin + '/');

    const init = { method: request.method, headers, redirect: 'follow' };
    if (request.body && !['GET','HEAD'].includes(request.method)) {
      init.body = request.body;
      init.duplex = 'half';
    }

    const upstream = await fetch(target.toString(), init);
    const outH = new Headers(upstream.headers);
    stripHopByHop(outH);
    setCors(outH);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outH
    });
  } catch (e) {
    return json({ ok: false, error: 'Proxy error', detail: e.message, target: targetUrlStr }, 502);
  }
}

// -- Browse Proxy (full URL rewriting for iframe browser) -------------------
async function browseProxy(request, targetUrlStr, env, workerOrigin) {
  let target;
  try { target = new URL(targetUrlStr); }
  catch { return new Response('Invalid URL', { status: 400 }); }

  const browseBase = workerOrigin + '/browse?url=';
  const baseOrigin = target.origin;

  const headers = new Headers();
  const skip = new Set(['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor',
                        'x-forwarded-proto', 'x-real-ip', 'origin', 'referer',
                        'accept-encoding', 'cookie']);
  for (const [k, v] of request.headers.entries()) {
    if (!skip.has(k.toLowerCase())) headers.set(k, v);
  }
  headers.set('Host', target.host);
  headers.set('User-Agent', env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36');
  headers.set('Accept', request.headers.get('Accept') || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  headers.set('Accept-Language', request.headers.get('Accept-Language') || 'en-US,en;q=0.9');

  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.body && !['GET','HEAD'].includes(request.method)) {
    init.body = request.body;
    init.duplex = 'half';
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), init);
  } catch (e) {
    return new Response(`<h2>Proxy Error</h2><p>${escapeHtml(e.message)}</p>`, {
      status: 502,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  // Follow redirects through the proxy
  if ([301,302,303,307,308].includes(upstream.status)) {
    const loc = upstream.headers.get('location');
    if (loc) {
      const redir = resolveUrl(loc, baseOrigin);
      return Response.redirect(browseBase + encodeURIComponent(redir), upstream.status);
    }
  }

  const ct = (upstream.headers.get('content-type') || '').toLowerCase();
  const outH = new Headers(upstream.headers);
  stripHopByHop(outH);
  setCors(outH);

  // If HTML → rewrite with HTMLRewriter
  if (ct.includes('text/html') || ct.includes('application/xhtml')) {
    outH.set('Content-Security-Policy', "frame-ancestors 'self' *;");
    let rewriter = new HTMLRewriter()
      // Add <base> and shim script to <head>
      .on('head', new HeadInserter(workerOrigin, browseBase, target.href))
      // URL attributes
      .on('a[href], area[href], link[href]', new AttrRewriter(browseBase, baseOrigin, ['href']))
      .on('img[src], script[src], iframe[src], embed[src], source[src], audio[src], video[src], input[src], track[src]',
          new AttrRewriter(browseBase, baseOrigin, ['src']))
      .on('img[srcset], source[srcset]', new SrcsetRewriter(browseBase, baseOrigin))
      .on('form[action]', new AttrRewriter(browseBase, baseOrigin, ['action']))
      .on('[data-src]', new AttrRewriter(browseBase, baseOrigin, ['data-src']))
      .on('[data-url]', new AttrRewriter(browseBase, baseOrigin, ['data-url']))
      .on('[poster]', new AttrRewriter(browseBase, baseOrigin, ['poster']))
      .on('[background]', new AttrRewriter(browseBase, baseOrigin, ['background']))
      // Inline CSS
      .on('style', new CssTextRewriter(browseBase, baseOrigin))
      .on('[style]', new StyleAttrRewriter(browseBase, baseOrigin));

    // Also handle meta refresh
    rewriter = rewriter.on('meta[http-equiv="refresh"]', new MetaRefreshRewriter(browseBase, baseOrigin));

    const newRes = rewriter.transform(upstream);
    // Reconstruct Response to carry our modified headers
    return new Response(newRes.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outH
    });
  }

  // If CSS → rewrite url(...) refs
  if (ct.includes('text/css')) {
    const txt = await upstream.text();
    const rewritten = rewriteCssUrls(txt, baseOrigin, browseBase);
    outH.set('Content-Type', 'text/css; charset=utf-8');
    return new Response(rewritten, { status: upstream.status, headers: outH });
  }

  // JS → light rewrite of absolute URLs (best-effort; many sites will still break on JS routing)
  if (ct.includes('javascript') || ct.includes('/js') || ct.endsWith('js')) {
    // Pass through JS unmodified (rewriting JS reliably requires a full parser, out of scope)
    return new Response(upstream.body, { status: upstream.status, headers: outH });
  }

  // Anything else (images, fonts, json, binary…) → pass through
  return new Response(upstream.body, { status: upstream.status, headers: outH });
}

// -- HTML rewriter handlers -------------------------------------------------
class HeadInserter {
  constructor(workerOrigin, browseBase, targetHref) {
    this.workerOrigin = workerOrigin;
    this.browseBase = browseBase;
    this.targetHref = targetHref;
  }
  element(el) {
    const shim = `<meta name="referrer" content="no-referrer">
<base href="${escapeAttr(this.targetHref)}">
<script data-proxy-shim="1">(function(){
  var PB = ${JSON.stringify(this.browseBase)};
  var WO = ${JSON.stringify(this.workerOrigin)};
  function thru(u){ try{ var a=new URL(u,location.href); if(a.origin===WO && a.pathname==='/browse') return a.href; return PB+encodeURIComponent(a.href); }catch(e){return u;} }
  document.addEventListener('submit',function(e){var f=e.target;if(f&&f.tagName==='FORM'){var act=f.getAttribute('action')||location.href;var m=(f.getAttribute('method')||'GET').toUpperCase();if(m==='GET'){e.preventDefault();var fd=new FormData(f);var p=new URLSearchParams(fd);var u=act.split('#')[0];u+=(u.indexOf('?')>=0?'&':'?')+p.toString();location.href=thru(u);}}},true);
  document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a');if(!a)return;var h=a.getAttribute('href');if(!h)return;if(/^(javascript:|mailto:|tel:|#)/i.test(h))return;try{var abs=new URL(h,location.href);if(abs.protocol!=='http:'&&abs.protocol!=='https:')return;e.preventDefault();a.target='_self';location.href=thru(abs.href);}catch(e){}}},true);
  window.open=function(u){if(u)location.href=thru(u);return null;};
  /* Patch fetch/XHR to route absolute URLs through proxy? (Too invasive – skip for now) */
})();</script>`;
    el.prepend(shim, { html: true });
  }
}

class SrcsetRewriter {
  constructor(browseBase, baseOrigin) {
    this.browseBase = browseBase;
    this.baseOrigin = baseOrigin;
  }
  element(el) {
    for (const attr of ['srcset', 'data-srcset']) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      const parts = v.split(',').map(p => {
        p = p.trim();
        const sp = p.indexOf(' ');
        const url = sp > 0 ? p.slice(0, sp) : p;
        const desc = sp > 0 ? p.slice(sp) : '';
        if (/^(data:|blob:|javascript:)/i.test(url)) return p;
        const abs = resolveUrl(url.trim(), this.baseOrigin);
        return this.browseBase + encodeURIComponent(abs) + desc;
      });
      el.setAttribute(attr, parts.join(', '));
    }
  }
}

class CssTextRewriter {
  constructor(browseBase, baseOrigin) {
    this.browseBase = browseBase;
    this.baseOrigin = baseOrigin;
    this.buf = [];
  }
  text(chunk) {
    this.buf.push(chunk.text);
    if (chunk.lastInTextNode) {
      const full = this.buf.join('');
      chunk.replace(rewriteCssUrls(full, this.baseOrigin, this.browseBase), { html: false });
      this.buf = [];
    } else {
      chunk.replace('', { html: false });
    }
  }
}

class StyleAttrRewriter {
  constructor(browseBase, baseOrigin) {
    this.browseBase = browseBase;
    this.baseOrigin = baseOrigin;
  }
  element(el) {
    const v = el.getAttribute('style');
    if (!v) return;
    el.setAttribute('style', rewriteCssUrls(v, this.baseOrigin, this.browseBase));
  }
}

class MetaRefreshRewriter {
  constructor(browseBase, baseOrigin) {
    this.browseBase = browseBase;
    this.baseOrigin = baseOrigin;
  }
  element(el) {
    const c = el.getAttribute('content');
    if (!c) return;
    const m = c.match(/^\s*(\d+)\s*;\s*url\s*=\s*(.+?)\s*$/i);
    if (m) {
      const u = resolveUrl(m[2].trim().replace(/^["']|["']$/g, ''), this.baseOrigin);
      el.setAttribute('content', `${m[1]}; url=${this.browseBase}${encodeURIComponent(u)}`);
    }
  }
}

function rewriteCssUrls(css, baseOrigin, browseBase) {
  return css
    .replace(/url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g, (m, q, u) => {
      if (/^(data:|blob:|javascript:|#)/i.test(u)) return m;
      const abs = resolveUrl(u.trim(), baseOrigin);
      return `url(${q}${browseBase}${encodeURIComponent(abs)}${q})`;
    })
    .replace(/@import\s+(['"])([^'"]+)\1/g, (m, q, u) => {
      if (/^(https?:)?\/\//.test(u) || u.startsWith('/')) {
        return `@import ${q}${browseBase}${encodeURIComponent(resolveUrl(u, baseOrigin))}${q}`;
      }
      return m;
    });
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escapeAttr(s){ return escapeHtml(s); }

function json(obj, status=200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
  });
}

// -- UI ---------------------------------------------------------------------
function serveUI(request, env, workerOrigin) {
  const url = new URL(request.url);
  const initialUrl = url.searchParams.get('url') || DEFAULT_TARGET;
  const html = UI_HTML
    .replace(/__WORKER_ORIGIN__/g, workerOrigin)
    .replace(/__INITIAL_URL__/g, escapeHtml(initialUrl));
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'SAMEORIGIN'
    }
  });
}

const UI_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>پروکسی و مرورگر تمام‌صفحه — Cloudflare Workers</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;overflow:hidden;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Tahoma,sans-serif;background:#0b0f19;color:#e5e7eb}
  header{background:linear-gradient(135deg,#0f172a,#1e293b);border-bottom:1px solid #1f293d;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:17px;color:#38bdf8;display:flex;align-items:center;gap:8px;white-space:nowrap}
  .brand .dot{width:10px;height:10px;background:#10b981;border-radius:50%;box-shadow:0 0 10px #10b981}
  .tabs{display:flex;gap:4px;margin-right:auto}
  .tab{padding:8px 16px;background:transparent;border:1px solid transparent;border-radius:8px;color:#94a3b8;cursor:pointer;font-size:14px;font-weight:600;transition:.2s}
  .tab:hover{color:#e2e8f0;background:#1e293b}
  .tab.active{background:#1e293b;color:#38bdf8;border-color:#334155}
  .addr{display:flex;flex:1;min-width:260px;max-width:900px;gap:6px}
  .addr input{flex:1;padding:8px 12px;background:#0a0f1d;border:1px solid #334155;border-radius:8px;color:#fff;font-size:14px;outline:none;direction:ltr;text-align:left}
  .addr input:focus{border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.2)}
  .addr button{padding:8px 16px;background:linear-gradient(135deg,#0284c7,#2563eb);border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;font-size:14px}
  .addr button:hover{opacity:.9}
  .addr .fs{background:#334155;padding:8px 12px;border-radius:8px;cursor:pointer;border:none;color:#e2e8f0;font-size:14px}
  main{height:calc(100% - 57px);position:relative}
  .panel{display:none;height:100%;overflow:auto}
  .panel.active{display:block}
  /* Browser tab */
  #browser-panel{background:#fff}
  #browser-frame{width:100%;height:100%;border:none;background:#fff}
  .loading-bar{position:absolute;top:0;left:0;height:2px;background:linear-gradient(90deg,#38bdf8,#a855f7);width:0;transition:width .2s;z-index:10}
  /* Proxy tab */
  #proxy-panel{padding:24px;max-width:1100px;margin:0 auto}
  .card{background:#151d30;border:1px solid #1f293d;border-radius:14px;padding:20px;margin-bottom:18px}
  .card h2{font-size:16px;color:#38bdf8;margin-bottom:12px;display:flex;align-items:center;gap:8px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .stat{background:#0a0f1d;border:1px solid #1f293d;border-radius:10px;padding:14px}
  .stat .label{font-size:12px;color:#94a3b8;margin-bottom:4px}
  .stat .val{font-size:18px;font-weight:700;color:#e2e8f0;direction:ltr;text-align:left;word-break:break-all}
  input[type="text"],input[type="url"],textarea{width:100%;padding:10px 12px;background:#0a0f1d;border:1px solid #334155;border-radius:8px;color:#fff;font-size:14px;outline:none;direction:ltr;text-align:left}
  input:focus,textarea:focus{border-color:#38bdf8}
  label{display:block;font-size:13px;color:#94a3b8;margin-bottom:6px;margin-top:10px}
  .btn{padding:10px 16px;background:linear-gradient(135deg,#0284c7,#2563eb);border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;font-size:14px;display:inline-flex;align-items:center;gap:6px}
  .btn:hover{opacity:.9}
  .btn.sec{background:#334155}
  pre{background:#0a0f1d;border:1px solid #1f293d;border-radius:8px;padding:14px;overflow:auto;color:#a5f3fc;font-size:13px;direction:ltr;text-align:left;max-height:300px}
  code{background:#0a0f1d;padding:2px 6px;border-radius:4px;color:#fbbf24;font-size:13px;direction:ltr;display:inline-block}
  .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#065f46;color:#d1fae5;padding:10px 18px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:100;opacity:0;transition:.3s;font-size:14px}
  .toast.show{opacity:1}
  .hint{font-size:12px;color:#64748b;margin-top:6px;line-height:1.6}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 10px;border-bottom:1px solid #1f293d;text-align:left}
  th{color:#94a3b8;font-weight:600}
  td{color:#cbd5e1;direction:ltr}
  .pill{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700}
  .pill.get{background:#064e3b;color:#6ee7b7}.pill.post{background:#1e3a8a;color:#93c5fd}
  .pill.put{background:#713f12;color:#fcd34d}.pill.del{background:#7f1d1d;color:#fca5a5}
  .pill.head{background:#312e81;color:#c4b5fd}.pill.opt{background:#334155;color:#cbd5e1}
  @media (max-width:600px){
    .tabs{order:3;width:100%}
    .addr{order:2;min-width:100%}
    .brand{order:1}
    header{padding:8px 10px}
    main{height:calc(100% - 110px)}
  }
</style>
</head>
<body>
<header>
  <div class="brand"><span class="dot"></span>☁️ Cloud Proxy Browser</div>
  <div class="tabs">
    <button class="tab active" data-tab="browser">🌐 مرورگر</button>
    <button class="tab" data-tab="proxy">⚙️ سرور پروکسی</button>
  </div>
  <div class="addr">
    <input id="urlBar" type="text" placeholder="https://example.com" value="__INITIAL_URL__" spellcheck="false">
    <button id="goBtn">برو</button>
    <button class="fs" id="fsBtn" title="تمام‌صفحه">⛶</button>
  </div>
</header>
<div class="loading-bar" id="loadingBar"></div>
<main>
  <!-- Browser Panel -->
  <section id="browser-panel" class="panel active">
    <iframe id="browser-frame" referrerpolicy="no-referrer" sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" src="about:blank"></iframe>
  </section>
  <!-- Proxy Panel -->
  <section id="proxy-panel" class="panel">
    <div class="card">
      <h2>📡 وضعیت سرور پروکسی</h2>
      <div class="grid" id="statusGrid">
        <div class="stat"><div class="label">وضعیت</div><div class="val" id="stStatus">در حال بررسی…</div></div>
        <div class="stat"><div class="label">مکان Edge</div><div class="val" id="stColo">-</div></div>
        <div class="stat"><div class="label">کشور</div><div class="val" id="stCountry">-</div></div>
        <div class="stat"><div class="label">IP کاربر</div><div class="val" id="stIp">-</div></div>
      </div>
    </div>

    <div class="card">
      <h2>🔗 فرمت استفاده از پروکسی</h2>
      <p class="hint">از این اندپوینت برای درخواست‌های API، دانلود فایل یا استفاده در اپلیکیشن‌ها استفاده کنید.</p>
      <label>الگوی URL:</label>
      <pre>__WORKER_ORIGIN__/proxy?url=https://example.com/api</pre>
      <label>الگوی مرور (با بازنویسی لینک‌ها):</label>
      <pre>__WORKER_ORIGIN__/browse?url=https://example.com</pre>
      <div class="row" style="margin-top:12px">
        <button class="btn sec" onclick="copyText('__WORKER_ORIGIN__/proxy?url=')">📋 کپی Base Proxy</button>
        <button class="btn sec" onclick="copyText('__WORKER_ORIGIN__/browse?url=')">📋 کپی Base Browse</button>
      </div>
    </div>

    <div class="card">
      <h2>🧪 تست درخواست</h2>
      <label>URL هدف:</label>
      <input id="testUrl" type="url" placeholder="https://httpbin.org/get" value="https://httpbin.org/get">
      <label>Method:</label>
      <div class="row" style="gap:6px;margin-bottom:10px">
        <select id="testMethod" style="padding:8px 12px;background:#0a0f1d;border:1px solid #334155;border-radius:8px;color:#fff">
          <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option><option>PATCH</option><option>HEAD</option>
        </select>
        <label style="margin:0 0 0 8px">Headers (JSON):</label>
      </div>
      <textarea id="testHeaders" rows="2" placeholder='{"Accept":"application/json"}'></textarea>
      <label>Body (JSON/text):</label>
      <textarea id="testBody" rows="3" placeholder='{"key":"value"}'></textarea>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="sendTest">▶️ ارسال درخواست</button>
      </div>
      <label>پاسخ:</label>
      <pre id="testResponse" style="max-height:400px">—</pre>
    </div>

    <div class="card">
      <h2>📊 تاریخچه درخواست‌ها (این session)</h2>
      <table id="historyTable">
        <thead><tr><th>#</th><th>Method</th><th>URL</th><th>Status</th><th>Time</th></tr></thead>
        <tbody id="historyBody"></tbody>
      </table>
    </div>

    <div class="card">
      <h2>❓ راهنما</h2>
      <p class="hint">
        • تب <b>مرورگر</b>: صفحات وب را از طریق iframe پروکسی‌شده نمایش می‌دهد. لینک‌ها و فرم‌ها (GET) از طریق پروکسی هدایت می‌شوند.<br>
        • تب <b>سرور پروکسی</b>: اندپوینت <code>/proxy?url=...</code> پاسخ را با هدر CORS برمی‌گرداند و برای API/Bot مناسب است.<br>
        • اندپوینت <code>/browse?url=...</code> HTML را بازنویسی می‌کند تا در iframe درست نمایش داده شود.<br>
        • سایت‌هایی که JavaScript هوی دارند (مثل جیمیل، توییتر) ممکن است به‌خاطر پیچیدگی routing درون‌صفحه درست کار نکنند — این محدودیت عمومی پروکسی‌های مبتنی بر HTMLRewriter در Workers است.<br>
        • برای محافظت، در <code>wrangler.toml</code> مقدار <code>ACCESS_PASSWORD</code> را تنظیم کنید.
      </p>
    </div>
  </section>
</main>
<div class="toast" id="toast"></div>

<script>
const WORKER = '__WORKER_ORIGIN__';
const frame = document.getElementById('browser-frame');
const urlBar = document.getElementById('urlBar');
const goBtn = document.getElementById('goBtn');
const fsBtn = document.getElementById('fsBtn');
const loadingBar = document.getElementById('loadingBar');
let history = [];

// Tabs
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click',()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById(t.dataset.tab+'-panel').classList.add('active');
  });
});

// Browser navigation
function navigate(url){
  if(!/^https?:\/\//i.test(url)) url='https://'+url;
  urlBar.value = url;
  loadingBar.style.width='15%';
  const proxied = WORKER+'/browse?url='+encodeURIComponent(url);
  frame.src = proxied;
  addHistory('GET', url, '…');
}
goBtn.addEventListener('click',()=>navigate(urlBar.value.trim()));
urlBar.addEventListener('keydown',e=>{if(e.key==='Enter')navigate(urlBar.value.trim())});
frame.addEventListener('load',()=>{
  loadingBar.style.width='100%';
  setTimeout(()=>loadingBar.style.width='0%',300);
});
fsBtn.addEventListener('click',()=>{
  const el = document.documentElement;
  if(!document.fullscreenElement){ el.requestFullscreen&&el.requestFullscreen(); }
  else { document.exitFullscreen&&document.exitFullscreen(); }
});

// Test request
document.getElementById('sendTest').addEventListener('click',async()=>{
  const u = document.getElementById('testUrl').value.trim();
  const m = document.getElementById('testMethod').value;
  let hdrText = document.getElementById('testHeaders').value.trim();
  const body = document.getElementById('testBody').value.trim();
  let headers = {};
  if(hdrText){ try{headers=JSON.parse(hdrText);}catch(e){toast('Headers JSON نامعتبر است');return;} }
  const t0 = performance.now();
  const out = document.getElementById('testResponse');
  out.textContent = 'در حال ارسال…';
  try{
    const proxyUrl = WORKER+'/proxy?url='+encodeURIComponent(u);
    const opts = {method:m,headers:Object.assign({'User-Agent':'Mozilla/5.0 CloudProxyBrowser/1.0'},headers)};
    if(body && !['GET','HEAD'].includes(m)) opts.body = body;
    const res = await fetch(proxyUrl, opts);
    const dt = Math.round(performance.now()-t0);
    const text = await res.text();
    let shown = text;
    if(text.length>8000) shown = text.slice(0,8000)+'\n… (truncated '+text.length+' bytes)';
    out.textContent = 'HTTP '+res.status+' '+res.statusText+'  ('+dt+'ms)\n\n'+shown;
    addHistory(m, u, res.status, dt);
  }catch(e){
    out.textContent = 'ERROR: '+e.message;
  }
});

// History
function addHistory(method,url,status,ms){
  history.unshift({method,url,status,ms,t:new Date().toLocaleTimeString()});
  if(history.length>50) history.pop();
  renderHistory();
}
function renderHistory(){
  const tb = document.getElementById('historyBody');
  tb.innerHTML = history.map((h,i)=>{
    const mc = h.method.toLowerCase();
    return '<tr><td>'+(i+1)+'</td><td><span class="pill '+mc+'">'+h.method+'</span></td><td>'+escapeHtml(h.url)+'</td><td>'+h.status+'</td><td>'+h.t+(h.ms?' ('+h.ms+'ms)':'')+'</td></tr>';
  }).join('');
}

function escapeHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function copyText(t){navigator.clipboard.writeText(t).then(()=>toast('کپی شد ✅'));}
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),1800);}

// Status
async function loadStatus(){
  try{
    const r = await fetch(WORKER+'/api/status');
    const j = await r.json();
    document.getElementById('stStatus').innerHTML = '<span style=color:#10b981>● آنلاین</span>';
    document.getElementById('stColo').textContent = j.colo;
    document.getElementById('stCountry').textContent = j.country;
    document.getElementById('stIp').textContent = j.ip;
  }catch(e){
    document.getElementById('stStatus').innerHTML='<span style=color:#ef4444>● آفلاین</span>';
  }
}
loadStatus();

// Initial load
navigate(urlBar.value.trim()||'https://example.com');

// Keyboard shortcut: Ctrl+L focuses URL bar
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key==='l'){e.preventDefault();urlBar.focus();urlBar.select();}
});
</script>
</body>
</html>`;
