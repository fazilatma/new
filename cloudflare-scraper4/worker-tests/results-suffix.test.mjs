import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// The results tab rendered nothing (with a TypeError notice) whenever ANY
// product lacked a (code...)-style suffix in its title: productSuffixFormats
// was async, but productCodeSuffix used its return value synchronously, so
// formats[0] was undefined and .replace threw for the whole list. The format
// lookup is a pure DOM/state read, so it must stay synchronous.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const dashboard = await readFile(join(ROOT, 'worker-src', 'dashboard.ts'), 'utf8');

function loadSuffixFns() {
  let start = dashboard.indexOf('function productSuffixFormats');
  if (dashboard.slice(start - 6, start) === 'async ') start -= 6;
  const end = dashboard.indexOf('function destinationPrice(');
  assert.ok(start > 0 && end > start, 'the suffix functions must stay adjacent for extraction');
  const factory = new Function(
    'const $ = () => null; const state = { settings: {} };'
    + dashboard.slice(start, end)
    + '; return { productSuffixFormats, productCodeSuffix };',
  );
  return factory();
}

test('results suffix: the format lookup is synchronous, not a Promise', () => {
  assert.ok(!dashboard.includes('async function productSuffixFormats'), 'productSuffixFormats must never be async again');
  const { productSuffixFormats } = loadSuffixFns();
  const formats = productSuffixFormats();
  assert.ok(Array.isArray(formats), 'the caller uses formats[0] synchronously, so it must be an array');
  assert.ok(formats.length > 0 && formats.every((f) => /[xX]/.test(f)), 'every format needs an x placeholder');
});

test('results suffix: a plain product gets a suffix instead of throwing', () => {
  const { productCodeSuffix } = loadSuffixFns();
  assert.equal(productCodeSuffix({ title: 'Shoe A', sourceKey: 'a1', price: 120000 }), '(کد:a1)');
  assert.equal(productCodeSuffix({ title: 'Shoe A (کد 5)', sourceKey: 'a1' }), '(کد 5)', 'an existing title suffix wins');
  assert.equal(productCodeSuffix({ title: 'No code anywhere' }), '', 'a product with no code stays suffix-free');
});
