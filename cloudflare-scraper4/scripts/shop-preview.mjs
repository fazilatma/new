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
  'digikala-kitchen': [['کتری برقی ۱.۷ لیتری', 820000], ['سرخ‌کن بدون روغن', 3450000], ['آبمیوه‌گیری صنعتی', 1990000], ['توستر دو نفره', 740000]],
  'snapp-tools': [['دریل شارژی ۲۰ ولت', 2150000], ['فرز انگشتی', 1180000], ['اره عمودبر', 1640000], ['پیچ‌گوشتی برقی', 390000]],
  'local-gifts': [['بشقاب میناکاری', 480000], ['جعبهٔ خاتم', 950000], ['فرش دستباف کوچک', 2750000], ['سفال لالجین', 160000]]
};
const byProfile = Object.fromEntries(Object.entries(products).map(([id, list]) => [id, list.map(([title, price], index) => ({
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
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: { authority: 'DEMO-AUTHORITY' } }), text: async () => '' })
};

const send = (res, status, body, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
const read = req => new Promise(resolve => { let raw = ''; req.on('data', c => (raw += c)); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch { resolve({}); } }); });

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const query = Object.fromEntries(url.searchParams);
  try {
    if (url.pathname === '/') return send(res, 200, await routes.cataloguePage(deps, query));
    if (url.pathname === '/shop.js') return send(res, 200, SHOP_JS, 'application/javascript; charset=utf-8');
    if (url.pathname === '/checkout') return send(res, 200, await routes.checkoutPage(deps));
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
