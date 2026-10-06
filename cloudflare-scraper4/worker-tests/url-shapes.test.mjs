// A Persian source URL must reach the site byte-for-byte as the user wrote it, and pagination
// must never silently re-encode the search term. Reproduces the emalls.ir case offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const temp = await mkdtemp(join(root, 'node_modules/.cache/url-shapes-'));
async function load(entry, outfile) {
  await build({ entryPoints: [join(root, entry)], outfile: join(temp, outfile), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(join(temp, outfile)));
}
const u = await load('worker-src/url-shapes.ts', 'url-shapes.mjs');

const PERSIAN_QUERY = 'https://emalls.ir/Search?q=' + encodeURIComponent('کفش زنانه') + '&cat=a/b&tag=x,y&page=1';

test('adding a page number never re-encodes the rest of the query', () => {
  const next = u.setQueryParam(PERSIAN_QUERY, 'page', '2');
  assert.ok(next.includes('q=' + encodeURIComponent('کفش زنانه')), 'the Persian term keeps its %20 spelling');
  assert.ok(next.includes('cat=a/b'), 'an unrelated slash is not turned into %2F');
  assert.ok(next.includes('tag=x,y'), 'an unrelated comma is not turned into %2C');
  assert.ok(next.endsWith('page=2'));
  // What the old URLSearchParams.set() path did, kept here as the contrast that caused 403s.
  const legacy = new URL(PERSIAN_QUERY);
  legacy.searchParams.set('page', '2');
  assert.notEqual(legacy.href, next, 'URLSearchParams rewrites the whole query — that is the bug');
  assert.ok(legacy.search.includes('+') && legacy.search.includes('%2F'));
});

test('a missing parameter is appended, a repeated one is collapsed, order is kept', () => {
  assert.equal(u.setQueryParam('https://emalls.ir/list', 'page', '3'), 'https://emalls.ir/list?page=3');
  assert.equal(u.setQueryParam('https://emalls.ir/list?page=1&page=9&x=1', 'page', '4'), 'https://emalls.ir/list?page=4&x=1');
  assert.equal(u.setQueryParam('https://emalls.ir/list?x=1#frag', 'page', '2'), 'https://emalls.ir/list?x=1&page=2#frag');
  assert.equal(u.readQueryParam(PERSIAN_QUERY, 'q'), 'کفش زنانه');
  assert.equal(u.readQueryParam('https://emalls.ir/list?q=a+b', 'q'), 'a b');
  assert.equal(u.deleteQueryParams('https://emalls.ir/list?page=2&q=x&paged=3', ['page', 'paged']), 'https://emalls.ir/list?q=x');
});

test('shapeUrl offers the equivalent spellings a different client would send', () => {
  const withSpace = 'https://emalls.ir/Search?q=' + encodeURIComponent('کفش زنانه');
  assert.ok(u.shapeUrl(withSpace, 'plus-space').includes('+'), 'ASP.NET style spaces');
  assert.equal(u.shapeUrl(u.shapeUrl(withSpace, 'plus-space'), 'space-20'), withSpace, 'the two space shapes are inverses');
  assert.equal(u.shapeUrl(withSpace, 'canonical'), withSpace);
  const lower = u.shapeUrl(withSpace, 'lower-escapes');
  assert.equal(lower, lower.toLowerCase().replace('emalls.ir/search', 'emalls.ir/Search'), 'only the escapes change case');
  assert.notEqual(lower, withSpace);
  // Pasting an already-encoded address encodes it twice; one decode layer repairs it.
  const twice = 'https://emalls.ir/' + encodeURIComponent(encodeURIComponent('جستجو'));
  assert.equal(u.doubleEncoded(twice), true);
  assert.equal(u.shapeUrl(twice, 'unescape-once'), 'https://emalls.ir/' + encodeURIComponent('جستجو'));
  assert.equal(u.shapeUrl(withSpace, 'unescape-once'), withSpace, 'a healthy URL is never decoded');
  assert.equal(new URL(u.shapeUrl(withSpace, 'plus-space')).href, u.shapeUrl(withSpace, 'plus-space'), 'every shape survives URL parsing unchanged');
});

test('the encoding doctor explains in Persian what is unusual about a URL', () => {
  const notes = u.urlEncodingNotes('https://emalls.ir/' + encodeURIComponent(encodeURIComponent('جستجو')));
  assert.ok(notes.some(note => note.includes('دوبار رمزگذاری')));
  assert.ok(u.urlEncodingNotes('https://emalls.ir/جستجو').some(note => note.includes('غیرانگلیسی')));
  assert.ok(u.urlEncodingNotes('https://emalls.ir/s?q=a%20b').some(note => note.includes('%20')));
  assert.deepEqual(u.urlEncodingNotes('https://emalls.ir/plain/list?page=2'), [], 'a plain ASCII URL has nothing to report');
});

test.after(() => rm(temp, { recursive: true, force: true }));
