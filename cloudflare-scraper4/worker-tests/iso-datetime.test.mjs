import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * Shared timestamp normalizer: SQLite hands back naive 'YYYY-MM-DD HH:MM:SS'
 * strings (UTC, no suffix) that browsers parse as LOCAL time — in Tehran
 * (UTC+3:30) that puts every job timer 210 minutes in the past and corrupts
 * all speed statistics. isoDateTime tags naive strings with Z; Dates and
 * already-ISO strings pass through untouched.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-iso-datetime-'));
await build({ entryPoints: { utils: new URL('../worker-src/utils.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { isoDateTime } = await import(pathToFileURL(join(temporary, 'utils.mjs')));

test('naive SQLite datetimes become ISO UTC', () => {
  assert.equal(isoDateTime('2026-09-16 12:00:00'), '2026-09-16T12:00:00Z');
});

test('naive datetimes with fractional seconds keep the fraction', () => {
  assert.equal(isoDateTime('2026-09-16 12:00:00.500'), '2026-09-16T12:00:00.500Z');
});

test('naive datetimes without seconds gain :00', () => {
  assert.equal(isoDateTime('2026-09-16 12:00'), '2026-09-16T12:00:00Z');
});

test('Date objects serialize via toISOString', () => {
  assert.equal(isoDateTime(new Date('2026-09-16T12:00:00.000Z')), '2026-09-16T12:00:00.000Z');
});

test('ISO strings pass through untouched', () => {
  assert.equal(isoDateTime('2026-09-16T12:00:00.000Z'), '2026-09-16T12:00:00.000Z');
  assert.equal(isoDateTime('2026-09-16T15:30:00+03:30'), '2026-09-16T15:30:00+03:30');
});

test('empty values map to null', () => {
  assert.equal(isoDateTime(null), null);
  assert.equal(isoDateTime(undefined), null);
  assert.equal(isoDateTime(''), null);
});
