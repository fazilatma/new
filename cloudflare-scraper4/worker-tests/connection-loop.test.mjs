// Connection feedback loop: a source that answers 403 must be healed by the loop itself —
// try a shape, read the answer, let the answer pick the next shape, verify real content,
// remember the winner for that host. Reproduced offline with a scripted transport that
// behaves like emalls.ir did (403 to the bare request, challenge page to cosmetics only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(root, 'node_modules/.cache/conn-loop-'));
async function load(entry, outfile) {
  await build({ entryPoints: [join(root, entry)], outfile: join(temp, outfile), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(temp, outfile)));
}
const loop = await load('worker-src/connection-loop.ts', 'loop.mjs');

const PAGE = '<html><body><main>' + '<div class="product-card"><h2>کفش زنانه</h2><span class="price">۱٬۲۵۰٬۰۰۰ تومان</span></div>'.repeat(12) + '</main></body></html>';
const CHALLENGE = '<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></body></html>';
const DENIED = '<html><body><h1>403 Forbidden</h1></body></html>';

function stateBag(initial = []) {
  const state = new Map(initial);
  return {
    state,
    getState: async (key, fallback) => (state.has(key) ? state.get(key) : fallback),
    setState: async (key, value) => void state.set(key, value)
  };
}

/** Scripted source: answers depend on the request shape, like a real WAF. */
function source(rules) {
  const seen = [];
  const transport = async ({ url, route, headers, warm }) => {
    seen.push({ url, route, headers, warm });
    const answer = rules({ route, headers, warm, round: seen.length });
    return { status: 200, text: PAGE, url, ...answer };
  };
  return { transport, seen };
}

test('classifyAttempt turns each kind of answer into the verdict that drives the next move', () => {
  assert.equal(loop.classifyAttempt({ status: 403, text: DENIED }).verdict, 'forbidden');
  assert.equal(loop.classifyAttempt({ status: 200, text: CHALLENGE }).verdict, 'challenge');
  assert.equal(loop.classifyAttempt({ status: 503, text: CHALLENGE }).verdict, 'challenge', 'a challenge wins over the status code');
  assert.equal(loop.classifyAttempt({ status: 429, text: '' }).verdict, 'throttled');
  assert.equal(loop.classifyAttempt({ status: 502, text: 'bad gateway' }).verdict, 'server');
  assert.equal(loop.classifyAttempt({ status: 200, text: '' }).verdict, 'empty');
  assert.equal(loop.classifyAttempt({ error: 'fetch failed' }).verdict, 'network');
  assert.equal(loop.classifyAttempt({ status: 200, text: PAGE }).verdict, 'ok');
});

test('planNext answers the verdict, not the table order: a challenge leaves the direct route at once', () => {
  const next = loop.planNext('challenge', ['direct'], { hasGateway: true });
  assert.equal(next.route, 'worker', 'header cosmetics cannot solve an IP level challenge');
  const cheap = loop.planNext('forbidden', ['direct'], { hasGateway: true });
  assert.equal(cheap.id, 'direct-referer', 'a plain 403 is worth a cheap header retry first');
  assert.equal(loop.planNext('challenge', ['direct'], { hasGateway: false }).route, 'direct', 'without a gateway the loop never plans an impossible attempt');
  const exhausted = loop.planNext('forbidden', loop.CONNECTION_RECIPES.map(r => r.id), { hasGateway: true });
  assert.equal(exhausted, null, 'the loop stops instead of looping forever');
});

test('403 then challenge then success: the loop heals the connection and names the winner', async () => {
  const bag = stateBag();
  const src = source(({ route, headers }) => {
    if (route === 'worker') return { status: 200, text: PAGE };
    if (!headers.referer) return { status: 403, text: DENIED };
    return { status: 403, text: CHALLENGE };
  });
  const report = await loop.runConnectionLoop({ ...bag, transport: src.transport, hasGateway: true, sleep: async () => {} },
    { url: 'https://emalls.ir/جستجو/کفش-زنانه' });
  assert.equal(report.ok, true);
  assert.equal(report.route, 'worker');
  assert.deepEqual(report.attempts.map(a => a.verdict), ['forbidden', 'challenge', 'ok']);
  assert.ok(report.attempts.every(a => a.label && a.note), 'every attempt is explained in the report');
  assert.match(report.advice, /این روش جواب داد/);
});

test('the winning recipe is remembered per host and read back for the next run', async () => {
  const bag = stateBag();
  const src = source(({ headers }) => (headers.referer ? { status: 200, text: PAGE } : { status: 403, text: DENIED }));
  const report = await loop.runConnectionLoop({ ...bag, transport: src.transport, hasGateway: false }, { url: 'https://emalls.ir/x' });
  assert.equal(report.recipe, 'direct-referer');
  assert.equal(bag.state.get('net.recipe:emalls.ir').recipe, 'direct-referer');
  const learned = await loop.learnedRecipe(bag.getState, 'https://emalls.ir/another/page');
  assert.equal(learned.recipe, 'direct-referer', 'the lesson belongs to the host, not the single URL');
  await loop.forgetRecipe(bag.setState, 'https://emalls.ir/x');
  assert.equal(await loop.learnedRecipe(bag.getState, 'https://emalls.ir/x'), null);
});

test('a learned recipe is used as the first attempt so healed hosts cost one request', async () => {
  const bag = stateBag();
  const src = source(({ headers }) => (headers.referer ? { status: 200, text: PAGE } : { status: 403, text: DENIED }));
  const report = await loop.runConnectionLoop({ ...bag, transport: src.transport, hasGateway: false },
    { url: 'https://emalls.ir/x', startWith: 'direct-referer' });
  assert.equal(report.attempts.length, 1);
  assert.equal(report.ok, true);
});

test('200 with the wrong content is a selector problem, not a connection problem', async () => {
  const bag = stateBag();
  const src = source(() => ({ status: 200, text: PAGE }));
  const report = await loop.runConnectionLoop({
    ...bag, transport: src.transport, hasGateway: false,
    verify: () => ({ ok: false, note: 'سلکتور فهرست هیچ محصولی پیدا نکرد.' })
  }, { url: 'https://emalls.ir/x', maxRounds: 3 });
  assert.equal(report.ok, false);
  assert.ok(report.attempts.every(a => a.verdict === 'mismatch'));
  assert.match(report.advice, /سلکتور/);
  assert.equal(bag.state.has('net.recipe:emalls.ir'), false, 'a wrong page never teaches a recipe');
});

test('429 waits and retries the same shape instead of burning the recipe pool', async () => {
  const bag = stateBag();
  const waits = [];
  let hits = 0;
  const src = source(() => (++hits < 3 ? { status: 429, text: '' } : { status: 200, text: PAGE }));
  const report = await loop.runConnectionLoop({ ...bag, transport: src.transport, hasGateway: false, sleep: async ms => void waits.push(ms) },
    { url: 'https://emalls.ir/x' });
  assert.equal(report.ok, true);
  assert.equal(report.recipe, 'direct', 'same recipe, just later');
  assert.deepEqual(waits, [1500, 3000], 'the wait grows between retries');
});

test('when everything fails the report still diagnoses the block and says what to configure', async () => {
  const bag = stateBag();
  const src = source(() => ({ status: 403, text: CHALLENGE }));
  const report = await loop.runConnectionLoop({ ...bag, transport: src.transport, hasGateway: false, sleep: async () => {} },
    { url: 'https://emalls.ir/x' });
  assert.equal(report.ok, false);
  assert.equal(report.recipe, null);
  assert.ok(report.attempts.length >= 5, 'it really tried every direct shape');
  assert.equal(new Set(report.attempts.map(a => a.recipe)).size, report.attempts.length, 'no shape is tried twice');
  assert.ok(report.attempts.every(a => a.route === 'direct'), 'worker shapes are skipped with no gateway configured');
  assert.match(report.advice, /Worker واسط/);
});

test('an indirect-only installation never plans a direct request', async () => {
  const bag = stateBag();
  const src = source(() => ({ status: 403, text: DENIED }));
  const report = await loop.runConnectionLoop({ ...bag, transport: src.transport, hasGateway: true, allowDirect: false, sleep: async () => {} },
    { url: 'https://emalls.ir/x' });
  assert.equal(report.ok, false);
  assert.ok(report.attempts.length >= 2);
  assert.ok(report.attempts.every(a => a.route === 'worker'), 'mode «worker» must never leak the server IP to the source');
  assert.equal(loop.planNext('forbidden', [], { hasGateway: true, allowDirect: false }).route, 'worker');
});

test('auto healing only fires for block shaped failures and respects a cooldown', async () => {
  assert.equal(loop.shouldAutoHeal('HTTP 403 from https://emalls.ir'), true);
  assert.equal(loop.shouldAutoHeal('صفحهٔ ضدربات/چالش به‌جای محتوای محصول دریافت شد'), true);
  assert.equal(loop.shouldAutoHeal('HTTP 404 from https://emalls.ir'), false);
  assert.equal(loop.shouldAutoHeal('HTTP 403 from https://emalls.ir (route: worker, attempts: 403 → 403); …'), false,
    'the gateway already tried both worker shapes — repeating them heals nothing');
  const bag = stateBag();
  assert.equal(await loop.autoHealAllowed(bag, 'https://emalls.ir/x', 1_000_000), true);
  assert.equal(await loop.autoHealAllowed(bag, 'https://emalls.ir/y', 1_000_050), false, 'one heal per host per cooldown');
  assert.equal(await loop.autoHealAllowed(bag, 'https://emalls.ir/y', 1_000_000 + loop.AUTO_HEAL_COOLDOWN_MS + 1), true);
});

test('every recipe produces header maps that are safe to send as is', () => {
  const target = new URL('https://emalls.ir/جستجو/کفش');
  for (const recipe of loop.CONNECTION_RECIPES) {
    const headers = recipe.headers(target);
    assert.equal(typeof headers, 'object');
    for (const [key, value] of Object.entries(headers)) {
      assert.equal(key, key.toLowerCase(), 'header names stay lower case for both runtimes');
      assert.equal(typeof value, 'string');
      assert.ok(!/[\r\n]/.test(value), 'no header injection');
    }
  }
  assert.ok(loop.CONNECTION_RECIPES.some(r => r.warm), 'at least one recipe warms the site root first');
});

test('selector signals decide whether a 200 is really the product list', () => {
  assert.equal(loop.pageMatchesSelector(PAGE, '.product-card'), true);
  assert.equal(loop.pageMatchesSelector(PAGE, '.product-card .price'), true);
  assert.equal(loop.pageMatchesSelector(PAGE, '.grid-item'), false);
  assert.equal(loop.pageMatchesSelector(PAGE, '#results .product-card'), false, 'every signal of the first part must be present');
  assert.equal(loop.pageMatchesSelector(PAGE, 'main'), true, 'a tag-only selector still has a signal');
  assert.equal(loop.pageMatchesSelector(CHALLENGE, '.product-card'), false);
  assert.equal(loop.pageMatchesSelector(PAGE, ''), true, 'no selector configured means no content opinion');
  const verify = loop.selectorVerifier('.product-card');
  assert.equal(verify({ text: PAGE, url: 'x' }).ok, true);
  assert.equal(verify({ text: CHALLENGE, url: 'x' }).ok, false);
  assert.equal(loop.selectorVerifier('   '), undefined);
});

test('both twins expose the loop and the panel can run it (deployer page contract pins)', async () => {
  const read = name => readFile(join(root, name), 'utf8');
  const [workerApp, renderServer, dashboard, workerScraper, renderNetwork] = await Promise.all(
    ['worker-src/app.ts', 'render-src/server.ts', 'worker-src/dashboard.ts', 'worker-src/scraper.ts', 'render-src/network.ts'].map(read));
  for (const [name, text] of [['worker', workerApp], ['render', renderServer]]) {
    assert.ok(text.includes("'/api/source/connection-loop'"), `${name} twin serves the loop endpoint`);
    assert.ok(text.includes("'/api/source/connection-recipe/forget'"), `${name} twin can forget a learned recipe`);
    assert.ok(text.includes('healSourceConnection'), `${name} twin calls the shared loop`);
  }
  assert.ok(dashboard.includes("'source-loop'"), 'the panel has a button action for the loop');
  assert.ok(dashboard.includes('حلقهٔ بازخورد اتصال'), 'the button is labelled in Persian');
  assert.ok(dashboard.includes('function openLoopModal'), 'the attempt table has a renderer');
  assert.ok(workerScraper.includes('autoHeal('), 'the worker fetch path heals itself');
  assert.ok(renderNetwork.includes('registerConnectionRecipe'), 'the node fetch path replays the learned recipe');
});

test.after(() => rm(temp, { recursive: true, force: true }));
