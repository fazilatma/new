# Python Agent foundation

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8787
```

Provider/model CRUD and JSON import/export are available under `/api/providers`.
API keys are intentionally not hardcoded; use environment variables from `.env`/Docker secrets.

## WebConsole installation

In the PHP WebConsole, add this repository as a Python project with subfolder `agent-python`:

```text
Install: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
Start:   .venv/bin/python main.py
Port:    8787
Host:    0.0.0.0
```

The WebConsole can start/stop it as a daemon and expose the port through its project panel.
