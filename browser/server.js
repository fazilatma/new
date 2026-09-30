'use strict';
/* ============================================================================
 *  سرویس رندرِ جاوااسکریپت برای scraper4
 *
 *    POST /render  {url, waitUntil?, selector?, timeout?, scroll?, blockResources?}
 *        ← {ok, code, url, html, title, driver, took_ms}
 *    GET  /health  ← {ok, driver, active, queued, uptime_s}
 *
 *  راهبرد درایور:
 *    RENDER_DRIVER=playwright (پیش‌فرض/پیشنهادی)
 *    RENDER_DRIVER=selenium   (پشتیبان — نیازمند SELENIUM_URL مثل کانتینر
 *                              selenium/standalone-chromium روی :4444)
 *    RENDER_DRIVER=auto       ابتدا Playwright؛ اگر بالا نیامد Selenium
 *
 *  پایداری:
 *   • سمافورِ همزمانی (RENDER_MAX_CONCURRENCY، پیش‌فرض ۳) + صفِ کوتاه
 *   • اگر مرورگر قطع شود، رندرِ بعدی خودش دوباره بالا می‌آورد (relaunch)
 *   • هر رندر در contextualجدید و در finally بسته می‌شود → زامبی نمی‌ماند
 *   • خطای نکفته لاگ می‌شود ولی پروسه نمی‌میرد؛ سوپروایزرِ بیرونی (browser.sh)
 *     در بدترین حالت سرویس را بازراه‌اندازی می‌کند
 *   • RENDER_TOKEN روی POST /render اجباری است (اگر ست شود)
 * ========================================================================= */

const http = require('node:http');

const HOST = process.env.RENDER_HOST || '0.0.0.0';
const PORT = parseInt(process.env.RENDER_PORT || '3100', 10);
const TOKEN = process.env.RENDER_TOKEN || '';
const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.RENDER_MAX_CONCURRENCY || '3', 10));
const QUEUE_WAIT_MS = parseInt(process.env.RENDER_QUEUE_WAIT_MS || '10000', 10);
const NAV_TIMEOUT = parseInt(process.env.RENDER_NAV_TIMEOUT || '45000', 10);
const DRIVER_PREF = (process.env.RENDER_DRIVER || 'auto').toLowerCase();
const SELENIUM_URL = (process.env.SELENIUM_URL || 'http://127.0.0.1:4444').replace(/\/+$/, '');
const HEADLESS = (process.env.RENDER_HEADLESS || 'true') !== 'false';
const USER_AGENT = process.env.RENDER_USER_AGENT
  || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BLOCK_HOSTS = (process.env.RENDER_BLOCK_HOSTS || '') // مثلاً: sentry.io,googletagmanager.com
  .split(',').map(s => s.trim()).filter(Boolean);

const startedAt = Date.now();
const log = (...a) => console.log('[%s]', new Date().toISOString(), ...a);

/* ---------------------------------------------------------------- سمافور */
let active = 0;
const waiters = [];
function acquire() {
  if (active < MAX_CONCURRENCY) { active++; return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const i = waiters.findIndex(w => w.resolve === resolve);
      if (i >= 0) waiters.splice(i, 1);
      reject(new Error('queue_timeout'));
    }, QUEUE_WAIT_MS);
    waiters.push({ resolve: () => { clearTimeout(t); active++; resolve(); } });
  });
}
function release() {
  active = Math.max(0, active - 1);
  const w = waiters.shift();
  if (w) w.resolve();
}

/* ---------------------------------------------------------- Playwright */
let playwright = null;
let browser = null;
async function ensurePlaywright() {
  if (!playwright) playwright = require('playwright'); // ممکن است throw شود
  if (browser && browser.isConnected()) return;
  browser = await playwright.chromium.launch({
    headless: HEADLESS,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
           '--disable-crash-reporter', '--no-crashpad'],
  });
  browser.on('disconnected', () => { log('⚠ مرورگر قطع شد — رندرِ بعدی دوباره راه‌اندازی می‌کند'); browser = null; });
  log('✓ Chromium آماده است');
}

async function renderWithPlaywright(job) {
  await ensurePlaywright();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'fa-IR',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'fa,en;q=0.8' },
  });
  let status = 0;
  try {
    const page = await context.newPage();

    if (job.blockResources) {
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        const host = safeHost(route.request().url());
        if (['image', 'media', 'font'].includes(type)) return route.abort();
        if (BLOCK_HOSTS.some(h => host.endsWith(h))) return route.abort();
        return route.continue();
      });
    } else if (BLOCK_HOSTS.length) {
      await page.route('**/*', (route) => {
        const host = safeHost(route.request().url());
        return BLOCK_HOSTS.some(h => host.endsWith(h)) ? route.abort() : route.continue();
      });
    }

    const resp = await page.goto(job.url, {
      waitUntil: job.waitUntil,
      timeout: job.timeout,
    });
    status = resp ? resp.status() : 0;

    if (job.selector) {
      try { await page.waitForSelector(job.selector, { timeout: Math.min(10000, job.timeout) }); }
      catch { /* سلکتور نیامد — همین HTML برگردد */ }
    }
    if (job.scroll) {
      await autoScroll(page, 8, 450);
    }
    await page.waitForTimeout(400); // کلنجارِ رندرهای پرُشتاب

    return {
      code: status,
      url: page.url(),
      title: await page.title().catch(() => ''),
      html: await page.content(),
    };
  } finally {
    await context.close().catch(() => {});   // صفحهٔ یتیم نمی‌ماند
  }
}

async function autoScroll(page, rounds, waitMs) {
  for (let i = 0; i < rounds; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.max(600, window.innerHeight)));
    await page.waitForTimeout(waitMs);
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

/* ------------------------------------------------------------ Selenium */
/* WebDriverِ W3C خام روی HTTP — هیچ وابستگیِ npm اضافه‌ای لازم نیست */
async function wd(cmdPath, method, body) {
  const resp = await fetch(SELENIUM_URL + cmdPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (json && json.value && json.value.message) || ('HTTP ' + resp.status);
    throw new Error('webdriver: ' + msg);
  }
  return json;
}

let seleniumChecked = null;
async function ensureSelenium() {
  if (seleniumChecked && Date.now() - seleniumChecked < 60000) return;
  const r = await fetch(SELENIUM_URL + '/status').then(r => r.json()).catch(e => { throw new Error('selenium unreachable: ' + e.message); });
  seleniumChecked = Date.now();
  log('✓ Selenium آماده است:', (r && r.value && r.value.ready) ? 'ready' : 'unknown');
}

async function renderWithSelenium(job) {
  await ensureSelenium();
  let sid = null;
  const caps = {
    capabilities: {
      alwaysMatch: {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: [HEADLESS ? '--headless=new' : '--headless=false', '--no-sandbox',
                 '--disable-dev-shm-usage', '--disable-gpu', '--lang=fa'],
        },
      },
    },
  };
  try {
    const s = await wd('/session', 'POST', caps);
    sid = s.sessionId || (s.value && (s.value.sessionId || s.value));
    if (!sid || typeof sid !== 'string') throw new Error('bad session id');

    await wd('/session/' + sid + '/url', 'POST', { url: job.url });

    // صبر برای complete شدنِ سند (WebDriver حالت networkidle ندارد)
    const deadline = Date.now() + job.timeout;
    for (;;) {
      const st = await wd('/session/' + sid + '/execute/sync', 'POST',
        { script: 'return document.readyState', args: [] });
      if (st.value === 'complete' || Date.now() > deadline) break;
      await sleep(300);
    }
    if (job.selector) {
      const until = Date.now() + Math.min(10000, job.timeout);
      for (;;) {
        const found = await wd('/session/' + sid + '/execute/sync', 'POST',
          { script: 'return !!document.querySelector(arguments[0])', args: [job.selector] });
        if (found.value || Date.now() > until) break;
        await sleep(250);
      }
    }
    if (job.scroll) {
      for (let i = 0; i < 8; i++) {
        await wd('/session/' + sid + '/execute/sync', 'POST',
          { script: 'window.scrollBy(0, Math.max(600, window.innerHeight))', args: [] });
        await sleep(420);
      }
      await wd('/session/' + sid + '/execute/sync', 'POST',
        { script: 'window.scrollTo(0,0)', args: [] }).catch(() => {});
    }

    const html = (await wd('/session/' + sid + '/source', 'GET')).value || '';
    const finalUrl = (await wd('/session/' + sid + '/url', 'GET')).value || job.url;
    const title = (await wd('/session/' + sid + '/title', 'GET')).value || '';
    return { code: 200, url: finalUrl, title, html };
  } finally {
    if (sid) await wd('/session/' + sid, 'DELETE').catch(() => {});
  }
}

/* ------------------------------------------------------------- درایور */
async function chooseDriver() {
  if (DRIVER_PREF === 'playwright') return 'playwright';
  if (DRIVER_PREF === 'selenium') return 'selenium';
  // auto
  try { await ensurePlaywright(); return 'playwright'; }
  catch (e) { log('⚠ Playwright بالا نیامد:', e.message); }
  await ensureSelenium();
  return 'selenium';
}
async function doRender(job) {
  if (job.driver === 'playwright') return renderWithPlaywright(job);
  return renderWithSelenium(job);
}

/* -------------------------------------------------------------- HTTP */
function safeHost(u) { try { return new URL(u).hostname; } catch { return ''; } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function readJson(req, cap = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > cap) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const WAIT_UNTILS = new Set(['load', 'domcontentloaded', 'networkidle']);

function send(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');

    if (req.method === 'GET' && u.pathname === '/health') {
      return send(res, 200, {
        ok: true,
        driver: driverKind || DRIVER_PREF,
        active, queued: waiters.length,
        max_concurrency: MAX_CONCURRENCY,
        uptime_s: Math.floor((Date.now() - startedAt) / 1000),
      });
    }

    if (req.method !== 'POST' || u.pathname !== '/render') {
      return send(res, 404, { ok: false, error: 'not found' });
    }
    if (TOKEN && req.headers['authorization'] !== 'Bearer ' + TOKEN) {
      return send(res, 401, { ok: false, error: 'unauthorized' });
    }

    const body = await readJson(req);
    const targetUrl = String(body.url || '');
    if (!/^https?:\/\//i.test(targetUrl)) {
      return send(res, 422, { ok: false, error: 'invalid url' });
    }

    const job = {
      url: targetUrl,
      waitUntil: WAIT_UNTILS.has(body.waitUntil) ? body.waitUntil : 'domcontentloaded',
      selector: typeof body.selector === 'string' ? body.selector.slice(0, 300) : '',
      timeout: Math.max(5000, Math.min(120000, parseInt(body.timeout, 10) || NAV_TIMEOUT)),
      scroll: body.scroll === true || body.scroll === 'true' || body.scroll === 1,
      blockResources: body.blockResources === true || body.blockResources === 1,
      driver: driverKind,
    };

    try {
      await acquire();
    } catch {
      res.setHeader?.('Retry-After', '3');
      return send(res, 503, { ok: false, code: 0, error: 'render busy — retry' });
    }

    const t0 = Date.now();
    try {
      const out = await doRender(job);
      return send(res, 200, {
        ok: true, code: out.code, url: out.url, title: out.title,
        html: out.html, driver: job.driver, took_ms: Date.now() - t0,
      });
    } catch (e) {
      const banned = e && e.message === 'queue_timeout';
      return send(res, banned ? 503 : 502, { ok: false, code: 0, error: String(e && e.message || e).slice(0, 400), driver: job.driver, took_ms: Date.now() - t0 });
    } finally {
      release();
    }
  } catch (e) {
    return send(res, 500, { ok: false, error: String(e && e.message || e).slice(0, 400) });
  }
});

let driverKind = null;
process.on('unhandledRejection', (e) => log('unhandledRejection:', e && e.message || e));
process.on('uncaughtException',  (e) => log('uncaughtException:', e && e.message || e));

function shutdown(sig) {
  log(sig + ' — خاموشِ تمیز');
  server.close(() => {
    if (browser) browser.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2500).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

(async () => {
  driverKind = await chooseDriver().catch((e) => {
    log('هشدار: هیچ درایوری در شروع آماده نشد — در اولین درخواست دوباره تلاش می‌شود.', e.message);
    return DRIVER_PREF === 'selenium' ? 'selenium' : 'playwright';
  });
  server.listen(PORT, HOST, () => {
    log(`render service listening on http://${HOST}:${PORT} (driver=${driverKind}, workers≤${MAX_CONCURRENCY})`);
  });
})();
