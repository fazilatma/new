# Scraper4 deployment workflow

Work only on `arena/f3d5d2a0-new`. The production site is
`https://fazilatma.pythonanywhere.com`. Publishing a Git commit is NOT deployment.

After changing `pythonanywhere/`:
1. Run the Python tests, `node --test pythonanywhere/tests/auto_refresh.test.cjs`,
   `npm ci --prefix tools/ui-tests` then
   `NODE_PATH=tools/ui-tests/node_modules node --test pythonanywhere/tests/settings_transfer_ui.test.cjs`,
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


## Ongoing PHP parity work (standing user request)
For EVERY subsequent user prompt, complete the next bounded, tested PHP parity
slice alongside the explicit request, unless the user changes this instruction.
Verify the latest source on `arena/01a0ebf7-new`, implement real behavior (not just
menu placeholders), add regressions, update the parity ledger and report both
what works and what remains. Do not claim full parity. Follow the deployment
workflow above after pushing. If a slice is blocked, explain the concrete blocker
rather than claiming it is done. Keep each slice compatible with safe resumable
minute-cron boundaries and preserve credentials, products and remote IDs.
