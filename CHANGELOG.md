# 📋 Changelog — WebConsole Pro Suite

All notable changes to this repository.
Format follows [Keep a Changelog](https://keepachangelog.com/) and the suite uses
[Semantic Versioning](https://semver.org/) (`MAJOR.MINOR.PATCH`).

> **Note on `2.10.0` / `2.11.0`** — `2.10.0` is *newer* than `2.9.2`. The in-app updater compares versions with
> PHP `version_compare()`, which parses each dot-segment numerically (`10 > 9`), so the ordering is correct.

## 🔢 Component versions

Each console file carries its own `WCP_VERSION`; the suite version is the highest of them.

| Component | Version | Notes |
| :--- | :---: | :--- |
| `hostconsole.php` | **2.13.0** | Shared-hosting edition (`WCP_EDITION = hostconsole`) |
| `webconsole.php` | 2.9.0 | VPS edition — domain publishing not ported yet |
| `wcp` (CLI) | 2.13.0 | Follows the suite version |
| `install.sh` / `update.sh` | 2.13.0 | Follows the suite version |
| `webconsole.worker.js` | 2.8.0 | Cloudflare Workers edition, versioned separately |

---

## [2.13.0] — 2026-09-27 · `hostconsole.php` · 🔒 security release

### Security
* **🚨 Unauthenticated SSRF in the forward proxy gateway (`?url=`).** The gateway ran *before* the
  login and IP checks and passed any URL straight to cURL with `FOLLOWLOCATION`, with no target
  validation. Anyone who knew the console's URL could read internal services through the host —
  including the very project ports the domain feature binds to `127.0.0.1`, plus cloud metadata at
  `169.254.169.254`. Verified against a private app on `127.0.0.1:3000`: the pre-fix build returned
  its body to an anonymous internet request; the fixed build returns `403`.
  * Targets resolving to loopback, private, link-local or reserved ranges are now rejected, by IP
    *and* by hostname (so `127.0.0.1.nip.io` style names are caught too).
  * Redirects are no longer followed blindly: each hop is re-validated, so an external URL can no
    longer `302` the proxy into the private network. Legitimate redirect chains still work.
  * `CURLOPT_PROTOCOLS` is pinned to HTTP/HTTPS.
  * Override with **Allow internal addresses** only if you really mean it.
* **Credential leakage.** `Cookie` and `Authorization` were forwarded to arbitrary third-party
  targets — including the console's own `WCPSESS` session cookie, i.e. a full admin session handed
  to whatever site was proxied. They are now stripped by default (toggle: *Forward cookies and
  Authorization*), and `WCPSESS` is **always** removed even when forwarding is enabled.
* **Optional access key.** Set a token and the gateway requires `&key=…` (or an `X-WCP-Key`
  header), compared with `hash_equals()`. Empty = open to anyone who knows the URL, which the
  settings card now warns about explicitly.
* **Optional host allowlist** — restrict the gateway to named domains and their subdomains.
* The gateway can be **switched off entirely**.

### Added
* **🛡️ Proxy gateway card in Settings** showing the **exact working URL of the gateway on this
  install** (built from the real script path), with copy button, the toggles above, a key
  generator, and an outbound connectivity test.
* **New API actions**: `gw.info` and `gw.test`.

### Fixed
* Silent failures replaced with explicit, human-readable responses: disabled gateway → `403`,
  missing/invalid key → `401`, bad target → `400`, blocked target → `403` with the reason. The old
  build answered a malformed `url` with a bare "Error:" string and nothing else.

---

## [2.12.0] — 2026-09-27 · `hostconsole.php`

### Fixed
* **🚨 Node.js version was hard-pinned to v20.** `wcp_nvm_node_bin()` globbed
  `~/.nvm/versions/node/v20*/bin` *first*, so every project kept running on Node 20 no matter which
  newer version was installed with NVM — the reason `node:sqlite` failed with
  *"No such built-in module: node:sqlite"* on a host that already had Node 22/24 available.
  Resolution order is now: **project's pinned version → console-wide default → the account's
  `nvm alias default` → newest installed version.**

### Added
* **Per-project Node.js version.** New `node_version` field and a selector in the project dialog
  listing every version installed in the account's NVM, each tagged with whether it ships
  `node:sqlite` unflagged. Empty = automatic. Included in exported/imported JSON profiles.
* **One-click NVM install.** The ⬇️ button next to the selector runs `nvm install <version>` as a
  background job in the hosting account's home — no root, no SSH. If NVM itself is missing it is
  bootstrapped from the official `nvm-sh` install script (`WCP_NVM_RELEASE`) first. The dialog polls
  the job and refreshes the list when it finishes.
* **`node:sqlite` capability check in preflight**, using the real release boundary rather than a
  naive floor: the module is unflagged in **22.13+** and **23.4+**, so `23.0–23.3` is a hole
  (nodejs/node#55890). If the project's `package.json` mentions `node:sqlite` and the selected
  runtime cannot provide it, the deploy preflight now **fails loudly** instead of dying at runtime;
  otherwise it is reported as information and names an installed version that would work.
* **New API actions**: `sys.node_versions` (installed versions, resolved selection, NVM state) and
  `sys.nvm_install` (background install). New job type `nvm_install`.
* **New helpers**: `wcp_nvm_versions()`, `wcp_node_has_sqlite()`, `wcp_nvm_default_alias()`,
  `wcp_node_version_of()`; `wcp_nvm_node_bin()` / `wcp_node_path()` now take an optional version.

### Changed
* Preflight guidance no longer tells shared-hosting users to install Node 20; it recommends the
  current LTS (24) and reports which installed version the project will actually use.

---

## [2.11.0] — 2026-09-27 · `hostconsole.php`

### Added
* **📁 Folder publishing (`example.com/app`) as a first-class choice.** Publishing a project no longer
  requires a subdomain. The domain dialog now opens with a segmented control:

  | Kind | Public URL | Manual DNS / panel work |
  | :--- | :--- | :--- |
  | 🔗 Subdomain | `https://app.example.com` | Create the subdomain in the panel (except Cloudflare Tunnel, which creates the DNS record itself) |
  | 📁 Folder on the main domain | `https://example.com/app` | **None** — reuses the existing domain and SSL certificate |

* **Live URL preview** in the domain form — the final address updates as you type the domain, the
  folder name, or toggle HTTPS, so there is no guessing what will be published.
* **Root `.htaccess` conflict detection and one-click fix.** When the site root runs WordPress,
  Laravel, Joomla or anything else with a catch-all `RewriteRule … /index.php`, that rule would
  swallow `/app` before the proxy ran. The console now detects it, warns in **dom.status**, and
  **🔧 رفع تداخل** (or an automatic pass during apply) inserts a marker-wrapped exclusion
  `RewriteRule ^app(/|$) - [L]` **above** the existing rules. A `.wcp-bak` backup is written and the
  block is stripped again on removal — user rules are never touched.
* **New API action `dom.fix_parent`**; `dom.status` and `dom.apply` now return `kind` and a `parent`
  object (`applies`, `exists`, `writable`, `catch_all`, `protected`, `segment`, `snippet`).
* **`X-Forwarded-Prefix`** is now sent in `htaccess`/`mod_proxy` mode as well (the PHP proxy shim
  already sent it), so frameworks can generate correct absolute links under a sub-path.
* **New project field `domain_kind`** (`subdomain` | `path`), included in exported/imported JSON
  profiles and validated on import.

### Changed
* The **دامنه‌ها** tab opens with an explicit *"Is the subdomain created automatically?"* table —
  the honest answer per mode (auto only for Cloudflare Tunnel and folder mode) instead of leaving
  users to discover it after a failed apply.
* Apply notes are now kind-aware: folder mode says no DNS or panel work is needed, subdomain mode
  lists the panel + Let's Encrypt steps.
* DNS warnings are suppressed for folder mode (the main domain already resolves), and the domains
  table gained a **نوع** column.
* Field labels adapt to the selected kind (*"ساب‌دامین کامل"* vs *"دامنهٔ اصلی سایت"*), and the folder
  field is hidden in subdomain mode.

### Fixed
* Saving a project with domain publishing enabled but an empty domain silently turned publishing
  off; it now returns a clear, kind-specific error.
* `dom_remove` left the root-`.htaccess` exclusion block behind; it is now cleaned up too.
* Backward compatibility: profiles saved before `2.11.0` with `domain_path != "/"` are detected as
  folder mode automatically.

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
