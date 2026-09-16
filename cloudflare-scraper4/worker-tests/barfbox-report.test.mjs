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

// Locks in the barfbox.ir field report (2026-09-12): 12 Tailwind cards with
// bare Persian prices («۵۲۵٬۰۰۰», no currency word), /product/ links, lazy
// data-src images, discount <del> cards and category/tag noise — but the
// benchmark extracted 3 products via heuristic, crashed both selector engines
// with «Attribute selector didn't terminate» (pages=0), and auto-discovery
// found nothing. The Python pipeline (scripts/py-auto-extract.py, lifted from
// scraper4.py 10.149) extracts all 12 and is the cross-check baseline.

// --- worker twin bundle (same approach as engine-diagnosis.test.mjs) ---
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-barfbox-'));
await build({ entryPoints: { scraper: join(ROOT, 'worker-src', 'scraper.ts') }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
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
const worker = await import(pathToFileURL(join(temporary, 'scraper.mjs')));

// --- render twin bundle (same approach as scripts/lab-probe.mjs) ---
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-render-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));

const BASE = 'https://barfbox.ir/';
const html = await readFile(join(ROOT, 'worker-tests', 'fixtures', 'barfbox-cards.html'), 'utf8');
const BAD_SELECTORS = { container: 'div.flex', title: 'div.broken[attr', price: '.price', link: 'a[href]', image: 'img' };

test('barfbox: both heuristic twins extract all 12 cards, bare prices included', async () => {
  for (const [name, fn] of [['worker', () => worker.extractHeuristicProducts(html, BASE)], ['render', () => render.heuristicProducts(html, BASE)]]) {
    const products = await fn();
    assert.equal(products.length, 12, `${name} heuristic must extract all 12 cards, got ${products.length}`);
    const prices = products.map(p => p.price).sort((a, b) => a - b);
    for (const expected of [525000, 255000, 389000, 1375000, 139000, 215000, 130000, 159000, 399]) {
      assert.ok(prices.includes(expected), `${name} heuristic must include price ${expected}, got ${prices.join(',')}`);
    }
    // Discount cards keep the SALE price (<del> old price is stripped first).
    for (const expected of [189000, 120000, 795000]) {
      assert.ok(prices.includes(expected), `${name} heuristic must pick the sale price ${expected}`);
    }
    for (const was of [203000, 167000, 940000]) {
      assert.ok(!prices.includes(was), `${name} heuristic must not ship the crossed-out price ${was}`);
    }
    // Lazy data-src wins over the data: placeholder; ?vid= links survive;
    // category/tag/search links never become products.
    assert.ok(products.every(p => p.image && !p.image.startsWith('data:')), `${name} heuristic images must be real URLs`);
    assert.ok(products.some(p => p.url.includes('?vid=1841')), `${name} heuristic must keep ?vid= product links`);
    assert.ok(products.every(p => !/(category|tag|search)/.test(p.url)), `${name} heuristic must exclude category/tag/search links`);
  }
});

test('barfbox: discovery finds the structural grid on both twins (no curated veto)', async () => {
  for (const [name, twin] of [['worker', worker], ['render', render]]) {
    const found = await twin.discoverListSelectorsFromHtml(html, BASE);
    assert.equal(found.method, 'structural', `${name} discovery must be structural, got ${found.method}`);
    assert.ok(found.selectors.container && found.selectors.title, `${name} discovery must propose container+title`);
    assert.ok(found.containerCount >= 10, `${name} discovery must verify ~12 cards, got ${found.containerCount}`);
  }
});

test('barfbox: discovered selectors extract via the selector engines', async () => {
  const found = await render.discoverListSelectorsFromHtml(html, BASE);
  const cards = await worker.parseCards(html, BASE, found.selectors);
  assert.ok(cards.length >= 10, `worker parseCards must extract ~12 cards, got ${cards.length}`);
  const cheerioCards = await render.scrapeListCheerioFromHtml(html, BASE, found.selectors);
  assert.ok(cheerioCards.length >= 10, `render cheerio must extract ~12 cards, got ${cheerioCards.length}`);
});

test('barfbox: an invalid field selector fails LOUD with its own text (render)', async () => {
  const verified = await render.verifyListSelectors(html, BASE, BAD_SELECTORS);
  assert.equal(verified.ok, false, 'verification must fail');
  assert.ok(verified.containerCount > 0, 'container count stays honest instead of throwing');
  assert.ok(String(verified.error || '').startsWith('سلکتور نامعتبر «div.broken[attr»'), `verify must tag the bad selector, got ${verified.error}`);
  assert.throws(() => render.scrapeListCheerioFromHtml(html, BASE, BAD_SELECTORS), /سلکتور نامعتبر «div\.broken\[attr»/,
    'cheerio extraction must throw the tagged message, not the raw engine error');
});

test('barfbox: an invalid field selector never crashes the worker twin', async () => {
  const cards = await worker.parseCards(html, BASE, BAD_SELECTORS);
  assert.ok(Array.isArray(cards), 'worker parseCards must survive (safeOn skips the bad selector)');
  const verified = await worker.verifyListSelectors(html, BASE, BAD_SELECTORS);
  assert.equal(verified.ok, false, 'worker verification must fail honestly');
});

test('barfbox: the diagnosis names the broken selector instead of blaming the container', async () => {
  const tagged = 'سلکتور نامعتبر «div.broken[attr»: Attribute selector didn\'t terminate';
  for (const [name, twin, engine] of [['worker', worker, 'htmlrewriter'], ['render', render, 'cheerio']]) {
    const diag = await twin.diagnoseBenchmarkEngine(engine, html, BASE, BAD_SELECTORS, [], tagged);
    assert.ok(String(diag.dropReasons[0] || '').startsWith('سلکتور نامعتبر'), `${name} diagnosis must lead with the tagged error, got ${diag.dropReasons[0]}`);
    assert.ok(!diag.dropReasons.some(r => r.includes('هیچ کارتی در صفحه پیدا نکرد')), `${name} diagnosis must not claim the container found nothing`);
    assert.ok(diag.hint.includes('پیشنهاد خودکار سلکتورها'), `${name} diagnosis must point at auto-suggest`);
  }
});

test('barfbox: explicit engine falls back on throw in real runs, stays loud in probes (render loop)', async () => {
  // The engine loop fetches via safeText, which refuses local URLs (SSRF
  // guard), so the loop test bundles the render twin with a stubbed network
  // module serving this fixture.
  const stubDir = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-net-'));
  const thin = '<html><body><div class="flex"><span>no product here</span></div></body></html>';
  await writeFile(join(stubDir, 'stub-network.mjs'),
    `const FIX=${JSON.stringify(html)};\nconst THIN=${JSON.stringify(thin)};\n` +
    `export async function safeText(raw){ const u=String(raw); return { text: u.includes('/thin') ? THIN : FIX, url: u }; }\n` +
    `export function sourceRoute(){ return 'direct'; }`);
  const outdir = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-loop-'));
  const stubPlugin = { name: 'stub-network', setup(b) { b.onResolve({ filter: /network\.js$/ }, () => ({ path: join(stubDir, 'stub-network.mjs') })); } };
  await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir, entryNames: '[name]', outExtension: { '.js': '.cjs' }, plugins: [stubPlugin] });
  const looped = require(join(outdir, 'scraper.cjs'));
  // Real run: explicit cheerio throws on the bad selector, heuristic rescues it.
  const rescued = await looped.scrapeListWithMeta(`${BASE}`, BAD_SELECTORS, 'cheerio', undefined, true);
  assert.equal(rescued.products.length, 12, 'a throwing explicit engine must fall back, not kill the run');
  assert.equal(rescued.usedEngine, 'heuristic', 'the fallback engine must be reported honestly');
  assert.ok(!rescued.engineError, 'a rescued run carries no engineError');
  // Benchmark probe: single-engine list, the tagged error stays loud.
  await assert.rejects(looped.scrapeListWithMeta(`${BASE}`, BAD_SELECTORS, 'cheerio', undefined, false), /سلکتور نامعتبر «div\.broken\[attr»/,
    'a benchmark probe must surface the tagged error, not substitute another engine');
  // Hopeless page: no throw in real runs, but the cause is reported.
  const hopeless = await looped.scrapeListWithMeta(`${BASE}thin`, BAD_SELECTORS, 'cheerio', undefined, true);
  assert.equal(hopeless.products.length, 0, 'a page with no products yields none');
  assert.ok(String(hopeless.engineError || '').startsWith('سلکتور نامعتبر «div.broken[attr»'), `engineError must name the cause, got ${hopeless.engineError}`);
  // Explicit choice with working selectors is still preferred (no silent swap).
  const found = await render.discoverListSelectorsFromHtml(html, BASE);
  const direct = await looped.scrapeListWithMeta(`${BASE}`, found.selectors, 'cheerio', undefined, true);
  assert.equal(direct.usedEngine, 'cheerio', 'a working explicit engine must be used, not substituted');
  assert.ok(direct.products.length >= 10, 'explicit cheerio extracts the grid');
});

test('barfbox: the Python pipeline agrees on the same HTML (cross-check)', async (t) => {
  const probe = spawnSync('python3', ['-c', 'import bs4'], { encoding: 'utf8' });
  if (probe.status !== 0) { t.skip('python3+beautifulsoup4 not installed'); return; }
  const py = spawnSync('python3', [join(ROOT, 'scripts', 'py-auto-extract.py'), '--html-file',
    join(ROOT, 'worker-tests', 'fixtures', 'barfbox-cards.html'), '--base', BASE, '--json'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(py.status, 0, `py-auto-extract must run: ${(py.stderr || '').trim().split('\n').pop()}`);
  const out = JSON.parse(py.stdout);
  assert.equal(out.products.length, 12, `Python must extract all 12 cards, got ${out.products.length}`);
  assert.equal(out.discovered?.ok, true, 'Python discovery must verify');
  assert.equal(out.discovered?.selectors?.container, 'div.p-3.flex', 'Python and Node must agree on the container');
});
