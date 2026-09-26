# Shared browser installation and runtime paths — 1.227.0+

Fresh installations without a compatible existing cache use:

- `<project>/data/browsers/ms-playwright`
- `<project>/data/browsers/puppeteer`

Here `<project>` is the `cloudflare-scraper4` directory containing package.json,
not the shell's working directory. The scripts and built runtime independently
resolve the same project root. JavaScript SDKs remain in that project's
`node_modules`, installed from package-lock.json; browser setup invokes local
SDK CLIs, never a global or freshly downloaded npx package.

The main config, installer and repair subprocesses share `scripts/browser-paths.mjs`.
Explicit `PLAYWRIGHT_BROWSERS_PATH`, `PUPPETEER_CACHE_DIR` and executable overrides
are retained. These browser-path settings also load from `.env.local`; process
environment takes precedence. Relative values are resolved against the project,
not a supervisor's current directory. Playwright's special value `0` keeps its
SDK-supported package-local cache. Do not change it between install and runtime.
Termux still uses the native `pkg` Chromium executable, not desktop binaries.

Installation creates the target cache directories and checks read/write/search
access. It does not chmod/chown existing directories. After downloading, it logs
the SDK-resolved executable paths, checks file read/execute access, then launches
a local test page through Playwright, Puppeteer and their Crawlee wrappers.
Only all four successful tests produce `ready`. Failures are recorded in
`data/browser-install/install.log`; startup of the main application is not blocked.
These checks run as the installer user, not as an unrelated future service user.

## Existing installations and permissions

Update, rebuild and restart. Then use `npm run browsers:install` to queue setup
at the selected paths. Existing explicitly configured caches are not moved.

**Upgrade regression fixed in 1.227.0+:** version 1.226.0+ could select an empty
project cache while the working browser remained in the previous HOME cache.
An incomplete implicit project cache now falls back to an accessible legacy cache
only if it contains the exact SDK-required executable files. Playwright requires
both full Chromium and Chromium headless shell. A complete project cache wins.
The previous HOME/XDG location and configured source HOME are checked; `/root`
is also checked only for Linux root processes. No copying, downloading or permission
changes happen during this read-only selection. Explicit paths (including `0`)
are never redirected. A different revision or a directory alone is not sufficient.
Unsupported metadata/layouts fail closed rather than choose a random revision.

If a path was explicitly set to an empty project cache, use the existing cache-reuse
UI to copy the old files (select the correct source HOME), or remove that explicit
override and restart to enable automatic selection. No old cache is deleted.
File compatibility is not a browser launch test or a guarantee of OS dependencies.

The support report now includes expected/missing executable paths, compatible legacy
candidates and persisted background-install status plus a redacted 24 KB log tail.
The in-memory repair job being `idle` never means background installation succeeded.

Run installation **as the same OS account as the application service**. A root
installation followed by a restricted service user may still need an administrator
to arrange directory traversal/read/execute permissions or writable service-owned
cache locations. Read-only projects should explicitly configure writable absolute
cache paths for both installation and runtime. Keep the data directory on persistent
storage when redeploying containers. No permissions are broadened automatically.

These defaults supersede earlier documentation describing unchanged implicit HOME
cache locations. They do not fix missing system shared libraries, noexec mounts,
unsupported OS/browser combinations, network failures, or target-site blocks.
