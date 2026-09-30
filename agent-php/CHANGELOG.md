# Changelog

All notable changes to the PHP edition of the Arena Coding Agent.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`APP_VERSION` in `app/Bootstrap.php` is the single source of truth; `/health`,
`/api/version` and `/api/__diag` all report it. The HTTP contract version
(`apiVersion: "v1"`) is separate and deliberately unchanged — the bundled SPA
depends on those response shapes.

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
