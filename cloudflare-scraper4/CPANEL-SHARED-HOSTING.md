# Running Scraper 4 on cPanel shared hosting (Node.js + Python)

راهنمای اجرای اسکرپر ۴ روی هاست اشتراکی cPanel — Node.js Selector و Python Selector.

This guide targets "advanced" shared plans that expose **Setup Node.js App**
(CloudLinux Node.js Selector + Phusion Passenger) and **Setup Python App**.
Everything below was verified against this project's real dependency tree.

---

## 1. What actually installs on shared cPanel

The short answer: **anything pure-JavaScript or shipping a prebuilt wheel/binary
installs fine. Anything that must be compiled from C/C++ source, or that
downloads a browser, does not.**

Shared hosting normally has no `gcc`/`make` toolchain, a hard RAM cap
(commonly 512 MB–1 GB per process), an inode quota, and no root.

### Node.js — this project

| Package | Installs on shared cPanel? | Why |
| --- | --- | --- |
| `hono`, `@hono/node-server` | ✅ yes | pure JS |
| `cheerio` | ✅ yes | pure JS |
| `undici` | ✅ yes | pure JS |
| `pg` (PostgreSQL) | ✅ yes | pure JS driver |
| `read-excel-file` | ✅ yes | pure JS |
| `esbuild` | ⚠️ usually yes | ships a prebuilt binary; if it is blocked use `esbuild-wasm` |
| `playwright` | ❌ no | downloads a ~300 MB Chromium; blows the disk/RAM quota |
| `puppeteer` | ❌ no | same — downloads Chrome |
| `crawlee` | ❌ no | pulls Playwright with it |
| `better-sqlite3` | ❌ no | native C++, needs a compiler |

**You do not need the browsers.** They are loaded lazily
(`await import('playwright')`) and only by the `playwright`, `puppeteer` and
`crawlee_playwright` engines. The `htmlrewriter`, `cheerio`, `script_json`,
`next_data` and `heuristic` engines cover normal server-rendered shops and need
none of them.

**SQLite needs no package at all.** The project uses Node's built-in
`node:sqlite` (Node ≥ 22.5). Pick Node **22 or newer** in cPanel and the local
database works with zero native modules. On Node 20 you must use PostgreSQL via
`DATABASE_URL` instead.

Verified install of the runtime-only set: **56 packages, 17 MB, no compiler**,
and the server booted and answered `/health` and `/` with HTTP 200.

### Python — the Basalam SDK

`pip install basalam-sdk` works: it pulls `pydantic`/`pydantic-core`/`httpx`,
and `pydantic-core` ships a **prebuilt manylinux wheel**, so no Rust or C
compiler is required. Verified: 41 MB venv, and the bridge answered

```json
{"ok": true, "transport": "sdk", "sdkVersion": "1.2.0", "python": "3.11.2"}
```

Rule of thumb for Python on shared hosting: pure-Python and any package with a
`manylinux` wheel install; anything needing `python3-dev` + compiler (or Rust)
does not.

---

## 2. Step-by-step deployment

### Step 1 — Check support

cPanel → **Software**. You need **Setup Node.js App**. If it is missing, the
plan does not support Node and you need an upgrade or a VPS.
For the Basalam SDK you also want **Setup Python App** or SSH access.

### Step 2 — Build locally, not on the server

Shared hosting rarely has enough RAM to build. On your own machine:

```bash
git clone <your repo>
cd cloudflare-scraper4
npm install
npm run render:build          # produces render-dist/
```

Upload **only** these to a folder *outside* `public_html` (for example
`/home/USER/scraper4`):

```
render-dist/          # the built server
package.json          # the slim one from step 3
migrations/           # only if you use PostgreSQL
scripts/basalam-sdk-bridge.py
```

Never upload `node_modules` from Windows/macOS — native artefacts are
OS-specific. Never upload `data/` or `storage/`.

### Step 3 — Use a slim `package.json` on the server

Create this next to `render-dist/`. It deliberately omits the browsers:

```json
{
  "name": "scraper4",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "app.js",
  "scripts": { "start": "node render-dist/server.js" },
  "dependencies": {
    "@hono/node-server": "^1.19.1",
    "cheerio": "^1.1.2",
    "hono": "^4.13.3",
    "pg": "^8.16.3",
    "read-excel-file": "^5.8.8",
    "undici": "^7.29.0"
  }
}
```

### Step 4 — Create the Node.js app

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
| --- | --- |
| Node.js version | **22.x or newer** (needed for built-in `node:sqlite`) |
| Application mode | Production |
| Application root | `scraper4` (NOT inside `public_html`) |
| Application URL | your domain or subdomain |
| Application startup file | `app.js` |

### Step 5 — Add the Passenger entry file

Passenger does not run `npm start`; it imports the startup file. Create
`app.js` in the application root:

```js
// Passenger entry point. It sets PORT itself; render-dist/server.js already
// honours process.env.PORT, so it only has to be imported.
import './render-dist/server.js';
```

A ready-made copy of this file ships as `scripts/cpanel-app.js`.

### Step 6 — Environment variables

In the same cPanel screen, under **Environment variables**, add:

| Variable | Value |
| --- | --- |
| `ADMIN_TOKEN` | a long random string — required to open the dashboard |
| `VAULT_SECRET` | a long random string — encrypts the stored API tokens |
| `SCRAPER4_SQLITE_PATH` | `/home/USER/scraper4/data/scraper4.sqlite` |
| `BASALAM_PYTHON` | `/home/USER/virtualenv/scraper4py/3.11/bin/python` (step 8) |
| `LOCAL_SCRAPER_AUTO_UPDATE` | `0` — shared hosting cannot self-update from git |

Do not set `PORT`; Passenger assigns it.

### Step 7 — Install dependencies

Click **Run NPM Install**. If it is killed for memory, use SSH with the
activation command shown at the top of the cPanel Node screen:

```bash
source /home/USER/nodevenv/scraper4/22/bin/activate
cd /home/USER/scraper4
NODE_OPTIONS='--max-old-space-size=512' npm install --omit=dev
```

### Step 8 — Python + the Basalam SDK (optional but recommended)

Sending to Basalam works without it (the REST fallback), but the official SDK
is tried first.

cPanel → **Setup Python App** → create an app (Python 3.9+), then:

```bash
source /home/USER/virtualenv/scraper4py/3.11/bin/activate
pip install basalam-sdk
python -c "import basalam_sdk; print('ok')"
```

Then point `BASALAM_PYTHON` at that interpreter (step 6) and verify:

```bash
echo '{"action":"probe"}' | $BASALAM_PYTHON /home/USER/scraper4/scripts/basalam-sdk-bridge.py
# -> {"ok": true, "transport": "sdk", "sdkVersion": "1.2.0", ...}
```

### Step 9 — Start and verify

Press **Restart** in cPanel, then:

```
https://your-domain/health      -> {"ok":true,...,"databaseReady":true}
https://your-domain/            -> the dashboard
```

---

## 3. Choosing the database

| Option | When | How |
| --- | --- | --- |
| **SQLite** (default) | Node ≥ 22, single process | set `SCRAPER4_SQLITE_PATH`, create the `data/` folder, chmod 755 |
| **PostgreSQL** | Node 20, or you want backups via cPanel | create a DB in cPanel, set `DATABASE_URL=postgres://user:pass@localhost:5432/dbname` |

MySQL is *not* supported by this project — cPanel offers it, but the code
speaks SQLite and PostgreSQL only.

---

## 4. Known limits on shared hosting

- **No PM2/forever/systemd.** Passenger is the process manager. `npm start`,
  `node server.js` and `pm2 start` will not serve the app.
- **Restart after every code change** — Passenger caches. Use the Restart
  button or `touch tmp/restart.txt`.
- **Long scrapes may be killed.** Shared plans enforce CPU/RAM/time limits.
  Keep `pages` small, lower `DETAIL_CONCURRENCY` (try `2`), and prefer the
  lightweight engines.
- **Browser engines are unavailable**, so JavaScript-only shops cannot be
  scraped here. Use Render/VPS/Termux for those, or point
  `BROWSER_EXECUTABLE_PATH` at a system Chrome if your host happens to have one.
- **Cron:** use cPanel → Cron Jobs to call `render-dist/cron.js` with the
  virtualenv-activated node binary; the in-process scheduler may be suspended
  when the app idles.
- **WebSockets are unreliable** through Passenger. This project uses plain
  HTTP polling, so it is unaffected.
- **The auto-updater must stay off** (`LOCAL_SCRAPER_AUTO_UPDATE=0`); it does
  `git reset --hard`, which is wrong for an uploaded build.

---

## 5. Quick troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| 503 Service Unavailable | app crashed at startup — read cPanel → Metrics → Errors |
| "Cannot find module" | `npm install` not run inside the virtualenv (step 7) |
| `node:sqlite` import fails | Node version < 22.5 — switch version or use `DATABASE_URL` |
| Killed during `npm install` | add `NODE_OPTIONS='--max-old-space-size=512'` |
| Dashboard asks for a token forever | `ADMIN_TOKEN` not set in Environment variables |
| "Application root already in use" | another Node/Python app owns that folder; check its `.htaccess` |
| Basalam SDK never used | `BASALAM_PYTHON` wrong — run the probe in step 8 |
