/**
 * Shared background description-enrichment tick (both runtimes).
 *
 * The user asked that the description generator stay active on EVERY profile
 * and always work in the background so no product is left without details.
 * Every scheduler (Worker cron, Node's 60s loop, standalone cron) calls
 * aiEnrichTick once per turn; the tick enriches one small batch on a single
 * profile, then persists a rotating cursor so the next turn continues on the
 * next profile. Products are scanned stalest-first, so freshly enriched rows
 * sink to the back and the neediest rows always come up next.
 *
 * Pure apart from the injected IO — exactly like categoryFixTick — so both
 * runtimes share the policy and the unit tests run it with stubs.
 */
export const AI_ENRICH_LAST_KEY = 'ai_enrich_last';
export const AI_ENRICH_BATCH = 5;
const AI_ENRICH_BACKOFF_MS = 10 * 60_000;

export interface AiEnrichCursor {
  profile?: string;
  at?: string | null;
  scanned?: number;
  enriched?: number;
  failed?: number;
  backoffUntil?: string | null;
}

export interface AiEnrichResult {
  ran: boolean;
  profileId: string | null;
  scanned: number;
  enriched: number;
  failed: number;
  skipped?: string;
}

export interface AiEnrichTickIO {
  /** Global ai_description_settings kill-switch. */
  enabled(): boolean | Promise<boolean>;
  /** Fast skip when no chat model is configured (avoids pointless scans). */
  modelReady(): boolean | Promise<boolean>;
  listProfileIds(): string[] | Promise<string[]>;
  loadCursor(): AiEnrichCursor | null | Promise<AiEnrichCursor | null>;
  saveCursor(cursor: AiEnrichCursor): unknown | Promise<unknown>;
  /** Stalest-first slice so enriched rows sink and needy rows surface. */
  listStalest(profileId: string, limit: number): unknown[] | Promise<unknown[]>;
  /** Runtime wrapper around generateProductDescription; must mutate in place. */
  enrich(product: unknown): { changed?: boolean } | Promise<{ changed?: boolean }>;
  /** Runtime wrapper around upsertProduct; only called when changed. */
  saveProduct(profileId: string, product: unknown): unknown | Promise<unknown>;
  batch?: number;
  log?(message: string): void;
}

export async function aiEnrichTick(io: AiEnrichTickIO): Promise<AiEnrichResult> {
  if (!(await io.enabled())) return { ran: false, profileId: null, scanned: 0, enriched: 0, failed: 0, skipped: 'disabled' };
  if (!(await io.modelReady())) return { ran: false, profileId: null, scanned: 0, enriched: 0, failed: 0, skipped: 'no-model' };
  const ids = ((await io.listProfileIds()) || []).map(String).filter(Boolean).sort();
  if (!ids.length) return { ran: false, profileId: null, scanned: 0, enriched: 0, failed: 0, skipped: 'no-profiles' };
  const saved: AiEnrichCursor = (await io.loadCursor()) || {};
  if (saved.backoffUntil && Date.now() < Date.parse(String(saved.backoffUntil))) {
    return { ran: false, profileId: null, scanned: 0, enriched: 0, failed: 0, skipped: 'backoff' };
  }
  const next = ids.find(id => id > String(saved.profile || '')) || ids[0];
  const batch = Math.max(1, Math.min(20, Number(io.batch) || AI_ENRICH_BATCH));
  const products = ((await io.listStalest(next, batch)) || []) as unknown[];
  let enriched = 0, failed = 0;
  for (const product of products) {
    try {
      const result = (await io.enrich(product)) || {};
      if (result && (result as { changed?: boolean }).changed) {
        await io.saveProduct(next, product);
        enriched++;
      }
    } catch {
      failed++;
    }
  }
  const now = new Date().toISOString();
  const cursor: AiEnrichCursor = {
    profile: next, at: now, scanned: products.length, enriched, failed,
    backoffUntil: enriched === 0 && failed > 0 ? new Date(Date.now() + AI_ENRICH_BACKOFF_MS).toISOString() : null,
  };
  await io.saveCursor(cursor);
  io.log?.(`profile=${next} scanned=${products.length} enriched=${enriched} failed=${failed}`);
  return { ran: true, profileId: next, scanned: products.length, enriched, failed };
}
