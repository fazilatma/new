import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { load } from 'cheerio';

// Locks in the snappshop.ir field report (2026-09-12): a benchmark where every
// direct engine died with HTTP 429 (pages=0), a pasted Chrome copy-XPath
// container (`//*[@id="dq6e01"]/div[1]/div/div/div[3]/a[1]/article`) failed
// EVERY selector path with «Empty sub-selector», the profile URL carried a
// stale `page=336` cursor so the 3-page probe scanned dead pages, and the
// diagnosis hints blamed the site's content for what were transport failures.
//
// 1.141.0 answers: a Chrome-dialect XPath→CSS converter at every selector
// eval site, one bounded 429 retry honouring Retry-After, fetch-aware
// diagnosis hints (fetch failures beat content guesses, broken selectors
// keep priority), and a benchmark probe URL that resets the page cursor
// while keeping filters. No live snappshop HTML was obtainable (the shop
// 403s datacenter/VPN IPs), so the barfbox fixture carries the selector
// paths and the network/URL logic is pinned with stubbed fetch.

// --- worker twin bundle: scraper + env + network in ONE bundle so that
// configureEnv() shares its module instance with safeFetch(). ---
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-snapp-'));
await writeFile(join(temporary, 'entry.ts'),
  `export * from ${JSON.stringify(join(ROOT, 'worker-src', 'scraper.ts'))};\n` +
  `export { configureEnv } from ${JSON.stringify(join(ROOT, 'worker-src', 'env.ts'))};\n` +
  `export { safeText as networkSafeText } from ${JSON.stringify(join(ROOT, 'worker-src', 'network.ts'))};\n`);
await build({ entryPoints: { worker: join(temporary, 'entry.ts') }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const HTML_VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
class CheerioHTMLRewriter {
  constructor() { this.registrations = []; }
  on(selector, handler) { load('<i></i>')(selector); this.registrations.push({ selector, handler }); return this; }
  transform(response) { return new Response(new ReadableStream({ start: async controller => { try { const source = await response.text(), $ = load(source, { decodeEntities: true }), roots = $.root().contents().toArray(); for (const root of roots) this.#walk($, root, []); controller.enqueue(new TextEncoder().encode($.html())); controller.close(); } catch (error) { controller.error(error); } } })); }
  #walk($, node, active) {
    if (node.type === 'text') { for (const handler of active) handler.text?.({ text: node.data || '', lastInTextNode: true }); return; }
    if (node.type === 'comment') return;
    const matching = [];
    if (node.type === 'tag') for (const registration of this.registrations) if ($(node).is(registration.selector)) matching.push(registration.handler);
    const callbacks = [], wrapper = {
      tagName: node.name, getAttribute: name => node.attribs?.[name] ?? null, setAttribute: (name, value) => $(node).attr(name, value), removeAttribute: name => $(node).removeAttr(name),
      before: (value) => $(node).before(value), after: (value) => $(node).after(value), remove: () => $(node).remove(), onEndTag: callback => { if (HTML_VOID_TAGS.has(String(node.name).toLowerCase())) throw Error('Parser error: No end tag.'); callbacks.push(callback); },
      get attributes() { return Object.entries(node.attribs || {}); }
    };
    for (const handler of matching) handler.element?.(wrapper);
    const scoped = [...active, ...matching]; for (const child of [...(node.children || [])]) this.#walk($, child, scoped);
    for (const callback of callbacks.reverse()) callback();
  }
}
globalThis.HTMLRewriter = CheerioHTMLRewriter;
const worker = await import(pathToFileURL(join(temporary, 'worker.mjs')));

// --- render twin bundles (same approach as scripts/lab-probe.mjs) ---
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-snapp-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
await build({ entryPoints: { network: join(ROOT, 'render-src', 'network.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));
const renderNetwork = require(join(rtmp, 'network.cjs'));

const BASE = 'https://barfbox.ir/';
const html = await readFile(join(ROOT, 'worker-tests', 'fixtures', 'barfbox-cards.html'), 'utf8');
const XPATH_SELECTORS = {
  container: '//div[@class="flex flex-col gap-2 p-3 bg-white rounded-2xl shadow w-[320px]"]',
  title: '//div[@class="text-[13px] font-bold leading-6"]',
  price: '//span[@class="text-[15px] font-black text-rose-600"]',
  link: '//a[contains(@href, "/product/")]',
  image: '//img'
};

test('snapp: the XPath converter translates the Chrome dialect identically on both twins', async () => {
  const vectors = [
    ['//*[@id="dq6e01"]/div[1]/div/div/div[3]/a[1]/article', '[id="dq6e01"] > div:nth-of-type(1) > div > div > div:nth-of-type(3) > a:nth-of-type(1) > article'],
    ['/html/body/div[2]/span', 'html > body > div:nth-of-type(2) > span'],
    ['//div', 'div'],
    ['//a[contains(@href, "/product/")]', 'a[href*="/product/"]'],
    ["//img[starts-with(@src, 'https://')]", 'img[src^="https://"]'],
    ['//div[@class="a b" and @id="x"]', 'div[class="a b"][id="x"]'],
    ['//li[position()=3]', 'li:nth-of-type(3)'],
    ['//li[last()]', 'li:last-of-type'],
    ['//*[@id="x" and contains(@class, "card")]', '[id="x"][class*="card"]'],
    ['./div/span', ':scope > div > span'],
    ['.//div[@id="m"]//span', 'div[id="m"] span'],
    ['//h1 | //h2', 'h1, h2'],
    ['//div//span//a', 'div span a'],
    ['//div[1][@class="x"]', 'div:nth-of-type(1)[class="x"]']
  ];
  for (const [input, expected] of vectors) {
    assert.equal(render.xpathToCss(input), expected, `render must convert ${input}`);
    assert.equal(worker.xpathToCss(input), expected, `worker must convert ${input}`);
    assert.equal(render.isXPathSelector(input), true, `render must flag ${input} as XPath`);
    assert.equal(worker.isXPathSelector(input), true, `worker must flag ${input} as XPath`);
  }
  // Out-of-dialect XPath and plain CSS both convert to null (callers keep the
  // original: CSS evaluates as-is, unconvertible XPath fails honestly).
  for (const input of ['(//div)[2]', '//div/..', '//a/@href', '//div/text()', '//li[following-sibling::li]',
      '//div[@*]', '//div[text()="x"]', '//a[@a="1" or @b="2"]', '//div[name()="x"]',
      'div.card', '.card > a', 'a[href*="/p/"]', 'div:nth-of-type(2)', '']) {
    assert.equal(render.xpathToCss(input), null, `render must not convert ${JSON.stringify(input)}`);
    assert.equal(worker.xpathToCss(input), null, `worker must not convert ${JSON.stringify(input)}`);
  }
  for (const css of ['div.card', '.a > #b', 'a[href*="/p/"]']) {
    assert.equal(render.isXPathSelector(css), false, `render must not flag CSS ${css} as XPath`);
    assert.equal(worker.isXPathSelector(css), false, `worker must not flag CSS ${css} as XPath`);
  }
});

test('snapp: pasted-XPath selectors extract end to end on both twins', async () => {
  const cards = await worker.parseCards(html, BASE, XPATH_SELECTORS);
  assert.equal(cards.length, 12, `worker must extract all 12 cards via XPath, got ${cards.length}`);
  assert.ok(cards.every(p => p.title && p.price > 0 && p.url && p.image), 'worker XPath products must be complete');
  // Render cheerio yields 11 here exactly as with the equivalent CSS
  // selectors (one card's title sits where the scoped lookup cannot reach);
  // the point is XPath parity with CSS, not a new maximum.
  const cheerioCards = render.scrapeListCheerioFromHtml(html, BASE, XPATH_SELECTORS);
  assert.equal(cheerioCards.length, 11, `render cheerio must match its CSS baseline via XPath, got ${cheerioCards.length}`);
  const renderVerified = await render.verifyListSelectors(html, BASE, XPATH_SELECTORS);
  assert.equal(renderVerified.ok, true, `render verify must pass on XPath selectors, got ${renderVerified.error}`);
  assert.equal(renderVerified.containerCount, 12, 'render verify must count all 12 XPath containers');
  const workerVerified = await worker.verifyListSelectors(html, BASE, XPATH_SELECTORS);
  assert.equal(workerVerified.ok, true, 'worker verify must pass on XPath selectors');
  assert.equal(workerVerified.containerCount, 12, 'worker verify must count all 12 XPath containers');
});

test('snapp: a fully positional Chrome path widens to the repeating grid (render)', async () => {
  const mini = '<div class="wrap"><div class="card"><a class="l" href="https://x.test/p/1"><span class="t">Alpha</span><span class="p">100</span></a></div>'
    + '<div class="card"><a class="l" href="https://x.test/p/2"><span class="t">Beta</span><span class="p">200</span></a></div></div>';
  const selectors = { container: '//div[@class="wrap"]/div[1]', title: '//span[@class="t"]', price: '//span[@class="p"]', link: '//a[@class="l"]', image: '//img' };
  const found = render.scrapeListCheerioFromHtml(mini, 'https://x.test/', selectors);
  assert.equal(found.length, 2, `Chrome [N] pins must widen to both cards, got ${found.length}`);
  assert.deepEqual(found.map(p => p.title), ['Alpha', 'Beta']);
  assert.deepEqual(found.map(p => p.price), [100, 200]);
  const workerFound = await worker.parseCards(mini, 'https://x.test/', selectors);
  assert.ok(Array.isArray(workerFound) && workerFound.length >= 1, 'worker must evaluate the converted path without crashing');
});

test('snapp: out-of-dialect XPath fails honestly instead of matching wrong elements', async () => {
  const bad = { ...XPATH_SELECTORS, container: '(//div)[2]' };
  const verified = await render.verifyListSelectors(html, BASE, bad);
  assert.equal(verified.ok, false, 'render verify must fail on (//div)[2]');
  assert.ok(String(verified.error || '').startsWith('سلکتور نامعتبر «(//div)[2]»'), `render verify must tag it, got ${verified.error}`);
  assert.throws(() => render.scrapeListCheerioFromHtml(html, BASE, bad), /سلکتور نامعتبر «\(\/\/div\)\[2\]»/,
    'render extraction must throw the tagged message, not the raw engine error');
  // The worker is loud on a bad CONTAINER (only bad FIELD selectors skip
  // silently): no container part compiles, so parseCards refuses the run.
  await assert.rejects(worker.parseCards(html, BASE, bad), /سلکتور ظرف محصول نامعتبر است\./,
    'worker parseCards must refuse an uncompilable container');
  const workerVerified = await worker.verifyListSelectors(html, BASE, bad);
  assert.equal(workerVerified.ok, false, 'worker verification must fail honestly');
});

test('snapp: a 429 is retried once (Retry-After honoured), then reported honestly', async () => {
  const realFetch = globalThis.fetch;
  const script = [];
  globalThis.fetch = async (url, init) => {
    const next = script.shift();
    if (!next) throw new Error('fetch stub ran dry');
    calls++;
    return new Response(next.body, { status: next.status, headers: next.headers || {} });
  };
  let calls = 0;
  try {
    worker.configureEnv({ DB: {} });
    // 429 then recovery: one retry, then success.
    script.push({ status: 429, headers: { 'retry-after': '0' }, body: 'slow down' }, { status: 200, body: 'recovered-page' });
    calls = 0;
    const first = await worker.networkSafeText('https://shop.test/cat?page=1');
    assert.equal(first.text, 'recovered-page', 'worker must return the retried page');
    assert.equal(calls, 2, 'worker must fire exactly one retry');
    // 429 twice: the retry also throttled — fail with the honest HTTP error.
    script.push({ status: 429, headers: { 'retry-after': '0' }, body: 'slow' }, { status: 429, body: 'still slow' });
    calls = 0;
    await assert.rejects(() => worker.networkSafeText('https://shop.test/cat?page=2'), /HTTP 429/,
      'worker must surface HTTP 429 after the retry is exhausted');
    assert.equal(calls, 2, 'worker must not retry more than once');
    // 403 is a ban, not a throttle: fail fast with no retry.
    script.push({ status: 403, body: 'denied' });
    calls = 0;
    await assert.rejects(() => worker.networkSafeText('https://shop.test/cat?page=3'), /HTTP 403/,
      'worker must surface HTTP 403');
    assert.equal(calls, 1, 'worker must not retry a 403');
    // Retry-After: 1 waits ~1s before the retry (honoured, not ignored).
    script.push({ status: 429, headers: { 'retry-after': '1' }, body: 'wait' }, { status: 200, body: 'late-page' });
    calls = 0;
    const started = Date.now();
    const late = await worker.networkSafeText('https://shop.test/cat?page=4');
    assert.equal(late.text, 'late-page');
    assert.ok(Date.now() - started >= 900, 'worker must honour Retry-After before retrying');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('snapp: the render twin retries 429s the same way (attempts only)', async () => {
  const realFetch = globalThis.fetch;
  const dnsPromises = require('node:dns/promises');
  const realLookup = dnsPromises.lookup;
  dnsPromises.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const script = [];
  let calls = 0;
  globalThis.fetch = async () => {
    const next = script.shift();
    if (!next) throw new Error('fetch stub ran dry');
    calls++;
    return new Response(next.body, { status: next.status, headers: next.headers || {} });
  };
  try {
    script.push({ status: 429, headers: { 'retry-after': '0' }, body: 'slow down' }, { status: 200, body: 'recovered-page' });
    calls = 0;
    const first = await renderNetwork.safeText('https://shop.test/cat?page=1');
    assert.equal(first.text, 'recovered-page', 'render must return the retried page');
    assert.equal(calls, 2, 'render must fire exactly one retry');
    script.push({ status: 429, headers: { 'retry-after': '0' }, body: 'slow' }, { status: 429, body: 'still slow' });
    calls = 0;
    await assert.rejects(() => renderNetwork.safeText('https://shop.test/cat?page=2'), /HTTP 429/,
      'render must surface HTTP 429 after the retry is exhausted');
    assert.equal(calls, 2, 'render must not retry more than once');
    script.push({ status: 403, body: 'denied' });
    calls = 0;
    await assert.rejects(() => renderNetwork.safeText('https://shop.test/cat?page=3'), /HTTP 403/,
      'render must surface HTTP 403');
    assert.equal(calls, 1, 'render must not retry a 403');
  } finally {
    globalThis.fetch = realFetch;
    dnsPromises.lookup = realLookup;
  }
});

test('snapp: fetch errors translate to hints; selector errors are not fetch failures', async () => {
  const vectors = [
    ['HTTP 429 from https://shop.test/cat', '429'],
    ['HTTP 403 from https://shop.test/cat', '403'],
    ['مهلت دریافت https://shop.test/cat تمام شد.', 'دریافت صفحه'],
    ['fetch failed', 'دریافت صفحه'],
    ['HTTP 503 from https://shop.test/cat', 'دریافت صفحه']
  ];
  for (const [error, fragment] of vectors) {
    assert.ok(render.fetchErrorHint(error).includes(fragment), `render must translate ${error}`);
    assert.ok(worker.fetchErrorHint(error).includes(fragment), `worker must translate ${error}`);
  }
  for (const error of ['', 'سلکتور نامعتبر «div.broken[attr»: Empty sub-selector', 'Unexpected token < in JSON']) {
    assert.equal(render.fetchErrorHint(error), '', `render must not translate ${JSON.stringify(error)}`);
    assert.equal(worker.fetchErrorHint(error), '', `worker must not translate ${JSON.stringify(error)}`);
  }
});

test('snapp: the diagnosis leads with the fetch error and hints the wait, not the content', async () => {
  const throttled = 'HTTP 429 from https://shop.test/cat?page=1';
  const bare = '<html><head><title>shop</title></head><body><p>shell</p></body></html>';
  for (const [name, twin, engine] of [['worker', worker, 'script_json'], ['render', render, 'script_json']]) {
    const diag = await twin.diagnoseBenchmarkEngine(engine, bare, 'https://shop.test/', {}, [], throttled);
    assert.ok(String(diag.dropReasons[0] || '').includes('HTTP 429'), `${name} reasons must lead with the fetch error, got ${diag.dropReasons[0]}`);
    assert.ok(diag.hint.includes('429'), `${name} hint must name the throttle, got ${diag.hint}`);
    assert.ok(!diag.hint.includes('ساختار JSON'), `${name} hint must not blame the page content for a transport failure`);
  }
  // Render: a broken selector keeps priority over the throttle, because no
  // retry can fix it — but the fetch error stays in the reasons too.
  {
    const selectors = { container: 'div.broken[attr', title: 'h2', price: '.p', link: 'a', image: 'img' };
    const diag = await render.diagnoseBenchmarkEngine('cheerio', bare, 'https://shop.test/', selectors, [], throttled);
    assert.ok(diag.dropReasons.some(r => String(r).includes('HTTP 429')), 'render reasons must keep the fetch error');
    assert.ok(diag.dropReasons.some(r => String(r).includes('سلکتور نامعتبر')), 'render reasons must keep the tagged selector');
    assert.ok(diag.hint.includes('پیشنهاد خودکار سلکتورها'), `render hint must stay on the fixable selector, got ${diag.hint}`);
  }
  // Worker: safeOn skips bad selectors silently, so the breakage is invisible
  // there and the fetch failure honestly leads instead.
  {
    const selectors = { container: 'div.broken[attr', title: 'h2', price: '.p', link: 'a', image: 'img' };
    const diag = await worker.diagnoseBenchmarkEngine('htmlrewriter', bare, 'https://shop.test/', selectors, [], throttled);
    assert.ok(String(diag.dropReasons[0] || '').includes('HTTP 429'), `worker reasons must lead with the fetch error, got ${diag.dropReasons[0]}`);
    assert.ok(diag.hint.includes('429'), `worker hint must name the throttle, got ${diag.hint}`);
  }
});

test('snapp: browser engines hint auto-suggest for broken selectors instead of echoing', async () => {
  const tagged = 'سلکتور نامعتبر «//*[@id="dq6e01"]»: Empty sub-selector';
  for (const [name, twin] of [['worker', worker], ['render', render]]) {
    const diag = await twin.diagnoseBenchmarkEngine('playwright', '<html><body></body></html>', 'https://shop.test/', {}, [], tagged);
    assert.ok(diag.hint.includes('پیشنهاد خودکار سلکتورها'), `${name} browser hint must point at auto-suggest, got ${diag.hint}`);
    const throttled = await twin.diagnoseBenchmarkEngine('playwright', '<html><body></body></html>', 'https://shop.test/', {}, [], 'HTTP 429 from https://shop.test/');
    assert.ok(throttled.hint.includes('429'), `${name} browser hint must translate the throttle, got ${throttled.hint}`);
  }
});

test('snapp: the benchmark probe resets the page cursor but keeps every filter', async () => {
  const profiles = [
    [{ url: 'https://snappshop.ir/category/kitchen-appliances?is_available=true&page=336', pagination: 'query' },
      'https://snappshop.ir/category/kitchen-appliances?is_available=true'],
    [{ url: 'https://shop.test/cat?page=336&sort=new&brand=x', pagination: 'query' },
      'https://shop.test/cat?sort=new&brand=x'],
    [{ url: 'https://shop.test/cat?paged=45&sort=price', pagination: 'query_custom', paginationValue: 'paged' },
      'https://shop.test/cat?sort=price'],
    [{ url: 'https://shop.test/cat/page/336/', pagination: 'path_page' }, 'https://shop.test/cat'],
    [{ url: 'https://shop.test/cat?foo=1#reviews', pagination: 'query' }, 'https://shop.test/cat?foo=1'],
    [{ url: 'https://shop.test/cat?page=7', pagination: 'none' }, 'https://shop.test/cat?page=7'],
    [{ url: 'https://shop.test/cat?page=7', pagination: 'next_selector' }, 'https://shop.test/cat?page=7'],
    [{ url: 'https://shop.test/cat?p=99', pagination: 'query' }, 'https://shop.test/cat?p=99'],
    [{ url: 'not a url at all', pagination: 'query' }, 'not a url at all']
  ];
  for (const [profile, expected] of profiles) {
    assert.equal(render.benchmarkProbeUrl(profile), expected, `render probe of ${profile.url}`);
    assert.equal(worker.benchmarkProbeUrl(profile), expected, `worker probe of ${profile.url}`);
  }
  // And the probe then paginates 1-2-3, never 336-337-338.
  for (const [name, twin] of [['worker', worker], ['render', render]]) {
    const probe = { url: twin.benchmarkProbeUrl(profiles[0][0]), pagination: 'query' };
    assert.equal(twin.pageUrl(probe, 1), 'https://snappshop.ir/category/kitchen-appliances?is_available=true');
    assert.ok(twin.pageUrl(probe, 2).includes('page=2'), `${name} page 2 must be page=2, got ${twin.pageUrl(probe, 2)}`);
    assert.ok(twin.pageUrl(probe, 3).includes('page=3'), `${name} page 3 must be page=3`);
    const pathProbe = { url: twin.benchmarkProbeUrl(profiles[3][0]), pagination: 'path_page' };
    assert.ok(twin.pageUrl(pathProbe, 2).endsWith('/page/2/'), `${name} path page 2 must reset, got ${twin.pageUrl(pathProbe, 2)}`);
  }
});

test('snapp: the Python pipeline eats the same XPaths natively (cross-check)', async (t) => {
  const probe = spawnSync('python3', ['-c', 'import bs4, lxml'], { encoding: 'utf8' });
  if (probe.status !== 0) { t.skip('python3+beautifulsoup4+lxml not installed'); return; }
  const py = spawnSync('python3', [join(ROOT, 'scripts', 'py-auto-extract.py'), '--html-file',
    join(ROOT, 'worker-tests', 'fixtures', 'barfbox-cards.html'), '--base', BASE,
    '--selectors', JSON.stringify(XPATH_SELECTORS), '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(py.status, 0, `py-auto-extract must run: ${(py.stderr || '').trim().split('\n').pop()}`);
  const out = JSON.parse(py.stdout);
  assert.equal(out.products.length, 12, `Python must extract all 12 cards via XPath, got ${out.products.length}`);
});
