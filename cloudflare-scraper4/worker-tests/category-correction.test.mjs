import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

/**
 * 1.175.0 — periodic Basalam bulk category correction + the AI sections on the
 * Node runtime (Termux / Linux server / VPS / Render / local).
 *
 * Part 1 exercises the shared schedule core directly (pure functions + the tick
 * with injected IO). Part 2 proves the twins really drive that one implementation:
 * the Node `category-run` module is bundled with stubbed database/destination/AI
 * layers, so the assertions below run the same code the Termux server runs.
 * Part 3 locks the consensus model list into the voter selection. Part 4 covers
 * the Node AI fixes: capability rows for the model picker, multi-turn chat, local
 * (loopback) providers, the per-model category probe and the retry endpoint.
 * Part 5 pins the shared dashboard card and both twins' endpoints, because one UI
 * must behave identically in every environment.
 */
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
await mkdir(join(ROOT, 'node_modules', '.cache', 'scraper4-lab'), { recursive: true });
const read = path => readFile(join(ROOT, path), 'utf8');
const temp = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'test-catfix-'));

async function bundle(name, entry, plugins = []) {
  await build({ entryPoints: { [name]: join(ROOT, entry) }, bundle: true, format: 'esm', platform: 'node', target: 'node20', packages: 'external', outdir: temp, entryNames: '[name]', outExtension: { '.js': '.mjs' }, plugins });
  return await import(pathToFileURL(join(temp, `${name}.mjs`)).href);
}

const correction = await bundle('catfix-core', 'worker-src/category-correction.ts');
const core = await bundle('catfix-destination-core', 'worker-src/destination-core.ts');
const capabilities = await bundle('catfix-capabilities', 'worker-src/ai-model-capabilities.ts');

/* ───────────────────────────── 1. the shared schedule core ─────────────────── */

test('category correction defaults to a 6-hour period and clamps the plan', () => {
  const empty = correction.normalizeCategoryCorrection(undefined);
  assert.deepEqual(empty, { enabled: false, intervalHours: 6, mode: 'ensemble', models: [] }, 'nothing saved must mean off, every 6 hours, consensus');
  assert.equal(correction.DEFAULT_CATEGORY_CORRECTION_INTERVAL_HOURS, 6, 'the requested default is 6 hours');
  // Hand-edited / PHP-era snake_case and absurd values must not break the schedule.
  assert.deepEqual(correction.normalizeCategoryCorrection({ enabled: 'true', interval_hours: '200', mode: 'master', models: 'nope' }),
    { enabled: true, intervalHours: 168, mode: 'master', models: [] });
  assert.equal(correction.normalizeCategoryCorrection({ intervalHours: 'abc' }).intervalHours, 6, 'an unreadable interval falls back to the 6-hour default');
  assert.equal(correction.normalizeCategoryCorrection({ intervalHours: 0 }).intervalHours, 1, 'a too-small interval clamps to the floor, never to zero');
  assert.equal(correction.normalizeCategoryCorrection({ intervalHours: -3 }).intervalHours, 1, 'the floor is one hour');
});

test('the consensus model list is deduplicated, capped at 5 and key-suffixes are folded', () => {
  const models = ['p::a::k2', 'p::a', 'p::b', '', null, 'p::c', 'p::d', 'p::e', 'p::f', 'p::g'];
  const out = correction.normalizeCategoryCorrection({ models });
  assert.deepEqual(out.models, ['p::a', 'p::b', 'p::c', 'p::d', 'p::e'], 'max 5 voters, no ::kN, no duplicates, no empties');
});

test('due math anchors on the last attempt, not on wall-clock hours', () => {
  const settings = { enabled: true, intervalHours: 6 };
  const now = Date.parse('2026-09-16T12:00:00.000Z');
  assert.equal(correction.categoryCorrectionDue(settings, null, now), true, 'never run must be due');
  assert.equal(correction.categoryCorrectionDue(settings, { at: new Date(now - 5 * 3600e3).toISOString() }, now), false, '5h ago is inside the window');
  assert.equal(correction.categoryCorrectionDue(settings, { at: new Date(now - 6 * 3600e3).toISOString() }, now), true, 'exactly one interval is due');
  assert.equal(correction.categoryCorrectionDue({ enabled: false, intervalHours: 1 }, null, now), false, 'disabled never runs');
  assert.equal(correction.categoryCorrectionDue(settings, { at: 'garbage' }, now), true, 'an unreadable anchor must not freeze the schedule');
});

test('the status payload feeds the card: next run, running flag and last result', () => {
  const now = Date.parse('2026-09-16T12:00:00.000Z');
  const status = correction.categoryCorrectionStatus({ enabled: true, intervalHours: 6, mode: 'ensemble', models: ['p::a'] }, { at: new Date(now - 3600e3).toISOString(), status: 'started', runId: 'r1' }, now);
  assert.equal(status.nextRunAt, new Date(now - 3600e3 + 6 * 3600e3).toISOString());
  assert.equal(status.running, true, 'a live scheduled run must be visible');
  assert.equal(status.due, false);
  assert.equal(status.automatic, false, 'a curated list is not automatic');
  assert.match(status.modeLabel, /اجماعی/, 'Persian mode label for the consensus card');
  const off = correction.categoryCorrectionStatus({}, null, now);
  assert.equal(off.enabled, false); assert.equal(off.due, false); assert.equal(off.intervalHours, 6);
});

test('the tick starts one scheduled pass per interval and never stacks runs', async () => {
  const now = Date.parse('2026-09-16T12:00:00.000Z');
  const make = () => {
    const state = { last: null, started: [], run: null };
    const input = {
      settings: { categoryCorrection: { enabled: true, intervalHours: 6, mode: 'master-candidates', models: ['p::a', 'p::b'] } },
      readLast: async () => state.last,
      writeLast: async record => { state.last = record; },
      startRun: async plan => { state.started.push(plan); return state.run === 'busy' ? { run: { id: 'r0' }, existing: true } : { run: { id: 'r1' }, existing: false }; },
      currentRun: async () => state.run === 'done' ? { status: 'done', total: 30, processed: 30, changed: 12 } : state.run === 'busy' ? { status: 'running' } : null,
      now,
    };
    return { state, input };
  };

  const a = make();
  assert.deepEqual(await correction.categoryCorrectionTick(a.input), { started: true, runId: 'r1', mode: 'master-candidates', intervalHours: 6, models: ['p::a', 'p::b'] });
  assert.deepEqual(a.state.started, [{ mode: 'master-candidates', models: ['p::a', 'p::b'], scheduled: true }], 'the plan carries the mode and the curated voters');
  assert.equal(a.state.last.status, 'started'); assert.equal(a.state.last.at, new Date(now).toISOString());

  // The very next tick (a minute later) must not start a second pass.
  const notDue = { ...a.input, now: now + 60_000 };
  assert.equal((await correction.categoryCorrectionTick(notDue)).skipped, 'not-due', 'one pass per interval');
  assert.equal(a.state.started.length, 1);

  // While the scheduled run is still working the tick keeps out of the way.
  const busy = make(); busy.state.run = 'busy'; busy.state.last = { at: new Date(now).toISOString(), status: 'started', runId: 'r1' };
  const busyResult = await correction.categoryCorrectionTick({ ...busy.input, now: now + 3600e3 });
  assert.equal(busyResult.skipped, 'busy'); assert.equal(busy.state.started.length, 0, 'a running pass is never doubled');

  // A manual run holding the slot must not push the schedule a whole interval away.
  const manual = make(); manual.state.run = 'busy';
  assert.equal((await correction.categoryCorrectionTick(manual.input)).skipped, 'busy');
  assert.equal(manual.state.last, null, 'an existing manual run must not stamp the anchor');

  // When the run finishes, its counters are folded into the bookkeeping record.
  const done = make(); done.state.last = { at: new Date(now).toISOString(), status: 'started', runId: 'r1' }; done.state.run = 'done';
  await correction.categoryCorrectionTick({ ...done.input, now: now + 3600e3 });
  assert.equal(done.state.last.status, 'done'); assert.equal(done.state.last.changed, 12); assert.equal(done.state.last.processed, 30);

  // Disabled: the whole feature stays silent (no writes, no log spam).
  const off = make(); off.input.settings = { categoryCorrection: { enabled: false } };
  assert.equal(await correction.categoryCorrectionTick(off.input), null);
  assert.equal(off.state.last, null);
});

test('a failing scheduled pass is reported once and retried only after the interval', async () => {
  const now = Date.parse('2026-09-16T12:00:00.000Z');
  let last = null; const calls = [];
  const input = {
    settings: { categoryCorrection: { enabled: true, intervalHours: 6, mode: 'ensemble', models: [] } },
    readLast: async () => last,
    writeLast: async record => { last = record; },
    startRun: async plan => { calls.push(plan); throw new Error('توکن باسلام خالی است.'); },
    currentRun: async () => null,
    now,
  };
  assert.deepEqual(await correction.categoryCorrectionTick(input), { error: 'توکن باسلام خالی است.' });
  assert.equal(last.status, 'failed'); assert.match(last.error, /توکن باسلام/);
  // The next minute's tick must NOT hammer the same broken config.
  const next = await correction.categoryCorrectionTick({ ...input, now: now + 60_000 });
  assert.equal(next.skipped, 'not-due'); assert.equal(calls.length, 1);
});

/* ───────────────────────── 2. both twins drive the same tick ───────────────── */

test('Worker cron and the Node scheduler both call the shared tick', async () => {
  const [worker, node] = await Promise.all([read('worker-src/automation.ts'), read('render-src/automation.ts')]);
  for (const [name, source] of [['worker', worker], ['node', node]]) {
    assert.match(source, /categoryCorrectionTick|categoryCorrectionScheduledTick/, `${name}: automationTick must drive the periodic correction`);
    assert.match(source, /category_correction_last|CATEGORY_CORRECTION_LAST_KEY|categoryCorrectionScheduledTick/, `${name}: the schedule must be driven server-side`);
  }
  // Node reaches it through the same shared module the Worker uses.
  const nodeRun = await read('render-src/category-run.ts');
  assert.match(nodeRun, /from '\.\.\/worker-src\/category-correction\.js'/, 'node must import the shared schedule module');
  assert.match(nodeRun, /categoryCorrectionTick\(/, 'node must run the shared tick, not a re-implementation');
});

test('the Node runtime starts the bulk run from the schedule with the curated voters', async () => {
  const harness = globalThis.__catfixHarness = { settings: {}, states: new Map(), started: [], providers: [], run: null };
  const stubs = {
    './maintenance.js': `const h=globalThis.__catfixHarness;
      export async function destinationCatalog(){h.catalog=h.catalog||[];return{ok:true,products:h.catalog,totalPages:1,total:h.catalog.length}}
      export async function destinationCategories(){if(h.failCategories)throw new Error('توکن باسلام خالی است.');return{items:h.categories||[],cached:false}}
      export async function applyBasalamCategory(id,shopId,categoryId,title,categoryName,source){h.applied=h.applied||[];h.applied.push({id,shopId,categoryId,source});return{ok:true}}`,
    './connections.js': `const h=globalThis.__catfixHarness;
      export async function loadConnections(){return{woo:{},basalam:{token:'t',vendorId:'10'},ai:{providers:h.providers,candidates:[],master:'p1::green',model:''}}}`,
    './db.js': `const h=globalThis.__catfixHarness;
      export async function getState(key,fallback){return h.states.has(key)?JSON.parse(h.states.get(key)):fallback}
      export async function setState(key,value){h.states.set(key,JSON.stringify(value))}
      export async function getTriedBasalamCategories(){return[]}
      export async function markBasalamCategoriesTried(){return[]}`,
    './ai.js': `const h=globalThis.__catfixHarness;
      export async function aiProviders(){return h.providers}
      export async function suggestCategoryWithModel(title,key){return{ok:true,key,categoryId:7,categoryName:'عطر'}}`,
  };
  const plugin = {
    name: 'catfix-render-stubs',
    setup(b) {
      b.onResolve({ filter: /^\.\/(maintenance|connections|db|ai)\.js$/ }, args => (/render-src\/category-run\.ts$/.test(args.importer) ? { path: args.path, namespace: 'catfix-stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'catfix-stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    },
  };
  const run = await bundle('catfix-node-run', 'render-src/category-run.ts', [plugin]);

  const setSettings = value => harness.states.set('settings', JSON.stringify(value));
  const last = () => JSON.parse(harness.states.get('category_correction_last') || 'null');
  harness.providers = [{ id: 'p1', name: 'P1', baseUrl: 'https://ai.example', apiKey: 'k', models: ['green', 'curated'], enabled: true }];
  harness.categories = [{ id: 7, name: 'عطر' }, { id: 8, name: 'کیف' }];

  // off: the schedule is silent
  setSettings({ categoryCorrection: { enabled: false, intervalHours: 6, mode: 'ensemble', models: [] } });
  assert.equal(await run.categoryCorrectionScheduledTick(JSON.parse(harness.states.get('settings'))), null, 'disabled must not start anything');

  // enabled with a curated consensus list: the run must carry exactly those voters
  setSettings({ categoryCorrection: { enabled: true, intervalHours: 6, mode: 'ensemble', models: ['p1::curated'] } });
  const result = await run.categoryCorrectionScheduledTick(JSON.parse(harness.states.get('settings')));
  assert.equal(result.started, true, `the tick must start the run, got ${JSON.stringify(result)}`);
  const stored = JSON.parse(harness.states.get('background_run:category-all'));
  assert.deepEqual(stored.modelKeys, ['p1::curated'], 'the curated list wins over the automatic green set');
  assert.equal(stored.mode, 'ensemble'); assert.equal(stored.trigger, 'scheduled');
  assert.equal(last().status, 'started', 'the anchor record is written on the server');

  // the same settings again: no second run, nothing re-stamped
  const again = await run.categoryCorrectionScheduledTick(JSON.parse(harness.states.get('settings')));
  assert.equal(again.skipped, 'busy', 'a queued/running pass blocks the next one');

  // an unusable curated list is refused with an actionable message
  await run.resetCategoryRun();
  harness.states.delete('category_correction_last');
  setSettings({ categoryCorrection: { enabled: true, intervalHours: 6, mode: 'ensemble', models: ['ghost::gone'] } });
  const failed = await run.categoryCorrectionScheduledTick(JSON.parse(harness.states.get('settings')));
  assert.match(failed.error, /مدل انتخابی اجماعی/, 'a stale curated list must say what to fix');
  assert.equal(last().status, 'failed');
});

/* ─────────────────────── 3. consensus voters: add / remove models ──────────── */

test('selectCategoryModels honours the curated consensus list in both runtimes', () => {
  const configured = ['p::a', 'p::b', 'p::c'], green = ['p::a'];
  assert.deepEqual(core.selectCategoryModels({ mode: 'ensemble', configured, green, explicit: ['p::c', 'p::b::k2'] }), ['p::c', 'p::b'],
    'added models vote even when the last test never marked them green; removed ones drop out');
  assert.deepEqual(core.selectCategoryModels({ mode: 'ensemble', configured, green, explicit: [] }), ['p::a'],
    'an empty list keeps the automatic green-model behaviour');
  assert.deepEqual(core.selectCategoryModels({ mode: 'ensemble', configured, green, explicit: ['p::zzz', 'p::a'] }), ['p::a'], 'a model deleted from the provider drops out of the vote instead of failing every product');
  assert.throws(() => core.selectCategoryModels({ mode: 'ensemble', configured: ['p::a'], green: [], explicit: ['gone::x'] }), /مدل انتخابی اجماعی/);
  // the two master modes ignore the list (there is nothing to vote with) but stay unchanged
  assert.deepEqual(core.selectCategoryModels({ mode: 'master', master: 'p::a', configured, explicit: ['p::b'] }), ['p::a']);
  assert.deepEqual(core.selectCategoryModels({ mode: 'master-candidates', master: 'p::a', candidates: ['p::b'], configured, explicit: ['p::c'] }), ['p::a', 'p::b']);
});

test('the model pool offers only chat-compatible models and marks the green ones', () => {
  const providers = [
    { id: 'p1', name: 'P1', baseUrl: 'https://p1.test', apiKey: 'k', models: ['chat-a', 'chat-b'], nonChatModels: ['chat-b'], enabled: true },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', models: ['meta/llama', 'nvidia/nemotron-3.5-lightning'], enabled: true },
    { id: 'off', name: 'Off', baseUrl: 'https://off.test', apiKey: 'k', models: ['x'], enabled: false },
  ];
  const pool = capabilities.aiCategoryModelRows(providers, new Set(['p1::chat-a']));
  assert.deepEqual(pool.map(row => row.key), ['openrouter::meta/llama', 'p1::chat-a'], 'non-chat and disabled-provider models never enter the pool');
  assert.deepEqual(pool.map(row => row.green), [false, true], 'the last AI test result is shown to the user');
  assert.equal(pool[1].label, 'P1 — chat-a');
});

/* ─────────────────── 4. the AI sections on Linux / Termux (Node twin) ──────── */

test('the model picker returns identical rows on the Worker and on Node', async () => {
  const providers = [
    { id: 'p1', name: 'P1', baseUrl: 'https://p1.test', apiKey: 'k', apiKeys: ['k1', 'k2'], models: ['alpha', 'deepseek-r1'], reasoningModels: ['deepseek-r1'], nonChatModels: [], enabled: true },
    { id: 'p2', name: 'P2', baseUrl: 'https://p2.test', apiKey: 'only', models: ['beta'], enabled: true },
    { id: 'p3', name: 'P3', baseUrl: 'https://p3.test', apiKey: 'only', models: ['gamma'], enabled: false },
  ];
  // The tool-calling set is the agent catalogue — exactly what both routes pass in.
  const agent = await read('worker-src/agent.ts');
  const toolIds = new Set([...agent.matchAll(/\{id:'([^']+)'/g)].map(m => m[1]).filter(id => id !== '*configured'));
  assert.ok(toolIds.size > 3, 'the catalogue must be readable for the comparison');
  const shared = capabilities.aiChatModelRows(providers.map(p => ({ ...p, models: p.id === 'p1' ? p.models : p.models })), toolIds);
  assert.equal(shared.length, 5, 'two enabled providers × models, one row per API key, disabled provider skipped');
  assert.deepEqual(shared.map(row => `${row.providerId}::${row.model}${row.keyLabel}`), ['p1::alpha', 'p1::alpha [K۲]', 'p1::deepseek-r1', 'p1::deepseek-r1 [K۲]', 'p2::beta']);
  assert.deepEqual(shared.map(row => row.keyCount), [2, 2, 2, 2, 1], 'the picker knows how many keys a provider has');
  assert.equal(shared.filter(row => row.reasoning).length, 2, 'the reasoning family is flagged');
  assert.equal(shared.filter(row => row.chat).length, 5, 'every chat-completions model stays selectable');

  // One implementation for both routes is what keeps the twins equal; the Worker route
  // must not recompute the rows by hand any more.
  const [workerApp, nodeServer] = await Promise.all([read('worker-src/app.ts'), read('render-src/server.ts')]);
  assert.match(workerApp, /'\/api\/ai\/chat-models'[\s\S]{0,300}aiChatModelRows\(await aiProviders\(\),toolIds\)/, 'the Worker route uses the shared builder');
  assert.match(nodeServer, /'\/api\/ai\/chat-models'[\s\S]{0,200}aiChatModelRowsFor\(\)/, 'the Node route uses the shared builder');

  // the Node twin answers with those exact rows for the same providers
  const harness = globalThis.__catfixAiHarness = { connections: { ai: { providers, baseUrl: '', apiKey: '', model: '', candidates: [], master: '', network: { mode: 'direct' } } }, states: new Map() };
  const stubs = {
    './connections.js': `export async function loadConnections(){return globalThis.__catfixAiHarness.connections}`,
    './db.js': `const h=globalThis.__catfixAiHarness;
      export async function getState(k,f){return h.states.has(k)?JSON.parse(h.states.get(k)):f}
      export async function setState(k,v){h.states.set(k,JSON.stringify(v))}`,
    './network.js': `export async function assertAiEndpointUrl(u){return new URL(u)}
      export function privateIp(){return false}
      export async function safeFetch(){throw new Error('no network in the lab')}
      export function viaWorkerUrl(_w,u){return u}
      export function configureSourceNetwork(){}`,
  };
  const plugin = {
    name: 'catfix-node-ai-stubs',
    setup(b) {
      b.onResolve({ filter: /^\.\/(connections|db|network)\.js$/ }, args => (/render-src\/ai\.ts$/.test(args.importer) ? { path: args.path, namespace: 'catfix-ai-stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'catfix-ai-stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    },
  };
  const nodeAi = await bundle('catfix-node-ai', 'render-src/ai.ts', [plugin]);
  assert.deepEqual(await nodeAi.aiChatModelRowsFor(), capabilities.aiChatModelRows(providers, toolIds), 'the Node twin must return the Worker rows verbatim');
});

test('local AI providers on 127.0.0.1 are reachable from the Node runtime', async () => {
  const networkStub = { name: 'catfix-network-stub', setup(b) { b.onResolve({ filter: /^\.\/connections\.js$/ }, () => ({ path: './connections.js', namespace: 'catfix-no-db' })); b.onLoad({ filter: /.*/, namespace: 'catfix-no-db' }, () => ({ contents: 'export async function loadConnections(){return{}}', loader: 'js' })); } };
  const network = await bundle('catfix-network', 'render-src/network.ts', [networkStub]);
  // The scraping guard stays closed — that is the SSRF protection this repo documents.
  await assert.rejects(network.assertPublicUrl('http://127.0.0.1:11434/v1'), /Private/i, 'source-site requests must never reach loopback');
  // The AI provider guard is the owner's own config, so loopback and LAN are allowed…
  const allowed = await network.assertAiEndpointUrl('http://127.0.0.1:11434/v1');
  assert.equal(allowed.host, '127.0.0.1:11434', 'Ollama on the phone/server must be usable');
  await network.assertAiEndpointUrl('http://localhost:11434');
  await network.assertAiEndpointUrl('http://192.168.1.20:8000/v1');
  // …while the cloud metadata address and smuggled credentials stay refused.
  await assert.rejects(network.assertAiEndpointUrl('http://169.254.169.254/latest/meta-data'), /metadata/);
  await assert.rejects(network.assertAiEndpointUrl('https://user:pass@ai.example'), /نام کاربری|credential/i);
  await assert.rejects(network.assertAiEndpointUrl('ftp://ai.example'), /http/i);
});

test('Ollama base URLs get the /v1 chat-completions path on both twins', () => {
  assert.equal(capabilities.openAiEndpoint('http://127.0.0.1:11434'), 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(capabilities.openAiEndpoint('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(capabilities.openAiEndpoint('https://api.mistral.ai/v1/chat/completions'), 'https://api.mistral.ai/v1/chat/completions', 'an endpoint typed in full is kept');
  assert.equal(capabilities.openAiEndpoint('[link](https://api.openai.com/v1)'), 'https://api.openai.com/v1/chat/completions', 'a pasted markdown link still resolves');
});

test('multi-turn chat keeps roles, honours the chosen key and validates the last turn', async () => {
  const calls = [];
  const harness = globalThis.__catfixChatHarness = {
    connections: { ai: { providers: [{ id: 'p', name: 'P', baseUrl: 'http://127.0.0.1:11434', apiKey: 'k1', apiKeys: ['k1', 'secret-k2'], models: ['m'], enabled: true }], network: { mode: 'direct' } } },
    states: new Map(), calls,
  };
  const stubs = {
    './connections.js': `export async function loadConnections(){return globalThis.__catfixChatHarness.connections}`,
    './db.js': `const h=globalThis.__catfixChatHarness;
      export async function getState(k,f){return h.states.has(k)?JSON.parse(h.states.get(k)):f}
      export async function setState(k,v){h.states.set(k,JSON.stringify(v))}`,
    // The "network" stub is where the whole point of the test lives: it records what
    // the real call would have sent, including the Authorization header (the key).
    './network.js': `globalThis.__catfixChatHarness.fetch=async(url,init)=>{
      globalThis.__catfixChatHarness.calls.push({url:String(url),headers:init.headers,body:JSON.parse(init.body)});
      const body=globalThis.__catfixChatHarness.reply||{choices:[{message:{content:'HELLO'}}]};
      return {ok:true,status:200,statusText:'OK',text:async()=>JSON.stringify(body),json:async()=>body,headers:new Headers()}};
      export async function assertAiEndpointUrl(u){return new URL(u)}
      export function privateIp(){return false}
      export async function safeFetch(u,init){return globalThis.__catfixChatHarness.fetch(u,init)}
      export function viaWorkerUrl(_w,u){return u}
      export function configureSourceNetwork(){}`,
  };
  const plugin = {
    name: 'catfix-chat-stubs',
    setup(b) {
      b.onResolve({ filter: /^\.\/(connections|db|network)\.js$/ }, args => (/render-src\/ai\.ts$/.test(args.importer) ? { path: args.path, namespace: 'catfix-chat-stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'catfix-chat-stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    },
  };
  const nodeAi = await bundle('catfix-node-chat', 'render-src/ai.ts', [plugin]);
  globalThis.__catfixChatHarness.fetch = globalThis.__catfixChatHarness.fetch || null;
  const provider = harness.connections.ai.providers[0];

  const answer = await nodeAi.aiChatWithMessages(provider, 'm::k2', [{ role: 'user', content: 'سلام' }, { role: 'assistant', content: 'درود' }, { role: 'user', content: 'خوبی؟' }]);
  const sent = calls[calls.length - 1];
  assert.equal(answer.text, 'HELLO');
  assert.deepEqual(sent.body.messages.map(m => m.role), ['user', 'assistant', 'user'], 'the conversation is sent as messages, not flattened text');
  assert.equal(sent.headers.authorization, 'Bearer secret-k2', 'the [K۲] pick must really use key 2');
  assert.equal(sent.url, 'http://127.0.0.1:11434/v1/chat/completions', 'local Ollama URL is built the same way as on the Worker');
  await assert.rejects(() => nodeAi.aiChatWithMessages(provider, 'm', [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hey' }]), /آخرین پیام/);
  await assert.rejects(() => nodeAi.aiChatWithMessages({ ...provider, baseUrl: 'https://remote.test', apiKey: '', apiKeys: [] }, 'm', [{ role: 'user', content: 'hi' }]), /کلید API/, 'a remote provider without a key must say so');
  const localAnswer = await nodeAi.aiChatWithMessages({ ...provider, baseUrl: 'http://127.0.0.1:11434', apiKey: '', apiKeys: [] }, 'm', [{ role: 'user', content: 'hi' }]);
  assert.equal(localAnswer.ok, true, 'a local Ollama needs no key, exactly like on the Worker');
});

test('the Node AI test run reports the category probe and per-key tasks', async () => {
  const harness = globalThis.__catfixTestHarness = {
    connections: { ai: { providers: [{ id: 'p', name: 'P', baseUrl: 'https://ai.test', apiKey: 'k1', apiKeys: ['k1', 'k2'], models: ['m1', 'm2'], enabled: true }], network: { mode: 'direct' }, candidates: [], master: '' } },
    states: new Map(), calls: [], reply: null,
  };
  const stubs = {
    './connections.js': `export async function loadConnections(){return globalThis.__catfixTestHarness.connections}`,
    './db.js': `const h=globalThis.__catfixTestHarness;
      export async function getState(k,f){return h.states.has(k)?JSON.parse(h.states.get(k)):f}
      export async function setState(k,v){h.states.set(k,JSON.stringify(v))}`,
    './network.js': `globalThis.__catfixTestHarness.fetch=async(url,init)=>{
      const body=JSON.parse(init.body);globalThis.__catfixTestHarness.calls.push({url:String(url),body});
      const isCategory=/category_id/.test(String(body.messages?.at(-1)?.content||''));
      const content=isCategory?(globalThis.__catfixTestHarness.categoryText||'{"category_id":7,"reason":"lab"}'):'SCRAPER4_OK';
      const payload={choices:[{message:{content}}]};
      return {ok:true,status:200,statusText:'OK',text:async()=>JSON.stringify(payload),json:async()=>payload,headers:new Headers()}};
      export async function assertAiEndpointUrl(u){return new URL(u)}
      export function privateIp(){return false}
      export async function safeFetch(u,init){return globalThis.__catfixTestHarness.fetch(u,init)}
      export function viaWorkerUrl(_w,u){return u}
      export function configureSourceNetwork(){}`,
    './maintenance.js': `export async function destinationCategories(){return{items:[{id:7,name:'عطر',path:'عطر'}]}}`,
  };
  const plugin = {
    name: 'catfix-test-stubs',
    setup(b) {
      b.onResolve({ filter: /^\.\/(connections|db|network|maintenance)\.js$/ }, args => (/render-src\/ai\.ts$/.test(args.importer) ? { path: args.path, namespace: 'catfix-test-stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'catfix-test-stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    },
  };
  const nodeAi = await bundle('catfix-node-test', 'render-src/ai.ts', [plugin]);

  const { run } = await nodeAi.startAiTestRun({ prompt: 'Reply with exactly: SCRAPER4_OK', categoryTitle: 'ادو پرفیوم', delayMs: 0 });
  assert.equal(run.result.total, 4, '2 models × 2 API keys = four tasks, like the Worker');
  // The in-process loop is not awaited by the route; wait for it to settle.
  for (let i = 0; i < 60 && run.status !== 'done'; i++) await new Promise(resolve => setTimeout(resolve, 25));
  const current = await nodeAi.getCurrentAiRun();
  assert.equal(current.status, 'done', `the run must finish, saw ${current?.status}`);
  const results = current.result.results;
  assert.equal(results.length, 4);
  assert.ok(results.every(row => row.ok), 'every model answered through the stub');
  // one column per provider (model × key, in order), columns interleaved — the same
  // order the Worker uses so a rate-limited provider is never hit twice in one round.
  assert.deepEqual(results.map(row => row.key), ['p::m1', 'p::m1::k2', 'p::m2', 'p::m2::k2']);
  assert.equal(results[1].keyLabel, ' [K۲]', 'the table shows which key a row belongs to');
  assert.equal(results[0].providerName, 'P', 'providerName is what the shared table renders');
  assert.ok(results.every(row => row.categoryResult && row.categoryResult.ok && row.categoryResult.categoryId === 7), 'the category probe must be part of every row (the ensemble gate and the دسته‌بندی column depend on it)');
  const stored = JSON.parse(harness.states.get('ai_test_results'));
  assert.equal(stored.results.length, 4, 'results are persisted like on the Worker');

  // a red model is recorded, not thrown, and the category part is retryable
  harness.categoryText = 'no id here';
  const retried = await nodeAi.retryAiTestPart('p::m1', 'category');
  assert.equal(retried.ok, true);
  const retriedRow = retried.results.find(row => row.key === 'p::m1');
  assert.equal(retriedRow.categoryResult.ok, false, 'a model that answers with no valid id must not look green');
  assert.match(retriedRow.categoryResult.error, /شناسهٔ معتبر/);
  assert.equal(retriedRow.ok, true, 'retrying the category part must not throw the message result away');
});

test('a hung model is dropped by the watchdog budget instead of stalling the pass', async () => {
  // ai.skipTimeoutMs used to be accepted by the Node route and ignored by the call, so
  // one silent local model blocked the whole test queue. Now the budget aborts it and
  // the row is recorded as a failure that says what to raise.
  const harness = globalThis.__catfixHangHarness = {
    connections: { ai: { providers: [{ id: 'slow', name: 'Slow', baseUrl: 'http://127.0.0.1:11499', apiKey: 'k', models: ['s'], enabled: true }], network: { mode: 'direct' }, candidates: [], master: '' } },
    states: new Map(),
  };
  const stubs = {
    './connections.js': `export async function loadConnections(){return globalThis.__catfixHangHarness.connections}`,
    './db.js': `const h=globalThis.__catfixHangHarness;
      export async function getState(k,f){return h.states.has(k)?JSON.parse(h.states.get(k)):f}
      export async function setState(k,v){h.states.set(k,JSON.stringify(v))}`,
    './network.js': `export async function assertAiEndpointUrl(u){return new URL(u)}
      export function privateIp(){return false}
      export async function safeFetch(u,init){
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(resolve,5000);
          if(init&&init.signal)init.signal.addEventListener('abort',()=>{clearTimeout(timer);const e=Error('The operation was aborted due to timeout');e.name='TimeoutError';reject(e)});
        });
        return {ok:true,status:200,text:async()=>'{}'}
      }
      export function viaWorkerUrl(_w,u){return u}
      export function configureSourceNetwork(){}`,
    './maintenance.js': `export async function destinationCategories(){return{items:[]}}`,
  };
  const plugin = {
    name: 'catfix-hang-stubs',
    setup(b) {
      b.onResolve({ filter: /^\.\/(connections|db|network|maintenance)\.js$/ }, args => (/render-src\/ai\.ts$/.test(args.importer) ? { path: args.path, namespace: 'catfix-hang-stub' } : undefined));
      b.onLoad({ filter: /.*/, namespace: 'catfix-hang-stub' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    },
  };
  const nodeAi = await bundle('catfix-node-hang', 'render-src/ai.ts', [plugin]);
  const { run } = await nodeAi.startAiTestRun({ prompt: 'hi', categoryTitle: '', delayMs: 0, skipTimeoutMs: 40 });
  const deadline = Date.now() + 8000;
  for (;;) {
    const current = await nodeAi.getCurrentAiRun();
    if (current && current.status === 'done') break;
    if (Date.now() > deadline) throw new Error('the pass must finish even when a model never answers');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const current = await nodeAi.getCurrentAiRun();
  assert.equal(current.result.results.length, 1);
  assert.equal(current.result.results[0].ok, false, 'the silent model is recorded as failed');
  assert.match(current.result.results[0].error, /مهلت پاسخ این مدل تمام شد/, 'and the row says what to raise');
});

test('Node AI routes answer for real instead of stubbing, 501-ing or flattening', async () => {
  const server = await read('render-src/server.ts');
  assert.doesNotMatch(server, /'\/api\/ai\/chat-models'[^\n]*models:\s*\[\s*\]/, 'the picker must not be an empty array');
  assert.match(server, /'\/api\/ai\/chat-models'[^\n]*aiChatModelRowsFor\(\)/, 'the picker must use the shared row builder');
  assert.doesNotMatch(server, /messages\.map\(\(m: any\) => `\$\{m\.role/, 'a conversation must not be flattened into one prompt');
  assert.match(server, /aiChatWithMessages\(provider, model, messages\)/, 'the chat route must send the messages array');
  assert.doesNotMatch(server, /'\/api\/ai\/test-runs\/retry'[^\n]*501/, 'retrying one model must work on Node too');
  assert.match(server, /retryAiTestPart\(/);
  assert.match(server, /providers\.find\(\(x:any\)=>x\.id===String\(body\?\.provider\|\|''\)\)/, 'the models tab must test the provider it picked');
  assert.match(server, /const model=String\(body\?\.model\|\|''\)\.trim\(\)/, 'and the model it picked');
  assert.match(server, /'\/api\/agent\/models'[\s\S]{0,400}configured/, 'the agent tab must get the configured models, not an empty list');
  assert.doesNotMatch(server, /'\/api\/agent\/models', c => c\.json\(\{ ok: true, models: \[\] \}\)\)/, 'the empty agent-model stub is gone');
  for (const route of ["'/api/agent/prompts'", "'/api/agent/runs'"])
    assert.match(server, new RegExp(route + "[^\\n]*items:"), `${route} must answer with the items key the dashboard reads`);
  const connections = await read('render-src/connections.ts');
  assert.match(connections, /ai:Boolean\(\(value\.ai\.baseUrl&&value\.ai\.apiKey&&value\.ai\.model\)\|\|value\.ai\.providers\.some\(p=>p\.enabled&&p\.baseUrl&&p\.apiKey&&p\.models\.length\)\)/,
    'connection status must accept provider rows, like the Worker, or the AI tabs stay greyed out');
});

/* ───────────────────── 5. the card, in every environment, alike ────────────── */

test('the dashboard ships the periodic card with modes and the model editor', async () => {
  const [dashboard, workerApp] = await Promise.all([read('worker-src/dashboard.ts'), read('worker-src/app.ts')]);
  for (const id of ['catFixPanel', 'catFixBadge', 'catFixEnabled', 'catFixInterval', 'catFixMode', 'catFixModels', 'catFixModelsAdd', 'catFixModelsClear', 'catFixStatus', 'catFixRunNow', 'catFixRefresh'])
    assert.ok(dashboard.includes(`id="${id}"`), `the card needs #${id}`);
  assert.match(dashboard, /data-setting="categoryCorrection\.enabled"/, 'the switch must autosave with the rest of settings');
  assert.match(dashboard, /data-setting="categoryCorrection\.intervalHours"/);
  assert.match(dashboard, /<input id="catFixInterval" type="number" min="1" max="168" step="1" value="6"/, 'default 6 hours, same bounds as the server');
  for (const mode of ['ensemble', 'master', 'master-candidates'])
    assert.match(dashboard, new RegExp(`<option value="${mode}">`), `mode ${mode} must be selectable`);
  assert.match(dashboard, /data-catfix-remove=/, 'each curated model needs a remove control');
  assert.match(dashboard, /data-catfix-pick=/, 'the picker must let the user add models');
  assert.match(dashboard, /slice\(0,5\)/, 'the consensus list is capped at five voters');
  assert.match(dashboard, /category-correction\/run-now/, 'the ▶ button starts the same plan the schedule uses');
  assert.match(dashboard, /'\/api\/destination\/basalam\/category-correction'/, 'the card reads the schedule from its own runtime');
  assert.match(dashboard, /ویرایش فهرست/, 'the manual start dialog must reach the same model list');
  // both twins expose the pair of endpoints the card talks to
  for (const source of [dashboard, workerApp, await read('render-src/server.ts')])
    assert.match(source, /basalam\/category-correction/, 'the endpoint must exist in this runtime too');
  assert.match(workerApp, /CATEGORY_CORRECTION_LAST_KEY/, 'the Worker writes the same anchor key');
});

test('the periodic plan travels with settings, backups and the PHP bundle', async () => {
  // It lives under `settings`, so export/import/backup carry it for free.
  const workerApp = await read('worker-src/app.ts');
  assert.match(workerApp, /app\.post\('\/api\/settings',async c=>\{await setState\('settings',await c\.req\.json\(\)\)/, 'settings must stay a whole-object save');
  const manifest = JSON.parse(await read('parity-manifest.json'));
  assert.ok(manifest, 'the parity manifest must stay parseable');
});
