# Standalone shared-host library helper

This is an opt-in operational helper, not a new application release. The app
version and launch configuration are unchanged.

Run `python3 scripts/shared-host-browser-libs.py --help` for usage. It targets
non-root Linux x86_64 accounts reporting glibc 2.28, with the previously prepared
`~/browser-libs/tools` Python modules (rpmfile 1.0.8 and zstandard 0.19.0).
Python 3.6-compatible syntax/APIs are used; host execution remains unverified.

It downloads five x86_64 packages from the official AlmaLinux 8 BaseOS/AppStream
HTTPS directories and extracts only five named ELF libraries into the account's
`browser-libs/lib`. TLS certificate checks remain enabled. RPM signatures are
**not** verified. This is a compatibility experiment for the reported EL8-like
host, not a claim that its exact distribution or package compatibility is known.
There is no recursive package dependency resolution or RPM script execution.

Only ldd checks receive the private LD_LIBRARY_PATH. The helper never installs
system packages, replaces glibc, changes application settings, exports a global
library path, or launches a browser. A clean ldd result does not prove browser
startup, sandbox support, hosting permission, or successful website extraction.
Missing transitive libraries may require further work. Downloads/extraction
errors stop with exit 1; unresolved dependencies return 2; no detected browser
returns 3. Output explains what remains untested. Existing library outputs are
atomically replaced only after all five ELF payloads have been located.

Paths are derived from the account database rather than shell HOME expansion.
The project can be supplied with `--project`; otherwise the current project or
one unambiguous matching WebConsole project is used. Nothing is deleted.

Offline checks: `python3 scripts/test-shared-host-browser-libs.py` (eleven cases),
plus Python compilation and CLI help. No real shared-host repair is claimed.


## Follow-up: Wayland dependency and Puppeteer evidence

The user's first host run resolved the original four libraries, but libgbm
requires libwayland-server.so.0. The helper now also extracts that library from
EL8's libwayland-server package. The remaining library set is still bounded;
there is no automatic recursive dependency installation.

Puppeteer's ldd result was "not a dynamic executable", not a successful check.
Before each browser ldd check, the helper now reports file size, mode, executable
access, ELF header architecture, and `file -L` output if that command exists.
It reports the ldd exit code and does not equate that message with proven
corruption. Browser binaries are neither modified nor executed by this evidence
step. A matching ELF header alone does not prove a complete/correct binary.
Files unusually small (<20 MB, or chrome <50 MB) are flagged as possibly
incomplete downloads.

Warnings about missing execute permission on the extracted mode-0644 libraries
are expected from some ldd versions; shared libraries need to be readable, not
marked as executables, to be loaded. No permission broadening is performed.

### Opt-in launch check

`python3 repair.py --smoke-test` additionally starts each discovered browser
binary once with `--version` and the private library path, then prints the exit
code and output. It first tries the default flags, then retries with
`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`
to distinguish a sandbox block (SIGTRAP) from a missing library. A crash signal
is decoded (SIGTRAP often means sandbox, SIGSEGV often means truncated binary
or ABI mismatch). That single run proves whether the loader can actually start
the browser, which `ldd` alone cannot. Without the flag nothing is started.
Exit code 4 means a browser was started and failed; exit 0 with the flag means
the loader resolved everything (with or without the sandbox fallback), but site
rendering, hosting limits and the application's own library path are still
unverified.

### Application wiring

The helper only sets `LD_LIBRARY_PATH` for its own `ldd` checks. The application
itself now auto-detects `~/browser-libs/lib` (or `BROWSER_LD_LIBRARY_PATH`) and
prepends it to `LD_LIBRARY_PATH` at startup, and disables the Chromium sandbox
when that private directory is present and `VISUAL_BROWSER_NO_SANDBOX` is still
`auto`. Explicit `VISUAL_BROWSER_NO_SANDBOX=false` or an explicit
`BROWSER_LD_LIBRARY_PATH` is respected. This wiring is covered by the existing
browser-defaults tests plus manual checks; no system-wide changes are made.
