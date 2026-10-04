# Compact visual picker — 1.232.0+

## User-facing behavior

- Render diagnostics/warnings appear in a native disclosure, **closed initially**,
  with a count. Messages remain available and escaped; they are not discarded.
  No empty warnings section is displayed.
- Both Node and Worker pickers keep field choice, Save and next, Pause, and a
  **Sticky** checkbox in the primary row. Secondary controls and preview/status
  text move into **Tools and height settings**, initially closed.
- Unchecking Sticky changes the toolbar to normal document flow, at the top of
  the source page. It scrolls away instead of covering products. Scroll back to
  the top to access it again or re-enable Sticky.
- Default maximum toolbar height is **30% of the iframe viewport**. A slider in
  Tools adjusts the cap from **15% to 50%** in five-point increments. Overflow
  scrolls inside the toolbar. Dynamic viewport units are used where supported,
  with a vh fallback. The limit applies to both sticky and flow modes.
- ResizeObserver maintains the page's top offset from the actual sticky toolbar
  height; flow mode removes that offset. Toggle/resize events provide fallback
  recalculation. Settings apply to the current snapshot and reset on refresh.
- Native keyboard operation inside the toolbar is not intercepted by Worker
  selection shortcuts. The existing selection, pause and refresh logic remains.

## Safety

No source-site scripts, broader sandbox permissions or network access were
introduced. Layout code is part of the existing trusted CSP-hashed script.
Extraction and browser-readiness logic were not changed.

## Validation

- 19 focused tests passed across visual-controls and visual-snapshot tests.
- Three new cases cover both runtimes' primary controls, folded tools, document
  position, sticky/flow switching, measured offset, height limits, CSS overflow
  contract, native keyboard pass-through, continued picking, and escaped lengthy
  diagnostics in a closed disclosure.
- Full gate: `WCP_SYSTEMD_VERIFY=1 npm test` — **1,210 total, 1,204 passed,
  zero failed, six skipped**, including version checks, typecheck and builds.
- Tests execute generated picker scripts in a parsed DOM. They are not real
  mobile-browser layout or live-site/VPS verification.
