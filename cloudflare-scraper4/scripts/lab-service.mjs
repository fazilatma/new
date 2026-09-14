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
check('deployer runs Python auto-extraction', src('scripts/local-deployer-ui.mjs').includes('/api/py/extract') && src('scripts/py-extract-run.mjs').includes('export function pyExtract('));
check('Node structural engine mirrors the Python extractor', src('render-src/scraper.ts').includes('export function structuralProducts(') && src('render-src/scraper.ts').includes("li.product,article[class*='product']") && src('render-src/scraper.ts').includes("name === 'structural'") && src('render-src/server.ts').includes("'heuristic','structural','metadata'"));
check('browser engines rescue rendered HTML structural-then-heuristic', src('render-src/scraper.ts').includes('export function rescueRenderedProducts(') && src('render-src/scraper.ts').includes('rescueRenderedProducts(html, finalUrl, parseProductsFromHtml(html, finalUrl, selectors))') && src('render-src/scraper.ts').includes('browserLayer?:string'));
check('diagnostic names the browser cause and flags deep pages', src('render-src/scraper.ts').includes('browserAvailable') && src('render-src/scraper.ts').includes('مرورگری روی این دستگاه پیدا نشد؛ بدون آن هیچ رندری انجام نمی‌شود') && src('render-src/scraper.ts').includes('بدون پارامتر صفحه') && src('worker-src/scraper.ts').includes('بدون پارامتر صفحه'));
check('network_api engine sniffs XHR/fetch JSON via Playwright', src('render-src/scraper.ts').includes('export function networkApiProducts(') && src('render-src/scraper.ts').includes("page.on('response'") && src('render-src/scraper.ts').includes("name === 'network_api'") && src('render-src/server.ts').includes("'crawlee_playwright','network_api']"));
check('network_api reports capture stats and dumps bodies', src('render-src/scraper.ts').includes('export type NetworkApiStats=') && src('render-src/scraper.ts').includes('SCRAPER4_DUMP_API_DIR') && src('render-src/scraper.ts').includes('walkApiObjects(JSON.parse(raw), baseUrl, out)'));
check('network_api counts failed responses with statuses', src('render-src/scraper.ts').includes('failedResponses++') && src('render-src/scraper.ts').includes('response.status()') && src('render-src/scraper.ts').includes('failedResponses === 0'));
check('poisoned product rows cannot blank the results page', src('worker-src/db.ts').includes('upsertProduct refused a non-object product') && src('render-src/db.ts').includes('upsertProduct refused a non-object product') && src('worker-src/dashboard.ts').includes("(data.products||[]).filter(p=>p&&typeof p==='object')"));
check('network_api drains in-flight bodies and ranks product URLs', src('render-src/scraper.ts').includes('Promise.allSettled(pendingBodies)') && src('render-src/scraper.ts').includes('export function scoreUrl') && src('render-src/scraper.ts').includes('function isJsonish'));
check('zero-product browser runs attach a rendered snapshot', src('render-src/scraper.ts').includes('export function renderedSnapshotFromHtml') && src('render-src/scraper.ts').includes('renderedSnapshot:lastRenderedSnapshot') && src('render-src/scraper.ts').includes('{ snapshot: result.renderedSnapshot }'));
check('blank browser landings retry once, then fail loud', src('render-src/scraper.ts').includes('export function isBlankPageUrl') && src('render-src/scraper.ts').includes('retryResponse') && src('render-src/scraper.ts').includes('صفحهٔ خالی تحویل گرفت'));
check('snappshop real profile is wired (seed + JSON + fixture + test)', src('profiles/snappshop-kitchen-profiles.json').includes('"snappshop-kitchen-real"') && src('migrations/0007_seed_snappshop_real_profile.sql').includes('snappshop-kitchen-real') && existsSync(join(ROOT, 'worker-tests', 'fixtures', 'snappshop-kitchen-plp.html')) && src('worker-tests/snappshop-plp-profile.test.mjs').includes('snp-1784183539'));
check('selector injector is wired (tool + maker + docs + test)', src('tools/selector-injector.js').includes('function run(doc, opts)') && src('tools/selector-injector.js').includes('function synthContainer(') && src('scripts/make-bookmarklet.mjs').includes('tools/selector-injector.js') && existsSync(join(ROOT, 'SELECTOR-INJECTOR-FA.md')) && src('worker-tests/selector-injector.test.mjs').includes('rediscovers the shipped profile'));
check('injector dashboard section serves all environments', src('worker-src/dashboard.ts').includes('data-copy-injector') && src('worker-src/dashboard.ts').includes('s4injectorSrc') && src('worker-src/dashboard.ts').includes('function copyInjectorScript(') && src('worker-src/dashboard.ts').includes("'injector'") && src('render-src/dashboard.ts').includes('../worker-src/dashboard.js'));
check('deploy docs name no dead branch', !/01a02198|01a0765b|01a0803e|01a0813e/.test(src('CLOUDFLARE-WORKER.md') + src('.github/workflows/deploy-cloudflare.yml') + src('deploy-setup/deploy-cloudflare.yml.txt')) && src('CLOUDFLARE-WORKER.md').includes('Production branch') && src('worker-tests/deploy-branch.test.mjs').includes('DEAD_BRANCHES'));
check('changelog folds are balanced siblings', (() => { const t = src('worker-src/dashboard.ts'), s = t.indexOf('<div class="change-list">'), e = t.indexOf('<div id="changesResult"', s), r = t.slice(s, e); const opens = (r.match(/<div\b/g) || []).length, closes = (r.match(/<\/div>/g) || []).length; const r1 = r.indexOf('</details>'), o0 = r.indexOf('<details class="change-older">'); return opens === closes && r1 !== -1 && o0 !== -1 && r1 < o0 && !r.slice(r.indexOf('</details>', o0)).includes('<div class="change-item">'); })());
check('version tab hosts the deployer block, not PHP', src('worker-src/dashboard.ts').includes('deployerEnvHint') && src('worker-src/dashboard.ts').includes('data-copy-install=\\"deployer\\"') && !src('worker-src/dashboard.ts').includes('vcDeployFile'));
check('branches table scans GitHub per environment', src('worker-src/dashboard.ts').includes('scanDeployerBranches') && src('worker-src/dashboard.ts').includes('compareBranchVersions') && src('worker-src/dashboard.ts').includes('api.github.com/repos/fazilatma/new/branches') && src('scripts/local-deployer-ui.mjs').includes("#branches"));

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
