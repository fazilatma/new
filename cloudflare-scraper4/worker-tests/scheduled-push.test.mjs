import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../scraper4.worker.js';

// Scheduled settings push to a GitHub branch, through the real production
// bundle with GitHub stubbed out: the manual push streams live NDJSON
// progress (reading -> uploading+bytes -> final result, always HTTP 200 in
// live mode), the status endpoint exposes the last recorded run, and the
// Worker cron tick pushes scheduled-backup.json only when enabled, due,
// tokened and targeted — recording every outcome for the dashboard.
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
async function withGitHub(stub, fn) {
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const seedSettings = (db, settings) => db.states.set('settings', JSON.stringify(settings));
const call = (db, path, extra = {}) => worker.fetch(new Request(`https://worker.test${path}`), { DB: db, VAULT_SECRET: 'vault-secret', ...extra }, ctx);
const callPost = (db, path, body, extra = {}) => worker.fetch(new Request(`https://worker.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { DB: db, VAULT_SECRET: 'vault-secret', ...extra }, ctx);
async function framesOf(response) {
  return (await response.text()).split('\n').filter(line => line.trim()).map(line => JSON.parse(line));
}

test('live push streams reading, uploading with bytes, then the final result', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  const calls = [], puts = [];
  const stub = async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (init?.method === 'PUT') {
      puts.push({ href, body: JSON.parse(init.body) });
      return json({ content: { sha: 'newsha' }, commit: { sha: 'commitsha' } }, 201);
    }
    assert.match(href, /\/repos\/acme\/widgets\/contents\/backups\/b\.json\?ref=main$/);
    return json({ message: 'Not Found' }, 404);
  };
  const response = await withGitHub(stub, () => callPost(db, '/api/branch-push?live=1', { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: { a: 1 } }, { GH_BACKUP_TOKEN: 'tok' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /ndjson/);
  const frames = await framesOf(response);
  assert.deepEqual(frames[0], { stage: 'reading' });
  assert.equal(frames[1].stage, 'uploading');
  assert.equal(frames[1].bytes, JSON.stringify({ a: 1 }, null, 2).length);
  assert.equal(frames[2].ok, true);
  assert.equal(frames[2].path, 'backups/b.json');
  assert.equal(frames[2].updated, false);
  assert.equal(frames.length, 3);
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.sha, undefined, 'a create sends no sha');
  assert.equal(Buffer.from(puts[0].body.content, 'base64').toString('utf8'), JSON.stringify({ a: 1 }, null, 2));
});

test('live push without a token is HTTP 200 with a single auth frame', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  let fetches = 0;
  const response = await withGitHub(async () => { fetches++; throw Error('must not fetch'); }, () => callPost(db, '/api/branch-push?live=1', { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: { a: 1 } }));
  assert.equal(response.status, 200, 'live mode never fails the HTTP request itself');
  assert.equal(fetches, 0);
  const frames = await framesOf(response);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].ok, false);
  assert.equal(frames[0].stage, 'auth');
});

test('live push with bad params is HTTP 200 with a single params frame', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  let fetches = 0;
  const response = await withGitHub(async () => { fetches++; throw Error('must not fetch'); }, () => callPost(db, '/api/branch-push?live=1', { repo: 'acme/widgets', branch: '', path: 'backups', name: 'b.json', bundle: { a: 1 } }, { GH_BACKUP_TOKEN: 'tok' }));
  assert.equal(response.status, 200);
  assert.equal(fetches, 0);
  const frames = await framesOf(response);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].ok, false);
  assert.equal(frames[0].stage, 'params');
});

test('push status exposes the recorded run, or null before the first run', async () => {
  const empty = new MemoryD1();
  seedSettings(empty, {});
  assert.deepEqual(await (await call(empty, '/api/branch-push-status')).json(), { ok: true, last: null });
  const seeded = new MemoryD1();
  seedSettings(seeded, {});
  const last = { at: '2026-09-15T10:00:00.000Z', ok: true, path: 'main/backups/scheduled-backup.json', sha: 'newsha', updated: true };
  seeded.states.set('branch_push_last', JSON.stringify(last));
  assert.deepEqual(await (await call(seeded, '/api/branch-push-status')).json(), { ok: true, last });
});

async function runScheduled(db, githubStub, extra = {}) {
  const pending = [];
  const localCtx = { waitUntil(promise) { pending.push(promise); }, passThroughOnException() {} };
  const env = { DB: db, VAULT_SECRET: 'vault-secret', JOBS: { send: async () => {} }, JOBS_DLQ: { send: async () => {} }, WORKER_VERSION: '1.172.0', ...extra };
  await withGitHub(githubStub, async () => {
    await worker.scheduled({ cron: '* * * * *', scheduledTime: Date.now() }, env, localCtx);
    await Promise.allSettled(pending);
  });
}

test('scheduled push writes scheduled-backup.json to the default repo and records it', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, githubBackupToken: 'tok', branchPush: { enabled: true, intervalMin: 360, branch: 'main' } });
  const calls = [], puts = [];
  const stub = async (url, init) => {
    calls.push(String(url));
    if (init?.method === 'PUT') {
      puts.push({ href: String(url), body: JSON.parse(init.body) });
      return json({ content: { sha: 'schedsha' }, commit: { sha: 'schedcommit' } }, 201);
    }
    return json({ message: 'Not Found' }, 404);
  };
  await runScheduled(db, stub);
  assert.match(calls[0], /\/repos\/fazilatma\/new\/contents\/backups\/scheduled-backup\.json\?ref=main$/, 'empty repo falls back to the default, empty folder to backups');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].body.branch, 'main');
  assert.match(puts[0].body.message, /scraper4 backup scheduled-backup\.json/);
  const pushed = JSON.parse(Buffer.from(puts[0].body.content, 'base64').toString('utf8'));
  assert.equal(pushed.format, 'scraper4-php-compatible', 'the scheduler pushes a real settings bundle');
  assert.ok(pushed.files['profiles.json'], 'the bundle carries the settings files');
  const recorded = JSON.parse(db.states.get('branch_push_last'));
  assert.equal(recorded.ok, true);
  assert.equal(recorded.path, 'main/backups/scheduled-backup.json');
  assert.equal(recorded.updated, false);
  assert.equal(recorded.sha, 'schedsha');
  assert.ok(Date.parse(recorded.at) > 0);
});

test('scheduled push stays quiet when disabled', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, githubBackupToken: 'tok', branchPush: { enabled: false, intervalMin: 5, branch: 'main' } });
  let fetches = 0;
  await runScheduled(db, async () => { fetches++; throw Error('must not fetch'); });
  assert.equal(fetches, 0);
  assert.equal(db.states.has('branch_push_last'), false, 'a disabled schedule records nothing');
});

test('scheduled push stays quiet when the last run is still fresh', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, githubBackupToken: 'tok', branchPush: { enabled: true, intervalMin: 360, branch: 'main' } });
  const last = { at: new Date().toISOString(), ok: true, path: 'main/backups/scheduled-backup.json', sha: 'old', updated: true };
  db.states.set('branch_push_last', JSON.stringify(last));
  let fetches = 0;
  await runScheduled(db, async () => { fetches++; throw Error('must not fetch'); });
  assert.equal(fetches, 0);
  assert.deepEqual(JSON.parse(db.states.get('branch_push_last')), last, 'a not-due tick leaves the record alone');
});

test('scheduled push without any token records the no-token skip', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, branchPush: { enabled: true, intervalMin: 5, branch: 'main' } });
  let fetches = 0;
  await runScheduled(db, async () => { fetches++; throw Error('must not fetch'); });
  assert.equal(fetches, 0);
  const recorded = JSON.parse(db.states.get('branch_push_last'));
  assert.equal(recorded.ok, false);
  assert.equal(recorded.skipped, 'no-token');
});

test('scheduled push without a branch records the no-target skip', async () => {
  const db = new MemoryD1();
  seedSettings(db, { watchdog: { enabled: false }, githubBackupToken: 'tok', branchPush: { enabled: true, intervalMin: 5, branch: '' } });
  let fetches = 0;
  await runScheduled(db, async () => { fetches++; throw Error('must not fetch'); });
  assert.equal(fetches, 0);
  const recorded = JSON.parse(db.states.get('branch_push_last'));
  assert.equal(recorded.ok, false);
  assert.equal(recorded.skipped, 'no-target');
});
