#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  s4-report.sh — one-shot device diagnostics that reports back to GitHub
#
#  WHY
#  ----
#  The agent working on this repo cannot reach your device, and the old
#  production host is suspended. So instead of pasting terminal output
#  back and forth, this script:
#    1. collects everything needed to diagnose the deploy panel / scraper4
#       on THIS device (PHP, permissions, files, syntax, endpoints),
#    2. scrubs every secret it can recognise,
#    3. commits the report to the branch  device-reports  of  fazilatma/new
#       (created on first run) via the GitHub Git Data API,
#    4. prints the report URL so the agent can read it immediately.
#
#  INSTALL / RUN (Termux)
#  ----------------------
#  A) normal:
#     curl -fsSL -o ~/s4-report.sh \
#       https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-report.sh
#     bash ~/s4-report.sh
#
#  B) if raw.githubusercontent.com is blocked/slow on your network, use the
#     API host instead (same bytes, different hostname):
#     curl -fsSL -H 'Accept: application/vnd.github.raw' -o ~/s4-report.sh \
#       'https://api.github.com/repos/fazilatma/new/contents/deploy/s4-report.sh?ref=arena/f5a628bb-new'
#     bash ~/s4-report.sh
#
#  Always check the download before running it:
#     wc -c ~/s4-report.sh        # expect > 15000
#     tail -1 ~/s4-report.sh      # must not be an HTML/error page
#
#  Do NOT pipe curl into bash: the token prompt needs a real stdin.
#
#  TOKEN (never hardcoded, never committed)
#     bash s4-report.sh                       # hidden prompt, or file, or env
#     GH_TOKEN=... bash s4-report.sh          # env (lands in shell history)
#     bash s4-report.sh --save-token          # store in ~/.config/s4-report/token (chmod 600)
#     bash s4-report.sh --no-upload           # print only, upload nothing
#
#  OTHER FLAGS
#     --url https://host/scraper4.php   also probe a live app URL
#     --tick                            with --url: drive one ?ops_tick=1 slice
#     --live                            with --url: also call repair/probe endpoints
#     --branch NAME                     report branch (default: device-reports)
#     --repo owner/name                 default: fazilatma/new
#
#  SAFETY
#     * read-only on your device by default (no file is modified)
#     * never uploads connections.json / .deploy-config.json contents,
#       only derived booleans; a redaction pass runs over the whole report
#     * reports go to their own branch, never to a branch that a host
#       auto-deploys from
# =====================================================================

set -u
export LC_ALL=C.UTF-8 2>/dev/null || true

VERSION="1.0.2"
API="https://api.github.com"
REPO="fazilatma/new"
BRANCH="device-reports"
SRC_BRANCH="arena/f5a628bb-new"   # branch this script + deploy-doctor.php live on
RAWBASE="https://raw.githubusercontent.com/fazilatma/new/$SRC_BRANCH"
LIVE_URL=""
DO_TICK=0
DO_LIVE=0
NO_UPLOAD=0
SAVE_TOKEN=0
GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
LOCAL_PORT="${LOCAL_PORT:-8899}"
MAXB=300000          # hard cap for the report body

# ---------------------------------------------------------------- args
while [ $# -gt 0 ]; do
  case "$1" in
    --url)        LIVE_URL="${2:-}"; shift 2 ;;
    --url=*)      LIVE_URL="${1#*=}"; shift ;;
    --repo)       REPO="${2:-}"; shift 2 ;;
    --repo=*)     REPO="${1#*=}"; shift ;;
    --branch)     BRANCH="${2:-}"; shift 2 ;;
    --branch=*)   BRANCH="${1#*=}"; shift ;;
    --tick)       DO_TICK=1; shift ;;
    --live)       DO_LIVE=1; shift ;;
    --no-upload)  NO_UPLOAD=1; shift ;;
    --save-token) SAVE_TOKEN=1; shift ;;
    --token)      GH_TOKEN="${2:-}"; shift 2; echo "⚠️  token on the command line lands in shell history" ;;
    --token=*)    GH_TOKEN="${1#*=}"; shift ;;
    -h|--help)    sed -n '2,56p' "$0"; exit 0 ;;
    *)            echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------- helpers
TMPDIR_R="$(mktemp -d "${TMPDIR:-/tmp}/s4report.XXXXXX" 2>/dev/null || echo /tmp/s4report.$$)"
mkdir -p "$TMPDIR_R" 2>/dev/null || true
REPORT="$TMPDIR_R/report.md"
: > "$REPORT"
trap 'rm -rf "$TMPDIR_R" 2>/dev/null' EXIT

out()  { printf '%s\n' "$*" >> "$REPORT"; }
sec()  { printf '\n## %s\n\n' "$*" >> "$REPORT"; }
have() { command -v "$1" >/dev/null 2>&1; }
run()  { # run <label> <cmd...> : append "label: output" (first 40 lines)
  local label="$1"; shift
  local o
  o="$("$@" 2>&1 | head -40)"
  out "- **$label**: ${o:-<empty>}"
}
probe_file() { # probe_file <path> [maxbytes]
  local p="$1" mb="${2:-1200}" o
  out "- \`$p\`"
  if [ ! -f "$p" ]; then out "  - missing"; return; fi
  out "  - size: $(wc -c < "$p" 2>/dev/null) bytes · mtime: $(date -r "$p" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || stat -c %y "$p" 2>/dev/null)"
  out "  - md5: $(md5sum "$p" 2>/dev/null | cut -d' ' -f1)"
  out "  - first line: $(head -1 "$p" 2>/dev/null | cut -c1-120)"
  if have php; then
    o="$(php -l "$p" 2>&1 | head -6)"
    out "  - php -l: ${o:-n/a}"
  fi
  local egt elt eamp
  egt=$(grep -o '=&gt;' "$p" 2>/dev/null | wc -l | tr -d ' ')
  elt=$(grep -o '&lt;' "$p" 2>/dev/null | wc -l | tr -d ' ')
  eamp=$(grep -o '&amp;' "$p" 2>/dev/null | wc -l | tr -d ' ')
  out "  - html entities: =&gt; ×${egt:-0} · &lt; ×${elt:-0} · &amp; ×${eamp:-0}   (&lt;/&amp; are normal inside HTML strings)"
  if [ "${egt:-0}" -gt 0 ]; then
    out "  - 🚨 **ENTITY CONTAMINATION**: \`=&gt;\` only appears if the PHP code itself was HTML-escaped (file saved from a web page/chat). PHP cannot parse it → blank page / HTTP 500. Fix: \`php deploy-doctor.php '$p' --fix\`"
  fi
  out "  - BOM: $(head -c 3 "$p" | od -An -tx1 2>/dev/null | tr -d ' ' | grep -qi '^efbbbf' && echo YES || echo no)"
  out "  - tail: \`\`\`$(tail -c "$mb" "$p" 2>/dev/null | tr '\n' '~' | cut -c1-200)\`\`\`"
}
curlj() { # curlj <maxtime> <url> [extra curl args...]
  local mt="$1" u="$2"; shift 2
  curl -sS --max-time "$mt" -H 'User-Agent: s4-report/1.0' "$@" "$u" 2>&1
}
endpoint() { # endpoint <label> <url> [maxlines]
  local label="$1" u="$2" ml="${3:-60}" body
  body="$(curlj 25 "$u" | head -c 20000)"
  out "- **$label** \`$u\`"
  if [ -z "$body" ]; then out "  - <empty response>"; return; fi
  printf '%s\n' "$body" | head -"$ml" | sed 's/^/      /' >> "$REPORT"
}

# ------------------------------------------------------------- redaction
redact() {
  sed -E \
    -e 's/gh[pousr]_[A-Za-z0-9]{20,}/[REDACTED_GITHUB_TOKEN]/g' \
    -e 's/github_pat_[A-Za-z0-9_]{20,}/[REDACTED_GITHUB_TOKEN]/g' \
    -e 's/(Bearer[[:space:]]+)[A-Za-z0-9._-]{12,}/\1[REDACTED]/g' \
    -e 's/ck_[a-f0-9]{20,}/[REDACTED_WOO_KEY]/g' \
    -e 's/cs_[a-f0-9]{20,}/[REDACTED_WOO_SECRET]/g' \
    -e 's/AIza[A-Za-z0-9_-]{20,}/[REDACTED_GOOGLE_KEY]/g' \
    -e 's/sk-[A-Za-z0-9_-]{20,}/[REDACTED_SECRET_KEY]/g' \
    -e 's/xox[baprs]-[A-Za-z0-9-]{10,}/[REDACTED_SLACK]/g' \
    -e 's/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}[A-Za-z0-9._-]*/[REDACTED_JWT]/g' \
    -e 's/\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{20,}/[REDACTED_HASH]/g' \
    -e 's/("?(api_token|token|secret|password|passwd|consumer_secret|consumer_key|auth)"?[[:space:]]*[:=][[:space:]]*"?)[^",}[:space:]]{6,}/\1[REDACTED]/g'
}

gh_api() { # gh_api METHOD URL [JSON]
  local m="$1" u="$2" d="${3:-}"
  if [ -n "$d" ]; then
    curl -sS --max-time 120 -X "$m" \
      -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: s4-report/1.0' -H 'Content-Type: application/json' -d "$d" "$u" 2>&1
  else
    curl -sS --max-time 60 -X "$m" \
      -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
      -H 'User-Agent: s4-report/1.0' "$u" 2>&1
  fi
}
jstr() { tr -d ' \n' | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

# =====================================================================
#  1. identity + environment
# =====================================================================
SLUG="$( { uname -n 2>/dev/null; echo "${PREFIX:-}"; } | tr -c 'A-Za-z0-9' '-' | tr -s '-' | cut -c1-28 | sed 's/^-*//;s/-*$//' )"
[ -z "$SLUG" ] && SLUG="device"
RPATH="reports/${SLUG}.md"

out "# Device report — ${SLUG}"
out ""
out "- generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')  ·  script v${VERSION}"
out "- repo/branch for reports: \`${REPO}@${BRANCH}\` → \`${RPATH}\`"
out "- live app url: ${LIVE_URL:-<none given>}"

sec "1. Environment"
run "uname" uname -a
run "whoami" whoami
run "pwd/home" sh -c 'echo "home=$HOME pwd=$PWD prefix=${PREFIX:-<none>}"'
out "- termux: $(case "${PREFIX:-}" in *com.termux*) echo yes;; *) echo no;; esac)"
out "- android shared storage in path: $(case "$PWD" in /sdcard/*|/storage/*) echo YES;; *) echo no;; esac)"
if [ -n "${PREFIX:-}" ]; then
  run "termux-info (head)" sh -c 'command -v termux-info >/dev/null && termux-info 2>&1 | head -25 || echo n/a'
fi
run "free space" sh -c 'df -h "$HOME" 2>/dev/null | head -3'

sec "2. PHP"
if have php; then
  run "version" php -r 'echo PHP_VERSION." ".PHP_SAPI.PHP_EOL;'
  run "binary" sh -c 'command -v php'
  run "memory_limit" php -r 'echo ini_get("memory_limit").PHP_EOL;'
  run "max_execution_time" php -r 'echo ini_get("max_execution_time").PHP_EOL;'
  run "disable_functions" php -r 'echo ini_get("disable_functions") ?: "<none>".PHP_EOL;'
  run "open_basedir" php -r 'echo ini_get("open_basedir") ?: "<none>".PHP_EOL;'
  run "allow_url_fopen" php -r 'echo ini_get("allow_url_fopen").PHP_EOL;'
  run "extensions" php -r '$w=["curl","openssl","mbstring","json","hash","zlib","sqlite3","pdo_sqlite","posix","pcntl","gd","fileinfo","iconv","bcmath","sockets"];foreach($w as $e)printf("%s=%s ",$e,extension_loaded($e)?"y":"N");echo PHP_EOL;'
  run "functions" php -r '$w=["fastcgi_finish_request","exec","proc_open","shell_exec","posix_kill","flock","gzdecode","hash_pbkdf2","openssl_encrypt","random_bytes","token_get_all","disk_free_space","putenv","set_time_limit","ignore_user_abort"];foreach($w as $f)printf("%s=%s ",$f,function_exists($f)?"y":"N");echo PHP_EOL;'
  run "ini path" php --ini 2>&1 | head -6
else
  out "- **php NOT installed** — \`pkg install php\`"
fi

sec "3. Tools"
for t in curl git python3 jq node base64 ss netstat openssl md5sum od; do
  out "- $t: $(have "$t" && command -v "$t" || echo MISSING)"
done

sec "4. Network reachability"
out "- api.github.com/rate_limit:"
printf '%s\n' "$(curlj 15 "$API/rate_limit" | head -c 400)" | sed 's/^/      /' >> "$REPORT"
out "- raw.githubusercontent.com (this script):"
printf '%s\n' "$(curl -sS -o /dev/null -w 'http=%{http_code} size=%{size_download} time=%{time_total}s' --max-time 20 "$RAWBASE/deploy/s4-report.sh" 2>&1)" | sed 's/^/      /' >> "$REPORT"
out "- api.github.com fallback (raw content, same bytes):"
printf '%s\n' "$(curl -sS -o /dev/null -w 'http=%{http_code} size=%{size_download} time=%{time_total}s' --max-time 20 -H 'Accept: application/vnd.github.raw' "$API/repos/$REPO/contents/deploy/s4-report.sh?ref=$SRC_BRANCH" 2>&1)" | sed 's/^/      /' >> "$REPORT"
out "- old production (scraper4.42web.io):"
printf '%s\n' "$(curlj 15 'https://scraper4.42web.io/scraper4.php?whoami=1' | head -c 300)" | sed 's/^/      /' >> "$REPORT"
if [ -n "$LIVE_URL" ]; then
  base="${LIVE_URL%%\?*}"
  sep="?"; case "$base" in *\?*) sep="&";; esac
  endpoint "whoami"        "${base}${sep}whoami=1" 20
  endpoint "ops_feedback"  "${base}${sep}ops_feedback=1" 60
  endpoint "matrix_exec"   "${base}${sep}matrix_execution_status=1" 30
  endpoint "sync_matrix_feedback" "${base}${sep}sync_matrix_feedback=1" 40
  endpoint "ai_test_status" "${base}${sep}ai_test_status=1" 30
  endpoint "ai_stats"      "${base}${sep}ai_stats=1" 20
  endpoint "cron_last"     "${base}${sep}cron_last=1" 40
  endpoint "extract_queue" "${base}${sep}extract_queue_status=1" 40
  endpoint "worker_status" "${base}${sep}worker_status=1" 10
  if [ "$DO_TICK" = 1 ]; then endpoint "ops_tick" "${base}${sep}ops_tick=1&json=1" 40; fi
  if [ "$DO_LIVE" = 1 ]; then
    endpoint "ops_feedback+repair" "${base}${sep}ops_feedback=1&repair=1" 60
    endpoint "matrix_feedback+probe" "${base}${sep}sync_matrix_feedback=1&probe=1" 60
  fi
fi

# =====================================================================
#  5. find the interesting files on this device
# =====================================================================
sec "5. File discovery"
FOUND="$TMPDIR_R/found.txt"
: > "$FOUND"
for d in "$HOME" /sdcard /storage/emulated/0 /data/data/com.termux/files/home; do
  [ -d "$d" ] || continue
  find "$d" -maxdepth 6 \( -iname 'deploy*.php' -o -iname 'scraper4*.php' -o -iname 'webconsole*.php' \) \
       -not -path '*/node_modules/*' -not -path '*/.git/*' -not -name 'deploy-doctor.php' \
       -type f 2>/dev/null >> "$FOUND"
done
sort -u "$FOUND" -o "$FOUND" 2>/dev/null || true
out "- candidates: $(wc -l < "$FOUND" 2>/dev/null | tr -d ' ')"
while IFS= read -r f; do [ -n "$f" ] && out "  - \`$f\`"; done < "$FOUND"

sec "6. Per-file checks"
PANEL=""
SCRAPER=""
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in
    deploy*.php)  [ -z "$PANEL" ]   && PANEL="$f" ;;
    scraper4*.php) [ -z "$SCRAPER" ] && SCRAPER="$f" ;;
  esac
  probe_file "$f" 400
done < "$FOUND"
out ""
out "- panel file: \`${PANEL:-<not found>}\`"
out "- scraper4 file: \`${SCRAPER:-<not found>}\`"
if [ -n "$SCRAPER" ]; then
  out "- scraper4 APP_VERSION: $(grep -m1 -o "const APP_VERSION = '[^']*'" "$SCRAPER" 2>/dev/null || echo unknown)"
  out "- scraper4 md5: $(md5sum "$SCRAPER" 2>/dev/null | cut -d' ' -f1)"
fi

sec "7. Folder permissions (what cfg_save / do_deploy need)"
for d in "${PANEL:+$(dirname "$PANEL")}" "$HOME/deploy" "$HOME"; do
  [ -n "$d" ] && [ -d "$d" ] || continue
  out "- \`$d\`"
  out "  - ls -ld: $(ls -ld "$d" 2>&1)"
  out "  - is_writable(php): $(have php && php -r 'echo is_writable($argv[1])?"yes":"NO";' "$d" 2>/dev/null || echo n/a)"
  if touch "$d/.s4probe" 2>/dev/null; then
    out "  - write: OK"
    chmod 0600 "$d/.s4probe" 2>/dev/null && out "  - chmod: OK" || out "  - chmod: FAILED"
    mv "$d/.s4probe" "$d/.s4probe2" 2>/dev/null && out "  - rename (atomic replace): OK" || out "  - rename: FAILED"
    rm -f "$d/.s4probe" "$d/.s4probe2" 2>/dev/null
  else
    out "  - write: FAILED"
  fi
done

sec "8. Panel configuration state (sanitised)"
CFGDIR="${PANEL:+$(dirname "$PANEL")}"; CFGDIR="${CFGDIR:-$HOME/deploy}"
CFG="$CFGDIR/.deploy-config.json"
if [ -f "$CFG" ]; then
  out "- \`.deploy-config.json\` exists ($(wc -c < "$CFG" 2>/dev/null) bytes), valid JSON: $(have php && php -r 'echo is_array(json_decode(file_get_contents($argv[1]),true))?"yes":"NO";' "$CFG" 2>/dev/null || echo n/a)"
  if have php; then
    php -r '$d=json_decode(file_get_contents($argv[1]),true)?:[];
      printf("- api_token set: %s\n- repo: %s\n- branch: %s\n- jobs: %d\n",
        empty($d["api_token"])?"NO (panel stays on first-run setup)":"yes",
        $d["repo"]??"-", $d["branch"]??"-", count((array)($d["jobs"]??[])));
      foreach((array)($d["jobs"]??[]) as $j) printf("  - job: %s | %s@%s : %s -> %s/%s\n", $j["name"]??"?", $j["repo"]??"-", $j["branch"]??"-", $j["source"]??"?", $j["folder"]??".", $j["dest"]??"?");
      ' "$CFG" 2>&1 | head -30 >> "$REPORT"
  fi
else
  out "- \`.deploy-config.json\` MISSING → the panel will show the first-run setup screen; if pressing it does nothing, writing failed (see §7)"
fi
HT="$CFGDIR/.htaccess"
if [ -f "$HT" ]; then
  out "- \`.htaccess\` present:"
  sed 's/^/      /' "$HT" 2>/dev/null | head -20 >> "$REPORT"
  if grep -Eq 'Require all denied|Deny from all' "$HT" && ! grep -Eq '<(FilesMatch|Files)' "$HT"; then
    out "  - ⚠️ BLOCKS EVERYTHING under Apache (403) → rename it away"
  fi
else
  out "- no \`.htaccess\` (fine for PHP's built-in server)"
fi
out "- backups: $(ls -1 "$CFGDIR/_backups"/*.bak 2>/dev/null | wc -l) file(s)"

sec "9. Local run of scraper4.php (read-only endpoints)"
if [ -n "$SCRAPER" ] && have php; then
  SDIR="$(dirname "$SCRAPER")"
  PORT="$LOCAL_PORT"
  php -d display_errors=1 -d error_reporting=E_ALL -d memory_limit=512M -S "127.0.0.1:$PORT" -t "$SDIR" > "$TMPDIR_R/srv.log" 2>&1 &
  SRV=$!
  sleep 3
  if kill -0 "$SRV" 2>/dev/null; then
    out "- started \`php -S 127.0.0.1:$PORT -t $SDIR\` (pid $SRV)"
    B="http://127.0.0.1:$PORT/$(basename "$SCRAPER")"
    endpoint "local whoami" "$B?whoami=1" 20
    endpoint "local ops_feedback" "$B?ops_feedback=1" 60
    endpoint "local matrix_execution_status" "$B?matrix_execution_status=1" 30
    endpoint "local ai_test_status" "$B?ai_test_status=1" 30
    endpoint "local cron_last" "$B?cron_last=1" 40
    out "- server log tail:"
    tail -25 "$TMPDIR_R/srv.log" 2>/dev/null | sed 's/^/      /' >> "$REPORT"
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
  else
    out "- local server did not stay up; log:"
    tail -25 "$TMPDIR_R/srv.log" 2>/dev/null | sed 's/^/      /' >> "$REPORT"
  fi
else
  out "- skipped (no scraper4.php found or no php)"
fi

sec "10. Deploy doctor (if present)"
if [ -f "$CFGDIR/deploy-doctor.php" ] && have php; then
  php "$CFGDIR/deploy-doctor.php" "${PANEL:-$CFGDIR/deploy.php}" 2>&1 | head -120 | sed 's/^/      /' >> "$REPORT"
else
  out "- deploy-doctor.php not found next to the panel; fetch it with:"
  out "  \`curl -fsSL -o $CFGDIR/deploy-doctor.php $RAWBASE/deploy/deploy-doctor.php\`"
fi

out ""
out "---"
out "_Report generated by s4-report.sh v${VERSION}. Secrets redacted automatically; no config file content is uploaded._"

# =====================================================================
#  redact + size cap
# =====================================================================
CLEAN="$TMPDIR_R/clean.md"
redact < "$REPORT" > "$CLEAN"
SZ=$(wc -c < "$CLEAN" 2>/dev/null | tr -d ' ')
if [ "${SZ:-0}" -gt "$MAXB" ]; then
  head -c "$MAXB" "$CLEAN" > "$CLEAN.t"
  printf '\n\n[... truncated at %s bytes ...]\n' "$MAXB" >> "$CLEAN.t"
  mv "$CLEAN.t" "$CLEAN"
fi

echo ""
echo "──────────────────────── report ────────────────────────"
cat "$CLEAN"
echo "────────────────────────────────────────────────────────"
echo ""

[ "$NO_UPLOAD" = 1 ] && { echo "ℹ️  --no-upload: nothing was sent."; exit 0; }

# =====================================================================
#  token acquisition (env → file → hidden prompt)
# =====================================================================
TOKFILE="$HOME/.config/s4-report/token"
if [ -z "$GH_TOKEN" ] && [ -f "$TOKFILE" ]; then
  GH_TOKEN="$(tr -d ' \n\r' < "$TOKFILE" 2>/dev/null)"
fi
if [ -z "$GH_TOKEN" ]; then
  printf 'GitHub token (fine-grained, Contents: Read+write on %s). Input hidden: ' "$REPO"
  if [ -t 0 ]; then stty -echo 2>/dev/null; read -r GH_TOKEN; stty echo 2>/dev/null; else read -r GH_TOKEN; fi
  printf '\n'
fi
if [ -z "$GH_TOKEN" ]; then echo "❌ no token → cannot upload. Re-run with --no-upload to just print."; exit 1; fi
if [ "$SAVE_TOKEN" = 1 ]; then
  mkdir -p "$(dirname "$TOKFILE")" 2>/dev/null
  printf '%s' "$GH_TOKEN" > "$TOKFILE" && chmod 600 "$TOKFILE" 2>/dev/null \
    && echo "🔐 token saved to $TOKFILE (chmod 600)"
fi

# --- pre-flight: prove the token works BEFORE touching git objects ---------
ME=$(gh_api GET "$API/user" | tr -d ' \n' | grep -o '"login":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$ME" ]; then
  echo "❌ token rejected by GET /user — it is expired, revoked, or mistyped."
  echo "   (response: $(gh_api GET "$API/user" | head -c 200))"
  echo "   The report is still on screen above; re-run with a good token to upload it."
  exit 1
fi
PERM=$(gh_api GET "$API/repos/$REPO" | tr -d ' \n' \
  | grep -o '"permissions":{[^}]*}' | head -1)
echo "🔑 token OK as '$ME' · repo $REPO · ${PERM:-permissions unknown}"
case "$PERM" in
  *'"push":true'*) echo "   push access: yes ✅" ;;
  '')              echo "   ⚠️  could not read $REPO — is it private and the token scoped to it?" ;;
  *)               echo "   ❌ push access: NO — the upload will fail."
                   echo "      Use a fine-grained PAT with 'Contents: Read and write' on $REPO."
                   exit 1 ;;
esac

# =====================================================================
#  upload via Git Data API: blob → tree(base_tree) → commit → ref
# =====================================================================
echo "⬆️  uploading to ${REPO}@${BRANCH}:${RPATH}"
REF=$(gh_api GET "$API/repos/$REPO/git/ref/heads/$BRANCH")
PARENT=$(printf '%s' "$REF" | jstr sha)
CREATED=0
if [ -z "$PARENT" ]; then
  DEF=$(gh_api GET "$API/repos/$REPO" | jstr default_branch)
  [ -z "$DEF" ] && { echo "❌ cannot read repo $REPO (token scope? repo private?): $(printf '%s' "$REF" | head -c 300)"; exit 1; }
  PARENT=$(gh_api GET "$API/repos/$REPO/git/ref/heads/$DEF" | jstr sha)
  CREATED=1
  echo "   branch '$BRANCH' does not exist → creating from '$DEF'"
fi
[ -z "$PARENT" ] && { echo "❌ no parent commit sha"; exit 1; }

BASETREE=$(gh_api GET "$API/repos/$REPO/git/commits/$PARENT" | tr -d ' \n' \
  | grep -o '"tree":{"sha":"[0-9a-f]\{40\}"' | head -1 | sed 's/.*"sha":"//; s/"$//')
[ -z "$BASETREE" ] && { echo "❌ cannot read base tree of $PARENT"; exit 1; }

B64=$(base64 < "$CLEAN" | tr -d '\n')
BLOBSHA=$(gh_api POST "$API/repos/$REPO/git/blobs" \
  "$(printf '{"content":"%s","encoding":"base64"}' "$B64")" | jstr sha)
[ -z "$BLOBSHA" ] && { echo "❌ blob upload failed (token needs Contents: write)"; exit 1; }

TREEJSON=$(printf '{"base_tree":"%s","tree":[{"path":"%s","mode":"100644","type":"blob","sha":"%s"}]}' \
  "$BASETREE" "$RPATH" "$BLOBSHA")
NEWSHA=$(gh_api POST "$API/repos/$REPO/git/trees" "$TREEJSON" | jstr sha)
[ -z "$NEWSHA" ] && { echo "❌ tree creation failed"; exit 1; }

MSG="report(${SLUG}): device diagnostics $(date -u '+%Y-%m-%d %H:%M') UTC"
COMMITJSON=$(printf '{"message":"%s","tree":"%s","parents":["%s"]}' "$MSG" "$NEWSHA" "$PARENT")
NEWCOMMIT=$(gh_api POST "$API/repos/$REPO/git/commits" "$COMMITJSON" | jstr sha)
[ -z "$NEWCOMMIT" ] && { echo "❌ commit creation failed"; exit 1; }

if [ "$CREATED" = 1 ]; then
  R=$(gh_api POST "$API/repos/$REPO/git/refs" "$(printf '{"ref":"refs/heads/%s","sha":"%s"}' "$BRANCH" "$NEWCOMMIT")")
else
  R=$(gh_api PATCH "$API/repos/$REPO/git/refs/heads/$BRANCH" "$(printf '{"sha":"%s","force":false}' "$NEWCOMMIT")")
fi
if printf '%s' "$R" | grep -q '"message"'; then
  echo "❌ ref update failed: $(printf '%s' "$R" | head -c 300)"; exit 1
fi

echo ""
echo "✅ uploaded: commit ${NEWCOMMIT:0:10}"
echo "   https://github.com/$REPO/blob/$BRANCH/$RPATH"
echo "   raw: https://raw.githubusercontent.com/$REPO/$BRANCH/$RPATH"
echo ""
echo "Tell the agent: \"report uploaded\" — it reads that file through the GitHub API."
