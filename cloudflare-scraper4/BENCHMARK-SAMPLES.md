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
