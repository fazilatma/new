// Payment plugins. The sandbox has no network, so the full request/verify handshake is driven
// with an injected fetch and fixture responses: endpoint, amount unit (Toman -> Rial) and the
// success/failure decision are all pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(root, 'node_modules/.cache/payments-'));
await build({ entryPoints: [join(root, 'worker-src/payments.ts')], outfile: join(temp, 'payments.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const pay = await import(pathToFileURL(join(temp, 'payments.mjs')));

const order = {
  id: 'ORD-1', createdAt: '', updatedAt: '', status: 'pending', gateway: 'zarinpal',
  customer: { name: 'علی', phone: '09123456789', address: 'تهران' },
  lines: [{ id: 'p::a', profileId: 'p', profileName: 'الف', sourceKey: 'a', title: 'کتری', qty: 1, basePrice: 100000, price: 144000, adjustment: { mode: 'percent', value: 20, round: 0, minPrice: 0, label: '+۲۰٪', factor: 1.2 } }],
  subtotal: 144000, shipping: 0, tax: 0, total: 144000, currency: 'تومان', payment: {}
};

function recorder(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init?.body && typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body });
    const entry = Object.entries(responses).find(([fragment]) => url.includes(fragment));
    const payload = entry ? entry[1] : {};
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  return { calls, fetchImpl };
}

const settings = pay.normalizePaymentSettings({
  zarinpal: { enabled: true, merchantId: 'merchant-1' },
  torobpay: { enabled: true, merchantId: 'client-1', secret: 'secret-1' },
  digipay: { enabled: true, merchantId: 'digi-client', secret: 'user:pass' },
  card: { enabled: true }
});

test('every plugin is registered with its Persian title', () => {
  assert.deepEqual(pay.PAYMENT_IDS, ['zarinpal', 'torobpay', 'digipay', 'card']);
  assert.deepEqual(pay.PAYMENT_PLUGINS.map(p => p.title), ['زرین‌پال', 'ترب‌پی', 'دیجی‌پی', 'کارت به کارت']);
  assert.equal(pay.isPaymentGateway('zarinpal'), true);
  assert.equal(pay.isPaymentGateway('paypal'), false);
});

test('amounts leave the shop in Rial, never in Toman', () => {
  assert.equal(pay.toRial(144000), 1440000);
  assert.equal(pay.toRial(-5), 0);
});

test('zarinpal: request returns a StartPay redirect and verify accepts code 100 and 101', async () => {
  const { calls, fetchImpl } = recorder({ 'payment/request.json': { data: { authority: 'A00000000000000000000000000123456789' } } });
  const started = await pay.startPayment('zarinpal', { order, settings, callbackUrl: 'https://shop.test/api/shop/callback/zarinpal?order=ORD-1', fetchImpl });
  assert.equal(started.ok, true);
  assert.match(calls[0].url, /^https:\/\/payment\.zarinpal\.com\/pg\/v4\/payment\/request\.json$/);
  assert.equal(calls[0].body.amount, 1440000);
  assert.equal(calls[0].body.merchant_id, 'merchant-1');
  assert.match(started.redirect, /\/pg\/StartPay\/A00000000000000000000000000123456789$/);

  const paid = { ...order, payment: { authority: 'A00000000000000000000000000123456789' } };
  for (const code of [100, 101]) {
    const verify = recorder({ 'payment/verify.json': { data: { code, ref_id: 77 } } });
    const result = await pay.verifyPayment('zarinpal', { order: paid, settings, query: { Status: 'OK', Authority: paid.payment.authority }, fetchImpl: verify.fetchImpl });
    assert.equal(result.ok, true, 'code ' + code + ' means the money arrived');
    assert.equal(result.reference, '77');
  }
  const failed = recorder({ 'payment/verify.json': { errors: { message: 'Session is not valid' } } });
  assert.equal((await pay.verifyPayment('zarinpal', { order: paid, settings, query: { Status: 'OK', Authority: paid.payment.authority }, fetchImpl: failed.fetchImpl })).ok, false);
});

test('zarinpal: a cancelled return or a foreign authority is never accepted', async () => {
  const paid = { ...order, payment: { authority: 'MINE' } };
  const canceled = await pay.verifyPayment('zarinpal', { order: paid, settings, query: { Status: 'NOK', Authority: 'MINE' }, fetchImpl: async () => { throw new Error('must not call the gateway'); } });
  assert.equal(canceled.ok, false);
  assert.match(canceled.error, /لغو/);
  const foreign = await pay.verifyPayment('zarinpal', { order: paid, settings, query: { Status: 'OK', Authority: 'SOMEONE-ELSE' }, fetchImpl: async () => { throw new Error('must not call the gateway'); } });
  assert.equal(foreign.ok, false);
});

test('torobpay: token request carries the merchant headers and verify needs SUCCESS', async () => {
  const { calls, fetchImpl } = recorder({ 'payment/token': { token: 'TP-1', paymentPageUrl: 'https://tpay.torob.com/pay/TP-1' } });
  const started = await pay.startPayment('torobpay', { order, settings, callbackUrl: 'https://shop.test/cb', fetchImpl });
  assert.equal(started.ok, true);
  assert.equal(started.redirect, 'https://tpay.torob.com/pay/TP-1');
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-1');
  assert.equal(calls[0].init.headers['x-client-id'], 'client-1');
  assert.equal(calls[0].body.amount, 1440000);
  const good = recorder({ 'payment/verify': { status: 'SUCCESS', referenceNumber: 'R-9' } });
  assert.deepEqual(await pay.verifyPayment('torobpay', { order, settings, query: { token: 'TP-1' }, fetchImpl: good.fetchImpl }), { ok: true, reference: 'R-9' });
  const bad = recorder({ 'payment/verify': { status: 'FAILED', message: 'اعتبار کافی نیست' } });
  assert.equal((await pay.verifyPayment('torobpay', { order, settings, query: { token: 'TP-1' }, fetchImpl: bad.fetchImpl })).error, 'اعتبار کافی نیست');
});

test('digipay: an OAuth token is fetched before the ticket, and verify needs status 0', async () => {
  const { calls, fetchImpl } = recorder({ 'oauth/token': { access_token: 'TOK' }, 'businesses/ticket': { redirectUrl: 'https://mydigipay.com/pay/XYZ', ticket: 'XYZ' } });
  const started = await pay.startPayment('digipay', { order, settings, callbackUrl: 'https://shop.test/cb', fetchImpl });
  assert.equal(started.ok, true);
  assert.equal(started.redirect, 'https://mydigipay.com/pay/XYZ');
  assert.match(calls[0].url, /oauth\/token$/);
  assert.match(String(calls[0].init.headers.authorization), /^Basic /);
  assert.equal(calls[1].init.headers.authorization, 'Bearer TOK');
  assert.equal(calls[1].body.amount, 1440000);
  const ok = recorder({ 'oauth/token': { access_token: 'TOK' }, 'purchases/verify': { result: { status: 0 }, trackingCode: 'XYZ' } });
  assert.equal((await pay.verifyPayment('digipay', { order, settings, query: { trackingCode: 'XYZ' }, fetchImpl: ok.fetchImpl })).ok, true);
  const no = recorder({ 'oauth/token': { access_token: 'TOK' }, 'purchases/verify': { result: { status: 9, message: 'ناموفق' } } });
  assert.equal((await pay.verifyPayment('digipay', { order, settings, query: { trackingCode: 'XYZ' }, fetchImpl: no.fetchImpl })).ok, false);
});

test('card to card never touches the network and asks for a receipt code', async () => {
  const started = await pay.startPayment('card', {
    order, settings, callbackUrl: 'https://shop.test/cb',
    card: { number: '6037991234567890', holder: 'مدیر فروشگاه', bank: 'ملی' },
    fetchImpl: async () => { throw new Error('card to card must not call any gateway'); }
  });
  assert.equal(started.ok, true);
  assert.match(started.instructions, /6037-9912-3456-7890/);
  assert.match(started.instructions, /مدیر فروشگاه/);
  assert.equal(started.redirect, undefined);
  assert.equal((await pay.verifyPayment('card', { order, settings, query: { reference: '' } })).ok, false);
  assert.deepEqual(await pay.verifyPayment('card', { order, settings, query: { reference: '123456' } }), { ok: true, reference: '123456' });
});

test('a disabled gateway and a gateway outage both fail safely instead of marking an order paid', async () => {
  const off = pay.normalizePaymentSettings({ zarinpal: { enabled: false, merchantId: 'm' } });
  assert.equal((await pay.startPayment('zarinpal', { order, settings: off, callbackUrl: 'x' })).ok, false);
  const down = await pay.startPayment('zarinpal', { order, settings, callbackUrl: 'x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.ok, false);
  assert.match(down.error, /ECONNREFUSED/);
});

test.after(() => rm(temp, { recursive: true, force: true }));
