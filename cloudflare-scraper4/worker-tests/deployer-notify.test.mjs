// «A new version was seen» has to leave the process: the deployer runs in the background on a phone
// or a VPS, so its discovery goes to the operating system. Two halves are checked here —
// scripts/deployer-notify.mjs picks the channel and decides what deserves a notice (unit), and the
// deployer server really hands the message to that program and remembers it (integration, with a
// fake notifier: no GitHub, no network, no live site).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import {
  notifyEnabledFor,
  notifyKey,
  pendingNotices,
  pickNotifyChannel,
  pushNotice,
  sendNotification
} from '../scripts/deployer-notify.mjs';

const title = 'Scraper4 1.183.0 available';
const body = 'Branch arena/01a09468-new has v1.183.0; this machine runs 1.182.0+.';

const oneLine = (branchState, extra = {}) => pendingNotices({
  branchState, code: extra.code || {}, installedVersion: extra.installed || '1.182.0+', seen: extra.seen
});

test('notify: the off switch accepts the words people actually type', () => {
  assert.equal(notifyEnabledFor(undefined), true, 'no setting means announce');
  assert.equal(notifyEnabledFor('true'), true);
  assert.equal(notifyEnabledFor('nope?'), true, 'a value that is not a refusal is not a refusal');
  for (const off of ['false', '0', 'no', 'off', 'OFF', ' off ']) {
    assert.equal(notifyEnabledFor(off), false, `"${off}" must turn it off`);
  }
});

test('notify: every platform gets the notifier it actually has', () => {
  const linux = pickNotifyChannel({ platform: 'linux', env: {} });
  assert.equal(linux.id, 'notify-send');
  const args = linux.build(title, body).args;
  assert.deepEqual(args.slice(-2), [title, body], 'text travels as arguments, never inside a shell string');
  assert.ok(args.includes('critical'), 'a new release is not something to slide past silently');

  const android = pickNotifyChannel({ platform: 'android', env: {} });
  assert.equal(android.id, 'termux', 'Termux has its own notifier');
  assert.equal(android.build(title, body).command, 'termux-notification');
  assert.equal(pickNotifyChannel({ platform: 'linux', env: { TERMUX_VERSION: '0.118' } }).id, 'termux',
    'a Termux environment reports itself as linux, and still needs termux-notification');

  assert.equal(pickNotifyChannel({ platform: 'darwin', env: {} }).id, 'osascript');
  assert.match(pickNotifyChannel({ platform: 'darwin', env: {} }).build('a "quoted" title', body).args[1], /display notification/);
  assert.equal(pickNotifyChannel({ platform: 'win32', env: {} }).id, 'powershell');
  assert.equal(pickNotifyChannel({ platform: 'sunos', env: {} }), null, 'an unknown platform says so instead of guessing');
});

test('notify: an explicit command wins, and its quoting cannot escape into a shell', () => {
  const custom = pickNotifyChannel({ platform: 'linux', env: { LOCAL_DEPLOYER_NOTIFY_CMD: '/usr/local/bin/my-notify' } });
  assert.equal(custom.id, 'custom');
  assert.equal(custom.label, '/usr/local/bin/my-notify');
  const built = custom.build('half"; rm -rf /', 'body');
  assert.equal(built.command, '/usr/local/bin/my-notify');
  assert.deepEqual(built.args, ['half"; rm -rf /', 'body'], 'the dangerous text stays one opaque argument');
});

test('notify: titles and bodies are flattened to one bounded line', () => {
  const args = pickNotifyChannel({ platform: 'linux', env: {} }).build('a\nb\tc', 'x'.repeat(400)).args;
  assert.equal(args[args.length - 2], 'a b c');
  assert.ok(args[args.length - 1].length <= 180, 'a notifier argument stays sane');
});

test('notify: what deserves an announcement, and what never again', () => {
  const newer = oneLine({
    latest: { name: 'arena/01a09468-new', version: '1.183.0', sha: 'aaa111', hasCode: true },
    current: { branch: 'arena/01a0a647-new', version: '1.182.0+', sha: 'bbb222' }
  });
  assert.equal(newer.length, 1, 'a newer branch is exactly one notice');
  assert.equal(newer[0].kind, 'newer-branch');
  assert.match(newer[0].title, /1\.183\.0 available/);
  assert.match(newer[0].body, /this machine runs 1\.182\.0\+/, 'and it names both versions, so the choice is informed');

  const repeated = oneLine({
    latest: { name: 'arena/01a09468-new', version: '1.183.0', sha: 'aaa111', hasCode: true },
    current: { branch: 'arena/01a0a647-new', version: '1.182.0+', sha: 'bbb222' }
  }, { seen: new Set([newer[0].key]) });
  assert.equal(repeated.length, 0, 'the same release is never announced twice, however often the scanner runs');

  assert.equal(oneLine({
    latest: { name: 'arena/01a0a647-new', version: '1.182.0+', sha: 'new111', hasCode: true },
    current: { branch: 'arena/01a0a647-new', version: '1.182.0+', sha: 'old222' }
  })[0].kind, 'new-commit', 'your own branch moving under you is worth one notice');

  const restart = oneLine({
    latest: { name: 'arena/01a0a647-new', version: '1.182.0+', sha: 'same', hasCode: true },
    current: { branch: 'arena/01a0a647-new', version: '1.182.0+', sha: 'same' }
  }, { code: { stale: true, running: '1.182.0+', onDisk: '1.183.0+' } });
  assert.equal(restart.length, 1, 'a newer build on disk that is not running is the third case');
  assert.equal(restart[0].kind, 'restart-needed');
  assert.match(restart[0].title, /on disk, not running/);

  assert.deepEqual(oneLine({}, { installed: '' }), [], 'nothing scanned, nothing claimed');
  assert.equal(oneLine({
    latest: { name: 'main', version: '1.183.0', sha: 'x', hasCode: false },
    current: { branch: 'arena/01a0a647-new' }
  }).length, 0, 'a branch without the scraper code is not a newer version');
  assert.equal(oneLine({
    latest: { name: 'arena/01a09468-new', version: '1.181.0', sha: 'aaa', hasCode: true },
    current: { branch: 'arena/01a0a647-new', version: '1.182.0+', sha: 'bbb' }
  }).length, 0, 'an older branch on another machine is not news here');
  assert.equal(oneLine({
    latest: { name: 'arena/01a0a647-new', version: '1.182.0', sha: 'same', hasCode: true },
    current: { branch: 'arena/01a09468-new', version: '1.182.0+', sha: 'other' }
  }).length, 0, '1.182.0 and 1.182.0+ are the same release: the marker is not a new version');
});

test('notify: the dedupe key is per release and per commit', () => {
  const a = notifyKey('branch', { name: 'arena/01a09468-new', version: '1.183.0', sha: 'aaa111999999abcd' });
  assert.equal(a, notifyKey('branch', { name: 'arena/01a09468-new', version: '1.183.0', sha: 'aaa111999999ffff' }), 'a long oid is one event: the key holds a 12-char prefix');
  assert.notEqual(a, notifyKey('branch', { name: 'arena/01a09468-new', version: '1.183.0', sha: 'bbb222999999abcd' }), 'a moved tip is a new event');
  assert.notEqual(a, notifyKey('disk', { name: 'arena/01a09468-new', version: '1.183.0', sha: 'aaa111999999abcd' }), 'and a different kind is never confused with it');
});

test('notify: sending never throws, never hangs, and always says what happened', async () => {
  const calls = [];
  const fakeChannel = { id: 'fake', label: 'fake notifier', build: () => ({ command: 'true', args: [] }) };
  const good = await sendNotification(fakeChannel, title, body, {
    spawn: (command, args) => {
      calls.push([command, args]);
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit('close', 0), 0);
      return child;
    }
  });
  assert.equal(good.ok, true, 'a zero exit is a delivered notification');
  assert.equal(good.label, 'fake notifier', 'and the channel is named, so the UI can say so');
  assert.deepEqual(calls[0][0], 'true');

  const missing = await sendNotification(fakeChannel, title, body, {
    spawn: () => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit('error', Object.assign(new Error('spawn notify-send ENOENT'), { code: 'ENOENT' })), 0);
      return child;
    }
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /ENOENT/, 'a machine without the notifier reports the reason instead of failing the scan');

  const nonzero = await sendNotification({ id: 'x', label: 'x', build: () => ({ command: 'false', args: [] }) }, 't', 'b', {
    spawn: () => {
      const child = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      setTimeout(() => { child.stderr.emit('data', 'No such file or directory'); child.emit('close', 3); }, 0);
      return child;
    }
  });
  assert.equal(nonzero.ok, false, 'a non-zero exit is reported, not thrown');
  assert.match(nonzero.error, /exit 3: No such file or directory/, 'with the notifier\'s own complaint attached');

  const hanging = await sendNotification({ id: 'hang', label: 'hangs', build: () => ({ command: 'sleep', args: ['5'] }) }, 't', 'b', {
    timeoutMs: 60,
    spawn: () => { const child = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}; return child; }
  });
  assert.equal(hanging.ok, false, 'a notifier that never returns gets killed');
  assert.match(hanging.error, /timed out/);

  const none = await sendNotification(null, 't', 'b');
  assert.equal(none.ok, false, 'no channel is an explained failure, not a crash');
  assert.match(none.error, /no system notifier/);
});

test('notify: the notice log is bounded and newest-first', () => {
  const log = [];
  for (let i = 0; i < 25; i++) pushNotice(log, { at: 't' + i, title: 'v' + i }, 10);
  assert.equal(log.length, 10, 'the deployer lives for weeks; its notice log cannot grow forever');
  assert.equal(log[0].title, 'v24', 'and the newest is first, which is what the rail reads');
});

// --------------------------------------------------------------------------- server half
const deployerSource = readFileSync(new URL('../scripts/local-deployer-ui.mjs', import.meta.url), 'utf8');

test('deployer server: the channel is wired into the scan, the status payload and the page', () => {
  assert.match(deployerSource, /from '\.\/deployer-notify\.mjs'/, 'the deployer uses the shared module, not a private copy of the rules');
  assert.match(deployerSource, /announceVersions\(\{ reason \}\)\.catch\(/,
    'every scan announces, fire-and-forget, so a hanging notifier cannot stall the scanner');
  assert.match(deployerSource, /notify: notifyPayload\(\),/, 'and /api/status carries the state the rail reads');
  assert.match(deployerSource, /url\.pathname === '\/api\/notifications'/, 'GET /api/notifications exists');
  assert.match(deployerSource, /url\.pathname === '\/api\/notifications\/test'/, 'POST /api/notifications/test exists');
  assert.match(deployerSource, /url\.pathname === '\/api\/notifications\/scan'/, 'a manual scan-then-announce exists for the dashboard');
  assert.match(deployerSource, /if \(!notifyEnabled\) return send\(res, 200, \{ ok: false, channel: 'off'/,
    'when it is switched off, the reason is what comes back');
  assert.match(deployerSource, /writeDeployerHandshake\(\{ port, host, token/, 'the handshake file is written once the real port is known');
  assert.match(deployerSource, /id="railNotify"/, 'the rail shows which channel is in use');
  assert.match(deployerSource, /onclick="armNotify\(\)"/, 'the page can arm the browser half of it');
  assert.match(deployerSource, /onclick="testNotify\(\)"/, 'and test it without waiting for a release');
  assert.match(deployerSource, /announceBrowserNotice\(d\);\n\s*lastRefreshAt/, 'the poll raises the browser notice right after the rail update');
  assert.match(deployerSource, /const NOTIFY_SEEN_KEY = 'scraper4-deployer-notified';/, 'and remembers per release what it already raised');
  assert.match(deployerSource, /requireInteraction|requireInteraction: latest\.kind === 'newer-branch'/,
    'a real new release stays on screen instead of vanishing after seconds');
});

/** A port nobody is holding: a fixed one would collide with another test run, and then the
 *  deployer quietly binds the next free port and every later assertion is off by one. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test('deployer server: a running process hands the message to the notifier and publishes the handshake', async t => {
  if (process.platform === 'win32') { t.skip('the fake notifier is a POSIX shell script'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'dep-notify-'));
  const port = await freePort();
  const inbox = join(dir, 'inbox.txt');
  const fake = join(dir, 'fake-notify.sh');
  writeFileSync(fake, '#!/bin/sh\nprintf "%s|%s\\n" "$1" "$2" >> "$NOTIFY_INBOX"\n', { mode: 0o755 });
  // A throwaway checkout: the deployer's project dir is its cwd, and a directory without an
  // 'origin' remote makes the branch scan fail on its own guarded path instead of reaching
  // GitHub. Tests in this repository never touch a live site.
  const project = join(dir, 'project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'scraper4-testbox', version: '9.9.9+', scripts: {} }, null, 2));
  spawnSync('git', ['init', '-q'], { cwd: project });
  const handshakeFile = join(dir, 'handshake.json');
  const env = {
    ...process.env,
    NOTIFY_INBOX: inbox,
    DEPLOYER_UI_PORT: String(port),
    DEPLOYER_UI_HOST: '127.0.0.1',
    DEPLOYER_HANDSHAKE_FILE: handshakeFile,
    DEPLOYER_UI_TOKEN: 'test-token-notify',
    LOCAL_DEPLOYER_AUTO_UPDATE: '0',
    LOCAL_DEPLOYER_AUTO_INSTALL_LATEST: 'false',
    LOCAL_SCRAPER_AUTOSTART: 'false',
    LOCAL_DEPLOYER_NOTIFY_CMD: fake
  };
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/local-deployer-ui.mjs', import.meta.url))], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => { out += String(chunk); });
  child.stderr.on('data', chunk => { out += String(chunk); });
  const api = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { 'x-local-deployer-token': 'test-token-notify', ...(init && init.headers || {}) }
  });
  try {
    const deadline = Date.now() + 25_000;
    while (!/Local Deployer UI is running/.test(out) && Date.now() < deadline) await new Promise(r => setTimeout(r, 150));
    assert.match(out, /Local Deployer UI is running/, `the deployer must boot:\n${out.slice(-700)}`);

    const handshake = JSON.parse(readFileSync(handshakeFile, 'utf8'));
    assert.equal(handshake.port, port, 'the handshake file records the port that is actually bound');
    assert.equal(handshake.token, 'test-token-notify', 'and the token a local proxy will need');
    assert.equal(handshake.version, '9.9.9+', 'and the version, so a stale handshake is recognisable');
    const mode = statSync(handshakeFile).mode & 0o777;
    assert.equal(mode & 0o077, 0, 'a file holding the token must not be readable by the group or others');

    const unauthorized = await fetch(`http://127.0.0.1:${port}/api/notifications`);
    assert.equal(unauthorized.status, 401, 'the notification endpoints sit behind the same token guard as everything else');

    const status = await (await api('/api/status')).json();
    assert.equal(status.notify.enabled, true, 'announcements are on unless someone said otherwise');
    assert.equal(status.notify.channel.id, 'custom', 'an explicit command wins over platform guessing');
    assert.equal(status.notify.channel.label, fake);
    assert.deepEqual(status.notify.recent, [], 'a process that noticed nothing yet says so');

    const sent = await (await api('/api/notifications/test', { method: 'POST', body: '{}' })).json();
    assert.equal(sent.ok, true, `the fake notifier must be reached; log:\n${out.slice(-400)}`);
    assert.match(out, /\[deployer\] test notification sent via custom/, 'and the attempt shows up in the deployer log');
    const lines = readFileSync(inbox, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    assert.equal(lines[0].split('|')[0], 'Scraper4 deployer', 'the title arrives intact');
    assert.match(lines[0].split('|')[1], /system notifications work/, 'and so does the body');

    const listed = await (await api('/api/notifications')).json();
    assert.equal(listed.recent[0].kind, 'test', 'the newest notice is what the rail reads first');
    assert.equal(listed.recent[0].ok, true);
    assert.equal(listed.seen, 0, 'a test notice is not a version, so it does not consume a dedupe slot');

    const afterScan = await (await api('/api/notifications/scan', { method: 'POST', body: '{}' })).json();
    assert.equal(afterScan.announce.ok, true, 'the scan route reports its announce pass');
    assert.deepEqual(afterScan.announce.sent, [], 'and a checkout with no origin remote notices no version');
    assert.equal(afterScan.notify.recent[0].kind, 'test', 'the log survives the scan pass');
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    try { child.kill('SIGKILL'); } catch {}
  }
});

// The ledger is the only reason a restart is quiet. An in-memory Set meant every watchdog restart
// re-announced the same release, and the rail's «last notices» came up empty after an update —
// exactly when someone is most likely to look. So: read on boot, write after a send, never clobber.
test('deployer server: the notice ledger survives a restart', async t => {
  if (process.platform === 'win32') { t.skip('the fake notifier is a POSIX shell script'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'dep-ledger-'));
  const port = await freePort();
  const inbox = join(dir, 'inbox.txt');
  const fake = join(dir, 'fake-notify.sh');
  writeFileSync(fake, '#!/bin/sh\nprintf "%s|%s\\n" "$1" "$2" >> "$NOTIFY_INBOX"\n', { mode: 0o755 });
  const project = join(dir, 'project');
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'scraper4-testbox', version: '9.9.9+', scripts: {} }, null, 2));
  spawnSync('git', ['init', '-q'], { cwd: project });
  const ledger = join(dir, 'ledger.json');
  const announced = 'newer-branch:production:9.9.9:abcdef123456';
  writeFileSync(ledger, JSON.stringify({
    seen: [announced],
    recent: [{ at: '2026-01-01T00:00:00.000Z', reason: 'scan', key: announced, kind: 'newer-branch', title: 'Scraper4 9.9.9 available', body: 'noticed before the restart', ok: true, channel: 'custom' }]
  }, null, 2));
  const env = {
    ...process.env,
    NOTIFY_INBOX: inbox,
    DEPLOYER_UI_PORT: String(port),
    DEPLOYER_UI_HOST: '127.0.0.1',
    DEPLOYER_UI_TOKEN: 'test-token-ledger',
    DEPLOYER_HANDSHAKE_FILE: join(dir, 'handshake.json'),
    LOCAL_DEPLOYER_NOTIFY_STATE: ledger,
    LOCAL_DEPLOYER_AUTO_UPDATE: '0',
    LOCAL_DEPLOYER_AUTO_INSTALL_LATEST: 'false',
    LOCAL_SCRAPER_AUTOSTART: 'false',
    LOCAL_DEPLOYER_NOTIFY_CMD: fake
  };
  const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/local-deployer-ui.mjs', import.meta.url))], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => { out += String(chunk); });
  child.stderr.on('data', chunk => { out += String(chunk); });
  const api = (path, init) => fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { 'x-local-deployer-token': 'test-token-ledger', ...(init && init.headers || {}) }
  });
  try {
    const deadline = Date.now() + 25_000;
    while (!/Local Deployer UI is running/.test(out) && Date.now() < deadline) await new Promise(r => setTimeout(r, 150));
    assert.match(out, /Local Deployer UI is running/, `the deployer must boot on a ledger it did not write:\n${out.slice(-700)}`);

    const listed = await (await api('/api/notifications')).json();
    assert.equal(listed.restored, 1, 'the keys learned before the restart are read back');
    assert.equal(listed.seen, 1, 'and they count toward the dedupe set');
    assert.equal(listed.recent[0].title, 'Scraper4 9.9.9 available', 'the history is there too, so the rail is not blank after an update');
    assert.equal(listed.file, ledger, 'and it says where the ledger lives, since a test or a read-only checkout may move it');

    const scanned = await (await api('/api/notifications/scan', { method: 'POST', body: '{}' })).json();
    assert.deepEqual(scanned.announce.sent, [], 'a scan after a restart re-announces nothing it already knew');
    assert.equal(scanned.announce.ok, true);

    await api('/api/notifications/test', { method: 'POST', body: '{}' });
    const stored = JSON.parse(readFileSync(ledger, 'utf8'));
    assert.ok(stored.seen.includes(announced), 'a later write must not drop the keys it inherited');
    assert.equal(stored.recent[0].reason, 'test', 'the fresh entry goes on top of the same file');
    assert.equal(readFileSync(ledger, 'utf8').includes(announced), true);
    assert.match(out, /\[deployer\] test notification sent via custom/);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 400));
    try { child.kill('SIGKILL'); } catch {}
  }
});
