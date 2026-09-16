import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * Remote marketplace IDs can exceed 2^53 (real case: Basalam remote id
 * 3838404244461599744). node:sqlite used to THROW `RangeError: Value is too
 * large to be represented as a JavaScript number` when reading such an
 * INTEGER, failing the whole operation ("operation incomplete"). The fix:
 * read every integer as BigInt, keep safe ones as numbers, keep huge ones
 * as exact strings, and never let a BigInt reach JSON.stringify. These
 * tests pin that contract on a real SQLite database, through the real sync
 * update path (REST and SDK transports), and on the Worker getters.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIG = '3838404244461599744'; // the exact value from the crash report
const ROUNDED = 3838404244461600000; // what Number()/JSON.parse make of it
const noShell = process.platform === 'win32' ? 'needs a POSIX shell for the stub interpreter' : false;

async function bundleUtils() {
  const dir = join(ROOT, `tmp-bigint-util-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  await build({
    entryPoints: [join(ROOT, 'worker-src/utils.ts')], bundle: true, platform: 'node',
    format: 'esm', outfile: join(dir, 'utils.mjs'), logLevel: 'error',
  });
  const mod = await import(pathToFileURL(join(dir, 'utils.mjs')).href);
  rmSync(dir, { recursive: true, force: true });
  return mod;
}

test('toRemoteId: safe integers stay numbers, huge ones keep exact digits, garbage is null', async () => {
  const { toRemoteId, normalizeDbValue } = await bundleUtils();
  assert.equal(toRemoteId(123), 123);
  assert.equal(toRemoteId('123'), 123);
  assert.equal(toRemoteId(BIG), BIG);
  assert.equal(toRemoteId(3838404244461599744n), BIG);
  assert.equal(toRemoteId(123n), 123);
  assert.equal(toRemoteId(0), 0);
  assert.equal(toRemoteId('0'), 0);
  assert.equal(toRemoteId(null), null);
  assert.equal(toRemoteId(undefined), null);
  assert.equal(toRemoteId(''), null);
  assert.equal(toRemoteId('   '), null);
  assert.equal(toRemoteId(NaN), null);
  assert.equal(toRemoteId('abc'), null);
  assert.equal(toRemoteId('007'), '007', 'leading zeros are preserved, not re-encoded');
  assert.equal(normalizeDbValue(5n), 5);
  assert.equal(normalizeDbValue(3838404244461599744n), BIG);
  assert.equal(normalizeDbValue('x'), 'x');
  assert.equal(normalizeDbValue(null), null);
});

// The Node database + sync stack, bundled once with a scratch SQLite file.
// Env must be set before the import because config is read at module load.
const sqliteFile = join(tmpdir(), `scraper4-bigint-${process.pid}.sqlite`);
process.env.DATABASE_URL = `sqlite:${sqliteFile}`;
process.env.BASALAM_TOKEN = 'test-token';
process.env.BASALAM_VENDOR_ID = '123';
process.env.BASALAM_API = 'http://192.0.2.1/v1';
const nodeDir = join(ROOT, `tmp-bigint-node-${process.pid}`);
mkdirSync(nodeDir, { recursive: true });
await build({
  entryPoints: [join(ROOT, 'render-src/sync.ts')], bundle: true, platform: 'node',
  format: 'esm', packages: 'external', outfile: join(nodeDir, 'sync.mjs'), logLevel: 'error',
});
await build({
  entryPoints: [join(ROOT, 'render-src/db.ts')], bundle: true, platform: 'node',
  format: 'esm', packages: 'external', outfile: join(nodeDir, 'db.mjs'), logLevel: 'error',
});
const db = await import(pathToFileURL(join(nodeDir, 'db.mjs')).href);
const sync = await import(pathToFileURL(join(nodeDir, 'sync.mjs')).href);
await db.migrate();
test.after(async () => {
  await db.pool.end().catch(() => {});
  rmSync(nodeDir, { recursive: true, force: true });
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(sqliteFile + suffix, { force: true });
});

test('Node+SQLite: the reported value round-trips exactly instead of throwing', async () => {
  await db.setDestinationId('p1', 's1', 'basalam', 'default', BIG);
  await db.setDestinationId('p1', 's2', 'basalam', 'default', 123);
  assert.equal(await db.getDestinationId('p1', 's1', 'basalam', 'default'), BIG);
  assert.equal(await db.getDestinationId('p1', 's2', 'basalam', 'default'), 123);
  assert.equal(await db.getDestinationId('p1', 'missing', 'basalam', 'default'), null);

  await db.upsertProduct('p1', { sourceKey: 's1', title: 't', price: 250000, url: 'https://shop.test/1' });
  await db.setRemoteId('p1', 's1', 'basalam', BIG);
  await db.setRemoteId('p1', 's1', 'woo', 456);
  assert.equal(await db.getRemoteId('p1', 's1', 'basalam'), BIG);
  assert.equal(await db.getRemoteId('p1', 's1', 'woo'), 456);
});

test('Node+SQLite: huge chat ids, prices, and whole-table reads never throw or leak BigInt', async () => {
  await db.importAutoreplyLog([{ chat_id: BIG, customer: 'c', input_text: 'i', output_text: 'o', source: 's' }]);
  const logs = await db.listAutoreplyLog(10);
  assert.equal(logs[0].chat_id, BIG);

  await db.upsertProduct('p1', { sourceKey: 'ph', title: 't', price: 1000, url: '' });
  await db.pool.query('UPDATE products SET price=$1 WHERE profile_id=$2 AND source_key=$3', [BIG, 'p1', 'ph']);
  const priced = await db.pool.query('SELECT price FROM products WHERE profile_id=$1 AND source_key=$2', ['p1', 'ph']);
  assert.equal(priced.rows[0].price, BIG);

  // SELECT * over every table (what backup/recon/lists do) plus backup
  // serialization: no throw, no BigInt reaching JSON.stringify.
  const backup = await db.createBackup();
  assert.ok(JSON.stringify(backup).includes(BIG));
  const found = backup.destinationMap.find(m => m.source_key === 's1');
  assert.equal(found.remote_id, BIG);
});

test('Node+SQLite: restoring a backup with string big-ids keeps them exact', async () => {
  const report = await db.restoreBackup({
    app: 'scraper4-backup', version: 1,
    profiles: [], states: [],
    products: [{ profile_id: 'p1', source_key: 'rs', data: JSON.stringify({ sourceKey: 'rs' }), title: 'r', price: 5, source_url: '', remote_woo_id: null, remote_basalam_id: BIG, created_at: new Date().toISOString(), active: 1, missing_since: null }],
    destinationMap: [{ profile_id: 'p1', source_key: 'rs', target: 'basalam', account_key: 'default', remote_id: BIG }],
    categoryLearning: [], autoreplyLog: [],
  });
  assert.equal(report.products, 1);
  assert.equal(await db.getRemoteId('p1', 'rs', 'basalam'), BIG);
  assert.equal(await db.getDestinationId('p1', 'rs', 'basalam', 'default'), BIG);
});

const realFetch = globalThis.fetch;

test('sync REST path: an existing huge id updates by its exact digits', async () => {
  const product = { sourceKey: 'up1', title: 'هودی تست', price: 250000, priceText: '250000', images: [], stock: 3 };
  const profile = { id: 'p1' };
  await db.setDestinationId('p1', 'up1', 'basalam', '123', BIG);
  const seen = [];
  process.env.BASALAM_PYTHON = join(nodeDir, 'no-such-python'); // SDK fails instantly -> REST fallback
  globalThis.fetch = async (input, init = {}) => {
    seen.push({ url: String(input), method: String(init.method || 'GET').toUpperCase() });
    return new Response(JSON.stringify({ id: BIG }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const results = await sync.syncBasalam(product, profile);
    assert.equal(results.length, 1);
    assert.equal(results[0].action, 'updated');
    assert.equal(results[0].transport, 'api');
    assert.equal(results[0].id, BIG, 'the result id must be exact, not the rounded double');
    assert.deepEqual(seen.map(s => s.method), ['PATCH']);
    assert.equal(seen[0].url, `http://192.0.2.1/v1/vendors/123/products/${BIG}`);
    assert.notEqual(seen[0].url, `http://192.0.2.1/v1/vendors/123/products/${ROUNDED}`);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.BASALAM_PYTHON;
  }
});

test('sync SDK path: the bridge id_str survives JSON rounding end to end', { skip: noShell }, async () => {
  const stub = join(nodeDir, 'stub-bridge-python');
  writeFileSync(stub, `#!/bin/sh\nprintf '%s' '{"ok":true,"id":${ROUNDED},"id_str":"${BIG}","sdkVersion":"9.9.9-stub"}'\n`);
  chmodSync(stub, 0o755);
  process.env.BASALAM_PYTHON = stub;
  try {
    // No pre-seeded id -> create path through the stubbed SDK transport.
    const results = await sync.syncBasalam(
      { sourceKey: 'sdk1', title: 'هودی تست', price: 250000, priceText: '250000', images: [], stock: 3 },
      { id: 'p1' },
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].action, 'created');
    assert.equal(results[0].transport, 'sdk');
    assert.equal(results[0].id, BIG, 'id_str must win over the rounded JSON number');
    assert.equal(await db.getDestinationId('p1', 'sdk1', 'basalam', '123'), BIG);
  } finally {
    delete process.env.BASALAM_PYTHON;
  }
});

test('bridge: product responses carry the exact id_str beside the JSON number', () => {
  const bridge = readFileSync(join(ROOT, 'scripts/basalam-sdk-bridge.py'), 'utf8');
  assert.ok(bridge.includes('"id_str": str(remote_id)'), 'bridge must send the exact id string');
  const sdkSrc = readFileSync(join(ROOT, 'render-src/sync.ts'), 'utf8');
  assert.ok(sdkSrc.includes('answer.id_str ?? answer.id'), 'Node must prefer id_str over the rounded number');
});

// --- Worker twin: getters against a stub D1 that returns CAST TEXT ---
const workerDir = join(ROOT, `tmp-bigint-worker-${process.pid}`);
mkdirSync(workerDir, { recursive: true });
writeFileSync(join(workerDir, 'entry.ts'),
  `export { getDestinationId, getRemoteId, setDestinationId } from ${JSON.stringify(join(ROOT, 'worker-src', 'db.ts'))};\n` +
  `export { configureEnv } from ${JSON.stringify(join(ROOT, 'worker-src', 'env.ts'))};\n`);
await build({
  entryPoints: { worker: join(workerDir, 'entry.ts') }, bundle: true, format: 'esm',
  platform: 'browser', target: 'es2022', outdir: workerDir, entryNames: '[name]', outExtension: { '.js': '.mjs' }, logLevel: 'error',
});
const wdb = await import(pathToFileURL(join(workerDir, 'worker.mjs')).href);
test.after(() => rmSync(workerDir, { recursive: true, force: true }));

function stubD1(firstRow) {
  const seen = [];
  wdb.configureEnv({
    DB: {
      prepare(sql) {
        seen.push(String(sql));
        return { bind() { return this; }, first: async () => firstRow, all: async () => ({ success: true, results: [] }), run: async () => ({ success: true, meta: {} }) };
      },
    },
  });
  return seen;
}

test('Worker getters: CAST TEXT keeps huge ids exact, small ids stay numbers', async () => {
  let seen = stubD1({ remote_id: BIG });
  assert.equal(await wdb.getDestinationId('p1', 's1', 'basalam', 'default'), BIG);
  assert.ok(seen.some(s => s.includes('CAST(') && s.includes('AS TEXT')), 'D1 reads must CAST ids to TEXT (D1 rounds >2^53)');
  assert.ok(!seen.some(s => s.includes('SELECT remote_id FROM')), 'the unrounded select must be gone');

  seen = stubD1({ id: '123' });
  assert.equal(await wdb.getRemoteId('p1', 's1', 'basalam'), 123);
  assert.ok(seen.some(s => s.includes('CAST(')));

  stubD1(null);
  assert.equal(await wdb.getDestinationId('p1', 'missing', 'basalam', 'default'), null);
});
