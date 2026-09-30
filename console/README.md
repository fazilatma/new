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
| `branch` | `arena/01a0ebf7-new` | Contains v10.174 + browser-php/ pure-PHP renderer |
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

## 1b) HTTP 500 after deploy — how to diagnose (and the built-in guard)

The PHP project's `install_cmd` now runs **`php console/preflight.php`**:
an environment check that fails the deploy loudly — *before* you ever see a
blank 500 page — with a Persian readout of exactly what is missing (PHP version,
`curl` / `mbstring` / `json` / `openssl`, and crucially **`sqlite3`/`pdo_sqlite`
which the v10.170 task ledger needs**), plus writability of the install dir.

If you already got a 500:

1. In the console open the project's **log** — the PHP fatal is printed there
   (the service prints PHP errors to stderr by default).
2. Match it to the preflight list; the usual suspects on a minimal `php-cli`
   install are **`php-sqlite3`**, **`php-mbstring`**, **`php-curl`**:
   ```bash
   sudo apt install -y php-sqlite3 php-mbstring php-curl
   # نصب فول‌استک کنسول هم همه را می‌آورد: bash install-webconsole.sh
   ```
3. Redeploy. The preflight step will now pass and the app will come up.

If the 500 persists, paste the service log's fatal line — that line names the
exact function/file, and we fix from there instead of guessing.

---

## 2) `project-render-php.json` — Playwright/Selenium with **no Node/Python**

The JS-rendering microservice, rewritten to need **nothing but PHP itself**
(lives in `/browser-php` of the repo):

- **CDP engine ("Playwright")** — the service launches Chromium with
  `--remote-debugging-port=0` and speaks raw **Chrome DevTools Protocol over a
  hand-rolled PHP WebSocket client** (`browser-php/cdp.php`). That is exactly
  what Playwright does internally — minus the Node runtime.
- **Selenium engine** (fallback) — talks the standard **W3C WebDriver HTTP**
  protocol to the single native **`chromedriver` binary** (no Java, no npm).
- Browser binaries:
  `install_cmd` runs `bash bootstrap.sh` which detects any system
  Chrome/Chromium, and if none exists downloads the portable
  **Chrome-for-Testing** zip archives (plain files, no package runtime) into
  `browser-php/bin/`. Only system tools needed: `curl` + `unzip`.
- Service start: `bash start.sh` runs `php -S 127.0.0.1:3100 render.php` with
  `PHP_CLI_SERVER_WORKERS` matching `RENDER_MAX_CONCURRENCY` → real parallel
  renders + an `flock` semaphore that answers `503 Retry-After` when saturated.
- **API is byte-compatible** with the old Node service — scraper4's
  `render_probe` button and `fetch_html_render()` keep working untouched.

| Field | Value | Notes |
|---|---|---|
| `type` | `php` | Works in **both** consoles (only universal keys are used) |
| `subfolder` | `browser-php` | The pure-PHP engine |
| `install_cmd` | `bash bootstrap.sh` | Fetches chromium + chromedriver binaries |
| `start_cmd` | `bash start.sh` | Exports env, then `php -S` |
| `env.RENDER_TOKEN` | `a9f27c1e4d3b88f0612c95e7d44a6b03` | Copy **exactly** into scraper4 admin |
| `env.RENDER_DRIVER` | `auto` | CDP first, chromedriver fallback |

### Wire it into scraper4
1. Admin UI → **🧩 رندر جاوااسکریپت**: tick **✅ فعال**, URL
   `http://127.0.0.1:3100`, paste the token, mode **خودکار**.
2. Save → **🧪 آزمایش اتصال** should answer with
   `موتور فعال: playwright(CDP)`.

### If Chromium won't start (missing system libraries)
`find_chrome_bin()` failure surfaces in `/health` (`available.cdp: false`) and in
the service log. From the console's Terminal (as root) run:

```bash
cd <deploy>/browser-php && php -S 127.0.0.1:3100 render.php   # test manually
bash bootstrap.sh    # re-check downloads and library hints
```

`bootstrap.sh` prints the exact `apt install -y libnss3 …` line when it detects
the chromium binary cannot execute.

> The previous Node-based service still exists in `browser/` for hosts that
> already run Node — it is simply no longer required for anything.

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
