# Visual picker controls — 1.231.0+

## Changes in both runtimes

- **Save and next:** saves the current field before moving to the immediate next
  dropdown option, including a field already picked. No valid selection means
  no advance. The final option stays selected rather than wrapping. The Node
  picker clears its previous element so repeated Save cannot assign it to a new
  field. Worker per-field selections remain available when revisiting a field.
- **Refresh:** buttons inside the picker and in the parent modal request a new
  ticket/snapshot. Worker tickets remain single-use. The parent validates the
  iframe source, channel and origin before accepting refresh messages, flushes
  pending profile edits, preserves list/detail context and saved selectors,
  coalesces concurrent requests and rotates the channel. Closing during a ticket
  request prevents the late response from reopening the modal. Refresh starts
  at the first field of that context; a locally picked but not saved element is
  discarded. The Node picker receives the retained container selector again.
- **Pause:** no selection click capture, hover highlights or picker keyboard
  shortcuts. Native HTML disclosures and controls can receive clicks. Trusted
  local code supports ARIA tabs/disclosures and recognizable popup close buttons.
  **Hide popup**, enabled while paused, lets the user click a dialog or fixed
  popup to hide it locally if its close button is not recognized. Recognized
  backdrops are hidden and page scroll is unlocked. Refresh reverses these
  temporary snapshot changes.

## Safety and limits

This is still sanitized HTML, not an interactive browser session. Source-site
scripts/event handlers remain removed. Site-specific galleries, consent logic,
API-driven tabs, navigation and purchase actions cannot be recreated by pausing.
ARIA controls only show/hide content already present. Popup detection is bounded
and not guaranteed for every custom overlay. Hiding a popup does not accept
consent or mutate the original site. No same-origin sandbox permission or broad
script permission was added; the trusted script remains CSP-hashed. Existing
network/readiness restrictions remain unchanged.

## Validation

- Eight new tests execute the generated Node/Worker scripts against parsed DOM
  and exercise save order, empty/last fields, pause/hover/keyboard behavior, popup
  close/manual hiding, ARIA tabs, native click pass-through, refresh messages,
  single-use Worker tickets, detail progression, parent message validation,
  refresh coalescing, selector retention and close/request races.
- Full gate: `WCP_SYSTEMD_VERIFY=1 npm test`: 1,207 tests; 1,201 passed,
  zero failed, six skipped. Worker typecheck and both builds included.
- Existing snapshot sanitization and CSP hash tests remain green.
- No live-site/VPS or real Chromium end-to-end validation is claimed. The DOM
  tests do not validate browser layout or every vendor-specific advertisement.
