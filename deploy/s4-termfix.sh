#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  s4-termfix.sh  v1.0.0  --  why does the code-server terminal die?
#
#  Symptom this tool exists for (VS Code / code-server popup):
#
#     The terminal process "/data/data/com.termux/files/usr/bin/bash"
#     terminated with exit code: 1.
#
#  That message means the SHELL PROCESS exited 1, not that a command you
#  typed returned 1.  On Termux there are exactly five families of cause,
#  and they look identical in the popup, so this script tests all of them
#  and prints which one it is:
#
#    A. A startup file kills the shell.  The default profile is a LOGIN
#       shell (bash -l), so $PREFIX/etc/profile, ~/.bash_profile,
#       ~/.bash_login, ~/.profile and ~/.bashrc are all read.  Any of them
#       containing `exit`, `set -e` plus a failing command, or
#       `exec <shell that is not installed>` ends the shell immediately.
#    B. The environment is stripped.  If code-server was started from a
#       boot script, a runit service or `nohup` with a minimal env, the
#       terminal inherits no PREFIX, no Termux PATH and no TMPDIR.  Every
#       command in the startup files then fails ("command not found") and
#       a `set -e` in there turns that into exit 1.
#    C. The terminal's working directory does not exist.  code-server uses
#       the opened workspace folder as the terminal cwd.  If that is
#       ~/storage/shared/... and Termux storage permission was revoked, the
#       path is a dangling symlink: spawn fails, exit 1.
#    D. The pty stack is broken: /dev/ptmx unreachable, or node-pty's
#       spawn-helper is not executable (this one usually says
#       "permission denied" instead, but a noexec mount gives exit 1).
#    E. Resources: no free disk, no free pids, no file descriptors.
#
#  Usage
#    curl -fsSL -o ~/s4-termfix.sh \
#      https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-termfix.sh
#    bash ~/s4-termfix.sh                # diagnose AND repair
#    bash ~/s4-termfix.sh --report-only  # diagnose, change nothing
#    bash ~/s4-termfix.sh --safe-profile # force the no-rc-files profile
#    bash ~/s4-termfix.sh --json         # machine readable verdict
#    bash ~/s4-termfix.sh --selftest     # offline test of this script
#
#  All output is plain ASCII English.  Every verdict is on a line that
#  starts with an uppercase marker (SHELL_LAYER_BAD=, RC_BAD=, CWD_BAD=,
#  ENV_STRIPPED=, PTY_FAIL, S4_TERMFIX=) so it can be grepped or pasted.
# =====================================================================
VERSION="1.0.0"
set -u

PFX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
BASE="$HOME_DIR/.s4-remote"
SETTINGS_DIR="$HOME_DIR/.local/share/code-server/User"
SETTINGS="$SETTINGS_DIR/settings.json"
REPORT="$BASE/termfix-report.txt"
WORK=""
SAFE_PROFILE=0
JSON_ONLY=0
SELFTEST=0
ACT="fix"

# The shell under test.  On a device that is Termux bash; anywhere else we
# fall back to whatever bash exists so this script stays testable.
if [ -x "$PFX/bin/bash" ]; then
  SHELL_BIN="$PFX/bin/bash"
else
  SHELL_BIN="$(command -v bash 2>/dev/null || echo /bin/bash)"
fi
SHELL_BIN="${S4_SHELL:-$SHELL_BIN}"

while [ $# -gt 0 ]; do
  case "$1" in
    --report-only|-n) ACT="report"; shift ;;
    --fix)            ACT="fix"; shift ;;
    --safe-profile)   SAFE_PROFILE=1; shift ;;
    --json)           JSON_ONLY=1; shift ;;
    --selftest)       SELFTEST=1; shift ;;
    --shell)          SHELL_BIN="${2:-$SHELL_BIN}"; shift 2 ;;
    --workspace|--cwd) WORK="${2:-}"; shift 2 ;;
    --settings)       SETTINGS="${2:-$SETTINGS}"; SETTINGS_DIR="$(dirname "$SETTINGS")"; shift 2 ;;
    -h|--help)        sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -v|--version)     echo "s4-termfix $VERSION"; exit 0 ;;
    *) echo "s4-termfix: unknown option: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$BASE" 2>/dev/null || true
REPORT_TMP="$BASE/.termfix-report.$$"
: > "$REPORT_TMP" 2>/dev/null || REPORT_TMP="/dev/null"

have() { command -v "$1" >/dev/null 2>&1; }

# every line goes to the screen and into the report file
say() {
  printf '%s\n' "$*"
  [ "$REPORT_TMP" = /dev/null ] || printf '%s\n' "$*" >> "$REPORT_TMP"
}
sec() { say ""; say "== $* =="; }
warn() { say "  WARN  $*"; }
hr() { say "------------------------------------------------------------"; }

# run something with a time limit if coreutils timeout exists
limited() {
  local secs="$1"; shift
  if have timeout; then timeout "$secs" "$@"; else "$@"; fi
}

# -------------------------------------------------------------- findings
BAD_LAYER=""
BAD_LAYER_OUT=""
RC_BAD=""
CWD_BAD=""
ENV_STRIPPED="no"
PTY_VERDICT="untested"
CAUSE=""
VERDICT="healthy"
FIXES=""

note_fix() { FIXES="$FIXES | $1"; say "  FIXED  $1"; }

# =====================================================================
# 1. shell startup layers -- pinpoints WHICH file kills the shell
# =====================================================================
probe_layer() {  # probe_layer <label> <flag> <flag> ...
  local label="$1"; shift
  local out rc
  out="$( { limited 12 "$SHELL_BIN" "$@" -c 'printf S4_LAYER_OK'; } 2>&1 )"; rc=$?
  case "$out" in
    *S4_LAYER_OK*)
      if [ "$rc" = 0 ]; then
        say "  $(printf '%-34s' "$label") exit=0  ok"
      else
        say "  $(printf '%-34s' "$label") exit=$rc  printed ok but exited non-zero"
        [ -z "$BAD_LAYER" ] && { BAD_LAYER="$label"; BAD_LAYER_OUT="$out"; }
      fi
      ;;
    *)
      say "  $(printf '%-34s' "$label") exit=$rc  NO OUTPUT"
      [ -z "$BAD_LAYER" ] && { BAD_LAYER="$label"; BAD_LAYER_OUT="$out"; }
      ;;
  esac
}

section_layers() {
  sec "1  shell startup layers (what code-server actually runs)"
  say "  shell under test: $SHELL_BIN"
  if [ ! -x "$SHELL_BIN" ]; then
    say "  SHELL_MISSING=$SHELL_BIN  (this alone explains exit code 1)"
    BAD_LAYER="shell-missing"; CAUSE="shell-missing"
    return 0
  fi
  probe_layer "bash -c        (no rc files)"
  probe_layer "bash --norc --noprofile -ic" --norc --noprofile -i
  probe_layer "bash -ic       (~/.bashrc)" -i
  probe_layer "bash -lc       (login files)" -l
  probe_layer "bash -lic      (terminal)" -l -i
  if [ -n "$BAD_LAYER" ]; then
    say "  SHELL_LAYER_BAD=$BAD_LAYER"
    say "  output of that layer (first 300 chars):"
    printf '%s\n' "$BAD_LAYER_OUT" | head -c 300 | sed 's/^/      /'
    say ""
  else
    say "  SHELL_LAYER_BAD=none  (every layer starts cleanly)"
  fi
}

# =====================================================================
# 2. each startup file sourced alone -- names the exact culprit
# =====================================================================
probe_file() {  # probe_file <path>
  local f="$1"
  local out rc
  if [ ! -e "$f" ]; then say "  $(printf '%-46s' "$f") absent"; return 0; fi
  if [ -L "$f" ] && [ ! -e "$f" ]; then
    say "  $(printf '%-46s' "$f") DANGLING SYMLINK"
    [ -z "$RC_BAD" ] && RC_BAD="$f"
    return 0
  fi
  out="$( { limited 12 "$SHELL_BIN" --norc --noprofile -c ". '$f'; printf S4_FILE_OK"; } 2>&1 )"; rc=$?
  if [ -x "$SHELL_BIN" ] && have_bash_n; then
    if ! "$SHELL_BIN" -n "$f" >/dev/null 2>&1; then
      say "  $(printf '%-46s' "$f") SYNTAX ERROR"
      [ -z "$RC_BAD" ] && RC_BAD="$f"
      return 0
    fi
  fi
  case "$out" in
    *S4_FILE_OK*)
      if [ "$rc" = 0 ]; then
        say "  $(printf '%-46s' "$f") ok"
      else
        say "  $(printf '%-46s' "$f") exit=$rc after sourcing"
        [ -z "$RC_BAD" ] && RC_BAD="$f"
      fi
      ;;
    *)
      say "  $(printf '%-46s' "$f") KILLS THE SHELL (exit=$rc)"
      printf '%s\n' "$out" | head -c 300 | sed 's/^/        /'
      [ -z "$RC_BAD" ] && RC_BAD="$f"
      ;;
  esac
  # things that are legal but fatal in a login shell
  if grep -nE '(^|[^#])\b(exit|exec)[[:space:]]' "$f" >/dev/null 2>&1; then
    say "        suspicious line(s):"
    grep -nE '(^|[^#])\b(exit|exec)[[:space:]]' "$f" 2>/dev/null | head -4 | sed 's/^/          /'
  fi
  if grep -nq 'set -e' "$f" 2>/dev/null; then
    say "        contains 'set -e': any failing command ends the shell"
  fi
}

have_bash_n() { [ -x "$SHELL_BIN" ]; }

section_files() {
  sec "2  startup files, sourced one by one"
  probe_file "$PFX/etc/profile"
  local d
  for d in "$PFX/etc/profile.d"/*.sh; do
    [ -f "$d" ] && probe_file "$d"
  done
  probe_file "$HOME_DIR/.bash_profile"
  probe_file "$HOME_DIR/.bash_login"
  probe_file "$HOME_DIR/.profile"
  probe_file "$HOME_DIR/.bashrc"
  if [ -n "$RC_BAD" ]; then
    say "  RC_BAD=$RC_BAD"
    [ -z "$CAUSE" ] && CAUSE="startup-file"
  else
    say "  RC_BAD=none"
  fi
}

# =====================================================================
# 3. environment -- ours, and the one code-server will hand the terminal
# =====================================================================
proc_environ_of() {  # proc_environ_of <pid>  -> tr-separated KEY=VALUE lines
  local pid="$1"
  [ -r "/proc/$pid/environ" ] || return 1
  tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null
}

find_pids() {  # find_pids <substring of cmdline>
  local pat="$1" d c pid out=""
  for d in /proc/[0-9]*; do
    pid="${d#/proc/}"
    [ "$pid" = "$$" ] && continue
    c="$(tr '\0' ' ' < "$d/cmdline" 2>/dev/null)"
    case "$c" in *"$pat"*) out="$out $pid" ;; esac
  done
  printf '%s' "$out"
}

section_env() {
  sec "3  environment"
  say "  HOME=${HOME_DIR}"
  say "  PREFIX=${PREFIX:-<UNSET>}"
  say "  TMPDIR=${TMPDIR:-<UNSET>}"
  say "  SHELL=${SHELL:-<UNSET>}"
  say "  TERM=${TERM:-<UNSET>}"
  case ":$PATH:" in
    *":$PFX/bin:"*) say "  PATH contains $PFX/bin: yes" ;;
    *) say "  PATH contains $PFX/bin: NO"; ENV_STRIPPED="yes" ;;
  esac
  [ -n "${PREFIX:-}" ] || ENV_STRIPPED="yes"

  # the definitive evidence: what the running code-server has in its env,
  # because the pty host copies it into every terminal it spawns
  local pids pid seen=0
  pids="$(find_pids code-server)"
  for pid in $pids; do
    seen=1
    say "  code-server pid=$pid"
    local e
    e="$(proc_environ_of "$pid")"
    if [ -z "$e" ]; then say "    (environ not readable)"; continue; fi
    printf '%s\n' "$e" | grep -E '^(HOME|PREFIX|TMPDIR|SHELL|TERM|PATH|LD_LIBRARY_PATH)=' \
      | sed 's/^/    /'
    if ! printf '%s\n' "$e" | grep -q "^PREFIX="; then
      say "    PREFIX is missing in the code-server env -> ENV_STRIPPED=yes"
      ENV_STRIPPED="yes"
    fi
    if ! printf '%s\n' "$e" | grep -q "^PATH=.*$PFX/bin"; then
      say "    Termux bin is missing from its PATH -> ENV_STRIPPED=yes"
      ENV_STRIPPED="yes"
    fi
    # the folder it opened is the terminal cwd
    local cwd_arg
    cwd_arg="$(tr '\0' '\n' < "/proc/$pid/cmdline" 2>/dev/null | tail -3 | grep '^/' | tail -1)"
    [ -n "${cwd_arg:-}" ] && say "    opened folder (terminal cwd): $cwd_arg" && WORK="${WORK:-$cwd_arg}"
    break
  done
  [ "$seen" = 1 ] || say "  code-server is not running right now"

  say "  ENV_STRIPPED=$ENV_STRIPPED"
  if [ "$ENV_STRIPPED" = yes ] && [ -z "$CAUSE" ]; then CAUSE="stripped-environment"; fi
}

# =====================================================================
# 4. pty stack
# =====================================================================
section_pty() {
  sec "4  pty stack"
  if [ -e /dev/ptmx ]; then
    if [ -r /dev/ptmx ] && [ -w /dev/ptmx ]; then
      say "  /dev/ptmx: present, readable+writable"
    else
      say "  /dev/ptmx: present but NOT usable (PTY_FAIL no pty device)"
      PTY_VERDICT="fail"; [ -z "$CAUSE" ] && CAUSE="pty-device"
    fi
  else
    say "  /dev/ptmx: MISSING (PTY_FAIL no pty device)"
    PTY_VERDICT="fail"; [ -z "$CAUSE" ] && CAUSE="pty-device"
  fi

  local roots found=0 noexec_cnt=0 h
  roots="$HOME_DIR/.local/share/code-server $HOME_DIR/.local/lib $PFX/lib $PFX/share"
  for h in $(find $roots -name 'spawn-helper' -type f 2>/dev/null | head -20); do
    found=$((found + 1))
    if [ -x "$h" ]; then
      say "  spawn-helper: executable  $(ls -l "$h" 2>/dev/null | awk '{print $1}')  $h"
    else
      say "  spawn-helper: NOT executable  $(ls -l "$h" 2>/dev/null | awk '{print $1}')  $h"
      [ "$ACT" = fix ] && { chmod 755 "$h" 2>/dev/null && note_fix "chmod 755 $h"; }
    fi
  done
  [ "$found" = 0 ] && say "  spawn-helper: none found under $roots (node-pty may be missing)"

  # does the install sit on a noexec mount?
  local mnt
  for mnt in "$HOME_DIR" "$PFX"; do
    local dev flags
    dev="$(df "$mnt" 2>/dev/null | awk 'NR==2{print $1}')"
    flags="$(awk -v d="$mnt" '$2==d {print $4; exit}' /proc/mounts 2>/dev/null)"
    [ -z "$flags" ] && flags="$(awk '$2=="/" {print $4; exit}' /proc/mounts 2>/dev/null)"
    case ",$flags," in
      *,noexec,*) say "  mount for $mnt: noexec  (binaries there cannot run)"; noexec_cnt=$((noexec_cnt + 1)) ;;
      *) say "  mount for $mnt: ${flags:-unknown} (exec allowed)" ;;
    esac
  done
  [ "$noexec_cnt" -gt 0 ] && [ -z "$CAUSE" ] && CAUSE="noexec-mount"

  # a real pty allocation test without node: `script` uses openpty too
  if have script; then
    local sout src
    sout="$( { limited 12 script -qc 'printf S4_SCRIPT_OK' /dev/null; } 2>&1 )"; src=$?
    case "$sout" in
      *S4_SCRIPT_OK*) say "  openpty via script(1): ok (exit=$src)"; [ "$PTY_VERDICT" = untested ] && PTY_VERDICT="ok" ;;
      *) say "  openpty via script(1): FAILED (exit=$src)"; printf '%s\n' "$sout" | head -c 200 | sed 's/^/      /'
         PTY_VERDICT="fail"; [ -z "$CAUSE" ] && CAUSE="pty-alloc" ;;
    esac
  else
    say "  script(1) not available: skipped the openpty test"
  fi
  say "  PTY_VERDICT=$PTY_VERDICT"
}

# =====================================================================
# 5. the terminal's working directory
# =====================================================================
check_dir() {  # check_dir <label> <path> [info]
  # "info" = a directory the terminal would only use if it existed; a
  # missing one is worth printing but is NOT a reason for exit code 1.
  local label="$1" p="$2" kind="${3:-real}"
  [ -z "$p" ] && return 0
  if [ -L "$p" ] && [ ! -e "$p" ]; then
    say "  $(printf '%-22s' "$label") $p  DANGLING SYMLINK"
    [ "$kind" = real ] && [ -z "$CWD_BAD" ] && CWD_BAD="$p"
    return 0
  fi
  if [ ! -d "$p" ]; then
    say "  $(printf '%-22s' "$label") $p  DOES NOT EXIST"
    [ "$kind" = real ] && [ -z "$CWD_BAD" ] && CWD_BAD="$p"
    return 0
  fi
  if ! ( cd "$p" 2>/dev/null ); then
    say "  $(printf '%-22s' "$label") $p  CANNOT BE ENTERED"
    [ "$kind" = real ] && [ -z "$CWD_BAD" ] && CWD_BAD="$p"
    return 0
  fi
  if [ -w "$p" ]; then
    say "  $(printf '%-22s' "$label") $p  ok (writable)"
  else
    say "  $(printf '%-22s' "$label") $p  ok (read-only)"
  fi
}

section_cwd() {
  sec "5  working directory the terminal will start in"
  # an explicit terminal.integrated.cwd beats the workspace folder
  local configured=""
  if [ -f "$SETTINGS" ] && have python3; then
    configured="$(python3 -c '
import json,sys
try:
    d=json.load(open(sys.argv[1],encoding="utf-8"))
    print(d.get("terminal.integrated.cwd","") or "")
except Exception:
    print("")
' "$SETTINGS" 2>/dev/null)"
  fi
  [ -n "$configured" ] && say "  terminal.integrated.cwd in settings: $configured"
  check_dir "configured cwd" "$configured"
  check_dir "workspace/argv" "$WORK"
  check_dir "HOME" "$HOME_DIR"
  check_dir "shared codes" "$HOME_DIR/storage/shared/codes" info
  check_dir "PREFIX" "$PFX" info
  if [ -n "$CWD_BAD" ]; then
    say "  CWD_BAD=$CWD_BAD"
    say "  A terminal whose starting directory does not exist exits before it"
    say "  prints anything: that is exit code 1 with an empty scrollback."
    [ -z "$CAUSE" ] && CAUSE="bad-cwd"
  else
    say "  CWD_BAD=none  (the entries marked DOES NOT EXIST above are optional)"
  fi
}

# =====================================================================
# 6. resources
# =====================================================================
section_resources() {
  sec "6  resources"
  local free_kb avail_mb
  free_kb="$(df -Pk "$HOME_DIR" 2>/dev/null | awk 'NR==2{print $4}')"
  avail_mb=$(( ${free_kb:-0} / 1024 ))
  say "  free on HOME: ${avail_mb} MB"
  [ "${avail_mb:-0}" -lt 50 ] && { say "  DISK_LOW=yes (under 50 MB: shells and logs fail)"; [ -z "$CAUSE" ] && CAUSE="disk-full"; }
  free_kb="$(df -Pk "$PFX" 2>/dev/null | awk 'NR==2{print $4}')"
  say "  free on PREFIX: $(( ${free_kb:-0} / 1024 )) MB"
  say "  MemAvailable: $(awk '/MemAvailable/{printf "%d MB", $2/1024}' /proc/meminfo 2>/dev/null)"
  say "  ulimit -u (processes): $(ulimit -u 2>/dev/null)"
  say "  ulimit -n (files):     $(ulimit -n 2>/dev/null)"
  if have getenforce; then say "  SELinux: $(getenforce 2>/dev/null)"; fi
}

# =====================================================================
# 7. repairs
# =====================================================================
write_settings() {
  if ! have python3; then
    warn "python3 is missing: settings.json cannot be merged safely, skipped"
    return 0
  fi
  [ -d "$SETTINGS_DIR" ] || mkdir -p "$SETTINGS_DIR" 2>/dev/null
  [ -f "$SETTINGS" ] && cp -p "$SETTINGS" "$SETTINGS.s4-bak.$(date +%s)" 2>/dev/null
  local default_profile cwd_use
  default_profile="Termux bash"
  if [ "$SAFE_PROFILE" = 1 ] || [ -n "$BAD_LAYER" ] || [ -n "$RC_BAD" ] || [ "$ENV_STRIPPED" = yes ]; then
    default_profile="Termux bash (safe)"
  fi
  cwd_use="$HOME_DIR"
  [ -d "$WORK" ] && cwd_use="$WORK"
  S4_SETTINGS="$SETTINGS" S4_BASH="$SHELL_BIN" S4_PFX="$PFX" \
  S4_DEFAULT="$default_profile" S4_CWD="$cwd_use" S4_HOME="$HOME_DIR" \
  python3 - <<'PY' 2>&1 | sed 's/^/  /'
import json, os
p = os.environ["S4_SETTINGS"]
bash = os.environ["S4_BASH"]
pfx = os.environ["S4_PFX"]
home = os.environ["S4_HOME"]
try:
    cur = json.load(open(p, encoding="utf-8")) if os.path.isfile(p) else {}
    if not isinstance(cur, dict):
        cur = {}
except Exception:
    cur = {}

termux_path = "%s/bin:%s/bin/applets:/system/bin:/system/xbin:/vendor/bin" % (pfx, pfx)
env = {
    "PREFIX": pfx,
    "HOME": home,
    "TMPDIR": os.path.join(pfx, "tmp"),
    "SHELL": bash,
    "TERM": "xterm-256color",
    "PATH": termux_path,
    "LD_LIBRARY_PATH": os.path.join(pfx, "lib"),
    "LANG": os.environ.get("LANG", "en_US.UTF-8"),
}
sh = os.path.join(os.path.dirname(bash), "sh")
want = {
    # a login shell reads /etc/profile + ~/.bash_profile + ~/.bashrc
    "terminal.integrated.defaultProfile.linux": os.environ["S4_DEFAULT"],
    "terminal.integrated.profiles.linux": {
        "Termux bash": {"path": bash, "args": ["-l"], "icon": "terminal-bash"},
        # same shell, but no startup files at all: this one always opens,
        # which is how you get a working terminal back to repair the rest
        "Termux bash (safe)": {"path": bash, "args": ["--norc", "--noprofile", "-i"],
                               "icon": "terminal-bash"},
        "Termux sh": {"path": sh, "args": ["-l"]},
    },
    "terminal.integrated.automationProfile.linux": {"path": bash, "args": ["--norc", "--noprofile", "-l"]},
    # an explicit cwd: a workspace on revoked shared storage is a dangling
    # symlink and makes the shell exit 1 before it prints anything
    "terminal.integrated.cwd": os.environ["S4_CWD"],
    # rebuild the environment inside the terminal even when code-server
    # itself was started with a stripped one (boot script / runit / nohup)
    "terminal.integrated.env.linux": env,
    "terminal.integrated.copyOnSelection": True,
    "terminal.integrated.fontSize": 16,
    "terminal.integrated.lineHeight": 1.3,
}
changed = sorted(k for k, v in want.items() if cur.get(k) != v)
cur.update(want)
json.dump(cur, open(p, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print("settings:", p)
print("default profile:", want["terminal.integrated.defaultProfile.linux"])
print("terminal cwd:", want["terminal.integrated.cwd"])
print("changed:", ", ".join(changed) or "none")
PY
  note_fix "settings.json terminal block (default=$default_profile, cwd=$cwd_use, env injected)"
}

repair_rc_file() {
  local f="$1"
  [ -f "$f" ] || return 0
  local bak="$f.s4-bad.$(date +%s)"
  cp -p "$f" "$bak" 2>/dev/null || return 0
  cat > "$f" <<'EOF'
# Rewritten by s4-termfix.sh -- the previous version ended the shell
# immediately, so the code-server terminal died with exit code 1.
# Your original file is kept next to this one (.s4-bad.*): put pieces of it
# back one at a time and open a new terminal after each one.
EOF
  note_fix "moved the broken $f to $bak and wrote a minimal replacement"
}

section_repair() {
  sec "7  repairs"
  if [ "$ACT" = report ]; then
    say "  --report-only: nothing was changed"
    return 0
  fi
  [ -n "${TMPDIR:-}" ] || { mkdir -p "$PFX/tmp" 2>/dev/null; note_fix "created $PFX/tmp (TMPDIR)"; }
  if [ -n "$RC_BAD" ]; then
    repair_rc_file "$RC_BAD"
  else
    say "  no broken startup file to replace"
  fi
  write_settings
}

# =====================================================================
# 8. verdict
# =====================================================================
section_verdict() {
  sec "8  verdict"
  if [ -n "$BAD_LAYER" ] || [ -n "$RC_BAD" ]; then VERDICT="startup-file"
  elif [ "$ENV_STRIPPED" = yes ]; then VERDICT="stripped-environment"
  elif [ -n "$CWD_BAD" ]; then VERDICT="bad-cwd"
  elif [ "$PTY_VERDICT" = fail ]; then VERDICT="pty-stack"
  fi
  [ -z "$CAUSE" ] && CAUSE="$VERDICT"
  say "  CAUSE=$CAUSE"
  say "  SHELL_LAYER_BAD=${BAD_LAYER:-none}"
  say "  RC_BAD=${RC_BAD:-none}"
  say "  CWD_BAD=${CWD_BAD:-none}"
  say "  ENV_STRIPPED=$ENV_STRIPPED"
  say "  PTY_VERDICT=$PTY_VERDICT"
  say "  FIXES=${FIXES:- none}"
  if [ "$ACT" = fix ] && [ -n "$FIXES" ]; then
    # re-probe after the repairs so the verdict reflects the new state
    BAD_LAYER=""; BAD_LAYER_OUT=""; RC_BAD=""
    section_layers
    if [ -z "$BAD_LAYER" ]; then VERDICT="repaired"; else VERDICT="still-broken"; fi
  fi
  say ""
  hr
  case "$VERDICT" in
    healthy)
      say "  S4_TERMFIX=done verdict=healthy"
      say "  Every startup layer opens cleanly, so the exit code 1 you saw was"
      say "  not the shell dying on its own.  Two things still produce exactly"
      say "  that popup with a healthy shell:"
      say "    - a one-shot terminal (a task, or 'Run in terminal' with the"
      say "      automation profile) whose COMMAND exited 1.  Re-run it and read"
      say "      the last lines: this repo's installer prints S4_INSTALL=fail"
      say "      reason=... when it aborts, and S4_INSTALL=done when it worked."
      say "    - the pty host was started before the repairs: reload the window."
      ;;
    repaired)
      say "  S4_TERMFIX=done verdict=repaired cause=$CAUSE"
      say "  Open a NEW terminal (or Reload Window).  If it still dies, run this"
      say "  script again with --safe-profile: that profile skips every startup"
      say "  file, so it opens even on a badly broken shell configuration."
      ;;
    still-broken)
      say "  S4_TERMFIX=done verdict=still-broken cause=$CAUSE"
      say "  The safe profile is now the default; reload the window and open a"
      say "  terminal.  Paste the report below into the chat:"
      say "    $REPORT"
      ;;
    *)
      say "  S4_TERMFIX=done verdict=$VERDICT cause=$CAUSE"
      say "  --report-only: nothing was changed.  Run without it to repair."
      ;;
  esac
  hr
  if [ "$REPORT_TMP" != /dev/null ]; then
    cp -f "$REPORT_TMP" "$REPORT" 2>/dev/null && say "  report: $REPORT"
    rm -f "$REPORT_TMP" 2>/dev/null
  fi
}

emit_json() {
  have python3 || return 0
  S4_J_VERSION="$VERSION" S4_J_CAUSE="$CAUSE" S4_J_VERDICT="$VERDICT" \
  S4_J_LAYER="${BAD_LAYER:-none}" S4_J_RC="${RC_BAD:-none}" S4_J_CWD="${CWD_BAD:-none}" \
  S4_J_ENV="$ENV_STRIPPED" S4_J_PTY="$PTY_VERDICT" S4_J_FIXES="$FIXES" \
  S4_J_SHELL="$SHELL_BIN" S4_J_REPORT="$REPORT" \
  python3 - <<'PY'
import json, os
print(json.dumps({k[5:].lower(): v for k, v in os.environ.items() if k.startswith("S4_J_")},
                 indent=2, sort_keys=True))
PY
}

# =====================================================================
# selftest: offline, builds a broken HOME and checks we find + fix it
# =====================================================================
selftest() {
  local pass=0 fail=0 root fakehome
  root="${TMPDIR:-/tmp}/s4-termfix-selftest-$$"
  fakehome="$root/home"
  mkdir -p "$fakehome/.local/share/code-server/User" "$root/pfx/bin" "$root/pfx/tmp" 2>/dev/null
  printf '%s\n' '# broken on purpose' 'exit 3' > "$fakehome/.bashrc"
  printf '%s\n' '{}' > "$fakehome/.local/share/code-server/User/settings.json"
  ln -s "$root/does-not-exist" "$fakehome/storage-link" 2>/dev/null

  local out rc
  out="$( env HOME="$fakehome" PREFIX="$root/pfx" S4_SHELL="$SHELL_BIN" \
          bash "$0" --settings "$fakehome/.local/share/code-server/User/settings.json" 2>&1 )"; rc=$?
  case "$out" in *S4_TERMFIX=done*) pass=$((pass+1)); echo "  ok   reaches a verdict";;
                 *) fail=$((fail+1)); echo "  FAIL reaches a verdict (rc=$rc)";; esac
  case "$out" in *RC_BAD=*.bashrc*) pass=$((pass+1)); echo "  ok   names the broken ~/.bashrc";;
                 *) fail=$((fail+1)); echo "  FAIL names the broken ~/.bashrc";; esac
  case "$out" in *KILLS\ THE\ SHELL*) pass=$((pass+1)); echo "  ok   reports that it kills the shell";;
                 *) fail=$((fail+1)); echo "  FAIL reports that it kills the shell";; esac
  case "$out" in *FIXED*) pass=$((pass+1)); echo "  ok   applied a repair";;
                 *) fail=$((fail+1)); echo "  FAIL applied a repair";; esac
  if [ -f "$fakehome/.bashrc" ] && ! grep -q 'exit 3' "$fakehome/.bashrc"; then
    pass=$((pass+1)); echo "  ok   the broken .bashrc was replaced"
  else
    fail=$((fail+1)); echo "  FAIL the broken .bashrc was replaced"
  fi
  ls "$fakehome"/.bashrc.s4-bad.* >/dev/null 2>&1 \
    && { pass=$((pass+1)); echo "  ok   the original was kept as .s4-bad.*"; } \
    || { fail=$((fail+1)); echo "  FAIL the original was kept as .s4-bad.*"; }
  if have python3; then
    local prof
    prof="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["terminal.integrated.defaultProfile.linux"])' \
            "$fakehome/.local/share/code-server/User/settings.json" 2>/dev/null)"
    if [ "$prof" = "Termux bash (safe)" ]; then
      pass=$((pass+1)); echo "  ok   a broken shell switches the default to the safe profile"
    else
      fail=$((fail+1)); echo "  FAIL default profile is [$prof], want [Termux bash (safe)]"
    fi
    local inj
    inj="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["terminal.integrated.env.linux"]["TERM"])' \
            "$fakehome/.local/share/code-server/User/settings.json" 2>/dev/null)"
    [ "$inj" = "xterm-256color" ] \
      && { pass=$((pass+1)); echo "  ok   injects a terminal environment"; } \
      || { fail=$((fail+1)); echo "  FAIL injects a terminal environment (TERM=$inj)"; }
  else
    echo "  skip settings assertions (no python3)"
  fi
  # report-only must not touch anything
  printf '%s\n' 'exit 3' > "$fakehome/.bashrc"
  local before after
  before="$(md5sum "$fakehome/.bashrc" 2>/dev/null | cut -c1-16)"
  env HOME="$fakehome" PREFIX="$root/pfx" S4_SHELL="$SHELL_BIN" \
    bash "$0" --report-only --settings "$fakehome/.local/share/code-server/User/settings.json" >/dev/null 2>&1
  after="$(md5sum "$fakehome/.bashrc" 2>/dev/null | cut -c1-16)"
  [ "$before" = "$after" ] \
    && { pass=$((pass+1)); echo "  ok   --report-only changes nothing"; } \
    || { fail=$((fail+1)); echo "  FAIL --report-only changes nothing"; }
  # pure ASCII output
  local na
  na="$(printf '%s' "$out" | LC_ALL=C tr -d '\000-\177' | wc -c | tr -d ' ')"
  [ "$na" = 0 ] \
    && { pass=$((pass+1)); echo "  ok   output is pure ASCII English"; } \
    || { fail=$((fail+1)); echo "  FAIL output has $na non-ascii bytes"; }

  rm -rf "$root" 2>/dev/null
  echo ""
  echo "passed=$pass failed=$fail"
  if [ "$fail" -gt 0 ]; then echo TESTS_FAILED; return 1; fi
  echo ALL_TESTS_PASSED
}

# =====================================================================
if [ "$SELFTEST" = 1 ]; then selftest; exit $?; fi

say "s4-termfix $VERSION - why the code-server terminal exits with code 1"
say "host: $(uname -srm 2>/dev/null)   home: $HOME_DIR   prefix: $PFX"
say "mode: $ACT$([ "$SAFE_PROFILE" = 1 ] && echo ' (safe profile forced)')"
hr
section_layers
section_files
section_env
section_pty
section_cwd
section_resources
section_repair
section_verdict
[ "$JSON_ONLY" = 1 ] && emit_json
exit 0
