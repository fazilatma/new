// Live detail for every reconciliation operation (1.336.0), pinned offline for BOTH runtimes.
//
// The request: «برای تمامی فرآیندهای بخش مغایرت‌گیری، جزئیات تفصیلی‌تر زنده از مراحل انجام نشان
// داده شوند تا واقعاً کار کردن این سیستم را تأیید کنم.»
//
// Before this release a long reconciliation looked exactly like a stuck one: the panel received
// bare stage names («account-done»), no elapsed time, no page numbers, no example products, and
// four buttons (تکراری‌ها، حذف‌شده‌ها از مبدأ، مغایرت‌گیری هر مقصد، بازسازی نگاشت) reported nothing
// at all. These tests pin the evidence every operation must now produce.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, transform } from 'esbuild';

const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-recon-progress-'));
const bundle = async (source, name) => {
  await build({ entryPoints: [new URL('../' + source, import.meta.url).pathname], outfile: join(temporary, name), bundle: true, format: 'esm', platform: 'node', logLevel: 'silent' });
  return import(pathToFileURL(join(temporary, name)));
};
const progress = await bundle('worker-src/recon-progress.ts', 'progress.mjs');
const runs = await bundle('worker-src/maintenance-runs.ts', 'runs.mjs');
const core = await bundle('worker-src/recon-core.ts', 'core.mjs');
const dedup = await bundle('worker-src/dedup.ts', 'dedup.mjs');

/** Compile one function out of a runtime source file, with every dependency replaced by a stub. */
async function compileFn(source, header, names, io) {
  const start = source.indexOf(header);
  assert.ok(start > 0, 'function not found: ' + header);
  const end = source.indexOf('\n}\n', start) + 3;
  const slice = source.slice(start, end);
  const js = (await transform(slice.replace(/^import .*;\s*$/gm, '').replaceAll('export ', ''), { loader: 'ts' })).code;
  return new Function(...Object.keys(io), js + ';return {' + names + '};')(...Object.values(io));
}
const progressIo = {
  ...progress, faN: progress.fa, clipText: progress.clip
};

// ——— the shared event builder ———————————————————————————————————————————————

test('every event carries the proof a human needs: phase, numbers, elapsed time and order', () => {
  let clock = 1000;
  const seen = [];
  const p = progress.createReconProgress(e => seen.push(e), () => clock);
  p.emit({ stage: 'local-loaded', name: 'local', count: 12, summary: 'محصولات محلی: ۱۲ مورد' });
  clock = 4500;
  p.emit({ stage: 'report-ready', name: 'report', status: 'success', count: 12, total: 12, summary: 'تمام شد' });
  assert.deepEqual(seen.map(e => e.stage), ['local-loaded', 'report-ready']);
  assert.deepEqual(seen.map(e => e.seq), [1, 2]);
  assert.deepEqual(seen.map(e => e.elapsedMs), [0, 3500]);
  assert.equal(seen[0].type, 'progress');
  assert.equal(seen[0].status, 'running', 'a step without a verdict is still running');
  assert.equal(seen[1].status, 'success');
  assert.equal(p.elapsed(), 3500);
});

test('an event stays small enough to travel through the background-run store', () => {
  const seen = [];
  const p = progress.createReconProgress(e => seen.push(e));
  p.emit({ stage: 'compare', summary: 'ب'.repeat(400), detail: Array.from({ length: 20 }, (_, i) => 'خط ' + i + ' ' + 'ت'.repeat(300)) });
  const [event] = seen;
  assert.equal(event.summary.length, progress.SUMMARY_MAX_CHARS);
  assert.equal(event.detail.length, progress.DETAIL_MAX_LINES);
  for (const line of event.detail) assert.ok(line.length <= progress.DETAIL_MAX_CHARS, 'detail lines are bounded');
  assert.ok(JSON.stringify(event).length < 2000);
});

test('a broken listener can never break the reconciliation it is watching', () => {
  const p = progress.createReconProgress(() => { throw Error('panel exploded'); });
  const event = p.emit({ stage: 'account-start', summary: 'شروع' });
  assert.equal(event.stage, 'account-start');
});

test('numbers are Persian and prices are grouped so a human can read them', () => {
  assert.equal(progress.fa(1402), '۱۴۰۲');
  assert.equal(progress.faPrice(1234567), '۱٬۲۳۴٬۵۶۷');
  assert.equal(progress.faPrice('x'), '—');
  assert.equal(progress.faDuration(2400), '۲.۴ ثانیه');
  assert.equal(progress.faDuration(95000), '۱ دقیقه و ۳۵ ثانیه');
});

test('the ledger scanner speaks Persian: page numbers, retries and mismatches', () => {
  const page = progress.describeLedgerEvent({ type: 'ledger-page-done', page: 3, totalPages: 7, fetched: 150 }, 'غرفهٔ برف باکس');
  assert.equal(page.stage, 'ledger-fetch');
  assert.equal(page.page, 3);
  assert.equal(page.totalPages, 7);
  assert.match(page.summary, /صفحهٔ ۳ از ۷ خوانده شد · تا اینجا ۱۵۰ محصول/);
  const retry = progress.describeLedgerEvent({ type: 'ledger-page-retry', page: 2, attempt: 1, error: 'HTTP 429' }, 'ووکامرس');
  assert.equal(retry.status, 'error');
  assert.match(retry.summary, /صفحهٔ ۲ ناموفق بود \(تلاش ۱\) — HTTP 429؛ دوباره تلاش می‌شود/);
  const mismatch = progress.describeLedgerEvent({ type: 'ledger-total-mismatch', expected: 900, actual: 870 }, 'ووکامرس');
  assert.match(mismatch.summary, /۹۰۰ محصول اعلام کرد ولی ۸۷۰ محصول خوانده شد/);
  assert.equal(progress.describeLedgerEvent({ type: 'something-internal' }, 'ووکامرس'), null, 'noise stays out of the panel');
});

test('evidence lines name the product and both prices, worst rows first', () => {
  const rows = [
    { bucket: 'matched', title: 'کفش (کد ۱)', sourcePrice: 100, remotePrice: 100 },
    { bucket: 'missing', title: 'عطر (کد ۲)', sourcePrice: 2500000 },
    { bucket: 'priceDiff', title: 'کیف (کد ۳)', sourcePrice: 300000, remotePrice: 250000 }
  ];
  assert.deepEqual(progress.bucketTally(rows), { matched: 1, priceDiff: 1, missing: 1, extra: 0, noPrice: 0, unreachable: 0 });
  assert.equal(progress.tallySummary(progress.bucketTally(rows)), 'هماهنگ ۱ · اختلاف قیمت ۱ · در مقصد نیست ۱');
  assert.equal(progress.tallySummary(progress.bucketTally([])), 'بدون تفاوت');
  const lines = progress.sampleLines(rows, 2);
  assert.match(lines[0], /^کیف \(کد ۳\) — اختلاف قیمت · مبدأ ۳۰۰٬۰۰۰ · مقصد ۲۵۰٬۰۰۰$/, 'the row that needs work comes first');
  assert.match(lines[1], /^عطر \(کد ۲\) — در مقصد نیست · مبدأ ۲٬۵۰۰٬۰۰۰$/);
});

test('an apply action is described with its real before and after price', () => {
  assert.equal(progress.actionLine({ kind: 'updatePrice', title: 'کیف', fromPrice: 250000, toPrice: 300000, remoteId: 42 }),
    '💰 کیف · ۲۵۰٬۰۰۰ ← ۳۰۰٬۰۰۰ (شناسه ۴۲)');
  assert.equal(progress.actionLine({ kind: 'create', title: 'عطر', accountName: 'غرفهٔ برف باکس' }),
    '➕ عطر · ساخت دوباره در غرفهٔ برف باکس');
});

// ——— the background-run path keeps the same detail —————————————————————————

test('a background run stores the detail, not just the stage name', () => {
  const event = runs.compactEvent({ type: 'progress', name: 'account', stage: 'account-done', status: 'success', summary: 'ووکامرس: ۲ محصول', account: 'ووکامرس', target: 'woo', count: 2, total: 4, page: 1, totalPages: 3, elapsedMs: 8200, seq: 9, detail: ['کفش — هماهنگ', 'عطر — در مقصد نیست'] }, '2026-10-07T00:00:00.000Z');
  assert.equal(event.stage, 'account-done');
  assert.equal(event.page, 1);
  assert.equal(event.totalPages, 3);
  assert.equal(event.elapsedMs, 8200);
  assert.equal(event.seq, 9);
  assert.deepEqual(event.detail, ['کفش — هماهنگ', 'عطر — در مقصد نیست']);
});

test('a background run never grows without bound, however chatty the step is', () => {
  const event = runs.compactEvent({ name: 'x', detail: Array.from({ length: 40 }, () => 'ط'.repeat(500)) }, 'now');
  assert.equal(event.detail.length, 6);
  for (const line of event.detail) assert.ok(line.length <= 160);
});

// ——— the operations themselves really emit it ————————————————————————————————

for (const runtime of ['worker', 'render']) {
  test(runtime + ': rebuilding the id map reports local, destination, matching and the result', async () => {
    const source = await read(runtime + '-src/maintenance.ts');
    const events = [];
    const io = {
      ...progressIo,
      maintenanceRows: async () => [
        { profile_id: 'p1', source_key: 's1', title: 'کفش', active: 1, remote_woo_id: 11, data: { sku: 'sku-1' } },
        { profile_id: 'p1', source_key: 's2', title: 'عطر', active: 1, remote_woo_id: 0, data: {} }
      ],
      remoteProducts: async () => [{ id: 11, name: 'کفش', sku: 'sku-1', status: 'publish' }, { id: 99, name: 'قدیمی', sku: '', status: 'publish' }],
      setState: async () => {},
      norm: value => String(value ?? '').trim().toLowerCase()
    };
    const { recon } = await compileFn(source, 'export async function recon(target:', 'recon', io);
    const result = await recon('woo', 'p1', e => events.push(e));
    assert.equal(result.matched, 1);
    const stages = events.map(e => e.stage);
    for (const stage of ['local-loading', 'local-loaded', 'remote-loading', 'remote-loaded', 'report-ready'])
      assert.ok(stages.includes(stage), runtime + ': missing live step ' + stage);
    for (const event of events) {
      assert.equal(event.type, 'progress');
      assert.ok(Number.isFinite(event.elapsedMs), 'every step says how long the run has taken');
      assert.ok(event.summary.length > 0, 'no step is reported as an empty bubble');
    }
    assert.deepEqual(events.map(e => e.seq), events.map((_, i) => i + 1));
    const final = events.at(-1);
    assert.match(final.summary, /نقشهٔ ووکامرس آماده شد در .* · متصل ۱ · بدون جفت ۱ · فقط در مقصد ۱/);
    assert.ok(final.detail.includes('تطبیق با شناسه: ۱'), runtime + ': the report must show how products were matched');
    assert.ok(final.detail.some(line => line.startsWith('بدون جفت: عطر')), runtime + ': name a product that stayed unmatched');
  });

  test(runtime + ': duplicate cleanup names each destination, each count and each deletion', async () => {
    const source = await read(runtime + '-src/maintenance.ts');
    const accounts = [
      { target: 'woo', accountKey: 'default', name: 'ووکامرس' },
      { target: 'basalam', accountKey: '735703', name: 'غرفهٔ برف باکس' }
    ];
    const remotes = {
      default: [{ id: 1, name: 'کیف (کد ۱)', price: 300000 }, { id: 2, name: 'کیف (کد ۲)', price: 100000 }],
      735703: [{ id: 5, name: 'عطر (کد ۵)', price: 900000, shopId: '735703' }]
    };
    const deleted = [];
    const io = {
      ...progressIo,
      reconAccounts: async () => accounts,
      getState: async () => ({ dedup: { suffixFormats: '(کد x)' } }),
      remoteForAccount: async (account, _force, onProgress) => {
        onProgress?.({ type: 'ledger-page-start', page: 1, totalPages: 1 });
        onProgress?.({ type: 'ledger-page-done', page: 1, totalPages: 1, fetched: remotes[account.accountKey].length });
        return remotes[account.accountKey];
      },
      planDuplicateDeletions: (rows, account) => account.target === 'woo'
        ? [{ target: 'woo', accountKey: 'default', accountName: 'ووکامرس', remoteId: 2, keepId: 1, title: 'کیف (کد ۲)', price: 100000 }]
        : [],
      destinationDelete: async (target, id) => { deleted.push(target + ':' + id); return { deleted: true }; }
    };
    const { destinationDuplicates } = await compileFn(source, 'export async function destinationDuplicates(', 'destinationDuplicates', io);

    const preview = [];
    const dry = await destinationDuplicates(false, 200, 'expensive', '', e => preview.push(e));
    assert.equal(dry.planned, 1);
    const listed = preview.find(e => e.stage === 'accounts-listed');
    assert.deepEqual(listed.detail, ['ووکامرس — ووکامرس', 'غرفهٔ برف باکس — باسلام']);
    assert.ok(preview.some(e => e.stage === 'ledger-fetch' && e.page === 1), 'page-by-page reading is visible');
    const done = preview.find(e => e.stage === 'account-done' && e.account === 'ووکامرس');
    assert.match(done.summary, /ووکامرس: ۲ محصول خوانده شد · ۱ نسخهٔ تکراری برای حذف شناسایی شد/);
    assert.deepEqual(done.detail, ['کیف (کد ۲) · ۱۰۰٬۰۰۰ (شناسه ۲)']);
    const plan = preview.find(e => e.stage === 'plan-ready');
    assert.match(plan.summary, /بررسی ۲ مقصد در .* تمام شد · ۱ نسخهٔ تکراری برای حذف/);
    assert.deepEqual(plan.detail, ['ووکامرس: ۱ تکراری', 'غرفهٔ برف باکس: ۰ تکراری']);

    const live = [];
    const applied = await destinationDuplicates(true, 200, 'expensive', '', e => live.push(e));
    assert.equal(applied.deleted, 1);
    assert.deepEqual(deleted, ['woo:2']);
    const attempt = live.find(e => e.stage === 'delete');
    assert.match(attempt.summary, /حذف ۱ از ۱: کیف \(کد ۲\) · ۱۰۰٬۰۰۰ \(شناسه ۲\)/);
    const wrote = live.find(e => e.stage === 'delete-done');
    assert.match(wrote.summary, /^حذف شد: کیف \(کد ۲\) \(شناسه ۲\)/);
    const report = live.find(e => e.stage === 'report-ready');
    assert.match(report.summary, /پایان در .* · حذف‌شده ۱ · بایگانی‌شده ۰ · ناموفق ۰ · باقی‌مانده ۰/);
  });

  test(runtime + ': a destination that refuses to answer is reported, not silently skipped', async () => {
    const source = await read(runtime + '-src/maintenance.ts');
    const io = {
      ...progressIo,
      reconAccounts: async () => [{ target: 'woo', accountKey: 'default', name: 'ووکامرس' }],
      getState: async () => ({}),
      remoteForAccount: async () => { throw Error('HTTP 502 از ووکامرس'); },
      planDuplicateDeletions: () => [],
      destinationDelete: async () => { throw Error('must not run'); }
    };
    const { destinationDuplicates } = await compileFn(source, 'export async function destinationDuplicates(', 'destinationDuplicates', io);
    const events = [];
    const result = await destinationDuplicates(false, 200, 'expensive', '', e => events.push(e));
    assert.equal(result.ok, false);
    const failure = events.find(e => e.status === 'error');
    assert.match(failure.summary, /ووکامرس خوانده نشد: HTTP 502 از ووکامرس — تکراری‌های این مقصد در این نوبت بررسی نشدند/);
  });

  test(runtime + ': every reconciliation entry point builds a live reporter', async () => {
    const source = await read(runtime + '-src/maintenance.ts');
    for (const header of ['unifiedReconLive(', 'reconTableLive(', 'unifiedReconApply(', 'destinationDuplicates(', 'ledgerMissing(', 'refreshDestinationLedger(', 'recon(target:', 'rebuildMap(target:']) {
      const at = source.indexOf('export async function ' + header);
      assert.ok(at > 0, runtime + ': ' + header + ' not found');
      const body = source.slice(at, source.indexOf('\n}\n', at));
      assert.ok(body.includes('createReconProgress('), runtime + ': ' + header + ' reports no live progress');
    }
  });
}

test('the servers forward the event untouched — no runtime invents its own shape', async () => {
  for (const file of ['worker-src/app.ts', 'render-src/server.ts']) {
    const src = await read(file);
    const block = src.slice(src.indexOf('const maintenanceOps'), src.indexOf('};', src.indexOf('const maintenanceOps')));
    assert.ok(block.includes("'recon-unified':(b,observe)=>unifiedReconLive(String(b.profileId||''),observe)"), file + ': preview must pass the observer straight through');
    assert.ok(block.includes("'recon:woo':(b,observe)=>recon('woo',String(b.profileId||''),observe)"), file + ': per-target comparison must report progress');
    assert.ok(block.includes("'rebuild:woo':(b,observe)=>rebuildMap('woo',String(b.profileId||''),observe)"), file + ': map rebuild must report progress');
    assert.ok(!/name:e\.stage\|\|e\.type/.test(block), file + ': the old re-labelling wrapper must be gone');
  }
});

test('the panel draws the detail: phase chips, elapsed time and the evidence log', async () => {
  const dash = await read('worker-src/dashboard.ts');
  assert.ok(dash.includes('function reconElapsedText(ms)'), 'durations are rendered in Persian');
  assert.ok(dash.includes('const RECON_STAGE_LABELS='), 'stage names are translated for the operator');
  assert.ok(dash.includes("'<ul class=\"diag-stage-detail\">'"), 'example lines are rendered under each phase card');
  assert.ok(dash.includes('data-recon-phases'), 'the phase strip exists');
  assert.ok(dash.includes("if(Array.isArray(event.detail))for(const line of event.detail)logLine('        ↳ '+line,'detail')"),
    'every detail line is appended to the scrolling evidence log');
  assert.ok(dash.includes('🛠 جزئیات فنی اجرا'), 'the technical detail is still there, folded under one clear summary');
});

test('the four silent buttons now open the same live panel', async () => {
  const dash = await read('worker-src/dashboard.ts');
  for (const pin of [
    "{action:'duplicates',readOnly:!apply,onEvent:live?live.observe:undefined,onShape:live?live.shape:undefined}",
    "{action:'ledger-missing',readOnly:!apply,onEvent:live?live.observe:undefined,onShape:live?live.shape:undefined}",
    "{action:kind+':'+target,readOnly:kind==='recon',onEvent:live?live.observe:undefined,onShape:live?live.shape:undefined}"
  ]) assert.ok(dash.includes(pin), 'a reconciliation button still runs blind: ' + pin);
});

test('a rendered phase card really contains the numbers, the duration and the evidence', async () => {
  const dash = await read('worker-src/dashboard.ts');
  const start = dash.indexOf('const RECON_STAGE_LABELS=');
  const end = dash.indexOf('function openReconLiveProgress(');
  assert.ok(start > 0 && end > start, 'the live renderer must live in one readable block');
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const { reconStageHtml } = new Function('esc', 'fa', dash.slice(start, end) + ';return {reconStageHtml};')(esc, progress.fa);
  const html = reconStageHtml({
    type: 'progress', name: 'ledger', stage: 'ledger-fetch', status: 'running', account: 'غرفهٔ برف باکس',
    summary: 'صفحهٔ ۳ از ۷ خوانده شد · تا اینجا ۱۵۰ محصول', count: 150, total: 900, page: 3, totalPages: 7,
    elapsedMs: 12400, seq: 11, detail: ['کیف — اختلاف قیمت · مبدأ ۳۰۰٬۰۰۰ · مقصد ۲۵۰٬۰۰۰']
  });
  assert.match(html, /خواندن دفتر مقصد/, 'the phase is named in Persian, not as a code word');
  assert.match(html, /صفحهٔ ۳ از ۷ خوانده شد/);
  assert.match(html, /پیشرفت ۱۵۰ از ۹۰۰/);
  assert.match(html, /صفحهٔ ۳ از ۷/);
  assert.match(html, /از شروع: ۱۲ ثانیه/);
  assert.match(html, /<ul class="diag-stage-detail"><li>کیف — اختلاف قیمت · مبدأ ۳۰۰٬۰۰۰ · مقصد ۲۵۰٬۰۰۰<\/li><\/ul>/);
  assert.ok(!reconStageHtml({ stage: 'compare', summary: '<img src=x>' }).includes('<img'), 'summaries are escaped');
});

// ——— the sync preview: «خیلی بیشتر» detail (1.337.0) ————————————————————————

/** Run the real preview of one runtime against stubbed destinations and collect every event. */
async function previewRun(runtime, options = {}) {
  const source = await read(runtime + '-src/maintenance.ts');
  const local = [];
  for (let i = 1; i <= 60; i++) local.push({ profile_id: i % 3 ? 'p1' : 'p2', source_key: 's' + i, title: 'کفش مدل ' + i + ' (کد ' + i + ')', active: 1, price: 100000 + i * 1000, data: {}, maps: [] });
  local.push({ profile_id: 'p1', source_key: 'nc', title: 'محصول بدون پسوند کد', active: 1, price: 5000, data: {}, maps: [] });
  const io = {
    ...progressIo, ...core, ...dedup, PLAN_NOTE: 'فقط گزارش', LEDGER_PAGE_PARALLEL: 4, msg: error => (error instanceof Error ? error.message : String(error)),
    listProfiles: async () => [{ id: 'p1', name: 'برف باکس' }, { id: 'p2', name: 'عطر سرا' }, { id: 'p3', name: 'پروفایل خالی' }],
    maintenanceRows: async () => local,
    getState: async () => ({}), setState: async () => {},
    reconAccounts: async () => [{ target: 'woo', accountKey: 'default', name: 'ووکامرس' }, { target: 'basalam', accountKey: '735703', name: 'غرفهٔ برف باکس' }],
    remoteForAccount: async (account, _force, onProgress) => {
      if (account.target === 'basalam') throw Error('HTTP 502 از دروازهٔ باسلام');
      for (let page = 1; page <= 3; page++) {
        onProgress?.({ type: 'ledger-page-start', page, totalPages: 3 });
        onProgress?.({ type: 'ledger-page-done', page, totalPages: 3, fetched: page * 20 });
      }
      return local.slice(0, 55).map((row, i) => ({ id: 1000 + i, name: row.title, price: i % 4 === 0 ? row.price - 7000 : row.price, sku: '', status: 'publish' }));
    },
    ...(options.io || {})
  };
  const { unifiedReconLive } = await compileFn(source, 'export async function unifiedReconLive(', 'unifiedReconLive', io);
  const events = [];
  const report = await unifiedReconLive('', e => events.push(e));
  return { report, events, steps: events.filter(e => e.type === 'progress'), local };
}

for (const runtime of ['worker', 'render']) {
  test(runtime + ': the preview narrates the whole run, not five headlines', async () => {
    const { steps } = await previewRun(runtime);
    assert.ok(steps.length >= 25, runtime + ': only ' + steps.length + ' steps reported');
    const stages = steps.map(e => e.stage);
    for (const stage of ['start', 'profiles-loading', 'local-loading', 'local-loaded', 'suffix-rule', 'profiles-protected',
      'accounts-listed', 'account-start', 'ledger-fetch', 'account-fetched', 'compare', 'bucket-priceDiff', 'bucket-missing',
      'bucket-matched', 'match-methods', 'account-done', 'account-error', 'plan-building', 'plan-ready',
      'plan-by-destination', 'profiles-summary', 'report-ready'])
      assert.ok(stages.includes(stage), runtime + ': the preview never reports ' + stage);
    assert.ok(steps.reduce((n, e) => n + (e.detail?.length || 0), 0) >= 40, runtime + ': too little evidence');
    assert.deepEqual(steps.map(e => e.seq), steps.map((_, i) => i + 1), 'steps are numbered in order');
  });

  test(runtime + ': the preview explains which products it refuses to compare, and why', async () => {
    const { steps } = await previewRun(runtime);
    const rule = steps.find(e => e.stage === 'suffix-rule');
    assert.match(rule.summary, /فقط محصولاتی که پسوند کد دارند با مقصد مقایسه می‌شوند/);
    assert.match(rule.summary, /۱ محصول بدون پسوند، دست‌نخورده می‌مانند/);
    assert.ok(rule.detail.some(line => line.startsWith('نادیده: محصول بدون پسوند کد')), 'the skipped product is named');
    const protectedProfiles = steps.find(e => e.stage === 'profiles-protected');
    assert.match(protectedProfiles.summary, /۱ پروفایل هیچ محصول فعالی ندارد/);
    assert.deepEqual(protectedProfiles.detail, ['پروفایل خالی']);
    const loaded = steps.find(e => e.stage === 'local-loaded');
    assert.deepEqual(loaded.detail, ['برف باکس: ۴۰ محصول', 'عطر سرا: ۲۰ محصول'], 'local products are broken down per profile');
  });

  test(runtime + ': every difference is shown with its own arithmetic and its own examples', async () => {
    const { steps } = await previewRun(runtime);
    const diff = steps.find(e => e.stage === 'bucket-priceDiff');
    assert.match(diff.summary, /اختلاف قیمت: ۱۴ مورد \(قیمت مقصد با قیمت انتظاری این مقصد فرق دارد\)/);
    assert.match(diff.detail[0], /^کفش مدل 1 \(کد 1\) · مبدأ ۱۰۱٬۰۰۰ · مقصد ۹۴٬۰۰۰ · کم‌تر از انتظار ۷٬۰۰۰ \(۷٪\) · شناسه ۱۰۰۰$/);
    const missing = steps.find(e => e.stage === 'bucket-missing');
    assert.match(missing.detail[0], /باید با قیمت .* ساخته شود \(پروفایل .*\)/);
    const matched = steps.find(e => e.stage === 'bucket-matched');
    assert.match(matched.summary, /هماهنگ: ۴۱ محصول دقیقاً همان قیمتی را دارند که باید/);
    assert.match(matched.detail[0], /^✓ .* · مبدأ ۱۰۲٬۰۰۰ = مقصد ۱۰۲٬۰۰۰ · شناسه ۱۰۰۱$/, 'in-sync products are proven, not just counted');
    const how = steps.find(e => e.stage === 'match-methods');
    assert.ok(how.detail.some(line => line.startsWith('تطبیق با عنوانِ پسوندخورده: ')), 'the pairing method is reported');
  });

  test(runtime + ': the comparison streams in batches with running totals', async () => {
    const { steps } = await previewRun(runtime);
    const batches = steps.filter(e => e.stage === 'compare');
    assert.ok(batches.length >= 2 && batches.length <= 40, runtime + ': ' + batches.length + ' batches is not a stream');
    assert.ok(batches.every(e => e.detail?.length), 'each batch shows example products');
    const counts = batches.map(e => e.count);
    assert.deepEqual(counts, [...counts].sort((a, b) => a - b), 'the counter only moves forward');
    assert.equal(counts.at(-1), batches.at(-1).total, 'the last batch closes the destination');
    const runningTotals = steps.filter(e => e.tally).map(e => (e.tally.matched || 0) + (e.tally.priceDiff || 0) + (e.tally.missing || 0) + (e.tally.unreachable || 0));
    assert.deepEqual(runningTotals, [...runningTotals].sort((a, b) => a - b), 'the live counters never go backwards');
    const final = steps.at(-1);
    assert.equal(final.tally.matched, 41);
    assert.equal(final.tally.priceDiff, 14);
    assert.equal(final.tally.unreachable, 60, 'a destination that failed marks all its rows');
  });

  test(runtime + ': a destination that fails is explained, with a way out', async () => {
    const { steps } = await previewRun(runtime);
    const failure = steps.find(e => e.stage === 'account-error');
    assert.equal(failure.status, 'error');
    assert.match(failure.summary, /غرفهٔ برف باکس پاسخ نداد: HTTP 502 از دروازهٔ باسلام/);
    assert.match(failure.summary, /گزارش «هماهنگ» اعلام نمی‌شود/);
    assert.ok(failure.detail.some(line => line.startsWith('راه‌حل: ')), 'the operator is told what to do next');
  });

  test(runtime + ': the closing report adds up, names the next step and times itself', async () => {
    const { steps, report } = await previewRun(runtime);
    const plan = steps.find(e => e.stage === 'plan-ready');
    assert.match(plan.summary, /برنامهٔ اجرا آماده شد: ۱۹ اقدام قابل‌اجرا \(۱۴ اصلاح قیمت، ۵ ساخت دوباره\)/);
    assert.equal(plan.detail.length, 6, 'the first actions are listed, not just counted');
    assert.match(plan.detail[0], /^💰 .* ← .*/);
    assert.deepEqual(steps.find(e => e.stage === 'plan-by-destination').detail, ['ووکامرس: ۱۹ اقدام']);
    assert.deepEqual(steps.find(e => e.stage === 'profiles-summary').detail.length, 2);
    const final = steps.at(-1);
    assert.equal(final.stage, 'report-ready');
    assert.match(final.detail[0], /مقصد بی‌پاسخ: ۱ — غرفهٔ برف باکس/);
    assert.match(final.detail[1], /محصول محلی ۶۱ · قابل مقایسه ۶۰ · خوانده‌شده از مقصدها ۵۵ · سطر مقایسه ۱۲۰/);
    assert.match(final.detail[3], /سرعت کلی: /);
    assert.match(final.detail[4], /قدم بعدی: دکمهٔ «اعمال هماهنگ‌سازی» همین ۱۹ اقدام را اجرا می‌کند/);
    assert.equal(report.planned, 19);
  });
}

test('a polled background run keeps the running counters too', () => {
  const event = runs.compactEvent({ name: 'compare', stage: 'compare', tally: { matched: 41, priceDiff: 14, missing: 5 }, count: 60, total: 60 }, 'now');
  assert.deepEqual(event.tally, { matched: 41, priceDiff: 14, missing: 5 });
  assert.ok(runs.RUN_EVENT_CAP >= 400, 'the kept window must fit a chatty preview');
});

test('the live panel fills its counters, its destination table and its product ticker', async () => {
  const { openReconLiveProgress, window } = await panelHarness();
  const live = openReconLiveProgress('پیش‌نمایش هماهنگ‌سازی (زنده)', 'در حال شروع…');
  const { steps } = await previewRun('worker');
  for (const event of steps) live.observe(event);
  live.finish();
  const panel = window.document.querySelector('.recon-live');
  const chips = [...panel.querySelectorAll('.recon-chip')].map(chip => chip.textContent.trim());
  assert.equal(chips.length, 6, 'one live counter per bucket');
  assert.ok(chips.some(chip => chip.startsWith('۴۱ هماهنگ')), 'the matched counter is live: ' + chips.join(' | '));
  assert.ok(chips.some(chip => chip.startsWith('۱۴ اختلاف قیمت')));
  const destinations = [...panel.querySelectorAll('[data-recon-dest-rows] tr')].map(tr => [...tr.children].map(td => td.textContent));
  assert.equal(destinations.length, 2, 'one row per destination');
  assert.deepEqual(destinations[0].slice(0, 4), ['ووکامرس', '۵۵', '۶۰ / ۶۰', '۳ / ۳']);
  assert.equal(destinations[0][5], '✓ تمام شد');
  assert.equal(destinations[1][5], '✗ پاسخ نداد');
  assert.ok(panel.querySelectorAll('[data-recon-ticker] li').length >= 10, 'the product ticker scrolls real comparisons');
  assert.ok(panel.querySelectorAll('[data-diag-activity] li').length >= 60, 'the evidence log keeps every line');
  assert.ok(panel.querySelectorAll('.diag-live-stage').length >= 15, 'each phase gets its own card');
});

// ——— the live table: full screen, filling while the run is still going (1.338.0) ————————
//
// The request: «دکمهٔ نمایش جدول آخر کار نمی‌کند، کلا جدول آن بصورت زنده و تمام صفحه پر شود، حتی
// هنگام اجرای بررسی مغایرت‌ها و پیش‌نمایش.» Two real defects were behind it: the viewer button was
// disabled together with the operation buttons while a run was in progress, and the report only
// existed in this browser's memory, so a reload (or a lost answer) left it with nothing to show.

/** Build the real panel out of the real dashboard source: matrix renderer + live window. */
async function panelHarness(options = {}) {
  const { parseHTML } = await import('linkedom');
  const dash = await read('worker-src/dashboard.ts');
  const matrix = dash.slice(dash.indexOf('const RECON_MATRIX_CSS='), dash.indexOf('function renderDuplicateReport('));
  const live = dash.slice(dash.indexOf('const RECON_STAGE_LABELS='), dash.indexOf('async function runReconUnifiedLive('));
  const { window } = parseHTML('<html><body><div id="resultModal"><div class="result-body"></div></div></body></html>');
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const notices = [], titles = [];
  // the live window now writes its own start/finish clock, so the harness needs the real helpers
  const helperSource = dash.slice(dash.indexOf('function faDigits('), dash.indexOf('function jobElapsed('));
  const helpers = new Function('fa', 'esc', helperSource + ';return {taskTimes,taskTimesHtml,taskClock,faSpan};')(progress.fa, esc);
  const built = new Function('esc', 'escAttr', 'fa', '$', 'modalShell', 'notice', 'document', 'setInterval', 'clearInterval', 'api', 'taskTimes',
    'let activeReconLive=null;' + matrix + live + ';return {openReconLiveProgress,openReconFullscreen,renderReconMatrix,reconLiveReport,reconSyncTable,syncTableModel};')(
    esc, esc, progress.fa, id => window.document.getElementById(id),
    (title, body) => { titles.push(title); window.document.querySelector('.result-body').innerHTML = body; },
    (message, kind) => notices.push([kind || 'ok', message]), window.document, () => 0, () => {},
    options.api || (async () => { throw Error('api not stubbed'); }), helpers.taskTimes);
  return { ...built, ...helpers, window, notices, titles, doc: window.document };
}
const matrixRows = doc => [...doc.querySelectorAll('[data-recon-matrix] .sync-table tbody tr[data-row]')];

for (const runtime of ['worker', 'render']) {
  test(runtime + ': the compared rows themselves are streamed while the comparison runs', async () => {
    const { events, report } = await previewRun(runtime);
    const chunks = events.filter(event => event.stage === 'rows-chunk');
    assert.ok(chunks.length >= 6, runtime + ': only ' + chunks.length + ' row batches were streamed');
    assert.ok(chunks.every(event => event.type === 'partial' && Array.isArray(event.rows) && event.rows.length), 'every batch carries its rows');
    const streamed = chunks.flatMap(event => event.rows);
    assert.equal(streamed.length, report.rows.length, 'the live table receives every compared row, not a sample');
    const reachable = chunks.filter(event => event.account === 'ووکامرس');
    assert.deepEqual(reachable.map(event => event.rowsCount), [10, 20, 30, 40, 50, 60], 'each batch reports the running count');
    assert.ok(chunks.some(event => event.account === 'غرفهٔ برف باکس' && event.rows.every(row => row.bucket === 'unreachable')),
      'a destination that failed also fills the table, marked as unreachable');
    const [row] = streamed;
    assert.deepEqual(Object.keys(row).sort(), ['accountKey', 'accountName', 'bucket', 'delta', 'duplicateCount', 'expectedPrice',
      'matchedBy', 'profileId', 'profileName', 'remoteId', 'remotePrice', 'remoteTitle', 'sourceKey', 'sourcePrice', 'target', 'title', 'why'],
      'a streamed row carries exactly the fields the matrix cell draws');
    assert.equal(row.bucket, 'priceDiff');
    assert.equal(row.expectedPrice, 101000);
    assert.equal(row.remotePrice, 94000);
  });
}

test('a streamed row is a trimmed copy, never the whole product record', () => {
  const row = progress.liveRow({ bucket: 'missing', target: 'woo', accountName: 'و'.repeat(90), title: 'ک'.repeat(200), why: 'ع'.repeat(300), sourcePrice: '120000', remotePrice: null, junk: 'x'.repeat(5000), data: { huge: true } });
  assert.equal(row.junk, undefined, 'unknown fields never travel');
  assert.equal(row.data, undefined);
  assert.ok(row.title.length <= 71 && row.accountName.length <= 41 && row.why.length <= 91, 'long text is clipped');
  assert.equal(row.sourcePrice, 120000, 'prices arrive as numbers');
  assert.equal(row.remotePrice, null);
  assert.equal(progress.liveRows(Array.from({ length: 500 }, () => ({ bucket: 'matched' }))).length, progress.LIVE_ROW_CHUNK);
});

test('a polled background run carries the same rows, bounded twice', async () => {
  const event = runs.compactEvent({ stage: 'rows-chunk', account: 'ووکامرس', rowsCount: 60, rows: Array.from({ length: 500 }, (_, i) => ({ bucket: 'priceDiff', title: 'کالا ' + i, remotePrice: i, junk: 'x' })) }, 'now');
  assert.equal(event.rows.length, runs.RUN_ROW_CHUNK, 'one stored event stays small');
  assert.equal(event.rowsCount, 60);
  assert.equal(event.rows[0].junk, undefined);
  assert.equal(event.rows[0].remotePrice, 0);
  const { events } = await previewRun('worker');
  const written = [];
  await runs.startMaintenanceRun('recon-unified', async observe => { for (const item of events) observe(item); return { ok: true }; },
    { getState: async () => null, setState: async (_key, value) => written.push(value) });
  await new Promise(resolve => setTimeout(resolve, 50));
  const stored = written.filter(value => value && Array.isArray(value.events)).at(-1);
  const carried = stored.events.filter(event => event.rows);
  assert.ok(carried.length >= 6, 'the polled run also receives the rows');
  const total = carried.reduce((n, event) => n + event.rows.length, 0);
  assert.ok(total > 0 && total <= runs.RUN_ROW_BUDGET, 'a whole run never stores more than its row budget: ' + total);
});

test('the live window is full screen and its matrix fills while the run is still going', async () => {
  const panel = await panelHarness();
  const live = panel.openReconLiveProgress('پیش‌نمایش هماهنگ‌سازی (زنده)', 'در حال شروع…');
  assert.ok(panel.doc.getElementById('resultModal').className.includes('result-modal-full'), 'the live window opens full screen');
  const { events } = await previewRun('worker');
  let midRun = 0;
  for (const event of events) {
    live.observe(event);
    if (!midRun && event.stage === 'account-fetched') assert.equal(matrixRows(panel.doc).length, 0, 'nothing is drawn before the first comparison');
    if (event.stage === 'rows-chunk' && !midRun) midRun = matrixRows(panel.doc).length;
  }
  assert.ok(midRun >= 1 && midRun <= 15, 'the table already had rows in the middle of the run: ' + midRun);
  live.finish();
  const rows = matrixRows(panel.doc);
  assert.equal(rows.length, 60, 'every compared product ends up in the live table');
  const head = [...panel.doc.querySelectorAll('[data-recon-matrix] thead th')].map(th => th.textContent);
  assert.deepEqual(head, ['محصول', 'قیمت پایه در مبدأ', '🛒 ووکامرس', '🏪 غرفهٔ برف باکس'],
    'the table reads left to right: product, source price, then one column per destination — woocommerce first');
  const first = [...rows[0].children].map(cell => cell.textContent);
  assert.match(first[0], /^کفش مدل \d+ \(کد \d+\)/, 'column one is the product name from the saved profile');
  assert.match(first[0], /ردیف ۱/, 'and it is numbered, because the run starts at row one');
  assert.match(first[1], /^[۰-۹٬]+$/, 'column two is the base price at the source');
  assert.equal(rows[0].querySelectorAll('[data-cell]').length, 2, 'every destination has a cell on every row');
  assert.equal(rows[0].querySelector('[data-cell]').getAttribute('data-state'), 'priceDiff',
    'the run starts with the rows that actually need work');
  assert.match(first[2], /←/, 'a price-difference cell shows «قیمت مقصد ← قیمت درست»');
  assert.match(panel.doc.querySelector('[data-recon-matrix] .sync-banner').textContent, /در حال پر شدن — تا این لحظه ۶۰ محصول در ۲ مقصد/);
  assert.equal(panel.doc.querySelector('[data-recon-matrix-note]').textContent, '۱۲۰ سطر مقایسه در ۲ مقصد تا این لحظه');
});

test('a single-destination run still gets a named column in the live table', async () => {
  const panel = await panelHarness();
  const live = panel.openReconLiveProgress('مغایرت‌گیری ووکامرس', 'شروع…');
  live.observe({ type: 'partial', stage: 'rows-partial', target: 'woo', rowsCount: 2, rows: [
    { bucket: 'priceDiff', title: 'کیف (کد ۳)', sourcePrice: 300000, expectedPrice: 300000, remotePrice: 250000, remoteId: 7 },
    { bucket: 'matched', title: 'کفش (کد ۱)', sourcePrice: 100000, expectedPrice: 100000, remotePrice: 100000, remoteId: 8 }] });
  live.finish();
  const head = [...panel.doc.querySelectorAll('[data-recon-matrix] thead th')].map(th => th.textContent);
  assert.equal(head.at(-1), '🛒 ووکامرس', 'the destination name is taken from the event when the row has none');
  assert.equal(matrixRows(panel.doc).length, 2);
});

test('«نمایش جدول آخر» works with no report in this browser: it reads the stored one', async () => {
  const { report } = await previewRun('worker');
  let asked = '';
  const panel = await panelHarness({ api: async path => { asked = path; return { ok: true, report, at: '2026-10-07T09:00:00.000Z' }; } });
  await panel.openReconFullscreen();
  assert.equal(asked, '/api/maintenance/recon-last', 'the panel asks the server for the last stored report');
  assert.equal(panel.doc.getElementById('resultModal').className, 'result-modal-full recon-fit', 'the stored table opens full screen, fitted to the device');
  assert.ok(panel.doc.querySelectorAll('.result-body .sync-table tbody tr').length >= 60, 'the stored report is drawn as the sync table');
  assert.ok(panel.doc.querySelectorAll('.result-body .rc-table tbody tr').length >= 60, 'the full matrix stays available under its fold');
  assert.match(panel.doc.querySelector('.rc-note').textContent, /آخرین پیش‌نمایش ذخیره‌شدهٔ سرور خوانده شد · زمان ثبت: 2026-10-07T09:00:00.000Z/);
});

test('«نمایش جدول آخر» during a run reopens the live window instead of doing nothing', async () => {
  const { events } = await previewRun('worker');
  const panel = await panelHarness();
  const live = panel.openReconLiveProgress('پیش‌نمایش هماهنگ‌سازی (زنده)', 'شروع…');
  for (const event of events.slice(0, 20)) live.observe(event);
  panel.doc.querySelector('.result-body').innerHTML = '<p>پنجره بسته شد</p>';
  await panel.openReconFullscreen();
  assert.ok(panel.doc.querySelector('.recon-live'), 'the live panel comes back');
  assert.ok(panel.doc.getElementById('resultModal').className.includes('result-modal-full'));
  assert.deepEqual(panel.notices.at(-1), ['info', 'یک مقایسهٔ زنده در جریان است؛ جدول در همین پنجره سطر‌به‌سطر پر می‌شود.']);
});

test('with nothing stored anywhere the button says what to do, not nothing', async () => {
  const panel = await panelHarness({ api: async () => ({ ok: false, report: null, at: '' }) });
  await panel.openReconFullscreen();
  assert.deepEqual(panel.notices.at(-1), ['error', 'هنوز هیچ جدولی ساخته نشده است؛ یک‌بار «بررسی مغایرت‌ها و پیش‌نمایش هماهنگ‌سازی» را اجرا کنید.']);
});

test('the viewer button is never disabled by a running operation, and both runtimes serve it', async () => {
  const dash = await read('worker-src/dashboard.ts');
  assert.ok(dash.includes('[data-menu="recon"] button[data-ma]:not([data-ma="recon-fullscreen"])'),
    'the fullscreen viewer must stay clickable while a reconciliation runs');
  assert.ok(dash.includes("if(action==='recon-fullscreen')return await openReconFullscreen();"));
  for (const source of ['worker-src/app.ts', 'render-src/server.ts']) {
    const text = await read(source);
    assert.ok(text.includes("app.get('/api/maintenance/recon-last'"), source + ' does not serve the stored report');
    assert.ok(text.includes("getState<any>('recon_unified',null)"), source + ' must answer from the report the preview already stores');
  }
});

// ——— pressing «بررسی مغایرت‌ها و پیش‌نمایش» really shows the live table (1.339.0) ————————
//
// The window was there, but on a host that cuts live streams the loop had LEARNED the silent
// «درخواست ساده» shape — and that shape reports nothing at all, so every later preview ran blind:
// an open window with an empty table. Now a run that feeds a live window starts with a shape that
// can report (stream, or the background run), says which shape is feeding it, and ends by drawing
// the complete table inside the same full-screen window.

/** Press the real preview button against a stubbed host that behaves like `mode`. */
async function pressPreview(mode, options = {}) {
  const { parseHTML } = await import('linkedom');
  const dash = await read('worker-src/dashboard.ts');
  const cut = (from, to) => dash.slice(dash.indexOf(from), dash.indexOf(to));
  const { report, events } = await previewRun('worker');
  const { window } = parseHTML('<html><body><div id="resultModal"><div class="result-body"></div></div><div id="reconResult"></div></body></html>');
  const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const store = { ...(options.learned ? { 's4.maint.shape:recon-unified': options.learned } : {}) };
  const notices = [], tried = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const activityFetch = async url => {
    const target = String(url);
    tried.push(target);
    if (target.includes('live=1')) {
      if (mode !== 'stream') return new Response('<html>proxy</html>', { status: 502, headers: { 'content-type': 'text/html' } });
      const lines = [{ type: 'started' }, ...events.map(event => ({ ...event, type: 'progress' })), { type: 'result', data: report }];
      return new Response(new ReadableStream({ start(controller) { for (const line of lines) controller.enqueue(new TextEncoder().encode(JSON.stringify(line) + '\n')); controller.close(); } }),
        { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
    }
    if (target.includes('/api/maintenance/run/')) {
      const since = Number(new URL(target, 'http://host').searchParams.get('since') || 0);
      const batch = events.slice(since, since + 12), done = since + batch.length >= events.length;
      return json({ ok: true, run: { id: 'r1', status: done ? 'done' : 'running', events: batch, eventCount: events.length, result: done ? report : undefined } });
    }
    if (target.endsWith('/api/maintenance/run')) return mode === 'job' ? json({ ok: true, run: { id: 'r1', status: 'running', events: [], eventCount: 0 } }) : json({ error: 'این مسیر نیست' }, 404);
    return mode === 'stream' ? json({ error: 'باید از جریان می‌آمد' }, 500) : json(report);
  };
  const io = {
    esc, escAttr: esc, fa: progress.fa, $: id => window.document.getElementById(id),
    modalShell: (_title, body) => { window.document.querySelector('.result-body').innerHTML = body; },
    notice: (message, kind) => notices.push([kind || 'ok', message]), document: window.document,
    setInterval: () => 0, clearInterval: () => {}, setTimeout: fn => globalThis.setTimeout(fn, 0),
    activityFetch, U: path => 'http://host' + path, headers: () => ({}), activityResponseResult: () => {},
    output: () => {}, state: { selected: 'p1' }, api: async () => ({ ok: false }),
    localStorage: { getItem: key => store[key] || null, setItem: (key, value) => { store[key] = value; } },
    taskTimes: new Function('fa', 'esc', dash.slice(dash.indexOf('function faDigits('), dash.indexOf('function jobElapsed(')) + ';return taskTimes;')(progress.fa, esc)
  };
  const built = new Function(...Object.keys(io), 'let activeReconLive=null;'
    + cut('let maintenanceBusy', 'async function apiRequest(')
    + cut('const RECON_MATRIX_CSS=', 'function renderDuplicateReport(')
    + cut('const RECON_STAGE_LABELS=', 'async function runReconTableLive(')
    + ';return {runReconUnifiedLive,maintenanceShapeOrder};')(...Object.values(io));
  const result = await built.runReconUnifiedLive(false);
  const panel = window.document.querySelector('.recon-live');
  return { built, result, panel, notices, tried, store, window, report };
}

test('a live window always starts with a shape that can actually report progress', async () => {
  const { built } = await pressPreview('stream');
  const order = (readOnly, wants) => built.maintenanceShapeOrder('x', readOnly, wants).map(shape => shape.id);
  assert.deepEqual(order(true, false), ['stream', 'json', 'json-small', 'json-tiny', 'job'], 'a caller without a live window keeps the old order');
  assert.deepEqual(order(true, true), ['stream', 'job', 'json', 'json-small', 'json-tiny'], 'the two shapes that report come first');
  assert.deepEqual(order(false, true), ['job', 'stream', 'json', 'json-small', 'json-tiny'], 'a mutating run still starts in the background');
  const blind = await pressPreview('json', { learned: 'json' });
  assert.deepEqual(blind.built.maintenanceShapeOrder('recon-unified', true, true).map(shape => shape.id), ['job', 'json', 'stream', 'json-small', 'json-tiny'],
    'a learned silent shape means the stream already failed here: try the background run first, not the stream again');
});

for (const [mode, learned, expected] of [['stream', '', 'جریان زنده (NDJSON) · گزارش زنده دارد'],
  ['job', '', 'اجرای پس‌زمینه + پیگیری کوتاه · گزارش زنده دارد'],
  ['json', 'json', 'درخواست ساده (بدون جریان) · این شکل گزارش زنده نمی‌دهد؛ جدول در پایان کار یک‌جا پر می‌شود']]) {
  test('pressing the preview button on a «' + mode + '» host ends with the full table in the same window', async () => {
    const { result, panel, window, store } = await pressPreview(mode, { learned });
    assert.equal(result.planned, 19, 'the preview still returns its real answer');
    assert.ok(panel, 'the live window is the result window — it is not thrown away');
    assert.ok(window.document.getElementById('resultModal').className.includes('result-modal-full'), 'and it stays full screen');
    assert.equal(panel.querySelector('[data-recon-shape]').textContent, 'شکل درخواست: ' + expected, 'the window says, honestly, what is feeding it');
    const rows = panel.querySelectorAll('[data-recon-matrix] .sync-table tbody tr');
    assert.equal(rows.length, 60, mode + ': the finished table holds every compared product');
    assert.match(panel.querySelector('[data-recon-matrix-note]').textContent, /جدول کامل: ۱۲۰ سطر مقایسه/);
    assert.match(panel.querySelector('[data-recon-matrix] .sync-banner').textContent, /پیش‌نمایش: ۱۹ اقدام آمادهٔ اجراست/, 'the final banner replaces the live one');
    if (mode !== 'json') {
      assert.ok(panel.querySelectorAll('[data-diag-activity] li').length >= 30, mode + ': the evidence log filled while the run was going');
      assert.ok(panel.querySelectorAll('.diag-live-stage').length >= 15, mode + ': every phase was reported live');
      assert.ok(['stream', 'job'].includes(store['s4.maint.shape:recon-unified']), 'the winning shape is remembered');
    }
  });
}

// ۱.۳۴۰.۰ — «پنجرهٔ پیش‌نمایش بسیار نامفهوم است»: یک جدول، به زبان خودِ فروشنده.
// ستون اول نام محصول (از پروفایل‌های ذخیره‌شده)، ستون دوم قیمت پایه در سایت مبدأ، بعد ووکامرس
// و بعد هر غرفهٔ باسلام — و هر خانه با رنگ می‌گوید هست/نیست و قیمتش درست است یا نه.

test('the sync table reads like a shopkeeper ledger: product, source price, then one column per destination', async () => {
  const { syncTableModel, reconSyncTable } = await panelHarness();
  const rows = [
    { bucket: 'priceDiff', target: 'woo', accountKey: 'default', accountName: 'ووکامرس', profileId: 'p1', profileName: 'برف باکس', sourceKey: 's1', title: 'کیف', sourcePrice: 200000, expectedPrice: 240000, remotePrice: 200000, remoteId: 11 },
    { bucket: 'missing', target: 'basalam', accountKey: '735703', accountName: 'غرفهٔ برف باکس', profileId: 'p1', profileName: 'برف باکس', sourceKey: 's1', title: 'کیف', sourcePrice: 200000, expectedPrice: 240000 },
    { bucket: 'matched', target: 'woo', accountKey: 'default', accountName: 'ووکامرس', profileId: 'p1', profileName: 'برف باکس', sourceKey: 's2', title: 'کفش', sourcePrice: 100000, expectedPrice: 100000, remotePrice: 100000, remoteId: 12 },
    { bucket: 'extra', target: 'woo', accountKey: 'default', accountName: 'ووکامرس', remoteTitle: 'محصول قدیمی مقصد', remoteId: 99 }
  ];
  const model = syncTableModel(rows);
  assert.deepEqual(model.columns.map(column => column.name), ['ووکامرس', 'غرفهٔ برف باکس'], 'woocommerce comes first, then every stall');
  assert.deepEqual(model.products.map(product => product.title), ['کیف', 'کفش'], 'the row that needs work comes before the row that is already in sync');
  assert.equal(model.products.length, 2, 'a product that exists only at the destination is not a profile product, so it is not a row');
  assert.equal(model.products[0].sourcePrice, 200000, 'the base price is taken from the source side');

  const html = reconSyncTable(rows, { planned: 2 });
  assert.match(html, /قیمت پایه در مبدأ/, 'column two is named in plain Persian');
  assert.match(html, /🛒 ووکامرس/);
  assert.match(html, /🏪 غرفهٔ برف باکس/);
  assert.match(html, /پیش‌نمایش: ۲ اقدام آمادهٔ اجراست/, 'the banner says how much work is waiting');
  assert.match(html, /اجرا از ردیف اول همین جدول شروع می‌شود/, 'and promises the order the apply will follow');
  assert.match(html, /data-row="p1\|s1"/, 'each row carries its product identity so the apply can light it up');
  assert.match(html, /data-cell="p1\|s1\|\|woo:default" data-state="priceDiff"/);
  assert.match(html, /data-cell="p1\|s1\|\|basalam:735703" data-state="missing"/);
  assert.match(html, /۲۰۰٬۰۰۰ ← ۲۴۰٬۰۰۰/, 'a wrong price shows what it is and what it should become');
  assert.match(html, /باید ۲۴۰٬۰۰۰/, 'a missing product shows the price it would be created with');
  for (const label of ['هست · قیمت درست', 'هست · قیمت فرق دارد', 'در مقصد نیست', 'مقصد پاسخ نداد'])
    assert.ok(html.includes(label), 'the colours are explained in a legend: ' + label);
});

test('a destination a product is not sent to is drawn as a quiet dash, not as a failure', async () => {
  const { reconSyncTable } = await panelHarness();
  const html = reconSyncTable([
    { bucket: 'matched', target: 'woo', accountKey: 'default', accountName: 'ووکامرس', profileId: 'p1', sourceKey: 's1', title: 'کیف', sourcePrice: 1000, expectedPrice: 1000, remotePrice: 1000 },
    { bucket: 'noPrice', target: 'basalam', accountKey: 'a2', accountName: 'غرفهٔ دوم', profileId: 'p1', sourceKey: 's2', title: 'کفش' }
  ], {});
  assert.match(html, /data-cell="p1\|s1\|\|basalam:a2" data-state="none"/, 'the untouched cell is «none», with its own colour');
  assert.match(html, /برای این مقصد ارسال نمی‌شود/);
  assert.match(html, /قیمت مبدأ ثبت نشده/);
});

test('the apply order and the table order are the same order: first row first', async () => {
  const order = progress.planOrder([
    { kind: 'create', target: 'basalam', accountName: 'غرفهٔ ب', title: 'ب' },
    { kind: 'other', target: 'woo', accountName: 'ووکامرس', title: 'آ' },
    { kind: 'updatePrice', target: 'woo', accountName: 'ووکامرس', title: 'ی' },
    { kind: 'updatePrice', target: 'basalam', accountName: 'غرفهٔ الف', title: 'آ' }
  ]).map(action => action.kind + ':' + action.title);
  assert.deepEqual(order, ['updatePrice:آ', 'updatePrice:ی', 'create:ب', 'other:آ'],
    'prices first (cheapest, safest), then creations, then the rest — alphabetical inside each group');
  for (const runtime of ['worker', 'render']) {
    const source = await read(runtime + '-src/maintenance.ts');
    assert.ok(source.includes('const ordered=planOrder(plan.applicable)'), runtime + ': the apply really walks that order');
    assert.ok(source.includes('const actions=ordered.slice(0,cap)'), runtime + ': and the cap is applied after the sort, not before');
  }
});

test('pressing «اعمال هماهنگ‌سازی» lights the table up row by row, from the first row', async () => {
  const panel = await panelHarness();
  const live = panel.openReconLiveProgress('هماهنگ‌سازی یکپارچه (اجرای زنده)', 'در حال شروع…');
  live.observe({ type: 'partial', stage: 'rows-chunk', target: 'woo', account: 'ووکامرس', rowsCount: 2, rows: [
    { bucket: 'priceDiff', target: 'woo', accountKey: 'default', accountName: 'ووکامرس', profileId: 'p1', sourceKey: 's1', title: 'کیف', sourcePrice: 200000, expectedPrice: 240000, remotePrice: 200000 },
    { bucket: 'missing', target: 'basalam', accountKey: '735703', accountName: 'غرفهٔ برف باکس', profileId: 'p1', sourceKey: 's2', title: 'کفش', sourcePrice: 100000, expectedPrice: 120000 }
  ] });
  live.observe({ type: 'progress', stage: 'report-ready', summary: 'آماده' });
  const rowOf = id => panel.doc.querySelector('[data-row="' + id + '"]');
  assert.ok(rowOf('p1|s1') && rowOf('p1|s2'), 'both products are on the table before anything is written');

  live.observe({ type: 'progress', stage: 'apply', name: 'apply', status: 'running', count: 1, total: 2, summary: 'نوشتن قیمت', target: 'woo', account: 'ووکامرس', accountKey: 'default', profileId: 'p1', sourceKey: 's1', price: 240000 });
  const cell = rowOf('p1|s1').querySelector('[data-cell$="woo:default"]');
  assert.equal(cell.getAttribute('data-state'), 'working', 'the cell being written says so while it is happening');
  assert.match(cell.textContent, /در حال نوشتن…/);
  assert.ok(rowOf('p1|s1').className.includes('sync-active'), 'and its row is highlighted');
  assert.match(panel.doc.querySelector('[data-recon-apply-progress]').textContent, /اجرای اقدام‌ها: ۱ از ۲/);

  live.observe({ type: 'progress', stage: 'apply-written', name: 'apply', status: 'done', count: 1, total: 2, summary: 'نوشته شد', target: 'woo', account: 'ووکامرس', accountKey: 'default', profileId: 'p1', sourceKey: 's1', price: 240000 });
  assert.equal(rowOf('p1|s1').querySelector('[data-cell$="woo:default"]').getAttribute('data-state'), 'written');
  assert.match(rowOf('p1|s1').querySelector('[data-cell$="woo:default"]').textContent, /۲۴۰٬۰۰۰/, 'the new price is shown in the cell itself');
  assert.ok(rowOf('p1|s1').className.includes('sync-done'));

  live.observe({ type: 'progress', stage: 'queued', name: 'apply', status: 'done', count: 2, total: 2, summary: 'به صف رفت', target: 'basalam', account: 'غرفهٔ برف باکس', accountKey: '735703', profileId: 'p1', sourceKey: 's2' });
  assert.equal(rowOf('p1|s2').querySelector('[data-cell$="basalam:735703"]').getAttribute('data-state'), 'queued');
  assert.ok(!rowOf('p1|s1').className.includes('sync-active'), 'only one row is the active row at a time');
  assert.ok(rowOf('p1|s2').className.includes('sync-active'));

  live.observe({ type: 'progress', stage: 'apply-error', name: 'apply', status: 'error', count: 2, total: 2, summary: 'HTTP 502', target: 'woo', account: 'ووکامرس', accountKey: 'default', profileId: 'p1', sourceKey: 's2' });
  assert.equal(rowOf('p1|s2').querySelector('[data-cell$="woo:default"]').getAttribute('data-state'), 'failed');
  assert.match(rowOf('p1|s2').querySelector('[data-cell$="woo:default"]').textContent, /ناموفق/);
});

test('the window puts the table first and folds the engineering away', async () => {
  const dash = await read('worker-src/dashboard.ts');
  const panelStart = dash.indexOf('<div class="recon-live-matrix">');
  const fold = dash.indexOf('🛠 جزئیات فنی اجرا', panelStart);
  assert.ok(panelStart > 0 && fold > panelStart, 'the table is above the technical fold');
  for (const hook of ['data-recon-phases', 'data-recon-dest-table', 'data-recon-ticker', 'data-diag-stages', 'data-diag-activity'])
    assert.ok(dash.indexOf(hook, panelStart) > fold, hook + ' now lives inside the fold, not in the operator face');
});

// ۱.۳۴۱.۰ — «ریکوئست‌ها هم‌زمان و موازی برای ووکامرس و هر غرفهٔ باسلام فرستاده شوند، جدول به‌محض
// رسیدن پاسخ پر شود، و همهٔ ستون‌ها از همان اول دیده شوند.»

test('every destination is read at the same time, not one after the other', async () => {
  for (const runtime of ['worker', 'render']) {
    const source = await read(runtime + '-src/maintenance.ts');
    assert.ok(source.includes('await Promise.all(accounts.map(async(account,idx)=>{'),
      runtime + ': WooCommerce and every Basalam stall must start together');
    assert.ok(!/for\(let idx=0;idx<accounts\.length;idx\+\+\)/.test(source), runtime + ': the old one-by-one loop is gone');
    assert.ok(source.includes('for(const list of perAccount)rows.push(...list)'),
      runtime + ': the report rows stay in destination order, so the numbers stay deterministic');
    assert.ok(source.includes('const LEDGER_PAGE_PARALLEL=4'), runtime + ': the 100-item pages are fetched in parallel batches');
    assert.ok(source.includes('const results=await Promise.all(pages.map(page=>fetchLedgerPage(account,page,totalPages,onProgress)))'),
      runtime + ': …and merged in page order');
    assert.ok(source.includes('perPage:100'), runtime + ': each request still asks for a 100-item page');
  }
});

test('a slow destination no longer blocks a fast one: the fast rows arrive first', async () => {
  const order = [];
  const { report, events } = await previewRun('worker', { io: {
    reconAccounts: async () => [
      { target: 'basalam', accountKey: 'slow', name: 'غرفهٔ کند' },
      { target: 'woo', accountKey: 'default', name: 'ووکامرس' }
    ],
    remoteForAccount: async account => {
      order.push('start:' + account.name);
      // The slow stall answers after the fast shop, even though it was listed first.
      await new Promise(resolve => setTimeout(resolve, account.accountKey === 'slow' ? 40 : 1));
      order.push('done:' + account.name);
      return [];
    }
  } });
  assert.deepEqual(order.slice(0, 2), ['start:غرفهٔ کند', 'start:ووکامرس'], 'both requests leave before either answer arrives');
  assert.deepEqual(order.slice(2), ['done:ووکامرس', 'done:غرفهٔ کند'], 'and the fast one is processed as soon as it lands');
  const fetched = events.filter(event => event.stage === 'account-fetched').map(event => event.account);
  assert.deepEqual(fetched, ['ووکامرس', 'غرفهٔ کند'], 'the live window hears about the fast destination first');
  assert.equal(report.accounts, 2);
  const parallel = events.find(event => event.stage === 'accounts-parallel');
  assert.ok(parallel, 'the window is told, in words, that the destinations run together');
  assert.deepEqual(parallel.accounts.map(account => account.name), ['غرفهٔ کند', 'ووکامرس'], 'and it carries the column list');
  assert.match(parallel.summary, /هم‌زمان/);
});

test('the rows of the first destination to answer are streamed before the slow one finishes', async () => {
  const { events: seen } = await previewRun('worker', { io: {
    reconAccounts: async () => [
      { target: 'basalam', accountKey: 'slow', name: 'غرفهٔ کند' },
      { target: 'woo', accountKey: 'default', name: 'ووکامرس' }
    ],
    remoteForAccount: async (account, _force, onProgress) => {
      await new Promise(resolve => setTimeout(resolve, account.accountKey === 'slow' ? 40 : 1));
      onProgress?.({ type: 'ledger-page-done', page: 1, totalPages: 1, fetched: 1 });
      return [{ id: 1, name: 'کفش مدل 1 (کد 1)', price: 101000, sku: '', status: 'publish' }];
    }
  } });
  const firstRows = seen.find(event => event.stage === 'rows-chunk');
  assert.ok(firstRows, 'rows were streamed while the run was still going');
  assert.equal(firstRows.account, 'ووکامرس', 'the first table rows belong to the destination that answered first');
});

test('all the columns are on the table before a single row has been compared', async () => {
  const panel = await panelHarness();
  const live = panel.openReconLiveProgress('پیش‌نمایش هماهنگ‌سازی (زنده)', 'در حال شروع…');
  live.observe({ type: 'progress', stage: 'accounts-parallel', name: 'accounts', summary: 'هم‌زمان', count: 3, total: 3,
    accounts: [{ target: 'woo', accountKey: 'default', name: 'ووکامرس' },
      { target: 'basalam', accountKey: '735703', name: 'غرفهٔ برف باکس' },
      { target: 'basalam', accountKey: '900', name: 'غرفهٔ دوم' }] });
  const head = () => [...panel.doc.querySelectorAll('[data-recon-matrix] thead th')].map(th => th.textContent);
  assert.deepEqual(head(), ['محصول', 'قیمت پایه در مبدأ', '🛒 ووکامرس', '🏪 غرفهٔ برف باکس', '🏪 غرفهٔ دوم'],
    'every destination has its column from the first second, even before any answer');
  assert.match(panel.doc.querySelector('[data-recon-matrix]').textContent, /همهٔ مقصدها هم‌زمان در حال خوانده شدن‌اند/);
  assert.match(panel.doc.querySelector('[data-recon-matrix-note]').textContent, /ستون‌ها آماده‌اند: ۳ مقصد/);
  assert.equal([...panel.doc.querySelectorAll('[data-recon-dest-rows] tr')].length, 3, 'the technical destination table is seeded too');

  // The first stall answers; its cells fill, the other stalls stay «waiting», not «missing».
  live.observe({ type: 'partial', stage: 'rows-chunk', account: 'ووکامرس', target: 'woo', rowsCount: 1, rows: [
    { bucket: 'priceDiff', target: 'woo', accountKey: 'default', accountName: 'ووکامرس', profileId: 'p1', sourceKey: 's1', title: 'کیف', sourcePrice: 200000, expectedPrice: 240000, remotePrice: 200000 }] });
  assert.deepEqual(head(), ['محصول', 'قیمت پایه در مبدأ', '🛒 ووکامرس', '🏪 غرفهٔ برف باکس', '🏪 غرفهٔ دوم'], 'the columns do not move when rows arrive');
  const row = panel.doc.querySelector('[data-row="p1|s1"]');
  assert.equal(row.querySelector('[data-cell$="woo:default"]').getAttribute('data-state'), 'priceDiff');
  assert.equal(row.querySelector('[data-cell$="basalam:735703"]').getAttribute('data-state'), 'pending', 'a destination that has not answered yet says so');
  assert.match(row.querySelector('[data-cell$="basalam:900"]').textContent, /در انتظار پاسخ این مقصد/);
});


// ——— the preview window on a phone (1.343.0) ——————————————————————————————————
//
// The request: «پنجره پیش‌نمایش هماهنگ‌سازی، موبایل پسند باشد، فقط جدول‌ها اسکرولی باشند.»
// On a phone the window used to be one long scrolling page: the hero, the status lines, the
// legend and the table all scrolled together, so the table header walked off the screen and the
// sticky product column lost its meaning. Now the window is exactly as tall as the device and
// the only things that scroll are the tables.

test('the preview window is fitted to the device and marks itself as such', async () => {
  const panel = await panelHarness();
  panel.openReconLiveProgress('پیش‌نمایش هماهنگ‌سازی (زنده)', 'شروع…');
  const classes = panel.doc.getElementById('resultModal').className.split(/\s+/);
  assert.ok(classes.includes('result-modal-full'), 'still full screen');
  assert.ok(classes.includes('recon-fit'), 'and fitted, so the body itself never scrolls');
});

test('only the tables scroll: the window chrome is pinned and the table wrapper takes the rest', async () => {
  const dash = await read('worker-src/dashboard.ts');
  const css = dash.slice(dash.indexOf('.result-modal-full{padding:0}'), dash.indexOf('.result-box{width:min(1050px,97vw)'));
  assert.match(css, /\.recon-fit \.result-body\{[^}]*overflow:hidden/, 'the modal body is not a scroller any more');
  assert.match(css, /\.recon-fit \.result-body>\*\{flex:0 0 auto\}/, 'banner, legend and hero keep their natural height');
  assert.match(css, /\.recon-fit \.result-body>\.sync-wrap\{flex:1 1 auto/, 'the final table takes every remaining pixel');
  assert.match(css, /\.recon-fit \[data-recon-matrix\]>\.sync-wrap\{flex:1 1 auto[^}]*max-height:none/, 'and so does the live one');
  assert.match(css, /\.recon-fit \.recon-live\{[^}]*overflow:hidden/, 'the live section is a column, not a page');
  assert.match(css, /\.recon-fit \.recon-ticker ol,\.recon-fit \.diag-activity-log\{max-height:none;overflow:visible\}/,
    'no scroller inside a scroller: the technical lists ride the details pane');
  assert.match(dash, /\.result-modal-full \.result-box\{[^}]*height:100dvh/, 'a phone browser bar no longer cuts the window off');
  assert.match(dash, /\.sync-wrap\{overflow:auto[^}]*overscroll-behavior:contain/, 'scrolling the table never drags the page behind it');
});

test('on a narrow screen the table keeps its sticky column and the chrome shrinks instead', async () => {
  const dash = await read('worker-src/dashboard.ts');
  const phone = dash.slice(dash.indexOf('@media(max-width:700px){.sync-sticky'), dash.indexOf('@media(max-height:560px)'));
  assert.match(phone, /\.sync-sticky\{min-width:132px/, 'the product column narrows but stays sticky');
  assert.match(phone, /\.sync-cell\{min-width:98px\}/, 'destination cells stay readable while the table scrolls sideways');
  assert.match(phone, /\.sync-legend\{flex-wrap:nowrap;overflow-x:auto/, 'the colour legend becomes one swipeable line instead of four stacked rows');
  assert.match(phone, /\.recon-fit \.diag-live-hero\{padding:\.5rem/, 'the hero gives its height back to the table');
  assert.match(dash, /@media\(max-height:560px\)\{\.recon-fit \.diag-live-hero\{display:none\}/, 'on a short screen the decoration disappears entirely');
});
