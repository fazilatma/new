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
  assert.ok(extensionPackage.activationEvents.includes('onCommand:copilotModels.zoom'));
  const commands = extensionPackage.contributes.commands;
  assert.deepEqual(
    commands.map((command) => command.title),
    ['🧪 Test All AI Models', '📥 Import AI JSON', '🔄 Sync GitHub', '🛠 Repair code-server', '🔎 Zoom code-server']
  );
  const toolbar = extensionPackage.contributes.menus['view/title'];
  assert.equal(toolbar.length, 5);
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
  assert.equal(settings['copilotModels.pinSuccessfulModels'].default, true);
  assert.equal(settings['copilotModels.testConcurrency'].default, 1);
  assert.equal(settings['copilotModels.roundRobinDelayMs'].default, 750);
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
    ConfigurationTarget: { Global: 'global' },
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
    'copilotModels.zoom',
  ]);
  const securedGroups = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(securedGroups.length, 1);
  assert.equal(securedGroups[0].name, 'Mistral');
  assert.equal(securedGroups[0].apiKey, '${input:chat.lm.secret.test-ref}');
  assert.equal(fs.statSync(configFile).mode & 0o777, 0o600);
  assert.deepEqual([...storedSecrets.values()], ['mistral-private-key']);
  let zoomCommand;
  vscodeMock.window.showQuickPick = async () => ({ command: 'workbench.action.zoomIn' });
  vscodeMock.commands.executeCommand = async (command) => { zoomCommand = command; };
  await extension.__test.zoomCodeServer();
  assert.equal(zoomCommand, 'workbench.action.zoomIn');
  let forcedZoom;
  vscodeMock.window.showQuickPick = async () => ({ command: 'exact' });
  vscodeMock.window.showInputBox = async () => '-1.5';
  vscodeMock.workspace.getConfiguration = (section) => ({
    get(_key, fallback) { return section === 'window' ? 0 : fallback; },
    async update(key, value, target) { forcedZoom = { section, key, value, target }; },
  });
  await extension.__test.zoomCodeServer();
  assert.deepEqual(forcedZoom, {
    section: 'window', key: 'zoomLevel', value: -1.5, target: 'global',
  });
  const repairedIds = await extension.__test.repairResolvedModelIds(context, [
    {
      provider: 'Mistral',
      id: 'mistral-small',
      resolvedId: 'mistral-small-latest',
    },
  ]);
  assert.equal(repairedIds, 1);
  const repairedGroups = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  assert.equal(repairedGroups[0].models[0].id, 'mistral-small-latest');
  assert.equal(
    fs.readdirSync(path.join(globalStorage, 'model-id-backups')).length,
    1
  );
  const logDirectory = path.join(temporary, 'logs', 'session', 'window1');
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(logDirectory, 'exthost.log'),
    [
      'No errors found during startup',
      `ERROR request failed with mistral-private-key at https://api.example.test/v1/private and ${temporary}/workspace/private.js`,
      'write EPIPE while talking to tsserver',
    ].join('\n')
  );
  const codeServerDiagnostics = await extension.__test.collectCodeServerDiagnostics(context);
  assert.equal(codeServerDiagnostics.errorCount, 2);
  assert.equal(extension.__test.diagnosticCommentChunks(codeServerDiagnostics.errors, 200).length, 2);
  const diagnosticText = JSON.stringify(codeServerDiagnostics);
  assert.doesNotMatch(diagnosticText, /mistral-private-key|\/v1\/private|workspace\/private/);
  assert.match(diagnosticText, /\[REDACTED\]|\[PATH\]|\[LOCAL_PATH\]/);
  let apiRequest;
  const apiServer = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      apiRequest = {
        method: request.method,
        authorization: request.headers.authorization,
        userAgent: request.headers['user-agent'],
        body: JSON.parse(body),
      };
      response.writeHead(201, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ number: 7, html_url: 'https://github.test/issues/7' }));
    });
  });
  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  t.after(() => apiServer.close());
  const apiAddress = apiServer.address();
  const apiResult = await extension.__test.githubApiJson(
    'oauth-secret',
    'POST',
    `http://127.0.0.1:${apiAddress.port}/repos/owner/repository/issues`,
    { title: 'Diagnostic', body: 'Sanitized' }
  );
  assert.equal(apiResult.number, 7);
  assert.equal(apiRequest.method, 'POST');
  assert.equal(apiRequest.authorization, 'Bearer oauth-secret');
  assert.match(apiRequest.userAgent, /copilot-models-toolbox/);
  assert.deepEqual(apiRequest.body, { title: 'Diagnostic', body: 'Sanitized' });
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
  await extension.__test.installDownloadedRuntimeDirectly(context, {
    'copilot-models.py': '#!/usr/bin/env python3\nHELPER_VERSION = "test"\n',
    'copilot-models.catalog.json': '{"providers":[{"slug":"test","models":[{"id":"m"}]}]}\n',
    'copilot-models-toolbox/core.js': 'module.exports = {};\n',
    'copilot-models-toolbox/extension.js': 'function activate() {}\n',
    'copilot-models-toolbox/package.json': '{"name":"copilot-models-toolbox","version":"test"}\n',
  });
  assert.equal(
    fs.readFileSync(path.join(extensionPath, 'runtime', 'copilot-models.py'), 'utf8'),
    '#!/usr/bin/env python3\nHELPER_VERSION = "test"\n'
  );
  assert.equal(
    fs.statSync(path.join(extensionPath, 'runtime', 'copilot-models.py')).mode & 0o777,
    0o700
  );
  assert.match(
    fs.readFileSync(path.join(extensionPath, 'package.json'), 'utf8'),
    /"version":"test"/
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
        configuredName: 'Chat A',
        maxInputTokens: 128000,
        maxOutputTokens: 16000,
        vision: true,
        streaming: false,
        reasoning: true,
        reasoningKnown: true,
        reasoningEfforts: ['high'],
        toolCalling: true,
        apiKey: 'must-never-appear-in-html',
      },
    ],
    ['warning'],
    { concurrency: 2, timeoutMs: 30000, roundRobinDelayMs: 750, maxOutputTokens: 768 }
  );
  assert.match(dashboard, /AI Model Test Center/);
  assert.match(dashboard, /Import Models \/ JSON/);
  assert.match(dashboard, /Tested \/ resolved model/);
  assert.match(dashboard, /Model specifications/);
  assert.match(dashboard, /Editable test prompt/);
  assert.match(dashboard, /Simple — Hello response/);
  assert.match(dashboard, /Professional — TypeScript scheduler/);
  assert.match(dashboard, /Provider JSON file/);
  assert.match(dashboard, /ai-providers-2026-08-23-160523-gemini-llm7-opencode-ollama-cloud-added\.json/);
  assert.match(dashboard, /Copy path/);
  assert.match(dashboard, /Power \/ test score/);
  assert.equal((dashboard.match(/data-sort=/g) || []).length, 14);
  assert.match(dashboard, /function sortRows\(\)/);
  assert.match(dashboard, /Response \/ error details/);
  assert.match(dashboard, /metadata baseline/i);
  assert.match(dashboard, /not a benchmark/);
  assert.match(dashboard, /Reasoning/);
  assert.match(dashboard, /Tool calls/);
  assert.match(dashboard, /Use in Chat/);
  assert.match(dashboard, /provider round-robin waves/i);
  assert.match(dashboard, /height: 62vh; min-height: 280px/);
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
  assert.match(githubSync, /Upload all sanitized errors/);
  assert.match(githubSync, /Copy update log/);
  assert.match(githubSync, /Nothing is uploaded automatically/);
  assert.match(githubSync, /every detected sanitized error/);
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
  assert.equal(
    core.modelsUrl('https://api.example.test/v1/chat/completions'),
    'https://api.example.test/v1/models'
  );
});

test('resolveRemoteModel safely repairs unique display-name and case mismatches', () => {
  const remote = [
    { id: 'mistral-small-latest', name: 'Mistral Small Latest' },
    { id: 'codestral-latest', name: 'Codestral Latest' },
  ];
  assert.deepEqual(
    core.resolveRemoteModel({ id: 'MISTRAL-SMALL-LATEST' }, remote),
    { id: 'mistral-small-latest', reason: 'case-corrected' }
  );
  assert.deepEqual(
    core.resolveRemoteModel({ id: 'Codestral Latest' }, remote),
    { id: 'codestral-latest', reason: 'name-resolved' }
  );
  assert.equal(core.resolveRemoteModel({ id: 'unknown model' }, remote), undefined);
});

test('modelPower reports a transparent declared-capability score', () => {
  assert.deepEqual(
    core.modelPower({
      maxInputTokens: 1000000,
      maxOutputTokens: 128000,
      reasoningKnown: true,
      reasoning: true,
      toolCalling: true,
      vision: true,
      streaming: true,
    }),
    {
      score: 100,
      label: 'Exceptional',
      basis: 'Declared capability index: token limits, reasoning, tool calling, vision, and streaming; not a benchmark',
    }
  );
  assert.deepEqual(
    core.modelPower({}),
    { score: null, label: 'Unknown', basis: 'No capability metadata' }
  );
  assert.equal(
    core.modelPower({ maxInputTokens: 128000, maxOutputTokens: 16000, reasoningKnown: true, reasoning: false, toolCalling: true, vision: false, streaming: false }).label,
    'Medium'
  );
});

test('simple greeting scoring rewards a concise relevant response', () => {
  const excellent = core.scoreSimpleResponse('Hello!');
  assert.equal(excellent.score, 100);
  assert.equal(excellent.label, 'Exceptional');
  assert.equal(core.scoreSimpleResponse('').score, 0);
  assert.ok(core.scoreSimpleResponse('This is not a greeting.').score < excellent.score);
});

test('coding response extraction and deterministic power scoring use the actual answer', () => {
  const answer = [
    '```typescript',
    'interface Failure { index: number; error: Error }',
    'async function scheduleByProvider<T, R>(jobs: readonly T[], maxConcurrency: number, minIntervalMs: number, signal: AbortSignal): Promise<R[]> {',
    '  const providerQueues = new Map<string, T[]>(); let activeCount = 0; const results: R[] = [];',
    '  signal.addEventListener("abort", () => { clearTimeout(0); signal.removeEventListener("abort", () => {}); throw new DOMException("cancel", "AbortError"); });',
    '  // round-robin, per-provider nextAllowed using Date.now and setTimeout, plus semaphore concurrency',
    '  // retry HTTP 429 and 503 with exponential backoff plus jitter using Math.random',
    '  return results; // preserve original order with results[index]',
    '}',
    'class ScheduleAggregateError extends AggregateError {}',
    '```',
    'Invariant: at most one job per provider is active. Big-O complexity is O(n).',
    'import test from "node:test";',
    'test("fair round-robin", () => {}); test("ordering", () => {}); test("max concurrency", () => {});',
    'test("rate 429 retry", () => {}); test("503 backoff", () => {}); test("abort cancellation", () => {});',
    'The implementation uses provider queues and enforces fairness, cancellation, and rate limits.',
    'x'.repeat(900),
  ].join('\n');
  assert.equal(
    core.extractAssistantText({ choices: [{ message: { content: answer } }] }),
    answer
  );
  assert.equal(core.extractAssistantText({ message: { content: 'ollama answer' } }), 'ollama answer');
  assert.equal(
    core.extractAssistantText({ choices: [{ message: { content: [{ type: 'text', text: 'part one' }, { type: 'text', text: 'part two' }] } }] }),
    'part one\npart two'
  );
  const scored = core.scoreCodingResponse(answer);
  assert.ok(scored.score >= 85, JSON.stringify(scored));
  assert.equal(scored.label, 'Exceptional');
  const promptEcho = 'scheduleByProvider<T, R> round-robin maxConcurrency minIntervalMs AbortSignal cleanup retry 429 503 backoff jitter preserve original order typed aggregate failures node:test invariant Big-O '.repeat(6);
  assert.ok(core.scoreCodingResponse(promptEcho).score <= 10);
  assert.equal(core.scoreCodingResponse('').label, 'No answer');
});

test('round-robin ordering completes one model wave across providers before the next', () => {
  const input = [
    { provider: 'A', vendor: 'customoai', id: 'a1' },
    { provider: 'A', vendor: 'customoai', id: 'a2' },
    { provider: 'B', vendor: 'customoai', id: 'b1' },
    { provider: 'B', vendor: 'customoai', id: 'b2' },
    { provider: 'B', vendor: 'customoai', id: 'b3' },
    { provider: 'C', vendor: 'customoai', id: 'c1' },
  ];
  assert.deepEqual(
    core.roundRobinModelRounds(input).map((round) => round.map((model) => model.id)),
    [['a1', 'b1', 'c1'], ['a2', 'b2'], ['b3']]
  );
  assert.deepEqual(
    core.roundRobinModels(input).map((model) => model.id),
    ['a1', 'b1', 'c1', 'a2', 'b2', 'b3']
  );
});

test('collectConfiguredModels separates custom OpenAI and Ollama models', () => {
  const value = core.collectConfiguredModels([
    {
      vendor: 'customoai',
      name: 'Example',
      apiKey: 'secret',
      models: [{
        id: 'chat-a',
        name: 'Chat A',
        url: 'https://example.test/v1',
        toolCalling: true,
        vision: false,
        streaming: true,
        thinking: true,
        maxInputTokens: 128000,
        maxOutputTokens: 16000,
      }],
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
    configuredName: 'Chat A',
    url: 'https://example.test/v1',
    apiKey: 'secret',
    credentialReference: '',
    toolCalling: true,
    vision: false,
    streaming: true,
    maxInputTokens: 128000,
    maxOutputTokens: 16000,
    contextWindow: null,
    reasoning: true,
    reasoningKnown: true,
    reasoningEfforts: [],
  });
  assert.deepEqual(value.ollamaGroups, [
    { provider: 'Local Ollama', url: 'http://127.0.0.1:11434' },
  ]);
});

test('chatModelIdentifier matches Copilot Chat vendor/group/model storage ids', () => {
  assert.equal(
    core.chatModelIdentifier({ vendor: 'customoai', provider: 'Mistral', id: 'codestral' }),
    'customoai/Mistral/codestral'
  );
  assert.equal(
    core.chatModelIdentifier({ kind: 'ollama', provider: 'Local Ollama', id: 'qwen:7b' }),
    'ollama/Local Ollama/qwen:7b'
  );
  assert.equal(core.chatModelIdentifier({ provider: 'Broken', id: 'model' }), '');
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

test('compactError and diagnostic sanitizer redact private values', () => {
  assert.equal(core.compactError('bad secret-key\nrequest', 'secret-key'), 'bad [REDACTED] request');
  assert.equal(core.compactError('abcdefghij', '', 7), 'abcd...');
  const sanitized = core.sanitizeDiagnosticText(
    'Bearer private-token-123 ghp_abcdefghijklmnopqrstuvwxyz123456 https://api.example.test/v1/accounts/private /data/data/com.termux/files/home/me/project prompt="private user request"',
    ['private-token-123']
  );
  assert.doesNotMatch(sanitized, /private-token-123|ghp_|accounts\/private|\/data\/data|private user request/);
  assert.match(sanitized, /https:\/\/api\.example\.test\/\[PATH\]/);
  const modelError = core.sanitizedModelTestError(
    'Requested model rejected: HTTP 429: {"error":"raw response repeats private coding prompt"}'
  );
  assert.match(modelError, /HTTP 429 · provider response body omitted/);
  assert.doesNotMatch(modelError, /raw response|private coding prompt/);
});
