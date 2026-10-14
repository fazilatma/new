'use strict';

const cp = require('child_process');
const crypto = require('crypto');
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
const activePanels = new Set();
let autoUpdateTimer;
let autoUpdateInitialTimer;
let updateInProgress = false;
let lastInstalledVersion;

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

function runProcess(command, args, token, environment = process.env) {
  return new Promise((resolve, reject) => {
    output.appendLine(`$ ${command} ${args.map((value) => JSON.stringify(value)).join(' ')}`);
    const child = cp.spawn(command, args, {
      env: environment,
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
  let helperResult;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Importing AI providers into Copilot Chat',
      cancellable: true,
    },
    async (_progress, token) => {
      helperResult = await runHelper(
        context,
        ['--source', source, '--import-source-keys'],
        token
      );
    }
  );
  const lines = helperResult.stdout.split(/\r?\n/);
  const credentialLine = lines.find((line) => line.startsWith('Credential import:'));
  const missingKeys = lines.filter((line) => /^\s+no-key\s/.test(line));
  if (missingKeys.length) {
    output.show(true);
    await vscode.window.showWarningMessage(
      `${credentialLine || 'Import completed.'} ${missingKeys.length} provider entries had no usable embedded key. Details are open in the output panel.`,
      { modal: true },
      'Continue'
    );
  }
  await copyRestartCommand(
    `AI providers were imported. ${credentialLine || 'Credential diagnostics are in the output panel.'}`
  );
}

function validateGitHubTarget(repository, branch) {
  const cleanRepository = String(repository || '').trim();
  const cleanBranch = String(branch || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cleanRepository)) {
    throw new Error('Repository must use owner/name format');
  }
  if (
    !cleanBranch ||
    cleanBranch.startsWith('/') ||
    cleanBranch.endsWith('/') ||
    cleanBranch.includes('..') ||
    !/^[A-Za-z0-9._/-]+$/.test(cleanBranch)
  ) {
    throw new Error('Branch contains unsupported characters');
  }
  return { repository: cleanRepository, branch: cleanBranch };
}

function githubRawBase(repository, branch) {
  const target = validateGitHubTarget(repository, branch);
  const encodedRepository = target.repository
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  const encodedBranch = target.branch.split('/').map(encodeURIComponent).join('/');
  return `https://raw.githubusercontent.com/${encodedRepository}/refs/heads/${encodedBranch}/host-helpers`;
}

function compareVersions(left, right) {
  const parse = (value) => String(value).split(/[+-]/, 1)[0].split('.').map((item) => Number(item) || 0);
  const a = parse(left); const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

async function remoteToolboxVersion(repository, branch, signal) {
  const rawBase = githubRawBase(repository, branch);
  const response = await core.httpRequest(`${rawBase}/copilot-models-toolbox/package.json`, {
    timeoutMs: 30000,
    signal,
    maxBytes: 512 * 1024,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`GitHub returned HTTP ${response.status} for toolbox package.json`);
  }
  let value;
  try {
    value = JSON.parse(response.text);
  } catch (error) {
    throw new Error(`Remote package.json is invalid: ${error.message}`);
  }
  if (
    !value.version ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(String(value.version))
  ) {
    throw new Error('Remote package.json has no valid semantic version');
  }
  return { version: String(value.version), rawBase };
}

async function saveGitHubSettings(repository, branch, autoUpdate, intervalMinutes) {
  const target = validateGitHubTarget(repository, branch);
  const interval = Math.max(5, Math.min(1440, Number(intervalMinutes) || 15));
  const configuration = toolboxConfiguration();
  await configuration.update('githubRepository', target.repository, vscode.ConfigurationTarget.Global);
  await configuration.update('githubBranch', target.branch, vscode.ConfigurationTarget.Global);
  await configuration.update('autoUpdate', Boolean(autoUpdate), vscode.ConfigurationTarget.Global);
  await configuration.update('autoUpdateIntervalMinutes', interval, vscode.ConfigurationTarget.Global);
  return { ...target, autoUpdate: Boolean(autoUpdate), intervalMinutes: interval };
}

async function performFullGitHubUpdate(context, repository, branch, reportStatus) {
  if (updateInProgress) throw new Error('Another GitHub update is already running');
  updateInProgress = true;
  const report = (message, level = 'info') => {
    output.appendLine(`[GitHub ${level.toUpperCase()}] ${message}`);
    if (reportStatus) reportStatus(message, level);
  };
  try {
    const remote = await remoteToolboxVersion(repository, branch);
    report(`Remote toolbox v${remote.version}; installed v${extensionPackage.version}.`);
    report('Downloading the branch installer…');
    const installerResponse = await core.httpRequest(
      `${remote.rawBase}/install-copilot-models-termux.sh`,
      { timeoutMs: 30000, maxBytes: 2 * 1024 * 1024 }
    );
    if (installerResponse.status < 200 || installerResponse.status >= 300) {
      throw new Error(`GitHub returned HTTP ${installerResponse.status} for installer`);
    }
    const updateDirectory = path.join(context.globalStorageUri.fsPath, 'github-update');
    await fsp.mkdir(updateDirectory, { recursive: true, mode: 0o700 });
    const installer = path.join(updateDirectory, 'install-copilot-models-termux.sh');
    await fsp.writeFile(installer, installerResponse.text, { encoding: 'utf8', mode: 0o700 });
    await fsp.chmod(installer, 0o700);
    const paths = configuredPaths(context);
    const bash =
      (process.env.PREFIX && path.join(process.env.PREFIX, 'bin', 'bash')) || 'bash';
    report('Installing helper, catalog, terminal settings, and toolbar through code-server…');
    await runProcess(
      bash,
      [
        installer,
        '--no-discover',
        '--enable-terminal',
        '--preserve-existing-keys',
        '--config-file',
        paths.configFile,
        '--settings-file',
        paths.settingsFile,
      ],
      undefined,
      { ...process.env, COPILOT_MODELS_RAW_BASE: remote.rawBase }
    );
    await fsp.rm(runtimePaths(context).syncedCatalog, { force: true });
    lastInstalledVersion = remote.version;
    report(`Full branch update to v${remote.version} completed. A code-server restart is required.`, 'success');
    return remote.version;
  } catch (error) {
    report(error.message || String(error), 'error');
    throw error;
  } finally {
    updateInProgress = false;
  }
}

function githubSyncHtml(settings) {
  const scriptNonce = nonce();
  const initial = webviewJson(settings);
  return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${scriptNonce}'; script-src 'nonce-${scriptNonce}';">
<style nonce="${scriptNonce}">
body{padding:22px;color:var(--vscode-foreground);background:var(--vscode-editor-background);font-family:var(--vscode-font-family)}
.panel{max-width:760px;margin:auto;border:1px solid var(--vscode-panel-border);border-radius:8px;padding:18px;background:var(--vscode-sideBar-background)}
h1{margin-top:0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:block;font-weight:600;margin-bottom:5px}input[type=text],input[type=number]{width:100%;padding:8px;color:var(--vscode-input-foreground);background:var(--vscode-input-background);border:1px solid var(--vscode-input-border)}
.row{margin:14px 0}.actions{display:flex;gap:8px;flex-wrap:wrap}button{padding:8px 12px;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;border-radius:3px}button:disabled{opacity:.5}pre{min-height:170px;max-height:360px;overflow:auto;white-space:pre-wrap;padding:10px;background:var(--vscode-textCodeBlock-background);user-select:text}.note{color:var(--vscode-descriptionForeground)}.success{color:var(--vscode-testing-iconPassed,#2ea043)}.error{color:var(--vscode-testing-iconFailed,#f85149)}
@media(max-width:650px){.grid{grid-template-columns:1fr}}
</style></head><body><div class="panel">
<h1>🔄 GitHub Full Update <small>v${extensionPackage.version}</small></h1>
<p class="note">Pulls helper, model catalog, terminal integration, and this toolbox from the selected branch. Local API keys are preserved and nothing is uploaded.</p>
<div class="grid"><div><label for="repository">Repository (owner/name)</label><input id="repository" type="text"></div><div><label for="branch">Branch</label><input id="branch" type="text"></div></div>
<div class="row"><label><input id="auto" type="checkbox"> Enable automatic update checks</label></div>
<div class="row"><label for="interval">Check interval (minutes)</label><input id="interval" type="number" min="5" max="1440"></div>
<div class="actions"><button id="save">Save settings</button><button id="check">Check version</button><button id="update">Update now</button><button id="restart">Copy restart command</button></div>
<h3>Live update log</h3><pre id="log"></pre>
</div><script nonce="${scriptNonce}">
const vscode=acquireVsCodeApi();const initial=${initial};
const repository=document.getElementById('repository'),branch=document.getElementById('branch'),auto=document.getElementById('auto'),interval=document.getElementById('interval'),log=document.getElementById('log');
repository.value=initial.repository;branch.value=initial.branch;auto.checked=initial.autoUpdate;interval.value=initial.intervalMinutes;
function payload(type){return{type,repository:repository.value,branch:branch.value,autoUpdate:auto.checked,intervalMinutes:Number(interval.value)}}
function busy(value){document.getElementById('update').disabled=value;document.getElementById('check').disabled=value}
document.getElementById('save').onclick=()=>vscode.postMessage(payload('save'));
document.getElementById('check').onclick=()=>{busy(true);vscode.postMessage(payload('check'))};
document.getElementById('update').onclick=()=>{busy(true);vscode.postMessage(payload('update'))};
document.getElementById('restart').onclick=()=>vscode.postMessage({type:'copyRestart'});
window.addEventListener('message',event=>{const message=event.data;if(message.type==='status'){const line=document.createElement('div');line.className=message.level||'';line.textContent=new Date().toLocaleTimeString()+'  '+message.message;log.appendChild(line);log.scrollTop=log.scrollHeight;if(message.done)busy(false)}});
</script></body></html>`;
}

function restartAutoUpdater(context) {
  if (autoUpdateTimer) clearInterval(autoUpdateTimer);
  if (autoUpdateInitialTimer) clearTimeout(autoUpdateInitialTimer);
  autoUpdateTimer = undefined;
  autoUpdateInitialTimer = undefined;
  const configuration = toolboxConfiguration();
  if (!configuration.get('autoUpdate', false)) return;
  const intervalMinutes = Math.max(
    5,
    Math.min(1440, Number(configuration.get('autoUpdateIntervalMinutes', 15)))
  );
  const check = async () => {
    if (updateInProgress) return;
    const repository = configuration.get('githubRepository', 'fazilatma/new');
    const branch = configuration.get('githubBranch', 'arena/f1997f2f-new');
    try {
      const remote = await remoteToolboxVersion(repository, branch);
      if (
        compareVersions(remote.version, extensionPackage.version) > 0 &&
        remote.version !== lastInstalledVersion
      ) {
        const installed = await performFullGitHubUpdate(context, repository, branch);
        vscode.window.showInformationMessage(
          `Copilot Models Toolbox v${installed} installed automatically. Restart code-server to activate it.`,
          'Copy Restart Command'
        ).then((choice) => {
          if (choice === 'Copy Restart Command') vscode.env.clipboard.writeText(RESTART_COMMAND);
        });
      }
    } catch (error) {
      output.appendLine(`[AUTO UPDATE ERROR] ${error.message || error}`);
    }
  };
  autoUpdateInitialTimer = setTimeout(check, 10000);
  autoUpdateTimer = setInterval(check, intervalMinutes * 60 * 1000);
}

async function syncGitHub(context) {
  const configuration = toolboxConfiguration();
  const settings = {
    repository: configuration.get('githubRepository', 'fazilatma/new'),
    branch: configuration.get('githubBranch', 'arena/f1997f2f-new'),
    autoUpdate: configuration.get('autoUpdate', false),
    intervalMinutes: configuration.get('autoUpdateIntervalMinutes', 15),
  };
  const panel = vscode.window.createWebviewPanel(
    'copilotModels.githubSync',
    `GitHub Full Update v${extensionPackage.version}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  activePanels.add(panel);
  panel.webview.html = githubSyncHtml(settings);
  const postStatus = (message, level = 'info', done = false) =>
    panel.webview.postMessage({ type: 'status', message, level, done });
  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      if (['save', 'check', 'update'].includes(message.type)) {
        const saved = await saveGitHubSettings(
          message.repository,
          message.branch,
          message.autoUpdate,
          message.intervalMinutes
        );
        restartAutoUpdater(context);
        postStatus(`Saved ${saved.repository} @ ${saved.branch}; auto-update ${saved.autoUpdate ? 'enabled' : 'disabled'}.`, 'success', message.type === 'save');
        if (message.type === 'check') {
          const remote = await remoteToolboxVersion(saved.repository, saved.branch);
          postStatus(`Installed v${extensionPackage.version}; branch has v${remote.version}.`, compareVersions(remote.version, extensionPackage.version) > 0 ? 'success' : 'info', true);
        } else if (message.type === 'update') {
          const installed = await performFullGitHubUpdate(
            context,
            saved.repository,
            saved.branch,
            (text, level) => postStatus(text, level)
          );
          postStatus(`v${installed} installed. Restart code-server to load all changes.`, 'success', true);
        }
      } else if (message.type === 'copyRestart') {
        await vscode.env.clipboard.writeText(RESTART_COMMAND);
        postStatus('Restart command copied.', 'success', true);
      }
    } catch (error) {
      postStatus(error.message || String(error), 'error', true);
    }
  });
  panel.onDidDispose(() => activePanels.delete(panel));
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

function credentialSummary(model) {
  if (model.kind === 'ollama') return 'Local · no key';
  if (!model.apiKey) return 'Missing';
  const fingerprint = crypto
    .createHash('sha256')
    .update(model.apiKey)
    .digest('hex')
    .slice(0, 10);
  return `Present · ${model.apiKey.length} chars · ${fingerprint}`;
}

function nonce() {
  return crypto.randomBytes(18).toString('base64');
}

function webviewJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function testDashboardHtml(webview, models, warnings, options) {
  const scriptNonce = nonce();
  const publicModels = models.map((model) => ({
    key: model.testKey,
    provider: model.provider,
    model: model.id,
    kind: model.kind,
    credential: credentialSummary(model),
  }));
  const initial = webviewJson({
    models: publicModels,
    warnings,
    concurrency: options.concurrency,
    timeoutSeconds: options.timeoutMs / 1000,
    version: extensionPackage.version,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${scriptNonce}'; script-src 'nonce-${scriptNonce}';">
  <style nonce="${scriptNonce}">
    :root { color-scheme: light dark; }
    body { margin: 0; padding: 18px; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
    * { box-sizing: border-box; }
    h1 { margin: 0 0 4px; font-size: 22px; }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 14px; }
    .notice { border: 1px solid var(--vscode-inputValidation-warningBorder); background: var(--vscode-inputValidation-warningBackground); padding: 10px 12px; border-radius: 6px; margin: 12px 0; }
    .warnings { color: var(--vscode-editorWarning-foreground); margin: 6px 0; white-space: pre-wrap; }
    .cards { display: grid; grid-template-columns: repeat(6, minmax(90px, 1fr)); gap: 8px; margin: 12px 0; }
    .card { padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-sideBar-background); }
    .card b { display: block; font-size: 19px; }
    .card span { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .toolbar, .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 0; }
    button, select, input { border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; padding: 6px 10px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .5; cursor: not-allowed; }
    input, select { color: var(--vscode-input-foreground); background: var(--vscode-input-background); border-color: var(--vscode-input-border); }
    input { min-width: 260px; flex: 1; }
    progress { width: 100%; height: 10px; accent-color: var(--vscode-progressBar-background); }
    .table-wrap { border: 1px solid var(--vscode-panel-border); overflow: auto; max-height: calc(100vh - 330px); }
    table { width: 100%; border-collapse: collapse; min-width: 1050px; }
    th { position: sticky; top: 0; z-index: 2; text-align: left; background: var(--vscode-editorGroupHeader-tabsBackground); }
    th, td { padding: 7px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
    tr:hover { background: var(--vscode-list-hoverBackground); }
    .status { display: inline-block; min-width: 74px; text-align: center; border-radius: 999px; padding: 2px 8px; font-size: 12px; font-weight: 600; }
    .pending, .queued { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .running { background: var(--vscode-progressBar-background); color: white; }
    .pass { background: var(--vscode-testing-iconPassed, #2ea043); color: var(--vscode-editor-background); }
    .fail { background: var(--vscode-testing-iconFailed, #f85149); color: white; }
    .cancelled { background: var(--vscode-descriptionForeground); color: var(--vscode-editor-background); }
    .credential-missing { color: var(--vscode-testing-iconFailed); font-weight: 600; }
    details { max-width: 520px; }
    pre { white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow: auto; padding: 8px; background: var(--vscode-textCodeBlock-background); user-select: text; }
    .copy { margin-top: 5px; padding: 3px 7px; }
    .empty { color: var(--vscode-descriptionForeground); }
    @media (max-width: 800px) { .cards { grid-template-columns: repeat(3, 1fr); } body { padding: 10px; } }
  </style>
</head>
<body>
  <h1>🧪 AI Model Test Center <small>v${extensionPackage.version}</small></h1>
  <div class="subtitle">Live inference diagnostics for every configured Copilot Chat model</div>
  <div class="notice"><b>Cost and quota warning:</b> Start sends one real, non-streaming inference request to each listed model with up to 8 output tokens. Provider charges and rate limits may apply. No API key is displayed.</div>
  <div id="warnings" class="warnings"></div>
  <div class="cards">
    <div class="card"><b id="total">0</b><span>Total</span></div>
    <div class="card"><b id="pending">0</b><span>Pending</span></div>
    <div class="card"><b id="running">0</b><span>Running</span></div>
    <div class="card"><b id="passed">0</b><span>Passed</span></div>
    <div class="card"><b id="failed">0</b><span>Failed</span></div>
    <div class="card"><b id="cancelled">0</b><span>Cancelled</span></div>
  </div>
  <progress id="progress" value="0" max="100"></progress>
  <div class="toolbar">
    <button id="start">▶ Start all real tests</button>
    <button id="cancel" disabled>■ Cancel</button>
    <button id="retry" disabled>↻ Retry failed</button>
    <button id="copyAll" disabled>⧉ Copy all errors</button>
    <button id="export">⇩ Export JSON report</button>
    <span id="runInfo"></span>
  </div>
  <div class="filters">
    <input id="search" type="search" placeholder="Search provider, model, key status, or error...">
    <select id="provider"><option value="">All providers</option></select>
    <select id="status">
      <option value="">All statuses</option><option>pending</option><option>queued</option><option>running</option><option>pass</option><option>fail</option><option>cancelled</option>
    </select>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>#</th><th>Provider</th><th>Model</th><th>Credential</th><th>Status</th><th>HTTP</th><th>Latency</th><th>Error details</th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
  </div>
  <script nonce="${scriptNonce}">
    const vscode = acquireVsCodeApi();
    const initial = ${initial};
    const rowElements = new Map();
    const results = new Map();
    const rows = document.getElementById('rows');
    const providerFilter = document.getElementById('provider');
    const statusFilter = document.getElementById('status');
    const search = document.getElementById('search');
    const start = document.getElementById('start');
    const cancel = document.getElementById('cancel');
    const retry = document.getElementById('retry');
    const copyAll = document.getElementById('copyAll');
    const providers = [...new Set(initial.models.map((item) => item.provider))].sort();
    for (const provider of providers) {
      const option = document.createElement('option'); option.value = provider; option.textContent = provider; providerFilter.appendChild(option);
    }
    document.getElementById('warnings').textContent = initial.warnings.join('\\n');
    document.getElementById('runInfo').textContent = 'Concurrency ' + initial.concurrency + ' · timeout ' + initial.timeoutSeconds + 's';

    function cell(text) { const td = document.createElement('td'); td.textContent = text; return td; }
    function renderError(td, result) {
      td.replaceChildren();
      if (!result || !result.error) { const span = document.createElement('span'); span.className = 'empty'; span.textContent = '—'; td.appendChild(span); return; }
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = result.error.slice(0, 120) + (result.error.length > 120 ? '…' : '');
      const pre = document.createElement('pre'); pre.textContent = result.error;
      const button = document.createElement('button'); button.className = 'copy'; button.textContent = 'Copy error';
      button.addEventListener('click', () => vscode.postMessage({ type: 'copy', text: result.error }));
      details.append(summary, pre, button); td.appendChild(details);
    }
    function addRow(item, index) {
      const tr = document.createElement('tr'); tr.dataset.key = item.key; tr.dataset.provider = item.provider; tr.dataset.status = 'pending';
      tr.append(cell(String(index + 1)), cell(item.provider), cell(item.model));
      const credential = cell(item.credential); if (item.credential === 'Missing') credential.className = 'credential-missing'; tr.appendChild(credential);
      const status = cell('pending'); const badge = document.createElement('span'); badge.className = 'status pending'; badge.textContent = 'pending'; status.replaceChildren(badge); tr.appendChild(status);
      tr.append(cell('—'), cell('—'));
      const error = cell(''); renderError(error, null); tr.appendChild(error);
      rows.appendChild(tr); rowElements.set(item.key, { tr, badge, http: tr.children[5], latency: tr.children[6], error, item });
    }
    initial.models.forEach(addRow);

    function updateRow(message) {
      const row = rowElements.get(message.key); if (!row) return;
      row.tr.dataset.status = message.state;
      row.badge.className = 'status ' + message.state; row.badge.textContent = message.state;
      row.http.textContent = message.status ? String(message.status) : '—';
      row.latency.textContent = message.elapsedMs ? message.elapsedMs + ' ms' : '—';
      renderError(row.error, message);
      results.set(message.key, message);
      updateSummary(); applyFilters();
    }
    function updateSummary() {
      const counts = { pending: 0, queued: 0, running: 0, pass: 0, fail: 0, cancelled: 0 };
      for (const row of rowElements.values()) counts[row.tr.dataset.status] = (counts[row.tr.dataset.status] || 0) + 1;
      document.getElementById('total').textContent = initial.models.length;
      document.getElementById('pending').textContent = counts.pending + counts.queued;
      document.getElementById('running').textContent = counts.running;
      document.getElementById('passed').textContent = counts.pass;
      document.getElementById('failed').textContent = counts.fail;
      document.getElementById('cancelled').textContent = counts.cancelled;
      const completed = counts.pass + counts.fail + counts.cancelled;
      document.getElementById('progress').value = initial.models.length ? completed * 100 / initial.models.length : 0;
      retry.disabled = counts.fail === 0 || !cancel.disabled;
      copyAll.disabled = counts.fail === 0;
    }
    function applyFilters() {
      const query = search.value.trim().toLowerCase(); const provider = providerFilter.value; const status = statusFilter.value;
      for (const row of rowElements.values()) {
        const result = results.get(row.item.key); const haystack = [row.item.provider, row.item.model, row.item.credential, result && result.error].join(' ').toLowerCase();
        row.tr.hidden = Boolean((provider && row.item.provider !== provider) || (status && row.tr.dataset.status !== status) || (query && !haystack.includes(query)));
      }
    }
    function setRunning(value) { start.disabled = value; cancel.disabled = !value; retry.disabled = value || ![...rowElements.values()].some((row) => row.tr.dataset.status === 'fail'); }
    start.addEventListener('click', () => { setRunning(true); document.getElementById('runInfo').textContent = 'Contacting the code-server extension host…'; vscode.postMessage({ type: 'start' }); });
    cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    retry.addEventListener('click', () => vscode.postMessage({ type: 'retryFailed' }));
    copyAll.addEventListener('click', () => {
      const errors = [...rowElements.values()].filter((row) => row.tr.dataset.status === 'fail').map((row) => { const result = results.get(row.item.key); return row.item.provider + ' :: ' + row.item.model + '\\n' + (result.error || 'Unknown error'); }).join('\\n\\n');
      vscode.postMessage({ type: 'copy', text: errors });
    });
    document.getElementById('export').addEventListener('click', () => vscode.postMessage({ type: 'export' }));
    search.addEventListener('input', applyFilters); providerFilter.addEventListener('change', applyFilters); statusFilter.addEventListener('change', applyFilters);
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'runStarted') {
        for (const key of message.keys) updateRow({ key, state: 'queued', status: 0, elapsedMs: 0, error: '' });
        setRunning(true); document.getElementById('runInfo').textContent = 'Running ' + message.keys.length + ' model tests…';
      } else if (message.type === 'row') updateRow(message);
      else if (message.type === 'runDone') {
        setRunning(false); start.textContent = '▶ Run all again';
        document.getElementById('runInfo').textContent = message.summary;
      }
    });
    updateSummary();
  </script>
</body>
</html>`;
}

async function exportTestReport(context, models, results) {
  const target = await vscode.window.showSaveDialog({
    title: 'Export AI model test report',
    saveLabel: 'Export JSON report',
    defaultUri: vscode.Uri.file(path.join(os.homedir(), `ai-model-test-${Date.now()}.json`)),
    filters: { JSON: ['json'] },
  });
  if (!target) return;
  const report = {
    version: extensionPackage.version,
    generatedAt: new Date().toISOString(),
    models: models.map((model) => ({
      provider: model.provider,
      model: model.id,
      kind: model.kind,
      credential: credentialSummary(model),
      result: results.get(model.testKey) || { state: 'pending' },
    })),
  };
  await fsp.writeFile(target.fsPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  vscode.window.showInformationMessage(`Model test report exported to ${target.fsPath}`);
}

function openTestDashboard(context, models, warnings, options) {
  const panel = vscode.window.createWebviewPanel(
    'copilotModels.testDashboard',
    `AI Model Test Center v${extensionPackage.version}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  activePanels.add(panel);
  panel.webview.html = testDashboardHtml(panel.webview, models, warnings, options);
  const results = new Map();
  let activeController;
  let running = false;

  const run = async (selectedKeys) => {
    if (running) return;
    const selected = models.filter((model) => selectedKeys.includes(model.testKey));
    if (selected.length === 0) return;
    running = true;
    activeController = new AbortController();
    const attempted = new Set();
    for (const model of selected) results.delete(model.testKey);
    panel.webview.postMessage({ type: 'runStarted', keys: selected.map((model) => model.testKey) });
    output.clear();
    output.appendLine(`AI model dashboard run started: ${new Date().toISOString()}`);
    let nextIndex = 0;
    const worker = async () => {
      while (!activeController.signal.aborted) {
        const index = nextIndex++;
        if (index >= selected.length) return;
        const model = selected[index];
        attempted.add(model.testKey);
        panel.webview.postMessage({ type: 'row', key: model.testKey, state: 'running', status: 0, elapsedMs: 0, error: '' });
        let tested;
        try {
          tested = await testOneModel(model, options.timeoutMs, activeController.signal);
        } catch (error) {
          tested = {
            ok: false,
            status: 0,
            elapsedMs: 0,
            error: core.compactError(error.message, model.apiKey),
          };
        }
        let state = tested.ok ? 'pass' : 'fail';
        if (activeController.signal.aborted && tested.error === 'Cancelled') state = 'cancelled';
        if (!tested.ok && [401, 403].includes(tested.status)) {
          tested.error = `Authentication or authorization failed (HTTP ${tested.status}). Credential: ${credentialSummary(model)}. ${tested.error || ''}`;
        } else if (!tested.ok && !model.apiKey && model.kind !== 'ollama') {
          tested.error = `No API key is configured for this provider. ${tested.error || ''}`;
        }
        const result = { state, status: tested.status, elapsedMs: tested.elapsedMs, error: tested.error || '' };
        results.set(model.testKey, result);
        panel.webview.postMessage({ type: 'row', key: model.testKey, ...result });
        const label = `${model.provider} :: ${model.id}`;
        output.appendLine(
          `[${state.toUpperCase()}] ${label} (${tested.status ? `HTTP ${tested.status}` : 'network'}, ${tested.elapsedMs}ms)` +
            (tested.error ? ` ${core.compactError(tested.error, '', 500)}` : '')
        );
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(options.concurrency, selected.length) }, () => worker())
      );
      if (activeController.signal.aborted) {
        for (const model of selected) {
          if (attempted.has(model.testKey)) continue;
          const result = { state: 'cancelled', status: 0, elapsedMs: 0, error: 'Cancelled before request started.' };
          results.set(model.testKey, result);
          panel.webview.postMessage({ type: 'row', key: model.testKey, ...result });
        }
      }
    } finally {
      running = false;
      const selectedResults = selected.map((model) => results.get(model.testKey)).filter(Boolean);
      const passed = selectedResults.filter((result) => result.state === 'pass').length;
      const failed = selectedResults.filter((result) => result.state === 'fail').length;
      const cancelled = selectedResults.filter((result) => result.state === 'cancelled').length;
      const summary = `${passed} passed · ${failed} failed · ${cancelled} cancelled`;
      panel.webview.postMessage({ type: 'runDone', summary });
      output.appendLine(`Summary: ${summary}`);
    }
  };

  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      if (message.type === 'start') {
        await run(models.map((model) => model.testKey));
      } else if (message.type === 'retryFailed') {
        await run(
          models
            .filter((model) => results.get(model.testKey)?.state === 'fail')
            .map((model) => model.testKey)
        );
      } else if (message.type === 'cancel' && activeController) {
        activeController.abort();
      } else if (message.type === 'copy') {
        await vscode.env.clipboard.writeText(String(message.text || ''));
        vscode.window.showInformationMessage('Error text copied.');
      } else if (message.type === 'export') {
        await exportTestReport(context, models, results);
      }
    } catch (error) {
      output.appendLine(`[ERROR] ${error.stack || error.message || String(error)}`);
      panel.webview.postMessage({
        type: 'runDone',
        summary: `Dashboard error: ${error.message || error}`,
      });
      vscode.window.showErrorMessage(`Model test dashboard: ${error.message || error}`);
    }
  });
  panel.onDidDispose(() => {
    activePanels.delete(panel);
    if (activeController) activeController.abort();
  });
}

async function testAllModels(context) {
  const configuration = toolboxConfiguration();
  const concurrency = Math.max(1, Math.min(8, Number(configuration.get('testConcurrency', 2))));
  const timeoutMs =
    Math.max(5, Math.min(180, Number(configuration.get('testTimeoutSeconds', 30)))) * 1000;
  const groups = await readConfiguredGroups(context);
  const configured = core.collectConfiguredModels(groups);
  const discoveryWarnings = [];
  for (const group of configured.ollamaGroups) {
    try {
      const found = await discoverOllama(
        group,
        Math.min(timeoutMs, 10000),
        new AbortController().signal
      );
      configured.models.push(...found);
    } catch (error) {
      discoveryWarnings.push(`${group.provider}: ${error.message}`);
    }
  }
  if (configured.models.length === 0) {
    throw new Error('No configured AI models were found to test');
  }
  const models = configured.models.map((model, index) => ({
    ...model,
    testKey: `model-${index}`,
  }));
  openTestDashboard(
    context,
    models,
    [...configured.warnings, ...discoveryWarnings],
    { concurrency, timeoutMs }
  );
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
  restartAutoUpdater(context);
}

function deactivate() {
  if (autoUpdateTimer) clearInterval(autoUpdateTimer);
  if (autoUpdateInitialTimer) clearTimeout(autoUpdateInitialTimer);
  autoUpdateTimer = undefined;
  autoUpdateInitialTimer = undefined;
  for (const panel of activePanels) panel.dispose();
  activePanels.clear();
}

module.exports = {
  activate,
  deactivate,
  __test: { credentialSummary, githubSyncHtml, testDashboardHtml },
};
