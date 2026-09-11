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

## 1.104.0 — Basalam `401 invalid authorization header` fixed

- **Fixed the `HTTP 401: invalid authorization header` that blocked Basalam sending.**
  Copying the token the way the documentation prints it — `Bearer eyJ...` — stored the whole string,
  so the request went out as `Authorization: Bearer Bearer eyJ...` with the scheme twice, which
  Basalam rejects. Tokens are now cleaned both when saved and when loaded:
  - a pasted `Bearer` / `Token` / `Authorization:` prefix is removed,
  - surrounding quotes and leading/trailing spaces are dropped,
  - invisible characters (ZWNJ, RTL/LTR marks, non-breaking spaces, smart quotes) are stripped —
    these are not legal HTTP header bytes and made the request throw or be refused outright.
- **Tokens already stored incorrectly heal themselves on load**, so there is nothing to re-enter.
- The same cleaning applies to **extra Basalam stalls** and to the **`BASALAM_TOKEN`** environment
  variable.
- A `401` now explains what to do ("copy the token without the word Bearer…") instead of only
  echoing Basalam's message, and the token field says the same thing.

If sending still returns 401 after this, the token itself is invalid or expired — create a new
personal access token in the Basalam developer panel with the required scopes.

## 1.105.0 — pinpointing the cause of a Basalam 401

- **Verified the request we send is correct.** Driving the real `safeFetch` with a stubbed
  transport shows the outgoing header is exactly `Authorization: Bearer <token>` — no duplicated
  scheme, no stray characters, correct URL. So a remaining
  `401 invalid authorization header` is the token being rejected, not the header format.
- **The token is now diagnosed locally, with no network call.** Basalam personal access tokens are
  JWTs, so the payload is decoded to report the real cause: the token is empty, still carries the
  word `Bearer`, contains a space or newline, has **expired** (the expiry date is printed), or lacks
  the **`vendor.product.write`** scope (the scopes it does have are listed).
- The verdict appears both in the send error and in the Basalam connection test, and it still works
  when Basalam itself is unreachable — previously a network failure returned a bare `fetch failed`
  with no information about the token at all.

If the verdict says the token is structurally fine but Basalam still answers 401, the token has been
revoked or belongs to a different account: create a new personal access token with the
`vendor.product.write` scope at developers.basalam.com/panel/tokens.

## 1.106.0 — cPanel shared-hosting support

- **New `CPANEL-SHARED-HOSTING.md`** — a verified walkthrough for advanced shared plans that offer
  *Setup Node.js App* (CloudLinux Node.js Selector + Phusion Passenger) and *Setup Python App*,
  including exactly which libraries can and cannot be installed there.
- **New `scripts/cpanel-app.js`** — the Passenger entry point. cPanel does not run `npm start`; it
  imports a startup file and assigns the port itself. This wrapper imports the built server (which
  already honours `process.env.PORT`) and logs startup crashes that Passenger would otherwise hide
  behind a bare 503.
- Verified on a clean install: the runtime needs only **6 pure-JS packages (56 modules, 17 MB)** and
  **no compiler** — `playwright`, `puppeteer` and `crawlee` are lazy-loaded and can be omitted
  entirely, and SQLite comes from Node's built-in `node:sqlite` (Node 22.5+), so no `better-sqlite3`
  build is needed. `pip install basalam-sdk` also works, because `pydantic-core` ships a prebuilt
  manylinux wheel.

## 1.107.0 — explaining a Basalam 401 when the token itself looks fine

- **Confirmed our request matches the official SDK exactly.** Reading `basalam-sdk` 1.2.0 shows it
  posts to the same `/v1/vendors/{vendor_id}/products`, with the same JSON body, and builds the same
  `Authorization: Bearer <token>` header. So a 401 whose local verdict says "the token is
  structurally fine" is not a header-format problem, and no purely local check can explain it.
- **The failing token is now probed against the read-only `users/me` endpoint at the moment of the
  error**, which separates the three real causes:
  - `users/me` also returns 401 → the token is revoked or invalid; create a new one.
  - `users/me` returns 200 → the token is valid but lacks **`vendor.product.write`**.
  - `users/me` returns a different vendor → the token belongs to another stall; the real and the
    configured vendor id are both shown.
  The probe is best-effort: if it fails, the original error is still reported unchanged.
- **Fixed a misleading verdict.** A JWT with no scope claim silently passed the scope check and was
  reported as "structurally fine", which dead-ended the user. It now says the scope list is absent
  from the token and what to rebuild it with.

## 1.108.0 — the Basalam indirect-connection switch now works, cPanel card, collapsible menus

- **Fixed: «اتصال غیرمستقیم» for Basalam was stored but never read.** No request looked at the flag,
  so switching it on changed nothing. The evidence that this — not the token — was the problem:
  **two different stall tokens returned 401 at the same time**, and WooCommerce simultaneously
  returned `error code: 522`. A token cannot cause a 522; the destination edge was refusing the
  traffic. Basalam rejects requests from datacenter ranges before the token is ever validated, which
  it reports as `invalid authorization header`.
  With the switch on, **every** Basalam call (`users/me`, photo upload, product create/update,
  vendor product list, status change) is routed through the configured reverse Worker in both
  runtimes, with the `Authorization` header preserved end-to-end. The source product image stays on
  the direct path, because it is fetched from the source shop and not from Basalam. Turning the
  switch on without a Worker address now reports that instead of failing silently.
- `scripts/ai-proxy-worker.js` now allows `openapi.basalam.com`, `auth.basalam.com` and
  `core.basalam.com` — otherwise the proxy itself answered 403.
- **New cPanel card in the install section** with the full step-by-step commands; its download is a
  `scraper4-install-cpanel.sh` shell script.
- **The menu no longer forces an endless scroll.** Only the newest changelog card stays open; the
  previous 14 moved into a «recent changes» fold (the older 108 keep their own fold).
- **Every environment install guide is collapsible** and closed by default; the copy and download
  buttons are unchanged.

## 1.109.0 — the reconciliation table comes back when a destination fails

- **Fixed the regression that made the full comparison table disappear.** In the reconciliation
  loop, a destination whose read threw contributed **no rows at all**. With every destination
  failing (the 401/522 case) the matrix had nothing to draw, and the 1.103.0 guard then replaced it
  with a plain error banner — so the table you used to get was gone.
  A destination that cannot be read now still produces one cell per product, in a new
  **«مقصد پاسخ نداد»** state (⛔, pink). The complete table renders again — every product row, every
  destination column — with the per-destination errors listed above it. Unreachable cells sort to
  the top so they are seen first. Fixed in both runtimes.

## 1.110.0 — Basalam sending matched to the PHP reference (scraper4.php v10.91)

The reference implementation was read from `fazilatma/code` and two decisive differences were
found. Both are now fixed:

- **A product must be created as a draft.** `bslSendProduct()` creates every product with
  `status = 3790` (UNPUBLISHED). We were creating straight into `2976` (PUBLISHED).
- **The create call must not carry photos.** The PHP payload contains no `photo`/`photos` keys at
  all: `['name','brief','description','primary_price','stock','preparation_days','weight',
  'package_weight','is_wholesale','category_id','status']` plus an optional `sku`. Photos are
  uploaded to `/files` and attached **afterwards**, together with `status = 2976`, in a separate
  `PATCH`.

Sending now performs exactly those two steps: create the draft without photos, then PATCH to
publish with the uploaded photo ids. If the second step fails the product is not lost — it already
exists and the next sync completes it.

Also confirmed from the reference: the PHP auth header is plain `Authorization: Bearer <token>`,
identical to ours, so the header format was never the problem.

## 1.111.0 — stop disguising API calls as a browser (the real cause of 401 + 522)

Diffing our HTTP layer against the PHP reference found the cause. `bslCurlOpts()` sends exactly
three headers:

```
Accept: application/json
Authorization: Bearer <token>
Content-Type: application/json
```

We were sending **five**, including a fake desktop-Chrome `user-agent` and a Persian
`accept-language`. A browser user-agent on a JSON API, with none of the other browser signals, is a
standard WAF signature. The edge rejects the request **before** the token is ever read and reports
it as `invalid authorization header` — which is why:

- the read-only `users/me` endpoint also returned 401,
- two different, valid stall tokens failed identically,
- and WooCommerce returned `error code: 522` in the very same run.

Every API call now sends only the caller's own headers, in both runtimes: Basalam (direct and
proxied) and the WooCommerce REST path. Scraping shop pages keeps the browser headers, because some
shops serve a stripped page or a challenge without them — the two paths are now separated by an
explicit, type-checked `apiMode` flag rather than one shared default.

## 1.112.0 — a Basalam doctor you can run on the machine that fails

The 401 cannot be reproduced from the build environment (it has no route to Basalam), so instead of
guessing again, `scripts/basalam-doctor.mjs` runs **on the failing machine** and reports exactly
what Basalam answers.

```bash
node scripts/basalam-doctor.mjs <token>
# or let it read the saved token from a running instance:
SCRAPER_URL=http://127.0.0.1:3000 ADMIN_TOKEN=xxx node scripts/basalam-doctor.mjs
```

It sends the same token four ways and prints the status, body and edge headers of each:

| probe | headers | what it proves |
| --- | --- | --- |
| A | Accept + Authorization + Content-Type (exactly what `scraper4.php` sends) | the token on a clean request |
| B | plus a browser `user-agent` and `accept-language` | whether a WAF is rejecting the browser disguise |
| C | Authorization only | whether any extra header matters |
| D | `vendors/{id}/products` | whether the failure is auth or scope/vendor |

If A returns 200 the token is fine and the problem is in the app; if all of A/B/C return 401 the
token itself is refused. The token is never printed — only its length, shape, expiry, scopes and a
short non-reversible fingerprint, so the output is safe to share.

## 1.113.0 — destination APIs no longer travel through the scraping proxy (the real 401)

The doctor output from the failing Termux device settled it: **all four probes returned HTTP 200** —
token valid to 2027, all 15 scopes present, `vendors/735703/products` readable — while the app still
got 401. The token was never the problem; the app was.

In the Node runtime `safeFetch()` applied `sourceNetwork` **unconditionally**. That is the
*«اتصال به سایت مبدأ»* setting for **scraping**, populated from `ai.network`. With the AI connection
method set to **Worker**, every authenticated Basalam and WooCommerce request was rewritten through
that proxy Worker — which does not forward the `Authorization` header. Basalam therefore received a
request with no token and answered `invalid authorization header`; the WooCommerce edge answered
`522` in the same run. The doctor called `fetch` directly, bypassing all of it — which is exactly
why its probes passed.

Destination APIs now pick their own route:

- **Basalam** follows its own «اتصال غیرمستقیم» switch — Worker when on, direct when off.
- **WooCommerce REST** goes direct.
- **Scraping** still uses the configured proxy, unchanged.

The Cloudflare Worker runtime has no global `sourceNetwork` and was never affected, which matches
the report that this reproduces on Termux.

## 1.114.0 — fix the 422 «شناسه تصویر الزامی است» (correcting my 1.110.0 mistake)

The 401 is gone: authentication now works. The next error was mine.

In 1.110.0 I read `bslSendProduct()` — the helper for **extra shops** — and concluded that `photo`
must not be sent on create. The **main** send path in the same PHP file does the opposite: it sends
`'photo' => $pid` and `'photos' => [...]` in the create request, and Basalam enforces it.

The real rule from `scraper4.php`:

- upload the images first;
- if an upload succeeded, send `photo` + `photos` and set status **2976** (published) when the brief
  and the description are both at least 3 characters;
- otherwise create with status **3790** (draft), so the product still lands instead of being
  rejected.

That is now implemented exactly, in both runtimes, and the redundant publish-PATCH added in 1.110.0
is gone.

**Photo upload failures are no longer silent.** They were swallowed by a bare `catch`, which is why
the 422 arrived with no explanation. A 422 that names `photo` now reports which image failed and
why — for example `آپلود تصویر ناموفق بود … علت: a.jpg: HTTP 413` — or states plainly that the
product has no image at all.
