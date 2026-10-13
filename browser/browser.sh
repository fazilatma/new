#!/usr/bin/env bash
# =============================================================================
#  browser.sh — سوپروایزرِ «همیشه‌زنده» برای سرویس رندرِ JS (مثل server.sh)
#
#  دو حالتِ قابلِ تنظیم:
#    1) run    — پیش‌زمینه با لاگِ زنده
#    2) start  — پس‌زمینه (دیمون) با PID/لاگ
#    stop | restart | status | logs
#
#  بازراه‌اندازیِ نامحدود با مکثِ تصاعدی + چکِ سلامتِ HTTP: اگر سرویس هنگ کند
#  (زنده ولی بی‌پاسخ)، نگهبان خودش پردازه را می‌کشد تا تازه برگردد.
#  پیکربندی با متغیر محیطی (نمونه در browser/env.sample).
# =============================================================================
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

RENDER_HOST="${RENDER_HOST:-0.0.0.0}"
RENDER_PORT="${RENDER_PORT:-3100}"
RENDER_TOKEN="${RENDER_TOKEN:-}"
RENDER_DRIVER="${RENDER_DRIVER:-auto}"            # auto | playwright | selenium
SELENIUM_URL="${SELENIUM_URL:-http://127.0.0.1:4444}"
RENDER_MAX_CONCURRENCY="${RENDER_MAX_CONCURRENCY:-3}"
RENDER_NAV_TIMEOUT="${RENDER_NAV_TIMEOUT:-45000}"
RENDER_HEADLESS="${RENDER_HEADLESS:-true}"
RENDER_USER_AGENT="${RENDER_USER_AGENT:-}"
RENDER_BLOCK_HOSTS="${RENDER_BLOCK_HOSTS:-}"
NODE_BIN="${NODE_BIN:-node}"

RESTART_DELAY="${RESTART_DELAY:-1}"
RESTART_DELAY_MAX="${RESTART_DELAY_MAX:-30}"
HEALTH_SEC="${HEALTH_SEC:-30}"                   # 0 = چک سلامت خاموش
HEALTH_FAILS="${HEALTH_FAILS:-3}"

LOG="${RENDER_LOG:-$HERE/logs/render.log}"
RUN_DIR="${RENDER_RUN_DIR:-$HERE/run}"
STOP_FLAG="$RUN_DIR/STOP"
SUP_PIDFILE="$RUN_DIR/supervisor.pid"
SRV_PIDFILE="$RUN_DIR/node.pid"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
ensure_dirs() { mkdir -p "$RUN_DIR" "$(dirname "$LOG")"; }
is_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

need_node() {
  if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
    log "خطا: Node.js پیدا نشد ($NODE_BIN). نصب: nvm install --lts یا apt install nodejs"
    exit 1
  fi
  if [ ! -d "$HERE/node_modules/playwright" ] && [ "$RENDER_DRIVER" != "selenium" ]; then
    log "هشدار: پکیج playwright نصب نیست → ابتدا:  npm ci && npx playwright install --with-deps chromium"
    log "       (با RENDER_DRIVER=selenium بدون نصب هم کار می‌کند، به‌شرط SELENIUM_URL)"
  fi
}

probe_port() {
  command -v curl >/dev/null 2>&1 || return 0
  curl -sf -m 5 "http://127.0.0.1:$RENDER_PORT/health" >/dev/null 2>&1
}

health_loop() {
  local fails=0
  while [ ! -f "$STOP_FLAG" ]; do
    sleep "$HEALTH_SEC"
    [ -f "$STOP_FLAG" ] && break
    if probe_port; then
      fails=0
    else
      fails=$((fails + 1))
      log "چک سلامت ناموفق ($fails/$HEALTH_FAILS)"
      if [ "$fails" -ge "$HEALTH_FAILS" ] && [ -n "${SERVER_PID:-}" ] && is_alive "$SERVER_PID"; then
        log "سرویس هنگ است (زنده ولی بی‌پاسخ) — کشته می‌شود تا تازه برگردد"
        kill "$SERVER_PID" 2>/dev/null || true
        fails=0
      fi
    fi
  done
}

start_node() {
  RENDER_HOST="$RENDER_HOST" RENDER_PORT="$RENDER_PORT" RENDER_TOKEN="$RENDER_TOKEN" \
  RENDER_DRIVER="$RENDER_DRIVER" SELENIUM_URL="$SELENIUM_URL" \
  RENDER_MAX_CONCURRENCY="$RENDER_MAX_CONCURRENCY" RENDER_NAV_TIMEOUT="$RENDER_NAV_TIMEOUT" \
  RENDER_HEADLESS="$RENDER_HEADLESS" RENDER_USER_AGENT="$RENDER_USER_AGENT" \
  RENDER_BLOCK_HOSTS="$RENDER_BLOCK_HOSTS" \
  "$NODE_BIN" server.js &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$SRV_PIDFILE"
}

supervise() {
  ensure_dirs
  rm -f "$STOP_FLAG"
  graceful_exit() {
    log "سیگنال توقف — پایان سوپروایزر"
    touch "$STOP_FLAG"
    [ -n "${HEALTH_PID:-}" ] && kill "$HEALTH_PID" 2>/dev/null || true
    [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
    exit 0
  }
  trap graceful_exit TERM INT

  local delay="$RESTART_DELAY" started up rc
  while true; do
    [ -f "$STOP_FLAG" ] && break
    started="$(date +%s)"
    log "راه‌اندازی سرویس رندر: http://$RENDER_HOST:$RENDER_PORT (driver=$RENDER_DRIVER، حداکثر همزمان $RENDER_MAX_CONCURRENCY)"
    start_node
    if [ "$HEALTH_SEC" -gt 0 ] 2>/dev/null; then health_loop & HEALTH_PID=$!; fi

    wait "$SERVER_PID"; rc=$?
    [ -n "${HEALTH_PID:-}" ] && { kill "$HEALTH_PID" 2>/dev/null || true; HEALTH_PID=""; }

    [ -f "$STOP_FLAG" ] && { log "پرچم توقف — بازراه‌اندازی نمی‌شود."; break; }
    up=$(( $(date +%s) - started ))
    [ "$up" -ge 60 ] && delay="$RESTART_DELAY"
    log "سرویس با کد $rc افتاد (پس از ${up}ث) — بازراه‌اندازی تا ${delay}ث دیگر…"
    sleep "$delay"
    if [ "$up" -lt 60 ]; then
      delay=$(( delay * 2 ))
      [ "$delay" -gt "$RESTART_DELAY_MAX" ] && delay="$RESTART_DELAY_MAX"
    fi
  done
  rm -f "$SRV_PIDFILE"
}

cmd_run()    { need_node; log "حالت پیش‌زمینه — توقف با Ctrl+C"; supervise; }
cmd_start()  {
  need_node; ensure_dirs
  local sup="" ; { [ -f "$SUP_PIDFILE" ] && sup="$(cat "$SUP_PIDFILE" 2>/dev/null)"; } || true
  if is_alive "$sup"; then log "دیمون از قبل اجراست (PID $sup)"; exit 1; fi
  log "حالت پس‌زمینه — لاگ: $LOG"
  rm -f "$STOP_FLAG"
  nohup "$BASH" "$0" run >>"$LOG" 2>&1 &
  echo $! > "$SUP_PIDFILE"
  disown 2>/dev/null || true
  sleep 2; cmd_status
}
cmd_stop()   {
  ensure_dirs; touch "$STOP_FLAG"
  local sup="" srv=""
  { [ -f "$SUP_PIDFILE" ] && sup="$(cat "$SUP_PIDFILE" 2>/dev/null)"; } || true
  { [ -f "$SRV_PIDFILE" ] && srv="$(cat "$SRV_PIDFILE" 2>/dev/null)"; } || true
  kill $srv $sup 2>/dev/null || true
  local i; for i in 1 2 3 4 5 6 7 8 9 10; do is_alive "$sup" || is_alive "$srv" || break; sleep 1; done
  kill -9 $srv $sup 2>/dev/null || true
  # فرزندهای کرومیوم زمین‌گیرشده هم جمع شوند
  is_alive "$srv" && pkill -P "$srv" 2>/dev/null || true
  rm -f "$SUP_PIDFILE" "$SRV_PIDFILE" "$STOP_FLAG"
  log "متوقف شد."
}
cmd_restart() { cmd_stop; sleep 1; cmd_start; }
cmd_status() {
  local sup="" srv=""
  { [ -f "$SUP_PIDFILE" ] && sup="$(cat "$SUP_PIDFILE" 2>/dev/null)"; } || true
  { [ -f "$SRV_PIDFILE" ] && srv="$(cat "$SRV_PIDFILE" 2>/dev/null)"; } || true
  echo "آدرس:   http://$RENDER_HOST:$RENDER_PORT (driver=$RENDER_DRIVER)"
  echo "حالت:   $(is_alive "$sup" && echo "دیمون (PID $sup)" || { is_alive "$srv" && echo "پیش‌زمینه (PID $srv)" || echo "متوقف"; })"
  if command -v curl >/dev/null 2>&1 && is_alive "$srv"; then
    echo "سلامت:  $(curl -sf -m 4 http://127.0.0.1:$RENDER_PORT/health 2>/dev/null || echo 'بی‌پاسخ')"
  fi
}
cmd_logs()   { tail -n 100 -f "$LOG"; }

case "${1:-help}" in
  run) cmd_run ;; start) cmd_start ;; stop) cmd_stop ;;
  restart) cmd_restart ;; status) cmd_status ;; logs) cmd_logs ;;
  *) echo "استفاده: $0 {run|start|stop|restart|status|logs}" ;;
esac
