/**
 * Profile-driven synchronisation (۱.۳۴۲.۰).
 *
 * The two home-page options — «🛒 ووکامرس (افزودن، آپدیت، حذف بر پایهٔ پروفایل)»
 * and «🏪 باسلام (…)» — must be decided by the SAVED PROFILE, not by the
 * destination ledger:
 *
 *   • a product the extraction added to the profile  → send it to every chosen destination
 *   • the source price changed                        → the profile price is updated, then the destination price
 *   • the product is gone or unavailable at the source → remove it from the profile AND from the destinations
 *
 * The ledger stays what it always was: a cache that tells the sender «this exact
 * product is already there, don't write again». It no longer decides *whether* a
 * product exists for us — the profile does. This module is the pure part: it
 * takes the saved rows plus the destination list and returns the removal plan,
 * with the safety rails (complete scan, percentage cap, count cap) applied. No
 * database, no network: both runtimes call it with their own data access.
 */

/** One saved profile product, as `maintenanceRows()` returns it in both runtimes. */
export type ProfileSyncRow = {
  profile_id: string;
  source_key: string;
  title?: string;
  price?: number | null;
  active?: boolean | number;
  missing_since?: string | null;
  data?: any;
  remote_woo_id?: number | string | null;
  remote_basalam_id?: number | string | null;
  maps?: Array<{ target?: string; account_key?: string; remote_id?: number | string }>;
};

/** One destination: the WooCommerce shop, or a single Basalam stall. */
export type ProfileSyncAccount = { target: string; accountKey: string; name?: string };

export type GoneReason = '' | 'missing' | 'outOfStock' | 'noPrice';

export const GONE_LABELS: Record<Exclude<GoneReason, ''>, string> = {
  missing: 'در مبدأ دیده نشد',
  outOfStock: 'در مبدأ ناموجود شد',
  noPrice: 'قیمت مبدأ از بین رفت'
};

/**
 * Why this saved product should leave the profile.
 * `missing`    — a complete scan of the source no longer lists it (active=0).
 * `outOfStock` — still listed, but the source says zero stock.
 * `noPrice`    — still listed, but the source no longer publishes a price.
 */
export function goneFromSource(row: ProfileSyncRow): GoneReason {
  if (!row) return '';
  if (row.active === false || row.active === 0) return 'missing';
  const stock = Number(row.data?.stock ?? row.data?.stock_quantity ?? NaN);
  if (Number.isFinite(stock) && stock <= 0) return 'outOfStock';
  const price = Number(row.price ?? row.data?.price ?? 0);
  if (!(price > 0)) return 'noPrice';
  return '';
}

/** Remote id this saved row has at this destination (destination_map first, legacy columns second). */
export function remoteIdFor(row: ProfileSyncRow, account: ProfileSyncAccount): string {
  const mapped = (row.maps || []).find(map =>
    String(map.target || '') === String(account.target) && String(map.account_key || '') === String(account.accountKey));
  if (mapped && String(mapped.remote_id || '').trim() && String(mapped.remote_id) !== '0') return String(mapped.remote_id);
  const legacy = account.target === 'woo' ? row.remote_woo_id : row.remote_basalam_id;
  return legacy && String(legacy) !== '0' ? String(legacy) : '';
}

export type ProfileRemoval = {
  profileId: string;
  sourceKey: string;
  title: string;
  reason: Exclude<GoneReason, ''>;
  reasonLabel: string;
  /** Destinations this product was actually published to, and must be removed from. */
  targets: Array<{ target: string; accountKey: string; accountName: string; remoteId: string }>;
};

export type ProfileSyncPlan = {
  removals: ProfileRemoval[];
  /** '' when the plan may run; a Persian sentence when a safety rail stopped it. */
  blocked: string;
  stats: {
    rows: number;
    alive: number;
    gone: number;
    missing: number;
    outOfStock: number;
    noPrice: number;
    published: number;
    unpublished: number;
    percent: number;
  };
};

export type ProfileSyncOptions = {
  /** The last source scan of this profile finished and was trustworthy. */
  scanComplete?: boolean;
  /** Refuse to act when more than this share of the profile would disappear (default 30%). */
  maxPct?: number;
  /** …or when more than this many products would disappear in one run (default 50). */
  maxCount?: number;
  profileId?: string;
};

/**
 * The removal half of the profile-driven sync.
 *
 * Reading it out loud: «از محصولات ذخیره‌شدهٔ همین پروفایل، آن‌هایی که دیگر در
 * مبدأ نیستند (یا ناموجود/بی‌قیمت شده‌اند) باید از پروفایل و از همهٔ مقصدهایی که
 * به آن‌ها ارسال شده بود حذف شوند» — unless a safety rail says the scan cannot be
 * trusted, in which case nothing is removed and the reason is reported.
 */
export function planProfileRemovals(
  rows: ProfileSyncRow[],
  accounts: ProfileSyncAccount[],
  options: ProfileSyncOptions = {}
): ProfileSyncPlan {
  const profileId = String(options.profileId || '');
  const maxPct = Number.isFinite(Number(options.maxPct)) ? Number(options.maxPct) : 30;
  const maxCount = Number.isFinite(Number(options.maxCount)) ? Number(options.maxCount) : 50;
  const mine = (rows || []).filter(row => row && row.source_key && (!profileId || String(row.profile_id) === profileId));

  const removals: ProfileRemoval[] = [];
  const stats = { rows: mine.length, alive: 0, gone: 0, missing: 0, outOfStock: 0, noPrice: 0, published: 0, unpublished: 0, percent: 0 };
  for (const row of mine) {
    const reason = goneFromSource(row);
    if (!reason) { stats.alive++; continue; }
    stats.gone++; stats[reason]++;
    const targets = (accounts || [])
      .map(account => ({
        target: String(account.target), accountKey: String(account.accountKey),
        accountName: String(account.name || (account.target === 'woo' ? 'ووکامرس' : 'باسلام')),
        remoteId: remoteIdFor(row, account)
      }))
      .filter(entry => entry.remoteId);
    if (targets.length) stats.published++; else stats.unpublished++;
    removals.push({
      profileId: String(row.profile_id || ''), sourceKey: String(row.source_key),
      title: String(row.title || row.data?.title || ''), reason, reasonLabel: GONE_LABELS[reason], targets
    });
  }
  stats.percent = stats.rows ? Math.round((stats.gone / stats.rows) * 100) : 0;

  let blocked = '';
  if (!options.scanComplete) blocked = 'آخرین اسکن مبدأ کامل و قابل‌اعتماد نبود؛ برای ایمنی هیچ محصولی از پروفایل یا مقصدها حذف نشد.';
  else if (!stats.gone) blocked = '';
  else if (stats.gone > maxCount) blocked = 'تعداد محصولات رفته از مبدأ (' + stats.gone + ') از سقف ایمنی (' + maxCount + ') بیشتر است؛ حذف انجام نشد تا خودتان بررسی کنید.';
  else if (stats.percent > maxPct) blocked = 'سهم محصولات رفته از مبدأ (' + stats.percent + '٪) از سقف ایمنی (' + maxPct + '٪) بیشتر است؛ حذف انجام نشد تا خودتان بررسی کنید.';

  return { removals: blocked ? [] : removals, blocked, stats };
}
