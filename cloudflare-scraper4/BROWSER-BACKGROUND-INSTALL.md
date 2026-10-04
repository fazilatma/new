# Browser setup after initial installation

`npm install` / `npm ci` installs the application's required JavaScript packages
first. Puppeteer's automatic large browser download is disabled in the project
configuration. The final postinstall step queues a detached browser installer
and returns immediately. The app can start without waiting for browser binaries.
This does not postpone required JS packages or make browser features usable
before their browser is installed.

`npm run browsers:install` also queues the same background task. Concurrent calls
share a project-local lock. On Termux, where npm scripts are disabled, the existing
installation guide's browser command (and the managed deployer's successful
install action) starts this task explicitly; only native `pkg install -y chromium`
is used there. No desktop Linux browser is downloaded on Android.

## Progress and retry

- `npm run browsers:install -- --status` prints persisted status.
- `data/browser-install/install.log` contains the installation output.
- `data/browser-install/status.json` records starting/installing/ready/failed.
- Retry with `npm run browsers:install` after a failed or interrupted worker.
- For CI or a blocking check: `npm run browsers:install -- --foreground --strict`.
- `--dry-run` prints the platform plan without starting a background task.

From 1.226.0+, “ready” requires executable access checks and local-page launch
tests for Playwright, Puppeteer and both Crawlee drivers, using the same cache
paths and sandbox policy as the runtime. This does **not** verify any external
website or execution under a different OS user. Older “downloaded” records do
not establish readiness; rerun setup to verify.
The app's non-browser functionality remains available if downloads fail.
A process supervisor/container that kills the whole install process group may
also kill a detached download; re-run the command inside the persistent runtime.
Use the same OS user and explicit cache settings as the actual application service.
New installs default to project-local caches; upgrades preserve compatible old caches
when the new cache is incomplete. See BROWSER-PATHS.md.

## Sources and dependencies

The configured/official source is attempted first, then the third-party npmmirror
Playwright or Chrome-for-Testing artifact source. These mirrors are alternatives,
not extra browsers to install, and may not carry the pinned revision. No automatic
downgrade is used. Set `BROWSER_INSTALL_MIRRORS=false` to disable third-party
fallback. Existing proxies and caches are retained; SCRAPER_BROWSER_GATEWAY stays
in use for both attempts when supplied. Each download attempt is bounded to four
minutes. Explicit foreground commands allow retrying later.

Core npm modules cannot safely be deferred because startup imports them. Missing
Ubuntu/Debian shared libraries still require an administrator-approved installation
(e.g. Playwright's `install-deps chromium`); this task does not silently run apt,
sudo, or change host permissions. Existing `--ignore-scripts` installations must
run the browser command explicitly. No live mirror availability is guaranteed.
