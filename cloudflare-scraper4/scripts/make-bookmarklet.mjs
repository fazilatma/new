#!/usr/bin/env node
// Builds a bookmarklet URL from tools/selector-injector.js.
// Usage (from cloudflare-scraper4/): node scripts/make-bookmarklet.mjs
// Copy the printed line into a bookmark's URL field, then click it on any shop.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(join(ROOT, 'tools', 'selector-injector.js'), 'utf8');
// Strip the banner comment so the bookmark stays small; the logic is untouched.
const body = src.replace(/^\/\*[\s\S]*?\*\//, '').trim();
const url = 'javascript:' + encodeURIComponent(`(function(){${body}})()`);
process.stdout.write(url + '\n');
console.error(`bookmarklet ready: ${url.length} chars from tools/selector-injector.js`);
