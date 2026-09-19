#!/usr/bin/env bash
# setup_deployer4.sh — سوار کردن دیپلویِر مستقل چندبرنچی روی وب‌اپ PythonAnywhere
#
# اجرا داخل Bash Console حساب PythonAnywhere (پلن رایگان کافی است):
#   cd ~/scraper4
#   curl -fsSL https://raw.githubusercontent.com/fazilatma/amphp/arena/01a06ac3-amphp/setup_deployer4.sh -o setup_deployer4.sh
#   bash setup_deployer4.sh
#
# این اسکریپت چه می‌کند:
#   ۱) فایل deployer4.py را از بین چند برنچ گیت‌هاب می‌گیرد و جدیدترین نسخه را
#      کنار scraper4.py می‌نشاند (با .bak پشتیبان).
#   ۲) فایل WSGI را طوری وصله می‌کند که همان «یک وب‌اپ مجاز پلن رایگان» هم سایت
#      اصلی (/) و هم صفحه دیپلویِر (/deployer/) را سرو کند.
#   ۳) وب‌اپ را reload می‌کند و سلامت هر دو آدرس را چک می‌کند.
#
# بعد از نصب، در نوار آدرس مرورگر بزنید:
#   https://Fazilatma.pythonanywhere.com/deployer/
# رمز ورود: همان رمز SCRAPER_DEPLOY_PASSWORD است (اسکریپت آخرش نشان می‌دهد).
set -Eeuo pipefail
umask 077

EXPECTED_USER="Fazilatma"
USER_NAME="$(id -un)"
USER_LOWER="$(printf '%s' "$USER_NAME" | tr '[:upper:]' '[:lower:]')"
HOME_DIR="$HOME"
DOMAIN="${USER_LOWER}.pythonanywhere.com"
DISPLAY_DOMAIN="Fazilatma.pythonanywhere.com"
APP_DIR="$HOME_DIR/scraper4"
APP_FILE="$APP_DIR/deployer4.py"
TARGET_FILE="$APP_DIR/scraper4.py"
TOKEN_FILE="$HOME_DIR/.pythonanywhere_api_token"
VENV_DIR="$APP_DIR/venv"
REPO="fazilatma/amphp"
DEFAULT_BRANCHES="arena/01a06ac3-amphp arena/01a0640f-amphp"
if [ -n "${BRANCHES:-}" ]; then
  CANDIDATE_BRANCHES="$BRANCHES"
else
  CANDIDATE_BRANCHES="$DEFAULT_BRANCHES"
fi
API="https://www.pythonanywhere.com/api/v0/user/$USER_NAME"
AUTH=""; RESP=""; DOWN=""; TMP_CANDIDATES=""

cleanup(){ [ -z "${AUTH:-}" ]||rm -f "$AUTH"; [ -z "${RESP:-}" ]||rm -f "$RESP"; [ -z "${DOWN:-}" ]||rm -f "$DOWN"; [ -z "${TMP_CANDIDATES:-}" ]||rm -rf "$TMP_CANDIDATES"; }
trap cleanup EXIT
fail(){ echo "ERROR: $*" >&2; exit 1; }
api_call(){ local method="$1" url="$2"; shift 2; curl --config "$AUTH" --silent --show-error --output "$RESP" --write-out '%{http_code}' --request "$method" --connect-timeout 20 --max-time 120 "$@" "$url"; }

[ "$USER_NAME" = "$EXPECTED_USER" ]||fail "Run this in the $EXPECTED_USER account; current user is $USER_NAME."
[ -d "$HOME_DIR" ]&&[ -w "$HOME_DIR" ]||fail "Home is not writable: $HOME_DIR"
[ -s "$TOKEN_FILE" ]||fail "Token file is missing or empty: $TOKEN_FILE (create one in Account -> API token)"
chmod 600 "$TOKEN_FILE"
TOKEN="$(tr -d '[:space:]' <"$TOKEN_FILE")"
[[ "$TOKEN" =~ ^[A-Za-z0-9._-]+$ ]]||fail "Token file contains invalid characters."
mkdir -p "$APP_DIR"; chmod 700 "$APP_DIR"
SYSTEM_PY="$(command -v python3||true)"; [ -n "$SYSTEM_PY" ]||fail "python3 not found."
if [ -x "$VENV_DIR/bin/python" ]; then VENV_PY="$VENV_DIR/bin/python"; else VENV_PY="$SYSTEM_PY"; fi
AUTH="$APP_DIR/.dep-auth-$$"; RESP="$APP_DIR/.dep-response-$$"
printf 'header = "Authorization: Token %s"\n' "$TOKEN" >"$AUTH"; chmod 600 "$AUTH"; unset TOKEN

echo "Testing API authentication..."
STATUS="$(api_call GET "$API/webapps/")"; [ "$STATUS" = 200 ]||{ cat "$RESP"||true; fail "API authentication failed: HTTP $STATUS"; }

echo "Downloading Deployer4 (candidates: $CANDIDATE_BRANCHES)..."
DOWN="$APP_DIR/.deployer-download-$$.py"
BEST_FILE=""; BEST_VERSION=""; BEST_BRANCH=""
TMP_CANDIDATES="$APP_DIR/.dep-candidates-$$"
mkdir -p "$TMP_CANDIDATES"
for CANDIDATE in $CANDIDATE_BRANCHES; do
  case "$CANDIDATE" in
    *".."*|"") echo "Skipping invalid branch name: $CANDIDATE"; continue;;
  esac
  case "$CANDIDATE" in
    *[!A-Za-z0-9._/-]*) echo "Skipping invalid branch name: $CANDIDATE"; continue;;
  esac
  CAND_URL="https://raw.githubusercontent.com/$REPO/$CANDIDATE/deployer4.py"
  CAND_FILE="$TMP_CANDIDATES/$(printf '%s' "$CANDIDATE" | tr '/.' '__').py"
  echo "Trying branch: $CANDIDATE"
  if ! curl -fsSL --retry 2 --connect-timeout 20 --max-time 120 "$CAND_URL" -o "$CAND_FILE"; then
    echo "Download failed for branch $CANDIDATE; skipping."
    rm -f "$CAND_FILE"
    continue
  fi
  CAND_VERSION="$("$SYSTEM_PY" "$CAND_FILE" <<'PYEOF'
import ast, pathlib, re, sys
try:
    text = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    missing = [x for x in ("DEPLOYER_VERSION", "Flask(", "/api/check", "/api/update") if x not in text]
    if missing:
        raise SystemExit("MISSING:" + ",".join(missing))
    ast.parse(text, filename=sys.argv[1])
    m = re.search(r'^DEPLOYER_VERSION\s*=\s*["\']([^"\']+)', text, re.M)
    print((m.group(1).strip() if m else "unknown"))
except Exception as exc:
    print("INVALID:" + str(exc)[:160])
PYEOF
)"
  CAND_VERSION="$(printf '%s' "$CAND_VERSION" | tail -n1)"
  case "$CAND_VERSION" in
    INVALID*|MISSING*|"") echo "Validation failed for $CANDIDATE ($CAND_VERSION); skipping."; rm -f "$CAND_FILE"; continue;;
  esac
  echo "Branch $CANDIDATE carries deployer version $CAND_VERSION"
  if [ -z "$BEST_FILE" ]; then BEST_FILE="$CAND_FILE"; BEST_VERSION="$CAND_VERSION"; BEST_BRANCH="$CANDIDATE"
  else
    HIGHER="$("$SYSTEM_PY" "$BEST_VERSION" "$CAND_VERSION" <<'PYEOF'
import re, sys
def tup(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or "")[:4]) or (0,)
a, b = tup(sys.argv[1]), tup(sys.argv[2])
print("yes" if b > a else "no")
PYEOF
)"
    if [ "$HIGHER" = "yes" ]; then BEST_FILE="$CAND_FILE"; BEST_VERSION="$CAND_VERSION"; BEST_BRANCH="$CANDIDATE"; fi
  fi
done
[ -n "$BEST_FILE" ]||fail "No candidate branch produced a valid deployer4.py (tried: $CANDIDATE_BRANCHES)."
echo "Selected branch $BEST_BRANCH with newest deployer version $BEST_VERSION"
cp -p "$BEST_FILE" "$DOWN"
rm -rf "$TMP_CANDIDATES"; TMP_CANDIDATES=""
"$VENV_PY" -m py_compile "$DOWN" || fail "Downloaded deployer4.py did not compile."
[ ! -f "$APP_FILE" ]||cp -p "$APP_FILE" "$APP_FILE.$(date +%Y%m%d-%H%M%S).bak"
mv "$DOWN" "$APP_FILE"; DOWN=""; chmod 600 "$APP_FILE"
echo "Installed Deployer4 $BEST_VERSION from $BEST_BRANCH -> $APP_FILE"

find_wsgi(){ local f; for f in "/var/www/${USER_LOWER}_pythonanywhere_com_wsgi.py" "/var/www/${USER_NAME}_pythonanywhere_com_wsgi.py"; do [ ! -f "$f" ]||{ printf '%s' "$f"; return; }; done; find /var/www -maxdepth 1 -type f -name '*_pythonanywhere_com_wsgi.py' -writable -print 2>/dev/null|head -n1; }
WSGI=""
for n in $(seq 1 30); do WSGI="$(find_wsgi||true)"; [ -z "$WSGI" ]||break; echo "Waiting for WSGI ($n/30)..."; sleep 2; done
[ -n "$WSGI" ]&&[ -w "$WSGI" ]||fail "No writable WSGI file found in /var/www."

EXISTING_PASS="$("$SYSTEM_PY" "$WSGI" <<'PYEOF'
import re, sys
try:
    t = open(sys.argv[1], encoding="utf-8").read()
except OSError:
    print(""); raise SystemExit
m = re.findall(r"(?:SCRAPER_DEPLOY_PASSWORD|DEPLOYER_PASSWORD)['\"]\s*(?:\]\s*=\s*|\,\s*)r?['\"]([^'\"]+)", t)
print(m[-1] if m else "")
PYEOF
)"
GENERATED=0
if [ -z "$EXISTING_PASS" ]; then
  EXISTING_PASS="$("$SYSTEM_PY" -c 'import secrets;print(secrets.token_urlsafe(32))')"
  GENERATED=1
  echo "No existing deploy password found; generated a new one."
else
  echo "Reusing the existing deploy password from your WSGI file."
fi
[ -n "$EXISTING_PASS" ]||fail "Could not determine deploy password."

cp -p "$WSGI" "$APP_DIR/wsgi-$(date +%Y%m%d-%H%M%S).bak"
export S4_WSGI="$WSGI" S4_APP_DIR="$APP_DIR" S4_DEPLOYER_PASSWORD="$EXISTING_PASS" S4_BRANCHES="$CANDIDATE_BRANCHES"
"$SYSTEM_PY" - <<'PYEOF'
import os, pathlib, py_compile, re
wsgi = pathlib.Path(os.environ["S4_WSGI"])
app_dir = os.environ["S4_APP_DIR"]
password = os.environ["S4_DEPLOYER_PASSWORD"]
branches = os.environ.get("S4_BRANCHES", "arena/01a06ac3-amphp arena/01a0640f-amphp")
text = wsgi.read_text(encoding="utf-8")
text = re.sub(r"# >>> deployer4 dispatch >>>.*?# <<< deployer4 dispatch <<<\n*", "", text, flags=re.S)
text = text.rstrip("\n") + "\n"
if "DispatcherMiddleware" in text:
    raise SystemExit("WSGI already uses DispatcherMiddleware; patch it manually.")
old_import = "from scraper4 import app as application"
if old_import not in text:
    raise SystemExit("Expected WSGI line not found: 'from scraper4 import app as application'. Is the main installer finished?")
anchor = old_import
lines = [
    "# >>> deployer4 dispatch >>>",
    "# Deployer4 mount (added by setup_deployer4.sh; safe to re-run the script).",
    "# Serves the main site at / and the independent deployer at /deployer.",
    "import os as _os_deployer4",
    "_os_deployer4.environ.setdefault('DEPLOYER_PASSWORD', " + repr(password) + ")",
    "_os_deployer4.environ.setdefault('DEPLOYER_REPO', 'fazilatma/amphp')",
    "_os_deployer4.environ.setdefault('DEPLOYER_BRANCHES', " + repr(branches) + ")",
    "_os_deployer4.environ.setdefault('DEPLOYER_PATH', 'scraper4.py')",
    "_os_deployer4.environ.setdefault('DEPLOYER_TARGET', " + repr(app_dir + "/scraper4.py") + ")",
    "_os_deployer4.environ.setdefault('DEPLOYER_RELOAD_FILE', " + repr(str(wsgi)) + ")",
    "_os_deployer4.environ.setdefault('DEPLOYER_AUTO_UPDATE', '1')",
    "_os_deployer4.environ.setdefault('DEPLOYER_AUTO_INTERVAL', '300')",
    "from deployer4 import app as deployer_app",
    "from werkzeug.middleware.dispatcher import DispatcherMiddleware",
    "application = DispatcherMiddleware(application, {'/deployer': deployer_app})",
    "# <<< deployer4 dispatch <<<",
    "",
]
block_text = "\n".join(lines).rstrip("\n")
text = text.replace(anchor, anchor + "\n" + block_text, 1)
if not text.endswith("\n"):
    text += "\n"
wsgi.write_text(text, encoding="utf-8")
py_compile.compile(str(wsgi), doraise=True)
print("WSGI patched:", wsgi)
PYEOF
unset S4_WSGI S4_APP_DIR S4_DEPLOYER_PASSWORD S4_BRANCHES

echo "Reloading web app..."
RELOAD_OK=0
for n in 1 2 3; do
  STATUS="$(api_call POST "$API/webapps/$DOMAIN/reload/")"
  if [ "$STATUS" = 200 ]||[ "$STATUS" = 201 ]; then RELOAD_OK=1; break; fi
  echo "Reload API attempt $n/3 returned HTTP $STATUS."
  sleep 5
done
[ "$RELOAD_OK" = 1 ]||{ cat "$RESP"||true; fail "Reload API failed."; }
rm -f "$AUTH" "$RESP"; AUTH=""; RESP=""

echo "Waiting for the deployer page..."
LIVE=000
for n in $(seq 1 18); do sleep 5; LIVE="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 15 --max-time 30 "https://$DOMAIN/deployer/health"||true)"; [ "$LIVE" != 200 ]||break; echo "Deployer health $n/18: HTTP $LIVE"; done

echo "============================================================"
echo "DEPLOYER INSTALLATION FINISHED"
echo "Main site : https://$DISPLAY_DOMAIN/"
echo "Deployer  : https://$DISPLAY_DOMAIN/deployer/"
echo "Deployer version installed: $BEST_VERSION (branch $BEST_BRANCH)"
if [ "$GENERATED" = 1 ]; then
  echo "Deployer password (NEW - save it): $EXISTING_PASS"
else
  echo "Deployer password: same as your main app deploy password."
fi
echo "WSGI      : $WSGI (backup kept in $APP_DIR)"
echo "Live deployer health: HTTP $LIVE"
echo "------------------------------------------------------------"
echo "در نوار آدرس مرورگر بزنید:"
echo "  https://$DISPLAY_DOMAIN/deployer/"
echo "و همین رمز بالا را وارد کنید."
echo "============================================================"
[ "$LIVE" = 200 ]||fail "Deployer health check failed; open https://$DISPLAY_DOMAIN/deployer/ and inspect the error log."
unset EXISTING_PASS
