#!/usr/bin/env bash
# =====================================================================
#  round r1-shared-storage-opcache
#
#  Goal: prove on the device (a) why "php -S" dies, (b) exactly what the
#  shared-storage folder refuses to do, (c) where deploy.php and
#  scraper4.php want to write their state, and (d) whether the panel
#  answers once it is served from internal storage.
#
#  Read-only with respect to YOUR folder: everything is mirrored into
#  $S4_RUNDIR first, and only probe files are created (and removed).
# =====================================================================
# shellcheck disable=SC1090
. "$S4_HELPERS"

s4_say "round $S4_ROUND_ID · host $S4_HOST_SLUG · $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
s4_say "srcdir=$S4_SRCDIR (shared_storage=$S4_SRC_SHARED)"
s4_say "rundir=$S4_RUNDIR"

# ---------------------------------------------------------------- A. PHP
s4_hr; s4_say "A. PHP"
php -v 2>&1 | head -2
php -r 'printf("sapi=%s ini=%s display_errors=%s error_reporting=%s memory_limit=%s\n",
  PHP_SAPI, php_ini_loaded_file() ?: "<none>", ini_get("display_errors"),
  ini_get("error_reporting"), ini_get("memory_limit"));' 2>&1
php -m 2>/dev/null | grep -i opcache && s4_say "opcache: LOADED" || s4_say "opcache: not loaded"
s4_note "opcache ini values:"
php -i 2>/dev/null | grep -iE '^opcache\.' | head -20 | sed 's/^/    /' >> "$S4_REPORT"
s4_say "TMPDIR=${TMPDIR:-<unset>} · PREFIX=${PREFIX:-<unset>}"

# ------------------------------------------- B. what each folder allows
s4_hr; s4_say "B. Directory capabilities"
s4_probe_dir "$S4_SRCDIR" "your folder (source)"
s4_probe_dir "$S4_RUNDIR" "run dir (internal)"
s4_probe_dir "${TMPDIR:-/tmp}" "TMPDIR"
s4_probe_dir "${PREFIX:-/nonexistent}/tmp" "PREFIX/tmp"
s4_ls "$S4_SRCDIR"

# ------------------------- C. where the two apps want to write their state
s4_hr; s4_say "C. State paths used by the code"
for f in deploy.php scraper4.php; do
  [ -f "$S4_RUNDIR/$f" ] || { s4_say "$f: not mirrored"; continue; }
  s4_say "-- $f ($(s4_size "$S4_RUNDIR/$f") bytes, md5 $(s4_md5 "$S4_RUNDIR/$f"))"
  s4_lint "$S4_RUNDIR/$f"
  s4_grep '__DIR__'                  "$S4_RUNDIR/$f"
  s4_grep 'deploy-config'            "$S4_RUNDIR/$f"
  s4_grep 'sys_get_temp_dir'         "$S4_RUNDIR/$f"
  s4_grep 'flock('                   "$S4_RUNDIR/$f"
  s4_grep 'file_put_contents('       "$S4_RUNDIR/$f"
  s4_grep 'DOCUMENT_ROOT'            "$S4_RUNDIR/$f"
done

# --------------------------------------------- D. php -S startup matrix
s4_hr; s4_say "D. php -S startup matrix (3 s per attempt)"
P="$S4_PORT"
s4_try_server ""                                                              "$P"     "$S4_RUNDIR" "rundir/plain"        ; P=$((P+1))
s4_try_server "-d opcache.enable=0 -d opcache.enable_cli=0"                   "$P"     "$S4_RUNDIR" "rundir/opcache-off"  ; P=$((P+1))
s4_try_server "-d opcache.lockfile_path=${PREFIX:-/tmp}/tmp"                  "$P"     "$S4_RUNDIR" "rundir/lockpath"     ; P=$((P+1))
s4_try_server ""                                                              "$P"     "$S4_SRCDIR" "srcdir/plain"        ; P=$((P+1))
s4_try_server "-d opcache.enable=0 -d opcache.enable_cli=0"                   "$P"     "$S4_SRCDIR" "srcdir/opcache-off"  ; P=$((P+1))

# ------------------------------- E. serve the run dir and exercise it
s4_hr; s4_say "E. Live probe from internal storage"
rm -f "$S4_RUNDIR/php-error.log" 2>/dev/null
if s4_serve "-d opcache.enable=0 -d opcache.enable_cli=0 -d display_errors=0 -d log_errors=1 -d error_log=$S4_RUNDIR/php-error.log" "$S4_PORT" "$S4_RUNDIR"; then
  s4_curl "http://127.0.0.1:$S4_PORT/deploy.php" 1200
  s4_curl "http://127.0.0.1:$S4_PORT/deploy.php?api=public.monitor" 600
  s4_curl "http://127.0.0.1:$S4_PORT/scraper4.php?whoami=1" 900
  s4_curl "http://127.0.0.1:$S4_PORT/scraper4.php?ops_feedback=1" 900
  s4_curl "http://127.0.0.1:$S4_PORT/scraper4.php?matrix_execution_status=1" 600
  s4_curl "http://127.0.0.1:$S4_PORT/scraper4.php?ai_test_status=1" 600
  s4_hr; s4_say "F. What the run produced"
  s4_ls "$S4_RUNDIR"
  [ -s "$S4_RUNDIR/php-error.log" ] && s4_tail "$S4_RUNDIR/php-error.log" 60 || s4_say "php-error.log: empty (clean)"
  s4_tail "$S4_STATE/server.log" 30
  s4_stop_server
else
  s4_say "🚨 could not serve the run dir at all — see section D"
fi

# --------------------------- G. same files, straight from your folder
s4_hr; s4_say "G. Serving YOUR folder directly (for comparison)"
if s4_serve "-d opcache.enable=0 -d opcache.enable_cli=0 -d display_errors=1" "$((S4_PORT+20))" "$S4_SRCDIR"; then
  s4_curl "http://127.0.0.1:$((S4_PORT+20))/deploy.php" 900
  s4_stop_server
fi

s4_hr
s4_say "round finished — waiting for the next instruction"
s4_done needs-input
