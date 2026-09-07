#!/usr/bin/env node
/**
 * UNIVERSAL DEPLOYER — RUN INSTRUCTIONS
 * =====================================
 * This file is a real Node.js CLI deployer. It does not require Cloudflare
 * unless you choose the `cloudflare-worker` environment.
 *
 * Common setup, after cloning/pulling the repository:
 *   cd new/cloudflare-scraper4
 *   npm install
 *   node scripts/universal-deployer.mjs --help
 *
 * VS Code / local desktop:
 *   cd new/cloudflare-scraper4
 *   npm install
 *   node scripts/universal-deployer.mjs --env vscode --mode prepare
 *   npm run deployer:ui
 *   # then open the printed http://localhost:8790 style URL
 *
 * GitHub Codespaces:
 *   cd /workspaces/new/cloudflare-scraper4
 *   npm install
 *   node scripts/universal-deployer.mjs --env vscode --mode prepare
 *   npm run deployer:ui
 *   # open the forwarded port from the Codespaces Ports panel
 *
 * Termux / Android, offline bundle workflow:
 *   # Paste plain text only; do not paste Markdown links like [https://...](https://...).
 *   cd "$HOME"
 *   pkg update -y && pkg upgrade -y
 *   pkg install -y git gh openssh nodejs-lts python make clang tar gzip chromium
 *   rm -rf "$HOME/new"
 *   git config --global --unset-all credential.helper || true
 *   gh auth login --web -h github.com -p https
 *   gh auth setup-git
 *   gh repo clone fazilatma/new "$HOME/new" -- --branch arena/01a0765b-new --depth 1
 *   cd "$HOME/new"
 *   git config --local --unset-all credential.helper || true
 *   git config --local --replace-all credential.helper "!gh auth git-credential"
 *   git pull --ff-only origin arena/01a0765b-new
 *   cd "$HOME/new/cloudflare-scraper4"
 *   npm install --ignore-scripts
 *   npm run browsers:install || true
 *   CHROME_BIN="$(command -v chromium-browser || command -v chromium || true)"
 *   if [ -n "$CHROME_BIN" ]; then printf "BROWSER_EXECUTABLE_PATH=$CHROME_BIN\nPLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$CHROME_BIN\nPUPPETEER_EXECUTABLE_PATH=$CHROME_BIN\nLOCAL_SCRAPER_AUTO_UPDATE=true\n" >> .env.local; fi
 *   node scripts/universal-deployer.mjs --env termux-offline --mode prepare --out .deploy/termux
 *   # If GitHub asks for a password, passwords are unsupported; use gh auth login (above) or SSH.
 *   # copy/use the generated files from .deploy/termux
 *
 * Cloudflare Workers deployment:
 *   cd new/cloudflare-scraper4
 *   npm ci
 *   npm run worker:test
 *   npx wrangler login
 *   npm run worker:deploy
 *   # or set CLOUDFLARE_API_TOKEN in your shell/CI, never commit it
 *
 * Render preparation:
 *   cd new/cloudflare-scraper4
 *   npm ci
 *   node scripts/universal-deployer.mjs --env render --mode prepare
 *   npm run render:build
 *   PORT=3000 npm run render:start
 *
 * VPS server preparation:
 *   sudo apt update && sudo apt install -y nodejs npm nginx
 *   git clone https://github.com/fazilatma/new.git /opt/scraper4
 *   cd /opt/scraper4/cloudflare-scraper4
 *   npm ci
 *   node scripts/universal-deployer.mjs --env vps --mode prepare --out .deploy/vps
 *   # review generated systemd/Nginx installer files before running them as root
 *
 * Useful profiles:
 *   --scraping-profile minimal   Cloudflare/edge-friendly parsers only
 *   --scraping-profile node      Node HTTP + DOM scraping stack
 *   --scraping-profile browser   Playwright/Puppeteer/Crawlee for Node/Render/VPS
 *   --scraping-profile full      Everything curated by this deployer
 *
 * Safety note: proxy-related packages are for authorized networks only. Do not
 * use this deployer or scraper to bypass access controls, terms, or robots rules.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { readdir, cp, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const ENVIRONMENTS = new Set(['termux-offline', 'vscode', 'cloudflare-worker', 'vercel', 'render', 'vps']);

const SCRAPING_LIBRARY_GROUPS = {
  edge: {
    description: 'Cloudflare/edge-compatible parsers and query helpers',
    deps: ['htmlparser2', 'parse5', 'node-html-parser', 'linkedom', 'css-select', 'domutils', 'entities', 'he', 'jsonpath-plus', 'secure-json-parse']
  },
  node: {
    description: 'Node.js HTTP clients, DOM parsers, metadata, XML, CSV and spreadsheet tools',
    deps: ['undici', 'got', 'axios', 'cheerio', 'jsdom', 'happy-dom', 'xpath', 'fontoxpath', 'html-metadata-parser', 'metascraper', 'metascraper-title', 'metascraper-image', 'metascraper-description', 'fast-xml-parser', 'xml2js', 'rss-parser', 'sitemap', 'csv-parse', 'papaparse', 'fast-csv', 'read-excel-file', 'exceljs', 'xlsx', 'sanitize-html', 'html-to-text', 'turndown', 'normalize-url']
  },
  browser: {
    description: 'JavaScript rendering engines for Node.js hosts, not Cloudflare Workers',
    deps: ['playwright', 'puppeteer', 'puppeteer-core']
  },
  crawler: {
    description: 'Crawler scheduling, rate limiting, robots and queue helpers',
    deps: ['crawlee', 'p-queue', 'bottleneck', 'robots-parser']
  },
  data: {
    description: 'Structured data, JSON search and content extraction helpers',
    deps: ['jsonpath-plus', 'jmespath', 'object-scan', 'schema-dts', '@mozilla/readability', 'unfluff']
  },
  media: {
    description: 'Image and document inspection. Some packages may need native support on mobile/VPS.',
    deps: ['probe-image-size', 'image-size', 'file-type', 'pdf-parse', 'pdfjs-dist', 'mammoth']
  },
  locale: {
    description: 'Persian/Arabic text, dates, entities and normalization helpers',
    deps: ['persian-tools', 'jalaali-js', 'dayjs', 'slugify', 'xregexp']
  },
  proxy: {
    description: 'Proxy agent plumbing for authorized networks only; not an anti-bot bypass kit',
    deps: ['proxy-agent', 'https-proxy-agent', 'socks-proxy-agent', 'proxy-chain', 'user-agents']
  }
};

const SCRAPING_LIBRARY_PROFILES = {
  minimal: ['edge'],
  edge: ['edge', 'data', 'locale'],
  node: ['edge', 'node', 'crawler', 'data', 'locale'],
  browser: ['node', 'browser', 'crawler', 'data', 'locale'],
  full: ['edge', 'node', 'browser', 'crawler', 'data', 'media', 'locale', 'proxy']
};

function usage() {
  return `Universal deployer for Node.js/Next.js/Cloudflare Worker projects.

Usage:
  node scripts/universal-deployer.mjs --env <environment> [options]

Environments:
  termux-offline     Create an offline install bundle for Termux on Android.
  vscode             Generate VS Code tasks/settings for mobile or desktop development.
  cloudflare-worker  Build/test/deploy a Cloudflare Workers project with Wrangler.
  vercel             Prepare or deploy a Vercel/Next.js project.
  render             Prepare or deploy a Render Web Service project.
  vps                Generate a VPS deployment bundle with systemd and Nginx examples.

Options:
  --project-dir <dir>       Project directory. Default: current directory.
  --env <name>              Target environment.
  --mode <plan|prepare|deploy>
                           plan: print actions only. prepare: create files/bundles. deploy: run provider CLI when possible.
                           Default: prepare.
  --out <dir>               Output directory for generated artifacts. Default: .deploy/<env>.
  --name <name>             Service/app name. Default: package.json name or folder name.
  --start <command>         Start command override.
  --build <command>         Build command override.
  --port <port>             Runtime port for VPS/Render examples. Default: 3000.
  --include-node-modules    Include node_modules in Termux/VPS archive if present.
  --skip-tests              Do not run tests before deploy.
  --yes                     Non-interactive confirmation for deploy mode.
  --scraping-libs <profile>  Install or print scraping libraries: minimal, edge, node, browser, full, list.
  --package-manager <name>   npm, pnpm, yarn, or bun. Default: npm.
  --dry-run                  Print install commands without running package-manager installs.

Examples:
  node scripts/universal-deployer.mjs --env termux-offline --project-dir . --include-node-modules
  node scripts/universal-deployer.mjs --env vscode --project-dir .
  node scripts/universal-deployer.mjs --env cloudflare-worker --mode deploy --yes
  node scripts/universal-deployer.mjs --env vercel --mode prepare
  node scripts/universal-deployer.mjs --env render --mode prepare
  node scripts/universal-deployer.mjs --env vps --name scraper4-cloudflare --port 3000
  node scripts/universal-deployer.mjs --env vscode --scraping-libs node
  node scripts/universal-deployer.mjs --env vscode --scraping-libs list
`;
}

function parseArgs(argv) {
  const args = { projectDir: process.cwd(), mode: 'prepare', port: '3000', includeNodeModules: false, skipTests: false, yes: false, packageManager: 'npm', dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--project-dir') args.projectDir = argv[++i];
    else if (a === '--env') args.env = argv[++i];
    else if (a === '--mode') args.mode = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--start') args.start = argv[++i];
    else if (a === '--build') args.build = argv[++i];
    else if (a === '--port') args.port = argv[++i];
    else if (a === '--include-node-modules') args.includeNodeModules = true;
    else if (a === '--skip-tests') args.skipTests = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--scraping-libs') args.scrapingLibs = argv[++i];
    else if (a === '--package-manager') args.packageManager = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function readJson(path, fallback = {}) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function sh(command, cwd, env = {}) {
  console.log(`$ ${command}`);
  const result = spawnSync(command, { cwd, shell: true, stdio: 'inherit', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`Command failed with exit code ${result.status}: ${command}`);
}

function commandExists(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'command', [process.platform === 'win32' ? command : '-v', command], { shell: true, stdio: 'ignore' });
  return result.status === 0;
}


function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function scrapingLibraries(profile = 'node') {
  if (profile === 'list') return [];
  const groups = SCRAPING_LIBRARY_PROFILES[profile];
  if (!groups) throw new Error(`Unknown scraping library profile: ${profile}. Use one of: ${Object.keys(SCRAPING_LIBRARY_PROFILES).join(', ')}, list`);
  return unique(groups.flatMap(group => SCRAPING_LIBRARY_GROUPS[group]?.deps || []));
}

function scrapingInstallCommand(packages, packageManager = 'npm') {
  const list = packages.join(' ');
  if (!list) return '';
  if (packageManager === 'pnpm') return `pnpm add ${list}`;
  if (packageManager === 'yarn') return `yarn add ${list}`;
  if (packageManager === 'bun') return `bun add ${list}`;
  return `npm install ${list}`;
}

function printScrapingLibraryList() {
  console.log('Scraping library groups:');
  for (const [name, group] of Object.entries(SCRAPING_LIBRARY_GROUPS)) {
    console.log(`\n[${name}] ${group.description}`);
    console.log(group.deps.join(' '));
  }
  console.log('\nProfiles:');
  for (const [name, groups] of Object.entries(SCRAPING_LIBRARY_PROFILES)) {
    console.log(`${name}: ${groups.join(', ')}`);
  }
  console.log('\nNote: browser/profile packages such as Playwright and Puppeteer require a Node.js host and cannot run inside Cloudflare Workers. Proxy packages are only for authorized networks and must not be used to bypass access controls.');
}

function maybeInstallScrapingLibraries(args) {
  if (!args.scrapingLibs) return;
  if (args.scrapingLibs === 'list') {
    printScrapingLibraryList();
    return;
  }
  const packages = scrapingLibraries(args.scrapingLibs);
  const command = scrapingInstallCommand(packages, args.packageManager);
  console.log(`Scraping profile: ${args.scrapingLibs}`);
  console.log(`Packages (${packages.length}): ${packages.join(' ')}`);
  console.log(`Install command: ${command}`);
  if (args.mode === 'plan') return;
  const out = ensureOut(args);
  writeExecutable(join(out, `install-scraping-libs-${args.scrapingLibs}.sh`), `#!/usr/bin/env bash
set -euo pipefail
cd "${args.projectDir}"
${command}
`);
  writeFileSync(join(out, `scraping-libs-${args.scrapingLibs}.json`), JSON.stringify({ profile: args.scrapingLibs, packages, command }, null, 2));
  if (!args.dryRun && args.mode !== 'plan') sh(command, args.projectDir);
}

function infer(projectDir, args) {
  const pkg = readJson(join(projectDir, 'package.json'));
  const scripts = pkg.scripts || {};
  const hasNext = Boolean(pkg.dependencies?.next || pkg.devDependencies?.next || existsSync(join(projectDir, 'next.config.js')) || existsSync(join(projectDir, 'next.config.mjs')));
  const hasWrangler = existsSync(join(projectDir, 'wrangler.toml')) || Boolean(pkg.devDependencies?.wrangler || pkg.dependencies?.wrangler);
  const hasRenderYaml = existsSync(join(projectDir, 'render.yaml'));
  const name = args.name || pkg.name || basename(projectDir);
  const build = args.build || (hasWrangler && scripts['worker:build'] ? 'npm run worker:build' : scripts.build ? 'npm run build' : scripts['render:build'] ? 'npm run render:build' : '');
  const start = args.start || (scripts.start ? 'npm start' : scripts['render:start'] ? 'npm run render:start' : hasNext ? 'npx next start' : 'node index.js');
  const test = scripts['worker:test'] ? 'npm run worker:test' : scripts.test ? 'npm test' : '';
  return { pkg, scripts, hasNext, hasWrangler, hasRenderYaml, name, build, start, test };
}

async function listFiles(root, options = {}) {
  const skip = new Set(['.git', '.wrangler', '.deploy', '.cache', '.next', 'dist', 'coverage']);
  if (!options.includeNodeModules) skip.add('node_modules');
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = join(dir, entry.name);
      const rel = full.slice(root.length + 1);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(rel);
    }
  }
  await walk(root);
  return files;
}

function octal(value, width) {
  const s = value.toString(8);
  return s.padStart(width - 1, '0') + '\0';
}

function tarHeader(name, size, mode = 0o644, mtime = Math.floor(Date.now() / 1000), type = '0') {
  const buf = Buffer.alloc(512, 0);
  const write = (value, offset, length) => buf.write(String(value).slice(0, length), offset, length, 'utf8');
  write(name, 0, 100);
  write(octal(mode, 8), 100, 8);
  write(octal(0, 8), 108, 8);
  write(octal(0, 8), 116, 8);
  write(octal(size, 12), 124, 12);
  write(octal(mtime, 12), 136, 12);
  buf.fill(0x20, 148, 156);
  write(type, 156, 1);
  write('ustar', 257, 6);
  write('00', 263, 2);
  let sum = 0;
  for (const byte of buf) sum += byte;
  write(octal(sum, 8), 148, 8);
  return buf;
}

async function createTarGz(sourceDir, files, outFile, prefix) {
  async function* chunks() {
    for (const rel of files) {
      const full = join(sourceDir, rel);
      const st = statSync(full);
      const name = `${prefix}/${rel}`.replace(/\\/g, '/');
      yield tarHeader(name, st.size, st.mode & 0o777, Math.floor(st.mtimeMs / 1000));
      const data = readFileSync(full);
      yield data;
      const pad = (512 - (st.size % 512)) % 512;
      if (pad) yield Buffer.alloc(pad, 0);
    }
    yield Buffer.alloc(1024, 0);
  }
  await pipeline(Readable.from(chunks()), createGzip(), createWriteStream(outFile));
}

function ensureOut(args) {
  const out = resolve(args.projectDir, args.out || join('.deploy', args.env));
  mkdirSync(out, { recursive: true });
  return out;
}

function writeExecutable(path, content) {
  writeFileSync(path, content, { mode: 0o755 });
}

function printPlan(args, meta) {
  console.log(JSON.stringify({
    environment: args.env,
    mode: args.mode,
    projectDir: args.projectDir,
    name: meta.name,
    detected: { next: meta.hasNext, cloudflareWorker: meta.hasWrangler, renderYaml: meta.hasRenderYaml },
    commands: { build: meta.build, start: meta.start, test: meta.test }
  }, null, 2));
}

async function termuxOffline(args, meta) {
  const out = ensureOut(args);
  const files = await listFiles(args.projectDir, { includeNodeModules: args.includeNodeModules });
  const archive = join(out, `${meta.name}-termux-offline.tar.gz`);
  await createTarGz(args.projectDir, files, archive, meta.name);
  writeExecutable(join(out, 'install-termux.sh'), `#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
APP_NAME="${meta.name}"
ARCHIVE="${meta.name}-termux-offline.tar.gz"
pkg install -y nodejs-lts tar chromium || true
mkdir -p "$HOME/apps"
tar -xzf "$ARCHIVE" -C "$HOME/apps"
cd "$HOME/apps/$APP_NAME"
if [ ! -d node_modules ]; then
  echo "node_modules is missing. For a fully offline install, create the archive with --include-node-modules after running npm ci on a compatible device."
else
  echo "Dependencies are already included."
fi
${meta.build ? `${meta.build} || true` : 'true'}
echo "Start with: cd $HOME/apps/$APP_NAME && ${meta.start}"
`);
  writeFileSync(join(out, 'README.md'), `# Termux offline bundle

Copy these files to the Android device:

- ${basename(archive)}
- install-termux.sh

Then run:

\`\`\`bash
chmod +x install-termux.sh
./install-termux.sh
\`\`\`

For true offline installation, build the archive with \`--include-node-modules\` after running \`npm ci\` on a compatible Linux/Android environment. Native packages may need to be installed on the target architecture.
`);
  console.log(`Created Termux offline bundle in ${out}`);
}

async function vscode(args, meta) {
  const vscodeDir = join(args.projectDir, '.vscode');
  mkdirSync(vscodeDir, { recursive: true });
  writeFileSync(join(vscodeDir, 'tasks.json'), JSON.stringify({
    version: '2.0.0',
    tasks: [
      meta.build && { label: 'build', type: 'shell', command: meta.build, group: 'build', problemMatcher: [] },
      meta.test && { label: 'test', type: 'shell', command: meta.test, group: 'test', problemMatcher: [] },
      { label: 'start', type: 'shell', command: meta.start, group: 'none', problemMatcher: [] },
      meta.hasWrangler && { label: 'cloudflare worker dev', type: 'shell', command: 'npm run worker:dev', problemMatcher: [] }
    ].filter(Boolean)
  }, null, 2));
  writeFileSync(join(vscodeDir, 'settings.json'), JSON.stringify({
    'typescript.tsdk': 'node_modules/typescript/lib',
    'terminal.integrated.defaultProfile.linux': 'bash',
    'files.exclude': { 'node_modules': true, '.wrangler': true, '.deploy': true }
  }, null, 2));
  writeFileSync(join(vscodeDir, 'launch.json'), JSON.stringify({
    version: '0.2.0',
    configurations: [{
      name: 'Run app',
      type: 'node',
      request: 'launch',
      runtimeExecutable: 'npm',
      runtimeArgs: ['start'],
      cwd: '${workspaceFolder}',
      console: 'integratedTerminal'
    }]
  }, null, 2));
  console.log('Generated .vscode tasks, settings, and launch configuration.');
}

async function cloudflareWorker(args, meta) {
  if (!meta.hasWrangler) console.warn('Warning: wrangler.toml or wrangler dependency was not detected.');
  if (args.mode === 'prepare') {
    const out = ensureOut(args);
    writeFileSync(join(out, 'cloudflare-worker.md'), `# Cloudflare Worker deployment

Recommended commands from the project root:

\`\`\`bash
npm ci
${args.skipTests || !meta.test ? '' : `${meta.test}\n`}${meta.build ? `${meta.build}\n` : ''}npm run worker:deploy
\`\`\`

Required secrets must be configured in Cloudflare Dashboard or with \`wrangler secret put\`.
`);
    console.log(`Wrote Cloudflare deployment notes to ${out}`);
    return;
  }
  if (args.mode === 'deploy') {
    if (!args.yes) throw new Error('Deploy mode needs --yes.');
    sh('npm ci', args.projectDir);
    if (!args.skipTests && meta.test) sh(meta.test, args.projectDir);
    sh(meta.scripts['worker:deploy'] ? 'npm run worker:deploy' : 'npx wrangler deploy', args.projectDir);
  }
}

async function vercel(args, meta) {
  const out = ensureOut(args);
  const vercelJson = join(args.projectDir, 'vercel.json');
  if (!existsSync(vercelJson)) {
    writeFileSync(vercelJson, JSON.stringify({
      version: 2,
      buildCommand: meta.build || undefined,
      outputDirectory: meta.hasNext ? '.next' : undefined,
      framework: meta.hasNext ? 'nextjs' : undefined
    }, null, 2));
  }
  writeFileSync(join(out, 'vercel.md'), `# Vercel deployment

Commands:

\`\`\`bash
npm ci
${meta.build ? `${meta.build}\n` : ''}npx vercel deploy --prod
\`\`\`

If this is a Cloudflare Worker-only project, Vercel can host documentation or a Next.js frontend, but it cannot run Cloudflare bindings such as D1/Queues directly.
`);
  if (args.mode === 'deploy') {
    if (!args.yes) throw new Error('Deploy mode needs --yes.');
    sh('npm ci', args.projectDir);
    if (!args.skipTests && meta.test) sh(meta.test, args.projectDir);
    if (meta.build) sh(meta.build, args.projectDir);
    sh(commandExists('vercel') ? 'vercel deploy --prod' : 'npx vercel deploy --prod', args.projectDir);
  } else console.log(`Prepared Vercel files and notes in ${out}`);
}

async function render(args, meta) {
  const out = ensureOut(args);
  const renderYaml = `services:
  - type: web
    name: ${meta.name}
    env: node
    plan: free
    buildCommand: npm ci${meta.build ? ` && ${meta.build}` : ''}
    startCommand: ${meta.start}
    autoDeploy: true
    envVars:
      - key: NODE_VERSION
        value: ${meta.pkg.engines?.node || '20'}
      - key: PORT
        value: ${args.port}
`;
  if (!existsSync(join(args.projectDir, 'render.yaml'))) writeFileSync(join(args.projectDir, 'render.yaml'), renderYaml);
  writeFileSync(join(out, 'render.md'), `# Render deployment

Use this repository in Render and set:

- Build command: \`npm ci${meta.build ? ` && ${meta.build}` : ''}\`
- Start command: \`${meta.start}\`
- Port: \`${args.port}\`

A \`render.yaml\` file has been generated if the project did not already have one.
`);
  if (args.mode === 'deploy') console.log('Render has no official universal CLI deployment flow here. Connect the repository in Render Dashboard or use the generated render.yaml blueprint.');
  else console.log(`Prepared Render files and notes in ${out}`);
}

async function vps(args, meta) {
  const out = ensureOut(args);
  const releaseDir = `/opt/${meta.name}`;
  const service = `[Unit]
Description=${meta.name}
After=network.target

[Service]
Type=simple
WorkingDirectory=${releaseDir}/current
Environment=NODE_ENV=production
Environment=PORT=${args.port}
ExecStart=/usr/bin/env ${meta.start}
Restart=always
RestartSec=5
User=www-data
Group=www-data

[Install]
WantedBy=multi-user.target
`;
  const nginx = `server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:${args.port};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
  writeFileSync(join(out, `${meta.name}.service`), service);
  writeFileSync(join(out, `${meta.name}.nginx.conf`), nginx);
  writeExecutable(join(out, 'install-vps.sh'), `#!/usr/bin/env bash
set -euo pipefail
APP_NAME="${meta.name}"
RELEASE_DIR="${releaseDir}"
ARCHIVE="${meta.name}-vps.tar.gz"
sudo apt-get update
sudo apt-get install -y nodejs npm nginx tar
sudo mkdir -p "$RELEASE_DIR/releases"
sudo tar -xzf "$ARCHIVE" -C "$RELEASE_DIR/releases"
NEW_RELEASE=$(find "$RELEASE_DIR/releases" -maxdepth 1 -type d -name "$APP_NAME-*" | sort | tail -1)
sudo ln -sfn "$NEW_RELEASE" "$RELEASE_DIR/current"
cd "$RELEASE_DIR/current"
sudo npm ci --omit=dev || npm ci --omit=dev
${meta.build ? `sudo ${meta.build} || ${meta.build}\n` : ''}sudo cp "${meta.name}.service" /etc/systemd/system/ || true
sudo systemctl daemon-reload
sudo systemctl enable --now "$APP_NAME"
echo "Install the Nginx sample if needed: ${meta.name}.nginx.conf"
`);
  const files = await listFiles(args.projectDir, { includeNodeModules: args.includeNodeModules });
  const temp = join(out, `${meta.name}-${Date.now()}`);
  await rm(temp, { recursive: true, force: true });
  mkdirSync(temp, { recursive: true });
  for (const file of files) {
    const target = join(temp, file);
    mkdirSync(dirname(target), { recursive: true });
    await cp(join(args.projectDir, file), target);
  }
  writeFileSync(join(temp, `${meta.name}.service`), service);
  const archive = join(out, `${meta.name}-vps.tar.gz`);
  await createTarGz(temp, await listFiles(temp, { includeNodeModules: true }), archive, `${meta.name}-${Date.now()}`);
  await rm(temp, { recursive: true, force: true });
  writeFileSync(join(out, 'README.md'), `# VPS deployment bundle

Upload these files to the server:

- ${basename(archive)}
- install-vps.sh
- ${meta.name}.service
- ${meta.name}.nginx.conf

Then run:

\`\`\`bash
chmod +x install-vps.sh
./install-vps.sh
\`\`\`

Review the systemd and Nginx files before enabling them in production.
`);
  console.log(`Created VPS deployment bundle in ${out}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  if (!args.env || !ENVIRONMENTS.has(args.env)) throw new Error(`Choose --env: ${[...ENVIRONMENTS].join(', ')}`);
  if (args.scrapingLibs === 'list') { printScrapingLibraryList(); return; }
  if (!['plan', 'prepare', 'deploy'].includes(args.mode)) throw new Error('--mode must be plan, prepare, or deploy');
  args.projectDir = resolve(args.projectDir);
  const meta = infer(args.projectDir, args);
  maybeInstallScrapingLibraries(args);
  if (args.mode === 'plan') { printPlan(args, meta); return; }
  if (args.env === 'termux-offline') await termuxOffline(args, meta);
  else if (args.env === 'vscode') await vscode(args, meta);
  else if (args.env === 'cloudflare-worker') await cloudflareWorker(args, meta);
  else if (args.env === 'vercel') await vercel(args, meta);
  else if (args.env === 'render') await render(args, meta);
  else if (args.env === 'vps') await vps(args, meta);
}

main().catch(error => {
  console.error(`Error: ${error.message}`);
  console.error('\n' + usage());
  process.exit(1);
});
