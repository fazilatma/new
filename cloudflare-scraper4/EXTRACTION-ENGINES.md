# Extraction engines

Scraper 4 profiles can select an extraction engine from the profile form.

## Cloudflare Worker compatible engines

These engines run inside Cloudflare Workers and the single-file `scraper4.ts` build:

- `auto` — tries JSON-LD, Next.js data, inline script JSON, heuristic cards, metadata, then selector fallback.
- `htmlrewriter` — Cloudflare `HTMLRewriter` with CSS selectors.
- `jsonld` — Schema.org/Product JSON-LD.
- `next_data` — Next.js `__NEXT_DATA__` hydration JSON.
- `metadata` — OpenGraph/Twitter/meta tags.
- `script_json` — product-like JSON blobs inside inline scripts.
- `heuristic` — product-like anchors/cards without stable CSS classes.

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
