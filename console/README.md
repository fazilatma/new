# Console install JSONs — run scraper4 as a PHP server via WebConsole / HostConsole

This directory contains ready-to-paste project JSONs for the **📄 ورود JSON**
(JSON import) tab of:

- **WebConsole Pro** — `webconsole.php` (`main` branch)
- **HostConsole (NVM + Node 20)** — `hostconsole.php` (`hostconsole-nvm-node20` branch)

Both consoles share the same project profile schema
(`name`, `type`, `repo_url`, `branch`, `subfolder`, `port`,
`install_cmd`, `build_cmd`, `start_cmd`, `env`, `auto_start`, `is_daemon`,
`preserve_configs`, `auto_update`, plus `node_version` on the hostconsole).
Import is data-only: it fills the project form, and **nothing runs until you
press Deploy/Install** — you can review every field after applying the JSON.

---

## 1) `project-scraper4-php.json` — the PHP server (use in either console)

What it does, in plain terms:

| Field | Value | Why |
|---|---|---|
| `type` | `php` | Single-file app, no composer step |
| `branch` | `arena/01a0ebf7-new` | Contains v10.174 + browser/ sidecar |
| `start_cmd` | `php -d max_execution_time=0 … -S 0.0.0.0:8000 server.php` | Runs the app through the built-in PHP server with **no time limit** (required for SSE streams) — same runtime flags as `server.sh` |
| `port` | `8000` | The console maps the domain publishing & PORT env to this |
| `env.PHP_CLI_SERVER_WORKERS` | `4` | **Real multi-process concurrency** — PHP ≥ 7.4 forks 4 workers, so a long SSE scrape never locks the admin UI |
| `is_daemon` | `true` | The console supervisor (wcp daemon) restarts the process if it ever exits |
| `preserve_configs` | `true` | Protects `connections.json`, `profiles.json`, sync state, etc. across redeploys |
| `auto_start` | `true` | Starts right after deploy |

### Import steps
1. Open the console → **پروژه‌ها / Projects** → **پروژه جدید / New project**.
2. Switch to the **📄 ورود JSON** tab.
3. Paste the whole content of `project-scraper4-php.json` → **اعمال در فرم**.
4. Review the filled form → **ذخیره پروفایل** → **نصب / Deploy** (or quick‑deploy).
5. Open `http://<host>:8000/` — the scraper4 login/UI should appear.
6. Optional: `http://<host>:8000/?selftest=1` for the built-in version self-tests,
   or publish a domain via the console's **دامنه / Domains** tab (points to port 8000).

> The internal cron tick (`php scraper4.php cron_run`) that `server.sh` normally
> runs every 60 s is not part of the service command. The app still advances its
> own background jobs whenever it is hit; if you want the unconditional ticker,
> add a host crontab entry: `* * * * * php /path/to/deploy/scraper4.php cron_run`.

---

## 2) `project-render-node20.json` — Playwright/Selenium sidecar (hostconsole with NVM)

The JS-rendering microservice that scraper4 calls for SPA sites
(P**laywright first, Selenium fallback**). Install it **second**, and prefer the
`hostconsole-nvm-node20` console: it can install **Node 20 via NVM** per project
(`node_version: "20"` is in the JSON).

| Field | Value | Notes |
|---|---|---|
| `subfolder` | `browser` | Service lives in `/browser` of the repo |
| `install_cmd` | `npm install … && npx playwright install chromium` | Downloads the Playwright Chromium build |
| `start_cmd` | `node server.js` | Plain-HTTP render API (`/render`, `/health`) |
| `env.RENDER_HOST` | `127.0.0.1` | **Loopback only** — only the PHP server on the same machine may call it |
| `env.RENDER_PORT` | `3100` | Must not collide with 8000 / 8888 |
| `env.RENDER_TOKEN` | `a9f27c1e4d3b88f0612c95e7d44a6b03` | Bearer token — copy **exactly this** into scraper4 admin (below) |
| `env.RENDER_DRIVER` | `auto` | Pl​​aywright, falling back to Selenium (`SELENIUM_URL` if you run one) |
| `env.RENDER_MAX_CONCURRENCY` | `3` | ~200–400 MB RAM per browser tab |
| `is_daemon` | `true` | Console restarts it on crash |

### Chromium system libraries
`npx playwright install chromium` fetches the browser, but the OS libraries it
needs must exist. If `/health` reports launch failures, run once from the
console's **Terminal** tab (as root):
```bash
cd <deploy_path>/browser && npx playwright install --with-deps chromium
```

### Wire it into scraper4
1. In the scraper4 admin UI → connection settings → **🧩 رندر جاوااسکریپت**
   (v10.174 panel).
2. Tick **✅ فعال**, set **آدرس سرویس** to `http://127.0.0.1:3100`,
   paste `a9f27c1e4d3b88f0612c95e7d44a6b03` as **توکن**, mode **خودکار**.
3. Save and press **🧪 آزمایش اتصال** — it should answer with
   `موتور فعال: playwright`.

The committed token above is only reachable on `127.0.0.1`; it cannot be used
from outside the host. If you still prefer your own secret, edit the `env`
before importing and use the same value in the admin panel.

---

## 3) About the branch

The JSONs pin `arena/01a0ebf7-new` (scraper4 **v10.174**). If you later run from
`main` or another branch, just change the `branch` value in the form/JSON — every
other field stays valid.

## Security notes

- JSON import is applied to your form for review; the console does not execute
  anything until you press deploy.
- `preserve_configs: true` keeps your `connections.json` (credentials, tokens,
  profiles) intact on every update/pull — do **not** disable it, or updates will
  wipe your runtime data.
- The render service is loopback-only by design; do not publish port 3100 on a
  public domain.
