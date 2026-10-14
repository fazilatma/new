/* ===========================================================================
 * deploy/tests/s4-mobile-selftest.js  v1.0
 * ---------------------------------------------------------------------------
 * Regression harness for the mobile code-server stack:
 *     deploy/s4-csproxy.js  (injection proxy, v2)
 *     deploy/s4-csmobile.css + deploy/s4-csmobile.js (the mobile shell)
 *
 *   node deploy/tests/s4-mobile-selftest.js [--no-jsdom] [--keep]
 *
 * It spins up a dummy upstream that answers EXACTLY like the VS Code web
 * workbench does (same <script nonce="..."> skeleton, same pinch-blocking
 * viewport meta, same Content-Security-Policy that
 * src/vs/server/node/webClientServer.ts sends: script-src with a nonce and
 * style-src 'unsafe-inline'), starts the proxy in front of it, and asserts:
 *
 *   Part A  the CSP trap       - our <script> must carry the page nonce, our
 *                                <style> must NOT (a nonce would switch off
 *                                'unsafe-inline' for style-src)
 *             the $' trap      - String.replace() with a replacement STRING
 *                                expands $' to "the rest of the document";
 *                                the shell source contains a bare $' (the '$'
 *                                extra key), so the page tail used to be
 *                                spliced into the <script>.  Asserted by
 *                                "exactly one <body>" and "the script body
 *                                ends with the shell source verbatim".
 *             viewport unlock  - user-scalable=no must be gone
 *             forced zoom CSS  - .monaco-workbench{zoom:var(--s4-zoom)} plus
 *                                the --s4-inv box compensation
 *             integrity        - content-length, passthrough, WS tunnel
 *             evidence         - GET/POST /__s4mobile*
 *   Part B  the shell in jsdom - dock/tabs/extra keys are built, a tab click
 *             reaches the real activity-bar node, the command-palette ladder
 *             works, zoom updates the CSS vars, and the shell reports its own
 *             state back to the proxy.
 *
 * Part B needs jsdom (npm install jsdom).  Without it the script still runs
 * Part A and says so - useful on a phone where installing jsdom is heavy.
 * Exit code 0 = everything that could run passed.
 * =========================================================================== */
'use strict';
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ARGS = process.argv.slice(2);
const NO_JSDOM = ARGS.indexOf('--no-jsdom') >= 0;
const KEEP = ARGS.indexOf('--keep') >= 0;

const DEPLOY = path.resolve(__dirname, '..');
const PROXY = path.join(DEPLOY, 's4-csproxy.js');
const SHELL_CSS = path.join(DEPLOY, 's4-csmobile.css');
const SHELL_JS = path.join(DEPLOY, 's4-csmobile.js');
const MARKER = 's4-cs-mobile-v2';
const PAGE_NONCE = 'T3stNonceFromThePage0000000000';
const ZOOM = 1.3;
const UP_PORT = 18099;
const PX_PORT = 18098;

let pass = 0, fail = 0, skip = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra === undefined ? '' : '  :: ' + JSON.stringify(extra))); }
}
function skipped(name, why) { skip++; console.log('  skip ' + name + ' (' + why + ')'); }
function section(t) { console.log('\n== ' + t + ' =='); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------- what VS Code really sends */
function cspWithNonce(nonce) {
  return "default-src 'self'; img-src 'self' data: blob:; "
    + "script-src 'self' 'unsafe-eval' blob: 'nonce-" + nonce + "'; "
    + "style-src 'self' 'unsafe-inline'; font-src 'self'; "
    + "connect-src 'self' ws: wss:; worker-src 'self' blob:;";
}

/* A faithful skeleton of src/vs/code/browser/workbench/workbench.html:
   nonce'd scripts in <head>, the pinch-blocking viewport meta, </head>,
   <body aria-label="">, then the startup scripts AFTER </body>. */
function workbenchHtml(nonce) {
  return '<!DOCTYPE html>\n<html>\n\t<head>\n'
    + '\t\t<script nonce="' + nonce + '">\n\t\t\tperformance.mark(\'code/didStartRenderer\');\n\t\t</script>\n'
    + '\t\t<meta charset="utf-8" />\n'
    + '\t\t<!-- Mobile tweaks -->\n'
    + '\t\t<meta name="mobile-web-app-capable" content="yes" />\n'
    + '\t\t<!-- Disable pinch zooming -->\n'
    + '\t\t<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">\n'
    + '\t\t<meta id="vscode-workbench-web-configuration" data-settings="{}">\n'
    + '\t\t<link rel="stylesheet" href="/out/vs/code/browser/workbench/workbench.css">\n'
    + '\t</head>\n\n\t<body aria-label="">\n\t\t<div id="vscode-startup-fallback"></div>\n\t</body>\n\n'
    + '\t<!-- Startup (do not modify order of script tags!) -->\n'
    + '\t<script nonce="' + nonce + '">\n\t\tconst baseUrl = \'/\';\n\t\tglobalThis._VSCODE_FILE_ROOT = baseUrl + \'/out/\';\n\t</script>\n'
    + '\t<script type="module" src="/out/vs/code/browser/workbench/workbench.js"></script>\n</html>\n';
}

const CSS_BODY = '.monaco-workbench{position:relative}\n';
const JSON_BODY = '{"ok":true,"s4":"passthrough"}';

const upstream = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/' || u === '/workbench') {
    const body = Buffer.from(workbenchHtml(PAGE_NONCE), 'utf8');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(body.length),
      'content-security-policy': cspWithNonce(PAGE_NONCE)
    });
    res.end(body);
    return;
  }
  if (u === '/gen') {
    const body = Buffer.from('<!doctype html><html><head><title>gen</title></head><body><p>no nonce</p></body></html>', 'utf8');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(body.length),
      'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    });
    res.end(body);
    return;
  }
  if (u === '/metacsp') {
    const body = Buffer.from('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'; style-src \'unsafe-inline\'"><title>meta</title></head><body>m</body></html>', 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length) });
    res.end(body);
    return;
  }
  if (u === '/login') {
    const body = Buffer.from('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no"><title>Login</title></head><body><form class="login-form"><input name="password"></form></body></html>', 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length) });
    res.end(body);
    return;
  }
  if (u === '/style.css') { res.writeHead(200, { 'content-type': 'text/css', 'content-length': String(Buffer.byteLength(CSS_BODY)) }); res.end(CSS_BODY); return; }
  if (u === '/api.json') { res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(JSON_BODY)) }); res.end(JSON_BODY); return; }
  if (u === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('nope');
});
upstream.on('upgrade', (req, socket, head) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  if (head && head.length) { socket.write(head); }
  socket.on('data', (d) => { try { socket.write(d); } catch (e) {} });
  socket.on('error', () => {});
});

/* ---------------------------------------------------------------- helpers */
function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(new Error('timeout ' + p)); });
  });
}
function post(port, p, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(body, 'utf8');
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(data.length) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(data);
  });
}
function wsEcho(port, p, payload) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write('GET ' + p + ' HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
      sock.write(payload);
    });
    let buf = Buffer.alloc(0);
    const t = setTimeout(() => { sock.destroy(); reject(new Error('ws timeout')); }, 5000);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      const s = buf.toString('utf8');
      if (s.indexOf('101 Switching Protocols') >= 0 && s.indexOf(payload) > 0) { clearTimeout(t); sock.destroy(); resolve(s); }
    });
    sock.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}
function loadJsdom() {
  const tries = ['jsdom', path.join(process.env.HOME || '/root', 'lint/node_modules/jsdom'), '/home/user/lint/node_modules/jsdom'];
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  return null;
}

/* ------------------------------------------------------------------- main */
(async function main() {
  for (const f of [PROXY, SHELL_CSS, SHELL_JS]) {
    if (!fs.existsSync(f)) { console.log('MISSING FILE: ' + f); process.exit(2); }
  }
  await new Promise((r) => upstream.listen(UP_PORT, '127.0.0.1', r));
  const stateDir = fs.mkdtempSync('/tmp/s4self-');
  const child = spawn(process.execPath, [PROXY], {
    env: Object.assign({}, process.env, {
      S4_CS_HOST: '127.0.0.1', S4_CS_PORT: String(PX_PORT), S4_CS_UPSTREAM: String(UP_PORT),
      S4_CS_ZOOM: String(ZOOM), S4_CS_STATE: stateDir
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let plog = '';
  child.stdout.on('data', (d) => { plog += d; });
  child.stderr.on('data', (d) => { plog += d; });

  try {
    for (let i = 0; i < 60; i++) { try { await get(PX_PORT, '/__s4mobile'); break; } catch (e) { await sleep(100); } }

    section('A1  workbench page: CSP nonce + forced zoom');
    const wb = await get(PX_PORT, '/');
    const html = wb.body.toString('utf8');
    ok('workbench served 200', wb.status === 200, wb.status);
    ok('marker ' + MARKER + ' injected', html.indexOf(MARKER) > 0);
    const scriptTag = /<script[^>]*data-s4="mob"[^>]*>/.exec(html);
    ok('shell <script> tag injected', !!scriptTag, scriptTag && scriptTag[0]);
    const scriptNonce = scriptTag ? /nonce="([^"]+)"/.exec(scriptTag[0]) : null;
    ok('shell <script> carries the PAGE nonce (CSP script-src accepts it)', !!scriptNonce && scriptNonce[1] === PAGE_NONCE, scriptNonce && scriptNonce[1]);
    const styleTag = /<style[^>]*data-s4="css"[^>]*>/.exec(html);
    ok('shell <style> tag injected', !!styleTag);
    ok("shell <style> has NO nonce (a nonce would disable style-src 'unsafe-inline')", !!styleTag && !/nonce=/.test(styleTag[0]), styleTag && styleTag[0]);
    ok('upstream CSP header forwarded with its nonce', (wb.headers['content-security-policy'] || '').indexOf("'nonce-" + PAGE_NONCE + "'") > 0);
    ok('x-s4-mobile header present', wb.headers['x-s4-mobile'] === 'injected');
    ok('x-s4-nonce-source = csp-header', wb.headers['x-s4-nonce-source'] === 'csp-header', wb.headers['x-s4-nonce-source']);
    ok('content-length matches the injected body', parseInt(wb.headers['content-length'], 10) === Buffer.byteLength(html, 'utf8'));
    ok('no content-encoding left over', !wb.headers['content-encoding']);

    section("A1b payload integrity (the $' replace trap)");
    const shellFile = fs.readFileSync(SHELL_JS, 'utf8');
    ok('page still has exactly one real <body> tag', (html.match(/<body aria-label=""\s*>/gi) || []).length === 1, (html.match(/<body/gi) || []).length);
    ok('page has exactly one workbench startup script', (html.match(/_VSCODE_FILE_ROOT/g) || []).length === 1);
    const openTag = /<script[^>]*data-s4="mob"[^>]*>/.exec(html);
    const contentStart = openTag.index + openTag[0].length;
    const closeIdx = html.indexOf('</script>', contentStart);
    const scriptBody = html.slice(contentStart, closeIdx);
    ok('injected script closes right after the shell (no document spliced in)',
      scriptBody.length - shellFile.length > 40 && scriptBody.length - shellFile.length < 220,
      [scriptBody.length, shellFile.length]);
    ok('injected script body ends with the shell source verbatim', scriptBody.slice(-shellFile.length) === shellFile);
    ok('injected script body starts with the __s4proxy config', scriptBody.indexOf('window.__s4proxy={') === 0, scriptBody.slice(0, 50));
    ok("the '$' extra key survived as source text", scriptBody.indexOf("{ c: '$' }") > 0);

    section('A2  viewport unlock (pinch-zoom layer)');
    ok('unlocked viewport injected (user-scalable=yes)', /user-scalable=yes/.test(html));
    ok("VS Code's user-scalable=no is gone", (html.match(/user-scalable=no/g) || []).length === 0);
    ok("VS Code's maximum-scale=1.0 pin is gone", (html.match(/maximum-scale=1\.0/g) || []).length === 0);
    ok('exactly one viewport meta survives', (html.match(/<meta[^>]+name=["']?viewport["']?[^>]*>/gi) || []).length === 1);

    section('A3  forced-zoom CSS');
    ok('zoom var carries the configured value', new RegExp('--s4-zoom:\\s*' + ZOOM).test(html));
    ok('inverse var present (calc-safe box compensation)', /--s4-inv:\s*0\.769231/.test(html));
    ok('workbench zoom rule present', /\.monaco-workbench\s*\{[^}]*zoom:\s*var\(--s4-zoom\)/s.test(html));
    ok('workbench box compensated', /width:\s*calc\(100%\s*\*\s*var\(--s4-inv\)\)/.test(html));
    ok('login/error fallback zoom rule present', /body:not\(:has\(\.monaco-workbench\)\)/.test(html));
    ok('the shipped shell CSS is used (dock styles present)', html.indexOf('#s4mob-dock') > 0 && html.indexOf('.s4-tab') > 0);
    ok('script closed before </head>', html.indexOf('</head>') > html.indexOf('data-s4="mob"'));

    section('A4  generated-nonce path (CSP without a nonce)');
    const gen = await get(PX_PORT, '/gen');
    const genTag = /<script[^>]*data-s4="mob"[^>]*>/.exec(gen.body.toString('utf8'));
    const genNonce = genTag ? /nonce="([^"]+)"/.exec(genTag[0]) : null;
    ok('script got a generated nonce', !!genNonce && genNonce[1].length >= 16, genNonce && genNonce[1]);
    ok('generated nonce appended to the response CSP script-src',
      !!genNonce && (gen.headers['content-security-policy'] || '').indexOf("'nonce-" + genNonce[1] + "'") > 0);
    ok('nonce source reported as generated', gen.headers['x-s4-nonce-source'] === 'generated');

    section('A5  <meta http-equiv> CSP path');
    const mcHtml = (await get(PX_PORT, '/metacsp')).body.toString('utf8');
    const mcTag = /<script[^>]*data-s4="mob"[^>]*>/.exec(mcHtml);
    const mcNonce = mcTag ? /nonce="([^"]+)"/.exec(mcTag[0]) : null;
    ok('meta-CSP page got a nonce on the shell script', !!mcNonce);
    ok('meta CSP content amended with that nonce',
      !!mcNonce && new RegExp('http-equiv="Content-Security-Policy" content="[^"]*nonce-' + mcNonce[1]).test(mcHtml));

    section('A6  login page + passthrough + tunnels');
    const lgHtml = (await get(PX_PORT, '/login')).body.toString('utf8');
    ok('login page injected too', lgHtml.indexOf(MARKER) > 0);
    ok('login user-scalable=no replaced', /user-scalable=yes/.test(lgHtml) && !/user-scalable=no/.test(lgHtml));
    const css = await get(PX_PORT, '/style.css');
    ok('css passthrough untouched', css.body.toString('utf8') === CSS_BODY && !css.headers['x-s4-mobile']);
    const js = await get(PX_PORT, '/api.json');
    ok('json passthrough untouched', js.body.toString('utf8') === JSON_BODY);
    const echo = await wsEcho(PX_PORT, '/ws', 'S4-PING-PAYLOAD');
    ok('websocket upgrade tunnelled and echoed', echo.indexOf('101 Switching Protocols') > 0 && echo.indexOf('S4-PING-PAYLOAD') > 0);

    section('A7  evidence endpoints (/__s4mobile)');
    const s1 = JSON.parse((await get(PX_PORT, '/__s4mobile')).body.toString('utf8'));
    ok('status endpoint answers', s1.proxy === 's4-csproxy' && s1.version === '2.0', s1.version);
    ok('marker + zoom reported', s1.marker === MARKER && s1.zoom === ZOOM);
    ok('htmlInjected counted', s1.counters.htmlInjected >= 4, s1.counters.htmlInjected);
    ok('viewportStripped counted', s1.counters.viewportStripped >= 2, s1.counters.viewportStripped);
    ok('nonce counts recorded', s1.nonce.counts['csp-header'] >= 1 && s1.nonce.counts.generated >= 2, s1.nonce.counts);
    ok('shell sources are the shipped files', /s4-csmobile\.css$/.test(s1.shell.css.source) && /s4-csmobile\.js$/.test(s1.shell.js.source), s1.shell);
    const s2 = JSON.parse((await get(PX_PORT, '/__s4mobile?probe=1')).body.toString('utf8'));
    ok('upstream probe works', s2.upstreamProbe && s2.upstreamProbe.ok === true, s2.upstreamProbe);
    ok('/html returns the injected snippet', (await get(PX_PORT, '/__s4mobile/html')).body.toString('utf8').indexOf('data-s4="mob"') > 0);
    ok('/shell.css returns the stylesheet', (await get(PX_PORT, '/__s4mobile/shell.css')).body.toString('utf8').indexOf('.monaco-workbench') > 0);
    ok('/shell.js returns the shell', (await get(PX_PORT, '/__s4mobile/shell.js')).body.toString('utf8').indexOf('__s4mob') > 0);
    const rp = await post(PX_PORT, '/__s4mobile/report', JSON.stringify({ v: '2.0', probe: 'harness' }));
    ok('report POST accepted', rp.status === 200 && /"ok":\s*true/.test(rp.body));
    const s3 = JSON.parse((await get(PX_PORT, '/__s4mobile')).body.toString('utf8'));
    ok('last browser report stored', s3.lastBrowserReport && s3.lastBrowserReport.probe === 'harness');
    ok('report written to the state dir', fs.existsSync(path.join(stateDir, 'mobile-report.json')));
    ok('proxy log is pure ASCII English', !/[^\x00-\x7F]/.test(plog) && plog.indexOf('listening on') > 0);

    section('C   CSS-only resilience (script blocked by CSP)');
    ok('zoom survives without any JS', /<style[^>]*data-s4="css"[^>]*>[\s\S]*?\.monaco-workbench\s*\{[^}]*zoom:\s*var\(--s4-zoom\)/.test(html));
    ok('viewport unlock survives without any JS', /<meta name="viewport" content="[^"]*user-scalable=yes/.test(html));

    /* ------------------------------------------------ Part B: jsdom shell */
    section('B   mobile shell in jsdom (Replit-like dock, actions, report)');
    const jsdomMod = NO_JSDOM ? null : loadJsdom();
    if (!jsdomMod) {
      skipped('Part B (jsdom)', NO_JSDOM ? '--no-jsdom' : 'jsdom not installed: npm install jsdom');
    } else {
      const { JSDOM, VirtualConsole } = jsdomMod;
      const m = new RegExp('(<meta name="' + MARKER + '"[\\s\\S]*?<script[^>]*data-s4="mob"[^>]*>[\\s\\S]*?<\\/script>)').exec(html);
      ok('injected snippet extracted from the live page', !!m);
      const snippet = m ? m[1].replace(/<script([^>]*)>/, '<script>') : '';

      const MOCK = ''
        + '<div class="monaco-workbench">'
        + '  <div class="part titlebar"><div class="command-center">CC</div></div>'
        + '  <div class="part activitybar">'
        + '    <a id="workbench.view.explorer" class="action-item"></a>'
        + '    <a id="workbench.view.search" class="action-item"></a>'
        + '    <a id="workbench.view.scm" class="action-item"></a>'
        + '  </div>'
        + '  <div class="part sidebar"><div class="explorer-folders-view" style="display:none"></div></div>'
        + '  <div class="part editor"><div class="editor-instance"><div class="monaco-editor">'
        + '    <textarea class="inputarea"></textarea></div></div></div>'
        + '  <div class="part panel" style="display:none"><div class="pane-body"><div class="xterm" style="display:none">'
        + '    <textarea class="xterm-helper-textarea"></textarea></div></div></div>'
        + '  <div class="quick-input-widget" style="display:none"><input class="input" type="text">'
        + '    <div class="quick-input-list"><div class="monaco-list">'
        + '    <div class="monaco-list-row">Terminal: Create New Terminal</div>'
        + '    <div class="monaco-list-row">View: Toggle Terminal</div>'
        + '    </div></div></div>'
        + '</div>';

      /* a miniature VS Code: reacts to the same signals as the real one */
      const SHIM = ''
        + '<script>window.CSS={supports:function(p){return p==="zoom";}};'
        + 'window.__hits=[];'
        + 'document.addEventListener("keydown",function(e){'
        + '  window.__hits.push("key:"+(e.ctrlKey?"C":"")+(e.shiftKey?"S":"")+(e.key||""));'
        + '  if(e.ctrlKey&&e.shiftKey&&(e.key==="P"||e.key==="p")){document.querySelector(".quick-input-widget").style.display="block";}'
        + '  if(e.key==="Escape"){var q=document.querySelector(".quick-input-widget");if(q)q.style.display="none";}'
        + '},true);'
        + 'function shimDom(){'
        + 'var ex=document.getElementById("workbench.view.explorer");'
        + 'ex.addEventListener("mousedown",function(){ex.className="action-item checked";'
        + '  document.querySelector(".explorer-folders-view").style.display="block";window.__hits.push("click:explorer");});'
        + 'Array.prototype.forEach.call(document.querySelectorAll(".quick-input-list .monaco-list-row"),function(r){'
        + '  r.addEventListener("mousedown",function(){'
        + '    document.querySelector(".quick-input-widget").style.display="none";'
        + '    document.querySelector(".part.panel").style.display="block";'
        + '    document.querySelector(".xterm").style.display="block";'
        + '    window.__hits.push("palette-row:"+r.textContent);});});'
        + 'document.querySelector(".command-center").addEventListener("mousedown",function(){'
        + '  document.querySelector(".quick-input-widget").style.display="block";window.__hits.push("click:command-center");});'
        + '}'
        + 'if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",shimDom)}else{shimDom()}'
        + '</scr' + 'ipt>';

      const vc = new VirtualConsole();
      const domErrors = [];
      vc.on('jsdomError', (e) => domErrors.push(String(e.message || e)));
      vc.on('error', () => {});
      const dom = new JSDOM('<!doctype html><html><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">'
        + SHIM + snippet + '</head><body aria-label="">' + MOCK + '</body></html>', {
        runScripts: 'dangerously', pretendToBeVisual: true,
        url: 'http://127.0.0.1:' + PX_PORT + '/', virtualConsole: vc
      });
      const w = dom.window;
      await sleep(500);
      const mob = w.__s4mob;
      ok('window.__s4mob exists', !!mob);
      ok('shell version 2.0', mob && mob.version === '2.0', mob && mob.version);
      ok('shell booted (state.ready)', mob && mob.state.ready === true);
      ok('CSS.supports zoom detected', mob && mob.state.zoomSupported === true, mob && mob.state.zoomSupported);
      ok('no dom errors during boot', domErrors.length === 0, domErrors.slice(0, 3));
      ok('exactly one dock (no double boot)', w.document.querySelectorAll('#s4mob-dock').length === 1,
        w.document.querySelectorAll('#s4mob-dock .s4-tab').length);
      const vp = w.document.querySelector('meta[name="viewport"]');
      ok('jsdom viewport meta rewritten to user-scalable=yes', !!vp && /user-scalable=yes/.test(vp.content) && !/user-scalable=no/.test(vp.content), vp && vp.content);
      const tabs = w.document.querySelectorAll('#s4mob-dock .s4-tab');
      ok('bottom dock built with 7 tabs', tabs.length === 7, tabs.length);
      const labels = Array.prototype.map.call(tabs, (t) => (t.querySelector('.s4-lbl') || t).textContent);
      ok('tabs are Files/Search/Git/Terminal/Output/Editor/More', labels.join(',') === 'Files,Search,Git,Terminal,Output,Editor,More', labels.join(','));
      ok('top bar built', !!w.document.getElementById('s4mob-top') && w.document.querySelectorAll('#s4mob-top .s4-btn').length >= 6);
      const zv = w.document.getElementById('s4mob-zoomval');
      ok('zoom readout shows 130%', !!zv && zv.textContent === '130%', zv && zv.textContent);
      const keys = w.document.querySelectorAll('#s4mob-keys .s4-key');
      ok('extra-keys row built (>= 40 keys)', keys.length >= 40, keys.length);
      const keyLabels = Array.prototype.map.call(keys, (k) => k.textContent);
      ok('extra keys include Esc/Tab/Ctrl/arrows/Enter and symbols',
        ['Esc', 'Tab', 'Ctrl', 'Alt', '\u2190', '\u2192', 'Enter', '/', '$', '{', '`'].every((x) => keyLabels.indexOf(x) >= 0), keyLabels.length);
      const rootStyle = w.document.documentElement.style;
      ok('bar height vars applied to :root', rootStyle.getPropertyValue('--s4-dock-h') === '52px' && rootStyle.getPropertyValue('--s4-keys-h') === '44px',
        [rootStyle.getPropertyValue('--s4-dock-h'), rootStyle.getPropertyValue('--s4-keys-h')]);
      ok('zoom vars applied to :root', rootStyle.getPropertyValue('--s4-zoom') === '1.3' && rootStyle.getPropertyValue('--s4-inv') === '0.769231');
      ok('.monaco-workbench got an inline zoom', w.document.querySelector('.monaco-workbench').style.zoom === '1.3');

      function tabClick(label) {
        for (const t of tabs) {
          const txt = (t.querySelector('.s4-lbl') || t).textContent;
          if (txt === label) { t.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
        }
        return false;
      }
      ok('clicking the Files tab is wired', tabClick('Files'));
      await sleep(800);
      ok('Files tab clicked the real #workbench.view.explorer node', w.__hits.indexOf('click:explorer') >= 0, w.__hits);
      ok('Files action verified ok by the shell', /:ok$/.test(mob.state.acts.files || ''), mob.state.acts.files);
      ok('Files tab marked active', w.document.querySelector('.s4-tab[data-tab="files"]').classList.contains('s4-on'));

      ok('clicking the Terminal tab is wired', tabClick('Terminal'));
      await sleep(2000);
      ok('palette opened (synthetic Ctrl+Shift+P or a real click)',
        w.__hits.some((h) => h === 'key:CSp' || h === 'key:CSP') || w.__hits.indexOf('click:command-center') >= 0, w.__hits);
      ok('palette row was clicked', w.__hits.some((h) => /^palette-row:/.test(h)), w.__hits);
      ok('Terminal action verified ok', /:ok$/.test(mob.state.acts.term || ''), mob.state.acts.term);
      ok('terminal pane visible after the action', w.document.querySelector('.xterm').style.display === 'block');

      function keyClick(label) {
        for (const k of w.document.querySelectorAll('#s4mob-keys .s4-key')) {
          if (k.textContent === label) { k.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); return true; }
        }
        return false;
      }
      w.__hits.length = 0;
      ok('Esc key found in the extra-keys row', keyClick('Esc'));
      await sleep(80);
      ok('Esc dispatched a real keydown', w.__hits.indexOf('key:Escape') >= 0, w.__hits);
      ok('Esc key press counted', (mob.state.acts['key:Esc'] || 0) === 1, mob.state.acts['key:Esc']);

      mob.zoom(1.8);
      await sleep(80);
      ok('zoom(1.8) updates the CSS var', rootStyle.getPropertyValue('--s4-zoom') === '1.8');
      ok('zoom(1.8) updates the inverse var', rootStyle.getPropertyValue('--s4-inv') === '0.555556', rootStyle.getPropertyValue('--s4-inv'));
      ok('zoom(1.8) updates the readout', w.document.getElementById('s4mob-zoomval').textContent === '180%');
      mob.zoom(9);
      ok('zoom clamped to the max', rootStyle.getPropertyValue('--s4-zoom') === '3');
      ok('zoom persisted to localStorage', w.localStorage.getItem('s4-cs-zoom') === '3');

      tabClick('More');
      await sleep(100);
      ok('More opens the sheet', w.document.getElementById('s4mob-sheet').classList.contains('s4-open'));
      ok('sheet has >= 12 action cells', w.document.querySelectorAll('#s4mob-sheet .s4-cell').length >= 12);
      mob.bars(false);
      await sleep(150);
      ok('hiding bars zeroes the dock height var', rootStyle.getPropertyValue('--s4-dock-h') === '0px');
      ok('restore handle becomes visible', w.document.getElementById('s4mob-handle').style.display === 'block');
      mob.bars(true);
      await sleep(150);
      ok('bars restored', rootStyle.getPropertyValue('--s4-dock-h') === '52px');

      await sleep(2500);
      const s4 = JSON.parse((await get(PX_PORT, '/__s4mobile')).body.toString('utf8'));
      const br = s4.lastBrowserReport;
      ok('shell posted its own report to the proxy', !!br && br.v === '2.0', br && br.v);
      ok('report says the dock has 7 tabs', br && br.tabs === 7, br && br.tabs);
      ok('report says >= 40 extra keys', br && br.extraKeys >= 40, br && br.extraKeys);
      ok('report carries the verified action log', br && br.acts && /:ok$/.test(br.acts.files || '') && /:ok$/.test(br.acts.term || ''), br && br.acts);
      ok('report says the workbench was found', br && br.workbench === true);
      ok('shell had no internal errors', br && (!br.errs || br.errs.length === 0), br && br.errs);
      ok('no jsdom errors overall', domErrors.length === 0, domErrors.slice(0, 3));
      w.close();
    }
  } catch (e) {
    fail++;
    failures.push('HARNESS EXCEPTION');
    console.log('  EXCEPTION ' + ((e && e.stack) || e));
    console.log('--- proxy log ---\n' + plog.slice(-3000));
  } finally {
    try { child.kill('SIGTERM'); } catch (e) {}
    try { upstream.close(); } catch (e) {}
    if (!KEEP) { try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (e) {} }
  }

  console.log('\n========================================');
  console.log('passed=' + pass + '  failed=' + fail + '  skipped=' + skip);
  if (fail) { console.log('failed checks: ' + failures.join(' | ')); console.log('TESTS_FAILED'); process.exit(1); }
  console.log('ALL_TESTS_PASSED');
  process.exit(0);
})();
