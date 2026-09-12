import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { load } from 'cheerio';

// Locks in the 1.136.0 engine fixes (obfuscated/deep card discovery, lazy
// images, link-less titles) and the 1.137.0 per-engine benchmark diagnosis,
// on BOTH twins. Fixtures mirror the sandbox mock shop's hardest markups.

// --- worker twin bundle (same approach as extraction.test.mjs) ---
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-engine-diagnosis-'));
await build({ entryPoints: { scraper: new URL('../worker-src/scraper.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const scraper = await import(pathToFileURL(join(temporary, 'scraper.mjs')));
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

// --- render twin bundle (node cjs, external packages) ---
// NOTE: built inside the repo tree (gitignored node_modules cache) so the
// external requires (cheerio, …) resolve via node_modules walk-up; a /tmp
// bundle cannot see them.
const { mkdir } = await import('node:fs/promises');
await mkdir(new URL('../node_modules/.cache/scraper4-tests', import.meta.url), { recursive: true });
const rtmp = await mkdtemp(new URL('../node_modules/.cache/scraper4-tests/render-', import.meta.url).pathname);
await build({ entryPoints: { scraper: new URL('../render-src/scraper.ts', import.meta.url).pathname }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const rscraper = createRequire(import.meta.url)(join(rtmp, 'scraper.cjs'));

const fixture = async name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const BASE = 'https://shop.example/tw/';
const DEFAULTS = { container: 'li.product', title: 'h2, h3, .woocommerce-loop-product__title', price: '.price, .amount', link: 'a[href]', image: 'img' };
const BAD = { container: '.zzz-nope', title: '.zzz-t', price: '.zzz-p', link: 'a', image: 'img' };
const synth = n => Array.from({ length: n }, (_, i) => ({ title: `کالای نمونه ${i}`, price: 1000 + i, priceText: `${1000 + i} تومان`, url: `https://shop.example/p${i}`, image: `https://shop.example/i${i}.jpg` }));
const EMPTY_SHELL = '<!doctype html><html><head><title>x</title></head><body><div id="root"><p class="loading">wait</p></div><script src="/static/app.js"></script></body></html>';

test('worker discovers structural selectors on obfuscated cards (media/info link split)', async () => {
  const html = await fixture('tw-cards.html');
  const found = await scraper.discoverListSelectorsFromHtml(html, BASE);
  assert.notEqual(found.method, 'none');
  assert.match(found.selectors.container || '', /shop-card/);
  assert.match(found.selectors.title || '', /card-name/);
  assert.match(found.selectors.price || '', /cost/);
});

test('worker discovers deep cards where the price sits outside the media subtree', async () => {
  const html = await fixture('tw-deep-cards.html');
  const found = await scraper.discoverListSelectorsFromHtml(html, BASE);
  assert.notEqual(found.method, 'none');
  assert.match(found.selectors.container || '', /mid/);
  const verified = await scraper.verifyListSelectors(html, BASE, { ...DEFAULTS, ...found.selectors });
  assert.equal(verified.ok, true);
  assert.equal(verified.containerCount, 3);
});

test('worker heuristic prefers data-src over placeholder src and dedupes dual links', async () => {
  const html = await fixture('tw-cards.html');
  const products = await scraper.extractHeuristicProducts(html, BASE);
  assert.equal(products.length, 3);
  for (const p of products) {
    assert.match(p.image || '', /^https:\/\/shop\.example\/img\//);
    assert.doesNotMatch(p.image || '', /placeholder/);
  }
});

test('worker heuristic rescues titles that sit outside the media link', async () => {
  const html = await fixture('tw-deep-cards.html');
  const products = await scraper.extractHeuristicProducts(html, BASE);
  assert.equal(products.length, 3);
  for (const p of products) {
    assert.ok((p.title || '').length >= 3);
    assert.ok(p.price > 0);
    assert.match(p.image || '', /^https:\/\/shop\.example\/img\//);
  }
});

test('worker diagnosis reports a healthy selector engine with evidence', async () => {
  const html = await fixture('tw-cards.html');
  const found = await scraper.discoverListSelectorsFromHtml(html, BASE);
  const selectors = { ...DEFAULTS, ...found.selectors };
  const products = await scraper.parseCards(html, BASE, selectors);
  assert.equal(products.length, 3);
  const d = await scraper.diagnoseBenchmarkEngine('htmlrewriter', html, BASE, selectors, products, '');
  assert.equal(d.engine, 'htmlrewriter');
  assert.equal(d.candidates, 3);
  assert.equal(d.extracted, 3);
  assert.deepEqual(d.complete, { title: 3, price: 3, link: 3, image: 3 });
  assert.deepEqual(d.dropReasons, []);
  assert.match(d.hint, /سالم/);
  assert.ok((d.sample?.title || '').length > 0);
  assert.equal(d.signals.containers, 3);
});

test('worker diagnosis explains a zero-result selector engine', async () => {
  const html = await fixture('tw-cards.html');
  const d = await scraper.diagnoseBenchmarkEngine('htmlrewriter', html, BASE, BAD, [], '');
  assert.equal(d.candidates, 0);
  assert.equal(d.extracted, 0);
  assert.equal(d.sample, null);
  assert.ok(d.dropReasons.length >= 1);
  assert.match(d.dropReasons[0], /\.zzz-nope/);
  assert.match(d.hint, /پیشنهاد خودکار/);
});

test('worker diagnosis covers data engines, empty pages and errors', async () => {
  const ld = await fixture('jsonld-list.html'), next = await fixture('next-data.html'), tw = await fixture('tw-cards.html');
  const healthyLd = await scraper.diagnoseBenchmarkEngine('jsonld', ld, BASE, DEFAULTS, synth(3), '');
  assert.ok(healthyLd.signals.ldBlocks >= 1);
  assert.match(healthyLd.hint, /سالم/);
  const zeroLd = await scraper.diagnoseBenchmarkEngine('jsonld', tw, BASE, DEFAULTS, [], '');
  assert.match(zeroLd.dropReasons.join(' '), /JSON-LD/);
  const healthyNext = await scraper.diagnoseBenchmarkEngine('next_data', next, BASE, DEFAULTS, synth(3), '');
  assert.equal(healthyNext.signals.hasNextData, true);
  assert.ok(healthyNext.signals.priceKeys >= 3);
  const zeroNext = await scraper.diagnoseBenchmarkEngine('next_data', tw, BASE, DEFAULTS, [], '');
  assert.match(zeroNext.dropReasons.join(' '), /__NEXT_DATA__/);
  const zeroHeuristic = await scraper.diagnoseBenchmarkEngine('heuristic', EMPTY_SHELL, BASE, DEFAULTS, [], '');
  assert.equal(zeroHeuristic.candidates, 0);
  assert.match(zeroHeuristic.hint, /htmlrewriter/);
  const zeroMeta = await scraper.diagnoseBenchmarkEngine('metadata', tw, BASE, DEFAULTS, [], '');
  assert.match(zeroMeta.dropReasons.join(' '), /OpenGraph/);
  const noPage = await scraper.diagnoseBenchmarkEngine('htmlrewriter', '', '', DEFAULTS, [], 'boom-fail');
  assert.deepEqual(noPage.dropReasons, ['boom-fail']);
  const browserErr = await scraper.diagnoseBenchmarkEngine('playwright', tw, BASE, DEFAULTS, [], 'no browser here');
  assert.ok(browserErr.dropReasons.includes('no browser here'));
});

test('render twin discovers the same obfuscated cards', async () => {
  const html = await fixture('tw-cards.html');
  const found = rscraper.discoverListSelectorsFromHtml(html, BASE);
  assert.notEqual(found.method, 'none');
  assert.match(found.selectors.container || '', /shop-card/);
  assert.match(found.selectors.title || '', /card-name/);
});

test('render twin diagnosis matches the worker twin word-for-word', async () => {
  const html = await fixture('tw-cards.html');
  const found = await scraper.discoverListSelectorsFromHtml(html, BASE);
  const selectors = { ...DEFAULTS, ...found.selectors };
  const [wHealthy, rHealthy] = await Promise.all([
    scraper.diagnoseBenchmarkEngine('htmlrewriter', html, BASE, selectors, synth(3), ''),
    rscraper.diagnoseBenchmarkEngine('htmlrewriter', html, BASE, selectors, synth(3), ''),
  ]);
  assert.equal(rHealthy.hint, wHealthy.hint);
  assert.deepEqual(rHealthy.dropReasons, wHealthy.dropReasons);
  assert.deepEqual(rHealthy.complete, wHealthy.complete);
  const [wZero, rZero] = await Promise.all([
    scraper.diagnoseBenchmarkEngine('jsonld', html, BASE, DEFAULTS, [], ''),
    rscraper.diagnoseBenchmarkEngine('jsonld', html, BASE, DEFAULTS, [], ''),
  ]);
  assert.equal(rZero.hint, wZero.hint);
  assert.deepEqual(rZero.dropReasons, wZero.dropReasons);
});

test('both twins export the diagnosis surface', async () => {
  const workerSrc = await readFile(new URL('../worker-src/scraper.ts', import.meta.url), 'utf8');
  const renderSrc = await readFile(new URL('../render-src/scraper.ts', import.meta.url), 'utf8');
  for (const source of [workerSrc, renderSrc]) {
    assert.ok(source.includes('diagnoseBenchmarkEngine'), 'diagnoseBenchmarkEngine export');
    assert.ok(source.includes('EngineDiagnosis'), 'EngineDiagnosis type');
    assert.ok(source.includes('stripPriceFormatChars'), 'tatweel strip helper');
    assert.ok(source.includes('NON_PRODUCT_URL_RE'), 'category-link guard');
    assert.ok(source.includes('barePrices'), 'bare-thousands signal');
  }
  assert.ok(renderSrc.includes('export function heuristicProducts'), 'render heuristic export');
  assert.ok(workerSrc.includes('export async function extractHeuristicProducts'), 'worker heuristic export');
});

test('both twins extract tatweel-styled prices and skip in-card category links', async () => {
  const html = await fixture('patris-cards.html');
  const landed = await scraper.extractHeuristicProducts(html, BASE);
  assert.equal(landed.length, 4);
  assert.deepEqual(landed.map(p => p.price).sort((a, b) => a - b), [298000, 598000, 998000, 1700000]);
  for (const p of landed) {
    assert.ok(p.title.length >= 3);
    assert.ok(p.price > 0 && p.priceText);
    assert.match(p.url, /\/product\//);
    assert.doesNotMatch(p.url, /product-category/);
    assert.match(p.image, /\/upload\/thumb3\//);
  }
  const rlanded = rscraper.heuristicProducts(html, BASE);
  assert.equal(rlanded.length, 4);
  assert.deepEqual(rlanded.map(p => p.price).sort((a, b) => a - b), [298000, 598000, 998000, 1700000]);
  for (const p of rlanded) assert.doesNotMatch(p.url, /product-category/);
});

test('both twins keep slugs that merely contain guarded words', async () => {
  const html = '<!doctype html><html><body><div><a href="/product/category-theory-book/"><img src="/i.jpg" alt="کتاب نظریه"></a><b>۱۰۰,۰۰۰ تومان</b></div></body></html>';
  assert.equal((await scraper.extractHeuristicProducts(html, BASE)).length, 1);
  assert.equal(rscraper.heuristicProducts(html, BASE).length, 1);
});

test('both twins report tatweel price hints and bare thousands in heuristic diagnosis', async () => {
  const html = await fixture('patris-cards.html');
  for (const twin of [scraper, rscraper]) {
    const d = await twin.diagnoseBenchmarkEngine('heuristic', html, BASE, DEFAULTS, []);
    assert.equal(d.signals.priceHints, 4);
    assert.equal(d.signals.barePrices, 4);
  }
  const bare = '<!doctype html><html><body><a href="/product/x">x</a><div>۱,۷۰۰,۰۰۰</div></body></html>';
  for (const twin of [scraper, rscraper]) {
    const d = await twin.diagnoseBenchmarkEngine('heuristic', bare, BASE, DEFAULTS, []);
    assert.equal(d.signals.priceHints, 0);
    assert.ok(d.signals.barePrices >= 1);
    assert.match(d.dropReasons.join(' '), /هزارگان‌بندی‌شده/);
  }
});

test('both twins discover full card selectors on tatweel-priced cards', async () => {
  const html = await fixture('patris-cards.html');
  const found = await scraper.discoverListSelectorsFromHtml(html, BASE);
  assert.notEqual(found.method, 'none');
  assert.match(found.selectors.container || '', /product-card/);
  assert.match(found.selectors.price || '', /price/);
  const cards = await scraper.parseCards(html, BASE, found.selectors);
  assert.equal(cards.length, 4);
  for (const c of cards) assert.ok(c.price > 0 && c.image && c.title);
  const rfound = rscraper.discoverListSelectorsFromHtml(html, BASE);
  assert.match(rfound.selectors.container || '', /product-card/);
  const verified = rscraper.verifyListSelectors(html, BASE, { ...DEFAULTS, ...rfound.selectors });
  assert.equal(verified.ok, true);
  assert.equal(verified.price.count, 4);
  assert.equal(verified.image.count, 4);
});

test('render benchmark gates browser engines on availability, not platform', async () => {
  const server = await readFile(new URL('../render-src/server.ts', import.meta.url), 'utf8');
  assert.ok(server.includes('!browserEngineAvailable()&&BROWSER_ENGINES.has(engine)'));
  assert.ok(server.includes('browserEngineAvailable, diagnoseBenchmarkEngine'));
  assert.ok(server.includes('BROWSER_EXECUTABLE_PATH را تنظیم کنید'));
  assert.ok(!server.includes('BROWSER_ENGINES_UNAVAILABLE'));
  assert.ok(!server.includes('نصب‌شدنی نیستند'));
});
