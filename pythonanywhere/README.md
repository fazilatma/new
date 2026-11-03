# scraper4 Python migration

This directory begins the feature-equivalent Python port of the latest `arena/01a0ebf7-new` source (v10.599). It targets PythonAnywhere's WSGI model, but it is **not yet a usable replacement**: most of the PHP application remains unported.

Read [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md) and the generated source inventory before changing scope. The executable WSGI scaffold is deliberately gated: `/` returns HTTP 503 and unported routes return HTTP 501. This avoids silently pretending that a partial translation supports existing store operations.

## Local checks for the translated compatibility slice

From the repository root:

```bash
PYTHONPATH=pythonanywhere python -m unittest discover -s pythonanywhere/tests -v
```

The test suite includes the WSGI gate and currently has 14 passing tests.

## One-command PythonAnywhere staging helper

For a staging smoke test only, bootstrap the standard-library helper from the chat branch; it clones/updates `~/new`, installs the Python requirements, backs up and writes the WSGI file, calls the PythonAnywhere reload API, tests the live endpoints, writes a redacted JSON report, pushes that report to `arena/e868e86a-new`, then reads it back from the branch and prints it:

```bash
mkdir -p ~/pa-bootstrap
curl -fsSL https://raw.githubusercontent.com/Fazilatma/new/arena/e868e86a-new/pythonanywhere/pa_helper.py -o ~/pa-bootstrap/pa_helper.py
python3.11 ~/pa-bootstrap/pa_helper.py --allow-incomplete-staging
```

The helper prompts with hidden input for the PythonAnywhere API token and GitHub token when `PA_API_TOKEN` or `GITHUB_TOKEN` are not already set. The GitHub token is used only for the HTTPS push via Git's askpass hook; neither token is written to the report or embedded in the remote URL. Use a fine-grained GitHub token with contents write access to this repository. The report file path and commit are printed; the helper also verifies its readback from the branch. Override `--repo-dir`, `--venv-dir`, `--wsgi-file`, `--username`, `--domain`, or `--live-host` if PythonAnywhere's Web tab shows different paths/settings. The PythonAnywhere Web app must already exist and use Python 3.11.

Expected smoke result for this scaffold: `/api/port-status` is HTTP 200 and `/` is HTTP 503. The root 503 is deliberate. **Do not route shop traffic to it.** When full parity is reached, the release must also include persistent database/media storage, JSON-state import/rollback, and tested worker scheduling, lane locks, restart/resume, credentials, and all external integrations.
