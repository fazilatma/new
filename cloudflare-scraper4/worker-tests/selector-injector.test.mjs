import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { load } from 'cheerio';
import { parseHTML } from 'linkedom';

// Locks in the console injector (tools/selector-injector.js): pasted into
// DevTools on a live shop page, it finds the product grid, derives worker-safe
// CSS selectors, verifies them in-page, and prints an importable profile JSON.
// The discovery below runs against linkedom DOMs of the real fixtures, and the
// SUGGESTED selectors round-trip through both real engines — the test proves
// the injector's output extracts, not just that it prints something plausible.
// Strongest pin: on the Snappshop PLP the injector rediscovers the shipped
// 1.154.0 profile byte-for-byte (container/title/link/image identical).

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// --- injector under test (linkedom provides the document) ---
const injectorSrc = await readFile(join(ROOT, 'tools', 'selector-injector.js'), 'utf8');
const loadInjector = new Function('window', injectorSrc + '\nreturn S4I;');
async function discover(fixture, url) {
  const html = await readFile(join(ROOT, 'worker-tests', 'fixtures', fixture), 'utf8');
  const { document } = parseHTML(html);
  return loadInjector({ __S4I_NO_AUTORUN: 1 }).run(document, { quiet: true, url });
}

// --- worker twin bundle + cheerio-backed HTMLRewriter (same harness as
// worker-tests/snapp-report.test.mjs) ---
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-s4i-'));
await writeFile(join(temporary, 'entry.ts'),
  `export * from ${JSON.stringify(join(ROOT, 'worker-src', 'scraper.ts'))};\n`);
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

// --- render twin bundle (same approach as scripts/lab-probe.mjs) ---
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-s4i-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));

const SNAPP_URL = 'https://snappshop.ir/category/kitchen-appliances?is_available=true';
const BARF_URL = 'https://barfbox.ir/';
const snappHtml = await readFile(join(ROOT, 'worker-tests', 'fixtures', 'snappshop-kitchen-plp.html'), 'utf8');
const barfHtml = await readFile(join(ROOT, 'worker-tests', 'fixtures', 'barfbox-cards.html'), 'utf8');
const snapp = await discover('snappshop-kitchen-plp.html', SNAPP_URL);
const barf = await discover('barfbox-cards.html', BARF_URL);
const shipped = JSON.parse(await readFile(join(ROOT, 'profiles', 'snappshop-kitchen-profiles.json'), 'utf8'))
  .profiles['snappshop-kitchen-real'].selectors;

const SNAPP_EXPECTED = [
  ['قوری بلور زینو کد M-1100', 244200, 'https://snappshop.ir/product/snp-1784183539'],
  ['کالای نمونه ردیف ۲', 396000, 'https://snappshop.ir/product/snp-1000000002'],
  ['کالای نمونه ردیف ۳', 830000, 'https://snappshop.ir/product/snp-1000000003'],
  ['کالای نمونه ردیف ۴', 309000, 'https://snappshop.ir/product/snp-1000000004'],
  ['کالای نمونه ردیف ۵', 304200, 'https://snappshop.ir/product/snp-1000000005'],
  ['کالای نمونه ردیف ۶', 100000, 'https://snappshop.ir/product/snp-1000000006'],
  ['کالای نمونه ردیف ۷', 115000, 'https://snappshop.ir/product/snp-1000000007'],
  ['کالای نمونه ردیف ۸', 320000, 'https://snappshop.ir/product/snp-1000000008'],
];
const foldFaDigits = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

test('injector: Snappshop discovery rediscovers the shipped profile', () => {
  assert.equal(snapp.ok, true);
  assert.equal(snapp.cards, 8, 'all 8 cards must be found');
  assert.equal(snapp.okRows, 8, 'all 8 rows must verify in-page');
  assert.equal(snapp.selectors.container, shipped.container, 'container must match the shipped profile');
  assert.equal(snapp.selectors.title, shipped.title, 'title must match the shipped profile');
  assert.equal(snapp.selectors.link, shipped.link, 'link must match the shipped profile');
  assert.equal(snapp.selectors.image, shipped.image, 'image must match the shipped profile');
  assert.ok(snapp.selectors.price.includes('productPrice__new'), 'price must isolate the sale element');
  assert.ok(snapp.warnings.some(w => /جای‌نگهدار/.test(w)), 'the lazy-image caveat must surface automatically');
});

test('injector: Snappshop suggestions extract 8/8 through the render engine', () => {
  const products = render.scrapeListCheerioFromHtml(snappHtml, SNAPP_URL, snapp.selectors);
  assert.equal(products.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(products[i].title, SNAPP_EXPECTED[i][0], `card ${i + 1} title`);
    assert.equal(products[i].price, SNAPP_EXPECTED[i][1], `card ${i + 1} must carry the SALE price`);
    assert.equal(products[i].url, SNAPP_EXPECTED[i][2], `card ${i + 1} url`);
  }
});

test('injector: Snappshop suggestions extract 8/8 through the worker engine', async () => {
  const products = await worker.parseCards(snappHtml, SNAPP_URL, snapp.selectors);
  assert.equal(products.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(products[i].title, foldFaDigits(SNAPP_EXPECTED[i][0]), `card ${i + 1} title`);
    assert.equal(products[i].price, SNAPP_EXPECTED[i][1], `card ${i + 1} must carry the SALE price`);
    assert.equal(products[i].url, SNAPP_EXPECTED[i][2], `card ${i + 1} url`);
  }
});

test('injector: Barfbox discovery covers 11/12 and says so loudly', () => {
  assert.equal(barf.ok, true);
  assert.equal(barf.cards, 11, 'the 11 same-shape cards must be found');
  assert.equal(barf.okRows, 11, 'all 11 rows must verify in-page');
  for (const key of ['container', 'title', 'price', 'link', 'image']) {
    assert.ok(barf.selectors[key], `barfbox selector ${key} must be suggested`);
  }
  assert.ok(barf.warnings.some(w => /شکل متفاوت/.test(w)), 'the odd-shaped 12th card must be reported');
  assert.ok(barf.warnings.some(w => /گرهٔ اضافه/.test(w)), 'the widened container coverage must be reported');
});

test('injector: Barfbox suggestions extract 11/11 through the render engine', () => {
  const products = render.scrapeListCheerioFromHtml(barfHtml, BARF_URL, barf.selectors);
  assert.equal(products.length, 11, 'the title-less odd card drops at extraction, the rest must extract');
  for (const p of products) {
    assert.ok(p.title && p.title.length >= 2, 'every product needs a title');
    assert.ok(p.price > 0, `every product needs a price (got ${p.price} for ${p.title})`);
    assert.ok(p.url.includes('/product/'), 'every product needs its product link');
  }
});

test('injector: Barfbox suggestions extract 12/12 through the worker engine', async () => {
  // Twin difference, pinned: the worker recovers the odd card's title from
  // element attributes (12/12), while render drops title-less cards (11/11).
  const products = await worker.parseCards(barfHtml, BARF_URL, barf.selectors);
  assert.equal(products.length, 12, 'the worker recovers the odd card too');
  for (const p of products) {
    assert.ok(p.title && p.title.length >= 2, 'every product needs a title');
    assert.ok(p.price > 0, `every product needs a price (got ${p.price} for ${p.title})`);
    assert.ok(p.url.includes('/product/'), 'every product needs its product link');
  }
  assert.ok(products.some(p => p.title.includes('الحمرا')), 'the odd card (904) must come with its real title');
});

test('injector: every suggestion stays single HTMLRewriter-safe CSS', () => {
  for (const [name, sel] of [['snappshop', snapp.selectors], ['barfbox', barf.selectors]]) {
    for (const [field, value] of Object.entries(sel)) {
      assert.ok(!/[\s>,+~]/.test(value), `${name}.${field} must have no combinators (got ${JSON.stringify(value)})`);
      assert.ok(!value.startsWith('/') && !value.includes('://'), `${name}.${field} must stay CSS, never XPath`);
    }
  }
});

test('injector: the printed profile imports as-is (shape pins)', () => {
  for (const [name, result, host] of [['snappshop', snapp, 'snappshop'], ['barfbox', barf, 'barfbox']]) {
    const ids = Object.keys(result.profile.profiles);
    assert.equal(ids.length, 1, `${name} must print exactly one profile`);
    assert.ok(ids[0].includes(host), `${name} profile id must derive from the host (got ${ids[0]})`);
    const p = result.profile.profiles[ids[0]];
    assert.equal(p.extractionEngine, 'cheerio', 'discovered selectors run has-is, no guessing');
    assert.deepEqual(Object.keys(p.selectors).sort(), ['container', 'image', 'link', 'price', 'title']);
    assert.deepEqual(p.selectors, result.selectors, 'the printed profile must carry the verified selectors');
  }
});

test('injector: CSS-module hashes are stripped, volatile classes dropped', () => {
  const S4I = loadInjector({ __S4I_NO_AUTORUN: 1 });
  assert.equal(S4I._t.stableToken('productPrice__new__a1B2c'), 'productPrice__new');
  assert.equal(S4I._t.stableToken('ProductCard_product-card__zQzqc'), 'ProductCard_product-card');
  assert.equal(S4I._t.stableToken('rounded-2xl'), 'rounded-2xl');
  assert.equal(S4I._t.stableToken('text-[13px]'), 'text-[13px]');
  assert.equal(S4I._t.stableToken('is-open'), '', 'volatile state classes must go');
  assert.equal(S4I._t.stableToken('a1b2c3'), '', 'bare hashes must go');
  assert.equal(S4I._t.priceVal('۵۲۵٬۰۰۰'), 525000, 'Persian digits must parse');
  assert.equal(S4I._t.priceVal('%63'), -1, 'discount badges are not prices');
  assert.equal(S4I._t.priceVal('قوری بلور زینو کد M-1100'), -1, 'titles with model numbers are not prices');
});

test('injector: an empty page fails loud, never with empty selectors', async () => {
  const { document } = parseHTML('<html><head><title>x</title></head><body><p>hi</p></body></html>');
  const r = loadInjector({ __S4I_NO_AUTORUN: 1 }).run(document, { quiet: true, url: 'https://empty.test/' });
  assert.equal(r.ok, false);
  assert.ok(r.reason && r.reason.length > 10, 'the failure must explain itself');
});

test('injector: the dashboard embeds the snippet byte-for-byte (no drift, all environments)', async () => {
  const dash = await readFile(join(ROOT, 'worker-src', 'dashboard.ts'), 'utf8');
  const open = '<script type="text/plain" id="s4injectorSrc">';
  const i = dash.indexOf(open);
  assert.ok(i >= 0, 'the dashboard must carry the injector source block');
  const embedded = dash.slice(i + open.length, dash.indexOf('</script>', i));
  // Reverse the TS template-literal escaping (backslash, backtick) and compare bytes.
  assert.equal(embedded.replace(/\\(\\|`)/g, '$1'), injectorSrc, 'dashboard copy must equal tools/selector-injector.js exactly');
  for (const marker of ['data-copy-injector', 'injectorCopyBtn', 'function copyInjectorScript(', 'renderInjectorPreview()', 'injectorPreview', 'injectorCopyStatus']) {
    assert.ok(dash.includes(marker), `dashboard must wire ${marker}`);
  }
  // The injector lives in the selectors sub-panel (moved out of the hamburger menu in 1.162).
  assert.ok(!dash.includes("'injector'"), 'injector must not linger as a hamburger-menu key');
  const selPane = dash.indexOf('data-panel="selectors"'), injPrev = dash.indexOf('id="injectorPreview"'), detPane = dash.indexOf('data-panel="details"');
  assert.ok(selPane >= 0 && selPane < injPrev && injPrev < detPane, 'injector card must sit inside the selectors sub-panel');
  // One dashboard source serves every runtime (render re-exports it).
  const renderDash = await readFile(join(ROOT, 'render-src', 'dashboard.ts'), 'utf8');
  assert.ok(renderDash.includes('../worker-src/dashboard.js'), 'render must keep serving the shared dashboard');
});
