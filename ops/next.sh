#!/usr/bin/env bash
# =====================================================================
#  round r2-fileman-remote
#
#  Two jobs in one round:
#    (1) the evidence r1 was meant to collect — why php -S dies, what the
#        shared-storage folder refuses, where deploy.php/scraper4.php write;
#    (2) install and verify the three access routes the user asked for:
#          • s4-fileman.php  → big-touch-target file manager + editor
#          • sshd            → SFTP for Android file managers
#          • code-server     → with mobile-sized UI (zoom + font settings)
#
#  Nothing secret is printed: the file-manager key and the code-server
#  password stay on the device; only HTTP status codes are reported.
# =====================================================================
. "$S4_HELPERS"

s4_say "round $S4_ROUND_ID · host $S4_HOST_SLUG · $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
s4_say "srcdir=$S4_SRCDIR (shared_storage=$S4_SRC_SHARED)  rundir=$S4_RUNDIR"

# ------------------------------------------------------------------ A. PHP
s4_hr; s4_say "A. PHP"
php -v 2>&1 | head -2
php -r 'printf("sapi=%s ini=%s display_errors=%s error_reporting=%s memory_limit=%s\n",
  PHP_SAPI, php_ini_loaded_file() ?: "<none>", ini_get("display_errors"),
  ini_get("error_reporting"), ini_get("memory_limit"));' 2>&1
php -m 2>/dev/null | grep -i opcache && s4_say "opcache: LOADED" || s4_say "opcache: not loaded"
s4_note "opcache ini values:"
php -i 2>/dev/null | grep -iE '^opcache\.' | head -20 | sed 's/^/    /' >> "$S4_REPORT"
s4_say "TMPDIR=${TMPDIR:-<unset>} · PREFIX=${PREFIX:-<unset>}"

# ------------------------------------------------- B. directory capabilities
s4_hr; s4_say "B. Directory capabilities"
s4_probe_dir "$S4_SRCDIR" "your folder (source)"
s4_probe_dir "$S4_RUNDIR" "run dir (internal)"
s4_probe_dir "${TMPDIR:-/tmp}" "TMPDIR"
s4_probe_dir "${PREFIX:-/nonexistent}/tmp" "PREFIX/tmp"
s4_ls "$S4_SRCDIR"

# ------------------------------------------- C. state paths used by the code
s4_hr; s4_say "C. State paths used by the code"
for f in deploy.php scraper4.php; do
  [ -f "$S4_RUNDIR/$f" ] || { s4_say "$f: not mirrored"; continue; }
  s4_say "-- $f ($(s4_size "$S4_RUNDIR/$f") bytes, md5 $(s4_md5 "$S4_RUNDIR/$f"))"
  s4_lint "$S4_RUNDIR/$f"
  s4_grep '__DIR__'            "$S4_RUNDIR/$f"
  s4_grep 'deploy-config'      "$S4_RUNDIR/$f"
  s4_grep 'sys_get_temp_dir'   "$S4_RUNDIR/$f"
  s4_grep 'flock('             "$S4_RUNDIR/$f"
  s4_grep 'file_put_contents(' "$S4_RUNDIR/$f"
  s4_grep 'DOCUMENT_ROOT'      "$S4_RUNDIR/$f"
done

# ------------------------------------------------- D. php -S startup matrix
s4_hr; s4_say "D. php -S startup matrix (3 s per attempt)"
P="$S4_PORT"
s4_try_server ""                                            "$P" "$S4_RUNDIR" "rundir/plain"       ; P=$((P+1))
s4_try_server "-d opcache.enable=0 -d opcache.enable_cli=0" "$P" "$S4_RUNDIR" "rundir/opcache-off" ; P=$((P+1))
s4_try_server ""                                            "$P" "$S4_SRCDIR" "srcdir/plain"       ; P=$((P+1))
s4_try_server "-d opcache.enable=0 -d opcache.enable_cli=0" "$P" "$S4_SRCDIR" "srcdir/opcache-off" ; P=$((P+1))

# ------------------------------------------- E. live probe from internal dir
s4_hr; s4_say "E. Live probe from internal storage"
rm -f "$S4_RUNDIR/php-error.log" 2>/dev/null
if s4_serve "-d opcache.enable=0 -d opcache.enable_cli=0 -d display_errors=0 -d log_errors=1 -d error_log=$S4_RUNDIR/php-error.log" "$S4_PORT" "$S4_RUNDIR"; then
  s4_curl "http://127.0.0.1:$S4_PORT/deploy.php" 1200
  s4_curl "http://127.0.0.1:$S4_PORT/scraper4.php?whoami=1" 900
  s4_curl "http://127.0.0.1:$S4_PORT/scraper4.php?ops_feedback=1" 900
  s4_curl "http://127.0.0.1:$S4_PORT/scraper4.php?matrix_execution_status=1" 600
  s4_hr; s4_say "E2. What the run produced"
  s4_ls "$S4_RUNDIR"
  if [ -s "$S4_RUNDIR/php-error.log" ]; then s4_tail "$S4_RUNDIR/php-error.log" 60; else s4_say "php-error.log: empty (clean)"; fi
  s4_tail "$S4_STATE/server.log" 25
  s4_stop_server
else
  s4_say "🚨 could not serve the run dir at all — see section D"
fi

# ============================== 2. the three access routes ==================
s4_hr; s4_say "F. Installing the access tools"
s4_dl deploy/s4-fileman.sh "$HOME/s4-fileman.sh"
s4_dl deploy/s4-remote.sh  "$HOME/s4-remote.sh"
chmod +x "$HOME/s4-fileman.sh" "$HOME/s4-remote.sh" 2>/dev/null

# ------------------------------------------------- F1. file manager (web UI)
s4_hr; s4_say "F1. s4-fileman.php (mobile file manager + editor)"
FMP=8082
for p in 8082 8083 8090; do
  ss -ltn 2>/dev/null | grep -q ":$p " || { FMP=$p; break; }
  FMP=$p
done
if [ -f "$HOME/s4-fileman.sh" ]; then
  bash "$HOME/s4-fileman.sh" --bg --port "$FMP" --install-to "$S4_SRCDIR" 2>&1 | tail -25
  sleep 1
  NOKEY=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "http://127.0.0.1:$FMP/s4-fileman.php" 2>&1)
  KEYF="$HOME/.s4-fileman/fileman.key"
  if [ -f "$KEYF" ]; then
    WITHKEY=$(curl -sS -o "$S4_STATE/fm.html" -w '%{http_code}' --max-time 25 \
      "http://127.0.0.1:$FMP/s4-fileman.php?key=$(cat "$KEYF" 2>/dev/null)" 2>&1)
    WHO=$(curl -sS --max-time 20 "http://127.0.0.1:$FMP/s4-fileman.php?act=whoami&key=$(cat "$KEYF" 2>/dev/null)" 2>&1 | head -c 500)
    LSK=$(curl -sS --max-time 20 "http://127.0.0.1:$FMP/s4-fileman.php?act=ls&key=$(cat "$KEYF" 2>/dev/null)&path=$S4_SRCDIR" 2>&1 | head -c 500)
  else
    WITHKEY="no-key-file"; WHO=""; LSK=""
  fi
  # NOTE: the URLs above contain the key, so only status codes are reported.
  s4_say "auth check (url hidden): no-key→http=$NOKEY (expect 401) · with-key→http=$WITHKEY (expect 200)"
  s4_note "whoami response (key-free by design):"
  printf '%s\n' "$WHO" | sed 's/^/    /' >> "$S4_REPORT"
  s4_note "ls of srcdir through the file manager:"
  printf '%s\n' "$LSK" | sed 's/^/    /' >> "$S4_REPORT"
  s4_say "key file: $KEYF (NOT uploaded — read it on the phone: cat $KEYF)"
  s4_say "open:  http://127.0.0.1:$FMP/s4-fileman.php?key=<کلید>"
  [ -f "$S4_SRCDIR/s4-fileman.php" ] && s4_say "copy installed in your folder: $S4_SRCDIR/s4-fileman.php ($(s4_size "$S4_SRCDIR/s4-fileman.php") bytes)"
  [ -s "$HOME/.s4-fileman/php-error.log" ] && s4_tail "$HOME/.s4-fileman/php-error.log" 30
  s4_tail "$HOME/.s4-fileman/server.log" 20
else
  s4_say "🚨 ~/s4-fileman.sh did not download"
fi

# ------------------------------------------------------------------- F2. SFTP
s4_hr; s4_say "F2. sshd / SFTP"
if ! command -v sshd >/dev/null 2>&1; then
  s4_say "sshd not installed — installing openssh (this can take a minute)"
  yes | pkg install -y openssh 2>&1 | tail -12
fi
if command -v sshd >/dev/null 2>&1; then
  ls "$PREFIX/etc/ssh"/ssh_host_* >/dev/null 2>&1 || { s4_say "generating host keys"; ssh-keygen -A 2>&1 | tail -6; }
  PWFIELD="$(grep "^$(whoami):" "$PREFIX/etc/passwd" 2>/dev/null | cut -d: -f2)"
  case "$PWFIELD" in
    ''|'*'|'!') s4_say "⚠️ no ssh password set yet → on the phone run:  bash ~/s4-remote.sh --set-password" ;;
    *)          s4_say "ssh password: set ✅" ;;
  esac
  pgrep -f sshd >/dev/null 2>&1 && s4_say "sshd already running" || { sshd -p 8022 2>&1 | tail -5; sleep 1; }
  ss -ltn 2>/dev/null | grep ':8022 ' >/dev/null && s4_say "sshd listening on 8022 ✅" || s4_say "🚨 sshd is NOT listening on 8022"
  s4_say "connect from a file manager: host=127.0.0.1 port=8022 user=$(whoami) path=~"
else
  s4_say "🚨 openssh could not be installed"
fi

# --------------------------------------------------------------- F3. code-server
s4_hr; s4_say "F3. code-server with a mobile-sized UI"
if command -v code-server >/dev/null 2>&1; then
  s4_say "code-server: $(code-server --version 2>&1 | head -1)"
  bash "$HOME/s4-remote.sh" --code --code-port 8081 --zoom 1.6 2>&1 | tail -25
  sleep 2
  CSCODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:8081/" 2>&1)
  s4_say "http://127.0.0.1:8081/ → http=$CSCODE (302/200 means it is up; the login password is in ~/.config/code-server/config.yaml)"
  s4_note "code-server settings now in effect:"
  sed 's/^/    /' "$HOME/.local/share/code-server/User/settings.json" 2>/dev/null | head -30 >> "$S4_REPORT"
else
  s4_say "⚠️ code-server not installed → pkg install code-server (or use the file manager, which is lighter)"
fi

# ------------------------------------------------------------------- summary
s4_hr; s4_say "SUMMARY — what to open on the phone"
s4_say "  1. file manager : http://127.0.0.1:$FMP/s4-fileman.php?key=\$(cat ~/.s4-fileman/fileman.key)"
s4_say "  2. SFTP         : 127.0.0.1:8022  user=$(whoami)  (password: bash ~/s4-remote.sh --set-password)"
s4_say "  3. code-server  : http://127.0.0.1:8081/  (password in ~/.config/code-server/config.yaml)"
s4_say "  restart later   : bash ~/s4-fileman.sh --bg   ·   bash ~/s4-remote.sh   ·   bash ~/s4-agent.sh --loop"

s4_done needs-input
