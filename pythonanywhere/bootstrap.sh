#!/usr/bin/env bash
# PythonAnywhere: curl -fsSL <this-file-url> | bash
# No sudo. Only this application's files are installed.
set -euo pipefail
umask 077

REPOSITORY="fazilatma/new"
SOURCE_REF="arena/f3d5d2a0-new"
APP_DIR="${S4_INSTALL_DIR:-$HOME/scraper4-python/pythonanywhere}"
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

for tool in curl mktemp cp flock; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Required command not found: $tool" >&2; exit 1; }
done

# Require an absolute, non-root application directory to avoid accidental copies.
case "$APP_DIR" in
  /*) ;;
  *) echo "S4_INSTALL_DIR must be an absolute path." >&2; exit 1 ;;
esac
if [[ "$APP_DIR" == / || "$APP_DIR" == "$HOME" || -L "$APP_DIR" ]]; then
  echo "Choose a dedicated, non-symlink application directory." >&2
  exit 1
fi
if [[ -d "$APP_DIR" ]] && [[ -n "$(ls -A "$APP_DIR")" ]] && [[ ! -f "$APP_DIR/wsgi.py" || ! -f "$APP_DIR/install.sh" ]]; then
  echo "Refusing to overwrite an unrelated directory: $APP_DIR" >&2
  exit 1
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT
ARCHIVE="$TEMP_DIR/source.tar.gz"
VERSION_FILE="$TEMP_DIR/commit.json"
curl --fail --show-error --silent --location --retry 3 --connect-timeout 20 --max-time 60 \
  "https://api.github.com/repos/$REPOSITORY/commits/arena%2Ff3d5d2a0-new" -o "$VERSION_FILE"
COMMIT="$("$PYTHON_BIN" - "$VERSION_FILE" <<'PYVERSION'
import json, re, sys
sha = json.load(open(sys.argv[1]))['sha']
if not re.fullmatch(r'[0-9a-f]{40}', sha):
    raise SystemExit('Invalid release commit')
print(sha)
PYVERSION
)"
STAGE="$TEMP_DIR/app"
echo "Downloading the PythonAnywhere port from $REPOSITORY ($SOURCE_REF)..."
curl --fail --show-error --silent --location --retry 3 --connect-timeout 20 --max-time 300 \
  "https://codeload.github.com/$REPOSITORY/tar.gz/$COMMIT" -o "$ARCHIVE"

# Extract only regular files below pythonanywhere/, never runtime data or links.
"$PYTHON_BIN" - "$ARCHIVE" "$STAGE" <<'PY'
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive, target = sys.argv[1], Path(sys.argv[2])
target.mkdir(parents=True)
excluded = {'.env', '.venv', 'data', 'logs', '__pycache__', '.pytest_cache', 'pythonanywhere_wsgi.py', '.release.json', '.maintenance.json', '.runtime.json'}
with tarfile.open(archive, 'r:gz') as source:
    for entry in source:
        parts = PurePosixPath(entry.name).parts
        if len(parts) < 3 or parts[1] != 'pythonanywhere' or not entry.isfile():
            continue
        relative = parts[2:]
        if '..' in relative or excluded.intersection(relative) or entry.size > 16 * 1024 * 1024:
            continue
        path = target.joinpath(*relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        with source.extractfile(entry) as src, path.open('wb') as dst:
            shutil.copyfileobj(src, dst)
for required in ('install.sh', 'requirements.txt', 'repair_environment.py', 'wsgi.py', 'scraper4/__init__.py'):
    if not (target / required).is_file():
        raise SystemExit('Incomplete download: missing ' + required)
PY

# Preserve secrets/data. A pre-upgrade SQLite snapshot uses the old code/env.
if [[ -f "$APP_DIR/.env" ]]; then
  # Stdlib preflight works even when all virtualenv dependencies are gone.
  LOCK_PATH="$("$PYTHON_BIN" "$STAGE/repair_environment.py" lock-path "$APP_DIR")"
  mkdir -p "$(dirname "$LOCK_PATH")"
  exec 9>"$LOCK_PATH"
  if ! flock -n 9; then
    echo "A worker/update is active. No files changed; retry after it finishes." >&2
    exit 1
  fi
  mkdir -p "$HOME/scraper4-backups"
  BACKUP="$HOME/scraper4-backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite3"
  echo "Backing up existing data to $BACKUP"
  "$PYTHON_BIN" "$STAGE/repair_environment.py" backup "$APP_DIR" "$BACKUP"
fi

mkdir -p "$APP_DIR"
cp -R "$STAGE/." "$APP_DIR/"
echo "Installing in $APP_DIR"
PYTHON_BIN="$PYTHON_BIN" S4_VENV="$VENV" S4_AUTO_CONFIGURE="${S4_AUTO_CONFIGURE:-0}" bash "$APP_DIR/install.sh"
"$PYTHON_BIN" - "$APP_DIR" "$COMMIT" <<'PYRELEASE'
import json, sys
from pathlib import Path
(Path(sys.argv[1]) / '.release.json').write_text(json.dumps({'commit': sys.argv[2]}))
PYRELEASE

# Explicit owner-only stale-maintenance recovery after a full CLI installation.
# FD9 was acquired before copying any code and is inherited by this subprocess.
if [[ "${S4_RECOVER_MAINTENANCE:-0}" == 1 ]]; then
  if [[ -z "${LOCK_PATH:-}" ]]; then
    echo "Recovery requires an existing installation and its worker lock." >&2
    exit 1
  fi
  (cd "$APP_DIR" && "$VENV/bin/python" - <<'PYRECOVER'
import json
from scraper4.config import Settings
from scraper4.db import DB
from scraper4.services.owner_install import finish_recovery
cfg=Settings.load()
result=finish_recovery(DB(cfg.db_path,cfg.secret_key),cfg,lock_fd=9)
print(json.dumps(result))
PYRECOVER
  )
fi

# Reuse the encrypted on-server credential. No CLI token prompt or Task needed.
# Check the actual running build so a successful download cannot look like a
# successful deployment when Web still imports an old directory.
if [[ "${S4_RELOAD_AFTER_INSTALL:-1}" == 1 ]]; then
  (cd "$APP_DIR" && "$VENV/bin/python" -m scraper4 reload-web --if-configured)
fi
