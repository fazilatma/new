# Changelog

All notable changes to the PHP edition of the Arena Coding Agent.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`APP_VERSION` in `app/Bootstrap.php` is the single source of truth; `/health`,
`/api/version` and `/api/__diag` all report it. The HTTP contract version
(`apiVersion: "v1"`) is separate and deliberately unchanged — the bundled SPA
depends on those response shapes.

---

## [1.4.1] — 2026-10-01

### Added
- **Dedicated Provider Model Catalog Import Endpoint (`/api/providers/{pid}/import-models`).** Allows importing specific model lists directly into existing providers with replace/merge support.
- **Universal Multi-Format API Key Normalizer.** Accepts dictionary (`{"0": "...", "key": "..."}`), object array (`[{"apiKey": "..."}]`), and comma/newline separated API keys across different catalog formats.
- **Markdown Code Fence & Smart Quote Sanitization.** Automatically cleans leading/trailing markdown fences (````json ... ````) and curly typographic quotes from pasted JSON imports.
- **Dynamic Endpoint URL Resolution.** Clean resolution of Ollama (`/api/chat`), Gemini (`/openai/chat/completions`), and standard OpenAI-compatible endpoints.

---

## [1.4.0] — 2026-09-30

Import kept failing with the host's own "page not found" page even after
1.3.2, so this release stops guessing and adds the means to find out where a
request actually dies.

### Added
- **`/diag` — a standalone connectivity self-test.** One page, no
  dependencies, reachable at `/diag`, `/index.php/diag` or
  `/index.php?__path=/diag`. It probes all three URL shapes, then POSTs four
  payloads (tiny, realistic-with-API-key, base64, ~250 KB) and reports which
  combination the host accepts, ending in a plain-language verdict and a
  copy-pasteable report. Unauthenticated and read-only by design — it has to
  work precisely when the rest of the app does not.
- **Probe mode on `POST /api/providers/import-text`.** `{"probe": true}`
  reports how many bytes survived the trip and whether they parse, without
  touching stored data. This separates "the request never arrived" from "the
  catalog is malformed", which the old error message could not do.
- **Base64 transport for the catalog.** `jsonB64` / `b64` (standard or
  URL-safe alphabet) are accepted alongside `json`. Shared hosts frequently
  run a WAF that inspects request bodies and rejects anything containing API
  keys or URLs, answering with an HTML error page; the provider catalog is
  the only payload in the app that trips those rules.
- **Automatic fallback in the import dialog.** When the plain POST fails at
  the transport level the same bytes are re-sent base64-encoded, and the
  success message says so. If both fail, the error names `/diag`.

### Fixed
- The routing error message now also prints the `/diag` URL.

### Notes
- `tools/tests/import-transport.php` covers all six transport cases under
  real PHP 8.3. Two of its failures were harness artefacts worth recording:
  `Response::$headersSent` is a latch that must be cleared between dispatches
  in a multi-request test process, and `Database::init()` has to run before
  an import that persists.

---

## [1.3.2] — 2026-09-30

Fixes a routing dead end that made provider import (and every other API call)
fail with the web server's own "page not found" page on hosts that have
neither URL rewriting nor `PATH_INFO`.

### Fixed
- **The client only ever tried two of the three URL shapes the server
  supports.** `Request::capture()` has understood `/api/x`,
  `/index.php/api/x` and `/index.php?__path=/api/x` since 1.3.0, but the
  browser-side self-healing fetch fell back from the first to the second and
  then gave up. On a host with rewriting *and* `PATH_INFO` disabled both
  attempts return the web server's HTML 404, so the app could never recover —
  the import dialog reported the host's "page not found" text and looked like
  an import bug. The fallback chain now walks all three shapes and remembers
  the working one in `sessionStorage` (`arena_api_base` + `arena_api_mode`).
- **A non-JSON error body was dumped verbatim into the alert box.** A 404 that
  carries an HTML page is now reported as what it is — a routing failure — and
  names the three URLs that were tried plus the `/api/__diag` endpoint to open,
  instead of pasting the host's error page into a dialog. Other non-JSON
  bodies are stripped of tags and truncated to 300 characters.

### Added
- `window.__API_MODE__` (`'path'` | `'query'`). In query mode `window.apiUrl()`
  emits `<front-controller>?__path=/api/x`, preserving any query string the
  caller supplied. Path separators are left unescaped so existing
  `path.includes('/auth/login')`-style checks keep working.
- `tools/tests/routing.php`: two further cases for the shapes the client now
  emits (`?__path=` at root, and `?__path=` alongside the caller's own
  `?format=csv`) plus assertions that `__path` is removed from `$_GET` while
  the caller's parameters survive. **13/13 shapes pass under real PHP 8.3.**

---

## [1.3.1] — 2026-09-30

User-interface fixes. No API, schema or response-shape changes.

### Fixed
- **The Local AI installer was unreachable.** `/localai` (shipped in 1.2.0) was
  fully functional but nothing in the SPA ever linked to it — the page could
  only be opened by typing the URL. Added a **🧠 Local AI Installer** entry to
  the sidebar, directly below *Providers & Models*. It navigates through
  `window.apiUrl('/localai')`, so it resolves correctly for root,
  subdirectory and no-rewrite (`/index.php/localai`) installs.
- **Back-links in the secondary pages were hard-coded to `/`.** `localai.html`
  and `chat.html` sent the user to the server root, which is the wrong place
  for a subdirectory install. Both now resolve their home link through
  `window.apiUrl('/')` at load time (`[data-home-link]`).

### Changed
- **The chat model-picker header is now collapsible on narrow viewports.**
  On phones — and on desktops zoomed past roughly 150 %, which is what the
  existing `(max-height: 550px)` branch catches — the provider select, model
  select and *Require Approval* checkbox wrap onto three rows and consume most
  of the chat area. They now fold into a single summary row reading
  `<provider> / <model> · 🛡️`, toggled by the header itself.
  - Collapsed by default on a compact viewport, expanded otherwise; zooming in
    and out re-applies that default until the user clicks the toggle.
  - An explicit click is remembered in
    `localStorage['arena_chat_controls_collapsed']` and then wins over the
    viewport default.
  - The toggle does not exist at all on roomy viewports, so desktop behaviour
    is byte-for-byte unchanged.
  - Carries `aria-expanded` / `aria-controls`.

---

## [1.3.0] — 2026-09-30

Deployment hardening. The app now adapts to the host instead of requiring the
host to be configured for the app.

### Added
- **Automatic install-prefix detection.** `Request::capture()` understands three
  URL shapes, so at least one always works:
  `/api/health` (rewriting available), `/index.php/api/health` (PATH_INFO),
  `/index.php?__path=/api/health` (neither). Subdirectory installs are detected
  from `SCRIPT_NAME`, with a guard against the PHP built-in server reporting the
  requested path there.
- **`window.__API_BASE__` injection.** Served HTML is told which prefix to use,
  so none of the ~87 front-end call sites needed editing.
- **Client-side self-healing.** When the page is loaded from a plain directory
  URL the server cannot know whether rewriting works; the first API call that
  returns a non-JSON 404 (the web server's own error page) is retried once
  through the front controller and the working prefix is remembered in
  `sessionStorage`.
- **`GET /api/__diag`** — reports detected routing prefix, whether rewriting
  works, PHP limits, extension availability and path writability. Exposes no
  secrets.
- **`tools/`** — Node stand-ins for `php -l` on machines with no PHP binary:
  `phplint.mjs` (syntax), `phpcheck.mjs` (symbol + arity resolution),
  `routecheck.mjs` (front-end call ↔ route coverage, exits non-zero on a gap).
- `.htaccess`: `AcceptPathInfo On`, a `FallbackResource` branch for hosts
  without `mod_rewrite`, and upload limits for `mod_php7/8` and LiteSpeed.

### Fixed
- Saving the provider catalog to an unwritable `data/` surfaced as an opaque
  `400`, because `Bootstrap` promotes every PHP warning to an `ErrorException`.
  `ProviderStore::save()` now pre-flights and names the exact path, the PHP
  user, and the `chmod` that fixes it.
- `Config::bool()` was called in the diagnostics route but does not exist
  (caught by `tools/phpcheck.mjs`); corrected to `Config::authEnabled()`.

### Verified
- `tools/routecheck.mjs`: 87 front-end calls ↔ 180 routes, no gaps.
- All 5 client self-healing scenarios (root/subdirectory × rewrite/no-rewrite,
  plus server-detected) reach a working prefix — simulated in Node against the
  shipped helper.
- The 11 install-prefix shapes pass against a JavaScript port of
  `Request::capture()`. The equivalent PHP-side run
  (`tools/tests/routing.php`) is written but has **not** been executed yet;
  run `node tools/phprun.mjs tools/tests/routing.php` to confirm.

### Tooling
- **`tools/phprun.mjs` runs real PHP 8.3** against this codebase via the
  WordPress Playground wasm build — no system PHP needed. It ships openssl,
  pdo_sqlite, mbstring, json, zip and curl, so the app boots and its routes
  can be exercised. `tools/tests/` holds the first two suites.
- `tools/versioncheck.mjs` keeps `APP_VERSION`, `CHANGELOG.md` and the docs
  from drifting apart.

---

## [1.2.0] — 2026-09-30

### Added
- **Format-tolerant provider catalog import.** The payload is sniffed rather
  than validated against one fixed schema; object-keyed-by-id, a list of
  providers, `{providers: …}`, `{data: …}`, a single provider object and export
  envelopes with metadata are all accepted.
- Unknown per-model keys (`tested`, `available`, `rateLimited`, `testDetails`,
  `nonChat`, …) are preserved in `model.extra` instead of being silently
  dropped on the first save.
- `nonChat: true` disables the model so it never reaches the chat picker.
- Protocol inference when `protocol` is absent (`ollama`, `anthropic`,
  `gemini`, `mistral`, `azure`, `cloudflare`).
- Provider id derived from `slug`, the object key, or `name` when `id` is missing.
- `php bin/console.php provider:import <file> [--replace]` and
  `provider:export [file]` — no HTTP body-size limit.
- Import responds with `{providers, models, created[], updated[], skipped[]}`.

### Changed
- Merge mode merges **models by id** and never overwrites a stored API key with
  an empty one.
- `413` with the actual `post_max_size` / `upload_max_filesize` values when PHP
  discards an oversized body; JSON syntax errors report length and trailing
  bytes so a truncated paste is obvious.

### Fixed
- The SPA reported every import failure — including server errors — as
  "Invalid JSON format". Client-side parse errors and server errors are now
  distinguished, and the server's message is shown.

### Verified
- Executed end-to-end in a real PHP 8.3 runtime (`tools/tests/import.php`):
  `POST /api/providers/import-text` returns `200` with
  `{ok:true, providers:2, models:2}`; `ollama` is inferred as protocol
  `ollama`; the `nonChat` model is disabled; the API key is encrypted at rest;
  and `testDetails`/`nonChat` survive a save + reload round trip.
  **This rules out the import code as the cause of a host-side "Import
  failed" — the failure is environmental.**

---

## [1.1.0] — 2026-09-30

### Added
- **Local AI installer** (`app/LocalAI.php`, `public/localai.html`, `/localai`):
  root-free Ollama runtime install under `storage/localai`, hardware scan
  (RAM with cgroup awareness, cores/AVX2, GPU/VRAM, disk), a sizing model
  (weights + KV cache + overhead, bandwidth-bound throughput with MoE active-
  parameter support) and a recommendation engine over a 23-family / 54-variant
  catalog with hard filters and Persian-language scoring.
- Background install job: runtime → server → pull → tune (`num_ctx`) →
  benchmark → auto-register in the chat model picker.
- Live model discovery from `registry.ollama.ai` and Hugging Face, with
  graceful degradation to the bundled catalog.
- `ai:host`, `ai:runtime`, `ai:serve`, `ai:stop`, `ai:recommend`, `ai:install`,
  `ai:models`, `ai:rm`, `ai:test` console commands.
- `hostconsole-project.json` — single-project import profile for WebConsole Pro,
  and `HOSTCONSOLE.md` (Persian setup guide).

### Changed
- Scoring v2: satisficing speed score (log-shaped, saturating ≈14 tok/s, halved
  below 1.5 tok/s), quality raised to the power 1.6, and a relative-quality
  demotion so a fast toy model never outranks a stronger model on the same
  budget.
- `hostconsole-project.json` reduced to the project-dialog schema (whitelisted
  keys only, single-line commands) after the console rejected the settings-export
  envelope with "فیلد ناشناخته".

### Fixed
- `Config::proxyConfig()` returns `{effectiveUrl, proxyClient}`; four call sites
  in `LocalAI` used a non-existent `proxy` key and silently bypassed the proxy.
- `LocalAI::absPath()` resolves relative `AGENT_LOCALAI_DIR` / `OLLAMA_MODELS`
  against the application root, because CWD differs between php-fpm and CLI.

---

## [1.0.0] — 2026-09-30

Initial PHP port of the Arena AI Coding Agent (from Python v0.16.1).

### Added
- Full route surface preserved so the existing 347 KB single-page UI works
  unchanged: same paths, verbs and JSON response shapes.
- Multi-provider LLM chat (OpenAI-compatible, Anthropic, Gemini, Ollama,
  Mistral, Azure, Cloudflare), SSE token streaming, tool-calling agent loop
  with 11 tools, provider fallback + circuit breaker + API key rotation.
- ChangeSet diff approval workflow, workspace file CRUD and previews,
  conversation/checkpoint persistence, projects, RBAC auth with sessions,
  rate limiting and audit logs, background job worker, Git/GitHub integration,
  browser automation, terminal, observability.
- SQLite (WAL) persistence, AES-256-GCM encrypted secrets, `bin/console.php`
  and `bin/worker.php`.
- Unlike the Cloudflare Workers edition, the four Workers-only degradations are
  real implementations here: a real shell, real code execution, Playwright via
  `scripts/browser_agent.py`, and the git CLI.
