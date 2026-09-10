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
