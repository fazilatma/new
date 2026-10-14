#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  s4-agent.sh — the PERMANENT device-side agent   (protocol s4-agent/1)
#
#  THE IDEA
#  --------
#  This file never changes again. Everything that changes lives in the
#  repository, in a folder the agent fetches every round:
#
#      ops/round.txt   one line: the id of the current round   (e.g. r3-fix-locks)
#      ops/next.sh     the instructions for that round         (bash)
#
#  Loop:
#    1. agent polls  ops/round.txt
#    2. new id?  → downloads ops/next.sh, backs up, mirrors your sources,
#                  runs it (no token in its environment, hard timeout)
#    3. collects evidence (stdout, files created, php -l, error log,
#       HTTP probes of the running app)
#    4. redacts secrets, commits the report to branch  device-reports:
#         reports/<host>/LATEST.md          ← always the newest round
#         reports/<host>/round-<id>.md      ← permanent history
#         reports/<host>/status.json        ← machine readable
#    5. says "report uploaded"; the agent on GitHub reads it, writes the
#       next ops/round.txt + ops/next.sh, and the cycle repeats until a
#       round prints  S4_ROUND_STATUS=success  (then the loop stops).
#
#  You keep editing your files wherever you like (even on shared storage).
#  The agent MIRRORS them into a run directory on internal storage, because
#  that is the only place where PHP can create files, locks and sockets
#  reliably on Android.
#
#  INSTALL (once, Termux)
#  ----------------------
#    curl -fsSL -o ~/s4-agent.sh \
#      https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-agent.sh
#    bash ~/s4-agent.sh --loop
#
#  blocked network? use the API host instead:
#    curl -fsSL -H 'Accept: application/vnd.github.raw' -o ~/s4-agent.sh \
#      'https://api.github.com/repos/fazilatma/new/contents/deploy/s4-agent.sh?ref=arena/f5a628bb-new'
#
#  Never pipe curl into bash: the token prompt needs a real stdin.
#  Check what you downloaded:  wc -c ~/s4-agent.sh ; tail -3 ~/s4-agent.sh
#
#  FLAGS
#    --loop[=SEC]      keep polling for new rounds (default 30 s)
#    --once            one round only (default)
#    --max-rounds N    stop after N rounds in loop mode
#    --force           run the round again even if its id did not change
#    --dry-run         download and PRINT the round script, do not run it
#    --no-upload       print the report on screen, upload nothing
#    --with-src        also upload deploy.php (redacted, ≤400 KB) for review
#    --srcdir DIR      where YOUR sources live  (default: auto-detect)
#    --rundir DIR      where the agent runs them (default: ~/.s4-run)
#    --mirror "a b"    which files to mirror     (default: deploy.php scraper4.php)
#    --port N          port for local HTTP probes (default 8080)
#    --timeout SEC     kill the round script after (default 900)
#    --rollback        restore the newest snapshot of the run dir and exit
#    --repo owner/name --src-branch B --report-branch B --ops-dir D
#                      point the agent at another project (also via
#                      ~/.s4-agent/config:  key=value, same names)
#    --save-token      store the token in ~/.s4-agent/token (chmod 600)
#
#  SAFETY (deliberate, do not remove)
#    * the round script runs with NO GitHub token in its environment
#    * hard timeout; output captured, never streamed to a shell you lose
#    * refuse-list: rm -rf /, mkfs, dd of=/dev/…, fork bombs abort the round
#    * the run dir is snapshotted (tar) before every round; --rollback restores
#    * secrets are redacted from every uploaded byte
#    * reports go to their own branch, never to a branch a host deploys from
#    * the agent never edits itself and never edits YOUR source folder:
#      it copies out of it. --srcdir is read-only for the agent.
# =====================================================================

set -u
export LC_ALL=C.UTF-8 2>/dev/null || true

AGENT_VERSION="1.0.0"
PROTO="s4-agent/1"

REPO="fazilatma/new"
SRC_BRANCH="arena/f5a628bb-new"
REPORT_BRANCH="device-reports"
OPS_DIR="ops"
ROUND_FILE="round.txt"
TASK_FILE="next.sh"
API="https://api.github.com"

STATE="$HOME/.s4-agent"
RUNDIR="$HOME/.s4-run"
SRCDIR=""
MIRROR_FILES="deploy.php scraper4.php"
PORT="${S4_PORT:-8080}"
POLL=30
TASK_TIMEOUT=900
MAX_ROUNDS=0
MODE="once"
DRY=0; NO_UPLOAD=0; WITH_SRC=0; DO_ROLLBACK=0; FORCE=0
SAVE_TOKEN=0
GH_TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
SRCMAX=400000
MAXB=400000

# ------------------------------------------------------------- config file
mkdir -p "$STATE" 2>/dev/null || true
if [ -f "$STATE/config" ]; then
  while IFS='=' read -r k v; do
    case "$k" in ''|\#*) continue;; esac
    k="$(printf '%s' "$k" | tr -d ' \t\r')"
    v="$(printf '%s' "$v" | tr -d '\r' | sed 's/^["'"'"']//; s/["'"'"']$//')"
    case "$k" in
      repo) REPO="$v";;            src_branch|src-branch) SRC_BRANCH="$v";;
      report_branch|report-branch) REPORT_BRANCH="$v";;
      ops_dir|ops-dir) OPS_DIR="$v";;
      srcdir) SRCDIR="$v";;        rundir) RUNDIR="$v";;
      mirror) MIRROR_FILES="$v";;  port) PORT="$v";;
      poll) POLL="$v";;            timeout) TASK_TIMEOUT="$v";;
    esac
  done < "$STATE/config"
fi

# ------------------------------------------------------------------- args
while [ $# -gt 0 ]; do
  case "$1" in
    --loop)         MODE="loop"; shift ;;
    --loop=*)       MODE="loop"; POLL="${1#*=}"; shift ;;
    --once)         MODE="once"; shift ;;
    --max-rounds)   MAX_ROUNDS="${2:-0}"; shift 2 ;;
    --max-rounds=*) MAX_ROUNDS="${1#*=}"; shift ;;
    --poll)         POLL="${2:-30}"; MODE="loop"; shift 2 ;;
    --poll=*)       POLL="${1#*=}"; MODE="loop"; shift ;;
    --force)        FORCE=1; shift ;;
    --dry-run)      DRY=1; MODE="once"; shift ;;
    --no-upload)    NO_UPLOAD=1; shift ;;
    --with-src)     WITH_SRC=1; shift ;;
    --srcdir)       SRCDIR="${2:-}"; shift 2 ;;
    --srcdir=*)     SRCDIR="${1#*=}"; shift ;;
    --rundir)       RUNDIR="${2:-}"; shift 2 ;;
    --rundir=*)     RUNDIR="${1#*=}"; shift ;;
    --mirror)       MIRROR_FILES="${2:-}"; shift 2 ;;
    --mirror=*)     MIRROR_FILES="${1#*=}"; shift ;;
    --port)         PORT="${2:-8080}"; shift 2 ;;
    --port=*)       PORT="${1#*=}"; shift ;;
    --timeout)      TASK_TIMEOUT="${2:-900}"; shift 2 ;;
    --timeout=*)    TASK_TIMEOUT="${1#*=}"; shift ;;
    --rollback)     DO_ROLLBACK=1; shift ;;
    --repo)         REPO="${2:-}"; shift 2 ;;
    --repo=*)       REPO="${1#*=}"; shift ;;
    --src-branch)   SRC_BRANCH="${2:-}"; shift 2 ;;
    --src-branch=*) SRC_BRANCH="${1#*=}"; shift ;;
    --report-branch) REPORT_BRANCH="${2:-}"; shift 2 ;;
    --report-branch=*) REPORT_BRANCH="${1#*=}"; shift ;;
    --ops-dir)      OPS_DIR="${2:-}"; shift 2 ;;
    --ops-dir=*)    OPS_DIR="${1#*=}"; shift ;;
    --save-token)   SAVE_TOKEN=1; shift ;;
    --token)        GH_TOKEN="${2:-}"; shift 2; echo "⚠️  token on the command line lands in shell history" ;;
    --token=*)      GH_TOKEN="${1#*=}"; shift ;;
    -h|--help)      sed -n '2,73p' "$0"; exit 0 ;;
    *)              echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
done

RAWBASE="https://raw.githubusercontent.com/$REPO/$SRC_BRANCH"

# ---------------------------------------------------------------- helpers
have() { command -v "$1" >/dev/null 2>&1; }
say()  { printf '%s\n' "$*"; }
note() { printf '%s\n' "$*" >> "$REPORT"; }
sec()  { note ""; note "## $*"; note ""; }

jstr() { tr -d ' \n' | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

gh_api() { # gh_api METHOD URL [JSON | @payload-file]
  local m="$1" u="$2" d="${3:-}"
  if [ -n "$d" ]; then
    case "$d" in
      @*) curl -sS --max-time 180 -X "$m" \
            -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
            -H "User-Agent: $PROTO" -H 'Content-Type: application/json' \
            --data-binary "$d" "$u" 2>&1 ;;
      *)  curl -sS --max-time 120 -X "$m" \
            -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
            -H "User-Agent: $PROTO" -H 'Content-Type: application/json' -d "$d" "$u" 2>&1 ;;
    esac
  else
    curl -sS --max-time 60 -X "$m" \
      -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' \
      -H "User-Agent: $PROTO" "$u" 2>&1
  fi
}

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
    -e 's/("?api[_-]?key"?[[:space:]]*[:=][[:space:]]*"?)[^",}[:space:]]{6,}/\1[REDACTED]/g'
}

# lighter pass for source uploads: real secret shapes only, code stays readable
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

# fetch <path-in-repo> <dest>   raw first, authenticated API as fallback
fetch() {
  local p="$1" d="$2" cb
  cb="$RANDOM$RANDOM"
  if curl -fsSL --connect-timeout 12 --max-time 60 -H 'Cache-Control: no-cache' \
       -o "$d" "$RAWBASE/$p?v=$cb" 2>/dev/null && [ -s "$d" ]; then
    return 0
  fi
  if curl -fsSL --connect-timeout 12 --max-time 60 \
       -H 'Accept: application/vnd.github.raw' \
       -o "$d" "$API/repos/$REPO/contents/$p?ref=$SRC_BRANCH" 2>/dev/null && [ -s "$d" ]; then
    return 0
  fi
  return 1
}

sha() { if have sha256sum; then sha256sum "$1" 2>/dev/null | cut -c1-16;
        elif have openssl; then openssl dgst -sha256 "$1" 2>/dev/null | cut -c1-16;
        else md5sum "$1" 2>/dev/null | cut -c1-16; fi; }

md5() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }

snapshot() {
  have tar || return 0
  mkdir -p "$STATE/snapshots" 2>/dev/null
  local f="$STATE/snapshots/$(date -u '+%Y%m%d-%H%M%S').tgz"
  tar -czf "$f" -C "$RUNDIR" . >/dev/null 2>&1 || rm -f "$f" 2>/dev/null
  ls -1t "$STATE/snapshots"/*.tgz 2>/dev/null | tail -n +6 | while read -r old; do rm -f "$old"; done
  SNAP="$f"
}

rollback() {
  local f
  f="$(ls -1t "$STATE/snapshots"/*.tgz 2>/dev/null | head -1)"
  if [ -z "$f" ]; then say "❌ no snapshot to roll back to"; return 1; fi
  say "↩️  restoring $f → $RUNDIR"
  mkdir -p "$RUNDIR" && tar -xzf "$f" -C "$RUNDIR" && say "✅ restored" || say "❌ restore failed"
}

# =====================================================================
#  identity / environment
# =====================================================================
SLUG="$( { uname -n 2>/dev/null; echo "${PREFIX:-}"; } | tr -c 'A-Za-z0-9' '-' | tr -s '-' | cut -c1-28 | sed 's/^-*//;s/-*$//' )"
[ -z "$SLUG" ] && SLUG="device"
RDIR="reports/$SLUG"

# where do YOUR sources live?
if [ -z "$SRCDIR" ]; then
  for c in "$PWD" "$HOME/storage/shared/codes" "/storage/emulated/0/codes" "$HOME/codes" "$HOME/deploy"; do
    if [ -f "$c/deploy.php" ] || [ -f "$c/scraper4.php" ]; then SRCDIR="$c"; break; fi
  done
fi
SRCDIR="${SRCDIR:-$PWD}"

case "$SRCDIR" in
  /sdcard/*|/storage/*|*/storage/shared/*|/mnt/sdcard/*|/mnt/media_rw/*) SRC_SHARED=1 ;;
  *) SRC_SHARED=0 ;;
esac

# =====================================================================
#  --rollback short-circuit
# =====================================================================
if [ "$DO_ROLLBACK" = 1 ]; then rollback; exit 0; fi

# =====================================================================
#  one round
# =====================================================================
round_once() {
  REPORT="$STATE/report.md"; LOG="$STATE/task.log"; TASKREPORT="$STATE/task-report.md"
  TASKF="$STATE/task.sh"; : > "$REPORT"; : > "$LOG"; : > "$TASKREPORT"
  SNAP=""

  say ""
  say "────────────────────────────────────────────────────────────"
  say "🤖 s4-agent v$AGENT_VERSION ($PROTO)  $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  say "   instructions: $REPO@$SRC_BRANCH:$OPS_DIR/   reports → $REPO@$REPORT_BRANCH:$RDIR/"
  say "   your sources: $SRCDIR   run dir: $RUNDIR"
  say "────────────────────────────────────────────────────────────"

  note "# Agent report — $SLUG"
  note ""
  note "- generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ') · agent v$AGENT_VERSION · protocol $PROTO"
  note "- instructions from: \`$REPO@$SRC_BRANCH:$OPS_DIR\`"
  note "- reports to: \`$REPO@$REPORT_BRANCH\` → \`$RDIR/\`"
  note "- srcdir: \`$SRCDIR\` (shared storage: $([ "$SRC_SHARED" = 1 ] && echo YES || echo no))"
  note "- rundir: \`$RUNDIR\`"
  note "- uname: $(uname -a 2>&1)"
  note "- php: $(have php && php -r 'echo PHP_VERSION." ".PHP_SAPI;' 2>/dev/null || echo MISSING)"
  note "- free space: $(df -h "$HOME" 2>/dev/null | tail -1 | tr -s ' ')"

  # ---- 1. what round is it? ------------------------------------------
  sec "1. Round"
  if ! fetch "$OPS_DIR/$ROUND_FILE" "$STATE/round.txt"; then
    note "- ❌ cannot fetch \`$OPS_DIR/$ROUND_FILE\` from $REPO@$SRC_BRANCH"
    say "❌ cannot fetch $OPS_DIR/$ROUND_FILE (network? branch? path?)"
    finish_report "fetch-failed" 1 "" ; return 3
  fi
  RID="$(head -1 "$STATE/round.txt" | tr -d '\r' | tr -c 'A-Za-z0-9._-' '-' | sed 's/^-*//;s/-*$//')"
  [ -z "$RID" ] && RID="unknown"
  LAST="$(cat "$STATE/last-round" 2>/dev/null | tr -d '\r\n')"
  note "- round id: \`$RID\`  (last executed: \`${LAST:-<none>}\`)"
  if [ "$RID" = "$LAST" ] && [ "$FORCE" = 0 ]; then
    say "⏸  no new round (still $RID). Waiting…"
    note "- ⏸ nothing to do: round id unchanged"
    finish_report "unchanged" 0 "$RID"; return 10
  fi

  # ---- 2. download the instructions ----------------------------------
  if ! fetch "$OPS_DIR/$TASK_FILE" "$TASKF"; then
    note "- ❌ cannot fetch \`$OPS_DIR/$TASK_FILE\`"
    say "❌ cannot fetch $OPS_DIR/$TASK_FILE"
    finish_report "fetch-failed" 1 "$RID"; return 3
  fi
  TSIZE=$(wc -c < "$TASKF" | tr -d ' '); TSHA=$(sha "$TASKF")
  note "- instructions: \`$OPS_DIR/$TASK_FILE\` · ${TSIZE} bytes · sha256:16=$TSHA"
  note "- first line: $(head -1 "$TASKF")"
  note ""
  note "<details><summary>round script as downloaded</summary>"
  note ""
  note '```sh'
  head -c 12000 "$TASKF" >> "$REPORT"
  note '```'
  note "</details>"

  # ---- 3. refuse-list ------------------------------------------------
  if grep -qE 'rm[[:space:]]+-[rf]{1,2}[[:space:]]+(/|/\*|~|\$HOME)([[:space:]]|$)|mkfs|dd[[:space:]].*of=/dev/[sh]d|:\(\)\{.*\};:|chmod[[:space:]]+-R[[:space:]]+000[[:space:]]+/' "$TASKF"; then
    note "- 🚨 REFUSED: the round script contains a destructive pattern; not executed."
    say "🚨 refused to run: destructive pattern in $OPS_DIR/$TASK_FILE"
    finish_report "refused" 1 "$RID"; return 3
  fi
  if ! bash -n "$TASKF" 2>"$STATE/syntax.err"; then
    note "- 🚨 round script has a bash syntax error; not executed:"
    sed 's/^/      /' "$STATE/syntax.err" >> "$REPORT"
    say "🚨 round script syntax error — see report"
    finish_report "syntax-error" 1 "$RID"; return 3
  fi

  if [ "$DRY" = 1 ]; then
    say "🔍 --dry-run: not executing. Script is in $TASKF"
    note "- --dry-run: script downloaded but NOT executed"
    finish_report "dry-run" 0 "$RID"; return 0
  fi

  # ---- 4. run dir + mirror -------------------------------------------
  sec "2. Run directory and mirrored sources"
  mkdir -p "$RUNDIR" "$STATE/backups" 2>/dev/null
  snapshot
  [ -n "$SNAP" ] && note "- snapshot before this round: \`$SNAP\` (\`--rollback\` restores it)"
  for f in $MIRROR_FILES; do
    if [ -f "$SRCDIR/$f" ]; then
      cp -f "$SRCDIR/$f" "$RUNDIR/$f" 2>/dev/null \
        && note "- mirrored \`$f\`: $(wc -c < "$RUNDIR/$f" | tr -d ' ') bytes · md5 $(md5 "$RUNDIR/$f") · $(date -r "$SRCDIR/$f" '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" \
        || note "- 🚨 copying \`$f\` into the run dir FAILED"
    else
      note "- \`$f\` not present in srcdir (skipped)"
    fi
  done
  if have php; then
    for f in $MIRROR_FILES; do
      [ -f "$RUNDIR/$f" ] || continue
      if php -l "$RUNDIR/$f" >"$STATE/lint.out" 2>&1; then
        note "- \`php -l $f\`: OK"
      else
        note "- 🚨 \`php -l $f\`: FAILED"
        sed 's/^/      /' "$STATE/lint.out" >> "$REPORT"
      fi
    done
  fi

  # ---- 5. helpers available to every round script --------------------
  write_helpers

  # ---- 6. execute ----------------------------------------------------
  sec "3. Round output (stdout+stderr, redacted)"
  say "▶️  running round \`$RID\` (timeout ${TASK_TIMEOUT}s, no token in env)…"
  START=$(date +%s)
  TMO=()
  have timeout && TMO=(timeout -k 15 "$TASK_TIMEOUT")
  ( cd "$RUNDIR" 2>/dev/null || cd "$HOME"
    env -u GH_TOKEN -u GITHUB_TOKEN -u GH_PAT -u TOKEN \
      S4_AGENT_VERSION="$AGENT_VERSION" S4_PROTO="$PROTO" S4_ROUND_ID="$RID" \
      S4_SRCDIR="$SRCDIR" S4_RUNDIR="$RUNDIR" S4_STATE="$STATE" \
      S4_HELPERS="$STATE/helpers.sh" S4_REPORT="$TASKREPORT" S4_LOG="$LOG" \
      S4_PORT="$PORT" S4_HOST_SLUG="$SLUG" S4_REPO="$REPO" S4_SRC_BRANCH="$SRC_BRANCH" \
      S4_RAWBASE="$RAWBASE" S4_MIRROR="$MIRROR_FILES" S4_SRC_SHARED="$SRC_SHARED" \
      HOME="$HOME" PATH="$PATH" TMPDIR="${TMPDIR:-/tmp}" PREFIX="${PREFIX:-}" \
      ${TMO[@]+"${TMO[@]}"} bash "$TASKF"
  ) >> "$LOG" 2>&1
  RC=$?
  END=$(date +%s)
  ELAPSED=$((END-START))
  STATUS="$(grep -o 'S4_ROUND_STATUS=[A-Za-z_-]*' "$LOG" 2>/dev/null | tail -1 | cut -d= -f2)"
  STATUS="${STATUS:-unset}"
  note "- exit code: $RC · elapsed: ${ELAPSED}s · declared status: **$STATUS**"
  if [ "$RC" = 124 ] || [ "$RC" = 137 ]; then
    note "- ⏰ the round hit the ${TASK_TIMEOUT}s timeout and was killed"
  fi
  note ""
  note '```'
  tail -c 60000 "$LOG" 2>/dev/null >> "$REPORT"
  note '```'
  if [ -s "$TASKREPORT" ]; then
    sec "4. Round report (structured notes from the round script)"
    tail -c 60000 "$TASKREPORT" >> "$REPORT"
  fi

  # ---- 7. post-run evidence -----------------------------------------
  sec "5. State after the round"
  note "- run dir contents:"
  ls -la "$RUNDIR" 2>&1 | head -40 | sed 's/^/      /' >> "$REPORT"
  if [ -s "$RUNDIR/php-error.log" ]; then
    note "- \`php-error.log\` tail:"
    tail -40 "$RUNDIR/php-error.log" 2>/dev/null | sed 's/^/      /' >> "$REPORT"
  fi
  if [ -f "$STATE/server.pid" ] && kill -0 "$(cat "$STATE/server.pid" 2>/dev/null)" 2>/dev/null; then
    note "- ✅ a local server is STILL RUNNING (pid $(cat "$STATE/server.pid")) on 127.0.0.1:$PORT"
    note "- probe \`deploy.php\`:"
    curl -sS --max-time 20 -o "$STATE/probe.out" -w '      http=%{http_code} bytes=%{size_download} time=%{time_total}s\n' \
      "http://127.0.0.1:$PORT/deploy.php" >> "$REPORT" 2>&1
    head -c 700 "$STATE/probe.out" 2>/dev/null | sed 's/^/      /' >> "$REPORT"
  else
    note "- no server left running (round scripts should stop what they start, unless the round is meant to leave the app up)"
  fi
  for f in $MIRROR_FILES; do
    [ -f "$RUNDIR/$f" ] || continue
    note "- \`$f\` after: $(wc -c < "$RUNDIR/$f" | tr -d ' ') bytes · md5 $(md5 "$RUNDIR/$f")"
    if [ -f "$SRCDIR/$f" ] && [ "$(md5 "$SRCDIR/$f")" != "$(md5 "$RUNDIR/$f")" ]; then
      note "  - ⚠️ differs from your copy in srcdir (md5 $(md5 "$SRCDIR/$f")) — the round modified it in the run dir only"
    fi
  done

  finish_report "$STATUS" "$RC" "$RID"
  echo "$RID" > "$STATE/last-round" 2>/dev/null
  case "$STATUS" in
    success) return 0 ;;
    failed)  return 2 ;;
    *)       return 1 ;;
  esac
}

# ---------------------------------------------------------------------
write_helpers() {
  cat > "$STATE/helpers.sh" <<'HELPERS'
# =====================================================================
#  helpers.sh — stable toolkit for every round script (protocol s4-agent/1)
#
#  Provided env: S4_ROUND_ID S4_SRCDIR S4_RUNDIR S4_STATE S4_HELPERS
#                S4_REPORT S4_LOG S4_PORT S4_HOST_SLUG S4_REPO
#                S4_SRC_BRANCH S4_RAWBASE S4_MIRROR S4_SRC_SHARED
#
#  stdout  → the agent captures it verbatim as "Round output"
#  $S4_REPORT → extra detail the agent uploads as "Round report"
#  Keep stdout SHORT (it is the summary a human reads); put long listings,
#  file heads and log tails into $S4_REPORT with s4_note.
#
#  Every round script SHOULD end with:  s4_done success|failed|needs-input
# =====================================================================
s4_say()  { printf '%s\n' "$*"; }
s4_note() { printf '%s\n' "$*" >> "$S4_REPORT"; }
s4_hr()   { s4_say "----------------------------------------------------------------"; }
s4_md5()  { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }
s4_size() { wc -c < "$1" 2>/dev/null | tr -d ' '; }
s4_have() { command -v "$1" >/dev/null 2>&1; }

# php with the settings this device needs (opcache off = the server can start)
S4_PHP_OPTS="-d opcache.enable=0 -d opcache.enable_cli=0 -d display_errors=0 -d log_errors=1 -d error_log=$S4_RUNDIR/php-error.log -d memory_limit=512M"
s4_php() { php $S4_PHP_OPTS "$@"; }

s4_lint() { # s4_lint <file>
  [ -f "$1" ] || { s4_say "lint: $1 MISSING"; return 1; }
  s4_have php || { s4_say "lint: php not installed — cannot lint $1"; return 1; }
  if php -l "$1" > "$S4_STATE/lint.out" 2>&1; then
    s4_say "lint OK: $(basename "$1") ($(s4_size "$1") bytes, md5 $(s4_md5 "$1"))"
    return 0
  fi
  s4_say "🚨 lint FAILED: $(basename "$1")"
  s4_note "php -l $1:"; sed 's/^/    /' "$S4_STATE/lint.out" >> "$S4_REPORT"
  return 1
}

s4_backup() { # s4_backup <file> → copy kept in $S4_STATE/backups
  [ -f "$1" ] || return 0
  mkdir -p "$S4_STATE/backups" 2>/dev/null
  cp -p "$1" "$S4_STATE/backups/$(date -u '+%Y%m%d-%H%M%S')-$(basename "$1")" 2>/dev/null \
    && s4_say "backup: $(basename "$1") saved" || s4_say "🚨 backup FAILED: $1"
}

s4_patch() { # s4_patch <file> <sed args…>  (backs up first, re-lints after)
  local f="$1"; shift
  s4_backup "$f"
  if sed -i "$@" "$f" 2>>"$S4_REPORT"; then
    s4_say "patched $(basename "$f"): sed $*"
    if ! php -l "$f" >/dev/null 2>&1; then
      s4_say "🚨 $(basename "$f") no longer parses after the patch"
      s4_note "post-patch lint output for $f:"; php -l "$f" 2>&1 | sed 's/^/    /' >> "$S4_REPORT"
    fi
  else
    s4_say "🚨 sed failed on $f"
  fi
}

s4_write() { # s4_write <file>  (stdin → file, atomic; verifies writability)
  local f="$1" t="$1.s4tmp.$$"
  if cat > "$t" 2>>"$S4_REPORT" && mv -f "$t" "$f" 2>>"$S4_REPORT"; then
    s4_say "wrote $f ($(s4_size "$f") bytes)"; return 0
  fi
  rm -f "$t" 2>/dev/null; s4_say "🚨 CANNOT WRITE $f"; return 1
}

s4_need_php() { s4_have php && return 0; s4_say "⚠️  php not installed — skipping"; return 1; }

s4_try_server() { # s4_try_server "<extra php -d opts>" <port> <docroot> <label>
  local opts="$1" p="$2" root="$3" lab="${4:-test}" pid log
  log="$S4_STATE/srv-$p.log"
  s4_need_php || return 1
  ( cd "$root" 2>/dev/null && php $opts -d memory_limit=512M -S "127.0.0.1:$p" -t "$root" > "$log" 2>&1 ) &
  pid=$!
  sleep 3
  if kill -0 "$pid" 2>/dev/null; then
    s4_say "✅ server UP   [$lab] php $opts -S 127.0.0.1:$p -t $root"
    kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; return 0
  fi
  s4_say "❌ server DEAD [$lab] php $opts -S 127.0.0.1:$p -t $root"
  s4_note "log of the dead server [$lab]:"
  tail -8 "$log" 2>/dev/null | sed 's/^/    /' >> "$S4_REPORT"
  wait "$pid" 2>/dev/null
  return 1
}

s4_serve() { # s4_serve "<extra opts>" <port> <docroot> → leaves it running
  local opts="$1" p="$2" root="$3" log="$S4_STATE/server.log"
  s4_need_php || return 1
  mkdir -p "$root" 2>/dev/null
  ( cd "$root" 2>/dev/null && php $opts -d memory_limit=512M -S "127.0.0.1:$p" -t "$root" > "$log" 2>&1 ) &
  echo $! > "$S4_STATE/server.pid"
  sleep 3
  if kill -0 "$(cat "$S4_STATE/server.pid")" 2>/dev/null; then
    s4_say "🌐 serving $root → http://127.0.0.1:$p (pid $(cat "$S4_STATE/server.pid"), log $log)"
    return 0
  fi
  s4_say "🚨 server did not start; log tail:"
  tail -10 "$log" 2>/dev/null | sed 's/^/    /'
  s4_note "server.log:"; tail -20 "$log" 2>/dev/null | sed 's/^/    /' >> "$S4_REPORT"
  rm -f "$S4_STATE/server.pid"; return 1
}

s4_stop_server() {
  [ -f "$S4_STATE/server.pid" ] || return 0
  kill "$(cat "$S4_STATE/server.pid")" 2>/dev/null && s4_say "server stopped"
  rm -f "$S4_STATE/server.pid"
}

s4_curl() { # s4_curl <url> [bytes-of-body-to-upload]
  local u="$1" n="${2:-700}" o="$S4_STATE/curl.out" w
  w=$(curl -sS --max-time 25 -o "$o" -w 'http=%{http_code} bytes=%{size_download} time=%{time_total}s' "$u" 2>&1)
  s4_say "GET $u → $w"
  { s4_note "--- $u → $w"
    head -c "$n" "$o" 2>/dev/null | sed 's/^/    /' >> "$S4_REPORT"; s4_note ""; } 2>/dev/null
  head -c "$n" "$o" 2>/dev/null | sed 's/^/    /' >> "$S4_REPORT"
}

s4_ls() { # s4_ls <dir>
  s4_say "ls $1: $(ls -1 "$1" 2>/dev/null | wc -l | tr -d ' ') entries"
  s4_note "ls -la $1:"; ls -la "$1" 2>&1 | head -40 | sed 's/^/    /' >> "$S4_REPORT"
}

s4_tail() { # s4_tail <file> [lines]
  local n="${2:-40}"
  s4_say "tail -${n} $1 ($(s4_size "$1" 2>/dev/null || echo 0) bytes)"
  s4_note "tail -$n $1:"; tail -"$n" "$1" 2>/dev/null | sed 's/^/    /' >> "$S4_REPORT"
}

s4_head() { # s4_head <file> [lines]
  local n="${2:-40}"
  s4_say "head -${n} $1"
  s4_note "head -$n $1:"; head -"$n" "$1" 2>/dev/null | sed 's/^/    /' >> "$S4_REPORT"
}

s4_grep() { # s4_grep <pattern> <file>
  local c
  c=$(grep -c -- "$1" "$2" 2>/dev/null | head -1); c=${c:-0}
  s4_say "grep '$1' in $(basename "$2"): ${c} hit(s)"
  s4_note "grep -n '$1' $2:"
  grep -n -- "$1" "$2" 2>/dev/null | head -12 | sed 's/^/    /' >> "$S4_REPORT"
}

# capability probe for one directory: write / chmod / rename / flock / exec
s4_probe_dir() { # s4_probe_dir <dir> <label>
  local d="$1" lab="${2:-$1}" pf="$1/.s4probe.$$" r
  s4_hr; s4_say "probe [$lab] $d"
  [ -d "$d" ] || { s4_say "  not a directory"; return 1; }
  s4_note "probe $d ($lab): ls -ld → $(ls -ld "$d" 2>&1) · fs → $(df "$d" 2>/dev/null | tail -1 | tr -s ' ')"
  if printf 'x' > "$pf" 2>/dev/null; then
    s4_say "  write: OK"
    chmod 0600 "$pf" 2>/dev/null && s4_say "  chmod: OK" || s4_say "  chmod: FAILED"
    if s4_have php; then
      r=$(php -r '$f=@fopen($argv[1],"c+"); if(!$f){echo "open-FAILED";exit;} echo flock($f,LOCK_EX|LOCK_NB)?"OK":"FAILED"; flock($f,LOCK_UN); fclose($f);' "$pf" 2>&1)
      s4_say "  flock: $r"
    else
      s4_say "  flock: n/a (php not installed)"
    fi
    mv "$pf" "$pf.2" 2>/dev/null && s4_say "  rename: OK" || s4_say "  rename: FAILED"
    rm -f "$pf" "$pf.2" 2>/dev/null
  else
    s4_say "  write: FAILED (nothing can be created here)"
  fi
}

s4_dl() { # s4_dl <repo-path> <dest>
  curl -fsSL --max-time 60 -o "$2" "$S4_RAWBASE/$1" 2>>"$S4_REPORT" \
    && s4_say "downloaded $1 → $2 ($(s4_size "$2") bytes)" \
    || s4_say "🚨 download failed: $1"
}

s4_done() { echo "S4_ROUND_STATUS=${1:-needs-input}"; }
HELPERS
}

# ---------------------------------------------------------------------
finish_report() { # finish_report <status> <rc> <rid>
  local st="$1" rc="$2" rid="${3:-}"
  sec "6. Verdict"
  note "- round: \`${rid:-<none>}\` · exit $rc · status **$st**"
  if [ "$st" = success ]; then
    note "- ✅ this round declares success — the agent stops looping."
  else
    note "- ⏭ waiting for the next round: the agent on GitHub reads this report and pushes a new \`$OPS_DIR/round.txt\` + \`$OPS_DIR/$TASK_FILE\`."
  fi
  note ""
  note "---"
  note "_s4-agent v$AGENT_VERSION ($PROTO). Secrets redacted; your source folder is never modified in place — the agent works on a mirror in \`$RUNDIR\`._"

  say ""
  say "──────────────────────── report ────────────────────────"
  redact < "$REPORT" | head -c "$MAXB" > "$STATE/report.clean.md"
  cat "$STATE/report.clean.md"
  say "────────────────────────────────────────────────────────"

  if [ "$NO_UPLOAD" = 1 ]; then say "ℹ️  --no-upload: nothing was sent."; return 0; fi
  upload "$st" "$rid" "$rc"
}

# ---------------------------------------------------------------------
upload() { # upload <status> <rid> <rc>
  local st="$1" rid="${2:-round}" rc="${3:-0}"
  TOKFILE="$STATE/token"
  if [ -z "$GH_TOKEN" ] && [ -f "$TOKFILE" ]; then
    GH_TOKEN="$(tr -d ' \n\r' < "$TOKFILE" 2>/dev/null)"
  fi
  if [ -z "$GH_TOKEN" ]; then
    printf 'GitHub token (fine-grained, Contents: Read+write on %s). Input hidden: ' "$REPO"
    if [ -t 0 ]; then stty -echo 2>/dev/null; read -r GH_TOKEN; stty echo 2>/dev/null; else read -r GH_TOKEN; fi
    printf '\n'
  fi
  if [ -z "$GH_TOKEN" ]; then say "❌ no token → cannot upload (report is on screen above)"; return 1; fi
  if [ "$SAVE_TOKEN" = 1 ]; then
    mkdir -p "$STATE" 2>/dev/null
    printf '%s' "$GH_TOKEN" > "$TOKFILE" && chmod 600 "$TOKFILE" 2>/dev/null && say "🔐 token saved to $TOKFILE (chmod 600)"
  fi

  ME=$(gh_api GET "$API/user" | jstr login)
  if [ -z "$ME" ]; then say "❌ token rejected by GET /user"; return 1; fi
  PERM=$(gh_api GET "$API/repos/$REPO" | tr -d ' \n' | grep -o '"permissions":{[^}]*}' | head -1)
  case "$PERM" in
    *'"push":true'*) say "🔑 token OK as '$ME' · push access ✅" ;;
    '')              say "⚠️  cannot read $REPO with this token" ;;
    *)               say "❌ token for '$ME' has no push access to $REPO"; return 1 ;;
  esac

  say "⬆️  uploading to ${REPO}@${REPORT_BRANCH}:${RDIR}/"
  REF=$(gh_api GET "$API/repos/$REPO/git/ref/heads/$REPORT_BRANCH")
  PARENT=$(printf '%s' "$REF" | jstr sha)
  CREATED=0
  if [ -z "$PARENT" ]; then
    DEF=$(gh_api GET "$API/repos/$REPO" | jstr default_branch)
    [ -z "$DEF" ] && { say "❌ cannot read repo $REPO"; return 1; }
    PARENT=$(gh_api GET "$API/repos/$REPO/git/ref/heads/$DEF" | jstr sha)
    CREATED=1
    say "   branch '$REPORT_BRANCH' does not exist → creating from '$DEF'"
  fi
  [ -z "$PARENT" ] && { say "❌ no parent commit sha"; return 1; }

  BASETREE=$(gh_api GET "$API/repos/$REPO/git/commits/$PARENT" | tr -d ' \n' \
    | grep -o '"tree":{"sha":"[0-9a-f]\{40\}"' | head -1 | sed 's/.*"sha":"//; s/"$//')
  [ -z "$BASETREE" ] && { say "❌ cannot read base tree of $PARENT"; return 1; }

  blob() { # blob <localfile> → sha on stdout   (payload via file: no arg-length limit)
    local pf="$STATE/blob.json"
    { printf '{"content":"'
      base64 < "$1" | tr -d '\n'
      printf '","encoding":"base64"}'
    } > "$pf"
    gh_api POST "$API/repos/$REPO/git/blobs" "@$pf" | jstr sha
  }
  entry() { # entry <repo-path> <localfile> → appends to TREE_ENTRIES
    local s
    s=$(blob "$2")
    if [ -z "$s" ]; then say "   ⚠️  blob upload failed for $1"; return 1; fi
    TREE_ENTRIES="${TREE_ENTRIES:+$TREE_ENTRIES,}$(printf '{"path":"%s","mode":"100644","type":"blob","sha":"%s"}' "$1" "$s")"
    say "   + $1 ($(wc -c < "$2" | tr -d ' ') bytes)"
  }

  TREE_ENTRIES=""
  entry "$RDIR/LATEST.md"        "$STATE/report.clean.md"
  entry "$RDIR/round-${rid}.md"  "$STATE/report.clean.md"
  printf '{"slug":"%s","round":"%s","status":"%s","exit":%s,"agent":"%s","proto":"%s","ts":"%s","srcdir":"%s","rundir":"%s","shared_storage":%s}\n' \
    "$SLUG" "$rid" "$st" "${rc:-0}" "$AGENT_VERSION" "$PROTO" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    "$(printf '%s' "$SRCDIR" | tr -d '"\\')" "$(printf '%s' "$RUNDIR" | tr -d '"\\')" \
    "$([ "$SRC_SHARED" = 1 ] && echo true || echo false)" > "$STATE/status.json"
  entry "$RDIR/status.json"      "$STATE/status.json"
  if [ "$WITH_SRC" = 1 ] && [ -f "$RUNDIR/deploy.php" ]; then
    { printf '### uploaded by s4-agent v%s ###\n### source of %s (secrets redacted) ###\n\n' "$AGENT_VERSION" "$SRCDIR/deploy.php"
      redact_src < "$RUNDIR/deploy.php" | head -c "$SRCMAX"; } > "$STATE/src.txt"
    entry "$RDIR/deploy.php.txt" "$STATE/src.txt"
  fi
  [ -z "$TREE_ENTRIES" ] && { say "❌ nothing to commit"; return 1; }

  NEWSHA=$(gh_api POST "$API/repos/$REPO/git/trees" \
    "$(printf '{"base_tree":"%s","tree":[%s]}' "$BASETREE" "$TREE_ENTRIES")" | jstr sha)
  [ -z "$NEWSHA" ] && { say "❌ tree creation failed"; return 1; }
  NEWCOMMIT=$(gh_api POST "$API/repos/$REPO/git/commits" \
    "$(printf '{"message":"report(%s): round %s — %s","tree":"%s","parents":["%s"]}' "$SLUG" "$rid" "$st" "$NEWSHA" "$PARENT")" | jstr sha)
  [ -z "$NEWCOMMIT" ] && { say "❌ commit creation failed"; return 1; }
  if [ "$CREATED" = 1 ]; then
    R=$(gh_api POST "$API/repos/$REPO/git/refs" "$(printf '{"ref":"refs/heads/%s","sha":"%s"}' "$REPORT_BRANCH" "$NEWCOMMIT")")
  else
    R=$(gh_api PATCH "$API/repos/$REPO/git/refs/heads/$REPORT_BRANCH" "$(printf '{"sha":"%s","force":false}' "$NEWCOMMIT")")
  fi
  if printf '%s' "$R" | grep -q '"message"'; then
    say "❌ ref update failed: $(printf '%s' "$R" | head -c 200)"; return 1
  fi
  say ""
  say "✅ report uploaded: commit ${NEWCOMMIT:0:10} · status=$st"
  say "   https://github.com/$REPO/blob/$REPORT_BRANCH/$RDIR/LATEST.md"
  say "   https://github.com/$REPO/blob/$REPORT_BRANCH/$RDIR/status.json"
  say ""
  say "Tell the agent: \"report uploaded\" — it reads $RDIR/LATEST.md through the GitHub API."
}

# =====================================================================
#  main
# =====================================================================
if [ "$MODE" = loop ]; then
  say "🔁 loop mode: polling $REPO@$SRC_BRANCH:$OPS_DIR/$ROUND_FILE every ${POLL}s (Ctrl+C stops)"
  N=0; HARD=0
  while :; do
    N=$((N+1))
    round_once; RC=$?
    case "$RC" in
      0) say "🏁 success — loop finished after $N round(s)"; exit 0 ;;
      3) HARD=$((HARD+1))
         if [ "$HARD" -ge 5 ]; then
           say "❌ 5 hard failures in a row (network? branch? ops/ path?) — stopping the loop"
           exit 3
         fi
         say "⚠️  hard failure ($HARD/5) — backing off 120 s"
         sleep 120; continue ;;
      *) HARD=0 ;;
    esac
    if [ "$MAX_ROUNDS" -gt 0 ] && [ "$N" -ge "$MAX_ROUNDS" ]; then
      say "🛑 --max-rounds $MAX_ROUNDS reached"; exit 0
    fi
    sleep "$POLL" 2>/dev/null || sleep 30
  done
else
  round_once; RC=$?
  case "$RC" in
    0|1|10) exit 0 ;;     # success, ran-and-waiting, nothing-new are all "fine"
    *)      exit "$RC" ;;
  esac
fi
