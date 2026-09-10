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

## Scraping library installer

The deployer can now install curated scraping-library profiles into this project or any other target project.

List all groups and profiles:

```bash
npm run deploy:universal -- --env vscode --scraping-libs list
```

Generate scripts only, without installing:

```bash
npm run deploy:universal -- --env vscode --scraping-libs node --dry-run
```

Install the Node scraping profile:

```bash
npm run deploy:universal -- --env vscode --scraping-libs node
```

Install the browser-rendering profile:

```bash
npm run deploy:universal -- --env vscode --scraping-libs browser
```

Install the full curated set:

```bash
npm run deploy:universal -- --env vscode --scraping-libs full
```

Profiles:

- `minimal`: small HTML/DOM parsing helpers.
- `edge`: Cloudflare-friendly parsing, JSONPath, structured-data, and Persian normalization helpers.
- `node`: general Node.js scraping stack with HTTP, DOM, metadata, XML, CSV, Excel, queues, and rate limiting.
- `browser`: Node scraping plus Playwright/Puppeteer rendering.
- `full`: all curated groups, including media/document helpers and proxy-agent plumbing for authorized networks.

Do not install the `browser` or `full` profile into a Cloudflare Worker-only runtime unless you understand the bundle/runtime impact. Playwright and Puppeteer must run on Node.js hosts such as VPS, Render, local Termux, or external browser-rendering services.

## Offline HTML deployer

A no-server HTML helper is available here:

```text
deploy-setup/static-universal-deployer.html
```

Open it directly in a browser. It can generate commands, shell scripts, and deployment notes without running a server.

Important browser limitation: static HTML cannot directly install a project or write into arbitrary local folders, because browsers are sandboxed. It generates scripts for you to download and run in a terminal.

## What's new in 1.96.0

- **The sync preview is now a colour-coded matrix instead of a JSON dump.** Every row is a product, every column a destination (WooCommerce and each Basalam stall), and the colour of each cell says whether that product is in sync *at that destination*: green = in sync, amber = price differs (shown as current → correct), blue = missing at the destination, red = exists only at the destination, violet = no source price to compare, grey = not sent there. Colour is never the only signal — each cell also carries a glyph (✓ ≠ + ! ?) and a Persian label, with the full comparison on hover. The product column stays fixed while scrolling sideways, the worst rows sort to the top, and a legend sits above the table. A preview still writes nothing; after "Run and sync" the same table is redrawn from the real post-sync state.

## What's new in 1.95.0

- **The deployer now really presses "Update from GitHub" for you.** The 1-minute branch scan already auto-installed a newer version, but two things stopped it in practice: pressing **Scan now** refreshed the table without ever installing, and any tracked build output left on disk (`scraper4.worker.js`, `scraper4.ts`, `package-lock.json`) counted as "uncommitted user work", which paused every future automatic update on that device. Generated files are now restored automatically; a real source edit still pauses the update exactly as before.
- **`cheerio` is in every engine dropdown.** 1.94.0 fixed only the settings dropdown, so the start-page dropdown still reset a saved `cheerio` profile to `auto`. A test now compares all engine dropdowns against each other.
- **Profiles that extracted 0 products now work.** Two independent causes: a profile with pages = 0 (auto) scanned nothing on the Node runtime (the Worker scanned up to 100), and a link selector pointing at the product image produced empty URLs, so every product was discarded -- the exact reason diagnostics found 20 products while the run saved none.
- **The reconciliation table works off Cloudflare.** On Termux/VPS/Render it failed with `D1 binding DB is not configured` because the shared code reached into the Worker's D1 layer. Each runtime now reads from its own database.
- **New unified reconciliation.** One advanced table compares every profile against WooCommerce and each Basalam stall at once, on price (after that destination's own percentage adjustment and Rial conversion) and on presence/absence. **Preview** lists the actions, **Run and sync** applies them. Products that exist only at the destination are reported, never auto-deleted.

## What's new in 1.94.0

- **`cheerio` is selectable again.** The 3-page speed test benchmarks it and saves the winner to the profile, but the dropdown had no such option, so the saved engine was silently reset to `auto` on the next save. It is now offered and accepted by both runtimes.
- **"Manual sync" on the start page.** One click runs list extraction, then detail extraction when configured, then delivery to WooCommerce and every active Basalam stall. With no destination enabled it still only extracts.
- **AI "description generator".** On by default. It uses the pinned master model to fill ONLY the empty fields of a product (short description, long description, variations). Text really scraped from the source is never overwritten, and images are never invented -- the gallery is only filled from real images on the page. An AI failure can never fail the scrape.
- Optional `AI_DESCRIPTION_CONCURRENCY` (default 2) controls how many products the generator handles in parallel.
