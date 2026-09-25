# Browser installation gateway and same-VPS cache reuse — 1.217.0+

Open **Code version → Install/repair Playwright, Puppeteer and Crawlee**.
The existing install button and a separate cache-copy button share the job log,
root acknowledgement and the server's owner-configured authentication policy.

## Install through the active Cloudflare gateway

When the source connection settings select **Worker**, installation reads the
saved gateway (legacy AI network settings remain the fallback). It applies to
public npm packages and browser archives, not just extraction requests. The
source-domain filter is intentionally not applied to installer destinations.
No changes to `HTTPS_PROXY` on the host are necessary: a reverse Worker URL is
not a CONNECT proxy.

Child installation processes get a scoped Node preload adapter. HTTP(S)
requests to approved package/artifact hosts and builtin fetch requests go
through the gateway's existing query, `{url}` or path contract. Registry auth,
cookies and custom client TLS credentials are not forwarded. Ordinary TLS
certificate validation stays enabled. npm checks tarball integrity as usual.
The parent scraper and browser launch checks do not load this adapter.

Proxy failure **does not fall back to direct access**. Optional npmmirror
attempts still require the existing consent and use the same gateway. The
Worker must support streaming large binary responses and the selected gateway
contract; a configured Worker URL alone does not prove that browser archives
can pass its bandwidth, time or response-size limits. A changed upstream CDN
outside the approved host list fails explicitly rather than bypassing it.
Without an active Worker route, the prior installation environment is retained.

## Copy browsers already installed on this VPS

The new button **copies**, rather than moves, the two browser caches:

| Cache | Default source | Runtime destination |
| --- | --- | --- |
| Playwright | `/root/.cache/ms-playwright` | `PLAYWRIGHT_BROWSERS_PATH`, or the current user's XDG/default cache |
| Puppeteer | `/root/.cache/puppeteer` | `PUPPETEER_CACHE_DIR`, or the current user's default cache |

Set `BROWSER_CACHE_SOURCE_HOME=/home/previous-user` in the scraper service's
environment to copy from a different user's home. Restart after changing the
service environment. `PLAYWRIGHT_BROWSERS_PATH=0` (package-local mode) is
rejected for copying; choose an explicit shared cache first.

- Creates destination directories and prepares readable/executable modes.
- Retains source files and existing destination content; repeatable without
  overwriting browser binaries. Playwright `.links` metadata is not copied.
- Resolves cache root aliases and copies contained source links as regular files.
  Rejects escaping links, directory cycles, nested destination symlinks and
  overlapping source/destination trees. Root aliases must name browser cache
  directories, unless source and target already resolve to the same directory.
- Runs under the **actual scraper user**: no sudo, automatic ownership change,
  OS package installation, service restart or deletion of source caches.
- If `/root` is unreadable to that user, a privileged administrator must first
  provide a readable staging home. The button reports the error; it cannot
  grant itself permission. Partial copies after an error are not called success.
- Does not copy `node_modules`, download missing packages, or downgrade versions.
  Use install/repair first if the project libraries are missing.
- Tests Playwright, Puppeteer and both Crawlee launchers afterwards. Old cache
  revisions, incompatible architectures, missing OS libraries or explicit
  executable overrides can still fail; merely copying folders is not success.

Tests include a local TLS gateway with real Node HTTP/fetch and npm metadata
plus integrity-checked package installation, filesystem reuse/idempotency,
permission modes, symlink rejection, no-download reuse and UI intent. No live
Cloudflare large-archive download or VPS deployment is claimed.

## Copy a support report — 1.218.0+

Use **Copy complete support report** in the same install/repair panel. It fetches
fresh, read-only diagnostics from `/api/runtime/browser-repair/report`, appends
the client browser/clipboard context, and copies the text. The report is also
shown in a read-only text box so it can be reviewed or manually copied when
clipboard permission is unavailable. It is not sent to a third party.

Included: app version/commit, OS/kernel/architecture/glibc, Node/npm versions,
UID/GID/root status, RAM/disk, project permissions, locked and installed browser
library versions, executable selection and permissions, cache source/destination
paths and revisions, current proxy/gateway configuration, installation policy,
last-job options/route/timestamps/results, and the available log tail. Current
settings are distinguished from recorded job conditions. Missing information is
reported as unavailable rather than guessed. Network settings cannot be read
from the database if that connection is unavailable.

No full environment/configuration dump is included. Known secret values, URL
credentials and query strings, authorization tokens and sensitive assignments
are redacted. Gateway paths are omitted. Paths and hostnames remain useful for
diagnosis: review them before sharing. The endpoint retains global API auth and
uses `Cache-Control: no-store`.

The log is capped at **24,000 characters**, with a truncation flag, and exists
only in the current process. Restarting clears it. Reporting never runs an
installer, browser, network probe, OS-library command or cache-copy operation.


## Missing Ubuntu libraries and cache aliases — 1.218.1+

A browser can be installed and still fail to launch. For example:

```
error while loading shared libraries: libatk-1.0.so.0
```

This is an **OS dependency** failure, not proof of a missing browser archive.
The repair job now records `errorCategory: missing-os-libraries`, names the
observed missing libraries, and skips a redundant download for that driver.
On the reported Ubuntu 24.04 VPS, run the matching installed Playwright CLI
from the project directory as an administrator:

```sh
cd /var/lib/webconsole-projects/scraper4-cloudflare-11dad8732b
node node_modules/playwright/cli.js install-deps chromium
```

This command changes system packages using Ubuntu's package manager. It is not
run automatically by the dashboard, and the browser-download Worker adapter
does **not** route apt traffic. If Ubuntu repositories are inaccessible, that
must be resolved separately. Retest browser launch afterwards; no target-site
success is implied.

Cache reuse compares real paths first: two aliases of the same runtime cache
need no copy or chmod. Safe source links contained inside the cache can be
copied without retaining symlinks. Unsafe links remain errors. Each cache has
its own status; copy failures no longer suppress all browser launch results.
A job with a failed copy still reports overall failure even if browsers launch.
Support reports show resolved paths as well as direct symlink status.

A missing Puppeteer Chrome revision remains a separate issue. HTTP 500 from
both the official archive and mirror through a gateway does not prove which
hop caused the failure. Failed downloads now log status, target hostname and
`cf-ray` when provided. No direct fallback, version downgrade, automatic
browser substitution or OS installation was introduced.
