import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { pyExtract, pyStatus } from '../scripts/py-extract-run.mjs';

// Pins the deployer's "Python extract" tab runner (1.143.0): input validation
// that never needs Python, plus fixture-driven extraction through the real
// py-auto-extract.py (skipped when python3+bs4 is unavailable, like the other
// Python cross-checks). Live URLs are never fetched here: the sandbox has no
// outbound network, and the URL path differs from the fixture path only in
// argv (proven over HTTP in the lab instead).
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const FIXTURE = join(ROOT, 'worker-tests', 'fixtures', 'barfbox-cards.html');
const BASE = 'https://barfbox.ir/';
const PY = (() => {
  try {
    const probe = spawnSync('python3', ['-c', 'import bs4'], { encoding: 'utf8' });
    return probe.status === 0;
  } catch { return false; }
})();

test('deployer-py: bad URLs fail validation before any spawn (no Python needed)', () => {
  for (const bad of ['', 'notaurl', 'ftp://x.test/a', 'javascript:alert(1)', 'https://']) {
    const result = pyExtract({ projectDir: ROOT, url: bad });
    assert.equal(result.ok, false, `${JSON.stringify(bad)} must be rejected`);
    assert.match(result.error, /http\(s\)/, `rejection must name http(s), got: ${result.error}`);
  }
  const missing = pyExtract({ projectDir: ROOT, htmlFile: join(ROOT, 'worker-tests', 'fixtures', 'nope.html') });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/);
});

test('deployer-py: malformed selectors JSON fails validation (no Python needed)', () => {
  for (const bad of ['{oops', '["not","object"]', '"str"', '42']) {
    const result = pyExtract({ projectDir: ROOT, url: 'https://shop.test/cat', selectors: bad });
    assert.equal(result.ok, false, `${bad} must be rejected`);
    assert.match(result.error, /JSON object/, `rejection must name the JSON object, got: ${result.error}`);
  }
});

test('deployer-py: pyStatus reports the interpreter and per-module flags', () => {
  const status = pyStatus(ROOT);
  assert.equal(typeof status.hasBs4, 'boolean');
  assert.equal(typeof status.hasLxml, 'boolean');
  assert.equal(typeof status.hasRequests, 'boolean');
  assert.equal(status.scriptExists, true, 'py-auto-extract.py must ship with the repo');
  if (status.python) assert.match(status.version, /^\d+\.\d+/, `version must parse, got: ${status.version}`);
});

test('deployer-py: the runner extracts 12 fixture products with discovery', async (t) => {
  if (!PY) { t.skip('python3+beautifulsoup4 not installed'); return; }
  const result = pyExtract({ projectDir: ROOT, htmlFile: FIXTURE, base: BASE });
  assert.equal(result.ok, true, `fixture run must succeed, got: ${result.error}`);
  assert.equal(result.total, 12, `must extract all 12 cards, got ${result.total}`);
  assert.equal(result.truncated, false);
  assert.equal(result.discovered?.method, 'structural', 'discovery must find the grid');
  assert.equal(result.discovered?.selectors?.container, 'div.p-3.flex', 'discovery must agree on the container');
  assert.ok(result.products.every(p => p.title && p.link), 'every product needs title and link');
  assert.match(String(result.diag?.parser || ''), /lxml|html\.parser/, 'diag must name the parser');
});

test('deployer-py: explicit XPath selectors pass through the runner', async (t) => {
  if (!PY) { t.skip('python3+beautifulsoup4 not installed'); return; }
  const selectors = JSON.stringify({
    container: '//div[@class="flex flex-col gap-2 p-3 bg-white rounded-2xl shadow w-[320px]"]',
    title: '//div[@class="text-[13px] font-bold leading-6"]',
    price: '//span[@class="text-[15px] font-black text-rose-600"]',
    link: '//a[contains(@href, "/product/")]',
    image: '//img'
  });
  const result = pyExtract({ projectDir: ROOT, htmlFile: FIXTURE, base: BASE, selectors });
  assert.equal(result.ok, true, `XPath run must succeed, got: ${result.error}`);
  assert.equal(result.total, 12, `XPath selectors must yield all 12 cards, got ${result.total}`);
});

test('deployer-py: the product cap truncates honestly', async (t) => {
  if (!PY) { t.skip('python3+beautifulsoup4 not installed'); return; }
  const result = pyExtract({ projectDir: ROOT, htmlFile: FIXTURE, base: BASE, limit: 5 });
  assert.equal(result.ok, true, `capped run must succeed, got: ${result.error}`);
  assert.equal(result.products.length, 5, 'must return exactly the cap');
  assert.equal(result.total, 12, 'total must stay honest');
  assert.equal(result.truncated, true, 'truncated flag must be set');
});
