import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

// One browser at a time, no phantom browsers, no storage litter: concurrent
// operations (diagnostic + benchmark, a retry on a slow run, two open tabs)
// used to pile up full Chromiums until a small VPS OOM-killed the server
// mid-request — the crash that only happens where browsers launch. The pick()
// gate covers every caller (diagnostic, benchmark, runs, processor) because
// all browser engines funnel through it.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(ROOT, 'package.json'));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const rtmp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-browser-slot-'));
await build({ entryPoints: { scraper: join(ROOT, 'render-src', 'scraper.ts') }, bundle: true, format: 'cjs', platform: 'node', target: 'node22', packages: 'external', outdir: rtmp, entryNames: '[name]', outExtension: { '.js': '.cjs' } });
const render = require(join(rtmp, 'scraper.cjs'));
const scraper = await readFile(join(ROOT, 'render-src', 'scraper.ts'), 'utf8');

test('browser slot: concurrent tasks run one at a time, in order', async () => {
  const order = [];
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });
  const first = render.withBrowserSlot(async () => { order.push('first-start'); await gate; order.push('first-end'); return 'a'; });
  const second = render.withBrowserSlot(async () => { order.push('second-start'); return 'b'; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(order, ['first-start'], 'the second task must wait while the first holds the slot');
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ['a', 'b']);
  assert.deepEqual(order, ['first-start', 'first-end', 'second-start'], 'the slot must pass to the waiter in order');
});

test('browser slot: a throwing task still releases the slot', async () => {
  await assert.rejects(render.withBrowserSlot(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await render.withBrowserSlot(async () => 'next'), 'next', 'the mutex must not deadlock after a failure');
});

test('browser slot: all four browser engines funnel through the mutex', () => {
  for (const engine of ['scrapeListWithPlaywright(url, activeSelectors)', 'scrapeListWithPuppeteer(url, activeSelectors)', 'scrapeListWithCrawleePlaywright(url, activeSelectors)', 'scrapeListWithNetworkApi(url)']) {
    assert.ok(scraper.includes(`withBrowserSlot(() => ${engine})`), `${engine} must run inside the browser slot`);
  }
  assert.equal(scraper.split('withBrowserSlot(() =>').length - 1, 4, 'exactly the four browser engines may hold the slot');
});

test('browser availability: an empty cache dir is not a browser', async () => {
  const home = await mkdtemp(join(rtmp, 'home-'));
  await mkdir(join(home, '.cache', 'ms-playwright', 'chromium-1200'), { recursive: true });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home; delete process.env.USERPROFILE;
  try {
    assert.equal(render.browserEngineAvailable(), false, 'a stale cache dir from a failed download must report unavailable');
    await writeFile(join(home, '.cache', 'ms-playwright', 'chromium-1200', 'chrome'), 'fake-binary');
    assert.equal(render.browserEngineAvailable(), true, 'a cache with a real binary keeps reporting available');
  } finally {
    if (saved.HOME === undefined) delete process.env.HOME; else process.env.HOME = saved.HOME;
    if (saved.USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = saved.USERPROFILE;
  }
});

test('crawlee: one-page crawl returns products without a per-run dataset', () => {
  assert.ok(!scraper.includes('Dataset.open'), 'no per-run Dataset storage may be opened');
  assert.ok(scraper.includes('found = rescued.products;'), 'the single page must ride home in a closure variable');
});
