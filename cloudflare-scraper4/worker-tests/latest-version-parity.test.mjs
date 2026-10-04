import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('latest PHP/Python parity: extraction master engine is preserved and persisted', async () => {
  const types = await readFile(new URL('../worker-src/types.ts', import.meta.url), 'utf8');
  const app = await readFile(new URL('../worker-src/app.ts', import.meta.url), 'utf8');
  const scraper = await readFile(new URL('../worker-src/scraper.ts', import.meta.url), 'utf8');
  const processor = await readFile(new URL('../worker-src/processor.ts', import.meta.url), 'utf8');

  assert.match(types, /extractionEngineMaster\?: ExtractionEngine/);
  assert.match(app, /fetch_engine_master/);
  assert.match(scraper, /function engineOrder[\s\S]*master/);
  assert.match(processor, /saveProfile[\s\S]*extractionEngineMaster\s*=\s*page\.usedEngine/);
});

test('latest PHP/Python parity: Basalam prices are sent in rial unless already rial', async () => {
  const workerSync = await readFile(new URL('../worker-src/sync.ts', import.meta.url), 'utf8');
  const renderSync = await readFile(new URL('../render-src/sync.ts', import.meta.url), 'utf8');

  for (const source of [workerSync, renderSync]) {
    assert.match(source, /function basalamPrice/);
    assert.match(source, /ریال\|rial\|irr/);
    assert.match(source, /base\*10/);
  }
});
