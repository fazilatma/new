import { normalizePersianText } from './utils.js';
import { hasCodeSuffix, parseSuffixFormats, stripCodeSuffix, suffixPatterns } from './dedup.js';

/**
 * Unified reconciliation ("مغایرت‌گیری یکپارچه") across every destination.
 *
 * The previous table compared ONE destination at a time, and the Node runtime
 * re-exported the Cloudflare implementation, so pressing the button on a Node /
 * Termux / VPS install failed with "D1 binding DB is not configured": the shared
 * code reached straight into the Worker's D1 helpers.
 *
 * This module holds the comparison logic only. Both runtimes pass in their own
 * data access (`ReconDeps`), so there is exactly one algorithm and no runtime
 * can drag the other's database driver along with it.
 *
 * What it compares, per source product and per destination account:
 *   - existence   : the product is in the source but missing at the destination
 *                   (or exists at the destination but in no profile at all)
 *   - price       : compared AFTER the per-destination adjustment, because a
 *                   Basalam stall with +10% is correct at 110%, not "different".
 *
 * Buckets, one per (product, destination) pair:
 *   matched   - present at both ends, adjusted price agrees
 *   priceDiff - present at both ends, adjusted price differs
 *   missing   - in the source, not at the destination
 *   extra     - at the destination, in no profile/source
 *   noPrice   - matched, but the source has no usable price to compare
 */

export type ReconBucket = 'matched' | 'priceDiff' | 'missing' | 'extra' | 'noPrice';
export type MatchedBy = 'id' | 'sku' | 'title' | 'none';

/** One destination account: the WooCommerce site, or a single Basalam stall. */
export type ReconAccount = {
  /** 'woo' or 'basalam' */
  target: 'woo' | 'basalam';
  /** Stable key used by destination_map (vendorId for Basalam, 'default' for Woo). */
  accountKey: string;
  /** Human readable name shown in the table. */
  name: string;
  /** Price adjustment applied when publishing to this account, in percent. */
  pricePercent: number;
  /** Basalam prices are stored in Rial when the source is in Toman. */
  toRial?: boolean;
};

export type ReconRemote = {
  id: number;
  name: string;
  sku?: string;
  price: number;
  status?: string;
  shopId?: string;
  shopName?: string;
};

export type ReconLocal = {
  profile_id: string;
  source_key: string;
  title: string;
  price: number;
  active?: boolean | number;
  data?: any;
  remote_woo_id?: number | null;
  remote_basalam_id?: number | null;
  maps?: Array<{ target?: string; account_key?: string; remote_id?: number }>;
};

export type UnifiedReconRow = {
  bucket: ReconBucket;
  target: 'woo' | 'basalam';
  accountKey: string;
  accountName: string;
  profileId: string;
  profileName: string;
  sourceKey: string;
  title: string;
  remoteTitle: string;
  remoteId: number | null;
  /** Raw source price, as scraped. */
  sourcePrice: number | null;
  /** Source price after this destination's adjustment: what SHOULD be published. */
  expectedPrice: number | null;
  /** What the destination actually has. */
  remotePrice: number | null;
  /** remotePrice - expectedPrice */
  delta: number | null;
  pricePercent: number;
  matchedBy: MatchedBy;
  status: string;
  why: string;
  /** How many source products share this title once the code suffix is removed. */
  duplicateCount: number;
};

/** Title key for reconciliation: Persian-normalized and stripped of a trailing product code. */
export function reconNormTitle(value: string): string {
  return normalizePersianText(value)
    .replace(/\s*[\[(](?:کد|code|sku)?\s*[:：]?\s*[\d]+[\])]\s*$/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const asPrice = (value: unknown): number | null => { const n = Math.round(Number(value) || 0); return n > 0 ? n : null; };

/**
 * Price the source product SHOULD have at this destination, applying the same
 * adjustment the sync path applies. Keeping this in one place is what stops the
 * table from reporting a correctly-marked-up stall as a mismatch.
 */
export function expectedPriceFor(sourcePrice: number | null, account: ReconAccount): number | null {
  if (sourcePrice === null || !(sourcePrice > 0)) return null;
  const adjusted = Math.round(sourcePrice * (1 + (Number(account.pricePercent) || 0) / 100));
  return account.toRial ? adjusted * 10 : adjusted;
}

/** Stored remote id for this source row at this specific destination account. */
export function mappedRemoteId(row: ReconLocal, account: ReconAccount): number {
  const fromMap = (row.maps || []).find(m => String(m.target || '') === account.target && String(m.account_key || '') === account.accountKey);
  if (fromMap && Number(fromMap.remote_id) > 0) return Number(fromMap.remote_id);
  // Legacy single-destination columns, used before destination_map existed.
  const legacy = account.target === 'woo' ? Number(row.remote_woo_id || 0) : Number(row.remote_basalam_id || 0);
  return legacy > 0 ? legacy : 0;
}

/**
 * Compare every source product against ONE destination account.
 * Pure function: no database, no network, fully testable.
 */
export function reconcileAccount(local: ReconLocal[], remote: ReconRemote[], account: ReconAccount, profileNames: Record<string, string> = {}, suffixFormats: unknown = ''): UnifiedReconRow[] {
  const rows: UnifiedReconRow[] = [];
  // Only products whose title carries a «(کد ایکس)» suffix take part: everything
  // else is a draft/base title that must never be reconciled or published.
  const patterns = suffixPatterns(parseSuffixFormats(suffixFormats));
  const allLocal = local;
  local = allLocal.filter(row => hasCodeSuffix(String(row.title || ''), patterns));
  // Duplicate groups are counted over the code-free title, so «نام (کد ۱)» and
  // «نام (کد ۲)» report 2.
  const dupCount = new Map<string, number>();
  for (const row of local) {
    const key = normalizePersianText(stripCodeSuffix(String(row.title || ''), patterns));
    if (key) dupCount.set(key, (dupCount.get(key) || 0) + 1);
  }
  const duplicatesFor = (title: string): number => {
    const key = normalizePersianText(stripCodeSuffix(String(title || ''), patterns));
    return key ? (dupCount.get(key) || 0) : 0;
  };
  const byTitle = new Map<string, ReconLocal[]>();
  const bySku = new Map<string, ReconLocal>();
  const byRemoteId = new Map<number, ReconLocal>();
  for (const row of local) {
    const key = reconNormTitle(row.title);
    if (key) { const list = byTitle.get(key) || []; list.push(row); byTitle.set(key, list); }
    const sku = row.data?.sku || `s4-${row.profile_id}-${row.source_key}`.slice(0, 100);
    if (sku && !bySku.has(sku)) bySku.set(sku, row);
    const mapped = mappedRemoteId(row, account);
    if (mapped > 0 && !byRemoteId.has(mapped)) byRemoteId.set(mapped, row);
  }

  const consumed = new Set<ReconLocal>();
  const base = (row: ReconLocal | null) => ({
    target: account.target, accountKey: account.accountKey, accountName: account.name,
    pricePercent: Number(account.pricePercent) || 0,
    profileId: String(row?.profile_id || ''), profileName: profileNames[String(row?.profile_id || '')] || String(row?.profile_id || ''),
    sourceKey: String(row?.source_key || ''),
  });

  for (const item of remote) {
    // Destination products outside the «(کد ایکس)» convention are ignored
    // entirely rather than being reported as "only at the destination".
    if (!hasCodeSuffix(String(item.name || ''), patterns)) continue;
    const key = reconNormTitle(item.name || '');
    // Match by title first, then sku, then the stored remote id (destination
    // titles get edited by hand, so the id is the most durable fallback).
    let source = (byTitle.get(key) || []).find(row => !consumed.has(row)) || null;
    let matchedBy: MatchedBy = source ? 'title' : 'none';
    if (!source && item.sku && bySku.has(item.sku)) { const c = bySku.get(item.sku)!; if (!consumed.has(c)) { source = c; matchedBy = 'sku'; } }
    if (!source && byRemoteId.has(item.id)) { const c = byRemoteId.get(item.id)!; if (!consumed.has(c)) { source = c; matchedBy = 'id'; } }
    const remotePrice = asPrice(item.price);

    if (!source) {
      rows.push({
        ...base(null), bucket: 'extra', title: item.name || '', remoteTitle: item.name || '', remoteId: item.id || null,
        sourcePrice: null, expectedPrice: null, remotePrice, delta: null, matchedBy: 'none',
        status: String(item.status || ''), why: 'در مقصد هست ولی در هیچ پروفایلی نیست', duplicateCount: duplicatesFor(item.name || ''),
      });
      continue;
    }

    consumed.add(source);
    const sourcePrice = asPrice(source.price);
    const expectedPrice = expectedPriceFor(sourcePrice, account);
    const common = {
      ...base(source), title: source.title || '', remoteTitle: item.name || '', remoteId: item.id || null,
      sourcePrice, expectedPrice, remotePrice, matchedBy, status: String(item.status || ''),
      duplicateCount: duplicatesFor(source.title || ''),
    };
    if (expectedPrice === null) rows.push({ ...common, bucket: 'noPrice', delta: null, why: 'قیمت مبدأ ثبت نشده — مقایسه نشد' });
    else if (remotePrice !== expectedPrice) rows.push({ ...common, bucket: 'priceDiff', delta: (remotePrice || 0) - expectedPrice, why: account.pricePercent ? `قیمت مقصد با قیمت تعدیل‌شده (${account.pricePercent}٪) یکی نیست` : 'قیمت مقصد با مبدأ یکی نیست' });
    else rows.push({ ...common, bucket: 'matched', delta: 0, why: '' });
  }

  for (const row of local) {
    if (consumed.has(row)) continue;
    if (!row.active) continue; // retired products are not "missing"
    const sourcePrice = asPrice(row.price);
    rows.push({
      ...base(row), bucket: 'missing', title: row.title || '', remoteTitle: '', remoteId: null,
      sourcePrice, expectedPrice: expectedPriceFor(sourcePrice, account), remotePrice: null, delta: null,
      matchedBy: 'none', status: '', why: 'در مبدأ هست ولی در مقصد نیست', duplicateCount: duplicatesFor(row.title || ''),
    });
  }
  return rows;
}

export function summarize(rows: UnifiedReconRow[]) {
  const count = (bucket: ReconBucket) => rows.filter(r => r.bucket === bucket).length;
  const summary = { matched: count('matched'), priceDiff: count('priceDiff'), extra: count('extra'), missing: count('missing'), noPrice: count('noPrice') };
  return { ...summary, total: rows.length, inSync: summary.priceDiff === 0 && summary.extra === 0 && summary.missing === 0 };
}

/** Per-destination breakdown, so the UI can show one line per stall/site. */
export function byAccount(rows: UnifiedReconRow[]) {
  const groups = new Map<string, UnifiedReconRow[]>();
  for (const row of rows) {
    const key = `${row.target}:${row.accountKey}`;
    const list = groups.get(key) || []; list.push(row); groups.set(key, list);
  }
  return [...groups.entries()].map(([key, list]) => ({
    key, target: list[0].target, accountKey: list[0].accountKey, name: list[0].accountName,
    pricePercent: list[0].pricePercent, ...summarize(list),
  }));
}

/** Per-profile breakdown, so the UI can show which profile is out of sync. */
export function byProfile(rows: UnifiedReconRow[]) {
  const groups = new Map<string, UnifiedReconRow[]>();
  for (const row of rows) {
    if (!row.profileId) continue;
    const list = groups.get(row.profileId) || []; list.push(row); groups.set(row.profileId, list);
  }
  return [...groups.entries()].map(([profileId, list]) => ({
    profileId, profileName: list[0].profileName, ...summarize(list),
  }));
}

/**
 * Actions the "اجرا" (apply) button will perform, derived from the table.
 * Only rows that can be acted on safely are included: a price fix needs a
 * remote id, a re-publish needs a source row. `extra` rows are reported but
 * never auto-deleted -- removing a destination product is not reversible, so it
 * stays a manual decision.
 */
export type ReconAction = {
  kind: 'updatePrice' | 'create';
  target: 'woo' | 'basalam';
  accountKey: string;
  accountName: string;
  profileId: string;
  sourceKey: string;
  title: string;
  remoteId: number | null;
  fromPrice: number | null;
  toPrice: number | null;
};

export function planActions(rows: UnifiedReconRow[]): ReconAction[] {
  const actions: ReconAction[] = [];
  for (const row of rows) {
    if (row.bucket === 'priceDiff' && row.remoteId && row.expectedPrice) {
      actions.push({ kind: 'updatePrice', target: row.target, accountKey: row.accountKey, accountName: row.accountName,
        profileId: row.profileId, sourceKey: row.sourceKey, title: row.title, remoteId: row.remoteId,
        fromPrice: row.remotePrice, toPrice: row.expectedPrice });
    } else if (row.bucket === 'missing' && row.profileId && row.sourceKey) {
      actions.push({ kind: 'create', target: row.target, accountKey: row.accountKey, accountName: row.accountName,
        profileId: row.profileId, sourceKey: row.sourceKey, title: row.title, remoteId: null,
        fromPrice: null, toPrice: row.expectedPrice });
    }
  }
  return actions;
}

/**
 * Duplicate cleanup planning for the DESTINATIONS (WooCommerce + every Basalam
 * stall). Products that scrape into the same base title — i.e. identical once
 * the «(کد ایکس)» suffix is stripped — are duplicates of each other at the shop.
 * By default the MOST EXPENSIVE listing is kept and the cheaper copies are
 * deleted, which is the safe direction for a seller.
 *
 * Only destination listings are considered; the locally scraped catalogue is
 * never touched by this plan.
 */
export type DuplicateAction = {
  kind: 'deleteDuplicate';
  target: 'woo' | 'basalam';
  accountKey: string;
  accountName: string;
  remoteId: number;
  title: string;
  price: number;
  keepId: number;
  keepPrice: number;
  keepTitle: string;
  groupSize: number;
};

export function planDuplicateDeletions(
  remotes: ReconRemote[],
  account: ReconAccount,
  suffixFormats: unknown = '',
  keep: 'expensive' | 'cheapest' = 'expensive',
): DuplicateAction[] {
  const patterns = suffixPatterns(parseSuffixFormats(suffixFormats));
  const groups = new Map<string, ReconRemote[]>();
  for (const remote of remotes) {
    const name = String(remote?.name || '');
    // Only «(کد ایکس)» listings participate, exactly like reconciliation: a shop
    // product without the code suffix is not one of our published variants.
    if (!name || !hasCodeSuffix(name, patterns)) continue;
    if (!Number(remote?.id)) continue;
    const key = reconNormTitle(stripCodeSuffix(name, patterns));
    if (!key) continue;
    const list = groups.get(key);
    if (list) list.push(remote); else groups.set(key, [remote]);
  }
  const actions: DuplicateAction[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => {
      const pa = Number(a.price) || 0, pb = Number(b.price) || 0;
      if (pa !== pb) return keep === 'expensive' ? pb - pa : pa - pb;
      // Deterministic tie-break so a preview and its apply agree.
      return (Number(a.id) || 0) - (Number(b.id) || 0);
    });
    const survivor = sorted[0];
    for (const victim of sorted.slice(1)) {
      actions.push({
        kind: 'deleteDuplicate', target: account.target, accountKey: account.accountKey,
        accountName: account.name, remoteId: Number(victim.id), title: String(victim.name || ''),
        price: Number(victim.price) || 0, keepId: Number(survivor.id), keepPrice: Number(survivor.price) || 0,
        keepTitle: String(survivor.name || ''), groupSize: list.length,
      });
    }
  }
  return actions;
}
