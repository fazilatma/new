import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/**
 * The AI enricher also fixes the product category in Basalam format, in both
 * runtimes: learning first (free), then one AI suggestion against the live
 * taxonomy, remembered for the next product. Enrichment stays gated by the
 * global switch AND the per-profile switch, both defaulting to ON.
 *
 * The generators import live database/network modules, so behavior is pinned
 * through the real compiled pure helper (repo precedent: productNeedsEnrichment
 * in version-sync.test.mjs) and the wiring through source assertions.
 */
const read = (rel) => readFile(new URL(rel, import.meta.url), 'utf8');

function extractPure(source, name) {
  const at = source.indexOf(`function ${name}(product`);
  assert.ok(at > -1, `${name} must exist`);
  const lineEnd = source.indexOf('\n', at);
  const singleLine = source.slice(at, lineEnd);
  const body = singleLine.includes('return') && singleLine.trimEnd().endsWith('}')
    ? singleLine
    : source.slice(at, source.indexOf('\n}', at) + 2);
  const plain = body.replace('(product:any)', '(product)').replace('(product: any)', '(product)').replace('):boolean{', '){').replace('): boolean {', '){');
  return new Function(`${plain}; return ${name};`)();
}

for (const file of ['../worker-src/ai.ts', '../render-src/ai.ts']) {
  test(`${file}: category need is a pure id check`, async () => {
    const needs = extractPure(await read(file), 'productNeedsBasalamCategory');
    assert.equal(needs({ title: 'x' }), true);
    assert.equal(needs({ basalamCategoryId: 0 }), true);
    assert.equal(needs({ basalamCategoryId: 12 }), false);
    assert.equal(needs({ basalamCategoryId: '34' }), false);
  });

  test(`${file}: generator resolves Basalam categories learning-first`, async () => {
    const src = await read(file);
    const gen = src.slice(src.indexOf('export async function generateProductDescription'));
    assert.ok(gen.includes('productNeedsBasalamCategory(product)'), 'the category step must be gated on need');
    assert.ok(gen.includes('categories?:'), 'callers must be able to pass the live taxonomy');
    assert.ok(gen.includes('await findLearnedCategory('), 'learning must come before spending an AI call');
    assert.ok(gen.includes('await suggestCategoryWithModel('), 'misses must ask the picked model');
    assert.ok(gen.includes('await learnCategory('), 'AI answers must be remembered');
    assert.ok(gen.includes("fields.push('basalamCategory')"), 'the new field must be reported');
    assert.ok(gen.includes('product.basalamCategoryId=') || gen.includes('product.basalamCategoryId ='),
      'the numeric Basalam category_id must be stored on the product');
  });
}

for (const [runtime, aiFile, procFile] of [
  ['worker', '../worker-src/ai.ts', '../worker-src/processor.ts'],
  ['node', '../render-src/ai.ts', '../render-src/processor.ts'],
]) {
  test(`${runtime}: missing fields are still never overwritten`, async () => {
    const gen = (await read(aiFile)).slice((await read(aiFile)).indexOf('export async function generateProductDescription'));
    assert.match(gen, /options\.force\s*\|\|\s*need\.shortDesc/);
    assert.match(gen, /options\.force\s*\|\|\s*need\.longDesc/);
    assert.match(gen, /options\.force\s*\|\|\s*need\.variations/);
  });

  test(`${runtime}: job-time enrichment covers category-only gaps`, async () => {
    const proc = await read(procFile);
    assert.ok(proc.includes('productNeedsBasalamCategory(product)'), 'pending must include category-only gaps');
    assert.ok(proc.includes('destinationCategories()'), 'the taxonomy must be fetched once per batch');
    assert.ok(proc.includes('categories:enrichCategories') || proc.includes('categories: enrichCategories'),
      'the taxonomy must reach the generator');
  });

  test(`${runtime}: automatic enrichment honors both switches, defaulting ON`, async () => {
    const proc = await read(procFile);
    assert.match(proc, /aiSettings\?\.enabled\s*!==\s*false\s*&&\s*profile\?\.aiDescriptions\s*!==\s*false/,
      'global AND per-profile switches must gate job-time enrichment');
  });
}

test('both syncs prefer the product-level Basalam category', async () => {
  for (const file of ['../worker-src/sync.ts', '../render-src/sync.ts']) {
    const src = await read(file);
    const productAt = src.indexOf('product.basalamCategoryId');
    const profileAt = src.indexOf('profile.basalamCategoryId');
    assert.ok(productAt > -1 && profileAt > -1, `${file} must resolve both levels`);
    assert.ok(productAt < profileAt, `${file} must try the product category before the profile default`);
  }
});

test('both normalizers keep the per-profile switch default-ON', async () => {
  const worker = await read('../worker-src/app.ts');
  assert.ok(worker.includes('aiDescriptions:raw.aiDescriptions===undefined?true:on(raw.aiDescriptions)'),
    'worker normalizeProfile must default aiDescriptions to true');
  const node = await read('../render-src/server.ts');
  assert.ok(node.includes('aiDescriptions: raw.aiDescriptions!==false'),
    'node normalizeProfile must default aiDescriptions to true');
});

test('the background tick skips switched-off profiles without stalling', async () => {
  const src = await read('../worker-src/ai-enrich.ts');
  assert.ok(src.includes('profileEnabled?(profileId: string)'), 'the tick IO must offer the per-profile check');
  assert.ok(src.includes("skipped: 'all-disabled'"), 'an all-disabled fleet must terminate cleanly');
  for (const file of ['../worker-src/app.ts', '../render-src/server.ts', '../render-src/cron.ts']) {
    const wiring = await read(file);
    assert.ok(wiring.includes('profileEnabled:async id=>(await getProfile(id))?.aiDescriptions!==false'),
      `${file} must wire the per-profile switch into the tick`);
  }
});
