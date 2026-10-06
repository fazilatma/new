/**
 * One list of Basalam stalls («غرفه‌ها») for the whole app.
 *
 * A stall could be registered in the connections panel and then quietly do nothing: the sender
 * only accepted stalls that carried their own token (`shops.filter(s => s.token && s.vendorId)`),
 * and anything it rejected simply vanished from the result list — no row, no reason, no send.
 * The product modal, meanwhile, built its own list from a slightly different rule, so the panel
 * could show a stall the sender was never going to use.
 *
 * This module is the single source of truth for both questions:
 *   «کدام غرفه‌ها وجود دارند؟»  and  «به کدام‌ها واقعاً می‌شود فرستاد و چرا نه؟»
 *
 * Every configured stall is returned, in a stable order, each one either `ready` or carrying a
 * Persian `reason`. Nothing is ever dropped silently.
 */

export type BasalamStallInput = {
  token?: string;
  vendorId?: string | number;
  pricePercent?: number | string;
  shops?: Array<{ name?: string; token?: string; vendorId?: string | number; pricePercent?: number | string } | null | undefined> | null;
};

export type BasalamStall = {
  /** The key used in `destination_map` — the stall's own vendor id. */
  key: string;
  name: string;
  vendorId: string;
  token: string;
  pricePercent: number;
  isDefault: boolean;
  /** Where the token came from: its own field, or the default account as a fallback. */
  tokenSource: 'own' | 'default' | 'none';
  /** Can this stall actually receive a product right now? */
  ready: boolean;
  /** Why not, in the user's own language. Empty when ready. */
  reason: string;
};

export const DEFAULT_STALL_NAME = 'پیش‌فرض';

const text = (value: unknown) => String(value ?? '').trim();
const percent = (value: unknown) => Number(value) || 0;

/**
 * Builds the stall list from the Basalam connection vault.
 *
 * Rules, in order:
 *  - the default account comes first when it has a vendor id;
 *  - every registered stall follows, in the order the user added it;
 *  - a stall with no token of its own borrows the default account's token (`tokenSource`
 *    says so), because that is almost always what «غرفهٔ همین حساب» means — and if Basalam
 *    disagrees, the send loop reports the exact answer instead of us guessing silently;
 *  - a stall that repeats a vendor id already in the list is kept but marked, so the same
 *    product is never sent twice to the same stall.
 */
export function basalamStalls(basalam: BasalamStallInput | null | undefined): BasalamStall[] {
  const vault = basalam || {};
  const defaultToken = text(vault.token);
  const defaultVendor = text(vault.vendorId);
  const out: BasalamStall[] = [];
  const seen = new Set<string>();

  const push = (stall: Omit<BasalamStall, 'ready' | 'reason' | 'tokenSource' | 'token'> & { ownToken: string }) => {
    const tokenSource: BasalamStall['tokenSource'] = stall.ownToken ? 'own' : (defaultToken ? 'default' : 'none');
    const token = stall.ownToken || (tokenSource === 'default' ? defaultToken : '');
    let reason = '';
    if (!stall.vendorId) reason = 'شناسهٔ غرفه (Vendor ID) وارد نشده است.';
    else if (!token) reason = 'توکن این غرفه وارد نشده و توکن پیش‌فرضی هم برای جایگزینی وجود ندارد.';
    else if (seen.has(stall.vendorId)) reason = 'این شناسهٔ غرفه تکراری است و قبلاً در فهرست آمده؛ برای جلوگیری از ارسال دوباره نادیده گرفته می‌شود.';
    if (stall.vendorId && !reason) seen.add(stall.vendorId);
    const { ownToken, ...rest } = stall;
    out.push({ ...rest, token, tokenSource, ready: !reason, reason });
  };

  if (defaultVendor || defaultToken)
    push({ key: defaultVendor, name: DEFAULT_STALL_NAME, vendorId: defaultVendor, ownToken: defaultToken, pricePercent: percent(vault.pricePercent), isDefault: true });
  for (const [index, shop] of (Array.isArray(vault.shops) ? vault.shops : []).entries()) {
    if (!shop) continue;
    const vendorId = text(shop.vendorId);
    push({
      key: vendorId || 'shop-' + (index + 1),
      name: text(shop.name) || (vendorId ? 'غرفهٔ ' + vendorId : 'غرفهٔ ' + (index + 1)),
      vendorId, ownToken: text(shop.token), pricePercent: percent(shop.pricePercent), isDefault: false
    });
  }
  return out;
}

/** The stalls a send is actually allowed to use. */
export function sendableStalls(stalls: BasalamStall[]): BasalamStall[] {
  return stalls.filter(stall => stall.ready);
}

/** One sentence explaining why a send found nothing to write to. */
export function noStallReason(stalls: BasalamStall[]): string {
  if (!stalls.length) return 'هیچ غرفه‌ای برای باسلام ثبت نشده است؛ در «اتصال‌ها» توکن و شناسهٔ غرفه را وارد کنید.';
  return 'هیچ‌کدام از غرفه‌های ثبت‌شده آمادهٔ ارسال نیستند: '
    + stalls.map(stall => `${stall.name} (${stall.reason})`).join(' | ');
}

/** One row of «قیمت نهایی در همهٔ مقصدها» — what the product modal lists. */
export type DestinationRow = {
  target: 'woo' | 'basalam';
  key: string;
  name: string;
  /** Ready-to-print label, so both runtimes and the panel say the same thing. */
  label: string;
  percent: number;
  /** Basalam is priced in Rial, WooCommerce in Toman. */
  toRial: boolean;
  ready: boolean;
  reason: string;
  isDefault: boolean;
  remoteId: string | number | null;
};

/**
 * The destination list for one product: WooCommerce plus every Basalam stall, each with the
 * remote id it already has (if any). The panel calls this through `/api/products/:profileId/
 * :sourceKey/destinations`, so a stall registered one second ago shows up without a reload —
 * and a stall that cannot be sent to says why, right in the row.
 */
export async function destinationRows(
  vault: any,
  remoteId: (target: 'woo' | 'basalam', key: string) => Promise<string | number | null>
): Promise<DestinationRow[]> {
  const rows: DestinationRow[] = [];
  const woo = vault?.woo || {};
  const wooReady = Boolean(text(woo.url) && text(woo.key) && text(woo.secret));
  rows.push({
    target: 'woo', key: 'default', name: 'ووکامرس', label: 'ووکامرس',
    percent: percent(woo.pricePercent), toRial: false, ready: wooReady,
    reason: wooReady ? '' : 'آدرس فروشگاه یا کلیدهای ووکامرس کامل نیست.',
    isDefault: true, remoteId: wooReady ? await remoteId('woo', 'default') : null
  });
  for (const stall of basalamStalls(vault?.basalam)) {
    rows.push({
      target: 'basalam', key: stall.key, name: stall.name,
      label: 'باسلام — ' + (stall.isDefault ? 'غرفهٔ پیش‌فرض' : stall.name),
      percent: stall.pricePercent, toRial: true, ready: stall.ready, reason: stall.reason,
      isDefault: stall.isDefault, remoteId: stall.vendorId ? await remoteId('basalam', stall.key) : null
    });
  }
  return rows;
}
