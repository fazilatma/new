#!/usr/bin/env bash
# =============================================================================
#  start.sh — اجرای سرویس رندرِ خالص‌PHP (بدون Node/Python/Java)
#
#  - چندکارگر: PHP_CLI_SERVER_WORKERS = RENDER_MAX_CONCURRENCY (پیش‌فرض ۳)
#    چون سرورِ داخلیِ PHP با این متغیر واقعاً چند پردازه می‌سازد.
#  - لوک‌بِک: RENDER_HOST پیش‌فرض 127.0.0.1 — خارج از دسترسِ اینترنت.
#  - بدون توکن فقط برای تست محلی است؛ RENDER_TOKEN را حتماً ست کنید.
# =============================================================================
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
LIB="$HERE/lib"
export LD_LIBRARY_PATH="$LIB/usr/lib/x86_64-linux-gnu:$LIB/lib/x86_64-linux-gnu:$LIB:${LD_LIBRARY_PATH:-}"

RENDER_HOST="${RENDER_HOST:-127.0.0.1}"
RENDER_PORT="${RENDER_PORT:-3100}"
RENDER_MAX_CONCURRENCY="${RENDER_MAX_CONCURRENCY:-3}"
PHP="${PHP:-php}"

export PHP_CLI_SERVER_WORKERS="$RENDER_MAX_CONCURRENCY"
export RENDER_MAX_CONCURRENCY

echo "▶ scraper4 pure-PHP render service  →  http://$RENDER_HOST:$RENDER_PORT"
echo "  workers=$PHP_CLI_SERVER_WORKERS · driver=${RENDER_DRIVER:-auto} · token=$([ -n "${RENDER_TOKEN:-}" ] && echo set || echo 'EMPTY (insecure!)')"

exec "$PHP" \
  -d max_execution_time=0 -d max_input_time=-1 \
  -d memory_limit="${PHP_MEMORY:-384M}" -d ignore_user_abort=1 \
  -S "$RENDER_HOST:$RENDER_PORT" render.php
