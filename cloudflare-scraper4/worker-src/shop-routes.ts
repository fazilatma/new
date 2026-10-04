/**
 * Storefront request handlers, shared by the Cloudflare Worker and the Node/Render twin.
 * Pure data in / data out: the twins only translate Hono context <-> these plain objects.
 */
import {
  DEFAULT_SHOP_SETTINGS, SHOP_ORDER_INDEX_KEY, SHOP_SETTINGS_KEY, adjustmentOf, basePriceOf,
  customerProblem, itemId, money, normalizeCustomer, toEnglishDigits, normalizeShopSettings, orderStateKey, orderTotals,
  parseItemId, showcaseItem,
  type Order, type OrderStatus, type ShopProduct, type ShopProfile, type ShopSettings, type ShowcaseItem
} from './shop-core.js';
import {
  PAYMENT_SETTINGS_KEY, availableGateways, isPaymentGateway, normalizePaymentSettings, startPayment, verifyPayment,
  type Fetcher, type PaymentGatewayId, type PaymentSettings
} from './payments.js';
import { catalogueHtml, checkoutHtml, infoPageHtml, orderHtml, productHtml, shopAdminHtml, trackHtml } from './shop.js';
import { createWooOrder, listWooGateways, readWooOrder, wooConfigured, type WooClient, type WooConfig, type WooFetch } from './payments-woo.js';

export type ShopDeps = {
  listProfiles: () => Promise<ShopProfile[]>;
  allProducts: (profileId: string) => Promise<ShopProduct[]>;
  getState: <T>(key: string, fallback: T) => Promise<T>;
  setState: (key: string, value: unknown) => Promise<void>;
  fetchImpl?: Fetcher;
  /** WooCommerce connection from the dashboard vault; enables the WordPress gateway plugins. */
  wooConfig?: () => Promise<WooConfig | null>;
  wooFetch?: WooFetch;
  /** Woo product id of an already synced product, so orders use real catalogue lines. */
  destinationId?: (profileId: string, sourceKey: string) => Promise<number | string | null>;
};

export type GatewayOption = { id: string; title: string; description: string };
export type GatewayChoices = { source: 'wordpress' | 'builtin'; gateways: GatewayOption[]; error?: string };

async function wooClient(deps: ShopDeps): Promise<WooClient | null> {
  const config = deps.wooConfig ? await deps.wooConfig() : null;
  if (!wooConfigured(config)) return null;
  return { config, fetch: (deps.wooFetch ?? deps.fetchImpl ?? (globalThis.fetch as unknown as WooFetch)) };
}

/**
 * Checkout methods. Preferred source is the WordPress site: whatever gateway plugin the owner
 * activated in WooCommerce is offered here, with its own Persian title and description.
 * The built-in adapters are only a fallback for installs with no Woo connection.
 */
export async function gatewayChoices(deps: ShopDeps, settings: ShopSettings, payments: PaymentSettings): Promise<GatewayChoices> {
  if (settings.gatewaySource === 'wordpress') {
    const client = await wooClient(deps);
    if (client) {
      try {
        const gateways = await listWooGateways(client);
        if (gateways.length) return { source: 'wordpress', gateways };
        return { source: 'wordpress', gateways: [], error: 'در ووکامرس هیچ درگاه پرداختی فعال نیست. افزونهٔ درگاه را در وردپرس فعال کنید.' };
      } catch (error) {
        return { source: 'wordpress', gateways: [], error: `دریافت درگاه‌های وردپرس ناموفق بود: ${(error as Error)?.message || error}` };
      }
    }
  }
  return {
    source: 'builtin',
    gateways: availableGateways(payments, settings.card.number).map(plugin => ({ id: plugin.id, title: plugin.title, description: plugin.description }))
  };
}

export const PER_PAGE = 24;

export async function loadShopConfig(deps: ShopDeps): Promise<{ settings: ShopSettings; payments: PaymentSettings }> {
  const [rawSettings, rawPayments] = await Promise.all([
    deps.getState<unknown>(SHOP_SETTINGS_KEY, DEFAULT_SHOP_SETTINGS),
    deps.getState<unknown>(PAYMENT_SETTINGS_KEY, {})
  ]);
  return { settings: normalizeShopSettings(rawSettings), payments: normalizePaymentSettings(rawPayments) };
}

/** Every showcased product, priced with its own profile's coefficients. */
export async function showcase(deps: ShopDeps, settings: ShopSettings): Promise<{ items: ShowcaseItem[]; profiles: Array<{ id: string; name: string; count: number }> }> {
  const profiles = (await deps.listProfiles()).filter(profile => !settings.profileIds.length || settings.profileIds.includes(profile.id));
  const items: ShowcaseItem[] = [];
  const summary: Array<{ id: string; name: string; count: number }> = [];
  for (const profile of profiles) {
    const products = await deps.allProducts(profile.id);
    const priced = products.filter(product => basePriceOf(product) > 0).map(product => showcaseItem(product, profile));
    items.push(...priced);
    summary.push({ id: profile.id, name: profile.name, count: priced.length });
  }
  return { items, profiles: summary.filter(entry => entry.count > 0) };
}

export async function cataloguePage(deps: ShopDeps, query: { q?: string; profile?: string; page?: string; sort?: string }): Promise<string> {
  const { settings } = await loadShopConfig(deps);
  const { items, profiles } = await showcase(deps, settings);
  const q = String(query.q ?? '').trim().slice(0, 80);
  const profileId = String(query.profile ?? '').trim();
  const sort = ['cheap', 'expensive', 'name'].includes(String(query.sort)) ? String(query.sort) : '';
  const needle = q.toLowerCase();
  const filtered = items.filter(item =>
    (!profileId || item.profileId === profileId) &&
    (!needle || item.title.toLowerCase().includes(needle) || String(item.brand || '').toLowerCase().includes(needle)));
  if (sort === 'cheap') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'expensive') filtered.sort((a, b) => b.price - a.price);
  if (sort === 'name') filtered.sort((a, b) => a.title.localeCompare(b.title, 'fa'));
  const pages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const page = Math.max(1, Math.min(pages, Math.round(Number(query.page) || 1)));
  const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  return catalogueHtml({ settings, items: slice, profiles, query: { q, profileId, page, sort }, total: filtered.length, perPage: PER_PAGE });
}

/** Single product page: same price contract as the card, plus the coefficient breakdown. */
export async function productPage(deps: ShopDeps, id: string): Promise<{ status: number; html?: string }> {
  const { settings } = await loadShopConfig(deps);
  const { items } = await showcase(deps, settings);
  const item = items.find(entry => entry.id === String(id || ''));
  if (!item) return { status: 404 };
  const related = items.filter(entry => entry.id !== item.id && entry.profileId === item.profileId).slice(0, 4);
  return { status: 200, html: productHtml({ settings, item, related: related.length ? related : items.filter(entry => entry.id !== item.id).slice(0, 4) }) };
}

/** Order lookup from the footer menu. A wrong number must never 500 or leak other orders. */
export async function trackPage(deps: ShopDeps, query: { order?: string }): Promise<{ status: number; html?: string; location?: string }> {
  const { settings } = await loadShopConfig(deps);
  const id = String(query.order ?? '').trim().toUpperCase();
  if (!id) return { status: 200, html: trackHtml({ settings }) };
  const order = await getOrder(deps, id);
  if (!order) return { status: 404, html: trackHtml({ settings, notFound: 'سفارشی با این شماره پیدا نشد. شمارهٔ سفارش را دوباره بررسی کنید.' }) };
  return { status: 302, location: `/order/${encodeURIComponent(order.id)}` };
}

export async function infoPage(deps: ShopDeps, slug: string): Promise<{ status: number; html?: string }> {
  const { settings } = await loadShopConfig(deps);
  const html = infoPageHtml(settings, String(slug || '').toLowerCase());
  return html ? { status: 200, html } : { status: 404 };
}

export async function checkoutPage(deps: ShopDeps): Promise<string> {
  const { settings, payments } = await loadShopConfig(deps);
  const choices = await gatewayChoices(deps, settings, payments);
  return checkoutHtml({ settings, gateways: choices.gateways, source: choices.source, error: choices.error });
}

export async function adminPage(deps: ShopDeps): Promise<string> {
  const { settings, payments } = await loadShopConfig(deps);
  return shopAdminHtml({ settings, payments, scraperPath: settings.scraperPath });
}

export async function saveShopSettings(deps: ShopDeps, body: any): Promise<{ ok: true; settings: ShopSettings; payments: PaymentSettings }> {
  const current = await loadShopConfig(deps);
  const settings = normalizeShopSettings({ ...current.settings, ...(body?.shop || {}), card: { ...current.settings.card, ...(body?.shop?.card || {}) } });
  const merged: Record<string, any> = { ...current.payments };
  for (const [id, patch] of Object.entries(body?.payments || {})) merged[id] = { ...(merged[id] || {}), ...(patch as object) };
  const payments = normalizePaymentSettings(merged);
  await deps.setState(SHOP_SETTINGS_KEY, settings);
  await deps.setState(PAYMENT_SETTINGS_KEY, payments);
  return { ok: true, settings, payments };
}

export async function getOrder(deps: ShopDeps, id: string): Promise<Order | null> {
  if (!/^[A-Za-z0-9-]{6,40}$/.test(String(id || ''))) return null;
  return deps.getState<Order | null>(orderStateKey(String(id)), null);
}

async function saveOrder(deps: ShopDeps, order: Order): Promise<void> {
  order.updatedAt = new Date().toISOString();
  await deps.setState(orderStateKey(order.id), order);
  const index = await deps.getState<string[]>(SHOP_ORDER_INDEX_KEY, []);
  if (!index.includes(order.id)) await deps.setState(SHOP_ORDER_INDEX_KEY, [order.id, ...index].slice(0, 500));
}

export type PlaceResult = { ok: boolean; status: number; orderId?: string; redirect?: string; instructions?: string; error?: string };

/**
 * Prices are recomputed from the database here. The browser only sends ids and quantities, so a
 * tampered cart cannot change what the customer is charged.
 */
export async function placeOrder(deps: ShopDeps, body: any, origin: string): Promise<PlaceResult> {
  const { settings, payments } = await loadShopConfig(deps);
  if (!settings.enabled) return { ok: false, status: 503, error: 'فروشگاه غیرفعال است.' };
  const gateway = String(body?.gateway || '').slice(0, 60);
  const choices = await gatewayChoices(deps, settings, payments);
  const chosen = choices.gateways.find(option => option.id === gateway);
  if (!chosen) return { ok: false, status: 400, error: choices.error || 'این روش پرداخت فعال یا کامل تنظیم نشده است.' };
  if (choices.source === 'builtin' && !isPaymentGateway(gateway)) return { ok: false, status: 400, error: 'روش پرداخت نامعتبر است.' };
  const customer = normalizeCustomer(body?.customer);
  const problem = customerProblem(customer);
  if (problem) return { ok: false, status: 400, error: problem };
  const requested = Array.isArray(body?.items) ? body.items.slice(0, 100) : [];
  if (!requested.length) return { ok: false, status: 400, error: 'سبد خرید خالی است.' };

  const { items } = await showcase(deps, settings);
  const index = new Map(items.map(item => [item.id, item]));
  const lines: Array<{ item: ShowcaseItem; qty: number }> = [];
  for (const entry of requested) {
    const parsed = parseItemId(entry?.id);
    if (!parsed) continue;
    const item = index.get(itemId(parsed.profileId, parsed.sourceKey));
    if (item) lines.push({ item, qty: Number(entry?.qty) || 1 });
  }
  if (!lines.length) return { ok: false, status: 400, error: 'هیچ‌کدام از کالاهای سبد دیگر موجود نیستند.' };

  const totals = orderTotals(lines, settings);
  const order: Order = {
    id: newOrderId(),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    status: 'pending', gateway, customer,
    lines: totals.items.map(line => ({
      id: line.item.id, profileId: line.item.profileId, profileName: line.item.profileName, sourceKey: line.item.sourceKey,
      title: line.item.title, qty: line.qty, basePrice: line.item.basePrice, price: line.item.price, adjustment: line.item.adjustment
    })),
    subtotal: totals.subtotal, shipping: totals.shipping, tax: totals.tax, total: totals.total,
    currency: settings.currency, payment: {}
  };

  order.payment.source = choices.source;
  order.payment.gatewayTitle = chosen.title;

  if (choices.source === 'wordpress') {
    // The WordPress plugin does the payment: create the Woo order and hand the customer over.
    const client = await wooClient(deps);
    if (!client) return { ok: false, status: 503, error: 'اتصال ووکامرس تنظیم نشده است.' };
    const created = await createWooOrder(client, order, {
      gatewayTitle: chosen.title,
      productIdFor: line => (deps.destinationId ? deps.destinationId(line.profileId, line.sourceKey) : Promise.resolve(null))
    });
    if (!created.ok) {
      order.status = 'failed';
      order.payment.error = created.error;
      await saveOrder(deps, order);
      return { ok: false, status: 502, orderId: order.id, error: created.error };
    }
    order.payment.wooOrderId = created.wooOrderId;
    order.payment.payUrl = created.payUrl;
    order.status = 'pending';
    await saveOrder(deps, order);
    return { ok: true, status: 200, orderId: order.id, redirect: created.payUrl };
  }

  const callbackUrl = `${origin.replace(/\/+$/, '')}/api/shop/callback/${gateway}?order=${order.id}`;
  const started = await startPayment(gateway as PaymentGatewayId, { order, settings: payments, callbackUrl, card: settings.card, fetchImpl: deps.fetchImpl });
  if (!started.ok) {
    order.status = 'failed';
    order.payment.error = started.error;
    await saveOrder(deps, order);
    return { ok: false, status: 502, orderId: order.id, error: started.error };
  }
  order.payment.authority = started.authority;
  order.status = gateway === 'card' ? 'awaiting-receipt' : 'pending';
  await saveOrder(deps, order);
  return { ok: true, status: 200, orderId: order.id, redirect: started.redirect, instructions: started.instructions };
}

export async function handleCallback(deps: ShopDeps, gateway: string, query: Record<string, string>): Promise<{ status: number; location?: string; error?: string }> {
  if (!isPaymentGateway(gateway)) return { status: 400, error: 'درگاه نامعتبر است.' };
  const order = await getOrder(deps, query.order || '');
  if (!order) return { status: 404, error: 'سفارش پیدا نشد.' };
  if (order.status === 'paid') return { status: 302, location: `/order/${order.id}` };
  const { payments } = await loadShopConfig(deps);
  const result = await verifyPayment(gateway as PaymentGatewayId, { order, settings: payments, query, fetchImpl: deps.fetchImpl });
  order.status = (result.ok ? 'paid' : 'failed') as OrderStatus;
  if (result.ok) { order.payment.reference = result.reference; order.payment.paidAt = new Date().toISOString(); }
  else order.payment.error = result.error;
  await saveOrder(deps, order);
  return { status: 302, location: `/order/${order.id}` };
}

export async function submitReceipt(deps: ShopDeps, body: any): Promise<{ ok: boolean; status: number; error?: string }> {
  const order = await getOrder(deps, String(body?.orderId || ''));
  if (!order) return { ok: false, status: 404, error: 'سفارش پیدا نشد.' };
  if (order.gateway !== 'card') return { ok: false, status: 400, error: 'این سفارش کارت به کارت نیست.' };
  const reference = toEnglishDigits(body?.reference).trim().slice(0, 60) || String(body?.reference || '').trim().slice(0, 60);
  if (reference.length < 4) return { ok: false, status: 400, error: 'کد پیگیری واریز را وارد کنید.' };
  order.payment.reference = reference;
  order.status = 'review';
  await saveOrder(deps, order);
  return { ok: true, status: 200 };
}

/** WooCommerce owns "paid": re-read the Woo order whenever the customer looks at the page. */
export async function refreshWooOrder(deps: ShopDeps, order: Order): Promise<Order> {
  if (order.payment.source !== 'wordpress' || !order.payment.wooOrderId) return order;
  const client = await wooClient(deps);
  if (!client) return order;
  const status = await readWooOrder(client, order.payment.wooOrderId);
  if (!status.ok) return order;
  const next: OrderStatus = status.paid ? 'paid' : status.status === 'cancelled' ? 'canceled' : status.status === 'failed' ? 'failed' : 'pending';
  const changed = order.status !== next || order.payment.wooStatus !== status.status;
  order.payment.wooStatus = status.status;
  if (status.reference) order.payment.reference = status.reference;
  if (status.paid && !order.payment.paidAt) order.payment.paidAt = new Date().toISOString();
  order.status = next;
  if (changed) await saveOrder(deps, order);
  return order;
}

export async function orderPage(deps: ShopDeps, id: string): Promise<{ status: number; html?: string }> {
  const { settings } = await loadShopConfig(deps);
  let order = await getOrder(deps, id);
  if (!order) return { status: 404 };
  order = await refreshWooOrder(deps, order);
  const card = settings.card;
  const instructions = order.gateway === 'card' && card.number
    ? `مبلغ ${money(order.total)} ${settings.currency} را به کارت ${card.number.replace(/(\d{4})(?=\d)/g, '$1-')}${card.holder ? ` به نام ${card.holder}` : ''} واریز کنید.`
    : '';
  return { status: 200, html: orderHtml({ settings, order, instructions }) };
}

export async function listOrders(deps: ShopDeps, limit = 50): Promise<Order[]> {
  const index = await deps.getState<string[]>(SHOP_ORDER_INDEX_KEY, []);
  const out: Order[] = [];
  for (const id of index.slice(0, Math.max(1, Math.min(200, limit)))) {
    const order = await getOrder(deps, id);
    if (order) out.push(order);
  }
  return out;
}

/** Machine readable catalogue, same prices as the HTML page. */
export async function catalogueJson(deps: ShopDeps): Promise<{ ok: true; count: number; currency: string; items: ShowcaseItem[] }> {
  const { settings } = await loadShopConfig(deps);
  const { items } = await showcase(deps, settings);
  return { ok: true, count: items.length, currency: settings.currency, items };
}

function newOrderId(): string {
  const random = (globalThis.crypto as Crypto | undefined)?.randomUUID?.().replace(/-/g, '').slice(0, 6) ?? Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}-${random}`.toUpperCase();
}

export { adjustmentOf, showcaseItem };
