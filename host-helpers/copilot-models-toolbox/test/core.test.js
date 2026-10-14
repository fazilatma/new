'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const test = require('node:test');
const core = require('../core');
const extensionPackage = require('../package.json');

test('package contributes the three requested Copilot Chat toolbar commands', () => {
  const commands = extensionPackage.contributes.commands;
  assert.deepEqual(
    commands.map((command) => command.title),
    ['🧪 Test All AI Models', '📥 Import AI JSON', '🔄 Sync GitHub']
  );
  const toolbar = extensionPackage.contributes.menus['view/title'];
  assert.equal(toolbar.length, 3);
  assert.ok(
    toolbar.every(
      (entry) =>
        entry.when.includes('view == workbench.panel.chat.view.copilot') &&
        entry.when.includes('|| view == workbench.panel.chat.view')
    )
  );
});

test('extension activates and registers all toolbar commands', (t) => {
  const registered = [];
  const disposable = { dispose() {} };
  const vscodeMock = {
    window: {
      createOutputChannel() {
        return { appendLine() {}, clear() {}, show() {}, dispose() {} };
      },
    },
    workspace: { getConfiguration() { return { get(_key, fallback) { return fallback; } }; } },
    commands: {
      registerCommand(command) {
        registered.push(command);
        return disposable;
      },
    },
  };
  const originalLoad = Module._load;
  Module._load = function load(request, parent, isMain) {
    if (request === 'vscode') return vscodeMock;
    return originalLoad.call(this, request, parent, isMain);
  };
  t.after(() => {
    Module._load = originalLoad;
    delete require.cache[require.resolve('../extension')];
  });
  const extension = require('../extension');
  extension.activate({ subscriptions: [], globalStorageUri: { fsPath: '/tmp/toolbox' } });
  assert.deepEqual(registered, [
    'copilotModels.testAll',
    'copilotModels.importJson',
    'copilotModels.syncGitHub',
  ]);
  const dashboard = extension.__test.testDashboardHtml(
    {},
    [
      {
        testKey: 'model-0',
        provider: 'Example',
        id: 'chat-a',
        kind: 'openai',
        apiKey: 'must-never-appear-in-html',
      },
    ],
    ['warning'],
    { concurrency: 2, timeoutMs: 30000 }
  );
  assert.match(dashboard, /AI Model Test Center/);
  assert.match(dashboard, /Copy all errors/);
  assert.match(dashboard, /Present · 25 chars/);
  assert.doesNotMatch(dashboard, /must-never-appear-in-html/);
});

test('chatCompletionsUrl preserves provider paths and appends operation', () => {
  assert.equal(
    core.chatCompletionsUrl('https://api.example.test/ai/v1/'),
    'https://api.example.test/ai/v1/chat/completions'
  );
  assert.equal(
    core.chatCompletionsUrl('https://api.example.test/v1/chat/completions'),
    'https://api.example.test/v1/chat/completions'
  );
});

test('collectConfiguredModels separates custom OpenAI and Ollama models', () => {
  const value = core.collectConfiguredModels([
    {
      vendor: 'customoai',
      name: 'Example',
      apiKey: 'secret',
      models: [{ id: 'chat-a', url: 'https://example.test/v1' }],
    },
    { vendor: 'ollama', name: 'Local Ollama', url: 'http://127.0.0.1:11434' },
    { vendor: 'other', models: [{ id: 'ignored' }] },
  ]);
  assert.equal(value.models.length, 1);
  assert.deepEqual(value.models[0], {
    kind: 'openai',
    provider: 'Example',
    id: 'chat-a',
    url: 'https://example.test/v1',
    apiKey: 'secret',
  });
  assert.deepEqual(value.ollamaGroups, [
    { provider: 'Local Ollama', url: 'http://127.0.0.1:11434' },
  ]);
});

test('requestJson makes a real JSON inference-style request', async (t) => {
  let received;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received = {
        method: request.method,
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  const response = await core.requestJson(
    `http://127.0.0.1:${address.port}/v1/chat/completions`,
    { model: 'chat-a', messages: [{ role: 'user', content: 'OK' }] },
    { headers: { Authorization: 'Bearer secret' }, timeoutMs: 2000 }
  );
  assert.equal(response.status, 200);
  assert.equal(received.method, 'POST');
  assert.equal(received.authorization, 'Bearer secret');
  assert.equal(received.body.model, 'chat-a');
});

test('catalog validation rejects malformed downloads', () => {
  assert.deepEqual(
    core.validateCatalog({ providers: [{ slug: 'one', models: [{ id: 'a' }] }] }),
    { providerCount: 1, modelCount: 1 }
  );
  assert.throws(() => core.validateCatalog({ providers: [] }), /empty/);
  assert.throws(() => core.validateCatalog({}), /providers array/);
});

test('compactError redacts API keys and preserves copyable details', () => {
  assert.equal(core.compactError('bad secret-key\nrequest', 'secret-key'), 'bad [REDACTED] request');
  assert.equal(core.compactError('abcdefghij', '', 7), 'abcd...');
});
