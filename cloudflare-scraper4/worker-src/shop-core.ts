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
  shortDesc?: string; longDesc?: string; sku?: string; brand?: string; stock?: number; category?: string; tags?: string;
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
  /** Typography taken from the scraper panel's appearance settings (same self hosted fonts). */
  appearance: ShopAppearance;
  /** Root address the storefront is mounted on ("/" by default). Every link is built from it. */
  basePath: string;
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

export type ShopAppearance = { font: string; family: string; stylesheet: string; scale: number; theme: string; palette: ShopPalette };

/** The storefront half of a panel palette: the CSS custom properties the shop styles read. */
export type ShopPalette = {
  bg: string; bg2: string; card: string; line: string; line2: string;
  text: string; muted: string; brand: string; brandInk: string; accent: string;
  glow: string; glow2: string;
};

/** The same font list the scraper dashboard offers, served from the same /assets/fonts route. */
export const SITE_FONTS: Record<string, { family: string; stylesheet: string }> = {
  system: { family: 'Tahoma,system-ui,sans-serif', stylesheet: '' },
  vazir: { family: 'Vazir,Tahoma,sans-serif', stylesheet: 'vazir' },
  vazirmatn: { family: 'Vazirmatn,Vazir,Tahoma,system-ui,sans-serif', stylesheet: 'vazirmatn' },
  yekan: { family: 'Yekan,Tahoma,sans-serif', stylesheet: 'yekan' },
  shabnam: { family: 'Shabnam,Tahoma,sans-serif', stylesheet: 'shabnam' },
  sahel: { family: 'Sahel,Tahoma,sans-serif', stylesheet: 'sahel' },
  samim: { family: 'Samim,Tahoma,sans-serif', stylesheet: 'samim' }
};

/** Identical steps to the panel's applySiteFontSize map, so both surfaces read the same size. */
const FONT_SCALES: Record<string, number> = { small: 12, medium: 14, large: 16, xlarge: 18 };

/**
 * The twelve palettes of the panel ("رنگ‌بندی کل سایت"), in the panel's own order:
 * page, surface, card, input, line, accent, accent2, text, muted, glow, glow2.
 */
export const SITE_THEMES: Record<string, string[]> = {
  midnight: ['#03070d','#0c1628','#142136','#0b1424','#536078','#2f8df5','#16bdd3','#edf2f9','#a6afc0','#17345e55','#312e8144'],
  ocean: ['#03111d','#08233a','#0d3150','#061a2c','#295d7a','#0284c7','#22d3ee','#e6f7ff','#91b8ca','#0284c755','#06b6d433'],
  aurora: ['#03110f','#082720','#103a30','#061c18','#2b6b58','#10b981','#5eead4','#e8fff8','#91c7b8','#10b98144','#84cc1633'],
  royal: ['#0b0618','#21123b','#322052','#150d29','#655087','#8b5cf6','#d946ef','#f5efff','#b8a6d1','#8b5cf655','#d946ef33'],
  sunset: ['#170904','#35160e','#512417','#251008','#81513b','#f97316','#fbbf24','#fff4e8','#d4ae97','#f973164d','#ef444433'],
  rose: ['#16070f','#351326','#501d38','#260d1b','#80455f','#ec4899','#fb7185','#fff0f6','#d0a4b8','#ec48994d','#a855f733'],
  cobalt: ['#03091c','#0a1a43','#102762','#071333','#385b9a','#2563eb','#38bdf8','#edf5ff','#9db4dc','#2563eb55','#06b6d433'],
  forest: ['#04100a','#0b2518','#133a26','#071c12','#37654b','#16a34a','#a3e635','#f0fff4','#9fc4aa','#16a34a44','#84cc1633'],
  graphite: ['#090b0f','#191d24','#252b34','#11151b','#596273','#94a3b8','#e2e8f0','#f8fafc','#aab1bd','#64748b44','#cbd5e122'],
  coffee: ['#130b06','#2b1a10','#43291a','#20130c','#74543d','#d97706','#facc15','#fff7ed','#cbb09a','#d9770644','#92400e44'],
  persian: ['#050b19','#0c1f3b','#12345c','#08172c','#315f8c','#0ea5e9','#2dd4bf','#effaff','#9fbcd1','#0ea5e94d','#14b8a633'],
  cyber: ['#02040b','#0b1022','#151b35','#070b18','#414b75','#22d3ee','#e879f9','#f3fbff','#a3acd0','#22d3ee44','#e879f933']
};

/** Readable ink on a coloured button: dark text on light accents, white on dark ones. */
function inkFor(hex: string): string {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16) / 255 || 0);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  // 0.3 keeps mid tone accents (cyan, lime, silver, amber) readable with dark ink.
  return luminance > 0.3 ? '#07131f' : '#ffffff';
}

export function paletteOf(theme: string): ShopPalette {
  const key = SITE_THEMES[theme] ? theme : 'midnight';
  const t = SITE_THEMES[key]!;
  return {
    bg: t[0]!, bg2: t[3]!, card: t[2]!, line: t[4]!, line2: t[9]!,
    text: t[7]!, muted: t[8]!, brand: t[5]!, brandInk: inkFor(t[5]!), accent: t[6]!,
    glow: t[9]!, glow2: t[10]!
  };
}

export const DEFAULT_APPEARANCE: ShopAppearance = {
  font: 'vazir', family: SITE_FONTS.vazir.family, stylesheet: 'vazir', scale: 14,
  theme: 'midnight', palette: paletteOf('midnight')
};

/** Reads the dashboard's `appearance.*` settings so the shop uses the panel's own typography. */
export function resolveAppearance(raw: unknown): ShopAppearance {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const block = (input.appearance && typeof input.appearance === 'object' ? input.appearance : input) as Record<string, any>;
  const key = String(block.font ?? '').toLowerCase();
  const font = SITE_FONTS[key] ? key : DEFAULT_APPEARANCE.font;
  const scale = FONT_SCALES[String(block.fontSize ?? '').toLowerCase()] || DEFAULT_APPEARANCE.scale;
  const themeKey = String(block.theme ?? '').toLowerCase();
  const theme = SITE_THEMES[themeKey] ? themeKey : DEFAULT_APPEARANCE.theme;
  return { font, family: SITE_FONTS[font].family, stylesheet: SITE_FONTS[font].stylesheet, scale, theme, palette: paletteOf(theme) };
}

export const DEFAULT_SHOP_SETTINGS: ShopSettings = {
  enabled: true,
  name: 'ویترین فروشگاه',
  tagline: 'محصولات به‌روز با قیمت‌گذاری خودکار',
  scraperPath: 'scraper',
  basePath: '/',
  appearance: DEFAULT_APPEARANCE,
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
    basePath: normalizeBasePath(input.basePath),
    appearance: resolveAppearance(input.appearance ? { appearance: input.appearance } : {}),
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

/**
 * The storefront root. Links are always built from it and never go one level deeper than
 * the root: pages are selected with query parameters (`?view=`, `?product=`, `?order=`).
 */
export function normalizeBasePath(raw: unknown): string {
  const cleaned = String(raw ?? '').trim().replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9/_-]/gi, '').slice(0, 60);
  return cleaned ? `/${cleaned}/` : '/';
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
/** Customers type Persian/Arabic digits; every validator and gateway needs ASCII ones. */
export function toEnglishDigits(value: unknown): string {
  return String(value ?? '')
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));
}
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
    brand: product.brand, category: categoryOf(product), stock: product.stock,
    shortDesc: String(product.shortDesc || '').slice(0, 300),
    sourceUrl: product.url,
    adjustment
  };
}

export const UNCATEGORISED = 'دسته‌بندی‌نشده';

/**
 * Customer facing grouping is by PRODUCT CATEGORY, never by the internal profile name.
 * Scraped categories arrive as "خانه > آشپزخانه > کتری" or "Kitchen/Kettles": keep the most
 * specific segment, which is what a shopper actually browses by.
 */
export function categoryOf(product: { category?: string; tags?: string; brand?: string }): string {
  const raw = String(product.category || '').replace(/\s+/g, ' ').trim();
  if (raw) {
    const parts = raw.split(/\s*(?:>|،|\||\/|»|<)\s*/).map(part => part.trim()).filter(Boolean);
    const picked = parts.length ? parts[parts.length - 1] : raw;
    if (picked.length > 1) return picked.slice(0, 60);
  }
  const tag = String(product.tags || '').split(/[,،|\n]/).map(part => part.trim()).find(part => part.length > 1);
  if (tag) return tag.slice(0, 60);
  return UNCATEGORISED;
}

export function categorySlug(name: string): string {
  return String(name || '').trim().slice(0, 60);
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
    name: String(input.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120),
    phone: toEnglishDigits(input.phone).replace(/[^\d+]/g, '').replace(/^\+98/, '0').replace(/^98(?=9)/, '0').slice(0, 20),
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
