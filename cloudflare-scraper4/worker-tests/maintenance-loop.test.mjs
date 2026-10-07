// «همهٔ بخش‌های مغایرت‌گیری خطا می‌دهند … Network error» — the reconciliation panel ran one fixed
// request shape (an NDJSON live stream) and any proxy that buffers or cuts that stream turned a
// working server operation into a bare browser error. These tests run the real loop sliced out of
// the panel against a scripted service: no DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = file => readFile(join(root, file), 'utf8');
const dashboard = await read('worker-src/dashboard.ts');

const start = dashboard.indexOf('const MAINT_SHAPES=[');
const end = dashboard.indexOf('// شروع کار روی سرور و بعد فقط پرسیدن حالش');
assert.ok(start > 0 && end > start, 'the maintenance loop must stay sliceable from the panel');
const js = (await transform(dashboard.slice(start, end), { loader: 'ts' })).code;

function panel(stored = {}) {
  const store = new Map(Object.entries(stored));
  const localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => void store.set(k, String(v)) };
  const exported = 'MAINT_SHAPES,classifyMaintenanceAnswer,maintenanceAdvice,maintenanceShapeOrder,summarizeMaintenanceAttempts,runMaintenanceLoop,maintenanceFailureHtml,maintenanceBody,maintenanceLearned,maintenanceOpName';
  const api = new Function('localStorage', 'esc', 'fa', js + ';return {' + exported + '};')(localStorage, String, v => String(v));
  return { ...api, store };
}

/** A scripted service: one answer per request shape, recorded in order. */
function service(script) {
  const asked = [];
  return {
    asked,
    perform: async shape => { asked.push(shape.id); const answer = script[shape.id]; return typeof answer === 'function' ? answer(shape) : answer; }
  };
}

const OK = { status: 200, contentType: 'application/json', data: { ok: true, planned: 3 } };

test('the shapes walk from live stream to smaller and smaller plain requests', () => {
  const p = panel();
  assert.deepEqual(p.MAINT_SHAPES.map(s => s.id), ['stream', 'json', 'json-small', 'json-tiny', 'job']);
  assert.equal(p.MAINT_SHAPES[0].live, true);
  assert.ok(p.MAINT_SHAPES.slice(1).every(s => !s.live), 'only the first shape asks for a stream');
  assert.ok(p.MAINT_SHAPES[2].limit > p.MAINT_SHAPES[3].limit, 'each fallback asks for less work');
  assert.equal(p.MAINT_SHAPES[4].job, true, 'the last resort keeps no connection open at all');
});

test('every answer gets a verdict and a Persian sentence, never a bare code', () => {
  const p = panel();
  const cases = [
    [{ status: 200, data: {} }, 'ok'],
    [{ partial: true, status: 200 }, 'cut'],
    [{ status: 0, error: 'Failed to fetch' }, 'cut'],
    [{ status: 0, error: 'مهلت' }, 'timeout'],
    [{ status: 524 }, 'timeout'],
    [{ status: 504 }, 'timeout'],
    [{ status: 502 }, 'proxy'],
    [{ status: 429 }, 'throttled'],
    [{ status: 403 }, 'auth'],
    [{ status: 404 }, 'missing'],
    [{ status: 500, error: 'boom' }, 'server'],
    [{ status: 200, contentType: 'text/html' }, 'proxy']
  ];
  for (const [answer, verdict] of cases) {
    const result = p.classifyMaintenanceAnswer(answer);
    assert.equal(result.verdict, verdict, JSON.stringify(answer));
    assert.ok(/[\u0600-\u06FF]/.test(result.note), 'the note must be Persian: ' + result.note);
    assert.ok(!/network error/i.test(result.note));
  }
});

test('a stream the proxy cuts is answered by the plain request, and the winner is remembered', async () => {
  const p = panel();
  const s = service({ stream: { status: 200, partial: true }, json: OK });
  const result = await p.runMaintenanceLoop({ action: 'recon-unified', readOnly: true, perform: s.perform });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, OK.data);
  assert.deepEqual(s.asked, ['stream', 'json']);
  assert.equal(result.attempts[0].verdict, 'cut');
  assert.equal(p.store.get('s4.maint.shape:recon-unified'), 'json');

  // next run starts from the learned shape and never asks for the broken stream again
  const again = panel({ 's4.maint.shape:recon-unified': 'json' });
  const s2 = service({ json: OK, stream: { status: 200, partial: true } });
  const second = await again.runMaintenanceLoop({ action: 'recon-unified', readOnly: true, perform: s2.perform });
  assert.deepEqual(s2.asked, ['json']);
  assert.equal(second.attempts.length, 1);
});

test('a browser-level network failure is not the end of the road', async () => {
  const p = panel();
  const s = service({ stream: { status: 0, error: 'TypeError: Failed to fetch' }, json: OK });
  const result = await p.runMaintenanceLoop({ action: 'duplicates', readOnly: true, perform: s.perform });
  assert.equal(result.ok, true);
  assert.deepEqual(s.asked, ['stream', 'json'], 'the dead stream must not be retried as a stream');
});

test('a gateway timeout shrinks the batch instead of repeating the same request', async () => {
  const p = panel();
  const s = service({ stream: { status: 200, partial: true }, json: { status: 504 }, 'json-small': { status: 504 }, 'json-tiny': OK });
  const result = await p.runMaintenanceLoop({ action: 'ledger-refresh', readOnly: true, perform: s.perform });
  assert.equal(result.ok, true);
  assert.deepEqual(s.asked, ['stream', 'json', 'json-small', 'json-tiny']);
  assert.equal(p.store.get('s4.maint.shape:ledger-refresh'), 'json-tiny');
  assert.match(p.summarizeMaintenanceAttempts(result.attempts), /json → 504\/timeout/);
});

test('the smaller shapes really ask the server to do less', () => {
  const p = panel();
  const small = p.MAINT_SHAPES.find(s => s.id === 'json-small');
  assert.equal(JSON.parse(p.maintenanceBody(JSON.stringify({ profileId: 'p1', limit: 1000 }), small)).limit, 100);
  assert.equal(JSON.parse(p.maintenanceBody(JSON.stringify({ limit: 20 }), small)).limit, 20, 'an already-small batch is never enlarged');
  assert.equal(JSON.parse(p.maintenanceBody(JSON.stringify({ profileId: 'p1' }), small)).limit, 100, 'a body without a limit gets one');
  assert.equal(p.maintenanceBody('{"a":1}', p.MAINT_SHAPES[1]), '{"a":1}', 'the full shape leaves the body alone');
  assert.equal(p.maintenanceBody(undefined, small), undefined);
});

test('a permission problem stops the loop at once and says it is not the network', async () => {
  const p = panel();
  const s = service({ stream: { status: 403, error: 'forbidden' } });
  const result = await p.runMaintenanceLoop({ action: 'duplicates', readOnly: true, perform: s.perform });
  assert.equal(result.ok, false);
  assert.equal(result.cause, 'auth');
  assert.equal(s.asked.length, 1, 'no point asking the same question in another shape');
  assert.match(result.advice, /دسترسی/);
  assert.ok(!p.store.has('s4.maint.shape:duplicates'));
});

test('a missing route is named as a version mismatch, not as an unstable network', async () => {
  const p = panel();
  const s = service({ stream: { status: 404 } });
  const result = await p.runMaintenanceLoop({ action: 'recon-unified', readOnly: true, perform: s.perform });
  assert.equal(result.cause, 'missing');
  assert.equal(s.asked.length, 1);
  assert.match(result.advice, /نسخه/);
});

test('a rate limit waits once and retries the very same shape', async () => {
  const p = panel();
  let calls = 0;
  const waited = [];
  const result = await p.runMaintenanceLoop({
    action: 'recon-table:woo',
    readOnly: true,
    pauseMs: 5,
    wait: async ms => void waited.push(ms),
    perform: async () => (++calls === 1 ? { status: 429 } : OK)
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
  assert.deepEqual(waited, [5]);
  assert.equal(result.attempts[0].verdict, 'throttled');
});

test('when every shape fails the panel gets a table, not the words Network error', async () => {
  const p = panel();
  const s = service({ stream: { status: 200, partial: true }, json: { status: 0, error: 'Failed to fetch' }, 'json-small': { status: 502 }, 'json-tiny': { status: 500, error: 'ledger is empty' }, job: { status: 500, error: 'ledger is empty' } });
  const result = await p.runMaintenanceLoop({ action: 'duplicates', readOnly: true, perform: s.perform });
  assert.equal(result.ok, false);
  assert.equal(result.attempts.length, 5, 'every shape, including the background one, is tried');
  assert.equal(result.cause, 'server');
  const html = p.maintenanceFailureHtml(result);
  assert.match(html, /ledger is empty/);
  assert.match(html, /جریان زنده/);
  assert.equal((html.match(/<tr>/g) || []).length, 6, 'one header row plus one row per attempt');
  assert.ok(!/undefined/.test(html));
});

test('the reconciliation buttons all go through the loop, with the routes that exist', async () => {
  const panelSource = dashboard;
  for (const needle of [
    "const path=apply?'/api/maintenance/recon-unified/apply':'/api/maintenance/recon-unified';",
    "maintenanceRequest(path,{method:'POST',body:JSON.stringify({profileId,confirm:apply?'APPLY':'',limit:200})}",
    "maintenanceRequest('/api/maintenance/recon-table/'+encodeURIComponent(target)",
    "maintenanceRequest('/api/maintenance/ledger/refresh'",
    "maintenanceRequest('/api/maintenance/duplicates'",
    "maintenanceRequest('/api/maintenance/'+kind+'/'+target",
    "maintenanceRequest('/api/maintenance/ledger/missing'"
  ]) assert.ok(panelSource.includes(needle), 'missing loop wiring: ' + needle);
  assert.ok(!panelSource.includes("'/api/maintenance/recon-unified/apply/live"), 'the apply path must not call a route that never existed');
  assert.ok(!panelSource.includes("isCloudflareProxyError(error)){notice('پروکسی جریان زنده را قطع کرد"), 'the ad-hoc single fallback is replaced by the loop');
  // the routes the loop talks to must answer both shapes in BOTH runtimes
  for (const file of ['worker-src/app.ts', 'render-src/server.ts']) {
    const source = await read(file);
    for (const route of ['/api/maintenance/recon-unified', '/api/maintenance/recon-unified/apply', '/api/maintenance/recon-table/:target', '/api/maintenance/ledger/refresh', '/api/maintenance/duplicates']) {
      assert.ok(source.includes("'" + route + "'"), file + ' must serve ' + route);
    }
  }
  const responder = await read('worker-src/maintenance-response.ts');
  assert.ok(responder.includes("c.req.query('live')!=='1'") && responder.includes("type:'heartbeat'"), 'the same route must answer plain JSON and a heartbeated stream');
});

test('an operation that may already be running on the server is never repeated by itself', async () => {
  const p = panel();
  const s = service({ job: { status: 200, partial: true }, stream: OK, json: OK });
  const result = await p.runMaintenanceLoop({ action: 'recon-unified-apply', readOnly: false, perform: s.perform });
  assert.equal(s.asked.length, 1, 'an apply/delete whose outcome is unknown must not be re-sent');
  assert.equal(result.ok, false);
  assert.equal(result.cause, 'unconfirmed');
  assert.match(result.advice, /تأیید نشده/);
  assert.match(result.advice, /دوباره اجرا نکنید/);
  assert.match(result.advice, /تازه‌سازی دفتر حساب/, 'the honest next step is to look, not to retry');

  // a rejection that proves nothing ran is still safe to classify and stop on
  const rejected = service({ job: { status: 403 } });
  const missing = await p.runMaintenanceLoop({ action: 'recon-unified-apply', readOnly: false, perform: rejected.perform });
  assert.equal(missing.cause, 'auth');
  assert.equal(rejected.asked.length, 1);
});

test('the panel marks previews read-only and apply/delete as unrepeatable', () => {
  for (const needle of [
    "readOnly:!apply,onEvent:live.observe",
    "{action:'recon-table:'+target,readOnly:true,",
    "{action:'ledger-refresh',readOnly:true,",
    "{action:'duplicates',readOnly:!apply}",
    "{action:kind+':'+target,readOnly:kind==='recon'}",
    "{action:'ledger-missing',readOnly:!apply}"
  ]) assert.ok(dashboard.includes(needle), 'missing read-only marking: ' + needle);
  assert.ok(dashboard.includes('readOnly:meta.readOnly'), 'maintenanceRequest must forward the flag');
});

test('an apply/delete starts in the background, where there is no long connection to cut', async () => {
  const p = panel();
  assert.deepEqual(p.maintenanceShapeOrder('x', false).map(s => s.id), ['job', 'stream', 'json', 'json-small', 'json-tiny']);
  assert.deepEqual(p.maintenanceShapeOrder('x', true).map(s => s.id), ['stream', 'json', 'json-small', 'json-tiny', 'job']);
  assert.deepEqual(p.maintenanceShapeOrder('x', undefined).map(s => s.id), ['stream', 'json', 'json-small', 'json-tiny', 'job'], 'an unmarked caller keeps the old order');

  const s = service({ job: OK });
  const result = await p.runMaintenanceLoop({ action: 'duplicates-apply', readOnly: false, perform: s.perform });
  assert.equal(result.ok, true);
  assert.deepEqual(s.asked, ['job']);
  assert.equal(p.store.get('s4.maint.shape:duplicates-apply'), 'job');
});

test('an old server without the background route is not a dead end', async () => {
  const p = panel();
  const s = service({ job: { status: 404 }, stream: OK });
  const result = await p.runMaintenanceLoop({ action: 'duplicates-apply', readOnly: false, perform: s.perform });
  assert.equal(result.ok, true, 'a 404 on the start request proves nothing ran, so another shape is fair');
  assert.deepEqual(s.asked, ['job', 'stream']);

  // but an unknown outcome after that still stops a destructive operation
  const fresh = panel();
  const unsure = service({ job: { status: 404 }, stream: { status: 0, error: 'Failed to fetch' } });
  const stopped = await fresh.runMaintenanceLoop({ action: 'duplicates-apply', readOnly: false, perform: unsure.perform });
  assert.equal(stopped.cause, 'unconfirmed');
  assert.deepEqual(unsure.asked, ['job', 'stream']);
});

test('the background op name is derived from the very route the button already used', () => {
  const p = panel();
  const cases = [
    ['/api/maintenance/recon-unified', 'recon-unified'],
    ['/api/maintenance/recon-unified/apply', 'recon-unified-apply'],
    ['/api/maintenance/ledger/refresh', 'ledger-refresh'],
    ['/api/maintenance/ledger/missing', 'ledger-missing'],
    ['/api/maintenance/duplicates', 'duplicates'],
    ['/api/maintenance/recon-table/woo', 'recon-table:woo'],
    ['/api/maintenance/recon-table/basalam', 'recon-table:basalam'],
    ['/api/maintenance/recon/woo', 'recon:woo'],
    ['/api/maintenance/rebuild/basalam', 'rebuild:basalam']
  ];
  for (const [path, op] of cases) assert.equal(p.maintenanceOpName(path, {}), op, path);
});

test('both runtimes can start and poll a maintenance run for every button', async () => {
  for (const file of ['worker-src/app.ts', 'render-src/server.ts']) {
    const source = await read(file);
    assert.ok(source.includes("app.post('/api/maintenance/run'"), file + ' must start background runs');
    assert.ok(source.includes("app.get('/api/maintenance/run/:id'"), file + ' must answer polls');
    assert.ok(source.includes('startMaintenanceRun'), file + ' must use the shared run store');
    for (const op of ['recon-unified', 'recon-unified-apply', 'ledger-refresh', 'ledger-missing', 'duplicates', 'recon-table:woo', 'recon-table:basalam', 'recon:woo', 'rebuild:basalam']) {
      assert.ok(source.includes("'" + op + "'") || source.includes(op + ':'), file + ' must map op ' + op);
    }
  }
});
