#!/usr/bin/env bash
# Run in a PythonAnywhere Bash console. Does not overwrite a hosted WSGI file.
set -euo pipefail
umask 077
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3.11}"
VENV="${S4_VENV:-$HOME/.virtualenvs/scraper4}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3.11+ is required. Set PYTHON_BIN to a Python version available on your account." >&2
  exit 1
fi
"$PYTHON_BIN" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required"'
mkdir -p "$(dirname "$VENV")"
if [[ ! -x "$VENV/bin/python" ]]; then "$PYTHON_BIN" -m venv "$VENV"; fi
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$APP_DIR/requirements.txt"
cd "$APP_DIR"
"$VENV/bin/python" - <<'PY'
from pathlib import Path
import secrets
from scraper4.config import load_env_file
from werkzeug.security import generate_password_hash
p = Path('.env')
if not p.exists():
    p.write_text(Path('.env.example').read_text(encoding='utf-8'), encoding='utf-8')
values = load_env_file(p)
import os
additions = []
if not os.environ.get('S4_SECRET_KEY'):
    additions.append('S4_SECRET_KEY=' + secrets.token_urlsafe(48))
if not os.environ.get('S4_PASSWORD'):
    password = secrets.token_urlsafe(20)
    additions.append('S4_PASSWORD=' + generate_password_hash(password))
    # Print once to the private terminal, never to a tracked file or URL.
    print('\nPanel password (save it now): ' + password + '\n')
if additions:
    with p.open('a', encoding='utf-8') as handle:
        handle.write('\n' + '\n'.join(additions) + '\n')
p.chmod(0o600)
PY
"$VENV/bin/python" -m scraper4 init
"$VENV/bin/python" -m scraper4 selftest
APP_DIR="$APP_DIR" "$VENV/bin/python" - <<'PY'
from pathlib import Path
import os
base = Path(os.environ['APP_DIR'])
path = base / 'pythonanywhere_wsgi.py'
path.write_text('import sys\nfrom pathlib import Path\nAPP_DIR = ' + repr(str(base)) + '\nif APP_DIR not in sys.path:\n    sys.path.insert(0, APP_DIR)\nfrom scraper4 import create_app\napplication = create_app()\n', encoding='utf-8')
print('\nGenerated WSGI configuration:', path)
PY
if [[ "${S4_AUTO_CONFIGURE:-0}" != 1 ]]; then
printf '\nNEXT: PythonAnywhere → Web → Add a new web app → Manual configuration.\n'
printf 'Select the same Python version as your virtualenv.\nVirtualenv: %s\nSource code / working directory: %s\n' "$VENV" "$APP_DIR"
printf 'Replace the contents of the Web-tab WSGI configuration with this file:\n  %s/pythonanywhere_wsgi.py\nThen press Reload.\n' "$APP_DIR"
printf '\nRun the queue in Bash or a Scheduled Task:\n  cd %q && %q -m scraper4 tick --budget 240\n' "$APP_DIR" "$VENV/bin/python"
printf '\nDo not run flask/serve or Node as a public server on PythonAnywhere.\n'

fi

# On-platform bootstrap opts into automatic API provisioning. No token in URLs.
if [[ "${S4_AUTO_CONFIGURE:-0}" == 1 ]]; then
  "$VENV/bin/python" -m scraper4 configure
  printf '\nWeb/WSGI, reload and recurring maintenance task configured through the API.\n'
fi
