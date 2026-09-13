import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// Pins the 1.152.0 rendered snapshot: zero-product browser runs attach a
// compact fingerprint of what Chromium actually saw, so a pasted diagnostic
// carries the forensics (bot-wall? empty shell? real shop?) with no dump
// files or terminal steps.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-snapshot-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));

const wallHtml = `<!doctype html><html><head><title>Just a moment...</title>
<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1"></script>
<script>window.x = 1;</script></head>
<body><h1>Checking your browser</h1><p>DDoS protection by <a href="/x">Shield</a>.</p>
<img src="/s.gif"><img src="/t.gif"></body></html>`;

test('rendered snapshot: a bot-wall shell fingerprints honestly', () => {
  const snap = render.renderedSnapshotFromHtml(wallHtml);
  assert.equal(snap.title, 'Just a moment...');
  assert.equal(snap.htmlLength, wallHtml.length);
  assert.equal(snap.scripts, 2);
  assert.deepEqual(snap.scriptSrcs, ['/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1']);
  assert.equal(snap.links, 1);
  assert.equal(snap.images, 2);
  assert.ok(snap.textLength > 10, 'visible text must be measured');
  assert.match(snap.textPrefix, /Checking your browser/, 'the text prefix must show the wall');
  assert.doesNotMatch(snap.textPrefix, /window\.x/, 'script bodies must not leak into the text');
});

test('rendered snapshot: Persian text survives, empty input never throws', () => {
  const snap = render.renderedSnapshotFromHtml('<html><head><title>فروشگاه</title></head><body><p>قابلمهٔ گرانیتی می‌شود خرید</p></body></html>');
  assert.equal(snap.title, 'فروشگاه');
  assert.match(snap.textPrefix, /قابلمهٔ گرانیتی می‌شود خرید/, 'ZWNJ words must stay intact');
  for (const bad of ['', null, undefined, 42, '<not html']) {
    const s = render.renderedSnapshotFromHtml(bad);
    assert.equal(typeof s.title, 'string');
    assert.deepEqual(s.scriptSrcs, []);
  }
});

test('rendered snapshot: long pages are capped, not dumped whole', () => {
  const srcs = Array.from({ length: 15 }, (_, i) => `<script src="https://cdn.test/${'s'.repeat(200)}${i}.js"></script>`).join('');
  const snap = render.renderedSnapshotFromHtml(`<html><head><title>${'T'.repeat(300)}</title>${srcs}</head><body><p>${'w '.repeat(1000)}</p></body></html>`);
  assert.equal(snap.title.length, 200);
  assert.ok(snap.textPrefix.length <= 500 && snap.textLength > 500, 'text reports full length but prefixes 500 chars');
  assert.equal(snap.scriptSrcs.length, 10);
  assert.ok(snap.scriptSrcs.every(s => s.length <= 160), 'each src is truncated');
});

test('blank landings: an empty document is detected, never parsed as a shop', () => {
  assert.equal(typeof render.isBlankPageUrl, 'function', 'the blank check must be exported for testing');
  for (const blank of ['', '  ', 'about:blank', 'about:blank#blocked']) assert.equal(render.isBlankPageUrl(blank), true, JSON.stringify(blank) + ' must read as blank');
  for (const landed of ['https://shop.test/x', 'chrome-error://chromewebdata/', 'data:text/html,x']) assert.equal(render.isBlankPageUrl(landed), false, landed + ' must read as landed');
  assert.equal(render.BLANK_RENDER_HTML_MAX, 200, 'the empty-shell cutoff must stay small');
});

test('rendered snapshot: the landing (final URL, HTTP status) rides along', () => {
  const snap = render.renderedSnapshotFromHtml(wallHtml, { finalUrl: 'https://shop.test/wall', httpStatus: 403 });
  assert.equal(snap.finalUrl, 'https://shop.test/wall');
  assert.equal(snap.httpStatus, 403);
  const bare = render.renderedSnapshotFromHtml(wallHtml);
  assert.equal(bare.finalUrl, '');
  assert.equal(bare.httpStatus, 0);
});

test('rendered snapshot: every browser driver reports what it saw', async () => {
  const scraper = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');
  assert.ok(scraper.includes('export function renderedSnapshotFromHtml'), 'the builder must be exported');
  assert.ok(scraper.includes('lastRenderedSnapshot=null;'), 'each run must reset the snapshot');
  assert.equal(scraper.split('lastRenderedSnapshot=renderedSnapshotFromHtml(html,{finalUrl:page.url(),httpStatus:').length - 1, 3, 'all three DOM drivers must snapshot with their landing');
  assert.ok(scraper.includes('renderedSnapshotFromHtml(await page.content(), { finalUrl: page.url(), httpStatus: navStatus })'), 'network_api must snapshot the rendered page with its landing too');
  assert.ok(scraper.includes('renderedSnapshot:lastRenderedSnapshot'), 'the empty result must carry the snapshot');
  assert.ok(scraper.includes('{ snapshot: result.renderedSnapshot }'), 'the diagnostic must surface the snapshot');
});

test('blank landings: drivers retry once, then fail loud with a landing-aware summary', async () => {
  const scraper = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');
  assert.equal(scraper.split('isBlankPageUrl(page.url())').length - 1, 7, 'all four drivers must detect blank landings');
  assert.equal(scraper.split('retryResponse').length - 1, 6, 'the three goto drivers must retry once');
  assert.ok(scraper.includes('به صفحه نرسید'), 'a blank landing after retry must fail loud, in Persian');
  assert.ok(scraper.includes('navStatus'), 'the navigation HTTP status must be captured for forensics');
  assert.ok(scraper.includes('صفحهٔ خالی تحویل گرفت'), 'a rendered-but-empty page must get its own summary');
});
