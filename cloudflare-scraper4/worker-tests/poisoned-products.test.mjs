import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dashboard = await readFile(join(ROOT, 'worker-src', 'dashboard.ts'), 'utf8');

// The renderer is plain single-line functions inside the dashboard source:
// slice them out and execute the real code against hostile payloads.
function extractFunction(name) {
  const start = dashboard.indexOf(name);
  assert.ok(start >= 0, `${name} must exist in the dashboard`);
  return dashboard.slice(start, dashboard.indexOf('\n', start));
}

const clientSource = [
  'function esc(', 'function fa(', 'function productSuffixFormats(', 'function productCodeSuffix(',
  'function destinationPrice(', 'function basalamAccountsForPricing(', 'function headlineFinalPrice(',
  'function productRowHtml(', 'async function loadProducts(){'
].map(extractFunction).join('\n');

function makeClient(payload) {
  const elements = {
    productProfile: { value: 'p1' }, productSearch: { value: '' }, loadProducts: {},
    productCount: { textContent: '' }, statProducts: { textContent: '' },
    productBadge: { hidden: true, textContent: '' }, products: { innerHTML: 'STALE' }
  };
  const notices = [];
  const factory = new Function('$', 'state', 'api', 'notice', 'busy', 'activateProfile',
    `${clientSource}\nreturn { loadProducts };`);
  const client = factory(
    id => elements[id] ?? null,
    { productRows: [], profiles: [], connections: {}, settings: {} },
    async () => payload,
    (message, kind) => notices.push([message, kind]),
    () => {}, () => {}
  );
  return { client, elements, notices };
}

test('results page renders good rows when the payload hides poisoned rows', async () => {
  const good = { sourceKey: 'g1', title: 'Good Product', price: 25000, url: 'https://x.test/p', image: 'https://x.test/i.jpg', sku: 'S1' };
  const { client, elements, notices } = makeClient({ ok: true, total: 3, products: [good, null, undefined] });
  await client.loadProducts();
  assert.equal(notices.length, 0, `no error toast may fire, got ${JSON.stringify(notices)}`);
  assert.match(elements.products.innerHTML, /Good Product/, 'the good row must render');
  assert.match(elements.products.innerHTML, /<article/, 'rows must render as articles');
  assert.doesNotMatch(elements.products.innerHTML, /STALE/, 'the stale list must be replaced');
});

test('results page still shows its empty state when every row is poisoned', async () => {
  const { client, elements, notices } = makeClient({ ok: true, total: 2, products: [null, 'null'] });
  await client.loadProducts();
  assert.equal(notices.length, 0, `no error toast may fire, got ${JSON.stringify(notices)}`);
  assert.match(elements.products.innerHTML, /محصولی یافت نشد/, 'the empty state must render instead of dying');
});

test('both runtimes refuse to store and serve poisoned product rows', async () => {
  for (const file of ['worker-src/db.ts', 'render-src/db.ts']) {
    const src = await readFile(join(ROOT, file), 'utf8');
    assert.ok(src.includes('upsertProduct refused a non-object product'), `${file} must guard writes`);
    assert.ok(src.includes('validProductRow'), `${file} must filter reads`);
    assert.ok(src.includes('data IS NOT NULL AND data'), `${file} must exclude poison from the SQL itself`);
  }
  assert.ok(dashboard.includes("(data.products||[]).filter(p=>p&&typeof p==='object')"), 'loadProducts must drop poisoned rows before rendering');
});
