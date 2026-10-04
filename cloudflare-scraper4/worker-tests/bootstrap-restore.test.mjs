import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * Fresh-database bootstrap restore (Node runtimes only): enablement defaults
 * (on by default on Render, opt-in elsewhere), file lookup order, and the
 * orchestration that only imports into a completely fresh database and never
 * throws. Plus source pins proving the shared Node importer keeps the Worker
 * parity fixes (dedicated profile-products file, partial connection merge).
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-bootstrap-'));
await build({ entryPoints: { bootstrap: new URL('../render-src/bootstrap.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { shouldAutoRestoreBootstrap, bootstrapCandidates, maybeRestoreBootstrap, BOOTSTRAP_FILENAME, RENDER_SECRET_PATH, REPO_BOOTSTRAP_RELATIVE, BOOTSTRAP_MARKER_KEY } = await import(pathToFileURL(join(temporary, 'bootstrap.mjs')));

test('constants pin the shared bootstrap contract', () => {
  assert.equal(BOOTSTRAP_FILENAME, 'render-bootstrap.json');
  assert.equal(RENDER_SECRET_PATH, '/etc/secrets/render-bootstrap.json');
  assert.equal(REPO_BOOTSTRAP_RELATIVE, 'bootstrap/render-bootstrap.json');
  assert.equal(BOOTSTRAP_MARKER_KEY, 'bootstrap_restored_at');
});

test('restore is on by default on Render and opt-in elsewhere', () => {
  assert.equal(shouldAutoRestoreBootstrap({}).enabled, false);
  assert.equal(shouldAutoRestoreBootstrap({ RENDER: 'true' }).enabled, true);
  assert.equal(shouldAutoRestoreBootstrap({ BOOTSTRAP_RESTORE: '1' }).enabled, true);
  assert.equal(shouldAutoRestoreBootstrap({ RENDER: 'true', BOOTSTRAP_RESTORE: '0' }).enabled, false);
  assert.equal(shouldAutoRestoreBootstrap({ BOOTSTRAP_RESTORE: '0' }).enabled, false);
  assert.equal(shouldAutoRestoreBootstrap({ BOOTSTRAP_PATH: '/etc/custom.json' }).enabled, true);
  assert.equal(shouldAutoRestoreBootstrap({ RENDER: 'false' }).enabled, false);
  assert.match(shouldAutoRestoreBootstrap({ RENDER: 'true' }).reason, /Render/);
});

test('explicit path wins, then the Render secret file, then the repo copy', () => {
  assert.deepEqual(bootstrapCandidates({}, '/srv/app'), ['/etc/secrets/render-bootstrap.json', '/srv/app/bootstrap/render-bootstrap.json']);
  assert.deepEqual(bootstrapCandidates({ BOOTSTRAP_PATH: '/x/y.json' }, '/srv/app'), ['/x/y.json', '/etc/secrets/render-bootstrap.json', '/srv/app/bootstrap/render-bootstrap.json']);
  assert.deepEqual(bootstrapCandidates({ BOOTSTRAP_PATH: '/etc/secrets/render-bootstrap.json' }, '/srv/app'), ['/etc/secrets/render-bootstrap.json', '/srv/app/bootstrap/render-bootstrap.json']);
});

function stubDeps(overrides = {}) {
  const calls = { imports: [], markers: [] };
  return {
    calls,
    deps: {
      env: { RENDER: 'true' }, cwd: '/srv/app',
      exists: () => false,
      readFile: () => { throw new Error('no file'); },
      isFresh: async () => true,
      importBundle: async bundle => { calls.imports.push(bundle); return { ok: true }; },
      setMarker: async (at, path) => { calls.markers.push({ at, path }); },
      ...overrides,
    },
  };
}

test('a disabled restore never touches the database', async () => {
  const { calls, deps } = stubDeps({ env: {}, isFresh: async () => { throw new Error('must not be called'); } });
  const result = await maybeRestoreBootstrap(deps);
  assert.equal(result.ok, true);
  assert.equal(result.restored, false);
  assert.equal(result.path, null);
  assert.deepEqual(calls.imports, []);
});

test('a missing bootstrap file is a clean skip', async () => {
  const { calls, deps } = stubDeps();
  const result = await maybeRestoreBootstrap(deps);
  assert.equal(result.ok, true);
  assert.equal(result.restored, false);
  assert.match(result.reason, /no bootstrap file/);
  assert.deepEqual(calls.imports, []);
});

test('a configured database is never overwritten', async () => {
  const { calls, deps } = stubDeps({ exists: () => true, isFresh: async () => false });
  const result = await maybeRestoreBootstrap(deps);
  assert.equal(result.ok, true);
  assert.equal(result.restored, false);
  assert.equal(result.path, '/etc/secrets/render-bootstrap.json');
  assert.match(result.reason, /already configured/);
  assert.deepEqual(calls.imports, []);
  assert.deepEqual(calls.markers, []);
});

test('a fresh database imports the first file found and records a marker', async () => {
  const { calls, deps } = stubDeps({ exists: path => path === '/srv/app/bootstrap/render-bootstrap.json', readFile: () => '{"kind":"settings-export"}' });
  const result = await maybeRestoreBootstrap(deps);
  assert.equal(result.ok, true);
  assert.equal(result.restored, true);
  assert.equal(result.path, '/srv/app/bootstrap/render-bootstrap.json');
  assert.deepEqual(calls.imports, [{ kind: 'settings-export' }]);
  assert.equal(calls.markers.length, 1);
  assert.equal(calls.markers[0].path, '/srv/app/bootstrap/render-bootstrap.json');
  assert.match(calls.markers[0].at, /^\d{4}-\d{2}-\d{2}T/);
});

test('bad JSON, failed imports and failed checks report instead of throwing', async () => {
  const bad = stubDeps({ exists: () => true, readFile: () => '{oops' });
  const badResult = await maybeRestoreBootstrap(bad.deps);
  assert.equal(badResult.ok, false);
  assert.match(badResult.error, /not valid JSON/);
  assert.deepEqual(bad.calls.imports, []);
  const failing = stubDeps({ exists: () => true, readFile: () => '{}', importBundle: async () => { throw new Error('db down'); } });
  const failingResult = await maybeRestoreBootstrap(failing.deps);
  assert.equal(failingResult.ok, false);
  assert.equal(failingResult.error, 'db down');
  assert.deepEqual(failing.calls.markers, []);
  const blind = stubDeps({ exists: () => true, isFresh: async () => { throw new Error('db down'); } });
  const blindResult = await maybeRestoreBootstrap(blind.deps);
  assert.equal(blindResult.ok, false);
  assert.match(blindResult.error, /freshness check failed/);
  assert.deepEqual(blind.calls.imports, []);
});

test('the shared Node importer keeps Worker parity (products file, partial merge)', () => {
  const source = readFileSync(new URL('../render-src/server.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('async function importSettingsBundle(bundle: unknown)'), 'manual import and bootstrap share one function');
  assert.ok(source.includes('importSettingsBundle(await c.req.json())'), 'the import route delegates to the shared function');
  assert.ok(source.includes('rawProfileProducts'), 'profile products come from the dedicated file');
  assert.ok(source.includes('const partialConn:any={}'), 'only present connection groups merge, untouched groups survive');
});
