// Storefront layer: the shop owns "/", the scraper lives in a folder, and every showcased
// price must be the scraped base price with the OWNING PROFILE's adjustment coefficients
// applied — the same maths the results tab and the destinations use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(root, 'node_modules/.cache/storefront-'));
async function load(entry, outfile) {
  await build({ entryPoints: [join(root, entry)], outfile: join(temp, outfile), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(temp, outfile)));
}
const core = await load('worker-src/shop-core.ts', 'core.mjs');
const payments = await load('worker-src/payments.ts', 'payments.mjs');
const routes = await load('worker-src/shop-routes.ts', 'routes.mjs');

const profiles = [
  { id: 'p-percent', name: 'فروشگاه الف', titleSuffix: '', priceMode: 'percent', priceValue: 20, roundPrice: 1000, minPrice: 0 },
  { id: 'p-multiply', name: 'فروشگاه ب', titleSuffix: '', priceMode: 'multiply', priceValue: 1.5, roundPrice: 0, minPrice: 900000 },
  { id: 'p-plain', name: 'فروشگاه ج', titleSuffix: '', priceMode: 'none', priceValue: 0, roundPrice: 0, minPrice: 0 }
];
const products = {
  'p-percent': [{ sourceKey: 'a1', title: 'کتری برقی', price: 120000, priceText: '۱۲۰٬۰۰۰ تومان', image: 'https://x/i.jpg', category: 'خانه > آشپزخانه > کتری و سماور', brand: 'پارس' }],
  'p-multiply': [{ sourceKey: 'b1', title: 'جاروبرقی', price: 500000, priceText: '۵۰۰٬۰۰۰ تومان', category: 'لوازم خانگی/نظافت' }],
  'p-plain': [{ sourceKey: 'c1', title: 'لیوان', price: 50000, priceText: '۵۰٬۰۰۰ تومان' }, { sourceKey: 'c2', title: 'بدون قیمت', price: 0, priceText: '' }]
};

function deps(extra = {}) {
  const state = new Map(extra.state || []);
  return {
    state,
    listProfiles: async () => profiles,
    allProducts: async id => JSON.parse(JSON.stringify(products[id] || [])),
    getState: async (key, fallback) => (state.has(key) ? state.get(key) : fallback),
    setState: async (key, value) => void state.set(key, value),
    fetchImpl: extra.fetchImpl
  };
}

test('each product is priced with its own profile coefficients, never the raw source price', async () => {
  const d = deps();
  const { settings } = await routes.loadShopConfig(d);
  const { items } = await routes.showcase(d, settings);
  const byKey = Object.fromEntries(items.map(item => [item.sourceKey, item]));
  // +20% of 120000 = 144000, rounded up to the next 1000 => 144000
  assert.equal(byKey.a1.basePrice, 120000);
  assert.equal(byKey.a1.price, 144000);
  assert.match(byKey.a1.adjustment.label, /٪/);
  // x1.5 of 500000 = 750000, but the profile floor is 900000
  assert.equal(byKey.b1.price, 900000);
  assert.match(byKey.b1.adjustment.label, /ضریب/);
  // no adjustment at all
  assert.equal(byKey.c1.price, 50000);
  assert.equal(byKey.c1.adjustment.label, 'بدون تعدیل');
  assert.equal(byKey.c1.adjustment.factor, 1);
  assert.equal(items.length, 3, 'products without a usable price are not showcased');
});

test('re-pricing is idempotent: showing the catalogue twice never compounds the coefficients', async () => {
  const d = deps();
  const { settings } = await routes.loadShopConfig(d);
  const first = await routes.showcase(d, settings);
  const second = await routes.showcase(d, settings);
  assert.deepEqual(first.items.map(i => i.price), second.items.map(i => i.price));
});

test('the catalogue page shows base price, coefficient and final price and keeps the scraper in a folder', async () => {
  const d = deps();
  const html = await routes.cataloguePage(d, {});
  assert.match(html, /۱۴۴٬۰۰۰/, 'the adjusted price is rendered');
  assert.match(html, /۱۲۰٬۰۰۰/, 'the untouched source price is rendered next to it');
  assert.doesNotMatch(html, /فروشگاه الف/, 'internal profile names are never shown to shoppers');
  assert.match(html, /کتری و سماور/, 'cards are tagged with the product category');
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline script: script-src is self only');
  const { settings } = await routes.loadShopConfig(d);
  assert.equal(settings.scraperPath, 'scraper');
  assert.equal(core.normalizeScraperPath('/'), 'scraper', 'the scraper can never take the root back');
  assert.equal(core.normalizeScraperPath('/panel/'), 'panel');
});

test('the catalogue filters by category and by search term', async () => {
  const d = deps();
  const onlyB = await routes.cataloguePage(d, { category: 'نظافت' });
  assert.match(onlyB, /جاروبرقی/);
  assert.doesNotMatch(onlyB, /کتری برقی/);
  const search = await routes.cataloguePage(d, { q: 'لیوان' });
  assert.match(search, /لیوان/);
  assert.doesNotMatch(search, /جاروبرقی/);
});

test('an order is priced on the server, so a tampered cart cannot change the amount', async () => {
  const d = deps({ state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890', holder: 'فروشنده' }, shippingCost: 30000, taxPercent: 10 }]] });
  const result = await routes.placeOrder(d, {
    gateway: 'card',
    items: [{ id: 'p-percent::a1', qty: 2, price: 1 }],
    customer: { name: 'علی رضایی', phone: '09123456789', address: 'تهران، خیابان آزادی، پلاک ۱' }
  }, 'https://shop.test');
  assert.equal(result.ok, true, result.error);
  const order = await routes.getOrder(d, result.orderId);
  assert.equal(order.lines[0].price, 144000, 'the server price wins over the client price');
  assert.equal(order.subtotal, 288000);
  assert.equal(order.shipping, 30000);
  assert.equal(order.tax, 28800);
  assert.equal(order.total, 346800);
  assert.equal(order.status, 'awaiting-receipt', 'card to card waits for the receipt');
  assert.match(result.instructions, /6037-9912-3456-7890/);
});

test('an order is rejected without a usable gateway, customer or cart', async () => {
  const d = deps();
  const customer = { name: 'علی رضایی', phone: '09123456789', address: 'تهران، خیابان آزادی، پلاک ۱' };
  assert.equal((await routes.placeOrder(d, { gateway: 'zarinpal', items: [{ id: 'p-percent::a1' }], customer }, 'https://shop.test')).status, 400);
  const enabled = deps({ state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  assert.match((await routes.placeOrder(enabled, { gateway: 'card', items: [], customer }, 'https://shop.test')).error, /خالی/);
  assert.match((await routes.placeOrder(enabled, { gateway: 'card', items: [{ id: 'p-percent::a1' }], customer: { name: 'x', phone: '1', address: 'y' } }, 'https://shop.test')).error, /نام/);
  assert.match((await routes.placeOrder(enabled, { gateway: 'card', items: [{ id: 'ghost::nope' }], customer }, 'https://shop.test')).error, /موجود/);
});

test('the card-to-card receipt moves the order to review and is shown on the order page', async () => {
  const d = deps({ state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  const placed = await routes.placeOrder(d, {
    gateway: 'card', items: [{ id: 'p-plain::c1', qty: 1 }],
    customer: { name: 'زهرا محمدی', phone: '09351234567', address: 'مشهد، بلوار سجاد، پلاک ۴' }
  }, 'https://shop.test');
  assert.equal((await routes.submitReceipt(d, { orderId: placed.orderId, reference: '12' })).status, 400);
  assert.equal((await routes.submitReceipt(d, { orderId: placed.orderId, reference: '987654321' })).ok, true);
  const order = await routes.getOrder(d, placed.orderId);
  assert.equal(order.status, 'review');
  assert.equal(order.payment.reference, '987654321');
  const page = await routes.orderPage(d, placed.orderId);
  assert.match(page.html, /۹۸۷۶۵۴۳۲۱|987654321/);
  assert.match(page.html, /ضریب تعدیل/, 'the order keeps the coefficient that produced its price');
});

test('shop settings and payment plugins round-trip through the admin page', async () => {
  const d = deps();
  await routes.saveShopSettings(d, {
    shop: { name: 'ویترین من', scraperPath: '/panel/', shippingCost: '45000', card: { number: '6037-9912-3456-7890', holder: 'مدیر' } },
    payments: { zarinpal: { enabled: true, merchantId: 'abc' }, digipay: { enabled: true, merchantId: 'id', secret: 'user:pass' } }
  });
  const { settings, payments: saved } = await routes.loadShopConfig(d);
  assert.equal(settings.name, 'ویترین من');
  assert.equal(settings.scraperPath, 'panel');
  assert.equal(settings.shippingCost, 45000);
  assert.equal(settings.card.number, '6037991234567890');
  assert.equal(saved.zarinpal.enabled, true);
  assert.equal(saved.zarinpal.baseUrl, 'https://payment.zarinpal.com', 'a default endpoint is filled in');
  const admin = await routes.adminPage(d);
  for (const label of ['زرین‌پال', 'ترب‌پی', 'دیجی‌پی', 'کارت به کارت']) assert.match(admin, new RegExp(label));
  assert.match(admin, /\/panel/);
});

test('only fully configured gateways are offered at checkout', async () => {
  const settings = payments.normalizePaymentSettings({ zarinpal: { enabled: true }, torobpay: { enabled: true, merchantId: 'c', secret: 's' }, card: { enabled: true } });
  const ids = payments.availableGateways(settings, '6037991234567890').map(plugin => plugin.id);
  assert.deepEqual(ids, ['torobpay', 'card'], 'zarinpal has no merchant id, so it is hidden');
  assert.deepEqual(payments.availableGateways(settings, '').map(p => p.id), ['torobpay'], 'card to card needs a card number');
  const d = deps({ state: [['shop.payments', settings], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  const html = await routes.checkoutPage(d);
  assert.match(html, /ترب‌پی/);
  assert.match(html, /کارت به کارت/);
  assert.doesNotMatch(html, /value="zarinpal"/);
});

test('both runtimes mount the shop on "/" and the dashboard in the configured folder', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['worker-src/app.ts', 'render-src/server.ts']) {
    const source = await readFile(join(root, file), 'utf8');
    assert.match(source, /const base='\/'\+settings\.scraperPath/, file + ': the dashboard folder comes from the shop settings');
    assert.match(source, /if\(path===base\)return/, file + ': the folder serves the dashboard');
    assert.match(source, /path===base\+'\/dashboard\.js'/, file + ': the dashboard script is reachable inside the folder');
    assert.match(source, /path===base\+'\/shop'/, file + ': the shop admin page lives beside the dashboard');
    for (const route of ['/shop.js', '/checkout', '/order/:id', '/p/:id', '/track', '/page/:slug', '/categories', '/api/shop/order', '/api/shop/receipt', '/api/shop/settings', '/api/shop/callback/:gateway'])
      assert.ok(source.includes("'" + route + "'"), file + ': missing route ' + route);
    assert.match(source, /if\(!settings\.enabled\)return/, file + ': turning the shop off gives the dashboard its root back');
  }
});

test.after(() => rm(temp, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Professional shell: footer menu, product and tracking pages, mobile rules.
// ---------------------------------------------------------------------------

test('every page carries the footer menu, the header cart and no horizontal overflow', async () => {
  const d = deps();
  const pages = [await routes.cataloguePage(d, {}), await routes.checkoutPage(d), (await routes.infoPage(d, 'about')).html];
  for (const html of pages) {
    for (const url of ['./', './?view=categories', './?view=checkout', './?view=track'])
      assert.ok(html.includes(`data-go="${url}"`), 'footer menu entry missing: ' + url);
    for (const title of ['روش‌های پرداخت', 'ارسال و تحویل', 'بازگشت کالا', 'دربارهٔ ما', 'تماس با ما', 'قوانین و حریم خصوصی'])
      assert.ok(html.includes(`<summary>${title}</summary>`), 'footer info must be folded into the page, not linked: ' + title);
    assert.doesNotMatch(html, /href="\.\/[^"]*\//, 'no storefront link may go one level deeper than the app root');
    assert.doesNotMatch(html, /<a[^>]+class="footnav"/, 'footer entries are buttons, not links');
    assert.match(html, /<footer class="foot"/, 'the footer is part of the shell');
    assert.match(html, /id="cartCount"/, 'the header always shows the cart');
    assert.match(html, /overflow-x:hidden/, 'the page must never scroll sideways on mobile');
    assert.match(html, /viewport-fit=cover/, 'notched phones must use the full width');
    assert.match(html, /--tap:44px/, 'tap targets are at least 44px');
    assert.match(html, /class="skip"/, 'keyboard users get a skip link');
    assert.doesNotMatch(html, /<script>[^<]/, 'no inline script: script-src is self only');
  }
});

test('the mobile layout switches to a two column grid and a bottom tab bar', async () => {
  const html = await routes.cataloguePage(deps(), {});
  assert.match(html, /@media\(max-width:720px\)\{[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, 'two products per row on phones');
  assert.match(html, /@media\(max-width:360px\)\{\.grid\{grid-template-columns:1fr\}\}/, 'one per row on very small screens');
  assert.match(html, /env\(safe-area-inset-bottom\)/, 'the bottom bar respects the home indicator');
  assert.match(html, /\.pcard h3\{[^}]*-webkit-line-clamp:2/, 'long titles are clamped instead of breaking the card');
  assert.match(html, /@media\(max-width:900px\)\{\.tabbar\{display:block\}body\{padding-bottom:calc\(66px/, 'the tab bar only takes over on small screens and never covers the footer');
});

test('every page has the bottom tabs with the active one marked and a live cart badge', async () => {
  const d = deps();
  const pages = {
    home: await routes.cataloguePage(d, {}),
    categories: await routes.categoriesPage(d),
    cart: await routes.checkoutPage(d),
    track: (await routes.trackPage(d, {})).html
  };
  for (const [tab, html] of Object.entries(pages)) {
    assert.match(html, /<nav class="tabbar" aria-label="منوی پایین">/, tab + ': the bottom tab bar is missing');
    for (const href of ['./', './?view=categories', './?focus=1', './?view=checkout', './?view=track'])
      assert.ok(html.includes('href="' + href + '"'), tab + ': tab link missing ' + href);
    assert.match(html, /id="tabCartCount"/, tab + ': the cart tab must carry the item badge');
    assert.equal((html.match(/aria-current="page"/g) || []).length >= 1, true, tab + ': the active tab must be marked');
  }
  assert.match(pages.categories, /href="\.\/\?view=categories"[^>]*aria-current="page"/, 'the categories page marks its own tab');
});

test('products are grouped by category and type, never by profile', async () => {
  const d = deps();
  const { categories } = await routes.showcase(d, (await routes.loadShopConfig(d)).settings);
  assert.deepEqual(categories.map(entry => entry.name), ['کتری و سماور', 'نظافت', 'دسته‌بندی‌نشده'],
    'the most specific segment of the scraped category wins and uncategorised sinks to the end');
  assert.equal(core.categoryOf({ category: 'خانه > آشپزخانه > کتری و سماور' }), 'کتری و سماور');
  assert.equal(core.categoryOf({ category: 'Kitchen/Kettles' }), 'Kettles');
  assert.equal(core.categoryOf({ tags: 'هدیه، چوبی' }), 'هدیه', 'tags are the fallback grouping');
  assert.equal(core.categoryOf({}), 'دسته‌بندی‌نشده');
  const page = await routes.categoriesPage(d);
  assert.match(page, /دسته‌بندی محصولات/);
  assert.match(page, /کتری و سماور/);
  assert.match(page, /۱ محصول/);
  assert.doesNotMatch(page, /فروشگاه الف|فروشگاه ب|فروشگاه ج/, 'profile names never reach the storefront');
});

test('no customer facing page leaks a profile name', async () => {
  const d = deps({ state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  const placed = await routes.placeOrder(d, {
    gateway: 'card', items: [{ id: 'p-percent::a1', qty: 1 }],
    customer: { name: 'زهرا محمدی', phone: '09351234567', address: 'مشهد، بلوار سجاد، پلاک ۴' }
  }, 'https://shop.test');
  const pages = [await routes.cataloguePage(d, {}), await routes.categoriesPage(d),
    (await routes.productPage(d, 'p-percent::a1')).html, (await routes.orderPage(d, placed.orderId)).html];
  for (const html of pages) assert.doesNotMatch(html, /فروشگاه الف|فروشگاه ب|فروشگاه ج/, 'the sourcing profile is internal');
  const order = await routes.getOrder(d, placed.orderId);
  assert.equal(order.lines[0].profileName, 'فروشگاه الف', 'the profile is still recorded on the order for the shop owner');
});

test('all pages hang off the app root and honour a mounted base path', async () => {
  const d = deps();
  for (const [query, needle] of [[{}, 'class="grid"'], [{ view: 'categories' }, 'دسته‌بندی محصولات'],
    [{ view: 'checkout' }, 'تسویه حساب'], [{ view: 'track' }, 'پیگیری سفارش'], [{ product: 'p-percent::a1' }, 'محصولات مشابه']]) {
    const result = await routes.rootPage(d, query);
    assert.equal(result.status, 200, JSON.stringify(query));
    assert.ok(result.html.includes(needle), JSON.stringify(query) + ': wrong page');
    assert.match(result.html, /<base href="\/">/, 'links resolve against the app root');
    assert.ok(result.html.includes('<script src="shop.js" defer>'), 'the script is loaded from the root too');
  }
  const unknown = await routes.rootPage(d, { product: 'ghost::none' });
  assert.equal(unknown.status, 200, 'an unknown product falls back to the catalogue instead of a dead end');
  const mounted = deps({ state: [['shop.settings', { basePath: '/shop' }]] });
  const html = await routes.cataloguePage(mounted, {});
  assert.match(html, /<base href="\/shop\/">/, 'a mounted app keeps every link under its own root');
  assert.equal(core.normalizeBasePath('shop/'), '/shop/');
  assert.equal(core.normalizeBasePath(''), '/');
});

test('the storefront uses the same self hosted Persian fonts as the scraper panel', async () => {
  const html = await routes.cataloguePage(deps(), {});
  assert.ok(html.includes('<link rel="stylesheet" href="assets/fonts/vazir.css">'), 'Vazir comes from the scraper font route');
  assert.ok(html.includes('<link rel="stylesheet" href="assets/fonts/vazirmatn.css">'), 'Vazirmatn comes from the scraper font route');
  assert.match(html, /--font:Vazirmatn,Vazir,Tahoma/, 'same font stack as the dashboard');
  assert.match(html, /font-family:var\(--font\)/);
  // The font chosen in the scraper panel (settings.appearance.font) restyles the shop as well.
  const themed = deps({ state: [['settings', { appearance: { font: 'shabnam', fontSize: 'large' } }]] });
  const page = await routes.cataloguePage(themed, {});
  assert.ok(page.includes('href="assets/fonts/shabnam.css"'), 'the panel font is loaded from the same route');
  assert.match(page, /--font:Shabnam,Tahoma,sans-serif;--fsize:15px/, 'font family and size follow the panel');
  assert.equal(core.resolveAppearance({ appearance: { font: 'nope' } }).font, 'vazir', 'unknown fonts fall back');
});

test('a product without an image renders a placeholder instead of a broken image', async () => {
  const html = await routes.cataloguePage(deps(), { category: 'نظافت' });
  assert.match(html, /class="ph" role="img" aria-label="بدون تصویر"/);
  assert.doesNotMatch(html, /<img[^>]*src=""/, 'never emit an empty src');
});

test('the product page shows the coefficient breakdown and related items', async () => {
  const d = deps();
  const page = await routes.productPage(d, 'p-percent::a1');
  assert.equal(page.status, 200);
  assert.match(page.html, /کتری برقی/);
  assert.match(page.html, /قیمت مبدأ/);
  assert.match(page.html, /ضریب تعدیل پروفایل/);
  assert.match(page.html, /۱۴۴٬۰۰۰/);
  assert.match(page.html, /محصولات مشابه/);
  assert.equal((await routes.productPage(d, 'ghost::none')).status, 404, 'an unknown product is a clean 404');
});

test('sorting and paging keep the active filters in the links', async () => {
  const d = deps();
  const cheap = await routes.cataloguePage(d, { sort: 'cheap' });
  const order = [...cheap.matchAll(/class="final">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(order, ['۵۰٬۰۰۰', '۱۴۴٬۰۰۰', '۹۰۰٬۰۰۰'], 'cheapest first');
  const expensive = await routes.cataloguePage(d, { sort: 'expensive' });
  assert.deepEqual([...expensive.matchAll(/class="final">([^<]+)</g)].map(m => m[1]), ['۹۰۰٬۰۰۰', '۱۴۴٬۰۰۰', '۵۰٬۰۰۰']);
  const filtered = await routes.cataloguePage(d, { q: 'لیوان', sort: 'cheap' });
  assert.match(filtered, /<input type="hidden" name="q" value="لیوان">/, 'the sort form keeps the search term');
  const far = await routes.cataloguePage(d, { page: '99' });
  assert.match(far, /class="final"/, 'an out of range page clamps instead of showing an empty shop');
});

test('order tracking never 500s and never leaks another order', async () => {
  const d = deps({ state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  const empty = await routes.trackPage(d, {});
  assert.equal(empty.status, 200);
  assert.match(empty.html, /پیگیری سفارش/);
  const missing = await routes.trackPage(d, { order: 'NOPE-404' });
  assert.equal(missing.status, 404);
  assert.match(missing.html, /پیدا نشد/);
  assert.equal((await routes.trackPage(d, { order: '../../etc/passwd' })).status, 404);
  const placed = await routes.placeOrder(d, {
    gateway: 'card', items: [{ id: 'p-plain::c1', qty: 1 }],
    customer: { name: 'زهرا محمدی', phone: '09351234567', address: 'مشهد، بلوار سجاد، پلاک ۴' }
  }, 'https://shop.test');
  const found = await routes.trackPage(d, { order: placed.orderId });
  assert.equal(found.status, 302);
  assert.equal(found.location, '/?order=' + placed.orderId, 'tracking stays on the app root');
});

test('Persian digits typed by the customer are accepted (phone and receipt code)', async () => {
  const d = deps({ state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  const placed = await routes.placeOrder(d, {
    gateway: 'card', items: [{ id: 'p-plain::c1', qty: 1 }],
    customer: { name: 'رضا  احمدی', phone: '۰۹۱۲۳۴۵۶۷۸۹', address: 'اصفهان، خیابان چهارباغ، پلاک ۱۲' }
  }, 'https://shop.test');
  assert.equal(placed.ok, true, placed.error);
  const order = await routes.getOrder(d, placed.orderId);
  assert.equal(order.customer.phone, '09123456789', 'Persian digits are normalised, not rejected');
  assert.equal(order.customer.name, 'رضا احمدی', 'double spaces are collapsed');
  assert.equal((await routes.submitReceipt(d, { orderId: placed.orderId, reference: '۱۲۳۴۵۶' })).ok, true);
  assert.equal((await routes.getOrder(d, placed.orderId)).payment.reference, '123456');
  assert.equal(core.normalizeCustomer({ phone: '+989123456789' }).phone, '09123456789', 'the +98 prefix is accepted');
});

test('info pages exist for the whole footer menu and unknown slugs are 404', async () => {
  const d = deps();
  for (const slug of ['payment', 'shipping', 'returns', 'about', 'contact', 'terms']) {
    const page = await routes.infoPage(d, slug);
    assert.equal(page.status, 200, slug + ' must exist');
    assert.ok(page.html.length > 500, slug + ' must have content');
  }
  assert.equal((await routes.infoPage(d, 'nope')).status, 404);
});

test('the client script guards every DOM lookup and sanitises what it injects', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(join(root, 'worker-src/shop.ts'), 'utf8');
  const script = source.slice(source.indexOf('export const SHOP_JS'), source.indexOf('export function totalsSummary'));
  assert.match(script, /function esc\(/, 'cart rows are escaped before being injected');
  assert.match(script, /innerHTML=.*esc\(l\.title\)|esc\(l\.title\)/, 'product titles are escaped in the cart');
  assert.match(script, /function closest\(target,selector\)\{return target&&target\.closest\?/, 'clicks on non elements must not throw');
  assert.match(script, /window\.addEventListener\('storage'/, 'the cart stays in sync across tabs');
  assert.match(script, /Math\.max\(1,Math\.min\(999/, 'quantities are clamped on read');
  assert.doesNotMatch(script, /await /, 'no top level await in a classic script');
});
