# Standalone shared-host library helper

This is an opt-in operational helper, not a new application release. The app
version and launch configuration are unchanged.

Run `python3 scripts/shared-host-browser-libs.py --help` for usage. It targets
non-root Linux x86_64 accounts reporting glibc 2.28, with the previously prepared
`~/browser-libs/tools` Python modules (rpmfile 1.0.8 and zstandard 0.19.0).
Python 3.6-compatible syntax/APIs are used; host execution remains unverified.

It downloads four x86_64 packages from the official AlmaLinux 8 BaseOS/AppStream
HTTPS directories and extracts only four named ELF libraries into the account's
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
atomically replaced only after all four ELF payloads have been located.

Paths are derived from the account database rather than shell HOME expansion.
The project can be supplied with `--project`; otherwise the current project or
one unambiguous matching WebConsole project is used. Nothing is deleted.

Offline checks: `python3 scripts/test-shared-host-browser-libs.py` (five cases),
plus Python compilation and CLI help. No real shared-host repair is claimed.
