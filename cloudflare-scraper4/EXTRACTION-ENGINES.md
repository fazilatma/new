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

## Benchmark and the saved engine

The 3-page speed test (profile → speed test) runs the engines above and saves the winner to the profile's
`extractionEngine`. Every engine it can pick is also offered in the profile dropdown and accepted by both runtimes,
so a benchmarked result is never silently rewritten back to `auto` when the profile is saved.

The dropdown exists in more than one place (profile settings and the start page). Since 1.95.0 they are kept
identical and a test compares them against each other: in 1.94.0 only the settings dropdown offered `cheerio`,
so opening a profile from the start page still reset a saved `cheerio` engine to `auto`.

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
