#!/usr/bin/env bash
#
# Arena Coding Agent — PHP edition installer.
#
#   ./install.sh                 # check requirements, prepare dirs, migrate
#   ./install.sh --serve [port]  # …and start the built-in dev server
#   ./install.sh --systemd       # …and install the worker as a systemd service
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
ok()   { echo "${GREEN}✓${RESET} $*"; }
warn() { echo "${YELLOW}!${RESET} $*"; }
die()  { echo "${RED}✗${RESET} $*" >&2; exit 1; }

echo "${BOLD}Arena Coding Agent — PHP edition${RESET}"
echo "Installing into: $APP_DIR"
echo

# ------------------------------------------------------------------ PHP
command -v php >/dev/null 2>&1 || die "php is not on PATH. Install PHP 8.1 or newer."
PHP_VER="$(php -r 'echo PHP_VERSION;')"
php -r 'exit(version_compare(PHP_VERSION, "8.1.0", ">=") ? 0 : 1);' \
  || die "PHP $PHP_VER is too old — 8.1 or newer is required."
ok "PHP $PHP_VER"

for ext in pdo_sqlite curl mbstring json; do
  if php -m | grep -qix "$ext"; then ok "extension $ext"; else die "missing PHP extension: $ext"; fi
done
for ext in zip dom openssl; do
  if php -m | grep -qix "$ext"; then ok "extension $ext"; else warn "optional extension missing: $ext"; fi
done

if php -r 'exit(function_exists("proc_open") && !in_array("proc_open", array_map("trim", explode(",", (string) ini_get("disable_functions"))), true) ? 0 : 1);'; then
  ok "proc_open() enabled (real shell, code execution and git are available)"
else
  warn "proc_open() is disabled — the terminal, code execution, git and Playwright features will not work."
  warn "Remove proc_open from disable_functions in php.ini to enable them."
fi

# ------------------------------------------------------- optional runtimes
for bin in python3 node npm git docker; do
  if command -v "$bin" >/dev/null 2>&1; then
    ok "$bin — $("$bin" --version 2>&1 | head -n1)"
  else
    warn "$bin not found (the agent will simply not offer it)"
  fi
done

# ------------------------------------------------------------- directories
mkdir -p data data/localai data/localai/models storage/workspaces/default storage/uploads storage/job_outputs storage/backups storage/localai storage/localai/models
chmod -R 775 data storage 2>/dev/null || chmod -R 755 data storage 2>/dev/null || chmod -R u+rwX data storage 2>/dev/null || true
ok "data/ and storage/ prepared"

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  ok "created .env from .env.example"
else
  ok ".env already present (left untouched)"
fi

# ------------------------------------------------------------------ schema
php bin/console.php migrate
ok "database ready"

# --------------------------------------------------- optional: playwright
if command -v python3 >/dev/null 2>&1; then
  if python3 -c "import playwright" >/dev/null 2>&1; then
    ok "Playwright (python) available — full browser automation enabled"
  else
    warn "Playwright not installed. For real browser automation run:"
    echo "      pip install playwright && python3 -m playwright install chromium"
  fi
fi

echo
php bin/console.php doctor
echo

# ----------------------------------------------------------------- systemd
if [[ "${1:-}" == "--systemd" ]]; then
  SERVICE=/etc/systemd/system/arena-agent-worker.service
  USER_NAME="${SUDO_USER:-$USER}"
  cat > /tmp/arena-agent-worker.service <<UNIT
[Unit]
Description=Arena Coding Agent — background job worker
After=network.target

[Service]
Type=simple
User=${USER_NAME}
WorkingDirectory=${APP_DIR}
ExecStart=$(command -v php) ${APP_DIR}/bin/worker.php
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
  if sudo cp /tmp/arena-agent-worker.service "$SERVICE" 2>/dev/null; then
    sudo systemctl daemon-reload
    sudo systemctl enable --now arena-agent-worker
    ok "systemd service installed and started (arena-agent-worker)"
  else
    warn "could not write $SERVICE — unit file left at /tmp/arena-agent-worker.service"
  fi
fi

# -------------------------------------------------------------------- serve
if [[ "${1:-}" == "--serve" ]]; then
  PORT="${2:-8080}"
  echo "${BOLD}Starting the worker and the web server…${RESET}"
  php bin/worker.php >> storage/worker.log 2>&1 &
  echo "worker pid $!"
  exec php bin/console.php serve "$PORT"
fi

echo "${BOLD}Done.${RESET}"
echo "  Web server document root : ${APP_DIR}/public"
echo "  Development server       : php bin/console.php serve 8080"
echo "  Background worker        : php bin/worker.php   (or --systemd above)"
echo "  Default login            : admin / admin123  (change it immediately)"
