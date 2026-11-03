# PythonAnywhere port and helper changelog

## Helper 1.0.4 — 2026-11-03

- Added cleanup-only and cleanup-before-install modes for the pip download cache and Python bytecode caches.
- Added an explicit, home-directory-guarded virtualenv removal option requiring confirmation; never deletes the checkout, state, reports, or WSGI backups.

## Helper 1.0.3 — 2026-11-03

- Made the PythonAnywhere API token optional: without it, the helper pauses for a manual Web-tab reload; only the GitHub token is needed to publish the report.
- Clarified that the report is pushed to and read back from the branch, so terminal output does not need to be copied.

## Helper 1.0.2 — 2026-11-03

- Lowered the helper minimum to Python 3.10, matching the port's syntax and allowing PythonAnywhere's reported Python 3.10.5 runtime; documented using the matching web-app runtime.

## Helper 1.0.1 — 2026-11-03

- Added a hidden prompt for a GitHub token and HTTPS askpass authentication so report pushes do not require PythonAnywhere SSH-key setup. Tokens stay out of the Git remote URL and report.
- Added a test confirming the GitHub token is not passed in Git command arguments or embedded in the askpass script.

## Helper 1.0.0 — 2026-11-03

- Added a one-command staging helper to clone/update the session branch, install the Python dependencies, back up and write the WSGI entry point, reload the existing PythonAnywhere web app, and run the gated live smoke tests.
- Added secret-safe JSON reporting, a commit/push to `arena/e868e86a-new`, and a branch readback verification.
- Kept deployment explicitly gated: the expected root response remains HTTP 503 and this is not a production scraper replacement.
- Documented a bootstrap command that works even when `~/new` does not yet exist.
- Added unit coverage for the helper's live-response parsing and staging acceptance checks.
