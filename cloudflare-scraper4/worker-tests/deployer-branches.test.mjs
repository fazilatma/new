import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import worker from '../scraper4.worker.js';

// The dashboard CSP (connect-src 'self') forbids the browser from calling
// api.github.com, so the server scans branch versions and the dashboard
// renders the same-origin reply. These tests drive the real endpoint through
// the production bundle with GitHub itself stubbed out.
//
// NOTE: a successful scan is cached for 5 minutes inside the bundle, so the
// failure tests run first (nothing cached yet), then the success scan, then
// the cache-hit proof. node --test runs them in file order, one process per
// file, so no other file can pollute this cache.

const ctx = { waitUntil() {}, passThroughOnException() {} };
const db = { prepare: sql => ({ sql, first: async () => ({ name: 'profiles' }) }), batch: async () => [] };
const realFetch = globalThis.fetch;
async function withGitHub(stub, fn) {
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}
const call = env => worker.fetch(new Request('https://worker.test/api/deployer/branches'),
  { DB: db, VAULT_SECRET: 'vault-secret', ...env }, ctx);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('deployer branches: a non-array list fails staged', async () => {
  const body = await withGitHub(async () => json({ message: ' Backend error' }), async () => (await call({})).json());
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'list');
  assert.equal(body.error, 'INVALID');
});

test('deployer branches: a rate-limited list fails staged', async () => {
  const body = await withGitHub(async () => json({ message: 'API rate limit exceeded' }, 403), async () => (await call({})).json());
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'list');
  assert.equal(body.error, 'RATE_LIMIT');
  assert.ok(body.detail.includes('403'));
});

test('deployer branches: unreachable GitHub fails staged', async () => {
  const body = await withGitHub(async () => { throw Error('boom'); }, async () => (await call({})).json());
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'list');
  assert.equal(body.error, 'UNREACHABLE');
  assert.ok(body.detail.includes('boom'));
});

test('deployer branches: a 403 without rate evidence is FORBIDDEN with the real message', async () => {
  const body = await withGitHub(async () => json({ message: 'Missing or invalid User Agent string.' }, 403), async () => (await call({})).json());
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'list');
  assert.equal(body.error, 'FORBIDDEN');
  assert.ok(body.detail.includes('User Agent'), 'GitHub\u2019s own words must survive, not a guessed rate limit');
});

test('deployer branches: a 429 retried once is still an honest RATE_LIMIT', async () => {
  let calls = 0;
  const body = await withGitHub(async () => { calls++; return new Response(JSON.stringify({ message: 'slow down' }), { status: 429, headers: { 'retry-after': '0' } }); }, async () => (await call({})).json());
  assert.equal(calls, 2, 'safeFetch retries a 429 once');
  assert.equal(body.ok, false);
  assert.equal(body.error, 'RATE_LIMIT');
});

test('deployer branches: GitHub calls carry a user-agent and the optional token', async () => {
  const seen = [];
  const stub = async (url, init) => {
    const headers = new Headers(init?.headers || {});
    seen.push({ url: String(url), agent: headers.get('user-agent'), auth: headers.get('authorization') });
    if (String(url).includes('/branches?')) return json([{ name: 'main' }]);
    return json({ name: 'scraper4', version: '1.0.0' });
  };
  const authed = await withGitHub(stub, async () => (await worker.fetch(new Request('https://worker.test/api/deployer/branches?repo=acme%2Fheaders'), { DB: db, VAULT_SECRET: 'vault-secret', WORKER_VERSION: '9.9.9', GH_BACKUP_TOKEN: 'tok123' }, ctx)).json());
  assert.equal(authed.ok, true);
  assert.ok(seen.length >= 1);
  assert.ok(seen.every(h => h.agent === 'Scraper4/9.9.9'), 'every GitHub call identifies the client');
  assert.ok(seen.every(h => h.auth === 'Bearer tok123'), 'the configured token is sent');
  seen.length = 0;
  const anon = await withGitHub(stub, async () => (await worker.fetch(new Request('https://worker.test/api/deployer/branches?repo=acme%2Fanon'), { DB: db, VAULT_SECRET: 'vault-secret', WORKER_VERSION: '9.9.9' }, ctx)).json());
  assert.equal(anon.ok, true);
  assert.ok(seen.every(h => h.auth === null), 'no token means no authorization header');
});

test('deployer branches: success scans versions with fallback and statuses', async () => {
  const calls = [];
  const contentsB64 = Buffer.from(JSON.stringify({ name: 'scraper4', version: '1.5.0' })).toString('base64');
  const stub = async url => {
    calls.push(String(url));
    const href = String(url);
    if (href.includes('api.github.com/repos/fazilatma/new/branches')) {
      return json([{ name: 'arena/01a09468-new' }, { name: 'arena/01a0803e-new' }, { name: 'main' }, { nope: true }, null]);
    }
    if (href.includes('raw.githubusercontent.com')) {
      if (href.includes('01a09468')) return json({ name: 'scraper4', version: '2.0.0' });
      return new Response('not found', { status: 404 });
    }
    if (href.includes('/contents/')) {
      if (href.includes('01a0803e')) return json({ content: contentsB64 });
      return new Response('not found', { status: 404 });
    }
    throw Error(`unexpected fetch ${href}`);
  };
  const response = await withGitHub(stub, () => call({ WORKER_VERSION: '2.0.0' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.repo, 'fazilatma/new');
  assert.equal(body.running, '2.0.0');
  assert.equal(body.cached, false);
  assert.equal(body.latest, 'arena/01a09468-new', 'the branch holding the newest code version');
  assert.deepEqual(body.branches, [
    { name: 'arena/01a09468-new', version: '2.0.0', status: 'equal' },
    { name: 'arena/01a0803e-new', version: '1.5.0', status: 'older' },
    { name: 'main', version: '', status: 'unknown' }
  ]);
  assert.equal(calls.filter(u => u.includes('/branches?')).length, 1, 'one list call');
  assert.equal(calls.filter(u => u.includes('raw.githubusercontent.com')).length, 3, 'one manifest attempt per branch');
  assert.ok(!calls.some(u => u.includes('/contents/') && u.includes('01a09468')), 'a raw hit must not fall through');
  assert.equal(calls.filter(u => u.includes('/contents/')).length, 2, 'raw misses fall back to the Contents API');
});

test('deployer branches: the success scan is cached', async () => {
  let fetches = 0;
  const body = await withGitHub(async () => { fetches++; throw Error('must be cached'); }, async () => (await call({ WORKER_VERSION: '9.9.9' })).json());
  assert.equal(fetches, 0, 'a cached scan must not touch the network');
  assert.equal(body.ok, true);
  assert.equal(body.cached, true);
  assert.equal(body.latest, 'arena/01a09468-new', 'latest survives the cache');
  assert.equal(body.running, '9.9.9', 'the cached versions are re-compared against the caller');
  assert.deepEqual(body.branches.map(b => b.status), ['older', 'older', 'unknown']);
});

test('deployer branches: both runtimes wire the shared scan', async () => {
  const [helper, app, server, pkg] = await Promise.all([
    readFile(new URL('../worker-src/deployer-branches.ts', import.meta.url), 'utf8'),
    readFile(new URL('../worker-src/app.ts', import.meta.url), 'utf8'),
    readFile(new URL('../render-src/server.ts', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8')
  ]);
  const version = JSON.parse(pkg).version;
  for (const token of ['export async function scanDeployerBranches', 'export function branchVersionStatus',
    'export function clearDeployerBranchCache', 'DEPLOYER_BRANCHES_TTL_MS = 5 * 60 * 1000',
    'export function latestBranch', 'export function normalizeRepo', "DEFAULT_REPO = 'fazilatma/new'",
    'export function githubApiHeaders', 'export async function classifyGitHubDenial', "'FORBIDDEN'", 'export function pickGithubToken']) {
    assert.ok(helper.includes(token), `the helper must define ${token}`);
  }
  assert.ok(app.includes("from './deployer-branches.js'"), 'the worker must import the shared scan');
  assert.ok(app.includes("app.get('/api/deployer/branches'"), 'the worker must expose the endpoint');
  assert.ok(app.includes(`c.env.WORKER_VERSION||'${version}'`), 'the worker running version must track the package version');
  assert.ok(server.includes("from '../worker-src/deployer-branches.js'"), 'render must reuse the shared scan, not fork it');
  assert.ok(server.includes("app.get('/api/deployer/branches'"), 'render must expose the endpoint');
  assert.ok(server.includes("scanDeployerBranches(githubApiFetch(pickGithubToken(process.env.GH_BACKUP_TOKEN,await getState('settings',{}).catch(()=>({}))),runtimeVersion()),runtimeVersion(),repo)"), 'render must report its running version');
  for (const route of ["app.get('/api/branch-files'", "app.get('/api/branch-file'"]) {
    assert.ok(app.includes(route), `the worker must expose ${route}`);
    assert.ok(server.includes(route), `render must expose ${route}`);
  }
  assert.ok(app.includes("from './branch-backup.js'"), 'the worker must import the shared branch-file reader');
  assert.ok(server.includes("from '../worker-src/branch-backup.js'"), 'render must reuse the shared branch-file reader, not fork it');
  assert.ok(app.includes('githubApiFetch(pickGithubToken(c.env.GH_BACKUP_TOKEN'), 'the worker must forward its token to GitHub reads');
  assert.ok(app.includes("app.get('/api/github/token-status'"), 'the worker must expose the token status');
  assert.ok(server.includes('githubApiFetch(pickGithubToken(process.env.GH_BACKUP_TOKEN'), 'render must forward its token to GitHub reads');
  assert.ok(server.includes("app.get('/api/github/token-status'"), 'render must expose the token status');
});

test('deployer install-branch: the worker answers honestly instead of 404', async () => {
  const response = await worker.fetch(new Request('https://worker.test/api/deployer/install-branch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ branch: 'main' }) }), { DB: db, VAULT_SECRET: 'vault-secret' }, ctx);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, 'NO_DEPLOYER');
  assert.ok(body.error.includes('Worker'));
});
