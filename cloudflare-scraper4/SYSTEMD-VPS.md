# Independent installation alongside WebConsole (1.212.0+)

Use **parallel mode**, not the legacy migration procedure below, to keep your existing WebConsole project and `scraper4-node` service untouched. Linux/systemd only; this privileged installer is not for Termux.

## One command — run as root through SSH

Prerequisites: system-wide Node 22.13+ under `/usr` or `/opt`, npm, Git, rsync, systemd, runuser, useradd; at least 2 GiB free build space plus source size. This command does not install OS packages or change Apache/firewall rules.

```bash
bash -c 'set -eu; test "$(id -u)" -eq 0 || { echo "Run as root through SSH"; exit 1; }; umask 077; stage=$(mktemp -d /opt/scraper4-install.XXXXXX); git clone --depth 1 --single-branch --branch arena/01a0aa17-new https://github.com/fazilatma/new.git "$stage/repo"; node "$stage/repo/cloudflare-scraper4/scripts/install-system-service.mjs" --parallel --public-bind --source "$stage/repo/cloudflare-scraper4"; grep "^DEPLOYER_UI_TOKEN=" /etc/scraper4-managed/runtime.env'
```

Open `http://YOUR_VPS_IP:8890/` and enter the printed token **without its surrounding quotes**. Keep the token private; do not paste it into support logs. Inside Deployer, use **Open scraper** (`/scraper/`), not port 3100.

- Public Deployer: `0.0.0.0:8890`, authenticated before serving the dashboard, proxy, or APIs. Login exchanges the token for an HttpOnly, SameSite cookie and redirects away from the token query. HTTPS connections use a Secure cookie.
- Private scraper: `127.0.0.1:3100`, accessed through the authenticated Deployer proxy.
- Dedicated service/account: `scraper4-managed`; app `/opt/scraper4-managed`, state/cache `/var/lib/scraper4-managed`, root-owned configuration `/etc/scraper4-managed`.
- A **fresh checkout** is required. Existing data/env files and occupied ports are refused. No old supervisor is stopped, no existing database/vault is copied, and no foreign port owner is killed by the installer.
- The runtime and build each have a 30% RAM cap and 50% CPU quota; runtime memory-high is 25%. **Isolation of names/data is not isolation of all host resources.** On a roughly 1 GiB VPS, simultaneous browser scraping/builds may run out of memory. This is not a guarantee both installations fit.
- The staging checkout is retained as an installer/rollback source. It is not the running program. Automatic branch installation is disabled; do not replace this public instance with older code lacking its authentication guard.

**HTTP is unencrypted.** Restrict TCP 8890 to your own public IP in the provider/host firewall, or use an SSH tunnel. Do not disable the firewall or expose port 3100. These safeguards apply only to this new instance: this command does not secure an older Deployer you previously exposed on 8790. Keep that older panel private/restricted too. When DNS is ready, place this instance behind HTTPS. For loopback-only installation omit `--public-bind`, then tunnel `ssh -L 8890:127.0.0.1:8890 root@YOUR_VPS_IP`.

## Stop / uninstall inside Deployer

The **Independent installation** card appears only in this managed profile. Type `scraper4-managed`, then choose:

- **Stop installation**: stops this systemd cgroup (Deployer + scraper). The panel disconnects; the health timer respects the stop. Boot enablement is retained. Restart over SSH with `systemctl start scraper4-managed.service`, or reboot.
- **Uninstall and archive**: disables/stops only managed main/health/control timers, removes their fixed unit files, and moves app/state/config under root-only `scraper4-managed-removed-<timestamp>-<random>/saved` archive wrappers in `/opt`, `/var/lib`, and `/etc`. Databases, vault keys and configuration are preserved. This is **not permanent data erasure**. The non-login account remains reserved to prevent UID reuse; a new installation with the same name therefore requires administrator review rather than silently reusing that account.

The web UI runs without root or sudo. It writes a bounded fixed-format request; a root-owned `/etc/scraper4-managed/control.mjs` service checks it every five seconds (first boot check after 30 seconds). It accepts only the two actions for the fixed namespace, rejects symlinks/nonregular files and unexpected ownership, and does not execute code from the app directory as root. Successful HTTP response means **queued, not completed**. If an operation fails, do not assume removal succeeded: inspect the root journal and remaining directories. No WebConsole, Apache, Python or legacy `scraper4-node` units are selected.

```bash
systemctl status scraper4-managed.service --no-pager
journalctl -u scraper4-managed-control.service -n 60 --no-pager
```

If the initial build failed, retain the printed staging directory and resume using its same source path:

```bash
node /opt/scraper4-install.REPLACE/repo/cloudflare-scraper4/scripts/install-system-service.mjs --parallel --public-bind --resume --source /opt/scraper4-install.REPLACE/repo/cloudflare-scraper4
```

`--resume` may rebuild/restart **only this managed instance**; it does not recopy its live data or rotate secrets. Installation and privileged stop/uninstall on a real VPS have not been exercised in the development sandbox. Tests cover HTTP authentication, request validation, generated units, namespace selection, and the legacy installer regressions.

---

# Persistent Node VPS installation — 1.211.0+

This is the system-level alternative to running the app from PHP/WebConsole or
an open terminal. It uses `scraper4-node.service`, **not** `scraper4.service`, so
it does not replace the Python application's units or `/opt/scraper4` directory.

## What is installed

- App copy: `/opt/scraper4-node`; original source is retained untouched.
- Dedicated non-login account: `scraper4-node` (never root or www-data).
- Private HOME/cache: `/var/lib/scraper4-node`.
- Root-owned configuration: `/etc/scraper4-node/runtime.env` (0600).
- Main system service: Deployer on **127.0.0.1:8790**, managing Scraper on
  **127.0.0.1:3000** inside the same cgroup. PHP is not involved.
- Boot startup, restart after process exits, and whole-cgroup cleanup on stop/OOM.
- Main-service limits: memory high watermark 40% of physical RAM, hard limit 50%,
  no swap allocation, 100% CPU (= one CPU), 512 tasks. These are conservative
  starting limits, not a guarantee that a given browser/concurrency workload fits.
- Restart storm guard: at most five starts in five minutes. Repeated early
  failures leave the unit failed rather than continuously destabilizing the VPS.
- Root-owned health monitor and timer: after five minutes' grace, three failed
  Deployer HTTP probes at one-minute intervals trigger `try-restart`. Any HTTP
  response counts as responsive. It does not restart a deliberately stopped unit
  or reset systemd's crash-loop limit. The existing Deployer handles Scraper
  recovery and respects manual Stop inside its UI.
- Dependencies/build execute as the dedicated account in a resource-limited
  transient systemd service (30-minute limit), **not as root**. Boot/recovery runs
  the prebuilt `render-dist/server.js`, avoiding repeated install/build loops.
- Automatic code updates are disabled; restarting is not a source update.

## One-time migration through root SSH

Use a systemd Linux VPS with system-wide Node **22.13+ or a newer supported LTS**,
Git, rsync, npm, useradd and util-linux (`runuser`). Root-owned Node binaries under
`/usr` or `/opt` are supported; root's private nvm installation is not. A working
systemd instance is required; Docker without systemd and Termux use other setups.
The installer checks free disk space for the source copy plus 2 GiB of dependency/
build headroom. It does not automatically install OS packages or delete old data.

1. Back up the current app directory, database and `data/vault.key`. Stop the
   current project and disable WebConsole's auto-start/watchdog. Also stop any
   manual/old systemd instance of the **Node** project. Do not stop the independent
   Python application. Stop all extraction jobs and writers before copying SQLite.
2. Verify ports 8790 and 3000 are free. The installer refuses busy ports and live
   Node/browser processes in the source directory; it does not kill their owners.
   A sleeping PHP watchdog could restart later, so you must disable it explicitly.
3. Get the installer from this branch (a new checkout, not a reset of your data):

```bash
git clone --depth 1 --branch arena/01a0aa17-new \
  https://github.com/fazilatma/new.git /opt/scraper4-systemd-installer
```

4. Run it with the **actual directory of your installed Node project**:

```bash
node /opt/scraper4-systemd-installer/cloudflare-scraper4/scripts/install-system-service.mjs \
  --source /var/www/scraper4-cloudflare \
  --confirm-old-supervisor-stopped
```

If WebConsole installed the app under `/var/lib/webconsole-projects/...`, use that
actual directory instead. The source must contain package.json, package-lock.json,
and scripts/local-deployer-ui.mjs. This migrates the source's installed code
version; downloading a newer installer alone does not upgrade that source code.

The installer copies code/data/config, excluding .git and node_modules. It retains
.env.local, imports .env.wcp values with their previous runtime precedence, and
keeps a `.env.local.before-systemd` copy. It never replaces ADMIN_TOKEN or the
vault key. SQLite/vault paths inside the original directory are relocated to the
new copy. External file paths and symlinks require deliberate manual migration
and are refused rather than silently abandoned. PostgreSQL URLs remain unchanged;
ensure the dedicated account can reach the database. Credentials held only in a
terminal environment or the old account's HOME must be configured deliberately.
No old database or source directory is deleted.

Once completed, do **not** press Start/Install for the old WebConsole profile.
Use systemd and the Deployer UI for the migrated instance.

## Verify before relying on it

```bash
systemctl is-enabled scraper4-node.service scraper4-node-health.timer
systemctl status scraper4-node.service --no-pager
ss -ltnp | grep -E ':(8790|3000)\b'
curl --max-time 10 -sS -o /dev/null -w 'Deployer HTTP %{http_code}\n' http://127.0.0.1:8790/
curl --max-time 10 -sS http://127.0.0.1:3000/health
journalctl -u scraper4-node -n 80 --no-pager
```

An enabled service alone does not prove the application is healthy. Verify both
listeners, health response, database access and a small extraction first. Logs can
contain tokens and application secrets: redact before sharing. To read the local
Deployer token privately, inspect `/etc/scraper4-node/runtime.env` as root.

Reboot **only during a maintenance window**, then repeat these checks. Publishing
this installer does not run it on your VPS or constitute a reboot-survival test.

## Browser access

Loopback binding is intentional. Existing Caddy/Cloudflare DNS setup can proxy
8790/3000; this installer does not alter Caddy, Apache, PHP-FPM, DNS or firewall.
Until HTTPS is configured, use an SSH tunnel from your own computer:

```bash
ssh -N -L 18790:127.0.0.1:8790 -L 13000:127.0.0.1:3000 root@YOUR_VPS_IP
```

Open `http://127.0.0.1:18790/` for the Deployer and
`http://127.0.0.1:13000/` for the Scraper. For public HTTPS, protect administration
with authentication (including a reverse-proxy access policy). The installer
preserves the app's auth configuration; it does not assume a public UI is safe.
Do not expose raw ports 8790/3000 to the Internet to work around a proxy problem.

## Recovery from the 1.211.0 installer reset-failed error

Fixed in installer release 1.211.1+. A fresh unit may have no loaded/failed state
for `systemctl reset-failed`; that optional cleanup no longer aborts activation.
Reload, enable/start and timer failures still remain fatal.

If the build exited with status 0 and installation stopped specifically at
`systemctl reset-failed scraper4-node.service`, the unit files and built app have
already been written. Do not delete data, recreate the account, or rebuild just
for this error. With the old supervisor still disabled, finish via root SSH:

```bash
systemctl daemon-reload &&
systemctl enable --now scraper4-node.service &&
systemctl enable --now scraper4-node-health.timer
systemctl status scraper4-node.service --no-pager
ss -ltnp | grep -E ':(8790|3000)\b'
```

If activation itself fails, inspect `journalctl -u scraper4-node -n 80 --no-pager`.
A warning about an unsupported `RestartMode` in **snapd.service** is a separate
systemd/package compatibility warning; it is not a directive added by this
installer and is not the reset-failed command failure. Do not edit snapd merely
to work around this installer bug.

## Operations, limits and failures

```bash
systemctl restart scraper4-node
systemctl stop scraper4-node
systemctl disable --now scraper4-node scraper4-node-health.timer
journalctl -u scraper4-node -u scraper4-node-health -n 100 --no-pager
systemctl show scraper4-node -p MemoryCurrent -p MemoryMax -p NRestarts -p Result
```

Repeated crash/OOM failures require fixing the cause, then:

```bash
systemctl reset-failed scraper4-node
systemctl start scraper4-node
```

Use `systemctl edit scraper4-node` for resource overrides, for example
`[Service]` followed by `MemoryMax=2G` and `MemoryHigh=1500M` on a sufficiently
large VPS, leaving ample RAM for PHP/Apache/database. Reload systemd and restart
after changes. Limits protect other services but can terminate an oversized job;
reduce concurrency or upgrade RAM instead of disabling every limit.
Browser binaries/OS dependencies and optional integrations are not provisioned by
this installer. Install them as appropriate for the dedicated account, not root's
private HOME. Interrupted jobs are not guaranteed to resume exactly once.

A dependency/build failure preserves the source and partial target. If preparation
finished and `/etc/scraper4-node/installed.json` exists, correct the reported cause
and rerun the same installer command with **`--resume`**. This stops only its own
Node unit, rebuilds as its account and preserves the migrated data/env/token.
It does not copy old data over the new copy. Early copy/account failures require
administrator inspection; no automatic recursive deletion/rollback is attempted.
To roll back, stop/disable this Node service and timer before deliberately enabling
the old instance. If the new instance has processed work, migrate its latest data
back first—do not overwrite it with the older backup.

## Validation scope

Tests cover generated systemd units, version/port/env settings, migration path and
credential preservation, occupied-port refusal, health monitor grace/failure/
manual-stop decisions, live HTTP probes and the existing real Deployer crash-
recovery test. `WCP_SYSTEMD_VERIFY=1` also invokes systemd-analyze verify when
available. Full root installation and reboot are not exercised in this sandbox;
perform the verification above on the actual VPS.
