/**
 * Shared destination-catalog pure core — single source for Worker + Node.
 * ========================================================================
 * These helpers transform destination (WooCommerce / Basalam) data without any
 * database, environment binding, secret, or network access, so BOTH runtimes
 * import them directly:
 *
 *   worker-src/maintenance.ts  (Cloudflare Worker)
 *   render-src/maintenance.ts  (Node: Render / Termux / VPS / local / Passenger)
 *   worker-src/ai.ts + render-src/ai.ts (category prompt builders)
 *
 * Rules for this file:
 * - No imports except dependency-free modules (utils.js) and types.
 * - No fetch, no D1/pool, no getState/setState, no loadConnections.
 * - Runtime-specific code (fetch wrappers, caching, learning records) stays in
 *   each runtime's own maintenance.ts / ai.ts and calls these pure helpers.
 */
import { normalizePersianText } from './utils.js';

export type DestinationTarget = 'woo' | 'basalam';
export type DestinationCategory = { id: number; name: string; path: string; parentId: number | null; depth: number; leaf: boolean };
export type AiCategoryOption = { id: number; name: string; path?: string; parentId?: number | null; leaf?: boolean };
export type RichRemote = {
  id: number; name: string; title: string; sku: string; images: string[]; image: string;
  status: string; statusLabel: string; price: number; priceRaw: number; stock: number | null;
  category: string; categoryId: number | null; shopId: string; shopName: string;
  rejectionReason: string; shortDescription: string; description: string; raw: any;
};
export type CatalogQuery = { page?: number; perPage?: number; q?: string; status?: string; shopId?: string; counts?: boolean };
export type ProductRef = { id: number; shopId: string };
export type CategoryAssignment = { categoryId: number; categoryName: string; source: string };
export type BasalamShopStall = { name: string; token: string; vendorId: string; pricePercent: number; primary: boolean };

export function clamp(value: any, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

export function msg(e: unknown) { return e instanceof Error ? e.message : String(e); }

/** Title key used to group/compare destination listings (code suffix stripped). */
export function destNormTitle(v: string) {
  return normalizePersianText(v).replace(/\s*[\[(](?:کد|code|sku)?\s*[:：]?\s*\d+[\])]\s*$/i, '').trim();
}

export function normalizeRefs(ids: any[], shopId = ''): ProductRef[] {
  const seen = new Set<string>(), rows: ProductRef[] = [];
  for (const value of ids || []) {
    const id = Number(typeof value === 'object' ? value.id : value), shop = String(typeof value === 'object' ? (value.shopId || value.shop_id || shopId) : shopId || '');
    if (!Number.isInteger(id) || id <= 0) continue;
    const key = `${shop}:${id}`;
    if (!seen.has(key)) { seen.add(key); rows.push({ id, shopId: shop }); }
  }
  return rows;
}

export function normalizeCategoryAssignments(value: any) {
  const rows = Array.isArray(value) ? value : [], map = new Map<string, CategoryAssignment>();
  for (const row of rows) {
    const id = Number(row?.id), categoryId = Number(row?.categoryId ?? row?.category_id), shopId = String(row?.shopId ?? row?.shop_id ?? '');
    if (Number.isInteger(id) && id > 0 && Number.isInteger(categoryId) && categoryId > 0)
      map.set(`${shopId}:${id}`, { categoryId, categoryName: String(row?.categoryName ?? row?.category_name ?? ''), source: String(row?.source ?? '') });
  }
  return map;
}

export function directPayload(target: DestinationTarget, input: any, current: RichRemote): any {
  const payload: any = {};
  if (input.title !== undefined && String(input.title).trim() && String(input.title).trim() !== current.title) payload[target === 'woo' ? 'name' : 'name'] = String(input.title).trim().slice(0, target === 'woo' ? 300 : 120);
  if (input.price !== undefined && input.price !== '' && Number.isFinite(Number(input.price))) { const price = Math.max(0, Math.round(Number(input.price))); if (price !== current.price) payload[target === 'woo' ? 'regular_price' : 'primary_price'] = target === 'woo' ? String(price) : price * 10; }
  if (input.stock !== undefined && input.stock !== '' && Number.isFinite(Number(input.stock))) { const stock = Math.max(0, Math.round(Number(input.stock))); target === 'woo' ? Object.assign(payload, { manage_stock: true, stock_quantity: stock, stock_status: stock > 0 ? 'instock' : 'outofstock' }) : payload.stock = stock; }
  if (input.status !== undefined && String(input.status)) Object.assign(payload, statusPayload(target, String(input.status)));
  if (input.shortDescription !== undefined) payload[target === 'woo' ? 'short_description' : 'brief'] = String(input.shortDescription).slice(0, target === 'woo' ? 20_000 : 250);
  if (input.description !== undefined) payload.description = String(input.description).slice(0, 100_000);
  if (input.sku !== undefined && target === 'woo') payload.sku = String(input.sku).slice(0, 100);
  if (input.categoryId !== undefined && Number(input.categoryId) > 0) target === 'woo' ? payload.categories = [{ id: Number(input.categoryId) }] : payload.category_id = Number(input.categoryId);
  if (target === 'basalam') for (const key of ['preparation_days', 'weight', 'package_weight']) if (input[key] !== undefined && Number(input[key]) >= 0) payload[key] = Number(input[key]);
  return payload;
}

export function bulkPayload(target: DestinationTarget, ops: any, current: RichRemote) {
  const payload: any = {}, summary: any = {};
  if (ops.price && typeof ops.price === 'object') { const next = applyPrice(String(ops.price.op || ''), String(ops.price.val ?? ''), current.price); if (next !== null && next !== current.price) { payload[target === 'woo' ? 'regular_price' : 'primary_price'] = target === 'woo' ? String(next) : next * 10; summary.newPrice = next; summary.pricePercent = current.price ? Math.round((next - current.price) / current.price * 1000) / 10 : 0; } }
  if (ops.stock !== undefined && ops.stock !== '') { const stock = Math.max(0, Math.round(Number(ops.stock) || 0)); target === 'woo' ? Object.assign(payload, { manage_stock: true, stock_quantity: stock, stock_status: stock > 0 ? 'instock' : 'outofstock' }) : payload.stock = stock; summary.stock = stock; }
  if (ops.status) Object.assign(payload, statusPayload(target, String(ops.status)));
  if (ops.description !== undefined || ops.desc !== undefined) payload.description = String(ops.description ?? ops.desc).slice(0, 100_000);
  if (ops.shortDescription !== undefined || ops.short_desc !== undefined) payload[target === 'woo' ? 'short_description' : 'brief'] = String(ops.shortDescription ?? ops.short_desc).slice(0, target === 'woo' ? 20_000 : 250);
  if (ops.categoryId !== undefined && Number(ops.categoryId) > 0) { const categoryId = Math.round(Number(ops.categoryId)); target === 'woo' ? payload.categories = [{ id: categoryId }] : payload.category_id = categoryId; summary.newCategoryId = categoryId; }
  const title = (String(ops.titlePrefix ?? ops.title_prefix ?? '') + current.title + String(ops.titleSuffix ?? ops.title_suffix ?? '')).trim();
  if (title && title !== current.title) { payload.name = title.slice(0, target === 'woo' ? 300 : 120); summary.newTitle = title; }
  return { payload, summary };
}

export function statusPayload(target: DestinationTarget, status: string) {
  if (target === 'woo') { if (!['publish', 'draft', 'private', 'pending', 'trash'].includes(status)) throw Error('وضعیت ووکامرس نامعتبر است.'); return { status }; }
  const number = Number(status);
  if (![2976, 3790, 3567, 3568, 4184].includes(number)) throw Error('وضعیت باسلام نامعتبر است.');
  return { status: number };
}

export function applyPrice(op: string, value: string, current: number): number | null {
  if (!['set', 'inc', 'dec'].includes(op)) return null;
  const percent = value.trim().endsWith('%'), amount = Number(value.replace('%', '').replace(/,/g, ''));
  if (!Number.isFinite(amount)) return null;
  const next = op === 'set' ? amount : op === 'inc' ? current + (percent ? current * amount / 100 : amount) : current - (percent ? current * amount / 100 : amount);
  return Math.max(0, Math.round(next));
}

export function basalamStatuses(status: string) {
  const map: Record<string, string[]> = { all: ['2976', '3790', '3567', '3568', '4184', '2977', '2978', '3248', '4221'], active: ['2976'], inactive: ['3790'], not_approved: ['3567'], pending: ['3568'], archived: ['4184'] };
  return map[status] || ([2976, 3790, 3567, 3568, 4184].includes(Number(status)) ? [String(status)] : map.all);
}

export function selectShops(shops: BasalamShopStall[], shopId: string) {
  return !shopId || shopId === 'all' || shopId === '0' ? shops : shops.filter(shop => shop.vendorId === String(shopId));
}

export function wooListStatus(status: string) { return ['publish', 'draft', 'pending', 'private', 'trash'].includes(status) ? status : 'any'; }

export function categoryRoots(body: any): any[] {
  const candidates = [body?.data?.categories, body?.data, body?.categories, body?.results, body?.items, body];
  for (const value of candidates) if (Array.isArray(value)) return value;
  return [];
}

export function categoryChildren(row: any): any[] {
  for (const value of [row?.children, row?.childs, row?.subcategories, row?.categories, row?.data?.children]) if (Array.isArray(value)) return value;
  return [];
}

export function flattenCategoryTree(rows: any[], out: DestinationCategory[], parents: string[], depth: number, parentId: number | null) {
  for (const row of rows) {
    const id = Number(row?.id ?? row?.category_id ?? row?.value), name = String(row?.name ?? row?.title ?? row?.label ?? '').trim();
    if (!Number.isInteger(id) || id <= 0 || !name) continue;
    const children = categoryChildren(row), path = [...parents, name];
    out.push({ id, name, path: path.join(' ← '), parentId, depth, leaf: children.length === 0 });
    if (children.length) flattenCategoryTree(children, out, path, depth + 1, id);
  }
}

export function dedupeCategories(rows: DestinationCategory[]) {
  const seen = new Set<number>();
  return rows.filter(row => !seen.has(row.id) && (seen.add(row.id), true));
}

export function normalizeRemote(target: DestinationTarget, x: any, shopId: string, shopName: string): RichRemote {
  const revision = x?.revision?.data || {}, rawStatus = x?.status ?? revision.status ?? '', status = typeof rawStatus === 'object' ? String(rawStatus.value ?? rawStatus.id ?? '') : String(rawStatus || ''), statusLabel = typeof rawStatus === 'object' ? String(rawStatus.name || rawStatus.description || status) : target === 'basalam' ? ({ '2976': 'فعال', '3790': 'غیرفعال', '3567': 'تأیید نشده', '3568': 'در انتظار تأیید', '4184': 'بایگانی' }[status] || status) : status;
  const rawImages = target === 'woo' ? (x?.images || []) : (x?.photos || revision.photos || x?.images || (x?.photo || revision.photo ? [x?.photo || revision.photo] : [])), images = (Array.isArray(rawImages) ? rawImages : []).map(imageValue).filter(Boolean), priceRaw = Number(x?.primary_price ?? revision.primary_price ?? x?.price ?? x?.regular_price ?? 0) || 0, category = x?.categories?.[0] || revision.category || x?.category || {}, reasons = [rawStatus?.description, ...(x?.revision?.rejection_reasons || []).flatMap((item: any) => [item?.name, item?.description])].filter(Boolean).join(' | ');
  const title = String(x?.name || x?.title || revision.title || '');
  return { id: Number(x?.id) || 0, name: title, title, sku: String(x?.sku || revision.sku || ''), images, image: images[0] || '', status, statusLabel, price: target === 'basalam' ? Math.round(priceRaw / 10) : priceRaw, priceRaw, stock: numberOrNull(x?.stock_quantity ?? x?.inventory ?? revision.inventory ?? x?.stock), category: String(category?.name || category?.title || x?.category_name || ''), categoryId: Number(category?.id || x?.category_id) || null, shopId, shopName, rejectionReason: reasons, shortDescription: String(x?.short_description || x?.brief || revision.brief || ''), description: String(x?.description || revision.description || ''), raw: x };
}

export function imageValue(value: any): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return String(value.src || value.original || value.lg || value.md || value.sm || value.xs || value.url || '');
}

export function rowsFrom(body: any): any[] {
  const rows = body?.data ?? body?.products ?? body?.results ?? body?.items ?? body;
  return Array.isArray(rows) ? rows : [];
}

export function unwrapProduct(body: any): any { return body?.data?.product ?? body?.data ?? body?.product ?? body ?? {}; }

export function numberOrNull(value: any): number | null {
  return value === null || value === undefined || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);
}

/* ------------------------- AI category prompt builders ------------------------ */
/* Ranked allow-list prompt + tolerant id parser, shared by both runtimes so the
   model sees identical options and both runtimes validate answers identically. */

export function normalizeCategoryText(value: string) {
  return normalizePersianText(value).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function categoryRows(title: string, categories: AiCategoryOption[]) {
  const words = normalizeCategoryText(title).split(' ').filter(word => word.length > 1), rows = categories.filter(row => Number.isInteger(Number(row.id)) && Number(row.id) > 0 && (row.leaf !== false || !categories.some(other => Number(other.parentId) === Number(row.id))));
  return rows.map((row, index) => { const name = String(row.path || row.name), normalized = normalizeCategoryText(name), score = words.reduce((sum, word) => sum + (normalized.includes(word) ? word.length + 2 : 0), 0); return { row, index, name, score }; }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 500);
}

export function categoryPrompt(title: string, categories: AiCategoryOption[]) {
  const ranked = categoryRows(title, categories), allowed: AiCategoryOption[] = [], lines: string[] = [];
  let length = 0;
  for (const item of ranked) {
    const line = `${item.row.id} | ${item.name}`;
    if (length + line.length + 1 > 18_000) break;
    lines.push(line); allowed.push(item.row); length += line.length + 1;
  }
  if (!lines.length) throw new Error('فهرست معتبر دسته‌بندی باسلام در دسترس نیست.');
  return { allowed, prompt: `برای محصول زیر فقط مناسب‌ترین شناسه دسته‌بندی باسلام را از فهرست مجاز انتخاب کن. شناسه باید دقیقاً یکی از اعداد فهرست باشد. اگر مدل استدلالی هستی، فکرکردن را داخلی انجام بده و در پاسخ نهایی هیچ عدد دیگری ننویس. پاسخ نهایی فقط JSON کوتاه {"category_id":123,"reason":"..."} باشد.\nمحصول: ${title}\nفهرست مجاز:\n${lines.join('\n')}` };
}

export function parseCategoryId(text: string, categories: AiCategoryOption[]) {
  const source = String(text || ''), valid = new Set(categories.map(row => Number(row.id)));
  for (const candidate of [source, ...[...source.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1])]) try {
    const parsed = JSON.parse(candidate.trim());
    const id = Number(parsed?.category_id ?? parsed?.categoryId ?? parsed?.id);
    if (valid.has(id)) return id;
  } catch { /* response can contain prose */ }
  for (const match of source.matchAll(/["']?category_(?:id)?["']?\s*[:=]\s*["']?(\d+)/gi)) { const id = Number(match[1]); if (valid.has(id)) return id; }
  const numbers = [...source.matchAll(/\d+/g)].map(match => Number(match[0])).filter(id => valid.has(id));
  return numbers.length ? numbers[numbers.length - 1] : 0;
}

/* ------------------------- Category vote-mode selection ----------------------- */
/* Bulk Basalam categorization offers three voter modes. Both runtimes resolve
   the voter list through selectCategoryModels so Worker and Node always agree
   on which models vote: the pinned master alone, the master backed by pinned
   candidates, or the full multi-model ensemble of green models. */
export type CategoryVoteMode = 'master' | 'master-candidates' | 'ensemble';
export function normalizeCategoryMode(value: any): CategoryVoteMode {
  const mode = String(value ?? '').trim();
  return mode === 'master' || mode === 'master-candidates' ? mode : 'ensemble';
}
export function resolveMasterKey(configured: string[], master: any): string | null {
  const raw = String(master ?? '').trim();
  if (!raw) return null;
  if (raw.includes('::')) return configured.includes(raw) ? raw : null;
  return configured.find(key => key.split('::').slice(1).join('::') === raw) || null;
}
export function selectCategoryModels(input: { mode?: any; master?: any; candidates?: any; configured?: string[]; green?: Set<string> | string[]; pinned?: string[] }): string[] {
  const mode = normalizeCategoryMode(input.mode), configured = Array.isArray(input.configured) ? input.configured : [], green = new Set<string>(input.green || []);
  const usable = configured.filter(key => green.has(key)), wanted = (Array.isArray(input.candidates) ? input.candidates : []).map(String);
  if (mode === 'master' || mode === 'master-candidates') {
    const pinned = String(input.master ?? '').trim();
    if (!pinned) throw new Error('مدل مستر انتخاب نشده است؛ ابتدا در بخش «هوش مصنوعی ← کاندیدها و مدل مستر» یک مدل را مستر کنید.');
    // Manual selection wins: the pinned master and candidates run even when the last
    // server-side test marked them red (or never tested them). Only the ensemble,
    // which the user does not hand-pick, stays limited to green models.
    const masterKey = resolveMasterKey(configured, pinned);
    if (!masterKey) throw new Error(`مدل مستر (${pinned}) دیگر در میان مدل‌های پیکربندی‌شده نیست؛ در بخش «هوش مصنوعی ← کاندیدها و مدل مستر» یک مدل معتبر را مستر کنید.`);
    if (mode === 'master') return [masterKey];
    return [masterKey, ...wanted.filter(key => key !== masterKey && configured.includes(key))].slice(0, 5);
  }
  // A manually picked consensus list wins over the automatic green set (manual
  // selection runs even when the last server-side test marked models red or
  // never tested them); an empty list keeps the automatic ensemble behavior.
  const pin = Array.isArray(input.pinned) ? input.pinned.map(String).filter(key => configured.includes(key)) : [];
  if (pin.length) return [...new Set(pin)].slice(0, CATEGORY_FIX_MAX_PINNED_MODELS);
  return [...new Set([...wanted.filter(key => usable.includes(key)), ...usable])].slice(0, 5);
}
/** Default gap between automatic bulk Basalam category fixes (hours). */
export const CATEGORY_FIX_DEFAULT_EVERY_HOURS = 6;
/** Longest gap a user may schedule between automatic bulk fixes (one week). */
export const CATEGORY_FIX_MAX_EVERY_HOURS = 168;
/** Cap on manually picked consensus models (shared with the green-model cap). */
export const CATEGORY_FIX_MAX_PINNED_MODELS = 5;
/** Key of the last-fix record shared by the manual and periodic triggers. */
export const CATEGORY_FIX_LAST_KEY = 'category_fix_last';
/** Normalize a raw consensus-model list: `provider::model` keys, deduped, capped. */
export function normalizeCategoryFixPinned(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), out: string[] = [];
  for (const entry of raw) {
    const key = String(entry ?? '').trim();
    if (!key || !key.includes('::') || seen.has(key)) continue;
    seen.add(key); out.push(key);
    if (out.length >= CATEGORY_FIX_MAX_PINNED_MODELS) break;
  }
  return out;
}
/** Read the stored consensus-model list from settings (empty means automatic). */
export function categoryFixPinnedModels(settings: any): string[] { return normalizeCategoryFixPinned(settings?.categoryFix?.consensusModels); }
export interface CategoryFixSchedule { enabled: boolean; everyHours: number; mode: CategoryVoteMode }
/** Normalize the periodic-fix schedule; defaults to disabled / 6h / consensus. */
export function normalizeCategoryFixSchedule(settings: any): CategoryFixSchedule {
  const raw = settings?.categoryFix?.periodic ?? {}, hours = Number(raw?.everyHours);
  return { enabled: raw?.enabled === true, everyHours: Number.isFinite(hours) ? Math.min(CATEGORY_FIX_MAX_EVERY_HOURS, Math.max(1, Math.trunc(hours))) : CATEGORY_FIX_DEFAULT_EVERY_HOURS, mode: normalizeCategoryMode(raw?.mode) };
}
/** True when the periodic fix may start (never started, or the gap has passed). */
export function categoryFixDue(schedule: CategoryFixSchedule, last: { at?: unknown } | null | undefined, now: number = Date.now()): boolean {
  if (!schedule?.enabled) return false;
  const at = Date.parse(String((last as any)?.at ?? ''));
  if (!Number.isFinite(at)) return true;
  return now - at >= schedule.everyHours * 3_600_000;
}
export interface CategoryFixTickIO { settings: unknown; now?: number; loadLast: () => Promise<any>; saveLast: (record: Record<string, unknown>) => Promise<void>; start: (input: { mode: CategoryVoteMode; consensusModels: string[]; trigger: 'periodic' }) => Promise<{ existing?: boolean; run?: unknown }>; log?: (message: string) => void }
/**
 * One periodic-fix tick shared by every runtime (Worker cron, Node in-web
 * scheduler, Render cron). Never throws: failures are recorded in the
 * last-fix state so the dashboard can show them. The manual starter records
 * the same state, so a manual run also resets the periodic clock.
 */
export async function categoryFixTick(io: CategoryFixTickIO): Promise<{ started: boolean; reason: string }> {
  const schedule = normalizeCategoryFixSchedule(io.settings);
  if (!schedule.enabled) return { started: false, reason: 'disabled' };
  let last: any = null;
  try { last = await io.loadLast(); } catch { last = null; }
  const moment = Number(io.now) > 0 ? Number(io.now) : Date.now();
  if (!categoryFixDue(schedule, last, moment)) return { started: false, reason: 'not-due' };
  try {
    const started = await io.start({ mode: schedule.mode, consensusModels: categoryFixPinnedModels(io.settings), trigger: 'periodic' });
    if (started?.existing) return { started: false, reason: 'active' };
    return { started: true, reason: 'started' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await io.saveLast({ at: new Date(moment).toISOString(), ok: false, trigger: 'periodic', mode: schedule.mode, error: message }); } catch {}
    try { io.log?.(`category-fix periodic skipped: ${message}`); } catch {}
    return { started: false, reason: 'failed' };
  }
}
