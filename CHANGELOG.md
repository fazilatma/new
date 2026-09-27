# 📋 Changelog — WebConsole Pro Suite

All notable changes to this repository.
Format follows [Keep a Changelog](https://keepachangelog.com/) and the suite uses
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

> **Note on `2.10.0`** — `2.10.0` is *newer* than `2.9.2`. The in-app updater compares versions with
> PHP `version_compare()`, which parses each dot-segment numerically (`10 > 9`), so the ordering is correct.

## 🔢 Component versions

Each console file carries its own `WCP_VERSION`; the suite version is the highest of them.

| Component | Version | Notes |
| :--- | :---: | :--- |
| `hostconsole.php` | **2.10.0** | Shared-hosting edition (`WCP_EDITION = hostconsole`) |
| `webconsole.php` | 2.9.0 | VPS edition — domain publishing not ported yet |
| `wcp` (CLI) | 2.10.0 | Follows the suite version |
| `install.sh` / `update.sh` | 2.10.0 | Follows the suite version |
| `webconsole.worker.js` | 2.8.0 | Cloudflare Workers edition, versioned separately |

---

## [2.10.0] — 2026-09-27 · `hostconsole.php`

### Added
* **🌐 Domain / Subdomain publishing** — run a Node.js/Python project on `https://app.example.com`
  instead of an unreachable `:3000`. New **«دامنه‌ها»** tab with a server-capability probe, base
  settings (base domain, web root, default mode, tunnel name) and per-project mapping.
* **Five reverse-proxy modes**, auto-selected by what the host actually supports:
  `htaccess` (Apache/LiteSpeed `mod_proxy`), `phpproxy` (streaming PHP shim — works on any shared
  host), `apache` (VirtualHost), `nginx` (server block), `cloudflared` (tunnel ingress), plus a
  `manual` mode that only renders the config for copy-pasting into a hosting panel.
* **Generated PHP proxy shim** — streams request/response bodies, de-chunks `Transfer-Encoding:
  chunked`, rewrites upstream `Location` headers, forwards `Set-Cookie` and `X-Forwarded-*`,
  preserves the public `Host`, and renders a friendly `502` page when the backend is down.
  Falls back to raw sockets when the cURL extension is missing.
* **New API actions**: `dom.detect`, `dom.list`, `dom.status`, `dom.preview`, `dom.apply`,
  `dom.remove`, `dom.test`, `dom.settings`.
* **New settings**: `web_root`, `base_domain`, `domain_mode`, `cf_tunnel`, `console_file`
  (included in settings export/import).
* **New project fields**: `domain_enabled`, `domain`, `domain_mode`, `domain_path`,
  `domain_docroot`, `domain_ws`, `domain_https`, `domain_timeout`, `bind_host` — also accepted by
  the portable JSON project profile.
* `WCP_EDITION` constant, exposed in the boot payload and shown next to the version chip in the UI.

### Fixed
* **Self-update overwrote the wrong file.** `console_check_update()` / `console_self_update()`
  hard-coded `webconsole.php`, so pressing *«به‌روزرسانی آنی»* inside `hostconsole.php` replaced it
  with the VPS edition. Both now resolve the running file via `wcp_console_source()`
  (`console_file` setting → `basename(__FILE__)` → `WCP_EDITION`) and refuse to install a file from
  a different edition.
* **Apps bound to the wrong interface.** Projects now receive `HOST`, `BIND_HOST`, `LISTEN_HOST`,
  `SERVER_HOST`, `APP_HOST`, `SCRAPER_BIND_HOST`, `DEPLOYER_UI_HOST`, `UVICORN_HOST` and
  `FLASK_RUN_HOST` automatically: `0.0.0.0` when no domain is configured (so the port really is
  reachable), `127.0.0.1` when a domain is configured (so the app is only reachable via the proxy).
* Mount-path validation used `~` both as regex delimiter and inside the character class, which
  rejected every non-root path such as `/app`.

### Security
* Config writes are wrapped in `# >>> WCP-DOMAIN:<id> >>>` markers, so pre-existing `.htaccess`
  rules survive apply/remove; a one-time `.wcp-bak` backup is kept per file.
* Domain, mount path, document root and bind host are validated server-side; the generated shim
  refuses any proxy target that is not a loopback/private address.

---

## [2.9.2] — 2026-09-25
* `wcp proj` table now prints a direct web-application URL column.

## [2.9.0] — 2026-09-25
* Compact project cards, a clickable web-link button and a unified single-row action toolbar.
* `hostconsole.php` introduced (2026-09-26) with shared-hosting NVM Node.js support.

## [2.8.8] — 2026-09-25
* Validated clean IPv4 detector so `403` HTML error pages can no longer corrupt printed server URLs.

## [2.8.5] — 2026-09-25
* Installer menu extended to five options: dedicated Node.js 22 (4) and Python 3 scraping stack (5).

## [2.8.0] — Cloudflare Workers edition
* `webconsole.worker.js`: edge proxy, D1 SQL console, KV explorer, Workers AI chat, JS REPL.

<!-- Older releases: see `git log` in this repository. -->
