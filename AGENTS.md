# Scraper4 deployment workflow

Work only on `arena/f3d5d2a0-new`. The production site is
`https://fazilatma.pythonanywhere.com`. Publishing a Git commit is NOT deployment.

After changing `pythonanywhere/`:
1. Run the Python tests, `node --test pythonanywhere/tests/auto_refresh.test.cjs`,
   `npm ci --prefix tools/ui-tests` then
   `NODE_PATH=tools/ui-tests/node_modules node --test pythonanywhere/tests/settings_transfer_ui.test.cjs pythonanywhere/tests/product_browser_ui.test.cjs pythonanywhere/tests/selector_preview_ui.test.cjs pythonanywhere/tests/extraction_control_ui.test.cjs pythonanywhere/tests/worker_runtime_ui.test.cjs pythonanywhere/tests/extraction_tools_ui.test.cjs pythonanywhere/tests/start_ui.test.cjs pythonanywhere/tests/profile_menu_ui.test.cjs pythonanywhere/tests/php_original_ui.test.cjs`,
   `npm ci --prefix tools/browser-tests` then `npm test --prefix tools/browser-tests`
   (real Chromium with security/CSP and timers enabled, temporary Flask DB),
   JS/shell syntax checks and `git diff --check`.
2. Commit the code and push `origin arena/f3d5d2a0-new`.
3. Run `python3 tools/deploy_after_push.py`. It signs the current app source tree
   with the local gitignored `.deployment/signing-key.pem`, publishes a PUBLIC
   release proof in a separate commit on the SAME branch and pushes it. Never
   print, upload, present, or commit the private signing key.
4. Call the returned `url` using the network tool. Its proof is a public signed
   release approval, not a secret API token. No saved PythonAnywhere credential
   is needed in the chat or on the coding agent.
5. Fetch the returned `verify_url` separately. Only report a live deployment if
   `/healthz` has the exact returned commit and expected app VERSION. A request
   accepted, API reload accepted, or HTTP 200 is not enough. A reload can recycle
   the original HTTP request before its response; health verification decides.

One-time bootstrap: the deployment endpoint cannot install itself on a host
running old code. If the live endpoint is absent, report that clearly and give
one current bootstrap command for the user's PythonAnywhere Bash console. Do
not claim deployment succeeded and do not ask for tokens/passwords in chat.

The HTTP deployer installs code only, from the fixed repo/branch with a valid
15-minute Ed25519 source-tree approval. It never runs pip, shell, subprocesses
or schema migrations in WSGI. Dependency, database-code or authority changes
require the CLI installer (or an independently configured CLI update Task).
The browser administrator can disable signed deployments immediately. The
queue cron and full-admin API credentials must never authorize deployment.

If the signer is lost, stop and explain that a newly pinned public authority
must be installed through the CLI; never silently substitute a new key or
weaken TLS/signature checks. Private artifacts live only in `.deployment/`.


## Active user interface scope
Latest user instruction supersedes the previous original-only restriction.
For every prompt FIRST check the latest `arena/01a0ebf7-new` source. Preserve the
exact original shell/functions snapshot in `/php-ui` through reviewed vendoring;
port real backend behavior in bounded tested slices, never fake full parity.
Add the same supported capabilities to the initial Python dashboard `/` using
shared services/controllers. Keep both interfaces operational and tested. This
does not authorize copying PHP credentials/nonces, running PHP, weakening the
sandbox, automatic failed retries, or changing deployment authority.

## Ongoing PHP parity work (standing user request)
For EVERY subsequent user prompt, complete the next bounded, tested PHP parity
slice alongside the explicit request, unless the user changes this instruction.
Verify the latest source on `arena/01a0ebf7-new`, implement real behavior (not just
menu placeholders), add regressions, update the parity ledger and report both
what works and what remains. Do not claim full parity. Follow the deployment
workflow above after pushing. If a slice is blocked, explain the concrete blocker
rather than claiming it is done. Keep each slice compatible with safe resumable
minute-cron boundaries and preserve credentials, products and remote IDs.

## Original PHP client integrity
The entire pinned line-start HTML document lives at
`pythonanywhere/scraper4/upstream/php-ui.html`; DO NOT reformat or edit it.
Use `tools/vendor_php_ui.py` with a verified full source commit; changed PHP
output slots require explicit renderer review. Runtime adaptations belong in
`services/php_ui.py` and `static/php-ui-{frame,attach,host}.js`. The sandbox must
never gain `allow-same-origin`, cookies, CSRF, broad own-origin subresource access
or direct networking. The parent broker checks exact frame source/null origin,
whitelists operations and confirms every write. Never map legacy GET heartbeats
to production cron or auto-retry remote sends. Keep the working default dashboard
until native-client capability gaps are closed and browser-verified.

## Live maintenance recovery boundary
If production returns Maintenance in progress, check health AND deploy route
before claiming a new signed HTTP request can repair it. Existing maintenance
intentionally blocks signed deployments too. Do not weaken that guard or erase
a remote marker without validating the installed code. The owner-console helper
`tools/recover_live_install.py` is inspect-only by default; explicit --recover-code
uses the existing code-only snapshot rollback under the worker lock, and optional
--probe-all diagnoses the installed real app in a fresh process without running
queues. See tools/RECOVERY.fa.md. Do not suggest the plain maintain CLI for a
no-queue recovery: it invokes tick afterwards. A CLI WSGI/source probe is NOT an
external authenticated HTTP test; record that transport distinction explicitly.
