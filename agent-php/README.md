# Arena AI Coding Agent — PHP edition

A full PHP port of the Python **Arena AI Coding Agent** (`agent-python/`, v0.16.1),
built for an ordinary web host that offers **terminal access with Python and Node
installed**.

Unlike the Cloudflare Workers port (`agent-worker/`), this edition has a real
process model, so everything the Python original could do is available again:

| Capability | Python original | Workers port | **PHP port** |
| --- | --- | --- | --- |
| Shell (`run_command`, terminal tab) | real | virtual FS only, exit 127 | **real `proc_open` shell** |
| Code execution + self-healing loop | real | unavailable | **real (python/node/bash/php)** |
| Browser automation | Playwright | HTTP + HTML parsing | **Playwright → headless Chrome → HTTP, auto-detected** |
| Version control | local `git` CLI | GitHub REST only | **local `git` CLI + GitHub REST** |
| Background jobs | asyncio loop | cron + `waitUntil` | **real worker daemon (`bin/worker.php`)** |
| Storage | filesystem + SQLite | R2 + D1 + KV | **filesystem + SQLite (WAL)** |

The single-page UI (`public/index.html`, 347 KB) is byte-identical to the
original: every route path, HTTP verb and JSON response shape was preserved.

---

## 1. Requirements

**Required**

* PHP **8.1+** CLI and a web SAPI (php-fpm, mod_php, or the built-in server)
* Extensions: `pdo_sqlite`, `curl`, `mbstring`, `json`
* `proc_open()` **not** in `disable_functions` (needed for the shell, code
  execution, git and Playwright). Without it the app still runs — those four
  features degrade to the Workers-style "unsupported" responses.

**Recommended**

* Extensions: `zip` (workspace export), `dom` (HTML extraction), `openssl`
* Binaries on `PATH`: `git`, `python3`, `node`, `npm`
* `pip install playwright && python3 -m playwright install chromium` for full
  browser automation
* `docker` if you want `DOCKER_SANDBOX_ENABLED=true`

Run `php bin/console.php doctor` at any time for a capability report.

---

## 2. Install

```bash
cd agent-php
./install.sh              # checks requirements, creates .env, migrates the DB
./install.sh --serve 8080 # …and starts the dev server + worker
./install.sh --systemd    # …and installs the worker as a systemd unit
```

Then open <http://localhost:8080/> and log in with **admin / admin123**
(change it immediately in *Security & Settings*, or with
`php bin/console.php user:passwd admin <newpassword>`).

Point your web server's document root at **`agent-php/public/`**. Apache picks
up `public/.htaccess` automatically; nginx rules are in `DEPLOYMENT.md`.

---

## 3. Layout

```
agent-php/
├── public/
│   ├── index.php          Front controller (CORS → boot → auth → router)
│   ├── .htaccess          Apache rewrite + SSE/no-buffering rules
│   ├── index.html         The SPA (unchanged, 347 KB)
│   └── chat.html
├── app/
│   ├── Bootstrap.php      Paths, autoloader, error handling, capability probe
│   ├── Http.php           Request / Response / Sse / HttpError
│   ├── Router.php         {param} and {greedy*} regex router
│   ├── Routes.php         The whole API surface (~150 routes)
│   ├── Database.php       PDO SQLite (WAL) + migrations + app_state
│   ├── Crypto.php         PBKDF2 passwords, AES-256-GCM secret storage
│   ├── Security.php       Sessions, RBAC, rate limiting, audit log
│   ├── Auth.php           Middleware, login/logout, user management
│   ├── Config.php         data/environment.json + .env, proxy resolution
│   ├── Files.php          Path safety, listings, previews, CSV, zip
│   ├── Workspaces.php     Workspaces, session workspaces, templates, versions
│   ├── Diff.php           Unified diff (port of Python difflib usage)
│   ├── ChangeSets.php     Diff-approval workflow, locks, rollback, patches
│   ├── References.php     Cross-chat / cross-project file access
│   ├── Conversations.php  Conversations, messages, checkpoints
│   ├── Projects.php       Projects + active project state
│   ├── Terminal.php       Real sandboxed shell, process registry, file exec
│   ├── Git.php            Real git CLI wrapper
│   ├── GitHub.php         GitHub REST v3 + authenticated clone
│   ├── Browser.php        4-tier browser automation
│   ├── HttpClient.php     cURL wrapper (+ forward-proxy support)
│   ├── Providers.php      Provider catalog, key rotation, circuit breaker
│   ├── Models.php         Model health tests, test-all, proxy test
│   ├── AgentTools.php     The 11 tool definitions + dispatcher
│   ├── Chat.php           LLM engine: SSE streaming, agent loop, self-healing
│   ├── Jobs.php           Background job queue
│   └── Observability.php  Logs, metrics, CSV export
├── bin/
│   ├── worker.php         Job worker daemon (`--once`, `--job <id>`)
│   └── console.php        doctor / migrate / serve / user / config / jobs / routes
├── scripts/browser_agent.py   Playwright bridge (single-JSON stdout protocol)
├── migrations/0001_init.sql   Full schema
├── data/providers.json        Seed provider catalog (9 providers)
└── storage/                   Workspaces, uploads, job artifacts, backups
```

---

## 4. How the runtime pieces map

| Python original | PHP edition |
| --- | --- |
| FastAPI app | `public/index.php` front controller + `app/Router.php` |
| `async def` route handlers | plain closures in `app/Routes.php` |
| `httpx` | `app/HttpClient.php` (cURL; `curl_multi` for streaming) |
| async generators (SSE) | PHP `Generator`s yielding event arrays, written by `Sse` |
| `asyncio` worker loop | `bin/worker.php` daemon + autospawned one-shot workers |
| `subprocess` | `proc_open()` in `app/Terminal.php` (timeouts, process registry) |
| Playwright | `scripts/browser_agent.py` bridge, invoked per action |
| `difflib` | `app/Diff.php` |
| `zipfile` | `ZipArchive` |
| SQLite via `sqlite3` | PDO SQLite in WAL mode |
| module-level globals | the `app_state` table (active workspace/project, circuit breaker, browser sessions, job flags) |

### Streaming

`/api/chat/stream` emits exactly the same SSE event sequence as the original:

```
status(started) → reasoning* → tool_executing → tool_result → token*
               → execution_result → execution_healed? → done
```

plus `render_preview_ready`, `retry_countdown`, `fallback_activated`,
`model_switched_rate_limit`, `checkpoint_resumed`, `approvals` and `error`.

Because PHP buffers aggressively, `Sse::start()` disables `zlib.output_compression`,
`output_buffering` and emits `X-Accel-Buffering: no`. If tokens arrive in bursts,
your reverse proxy is buffering — see `DEPLOYMENT.md` §4.

### Self-healing execution

When the model answers without tool calls, code blocks are auto-detected and
saved (`agent-auto-save` version snapshots), HTML files emit a preview URL, and
executable files are **actually executed**. On a non-zero exit the traceback is
fed back to the model for up to 3 repair rounds (`execution_healed`).

### Providers & fallback

Nine providers are seeded from `data/providers.json` (ollama, openrouter, groq,
together, mistral, gemini, anthropic, deepseek, …). Per call the engine tries:
primary → verified fallbacks (fastest measured first) → every other enabled
provider by priority. Rate-limit errors switch models immediately; network
errors retry with exponential backoff capped by `MAX_RETRY_SLEEP_SEC`. A circuit
breaker trips after 5 failures in 60 s.

---

## 5. Configuration

Two layers, merged at read time:

1. `.env` in the application root (copy from `.env.example`) — good for
   deployment-level settings.
2. `data/environment.json` — written by the *Security & Settings* tab and
   `php bin/console.php config:set`. Secrets are encrypted with AES-256-GCM
   using `data/master.key` and masked (`sk-…7890`) whenever read back.

Both files must stay outside the document root (they are, by default) and are
in `.gitignore`.

---

## 6. Console

```bash
php bin/console.php doctor                 # capability report
php bin/console.php migrate                # create/update the schema
php bin/console.php serve 8080 0.0.0.0     # built-in dev server
php bin/console.php user:add bob s3cret Developer
php bin/console.php user:passwd admin newpass
php bin/console.php config:set OPENROUTER_API_KEY sk-...
php bin/console.php provider:test openrouter
php bin/console.php jobs:drain
php bin/console.php routes
```

## 7. Worker

```bash
php bin/worker.php                 # daemon (systemd / supervisor / nohup)
php bin/worker.php --once          # single drain (good for a cron entry)
php bin/worker.php --job job-123   # run one job
```

The daemon writes a heartbeat to `app_state`; when it is down, queuing a job
autospawns a one-shot worker instead (`AGENT_WORKER_AUTOSPAWN=true`). Claiming
is atomic, so the two never collide.

---

## 8. Security notes

* Sessions: `arena_session` cookie, 24 h sliding expiry, DB-backed; `Bearer`
  and `X-Auth-Token` headers work too.
* Roles: Admin / Developer / Viewer, enforced per route.
* Rate limiting: `RATE_LIMIT_PER_MINUTE` (200) per IP+path, 30 for login.
* Audit trail: `security_logs` records `LOGIN_SUCCESS`, `LOGIN_FAILED`,
  `UNAUTHORIZED_API_ACCESS`, `PERMISSION_DENIED`, `RATE_LIMIT_EXCEEDED`, …
* Dangerous shell commands (`rm -rf /`, `mkfs`, fork bombs, `shutdown`, …) are
  blocked unless the request sets `confirmed: true`.
* Every workspace path is resolved through `realpath()` and rejected if it
  escapes the workspace root.
* Environment variables matching `KEY|TOKEN|SECRET|AUTH|PASS` are scrubbed from
  the environment handed to child processes (except `GITHUB_TOKEN`, which git
  needs).
* Setting `AUTH_ENABLED=false` makes every request the anonymous superuser —
  only do that behind your own network boundary.

---

## 9. Verification status

This port was authored in an environment with **no PHP runtime available**, so
it could not be executed here. What *was* verified mechanically:

* every `.php` file parses cleanly under a PHP 8.3 grammar (30/30 files);
* every `Class::method()` call resolves to a declared method with a compatible
  argument count, and every class constant exists (static analysis pass);
* `install.sh` passes `bash -n`, `scripts/browser_agent.py` byte-compiles.

Before going live, run `php bin/console.php doctor` and the smoke test in
`DEPLOYMENT.md` §6 on the target host.
