# Changelog

## 3.3.24 - Model test button no longer blocks a single HTTP request for minutes (same class of fix as auto-repair's 3.3.20)

### Fixed
- Applying the same debugging method used for the `/api/localai/auto-repair` fix (3.3.20) to the "تست" (test) button next to every installed model: `POST /api/localai/test` previously called `benchmark_test()`/`benchmark_llamacpp()` *synchronously* inside the request handler and only returned once the whole test finished. Live testing after the 3.3.22/3.3.23 fixes confirmed a real cold-model test on a loaded host can take well over 2-3 minutes just to load the weights and start generating -- a request held open that long risks the browser, any reverse proxy, or the hosting panel's own proxy killing the connection with a confusing 502/504 long before the Python code itself finishes, indistinguishable from the server actually being broken.
- `POST /api/localai/test` now starts the test in a background daemon thread and returns immediately (`{"ok": true, "started": true}`), guarded against two tests racing each other at once (mirrors `start_auto_repair_async()`'s same lock).
- New `GET /api/localai/test/last` polls for the in-progress/final result, so the real outcome (success + tokens/sec, or a real error with log tail) is always reachable no matter how long the underlying test actually takes.
- Updated the model list's "تست" button to start the test then poll every 2s (showing elapsed seconds on the button itself) instead of awaiting one single long-lived fetch.
- The `/api/localai/import` flow's own benchmark step was already safe (it already runs inside that endpoint's existing background job thread from 3.3.? and a benchmark failure there was already non-fatal to the import) -- no change needed there.
- 99 backend tests passing (2 new regression tests covering the background-thread-and-overlap-guard behavior and persisted-failure polling).

## 3.3.23 - Diagnostic benchmark test timeout raised to match the real chat path (fixes false-negative after the 3.3.22 fix)

### Fixed
- Verified live on the production host after 3.3.22: with the truncated-download bug fixed, Ollama now downloads the full, correctly-sized archive, `llama-server` is present, and it genuinely loads the GGUF model tensors (confirmed in the runner's own log: `load_tensors: loading model tensors...`, `llama_context: constructing llama_context`, etc. -- this is real llama.cpp model-loading output, not a stub). However, the built-in `/api/localai/auto-repair` diagnostic "test" step (`benchmark_test()`) still reported `{"ok": false, "error": "timed out"}`, because its HTTP client used a hardcoded 60s timeout while a completely cold model (nothing yet loaded in Ollama's runner) can legitimately take longer than that to load plus run its one-time warm-up pass, especially under host load. This was a false negative in the diagnostic only -- the real `/api/chat` and `/api/generate` paths used by actual chat messages already default to a more generous ~120s provider-level timeout and were never affected by this specific limit.
- `benchmark_test()`'s request timeout raised from 60s to 180s to match (and exceed) that real-path timeout, so the built-in diagnostic no longer falsely reports a healthy, correctly-installed model as broken just because the very first load took a bit longer than an arbitrary 60s guess.
- 97 backend tests passing.

## 3.3.22 - Real root cause found and fixed: truncated ~1.4GB Ollama download silently installed as "healthy"

### Fixed
- **This is why Ollama was reportedly "installed and running" but every actual chat/generate call still failed with "llama-server binary not found".** The official `ollama-linux-amd64.tar.zst` release asset is ~1.4GB (confirmed via the GitHub API: 1,427,765,407 bytes for v0.35.0). On a slow/flaky connection, a download can get cut short yet still pass the old, naive ">1000 bytes" sanity check -- the small top-level `ollama` binary (which appears early in the archive) extracts and runs fine, while the much larger `lib/ollama/` payload (which contains the `llama-server` runner every single model load actually depends on) is incomplete. The server then starts, responds to `/api/version`/`/api/tags` normally, and was reported "healthy" -- but every real generate call failed.
- `_runtime_is_healthy()` now requires the actual `lib/ollama/llama-server` file to exist, not just that the `lib/ollama` directory is non-empty (a truncated extraction can still leave *some* other file behind).
- `install_runtime()` now explicitly fails with a clear Persian error if `lib/ollama/llama-server` is missing after extraction, instead of reporting `{"ok": true}` on a broken install.
- Download validation: when the GitHub release API reports an asset's real size, every download candidate for that filename (including the hardcoded mirror fallbacks, not just the API-discovered URL) is now checked against it; a size mismatch is treated as a failed candidate instead of being silently accepted.
- Large files (>50MB) now get a much longer overall download timeout (45 min, up from 5 min) -- confirmed live that a real install can legitimately take ~18 minutes on a slow-but-working connection, and the stricter 3.3.21 timeout could have aborted a transfer that was actually still making progress. The `--speed-limit`/`--speed-time` stall-detector (3.3.16) still independently aborts a truly dead/stalled connection in ~20-35s regardless of this larger cap, so this does not reintroduce the original indefinite-hang risk.
- curl (`-C -`) and wget (`-c`) now resume a previous partial download of the same URL instead of restarting from byte 0 -- a partial file from a timed-out attempt is now kept on disk (not deleted) specifically to make this possible.
- Added regression tests `test_install_runtime_rejects_truncated_download_by_size_mismatch` and `test_install_runtime_fails_loudly_when_llama_server_runner_missing_after_extraction`; updated `test_runtime_is_healthy_detects_missing_ollama_lib_dir` and `test_install_runtime_preserves_ollama_lib_dir_when_binary_found_via_rglob` for the stricter check.
- 97 backend tests passing.

## 3.3.21 - Added a hard Python-level subprocess timeout as a backstop for curl/wget downloads

### Fixed
- Even after 3.3.20 moved auto-repair into a background thread (ruling out the worker-process-killed theory), live polling on the real affected host still showed the exact same download candidate stuck for 380+ seconds -- well past curl's own `-m 300` cap plus the `--speed-limit`/`--speed-time` stall detection added in 3.3.16. This means curl's own internal timeout enforcement was not reliably firing on that host's curl build/platform for whatever reason (undetermined without shell access to that host). Every `subprocess.run()` call in the download loop (curl and wget) now also passes an explicit Python-level `timeout=` (330s for curl, 45s for wget), so `subprocess.run()` itself force-kills a runaway child process as a backstop that does not depend on the child binary's own timeout flags actually working correctly.
- Added regression test `test_install_runtime_download_has_hard_python_level_subprocess_timeout` asserting every download subprocess call carries an explicit hard `timeout=`.
- 95 backend tests passing.

## 3.3.20 - auto-repair now runs in the background instead of blocking the HTTP request (root cause of the real stuck install)

### Fixed
- Root-caused, with real production telemetry, why a live Ollama auto-repair attempt on a real host appeared to freeze forever at the exact same log line no matter how long it was polled (even well past curl's own `-m 300` + `--speed-limit`/`--speed-time` abort window from 3.3.16): `POST/GET /api/localai/auto-repair` ran the entire diagnose→install→start→test flow *synchronously inside the HTTP request handler*. A multi-minute engine download can outlive that host's own request/worker timeout -- and when it does, the timeout doesn't just drop the client's connection, it kills the *entire backend worker process*, taking the in-flight curl/wget child down with it mid-transfer. With the worker dead, nothing could ever call `_log()` again, so the persisted `auto-repair/last` state froze permanently on whatever line was last written -- indistinguishable from the app hanging, but actually an artifact of how the request was being run, not a networking or download-logic bug.
- `/api/localai/auto-repair` now starts the real work in a background daemon thread via the new `start_auto_repair_async()` and returns immediately with `{"ok": true, "started": true}` -- a daemon thread's lifetime is tied to the whole process, not to any single HTTP request, so it keeps running (and keeps updating `auto-repair/last`) even if the triggering request's own connection/timeout is long gone. A second call while one is already running is now rejected with a clear Persian error instead of racing two installs against each other.
- Poll `GET /api/localai/auto-repair/last` for both live progress and the final outcome, same as before -- only the *triggering* call's response shape changed (no frontend code depended on the old synchronous shape).
- Added regression tests `test_start_auto_repair_async_runs_in_background_and_guards_against_overlap` and updated `test_auto_repair_endpoint_accepts_both_get_and_post` for the new async-start response shape.
- 94 backend tests passing.

## 3.3.19 - auto-repair/last now shows live install progress (which candidate URL, per-candidate failures) mid-download

### Fixed
- `install_runtime()` runs as a single blocking call inside `auto_repair()`'s "install" step, with no visibility into its internal multi-candidate-URL/multi-method (curl/wget/urllib) download loop until it fully finishes or raises. This made `GET /api/localai/auto-repair/last` show nothing new for the entire duration of a slow (but actually-progressing) install -- indistinguishable from a true hang when polled live, which is exactly what happened while live-debugging a real stuck Ollama install this session. Every `log_fn` message `install_runtime()` already emits internally (e.g. "Downloading ollama runtime from <url>...", "Download candidate failed (...), trying next candidate...") is now mirrored into the persisted state's in-progress `install` step (`ok: null`, with a rolling `log` tail of the last 20 lines) as it happens, so polling mid-install shows exactly which URL/method is being attempted right now instead of silence.
- Added regression test `test_auto_repair_persists_live_install_log_mid_step` asserting the persisted state is updated *during* `install_runtime()`, before it returns.
- 93 backend tests passing.

## 3.3.18 - Network probe now tests the actual release-asset CDN hostname, not objects.githubusercontent.com

### Fixed
- The 3.3.17 reachability probe tested `objects.githubusercontent.com` (raw git blobs/LFS), but every GitHub Releases `browser_download_url` -- what `install_runtime()`'s download candidates actually redirect to -- is served from the separate `release-assets.githubusercontent.com` hostname. On the real affected host this was found on, `github.com`/`api.github.com` and even `objects.githubusercontent.com` all probed fine while the actual release-asset CDN was the one with the problem, which the old probe list could never have caught. `release-assets.githubusercontent.com` is now probed explicitly (keeping `objects.githubusercontent.com` too, since it's still informative).
- 92 backend tests passing (no behavioral test changes needed beyond the existing diagnose-shape test).

## 3.3.17 - diagnose_full() now reports tool availability + a direct GitHub/ollama.com reachability probe

### Added
- `GET /api/localai/diagnose` now also returns `tools` (whether `curl`/`wget`/`unzip`/`tar`/`zstd`/`unzstd`/`ldd` are actually present on the host -- the download/extraction code silently falls back through several of these, so it was previously impossible to tell from the outside which path was actually being used) and `network` (a direct, bounded ≤8s-per-target HEAD-request reachability probe against `github.com`, `api.github.com`, `objects.githubusercontent.com`, and `ollama.com` -- the exact hosts engine downloads depend on). Added after discovering, live on a real affected host, that an engine install can get stuck for many minutes with no visible cause; this makes a genuine network/CDN connectivity problem (as opposed to a code bug) directly visible in one diagnostic call instead of only inferable from a stuck install.
- Verified with the full existing suite (the diagnose endpoint test now also asserts these two new fields are present). 92 backend tests passing.

## 3.3.16 - Fixed engine downloads hanging for up to 5 minutes per candidate on filtered/sanctioned networks

### Fixed
- **Discovered live on a real affected host** (via the new `/api/localai/auto-repair` endpoint from 3.3.15): `install_runtime()`'s `curl` download could hang for the *entire* 5-minute (`-m 300`) timeout on every single download candidate before failing over to the next one, making one install/repair attempt potentially take 20+ minutes. Root cause: on some networks (e.g. sanctioned/filtered hosting), `github.com` itself is reachable, but the actual release-asset CDN it redirects to (`release-assets.githubusercontent.com`) can be silently black-holed -- the TCP/TLS connection succeeds and curl's `--connect-timeout` never triggers, but essentially zero bytes ever actually flow.
- `curl` is now invoked with `--speed-limit 1024 --speed-time 20`, which aborts a download as soon as its sustained transfer rate drops below 1 KB/s for 20 seconds -- a genuinely dead/filtered candidate now fails over to the next one in ~20-35s instead of hanging for 5 minutes, while a merely slow (but actually progressing) connection is left alone up to the full timeout.
- Verified with a new regression test asserting every `curl` invocation includes the `--speed-limit`/`--speed-time` flags, plus the full existing suite. 92 backend tests passing.

## 3.3.15 - Added one-shot Local AI diagnostics/repair API endpoints (GET /api/localai/diagnose, GET+POST /api/localai/auto-repair)

### Added
- **`GET /api/localai/diagnose`**: a single read-only call that returns a full snapshot of the Local AI subsystem -- hardware, both engines' install/health/ABI-incompatibility status (including the `lib/ollama` runner-directory check added in 3.3.14), the active engine's running state, its recent log tail, the installed-models list, and a plain-language `recommendation` field -- instead of having to cross-reference the hardware page, the runtime status endpoint, the logs endpoint, and the troubleshooting modal separately to diagnose a broken setup.
- **`GET`/`POST /api/localai/auto-repair`** (`engine`, `model` query params): runs the full "switch engine -> (re)install -> start -> benchmark-test" sequence in one call and returns a step-by-step report of exactly what happened (and where it stopped, if something failed) -- the four separate UI actions/screenshots this used to take collapse into one request/response. Registered under both GET and POST so it can be triggered from a single URL fetch for quick remote diagnosis/repair, not just from a UI button.
- Both endpoints reuse the existing `require_viewer`/`require_admin` role checks, so they behave identically to every other Local AI endpoint on deployments where authentication is enabled.
- **`GET /api/localai/auto-repair/last`**: `auto_repair()` now persists its progress to the database after every single step (select-engine/install/start/test), not just once at the very end -- so if the original call is slow (e.g. downloading a large engine archive over a slow link) and its HTTP response never reaches the caller (a client-side timeout), this endpoint can still report what actually happened/is happening via a fast, separate, read-only GET.
- Verified with 7 new regression tests (`/api/localai/diagnose`'s response shape, `_engine_health_report()` surfacing an ABI incompatibility, `auto_repair()`'s full step sequence on success, `auto_repair()` stopping cleanly and reporting the failed step when install fails, the `/api/localai/auto-repair` endpoint accepting both GET and POST, `auto_repair()` persisting progress after every step, and `/api/localai/auto-repair/last` exposing that persisted state). 91 backend tests passing.

## 3.3.14 - Fixed "llama-server process has terminated: exit status 1" when Testing an Ollama model (wrong runner picked up via a shared PATH)

### Fixed
- **Testing an installed Ollama model (or loading any model at all) could fail with the generic**
  ```
  HTTP 500 Internal Server Error: llama-server process has terminated: exit status 1
  ```
  **on a host where the llama.cpp engine was also ever installed.** Root cause: official Ollama release tarballs ship their own, separate, matching-glibc-target `llama-server`-style runner under `lib/ollama/` next to the `ollama` executable, which Ollama discovers via a path *relative to its own binary* -- never via `PATH`. This app's `server_env()` was unconditionally putting the shared engine `bin_dir()` on `PATH`/`LD_LIBRARY_PATH` for *every* subprocess it launched, including `ollama serve`. If Ollama's own runner-discovery ever fell back (or the `lib/ollama` directory was never carried over from an older install), it would find -- and crash on -- the llama.cpp engine's *differently built, ABI-incompatible* `llama-server` sitting in that same shared `bin_dir()`, producing this exact generic, unhelpful crash message instead of any real diagnosis.
- `server_env()` now only injects `bin_dir()` into `PATH`/`LD_LIBRARY_PATH` for the llama.cpp engine; the Ollama engine always relies on its own internal, relative-path runner discovery. **This requires restarting the Ollama engine once** (Stop then Start, or reinstall) for an already-running `ollama serve` process to pick up the corrected environment.
- `install_runtime()`'s Ollama branch now also preserves the archive's sibling `lib/ollama/` runner directory (copying it to `root_dir()/lib/ollama`), not just the bare `ollama` executable, as a defense-in-depth against unexpected archive layouts that need its `rglob()` fallback-discovery path.
- Added a health check (`_runtime_is_healthy()`) that treats an Ollama install as broken/needing repair if `root_dir()/lib/ollama` is missing or empty, even when the `ollama` binary itself looks fine -- so an existing, already-broken install (made before this fix) gets automatically repaired the next time it's (re)installed or (re)started, instead of silently reporting itself as healthy forever.
- `benchmark_test()` (the "Test" button's backend) now scans the engine's own captured crash log for the glibc/libstdc++ ABI-mismatch signature (already detected proactively for llama.cpp since 3.3.10) and, when found, replaces the generic Ollama error with the same kind of clear, actionable Persian diagnosis -- correctly worded for Ollama's own bundled runner this time, since the old llama.cpp-engine wording ("switch to Ollama instead") would be actively wrong advice when Ollama's own runner is the one that's incompatible.
- Verified with 4 new regression tests: `server_env()` never puts `bin_dir()` on `PATH`/`LD_LIBRARY_PATH` for the ollama engine (while still doing so for llamacpp); `_runtime_is_healthy()` flags a missing/empty `lib/ollama` as broken; `install_runtime()` preserves `lib/ollama` via the `rglob()` fallback path; and `benchmark_test()` surfaces the correct ABI diagnosis (mentioning Ollama, not recommending "switch to Ollama") from a captured crash log. 84 backend tests passing.

## 3.3.13 - Added Stop + Copy-all-logs to the "حالت تشخیص عیب" (Diagnostic/Debug Mode) Network inspector

### Added
- The Network-tab-style debug/diagnostic modal (opened via the floating "🛰️ Network" button mid-stream, or "🛰️ Network (N)" on a past message) now has two more footer buttons alongside the existing "📋 Copy Selected":
  - **"⏹ توقف"** -- stops the in-progress request straight from the inspector, using the same real client-abort + server-side `/api/jobs/{id}/cancel` path as the chat's own Stop button (`stopStreaming()`), instead of requiring the user to close the modal first. If there's no in-progress request (e.g. the modal is showing a past, already-finished turn), it tells the user there's nothing to stop instead of silently doing nothing.
  - **"📋 کپی همه لاگ‌ها"** -- copies *every* captured request/response for that turn in one JSON blob, not just whichever row happens to be selected, so the whole exchange can be pasted into a bug report/support ticket at once.

## 3.3.12 - Local AI troubleshooting: real Stop + Copy-all-logs controls, and the Test button now surfaces the engine's actual crash log

### Added
- A new **"🛠 عیب‌یابی هوش مصنوعی محلی"** troubleshooting modal, opened automatically whenever testing a local model, starting the engine, or an install job fails. It shows the short error message plus the **full raw stdout/stderr tail of the managed engine process** (`ollama.log` / `llamacpp.log`), and has two requested actions: **"⏹ توقف موتور"** (stops the Ollama/llama.cpp runtime immediately, for when it's hung or crash-looping) and **"📋 کپی همه لاگ‌ها"** (copies the context + error + full log tail to the clipboard in one go, for sharing with support) -- plus a "🔄 بروزرسانی لاگ" button to pull a fresh tail on demand.
- The install-status card (**"④ وضعیت نصب مدل"**) also got its own **"⏹ توقف"** and **"📋 کپی همه لاگ‌ها"** buttons directly under the progress bar, so a stuck/runaway install can be stopped and its full log (install-job log + engine log) copied without waiting for it to time out.
- Backend: new `local_ai.read_engine_log_tail(engine)` helper and `GET /api/localai/logs` endpoint expose the tail of the engine's own log file. `benchmark_test()` and `benchmark_llamacpp()` (the "Test" button's backend) now attach this tail as `logTail` on every failure response, so a bare `HTTP 500 Internal Server Error: llama runner process has terminated: exit status 1` (Ollama's own generic crash message, with no further detail) is immediately followed by the engine's real log -- e.g. the actual OOM/GPU/corrupt-model line that explains *why* it terminated -- instead of leaving the user stuck on a one-line, unactionable summary.

### Fixed
- **The new "⏹ توقف" button on the install-status card was not cosmetic-only**: `POST /api/jobs/{id}/cancel` previously only flipped the job's DB status to `cancelled`, but the actual install ran in a plain background thread that never checked that flag -- it kept downloading/installing to completion regardless and then silently overwrote the status back to `done`/`failed`. `run_install_task()` (`app/main.py`) now checks the cancellation flag between every stage and inside the GGUF/Ollama download progress callbacks, unwinds immediately once the user clicks Stop, and leaves the job's status as `cancelled` instead of clobbering it.
- Verified with 4 new regression tests: `read_engine_log_tail()` tailing behaviour (missing file, engine fallback via `get_state`, `max_chars` truncation); both `benchmark_test()` (Ollama) and `benchmark_llamacpp()` failure paths attaching the real `logTail`; the new `/api/localai/logs` endpoint; and an end-to-end test that starts a real install job with a mocked long-running download, cancels it mid-flight via the actual `/api/jobs/{id}/cancel` endpoint, and asserts the background thread stops before the simulated download finishes and the job is left `cancelled` (not silently overwritten). 80 backend tests passing.

## 3.3.11 - Added "حالت تشخیص عیب" (Diagnostic/Debug Mode): a DevTools-Network-tab-style inspector for every real chat request

### Added
- A new settings toggle, **"حالت تشخیص عیب" (Diagnostic/Debug Mode)**, in the Settings page (persisted client-side, same lightweight pattern as the existing theme/approval toggles). When enabled, every *real* outbound HTTP request/response exchanged with a provider after sending a chat message -- including retries, proxy→direct fallbacks, and the non-streaming last-resort fallback -- is captured and surfaced in a new DevTools-Network-tab-style modal: a master list of every actual network call for that turn (method, URL, status code, duration) and a detail pane with the full request headers/body and response headers/body for whichever call is selected.
- A floating "🛰️ Network" button appears in the chat toolbar while debug mode is on, showing a live request counter and opening the inspector mid-stream (not just after the turn finishes); completed turns also get a "🛰️ Network (N)" button in their message actions so past requests for that specific reply can be reviewed later, since the captured requests are now persisted as part of the chat history message (same way fallback/execution-result metadata already was).
- API keys and other secrets (`Authorization`, `x-api-key`, `api-key`, cookies) are always masked in the captured headers before they're ever sent to the frontend or stored, reusing the existing `mask_secret()` helper -- the real, unmasked credentials are still used for the actual outbound request, only the diagnostic *copy* is redacted. A "📋 Copy Selected" button lets a request's full captured detail be copied to the clipboard for sharing with support, consistent with this app's existing copy-button pattern for diagnostics.
- Backend: `call_provider_api()` and `stream_call_provider_api()` (`app/chat.py`) now accept an optional `debug_log` list; when provided, every actual HTTP attempt they make (success, non-2xx error, or a connection failure before any response arrived) appends one entry to it. `stream_call_provider_api()` additionally yields each entry as a new `{"type": "debug_request", ...}` chunk as soon as it's captured, which `stream_complete_chat()` (now accepting `debug: bool = False`) forwards straight through to its own SSE output. Because `app/worker.py`'s job-event loop already forwards every event type it receives verbatim, no changes were needed to the SSE/job plumbing itself -- only `chat_stream_endpoint` (to read a `debug` flag off the request into the job payload) and `_run_chat_job` (to read it back off the job and pass it into `stream_complete_chat`) needed a one-line change each.
- Verified with 3 new regression tests covering: a real end-to-end streaming call (via `httpx.MockTransport`) asserting the masked-header debug event is emitted with the correct method/URL/status/body; the equivalent for the non-streaming fallback path; and `stream_complete_chat(debug=True)` correctly forwarding `debug_request` events end-to-end while `debug=False` (the default) emits none and doesn't even ask the underlying call to capture them. Also manually verified against a real local HTTP server (not just mocked) that the real outbound request still carries the unmasked API key while only the captured diagnostic copy is redacted. 76 backend tests passing.

## 3.3.10 - Testing a Local Model on an Older Hosting Panel Looped on "Repairing" an Unfixable glibc/libstdc++ Incompatibility

### Fixed
- **Testing a small locally-imported model failed with a raw, scary dynamic-linker dump** instead of a real explanation, on hosting-panel environments running an older OS (e.g. a CentOS/RHEL-based panel):
  ```
  Local AI server did not become ready within 20s. Log:
  llama-server: /lib64/libstdc++.so.6: version `GLIBCXX_3.4.29' not found (required by .../libggml-rpc.so)
  llama-server: /lib64/libc.so.6: version `GLIBC_2.32' not found (required by .../libggml-rpc.so)
  ```
  Root cause: llama.cpp's official prebuilt binary is built against a recent Ubuntu's glibc/libstdc++ and simply cannot run at all on a host whose own system libraries are older -- this is a fundamental ABI incompatibility between that specific binary and the host OS, not a broken or incomplete install. Worse, the self-healing "broken binary" repair logic added in 3.3.8 (which is exactly right for a *missing* shared library) could not tell this apart from that case, so it would delete the "broken" binary and silently redownload... the exact same official, still-incompatible build, over and over, on every single activation attempt, each time burning a full download + extraction + ~20s readiness wait before failing with the identical raw error again.
- Added `_binary_abi_incompatibility_reason()`, which recognizes this specific "binary needs a newer glibc/libstdc++ symbol version than this host has" failure pattern (distinct from a plain missing `.so` file) via `ldd`, and short-circuits straight to a single clear, actionable error -- naming the exact missing version and explaining that reinstalling will never fix it -- instead of attempting a pointless repair loop. The message suggests concrete next steps: switch this model to the Ollama engine (far more portable across older distros), ask the host to update glibc, or supply a self-compiled `llama-server` via `AGENT_LLAMACPP_BIN` if build tools are available on the server.
- This check now runs at every point a llama.cpp binary is trusted: right after a fresh extraction, before reusing an already-installed one, and immediately before launching it in `start_server()`.
- Verified with 3 new regression tests: unit coverage of the glibc/libstdc++ detection pattern (including the negative cases -- a plain missing-file failure and a perfectly healthy binary must never be misclassified), a test confirming `install_runtime()` raises the actionable error immediately without attempting any network download, and a test confirming `start_server()` surfaces the error immediately without attempting to reinstall or launch the known-broken binary. 73 backend tests passing.

## 3.3.9 - Chatting With a Local AI Model Burned Through 4 Useless "Network" Retries Whenever Its Server Wasn't Already Running

### Fixed
- **Sending a message to a locally-imported Ollama/llama.cpp model showed a misleading retry countdown and then failed**, even on a perfectly healthy machine with no network problems at all:
  ```
  ⏳ تایمر تلاش مجدد (3/4): قطع ارتباط شبکه یا تایم‌اوت (ConnectError). تلاش مجدد در 4 ثانیه...
  ```
  Root cause: this app manages the Ollama/llama.cpp server process's entire lifecycle itself (installing it, launching it, keeping track of which model is loaded), but the chat engine never actually checked whether that process was still alive before trying to talk to it -- it just opened an HTTP connection straight to `127.0.0.1` and, if nothing was listening (the server was never started yet, had crashed, or was killed when the hosting container/process last restarted -- a detached child process does not necessarily outlive its parent's host environment), treated that exactly like a flaky network and burned through the full retry-with-backoff loop before finally giving up. No amount of retrying a connection to a port nothing is listening on could ever have succeeded.
- `stream_complete_chat()` and `complete_chat()` now check whether a local Ollama/llama.cpp provider's server is actually running *before* the first attempt, and start it automatically if it isn't -- turning a cold local model into either an instant, successful first reply, or (if the engine genuinely can't start, e.g. the shared-library bug fixed in 3.3.8, or no model is selected) a single clear, actionable error shown immediately instead of four rounds of a misleading "network disconnected" countdown first.
- This check is scoped tightly to providers this app actually manages itself (a loopback URL *and* an `ollama`/`llamacpp` protocol-or-vendor signal) so a provider pointing at a genuinely remote Ollama host, or at some other local server this app doesn't own (e.g. LM Studio), is never touched.
- Verified with 4 new regression tests covering the provider-detection logic, the start-only-when-down behavior, a full `stream_complete_chat()` run against a "cold" local model that now succeeds on the first attempt with zero retry events, and a run against a genuinely broken local install that now surfaces the real startup error immediately instead of retrying first. 70 backend tests passing.

## 3.3.8 - Importing/Activating a llama.cpp Model Failed Forever: "error while loading shared libraries: libllama.so: cannot open shared object file"

### Fixed
- **Importing a model found by the disk scanner (or activating/switching any llama.cpp model) failed with a raw, scary-looking error from the OS's dynamic linker**, not from this app or even from llama.cpp itself:
  ```
  llama-server: error while loading shared libraries: libllama.so: cannot open shared object file: No such file or directory
  ```
  Root cause: llama.cpp's official release archive ships `llama-server` next to the shared libraries it's dynamically linked against (`libllama.so`, `libggml*.so`, etc.) in the same folder, and the executable finds them via its own `$ORIGIN`-relative rpath (i.e. "look in my own directory"). `install_runtime()` only ever copied the single `llama-server` file itself out of that archive into this app's own `bin/` folder, leaving every `.so` file it depends on behind in the (then-discarded) extracted archive -- so the installed binary could never actually start, on any model, on any machine that hit this code path. Once a broken copy like that existed on disk, it was never automatically detected or repaired either: the binary file was still present and still executable, so every subsequent lookup kept reporting it as "already installed" and handing the user the exact same dead-end failure forever.
- `install_runtime()` now copies every file sitting next to `llama-server` in the extracted archive (not just the one executable) into the installed `bin/` folder, so its shared libraries always travel with it.
- Added `_binary_is_healthy()`, which uses `ldd` to actually verify a llama.cpp binary's shared libraries can be resolved before trusting it. Both `install_runtime()` and `start_server()` now use it to detect an already-broken existing install and automatically repair it (remove the broken file, re-extract/re-copy a working one) instead of silently reusing it and failing the same way every time.
- `server_env()` now also sets `LD_LIBRARY_PATH` to include the installed `bin/` folder as defense-in-depth, in case a future build doesn't ship with an `$ORIGIN` rpath.
- Verified with 3 new regression tests: a unit test of the `ldd`-based health check, an end-to-end test that builds a fake llama.cpp release archive (executable + shared libraries) and confirms `install_runtime()` copies all of it (not just the binary) into place, and a test confirming `start_server()` detects and repairs a broken existing install automatically rather than relaunching the broken binary again. 66 backend tests passing.

## 3.3.7 - A Fallback/Execution/Preview-Decorated Message in History Permanently Broke a Conversation With Mistral (HTTP 422 "extra_forbidden")

### Fixed
- **Continuing a conversation whose history contained an assistant message that had ever triggered a provider fallback, a code-execution result, or an HTML preview permanently broke that conversation with Mistral** (and any other provider enforcing strict request-body validation), surfacing as a long, cryptic `HTTP 422 Unprocessable Entity: [{'type': 'extra_forbidden', 'loc': ['body', 'messages', 22, 'assistant', 'isFallback'], ...}, ...]` error — one validation failure listed per extra field. Root cause: the frontend's chat-history objects decorate assistant messages with UI-only bookkeeping fields (`isFallback`, `fallbackDetails`, `execResults`, `renderPreviews`, and this app's own `reasoning_content` for reasoning models) used purely for rendering fallback/execution/preview badges and persistence — and because the **entire** conversation history is resent to the provider on every subsequent turn, once a single message anywhere in that history carried any of these fields, Mistral's strict schema validation rejected the *whole* request, permanently breaking that conversation (every future message in it would fail the same way, including innocuous follow-ups like "ادامه بده"). `app/chat.py` now sanitizes every outgoing message — in both the streaming and non-streaming call paths, for every protocol — down to only the fields an actual provider API recognizes (`role`, `content`, `tool_calls`, `tool_call_id`, `name`) immediately before it is sent upstream, regardless of what extra bookkeeping fields the stored/resent history carries.
- Verified with a new regression test that reproduces the exact real-world failure end-to-end: a conversation history containing a fallback/execution/preview-decorated assistant message is sent to a mocked Mistral endpoint that itself returns the real HTTP 422 `extra_forbidden` response if any unrecognized field leaks through — confirming the request now succeeds cleanly. A second unit test confirms the sanitizer preserves tool-calling messages (`tool_calls`/`tool_call_id`) correctly while stripping everything else. 63 backend tests passing.

## 3.3.6 - Chat Showed a Useless Generic Error (or Nothing Useful) Whenever a Local Model's Server Crashed Mid-Request

### Fixed
- **Chatting with a registered local model whose llama-server/Ollama process had crashed (e.g. killed by the OS for running out of memory) showed a generic, unhelpful error — described as "models produce no response, as if not even connected to the endpoint" — instead of the real, actionable diagnosis**, even right after 3.3.5 fixed the exact same category of bug for the Local AI panel's own "Test"/Install/Delete buttons. Root cause: `app/chat.py`'s chat/streaming request code calls `resp.raise_for_status()` on the `httpx` response, and `httpx.HTTPStatusError`'s default message is just a generic sentence like `"Server error '500 Internal Server Error' for url 'http://...'"` — it discards the response **body** entirely, which is exactly where llama-server/Ollama/any OpenAI-compatible provider puts the real cause (e.g. `"llama-server process has terminated: signal: killed"` — in practice almost always the Linux OOM-killer: the selected model needs more RAM than the server actually has). All three `raise_for_status()` call sites in `app/chat.py` (the non-streaming call, its proxy-fallback retry, and the streaming call) now read and surface that body instead, matching the fix already applied to `app/local_ai.py` in 3.3.5. As a bonus, when the specific "signal: killed" signature is detected, a plain-language note is now appended explaining this is almost certainly an out-of-memory kill and suggesting a smaller/more quantized model — so a non-technical user gets an actionable next step instead of a bare technical process-exit message.
- Verified end-to-end: a new regression test drives `stream_call_provider_api()` against a mocked HTTP transport returning the exact `"llama-server process has terminated: signal: killed"` response body and confirms the real message (plus the OOM guidance) is raised instead of httpx's generic text; a second, full browser-level reproduction (real Node `fetch` + jsdom driving the actual chat UI against a live backend + a mock crashing llama-server) confirms the chat bubble renders the complete, correct error message immediately, with no silent failure and no JS errors. 61 backend tests passing.

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
