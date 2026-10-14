#!/usr/bin/env bash
# =====================================================================
#  deploy/tests/s4-install-selftest.sh  v1.0
#  Regression tests for deploy/s4-install.sh.  Runs anywhere (Termux, a
#  VPS, CI).  No network needed for the core checks; the live-update
#  checks skip politely when GitHub is unreachable.
#
#    bash deploy/tests/s4-install-selftest.sh
#
#  It builds a throwaway "Termux" (fake $PREFIX, fake php/sv/svlogd, a stub
#  1.2 MB scraper4.php), installs into it, and asserts the things that have
#  actually broken before:
#    - `local a=.. b="$a"`   (set -u aborts: every word is expanded before
#      any assignment happens) - this killed the supervisor fallback
#    - version_ge inverted by `sort -V -C` - installed DOWNGRADES
#    - the update gate (size / <?php / APP_VERSION / matrixBuild / php -l)
#    - rollback only on a broken response, never on an unreachable server
#    - every generated run/tick/update/boot script passes bash -n
#    - all output is pure ASCII English
# =====================================================================
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
TARGET="$DEPLOY/s4-install.sh"
ROOT="${TMPDIR:-/tmp}/s4-install-selftest-$$"
FH="$ROOT/home"; FP="$ROOT/pfx"; FI="$ROOT/inst"; FB="$ROOT/bin"; FB2="$ROOT/bin2"
PORT=18097

PASS=0; FAIL=0; SKIP=0; FAILED_NAMES=""
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); FAILED_NAMES="$FAILED_NAMES | $1"; printf '  FAIL %s :: %s\n' "$1" "${2:-}"; }
skip() { SKIP=$((SKIP + 1)); printf '  skip %s (%s)\n' "$1" "$2"; }
sec()  { printf '\n== %s ==\n' "$1"; }

# assertion helpers: no eval, no quoting traps
a_eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "got [$2] want [$3]"; fi; }
a_ne()   { if [ "$2" != "$3" ]; then ok "$1"; else bad "$1" "value is [$2]"; fi; }
a_ge()   { if [ "${2:-0}" -ge "${3:-0}" ] 2>/dev/null; then ok "$1"; else bad "$1" "got [$2] want >= [$3]"; fi; }
a_has()  { if printf '%s' "$2" | grep -qF -- "$3"; then ok "$1"; else bad "$1" "missing [$3] in: $(printf '%s' "$2" | head -c 200)"; fi; }
a_lacks(){ if printf '%s' "$2" | grep -qF -- "$3"; then bad "$1" "found forbidden [$3]"; else ok "$1"; fi; }
a_file() { if [ -f "$2" ]; then ok "$1"; else bad "$1" "no such file: $2"; fi; }
a_exec() { if [ -x "$2" ]; then ok "$1"; else bad "$1" "not executable: $2"; fi; }
a_rc()   { if [ "$2" = 0 ]; then ok "$1"; else bad "$1" "exit code $2"; fi; }
a_grep() { if grep -qF -- "$3" "$2" 2>/dev/null; then ok "$1"; else bad "$1" "[$3] not in $2"; fi; }
a_ngrep(){ if grep -qF -- "$3" "$2" 2>/dev/null; then bad "$1" "found [$3] in $2"; else ok "$1"; fi; }

cleanup() {
  local n pidf
  for n in s4update s4tick scraper4; do
    pidf="$FH/.s4-install/run/$n.pid"
    [ -f "$pidf" ] && kill -9 "$(cat "$pidf" 2>/dev/null)" 2>/dev/null
  done
  sleep 1
  rm -rf "$ROOT" 2>/dev/null
}
trap cleanup EXIT INT TERM

[ -f "$TARGET" ] || { echo "MISSING: $TARGET"; exit 2; }
mkdir -p "$FH" "$FP/etc" "$FI" "$FB" "$FB2"

# --------------------------------------------------------- fake toolchain
cat > "$FB/php" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -l) if [ -n "${S4_FAKE_LINT_FAIL:-}" ]; then echo "Parse error: syntax error in ${2:-}"; exit 1; fi
      echo "No syntax errors detected in ${2:-}"; exit 0 ;;
  -r) case "${2:-}" in
        *PHP_VERSION*)     printf '8.5.1 cli' ;;
        *display_errors*)  printf 'Off' ;;
        *memory_limit*)    printf '512M' ;;
        *opcache.enable*)  printf '1' ;;
        *file_cache_only*) printf '1' ;;
        *)                 printf '' ;;
      esac; exit 0 ;;
  -i) echo "Loaded Configuration File => ${PREFIX:-/usr}/etc/php.ini"; exit 0 ;;
  -v) echo "PHP 8.5.1 (cli)"; exit 0 ;;
  -S) echo "[fake php] server mode"; exit 0 ;;
esac
exit 0
EOF
for c in sv sv-enable sv-disable svlogd; do
  cat > "$FB/$c" <<EOF
#!/usr/bin/env bash
echo "run: $c: (pid 4242) running"
exit 0
EOF
done
chmod +x "$FB"/* 2>/dev/null
cp "$FB/php" "$FB2/php" && chmod +x "$FB2/php"   # a PATH with php but no sv

# a stub app file that satisfies the gate (>= 1 MB, all markers present)
if command -v python3 >/dev/null 2>&1; then
  python3 - "$FI/scraper4.php" <<'PY'
import sys
body = "<?php\nconst APP_VERSION = '10.361';\nfunction matrixBuild() { return true; }\n"
body += "// filler line to reach the 1 MB gate\n" * 30000
open(sys.argv[1], "w", encoding="utf-8").write(body)
PY
else
  {
    printf '<?php\n'
    printf "const APP_VERSION = '10.361';\n"
    printf 'function matrixBuild() { return true; }\n'
    i=0; while [ "$i" -lt 30000 ]; do printf '// filler line to reach the 1 MB gate\n'; i=$((i + 1)); done
  } > "$FI/scraper4.php"
fi

export HOME="$FH" PREFIX="$FP"
P1="$FB:$PATH"; P2="$FB2:$PATH"
run_inst() { PATH="$P1" timeout 240 bash "$TARGET" --dir "$FI" --port "$PORT" --no-packages "$@"; }
run_inst2() { PATH="$P2" timeout 240 bash "$TARGET" --dir "$FI" --port "$PORT" --no-packages "$@"; }

# ------------------------------------------------------- 1. static checks
sec "1  static checks on the installer"
bash -n "$TARGET"; a_rc "bash -n passes" "$?"
NONASCII=$(LC_ALL=C tr -d '\000-\177' < "$TARGET" | wc -c | tr -d ' ')
a_eq "installer source is pure ASCII (English only)" "$NONASCII" "0"
a_ngrep "no 'local name=\${pair..} pidf=\$name' set -u trap" "$TARGET" 'local name="${pair'
a_grep "supervisor loop splits its locals" "$TARGET" 'name="${pair%%:*}"; script='
a_grep "tick.sh guards interval 0" "$TARGET" 'disabled (tick-interval 0)'
a_grep "update.sh guards interval 0" "$TARGET" 'disabled (update-interval 0)'
a_grep "unreachable server does NOT roll back" "$TARGET" 'RESULT=updated-unverified'
a_grep "a failure leaves a greppable marker" "$TARGET" 'S4_INSTALL=fail reason='
a_grep "every line is written to an install log" "$TARGET" 'logs/install.log'
a_grep "an unknown flag dies with the marker" "$TARGET" 'die "unknown flag'
BOGUS="$(bash "$TARGET" --bogus-flag 2>&1)"; BRC=$?
a_eq "an unknown flag exits 1" "$BRC" "1"
a_has "an unknown flag prints S4_INSTALL=fail" "$BOGUS" 'S4_INSTALL=fail reason=unknown flag' 
a_grep "PHP_CLI_SERVER_WORKERS is exported" "$TARGET" 'PHP_CLI_SERVER_WORKERS="$S4_WORKERS"'
a_grep "opcache file_cache_only mode exists" "$TARGET" 'opcache.file_cache_only = 1'
a_grep "opcache validate_timestamps stays on" "$TARGET" 'opcache.validate_timestamps = 1'
a_grep "mirrors instead of editing shared storage" "$TARGET" 'never edited'
HELP_OUT="$(bash "$TARGET" --help 2>&1)"
a_lacks "--help prints only the header" "$HELP_OUT" 'set -u'
a_has "--help documents --update-now" "$HELP_OUT" '--update-now'
a_eq "--version" "$(bash "$TARGET" --version 2>&1)" "s4-install 1.0.1"

# --------------------------------------------------- 2. version compare
sec "2  version compare (a downgrade must never install)"
awk '/^version_ge\(\) \{/,/^\}/' "$TARGET" > "$ROOT/vg.sh"
cat >> "$ROOT/vg.sh" <<'EOF'
set -u
t() { if version_ge "$1" "$2"; then r="ge"; else r="lt"; fi
      if [ "$r" = "$3" ]; then echo "ok $1 vs $2"; else echo "BAD $1 vs $2 got $r want $3"; fi; }
t 10.361 10.360 ge
t 10.360 10.361 lt
t 10.361 10.361 ge
t 10.9   10.10  lt
t 10.10  10.9   ge
t 11.0   10.999 ge
t ""     10.1   lt
t 10.1   ""     ge
t 1.0.4  1.0.3  ge
t 2.0    10.1   lt
EOF
VG="$(bash "$ROOT/vg.sh" 2>&1)"
BADV="$(printf '%s\n' "$VG" | grep -c '^BAD' || true)"
a_eq "all 10 version comparisons correct" "${BADV:-0}" "0"
[ "${BADV:-0}" = 0 ] || printf '%s\n' "$VG" | grep '^BAD' | sed 's/^/       /'

# ------------------------------------------------------- 3. update gate
sec "3  the update gate (--verify-file)"
V_OK="$(PATH="$P1" bash "$TARGET" --verify-file "$FI/scraper4.php" 2>&1)"
a_has "accepts a good file" "$V_OK" 'VERIFY_OK version=10.361'
head -c 900000 "$FI/scraper4.php" > "$ROOT/small.php"
a_has "rejects a too-small file" "$(PATH="$P1" bash "$TARGET" --verify-file "$ROOT/small.php" 2>&1)" 'too-small'
sed 's/const APP_VERSION/const XVERSION/' "$FI/scraper4.php" > "$ROOT/nover.php"
a_has "rejects a missing APP_VERSION" "$(PATH="$P1" bash "$TARGET" --verify-file "$ROOT/nover.php" 2>&1)" 'no-APP_VERSION'
sed 's/function matrixBuild/function xatrixBuild/' "$FI/scraper4.php" > "$ROOT/nomb.php"
a_has "rejects a missing matrixBuild" "$(PATH="$P1" bash "$TARGET" --verify-file "$ROOT/nomb.php" 2>&1)" 'no-matrixBuild'
printf '<?php echo 1;\n' > "$ROOT/tiny.php"
a_has "rejects a file that is not the app" "$(PATH="$P1" bash "$TARGET" --verify-file "$ROOT/tiny.php" 2>&1)" 'VERIFY_FAIL'
S4_FAKE_LINT_FAIL=1 PATH="$P1" bash "$TARGET" --verify-file "$FI/scraper4.php" > "$ROOT/lint.out" 2>&1
a_grep "rejects a php -l failure" "$ROOT/lint.out" 'php-lint'
a_has "reports size and fingerprint" "$V_OK" 'sha16='

# ------------------------------------------------ 4. full install (runit)
sec "4  full install into the fake Termux (runit path)"
OUT="$(run_inst --opcache off 2>&1)"; RC=$?
a_rc "installer exits 0" "$RC"
a_has "prints S4_INSTALL=done" "$OUT" 'S4_INSTALL=done'
a_has "chose runit mode" "$OUT" 'mode: runit'
a_lacks "no unbound-variable abort" "$OUT" 'unbound variable'
OUT_NA=$(printf '%s' "$OUT" | LC_ALL=C tr -d '\000-\177' | wc -c | tr -d ' ')
a_eq "installer output is pure ASCII English" "$OUT_NA" "0"
a_file "wrote php.ini" "$FP/etc/php.ini"
a_grep "php.ini turns display_errors off" "$FP/etc/php.ini" 'display_errors = Off'
a_grep "php.ini turns log_errors on" "$FP/etc/php.ini" 'log_errors = On'
a_grep "php.ini points error_log at the install" "$FP/etc/php.ini" "error_log = $FI/logs/php-error.log"
a_grep "php.ini raises memory_limit" "$FP/etc/php.ini" 'memory_limit = 512M'
a_file "wrote env.sh" "$FH/.s4-install/env.sh"
a_grep "env.sh has the port" "$FH/.s4-install/env.sh" "S4_PORT='$PORT'"
a_grep "env.sh has the workers" "$FH/.s4-install/env.sh" "S4_WORKERS='8'"
a_grep "env.sh has the channel" "$FH/.s4-install/env.sh" "S4_CHANNEL='arena/f5a628bb-new'"
a_grep "env.sh has the update interval" "$FH/.s4-install/env.sh" "S4_UPDATE_INTERVAL='300'"
a_exec "serve.sh is executable" "$FH/.s4-install/serve.sh"
a_exec "tick.sh is executable" "$FH/.s4-install/tick.sh"
a_exec "update.sh is executable" "$FH/.s4-install/update.sh"
a_exec "supervise.sh is executable" "$FH/.s4-install/supervise.sh"
a_exec "boot script is executable" "$FH/.termux/boot/scraper4.sh"
a_file "stored a copy of itself for the services" "$FH/.s4-install/s4-install.sh"
GEN_FAIL=""
for f in "$FH"/.s4-install/*.sh "$FP"/etc/sv/*/run "$FP"/etc/sv/*/log/run "$FH"/.termux/boot/*.sh; do
  [ -f "$f" ] || continue
  bash -n "$f" 2>/dev/null || GEN_FAIL="$GEN_FAIL $f"
done
a_eq "every generated script passes bash -n" "$GEN_FAIL" ""
a_grep "runit run script points at serve.sh" "$FP/etc/sv/scraper4/run" "$FH/.s4-install/serve.sh"
a_grep "s4tick run script can disable itself" "$FP/etc/sv/s4tick/run" 'disabled (tick-interval 0)'
a_grep "svlogd rotation configured" "$FI/logs/scraper4/config" 's20000000'
a_grep "serve.sh cds into the install dir" "$FH/.s4-install/serve.sh" 'cd "$S4_INSTALL_DIR"'
a_grep "tick.sh drives ?ops_tick=1" "$FH/.s4-install/tick.sh" 'ops_tick=1'
a_grep "tick.sh drives ?cron_run=1" "$FH/.s4-install/tick.sh" 'cron_run=1'
a_grep "tick.sh drives the AI test" "$FH/.s4-install/tick.sh" 'ai_test_status=1&drive=1'
a_grep "update.sh calls the installer" "$FH/.s4-install/update.sh" '--update-only'
a_file "the run was written to the install log" "$FH/.s4-install/logs/install.log"
a_grep "the log holds the success marker" "$FH/.s4-install/logs/install.log" 'S4_INSTALL=done'
a_grep "the log holds a session header" "$FH/.s4-install/logs/install.log" '==== s4-install 1.0.1'
a_lacks "no prompt when stdin is not a terminal" "$OUT" 'Proceed?'
LT="$(run_inst --log-tail 20 2>&1)"; LRC=$?
a_rc "--log-tail exits 0" "$LRC"
a_has "--log-tail reports done" "$LT" 'S4_LOGTAIL=done'
a_has "--log-tail shows the last outcome" "$LT" 'S4_INSTALL=done'

# ------------------------------------------------------- 5. lifecycle
sec "5  lifecycle: status / logs / stop"
ST="$(run_inst --status 2>&1)"; RC=$?
a_rc "--status exits 0" "$RC"
a_has "--status reports the install dir" "$ST" "$FI"
a_has "--status reports the app version" "$ST" 'version 10.361'
a_has "--status reports the channel" "$ST" 'fazilatma/new@arena/f5a628bb-new'
LG="$(run_inst --logs 2>&1)"; a_rc "--logs exits 0" "$?"
SP="$(run_inst --stop 2>&1)";  a_has "--stop reports done" "$SP" 'S4_STOP=done'

# --------------------------------------------- 6. supervisor fallback
sec "6  supervisor fallback (no sv on PATH)"
OUT2="$(run_inst2 --no-boot --update-interval 0 --tick-interval 0 2>&1)"; RC2=$?
a_rc "install exits 0 without runit" "$RC2"
a_has "falls back to the supervisor" "$OUT2" 'mode: supervisor'
a_lacks "no unbound-variable abort (the old bug)" "$OUT2" 'unbound variable'
NDIS="$(printf '%s\n' "$OUT2" | grep -c 'disabled (interval 0), not started' || true)"
a_ge "a 0 interval disables the loop instead of crash-looping it" "${NDIS:-0}" 2
a_file "writes the scraper4 pidfile" "$FH/.s4-install/run/scraper4.pid"
if [ -f "$FH/.s4-install/run/scraper4.pid" ] && kill -0 "$(cat "$FH/.s4-install/run/scraper4.pid" 2>/dev/null)" 2>/dev/null; then
  ok "the supervisor loop is really alive"
else
  bad "the supervisor loop is really alive" "pidfile dead or missing"
fi
a_ne "no stale pidfile for a disabled loop" "$([ -f "$FH/.s4-install/run/s4tick.pid" ] && echo yes || echo no)" "yes"
ST2="$(run_inst2 --stop 2>&1)"
a_has "--stop works in supervisor mode" "$ST2" 'S4_STOP=done'

# ------------------------------------------------------ 7. dry run
sec "7  --dry-run changes nothing"
rm -rf "$ROOT/dry"; mkdir -p "$ROOT/dry"
BEFORE="$(cd "$FH" && find . -type f 2>/dev/null | sort | md5sum | cut -c1-16)"
PATH="$P1" timeout 120 bash "$TARGET" --dry-run --dir "$ROOT/dry" --port 18099 --no-packages --no-boot > "$ROOT/dry.out" 2>&1
AFTER="$(cd "$FH" && find . -type f 2>/dev/null | sort | md5sum | cut -c1-16)"
NDRY="$(grep -c 'dry-run' "$ROOT/dry.out" || true)"
a_ge "dry-run announces its actions" "${NDRY:-0}" 3
a_eq "dry-run wrote no files into the target dir" "$(find "$ROOT/dry" -type f 2>/dev/null | wc -l | tr -d ' ')" "0"
a_eq "dry-run left the tool dir untouched" "$BEFORE" "$AFTER"

# ------------------------------------- 8. live update (needs GitHub)
sec "8  live update path (needs GitHub; skipped offline)"
if curl -fsS --connect-timeout 8 --max-time 20 -o /dev/null https://api.github.com 2>/dev/null; then
  sed "s/const APP_VERSION = '10.361'/const APP_VERSION = '10.999'/" "$FI/scraper4.php" > "$ROOT/bumped.php"
  mv "$ROOT/bumped.php" "$FI/scraper4.php"
  UP="$(run_inst --update-now 2>&1)"
  if printf '%s' "$UP" | grep -qF 'RESULT=skipped'; then
    ok "refuses to install a downgrade"
  else
    bad "refuses to install a downgrade" "$(printf '%s' "$UP" | grep -E 'RESULT|candidate' | head -3)"
  fi
  a_lacks "server-down never triggers a rollback" "$UP" 'RESULT=rolled-back'
  sed "s/const APP_VERSION = '10.999'/const APP_VERSION = '10.361'/" "$FI/scraper4.php" > "$ROOT/back.php"
  mv "$ROOT/back.php" "$FI/scraper4.php"
  UP2="$(run_inst --update-now 2>&1)"
  if printf '%s' "$UP2" | grep -qE 'RESULT=(updated|updated-unverified|up-to-date|skipped)'; then
    ok "a real update attempt ends in a defined state"
  else
    bad "a real update attempt ends in a defined state" "$(printf '%s' "$UP2" | grep RESULT | head -2)"
  fi
  a_lacks "still no rollback when the server is down" "$UP2" 'RESULT=rolled-back'
else
  skip "live update checks" "api.github.com unreachable"
fi

printf '\n========================================\n'
printf 'passed=%s  failed=%s  skipped=%s\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf 'failed:%s\n' "$FAILED_NAMES"
  echo TESTS_FAILED
  exit 1
fi
echo ALL_TESTS_PASSED
