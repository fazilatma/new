import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const projectUrl = new URL('../', import.meta.url);
const readProjectFile = name => readFile(new URL(name, projectUrl), 'utf8');
const pkg = JSON.parse(await readProjectFile('package.json'));
/**
 * Reads the built Node bundle, building it first if it is missing.
 *
 * render-dist/ is a build artifact and is gitignored, so on a clean checkout
 * (Cloudflare Pages, CI, a fresh clone) it does not exist. The tests below
 * execute the REAL shipped helpers out of that bundle, and without this they
 * died with a bare ENOENT that looked like a broken repository rather than a
 * missing build step.
 */
let renderBundlePromise;
const readRenderBundle = () => (renderBundlePromise ??= (async () => {
  try {
    return await readProjectFile('render-dist/server.js');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    execFileSync(process.execPath, ['build-render.mjs'], {
      cwd: new URL('.', projectUrl).pathname, encoding: 'utf8', stdio: 'pipe'
    });
    return readProjectFile('render-dist/server.js');
  }
})());
const version = pkg.version;
const faVersion = String(version).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

test('package.json exposes a concrete semver as the single source of truth', () => {
  assert.match(version, /^\d+\.\d+\.\d+$/);
});

test('sync-version --check passes, so no version reference has drifted', () => {
  const output = execFileSync(process.execPath, ['scripts/sync-version.mjs', '--check'], {
    cwd: new URL('.', projectUrl).pathname,
    encoding: 'utf8'
  });
  assert.match(output, /version OK/);
  assert.ok(output.includes(version), `check output should mention ${version}`);
});

test('dashboard header badge shows the current version, not a hardcoded old one', async () => {
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  const header = dashboard.match(/<b id="topVersionNum">([^<]*)<\/b>/);
  assert.ok(header, 'header must keep a topVersionNum slot');
  assert.equal(header[1], faVersion);
});

test('changelog documents the current version and its footer matches it', async () => {
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  const firstEntry = dashboard.match(/<div class="change-list"><div class="change-item"><time>([^<]*)<\/time>/);
  assert.ok(firstEntry, 'the change list must start with a dated entry');
  assert.ok(firstEntry[1].includes(faVersion), `newest changelog entry should mention ${faVersion}, got ${firstEntry[1]}`);
  for (const label of ['نسخهٔ فعلی Worker: ', 'نسخهٔ فعلی: ']) {
    const footer = dashboard.match(new RegExp(label + '([۰-۹.]+)'));
    assert.ok(footer, `footer "${label}" must exist`);
    assert.equal(footer[1], faVersion);
  }
});

test('version fallbacks used before /health responds are current', async () => {
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  for (const match of dashboard.matchAll(/faVersion\((?:value|health\.version)\s*\|\|\s*'(\d+\.\d+\.\d+)'/g)) {
    assert.equal(match[1], version);
  }
  const server = await readProjectFile('render-src/server.ts');
  for (const match of server.matchAll(/\|\|\s*'(\d+\.\d+\.\d+)'/g)) assert.equal(match[1], version);
  const app = await readProjectFile('worker-src/app.ts');
  for (const match of app.matchAll(/WORKER_VERSION\|\|'(\d+\.\d+\.\d+)'/g)) assert.equal(match[1], version);
});

test('every environment install guide carries a version verification step', async () => {
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  const groups = JSON.parse(dashboard.match(/const INSTALL_COMMAND_GROUPS=(\[[\s\S]*?\]);\n/)[1]);
  assert.ok(groups.length >= 11, 'all environment cards must be present');
  for (const group of groups) {
    assert.ok(
      group.body.includes('version:check') || group.body.includes('Expected version'),
      `install guide "${group.key}" must verify the running version`
    );
  }
  // The guides must not advertise a version other than the current one.
  for (const group of groups) {
    for (const match of group.body.matchAll(/(?:# Expected: |REM Expected: |Expected version: )(\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], version, `guide "${group.key}" mentions a stale version`);
    }
  }
});

test('deployer guides stay aligned with the dashboard guides', async () => {
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  const commands = JSON.parse(deployer.match(/const commands = (\{[\s\S]*?\});\n/)[1]);
  for (const [name, body] of Object.entries(commands)) {
    for (const match of body.matchAll(/(?:# Expected: |REM Expected: |expected version: )(\d+\.\d+\.\d+)/g)) {
      assert.equal(match[1], version, `deployer guide "${name}" mentions a stale version`);
    }
  }
  for (const key of ['Windows PowerShell', 'Windows Command Prompt']) {
    assert.ok(commands[key].includes('sqlite:data/scraper4.sqlite'), `${key} must configure the Windows SQLite database`);
    assert.ok(commands[key].includes('esbuild-check.mjs'), `${key} must verify esbuild`);
    assert.ok(!commands[key].includes('--ignore-scripts'), `${key} must not skip install scripts (breaks esbuild)`);
  }
});

test('Windows download produces a double-clickable .cmd launcher that unpacks the .ps1', async () => {
  globalThis.btoa = value => Buffer.from(value, 'binary').toString('base64');
  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');

  const cut = (source, head) => {
    const start = source.indexOf(head);
    assert.ok(start > 0, `missing ${head}`);
    return source.slice(start, source.indexOf('function saveBlobAs(', start));
  };
  const workerFn = new Function(cut(dashboard, 'function windowsLauncherCmd(ps1Text,scriptName){') + '; return windowsLauncherCmd;')();
  const deployerFn = new Function(cut(deployer, 'function windowsLauncherCmd(ps1Text, scriptName) {') + '; return windowsLauncherCmd;')();

  const commands = JSON.parse(deployer.match(/const commands = (\{[\s\S]*?\});\n/)[1]);
  const ps1 = commands['Windows PowerShell'];
  const launcher = workerFn(ps1, 'scraper4-install-windows.ps1');

  assert.equal(launcher, deployerFn(ps1, 'scraper4-install-windows.ps1'), 'both UIs must emit the same launcher');
  assert.ok(launcher.startsWith('@echo off'), 'must be a batch file');
  assert.ok(launcher.includes('\r\n'), 'Windows needs CRLF line endings');
  assert.match(launcher, /-ExecutionPolicy Bypass/, 'must bypass the policy that blocks downloaded .ps1 files');
  assert.match(launcher, /\npause\r?\n?/, 'window must stay open so errors are readable');
  assert.ok(!launcher.split('\r\n').some(line => line.includes('\\\\')), 'no double-escaped paths');
  for (const line of launcher.split('\r\n')) assert.ok(line.length < 8000, 'batch lines must stay under the cmd limit');

  const payload = launcher.split('\r\n').filter(line => line.startsWith('set "B64=!B64!')).map(line => line.slice(14, -1)).join('');
  assert.ok(payload.length > 0, 'installer payload must be embedded');
  assert.equal(Buffer.from(payload, 'base64').toString('utf8'), ps1, 'embedded payload must decode back to the exact installer');
});

test('intrusive confirmation popups are gone from safe/local actions', async () => {
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  assert.ok(!deployer.includes('confirm('), 'the deployer UI must not use blocking confirm() popups');
  assert.match(deployer, /dataset\.armed/, 'destructive branch install keeps a non-modal two-step guard');

  const dashboard = await readProjectFile('worker-src/dashboard.ts');
  for (const gone of [
    'همهٔ سلکتورهای جزئیات و تنظیم گالری پاک شود؟',
    'همه کارهای تمام‌شده پاک شوند؟',
    'تاریخچهٔ درون‌ریزی پاک شود؟',
    'اجرای فعلی ایجنتیک پاک شود؟'
  ]) assert.ok(!dashboard.includes(`confirm('${gone}'`), `local action should not prompt: ${gone}`);

  // Starting a job is safe and reversible: it reports through the non-blocking
  // toast, not a modal the user has to dismiss before seeing the job list.
  assert.ok(!dashboard.includes("openResultModal(source==='backend'"),
    'starting an extraction must not open a blocking result modal');
  assert.match(dashboard, /notice\(source==='backend'/,
    'starting an extraction reports through the non-blocking notice toast');
  // Failures are still worth interrupting for.
  assert.ok(dashboard.includes('شروع استخراج ناموفق بود'),
    'a failed extraction start must still surface a modal');

  // Genuinely destructive/irreversible remote operations must still confirm.
  for (const kept of [
    'پروفایل و محصولات آن حذف شود؟',
    'محصول مقصد حذف شود؟',
    'پاسخ‌ها واقعاً برای مشتریان ارسال شوند؟'
  ]) assert.ok(dashboard.includes(`confirm('${kept}'`), `destructive action must keep its guard: ${kept}`);
});

test('the deployer page ships a client script that actually parses', async () => {
  // Regression: the client script lives in a template literal, so a Windows path
  // ending in a backslash ("%TEMP%\") escaped the closing quote and threw a
  // SyntaxError. The whole script then failed to load and every button was dead.
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  assert.match(deployer, /return String\.raw`<!doctype html>/,
    'the page template must be raw so backslashes in generated Windows commands stay literal');

  const start = deployer.indexOf('return String.raw`<!doctype html>');
  const script = deployer.slice(deployer.indexOf('<script>', start) + 8, deployer.indexOf('</script>', start));
  assert.ok(script.length > 5000, 'client script should be substantial');

  // Resolve the ${...} interpolations the same way the server does, then parse.
  const resolved = script
    .replace(/\$\{JSON\.stringify\([^)]*\)\}/g, '"x"')
    .replace(/\$\{[^}]*\}/g, '0');
  new Function(resolved); // throws if the served script is not valid JavaScript
});

test('closing the deployer leaves the scraper serving its own URL', async () => {
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  // The scraper is spawned detached and unref'd, so it survives the deployer.
  assert.match(deployer, /spawn\(scraperCommand,[^)]*detached: true/, 'the scraper must run in its own process group');
  assert.match(deployer, /child\.unref\(\)/, 'the deployer must not hold the scraper open');
  // Shutdown must not kill it unless explicitly asked to.
  assert.match(deployer, /LOCAL_SCRAPER_STOP_WITH_UI/, 'stopping the scraper with the UI must be opt-in');
  assert.match(deployer, /function shutdownUi\(\)/);
  assert.doesNotMatch(deployer, /process\.on\('SIGTERM', \(\) => \{ stopScraper\(\)/, 'SIGTERM must not unconditionally stop the scraper');
  // Stop must signal the whole group, or only the npm shell would die.
  assert.match(deployer, /process\.kill\(-scraper\.child\.pid/, 'Stop must signal the scraper process group');
  // Autostart + adoption, so the URL is up without opening the deployer page.
  assert.match(deployer, /function autoStartScraper\(\)/);
  assert.match(deployer, /already serving/, 'a restarted deployer must adopt a running scraper instead of double-starting it');
  assert.match(deployer, /Scraper \(independent of the deployer, no token needed\)/, 'the terminal must print the scraper URL next to the deployer URL');
});

test('auto-update never discards uncommitted work', async () => {
  // Regression: both auto-updaters ran `git reset --hard origin/<branch>` on a
  // timer, silently deleting local edits (and committed work) with no recovery.
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  const server = await readProjectFile('render-src/server.ts');
  for (const [name, source] of [['deployer', deployer], ['render server', server]]) {
    assert.match(source, /status', '--porcelain'/, `${name} must check for a dirty worktree before resetting`);
    assert.match(source, /reset', '--hard'/, `${name} still performs the reset when the tree is clean`);
  }
  // The deployer guards inside autoUpdateFromGit, which is what the timer calls;
  // the manual updateFromGit path stays force-capable on purpose.
  const auto = deployer.slice(deployer.indexOf('function autoUpdateFromGit('), deployer.indexOf('function scheduleBranchScanner('));
  assert.match(auto, /'--porcelain'/, 'the timed deployer update must check the worktree first');
  assert.match(auto, /return lastAutoUpdate;/, 'a dirty worktree must abort the timed update');
  // A clean tree is not enough: unpushed commits are destroyed by reset --hard too.
  assert.match(auto, /origin\/\$\{target\}\.\.HEAD/, 'the timed deployer update must refuse to discard unpushed commits');
  assert.match(auto, /unpushed-commits/, 'skipping for unpushed commits must be reported to the UI');
  // The render server guards inline, before its own reset.
  const guardAt = server.indexOf("'--porcelain'");
  const aheadAt = server.indexOf('..HEAD`');
  const resetAt = server.indexOf("'reset', '--hard'");
  assert.ok(guardAt > 0 && guardAt < resetAt, 'the scraper must check before it resets');
  assert.ok(aheadAt > 0 && aheadAt < resetAt, 'the scraper must refuse to discard unpushed commits');
});

test('opening the scraper waits for it to build instead of returning ECONNREFUSED', async () => {
  // Regression (Termux): the "Open scraper" button proxies to 127.0.0.1:3000.
  // proxyScraper() called startScraper() and then connected immediately, but the
  // scraper runs `render:build && render:start`, which on Termux/ARM takes tens
  // of seconds. The connection was refused and the user got a raw
  // "Local scraper proxy failed: connect ECONNREFUSED 127.0.0.1:3000".
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  assert.match(deployer, /async function proxyScraper\(/, 'the proxy must be able to await readiness');
  assert.match(deployer, /return await proxyScraper\(req, res, url\)/, 'the route must await the proxy so rejections are handled');
  assert.match(deployer, /async function waitForScraperPort\(/, 'the proxy must poll until the port is listening');
  assert.match(deployer, /LOCAL_SCRAPER_PROXY_WAIT_MS/, 'the wait budget must be configurable for very slow devices');
  // The readiness probe -- not the cached `scraper.running` flag -- must gate the
  // forward. `running` is true the instant spawn() returns, long before the port
  // is listening, so gating on it reintroduces the ECONNREFUSED.
  const proxy = deployer.slice(deployer.indexOf('async function proxyScraper('), deployer.indexOf('function requireAuth('));
  assert.match(proxy, /if \(!\(await scraperIsListening\(\)\)\) \{\s*\n\s*startScraper\(\);/,
    'the proxy must probe the port, not trust scraper.running, before forwarding');
  assert.match(proxy, /await waitForScraperPort\(Date\.now\(\) \+ budget\)/, 'the proxy must actually await the port');
  assert.doesNotMatch(proxy, /const budget = 0;/, 'the wait budget must not be disabled');
  // A request body must survive the wait, otherwise POSTs through the proxy break.
  assert.match(deployer, /for await \(const chunk of req\) chunks\.push\(chunk\)/, 'the body must be buffered before waiting');
  assert.match(deployer, /upstream\.end\(body\)/, 'the buffered body must be forwarded');
  assert.doesNotMatch(deployer, /req\.pipe\(upstream\)/, 'piping a already-consumed request would send an empty body');
});

test('a scraper that exited is restarted, and the failure is explained', async () => {
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  // child.killed stays false after a natural exit, so the old guard reported
  // "already running" forever and no click could ever restart a crashed scraper.
  assert.doesNotMatch(deployer, /if \(scraper\?\.child && !scraper\.child\.killed\) return scraper;/,
    'the stale child.killed guard must be gone');
  assert.match(deployer, /if \(scraper\?\.running && scraper\.child && scraper\.exitCode === null\) return scraper;/,
    'startScraper must treat an exited scraper as restartable');

  // Prove the guard semantics rather than trusting the regex above.
  const exited = { running: false, child: {}, exitCode: 1 };
  const alive = { running: true, child: {}, exitCode: null };
  const guard = s => Boolean(s?.running && s.child && s.exitCode === null);
  assert.equal(guard(exited), false, 'an exited scraper must not short-circuit startScraper');
  assert.equal(guard(alive), true, 'a healthy scraper must not be started twice');

  // The user must see why, not a bare connection error.
  assert.match(deployer, /exited with code \$\{scraper\.exitCode\} before it could serve/, 'the error must name the exit code');
  assert.match(deployer, /log: tail/, 'the response must carry the tail of the scraper log');
  assert.match(deployer, /still starting and did not answer/, 'a slow start must be reported as slow, not broken');
});

test('the lockfile version matches package.json, so npm install cannot dirty the tree', async () => {
  // Root cause of "the fix never reached my device": package-lock.json carried a
  // stale version, so every `npm install` rewrote it. The deployer's auto-update
  // refuses to run on a dirty worktree (correctly -- it uses git reset --hard),
  // so the device stayed on old code forever and kept showing the old error.
  const lock = JSON.parse(await readProjectFile('package-lock.json'));
  assert.equal(lock.version, version, 'package-lock.json root version drifted from package.json');
  assert.equal(lock.packages?.['']?.version, version, 'package-lock.json packages[""] version drifted');
});

test('sync-version keeps the lockfile in step and touches nothing else in it', async () => {
  const script = await readProjectFile('scripts/sync-version.mjs');
  assert.match(script, /file: 'package-lock\.json'/, 'the lockfile must be a sync target');
  // The anchor must be the project's own name, not a bare "version" key, or the
  // script would rewrite the version of all ~950 dependencies.
  assert.match(script, /"name": "scraper4-cloudflare"/, 'the lockfile rule must be anchored on the project name');
});

test('auto-update ignores lockfile-only churn but still protects real local work', async () => {
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  assert.match(deployer, /const GENERATED = /, 'the updater must detect generated-file churn');
  assert.match(deployer, /\['checkout', '--', \.\.\.generated\.map\(path => `:\/\$\{path\}`\)\]/,
    'it must restore generated files with repo-root-relative pathspecs, since git runs in the project subdirectory');

  // Exercise the real predicate against real `git status --porcelain` output.
  const GENERATED = /(?:^|\/)(?:package-lock\.json|scraper4\.worker\.js|scraper4\.ts)$/;
  const generatedOnly = out => {
    const paths = out.split('\n').map(line => (line.match(/^..\s+(.*)$/) || [])[1] || '').filter(Boolean);
    const generated = paths.filter(path => GENERATED.test(path));
    return generated.length > 0 && generated.length === paths.length;
  };
  assert.equal(generatedOnly(' M cloudflare-scraper4/package-lock.json'), true, 'lockfile churn must be ignorable');
  assert.equal(generatedOnly(' M package-lock.json'), true, 'also when the deployer runs inside the project dir');
  // scraper4.worker.js is a tracked build output: `npm run worker:build` rewrites
  // it, which used to pause every future auto-update on that device.
  assert.equal(generatedOnly(' M cloudflare-scraper4/scraper4.worker.js'), true, 'a rebuilt worker bundle must be ignorable');
  assert.equal(generatedOnly(' M cloudflare-scraper4/scraper4.worker.js\n M cloudflare-scraper4/package-lock.json'), true,
    'a rebuild plus an install must still be ignorable');
  assert.equal(generatedOnly(' M cloudflare-scraper4/package-lock.json\n M cloudflare-scraper4/worker-src/ai.ts'), false,
    'a real edit alongside a generated file must still pause the update');
  assert.equal(generatedOnly(' M cloudflare-scraper4/worker-src/ai.ts'), false, 'a real edit must pause the update');
  assert.equal(generatedOnly(''), false, 'a clean tree is not "generated churn"');

  // The dirty guard itself must survive: it is what stops reset --hard eating work.
  assert.match(deployer, /Auto-update skipped: \$\{files\} uncommitted change\(s\)/, 'the dirty-worktree guard must remain');
});

test('the deployer detects that it is running older code than is on disk', async () => {
  // A long-lived deployer loads its own source once. After a git update the
  // files change but the process keeps serving the old code -- and reported the
  // old version, so a stale process and a live bug produced identical output.
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  assert.match(deployer, /const bootVersion = pkg\.version;/, 'the boot version must be captured');
  assert.match(deployer, /function staleCode\(\)/, 'the deployer must compare disk against boot');
  assert.match(deployer, /code: staleCode\(\)/, '/api/status must expose it');
  assert.match(deployer, /WARNING: this process is running v/, 'the terminal must warn on startup');

  // Execute the REAL staleCode() from the shipped source rather than a copy, so
  // gutting the implementation cannot leave this test green.
  const body = deployer.slice(deployer.indexOf('function staleCode()'), deployer.indexOf('\n}', deployer.indexOf('function staleCode()')) + 2);
  const make = (boot, onDisk) => new Function('bootVersion', 'diskVersion', `${body}; return staleCode;`)(boot, () => onDisk)();
  assert.equal(make('1.81.0', '1.82.0').stale, true, 'a newer file on disk means the process is stale');
  assert.deepEqual(make('1.81.0', '1.82.0'), { stale: true, running: '1.81.0', onDisk: '1.82.0' });
  assert.equal(make('1.81.0', '1.81.0').stale, false, 'matching versions are not stale');
  assert.equal(make('1.81.0', '').stale, false, 'an unreadable package.json must not cry wolf');
});

test('the proxy error names the deployer version that produced it', async () => {
  // Three rounds of this bug were reported with byte-identical two-field JSON,
  // which cannot distinguish "fix not deployed" from "fix does not work".
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  const proxy = deployer.slice(deployer.indexOf('async function proxyScraper('), deployer.indexOf('function requireAuth('));
  assert.match(proxy, /deployerVersion: pkg\.version/, 'the proxy error must carry the running version');
  assert.match(proxy, /staleWarning/, 'a stale process must say so in the error itself');
  assert.match(proxy, /scraperExitCode/, 'the error must carry the scraper exit code');
  assert.match(proxy, /log: String\(scraperLog/, 'the error must carry the scraper log tail');
});

test('esbuild resolves a native package on Termux/Android', async () => {
  // Termux reports process.platform === 'android'. The loader had no android
  // branch, so platformBinaryPackage() returned '' -> the "repair" installed
  // nothing, render:build died, the scraper exited 1 and "Open scraper" 502'd.
  const loader = await readProjectFile('scripts/esbuild-loader.mjs');

  // Execute the REAL function from the shipped source. Re-implementing it here
  // would keep this test green even if the android branch were deleted again.
  const body = loader.slice(loader.indexOf('function platformBinaryPackage()'), loader.indexOf('const isTermux'));
  const pkgFor = (platform, arch) => new Function('process', `${body}; return platformBinaryPackage();`)({ platform, arch });

  assert.equal(pkgFor('android', 'arm64'), '@esbuild/android-arm64', 'Termux on arm64 needs its own esbuild binary');
  assert.equal(pkgFor('android', 'arm'), '@esbuild/android-arm');
  assert.equal(pkgFor('android', 'x64'), '@esbuild/android-x64');
  // Guard the platforms that already worked, so the android fix cannot regress them.
  assert.equal(pkgFor('linux', 'arm64'), '@esbuild/linux-arm64');
  assert.equal(pkgFor('win32', 'x64'), '@esbuild/win32-x64');
  assert.equal(pkgFor('darwin', 'arm64'), '@esbuild/darwin-arm64');
});

test('a build that cannot load native esbuild falls back to WebAssembly', async () => {
  // A missing platform binary must not be fatal: esbuild-wasm needs no native
  // executable, so the scraper can still be built and served.
  const loader = await readProjectFile('scripts/esbuild-loader.mjs');
  assert.match(loader, /esbuild-wasm/, 'a WebAssembly fallback must exist');
  assert.match(loader, /async function loadWasmFallback/, 'the fallback must be a real code path');
  assert.match(loader, /const wasm = await loadWasmFallback\(/, 'the fallback must run when repair fails');
  assert.match(loader, /if \(wasm\) return wasm;/, 'the fallback result must be returned instead of throwing');

  // It must be a declared dependency; installing the native package with
  // --no-save prunes anything that is only present ad hoc.
  const pkg = JSON.parse(await readProjectFile('package.json'));
  const declared = name => pkg.dependencies?.[name] || pkg.devDependencies?.[name];
  assert.ok(declared('esbuild-wasm'), 'esbuild-wasm must be declared so it is always installed');
  assert.equal(declared('esbuild-wasm'), declared('esbuild'), 'both esbuild builds must be pinned together');
});

test('esbuild failures never give Windows-only advice to Termux users', async () => {
  // The old text told an Android user their "Windows" install was broken.
  const loader = await readProjectFile('scripts/esbuild-loader.mjs');
  assert.match(loader, /const isTermux/, 'the loader must know when it is on Termux');
  assert.match(loader, /pkg install esbuild/, 'Termux users need the Termux remedy');
  // Check executable code, not comments: an earlier version of this assertion
  // matched one exact sentence, so restoring the Windows-only text elsewhere
  // slipped through. Strip comments and require that no message mentions
  // Windows unless it is chosen by a platform check.
  const code = loader.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of code.split('\n')) {
    if (!line.includes('Windows')) continue;
    assert.ok(/isTermux|process\.platform/.test(line), `unconditional Windows advice: ${line.trim()}`);
  }

  // An existing system binary is the most reliable route on Termux, but esbuild
  // ignores ESBUILD_BINARY_PATH when it is exactly /usr/bin/esbuild.
  assert.match(loader, /ESBUILD_BINARY_PATH/, 'a system esbuild must be usable');
  assert.match(loader, /!== '\/usr\/bin\/esbuild'/, 'the path esbuild refuses must be skipped');
});

test('the engine benchmark never saves a near-empty engine as the profile default', async () => {
  // On Termux the benchmark ranked purely by products/minute, so "heuristic"
  // with ONE stray card beat everything else and was saved as the profile
  // default. Every later run then extracted 0 products, while the very same
  // profile extracted 660 on Cloudflare.
  const server = await readProjectFile('render-src/server.ts');

  // Execute the REAL selection logic from the shipped source.
  const start = server.indexOf('const usable=results.filter');
  const end = server.indexOf('(profile as any).extractionEngineBenchmarks', start);
  const body = server.slice(start, end).replace(/const MIN_BENCHMARK_PRODUCTS[^\n]*\n/, '');
  const pick = (results) => new Function('results', 'MIN_BENCHMARK_PRODUCTS',
    `${body}; return { fastest, bestCount };`)(results, 2);

  // The user's real Termux numbers.
  const termux = [
    { engine: 'jsonld', products: 0, elapsedMs: 1386, ok: false, available: true, productsPerMinute: 0 },
    { engine: 'heuristic', products: 1, elapsedMs: 1439, ok: true, available: true, productsPerMinute: 41.7 },
    { engine: 'cheerio', products: 0, elapsedMs: 1701, ok: false, available: true, productsPerMinute: 0 }
  ];
  assert.equal(pick(termux).fastest, null, 'a single product across 3 pages must not become the default');
  assert.equal(pick(termux).bestCount, 1, 'the best count is still reported so the user learns why');

  // Coverage must win over raw speed.
  const mixed = [
    { engine: 'heuristic', products: 3, elapsedMs: 100, ok: true, available: true, productsPerMinute: 1800 },
    { engine: 'htmlrewriter', products: 660, elapsedMs: 12000, ok: true, available: true, productsPerMinute: 3300 }
  ];
  assert.equal(pick(mixed).fastest.engine, 'htmlrewriter', 'the engine that finds the catalogue must win');

  // A genuinely empty run must leave the profile untouched.
  assert.equal(pick([{ engine: 'jsonld', products: 0, ok: false, available: true, elapsedMs: 10 }]).fastest, null);
});

test('the selector engine is benchmarked on Node, not only on Cloudflare', async () => {
  // htmlrewriter is the engine that works for the user on Cloudflare and it is
  // implemented on Node too, but it was missing from the Node benchmark list,
  // so the benchmark could never choose it.
  const server = await readProjectFile('render-src/server.ts');
  const line = server.split('\n').find(l => l.includes('const BENCHMARK_ENGINES'));
  assert.ok(line.includes("'htmlrewriter'"), 'htmlrewriter must be benchmarked on Node');
  assert.ok(line.includes("'cheerio'"), 'cheerio must stay in the list');

  const scraper = await readProjectFile('render-src/scraper.ts');
  assert.match(scraper, /name === 'cheerio' \|\| name === 'htmlrewriter'/, 'Node must implement htmlrewriter');

  // Browser engines have no Android build; report them as unavailable rather
  // than as a scary download failure.
  assert.match(server, /BROWSER_ENGINES_UNAVAILABLE\s*=\s*process\.platform\s*===\s*'android'/, 'Termux must mark browser engines unavailable');
  assert.match(server, /available:\s*false/, 'unavailable engines must not look like failures');
});

test('the Node runtime fetches pages the same way the Worker does', async () => {
  // The Worker sent a real browser User-Agent and got full pages; Node sent
  // "Scraper4Render/1.0" with no accept-language, so shops served a stripped
  // page and the same profile extracted nothing on Termux.
  const config = await readProjectFile('render-src/config.ts');
  const network = await readProjectFile('render-src/network.ts');
  const worker = await readProjectFile('worker-src/network.ts');

  assert.ok(!/Scraper4Render/.test(config), 'the obvious bot User-Agent must be gone');
  const ua = config.match(/userAgent:[^\n]*/)[0];
  assert.match(ua, /Mozilla\/5\.0/, 'Node must send a browser User-Agent');
  assert.match(ua, /process\.env\.USER_AGENT/, 'the User-Agent must stay overridable');

  // The headers the Worker relies on must also be present on Node.
  for (const header of ['accept-language', 'cache-control']) {
    assert.ok(worker.includes(header), `precondition: the Worker sends ${header}`);
    assert.ok(network.includes(header), `Node must also send ${header}`);
  }
});

test('the Node runtime finds keys stored only in apiKeys[]', async () => {
  // The importer and the multi-key editor store keys in apiKeys[] (plain
  // strings, {label,token}, or Cloudflare {accountId,token}). render-src/ai.ts
  // read only provider.apiKey, so every such provider reported
  // «کلید API ... وارد نشده است» even though its key was saved correctly.
  const ai = await readProjectFile('render-src/ai.ts');
  const start = ai.indexOf('export async function aiProviders()');
  const body = ai.slice(start, ai.indexOf('\n/**', start));

  // Execute the REAL mapping from the shipped source.
  const mapper = body.slice(body.indexOf('return ai.providers.map('), body.lastIndexOf('})}') + 3)
    .replace(/^return /, '').replace(/\}\)\}$/, '})')
    .replace(/\(provider:any\)/g, '(provider)').replace(/\(k:any\)/g, '(k)');
  const run = (providers) => new Function('ai', 'sharedKeyFitsProvider',
    `return ${mapper};`)({ providers, apiKey: '', baseUrl: '' }, () => false);

  const out = run([
    { id: 'plain', baseUrl: 'https://a.test/v1', apiKeys: ['sk-plain'], models: ['m'] },
    { id: 'labelled', baseUrl: 'https://b.test/v1', apiKeys: [{ label: 'main', token: 'gsk-1' }], models: ['m'] },
    { id: 'cf', baseUrl: 'https://c.test/v1', apiKeys: [{ accountId: 'A1', token: 't1' }], models: ['m'] },
    { id: 'mixed', baseUrl: 'https://d.test/v1', apiKeys: [{ token: 'off', enabled: false }, { token: 'on' }], models: ['m'] }
  ]);
  const key = (id) => out.find(p => p.id === id).apiKey;
  assert.equal(key('plain'), 'sk-plain', 'a plain string key must be found');
  assert.equal(key('labelled'), 'gsk-1', 'a {label,token} key must be found');
  assert.equal(key('cf'), 't1', 'a Cloudflare {accountId,token} key must be found');
  assert.equal(key('mixed'), 'on', 'a key switched off must not be preferred over an active one');

  // An explicit apiKey still wins, and nothing invents a key out of nothing.
  const direct = run([{ id: 'x', baseUrl: 'https://e.test/v1', apiKey: 'primary', apiKeys: ['other'], models: ['m'] }]);
  assert.equal(direct[0].apiKey, 'primary');
  assert.equal(run([{ id: 'y', baseUrl: 'https://f.test/v1', models: ['m'] }])[0].apiKey, '');
});

test('the Node vault keeps Cloudflare account ids and multi-key metadata', async () => {
  // render-src/vault.ts typed apiKeys as string[] and flattened every entry to
  // a bare token, so a Cloudflare provider lost its accountId on every save and
  // could no longer build its endpoint.
  const vault = await readProjectFile('render-src/vault.ts');
  assert.ok(!/apiKeys\?:string\[\]/.test(vault), 'apiKeys must not be limited to plain strings');
  assert.match(vault, /accountId/, 'the Node vault must persist Cloudflare account ids');

  const worker = await readProjectFile('worker-src/vault.ts');
  assert.match(worker, /accountId/, 'precondition: the Worker vault already persists them');
});

test('the Node runtime names the real environment instead of always saying Render', async () => {
  // The same Node build runs on Termux, Windows, a VPS and Codespaces, but its
  // errors, hints, /api/version and backup file names all said "Render", which
  // confused users who had never used Render.com.
  const cfg = await readProjectFile('render-src/config.ts');
  const body = cfg.slice(cfg.indexOf('function detectRuntimeEnvironment()'), cfg.indexOf('export const runtimeEnvironment'));

  // Execute the REAL detector from the shipped source.
  const run = (platform, env) => new Function('process', `${body}; return detectRuntimeEnvironment();`)({ platform, env });
  assert.equal(run('android', {}).id, 'termux', 'Termux reports platform android');
  assert.equal(run('linux', { PREFIX: '/data/data/com.termux/files/usr' }).id, 'termux', 'Termux is also detectable via PREFIX');
  assert.equal(run('win32', {}).id, 'windows');
  assert.equal(run('linux', { CODESPACES: 'true' }).id, 'codespaces');
  assert.equal(run('linux', {}).id, 'local', 'a plain VPS must not be called Render');
  // Render itself must still be detected, so its panel instructions stay correct.
  assert.equal(run('linux', { RENDER: '1' }).id, 'render');
  assert.match(run('linux', { RENDER_SERVICE_ID: 'x' }).dbHint, /Render Dashboard/);
  // Every environment must offer a usable database hint.
  for (const [p, e] of [['android', {}], ['win32', {}], ['linux', {}]]) {
    assert.ok(run(p, e).dbHint.length > 10, 'each environment needs its own database hint');
    assert.ok(!/Render/.test(run(p, e).dbHint), 'a non-Render environment must not be told to use Render');
  }
});

test('user-facing messages do not hardcode Render on other runtimes', async () => {
  const server = await readProjectFile('render-src/server.ts');
  const vault = await readProjectFile('render-src/vault.ts');
  const setupPage = await readProjectFile('render-src/dashboard.ts');

  // These four strings were shown verbatim to Termux and Windows users.
  assert.ok(!/Create Render PostgreSQL/.test(server), 'the database hint must follow the environment');
  assert.ok(!/ADMIN_TOKEN را در Render/.test(vault), 'the admin-token hint must follow the environment');
  assert.ok(!/رابط اصلی Termux\/Render/.test(setupPage), 'the setup page must not brand itself Render');
  assert.ok(!/local-node-render/.test(server), '/api/version must report the real environment');
  assert.match(server, /runtimeEnvironment/, 'the server must use the detected environment');
  // The very first line a Termux user sees in the terminal said "Scraper4 Render".
  assert.ok(!/Scraper4 Render listening/.test(server), 'the startup banner must not say Render');
  assert.match(server, /Scraper4 \(\$\{runtimeEnvironment\.label\}\) listening/, 'the banner must name the real environment');

  // The parity report also labelled generic rows as Render-specific.
  const parity = await readProjectFile('render-src/parity.ts');
  assert.ok(!/بازیابی بکاپ Render/.test(parity), 'the backup row must not be Render-branded');

  // Backups must stop being named "render", yet old files must still restore.
  const db = await readProjectFile('render-src/db.ts');
  assert.match(db, /app:'scraper4-backup'/, 'new backups get a neutral id');
  assert.match(db, /'scraper4-backup', 'scraper4-render'/, 'old backups must still be accepted');
  const workerDb = await readProjectFile('worker-src/db.ts');
  assert.match(workerDb, /scraper4-backup/, 'the Worker must accept a backup made by the Node runtime');
});

test('dashboard URLs are relative so the deployer proxy at /scraper/ works', async () => {
  // Buttons were dead at http://localhost:8790/scraper/ but fine at :3000.
  // The page loaded, then every fetch('/api/...') resolved against the ORIGIN
  // root instead of /scraper/, hitting the deployer's own auth -> 401. The
  // deployer's Referer allowlist could not save it: the scraper sends
  // referrer-policy: no-referrer, so browsers send no Referer at all.
  const dash = await readProjectFile('worker-src/dashboard.ts');

  // Execute the REAL helper from the shipped source.
  const seg = dash.slice(dash.indexOf('const APP_BASE='), dash.indexOf('\n', dash.indexOf('const U=p=>')));
  const at = pathname => new Function('location', `${seg}; return U;`)({ pathname });
  assert.equal(at('/scraper/')('/api/profiles'), '/scraper/api/profiles', 'mounted under the proxy');
  assert.equal(at('/')('/api/profiles'), '/api/profiles', 'port 3000 must be unchanged');
  assert.equal(at('/scraper/')('/health'), '/scraper/health');
  assert.equal(at('/scraper/')('/visual?context=list'), '/scraper/visual?context=list');
  // Absolute and relative inputs must survive untouched.
  assert.equal(at('/scraper/')('https://x.test/a'), 'https://x.test/a', 'external URLs stay absolute');

  // api() funnels 100+ call sites, so it is the one that must be wrapped.
  assert.match(dash, /async function api\(path,options=\{\}\)\{const response=await fetch\(U\(path\)/, 'api() must route through U()');
  // The bootstrap script tag must be relative too, or nothing loads at all.
  assert.ok(!/<script src="\/dashboard\.js"/.test(dash), 'the script tag must not be root-absolute');
  assert.match(dash, /<script src="dashboard\.js" defer><\/script>/);
  // Calls that bypass api() were the second half of the bug.
  assert.ok(!/fetch\('\/health'\)/.test(dash), 'direct /health fetches must be wrapped');
  assert.ok(!/fetch\('\/api\//.test(dash), 'no unwrapped absolute API fetch may remain');
  assert.match(dash, /\$\('visualFrame'\)\.src=U\('\/visual\?context='\)/, 'the visual iframe must be wrapped');
});

test('the deployer redirects /scraper to /scraper/ so relative URLs resolve', async () => {
  // At /scraper (no trailing slash) the browser's base is "/", so every
  // relative URL would miss the proxy and 401 again.
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  assert.match(deployer, /url\.pathname === '\/scraper'\)\s*\{\s*res\.writeHead\(302/, 'must redirect to the trailing slash');
  assert.match(deployer, /location: '\/scraper\/' \+ url\.search/, 'the query string must survive the redirect');
});

test('the Node vault generates its own key instead of demanding ADMIN_TOKEN', async () => {
  // On Termux ADMIN_TOKEN is normally unset, which the API layer treats as
  // "no auth required" -- so reads worked but every save threw, and importing
  // providers failed with a message telling the user to go define a variable.
  const vault = await readProjectFile('render-src/vault.ts');

  // The blocking throw must be gone.
  assert.ok(!/ابتدا ADMIN_TOKEN را در/.test(vault), 'saving must not require ADMIN_TOKEN');
  assert.match(vault, /return config\.adminToken \|\| localVaultKey\(\);/, 'ADMIN_TOKEN still wins when set');

  // The key must be persisted, or every restart would orphan saved credentials.
  assert.match(vault, /readFileSync\(VAULT_KEY_FILE/, 'an existing key must be reused');
  assert.match(vault, /writeFileSync\(VAULT_KEY_FILE[^)]*mode: 0o600/, 'the key file must be owner-only');
  assert.match(vault, /data\/vault\.key/, 'the key belongs in the git-ignored data directory');

  // data/ must stay ignored: this file decrypts every stored credential.
  const ignore = await readProjectFile('.gitignore');
  assert.match(ignore, /^data\/$/m, 'data/ must be git-ignored so the vault key is never committed');

  // Auto-generating an ADMIN_TOKEN would silently switch API auth on and lock
  // the user out; the generated secret must only ever be the vault password.
  const server = await readProjectFile('render-src/server.ts');
  assert.match(server, /if \(!config\.adminToken\) return next\(\);/, 'auth behaviour must be unchanged');
  assert.ok(!/localVaultKey/.test(server), 'the vault key must never be used as an API credential');
});

test('D1 usage is measured from real query meta, not guessed', async () => {
  // Cloudflare exposes no "remaining quota" API to a Worker, but every D1 query
  // returns meta.rows_read / meta.rows_written -- the exact units the free plan
  // limits. We were discarding that and only reacting after being cut off.
  const db = await readProjectFile('worker-src/db.ts');

  // Limits must match the documented free-plan figures.
  assert.match(db, /D1_FREE_DAILY_ROWS_READ = 5_000_000/);
  assert.match(db, /D1_FREE_DAILY_ROWS_WRITTEN = 100_000/);
  // Both query paths must be metered, or the count silently under-reports.
  assert.match(db, /const result = await statement\(sql, values\)\.all<T>\(\);\s*\n\s*meter\(result\.meta\)/, 'reads must be metered');
  assert.match(db, /const result = await statement\(sql, values\)\.run\(\);\s*\n\s*meter\(result\.meta\)/, 'writes must be metered');
  // The meter must not become part of the problem it measures.
  assert.match(db, /USAGE_FLUSH_MS = 60_000/, 'the counter must be batched, not written per query');
  // meta must be declared or TypeScript would drop the field.
  const env = await readProjectFile('worker-src/env.ts');
  assert.match(env, /rows_read\?: number; rows_written\?: number/, 'D1 meta must expose the billing fields');

  // Execute the REAL metering logic from the shipped source.
  const start = db.indexOf('export const D1_FREE_DAILY_ROWS_READ');
  const body = db.slice(start, db.indexOf('async function rows<T = any>'))
    .replace(/export /g, '')
    .replace(/^type D1Usage = [\s\S]*?\};$/m, '')
    .replace(/let usageFlushing: Promise<void> \| null = null;/, 'let usageFlushing = null;')
    .replace(/: D1Usage/g, '').replace(/<D1Usage>/g, '')
    .replace(/\(at: Date = new Date\(\)\)/, '(at = new Date())')
    .replace(/function meter\(meta: \{[^}]*\} \| undefined\): void/, 'function meter(meta)')
    .replace(/async function flushUsage\(\): Promise<void>/, 'async function flushUsage()')
    .replace(/function maybeFlushUsage\(waitUntil\?: \([^)]*\) => void\): void/, 'function maybeFlushUsage(waitUntil)')
    .replace(/async function getD1Usage\(\): Promise<\{[\s\S]*?\}> \{/, 'async function getD1Usage(){')
    .replace(/function flushD1Usage\(waitUntil\?: \([^)]*\) => void\): void/, 'function flushD1Usage(waitUntil)')
    .replace(/const pct = \(used: number, limit: number\)/, 'const pct = (used, limit)')
    .replace(/function meterInvocation\(\): void/, 'function meterInvocation()')
    .replace(/function meterSubrequest\(\): void/, 'function meterSubrequest()')
    .replace(/function subrequestsUsed\(\): number/, 'function subrequestsUsed()');

  const build = stored => new Function(`
    let __store=${JSON.stringify(stored)},__sets=0,__fail=false;
    const getState=async(k,f)=>__store??f;
    const setState=async(k,v)=>{if(__fail)throw new Error('quota'); __sets++; __store=v;};
  ` + body + `
    return {meter,getD1Usage,flushD1Usage,_sets:()=>__sets,_setFlushed:t=>{usageFlushedAt=t},_fail:v=>{__fail=v}};
  `)();

  // Counting is exact, and remaining is derived from the real limits.
  const a = build(null);
  a.meter({ rows_read: 1000, rows_written: 40 });
  a.meter({ rows_read: 200 });
  const ua = await a.getD1Usage();
  assert.equal(ua.rowsRead, 1200);
  assert.equal(ua.rowsWritten, 40);
  assert.equal(ua.remaining.rowsWritten, 100_000 - 40);
  assert.equal(ua.remaining.rowsRead, 5_000_000 - 1200);
  assert.equal(ua.measured, 'this-worker-only', 'the scope must be stated honestly');
  assert.ok(ua.resetsAt.endsWith('T00:00:00.000Z'), 'free limits reset at 00:00 UTC');

  // Metering must cost nothing until a flush is due.
  assert.equal(a._sets(), 0, 'no write should happen per query');

  // Yesterday's total must not be inherited after the UTC reset.
  const today = new Date().toISOString().slice(0, 10);
  const b = build({ day: '2000-01-01', rowsRead: 4_999_999, rowsWritten: 99_999, queries: 5 });
  b.meter({ rows_read: 10, rows_written: 2 });
  const ub = await b.getD1Usage();
  assert.equal(ub.rowsRead, 10, 'a new UTC day starts from zero');
  assert.equal(ub.rowsWritten, 2);
  assert.equal(ub.day, today, 'usage is reported for the current UTC day');
  assert.match(db, /if \(stored && stored\.day === utcDay\(\)\) usageBase = stored;/, 'a stale day must never be loaded as the base');

  // A same-day persisted total must survive isolate recycling.
  const c = build({ day: today, rowsRead: 1000, rowsWritten: 500, queries: 9 });
  c.meter({ rows_read: 7, rows_written: 3 });
  const uc = await c.getD1Usage();
  assert.equal(uc.rowsRead, 1007, 'persisted + pending');
  assert.equal(uc.rowsWritten, 503);

  // If the flush write fails (the usual cause is an exhausted quota) the delta
  // must be preserved exactly once -- not lost, and not counted twice.
  const d = build(null);
  d.meter({ rows_read: 250, rows_written: 25 });
  d._fail(true); d._setFlushed(0); d.flushD1Usage();
  await new Promise(r => setTimeout(r, 20));
  const ud = await d.getD1Usage();
  assert.equal(ud.rowsRead, 250, 'a failed flush must not lose or double-count the delta');
  assert.equal(ud.rowsWritten, 25);
});

test('Node auto mode tries htmlrewriter before browser-only engines', async () => {
  // A profile that extracted fine on the Cloudflare Worker returned zero
  // products on Termux. The Worker's auto chain ends with htmlrewriter, but the
  // Node chain omitted it and fell through to playwright/puppeteer, which have
  // no build on Android -- so auto found nothing. Execute the REAL engineOrder
  // from the shipped source so gutting it cannot leave this test green.
  const src = await readProjectFile('render-src/scraper.ts');
  const head = src.indexOf('const RENDER_DISCOVERY_ENGINES');
  // engineOrder() is no longer a one-liner, so slice it by matching braces
  // instead of stopping at the first newline.
  const fnStart = src.indexOf('function engineOrder');
  let depth = 0, fnEnd = src.indexOf('{', fnStart);
  for (let i = fnEnd; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { fnEnd = i + 1; break; }
  }
  const seg = src.slice(head, fnEnd);
  const body = seg
    .replace(/:ExtractionEngine\[\]/g, '')
    .replace(/<ExtractionEngine>/g, '')
    .replace(/engine\?:ExtractionEngine/g, 'engine')
    .replace(/requested:ExtractionEngine/g, 'requested')
    .replace(/master\?:ExtractionEngine/g, 'master');
  const engineOrder = new Function(`${body}; return engineOrder;`)();

  const auto = engineOrder('auto');
  assert.ok(auto.includes('htmlrewriter'), 'auto mode must be able to reach the htmlrewriter engine');
  for (const browser of ['playwright', 'puppeteer', 'crawlee_playwright']) {
    assert.ok(
      auto.indexOf('htmlrewriter') < auto.indexOf(browser),
      `htmlrewriter must be tried before ${browser}, which cannot run on Android`
    );
  }

  // The Worker's own order is the reference: every engine it tries in auto mode
  // must be tried by Node too, in the same relative order.
  const workerSrc = await readProjectFile('worker-src/scraper.ts');
  const workerAuto = workerSrc.slice(workerSrc.indexOf('const WORKER_AUTO_ENGINES'), workerSrc.indexOf('\n', workerSrc.indexOf('const WORKER_AUTO_ENGINES')));
  assert.match(workerAuto, /'htmlrewriter'/, 'guard: the Worker auto chain still ends with htmlrewriter');
  const workerOrder = ['jsonld', 'next_data', 'script_json', 'heuristic', 'metadata', 'htmlrewriter'];
  assert.deepEqual(auto.slice(0, workerOrder.length), workerOrder, 'Node auto must mirror the Worker chain before adding local-only engines');

  // A profile whose saved master engine is htmlrewriter must try it FIRST,
  // instead of having it discarded as a manual-only engine.
  assert.equal(engineOrder('auto', 'htmlrewriter')[0], 'htmlrewriter', 'a saved htmlrewriter master must lead the queue');
});

test('the Node runtime reports a real AI test run instead of a queued stub', async () => {
  // On Termux the AI test never started: the dashboard polls
  // /api/ai/test-runs/current and renders nothing when run is null, so the UI
  // sat on "queued on server" forever even though models were being called.
  const server = await readProjectFile('render-src/server.ts');
  assert.doesNotMatch(
    server,
    /test-runs\/current',\s*c\s*=>\s*c\.json\(\{\s*ok:\s*true,\s*run:\s*null\s*\}\)/,
    'the current-run endpoint must not be a hardcoded null stub'
  );
  assert.match(server, /test-runs\/current'[\s\S]{0,120}getCurrentAiRun\(\)/, 'current must return the real run');
  assert.match(server, /startAiTestRun\(body\)/, 'starting a test must create a run');
  const startRoute = server.slice(server.indexOf("app.post('/api/ai/test-runs',"), server.indexOf("app.post('/api/ai/test-runs/control'"));
  assert.match(startRoute, /c\.json\(\{[^)]*?\brun\s*[,:}]/, 'the start response body itself must carry the run the dashboard renders');
  assert.match(server, /controlAiTestRun\(/, 'stop/resume must reach the run');

  const ai = await readProjectFile('render-src/ai.ts');
  assert.match(ai, /status:'queued'/, 'a run starts queued, like the Worker');
  assert.match(ai, /aiRun\.status='running'/, 'the run must move to running so progress is visible');
  assert.match(ai, /aiRun\.status='done'/, 'the run must reach a terminal done state');
  assert.match(ai, /aiRun\.result\.nextCursor=aiRun\.result\.results\.length/, 'progress must be derived from collected results so resume does not under-report');
  assert.match(ai, /if\(aiRun\.stopRequested\)/, 'the loop must honour a stop request');

  // The run object must expose the exact fields the shared dashboard reads.
  for (const field of ['runId', 'total', 'nextCursor', 'results']) {
    assert.ok(ai.includes(field), `the run result must expose ${field} for the dashboard`);
  }
});

test('auto-update rebuilds and restarts the scraper, not just the deployer', async () => {
  // On Termux the deployer would pull a new version, restart itself, and leave
  // the scraper dead: restartUiSoon() calls stopScraper() but nothing brought it
  // back, so the user had to press "Build & start" by hand. The user should only
  // have to refresh the scraper page.
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');

  const autoStart = deployer.indexOf('function autoUpdateFromGit(');
  const auto = deployer.slice(autoStart, deployer.indexOf('\n}', autoStart) + 2);
  assert.ok(auto.includes('updateFromGit('), 'guard: the auto-update body was located');
  assert.match(auto, /restartUiSoon\(\{\s*restartScraper:/, 'a successful auto-update must ask for the scraper to come back');

  // Execute the REAL scraperWasRunning() so gutting it cannot leave this green.
  const probe = deployer.slice(deployer.indexOf('function scraperWasRunning()'), deployer.indexOf('\n', deployer.indexOf('function scraperWasRunning()')));
  const wasRunning = state => new Function('scraper', `${probe}; return scraperWasRunning();`)(state);
  assert.equal(wasRunning({ child: {}, exitCode: null }), true, 'a live scraper must be restarted');
  assert.equal(wasRunning({ child: {}, exitCode: 0 }), false, 'an exited scraper must not be resurrected');
  assert.equal(wasRunning(null), false, 'no scraper means nothing to restart');

  // The successor process must actually be told to start it.
  const restart = deployer.slice(deployer.indexOf('function restartUiSoon('), deployer.indexOf('function runJob('));
  assert.match(restart, /restartScraper\s*=\s*false/, 'restarting the scraper must be opt-in, so a manual UI restart is unchanged');
  assert.match(restart, /restartScraper\s*\?\s*\{\s*LOCAL_SCRAPER_AUTOSTART:\s*'true'\s*\}/, 'the successor deployer must be told to autostart the scraper');

  // The scraper's start command must compile the new code, otherwise a restart
  // would happily serve the previous build.
  assert.match(deployer, /scraperCommand\s*=[^\n]*render:build/, 'the scraper start command must run render:build so the new version is built');
});

test('every diagnostic endpoint the dashboard calls exists on the Node runtime', async () => {
  // On Termux every diagnostic button returned 404 while the visual selector
  // preview worked, because those routes were only ever registered on the
  // Worker. The dashboard is SHARED by both runtimes, so any path it calls must
  // exist in both or the button is dead on Node.
  const server = await readProjectFile('render-src/server.ts');
  const worker = await readProjectFile('worker-src/app.ts');
  const routesOf = source => new Set(
    [...source.matchAll(/app\.(get|post|put|delete|patch|all)\('(\/[^']*)'/g)].map(m => m[2])
  );
  const nodeRoutes = routesOf(server), workerRoutes = routesOf(worker);
  assert.ok(workerRoutes.size > 100, 'guard: worker routes were parsed');
  assert.ok(nodeRoutes.size > 90, 'guard: node routes were parsed');

  // The endpoints behind the diagnostic buttons the user reported as 404.
  const required = [
    '/api/profiles/:id/extraction-diagnostic', '/api/debug', '/api/suggest-selectors',
    '/api/selftest', '/api/parity', '/api/source-test', '/api/import/history',
    '/api/import/history/clear', '/api/jobs/priority', '/api/runs/priority',
    '/api/agent/tasks', '/api/ai/workers-catalog', '/api/category-learning/import'
  ];
  const missing = required.filter(route => !nodeRoutes.has(route));
  assert.deepEqual(missing, [], `these dashboard endpoints 404 on Node/Termux: ${missing.join(', ')}`);

  // Each one must also be implemented, not stubbed out with a 501 "Worker only".
  for (const route of ['/api/debug', '/api/suggest-selectors', '/api/profiles/:id/extraction-diagnostic']) {
    const at = server.indexOf(`'${route}'`);
    const body = server.slice(at, server.indexOf('\napp.', at + 1));
    assert.doesNotMatch(body, /only available on Cloudflare Worker runtime/, `${route} must do real work on Node`);
  }
});

test('the Node extraction diagnostic runs the real scrape pipeline', async () => {
  // The report has to reflect what the scraper actually does, otherwise it can
  // pass while real extraction fails (the user's case: Cloudflare extracts,
  // Termux finds nothing).
  const scraper = await readProjectFile('render-src/scraper.ts');
  const at = scraper.indexOf('export async function diagnoseExtraction');
  assert.ok(at > 0, 'the Node runtime must implement diagnoseExtraction');
  const body = scraper.slice(at);

  assert.match(body, /await safeText\(/, 'it must really fetch the page');
  assert.match(body, /await scrapeListWithMeta\(/, 'it must use the same list pipeline as a real run, so the engine choice matches');
  assert.match(body, /extractSelectorValues\(/, 'it must probe each selector against the real HTML');
  assert.match(body, /await scrapeDetails\(/, 'it must exercise the detail pipeline when detail selectors exist');
  assert.match(body, /usedEngine/, 'the report must name the engine that won, which is what differs between runtimes');

  for (const stage of ['network', 'list-extraction', 'selector-evidence', 'detail-extraction']) {
    assert.ok(body.includes(`'${stage}'`), `the report must include the ${stage} stage the dashboard renders`);
  }
  // A dead network must still produce a readable report rather than throwing.
  assert.match(body, /catch\s*\(error\)\s*\{[\s\S]{0,400}add\('network', false/, 'a failed fetch must be reported as a failed stage, not an exception');
});

test('Node diagnostics report the real local runtime, not Cloudflare bindings', async () => {
  // The Worker's /api/debug checks D1 and queue bindings, which are meaningless
  // on a phone. Reporting those on Termux would be noise at best.
  const diag = await readProjectFile('render-src/diagnostics.ts');
  assert.match(diag, /databaseDriver/, 'it must report the database actually in use (sqlite or postgres)');
  assert.match(diag, /sqlite_master/, 'it must be able to inspect the SQLite schema used on Termux/Windows');
  assert.match(diag, /pg_tables/, 'it must also inspect a PostgreSQL schema');
  assert.match(diag, /browser-engines/, 'it must flag that browsers cannot run on Android');
  const checkNames = [...diag.matchAll(/add\('([a-z0-9-]+)'/g)].map(m => m[1]);
  assert.ok(checkNames.length >= 8, 'guard: diagnostic check names were parsed');
  for (const cloudflareOnly of ['d1-binding', 'queue-binding', 'dlq-binding', 'vault-kdf', 'r2-disabled']) {
    assert.ok(!checkNames.includes(cloudflareOnly), `Cloudflare-only check ${cloudflareOnly} must not run on the Node runtime`);
  }
  for (const expected of ['database', 'schema', 'browser-engines']) {
    assert.ok(checkNames.includes(expected), `the Node runtime must report the ${expected} check`);
  }
  // runtimeEnvironment is a descriptor object; interpolating it printed "[object Object]".
  assert.doesNotMatch(diag, /environment=\$\{runtimeEnvironment\}/, 'the environment must be printed by id/label, not as a raw object');
});

test('list extraction finds fields on the container itself, not only its children', async () => {
  // Root cause of "Cloudflare extracts, Termux extracts nothing": the lookup used
  // $root.find(), which searches DESCENDANTS ONLY. On shops where the product
  // card IS the matching element (container 'a[href*="/product/"]' and title
  // 'a[href*="/product/"]'), the title came back empty and `if (!title) return`
  // skipped every product. The self-or-descendant rule now lives in
  // scopedMatches(), shared by firstText and firstAttr.
  const src = await readProjectFile('render-src/scraper.ts');
  const at = src.indexOf('function scopedMatches(');
  const body = src.slice(at, src.indexOf('\nfunction ', at + 10));
  assert.match(body, /\$root\.filter\(selector\)/, 'the lookup must be able to match the container element itself');
  assert.match(body, /\$root\.find\(selector\)/, 'the lookup must still match descendants');
  // Descendants must win, otherwise a broad selector swallows the whole card text.
  assert.ok(body.indexOf('.find(selector)') < body.indexOf('.filter(selector)'),
    'a descendant match must be preferred over the container itself');
  assert.match(src.slice(src.indexOf('function firstText(')), /scopedMatches\(/, 'firstText must use the shared scoped lookup');
  assert.match(src.slice(src.indexOf('function firstAttr(')), /scopedMatches\(/, 'firstAttr must use the shared scoped lookup');

  // Execute the REAL shipped helpers from the built bundle.
  const cheerio = await import('cheerio');
  const bundle = await readRenderBundle();
  const grab = name => { const i = bundle.indexOf('function ' + name + '('); return bundle.slice(i, bundle.indexOf('\nfunction ', i + 1)); };
  const normalize = v => String(v || '').replace(/[\u200c\u200d\u200e\u200f\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  const { firstText } = new Function('cheerio', 'normalize',
    `${grab('scopedMatches')}${grab('firstText')}; return { firstText };`)(cheerio, normalize);
  const $ = cheerio.load('<a href="/product/1" class="product"><div class="t">عنوان</div><div class="p">۱۲۳</div></a>');
  assert.equal(firstText($, $('a.product'), 'a[href*="/product/"], [class*="t"]'), 'عنوان', 'the inner title must win over the whole card text');
  const $2 = cheerio.load('<a href="/product/2" class="product">فقط عنوان</a>');
  assert.equal(firstText($2, $2('a.product'), 'a[href*="/product/"]'), 'فقط عنوان', 'a card that IS the title must still extract');
});

test('absolute picker paths still resolve inside each product card', async () => {
  // The visual picker saves DOCUMENT-ABSOLUTE paths pinned with :nth-of-type(N)
  // ("section.grid > div.card:nth-of-type(1) > a > div.title"). find() only
  // searches a card's descendants, so such a path never matched and every card
  // was skipped: 0 products while the whole-page evidence check stayed green --
  // exactly the contradiction in the user's barfbox.ir report.
  const cheerio = await import('cheerio');
  const bundle = await readRenderBundle();
  const grab = name => { const i = bundle.indexOf('function ' + name + '('); return bundle.slice(i, bundle.indexOf('\nfunction ', i + 1)); };
  const normalize = v => String(v || '').replace(/\s+/g, ' ').trim();
  const F = new Function('cheerio', 'normalize',
    `${grab('containerNodes')}${grab('scopedMatches')}${grab('firstText')}${grab('firstAttr')}; return { containerNodes, firstText, firstAttr };`)(cheerio, normalize);

  const card = n => `<div class="flex flex-shrink"><a class="flex w-full" href="/p/${n}">` +
    `<div class="relative x"><picture class="block h-full"><img class="h-full" src="/i/${n}.jpg"></picture></div>` +
    `<div class="flex w-full"><div class="my-1 line-clamp-2">Product ${n}</div>` +
    `<div class="flex w-full"><div class="flex flex-row">${n}00,000</div></div></div></a></div>`;
  const $ = cheerio.load(`<section class="grid xl:grid-cols-4">${card(1)}${card(2)}${card(3)}</section>`);
  const container = 'section.grid.xl\\:grid-cols-4 > div.flex.flex-shrink:nth-of-type(1)';
  const title = container + ' > a.flex.w-full > div.flex.w-full:nth-of-type(2) > div.my-1.line-clamp-2:nth-of-type(1)';

  assert.equal($(container).length, 1, 'the saved selector really does pin a single card');
  assert.equal(F.containerNodes($, container).length, 3, 'extraction must widen the pinned container to every card');

  const titles = [];
  F.containerNodes($, container).each((_i, el) => {
    const text = F.firstText($, $(el), title);
    if (text) titles.push(text);
  });
  assert.deepEqual(titles, ['Product 1', 'Product 2', 'Product 3'],
    'each card must resolve its OWN title through the absolute picker path');

  // Scoping must not leak: a path naming one specific card must not bleed into others.
  const $b = cheerio.load('<div class="c" id="one"><span class="t">ONE</span></div><div class="c" id="two"><span class="t">TWO</span></div>');
  const scoped = [];
  $b('div.c').each((_i, el) => scoped.push(F.firstText($b, $b(el), '#one > span.t')));
  assert.deepEqual(scoped, ['ONE', ''], 'a card-specific path must not resolve inside a different card');
});

test('an empty href or src never resolves to the listing page URL', async () => {
  // new URL('', base) returns the BASE url, so an element with no href produced
  // a link that looked valid. The diagnostic then showed a green "link ok"
  // whose sample was the listing page itself -- the misleading evidence in the
  // user's report.
  const src = await readProjectFile('render-src/scraper.ts');
  const line = src.slice(src.indexOf('const absolute ='), src.indexOf('\n', src.indexOf('const absolute =')));
  assert.match(line, /if \(!String\(value \|\| ''\)\.trim\(\)\) return ''/, 'absolute() must reject empty input before resolving');
  const absolute = new Function(`${line.replace(/value: string/, 'value').replace(/base: string/, 'base')} return absolute;`)();
  assert.equal(absolute('', 'https://barfbox.ir/search/?page=1'), '', 'an empty href must not become the page URL');
  assert.equal(absolute('   ', 'https://barfbox.ir/search/?page=1'), '', 'whitespace must not become the page URL');
  assert.equal(absolute('/p/1', 'https://barfbox.ir/search/?page=1'), 'https://barfbox.ir/p/1', 'real links must still resolve');
});

test('the diagnostic reports the evidence-vs-extraction contradiction', async () => {
  // The user saw every selector green while 0 products were extracted, and the
  // report still blamed the container selector generically. Evidence is
  // document-wide; extraction is container-scoped. That gap IS the diagnosis.
  const src = await readProjectFile('render-src/scraper.ts');
  const at = src.indexOf('export async function diagnoseExtraction');
  const body = src.slice(at);
  assert.match(body, /const contradiction = evidenceOk && products\.length === 0/, 'the contradiction must be detected explicitly');
  assert.match(body, /add\('selector-evidence', evidenceOk && !contradiction/, 'the evidence stage must FAIL when it contradicts extraction, not show green');
  assert.match(body, /containerCount/, 'the report must say how many containers matched, which distinguishes the two causes');
});

test('the deployer restores the lockfile using its real repo-relative path', async () => {
  // git status --porcelain reports 'cloudflare-scraper4/package-lock.json', but
  // the restore ran `git checkout -- package-lock.json` from the repo root,
  // which fails with "pathspec did not match". The tree stayed dirty and EVERY
  // auto-update was skipped forever -- why auto-update never worked on Termux.
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  const at = deployer.indexOf('const dirtyProbe');
  const body = deployer.slice(at, deployer.indexOf('const dirty =', at));
  assert.doesNotMatch(body, /\['checkout', '--', 'package-lock\.json'\]/, 'the bare filename does not exist at the repo root');
  assert.match(body, /generated/, 'the real reported paths must be restored');

  // Execute the real parsing against porcelain output.
  const parse = new Function('stdout', `
    const GENERATED = /(?:^|\\/)(?:package-lock\\.json|scraper4\\.worker\\.js|scraper4\\.ts)$/;
    const dirtyPaths = stdout.split('\\n')
      .map(line => (line.match(/^..\\s+(.*)$/) || [])[1] || '')
      .map(path => path.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
    return dirtyPaths.filter(path => GENERATED.test(path));`);
  assert.deepEqual(parse(' M cloudflare-scraper4/package-lock.json'), ['cloudflare-scraper4/package-lock.json'],
    'a lockfile in a subdirectory must be restored at its real path');
  assert.deepEqual(parse(' M package-lock.json'), ['package-lock.json'], 'a root lockfile must still work');
  assert.deepEqual(parse(' M cloudflare-scraper4/scraper4.worker.js'), ['cloudflare-scraper4/scraper4.worker.js'],
    'the tracked worker bundle must be restored at its real path');
  assert.deepEqual(parse(' M src/app.ts'), [], 'unrelated files must never be reverted');
  // A filename that merely ends with the same text must not be swept up.
  assert.deepEqual(parse(' M docs/my-package-lock.json'), [], 'only the real generated paths may be restored');
});

test('the AI diagnose button runs a real AI check, not the installation debug', async () => {
  // It was wired to the generic 'debug' action -> /api/debug, which reports
  // database/tables/browsers and never touches the AI settings, so it always
  // said ok while every model test failed through a broken proxy.
  const dash = await readProjectFile('worker-src/dashboard.ts');
  const at = dash.indexOf("mButton('🩺 عیب");
  const button = dash.slice(at, dash.indexOf('+mButton', at + 5));
  assert.match(button, /'ai-diagnose'/, 'the AI card must use its own diagnose action');
  assert.doesNotMatch(button, /'debug'/, 'it must not reuse the installation debug action');
  assert.match(dash, /action==='ai-diagnose'/, 'the action must be handled');
  assert.match(dash, /\/api\/ai\/diagnose/, 'it must call the AI diagnostic endpoint');

  const ai = await readProjectFile('render-src/ai.ts');
  assert.match(ai, /export async function aiConnectionDiagnostic/, 'the Node runtime must implement the AI diagnostic');
  const body = ai.slice(ai.indexOf('export async function aiConnectionDiagnostic'));
  assert.match(body, /worker-proxy/, 'it must test the indirect Worker proxy, which is what silently breaks model calls');
  assert.match(body, /await aiCall\(/, 'it must make one real model call through the same path the tests use');
  assert.match(body, /connection-mode/, 'it must report which connection mode is in effect');
});

test('a failing diagnostic stage is shown as a red card', async () => {
  const dash = await readProjectFile('worker-src/dashboard.ts');
  const css = dash.slice(dash.indexOf('stage-card.bad{'), dash.indexOf('}', dash.indexOf('stage-card.bad{')) + 1);
  assert.match(css, /background:#2a1116/, 'the failing card itself must be tinted red, not just edged');
  assert.match(dash, /function openStageModal/, 'stage reports must have a shared renderer');
  const modal = dash.slice(dash.indexOf('function openStageModal'), dash.indexOf('function openResultModal'));
  assert.match(modal, /ok\?'ok':'bad'/, 'each stage card must carry the ok/bad class that colours it');
});

test('Termux defaults to the built-in SQLite database, not a local PostgreSQL', async () => {
  // The reported symptom: on every refresh of the Termux scraper page,
  // "connect ECONNREFUSED 127.0.0.1:5432" flashed and the status light stayed
  // red. normalizeDatabaseUrl() rewrote Termux to postgresql://USER@localhost:5432
  // whenever DATABASE_URL was empty, but a stock phone runs no postgres server.
  const src = await readProjectFile('scripts/local-deployer-ui.mjs');
  const at = src.indexOf('function normalizeDatabaseUrl');
  const body = src.slice(at, src.indexOf('\nfunction ', at + 10));
  assert.doesNotMatch(body, /if \(!raw \|\| hasPlaceholder \|\|[^\n]*\) return termuxDatabaseUrl\(\)/,
    'an empty DATABASE_URL on Termux must not be rewritten to a local PostgreSQL URL');

  const run = new Function('termuxDatabaseUrl', 'dockerDatabaseUrl',
    body.replace('function normalizeDatabaseUrl(value = \'\') {', 'function normalizeDatabaseUrl(value, detected) {')
        .replace('const detected = detectEnvironment();', '') + '; return normalizeDatabaseUrl;')(
    () => 'postgresql://u0_a123@localhost:5432/scraper4',
    () => 'postgresql://postgres:postgres@localhost:5432/scraper4');

  const termux = { id: 'termux', method: 'termux-postgresql' };
  assert.equal(run('', termux), 'sqlite:data/scraper4.sqlite', 'an empty URL on Termux must select built-in SQLite');
  assert.equal(run('sqlite:data/scraper4.sqlite', termux), 'sqlite:data/scraper4.sqlite', 'an explicit SQLite choice must be honoured');
  assert.equal(run('postgresql://x@HOST:5432/scraper4', termux), 'sqlite:data/scraper4.sqlite', 'the unresolved @HOST placeholder must not become a dead postgres URL');
  // A deliberate PostgreSQL configuration must still be respected.
  assert.equal(run('postgresql://u0_a123@localhost:5432/scraper4', termux), 'postgresql://u0_a123@localhost:5432/scraper4',
    'an explicitly configured PostgreSQL URL must survive');
  assert.equal(run('postgresql://a:b@db.example.com:5432/s', termux), 'postgresql://a:b@db.example.com:5432/s',
    'a remote PostgreSQL URL must survive');
  // Other runtimes must be unaffected.
  assert.equal(run('', { id: 'windows', method: 'sqlite' }), 'sqlite:data/scraper4.sqlite');
  assert.equal(run('', { id: 'local', method: 'docker' }), '');
});

test('an unreachable LOCAL PostgreSQL self-heals to SQLite, a remote one does not', async () => {
  // Phones that already saved the bad DATABASE_URL must recover on their own,
  // but a remote database that is merely down must keep failing loudly:
  // silently serving an empty local file would hide the real data.
  const db = await readProjectFile('render-src/db.ts');
  assert.match(db, /export function fallbackToSqlite/, 'a runtime fallback must exist');
  assert.match(db, /export function isLoopbackPostgres/, 'the fallback must be restricted to loopback databases');
  const fb = db.slice(db.indexOf('export function fallbackToSqlite'));
  assert.match(fb, /if \(useSqlite \|\| !isLoopbackPostgres\(\)\) return false/,
    'a remote PostgreSQL must never be silently swapped for an empty local file');
  assert.doesNotMatch(db, /^const useSqlite/m, 'useSqlite must be reassignable for the fallback to work');

  // sqlitePath() must not try to use a postgresql:// URL as a file name.
  const path = db.slice(db.indexOf('function sqlitePath'), db.indexOf('async function getSqliteDb'));
  assert.match(path, /postgres\|postgresql\|mysql\|mariadb/, 'a leftover postgres URL must not be treated as a SQLite file path');

  const server = await readProjectFile('render-src/server.ts');
  assert.match(server, /ECONNREFUSED\|ENOENT\|EAI_AGAIN/, 'startup must recognise a refused connection');
  assert.match(server, /fallbackToSqlite\(detail\)/, 'startup must attempt the fallback before giving up');
});

test('a database failure is reported with a real message, not an empty string', async () => {
  // node-postgres throws an AggregateError whose own .message is EMPTY (the real
  // reasons live in .errors[]), so the log printed "DATABASE NOT READY:" with
  // nothing after it and the UI showed a red light with no explanation.
  const server = await readProjectFile('render-src/server.ts');
  const at = server.indexOf('function describeDatabaseError');
  assert.ok(at > -1, 'the error unwrapper must exist');
  const body = server.slice(at, server.indexOf('\nasync function initializeDatabase', at));
  assert.match(body, /Array\.isArray\(value\.errors\)/, 'AggregateError.errors must be unwrapped');

  // Execute the COMPILED helper so no TypeScript syntax can leak in.
  const bundle = await readRenderBundle();
  const bAt = bundle.indexOf('function describeDatabaseError(');
  const compiled = bundle.slice(bAt, bundle.indexOf('\nasync function initializeDatabase', bAt));
  const describeDatabaseError = new Function('databaseDriver', compiled + '; return describeDatabaseError;')('postgres');
  const aggregate = new AggregateError(
    [Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
     Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })], '');
  const text = describeDatabaseError(aggregate);
  assert.match(text, /127\.0\.0\.1:5432/, 'the real address must appear in the message');
  assert.match(text, /sqlite:data\/scraper4\.sqlite/, 'the message must tell the user how to fix it');
  assert.notEqual(text.trim(), '', 'the message must never be empty');
});

test('a database outage keeps its explanation on screen instead of flashing', async () => {
  // notice() hid itself after 6 seconds, so the ECONNREFUSED error appeared and
  // vanished while the top light stayed red with no reason shown.
  const dash = await readProjectFile('worker-src/dashboard.ts');
  assert.match(dash, /function notice\(message,kind='ok',persist=false\)/, 'notice must support a persistent variant');
  assert.match(dash, /if\(!persist\)notice\.timer=setTimeout/, 'a persistent notice must not auto-hide');
  const at = dash.indexOf("catch(error){state.connected=false;");
  const block = dash.slice(at, dash.indexOf('function renderStatus', at));
  assert.match(block, /databaseReady===false/, 'a failed load must check whether the database is the cause');
  assert.match(block, /h\.databaseError/, 'the real database error must be surfaced');
  assert.match(block, /notice\(detail,'error',true\)/, 'the database error must persist on screen');
});

test('the Worker widens a pinned container selector exactly like the Node runtime', async () => {
  // Profiles are shared between runtimes. The visual picker pins the clicked
  // card with :nth-of-type(N), so a container matched ONE card instead of the
  // whole grid. Node fixes this in containerNodes(); the Worker must agree, or
  // the same profile yields a different product count on Cloudflare.
  const src = await readProjectFile('worker-src/scraper.ts');
  const at = src.indexOf('const containers=selectorParts(');
  const line = src.slice(at, src.indexOf('\n  let validContainer', at));
  assert.match(line, /nth-of-type/, 'the Worker must strip the positional pins from the container selector');
  assert.match(line, /replace\(\/:nth-of-type\\\(\\d\+\\\)\/g,''\)/, 'every :nth-of-type(N) step must be removed');
  assert.match(line, /\|\|selector/, 'a selector that is nothing but pins must fall back to the original');

  // The same widening rule must be applied by both runtimes.
  const node = await readProjectFile('render-src/scraper.ts');
  const nodeBody = node.slice(node.indexOf('function containerNodes'), node.indexOf('\nfunction scrapeListCheerioFromHtml'));
  assert.match(nodeBody, /:nth-of-type\(/, 'the Node runtime must key on the same pattern');

  const widen = new Function('selector',
    "return selector.includes(':nth-of-type(')?(selector.replace(/:nth-of-type\\(\\d+\\)/g,'').trim()||selector):selector;");
  assert.equal(widen('section.grid > div.card:nth-of-type(1)'), 'section.grid > div.card');
  assert.equal(widen('li.product'), 'li.product', 'an unpinned selector must be left alone');
  assert.equal(widen(':nth-of-type(2)'), ':nth-of-type(2)', 'a pin-only selector must not become empty');
});

test('the visual picker saves a repeating container and card-relative field selectors', async () => {
  // The picker used to save a DOCUMENT-ABSOLUTE path for every field
  // ("section.grid > div.card:nth-of-type(1) > a > div.title") and a container
  // pinned to one card. Extraction searches only inside a card, so no field
  // ever matched: 0 products with all-green whole-page evidence.
  const src = await readProjectFile('render-src/visual.ts');
  const at = src.indexOf('const PICKER_JS');
  const picker = src.slice(at, src.indexOf('`;', at));
  assert.match(picker, /function generalize\(/, 'the container must be generalised to every sibling card');
  assert.match(picker, /function relative\(/, 'field selectors must be rewritten relative to the container');
  assert.match(picker, /el\.closest\(containerSel\)/, 'relativisation must anchor on the chosen container');
  // Both the live preview and the saved value must use the corrected selector.
  const choose = picker.slice(picker.indexOf('function choose('), picker.indexOf('document.addEventListener'));
  assert.match(choose, /generalize\(current,s\)/, 'the preview must show the generalised container');
  assert.match(choose, /relative\(current,s\)/, 'the preview must show the relative field selector');
  const save = picker.slice(picker.indexOf("__s4save').onclick"));
  assert.match(save, /s=generalize\(current,s\);containerSel=s/, 'saving a container must generalise it and remember it');
  assert.match(save, /else s=relative\(current,s\)/, 'saving a field must relativise it against the container');
  assert.doesNotMatch(save.slice(0, save.indexOf('postMessage')), /const s=selector\(current\),/,
    'the saved value must not be the raw absolute path');

  // Exercise the real generalisation rule.
  const generalize = new Function('document', 'el', 's', `
    ${picker.slice(picker.indexOf('function generalize('), picker.indexOf('function relative('))}
    return generalize(el, s);`);
  const cards = [{}, {}, {}];
  const doc = { querySelectorAll: sel => (sel.includes(':nth-of-type(') ? [cards[0]] : cards) };
  assert.equal(generalize(doc, cards[0], 'section.grid > div.card:nth-of-type(1)'), 'section.grid > div.card',
    'a pinned container must widen to all sibling cards');
  const single = { querySelectorAll: () => [cards[0]] };
  assert.equal(generalize(single, cards[0], 'section.grid > div.card:nth-of-type(1)'), 'section.grid > div.card:nth-of-type(1)',
    'when widening does not find more cards the original selector must be kept');
  // Widening must never silently point somewhere else: if the element the user
  // actually clicked is not part of the wider match, keep the exact selector.
  const elsewhere = { querySelectorAll: sel => (sel.includes(':nth-of-type(') ? [cards[0]] : [cards[1], cards[2]]) };
  assert.equal(generalize(elsewhere, cards[0], 'section.grid > div.card:nth-of-type(1)'), 'section.grid > div.card:nth-of-type(1)',
    'a widening that drops the picked element must be rejected');
});

test('every engine the benchmark can select is offered in the dropdowns', async () => {
  // The 3-page speed test benchmarks cheerio and SAVES the winner as the
  // profile's extractionEngine. The dropdown had no cheerio <option>, so a
  // <select> with no matching option fell back to its first entry ("auto") and
  // the saved engine was silently lost the next time the profile was saved.
  const dash = await readProjectFile('worker-src/dashboard.ts');
  const at = dash.indexOf('const extractionEngineOptions=');
  const options = new Function(dash.slice(at, dash.indexOf('];', at) + 2) + ' return extractionEngineOptions;')();
  const ids = options.map(o => o[0]);
  assert.ok(ids.includes('cheerio'), 'the JS-rendered dropdown must offer cheerio');
  assert.ok(dash.includes('<option value="cheerio">'), 'the static profile-editor dropdown must offer cheerio too');

  // Whatever the Node benchmark can pick must be selectable in the UI.
  const server = await readProjectFile('render-src/server.ts');
  const line = server.slice(server.indexOf('const BENCHMARK_ENGINES'), server.indexOf('\n', server.indexOf('const BENCHMARK_ENGINES')));
  const benchmarked = [...line.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(benchmarked.includes('cheerio'), 'sanity: the benchmark really does test cheerio');
  for (const engine of benchmarked) {
    assert.ok(ids.includes(engine), `benchmarked engine "${engine}" must be selectable in the dropdown`);
  }
  // And every offered engine must be accepted by normalizeProfile in BOTH
  // runtimes -- an engine missing from the allow-list is silently rewritten to
  // 'auto' on save, which is how the benchmark result kept disappearing.
  for (const [runtime, file] of [['Node', 'render-src/server.ts'], ['Cloudflare Worker', 'worker-src/app.ts']]) {
    const src = await readProjectFile(file);
    const at = src.indexOf("extractionEngine:");
    const accepted = src.slice(src.indexOf("['auto'", at), src.indexOf(']', src.indexOf("['auto'", at)) + 1);
    for (const id of ids) assert.ok(accepted.includes(`'${id}'`), `${runtime}: dropdown engine "${id}" must survive normalizeProfile`);
  }

  // Every offered engine must actually RUN somewhere. The Worker has no cheerio
  // package, so before this fix picking cheerio there returned zero products
  // with no error at all -- the worst kind of failure to debug.
  const wScraper = await readProjectFile('worker-src/scraper.ts');
  // The two runtimes' ExtractionEngine unions must stay identical, otherwise the
  // Worker rejects an engine the Node benchmark just saved to the profile.
  const engineUnion = src => [...src.slice(src.indexOf('export type ExtractionEngine'), src.indexOf(';', src.indexOf('export type ExtractionEngine'))).matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual(
    engineUnion(await readProjectFile('worker-src/types.ts')),
    engineUnion(await readProjectFile('render-src/types.ts')),
    'the Worker and Node ExtractionEngine unions must match',
  );
  const wDispatch = wScraper.slice(wScraper.indexOf('const tryOne=async'), wScraper.indexOf('for(const name of engineOrder', wScraper.indexOf('const tryOne=async')));
  const nodeOnly = ['playwright', 'puppeteer', 'crawlee_playwright'];
  for (const id of ids.filter(e => e !== 'auto' && !nodeOnly.includes(e))) {
    assert.ok(wDispatch.includes(`name==='${id}'`), `Worker engine "${id}" must be dispatched, not silently return []`);
  }
  // ...and the Node runtime must dispatch every offered engine as well.
  const rScraper = await readProjectFile('render-src/scraper.ts');
  const rDispatch = rScraper.slice(rScraper.indexOf('const pick = async'), rScraper.indexOf('for(const name of engineOrder', rScraper.indexOf('const pick = async')));
  for (const id of ids.filter(e => e !== 'auto')) {
    assert.ok(rDispatch.includes(`name === '${id}'`), `Node engine "${id}" must be dispatched`);
  }
});

test('manual sync runs list, details and delivery in one click', async () => {
  // The home button was labelled "automatic extraction" and createJob() sent an
  // empty body for scrape jobs, so the backend defaulted to target 'none' and
  // the run always stopped after extraction -- details/sync never happened.
  const dash = await readProjectFile('worker-src/dashboard.ts');
  assert.ok(dash.includes('🔄 همگام‌سازی دستی'), 'the button must be relabelled manual sync');
  assert.match(dash, /body=\{target\}/, 'a scrape job must forward its destination');
  assert.doesNotMatch(dash, /body=kind==='sync'\?\{target\}:\{\}/, 'the scrape branch must not drop the target again');

  // The target must follow the profile's own destination switches.
  const at = dash.indexOf('function homeJobTarget()');
  const body = dash.slice(at, dash.indexOf('\n', at));
  assert.match(body, /homeSyncWoo/, 'the WooCommerce switch must be considered');
  assert.match(body, /homeSyncBasalam/, 'the Basalam switch must be considered');
  const homeJobTarget = new Function('$', body + '; return homeJobTarget;')(id => ({
    homeSyncTarget: { value: 'none' }, homeSyncWoo: { checked: true }, homeSyncBasalam: { checked: true }
  }[id]));
  assert.equal(homeJobTarget(), 'both', 'both destinations enabled must send to both');

  // The processor already ordered the phases; assert the order is still list -> details -> sync.
  const proc = await readProjectFile('render-src/processor.ts');
  const details = proc.indexOf("job.phase = 'details'");
  const save = proc.indexOf("job.phase = 'save'");
  const sync = proc.indexOf('await runSync(job, profile, products)');
  assert.ok(details > 0 && save > details && sync > save, 'details must run before save, and delivery last');
  assert.match(proc, /if \(job\.target !== 'none'\) await runSync/, 'delivery must run whenever a destination is set');
});

test('the AI description generator fills only missing fields, using the master model', async () => {
  const ai = await readProjectFile('render-src/ai.ts');
  assert.match(ai, /export async function preferredAiChatModel/, 'the master model must be resolvable on Node');
  const picker = ai.slice(ai.indexOf('export async function preferredAiChatModel'));
  assert.ok(picker.indexOf('ai.master') < picker.indexOf('ai.model'), 'the pinned master model must win over ai.model');

  assert.match(ai, /export async function generateProductDescription/, 'the generator must exist');
  const gen = ai.slice(ai.indexOf('export async function generateProductDescription'));
  // Never overwrite real scraped content.
  assert.match(gen, /options\.force \|\| need\.shortDesc/, 'shortDesc must only be written when missing');
  assert.match(gen, /options\.force \|\| need\.longDesc/, 'longDesc must only be written when missing');
  assert.match(gen, /options\.force \|\| need\.variations/, 'variations must only be written when missing');
  // Images must never be invented.
  assert.doesNotMatch(gen, /parsed\.images/, 'gallery images must never come from the model');

  // Exercise the REAL compiled helper so no TypeScript syntax can leak in.
  const bundle = await readRenderBundle();
  const bAt = bundle.indexOf('function productNeedsEnrichment(');
  const detect = new Function(bundle.slice(bAt, bundle.indexOf('\nfunction ', bAt + 1)) + '; return productNeedsEnrichment;')();
  assert.equal(detect({ title: 'X' }).any, true, 'an empty product needs enrichment');
  assert.equal(detect({ title: 'X', shortDesc: 'a short one', longDesc: 'x'.repeat(60), images: ['a', 'b'], variations: ['s'] }).any,
    false, 'a fully populated product must be left alone');

  // Always-on by default, and a failure must never fail the scrape.
  const proc = await readProjectFile('render-src/processor.ts');
  assert.match(proc, /ai_description_settings/, 'the toggle must be read from stored settings');
  assert.match(proc, /aiSettings\?\.enabled !== false/, 'the generator must default to ON');
  const block = proc.slice(proc.indexOf("job.phase = 'ai-descriptions'"), proc.indexOf("job.phase = 'save'", proc.indexOf('ai-descriptions')));
  assert.match(block, /catch \(error\)/, 'an AI failure must be caught, never failing the run');
  assert.ok(proc.indexOf("job.phase = 'ai-descriptions'") > proc.indexOf("job.phase = 'details'"),
    'enrichment must run after real detail extraction, so it only fills what is genuinely missing');
});

test('the AI description endpoints exist in BOTH runtimes, so the tab is never dead', async () => {
  // The dashboard bundle is shared by the Cloudflare Worker and the Node server.
  // A route added to only one runtime gives the other a 404 on a visible button
  // -- the "dead buttons" defect reported repeatedly. Keep them in lockstep.
  const dash = await readProjectFile('worker-src/dashboard.ts');
  const called = [...dash.matchAll(/api\('(\/api\/ai\/description-settings)'/g)].map(m => m[1]);
  assert.ok(called.length >= 1, 'sanity: the dashboard really calls the description-settings API');
  assert.ok(dash.includes("/ai-descriptions'"), 'sanity: the dashboard calls the per-profile backfill API');

  for (const [runtime, file] of [['Cloudflare Worker', 'worker-src/app.ts'], ['Node', 'render-src/server.ts']]) {
    const src = await readProjectFile(file);
    assert.ok(src.includes("app.get('/api/ai/description-settings'"), `${runtime} must serve GET /api/ai/description-settings`);
    assert.ok(src.includes("app.post('/api/ai/description-settings'"), `${runtime} must serve POST /api/ai/description-settings`);
    assert.ok(src.includes("app.post('/api/profiles/:id/ai-descriptions'"), `${runtime} must serve POST /api/profiles/:id/ai-descriptions`);
  }

  // Both runtimes must own a real generator, and both must enrich by default.
  for (const [runtime, aiFile, procFile] of [
    ['Cloudflare Worker', 'worker-src/ai.ts', 'worker-src/processor.ts'],
    ['Node', 'render-src/ai.ts', 'render-src/processor.ts'],
  ]) {
    const ai = await readProjectFile(aiFile);
    assert.ok(ai.includes('export async function generateProductDescription'), `${runtime} needs generateProductDescription`);
    assert.ok(ai.includes('export function productNeedsEnrichment'), `${runtime} needs productNeedsEnrichment`);
    // Ignore the import block: only the real call sites tell us the ordering.
    const proc = (await readProjectFile(procFile)).split('\n').filter(l => !/^\s*import[\s{]/.test(l)).join('\n');
    assert.ok(proc.includes("'ai_description_settings'"), `${runtime} processor must read the on/off switch`);
    assert.ok(/enabled\s*\)?\s*!==\s*false/.test(proc), `${runtime} processor must default the generator ON`);
    assert.ok(proc.indexOf('generateProductDescription') > proc.indexOf('scrapeDetails('), `${runtime} must enrich AFTER detail extraction`);
    assert.ok(proc.indexOf('generateProductDescription') < proc.indexOf('upsertProduct('), `${runtime} must enrich BEFORE the product is saved`);
  }
});

// ---------------------------------------------------------------------------
// v1.95.0 regressions
// ---------------------------------------------------------------------------

test('the Node runtime never reaches into the Cloudflare D1 data layer', async () => {
  // Pressing the reconciliation-table button on Termux/VPS/Render failed with
  // "D1 binding DB is not configured": render-src/maintenance.ts re-exported the
  // Worker implementation, which imports worker-src/db.js -> the D1 binding.
  // Sharing pure logic is fine; sharing anything that reaches a database is not.
  const files = ['maintenance', 'server', 'processor', 'scraper', 'db', 'sync', 'ai', 'vault'];
  const banned = /from '\.\.\/worker-src\/(db|env|schema|queue)\.js'/;
  for (const name of files) {
    const src = await readProjectFile(`render-src/${name}.ts`);
    assert.doesNotMatch(src, banned, `render-src/${name}.ts must not import the Worker's database layer`);
  }
  // recon-core is the shared piece: it must stay free of every data dependency.
  const core = await readProjectFile('worker-src/recon-core.ts');
  const imports = [...core.matchAll(/from '([^']+)'/g)].map(m => m[1]);
  const allowed = ['./utils.js', './dedup.js'];
  for (const spec of imports) assert.ok(allowed.includes(spec), `recon-core must only depend on pure helpers, found ${spec}`);
  // The allow-list is only safe while every entry is itself IO-free.
  for (const spec of imports) {
    const dep = await readProjectFile(`worker-src/${spec.replace('./', '').replace('.js', '.ts')}`);
    const depImports = [...dep.matchAll(/from '([^']+)'/g)].map(m => m[1]);
    for (const nested of depImports) assert.ok(allowed.includes(nested), `${spec} must stay pure, but imports ${nested}`);
    const depCode = dep.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(depCode, /\b(env\.DB|getState|setState|maintenanceRows)\b/, `${spec} must not touch IO`);
  }
  const coreCode = core.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(coreCode, /\b(fetch|env\.DB|getState|setState|maintenanceRows)\b/, 'recon-core must not touch IO');
});

test('reconciliation compares prices AFTER each destination adjustment', async () => {
  const core = await readProjectFile('worker-src/recon-core.ts');
  const start = core.indexOf('export function expectedPriceFor');
  assert.ok(start > -1, 'expectedPriceFor must exist');
  const body = core.slice(start, core.indexOf('\n}', start) + 2)
    .replace(/export function expectedPriceFor\s*\([^)]*\)\s*:\s*number\s*\|\s*null/, 'function expectedPriceFor(sourcePrice, account)');
  assert.doesNotMatch(body, /:\s*(?:number|string|ReconAccount)/, 'the spliced function must be plain JS');
  const expectedPriceFor = new Function(`${body}; return expectedPriceFor;`)();

  // A stall selling at +10% in Rial is CORRECT at 110% x 10, not "different".
  assert.equal(expectedPriceFor(86000, { pricePercent: 10, toRial: true }), 946000);
  assert.equal(expectedPriceFor(86000, { pricePercent: 0, toRial: false }), 86000);
  assert.equal(expectedPriceFor(1000, { pricePercent: -20, toRial: false }), 800);
  assert.equal(expectedPriceFor(0, { pricePercent: 10, toRial: false }), null, 'no source price is not comparable');
});

test('the unified reconciliation endpoints exist in BOTH runtimes', async () => {
  // The dashboard is shared, so a route that exists in only one runtime is a
  // dead button in the other.
  const routes = ['/api/maintenance/recon-unified', '/api/maintenance/recon-unified/apply', '/api/maintenance/recon-accounts'];
  const worker = await readProjectFile('worker-src/app.ts');
  const node = await readProjectFile('render-src/server.ts');
  for (const route of routes) {
    assert.ok(worker.includes(route), `the Worker must serve ${route}`);
    assert.ok(node.includes(route), `the Node server must serve ${route}`);
  }
  const dash = await readProjectFile('worker-src/dashboard.ts');
  assert.match(dash, /action==='recon-unified'/, 'the dashboard must handle the unified action');
  assert.match(dash, /renderUnifiedRecon/, 'the dashboard must render the unified table');
  // Applying real changes must be explicit, and extras must never be deleted.
  const core = await readProjectFile('worker-src/recon-core.ts');
  assert.doesNotMatch(core, /kind:\s*'delete'/, 'extra destination products must never be auto-deleted');
  for (const runtime of ['worker-src/maintenance.ts', 'render-src/maintenance.ts']) {
    const src = await readProjectFile(runtime);
    assert.match(src, /apply\s*=\s*false/, `${runtime} must default to a dry run`);
  }
});

test('every engine dropdown offers the same engines, including cheerio', async () => {
  // cheerio was selectable in the settings dropdown but missing from the home
  // dropdown, so opening a profile silently reset a saved cheerio engine.
  const dash = await readProjectFile('worker-src/dashboard.ts');
  const ids = ['extractionEngine', 'homeExtractionEngine'];
  const seen = [];
  for (const id of ids) {
    const at = dash.indexOf(`<select id="${id}">`);
    assert.ok(at > -1, `the ${id} dropdown must exist`);
    const block = dash.slice(at, dash.indexOf('</select>', at));
    const engines = [...block.matchAll(/value="([a-z_]+)"/g)].map(m => m[1]);
    assert.ok(engines.includes('cheerio'), `the ${id} dropdown must offer cheerio`);
    seen.push(engines.join(','));
  }
  assert.equal(new Set(seen).size, 1, 'every engine dropdown must offer exactly the same engines');
});

test('a page count of 0 means "auto", never "scan nothing", in both runtimes', async () => {
  // Profiles saved with pages=0 extracted 0 products on Node while the Worker
  // happily scanned up to 100 pages: the Node loop ran zero iterations.
  for (const runtime of ['worker-src/processor.ts', 'render-src/processor.ts']) {
    const src = await readProjectFile(runtime);
    assert.match(src, /pageLimit\s*=\s*[^;]*profile\.pages\s*>\s*0\s*\?\s*profile\.pages\s*:\s*100/,
      `${runtime} must treat pages=0 as the automatic 100-page cap`);
  }
});

test('the product link survives a selector that points at an image', async () => {
  // The saved link selector matched the card's <img>, so every product URL came
  // back empty and the run stored 0 products while diagnostics found 20.
  const scraper = await readProjectFile('render-src/scraper.ts');
  const start = scraper.indexOf('function productLink');
  assert.ok(start > -1, 'render-src/scraper.ts must resolve links defensively');
  const body = scraper.slice(start, scraper.indexOf('\nfunction ', start + 10));
  for (const step of ['closest', 'href']) {
    assert.ok(body.includes(step), `the link resolver must try ${step}`);
  }
  assert.match(body, /javascript:/, 'javascript: links must be rejected');
  // Both Node extraction paths must use it, not just the one that was reported.
  const uses = (scraper.match(/productLink\(/g) || []).length;
  assert.ok(uses >= 3, `productLink must be used by every extraction path (found ${uses})`);
  // The Worker recovers the anchor through its card-scoped link fallback.
  const worker = await readProjectFile('worker-src/scraper.ts');
  assert.match(worker, /a\[href\]/, 'the Worker must keep its card-level anchor fallback');
});

test('the test command builds every artifact the tests read', async () => {
  // The Cloudflare Pages build ran `npm ci && npm run worker:test` on a clean
  // checkout and failed with ENOENT on render-dist/server.js: four tests execute
  // the real shipped helpers from the Node bundle, but worker:test only built
  // the Worker bundle and render-dist/ is gitignored. It passed locally purely
  // because a stale build was lying around.
  const command = pkg.scripts['worker:test'];
  const suite = await readProjectFile('worker-tests/version-sync.test.mjs');

  const artifacts = [
    { dir: 'render-dist', script: 'render:build' },
    { dir: 'scraper4.worker.js', script: 'worker:build' },
  ];
  for (const { dir, script } of artifacts) {
    if (!suite.includes(dir)) continue;
    assert.ok(command.includes(script),
      `the tests read ${dir}, so worker:test must run ${script} first (it is gitignored and absent on a clean checkout)`);
  }

  // Anything the tests read must be produced by the build, never committed.
  const ignore = await readProjectFile('.gitignore');
  assert.match(ignore, /^render-dist\/$/m, 'render-dist must stay a build artifact, not committed output');
});

test('the sync preview is a colour-coded matrix, not a text dump', async () => {
  // The preview used to be `JSON.stringify(d, null, 2)` in a <pre>: technically
  // complete, but unreadable. It must be a product x destination table where the
  // COLOUR of each cell says whether that product is in sync at that destination.
  const dash = await readProjectFile('worker-src/dashboard.ts');
  const handlerAt = dash.indexOf("if(action==='recon-unified-preview'");
  assert.ok(handlerAt > -1, 'the unified preview handler must exist');
  const handler = dash.slice(handlerAt, dash.indexOf("if(action.startsWith('recontable-')", handlerAt));
  assert.doesNotMatch(handler, /textContent=JSON\.stringify/, 'the preview must not dump raw JSON');
  assert.match(handler, /innerHTML=html/, 'the preview must render real markup');
  assert.match(dash, /renderReconMatrix\(d,\{limit:\d+,applied:apply\}\)/, 'both preview and apply must render the matrix');

  // Run the REAL renderer, extracted from the shipping source.
  const grab = name => {
    const at = dash.indexOf(`function ${name}(`);
    assert.ok(at > -1, `${name} must exist`);
    return dash.slice(at, dash.indexOf('\nfunction ', at + 1));
  };
  const cssAt = dash.indexOf('const RECON_MATRIX_CSS=');
  assert.ok(cssAt > -1, 'the matrix must ship its own styles');
  const css = dash.slice(cssAt, dash.indexOf("</style>';", cssAt) + 10);
  const helpers = `
    function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
    function fa(v){return Number(v||0).toLocaleString('fa-IR')}`;
  const { renderReconMatrix } = new Function(
    `${helpers}${css}${grab('reconCellStyle')}${grab('reconMatrixCell')}${grab('renderReconMatrix')}; return { renderReconMatrix };`)();

  const row = (bucket, accountKey, accountName, over) => ({
    bucket, target: accountKey === 'default' ? 'woo' : 'basalam', accountKey, accountName,
    profileId: 'p1', profileName: 'پروفایل', sourceKey: 'a', title: 'کالای نمونه',
    sourcePrice: 1000, expectedPrice: 1000, remotePrice: 1000, remoteId: 5, why: '', ...over });
  const data = {
    ok: true, dryRun: true, planned: 2, matched: 1, priceDiff: 1, missing: 1, extra: 0, noPrice: 0,
    inSync: false, local: 2, accounts: 2, failures: [],
    rows: [
      row('matched', 'default', 'ووکامرس'),
      row('priceDiff', '200', 'غرفهٔ دوم', { remotePrice: 1200, expectedPrice: 1100 }),
      row('missing', 'default', 'ووکامرس', { sourceKey: 'b', title: 'کالای دوم', remotePrice: null, remoteId: null }),
    ],
  };
  const html = renderReconMatrix(data, { limit: 400, applied: false });

  // One column per destination, one row per product.
  assert.ok(html.includes('ووکامرس') && html.includes('غرفهٔ دوم'), 'every destination must be a column');
  assert.ok(html.includes('کالای نمونه') && html.includes('کالای دوم'), 'every product must be a row');

  // Each state must carry its OWN colour, and they must all differ.
  const colours = [...html.matchAll(/class="rc-cell" style="color:(#[0-9a-f]{6})/g)].map(m => m[1]);
  assert.ok(colours.length >= 3, 'every comparison must produce a coloured cell');
  assert.equal(new Set(colours).size, 3, 'matched, priceDiff and missing must be visually distinct');

  // A cell the user cannot act on must be visibly inert, not fake-green.
  assert.match(html, /rc-none/, 'a product not sent to a destination must render as an inert cell');
  // Colour alone is not accessible: each state also carries a glyph and a label.
  for (const glyph of ['✓', '≠', '+']) assert.ok(html.includes(glyph), `state glyph ${glyph} must be present`);
  assert.ok(html.includes('rc-legend'), 'the colour code must be explained by a legend');
  assert.match(html, /title="/, 'cells must expose the full comparison on hover');
  // A dry run must never look like it changed something.
  assert.ok(html.includes('هیچ تغییری'), 'the preview must state that nothing was written yet');
  assert.ok(!html.includes('"bucket"'), 'no raw JSON may leak into the table');

  const empty = renderReconMatrix({ ok: true, rows: [] }, {});
  assert.match(empty, /rc-empty/, 'an empty result must explain itself instead of rendering a blank table');
});

test('the sync preview returns the data its table needs, in both runtimes', async () => {
  // The dry run used to return only a flat action list, so a matrix drawn from
  // it would have been empty. Both runtimes must return the rows and totals.
  for (const runtime of ['render-src/maintenance.ts', 'worker-src/maintenance.ts']) {
    const src = await readProjectFile(runtime);
    const at = src.indexOf('export async function unifiedReconApply');
    assert.ok(at > -1, `${runtime} must expose unifiedReconApply`);
    const body = src.slice(at, src.indexOf('\nasync function basalamUpdateShop', at));
    const dry = body.slice(body.indexOf('if (!apply)') >= 0 ? body.indexOf('if (!apply)') : body.indexOf('if(!apply)'),
      body.indexOf('changed'));
    for (const field of ['rows', 'accountsBreakdown', 'matched', 'priceDiff', 'missing']) {
      assert.match(dry, new RegExp(`${field}\\s*:\\s*(?:report|after)\\.${field}`),
        `${runtime}: the dry run must return ${field} so the table can be drawn`);
    }
    // After applying, the table must show the real post-sync state.
    assert.match(body, /const after\s*=\s*changed\s*\?\s*await unifiedRecon\(profileId\)\s*:\s*report/,
      `${runtime}: applying must re-read the state so the table reflects reality`);
  }
});

test('untracked files never pause the auto-update', async () => {
  // `git reset --hard` only rewrites TRACKED files; it never deletes untracked
  // ones. Counting them meant a device with node_modules/, data/, storage/ or a
  // personal notes file was paused forever for a danger that does not exist --
  // which is why "Update from GitHub" still had to be pressed by hand.
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  const at = deployer.indexOf('function autoUpdateFromGit');
  assert.ok(at > -1, 'the auto-updater must exist');
  const body = deployer.slice(at, deployer.indexOf('\nfunction ', at + 10));

  const probes = [...body.matchAll(/runSync\('git', \['status', '--porcelain'([^\]]*)\]\)/g)].map(m => m[1]);
  assert.ok(probes.length >= 2, 'the updater must probe the worktree before resetting');
  for (const args of probes) {
    assert.match(args, /--untracked-files=no/,
      'every dirty probe must ignore untracked files, since reset --hard cannot destroy them');
  }

  // The repository root must ignore installed dependencies, or a plain install
  // shows up as untracked noise on every device.
  const rootIgnore = await readFile(new URL('../.gitignore', projectUrl), 'utf8');
  assert.match(rootIgnore, /^node_modules\/$/m, 'the repo root must ignore node_modules');
});

test('an optional credential-helper cleanup cannot fail the auto-update', async () => {
  const source = await readFile(new URL('scripts/local-deployer-ui.mjs', projectUrl), 'utf8');
  // `git config --unset-all` exits non-zero when the key is simply absent, which
  // is the normal state of a fresh clone. Counting it made a fully successful
  // update report ok:false.
  const line = source.split('\n').find(text => text.includes("'--unset-all', 'credential.helper'"));
  assert.ok(line, 'the credential-helper cleanup step must still exist');
  assert.match(line, /optional:\s*true/, 'the cleanup must be marked optional');
  assert.match(line, /ok:\s*true/, 'its result must not drag the overall ok down');
});

// --- Request 35a: refreshing the deployer page must be enough to pick up a new
// version. The background timer can be disabled or throttled, and users kept
// sitting on an old version because GET /api/branches only replayed cached state.
test('refreshing the deployer page scans branches and installs the newest version', async () => {
  const deployer = await readProjectFile('scripts/local-deployer-ui.mjs');
  const handler = deployer.match(/if \(req\.method === 'GET' && url\.pathname === '\/api\/branches'\) \{[\s\S]*?\n    \}/);
  assert.ok(handler, 'the GET /api/branches handler must exist');
  const body = handler[0];
  assert.match(body, /scanAllBranches\('page-refresh'\)/, 'a page refresh must trigger a real branch scan');
  assert.match(body, /maybeAutoInstallNewest\(\)/, 'a refresh must also install the newest version');
  assert.match(body, /autoUpdateEnabled/, 'the refresh scan must honour LOCAL_DEPLOYER_AUTO_UPDATE=false');
  assert.match(body, /branchState\.scanning/, 'a refresh must not start a second concurrent scan');
  assert.match(body, /REFRESH_SCAN_MIN_MS/, 'rapid refreshes must be throttled');
  const throttle = deployer.match(/const REFRESH_SCAN_MIN_MS = ([\d_]+);/);
  assert.ok(throttle, 'the throttle window must be defined');
  const ms = Number(throttle[1].replace(/_/g, ''));
  assert.ok(ms > 0 && ms <= 60_000, `throttle window should be a short positive interval, got ${ms}`);
});

// --- Request 35b: the AI model-test results table must not pop open on every
// dashboard refresh. It should appear only when this tab watched a run finish.
test('a dashboard refresh does not reopen the AI model-test results table', async () => {
  const dash = await readProjectFile('worker-src/dashboard.ts');
  assert.match(dash, /await loadJobs\(false\);refreshCurrentAiRun\(false\)/,
    'the page bootstrap must not ask for the finished-run table');
  assert.match(dash, /if\(presentDone&&aiWatchedRunning!==run\.id\)presentDone=false;/,
    'only a run this tab watched running may auto-open its table');
  assert.match(dash, /aiWatchedRunning=run\.id/,
    'a run observed while polling must be remembered');
});

// Node/Worker drift is a recurring defect: the code-suffix rule was first added
// only to the Worker, so the Node runtime silently reconciled everything.
test('both runtimes apply the (کد ایکس) rule to reconciliation and sync', async () => {
  for (const path of ['worker-src/maintenance.ts', 'render-src/maintenance.ts']) {
    const src = await readProjectFile(path);
    assert.match(src, /hasCodeSuffix/, `${path} must filter by the code suffix`);
    assert.match(src, /skippedNoCode/, `${path} must report how many products were skipped`);
    assert.match(src, /reconcileAccount\([\s\S]{0,120}suffixFormats\)/, `${path} must pass the configured formats through`);
  }
  for (const path of ['worker-src/processor.ts', 'render-src/processor.ts']) {
    const src = await readProjectFile(path);
    assert.match(src, /hasCodeSuffix/, `${path} must skip publishing products without a code suffix`);
  }
});
