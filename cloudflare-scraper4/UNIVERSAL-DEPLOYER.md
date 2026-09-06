# Universal deployer

This project includes a simple JavaScript deployer that can prepare or deploy this project, or another Node.js/Next.js/Cloudflare Worker project, to six different environments.

```bash
npm run deploy:universal -- --env <environment> [options]
```

Supported environments:

1. `termux-offline` — creates an offline archive and installer for Termux on Android.
2. `vscode` — creates `.vscode` tasks, launch config, and settings for mobile or desktop VS Code.
3. `cloudflare-worker` — prepares notes or runs Wrangler deployment.
4. `vercel` — creates a `vercel.json` when missing and can call Vercel CLI.
5. `render` — creates a `render.yaml` blueprint when missing.
6. `vps` — creates a tarball, systemd service, Nginx sample, and installer script.

## Safety and access policy

The deployer is for legitimate deployment and migration. It does not include anti-bot bypass, credential theft, CAPTCHA solving, or WAF evasion. If a destination website blocks datacenter, VPN, or proxy traffic, use an authorized network or an official API instead of trying to bypass the block.

## Common options

```text
--project-dir <dir>       Project directory. Default: current directory.
--env <name>              Target environment.
--mode <plan|prepare|deploy>
--out <dir>               Artifact output directory. Default: .deploy/<env>.
--name <name>             Service/app name override.
--start <command>         Start command override.
--build <command>         Build command override.
--port <port>             Runtime port for VPS/Render examples. Default: 3000.
--include-node-modules    Include node_modules in offline/VPS archives.
--skip-tests              Skip tests in deploy mode.
--yes                     Required for actual deploy commands.
```

## Examples

### 1. Termux mobile, offline

```bash
npm ci
npm run deploy:universal -- --env termux-offline --include-node-modules
```

Copy `.deploy/termux-offline/*` to the Android device, then run:

```bash
chmod +x install-termux.sh
./install-termux.sh
```

For a truly offline installation, `node_modules` must already be present and compatible with the target architecture. Native modules may need to be installed or rebuilt on the Android device.

### 2. VS Code for mobile or desktop

```bash
npm run deploy:universal -- --env vscode
```

This writes:

```text
.vscode/tasks.json
.vscode/settings.json
.vscode/launch.json
```

### 3. Cloudflare Worker

Prepare notes only:

```bash
npm run deploy:universal -- --env cloudflare-worker
```

Deploy with Wrangler:

```bash
npm run deploy:universal -- --env cloudflare-worker --mode deploy --yes
```

Secrets such as `VAULT_SECRET` must be set in Cloudflare Dashboard or with `wrangler secret put`. Cloudflare Workers cannot run Playwright/Puppeteer directly.

### 4. Vercel

```bash
npm run deploy:universal -- --env vercel
```

For an actual Vercel deploy:

```bash
npm run deploy:universal -- --env vercel --mode deploy --yes
```

Vercel is suitable for Next.js frontends and Node serverless functions. It cannot directly provide Cloudflare-specific bindings such as D1 and Queues.

### 5. Render

```bash
npm run deploy:universal -- --env render --port 3000
```

This creates `render.yaml` if it does not already exist. Connect the repository in Render Dashboard and use the generated blueprint.

### 6. VPS server

```bash
npm run deploy:universal -- --env vps --name scraper4-cloudflare --port 3000
```

Upload the generated files from `.deploy/vps/` to the server and run:

```bash
chmod +x install-vps.sh
./install-vps.sh
```

Review the generated systemd and Nginx samples before production use.

## Deploying another project

Use `--project-dir`:

```bash
node scripts/universal-deployer.mjs --project-dir ../some-next-app --env vercel
node scripts/universal-deployer.mjs --project-dir ../some-node-app --env vps --start "npm start"
```
