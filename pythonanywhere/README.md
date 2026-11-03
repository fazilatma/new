# scraper4 Python migration

This directory begins the feature-equivalent Python port of the latest `arena/01a0ebf7-new` source (v10.599). It targets PythonAnywhere's WSGI model, but it is **not yet a usable replacement**: most of the PHP application remains unported.

Read [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md) and the generated source inventory before changing scope. The executable WSGI scaffold is deliberately gated: `/` returns HTTP 503 and unported routes return HTTP 501. This avoids silently pretending that a partial translation supports existing store operations.

## Local checks for the translated compatibility slice

From the repository root:

```bash
PYTHONPATH=pythonanywhere python -m unittest discover -s pythonanywhere/tests -v
```

The test suite includes the WSGI gate and currently has 20 passing tests.

## One-command PythonAnywhere staging helper

For a staging smoke test only, bootstrap the standard-library helper from the chat branch; it clones/updates `~/new`, installs the Python requirements, backs up and writes the WSGI file, calls the PythonAnywhere reload API, tests the live endpoints, writes a redacted JSON report, pushes that report to `arena/e868e86a-new`, then reads it back from the branch and prints it:

```bash
mkdir -p ~/pa-bootstrap
curl -fsSL https://raw.githubusercontent.com/Fazilatma/new/arena/e868e86a-new/pythonanywhere/pa_helper.py -o ~/pa-bootstrap/pa_helper.py
env -u GITHUB_TOKEN -u PA_API_TOKEN python3 ~/pa-bootstrap/pa_helper.py --allow-incomplete-staging
```

The only token normally required is a GitHub token; the helper prompts for it with hidden input when `GITHUB_TOKEN` is unset. Use a fine-grained token with contents write access to this repository. The token is used only for the HTTPS report push via Git's askpass hook and is neither written to the report nor embedded in the remote URL. A PythonAnywhere API token is optional: if `PA_API_TOKEN` is unset, the helper asks you to manually press **Web → Reload** and then press Enter in the console. You do not need to copy terminal output—the redacted report is pushed to `arena/e868e86a-new`, read back by the helper, and can be retrieved from that branch. Override `--repo-dir`, `--venv-dir`, `--wsgi-file`, `--username`, `--domain`, or `--live-host` if PythonAnywhere's Web tab shows different paths/settings. The PythonAnywhere Web app must already exist and use the same Python minor version (3.10 or newer) as the `python3` command used to run the helper.

### Recover disk space safely

Do not delete the whole home directory or checkout. To clear only the disposable pip download cache and Python bytecode caches without saving the helper file or entering tokens, run:

```bash
curl -fsSL https://raw.githubusercontent.com/Fazilatma/new/arena/e868e86a-new/pythonanywhere/pa_helper.py | python3 - --cleanup-only
```

If you explicitly want to remove the helper's selected virtualenv too (default `~/.virtualenvs/scraper4-pa`), use `--cleanup-only --remove-venv`; it asks you to type `DELETE` first. This removes that virtualenv, so the next install will recreate it. Or add `--cleanup-before-install` to the normal staging command to clear disposable caches first. These cleanup modes preserve the checkout, application data, reports, and WSGI backups.

Expected smoke result for this scaffold: `/api/port-status` is HTTP 200 and `/` is HTTP 503. The root 503 is deliberate. **Do not route shop traffic to it.** When full parity is reached, the release must also include persistent database/media storage, JSON-state import/rollback, and tested worker scheduling, lane locks, restart/resume, credentials, and all external integrations.
