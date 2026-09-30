#!/usr/bin/env node
/**
 * Parse every .php file under a directory and report syntax errors.
 *
 * This exists because the project is frequently edited on machines that have
 * no PHP binary available. It is not a replacement for `php -l`, but it does
 * catch every parse error.
 *
 *   npm install            (once, in this directory)
 *   node tools/phplint.mjs app bin public
 */
import fs from 'fs';
import path from 'path';
import Engine from 'php-parser';

const roots = process.argv.slice(2);
if (!roots.length) roots.push(path.join(path.dirname(new URL(import.meta.url).pathname), '..'));

const parser = new Engine({ parser: { extractDoc: false, suppressErrors: false }, ast: { withPositions: true } });
const SKIP = new Set(['node_modules', '.git', 'vendor', 'storage', 'data']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, out); }
    else if (e.name.endsWith('.php')) out.push(p);
  }
  return out;
}

let bad = 0;
let files = [];
for (const r of roots) {
  const st = fs.statSync(r);
  files = files.concat(st.isDirectory() ? walk(r) : [r]);
}
for (const f of files) {
  try { parser.parseCode(fs.readFileSync(f, 'utf8'), f); }
  catch (e) { bad++; console.log(`\u2717 ${f}: ${e.message}`); }
}
if (bad) { console.log(`\n${bad} file(s) failed to parse`); process.exit(1); }
console.log(`\u2713 ${files.length} PHP files parsed cleanly`);
