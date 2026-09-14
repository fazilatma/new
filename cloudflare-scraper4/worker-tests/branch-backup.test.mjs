import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../scraper4.worker.js';

// Branch backup files through the real production bundle with GitHub stubbed
// out: the branch scan honors ?repo= and reports the latest-version branch,
// the file listing returns newest-first JSON only, and downloads are parsed
// JSON with a size cap. Failures are staged; only bad params are HTTP 400.
const ctx = { waitUntil() {}, passThroughOnException() {} };
const db = { prepare: sql => ({ sql, first: async () => ({ name: 'profiles' }) }), batch: async () => [] };
const realFetch = globalThis.fetch;
async function withGitHub(stub, fn) {
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const call = (path, env = {}) => worker.fetch(new Request(`https://worker.test${path}`), { DB: db, VAULT_SECRET: 'vault-secret', ...env }, ctx);

test('branch scan: ?repo= is honored and the latest-version branch is reported', async () => {
  const calls = [];
  const stub = async url => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/repos/acme/widgets/branches')) return json([{ name: 'main' }, { name: 'dev' }]);
    if (href.includes('raw.githubusercontent.com/acme/widgets/')) return json({ name: 'scraper4', version: href.includes('/dev/') ? '2.1.0' : '1.0.0' });
    throw Error(`unexpected fetch ${href}`);
  };
  const response = await withGitHub(stub, () => call('/api/deployer/branches?repo=acme%2Fwidgets', { WORKER_VERSION: '2.0.0' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.repo, 'acme/widgets');
  assert.equal(body.latest, 'dev');
  assert.deepEqual(body.branches, [
    { name: 'main', version: '1.0.0', status: 'older' },
    { name: 'dev', version: '2.1.0', status: 'newer' }
  ]);
  assert.ok(calls.length >= 3 && calls.every(u => u.includes('acme/widgets')), 'every GitHub call targets the requested repo');
});

test('branch scan: an invalid repo is a 400 without touching the network', async () => {
  let fetches = 0;
  const response = await withGitHub(async () => { fetches++; throw Error('must not fetch'); }, () => call('/api/deployer/branches?repo=nope'));
  assert.equal(response.status, 400);
  assert.equal(fetches, 0);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'INVALID');
});

test('branch files: JSON only, newest name first, branch safely encoded', async () => {
  const calls = [];
  const stub = async url => {
    const href = String(url);
    calls.push(href);
    assert.match(href, /\/repos\/acme\/widgets\/contents\/backups\?ref=arena%2Fx$/);
    return json([
      { name: 'b.json', path: 'backups/b.json', size: 20, sha: 'b', type: 'file' },
      { name: 'a.json', path: 'backups/a.json', size: 10, sha: 'a', type: 'file' },
      { name: 'note.txt', path: 'backups/note.txt', size: 5, sha: 't', type: 'file' },
      { name: 'sub', path: 'backups/sub', size: 0, sha: 'd', type: 'dir' }
    ]);
  };
  const response = await withGitHub(stub, () => call('/api/branch-files?repo=acme%2Fwidgets&branch=arena%2Fx&path=backups'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    ok: true, repo: 'acme/widgets', branch: 'arena/x', path: 'backups',
    files: [
      { name: 'b.json', path: 'backups/b.json', size: 20, sha: 'b' },
      { name: 'a.json', path: 'backups/a.json', size: 10, sha: 'a' }
    ]
  });
  assert.equal(calls.length, 1);
});

test('branch files: a missing folder is empty, not an error', async () => {
  const body = await withGitHub(async () => new Response('nope', { status: 404 }), async () => (await call('/api/branch-files?branch=main')).json());
  assert.deepEqual(body.files, []);
  assert.equal(body.ok, true);
});

test('branch files: invalid params are a 400', async () => {
  for (const path of ['/api/branch-files?branch=..', '/api/branch-files?repo=bad', '/api/branch-files?branch=main&path=../x']) {
    const response = await withGitHub(async () => { throw Error('must not fetch'); }, () => call(path));
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).stage, 'params');
  }
});

test('branch file: downloads and parses the bundle', async () => {
  const bundle = { kind: 'settings-export', files: { 'profiles.json': {} } };
  const stub = async url => {
    assert.match(String(url), /\/repos\/acme\/widgets\/contents\/backups\/b\.json\?ref=main$/);
    return json({ name: 'b.json', path: 'backups/b.json', size: 99, sha: 'b', type: 'file', content: Buffer.from(JSON.stringify(bundle)).toString('base64') });
  };
  const response = await withGitHub(stub, () => call('/api/branch-file?repo=acme%2Fwidgets&branch=main&path=backups%2Fb.json'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.name, 'b.json');
  assert.deepEqual(body.bundle, bundle);
});

test('branch file: broken JSON and oversize files fail staged, not as 500s', async () => {
  const broken = await withGitHub(async () => json({ name: 'x.json', size: 8, content: Buffer.from('{oops').toString('base64') }), async () => (await call('/api/branch-file?branch=main&path=x.json')).json());
  assert.equal(broken.ok, false);
  assert.equal(broken.stage, 'fetch');
  assert.match(broken.error, /not valid JSON/);
  const big = await withGitHub(async () => json({ name: 'x.json', size: 6 * 1024 * 1024, content: '' }), async () => (await call('/api/branch-file?branch=main&path=x.json')).json());
  assert.equal(big.ok, false);
  assert.match(big.error, /5 MB/);
});

test('branch file: non-JSON paths are a 400', async () => {
  const response = await withGitHub(async () => { throw Error('must not fetch'); }, () => call('/api/branch-file?branch=main&path=x.txt'));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).stage, 'params');
});
