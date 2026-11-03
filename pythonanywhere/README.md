# scraper4 Python migration

This directory begins the feature-equivalent Python port of the latest `arena/01a0ebf7-new` source (v10.599). It targets PythonAnywhere's WSGI model, but it is **not yet a usable replacement**: most of the PHP application remains unported.

Read [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md) and the generated source inventory before changing scope. The executable WSGI scaffold is deliberately gated: `/` returns HTTP 503 and unported routes return HTTP 501. This avoids silently pretending that a partial translation supports existing store operations.

## Local checks for the translated compatibility slice

From the repository root:

```bash
PYTHONPATH=pythonanywhere python -m unittest discover -s pythonanywhere/tests -v
```

The test suite includes the WSGI gate and currently has 14 passing tests.

## PythonAnywhere staging smoke test only

The supplied `install_and_smoke_test.sh` can install the gated WSGI scaffold solely to verify the PythonAnywhere domain and WSGI wiring. It refuses by default; explicit staging requires `PA_ALLOW_INCOMPLETE_STAGING=1`. After running the install command, click **Web → Reload**, then run the script's `--test-live` mode from the PythonAnywhere console. The smoke test expects `/api/port-status` to return 200 and `/` to return 503. That 503 is intentional, not a working scraper.

```bash
PA_ALLOW_INCOMPLETE_STAGING=1 bash pythonanywhere/install_and_smoke_test.sh --install-staging
# Click Web → Reload in PythonAnywhere, then:
bash pythonanywhere/install_and_smoke_test.sh --test-live
```

Do not route shop traffic to this scaffold. When full parity is reached, the final deployment will use a PythonAnywhere virtualenv and WSGI file, a persistent database/media location outside the code checkout, and PythonAnywhere-compatible scheduled/worker tasks. Before removing the gate, complete the existing-JSON import/rollback plan and test lane locks, restart/resume, credentials, and every external integration.
