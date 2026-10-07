# Benchmark sample cards and browser diagnostics — 1.219.0+

Each engine row in the pagination-aware three-page benchmark includes a card
from the **first product actually returned by that row's extraction**: image,
title, source price, SKU and product link. Failed, unsupported and empty rows
show an explicit no-sample card. An engine never borrows another engine's
product or an initial-HTML diagnostic sample. Partial runs can show an observed
sample without claiming successful three-page navigation.

The API stores one bounded sample, not the complete product array. Samples and
field completeness counts remain present with the optional second-stage parser
ON; copied reports contain this evidence too. The modal escapes text and
attributes, rejects non-HTTP(S) links/images and supports horizontal scrolling.

With the second-stage parser enabled, non-browser engine labels all invoke HTTP
loading plus the selected parser. They are **not independent tests of JSON-LD,
Next.js, metadata, etc.** The diagnosis explicitly identifies the actual loader
and parser. Benchmarking remains read-only in this mode.

`network_api` with an HTML parser is incompatible: it is now skipped with a
clear reason before launching or fetching, without changing the user's switch.
Turn the switch off to benchmark API-response extraction separately.

Browser error handling:

- Nested Crawlee `cause` errors survive pagination reporting; ANSI noise is
  removed, cycles are bounded and messages have a length limit.
- Missing shared libraries (e.g. `libatk-1.0.so.0`) display an OS-dependency
  diagnosis and the local `playwright install-deps chromium` command.
- Missing Puppeteer Chrome displays a separate cache/install remedy.
- Generic launch failures stay generic if no more specific cause is available.

These are reporting/configuration fixes, not a claim that a remote VPS has been
repaired. The reported VPS still needs its Ubuntu Chromium dependencies installed
by an administrator, and its missing Puppeteer Chrome download still needs a
working gateway or compatible offline installation. The benchmark never runs
apt, downloads a replacement browser, downgrades packages or silently substitutes
HTTP results for a failed browser.

## 1.220.0+ — opt-in automatic sample details

Two independent, unchecked controls beside the test buttons enable automatic
sample details for the benchmark or extraction diagnostic. They send a strict
boolean `withDetails` in the POST body, not a persisted profile setting.

The three-page benchmark still tests list pagination for every available engine.
When opted in, each engine additionally processes **one of its own linked sample
products**, sequentially. This is not a full-catalog detail crawl. Automatic DOM
selector discovery and detail parsing reuse the same fetched document. Browser
engines use their actual browser loader; HTTP engines share HTTP loading and DOM
detail parsing. `network_api` details explicitly use Playwright DOM, not JSON CSS
selectors. Unsupported engines remain unsupported, and no product is fabricated.

Details have separate timing, errors and loader metadata; they do not change the
list ranking. The popup shows the actual description, gallery, SKU, brand,
stock, weight, category, tags, specifications and variations when available.
Closing it returns to the intact report. Source HTML is not executed in the
viewer. Detail errors keep the list sample available. The existing diagnostic
behavior with configured detail selectors remains unchanged when the new option
is off; the switch enables automatic discovery, not a global ban on old probes.

Discovered detail selectors are transient. Full detail products are not written
into the saved benchmark profile. Live samples have a 180,000-character aggregate
string budget, at most 100,000 characters per string and 60 entries per array;
truncation is explicitly reported. A failed detail request is not list failure.
The extraction diagnostic separately marks its detail stage unsuccessful.

For browser profiles requiring indirect networking, the new detail probe refuses
to silently fetch directly: current DOM browser tools cannot guarantee that
route. HTTP probes preserve the source network setting. This limitation appears
as a detail error, without changing the saved network choice.

### Manual browser instructions

The browser-repair and installed-library sections now include independently
copyable command cards with a selectable-text fallback. Commands cover Ubuntu
`install-deps chromium`, lockfile-based Node dependency restoration, local
Playwright/Puppeteer CLIs, native Termux Chromium and cache/version inspection.

Run from the deployed project directory. Browser downloads must use the service
user and its HOME/cache environment. Only the OS dependency step needs elevated
privileges; stop the service before an explicit `npm ci` rebuild. Manual terminal
commands do not inherit the gateway stored in the application database. Where
that gateway is required, use the installer button; HTTP 500 still requires a
working gateway. No commands run merely by viewing/copying these instructions.
