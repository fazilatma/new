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
  createReconProgress: progress.createReconProgress, describeLedgerEvent: progress.describeLedgerEvent,
  actionLine: progress.actionLine, faPrice: progress.faPrice, faDuration: progress.faDuration,
  faN: progress.fa, clipText: progress.clip, bucketTally: progress.bucketTally,
  tallySummary: progress.tallySummary, sampleLines: progress.sampleLines
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
