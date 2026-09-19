#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

EXPECTED_USER="Fazilatma"
USER_NAME="$(id -un)"
USER_LOWER="$(printf '%s' "$USER_NAME" | tr '[:upper:]' '[:lower:]')"
HOME_DIR="$HOME"
DOMAIN="${USER_LOWER}.pythonanywhere.com"
APP_DIR="$HOME_DIR/scraper4"
APP_FILE="$APP_DIR/scraper4.py"
DATA_FILE="$APP_DIR/scraper4_data.json"
PASSWORD_FILE="$APP_DIR/admin_password.txt"
TOKEN_FILE="$HOME_DIR/.pythonanywhere_api_token"
VENV_DIR="$APP_DIR/venv"
REPO="fazilatma/amphp"
# Candidate branches for the installer. The branch carrying the newest
# APP_VERSION wins, so adding a branch here can never downgrade an install.
# Override with:  BRANCHES="branch-a branch-b"  ./install_pythonanywhere.sh
# A legacy single BRANCH env var is still honoured and prepended.
BRANCH="arena/01a0640f-amphp"
DEFAULT_BRANCHES="arena/01a06ac3-amphp arena/01a0640f-amphp"
if [ -n "${BRANCHES:-}" ]; then
  CANDIDATE_BRANCHES="$BRANCHES"
elif [ -n "${BRANCH:-}" ] && [ "$BRANCH" != "arena/01a0640f-amphp" ]; then
  CANDIDATE_BRANCHES="$BRANCH $DEFAULT_BRANCHES"
else
  CANDIDATE_BRANCHES="$DEFAULT_BRANCHES"
fi
API="https://www.pythonanywhere.com/api/v0/user/$USER_NAME"
AUTH=""; RESP=""; DOWN=""

cleanup(){ unset TOKEN ADMIN_PASSWORD APP_DIR_E DATA_FILE_E WSGI_FILE_E PASSWORD_E SITE_E 2>/dev/null||true; [ -z "${AUTH:-}" ]||rm -f "$AUTH"; [ -z "${RESP:-}" ]||rm -f "$RESP"; [ -z "${DOWN:-}" ]||rm -f "$DOWN"; }
trap cleanup EXIT
fail(){ echo "ERROR: $*" >&2; exit 1; }
api_call(){ local method="$1" url="$2"; shift 2; curl --config "$AUTH" --silent --show-error --output "$RESP" --write-out '%{http_code}' --request "$method" --connect-timeout 20 --max-time 120 "$@" "$url"; }

[ "$USER_NAME" = "$EXPECTED_USER" ]||fail "Run this in the $EXPECTED_USER account; current user is $USER_NAME."
[ -d "$HOME_DIR" ]&&[ -w "$HOME_DIR" ]||fail "Home is not writable: $HOME_DIR"
[ -s "$TOKEN_FILE" ]||fail "Token file is missing or empty: $TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
TOKEN="$(tr -d '[:space:]' <"$TOKEN_FILE")"
[[ "$TOKEN" =~ ^[A-Za-z0-9._-]+$ ]]||fail "Token file contains invalid characters."
mkdir -p "$APP_DIR"; chmod 700 "$APP_DIR"
SYSTEM_PY="$(command -v python3||true)"; [ -n "$SYSTEM_PY" ]||fail "python3 not found."
MAJOR="$($SYSTEM_PY -c 'import sys;print(sys.version_info.major)')"; MINOR="$($SYSTEM_PY -c 'import sys;print(sys.version_info.minor)' )"
PY_VERSION="python${MAJOR}${MINOR}"
AUTH="$APP_DIR/.pa-auth-$$"; RESP="$APP_DIR/.pa-response-$$"
printf 'header = "Authorization: Token %s"\n' "$TOKEN" >"$AUTH"; chmod 600 "$AUTH"; unset TOKEN

echo "Testing API authentication..."
STATUS="$(api_call GET "$API/webapps/")"; [ "$STATUS" = 200 ]||{ cat "$RESP"||true; fail "API authentication failed: HTTP $STATUS"; }

echo "Downloading Scraper4 (candidates: $CANDIDATE_BRANCHES)..."
DOWN="$APP_DIR/.download-$$.py"
BEST_FILE=""; BEST_VERSION=""; BEST_BRANCH=""
TMP_CANDIDATES="$APP_DIR/.candidates-$$"
mkdir -p "$TMP_CANDIDATES"
for CANDIDATE in $CANDIDATE_BRANCHES; do
  case "$CANDIDATE" in
    *".."*|"") echo "Skipping invalid branch name: $CANDIDATE"; continue;;
  esac
  case "$CANDIDATE" in
    *[!A-Za-z0-9._/-]*) echo "Skipping invalid branch name: $CANDIDATE"; continue;;
  esac
  CAND_URL="https://raw.githubusercontent.com/$REPO/$CANDIDATE/scraper4.py"
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
    missing = [x for x in ("APP_VERSION", "Flask(", "/api/scrape", "/api/deploy/run") if x not in text]
    if missing:
        raise SystemExit("MISSING:" + ",".join(missing))
    ast.parse(text, filename=sys.argv[1])
    m = re.search(r'^APP_VERSION\s*=\s*["\']([^"\']+)', text, re.M)
    print((m.group(1).strip() if m else "unknown"))
except Exception as exc:
    print("INVALID:" + str(exc)[:160])
PYEOF
)"
  CAND_VERSION="$(printf '%s' "$CAND_VERSION" | tail -n1)"
  case "$CAND_VERSION" in
    INVALID*|MISSING*|"") echo "Validation failed for $CANDIDATE ($CAND_VERSION); skipping."; rm -f "$CAND_FILE"; continue;;
  esac
  echo "Branch $CANDIDATE carries version $CAND_VERSION"
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
[ -n "$BEST_FILE" ]||fail "No candidate branch produced a valid scraper4.py (tried: $CANDIDATE_BRANCHES)."
echo "Selected branch $BEST_BRANCH with newest version $BEST_VERSION"
cp -p "$BEST_FILE" "$DOWN"
rm -rf "$TMP_CANDIDATES"
"$SYSTEM_PY" - "$DOWN" <<'PY'
import ast,pathlib,sys
p=pathlib.Path(sys.argv[1]); s=p.read_text(encoding="utf-8")
missing=[x for x in ("APP_VERSION","Flask(","/api/scrape","/api/deploy/run") if x not in s]
if missing: raise SystemExit("Invalid download; missing: "+",".join(missing))
ast.parse(s,filename=str(p)); print("Downloaded source syntax is valid.")
PY
[ ! -f "$APP_FILE" ]||cp -p "$APP_FILE" "$APP_FILE.$(date +%Y%m%d-%H%M%S).bak"
mv "$DOWN" "$APP_FILE"; DOWN=""; chmod 600 "$APP_FILE"
echo "Installed Scraper4 $BEST_VERSION from $BEST_BRANCH"

echo "Creating isolated virtual environment..."
if [ ! -x "$VENV_DIR/bin/python" ]; then "$SYSTEM_PY" -m venv "$VENV_DIR"; fi
VENV_PY="$VENV_DIR/bin/python"; VENV_PIP="$VENV_DIR/bin/pip"
# Free-plan quota: clear only disposable caches and install packages used by this app.
rm -rf "$HOME_DIR/.cache/pip" "$HOME_DIR/.cache/ms-playwright" "$APP_DIR/__pycache__"
PIP_NO_CACHE_DIR=1 "$VENV_PIP" install --no-cache-dir flask requests beautifulsoup4 lxml playwright basalam-sdk cloudscraper curl_cffi
BROWSER_PATH="$APP_DIR/ms-playwright"
export PLAYWRIGHT_BROWSERS_PATH="$BROWSER_PATH"
echo "Installing the smaller Chromium Headless Shell for Playwright..."
if ! "$VENV_PY" -m playwright install chromium-headless-shell; then
 echo "Home quota blocked the browser; retrying in /tmp outside the account quota..."
 BROWSER_PATH="/tmp/scraper4-${USER_NAME}-playwright"
 rm -rf "$BROWSER_PATH"; mkdir -p "$BROWSER_PATH"; chmod 700 "$BROWSER_PATH"
 export PLAYWRIGHT_BROWSERS_PATH="$BROWSER_PATH"
 if ! "$VENV_PY" -m playwright install chromium-headless-shell; then
  echo "WARNING: Browser download failed in both locations. Direct HTML extraction remains available; retry with the in-app lightweight installer."
 fi
fi
"$VENV_PY" -c 'import flask,requests,bs4,lxml,playwright,basalam_sdk,cloudscraper,curl_cffi; print("Required scraper dependencies OK")'
"$VENV_PY" -m py_compile "$APP_FILE"; rm -rf "$APP_DIR/__pycache__"
SITE_PACKAGES="$($VENV_PY -c 'import sysconfig;print(sysconfig.get_paths()["purelib"])')"

if [ -s "$PASSWORD_FILE" ]; then ADMIN_PASSWORD="$(tr -d '\r\n' <"$PASSWORD_FILE")"; else ADMIN_PASSWORD="$($VENV_PY -c 'import secrets;print(secrets.token_urlsafe(32))')"; printf '%s\n' "$ADMIN_PASSWORD" >"$PASSWORD_FILE"; chmod 600 "$PASSWORD_FILE"; fi
[ -n "$ADMIN_PASSWORD" ]||fail "Could not generate admin password."

echo "Checking web-app collection for $DOMAIN..."
STATUS="$(api_call GET "$API/webapps/")"
[ "$STATUS" = 200 ]||{ cat "$RESP"||true; fail "Could not list web apps: HTTP $STATUS"; }
DOMAIN_EXISTS="$($SYSTEM_PY - "$RESP" "$DOMAIN" <<'PY'
import json,sys
rows=json.load(open(sys.argv[1],encoding="utf-8")); wanted=sys.argv[2].lower()
print(1 if any(str(row.get("domain_name","")).lower()==wanted for row in rows if isinstance(row,dict)) else 0)
PY
)"
if [ "$DOMAIN_EXISTS" != 1 ]; then
 echo "No web app exists; creating the one allowed free-plan app..."
 STATUS="$(api_call POST "$API/webapps/" --data-urlencode "domain_name=$DOMAIN" --data-urlencode "python_version=$PY_VERSION")"
 [[ "$STATUS" = 200||"$STATUS" = 201 ]]||{ cat "$RESP"||true; fail "Web app creation failed: HTTP $STATUS"; }
else
 echo "Existing web app found."
fi

# Configure PythonAnywhere to use the isolated environment.
STATUS="$(api_call PATCH "$API/webapps/$DOMAIN/" --data-urlencode "virtualenv_path=$VENV_DIR")"
[[ "$STATUS" = 200||"$STATUS" = 201 ]]||{ cat "$RESP"||true; fail "Could not set virtualenv: HTTP $STATUS"; }

find_wsgi(){ local f; for f in "/var/www/${USER_LOWER}_pythonanywhere_com_wsgi.py" "/var/www/${USER_NAME}_pythonanywhere_com_wsgi.py"; do [ ! -f "$f" ]||{ printf '%s' "$f"; return; }; done; find /var/www -maxdepth 1 -type f -name '*_pythonanywhere_com_wsgi.py' -writable -print 2>/dev/null|head -n1; }
WSGI=""
for n in $(seq 1 30); do WSGI="$(find_wsgi||true)"; [ -z "$WSGI" ]||break; echo "Waiting for WSGI ($n/30)..."; sleep 2; done
[ -n "$WSGI" ]&&[ -w "$WSGI" ]||fail "No writable WSGI file found in /var/www."
echo "Using WSGI: $WSGI"

export APP_DIR_E="$APP_DIR" DATA_FILE_E="$DATA_FILE" WSGI_FILE_E="$WSGI" PASSWORD_E="$ADMIN_PASSWORD" SITE_E="$SITE_PACKAGES" BROWSER_PATH_E="$BROWSER_PATH" S4_BEST_BRANCH="$BEST_BRANCH" S4_BRANCHES="$CANDIDATE_BRANCHES"
"$VENV_PY" - <<'PY'
import datetime,json,os,pathlib,shutil
app=pathlib.Path(os.environ["APP_DIR_E"]); datafile=pathlib.Path(os.environ["DATA_FILE_E"]); wsgi=pathlib.Path(os.environ["WSGI_FILE_E"]); password=os.environ["PASSWORD_E"]; site=os.environ["SITE_E"]; browser_path=os.environ["BROWSER_PATH_E"]
shutil.copy2(wsgi,app/("wsgi-"+datetime.datetime.now().strftime("%Y%m%d-%H%M%S")+".bak"))
source="\n".join(("import os,site,sys","site.addsitedir("+repr(site)+")","APP_DIRECTORY="+repr(str(app)),"if APP_DIRECTORY not in sys.path: sys.path.insert(0,APP_DIRECTORY)","os.environ['SCRAPER_PASSWORD']=''","os.environ['SCRAPER_DEPLOY_PASSWORD']="+repr(password),"os.environ['SCRAPER_DATA_FILE']="+repr(str(datafile)),"os.environ['PLAYWRIGHT_BROWSERS_PATH']="+repr(browser_path),"os.environ['SCRAPER_PLAYWRIGHT_PATH']="+repr(browser_path),"from scraper4 import app as application",""))
tmp=app/".wsgi.tmp"; tmp.write_text(source,encoding="utf-8"); shutil.copyfile(tmp,wsgi); tmp.unlink()
data={}
if datafile.exists():
 try:
  x=json.loads(datafile.read_text(encoding="utf-8")); data=x if isinstance(x,dict) else {}
 except Exception: pass
data.setdefault("profiles",{}); data.setdefault("woocommerce",{"url":"","consumer_key":"","consumer_secret":""}); data.setdefault("network",{"timeout":25,"gap_ms":350,"proxy":"","verify_tls":True}); data.setdefault("last_result",[])
old=data.get("deploy") if isinstance(data.get("deploy"),dict) else {}
best=str(__import__("os").environ.get("S4_BEST_BRANCH","")).strip() or "arena/01a06ac3-amphp"
raw_branches=str(__import__("os").environ.get("S4_BRANCHES","")).replace(","," ").split()
_branches=[]
for _b in ([best]+raw_branches+[str(old.get("branch",""))]+(list(old.get("branches") or []) if isinstance(old.get("branches"),list) else [])):
 _b=str(_b or "").strip().strip("/")
 if _b and _b not in _branches and len(_b)<=150 and ".." not in _b:
  _branches.append(_b)
 if len(_branches)>=8: break
if not _branches: _branches=[best]
data["deploy"]={"repo":"fazilatma/amphp","branch":_branches[0],"branches":_branches,"path":"scraper4.py","github_token":old.get("github_token",""),"reload_file":str(wsgi),"check_on_load":bool(old.get("check_on_load",False))}
tmp=datafile.with_suffix(".json.tmp"); tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8"); tmp.replace(datafile)
PY
unset APP_DIR_E DATA_FILE_E WSGI_FILE_E PASSWORD_E SITE_E BROWSER_PATH_E S4_BEST_BRANCH S4_BRANCHES; chmod 600 "$DATA_FILE"

"$VENV_PY" - "$APP_DIR" <<'PY'
import pathlib,sys
sys.path.insert(0,str(pathlib.Path(sys.argv[1]).resolve())); import scraper4
routes={r.rule for r in scraper4.app.url_map.iter_rules()}; need={"/","/health","/api/scrape","/api/deploy/run"}
if need-routes: raise RuntimeError("Missing routes: "+", ".join(need-routes))
assert scraper4.app.test_client().get("/health").status_code==200
print("Local Flask test passed:",scraper4.APP_VERSION)
PY

echo "Enabling web app..."
ENABLE_STATUS="$(api_call POST "$API/webapps/$DOMAIN/enable/")"
if [ "$ENABLE_STATUS" != 200 ]&&[ "$ENABLE_STATUS" != 201 ]&&[ "$ENABLE_STATUS" != 409 ]; then
 echo "WARNING: Enable endpoint returned HTTP $ENABLE_STATUS."
 cat "$RESP"||true
fi

echo "Reloading web app..."
RELOAD_OK=0
for n in 1 2 3; do
 STATUS="$(api_call POST "$API/webapps/$DOMAIN/reload/")"
 if [ "$STATUS" = 200 ]||[ "$STATUS" = 201 ]; then RELOAD_OK=1; break; fi
 echo "Reload API attempt $n/3 returned HTTP $STATUS."
 sleep 5
done
if [ "$RELOAD_OK" != 1 ]; then
 echo "WARNING: Reload API failed; touching WSGI as fallback."
 cat "$RESP"||true
 touch "$WSGI"
fi
rm -f "$AUTH" "$RESP"; AUTH=""; RESP=""
LIVE=000
for n in $(seq 1 18); do sleep 5; LIVE="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 15 --max-time 30 "https://$DOMAIN/health"||true)"; [ "$LIVE" != 200 ]||break; echo "Health $n/18: HTTP $LIVE"; done

if [ "$LIVE" != 200 ]; then
 echo "Recent PythonAnywhere logs:"
 for log in "/var/log/${DOMAIN}.error.log" "/var/log/${DOMAIN}.server.log"; do
  if [ -r "$log" ]; then echo "===== $log ====="; tail -n 80 "$log"; fi
 done
fi

echo "============================================================"
echo "INSTALLATION FINISHED"
echo "Website: https://$DOMAIN"
echo "Login protection: disabled"
echo "Former password file (not used): $PASSWORD_FILE"
echo "Application: $APP_FILE"
echo "Virtualenv: $VENV_DIR"
echo "WSGI: $WSGI"
echo "Reload API success: $RELOAD_OK"
echo "Live health: HTTP $LIVE"
echo "============================================================"
[ "$LIVE" = 200 ]||fail "Live health check failed; inspect logs above."
unset ADMIN_PASSWORD
