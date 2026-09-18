# WebConsole Pro 1.1.1 — complete standalone PHP file

**Deploy `webconsole.php`.** This is the actual console, not the earlier offline
HTML repair tool, and it does not require the repair utility at runtime.

This edition is based on the PHP source supplied in the conversation. It is
**not a byte-for-byte minimal patch**: the interface and implementation have
been compacted, a Jobs view was added, and the fixes below were integrated.
It retains the terminal, file manager/editor, uploads, process manager, GitHub
explorer, backup profiles/snapshots/restore, project deployment/service runner,
settings and authentication features. Existing JSON configuration filenames and
project/profile field names are retained.

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
