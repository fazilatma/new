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
#     --with-src                        ALSO upload the discovered panel source
#                                       (redacted, ≤400 KB) so the agent can read
#                                       and fix the actual PHP; default: off
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

VERSION="1.0.3"
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
SRCMAX=400000        # hard cap for an uploaded source file (--with-src)
WITH_SRC=0

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
    --with-src)   WITH_SRC=1; shift ;;
    --no-src)     WITH_SRC=0; shift ;;
    --save-token) SAVE_TOKEN=1; shift ;;
    --token)      GH_TOKEN="${2:-}"; shift 2; echo "⚠️  token on the command line lands in shell history" ;;
    --token=*)    GH_TOKEN="${1#*=}"; shift ;;
    -h|--help)    sed -n '2,58p' "$0"; exit 0 ;;
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

# ------------------------------------------------------- verdict flags
V_OPCACHE_LOCK=0; V_SHARED=0; V_DISPLAY_ON=0; V_DISPLAY_NOISE=0
V_ENTITIES=0; V_NOCONF=0; V_LINTFAIL=0; V_WRITE_FAIL=0
V_CHMOD_FAIL=0; V_RENAME_FAIL=0; V_FLOCK_FAIL=0; V_SRV_OK=0

# source uploads get a LIGHTER redaction: real secret shapes only, so the
# code itself stays readable and fixable.
redact_src() {
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
    -e 's/\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{20,}/[REDACTED_HASH]/g'
}

# probe_dir <dir> <label> — write / chmod / rename / flock, the four things a
# deploy panel needs and shared storage silently refuses.
probe_dir() {
  local d="$1" lab="${2:-}" pf
  [ -n "$d" ] || return 0
  [ -d "$d" ] || { out "- \`$d\` ($lab): not a directory"; return 0; }
  case "${PROBED_DIRS:-}" in *"|$d|"*) return 0;; esac
  PROBED_DIRS="${PROBED_DIRS:-}|$d|"
  out "- \`$d\`  ${lab:+($lab)}"
  out "  - ls -ld: $(ls -ld "$d" 2>&1)"
  out "  - fs: $(df "$d" 2>/dev/null | tail -1 | tr -s ' ')"
  have php && out "  - php is_writable: $(php -r 'echo is_writable($argv[1])?"yes":"NO";' "$d" 2>/dev/null)"
  pf="$d/.s4probe.$$"
  if printf 'x' > "$pf" 2>/dev/null; then
    out "  - write: OK"
    if chmod 0600 "$pf" 2>/dev/null; then out "  - chmod: OK"; else
      out "  - chmod: FAILED (typical on Android shared storage)"; V_CHMOD_FAIL=1; fi
    if have php; then
      local fl
      fl=$(php -r '$f=@fopen($argv[1],"c+"); if(!$f){echo "open FAILED";exit;} echo flock($f,LOCK_EX|LOCK_NB)?"OK":"FAILED"; flock($f,LOCK_UN); fclose($f);' "$pf" 2>&1)
      out "  - flock (php, LOCK_EX|LOCK_NB): $fl"
      case "$fl" in FAILED*) V_FLOCK_FAIL=1;; esac
    fi
    if mv "$pf" "$pf.2" 2>/dev/null; then out "  - rename (atomic replace): OK"; else
      out "  - rename: FAILED — atomic config writes will break"; V_RENAME_FAIL=1; fi
    rm -f "$pf" "$pf.2" 2>/dev/null
  else
    out "  - write: FAILED — nothing can be saved here"; V_WRITE_FAIL=1
  fi
}

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
PWD_P="$(pwd -P 2>/dev/null || echo "$PWD")"
out "- pwd (resolved): \`$PWD_P\`"
case "$PWD" in
  /sdcard/*|/storage/*|*/storage/shared/*|/mnt/sdcard/*|/mnt/media_rw/*|/mnt/shared/*)
    out "- 🚨 **cwd is on Android SHARED STORAGE** — chmod/rename/flock/exec are unreliable there; PHP's built-in server cannot even create its lock file. Move the panel to \`~/deploy\`."; V_SHARED=1 ;;
  *) out "- android shared storage in path: no" ;;
esac
run "TMPDIR" sh -c 'echo "TMPDIR=${TMPDIR:-<unset>}"; ls -ld "${TMPDIR:-/nonexistent}" /tmp "${PREFIX:-/nonexistent}/tmp" 2>&1 | head -4'
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
  run "display_errors" php -r 'echo ini_get("display_errors").PHP_EOL;'
  DE="$(php -r 'echo ini_get("display_errors");' 2>/dev/null)"
  case "$DE" in 1|On|on|true) V_DISPLAY_ON=1;; esac
  run "error_reporting" php -r 'echo ini_get("error_reporting")." (".E_ALL.")".PHP_EOL;'
  run "log_errors/error_log" php -r 'echo ini_get("log_errors")." / ".(ini_get("error_log")?:"<none>").PHP_EOL;'
  run "opcache module" sh -c 'php -m 2>/dev/null | grep -i opcache || echo "not loaded"'
  run "opcache settings" sh -c 'php -i 2>/dev/null | grep -iE "^opcache[. ]" | grep -iE "enable|lockfile|file_cache|memory_consumption" | head -10 || echo n/a'
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
# Rank every candidate instead of taking the first one `find` happened to
# return: the real panel is the big, lint-clean file in the working directory,
# not a 4 KB copy inside a project cache.
RANK="$TMPDIR_R/rank.txt"; : > "$RANK"
while IFS= read -r f; do
  [ -f "$f" ] || continue
  sz=$(wc -c < "$f" 2>/dev/null | tr -d ' '); sz=${sz:-0}
  mt=$(date -r "$f" '+%s' 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
  lint=1
  if have php; then php -l "$f" >/dev/null 2>&1 || lint=0; fi
  score=0
  case "$f" in "$PWD"/*|"${PWD_P:-$PWD}"/*) score=$((score+100000));; esac
  if [ "$lint" = 1 ]; then score=$((score+20000)); else score=$((score-40000)); fi
  case "$f" in
    *.wconsole_data/cache/*|*.git-cache/*|*/node_modules/*|*/amphp/*) score=$((score-15000));;
  esac
  score=$((score + sz/100 + mt/10000000))
  printf '%s\t%s\t%s\t%s\n' "$score" "$sz" "$lint" "$f" >> "$RANK"
done < "$FOUND"
sort -rn "$RANK" -o "$RANK" 2>/dev/null || true
out "- ranking (score · bytes · \`php -l\` · path); the top match per kind is used:"
while IFS=$'\t' read -r sc sz lint f; do
  [ -n "$f" ] && out "  - ${sc} · ${sz}B · lint=${lint} · \`$f\`"
done < "$RANK"
pick() { # pick <basename glob> -> best-ranked match
  local g="$1" sc sz lint f
  while IFS=$'\t' read -r sc sz lint f; do
    case "$(basename "$f")" in $g) printf '%s' "$f"; return 0;; esac
  done < "$RANK"
  return 0
}
PANEL="$(pick 'deploy*.php')"
SCRAPER="$(pick 'scraper4*.php')"
[ -n "$PANEL" ]   && probe_file "$PANEL" 600
[ -n "$SCRAPER" ] && [ "$SCRAPER" != "$PANEL" ] && probe_file "$SCRAPER" 400
n=0
while IFS=$'\t' read -r sc sz lint f; do
  [ -n "$f" ] || continue
  { [ "$f" = "$PANEL" ] || [ "$f" = "$SCRAPER" ]; } && continue
  n=$((n+1)); [ "$n" -gt 4 ] && break
  probe_file "$f" 200
done < "$RANK"
out ""
out "- **panel file**: \`${PANEL:-<not found>}\`"
out "- **scraper4 file**: \`${SCRAPER:-<not found>}\`"
if [ -n "$PANEL" ]; then
  V_ENTITIES=$(grep -o '=&gt;' "$PANEL" 2>/dev/null | wc -l | tr -d ' ')
  V_ENTITIES=${V_ENTITIES:-0}
  if have php && ! php -l "$PANEL" >/dev/null 2>&1; then V_PANEL_LINT=1; else V_PANEL_LINT=0; fi
fi
if [ -n "$SCRAPER" ]; then
  out "- scraper4 APP_VERSION: $(grep -m1 -o "const APP_VERSION = '[^']*'" "$SCRAPER" 2>/dev/null || echo unknown)"
  out "- scraper4 md5: $(md5sum "$SCRAPER" 2>/dev/null | cut -d' ' -f1)"
fi

sec "7. Folder permissions (what cfg_save / do_deploy need)"
probe_dir "${PANEL:+$(dirname "$PANEL")}" "panel dir"
probe_dir "${SCRAPER:+$(dirname "$SCRAPER")}" "scraper4 dir"
probe_dir "$PWD" "cwd"
probe_dir "$HOME/deploy" "internal deploy dir"
probe_dir "${TMPDIR:-}" "TMPDIR"
probe_dir "${PREFIX:-}/tmp" "prefix tmp"
probe_dir "/storage/emulated/0" "shared storage root"

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
  V_NOCONF=1
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

sec "9. Local php -S startup matrix (this is where a Termux panel dies)"
WORK_DIR=""; WORK_OPTS=""; WORK_PORT=""
if have php; then
  CTRL="$TMPDIR_R/web"; mkdir -p "$CTRL" 2>/dev/null
  printf '<?php echo "S4_CTRL_OK";' > "$CTRL/index.php" 2>/dev/null
  PDIR="${PANEL:+$(dirname "$PANEL")}"
  PORT="$LOCAL_PORT"
  for SD in "$PDIR" "$CTRL"; do
    [ -n "$SD" ] && [ -d "$SD" ] || continue
    for v in plain opcache_off lockpath; do
      case "$v" in
        plain)       OPTS="" ;;
        opcache_off) OPTS="-d opcache.enable=0 -d opcache.enable_cli=0" ;;
        lockpath)    OPTS="-d opcache.lockfile_path=${PREFIX:-$HOME}/tmp" ;;
      esac
      LOG="$TMPDIR_R/srv-$(printf '%s-%s' "$SD" "$v" | tr -c 'A-Za-z0-9' '-').log"
      ( cd "$SD" 2>/dev/null && php $OPTS -d display_errors=1 -d error_reporting=E_ALL \
          -d memory_limit=512M -S "127.0.0.1:$PORT" -t "$SD" > "$LOG" 2>&1 ) &
      SRV=$!
      sleep 3
      if kill -0 "$SRV" 2>/dev/null; then
        out "- ✅ UP   dir=\`$SD\` variant=\`$v\` → \`php $OPTS -S 127.0.0.1:$PORT -t $SD\`"
        kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
        V_SRV_OK=1
        if [ "$SD" != "$CTRL" ] && [ -z "$WORK_DIR" ]; then
          WORK_DIR="$SD"; WORK_OPTS="$OPTS"; WORK_PORT="$PORT"
        fi
      else
        out "- ❌ DEAD dir=\`$SD\` variant=\`$v\` → \`php $OPTS -S 127.0.0.1:$PORT -t $SD\`"
        tail -5 "$LOG" 2>/dev/null | sed 's/^/      /' >> "$REPORT"
        grep -q 'Cannot create lock' "$LOG" 2>/dev/null && V_OPCACHE_LOCK=1
        grep -qi 'already in use' "$LOG" 2>/dev/null && PORT=$((PORT+1))
      fi
      PORT=$((PORT+1))
    done
  done
  if [ -n "$WORK_DIR" ]; then
    ( cd "$WORK_DIR" && php $WORK_OPTS -d display_errors=1 -d error_reporting=E_ALL \
        -d memory_limit=512M -S "127.0.0.1:$WORK_PORT" -t "$WORK_DIR" > "$TMPDIR_R/srv-run.log" 2>&1 ) &
    SRV=$!
    sleep 3
    if kill -0 "$SRV" 2>/dev/null; then
      out "- serving \`$WORK_DIR\` on 127.0.0.1:$WORK_PORT (read-only endpoints only)"
      if [ -n "$PANEL" ]; then
        out "- panel response head (a Deprecated/Notice line printed here breaks the UI's JSON):"
        curl -sS --max-time 25 -o "$TMPDIR_R/panel.out" \
          -w '      http=%{http_code} bytes=%{size_download} time=%{time_total}s\n' \
          "http://127.0.0.1:$WORK_PORT/$(basename "$PANEL")" >> "$REPORT" 2>&1
        head -c 900 "$TMPDIR_R/panel.out" 2>/dev/null | sed 's/^/      /' >> "$REPORT"
        out ""
        if grep -qiE 'Deprecated|Notice:|Warning:|Fatal error' "$TMPDIR_R/panel.out" 2>/dev/null; then
          V_DISPLAY_NOISE=1
        fi
      fi
      if [ -n "$SCRAPER" ] && [ "$(dirname "$SCRAPER")" = "$WORK_DIR" ]; then
        B="http://127.0.0.1:$WORK_PORT/$(basename "$SCRAPER")"
        endpoint "local whoami" "$B?whoami=1" 20
        endpoint "local ops_feedback" "$B?ops_feedback=1" 60
        endpoint "local matrix_execution_status" "$B?matrix_execution_status=1" 30
        endpoint "local ai_test_status" "$B?ai_test_status=1" 30
        endpoint "local cron_last" "$B?cron_last=1" 40
      fi
      out "- server log tail:"
      tail -20 "$TMPDIR_R/srv-run.log" 2>/dev/null | sed 's/^/      /' >> "$REPORT"
      kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null
    else
      out "- the variant that worked in the matrix died on restart; log:"
      tail -20 "$TMPDIR_R/srv-run.log" 2>/dev/null | sed 's/^/      /' >> "$REPORT"
    fi
  else
    out "- no variant could serve the panel's directory → the panel cannot run there at all (see §11)"
  fi
else
  out "- skipped (php not installed)"
fi

sec "10. Deploy doctor (if present)"
if [ -f "$CFGDIR/deploy-doctor.php" ] && have php; then
  php "$CFGDIR/deploy-doctor.php" "${PANEL:-$CFGDIR/deploy.php}" 2>&1 | head -120 | sed 's/^/      /' >> "$REPORT"
else
  out "- deploy-doctor.php not found next to the panel; fetch it with:"
  out "  \`curl -fsSL -o $CFGDIR/deploy-doctor.php $RAWBASE/deploy/deploy-doctor.php\`"
fi

sec "11. Verdict (computed from the sections above)"
V_HITS=0
if [ "$V_OPCACHE_LOCK" = 1 ]; then V_HITS=1
  out "- 🚨 **OPcache cannot create its lock here** → \`php -S\` dies in the first second (\`Cannot create lock - Permission denied\`), so the panel URL never answers at all. This is the usual Termux “the panel doesn’t enter”."
  out "  - start it with \`-d opcache.enable=0 -d opcache.enable_cli=0\` (deploy/termux-panel.sh already does)"
fi
if [ "$V_SHARED" = 1 ]; then V_HITS=1
  out "- 🚨 **cwd/panel on Android shared storage** → no exec bit, chmod/rename unreliable, POSIX locks refused."
  out "  - \`mkdir -p ~/deploy && cp <panel> <scraper4> ~/deploy/ && cd ~/deploy\`"
fi
if [ "$V_DISPLAY_NOISE" = 1 ]; then V_HITS=1
  out "- 🚨 **PHP diagnostics are printed into the HTTP response** → the panel's own \`api()\`/\`JSON.parse\` calls fail, so buttons look dead even though the server runs."
  out "  - run with \`-d display_errors=0 -d log_errors=1 -d error_log=\$HOME/deploy/php-error.log\` (or \`DEBUG=1 bash termux-panel.sh\` when you *want* to see them)"
elif [ "$V_DISPLAY_ON" = 1 ]; then V_HITS=1
  out "- ⚠️ \`display_errors=On\` and no php.ini is loaded → PHP 8.5 \`Deprecated:\` lines (e.g. \`\$http_response_header\`) can land inside JSON/HTML output."
fi
if [ "${V_PANEL_LINT:-0}" = 1 ]; then V_HITS=1
  out "- 🚨 the selected panel file **fails \`php -l\`** → blank page / HTTP 500"
fi
if [ "${V_ENTITIES:-0}" -gt 0 ] 2>/dev/null; then V_HITS=1
  out "- 🚨 **HTML-entity contamination** (\`=&gt;\` ×${V_ENTITIES}) → this file was saved out of a rendered web page/chat, not from the repo"
fi
if [ "$V_WRITE_FAIL" = 1 ]; then V_HITS=1
  out "- 🚨 a probed folder is **not writable** → \`.deploy-config.json\` can never be saved, so the first-run screen loops forever"
fi
if [ "$V_CHMOD_FAIL" = 1 ] || [ "$V_RENAME_FAIL" = 1 ] || [ "$V_FLOCK_FAIL" = 1 ]; then V_HITS=1
  out "- ⚠️ chmod/rename/flock failed in a probed folder → atomic writes and lock files break there (see §7)"
fi
if [ "$V_NOCONF" = 1 ]; then
  out "- ℹ️ \`.deploy-config.json\` missing → first-run setup screen is expected on a fresh copy"
fi
if [ "$V_HITS" = 0 ]; then
  out "- no automatic red flags: the panel starts and answers, so look at §9's response head and §6's lint/md5 lines"
fi
out ""
out "- **commands to run next** (moves the panel onto internal storage and starts it correctly):"
out '  ```sh'
out "  mkdir -p ~/deploy"
[ -n "${PANEL:-}" ]   && out "  cp '$PANEL' ~/deploy/"
[ -n "${SCRAPER:-}" ] && out "  cp '$SCRAPER' ~/deploy/"
out "  curl -fsSL -o ~/deploy/termux-panel.sh $RAWBASE/deploy/termux-panel.sh"
out "  curl -fsSL -o ~/deploy/deploy-doctor.php $RAWBASE/deploy/deploy-doctor.php"
out "  cd ~/deploy && bash termux-panel.sh ~/deploy"
out '  ```'
out "  then open the URL it prints, and re-run this script with \`--with-src\` so the panel source is uploaded for review."

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

TREE_ENTRIES=$(printf '{"path":"%s","mode":"100644","type":"blob","sha":"%s"}' "$RPATH" "$BLOBSHA")

# optional second blob: the panel source itself, lightly redacted, so the agent
# can read and fix the real PHP instead of guessing from symptoms.
SRCPATH=""
if [ "$WITH_SRC" = 1 ] && [ -n "${PANEL:-}" ] && [ -f "${PANEL:-}" ]; then
  SRCF="$TMPDIR_R/src.txt"
  { printf '### uploaded by s4-report.sh v%s ###\n### source of %s (secrets redacted) ###\n\n' "$VERSION" "$PANEL"
    redact_src < "$PANEL" | head -c "$SRCMAX"
  } > "$SRCF" 2>/dev/null
  SB64=$(base64 < "$SRCF" | tr -d '\n')
  SBLOB=$(gh_api POST "$API/repos/$REPO/git/blobs" \
    "$(printf '{"content":"%s","encoding":"base64"}' "$SB64")" | jstr sha)
  if [ -n "$SBLOB" ]; then
    SRCPATH="reports/${SLUG}/$(basename "$PANEL").txt"
    TREE_ENTRIES="$TREE_ENTRIES,$(printf '{"path":"%s","mode":"100644","type":"blob","sha":"%s"}' "$SRCPATH" "$SBLOB")"
    echo "   + panel source: $(wc -c < "$SRCF" | tr -d ' ') bytes (redacted) → $SRCPATH"
  else
    echo "   ⚠️  --with-src: source upload failed; continuing with the report only"
  fi
fi

TREEJSON=$(printf '{"base_tree":"%s","tree":[%s]}' "$BASETREE" "$TREE_ENTRIES")
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
[ -n "$SRCPATH" ] && echo "   source: https://github.com/$REPO/blob/$BRANCH/$SRCPATH"
echo ""
echo "Tell the agent: \"report uploaded\" — it reads that file through the GitHub API."
