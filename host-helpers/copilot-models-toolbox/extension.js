'use strict';

const cp = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const core = require('./core');
const extensionPackage = require('./package.json');

const OUTPUT_NAME = 'Copilot Models Toolbox';
const RESTART_COMMAND = [
  "pkill -f '[c]ode-server' || true",
  'sleep 1',
  'mkdir -p "$HOME/.local/share/code-server"',
  'nohup code-server >>"$HOME/.local/share/code-server/code-server.log" 2>&1 </dev/null &',
].join('\n');

let output;

function toolboxConfiguration() {
  return vscode.workspace.getConfiguration('copilotModels');
}

function activeProfileRoot(context) {
  return path.dirname(path.dirname(context.globalStorageUri.fsPath));
}

function configuredPaths(context) {
  const configuration = toolboxConfiguration();
  const root = activeProfileRoot(context);
  return {
    configFile:
      String(configuration.get('configFile', '') || '').trim() ||
      path.join(root, 'chatLanguageModels.json'),
    settingsFile:
      String(configuration.get('settingsFile', '') || '').trim() ||
      path.join(root, 'settings.json'),
  };
}

function runtimePaths(context) {
  return {
    helper: path.join(context.extensionPath, 'runtime', 'copilot-models.py'),
    bundledCatalog: path.join(
      context.extensionPath,
      'runtime',
      'copilot-models.catalog.json'
    ),
    syncedCatalog: path.join(context.globalStorageUri.fsPath, 'copilot-models.catalog.json'),
  };
}

async function readable(filename) {
  try {
    await fsp.access(filename, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function currentCatalogPath(context) {
  const runtime = runtimePaths(context);
  return (await readable(runtime.syncedCatalog))
    ? runtime.syncedCatalog
    : runtime.bundledCatalog;
}

function pythonCommand() {
  const candidates = [
    process.env.COPILOT_MODELS_PYTHON,
    process.env.PREFIX && path.join(process.env.PREFIX, 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'python3';
}

function runProcess(command, args, token) {
  return new Promise((resolve, reject) => {
    output.appendLine(`$ ${command} ${args.map((value) => JSON.stringify(value)).join(' ')}`);
    const child = cp.spawn(command, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const cancellation = token
      ? token.onCancellationRequested(() => child.kill('SIGTERM'))
      : undefined;
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (cancellation) cancellation.dispose();
      reject(error);
    });
    child.on('close', (code, signal) => {
      if (cancellation) cancellation.dispose();
      if (stdout.trim()) output.appendLine(stdout.trimEnd());
      if (stderr.trim()) output.appendLine(stderr.trimEnd());
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            signal
              ? `Helper stopped by ${signal}`
              : `Helper exited with status ${code}: ${stderr.trim() || stdout.trim()}`
          )
        );
      }
    });
  });
}

async function runHelper(context, extraArgs, token) {
  const runtime = runtimePaths(context);
  const catalog = await currentCatalogPath(context);
  const paths = configuredPaths(context);
  for (const required of [runtime.helper, catalog]) {
    if (!(await readable(required))) {
      throw new Error(`Toolbox runtime file is missing: ${required}`);
    }
  }

  const args = [
    runtime.helper,
    '--catalog',
    catalog,
    '--config-file',
    paths.configFile,
    '--settings-file',
    paths.settingsFile,
    '--no-discover',
    '--enable-terminal',
    ...extraArgs,
  ];
  const copilot = vscode.extensions.getExtension('github.copilot-chat');
  if (copilot) {
    args.push('--extension-dir', copilot.extensionPath);
  }
  return runProcess(pythonCommand(), args, token);
}

async function copyRestartCommand(message) {
  const choice = await vscode.window.showInformationMessage(
    `${message} Restart code-server from a separate Termux session to apply every change.`,
    'Copy Restart Command'
  );
  if (choice === 'Copy Restart Command') {
    await vscode.env.clipboard.writeText(RESTART_COMMAND);
    vscode.window.showInformationMessage('code-server restart command copied.');
  }
}

async function firstExistingDirectory(candidates) {
  for (const candidate of candidates) {
    try {
      if ((await fsp.stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Try the next Android/Termux download location.
    }
  }
  return os.homedir();
}

async function importJson(context) {
  const home = os.homedir();
  const defaultDirectory = await firstExistingDirectory([
    path.join(home, 'storage', 'shared', 'download'),
    path.join(home, 'storage', 'shared', 'Download'),
    path.join(home, 'storage', 'downloads'),
    '/storage/emulated/0/Download',
  ]);
  const selected = await vscode.window.showOpenDialog({
    title: '📥 Import AI JSON',
    defaultUri: vscode.Uri.file(defaultDirectory),
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'AI provider JSON': ['json'] },
    openLabel: 'Import AI JSON',
  });
  if (!selected || selected.length === 0) return;

  const source = selected[0].fsPath;
  const confirmed = await vscode.window.showWarningMessage(
    `Import providers, models, and embedded API keys from ${path.basename(source)}? ` +
      'Keys will be stored as plaintext in chatLanguageModels.json with file mode 0600.',
    { modal: true },
    'Import'
  );
  if (confirmed !== 'Import') return;

  output.clear();
  output.appendLine(`Importing ${source}`);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Importing AI providers into Copilot Chat',
      cancellable: true,
    },
    async (_progress, token) => {
      await runHelper(context, ['--source', source, '--import-source-keys'], token);
    }
  );
  await copyRestartCommand('AI providers and keys were imported.');
}

async function writeSyncedCatalog(context, text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`GitHub catalog is not valid JSON: ${error.message}`);
  }
  const summary = core.validateCatalog(value);
  const target = runtimePaths(context).syncedCatalog;
  await fsp.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fsp.rename(temporary, target);
  return summary;
}

async function syncGitHub(context) {
  const url = String(toolboxConfiguration().get('catalogUrl', '') || '').trim();
  if (!url) throw new Error('copilotModels.catalogUrl is empty');
  const confirmed = await vscode.window.showInformationMessage(
    'Download the latest provider/model catalog from GitHub and merge it into Copilot Chat? ' +
      'Local API keys are preserved and are never uploaded.',
    { modal: true },
    'Sync GitHub'
  );
  if (confirmed !== 'Sync GitHub') return;

  output.clear();
  output.appendLine(`Downloading catalog: ${url}`);
  let summary;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '🔄 Syncing the AI model catalog from GitHub',
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      try {
        const response = await core.httpRequest(url, {
          timeoutMs: 30000,
          signal: controller.signal,
          maxBytes: 8 * 1024 * 1024,
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`GitHub returned HTTP ${response.status}`);
        }
        summary = await writeSyncedCatalog(context, response.text);
        output.appendLine(
          `Validated ${summary.providerCount} providers and ${summary.modelCount} models.`
        );
        await runHelper(context, [], token);
      } finally {
        cancellation.dispose();
      }
    }
  );
  await copyRestartCommand(
    `GitHub catalog synchronized (${summary.providerCount} providers, ${summary.modelCount} models).`
  );
}

async function readConfiguredGroups(context) {
  const filename = configuredPaths(context).configFile;
  let text;
  try {
    text = await fsp.readFile(filename, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${filename}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${filename} is not valid JSON: ${error.message}`);
  }
}

async function discoverOllama(group, timeoutMs, signal) {
  const response = await core.httpRequest(core.ollamaUrl(group.url, '/api/tags'), {
    timeoutMs,
    signal,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}: ${core.compactError(response.text)}`);
  }
  const value = JSON.parse(response.text);
  if (!value || !Array.isArray(value.models)) {
    throw new Error('Ollama /api/tags returned no models array');
  }
  return value.models
    .map((model) => String((model && (model.name || model.model)) || '').trim())
    .filter(Boolean)
    .map((id) => ({ kind: 'ollama', provider: group.provider, id, url: group.url }));
}

async function testOneModel(model, timeoutMs, signal) {
  const started = Date.now();
  let response;
  if (model.kind === 'ollama') {
    response = await core.requestJson(
      core.ollamaUrl(model.url, '/api/chat'),
      {
        model: model.id,
        messages: [{ role: 'user', content: 'Reply only with OK.' }],
        stream: false,
        options: { num_predict: 8 },
      },
      { timeoutMs, signal }
    );
  } else {
    const headers = model.apiKey
      ? { Authorization: `Bearer ${model.apiKey}` }
      : {};
    response = await core.requestJson(
      core.chatCompletionsUrl(model.url),
      {
        model: model.id,
        messages: [{ role: 'user', content: 'Reply only with OK.' }],
        max_tokens: 8,
        stream: false,
      },
      { headers, timeoutMs, signal }
    );
  }

  const elapsedMs = Date.now() - started;
  let body;
  try {
    body = JSON.parse(response.text);
  } catch {
    body = undefined;
  }
  const successfulStatus = response.status >= 200 && response.status < 300;
  const apiError = body && body.error;
  if (successfulStatus && !apiError) {
    return { ok: true, status: response.status, elapsedMs };
  }
  const detail = apiError ? JSON.stringify(apiError) : response.text;
  return {
    ok: false,
    status: response.status,
    elapsedMs,
    error: core.compactError(detail, model.apiKey),
  };
}

async function testAllModels(context) {
  const configuration = toolboxConfiguration();
  const concurrency = Math.max(1, Math.min(8, Number(configuration.get('testConcurrency', 2))));
  const timeoutMs =
    Math.max(5, Math.min(180, Number(configuration.get('testTimeoutSeconds', 30)))) * 1000;
  const groups = await readConfiguredGroups(context);
  const configured = core.collectConfiguredModels(groups);
  const discoveryController = new AbortController();
  const discoveryWarnings = [];

  for (const group of configured.ollamaGroups) {
    try {
      const found = await discoverOllama(group, Math.min(timeoutMs, 10000), discoveryController.signal);
      configured.models.push(...found);
    } catch (error) {
      discoveryWarnings.push(`${group.provider}: ${error.message}`);
    }
  }
  if (configured.models.length === 0) {
    throw new Error('No configured AI models were found to test');
  }

  const confirmed = await vscode.window.showWarningMessage(
    `This sends ${configured.models.length} real inference requests with up to 8 output tokens. ` +
      'Provider charges, quotas, and rate limits may apply.',
    { modal: true },
    'Test All Models'
  );
  if (confirmed !== 'Test All Models') return;

  output.clear();
  output.appendLine(`AI model test started: ${new Date().toISOString()}`);
  output.appendLine(
    `Models: ${configured.models.length}; concurrency: ${concurrency}; timeout: ${timeoutMs / 1000}s`
  );
  for (const warning of [...configured.warnings, ...discoveryWarnings]) {
    output.appendLine(`[WARN] ${warning}`);
  }

  const results = [];
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '🧪 Testing all configured AI models',
      cancellable: true,
    },
    async (progress, token) => {
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      let nextIndex = 0;
      let completed = 0;
      const worker = async () => {
        while (!controller.signal.aborted) {
          const index = nextIndex++;
          if (index >= configured.models.length) return;
          const model = configured.models[index];
          let result;
          try {
            result = await testOneModel(model, timeoutMs, controller.signal);
          } catch (error) {
            result = {
              ok: false,
              status: 0,
              elapsedMs: 0,
              error: core.compactError(error.message, model.apiKey),
            };
          }
          results.push({ model, ...result });
          completed += 1;
          const label = `${model.provider} :: ${model.id}`;
          if (result.ok) {
            output.appendLine(`[PASS] ${label} (HTTP ${result.status}, ${result.elapsedMs}ms)`);
          } else {
            output.appendLine(
              `[FAIL] ${label} (${result.status ? `HTTP ${result.status}` : 'network'}, ` +
                `${result.elapsedMs}ms) ${result.error || ''}`
            );
          }
          progress.report({
            increment: 100 / configured.models.length,
            message: `${completed}/${configured.models.length}: ${model.id}`,
          });
        }
      };
      try {
        await Promise.all(
          Array.from({ length: Math.min(concurrency, configured.models.length) }, () => worker())
        );
      } finally {
        cancellation.dispose();
      }
    }
  );

  const passed = results.filter((result) => result.ok).length;
  const failed = results.length - passed;
  const cancelled = results.length < configured.models.length;
  output.appendLine('');
  output.appendLine(
    `Summary: ${passed} passed, ${failed} failed` +
      (cancelled ? `, ${configured.models.length - results.length} cancelled` : '')
  );
  output.show(true);
  const choice = await vscode.window.showInformationMessage(
    `AI model test complete: ${passed} passed, ${failed} failed${cancelled ? ' (cancelled)' : ''}.`,
    'Open Report'
  );
  if (choice === 'Open Report') output.show(true);
}

function registerCommand(context, command, callback) {
  context.subscriptions.push(
    vscode.commands.registerCommand(command, async () => {
      try {
        await callback(context);
      } catch (error) {
        output.appendLine(`[ERROR] ${error.stack || error.message || String(error)}`);
        output.show(true);
        vscode.window.showErrorMessage(`Copilot Models Toolbox: ${error.message || error}`);
      }
    })
  );
}

function activate(context) {
  output = vscode.window.createOutputChannel(OUTPUT_NAME);
  output.appendLine(
    `Copilot Models Toolbox v${extensionPackage.version} activated from ${context.extensionPath}`
  );
  context.subscriptions.push(output);
  registerCommand(context, 'copilotModels.testAll', testAllModels);
  registerCommand(context, 'copilotModels.importJson', importJson);
  registerCommand(context, 'copilotModels.syncGitHub', syncGitHub);
}

function deactivate() {}

module.exports = { activate, deactivate };
