#!/usr/bin/env bash
# =============================================================================
#  server.sh — اجرای سروریِ وب‌اپ scraper4 با «سوپروایزرِ همیشه‌زنده»
#
#  دو حالتِ قابلِ تنظیم:
#    ۱) run    — پیش‌زمینه (فورگراند): لاگ زنده روی ترمینال؛ مناسب توسعه و تست
#    ۲) start  — پس‌زمینه (دیمون): جدا از ترمینال، با فایل‌های PID و لاگ
#
#  در هر دو حالت یک حلقهٔ نگهبان فعال است: اگر پردازهٔ PHP به هر دلیلی
#  (خطای مرگبار، OOM، سیگنال بیرونی) از کار بیفتد، بی‌درنگ و تا «بی‌نهایت»
#  دوباره بالا می‌آید — تا زمانی که صریحاً stop شود. تنظیمات PHP هم طوری
#  داده می‌شود که خودِ PHP هیچ سقف زمانی نداشته باشد (max_execution_time=0 و
#  ignore_user_abort=1). علاوه بر وب‌سرور، یک worker دائمیِ CLI هم بالا
#  می‌آید؛ وب‌درخواست‌ها کارهای سنگین را در صف می‌گذارند و worker مثل
#  سرویس‌های Python/Node آن‌ها را بیرون از request اجرا می‌کند. همان worker
#  تیک‌های cron_run را هم می‌زند تا استخراج دوره‌ای، پمپِ صف و نگهبانِ ادامه
#  حتی بدون هیچ بازدیدکننده‌ای همیشه در جریان بمانند.
#
#  پیکربندی: فایل server.conf کنارِ همین اسکریپت (نمونه: server.conf.sample)
#  یا متغیرهای محیطی. اولویت با متغیر محیطی است.
# =============================================================================
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# --- پیکربندی: server.conf فقط متغیرهایی را پر می‌کند که از قبل نیستند ------
CFG_FILE="${SCRAPER_CONF:-$HERE/server.conf}"
[ -f "$CFG_FILE" ] && . "$CFG_FILE"

SCRAPER_HOST="${SCRAPER_HOST:-0.0.0.0}"       # برای اجرا پشت پروکسی محلی: 127.0.0.1
SCRAPER_PORT="${SCRAPER_PORT:-8000}"
SCRAPER_APP="${SCRAPER_APP:-scraper4.php}"    # فایلِ اصلیِ وب‌اپ
SCRAPER_ROUTER="${SCRAPER_ROUTER:-server.php}"
SCRAPER_PHP="${SCRAPER_PHP:-php}"
SCRAPER_WORKERS="${SCRAPER_WORKERS:-4}"       # PHP_CLI_SERVER_WORKERS (PHP ≥ 7.4)
SCRAPER_MEMORY="${SCRAPER_MEMORY:-512M}"
SCRAPER_RESTART_DELAY="${SCRAPER_RESTART_DELAY:-1}"   # ثانیه — نخستین مکث پس از سقوط
SCRAPER_RESTART_DELAY_MAX="${SCRAPER_RESTART_DELAY_MAX:-30}"
SCRAPER_CRON_TICK="${SCRAPER_CRON_TICK:-60}"  # ثانیه؛ 0 یعنی تیکِ کران داخل worker خاموش
SCRAPER_QUEUE_WORKER="${SCRAPER_QUEUE_WORKER:-1}" # 1 = worker دائمیِ عملیات روشن؛ 0 = fallback قدیمیِ cron tick
# نگهبانِ سلامت: اگر پردازهٔ PHP زنده بود ولی به HTTP جواب نداد (هنک)، آن را
# می‌کشد تا حلقهٔ نگهبانِ بالا سرورِ تازه بسازد. 0 = خاموش.
SCRAPER_HEALTH_SEC="${SCRAPER_HEALTH_SEC:-30}"
SCRAPER_HEALTH_FAILS="${SCRAPER_HEALTH_FAILS:-3}"
SCRAPER_HEALTH_URL="${SCRAPER_HEALTH_URL:-}"  # خالی = http://127.0.0.1:$PORT/
SCRAPER_LOG="${SCRAPER_LOG:-$HERE/logs/server.log}"
SCRAPER_TICK_LOG="${SCRAPER_TICK_LOG:-$HERE/logs/cron-tick.log}"
SCRAPER_WORKER_LOG="${SCRAPER_WORKER_LOG:-$HERE/logs/worker.log}"
# ریشهٔ سند اختیاری برای چیدمان‌های چندپوشه‌ای (مثلاً حالت لاراول:
#   SCRAPER_DOCROOT=laravel/public SCRAPER_ROUTER=laravel/public/index.php)
SCRAPER_DOCROOT="${SCRAPER_DOCROOT:-}"
RUN_DIR="${RUN_DIR:-$HERE/run}"

STOP_FLAG="$RUN_DIR/STOP"
SUP_PIDFILE="$RUN_DIR/supervisor.pid"
SRV_PIDFILE="$RUN_DIR/php-server.pid"
TICK_PIDFILE="$RUN_DIR/cron-tick.pid"
WORKER_PIDFILE="$RUN_DIR/queue-worker.pid"
HEALTH_PIDFILE="$RUN_DIR/health-probe.pid"

# ویندوز (Git Bash/MSYS): چندکارگر پشتیبانی نمی‌شود
case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT) SCRAPER_WORKERS=1 ;;
esac

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

ensure_dirs() { mkdir -p "$RUN_DIR" "$(dirname "$SCRAPER_LOG")" "$(dirname "$SCRAPER_TICK_LOG")" "$(dirname "$SCRAPER_WORKER_LOG")"; }

need_php() {
  if ! command -v "$SCRAPER_PHP" >/dev/null 2>&1; then
    log "خطا: «$SCRAPER_PHP» پیدا نشد. PHP CLI نصب کنید یا SCRAPER_PHP را تنظیم کنید."
    exit 1
  fi
}

php_version_ok() {
  [ "$("$SCRAPER_PHP" -r 'echo PHP_VERSION_ID;' 2>/dev/null || echo 0)" -ge 70400 ] 2>/dev/null
}

rotate_log() {
  local f="$1"
  if [ -f "$f" ] && [ "$(stat -c%s "$f" 2>/dev/null || echo 0)" -gt 5242880 ]; then
    mv -f "$f" "$f.1" 2>/dev/null || true
  fi
}

# --- اجرای یک نوبتِ وب‌سرور داخلیِ PHP ----------------------------------------
start_php_server() {
  # max_execution_time=0 و ignore_user_abort=1 یعنی خودِ PHP هرگز پردازه را
  # برای طولانی‌بودن نمی‌کشد و قطعِ مرورگر هم کارِ پس‌زمینه را نمی‌بندد.
  # سازگار با bash قدیمی مک هم (بدون آرایهٔ شرطی — با set -u روی bash<4.4 می‌شکست)
  if [ -n "$SCRAPER_DOCROOT" ]; then
    PHP_CLI_SERVER_WORKERS="$SCRAPER_WORKERS" "$SCRAPER_PHP" \
      -d max_execution_time=0 -d max_input_time=-1 -d memory_limit="$SCRAPER_MEMORY" \
      -d ignore_user_abort=1 -d default_socket_timeout=-1 -d variables_order=EGPCS \
      -S "$SCRAPER_HOST:$SCRAPER_PORT" -t "$SCRAPER_DOCROOT" "$SCRAPER_ROUTER" &
  else
    PHP_CLI_SERVER_WORKERS="$SCRAPER_WORKERS" "$SCRAPER_PHP" \
      -d max_execution_time=0 -d max_input_time=-1 -d memory_limit="$SCRAPER_MEMORY" \
      -d ignore_user_abort=1 -d default_socket_timeout=-1 -d variables_order=EGPCS \
      -S "$SCRAPER_HOST:$SCRAPER_PORT" "$SCRAPER_ROUTER" &
  fi
  SERVER_PID=$!
  echo "$SERVER_PID" > "$SRV_PIDFILE"
}

# --- تیکِ کران: اجرای دوره‌ایِ دستورِ داخلیِ خودِ اپ ---------------------------
ticker_loop() {
  [ "$SCRAPER_CRON_TICK" -gt 0 ] 2>/dev/null || exit 0
  while [ ! -f "$STOP_FLAG" ]; do
    sleep "$SCRAPER_CRON_TICK"
    [ -f "$STOP_FLAG" ] && break
    "$SCRAPER_PHP" -d max_execution_time=0 -d memory_limit="$SCRAPER_MEMORY" \
      "$SCRAPER_APP" cron_run >>"$SCRAPER_TICK_LOG" 2>&1
    log "tickِ کران اجرا شد (هر ${SCRAPER_CRON_TICK} ثانیه) — کد خروج: $?"
  done
}

# --- worker دائمی: عملیات سنگین بیرون از request، مثل Python/Node -------------
worker_loop() {
  [ "$SCRAPER_QUEUE_WORKER" -gt 0 ] 2>/dev/null || exit 0
  local delay=1 started rc up
  while [ ! -f "$STOP_FLAG" ]; do
    started="$(date +%s)"
    log "راه‌اندازی worker دائمی عملیات (cron_tick=${SCRAPER_CRON_TICK}s) — لاگ: $SCRAPER_WORKER_LOG"
    "$SCRAPER_PHP" -d max_execution_time=0 -d max_input_time=-1 -d memory_limit="$SCRAPER_MEMORY" \
      -d ignore_user_abort=1 -d default_socket_timeout=-1 \
      "$SCRAPER_APP" worker --tick="$SCRAPER_CRON_TICK" --stop-file="$STOP_FLAG" >>"$SCRAPER_WORKER_LOG" 2>&1
    rc=$?
    [ -f "$STOP_FLAG" ] && break
    up=$(( $(date +%s) - started ))
    [ "$up" -ge 60 ] && delay=1
    log "worker با کد $rc از کار افتاد (پس از ${up} ثانیه) — بازراه‌اندازی تا ${delay} ثانیهٔ دیگر…"
    sleep "$delay"
    [ "$up" -lt 60 ] && delay=$((delay*2))
    [ "$delay" -gt "$SCRAPER_RESTART_DELAY_MAX" ] && delay="$SCRAPER_RESTART_DELAY_MAX"
  done
}

stop_worker() {
  if [ -n "${WORKER_PID:-}" ]; then
    pkill -TERM -P "$WORKER_PID" 2>/dev/null || true
    kill "$WORKER_PID" 2>/dev/null || true
    wait "$WORKER_PID" 2>/dev/null || true
    WORKER_PID=""
  fi
}

stop_ticker() {
  if [ -n "${TICKER_PID:-}" ]; then
    kill "$TICKER_PID" 2>/dev/null || true
    wait "$TICKER_PID" 2>/dev/null || true
    TICKER_PID=""
  fi
}

# --- نگهبانِ سلامت: کشتنِ سرورِ «زنده ولی هنک‌کرده» ---------------------------
# فرق با حلقهٔ بالا: آن‌ها سقوطِ پردازه را می‌بینند؛ این‌جا پردازه زنده است ولی
# به HTTP جواب نمی‌دهد — عیبی که فقط بازراه‌اندازی حلش می‌کند.
health_loop() {
  [ "$SCRAPER_HEALTH_SEC" -gt 0 ] 2>/dev/null || exit 0
  command -v curl >/dev/null 2>&1 || { log "curl نیست؛ نگهبانِ سلامت فعال نشد."; exit 0; }
  local url="$SCRAPER_HEALTH_URL"
  [ -z "$url" ] && url="http://127.0.0.1:$SCRAPER_PORT/"
  local fails=0 code
  sleep 5   # فرصتِ بالا آمدنِ اولیه
  while [ ! -f "$STOP_FLAG" ]; do
    sleep "$SCRAPER_HEALTH_SEC"
    [ -f "$STOP_FLAG" ] && break
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
    if [ "$code" = "000" ] || [ "$code" -ge 500 ] 2>/dev/null; then
      fails=$((fails+1))
      log "سلامت: شکست $fails/$SCRAPER_HEALTH_FAILS (کد=$code) روی $url"
      if [ "$fails" -ge "$SCRAPER_HEALTH_FAILS" ]; then
        log "سلامت: سرور به $fails درخواستِ متوالی پاسخ نداد — کشتن برای بازراه‌اندازی"
        [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
        exit 0
      fi
    else
      [ "$fails" -gt 0 ] && log "سلامت: برگشت (کد=$code)"
      fails=0
    fi
  done
}

stop_health() {
  if [ -n "${HEALTH_PID:-}" ]; then
    kill "$HEALTH_PID" 2>/dev/null || true
    wait "$HEALTH_PID" 2>/dev/null || true
    HEALTH_PID=""
  fi
}

# --- حلقهٔ نگهبانِ همیشه‌زنده ---------------------------------------------------
supervise() {
  ensure_dirs
  rm -f "$STOP_FLAG"

  graceful_exit() {
    log "سیگنال توقف دریافت شد — پایانِ سوپروایزر"
    touch "$STOP_FLAG"
    stop_ticker
    stop_worker
    stop_health
    [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
    exit 0
  }
  trap graceful_exit TERM INT

  local delay="$SCRAPER_RESTART_DELAY" started up rc
  while true; do
    [ -f "$STOP_FLAG" ] && break
    started="$(date +%s)"
    log "راه‌اندازیِ وب‌سرور: http://$SCRAPER_HOST:$SCRAPER_PORT  (workers=$SCRAPER_WORKERS, memory=$SCRAPER_MEMORY)"
    start_php_server

    if [ "$SCRAPER_QUEUE_WORKER" -gt 0 ] 2>/dev/null; then
      worker_loop &
      WORKER_PID=$!
      echo "$WORKER_PID" > "$WORKER_PIDFILE"
    elif [ "$SCRAPER_CRON_TICK" -gt 0 ] 2>/dev/null; then
      ticker_loop &
      TICKER_PID=$!
      echo "$TICKER_PID" > "$TICK_PIDFILE"
    fi

    if [ "$SCRAPER_HEALTH_SEC" -gt 0 ] 2>/dev/null; then
      health_loop &
      HEALTH_PID=$!
      echo "$HEALTH_PID" > "$HEALTH_PIDFILE"
    fi

    wait "$SERVER_PID"; rc=$?
    stop_ticker
    stop_worker
    stop_health

    if [ -f "$STOP_FLAG" ]; then
      log "پرچم توقف دیده شد — بازراه‌اندازی نمی‌شود."
      break
    fi

    up=$(( $(date +%s) - started ))
    if [ "$up" -ge 60 ]; then
      delay="$SCRAPER_RESTART_DELAY"          # اجرای پایدار بود: مکث صفرشونده
    fi
    log "وب‌سرور با کدِ $rc از کار افتاد (پس از ${up} ثانیه) — بازراه‌اندازی تا ${delay} ثانیهٔ دیگر…"
    sleep "$delay"
    if [ "$up" -lt 60 ]; then
      delay=$(( delay * 2 ))
      [ "$delay" -gt "$SCRAPER_RESTART_DELAY_MAX" ] && delay="$SCRAPER_RESTART_DELAY_MAX"
    fi
  done
  rm -f "$SRV_PIDFILE" "$TICK_PIDFILE" "$WORKER_PIDFILE" "$HEALTH_PIDFILE"
}

is_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# --- دستورها ----------------------------------------------------------------
cmd_run() {
  need_php
  if ! php_version_ok; then
    log "هشدار: PHP قدیمی‌تر از 7.4 است؛ PHP_CLI_SERVER_WORKERS نادیده گرفته می‌شود (تک‌کارگر)."
  fi
  if [ ! -f "$SCRAPER_ROUTER" ]; then log "خطا: روتر «$SCRAPER_ROUTER» نیست."; exit 1; fi
  if [ ! -f "$SCRAPER_APP" ];   then log "خطا: فایل اپ «$SCRAPER_APP» نیست."; exit 1; fi
  log "حالت پیش‌زمینه — برای توقف Ctrl+C بزنید. اپ: $SCRAPER_APP"
  supervise
}

cmd_start() {
  need_php
  ensure_dirs
  local sup=""
  [ -f "$SUP_PIDFILE" ] && sup="$(cat "$SUP_PIDFILE" 2>/dev/null || true)"
  if is_alive "$sup"; then
    log "دیمون از قبل در حال اجراست (supervisor PID $sup) — ابتدا stop کنید."
    exit 1
  fi
  [ ! -f "$SCRAPER_ROUTER" ] && { log "خطا: روتر «$SCRAPER_ROUTER» نیست."; exit 1; }
  [ ! -f "$SCRAPER_APP" ]    && { log "خطا: فایل اپ «$SCRAPER_APP» نیست."; exit 1; }
  rotate_log "$SCRAPER_LOG"
  log "حالت پس‌زمینه — سوپروایزر جدا می‌شود؛ لاگ: $SCRAPER_LOG"
  rm -f "$STOP_FLAG"
  nohup "$BASH" "$0" run >>"$SCRAPER_LOG" 2>&1 &
  echo $! > "$SUP_PIDFILE"
  disown 2>/dev/null || true
  sleep 2
  cmd_status
}

cmd_stop() {
  ensure_dirs
  touch "$STOP_FLAG"
  local sup="" srv="" tick="" worker="" wkids="" hp="" i
  [ -f "$SUP_PIDFILE" ]    && sup="$(cat "$SUP_PIDFILE" 2>/dev/null || true)"
  [ -f "$SRV_PIDFILE" ]    && srv="$(cat "$SRV_PIDFILE" 2>/dev/null || true)"
  [ -f "$TICK_PIDFILE" ]   && tick="$(cat "$TICK_PIDFILE" 2>/dev/null || true)"
  [ -f "$WORKER_PIDFILE" ] && worker="$(cat "$WORKER_PIDFILE" 2>/dev/null || true)"
  [ -f "$HEALTH_PIDFILE" ] && hp="$(cat "$HEALTH_PIDFILE" 2>/dev/null || true)"

  # فرزندهای سوپروایزر را هم بگیر (اگر PID فایل‌ها جا مانده باشند)
  [ -z "$srv" ] && is_alive "$sup" && srv="$(pgrep -P "$sup" 2>/dev/null | tr '\n' ' ' || true)"
  [ -n "$worker" ] && wkids="$(pgrep -P "$worker" 2>/dev/null | tr '\n' ' ' || true)"

  kill $tick   2>/dev/null || true
  kill $wkids  2>/dev/null || true
  kill $worker 2>/dev/null || true
  kill $hp     2>/dev/null || true
  kill $srv    2>/dev/null || true
  kill $sup    2>/dev/null || true

  for i in 1 2 3 4 5 6 7 8 9 10; do
    is_alive "$sup" || is_alive "$srv" || break
    sleep 1
  done
  kill -9 $tick $wkids $worker $hp $srv $sup 2>/dev/null || true
  rm -f "$SUP_PIDFILE" "$SRV_PIDFILE" "$TICK_PIDFILE" "$WORKER_PIDFILE" "$HEALTH_PIDFILE" "$STOP_FLAG"
  log "متوقف شد."
}

cmd_restart() { cmd_stop; sleep 1; cmd_start; }

cmd_status() {
  local sup="" srv="" tick="" worker=""
  [ -f "$SUP_PIDFILE" ]    && sup="$(cat "$SUP_PIDFILE" 2>/dev/null || true)"
  [ -f "$SRV_PIDFILE" ]    && srv="$(cat "$SRV_PIDFILE" 2>/dev/null || true)"
  [ -f "$TICK_PIDFILE" ]   && tick="$(cat "$TICK_PIDFILE" 2>/dev/null || true)"
  [ -f "$WORKER_PIDFILE" ] && worker="$(cat "$WORKER_PIDFILE" 2>/dev/null || true)"
  echo "آدرس:        http://$SCRAPER_HOST:$SCRAPER_PORT"
  echo "اپ:          $SCRAPER_APP (روتر: $SCRAPER_ROUTER)"
  echo "حالت:        $(is_alive "$sup" && echo "در حال اجرا (پس‌زمینه، supervisor PID $sup)" || { is_alive "$srv" && echo "در حال اجرا (پیش‌زمینه، server PID $srv)" || echo "متوقف"; })"
  echo "وب‌سرور PHP: $(is_alive "$srv" && echo "زنده (PID $srv, workers=$SCRAPER_WORKERS)" || echo "—")"
  echo "worker دائم: $([ "$SCRAPER_QUEUE_WORKER" -gt 0 ] 2>/dev/null && { is_alive "$worker" && echo "فعال (PID $worker، عملیات + cron هر $SCRAPER_CRON_TICK ثانیه)" || echo "پیکربندی‌شده ولی اجرا نیست"; } || echo "خاموش")"
  echo "تیکِ کران:   $([ "$SCRAPER_QUEUE_WORKER" -gt 0 ] 2>/dev/null && echo "داخل worker" || { [ "$SCRAPER_CRON_TICK" -gt 0 ] 2>/dev/null && { is_alive "$tick" && echo "فعال (PID $tick، هر $SCRAPER_CRON_TICK ثانیه)" || echo "پیکربندی‌شده ولی اجرا نیست"; } || echo "خاموش"; })"
  local hp=""
  [ -f "$HEALTH_PIDFILE" ] && hp="$(cat "$HEALTH_PIDFILE" 2>/dev/null || true)"
  echo "سلامت:       $([ "$SCRAPER_HEALTH_SEC" -gt 0 ] 2>/dev/null && { is_alive "$hp" && echo "نگهبان فعال (PID $hp، هر $SCRAPER_HEALTH_SEC ثانیه، بعدِ $SCRAPER_HEALTH_FAILS شکست می‌کشد)" || echo "پیکربندی‌شده ولی اجرا نیست"; } || echo "خاموش")"
  if command -v curl >/dev/null 2>&1 && is_alive "$srv"; then
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$SCRAPER_PORT/" 2>/dev/null || echo '?')"
    echo "پاسخ HTTP:   $code (روی 127.0.0.1:$SCRAPER_PORT)"
  fi
  echo "لاگ:         $SCRAPER_LOG"
  echo "لاگ worker:  $SCRAPER_WORKER_LOG"
}

cmd_logs() { touch "$SCRAPER_LOG" 2>/dev/null || true; tail -n 100 -f "$SCRAPER_LOG"; }

cmd_help() {
  cat <<EOF
استفاده: $0 <دستور>

  run       حالت ۱ — پیش‌زمینه: سوپروایزر + وب‌سرور با لاگِ زنده (توقف با Ctrl+C)
  start     حالت ۲ — پس‌زمینه (دیمون): همان سوپروایزر، جدا از ترمینال با PID/لاگ
  stop      توقفِ تمیزِ دیمون (سوپروایزر + وب‌سرور + worker/تیکِ کران)
  restart   توقف و شروعِ دوبارهٔ حالت پس‌زمینه
  status    وضعیت پردازه‌ها و تست پاسخ HTTP
  logs      دنبال‌کردنِ لاگِ سرور

در هر دو حالت: اگر پردازهٔ PHP سقوط کند، نگهبان تا بی‌نهایت آن را دوباره بالا
می‌آورد (باز‌راه‌اندازیِ نامحدود با مکثِ تصاعدیِ ۱ تا $SCRAPER_RESTART_DELAY_MAX ثانیه).
worker دائمی هم کنار وب‌سرور بالا می‌آید؛ بنابراین استخراج/عملیات سنگین از request
وب جدا می‌شوند و مانند سرویس‌های Python/Node در پردازهٔ CLI همیشه‌زنده اجرا می‌شوند.
نگهبانِ سلامت هم اگر سرور «زنده ولی هنک‌کرده» باشد (به $SCRAPER_HEALTH_FAILS
درخواستِ متوالی جواب ندهد) آن را می‌کشد تا تازه ساخته شود.
پیکربندی در server.conf یا متغیر محیطی (نمونه: server.conf.sample).
برای چیدمانِ چندپروسهٔ تولیدی (PHP-FPM + Nginx) نمونه‌ها در پوشهٔ deploy/ است.
EOF
}

case "${1:-help}" in
  run)       cmd_run ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs|log)  cmd_logs ;;
  *)         cmd_help ;;
esac
