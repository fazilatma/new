import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * The shared green-to-candidate decision: after every finished model test run,
 * both runtimes (Worker and Node) call greenTestedCandidateKeys() to decide
 * which tested models become candidates. Only green (ok===true) rows whose
 * model is still configured and chat-compatible qualify; OCR/Embedding
 * specialists, red rows and stale rows never join.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-ai-green-'));
await build({ entryPoints: { catalog: new URL('../worker-src/ai-catalog.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { greenTestedCandidateKeys } = await import(pathToFileURL(join(temporary, 'catalog.mjs')));

const providers = [
  { id: 'p1', name: 'One', baseUrl: 'https://ai.example/v1', models: ['alpha', 'beta', 'ocr-pro'], nonChatModels: ['ocr-pro'] },
  { id: 'p2', name: 'Two', baseUrl: 'https://other.example/v1', models: ['gamma'] },
];

test('green rows become candidate keys', () => {
  assert.deepEqual(greenTestedCandidateKeys([
    { ok: true, key: 'p1::alpha' },
    { ok: true, key: 'p2::gamma' },
  ], providers), ['p1::alpha', 'p2::gamma']);
});

test('red rows, unconfigured models and unknown providers are skipped', () => {
  assert.deepEqual(greenTestedCandidateKeys([
    { ok: false, key: 'p1::alpha' },
    { ok: true, key: 'p1::beta' },
    { ok: true, key: 'p1::retired-model' },
    { ok: true, key: 'ghost::alpha' },
    { ok: true },
    null,
  ], providers), ['p1::beta']);
});

test('non-chat specialists never become candidates', () => {
  assert.deepEqual(greenTestedCandidateKeys([{ ok: true, key: 'p1::ocr-pro' }], providers), []);
});

test('multi-key suffixes collapse to one base key', () => {
  assert.deepEqual(greenTestedCandidateKeys([
    { ok: true, key: 'p1::alpha::k2' },
    { ok: true, key: 'p1::alpha' },
  ], providers), ['p1::alpha']);
});

test('rows without a key fall back to provider plus model', () => {
  assert.deepEqual(greenTestedCandidateKeys([
    { ok: true, provider: 'p2', model: 'gamma' },
    { ok: true, provider: 'p2', model: 'nope' },
  ], providers), ['p2::gamma']);
});

test('missing results are an empty list, not a crash', () => {
  assert.deepEqual(greenTestedCandidateKeys(null, providers), []);
  assert.deepEqual(greenTestedCandidateKeys([], providers), []);
  assert.deepEqual(greenTestedCandidateKeys([{ ok: true, key: 'p1::alpha' }], null), []);
});
