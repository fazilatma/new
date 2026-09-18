# WebConsole Pro 1.2.2 — complete standalone PHP file

**Deploy `webconsole.php`.** This is the actual console, not the earlier offline
HTML repair tool, and it does not require the repair utility at runtime.

This edition is based on the PHP source supplied in the conversation. It is
**not a byte-for-byte minimal patch**: the interface and implementation have
been compacted, a Jobs view was added, and the fixes below were integrated.
It retains the terminal, file manager/editor, uploads, process manager, GitHub
explorer, backup profiles/snapshots/restore, project deployment/service runner,
settings and authentication features. Existing JSON configuration filenames and
project/profile field names are retained.

## Release 1.2.2 — persistent managed project storage

The old automatic destination was based on the **file browser start folder**,
usually `/var/www`. Giving PHP access to one project did not fix the next one.
New installs now use an independent `project_root`, defaulting to
`/var/lib/webconsole-projects`, with a unique `<name>-<project-id>` child per
profile. Duplicate project names do not share a destination. Quick installs,
manual profiles with an empty path, and bundled presets all use this policy.

### One-time setup on the server

1. Replace the deployed `webconsole.php`, preserving `.wconsole_data`. Updating
   the Scraper4 checkout alone does not update the PHP console.
2. Open **Projects → Project storage** (also available from Settings). The panel
   shows the actual PHP effective UID/GID, not the owner of the PHP source file.
3. Use the default root outside the web document tree, or save a dedicated,
   persistent custom root. A location already writable by PHP can be prepared
   with **Create with current PHP permissions** without privilege escalation.
4. If PHP cannot create that root, copy the displayed setup script and execute
   it **once in a root SSH session**, not in the WebConsole terminal. The script
   grants only the dedicated root to PHP's non-root UID/GID with mode 0700.
5. Return to the panel and run **Test write access**. This creates and removes a
   small temporary directory/file in that root. After success, future project
   directories need no individual root `mkdir/chown` step.

PHP cannot bypass Linux permissions or grant itself root access. No sudo command
is executed by the web app; the privileged script is displayed for the operator
only. The script refuses symlinks, untrusted writable/non-root-owned ancestors,
and takeover of a nonempty directory belonging to another UID. It changes only
its dedicated root (no recursive chown and no chmod 777). It is idempotent for
a root already assigned to that same execution account. Custom user-owned roots
normally need only the unprivileged Prepare action, not this strict SSH script.
Temporary storage paths and paths inside the known document/WebConsole tree are
rejected. Keep any extra web-server aliases away from the managed root.

### Existing profiles and data

Existing custom paths remain unchanged, including when saving an existing profile
with a blank path. The **Use managed writable path** button can propose a new
location for a stopped, empty/not-yet-installed profile; review and Save it before
installing. It refuses populated/unreadable locations and active deployments/services. It
does not move, delete or silently abandon an existing installation. For populated
installations, an administrator must back up and migrate the full directory,
`.env.local`, database, `data/`, vault key and any external data deliberately,
or repair that specific installation's ownership for its intended service user.
Do not run old and new copies on the same ports or with competing supervisors.

Install/build and service commands also receive private per-project temp,
npm/pip and XDG cache locations under `.wconsole_data/runtime/<project-id>`.
Managed-path projects additionally receive a private HOME there; existing custom
installations keep their inherited HOME to avoid silently losing access to
existing credentials/state. This avoids a second common failure: npm attempting to write to an unwritable
system HOME such as `/var/www/.npm`. Explicit environment overrides are preserved
(including uppercase NPM_CONFIG_CACHE). Preserve this runtime directory on upgrade;
apps may store credentials or state in HOME. If an app needs an existing HOME
(e.g. SSH keys/private registry configuration), set HOME explicitly rather than
copying credentials automatically. Root-only package installs and arbitrary
system paths remain intentionally unauthorized; quotas, read-only mounts and
SELinux/AppArmor may require separate administrator action.

Validation includes PHP-engine tests for path selection, unique names, preserving
existing paths, symlink/temp/web-root rejection, actual write-probe cleanup and
runtime overrides. An opt-in native Linux test (`WCP_TEST_SUDO_STORAGE=1`, requires
PHP_BIN and passwordless sudo for the test user) executes the **PHP-generated**
setup script in a unique `/var/lib/wcp-storage-fixture-*` directory, verifies two
non-root project directories can be created and written there, reruns it without data loss, and tests
refusal of symlink targets and nonempty foreign-owned locations. It cleans up
only that fixture. This is sandbox validation, not a claim of deployment on your VPS.

## Release 1.2.1 — version-sorted branch explorer

Selecting a repository now immediately opens a table of **all branch pages**,
then progressively inspects their projects with visible progress and errors.
The table sorts recognized numeric project versions newest first (including
prerelease ordering and the project's trailing `+` release marker), not branch
names. Unknown/unreadable versions sort last; no fabricated 1.0.0 fallback.

For monorepos, select the project subfolder to compare that same project across
branches. The default sort uses the highest recognized version among detected
projects in each branch; all their paths/versions are displayed. Select a row to
show project customization/quick-install controls. The dropdown remains as a
secondary selection control. Nothing installs merely by selecting a repository
or branch. Changing repository/owner or closing the dialog prevents stale scans
from updating the current table; scans are sequential to limit concurrent load.

Version discovery currently reads Node `package.json` versions. Other detected
project types without version metadata show unknown, not a guessed version.
Large repositories can be slow and may require a GitHub token with appropriate
access; rate-limit/network failures and truncated trees are shown as errors.
The refresh button reruns discovery. Tests cover >100 branches with mocked GitHub
pagination, real Chromium table interactions with mocked APIs, numeric sorting,
monorepo filtering, selection, and stale-response isolation. Live GitHub scans
remain environment-dependent.

## Release 1.2.0 — balanced workspace upgrade

All existing terminal, file/editor/upload, process, GitHub backup/restore, project,
job and settings API areas remain. This is a classic-console-inspired redesign,
not an exact recreation of the earlier pasted original interface.

- **Appearance studio:** five palettes (Midnight, Paper, Ocean, Forest, Amber),
  three desktop layouts (Classic sidebar, Studio top navigation, Focus icon rail),
  and compact/comfortable density. Every combination uses the same feature set.
  Preview is immediate; Save persists to console settings; closing without Save
  restores the previous appearance. Preferences are console-wide, not per user.
  Mobile keeps the bottom navigation in every layout. Icons are inline SVG.
- **Navigation:** searchable section palette via the header or Ctrl/Cmd+K,
  English search aliases, section breadcrumb, visible keyboard focus, modal
  roles/focus handling, and reduced-motion support. The hotkey does not intercept
  Ctrl+K inside xterm. No shell commands execute from the navigation palette.
- **Projects:** instant list filter, Scraper4/Node/static presets, reviewed JSON
  export, and read-only deployment checks. Exports omit IDs, auth tokens and
  **all environment values**, strip URL credentials/query/fragment, and disable
  auto-start. Shell command text can still contain secrets; review before sharing.
  Exports are portable templates, not complete secret-bearing backups. Existing
  JSON upload/paste import and manual editing remain available.
- **Preflight:** execution account, destination/nearest existing ancestor access,
  Git/Bash/copy tools, Node/npm when applicable, and cache write access. The same
  checks run in the CLI worker before fetch/copy/install, and directory-creation
  failure now has a clear ownership/permission explanation. No chmod, chown,
  directory creation, sudo or package installation occurs in the read-only check.
  Checks cannot guarantee Git credentials, package installation, free ports,
  storage capacity, native supervisor survival or service health.
- **Jobs:** persistent-in-page text/status filters; log text filtering, follow
  toggle, pause/resume fetching and local download of the loaded buffer. The log
  buffer retains at most the latest 2 million characters; downloads are **not**
  guaranteed to contain the complete server log. Clearing is local only.
- **Files:** quick filtering of the currently displayed directory, in addition
  to the existing server-side search. Hidden selections remain selected; filtering
  does not change the explicit selection count or bulk-action targets.

Upgrade by replacing only the PHP file at its existing location. Preserve
`.wconsole_data`, project data and `.env.local`. No main Scraper4 version change
is needed for this independently versioned console release.

### UI/browser validation

The regular suite exercises PHP syntax/helpers, frontend DOM interactions,
import/export, appearance preview/save/cancel, presets, log controls and preflight
failure behavior. Optional real Chromium tests use the actual inline HTML/CSS/JS
with **mocked authenticated APIs**, not a live PHP/VPS deployment. They exercise
all 75 combinations of five palettes, three layouts and five viewport widths,
plus navigation across every original section and project import/export.

```bash
node --test tools/webconsole/webconsole.test.mjs tools/webconsole-repair/repair.test.mjs
# PHP_PARSER_PATH and PHP_BIN enable the additional PHP parser/engine checks.
PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
CHROMIUM_BIN=/absolute/path/to/chromium \
node --test tools/webconsole/webconsole.browser.test.mjs
```

Playwright/Chromium are optional external test dependencies; they are not needed
on the server hosting the standalone console. Without PLAYWRIGHT_PATH, the
browser test is explicitly skipped. Native Linux/PHP-FPM process supervision and
live GitHub/VPS operations still require deployment testing.

## Project JSON import (1.1.2)

Open **Projects → New project / Settings → ورود JSON**. Select a `.json` file
or paste JSON, then choose **اعمال در فرم برای بازبینی**. Review the manual form,
then Save. Import itself never saves, installs, or starts anything, and files are
read locally in the browser (not uploaded to a separate endpoint).

The format is one project object, or `{ "project": { ... } }`. `name` and
`repo_url` are required. Supported optional fields are `type`, `branch`,
`subfolder`, `deploy_path`, `port`, `install_cmd`, `build_cmd`, `start_cmd`,
`auto_start`, `is_daemon`, `env`, and `auth_token`. An imported `id` is ignored:
the current dialog controls whether Save creates a project or edits its target.
Unknown fields and invalid types are rejected. Maximum UTF-8 size: 256 KiB.
Booleans must be JSON true/false, not quoted strings. Environment values can be
single-line strings, finite numbers or booleans; numbers/booleans become strings.

Only supplied fields are changed. Environment keys merge with existing form
values; imported keys override matching keys, while omitted database/auth keys
are retained. An empty env object does not clear existing values. A missing
auth_token does not overwrite the pending token field. Edit the manual form to
remove unwanted environment entries. Import trusted profiles only: install/build/
start commands are arbitrary shell commands when you later deploy/run the project.

`examples/scraper4-project.json` contains the requested VPS profile. Its empty
`deploy_path` selects managed storage for a new profile (preserves the current
path when editing an existing profile). It uses deployer port 8790, scraper port 3000, loopback
binding for Caddy, and disables Git auto-updates in the copied checkout. It
contains no credentials or database override. Set strong ADMIN_TOKEN and
DEPLOYER_UI_TOKEN privately and retain the appropriate database configuration.
The execution account still needs ownership/write access to the deployment path.
Auto-start after deployment is deliberately false: review the installation and
stop any competing systemd instance before explicitly pressing Start in WebConsole.

## Installation

1. Keep a copy of the existing PHP file **outside the public web root**.
2. Preserve the existing `.wconsole_data` directory. Stop its active jobs.
3. Check `php -l webconsole.php` with the VPS's native PHP CLI.
4. Replace the old console at its original directory and filename. Do not leave
   an old second admin console publicly accessible.
5. Refresh, log in, and submit a new job. Old failed jobs do not auto-resume.

Requirements: Linux, PHP 7.4+ (a supported PHP 8.x release is recommended), PHP
CLI with exec/proc_open, util-linux/setsid, bash, git, tar, and the normal build
prerequisites for each deployed project. PHP cURL is needed for the GitHub API.
The PHP ZIP extension is needed for checked ZIP extraction; zip is usable for
creation. tmux is recommended for the interactive terminal; screen/simple shell
fallbacks remain. CDN-loaded xterm/CodeMirror have plain-text fallbacks.

PHP CLI is discovered and probed. For nonstandard installations, optionally set
`WCP_PHP_CLI` to the absolute CLI binary path in the PHP web environment, or
add `define('WCP_PHP_CLI', '/absolute/path/to/php');` near the top of the file.
Do not point it at php-fpm, php-cgi, an empty value, or a web-server executable.

## Changes from the supplied console

- CLI discovery, same-data-directory propagation, nonce-bound startup receipt,
  real worker PID recording, failed launch logs/status and JSON API errors.
- Zombie/command-line identity checks; log chunk offsets and completed-job drain.
- A Jobs view exposes failed jobs even if the original launch request failed.
- Undefined terminal cleanup call fixed. Real terminal control characters and
  separate fallback command/output fields. Compact responsive RTL interface.
- New files use a restrictive umask; new private directories use 0700 and saved
  configuration uses 0600. Existing directory permissions are **not** recursively
  migrated. GitHub TLS verification is enabled.
- IP allowlisting uses REMOTE_ADDR instead of trusting arbitrary forwarded
  headers. Configure the web server's trusted-proxy/real-IP handling if needed.
- Failed install/build commands stop deployment and do not auto-start a broken
  build. Per-project deployment lock, per-job step scripts, persisted deployment
  result, and guarded service Start. .env.local and data are excluded from copy.
- ZIP extraction requires ZipArchive and rejects traversal/symlink entries.
- Backup excludes its own working/data directory to avoid recursive self-copy.
  Database dumps run with the execution account's privileges; no implicit sudo.
- Service child is started without an extra proc_open command shell; backoff is
  bounded. The daemon checkbox is honored. This is still not an OS supervisor.

## Security and operating limits

This is a powerful administrative command runner, **not a hardened public hosting
panel or multi-user sandbox**. Use HTTPS, a strong password, restricted network
access, and a dedicated **non-root** account. Do not grant blanket sudo or give
this account write access to code executed by root services.

Block all HTTP access to `.wconsole_data` in your web-server configuration.
`.htaccess` is insufficient on Nginx. Prefer a private backup repository; backups
can contain secrets. Backup force-pushes the configured backup branch, so never
point it at the source-code branch. The pre-restore safety tag captures the
existing remote backup branch, **not a fresh snapshot of current VPS files**.

The console cannot survive reboot or every OS/process kill on its own. Keep
Scraper4 under systemd for boot persistence; do not run both its systemd service
and a console-managed instance on the same ports. This file does not install,
stop or configure systemd automatically.

The generated .env.wcp belongs to console-launched commands; an existing systemd
service does not automatically consume it. Check filesystem ownership and Node
PATH under the actual execution account, not only under an SSH root session.

## Validation

`node --test webconsole.test.mjs` checks API/view coverage and inline JavaScript.
Set `PHP_PARSER_PATH` to an installed php-parser package for an additional PHP
7.4 syntax parse. `php -l webconsole.php` is the native PHP lint command.
`PHP_BIN=/path/to/php node --test webconsole.test.mjs` additionally runs isolated
PHP helper/error-state checks. No GitHub backup, restore or live VPS deployment
is performed by the tests. PHP-WASM can check syntax and pure helpers but cannot
prove native Linux process supervision (its getmypid() returns 1).
