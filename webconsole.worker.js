/**
 * ==============================================================================
 * WebConsole Pro - Cloudflare Workers Edition
 * Universal Forward Proxy Gateway & Edge Management Console
 * 
 * Features:
 *  1. Universal Forward Proxy (?url=https://...) supporting all HTTP methods,
 *     CORS, Byte-Range streaming (Audio/Video), headers, and chunked transfer.
 *  2. Edge WebConsole UI (Persian / RTL dark glassmorphism responsive SPA).
 *  3. Cloudflare D1 SQL Console (Interactive database query editor & table viewer).
 *  4. Cloudflare KV Storage Explorer (Key-Value manager with search & TTL).
 *  5. Cloudflare Workers AI Assistant (Chat & inference with Llama 3 / Qwen / Mistral).
 *  6. Edge JavaScript Code Runner (V8 Isolate REPL with fetch & crypto).
 *  7. Outbound HTTP Request & API Testing Suite.
 *  8. Password / Secret Token Access Protection.
 * 
 * Version: 1.0.0
 * Repository: https://github.com/fazilatma/new
 * ==============================================================================
 */

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
    // 3. API Router for Dashboard
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

    // Preflight OPTIONS handling
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

    // Build Forward Request Headers
    const forwardHeaders = new Headers();
    const skipHeaders = ['host', 'cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-proto', 'x-real-ip'];

    for (const [key, value] of request.headers.entries()) {
      const lk = key.toLowerCase();
      if (!skipHeaders.includes(lk)) {
        forwardHeaders.set(key, value);
      }
    }

    // Set or preserve Host and User-Agent
    forwardHeaders.set('Host', targetUrl.host);
    if (!forwardHeaders.has('User-Agent')) {
      forwardHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    }
    if (!forwardHeaders.has('Accept')) {
      forwardHeaders.set('Accept', '*/*');
    }

    // Prepare Fetch Init
    const fetchInit = {
      method: request.method,
      headers: forwardHeaders,
      redirect: 'follow'
    };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method.toUpperCase()) && request.body) {
      fetchInit.body = request.body;
      fetchInit.duplex = 'half';
    }

    // Execute Outbound Fetch
    const upstreamRes = await fetch(targetUrl.toString(), fetchInit);

    // Build Response Headers with Full CORS & Range support
    const resHeaders = new Headers();
    for (const [k, v] of upstreamRes.headers.entries()) {
      const lk = k.toLowerCase();
      if (lk !== 'content-encoding' && lk !== 'content-length' && lk !== 'transfer-encoding') {
        resHeaders.set(k, v);
      }
    }

    // Guarantee CORS Wildcard
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS');
    resHeaders.set('Access-Control-Allow-Headers', '*');
    resHeaders.set('Access-Control-Expose-Headers', '*');

    // Stream Response directly
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
      version: '1.0.0',
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
        vectorize: Boolean(env.VECTORIZE)
      }
    });
  }

  // 2. D1 Database Query Runner
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

  // 3. D1 Tables Schema Inspector
  if (path === '/api/d1/schema') {
    if (!env.DB) return jsonResponse({ ok: false, error: 'D1 binding (env.DB) is not configured.' }, 400);
    try {
      const tables = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;").all();
      return jsonResponse({ ok: true, tables: tables.results || [] });
    } catch (e) {
      return jsonResponse({ ok: false, error: e.message }, 500);
    }
  }

  // 4. KV List Keys
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

  // 5. KV Get Key
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

  // 6. KV Put Key
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

  // 7. KV Delete Key
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
      const fn = new AsyncFunction('env', 'request', 'fetch', code);
      const start = Date.now();
      const result = await fn(env, request, fetch);
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
  const currentHost = url.host;
  const currentOrigin = url.origin;

  const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>وب‌کنسول لبه کلودفلر | WebConsole Pro Edge</title>
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
    
    /* Header */
    header { background: #0f172a; border-bottom: 1px solid var(--card-border); padding: 14px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; backdrop-filter: blur(8px); }
    .brand { display: flex; align-items: center; gap: 12px; font-weight: 800; font-size: 18px; color: var(--primary); }
    .node-pill { background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.3); color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Nav Tabs */
    .tabs-bar { background: #0c1322; border-bottom: 1px solid var(--card-border); padding: 8px 24px; display: flex; gap: 8px; overflow-x: auto; }
    .tab-btn { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 8px 16px; border-radius: 8px; font-size: 13.5px; font-weight: 600; cursor: pointer; transition: 0.15s; white-space: nowrap; }
    .tab-btn:hover { color: var(--text); background: rgba(255,255,255,0.03); }
    .tab-btn.active { color: #fff; background: var(--card-bg); border-color: var(--primary); }

    /* Layout */
    .container { max-width: 1200px; margin: 24px auto; padding: 0 20px; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }

    /* Cards */
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: var(--radius); padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
    .card-title { font-size: 16px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; color: #fff; }

    /* Grids & Metrics */
    .grid3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .stat-box { background: rgba(0,0,0,0.2); border: 1px solid var(--card-border); border-radius: 10px; padding: 14px 18px; }
    .stat-label { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .stat-value { font-size: 18px; font-weight: 700; color: var(--text); direction: ltr; text-align: left; }

    /* Form Controls */
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

    /* Results and Tables */
    .code-box { background: var(--code-bg); border: 1px solid var(--card-border); border-radius: 8px; padding: 14px; font-family: ui-monospace, monospace; font-size: 13px; direction: ltr; text-align: left; overflow-x: auto; white-space: pre-wrap; max-height: 400px; }
    .tbl-wrap { overflow-x: auto; margin-top: 14px; border: 1px solid var(--card-border); border-radius: 8px; }
    table { width: 100%; border-collapse: collapse; text-align: right; font-size: 13.5px; }
    th { background: #0d1527; padding: 10px 14px; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--card-border); }
    td { padding: 10px 14px; border-bottom: 1px solid var(--card-border); direction: ltr; text-align: left; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255,255,255,0.02); }

    /* Live Proxy URL Banner */
    .proxy-banner { background: linear-gradient(135deg, rgba(56,189,248,0.1), rgba(129,140,248,0.1)); border: 1px solid rgba(56,189,248,0.3); border-radius: 12px; padding: 18px; margin-bottom: 20px; }
    .proxy-url-display { background: #070a12; border: 1px solid #1e293b; border-radius: 8px; padding: 12px 16px; font-family: ui-monospace, monospace; color: var(--green); font-size: 14px; direction: ltr; text-align: left; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
    .copy-btn { background: #1e293b; border: 1px solid #334155; color: #fff; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; }
    .copy-btn:hover { background: #334155; }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <span>☁️</span> WebConsole Pro <span style="font-size: 12px; background: rgba(56,189,248,0.2); padding: 2px 8px; border-radius: 6px;">Edge Edition</span>
    </div>
    <div class="node-pill">
      <div class="dot"></div>
      <span id="node-info">در حال اتصال به نود لبه...</span>
    </div>
  </header>

  <nav class="tabs-bar">
    <button class="tab-btn active" onclick="switchTab('tab-proxy')">🌐 پروکسی سرور (Universal Proxy)</button>
    <button class="tab-btn" onclick="switchTab('tab-d1')">🗄️ دیتابیس D1 SQL</button>
    <button class="tab-btn" onclick="switchTab('tab-kv')">🔑 حافظه KV Storage</button>
    <button class="tab-btn" onclick="switchTab('tab-ai')">🤖 هوش مصنوعی لبه (Workers AI)</button>
    <button class="tab-btn" onclick="switchTab('tab-eval')">⚡ اجرای کد جاوااسکریپت (Edge REPL)</button>
    <button class="tab-btn" onclick="switchTab('tab-http')">📡 تست درخواست شبکه (API Client)</button>
    <button class="tab-btn" onclick="switchTab('tab-settings')">⚙️ راهنمای ورکر و تنظیمات</button>
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

    <!-- TAB 2: D1 SQL -->
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

    <!-- TAB 3: KV STORAGE -->
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

    <!-- TAB 4: WORKERS AI -->
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

    <!-- TAB 5: EDGE REPL -->
    <div id="tab-eval" class="tab-content">
      <div class="card">
        <div class="card-title">⚡ مفسر و اجرای کد جاوااسکریپت در ایزولیت ورکر (Edge REPL)</div>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 12px;">کدهای JS مدرن با دسترسی مستقیم به <code style="color:#fff;">env</code>, <code style="color:#fff;">fetch</code>, <code style="color:#fff;">crypto</code> در هسته V8 لبه اجرا می‌شوند.</p>
        <div class="inp-group">
          <textarea id="eval-code" class="inp ltr" rows="6" spellcheck="false">// تست ارسال درخواست از لبه
const res = await fetch('https://api.ipify.org?format=json');
const data = await res.json();
return { edge_ip: data.ip, colo: request.cf?.colo || 'local', timestamp: new Date().toISOString() };</textarea>
        </div>
        <button class="btn" onclick="runEvalCode()">▶️ اجرای کد در لبه</button>
        <div id="eval-result" class="code-box" style="display: none; margin-top: 16px;"></div>
      </div>
    </div>

    <!-- TAB 6: HTTP TESTER -->
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

    <!-- TAB 7: SETTINGS & GUIDE -->
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
