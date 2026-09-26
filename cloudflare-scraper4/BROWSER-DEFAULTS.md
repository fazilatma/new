# Portable browser defaults — 1.224.0+

The successful VPS fixes are now application defaults. Reinstalling the scraper
no longer requires manually copying TMPDIR/TMP/TEMP or the root compatibility
flag. The central implementation is `scripts/browser-defaults.mjs`, applied from
`render-src/config.ts` as `config.browser` before browser launches.

## Temporary files

- Linux (VPS/Render/container): `/tmp`, overriding inherited private panel TMPDIR.
- Termux: `$PREFIX/tmp` (or its native runtime temp when PREFIX is unavailable).
- Windows/macOS: the platform's temporary directory/environment.
- Explicit administrator override: `BROWSER_TMPDIR=/absolute/writable/path`.

The effective location is assigned to **TMPDIR, TMP and TEMP in the Node parent**
and inherited by children. This matters because Playwright creates its temporary
profile in the parent before launching Chromium; setting child env alone would
not fix it. All Node entrypoints importing the main config receive the defaults.
Browser repair subprocesses receive the same normalized environment.

The directory is checked for directory type and write/search access. No directory
permissions, ownership or mount settings are changed. Node's access check does
not prove access under a Chromium child security policy. Missing/inaccessible
custom directories produce a warning and must be corrected by the administrator.

HOME, npm/Python caches, Playwright/Puppeteer caches, executable overrides and
network gateway settings remain unchanged. Deployment-specific paths and project
IDs are deliberately NOT hardcoded. The secure web-console project folders
remain private; there is no recursive chmod or broad permission change.

## Sandbox policy (security-relevant)

`VISUAL_BROWSER_NO_SANDBOX` now supplies the shared browser sandbox policy:

| Value | Behavior |
| --- | --- |
| unset / `auto` | Root or Termux: compatibility mode without sandbox. Ordinary non-root: sandbox enabled. |
| `true` | Explicitly disable sandbox. |
| `false` | Require sandbox, including for root (Chromium may then refuse to launch). |

The helper controls actual Chromium flags **and** Playwright's `chromiumSandbox`
option; omitting a custom `--no-sandbox` flag alone would not enable Playwright's
sandbox. The policy is shared by runtime tests, visual snapshots, Playwright
extraction, Puppeteer, Crawlee Playwright and browser-repair smoke tests.

Root/Termux compatibility mode is logged and included in the report. Disabling
the sandbox reduces isolation: a non-root service with sandboxing is preferred.
Do not expose an unauthenticated root scraper to untrusted users. The existing
root-operation acknowledgement and optional global API-auth policy remain intact;
this setting does not grant shell permissions or install system packages.

## Logging and reports

`DEBUG=pw:browser` was a diagnostic aid, not the crash fix. It is **not enabled
by default**. Explicit DEBUG values remain respected. Remove a previously added
DEBUG setting when troubleshooting is complete.

Browser support reports include effective TMPDIR/TMP/TEMP, BROWSER_TMPDIR when
configured, the resolved sandbox policy, temporary-directory source and warnings.
Report generation itself remains read-only.

## Fresh installation checklist

1. Install the project's locked dependencies using a supported Node version
   (the currently pinned Puppeteer requires Node >=22.12).
2. Use the browser install/repair controls to install the matching browsers.
3. On Ubuntu/Debian, install missing Chromium system libraries using the existing
   copyable `playwright install-deps chromium` instructions with administrator
   approval. These apt packages are not installed automatically.
4. Start the scraper. The defaults above apply without extra environment entries.
5. Run the persistent browser test, then close it before heavy extraction on a
   small VPS. Success tests local rendering, not access to every website.

For an existing deployment, update/rebuild and restart the service. You may remove
old TMPDIR/TMP/TEMP entries and use BROWSER_TMPDIR if you deliberately need a custom
path. You may remove VISUAL_BROWSER_NO_SANDBOX=true to use automatic policy; an
explicit true continues to take precedence. Keep unrelated credentials and
network/cache settings unchanged.

These defaults prevent the specific observed private-temp and root-launch errors.
They do not guarantee error-free installation on every OS, remove memory limits,
fix unavailable package downloads, or bypass website access controls.

## Cache-path update in 1.226.0+

Implicit HOME-based caches are superseded by shared project-local caches under
`data/browsers`. Explicit overrides are still respected. See BROWSER-PATHS.md for
migration, permission requirements, and post-install verification.
