import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

/**
 * Chat/category mode switches: the single-model test panel and the chat
 * panel each carry a chat/category switch. Category mode posts the picked
 * model (multi-key suffix stripped) plus the typed title to the shared
 * Basalam suggest endpoint; chat mode keeps the old behavior. The dashboard
 * bundle is the real worker-src/dashboard.ts served to every environment;
 * only network and timers are stubbed.
 */
const temporary = await mkdtemp(join(tmpdir(), 'scraper4-ai-mode-switch-'));
await build({ entryPoints: { dashboard: new URL('../worker-src/dashboard.ts', import.meta.url).pathname }, bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' } });
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')));

const providers = [
  { id: 'p1', name: 'Provider One', baseUrl: 'https://ai.example', apiKeys: ['k1', 'k2'], models: ['alpha', 'beta'], enabled: true },
];
const connections = { ai: { providers, candidates: [], master: '', model: '' }, woo: {}, basalam: { shops: [] } };
const posted = { suggest: [], testAi: [], chat: [] };
const mockFetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url, 'http://mode.test'), method = String(init.method || 'GET').toUpperCase();
  const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const body = () => JSON.parse(String(init.body || '{}'));
  if (url.pathname === '/api/destination/basalam/category/suggest' && method === 'POST') {
    posted.suggest.push(body());
    return json({ ok: true, mode: 'ai', categories: 3, categoryId: 7, categoryName: 'کتانی', categoryPath: 'پوشاک / کتانی' });
  }
  if (url.pathname === '/api/test-connection/ai' && method === 'POST') { posted.testAi.push(body()); return json({ ok: true }); }
  if (url.pathname === '/api/ai/chat' && method === 'POST') { posted.chat.push(body()); return json({ text: 'سلام!', provider: 'p1', model: 'alpha' }); }
  if (url.pathname === '/api/ai/chat-models') {
    return json({ ok: true, models: [
      { providerId: 'p1', providerName: 'Provider One', model: 'alpha', chat: true, keyCount: 2 },
      { providerId: 'p1', providerName: 'Provider One', model: 'beta', chat: true, keyCount: 1 },
    ] });
  }
  if (url.pathname === '/api/connections' && method === 'POST') return json({ ok: true, connections });
  if (url.pathname === '/api/connections') return json({ ok: true, connections });
  if (url.pathname === '/api/profiles') return json({ ok: true, profiles: [] });
  if (url.pathname === '/api/status') return json({ ok: true, version: '1.178.0', databaseReady: true, connections: { woo: { ok: false }, basalam: { ok: false } } });
  if (url.pathname === '/health') return json({ ok: true, version: '1.178.0', databaseReady: true });
  if (url.pathname === '/api/settings') return json({ ok: true, settings: {} });
  if (url.pathname === '/api/jobs') return json({ ok: true, jobs: [] });
  if (url.pathname === '/api/ai/test-runs/current' || url.pathname === '/api/destination/basalam/category-runs/current') return json({ ok: true, run: null });
  if (url.pathname === '/api/import/history') return json({ ok: true, items: [] });
  if (url.pathname === '/api/runtime/libraries') return json({ ok: true, libraries: [] });
  if (url.pathname === '/api/ai/test-results') return json({ ok: true, results: [] });
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
try { (0, eval)(DASHBOARD_JS + '\n;globalThis.__modeTest={state,$,fillAiModels,get singleMode(){return aiSingleMode},get chatMode(){return chatState.mode}};'); } catch (error) { failures.push(error); }
const mode = globalThis.__modeTest;
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
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }));

test('single panel: the mode switch toggles state, pills and placeholder', async () => {
  await waitFor(() => document.querySelector('[data-single-mode="category"]'), 'single-mode switch');
  await waitFor(() => mode.state.connected, 'dashboard boot');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
  assert.equal(mode.singleMode, 'chat');
  const chatBtn = document.querySelector('[data-single-mode="chat"]'), catBtn = document.querySelector('[data-single-mode="category"]');
  assert.ok(chatBtn.classList.contains('active'));
  assert.ok(!catBtn.classList.contains('active'));
  click(catBtn);
  assert.equal(mode.singleMode, 'category');
  assert.ok(!chatBtn.classList.contains('active'));
  assert.ok(catBtn.classList.contains('active'));
  assert.match(document.getElementById('aiSinglePrompt').placeholder, /دسته/);
  click(chatBtn);
  assert.equal(mode.singleMode, 'chat');
  assert.equal(document.getElementById('aiSinglePrompt').placeholder, 'پیام آزمایشی');
});

test('single panel: category mode suggests a Basalam category with the picked model', async () => {
  const provSel = document.getElementById('aiProviderSel');
  await waitFor(() => provSel.querySelector('option[value="p1"]'), 'provider option');
  provSel.value = 'p1';
  mode.fillAiModels('aiProviderSel', 'aiSingleModelSel');
  const modelSel = document.getElementById('aiSingleModelSel');
  await waitFor(() => modelSel.querySelector('option[value="alpha::k2"]'), 'multi-key model option');
  modelSel.value = 'alpha::k2';
  document.getElementById('aiSinglePrompt').value = 'کفش چرم';
  click(document.querySelector('[data-single-mode="category"]'));
  const before = posted.suggest.length;
  click(document.querySelector('[data-ma="test-ai"]'));
  await waitFor(() => posted.suggest.length > before, 'category suggest POST');
  assert.deepEqual(posted.suggest[posted.suggest.length - 1], { title: 'کفش چرم', mode: 'ai', modelKey: 'p1::alpha' });
  assert.match(document.body.textContent, /پوشاک \/ کتانی/, 'the suggested category path is shown');
});

test('single panel: chat mode still runs the full model test', async () => {
  click(document.querySelector('[data-single-mode="chat"]'));
  const before = posted.testAi.length;
  click(document.querySelector('[data-ma="test-ai"]'));
  await waitFor(() => posted.testAi.length > before, 'test-connection POST');
  const last = posted.testAi[posted.testAi.length - 1];
  assert.equal(last.provider, 'p1');
  assert.equal(last.model, 'alpha::k2');
  assert.equal(last.prompt, 'کفش چرم');
});

test('chat panel: the mode switch toggles state, pills and placeholder', async () => {
  click(document.querySelector('[data-ai-tab="chat"]'));
  await waitFor(() => document.querySelector('#chatModelSel option[value="p1::alpha::k2"]'), 'chat model option');
  assert.equal(mode.chatMode, 'chat');
  const chatBtn = document.querySelector('[data-chat-mode="chat"]'), catBtn = document.querySelector('[data-chat-mode="category"]');
  assert.ok(chatBtn && catBtn, 'both chat-mode pills exist');
  click(catBtn);
  assert.equal(mode.chatMode, 'category');
  assert.ok(catBtn.classList.contains('active'));
  assert.ok(!chatBtn.classList.contains('active'));
  assert.match(document.getElementById('chatInput').placeholder, /دسته/);
  click(chatBtn);
  assert.equal(mode.chatMode, 'chat');
  assert.match(document.getElementById('chatInput').placeholder, /پیام خود را بنویسید/);
});

test('chat panel: category mode suggests and shows the path as an assistant bubble', async () => {
  click(document.querySelector('[data-chat-mode="category"]'));
  document.getElementById('chatModelSel').value = 'p1::alpha::k2';
  document.getElementById('chatInput').value = 'مانتو';
  const bubblesBefore = document.querySelectorAll('#chatMessages .chat-bubble').length;
  const before = posted.suggest.length;
  click(document.getElementById('chatSend'));
  await waitFor(() => posted.suggest.length > before, 'chat category suggest POST');
  assert.deepEqual(posted.suggest[posted.suggest.length - 1], { title: 'مانتو', mode: 'ai', modelKey: 'p1::alpha' });
  await waitFor(() => document.querySelectorAll('#chatMessages .chat-bubble').length >= bubblesBefore + 2, 'assistant bubble');
  const bubbles = [...document.querySelectorAll('#chatMessages .chat-bubble-text')].map(el => el.textContent);
  assert.ok(bubbles.some(text => text.includes('پوشاک / کتانی')), 'assistant bubble shows the category path, got: ' + JSON.stringify(bubbles));
});

test('chat panel: chat mode still talks to the model', async () => {
  click(document.querySelector('[data-chat-mode="chat"]'));
  document.getElementById('chatInput').value = 'سلام';
  const before = posted.chat.length;
  click(document.getElementById('chatSend'));
  await waitFor(() => posted.chat.length > before, 'ai chat POST');
  const last = posted.chat[posted.chat.length - 1];
  assert.equal(last.providerId, 'p1');
  assert.equal(last.model, 'alpha::k2');
  assert.equal(failures.length, 0, failures.map(error => error?.stack || String(error)).join('\n'));
});
