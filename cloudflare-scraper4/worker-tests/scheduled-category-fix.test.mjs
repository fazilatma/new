import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../scraper4.worker.js';

// Periodic bulk Basalam category fix through the real production bundle: the
// status endpoint exposes the last recorded fix, and the Worker cron tick
// starts a category-all run only when enabled and due — recording failures
// honestly and pinning the scheduled consensus list, all without network.
const ctx = { waitUntil() {}, passThroughOnException() {} };
class MemoryD1 {
  constructor() { this.states = new Map(); }
  prepare(sql) { return new MemoryStatement(this, String(sql).replace(/\s+/g, ' ').trim()); }
  async batch(statements) { return statements.map(() => ({ success: true, meta: { changes: 0 } })); }
}
class MemoryStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() {
    if (this.sql.startsWith('SELECT value FROM app_state WHERE key=')) {
      const value = this.db.states.get(this.values[0]);
      return value === undefined ? null : { value };
    }
    return null;
  }
  async all() { return { success: true, results: [] }; }
  async run() {
    if (this.sql.startsWith('INSERT INTO app_state')) this.db.states.set(this.values[0], this.values[1]);
    else if (this.sql.startsWith('DELETE FROM app_state WHERE key=')) this.db.states.delete(this.values[0]);
    return { success: true, meta: { changes: 1 } };
  }
}
const realFetch = globalThis.fetch;
async function withNet(stub, fn) {
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}
const seedSettings = (db, settings) => db.states.set('settings', JSON.stringify(settings));
const call = (db, path, extra = {}) => worker.fetch(new Request(`https://worker.test${path}`), { DB: db, VAULT_SECRET: 'vault-secret', ...extra }, ctx);
const callPost = (db, path, body, extra = {}) => worker.fetch(new Request(`https://worker.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { DB: db, VAULT_SECRET: 'vault-secret', ...extra }, ctx);
// Connections live in an encrypted vault: seed them through the real save
// route so encryption, merging and the in-memory cache all behave for real.
async function seedConnections(db, connections) {
  const response = await callPost(db, '/api/connections', connections);
  assert.equal(response.status, 200);
}
async function runScheduled(db, netStub, extra = {}) {
  const pending = [];
  const localCtx = { waitUntil(promise) { pending.push(promise); }, passThroughOnException() {} };
  const env = { DB: db, VAULT_SECRET: 'vault-secret', JOBS: { send: async () => {} }, JOBS_DLQ: { send: async () => {} }, WORKER_VERSION: '1.177.0', ...extra };
  await withNet(netStub, async () => {
    await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() }, env, localCtx);
    await Promise.allSettled(pending);
  });
}
const mustNotFetch = async () => { throw Error('must not fetch'); };
const AI_CONNECTIONS = { ai: { providers: [{ id: 'p1', name: 'P1', baseUrl: 'https://ai.example', apiKey: 'k', models: ['m1'], enabled: true }], candidates: [], master: '' }, basalam: {}, woo: {} };
const seedGreen = db => db.states.set('ai_test_results', JSON.stringify({ at: new Date().toISOString(), results: [{ ok: true, provider: 'p1', model: 'm1' }] }));
const seedCategories = db => db.states.set('basalam_categories_v1', JSON.stringify({ items: [{ id: 101, name: 'A' }], updatedAt: new Date().toISOString() }));

test('fix status exposes the recorded run, or null before the first run', async () => {
  const empty = new MemoryD1();
  seedSettings(empty, {});
  assert.deepEqual(await (await call(empty, '/api/category-fix-status')).json(), { ok: true, last: null });
  const seeded = new MemoryD1();
  seedSettings(seeded, {});
  const last = { at: '2026-09-16T06:00:00.000Z', ok: true, trigger: 'manual', mode: 'ensemble', runId: 'r1' };
  seeded.states.set('category_fix_last', JSON.stringify(last));
  assert.deepEqual(await (await call(seeded, '/api/category-fix-status')).json(), { ok: true, last });
});

test('scheduled fix stays quiet when disabled', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, categoryFix: { periodic: { enabled: false, everyHours: 6, mode: 'ensemble' } } });
  await runScheduled(db, mustNotFetch);
  assert.equal(db.states.has('category_fix_last'), false, 'a disabled schedule records nothing');
});

test('scheduled fix stays quiet when the last run is still fresh', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, categoryFix: { periodic: { enabled: true, everyHours: 6, mode: 'ensemble' } } });
  const last = { at: new Date().toISOString(), ok: true, trigger: 'manual', mode: 'ensemble', runId: 'r0' };
  db.states.set('category_fix_last', JSON.stringify(last));
  await runScheduled(db, mustNotFetch);
  assert.deepEqual(JSON.parse(db.states.get('category_fix_last')), last, 'a not-due tick leaves the record alone');
});

test('scheduled fix without green models records the honest failure', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, categoryFix: { periodic: { enabled: true, everyHours: 6, mode: 'master' } } });
  await runScheduled(db, mustNotFetch);
  const recorded = JSON.parse(db.states.get('category_fix_last'));
  assert.equal(recorded.ok, false);
  assert.equal(recorded.trigger, 'periodic');
  assert.equal(recorded.mode, 'master');
  assert.match(recorded.error, /مستر/);
  assert.ok(Date.parse(recorded.at) > 0);
});

test('scheduled fix starts a run when due and records it', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, categoryFix: { periodic: { enabled: true, everyHours: 6, mode: 'ensemble' } } });
  await seedConnections(db, AI_CONNECTIONS);
  seedGreen(db);
  seedCategories(db);
  await runScheduled(db, mustNotFetch);
  const recorded = JSON.parse(db.states.get('category_fix_last'));
  assert.equal(recorded.ok, true);
  assert.equal(recorded.trigger, 'periodic');
  assert.equal(recorded.mode, 'ensemble');
  const runId = JSON.parse(db.states.get('background_current:category-all'));
  assert.ok(runId, 'the periodic tick queues a category-all run');
  const run = JSON.parse(db.states.get(`background_run:category-all:${runId}`));
  assert.deepEqual(run.modelKeys, ['p1::m1']);
  assert.equal(recorded.runId, run.id);
});

test('scheduled fix honors the stored consensus list without green results', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, categoryFix: { periodic: { enabled: true, everyHours: 1, mode: 'ensemble' }, consensusModels: ['p1::m1'] } });
  await seedConnections(db, AI_CONNECTIONS);
  seedCategories(db);
  await runScheduled(db, mustNotFetch);
  const recorded = JSON.parse(db.states.get('category_fix_last'));
  assert.equal(recorded.ok, true);
  assert.equal(recorded.trigger, 'periodic');
  const runId = JSON.parse(db.states.get('background_current:category-all'));
  const run = JSON.parse(db.states.get(`background_run:category-all:${runId}`));
  assert.deepEqual(run.modelKeys, ['p1::m1']);
});
