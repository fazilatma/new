import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

/**
 * Shared background description-enrichment tick (both runtimes): one small
 * batch on one profile per scheduler turn, rotating cursor, stalest-first,
 * global kill-switch + no-model fast skips, and a backoff after an all-failed
 * turn so a down provider is not hammered every minute.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-ai-enrich-'));
await build({ entryPoints: { enrich: new URL('../worker-src/ai-enrich.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { aiEnrichTick, AI_ENRICH_LAST_KEY, AI_ENRICH_BATCH } = await import(pathToFileURL(join(temporary, 'enrich.mjs')));

function makeIo(over = {}) {
  const saved = [];
  const store = { products: { b: [{ id: 'b1' }, { id: 'b2' }], a: [{ id: 'a1' }] } };
  return {
    io: {
      enabled: async () => true,
      modelReady: async () => true,
      listProfileIds: async () => ['b', 'a'],
      loadCursor: async () => over.cursor ?? null,
      saveCursor: async (c) => { saved.push(c); },
      listStalest: async (profileId, limit) => (store.products[profileId] || []).slice(0, limit),
      enrich: async (product) => { product.enriched = true; return { changed: true }; },
      saveProduct: async () => {},
      ...over.io,
    },
    saved,
    store,
  };
}

test('exports the shared cursor key and default batch', () => {
  assert.equal(AI_ENRICH_LAST_KEY, 'ai_enrich_last');
  assert.equal(AI_ENRICH_BATCH, 5);
});

test('first turn starts at the first profile id and enriches the batch', async () => {
  const { io, saved } = makeIo();
  const result = await aiEnrichTick(io);
  assert.equal(result.ran, true);
  assert.equal(result.profileId, 'a');
  assert.equal(result.scanned, 1);
  assert.equal(result.enriched, 1);
  assert.equal(result.failed, 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].profile, 'a');
  assert.ok(saved[0].at);
});

test('cursor rotates to the next profile id and wraps around', async () => {
  const first = makeIo({ cursor: { profile: 'a', at: new Date().toISOString() } });
  assert.equal((await aiEnrichTick(first.io)).profileId, 'b');
  const second = makeIo({ cursor: { profile: 'b', at: new Date().toISOString() } });
  assert.equal((await aiEnrichTick(second.io)).profileId, 'a');
});

test('deleted cursor profile resumes at the next surviving id', async () => {
  const { io } = makeIo({ cursor: { profile: 'a-mid-deleted' } });
  assert.equal((await aiEnrichTick(io)).profileId, 'b');
});

test('disabled switch skips without touching products', async () => {
  let touched = false;
  const { io } = makeIo({ io: { enabled: async () => false, listStalest: async () => { touched = true; return []; } } });
  const result = await aiEnrichTick(io);
  assert.equal(result.ran, false);
  assert.equal(result.skipped, 'disabled');
  assert.equal(touched, false);
});

test('missing chat model skips the scan', async () => {
  const { io } = makeIo({ io: { modelReady: async () => false } });
  const result = await aiEnrichTick(io);
  assert.equal(result.ran, false);
  assert.equal(result.skipped, 'no-model');
});

test('no profiles skips cleanly', async () => {
  const { io } = makeIo({ io: { listProfileIds: async () => [] } });
  const result = await aiEnrichTick(io);
  assert.equal(result.ran, false);
  assert.equal(result.skipped, 'no-profiles');
});

test('unchanged products are not saved', async () => {
  let saves = 0;
  const { io } = makeIo({ io: { enrich: async () => ({ changed: false }), saveProduct: async () => { saves++; } } });
  const result = await aiEnrichTick(io);
  assert.equal(result.enriched, 0);
  assert.equal(saves, 0);
});

test('enrich failures are counted, not thrown', async () => {
  const { io, saved } = makeIo({
    cursor: null,
    io: {
      enrich: async (product) => { if (product.id === 'a1') throw new Error('provider down'); return { changed: true }; },
    },
  });
  const result = await aiEnrichTick(io);
  assert.equal(result.ran, true);
  assert.equal(result.failed, 1);
  assert.equal(result.enriched, 0);
  assert.ok(saved[0].backoffUntil);
});

test('all-failed turn backs off the next turn for ten minutes', async () => {
  const { io } = makeIo({ cursor: { profile: 'a', backoffUntil: new Date(Date.now() + 5 * 60_000).toISOString() } });
  const result = await aiEnrichTick(io);
  assert.equal(result.ran, false);
  assert.equal(result.skipped, 'backoff');
});

test('expired backoff resumes the rotation', async () => {
  const { io } = makeIo({ cursor: { profile: 'a', backoffUntil: new Date(Date.now() - 1000).toISOString() } });
  assert.equal((await aiEnrichTick(io)).profileId, 'b');
});

test('profiles whose own switch is off are skipped in the rotation', async () => {
  const { io } = makeIo({ io: { profileEnabled: async (id) => id !== 'a' } });
  const result = await aiEnrichTick(io);
  assert.equal(result.ran, true);
  assert.equal(result.profileId, 'b');
  assert.equal(result.scanned, 2);
});

test('a disabled cursor profile resumes at the next enabled id', async () => {
  const { io } = makeIo({
    cursor: { profile: 'a', at: new Date().toISOString() },
    io: { profileEnabled: async (id) => id !== 'b' },
  });
  assert.equal((await aiEnrichTick(io)).profileId, 'a');
});

test('an all-disabled fleet terminates with all-disabled', async () => {
  const { io, saved } = makeIo({ io: { profileEnabled: async () => false } });
  const result = await aiEnrichTick(io);
  assert.equal(result.ran, false);
  assert.equal(result.skipped, 'all-disabled');
  assert.equal(saved.length, 1);
});
