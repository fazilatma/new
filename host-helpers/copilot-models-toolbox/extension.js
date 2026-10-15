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
const CHAT_BIDI_STYLE_BEGIN = '/* copilot-models-chat-bidi:start */';
const CHAT_BIDI_STYLE_END = '/* copilot-models-chat-bidi:end */';
const CHAT_BIDI_STYLE = `${CHAT_BIDI_STYLE_BEGIN}
/* Persian-first chat prose with readable isolated English/code runs. */
.monaco-workbench .interactive-session .interactive-item-container.interactive-response .value .rendered-markdown,
.monaco-workbench .interactive-session .interactive-item-container.interactive-request .value .rendered-markdown,
.monaco-workbench .interactive-session .interactive-item-container:is(.interactive-response, .interactive-request) .value .rendered-markdown :is(p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th) {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: plaintext !important;
}
.monaco-workbench .interactive-session .interactive-input-editor .monaco-editor .view-lines,
.monaco-workbench .interactive-session .interactive-input-editor .monaco-editor .view-line,
.monaco-workbench .interactive-session .interactive-input-editor .monaco-editor .editor-placeholder,
.monaco-workbench .interactive-session .interactive-input-editor .monaco-editor textarea.inputarea,
.monaco-workbench .interactive-session .interactive-input-editor .monaco-editor .native-edit-context {
  direction: rtl !important;
  text-align: right !important;
  unicode-bidi: plaintext !important;
}
.monaco-workbench .interactive-session .interactive-item-container .rendered-markdown :is(code, kbd, samp),
.monaco-workbench .interactive-session .interactive-item-container .monaco-editor,
.monaco-workbench .interactive-session .interactive-item-container :is(pre, [data-code], .interactive-result-code-block) {
  direction: ltr !important;
  text-align: left !important;
  unicode-bidi: isolate !important;
}
${CHAT_BIDI_STYLE_END}`;
const RESTART_COMMAND = [
  "pkill -f '[c]ode-server' || true",
  'sleep 1',
  'mkdir -p "$HOME/.local/share/code-server"',
  'nohup code-server >>"$HOME/.local/share/code-server/code-server.log" 2>&1 </dev/null &',
].join('\n');

const DEFAULT_IMPORT_JSON_FILENAME = 'ai-providers-2026-08-23-160523-gemini-llm7-opencode-ollama-cloud-added.json';
const SIMPLE_TEST_PROMPT = 'Reply with exactly one short, friendly greeting that contains the word Hello. Do not include code or an explanation.';

const DEFAULT_CODING_TEST_PROMPT = [
  'Act as a principal TypeScript systems engineer. Produce a self-contained strict TypeScript implementation of an async generic function scheduleByProvider<T, R>.',
  'Input jobs contain provider and value fields plus an async worker. Requirements: stable provider round-robin waves; bounded global maxConcurrency; never run two jobs from the same provider simultaneously; enforce minIntervalMs per provider; immediate AbortSignal cancellation with timer/listener cleanup; retry only HTTP 429 and 503 using capped exponential backoff with jitter; preserve original output order; and return typed aggregate failures without losing successful results.',
  'Use no dependencies. Explain the scheduling invariants and Big-O complexity. Include at least six executable node:test tests covering fairness, ordering, max concurrency, provider serialization, rate-limit retry, and cancellation. Do not omit implementation code or replace sections with placeholders.',
].join(' ');

let output;
const activePanels = new Set();
let autoUpdateTimer;
let autoUpdateInitialTimer;
let updateInProgress = false;
let restartScheduled = false;
let lastInstalledVersion;
let credentialMigrationPromise;

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

function toolboxCredentialKey(vendor, name) {
  const identity = `${String(vendor || '').toLowerCase()}\0${String(name || '')}`;
  return `provider-credential-${crypto.createHash('sha256').update(identity).digest('hex')}`;
}

async function writeJsonPrivate(filename, value) {
  await fsp.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fsp.chmod(temporary, 0o600);
  await fsp.rename(temporary, filename);
  await fsp.chmod(filename, 0o600);
}

async function migratePlaintextCredentialsNow(context) {
  if (!context.secrets || typeof vscode.commands.getCommands !== 'function') {
    return { migrated: 0, pending: 0, supported: false };
  }
  const configFile = configuredPaths(context).configFile;
  let groups;
  try {
    groups = JSON.parse(await fsp.readFile(configFile, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { migrated: 0, pending: 0, supported: true };
    }
    throw new Error(`Cannot inspect Chat credentials: ${error.message || error}`);
  }
  if (!Array.isArray(groups)) {
    throw new Error(`${configFile} must contain a JSON array`);
  }
  const targets = groups.filter(
    (group) =>
      group &&
      String(group.vendor || '').toLowerCase() === 'customoai' &&
      typeof group.name === 'string' &&
      typeof group.apiKey === 'string' &&
      group.apiKey.trim() &&
      !core.isChatSecretReference(group.apiKey)
  );
  if (!targets.length) {
    return { migrated: 0, pending: 0, supported: true };
  }

  const commands = await vscode.commands.getCommands(true);
  const addCommand = 'lm.addLanguageModelsProviderGroup';
  if (!commands.includes(addCommand)) {
    output.appendLine(
      `[CREDENTIAL WARNING] ${targets.length} plaintext provider key(s) cannot be used by this code-server Chat build because ${addCommand} is unavailable.`
    );
    return { migrated: 0, pending: targets.length, supported: false };
  }

  const staged = [];
  for (const group of targets) {
    const apiKey = group.apiKey.trim();
    const stageName = `${group.name} [Toolbox secure staging ${crypto.randomBytes(6).toString('hex')}]`;
    try {
      // Keep a second protected copy in this extension's SecretStorage so the
      // direct HTTP test center can test the same credential without reading
      // VS Code's private Chat secret namespace.
      await context.secrets.store(
        toolboxCredentialKey(group.vendor, group.name),
        apiKey
      );
      await vscode.commands.executeCommand(addCommand, {
        ...group,
        name: stageName,
        apiKey,
      });
      staged.push({
        vendor: group.vendor,
        originalName: group.name,
        stageName,
      });
    } catch (error) {
      output.appendLine(
        `[CREDENTIAL ERROR] Could not protect ${group.name}: ${error.message || error}`
      );
    }
  }

  if (staged.length) {
    const latest = JSON.parse(await fsp.readFile(configFile, 'utf8'));
    if (!Array.isArray(latest)) {
      throw new Error(`${configFile} changed to a non-array during credential migration`);
    }
    let migrated = 0;
    for (const item of staged) {
      const stageIndex = latest.findIndex(
        (group) =>
          group &&
          group.vendor === item.vendor &&
          group.name === item.stageName &&
          core.isChatSecretReference(group.apiKey)
      );
      if (stageIndex < 0) {
        output.appendLine(
          `[CREDENTIAL ERROR] Protected staging group for ${item.originalName} was not written by code-server.`
        );
        continue;
      }
      const secureGroup = { ...latest[stageIndex], name: item.originalName };
      const originalIndex = latest.findIndex(
        (group, index) =>
          index !== stageIndex &&
          group &&
          group.vendor === item.vendor &&
          group.name === item.originalName &&
          !core.isChatSecretReference(group.apiKey)
      );
      if (originalIndex >= 0) {
        latest[originalIndex] = secureGroup;
        latest.splice(stageIndex, 1);
      } else {
        latest[stageIndex] = secureGroup;
      }
      migrated += 1;
    }
    await writeJsonPrivate(configFile, latest);
    output.appendLine(
      `[CREDENTIALS] Migrated ${migrated} provider key(s) into code-server Chat SecretStorage; plaintext keys were removed from chatLanguageModels.json.`
    );
    return { migrated, pending: targets.length - migrated, supported: true };
  }
  return { migrated: 0, pending: targets.length, supported: true };
}

function migratePlaintextCredentials(context) {
  if (!credentialMigrationPromise) {
    credentialMigrationPromise = migratePlaintextCredentialsNow(context).finally(() => {
      credentialMigrationPromise = undefined;
    });
  }
  return credentialMigrationPromise;
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

function backupRoot(context) {
  return path.join(context.globalStorageUri.fsPath, 'backups');
}

function codeServerWorkbenchStylesheets() {
  const environment = termuxRuntimeEnvironment();
  const roots = [];
  if (process.env.CODE_SERVER_VSCODE_ROOT) roots.push(process.env.CODE_SERVER_VSCODE_ROOT);
  for (const prefix of [
    environment.PREFIX,
    environment.TERMUX_PREFIX,
    '/data/data/com.termux/files/usr',
    '/data/user/0/com.termux/files/usr',
  ].filter(Boolean)) {
    roots.push(
      path.join(prefix, 'lib', 'node_modules', 'code-server', 'lib', 'vscode'),
      path.join(prefix, 'lib', 'code-server', 'lib', 'vscode')
    );
  }
  try {
    const executable = resolveExecutable('code-server', environment);
    let current = path.dirname(fs.realpathSync(executable));
    for (let index = 0; index < 6; index += 1) {
      roots.push(
        path.join(current, 'lib', 'vscode'),
        path.join(current, 'lib', 'node_modules', 'code-server', 'lib', 'vscode'),
        path.join(current, 'node_modules', 'code-server', 'lib', 'vscode')
      );
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // The Python helper will retry discovery when code-server is not on this PATH.
  }
  const output = [];
  for (const root of [...new Set(roots.map((value) => path.resolve(value)))]) {
    const directories = [
      path.join(root, 'out', 'vs', 'code', 'browser', 'workbench'),
      path.join(root, 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
      path.join(root, 'out', 'vs', 'workbench'),
    ];
    for (const directory of directories) {
      let entries;
      try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !/^workbench.*\.css$/i.test(entry.name)) continue;
        const filename = path.join(directory, entry.name);
        if (!output.includes(filename)) output.push(filename);
      }
    }
  }
  return output.sort();
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function backupChatBidiStylesheet(filename, pristine, mode) {
  const backup = `${filename}.copilot-models-helper.bak`;
  let previous;
  try {
    previous = await fsp.readFile(backup, 'utf8');
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  if (previous === pristine) return backup;
  if (typeof previous === 'string') {
    const digest = crypto.createHash('sha256').update(previous).digest('hex').slice(0, 12);
    const versioned = `${backup}.${digest}`;
    if (!(await readable(versioned))) await atomicInstallText(versioned, previous, mode);
  }
  await atomicInstallText(backup, pristine, mode);
  return backup;
}

async function ensureChatBidiStylesheets() {
  const results = [];
  const expression = new RegExp(
    `${escapeRegularExpression(CHAT_BIDI_STYLE_BEGIN)}[\\s\\S]*?${escapeRegularExpression(CHAT_BIDI_STYLE_END)}`,
    'g'
  );
  for (const filename of codeServerWorkbenchStylesheets()) {
    const original = await fsp.readFile(filename, 'utf8');
    const withoutPrevious = original.replace(expression, '').trimEnd();
    const desired = `${withoutPrevious}\n\n${CHAT_BIDI_STYLE}\n`;
    const mode = (await fsp.stat(filename)).mode & 0o777;
    if (original === desired) {
      const backup = `${filename}.copilot-models-helper.bak`;
      if (!(await readable(backup))) {
        await backupChatBidiStylesheet(filename, `${withoutPrevious}\n`, mode);
      }
      results.push({ filename, changed: false });
      continue;
    }
    const pristine = original.includes(CHAT_BIDI_STYLE_BEGIN)
      ? `${withoutPrevious}\n`
      : original;
    await backupChatBidiStylesheet(filename, pristine, mode);
    await atomicInstallText(filename, desired, mode);
    results.push({ filename, changed: true });
  }
  return results;
}

async function createRepairSnapshot(context, reason, preserveRoot) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(
    backupRoot(context),
    `${stamp}-v${extensionPackage.version}`
  );
  await fsp.mkdir(destination, { recursive: true, mode: 0o700 });
  await fsp.chmod(destination, 0o700);
  const entries = [];
  const paths = configuredPaths(context);
  const candidates = [
    ['chatLanguageModels', paths.configFile],
    ['settings', paths.settingsFile],
  ];
  const copilot = vscode.extensions.getExtension('github.copilot-chat');
  if (copilot) candidates.push(['copilotPackage', path.join(copilot.extensionPath, 'package.json')]);
  codeServerWorkbenchStylesheets().forEach((stylesheet, index) => {
    candidates.push([`workbenchChatBidi${index}`, stylesheet]);
  });
  for (const [label, original] of candidates) {
    try {
      const stat = await fsp.stat(original);
      if (!stat.isFile()) continue;
      const stored = path.join(destination, `${label}${path.extname(original) || '.bak'}`);
      await fsp.copyFile(original, stored);
      await fsp.chmod(stored, 0o600);
      entries.push({ label, original, stored: path.basename(stored), mode: stat.mode & 0o777 });
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
    }
  }
  const toolboxStored = path.join(destination, 'toolbox-extension');
  await fsp.cp(context.extensionPath, toolboxStored, { recursive: true, force: true });
  entries.push({
    label: 'toolboxExtension',
    original: context.extensionPath,
    stored: 'toolbox-extension',
    directory: true,
  });
  const manifest = {
    createdAt: new Date().toISOString(),
    reason,
    toolboxVersion: extensionPackage.version,
    entries,
  };
  await fsp.writeFile(
    path.join(destination, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { encoding: 'utf8', mode: 0o600 }
  );

  const retention = Math.max(
    1,
    Math.min(30, Number(toolboxConfiguration().get('backupRetention', 8)))
  );
  const directories = (await fsp.readdir(backupRoot(context), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  const removable = directories
    .slice(retention)
    .filter((name) => path.join(backupRoot(context), name) !== preserveRoot);
  await Promise.all(
    removable.map((name) =>
      fsp.rm(path.join(backupRoot(context), name), { recursive: true, force: true })
    )
  );
  output.appendLine(`[BACKUP] ${destination}`);
  return destination;
}

async function listRepairSnapshots(context) {
  try {
    const names = (await fsp.readdir(backupRoot(context), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    const snapshots = [];
    for (const name of names) {
      try {
        const root = path.join(backupRoot(context), name);
        const manifest = JSON.parse(
          await fsp.readFile(path.join(root, 'manifest.json'), 'utf8')
        );
        snapshots.push({ root, name, manifest });
      } catch {
        // Ignore incomplete snapshots.
      }
    }
    return snapshots;
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function restoreRepairSnapshot(context) {
  const snapshots = await listRepairSnapshots(context);
  if (!snapshots.length) throw new Error('No self-repair backups are available');
  const selected = await vscode.window.showQuickPick(
    snapshots.map((snapshot) => ({
      label: snapshot.name,
      description: snapshot.manifest.reason || 'repair snapshot',
      snapshot,
    })),
    { title: 'Restore a code-server repair backup', placeHolder: 'Choose a timestamped snapshot' }
  );
  if (!selected) return;
  const confirmed = await vscode.window.showWarningMessage(
    `Restore ${selected.label}? The current state will be backed up first.`,
    { modal: true },
    'Restore Backup'
  );
  if (confirmed !== 'Restore Backup') return;
  await createRepairSnapshot(
    context,
    `before restoring ${selected.label}`,
    selected.snapshot.root
  );
  for (const entry of selected.snapshot.manifest.entries || []) {
    const stored = path.join(selected.snapshot.root, entry.stored);
    if (entry.directory && entry.label === 'toolboxExtension') {
      await fsp.cp(stored, context.extensionPath, { recursive: true, force: true });
      continue;
    }
    if (!entry.directory) {
      await fsp.mkdir(path.dirname(entry.original), { recursive: true, mode: 0o700 });
      await fsp.copyFile(stored, entry.original);
      await fsp.chmod(entry.original, entry.mode || 0o600);
    }
  }
  await copyRestartCommand(`Backup ${selected.label} was restored.`);
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

function executableFile(filename) {
  if (!filename || !path.isAbsolute(filename)) return false;
  try {
    fs.accessSync(filename, fs.constants.X_OK);
    return fs.statSync(filename).isFile();
  } catch {
    return false;
  }
}

function termuxRuntimeEnvironment(baseEnvironment = process.env) {
  const home = baseEnvironment.HOME || os.homedir();
  const executablePrefix = (() => {
    const marker = `${path.sep}usr${path.sep}`;
    const index = process.execPath.indexOf(marker);
    return index >= 0 ? process.execPath.slice(0, index + marker.length - 1) : '';
  })();
  const prefixes = [
    baseEnvironment.PREFIX,
    baseEnvironment.TERMUX_PREFIX,
    home && path.resolve(home, '..', 'usr'),
    executablePrefix,
    '/data/data/com.termux/files/usr',
    '/data/user/0/com.termux/files/usr',
  ].filter(Boolean);
  const prefix =
    prefixes.find((candidate) => {
      try {
        return fs.statSync(path.join(candidate, 'bin')).isDirectory();
      } catch {
        return false;
      }
    }) || baseEnvironment.PREFIX || '';
  const pathParts = [
    prefix && path.join(prefix, 'bin'),
    prefix && path.join(prefix, 'bin', 'applets'),
    baseEnvironment.PATH,
    '/system/bin',
    '/system/xbin',
    '/usr/bin',
    '/bin',
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(path.delimiter))
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const environment = {
    ...baseEnvironment,
    HOME: home,
    PATH: pathParts.join(path.delimiter),
    ENV: '',
    BASH_ENV: '',
  };
  const isTermuxPrefix = prefix.includes(`${path.sep}com.termux${path.sep}`);
  if (baseEnvironment.PREFIX || isTermuxPrefix) environment.PREFIX = prefix;
  if (isTermuxPrefix) {
    environment.TERMUX_PREFIX = prefix;
    environment.TMPDIR = path.join(prefix, 'tmp');
    try {
      fs.mkdirSync(environment.TMPDIR, { recursive: true, mode: 0o700 });
    } catch {
      // The child will report a precise filesystem error if TMPDIR is unusable.
    }
  }
  return environment;
}

function resolveExecutable(names, environment, explicitCandidates = []) {
  const requested = Array.isArray(names) ? names : [names];
  const candidates = [...explicitCandidates.filter(Boolean)];
  for (const name of requested) {
    if (path.isAbsolute(name)) candidates.push(name);
  }
  for (const directory of String(environment.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    for (const name of requested) {
      if (!path.isAbsolute(name)) candidates.push(path.join(directory, name));
    }
  }
  const executable = candidates.find(executableFile);
  if (executable) return executable;
  throw new Error(
    `Cannot find executable ${requested.join(' or ')}. ` +
      `Checked the Termux prefix and PATH=${environment.PATH || '(empty)'}`
  );
}

function pythonCommand(environment = termuxRuntimeEnvironment()) {
  return resolveExecutable(
    ['python3', 'python'],
    environment,
    [
      environment.COPILOT_MODELS_PYTHON,
      environment.PREFIX && path.join(environment.PREFIX, 'bin', 'python3'),
      environment.PREFIX && path.join(environment.PREFIX, 'bin', 'python'),
    ]
  );
}

function runProcess(command, args, token, environment = process.env) {
  return new Promise((resolve, reject) => {
    output.appendLine(`$ ${command} ${args.map((value) => JSON.stringify(value)).join(' ')}`);
    let settled = false;
    let child;
    try {
      child = cp.spawn(command, args, {
        env: environment,
        cwd: environment.HOME || os.homedir(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(new Error(`Unable to start ${command}: ${error.message || error}`));
      return;
    }
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
      if (settled) return;
      settled = true;
      if (cancellation) cancellation.dispose();
      const code = error && error.code ? ` ${error.code}` : '';
      reject(
        new Error(
          `Unable to start ${command}:${code} ${error.message || error}. ` +
            'The Toolbox rebuilt the Termux environment before spawning it.'
        )
      );
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
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
  const environment = termuxRuntimeEnvironment();
  return runTermuxExecutable(
    pythonCommand(environment),
    args,
    token,
    environment,
    'Python helper'
  );
}

async function persistPinnedModels(context, successfulModels) {
  const identifiers = [...new Set(successfulModels.map(core.chatModelIdentifier).filter(Boolean))];
  if (!identifiers.length) {
    return { requested: 0, added: 0, total: 0, unhidden: 0, changed: false };
  }
  const runtime = runtimePaths(context);
  if (!(await readable(runtime.helper))) {
    throw new Error(`Toolbox runtime file is missing: ${runtime.helper}`);
  }
  const pinDirectory = path.join(context.globalStorageUri.fsPath, 'pin-models');
  await fsp.mkdir(pinDirectory, { recursive: true, mode: 0o700 });
  await fsp.chmod(pinDirectory, 0o700);
  const pinFile = path.join(pinDirectory, `successful-${Date.now()}.json`);
  await fsp.writeFile(pinFile, JSON.stringify(identifiers) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    const paths = configuredPaths(context);
    const retention = Math.max(
      1,
      Math.min(30, Number(toolboxConfiguration().get('backupRetention', 8)))
    );
    const environment = termuxRuntimeEnvironment();
    const result = await runTermuxExecutable(
      pythonCommand(environment),
      [
        runtime.helper,
        '--pin-models-file',
        pinFile,
        '--settings-file',
        paths.settingsFile,
        '--pin-backup-dir',
        path.join(context.globalStorageUri.fsPath, 'pin-storage-backups'),
        '--pin-backup-retention',
        String(retention),
      ],
      undefined,
      environment,
      'Python pin helper'
    );
    const line = result.stdout
      .split(/\r?\n/)
      .find((value) => value.startsWith('PIN_RESULT '));
    if (!line) throw new Error('Pin helper returned no result');
    return JSON.parse(line.slice('PIN_RESULT '.length));
  } finally {
    await fsp.rm(pinFile, { force: true });
  }
}

async function selectModelForChat(context, model) {
  const identifier = core.chatModelIdentifier(model);
  if (!identifier) throw new Error('This model has no valid Copilot Chat identifier');
  const runtime = runtimePaths(context);
  if (!(await readable(runtime.helper))) {
    throw new Error(`Toolbox runtime file is missing: ${runtime.helper}`);
  }

  let liveSelectionRequested = false;
  try {
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes('workbench.action.chat.changeModel')) {
      const id = String(model.resolvedId || model.id);
      await vscode.commands.executeCommand('workbench.action.chat.changeModel', {
        vendor: String(model.vendor || ''),
        id,
        family: id,
      });
      liveSelectionRequested = true;
    }
  } catch (error) {
    output.appendLine(`[SELECT MODEL] Live Chat selection unavailable: ${error.message || error}`);
  }

  const paths = configuredPaths(context);
  const retention = Math.max(
    1,
    Math.min(30, Number(toolboxConfiguration().get('backupRetention', 8)))
  );
  const environment = termuxRuntimeEnvironment();
  const result = await runTermuxExecutable(
    pythonCommand(environment),
    [
      runtime.helper,
      '--select-model',
      identifier,
      '--settings-file',
      paths.settingsFile,
      '--pin-backup-dir',
      path.join(context.globalStorageUri.fsPath, 'pin-storage-backups'),
      '--pin-backup-retention',
      String(retention),
    ],
    undefined,
    environment,
    'Python model-selection helper'
  );
  const line = result.stdout
    .split(/\r?\n/)
    .find((value) => value.startsWith('SELECT_RESULT '));
  if (!line) throw new Error('Model selection helper returned no result');
  return {
    ...JSON.parse(line.slice('SELECT_RESULT '.length)),
    liveSelectionRequested,
  };
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

async function scheduleCodeServerRestartAndRefresh(reason = 'code update') {
  if (restartScheduled) {
    output.appendLine(`[RESTART] Already scheduled; additional reason: ${reason}`);
    return false;
  }
  const environment = termuxRuntimeEnvironment();
  const codeServer = resolveExecutable(
    'code-server',
    environment,
    [
      environment.PREFIX && path.join(environment.PREFIX, 'bin', 'code-server'),
      '/data/data/com.termux/files/usr/bin/code-server',
      '/data/user/0/com.termux/files/usr/bin/code-server',
    ]
  );
  const shell = resolveExecutable(
    ['/system/bin/sh', 'sh'],
    environment,
    ['/system/bin/sh', '/bin/sh']
  );
  const stateDirectory = path.join(environment.HOME || os.homedir(), '.local', 'share', 'code-server');
  const script = [
    'sleep 3',
    "pkill -f '[c]ode-server' || true",
    'sleep 1',
    'mkdir -p "$CODE_SERVER_STATE_DIR"',
    'nohup "$CODE_SERVER_BIN" >>"$CODE_SERVER_LOG" 2>&1 </dev/null &',
  ].join('\n');
  const child = cp.spawn(shell, ['-c', script], {
    cwd: environment.HOME || os.homedir(),
    env: {
      ...environment,
      CODE_SERVER_BIN: codeServer,
      CODE_SERVER_STATE_DIR: stateDirectory,
      CODE_SERVER_LOG: path.join(stateDirectory, 'code-server.log'),
    },
    detached: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  restartScheduled = true;
  output.appendLine(
    `[RESTART] Detached code-server restart scheduled for ${reason}; refreshing the workbench now.`
  );
  setTimeout(() => {
    void vscode.commands.executeCommand('workbench.action.reloadWindow').catch((error) => {
      output.appendLine(`[RELOAD ERROR] ${error.message || error}`);
    });
  }, 750);
  return true;
}

async function zoomCodeServer() {
  const selection = await vscode.window.showQuickPick(
    [
      { label: '$(zoom-in) Zoom in', description: 'Increase the complete code-server workbench scale', command: 'workbench.action.zoomIn' },
      { label: '$(zoom-out) Zoom out', description: 'Decrease the complete code-server workbench scale', command: 'workbench.action.zoomOut' },
      { label: '$(discard) Reset zoom', description: 'Return code-server to its default scale', command: 'workbench.action.zoomReset' },
      { label: '$(settings) Force an exact zoom level', description: 'Persist a global level from -8 to 8', command: 'exact' },
    ],
    {
      title: 'Zoom code-server',
      placeHolder: 'Choose a global zoom action; this works even when browser pinch zoom is unavailable',
    }
  );
  if (!selection) return;
  if (selection.command !== 'exact') {
    await vscode.commands.executeCommand(selection.command);
    return;
  }
  const configuration = vscode.workspace.getConfiguration('window');
  const current = Number(configuration.get('zoomLevel', 0));
  const value = await vscode.window.showInputBox({
    title: 'Force code-server zoom level',
    prompt: 'Use a positive value to zoom in, a negative value to zoom out, or 0 to reset.',
    value: Number.isFinite(current) ? String(current) : '0',
    validateInput(input) {
      const number = Number(input);
      return Number.isFinite(number) && number >= -8 && number <= 8
        ? undefined
        : 'Enter a number from -8 through 8.';
    },
  });
  if (value === undefined) return;
  const level = Number(value);
  await configuration.update('zoomLevel', level, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`code-server zoom level is now forced to ${level}.`);
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
      'Keys are staged in a mode-0600 file, then transferred into code-server Chat SecretStorage.',
    { modal: true },
    'Import'
  );
  if (confirmed !== 'Import') return;

  output.clear();
  output.appendLine(`Importing ${source}`);
  await createRepairSnapshot(context, `before importing ${path.basename(source)}`);
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
  // Let code-server's file watcher observe the helper write before asking its
  // language-model command to replace plaintext values with secret references.
  await new Promise((resolve) => setTimeout(resolve, 750));
  const secured = await migratePlaintextCredentials(context);
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
  if (secured.pending) {
    output.show(true);
    await vscode.window.showWarningMessage(
      `${secured.pending} provider credential(s) are still awaiting secure Chat migration. Restart code-server; Toolbox will retry automatically at startup.`,
      { modal: true },
      'Continue'
    );
  }
  await copyRestartCommand(
    `AI providers were imported; ${secured.migrated} credential group(s) were transferred to Chat SecretStorage. ${credentialLine || 'Credential diagnostics are in the output panel.'}`
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

async function atomicInstallText(filename, text, mode = 0o600) {
  await fsp.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.${Date.now()}.update.tmp`;
  try {
    await fsp.writeFile(temporary, text, { encoding: 'utf8', mode });
    await fsp.chmod(temporary, mode);
    await fsp.rename(temporary, filename);
    await fsp.chmod(filename, mode);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

async function installDownloadedRuntimeDirectly(context, downloadedText) {
  const targets = [
    ['copilot-models.py', path.join(context.extensionPath, 'runtime', 'copilot-models.py'), 0o700],
    ['copilot-models.catalog.json', path.join(context.extensionPath, 'runtime', 'copilot-models.catalog.json'), 0o600],
    ['copilot-models-toolbox/core.js', path.join(context.extensionPath, 'core.js'), 0o600],
    ['copilot-models-toolbox/extension.js', path.join(context.extensionPath, 'extension.js'), 0o600],
    // Write package.json last so the installed version only advances after all runtime assets.
    ['copilot-models-toolbox/package.json', path.join(context.extensionPath, 'package.json'), 0o600],
  ];
  for (const [relative, destination, mode] of targets) {
    const text = downloadedText[relative];
    if (typeof text !== 'string') throw new Error(`Validated update is missing ${relative}`);
    await atomicInstallText(destination, text, mode);
  }
}

async function performFullGitHubUpdate(context, repository, branch, reportStatus) {
  if (updateInProgress) throw new Error('Another GitHub update is already running');
  updateInProgress = true;
  const report = (message, level = 'info') => {
    output.appendLine(`[GitHub ${level.toUpperCase()}] ${message}`);
    if (reportStatus) reportStatus(message, level);
  };
  try {
    const snapshot = await createRepairSnapshot(
      context,
      `before GitHub update from ${repository}@${branch}`
    );
    report(`Backup created: ${snapshot}`);
    const remote = await remoteToolboxVersion(repository, branch);
    report(`Remote toolbox v${remote.version}; installed v${extensionPackage.version}.`);
    report('Downloading the branch runtime without spawning Bash or curl…');
    const updateDirectory = path.join(context.globalStorageUri.fsPath, 'github-update');
    const toolboxDirectory = path.join(updateDirectory, 'copilot-models-toolbox');
    await fsp.rm(updateDirectory, { recursive: true, force: true });
    await fsp.mkdir(toolboxDirectory, { recursive: true, mode: 0o700 });
    const assets = [
      ['copilot-models.py', path.join(updateDirectory, 'copilot-models.py'), 4 * 1024 * 1024],
      ['copilot-models.catalog.json', path.join(updateDirectory, 'copilot-models.catalog.json'), 16 * 1024 * 1024],
      ['copilot-models-toolbox/package.json', path.join(toolboxDirectory, 'package.json'), 1024 * 1024],
      ['copilot-models-toolbox/extension.js', path.join(toolboxDirectory, 'extension.js'), 4 * 1024 * 1024],
      ['copilot-models-toolbox/core.js', path.join(toolboxDirectory, 'core.js'), 2 * 1024 * 1024],
    ];
    const downloaded = await Promise.all(
      assets.map(async ([relative, destination, maxBytes]) => {
        const response = await core.httpRequest(`${remote.rawBase}/${relative}`, {
          timeoutMs: 60000,
          maxBytes,
        });
        if (response.status < 200 || response.status >= 300) {
          throw new Error(`GitHub returned HTTP ${response.status} for ${relative}`);
        }
        return { relative, destination, text: response.text };
      })
    );
    const packageDownload = downloaded.find((asset) => asset.relative.endsWith('/package.json'));
    const catalogDownload = downloaded.find((asset) => asset.relative.endsWith('.catalog.json'));
    const packageValue = JSON.parse(packageDownload.text);
    if (
      packageValue.publisher !== 'fazilatma' ||
      packageValue.name !== 'copilot-models-toolbox' ||
      String(packageValue.version) !== remote.version
    ) {
      throw new Error('Downloaded Toolbox package identity/version does not match the checked branch');
    }
    core.validateCatalog(JSON.parse(catalogDownload.text));
    const downloadedText = Object.fromEntries(
      downloaded.map((asset) => [asset.relative, asset.text])
    );
    if (!downloadedText['copilot-models.py'].includes(`HELPER_VERSION = "${remote.version}"`)) {
      throw new Error('Downloaded helper version does not match the checked Toolbox version');
    }
    if (
      !downloadedText['copilot-models-toolbox/extension.js'].includes('function activate(') ||
      !downloadedText['copilot-models-toolbox/core.js'].includes('module.exports')
    ) {
      throw new Error('Downloaded Toolbox JavaScript is incomplete');
    }
    for (const asset of downloaded) {
      await fsp.writeFile(asset.destination, asset.text, { encoding: 'utf8', mode: 0o600 });
    }
    const helper = path.join(updateDirectory, 'copilot-models.py');
    await fsp.chmod(helper, 0o700);
    const paths = configuredPaths(context);
    const args = [
      helper,
      '--catalog',
      path.join(updateDirectory, 'copilot-models.catalog.json'),
      '--toolbox-dir',
      toolboxDirectory,
      '--no-discover',
      '--enable-terminal',
      '--preserve-existing-keys',
      '--config-file',
      paths.configFile,
      '--settings-file',
      paths.settingsFile,
    ];
    const copilot = vscode.extensions.getExtension('github.copilot-chat');
    if (copilot) args.push('--extension-dir', copilot.extensionPath);
    const environment = termuxRuntimeEnvironment({
      ...process.env,
      COPILOT_MODELS_RAW_BASE: remote.rawBase,
    });
    const python = pythonCommand(environment);
    report(`Installing through ${python}; no shell process is required…`);
    try {
      await runTermuxExecutable(
        python,
        args,
        undefined,
        environment,
        'Python update helper'
      );
    } catch (error) {
      if (!/\bEACCES\b|Android linker fallback failed/i.test(String(error.message || error))) {
        throw error;
      }
      report(
        'Android denied both direct Python execution and its linker path. Installing the already validated Toolbox/helper/catalog runtime directly with Node instead…',
        'warning'
      );
      await installDownloadedRuntimeDirectly(context, downloadedText);
      report(
        'Direct runtime fallback completed. Existing model, key, and terminal settings were preserved; run Repair later if those integrations need reapplication.',
        'warning'
      );
    }
    await fsp.rm(runtimePaths(context).syncedCatalog, { force: true });
    lastInstalledVersion = remote.version;
    report(`Full branch update to v${remote.version} completed. Automatic code-server restart and page refresh will follow.`, 'success');
    return remote.version;
  } catch (error) {
    report(error.message || String(error), 'error');
    throw error;
  } finally {
    updateInProgress = false;
  }
}

function systemLinkerForExecutable(filename) {
  let header;
  try {
    const descriptor = fs.openSync(filename, 'r');
    try {
      header = Buffer.alloc(5);
      if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) return undefined;
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (_) {
    return undefined;
  }
  if (header[0] !== 0x7f || header.toString('ascii', 1, 4) !== 'ELF') return undefined;
  const candidates = header[4] === 2
    ? ['/system/bin/linker64', '/system/bin/linker']
    : ['/system/bin/linker', '/system/bin/linker64'];
  return candidates.find(executableFile);
}

async function runTermuxExecutable(
  command,
  args,
  token,
  environment,
  purpose = 'Termux executable'
) {
  try {
    return await runProcess(command, args, token, environment);
  } catch (error) {
    if (!/\bEACCES\b/i.test(String(error && (error.message || error)))) throw error;
    const linker = systemLinkerForExecutable(command);
    if (!linker) throw error;
    output.appendLine(
      `[${purpose}] Direct execution was denied; retrying ${command} through ${linker}.`
    );
    try {
      return await runProcess(linker, [command, ...args], token, environment);
    } catch (linkerError) {
      throw new Error(
        `Direct ${purpose} execution failed (${error.message || error}); ` +
        `Android linker fallback failed (${linkerError.message || linkerError})`
      );
    }
  }
}

function runGitHubCli(command, args, environment) {
  return runTermuxExecutable(command, args, undefined, environment, 'GitHub CLI');
}

async function githubApiJson(accessToken, method, url, payload) {
  const response = await core.requestJson(url, payload, {
    method,
    timeoutMs: 60000,
    maxBytes: 8 * 1024 * 1024,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': `copilot-models-toolbox/${extensionPackage.version}`,
    },
  });
  let parsed;
  try {
    parsed = response.text ? JSON.parse(response.text) : {};
  } catch (_) {
    parsed = {};
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = core.sanitizeDiagnosticText(
      parsed.message || response.text || `HTTP ${response.status}`,
      [accessToken],
      800
    );
    throw new Error(`GitHub API returned HTTP ${response.status}: ${detail}`);
  }
  return parsed;
}

async function githubApiSession() {
  if (!vscode.authentication || typeof vscode.authentication.getSession !== 'function') {
    throw new Error('This code-server build has no VS Code GitHub authentication provider');
  }
  const session = await vscode.authentication.getSession('github', ['repo'], {
    createIfNone: true,
  });
  if (!session || !session.accessToken) {
    throw new Error('VS Code GitHub authentication did not return a session');
  }
  return session;
}

async function diagnosticSecrets(context) {
  const secrets = [];
  let groups = [];
  try {
    groups = await readConfiguredGroups(context);
  } catch (_) {
    // A broken model configuration should not prevent code-server diagnostics.
  }
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    if (
      typeof group.apiKey === 'string' &&
      group.apiKey.trim() &&
      !core.isChatSecretReference(group.apiKey)
    ) {
      secrets.push(group.apiKey.trim());
    }
    if (!context.secrets || typeof context.secrets.get !== 'function') continue;
    for (const alias of providerCredentialAliases(group.name)) {
      try {
        const stored = await context.secrets.get(toolboxCredentialKey(group.vendor, alias));
        if (stored) secrets.push(stored);
      } catch (_) {
        // Continue with pattern-based redaction if SecretStorage is unavailable.
      }
    }
  }
  return [...new Set(secrets.filter(Boolean))];
}

async function walkLogFiles(root, depth, found) {
  if (depth > 7 || found.length >= 1000) return;
  let stat;
  try {
    stat = await fsp.lstat(root);
  } catch (_) {
    return;
  }
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    if (/\.log(?:\.\d+)?$|\.txt$/i.test(path.basename(root))) {
      found.push({ filename: root, size: stat.size, mtimeMs: stat.mtimeMs });
    }
    return;
  }
  if (!stat.isDirectory()) return;
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    if (found.length >= 1000) break;
    if (entry.isSymbolicLink()) continue;
    await walkLogFiles(path.join(root, entry.name), depth + 1, found);
  }
}

async function collectCodeServerDiagnostics(context) {
  const profileRoot = activeProfileRoot(context);
  const home = os.homedir();
  const roots = [
    path.resolve(profileRoot, '..', 'logs'),
    path.join(home, '.local', 'share', 'code-server', 'logs'),
    path.join(home, '.local', 'share', 'code-server', 'coder-logs'),
    path.join(home, '.local', 'share', 'code-server', 'code-server.log'),
    process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, 'code-server', 'logs')
      : '',
    process.env.VSCODE_LOGS || '',
    context.logUri && context.logUri.fsPath ? context.logUri.fsPath : '',
  ].filter(Boolean);
  const candidates = [];
  for (const root of [...new Set(roots.map((item) => path.resolve(item)))]) {
    await walkLogFiles(root, 0, candidates);
  }
  const unique = [...new Map(candidates.map((item) => [path.resolve(item.filename), item])).values()]
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 120);
  const secrets = await diagnosticSecrets(context);
  const errorPattern = /(?:\b(?:error|fatal|exception|unhandled|rejection|failed|failure|crash(?:ed)?|epipe|enomem|enospc|enoent|econn(?:refused|reset)|etimedout|sig(?:term|kill|segv|abrt)|cannot|could not|permission denied|out of memory)\b|\[err(?:or)?\]|\berr!?\b|\bexited with (?:code|status)\s*[1-9]\d*|\bterminated unexpectedly\b)/i;
  const harmlessPattern = /\b(?:0 errors?|no errors?|without errors?|error count[:=]\s*0)\b/i;
  const stackPattern = /^\s*(?:at\s+|caused by:|\w*(?:Error|Exception):|code:|errno:|syscall:)/i;
  const records = [];
  let scannedBytes = 0;
  let truncatedFiles = 0;
  const maxTotalBytes = 32 * 1024 * 1024;
  const maxFileBytes = 1024 * 1024;
  for (const item of unique) {
    if (scannedBytes >= maxTotalBytes) break;
    const length = Math.min(item.size, maxFileBytes, maxTotalBytes - scannedBytes);
    if (length <= 0) continue;
    let handle;
    let text;
    try {
      handle = await fsp.open(item.filename, 'r');
      const buffer = Buffer.alloc(length);
      const position = Math.max(0, item.size - length);
      const read = await handle.read(buffer, 0, length, position);
      text = buffer.subarray(0, read.bytesRead).toString('utf8');
      scannedBytes += read.bytesRead;
      if (position > 0) truncatedFiles += 1;
    } catch (error) {
      output.appendLine(`[DIAGNOSTICS] Skipped unreadable log: ${error.code || error.message || error}`);
      continue;
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch (_) {
          // Ignore close races after a best-effort diagnostic read.
        }
      }
    }
    const lines = text.split(/\r?\n/);
    const source = core.sanitizeDiagnosticText(path.basename(item.filename), secrets, 120);
    const sourceId = crypto.createHash('sha256').update(path.resolve(item.filename)).digest('hex').slice(0, 12);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!errorPattern.test(line) || harmlessPattern.test(line)) continue;
      const block = [line];
      for (let following = index + 1; following < Math.min(lines.length, index + 9); following += 1) {
        if (!stackPattern.test(lines[following])) break;
        block.push(lines[following]);
      }
      const sanitized = core.sanitizeDiagnosticText(block.join(' | '), secrets, 1800);
      if (!sanitized) continue;
      records.push({
        source,
        sourceId,
        logModifiedAt: new Date(item.mtimeMs).toISOString(),
        error: sanitized,
      });
    }
  }
  return {
    scannedAt: new Date().toISOString(),
    discoveredLogFiles: candidates.length,
    scannedLogFiles: unique.length,
    scannedBytes,
    filesReadFromTail: truncatedFiles,
    errorCount: records.length,
    errors: records,
    scope:
      'Errors from up to 120 most-recent retained code-server/VS Code text logs; at most the newest 1 MiB per file and 32 MiB total are scanned for Android stability.',
  };
}

function diagnosticCommentChunks(records, maxCharacters = 45000) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const record of records) {
    const rendered = JSON.stringify(record, null, 2);
    if (current.length && size + rendered.length + 2 > maxCharacters) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(record);
    size += rendered.length + 2;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function uploadSanitizedDiagnostics(
  context,
  repository,
  branch,
  reportStatus,
  updateErrors = []
) {
  const reportPath = path.join(
    context.globalStorageUri.fsPath,
    'latest-sanitized-diagnostics.json'
  );
  let report = {};
  if (await readable(reportPath)) {
    try {
      report = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
    } catch (error) {
      output.appendLine(`[DIAGNOSTICS] Ignoring unreadable model report: ${error.message || error}`);
    }
  }
  if (reportStatus) reportStatus('Scanning retained code-server and VS Code logs for errors…');
  const codeServer = await collectCodeServerDiagnostics(context);
  const secrets = await diagnosticSecrets(context);
  for (const panelError of Array.isArray(updateErrors) ? updateErrors.slice(-500) : []) {
    const sanitized = core.sanitizeDiagnosticText(panelError, secrets, 1800);
    if (!sanitized) continue;
    codeServer.errors.push({
      source: 'GitHub Sync update panel',
      sourceId: 'github-sync-panel',
      logModifiedAt: new Date().toISOString(),
      error: sanitized,
    });
  }
  codeServer.errorCount = codeServer.errors.length;
  const models = Array.isArray(report.models) ? report.models : [];
  const failures = models
    .filter((model) => model.state === 'fail')
    .map((model) => ({
      provider: model.provider,
      configuredModel: model.configuredModel,
      resolvedModel: model.resolvedModel,
      resolution: model.resolution,
      endpointHost: model.endpointHost,
      httpStatus: model.httpStatus,
      elapsedMs: model.elapsedMs,
      error: core.sanitizeDiagnosticText(model.error, [], 350),
    }));
  const mappings = models
    .filter((model) => model.configuredModel !== model.resolvedModel)
    .map((model) => ({
      provider: model.provider,
      configuredModel: model.configuredModel,
      resolvedModel: model.resolvedModel,
      resolution: model.resolution,
      state: model.state,
    }));
  const errorChunks = diagnosticCommentChunks(codeServer.errors);
  const modelChunks = diagnosticCommentChunks([
    ...failures.map((failure) => ({ kind: 'model-failure', ...failure })),
    ...mappings.map((mapping) => ({ kind: 'resolved-model-mapping', ...mapping })),
  ]);
  const compactReport = {
    schema: 'copilot-models-toolbox-complete-diagnostic-v2',
    reportId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    repository,
    branch,
    toolboxVersion: extensionPackage.version,
    vscodeVersion: vscode.version,
    appName: vscode.env.appName,
    platform: `${process.platform}/${process.arch}`,
    modelTest: {
      available: models.length > 0,
      generatedAt: report.generatedAt || null,
      summary: report.summary || null,
      stability: report.stability || null,
      modelCount: models.length,
      failureCount: models.filter((model) => model.state === 'fail').length,
      uploadedFailureCount: failures.length,
      resolvedMappingCount: mappings.length,
      detailCommentCount: modelChunks.length,
    },
    codeServer: {
      scannedAt: codeServer.scannedAt,
      discoveredLogFiles: codeServer.discoveredLogFiles,
      scannedLogFiles: codeServer.scannedLogFiles,
      scannedBytes: codeServer.scannedBytes,
      filesReadFromTail: codeServer.filesReadFromTail,
      errorCount: codeServer.errorCount,
      errorCommentCount: errorChunks.length,
      scope: codeServer.scope,
    },
    privacy:
      'Sanitized opt-in report: no API keys, secret references, full endpoint paths, source code, prompts, or local file paths. Error records are posted as numbered comments on this issue.',
  };
  const uploadDirectory = path.join(context.globalStorageUri.fsPath, 'github-diagnostics');
  await fsp.mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  const bodyFile = path.join(uploadDirectory, `${compactReport.reportId}.md`);
  const body = [
    '## Complete sanitized code-server diagnostic',
    '',
    `Target branch: \`${branch}\``,
    '',
    'This report was explicitly uploaded from the Toolbox GitHub Sync panel.',
    'It includes sanitized errors found in retained code-server and VS Code logs, plus the latest model-test failures when available.',
    'It intentionally excludes credentials, full URLs, prompts, source code, and local paths.',
    '',
    '```json',
    JSON.stringify(compactReport, null, 2),
    '```',
    '',
  ].join('\n');
  await fsp.writeFile(bodyFile, body, { encoding: 'utf8', mode: 0o600 });
  const environment = termuxRuntimeEnvironment();
  const title = `[Code-server Diagnostic] v${extensionPackage.version} ${compactReport.reportId.slice(0, 8)}`;
  let issueUrl = '';
  let postIssueComment;
  try {
    let cliError;
    try {
      const gh = resolveExecutable('gh', environment);
      const created = await runGitHubCli(
        gh,
        ['issue', 'create', '--repo', repository, '--title', title, '--body-file', bodyFile],
        environment
      );
      issueUrl = created.stdout.trim().split(/\r?\n/).find((line) => /^https:\/\//.test(line)) || '';
      if (!issueUrl) throw new Error('GitHub created the issue but did not return its URL');
      postIssueComment = async (comment) => {
        await fsp.writeFile(bodyFile, comment, { encoding: 'utf8', mode: 0o600 });
        await runGitHubCli(
          gh,
          ['issue', 'comment', issueUrl, '--repo', repository, '--body-file', bodyFile],
          environment
        );
      };
      if (reportStatus) reportStatus('GitHub upload is using the authenticated Termux gh CLI.');
    } catch (error) {
      cliError = error;
      if (reportStatus) {
        reportStatus(
          'Termux gh could not run from the extension host; switching to VS Code GitHub authentication…'
        );
      }
      try {
        const session = await githubApiSession();
        const created = await githubApiJson(
          session.accessToken,
          'POST',
          `https://api.github.com/repos/${repository}/issues`,
          { title, body }
        );
        issueUrl = String(created.html_url || '');
        const issueNumber = Number(created.number);
        if (!issueUrl || !Number.isSafeInteger(issueNumber)) {
          throw new Error('GitHub API created an invalid issue response');
        }
        postIssueComment = async (comment) => {
          await githubApiJson(
            session.accessToken,
            'POST',
            `https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`,
            { body: comment }
          );
        };
        if (reportStatus) reportStatus('GitHub upload is using the secure VS Code authentication session.');
      } catch (apiError) {
        throw new Error(
          `Termux gh transport failed: ${cliError.message || cliError}. ` +
          `VS Code GitHub API fallback failed: ${apiError.message || apiError}`
        );
      }
    }
    for (let index = 0; index < errorChunks.length; index += 1) {
      if (reportStatus) {
        reportStatus(`Uploading sanitized code-server error part ${index + 1}/${errorChunks.length}…`);
      }
      const comment = [
        `## Sanitized code-server errors ${index + 1}/${errorChunks.length}`,
        '',
        '```json',
        JSON.stringify(errorChunks[index], null, 2),
        '```',
        '',
      ].join('\n');
      await postIssueComment(comment);
    }
    for (let index = 0; index < modelChunks.length; index += 1) {
      if (reportStatus) {
        reportStatus(`Uploading sanitized model diagnostic part ${index + 1}/${modelChunks.length}…`);
      }
      const comment = [
        `## Sanitized model diagnostics ${index + 1}/${modelChunks.length}`,
        '',
        '```json',
        JSON.stringify(modelChunks[index], null, 2),
        '```',
        '',
      ].join('\n');
      await postIssueComment(comment);
    }
    output.appendLine(
      `[DIAGNOSTICS UPLOAD] ${issueUrl}; code-server errors=${codeServer.errorCount}; error comments=${errorChunks.length}; model comments=${modelChunks.length}`
    );
    return {
      issueUrl,
      codeServerErrorCount: codeServer.errorCount,
      errorCommentCount: errorChunks.length,
      modelCommentCount: modelChunks.length,
      modelFailureCount: compactReport.modelTest.failureCount,
      uploadedModelFailureCount: failures.length,
    };
  } catch (error) {
    if (issueUrl) {
      throw new Error(`${error.message || error}. Diagnostic issue already exists at ${issueUrl}`);
    }
    throw error;
  } finally {
    await fsp.rm(bodyFile, { force: true });
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
<p class="note">Pulls helper, model catalog, terminal integration, and this toolbox from the selected branch. After a successful manual or automatic update, Toolbox schedules a detached code-server restart and refreshes the workbench page. Nothing is uploaded automatically. After explicit confirmation, the diagnostic button scans retained code-server and VS Code logs and sends every detected sanitized error to a GitHub issue tied to the selected branch, together with the latest model-test failures when available. API keys, secret references, prompts, source code, full URLs, and local paths are excluded.</p>
<div class="grid"><div><label for="repository">Repository (owner/name)</label><input id="repository" type="text"></div><div><label for="branch">Branch</label><input id="branch" type="text"></div></div>
<div class="row"><label><input id="auto" type="checkbox"> Enable automatic update checks</label></div>
<div class="row"><label for="interval">Check interval (minutes)</label><input id="interval" type="number" min="5" max="1440"></div>
<div class="actions"><button id="save">Save settings</button><button id="check">Check version</button><button id="update">Update now</button><button id="upload">Upload all sanitized errors</button><button id="restart">Copy fallback restart command</button></div>
<h3>Live update log</h3><div class="actions"><button id="copyLog">Copy update log</button></div><pre id="log"></pre>
</div><script nonce="${scriptNonce}">
const vscode=acquireVsCodeApi();const initial=${initial};
const repository=document.getElementById('repository'),branch=document.getElementById('branch'),auto=document.getElementById('auto'),interval=document.getElementById('interval'),log=document.getElementById('log'),updateErrors=[];
repository.value=initial.repository;branch.value=initial.branch;auto.checked=initial.autoUpdate;interval.value=initial.intervalMinutes;
function payload(type){return{type,repository:repository.value,branch:branch.value,autoUpdate:auto.checked,intervalMinutes:Number(interval.value),updateErrors:[...updateErrors]}}
function busy(value){document.getElementById('update').disabled=value;document.getElementById('check').disabled=value;document.getElementById('upload').disabled=value}
document.getElementById('save').onclick=()=>vscode.postMessage(payload('save'));
document.getElementById('check').onclick=()=>{busy(true);vscode.postMessage(payload('check'))};
document.getElementById('update').onclick=()=>{busy(true);vscode.postMessage(payload('update'))};
document.getElementById('upload').onclick=()=>{auto.checked=true;busy(true);vscode.postMessage(payload('uploadDiagnostics'))};
document.getElementById('restart').onclick=()=>vscode.postMessage({type:'copyRestart'});
document.getElementById('copyLog').onclick=()=>vscode.postMessage({type:'copyUpdateLog',text:log.innerText||log.textContent||''});
window.addEventListener('message',event=>{const message=event.data;if(message.type==='status'){if(message.level==='error')updateErrors.push(String(message.message||''));const line=document.createElement('div');line.className=message.level||'';line.textContent=new Date().toLocaleTimeString()+'  '+message.message;log.appendChild(line);log.scrollTop=log.scrollHeight;if(message.done)busy(false)}});
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
        try {
          await scheduleCodeServerRestartAndRefresh(`automatic update to v${installed}`);
          void vscode.window.showInformationMessage(
            `Copilot Models Toolbox v${installed} installed automatically. code-server is restarting and the page is refreshing.`
          );
        } catch (restartError) {
          output.appendLine(`[AUTO RESTART ERROR] ${restartError.message || restartError}`);
          void vscode.window.showWarningMessage(
            `Toolbox v${installed} was installed, but automatic restart failed: ${restartError.message || restartError}`,
            'Copy Restart Command'
          ).then((choice) => {
            if (choice === 'Copy Restart Command') return vscode.env.clipboard.writeText(RESTART_COMMAND);
            return undefined;
          });
        }
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
      if (['save', 'check', 'update', 'uploadDiagnostics'].includes(message.type)) {
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
          await scheduleCodeServerRestartAndRefresh(`manual GitHub update to v${installed}`);
          postStatus(
            `v${installed} installed. code-server will restart automatically and this page will refresh.`,
            'success',
            true
          );
        } else if (message.type === 'uploadDiagnostics') {
          const confirmed = await vscode.window.showWarningMessage(
            'Scan retained code-server and VS Code logs and upload every detected sanitized error as a GitHub issue and numbered comments? The latest model-test failures are included when available. API keys, secret references, prompts, source code, full URLs, and local paths are excluded.',
            { modal: true },
            'Upload Sanitized Errors'
          );
          if (confirmed !== 'Upload Sanitized Errors') {
            postStatus('Diagnostic upload cancelled.', 'info', true);
          } else {
            postStatus('Creating complete sanitized GitHub diagnostic issue…');
            const result = await uploadSanitizedDiagnostics(
              context,
              saved.repository,
              saved.branch,
              (text) => postStatus(text),
              message.updateErrors
            );
            postStatus(
              `Diagnostic uploaded: ${result.issueUrl}. Sent ${result.codeServerErrorCount} code-server/VS Code error record(s) in ${result.errorCommentCount} part(s), plus details for ${result.uploadedModelFailureCount}/${result.modelFailureCount} model failure(s) in ${result.modelCommentCount} part(s). Keep automatic updates enabled so the branch fix installs itself.`,
              'success',
              true
            );
          }
        }
      } else if (message.type === 'copyRestart') {
        await vscode.env.clipboard.writeText(RESTART_COMMAND);
        postStatus('Restart command copied.', 'success', true);
      } else if (message.type === 'copyUpdateLog') {
        const logText = String(message.text || '');
        await vscode.env.clipboard.writeText(logText);
        postStatus(`Update log copied (${logText.length} characters).`, 'success');
      }
    } catch (error) {
      postStatus(error.message || String(error), 'error', true);
    }
  });
  panel.onDidDispose(() => activePanels.delete(panel));
}

async function diagnoseCodeServer(context) {
  output.clear();
  output.appendLine(`Self-diagnosis ${new Date().toISOString()}`);
  output.appendLine(`Toolbox: v${extensionPackage.version} at ${context.extensionPath}`);
  const paths = configuredPaths(context);
  output.appendLine(`Models: ${paths.configFile}`);
  output.appendLine(`Settings: ${paths.settingsFile}`);
  const groups = await readConfiguredGroups(context);
  const configured = core.collectConfiguredModels(groups);
  const missing = configured.models.filter(
    (model) => !model.apiKey && !model.credentialReference && model.kind !== 'ollama'
  );
  output.appendLine(`Configured testable models: ${configured.models.length}`);
  output.appendLine(`Groups/models without a credential: ${missing.length}`);
  const settings = vscode.workspace.getConfiguration();
  output.appendLine(
    `Terminal profile: ${settings.get('terminal.integrated.defaultProfile.linux', 'default')}`
  );
  output.appendLine(
    `TypeScript memory: ${settings.get('js/ts.tsserver.maxMemory', settings.get('typescript.tsserver.maxTsServerMemory', 'default'))} MB`
  );
  output.appendLine(
    `TypeScript syntax server: ${settings.get('js/ts.tsserver.useSyntaxServer', 'default')}`
  );
  output.appendLine(`Backups retained: ${(await listRepairSnapshots(context)).length}`);
  output.show(true);
}

async function captureTypeScriptDiagnostics() {
  const configuration = vscode.workspace.getConfiguration();
  const current = configuration.get(
    'js/ts.tsserver.log',
    configuration.get('typescript.tsserver.log', 'off')
  );
  if (current === 'off') {
    const confirmed = await vscode.window.showWarningMessage(
      'Temporarily enable normal TypeScript server logging? Logs stay on this device but can contain project paths and code-related protocol data. Reproduce the EPIPE once, then run this action again to open the log.',
      { modal: true },
      'Enable Local Log'
    );
    if (confirmed !== 'Enable Local Log') return;
    await configuration.update(
      'js/ts.tsserver.log',
      'normal',
      vscode.ConfigurationTarget.Global
    );
    await configuration.update(
      'typescript.tsserver.log',
      'normal',
      vscode.ConfigurationTarget.Global
    );
    await vscode.commands.executeCommand('typescript.restartTsServer');
    vscode.window.showInformationMessage(
      'TypeScript logging is enabled locally. Reproduce EPIPE, then choose Capture/open TypeScript crash log again.'
    );
    return;
  }
  await vscode.commands.executeCommand('typescript.openTsServerLog');
}

async function repairCodeServer(context) {
  const action = await vscode.window.showQuickPick(
    [
      {
        label: '$(wrench) Backup and repair locally',
        description: 'Repair models, secrets, Copilot manifest, terminal, and mobile TypeScript settings',
        id: 'local',
      },
      {
        label: '$(cloud-download) Backup and reinstall from GitHub branch',
        description: 'Run the full branch update after a timestamped backup',
        id: 'remote',
      },
      {
        label: '$(debug-restart) Restart TypeScript language server',
        description: 'Recover immediately from a write EPIPE tsserver exit',
        id: 'typescript',
      },
      {
        label: '$(output) Capture/open TypeScript crash log',
        description: 'Enable a local tsserver log, reproduce EPIPE, then open the log',
        id: 'typescript-log',
      },
      {
        label: '$(history) Restore a previous backup',
        description: 'Restore configuration, Copilot manifest, and Toolbox code',
        id: 'restore',
      },
      {
        label: '$(pulse) Diagnose current installation',
        description: 'Show non-secret model, terminal, TypeScript, and backup status',
        id: 'diagnose',
      },
    ],
    { title: `🛠 code-server Self Repair v${extensionPackage.version}` }
  );
  if (!action) return;
  if (action.id === 'restore') {
    await restoreRepairSnapshot(context);
    return;
  }
  if (action.id === 'diagnose') {
    await diagnoseCodeServer(context);
    return;
  }
  if (action.id === 'typescript') {
    await vscode.commands.executeCommand('typescript.restartTsServer');
    vscode.window.showInformationMessage('TypeScript language server restart requested.');
    return;
  }
  if (action.id === 'typescript-log') {
    await captureTypeScriptDiagnostics();
    return;
  }
  if (action.id === 'remote') {
    const configuration = toolboxConfiguration();
    const installed = await performFullGitHubUpdate(
      context,
      configuration.get('githubRepository', 'fazilatma/new'),
      configuration.get('githubBranch', 'arena/f1997f2f-new')
    );
    await scheduleCodeServerRestartAndRefresh(`remote self-repair to v${installed}`);
    void vscode.window.showInformationMessage(
      `Full GitHub self-repair installed v${installed}. code-server is restarting and the page is refreshing.`
    );
    return;
  }

  const confirmed = await vscode.window.showWarningMessage(
    'Create a timestamped backup, repair code-server integration, and restart the TypeScript server?',
    { modal: true },
    'Backup and Repair'
  );
  if (confirmed !== 'Backup and Repair') return;
  const snapshot = await createRepairSnapshot(context, 'before local self-repair');
  output.clear();
  output.appendLine(`Repair backup: ${snapshot}`);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Repairing code-server and Copilot model integration',
      cancellable: true,
    },
    async (_progress, token) => {
      await runHelper(context, ['--preserve-existing-keys'], token);
    }
  );
  await migratePlaintextCredentials(context);
  try {
    await vscode.commands.executeCommand('typescript.restartTsServer');
  } catch (error) {
    output.appendLine(`[TYPESCRIPT] Restart command unavailable: ${error.message || error}`);
  }
  await copyRestartCommand(`Local self-repair completed. Backup: ${snapshot}`);
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

async function resolveConfiguredModelNames(models, timeoutMs, signal, onResolved) {
  const groups = new Map();
  for (const model of models) {
    if (model.kind !== 'openai' || model.modelDiscoveryAttempted) continue;
    const key = `${model.provider}\u0000${model.url}\u0000${model.apiKey || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(model);
  }
  const entries = [...groups.values()];
  let next = 0;
  const worker = async () => {
    while (!signal.aborted) {
      const index = next++;
      if (index >= entries.length) return;
      const providerModels = entries[index];
      const sample = providerModels[0];
      for (const model of providerModels) model.modelDiscoveryAttempted = true;
      if (!sample.apiKey) continue;
      try {
        const response = await core.httpRequest(core.modelsUrl(sample.url), {
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${sample.apiKey}`,
          },
          timeoutMs: Math.min(timeoutMs, 15000),
          signal,
          maxBytes: 8 * 1024 * 1024,
        });
        if (response.status < 200 || response.status >= 300) continue;
        const value = JSON.parse(response.text);
        const remoteModels = Array.isArray(value)
          ? value
          : Array.isArray(value.data)
            ? value.data
            : Array.isArray(value.models)
              ? value.models
              : [];
        if (!remoteModels.length) continue;
        for (const model of providerModels) {
          model.remoteModelCount = remoteModels.length;
          const resolved = core.resolveRemoteModel(model, remoteModels);
          if (resolved) {
            model.resolvedId = resolved.id;
            model.resolutionReason = resolved.reason;
            if (onResolved) onResolved(model);
          } else {
            model.nameResolutionError =
              `Provider returned ${remoteModels.length} model IDs, but configured name/id "${model.id}" had no unique match.`;
          }
        }
      } catch (error) {
        if (error.message !== 'Cancelled') {
          output.appendLine(`[MODEL DISCOVERY] ${sample.provider}: ${core.sanitizeDiagnosticText(error.message, [sample.apiKey])}`);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, entries.length) }, () => worker()));
}

async function repairResolvedModelIds(context, successfulModels) {
  const replacements = new Map();
  for (const model of successfulModels) {
    if (!model.resolvedId || model.resolvedId === model.id) continue;
    replacements.set(`${model.provider}\u0000${model.id}`, model.resolvedId);
  }
  if (!replacements.size) return 0;
  const filename = configuredPaths(context).configFile;
  const groups = JSON.parse(await fsp.readFile(filename, 'utf8'));
  let changed = 0;
  for (const group of groups) {
    if (!group || !Array.isArray(group.models)) continue;
    const provider = String(group.name || group.vendor || '');
    const deduplicated = [];
    const seen = new Set();
    for (const original of group.models) {
      if (!original || typeof original !== 'object') continue;
      const replacement = replacements.get(`${provider}\u0000${String(original.id || '')}`);
      const model = replacement ? { ...original, id: replacement } : original;
      if (replacement) changed += 1;
      const key = `${String(model.id || '')}\u0000${String(model.url || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduplicated.push(model);
    }
    group.models = deduplicated;
  }
  if (!changed) return 0;
  const backupDirectory = path.join(context.globalStorageUri.fsPath, 'model-id-backups');
  await fsp.mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(backupDirectory, `chatLanguageModels-${stamp}.json`);
  await fsp.copyFile(filename, backup);
  await fsp.chmod(backup, 0o600);
  const retention = Math.max(
    1,
    Math.min(30, Number(toolboxConfiguration().get('backupRetention', 8)))
  );
  const oldBackups = (await fsp.readdir(backupDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith('chatLanguageModels-'))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  await Promise.all(
    oldBackups.slice(retention).map((name) =>
      fsp.rm(path.join(backupDirectory, name), { force: true })
    )
  );
  const temporary = `${filename}.${process.pid}.model-repair.tmp`;
  try {
    await fsp.writeFile(temporary, JSON.stringify(groups, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fsp.rename(temporary, filename);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
  output.appendLine(`[MODEL IDS] Repaired ${changed} configured model name/id value(s); backup=${backup}`);
  return changed;
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
    .map((id) => ({
      kind: 'ollama',
      vendor: 'ollama',
      provider: group.provider,
      id,
      url: group.url,
    }));
}

async function testOneModel(model, timeoutMs, signal, prompt, maxOutputTokens, testProfile) {
  const started = Date.now();
  if (model.kind !== 'ollama' && model.credentialReference && !model.apiKey) {
    return {
      ok: false,
      status: 0,
      elapsedMs: 0,
      error:
        'Credential is protected by code-server Chat SecretStorage, but the Toolbox test copy is unavailable. Re-import the JSON with Toolbox to refresh its protected test credential.',
    };
  }
  let response;
  const requestModelId = model.resolvedId || model.id;
  if (model.kind === 'ollama') {
    response = await core.requestJson(
      core.ollamaUrl(model.url, '/api/chat'),
      {
        model: requestModelId,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: { num_predict: maxOutputTokens },
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
        model: requestModelId,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxOutputTokens,
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
    const assistantResponse = core.extractAssistantText(body);
    return {
      ok: true,
      status: response.status,
      elapsedMs,
      response: assistantResponse,
      responsePower: testProfile === 'simple'
        ? core.scoreSimpleResponse(assistantResponse)
        : core.scoreCodingResponse(assistantResponse),
    };
  }
  const detail = apiError ? JSON.stringify(apiError) : response.text;
  const nameHint =
    model.nameResolutionError && [400, 404, 422].includes(response.status)
      ? `${model.nameResolutionError} `
      : '';
  return {
    ok: false,
    status: response.status,
    elapsedMs,
    error: nameHint + core.compactError(detail, model.apiKey),
  };
}

function credentialSummary(model) {
  if (model.kind === 'ollama') return 'Local · no key';
  if (!model.apiKey) {
    return model.credentialReference ? 'Chat SecretStorage · test copy missing' : 'Missing';
  }
  const fingerprint = crypto
    .createHash('sha256')
    .update(model.apiKey)
    .digest('hex')
    .slice(0, 10);
  const location = model.credentialReference ? 'Secure' : 'Plaintext pending migration';
  return `${location} · ${model.apiKey.length} chars · ${fingerprint}`;
}

function providerCredentialAliases(name) {
  const clean = String(name || '').trim();
  const aliases = new Set([clean]);
  if (/\s+AI$/i.test(clean)) aliases.add(clean.replace(/\s+AI$/i, '').trim());
  else aliases.add(`${clean} AI`);
  return [...aliases].filter(Boolean);
}

async function hydrateToolboxCredentials(context, models, warnings) {
  if (!context.secrets) return;
  for (const model of models) {
    if (!model.credentialReference || model.kind === 'ollama') continue;
    let stored;
    for (const alias of providerCredentialAliases(model.provider)) {
      stored = await context.secrets.get(toolboxCredentialKey(model.vendor, alias));
      if (stored && stored.trim()) break;
    }
    if (stored && stored.trim()) {
      model.apiKey = stored.trim();
      await context.secrets.store(
        toolboxCredentialKey(model.vendor, model.provider),
        model.apiKey
      );
    } else {
      warnings.push(
        `${model.provider}: Chat has a protected credential, but Toolbox cannot directly test it until the provider JSON is re-imported.`
      );
    }
  }
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
    testedModel: model.resolvedId || model.id,
    kind: model.kind,
    displayName: model.configuredName || model.id,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    contextWindow: model.contextWindow,
    vision: model.vision,
    streaming: model.streaming,
    reasoning: model.reasoningKnown ? Boolean(model.reasoning) : null,
    reasoningEfforts: model.reasoningEfforts || [],
    toolCalling: typeof model.toolCalling === 'boolean' ? model.toolCalling : null,
    power: core.modelPower(model),
    credential: credentialSummary(model),
  }));
  const initial = webviewJson({
    models: publicModels,
    warnings,
    concurrency: options.concurrency,
    timeoutSeconds: options.timeoutMs / 1000,
    roundRobinDelayMs: Number(options.roundRobinDelayMs) || 0,
    maxOutputTokens: Number(options.maxOutputTokens) || 768,
    suggestedJsonPath: path.join(
      os.homedir(),
      'storage',
      'shared',
      'download',
      DEFAULT_IMPORT_JSON_FILENAME
    ),
    defaultProfile: 'professional',
    prompts: {
      simple: SIMPLE_TEST_PROMPT,
      professional: DEFAULT_CODING_TEST_PROMPT,
    },
    version: extensionPackage.version,
  });
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
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
    .prompt-panel { margin: 12px 0; padding: 10px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-sideBar-background); }
    .prompt-panel label { display: block; font-weight: 600; margin-bottom: 6px; }
    .profile-row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; margin-bottom: 10px; }
    .profile-row > div { min-width: 220px; }
    .profile-row select { width: 100%; }
    textarea { width: 100%; min-height: 150px; resize: vertical; padding: 9px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; font: 13px/1.45 var(--vscode-editor-font-family, monospace); }
    .prompt-help { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 5px; }
    .json-source { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0; padding: 9px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
    .json-source code { flex: 1 1 420px; min-width: 0; padding: 4px 6px; color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); overflow-wrap: anywhere; user-select: text; }
    progress { width: 100%; height: 10px; accent-color: var(--vscode-progressBar-background); }
    .table-wrap { border: 1px solid var(--vscode-panel-border); overflow: auto; height: 62vh; min-height: 280px; max-height: 720px; }
    table { width: 100%; border-collapse: collapse; min-width: 1900px; }
    th { position: sticky; top: 0; z-index: 2; text-align: left; background: var(--vscode-editorGroupHeader-tabsBackground); }
    th, td { padding: 7px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
    th.sortable { padding: 0; }
    .sort-header { width: 100%; min-height: 38px; padding: 7px 8px; border: 0; border-radius: 0; color: var(--vscode-foreground); background: transparent; font: inherit; font-weight: 600; text-align: left; white-space: nowrap; }
    .sort-header:hover, .sort-header:focus-visible { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-hoverBackground); outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .sort-indicator { margin-left: 5px; color: var(--vscode-descriptionForeground); }
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
    .specs { white-space: pre-line; min-width: 190px; color: var(--vscode-descriptionForeground); }
    .capability { display: inline-block; min-width: 58px; text-align: center; border-radius: 999px; padding: 2px 7px; font-size: 12px; }
    .cap-yes { background: var(--vscode-testing-iconPassed, #2ea043); color: var(--vscode-editor-background); }
    .cap-no { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .cap-unknown { border: 1px solid var(--vscode-panel-border); color: var(--vscode-descriptionForeground); }
    .power { min-width: 105px; font-weight: 600; white-space: nowrap; }
    .power small { display: block; color: var(--vscode-descriptionForeground); font-weight: 400; }
    .select-model { min-width: 105px; }
    .select-model.selected { background: var(--vscode-testing-iconPassed, #2ea043); color: var(--vscode-editor-background); }
    .empty { color: var(--vscode-descriptionForeground); }
    @media (max-width: 800px) { .cards { grid-template-columns: repeat(3, 1fr); } body { padding: 10px; } }
  </style>
</head>
<body>
  <h1>🧪 AI Model Test Center <small>v${extensionPackage.version}</small></h1>
  <div class="subtitle">Live inference diagnostics for every configured Copilot Chat model</div>
  <div class="notice"><b>Cost and quota warning:</b> Start sends the selected prompt below as one real, non-streaming inference request to every listed model. Tests run in provider round-robin waves: model 1 from every provider, then model 2, and so on, with an inter-wave pause to reduce rate-limit bursts. The Simple profile requests at most <b>64 output tokens</b>; Professional requests up to <b>${Number(options.maxOutputTokens) || 768} tokens per model</b>. Provider charges and rate limits can be significant. No API key is displayed.</div>
  <div class="prompt-panel">
    <div class="profile-row"><div>
      <label for="testProfile">Test level</label>
      <select id="testProfile"><option value="simple">Simple — Hello response</option><option value="professional" selected>Professional — TypeScript scheduler</option></select>
    </div></div>
    <label for="testPrompt">Editable test prompt</label>
    <textarea id="testPrompt" maxlength="12000" spellcheck="false"></textarea>
    <div id="promptHelp" class="prompt-help">Professional scoring covers implementation completeness, strict typing, fairness, concurrency, pacing, cancellation, retry/backoff, tests, and complexity. Choose Simple for a low-cost greeting/responsiveness check. The prompt remains editable in either level.</div>
  </div>
  <div class="json-source">
    <b>Provider JSON file:</b>
    <code id="suggestedJsonPath"></code>
    <button id="copyJsonPath" type="button">⧉ Copy path</button>
  </div>
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
    <button id="importModels">📥 Import Models / JSON</button>
    <button id="cancel" disabled>■ Cancel</button>
    <button id="retry" disabled>↻ Retry failed</button>
    <button id="copyAll" disabled>⧉ Copy all errors</button>
    <button id="export">⇩ Export JSON report</button>
    <span id="runInfo"></span>
  </div>
  <div class="filters">
    <input id="search" type="search" placeholder="Search provider, model, score, response, or error...">
    <select id="provider"><option value="">All providers</option></select>
    <select id="status">
      <option value="">All statuses</option><option>pending</option><option>queued</option><option>running</option><option>pass</option><option>fail</option><option>cancelled</option>
    </select>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th class="sortable" data-sort="index"><button class="sort-header" type="button">#<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="provider"><button class="sort-header" type="button">Provider<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="model"><button class="sort-header" type="button">Configured model<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="testedModel"><button class="sort-header" type="button">Tested / resolved model<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="specifications"><button class="sort-header" type="button">Model specifications<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="power"><button class="sort-header" type="button">Power / test score<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="reasoning"><button class="sort-header" type="button">Reasoning (declared)<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="tools"><button class="sort-header" type="button">Tool calls (declared)<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="credential"><button class="sort-header" type="button">Credential<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="status"><button class="sort-header" type="button">Status<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="http"><button class="sort-header" type="button">HTTP<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="latency"><button class="sort-header" type="button">Latency<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="selection"><button class="sort-header" type="button">Use in Chat<span class="sort-indicator"></span></button></th>
        <th class="sortable" data-sort="details"><button class="sort-header" type="button">Response / error details<span class="sort-indicator"></span></button></th>
      </tr></thead>
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
    const testProfile = document.getElementById('testProfile');
    const testPrompt = document.getElementById('testPrompt');
    const promptHelp = document.getElementById('promptHelp');
    testProfile.value = initial.defaultProfile;
    testPrompt.value = initial.prompts[testProfile.value];
    const suggestedJsonPath = document.getElementById('suggestedJsonPath');
    suggestedJsonPath.textContent = initial.suggestedJsonPath;
    document.getElementById('copyJsonPath').addEventListener('click', () => {
      vscode.postMessage({ type: 'copy', text: initial.suggestedJsonPath });
    });
    const importModels = document.getElementById('importModels');
    const cancel = document.getElementById('cancel');
    const retry = document.getElementById('retry');
    const copyAll = document.getElementById('copyAll');
    const providers = [...new Set(initial.models.map((item) => item.provider))].sort();
    for (const provider of providers) {
      const option = document.createElement('option'); option.value = provider; option.textContent = provider; providerFilter.appendChild(option);
    }
    document.getElementById('warnings').textContent = initial.warnings.join('\\n');
    document.getElementById('runInfo').textContent = 'Provider round-robin · concurrency ' + initial.concurrency + ' · inter-wave delay ' + initial.roundRobinDelayMs + 'ms · max output ' + initial.maxOutputTokens + ' tokens · timeout ' + initial.timeoutSeconds + 's';

    function cell(text) { const td = document.createElement('td'); td.textContent = text; return td; }
    function formatTokens(value) {
      if (!Number.isFinite(value) || value <= 0) return 'unknown';
      if (value >= 1000000) return (value / 1000000).toFixed(value % 1000000 ? 1 : 0) + 'M';
      if (value >= 1000) return (value / 1000).toFixed(value % 1000 ? 1 : 0) + 'K';
      return String(value);
    }
    function capabilityCell(value, yesText, noText) {
      const td = document.createElement('td'); const badge = document.createElement('span');
      badge.className = 'capability ' + (value === true ? 'cap-yes' : value === false ? 'cap-no' : 'cap-unknown');
      badge.textContent = value === true ? yesText : value === false ? noText : 'Unknown'; td.appendChild(badge); return td;
    }
    function renderPower(td, answerPower, metadataPower) {
      td.replaceChildren(); td.className = 'power';
      if (!answerPower) {
        const pending = document.createElement('span'); pending.textContent = 'Pending';
        const baseline = document.createElement('small'); baseline.textContent = metadataPower && metadataPower.score !== null ? 'metadata ' + metadataPower.score + '/100' : 'metadata unknown';
        td.title = 'Answer-based score is calculated after the selected test. ' + (metadataPower && metadataPower.basis ? metadataPower.basis : '');
        td.append(pending, baseline); return;
      }
      td.title = answerPower.basis + (answerPower.evidence && answerPower.evidence.length ? '\\nEvidence: ' + answerPower.evidence.join(', ') : '');
      const score = document.createElement('span'); score.textContent = answerPower.score + '/100';
      const label = document.createElement('small'); label.textContent = answerPower.label;
      const baseline = document.createElement('small'); baseline.textContent = metadataPower && metadataPower.score !== null ? 'metadata baseline ' + metadataPower.score : 'metadata baseline unknown';
      td.append(score, label, baseline);
    }
    function powerCell(metadataPower) {
      const td = document.createElement('td'); renderPower(td, null, metadataPower); return td;
    }
    function modelSpecs(item) {
      const context = item.contextWindow || null;
      const efforts = Array.isArray(item.reasoningEfforts) && item.reasoningEfforts.length ? '\\nReasoning levels ' + item.reasoningEfforts.join(', ') : '';
      return item.displayName + '\\nContext ' + formatTokens(context) + ' · Input ' + formatTokens(item.maxInputTokens) + ' · Output ' + formatTokens(item.maxOutputTokens) + '\\nVision ' + (item.vision === true ? 'Yes' : item.vision === false ? 'No' : 'Unknown') + ' · Streaming ' + (item.streaming === true ? 'Yes' : item.streaming === false ? 'No' : 'Unknown') + efforts;
    }
    function renderDetails(td, result) {
      td.replaceChildren();
      const text = result && (result.error || result.response) || '';
      if (!text) { const span = document.createElement('span'); span.className = 'empty'; span.textContent = '—'; td.appendChild(span); return; }
      const isError = Boolean(result.error);
      const details = document.createElement('details');
      const summary = document.createElement('summary'); summary.textContent = (isError ? 'Error: ' : 'Answer: ') + text.slice(0, 120) + (text.length > 120 ? '…' : '');
      const pre = document.createElement('pre'); pre.textContent = text;
      const button = document.createElement('button'); button.className = 'copy'; button.textContent = isError ? 'Copy error' : 'Copy answer';
      button.addEventListener('click', () => vscode.postMessage({ type: 'copy', text }));
      details.append(summary, pre, button); td.appendChild(details);
    }
    let activeSortKey = '';
    let sortDirection = 1;
    const statusOrder = { pending: 0, queued: 1, running: 2, pass: 3, fail: 4, cancelled: 5 };
    function sortValue(row, key) {
      const result = results.get(row.item.key) || {};
      if (key === 'index') return row.index;
      if (key === 'provider') return row.item.provider;
      if (key === 'model') return row.item.model;
      if (key === 'testedModel') return row.item.testedModel;
      if (key === 'specifications') return modelSpecs(row.item);
      if (key === 'power') return result.responsePower && Number.isFinite(result.responsePower.score) ? result.responsePower.score : row.item.power && Number.isFinite(row.item.power.score) ? row.item.power.score : -1;
      if (key === 'reasoning') return row.item.reasoning === true ? 2 : row.item.reasoning === false ? 0 : 1;
      if (key === 'tools') return row.item.toolCalling === true ? 2 : row.item.toolCalling === false ? 0 : 1;
      if (key === 'credential') return row.item.credential;
      if (key === 'status') return statusOrder[row.tr.dataset.status] ?? -1;
      if (key === 'http') return Number(result.status) || -1;
      if (key === 'latency') return Number(result.elapsedMs) || -1;
      if (key === 'selection') return row.selected ? 2 : row.tr.dataset.status === 'pass' ? 1 : 0;
      if (key === 'details') return result.error || result.response || '';
      return '';
    }
    function compareSortValues(left, right) {
      if (typeof left === 'number' && typeof right === 'number') return left - right;
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' });
    }
    function sortRows() {
      if (!activeSortKey) return;
      const ordered = [...rowElements.values()].sort((left, right) => {
        const compared = compareSortValues(sortValue(left, activeSortKey), sortValue(right, activeSortKey));
        return (compared || left.index - right.index) * sortDirection;
      });
      const fragment = document.createDocumentFragment();
      for (const row of ordered) fragment.appendChild(row.tr);
      rows.appendChild(fragment);
      for (const header of document.querySelectorAll('th[data-sort]')) {
        const selected = header.dataset.sort === activeSortKey;
        header.setAttribute('aria-sort', selected ? (sortDirection === 1 ? 'ascending' : 'descending') : 'none');
        header.querySelector('.sort-indicator').textContent = selected ? (sortDirection === 1 ? '▲' : '▼') : '';
      }
    }
    for (const header of document.querySelectorAll('th[data-sort]')) {
      header.setAttribute('aria-sort', 'none');
      header.querySelector('button').addEventListener('click', () => {
        const key = header.dataset.sort;
        if (activeSortKey === key) sortDirection *= -1;
        else { activeSortKey = key; sortDirection = 1; }
        sortRows();
      });
    }
    function addRow(item, index) {
      const tr = document.createElement('tr'); tr.dataset.key = item.key; tr.dataset.provider = item.provider; tr.dataset.status = 'pending';
      tr.append(cell(String(index + 1)), cell(item.provider), cell(item.model));
      const testedModel = cell(item.testedModel); tr.appendChild(testedModel);
      const specs = cell(modelSpecs(item)); specs.className = 'specs'; tr.appendChild(specs);
      const power = powerCell(item.power); tr.appendChild(power);
      tr.appendChild(capabilityCell(item.reasoning, 'Yes', 'No'));
      tr.appendChild(capabilityCell(item.toolCalling, 'Yes', 'No'));
      const credential = cell(item.credential); if (item.credential === 'Missing') credential.className = 'credential-missing'; tr.appendChild(credential);
      const status = cell('pending'); const badge = document.createElement('span'); badge.className = 'status pending'; badge.textContent = 'pending'; status.replaceChildren(badge); tr.appendChild(status);
      const http = cell('—'); const latency = cell('—'); tr.append(http, latency);
      const selectCell = document.createElement('td'); const selectButton = document.createElement('button');
      selectButton.className = 'select-model'; selectButton.textContent = 'Use in Chat'; selectButton.disabled = true;
      selectButton.title = 'The model must pass its real test before selection';
      selectButton.addEventListener('click', () => { selectButton.disabled = true; selectButton.textContent = 'Selecting…'; vscode.postMessage({ type: 'selectModel', key: item.key }); });
      selectCell.appendChild(selectButton); tr.appendChild(selectCell);
      const error = cell(''); renderDetails(error, null); tr.appendChild(error);
      rows.appendChild(tr); rowElements.set(item.key, { tr, badge, testedModel, power, http, latency, selectButton, error, item, index });
    }
    initial.models.forEach(addRow);

    function updateRow(message) {
      const row = rowElements.get(message.key); if (!row) return;
      row.tr.dataset.status = message.state;
      row.badge.className = 'status ' + message.state; row.badge.textContent = message.state;
      row.http.textContent = message.status ? String(message.status) : '—';
      row.latency.textContent = message.elapsedMs ? message.elapsedMs + ' ms' : '—';
      row.selectButton.disabled = message.state !== 'pass' || row.selected === true;
      row.selectButton.title = message.state === 'pass' ? 'Persist this passing model as the selected Chat model' : 'The model must pass its real test before selection';
      renderPower(row.power, message.responsePower || (['fail', 'cancelled'].includes(message.state) ? { score: 0, label: 'No answer', evidence: [], basis: 'Request ended before a scoreable coding answer was returned' } : null), row.item.power);
      renderDetails(row.error, message);
      results.set(message.key, message);
      updateSummary(); applyFilters(); sortRows();
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
        const result = results.get(row.item.key); const haystack = [row.item.provider, row.item.model, row.item.testedModel, row.item.displayName, modelSpecs(row.item), row.item.power && row.item.power.score, row.item.power && row.item.power.label, result && result.responsePower && result.responsePower.score, result && result.responsePower && result.responsePower.label, row.item.reasoning === true ? 'reasoning' : '', row.item.toolCalling === true ? 'tools tool calling' : '', row.item.credential, result && result.error, result && result.response].join(' ').toLowerCase();
        row.tr.hidden = Boolean((provider && row.item.provider !== provider) || (status && row.tr.dataset.status !== status) || (query && !haystack.includes(query)));
      }
    }
    function setRunning(value) { start.disabled = value; testProfile.disabled = value; testPrompt.disabled = value; importModels.disabled = value; cancel.disabled = !value; retry.disabled = value || ![...rowElements.values()].some((row) => row.tr.dataset.status === 'fail'); }
    function currentProfile() { return testProfile.value === 'simple' ? 'simple' : 'professional'; }
    function currentPrompt() { return testPrompt.value.trim() || initial.prompts[currentProfile()]; }
    testProfile.addEventListener('change', () => {
      const profile = currentProfile();
      testPrompt.value = initial.prompts[profile];
      promptHelp.textContent = profile === 'simple'
        ? 'Simple uses a low-cost greeting/responsiveness rubric and requests at most 64 output tokens. The prompt remains editable.'
        : 'Professional uses the advanced TypeScript coding rubric and the configured output-token limit. The prompt remains editable.';
      document.getElementById('runInfo').textContent = profile === 'simple'
        ? 'Simple greeting test · max 64 output tokens · ready'
        : 'Professional coding test · max ' + initial.maxOutputTokens + ' output tokens · ready';
    });
    start.addEventListener('click', () => { setRunning(true); document.getElementById('runInfo').textContent = 'Resolving provider model names, then running the selected ' + currentProfile() + ' test…'; vscode.postMessage({ type: 'start', prompt: currentPrompt(), profile: currentProfile() }); });
    importModels.addEventListener('click', () => vscode.postMessage({ type: 'importModels' }));
    cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    retry.addEventListener('click', () => vscode.postMessage({ type: 'retryFailed', prompt: currentPrompt(), profile: currentProfile() }));
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
        setRunning(true); document.getElementById('runInfo').textContent = 'Running ' + message.keys.length + ' ' + message.profile + ' model tests · max ' + message.maxOutputTokens + ' output tokens…';
      } else if (message.type === 'resolved') {
        const row = rowElements.get(message.key);
        if (row) { row.item.testedModel = message.model; row.testedModel.textContent = message.model; row.testedModel.title = message.reason; sortRows(); }
      } else if (message.type === 'row') updateRow(message);
      else if (message.type === 'selectedModel') {
        for (const row of rowElements.values()) {
          row.selected = row.item.key === message.key;
          row.selectButton.className = 'select-model' + (row.selected ? ' selected' : '');
          row.selectButton.textContent = row.selected ? '✓ Selected' : 'Use in Chat';
          row.selectButton.disabled = row.selected || row.tr.dataset.status !== 'pass';
        }
        sortRows();
        document.getElementById('runInfo').textContent = message.message;
      } else if (message.type === 'selectionError') {
        const row = rowElements.get(message.key);
        if (row) { row.selectButton.textContent = 'Use in Chat'; row.selectButton.disabled = row.tr.dataset.status !== 'pass'; }
        document.getElementById('runInfo').textContent = message.message;
      } else if (message.type === 'runDone') {
        setRunning(false); start.textContent = '▶ Run all again';
        document.getElementById('runInfo').textContent = message.summary;
      }
    });
    updateSummary();
  </script>
</body>
</html>`;
}

function abortableDelay(milliseconds, signal) {
  if (!milliseconds || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function endpointHost(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return 'invalid-endpoint';
  }
}

async function saveSanitizedDiagnostics(context, models, results, summary) {
  const settings = vscode.workspace.getConfiguration();
  const report = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    toolboxVersion: extensionPackage.version,
    vscodeVersion: vscode.version,
    appName: vscode.env.appName,
    platform: `${os.platform()}-${os.arch()}`,
    summary,
    stability: {
      tsserverMemoryMb: settings.get(
        'js/ts.tsserver.maxMemory',
        settings.get('typescript.tsserver.maxTsServerMemory', 'default')
      ),
      syntaxServer: settings.get('js/ts.tsserver.useSyntaxServer', 'default'),
      validation: settings.get('js/ts.validate.enabled', 'default'),
    },
    models: models.map((model) => {
      const result = results.get(model.testKey) || { state: 'pending' };
      return {
        provider: core.sanitizeDiagnosticText(model.provider, [model.apiKey], 200),
        vendor: core.sanitizeDiagnosticText(model.vendor, [model.apiKey], 100),
        configuredModel: core.sanitizeDiagnosticText(model.id, [model.apiKey], 300),
        resolvedModel: core.sanitizeDiagnosticText(model.resolvedId || model.id, [model.apiKey], 300),
        resolution: core.sanitizeDiagnosticText(model.resolutionReason || '', [], 100),
        specifications: {
          maxInputTokens: model.maxInputTokens,
          maxOutputTokens: model.maxOutputTokens,
          contextWindow: model.contextWindow,
          vision: model.vision,
          streaming: model.streaming,
          reasoning: model.reasoningKnown ? Boolean(model.reasoning) : null,
          toolCalling: model.toolCalling,
          power: core.modelPower(model),
        },
        endpointHost: endpointHost(model.url),
        state: result.state,
        httpStatus: result.status || 0,
        elapsedMs: result.elapsedMs || 0,
        testProfile: result.testProfile || '',
        responsePower: result.responsePower
          ? {
              score: result.responsePower.score,
              label: result.responsePower.label,
              evidence: result.responsePower.evidence,
            }
          : null,
        error: core.sanitizedModelTestError(result.error || '', [model.apiKey]),
      };
    }),
  };
  await fsp.mkdir(context.globalStorageUri.fsPath, { recursive: true, mode: 0o700 });
  const destination = path.join(context.globalStorageUri.fsPath, 'latest-sanitized-diagnostics.json');
  await fsp.writeFile(destination, JSON.stringify(report, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fsp.chmod(destination, 0o600);
  output.appendLine(`[DIAGNOSTICS] Sanitized report saved locally: ${destination}`);
  return destination;
}

async function exportTestReport(context, models, results, prompt, testProfile, maxOutputTokens) {
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
    testPrompt: prompt,
    testProfile,
    maxOutputTokens,
    models: models.map((model) => ({
      provider: model.provider,
      model: model.id,
      kind: model.kind,
      specifications: {
        name: model.configuredName || model.id,
        maxInputTokens: model.maxInputTokens,
        maxOutputTokens: model.maxOutputTokens,
        contextWindow: model.contextWindow,
        vision: model.vision,
        streaming: model.streaming,
        reasoning: model.reasoningKnown ? Boolean(model.reasoning) : null,
        reasoningEfforts: model.reasoningEfforts || [],
        toolCalling: model.toolCalling,
        power: core.modelPower(model),
      },
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
  let currentTestProfile = 'professional';
  let currentTestPrompt = DEFAULT_CODING_TEST_PROMPT;
  let currentMaxOutputTokens = options.maxOutputTokens;

  const run = async (selectedKeys, requestedPrompt, requestedProfile) => {
    if (running) return;
    const selected = models.filter((model) => selectedKeys.includes(model.testKey));
    if (selected.length === 0) return;
    currentTestProfile = requestedProfile === 'simple' ? 'simple' : 'professional';
    const normalizedPrompt = String(requestedPrompt || '').trim();
    const profilePrompt = currentTestProfile === 'simple' ? SIMPLE_TEST_PROMPT : DEFAULT_CODING_TEST_PROMPT;
    currentTestPrompt = (normalizedPrompt || profilePrompt).slice(0, 12000);
    currentMaxOutputTokens = currentTestProfile === 'simple'
      ? Math.min(64, options.maxOutputTokens)
      : options.maxOutputTokens;
    running = true;
    activeController = new AbortController();
    const attempted = new Set();
    for (const model of selected) results.delete(model.testKey);
    panel.webview.postMessage({
      type: 'runStarted',
      keys: selected.map((model) => model.testKey),
      profile: currentTestProfile,
      maxOutputTokens: currentMaxOutputTokens,
    });
    output.clear();
    output.appendLine(`AI model dashboard run started: ${new Date().toISOString()}`);
    await resolveConfiguredModelNames(
      selected,
      options.timeoutMs,
      activeController.signal,
      (model) => {
        panel.webview.postMessage({
          type: 'resolved',
          key: model.testKey,
          model: model.resolvedId,
          reason: model.resolutionReason,
        });
        if (model.resolvedId !== model.id) {
          output.appendLine(
            `[MODEL ID] ${model.provider}: ${model.id} -> ${model.resolvedId} (${model.resolutionReason})`
          );
        }
      }
    );
    const testModel = async (model) => {
      attempted.add(model.testKey);
      panel.webview.postMessage({ type: 'row', key: model.testKey, state: 'running', status: 0, elapsedMs: 0, error: '' });
      let tested;
      try {
        tested = await testOneModel(
          model,
          options.timeoutMs,
          activeController.signal,
          currentTestPrompt,
          currentMaxOutputTokens,
          currentTestProfile
        );
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
      const result = {
        state,
        status: tested.status,
        elapsedMs: tested.elapsedMs,
        error: tested.error || '',
        response: tested.response || '',
        responsePower: tested.responsePower || null,
        testProfile: currentTestProfile,
      };
      results.set(model.testKey, result);
      panel.webview.postMessage({ type: 'row', key: model.testKey, ...result });
      const label = `${model.provider} :: ${model.id}`;
      output.appendLine(
        `[${state.toUpperCase()}] ${label} (${tested.status ? `HTTP ${tested.status}` : 'network'}, ${tested.elapsedMs}ms)` +
          (tested.error ? ` ${core.sanitizedModelTestError(tested.error, [model.apiKey])}` : '')
      );
    };
    const rounds = core.roundRobinModelRounds(selected);
    try {
      for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
        if (activeController.signal.aborted) break;
        const round = rounds[roundIndex];
        output.appendLine(
          `[ROUND ROBIN] Wave ${roundIndex + 1}/${rounds.length}: ${round.map((model) => `${model.provider}/${model.id}`).join(', ')}`
        );
        let nextInRound = 0;
        const roundWorker = async () => {
          while (!activeController.signal.aborted) {
            const model = round[nextInRound++];
            if (!model) return;
            await testModel(model);
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(options.concurrency, round.length) }, () => roundWorker())
        );
        if (roundIndex < rounds.length - 1 && !activeController.signal.aborted) {
          await abortableDelay(options.roundRobinDelayMs, activeController.signal);
        }
      }
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
      let summary = `${passed} passed · ${failed} failed · ${cancelled} cancelled`;
      const successful = selected.filter(
        (model) => results.get(model.testKey)?.state === 'pass'
      );
      if (successful.length) {
        try {
          const repaired = await repairResolvedModelIds(context, successful);
          if (repaired) summary += ` · ${repaired} model ID(s) repaired`;
        } catch (error) {
          summary += ' · model ID repair failed (see output)';
          output.appendLine(`[MODEL ID REPAIR ERROR] ${error.stack || error.message || error}`);
        }
      }
      let pinResult;
      if (successful.length && toolboxConfiguration().get('pinSuccessfulModels', true)) {
        try {
          pinResult = await persistPinnedModels(context, successful);
          summary += ` · ${pinResult.added} newly pinned (${pinResult.total} total)`;
          output.appendLine(
            `[PIN] requested=${pinResult.requested} added=${pinResult.added} ` +
              `total=${pinResult.total} unhidden=${pinResult.unhidden}`
          );
        } catch (error) {
          summary += ' · pinning failed (see output)';
          output.appendLine(`[PIN ERROR] ${error.stack || error.message || error}`);
        }
      }
      try {
        await saveSanitizedDiagnostics(context, models, results, summary);
      } catch (error) {
        output.appendLine(`[DIAGNOSTICS ERROR] ${error.stack || error.message || error}`);
      }
      panel.webview.postMessage({ type: 'runDone', summary });
      output.appendLine(`Summary: ${summary}`);
      if (pinResult?.restartRequired) {
        await copyRestartCommand(
          `${pinResult.added} successful model(s) were saved to Copilot Chat's pinned list.`
        );
      }
    }
  };

  panel.webview.onDidReceiveMessage(async (message) => {
    try {
      if (message.type === 'start') {
        await run(models.map((model) => model.testKey), message.prompt, message.profile);
      } else if (message.type === 'importModels') {
        await vscode.commands.executeCommand('copilotModels.importJson');
      } else if (message.type === 'retryFailed') {
        await run(
          models
            .filter((model) => results.get(model.testKey)?.state === 'fail')
            .map((model) => model.testKey),
          message.prompt,
          message.profile
        );
      } else if (message.type === 'cancel' && activeController) {
        activeController.abort();
      } else if (message.type === 'copy') {
        await vscode.env.clipboard.writeText(String(message.text || ''));
        vscode.window.showInformationMessage('Dashboard text copied.');
      } else if (message.type === 'selectModel') {
        const model = models.find((candidate) => candidate.testKey === message.key);
        if (!model) throw new Error('Selected dashboard model was not found');
        if (results.get(model.testKey)?.state !== 'pass') {
          panel.webview.postMessage({
            type: 'selectionError',
            key: model.testKey,
            message: 'Only a model that passed its real request can be selected for Chat.',
          });
          return;
        }
        try {
          const selected = await selectModelForChat(context, model);
          const selectionMessage = selected.liveSelectionRequested
            ? `${model.provider} / ${model.resolvedId || model.id} selected for Chat and persisted with a private profile backup. Restart only if the live picker does not refresh.`
            : `${model.provider} / ${model.resolvedId || model.id} persisted as the selected Chat model. Restart code-server to refresh the live picker.`;
          panel.webview.postMessage({
            type: 'selectedModel',
            key: model.testKey,
            message: selectionMessage,
          });
          vscode.window.showInformationMessage(selectionMessage);
          output.appendLine(
            `[SELECT MODEL] ${selected.identifier}; live=${selected.liveSelectionRequested}; backup=${selected.backup || 'unchanged'}`
          );
        } catch (error) {
          panel.webview.postMessage({
            type: 'selectionError',
            key: model.testKey,
            message: `Model selection failed: ${error.message || error}`,
          });
          output.appendLine(`[SELECT MODEL ERROR] ${error.stack || error.message || error}`);
        }
      } else if (message.type === 'export') {
        await exportTestReport(
          context,
          models,
          results,
          currentTestPrompt,
          currentTestProfile,
          currentMaxOutputTokens
        );
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
  const roundRobinDelayMs = Math.max(
    0,
    Math.min(10000, Number(configuration.get('roundRobinDelayMs', 750)))
  );
  const maxOutputTokens = Math.max(
    64,
    Math.min(2048, Number(configuration.get('codingTestMaxOutputTokens', 768)))
  );
  const credentialMigration = await migratePlaintextCredentials(context);
  const groups = await readConfiguredGroups(context);
  const configured = core.collectConfiguredModels(groups);
  const discoveryWarnings = [];
  if (credentialMigration.pending) {
    discoveryWarnings.push(
      `${credentialMigration.pending} credential group(s) remain plaintext and are not Chat-compatible on this code-server build, even if a direct HTTP test passes.`
    );
  }
  await hydrateToolboxCredentials(context, configured.models, discoveryWarnings);
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
  const models = core.roundRobinModels(configured.models).map((model, index) => ({
    ...model,
    testKey: `model-${index}`,
  }));
  openTestDashboard(
    context,
    models,
    [...configured.warnings, ...discoveryWarnings],
    { concurrency, timeoutMs, roundRobinDelayMs, maxOutputTokens }
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
  void ensureChatBidiStylesheets()
    .then((results) => {
      const changed = results.filter((result) => result.changed);
      for (const result of results) {
        output.appendLine(
          `[CHAT RTL] ${result.changed ? 'Patched' : 'Ready'}: ${result.filename}`
        );
      }
      if (changed.length) {
        output.appendLine('[CHAT RTL] Reloading the workbench once to apply the stylesheet.');
        setTimeout(() => {
          void vscode.commands.executeCommand('workbench.action.reloadWindow').catch((error) => {
            output.appendLine(`[CHAT RTL RELOAD ERROR] ${error.message || error}`);
          });
        }, 1500);
      }
    })
    .catch((error) => {
      output.appendLine(`[CHAT RTL ERROR] ${error.stack || error.message || error}`);
    });
  registerCommand(context, 'copilotModels.testAll', testAllModels);
  registerCommand(context, 'copilotModels.importJson', importJson);
  registerCommand(context, 'copilotModels.syncGitHub', syncGitHub);
  registerCommand(context, 'copilotModels.repair', repairCodeServer);
  registerCommand(context, 'copilotModels.zoom', zoomCodeServer);
  if (
    typeof vscode.window.createStatusBarItem === 'function' &&
    vscode.StatusBarAlignment
  ) {
    const zoomStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    zoomStatus.text = '$(zoom-in) Zoom';
    zoomStatus.tooltip = 'Force code-server zoom in, zoom out, reset, or an exact global level';
    zoomStatus.command = 'copilotModels.zoom';
    zoomStatus.show();
    context.subscriptions.push(zoomStatus);
  }
  restartAutoUpdater(context);
  void migratePlaintextCredentials(context)
    .then((result) => {
      if (result.migrated) {
        vscode.window.showInformationMessage(
          `Copilot Models Toolbox moved ${result.migrated} provider credential(s) into code-server Chat SecretStorage. Reselect the model before using it.`
        );
      }
    })
    .catch((error) => {
      output.appendLine(`[CREDENTIAL MIGRATION ERROR] ${error.stack || error.message || error}`);
      output.show(true);
    });
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
  __test: {
    codeServerWorkbenchStylesheets,
    collectCodeServerDiagnostics,
    ensureChatBidiStylesheets,
    createRepairSnapshot,
    credentialSummary,
    diagnosticCommentChunks,
    githubApiJson,
    githubSyncHtml,
    installDownloadedRuntimeDirectly,
    migratePlaintextCredentials,
    providerCredentialAliases,
    repairResolvedModelIds,
    testDashboardHtml,
    termuxRuntimeEnvironment,
    resolveExecutable,
    pythonCommand,
    toolboxCredentialKey,
    zoomCodeServer,
  },
};
