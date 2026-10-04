// Offline preview of the storefront layer: real shop modules, in-memory profiles/products.
// node scripts/shop-preview.mjs  ->  http://0.0.0.0:3000
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(tmpdir(), 'shop-preview-'));
const load = async (entry, out) => {
  await build({ entryPoints: [join(root, entry)], outfile: join(temp, out), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(temp, out)));
};
const routes = await load('worker-src/shop-routes.ts', 'routes.mjs');
const { SHOP_JS } = await load('worker-src/shop.ts', 'shop.mjs');

const profiles = [
  { id: 'digikala-kitchen', name: 'لوازم آشپزخانه', priceMode: 'percent', priceValue: 20, roundPrice: 1000, minPrice: 0, titleSuffix: '' },
  { id: 'snapp-tools', name: 'ابزار برقی', priceMode: 'multiply', priceValue: 1.35, roundPrice: 5000, minPrice: 250000, titleSuffix: '' },
  { id: 'local-gifts', name: 'صنایع دستی', priceMode: 'add', priceValue: 25000, roundPrice: 0, minPrice: 0, titleSuffix: '' }
];
const image = n => `https://picsum.photos/seed/s4-${n}/600/600`;
const products = {
  'digikala-kitchen': [['کتری برقی ۱.۷ لیتری', 820000, 'خانه > آشپزخانه > چای‌ساز'], ['سرخ‌کن بدون روغن', 3450000, 'خانه > آشپزخانه > سرخ‌کن'], ['آبمیوه‌گیری صنعتی', 1990000, 'خانه > آشپزخانه > آبمیوه‌گیری'], ['توستر دو نفره', 740000, 'خانه > آشپزخانه > چای‌ساز']],
  'snapp-tools': [['دریل شارژی ۲۰ ولت', 2150000, 'ابزار > ابزار برقی'], ['فرز انگشتی', 1180000, 'ابزار > ابزار برقی'], ['اره عمودبر', 1640000, 'ابزار > ابزار برقی'], ['پیچ‌گوشتی برقی', 390000, 'ابزار > ابزار شارژی']],
  'local-gifts': [['بشقاب میناکاری', 480000, 'صنایع دستی > میناکاری'], ['جعبهٔ خاتم', 950000, 'صنایع دستی > خاتم'], ['فرش دستباف کوچک', 2750000, 'صنایع دستی > فرش'], ['سفال لالجین', 160000, 'صنایع دستی > سفال']]
};
const byProfile = Object.fromEntries(Object.entries(products).map(([id, list]) => [id, list.map(([title, price, category], index) => ({
  category,
  sourceKey: `${id}-${index}`, title, price, priceText: price.toLocaleString('fa-IR') + ' تومان',
  image: image(`${id}-${index}`), url: 'https://example.test/p', shortDesc: 'نمونهٔ پیش‌نمایش آفلاین.'
}))]));

const state = new Map([
  ['shop.settings', { name: 'ویترین نمونه', tagline: 'پیش‌نمایش آفلاین لایهٔ فروشگاه', shippingCost: 59000, freeShippingFrom: 3000000, taxPercent: 9, card: { number: '6037991234567890', holder: 'مدیر فروشگاه', bank: 'ملی' } }],
  ['shop.payments', { zarinpal: { enabled: true, merchantId: 'demo-merchant' }, torobpay: { enabled: true, merchantId: 'c', secret: 's' }, digipay: { enabled: true, merchantId: 'd', secret: 'u:p' }, card: { enabled: true } }]
]);
const deps = {
  listProfiles: async () => profiles,
  allProducts: async id => JSON.parse(JSON.stringify(byProfile[id] || [])),
  getState: async (key, fallback) => (state.has(key) ? state.get(key) : fallback),
  setState: async (key, value) => void state.set(key, value),
  // Pretend a WordPress site with the usual Iranian gateway plugins is connected.
  wooConfig: async () => ({ url: 'https://wp.example', key: 'ck_demo', secret: 'cs_demo' }),
  destinationId: async () => null,
  wooFetch: async (url, init) => {
    const body = url.includes('payment_gateways')
      ? [{ id: 'zarinpal', title: 'درگاه پرداخت زرین‌پال', description: 'پرداخت امن با همهٔ کارت‌های شتاب', enabled: true, order: 0 },
         { id: 'torobpay', title: 'ترب‌پی — خرید اعتباری', description: 'پرداخت در چند قسط', enabled: true, order: 1 },
         { id: 'digipay', title: 'دیجی‌پی', description: 'کیف پول و اعتبار دیجی‌پی', enabled: true, order: 2 },
         { id: 'wc_card_to_card', title: 'کارت به کارت', description: 'واریز به کارت فروشگاه و ثبت کد پیگیری', enabled: true, order: 3 },
         { id: 'cheque', title: 'چک', description: '', enabled: false, order: 4 }]
      : /orders\/\d+$/.test(url.split('?')[0])
        ? { id: 9001, status: 'processing', transaction_id: 'DEMO-TRX' }
        : { id: 9001, payment_url: 'https://wp.example/checkout/order-pay/9001/?pay_for_order=true' };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  },
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })
};

const send = (res, status, body, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const read = req => new Promise(resolve => { let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } }); });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  try {
    if (url.pathname === '/') {
      const result = await routes.rootPage(deps, query);
      if (result.location) { res.writeHead(302, { location: result.location }); return res.end(); }
      return send(res, result.status, result.html);
    }
    if (url.pathname.startsWith('/assets/fonts/')) return send(res, 200, '/* offline preview: fonts are served by the worker */', 'text/css; charset=utf-8');
    if (url.pathname === '/shop.js') return send(res, 200, SHOP_JS, 'application/javascript; charset=utf-8');
    if (url.pathname === '/categories') return send(res, 200, await routes.categoriesPage(deps));
    if (url.pathname === '/checkout') return send(res, 200, await routes.checkoutPage(deps));
    if (url.pathname.startsWith('/p/')) {
      const page = await routes.productPage(deps, decodeURIComponent(url.pathname.slice(3)));
      return page.html ? send(res, 200, page.html) : send(res, 404, 'not found', 'text/plain');
    }
    if (url.pathname === '/track') {
      const page = await routes.trackPage(deps, query);
      if (page.location) { res.writeHead(302, { location: page.location }); return res.end(); }
      return send(res, page.status, page.html);
    }
    if (url.pathname.startsWith('/page/')) {
      const page = await routes.infoPage(deps, url.pathname.slice(6));
      return page.html ? send(res, 200, page.html) : send(res, 404, 'not found', 'text/plain');
    }
    if (url.pathname === '/scraper/shop') return send(res, 200, await routes.adminPage(deps));
    if (url.pathname === '/scraper') return send(res, 200, '<h1 dir="rtl">اینجا پنل اسکریپر سرو می‌شود.</h1>');
    if (url.pathname.startsWith('/order/')) {
      const page = await routes.orderPage(deps, decodeURIComponent(url.pathname.slice(7)));
      return page.html ? send(res, 200, page.html) : send(res, 404, 'not found', 'text/plain');
    }
    if (url.pathname === '/api/shop/order') {
      const result = await routes.placeOrder(deps, await read(req), 'http://localhost:3000');
      return send(res, result.status, JSON.stringify(result), 'application/json');
    }
    if (url.pathname === '/api/shop/receipt') {
      const result = await routes.submitReceipt(deps, await read(req));
      return send(res, result.status, JSON.stringify(result), 'application/json');
    }
    if (url.pathname === '/api/shop/settings') {
      if (req.method === 'POST') return send(res, 200, JSON.stringify(await routes.saveShopSettings(deps, await read(req))), 'application/json');
      return send(res, 200, JSON.stringify(await routes.loadShopConfig(deps)), 'application/json');
    }
    if (url.pathname === '/api/shop/catalogue') return send(res, 200, JSON.stringify(await routes.catalogueJson(deps)), 'application/json');
    if (url.pathname.startsWith('/assets/fonts/')) return send(res, 200, '', 'text/css');
    send(res, 404, 'not found', 'text/plain');
  } catch (error) { send(res, 500, String(error?.stack || error), 'text/plain'); }
}).listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log('shop preview on 0.0.0.0:' + (process.env.PORT || 3000)));

process.on('SIGTERM', () => rm(temp, { recursive: true, force: true }).finally(() => process.exit(0)));
