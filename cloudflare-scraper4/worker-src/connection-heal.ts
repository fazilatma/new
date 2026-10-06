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

export { shouldAutoHeal };
/** Drops the remembered recipe for a host so the next run re-learns it from scratch. */
export async function forgetSourceRecipe(url: string): Promise<void> { await forgetRecipe(setState, url); }

export async function sourceNetworkFor(url: string) {
  return resolveSourceNetwork((await getState<any>('settings', {}))?.source, (await loadConnections()).ai.network, url);
}

/** Real transport for the loop: one request per attempt, plus an optional warm-up of the site root. */
export function sourceTransport(workerUrl: string, maxBytes = 4_000_000): LoopTransport {
  return async ({ url, route, headers, warm }) => {
    try {
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

export async function loopDeps(url: string, listSelector?: string): Promise<LoopDeps & { workerUrl: string }> {
  const network = await sourceNetworkFor(url);
  return {
    workerUrl: network.workerUrl,
    transport: sourceTransport(network.workerUrl),
    hasGateway: Boolean(network.workerUrl),
    allowDirect: network.mode !== 'worker',
    getState, setState,
    verify: selectorVerifier(listSelector)
  };
}

export async function healSourceConnection(url: string, options: { listSelector?: string; maxRounds?: number; startWith?: string } = {}): Promise<LoopReport> {
  const deps = await loopDeps(url, options.listSelector);
  return runConnectionLoop(deps, { url, maxRounds: options.maxRounds, startWith: options.startWith });
}

export type LearnedInit = { recipe: ConnectionRecipe; route: RecipeRoute; headers: Record<string, string> } | null;

/** The remembered request shape for this host, ready to be merged into the next fetch. */
export async function learnedSourceInit(url: string): Promise<LearnedInit> {
  const saved = await learnedRecipe(getState, url);
  if (!saved) return null;
  const recipe = recipeById(saved.recipe);
  if (!recipe) return null;
  try { return { recipe, route: recipe.route, headers: recipe.headers(new URL(url)) }; } catch { return null; }
}

/**
 * The feedback half of the loop at runtime: a block-shaped failure during a normal extraction
 * re-runs the loop once (rate limited per host) so the next attempt — and every later run —
 * uses a shape the site accepts, instead of failing the same way forever.
 */
export async function autoHeal(url: string, message: string, listSelector?: string): Promise<LearnedInit> {
  if (!shouldAutoHeal(message)) return null;
  if (!(await autoHealAllowed({ getState, setState }, url))) return null;
  const report = await healSourceConnection(url, { listSelector });
  if (!report.ok) return null;
  return learnedSourceInit(url);
}
