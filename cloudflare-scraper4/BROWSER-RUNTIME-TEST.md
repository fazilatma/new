# Persistent browser runtime test — 1.221.0+

The browser-library repair section provides an independent Playwright/Puppeteer
selector and four controls: test and keep open, close, refresh status, copy runtime
report. This is a **headless browser on the Node server**, not a window on the
user's phone and not a remote desktop.

The test launches one browser, creates a page, navigates to an application-owned
`data:` document and verifies its title. A successful session has no idle expiry.
It remains open when the dashboard is closed or refreshed, until explicitly
closed, crashed/disconnected, or the service stops. Starting again returns the
existing session; close during startup cancels retention and cleans up the late
launch. Closing only affects this diagnostic browser, never extraction sessions.

Do not leave this running while extracting on a 1 GB VPS unless you have verified
sufficient memory. It is separate from the extraction pool and consumes RAM.
Cloudflare Worker reports that this feature requires Node. Browser dependencies
are not installed or downloaded by this test.

## Network and permissions

The controlled local document makes no external requests. Chromium uses the same
closed native proxy and WebRTC restrictions as visual snapshots. The same visual
sandbox policy is used: `VISUAL_BROWSER_NO_SANDBOX=true` is the only sandbox
exception. Root must explicitly acknowledge running the test with root privileges;
that checkbox **does not disable the sandbox**. Consequently, a root sandbox
launch failure is reported rather than hidden by changing launch policy. Prefer a
non-root service. Success here does not establish Snappshop connectivity or that a
heavy page fits in memory.

Existing optional global API authentication applies. There is no new token.
Mutating requests require `x-browser-runtime: 1`, a bounded JSON body and an
explicit action. Only driver and boolean root consent are accepted for opening;
there is no arbitrary target URL, shell command or executable override API.

## API and report

- `GET /api/runtime/browser-session`: read-only current state/events.
- `POST /api/runtime/browser-session`: `{"action":"open","engine":"playwright",
  "allowRoot":true}` or `{"action":"close"}`. Opening returns 202 immediately;
  status is polled while starting/open/closing.
- `GET /api/runtime/browser-session/report`: current runtime evidence plus the
  existing read-only installation/environment report. It never launches or repairs.

Phases: idle, starting, open, closing, closed, failed. Failures identify launch,
new-page, navigation, page-check, page-crash, page-close, disconnection or close.
Nested causes are included, secrets/URL queries redacted, and memory at failure
recorded. Browser version and PID are included where the driver's public API
provides them (PID is typically available for Puppeteer, not Playwright).
Events are limited to the most recent 60 entries, each at most 6,000 characters;
last-failure text is limited to 16,000. The last failure survives Close and later
runs; timestamps distinguish historical errors from the current open session.
All history is in memory and disappears on service restart.

On insecure HTTP dashboards or clipboard denial, the report remains in a visible,
selectable textarea. An unsuccessful clipboard operation is not reported as copied.
Closing failures are reported as failed with a retryable Close operation, not as a
successful shutdown of a still-connected browser.

Validation uses injected browser lifecycle fixtures and the real dashboard script:
retention, duplicate starts, both drivers, startup cancellation, late crashes,
redaction, bounded history, close retry, request validation, polling and clipboard
fallback. It is not evidence of successful launch on the user's VPS.

## 1.222.0+ — organized browser workbench

The existing browser section is reorganized into live testing, installation and
cache preparation, manual instructions, and report guidance. The same IDs,
actions, consent requirements, APIs and lifecycle behavior are retained.

Runtime status now includes a phase badge, connection/page-verification/driver
metrics, last-refresh time and the eight most recent lifecycle events. Historical
errors are explicitly labeled and do not imply that a currently open browser has
failed. Failed status requests replace live metrics with unknown/stale indications.
Installer results distinguish successful, failed and skipped engine tests.

Technical logs are collapsed by default, while copied report textareas remain
visible on demand for manual selection. Layout stacks on smaller viewports, uses
relative sizes, preserves keyboard-native disclosure controls and provides visible
focus outlines. No browser is opened automatically by viewing this section.

## 1.222.1+ — accurate crash-event payload handling

Playwright's `page.on('crash')` callback receives a **Page**, not an Error. This
payload is now replaced with a precise renderer-crash message rather than
stringified as `[object Object]`. Puppeteer's actual Error and nested cause remain
intact. If navigation or title verification rejects after the crash event, its
redacted error is retained in `lastFailure.relatedErrors` and the event timeline,
without replacing the primary crash. Related errors are bounded to five entries.

A local-page crash after a browser-version/connected event establishes that launch
succeeded but local rendering failed. It is independent of the source website;
it does not establish an OOM kill or a missing browser binary. This patch fixes
reporting and does not claim to repair the user's Chromium crash.
