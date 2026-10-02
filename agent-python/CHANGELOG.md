# Changelog

## 3.3.5 - Local Model "Test" (and Install/Delete) Showed a Useless "HTTP Error 500: Internal Server Error" Instead of Ollama's Real Diagnosis

### Fixed
- **Clicking "تست" (Test) on a freshly-installed local model reported a bare, useless `خطا: HTTP Error 500: Internal Server Error`** with no indication of what actually went wrong, even after the 3.3.4 chat-reliability fixes. Root cause: `urllib.request.urlopen()` raises `urllib.error.HTTPError` when Ollama/llama.cpp respond with a non-2xx status, and Python's `str()` of that exception renders as just `"HTTP Error <code>: <generic reason phrase>"` (e.g. "Internal Server Error" for any 500, regardless of cause) — it completely discards the response **body**, which is exactly where Ollama/llama.cpp put the actual, actionable diagnosis (e.g. `"model requires more system memory (6.2 GiB) than is available (4.1 GiB)"`, `"llama runner process has terminated: exit status 2"`, an out-of-VRAM message, an unknown-model-tag error, etc.). `benchmark_test()`/`benchmark_llamacpp()` (the "Test" button), `remove_model()` (the "حذف" / Delete button), and `pull_model()` (model install) now read and surface that body instead of the generic reason phrase, so the real cause is visible and actionable. `pull_model()` additionally now detects Ollama's other common failure shape — an `{"error": ...}` line streamed back with an ordinary HTTP 200 status (e.g. "pull model manifest: file does not exist" for a mistyped/nonexistent model tag) — which previously made the installer silently report success with nothing actually installed.
- Verified with a reproduction of the exact Ollama failure response shape (JSON `{"error": "..."}` body on a 500) through `_describe_http_error()` and through `benchmark_test()` end-to-end, confirming the real diagnostic message is now shown instead of "Internal Server Error"; 2 new regression tests added (60 total, all passing).

## 3.3.4 - Chat Produced "No Response" on Any Provider Failure (Frontend Crash + ~4-Minute Silent Retry Storm)

### Fixed
- **Chat appeared to produce no response at all whenever a provider/model failed with zero generated text** (wrong/missing API key, unreachable host, invalid model name, immediate error from the provider, a local Ollama server that isn't actually running yet, etc.) — this is the single most common real-world failure shape, so it affected effectively every misconfigured or temporarily-unreachable provider, local or cloud. Root cause was two compounding bugs in the chat send/stream-handling code in `static/index.html`:
  1. **A `TypeError: Assignment to constant variable` silently masked the real backend error.** `accumulated`/`finalContent` were destructured with `const` from the stream context, but the "the provider failed before streaming a single token" branch tried to *reassign* `accumulated` to build a fallback message — throwing before the message bubble or chat history was ever updated. The outer `catch` block caught this *new* JS error instead of the original provider error and displayed the unhelpful, generic `⚠️ خطا در ارسال یا دریافت پاسخ (Request Failed): Assignment to constant variable.` with no indication of what actually went wrong (bad API key, unreachable host, etc.). Both affected code paths (the normal send flow and the job-reattach/resume flow) now use a mutable variable, so the real backend error (`error`/`errorDetails` from the stream, e.g. "Provider X does not have an API key configured" or "All connection attempts failed") is shown and saved into chat history correctly.
  2. **A single unreachable/failing provider could silently retry for up to ~4 minutes — and far longer across multiple configured fallbacks — before any error was ever raised.** The network-timeout retry loop in `app/chat.py` used 10 attempts with exponential backoff capped at 60s per attempt (sleeps of 1,2,4,8,16,32,60,60,60s ≈ 243s for *one* candidate provider alone), triggered by any error that merely *contained the word* "connect"/"connection"/"timeout" — including an outright refused connection (e.g. a local Ollama service that was never started), which will never succeed no matter how long you wait. Combined with bug #1 above, this meant a user could stare at "در حال اتصال به مدل..." for minutes with no visible outcome, which is indistinguishable from "the model produces no response at all". The retry budget is now a short, fast-failing 4 attempts with delays capped at 8s (≈7s worst case per candidate, tunable via the `MAX_NETWORK_RETRY_ATTEMPTS`/`MAX_NETWORK_RETRY_DELAY_SEC` env vars) — enough to absorb a brief blip (e.g. a local server mid-startup) without making a genuinely broken configuration look like total silence. A failing provider now reports its real error (or falls back to the next working candidate, if any) within seconds instead of minutes.
- Both fixes were verified with a true end-to-end reproduction: a real Node `fetch`-backed jsdom harness driving the actual chat UI (provider/model select → type → send → read `#chatMessages`) against the live backend with mock OpenAI-compatible and native-Ollama-protocol HTTP servers, covering both the successful-response path and the provider-failure path, plus a new backend regression test (`test_network_retry_fails_fast_not_for_minutes`) asserting the retry loop completes in well under 20 seconds instead of minutes.

## 3.3.3 - "$HOME is not defined" Blocked Every Model Install; Errors Now Show in a Copyable Modal

### Fixed
- **Every local model install/download failed with "Local AI server did not become ready within 20s. Log: Error: $HOME is not defined" (repeated several times)**, which also made the model-recommendation flow look completely broken (recommendations rendered fine, but clicking "نصب" / Install on any of them hit this same failure). Root cause: on some hosting-panel/process-manager deployments, the Python server itself is launched with no `$HOME` environment variable at all (or one pointing at a path that doesn't exist/isn't writable under the service account actually running it). `server_env()` — used to build the environment for the `ollama serve` / `llama-server` / `ollama create` subprocesses — blindly copied `os.environ` as-is, so the spawned binary inherited that same missing `$HOME`. Both ollama and llama.cpp are Go/C++ programs that call `os.UserHomeDir()` during startup (e.g. to create `~/.ollama`'s local identity key) and hard-fail with exactly that `$HOME is not defined` message when it's unset — independent of `OLLAMA_MODELS` or any other directory this app had already configured correctly. `server_env()` now always injects a real, writable `HOME` (falling back to a directory under the app's own local-AI data folder whenever the parent process's own `$HOME` is missing, nonexistent, or unwritable), so installs no longer depend on how the hosting environment happened to launch this server.

### Changed
- **Error and warning messages in the Local AI panel are now shown in a modal dialog with a "copy text" button, instead of the floating toast bar.** The toast was centered using `inset-inline-start: 50%` combined with a physical `transform: translateX(-50%)` — a combination that only centers correctly in LTR layouts; in this app's RTL (`dir="rtl"`) layout it resolved to `right: 50%` plus an *additional* leftward shift, pushing the toast well past center and, on narrow/mobile viewports, off the visible edge of the screen entirely. Longer error text (multi-line logs, stack traces) was also silently cut off by the toast's small fixed footprint with no way to read the rest or copy it. Errors/warnings now open a properly centered, scrollable modal (reusing the app's existing modal styling, so it behaves correctly at any viewport size) showing the complete message with a one-click "📋 کپی متن" button; success/info messages still use the lightweight toast, whose own centering was also fixed to use a direction-independent `left: 50%`.

## 3.3.2 - Every Local AI Button Was Broken by an Un-serialized Request Body

### Fixed
- **Every button in the Local AI panel failed with a bare `[object Object]` error, including "Test" (model benchmarking) and anything that ended up registering a model as a chat provider** — the root cause of the follow-on "chat gets no response" symptom too, since no local model could ever actually finish installing. When `static/localai.html` was merged into the SPA in 3.3.1, its calls to the shared `api()` helper kept passing a raw JS object as `body` (e.g. `body: { engine }`), a calling convention that only the old page's own bespoke, now-deleted `api()` helper supported (it auto-ran `JSON.stringify` on `opts.body` for you). The shared app-wide `api()` expects the caller to pre-stringify the body; handed a raw object instead, the browser's native `fetch()` silently coerces it to the literal string `"[object Object]"`, which the server then rejects as invalid JSON — and because FastAPI's validation-error `detail` is itself a list of error objects, running it through `new Error(...)` produced the exact literal text `"[object Object]"` the user saw, on *every single* affected button (runtime install/start/stop/engine-switch/fix-permissions, model search, model test, model install, profile save, recommend, GGUF import, llama.cpp activate). The shared `api()` helper now auto-detects a non-string, non-`FormData`/`Blob`/`ArrayBuffer` body and JSON-encodes it (with a `Content-Type: application/json` header) before sending, fixing every one of these call sites at once without having to touch each one individually, and without affecting any existing call site that already pre-stringifies its body.
- **A handful of Local AI endpoints (`runtime/start`, `runtime/stop`, `runtime/fix-permissions`, `test`, `search`, `scan`, `recommend`, `register`, `profiles`) let backend exceptions bubble up as a bare, undecorated HTTP 500 "Internal Server Error"** instead of a descriptive JSON `detail` message, unlike their sibling endpoints (`runtime/install`, `pull`, `llamacpp/activate`, `models/{name}` delete) which already wrapped their logic in `try/except` → `HTTPException(..., str(e))`. All of the above now follow the same pattern, so real failures (e.g. no internet access to download the Ollama/llama.cpp binary, a permission error, an unreachable host) surface as a legible, specific message in the UI toast instead of a generic, unhelpful "Internal Server Error".

## 3.3.1 - Local AI Installer Merged Into a Single Unified App File

### Changed
- **Local AI Installer is no longer a separate page/file**: `static/localai.html` (a standalone HTML document previously opened via a full navigation or a new tab) has been merged directly into `static/index.html` as a first-class SPA view (`navigate('localai')`, same as Providers/Settings/Jobs/etc.). Clicking "Local AI Installer" in the sidebar now just switches views in place — no new tab, no page navigation, and your current chat/project is never lost. Its CSS was scoped under `#view-localai` and its JS wrapped in an isolated closure so nothing it defines can collide with the rest of the app; all of its actual functionality (hardware scan, model recommendations, runtime install/start/stop, manual search, disk scan) is unchanged. The old `/localai` URL still works for bookmarks — it now serves the unified app and auto-opens this view.
- **Removed `static/chat.html`**: a fully orphaned, unreferenced legacy prototype page (no route served it) left over from a much earlier version, removed as part of consolidating the project into fewer, actively-used files.

## 3.3.0 - Resumable Job-Backed Chat, Provider Catalog Import Fixes, Round-Robin Model Testing

### Added
- **Fully server-side, crash-resumable chat/agent loop**: the chat/agent loop (and other long-running server work) now runs through the existing Jobs/worker queue instead of being tied to the request's lifetime, so it survives the browser closing, network loss, *and* a full server process restart or crash mid-generation — resuming from its last checkpoint. Pause/resume/cancel/retry are exposed in the chat UI (the pause/resume/retry endpoints already existed server-side; cancel is newly wired up).
- **Round-robin provider/model test ordering** (`/api/providers/test-all`): tests model #1 of every provider, then model #2 of every provider, and so on, instead of exhausting one provider's entire model list before moving to the next — spreads repeat requests to any single provider's rate limit as far apart in time as possible.
- **Richer provider-import feedback**: `/api/providers/import` and `/api/providers/import-text` now report `created`/`updated` provider ids and `modelsAdded`/`modelsUpdated` counts instead of a bare provider count, and the UI shows exactly what changed.
- **Full-width, sortable model-test-results table**: the test-results modal now fills the viewport instead of a small fixed-size popup, and every column header (Provider, Model, Status, Latency, Diagnostics) is click-to-sort with ascending/descending indicators.

### Fixed
- **Provider catalog import silently added nothing**: re-importing a catalog (the default merge mode) replaced the *entire* existing provider object with whatever the payload contained, so a re-import with a blank `apiKey` or `models: []` (exactly what the Export feature itself produces) silently wiped an already-configured, working provider while still reporting "success". Imports now merge field-by-field and model-by-model (by id), preserving anything the incoming payload didn't actually specify.
- **Provider catalog import created orphaned duplicate providers instead of updating the existing one**: when a catalog entry had a `"name"` field (the overwhelmingly common real-world shape, e.g. `{"mistral": {"name": "Mistral AI", ...}}` — exactly what the import modal's own placeholder shows), the provider's identity was derived from that display name instead of from the JSON key, so re-importing silently created a new `mistral-ai` provider instead of merging into the existing `mistral` provider. From the existing provider's point of view, the import appeared to add nothing. Provider identity now prefers the JSON key, matching the PHP edition's `id ?? slug ?? fallbackId` resolution, which never considers the display name at all.
- **Provider protocol defaulted wrong when omitted from an import payload**: a provider imported without an explicit `protocol`/`type` field (the common real-world shape — just `id`/`vendor`/`url`) always fell back to `openai-compatible`, producing the wrong request shape, wrong default URL, and wrong auth header for e.g. Ollama/Anthropic/Gemini/Cloudflare entries. The protocol is now guessed from the id/vendor/url when genuinely absent.
- **Missing default URL for the Gemini protocol**: a Gemini provider imported with no URL now correctly defaults to `https://generativelanguage.googleapis.com/v1beta/openai`, the official OpenAI-compatible endpoint, instead of falling through to the generic OpenAI default.
- **Outbound requests defaulted to routing through the proxy**: providers without an explicit proxy configuration now default to a direct connection instead of silently being routed through the configured proxy, removing a major source of avoidable latency and failures.
- **"Local AI Installer" menu button appeared to do nothing / bounced back to the home screen**: it performed an in-place `location.href` navigation to a separate full page, which is exactly the kind of top-level navigation an embedding preview/iframe can block, landing back on the app's original screen. It now opens in a new tab, which also preserves whatever chat/project the user was on.



### Fixed
- **Cloudflare Workers AI ignored the selected model**: the bundled provider catalog shipped the protocol literal `cloudflare-workers-ai`, which matched none of the protocol-specific branches in `chat.py`/`providers.py`/`main.py`, so every Cloudflare request silently fell back to the generic OpenAI-compatible builder — reusing whatever model happened to already be baked into the configured base URL and ignoring the model actually selected (confirmed from a bulk connectivity report where 70+ distinct Cloudflare model slugs all resolved to the exact same hardcoded `/ai/run/@cf/meta/llama-3.1-8b-instruct` endpoint). Cloudflare's native REST API (`/ai/run/{model}`, model as a URL path segment, `{"messages": [...]}` request body, `{"result": {"response": "..."}}` response body) is now implemented end-to-end — non-streaming, streaming, and the `/api/providers/{pid}/models/{mid}/test` / `test-all` diagnostic harness — and any already-persisted provider record using the old protocol literal (or other legacy aliases such as `cf`, `cf-ai`, `cloudflare_workers_ai`) self-heals to the canonical `cloudflare` protocol on next load via a pydantic validator on `Provider.protocol`.
- **Blank error messages on provider timeouts**: the chat engine (`call_provider_api`, `stream_call_provider_api`) and the model diagnostic/`test-all` harness built their user-facing error text from `str(exception)` alone; `httpx`'s own timeout and connection exceptions (`ReadTimeout`, `ConnectTimeout`, `PoolTimeout`, `ConnectError`, …) very commonly carry no message at all, so the friendly "Connection timeout…" / "Connection refused…" substring matches both missed *and* the raw error shown to the user — and used for rate-limit/fallback detection — was silently empty. All three now fall back to the exception's class name whenever the raw message is blank.

## 3.1.0 - Multi-engine Local AI Runtime, Unbounded RAM Budget, Richer Search Cards

- **Multi-engine Local AI runtime**:
  - Choose and install either **Ollama** or **llama.cpp (`llama-server`)** from a dropdown in the Local AI panel.
  - Each engine's installed/running status is tracked independently (`runtime_status()["engines"]`) and the active engine persists in `app_state` (`localai:engine`).
  - `POST /api/localai/runtime/install` now accepts `{ "engine": "ollama" | "llamacpp" }`; new `POST /api/localai/runtime/engine` switches the active engine without reinstalling.
- **Unbounded RAM budget input**:
  - The hardware-profile RAM slider is paired with a free-typing number field with no upper cap, so any custom budget — including values above the host's physical RAM — can be used for recommendations.
- **Richer manual-search result cards**:
  - Catalog and Hugging Face search results now include file size, estimated minimum RAM, parameter count, quality score, context window, and tool-calling/vision/reasoning badges per variant.

### Fixed
- **Empty top-level model recommendations**: `recommend()` no longer returns an empty list when strict hardware/feature constraints reject every catalog variant; it now falls back to a penalty-scored soft match so the user always gets actionable suggestions with clear reasons (including an embedding-task mismatch penalty).

## 3.0.0 - Code Generation Strategies, Local AI GGUF Search, Hardware Profiling & Full PHP Parity

- **Code Generation Strategy Modes (`smart-auto`, `single-file`, `multi-file`)**:
  - Customizable per-project and global code generation modes with automatic asset inlining and bundling for multi-file HTML/CSS/JS applications.
- **Enhanced Local AI Engine & GGUF Model Search**:
  - Hardware profiling (RAM budget, CPU cores, AVX2/AVX-512, GPU VRAM), category filter tabs (Coding, Chat, Reasoning, Vision, Hugging Face GGUF), instant debounced search, and custom GGUF model pull.
- **Robust Model Directory Permissions & Auto-Healing**:
  - Diagnostic permissions check and auto-healing API (`/api/localai/runtime/fix-permissions`).
- **State & Chat Selection Persistence**:
  - Chat provider and model choices persist across page reloads per provider without resetting.
- **Hardware Profile Persistence**:
  - Dedicated `/api/localai/profiles` endpoints backed by SQLite `app_state`.

## 2.1.0 - Dedicated Batch Model Importer UI, Universal Multi-Format Model Parser, Dynamic Header Version Badge

- **Dedicated Batch Model Importer Modal (`📥 درون‌ریزی مدل‌ها`)**:
  - Added dedicated per-provider model import button and top view toolbar button in the Providers view.
  - Supports instant merging or complete replacement of models for any selected provider.
- **Universal Multi-Format Model Normalizer (`app/providers.py`)**:
  - Tolerates OpenAI `/v1/models` JSON responses (`{"data": [...]}`), OpenRouter/Ollama format (`{"models": [...]}`), dictionary maps (`{"model_id": {...}}`), arrays of objects, and plain text line-by-line model names.
  - Automatic markdown code fence and smart quote sanitization.
- **Header & Sidebar Version Indicators (`app/static/index.html`)**:
  - Prominent `🚀 v2.1.0` header badge and dynamic `/api/version` client synchronization.
- **Local AI & Diagnostic Pages Parity**:
  - Added `/localai` and `/diag` static endpoints and UI buttons matching the PHP edition.

## 2.0.0 - Unified Release: Local AI Engine, Dedicated Model Importer, Parity with PHP Edition

- **Full Local AI Runtime & Manager (`app/local_ai.py` & API Endpoints)**:
  - Added dedicated Local AI module with hardware scanning (CPU cores, AVX2, RAM total/available, GPU detection, free disk space).
  - 1-click user-space Ollama runtime installer without requiring `root` or `sudo` (`POST /api/localai/runtime/install`).
  - Model recommendation engine scoring 54 quantized variants from `data/model_catalog.json` against hardware budgets and task requirements.
  - Model pulling, background execution, and automatic provider registration into `providers.json`.
- **Dedicated Model List Import Endpoint (`POST /api/providers/{pid}/import-models`)**:
  - Direct import of model lists into existing providers with replace/merge support.
- **Version Harmonization**:
  - Unified versioning with Arena Coding Agent PHP edition at version `2.0.0`.

## 0.16.3 - Multi-Key Dict Extraction, Rich Diagnostic Field Preservation & Local Model/Ollama Setup

- **Enriched Provider & Multi-Key Normalization (`app/providers.py`)**:
  - Added support for object-formatted `apiKeys` arrays (e.g. `[{"key": "sk-...", "label": "Primary", "enabled": true}]`) extracting keys and maintaining multi-key rotation lists.
  - Full model specification normalization: preserved rich diagnostic metadata (`tested`, `available`, `pricingMode`, `testDetails`, `endpointType`, `nonChat`, etc.) in `ModelSpec.extra` without validation failures.
  - Resilient local defaults: when `ollama` or local providers have empty `models: []`, default models (`llama3.2`, `qwen2.5-coder:7b`, `deepseek-r1:8b`, `mistral`) are automatically seeded.
  - Dynamic URL resolution (`resolve_provider_endpoint_url`): gracefully handles full completion URLs (e.g. `https://api.together.xyz/v1/chat/completions`), Anthropic `/v1/messages` endpoints, and Ollama `/api/chat` endpoints.
- **Dedicated Local AI & Ollama Setup Guide (`static/index.html` & `webconsole.php`)**:
  - Interactive modal (`#localModelModal`) with 1-click presets for **Ollama (127.0.0.1:11434)**, **LM Studio (127.0.0.1:1234)**, and **vLLM / LocalAI (127.0.0.1:8000)**.
  - Quick-copy CLI commands for Linux VPS installation and lightweight recommended local models.
  - Live local server connectivity checker pinging `/api/tags` and verifying local daemon health.
  - WebConsole 1-click Ollama runtime installer component (`sys.install_component`) for seamless server setup.
- **Test Suite Expansion**: Added automated pytest verification for user multi-provider rich exports and endpoint URL resolution (41/41 tests passing).

## 0.16.2 - Universal Resilient Provider Importer & Multi-Format JSON Normalizer

- **Ultra-Flexible Provider Importer (`app/providers.py` & `static/index.html`)**:
  - Automatically parses arrays (`[...]`), object mappings (`{"openai": {...}}`), and wrapped dictionaries (`{"providers": [...]}`, `{"data": [...]}`).
  - Resolves alternative key names: `base_url`/`baseUrl`/`endpoint`/`api_base` -> `url`, `api_key`/`token`/`secret` -> `apiKey`, `api_keys`/`tokens` -> `apiKeys`.
  - Normalizes string-based models lists (e.g. `["gpt-4o", "claude-3-5-sonnet"]` or `"gpt-4o, gpt-4-turbo"`) into valid `ModelSpec` objects.
  - Cleans markdown code fences (````json ... ````), Persian/Unicode smart quotes (`“”„«»`), and single-quote Python dictionaries via `ast.literal_eval`.
  - Added automated test cases in `test_agent_suite.py` covering multi-format import scenarios.

## 0.16.1 - Resilient Host Deployment, Python Detection & Environment Port Auto-Binding

- **Deployment Script Pipefail Fix in WebConsole (`webconsole.php`)**:
  - Implemented safe sequential `which` bash wrapper in deploy step templates to prevent CentOS/cPanel `which` exit code 10 from failing under `set -o pipefail`.
  - Added robust Python virtualenv creation helper (`python_venv_safe()`) with automatic `--without-pip` fallback and versioned `get-pip.py` bootstrapping.
  - Automatically exported extended `PATH` containing EA4 Python (`/opt/cpanel/ea-python*`), CloudLinux Alt-Python (`/opt/alt/python*`), and user local bin paths in `proj_runtime_env()`.
- **Dynamic Port & Host Binding in Python Agent Runner (`agent-python/main.py`)**:
  - `agent-python/main.py` dynamically binds to `PORT` (default 8787 or WebConsole configured port like 8788) and `HOST` (default `0.0.0.0`) from environment variables.

## 0.16.0 - Step Checkpointing & Resume, Smart Cross-Provider Fallback & Exponential Backoff Retry Loop

- **Step Checkpointing & Seamless Resume**:
  - Checkpoint persistence after every step of agent execution, tool call, and file save event (`conversation_checkpoints` SQLite table).
  - Checkpoints store full accumulated reasoning, conversation chat history, saved files metadata, execution results, and execution status.
  - Seamless resumption upon reconnect or session reload: Automatically loads the latest conversation checkpoint and continues from the exact interrupted step without restarting from scratch.
  - Emits real-time `checkpoint_resumed` SSE events notifying the user of successful step continuation.
  - Dedicated checkpoint API endpoints: `GET /api/conversations/{id}/checkpoints`, `GET /api/conversations/{id}/checkpoints/latest`, and `DELETE /api/conversations/{id}/checkpoints`.
- **Smart Fallback on Rate Limit (429) & Quota Exhaustion (402)**:
  - Immediate detection of rate limits (HTTP 429), quota limits (HTTP 402), billing or insufficient credit errors.
  - Enhanced candidate selection with `prefer_different_provider=True` in `get_verified_fallback_candidates()` to prioritize verified alternative providers over secondary models on the same overloaded provider.
  - Emits live `model_switched_rate_limit` SSE events in the chat stream displaying previous and newly activated provider/model pairs.
- **Exponential Backoff Retry Timer for Network Drops & Timeouts**:
  - Resilient retry loop ($1s, 2s, 4s, 8s, 16s...$ up to 10 attempts) for network disconnects, TCP drops, server gateway timeouts (502, 503, 504), and transient connectivity drops.
  - Emits live `retry_countdown` SSE events displaying real-time attempt counter and countdown timer directly in the chat message stream.
  - Dedicated UI badges for retry timer (`.retry-countdown-badge`), model switch notices (`.model-switch-badge`), and checkpoint resumption (`.checkpoint-resumed-badge`).
- **Test Suite Expansion**: Added automated pytest verification for checkpoint CRUD, streaming checkpoint resumption, smart rate-limit provider switching, and exponential backoff retry loops (39/39 tests passing).

## 0.15.0 - PHP Scripting & Execution Support, Arena Agent Structured Agentic Coding Workflow & Collapsible Step Drawers

- **PHP Language & Execution Engine Support**:
  - Full support for writing, editing, auto-detecting, previewing, and executing PHP scripts (`.php`, `clean_lang == "php"`, `<?php ... ?>`).
  - PHP execution integrated in `/api/workspace/execute`, workspace file runner, and self-healing execution loop (`php '{filename}'`).
  - Added dedicated PHP file icon (`🐘`), syntax highlight mapping, and one-click "Save to Workspace" preset in chat code blocks.
  - Full-screen Live Execution modal support with PHP CLI runtime output inspector.
- **Arena Agent 4-Stage Structured Coding Workflow**:
  - **1. Goal & Intent Announcement (اعلام هدف و رویکرد)**: The agent begins by explicitly declaring its objective and planned strategy.
  - **2. Step-by-Step Work Plan (برنامه کاری مرحله‌ای)**: Explicit numbered execution roadmap (`### 📋 برنامه کاری (Work Plan)`) presented in a prominent highlighted workplan card.
  - **3. Collapsible Step Execution Drawers (کشوهای تاشوی مرحله‌ای)**:
    - Multi-step execution details, intermediate results, tools executed, and error tracebacks are encapsulated inside clean collapsible accordion drawers (`<details class="agent-step-drawer" open>`).
    - Interactive summary bar (`<summary class="agent-step-summary">`) with numbered step badges, title, expandable/collapsible toggle chevron, and live status badges (`✅ تکمیل شد (Done)`, `⏳ در حال انجام (Running)`, `⚠️ اصلاح خودکار (Healed)`).
    - Allows users to collapse or expand individual steps at will to keep the conversation clean, readable, and structured exactly like Arena Agent.
  - **4. Accomplishments & Deliverables Summary (خلاصه کارهای انجام‌شده)**:
    - Clean concluding report (`### 🏁 خلاصه کارهای انجام‌شده (Accomplishments)`) summarizing all files created, tests run, and verified results.
- **Test Suite Expansion**: Added automated pytest verification for PHP file auto-detection and execution command routing, as well as Arena Agent workflow system prompt requirements (34/34 tests passing).

## 0.14.0 - Autonomous Code Execution & Self-Healing Loop, Full-Screen Execution & Live Render View

- **Autonomous Code Execution Engine**: After the agent generates or updates code files in the workspace (Python, Bash/Shell, Node.js, TypeScript, or HTML), the platform automatically executes the code inside the active workspace environment.
- **Self-Healing Error Correction Loop**: Automatically inspects exit codes, standard output, and standard error tracebacks. If an error or exception occurs (Exit Code != 0), the full error traceback is immediately fed back into the LLM context with a diagnostic prompt. The agent analyzes the failure, fixes all identified bugs, saves the updated file, and re-executes in an autonomous repair loop (up to 3 iterations) until the code runs cleanly with Exit Code 0 and produces valid output.
- **Real-Time Streaming Self-Healing Feedback**: Yields live SSE events (`execution_running`, `execution_fixing`, `execution_healed`, `render_preview_ready`, and `execution_result`) so users observe the autonomous execution, traceback analysis, and self-healing progress in real time directly within the chat message stream.
- **Dedicated Full-Screen Execution & Live Render Modal (`#fullScreenRenderModal`)**:
  - Full-screen distraction-free interactive viewer for both script execution and live web rendering.
  - **Responsive Device Viewport Switcher**: Instantly simulate live web apps on **Desktop (100%)**, **Laptop (1024px)**, **Tablet (768px)**, and **Mobile (375px)** inside an isolated sandboxed iframe.
  - **High-Contrast Dark Terminal Console**: Displays command executed, duration in milliseconds, exit code badge (`Exit 0 (Success)` / `Exit 1 (Failed)`), syntax-colored stdout, and highlighted stderr/tracebacks.
  - **Side-by-Side Code Split View & Live Editor**: Toggleable source code inspector with live line counter, allowing inline code edits and 1-click **"💾 ذخیره و اجرا (Save & Re-run)"** or `Ctrl+Enter` shortcut execution.
  - Quick action controls: `▶️ اجرای مجدد (Run / Rerun)`, `🔄 بازخوانی (Reload Preview)`, `📋 کپی (Copy Output)`, `📥 دانلود (Download)`, and `✕ بستن (ESC)`.
- **Integrated Full-Screen Entry Points**: Added one-click `⛶ تمام‌صفحه` launch buttons across Chat execution feedback cards, the Session Folder Explorer view, Workspace file cards, and the Advanced File Inspection modal.
- **Test Suite Expansion**: Added automated pytest verification for code file metadata extraction, script execution with traceback capture, HTML live preview generation, autonomous self-healing execution loops, and streaming SSE repair events (32/32 tests passing).

## 0.13.0 - True Real-Time LLM Token Streaming, Network Resilience & Simplified Project Creation

- **True Upstream Real-Time LLM Token Streaming**: Implemented native token streaming (`stream_call_provider_api` and `stream_complete_chat`) connecting directly to upstream provider SSE streams (OpenAI-compatible, OpenRouter, Anthropic, Ollama, Groq, Mistral). Tokens and reasoning traces (`<think>...</think>`) stream to the browser in real time without buffering delays, eliminating long HTTP blocking and socket timeouts.
- **Resolution of "Request Failed: network error"**: Resolved the 95% chat failure rate by adding anti-buffering reverse proxy headers (`X-Accel-Buffering: no`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`), adaptive proxy-to-direct fallback, and resilient error recovery with 1-click retry (`🔄 تلاش مجدد`).
- **Live Tool Progress Indicator**: While the agent executes workspace file or terminal tools between streaming steps, real-time status indicators (`⚙️ در حال اجرای ابزار ...`) provide continuous live feedback so connections never appear frozen.
- **Simplified 1-Click Project Creation**: Redesigned the New Project creation modal to be fast and effortless. Users only need to enter the Project Name (and optional short description) for instant 1-click creation. All non-essential, tedious parameters (Default Provider, Default Model, Default Target Branch, Custom System Instructions, Agent Rules) have been moved into a clean, collapsible **"⚙️ تنظیمات پیشرفته و اختیاری"** drawer with smart defaults.
- **Test Suite Expansion**: Added automated pytest verification for true SSE streaming headers and 1-click project creation with minimal fields (27/27 tests passing).

## 0.12.0 - Session Workspace Folder View, Advanced File Modal, Execution Engine & Universal Proxy Gateway

- **Intuitive Session Workspace Folder Explorer View**: Files created by the AI agent in the chat session's dedicated workspace (`session_{convId}`) are now displayed in a clean, standard folder & file explorer view with file type icons, formatted sizes, extensions, search filtering, and quick action chips (`▶ اجرا`, `🔍 باز کردن`, `📥 دانلود`, `🗑️ حذف`).
- **Advanced Workspace File Details, Edit & Execution Modal**: Clicking any file card or item opens an advanced modal featuring:
  - Full file metadata (relative path, formatted size, MIME format).
  - Code Editor with line numbers, line/character counters, syntax editing, and direct save capability.
  - Multi-format Live Preview for HTML (iframe sandbox), Markdown (rendered HTML), Image viewer, CSV data table, Audio player, Video player, and PDF viewer.
  - Interactive Action Toolbar: `▶️ اجرا (Run)`, `💾 ذخیره (Save)`, `👁️ پیش‌نمایش (Preview)`, `📝 کد منبع (Source Code)`, `📋 کپی (Copy)`, `📥 دانلود (Download)`, `✨ ارجاع در چت (Explain in Chat)`, and `🗑️ حذف (Delete)`.
  - Built-in Execution Console Drawer displaying real-time command execution, exit codes (`Exit 0`), latency (`XXms`), stdout, and stderr with copy and clear actions.
- **Session Workspace Execution Routing & Path Traversal Fix**: Resolved file execution path traversal and `Failed to fetch` errors by introducing automatic session workspace activation via `conversation_id`, directory-aware execution, and handling for both relative and absolute paths.
- **Interactive Model Test Details & Diagnostics Modal**: Clicking any row in the Model Health & Latency Test Results table opens a dedicated diagnostics modal displaying full model information, the exact request sent (masked headers and JSON payload), direct and proxy-routed endpoints, rendered assistant response and reasoning traces, and the full raw JSON response with 1-click copy actions and live retesting.
- **Universal Proxy Traffic Routing for Model Responses**: Fixed proxy routing to support both standard forward proxies (`http://...`, `https://...`, `socks5://...`, `socks5h://...`) via HTTP client tunneling (`httpx.AsyncClient(proxy=...)`) and URL-rewriting gateways (like Cloudflare Workers `?url={url}` or `/proxy?target=`). Includes adaptive direct retry fallback on connectivity errors.
- **Dedicated Proxy Server Configuration**: Integrated first-class Proxy Server settings with default `https://proxy.fazilat-ma.workers.dev/?url={url}` for seamless routing of model endpoints, web searches, and browser operations; supports live connection testing and instant default reset.
- **Copy All AI Model Test Results**: Added 1-click export and copy actions for all AI model diagnostic tests in both structured Markdown Table and JSON formats, complete with status indicators, latency metrics, and diagnostic traces.
- **Test Suite Expansion**: Added automated pytest verification for session workspace folder listing, file execution routing, proxy configuration, forward proxy client parsing, and testing endpoints (25/25 tests passing).

## 0.11.0 - RTL Persian Typography, Isolated LTR Terminals, Message Sync & Edit Lifecycle

- **Enriched File Management & Explorer**: Added one-click creation for files and folders (`+📄`, `+📁`), file renaming, deletion, file tree real-time fuzzy search filter, and full workspace zip archive export (`/api/workspace/export-zip`).
- **Tabbed Code Editor**: Multi-tab document management with unsaved change indicators (`*`), line & character stats, `Ctrl+S` quick save shortcut, and direct "Explain in Chat" context transfer.
- **Chat Prompt Presets & History**: Added 6 one-click preset prompt chips (*Refactor Code*, *Write Unit Tests*, *Fix Bugs*, *Security Audit*, *Optimize Speed*, *Explain Code*), `@file` context attachment chip, multi-turn threaded conversation manager (save, switch, delete), and per-message copy buttons.
- **ChangeSet Reviews & Patch Export**: Support for toggling Diff view modes (Unified / Split), custom rejection feedback notes passed directly back into the agent context, unified `.patch` file export, and instant rollback.
- **Terminal History & Quick Action Chips**: Interactive Up/Down arrow key command history navigation, quick action preset chips (`pytest -v`, `git status`, `ls -la`, `pip list`, `python -V`, `df -h`), copy terminal output, and active process management with kill switch.
- **Git Version Control Upgrades**: Branch manager with new branch dialog, stash changes and pop stash controls, and visual commit log viewer.
- **Playwright Browser JS Evaluation**: Support for running arbitrary JavaScript expressions directly in active browser sessions alongside live DOM and screenshot previews.
- **Observability Export**: Added one-click export for system logs in both JSON and CSV formats.

## 0.7.0 - UI Navigation, Model Selection Persistence & Universal Auto-Save

- **Prominent Hamburger & Navigation Button**: Added an always-visible hamburger menu button (`☰`) in the top navigation bar and sidebar header for quick access across both desktop and mobile layouts.
- **Persistent Model & Provider Selection**: Selected provider and model are automatically saved to `localStorage` and preserved across page refreshes, preventing unwanted resets to previous defaults.
- **Universal Auto-Save**: Project configuration, custom instructions, agent rules, and environment secrets auto-save in real time as changes are typed, with a visual `✓ Auto-saved` status indicator.
- **Direct Settings Shortcut**: Quick `⚙️ Settings` button in top bar for instant access to security and configuration.
- **Provider & Model Catalog UI**: Full provider and model catalog view with live endpoint testing, JSON file and text import/export, and circuit breaker resets.

## 0.6.0 - Project Definitions & Unrestricted External Access

- **Project Management Engine**: Full project configuration with name, description, path, default provider, default model, default branch, custom system prompt instructions, agent rules (`.agentrules`), environment variables, and quick commands.
- **Project Settings in UI**: Dedicated Project Settings tab with live configuration editor, project switcher, creation dialog, and active project indicator.
- **Unrestricted Web & External Access**: Removed external sandbox barriers, allowing Playwright browser and terminal executions full access to any external websites, APIs, pip packages, git remotes, and curl commands.
- **Dynamic System Prompt**: Chat loop dynamically incorporates active project description, custom guidelines, and behavioral rules.
- **Automated Tests**: Added project CRUD and configuration tests.

## 0.5.0 - Arena Agent Full Suite & Diff Approval Engine

- **Phase 1: Full Authentication & Security**: Multi-user SQLite storage, PBKDF2 password hashing with salt, Session token management, RBAC (Admin, Developer, Viewer), Security audit logging, Token masking in logs, Rate limiting, CSRF protection.
- **Phase 2: Persistent Worker & Job Queue**: Concurrency semaphore with restart crash recovery, Cancel/Pause/Resume/Retry workflow, Step timeline, Job outputs persisted to disk, Prune old jobs.
- **Phase 3: Professional Code Editor**: Project tree, Tabbed editor, Line numbering, Unified diff preview, Dirty change tracking, UTF-8/LF status.
- **Phase 4: Change Set & Approval System**: Unified & Side-by-side diff generation, Multi-file Changeset staging, In-chat inline Diff Cards with Approve/Reject actions, Rollback snapshots and Historical Version comparison.
- **Phase 5: Sandboxed Terminal**: Workspace-confined subprocess supervisor, Docker container sandbox support, Dangerous commands blocklist and confirmation, Active process tracking and kill switch.
- **Phase 6: Full Git Version Control**: Branch switching/creation/deletion, Staging, Stash/Apply, Merge conflict resolver, Push confirmation.
- **Phase 7: GitHub Workspace**: Repositories, Branches, Pull Requests (Create, Review, Merge), Actions and Issues management.
- **Phase 8: Playwright Browser Automation**: Multi-tab Chromium sandbox, DOM text extraction, Screenshot capture.
- **Phase 9: Arena Modern UI**: Collapsible sidebar, Mobile drawer, Command Palette (`Ctrl+K`), Dark/Light themes, In-chat interactive cards, Active Provider/Model indicators.
- **Phase 10: Live Chat Streaming**: Server-Sent Events (SSE) streaming token generation, In-chat tool call timeline, Stop streaming controls.
- **Phase 11: Multi-Protocol Providers**: OpenAI-compatible, Anthropic, Gemini, Ollama, Mistral native adapters, Multi-key rotation, Circuit Breaker, Model health testing.
- **Phase 12: Secrets Encryption & Proxy**: Master Key AES-256 encryption at rest, Key masking, SSRF-safe proxy support.
- **Phase 13: Observability & Logs**: Structured logging ring buffer, System metrics (CPU, RAM, Disk, Active jobs), Log level and search filtering.
- **Phase 14: Workspace Management**: Multi-workspace switcher, Templates (FastAPI, React/Vite, Python CLI, Node), Instructions and `.agentrules`.

## 0.4.0 - Connector Enhancements

- Added GitHub repository and file browsing.
- Added HTTP fetch connector.
- Added session cookies.

## 0.3.0 - Agent Chat Foundation

- Added provider-routed chat API and basic tool loop.
- Added workspace file tools and terminal execution.

## 0.2.0 - Management Console

- Added provider/model dashboard and CRUD.

## 0.1.0 - Foundation

- Initial FastAPI architecture.
