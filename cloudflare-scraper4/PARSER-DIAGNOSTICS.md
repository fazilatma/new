# Parser comparison and manual-selector retention — 1.229.0+

With **second-stage HTML parsing enabled**, Extraction Diagnostics compares all
 eight configured choices: auto, lxml, selectolax, jsonld, next_data, script_json,
metadata and heuristic. Each result contains its own count, elapsed time,
completeness counts, error/empty/skipped state, up to five samples and a product
card. The full-product button opens that parser's sample, not the primary sample.
The JSON/copy report includes the matrix under `parserResults`.

Comparisons use the same downloaded document, or the same rendered HTML from the
selected Node browser loader. No browser is launched per parser. Scroll comparison
uses the final rendered snapshot, not the entire union of virtualized cards.
If that loader fails before delivering HTML, all eight rows are marked skipped;
initial HTML is not falsely presented as rendered evidence. Individual parser
exceptions are isolated. A comparison finding nothing does not replace the
selected parser or turn a successful selected pipeline into a failed one.

The switch OFF leaves comparison absent and runs no additional parser sweep.
Existing detail diagnostics may still fetch product pages independently of this
matrix. lxml/selectolax remain JavaScript-compatible implementations, not Python
libraries. Explicit structured-data parsers and heuristic strategies do not use
manual DOM selectors; the UI now states this distinction.

## Selector fixes

- Visual selection previously assigned input values without raising input events
  or scheduling autosave. It now queues a field-level selector patch immediately.
- Applied suggestions use the same autosave path.
- Diagnostics, home extraction and job creation wait for queued profile edits;
  an outstanding failed save aborts execution rather than using stale settings.
- A partially completed set containing a custom selector is now classified as
  custom, not unconfigured. DOM readers do not silently rediscover over it.
- The job's last-resort selector replacement is limited to unconfigured sets.
- Background learning and diagnostic persistence use field-level conditional
  updates with compare-and-swap writes in both databases. They do not replay an
  old whole-profile object over newer manual selectors, parser switches, prices
  or destinations. Empty learned values never erase a selector. Explicit saves
  and intentional manual clearing remain allowed.

Tests reproduce both the missing matrix and partial-manual misclassification,
then cover all choices, OFF, network failures, per-parser errors, rendered-vs-
initial HTML via a deterministic loader fixture, DOM autosave, escaped product
cards and concurrent profile edits. Real browser/network behavior is not newly
verified by those fixture tests. No extraction-engine selection or parser ordering
was changed; selector-independent engines remain selector-independent by design.
