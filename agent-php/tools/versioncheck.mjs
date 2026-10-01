#!/usr/bin/env node
/**
 * Keep the version honest.
 *
 * Verifies that APP_VERSION in app/Bootstrap.php matches the newest entry in
 * CHANGELOG.md, that the changelog is in descending semver order, and that no
 * stale version literals are left in the docs.
 *
 *   node tools/versioncheck.mjs
 */
import fs from 'fs';
import path from 'path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const problems = [];

/* ------------------------------------------------ APP_VERSION */
const boot = read('app/Bootstrap.php');
const mv = /const APP_VERSION = '([^']+)';/.exec(boot);
if (!mv) { console.error('✗ APP_VERSION not found in app/Bootstrap.php'); process.exit(1); }
const appVersion = mv[1];

const ma = /const APP_API_VERSION = '([^']+)';/.exec(boot);
const apiVersion = ma ? ma[1] : null;
if (!apiVersion) problems.push('APP_API_VERSION is not defined in app/Bootstrap.php');

/* ------------------------------------------------ CHANGELOG */
const changelog = read('CHANGELOG.md');
const entries = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map(m => m[1]);
if (!entries.length) problems.push('CHANGELOG.md has no "## [x.y.z]" entries');

if (entries.length && entries[0] !== appVersion) {
  problems.push(`APP_VERSION is ${appVersion} but the newest CHANGELOG entry is ${entries[0]}`);
}

const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};
for (let i = 1; i < entries.length; i++) {
  if (cmp(entries[i - 1], entries[i]) <= 0) {
    problems.push(`CHANGELOG order: ${entries[i - 1]} should be newer than ${entries[i]}`);
  }
}

/* ------------------------------------------------ stale literals in docs */
const olderVersions = entries.slice(1);
for (const f of ['README.md', 'DEPLOYMENT.md']) {
  let src;
  try { src = read(f); } catch { continue; }
  for (const old of olderVersions) {
    // a stale version quoted as the app's own version, e.g. "version":"1.0.0"
    const re = new RegExp(`"version"\\s*:\\s*"${old.replace(/\./g, '\\.')}"`);
    if (re.test(src)) problems.push(`${f} still shows "version":"${old}" (current is ${appVersion})`);
  }
}

/* ------------------------------------------------ apiVersion is pinned */
const routes = read('app/Routes.php');
if (/'apiVersion'\s*=>\s*'/.test(routes)) {
  problems.push("app/Routes.php hard-codes 'apiVersion'; use the APP_API_VERSION constant");
}

if (problems.length) {
  problems.forEach(p => console.log('✗ ' + p));
  console.log(`\n${problems.length} versioning problem(s)`);
  process.exit(1);
}
console.log(`✓ version ${appVersion} (API ${apiVersion}) — CHANGELOG has ${entries.length} entries: ${entries.join(', ')}`);
