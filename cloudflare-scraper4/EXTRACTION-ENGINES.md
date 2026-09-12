# Extraction engines

Scraper 4 profiles can select an extraction engine from the profile form.

## Cloudflare Worker compatible engines

These engines run inside Cloudflare Workers and the single-file `scraper4.ts` build:

- `auto` — tries JSON-LD, Next.js data, inline script JSON, heuristic cards, metadata, then selector fallback.
- `cheerio` — extraction driven purely by your CSS selectors. On the Node/Render/VPS/Termux runtime it uses the
  `cheerio` package; the Cloudflare Worker has no such package, so there the same choice runs the equivalent
  `HTMLRewriter` selector parser. Either way, picking `cheerio` means "use my selectors, do not guess".
- `htmlrewriter` — Cloudflare `HTMLRewriter` with CSS selectors.
- `jsonld` — Schema.org/Product JSON-LD.
- `next_data` — Next.js `__NEXT_DATA__` hydration JSON.
- `metadata` — OpenGraph/Twitter/meta tags.
- `script_json` — product-like JSON blobs inside inline scripts.
- `heuristic` — product-like anchors/cards without stable CSS classes.

## Node-only engine

- `structural` — the cheerio twin of `scripts/py-auto-extract.py` (the deployer's Python tab): the same DOM
  algorithm, so the Node runtime extracts ordinary shops with no manual selectors. Known card containers first
  (WooCommerce `li.product`), then an outer-container repair, then a product-link climb for unknown class names,
  then embedded JSON catalogs. Acceptance matches Python too: a card is kept when it has a title OR a link, so a
  missing price or image never discards it — unlike `heuristic`, which needs title+image+parseable price together.

`structural` runs only where the `cheerio` package exists (Termux, desktop, VPS, Render). In the Node `auto` chain
it sits right after the `htmlrewriter` selector engine: the auto chain must mirror the Worker chain first (pinned by
the auto-order test), and the Worker cannot run cheerio at all. On the Worker an explicit `structural` choice fails
with the same loud Node-runtime error as the browser engines, and the Worker benchmark marks it unavailable instead
of probing it. It is benchmarked on Node and offered in both profile dropdowns.

Two intentional divergences from the Python source, both pinned by `worker-tests/structural.test.mjs`: struck-through
old prices (`<del>`/`<s>`) are stripped before parsing, so WooCommerce `<del>`/`<ins>` sales keep the sale price that
Python misreads; and URLs keep Node's percent-encoding while Python keeps raw UTF-8 paths.

## Browser engines and the second layer

The browser engines (`playwright`, `puppeteer`, `crawlee_playwright`) exist for JavaScript-only shops such as
Snappshop, where the list HTML only appears after rendering. Each driver renders the page, runs the configured
selectors on the rendered DOM (layer 1), and — when that finds nothing — re-reads the SAME rendered HTML
selector-free through `rescueRenderedProducts`: `structural` first, `heuristic` as the final net. So a Snappshop
category page needs no manual selectors: the browser renders the `snp-` cards and the second layer reads them.

The winning layer is reported two ways: a `[scraper4] <driver> extraction layer: <layer> (<n> products, <url>)` line
in the log (visible in the deployer Logs tab on Termux), and the `browserLayer` field on the scrape result
(`selectors` | `structural` | `heuristic` | `none`). Pinned by `worker-tests/browser-layer.test.mjs` against the pure
rescue function — no browser exists in CI, so the live Snappshop proof is a device run with Termux Chromium.

## `network_api`: products from the page's own API traffic

`network_api` is a fourth browser engine (Node-only, last in the `auto` chain and the benchmark). Instead of reading
the DOM, it opens the page in Playwright with a `response` listener — a programmed DevTools Network tab — and keeps
every JSON-shaped XHR/fetch body (50 responses, 2MB per body, 8MB total, plus a settle window for in-flight calls).
Each body is walked for product-like objects with the same walker the `script_json`/`next_data` engines use, so API
envelopes, `offers`/`finalPrice`/`salePrice` price shapes, and relative/slug links all read the same way. Captured
endpoint URLs are printed to the log (`[scraper4] network_api endpoints ...`), which doubles as an API-discovery
tool for shops like Snappshop. The Worker refuses it loudly like the other browser engines. Pure parsing lives in
`networkApiProducts` and is pinned by `worker-tests/network-api.test.mjs` against a Snappshop-shaped fixture.

## Benchmark and the saved engine

The 3-page speed test (profile → speed test) runs the engines above and saves the winner to the profile's
`extractionEngine`. Every engine it can pick is also offered in the profile dropdown and accepted by both runtimes,
so a benchmarked result is never silently rewritten back to `auto` when the profile is saved.

The dropdown exists in more than one place (profile settings and the start page). Since 1.95.0 they are kept
identical and a test compares them against each other: in 1.94.0 only the settings dropdown offered `cheerio`,
so opening a profile from the start page still reset a saved `cheerio` engine to `auto`.

## An explicitly chosen engine now really runs first (1.99.0)

Until 1.99.0 `engineOrder()` put the automatic discovery engines (`jsonld`, `next_data`, `script_json`,
`heuristic`, `metadata`) *before* an engine the user had explicitly chosen. Any shop page carrying an inline
JSON blob — analytics config, a decoy `ld+json` product, a `dataLayer` push — therefore let a discovery engine
win first, and a profile set to `cheerio` silently extracted with `heuristic`.

It was only visible as a *slight* wrongness because the 3-page speed test calls the scraper with
`autoFirst=false` (single-engine probe) while a real scrape uses the default `autoFirst=true`. The benchmark
honoured the chosen engine, the real run did not, and the two disagreed on `usedEngine`.

Two fixes, in both runtimes:

1. An explicit choice is placed **first** in the order; the remaining engines stay only as fallbacks.
2. The early `return` that stopped the loop as soon as the chosen engine had run was removed. It made an
   explicit engine that found nothing return 0 products instead of falling through, so the fallback chain now
   also includes the selector engine (`htmlrewriter` / `cheerio`) — a page only the configured selectors can
   read no longer ends up empty. The heavy browser engines stay opt-in and are never auto-started.

`auto` behaves exactly as before.

## When a profile extracts 0 products

Two causes were fixed in 1.95.0, both invisible to the diagnostic tools (the diagnostic and the 3-page test
bypass the job processor and ignore the profile's page count):

- **Pages = 0.** Zero means "automatic". The Worker scanned up to 100 pages, but the Node runtime ran zero
  iterations and finished with `0 of 0`. Both runtimes now use the same limit.
- **A link selector that points at the image.** Visual selection often lands on the card's `<img>`. The product
  URL then came back empty and every product was discarded, which is why the report said
  "no product with a link was found" while the diagnostic had just listed 20 products. The link is now taken
  from the element itself, its parent, or the nearest `a[href]` inside the card, on every extraction path.

## Node.js-only browser engines

These require the Node/Render/VPS runtime because Cloudflare Workers cannot launch Chromium:

- `playwright` — renders the page with Playwright Chromium, then extracts cards with selectors and heuristic fallback.
- `puppeteer` — renders the page with Puppeteer, then extracts cards with selectors and heuristic fallback.
- `crawlee_playwright` — uses Crawlee `PlaywrightCrawler` for browser-based crawling and extraction.

Install browser binaries where needed:

```bash
npx playwright install chromium
npx puppeteer browsers install chrome
```

For Codespaces/VPS Linux, browser packages may require additional system dependencies. Use browser engines only for sites you are authorized to access and do not use them to bypass access controls.

## Proactive auto-discovery when selectors were never configured (1.128.0, all runtimes since 1.129.0)

Until 1.128.0 the engines only repaired selectors as a *last resort* (see below):
a run that extracted zero products retried once with suggested selectors. That
still left a gap for every fresh profile, because "not configured" never looked
empty — `normalizeProfile()` fills new profiles with WooCommerce
`DEFAULT_SELECTORS` and rejects empty list selectors. The engines ran blind
(discovery engines guessing cards while the selector engines matched nothing),
and any shop the discovery engines could not read ended with 0 products.

Since 1.128.0 the Render/Node engines repair **unconfigured** selectors
themselves, *before* the engine loop, reusing the already-fetched page HTML (no
extra fetch):

- **Trigger.** `listSelectorsStatus()` classifies the profile's list selectors
  as `empty` (none set), `partial` (some set), `default` (all five still the
  WooCommerce defaults) or `custom`. Anything but `custom` is repaired when the
  current selectors do not verify against the real page. Fully custom selectors
  keep the exact old behavior — their breakage is still covered by the
  last-resort rescue in `processor.ts`.
- **Pass 1 — curated candidates.** The known e-commerce selector list (now
  extended with generic grid selectors) is tested first: fast and precise on
  known platforms.
- **Pass 2 — structural inference** (`inferStructuralListSelectors`). For
  unknown markup (Tailwind/React shops with arbitrary classes) every link+image
  subtree is clustered by its tag+class signature, the largest repeating
  cluster is treated as the product grid, and title/price/link/image selectors
  are derived from inside the cards. Unlike the `heuristic` engine — which
  extracts products directly — this produces reusable CSS selectors, so the
  selector engines (and every later page and run) work with them.
- **Verification gate.** Proposals are checked with `verifyListSelectors()`
  (container repeats ≥2, titles resolve *inside* most cards) before adoption.
  A page with no product pattern yields `method: 'none'` and nothing is saved.
- **Persistence.** `scrapeListWithMeta()` reports `discoveredSelectors` /
  `discoveryMethod`; the job processor, the inline API (`runProfileApi`) and
  the 3-page benchmark persist them to the profile once, so later pages reuse
  the selector engine instead of re-discovering. The extraction diagnostic
  shows the proposals read-only when a run finds nothing.
- **Opt-out.** Pass `autoDiscover=false` to `scrapeListWithMeta()` /
  `scrapeList()` (Render/Node) or `scrapeListPage()` / `scrapeList()` (Worker)
  for the exact pre-1.128.0 behavior.

### Worker parity (1.129.0)

1.128.0 shipped this on Render/Node only; the Cloudflare Worker kept the
last-resort rescue. Since 1.129.0 the Worker runs the same discovery with the
same gates and method names (`curated` / `structural` / `mixed` / `none`),
adapted to its primitives:

- **Verification** (`verifyListSelectors`) counts matches with HTMLRewriter —
  the container page-wide, title/price/link/image scoped to *descendants* of
  the container — instead of cheerio card sampling. The gate is the same:
  container repeats ≥2 and titles resolve inside most cards.
- **Structural inference** (`inferStructuralListSelectors`) clusters
  anchor-context HTML chunks (the link itself plus up to two enclosing
  elements) by tag+class signature and derives title/price by per-card vote,
  with the same leaf-preference rule for prices as Render/Node.
- **Wiring.** `scrapeListPage()` repairs before the engine loop and reports
  `discoveredSelectors` / `discoveryMethod`; the job processor, the inline API
  and the 3-page benchmark persist them once; the diagnostic shows them
  read-only. Fully custom selectors are never touched at the engine layer —
  their breakage is still covered by the last-resort rescue.

Known limitation (both runtimes): the curated pass trusts its platform
patterns, so a profile pointed at a non-shop page whose markup happens to
match a generic container (e.g. bare `article` cards with headings) can adopt
selectors for it. The structural pass requires link+image+price signals and
does not have this hole.

## Last-resort selector rediscovery (1.97.0)

Engine selection answers "how do we parse this page". It does not help when the
answer is "nothing matched". Since 1.97.0 a run that extracts zero products does
not fail immediately: the scraper re-runs the same curated discovery the
"auto-suggest selectors" button uses, merges any non-empty proposals into the
profile, and retries the page once. The detail stage does the same when the
configured detail selectors populate no field on a real product.

Note that this is a different algorithm from the `heuristic` engine. The
heuristic engine infers cards from price-shaped text in the markup; the
suggestion pass tests a curated list of well-known e-commerce selectors
(`li.product`, `.woocommerce-loop-product__title`, `.product-card`, …). A
catalogue whose cards carry no price text defeats the former but not the latter,
which is precisely the case this rescue recovers.

Each rescue happens at most once per job, so a genuinely broken source still
fails fast instead of looping.
