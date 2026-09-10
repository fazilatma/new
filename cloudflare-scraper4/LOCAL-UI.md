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

## What's new in 1.98.0

- **WooCommerce now has a price adjustment percentage.** Previously only the *extra* Basalam shops had a «تغییر قیمت ٪» field; WooCommerce and the default Basalam shop were hardcoded to 0%. Both now have their own field (🛒 ووکامرس and 🏪 باسلام). The percentage is applied to every price pushed to that destination (including product variations) **and** is used as the expected price by reconciliation and the sync preview, so an intentional markup is no longer reported as a price mismatch.
- **The sync preview reports progress.** It runs inside a single HTTP request and never created a background run, so the task manager stayed empty and the button looked dead. It now shows an immediate "reading destinations…" message and registers a live row in the task manager that reports the result when it finishes.
- **An empty preview says why.** Instead of one vague sentence it now distinguishes "no destination configured", "no products extracted yet", and "everything is already in sync".
- **The changelog no longer buries the menu.** All 112 entries were rendered expanded, so reaching the lower hamburger-menu sections took a long scroll. Only the 12 most recent are shown; the rest sit in a collapsed "show older changes" block with its own scroll area.

## Version 1.100.0

- Refreshing the deployer page rescans all branches and installs the newest
  version (throttled to once per 10s), so you no longer have to wait for the
  background timer.
- Reconciliation and sync only cover products whose title ends with a
  «(کد ایکس)» code suffix, where x is any letter or digit. The «فرمت پسوند کد»
  field in the duplicate-remover menu configures the accepted formats.
- The sync preview gained a «تکراری» column: how many products share a title
  once the code suffix is ignored.
- The AI model-test results table no longer opens on every dashboard refresh.

## 1.101.0 — Basalam multi-stall sending, clickable counters, destination duplicate cleanup

- **Every Basalam stall really receives the product.** The multi-stall loop existed, but the whole
  loop sat inside one `try/catch`: if stall 2 of 3 failed, the send was abandoned and the success
  already achieved on stall 1 was never reported. Each stall is now isolated and reported on its own
  line, so one bad token or one rejected category no longer cancels the rest.
- **The official Basalam SDK is now actually used.** Basalam publishes an SDK for **Python only**
  (`pip install basalam-sdk`); no npm package exists, so the old "SDK first" branch always failed and
  silently fell back to REST. Sending now runs the real SDK through `scripts/basalam-sdk-bridge.py`
  (spawned as `python3`) and falls back to the REST API automatically when Python or the SDK is
  missing. Override the interpreter with `BASALAM_PYTHON`, and the timeout with
  `BASALAM_SDK_TIMEOUT_MS` (default 45000).
- **Counters are clickable and now carry real detail.** Clicking a job counter lists the product
  name, its price and the destination/stall; clicking the error counter shows the full error text.
  The Node runtime previously recorded no per-product detail at all, so this popup was always empty
  outside Cloudflare — both runtimes now log identically (and keep 1500 entries instead of 200).
- **Duplicate cleanup across every destination.** Reconciliation gained
  «پیش‌نمایش تکراری‌های مقصد» and «حذف تکراری‌ها در همهٔ مقصدها». Listings whose titles are identical
  once the «(کد ایکس)» suffix is stripped form a duplicate group; by default the **most expensive**
  copy is kept and the rest are removed (WooCommerce deletes, Basalam archives with status 4184,
  because its API has no permanent delete). Preview first, then confirm. Locally scraped products are
  never touched. `POST /api/maintenance/duplicates` `{confirm:'APPLY'|'', keep:'expensive'|'cheapest', accountKey?, limit}`.
- **Fixed: the duplicate grouper ignored generic code suffixes.** `dedupKey` stripped only the
  *configured* formats, so a shop full of «کیف چرم (کد 11)» / «(کد 12)» titles produced zero groups
  and every duplicate cleanup silently did nothing. It now uses the same stripper reconciliation uses.
- **Fixed: the whole server-side duplicate remover was missing from the Node runtime.** All four
  `dedup-runs` routes existed only on Cloudflare, so those buttons were dead on Termux, VPS, Render
  and Codespaces. `render-src/dedup-run.ts` implements them in-process with the same public shape.
- Termux setup now installs the SDK: `pip install basalam-sdk`.

## 1.102.0 — Basalam HTTP 400 fixed, single-column results with a product modal, Basalam settings autofill

- **Fixed the Basalam `HTTP 400` that blocked every real send.** The reported errors
  (`photo: Input should be a valid integer, unable to parse string as an integer` and
  `status: Field required`) came from three wrong fields in the product payload:
  - `photo` must be the **integer id of a file uploaded to `/v1/files`**, not an image URL.
    Images are now uploaded first (`file_type=product.photo`) and only their numeric ids are sent,
    in `photo` plus `photos[]`. Upload failures are non-fatal: the product still publishes, without
    photos, instead of losing the whole send.
  - `status` is **required**; it is now sent as `2976` (PUBLISHED).
  - the price field is **`primary_price`**, not `price`.
  Verified against the official `basalam-sdk` 1.2.0 `ProductRequestSchema`: the new payload validates
  and the old one reproduces exactly the reported error.
- **The results section is a single-column list.** Each row shows the image, the product name with
  its «(کد ایکس)» code suffix, the **base price struck through** and the **final price in Toman** for
  the default Basalam stall.
- **Clicking a product opens its modal**: image gallery, a table of the final price for **every**
  destination (WooCommerce and each Basalam stall, with the Rial equivalent), product details,
  variations and the full description.
- **Basalam settings autofill.** Entering a token and pressing Test now queries `users/me` and fills
  the vendor id and preparation days automatically; testing an extra stall fills that stall's vendor
  id and name. The Node runtime previously only called `/categories` and returned no vendor data.
- Fixed: `POST /api/profiles/:id/import` threw an unhandled `SyntaxError` in the server log when the
  body was not JSON; it now returns a 400.

## 1.103.0 — AI proxy 404 fixed, reconciliation matrix restored

- **Fixed: a proxy address without a scheme made every AI model return 404.**
  Entering `proxy.example.workers.dev` (exactly as Cloudflare shows it) produced a **relative**
  URL, so the request resolved against the scraper's own origin — e.g.
  `https://your-scraper.workers.dev/api/ai/proxy.example.workers.dev?url=...` — which does not
  exist, hence 404 for every model while direct connections kept working. Proxy addresses are now
  normalised (`https://` added when missing) in **both runtimes**, for AI, WooCommerce and scraping.
  The two address fields also accept a bare hostname now instead of being rejected by the browser.
- **New `scripts/ai-proxy-worker.js`** — a paste-and-deploy Cloudflare Worker. A correct address
  still 404s if the Worker behind it does not implement the expected contract, so this one does:
  it accepts `/?url=<encoded>`, the `x-scraper-target` / `x-target-url` headers **and** the path
  form, forwards method/body/Authorization unchanged, answers CORS preflight, exposes `/health`,
  and keeps an `ALLOWED_HOSTS` allowlist so it cannot be abused as an open relay.
- **The reconciliation preview shows the matrix table again.** Preview used a chips-only renderer
  while apply used the full matrix, so the same data looked completely different before and after
  running. Preview now renders the same table (products × destinations).
- **Fixed: "everything is in sync" was shown when every destination had failed.** Three HTTP 401s
  used to end with a green "all destinations match the source" banner. A red
  "no destination responded" banner with the error list is shown instead, and a green banner is
  never shown while any destination failed.
