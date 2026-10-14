#!/data/data/com.termux/files/usr/bin/bash
# =====================================================================
#  s4-install.sh v1.0 -- install scraper4.php on Termux as an
#                        unrestricted, VPS-like service + auto-update
# ---------------------------------------------------------------------
#  One command, no root, no limitations:
#
#    curl -fsSL -o ~/s4-install.sh \
#      https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-install.sh
#    bash ~/s4-install.sh
#
#  or pipe it straight in:
#
#    curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/f5a628bb-new/deploy/s4-install.sh | bash
#
#  What "like a VPS, without limitations" means here, concretely:
#
#   1. Internal storage, not shared storage.  The app is installed into
#      ~/scraper4 (ext4, exec + flock + rename allowed).  On
#      /storage/emulated/0 none of that works, which is why state files,
#      locks and child processes fail there.  Your working folder
#      ~/storage/shared/codes is only ever MIRRORED, never edited in place.
#   2. A real php.ini.  Termux ships without one, so display_errors=On
#      leaks "Deprecated:" text into JSON responses and OPcache tries to
#      allocate shared memory and dies with "Cannot create lock - EACCES".
#      This writes $PREFIX/etc/php.ini with display_errors=Off, log_errors=On,
#      memory_limit=512M, and OPcache in file_cache_only mode (cached
#      bytecode, no shared memory, no lock, and it picks up updates
#      immediately because validate_timestamps stays on).  If that mode does
#      not work on your device it automatically falls back to opcache off.
#   3. Concurrency.  PHP_CLI_SERVER_WORKERS=8, so the built-in server forks
#      workers.  Without this the app's self-requests (?ops_tick=1, chain
#      continuations, fireAndForget) block behind the request that made them
#      and the pipeline never advances - the single-worker CLI server is the
#      classic reason "nothing moves" on a phone.
#   4. Supervision + boot.  runit services (termux-services): scraper4
#      (the server), s4tick (the scheduler), s4update (auto-update), each with
#      svlogd rotation.  They restart on crash and start at boot.  If
#      termux-services is unavailable a bash supervisor loop is used instead.
#      Plus termux-wake-lock and a ~/.termux/boot script (Termux:Boot).
#   5. A scheduler instead of cron.  s4tick drives the app's own endpoints on
#      a fixed cadence: ?ops_tick=1 every tick, ?cron_run=1 every 2 ticks,
#      ?ai_test_status=1&drive=1 and ?sync_matrix_feedback=1&probe=1 every
#      5 ticks.  That keeps extraction, mismatch-repair and the AI test moving
#      with nobody watching.
#   6. Verified auto-update with rollback.  Every S4_UPDATE_INTERVAL seconds:
#      download scraper4.php from GitHub, then require size >= 1 MB, a leading
#      <?php, "const APP_VERSION", "function matrixBuild", a clean php -l, and
#      a version that is not older than the installed one.  Back up the current
#      file, swap atomically with mv, probe ?whoami=1, and if the response is
#      not a clean 200 the backup is restored automatically.  Nothing is ever
#      written in place, so a half-downloaded file can never be served.
#
#  Usage:
#    bash s4-install.sh                 # full install (default)
#    bash s4-install.sh --dry-run       # print every action, change nothing
#    bash s4-install.sh --status        # services, ports, health, versions
#    bash s4-install.sh --doctor        # the app's own health endpoints
#    bash s4-install.sh --update-now    # one verified update, then exit
#    bash s4-install.sh --logs          # tail the service logs
#    bash s4-install.sh --log-tail 200  # tail the installer's own log
#    bash s4-install.sh --stop|--start|--restart
#    bash s4-install.sh --uninstall
#
#  Options:
#    --port N            HTTP port (default 8080)
#    --bind ADDR         127.0.0.1 (default) or 0.0.0.0 with --lan
#    --lan               listen on all interfaces (see the warning it prints)
#    --dir PATH          install dir (default ~/scraper4)
#    --workers N         PHP_CLI_SERVER_WORKERS (default 8)
#    --channel REF       GitHub repo/ref to update from
#                        (default fazilatma/new@arena/f5a628bb-new)
#    --repo OWNER/NAME   GitHub repo (default fazilatma/new)
#    --file NAME         file to install/update (default scraper4.php)
#    --update-interval S seconds between update checks (default 300, 0 = off)
#    --tick-interval S   seconds between scheduler ticks (default 60, 0 = off)
#    --opcache MODE      auto|filecache|off|shm (default auto)
#    --keep N            backups to keep (default 3)
#    --mirror "a.php b.php"  extra files to mirror from the source folder
#    --no-services       install files only, no supervision
#    --no-php-ini        do not write $PREFIX/etc/php.ini
#    --no-packages       do not run pkg install
#    --no-boot           do not write the ~/.termux/boot script
#    --self-update       also refresh this installer from GitHub first
#    --verify-file PATH  only run the update gate on a local file
#    -y|--yes            never prompt (default when stdin is not a terminal)
#    -h|--help           this text
#
#  Everything this script prints is in English.  It is idempotent: run it
#  again any time to repair, re-configure or update.
#
#  A run always ends with exactly one greppable line, so a failure can be
#  identified even when the terminal that started it is already gone:
#      S4_INSTALL=done version=... mode=... port=...     (success)
#      S4_INSTALL=fail reason=...                        (it gave up)
#  Every line is also appended to ~/.s4-install/logs/install.log, which
#  --log-tail prints.  If a terminal popup said
#      The terminal process ".../bash" terminated with exit code: 1
#  then either this installer died (reason in the log) or the shell itself
#  died - deploy/s4-termfix.sh tells those apart and repairs the second.
# =====================================================================
set -u

VERSION="1.0.1"
HELP_LAST_LINE=101

# ------------------------------------------------------------- defaults
PFX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
TOOL_DIR="$HOME_DIR/.s4-install"
INSTALL_DIR="$HOME_DIR/scraper4"
LOG_DIR="$INSTALL_DIR/logs"
PORT="${S4_PORT:-8080}"
BIND="127.0.0.1"
WORKERS="${S4_WORKERS:-8}"
REPO="${S4_REPO:-fazilatma/new}"
CHANNEL="${S4_CHANNEL:-arena/f5a628bb-new}"
APP_FILE="${S4_FILE:-scraper4.php}"
UPDATE_INTERVAL="${S4_UPDATE_INTERVAL:-300}"
TICK_INTERVAL="${S4_TICK_INTERVAL:-60}"
OPCACHE_MODE="auto"
KEEP_BACKUPS=3
MIRROR_EXTRA=""
SHARED_DIR="$HOME_DIR/storage/shared/codes"
MIN_SIZE=1000000

DO_SERVICES=1; DO_PHP_INI=1; DO_PACKAGES=1; DO_BOOT=1
DRY=0; ASSUME_YES=0; QUIET=0
ACT=""            # install|status|doctor|update-now|logs|logtail|stop|start|restart|uninstall|verify
UPDATE_ONLY=0; SELF_UPDATE=0; VERIFY_FILE=""; LOG_TAIL_N=60

# Everything printed is also appended to ~/.s4-install/logs/install.log so a
# run that ends in "exit code 1" inside a one-shot terminal leaves its reason
# behind.  --dry-run logs nothing (it must not create files).
S4_LOG_FILE="$TOOL_DIR/logs/install.log"
LOG_TO_FILE=1
[ "$DRY" = 1 ] && LOG_TO_FILE=0

logline() {
  [ "$LOG_TO_FILE" = 1 ] || return 0
  mkdir -p "$TOOL_DIR/logs" 2>/dev/null || return 0
  # keep the log from growing without bound on a phone with little free space
  if [ -f "$S4_LOG_FILE" ]; then
    local sz
    sz="$(wc -c < "$S4_LOG_FILE" 2>/dev/null || echo 0)"
    if [ "${sz:-0}" -gt 524288 ]; then
      tail -n 400 "$S4_LOG_FILE" > "$S4_LOG_FILE.trim" 2>/dev/null \
        && mv -f "$S4_LOG_FILE.trim" "$S4_LOG_FILE" 2>/dev/null
    fi
  fi
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo '-')" "$*" \
    >> "$S4_LOG_FILE" 2>/dev/null || true
}

log_header() {
  [ "$LOG_TO_FILE" = 1 ] || return 0
  mkdir -p "$TOOL_DIR/logs" 2>/dev/null || return 0
  printf '%s ==== s4-install %s act=%s argv=%s ====\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo '-')" "$VERSION" "$ACT" "$*" \
    >> "$S4_LOG_FILE" 2>/dev/null || true
}

log_tail() {
  local n="${LOG_TAIL_N:-60}" keep="$LOG_TO_FILE"
  LOG_TO_FILE=0        # do not append the log to itself
  hr; say "== Installer log =="
  say "  file: $S4_LOG_FILE"
  if [ -f "$S4_LOG_FILE" ]; then
    tail -n "$n" "$S4_LOG_FILE" 2>/dev/null | sed 's/^/  /'
    say ""
    say "  last recorded outcomes:"
    grep -h -E 'S4_INSTALL=(done|fail)' "$S4_LOG_FILE" 2>/dev/null | tail -5 | sed 's/^/    /'
    say "  (no line above means no run ever finished)"
  else
    say "  no log yet - the installer has not written one on this device"
  fi
  say "  S4_LOGTAIL=done file=$S4_LOG_FILE lines=$n"
  LOG_TO_FILE="$keep"
}

say()  { [ "$QUIET" = 1 ] || printf '%s\n' "$*"; logline "$*"; }
info() { printf '[s4-install] %s\n' "$*"; logline "INFO $*"; }
warn() { printf '[s4-install] WARN  %s\n' "$*" >&2; logline "WARN $*"; }
# one greppable line, then exit 1: "S4_INSTALL=fail reason=..."
die()  {
  printf '[s4-install] ERROR %s\n' "$*" >&2
  printf 'S4_INSTALL=fail reason=%s\n' "$*" >&2
  logline "ERROR $*"
  logline "S4_INSTALL=fail reason=$*"
  exit 1
}
hr()   { say "------------------------------------------------------------"; }
have() { command -v "$1" >/dev/null 2>&1; }

# run/echo aware of --dry-run
run() {
  if [ "$DRY" = 1 ]; then
    printf '[dry-run] %s\n' "$*"
    return 0
  fi
  "$@"
}
sh_run() {  # for pipelines / redirections
  if [ "$DRY" = 1 ]; then printf '[dry-run] %s\n' "$*"; return 0; fi
  eval "$@"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --all)              ACT="install"; shift ;;
    --dry-run)          DRY=1; shift ;;
    --status)           ACT="status"; shift ;;
    --doctor)           ACT="doctor"; shift ;;
    --update-now)       ACT="update-now"; shift ;;
    --update-only)      UPDATE_ONLY=1; QUIET=1; ACT="update-now"; shift ;;
    --logs)             ACT="logs"; shift ;;
    --stop)             ACT="stop"; shift ;;
    --start)            ACT="start"; shift ;;
    --restart)          ACT="restart"; shift ;;
    --uninstall)        ACT="uninstall"; shift ;;
    --verify-file)      VERIFY_FILE="${2:-}"; ACT="verify"; shift 2 ;;
    --log-tail)         ACT="logtail"
                        case "${2:-}" in ''|-*) LOG_TAIL_N=60 ;; *) LOG_TAIL_N="$2"; shift ;; esac
                        shift ;;
    --self-update)      SELF_UPDATE=1; shift ;;
    --port)             PORT="${2:-8080}"; shift 2 ;;
    --bind)             BIND="${2:-127.0.0.1}"; shift 2 ;;
    --lan)              BIND="0.0.0.0"; shift ;;
    --dir)              INSTALL_DIR="${2:-$INSTALL_DIR}"; shift 2 ;;
    --workers)          WORKERS="${2:-8}"; shift 2 ;;
    --channel)          CHANNEL="${2:-$CHANNEL}"; shift 2 ;;
    --repo)             REPO="${2:-$REPO}"; shift 2 ;;
    --file)             APP_FILE="${2:-$APP_FILE}"; shift 2 ;;
    --update-interval)  UPDATE_INTERVAL="${2:-300}"; shift 2 ;;
    --tick-interval)    TICK_INTERVAL="${2:-60}"; shift 2 ;;
    --opcache)          OPCACHE_MODE="${2:-auto}"; shift 2 ;;
    --keep)             KEEP_BACKUPS="${2:-3}"; shift 2 ;;
    --mirror)           MIRROR_EXTRA="${2:-}"; shift 2 ;;
    --no-services)      DO_SERVICES=0; shift ;;
    --no-php-ini)       DO_PHP_INI=0; shift ;;
    --no-packages)      DO_PACKAGES=0; shift ;;
    --no-boot)          DO_BOOT=0; shift ;;
    --quiet)            QUIET=1; shift ;;
    -y|--yes)           ASSUME_YES=1; shift ;;
    -h|--help)          sed -n "2,${HELP_LAST_LINE}p" "$0"; exit 0 ;;
    -V|--version)       echo "s4-install $VERSION"; exit 0 ;;
    *)                  die "unknown flag: $1  (try --help)" ;;
  esac
done

[ -n "$ACT" ] || ACT="install"
[ -t 0 ] || ASSUME_YES=1
LOG_DIR="$INSTALL_DIR/logs"
RAWBASE="https://raw.githubusercontent.com/$REPO/$CHANNEL"
APIBASE="https://api.github.com/repos/$REPO/contents"

# ============================================================ environment
detect_env() {
  hr; say "== Environment =="
  if [ -z "${TERMUX_VERSION:-}" ] && [ ! -d "/data/data/com.termux" ]; then
    warn "this does not look like Termux (no /data/data/com.termux)."
    warn "The script continues, but packages and services may not apply."
  else
    say "  termux:      ${TERMUX_VERSION:-unknown}"
  fi
  say "  android:     $(getprop ro.build.version.release 2>/dev/null || echo unknown) / sdk $(getprop ro.build.version.sdk 2>/dev/null || echo '?')"
  say "  device:      $(getprop ro.product.model 2>/dev/null || echo unknown) ($(uname -m))"
  say "  prefix:      $PFX"
  say "  home:        $HOME_DIR"
  say "  install dir: $INSTALL_DIR"
  say "  php:         $(have php && php -r 'echo PHP_VERSION;' 2>/dev/null || echo 'NOT INSTALLED')"
  say "  node:        $(have node && node -v 2>/dev/null || echo 'not installed (optional)')"
  say "  git:         $(have git && git --version 2>/dev/null | awk '{print $3}' || echo 'not installed (optional)')"
  say "  curl:        $(have curl && echo yes || echo NO)"
  say "  runit/sv:    $(have sv && echo yes || echo 'no (will use the bash supervisor)')"
  local avail
  avail="$(df -k "$HOME_DIR" 2>/dev/null | awk 'NR==2{print int($4/1024)}')"
  say "  free space:  ${avail:-?} MB in $HOME_DIR"
  if [ -n "${avail:-}" ] && [ "$avail" -lt 300 ]; then
    warn "less than 300 MB free: updates and backups may fail. Clean up first."
  fi
  if [ -d "$SHARED_DIR" ]; then
    say "  shared dir:  $SHARED_DIR (visible)"
    if [ -f "$SHARED_DIR/$APP_FILE" ]; then
      say "               contains $APP_FILE ($(wc -c < "$SHARED_DIR/$APP_FILE" | tr -d ' ') bytes) - will be mirrored, never edited"
    fi
  else
    say "  shared dir:  $SHARED_DIR (not visible)"
    say "               if you need it: run  termux-setup-storage  and accept the dialog"
  fi
  case "$INSTALL_DIR" in
    /storage/*|"$HOME_DIR"/storage/*)
      die "the install dir must be on internal storage (noexec/no-flock on shared storage). Use --dir ~/scraper4"
      ;;
  esac
}

net_ok() {
  curl -fsS --connect-timeout 8 --max-time 20 -o /dev/null "https://raw.githubusercontent.com" 2>/dev/null \
    || curl -fsS --connect-timeout 8 --max-time 20 -o /dev/null "https://api.github.com" 2>/dev/null
}

# ================================================================ packages
install_packages() {
  [ "$DO_PACKAGES" = 1 ] || { say "== Packages == skipped (--no-packages)"; return 0; }
  hr; say "== Packages =="
  local want="php curl"
  local opt="git nodejs python jq openssh termux-services openssl"
  local missing=""
  for p in php curl git node python jq sshd sv openssl; do
    have "$p" || missing="$missing $p"
  done
  if [ -z "$missing" ]; then
    say "  everything needed is already installed"
    return 0
  fi
  say "  missing binaries:$missing"
  if ! have pkg; then die "pkg not found - cannot install packages"; fi
  say "  installing: $want $opt"
  if [ "$DRY" = 1 ]; then
    printf '[dry-run] pkg install -y %s %s\n' "$want" "$opt"
  else
    # shellcheck disable=SC2086
    yes | pkg install -y $want $opt 2>&1 | tail -12 | sed 's/^/    /'
  fi
  for p in php curl; do have "$p" || die "$p is still missing after pkg install"; done
  say "  php now: $(php -r 'echo PHP_VERSION, " ", PHP_SAPI;' 2>/dev/null)"
  have sv && say "  runit services available (sv)" || warn "termux-services not available - using the bash supervisor"
}

# ================================================================ php.ini
php_ini_path() { printf '%s' "$PFX/etc/php.ini"; }

write_php_ini() {  # write_php_ini <filecache|off|shm>
  local mode="$1" ini; ini="$(php_ini_path)"
  [ "$DO_PHP_INI" = 1 ] || { say "== php.ini == skipped (--no-php-ini)"; return 0; }
  hr; say "== php.ini ($mode) =="
  if [ -f "$ini" ] && [ ! -f "$ini.s4-backup" ]; then
    run cp -p "$ini" "$ini.s4-backup"
    say "  existing php.ini backed up to $ini.s4-backup"
  fi
  if [ "$DRY" = 1 ]; then
    printf '[dry-run] write %s (opcache mode: %s)\n' "$ini" "$mode"
    PHP_INI_MODE="$mode"; return 0
  fi
  mkdir -p "$PFX/etc" "$LOG_DIR" 2>/dev/null
  {
    echo "; written by s4-install.sh $VERSION on $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    echo "; Termux ships without a php.ini; without one display_errors=On leaks"
    echo "; \"Deprecated:\" text into JSON responses and OPcache dies on its SHM lock."
    echo "[PHP]"
    echo "display_errors = Off"
    echo "display_startup_errors = Off"
    echo "log_errors = On"
    echo "error_log = $LOG_DIR/php-error.log"
    echo "error_reporting = E_ALL & ~E_DEPRECATED & ~E_STRICT"
    echo "memory_limit = 512M"
    echo "max_execution_time = 300"
    echo "max_input_time = 300"
    echo "default_socket_timeout = 60"
    echo "post_max_size = 64M"
    echo "upload_max_file_size = 64M"
    echo "expose_php = Off"
    echo "allow_url_fopen = On"
    echo "date.timezone = Asia/Tehran"
    echo "sys_temp_dir = $PFX/tmp"
    echo "[opcache]"
    case "$mode" in
      filecache)
        echo "; cached bytecode on disk, NO shared memory: avoids the"
        echo "; \"Cannot create lock - Permission denied\" failure on Termux."
        echo "opcache.enable = 1"
        echo "opcache.enable_cli = 1"
        echo "opcache.file_cache = $LOG_DIR/opcache"
        echo "opcache.file_cache_only = 1"
        echo "opcache.file_cache_consistency_checks = 1"
        echo "opcache.validate_timestamps = 1"
        echo "opcache.revalidate_freq = 0"
        echo "opcache.save_comments = 1"
        ;;
      shm)
        echo "opcache.enable = 1"
        echo "opcache.enable_cli = 1"
        echo "opcache.memory_consumption = 192"
        echo "opcache.validate_timestamps = 1"
        echo "opcache.revalidate_freq = 0"
        ;;
      *)
        echo "; opcache disabled: slowest but always works"
        echo "opcache.enable = 0"
        echo "opcache.enable_cli = 0"
        ;;
    esac
  } > "$ini"
  PHP_INI_MODE="$mode"
  say "  written: $ini"
  php -i 2>/dev/null | grep -m1 'Loaded Configuration File' | sed 's/^/  /'
  say "  display_errors = $(php -r 'echo ini_get("display_errors") ?: "Off";' 2>/dev/null)"
  say "  memory_limit   = $(php -r 'echo ini_get("memory_limit");' 2>/dev/null)"
  say "  opcache.enable = $(php -r 'echo var_export((bool)ini_get("opcache.enable"),true);' 2>/dev/null) / file_cache_only = $(php -r 'echo var_export((bool)ini_get("opcache.file_cache_only"),true);' 2>/dev/null)"
}

# boot a throwaway server to prove the chosen opcache mode really works
test_php_server() {  # test_php_server <mode> -> 0 ok
  local mode="$1" tp="${S4_TEST_PORT:-18090}"
  have php || return 1
  [ "$DRY" = 1 ] && return 0
  local docroot; docroot="$(mktemp -d 2>/dev/null || echo /tmp/s4t.$$)"
  mkdir -p "$docroot" 2>/dev/null
  printf '<?php echo "S4_PHP_OK ", PHP_VERSION, " workers=", (int)getenv("PHP_CLI_SERVER_WORKERS");\n' > "$docroot/probe.php"
  PHP_CLI_SERVER_WORKERS=2 php -S "127.0.0.1:$tp" -t "$docroot" > "$docroot/srv.log" 2>&1 &
  local pid=$! i out=""
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    out="$(curl -fsS --max-time 5 "http://127.0.0.1:$tp/probe.php" 2>/dev/null || true)"
    [ -n "$out" ] && break
  done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  rm -rf "$docroot" 2>/dev/null
  case "$out" in
    *S4_PHP_OK*) return 0 ;;
    *) warn "test server ($mode) did not answer; log said: $(printf '%s' "$out" | head -c 120)"; return 1 ;;
  esac
}

setup_php() {
  have php || { warn "php missing; skipping php.ini (install it with: pkg install php)"; return 0; }
  local mode="$OPCACHE_MODE"
  if [ "$mode" = auto ]; then
    write_php_ini filecache
    if test_php_server filecache; then
      say "  RESULT: opcache file_cache_only works (fast, no shared memory)"
      PHP_INI_MODE=filecache
    else
      warn "opcache file cache did not serve; falling back to opcache off"
      write_php_ini off
      if test_php_server off; then say "  RESULT: opcache off (slower, but reliable)"; PHP_INI_MODE=off
      else warn "the test server did not answer with opcache off either - see $LOG_DIR/php-error.log"; PHP_INI_MODE=off; fi
    fi
  else
    write_php_ini "$mode"
    test_php_server "$mode" && say "  RESULT: test server answered (mode $mode)" || warn "test server did not answer (mode $mode)"
    PHP_INI_MODE="$mode"
  fi
}

# ============================================================ source files
github_fetch() {  # github_fetch <repo-path> <dest>
  local rp="$1" dest="$2"
  if curl -fsSL --connect-timeout 12 --max-time 300 -o "$dest.part" "$RAWBASE/$rp" 2>/dev/null && [ -s "$dest.part" ]; then
    mv -f "$dest.part" "$dest"; return 0
  fi
  if curl -fsSL --connect-timeout 12 --max-time 300 -H 'Accept: application/vnd.github.raw' \
       -o "$dest.part" "$APIBASE/$rp?ref=$CHANNEL" 2>/dev/null && [ -s "$dest.part" ]; then
    mv -f "$dest.part" "$dest"; return 0
  fi
  rm -f "$dest.part" 2>/dev/null
  return 1
}

app_version_of() {  # app_version_of <file> -> prints e.g. 10.361
  local f="$1" v=""
  [ -f "$f" ] || return 1
  v="$(grep -o "const APP_VERSION[^;]*" "$f" 2>/dev/null | head -1 | grep -oE "[0-9]+\.[0-9]+(\.[0-9]+)?" | head -1)"
  [ -z "$v" ] && v="$(grep -o "define([\"']APP_VERSION[\"'][^)]*" "$f" 2>/dev/null | head -1 | grep -oE "[0-9]+\.[0-9]+(\.[0-9]+)?" | head -1)"
  printf '%s' "$v"
}

version_ge() {  # version_ge A B -> 0 when A >= B
  # Dotted numeric compare with no external tools.  (An earlier version used
  # `sort -V -C`, which succeeds when A <= B - inverted, and it would have
  # let the updater install a DOWNGRADE.  Unit-tested below in the repo.)
  local a="${1:-0}" b="${2:-0}"
  [ -z "$a" ] && a=0
  [ -z "$b" ] && b=0
  [ "$a" = "$b" ] && return 0
  local IFS='.'
  local -a pa=($a) pb=($b)
  local n=${#pa[@]} i x y
  [ "${#pb[@]}" -gt "$n" ] && n=${#pb[@]}
  for ((i = 0; i < n; i++)); do
    x="${pa[i]:-0}"; y="${pb[i]:-0}"
    x="${x//[^0-9]/}"; y="${y//[^0-9]/}"
    [ -z "$x" ] && x=0
    [ -z "$y" ] && y=0
    if [ "$x" -gt "$y" ]; then return 0; fi
    if [ "$x" -lt "$y" ]; then return 1; fi
  done
  return 0
}

sha16_of() {  # short fingerprint without openssl
  local f="$1"
  if have sha256sum; then sha256sum "$f" 2>/dev/null | cut -c1-16
  elif have openssl; then openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF}' | cut -c1-16
  elif have md5sum; then md5sum "$f" 2>/dev/null | cut -c1-16
  else wc -c < "$f" | tr -d ' '; fi
}

# the update gate: exactly what prod checks before it accepts a new file
verify_scraper_file() {  # verify_scraper_file <path> -> prints VERIFY_OK/VERIFY_FAIL
  local f="$1" size v
  if [ ! -f "$f" ]; then echo "VERIFY_FAIL missing-file"; return 1; fi
  size="$(wc -c < "$f" | tr -d ' ')"
  if [ "$size" -lt "$MIN_SIZE" ]; then echo "VERIFY_FAIL too-small ($size < $MIN_SIZE)"; return 1; fi
  if ! head -c 400 "$f" | grep -q '<?php'; then echo "VERIFY_FAIL no-php-open-tag"; return 1; fi
  if ! grep -q 'const APP_VERSION' "$f" && ! grep -q "define('APP_VERSION'" "$f"; then
    echo "VERIFY_FAIL no-APP_VERSION"; return 1
  fi
  if ! grep -q 'function matrixBuild' "$f"; then echo "VERIFY_FAIL no-matrixBuild"; return 1; fi
  if grep -q $'\r' "$f" 2>/dev/null && head -c 2000 "$f" | grep -q $'\r\n'; then
    echo "VERIFY_WARN crlf-line-endings"
  fi
  if have php; then
    local lint; lint="$(php -l "$f" 2>&1)"
    if [ $? -ne 0 ]; then echo "VERIFY_FAIL php-lint: $(printf '%s' "$lint" | head -2 | tr '\n' ' ')"; return 1; fi
  else
    echo "VERIFY_WARN php-missing-so-no-lint"
  fi
  v="$(app_version_of "$f")"
  [ -z "$v" ] && { echo "VERIFY_FAIL unparseable-version"; return 1; }
  echo "VERIFY_OK version=$v size=$size sha16=$(sha16_of "$f")"
  return 0
}

install_source() {
  hr; say "== Application files =="
  run mkdir -p "$INSTALL_DIR" "$LOG_DIR" "$INSTALL_DIR/backups"
  local target="$INSTALL_DIR/$APP_FILE"
  if [ -f "$target" ]; then
    say "  already installed: $target ($(wc -c < "$target" | tr -d ' ') bytes, version $(app_version_of "$target" || echo '?'))"
  fi
  if [ ! -f "$target" ]; then
    if [ -f "$SHARED_DIR/$APP_FILE" ]; then
      say "  mirroring $SHARED_DIR/$APP_FILE (source folder is never modified)"
      run cp -f "$SHARED_DIR/$APP_FILE" "$target"
    else
      say "  downloading $APP_FILE from $REPO@$CHANNEL"
      if [ "$DRY" = 1 ]; then printf '[dry-run] curl -fsSL %s/deploy/../%s -> %s\n' "$RAWBASE" "$APP_FILE" "$target"
      else github_fetch "$APP_FILE" "$target" || die "download failed and no local copy exists"; fi
    fi
  fi
  [ -f "$target" ] || { warn "no $APP_FILE yet - the update service will fetch it"; return 0; }
  local vr; vr="$(verify_scraper_file "$target")"
  say "  gate: $vr"
  case "$vr" in VERIFY_OK*) : ;; *) warn "the installed file did not pass the gate; auto-update will replace it" ;; esac

  # extra files the user asked to mirror (deploy.php, termux-panel.sh, ...)
  local f
  for f in $MIRROR_EXTRA; do
    if [ -f "$SHARED_DIR/$f" ]; then
      say "  mirroring extra file: $f"
      run cp -f "$SHARED_DIR/$f" "$INSTALL_DIR/$f"
    fi
  done
  say "  logs:    $LOG_DIR"
  say "  backups: $INSTALL_DIR/backups (keep $KEEP_BACKUPS)"
}

# ============================================================== tool files
env_quote() { printf "%s='%s'\n" "$1" "$(printf '%s' "$2" | sed "s/'/'\\\\''/g")"; }

write_tool_files() {
  hr; say "== Service scripts =="
  run mkdir -p "$TOOL_DIR"
  if [ "$DRY" = 1 ]; then
    printf '[dry-run] write %s/{env.sh,serve.sh,tick.sh,update.sh,supervise.sh}\n' "$TOOL_DIR"
    return 0
  fi
  {
    echo "# generated by s4-install.sh $VERSION on $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    env_quote S4_VERSION "$VERSION"
    env_quote S4_PFX "$PFX"
    env_quote S4_HOME "$HOME_DIR"
    env_quote S4_TOOL_DIR "$TOOL_DIR"
    env_quote S4_INSTALLER "$TOOL_DIR/s4-install.sh"
    env_quote S4_INSTALL_DIR "$INSTALL_DIR"
    env_quote S4_LOG_DIR "$LOG_DIR"
    env_quote S4_PORT "$PORT"
    env_quote S4_BIND "$BIND"
    env_quote S4_WORKERS "$WORKERS"
    env_quote S4_REPO "$REPO"
    env_quote S4_CHANNEL "$CHANNEL"
    env_quote S4_FILE "$APP_FILE"
    env_quote S4_UPDATE_INTERVAL "$UPDATE_INTERVAL"
    env_quote S4_TICK_INTERVAL "$TICK_INTERVAL"
    env_quote S4_KEEP_BACKUPS "$KEEP_BACKUPS"
    env_quote S4_PHP "$(have php && command -v php || echo "$PFX/bin/php")"
    env_quote S4_OPCACHE "${PHP_INI_MODE:-auto}"
  } > "$TOOL_DIR/env.sh"
  say "  env.sh written ($TOOL_DIR/env.sh)"

  cat > "$TOOL_DIR/serve.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# The scraper4 HTTP server.  Started by runit (or by supervise.sh).
set -u
. "$HOME/.s4-install/env.sh"
mkdir -p "$S4_LOG_DIR" "$S4_INSTALL_DIR"
cd "$S4_INSTALL_DIR" || exit 1
# Without workers the built-in server is single-threaded and the app's own
# self-requests (?ops_tick=1, chain continuations) block behind the request
# that issued them - the pipeline then never advances.
export PHP_CLI_SERVER_WORKERS="$S4_WORKERS"
export S4_INSTALL_DIR S4_PORT
echo "[serve] $(date -u '+%Y-%m-%dT%H:%M:%TZ') php -S $S4_BIND:$S4_PORT workers=$S4_WORKERS dir=$S4_INSTALL_DIR"
exec "$S4_PHP" -S "$S4_BIND:$S4_PORT" -t "$S4_INSTALL_DIR"
EOF

  cat > "$TOOL_DIR/tick.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# The scheduler.  Termux has no reliable cron under Doze, so this loop drives
# the app's own endpoints - the same thing a VPS crontab would do.
set -u
. "$HOME/.s4-install/env.sh"
if [ "${S4_TICK_INTERVAL:-0}" = 0 ]; then echo "[tick] disabled (tick-interval 0)"; exit 0; fi
# floor: a 1s loop would only waste battery and flood the log
if [ "${S4_TICK_INTERVAL:-60}" -lt 5 ]; then S4_TICK_INTERVAL=5; fi
BASE="http://127.0.0.1:$S4_PORT/$S4_FILE"
i=0
echo "[tick] $(date -u '+%Y-%m-%dT%H:%M:%TZ') started, interval=${S4_TICK_INTERVAL}s base=$BASE"
while :; do
  i=$((i + 1))
  probe() {  # probe <label> <query>
    local code
    code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 40 "$BASE?$2" 2>/dev/null)
    echo "[tick] $(date -u '+%H:%M:%S') $1 http=${code:-000}"
  }
  probe ops_tick "ops_tick=1"
  if [ $((i % 2)) -eq 0 ]; then probe cron_run "cron_run=1"; fi
  if [ $((i % 5)) -eq 0 ]; then
    probe ai_drive "ai_test_status=1&drive=1"
    probe matrix_probe "sync_matrix_feedback=1&probe=1"
  fi
  if [ $((i % 10)) -eq 0 ]; then probe matrix_status "matrix_execution_status=1"; fi
  sleep "$S4_TICK_INTERVAL"
done
EOF

  cat > "$TOOL_DIR/update.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Auto-update loop: verified download, atomic swap, health probe, rollback.
set -u
. "$HOME/.s4-install/env.sh"
if [ "${S4_UPDATE_INTERVAL:-0}" = 0 ]; then echo "[update] disabled (update-interval 0)"; exit 0; fi
if [ "${S4_UPDATE_INTERVAL:-300}" -lt 30 ]; then S4_UPDATE_INTERVAL=30; fi
echo "[update] $(date -u '+%Y-%m-%dT%H:%M:%TZ') started, interval=${S4_UPDATE_INTERVAL}s channel=$S4_REPO@$S4_CHANNEL"
while :; do
  bash "$S4_INSTALLER" --update-only --quiet >> "$S4_LOG_DIR/update.log" 2>&1
  sleep "$S4_UPDATE_INTERVAL"
done
EOF

  cat > "$TOOL_DIR/supervise.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Fallback supervisor, used when termux-services/runit is not installed.
set -u
. "$HOME/.s4-install/env.sh"
mkdir -p "$S4_LOG_DIR"
echo "[supervise] $(date -u '+%Y-%m-%dT%H:%M:%TZ') started"
while :; do
  bash "$S4_TOOL_DIR/serve.sh" >> "$S4_LOG_DIR/server.log" 2>&1
  rc=$?
  echo "[supervise] $(date -u '+%Y-%m-%dT%H:%M:%TZ') server exited rc=$rc, restarting in 3s" >> "$S4_LOG_DIR/supervise.log"
  sleep 3
done
EOF

  cat > "$TOOL_DIR/tick-supervise.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -u
. "$HOME/.s4-install/env.sh"
mkdir -p "$S4_LOG_DIR"
[ "${S4_TICK_INTERVAL:-0}" = 0 ] && { echo "[supervise] tick disabled (interval 0)"; exit 0; }
while :; do
  bash "$S4_TOOL_DIR/tick.sh" >> "$S4_LOG_DIR/tick.log" 2>&1
  echo "[supervise] $(date -u '+%Y-%m-%dT%H:%M:%TZ') tick loop exited, restarting in 5s" >> "$S4_LOG_DIR/supervise.log"
  sleep 5
done
EOF

  cat > "$TOOL_DIR/update-supervise.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -u
. "$HOME/.s4-install/env.sh"
mkdir -p "$S4_LOG_DIR"
[ "${S4_UPDATE_INTERVAL:-0}" = 0 ] && { echo "[supervise] update disabled (interval 0)"; exit 0; }
while :; do
  bash "$S4_TOOL_DIR/update.sh" >> "$S4_LOG_DIR/update-supervise.log" 2>&1
  sleep 10
done
EOF

  chmod +x "$TOOL_DIR"/*.sh 2>/dev/null
  for f in serve tick update supervise tick-supervise update-supervise; do
    say "  $f.sh ($(wc -c < "$TOOL_DIR/$f.sh" | tr -d ' ') bytes)"
  done
}

# keep a copy of this installer on the device so the services can call it
ensure_installer_copy() {
  [ "$DRY" = 1 ] && { printf '[dry-run] copy installer to %s/s4-install.sh\n' "$TOOL_DIR"; return 0; }
  mkdir -p "$TOOL_DIR"
  if [ -f "$0" ] && [ -r "$0" ]; then
    cp -f "$0" "$TOOL_DIR/s4-install.sh" && chmod +x "$TOOL_DIR/s4-install.sh"
  elif ! [ -s "$TOOL_DIR/s4-install.sh" ]; then
    github_fetch "deploy/s4-install.sh" "$TOOL_DIR/s4-install.sh" && chmod +x "$TOOL_DIR/s4-install.sh" \
      || warn "could not store a copy of the installer (piped stdin and no network)"
  fi
  [ -s "$TOOL_DIR/s4-install.sh" ] && say "  installer copy: $TOOL_DIR/s4-install.sh ($(wc -c < "$TOOL_DIR/s4-install.sh" | tr -d ' ') bytes)"
}

# ================================================================ services
SVC_MODE=""
install_services() {
  [ "$DO_SERVICES" = 1 ] || { say "== Services == skipped (--no-services)"; SVC_MODE=none; return 0; }
  hr; say "== Services =="
  if have sv && [ -d "$PFX/etc" ]; then
    SVC_MODE=runit
  else
    SVC_MODE=supervisor
  fi
  say "  mode: $SVC_MODE"
  if [ "$DRY" = 1 ]; then
    printf '[dry-run] install 3 services (scraper4, s4tick, s4update) via %s\n' "$SVC_MODE"
    return 0
  fi

  if [ "$SVC_MODE" = runit ]; then
    local s
    for s in scraper4 s4tick s4update; do
      mkdir -p "$PFX/etc/sv/$s/log"
    done
    cat > "$PFX/etc/sv/scraper4/run" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
exec bash "$TOOL_DIR/serve.sh"
EOF
    cat > "$PFX/etc/sv/s4tick/run" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
[ "\$(. "$TOOL_DIR/env.sh"; echo "\$S4_TICK_INTERVAL")" = 0 ] && { echo "[s4tick] disabled (tick-interval 0)"; exec sleep 2147483647; }
exec bash "$TOOL_DIR/tick.sh"
EOF
    cat > "$PFX/etc/sv/s4update/run" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
[ "\$(. "$TOOL_DIR/env.sh"; echo "\$S4_UPDATE_INTERVAL")" = 0 ] && { echo "[s4update] disabled (update-interval 0)"; exec sleep 2147483647; }
exec bash "$TOOL_DIR/update.sh"
EOF
    for s in scraper4 s4tick s4update; do
      chmod +x "$PFX/etc/sv/$s/run"
      cat > "$PFX/etc/sv/$s/log/run" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
exec svlogd -tt "$LOG_DIR/$s"
EOF
      chmod +x "$PFX/etc/sv/$s/log/run"
      mkdir -p "$LOG_DIR/$s"
      printf 's20000000\nn5\n' > "$LOG_DIR/$s/config"
    done
    for s in scraper4 s4tick s4update; do
      sv-enable "$s" >/dev/null 2>&1 || warn "sv-enable $s failed"
    done
    sleep 2
    for s in scraper4 s4tick s4update; do
      say "  $(sv status "$s" 2>&1 | head -1)"
    done
  else
    mkdir -p "$TOOL_DIR/run"
    local pair
    for pair in "scraper4:supervise.sh" "s4tick:tick-supervise.sh" "s4update:update-supervise.sh"; do
      local name script pidf
      name="${pair%%:*}"; script="${pair##*:}"; pidf="$TOOL_DIR/run/$name.pid"
      if [ "$(loop_interval "$name")" = 0 ]; then
        rm -f "$pidf" 2>/dev/null
        say "  $name: disabled (interval 0), not started"
        continue
      fi
      if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then
        say "  $name already running (pid $(cat "$pidf"))"
        continue
      fi
      nohup bash "$TOOL_DIR/$script" >/dev/null 2>&1 &
      echo $! > "$pidf"
      sleep 1
      if kill -0 "$(cat "$pidf" 2>/dev/null)" 2>/dev/null; then
        say "  $name started (pid $(cat "$pidf"), fallback supervisor)"
      else
        rm -f "$pidf" 2>/dev/null
        warn "$name exited at once - see $LOG_DIR/supervise.log"
      fi
    done
  fi
}

write_boot_script() {
  [ "$DO_BOOT" = 1 ] || return 0
  local boot="$HOME_DIR/.termux/boot"
  hr; say "== Start at boot =="
  if [ "$DRY" = 1 ]; then printf '[dry-run] write %s/scraper4.sh\n' "$boot"; return 0; fi
  mkdir -p "$boot"
  cat > "$boot/scraper4.sh" <<EOF
#!/data/data/com.termux/files/usr/bin/bash
# Written by s4-install.sh - runs when the phone boots (needs the Termux:Boot
# app, opened once after install, and battery optimisation turned off for
# Termux, otherwise Android kills the process hours later).
have() { command -v "\$1" >/dev/null 2>&1; }
have termux-wake-lock && termux-wake-lock
if have sv; then
  for s in scraper4 s4tick s4update; do sv start "\$s" 2>/dev/null; done
else
  . "$TOOL_DIR/env.sh"
  mkdir -p "$TOOL_DIR/run"
  for pair in "scraper4:supervise.sh" "s4tick:tick-supervise.sh" "s4update:update-supervise.sh"; do
    name="\${pair%%:*}"; script="\${pair##*:}"; pidf="$TOOL_DIR/run/\$name.pid"
    if [ -f "\$pidf" ] && kill -0 "\$(cat "\$pidf")" 2>/dev/null; then continue; fi
    nohup bash "$TOOL_DIR/\$script" >/dev/null 2>&1 &
    echo \$! > "\$pidf"
  done
fi
EOF
  chmod +x "$boot/scraper4.sh"
  say "  written: $boot/scraper4.sh"
  say "  install the Termux:Boot app (F-Droid/Play) and open it once, and set"
  say "  Settings > Apps > Termux > Battery > Unrestricted, or Android will"
  say "  suspend the server after a while."
  if have termux-wake-lock; then
    termux-wake-lock 2>/dev/null && say "  wake lock: acquired" || warn "wake lock failed"
  else
    say "  wake lock: termux-wake-lock not available (pkg install termux-tools)"
  fi
}

# ============================================================ health/probe
http_probe() {  # http_probe <query> -> "code bytes"; body lands in probe.out
  local q="$1" out
  mkdir -p "$TOOL_DIR" 2>/dev/null
  : > "$TOOL_DIR/probe.out"          # always exists, so callers never hit a stale/absent file
  out="$(curl -sS -o "$TOOL_DIR/probe.out" -w '%{http_code} %{size_download}' --max-time 40 \
        "http://127.0.0.1:$PORT/$APP_FILE?$q" 2>/dev/null)"
  printf '%s' "${out:-000 0}"
}

peek() {  # peek <bytes> -> first N bytes of the last probe, or a placeholder
  local n="${1:-200}"
  if [ -s "$TOOL_DIR/probe.out" ]; then head -c "$n" "$TOOL_DIR/probe.out" | tr -d '\n'
  else printf '(empty body)'; fi
}

clean_response() {  # clean_response <file> -> 0 when the body is not PHP noise
  local f="$1"
  [ -s "$f" ] || return 1
  head -c 600 "$f" | grep -qE 'Fatal error|Parse error|Uncaught |^Warning: |^Deprecated: |^Notice: ' && return 1
  return 0
}

health() {
  hr; say "== Health =="
  if ! have curl; then warn "curl missing"; return 0; fi
  local r code bytes
  r="$(http_probe 'whoami=1')"; code="${r%% *}"; bytes="${r##* }"
  say "  ?whoami=1                 http=$code bytes=$bytes"
  if [ "$code" = 200 ] && clean_response "$TOOL_DIR/probe.out"; then
    say "    $(peek 220)"
  else
    warn "no clean answer - is the server running? (bash $0 --status)"
  fi
  r="$(http_probe 'ops_feedback=1')"; code="${r%% *}"
  say "  ?ops_feedback=1           http=$code"
  [ "$code" = 200 ] && say "    $(peek 400)"
  r="$(http_probe 'matrix_execution_status=1')"; say "  ?matrix_execution_status=1 http=${r%% *} : $(peek 220)"
  r="$(http_probe 'sync_matrix_feedback=1&probe=1')"; say "  ?sync_matrix_feedback     http=${r%% *} : $(peek 220)"
  r="$(http_probe 'ai_test_status=1')"; say "  ?ai_test_status=1         http=${r%% *} : $(peek 220)"
  r="$(http_probe 'extract_queue_status=1')"; say "  ?extract_queue_status=1   http=${r%% *} : $(peek 220)"
  rm -f "$TOOL_DIR/probe.out" 2>/dev/null
}

# ================================================================ update
update_once() {
  hr; say "== Auto-update check =="
  local target="$INSTALL_DIR/$APP_FILE" tmp="$INSTALL_DIR/.update-$APP_FILE"
  mkdir -p "$INSTALL_DIR/backups" "$LOG_DIR" 2>/dev/null
  say "  channel: $REPO@$CHANNEL  file: $APP_FILE"
  if [ "$DRY" = 1 ]; then
    printf '[dry-run] download -> verify -> backup -> atomic swap -> probe -> rollback on failure\n'
    return 0
  fi
  if ! github_fetch "$APP_FILE" "$tmp"; then
    say "  RESULT=no-download (offline or the branch moved); keeping the installed file"
    return 0
  fi
  local vr; vr="$(verify_scraper_file "$tmp")"
  say "  candidate: $vr"
  case "$vr" in
    VERIFY_OK*) : ;;
    *) rm -f "$tmp"; say "  RESULT=rejected (gate failed)"; return 0 ;;
  esac
  local newv curv
  newv="$(app_version_of "$tmp")"
  curv="$(app_version_of "$target" 2>/dev/null || echo '')"
  if [ -f "$target" ] && [ -n "$curv" ] && ! version_ge "$newv" "$curv"; then
    rm -f "$tmp"
    say "  RESULT=skipped (installed $curv is not older than candidate $newv - no downgrade)"
    return 0
  fi
  if [ -f "$target" ] && [ "$(sha16_of "$target")" = "$(sha16_of "$tmp")" ]; then
    rm -f "$tmp"; say "  RESULT=up-to-date ($curv)"; return 0
  fi
  # back up, then swap atomically (mv, never write in place)
  if [ -f "$target" ]; then
    local bak="$INSTALL_DIR/backups/$APP_FILE.${curv:-unknown}.$(date +%Y%m%d-%H%M%S)"
    cp -p "$target" "$bak" 2>/dev/null && say "  backup: $bak"
    ls -1t "$INSTALL_DIR/backups/" 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | while read -r old; do
      [ -n "$old" ] && rm -f "$INSTALL_DIR/backups/$old"
    done
  fi
  chmod 644 "$tmp" 2>/dev/null
  mv -f "$tmp" "$target" || { say "  RESULT=swap-failed"; return 1; }
  say "  installed: $curv -> $newv"
  # Prove the new file actually serves.  Roll back ONLY on evidence that the
  # new file is broken (a 200 with PHP error text, or a 500).  An unreachable
  # server (http=000 - stopped, still booting, or the port changed) is NOT
  # evidence against the file, which already passed php -l, so keep it.
  sleep 1
  local r code
  r="$(http_probe 'whoami=1')"; code="${r%% *}"
  if [ "$code" = 200 ] && clean_response "$TOOL_DIR/probe.out"; then
    say "  post-update probe: http=$code clean body"
    say "  RESULT=updated version=$newv"
  elif [ "$code" = 000 ] || [ "$code" = 000000 ]; then
    warn "post-update probe: server not reachable (http=$code). The file passed"
    warn "php -l and the content gate, so it is KEPT (no rollback). Start the"
    warn "server and re-check:  bash $TOOL_DIR/s4-install.sh --doctor"
    say "  RESULT=updated-unverified version=$newv (server not running)"
  else
    warn "post-update probe failed (http=$code, broken body) - rolling back"
    local last; last="$(ls -1t "$INSTALL_DIR/backups/" 2>/dev/null | head -1)"
    if [ -n "$last" ]; then
      cp -p "$INSTALL_DIR/backups/$last" "$target" && say "  restored: $last"
      say "  RESULT=rolled-back to=$last"
    else
      say "  RESULT=rolled-back-failed (no backup available)"
    fi
  fi
  rm -f "$TOOL_DIR/probe.out" "$tmp" 2>/dev/null
  return 0
}

self_update_installer() {
  hr; say "== Installer self-update =="
  if [ "$DRY" = 1 ]; then printf '[dry-run] refresh %s/s4-install.sh from GitHub\n' "$TOOL_DIR"; return 0; fi
  mkdir -p "$TOOL_DIR"
  if github_fetch "deploy/s4-install.sh" "$TOOL_DIR/s4-install.sh.new"; then
    chmod +x "$TOOL_DIR/s4-install.sh.new"
    if bash -n "$TOOL_DIR/s4-install.sh.new" 2>/dev/null; then
      local nv; nv="$(grep -m1 '^VERSION=' "$TOOL_DIR/s4-install.sh.new" | cut -d'"' -f2)"
      mv -f "$TOOL_DIR/s4-install.sh.new" "$TOOL_DIR/s4-install.sh"
      say "  installer updated: $VERSION -> ${nv:-unknown}"
      say "  re-run it to apply the new version: bash $TOOL_DIR/s4-install.sh"
    else
      rm -f "$TOOL_DIR/s4-install.sh.new"; warn "downloaded installer failed bash -n; kept the current one"
    fi
  else
    warn "could not download the installer"
  fi
}

# ============================================================== lifecycle
listening() { have ss && ss -ltn 2>/dev/null | grep -q ":$1 "; }

start_stack() {
  hr; say "== Start =="
  if [ "$DRY" = 1 ]; then printf '[dry-run] start scraper4 + s4tick + s4update\n'; return 0; fi
  if have sv; then
    for s in scraper4 s4tick s4update; do
      if [ "$(loop_interval "$s")" = 0 ]; then say "  $s: disabled (interval 0), not started"; continue; fi
      sv start "$s" 2>/dev/null && say "  sv start $s: ok" || warn "sv start $s failed"
    done
  else
    mkdir -p "$TOOL_DIR/run"
    for pair in "scraper4:supervise.sh" "s4tick:tick-supervise.sh" "s4update:update-supervise.sh"; do
      local name script pidf
      name="${pair%%:*}"; script="${pair##*:}"; pidf="$TOOL_DIR/run/$name.pid"
      if [ "$(loop_interval "$name")" = 0 ]; then rm -f "$pidf" 2>/dev/null; say "  $name: disabled (interval 0), not started"; continue; fi
      if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then say "  $name already running (pid $(cat "$pidf"))"; continue; fi
      nohup bash "$TOOL_DIR/$script" >/dev/null 2>&1 & echo $! > "$pidf"
      sleep 1
      if kill -0 "$(cat "$pidf" 2>/dev/null)" 2>/dev/null; then
        say "  $name started (pid $(cat "$pidf"), fallback supervisor)"
      else
        rm -f "$pidf" 2>/dev/null
        warn "$name exited at once - see $LOG_DIR/supervise.log"
      fi
    done
  fi
  sleep 2
  if listening "$PORT"; then say "  port $PORT: LISTENING"; else warn "nothing listening on $PORT yet"; fi
}

# Period of a loop as configured on the command line / environment.
# 0 means the loop is switched off, so it must not be started at all:
# its wrapper exits immediately and a stale pid would look like a crash.
loop_interval() {
  case "$1" in
    s4tick) printf '%s' "${TICK_INTERVAL:-0}" ;;
    s4update) printf '%s' "${UPDATE_INTERVAL:-0}" ;;
    *) printf '1' ;;
  esac
}

stop_stack() {
  hr; say "== Stop =="
  if [ "$DRY" = 1 ]; then printf '[dry-run] stop scraper4 + s4tick + s4update\n'; return 0; fi
  if have sv; then
    for s in s4update s4tick scraper4; do sv stop "$s" 2>/dev/null && say "  sv stop $s: ok"; done
  fi
  for name in s4update s4tick scraper4; do
    local pidf="$TOOL_DIR/run/$name.pid"
    if [ -f "$pidf" ]; then
      kill "$(cat "$pidf")" 2>/dev/null && say "  stopped $name (pid $(cat "$pidf"))"
      rm -f "$pidf"
    fi
  done
  pkill -f "$TOOL_DIR/serve.sh" 2>/dev/null && say "  killed stray serve.sh"
  pkill -f "$TOOL_DIR/tick.sh" 2>/dev/null && say "  killed stray tick.sh"
  pkill -f "$TOOL_DIR/update.sh" 2>/dev/null && say "  killed stray update.sh"
  pkill -f "php -S .*$PORT" 2>/dev/null && say "  killed php -S on $PORT"
  say "  S4_STOP=done"
}

status_stack() {
  hr; say "== Status =="
  say "  installer:  $VERSION"
  say "  install:    $INSTALL_DIR"
  [ -f "$INSTALL_DIR/$APP_FILE" ] && say "  app file:   $APP_FILE $(wc -c < "$INSTALL_DIR/$APP_FILE" | tr -d ' ') bytes, version $(app_version_of "$INSTALL_DIR/$APP_FILE" || echo '?'), sha16 $(sha16_of "$INSTALL_DIR/$APP_FILE")"
  say "  channel:    $REPO@$CHANNEL"
  say "  server:     http://$BIND:$PORT/$APP_FILE  (workers=$WORKERS)"
  say "  tick:       every ${TICK_INTERVAL}s   update: every ${UPDATE_INTERVAL}s   backups kept: $KEEP_BACKUPS"
  say "  php.ini:    $(have php && php -i 2>/dev/null | grep -m1 'Loaded Configuration File' | cut -d: -f2- | tr -d ' ' || echo '?')"
  if [ -f "$TOOL_DIR/env.sh" ]; then
    say "  services:   mode=$(. "$TOOL_DIR/env.sh" 2>/dev/null; echo "${SVC_MODE:-unknown}")"
    if have sv; then
      for s in scraper4 s4tick s4update; do say "              $(sv status "$s" 2>&1 | head -1)"; done
    else
      for s in scraper4 s4tick s4update; do
        local pidf="$TOOL_DIR/run/$s.pid"
        if [ -f "$pidf" ] && kill -0 "$(cat "$pidf")" 2>/dev/null; then say "              $s: running (pid $(cat "$pidf"), supervisor)"; else say "              $s: stopped"; fi
      done
    fi
  else
    say "  services:   not installed yet"
  fi
  for p in "$PORT"; do
    if listening "$p"; then say "  port $p:     LISTENING"; else say "  port $p:     closed"; fi
  done
  local latest
  latest="$(ls -1t "$INSTALL_DIR/backups/" 2>/dev/null | head -1)"
  say "  last backup: ${latest:-none}"
  if listening "$PORT"; then health; fi
}

show_logs() {
  hr; say "== Logs (last 25 lines each) =="
  local f
  for f in "$LOG_DIR/php-error.log" "$LOG_DIR/server.log" "$LOG_DIR/tick.log" "$LOG_DIR/update.log" "$LOG_DIR/supervise.log"; do
    if [ -s "$f" ]; then say "--- $f"; tail -25 "$f" | sed 's/^/    /'; fi
  done
  if have sv; then
    for s in scraper4 s4tick s4update; do
      if [ -d "$LOG_DIR/$s" ]; then
        local cur; cur="$(ls -1t "$LOG_DIR/$s" 2>/dev/null | head -1)"
        [ -n "$cur" ] && { say "--- svlogd $s/$cur"; tail -20 "$LOG_DIR/$s/$cur" | sed 's/^/    /'; }
      fi
    done
  fi
}

uninstall() {
  hr; say "== Uninstall =="
  stop_stack
  if have sv; then
    for s in scraper4 s4tick s4update; do sv-disable "$s" 2>/dev/null && say "  sv-disable $s: ok"; done
  fi
  say "  removing $PFX/etc/sv/{scraper4,s4tick,s4update} and $TOOL_DIR"
  if [ "$DRY" = 0 ]; then
    rm -rf "$PFX/etc/sv/scraper4" "$PFX/etc/sv/s4tick" "$PFX/etc/sv/s4update" 2>/dev/null
    rm -f "$HOME_DIR/.termux/boot/scraper4.sh" 2>/dev/null
    rm -rf "$TOOL_DIR" 2>/dev/null
    have termux-wake-unlock && termux-wake-unlock 2>/dev/null
  fi
  say "  the application folder $INSTALL_DIR was KEPT (delete it yourself if you want:"
  say "  rm -rf $INSTALL_DIR).  php.ini was kept too ($(php_ini_path))."
}

summary() {
  hr
  say "== Done =="
  say "  open:      http://127.0.0.1:$PORT/$APP_FILE"
  [ "$BIND" = "0.0.0.0" ] && say "  from LAN:  http://$( { ip -4 addr show wlan0 2>/dev/null || ifconfig wlan0 2>/dev/null; } | grep -o 'inet [0-9.]*' | head -1 | cut -d' ' -f2):$PORT/$APP_FILE"
  say "  status:    bash $TOOL_DIR/s4-install.sh --status"
  say "  doctor:    bash $TOOL_DIR/s4-install.sh --doctor"
  say "  logs:      bash $TOOL_DIR/s4-install.sh --logs"
  say "  update:    bash $TOOL_DIR/s4-install.sh --update-now"
  say "  stop:      bash $TOOL_DIR/s4-install.sh --stop"
  say "  channel:   $REPO@$CHANNEL  (change with --channel <branch>)"
  say "  scheduler: ?ops_tick=1 every ${TICK_INTERVAL}s, ?cron_run=1 every $((TICK_INTERVAL * 2))s,"
  say "             AI test + matrix probe every $((TICK_INTERVAL * 5))s"
  say ""
  say "  Keep it alive like a VPS:"
  say "    1. install Termux:Boot and open it once  (boot script: ~/.termux/boot/scraper4.sh)"
  say "    2. Settings > Apps > Termux > Battery > Unrestricted"
  say "    3. keep the charger connected for long runs; termux-wake-lock is already on"
  if [ "$BIND" = "127.0.0.1" ]; then
    say ""
    say "  Only this phone can reach the server.  To expose it, re-run with --lan"
    say "  (Android may still block inbound traffic) or tunnel it with ssh -R / Tailscale."
  fi
  say ""
  say "  Related tools in the same repo: deploy/s4-remote.sh (mobile code-server"
  say "  with forced zoom), deploy/s4-fileman.sh (file manager + editor),"
  say "  deploy/s4-agent.sh (feedback rounds), deploy/s4-report.sh (diagnostics)."
  hr
}

# =================================================================== main
if [ "$ACT" = verify ]; then
  [ -n "$VERIFY_FILE" ] || die "--verify-file needs a path"
  verify_scraper_file "$VERIFY_FILE"
  exit $?
fi

if [ "$SELF_UPDATE" = 1 ]; then self_update_installer; fi

if [ "$UPDATE_ONLY" = 1 ]; then
  [ -f "$TOOL_DIR/env.sh" ] && . "$TOOL_DIR/env.sh"
  PORT="${S4_PORT:-$PORT}"; INSTALL_DIR="${S4_INSTALL_DIR:-$INSTALL_DIR}"
  APP_FILE="${S4_FILE:-$APP_FILE}"; REPO="${S4_REPO:-$REPO}"; CHANNEL="${S4_CHANNEL:-$CHANNEL}"
  KEEP_BACKUPS="${S4_KEEP_BACKUPS:-$KEEP_BACKUPS}"
  RAWBASE="https://raw.githubusercontent.com/$REPO/$CHANNEL"
  APIBASE="https://api.github.com/repos/$REPO/contents"
  LOG_DIR="$INSTALL_DIR/logs"
  mkdir -p "$TOOL_DIR" "$LOG_DIR" 2>/dev/null
  update_once
  exit 0
fi

case "$ACT" in
  status)   status_stack; exit 0 ;;
  logtail)  log_tail; exit 0 ;;
  doctor)   health; exit 0 ;;
  logs)     show_logs; exit 0 ;;
  stop)     stop_stack; exit 0 ;;
  start)    start_stack; exit 0 ;;
  restart)  stop_stack; start_stack; exit 0 ;;
  uninstall) uninstall; exit 0 ;;
  update-now)
    detect_env
    update_once
    health
    exit 0
    ;;
esac

# ------------------------------------------------------------ full install
log_header "$@"
say "s4-install $VERSION - scraper4 on Termux, VPS-like, with auto-update"
say "target: $INSTALL_DIR  port: $PORT  workers: $WORKERS  channel: $REPO@$CHANNEL"
[ "$DRY" = 1 ] && say "*** DRY RUN: nothing will be changed ***"
if [ "$ASSUME_YES" = 0 ]; then
  printf 'Proceed? [Y/n] '
  read -r ans
  case "$ans" in n|N|no|NO) die "cancelled by user" ;; esac
fi

detect_env
have curl || die "curl is required"
if ! net_ok; then warn "GitHub does not answer right now - installing from local files if present"; fi
install_packages
setup_php
install_source
write_tool_files
ensure_installer_copy
install_services
write_boot_script
if [ "$DRY" = 0 ]; then start_stack; sleep 2; fi
update_once
status_stack
summary
say "S4_INSTALL=done version=$VERSION mode=${SVC_MODE:-none} port=$PORT"
