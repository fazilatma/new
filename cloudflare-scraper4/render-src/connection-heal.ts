/**
 * Node-side wiring for the connection feedback loop (twin of worker-src/connection-heal.ts).
 *
 * The pure logic is shared verbatim from worker-src/connection-loop.ts; only the transport,
 * the state storage and the way the learned recipe is injected differ, because on Node every
 * source fetch goes through render-src/network.ts safeFetch() instead of a sourceText() of
 * its own. Importing this module installs both hooks on the network layer.
 */
import { getState, setState } from './db.js';
import { probeSource, registerConnectionRecipe, type ApiRequestInit } from './network.js';
import {
  runConnectionLoop, learnedRecipe, recipeById, selectorVerifier, shouldAutoHeal, autoHealAllowed, forgetRecipe,
  type ConnectionRecipe, type LoopDeps, type LoopReport, type LoopTransport, type RecipeRoute
} from '../worker-src/connection-loop.js';
import { shapeUrl, type UrlShape } from '../worker-src/url-shapes.js';

export { shouldAutoHeal };
/** Drops the remembered recipe for a host so the next run re-learns it from scratch. */
export async function forgetSourceRecipe(url: string): Promise<void> { await forgetRecipe(setState, url); }

async function sourceNetwork(url: string) {
  const { resolveSourceNetwork } = await import('../worker-src/source-network.js');
  const { loadConnections } = await import('./connections.js');
  return resolveSourceNetwork((await getState<any>('settings', {}))?.source, (await loadConnections()).ai.network, url);
}

/** Real transport: one request per attempt, with an optional warm-up of the site root. */
export function sourceTransport(maxBytes = 4_000_000): LoopTransport {
  return async ({ url, route, headers, warm }) => {
    const init = (extra: Record<string, string>): ApiRequestInit =>
      ({ headers: { ...headers, ...extra }, indirect: route === 'worker', directRoute: route === 'direct', noRecipe: true });
    try {
      let extra: Record<string, string> = {};
      if (warm && route === 'direct') {
        const origin = new URL(url).origin + '/';
        const first = await probeSource(origin, init({ referer: origin }), maxBytes).catch(() => null);
        extra = { referer: origin, ...(first?.cookie ? { cookie: first.cookie } : null) };
      }
      return await probeSource(url, init(extra), maxBytes);
    } catch (error) {
      return { status: 0, text: '', url, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

export async function loopDeps(url: string, listSelector?: string): Promise<LoopDeps> {
  const network = await sourceNetwork(url);
  return { transport: sourceTransport(), hasGateway: Boolean(network.workerUrl), allowDirect: network.mode !== 'worker', getState, setState, verify: selectorVerifier(listSelector) };
}

export async function healSourceConnection(url: string, options: { listSelector?: string; maxRounds?: number; startWith?: string } = {}): Promise<LoopReport> {
  return runConnectionLoop(await loopDeps(url, options.listSelector), { url, maxRounds: options.maxRounds, startWith: options.startWith });
}

export type LearnedInit = { recipe: ConnectionRecipe; route: RecipeRoute; headers: Record<string, string>; url: string; shape: UrlShape } | null;

export async function learnedSourceInit(url: string): Promise<LearnedInit> {
  const saved = await learnedRecipe(getState, url);
  const recipe = saved && recipeById(saved.recipe);
  if (!recipe) return null;
  const shape: UrlShape = saved!.shape || recipe.url || 'canonical';
  try {
    const target = new URL(url);
    return { recipe, route: recipe.route, headers: recipe.headers(target), url: shapeUrl(target.href, shape), shape };
  } catch { return null; }
}

export async function autoHeal(url: string, message: string, listSelector?: string): Promise<LearnedInit> {
  if (!shouldAutoHeal(message)) return null;
  if (!(await autoHealAllowed({ getState, setState }, url))) return null;
  const report = await healSourceConnection(url, { listSelector });
  return report.ok ? learnedSourceInit(url) : null;
}

// Installs the feedback loop into every source fetch of this runtime: replay the learned
// shape, and heal once when a fetch fails in a block-shaped way.
registerConnectionRecipe({
  learned: async url => {
    const learned = await learnedSourceInit(url);
    return learned ? { headers: learned.headers, route: learned.route, url: learned.url } : null;
  },
  heal: async (url, message) => {
    const healed = await autoHeal(url, message);
    return healed ? { headers: healed.headers, route: healed.route, url: healed.url } : null;
  }
});
