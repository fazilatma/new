# WebConsole Pro complete-file repair (1.1.1)

This is an offline HTML repair utility, **not a replacement console**. Open
`webconsole-repair.html` in a browser, select the original WebConsole Pro 1.1.0
PHP file (or paste its complete source), generate, then download the complete
`webconsole-fixed.php`. No input is executed or uploaded. The output retains
all original sections outside the count-asserted replacements.

This supports the specific source supplied in the conversation. It refuses
unexpected versions or missing/duplicate anchors rather than guessing. It
refuses a second application to already repaired code. The main Scraper4 code
and release version are unchanged.

## Repairs

- Find and probe PHP CLI rather than executing an empty/FPM `PHP_BINARY`.
  Optional administrator override: define `WCP_PHP_CLI` with an absolute PHP CLI
  executable path, or set the environment variable with that name.
- Pass the parent's actual data-directory selection to the worker. CLI and PHP
  web INI configurations can otherwise disagree on temporary directories.
- Require a nonce-bound acknowledgement written by the real PHP worker. Do not
  confuse an intermediate setsid/shell PID with a successfully booted worker.
- Mark preflight/launch failures as failed (exit 127); return descriptive JSON
  errors and retain logs. Five-second startup acknowledgement timeout; late
  workers reject expired or cancelled launches. This is startup confirmation,
  not successful deployment confirmation.
- Check command-line job identity before reporting running or stopping a job;
  exclude zombies. Existing service-child PID handling is not fully redesigned.
- Preserve log chunk offsets and drain queued log data after completion.
- Replace an undefined `term_close()` call with the existing `term_kill()`.

## Installation

Keep a backup outside the web root. Preserve `.wconsole_data`. Stop existing
console-managed jobs. Run `php -l webconsole-fixed.php` on the VPS, then replace
the original file at the original location. Refresh and submit a new job.
Requires Linux, PHP CLI 7.4+ with exec/proc_open, setsid (util-linux), and matching
filesystem access for the PHP web user. Never run PHP-FPM as root or grant the
web user blanket sudo privileges.

## Limits

This is not a security audit or a complete process supervisor rewrite. Existing
world-writable settings, disabled TLS verification, backup/restore handling,
service-child stopping, and deployment success propagation need further work.
Do not expose this powerful console unrestricted to the Internet. In particular
Nginx does not enforce .htaccess. Use systemd for restart after a VPS reboot.

## Development

`node build.mjs` regenerates the standalone HTML from `repair.mjs`.
`node --test repair.test.mjs` checks supported patches, rejection cases,
unchanged surrounding content, generated JavaScript, and PHP syntax when
`PHP_PARSER_PATH` points to an installed php-parser package. These are fixture
and syntax tests, not a live PHP-FPM/VPS deployment test.
