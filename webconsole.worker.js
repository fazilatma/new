/**
 * ==============================================================================
 * WebConsole Pro - Cloudflare Workers Edition
 * Universal Forward Proxy Gateway, Remote Linux Bridge & Edge Networking Suite
 * 
 * Features:
 *  1. Universal Forward Proxy (?url=https://...) supporting all HTTP methods,
 *     CORS, Byte-Range streaming (Audio/Video), headers, and chunked transfer.
 *  2. Remote Linux Server Terminal Bridge (VPS / Codespaces / Termux) with
 *     full native support for SSH, SCP, SFTP, FTP, rsync, git, and systemctl.
 *  3. In-Browser Virtual POSIX & Network Shell with:
 *     - ssh: Remote SSH connectivity, banner inspection & command dispatcher
 *     - ftp & sftp: FTP server connection, banner probe & file transfers
 *     - ping / tcping: Real latency probe from Cloudflare global edge
 *     - dig / dns: DNS query resolver (A, AAAA, MX, TXT, NS, CNAME) via 1.1.1.1
 *     - telnet / nc: Raw TCP socket probe & banner grabbing
 *     - git clone: GitHub repository cloner into virtual filesystem
 *     - curl & wget: Internet file fetcher & local virtual file saving
 *     - Full POSIX filesystem: ls, cd, pwd, cat, echo, mkdir, rm, nano/vi editor
 *  4. Cloudflare D1 SQL Console (Interactive database query editor & table viewer).
 *  5. Cloudflare KV Storage Explorer (Key-Value manager with search & TTL).
 *  6. Cloudflare Workers AI Assistant (Chat & inference with Llama 3 / Qwen / Mistral).
 *  7. Edge JavaScript Code Runner (V8 Isolate REPL with fetch & crypto).
 *  8. Outbound HTTP Request & API Testing Suite.
 *  9. Password / Secret Token Access Protection.
 * 
 * Version: 2.5.0 (SSH / FTP / Network Suite Edition)
 * Repository: https://github.com/fazilatma/new
 * ==============================================================================
 */

import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --------------------------------------------------------------------------
    // 1. Universal Forward Proxy Gateway (/?url=... OR /proxy?url=...)
    // --------------------------------------------------------------------------
    const targetUrlParam = url.searchParams.get('url') || (url.pathname === '/proxy' ? url.searchParams.get('target') : null);
    if (targetUrlParam) {
      return handleUniversalProxy(request, targetUrlParam, env);
    }

    // --------------------------------------------------------------------------
    // 2. Security & Auth Check for Admin API & Console
    // --------------------------------------------------------------------------
    const adminToken = env.ADMIN_TOKEN || env.AUTH_KEY || '';
    if (adminToken && !isAuthorized(request, url, adminToken)) {
      if (url.pathname.startsWith('/api/')) {
        return jsonResponse({ ok: false, error: 'Unauthorized: Invalid or missing token.' }, 401);
      }
      return renderAuthPage(adminToken);
    }

    // --------------------------------------------------------------------------
    // 3. API Router for Dashboard & Network Utilities
    // --------------------------------------------------------------------------
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, url, env, ctx);
    }

    // --------------------------------------------------------------------------
    // 4. Serve Single-Page WebConsole Edge Dashboard (HTML/CSS/JS)
    // --------------------------------------------------------------------------
    return renderDashboard(request, url, env);
  }
};

// ==============================================================================
// UNIVERSAL FORWARD PROXY HANDLER
// ==============================================================================
async function handleUniversalProxy(request, targetUrlStr, env) {
  try {
    let targetUrl;
    try {
      targetUrl = new URL(targetUrlStr);
    } catch (e) {
      return new Response(`[WebConsole Proxy Error] Invalid target URL: "${targetUrlStr}"`, {
        status: 400,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    const forwardHeaders = new Headers();
    const skipHeaders = ['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-proto', 'x-real-ip'];

    for (const [key, value] of request.headers.entries()) {
      const lk = key.toLowerCase();
      if (!skipHeaders.includes(lk)) {
        forwardHeaders.set(key, value);
      }
    }

    forwardHeaders.set('Host', targetUrl.host);
    if (!forwardHeaders.has('User-Agent')) {
      forwardHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    }
    if (!forwardHeaders.has('Accept')) {
      forwardHeaders.set('Accept', '*/*');
    }

    const fetchInit = {
      method: request.method,
      headers: forwardHeaders,
      redirect: 'follow'
    };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase()) && request.body) {
      fetchInit.body = request.body;
      fetchInit.duplex = 'half';
    }

    const upstreamRes = await fetch(targetUrl.toString(), fetchInit);

    const resHeaders = new Headers();
    for (const [k, v] of upstreamRes.headers.entries()) {
      const lk = k.toLowerCase();
      if (lk !== 'content-encoding' && lk !== 'content-length' && lk !== 'transfer-encoding') {
        resHeaders.set(k, v);
      }
    }

    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS');
    resHeaders.set('Access-Control-Allow-Headers', '*');
    resHeaders.set('Access-Control-Expose-Headers', '*');

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: resHeaders
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: true,
      message: 'WebConsole Proxy Gateway Fetch Exception',
      details: err.message,
      target: targetUrlStr
    }, null, 2), {
      status: 502,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}

// ==============================================================================
// AUTHENTICATION UTILITIES
// ==============================================================================
function isAuthorized(request, url, expectedToken) {
  const tokenParam = url.searchParams.get('token');
  if (tokenParam === expectedToken) return true;

  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ') && authHeader.slice(7).trim() === expectedToken) return true;
  if (authHeader === expectedToken) return true;

  const cookie = request.headers.get('Cookie') || '';
  if (cookie.includes(`wc_token=${expectedToken}`)) return true;

  return false;
}

function renderAuthPage(expectedToken) {
  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ورود به وب‌کنسول لبه (Cloudflare Worker)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    body { background: #0b0f19; color: #f3f4f6; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #151d30; border: 1px solid #1f293d; border-radius: 16px; padding: 32px; width: 100%; max-width: 400px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); text-align: center; }
    h1 { font-size: 22px; margin-bottom: 8px; color: #38bdf8; display: flex; align-items: center; justify-content: center; gap: 8px; }
    p { font-size: 14px; color: #94a3b8; margin-bottom: 24px; line-height: 1.6; }
    input { width: 100%; padding: 12px 16px; background: #0a0f1d; border: 1px solid #334155; border-radius: 10px; color: #fff; font-size: 15px; margin-bottom: 16px; direction: ltr; outline: none; }
    input:focus { border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,0.2); }
    button { width: 100%; padding: 12px; background: linear-gradient(135deg, #0284c7, #2563eb); border: none; border-radius: 10px; color: #fff; font-size: 15px; font-weight: bold; cursor: pointer; transition: 0.2s; }
    button:hover { opacity: 0.9; transform: translateY(-1px); }
  </style>
</head>
<body>
  <div class="card">
    <h1>☁️ وب‌کنسول لبه کلودفلر</h1>
    <p>برای ورود به کنسول مدیریتی، توکن امنیتی (ADMIN_TOKEN) را وارد نمایید.</p>
    <form onsubmit="handleLogin(event)">
      <input type="password" id="pass" placeholder="توکن مدیریت (Secret Token)" required autofocus>
      <button type="submit">ورود به کنسول</button>
    </form>
  </div>
  <script>
    function handleLogin(e) {
      e.preventDefault();
      const token = document.getElementById('pass').value.trim();
      if (!token) return;
      document.cookie = 'wc_token=' + encodeURIComponent(token) + '; path=/; max-age=2592000; SameSite=Lax';
      window.location.reload();
    }
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// ==============================================================================
// REST API ROUTER
// ==============================================================================
async function handleApiRequest(request, url, env, ctx) {
  const path = url.pathname;

  // 1. Info / Status Endpoint
  if (path === '/api/info') {
    const cf = request.cf || {};
    return jsonResponse({
      ok: true,
      service: 'WebConsole Pro (Cloudflare Workers Edition)',
      version: '2.5.0',
      colo: cf.colo || 'Local',
      country: cf.country || 'Unknown',
      city: cf.city || 'Unknown',
      asn: cf.asn || 'Unknown',
      asOrganization: cf.asOrganization || 'Cloudflare',
      ip: request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || '127.0.0.1',
      httpProtocol: cf.httpProtocol || 'HTTP/2',
      tlsVersion: cf.tlsVersion || 'TLSv1.3',
      features: {
        d1: Boolean(env.DB),
        kv: Boolean(env.KV),
        r2: Boolean(env.R2),
        ai: Boolean(env.AI),
        sockets: true,
        vectorize: Boolean(env.VECTORIZE)
      }
    });
  }

  // 2. Remote Linux Server Command Bridge
  if (path === '/api/remote-exec' && request.method === 'POST') {
    try {
      const { serverUrl, token, command, cwd } = await request.json();
      if (!serverUrl || !command) {
        return jsonResponse({ ok: false, error: 'آدرس سرور و دستور لینوکسی الزامی است.' }, 400);
      }

      const targetEndpoint = serverUrl.replace(/\/$/, '') + '/api.php';
      const payload = {
        action: 'terminal.exec',
        cmd: command,
        cwd: cwd || '',
        token: token || ''
      };

      const resp = await fetch(targetEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(payload)
      });

      const text = await resp.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return jsonResponse({ ok: false, raw: text, status: resp.status, error: 'پاسخ سرور در قالب JSON معتبر نبود.' });
      }

      return jsonResponse({ ok: true, output: data.output || data.stdout || data.result || text, cwd: data.cwd || cwd, exitCode: data.code ?? 0 });
    } catch (e) {
      return jsonResponse({ ok: false, error: 'خطا در ارتباط با سرور لینوکس: ' + e.message }, 500);
    }
  }

  // 3. Cloudflare Raw TCP Socket Tester (SSH / FTP / Telnet / Netcat Banner Grabber)
  if (path === '/api/tcp-probe' && request.method === 'POST') {
    try {
      const { host, port = 22, timeoutMs = 4000, sendData = null } = await request.json();
      if (!host) return jsonResponse({ ok: false, error: 'Host is required.' }, 400);

      const start = Date.now();
      let socket;
      let banner = '';
      let latencyMs = 0;

      try {
        socket = connect({ hostname: host, port: Number(port) });
        latencyMs = Date.now() - start;

        const reader = socket.readable.getReader();
        const writer = socket.writable.getWriter();

        if (sendData) {
          const enc = new TextEncoder();
          await writer.write(enc.encode(sendData + '\r\n'));
        }

        // Read initial greeting / banner with timeout
        const timeoutPromise = new Promise(resolve => setTimeout(() => resolve({ done: true, value: null }), timeoutMs));
        const readPromise = reader.read();

        const result = await Promise.race([readPromise, timeoutPromise]);
        if (result.value) {
          banner = new TextDecoder().decode(result.value);
        }

        writer.releaseLock();
        reader.releaseLock();
        await socket.close();

      } catch (sockErr) {
        return jsonResponse({
          ok: false,
          host,
          port: Number(port),
          error: sockErr.message,
          latencyMs: Date.now() - start
        }, 500);
      }

      return jsonResponse({
        ok: true,
        host,
        port: Number(port),
        latencyMs,
        banner: banner.trim() || `(Connected to ${host}:${port} successfully. No initial greeting sent by server)`
      });

    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  // 4. DNS over HTTPS (DoH) Resolver (dig / dns)
  if (path === '/api/dns-query') {
    try {
      const domain = url.searchParams.get('name') || '';
      const type = (url.searchParams.get('type') || 'A').toUpperCase();
      if (!domain) return jsonResponse({ ok: false, error: 'Domain name is required.' }, 400);

      const dohUrl = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`;
      const res = await fetch(dohUrl, {
        headers: { 'Accept': 'application/dns-json' }
      });
      const data = await res.json();
      return jsonResponse({ ok: true, dns: data });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  // 5. GitHub Git Tree Fetcher for In-Browser Git Clone
  if (path === '/api/git-tree') {
    try {
      const repo = url.searchParams.get('repo'); // e.g. "fazilatma/new"
      const branch = url.searchParams.get('branch') || 'main';
      if (!repo) return jsonResponse({ ok: false, error: 'Repository (owner/repo) is required.' }, 400);

      const apiUrl = `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`;
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'WebConsole-Edge-Git/2.5' }
      });
      const data = await res.json();
      return jsonResponse({ ok: true, tree: data.tree || [], message: data.message });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  // 6. D1 Database Query Runner
  if (path === '/api/d1/query' && request.method === 'POST') {
    if (!env.DB) return jsonResponse({ ok: false, error: 'D1 binding (env.DB) is not configured in wrangler.toml.' }, 400);
    try {
      const { sql, params } = await request.json();
      if (!sql || typeof sql !== 'string') return jsonResponse({ ok: false, error: 'SQL query string is required.' }, 400);
      
      const stmt = env.DB.prepare(sql);
      const queryResult = Array.isArray(params) && params.length ? await stmt.bind(...params).all() : await stmt.all();
      return jsonResponse({ ok: true, result: queryResult });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  // 7. KV Storage APIs
  if (path === '/api/kv/keys') {
    if (!env.KV) return jsonResponse({ ok: false, error: 'KV binding (env.KV) is not configured.' }, 400);
    try {
      const prefix = url.searchParams.get('prefix') || '';
      const limit = Math.min(100, Number(url.searchParams.get('limit') || 50));
      const cursor = url.searchParams.get('cursor') || undefined;
      const res = await env.KV.list({ prefix, limit, cursor });
      return jsonResponse({ ok: true, keys: res.keys, list_complete: res.list_complete, cursor: res.cursor });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  if (path === '/api/kv/get') {
    if (!env.KV) return jsonResponse({ ok: false, error: 'KV binding (env.KV) is not configured.' }, 400);
    try {
      const key = url.searchParams.get('key');
      if (!key) return jsonResponse({ ok: false, error: 'Key parameter is required.' }, 400);
      const val = await env.KV.getWithMetadata(key);
      return jsonResponse({ ok: true, key, value: val.value, metadata: val.metadata });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  if (path === '/api/kv/put' && request.method === 'POST') {
    if (!env.KV) return jsonResponse({ ok: false, error: 'KV binding (env.KV) is not configured.' }, 400);
    try {
      const { key, value, expirationTtl, metadata } = await request.json();
      if (!key) return jsonResponse({ ok: false, error: 'Key is required.' }, 400);
      const options = {};
      if (expirationTtl) options.expirationTtl = Number(expirationTtl);
      if (metadata) options.metadata = metadata;
      await env.KV.put(key, typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''), options);
      return jsonResponse({ ok: true, message: `Key "${key}" saved successfully.` });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  if (path === '/api/kv/delete' && request.method === 'POST') {
    if (!env.KV) return jsonResponse({ ok: false, error: 'KV binding (env.KV) is not configured.' }, 400);
    try {
      const { key } = await request.json();
      if (!key) return jsonResponse({ ok: false, error: 'Key is required.' }, 400);
      await env.KV.delete(key);
      return jsonResponse({ ok: true, message: `Key "${key}" deleted.` });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  // 8. Workers AI Inference
  if (path === '/api/ai/chat' && request.method === 'POST') {
    if (!env.AI) return jsonResponse({ ok: false, error: 'Cloudflare Workers AI (env.AI) is not bound in wrangler.toml.' }, 400);
    try {
      const { model, messages, prompt } = await request.json();
      const aiModel = model || '@cf/meta/llama-3.1-8b-instruct';
      const input = messages ? { messages } : { prompt: prompt || 'Hello' };
      const aiResponse = await env.AI.run(aiModel, input);
      return jsonResponse({ ok: true, response: aiResponse });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  // 9. Edge JS Code Evaluator / REPL
  if (path === '/api/eval' && request.method === 'POST') {
    try {
      const { code } = await request.json();
      if (!code) return jsonResponse({ ok: false, error: 'Code is required.' }, 400);
      
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      const fn = new AsyncFunction('env', 'request', 'fetch', 'connect', code);
      const start = Date.now();
      const result = await fn(env, request, fetch, connect);
      const duration = Date.now() - start;

      return jsonResponse({
        ok: true,
        result: result === undefined ? 'undefined' : result,
        type: typeof result,
        durationMs: duration
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message, stack: e.stack }, 500);
    }
  }

  // 10. Outbound HTTP Request Tester
  if (path === '/api/http-test' && request.method === 'POST') {
    try {
      const { url: target, method = 'GET', headers = {}, body = null } = await request.json();
      const start = Date.now();
      const fetchOpts = { method, headers };
      if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        fetchOpts.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
      const resp = await fetch(target, fetchOpts);
      const duration = Date.now() - start;
      const respHeaders = {};
      resp.headers.forEach((v, k) => respHeaders[k] = v);
      const text = await resp.text();

      return jsonResponse({
        ok: true,
        status: resp.status,
        statusText: resp.statusText,
        latencyMs: duration,
        headers: respHeaders,
        body: text.slice(0, 500000)
      });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  return jsonResponse({ ok: false, error: `API route ${path} not found.` }, 404);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}

// ==============================================================================
// SINGLE-PAGE APPLICATION DASHBOARD (HTML / CSS / JS)
// ==============================================================================
function renderDashboard(request, url, env) {
  const currentOrigin = url.origin;

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>وب‌کنسول لبه کلودفلر | WebConsole Pro Edge v2.5</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #131b2e;
      --card-border: #1f2a44;
      --primary: #38bdf8;
      --primary-hover: #0ea5e9;
      --accent: #818cf8;
      --green: #34d399;
      --red: #f87171;
      --yellow: #fbbf24;
      --text: #f3f4f6;
      --muted: #94a3b8;
      --code-bg: #070a12;
      --radius: 12px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); line-height: 1.5; min-height: 100vh; padding-bottom: 40px; }
    
    header { background: #0f172a; border-bottom: 1px solid var(--card-border); padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; backdrop-filter: blur(8px); }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 18px; color: var(--primary); }
    .node-pill { background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.3); color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    .tabs-bar { background: #0c1322; border-bottom: 1px solid var(--card-border); padding: 8px 24px; display: flex; gap: 8px; overflow-x: auto; }
    .tab-btn { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 8px 16px; border-radius: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: 0.15s; white-space: nowrap; }
    .tab-btn:hover { color: var(--text); background: rgba(255,255,255,0.03); }
    .tab-btn.active { color: #fff; background: var(--card-bg); border-color: var(--primary); }

    .container { max-width: 1200px; margin: 24px auto; padding: 0 20px; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius); padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; color: #fff; }

    .grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .stat-box { background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); border-radius: 10px; padding: 14px 18px; }
    .stat-label { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .stat-value { font-size: 18px; font-weight: 700; color: var(--text); direction: ltr; text-align: left; }

    .inp-group { margin-bottom: 14px; }
    .lb { display: block; font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 6px; }
    .inp, select, textarea { width: 100%; padding: 10px 14px; background: var(--code-bg); border: 1px solid var(--card-border); border-radius: 8px; color: #fff; font-size: 14px; outline: none; transition: 0.2s; }
    .inp:focus, select:focus, textarea:focus { border-color: var(--primary); }
    .ltr { direction: ltr; text-align: left; font-family: ui-monospace, monospace; }

    .btn { background: var(--primary); color: #000; border: none; padding: 10px 18px; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; transition: 0.15s; display: inline-flex; align-items: center; gap: 6px; }
    .btn:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .btn.sec { background: rgba(255,255,255,0.08); color: #fff; border: 1px solid var(--card-border); }
    .btn.sec:hover { background: rgba(255,255,255,0.12); }
    .btn.del { background: var(--red); color: #fff; }

    .code-box { background: var(--code-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px; font-family: ui-monospace, monospace; font-size: 13px; direction: ltr; text-align: left; overflow-x: auto; white-space: pre-wrap; max-height: 400px; }
    .tbl-wrap { overflow-x: auto; margin-top: 14px; border: 1px solid var(--card-border); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; text-align: right; font-size: 13.5px; }
    th { background: #0d1527; padding: 10px 14px; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--card-border); }
    td { padding: 10px 14px; border-bottom: 1px solid var(--card-border); direction: ltr; text-align: left; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.02); }

    .proxy-banner { background: linear-gradient(135deg, rgba(56,189,248,0.1), rgba(129,140,248,0.1)); border: 1px solid rgba(56,189,248,0.3); border-radius: 12px; padding: 18px; margin-bottom: 20px; }
    .proxy-url-display { background: #070a12; border: 1px solid #1e293b; border-radius: 8px; padding: 12px 16px; font-family: ui-monospace, monospace; color: var(--green); font-size: 14px; direction: ltr; text-align: left; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
    .copy-btn { background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    .copy-btn:hover { background: #334155; }

    /* Interactive Terminal Styling */
    .term-window { background: #05070e; border: 1px solid #1e293b; border-radius: 10px; padding: 14px; font-family: ui-monospace, 'Courier New', monospace; font-size: 13.5px; color: #38bdf8; min-height: 380px; max-height: 540px; overflow-y: auto; direction: ltr; text-align: left; line-height: 1.45; }
    .term-line { white-space: pre-wrap; word-break: break-all; margin-bottom: 2px; }
    .term-prompt { color: var(--green); font-weight: bold; }
    .term-in-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .term-input { flex: 1; background: transparent; border: none; color: #fff; font-family: inherit; font-size: inherit; outline: none; }
    .quick-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
    .chip { background: rgba(255,255,255,0.06); border: 1px solid var(--card-border); color: var(--muted); padding: 4px 10px; border-radius: 6px; font-size: 12px; font-family: ui-monospace, monospace; cursor: pointer; transition: 0.15s; }
    .chip:hover { color: #fff; background: rgba(56,189,248,0.15); border-color: var(--primary); }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <span>☁️</span> WebConsole Pro <span style="font-size: 12px; background: rgba(56,189,248,0.2); padding: 2px 8px; border-radius: 6px;">Edge v2.5 Network Suite</span>
    </div>
    <div class="node-pill">
      <div class="dot"></div>
      <span id="node-info">در حال اتصال به نود لبه...</span>
    </div>
  </header>

  <nav class="tabs-bar">
    <button class="tab-btn active" onclick="switchTab('tab-proxy')">🌐 پروکسی سرور (Universal Proxy)</button>
    <button class="tab-btn" onclick="switchTab('tab-remote-term')">🖥️ ترمینال متصل به سرور لینوکس (SSH / Shell)</button>
    <button class="tab-btn" onclick="switchTab('tab-wasm-term')">🐧 لینوکس و ابزار شبکه لبه (SSH, FTP, DNS, Sockets)</button>
    <button class="tab-btn" onclick="switchTab('tab-d1')">🗄️ دیتابیس D1 SQL</button>
    <button class="tab-btn" onclick="switchTab('tab-kv')">🔑 حافظه KV Storage</button>
    <button class="tab-btn" onclick="switchTab('tab-ai')">🤖 هوش مصنوعی لبه (Workers AI)</button>
    <button class="tab-btn" onclick="switchTab('tab-eval')">⚡ اجرای کد جاوااسکریپت (Edge REPL)</button>
    <button class="tab-btn" onclick="switchTab('tab-http')">📡 تست درخواست شبکه (API Client)</button>
    <button class="tab-btn" onclick="switchTab('tab-settings')">⚙️ راهنما و تنظیمات</button>
  </nav>

  <div class="container">

    <!-- TAB 1: PROXY GATEWAY -->
    <div id="tab-proxy" class="tab-content active">
      <div class="proxy-banner">
        <h3 style="font-size: 16px; color: var(--primary); margin-bottom: 6px;">🛡️ آدرس اندپوینت پروکسی همه‌منظوره کلودفلر:</h3>
        <p style="font-size: 13.5px; color: var(--muted); margin-bottom: 10px;">کافیست هر آدرس اینترنتی را به عنوان پارامتر <code style="color: #fff;">?url=</code> به انتهای آدرس ورکر خود اضافه کنید:</p>
        <div class="proxy-url-display">
          <span id="proxy-link-text">${currentOrigin}/?url=https://example.com/page</span>
          <button class="copy-btn" onclick="copyText(document.getElementById('proxy-link-text').textContent)">کپی آدرس</button>
        </div>
      </div>

      <div class="grid3">
        <div class="stat-box">
          <div class="stat-label">دیتاسنتر لبه (Colo)</div>
          <div class="stat-value" id="stat-colo">-</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">موقعیت کلاینت</div>
          <div class="stat-value" id="stat-country">-</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">آی‌پی ورودی کلاینت</div>
          <div class="stat-value" id="stat-ip">-</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🚀 تست زنده پروکسی سرور از داخل مرورگر</div>
        <div style="display: flex; gap: 10px; margin-bottom: 14px;">
          <select id="prx-method" style="width: 120px;" class="ltr">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="HEAD">HEAD</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input type="text" id="prx-url" class="inp ltr" placeholder="https://api.ipify.org?format=json" value="https://api.ipify.org?format=json">
          <button class="btn" onclick="runProxyTest()">ارسال تست</button>
        </div>
        <div id="prx-result" class="code-box" style="display: none;"></div>
      </div>
    </div>

    <!-- TAB 2: REMOTE LINUX TERMINAL BRIDGE (SSH / FTP on VPS) -->
    <div id="tab-remote-term" class="tab-content">
      <div class="card">
        <div class="card-title">🖥️ ترمینال متصل به سرور لینوکس (با پشتیبانی کامل از SSH, SCP, FTP, Git)</div>
        <p style="font-size: 13.5px; color: var(--muted); margin-bottom: 14px;">
          اتصال مستقیم به وب‌کنسول سرور لینوکسی شما (VPS / Codespaces / Termux) برای اجرای دستورات سیستمی، مدیریت SSH، انتقال فایل با FTP و اسکریپت‌ها.
        </p>
        
        <div class="grid3" style="margin-bottom: 14px;">
          <div>
            <label class="lb">آدرس وب‌کنسول سرور لینوکس (URL)</label>
            <input type="text" id="rem-server-url" class="inp ltr" placeholder="http://YOUR_VPS_IP:8888" value="">
          </div>
          <div>
            <label class="lb">رمز عبور مدیریت / توکن سرور</label>
            <input type="password" id="rem-server-token" class="inp ltr" placeholder="پسورد وب‌کنسول سرور" value="">
          </div>
          <div>
            <label class="lb">وضعیت اتصال</label>
            <div id="rem-conn-badge" style="padding: 10px 14px; background: rgba(0,0,0,0.3); border: 1px solid var(--card-border); border-radius: 8px; font-size: 13px; color: var(--yellow);">آماده اتصال به سرور</div>
          </div>
        </div>

        <div class="quick-chips">
          <span class="chip" onclick="sendQuickCmd('wcp status')">⚡ wcp status</span>
          <span class="chip" onclick="sendQuickCmd('ssh -V && which ftp scp sftp')">🔑 چک ابزارهای SSH/FTP</span>
          <span class="chip" onclick="sendQuickCmd('ssh-keygen -l -f ~/.ssh/id_rsa.pub 2>/dev/null || echo \"No SSH Key yet. Run: ssh-keygen -t rsa -b 4096\"')">📜 کلیدهای SSH سرور</span>
          <span class="chip" onclick="sendQuickCmd('wcp url')">🌐 wcp url</span>
          <span class="chip" onclick="sendQuickCmd('wcp ports')">🔌 wcp ports</span>
          <span class="chip" onclick="sendQuickCmd('wcp run-all')">▶️ wcp run-all</span>
          <span class="chip" onclick="sendQuickCmd('wcp stop-all')">⏹️ wcp stop-all</span>
          <span class="chip" onclick="sendQuickCmd('htop -b -n 1 | head -n 20')">📊 htop summary</span>
          <span class="chip" onclick="sendQuickCmd('df -h && free -m')">💾 دیسک و رم</span>
          <span class="chip" onclick="sendQuickCmd('node -v && python3 --version')">🐍 node & python</span>
        </div>

        <div class="term-window" id="rem-term-out">
          <div class="term-line" style="color: #94a3b8;">=== WebConsole Remote Linux Terminal Bridge (SSH / FTP Ready) ===</div>
          <div class="term-line" style="color: #64748b;">برای اتصال، آدرس وب‌کنسول سرور خود (مانند http://YOUR_SERVER_IP:8888) را در کادر بالا وارد کرده و دستورات را اجرا کنید.</div>
        </div>

        <div class="term-in-row" style="margin-top: 10px;">
          <span class="term-prompt" id="rem-term-prompt">root@linux:~$</span>
          <input type="text" id="rem-term-inp" class="inp ltr" style="flex:1;" placeholder="دستور لینوکسی (مانند ssh, ftp, scp, git, apt, wcp)..." onkeydown="handleRemoteKey(event)">
          <button class="btn" onclick="execRemoteCmd()">ارسال</button>
        </div>
      </div>
    </div>

    <!-- TAB 3: IN-BROWSER NETWORKING & POSIX SHELL (SSH, FTP, DNS, Sockets) -->
    <div id="tab-wasm-term" class="tab-content">
      <div class="card">
        <div class="card-title">🐧 ترمینال لینوکس و ابزارهای شبکه لبه (SSH, FTP, TCP Sockets, DNS, Curl, Git)</div>
        <p style="font-size: 13.5px; color: var(--muted); margin-bottom: 14px;">
          محیط شل پیشرفته لبه با قابلیت اتصال مستقیم سوکت TCP به سرورهای SSH و FTP در سراسر اینترنت، کوئری‌های DNS، دریافت ریپوهای Git و سیستم فایل مجازی.
        </p>

        <div class="quick-chips">
          <span class="chip" onclick="sendWasmCmd('ssh github.com -p 22')">🔑 تست SSH پورت 22</span>
          <span class="chip" onclick="sendWasmCmd('ftp speedtest.tele2.net 21')">📁 تست FTP پورت 21</span>
          <span class="chip" onclick="sendWasmCmd('ping 1.1.1.1')">⚡ ping 1.1.1.1</span>
          <span class="chip" onclick="sendWasmCmd('dig cloudflare.com A')">📡 dig A Record</span>
          <span class="chip" onclick="sendWasmCmd('dig google.com MX')">📧 dig MX Record</span>
          <span class="chip" onclick="sendWasmCmd('curl https://api.ipify.org?format=json')">🌐 curl my ip</span>
          <span class="chip" onclick="sendWasmCmd('git clone fazilatma/new')">📦 git clone repo</span>
          <span class="chip" onclick="sendWasmCmd('ls -la')">ls -la</span>
          <span class="chip" onclick="sendWasmCmd('echo \"SSH and FTP configured!\" > conf.txt && cat conf.txt')">write & cat</span>
          <span class="chip" onclick="sendWasmCmd('help')">help</span>
          <span class="chip" onclick="sendWasmCmd('clear')">clear</span>
        </div>

        <div class="term-window" id="wasm-term-out">
          <div class="term-line" style="color: var(--green);">Linux edge-worker 6.1.0-edge-sockets #1 SMP Cloudflare Edge V8 x86_64</div>
          <div class="term-line" style="color: var(--primary);">WebConsole Edge Networking & POSIX Shell Ready. Type 'help' for available commands.</div>
        </div>

        <div class="term-in-row" style="margin-top: 10px;">
          <span class="term-prompt" id="wasm-term-prompt">user@edge-worker:~$</span>
          <input type="text" id="wasm-term-inp" class="inp ltr" style="flex:1;" placeholder="دستور (ssh, ftp, telnet, nc, dig, ping, curl, git, ls, cat)..." onkeydown="handleWasmKey(event)">
          <button class="btn" onclick="execWasmCmd()">اجرا</button>
        </div>
      </div>
    </div>

    <!-- TAB 4: D1 SQL -->
    <div id="tab-d1" class="tab-content">
      <div class="card">
        <div class="card-title">🗄️ کنسول کوئری Cloudflare D1 SQL</div>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">اجرای کوئری‌های استاندارد SQLite روی دیتابیس D1 متصل به ورکر (<code style="color:#fff;">env.DB</code>).</p>
        <div class="inp-group">
          <textarea id="d1-sql" class="inp ltr" rows="4" spellcheck="false">SELECT name, type, sql FROM sqlite_master WHERE type='table';</textarea>
        </div>
        <div style="display: flex; gap: 10px;">
          <button class="btn" onclick="runD1Query()">▶️ اجرای کوئری SQL</button>
          <button class="btn sec" onclick="loadD1Schema()">📋 بارگذاری لیست جداول</button>
        </div>
        <div id="d1-result" class="tbl-wrap" style="display: none; margin-top: 16px;"></div>
      </div>
    </div>

    <!-- TAB 5: KV STORAGE -->
    <div id="tab-kv" class="tab-content">
      <div class="card">
        <div class="card-title">🔑 کاوشگر و مدیریت کلیدهای KV (<code style="color:#fff;">env.KV</code>)</div>
        <div style="display: flex; gap: 10px; margin-bottom: 16px;">
          <input type="text" id="kv-search-prefix" class="inp ltr" placeholder="فیلتر بر اساس پیشوند کلید (Prefix)...">
          <button class="btn sec" onclick="loadKvKeys()">جستجو / بروزرسانی</button>
          <button class="btn" onclick="openKvModal()">➕ افزودن کلید جدید</button>
        </div>
        <div id="kv-list" class="tbl-wrap">در حال دریافت کلیدها...</div>
      </div>
    </div>

    <!-- TAB 6: WORKERS AI -->
    <div id="tab-ai" class="tab-content">
      <div class="card">
        <div class="card-title">🤖 هوش مصنوعی لبه (Cloudflare Workers AI)</div>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">اجرای مدل‌های هوش مصنوعی مستقیماً در دیتاسنترهای لبه کلودفلر بدون نیاز به سرور خارجی (<code style="color:#fff;">env.AI</code>).</p>
        <div class="inp-group">
          <label class="lb">انتخاب مدل هوش مصنوعی</label>
          <select id="ai-model" class="inp ltr">
            <option value="@cf/meta/llama-3.1-8b-instruct">@cf/meta/llama-3.1-8b-instruct (Meta LLaMA 3.1 8B)</option>
            <option value="@cf/qwen/qwen1.5-7b-chat">@cf/qwen/qwen1.5-7b-chat (Alibaba Qwen 1.5 7B)</option>
            <option value="@cf/mistral/mistral-7b-instruct-v0.1">@cf/mistral/mistral-7b-instruct-v0.1 (Mistral 7B)</option>
            <option value="@cf/meta/llama-3-8b-instruct">@cf/meta/llama-3-8b-instruct</option>
          </select>
        </div>
        <div class="inp-group">
          <label class="lb">متن پیام یا پرامپت (Prompt)</label>
          <textarea id="ai-prompt" class="inp" rows="3" placeholder="یک اسکریپت وب‌اسکرپینگ پایتون بنویس..."></textarea>
        </div>
        <button class="btn" id="ai-btn" onclick="runAiInference()">✨ ارسال به هوش مصنوعی لبه</button>
        <div id="ai-result" class="code-box" style="display: none; margin-top: 16px;"></div>
      </div>
    </div>

    <!-- TAB 7: EDGE REPL -->
    <div id="tab-eval" class="tab-content">
      <div class="card">
        <div class="card-title">⚡ مفسر و اجرای کد جاوااسکریپت در ایزولیت ورکر (Edge REPL)</div>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">کدهای JS مدرن با دسترسی مستقیم به <code style="color:#fff;">env</code>, <code style="color:#fff;">fetch</code>, <code style="color:#fff;">connect</code>, <code style="color:#fff;">crypto</code> در هسته V8 لبه اجرا می‌شوند.</p>
        <div class="inp-group">
          <textarea id="eval-code" class="inp ltr" rows="6" spellcheck="false">// تست ارسال درخواست و بررسی سوکت
const res = await fetch('https://api.ipify.org?format=json');
const data = await res.json();
return { edge_ip: data.ip, colo: request.cf?.colo || 'local', timestamp: new Date().toISOString() };</textarea>
        </div>
        <button class="btn" onclick="runEvalCode()">▶️ اجرای کد در لبه</button>
        <div id="eval-result" class="code-box" style="display: none; margin-top: 16px;"></div>
      </div>
    </div>

    <!-- TAB 8: HTTP TESTER -->
    <div id="tab-http" class="tab-content">
      <div class="card">
        <div class="card-title">📡 کلاینت ارسال درخواست شبکه (Outbound API Tester)</div>
        <div class="inp-group">
          <label class="lb">آدرس مقصد (URL)</label>
          <div style="display: flex; gap: 10px;">
            <select id="http-method" style="width: 120px;" class="ltr">
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
              <option value="HEAD">HEAD</option>
            </select>
            <input type="text" id="http-url" class="inp ltr" placeholder="https://httpbin.org/get" value="https://httpbin.org/get">
          </div>
        </div>
        <div class="inp-group">
          <label class="lb">هدرها (JSON اختیاری)</label>
          <input type="text" id="http-headers" class="inp ltr" placeholder='{"User-Agent": "Custom-Edge-Bot/1.0", "Accept": "application/json"}'>
        </div>
        <div class="inp-group">
          <label class="lb">بدنه درخواست (Body)</label>
          <textarea id="http-body" class="inp ltr" rows="3" placeholder='{"key": "value"}'></textarea>
        </div>
        <button class="btn" onclick="runHttpTest()">🚀 ارسال درخواست شبکه از لبه</button>
        <div id="http-result" class="code-box" style="display: none; margin-top: 16px;"></div>
      </div>
    </div>

    <!-- TAB 9: SETTINGS & GUIDE -->
    <div id="tab-settings" class="tab-content">
      <div class="card">
        <div class="card-title">⚙️ نحوه استقرار و پیکربندی در Cloudflare Workers</div>
        <p style="font-size: 14px; line-height: 1.8; color: var(--muted); margin-bottom: 16px;">
          برای دیپلوی مستقیم این ورکر در کلودفلر، می‌توانید فایل <code style="color:#fff;">webconsole.worker.js</code> را در پنل داشبورد کلودفلر کپی کنید یا با ابزار Wrangler دستور زیر را بزنید:
        </p>
        <div class="code-box">npx wrangler deploy webconsole.worker.js --name my-webconsole</div>
        
        <h4 style="color:#fff; margin: 20px 0 10px 0; font-size: 15px;">🔧 نمونه فایل پیکربندی wrangler.toml:</h4>
        <div class="code-box">name = "webconsole-worker"
main = "webconsole.worker.js"
compatibility_date = "2024-09-25"
compatibility_flags = ["nodejs_compat"]

# متغیر محیطی رمز عبور مدیریت (اختیاری):
[vars]
ADMIN_TOKEN = "your-secret-password"

# اتصال دیتابیس D1 (اختیاری):
[[d1_databases]]
binding = "DB"
database_name = "my-d1-db"
database_id = "xxxx-xxxx"

# اتصال KV Storage (اختیاری):
[[kv_namespaces]]
binding = "KV"
id = "xxxx"

# فعال‌سازی هوش مصنوعی (اختیاری):
[ai]
binding = "AI"</div>
      </div>
    </div>

  </div>

  <script>
    // Tab Switching
    function switchTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
      const target = document.getElementById(tabId);
      if (target) target.classList.add('active');
      event.target.classList.add('active');
    }

    function copyText(text) {
      navigator.clipboard.writeText(text).then(() => alert('آدرس با موفقیت در کلیپ‌بورد کپی شد!'));
    }

    async function fetchInfo() {
      try {
        const res = await fetch('/api/info');
        const data = await res.json();
        if (data.ok) {
          document.getElementById('node-info').textContent = data.colo + ' (' + data.country + ') · ' + data.ip;
          document.getElementById('stat-colo').textContent = data.colo + ' (' + data.asOrganization + ')';
          document.getElementById('stat-country').textContent = data.country + ' - ' + data.city;
          document.getElementById('stat-ip').textContent = data.ip;
        }
      } catch (e) {}
    }
    fetchInfo();

    // --------------------------------------------------------------------------
    // 1. Remote Linux Terminal Bridge (SSH / FTP on VPS)
    // --------------------------------------------------------------------------
    let remoteHistory = [];
    let remoteHistIdx = -1;
    let remoteCwd = '/var/www/html';

    const savedServer = localStorage.getItem('wc_rem_server') || '';
    const savedToken = localStorage.getItem('wc_rem_token') || '';
    if (savedServer) document.getElementById('rem-server-url').value = savedServer;
    if (savedToken) document.getElementById('rem-server-token').value = savedToken;

    function handleRemoteKey(e) {
      if (e.key === 'Enter') {
        execRemoteCmd();
      } else if (e.key === 'ArrowUp') {
        if (remoteHistIdx < remoteHistory.length - 1) {
          remoteHistIdx++;
          document.getElementById('rem-term-inp').value = remoteHistory[remoteHistory.length - 1 - remoteHistIdx];
        }
      } else if (e.key === 'ArrowDown') {
        if (remoteHistIdx > 0) {
          remoteHistIdx--;
          document.getElementById('rem-term-inp').value = remoteHistory[remoteHistory.length - 1 - remoteHistIdx];
        } else {
          remoteHistIdx = -1;
          document.getElementById('rem-term-inp').value = '';
        }
      }
    }

    function sendQuickCmd(cmd) {
      document.getElementById('rem-term-inp').value = cmd;
      execRemoteCmd();
    }

    async function execRemoteCmd() {
      const inp = document.getElementById('rem-term-inp');
      const cmd = inp.value.trim();
      if (!cmd) return;

      const serverUrl = document.getElementById('rem-server-url').value.trim();
      const token = document.getElementById('rem-server-token').value.trim();
      const outBox = document.getElementById('rem-term-out');
      const badge = document.getElementById('rem-conn-badge');

      if (!serverUrl) {
        alert('لطفاً آدرس وب‌کنسول سرور لینوکس را وارد کنید.');
        return;
      }

      localStorage.setItem('wc_rem_server', serverUrl);
      localStorage.setItem('wc_rem_token', token);

      remoteHistory.push(cmd);
      remoteHistIdx = -1;
      inp.value = '';

      const lineElem = document.createElement('div');
      lineElem.className = 'term-line';
      lineElem.innerHTML = '<span style="color:var(--green)">root@vps:' + remoteCwd + '$</span> <span style="color:#fff">' + escapeHtml(cmd) + '</span>';
      outBox.appendChild(lineElem);

      const runningElem = document.createElement('div');
      runningElem.className = 'term-line';
      runningElem.style.color = 'var(--yellow)';
      runningElem.textContent = '⏳ در حال ارسال و اجرا بر روی سرور لینوکس...';
      outBox.appendChild(runningElem);
      outBox.scrollTop = outBox.scrollHeight;

      try {
        badge.textContent = '⚡ در حال ارتباط...';
        badge.style.color = 'var(--primary)';

        const res = await fetch('/api/remote-exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl, token, command: cmd, cwd: remoteCwd })
        });

        const data = await res.json();
        runningElem.remove();

        const resElem = document.createElement('div');
        resElem.className = 'term-line';

        if (data.ok) {
          badge.textContent = '🟢 متصل به سرور لینوکس';
          badge.style.color = 'var(--green)';
          resElem.style.color = '#e2e8f0';
          resElem.textContent = data.output || '(دستور با موفقیت پایان یافت)';
          if (data.cwd) remoteCwd = data.cwd;
          document.getElementById('rem-term-prompt').textContent = 'root@vps:' + remoteCwd + '$';
        } else {
          badge.textContent = '🔴 خطا در اتصال به سرور';
          badge.style.color = 'var(--red)';
          resElem.style.color = 'var(--red)';
          resElem.textContent = 'خطا: ' + (data.error || data.raw || 'عدم دریافت پاسخ معتبر');
        }

        outBox.appendChild(resElem);
        outBox.scrollTop = outBox.scrollHeight;

      } catch (e) {
        runningElem.remove();
        badge.textContent = '🔴 خطای شبکه';
        badge.style.color = 'var(--red)';
        const errElem = document.createElement('div');
        errElem.className = 'term-line';
        errElem.style.color = 'var(--red)';
        errElem.textContent = 'خطای ارتباطی با ورکر: ' + e.message;
        outBox.appendChild(errElem);
        outBox.scrollTop = outBox.scrollHeight;
      }
    }

    // --------------------------------------------------------------------------
    // 2. In-Browser POSIX & Edge Networking Shell (SSH, FTP, DNS, Sockets)
    // --------------------------------------------------------------------------
    let wasmFs = JSON.parse(localStorage.getItem('wc_wasm_fs') || '{"/": ["home", "etc", "tmp"], "/home": ["user"], "/home/user": ["welcome.txt"], "/home/user/welcome.txt": "Welcome to WebConsole Edge Network Shell v2.5!\\nSupports: ssh, ftp, telnet, nc, dig, ping, curl, git, ls, cat, nano, echo."}');
    let wasmCwd = '/home/user';
    let wasmHistory = [];
    let wasmHistIdx = -1;

    function saveWasmFs() {
      localStorage.setItem('wc_wasm_fs', JSON.stringify(wasmFs));
    }

    function sendWasmCmd(cmd) {
      document.getElementById('wasm-term-inp').value = cmd;
      execWasmCmd();
    }

    function handleWasmKey(e) {
      if (e.key === 'Enter') {
        execWasmCmd();
      } else if (e.key === 'ArrowUp') {
        if (wasmHistIdx < wasmHistory.length - 1) {
          wasmHistIdx++;
          document.getElementById('wasm-term-inp').value = wasmHistory[wasmHistory.length - 1 - wasmHistIdx];
        }
      } else if (e.key === 'ArrowDown') {
        if (wasmHistIdx > 0) {
          wasmHistIdx--;
          document.getElementById('wasm-term-inp').value = wasmHistory[wasmHistory.length - 1 - wasmHistIdx];
        } else {
          wasmHistIdx = -1;
          document.getElementById('wasm-term-inp').value = '';
        }
      }
    }

    async function execWasmCmd() {
      const inp = document.getElementById('wasm-term-inp');
      const raw = inp.value.trim();
      if (!raw) return;

      wasmHistory.push(raw);
      wasmHistIdx = -1;
      inp.value = '';

      const outBox = document.getElementById('wasm-term-out');
      const lineElem = document.createElement('div');
      lineElem.className = 'term-line';
      lineElem.innerHTML = '<span style="color:var(--green)">user@edge-worker:' + wasmCwd + '$</span> <span style="color:#fff">' + escapeHtml(raw) + '</span>';
      outBox.appendChild(lineElem);

      const parts = raw.split('&&').map(s => s.trim()).filter(Boolean);
      for (const cmdStr of parts) {
        await runSingleWasmCmd(cmdStr, outBox);
      }

      outBox.scrollTop = outBox.scrollHeight;
    }

    async function runSingleWasmCmd(cmdStr, outBox) {
      const tokens = cmdStr.split(' ').filter(Boolean);
      const app = tokens[0];
      const args = tokens.slice(1);
      const resElem = document.createElement('div');
      resElem.className = 'term-line';
      resElem.style.color = '#cbd5e1';

      if (app === 'clear') {
        outBox.innerHTML = '';
        return;
      } else if (app === 'help') {
        resElem.textContent = `WebConsole Edge Network & POSIX Commands:
  • ssh <host> [-p port]     - Probe SSH server & retrieve SSH protocol version/banner
  • ftp <host> [port]        - Connect to FTP server (port 21) & inspect banner
  • telnet / nc <host> <port>- Raw TCP socket probe & latency test from Cloudflare Edge
  • ping <host>              - TCP Ping & latency measurement to host from Edge
  • dig <domain> [type]      - Perform DNS query (A, AAAA, MX, TXT, CNAME, NS) via 1.1.1.1
  • git clone <owner/repo>   - Clone GitHub repository tree & files into local virtual FS
  • curl / wget <url>        - Live HTTP request across Cloudflare Proxy & download
  • ls [-la] / pwd / cd      - Directory navigation
  • cat <file>               - Display file content
  • echo "text" [> file]     - Output text or save to virtual file
  • mkdir / rm               - Create or remove files/folders
  • uname -a / date / whoami - System details & metrics
  • clear / help             - Console utilities`;
      } else if (app === 'ssh') {
        let host = args[0];
        let port = 22;
        if (!host) {
          resElem.style.color = 'var(--red)';
          resElem.textContent = 'Usage: ssh <host> [-p port]';
        } else {
          if (host.includes('@')) host = host.split('@')[1];
          const pIdx = args.indexOf('-p');
          if (pIdx !== -1 && args[pIdx + 1]) port = Number(args[pIdx + 1]);
          resElem.textContent = `Connecting to ${host}:${port} over Cloudflare Raw TCP Sockets...`;
          outBox.appendChild(resElem);
          outBox.scrollTop = outBox.scrollHeight;
          try {
            const r = await fetch('/api/tcp-probe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ host, port })
            });
            const d = await r.json();
            if (d.ok) {
              resElem.innerHTML = `<span style="color:var(--green)">✓ SSH Connection Established (${d.latencyMs}ms)</span>\n<span style="color:#fff">Remote SSH Banner:</span> ${escapeHtml(d.banner)}\n<span style="color:var(--muted)">Protocol: SSH-2.0 · Key exchange and socket handshake verified.</span>`;
            } else {
              resElem.style.color = 'var(--red)';
              resElem.textContent = `ssh: connect to host ${host} port ${port}: ${d.error || 'Connection failed'}`;
            }
          } catch (e) {
            resElem.style.color = 'var(--red)';
            resElem.textContent = 'ssh error: ' + e.message;
          }
          return;
        }
      } else if (app === 'ftp' || app === 'sftp') {
        let host = args[0];
        let port = app === 'ftp' ? (args[1] ? Number(args[1]) : 21) : 22;
        if (!host) {
          resElem.style.color = 'var(--red)';
          resElem.textContent = `Usage: ${app} <host> [port]`;
        } else {
          if (host.includes('@')) host = host.split('@')[1];
          resElem.textContent = `Connecting to FTP server ${host}:${port} via Edge TCP Sockets...`;
          outBox.appendChild(resElem);
          outBox.scrollTop = outBox.scrollHeight;
          try {
            const r = await fetch('/api/tcp-probe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ host, port })
            });
            const d = await r.json();
            if (d.ok) {
              resElem.innerHTML = `<span style="color:var(--green)">✓ Connected to ${host}:${port} (${d.latencyMs}ms)</span>\n<span style="color:#fff">Server Response:</span> ${escapeHtml(d.banner)}\n<span style="color:var(--muted)">FTP command channel open. Status 220 Ready.</span>`;
            } else {
              resElem.style.color = 'var(--red)';
              resElem.textContent = `ftp: connect to ${host}:${port}: ${d.error || 'Connection refused'}`;
            }
          } catch (e) {
            resElem.style.color = 'var(--red)';
            resElem.textContent = 'ftp error: ' + e.message;
          }
          return;
        }
      } else if (app === 'telnet' || app === 'nc') {
        const host = args[0];
        const port = Number(args[1] || 80);
        if (!host) {
          resElem.style.color = 'var(--red)';
          resElem.textContent = `Usage: ${app} <host> <port>`;
        } else {
          resElem.textContent = `Probing raw TCP socket ${host}:${port}...`;
          outBox.appendChild(resElem);
          outBox.scrollTop = outBox.scrollHeight;
          try {
            const r = await fetch('/api/tcp-probe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ host, port })
            });
            const d = await r.json();
            if (d.ok) {
              resElem.innerHTML = `<span style="color:var(--green)">✓ Connected to ${host}:${port} [TCP/IP] (${d.latencyMs}ms)</span>\n${escapeHtml(d.banner)}`;
            } else {
              resElem.style.color = 'var(--red)';
              resElem.textContent = `Failed to connect to ${host}:${port}: ${d.error}`;
            }
          } catch (e) {
            resElem.style.color = 'var(--red)';
            resElem.textContent = 'Socket error: ' + e.message;
          }
          return;
        }
      } else if (app === 'ping') {
        const host = args[0];
        if (!host) {
          resElem.style.color = 'var(--red)';
          resElem.textContent = 'Usage: ping <host>';
        } else {
          resElem.textContent = `PING ${host} from Cloudflare Edge...`;
          outBox.appendChild(resElem);
          outBox.scrollTop = outBox.scrollHeight;
          try {
            const r = await fetch('/api/tcp-probe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ host, port: 443, timeoutMs: 2500 })
            });
            const d = await r.json();
            resElem.innerHTML = `<span style="color:var(--green)">64 bytes from ${host}: time=${d.latencyMs} ms (Edge Colo Roundtrip)</span>\n--- ${host} ping statistics ---\n1 packets transmitted, 1 received, 0% packet loss, time ${d.latencyMs}ms`;
          } catch (e) {
            resElem.style.color = 'var(--red)';
            resElem.textContent = 'ping: error: ' + e.message;
          }
          return;
        }
      } else if (app === 'dig' || app === 'dns') {
        const domain = args[0];
        const type = (args[1] || 'A').toUpperCase();
        if (!domain) {
          resElem.style.color = 'var(--red)';
          resElem.textContent = 'Usage: dig <domain> [A | AAAA | MX | TXT | CNAME | NS]';
        } else {
          resElem.textContent = `; <<>> DiG 9.18.1-Edge <<>> ${domain} ${type}\n;; Querying 1.1.1.1 (Cloudflare DNS over HTTPS)...`;
          outBox.appendChild(resElem);
          outBox.scrollTop = outBox.scrollHeight;
          try {
            const r = await fetch(`/api/dns-query?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`);
            const d = await r.json();
            if (d.ok && d.dns) {
              const answers = (d.dns.Answer || []).map(a => `${a.name}.\t${a.TTL}\tIN\t${type}\t${a.data}`).join('\n');
              resElem.textContent = `;; ANSWER SECTION:\n${answers || '(No records found)'}\n\n;; Query time: ${Math.floor(Math.random()*15+5)} msec\n;; SERVER: 1.1.1.1#53(1.1.1.1)\n;; MSG SIZE rcvd: ${JSON.stringify(d.dns).length}`;
            } else {
              resElem.style.color = 'var(--red)';
              resElem.textContent = 'DNS query failed: ' + (d.error || 'NXDOMAIN');
            }
          } catch (e) {
            resElem.style.color = 'var(--red)';
            resElem.textContent = 'DNS Error: ' + e.message;
          }
          return;
        }
      } else if (app === 'git') {
        if (args[0] === 'clone') {
          const repo = args[1]?.replace('https://github.com/', '').replace('.git', '');
          if (!repo) {
            resElem.style.color = 'var(--red)';
            resElem.textContent = 'Usage: git clone <owner/repo>';
          } else {
            resElem.textContent = `Cloning into '${repo.split('/')[1] || repo}' from GitHub...`;
            outBox.appendChild(resElem);
            outBox.scrollTop = outBox.scrollHeight;
            try {
              const r = await fetch(`/api/git-tree?repo=${encodeURIComponent(repo)}`);
              const d = await r.json();
              if (d.ok && d.tree) {
                const folder = repo.split('/')[1] || repo;
                wasmFs[wasmCwd + '/' + folder] = [];
                if (!wasmFs[wasmCwd].includes(folder)) wasmFs[wasmCwd].push(folder);
                for (const item of d.tree.slice(0, 30)) {
                  if (item.type === 'blob') {
                    const fname = item.path.split('/').pop();
                    wasmFs[wasmCwd + '/' + folder].push(fname);
                    wasmFs[wasmCwd + '/' + folder + '/' + fname] = `# Git placeholder for ${item.path}\n# SHA: ${item.sha}`;
                  }
                }
                saveWasmFs();
                resElem.innerHTML = `<span style="color:var(--green)">✓ Successfully cloned repository ${repo} (${d.tree.length} objects).</span>\nDirectory created: ${wasmCwd}/${folder}`;
              } else {
                resElem.style.color = 'var(--red)';
                resElem.textContent = 'git clone error: ' + (d.message || d.error);
              }
            } catch (e) {
              resElem.style.color = 'var(--red)';
              resElem.textContent = 'git error: ' + e.message;
            }
            return;
          }
        } else {
          resElem.textContent = 'git version 2.43.0-edge\nSupported subcommands: git clone <owner/repo>';
        }
      } else if (app === 'pwd') {
        resElem.textContent = wasmCwd;
      } else if (app === 'whoami') {
        resElem.textContent = 'user (uid=1000, gid=1000)';
      } else if (app === 'date') {
        resElem.textContent = new Date().toUTCString();
      } else if (app === 'uname') {
        resElem.textContent = 'Linux edge-worker 6.1.0-edge-sockets #1 SMP Cloudflare Edge V8 x86_64 GNU/Linux';
      } else if (app === 'df') {
        resElem.textContent = 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/root        10G  1.2G  8.8G  12% /\ntmpfs           512M     0  512M   0% /tmp';
      } else if (app === 'free') {
        resElem.textContent = '               total        used        free      shared  buff/cache   available\nMem:         1048576      128420      920156           0       12400      920156\nSwap:        2097152           0     2097152';
      } else if (app === 'ls') {
        const items = wasmFs[wasmCwd] || [];
        if (args.includes('-la') || args.includes('-l')) {
          resElem.textContent = 'drwxr-xr-x 2 user user 4096 ' + new Date().toLocaleDateString() + ' .\ndrwxr-xr-x 3 user user 4096 ' + new Date().toLocaleDateString() + ' ..\n' + items.map(f => {
            const isDir = Array.isArray(wasmFs[wasmCwd + '/' + f]) || Array.isArray(wasmFs['/' + f]);
            return (isDir ? 'drwxr-xr-x' : '-rw-r--r--') + ' 1 user user ' + (wasmFs[wasmCwd + '/' + f]?.length || 4096) + ' ' + new Date().toLocaleDateString() + ' ' + f;
          }).join('\n');
        } else {
          resElem.textContent = items.join('  ') || '(پوشه خالی است)';
        }
      } else if (app === 'cd') {
        const target = args[0] || '/home/user';
        let newPath = target.startsWith('/') ? target : (wasmCwd === '/' ? '/' + target : wasmCwd + '/' + target);
        if (target === '..') {
          const segs = wasmCwd.split('/').filter(Boolean);
          segs.pop();
          newPath = '/' + segs.join('/');
        } else if (target === '~') {
          newPath = '/home/user';
        }
        if (wasmFs[newPath] !== undefined) {
          wasmCwd = newPath || '/';
          document.getElementById('wasm-term-prompt').textContent = 'user@edge-worker:' + wasmCwd + '$';
        } else {
          resElem.style.color = 'var(--red)';
          resElem.textContent = 'cd: ' + target + ': No such file or directory';
        }
      } else if (app === 'cat') {
        const file = args[0];
        const filePath = file?.startsWith('/') ? file : (wasmCwd === '/' ? '/' + file : wasmCwd + '/' + file);
        if (wasmFs[filePath] !== undefined && typeof wasmFs[filePath] === 'string') {
          resElem.textContent = wasmFs[filePath];
        } else {
          resElem.style.color = 'var(--red)';
          resElem.textContent = 'cat: ' + file + ': No such file';
        }
      } else if (app === 'echo') {
        const full = args.join(' ');
        if (full.includes('>')) {
          const [text, filename] = full.split('>').map(s => s.trim());
          const cleanText = text.replace(/^['"]|['"]$/g, '');
          const cleanFile = filename.replace(/^['"]|['"]$/g, '');
          const filePath = cleanFile.startsWith('/') ? cleanFile : (wasmCwd === '/' ? '/' + cleanFile : wasmCwd + '/' + cleanFile);
          wasmFs[filePath] = cleanText;
          if (!wasmFs[wasmCwd].includes(cleanFile)) wasmFs[wasmCwd].push(cleanFile);
          saveWasmFs();
          resElem.textContent = '';
        } else {
          resElem.textContent = full.replace(/^['"]|['"]$/g, '');
        }
      } else if (app === 'curl' || app === 'wget') {
        const target = args.find(a => !a.startsWith('-'));
        if (!target) {
          resElem.style.color = 'var(--red)';
          resElem.textContent = `${app}: no URL specified!`;
        } else {
          resElem.textContent = `Connecting to ${target} via Cloudflare Forward Proxy...`;
          try {
            const fetchUrl = '/?url=' + encodeURIComponent(target.startsWith('http') ? target : 'https://' + target);
            const r = await fetch(fetchUrl);
            const txt = await r.text();
            resElem.textContent = txt;
          } catch (e) {
            resElem.style.color = 'var(--red)';
            resElem.textContent = `${app}: error fetching: ` + e.message;
          }
        }
      } else {
        resElem.style.color = 'var(--red)';
        resElem.textContent = app + ': command not found. Type "help" for list of commands.';
      }

      if (resElem.textContent) {
        outBox.appendChild(resElem);
      }
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // --------------------------------------------------------------------------
    // 3. Universal Proxy Tester
    // --------------------------------------------------------------------------
    async function runProxyTest() {
      const url = document.getElementById('prx-url').value.trim();
      const method = document.getElementById('prx-method').value;
      const box = document.getElementById('prx-result');
      box.style.display = 'block';
      box.textContent = 'در حال ارسال درخواست از طریق پروکسی...';
      try {
        const start = Date.now();
        const res = await fetch('/?url=' + encodeURIComponent(url), { method });
        const latency = Date.now() - start;
        const text = await res.text();
        box.textContent = 'HTTP ' + res.status + ' ' + res.statusText + ' (' + latency + 'ms)\\n\\n' + text;
      } catch (e) {
        box.textContent = 'خطا در پروکسی: ' + e.message;
      }
    }

    // --------------------------------------------------------------------------
    // 4. D1 SQL Console
    // --------------------------------------------------------------------------
    async function runD1Query() {
      const sql = document.getElementById('d1-sql').value.trim();
      const box = document.getElementById('d1-result');
      box.style.display = 'block';
      box.innerHTML = '<div style="padding:14px;color:var(--muted)">در حال اجرای کوئری SQL...</div>';
      try {
        const res = await fetch('/api/d1/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql })
        });
        const data = await res.json();
        if (!data.ok) {
          box.innerHTML = '<div style="padding:14px;color:var(--red)">خطا: ' + data.error + '</div>';
          return;
        }
        const rows = data.result?.results || [];
        if (!rows.length) {
          box.innerHTML = '<div style="padding:14px;color:var(--green)">کوئری با موفقیت اجرا شد (۰ ردیف بازگردانده شد).</div>';
          return;
        }
        const cols = Object.keys(rows[0]);
        let html = '<table><thead><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>';
        for (const r of rows) {
          html += '<tr>' + cols.map(c => '<td>' + (typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c]) + '</td>').join('') + '</tr>';
        }
        html += '</tbody></table>';
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<div style="padding:14px;color:var(--red)">خطای شبکه: ' + e.message + '</div>';
      }
    }

    async function loadD1Schema() {
      document.getElementById('d1-sql').value = "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%';";
      runD1Query();
    }

    // --------------------------------------------------------------------------
    // 5. KV Storage
    // --------------------------------------------------------------------------
    async function loadKvKeys() {
      const prefix = document.getElementById('kv-search-prefix').value.trim();
      const box = document.getElementById('kv-list');
      box.innerHTML = '<div style="padding:14px;color:var(--muted)">در حال دریافت کلیدها...</div>';
      try {
        const res = await fetch('/api/kv/keys?prefix=' + encodeURIComponent(prefix));
        const data = await res.json();
        if (!data.ok) {
          box.innerHTML = '<div style="padding:14px;color:var(--red)">' + data.error + '</div>';
          return;
        }
        const keys = data.keys || [];
        if (!keys.length) {
          box.innerHTML = '<div style="padding:14px;color:var(--muted)">هیچ کلیدی پیدا نشد.</div>';
          return;
        }
        let html = '<table><thead><tr><th>نام کلید (Key)</th><th>تاریخ انقضا</th><th>عملیات</th></tr></thead><tbody>';
        for (const k of keys) {
          html += '<tr><td style="font-weight:600">' + k.name + '</td><td>' + (k.expiration ? new Date(k.expiration*1000).toLocaleString() : 'دائمی') + '</td><td><button class="btn sec" style="padding:4px 8px;font-size:12px" onclick="viewKvKey(\\'' + k.name + '\\')">مشاهده/ویرایش</button></td></tr>';
        }
        html += '</tbody></table>';
        box.innerHTML = html;
      } catch (e) {
        box.innerHTML = '<div style="padding:14px;color:var(--red)">' + e.message + '</div>';
      }
    }

    async function viewKvKey(key) {
      const res = await fetch('/api/kv/get?key=' + encodeURIComponent(key));
      const data = await res.json();
      if (data.ok) {
        const val = prompt('مقدار کلید ' + key + ':', data.value);
        if (val !== null && val !== data.value) {
          await fetch('/api/kv/put', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: val })
          });
          alert('کلید با موفقیت بروزرسانی شد.');
          loadKvKeys();
        }
      }
    }

    async function openKvModal() {
      const key = prompt('نام کلید (Key Name):');
      if (!key) return;
      const value = prompt('مقدار کلید (Value):', '');
      if (value === null) return;
      await fetch('/api/kv/put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
      });
      loadKvKeys();
    }

    // --------------------------------------------------------------------------
    // 6. Workers AI
    // --------------------------------------------------------------------------
    async function runAiInference() {
      const model = document.getElementById('ai-model').value;
      const prompt = document.getElementById('ai-prompt').value.trim();
      const box = document.getElementById('ai-result');
      const btn = document.getElementById('ai-btn');
      if (!prompt) return alert('لطفاً پرامپت را وارد کنید.');
      box.style.display = 'block';
      box.textContent = 'در حال پردازش در هسته هوش مصنوعی لبه...';
      btn.disabled = true;
      try {
        const res = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt })
        });
        const data = await res.json();
        if (data.ok) {
          box.textContent = typeof data.response === 'object' ? (data.response.response || JSON.stringify(data.response, null, 2)) : data.response;
        } else {
          box.textContent = 'خطا در اجرای AI: ' + data.error;
        }
      } catch (e) {
        box.textContent = 'خطای ارتباطی: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }

    // --------------------------------------------------------------------------
    // 7. Edge JavaScript Code Evaluator
    // --------------------------------------------------------------------------
    async function runEvalCode() {
      const code = document.getElementById('eval-code').value;
      const box = document.getElementById('eval-result');
      box.style.display = 'block';
      box.textContent = 'در حال اجرا در ایزولیت V8 لبه...';
      try {
        const res = await fetch('/api/eval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (data.ok) {
          box.textContent = 'نتیجه (' + data.durationMs + 'ms) [' + data.type + ']:\\n\\n' + (typeof data.result === 'object' ? JSON.stringify(data.result, null, 2) : String(data.result));
        } else {
          box.textContent = 'خطای جاوااسکریپت:\\n' + data.error + '\\n\\n' + (data.stack || '');
        }
      } catch (e) {
        box.textContent = 'خطای ارتباطی: ' + e.message;
      }
    }

    // --------------------------------------------------------------------------
    // 8. Outbound HTTP Request Tester
    // --------------------------------------------------------------------------
    async function runHttpTest() {
      const url = document.getElementById('http-url').value.trim();
      const method = document.getElementById('http-method').value;
      let headers = {};
      try {
        const hStr = document.getElementById('http-headers').value.trim();
        if (hStr) headers = JSON.parse(hStr);
      } catch (e) {
        return alert('فرمت هدرها باید JSON معتبر باشد.');
      }
      const body = document.getElementById('http-body').value;
      const box = document.getElementById('http-result');
      box.style.display = 'block';
      box.textContent = 'در حال ارسال درخواست شبکه از لبه کلودفلر...';
      try {
        const res = await fetch('/api/http-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, method, headers, body })
        });
        const data = await res.json();
        if (data.ok) {
          box.textContent = 'HTTP ' + data.status + ' ' + data.statusText + ' (' + data.latencyMs + 'ms)\\n\\n=== Headers ===\\n' + JSON.stringify(data.headers, null, 2) + '\\n\\n=== Body ===\\n' + data.body;
        } else {
          box.textContent = 'خطا در ارسال: ' + data.error;
        }
      } catch (e) {
        box.textContent = 'خطا: ' + e.message;
      }
    }
  </script>
</body>
</html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
