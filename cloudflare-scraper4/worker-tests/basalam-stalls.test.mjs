// New Basalam stalls («غرفه‌ها») must appear everywhere at once: as a row in the product modal
// of the results tab, and as a real send target. Before 1.329.0 a stall could be registered and
// then quietly do nothing — the sender dropped anything it did not like without a word, and the
// modal built its own list from the copy of the connections the page happened to load at boot.
// These tests run the real sender and the real panel functions offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
async function compile(source, names, io = {}) {
  const js = (await transform(source.replace(/^import .*;\s*$/gm, '').replaceAll('export ', ''), { loader: 'ts' })).code;
  return new Function(...Object.keys(io), js + ';return {' + names + '};')(...Object.values(io));
}

const accountsSource = await read('worker-src/basalam-accounts.ts');
const accounts = await compile(accountsSource, 'basalamStalls,sendableStalls,noStallReason,destinationRows');

const vault = (over = {}) => ({
  token: 'default-token', vendorId: '55', pricePercent: 5, fallbackCategoryIds: [], categoryId: 0,
  shops: [{ name: 'غرفهٔ دوم', token: 'second-token', vendorId: '66', pricePercent: 12 }], ...over
});

test('every registered stall is listed, and the ones that cannot receive a product say why', () => {
  const list = accounts.basalamStalls(vault({
    shops: [
      { name: 'غرفهٔ دوم', token: 'second-token', vendorId: '66', pricePercent: 12 },
      { name: 'غرفهٔ بی‌توکن', vendorId: '77' },
      { name: 'ناقص' },
      { name: 'تکراری', token: 'x', vendorId: '66' }
    ]
  }));
  assert.deepEqual(list.map(stall => stall.name), ['پیش‌فرض', 'غرفهٔ دوم', 'غرفهٔ بی‌توکن', 'ناقص', 'تکراری']);
  assert.deepEqual(list.map(stall => stall.ready), [true, true, true, false, false]);
  assert.equal(list[0].key, '55');
  assert.equal(list[1].pricePercent, 12);
  // A stall of the same account may be registered without repeating the token.
  assert.equal(list[2].token, 'default-token');
  assert.equal(list[2].tokenSource, 'default');
  assert.match(list[3].reason, /Vendor ID/);
  assert.match(list[4].reason, /تکراری/);
  assert.deepEqual(accounts.sendableStalls(list).map(stall => stall.vendorId), ['55', '66', '77']);
});

test('a stall with no default token to borrow is reported instead of being dropped', () => {
  const list = accounts.basalamStalls({ shops: [{ name: 'تنها', vendorId: '90' }] });
  assert.equal(list.length, 1);
  assert.equal(list[0].ready, false);
  assert.match(list[0].reason, /توکن/);
  assert.match(accounts.noStallReason(list), /هیچ‌کدام/);
  assert.match(accounts.noStallReason([]), /هیچ غرفه‌ای/);
});

test('the destination rows carry every stall, its send status, and never a token', async () => {
  const stored = new Map([['basalam:55', '9091'], ['woo:default', 42]]);
  const rows = await accounts.destinationRows(
    { woo: { url: 'https://shop.test', key: 'k', secret: 's', pricePercent: 10 }, basalam: vault({ shops: [
      { name: 'غرفهٔ دوم', token: 'second-token', vendorId: '66', pricePercent: 12 },
      { name: 'ناقص' }
    ] }) },
    async (target, key) => stored.get(target + ':' + key) ?? null
  );
  assert.deepEqual(rows.map(row => row.label), ['ووکامرس', 'باسلام — غرفهٔ پیش‌فرض', 'باسلام — غرفهٔ دوم', 'باسلام — ناقص']);
  assert.deepEqual(rows.map(row => row.remoteId), [42, '9091', null, null]);
  assert.deepEqual(rows.map(row => row.toRial), [false, true, true, true]);
  assert.equal(rows[2].ready, true, 'a stall with no product yet is still ready to receive one');
  assert.equal(rows[3].ready, false);
  assert.doesNotMatch(JSON.stringify(rows), /default-token|second-token/, 'tokens must never reach the panel');
  const noWoo = await accounts.destinationRows({ woo: {}, basalam: {} }, async () => null);
  assert.equal(noWoo[0].ready, false);
  assert.match(noWoo[0].reason, /ووکامرس/);
  assert.equal(noWoo.length, 1, 'with nothing configured only the WooCommerce row explains itself');
});

/** The real sender, sliced out of the worker twin and run against a scripted Basalam. */
async function sender(connections, io = {}) {
  const source = await read('worker-src/sync.ts');
  const slice = source.slice(source.indexOf('function basalamPrice('));
  const calls = [];
  const state = new Map();
  const remote = new Map();
  const loop = await compile(await read('worker-src/api-loop.ts'), 'normalizeApiBase,runApiWriteLoop,summarizeApiAttempts');
  const api = await compile(accountsSource, 'basalamStalls,sendableStalls,noStallReason');
  const module = await compile(slice, 'syncBasalam', {
    ...loop, ...api,
    loadConnections: async () => ({ basalam: connections }),
    findLearnedCategory: async () => null,
    getDestinationId: async (profileId, sourceKey, target, key) => remote.get(key) ?? null,
    getRemoteId: async () => null,
    setDestinationId: async (profileId, sourceKey, target, key, id) => void remote.set(key, id),
    setRemoteId: async () => {},
    getState: async (key, fallback) => (state.has(key) ? state.get(key) : fallback),
    setState: async (key, value) => void state.set(key, value),
    destinationScope: async (target, key) => target + ':' + key,
    desiredProduct: () => ({}),
    destinationLedger: { find: async () => null, matches: async () => false, invalidate: async () => {}, confirm: async () => {} },
    safeBasalamFetch: async (url, options) => {
      calls.push({ url, method: String(options?.method || 'GET'), auth: String(options?.headers?.authorization || '') });
      return new Response(JSON.stringify({ id: 500 + calls.length }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    safeFetch: async () => new Response('', { status: 404 }),
    toRemoteId: value => (value == null ? null : value),
    ...io
  });
  return { syncBasalam: module.syncBasalam, calls, remote };
}

const product = { sourceKey: 's1', title: 'کفش', price: 100000, priceText: '100000 تومان', images: [], stock: 3 };
const profile = { id: 'p1', selectors: {} };

test('a stall registered after the first send receives the product on the very next run', async () => {
  const before = await sender(vault({ shops: [] }));
  await before.syncBasalam(product, profile);
  assert.deepEqual(before.calls.map(call => new URL(call.url).pathname), ['/v1/vendors/55/products']);

  // The user adds a second stall in «اتصال‌ها» — nothing else changes.
  const after = await sender(vault());
  const results = await after.syncBasalam(product, profile);
  assert.deepEqual(after.calls.map(call => new URL(call.url).pathname),
    ['/v1/vendors/55/products', '/v1/vendors/66/products'], 'both stalls must be written to');
  assert.deepEqual(after.calls.map(call => call.auth), ['Bearer default-token', 'Bearer second-token']);
  assert.deepEqual(results.map(row => row.shop), ['پیش‌فرض', 'غرفهٔ دوم']);
  assert.ok(results.every(row => !row.error));
});

test('a stall of the same account needs no second token, and a broken one is reported not skipped', async () => {
  const run = await sender(vault({ shops: [{ name: 'غرفهٔ خواهر', vendorId: '77' }, { name: 'ناقص' }] }));
  const results = await run.syncBasalam(product, profile);
  assert.deepEqual(run.calls.map(call => new URL(call.url).pathname), ['/v1/vendors/55/products', '/v1/vendors/77/products']);
  assert.deepEqual(run.calls.map(call => call.auth), ['Bearer default-token', 'Bearer default-token']);
  const broken = results.find(row => row.shop === 'ناقص');
  assert.ok(broken, 'a stall that cannot be used must still appear in the report');
  assert.match(broken.error, /Vendor ID/);
  assert.deepEqual(results.map(row => row.shop).sort(), ['غرفهٔ خواهر', 'ناقص', 'پیش‌فرض'].sort());
});

test('a send with no usable stall fails with the reason, not a generic sentence', async () => {
  const run = await sender({ token: '', vendorId: '', fallbackCategoryIds: [], shops: [{ name: 'بی‌توکن', vendorId: '12' }] });
  await assert.rejects(() => run.syncBasalam(product, profile), /بی‌توکن/);
  assert.equal(run.calls.length, 0);
});

/** The panel side: the product modal table and its live refresh from the server. */
async function panel(serverAccounts) {
  const dashboard = await read('worker-src/dashboard.ts');
  const start = dashboard.indexOf('function pdestStatusCell(');
  const end = dashboard.indexOf('\n', dashboard.indexOf('function openProductModal('));
  const body = { innerHTML: '', dataset: { sourceKey: 's1' } };
  let modal = '';
  const asked = [];
  const io = {
    $: id => (id === 'pdestBody' ? body : id === 'productProfile' ? { value: 'p1' } : null),
    api: async path => { asked.push(path); return { ok: true, accounts: serverAccounts }; },
    state: { selected: 'p1', profiles: [{ id: 'p1', priceMode: 'percent', priceValue: 20 }], productRows: [{ sourceKey: 's1', title: 'کفش', price: 120000, images: [], resultBase: { price: 100000, priceText: '100000 تومان' } }] },
    allDestinationsForPricing: () => [{ name: 'ووکامرس', percent: 10 }],
    destinationPrice: (base, percentValue, toRial) => Math.round(Number(base) * (1 + Number(percentValue) / 100)) * (toRial ? 10 : 1),
    productCodeSuffix: () => '', headlineFinalPrice: () => 120000, safeProductHtml: String,
    fa: String, esc: String, escAttr: String, modalShell: (_title, html) => { modal = html; }
  };
  const compiled = await compile(dashboard.slice(start, end), 'pdestRowsHtml,loadProductDestinations,openProductModal', io);
  return { ...compiled, body, asked, modal: () => modal };
}

test('the modal asks the server for the destination list and shows every stall with its status', async () => {
  const live = await panel([
    { target: 'woo', label: 'ووکامرس', percent: 10, toRial: false, ready: true, remoteId: 42 },
    { target: 'basalam', label: 'باسلام — غرفهٔ پیش‌فرض', percent: 5, toRial: true, ready: true, remoteId: '9091' },
    { target: 'basalam', label: 'باسلام — غرفهٔ تازه', percent: 12, toRial: true, ready: true, remoteId: null },
    { target: 'basalam', label: 'باسلام — ناقص', percent: 0, toRial: true, ready: false, reason: 'شناسهٔ غرفه وارد نشده است.' }
  ]);
  live.openProductModal('s1');
  const table = live.modal();
  assert.match(table, /وضعیت ارسال/, 'the table gained a send-status column');
  assert.match(table, /id="pdestBody"/);

  await live.loadProductDestinations({ sourceKey: 's1', price: 120000, resultBase: { price: 100000, priceText: '100000 تومان' } });
  // Opening the modal already asks once; this second call simulates the answer arriving.
  assert.ok(live.asked.length >= 1 && live.asked.every(path => path === '/api/products/p1/s1/destinations'));
  const rows = live.body.innerHTML.split('<tr>').slice(1);
  assert.equal(rows.length, 4, 'a stall registered after this page loaded still gets its own row');
  assert.match(rows[1], /ارسال شده · شناسه 9091/);
  assert.match(rows[2], /غرفهٔ تازه/);
  assert.match(rows[2], /هنوز ارسال نشده/);
  assert.match(rows[3], /شناسهٔ غرفه وارد نشده است/, 'a stall that cannot receive the product explains itself in the row');
});

test('a modal that already moved on is never overwritten by a late answer', async () => {
  const live = await panel([{ target: 'woo', label: 'ووکامرس', percent: 10, toRial: false, ready: true, remoteId: 1 }]);
  live.body.dataset.sourceKey = 'other';
  live.body.innerHTML = 'KEEP';
  await live.loadProductDestinations({ sourceKey: 's1', price: 1 });
  assert.equal(live.body.innerHTML, 'KEEP');
});

test('both runtimes serve the destination list and both senders use the shared stall list', async () => {
  for (const file of ['worker-src/app.ts', 'render-src/server.ts']) {
    const source = await read(file);
    assert.match(source, /app\.get\('\/api\/products\/:profileId\/:sourceKey\/destinations'/, `${file} must serve the live destination list`);
    assert.match(source, /destinationRows\(/, `${file} must build it from the shared helper`);
  }
  for (const file of ['worker-src/sync.ts', 'render-src/sync.ts']) {
    const source = await read(file);
    assert.match(source, /sendableStalls\(/, `${file} must send to every usable stall`);
    assert.match(source, /noStallReason\(/, `${file} must explain an empty stall list`);
    assert.doesNotMatch(source, /c\.shops\.filter\(s=>s\.token&&s\.vendorId\)/, `${file} must not drop stalls silently any more`);
  }
  const dashboard = await read('worker-src/dashboard.ts');
  assert.match(dashboard, /loadProductDestinations\(p\)/, 'the modal must refresh its destinations from the server');
});
