#!/usr/bin/env bash
# Run in a PythonAnywhere Bash console. Does not overwrite a hosted WSGI file.
set -euo pipefail
umask 077
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# BEGIN PYTHON DETECTION (kept identical in bootstrap.sh and install.sh)
VENV="${S4_VENV:-$HOME/.virtualenvs/scraper4}"
PYTHON_BIN="${PYTHON_BIN:-}"
s4_python_ok() {
  command -v "$1" >/dev/null 2>&1 &&
    "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' >/dev/null 2>&1
}
if [[ -n "$PYTHON_BIN" ]]; then
  if ! s4_python_ok "$PYTHON_BIN"; then
    echo "Selected interpreter '$PYTHON_BIN' is missing or older than Python 3.10." >&2
    echo "Unset PYTHON_BIN to auto-detect, or select an installed Python 3.10+ interpreter." >&2
    exit 1
  fi
elif [[ ! -x "$VENV/bin/python" && -f "$APP_DIR/.runtime.json" ]]; then
  # Read JSON using any available Python, then select the recorded Web ABI.
  reader=""
  for candidate in python3 python3.14 python3.13 python3.12 python3.11 python3.10 python; do
    if command -v "$candidate" >/dev/null 2>&1; then reader="$candidate"; break; fi
  done
  [[ -n "$reader" ]] || { echo "No Python available to inspect .runtime.json" >&2; exit 1; }
  recorded="$("$reader" - "$APP_DIR/.runtime.json" <<'PYABI'
import json,re,sys
v=json.load(open(sys.argv[1])).get('python_version','')
if not isinstance(v,str) or not re.fullmatch(r'3\.\d{1,2}',v):raise SystemExit('Invalid recorded Python version; inspect .runtime.json')
print(v)
PYABI
)"
  PYTHON_BIN="python$recorded"
  if ! s4_python_ok "$PYTHON_BIN"; then
    echo "Deleted virtualenv used Python $recorded, but $PYTHON_BIN is unavailable. Select the matching system image/interpreter; no data changed." >&2
    exit 1
  fi
elif s4_python_ok "$VENV/bin/python"; then
  PYTHON_BIN="$VENV/bin/python"
else
  for candidate in python3 python3.14 python3.13 python3.12 python3.11 python3.10 python; do
    if s4_python_ok "$candidate"; then
      PYTHON_BIN="$candidate"
      break
    fi
  done
fi
if [[ -z "$PYTHON_BIN" ]]; then
  echo "No usable Python 3.10+ interpreter was found on this account." >&2
  echo "Available Python commands:" >&2
  for candidate in python3 python3.14 python3.13 python3.12 python3.11 python3.10 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
      "$candidate" --version >&2 || true
    fi
  done
  echo "Use a PythonAnywhere system image with Python 3.10+, then rerun this helper." >&2
  exit 1
fi
if [[ -x "$VENV/bin/python" ]]; then
  if ! s4_python_ok "$VENV/bin/python"; then
    echo "Existing virtualenv is older than Python 3.10: $VENV" >&2
    echo "Choose a different environment with S4_VENV; existing environments are not deleted." >&2
    exit 1
  fi
  selected_version="$("$PYTHON_BIN" -c 'import sys; print("%s.%s" % sys.version_info[:2])')"
  existing_version="$("$VENV/bin/python" -c 'import sys; print("%s.%s" % sys.version_info[:2])')"
  if [[ "$selected_version" != "$existing_version" ]]; then
    echo "Selected Python $selected_version differs from existing virtualenv Python $existing_version." >&2
    echo "Unset PYTHON_BIN to reuse it, or set S4_VENV to a new path." >&2
    exit 1
  fi
fi
printf 'Using Python: %s (%s)\n' "$PYTHON_BIN" "$("$PYTHON_BIN" -c 'import platform; print(platform.python_version())')"
# END PYTHON DETECTION
mkdir -p "$(dirname "$VENV")"
if [[ ! -x "$VENV/bin/python" ]]; then "$PYTHON_BIN" -m venv "$VENV"; fi
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install -r "$APP_DIR/requirements.txt"
cd "$APP_DIR"
"$VENV/bin/python" - <<'PY'
from pathlib import Path
import os
import secrets
from scraper4.config import load_env_file
from werkzeug.security import generate_password_hash
p = Path('.env')
if not p.exists():
    p.write_text(Path('.env.example').read_text(encoding='utf-8'), encoding='utf-8')
requested_access = os.environ.get('S4_ACCESS_MODE')
if requested_access is not None and requested_access not in ('password','open'):
    raise SystemExit('S4_ACCESS_MODE must be password or open')
values = load_env_file(p)
import os
additions = []
if requested_access is not None and values.get('S4_ACCESS_MODE')!=requested_access:
    additions.append('S4_ACCESS_MODE='+requested_access)
if not os.environ.get('S4_SECRET_KEY'):
    additions.append('S4_SECRET_KEY=' + secrets.token_urlsafe(48))
if os.environ.get('S4_ACCESS_MODE','password')!='open' and not os.environ.get('S4_PASSWORD'):
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
import sys
import json
base = Path(os.environ['APP_DIR'])
runtime = base / '.runtime.json'
runtime.write_text(json.dumps({'python': str(Path(sys.executable).absolute()), 'python_version': '%s.%s' % sys.version_info[:2]}), encoding='utf-8')
runtime.chmod(0o600)
path = base / 'pythonanywhere_wsgi.py'
path.write_text('import sys\nfrom pathlib import Path\nAPP_DIR = ' + repr(str(base)) + '\nif APP_DIR not in sys.path:\n    sys.path.insert(0, APP_DIR)\nfrom scraper4 import create_app\napplication = create_app()\n', encoding='utf-8')
print('\nGenerated WSGI configuration:', path)
PY
if [[ "${S4_AUTO_CONFIGURE:-0}" != 1 ]]; then
printf '\nInstalled without requesting a PythonAnywhere API token.\n'
printf 'After opening the panel, enter it under PythonAnywhere connection settings.\n'
printf '\nFIRST INSTALL ONLY: PythonAnywhere → Web → Add a new web app → Manual configuration.\n'
printf 'Select the same Python version as your virtualenv.\nVirtualenv: %s\nSource code / working directory: %s\n' "$VENV" "$APP_DIR"
printf 'Replace the contents of the Web-tab WSGI configuration with this file:\n  %s/pythonanywhere_wsgi.py\nFor an existing app, keep its WSGI configuration; bootstrap will try Reload using the saved API token.\nWithout a saved API token, press Reload manually.\n' "$APP_DIR"
printf '\nRun the queue in Bash or a Scheduled Task:\n  cd %q && %q -m scraper4 tick --budget 240\n' "$APP_DIR" "$VENV/bin/python"
printf '\nDo not run flask/serve or Node as a public server on PythonAnywhere.\n'

fi

# API provisioning in the terminal is now explicit opt-in only. No token in URLs.
if [[ "${S4_AUTO_CONFIGURE:-0}" == 1 ]]; then
  "$VENV/bin/python" -m scraper4 configure
  printf '\nWeb/WSGI, reload and recurring maintenance task configured through the API.\n'
fi
