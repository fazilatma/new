import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

/**
 * Every AI model dropdown is searchable and marks test-green models: the
 * master combo, the active-model select, the candidate/single provider-bound
 * selects, the agent and chat selects, and the consensus picker all render a
 * filter box over their (hidden) bound select, and models whose last test row
 * was ok carry a green mark. Only network and timers are stubbed.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-model-combos-'));
await build({ entryPoints: { dashboard: new URL('../worker-src/dashboard.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')));

const providers = [
  { id: 'p1', name: 'Provider One', baseUrl: 'https://ai.example', apiKey: 'k', models: ['alpha', 'beta'], enabled: true },
  { id: 'p2', name: 'Provider Two', baseUrl: 'https://ai.example', apiKey: 'k', models: ['gamma'], enabled: true },
];
let connections = { ai: { providers, candidates: [], master: '', model: '' }, woo: {}, basalam: { shops: [] } };
const postedBodies = [];
const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://combo.test'), method = String(init.method || 'GET').toUpperCase();
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  if (url.pathname === '/api/connections' && method === 'POST') { postedBodies.push(JSON.parse(String(init.body || '{}'))); connections = postedBodies[postedBodies.length - 1]; return json({ ok: true, connections }); }
  if (url.pathname === '/api/connections') return json({ ok: true, connections });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [] });
  if (url.pathname === '/api/status') return json({ ok: true, version: '1.177.0', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '1.177.0', databaseReady: true });
  if (url.pathname === '/api/settings') return json({ ok: true, settings: {} });
  if (url.pathname === '/api/jobs') return json({ ok: true, jobs: [] });
  if (url.pathname === '/api/ai/test-runs/current' || url.pathname === '/api/destination/basalam/category-runs/current') return json({ ok: true, run: null });
  if (url.pathname === '/api/import/history') return json({ ok: true, items: [] });
  if (url.pathname === '/api/runtime/libraries') return json({ ok: true, libraries: [] });
  if (url.pathname === '/api/ai/test-results') return json({ ok: true, results: [{ ok: true, key: 'p1::beta', provider: 'p1', model: 'beta' }, { ok: false, key: 'p1::alpha', provider: 'p1', model: 'alpha' }] });
  return json({ ok: true });
};

const { window } = parseHTML(DASHBOARD);
const store = new Map();
const localStorage = { getItem: key => (store.has(key) ? store.get(key) : null), setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key), clear: () => store.clear() };
for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location || { pathname: '/' }, history: window.history, HTMLElement: window.HTMLElement, HTMLSelectElement: window.HTMLSelectElement, Event: window.Event, CustomEvent: window.CustomEvent, localStorage, alert: () => {}, confirm: () => true, fetch: mockFetch, requestAnimationFrame: callback => setTimeout(callback, 0), setInterval: () => 0, clearInterval: () => {} })) Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
window.HTMLElement.prototype.scrollIntoView = () => {};
window.HTMLElement.prototype.focus = () => {};
Object.defineProperty(window.HTMLSelectElement.prototype, 'value', { configurable: true, get() { return this.querySelector('option[selected]')?.getAttribute('value') ?? this.querySelector('option')?.getAttribute('value') ?? ''; }, set(value) { for (const option of this.querySelectorAll('option')) { if ((option.getAttribute('value') ?? option.textContent) === String(value)) option.setAttribute('selected', ''); else option.removeAttribute('selected'); } } });
const failures = [];
process.on('unhandledRejection', error => failures.push(error));
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__modelComboTest={state,$,agentData,chatState,renderAgentModelSelect,renderChatModelSelect,renderCategoryConsensusEditor,fillAiModels,fillAiSelects,get aiGreenKeys(){return aiGreenKeys},get categoryFixChatModels(){return categoryFixChatModels}};'); } catch (error) { failures.push(error); }
const combo = globalThis.__modelComboTest;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(fn, label, timeoutMs = 8000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + label);
    await sleep(10);
  }
}
const items = listId => [...document.querySelectorAll('#' + listId + ' .combo-item')].map(item => item.textContent);
const greenItems = listId => [...document.querySelectorAll('#' + listId + ' .combo-item.green')].map(item => item.textContent);

test('boot keeps every model select bound and learns the green set', async () => {
  await waitFor(() => document.getElementById('aiModelSelSearch'), 'active-model search box');
  await waitFor(() => combo.state.connected, 'dashboard boot');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  for (const id of ['aiModelSel', 'aiCandModelSel', 'aiSingleModelSel']) {
    const select = document.getElementById(id);
    assert.ok(select && select.hidden, id + ' stays as a hidden bound select');
    assert.ok(document.getElementById(id + 'Search'), id + ' grows a search box');
  }
  assert.equal(document.getElementById('aiModelSel').dataset.connection, 'ai.model');
  await waitFor(() => combo.aiGreenKeys.has('p1::beta'), 'green set from last test');
  assert.equal(combo.aiGreenKeys.has('p1::alpha'), false, 'a red model is not green');
});

test('the master list marks the green model', async () => {
  const input = document.getElementById('aiMasterSearch'), list = document.getElementById('aiMasterList');
  input.dispatchEvent(new window.Event('focus'));
  assert.deepEqual(greenItems('aiMasterList'), ['🟢 Provider One / beta']);
  assert.ok(items('aiMasterList').includes('Provider One / alpha'), 'red models still list, unmarked');
});

test('the active-model combo filters and persists through autosave', async () => {
  const input = document.getElementById('aiModelSelSearch'), list = document.getElementById('aiModelSelList'), select = document.getElementById('aiModelSel');
  input.dispatchEvent(new window.Event('focus'));
  assert.deepEqual(items('aiModelSelList'), ['— انتخاب —', 'Provider One / alpha', '🟢 Provider One / beta', 'Provider Two / gamma']);
  input.value = 'gamma';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(items('aiModelSelList'), ['Provider Two / gamma']);
  list.querySelector('[data-model-value="p2::gamma"]').dispatchEvent(new window.Event('mousedown', { bubbles: true }));
  assert.equal(select.value, 'p2::gamma');
  assert.equal(input.value, 'Provider Two / gamma');
  await waitFor(() => postedBodies.length > 0, 'autosave POST');
  assert.equal(postedBodies[postedBodies.length - 1].ai.model, 'p2::gamma');
});

test('the candidate-model combo follows its provider and matches greens', async () => {
  const provider = document.getElementById('aiCandProvSel');
  provider.value = 'p1';
  provider.dispatchEvent(new window.Event('change', { bubbles: true }));
  const input = document.getElementById('aiCandModelSelSearch'), select = document.getElementById('aiCandModelSel');
  input.dispatchEvent(new window.Event('focus'));
  assert.deepEqual(items('aiCandModelSelList'), ['— انتخاب —', 'alpha', '🟢 beta']);
  input.value = 'bet';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(items('aiCandModelSelList'), ['🟢 beta']);
  document.getElementById('aiCandModelSelList').querySelector('[data-model-value="beta"]').dispatchEvent(new window.Event('mousedown', { bubbles: true }));
  assert.equal(select.value, 'beta');
});

test('the agent combo keeps optgroups and marks configured greens', async () => {
  combo.agentData.models = [{ id: 'free-tool', name: 'Free Tool', free: true, toolCalling: true }];
  combo.agentData.configured = [{ providerId: 'p1', providerName: 'Provider One', model: 'beta', keyCount: 1 }];
  combo.renderAgentModelSelect();
  const input = document.getElementById('agentModelSelSearch'), select = document.getElementById('agentModelSel');
  assert.ok(select.hidden, 'the agent select hides behind its combo');
  input.dispatchEvent(new window.Event('focus'));
  assert.ok([...document.querySelectorAll('#agentModelSelList .combo-group')].map(g => g.textContent).join(' ').includes('Provider One'), 'provider optgroups survive');
  assert.deepEqual(greenItems('agentModelSelList'), ['🟢 beta']);
  input.value = 'free';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(items('agentModelSelList'), ['Free Tool']);
  input.value = '';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('agentModelSelList').querySelector('[data-model-value="p1::beta"]').dispatchEvent(new window.Event('mousedown', { bubbles: true }));
  assert.equal(select.value, 'p1::beta');
});

test('the chat combo filters, marks greens and picks', async () => {
  combo.chatState.models = [
    { providerId: 'p1', providerName: 'Provider One', model: 'alpha', keyCount: 1, chat: true },
    { providerId: 'p1', providerName: 'Provider One', model: 'beta', keyCount: 1, chat: true, toolCalling: true },
  ];
  combo.renderChatModelSelect();
  const input = document.getElementById('chatModelSelSearch'), select = document.getElementById('chatModelSel');
  input.dispatchEvent(new window.Event('focus'));
  assert.deepEqual(greenItems('chatModelSelList'), ['🟢 Provider One — beta 🔧']);
  input.value = 'alpha';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(items('chatModelSelList'), ['Provider One — alpha']);
  input.value = '';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('chatModelSelList').querySelector('[data-model-value="p1::beta"]').dispatchEvent(new window.Event('mousedown', { bubbles: true }));
  assert.equal(select.value, 'p1::beta');
});

test('the consensus picker combo lists addable models with greens', async () => {
  const fixture = document.createElement('div');
  fixture.innerHTML = '<div id="categoryConsensusChips"></div><select id="categoryConsensusAdd"></select>';
  document.body.appendChild(fixture);
  combo.categoryFixChatModels.push(
    { providerId: 'p1', providerName: 'Provider One', model: 'alpha', chat: true },
    { providerId: 'p1', providerName: 'Provider One', model: 'beta', chat: true },
  );
  combo.renderCategoryConsensusEditor();
  const input = document.getElementById('categoryConsensusAddSearch'), select = document.getElementById('categoryConsensusAdd');
  assert.ok(input, 'the consensus picker grows a search box');
  input.dispatchEvent(new window.Event('focus'));
  assert.deepEqual(greenItems('categoryConsensusAddList'), ['🟢 Provider One · beta']);
  input.value = 'alpha';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.deepEqual(items('categoryConsensusAddList'), ['Provider One · alpha']);
  input.value = '';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('categoryConsensusAddList').querySelector('[data-model-value="p1::beta"]').dispatchEvent(new window.Event('mousedown', { bubbles: true }));
  assert.equal(select.value, 'p1::beta');
  assert.equal(failures.length, 0, 'no late failures: ' + failures.map(error => error?.stack || String(error)).join('\n'));
});
