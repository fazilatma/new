import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../scraper4.worker.js';

// Split branch backups through the real production bundle with GitHub
// stubbed out: the listing returns split folders next to legacy single-file
// backups, one /api/branch-file param restores either shape (legacy .json
// passes through, a folder reassembles manifest + parts into the same
// bundle object), and failures name the missing piece honestly.
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
const b64 = obj => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64');
const contentPath = href => String(href).split('/contents/')[1].split('?')[0];

test('branch-files lists split folders next to legacy files', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  const stub = async url => json([
    { name: 'scheduled-backup', path: 'backups/scheduled-backup', type: 'dir', sha: 'd' },
    { name: 'legacy.json', path: 'backups/legacy.json', type: 'file', size: 12, sha: 'f' },
    { name: 'notes.txt', path: 'backups/notes.txt', type: 'file', size: 3, sha: 't' },
  ]);
  const d = await withGitHub(stub, () => call(db, '/api/branch-files?repo=acme/widgets&branch=main&path=backups').then(r => r.json()));
  assert.equal(d.ok, true);
  assert.deepEqual(d.folders, [{ name: 'scheduled-backup', path: 'backups/scheduled-backup' }]);
  assert.deepEqual(d.files.map(f => f.name), ['legacy.json'], 'only .json files list; the .txt is skipped');
});

test('branch-file restores a legacy single-file backup untouched', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  const bundle = { app: 'scraper', kind: 'settings-export', format: 'scraper4-php-compatible', files: { 'profiles.json': { size: 7, b64: b64({ x: 1 }) } } };
  const stub = async url => {
    assert.equal(contentPath(url), 'backups/legacy.json');
    return json({ name: 'legacy.json', sha: 'f', size: 99, content: b64(bundle) });
  };
  const d = await withGitHub(stub, () => call(db, '/api/branch-file?repo=acme/widgets&branch=main&path=backups/legacy.json').then(r => r.json()));
  assert.equal(d.ok, true);
  assert.equal(d.name, 'legacy.json');
  assert.deepEqual(d.bundle, bundle);
});

test('branch-file reassembles a split folder into the same bundle shape', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  const profiles = { p1: { id: 'p1' } }, connections = { woo: { url: 'https://shop.test' } };
  const manifest = { app: 'scraper', kind: 'split-backup', format: 'scraper4-split-1', version: 'cloudflare-1.0', created_at: 1, created_at_h: 'h', host: 'w', parts: ['connections.json', 'profiles.json'], database: null, total_bytes: 10 };
  const tree = { 'backups/split/manifest.json': manifest, 'backups/split/connections.json': connections, 'backups/split/profiles.json': profiles };
  const stub = async url => {
    const blob = tree[contentPath(url)];
    if (!blob) return json({ message: 'Not Found' }, 404);
    return json({ name: contentPath(url).split('/').pop(), sha: 's', size: 9, content: b64(blob) });
  };
  const d = await withGitHub(stub, () => call(db, '/api/branch-file?repo=acme/widgets&branch=main&path=backups/split').then(r => r.json()));
  assert.equal(d.ok, true);
  assert.equal(d.name, 'backups/split');
  assert.equal(d.bundle.kind, 'settings-export');
  assert.equal(d.bundle.format, 'scraper4-php-compatible');
  assert.deepEqual(JSON.parse(Buffer.from(d.bundle.files['profiles.json'].b64, 'base64').toString('utf8')), profiles);
  assert.deepEqual(JSON.parse(Buffer.from(d.bundle.files['connections.json'].b64, 'base64').toString('utf8')), connections);
  assert.equal(d.bundle.total_files, 2);
});

test('branch-file on a folder without a manifest fails honestly', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  const stub = async () => json({ message: 'Not Found' }, 404);
  const d = await withGitHub(stub, () => call(db, '/api/branch-file?repo=acme/widgets&branch=main&path=backups/empty').then(r => r.json()));
  assert.equal(d.ok, false);
  assert.equal(d.stage, 'fetch');
  assert.match(d.error, /manifest\.json/);
});

test('branch-file on a split folder with a missing part names the part', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  const manifest = { app: 'scraper', kind: 'split-backup', format: 'scraper4-split-1', parts: ['profiles.json', 'connections.json'], database: null };
  const stub = async url => {
    const path = contentPath(url);
    if (path === 'backups/torn/manifest.json') return json({ name: 'manifest.json', sha: 's', size: 9, content: b64(manifest) });
    if (path === 'backups/torn/profiles.json') return json({ name: 'profiles.json', sha: 's', size: 9, content: b64({}) });
    return json({ message: 'Not Found' }, 404);
  };
  const d = await withGitHub(stub, () => call(db, '/api/branch-file?repo=acme/widgets&branch=main&path=backups/torn').then(r => r.json()));
  assert.equal(d.ok, false);
  assert.match(d.error, /connections\.json/);
});

test('worker manual push reports parts and the honestly skipped database', async () => {
  const db = new MemoryD1();
  seedSettings(db, {});
  const puts = [];
  const stub = async (url, init) => {
    if (init?.method === 'PUT') {
      puts.push(String(url));
      return json({ content: { sha: 'psha' }, commit: { sha: 'csha' } }, 201);
    }
    return json({ message: 'Not Found' }, 404);
  };
  const part = obj => ({ size: 2, b64: b64(obj) });
  const body = { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'backup_push_x.json', bundle: { files: { 'profiles.json': part({}) } } };
  const req = new Request('https://worker.test/api/branch-push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await withGitHub(stub, () => worker.fetch(req, { DB: db, VAULT_SECRET: 'vault-secret', GH_BACKUP_TOKEN: 'tok' }, ctx).then(r => r.json()));
  assert.equal(d.ok, true);
  assert.equal(d.path, 'backups/backup_push_x');
  assert.equal(d.parts, 1);
  assert.equal(d.database, 'skipped:d1');
  assert.equal(puts.length, 2, 'one part plus the manifest');
  assert.ok(puts[1].endsWith('/backups/backup_push_x/manifest.json'), 'the manifest goes last');
});
