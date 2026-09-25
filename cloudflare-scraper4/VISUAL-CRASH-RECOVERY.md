# Visual snapshot crash recovery — 1.220.1+

`page.goto: Page crashed` means the browser page failed. It does not establish
that selectors are wrong, that the website is universally inaccessible, or that
RAM exhaustion is the proven cause. The reported Snappshop query also contained
`is_available=truesort=50aLgWpage=336`: `sort` and `page` are embedded in the
availability value, not separate query parameters. Verify the URL copied from
the site. The app warns about this shape without guessing a corrected URL.

Only the Node visual snapshot path retries a recognized page/tab/target crash.
The failed browser and outstanding guarded requests are closed first; one fresh
browser is launched with the same driver, URL, indirect setting, sandbox policy
and guarded-source interception. The second attempt skips images, media and
fonts, retaining document, CSS, scripts and API requests. Resource URLs remain
in the rendered DOM; the sanitized selector may display permitted images later.
The retry's aggregate response budget is 20 MB rather than 40 MB. Existing
per-attempt navigation/render limits remain; the retry is not an endless loop.

Successful recovery is labeled in the visual toolbar. A second failure is
reported, with crash-attempt evidence and advice to inspect RAM, swap and OOM
logs and reduce concurrent browsers. Non-crash errors are not retried; launch
errors do not trigger reinstall. Scroll sessions are never restarted and their
completeness semantics remain unchanged. No static-HTML or direct-network
fallback, automatic swap creation, dependency installation or sandbox disabling
is introduced. Cloudflare's static visual path is unchanged.

Offline regression tests reproduce first-attempt crashes, successful fresh
Playwright/Puppeteer recovery, skipped resources, indirect network preservation,
repeated crashes, second-attempt launch failure, safe toolbar warnings, and
non-restarted scroll sessions. They do not establish that the live Snappshop
page will render successfully on the user's VPS.
