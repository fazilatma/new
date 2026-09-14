import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * End-to-end state machine tests for the Node bulk Basalam category run
 * (render-src/category-run.ts): green-model detection, fail-fast start,
 * multi-page listing, majority voting with early stop, tried-category memory,
 * safe stop/resume, reset and restart recovery. Destination/network modules are
 * stubbed in memory; the run logic itself is the real bundled code.
 */
const harness = globalThis.__categoryHarness = {
  pages: [], states: new Map(), catalogQueries: [],
  suggestCalls: [], votes: {}, gate: null,
  applyCalls: [], applyFailIds: new Set(), tried: new Map(),
  categories: [], categoriesFail: false, providers: [], candidates: [],
};

const stubs = {
  './maintenance.js': `const h=globalThis.__categoryHarness;
    export async function destinationCatalog(target,query){h.catalogQueries.push({target,query:{...query}});const page=h.pages[(query.page||1)-1]||{products:[]},total=h.pages.reduce((n,p)=>n+(p.products||[]).length,0);return{ok:true,target,products:page.products||[],totalPages:h.pages.length||1,total}}
    export async function destinationCategories(){if(h.categoriesFail)throw new Error('توکن باسلام خالی است.');return{items:h.categories,cached:false,updatedAt:new Date().toISOString()}}
    export async function applyBasalamCategory(id,shopId,categoryId,title,categoryName,source){h.applyCalls.push({id,shopId,categoryId,title,categoryName,source});if(h.applyFailIds.has(Number(id)))throw new Error('PATCH failed');return{ok:true,id,shopId,categoryId}}`,
  './connections.js': `export async function loadConnections(){return{woo:{},basalam:{token:'t',vendorId:'10'},ai:{providers:[],candidates:globalThis.__categoryHarness.candidates,model:''}}}`,
  './db.js': `const h=globalThis.__categoryHarness;
    export async function getState(key,fallback){return h.states.has(key)?JSON.parse(h.states.get(key)):fallback}
    export async function setState(key,value){h.states.set(key,JSON.stringify(value))}
    export async function deleteState(key){h.states.delete(key)}
    export async function getTriedBasalamCategories(shopId,id){return h.tried.get(shopId+':'+id)||[]}
    export async function markBasalamCategoriesTried(shopId,id,ids){const key=shopId+':'+id,set=new Set([...(h.tried.get(key)||[]),...ids.map(Number).filter(n=>Number.isInteger(n)&&n>0)]),rows=[...set].slice(-50);h.tried.set(key,rows);return rows}`,
  './ai.js': `const h=globalThis.__categoryHarness;
    export async function aiProviders(){return h.providers}
    export async function suggestCategoryWithModel(title,key){h.suggestCalls.push({title,key});if(h.gate)await h.gate;const scripted=h.votes[key];if(scripted)return{ok:true,key,categoryTitle:title,...scripted};return{ok:false,key,error:'no vote'}}`,
};
const stubPlugin = {
  name: 'category-stubs', setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^\.\/(maintenance|connections|db|ai)\.js$/ }, args => ({ path: args.path, namespace: 'category-stub' }));
    pluginBuild.onLoad({ filter: /.*/, namespace: 'category-stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
  },
};

const temporary = await mkdtemp(join(tmpdir(), 'scraper4-category-run-'));
await build({ entryPoints: { run: new URL('../render-src/category-run.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' }, plugins: [stubPlugin] });
await build({ entryPoints: { catalog: new URL('../worker-src/ai-catalog.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const categoryRun = await import(pathToFileURL(join(temporary, 'run.mjs')));
const { OPENROUTER_NON_CHAT_MODELS } = await import(pathToFileURL(join(temporary, 'catalog.mjs')));

const RUN_KEY = 'background_run:category-all';
const reset = () => {
  harness.pages = []; harness.states.clear(); harness.catalogQueries = [];
  harness.suggestCalls = []; harness.votes = {}; harness.gate = null;
  harness.applyCalls = []; harness.applyFailIds = new Set(); harness.tried = new Map();
  harness.categories = []; harness.categoriesFail = false; harness.providers = []; harness.candidates = [];
};
const setTestResults = rows => harness.states.set('ai_test_results', JSON.stringify({ at: new Date().toISOString(), results: rows }));
const greenProvider = (id, models, extra = {}) => ({ id, name: id, baseUrl: 'https://ai.example', apiKey: 'k', models, enabled: true, ...extra });
async function waitFor(fn, label, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + label);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const waitDone = () => waitFor(async () => {
  const run = await categoryRun.getPublicCategoryRun();
  return run && ['done', 'failed'].includes(run.status) ? run : null;
}, 'run completion');

test('green-model detection prefers candidates, skips red and disabled models, caps at 5', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7']), { ...greenProvider('p2', ['m8']), enabled: false }];
  harness.candidates = ['p1::m3'];
  setTestResults([
    ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'].map(model => ({ ok: true, provider: 'p1', model })),
    { ok: false, provider: 'p1', model: 'm9' },
    { ok: true, provider: 'p2', model: 'm8' },
  ]);
  assert.deepEqual(await categoryRun.successfulCategoryModels(), ['p1::m3', 'p1::m1', 'p1::m2', 'p1::m4', 'p1::m5']);
});

test('provider non-chat lists and the real OpenRouter catalog opt models out', async () => {
  reset();
  const nonChat = OPENROUTER_NON_CHAT_MODELS[0];
  assert.ok(nonChat, 'the real catalog must list a non-chat OpenRouter model');
  harness.providers = [
    greenProvider('p1', ['chat', 'special'], { nonChatModels: ['special'] }),
    greenProvider('openrouter', [nonChat, 'chat-x']),
  ];
  setTestResults([
    { ok: true, provider: 'p1', model: 'chat' }, { ok: true, provider: 'p1', model: 'special' },
    { ok: true, provider: 'openrouter', model: nonChat }, { ok: true, provider: 'openrouter', model: 'chat-x' },
  ]);
  assert.deepEqual(await categoryRun.successfulCategoryModels(), ['p1::chat', 'openrouter::chat-x']);
});

test('starting without green models throws and persists nothing', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1'])];
  setTestResults([{ ok: false, provider: 'p1', model: 'm1' }]);
  await assert.rejects(() => categoryRun.startCategoryRun(), /هیچ مدل موفقی/);
  assert.ok(!harness.states.has(RUN_KEY), 'no run state may be written');
});

test('starting fails fast when the category list is unreachable', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1'])];
  setTestResults([{ ok: true, provider: 'p1', model: 'm1' }]);
  harness.categoriesFail = true;
  await assert.rejects(() => categoryRun.startCategoryRun(), /توکن باسلام/);
  assert.ok(!harness.states.has(RUN_KEY), 'no run state may be written');
});

test('a second start while active returns the existing run', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1'])];
  setTestResults([{ ok: true, provider: 'p1', model: 'm1' }]);
  harness.categories = [{ id: 101, name: 'A', leaf: true }];
  harness.pages = [{ products: [{ id: 1, shopId: '55', title: 'Alpha' }] }];
  harness.votes = { 'p1::m1': { categoryId: 101, categoryName: 'A' } };
  let release;
  harness.gate = new Promise(resolve => { release = resolve; });
  const first = await categoryRun.startCategoryRun();
  assert.equal(first.existing, false);
  const second = await categoryRun.startCategoryRun();
  assert.equal(second.existing, true);
  assert.equal(second.run.id, first.run.id);
  release();
  const done = await waitDone();
  assert.equal(done.processed, 1);
});

test('a full run lists every page, votes with early stop and applies winners', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1', 'm2', 'm3'])];
  setTestResults(['m1', 'm2', 'm3'].map(model => ({ ok: true, provider: 'p1', model })));
  harness.categories = [{ id: 101, name: 'A', leaf: true }, { id: 102, name: 'B', leaf: true }];
  harness.pages = [
    { products: [{ id: 1, shopId: '55', title: 'Alpha' }] },
    { products: [{ id: 2, shopId: '55', title: 'Beta' }] },
  ];
  harness.votes = {
    'p1::m1': { categoryId: 101, categoryName: 'A' },
    'p1::m2': { categoryId: 101, categoryName: 'A' },
    'p1::m3': { categoryId: 102, categoryName: 'B' },
  };
  const { run } = await categoryRun.startCategoryRun();
  assert.deepEqual(run.modelKeys, ['p1::m1', 'p1::m2', 'p1::m3']);
  const done = await waitDone();
  assert.equal(done.status, 'done');
  assert.equal(done.phase, 'finished');
  assert.equal(done.total, 2);
  assert.equal(done.processed, 2, 'every product counts exactly once');
  assert.equal(done.changed, 2);
  assert.equal(done.failed, 0);
  assert.equal(done.cursor, 2);
  // The listing targets unapproved products on every stall.
  assert.deepEqual(harness.catalogQueries.map(x => x.query.page), [1, 2]);
  assert.ok(harness.catalogQueries.every(x => x.target === 'basalam' && x.query.status === '3567' && x.query.shopId === 'all' && x.query.perPage === 100));
  // Majority (2 of 3) stops the vote before the third model is asked.
  assert.ok(harness.suggestCalls.length > 0);
  assert.ok(harness.suggestCalls.every(call => call.key !== 'p1::m3'), 'early stop must skip the remaining model');
  assert.equal(harness.applyCalls.length, 2);
  assert.deepEqual(harness.applyCalls[0], { id: 1, shopId: '55', categoryId: 101, title: 'Alpha', categoryName: 'A', source: 'هوش مصنوعی سرورساید: 2 از 2 مدل' });
  assert.equal(done.items[0].confidence, 100);
  assert.ok(!('products' in done), 'the public run strips the heavy product list');
});

test('a majority matching the stored category confirms it without a PATCH', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1'])];
  setTestResults([{ ok: true, provider: 'p1', model: 'm1' }]);
  harness.categories = [{ id: 101, name: 'A', leaf: true }];
  harness.pages = [{ products: [{ id: 3, shopId: '55', title: 'Gamma', categoryId: 101 }] }];
  harness.votes = { 'p1::m1': { categoryId: 101, categoryName: 'A' } };
  await categoryRun.startCategoryRun();
  const done = await waitDone();
  assert.equal(done.processed, 1);
  assert.equal(done.changed, 0);
  assert.equal(harness.applyCalls.length, 0);
  assert.equal(done.items[0].ok, true);
  assert.match(done.items[0].source, /تأیید شد/);
});

test('a failed PATCH marks the category tried so the next run skips it', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1'])];
  setTestResults([{ ok: true, provider: 'p1', model: 'm1' }]);
  harness.categories = [{ id: 101, name: 'A', leaf: true }];
  harness.pages = [{ products: [{ id: 5, shopId: '55', title: 'Delta' }] }];
  harness.votes = { 'p1::m1': { categoryId: 101, categoryName: 'A' } };
  harness.applyFailIds = new Set([5]);
  await categoryRun.startCategoryRun();
  const done = await waitDone();
  assert.equal(done.failed, 1);
  assert.equal(done.items[0].ok, false);
  assert.match(done.items[0].error, /ثبت شد/);
  assert.deepEqual(harness.tried.get('55:5'), [101]);
});

test('suggestions that were all tried before fail with a convergence message', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1', 'm2'])];
  setTestResults(['m1', 'm2'].map(model => ({ ok: true, provider: 'p1', model })));
  harness.categories = [{ id: 101, name: 'A', leaf: true }, { id: 102, name: 'B', leaf: true }];
  harness.pages = [{ products: [{ id: 6, shopId: '55', title: 'Epsilon' }] }];
  harness.votes = { 'p1::m1': { categoryId: 101, categoryName: 'A' }, 'p1::m2': { categoryId: 102, categoryName: 'B' } };
  harness.tried.set('55:6', [101, 102]);
  await categoryRun.startCategoryRun();
  const done = await waitDone();
  assert.equal(done.failed, 1);
  assert.match(done.items[0].error, /قبلاً برای این محصول امتحان شده‌اند/);
  assert.equal(harness.applyCalls.length, 0);
});

test('stop pauses at the checkpoint and resume finishes the run', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1'])];
  setTestResults([{ ok: true, provider: 'p1', model: 'm1' }]);
  harness.categories = [{ id: 101, name: 'A', leaf: true }];
  harness.pages = [{ products: [1, 2, 3, 4, 5, 6].map(id => ({ id, shopId: '55', title: 'P' + id })) }];
  harness.votes = { 'p1::m1': { categoryId: 101, categoryName: 'A' } };
  let release;
  harness.gate = new Promise(resolve => { release = resolve; });
  await categoryRun.startCategoryRun();
  await waitFor(async () => {
    const run = await categoryRun.getPublicCategoryRun();
    return run && run.status === 'running' && run.phase === 'categorizing' ? run : null;
  }, 'categorizing phase');
  const paused = await categoryRun.controlCategoryRun('stop');
  assert.equal(paused.status, 'paused');
  release();
  await waitFor(async () => {
    const run = await categoryRun.getPublicCategoryRun();
    return run && run.status === 'paused' && run.processed >= 1 ? run : null;
  }, 'drive honoring the stop');
  await new Promise(resolve => setTimeout(resolve, 250));
  const resumed = await categoryRun.controlCategoryRun('resume');
  assert.equal(resumed.status, 'queued');
  assert.equal(resumed.phase, 'categorizing');
  const done = await waitDone();
  assert.equal(done.total, 6);
  assert.equal(done.processed, 6);
  assert.equal(done.changed, 6);
});

test('control guards: unknown run throws, finished runs stay untouched', async () => {
  reset();
  await assert.rejects(() => categoryRun.controlCategoryRun('stop'), /پیدا نشد/);
  harness.providers = [greenProvider('p1', ['m1'])];
  setTestResults([{ ok: true, provider: 'p1', model: 'm1' }]);
  harness.categories = [{ id: 101, name: 'A', leaf: true }];
  harness.pages = [{ products: [] }];
  await categoryRun.startCategoryRun();
  const done = await waitDone();
  assert.equal(done.status, 'done');
  const again = await categoryRun.controlCategoryRun('stop');
  assert.equal(again.status, 'done');
});

test('reset clears the run and recovery resumes queued runs after a restart', async () => {
  reset();
  harness.providers = [greenProvider('p1', ['m1'])];
  setTestResults([{ ok: true, provider: 'p1', model: 'm1' }]);
  harness.categories = [{ id: 101, name: 'A', leaf: true }];
  harness.pages = [{ products: [{ id: 9, shopId: '55', title: 'Zeta' }] }];
  harness.votes = { 'p1::m1': { categoryId: 101, categoryName: 'A' } };
  await categoryRun.startCategoryRun();
  await waitDone();
  await categoryRun.resetCategoryRun();
  assert.equal(await categoryRun.getPublicCategoryRun(), null);
  // A queued run left behind by a killed process resumes on recovery.
  const stamp = new Date().toISOString();
  harness.states.set(RUN_KEY, JSON.stringify({
    id: 'recovered', kind: 'category-all', status: 'queued', phase: 'listing', stopRequested: false,
    createdAt: stamp, updatedAt: stamp, startedAt: null, finishedAt: null, attempts: 0, error: null,
    modelKeys: ['p1::m1'], page: 1, totalPages: 1, products: [], cursor: 0, total: 0, processed: 0, changed: 0, failed: 0, items: [],
  }));
  await categoryRun.recoverCategoryRun();
  const done = await waitDone();
  assert.equal(done.id, 'recovered');
  assert.equal(done.processed, 1);
  // A deliberately paused run is never auto-resumed.
  await categoryRun.resetCategoryRun();
  harness.states.set(RUN_KEY, JSON.stringify({
    id: 'paused-one', kind: 'category-all', status: 'paused', phase: 'paused', stopRequested: true,
    createdAt: stamp, updatedAt: stamp, startedAt: stamp, finishedAt: null, attempts: 0, error: null,
    modelKeys: ['p1::m1'], page: 1, totalPages: 1, products: [], cursor: 0, total: 0, processed: 0, changed: 0, failed: 0, items: [],
  }));
  await categoryRun.recoverCategoryRun();
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await categoryRun.getPublicCategoryRun()).status, 'paused');
});
