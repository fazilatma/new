// «دیپلویر» in the hamburger menu is a proxy, not a copy of the deployer: the dashboard asks the
// Node server, the Node server asks the deployer that runs on the same machine. That chain only
// holds if three files agree — the allow-list in render-src/server.ts, the action names the
// dashboard uses, and the deployer's own routes — so the agreement itself is pinned here, together
// with the guards that keep a localhost endpoint from becoming a generic HTTP proxy.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { pickNotifyChannel, tokenizeCommand } from '../scripts/deployer-notify.mjs';

const DASHBOARD = new URL('../worker-src/dashboard.ts', import.meta.url);
const SERVER = new URL('../render-src/server.ts', import.meta.url);
const WORKER = new URL('../worker-src/app.ts', import.meta.url);

function sliceBetween(text, startMarker, endMarker, label) {
  const start = text.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker missing`);
  const end = text.indexOf(endMarker, start);
  assert.ok(end > start, `${label}: end marker missing`);
  return text.slice(start, end + endMarker.length);
}

test('LOCAL_DEPLOYER_NOTIFY_CMD may carry its own arguments without ever touching a shell', () => {
  assert.deepEqual(tokenizeCommand('sh /data/com.termux/files/usr/bin/hook.sh'), ['sh', '/data/com.termux/files/usr/bin/hook.sh']);
  assert.deepEqual(tokenizeCommand('"/data/my hooks/notify me.sh" --priority high'), ['/data/my hooks/notify me.sh', '--priority', 'high']);
  assert.deepEqual(tokenizeCommand('   '), []);
  assert.deepEqual(tokenizeCommand(null), []);

  const channel = pickNotifyChannel({ platform: 'linux', env: { LOCAL_DEPLOYER_NOTIFY_CMD: 'sh /tmp/notify.sh' } });
  assert.equal(channel.id, 'custom');
  const built = channel.build('Scraper4 1.183.0 available', 'branch "quoted"   name');
  assert.equal(built.command, 'sh');
  assert.deepEqual(built.args, ['/tmp/notify.sh', 'Scraper4 1.183.0 available', 'branch "quoted" name']);
  // A quote inside a title must stay one argument, so it can never become code.
  assert.equal(built.args[2], 'branch "quoted" name');
  assert.doesNotMatch(JSON.stringify(built), /sh \/tmp/, 'the command is never re-parsed as a shell string');

  // An empty override must not disable the platform notifier.
  assert.equal(pickNotifyChannel({ platform: 'linux', env: { LOCAL_DEPLOYER_NOTIFY_CMD: '  ' } }).id, 'notify-send');
  assert.equal(pickNotifyChannel({ platform: 'openwrt', env: {} }), null);
});

test('the deployer proxy is an allow-list of named calls, never a general forwarder', async () => {
  const server = await readFile(SERVER, 'utf8');
  const block = sliceBetween(server, 'const DEPLOYER_LOCAL_CALLS = {', '\n};', 'DEPLOYER_LOCAL_CALLS');
  const allowed = [...block.matchAll(/^ {2}([A-Za-z]+): \{ method: '(GET|POST)', path: '([^']+)'/gm)];
  const names = allowed.map(m => m[1]);
  assert.deepEqual(
    names,
    ['status', 'branches', 'jobs', 'logs', 'libraries', 'pyStatus', 'notifications', 'scan', 'install', 'update', 'job', 'scraperStart', 'scraperStop', 'scraperRestart', 'notifyTest', 'notifyScan'],
    'the proxied actions are exactly the deployer jobs the dashboard offers'
  );
  assert.deepEqual(allowed.filter(m => m[3].includes('..') || m[3].includes('//')).map(m => m[3]), [], 'every upstream path is a fixed absolute route');

  // No target may come from the request: that would turn the localhost proxy into an SSRF hole.
  assert.doesNotMatch(server, /\/api\/deployer\/(proxy|forward)/, 'there is no pass-through proxy route');
  const route = sliceBetween(server, "app.on(['GET', 'POST'], '/api/deployer/local/:action'", '\n});', 'deployer local route');
  assert.match(route, /const call = \(DEPLOYER_LOCAL_CALLS as any\)\[name\];/, 'unknown actions are refused before any fetch');
  assert.match(route, /await fetch\(base \+ call\.path/, 'only base + an allow-listed path is ever fetched');
  assert.doesNotMatch(route, /payload\.(url|base|host|target)|req\.query\.(url|base|host)/, 'the request cannot choose the upstream address');
  assert.match(route, /setTimeout\(\(\) => \{ timedOut = true; controller\.abort\(\); \}, 20_000\)/, 'a wedged deployer cannot pin the request open');
});

test('every deployer action the dashboard asks for exists on the proxy', async () => {
  const [dashboard, server] = await Promise.all([readFile(DASHBOARD, 'utf8'), readFile(SERVER, 'utf8')]);
  const allowed = new Set([...server.matchAll(/^ {2}([A-Za-z]+): \{ method: '(?:GET|POST)', path: '\/api/gm)].map(m => m[1]));
  assert.ok(allowed.size >= 16, `proxy allow-list parsed (${allowed.size} actions)`);
  const used = new Set([
    ...[...dashboard.matchAll(/deployerLocalCall\('([a-zA-Z]+)'/g)].map(m => m[1]),
    ...[...dashboard.matchAll(/deployerRun\('[^']*','([a-zA-Z]+)'/g)].map(m => m[1])
  ]);
  assert.ok(used.size >= 5, `the panel really uses the proxy (${used.size} actions)`);
  assert.deepEqual([...used].filter(name => !allowed.has(name)), [], 'no button asks for an action the server would refuse');
});

test('branch and job arguments are re-validated on the way in', async () => {
  const server = await readFile(SERVER, 'utf8');
  const guard = sliceBetween(server, 'const DEPLOYER_LOCAL_BRANCH_SAFE =', '\n}', 'deployerLocalBranchSafe');
  const factory = new Function('normalizeInstallBranch', `${guard}; return deployerLocalBranchSafe;`);
  // The GitHub ref helper is deliberately permissive; the extra rules are the point.
  const asIs = value => value;
  const check = factory(asIs);
  assert.equal(check('../../../etc/passwd'), null, 'path traversal is refused');
  assert.equal(check('--upload-pack=evil'), null, 'an option-looking ref never reaches git');
  assert.equal(check('-x'), null, 'a leading dash is refused');
  assert.equal(check('feature/a b'), null, 'whitespace is refused');
  assert.equal(check(''), null);
  assert.equal(check('production'), 'production');
  assert.equal(check('arena/01a09468-new'), 'arena/01a09468-new');

  // Only the deployer's own job verbs may be started through /api/job.
  const jobs = sliceBetween(server, 'const DEPLOYER_LOCAL_JOB_ACTIONS = new Set([', ']);', 'job allow-list');
  for (const name of ['install', 'test', 'build', 'localBuild', 'databaseInstall']) {
    assert.ok(jobs.includes(`'${name}'`), `${name} stays allowed`);
  }
  for (const name of ['restart', 'shutdown', 'exec', 'deploy']) {
    assert.ok(!jobs.includes(`'${name}'`), `${name} is not reachable from the dashboard`);
  }
});

test('the proxied reply never carries the deployer token', async () => {
  const server = await readFile(SERVER, 'utf8');
  const route = sliceBetween(server, "app.on(['GET', 'POST'], '/api/deployer/local/:action'", '\n});', 'deployer local route');
  const replies = [...route.matchAll(/return c\.json\(([^;]*?)\)(, \d{3}\)|;)/gs)].map(m => m[1]);
  assert.ok(replies.length >= 3, `the route answers in ${replies.length} places`);
  for (const reply of replies) {
    const stripped = reply.replace(/token \? source : 'unsigned'/g, 'source');
    assert.doesNotMatch(stripped, /[{,]\s*(token|secret|password)\s*[:,}]/, 'a reply body must not carry the secret: ' + reply.slice(0, 80));
  }
  assert.match(route, /'x-local-deployer-token': token/, 'the token goes out as a header only');
  assert.match(route, /deployer: \{ base, source: token \? source : 'unsigned' \}/, 'the reply says where the handshake came from, without the secret');
});

test('the Worker runtime answers the same route with an honest 501', async () => {
  const app = await readFile(WORKER, 'utf8');
  const route = sliceBetween(app, "app.on(['GET', 'POST'], '/api/deployer/local/:action'", '}, 501));', 'worker twin route');
  assert.match(route, /code: 'NO_DEPLOYER'/, 'the failure carries a machine-readable code');
  assert.match(route, /این رانتایم دیپلویر محلی ندارد/, 'and a Persian sentence that says why');
assert.match(route, /جدول برنچ‌ها در همین سرور کار می‌کند/, 'and points at the branch table that still works there')
  assert.doesNotMatch(route, /await fetch/, 'the Worker never tries to reach a deployer it cannot see');
});

test('«دیپلویر محلی» is a real hamburger section, ordered and grouped like its siblings', async () => {
  const dashboard = await readFile(DASHBOARD, 'utf8');
  const block = sliceBetween(dashboard, 'const menuDefs=[', '\n];', 'menuDefs');
  const titles = [...block.matchAll(/^ \['([^']+)'/gm)].map(m => m[1]);
  const at = titles.indexOf('🚀 دیپلویر محلی');
  assert.ok(at > 0, 'the deployer has its own drawer section');
  assert.equal(titles[at - 1], '🔄 نسخهٔ کد', 'it sits right after the version section it complements');

  const entry = sliceBetween(block, " ['🚀 دیپلویر محلی','deployer-local',", "'],\n", 'deployer section');
  assert.match(entry, /id="deployerLocalStatus"/, 'the section has its own status console');
  assert.match(entry, /id="depNotifyState"/, 'and a line that explains the notification channel');
  assert.match(entry, /id="depRecent"/, 'and the notices it already sent');
  assert.match(entry, /table|جدول برنچ‌ها/, 'and it tells the user where the branch table stayed');

  // Every button in the section is wired.
  const actions = [...entry.matchAll(/mButton\("[^"]*","([a-z-]+)"/g)].map(m => m[1]);
  assert.ok(actions.length >= 9, `the section offers ${actions.length} actions`);
  for (const action of actions) {
    assert.match(dashboard, new RegExp(`action==='${action}'`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${action} has a handler`);
  }

  // The group headings are positional, so adding a section must renumber them.
  assert.match(dashboard, /const menuGroupAt=\{0:'🧰 نگهداری و نسخه',4:'🔌 اتصال‌ها و سرویس‌ها',8:'📦 عملیات محصولات و سلامت',17:'🤖 اتوماسیون و گزارش'\}/);
});

test('the panel reads the deployer only where a deployer can exist', async () => {
  const dashboard = await readFile(DASHBOARD, 'utf8');
  assert.match(dashboard, /renderDeployerEnvHint\(\);if\(deployerEnvKind\(\)==='local'\)renderDeployerLocal\(\);/);
  assert.match(dashboard, /deployerEnvKind\(\)==='local'\?'<div class="menu-text">دستور اجرا روی همین دستگاه/s, 'and the manual start command is only offered on localhost');
  assert.match(dashboard, /function deployerLocalRows\(d\)/, 'the status rows are their own pure function');
  const rows = sliceBetween(dashboard, 'function deployerLocalRows(d){', '\n}', 'deployerLocalRows');
  for (const label of ['نسخهٔ نصب‌شده', 'اسکریپر', 'برنچ', 'دیتابیس']) {
    assert.ok(rows.includes(`['${label}`), `the panel reports ${label}`);
  }
});
