/**
 * Worker-side wiring for the connection feedback loop.
 *
 * worker-src/connection-loop.ts holds the pure logic (recipes, verdicts, planning); this file
 * gives it a real transport, the app's state storage and the source-network settings, and
 * exposes the two entry points the rest of the worker uses:
 *
 *   healSourceConnection()  — run the loop on demand (dashboard button / API)
 *   learnedSourceInit()     — reuse the remembered recipe on every later fetch
 *
 * Twin: render-src/connection-heal.ts.
 */
import { getState, setState } from './db.js';
import { loadConnections } from './connections.js';
import { resolveSourceNetwork } from './source-network.js';
import { probeSource, probeSourceViaWorker } from './network.js';
import {
  runConnectionLoop, learnedRecipe, recipeById, selectorVerifier, shouldAutoHeal, autoHealAllowed, forgetRecipe,
  type ConnectionRecipe, type LoopDeps, type LoopReport, type LoopTransport, type RecipeRoute
} from './connection-loop.js';
import { shapeUrl, type UrlShape } from './url-shapes.js';
import { mirrorById, unwrapMirror, type MirrorId } from './source-mirrors.js';

export { shouldAutoHeal };
/** Drops the remembered recipe for a host so the next run re-learns it from scratch. */
export async function forgetSourceRecipe(url: string): Promise<void> { await forgetRecipe(setState, url); }

/** «آینه‌های عمومی» in the source-connection settings; on by default, one checkbox to stop them. */
export async function mirrorsEnabled(): Promise<boolean> {
  return (await getState<any>('settings', {}))?.source?.mirrors !== false;
}

export async function sourceNetworkFor(url: string) {
  return resolveSourceNetwork((await getState<any>('settings', {}))?.source, (await loadConnections()).ai.network, url);
}

/** Real transport for the loop: one request per attempt, plus an optional warm-up of the site root. */
export function sourceTransport(workerUrl: string, maxBytes = 4_000_000): LoopTransport {
  return async ({ url, route, headers, warm, mirror }) => {
    try {
      if (route === 'mirror') return await probeSourceViaMirror(url, mirror, headers, maxBytes);
      if (route === 'worker') return await probeSourceViaWorker(url, workerUrl, headers, maxBytes);
      let sent: Record<string, string> = { ...headers };
      if (warm) {
        const origin = new URL(url).origin + '/';
        const first = await probeSource(origin, { headers: { ...headers, referer: origin } }, maxBytes).catch(() => null);
        if (first?.cookie) sent = { ...sent, cookie: first.cookie };
        sent.referer = origin;
      }
      return await probeSource(url, { headers: sent }, maxBytes);
    } catch (error) {
      return { status: 0, text: '', url, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

/**
 * Fetches the page through a public mirror. The body is normalised back towards the original
 * markup and reported under the ORIGINAL url, so relative links in the page still resolve
 * against the real site instead of the mirror.
 */
export async function probeSourceViaMirror(target: string, id: MirrorId | undefined, headers: Record<string, string>, maxBytes = 4_000_000) {
  const mirror = mirrorById(String(id || ''));
  if (!mirror) throw new Error('آینهٔ نامعتبر برای دریافت صفحهٔ مبدأ.');
  const sentUrl = mirror.build(target);
  const probe = await probeSource(sentUrl, { headers: { ...mirror.headers, ...headers } }, maxBytes);
  return { ...probe, text: unwrapMirror(mirror.id, probe.text), url: target, sentUrl };
}

export async function loopDeps(url: string, listSelector?: string): Promise<LoopDeps & { workerUrl: string }> {
  const network = await sourceNetworkFor(url);
  return {
    workerUrl: network.workerUrl,
    transport: sourceTransport(network.workerUrl),
    hasGateway: Boolean(network.workerUrl),
    allowDirect: network.mode !== 'worker',
    allowMirrors: await mirrorsEnabled(),
    getState, setState,
    verify: selectorVerifier(listSelector)
  };
}

export async function healSourceConnection(url: string, options: { listSelector?: string; maxRounds?: number; startWith?: string } = {}): Promise<LoopReport> {
  const deps = await loopDeps(url, options.listSelector);
  return runConnectionLoop(deps, { url, maxRounds: options.maxRounds, startWith: options.startWith });
}

export type LearnedInit = { recipe: ConnectionRecipe; route: RecipeRoute; headers: Record<string, string>; url: string; shape: UrlShape; mirror?: MirrorId } | null;

/** The remembered request shape for this host, ready to be merged into the next fetch. */
export async function learnedSourceInit(url: string): Promise<LearnedInit> {
  const saved = await learnedRecipe(getState, url);
  if (!saved) return null;
  const recipe = recipeById(saved.recipe);
  if (!recipe) return null;
  const shape: UrlShape = saved.shape || recipe.url || 'canonical';
  try {
    const target = new URL(url);
    return { recipe, route: recipe.route, headers: recipe.headers(target), url: shapeUrl(target.href, shape), shape, mirror: recipe.mirror };
  } catch { return null; }
}

/**
 * The feedback half of the loop at runtime: a block-shaped failure during a normal extraction
 * re-runs the loop once (rate limited per host) so the next attempt — and every later run —
 * uses a shape the site accepts, instead of failing the same way forever.
 */
export type HealOutcome = { init: LearnedInit; advice: string; report: LoopReport } | null;

/**
 * The feedback half of the loop at runtime. Returns null when healing does not apply (the
 * failure is not block shaped, or this host was healed a moment ago); otherwise it always
 * returns the diagnosis, so a failed heal still tells the user something new instead of
 * repeating the bare «HTTP 403».
 */
export async function autoHeal(url: string, message: string, listSelector?: string): Promise<HealOutcome> {
  if (!shouldAutoHeal(message)) return null;
  if (!(await autoHealAllowed({ getState, setState }, url))) return null;
  const report = await healSourceConnection(url, { listSelector });
  await setState(loopReportKey(url), { at: Date.now(), ok: report.ok, advice: report.advice, attempts: report.attempts }).catch(() => undefined);
  return { init: report.ok ? await learnedSourceInit(url) : null, advice: report.advice, report };
}

/** Where the last automatic diagnosis of a host is kept, so support can read it later. */
export function loopReportKey(url: string): string {
  try { return 'net.loop:' + new URL(url).hostname.toLowerCase(); } catch { return 'net.loop:' + url; }
}
