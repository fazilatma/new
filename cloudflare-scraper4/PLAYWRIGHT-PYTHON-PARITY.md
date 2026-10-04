# Playwright-only Python adaptation — 1.214.0+

Reference: `fazilatma/new`, branch `arena/01a0c9ea-new`, commit
`fa0a3c3b486c0e3930c9e6a6283f0a1501e79511`,
`python-scraper4/scraper4.py`, function `render_playwright`.

Only ordinary direct **Playwright** extraction was adapted. Puppeteer, Crawlee,
network-API capture, visual selector, guarded scroll-to-end, product parsers,
settings/storage, Python proxy/relay configuration, and browser installation are
unchanged. The previously unfinished guarded-403 retry was discarded, not released.

Adapted behavior:
- Explicit configured browser paths still win. Otherwise use this installation's
  full Playwright Chromium executable if present, as Python does; retain the default
  headless-shell fallback when full Chromium is absent. Never search another
  project's or user's private browser cache.
- Chrome 131 desktop user-agent (existing USER_AGENT override preserved), Persian
  locale, 1366×768 viewport, Asia/Tehran timezone, AutomationControlled launch flag,
  and the reference's inline navigator/window initialization.
- Dismiss JS dialogs and close popup pages. Validate public HTTP request URLs;
  block service workers to keep requests visible to the route guard.
- Navigation wait sequence: load, DOMContentLoaded, commit on timeout. Existing
  Node redirect/ERR_ABORTED recovery is retained. Non-timeout errors still fail.
- Snappshop/Digikala: 1.8s settling, eight bounded scrolls, 850ms between scrolls,
  and bounded product-selector waits. Other hosts use 0.5s and four 600ms scrolls.
  These bounded scrolls do not claim to exhaust an infinite catalog.
- Preserve in-memory Next/Nuxt hydration data for existing parsers; escape closing
  tags safely. Keep the actual observed HTTP status instead of the Python function's
  unconditional final 200. Close Chromium on errors and cancellation.

No optional Python `playwright_stealth` plugin dependency, Python browser installer,
root cache scanning, relay credentials or other Python subsystems were copied.
Only the inline initialization contained in `render_playwright` was ported.

Offline fixture tests fail with zero products against the prior Node Playwright
context and recover four products with the adapted context. They also check timeouts,
cleanup, cancellation, guarded requests, executable preference, and byte-for-byte
unchanged Puppeteer/Crawlee implementations. This is not a live Snappshop test:
Python/Node browser versions, proxy routes, IPs, sessions and website policy may still
differ. The change does not guarantee that an HTTP 403 will disappear on the VPS.
