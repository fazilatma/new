// Background maintenance runs: the request that starts the work is short, so nothing between the
// browser and the app has a long connection to cut. Everything here is offline — the state store,
// the clock and the scheduler are fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
await mkdir(join(root, 'node_modules/.cache'), { recursive: true });
const temp = await mkdtemp(join(root, 'node_modules/.cache/maintenance-runs-'));
await build({ entryPoints: [join(root, 'worker-src/maintenance-runs.ts')], outfile: join(temp, 'runs.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const runs = await import(pathToFileURL(join(temp, 'runs.mjs')));

function store(startMs = 1_700_000_000_000) {
  const state = new Map();
  let clock = startMs, counter = 0;
  const background = [];
  return {
    state, background,
    tick: ms => { clock += ms; },
    deps: {
      getState: async (key, fallback) => (state.has(key) ? state.get(key) : fallback),
      setState: async (key, value) => void state.set(key, JSON.parse(JSON.stringify(value))),
      now: () => clock,
      newId: () => 'run-' + ++counter,
      background: promise => background.push(promise)
    }
  };
}

const settle = () => new Promise(r => setImmediate(r));

test('starting a run answers immediately and the work continues in the background', async () => {
  const io = store();
  let release;
  const work = async observe => { observe({ name: 'ledger', account: 'woo', count: 3 }); await new Promise(r => { release = r; }); return { ok: true, planned: 2 }; };
  const run = await runs.startMaintenanceRun('duplicates', work, io.deps);

  assert.equal(run.status, 'running');
  assert.equal(run.op, 'duplicates');
  assert.equal(io.background.length, 1, 'the task is handed to the runtime keep-alive, not awaited');
  assert.deepEqual(await runs.readMaintenanceRun(run.id, io.deps).then(r => r.status), 'running');

  io.tick(2000);
  await settle();
  const mid = runs.runSlice(await runs.readMaintenanceRun(run.id, io.deps), 0);
  assert.equal(mid.status, 'running');
  assert.equal(mid.events.length, 1);
  assert.equal(mid.events[0].account, 'woo');
  assert.equal(mid.result, undefined, 'no result is claimed before the work finishes');

  release();
  await io.background[0];
  const done = runs.runSlice(await runs.readMaintenanceRun(run.id, io.deps), 0);
  assert.equal(done.status, 'done');
  assert.deepEqual(done.result, { ok: true, planned: 2 });
  assert.ok(done.finishedAt);
});

test('a poll only carries the events it has not seen yet', async () => {
  const io = store();
  let step;
  const run = await runs.startMaintenanceRun('recon-unified', async observe => {
    observe({ stage: 'ledger', summary: 'یک' });
    io.tick(1500); observe({ stage: 'ledger', summary: 'دو' });
    await new Promise(r => { step = r; });
    io.tick(1500); observe({ stage: 'compare', summary: 'سه' });
    return { ok: true };
  }, io.deps);
  await settle();

  const first = runs.runSlice(await runs.readMaintenanceRun(run.id, io.deps), 0);
  assert.deepEqual(first.events.map(e => e.summary), ['یک', 'دو']);
  assert.equal(first.eventCount, 2);

  step();
  await io.background[0];
  const next = runs.runSlice(await runs.readMaintenanceRun(run.id, io.deps), first.eventCount);
  assert.deepEqual(next.events.map(e => e.summary), ['سه'], 'the poller never re-reads what it already drew');
  assert.equal(next.status, 'done');
});

test('a chatty run stays small: events are capped and the count stays honest', async () => {
  const io = store();
  const run = await runs.startMaintenanceRun('ledger-refresh', async observe => {
    for (let i = 0; i < runs.RUN_EVENT_CAP + 50; i++) { io.tick(1100); observe({ name: 'scan', count: i }); }
    return { ok: true };
  }, io.deps);
  await io.background[0];
  const stored = await runs.readMaintenanceRun(run.id, io.deps);
  assert.equal(stored.events.length, runs.RUN_EVENT_CAP, 'the stored row cannot grow without bound');
  assert.equal(stored.eventCount, runs.RUN_EVENT_CAP + 50, 'but the true number of steps is still reported');
  const slice = runs.runSlice(stored, 10);
  assert.equal(slice.events.length, runs.RUN_EVENT_CAP, 'a poller that fell behind the trim window gets what is left');
});

test('a failing operation is recorded as failed with its own message, not as a network problem', async () => {
  const io = store();
  const run = await runs.startMaintenanceRun('duplicates', async () => { throw new Error('دفتر حساب خالی است'); }, io.deps);
  await io.background[0];
  const slice = runs.runSlice(await runs.readMaintenanceRun(run.id, io.deps), 0);
  assert.equal(slice.status, 'failed');
  assert.equal(slice.error, 'دفتر حساب خالی است');
  assert.equal(slice.result, undefined);
  assert.match(runs.runAdvice(await runs.readMaintenanceRun(run.id, io.deps), Date.now()), /خطا داد/);
});

test('a run whose host died is called stale instead of pretending to still work', async () => {
  const io = store();
  const run = await runs.startMaintenanceRun('recon-unified', async () => new Promise(() => {}), io.deps);
  const stored = await runs.readMaintenanceRun(run.id, io.deps);
  const started = Date.parse(stored.startedAt);
  assert.equal(runs.staleRun(stored, started + 60_000), false);
  assert.equal(runs.staleRun(stored, started + 16 * 60_000), true);
  assert.match(runs.runAdvice(stored, started + 16 * 60_000), /از نو شروع کنید/);
  assert.equal(runs.runAdvice(stored, started + 60_000), '', 'a run that is simply slow gets no scary advice');
  assert.match(runs.runAdvice(null, Date.now()), /پیدا نشد/);
});

test('observer events are shrunk to what the panel draws', () => {
  const event = runs.compactEvent({ stage: 'ledger', status: 'running', account: 'غرفهٔ دوم', count: 7, total: 20, secret: 'token', summary: 'x'.repeat(500) }, '2026-10-07T00:00:00.000Z');
  assert.equal(event.name, 'ledger');
  assert.equal(event.count, 7);
  assert.equal(event.total, 20);
  assert.equal(event.account, 'غرفهٔ دوم');
  assert.equal(event.summary.length, 300, 'a huge summary cannot blow up the stored row');
  assert.equal(event.secret, undefined, 'only known fields survive');
  assert.equal(runs.compactEvent({}, 'now').name, 'step');
});

test('the run id is stable, stored under its own key, and the last run is findable', async () => {
  const io = store();
  const run = await runs.startMaintenanceRun('recon-table:woo', async () => ({ ok: true }), io.deps);
  await io.background[0];
  assert.equal(io.state.get(runs.RUN_POINTER), run.id);
  assert.ok(io.state.has(runs.runKey(run.id)));
  assert.equal(await runs.readMaintenanceRun('', io.deps), null);
  assert.equal(await runs.readMaintenanceRun('nope', io.deps), null);
  assert.equal(runs.runSlice(null, 0), null);
});

test('the run store is shared by both runtimes and the panel can reach it', async () => {
  const read = file => readFile(join(root, file), 'utf8');
  for (const file of ['worker-src/app.ts', 'render-src/server.ts']) {
    const source = await read(file);
    assert.ok(source.includes('maintenance-runs.js'), file + ' must import the shared store');
    assert.ok(source.includes('runSlice(run,Number(c.req.query(') || source.includes('runSlice(run, Number(c.req.query('), file + ' must answer polls with a slice');
    assert.ok(source.includes('maintenanceOps'), file + ' must keep the op whitelist');
    assert.ok(!source.includes('eval('), file + ' must not execute client-supplied operation names');
  }
  const dashboard = await read('worker-src/dashboard.ts');
  assert.ok(dashboard.includes("activityFetch(U('/api/maintenance/run')"), 'the panel starts runs through the API');
  assert.ok(dashboard.includes("'/api/maintenance/run/'+encodeURIComponent(id)+'?since='+since"), 'the panel polls incrementally');
  assert.ok(dashboard.includes('misses>5'), 'a few failed polls are tolerated before giving up');
});
