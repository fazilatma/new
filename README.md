# 🚀 WebConsole Pro & Cloudflare Workers Edge Suite

> **All-in-One Multi-Runtime Management Console, Universal Forward Proxy, & VPS/Termux/Cloudflare Automation Platform**  
> *Suite Version: 2.12.0 | Multi-Platform: Ubuntu / Debian / CentOS / Rocky / AlmaLinux / Alpine / Arch / Android Termux / GitHub Codespaces / Cloudflare Workers*

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

## 🌐 5. Domain Publishing — Run Projects Without Exposing a Port

`hostconsole.php` can publish any Node.js / Python project on a **domain instead of a port**.
On shared hosting only ports **80/443** pass the firewall, so `http://your-server:3000` is unreachable
from the internet. The console writes a **reverse proxy** so the same app is served over HTTPS while
it keeps listening on `127.0.0.1:3000`.

### 🔀 Two publishing kinds

Pick one in the project's **🌐 دامنه** dialog — a segmented control with a live URL preview:

| Kind | Result | Does the console create the subdomain / DNS record? |
| :--- | :--- | :--- |
| **🔗 Subdomain** | `https://app.example.com` | **No.** Create it in cPanel/DirectAdmin first (except `cloudflared`, which creates the DNS record itself via `tunnel route dns`). |
| **📁 Folder on the main domain** | `https://example.com/app` | **Nothing to create.** Reuses the existing domain and its SSL certificate — zero DNS work. |

> Folder mode is the fastest path on shared hosting: no panel access, no DNS propagation, no extra
> certificate. The console mounts the app under a sub-path of `public_html` and strips the `/app`
> prefix before forwarding, while sending `X-Forwarded-Prefix` so the app can build correct links.

#### ⚠️ Conflict with WordPress / Laravel at the site root

A catch-all `RewriteRule … /index.php` in the root `.htaccess` would swallow `/app` before the proxy
sees it. The console detects this, shows a warning, and can insert an exclusion automatically:

```apache
# >>> WCP-DOMAIN:<id>-root >>>
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^app(/|$) - [L]
</IfModule>
# <<< WCP-DOMAIN:<id>-root <<<
```

It is written **above** the existing rules, your own rules are untouched, a `.wcp-bak` backup is kept,
and the block is removed again when you delete the mapping.

### 🧭 New "دامنه‌ها / Domains" tab

| Element | Description |
| :--- | :--- |
| Server probe | Detects web root, Apache/LiteSpeed/Nginx, `mod_proxy`, `mod_rewrite`, sudo, cURL |
| Base settings | Base domain, `public_html` root, default publishing mode, Cloudflare tunnel name |
| Per-project mapping | Publishing kind (subdomain / folder), domain, mode, folder name, document root, bind host, WebSocket, force-HTTPS, timeout |
| Actions | Apply · Re-apply · Config preview · Access test (DNS + backend + public HTTP) · Remove |

### ⚙️ Five publishing modes (auto-selected by capability)

| Mode | Works on | WebSocket | Needs root |
| :--- | :--- | :---: | :---: |
| `htaccess` | Apache / LiteSpeed with `mod_proxy` | ✅ | ❌ |
| `phpproxy` | **Any shared host** (generates a streaming PHP reverse-proxy shim) | ❌ | ❌ |
| `apache` | Apache VirtualHost + `a2ensite` + reload | ✅ | ✅ |
| `nginx` | Nginx server block + `nginx -t` + reload | ✅ | ✅ |
| `cloudflared` | Cloudflare Tunnel ingress (no open ports, no static IP) | ✅ | ❌ |

`manual` mode generates the config text only, for pasting into a hosting panel.

### 🚀 Quick start A — folder on an existing domain (no DNS work)

1. Console → **دامنه‌ها** → set **Base domain** (e.g. `example.com`) and save.
2. Project → **🌐 دامنه** → enable → choose **📁 پوشه روی دامنه** → folder `/app` → save.
3. Start the project (▶). Open `https://example.com/app/` — done.
4. If the root is WordPress/Laravel, press **🔧 رفع تداخل** when the console offers it.

### 🚀 Quick start B — subdomain (cPanel / DirectAdmin)

1. Create the subdomain in your hosting panel and note its Document Root (e.g. `~/public_html/app`).
2. Console → **پروژه‌ها** → project → **🌐 دامنه** → enable → **🔗 ساب‌دامین** → `app.example.com` → save.
3. Start the project (▶). It binds to `127.0.0.1:<port>`; the proxy is applied automatically on every start and deploy.
4. Issue a free Let's Encrypt certificate for the subdomain, then press **🧪 تست**.

### 🔌 Bind-address fix

Projects now receive `HOST` / `BIND_HOST` / `LISTEN_HOST` / `SERVER_HOST` / `APP_HOST` /
`UVICORN_HOST` / `FLASK_RUN_HOST` environment variables automatically:

* **`0.0.0.0`** when no domain is configured → the port really is reachable from outside (if the firewall allows it).
* **`127.0.0.1`** when a domain is configured → the app stays private and is only reachable through the proxy.

### 🧩 API endpoints

`dom.detect` · `dom.list` · `dom.status` · `dom.preview` · `dom.apply` · `dom.remove` · `dom.test` ·
`dom.settings` · `dom.fix_parent` (insert the root `.htaccess` exclusion for folder mode)

Generated files are wrapped in `# >>> WCP-DOMAIN:<id> >>>` markers, so existing `.htaccess` rules are
preserved on apply and cleanly removed on delete (a `.wcp-bak` backup is kept).

---

## 🟩 6. Node.js version per project (NVM)

Shared hosts ship an old system Node, so `hostconsole.php` runs projects from the **account's own
NVM** (`~/.nvm`) — no root required. Pick the version per project in the project dialog; the list
shows every installed version and marks the ones that ship `node:sqlite` without a flag.

Resolution order when a project does not pin a version:

1. the console-wide default (`node_version` setting),
2. the account's `nvm alias default`,
3. the newest installed version.

### Installing a version

The ⬇️ button next to the selector runs the install as a background job. The equivalent shell
commands over SSH:

```bash
# once, if nvm itself is missing
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash

export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"

nvm install 24          # current Active LTS
nvm alias default 24    # make it the default for new shells
node -v
```

### `node:sqlite` version floor

`node:sqlite` was added in **22.5.0** but stayed behind `--experimental-sqlite` until
**22.13.0** and **23.4.0** ([nodejs/node#55890](https://github.com/nodejs/node/pull/55890)), so
`23.0–23.3` is a gap:

| Node | `import 'node:sqlite'` |
| :--- | :--- |
| ≤ 22.12 | ❌ `No such built-in module` |
| 22.13 – 22.x | ✅ |
| 23.0 – 23.3 | ❌ |
| ≥ 23.4 (incl. 24 LTS) | ✅ |

The deploy preflight checks this and fails early when the project imports `node:sqlite` on a runtime
that cannot provide it. The alternative is to set `DATABASE_URL` to a PostgreSQL connection string.

---

## 📱 7. Android Termux Battery & Kernel Optimization

* **Zero Background Drain:** Run `wcp off` or `wcp shutdown` when finished to pause all background daemons.
* **SELinux OPcache Fix:** Bypasses unrooted Android `/tmp` semaphore restrictions automatically.
* **Portable Paths:** Seamlessly maps storage between `$PREFIX/tmp` and `$HOME/webconsole`.

---

## 🔢 Versioning

The suite uses Semantic Versioning. Each console file carries its own `WCP_VERSION`, and
`WCP_EDITION` tells the in-app updater which file to pull from GitHub — so `hostconsole.php`
can never be overwritten by `webconsole.php` again.

| Component | Version |
| :--- | :---: |
| `hostconsole.php` (shared hosting) | **2.12.0** |
| `webconsole.php` (VPS) | 2.9.0 |
| `wcp` CLI · `install.sh` · `update.sh` | 2.12.0 |
| `webconsole.worker.js` (Cloudflare) | 2.8.0 |

Full release notes: [CHANGELOG.md](CHANGELOG.md).

> `2.10.0` is newer than `2.9.2` — the updater compares with PHP `version_compare()`, which reads
> each dot-segment as a number (`10 > 9`).

---

## 📄 License

Open-source under the MIT License. Developed for automated web operations, cloud scraping, and edge computing.
