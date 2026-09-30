# Deployment Guide — Arena Agent on Cloudflare Workers

Everything below assumes you are in the `agent-worker/` directory.

---

## 0. Prerequisites

* Node.js 18+ (this port was built and verified on Node 22)
* A Cloudflare account with Workers enabled
* `npx wrangler login` (or a `CLOUDFLARE_API_TOKEN` env var for CI)

```bash
cd agent-worker
npm install
```

---

## 1. Create the backing resources

### 1.1 D1 (replaces SQLite)

```bash
npx wrangler d1 create arena-agent-db
```

Copy the printed `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "arena-agent-db"
database_id = "<paste-here>"
migrations_dir = "migrations"
```

Apply the schema:

```bash
npx wrangler d1 execute arena-agent-db --remote --file=./migrations/0001_init.sql
# local dev copy
npx wrangler d1 execute arena-agent-db --local  --file=./migrations/0001_init.sql
```

(The Worker also creates any missing table on its first request, so this is a
convenience, not a hard requirement.)

### 1.2 R2 (replaces the workspace filesystem)

```bash
npx wrangler r2 bucket create arena-agent-files
```

Key layout inside the bucket:

```
ws/<workspace-id>/<relative/path>    workspace files
uploads/<timestamp>_<filename>       chat uploads
job_outputs/<job-id>.json            job result artifacts
```

### 1.3 KV (replaces providers.json + .env)

```bash
npx wrangler kv namespace create CONFIG
```

Paste the returned `id` into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CONFIG"
id = "<paste-here>"
```

Keys written at runtime: `providers.json`, `environment.json`,
`browser:session:<id>`.

---

## 2. Secrets

```bash
# Encryption key for stored provider API keys — generate something long:
openssl rand -hex 32 | npx wrangler secret put AGENT_MASTER_KEY

# Optional master bearer token (grants Admin; also usable at /api/auth/login)
npx wrangler secret put AGENT_AUTH_TOKEN

# LLM providers — add only the ones you use
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put TOGETHER_API_KEY
npx wrangler secret put MISTRAL_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put OPENAI_API_KEY

# Publicly reachable Ollama endpoint (127.0.0.1 will NOT work from the edge)
npx wrangler secret put OLLAMA_BASE_URL

# GitHub PAT — enables every /api/git/* and /api/github/* route
npx wrangler secret put GITHUB_TOKEN

# Browser Rendering (real Chromium screenshots and page content)
npx wrangler secret put CLOUDFLARE_API_TOKEN
# and set CLOUDFLARE_ACCOUNT_ID in [vars] (it is not secret)

# First-run admin password (default: admin123)
npx wrangler secret put AGENT_INITIAL_ADMIN_PASSWORD
```

Keys can also be entered later in the UI under **Security & Settings** /
**Providers & Models**; those are encrypted with `AGENT_MASTER_KEY` and stored
in KV, where they take precedence over secrets and vars.

---

## 3. Non-secret settings

Edit `[vars]` in `wrangler.toml`:

```toml
[vars]
APP_VERSION           = "1.0.0"
AUTH_ENABLED          = "false"   # set "true" to require login
REQUIRE_FILE_APPROVAL = "true"    # agent writes go through ChangeSets
AGENT_PROXY_ENABLED   = "false"
AGENT_PROXY_URL       = "https://proxy.example.workers.dev/?url={url}"
CORS_ORIGINS          = "*"
RATE_LIMIT_PER_MINUTE = "200"
MAX_CONCURRENT_JOBS   = "3"
MAX_RETRY_SLEEP_SEC   = "20"
CLOUDFLARE_ACCOUNT_ID = ""        # required for Browser Rendering
```

---

## 4. Local development

```bash
cp .dev.vars.example .dev.vars    # fill in keys; the file is git-ignored
npm run dev                       # http://localhost:8787
```

Miniflare simulates D1, R2 and KV on disk under `.wrangler/`. Cron triggers are
not fired automatically in local dev; use `wrangler dev --test-scheduled` and
`curl "http://localhost:8787/__scheduled"` to exercise the job drain, or just
create jobs through `POST /api/jobs/chat` (they run via `waitUntil`).

Useful checks:

```bash
npm run typecheck                 # tsc --noEmit
npm run build                     # wrangler deploy --dry-run --outdir=dist
```

---

## 5. Deploy

```bash
npm run deploy
```

Wrangler uploads the Worker plus `./public` as static assets. Output:

```
https://arena-agent-worker.<your-subdomain>.workers.dev
```

Open it — the SPA loads and talks to the Worker at the same origin.

### Custom domain

```toml
routes = [
  { pattern = "agent.example.com", custom_domain = true }
]
```

---

## 6. Background jobs

`[triggers] crons = ["* * * * *"]` runs `scheduled()` every minute. It:

1. re-queues jobs stuck in `running` (respecting `max_retries`), then
2. drains up to `MAX_CONCURRENT_JOBS` queued jobs.

Jobs created through the API also start immediately via `ctx.waitUntil()`; the
cron is the supervision/recovery path.

---

## 7. CI/CD (GitHub Actions)

```yaml
name: Deploy Arena Agent Worker

on:
  push:
    branches: [main]
    paths: ['agent-worker/**']
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: agent-worker
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: agent-worker/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

The API token needs: *Workers Scripts:Edit*, *Workers KV Storage:Edit*,
*Workers R2 Storage:Edit*, *D1:Edit*, and *Browser Rendering:Edit* if you use it.

---

## 8. Post-deploy checklist

```bash
BASE=https://arena-agent-worker.<subdomain>.workers.dev

curl $BASE/health
curl $BASE/api/version
curl $BASE/api/providers | head -c 400
curl $BASE/api/observability/metrics
```

Then in the UI:

1. **Providers & Models → Test All** — confirm at least one model answers `OK`.
2. **Settings → Test Proxy** — only if you enabled a proxy.
3. Send a chat message and confirm tokens stream in.
4. Create a file through the agent and approve the ChangeSet.
5. If you set `GITHUB_TOKEN`, set a project `gitUrl` and check **Git → Status**.

### Enabling authentication

```bash
npx wrangler secret put AGENT_INITIAL_ADMIN_PASSWORD   # pick a strong one
# set AUTH_ENABLED = "true" in [vars], then:
npm run deploy
```

Log in as `admin`, then create per-user accounts under **Users** and delete or
re-password the bootstrap account.

---

## 9. Operations

| Task | Command |
| --- | --- |
| Tail logs | `npx wrangler tail` |
| Query D1 | `npx wrangler d1 execute arena-agent-db --remote --command "SELECT status, COUNT(*) FROM jobs GROUP BY status"` |
| List R2 keys | `npx wrangler r2 object list arena-agent-files --prefix ws/default/` |
| Read a KV key | `npx wrangler kv key get --binding CONFIG providers.json` |
| Purge old jobs | `curl -X DELETE "$BASE/api/jobs/cleanup?days=7"` |
| Export workspace | `curl -o ws.zip "$BASE/api/workspace/export-zip"` |
| Export audit log | `curl -o audit.csv "$BASE/api/observability/export?format=csv"` |

### Limits to watch

* **Worker CPU** — `[limits] cpu_ms = 300000` (5 min) is set; long agent loops
  with many steps may still need to be split into jobs.
* **D1** — 10 GB per database; `app_logs` self-trims to the newest 2000 rows.
* **R2** — no practical cap; the metrics gauge uses a 1 GiB display budget.
* **KV** — 25 MB per value; `providers.json` is far below that.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `No API key configured for provider …` | Set the secret, or enter the key in the UI (stored in KV). |
| `unsupported: true`, exit code 127 | Expected — no process execution on Workers. See README §4.1. |
| Screenshots look like wireframes | Browser Rendering is not configured. Set `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`. |
| `GITHUB_TOKEN is not configured` | Set the secret; git/GitHub routes need it. |
| Ollama unreachable | `127.0.0.1` is not reachable from the edge; expose it publicly via `OLLAMA_BASE_URL`. |
| Proxy ignored, `proxyClient` in response | Socket proxies are unsupported by `fetch`; use a `?url={url}` gateway proxy. |
| Rate limit feels inconsistent | The limiter is isolate-local. Use Cloudflare Rate Limiting rules for hard limits. |
| `D1_ERROR: no such table` | Run the migration: `npx wrangler d1 execute arena-agent-db --remote --file=./migrations/0001_init.sql`. |
