#!/usr/bin/env bash
# PythonAnywhere: curl -fsSL <this-file-url> | bash
# No sudo. Only this application's files are installed.
set -euo pipefail
umask 077

REPOSITORY="fazilatma/new"
SOURCE_REF="arena/f3d5d2a0-new"
APP_DIR="${S4_INSTALL_DIR:-$HOME/scraper4-python/pythonanywhere}"
PYTHON_BIN="${PYTHON_BIN:-python3.11}"
VENV="${S4_VENV:-$HOME/.virtualenvs/scraper4}"

for tool in curl mktemp cp; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Required command not found: $tool" >&2; exit 1; }
done
command -v "$PYTHON_BIN" >/dev/null 2>&1 || {
  echo "Python 3.11+ is required. Try: curl ... | PYTHON_BIN=python3.12 bash" >&2
  exit 1
}
"$PYTHON_BIN" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required"'

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
STAGE="$TEMP_DIR/app"
echo "Downloading the PythonAnywhere port from $REPOSITORY ($SOURCE_REF)..."
curl --fail --show-error --silent --location --retry 3 --connect-timeout 20 --max-time 300 \
  "https://codeload.github.com/$REPOSITORY/tar.gz/refs/heads/$SOURCE_REF" -o "$ARCHIVE"

# Extract only regular files below pythonanywhere/, never runtime data or links.
"$PYTHON_BIN" - "$ARCHIVE" "$STAGE" <<'PY'
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

archive, target = sys.argv[1], Path(sys.argv[2])
target.mkdir(parents=True)
excluded = {'.env', '.venv', 'data', 'logs', '__pycache__', '.pytest_cache', 'pythonanywhere_wsgi.py'}
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
for required in ('install.sh', 'requirements.txt', 'wsgi.py', 'scraper4/__init__.py'):
    if not (target / required).is_file():
        raise SystemExit('Incomplete download: missing ' + required)
PY

# Preserve secrets/data. A pre-upgrade SQLite snapshot uses the old code/env.
if [[ -f "$APP_DIR/.env" ]]; then
  if [[ ! -x "$VENV/bin/python" ]]; then
    echo "Existing .env detected but its virtualenv was not found: $VENV" >&2
    echo "Set S4_VENV to the existing environment before upgrading." >&2
    exit 1
  fi
  mkdir -p "$HOME/scraper4-backups"
  BACKUP="$HOME/scraper4-backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ)-$$.sqlite3"
  echo "Backing up existing data to $BACKUP"
  (cd "$APP_DIR" && "$VENV/bin/python" -m scraper4 backup --output "$BACKUP")
fi

mkdir -p "$APP_DIR"
cp -R "$STAGE/." "$APP_DIR/"
echo "Installing in $APP_DIR"
PYTHON_BIN="$PYTHON_BIN" S4_VENV="$VENV" bash "$APP_DIR/install.sh"
