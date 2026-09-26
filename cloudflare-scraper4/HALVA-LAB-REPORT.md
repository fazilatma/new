# Halva shop laboratory — 1.228.0+

## Result and limits

A synthetic three-page halva store was built and tested against this checkout.
The Node web application was rebuilt and started with a fresh, isolated SQLite
lab database. This is **not** a test of the user's VPS installation.

| Check | Result |
|---|---|
| Fresh Node app, SQLite initialization, health/version/status APIs | PASS — HTTP 200, database ready, version 1.228.0+ |
| Dashboard HTML and dashboard JavaScript | PASS — HTTP 200; visual interactions not browser-tested |
| Sample shop HTTP pages | PASS — 3 pages, 12 cards each |
| Worker parser + Node/Cheerio parser | PASS — 36 unique products each; exact prices, titles, links, images |
| Next-link pagination | PASS — 3 fixture documents parsed, 2 verified new-product transitions per twin |
| Query-page and full-URL-pattern pagination | PASS — same counts, distinct URLs and new products |
| Repeated-content negative control | PASS — refused to claim successful three-page navigation |
| Selector verification and engine diagnosis | PASS on all three fixtures for both twins |
| Dedicated halva tests | 10 passed, 0 failed |
| Service/build/version lab | 34/34 passed |
| Full repository gate | 1,180 tests: 1,174 passed, 0 failed, 6 skipped |
| Actual Chromium installation/execution | BLOCKED — download TLS connection reset; no runnable browser installed |
| User's VPS, real target sites, browser hydration/scrolling | NOT VERIFIED |

The Chromium 1243 download from cdn.playwright.dev failed with ECONNRESET before
TLS was established. A request to the running application's persistent browser
endpoint was accepted (HTTP 202) but launch failed because the executable was
missing. This is recorded as blocked, **not** a successful browser test.
The extraction tests use actual application parser/pagination functions with
fixture transport. Cloudflare HTMLRewriter is emulated using the established
Cheerio lab adapter. They are not end-to-end Chromium navigation tests and do
not weaken the production SSRF protections to access localhost.

## Feedback from the tests

- Static list extraction returned complete data; no extraction algorithm patch
  was justified by these fixtures.
- Three-page success required new products on both transitions, not merely
  three requests. The negative control correctly rejected repeated content.
- A healthy dashboard and installed JS modules do not establish browser readiness.
  The missing browser binary remains an environmental blocker in this lab.
- The deliverable is a validated source release, not a self-contained browser
  distribution and not a promise that every installation/website works.

## Root checkbox: what it actually does

The checkbox is an acknowledgement, not sudo or a privilege switch. The OS
account running the service determines whether it is root.

- Normal extraction, the three-page benchmark and extraction diagnostics:
  **no root checkbox required**. They use the service account and shared sandbox
  configuration independently of this checkbox.
- Persistent browser runtime test, browser install/repair and cache reuse:
  **acknowledgement required when the service UID is 0**.
- Copying a read-only diagnostic report: no root acknowledgement required.
- A non-root service does not need this acknowledgement. Prefer non-root where
  practical; no-sandbox root operation is a compatibility tradeoff.

The user's report has UID 0, so the dedicated runtime/repair operations require
acknowledgement on that VPS. This lab runs under a different account.

## Reproduce

From `cloudflare-scraper4` after installing required npm dependencies:

```sh
node --test worker-tests/halva-shop-lab.test.mjs
node scripts/lab-probe.mjs --file worker-tests/fixtures/halva-shop/page-1.html --base https://halva.example/page-1.html --selectors '{"container":"li.product","title":".product-title","price":".price","link":"a.product-link","image":"img"}'
node scripts/lab-service.mjs
npm test
```

For a browser preview of the synthetic shop only:

```sh
python3 -m http.server 8090 --bind 0.0.0.0 --directory worker-tests/fixtures/halva-shop
```

Open `/page-1.html`. The product links are extraction fixtures, not functioning
checkout/detail pages. There are no payment or delivery integrations.

For a fresh application installation, use Node compatible with the pinned SDKs
(current Puppeteer requires Node >=22.12), run `npm ci`, then `npm run render:build`
and `npm run render:start`. Browser setup is background work; check
`npm run browsers:install -- --status` and the runtime test before using browser
engines. `--ignore-scripts` installations must explicitly run browser setup.

The source archive excludes node_modules, databases, secrets and browser caches.
It includes package-lock.json, fixtures, regression tests and the committed Worker
bundle. See BROWSER-PATHS.md and BROWSER-BACKGROUND-INSTALL.md for deployment limits.
