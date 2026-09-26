# Visual picker catalogue readiness — 1.230.0+

## Reproduced issue

The old readiness check accepted any visible image (including a store logo) or
20 characters of body text (including navigation/header text). A client-rendered
store could therefore be captured during its splash screen. The captured HTML
is sanitized and original scripts removed; hydration cannot continue afterwards
inside the picker iframe. Waiting in that iframe does not finish the shop load.

`worker-tests/fixtures/spa-splash-catalog.html` reproduces a logo, navigation,
full-page splash and delayed three-card catalogue. The old check accepted the
splash; the new list-specific probe rejects it and accepts the hydrated cards.

## Changes

- Signed visual tickets include list/detail context and the current container
  selector, including unsaved input. Neither field can be changed by tampering
  with the ticket. CSS and XPath hints are supported; invalid hints are reported.
- List snapshots require visible product candidates outside header/navigation/
  footer areas and reject large loading/splash overlays. Generic product links
  and cards allow correcting a wrong selector without changing saved selectors.
- A bounded 20-second catalogue wait replaces logo-only acceptance for list
  picking. One short viewport movement can trigger initial lazy loading; its
  original position is restored. No buttons are clicked, no consent is dismissed,
  and URLs are not changed. This is **not** full-catalogue scrolling.
- Detail picking retains its separate generic-content readiness check.
- Browser viewport/user-agent settings now use a consistent desktop viewport
  and the application's user agent.
- Snapshot diagnostics include readiness counts, JavaScript errors (bounded,
  URL queries stripped), pending critical resource counts and existing network
  failures. Incomplete loading remains explicit in the picker toolbar.
- Failure to find a catalogue returns a useful error, never initial HTML as a
  browser-success fallback. Wrong selectors are not cleared or rewritten.

## Limits and evidence

This is readiness evidence, not proof of a complete product list or successful
extraction of price/link/image on every card. Unsupported layouts, logged-in
content, consent requirements, failed scripts/APIs and slow sites may still need
attention. The snapshot remains static and cannot load more products afterward.

The visual picker still uses guarded resource transport. The Python-derived
Playwright extractor uses its own rendering path, so a successful or partial
extraction does not prove the visual path succeeded. No direct-network bypass,
cookie forwarding, security relaxation or site-specific selector was added.

Automated tests use a synthetic DOM and mocked browser drivers; they verify
splash rejection, delayed hydration, bounded waits, scroll restoration, selector
retention, signed context and escaped warnings. They do not prove a live Snappshop
render or a complete catalogue on the user's VPS. Supply the current site URL,
container selector and the displayed resource/JavaScript error for further
site-specific diagnosis after updating, rebuilding and restarting.
