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

## 1b) HTTP 500 with an *empty* log — the boot guard (v10.175)

Since **v10.175** the app cannot die silently any more. `server.php` installs a
boot guard *before anything else runs*, and every fatal
(E_ERROR / parse error during include / uncaught Throwable) is reported to
**all three** channels at once:

1. **`console-error.log`** — a dedicated file next to `scraper4.php` (falls back
   to the system temp dir when the deploy dir isn’t writable; capped at 256 KB);
2. **stderr** — the channel that the console’s «لاگ سرویس» tails;
3. **the browser itself** — the HTTP 500 response body now *contains* the exact
   error message, file and line. You don’t need log access at all to see it.

### Two-hit triage (30 seconds, from the browser)

| Hit | Result | Meaning |
|---|---|---|
| `http://<host>:8000/?ping=1` | answers `boot-ok \| scraper4 v10.175 …` | PHP + router are fine; the tail of `console-error.log` is printed right below |
| `http://<host>:8000/` | 500 **with the error text in the body** | the fatal *inside the app* — that line is the fix target |

If even `?ping=1` doesn’t answer, the app isn’t the problem: the service never
started or the console proxy can’t reach port 8000. Confirm from the console
Terminal (bypasses the proxy):

```bash
curl -i http://127.0.0.1:8000/?ping=1
```

- answers → service fine; fix the console’s domain/port mapping instead.
- connection refused → service down; the console’s **install** log (not the
  service log) then holds the truth — e.g. the preflight failing the deploy.

### After the fix

Set `S4_BOOT_DEBUG` to `0` in the project’s env (the shipped JSON enables it on
purpose during bring-up). The file log keeps working either way.

> Also in v10.175: `server.php` refuses to serve `console-error.log`,
> `connections.json` and `profiles.json` as static downloads — the built-in
> server would otherwise happily hand them out.

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
  `browser-php/bin/`. It prefers `chrome-headless-shell` (the minimal headless
  build — the right choice for CDP). **No `apt`, no `unzip`, no package
  manager needed:** downloads fall back `curl → wget → python3 urllib`, and
  zip extraction falls back `unzip → python3 -m zipfile → php ZipArchive`.
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

### If Chromium won't start (missing shared libraries)
On a host without `apt`/root this is the *only* realistic failure mode: the
binary downloads fine but the OS lacks e.g. `libnss3.so` for the full build.
Hints on what to do:

1. `bash bootstrap.sh` auto-picks **`chrome-headless-shell`** first — that
   minimal build has a much smaller library footprint and usually starts where
   full Chrome does not. Only when the full build is needed does it show a
   "depends on …" report (`ldd`).
2. Check availability without importing anything:
   ```bash
   cd <deploy>/browser-php
   php -r "require 'render.php'; "   # or simply /health once running
   bash bootstrap.sh                 # prints per-binary ldd hints
   ```
3. If the headless shell also fails to start on this host, the remaining
   options are the host admin / the console's own full-stack installer (its
   lamp/lemp installer can install system packages), **or the Node-based
   `browser/` service below** — your host already has Node 20, and Playwright
   bundles its own browser with the required libs (`npx playwright install
   --with-deps chromium` still needs `apt`; `npx playwright install chromium`
   alone often works if the system libs already exist, which they may not).

> The Node-based service still lives in `browser/` (`project-render-node20.json`
> on request in the history of branch `8ace7fc~1`). On your host — Node 20 is
> installed — it is a perfectly good second way if every PHP-route browser
> binary refuses to start; the API contract is identical, so scraper4 doesn't
> know the difference.

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
