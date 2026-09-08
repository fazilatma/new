#!/usr/bin/env node
// Single source of truth for the Scraper4 version: package.json "version".
// Every other place that shows a version (dashboard header, changelog footer,
// worker/render fallbacks, wrangler config, install guides, tests) is derived
// from it by this script, so the UI header can never drift again.
//
//   node scripts/sync-version.mjs          rewrite every target with package.json version
//   node scripts/sync-version.mjs --check  verify only; exit 1 when a target drifted
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
const version = String(pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`sync-version: package.json version must be x.y.z, got "${version}"`);
  process.exit(1);
}
const faDigits = '۰۱۲۳۴۵۶۷۸۹';
const toFa = value => String(value).replace(/\d/g, d => faDigits[Number(d)]);
const V = version;
const FA = toFa(version);
const N = String.raw`\d+\.\d+\.\d+`;
const F = String.raw`[۰-۹]+\.[۰-۹]+\.[۰-۹]+`;

// Each rule is anchored on a label so historical changelog entries are never touched.
const rules = [
  { file: 'wrangler.toml', label: 'wrangler WORKER_VERSION', find: new RegExp(String.raw`WORKER_VERSION = "${N}"`, 'g'), to: `WORKER_VERSION = "${V}"` },
  { file: 'worker-src/app.ts', label: 'worker health/version fallback', find: new RegExp(String.raw`WORKER_VERSION\|\|'${N}'`, 'g'), to: `WORKER_VERSION||'${V}'` },
  { file: 'worker-src/ai.ts', label: 'AI user-agent', find: new RegExp(String.raw`Scraper4/${N}`, 'g'), to: `Scraper4/${V}` },
  { file: 'render-src/server.ts', label: 'render package version fallback', find: new RegExp(String.raw`\.version \|\| '${N}'`, 'g'), to: `.version || '${V}'` },
  { file: 'render-src/server.ts', label: 'render npm_package_version fallback', find: new RegExp(String.raw`npm_package_version \|\| '${N}'`, 'g'), to: `npm_package_version || '${V}'` },
  { file: 'worker-src/dashboard.ts', label: 'dashboard header badge', find: new RegExp(String.raw`(<b id="topVersionNum">)${F}(</b>)`, 'g'), to: `$1${FA}$2` },
  { file: 'worker-src/dashboard.ts', label: 'changelog footer (Worker)', find: new RegExp(String.raw`(نسخهٔ فعلی Worker: )${F}`, 'g'), to: `$1${FA}` },
  { file: 'worker-src/dashboard.ts', label: 'changelog footer (current)', find: new RegExp(String.raw`(نسخهٔ فعلی: )${F}`, 'g'), to: `$1${FA}` },
  { file: 'worker-src/dashboard.ts', label: 'faVersion fallback', find: new RegExp(String.raw`(function faVersion\(value\)\{return String\(value\|\|')${N}(')`, 'g'), to: `$1${V}$2` },
  { file: 'worker-src/dashboard.ts', label: 'header version fallback', find: new RegExp(String.raw`(faVersion\(health\.version\|\|')${N}(')`, 'g'), to: `$1${V}$2` },
  { file: 'worker-src/dashboard.ts', label: 'install guide expected version', find: new RegExp(String.raw`(# Expected: )${N}`, 'g'), to: `$1${V}` },
  { file: 'scripts/local-deployer-ui.mjs', label: 'deployer guide expected version', find: new RegExp(String.raw`(# Expected: )${N}`, 'g'), to: `$1${V}` },
  { file: 'scraper4.ts', label: 'header docs expected version', find: new RegExp(String.raw`(# Expected: )${N}`, 'g'), to: `$1${V}` },
  { file: 'scraper4.ts', label: 'header docs health version', find: new RegExp(String.raw`(verify version is )${N}`, 'g'), to: `$1${V}` },
  { file: 'worker-tests/runtime.test.mjs', label: 'runtime test wrangler assertion', find: new RegExp(String.raw`(WORKER_VERSION\\s\*=\\s\*")${N}(")`, 'g'), to: `$1${V}$2` }
];

const drift = [];
const written = new Set();
let matched = 0;

for (const rule of rules) {
  const path = join(projectDir, rule.file);
  let source;
  try { source = readFileSync(path, 'utf8'); } catch { drift.push(`${rule.file}: file is missing`); continue; }
  const hits = source.match(rule.find);
  if (!hits) { drift.push(`${rule.file}: no anchor found for ${rule.label}`); continue; }
  matched += hits.length;
  const next = source.replace(rule.find, rule.to);
  if (next === source) continue;
  if (checkOnly) { drift.push(`${rule.file}: ${rule.label} is not ${V}`); continue; }
  writeFileSync(path, next);
  written.add(rule.file);
  console.log(`updated ${rule.file} (${rule.label})`);
}

if (drift.length) {
  console.error(`version ${checkOnly ? 'check' : 'sync'} FAILED for ${V}:`);
  for (const line of drift) console.error(`  - ${line}`);
  console.error(checkOnly ? 'Run: npm run version:sync' : 'Fix the anchors above and re-run.');
  process.exit(1);
}
console.log(checkOnly
  ? `version OK: ${V} (${FA}) - ${matched} references in sync across ${new Set(rules.map(r => r.file)).size} files`
  : `version synced to ${V} (${FA}) - ${written.size} file(s) rewritten, ${matched} references`);
