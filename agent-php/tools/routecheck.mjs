#!/usr/bin/env node
/**
 * Cross-check the front end against the router.
 *
 * Extracts every API path the HTML pages call and every route registered in
 * app/Routes.php, then reports:
 *   - client paths with no matching route      (these 404 at runtime)
 *   - client paths matched by path but not method
 *   - routes never called by the UI            (informational)
 *
 *   node tools/routecheck.mjs
 */
import fs from 'fs';
import path from 'path';

const here = path.dirname(new URL(import.meta.url).pathname);
const appRoot = path.join(here, '..');
const pages = ['index.html', 'localai.html', 'chat.html']
  .map(f => path.join(appRoot, 'public', f))
  .filter(fs.existsSync);

/* ---------------------------------------------------- client-side calls */
const calls = new Map();
const add = (p, m) => {
  p = p.split('?')[0].split('#')[0];
  if (!p.startsWith('/')) return;
  if (!p.startsWith('/api') && !['/health', '/metrics', '/docs', '/openapi.json'].includes(p)) return;
  if (!calls.has(p)) calls.set(p, new Set());
  calls.get(p).add(m);
};

for (const f of pages) {
  const src = fs.readFileSync(f, 'utf8');
  // api('/x'), fetch('/x'), fetch(window.apiUrl('/x')), location.href = window.apiUrl('/x')
  const re = /(?:\bapi|\bfetch|\bapiUrl|EventSource)\s*\(\s*(?:window\.apiUrl\(\s*)?(['"`])([^'"`]+)\1/g;
  let m;
  while ((m = re.exec(src))) {
    // Look ahead for an explicit method, but stop at the *next* call so we
    // never attribute a neighbouring request's verb to this one.
    let tail = src.slice(m.index, m.index + 500);
    const nextCall = tail.slice(1).search(/\b(?:await\s+)?(?:api|fetch)\s*\(/);
    if (nextCall !== -1) tail = tail.slice(0, nextCall + 1);
    const mm = /method\s*:\s*['"](\w+)['"]/.exec(tail);
    add(m[2], mm ? mm[1].toUpperCase() : 'GET');
  }
}

/* --------------------------------------------------------- server routes */
const routesSrc = fs.readFileSync(path.join(appRoot, 'app', 'Routes.php'), 'utf8');
const routes = [];
const rr = /\$r->(get|post|put|patch|delete|any)\(\s*'([^']+)'/g;
let r;
while ((r = rr.exec(routesSrc))) routes.push([r[1].toUpperCase(), r[2]]);

// placeholders FIRST, then escape the literal remainder
const toRe = p => {
  const body = p.split(/(\{[A-Za-z_][A-Za-z0-9_]*\*?\})/).map(seg => {
    if (/^\{[A-Za-z_][A-Za-z0-9_]*\*\}$/.test(seg)) return '.+';
    if (/^\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(seg)) return '[^/]+';
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp('^' + body + '$');
};

const norm = p => p.replace(/\$\{[^}]*\}/g, 'X').replace(/\/$/, '') || '/';
const used = new Set();

function match(p, method) {
  let pathHit = false;
  for (const [m, rp] of routes) {
    if (toRe(rp).test(p)) {
      pathHit = true;
      if (m === method || m === 'ANY') { used.add(m + ' ' + rp); return 'ok'; }
    }
  }
  return pathHit ? 'method' : 'none';
}

const problems = [];
for (const [p, methods] of [...calls].sort()) {
  for (const m of methods) {
    // concatenated paths like api('/api/jobs/' + id) end in a slash
    const candidates = [norm(p), norm(p) + '/X'];
    if (candidates.some(c => match(c, m) === 'ok')) continue;
    const res = match(norm(p), m);
    problems.push(`${res === 'none' ? 'NO ROUTE ' : 'NO METHOD'}  ${m.padEnd(6)} ${p}`);
  }
}

console.log(`client paths: ${calls.size}    registered routes: ${routes.length}`);
if (problems.length) {
  console.log(`\n${problems.length} unreachable call(s):`);
  problems.forEach(p => console.log('  ' + p));
} else {
  console.log('\n\u2713 every front-end API call resolves to a registered route');
}

const unused = routes.filter(([m, p]) => !used.has(m + ' ' + p));
if (process.argv.includes('--unused')) {
  console.log(`\n${unused.length} route(s) not called by the bundled UI (CLI/API-only is normal):`);
  unused.forEach(([m, p]) => console.log(`  ${m.padEnd(6)} ${p}`));
}
process.exit(problems.length ? 1 : 0);
