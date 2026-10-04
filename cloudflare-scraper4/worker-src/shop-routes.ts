/**
 * Storefront request handlers, shared by the Cloudflare Worker and the Node/Render twin.
 * Pure data in / data out: the twins only translate Hono context <-> these plain objects.
 */
import {
  DEFAULT_SHOP_SETTINGS, SHOP_ORDER_INDEX_KEY, SHOP_SETTINGS_KEY, adjustmentOf, basePriceOf,
  customerProblem, itemId, money, normalizeCustomer, normalizeShopSettings, orderStateKey, orderTotals,
  parseItemId, showcaseItem,
  type Order, type OrderStatus, type ShopProduct, type ShopProfile, type ShopSettings, type ShowcaseItem
} from './shop-core.js';
import {
  PAYMENT_SETTINGS_KEY, availableGateways, isPaymentGateway, normalizePaymentSettings, startPayment, verifyPayment,
  type Fetcher, type PaymentGatewayId, type PaymentSettings
} from './payments.js';
import { catalogueHtml, checkoutHtml, orderHtml, shopAdminHtml } from './shop.js';

export type ShopDeps = {
  listProfiles: () => Promise<ShopProfile[]>;
  allProducts: (profileId: string) => Promise<ShopProduct[]>;
  getState: <T>(key: string, fallback: T) => Promise<T>;
  setState: (key: string, value: unknown) => Promise<void>;
  fetchImpl?: Fetcher;
};

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

export async function cataloguePage(deps: ShopDeps, query: { q?: string; profile?: string; page?: string }): Promise<string> {
  const { settings } = await loadShopConfig(deps);
  const { items, profiles } = await showcase(deps, settings);
  const q = String(query.q ?? '').trim().slice(0, 80);
  const profileId = String(query.profile ?? '').trim();
  const needle = q.toLowerCase();
  const filtered = items.filter(item =>
    (!profileId || item.profileId === profileId) &&
    (!needle || item.title.toLowerCase().includes(needle) || String(item.brand || '').toLowerCase().includes(needle)));
  const page = Math.max(1, Math.min(999, Math.round(Number(query.page) || 1)));
  const slice = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  return catalogueHtml({ settings, items: slice, profiles, query: { q, profileId, page }, total: filtered.length, perPage: PER_PAGE });
}

export async function checkoutPage(deps: ShopDeps): Promise<string> {
  const { settings, payments } = await loadShopConfig(deps);
  return checkoutHtml({ settings, gateways: availableGateways(payments, settings.card.number) });
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
  const gateway = String(body?.gateway || '');
  if (!isPaymentGateway(gateway)) return { ok: false, status: 400, error: 'روش پرداخت نامعتبر است.' };
  if (!availableGateways(payments, settings.card.number).some(plugin => plugin.id === gateway))
    return { ok: false, status: 400, error: 'این روش پرداخت فعال یا کامل تنظیم نشده است.' };
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

  const callbackUrl = `${origin.replace(/\/+$/, '')}/api/shop/callback/${gateway}?order=${order.id}`;
  const started = await startPayment(gateway, { order, settings: payments, callbackUrl, card: settings.card, fetchImpl: deps.fetchImpl });
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
  const reference = String(body?.reference || '').trim().slice(0, 60);
  if (reference.length < 4) return { ok: false, status: 400, error: 'کد پیگیری واریز را وارد کنید.' };
  order.payment.reference = reference;
  order.status = 'review';
  await saveOrder(deps, order);
  return { ok: true, status: 200 };
}

export async function orderPage(deps: ShopDeps, id: string): Promise<{ status: number; html?: string }> {
  const { settings } = await loadShopConfig(deps);
  const order = await getOrder(deps, id);
  if (!order) return { status: 404 };
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
