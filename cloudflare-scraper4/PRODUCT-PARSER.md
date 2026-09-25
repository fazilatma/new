# Optional second-stage product parser — 1.215.0+

In Home or the profile extraction form, enable the second-stage HTML switch,
then choose a parser. Existing profiles default to **OFF**. Turning it off
retains the saved dropdown selection but resumes the original extraction,
engine fallback, selector recovery and engine-learning behavior.

Profile JSON (also preserved by profile import/export and autosave):

```json
{"productParserEnabled": true, "productParser": "jsonld"}
```

Only boolean `true` enables the feature. The available IDs are:

| ID | JavaScript implementation |
| --- | --- |
| `auto` | First nonempty result from JSON-LD, Next/Nuxt, script JSON, DOM/CSS cards, metadata, heuristic. |
| `lxml` | Compatible DOM/card adapter, **not Python lxml**. |
| `selectolax` | Compatible CSS/card adapter, **not Python selectolax**. |
| `jsonld` | Only JSON-LD product records. |
| `next_data` | JSON in Next/Nuxt data scripts and JSON-valued `window.__NUXT__`. |
| `script_json` | Embedded JSON scripts/known state assignments, including JSON-LD and Next/Nuxt. |
| `metadata` | Product metadata with title, positive price and image. |
| `heuristic` | Product-card/link heuristics. |

Both DOM adapters intentionally share the runtime's existing card backend:
Cheerio on Node, HTMLRewriter on Worker. Existing custom selectors are used;
missing/default selectors can be inferred from the same HTML without saving
new selectors. These adapters do not promise Python library performance,
full XPath support, or byte-for-byte Python parsing semantics.

## Fetching and execution

- With the switch ON, browser choices (Playwright, Puppeteer, Crawlee) render
  the page using their existing navigation behavior, then give that HTML to
  the selected parser. Non-browser choices, including the first dropdown's
  `auto`, download HTML over the existing HTTP route; they do not silently
  escalate to a browser. Select a browser explicitly for JavaScript shops.
- The parser itself makes **no network request**. Next-page links are read
  from that same document. A scrolling run parses every rendered snapshot
  and retains the union, including cards removed by virtualized lists.
- A pinned parser returning nothing remains empty: no engine fallback,
  rendered rescue, automatic selector-repair retry or master-engine learning.
  `auto` is the only strategy that tries several parser families.
- `network_api` plus the switch is rejected explicitly: API response bodies
  are not downloaded page HTML. Disable the switch to use its legacy behavior.
- Worker supports the HTML adapters but still cannot render browsers or scroll.
- Queued jobs, inline extraction, diagnostics and pagination benchmarks receive
  the selection. Benchmarks with the switch ON compare loaders with a fixed
  parser and are read-only: they do not replace saved engines or selectors.
- Embedded JavaScript is never evaluated. Arbitrary JS expressions and Nuxt's
  specialized serialized reference formats are not promised to decode.

## Verification

Regression tests compare the OFF path against published commit `2a7f7da`,
including extracted fields, fallback/discovery results and fetch counts (only
elapsed time and scrape timestamps are ignored). Additional tests cover all
choices on both twins, empty pins, JSON families, UI rendering/toggling,
autosave, normalization/JSON round trips, real pipeline argument routing,
rendered HTML reuse, virtualized scroll union and network_api rejection.
Browser transport tests use synthetic fixtures, not a live shop. No VPS
installation or live-site accessibility is implied.
