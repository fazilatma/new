import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Pins the Node `structural` engine (1.144.0): the cheerio twin of
// scripts/py-auto-extract.py. Same DOM algorithm — known card containers
// (WooCommerce li.product first), outer-container repair, product-link climb,
// embedded JSON catalogs — with the same keep-if-title-or-link acceptance.
// Two intentional divergences are pinned below, not hidden: struck-through
// old prices are stripped before parsing (Python misreads discount cards),
// and URLs keep Node's percent-encoding (Python keeps raw UTF-8 paths).
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-structural-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));

const WOO = join(ROOT, 'worker-tests', 'fixtures', 'woocommerce-cards.html');
const BARF = join(ROOT, 'worker-tests', 'fixtures', 'barfbox-cards.html');
const wooHtml = await readFile(WOO, 'utf8');
const barfHtml = await readFile(BARF, 'utf8');
const PY = (() => {
  try {
    return spawnSync('python3', ['-c', 'import bs4'], { encoding: 'utf8' }).status === 0;
  } catch { return false; }
})();
const decodeUrl = value => { try { return decodeURIComponent(value); } catch { return value; } };

test('structural: a normal WooCommerce list extracts with no selectors', () => {
  const products = render.structuralProducts(wooHtml, 'https://shop.example/');
  assert.equal(products.length, 3, `must find all 3 li.product cards, got ${products.length}`);
  assert.deepEqual(products.map(p => p.title), ['کفش پیاده‌روی مردانه', 'کیف چرمی زنانه', 'ساعت مچی کلاسیک']);
  assert.deepEqual(products.map(p => p.price), [2100000, 950000, 4750000]);
  assert.deepEqual(products.map(p => p.url), [
    'https://shop.example/product/kafsh-piyadeh/',
    'https://shop.example/product/kif-charmi/',
    'https://shop.example/product/saat-mochi/',
  ]);
  assert.ok(products.every(p => p.image.startsWith('https://shop.example/wp-content/uploads/')), 'every card keeps its image');
  assert.equal(products[1].price, 950000, 'the discount card keeps the SALE price, not the struck-through old one');
});

test('structural: all 12 barfbox cards extract, prices agreeing with heuristic', () => {
  const products = render.structuralProducts(barfHtml, 'https://barfbox.ir/');
  assert.equal(products.length, 12, `must extract all 12 cards, got ${products.length}`);
  assert.ok(products.every(p => p.title && p.url), 'every product needs title and link');
  // The exact known-good numeric list the heuristic report pins (sale prices
  // on the discount cards, old prices never): the two engines must agree.
  const prices = products.map(p => p.price).sort((a, b) => a - b);
  assert.deepEqual(prices, [399, 120000, 130000, 139000, 159000, 189000, 215000, 255000, 389000, 525000, 795000, 1375000]);
});

test('structural: a missing price or image never discards a card', () => {
  const html = `<ul class="products">
    <li class="product"><a href="/product/a">Alpha shoes</a></li>
    <li class="product"><h2>Beta bag</h2><a href="/product/b">buy</a></li>
    <li class="product"><span>Title without any link</span></li>
    <li class="product"><span class="price">5,000 تومان</span></li>
  </ul>`;
  const products = render.structuralProducts(html, 'https://shop.example/');
  assert.equal(products.length, 3, `link-only, full and title-only cards stay; the price-only card goes, got ${products.length}`);
  assert.deepEqual(products.map(p => p.title), ['Alpha shoes', 'Beta bag', 'Title without any link']);
  assert.equal(products[0].price, 0, 'a missing price stays 0 instead of dropping the product');
  assert.equal(products[2].url, '', 'a missing link stays empty when the title carries the card');
});

test('structural: discovery agrees with Python, quirk included', () => {
  const barf = render.discoverStructuralSelectors(barfHtml, 'https://barfbox.ir/');
  assert.equal(barf.ok, true, 'barfbox discovery must verify');
  assert.equal(barf.method, 'structural');
  assert.equal(barf.selectors.container, 'div.p-3.flex', 'must agree with Python on the container');
  for (const key of ['title', 'price', 'link', 'image']) assert.ok(barf.selectors[key], `discovery must emit ${key}`);
  const woo = render.discoverStructuralSelectors(wooHtml, 'https://shop.example/');
  assert.equal(woo.ok, false, 'WooCommerce post-ID classes fragment the vote on BOTH sides (shared quirk, extraction unaffected)');
  assert.equal(woo.method, 'none');
});

test('structural: the engine is wired into the chain, benchmark and UI', async () => {
  const scraper = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');
  assert.ok(scraper.indexOf("'htmlrewriter','structural','cheerio'") > 0, 'auto must try structural right after the selector engine');
  assert.ok(scraper.includes("if (name === 'structural') return structuralProducts(text, finalUrl);"), 'pick() must dispatch structural');
  assert.ok(scraper.includes("li.product,article[class*='product']"), 'the WooCommerce-first container list must be present');
  assert.ok(scraper.includes("} else if (engine === 'structural') {"), 'the benchmark diagnosis must cover structural');
  const dash = await readFile(join(ROOT, 'worker-src', 'dashboard.ts'), 'utf8');
  assert.ok(dash.includes("['structural','Structural product cards — Node only']"), 'the JS dropdown must offer structural');
  assert.equal(dash.split('<option value="structural">').length - 1, 2, 'both static dropdowns must offer structural');
  const server = await readFile(join(ROOT, 'render-src', 'server.ts'), 'utf8');
  assert.ok(server.includes("'heuristic','structural','metadata'"), 'the Node benchmark must probe structural');
  const app = await readFile(join(ROOT, 'worker-src/app.ts'), 'utf8');
  assert.ok(app.includes("'crawlee_playwright','structural'"), 'the Worker must list structural as unavailable, not crash on it');
  const wScraper = await readFile(join(ROOT, 'worker-src/scraper.ts'), 'utf8');
  assert.ok(wScraper.includes("'crawlee_playwright','structural'"), 'the Worker must refuse structural loudly like the other Node-only engines');
});

test('structural: Node matches Python product-for-product (discount cards excepted)', async (t) => {
  if (!PY) { t.skip('python3+beautifulsoup4 not installed'); return; }
  // Discount cards differ BY DESIGN: Node strips <del> old prices (sale wins),
  // Python keeps them (old+sale merge or the old price wins).
  const saleOnly = new Map([
    ['کیف چرمی زنانه', '950,000 تومان'],
    ['لیپ گلاس شیشه ای قلبی دخترانه', '189٬000 تومان'],
    ['خط لب مدادی پیچی دراگون', '120٬000 تومان'],
    ['ساعت مچی دخترونه مجلسی بند استیل', '795٬000 تومان'],
  ]);
  for (const [file, base] of [[WOO, 'https://shop.example/'], [BARF, 'https://barfbox.ir/']]) {
    const html = await readFile(file, 'utf8');
    const nodeProducts = render.structuralProducts(html, base);
    const py = spawnSync('python3', [join(ROOT, 'scripts', 'py-auto-extract.py'), '--html-file', file, '--base', base, '--json'], { encoding: 'utf8', timeout: 120000 });
    assert.equal(py.status, 0, `py-auto-extract must run: ${(py.stderr || '').trim().split('\n').pop()}`);
    const pyProducts = JSON.parse(py.stdout).products;
    assert.equal(nodeProducts.length, pyProducts.length, `${file} count must match Python`);
    const byTitle = new Map(pyProducts.map(p => [p.title, p]));
    for (const n of nodeProducts) {
      const p = byTitle.get(n.title);
      assert.ok(p, `Python must have "${n.title}" too`);
      assert.equal(decodeUrl(n.url), p.link, `link must match for "${n.title}" (modulo percent-encoding)`);
      assert.equal(n.image, p.image, `image must match for "${n.title}"`);
      assert.equal(n.sku || '', p.sku || '', `sku must match for "${n.title}"`);
      if (saleOnly.has(n.title)) assert.equal(n.priceText, saleOnly.get(n.title), `sale price must win for "${n.title}"`);
      else assert.equal(n.priceText, p.price, `priceText must match Python for "${n.title}"`);
    }
  }
});

test('structural: benchmark diagnosis explains empty and healthy runs', async () => {
  const empty = await render.diagnoseBenchmarkEngine('structural', wooHtml, 'https://shop.example/', {}, [], '');
  assert.equal(empty.engine, 'structural');
  assert.ok(empty.hint, 'an empty run still gets a next-step hint');
  const products = render.structuralProducts(wooHtml, 'https://shop.example/');
  const full = await render.diagnoseBenchmarkEngine('structural', wooHtml, 'https://shop.example/', {}, products, '');
  assert.match(full.hint, /۳ محصول|3 محصول/, `a healthy run says what it found, got: ${full.hint}`);
  assert.ok((full.signals.structuralContainers || 0) >= 3, 'signals must count the WooCommerce containers');
});
