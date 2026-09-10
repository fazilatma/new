# Latest PHP/Python parity audit

Date: 2026-09-08 (previous pass: 2026-09-06)

## 2026-09-08 pass - PHP v10.123 -> v10.170

Method: instead of re-inventorying all ~1,820 PHP functions, the function list of the
version the previous audit stopped at (v10.123, 1,768 functions) was diffed against
v10.170 (1,820 functions). That produced 55 new function names, grouped into: resume
cursors, stop flags, task checkpointing, and suffix-report helpers.

Most of those 55 turned out to be already covered here (Basalam status codes, stop
flags, cursors and checkpoints all had existing implementations), so they are not
re-listed. Two gaps were confirmed by actually running our code against the PHP
behaviour, and both are now ported:

### v10.125 - auto-resume no-progress cap (`taskProgressSig` + `autoResumeBook`)

`recoverBackgroundRuns()` re-queued a stalled run forever with no progress check, so a
run that could never advance was recovered, stalled and recovered again indefinitely.

Ported into `worker-src/background.ts`:

- `taskProgressSig(run)` - fingerprints only progress counters. Like the PHP original it
  deliberately excludes timestamps; including `updatedAt`/`createdAt` would make every
  attempt look like fresh progress and the cap could never fire.
- `noteAutoResumeAttempt(run)` / `clearAutoResumeAttempts(kind, id)` with KV state key
  `background_resume_book`.
- `AUTO_RESUME_MAX_TRIES = 5`, `AUTO_RESUME_WINDOW_MS = 3_600_000` (PHP `AUTO_RESUME_WINDOW = 3600`s).
- After 5 attempts with an unchanged fingerprint the watchdog parks the run as
  `status='paused'`, `phase='no-progress'` instead of re-queueing it.
- A human resume (`controlBackgroundRun`) and `resetBackgroundRun` both clear the counter,
  so a parked run stays retryable.

### v10.170 - Persian text normalisation (`suffixTextNormalize`)

Our normalisers folded only `ي ى ك`. They did not fold `ة ۀ أ إ ؤ`, did not strip Arabic
diacritics (U+064B-U+065F, U+0670, tatweel), and did not treat ZWJ (U+200D) as a
separator. The result: the same product written with two spellings produced two different
category-learning phrases and two different dedup keys.

Ported as one shared helper `normalizePersianText()` in `worker-src/utils.ts`, now used by
all 9 call sites (previously 9 separate ad-hoc regex chains):

| file | function |
| --- | --- |
| `worker-src/ai.ts` | `normalizeCategoryText` |
| `worker-src/app.ts` | `normalizeImportHeader`, `normalizeImportRecord` |
| `worker-src/automation.ts` | `norm` |
| `worker-src/db.ts` | `normalizeLearning` |
| `worker-src/dedup.ts` | `dedupKey` |
| `worker-src/maintenance.ts` | `norm` |
| `render-src/automation.ts` | `norm` |
| `render-src/db.ts` | `normalizeLearning` |
| `render-src/maintenance.ts` | `norm` |

Deliberate deviation: PHP also folds `ئ -> ی` and `آ -> ا`. We do not, because that merges
genuinely distinct Persian words (`مسئول` vs `مسلول`). A regression test asserts these stay
distinct.

Covered by `worker-tests/php-10170-parity.test.mjs` (7 tests).

### v10.170 - reconciliation table (`reconRunOne` / `reconExpected`)

`recon()` only answered "is this local row mapped to a remote id?" and returned a flat
summary. The PHP edition answers the question shop owners actually ask: for every
product, does the destination agree with the source, and if not, why?

Added `reconTable()` in `worker-src/maintenance.ts` (re-exported by
`render-src/maintenance.ts`, so both runtimes share one implementation). Every remote
product and every unmatched active local product is bucketed exactly once:

| bucket | meaning |
| --- | --- |
| `matched` | in both, price agrees |
| `priceDiff` | in both, destination price differs (carries `from`/`to`/`delta`) |
| `extra` | in the destination but in no profile/source |
| `missing` | in the source but not in the destination (retired products excluded) |
| `noPrice` | matched, but the source has no price so it cannot be compared |

Matching follows PHP's order: normalized title first (`reconNormTitle` = the shared
Persian normalizer plus product-code suffix stripping), then `sku`, then the stored
remote id, so products whose titles were edited at the destination still match instead
of being double-counted as `extra` + `missing`.

Surfaced as:

- `POST /api/maintenance/recon-table/<target>` in both `worker-src/app.ts` and
  `render-src/server.ts`.
- `POST /api/maintenance/recon-unified` (1.95.0) - one table across every profile,
  WooCommerce and each Basalam stall, comparing price *after* that destination's own
  percentage adjustment and Rial conversion, plus presence/absence.
- `POST /api/maintenance/recon-unified/apply` - dry run by default; `{"confirm":"APPLY"}`
  fixes prices and republishes missing products through the normal sync path. Products
  that exist only at the destination are reported, never auto-deleted.
- `GET /api/maintenance/recon-accounts` - the destinations taking part.
- The comparison itself lives in `worker-src/recon-core.ts`, which imports no database
  or network module, so both runtimes share one algorithm. Before 1.95.0 the Node
  runtime re-exported the Worker implementation and every non-Cloudflare install failed
  with `D1 binding DB is not configured`.
- Two "جدول مغایرت" buttons on the existing reconciliation card, rendering a sorted,
  colour-coded table (discrepancies first) instead of the previous raw JSON dump.

### AI model test - precise configuration errors

Not a PHP gap, but reported alongside it: testing all models returned the same opaque
"تنظیمات ارائه‌دهنده/مدل کامل نیست" on every row. Default providers (OpenRouter,
Mistral, Ollama) ship with a model list but no API key, so `aiCall`'s combined
`!baseUrl || !apiKey || !model` guard fired for all of them with no indication which
field was missing. `aiConfigProblem()` now names the missing field, unconfigured
providers are reported as skipped (`phase: 'configuration'`) rather than as failures,
and local runtimes (Ollama / localhost) are exempt from the API-key requirement.

### Reviewed and intentionally not ported

- `sfxRemoteStatus` / `suffixStatusBucket` - the underlying Basalam status codes
  (2976/3567/3568/3790/4184) already exist in `worker-src/`; the remainder is PHP-side
  report cosmetics.
- `localTaskStateStatus`'s `partial` bucket - our `RunStatus` vocabulary is
  `queued|running|paused|done|failed`; PHP maps `partial` onto `paused`, which is what we
  already surface.


Compared upstream repositories:

- `fazilatma/amphp` latest active branch by commit date: `arena/01a06ac3-amphp`
  - PHP `scraper4.php`: `APP_VERSION = 10.123`
  - Python `scraper4.py`: `APP_VERSION = 10.149`
- `fazilatma/code` latest active branch by commit date: `arena/01a0425a-code`
  - PHP `scraper4.php`: `APP_VERSION = 10.91`
  - Cloudflare single-file `scraper4.ts`: older single-file Worker edition

## Ported into this TypeScript/Cloudflare project

### Python/PHP v10.149 — per-site master extraction engine

The Python edition learns the fastest successful engine for a profile/site and tries it first on later pages/runs.

Port added here:

- `Profile.extractionEngineMaster`
- `Profile.extractionEngineHost`
- `Profile.extractionEngineMs`
- compatibility import aliases from PHP/Python profiles:
  - `fetch_engine_master`
  - `fetch_engine_host`
  - `fetch_engine_ms`
- Worker extraction engine ordering now tries the learned master before fallback engines in `auto` mode.
- Render/Node extraction engine ordering does the same and can include browser engines.
- Scrape processors persist the winning engine after successful extraction.

### Python/PHP v10.148 — Basalam price unit safety

The Python edition sends Basalam prices in rial by multiplying toman prices by 10, unless the source text already says rial/IRR.

Port added here:

- Worker `syncBasalam()` now calls `basalamPrice()`.
- Render `syncBasalam()` now calls `basalamPrice()`.
- If `product.priceText` contains `ریال`, `rial`, or `IRR`, the numeric price is kept.
- Otherwise the final Basalam payload price is multiplied by 10 after per-shop percentage adjustment.

## Already covered before this audit

Many earlier PHP/Python items were already present in this project before this pass, including:

- multi-shop Basalam settings and destination mapping
- AI provider candidates and master model selection
- category-learning / tried-category memory
- backup/restore and import/export
- visual selector tooling
- detail extraction, gallery extraction, variations, JSON-LD, `__NEXT_DATA__`, metadata, script JSON, heuristic extraction
- Cloudflare-safe Worker engines and Render/Node-only browser engines
- safe zero-product handling that avoids retiring products after an unreliable scan

## Not copied directly

Some PHP/Python items are runtime-specific and are intentionally not copied into the Cloudflare Worker runtime:

- PythonAnywhere/VPS `systemd`, Gunicorn, Apache `/put`, and Python virtualenv installers
- Python engines such as `httpx`, `cloudscraper`, `curl_cffi`, and Selenium inside Cloudflare Workers
- direct anti-bot bypass behavior

Those belong in Python/VPS or Render/Node deployments, not Cloudflare Workers.
