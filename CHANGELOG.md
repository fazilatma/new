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
| `hostconsole.php` | **2.18.0** | Shared-hosting edition (`WCP_EDITION = hostconsole`) |
| `webconsole.php` | 2.9.0 | VPS edition — domain publishing not ported yet |
| `wcp` (CLI) | 2.18.0 | Follows the suite version |
| `install.sh` / `update.sh` | 2.18.0 | Follows the suite version |
| `py-upgrade.sh` | 1.0.2 | Standalone Python installer, versioned separately |
| `webconsole.worker.js` | 2.8.0 | Cloudflare Workers edition, versioned separately |

---

## [2.18.0] — 2026-09-29 · 🐘 `php-daemon.php`

### Added
* **`php-daemon.php` 1.0.0** — runs a one-shot PHP script as a continuous worker,
  so a PHP job can behave like its Node or Python equivalent instead of being
  chopped into cron ticks. PHP 7.0+, no extensions, no Composer.
  * Adaptive backoff driven by `--idle-marker`: productive cycles run back to
    back, an empty queue doubles the interval up to `--idle-max`, and work
    returning snaps it straight back to `--idle-min`.
  * Child output streamed live rather than buffered.
  * Graceful stop via `.daemon.stop`, plus signals where `pcntl` exists.
  * `.daemon-heartbeat.json` with pid, cycle, uptime, exit code, memory.
  * `--cycle-timeout` kills an overrunning cycle; `--max-fails` hands control
    back to the supervisor rather than looping on a broken job.
  * A fresh child per cycle by design — a script written for one-shot execution
    leaks when looped in-process. Measured flat at 2 MB over 607 cycles.

### Notes
* The `exec` prefix on the child command is load-bearing. `proc_open()` goes
  through a shell, so `proc_terminate()` would signal the shell and orphan the
  PHP process; every cycle timeout would leak one. Caught in testing.
* This is not a substitute for the 2.17.0 cron watchdog. Nothing inside a
  shared-hosting account can stop the host from killing it. What it removes is
  the per-tick machinery — one worker means no lock contention and no
  60-second granularity.

---

## [2.17.0] — 2026-09-29 · 🛡️ Cron-level service watchdog

The supervisor started by `job_start()` can restart a service that exits on its
own, but it cannot survive the account's process tree being culled — CloudLinux
LVE enforcement, CSF/lfd process tracking, or the host's own reaper take the
supervisor down along with the service, and nothing inside the account is left
to notice. This is the reason long-running processes "disappear after a while"
on shared hosting.

Cron is not affected: `crond` starts a fresh process every minute from outside
the account's session. Liveness is now enforced from there.

### Added
* **`proj_watchdog_services()`**, run from the existing `--auto-update` cron tick,
  so installs that already ran *فعال‌سازی دیده‌بان* get it without editing crontab.
  A service is revived when it is wanted, marked `is_daemon`, has a start command,
  and has no running service job.
* **Desired-state tracking** (`svc_desired`). Set when a service is started from
  the panel or by a deploy, cleared on an explicit Stop — so a service the
  operator deliberately stopped is never resurrected.
* **Exponential backoff** on a service that will not stay up: 1, 2, 4, 8, 16, 32,
  then 60 minutes. A service that comes back healthy has both its failure counter
  and its throttle timestamp cleared, so an unrelated later cull is acted on at
  the very next tick instead of inheriting an old penalty window.
* Cron output now reports what it watched and what it revived, so the job log
  shows whether the host is culling processes and how often.

### Notes
* Detection, not prevention. The watchdog cannot stop a host from killing a
  process; it bounds the outage to roughly one minute. If a service is being
  culled every few minutes the right fix is to reduce its memory footprint or
  move it off shared hosting — the job log will now make that pattern obvious.

---

## [2.16.0] — 2026-09-29 · 🐍 Python projects get a real runtime

Python projects were being run with whatever `python3` happened to be on `PATH`.
On CentOS 7 / CloudLinux that is 3.6, which cannot parse `from __future__ import
annotations`, has no writable `site-packages`, and cannot be upgraded without
root. Every Python deploy on such a host failed, and the recovery paths made it
worse. This release gives Python the same treatment Node already had via nvm.

### Added
* **Per-project Python version**, mirroring `node_version`. Resolution order:
  project `python_version` → console default → newest uv-managed runtime → none.
* **Automatic per-project virtualenv.** On service start the console creates
  `.venv` with uv, installs `requirements.txt` into it, and points the start
  command at `.venv/bin/python`. Re-checked on every start; a satisfied
  environment costs about 1 ms.
* `requirements.txt` is also found one directory down, which is where project
  templates that keep a nested package tend to put it.
* **Python version picker** in the project dialog, with a `⬇️ نصب` button that
  installs uv and the requested runtime as a background job
  (`sys.python_versions`, `sys.python_install`, job type `python_install`).
* New helpers: `wcp_uv_bin()`, `wcp_uv_pythons()`, `wcp_python_version_of()`,
  `wcp_py_venv_python()`, `wcp_py_requirements()`, `wcp_py_ensure_venv()`,
  `wcp_py_install_packages()`.

### Fixed
* **The auto-installer could never succeed on shared hosting.** It ran a chain of
  five `sudo` / `pip3` / `--break-system-packages` commands. There is no `sudo`
  on these accounts, `pip3` is not on `PATH`, and pip 9 (shipped with Python 3.6)
  has no `--break-system-packages`, so the chain always ended in exit 127. It now
  installs into the project virtualenv, preferring `requirements.txt` over the
  package names scraped from the traceback, and only falls back to
  `pip install --user` — probing for `--break-system-packages` before passing it.
* **The launcher poisoned its own virtualenv.** It prepended every
  `/usr/lib/python3*/dist-packages` it could find to `PYTHONPATH`, so a system
  3.6 package shadowed the correctly built one inside the venv. `PYTHONPATH` is
  now cleared when a virtualenv is in use, and left alone otherwise.
* **`pkill -9 -f` could target an interpreter flag.** For `python3 -u app.py` the
  entrypoint scanner returned `-u`, and `pkill -f -u` matches the command line of
  unrelated processes. Flags are skipped and the first real script name is used.
* `preg_replace` with a path as the replacement string would have treated `$` and
  `\` in that path as backreferences; the callback form is used instead.

---

## [2.15.1] — 2026-09-29 · `hostconsole.php`

### Fixed
* **The Python auto-installer harvested pip's own usage text as package names.** When a run failed
  and `pip` printed its usage block, the token filter accepted `[options]`, `<requirement`,
  `specifier>`, `[package-index-options]`, `<requirements`, `file>`, `[-e]`, `<vcs`, `project`,
  `url>`, `<local`, `path>` and `<archive` as installable packages, because the pattern allowed
  `[ ] < > = !`. Each failed attempt appended that garbage to the next install command, so the
  list grew on every restart and the install could never succeed. Package names are now matched
  as `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$` with an explicit stop-list for pip's usage words.

  Verified against the real log from the report: before, 12 junk tokens were collected alongside
  the 14 genuine ones; after, only the 14 genuine ones remain.

---

## [2.15.0] — 2026-09-29 · 🐍 `py-upgrade.sh`

### Added
* **`py-upgrade.sh` — a one-command Python installer for shared hosting**, runnable straight from
  GitHub with `curl`. On shared hosting `apt install python3.14` is impossible without root, and
  `pyenv` compiles from source, which typically dies on missing `openssl` / `zlib` / `libffi`
  headers or gets killed by the account's CPU/RAM limits. This script instead installs
  [uv](https://astral.sh/uv) — a static binary needing neither Python nor a compiler — and pulls a
  prebuilt standalone CPython. Measured: **Python 3.14.7 installed in 2.4 s**.

  ```bash
  curl -fsSL https://raw.githubusercontent.com/fazilatma/new/hostconsole-nvm-node20/py-upgrade.sh | bash -s -- 3.14 ~/apps/scraper
  ```

  Given a project directory it also creates `.venv`, installs `requirements.txt`, detects the entry
  script (`main.py`, `app.py`, `scraper4.py`, `bot.py`, …) and prints the exact install/start
  commands to paste into the project's console settings.

* **Warns about the `python3` PATH trap.** Deploy scripts are generated with
  `PATH="/usr/local/bin:/usr/bin:/bin:…:$HOME/.local/bin:$PATH"`, where `/usr/bin` precedes
  `$HOME/.local/bin` — so a freshly installed interpreter is on PATH yet bare `python3` still
  resolves to the old system one, and every hardcoded `python3 main.py` keeps using it. The script
  detects this and tells you to use the absolute interpreter path instead.

### Fixed (1.0.1)
* **Recover when `HOME` is unset or bogus.** Some shared hosts (jailshell / CageFS, and cron)
  hand you a shell where `HOME` is empty or not exported, so a piped `bash` never sees it. The
  damage is silent and confusing: `export PATH="$HOME/.local/bin:$PATH"` collapses to
  `/.local/bin`, PATH gets clobbered, and the freshly installed `uv` becomes "command not found".
  The script now resolves the real home from `getent passwd`, then `/etc/passwd`, then `/home/$(id -un)`,
  then bash's own `~` expansion (which reads passwd directly), exports it, and explains what
  happened. Verified against `HOME` unset, `HOME=""`, `HOME=/no/such/dir` and a scrubbed `env -i`.

### Fixed (1.0.2)
* **Persist the `HOME` repair.** 1.0.1 detected a broken `HOME` and printed the line to add to
  `.bashrc`, but on the host that hit this the SSH session was dropping characters and newlines on
  paste, so typing that line back was itself unreliable — `export HOME=/home/user` + `clear` arrived
  as `export HOME=/home/userclear`. The script now appends the export to `.bashrc` (and
  `.bash_profile` when present) itself, idempotently, announcing what it wrote and how to undo it.
  It only does this when it actually had to repair `HOME`; a healthy environment is left untouched.

### Notes
* `uv venv` is invoked with `--seed`; without it the venv has no `pip` and the printed
  `python -m pip install -r requirements.txt` would fail.
* `UV_LINK_MODE=copy` is exported because on shared hosting the uv cache and the project usually
  sit on different filesystems, which makes hardlinking warn and fall back.
* Latest Python at release time: **3.14.7** (2026-08-05). 3.15.0 is due 2026-10-01.
* Unchanged in this release: `hostconsole.php` still hardcodes `python3`; per-project Python
  version selection (the equivalent of the nvm work in 2.12.0) is not implemented yet.

---

## [2.14.0] — 2026-09-28 · `hostconsole.php`

### Added
* **Save button for the self-update section.** The repository, branch and GitHub token in
  *Console Self-Update* were form-only: nothing persisted them, so every visit reset the fields to
  `fazilatma/new` / `main` and the token had to be retyped for every check. They are now stored
  (`update_repo`, `update_branch`, `update_token`) and reused automatically by
  `console.check_update`, `console.self_update` and the auto-update poller when the request omits
  them. The token is write-only: `settings.get` returns just `update_token_set`, and leaving the
  field empty keeps the stored value instead of wiping it.
* **One "💾 Save all settings" bar for the whole Settings tab**, sticky at the top, collecting every
  card in a single `settings.save` call: start folder, session length, allowed IPs, self-update
  repo/branch/token, Cloudflare proxy mode and worker URL, and all five proxy-gateway controls.
  Password change stays separate on purpose — it needs the current password.
* **Unsaved-changes indicator.** Editing any field marks the bar with *«● تغییرات ذخیره‌نشده دارید»*;
  saving clears it, and ↺ Reload asks for confirmation before discarding edits. Password fields are
  excluded from the tracking, and the listener is bound once instead of once per tab switch.

### Fixed
* The *Universal Proxy Endpoint* box in the Cloudflare card advertised
  `window.location.origin + '/?url=…'` — the domain root, which on shared hosting is the website's
  own index and silently ignores `?url=`. It now shows the gateway's real address on this install,
  the same value as the gateway card.
* Self-update settings deliberately use their own config keys. Reusing `gh_repo` / `gh_branch`
  would have collided with the GitHub **backup** target, whose branch defaults to `backups`;
  verified that saving an update branch leaves `gh_branch` untouched.

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
