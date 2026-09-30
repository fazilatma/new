# Arena AI Coding Agent — Cloudflare Workers Edition

A full port of **Arena AI Coding Agent v0.16.1** (the Python/FastAPI project in
`agent-python/` on branch `arena/01a0ed4c-new`) to the Cloudflare Workers
runtime — TypeScript + Hono + D1 + R2 + KV, no servers, no containers.

The original single-page UI (`app/static/index.html`, 347 KB) is shipped
unchanged in `public/` and works against this backend, because every route
path, HTTP verb and JSON response shape was preserved.

---

## 1. Architecture mapping

| Python / FastAPI                     | Cloudflare Workers                                              |
| ------------------------------------ | --------------------------------------------------------------- |
| FastAPI + uvicorn                    | **Hono** on `workerd`                                             |
| SQLite (`data/agent.db`)             | **D1** (`DB` binding) — same schema, `migrations/0001_init.sql`   |
| Local filesystem workspaces          | **R2** (`FILES` binding) — virtual FS under `ws/<workspace-id>/`  |
| `data/providers.json`, `.env`        | **KV** (`CONFIG` binding), seeded from `data/providers.json`      |
| `StaticFiles` / `FileResponse`       | **Workers Assets** (`ASSETS` binding, `./public`)                 |
| `httpx.AsyncClient`                  | `fetch()`                                                         |
| `asyncio` background worker loop     | `ctx.waitUntil()` + a **1-minute cron trigger**                   |
| Module-level globals                 | `app_state` table (`getState` / `setState`)                       |
| `subprocess` terminal sandbox        | Pure-TS VFS shell (`src/terminal.ts`) — built-ins only            |
| Playwright browser automation        | Browser Rendering REST API → `fetch` + `HTMLRewriter` fallback    |
| `git` CLI (`git_manager.py`)         | GitHub REST API (`src/git.ts`)                                    |
| `hashlib`/`cryptography`             | WebCrypto (AES-GCM-256, PBKDF2-SHA256 100k)                       |
| `difflib.unified_diff`               | Hand-written LCS + difflib-compatible hunk grouping (`src/diff.ts`)|
| `zipfile`                            | Hand-written ZIP writer (`src/zip.ts`)                            |

### Source layout

```
agent-worker/
├── src/
│   ├── index.ts          Hono app — all ~140 routes (port of app/main.py)
│   ├── chat.ts           LLM engine, SSE streaming, agent loop, self-healing
│   ├── agent-tools.ts    Tool definitions + dispatcher given to the model
│   ├── providers.ts      Provider catalog, key rotation, circuit breaker
│   ├── models.ts         Model health tests + proxy probe
│   ├── auth.ts           Sessions, RBAC, login/logout, user management
│   ├── security.ts       Session store, rate limiting, audit log, bootstrap
│   ├── workspaces.ts     Workspaces, session workspaces, cross-chat references
│   ├── projects.ts       Projects CRUD + active project
│   ├── changesets.ts     Diff-approval workflow, file versions, locks
│   ├── storage.ts        R2-backed virtual filesystem
│   ├── terminal.ts       Sandboxed shell built-ins
│   ├── git.ts            Version control over the GitHub API
│   ├── github.ts         GitHub REST v3 connector
│   ├── browser.ts        Browser Rendering / HTMLRewriter engine
│   ├── worker-jobs.ts    Background job queue + cron drain
│   ├── observability.ts  Structured logs + system metrics
│   ├── db.ts             D1 schema, helpers, conversation checkpoints
│   ├── config.ts         Config resolution (KV → vars → defaults), proxy parsing
│   ├── crypto.ts         AES-GCM secrets, PBKDF2 passwords, masking
│   ├── diff.ts           Unified-diff generator/parser
│   ├── zip.ts            ZIP archive writer
│   └── types.ts          Env bindings + shared types
├── public/               index.html (the SPA) + chat.html
├── data/providers.json   Seed provider catalog
├── migrations/           D1 schema
└── wrangler.toml
```

---

## 2. Quick start

```bash
cd agent-worker
npm install

# One-time resource creation
npx wrangler d1 create arena-agent-db          # paste database_id into wrangler.toml
npx wrangler r2 bucket create arena-agent-files
npx wrangler kv namespace create CONFIG        # paste id into wrangler.toml

# Local development (D1/R2/KV simulated by Miniflare)
cp .dev.vars.example .dev.vars                 # add your API keys
npm run dev                                    # http://localhost:8787

# Deploy
npx wrangler d1 execute arena-agent-db --remote --file=./migrations/0001_init.sql
npm run deploy
```

The schema is also created automatically on the first request (`ensureDb`), so
the explicit `d1 execute` step is optional but recommended for a clean start.

Full step-by-step instructions, including every secret and a GitHub Actions
workflow, are in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

---

## 3. What is fully ported

* **Multi-provider LLM chat** — `openai-compatible`, `anthropic`, `gemini`,
  `ollama`, `mistral`, `azure`, `cloudflare`, `openrouter` protocols; per-model
  tool-calling, vision and token-limit metadata.
* **SSE token streaming** — identical wire format
  (`event: <type>\ndata: <json>\n\n`) with `token`, `reasoning`,
  `tool_executing`, `tool_result`, `execution_result`, `execution_healed`,
  `render_preview_ready`, `retry_countdown`, `fallback_activated`,
  `model_switched_rate_limit`, `checkpoint_resumed`, `approvals`, `done`,
  `error` events.
* **Tool-calling agent loop** — `list_files`, `read_file`, `write_file`,
  `run_command`, `browser_navigate`, `http_request`, `git_status`, `git_diff`,
  `list_referenced_files`, `read_referenced_file`, `copy_referenced_file`.
* **Provider resilience** — automatic fallback ordering from live
  `provider_metrics`, circuit breaker (5 failures / 60 s recovery), round-robin
  API-key rotation, exponential-backoff retries (10 attempts, capped by
  `MAX_RETRY_SLEEP_SEC`), and a non-streaming last-resort path.
* **ChangeSet diff-approval workflow** — per-file approve/reject,
  partial approval, rollback, `.patch` export, file versions, compare and
  rollback-to-version, advisory file locks.
* **Workspace file CRUD** — list/read/write/create/rename/delete, raw serving,
  rich previews (image/pdf/audio/video/html/markdown/csv/code/binary),
  ZIP export, per-conversation session workspaces, templates
  (`fastapi`, `python-cli`, `node-vite`, `worker`).
* **Cross-chat / cross-project references** — `@chat:<id>/path` and
  `@project:<id>/path` resolution in prompts and tools.
* **Conversations** — messages, sync, checkpoints (save/resume/clear).
* **Projects** — CRUD, activation, instructions, agent rules, env vars.
* **RBAC auth** — `Admin`/`Developer`/`Viewer`, PBKDF2 passwords, `arena_session`
  cookie (24 h sliding), bearer + `X-Auth-Token` support, `AGENT_AUTH_TOKEN`
  master token, rate limiting, security audit log, user management.
* **Background jobs** — create/list/detail/cancel/pause/resume/retry/cleanup,
  step and log persistence, R2 result artifacts, orphan recovery.
* **Observability** — structured app logs, filtering/search, CSV+JSON export,
  system metrics.
* **GitHub integration** — user, repos, branches, trees, contents (read/write),
  pull requests (list/create/merge/review), Actions runs (list/rerun), issues.

---

## 4. Known differences (and why)

The Workers runtime has no process model and no persistent server process.
Four features therefore behave differently. All of them **degrade explicitly**:
the API returns `unsupported: true` with an actionable message rather than
failing silently, and the agent's system prompt tells the model about the
constraints so it does not promise impossible actions.

### 4.1 Terminal / code execution

`run_command` and `/api/terminal/exec` are served by a pure-TypeScript shell
over the R2 virtual filesystem. Implemented built-ins:

```
help pwd whoami clear uname env echo ls tree find cat head tail
wc grep stat du mkdir touch rm cp mv
```

Anything else — `python`, `node`, `php`, `bash`, `pytest`, `npm`, … — returns
exit code `127` with `unsupported: true`. Pipes, redirection and `&&`/`||`
chaining return exit code `2`.

Consequently the **self-healing execution loop** skips healing when a result
carries `unsupported: true` (instead of looping three times against an error it
can never fix). HTML files still get a live preview via
`/api/workspace/raw`, which is the main interactive demo path.

> Need real execution? Keep the Python/Docker deployment for that workload, or
> point `run_command` at an external runner service.

### 4.2 Browser automation

Playwright cannot run in `workerd`. Three tiers, chosen automatically:

1. **Cloudflare Browser Rendering REST API** — real Chromium. Enabled when
   `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` are set. Gives real page
   content and real PNG screenshots.
2. **`fetch` + `HTMLRewriter`** — title, visible text and resolved links.
   Screenshots become a synthetic SVG wireframe of the extracted content.
3. **Offline fallback document** — when the origin is unreachable.

`browser_click` follows a matching link when it can; `browser_fill` and
arbitrary `eval()` require tier 1 (the runtime disables `eval`). A small set of
introspection expressions (`document.title`, `location.href`,
`document.body.innerText`, …) is answered from the cached session.

### 4.3 Git

There is no local checkout, so `src/git.ts` speaks the **GitHub REST API**
against the repository configured on the active project (`gitUrl` +
`defaultBranch`), treating the R2 workspace as the working tree:

* `status` / `diff` — compares workspace files against the remote branch tree.
* `commit` — writes changed files through the Contents API (push is implicit).
* `pull` — syncs the remote tree into the workspace.
* `branches`, `branch/create|switch|rename|delete`, `log`, `commit/{sha}`,
  `remotes` — direct API calls. (`switch` sets the project's default branch.)
* `stash`, `cherry-pick`, `revert`, `merge`, conflict resolution — reported as
  `unsupported`; use branches + pull requests instead.

### 4.4 Rate limiting

The Python limiter used a process-global dict. Its Workers equivalent is
isolate-local, so limits are enforced per isolate (best effort). For hard
global limits, put Cloudflare Rate Limiting rules in front of the Worker or
move the counter into a Durable Object.

### 4.5 Other small notes

* **Forward proxies** (`http://host:port`, `socks5://…`) cannot be honoured —
  `fetch` has no proxy option. Gateway-style proxies that take the target as a
  URL parameter (`https://proxy.example/?url={url}`) work fine and are the
  default. When a socket proxy is configured it is reported as `proxyClient`
  and the request goes out directly.
* **`localhost` providers** (e.g. a local Ollama at `127.0.0.1:11434`) are not
  reachable from the edge. Expose Ollama publicly and set `OLLAMA_BASE_URL`.
* **Disk metrics** report R2 usage of the active workspace against a 1 GiB
  display budget, since `os.statvfs` has no equivalent.
* **Job concurrency** is `MAX_CONCURRENT_JOBS` per cron drain; a job that
  exceeds the Worker CPU/duration limit is recovered on the next cron tick.

---

## 5. Configuration

`vars` in `wrangler.toml` (non-secret) and `wrangler secret put` (secret) are
both readable at runtime; values saved through the UI
(`PUT /api/config/environment`) are stored in KV and take precedence. Secret
values are encrypted with `AGENT_MASTER_KEY` (AES-GCM-256) and always returned
masked.

| Key | Default | Purpose |
| --- | --- | --- |
| `AUTH_ENABLED` | `false` | Turn RBAC on |
| `REQUIRE_FILE_APPROVAL` | `true` | Agent writes go through ChangeSets |
| `AGENT_PROXY_ENABLED` / `AGENT_PROXY_URL` | `false` / gateway URL | Outbound proxy |
| `CORS_ORIGINS` | `*` | Allowed origins |
| `RATE_LIMIT_PER_MINUTE` | `200` | Per-IP API limit (30 for login) |
| `MAX_CONCURRENT_JOBS` | `3` | Jobs drained per cron tick |
| `MAX_RETRY_SLEEP_SEC` | `20` | Cap on backoff sleep |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | — | Browser Rendering |
| `GITHUB_TOKEN` | — | Git + GitHub routes |
| `AGENT_MASTER_KEY` | dev fallback | Secret encryption key |
| `AGENT_AUTH_TOKEN` | — | Master bearer token (Admin) |

Default credentials when `AUTH_ENABLED=true`: **`admin` / `admin123`**
(override with `AGENT_INITIAL_ADMIN_PASSWORD`). Change it immediately.

---

## 6. Verified locally

`npm run typecheck` and `npx wrangler deploy --dry-run` both pass, and the
following were exercised end-to-end against `wrangler dev` with a mock provider:

* version/health/auth status, login → session cookie → RBAC 401/403 → logout
* project + workspace CRUD, activation, templates, session workspaces
* file create/read/write/rename/delete, previews (code/csv/image), raw serving,
  ZIP export
* ChangeSet creation from an approval-gated write → diff → approve → apply →
  version snapshots → compare → rollback → `.patch` export
* terminal built-ins (`ls`, `cat`, `grep`), dangerous-command gating, and the
  `unsupported` path for `python3`
* non-streaming `/api/chat` and SSE `/api/chat/stream` with a full tool-call
  round trip, auto file detection/saving and execution reporting
* background job: create → `waitUntil` execution → `done` with steps, logs and
  an R2 result artifact
* provider catalog, masked keys, model diagnostic test payload, circuit reset,
  providers export
* observability logs, metrics and CSV export
