// What «اعمال هماهنگ‌سازی» really does — pinned for BOTH runtimes, offline.
//
// Found by reading the apply pass against the preview it promises (1.335.0):
//  - the preview counted actions the apply refuses to perform (destination-only
//    products are reported, never deleted), so the two numbers disagreed;
//  - the dashboard read `planned`, which the preview endpoint never returned —
//    every preview said «۰ اقدام آمادهٔ اجراست»;
//  - the Worker queued ONE WHOLE-PROFILE sync job PER MISSING PRODUCT, so a
//    profile with 200 gaps queued 200 identical jobs;
//  - after queueing (nothing written yet) it still ran a second full comparison,
//    doubling the slowest operation to report the very same numbers;
//  - nothing above the per-run cap was mentioned, so a truncated apply looked complete.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';

const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
async function compile(source, names, io = {}) {
  const js = (await transform(source.replace(/^import .*;\s*$/gm, '').replaceAll('export ', ''), { loader: 'ts' })).code;
  return new Function(...Object.keys(io), js + ';return {' + names + '};')(...Object.values(io));
}
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-recon-apply-'));
await build({ entryPoints: [new URL('../worker-src/recon-core.ts', import.meta.url).pathname], outfile: join(temporary, 'core.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const core = await import(pathToFileURL(join(temporary, 'core.mjs')));
await build({ entryPoints: [new URL('../worker-src/recon-progress.ts', import.meta.url).pathname], outfile: join(temporary, 'progress.mjs'), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
const progress = await import(pathToFileURL(join(temporary, 'progress.mjs')));
/** 1.336.0 — the apply pass reports every step through the shared live-progress module. */
const progressIo = {
  createReconProgress: progress.createReconProgress, describeLedgerEvent: progress.describeLedgerEvent,
  actionLine: progress.actionLine, faPrice: progress.faPrice, faDuration: progress.faDuration,
  faN: progress.fa, clipText: progress.clip, bucketTally: progress.bucketTally,
  tallySummary: progress.tallySummary, sampleLines: progress.sampleLines, planOrder: progress.planOrder
};

const PLAN_NOTE = 'محصولاتی که فقط در مقصد هستند گزارش می‌شوند ولی با «اعمال هماهنگ‌سازی» حذف نمی‌شوند؛ برای حذف از «تکراری‌های مقصد» یا «محصولات حذف‌شده از مبدأ» استفاده کنید.';
const fa0 = value => String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

const priceRow = (n, account = 'ووکامرس') => ({ bucket: 'priceDiff', target: 'woo', accountKey: 'default', accountName: account, profileId: 'p1', sourceKey: 's' + n, title: 'کفش ' + n + ' (کد ' + n + ')', remoteId: n, remotePrice: 100, expectedPrice: 120 });
const missingRow = (n, target = 'woo') => ({ bucket: 'missing', target, accountKey: target === 'woo' ? 'default' : '735703', accountName: target === 'woo' ? 'ووکامرس' : 'باسلام', profileId: 'p1', sourceKey: 'm' + n, title: 'عطر ' + n + ' (کد ' + n + ')', remoteId: null, expectedPrice: 500 });
const extraRow = n => ({ bucket: 'extra', target: 'woo', accountKey: 'default', accountName: 'ووکامرس', profileId: 'p1', sourceKey: '', title: '', remoteTitle: 'قدیمی ' + n + ' (کد ' + n + ')', remoteId: 900 + n, remotePrice: 70 });

/** Load one runtime's apply pass with every dependency replaced by a spy. */
async function applyPass(runtime, rows, options = {}) {
  const source = await read(runtime + '-src/maintenance.ts');
  const start = source.indexOf('export async function unifiedReconApply(');
  const end = source.indexOf('/**\n * Request 36b', start);
  assert.ok(start > 0 && end > start, runtime + ': apply pass not found');
  const calls = { recon: 0, refresh: 0, jobs: [], woo: [], basalam: [], synced: [], events: [] };
  const report = {
    rows, suffixFormats: '', zeroCountProfiles: [], matched: 1, priceDiff: rows.filter(r => r.bucket === 'priceDiff').length,
    missing: rows.filter(r => r.bucket === 'missing').length, extra: rows.filter(r => r.bucket === 'extra').length,
    noPrice: 0, unreachable: 0, inSync: false, local: rows.length, localAll: rows.length, skippedNoCode: 0,
    accounts: 1, accountsBreakdown: [], profiles: [], failures: []
  };
  const io = {
    ...progressIo,
    PLAN_NOTE, fa0, reconPlan: core.reconPlan, msg: error => (error instanceof Error ? error.message : String(error)),
    refreshDestinationLedger: async (_force, onProgress) => { calls.refresh++; onProgress?.({ type: 'ledger', account: 'ووکامرس' }); },
    unifiedReconLive: async (_profileId, onProgress) => { calls.recon++; onProgress?.({ type: 'progress', stage: 'account-done', account: 'ووکامرس' }); return report; },
    listProfiles: async () => [{ id: 'p1', name: 'پروفایل یک', titleSuffix: '' }],
    wooUpdate: async (id, payload) => { calls.woo.push({ id, payload }); if (options.failWoo) throw Error('۵۰۳ از ووکامرس'); },
    basalamUpdateShop: async (accountKey, id, payload) => { calls.basalam.push({ accountKey, id, payload }); },
    createJob: async (profileId, kind, target) => { calls.jobs.push([profileId, kind, target].join(':')); },
    destinationDelete: async () => { throw Error('the sync pass must never delete'); },
    getProduct: async (profileId, sourceKey) => ({ profileId, sourceKey }),
    getProfile: async id => ({ id }),
    syncWoo: async product => { calls.synced.push('woo:' + product.sourceKey); },
    syncBasalam: async product => { calls.synced.push('basalam:' + product.sourceKey); }
  };
  const { unifiedReconApply } = await compile(source.slice(start, end), 'unifiedReconApply', io);
  const result = await unifiedReconApply(options.profileId ?? 'p1', options.apply ?? false, options.limit ?? 200, event => calls.events.push(event));
  return { result, calls };
}

test('the plan is one list: the preview promises exactly what the apply performs', () => {
  const rows = [priceRow(1), missingRow(2), extraRow(3)];
  const plan = core.reconPlan(rows, '(کد x)', {});
  assert.equal(plan.all.length, 3);
  assert.equal(plan.applicable.length, 2, 'destination-only products are reported, not applied');
  assert.deepEqual(plan.applicable.map(a => a.kind), ['updatePrice', 'create']);
  assert.equal(plan.removals.length, 1);
  assert.deepEqual(plan.counts, { all: 3, updatePrice: 1, create: 1, remove: 1 });
});

for (const runtime of ['worker', 'render']) {
  test(runtime + ': the preview answers with the number the dashboard draws', async () => {
    const { result, calls } = await applyPass(runtime, [priceRow(1), missingRow(2), extraRow(3)]);
    assert.equal(result.dryRun, true);
    assert.equal(result.planned, 2, 'planned must exist — the banner read it and always showed zero');
    assert.equal(result.plannedPrice, 1);
    assert.equal(result.plannedCreate, 1);
    assert.equal(result.plannedRemove, 1);
    assert.match(result.planNote, /حذف نمی‌شوند/);
    assert.equal(calls.refresh, 0, 'a preview must not force a full ledger rescan');
    assert.equal(calls.woo.length + calls.basalam.length + calls.jobs.length + calls.synced.length, 0);
  });

  test(runtime + ': a destination-only product is never deleted by the sync pass', async () => {
    const { result, calls } = await applyPass(runtime, [extraRow(1), extraRow(2)], { apply: true });
    assert.equal(result.planned, 0);
    assert.equal(result.changed, 0);
    assert.equal(result.plannedRemove, 2);
    assert.equal(calls.woo.length, 0);
    assert.match(result.note, /حذف نمی‌شوند/);
  });

  test(runtime + ': price fixes are written, counted and verified by a second pass', async () => {
    const { result, calls } = await applyPass(runtime, [priceRow(1), priceRow(2)], { apply: true });
    assert.equal(calls.refresh, 1, 'apply refreshes the ledger first');
    assert.equal(calls.woo.length, 2);
    assert.deepEqual(calls.woo[0].payload, { regular_price: '120' });
    assert.equal(result.changed, 2);
    assert.equal(result.verified, true);
    assert.equal(calls.recon, 2, 'real writes are confirmed by comparing again');
    assert.equal(result.ok, true);
  });

  test(runtime + ': the per-run cap is reported instead of silently dropping work', async () => {
    const rows = [priceRow(1), priceRow(2), priceRow(3), priceRow(4), extraRow(9)];
    const { result } = await applyPass(runtime, rows, { apply: true, limit: 2 });
    assert.equal(result.planned, 4);
    assert.equal(result.processed, 2);
    assert.equal(result.remaining, 2);
    assert.match(result.note, /باقی ماند/);
    const preview = await applyPass(runtime, rows, { limit: 2 });
    assert.equal(preview.result.willApply, 2);
    assert.equal(preview.result.remaining, 2);
  });

  test(runtime + ': a failing destination is reported per product and never hides the rest', async () => {
    const { result } = await applyPass(runtime, [priceRow(1), priceRow(2)], { apply: true, failWoo: true });
    assert.equal(result.ok, false);
    assert.equal(result.changed, 0);
    assert.equal(result.failed.length, 2);
    assert.match(result.failed[0].error, /۵۰۳/);
    assert.equal(result.verified, false, 'nothing was written, so nothing is re-compared');
  });

  test(runtime + ': the long apply reports progress instead of staying silent', async () => {
    const { calls } = await applyPass(runtime, [priceRow(1), priceRow(2)], { apply: true });
    const stages = calls.events.map(e => e.stage);
    assert.ok(stages.includes('ledger-refresh'), 'the ledger refresh is visible');
    const applied = calls.events.filter(e => e.stage === 'apply');
    assert.equal(applied.length, 2, 'one event per product, with a counter the panel can draw');
    assert.deepEqual(applied.map(e => e.count), [1, 2]);
    assert.equal(applied[0].total, 2);
    assert.ok(applied[0].summary.includes('کفش'));
  });
}

test('worker: missing products queue ONE job per profile and destination, not one per product', async () => {
  const rows = [missingRow(1), missingRow(2), missingRow(3), missingRow(4, 'basalam')];
  const { result, calls } = await applyPass('worker', rows, { apply: true });
  assert.deepEqual(calls.jobs, ['p1:sync:woo', 'p1:sync:basalam'], 'a sync job re-sends the whole profile; once is enough');
  assert.equal(result.queuedJobs, 2);
  assert.equal(result.queuedProducts, 4);
  assert.equal(result.changed, 0, 'queued work is not a destination write yet');
  assert.equal(calls.recon, 1, 'no second full scan: the queue has not run, the numbers cannot have moved');
  assert.match(result.note, /به صف ارسال سپرده شد/);
  assert.equal(result.verified, false);
});

test('render: missing products are created inline and counted as real writes', async () => {
  const rows = [missingRow(1), missingRow(2, 'basalam')];
  const { result, calls } = await applyPass('render', rows, { apply: true });
  assert.deepEqual(calls.synced, ['woo:m1', 'basalam:m2']);
  assert.equal(result.created, 2);
  assert.equal(result.changed, 2);
  assert.equal(result.queuedJobs, 0);
  assert.equal(calls.recon, 2, 'products really were created, so the result is verified');
});

test('both runtimes run ONE comparison implementation', async () => {
  for (const runtime of ['worker', 'render']) {
    const source = await read(runtime + '-src/maintenance.ts');
    assert.match(source, /export async function unifiedRecon\(profileId ?= ?''\) ?\{ ?return unifiedReconLive\(profileId\);? ?\}/,
      runtime + ': the silent variant must be the live one without a listener');
    assert.ok(source.includes('planned:plan.applicable.length'), runtime + ': the report must carry the applicable count');
    assert.ok(!source.includes("action.kind==='remove'&&action.remoteId"), runtime + ': the dead delete branch must be gone');
  }
});

test('the panel reports what happened, not a fixed sentence', async () => {
  const dashboard = await read('worker-src/dashboard.ts');
  const start = dashboard.indexOf('function reconApplySummary(d){');
  const end = dashboard.indexOf('function renderReconMatrix(d,opts){');
  assert.ok(start > 0 && end > start);
  const { reconApplySummary } = await compile(dashboard.slice(start, end), 'reconApplySummary', { fa: String });
  assert.equal(reconApplySummary({ changed: 2, queuedProducts: 3, remaining: 1, failed: [{}] }),
    '2 مورد روی مقصد نوشته شد · 3 محصول به صف ارسال رفت · 1 اقدام باقی ماند · 1 ناموفق.');
  assert.equal(reconApplySummary({}), 'هیچ تغییری لازم نبود.');
  assert.ok(dashboard.includes("fa(d.planned||0)+' اقدام آمادهٔ اجراست'"), 'the preview banner/notice must use the real count');
});

test('every maintenance operation that takes minutes can report progress', async () => {
  for (const runtime of ['worker', 'render']) {
    const source = await read(runtime + '-src/maintenance.ts');
    for (const [fn, signature] of [
      ['unifiedReconApply', /unifiedReconApply\([^)]*onProgress\?: ?\(e: ?any\) ?=> ?void\)/],
      ['destinationDuplicates', /destinationDuplicates\([^)]*onProgress\?: ?\(e: ?any\) ?=> ?void\)/],
      ['ledgerMissing', /ledgerMissing\([^)]*onProgress\?:\(e:any\)=>void\)/]
    ]) assert.match(source, signature, runtime + ': ' + fn + ' must accept a progress listener');
  }
  for (const [runtime, file] of [['worker', 'worker-src/app.ts'], ['render', 'render-src/server.ts']]) {
    const source = await read(file);
    for (const op of ["'recon-unified-apply':(b,observe)=>", "'ledger-missing':(b,observe)=>", 'duplicates:(b,observe)=>'])
      assert.ok(source.includes(op), runtime + ': ' + op + ' must forward the observer');
  }
});
