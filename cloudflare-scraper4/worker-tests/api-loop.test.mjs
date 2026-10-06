// Destination API feedback loop: sending to Basalam answered «404» because the gateway edits
// a product by its own id (PATCH /v1/products/{id}) while the sender kept using the old
// vendor-scoped path. The loop must try a shape, read the answer, pick the next shape, learn
// the winner — and tell the difference between «this endpoint moved» and «this product id is
// gone». Reproduced offline with a scripted Basalam, no network at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(root, 'node_modules/.cache/api-loop-'));
await build({ entryPoints: [join(root, 'worker-src/api-loop.ts')], outfile: join(temp, 'api-loop.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const loop = await import(pathToFileURL(join(temp, 'api-loop.mjs')));
const read = file => readFile(join(root, file), 'utf8');

function stateBag(initial = []) {
  const state = new Map(initial);
  return {
    state,
    getState: async (key, fallback) => (state.has(key) ? state.get(key) : fallback),
    setState: async (key, value) => void state.set(key, value)
  };
}

/** Scripted Basalam: the answer depends on the exact path, like the real gateway. */
function basalam(answer) {
  const seen = [];
  return {
    seen,
    transport: async ({ url, method, shape }) => {
      seen.push({ url, method, shape });
      return answer({ url, method, shape, round: seen.length });
    }
  };
}

const CONTEXT = { base: 'https://openapi.basalam.com/v1', vendorId: 55, productId: 9091 };

test('the configured API base is repaired before any shape is built', () => {
  assert.equal(loop.normalizeApiBase('https://openapi.basalam.com/v1/'), 'https://openapi.basalam.com/v1');
  assert.equal(loop.normalizeApiBase(''), 'https://openapi.basalam.com/v1');
  assert.equal(loop.normalizeApiBase('https://openapi.basalam.com'), 'https://openapi.basalam.com/v1', 'a base without the version segment 404s everything');
  assert.equal(loop.normalizeApiBase('http://192.0.2.1/v1'), 'http://192.0.2.1/v1', 'a custom base is kept as written');
  assert.equal(loop.normalizeApiBase('not a url'), 'https://openapi.basalam.com/v1');
});

test('the write shapes put the documented gateway path first and never ask the same address twice', () => {
  const update = loop.basalamWriteShapes('update', CONTEXT);
  assert.deepEqual(update.map(shape => shape.url), [
    'https://openapi.basalam.com/v1/products/9091',
    'https://openapi.basalam.com/v1/vendors/55/products/9091',
    'https://core.basalam.com/v4/products/9091'
  ], 'the gateway shape (no vendor) is the documented one, the vendor path is the legacy fallback');
  assert.ok(update.every(shape => shape.method === 'PATCH'));
  const create = loop.basalamWriteShapes('create', CONTEXT);
  assert.deepEqual(create.map(shape => shape.url), [
    'https://openapi.basalam.com/v1/vendors/55/products',
    'https://core.basalam.com/v4/vendors/55/products'
  ], 'creating still belongs to the vendor; the gateway duplicate is collapsed');
  assert.ok(create.every(shape => shape.method === 'POST'));
  const custom = loop.basalamWriteShapes('update', { ...CONTEXT, base: 'http://192.0.2.1/v1' });
  assert.equal(custom.length, 4, 'a custom base adds its own two shapes beside the official ones');
  assert.equal(custom[0].url, 'http://192.0.2.1/v1/products/9091');
});

test('each answer becomes the verdict that decides the next move', () => {
  assert.equal(loop.classifyApiAnswer({ status: 404, body: { message: 'Not Found' } }).verdict, 'path');
  assert.equal(loop.classifyApiAnswer({ status: 405 }).verdict, 'path');
  assert.equal(loop.classifyApiAnswer({ status: 401 }).verdict, 'auth');
  assert.equal(loop.classifyApiAnswer({ status: 403 }).verdict, 'scope');
  assert.equal(loop.classifyApiAnswer({ status: 422, body: { message: 'شناسه تصویر الزامی است' } }).verdict, 'payload');
  assert.equal(loop.classifyApiAnswer({ status: 429 }).verdict, 'throttled');
  assert.equal(loop.classifyApiAnswer({ status: 502 }).verdict, 'server');
  assert.equal(loop.classifyApiAnswer({ error: 'fetch failed' }).verdict, 'network');
  assert.equal(loop.classifyApiAnswer({ status: 200, body: { id: 1 } }).verdict, 'ok');
  assert.equal(loop.classifyApiAnswer({ status: 201, body: { id: 1 } }).verdict, 'ok');
});

test('a 404 on the legacy path is healed by the gateway shape, and the winner is remembered', async () => {
  const bag = stateBag();
  // The real failure the user hit: the vendor-scoped edit is gone, the product id is fine.
  const api = basalam(({ url }) => url.includes('/vendors/')
    ? { status: 404, body: { message: 'Not Found' } }
    : { status: 200, body: { id: 9091 } });
  const report = await loop.runApiWriteLoop({ ...bag, transport: api.transport, sleep: async () => {} },
    { kind: 'update', context: CONTEXT });
  assert.equal(report.ok, true);
  assert.equal(report.shape, 'update-base-product');
  assert.equal(report.attempts.length, 1, 'the documented shape is tried first, so one request is enough');
  assert.equal(report.body.id, 9091);
  assert.equal(bag.state.get('api.shape:basalam:update').shape, 'update-base-product');

  // Second send: the learned shape is used straight away, with no research cost.
  const again = basalam(() => ({ status: 200, body: { id: 9091 } }));
  const second = await loop.runApiWriteLoop({ ...bag, transport: again.transport }, { kind: 'update', context: CONTEXT });
  assert.equal(second.attempts.length, 1);
  assert.equal(again.seen[0].url, 'https://openapi.basalam.com/v1/products/9091');
});

test('a base that lost its version segment is repaired instead of 404ing forever', async () => {
  const bag = stateBag();
  const api = basalam(({ url }) => (url.startsWith('https://openapi.basalam.com/v1/') ? { status: 201, body: { id: 7 } } : { status: 404, body: {} }));
  const report = await loop.runApiWriteLoop({ ...bag, transport: api.transport }, { kind: 'create', context: { base: 'https://openapi.basalam.com', vendorId: 55 } });
  assert.equal(report.ok, true);
  assert.equal(api.seen[0].url, 'https://openapi.basalam.com/v1/vendors/55/products');
});

test('when every known update shape answers 404 the verdict is the product id, not the endpoint', async () => {
  const bag = stateBag();
  const api = basalam(() => ({ status: 404, body: { message: 'product not found' } }));
  const report = await loop.runApiWriteLoop({ ...bag, transport: api.transport, sleep: async () => {} },
    { kind: 'update', context: { ...CONTEXT, base: 'http://192.0.2.1/v1' } });
  assert.equal(report.ok, false);
  assert.equal(report.retryAsCreate, true, 'the sender must build the product again instead of editing a dead id');
  assert.equal(report.learned, false);
  assert.match(report.advice, /حذف شده/);
  assert.equal(report.attempts.length, 4, 'every shape is asked before blaming the id');
  // A create that fails everywhere means something else entirely: the base address.
  const create = await loop.runApiWriteLoop({ ...stateBag(), transport: basalam(() => ({ status: 404, body: {} })).transport },
    { kind: 'create', context: CONTEXT });
  assert.equal(create.retryAsCreate, false);
  assert.match(create.advice, /openapi\.basalam\.com\/v1/);
});

test('an answer about us stops the loop at once instead of spraying the other addresses', async () => {
  for (const [status, expected, advice] of [[401, 'auth', /توکن تازه/], [403, 'scope', /vendor\.product\.write/], [422, 'payload', /محتوای خود محصول/]]) {
    const bag = stateBag();
    const api = basalam(() => ({ status, body: { message: 'نه' } }));
    const report = await loop.runApiWriteLoop({ ...bag, transport: api.transport }, { kind: 'update', context: CONTEXT });
    assert.equal(report.ok, false);
    assert.equal(report.verdict, expected);
    assert.equal(api.seen.length, 1, `HTTP ${status} is about the caller, so a second address answers nothing`);
    assert.match(report.advice, advice);
    assert.equal(report.body.message, 'نه', 'the destination\u2019s own words survive into the report');
    assert.equal(bag.state.get('api.shape:basalam:update'), undefined, 'a failure is never learned');
  }
});

test('429 and 5xx are the only answers that repeat the same address', async () => {
  const waits = [];
  const bag = stateBag();
  const throttled = basalam(({ round }) => (round < 3 ? { status: 429, body: {} } : { status: 200, body: { id: 5 } }));
  const report = await loop.runApiWriteLoop({ ...bag, transport: throttled.transport, sleep: async ms => void waits.push(ms) },
    { kind: 'update', context: CONTEXT });
  assert.equal(report.ok, true);
  assert.deepEqual(throttled.seen.map(call => call.url), Array(3).fill('https://openapi.basalam.com/v1/products/9091'));
  assert.deepEqual(waits, [1500, 3000], 'the wait grows instead of hammering');

  const flaky = basalam(({ round }) => (round === 1 ? { status: 503, body: {} } : { status: 200, body: { id: 5 } }));
  const second = await loop.runApiWriteLoop({ ...stateBag(), transport: flaky.transport, sleep: async () => {} },
    { kind: 'update', context: CONTEXT });
  assert.equal(second.ok, true);
  assert.equal(flaky.seen.length, 2);
  assert.equal(flaky.seen[1].url, flaky.seen[0].url, 'a 5xx is retried on the same address, once');
});

test('the attempt table is the diagnosis: every answer is reported, and the last report is stored', async () => {
  const bag = stateBag();
  const api = basalam(({ url }) => (url.includes('core.basalam.com') ? { status: 200, body: { id: 3 } } : { status: 404, body: {} }));
  const report = await loop.runApiWriteLoop({ ...bag, transport: api.transport }, { kind: 'update', context: CONTEXT });
  assert.equal(report.ok, true);
  assert.equal(report.attempts.length, 3);
  assert.equal(loop.summarizeApiAttempts(report.attempts),
    'PATCH /v1/products/9091 → 404 | PATCH /v1/vendors/55/products/9091 → 404 | PATCH /v4/products/9091 → 200');
  const stored = bag.state.get('api.loop:basalam:update');
  assert.equal(stored.ok, true);
  assert.equal(stored.attempts.length, 3);
});

test('both runtimes send Basalam through the loop — and neither keeps the bare vendor-scoped write', async () => {
  for (const file of ['worker-src/sync.ts', 'render-src/sync.ts']) {
    const source = await read(file);
    const sender = source.slice(source.indexOf('async function sendBasalamWithApi('), source.indexOf('export async function syncBasalam('));
    assert.match(sender, /runApiWriteLoop\(/, `${file} must send through the feedback loop`);
    assert.match(sender, /normalizeApiBase\(/, `${file} must repair the configured base first`);
    assert.match(sender, /report\.retryAsCreate/, `${file} must rebuild a product whose remote id is gone`);
    assert.match(sender, /حلقهٔ بازخورد ارسال/, `${file} must report the loop's diagnosis to the user`);
    assert.doesNotMatch(sender, /\$\{base\}\/\$\{existing\}/, `${file} must not keep the single hard-coded edit address`);
  }
  for (const file of ['worker-src/maintenance.ts', 'render-src/maintenance.ts']) {
    const source = await read(file);
    const updater = source.slice(source.indexOf('async function rawbasalamUpdateShop('));
    assert.match(updater.slice(0, 1400), /runApiWriteLoop\(/, `${file} must edit through the same loop`);
  }
});
