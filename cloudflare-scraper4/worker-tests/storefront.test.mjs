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
  'p-percent': [{ sourceKey: 'a1', title: 'کتری برقی', price: 120000, priceText: '۱۲۰٬۰۰۰ تومان', image: 'https://x/i.jpg' }],
  'p-multiply': [{ sourceKey: 'b1', title: 'جاروبرقی', price: 500000, priceText: '۵۰۰٬۰۰۰ تومان' }],
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
  assert.match(html, /فروشگاه الف/, 'each card is attributed to its profile');
  assert.match(html, /ضرایب تعدیل/, 'the page explains that profile coefficients are applied');
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'no inline script: script-src is self only');
  const { settings } = await routes.loadShopConfig(d);
  assert.equal(settings.scraperPath, 'scraper');
  assert.equal(core.normalizeScraperPath('/'), 'scraper', 'the scraper can never take the root back');
  assert.equal(core.normalizeScraperPath('/panel/'), 'panel');
});

test('the catalogue filters by profile and by search term', async () => {
  const d = deps();
  const onlyB = await routes.cataloguePage(d, { profile: 'p-multiply' });
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
  assert.match(page.html, /ضریب تعدیل پروفایل/, 'the order keeps the coefficient that produced its price');
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
    for (const route of ['/shop.js', '/checkout', '/order/:id', '/api/shop/order', '/api/shop/receipt', '/api/shop/settings', '/api/shop/callback/:gateway'])
      assert.ok(source.includes("'" + route + "'"), file + ': missing route ' + route);
    assert.match(source, /if\(!settings\.enabled\)return/, file + ': turning the shop off gives the dashboard its root back');
  }
});

test.after(() => rm(temp, { recursive: true, force: true }));
