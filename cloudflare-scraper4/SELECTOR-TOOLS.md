# Browser-aware selector tools — 1.216.0+

In **Selectors → subtabs 2 and 3**, automatic suggestions and selector tests
now use the extraction engine currently selected in the form, even before
saving the profile. This includes list fields, detail fields and gallery tests.

- **Playwright:** the existing Python-adapted Playwright navigation/context.
- **Puppeteer:** the existing Puppeteer renderer.
- **Crawlee Playwright:** the existing PlaywrightCrawler renderer.
- **Network API:** Playwright-rendered DOM for these tools; CSS selectors
  cannot select nodes from captured API JSON.
- **Other engines / Auto:** the previous initial-HTML behavior is unchanged.

The rendered document is passed to selector discovery/testing, not to the
product parser. The optional second-stage product-parser switch has no effect
on DOM selector tools. Browser failures do not fall back to initial HTML.
Gallery tests on browser HTML return image URLs and respect the requested
limit and skip-first option.

Browser tools require a usable Chromium installation on Node (including
VPS/Termux). Cloudflare Worker explicitly rejects browser-mode tool requests;
it does not claim an initial-HTML test is a rendered-browser test.

Each selector request renders its own page; these are not persistent logged-in
browser sessions. Browser navigation and wait policies are reused, not expanded
into a new scrolling or anti-bot retry policy.

Validation uses a fixture whose product cards, detail fields and gallery exist
only in the simulated rendered DOM. The regression fails on 1.215.0+ and passes
with this change. Tests also exercise actual dashboard functions and HTTP
handlers, all browser choices, non-browser behavior and Worker rejection.
No live-site success or VPS deployment is implied.
