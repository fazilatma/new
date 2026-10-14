#!/usr/bin/env node
/* ===========================================================================
 * s4-csproxy.js  v2.0  --  mobile injection proxy for code-server (Termux)
 * ---------------------------------------------------------------------------
 * Sits in front of code-server on loopback and makes the VS Code web UI usable
 * on a phone.  Three jobs:
 *
 *   1. FORCED ZOOM.  window.zoomLevel is only read by VS Code's Electron
 *      window (src/vs/workbench/electron-browser/window.ts), so no setting can
 *      force zoom in a browser.  We inject CSS that zooms .monaco-workbench and
 *      compensates its box (see deploy/s4-csmobile.css for the reasoning).
 *      The workbench template also ships
 *        <meta name="viewport" ... user-scalable=no>   ("Disable pinch zooming")
 *      so every pre-existing viewport meta is stripped and replaced with an
 *      unlocked one: pinch-zoom becomes the fallback layer.
 *
 *   2. CSP-AWARE SCRIPT INJECTION.  code-server/VS Code answer with
 *        Content-Security-Policy: ... script-src 'self' ... 'nonce-XYZ' ...;
 *                                     style-src 'self' 'unsafe-inline';
 *      An inline <script> WITHOUT that nonce is silently dropped by the
 *      browser - that is why v1's zoom controls never appeared.  v2 reuses the
 *      page's own nonce when it can find one (CSP header or <script nonce=>),
 *      otherwise it generates a nonce and amends the CSP header/meta.
 *      The injected <style> deliberately carries NO nonce: style-src allows
 *      'unsafe-inline' but has no nonce, and adding one would disable
 *      'unsafe-inline' for the whole directive and break the stylesheet.
 *
 *   3. A MOBILE SHELL (deploy/s4-csmobile.{css,js}): Replit-like bottom tab
 *      dock, top bar with zoom controls, extra-keys row for the symbols a phone
 *      keyboard hides.
 *
 * WebSockets are tunnelled as raw TCP, so the integrated terminal, the extension
 * host and file watching are untouched.  Nothing inside the code-server install
 * is ever modified, so an upgrade cannot break this.
 *
 * Evidence endpoints (for the s4-agent rounds):
 *   GET  /__s4mobile            JSON status, counters, last browser report
 *   GET  /__s4mobile?probe=1    + live upstream probe
 *   GET  /__s4mobile/html       the exact snippet injected into pages
 *   GET  /__s4mobile/shell.css  | /__s4mobile/shell.js   current shell source
 *   POST /__s4mobile/report     the in-page shell posts its own state here
 *
 * Usage:  node s4-csproxy.js            (env vars below)
 * =========================================================================== */
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const VERSION = '2.0';
const MARKER = 's4-cs-mobile-v2';

const LISTEN_HOST = process.env.S4_CS_HOST || '127.0.0.1';
const LISTEN_PORT = parseInt(process.env.S4_CS_PORT || '8081', 10);
const CS_HOST = process.env.S4_CS_UPSTREAM_HOST || '127.0.0.1';
const CS_PORT = parseInt(process.env.S4_CS_UPSTREAM || '18081', 10);
const STATE_DIR = process.env.S4_CS_STATE || path.join(os.homedir(), '.s4-remote');
const ZOOM = clampNum(parseFloat(process.env.S4_CS_ZOOM || '1.3'), 0.6, 3);
const NO_SHELL = /^(1|true|yes)$/i.test(process.env.S4_CS_NO_SHELL || '');
const MAX_HTML = 12 * 1024 * 1024;
const REPORT_FILE = path.join(STATE_DIR, 'mobile-report.json');

function clampNum(n, a, b) {
  if (!isFinite(n)) { return a; }
  return n < a ? a : (n > b ? b : n);
}

/* ------------------------------------------------------------------ shell */
/* Candidate locations, first existing wins: env override, user override in the
   state dir (edit without restarting: mtime is re-checked per response), then
   the file shipped next to this proxy. */
const SHELL_CANDIDATES = {
  css: [process.env.S4_CS_CSS, path.join(STATE_DIR, 'mobile.css'), path.join(__dirname, 's4-csmobile.css')].filter(Boolean),
  js: [process.env.S4_CS_JS, path.join(STATE_DIR, 'mobile.js'), path.join(__dirname, 's4-csmobile.js')].filter(Boolean)
};

/* Minimal fallbacks so the proxy still forces zoom when it is copied to a
   device on its own.  Kept free of backticks/${} on purpose. */
const FALLBACK_CSS = [
  ':root{--s4-zoom:__ZOOM__;--s4-inv:__INV__;--s4-dock-h:0px}',
  'html,body{height:100%}',
  'body{margin:0;overflow:hidden;box-sizing:border-box}',
  '.monaco-workbench{zoom:var(--s4-zoom)!important;',
  'width:calc(100% * var(--s4-inv))!important;height:calc(100% * var(--s4-inv))!important}',
  'body:not(:has(.monaco-workbench)){zoom:var(--s4-zoom)}',
  '.monaco-scrollable-element>.scrollbar>.slider{min-width:14px!important;min-height:14px!important}',
  '.monaco-editor textarea.inputarea,.xterm-helper-textarea{font-size:16px!important}',
  '@media (max-width:900px){.breadcrumbs-control{display:none!important}}',
  '#s4fb{position:fixed;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));z-index:2147483000;',
  'display:flex;gap:6px;background:rgba(20,22,27,.94);border:1px solid rgba(255,255,255,.18);',
  'border-radius:999px;padding:6px}',
  '#s4fb button{min-width:40px;height:36px;border:0;border-radius:8px;background:transparent;',
  'color:#eceff4;font:600 14px system-ui,sans-serif}'
].join('\n');

const FALLBACK_JS = [
  '(function(){if(window.__s4mob)return;var V="__FBV__",z=__ZOOM__,min=0.6,max=3;',
  'function set(n){z=Math.max(min,Math.min(max,Math.round(n*100)/100);',
  'var r=document.documentElement;r.style.setProperty("--s4-zoom",String(z));',
  'r.style.setProperty("--s4-inv",String(Math.round((1/z)*1e6)/1e6));',
  'var w=document.querySelector(".monaco-workbench");if(w){w.style.zoom=String(z);}',
  'else if(document.body){document.body.style.zoom=String(z);}',
  'var p=document.getElementById("s4fb-pct");if(p){p.textContent=Math.round(z*100)+"%";}',
  'try{localStorage.setItem("s4-cs-zoom",String(z))}catch(e){}',
  'try{window.dispatchEvent(new Event("resize"))}catch(e){}}',
  'function boot(){try{var s=parseFloat(localStorage.getItem("s4-cs-zoom")||"");if(s>0){z=s}}catch(e){}',
  'set(z);var bar=document.createElement("div");bar.id="s4fb";',
  '[["A-",function(){set(z-0.1)}],["pct",null],["A+",function(){set(z+0.1)}],',
  '["100%",function(){set(1)}]].forEach(function(it){',
  'var b=document.createElement("button");b.type="button";',
  'b.textContent=it[0]==="pct"?Math.round(z*100)+"%":it[0];',
  'if(it[0]==="pct"){b.id="s4fb-pct"}',
  'if(it[1]){b.addEventListener("click",it[1])}bar.appendChild(b)});',
  'document.body.appendChild(bar);',
  'log("fallback shell ready zoom="+z);',
  'post({v:V,mode:"fallback",zoom:z,ready:true,ua:navigator.userAgent.slice(0,160)})}',
  'function log(m){try{console.debug("[s4mob-fb] "+m)}catch(e){}}',
  'function post(o){try{fetch("__BASE__/report",{method:"POST",headers:{"content-type":"application/json"},',
  'body:JSON.stringify(o),keepalive:true}).catch(function(){})}catch(e){}}',
  'window.__s4mob={version:V,mode:"fallback",zoom:function(n){set(n)},snapshot:function(){return{v:V,zoom:z}}};',
  'if(document.body){boot()}else{document.addEventListener("DOMContentLoaded",boot);',
  'setTimeout(function(){if(!document.getElementById("s4fb")&&document.body){boot()}},1500)}})();'
].join('\n');

const shellCache = {};
function loadShell(kind) {
  const cands = SHELL_CANDIDATES[kind] || [];
  for (let i = 0; i < cands.length; i++) {
    const file = cands[i];
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size < 8) { continue; }
      const cached = shellCache[file];
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        return { text: cached.text, source: file, bytes: st.size };
      }
      const text = fs.readFileSync(file, 'utf8');
      shellCache[file] = { text: text, mtimeMs: st.mtimeMs, size: st.size };
      return { text: text, source: file, bytes: Buffer.byteLength(text, 'utf8') };
    } catch (e) { /* try the next candidate */ }
  }
  return null;
}

function shellText(kind) {
  /* S4_CS_NO_SHELL keeps the forced-zoom CSS (it is what the user asked for)
     and only drops the interactive JS shell */
  if (NO_SHELL && kind === 'js') { return ''; }
  const hit = loadShell(kind);
  if (hit) { return hit.text; }
  stats.shellFallback = (stats.shellFallback || 0) + 1;
  return kind === 'css' ? FALLBACK_CSS : FALLBACK_JS;
}

function shellSource(kind) {
  const hit = loadShell(kind);
  return hit ? hit.source : (kind === 'css' ? 'builtin-fallback-css' : 'builtin-fallback-js');
}

/* Substitute the configured zoom into whichever token style the shell uses. */
function withZoom(text) {
  const inv = String(Math.round((1 / ZOOM) * 1e6) / 1e6);
  return String(text)
    .split('__ZOOM__').join(String(ZOOM))
    .split('__INV__').join(inv)
    .split('__BASE__').join(BASE)
    .split('__FBV__').join(VERSION + '-fb')
    .replace(/--s4-zoom:\s*[0-9]*\.?[0-9]+/, '--s4-zoom: ' + ZOOM)
    .replace(/--s4-inv:\s*[0-9]*\.?[0-9]+/, '--s4-inv: ' + inv);
}

const BASE = '/__s4mobile';

/* ------------------------------------------------------------------ stats */
const stats = {
  started: Date.now(),
  htmlSeen: 0,
  htmlInjected: 0,
  nonce: { page: 0, 'csp-header': 0, generated: 0, none: 0 },
  cspRewritten: 0,
  viewportStripped: 0,
  ws: 0,
  wsErr: 0,
  proxied: 0,
  upstreamErr: 0,
  reports: 0,
  lastReport: null,
  lastReportAt: 0,
  lastError: '',
  lastNonceSource: '',
  shellFallback: 0
};
const ringLog = [];
function note(msg) {
  const line = new Date().toISOString().slice(11, 19) + ' ' + msg;
  ringLog.push(line);
  if (ringLog.length > 60) { ringLog.shift(); }
  console.log('[s4-csproxy] ' + msg);
}

/* ------------------------------------------------------------------- CSP */
function headerValue(h, name) {
  const v = h ? h[name] : undefined;
  if (Array.isArray(v)) { return v.join(', '); }
  return v === undefined ? '' : String(v);
}

function findNonce(html, headers) {
  const csp = headerValue(headers, 'content-security-policy');
  let m = /'nonce-([A-Za-z0-9+/=_\-]{6,})'/.exec(csp);
  if (m) { return { value: m[1], src: 'csp-header' }; }
  m = /<script[^>]+\bnonce=["']([^"']{6,})["']/i.exec(html);
  if (m) { return { value: m[1], src: 'page' }; }
  m = /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]+content=["'][^"']*nonce-([A-Za-z0-9+/=_\-]{6,})/i.exec(html);
  if (m) { return { value: m[1], src: 'page' }; }
  return null;
}

function amendCsp(csp, nonce) {
  const token = "'nonce-" + nonce + "'";
  if (!csp || /'nonce-/.test(csp)) { return csp; }
  const parts = csp.split(';').map((s) => s.trim()).filter(Boolean);
  let touched = false;
  const out = parts.map((d) => {
    const name = d.split(/\s+/)[0].toLowerCase();
    if (name === 'script-src' || name === 'script-src-elem' || name === 'default-src') {
      touched = true;
      return d + ' ' + token;
    }
    return d;
  });
  if (!touched) { out.push('script-src ' + token); }
  return out.join('; ');
}

function newNonce() {
  return crypto.randomBytes(18).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ------------------------------------------------------------- injection */
const VIEWPORT = 'width=device-width, initial-scale=1, minimum-scale=0.25, maximum-scale=10, user-scalable=yes, viewport-fit=cover';

function buildSnippet(nonceValue) {
  const css = withZoom(shellText('css'));
  const js = withZoom(shellText('js')).replace(/<\/script/gi, '<\\/script');
  const cfg = 'window.__s4proxy={v:"' + VERSION + '",marker:"' + MARKER + '",zoom:' + ZOOM
    + ',base:"' + BASE + '",upstream:"' + CS_HOST + ':' + CS_PORT + '"};';
  const nonceAttr = nonceValue ? ' nonce="' + nonceValue + '"' : '';
  return '<meta name="' + MARKER + '" content="zoom=' + ZOOM + ';v=' + VERSION + '">'
    + '<meta name="viewport" content="' + VIEWPORT + '" data-s4="viewport">'
    /* no nonce on <style>: style-src has 'unsafe-inline' but no nonce, and a
       nonce would switch 'unsafe-inline' off for that directive */
    + '<style id="' + MARKER + '-css" data-s4="css">' + css + '</style>'
    + '<script id="' + MARKER + '-js" data-s4="mob"' + nonceAttr + '>' + cfg + js + '<' + '/script>';
}

/* headersOut is mutated when we have to amend a CSP header */
function inject(html, headersOut) {
  stats.htmlSeen++;
  let nonceValue = '';
  let nonceSrc = 'none';
  const found = findNonce(html, headersOut || {});
  if (found) {
    nonceValue = found.value;
    nonceSrc = found.src;
  } else {
    const csp = headerValue(headersOut, 'content-security-policy');
    const metaCsp = /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?/i.test(html);
    if (csp || metaCsp) {
      nonceValue = newNonce();
      nonceSrc = 'generated';
      if (csp) {
        const amended = amendCsp(csp, nonceValue);
        if (amended !== csp) {
          headersOut['content-security-policy'] = amended;
          stats.cspRewritten++;
        }
      }
      if (metaCsp) {
        html = html.replace(/(<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]+content=["'])([^"']*)(["'])/gi,
          (m, a, body, q) => a + amendCsp(body, nonceValue) + q);
        stats.cspRewritten++;
      }
    }
  }
  stats.nonce[nonceSrc] = (stats.nonce[nonceSrc] || 0) + 1;
  stats.lastNonceSource = nonceSrc;

  /* the workbench pins user-scalable=no; drop every pre-existing viewport meta
     so ours is the only one the browser sees */
  let stripped = 0;
  html = html.replace(/<meta[^>]+name=["']?viewport["']?[^>]*>/gi, () => { stripped++; return ''; });
  stats.viewportStripped += stripped;

  const snippet = buildSnippet(nonceValue);
  /* IMPORTANT: every replacement below uses a FUNCTION.  A replacement STRING
     would interpret $&, $`, $' and $$ inside our own payload - and the shell
     legitimately contains a bare  $'  (the '$' entry of the extra-keys row),
     which String.replace() expands to "the rest of the document".  That
     spliced the whole page tail into the injected <script> and broke parsing. */
  let out;
  if (/<\/head>/i.test(html)) { out = html.replace(/<\/head>/i, () => snippet + '</head>'); }
  else if (/<body([^>]*)>/i.test(html)) { out = html.replace(/<body([^>]*)>/i, (m, attrs) => '<body' + attrs + '>' + snippet); }
  else if (/<html([^>]*)>/i.test(html)) { out = html.replace(/<html([^>]*)>/i, (m, attrs) => '<html' + attrs + '>' + snippet); }
  else { out = snippet + html; }

  stats.htmlInjected++;
  return out;
}

/* --------------------------------------------------------------- endpoints */
function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8');
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function statusObject(withProbe, cb) {
  const obj = {
    proxy: 's4-csproxy',
    version: VERSION,
    marker: MARKER,
    pid: process.pid,
    uptimeSec: Math.round((Date.now() - stats.started) / 1000),
    listen: LISTEN_HOST + ':' + LISTEN_PORT,
    upstream: CS_HOST + ':' + CS_PORT,
    zoom: ZOOM,
    zoomInv: Math.round((1 / ZOOM) * 1e6) / 1e6,
    shell: {
      css: { source: shellSource('css'), bytes: Buffer.byteLength(shellText('css'), 'utf8') },
      js: { source: shellSource('js'), bytes: Buffer.byteLength(shellText('js'), 'utf8') }
    },
    nonce: { lastSource: stats.lastNonceSource, counts: stats.nonce, cspRewritten: stats.cspRewritten },
    counters: {
      htmlSeen: stats.htmlSeen,
      htmlInjected: stats.htmlInjected,
      viewportStripped: stats.viewportStripped,
      proxied: stats.proxied,
      ws: stats.ws,
      wsErr: stats.wsErr,
      upstreamErr: stats.upstreamErr,
      shellFallback: stats.shellFallback,
      browserReports: stats.reports
    },
    lastError: stats.lastError,
    lastBrowserReport: stats.lastReport,
    lastBrowserReportAgeSec: stats.lastReportAt ? Math.round((Date.now() - stats.lastReportAt) / 1000) : null,
    log: ringLog.slice(-14)
  };
  if (!withProbe) { return cb(obj); }
  probeUpstream((r) => { obj.upstreamProbe = r; cb(obj); });
}

function probeUpstream(cb) {
  const t0 = Date.now();
  const req = http.get({ host: CS_HOST, port: CS_PORT, path: '/healthz', timeout: 4000 }, (res) => {
    let n = 0;
    res.on('data', (c) => { n += c.length; if (n > 4096) { res.destroy(); } });
    res.on('end', () => cb({ ok: res.statusCode < 500, status: res.statusCode, ms: Date.now() - t0 }));
    res.on('error', () => cb({ ok: false, status: res.statusCode, ms: Date.now() - t0, error: 'stream' }));
  });
  req.on('timeout', () => { req.destroy(); cb({ ok: false, error: 'timeout', ms: Date.now() - t0 }); });
  req.on('error', (e) => cb({ ok: false, error: String(e.code || e.message), ms: Date.now() - t0 }));
}

function handleS4(req, res, url) {
  const route = url.pathname.replace(/\/+$/, '') || BASE;
  if (route === BASE + '/report') {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size < 256 * 1024) { chunks.push(c); } else { req.destroy(); }
    });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
      catch (e) { parsed = { parseError: String(e.message), raw: Buffer.concat(chunks).toString('utf8').slice(0, 500) }; }
      stats.lastReport = parsed;
      stats.lastReportAt = Date.now();
      stats.reports++;
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(REPORT_FILE, JSON.stringify(parsed, null, 2) + '\n');
      } catch (e) { /* the in-memory copy is enough */ }
      json(res, 200, { ok: true, reports: stats.reports });
    });
    return;
  }
  if (route === BASE + '/html') {
    /* the exact snippet injected into pages (no nonce here: a real nonce only
       exists per response, this is for grep-based assertions in a round) */
    const snippet = buildSnippet('');
    const body = Buffer.from(snippet, 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length), 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  if (route === BASE + '/shell.css' || route === BASE + '/shell.js') {
    const kind = route === BASE + '/shell.js' ? 'js' : 'css';
    const body = Buffer.from(withZoom(shellText(kind)), 'utf8');
    res.writeHead(200, {
      'content-type': kind === 'js' ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8',
      'content-length': String(body.length),
      'x-s4-source': shellSource(kind),
      'cache-control': 'no-store'
    });
    res.end(body);
    return;
  }
  if (route === BASE + '/log') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(ringLog.join('\n') + '\n');
    return;
  }
  if (route === BASE) {
    statusObject(/[?&]probe=1/.test(url.search || ''), (obj) => json(res, 200, obj));
    return;
  }
  json(res, 404, { error: 'unknown s4mobile route', route: route, base: BASE });
}

/* ------------------------------------------------------------------ server */
const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (e) { url = new URL('http://localhost/'); }

  if (url.pathname === BASE || url.pathname.indexOf(BASE + '/') === 0) {
    handleS4(req, res, url);
    return;
  }

  const headers = {};
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const k = req.rawHeaders[i];
    const v = req.rawHeaders[i + 1];
    if (k.toLowerCase() === 'host') { headers[k] = CS_HOST + ':' + CS_PORT; }
    else if (k.toLowerCase() === 'accept-encoding') { headers[k] = 'identity'; }
    else { headers[k] = v; }
  }
  if (!headers['accept-encoding']) { headers['accept-encoding'] = 'identity'; }

  const up = http.request({ host: CS_HOST, port: CS_PORT, method: req.method, path: req.url, headers }, (ur) => {
    const ct = headerValue(ur.headers, 'content-type');
    stats.proxied++;
    if (!/text\/html/i.test(ct)) {
      res.writeHead(ur.statusCode || 502, ur.headers);
      ur.pipe(res);
      return;
    }
    const chunks = [];
    let size = 0;
    ur.on('data', (c) => { size += c.length; if (size < MAX_HTML) { chunks.push(c); } });
    ur.on('end', () => {
      const h = {};
      Object.keys(ur.headers).forEach((k) => {
        const lk = k.toLowerCase();
        if (lk === 'content-length' || lk === 'content-encoding' || lk === 'transfer-encoding') { return; }
        h[k] = ur.headers[k];
      });
      const html = Buffer.concat(chunks).toString('utf8');
      const out = Buffer.from(inject(html, h), 'utf8');
      h['content-length'] = String(out.length);
      h['x-s4-mobile'] = 'injected';
      h['x-s4-nonce-source'] = stats.lastNonceSource;
      res.writeHead(ur.statusCode || 200, h);
      res.end(out);
      note('html ' + req.method + ' ' + req.url + ' -> ' + out.length + 'B nonce=' + stats.lastNonceSource
        + ' zoom=' + ZOOM);
    });
    ur.on('error', (e) => { stats.lastError = 'upstream stream: ' + e.message; });
  });

  up.on('error', (e) => {
    stats.upstreamErr++;
    stats.lastError = 'upstream: ' + (e.code || e.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    }
    const page = '<!doctype html><html><head><title>code-server offline</title></head>'
      + '<body><h2>s4-csproxy ' + VERSION + '</h2>'
      + '<p>code-server is not answering on ' + CS_HOST + ':' + CS_PORT + '.</p>'
      + '<p>Error: ' + String(e.message).replace(/[<>&]/g, '') + '</p>'
      + '<p>Start it with: <code>bash ~/s4-remote.sh --code</code></p>'
      + '<p>Status: <code>curl -s http://127.0.0.1:' + LISTEN_PORT + BASE + '?probe=1</code></p>'
      + '</body></html>';
    res.end(inject(page, {}));
  });
  req.pipe(up);
});

/* WebSocket / raw upgrade -> plain TCP tunnel so nothing VS Code does breaks */
server.on('upgrade', (req, socket, head) => {
  stats.ws++;
  const up = net.connect(CS_PORT, CS_HOST, () => {
    const lines = [req.method + ' ' + req.url + ' HTTP/1.1'];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      const v = req.rawHeaders[i + 1];
      lines.push(k.toLowerCase() === 'host' ? 'host: ' + CS_HOST + ':' + CS_PORT : k + ': ' + v);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) { up.write(head); }
    up.pipe(socket);
    socket.pipe(up);
  });
  const kill = () => {
    try { up.destroy(); } catch (e) { /* ignore */ }
    try { socket.destroy(); } catch (e) { /* ignore */ }
  };
  up.on('error', (e) => { stats.wsErr++; stats.lastError = 'ws upstream: ' + (e.code || e.message); kill(); });
  socket.on('error', () => { stats.wsErr++; kill(); });
  socket.on('close', kill);
});

server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) { /* ignore */ }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  note('v' + VERSION + ' listening on http://' + LISTEN_HOST + ':' + LISTEN_PORT
    + ' -> code-server ' + CS_HOST + ':' + CS_PORT
    + ' | forced zoom ' + ZOOM + ' | marker ' + MARKER);
  note('shell css=' + shellSource('css') + ' js=' + shellSource('js')
    + (NO_SHELL ? ' (shell disabled by S4_CS_NO_SHELL)' : ''));
  note('evidence: curl -s http://' + LISTEN_HOST + ':' + LISTEN_PORT + BASE + '?probe=1');
});

process.on('SIGTERM', () => { try { server.close(); } catch (e) { /* ignore */ } process.exit(0); });
process.on('SIGINT', () => { try { server.close(); } catch (e) { /* ignore */ } process.exit(0); });
