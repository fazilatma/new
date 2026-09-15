import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../scraper4.worker.js';

// Branch backup files through the real production bundle with GitHub stubbed
// out: the branch scan honors ?repo= and reports the latest-version branch,
// the file listing returns newest-first JSON only, downloads are parsed
// JSON with a size cap, and push writes through the Contents API (create or
// update by pre-read sha). Failures are staged; only bad params and a
// missing token are HTTP 400.
const ctx = { waitUntil() {}, passThroughOnException() {} };
const db = { prepare: sql => ({ sql, first: async () => ({ name: 'profiles' }) }), batch: async () => [] };
const realFetch = globalThis.fetch;
async function withGitHub(stub, fn) {
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = realFetch; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const call = (path, env = {}) => worker.fetch(new Request(`https://worker.test${path}`), { DB: db, VAULT_SECRET: 'vault-secret', ...env }, ctx);
const callPost = (path, body, env = {}) => worker.fetch(new Request(`https://worker.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { DB: db, VAULT_SECRET: 'vault-secret', ...env }, ctx);

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

test('branch files: a non-rate 403 surfaces GitHub\u2019s message honestly', async () => {
  const body = await withGitHub(async () => json({ message: 'Resource not accessible by integration' }, 403), async () => (await call('/api/branch-files?branch=main')).json());
  assert.equal(body.ok, false);
  assert.ok(body.error.includes('Resource not accessible'));
  assert.ok(!body.error.toLowerCase().includes('rate limit'), 'must not be mislabeled as a rate limit');
});

test('branch files: a real rate limit names the reset window', async () => {
  const reset = Math.floor(Date.now() / 1000) + 600;
  const body = await withGitHub(async () => new Response(JSON.stringify({ message: 'API rate limit exceeded for 1.2.3.4.' }), { status: 403, headers: { 'x-ratelimit-reset': String(reset) } }), async () => (await call('/api/branch-files?branch=main')).json());
  assert.equal(body.ok, false);
  assert.ok(body.error.includes('rate limit'));
  assert.ok(body.error.includes('resets in ~10m'), body.error);
});

test('branch file: a bad token is reported, not hidden', async () => {
  const body = await withGitHub(async () => json({ message: 'Bad credentials' }, 401), async () => (await call('/api/branch-file?branch=main&path=x.json')).json());
  assert.equal(body.ok, false);
  assert.ok(body.error.includes('Bad credentials'));
});

test('branch push: a new file is created without a sha', async () => {
  const puts = [];
  const stub = async (url, init) => {
    const href = String(url);
    if (init?.method === 'PUT') {
      puts.push({ href, auth: new Headers(init.headers).get('authorization'), body: JSON.parse(init.body) });
      return json({ content: { sha: 'newsha' }, commit: { sha: 'commitsha' } }, 201);
    }
    assert.match(href, /\/repos\/acme\/widgets\/contents\/backups\/b\.json\?ref=main$/);
    return json({ message: 'Not Found' }, 404);
  };
  const push = { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: { a: 1 } };
  const response = await withGitHub(stub, () => callPost('/api/branch-push', push, { GH_BACKUP_TOKEN: 'tok' }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.path, 'backups/b.json');
  assert.equal(body.sha, 'newsha');
  assert.equal(body.commit, 'commitsha');
  assert.equal(body.updated, false);
  assert.equal(puts.length, 1);
  assert.match(puts[0].href, /\/repos\/acme\/widgets\/contents\/backups\/b\.json$/);
  assert.equal(puts[0].auth, 'Bearer tok');
  assert.equal(puts[0].body.branch, 'main');
  assert.equal(puts[0].body.sha, undefined, 'a create sends no sha');
  assert.match(puts[0].body.message, /scraper4 backup b\.json/);
  assert.equal(Buffer.from(puts[0].body.content, 'base64').toString('utf8'), JSON.stringify({ a: 1 }, null, 2));
});

test('branch push: an existing file is updated with its sha', async () => {
  const puts = [];
  const stub = async (url, init) => {
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(init.body));
      return json({ content: { sha: 'newersha' }, commit: { sha: 'commit2' } }, 200);
    }
    return json({ name: 'b.json', sha: 'oldsha', size: 10 });
  };
  const push = { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: { a: 2 } };
  const body = await withGitHub(stub, async () => (await callPost('/api/branch-push', push, { GH_BACKUP_TOKEN: 'tok' })).json());
  assert.equal(body.ok, true);
  assert.equal(body.updated, true);
  assert.equal(body.sha, 'newersha');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].sha, 'oldsha', 'an update must carry the pre-read sha');
});

test('branch push: without a token it is a 400 without touching the network', async () => {
  let fetches = 0;
  const push = { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: { a: 1 } };
  const response = await withGitHub(async () => { fetches++; throw Error('must not fetch'); }, () => callPost('/api/branch-push', push));
  assert.equal(response.status, 400);
  assert.equal(fetches, 0);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'auth');
  assert.match(body.error, /token/i);
});

test('branch push: invalid params are a 400 without touching the network', async () => {
  const stub = async () => { throw Error('must not fetch'); };
  const bad = [
    [{ repo: 'nope', branch: 'main', path: 'backups', name: 'b.json', bundle: {} }, /owner\/name/],
    [{ repo: 'acme/widgets', branch: '', path: 'backups', name: 'b.json', bundle: {} }, /branch/],
    [{ repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'evil.txt', bundle: {} }, /\.json/],
    [{ repo: 'acme/widgets', branch: 'main', path: 'backups', name: '../x.json', bundle: {} }, /\.json/],
    [{ repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: [1] }, /object/],
    [{ repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: { big: 'x'.repeat(6 * 1024 * 1024) } }, /5 MB/],
  ];
  for (const [push, pattern] of bad) {
    const response = await withGitHub(stub, () => callPost('/api/branch-push', push, { GH_BACKUP_TOKEN: 'tok' }));
    assert.equal(response.status, 400, JSON.stringify(push).slice(0, 80));
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.stage, 'params');
    assert.match(body.error, pattern);
  }
});

test('branch push: a bad token is reported, not hidden', async () => {
  const body = await withGitHub(async () => json({ message: 'Bad credentials' }, 401), async () => (await callPost('/api/branch-push', { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: {} }, { GH_BACKUP_TOKEN: 'bogus' })).json());
  assert.equal(body.ok, false);
  assert.equal(body.stage, 'push');
  assert.ok(body.error.includes('Bad credentials'));
});

test('branch push: a forbidden write and a refused write stay honest', async () => {
  const denied = await withGitHub(async () => json({ message: 'Resource not accessible by integration' }, 403), async () => (await callPost('/api/branch-push', { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: {} }, { GH_BACKUP_TOKEN: 'tok' })).json());
  assert.equal(denied.ok, false);
  assert.ok(denied.error.includes('Resource not accessible'));
  assert.ok(!denied.error.toLowerCase().includes('rate limit'), 'must not be mislabeled as a rate limit');
  const refused = await withGitHub(async (url, init) => init?.method === 'PUT'
    ? json({ message: 'Invalid request.\n\n"sha" wasn\u2019t supplied.' }, 422)
    : json({ message: 'Not Found' }, 404), async () => (await callPost('/api/branch-push', { repo: 'acme/widgets', branch: 'main', path: 'backups', name: 'b.json', bundle: {} }, { GH_BACKUP_TOKEN: 'tok' })).json());
  assert.equal(refused.ok, false);
  assert.equal(refused.stage, 'push');
  assert.ok(refused.error.includes('refused'));
  assert.ok(refused.error.includes('sha'));
});
