/**
 * Storefront core — runtime free so the Cloudflare Worker and the Node/Render twin
 * share one implementation (AGENTS.md twin parity).
 *
 * The shop NEVER invents prices. Every showcased price is the scraped base price with
 * the owning profile's adjustment coefficients (priceMode/priceValue/roundPrice/minPrice)
 * applied through the same applyResultAdjustments() the scraper and the destinations use,
 * so the storefront, the results tab and WooCommerce/Basalam can never disagree.
 */
import { applyResultAdjustments } from './result-adjustments.js';

export type ShopProfile = {
  id: string; name: string;
  titleSuffix?: string; priceMode?: string; priceValue?: number; roundPrice?: number; minPrice?: number;
};
export type ShopProduct = {
  sourceKey: string; title: string; price: number; priceText?: string;
  url?: string; image?: string; images?: string[];
  shortDesc?: string; longDesc?: string; sku?: string; brand?: string; stock?: number; category?: string;
  resultBase?: { title: string; price: number; priceText: string };
};

export type Adjustment = {
  mode: string; value: number; round: number; minPrice: number;
  /** Persian, user facing, e.g. "ضریب ۱٫۵ · گرد به ۱٬۰۰۰ تومان". */
  label: string;
  /** final / base, rounded to 4 decimals. 1 when the profile does not adjust anything. */
  factor: number;
};

export type ShowcaseItem = {
  profileId: string; profileName: string;
  sourceKey: string; id: string;
  title: string; basePrice: number; price: number; priceText: string;
  image: string; brand?: string; category?: string; stock?: number;
  shortDesc?: string; sourceUrl?: string;
  adjustment: Adjustment;
};

export const SHOP_SETTINGS_KEY = 'shop.settings';
export const SHOP_ORDER_INDEX_KEY = 'shop.orders';
export const orderStateKey = (id: string) => `shop.order.${id}`;

export type ShopSettings = {
  enabled: boolean;
  name: string;
  tagline: string;
  /** Folder the scraper dashboard is mounted under; the shop always owns "/". */
  scraperPath: string;
  /**
   * 'wordpress' = checkout is handed to the connected WooCommerce site, so the gateway PLUGINS
   * installed in WordPress (زرین‌پال، ترب‌پی، دیجی‌پی، کارت به کارت، …) do the payment.
   * 'builtin' = the direct gateway adapters in payments.ts (used when no Woo site is connected).
   */
  gatewaySource: 'wordpress' | 'builtin';
  currency: 'تومان' | 'ریال';
  shippingCost: number;
  freeShippingFrom: number;
  taxPercent: number;
  /** Empty = every profile with products is showcased. */
  profileIds: string[];
  contactPhone: string;
  card: { number: string; holder: string; bank: string };
};

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  enabled: true,
  name: 'ویترین فروشگاه',
  tagline: 'محصولات به‌روز، با قیمت‌گذاری خودکار هر پروفایل',
  scraperPath: 'scraper',
  gatewaySource: 'wordpress',
  currency: 'تومان',
  shippingCost: 0,
  freeShippingFrom: 0,
  taxPercent: 0,
  profileIds: [],
  contactPhone: '',
  card: { number: '', holder: '', bank: '' }
};

export function normalizeShopSettings(raw: unknown): ShopSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const card = (input.card && typeof input.card === 'object' ? input.card : {}) as Record<string, any>;
  const number = String(card.number ?? '').replace(/[^\d]/g, '').slice(0, 19);
  return {
    enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    name: String(input.name ?? DEFAULT_SHOP_SETTINGS.name).slice(0, 120) || DEFAULT_SHOP_SETTINGS.name,
    tagline: String(input.tagline ?? DEFAULT_SHOP_SETTINGS.tagline).slice(0, 200),
    scraperPath: normalizeScraperPath(input.scraperPath),
    gatewaySource: input.gatewaySource === 'builtin' ? 'builtin' : 'wordpress',
    currency: input.currency === 'ریال' ? 'ریال' : 'تومان',
    shippingCost: positive(input.shippingCost),
    freeShippingFrom: positive(input.freeShippingFrom),
    taxPercent: Math.max(0, Math.min(100, Number(input.taxPercent) || 0)),
    profileIds: Array.isArray(input.profileIds) ? input.profileIds.map((id: any) => String(id)).filter(Boolean) : [],
    contactPhone: String(input.contactPhone ?? '').slice(0, 40),
    card: { number, holder: String(card.holder ?? '').slice(0, 80), bank: String(card.bank ?? '').slice(0, 60) }
  };
}

/** The scraper lives in a FOLDER, the shop owns the root. Never let it collapse back to "/". */
export function normalizeScraperPath(raw: unknown): string {
  const cleaned = String(raw ?? '').trim().replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9/_-]/gi, '').slice(0, 40);
  return cleaned || DEFAULT_SHOP_SETTINGS.scraperPath;
}

function positive(value: unknown): number {
  const number = Math.round(Number(value) || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export function fa(value: number | string): string {
  return String(value).replace(/\d/g, d => FA_DIGITS[Number(d)]);
}
export function money(value: number): string {
  return fa(Math.round(Number(value) || 0).toLocaleString('en-US').replace(/,/g, '٬'));
}

export function adjustmentOf(profile: ShopProfile): Adjustment {
  const mode = String(profile.priceMode || 'none');
  const value = Number(profile.priceValue) || 0;
  const round = Number(profile.roundPrice) || 0;
  const minPrice = Number(profile.minPrice) || 0;
  const parts: string[] = [];
  if (mode === 'add' && value) parts.push((value > 0 ? '+' : '−') + money(Math.abs(value)) + ' مبلغ ثابت');
  if (mode === 'percent' && value) parts.push((value > 0 ? '+' : '−') + fa(Math.abs(value)) + '٪');
  if (mode === 'multiply' && value) parts.push('ضریب ' + fa(String(value).replace('.', '٫')));
  if (round > 0) parts.push('گرد به ' + money(round));
  if (minPrice > 0) parts.push('حداقل ' + money(minPrice));
  return { mode, value, round, minPrice, label: parts.join(' · ') || 'بدون تعدیل', factor: 1 };
}

/** Base price = the untouched scraped price, kept in resultBase by the scraper. */
export function basePriceOf(product: ShopProduct): number {
  const base = Number(product.resultBase?.price);
  return Number.isFinite(base) && base > 0 ? base : Math.max(0, Number(product.price) || 0);
}

/** Apply the profile coefficients exactly like the pipeline does, then the price floor. */
export function showcaseItem(product: ShopProduct, profile: ShopProfile): ShowcaseItem {
  const adjustment = adjustmentOf(profile);
  const base = basePriceOf(product);
  const clone = JSON.parse(JSON.stringify({ ...product, price: base, priceText: product.priceText || '', resultBase: undefined }));
  applyResultAdjustments(clone, {
    titleSuffix: String(profile.titleSuffix || ''),
    priceMode: adjustment.mode,
    priceValue: adjustment.value,
    roundPrice: adjustment.round
  });
  let price = Math.max(0, Math.round(Number(clone.price) || 0));
  if (adjustment.minPrice > 0 && price > 0 && price < adjustment.minPrice) price = adjustment.minPrice;
  adjustment.factor = base > 0 ? Math.round((price / base) * 10000) / 10000 : 1;
  const images = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  return {
    profileId: profile.id, profileName: profile.name,
    sourceKey: product.sourceKey, id: itemId(profile.id, product.sourceKey),
    title: String(clone.title || product.title || '').trim(),
    basePrice: base, price, priceText: money(price),
    image: String(product.image || images[0] || ''),
    brand: product.brand, category: product.category, stock: product.stock,
    shortDesc: String(product.shortDesc || '').slice(0, 300),
    sourceUrl: product.url,
    adjustment
  };
}

export function itemId(profileId: string, sourceKey: string): string {
  return `${profileId}::${sourceKey}`;
}
export function parseItemId(raw: unknown): { profileId: string; sourceKey: string } | null {
  const text = String(raw ?? '');
  const at = text.indexOf('::');
  if (at <= 0 || at === text.length - 2) return null;
  return { profileId: text.slice(0, at), sourceKey: text.slice(at + 2) };
}

export type CartLine = { item: ShowcaseItem; qty: number; lineTotal: number };
export type OrderTotals = { items: CartLine[]; subtotal: number; shipping: number; tax: number; total: number; count: number };

/** Server side totals. The browser only ever sends ids and quantities. */
export function orderTotals(lines: Array<{ item: ShowcaseItem; qty: number }>, settings: ShopSettings): OrderTotals {
  const items: CartLine[] = lines
    .map(line => ({ item: line.item, qty: Math.max(1, Math.min(999, Math.round(Number(line.qty) || 1))) }))
    .map(line => ({ ...line, lineTotal: line.item.price * line.qty }));
  const subtotal = items.reduce((sum, line) => sum + line.lineTotal, 0);
  const freeFrom = settings.freeShippingFrom;
  const shipping = subtotal > 0 && (freeFrom <= 0 || subtotal < freeFrom) ? settings.shippingCost : 0;
  const tax = Math.round((subtotal * (Number(settings.taxPercent) || 0)) / 100);
  return { items, subtotal, shipping, tax, total: subtotal + shipping + tax, count: items.reduce((n, l) => n + l.qty, 0) };
}

export type OrderCustomer = { name: string; phone: string; address: string; note?: string };
export function normalizeCustomer(raw: unknown): OrderCustomer {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  return {
    name: String(input.name ?? '').trim().slice(0, 120),
    phone: String(input.phone ?? '').replace(/[^\d+]/g, '').slice(0, 20),
    address: String(input.address ?? '').trim().slice(0, 500),
    note: String(input.note ?? '').trim().slice(0, 500)
  };
}
export function customerProblem(customer: OrderCustomer): string {
  if (customer.name.length < 3) return 'نام و نام خانوادگی را کامل وارد کنید.';
  if (!/^(\+98|0)?9\d{9}$/.test(customer.phone)) return 'شمارهٔ موبایل معتبر نیست.';
  if (customer.address.length < 10) return 'نشانی تحویل را کامل‌تر بنویسید.';
  return '';
}

export type OrderStatus = 'pending' | 'awaiting-receipt' | 'review' | 'paid' | 'failed' | 'canceled';
export type Order = {
  id: string; createdAt: string; updatedAt: string;
  status: OrderStatus;
  gateway: string;
  customer: OrderCustomer;
  lines: Array<{ id: string; profileId: string; profileName: string; sourceKey: string; title: string; qty: number; basePrice: number; price: number; adjustment: Adjustment }>;
  subtotal: number; shipping: number; tax: number; total: number; currency: string;
  payment: {
    authority?: string; reference?: string; ticket?: string; trackingCode?: string; paidAt?: string; error?: string;
    /** WordPress/WooCommerce delegation: the Woo order is the source of truth for "paid". */
    source?: 'wordpress' | 'builtin'; wooOrderId?: number; payUrl?: string; wooStatus?: string; gatewayTitle?: string;
  };
};

export function orderNumber(id: string): string {
  return fa(id.replace(/[^0-9]/g, '').slice(0, 10) || id);
}
