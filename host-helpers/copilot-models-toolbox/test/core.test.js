'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const core = require('../core');
const extensionPackage = require('../package.json');

test('package contributes the model and self-repair Copilot Chat toolbar commands', () => {
  assert.ok(extensionPackage.activationEvents.includes('onStartupFinished'));
  const commands = extensionPackage.contributes.commands;
  assert.deepEqual(
    commands.map((command) => command.title),
    ['🧪 Test All AI Models', '📥 Import AI JSON', '🔄 Sync GitHub', '🛠 Repair code-server']
  );
  const toolbar = extensionPackage.contributes.menus['view/title'];
  assert.equal(toolbar.length, 4);
  assert.ok(
    toolbar.every(
      (entry) =>
        entry.when.includes('view == workbench.panel.chat.view.copilot') &&
        entry.when.includes('|| view == workbench.panel.chat.view')
    )
  );
  const settings = extensionPackage.contributes.configuration.properties;
  assert.equal(settings['copilotModels.githubRepository'].default, 'fazilatma/new');
  assert.equal(settings['copilotModels.githubBranch'].default, 'arena/f1997f2f-new');
  assert.equal(settings['copilotModels.autoUpdate'].default, false);
});

test('GitHub updater downloads runtime directly instead of spawning Bash', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'extension.js'), 'utf8');
  assert.match(source, /Downloading the branch runtime without spawning Bash or curl/);
  assert.doesNotMatch(source, /const bash\s*=/);
  assert.doesNotMatch(source, /runProcess\(\s*bash/);
});

test('extension activates, registers commands, and secures plaintext Chat keys', async (t) => {
  const registered = [];
  const storedSecrets = new Map();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-models-toolbox-'));
  const profileRoot = path.join(temporary, 'User');
  const globalStorage = path.join(profileRoot, 'globalStorage', 'fazilatma.copilot-models-toolbox');
  const configFile = path.join(profileRoot, 'chatLanguageModels.json');
  const extensionPath = path.join(temporary, 'toolbox-extension');
  fs.mkdirSync(globalStorage, { recursive: true });
  fs.mkdirSync(extensionPath, { recursive: true });
  fs.writeFileSync(path.join(extensionPath, 'package.json'), JSON.stringify({ version: 'test' }));
  fs.writeFileSync(
    configFile,
    JSON.stringify([
      {
        vendor: 'customoai',
        name: 'Mistral',
        apiKey: 'mistral-private-key',
        models: [{ id: 'mistral-small', name: 'Mistral Small', url: 'https://api.mistral.ai/v1' }],
      },
    ])
  );
  const disposable = { dispose() {} };
  const vscodeMock = {
    window: {
      createOutputChannel() {
        return { appendLine() {}, clear() {}, show() {}, dispose() {} };
      },
      async showInformationMessage() {},
    },
    workspace: { getConfiguration() { return { get(_key, fallback) { return fallback; } }; } },
    extensions: { getExtension() { return undefined; } },
    commands: {
      registerCommand(command) {
        registered.push(command);
        return disposable;
      },
      async getCommands() {
        return ['lm.addLanguageModelsProviderGroup'];
      },
      async executeCommand(command, group) {
        assert.equal(command, 'lm.addLanguageModelsProviderGroup');
        const groups = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        groups.push({ ...group, apiKey: '${input:chat.lm.secret.test-ref}' });
        fs.writeFileSync(configFile, JSON.stringify(groups, null, 2));
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
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const extension = require('../extension');
  const context = {
    subscriptions: [],
    extensionPath,
    globalStorageUri: { fsPath: globalStorage },
    secrets: {
      async store(key, value) { storedSecrets.set(key, value); },
      async get(key) { return storedSecrets.get(key); },
    },
  };
  extension.activate(context);
  await extension.__test.migratePlaintextCredentials(context);
  assert.deepEqual(registered, [
    'copilotModels.testAll',
    'copilotModels.importJson',
    'copilotModels.syncGitHub',
    'copilotModels.repair',
  ]);
  const securedGroups = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(securedGroups.length, 1);
  assert.equal(securedGroups[0].name, 'Mistral');
  assert.equal(securedGroups[0].apiKey, '${input:chat.lm.secret.test-ref}');
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.deepEqual([...storedSecrets.values()], ['mistral-private-key']);
  const termuxFiles = path.join(temporary, 'com.termux', 'files');
  const termuxHome = path.join(termuxFiles, 'home');
  const termuxPrefix = path.join(termuxFiles, 'usr');
  const fakePython = path.join(termuxPrefix, 'bin', 'python3');
  fs.mkdirSync(path.dirname(fakePython), { recursive: true });
  fs.mkdirSync(termuxHome, { recursive: true });
  fs.writeFileSync(fakePython, '#!/system/bin/sh\n');
  fs.chmodSync(fakePython, 0o700);
  const runtimeEnvironment = extension.__test.termuxRuntimeEnvironment({
    HOME: termuxHome,
    PATH: '/system/bin',
  });
  assert.equal(runtimeEnvironment.PREFIX, termuxPrefix);
  assert.equal(runtimeEnvironment.TMPDIR, path.join(termuxPrefix, 'tmp'));
  assert.ok(runtimeEnvironment.PATH.startsWith(path.join(termuxPrefix, 'bin')));
  assert.equal(extension.__test.pythonCommand(runtimeEnvironment), fakePython);
  assert.equal(
    extension.__test.resolveExecutable('python3', runtimeEnvironment),
    fakePython
  );
  const snapshot = await extension.__test.createRepairSnapshot(context, 'unit test');
  const snapshotManifest = JSON.parse(
    fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8')
  );
  assert.equal(snapshotManifest.reason, 'unit test');
  assert.equal(snapshotManifest.toolboxVersion, extensionPackage.version);
  assert.ok(fs.existsSync(path.join(snapshot, 'chatLanguageModels.json')));
  assert.ok(fs.existsSync(path.join(snapshot, 'toolbox-extension', 'package.json')));
  assert.equal(fs.statSync(snapshot).mode & 0o777, 0o700);
  assert.doesNotMatch(
    fs.readFileSync(path.join(snapshot, 'chatLanguageModels.json'), 'utf8'),
    /mistral-private-key/
  );
  assert.deepEqual(
    extension.__test.providerCredentialAliases('Mistral'),
    ['Mistral', 'Mistral AI']
  );
  assert.deepEqual(
    extension.__test.providerCredentialAliases('Mistral AI'),
    ['Mistral AI', 'Mistral']
  );
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
  assert.match(dashboard, /Plaintext pending migration · 25 chars/);
  assert.doesNotMatch(dashboard, /must-never-appear-in-html/);
  const embeddedScript = dashboard.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(embeddedScript));
  const githubSync = extension.__test.githubSyncHtml({
    repository: 'owner/repository',
    branch: 'feature/test',
    autoUpdate: true,
    intervalMinutes: 15,
  });
  assert.match(githubSync, /GitHub Full Update/);
  assert.match(githubSync, /Enable automatic update checks/);
  const githubScript = githubSync.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(githubScript));
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
    vendor: 'customoai',
    provider: 'Example',
    id: 'chat-a',
    url: 'https://example.test/v1',
    apiKey: 'secret',
    credentialReference: '',
  });
  assert.deepEqual(value.ollamaGroups, [
    { provider: 'Local Ollama', url: 'http://127.0.0.1:11434' },
  ]);
});

test('collectConfiguredModels never sends a Chat secret reference as an API key', () => {
  const reference = '${input:chat.lm.secret.abc123}';
  const value = core.collectConfiguredModels([
    {
      vendor: 'customoai',
      name: 'Mistral',
      apiKey: reference,
      models: [{ id: 'mistral-small', url: 'https://api.mistral.ai/v1' }],
    },
  ]);
  assert.equal(core.isChatSecretReference(reference), true);
  assert.equal(value.models[0].apiKey, '');
  assert.equal(value.models[0].credentialReference, reference);
  assert.equal(value.models[0].provider, 'Mistral');
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
