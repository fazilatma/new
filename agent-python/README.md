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

## Agent tools API

The foundation now includes workspace and terminal endpoints:

- `GET /api/workspace/files?path=.`
- `GET /api/workspace/file?path=README.md`
- `PUT /api/workspace/file` with `{ "path": "file.txt", "content": "..." }`
- `POST /api/terminal/exec` with `{ "command": "pytest", "cwd": ".", "timeout": 60 }`

All paths are confined to `AGENT_WORKSPACE` (the current project directory by default). For production, run terminal jobs inside a Docker container and put these endpoints behind authentication.

## Versioning

Current release: `0.3.0`.

- Version file: `VERSION`
- API version endpoint: `/api/version`
- FastAPI OpenAPI version is set from the same application version.
- Every release should update `VERSION`, `APP_VERSION`, the changelog, and create a Git tag such as `v0.3.0`.
