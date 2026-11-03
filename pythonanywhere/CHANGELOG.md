# PythonAnywhere port and helper changelog

## Helper 1.0.1 — 2026-11-03

- Added a hidden prompt for a GitHub token and HTTPS askpass authentication so report pushes do not require PythonAnywhere SSH-key setup. Tokens stay out of the Git remote URL and report.
- Added a test confirming the GitHub token is not passed in Git command arguments or embedded in the askpass script.

## Helper 1.0.0 — 2026-11-03

- Added a one-command staging helper to clone/update the session branch, install the Python dependencies, back up and write the WSGI entry point, reload the existing PythonAnywhere web app, and run the gated live smoke tests.
- Added secret-safe JSON reporting, a commit/push to `arena/e868e86a-new`, and a branch readback verification.
- Kept deployment explicitly gated: the expected root response remains HTTP 503 and this is not a production scraper replacement.
- Documented a bootstrap command that works even when `~/new` does not yet exist.
- Added unit coverage for the helper's live-response parsing and staging acceptance checks.
