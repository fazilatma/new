# Shared browser installation and runtime paths — 1.226.0+

Default browser binaries now live at:

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
at these paths. Existing explicitly configured caches are not moved. Older
implicit HOME caches are not deleted or automatically selected; the existing
cache-reuse UI can copy them to the new runtime location without another download
(set the source HOME when it differs from the default `/root`).

Run installation **as the same OS account as the application service**. A root
installation followed by a restricted service user may still need an administrator
to arrange directory traversal/read/execute permissions or writable service-owned
cache locations. Read-only projects should explicitly configure writable absolute
cache paths for both installation and runtime. Keep the data directory on persistent
storage when redeploying containers. No permissions are broadened automatically.

These defaults supersede earlier documentation describing unchanged implicit HOME
cache locations. They do not fix missing system shared libraries, noexec mounts,
unsupported OS/browser combinations, network failures, or target-site blocks.
