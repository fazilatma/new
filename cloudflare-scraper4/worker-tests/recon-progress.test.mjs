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
  assert.ok(dash.includes('<details class="diag-activity" open>'), 'the live log is open, not hidden behind a click');
});

test('the four silent buttons now open the same live panel', async () => {
  const dash = await read('worker-src/dashboard.ts');
  for (const pin of [
    "{action:'duplicates',readOnly:!apply,onEvent:live?live.observe:undefined}",
    "{action:'ledger-missing',readOnly:!apply,onEvent:live?live.observe:undefined}",
    "{action:kind+':'+target,readOnly:kind==='recon',onEvent:live?live.observe:undefined}"
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
    ...progressIo, ...core, ...dedup, PLAN_NOTE: 'فقط گزارش', msg: error => (error instanceof Error ? error.message : String(error)),
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
  const { parseHTML } = await import('linkedom');
  const dash = await read('worker-src/dashboard.ts');
  const block = dash.slice(dash.indexOf('const RECON_STAGE_LABELS='), dash.indexOf('async function runReconUnifiedLive('));
  const { window } = parseHTML('<html><body><div id="resultModal"><div class="result-body"></div></div></body></html>');
  const esc = v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const { openReconLiveProgress } = new Function('esc', 'fa', '$', 'modalShell', 'notice', 'document', 'setInterval', 'clearInterval',
    'let activeReconLive=null;' + block + ';return {openReconLiveProgress};')(
    esc, progress.fa, id => window.document.getElementById(id),
    (_t, body) => { window.document.querySelector('.result-body').innerHTML = body; }, () => {}, window.document, () => 0, () => {});
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
  const built = new Function('esc', 'escAttr', 'fa', '$', 'modalShell', 'notice', 'document', 'setInterval', 'clearInterval', 'api',
    'let activeReconLive=null;' + matrix + live + ';return {openReconLiveProgress,openReconFullscreen,renderReconMatrix,reconLiveReport};')(
    esc, esc, progress.fa, id => window.document.getElementById(id),
    (title, body) => { titles.push(title); window.document.querySelector('.result-body').innerHTML = body; },
    (message, kind) => notices.push([kind || 'ok', message]), window.document, () => 0, () => {},
    options.api || (async () => { throw Error('api not stubbed'); }));
  return { ...built, window, notices, titles, doc: window.document };
}
const matrixRows = doc => [...doc.querySelectorAll('[data-recon-matrix] .rc-table tbody tr')];

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
  assert.deepEqual(head.slice(4), ['🛒 ووکامرس', '🏪 غرفهٔ برف باکس'], 'one live column per destination');
  const first = [...rows[0].children].map(cell => cell.textContent);
  assert.equal(first[0], 'کفش مدل 1 (کد 1)');
  assert.equal(first[2], '۱۰۱٬۰۰۰');
  assert.match(first[4], /۹۴٬۰۰۰ ← ۱۰۱٬۰۰۰/, 'the live cell shows the real arithmetic');
  assert.match(first[5], /مقصد پاسخ نداد/);
  assert.match(panel.doc.querySelector('[data-recon-matrix] .rc-banner').textContent, /جدول زنده — تا این لحظه ۶۰ محصول در ۲ مقصد مقایسه شده است/);
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
  assert.equal(panel.doc.getElementById('resultModal').className, 'result-modal-full', 'the stored table opens full screen');
  assert.ok(panel.doc.querySelectorAll('.result-body .rc-table tbody tr').length >= 60, 'the stored report is drawn as the full matrix');
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
