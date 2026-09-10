import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const projectUrl = new URL('../', import.meta.url);
const readProjectFile = name => readFile(new URL(name, projectUrl), 'utf8');
const pkg = JSON.parse(await readProjectFile('package.json'));
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
    assert.match(source, /status', '--porcelain'\]/, `${name} must check for a dirty worktree before resetting`);
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
  assert.match(deployer, /const lockOnly = dirtyProbe\.stdout/, 'the updater must detect lockfile-only churn');
  assert.match(deployer, /runSync\('git', \['checkout', '--', 'package-lock\.json'\]\)/, 'it must restore the lockfile rather than reset --hard');

  // Exercise the predicate itself against real `git status --porcelain` output.
  const lockOnly = out => out.trim().split('\n').every(line => /\s(?:cloudflare-scraper4\/)?package-lock\.json$/.test(line));
  assert.equal(lockOnly(' M cloudflare-scraper4/package-lock.json'), true, 'lockfile churn must be ignorable');
  assert.equal(lockOnly(' M package-lock.json'), true, 'also when the deployer runs inside the project dir');
  assert.equal(lockOnly(' M cloudflare-scraper4/package-lock.json\n M cloudflare-scraper4/worker-src/ai.ts'), false,
    'a real edit alongside the lockfile must still pause the update');
  assert.equal(lockOnly(' M cloudflare-scraper4/worker-src/ai.ts'), false, 'a real edit must pause the update');

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
  assert.ok(pkg.devDependencies['esbuild-wasm'], 'esbuild-wasm must be declared so it is always installed');
  assert.equal(pkg.devDependencies['esbuild-wasm'], pkg.devDependencies.esbuild, 'both esbuild builds must be pinned together');
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
    .replace(/^type D1Usage = .*$/m, '')
    .replace(/let usageFlushing: Promise<void> \| null = null;/, 'let usageFlushing = null;')
    .replace(/: D1Usage/g, '').replace(/<D1Usage>/g, '')
    .replace(/\(at: Date = new Date\(\)\)/, '(at = new Date())')
    .replace(/function meter\(meta: \{[^}]*\} \| undefined\): void/, 'function meter(meta)')
    .replace(/async function flushUsage\(\): Promise<void>/, 'async function flushUsage()')
    .replace(/function maybeFlushUsage\(waitUntil\?: \([^)]*\) => void\): void/, 'function maybeFlushUsage(waitUntil)')
    .replace(/async function getD1Usage\(\): Promise<\{[\s\S]*?\}> \{/, 'async function getD1Usage(){')
    .replace(/function flushD1Usage\(waitUntil\?: \([^)]*\) => void\): void/, 'function flushD1Usage(waitUntil)')
    .replace(/const pct = \(used: number, limit: number\)/, 'const pct = (used, limit)');

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
  const seg = src.slice(head, src.indexOf('\n', src.indexOf('function engineOrder')));
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
