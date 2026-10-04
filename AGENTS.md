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
node scripts/lab-service.mjs                        # deployer + builds + version wiring (<5s)
node --test worker-tests/engine-diagnosis.test.mjs  # engine tests only
npm test                                            # full gate (must be green)
```

## 2. Versioning and changelog (every release)

- **Single source.** `package.json` `version` is the only place a version is
  set. After bumping it, run `npm run version:sync` (rewrites wrangler,
  dashboard badges/footers, install guides, lockfile, test anchors) and keep
  `npm run version:check` green. Never hand-edit version strings elsewhere.
- **Release marker.** A version published by the agent carries a trailing `+` on the number
  (`1.178.0+`), including the changelog heading and its Persian digits (`۱.۱۷۸.۰+`).
  `version:sync` accepts and propagates the marker; it is display-only. Never splice a raw
  version string into a regular-expression source (a trailing `+` there is a quantifier) -
  compare against `packageJson.version` instead.
- **Changelog card.** Every release adds one featured Persian changelog card
  in `worker-src/dashboard.ts` (`📜 گزارش تغییرات کد`): the new card goes
  first with `<time>… · نسخهٔ X.Y.Z</time>` (Persian digits), the previous
  featured card moves into the `<details class="change-recent">` fold, and
  the fold's summary count is bumped. Tests enforce exactly one expanded
  card and the current version in it.
- **Rebuild the committed bundle.** `npm test` regenerates
  `scraper4.worker.js`; commit it together with the sources.

## 3. Standing rules

- **Twin parity.** Every extraction fix lands in `worker-src/scraper.ts` AND
  `render-src/scraper.ts`, with assertions on both twins.
- **Fixtures, not live sites.** The sandbox has no outbound network and the
  render twin blocks even localhost (SSRF guard). Save the page HTML as a
  fixture under `worker-tests/fixtures/` and keep it — it becomes a permanent
  regression asset.
- **Deployer page contract.** `scripts/local-deployer-ui.mjs` serves its CSS
  and HTML from a single `String.raw` template (no backticks inside, `${}` only
  for real interpolation), sizes everything in rem/em with em breakpoints so
  text zoom actually scales the layout, and keeps its ids, `/api/*` routes and
  the token flow stable — redesigns are additive.
  `worker-tests/deployer-ui-mobile.test.mjs` pins the markup and stylesheet,
  `worker-tests/deployer-ui-live.test.mjs` runs the page's own script against a
  parsed DOM to pin behaviour. Add a capability, add a pin.
- **Brownfield discipline.** Small diffs, count-asserted patches, no renames
  of public behavior; run the gate before every commit and push.
- **Automatic push (user instruction).** After each completed code change, run
  validation, commit, and push to the session branch without waiting for another
  push request. For this session use `git push origin arena/01a0aa17-new` only.
  Never force-push; report any validation or push failure honestly. A successful
  push does not imply a verified deployment.
- **Replies in English.** Chat answers to the user are entirely in English
  (no mixed-language sentences).
