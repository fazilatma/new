#!/usr/bin/env node
/* =====================================================================
 *  s4-csproxy.js — makes code-server genuinely usable on a phone
 *
 *  WHY A PROXY
 *  -----------
 *  In a browser, VS Code's `window.zoomLevel` is an Electron feature and
 *  is ignored, and the workbench page pins its viewport so pinch-zoom
 *  does nothing. We cannot patch those from settings.json. So this tiny
 *  dependency-free Node proxy sits in front of code-server and:
 *
 *    1. rewrites every text/html response to inject
 *         <meta name="viewport" … user-scalable=yes, maximum-scale=10>
 *         <style>  forced workbench zoom + touch-friendly chrome  </style>
 *         <script> floating A−/A+/reset/fullscreen controls        </script>
 *    2. tunnels WebSocket upgrades as a raw TCP pipe, so the terminal,
 *       extension host, file watching and remote-agent sockets keep working
 *    3. never touches the code-server installation (upgrade-safe)
 *
 *  USAGE (normally started by deploy/s4-remote.sh)
 *    S4_CS_PORT=8081 S4_CS_UPSTREAM=18081 S4_CS_ZOOM=1.4 node s4-csproxy.js
 *
 *  ENV
 *    S4_CS_HOST      listen address           (default 127.0.0.1)
 *    S4_CS_PORT      listen port              (default 8081)
 *    S4_CS_UPSTREAM  code-server port         (default 18081)
 *    S4_CS_ZOOM      forced zoom factor       (default 1.35)
 *    S4_CS_CSS       extra/override CSS file  (default ~/.s4-remote/mobile.css)
 *
 *  Open http://127.0.0.1:8081/ in the phone's browser (Chrome, Samsung
 *  Internet or Edge — they honour CSS zoom; old Firefox does not).
 * ===================================================================== */
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LISTEN_HOST = process.env.S4_CS_HOST || '127.0.0.1';
const LISTEN_PORT = parseInt(process.env.S4_CS_PORT || '8081', 10);
const CS_HOST = process.env.S4_CS_UPSTREAM_HOST || '127.0.0.1';
const CS_PORT = parseInt(process.env.S4_CS_UPSTREAM || '18081', 10);
const ZOOM = parseFloat(process.env.S4_CS_ZOOM || '1.35');
const CSS_OVERRIDE = process.env.S4_CS_CSS
  || path.join(os.homedir(), '.s4-remote', 'mobile.css');
const MARKER = 's4-cs-mobile-v1';
const MAX_HTML = 12 * 1024 * 1024;

/* ------------------------------------------------------------------ CSS */
/* Keep this to things that cannot break Monaco's coordinate maths: zoom the
 * whole document (virtualised list heights scale with it), enlarge scrollbars,
 * menu rows and inputs, and allow pinch. Do NOT set fixed heights on
 * .monaco-list-row / tabs — those come from JS and would overlap. */
const DEFAULT_CSS = `
:root { --s4-zoom: __ZOOM__; }
html { -webkit-text-size-adjust: 100%; }
html, body { touch-action: manipulation; }
body { zoom: var(--s4-zoom); }
.monaco-workbench { -webkit-overflow-scrolling: touch; }

/* thicker, easier-to-hit scrollbars */
.monaco-scrollable-element > .scrollbar > .slider { opacity: .55; }
.monaco-scrollable-element > .scrollbar.vertical > .slider { width: 14px !important; }
.monaco-scrollable-element > .scrollbar.horizontal > .slider { height: 14px !important; }
.monaco-scrollable-element > .scrollbar.vertical { width: 14px !important; }
.monaco-scrollable-element > .scrollbar.horizontal { height: 14px !important; }
.monaco-editor .scroll-decoration { box-shadow: none; }

/* menus, quick pick and dialogs: taller rows, readable text */
.context-view .monaco-menu .action-item { padding: 11px 14px !important; }
.context-view .monaco-menu .action-label { font-size: 15px !important; }
.quick-input-widget { font-size: 15px !important; }
.quick-input-list .quick-input-list-entry { padding: 6px 8px !important; }
.quick-input-list .quick-input-list-label { font-size: 15px !important; }
.monaco-dialog-box .dialog-message { font-size: 15px !important; }
.monaco-dialog-box .dialog-buttons-container .monaco-button { padding: 10px 14px !important; }

/* inputs and buttons big enough for a thumb */
.monaco-inputbox input, .monaco-inputbox textarea, .monaco-button, select {
  font-size: 15px !important;
}
.monaco-inputbox { min-height: 40px; }
.monaco-toolbar .action-item { padding: 2px !important; }
.codicon { font-size: 18px !important; }

/* the terminal is where phones hurt most */
.xterm .xterm-viewport { overflow-y: auto !important; }
.xterm-screen { touch-action: pan-y !important; }

/* let the editor use the whole screen: hide the breadcrumb strip and the
   activity-bar labels only when the window is narrow */
@media (max-width: 900px) {
  .breadcrumbs-control { display: none !important; }
  .monaco-workbench .part.titlebar .window-title { font-size: 13px !important; }
  .statusbar-item > a, .statusbar-item > span { padding: 0 8px !important; }
}

/* floating controls */
#__MKR__-bar {
  position: fixed; z-index: 2147483000; left: 8px; bottom: calc(10px + env(safe-area-inset-bottom));
  display: flex; gap: 6px; align-items: center;
  background: rgba(12,16,32,.88); border: 1px solid #2b3557; border-radius: 14px;
  padding: 6px; box-shadow: 0 6px 24px rgba(0,0,0,.45); backdrop-filter: blur(4px);
  font-family: system-ui, sans-serif;
}
#__MKR__-bar button {
  min-width: 44px; min-height: 44px; border-radius: 10px; border: 1px solid #38456f;
  background: #1a2140; color: #e8edff; font-size: 16px; font-weight: 700; line-height: 1;
  cursor: pointer; padding: 0 10px;
}
#__MKR__-bar button:active { background: #4f8cff; border-color: #4f8cff; }
#__MKR__-bar .val { color: #9fb0e8; font-size: 12px; min-width: 46px; text-align: center; }
#__MKR__-bar.hidden { display: none; }
#__MKR__-fab {
  position: fixed; z-index: 2147483001; left: 8px; bottom: calc(10px + env(safe-area-inset-bottom));
  width: 40px; height: 40px; border-radius: 50%; border: 1px solid #38456f;
  background: #1a2140; color: #e8edff; font-size: 18px; display: none;
}
`;

/* ------------------------------------------------------------------- JS */
/* No "</script>" sequence may appear inside this string. */
const DEFAULT_JS = `
(function () {
  var MK = '__MKR__';
  var DEF = __ZOOM__;
  var MIN = 0.7, MAX = 3.5, STEP = 0.05;
  var z = parseFloat(localStorage.getItem(MK + '-zoom') || '') || DEF;

  function clamp(v) { return Math.max(MIN, Math.min(MAX, Math.round(v * 100) / 100)); }

  function viewport() {
    var m = document.querySelector('meta[name="viewport"]');
    if (!m) { m = document.createElement('meta'); m.setAttribute('name', 'viewport'); document.head.appendChild(m); }
    m.setAttribute('content',
      'width=device-width, initial-scale=1, minimum-scale=0.5, maximum-scale=10, user-scalable=yes, viewport-fit=cover');
  }

  function apply() {
    document.documentElement.style.setProperty('--s4-zoom', z);
    if (document.body) document.body.style.zoom = z;
    var v = document.getElementById(MK + '-val');
    if (v) v.textContent = Math.round(z * 100) + '%';
    try { localStorage.setItem(MK + '-zoom', String(z)); } catch (e) {}
  }

  function setZoom(nz) { z = clamp(nz); apply(); }

  function bar() {
    if (document.getElementById(MK + '-bar')) return;
    var b = document.createElement('div');
    b.id = MK + '-bar';
    b.innerHTML =
      '<button data-a="out" title="کوچک‌تر">A−</button>' +
      '<span class="val" id="' + MK + '-val">–</span>' +
      '<button data-a="in" title="بزرگ‌تر">A+</button>' +
      '<button data-a="reset" title="بازنشانی">⟳</button>' +
      '<button data-a="fs" title="تمام‌صفحه">⛶</button>' +
      '<button data-a="hide" title="پنهان کردن">✕</button>';
    document.documentElement.appendChild(b);
    b.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-a') : null;
      if (!t) return;
      ev.preventDefault(); ev.stopPropagation();
      if (t === 'in') setZoom(z + STEP);
      else if (t === 'out') setZoom(z - STEP);
      else if (t === 'reset') setZoom(DEF);
      else if (t === 'fs') {
        var d = document;
        if (!d.fullscreenElement) { (d.documentElement.requestFullscreen || function () {}).call(d.documentElement); }
        else if (d.exitFullscreen) d.exitFullscreen();
      } else if (t === 'hide') {
        b.classList.add('hidden');
        var f = document.getElementById(MK + '-fab');
        if (f) f.style.display = 'block';
      }
    });
    var f = document.createElement('button');
    f.id = MK + '-fab'; f.textContent = 'A';
    f.addEventListener('click', function () {
      f.style.display = 'none'; b.classList.remove('hidden');
    });
    document.documentElement.appendChild(f);
  }

  function boot() {
    viewport(); bar(); apply();
    /* two-finger pinch on the workbench, in addition to browser pinch */
    var d0 = 0, z0 = 0;
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        d0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        z0 = z;
      }
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && d0 > 0) {
        var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        setZoom(z0 * (d / d0));
      }
    }, { passive: true });
    document.addEventListener('touchend', function (e) { if (e.touches.length < 2) d0 = 0; }, { passive: true });
    /* ?z=1.8 in the address bar wins and is remembered */
    var m = /[?&]z=([0-9.]+)/.exec(location.search);
    if (m) setZoom(parseFloat(m[1]));
    /* VS Code re-renders; keep re-asserting for a while, then on demand */
    var n = 0;
    var t = setInterval(function () { viewport(); apply(); if (++n > 40) clearInterval(t); }, 750);
    document.addEventListener('visibilitychange', function () { viewport(); apply(); });
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=' )) { setZoom(z + STEP); e.preventDefault(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { setZoom(z - STEP); e.preventDefault(); }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { setZoom(DEF); e.preventDefault(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
`;

/* --------------------------------------------------------------- inject */
function buildPayload() {
  let css = DEFAULT_CSS;
  try {
    if (fs.existsSync(CSS_OVERRIDE)) {
      const custom = fs.readFileSync(CSS_OVERRIDE, 'utf8');
      if (custom.trim()) css = custom;
    }
  } catch (e) { /* keep the default */ }
  css = css.split('__ZOOM__').join(String(ZOOM)).split('__MKR__').join(MARKER);
  const js = DEFAULT_JS.split('__ZOOM__').join(String(ZOOM)).split('__MKR__').join(MARKER);
  return '<meta name="' + MARKER + '" content="zoom=' + ZOOM + '">'
    + '<style id="' + MARKER + '-css">' + css + '</style>'
    + '<script id="' + MARKER + '-js">' + js + '<' + '/script>';
}

function inject(html) {
  const tag = buildPayload();
  /* remove the workbench's own viewport meta (it pins user-scalable=no, which
     is what makes pinch-zoom dead on a phone); ours below replaces it */
  html = html.replace(/<meta[^>]+name=["']?viewport["']?[^>]*>/gi, '');
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tag + '</head>');
  if (/<body([^>]*)>/i.test(html)) return html.replace(/<body([^>]*)>/i, '<body$1>' + tag);
  if (/<html([^>]*)>/i.test(html)) return html.replace(/<html([^>]*)>/i, '<html$1>' + tag);
  return tag + html;
}

/* ---------------------------------------------------------------- server */
const server = http.createServer((req, res) => {
  const headers = {};
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const k = req.rawHeaders[i];
    const v = req.rawHeaders[i + 1];
    if (k.toLowerCase() === 'host') headers[k] = CS_HOST + ':' + CS_PORT;
    else if (k.toLowerCase() === 'accept-encoding') headers[k] = 'identity';
    else headers[k] = v;
  }
  if (!headers['accept-encoding']) headers['accept-encoding'] = 'identity';

  const up = http.request({ host: CS_HOST, port: CS_PORT, method: req.method, path: req.url, headers }, (ur) => {
    const ct = String(ur.headers['content-type'] || '');
    const isHtml = /text\/html/i.test(ct);
    if (!isHtml) {
      res.writeHead(ur.statusCode || 502, ur.headers);
      ur.pipe(res);
      return;
    }
    const chunks = [];
    let size = 0;
    ur.on('data', (c) => {
      size += c.length;
      if (size < MAX_HTML) chunks.push(c);
    });
    ur.on('end', () => {
      const out = Buffer.from(inject(Buffer.concat(chunks).toString('utf8')), 'utf8');
      const h = {};
      Object.keys(ur.headers).forEach((k) => {
        const lk = k.toLowerCase();
        if (lk === 'content-length' || lk === 'content-encoding' || lk === 'transfer-encoding') return;
        h[k] = ur.headers[k];
      });
      h['content-length'] = String(out.length);
      res.writeHead(ur.statusCode || 200, h);
      res.end(out);
    });
  });

  up.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
    }
    res.end(inject('<!doctype html><html><head><title>code-server offline</title></head><body style="font:16px system-ui;padding:24px;background:#0b1020;color:#e7ecff">'
      + '<h2>s4-csproxy</h2><p>code-server is not answering on ' + CS_HOST + ':' + CS_PORT + '.</p>'
      + '<p>Error: ' + String(e.message).replace(/[<>&]/g, '') + '</p>'
      + '<p>Start it: <code>bash ~/s4-remote.sh --code</code></p></body></html>'));
  });
  req.pipe(up);
});

/* WebSocket / raw upgrade → plain TCP tunnel so nothing VS Code does breaks */
server.on('upgrade', (req, socket, head) => {
  const up = net.connect(CS_PORT, CS_HOST, () => {
    const lines = [req.method + ' ' + req.url + ' HTTP/1.1'];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      const v = req.rawHeaders[i + 1];
      lines.push(k.toLowerCase() === 'host' ? 'host: ' + CS_HOST + ':' + CS_PORT : k + ': ' + v);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const kill = () => {
    try { up.destroy(); } catch (e) { /* ignore */ }
    try { socket.destroy(); } catch (e) { /* ignore */ }
  };
  up.on('error', kill);
  socket.on('error', kill);
  socket.on('close', kill);
});

server.on('clientError', (err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) { /* ignore */ }
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log('[s4-csproxy] listening on http://' + LISTEN_HOST + ':' + LISTEN_PORT
    + ' -> code-server ' + CS_HOST + ':' + CS_PORT
    + ' | forced zoom ' + ZOOM + ' | marker ' + MARKER);
});

process.on('SIGTERM', () => { try { server.close(); } catch (e) {} process.exit(0); });
process.on('SIGINT', () => { try { server.close(); } catch (e) {} process.exit(0); });
