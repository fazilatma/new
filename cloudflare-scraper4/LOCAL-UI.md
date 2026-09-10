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

## Updating without typing pull commands every time

A browser refresh only reloads the code that already exists inside the running Codespace or local folder. It does not automatically download new commits from GitHub.

To avoid typing `git pull` every time, the Local Deployer UI now includes:

```text
Dashboard → Update from GitHub
```

That button runs a safe fast-forward update from the current branch and then restarts the local UI with the same token. After it finishes, wait a few seconds and refresh the browser page.

You still need to pull once if your current Codespace does not yet have `npm run deployer:ui`. After that first update, you can use the UI button for later changes.

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

## What's new in 1.97.0

- **Auto-suggest selectors is now a last-resort rescue, not just a button.** It used to run only when an extraction engine had *already* found products, so it never helped in the one case that matters: a run that returns nothing. It now fires automatically on three triggers — the list selectors are empty, the connection succeeded but zero products were extracted, or the engine found no cards. The selectors are rediscovered and the same page is scraped again; if that works the run continues and the log records how many products were rescued.
- **The same mechanism protects the detail stage.** If the configured detail selectors populate no field on a real product (previously every product was saved with empty descriptions), the detail selectors are rediscovered and re-probed once.
- **The selector tabs act on it too.** "Test selectors" and "Test detail selectors" now run auto-suggest themselves when nothing matches, instead of only printing a recommendation.
- Each rescue runs at most once per job (on Cloudflare the flags are stored in the checkpoint), so a genuinely broken site cannot cause a loop.
- **Auto-update from GitHub really is automatic now.** The local deployer counted untracked files (`data/`, `storage/`, personal notes) as local modifications and paused with `auto-update paused: N uncommitted change(s) would be lost`, which is why you still had to press "Upgrade from GitHub" by hand. `git reset --hard` never deletes untracked files, so the check now looks only at tracked changes (`--untracked-files=no`), and a repository-root `.gitignore` keeps build and data directories out of the way entirely.
