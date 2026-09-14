import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * Pure-function tests for the shared destination core. Both runtimes import
 * these helpers (worker-src/maintenance.ts + ai.ts, render-src/maintenance.ts
 * + ai.ts), so every assertion below pins behavior on Cloudflare, Render,
 * Termux, VPS and local installs at once.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-core-'));
await build({ entryPoints: { core: new URL('../worker-src/destination-core.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const core = await import(pathToFileURL(join(temporary, 'core.mjs')));

test('normalizeRefs dedupes mixed id shapes and drops invalid ids', () => {
  assert.deepEqual(core.normalizeRefs([1, '2', { id: 3, shopId: '9' }, { id: '4', shop_id: '8' }, { id: 3, shopId: '9' }, 0, -5, 'abc'], 'dflt'), [
    { id: 1, shopId: 'dflt' }, { id: 2, shopId: 'dflt' }, { id: 3, shopId: '9' }, { id: 4, shopId: '8' },
  ]);
  assert.deepEqual(core.normalizeRefs([], ''), []);
});

test('normalizeCategoryAssignments keys rows by shop:id and skips bad rows', () => {
  const map = core.normalizeCategoryAssignments([
    { id: 1, shopId: 's', categoryId: 100, categoryName: 'عطر', source: 'دستی' },
    { id: '2', category_id: 200 },
    { id: 0, categoryId: 5 }, { id: 3, categoryId: 0 }, null,
  ]);
  assert.equal(map.size, 2);
  assert.deepEqual(map.get('s:1'), { categoryId: 100, categoryName: 'عطر', source: 'دستی' });
  assert.deepEqual(map.get(':2'), { categoryId: 200, categoryName: '', source: '' });
});

test('directPayload maps one edit to Woo fields', () => {
  const current = { title: 'Old', price: 100, category: 'C' };
  assert.deepEqual(core.directPayload('woo', { title: '  New  ', price: 150, stock: 3, categoryId: 7, sku: 'S1' }, current),
    { name: 'New', regular_price: '150', manage_stock: true, stock_quantity: 3, stock_status: 'instock', sku: 'S1', categories: [{ id: 7 }] });
  // Unchanged values produce no keys.
  assert.deepEqual(core.directPayload('woo', { title: 'Old', price: 100 }, current), {});
});

test('directPayload maps one edit to Basalam fields with Rial conversion', () => {
  const payload = core.directPayload('basalam', { title: 'New', price: 150, stock: 0, categoryId: 100, preparation_days: 2, weight: -1 }, { title: 'Old', price: 100, category: 'C' });
  assert.equal(payload.name, 'New');
  assert.equal(payload.primary_price, 1500);
  assert.equal(payload.stock, 0);
  assert.equal(payload.category_id, 100);
  assert.equal(payload.preparation_days, 2);
  assert.ok(!('weight' in payload), 'negative weight is skipped');
  assert.ok(!('sku' in payload), 'sku is Woo-only');
});

test('applyPrice handles set/inc/dec with absolute and percent values', () => {
  assert.equal(core.applyPrice('set', '150', 100), 150);
  assert.equal(core.applyPrice('set', '1,500', 100), 1500);
  assert.equal(core.applyPrice('inc', '10%', 100), 110);
  assert.equal(core.applyPrice('inc', '25', 100), 125);
  assert.equal(core.applyPrice('dec', '10%', 100), 90);
  assert.equal(core.applyPrice('dec', '500', 100), 0, 'price never goes negative');
  assert.equal(core.applyPrice('bogus', '10', 100), null);
  assert.equal(core.applyPrice('inc', 'abc', 100), null);
});

test('bulkPayload builds payload plus a human summary', () => {
  const { payload, summary } = core.bulkPayload('basalam', { price: { op: 'inc', val: '10%' }, categoryId: 100, titlePrefix: 'فروش ویژه ' }, { title: 'عطر', price: 100 });
  assert.equal(payload.primary_price, 1100);
  assert.equal(payload.category_id, 100);
  assert.equal(payload.name, 'فروش ویژه عطر');
  assert.deepEqual(summary, { newPrice: 110, pricePercent: 10, newCategoryId: 100, newTitle: 'فروش ویژه عطر' });
});

test('statusPayload accepts only documented statuses', () => {
  assert.deepEqual(core.statusPayload('woo', 'draft'), { status: 'draft' });
  assert.deepEqual(core.statusPayload('basalam', '3567'), { status: 3567 });
  assert.throws(() => core.statusPayload('woo', '3567'), /وضعیت ووکامرس نامعتبر/);
  assert.throws(() => core.statusPayload('basalam', 'publish'), /وضعیت باسلام نامعتبر/);
});

test('status list maps cover filters, single codes and unknown input', () => {
  assert.deepEqual(core.basalamStatuses('active'), ['2976']);
  assert.deepEqual(core.basalamStatuses('3567'), ['3567']);
  assert.equal(core.basalamStatuses('all').length, 9);
  assert.deepEqual(core.basalamStatuses('xyz'), core.basalamStatuses('all'));
  assert.equal(core.wooListStatus('publish'), 'publish');
  assert.equal(core.wooListStatus('bogus'), 'any');
});

test('selectShops returns everything for all/0/empty and filters otherwise', () => {
  const shops = [{ vendorId: '1', name: 'A' }, { vendorId: '2', name: 'B' }];
  assert.equal(core.selectShops(shops, 'all').length, 2);
  assert.equal(core.selectShops(shops, '').length, 2);
  assert.equal(core.selectShops(shops, '0').length, 2);
  assert.deepEqual(core.selectShops(shops, '2'), [{ vendorId: '2', name: 'B' }]);
  assert.deepEqual(core.selectShops(shops, '9'), []);
});

test('categoryRoots and categoryChildren tolerate every envelope shape', () => {
  assert.deepEqual(core.categoryRoots({ data: { categories: [1] } }), [1]);
  assert.deepEqual(core.categoryRoots({ results: [2] }), [2]);
  assert.deepEqual(core.categoryRoots([3]), [3]);
  assert.deepEqual(core.categoryRoots({}), []);
  assert.deepEqual(core.categoryChildren({ children: [1] }), [1]);
  assert.deepEqual(core.categoryChildren({ subcategories: [2] }), [2]);
  assert.deepEqual(core.categoryChildren({}), []);
});

test('flattenCategoryTree builds leaf-aware paths and skips bad rows', () => {
  const out = [];
  core.flattenCategoryTree([
    { id: 1, name: 'عطر', children: [{ id: 2, title: 'زنانه' }, { id: 0, name: 'بدون شناسه' }, { id: 3, name: '' }] },
    { category_id: 4, label: 'آرایشی', childs: [] },
  ], out, [], 0, null);
  assert.deepEqual(out, [
    { id: 1, name: 'عطر', path: 'عطر', parentId: null, depth: 0, leaf: false },
    { id: 2, name: 'زنانه', path: 'عطر ← زنانه', parentId: 1, depth: 1, leaf: true },
    { id: 4, name: 'آرایشی', path: 'آرایشی', parentId: null, depth: 0, leaf: true },
  ]);
  assert.deepEqual(core.dedupeCategories([...out, { id: 2, name: 'تکراری', path: 'x', parentId: 1, depth: 1, leaf: true }]).map(x => x.id), [1, 2, 4]);
});

test('normalizeRemote maps a Woo row with Toman prices', () => {
  const row = core.normalizeRemote('woo', { id: 5, name: 'Soap', images: [{ src: 'https://x/y.jpg' }], status: 'publish', price: '120', sku: 'S', stock_quantity: 4, categories: [{ id: 9, name: 'بهداشتی' }] }, 'default', 'فروشگاه ووکامرس');
  assert.equal(row.title, 'Soap');
  assert.equal(row.price, 120);
  assert.equal(row.priceRaw, 120);
  assert.equal(row.image, 'https://x/y.jpg');
  assert.equal(row.statusLabel, 'publish');
  assert.equal(row.stock, 4);
  assert.equal(row.categoryId, 9);
  assert.equal(row.category, 'بهداشتی');
  assert.equal(row.shopId, 'default');
});

test('normalizeRemote maps a Basalam row with Rial-to-Toman prices and Persian statuses', () => {
  const row = core.normalizeRemote('basalam', { id: 6, title: 'عطر', photos: ['https://x/p.jpg'], status: '3567', primary_price: 1250001, category_id: 100, revision: { rejection_reasons: [{ name: 'دلیل' }] } }, '55', 'غرفه تست');
  assert.equal(row.title, 'عطر');
  assert.equal(row.price, 125000);
  assert.equal(row.priceRaw, 1250001);
  assert.equal(row.statusLabel, 'تأیید نشده');
  assert.equal(row.categoryId, 100);
  assert.equal(row.image, 'https://x/p.jpg');
  assert.match(row.rejectionReason, /دلیل/);
});

test('rowsFrom, unwrapProduct, numberOrNull and imageValue tolerate envelopes', () => {
  assert.deepEqual(core.rowsFrom({ data: [1] }), [1]);
  assert.deepEqual(core.rowsFrom({ products: [2] }), [2]);
  assert.deepEqual(core.rowsFrom({}), []);
  assert.deepEqual(core.unwrapProduct({ data: { product: { id: 1 } } }), { id: 1 });
  assert.equal(core.numberOrNull('4'), 4);
  assert.equal(core.numberOrNull(''), null);
  assert.equal(core.numberOrNull('abc'), null);
  assert.equal(core.imageValue('https://x/a.jpg'), 'https://x/a.jpg');
  assert.equal(core.imageValue({ sm: 'https://x/s.jpg' }), 'https://x/s.jpg');
  assert.equal(core.imageValue(null), '');
});

test('categoryPrompt ranks title-matching categories first and throws when empty', () => {
  const categories = [
    { id: 1, name: 'لوازم خودرو', path: 'لوازم خودرو', leaf: true },
    { id: 2, name: 'عطر زنانه', path: 'عطر ← زنانه', leaf: true },
  ];
  const { allowed, prompt } = core.categoryPrompt('ادو پرفیوم زنانه', categories);
  assert.equal(allowed[0].id, 2, 'title overlap ranks first');
  assert.match(prompt, /ادو پرفیوم زنانه/);
  assert.match(prompt, /2 \| عطر ← زنانه/);
  assert.throws(() => core.categoryPrompt('x', []), /فهرست معتبر دسته‌بندی/);
});

test('parseCategoryId accepts JSON, fenced, labeled and bare answers', () => {
  const categories = [{ id: 100, name: 'A' }, { id: 200, name: 'B' }];
  assert.equal(core.parseCategoryId('{"category_id":100,"reason":"x"}', categories), 100);
  assert.equal(core.parseCategoryId('```json\n{"categoryId":200}\n```', categories), 200);
  assert.equal(core.parseCategoryId('category_id: 200', categories), 200);
  assert.equal(core.parseCategoryId('200', categories), 200);
  assert.equal(core.parseCategoryId('999', categories), 0, 'unknown ids are rejected');
  assert.equal(core.parseCategoryId('nothing here', categories), 0);
  assert.equal(core.parseCategoryId('100 then 200', categories), 200, 'last valid number wins');
});

test('clamp and msg behave like the Worker originals', () => {
  assert.equal(core.clamp('3', 1, 10, 1), 3);
  assert.equal(core.clamp(99, 1, 10, 1), 10);
  assert.equal(core.clamp('abc', 1, 10, 7), 7);
  assert.equal(core.msg(new Error('boom')), 'boom');
  assert.equal(core.msg('plain'), 'plain');
});

test('normalizeCategoryMode accepts the three vote modes and defaults to ensemble', () => {
  assert.equal(core.normalizeCategoryMode('master'), 'master');
  assert.equal(core.normalizeCategoryMode('master-candidates'), 'master-candidates');
  assert.equal(core.normalizeCategoryMode('ensemble'), 'ensemble');
  assert.equal(core.normalizeCategoryMode('bogus'), 'ensemble');
  assert.equal(core.normalizeCategoryMode(undefined), 'ensemble');
  assert.equal(core.normalizeCategoryMode(''), 'ensemble');
});

test('resolveMasterKey matches full keys and bare model names', () => {
  const configured = ['p1::m1', 'p2::m2'];
  assert.equal(core.resolveMasterKey(configured, 'p1::m1'), 'p1::m1');
  assert.equal(core.resolveMasterKey(configured, 'm2'), 'p2::m2');
  assert.equal(core.resolveMasterKey(configured, 'p9::m9'), null);
  assert.equal(core.resolveMasterKey(configured, ''), null);
  assert.equal(core.resolveMasterKey(configured, null), null);
});

test('selectCategoryModels runs the master alone or fails with guidance', () => {
  const base = { master: 'p1::m1', candidates: ['p1::m2'], configured: ['p1::m1', 'p1::m2', 'p1::m3'], green: ['p1::m1', 'p1::m2', 'p1::m3'] };
  assert.deepEqual(core.selectCategoryModels({ ...base, mode: 'master' }), ['p1::m1']);
  assert.throws(() => core.selectCategoryModels({ ...base, mode: 'master', master: '' }), /مستر انتخاب نشده/);
  assert.throws(() => core.selectCategoryModels({ ...base, mode: 'master', green: ['p1::m2'] }), /آخرین تست/);
});

test('selectCategoryModels backs the master with green candidates, capped at 5', () => {
  const configured = ['m::master', 'c::c1', 'c::c2', 'c::c3', 'c::c4', 'c::c5', 'x::other'];
  assert.deepEqual(core.selectCategoryModels({ mode: 'master-candidates', master: 'm::master', candidates: ['c::c1', 'c::c2', 'c::c3', 'c::c4', 'c::c5'], configured, green: [...configured] }),
    ['m::master', 'c::c1', 'c::c2', 'c::c3', 'c::c4']);
  // Non-candidate green models never join this mode; red candidates are skipped.
  assert.deepEqual(core.selectCategoryModels({ mode: 'master-candidates', master: 'm::master', candidates: ['c::c1', 'c::red'], configured, green: ['m::master', 'c::c1', 'x::other'] }),
    ['m::master', 'c::c1']);
  assert.throws(() => core.selectCategoryModels({ mode: 'master-candidates', master: '', candidates: [], configured, green: [...configured] }), /مستر انتخاب نشده/);
});

test('selectCategoryModels ensemble keeps candidates first across every green model', () => {
  assert.deepEqual(core.selectCategoryModels({ mode: 'ensemble', master: '', candidates: ['p::c2'], configured: ['p::c1', 'p::c2', 'p::c3'], green: new Set(['p::c1', 'p::c2', 'p::c3']) }),
    ['p::c2', 'p::c1', 'p::c3']);
  assert.deepEqual(core.selectCategoryModels({ mode: 'whatever', configured: ['p::a'], green: ['p::a'] }), ['p::a']);
  assert.deepEqual(core.selectCategoryModels({ mode: 'ensemble', configured: ['p::a'], green: [] }), []);
});
