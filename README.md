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

## 📄 License

Open-source under the MIT License. Developed for automated web operations, cloud scraping, and edge computing.
