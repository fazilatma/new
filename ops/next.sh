#!/usr/bin/env bash
# =====================================================================
#  round r4-mobile-ide
#
#  r3 shipped the forced-zoom wrapper, but nothing changed on the device.  Two
#  real defects were found and fixed in v2, and this round proves them:
#    (1) code-server answers with a nonce-locked Content-Security-Policy
#        (script-src 'self' ... 'nonce-XYZ'), so the v1 inline <script> was
#        silently discarded by the browser: no zoom controls, no pinch handler.
#        v2 reuses the page nonce -> assert the served HTML has
#        data-s4="mob" nonce="..." and that the CSP header still carries it.
#    (2) v1 built its payload with String.replace() and a replacement STRING;
#        the shell source contains a bare  $'  (the '$' extra key), which
#        replace() expands to "the rest of the document".  The page tail was
#        spliced into the <script>, so it could not even parse.  v2 uses
#        function replacements -> assert exactly one <body> and exactly one
#        _VSCODE_FILE_ROOT in the served page.
#  This round also verifies the Replit-like mobile shell (bottom tab dock,
#  extra-keys row), the terminal "permission denied" repair (node-pty
#  spawn-helper + explicit Termux bash profile + a real PTY self-test), and
#  that every line of our own tooling is pure ASCII English.
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
s4_dl deploy/s4-csproxy.js   "$HOME/s4-csproxy.js"
s4_dl deploy/s4-csmobile.css "$HOME/.s4-remote/s4-csmobile.css"
s4_dl deploy/s4-csmobile.js  "$HOME/.s4-remote/s4-csmobile.js"
s4_dl deploy/s4-csproxy.js   "$HOME/.s4-remote/s4-csproxy.js"
chmod +x "$HOME/s4-fileman.sh" "$HOME/s4-remote.sh" 2>/dev/null
for f in "$HOME/.s4-remote/s4-csproxy.js" "$HOME/.s4-remote/s4-csmobile.css" "$HOME/.s4-remote/s4-csmobile.js"; do
  s4_say "  $(basename "$f"): $([ -f "$f" ] && wc -c < "$f" | tr -d ' ' || echo MISSING) bytes"
done
if command -v node >/dev/null 2>&1; then
  for f in "$HOME/.s4-remote/s4-csproxy.js" "$HOME/.s4-remote/s4-csmobile.js"; do
    [ -f "$f" ] || continue
    if node --check "$f" >/dev/null 2>&1; then s4_say "  node --check $(basename "$f"): ok"; else s4_say "  node --check $(basename "$f"): SYNTAX ERROR"; fi
  done
fi
s4_say "  language check (our own tooling must be plain English; 0 non-ascii bytes = pass):"
for f in "$HOME/s4-remote.sh" "$HOME/.s4-remote/s4-csproxy.js" "$HOME/.s4-remote/s4-csmobile.js" "$HOME/.s4-remote/s4-csmobile.css"; do
  [ -f "$f" ] || continue
  n=$(LC_ALL=C tr -d '\000-\177' < "$f" 2>/dev/null | wc -c | tr -d ' ')
  s4_say "    $(basename "$f"): non-ascii bytes = ${n:-?}"
done

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
  s4_say "open:  http://127.0.0.1:$FMP/s4-fileman.php?key=<the key printed by s4-fileman.sh>"
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
s4_hr; s4_say "F3. code-server: forced zoom + Replit-like mobile shell + terminal repair"
F3OK=0
PTYOK=0
if command -v code-server >/dev/null 2>&1; then
  s4_say "code-server: $(code-server --version 2>&1 | head -1)"
  s4_say "node: $(command -v node >/dev/null 2>&1 && node -v 2>&1 || echo MISSING)"

  bash "$HOME/s4-remote.sh" --code --code-port 8081 --upstream-port 18081 --zoom 1.5 > "$S4_STATE/remote.log" 2>&1
  RC=$?
  s4_say "s4-remote.sh --code exit=$RC"
  tail -45 "$S4_STATE/remote.log" 2>/dev/null | sed 's/^/    /'
  sleep 2

  UP=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:18081/" 2>&1)
  BODY="$S4_STATE/cs.html"
  HDR="$S4_STATE/cs.hdr"
  PX=$(curl -sS -D "$HDR" -o "$BODY" -w '%{http_code}' --max-time 30 "http://127.0.0.1:8081/" 2>&1)

  cnt() { local n; n=$(grep -c -- "$1" "$BODY" 2>/dev/null | head -1); printf '%s' "${n:-0}"; }
  MARK=$(cnt 's4-cs-mobile-v2'); ZCSS=$(cnt -- '--s4-zoom'); PINCH=$(cnt 'user-scalable=yes')
  BLOCKED=$(cnt 'user-scalable=no'); NONCE=$(cnt 'data-s4="mob" nonce="')
  DOCK=$(cnt 's4mob-dock'); KEYS=$(cnt 's4mob-keys'); INVZ=$(cnt -- '--s4-inv')
  BODIES=$(cnt '<body'); FILEROOT=$(cnt '_VSCODE_FILE_ROOT')
  CSPH=$(grep -ci '^content-security-policy:' "$HDR" 2>/dev/null | head -1); CSPH=${CSPH:-0}
  CSPNONCE=$(grep -i '^content-security-policy:' "$HDR" 2>/dev/null | grep -c "nonce-" | head -1); CSPNONCE=${CSPNONCE:-0}

  s4_say "upstream code-server 127.0.0.1:18081 -> http=$UP"
  s4_say "mobile proxy         127.0.0.1:8081  -> http=$PX"
  s4_say "  marker-v2=$MARK forced-zoom-css=$ZCSS zoom-inverse=$INVZ pinch-unlocked=$PINCH pinch-blocked-left=$BLOCKED"
  s4_say "  shell-script-nonce=$NONCE csp-header=$CSPH csp-header-has-nonce=$CSPNONCE"
  s4_say "  mobile-shell-css: dock=$DOCK keys=$KEYS"
  s4_say "  integrity: <body> tags=$BODIES (must be 1) workbench-startup-scripts=$FILEROOT (must be 1)"

  ST="$S4_STATE/status.json"
  curl -sS --max-time 25 -o "$ST" "http://127.0.0.1:8081/__s4mobile?probe=1" 2>/dev/null
  if [ -s "$ST" ]; then
    s4_say "  proxy self-test endpoint /__s4mobile:"
    if command -v python3 >/dev/null 2>&1; then
      python3 - "$ST" <<'PYY' 2>&1 | sed 's/^/    /'
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception as e:
    print('unreadable:', e); sys.exit(0)
c = d.get('counters', {})
print('version=%s marker=%s zoom=%s uptime=%ss' % (d.get('version'), d.get('marker'), d.get('zoom'), d.get('uptimeSec')))
sh = d.get('shell', {})
print('shell.css=%s (%sB)' % (sh.get('css', {}).get('source'), sh.get('css', {}).get('bytes')))
print('shell.js =%s (%sB)' % (sh.get('js', {}).get('source'), sh.get('js', {}).get('bytes')))
print('nonce.lastSource=%s counts=%s cspRewritten=%s' % (d.get('nonce', {}).get('lastSource'), d.get('nonce', {}).get('counts'), d.get('nonce', {}).get('cspRewritten')))
print('counters: htmlSeen=%s htmlInjected=%s viewportStripped=%s ws=%s upstreamErr=%s browserReports=%s'
      % (c.get('htmlSeen'), c.get('htmlInjected'), c.get('viewportStripped'), c.get('ws'), c.get('upstreamErr'), c.get('browserReports')))
print('upstreamProbe=%s' % d.get('upstreamProbe'))
print('lastError=%s' % d.get('lastError'))
r = d.get('lastBrowserReport')
if not r:
    print('browserReport=none yet (open the page once in the browser, then re-run)')
else:
    print('browserReport=%s' % {k: r.get(k) for k in ('v', 'zoom', 'zoomSupported', 'tabs', 'extraKeys', 'workbench', 'inner', 'acts', 'errs')})
PYY
    else
      head -c 900 "$ST" | sed 's/^/    /'
    fi
  else
    s4_say "  proxy self-test endpoint: NO ANSWER from http://127.0.0.1:8081/__s4mobile"
  fi

  # ---- the integrated terminal: this is the "permission denied" question ----
  s4_say "  terminal (node-pty) evidence:"
  bash "$HOME/s4-remote.sh" --fix-terminal > "$S4_STATE/termfix.log" 2>&1
  grep -E 'spawn-helper|SHELL=|TMPDIR=|pty module|shell:|PTY_OK|PTY_FAIL|PTY_TIMEOUT|PTY_EXIT|PTY_OUTPUT|mount|noexec|code-server install' \
    "$S4_STATE/termfix.log" 2>/dev/null | tail -16 | sed 's/^/    /'
  PTYOK=$(grep -c 'PTY_OK' "$S4_STATE/termfix.log" 2>/dev/null | head -1); PTYOK=${PTYOK:-0}
  s4_say "  PTY_OK lines: $PTYOK"

  # ---- verdict ----
  FAILS=""
  [ "$MARK" -gt 0 ]    || FAILS="$FAILS marker"
  [ "$ZCSS" -gt 0 ]    || FAILS="$FAILS zoom-css"
  [ "$INVZ" -gt 0 ]    || FAILS="$FAILS zoom-inverse"
  [ "$PINCH" -gt 0 ]   || FAILS="$FAILS pinch-unlock"
  [ "$BLOCKED" = 0 ]   || FAILS="$FAILS pinch-still-blocked"
  [ "$DOCK" -gt 0 ]    || FAILS="$FAILS dock-css"
  [ "$KEYS" -gt 0 ]    || FAILS="$FAILS keys-css"
  [ "$BODIES" = 1 ]    || FAILS="$FAILS body-count=$BODIES"
  [ "$FILEROOT" = 1 ]  || FAILS="$FAILS duplicated-page-tail"
  if [ "$CSPH" -gt 0 ] && [ "$NONCE" = 0 ]; then FAILS="$FAILS csp-nonce-missing"; fi
  if [ -z "$FAILS" ]; then
    F3OK=1
    s4_say "PASS  forced zoom + unlocked pinch + mobile shell are served, page integrity intact"
  else
    s4_say "FAIL  missing:$FAILS"
    s4_say "  proxy log:"; s4_tail "$HOME/.s4-remote/csproxy.log" 25
    s4_say "  code-server log:"; s4_tail "$HOME/.s4-remote/code-server.log" 20
  fi
  if [ "$PTYOK" -gt 0 ]; then
    s4_say "PASS  integrated terminal spawns a shell (PTY_OK)"
  else
    s4_say "FAIL  integrated terminal did not answer PTY_OK - the PTY_FAIL line above is the exact cause"
  fi

  s4_note "served page: the injected head (first 1200 bytes)"
  head -c 1200 "$BODY" 2>/dev/null | sed 's/^/    /' >> "$S4_REPORT"
  s4_note "served page: response headers"
  sed 's/^/    /' "$HDR" 2>/dev/null | head -20 >> "$S4_REPORT"
  s4_note "proxy self-test (/__s4mobile?probe=1)"
  sed 's/^/    /' "$ST" 2>/dev/null | head -70 >> "$S4_REPORT"
  s4_note "code-server settings now in effect"
  sed 's/^/    /' "$HOME/.local/share/code-server/User/settings.json" 2>/dev/null | head -45 >> "$S4_REPORT"
  s4_note "s4-remote.sh --code output (English: terminal repair + verification)"
  sed 's/^/    /' "$S4_STATE/remote.log" 2>/dev/null | tail -60 >> "$S4_REPORT"
  s4_note "s4-remote.sh --fix-terminal output"
  sed 's/^/    /' "$S4_STATE/termfix.log" 2>/dev/null | tail -40 >> "$S4_REPORT"
  rm -f "$BODY" "$HDR" "$ST" 2>/dev/null
else
  s4_say "code-server not installed -> pkg install code-server (the file manager still works without it)"
fi

# ------------------------------------------------------------------- summary
s4_hr; s4_say "SUMMARY - what to open on the phone"
s4_say "  1. file manager : http://127.0.0.1:$FMP/s4-fileman.php?key=\$(cat ~/.s4-fileman/fileman.key)"
s4_say "  2. SFTP         : 127.0.0.1:8022  user=$(whoami)  (password: bash ~/s4-remote.sh --set-password)"
s4_say "  3. code-server  : http://127.0.0.1:8081/   <-- the PROXY port, not 18081"
s4_say "       bottom dock: Files / Search / Git / Terminal / Output / Editor / More"
s4_say "       top bar    : menu, command palette, A- / zoom% / A+, extra keys, fullscreen, hide"
s4_say "       zoom       : buttons, two-finger pinch, or  http://127.0.0.1:8081/?z=1.8"
s4_say "       evidence   : curl -s http://127.0.0.1:8081/__s4mobile?probe=1"
s4_say "       password in ~/.config/code-server/config.yaml - upstream 18081 - zoom saved in ~/.s4-remote/zoom"
s4_say "  restart later   : bash ~/s4-fileman.sh --bg   /   bash ~/s4-remote.sh   /   bash ~/s4-agent.sh --loop"
s4_say ""
s4_say "IMPORTANT: open http://127.0.0.1:8081/ in the browser once, then run"
s4_say "  curl -s http://127.0.0.1:8081/__s4mobile | tail -30"
s4_say "It shows lastBrowserReport: what YOUR browser really did with the zoom,"
s4_say "whether the dock was built, and which tap strategy worked for each tab."
s4_say "That is the evidence r3 was missing."

if [ "$F3OK" = 1 ] && [ "$PTYOK" -gt 0 ]; then
  s4_done success
else
  s4_done needs-input
fi
