# Browser selector evidence and loading-only snapshots — 1.223.0+

The reported Snappshop profile yielded one title, no price, no URL and no image
through Playwright + the pinned lxml-equivalent parser. Its container selected
`a[1]/article` and its absolute title selector also selected the first card. A
link on the ancestor anchor cannot be selected as a descendant of that article.
The reported image/price selectors returned no data; this does not establish a
network image-download failure.

Both diagnostic twins now provide read-only recommendations about first-card
containers, ancestor anchors and actual image nodes/attributes. No custom
selectors or parser settings are rewritten. A title-only result is explicitly
failed at product-completeness, rather than accepted as a complete product.

For browser-engine profiles, initial-HTML selector evidence is informational and
marked skipped/non-applicable, with its original counts preserved. It is not a
rendered-DOM validation and cannot independently fail the whole diagnostic. Actual
list/browser/detail errors still fail as before. Static-engine evidence retains
its existing validation semantics. This change does not fetch another browser
snapshot merely to revalidate selectors.

The visual browser snapshot path waits up to 12 additional seconds for visible
content if the page is blank or consists only of a loading message; the outer
non-scroll deadline is now 60 seconds. This is a minimal visible-content heuristic,
not proof of complete application hydration or product coverage. A permanently
empty/loading snapshot returns an explicit error, including up to six failed
resource entries with URL queries removed. Visible pages with failed critical
scripts/API requests show an incompleteness warning in the visual toolbar.
No direct-network fallback, engine substitution, URL rewrite or automatic scroll
is introduced. Existing scroll-session behavior is unchanged.

`snapp-like-rendered-cards.html` is a synthetic fixture based on the supplied
ancestry, not live Snappshop HTML. It reproduces first-card/title-only extraction
on Node and demonstrates repeating outer-anchor containers, card-relative titles,
anchor links and img/data-src extraction on both twins. Worker retains its legacy
image fallback. The fixture price class is invented solely for testing and must
not be suggested as a live site's price selector. Live Snappshop completeness,
price selectors and visual rendering remain unverified.
