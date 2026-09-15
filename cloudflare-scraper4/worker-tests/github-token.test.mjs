import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import worker from '../scraper4.worker.js';

// The dashboard-saved GitHub token: pickGithubToken prefers the server env
// (ops override) and falls back to settings.githubBackupToken, so a shared-IP
// host can raise its GitHub read quota from the UI. The status endpoint says
// which source is active with a last-4 hint, never the token itself.
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-github-token-'));
await build({ entryPoints: { helper: new URL('../worker-src/deployer-branches.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { pickGithubToken } = await import(pathToFileURL(join(temporary, 'helper.mjs')));

test('pickGithubToken: the env token wins, the saved token is the fallback', () => {
  assert.equal(pickGithubToken('env-tok', { githubBackupToken: 'saved-tok' }), 'env-tok');
  assert.equal(pickGithubToken('', { githubBackupToken: 'saved-tok' }), 'saved-tok');
  assert.equal(pickGithubToken(undefined, { githubBackupToken: 'saved-tok' }), 'saved-tok');
  assert.equal(pickGithubToken(undefined, {}), '');
  assert.equal(pickGithubToken(undefined, undefined), '');
  assert.equal(pickGithubToken('  padded  ', {}), 'padded');
  assert.equal(pickGithubToken('', { githubBackupToken: '  spaced  ' }), 'spaced');
  assert.equal(pickGithubToken('', { githubBackupToken: 42 }), '', 'non-string saved values are ignored');
  assert.equal(pickGithubToken('', null), '');
  assert.equal(pickGithubToken('', 'nope'), '');
});

const ctx = { waitUntil() {}, passThroughOnException() {} };
const stmt = row => ({
  bind: () => stmt(row),
  first: async () => row,
  run: async () => ({ success: true }),
  all: async () => ({ results: [] }),
});
const dbFor = settings => ({
  prepare: () => stmt(settings === undefined ? null : { value: JSON.stringify(settings) }),
  batch: async () => [],
});
const tokenStatus = (env, settings) => worker.fetch(
  new Request('https://worker.test/api/github/token-status'),
  { DB: dbFor(settings), VAULT_SECRET: 'vault-secret', ...env }, ctx).then(r => r.json());

test('token-status: the env token wins and only a hint leaves the server', async () => {
  const body = await tokenStatus({ GH_BACKUP_TOKEN: 'env-secret-ABCD' }, { githubBackupToken: 'saved-secret-WXYZ' });
  assert.equal(body.ok, true);
  assert.equal(body.active, 'env');
  assert.equal(body.env, true);
  assert.equal(body.stored, true);
  assert.equal(body.hint, 'ABCD');
  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('env-secret-ABCD') && !raw.includes('saved-secret-WXYZ'), 'a full token must never leak');
});

test('token-status: a stored token is reported with its own hint', async () => {
  const body = await tokenStatus({}, { githubBackupToken: 'saved-secret-WXYZ' });
  assert.equal(body.ok, true);
  assert.equal(body.active, 'stored');
  assert.equal(body.env, false);
  assert.equal(body.stored, true);
  assert.equal(body.hint, 'WXYZ');
  assert.ok(!JSON.stringify(body).includes('saved-secret-WXYZ'), 'a full token must never leak');
});

test('token-status: nothing configured is honest, not an error', async () => {
  const body = await tokenStatus({}, {});
  assert.equal(body.ok, true);
  assert.equal(body.active, null);
  assert.equal(body.env, false);
  assert.equal(body.stored, false);
  assert.equal(body.hint, null);
  const missing = await tokenStatus({}, undefined);
  assert.equal(missing.active, null, 'a missing settings row reads as unconfigured');
});

const realFetch = globalThis.fetch;
async function withGitHub(stub, fn) {
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('a stored token authorizes real GitHub reads; the env token still wins', async () => {
  const seen = [];
  const stub = async (url, init) => {
    const headers = new Headers(init?.headers || {});
    seen.push(headers.get('authorization'));
    if (String(url).includes('/branches?')) return json([{ name: 'main' }]);
    return json({ name: 'scraper4', version: '1.0.0' });
  };
  const scan = (repo, env, settings) => withGitHub(stub, async () => (await worker.fetch(
    new Request('https://worker.test/api/deployer/branches?repo=' + encodeURIComponent(repo)),
    { DB: dbFor(settings), VAULT_SECRET: 'vault-secret', WORKER_VERSION: '9.9.9', ...env }, ctx)).json());
  const stored = await scan('acme/stored', {}, { githubBackupToken: 'stored-AAA' });
  assert.equal(stored.ok, true);
  assert.ok(seen.length >= 1);
  assert.ok(seen.every(h => h === 'Bearer stored-AAA'), 'the saved token reaches GitHub: ' + JSON.stringify(seen));
  seen.length = 0;
  const envWins = await scan('acme/envwins', { GH_BACKUP_TOKEN: 'env-BBB' }, { githubBackupToken: 'stored-AAA' });
  assert.equal(envWins.ok, true);
  assert.ok(seen.every(h => h === 'Bearer env-BBB'), 'the env token overrides the saved one: ' + JSON.stringify(seen));
});

test('all four GitHub routes on both runtimes share the same token lookup', async () => {
  const [app, server] = await Promise.all([
    readFile(new URL('../worker-src/app.ts', import.meta.url), 'utf8'),
    readFile(new URL('../render-src/server.ts', import.meta.url), 'utf8'),
  ]);
  const workerLookups = app.split("pickGithubToken(c.env.GH_BACKUP_TOKEN,await getState('settings',{}).catch(()=>({})))").length - 1;
  const renderLookups = server.split('pickGithubToken(process.env.GH_BACKUP_TOKEN,await getState(\'settings\',{}).catch(()=>({})))').length - 1;
  assert.equal(workerLookups, 4, 'scan + files + file + push on the worker');
  assert.equal(renderLookups, 4, 'scan + files + file + push on render');
});
