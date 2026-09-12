# Agent instructions (Scraper 4)

## 1. Lab first — no exceptions for extraction work

Before touching any extraction code (`worker-src/scraper.ts`,
`render-src/scraper.ts`, `render-src/server.ts` benchmark paths), run the lab
and reproduce the reported behavior there. The full spec is
`cloudflare-scraper4/LAB.md`. The loop is:

```
fixture -> probe (broken) -> fix BOTH twins -> probe (healthy)
  -> new regression test -> npm test green -> commit on the session branch
```

Key commands (from `cloudflare-scraper4/`):

```bash
node scripts/lab-probe.mjs patris-cards.html        # interactive twin report (~2s)
node scripts/lab-probe.mjs --file /tmp/page.html --base https://shop.example/
node --test worker-tests/engine-diagnosis.test.mjs  # engine tests only
npm test                                            # full gate (must be green)
```

## 2. Standing rules

- **Twin parity.** Every extraction fix lands in `worker-src/scraper.ts` AND
  `render-src/scraper.ts`, with assertions on both twins.
- **Fixtures, not live sites.** The sandbox has no outbound network and the
  render twin blocks even localhost (SSRF guard). Save the page HTML as a
  fixture under `worker-tests/fixtures/` and keep it — it becomes a permanent
  regression asset.
- **Version is single-sourced** from `package.json` (`version:sync` /
  `version:check`); never hand-edit version strings elsewhere.
- **Brownfield discipline.** Small diffs, count-asserted patches, no renames
  of public behavior; run the gate before every commit and push.
- **Replies in English.** Chat answers to the user are entirely in English
  (no mixed-language sentences).
