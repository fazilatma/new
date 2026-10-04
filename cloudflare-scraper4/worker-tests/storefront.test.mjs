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
  assert.doesNotMatch(page.html, /ضریب تعدیل/, 'the invoice shows shop prices only, never the internal coefficient');
  const stored = await routes.getOrder(d, placed.orderId);
  assert.ok(stored.lines[0].adjustment.label, 'the coefficient is still recorded on the order for the shop owner');
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

test('the catalogue and category pages carry the reassurance strip and section headings', async () => {
  const d = deps({ settings: { freeShippingFrom: 500000, contactPhone: '02112345678' } });
  const home = await routes.cataloguePage(d, {});
  assert.match(home, /class="trust"/, 'the hero is followed by a reassurance strip');
  assert.match(home, /ارسال سریع/);
  assert.match(home, /پرداخت امن/);
  assert.match(home, /ضمانت بازگشت/);
  assert.match(home, /class="sechead"/, 'the chips rail gets a titled section header');
  assert.match(home, /href="\.\/\?view=categories"/, 'the "all categories" shortcut stays root relative');
  assert.doesNotMatch(home, /class="trust"[\s\S]*class="trust"/, 'the strip is rendered once');
  const cats = await routes.categoriesPage(d);
  assert.match(cats, /class="trust"/);
  assert.match(cats, /همهٔ دسته‌ها/);
});

test('the storefront never mentions scraper profiles, coefficients or source prices', async () => {
  const d = deps({ state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  const placed = await routes.placeOrder(d, {
    gateway: 'card', items: [{ id: 'p-percent::a1', qty: 1 }],
    customer: { name: 'زهرا محمدی', phone: '09351234567', address: 'مشهد، بلوار سجاد، پلاک ۴' }
  }, 'https://shop.test');
  const pages = [await routes.cataloguePage(d, {}), await routes.categoriesPage(d), await routes.checkoutPage(d),
    (await routes.productPage(d, 'p-percent::a1')).html, (await routes.orderPage(d, placed.orderId)).html,
    (await routes.trackPage(d, {})).html, (await routes.infoPage(d, 'about')).html];
  for (const html of pages) {
    assert.doesNotMatch(html, /پروفایل/, 'the word "profile" must never reach a shopper');
    assert.doesNotMatch(html, /اسکریپر|اسکرپر/, 'the scraper is invisible to shoppers');
    assert.doesNotMatch(html, /ضریب|ضرایب|قیمت مبدأ/, 'pricing coefficients and source prices stay internal');
  }
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
  const { readFile } = await import('node:fs/promises');
  const dashboard = await readFile(join(root, 'worker-src/dashboard.ts'), 'utf8');
  const html = await routes.cataloguePage(deps(), {});
  assert.ok(html.includes('<link rel="stylesheet" href="assets/fonts/vazir.css">'), 'Vazir comes from the scraper font route');
  assert.ok(html.includes('<link rel="stylesheet" href="assets/fonts/vazirmatn.css">'), 'Vazirmatn comes from the scraper font route');
  assert.match(html, /--app-font:Vazir,Tahoma,sans-serif/, 'the default is the panel default (vazir)');
  assert.match(html, /font-family:var\(--font\)/);
  // The panel picker must actually win there as well: a hard coded !important stack used to
  // pin the dashboard to Vazirmatn, which is why the two surfaces never looked the same.
  assert.match(dashboard, /body\{font-family:var\(--app-font[^}]*\)!important\}/, 'the panel honours its own font picker');
  // Every family and size step the panel offers must resolve to the identical value here.
  for (const [key, family] of [['system', 'Tahoma,system-ui,sans-serif'], ['vazir', 'Vazir,Tahoma,sans-serif'],
    ['yekan', 'Yekan,Tahoma,sans-serif'], ['shabnam', 'Shabnam,Tahoma,sans-serif'],
    ['sahel', 'Sahel,Tahoma,sans-serif'], ['samim', 'Samim,Tahoma,sans-serif']]) {
    assert.match(dashboard, new RegExp(key + ":\\{family:'" + family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'"), key + ' must match the panel stack');
    assert.equal(core.resolveAppearance({ appearance: { font: key } }).family, family, key + ' resolves to the panel stack');
  }
  for (const [size, px] of [['small', 12], ['medium', 14], ['large', 16], ['xlarge', 18]])
    assert.equal(core.resolveAppearance({ appearance: { fontSize: size } }).scale, px, size + ' matches the panel step');
  const themed = deps({ state: [['settings', { appearance: { font: 'shabnam', fontSize: 'large' } }]] });
  const page = await routes.cataloguePage(themed, {});
  assert.ok(page.includes('href="assets/fonts/shabnam.css"'), 'the panel font is loaded from the same route');
  assert.match(page, /--app-font:Shabnam,Tahoma,sans-serif;--font:var\(--app-font\);--fsize:16px/, 'font family and size follow the panel');
  assert.match(page, /html\{font-size:16px\}/, 'the panel scales the root font size, so the shop does too');
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
  assert.doesNotMatch(page.html, /قیمت مبدأ|ضریب|پروفایل/, 'sourcing price and coefficient are internal');
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

test('the shell carries a hamburger drawer wired to the same root relative destinations', async () => {
  const d = deps();
  const home = await routes.cataloguePage(d, {});
  assert.match(home, /id="menuBtn"[^>]*aria-controls="drawer"/, 'a hamburger button controls the drawer');
  assert.match(home, /<aside class="drawer" id="drawer"/, 'the drawer is part of every page');
  assert.match(home, /class="d-item" data-go="\.\/\?view=checkout"/, 'drawer entries are buttons, not links');
  assert.match(home, /id="drawerCartCount"/, 'the drawer shows the cart badge');
  assert.match(home, /data-fold="info-payment"/, 'guide entries open the in page fold instead of navigating');
  const aside = home.slice(home.indexOf('<aside class="drawer"'), home.indexOf('</aside>'));
  assert.doesNotMatch(aside, /<a /, 'the drawer never descends to another document');
  const checkout = await routes.checkoutPage(d);
  assert.match(checkout, /id="drawer"/, 'the drawer is on every page of the single page shell');
  assert.match(checkout, /class="d-item" data-go="\.\/\?view=checkout" aria-current="page"/, 'the active entry is marked');
});

test('the storefront behaves as one document: clicks swap main in place', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(join(root, 'worker-src/shop.ts'), 'utf8');
  const script = source.slice(source.indexOf('export const SHOP_JS'), source.indexOf('export function totalsSummary'));
  assert.match(script, /function navigate\(href,push\)/, 'there is a client side router');
  assert.match(script, /history\.pushState/, 'navigation keeps real URLs');
  assert.match(script, /window\.addEventListener\('popstate'/, 'back and forward work');
  assert.match(script, /main\.innerHTML=next\.innerHTML/, 'only the main region is replaced');
  assert.match(script, /url\.pathname!==appRoot\(\)/, 'anything outside the app root is left to the browser');
  assert.match(script, /\.catch\(function\(\)\{location\.href=url\.href\}\)/, 'a failed swap falls back to a real navigation');
  assert.match(script, /onClick\('#placeOrder'/, 'page actions are delegated so they survive a swap');
  assert.match(script, /onClick\('#sendReceipt'/);
  assert.match(script, /function toggleDrawer\(open\)/, 'the drawer is scripted');
  assert.doesNotMatch(script, /document\.getElementById\('placeOrder'\)/, 'no bindings that break after a swap');
});

test('a click really swaps main in place instead of loading another document', async () => {
  const { parseHTML } = await import('linkedom');
  const shop = await load('worker-src/shop.ts', 'shop-spa.mjs');
  const shell = `<!doctype html><html><head><base href="/"><title>A</title></head><body>
<div id="navbar"></div><header class="head"><button id="menuBtn" aria-expanded="false"></button>
<form class="search" action="./"><input name="q" value=""></form></header>
<aside class="drawer" id="drawer"><button class="d-item" data-go="./?view=categories"></button>
<button class="d-item" data-fold="info-payment"></button></aside>
<main class="wrap" id="main"><p>HOME</p></main>
<footer class="foot"><details class="footinfo" id="info-payment"><summary>s</summary></details></footer>
<nav class="tabbar"></nav></body></html>`;
  const next = `<!doctype html><html><head><title>CATS</title></head><body><main id="main"><p>CATEGORIES</p></main>
<footer class="foot"></footer><nav class="tabbar"></nav><aside id="drawer"></aside></body></html>`;
  const { window, document } = parseHTML(shell);
  const fetched = [], pushed = [];
  window.fetch = async url => { fetched.push(String(url)); return { ok: true, status: 200, text: async () => next }; };
  window.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  window.DOMParser = class { parseFromString(html) { return parseHTML(html).document } };
  window.history = { pushState: (a, b, url) => pushed.push(url), replaceState: () => {} };
  window.scrollTo = () => {};
  window.location = { origin: 'http://localhost:3000', href: 'http://localhost:3000/', pathname: '/', search: '' };
  const run = new Function('window', 'document', 'location', 'localStorage', 'fetch', 'DOMParser', 'history',
    'URL', 'URLSearchParams', 'FormData', 'setTimeout', 'console', shop.SHOP_JS);
  run(window, document, window.location, window.localStorage, window.fetch, window.DOMParser, window.history,
    URL, URLSearchParams, window.FormData, setTimeout, console);
  const fire = node => {
    const event = new window.Event('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: node });
    Object.defineProperty(event, 'button', { value: 0 });
    node.dispatchEvent(event);
  };
  fire(document.querySelector('#menuBtn'));
  assert.ok(document.body.classList.contains('drawer-open'), 'the hamburger opens the drawer');
  assert.equal(document.querySelector('#menuBtn').getAttribute('aria-expanded'), 'true');
  fire(document.querySelector('[data-fold="info-payment"]'));
  assert.ok(document.getElementById('info-payment').hasAttribute('open'), 'guide entries unfold on the same page');
  assert.ok(!document.body.classList.contains('drawer-open'), 'and close the drawer');
  fire(document.querySelector('.d-item[data-go="./?view=categories"]'));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(fetched, ['http://localhost:3000/?view=categories'], 'the destination is fetched, not navigated to');
  assert.deepEqual(pushed, ['http://localhost:3000/?view=categories'], 'the URL still changes for real');
  assert.equal(document.title, 'CATS', 'the title follows the swapped view');
  assert.match(document.getElementById('main').innerHTML, /CATEGORIES/, 'only main is replaced');
});

test('a shopper can browse, filter, search and fill the cart without one page reload', async () => {
  const { parseHTML } = await import('linkedom');
  const shop = await load('worker-src/shop.ts', 'shop-flow.mjs');
  const d = deps({ state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  // The client runs against the real route dispatcher: whatever the server would answer.
  const serve = async href => {
    const url = new URL(href, 'http://shop.test');
    const query = Object.fromEntries(url.searchParams.entries());
    const page = await routes.rootPage(d, query);
    return page.html || (await routes.cataloguePage(d, {}));
  };
  const { window, document } = parseHTML(await serve('/'));
  const store = new Map();
  let current = 'http://shop.test/', hard = 0;
  window.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  window.DOMParser = class { parseFromString(html) { return parseHTML(html).document } };
  window.location = { get origin() { return 'http://shop.test' }, get href() { return current },
    set href(value) { hard++; current = String(value) },
    get pathname() { return new URL(current).pathname }, get search() { return new URL(current).search } };
  window.history = { pushState: (a, b, url) => { current = String(url) }, replaceState: (a, b, url) => { current = String(url) } };
  window.scrollTo = () => {};
  window.fetch = async href => ({ ok: true, status: 200, text: () => serve(new URL(String(href), current).href) });
  const run = new Function('window', 'document', 'location', 'localStorage', 'fetch', 'DOMParser', 'history',
    'URL', 'URLSearchParams', 'setTimeout', 'console', shop.SHOP_JS);
  run(window, document, window.location, window.localStorage, window.fetch, window.DOMParser, window.history,
    URL, URLSearchParams, setTimeout, console);
  const click = node => {
    assert.ok(node, 'the element a shopper would click must exist');
    const event = new window.Event('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: node });
    Object.defineProperty(event, 'button', { value: 0 });
    node.dispatchEvent(event);
  };
  const settle = () => new Promise(resolve => setTimeout(resolve, 120));
  const main = () => document.getElementById('main');
  const cards = () => (main().innerHTML.match(/class="pcard"/g) || []).length;
  const all = cards();
  assert.ok(all > 1, 'the catalogue starts with products');
  click(document.querySelector('.chip:not(.on)'));
  await settle();
  assert.match(current, /\?category=/, 'a category chip filters in place');
  assert.ok(cards() < all, 'and the grid really changes');
  const sort = document.getElementById('sort');
  Object.defineProperty(sort, 'value', { value: 'cheap', configurable: true });
  sort.dispatchEvent(Object.defineProperty(new window.Event('change', { bubbles: true }), 'target', { value: sort }));
  await settle();
  assert.match(current, /sort=cheap/, 'the sort select navigates without a form post');
  const form = document.querySelector('.head form.search'), box = form.querySelector('input');
  Object.defineProperty(box, 'value', { value: 'کتری', configurable: true });
  form.dispatchEvent(Object.defineProperty(new window.Event('submit', { bubbles: true }), 'target', { value: form }));
  await settle();
  assert.match(decodeURIComponent(current), /\?q=کتری/, 'search stays on the same document');
  click(document.querySelector('.pcard h3 a'));
  await settle();
  assert.match(current, /\?product=/, 'a product opens in place');
  click(main().querySelector('.add'));
  await settle();
  assert.equal(JSON.parse(store.get('shop.cart.v1')).length, 1, 'the product lands in the cart');
  click(document.getElementById('cartLink'));
  await settle();
  assert.match(main().innerHTML, /data-remove=/, 'the cart renders on the checkout view');
  assert.match(main().innerHTML, /name="gateway"/, 'payment choices are there');
  click(document.querySelector('[data-step="1"]'));
  await settle();
  assert.equal(JSON.parse(store.get('shop.cart.v1'))[0].qty, 2, 'quantity controls work after the swap');
  click(document.querySelector('[data-remove]'));
  await settle();
  assert.match(main().innerHTML, /سبد خرید خالی/, 'removing the last line shows the empty cart');
  click(document.querySelector('.d-item[data-go="./?view=track"]'));
  await settle();
  assert.match(current, /view=track/);
  assert.equal(hard, 0, 'not a single full page load during the whole journey');
});

test('the worker serves a stylesheet for every font the panel offers', async () => {
  const fonts = await load('worker-src/fonts.ts', 'fonts.mjs');
  for (const name of ['vazirmatn', 'vazir', 'yekan', 'shabnam', 'sahel', 'samim']) {
    const response = fonts.fontStylesheet(name);
    assert.equal(response.status, 200, name + '.css must exist on the worker too');
    const css = await response.text();
    assert.match(css, /@font-face/, name + ' must define faces');
    assert.match(css, new RegExp('/assets/fonts/' + name + '-\\d+\\.woff2'), name + ' must fall back to the self hosted file');
  }
  assert.equal(fonts.fontStylesheet('nope').status, 404);
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
  const shop = await load('worker-src/shop.ts', 'shop.mjs');
  assert.doesNotThrow(() => new Function(shop.SHOP_JS), 'the shipped script must parse');
});
