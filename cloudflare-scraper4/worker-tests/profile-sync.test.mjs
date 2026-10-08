// Profile-driven synchronisation (1.342.0), pinned offline for BOTH runtimes.
//
// The request: «دو گزینهٔ ووکامرس/باسلام براساس پروفایل‌های ذخیره‌شده باشند نه دفتر حساب، به نحوی
// که با اضافه شدن محصول استخراج‌شده نسبت به پروفایل ذخیره‌شده ارسال انجام شود؛ اگر قیمت مبدأ
// تغییر کند، تغییر در پروفایل ثبت و در مقصدها اعمال شود؛ و در صورت حذف یا ناموجود شدن در مبدأ،
// محصول از پروفایل و از مقصدها حذف شود.»
//
// The missing half was removal: it used to be decided by the ledger (stale ledger → nothing
// happened), it needed the retirement mode to be set to something other than «فقط گزارش», and it
// never removed the row from the profile itself. A product whose price vanished at the source
// («ناموجود») also voided the whole retirement pass, so that case could never clean up.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';

const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-profile-sync-'));
const bundle = async (source, name) => {
  await build({ entryPoints: [new URL('../' + source, import.meta.url).pathname], outfile: join(temporary, name), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(pathToFileURL(join(temporary, name)));
};
const core = await bundle('worker-src/profile-sync-core.ts', 'profile-sync-core.mjs');
const progress = await bundle('worker-src/recon-progress.ts', 'progress.mjs');

async function compileFn(source, header, names, io) {
  const start = source.indexOf(header);
  assert.ok(start > 0, 'function not found: ' + header);
  const end = source.indexOf('\n}\n', start) + 3;
  const slice = source.slice(start, end);
  const js = (await transform(slice.replace(/^import .*;\s*$/gm, '').replaceAll('export ', ''), { loader: 'ts' })).code;
  return new Function(...Object.keys(io), js + ';return {' + names + '};')(...Object.values(io));
}

const row = (over = {}) => ({ profile_id: 'p1', source_key: 's1', title: 'کفش (کد ۱)', price: 100000, active: true, data: {}, maps: [], ...over });
const accounts = [
  { target: 'woo', accountKey: 'default', name: 'ووکامرس' },
  { target: 'basalam', accountKey: '735703', name: 'غرفهٔ برف باکس' }
];

// ——— the pure planner —————————————————————————————————————————————————————

test('the profile decides who is gone: deleted, out of stock, or price gone', () => {
  assert.equal(core.goneFromSource(row()), '', 'a live product with a price stays');
  assert.equal(core.goneFromSource(row({ active: 0 })), 'missing', 'a complete scan no longer listed it');
  assert.equal(core.goneFromSource(row({ data: { stock: 0 } })), 'outOfStock', 'the source says zero stock');
  assert.equal(core.goneFromSource(row({ price: 0 })), 'noPrice', 'the source stopped publishing a price');
  assert.deepEqual(Object.keys(core.GONE_LABELS), ['missing', 'outOfStock', 'noPrice']);
  assert.equal(core.GONE_LABELS.outOfStock, 'در مبدأ ناموجود شد');
});

test('the remote id comes from the profile map, not from the ledger', () => {
  const mapped = row({ maps: [{ target: 'basalam', account_key: '735703', remote_id: 77 }] });
  assert.equal(core.remoteIdFor(mapped, accounts[1]), '77');
  assert.equal(core.remoteIdFor(mapped, accounts[0]), '', 'nothing was ever published to WooCommerce');
  assert.equal(core.remoteIdFor(row({ remote_woo_id: 12 }), accounts[0]), '12', 'the legacy column still counts');
  assert.equal(core.remoteIdFor(row({ remote_woo_id: 0 }), accounts[0]), '', 'id 0 is not an id');
});

test('every destination a gone product reached is planned for removal, and so is its profile row', () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => row({ source_key: 'alive' + i })),
    row({ source_key: 'gone', title: 'کیف (کد ۲)', active: 0, maps: [{ target: 'woo', account_key: 'default', remote_id: 5 }, { target: 'basalam', account_key: '735703', remote_id: 9 }] }),
    row({ source_key: 'empty', title: 'شال (کد ۳)', data: { stock: 0 } })
  ];
  const plan = core.planProfileRemovals(rows, accounts, { scanComplete: true, profileId: 'p1' });
  assert.equal(plan.blocked, '');
  assert.deepEqual(plan.removals.map(item => item.sourceKey), ['gone', 'empty']);
  assert.deepEqual(plan.removals[0].targets.map(t => t.target + ':' + t.remoteId), ['woo:5', 'basalam:9']);
  assert.deepEqual(plan.removals[1].targets, [], 'a product that was never published is removed from the profile only');
  assert.equal(plan.removals[1].reasonLabel, 'در مبدأ ناموجود شد');
  assert.deepEqual(plan.stats, { rows: 10, alive: 8, gone: 2, missing: 1, outOfStock: 1, noPrice: 0, published: 1, unpublished: 1, percent: 20 });
});

test('the safety rails hold: an incomplete scan, a big share or a big count removes nothing', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({ source_key: 's' + i, active: i < 2 ? 0 : 1 }));
  assert.match(core.planProfileRemovals(rows, accounts, { scanComplete: false }).blocked, /اسکن مبدأ کامل و قابل‌اعتماد نبود/);
  assert.equal(core.planProfileRemovals(rows, accounts, { scanComplete: true }).removals.length, 2, '20٪ is inside the 30٪ default');
  const half = Array.from({ length: 10 }, (_, i) => row({ source_key: 's' + i, active: i < 5 ? 0 : 1 }));
  const blockedByPercent = core.planProfileRemovals(half, accounts, { scanComplete: true });
  assert.match(blockedByPercent.blocked, /۵۰|50/, 'the share is named in the refusal: ' + blockedByPercent.blocked);
  assert.equal(blockedByPercent.removals.length, 0, 'nothing is removed when the share looks like a broken scan');
  const many = Array.from({ length: 200 }, (_, i) => row({ source_key: 's' + i, active: i < 60 ? 0 : 1 }));
  assert.match(core.planProfileRemovals(many, accounts, { scanComplete: true }).blocked, /سقف ایمنی/);
  assert.equal(core.planProfileRemovals(many, accounts, { scanComplete: true, maxCount: 100 }).removals.length, 60, 'a raised cap lets the work through');
});

// ——— the runtime routine, in both twins ——————————————————————————————————————

async function removalRun(runtime, options = {}) {
  const source = await read(runtime + '-src/maintenance.ts');
  const deleted = [], profileDeletes = [], wooUpdates = [], basalamUpdates = [], events = [];
  const rows = options.rows || [
    ...Array.from({ length: 8 }, (_, i) => row({ source_key: 'alive' + i })),
    row({ source_key: 'gone', title: 'کیف (کد ۲)', active: 0, maps: [{ target: 'woo', account_key: 'default', remote_id: 5 }, { target: 'basalam', account_key: '735703', remote_id: 9 }] }),
    row({ source_key: 'stockless', title: 'شال (کد ۳)', data: { stock: 0 }, maps: [{ target: 'woo', account_key: 'default', remote_id: 6 }] })
  ];
  const io = {
    ...progress, faN: progress.fa, clipText: progress.clip, planProfileRemovals: core.planProfileRemovals,
    maintenanceRows: async () => rows,
    getState: async key => key === 'settings' ? (options.settings || {}) : (options.scan === undefined ? { complete: true, jobId: 'j1' } : options.scan),
    reconAccounts: async () => accounts,
    destinationDelete: async (target, id, force, shopId) => { deleted.push(target + ':' + id + (shopId ? '@' + shopId : '')); if (options.failOn === target) throw Error('HTTP 502 از مقصد'); return { ok: true }; },
    wooUpdate: async (id, payload) => { wooUpdates.push([id, payload]); return { ok: true }; },
    basalamUpdateShop: async (shop, id, payload) => { basalamUpdates.push([shop, id, payload]); return { ok: true }; },
    deleteProduct: async (profileId, sourceKey) => { profileDeletes.push(profileId + '/' + sourceKey); return true; }
  };
  const { profileSyncRemovals } = await compileFn(source, 'export async function profileSyncRemovals(', 'profileSyncRemovals', io);
  const report = await profileSyncRemovals('p1', options.apply !== false, options.target || 'both', event => events.push(event));
  return { report, deleted, profileDeletes, wooUpdates, basalamUpdates, events };
}

for (const runtime of ['worker', 'render']) {
  test(runtime + ': a product gone from the source leaves every destination and then the profile', async () => {
    const { report, deleted, profileDeletes, events } = await removalRun(runtime);
    assert.equal(report.planned, 2, 'the gone product and the out-of-stock one');
    assert.deepEqual(deleted, ['woo:5', 'basalam:9@735703', 'woo:6'], 'each destination it was published to is cleaned, stall by stall');
    assert.deepEqual(profileDeletes, ['p1/gone', 'p1/stockless'], 'and the row leaves the saved profile afterwards');
    assert.equal(report.removedFromDestination, 3);
    assert.equal(report.removedFromProfile, 2);
    assert.equal(report.ok, true);
    assert.equal(report.blocked, '');
    const stages = events.map(event => event.stage);
    assert.ok(stages.includes('plan-ready') && stages.includes('apply-written') && stages.includes('applied'), 'the live window gets the whole story: ' + stages.join(','));
    const written = events.find(event => event.stage === 'apply-written');
    assert.equal(written.sourceKey, 'gone', 'the event names the table row it belongs to');
    assert.equal(written.accountKey, 'default');
    const ready = events.find(event => event.stage === 'plan-ready');
    assert.match(ready.summary, /محصولات رفته از مبدأ: ۲ از ۱۰/);
    assert.match(events.at(-1).detail.join(' '), /مرجع تصمیم: پروفایل ذخیره‌شده/, 'the report says, out loud, that the profile decided');
  });

  test(runtime + ': an incomplete source scan removes nothing, anywhere', async () => {
    const { report, deleted, profileDeletes } = await removalRun(runtime, { scan: { complete: false } });
    assert.match(report.blocked, /اسکن مبدأ کامل و قابل‌اعتماد نبود/);
    assert.deepEqual(deleted, []);
    assert.deepEqual(profileDeletes, []);
    assert.equal(report.ok, false);
  });

  test(runtime + ': a preview changes nothing but still lists every candidate', async () => {
    const { report, deleted, profileDeletes, events } = await removalRun(runtime, { apply: false });
    assert.equal(report.planned, 2);
    assert.equal(report.dryRun, true);
    assert.deepEqual(deleted, []);
    assert.deepEqual(profileDeletes, []);
    assert.equal(events.filter(event => event.stage === 'candidate').length, 2);
  });

  test(runtime + ': a destination that refuses keeps the product in the profile', async () => {
    const { report, profileDeletes } = await removalRun(runtime, { failOn: 'basalam' });
    assert.deepEqual(profileDeletes, ['p1/stockless'], 'only the product that really left every destination is dropped');
    assert.equal(report.removedFromProfile, 1);
    assert.equal(report.failed.length, 1);
    assert.equal(report.ok, false);
    assert.match(report.failed[0].error, /HTTP 502/);
  });

  test(runtime + ': the configured «پیش‌نویس» policy drafts at the destination and keeps the profile row', async () => {
    const { report, deleted, wooUpdates, basalamUpdates, profileDeletes } = await removalRun(runtime, { settings: { retire: { mode: 'draft' } } });
    assert.deepEqual(deleted, [], 'nothing is deleted when the operator asked for drafts');
    assert.deepEqual(wooUpdates, [[5, { status: 'draft' }], [6, { status: 'draft' }]]);
    assert.deepEqual(basalamUpdates, [['735703', 9, { status: 3790 }]]);
    assert.deepEqual(profileDeletes, [], 'the listing still exists, so the profile row stays');
    assert.equal(report.mode, 'draft');
  });

  test(runtime + ': «فقط گزارش» stays a report, even here', async () => {
    const { report, deleted, profileDeletes } = await removalRun(runtime, { settings: { retire: { mode: 'report' } } });
    assert.deepEqual(deleted, []);
    assert.deepEqual(profileDeletes, []);
    assert.equal(report.removedFromDestination, 0);
  });
}

// ——— the wiring: the two home options really run this ————————————————————————

test('both runtimes run the profile-driven removal at the end of a scrape, not the ledger one', async () => {
  for (const runtime of ['worker', 'render']) {
    const processor = await read(runtime + '-src/processor.ts');
    assert.ok(processor.includes('profileSyncRemovals(profile.id,true,delTarget)'), runtime + ': the checkboxes must drive the profile-based removal');
    assert.ok(!processor.includes('ledgerMissing(profile.id'), runtime + ': the ledger no longer decides what disappears');
    assert.ok(processor.includes('حذف بر پایهٔ پروفایل انجام نشد'), runtime + ': a blocked run is reported in the job log');
    assert.ok(/noPrice>Math\.max\(5,Math\.round\(0\.3\*/.test(processor), runtime + ': a few priceless products mean «ناموجود», not «broken scan»');
  }
});

test('the operation is reachable from both servers, as a plain call and as a background run', async () => {
  for (const [runtime, file] of [['worker', 'worker-src/app.ts'], ['render', 'render-src/server.ts']]) {
    const server = await read(file);
    assert.ok(server.includes("app.post('/api/maintenance/profile-removals'"), runtime + ': the plain route exists');
    assert.ok(server.includes("'profile-removals':(b,observe)=>profileSyncRemovals("), runtime + ': and the background op exists');
  }
});

test('the two home options no longer promise the ledger, and the panel can run the cleanup', async () => {
  const dash = await read('worker-src/dashboard.ts');
  assert.ok(dash.includes('🛒 ووکامرس (افزودن، آپدیت، حذف بر پایهٔ پروفایل)'));
  assert.ok(dash.includes('🏪 باسلام (افزودن، آپدیت، حذف بر پایهٔ پروفایل)'));
  assert.ok(!dash.includes('افزودن، آپدیت، حذف با دفتر حساب'), 'the old ledger-first wording is gone');
  assert.ok(dash.includes('مرجع تصمیم، <b>پروفایل ذخیره‌شدهٔ خودتان</b> است نه دفتر حساب'), 'the help box explains the new rule');
  assert.ok(dash.includes("mButton('🧹 حذف رفته‌ها از مقصد و پروفایل','profile-removals-apply','btn-red')"), 'the panel has its own button');
  assert.ok(dash.includes("if(clean==='profile-removals')return 'profile-removals';"), 'the background-run loop knows the op name');
});
