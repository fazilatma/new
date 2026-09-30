/**
 * Replacement for agent-python/app/browser_automation.py (Playwright).
 *
 * Playwright cannot run inside workerd. Three tiers, in order:
 *   1. Cloudflare Browser Rendering REST API  (real Chromium — needs
 *      CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN)
 *   2. HTMLRewriter DOM engine over plain `fetch` (title/text/links)
 *   3. Synthetic offline document
 *
 * Session state lives in KV so it survives isolate recycling.
 */

import type { Env } from './types';
import { getProxyConfig, getRawConfig } from './config';
import { bytesToBase64 } from './crypto';

const SESSION_KV_PREFIX = 'browser:session:';
const SESSION_TTL_SECONDS = 3600;

export interface BrowserSession {
  sessionId: string;
  url: string;
  status: number;
  title: string;
  content: string;
  rawHtml: string;
  links: { href: string; text: string }[];
  consoleLogs: string[];
  networkLogs: Record<string, unknown>[];
  engine: string;
  updatedAt: number;
}

function emptySession(sessionId: string): BrowserSession {
  return {
    sessionId,
    url: 'about:blank',
    status: 200,
    title: 'Empty Page',
    content: '',
    rawHtml: '<html><body></body></html>',
    links: [],
    consoleLogs: [],
    networkLogs: [],
    engine: 'workers-fetch-dom',
    updatedAt: Date.now(),
  };
}

async function loadSession(env: Env, sessionId: string): Promise<BrowserSession> {
  try {
    const raw = await env.CONFIG.get(`${SESSION_KV_PREFIX}${sessionId}`);
    if (raw) return JSON.parse(raw) as BrowserSession;
  } catch {
    /* fall through */
  }
  return emptySession(sessionId);
}

async function saveSession(env: Env, session: BrowserSession): Promise<void> {
  session.updatedAt = Date.now();
  // Keep KV values small: drop the raw HTML beyond a sane cap.
  const slim: BrowserSession = { ...session, rawHtml: session.rawHtml.slice(0, 200000) };
  await env.CONFIG.put(`${SESSION_KV_PREFIX}${session.sessionId}`, JSON.stringify(slim), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export function validateUrl(url: string): string {
  const cleaned = (url || '').trim();
  if (!cleaned) return 'https://example.com';
  if (!/^https?:\/\//i.test(cleaned)) {
    if (!cleaned.includes('://')) return `https://${cleaned}`;
    throw new Error('Only http:// and https:// URLs are supported.');
  }
  return cleaned;
}

/* ------------------------------------------------------------------ */
/* Tier 1: Cloudflare Browser Rendering REST API                       */
/* ------------------------------------------------------------------ */

async function browserRenderingCreds(
  env: Env,
): Promise<{ accountId: string; token: string } | null> {
  const accountId = (await getRawConfig(env, 'CLOUDFLARE_ACCOUNT_ID', '')).trim();
  const token = (await getRawConfig(env, 'CLOUDFLARE_API_TOKEN', '')).trim();
  if (!accountId || !token) return null;
  return { accountId, token };
}

async function browserRenderingCall(
  env: Env,
  endpoint: 'content' | 'screenshot' | 'scrape',
  body: Record<string, unknown>,
): Promise<Response | null> {
  const creds = await browserRenderingCreds(env);
  if (!creds) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/browser-rendering/${endpoint}`;
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Tier 2: HTMLRewriter DOM extraction                                 */
/* ------------------------------------------------------------------ */

interface Extracted {
  title: string;
  text: string;
  links: { href: string; text: string }[];
}

export async function extractFromHtml(html: string, baseUrl: string): Promise<Extracted> {
  let title = '';
  const textParts: string[] = [];
  const links: { href: string; text: string }[] = [];
  let skipDepth = 0;
  let inTitle = false;
  let currentLink: { href: string; text: string } | null = null;

  const rewriter = new HTMLRewriter()
    .on('script, style, noscript, svg, template', {
      element(el) {
        skipDepth++;
        el.onEndTag(() => {
          skipDepth = Math.max(0, skipDepth - 1);
        });
      },
    })
    .on('title', {
      element() {
        inTitle = true;
      },
      text(chunk) {
        if (inTitle) title += chunk.text;
        if (chunk.lastInTextNode) inTitle = false;
      },
    })
    .on('a[href]', {
      element(el) {
        const href = el.getAttribute('href') ?? '';
        currentLink = { href, text: '' };
        links.push(currentLink);
        const captured = currentLink;
        el.onEndTag(() => {
          if (currentLink === captured) currentLink = null;
        });
      },
      text(chunk) {
        if (currentLink) currentLink.text += chunk.text;
      },
    })
    .on('body *', {
      text(chunk) {
        if (skipDepth > 0) return;
        const t = chunk.text.replace(/\s+/g, ' ').trim();
        if (t) textParts.push(t);
      },
    });

  await rewriter.transform(new Response(html)).text();

  const resolved = links
    .filter((l) => l.href)
    .slice(0, 200)
    .map((l) => {
      let abs = l.href;
      try {
        abs = new URL(l.href, baseUrl).toString();
      } catch {
        /* keep raw */
      }
      return { href: abs, text: (l.text || l.href).trim().slice(0, 60) };
    });

  return {
    title: title.trim(),
    text: textParts.join('\n'),
    links: resolved,
  };
}

/* ------------------------------------------------------------------ */
/* Public API (mirrors BrowserManager)                                 */
/* ------------------------------------------------------------------ */

export async function createBrowserSession(env: Env, sessionId = 'default') {
  const creds = await browserRenderingCreds(env);
  const session = emptySession(sessionId);
  session.engine = creds ? 'cloudflare-browser-rendering' : 'workers-fetch-dom';
  session.consoleLogs.push(`[notice] session '${sessionId}' created (engine: ${session.engine})`);
  await saveSession(env, session);
  return { ok: true, sessionId, engine: session.engine };
}

export async function browserNavigate(env: Env, url: string, sessionId = 'default') {
  const target = validateUrl(url);
  const session = await loadSession(env, sessionId);

  // --- Tier 1 ------------------------------------------------------
  const brResp = await browserRenderingCall(env, 'content', { url: target });
  if (brResp && brResp.ok) {
    try {
      const data: any = await brResp.json();
      const html = typeof data?.result === 'string' ? data.result : '';
      if (html) {
        const ex = await extractFromHtml(html, target);
        session.url = target;
        session.status = 200;
        session.title = ex.title || target;
        session.content = ex.text.slice(0, 60000);
        session.rawHtml = html;
        session.links = ex.links.slice(0, 100);
        session.engine = 'cloudflare-browser-rendering';
        session.consoleLogs.push(`[network] GET ${target} — 200 (browser rendering)`);
        await saveSession(env, session);
        return {
          url: target,
          status: 200,
          title: session.title,
          content: session.content,
          linksCount: session.links.length,
          engine: session.engine,
        };
      }
    } catch {
      /* fall through to tier 2 */
    }
  }

  // --- Tier 2 ------------------------------------------------------
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (compatible; ArenaAgent/1.0; +https://developers.cloudflare.com/workers/)',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  const { effectiveUrl, proxyClient } = await getProxyConfig(env, target);
  const attempts: string[] = [];
  if (effectiveUrl !== target) attempts.push(effectiveUrl);
  attempts.push(target);
  if (proxyClient) {
    session.consoleLogs.push(
      `[warning] forward proxy '${proxyClient}' is not supported on Workers; using a direct request.`,
    );
  }

  for (const attemptUrl of attempts) {
    try {
      const resp = await fetch(attemptUrl, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      const html = await resp.text();
      if (!html) continue;
      const finalUrl = resp.url || attemptUrl;
      const ex = await extractFromHtml(html, finalUrl);

      session.url = finalUrl;
      session.status = resp.status;
      session.title = ex.title || finalUrl;
      session.content = ex.text.slice(0, 60000);
      session.rawHtml = html;
      session.links = ex.links.slice(0, 100);
      session.engine = 'workers-fetch-dom';
      session.consoleLogs.push(
        `[network] GET ${finalUrl} — ${resp.status} (${html.length} bytes)`,
      );
      await saveSession(env, session);

      return {
        url: finalUrl,
        status: resp.status,
        title: session.title,
        content: session.content,
        linksCount: session.links.length,
        engine: session.engine,
      };
    } catch (e: any) {
      session.consoleLogs.push(`[warning] fetch failed for ${attemptUrl}: ${e?.message ?? e}`);
    }
  }

  // --- Tier 3 ------------------------------------------------------
  session.url = target;
  session.status = 0;
  session.title = `Document: ${target}`;
  session.content =
    `Host: ${target}\nStatus: unreachable from the Cloudflare edge.\n\n` +
    `Rendered via the offline fallback document. Enable Browser Rendering ` +
    `(CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN) for full Chromium.`;
  session.rawHtml = `<html><head><title>${target}</title></head><body><h1>${target}</h1><pre>${session.content}</pre></body></html>`;
  session.links = [];
  session.engine = 'offline-fallback';
  await saveSession(env, session);

  return {
    url: target,
    status: 0,
    title: session.title,
    content: session.content,
    linksCount: 0,
    engine: session.engine,
  };
}

export async function browserScreenshot(env: Env, sessionId = 'default', fullPage = false) {
  const session = await loadSession(env, sessionId);
  if (!session.url || session.url === 'about:blank') {
    return { ok: false, error: 'No page loaded in this session. Call navigate first.' };
  }

  const resp = await browserRenderingCall(env, 'screenshot', {
    url: session.url,
    screenshotOptions: { fullPage, type: 'png' },
  });
  if (resp && resp.ok) {
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('image/')) {
      const buf = new Uint8Array(await resp.arrayBuffer());
      return {
        ok: true,
        engine: 'cloudflare-browser-rendering',
        url: session.url,
        mimeType: 'image/png',
        imageBase64: bytesToBase64(buf),
        screenshot: bytesToBase64(buf),
      };
    }
    try {
      const data: any = await resp.json();
      if (data?.result) {
        return {
          ok: true,
          engine: 'cloudflare-browser-rendering',
          url: session.url,
          mimeType: 'image/png',
          imageBase64: data.result,
          screenshot: data.result,
        };
      }
    } catch {
      /* fall through */
    }
  }

  // Synthetic SVG wireframe (replaces the Pillow-rendered wireframe).
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = session.content.split('\n').filter(Boolean).slice(0, 22);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="700" viewBox="0 0 1024 700">
  <rect width="1024" height="700" fill="#0f1420"/>
  <rect x="0" y="0" width="1024" height="56" fill="#1b2334"/>
  <circle cx="26" cy="28" r="7" fill="#ff5f57"/><circle cx="50" cy="28" r="7" fill="#febc2e"/><circle cx="74" cy="28" r="7" fill="#28c840"/>
  <rect x="100" y="14" width="900" height="28" rx="14" fill="#0f1420"/>
  <text x="116" y="33" font-family="monospace" font-size="14" fill="#8ba3c7">${esc(session.url).slice(0, 110)}</text>
  <text x="32" y="100" font-family="sans-serif" font-size="24" fill="#e6edf7">${esc(session.title).slice(0, 70)}</text>
  <text x="32" y="128" font-family="monospace" font-size="12" fill="#5b6b83">HTTP ${session.status}</text>
  ${lines
    .map(
      (l, i) =>
        `<text x="32" y="${164 + i * 22}" font-family="monospace" font-size="13" fill="#9fb4d1">${esc(l).slice(0, 118)}</text>`,
    )
    .join('\n  ')}
  <text x="32" y="672" font-family="monospace" font-size="12" fill="#5b6b83">engine: ${esc(session.engine)} — synthetic wireframe (enable Browser Rendering for real screenshots)</text>
</svg>`;
  const b64 = bytesToBase64(new TextEncoder().encode(svg));
  return {
    ok: true,
    engine: 'synthetic-wireframe',
    url: session.url,
    mimeType: 'image/svg+xml',
    imageBase64: b64,
    screenshot: b64,
  };
}

export async function browserEvaluate(env: Env, expression: string, sessionId = 'default') {
  const session = await loadSession(env, sessionId);
  // `eval` / `new Function` are disabled in workerd, so only a small set of
  // introspection expressions is answerable without a real browser.
  const expr = (expression || '').trim();
  const table: Record<string, unknown> = {
    'document.title': session.title,
    'location.href': session.url,
    'window.location.href': session.url,
    'document.URL': session.url,
    'document.body.innerText': session.content.slice(0, 20000),
    'document.documentElement.outerHTML': session.rawHtml.slice(0, 20000),
    'document.links.length': session.links.length,
  };
  if (expr in table) {
    return { ok: true, expression: expr, result: table[expr], engine: session.engine };
  }
  return {
    ok: false,
    expression: expr,
    error:
      'Arbitrary JavaScript evaluation is not available: the Workers runtime disables eval() and ' +
      'there is no live browser context. Supported expressions: ' +
      Object.keys(table).join(', ') +
      '. Enable Cloudflare Browser Rendering for full page scripting.',
    engine: session.engine,
    unsupported: true,
  };
}

export async function browserClick(env: Env, selector: string, sessionId = 'default') {
  const session = await loadSession(env, sessionId);
  // Best effort: if the selector looks like a link, follow it.
  const match = session.links.find(
    (l) => l.text.toLowerCase().includes(selector.toLowerCase().replace(/^[#.]/, '')),
  );
  if (match) return await browserNavigate(env, match.href, sessionId);
  return {
    ok: false,
    selector,
    error:
      'Click requires a live browser context. Enable Cloudflare Browser Rendering, or navigate ' +
      'directly to the target URL.',
    unsupported: true,
  };
}

export async function browserFill(_env: Env, selector: string, _text: string) {
  return {
    ok: false,
    selector,
    error:
      'Form filling requires a live browser context. Enable Cloudflare Browser Rendering for this feature.',
    unsupported: true,
  };
}

export async function browserLogs(env: Env, sessionId = 'default') {
  const session = await loadSession(env, sessionId);
  return {
    sessionId,
    engine: session.engine,
    url: session.url,
    consoleLogs: session.consoleLogs.slice(-200),
    networkLogs: session.networkLogs.slice(-200),
  };
}

/** Port of connectors.browse — plain HTTP fetch with body passthrough. */
export async function browserFetch(env: Env, url: string) {
  const target = validateUrl(url);
  const resp = await fetch(target, {
    headers: { 'User-Agent': 'Arena-Agent/1.0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  const body = await resp.text();
  return {
    url: resp.url || target,
    status: resp.status,
    contentType: resp.headers.get('content-type') ?? '',
    body: body.slice(0, 100000),
  };
}
