#!/usr/bin/env node
// lab-service.mjs
// ---------------------------------------------------------------------------
// Service lab: offline verification of the deployer + scraper service files.
// While lab-probe.mjs covers the extraction engines, this script covers the
// machinery around them — deployer syntax and guards, build freshness,
// version wiring and the browser-engine gate. Fast (<5s) and fully offline;
// the full `npm test` gate remains the final word.
//
// Usage (from cloudflare-scraper4/):
//   node scripts/lab-service.mjs
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const src = rel => readFileSync(join(ROOT, rel), 'utf8');
const nodeCheck = rel => {
  const r = spawnSync(process.execPath, ['--check', join(ROOT, rel)], { encoding: 'utf8' });
  return r.status === 0 ? '' : String(r.stderr || r.stdout || 'syntax error').split('\n')[0];
};

// 1. Deployer parses.
const deployerErr = nodeCheck('scripts/local-deployer-ui.mjs');
check('deployer parses (node --check)', !deployerErr, deployerErr);

// 2. Deployer/service guards every release must keep.
const deployer = src('scripts/local-deployer-ui.mjs');
check('deployer frees a stale scraper port', deployer.includes('freeScraperPort'));
check('deployer installs are Termux-aware', deployer.includes('npmInstallArgs'));
check('scraper self-update is Termux-aware', src('render-src/server.ts').includes('--ignore-scripts'));
check('benchmark gates browsers on availability', src('render-src/server.ts').includes('!browserEngineAvailable()&&BROWSER_ENGINES.has(engine)') && !src('render-src/server.ts').includes('BROWSER_ENGINES_UNAVAILABLE'));
const deployerSrc = src('scripts/local-deployer-ui.mjs');
check('deployer detects stale serving builds', deployerSrc.includes('function probeServingVersion(') && deployerSrc.includes('serving: servingState()') && deployerSrc.includes('/api/scraper/restart'));
check('scraper reports boot identity', src('render-src/server.ts').includes('const BOOT_HEAD') && src('render-src/server.ts').includes('head: BOOT_HEAD'));
check('deployer sweeps blind ports and retries EADDRINUSE once', deployer.includes('function portScanSummary(') && deployer.includes('DEPLOYER_PORT_SCAN_BLIND') && deployer.includes('retrying once') && deployer.includes('pkill -f render-dist/server'));
check('selector engines tag invalid selectors and read bare prices', src('render-src/scraper.ts').includes('function invalidSelectorError(') && src('render-src/scraper.ts').includes('function heuristicPriceText(') && src('worker-src/scraper.ts').includes('function heuristicPriceText(') && src('worker-src/scraper.ts').includes('function invalidSelectorMessage('));
check('pasted XPath converts, 429s retry and benchmarks reset the page cursor', src('render-src/scraper.ts').includes('function xpathToCss(') && src('worker-src/scraper.ts').includes('function xpathToCss(') && src('render-src/network.ts').includes('function retryAfterMs(') && src('worker-src/network.ts').includes('function retryAfterMs(') && src('render-src/scraper.ts').includes('function benchmarkProbeUrl(') && src('worker-src/scraper.ts').includes('function benchmarkProbeUrl('));
check('browser renders can be dumped for selector forensics', src('render-src/scraper.ts').includes('SCRAPER4_DUMP_RENDERED_DIR') && src('render-src/scraper.ts').includes('function dumpRenderedHtml('));

// 3. Render build exists and is newer than its sources.
const distServer = join(ROOT, 'render-dist', 'server.js');
if (!existsSync(distServer)) {
  check('render build is fresh', false, 'render-dist/server.js missing — run npm run render:build');
} else {
  const built = statSync(distServer).mtimeMs;
  const newestSrc = Math.max(...readdirSync(join(ROOT, 'render-src')).filter(f => f.endsWith('.ts')).map(f => statSync(join(ROOT, 'render-src', f)).mtimeMs));
  check('render build is fresh', built >= newestSrc, built >= newestSrc ? '' : 'render-src is newer — run npm run render:build');
}

// 4. Committed worker bundle carries the current version.
const version = JSON.parse(src('package.json')).version;
const bundleOk = existsSync(join(ROOT, 'scraper4.worker.js')) && src('scraper4.worker.js').includes(version);
check('worker bundle matches package.json version', bundleOk, bundleOk ? version : 'run npm run worker:build and commit scraper4.worker.js');

// 5. Version wiring.
const vc = spawnSync(process.execPath, [join(ROOT, 'scripts', 'sync-version.mjs'), '--check'], { encoding: 'utf8' });
check('version references are in sync', vc.status === 0, vc.status === 0 ? version : 'run npm run version:sync');

// 6. Lab assets present.
const fixtures = existsSync(join(ROOT, 'worker-tests', 'fixtures')) ? readdirSync(join(ROOT, 'worker-tests', 'fixtures')).filter(f => f.endsWith('.html')) : [];
check('engine lab assets present', existsSync(join(ROOT, 'scripts', 'lab-probe.mjs')) && existsSync(join(ROOT, 'LAB.md')) && fixtures.length >= 7, `${fixtures.length} fixtures`);

const failed = results.filter(r => !r.ok);
console.log(`lab-service: ${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
