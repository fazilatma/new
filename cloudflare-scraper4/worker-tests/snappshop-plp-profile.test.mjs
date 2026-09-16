import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { load } from 'cheerio';

// Locks in the real-structure SnappShop profile (user DevTools dump, 2026-09-13).
// The PLP renders each card as a classless A[href*="/product/snp-"] wrapping an
// ARTICLE.ProductCard_product-card, with card text ordered TITLE / %DISCOUNT /
// OLD PRICE / SALE PRICE. Two traps make naive selectors fail here:
//   (1) the card link is the PARENT anchor, not a child — a child-only `a[href]`
//       lookup finds nothing when the container is the article;
//   (2) both engines' numberFromText() takes the MAXIMUM number, so a card-level
//       price selector returns the crossed-out OLD price on every discounted row.
// The profile answers with the anchor itself as the container (link = self) and
// a sale-only price element ([class*="productPrice__new"]). The selectors under
// test are read from the shipped profiles/snappshop-kitchen-profiles.json — not
// copied — so this file guards the artifact the user actually imports. Card 1
// of the fixture is byte-verbatim from the dump; rows 2-8 replicate its
// structure with the dump's real sale prices (see the fixture header for the
// verbatim-vs-placeholder ledger).

// --- worker twin bundle + cheerio-backed HTMLRewriter (same harness as
// worker-tests/snapp-report.test.mjs) ---
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-snapplp-'));
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
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-snapplp-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));

const profilesDoc = JSON.parse(await readFile(join(ROOT, 'profiles', 'snappshop-kitchen-profiles.json'), 'utf8'));
const profile = profilesDoc.profiles['snappshop-kitchen-real'];
assert.ok(profile, 'the shipped profiles JSON must carry snappshop-kitchen-real');
const SELECTORS = profile.selectors;
const BASE = 'https://snappshop.ir/category/kitchen-appliances?is_available=true';
const html = await readFile(join(ROOT, 'worker-tests', 'fixtures', 'snappshop-kitchen-plp.html'), 'utf8');
const FALLBACK = 'https://snappshop.ir/_next/static/media/image-fallback.svg';
const EXPECTED = [
  { title: 'قوری بلور زینو کد M-1100', price: 244200, url: 'https://snappshop.ir/product/snp-1784183539', image: 'https://cdn.snappshop.ir/products/11/24/52a44fd0-bd95-48a4-873f-403f144da7e6.jpg?q=75&w=384' },
  { title: 'کالای نمونه ردیف ۲', price: 396000, url: 'https://snappshop.ir/product/snp-1000000002', image: 'https://cdn.snappshop.ir/products/sample-row-2.jpg?q=75&w=384' },
  { title: 'کالای نمونه ردیف ۳', price: 830000, url: 'https://snappshop.ir/product/snp-1000000003', image: 'https://cdn.snappshop.ir/products/sample-row-3.jpg?q=75&w=384' },
  { title: 'کالای نمونه ردیف ۴', price: 309000, url: 'https://snappshop.ir/product/snp-1000000004', image: 'https://cdn.snappshop.ir/products/sample-row-4.jpg?q=75&w=384' },
  { title: 'کالای نمونه ردیف ۵', price: 304200, url: 'https://snappshop.ir/product/snp-1000000005', image: FALLBACK },
  { title: 'کالای نمونه ردیف ۶', price: 100000, url: 'https://snappshop.ir/product/snp-1000000006', image: FALLBACK },
  { title: 'کالای نمونه ردیف ۷', price: 115000, url: 'https://snappshop.ir/product/snp-1000000007', image: FALLBACK },
  { title: 'کالای نمونه ردیف ۸', price: 320000, url: 'https://snappshop.ir/product/snp-1000000008', image: FALLBACK },
];
const OLD_PRICES = [660000, 450000, 1100000, 350000, 380000, 120000, 150000];

// Pre-existing twin quirk, pinned here (not blessed): the worker folds Persian
// digits to ASCII inside TITLES (normalizeDigits) while render preserves them,
// so card 2 reads "ردیف 2" on the worker and "ردیف ۲" on render. Prices are
// unaffected (both sides normalize before parsing). Filed for a follow-up.
const foldFaDigits = s => String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));

function checkProducts(products, who) {
  assert.equal(products.length, 8, `${who} must extract all 8 cards (got ${products.length}; the category links above the grid must not become products)`);
  for (let i = 0; i < 8; i++) {
    const got = products[i], want = EXPECTED[i];
    assert.equal(got.title, who === 'worker' ? foldFaDigits(want.title) : want.title, `${who} card ${i + 1} title`);
    assert.equal(got.price, want.price, `${who} card ${i + 1} must carry the SALE price ${want.price}, not the crossed-out old price`);
    assert.equal(got.url, want.url, `${who} card ${i + 1} must link to its own product page`);
    assert.equal(got.image, want.image, `${who} card ${i + 1} image`);
  }
  for (const old of OLD_PRICES) assert.ok(!products.some(p => p.price === old), `${who} must never surface the old price ${old}`);
}

test('snappshop real profile: render extracts all 8 cards with sale prices', () => {
  checkProducts(render.scrapeListCheerioFromHtml(html, BASE, SELECTORS), 'render');
});

test('snappshop real profile: worker extracts all 8 cards with sale prices', async () => {
  checkProducts(await worker.parseCards(html, BASE, SELECTORS), 'worker');
});

test('snappshop real profile: shape pins (engine + five selectors)', () => {
  assert.equal(profile.extractionEngine, 'cheerio', 'the real-structure profile must run the configured CSS on both runtimes');
  for (const key of ['container', 'title', 'price', 'link', 'image']) {
    assert.ok(String(SELECTORS[key] || '').trim(), `selector ${key} must be non-empty`);
  }
  assert.equal(SELECTORS.container, 'a[href*="/product/snp-"]', 'the container is the card anchor itself');
  assert.equal(SELECTORS.price, '[class*="productPrice__new"]', 'the price stays isolated to the sale element');
});

test('snappshop real profile: selectors stay single HTMLRewriter-safe compounds', () => {
  for (const [field, sel] of Object.entries(SELECTORS)) {
    assert.ok(!/[\s>,+~]/.test(sel), `${field} must stay one compound selector with no combinators (got ${JSON.stringify(sel)})`);
    assert.ok(!/^xpath:/i.test(sel) && !sel.startsWith('/') && !sel.includes('://'), `${field} must stay CSS, never XPath (got ${JSON.stringify(sel)})`);
  }
});

test('snappshop real profile: the DB seed carries the same profile', async () => {
  const seed = await readFile(join(ROOT, 'migrations', '0007_seed_snappshop_real_profile.sql'), 'utf8');
  assert.ok(seed.includes("'snappshop-kitchen-real'"), 'migration 0007 must seed snappshop-kitchen-real');
  assert.ok(seed.includes('INSERT OR IGNORE'), 'the seed must never overwrite a user-edited profile');
  for (const sel of Object.values(SELECTORS)) {
    assert.ok(seed.includes(String(sel).replace(/"/g, '\\"')), `the seed must carry the shipped selector ${sel}`);
  }
});
