# Local Deployer UI

The project includes an advanced local web UI for VS Code and GitHub Codespaces.

It can:

- show project status;
- generate universal deployment plans;
- prepare deployment helper files;
- show curated scraping-library install commands;
- run local project commands such as `npm ci`, tests, and Worker build;
- start and stop the local Cloudflare Worker scraper through `npm run worker:dev`;
- stream command logs in the browser.

## Start in VS Code

```bash
cd cloudflare-scraper4
npm ci
npm run deployer:ui
```

The terminal prints a URL like:

```text
http://localhost:8790/?token=<random-token>
```

Open that URL in your browser.

## Start in GitHub Codespaces

```bash
cd /workspaces/new/cloudflare-scraper4
npm ci
npm run deployer:ui
```

Then:

1. open the **Ports** tab;
2. find port `8790`;
3. click **Open in Browser**;
4. keep the `?token=...` value in the URL printed by the terminal.

The token protects the local UI if the forwarded port becomes reachable by someone else.

## Run the scraper locally from the UI

Open the **Local scraper** tab and click:

```text
Start local scraper
```

This runs:

```bash
npm run worker:dev
```

Wrangler starts the Cloudflare Worker locally, normally on:

```text
http://localhost:8787
```

In Codespaces, open forwarded port `8787` to see the scraper dashboard.

Useful local URLs:

```text
http://localhost:8787/
http://localhost:8787/health
http://localhost:8787/api/version
http://localhost:8787/api/debug
```

## Custom port or fixed token

```bash
DEPLOYER_UI_PORT=8790 DEPLOYER_UI_TOKEN=my-local-token npm run deployer:ui
```

## Security note

This UI is intended for local development. It is token-protected, but you should still avoid exposing the forwarded port publicly. It does not store Cloudflare, GitHub, Vercel, or Render credentials.
