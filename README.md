# 🚀 WebConsole Pro & Cloudflare Workers Edge Suite

> **All-in-One Multi-Runtime Management Console, Universal Forward Proxy, & VPS/Termux/Cloudflare Automation Platform**  
> *Version: 1.9.2 | Multi-Platform: Ubuntu / Debian / CentOS / Rocky / AlmaLinux / Alpine / Arch / Android Termux / GitHub Codespaces / Cloudflare Workers*

---

## ⚡ Quick One-Line Launch & Installation

### 💻 VPS Server / GitHub Codespaces
```bash
curl -sSL https://raw.githubusercontent.com/fazilatma/new/main/install.sh | sudo bash
```

### 📱 Android Termux
```bash
curl -sSL https://raw.githubusercontent.com/fazilatma/new/main/install.sh | bash
```

---

## 🎯 3-Option Interactive Startup Menu

Upon running the launcher script, an interactive 3-option menu appears (auto-selects **1** in 8 seconds):

```text
================================================================================
          🚀 WebConsole Pro Setup - Operation Mode Selection                    
================================================================================
  [1] ⚡ Start WebConsole Server (Default - Instant ~1s)
      • Starts persistent background daemon on Port 8888 & outputs live URLs.

  [2] 🔄 Quick Update WebConsole & wcp CLI (~3s)
      • Downloads latest WebConsole Pro & wcp CLI from GitHub without reinstalling packages.

  [3] 📦 Full System Installation (~1-2m)
      • Installs Web Server, Node 22 LTS, Python 3 Scraping Stack, Libraries & Configs.
================================================================================
👉 Select an option [1, 2, or 3] (Auto-selects 1 in 8s): 
```

---

## 🛡️ 1. Universal Forward Proxy Gateway

WebConsole Pro includes a built-in, high-performance forward proxy matching the Cloudflare Workers format. It proxies any URL, bypassing restrictions, injecting CORS headers, and streaming audio/video with byte-range slicing.

### 🌐 Format & Usage:
```text
https://YOUR_WEBCONSOLE_URL:8888/?url=https://example.com/page
```
* **In GitHub Codespaces:**  
  `https://<codespace-name>-8888.app.github.dev/?url=https://example.com/page`
* **In Cloudflare Workers:**  
  `https://<worker-name>.workers.dev/?url=https://example.com/page`
* **In VPS Server:**  
  `http://<server-ip>:8888/?url=https://example.com/page`
* **In Termux:**  
  `http://localhost:8888/?url=https://example.com/page`

### ✨ Supported Capabilities:
* **All HTTP Methods:** `GET`, `POST`, `PUT`, `DELETE`, `PATCH`, `HEAD`, `OPTIONS`.
* **Streaming & Media:** MP4/WEBM video, MP3 audio, Live streaming chunks, PDF, and ZIP archives.
* **Byte-Range Seeking (`206 Partial Content`):** Smooth video seek bar & resume broken downloads.
* **Wildcard CORS:** `Access-Control-Allow-Origin: *` for seamless frontend & mobile app integration.
* **Header Forwarding:** Preserves `Authorization`, `Cookies`, `User-Agent`, and custom headers.

---

## ☁️ 2. Cloudflare Workers WebConsole Edition (`webconsole.worker.js`)

A dedicated single-file Edge WebConsole designed to run inside Cloudflare Workers V8 Isolates:

### 🌟 Edge Features:
1. **Universal Edge Proxy:** Forward any request across Cloudflare's global edge network.
2. **Cloudflare D1 SQL Console:** Execute SQL queries and inspect database tables visually.
3. **KV Storage Explorer:** List, inspect, add, edit, and delete KV keys with TTL.
4. **Cloudflare Workers AI:** Real-time chat & text inference with LLaMA 3.1 8B, Qwen 1.5 7B, and Mistral 7B.
5. **Edge JavaScript REPL:** Execute modern JS in the V8 isolate with `fetch` and `crypto`.
6. **Outbound HTTP API Tester:** Send custom HTTP requests from Cloudflare edge locations.

### 🚀 Deploying to Cloudflare Workers:
```bash
# 1-Command Wrangler Deploy:
npx wrangler deploy webconsole.worker.js --name my-webconsole
```
*Or copy `webconsole.worker.js` directly into the [Cloudflare Dashboard](https://dash.cloudflare.com) code editor.*

---

## 📋 3. Universal CLI Tool (`wcp`) Command Reference

The `wcp` command is globally installed across Linux, Codespaces, and Termux:

| Command | Description |
| :--- | :--- |
| `wcp status` | Real-time CPU, RAM, Swap, Disk, and Process health metrics |
| `wcp url` | Output public HTTPS Codespaces, VPS, and Termux access links |
| `wcp port <number>` | Dynamically switch WebConsole port (e.g. `wcp port 8888`) |
| `wcp on` / `wcp off` | Instant 1-word server toggle (Zero battery consumption on Android) |
| `wcp shutdown` | Terminate WebConsole daemon AND all active project services |
| `wcp serve [port]` | Start or restart persistent background WebConsole server |
| `wcp proj [list]` | Display interactive table of all configured projects & statuses |
| `wcp start <id>` | Launch a specific project service in background |
| `wcp stop <id>` | Gracefully stop a running project service |
| `wcp restart <id>` | Restart a running project service |
| `wcp logs <id>` | Tail and stream live console output logs of a project |
| `wcp ports` | Inspect all active listening TCP ports, sockets, and PIDs |
| `wcp killport <port>` | Forcefully terminate whatever process is occupying a port |
| `wcp swap [size_mb]` | View or dynamically resize virtual Swap memory (MB) |
| `wcp pass [password]` | Set or reset WebConsole master administrator password |
| `wcp update` | 1-Click self-updater to latest WebConsole release |
| `wcp doctor` | Run comprehensive system diagnostics (Apache, PHP, Python, Node 22) |
| `wcp rebuild` | Trigger Codespaces persistent port forwarding rebuild |

---

## 🐍 4. Node.js 22 LTS & Scraper4 Direct Server

* **Node.js 22.x LTS:** Built-in `node:sqlite` database support with zero native compilation errors.
* **Scraper4 Direct Mode:** Runs `node render-dist/server.js` with auto-build on start, eliminating port collisions and 401 token authentication loops.
* **Port Isolation:** WebConsole binds exclusively to Port **8888**, keeping ports **8000**, **9000**, **3000**, and **8081** completely free for your Python and Node.js applications.

---

## 📱 5. Android Termux Battery & Kernel Optimization

* **Zero Background Drain:** Run `wcp off` or `wcp shutdown` when finished to pause all background daemons.
* **SELinux OPcache Fix:** Bypasses unrooted Android `/tmp` semaphore restrictions automatically.
* **Portable Paths:** Seamlessly maps storage between `$PREFIX/tmp` and `$HOME/webconsole`.

---

## 🐍 Latest Python + Rootless AI Agent Helper (No `sudo`, `apt`, or Docker)

`install-python-agent.sh` is the supported path for restricted hosting accounts. It installs or upgrades `uv`, the latest stable CPython, and Open WebUI Computer (`cptr`) entirely under the account home. It also makes the new user-level `python` and `python3` launchers the defaults in future login and Bash sessions, without modifying `/usr/bin`.

Download and run the helper:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/main/install-python-agent.sh -o "$HOME/install-python-agent.sh"
```

```bash
bash "$HOME/install-python-agent.sh" install --home "$HOME"
```

If WebConsole provides an invalid `HOME`, use the real account path explicitly:

```bash
bash install-python-agent.sh install --home /home/USERNAME
```

After the first installation, all runtime operations use the installed helper command:

```bash
python-agent status
python-agent update
python-agent restart
python-agent logs --follow
python-agent doctor
python-agent python-version
```

By default the helper installs the most reliable base `cptr` package. Optional feature sets are available during installation or update:

```bash
python-agent update --extras recommended
```

The accepted feature sets are `base`, `mcp`, `agents`, `recommended`, and `all`. The helper stores the virtual environment, data, PID, logs, and generated configuration in private account-owned paths under `~/.local` and `~/.config`.

The included `open-webui-computer-rootless-project.json` imports the same helper into WebConsole, installs the newest stable Python automatically, and uses `python-agent run` for foreground process supervision.

## 🤖 OpenHands Agent Canvas on Restricted Hosting (No Docker)

`host-helpers/install-openhands-host.sh` installs the official `@openhands/agent-canvas` package and all required runtimes below the account home. It uses a checksummed user-local Node.js 24 release (including a verified glibc 2.17 compatibility fallback on older x86-64 hosts), user-local `uv`, and npm. It never uses `sudo`, `apt`, Docker, or systemd.

Download first, then run it as a separate short command so fragile web terminals do not have to paste one long pipeline:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/refs/heads/arena/01a0f230-new/host-helpers/install-openhands-host.sh -o "$HOME/install-openhands-host.sh"
```

```bash
bash "$HOME/install-openhands-host.sh" install --home "$HOME" --port 8810 --access-host YOUR_HOST
```

After installation, use only the permanent helper command:

```bash
openhands-host status
openhands-host update
openhands-host restart
openhands-host logs --follow
openhands-host pair
openhands-host models
openhands-host test-models
openhands-host access-info
openhands-host web-check
openhands-host doctor
```

The helper always launches Agent Canvas with `--public` and a locally generated 256-bit API key. The preferred login flow is `openhands-host pair`: it prints a short, five-minute pairing code. Open the fixed HTTPS `/open/pair` page, enter that code, and the browser configures the correct local backend and API key before immediately invalidating the code. Only a SHA-256 digest is stored on disk, each code allows at most eight attempts, and the API key is returned only after a same-origin POST validates it; neither secret is embedded in ordinary public HTML or placed in a URL. `openhands-host access-info` remains available as a manual fallback. The browser gateway also creates or repairs the local backend profile with the correct same-origin `/open` URL. The default browser base path is `/open` (override it with `--base-path`), matching WebConsole's HTTPS publisher. A generated Node gateway listens on public port `8810`, while the official Canvas ingress uses internal port `18812`. The gateway supports both WebConsole's prefix-stripping proxy and direct `/open/` requests, rewrites the prebuilt HTML/router and JavaScript manifest asset URLs, and preserves API and WebSocket routing below the prefix. `openhands-host web-check` verifies the prefixed HTML, initial JavaScript, router configuration, protected settings access, and backend readiness.

Every supervised startup also idempotently seeds 12 credential-free OpenRouter LLM Profiles with the official `openrouter/<model-id>` naming: Seed 2.1 Turbo, Qwen3.8 2.4T A95B, Seed-2.0-Code, DeepSeek V4 Pro 0813, Grok 4.6, LFM2.5-2.6B free, both Nemotron 3.5 Lightning variants, Sakana Namazu, Solar Pro 4, Muse Glimmer 30B, and Muse Spark 1.2. A profile whose name already exists is never overwritten, so user edits survive restarts and future updates. The templates intentionally contain no API key and ignore third-party diagnostics such as `available`, `rateLimited`, `testDetails`, `raw`, and Worker errors. Revoke any key ever pasted into chat, create a fresh OpenRouter key, and save it only through Agent Canvas **Settings > LLM > Provider Connections**; then associate the desired profiles with that connection.

Version 3 adds an authenticated model manager at `/open/models`, available after the normal browser pairing flow. Helper 3.0.1 also injects a clearly visible **⚙ مدیریت مدل‌ها** button into the lower-left corner of the main Canvas page so the feature is discoverable without typing its URL. Helper 3.0.2 fixes a generated browser-script escaping defect that prevented the import button handlers from running, and accepts provider `models` object maps in addition to arrays, `modelList`/`availableModels`, OpenAI-style `data` envelopes, flat per-model arrays, and root model-ID maps. It reports detected, newly created, already-present, linked, updated, and rejected counts separately and displays every persisted LLM Profile directly on the manager page. Only supported fields are mapped into official Provider Connections and LLM Profiles. As of Helper 3.5, every API key present in an authenticated import is automatically moved to OpenHands' encrypted Provider Connection store. An existing same-provider/same-name connection is rotated through the official `PATCH` API, and all existing Profiles belonging to that provider are linked without requiring destructive overwrite; new imported Profiles use the same connection. No key is placed inline in a Profile. The sanitized source snapshot strips credential fields, exports always set `secretsIncluded` to `false`, and imported keys are never written to HTML, logs, URLs, Git, or the one-time project JSON. Existing model settings remain unchanged unless overwrite is explicitly selected. The page and matching helper actions also export compatible provider JSON, run a two-token concurrency-limited test across all persisted profiles, and redact credentials from every test error.

Helper 3.1 removes the upstream local Agent Server's hard-coded 50-profile ceiling. On every install and startup it idempotently extends Agent Canvas's already-imported compatibility module so the official profile store receives `max_profiles=None`, its own supported unlimited mode; no profile files or secrets are bypassed, and overwrites still use the official authenticated API. Bulk testing and proxy-route application now operate on the complete profile list rather than truncating it to 50.

Helper 3.2 enforces OpenHands' 16,384-token minimum for managed GGUF and OpenAI-compatible local endpoints. New local profiles default to 16,384, smaller submitted values are safely raised, and startup repairs existing helper-managed or `local-*` loopback profiles that still store 8,192 without touching protected inline-key profiles. It also adds Hugging Face GGUF search by text, family/architecture, parameter-size hint, quantization, license, language, author, sort order, result count, and maximum file size; selecting a repository filters its actual files and carries the selected filename and available SHA-256 directly into the resumable installer.

Helper 3.3 integrates **مدیریت مدل‌ها** directly into Agent Canvas's native desktop, collapsed, and mobile sidebars instead of showing a floating overlay. The authenticated manager now follows the Canvas visual hierarchy with a responsive tabbed workspace, compact status overview, structured forms, overflow-safe tables, keyboard-accessible navigation, per-action busy states, and dedicated views for provider JSON, proxy routing, GGUF, OpenAI-compatible endpoints, and bulk tests.

Helper 3.4 makes provider imports context-safe without enabling the discouraged `ALLOW_SHORT_CONTEXT_WINDOWS` bypass. Every newly imported profile receives at least 16,384 input tokens, explicit 8,192-token values are raised automatically, and safe existing Provider-Connection profiles are repaired even when overwrite is off. Before Agent Server starts, Helper 3.4.1 atomically raises explicit short context values in stored profile documents while retaining encrypted or inline credential values and every unrelated field; the authenticated manager performs a second API-level reconciliation after startup. The import summary reports how many context windows were adjusted. Helper 3.4.2 makes llama.cpp installation retry-safe: a verified existing release archive is reused, extraction happens in a fresh path-checked staging directory, stale partial extraction directories are removed, the executable is validated before activation, and the UI displays the actual redacted job error instead of only the last progress message. Helper 3.4.3 previously selected the SHA-256-pinned official b7716 CPU runtime on x64 hosts without `libssl.so.3`; that removed the OpenSSL dependency but still required GLIBC symbols as new as 2.34 and therefore was not compatible with the target legacy host.

Helper 3.5 replaces that fallback on every x64 host with the repository-shipped, SHA-256-pinned b11320 `llama-server` built as a fully static x86_64-musl ELF. It has no dynamic loader, GLIBC symbol, OpenSSL, CURL, libstdc++, libgcc, or OpenMP dependency. The permanent rootless laboratory under `host-helpers/lab/` verifies immutable source and tool hashes, builds without `apt`, `sudo`, or Docker, rejects dynamic dependencies, executes `llama-server --version`, and records evidence before the runtime is accepted. The same lab runs the real manager against a mock official API and verifies credential rotation, provider-wide Profile linking, redacted snapshots/exports/logs, and absence of inline secrets. No system package manager or root access is used.

Helper 3.5.1 makes endpoint assignment model-specific during provider import. Every imported Profile receives its model-level endpoint (falling back to the provider endpoint), every bare model ID is normalized to the LiteLLM `provider/model` form, and custom endpoint providers default safely to `openai/` while native providers such as Mistral retain their own prefix. Existing same-name Profiles such as `codestral-2508` are repaired to `mistral/codestral-2508` and receive their endpoint without destructive overwrite. On startup, the manager reapplies the last redacted import snapshot so this repair reaches already-imported Profiles through Auto-Update without importing the WebConsole project JSON again.

The manager provides three outbound modes: `direct`, `direct-fallback`, and `proxy-only`. Its default URL-wrapper is `https://proxy.fazilat-ma.workers.dev/?url={url}`. A loopback-only adapter reconstructs each complete provider URL before wrapping it, so OpenAI-compatible paths such as `/chat/completions` remain inside the encoded `url` parameter; the public gateway never publishes these internal routes. Unmodified seeded OpenRouter profiles are migrated to this route automatically; other existing OpenRouter profiles can be attached from the manager page without losing their remaining fields. Provider Connections are updated through the official API rather than exposing their keys. Any URL-wrapper proxy necessarily receives the provider authorization header and prompt/response content, so enable proxy routing only when that intermediary is trusted.

Local models support both requested paths. The advanced GGUF manager searches Hugging Face by requested model characteristics, discovers a current CPU-only `llama.cpp` release, records its version, verifies GitHub's asset digest when provided, accepts either a direct Hugging Face/GitHub URL or repository + filename + revision, discovers public GGUF files, sizes, and available SHA-256 hashes from a Hugging Face repository, normalizes `blob` links, and enforces HTTPS/host, 20-GiB size, free-space reserve, GGUF v2/v3 header, and optional SHA-256 checks. Large downloads use HTTP Range resume, keep safe partial files after network failure or explicit cancellation, and reject reuse when the source URL changes. The authenticated page reports CPU, RAM, disk, PID, readiness, logs, GGUF metadata, and partial progress; it can tune context size, CPU threads, logical/physical batch sizes, parallel slots, mmap, and mlock, and can start, stop, reconfigure, replace, or safely delete each managed model and its matching profile. One selected GGUF model is served only on loopback port `18820` and receives an automatic `local-<name>` profile.

The same page can discover `/models`, validate, and register an existing Ollama, LM Studio, vLLM, llama.cpp, or other OpenAI-compatible endpoint. Plain HTTP is accepted only for loopback; remote endpoints require HTTPS. Context size and native tool calling are configurable, API keys go directly into encrypted Provider Connections, and are never returned by the probe. CPU inference on shared hosting can still be slow and is limited by the account's RAM, disk, and process quotas.

Helper automation examples:

```bash
openhands-host models
openhands-host providers-export --file "$HOME/openhands-providers.json"
openhands-host providers-import --file "$HOME/openhands-providers.json"
openhands-host test-models
openhands-host proxy-config --proxy-mode direct-fallback
openhands-host local-model-search --search coder --family Qwen --parameter-size 7B --quantization Q4_K_M --license apache-2.0 --language fa --max-file-size-gb 8
openhands-host local-model-discover --hf-repo OWNER/REPO --quantization Q4_K_M --max-file-size-gb 8
openhands-host local-model-install --name qwen-small --hf-repo OWNER/REPO --model-filename model-Q4_K_M.gguf --context-length 16384 --threads 4 --batch-size 512 --ubatch-size 256
openhands-host local-model-list
openhands-host local-model-config --name qwen-small --context-length 16384 --threads 4 --parallel 2
openhands-host local-model-start --name qwen-small
openhands-host local-model-stop
openhands-host local-model-delete --name qwen-small --yes
openhands-host local-endpoint-test --base-url http://127.0.0.1:11434/v1
openhands-host local-endpoint-add --name ollama --base-url http://127.0.0.1:11434/v1 --model qwen2.5-coder --context-length 32768
```

Provider import automatically stores any key found in the selected JSON inside an encrypted Provider Connection; keep credential files protected by mode `600` and remove them after import. `--import-secrets` remains only as a backward-compatible no-op flag. Use `--api-key-file` rather than placing an endpoint key in shell history.

The included `openhands-agent-canvas-project.json` is ready to import once in WebConsole's **Create Project** dialog. It enables branch auto-update every 60 seconds and executes the helper directly from the deployed branch checkout. Future pushes to `arena/01a0f230-new` are therefore fetched, installed, and restarted automatically without importing another JSON. The profile uses port `8810`, foreground helper supervision, and the real account home path rather than Docker. On each launch, `run` takes an atomic account-local startup lock, removes all recognizable account-owned OpenHands launchers and runtimes from the preceding deployment even if they have not bound a port yet, confirms that any remaining port owner is unknown and leaves it untouched, and then starts one supervised Canvas/gateway pair. A continuous readiness watchdog probes the Python Agent Server's own internal `/server_info` and protected `/api/settings` endpoints instead of trusting the Canvas ingress `/health` route (which can stay green after its backend dies). The protected request also verifies that the running backend accepts the API key currently stored by the helper. Startup is not published until both probes succeed, and three consecutive runtime or key-synchronization failures terminate the whole pair so WebConsole's daemon supervision restarts a clean stack instead of leaving a frontend that returns `502 Bad Gateway` or `Invalid API key`. Key rotation writes the replacement secret before stopping the old process, preventing an immediate WebConsole relaunch from racing ahead with the retired key.

> **Security warning:** direct Agent Canvas execution is not sandboxed. An authenticated agent receives the same filesystem, shell, and network permissions as the hosting account. Do not send the API key over an untrusted plain-HTTP network, and do not expose an account that contains unrelated production credentials.

## 🐳 Rootless Docker Helper (Provider Features Required)

Restricted Linux hosts can run the prerequisite check and install Docker under the hosting account with the helper below. The host must already provide `newuidmap`, `newgidmap`, subordinate UID/GID ranges, unprivileged user namespaces, and container networking support.

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/main/install-rootless-docker.sh | bash
```

Install Docker and then deploy Agent Zero on port `50080`:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/main/install-rootless-docker.sh | bash -s -- --install-agent-zero
```

For a WebConsole session whose `HOME` is unset or invalid, provide the real account home explicitly:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/main/install-rootless-docker.sh | bash -s -- --home /home/USERNAME --install-agent-zero
```

The helper fails safely when the hosting provider has disabled a required kernel/account feature; a `curl` installer cannot bypass those restrictions.

---

## 📄 License

Open-source under the MIT License. Developed for automated web operations, cloud scraping, and edge computing.
