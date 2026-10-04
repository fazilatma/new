// Payments are delegated to the WordPress/WooCommerce gateway PLUGINS: the storefront lists the
// gateways WooCommerce has enabled, creates the order over the WC REST API and sends the customer
// to Woo's payment_url. WooCommerce — not this app — decides when an order is paid.
// Driven with an injected fetch: the sandbox has no network and no live WordPress site.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(root, 'node_modules/.cache/payments-wp-'));
async function load(entry, out) {
  await build({ entryPoints: [join(root, entry)], outfile: join(temp, out), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(temp, out)));
}
const woo = await load('worker-src/payments-woo.ts', 'woo.mjs');
const routes = await load('worker-src/shop-routes.ts', 'routes.mjs');

const profiles = [{ id: 'p1', name: 'فروشگاه الف', priceMode: 'percent', priceValue: 20, roundPrice: 1000, minPrice: 0, titleSuffix: '' }];
const products = { p1: [{ sourceKey: 'a1', title: 'کتری برقی', price: 120000, priceText: '۱۲۰٬۰۰۰ تومان' }] };
const customer = { name: 'علی رضایی', phone: '09123456789', address: 'تهران، خیابان آزادی، پلاک ۱' };

const GATEWAYS = [
  { id: 'zarinpal', title: 'درگاه زرین‌پال', description: '<p>پرداخت امن</p>', enabled: true, order: 1 },
  { id: 'torobpay', title: 'ترب‌پی', description: 'خرید اعتباری', enabled: true, order: 0 },
  { id: 'digipay', title: 'دیجی‌پی', description: '', enabled: true, order: 2 },
  { id: 'cheque', title: 'چک', description: '', enabled: false, order: 3 }
];

function shop(responses = {}, options = {}) {
  const state = new Map(options.state || []);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || 'GET', headers: init?.headers || {}, body: init?.body ? JSON.parse(init.body) : undefined });
    const entry = Object.entries(responses).find(([fragment]) => url.includes(fragment));
    if (!entry) return { ok: false, status: 404, json: async () => ({ message: 'no fixture for ' + url }), text: async () => '' };
    const value = typeof entry[1] === 'function' ? entry[1](calls.length) : entry[1];
    return { ok: value.status === undefined || value.status < 400, status: value.status || 200, json: async () => value.body, text: async () => JSON.stringify(value.body) };
  };
  return {
    calls,
    deps: {
      listProfiles: async () => profiles,
      allProducts: async id => JSON.parse(JSON.stringify(products[id] || [])),
      getState: async (key, fallback) => (state.has(key) ? state.get(key) : fallback),
      setState: async (key, value) => void state.set(key, value),
      wooConfig: async () => (options.noWoo ? null : { url: 'https://shop.example/', key: 'ck_1', secret: 'cs_1' }),
      wooFetch: fetchImpl,
      fetchImpl,
      destinationId: async (profileId, sourceKey) => (options.mapped === false ? null : 4242)
    }
  };
}

test('checkout offers exactly the gateways WordPress has enabled, in the shop owner order', async () => {
  const { deps } = shop({ 'payment_gateways': { body: GATEWAYS } });
  const { settings, payments } = await routes.loadShopConfig(deps);
  assert.equal(settings.gatewaySource, 'wordpress', 'WordPress plugins are the default source');
  const choices = await routes.gatewayChoices(deps, settings, payments);
  assert.equal(choices.source, 'wordpress');
  assert.deepEqual(choices.gateways.map(g => g.id), ['torobpay', 'zarinpal', 'digipay'], 'disabled gateways are hidden, order is respected');
  assert.equal(choices.gateways[1].description, 'پرداخت امن', 'the WordPress description is shown as plain text');
  const html = await routes.checkoutPage(deps);
  assert.match(html, /درگاه زرین‌پال/);
  assert.match(html, /افزونه‌های درگاه وردپرس/);
  assert.doesNotMatch(html, /value="cheque"/);
});

test('placing an order creates a WooCommerce order and redirects to the plugin payment page', async () => {
  const { deps, calls } = shop({
    'payment_gateways': { body: GATEWAYS },
    'wc/v3/orders': { body: { id: 9001, payment_url: 'https://shop.example/checkout/order-pay/9001/?pay_for_order=true&key=wc_abc' } }
  });
  const result = await routes.placeOrder(deps, { gateway: 'zarinpal', items: [{ id: 'p1::a1', qty: 2 }], customer }, 'https://storefront.test');
  assert.equal(result.ok, true, result.error);
  assert.equal(result.redirect, 'https://shop.example/checkout/order-pay/9001/?pay_for_order=true&key=wc_abc');
  const create = calls.find(call => call.method === 'POST');
  assert.match(create.url, /^https:\/\/shop\.example\/wp-json\/wc\/v3\/orders$/);
  assert.match(String(create.headers.authorization), /^Basic /, 'the WC REST credentials are sent');
  assert.equal(create.body.payment_method, 'zarinpal');
  assert.equal(create.body.payment_method_title, 'درگاه زرین‌پال');
  assert.equal(create.body.set_paid, false);
  assert.equal(create.body.status, 'pending');
  assert.deepEqual(create.body.line_items, [{ product_id: 4242, quantity: 2, total: '288000' }], 'synced products use the real Woo product id and the storefront price');
  assert.equal(create.body.billing.phone, '09123456789');
  assert.deepEqual(create.body.meta_data, [{ key: '_scraper4_order', value: (await routes.getOrder(deps, result.orderId)).id }]);
  const order = await routes.getOrder(deps, result.orderId);
  assert.equal(order.payment.source, 'wordpress');
  assert.equal(order.payment.wooOrderId, 9001);
  assert.equal(order.status, 'pending', 'nothing is paid until WooCommerce says so');
});

test('a product that was never synced is still orderable as a named line item', async () => {
  const { deps, calls } = shop({ 'payment_gateways': { body: GATEWAYS }, 'wc/v3/orders': { body: { id: 11, payment_url: 'https://shop.example/pay/11' } } }, { mapped: false });
  const result = await routes.placeOrder(deps, { gateway: 'torobpay', items: [{ id: 'p1::a1', qty: 1 }], customer }, 'https://storefront.test');
  assert.equal(result.ok, true, result.error);
  const create = calls.find(call => call.method === 'POST');
  assert.deepEqual(create.body.line_items, [{ name: 'کتری برقی', quantity: 1, total: '144000', subtotal: '144000' }]);
});

test('WooCommerce is the source of truth for paid: the order page re-reads the Woo status', async () => {
  let wooStatus = 'pending';
  const { deps } = shop({
    'payment_gateways': { body: GATEWAYS },
    'wc/v3/orders/9002': () => ({ body: { id: 9002, status: wooStatus, transaction_id: 'TRX-55' } }),
    'wc/v3/orders': { body: { id: 9002, payment_url: 'https://shop.example/pay/9002' } }
  });
  const placed = await routes.placeOrder(deps, { gateway: 'digipay', items: [{ id: 'p1::a1', qty: 1 }], customer }, 'https://storefront.test');
  assert.equal((await routes.getOrder(deps, placed.orderId)).status, 'pending');

  let page = await routes.orderPage(deps, placed.orderId);
  assert.match(page.html, /در انتظار پرداخت/);

  wooStatus = 'processing';
  page = await routes.orderPage(deps, placed.orderId);
  assert.match(page.html, /پرداخت‌شده/, 'a processing Woo order means the plugin took the money');
  const paid = await routes.getOrder(deps, placed.orderId);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.payment.reference, 'TRX-55');
  assert.ok(paid.payment.paidAt);

  wooStatus = 'cancelled';
  await routes.orderPage(deps, placed.orderId);
  assert.equal((await routes.getOrder(deps, placed.orderId)).status, 'canceled');
});

test('WooCommerce failures never produce a silently accepted order', async () => {
  const { deps } = shop({ 'payment_gateways': { body: GATEWAYS }, 'wc/v3/orders': { status: 401, body: { message: 'Sorry, you cannot create resources.' } } });
  const result = await routes.placeOrder(deps, { gateway: 'zarinpal', items: [{ id: 'p1::a1', qty: 1 }], customer }, 'https://storefront.test');
  assert.equal(result.ok, false);
  assert.match(result.error, /cannot create resources/);
  assert.equal((await routes.getOrder(deps, result.orderId)).status, 'failed');

  const noPayUrl = shop({ 'payment_gateways': { body: GATEWAYS }, 'wc/v3/orders': { body: { id: 12 } } });
  const second = await routes.placeOrder(noPayUrl.deps, { gateway: 'zarinpal', items: [{ id: 'p1::a1', qty: 1 }], customer }, 'https://storefront.test');
  assert.equal(second.ok, false);
  assert.match(second.error, /آدرس پرداخت/);

  const down = shop({ 'payment_gateways': { status: 500, body: { message: 'boom' } } });
  const choices = await routes.gatewayChoices(down.deps, (await routes.loadShopConfig(down.deps)).settings, (await routes.loadShopConfig(down.deps)).payments);
  assert.equal(choices.gateways.length, 0);
  assert.match(choices.error, /درگاه‌های وردپرس/);
  const blocked = await routes.placeOrder(down.deps, { gateway: 'zarinpal', items: [{ id: 'p1::a1', qty: 1 }], customer }, 'https://storefront.test');
  assert.equal(blocked.ok, false);
});

test('without a WooCommerce connection the built-in adapters stay available as a fallback', async () => {
  const { deps } = shop({}, { noWoo: true, state: [['shop.payments', { card: { enabled: true } }], ['shop.settings', { card: { number: '6037991234567890' } }]] });
  const config = await routes.loadShopConfig(deps);
  const choices = await routes.gatewayChoices(deps, config.settings, config.payments);
  assert.equal(choices.source, 'builtin');
  assert.deepEqual(choices.gateways.map(g => g.id), ['card']);
  const placed = await routes.placeOrder(deps, { gateway: 'card', items: [{ id: 'p1::a1', qty: 1 }], customer }, 'https://storefront.test');
  assert.equal(placed.ok, true, placed.error);
  assert.equal((await routes.getOrder(deps, placed.orderId)).payment.source, 'builtin');
});

test('woo helpers build the REST url and the paid-status rule', () => {
  assert.equal(woo.wooUrl({ url: 'https://shop.example/', key: 'k', secret: 's' }, 'orders'), 'https://shop.example/wp-json/wc/v3/orders');
  assert.deepEqual(woo.WOO_PAID_STATUSES, ['processing', 'completed', 'on-hold']);
  assert.equal(woo.wooConfigured({ url: 'https://x', key: 'k', secret: '' }), false);
});

test.after(() => rm(temp, { recursive: true, force: true }));
