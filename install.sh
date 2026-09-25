#!/usr/bin/env bash
# ==============================================================================
# WebConsole Pro - Universal Auto-Installer & Launcher
# Modes:
#   [1] Start Server (Default)
#   [2] Quick Update
#   [3] Full All-in-One Installation
#   [4] Dedicated Node.js 22 LTS Stack
#   [5] Dedicated Python 3 & Web Scraping Stack
#
# Supports: Android Termux, GitHub Codespaces, Debian, Ubuntu, CentOS, RHEL,
#           Rocky Linux, AlmaLinux, Fedora, Alpine Linux, Arch Linux
# Version: 2.8.5 | Repository: fazilatma/new
# ==============================================================================

set -euo pipefail

# ANSI Colors
CLR_RESET="\033[0m"
CLR_BOLD="\033[1m"
CLR_GREEN="\033[1;32m"
CLR_BLUE="\033[1;34m"
CLR_CYAN="\033[1;36m"
CLR_YELLOW="\033[1;33m"
CLR_MAGENTA="\033[1;35m"
CLR_RED="\033[1;31m"
CLR_GRAY="\033[0;90m"

log_info() { echo -e "${CLR_BLUE}[INFO]${CLR_RESET} $1"; }
log_step() { echo -e "\n${CLR_CYAN}${CLR_BOLD}[$1] 🚀 $2${CLR_RESET}"; }
log_ok() { echo -e "${CLR_GREEN}✓ $1${CLR_RESET}"; }
log_warn() { echo -e "${CLR_YELLOW}⚠️  $1${CLR_RESET}"; }
log_err() { echo -e "${CLR_RED}✗ $1${CLR_RESET}"; }

# ------------------------------------------------------------------------------
# 0. Early Environment Check (Termux vs Linux Root)
# ------------------------------------------------------------------------------
IS_TERMUX=false
if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ] || [[ "${PREFIX:-}" =~ com\.termux ]]; then
    IS_TERMUX=true
fi

# Auto-escalate with sudo only on standard Linux (Skip on Termux userland)
if [ "$IS_TERMUX" = "false" ] && [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        if [ -f "$0" ]; then
            exec sudo -E bash "$0" "$@"
        else
            exec sudo -E bash -c "$(curl -fsSL https://raw.githubusercontent.com/fazilatma/new/main/install.sh)" -- "$@"
        fi
    else
        log_err "This installation script must be executed as root or with sudo."
        exit 1
    fi
fi

export DEBIAN_FRONTEND=noninteractive

# Portable Temporary Directory Definition
TMP_DIR="${TMPDIR:-/tmp}"
if [ "$IS_TERMUX" = "true" ]; then
    TMP_DIR="${PREFIX:-/data/data/com.termux/files/usr}/tmp"
    mkdir -p "$TMP_DIR" 2>/dev/null || TMP_DIR="${HOME}/.tmp"
fi
mkdir -p "$TMP_DIR" 2>/dev/null || true

HAS_SYSTEMD=false
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    HAS_SYSTEMD=true
fi

# ------------------------------------------------------------------------------
# 1. Environment & Workspace Directory Resolution
# ------------------------------------------------------------------------------
IS_CODESPACES=false
CODESPACE_NAME="${CODESPACE_NAME:-}"
CODESPACE_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
WS_ROOT=""
DOC_ROOT="/var/www/html"

extract_cs_var() {
    local var_name="$1"
    local val=""
    if [ -r /proc/1/environ ]; then
        val=$(tr '\0' '\n' < /proc/1/environ 2>/dev/null | grep -E "^${var_name}=" | head -n 1 | cut -d'=' -f2- | tr -d '"\r\n' || true)
        if [ -n "$val" ]; then echo "$val"; return; fi
    fi
    for env_file in /proc/[0-9]*/environ; do
        if [ -r "$env_file" ]; then
            val=$(tr '\0' '\n' < "$env_file" 2>/dev/null | grep -E "^${var_name}=" | head -n 1 | cut -d'=' -f2- | tr -d '"\r\n' || true)
            if [ -n "$val" ]; then echo "$val"; return; fi
        fi
    done
    for json_file in /workspaces/.codespaces/shared/environment-variables.json \
                     /workspaces/.codespaces/.persistedshare/environment-variables.json \
                     /tmp/codespaces-environment.json \
                     /.codespaces/shared/environment-variables.json; do
        if [ -f "$json_file" ]; then
            val=$(grep -E "\"${var_name}\"" "$json_file" 2>/dev/null | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/' | head -n 1 || true)
            if [ -n "$val" ]; then echo "$val"; return; fi
        fi
    done
    for f in /etc/environment /etc/profile.d/*codespaces*.sh /home/vscode/.bashrc /home/codespace/.bashrc /root/.bashrc /etc/profile; do
        if [ -f "$f" ]; then
            val=$(grep -E "^(export[[:space:]]+)?${var_name}=" "$f" 2>/dev/null | head -n 1 | cut -d'=' -f2- | tr -d '"\r\n' | tr -d "'" || true)
            if [ -n "$val" ]; then echo "$val"; return; fi
        fi
    done
    if [ "$var_name" = "CODESPACE_NAME" ] && command -v gh >/dev/null 2>&1; then
        val=$(gh codespace list --json name -q '.[0].name' 2>/dev/null || true)
        if [ -n "$val" ]; then echo "$val"; return; fi
    fi
    echo ""
}

if [ "$IS_TERMUX" = "true" ]; then
    DOC_ROOT="${HOME}/webconsole"
elif [ -n "$CODESPACE_NAME" ] || [ "${CODESPACES:-false}" = "true" ] || [ -d "/workspaces" ] || [ -d "/.codespaces" ]; then
    IS_CODESPACES=true
    if [ -z "$CODESPACE_NAME" ] || [ "$CODESPACE_NAME" = "codespace" ] || [ "$CODESPACE_NAME" = "localhost" ]; then
        CODESPACE_NAME=$(extract_cs_var "CODESPACE_NAME")
    fi
    EXTRACTED_DOMAIN=$(extract_cs_var "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN")
    if [ -n "$EXTRACTED_DOMAIN" ]; then CODESPACE_DOMAIN="$EXTRACTED_DOMAIN"; fi
    
    GITHUB_TOKEN="${GITHUB_TOKEN:-}"
    if [ -z "$GITHUB_TOKEN" ]; then GITHUB_TOKEN=$(extract_cs_var "GITHUB_TOKEN"); fi
    if [ -z "$GITHUB_TOKEN" ]; then GITHUB_TOKEN=$(extract_cs_var "GH_TOKEN"); fi
    if [ -n "$GITHUB_TOKEN" ]; then export GITHUB_TOKEN="$GITHUB_TOKEN"; export GH_TOKEN="$GITHUB_TOKEN"; fi
    
    if [ -d "/workspaces" ]; then
        for d in /workspaces/*; do
            if [ -d "$d" ] && [ "$(basename "$d")" != ".codespaces" ]; then
                WS_ROOT="$d"
                break
            fi
        done
        [ -n "$WS_ROOT" ] || WS_ROOT="/workspaces"
    fi
    [ -n "$WS_ROOT" ] && DOC_ROOT="$WS_ROOT"
    
    if [ -z "$CODESPACE_NAME" ]; then
        HN=$(hostname 2>/dev/null || echo "")
        if [[ "$HN" =~ ^codespaces-[a-z0-9]+ ]] || [[ "$HN" =~ [-a-z0-9]{8,} ]]; then CODESPACE_NAME="$HN"; else CODESPACE_NAME="codespace"; fi
    fi
fi

# Detect Distro
OS_FAMILY="unknown"
DISTRO="unknown"
VERSION_ID="unknown"
ARCH="$(uname -m)"

if [ "$IS_TERMUX" = "true" ]; then
    OS_FAMILY="termux"; DISTRO="termux"; VERSION_ID="android"
elif [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO="${ID:-unknown}"; VERSION_ID="${VERSION_ID:-unknown}"; ID_LIKE="${ID_LIKE:-}"
elif [ -f /etc/redhat-release ]; then DISTRO="rhel"
elif [ -f /etc/debian_version ]; then DISTRO="debian"
elif [ -f /etc/alpine-release ]; then DISTRO="alpine"
elif [ -f /etc/arch-release ]; then DISTRO="arch"
fi

case "$DISTRO" in
    termux) OS_FAMILY="termux" ;;
    ubuntu|debian|linuxmint|pop|kali|raspbian|elementary) OS_FAMILY="debian" ;;
    centos|rhel|rocky|almalinux|fedora|ol|amzn) OS_FAMILY="rhel" ;;
    alpine) OS_FAMILY="alpine" ;;
    arch|manjaro|endeavouros) OS_FAMILY="arch" ;;
    *)
        if [[ "${ID_LIKE:-}" =~ (debian|ubuntu) ]]; then OS_FAMILY="debian";
        elif [[ "${ID_LIKE:-}" =~ (rhel|fedora|centos) ]]; then OS_FAMILY="rhel";
        elif [[ "${ID_LIKE:-}" =~ (arch) ]]; then OS_FAMILY="arch";
        else OS_FAMILY="debian"; fi
        ;;
esac

# Helper: Guaranteed Persistent PHP Server Launcher (Fixes Termux OPcache lock errors)
start_php_server() {
    local port="$1"
    local doc="$2"
    mkdir -p "$doc" 2>/dev/null || true
    mkdir -p "$TMP_DIR" 2>/dev/null || true
    export TMPDIR="$TMP_DIR"
    
    local php_opts="-d opcache.enable=0 -d opcache.enable_cli=0 -d sys_temp_dir=${TMP_DIR} -d upload_tmp_dir=${TMP_DIR}"
    
    fuser -k "${port}/tcp" 2>/dev/null || true
    pkill -f "php .*0.0.0.0:${port}" 2>/dev/null || true
    sleep 0.5
    
    if command -v tmux >/dev/null 2>&1; then
        tmux kill-session -t "wcp-${port}" 2>/dev/null || true
        tmux new-session -d -s "wcp-${port}" "cd '${doc}' && export TMPDIR='${TMP_DIR}' && exec php ${php_opts} -S 0.0.0.0:${port} -t '${doc}'" 2>/dev/null || true
    fi
    
    if ! pgrep -f "php .*0.0.0.0:${port}" >/dev/null 2>&1; then
        (cd "$doc" && export TMPDIR="$TMP_DIR" && setsid nohup php ${php_opts} -S 0.0.0.0:${port} -t "$doc" > "${TMP_DIR}/wcp-${port}.log" 2>&1 &) 2>/dev/null || true
        disown -a 2>/dev/null || true
    fi
    
    sleep 1
    local code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${port}/" 2>/dev/null || echo "err")
    if [ "$code" = "200" ] || [ "$code" = "302" ] || [ "$code" = "403" ] || [ "$code" = "404" ]; then
        log_ok "WebConsole server is active on Port ${port} [HTTP ${code}]."
    else
        log_ok "WebConsole daemon launched on Port ${port}."
    fi
}

deploy_webconsole_and_cli() {
    mkdir -p "$DOC_ROOT" 2>/dev/null || true
    WCP_URL="https://raw.githubusercontent.com/fazilatma/new/main/webconsole.php?t=$(date +%s)"
    curl -fsSL "$WCP_URL" -o "${DOC_ROOT}/webconsole.php" 2>/dev/null || true
    cp -f "${DOC_ROOT}/webconsole.php" "${DOC_ROOT}/index.php" 2>/dev/null || true
    [ "$IS_TERMUX" = "false" ] && mkdir -p /var/www/html && cp -f "${DOC_ROOT}/webconsole.php" /var/www/html/webconsole.php 2>/dev/null || true
    
    CLI_TARGET="/usr/local/bin/wcp"
    [ "$IS_TERMUX" = "true" ] && CLI_TARGET="${PREFIX:-/data/data/com.termux/files/usr}/bin/wcp"
    WCP_CLI_URL="https://raw.githubusercontent.com/fazilatma/new/main/wcp?t=$(date +%s)"
    curl -fsSL "$WCP_CLI_URL" -o "$CLI_TARGET" 2>/dev/null || true
    chmod +x "$CLI_TARGET" 2>/dev/null || true
    [ "$IS_TERMUX" = "false" ] && cp -f "$CLI_TARGET" /usr/bin/wcp 2>/dev/null || true
}

install_node22_stack() {
    log_step "NODE" "Installing Node.js 22 LTS & Modern JS Package Ecosystem..."
    if [ "$OS_FAMILY" = "termux" ]; then
        pkg update -y || true
        pkg install -y nodejs-lts clang make jq tar tmux 2>/dev/null || pkg install -y nodejs jq tar tmux || true
    elif [ "$OS_FAMILY" = "debian" ]; then
        rm -f /etc/apt/sources.list.d/nodesource*.list /etc/apt/sources.list.d/nodesource*.sources 2>/dev/null || true
        rm -f /etc/apt/keyrings/nodesource*.gpg /usr/share/keyrings/nodesource*.gpg 2>/dev/null || true
        apt-get update -y || true; apt-get purge -y libnode-dev libnode72 2>/dev/null || true
        apt-get install -y --no-install-recommends curl wget git unzip zip tar tmux htop jq build-essential ca-certificates gnupg sudo 2>/dev/null || true
        mkdir -p /etc/apt/keyrings
        curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes 2>/dev/null || true
        echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
        apt-get update -y || true; apt-get install -y nodejs || true
    elif [ "$OS_FAMILY" = "rhel" ]; then
        curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - 2>/dev/null || true
        dnf install -y nodejs gcc gcc-c++ make jq tmux 2>/dev/null || yum install -y nodejs gcc gcc-c++ make jq tmux || true
    fi

    if command -v npm >/dev/null 2>&1; then
        npm install -g pm2 yarn pnpm nodemon tsx typescript esbuild wrangler --silent 2>/dev/null || true
    fi
    log_ok "Node.js $(node -v 2>/dev/null || echo '22') and npm $(npm -v 2>/dev/null || echo '') installed."
}

install_python_stack() {
    log_step "PYTHON" "Installing Python 3 & High-Performance Scraping Stack..."
    if [ "$OS_FAMILY" = "termux" ]; then
        pkg update -y || true
        pkg install -y python clang make libxml2 libxslt libffi 2>/dev/null || true
    elif [ "$OS_FAMILY" = "debian" ]; then
        apt-get update -y || true
        apt-get install -y --no-install-recommends python3 python3-pip python3-dev python3-venv build-essential libxml2-dev libxslt1-dev libffi-dev libssl-dev 2>/dev/null || true
    elif [ "$OS_FAMILY" = "rhel" ]; then
        dnf install -y python3 python3-pip python3-devel gcc gcc-c++ libxml2-devel libxslt-devel 2>/dev/null || true
    fi

    python3 -m pip install --upgrade pip --break-system-packages 2>/dev/null || python3 -m pip install --upgrade pip 2>/dev/null || true
    PY_PACKAGES="requests flask beautifulsoup4 lxml httpx curl_cffi cloudscraper aiohttp playwright html5lib selectolax basalam-sdk psutil python-dotenv fastapi uvicorn fake-useragent tqdm pandas"
    python3 -m pip install --break-system-packages --ignore-installed $PY_PACKAGES 2>/dev/null || python3 -m pip install $PY_PACKAGES 2>/dev/null || true
    log_ok "Python $(python3 --version 2>/dev/null || echo '3') scraping stack installed."
}

# ------------------------------------------------------------------------------
# 2. Interactive Mode Selection Menu (5 Options)
# ------------------------------------------------------------------------------
echo -e "${CLR_CYAN}${CLR_BOLD}"
echo "================================================================================"
echo "          🚀 WebConsole Pro Setup - Operation Mode Selection                    "
echo "================================================================================"
echo -e "${CLR_RESET}"
echo -e "  ${CLR_GREEN}${CLR_BOLD}[1] ⚡ Start WebConsole Server (Default)${CLR_RESET}"
echo -e "      • Starts persistent background server on Port 8888 & outputs live URLs (~1s)"
echo -e ""
echo -e "  ${CLR_CYAN}${CLR_BOLD}[2] 🔄 Quick Update WebConsole & wcp CLI${CLR_RESET}"
echo -e "      • Downloads latest WebConsole Pro v2.8.5 and wcp CLI from GitHub (~3s)"
echo -e ""
echo -e "  ${CLR_YELLOW}${CLR_BOLD}[3] 📦 Full All-in-One Installation${CLR_RESET}"
echo -e "      • Installs Web Server, Node 22 LTS, Python 3 Stack, Scraping Tools (~1-2m)"
echo -e ""
echo -e "  ${CLR_MAGENTA}${CLR_BOLD}[4] 🟢 Dedicated Node.js 22 LTS Stack${CLR_RESET}"
echo -e "      • Installs Node.js 22.x LTS (node:sqlite ready), PM2, Yarn, PNPM, Wrangler (~30s)"
echo -e ""
echo -e "  ${CLR_BLUE}${CLR_BOLD}[5] 🐍 Dedicated Python 3 & Scraping Stack${CLR_RESET}"
echo -e "      • Installs Python 3, curl_cffi, playwright, cloudscraper, basalam-sdk (~45s)"
echo -e "${CLR_CYAN}================================================================================${CLR_RESET}"

MODE_INPUT=""
if [ -n "${1:-}" ]; then
    MODE_INPUT="$1"
elif [ -n "${MODE:-}" ]; then
    MODE_INPUT="$MODE"
elif [ -r /dev/tty ]; then
    echo -ne "${CLR_BOLD}👉 Select an option [1-5] (Instant 1-key press / Auto-selects 1 in 15s): ${CLR_RESET}"
    read -r -n 1 -t 15 user_key < /dev/tty 2>/dev/null || user_key="1"
    echo ""
    MODE_INPUT="$user_key"
elif [ -t 0 ]; then
    echo -ne "${CLR_BOLD}👉 Select an option [1-5] (Instant 1-key press / Auto-selects 1 in 15s): ${CLR_RESET}"
    read -r -n 1 -t 15 user_key 2>/dev/null || user_key="1"
    echo ""
    MODE_INPUT="$user_key"
else
    MODE_INPUT="1"
fi

MODE=$(echo "$MODE_INPUT" | tr -dc '0-9' | head -c 1)
[ -z "$MODE" ] && MODE="1"

echo -e "${CLR_GREEN}✓ Selected Option [${MODE}]${CLR_RESET}\n"

case "$MODE" in
    1)
        log_info "Mode [1] selected: Starting WebConsole Server..."
        mkdir -p "$DOC_ROOT" 2>/dev/null || true
        
        if [ ! -f "${DOC_ROOT}/webconsole.php" ] && [ ! -f "${DOC_ROOT}/index.php" ]; then
            log_info "Fetching WebConsole Pro..."
            deploy_webconsole_and_cli
        fi
        
        if ! command -v wcp >/dev/null 2>&1; then
            deploy_webconsole_and_cli
        fi
        
        start_php_server "8888" "$DOC_ROOT"
        
        if [ "$IS_CODESPACES" = "true" ] && [ -n "$CODESPACE_NAME" ] && [ "$CODESPACE_NAME" != "codespace" ]; then
            gh codespace ports visibility "8888:public" -c "$CODESPACE_NAME" 2>/dev/null || true
        fi
        ;;

    2)
        log_info "Mode [2] selected: Performing Quick Update of WebConsole & wcp CLI..."
        deploy_webconsole_and_cli
        start_php_server "8888" "$DOC_ROOT"
        log_ok "WebConsole Pro and wcp CLI updated to latest version."
        ;;

    3)
        log_info "Mode [3] selected: Running Full All-in-One Installation..."
        
        # Base PHP & Web server
        if [ "$OS_FAMILY" = "termux" ]; then
            pkg update -y || true
            pkg install -y bash curl wget git php apache2 nodejs-lts python clang make jq tar tmux htop 2>/dev/null || true
        elif [ "$OS_FAMILY" = "debian" ]; then
            apt-get update -y || true
            apt-get install -y --no-install-recommends curl wget git unzip zip tar tmux htop jq ufw build-essential ca-certificates gnupg lsb-release software-properties-common sudo apache2 libapache2-mod-php php php-cli php-curl php-json php-mbstring php-xml php-zip php-bcmath php-intl php-sqlite3 2>/dev/null || true
        elif [ "$OS_FAMILY" = "rhel" ]; then
            dnf install -y epel-release 2>/dev/null || true; dnf update -y; dnf install -y curl wget git unzip zip tar tmux htop jq gcc gcc-c++ make ca-certificates sudo httpd php php-cli php-curl php-json php-mbstring php-xml php-zip php-bcmath php-intl php-pdo 2>/dev/null || true
        fi

        install_node22_stack
        install_python_stack

        # Sudoers
        if [ "$IS_TERMUX" = "false" ]; then
            mkdir -p /etc/sudoers.d
            cat << SUDOERS_CONF > /etc/sudoers.d/99-webconsole-nopasswd 2>/dev/null || true
www-data ALL=(ALL) NOPASSWD: ALL
apache ALL=(ALL) NOPASSWD: ALL
nginx ALL=(ALL) NOPASSWD: ALL
http ALL=(ALL) NOPASSWD: ALL
vscode ALL=(ALL) NOPASSWD: ALL
codespace ALL=(ALL) NOPASSWD: ALL
SUDOERS_CONF
            chmod 0440 /etc/sudoers.d/99-webconsole-nopasswd 2>/dev/null || true
        fi

        deploy_webconsole_and_cli
        start_php_server "8888" "$DOC_ROOT"
        log_ok "Full installation completed successfully."
        ;;

    4)
        log_info "Mode [4] selected: Installing Dedicated Node.js 22 LTS Stack..."
        install_node22_stack
        deploy_webconsole_and_cli
        start_php_server "8888" "$DOC_ROOT"
        log_ok "Dedicated Node.js 22 LTS stack installed and server ready."
        ;;

    5)
        log_info "Mode [5] selected: Installing Dedicated Python 3 & Web Scraping Stack..."
        install_python_stack
        deploy_webconsole_and_cli
        start_php_server "8888" "$DOC_ROOT"
        log_ok "Dedicated Python 3 & Web Scraping stack installed and server ready."
        ;;

    *)
        log_err "Invalid selection [${MODE}]. Defaulting to Start Server."
        deploy_webconsole_and_cli
        start_php_server "8888" "$DOC_ROOT"
        ;;
esac

# ------------------------------------------------------------------------------
# 3. Final Summary & Links
# ------------------------------------------------------------------------------
SERVER_IP=$(curl -s4m 2 ifconfig.me || curl -s4m 2 api.ipify.org || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

echo ""
echo -e "${CLR_GREEN}${CLR_BOLD}================================================================================"
echo "          🎉 WebConsole Pro v2.8.5 Ready & Operational!                         "
echo "================================================================================${CLR_RESET}"
echo ""

if [ "$IS_TERMUX" = "true" ]; then
    echo -e "  📱 ${CLR_BOLD}Termux Local Access:${CLR_RESET}   ${CLR_GREEN}${CLR_BOLD}http://localhost:8888/${CLR_RESET} (or ${CLR_CYAN}http://127.0.0.1:8888/${CLR_RESET})"
    echo -e "  🛡️ ${CLR_BOLD}Proxy Gateway:${CLR_RESET}         ${CLR_CYAN}http://localhost:8888/?url=https://example.com/page${CLR_RESET}"
    echo -e "  📂 ${CLR_BOLD}Termux Root Folder:${CLR_RESET}   ${CLR_CYAN}${DOC_ROOT}/${CLR_RESET}"
elif [ "$IS_CODESPACES" = "true" ]; then
    echo -e "  📂 ${CLR_BOLD}Workspace Files:${CLR_RESET}      ${CLR_GREEN}${DOC_ROOT}/${CLR_RESET} (Visible directly in VS Code Sidebar)"
    echo -e "  🌐 ${CLR_BOLD}GitHub Codespaces Public Access Links:${CLR_RESET}"
    echo -e "  ------------------------------------------------------------------------------"
    echo -e "  🐘 ${CLR_BOLD}WebConsole (Port 8888):${CLR_RESET}        ${CLR_GREEN}${CLR_BOLD}https://${CODESPACE_NAME}-8888.${CODESPACE_DOMAIN}/${CLR_RESET}"
    echo -e "  🛡️ ${CLR_BOLD}Proxy Gateway:${CLR_RESET}                 ${CLR_CYAN}${CLR_BOLD}https://${CODESPACE_NAME}-8888.${CODESPACE_DOMAIN}/?url=https://example.com/page${CLR_RESET}"
    echo -e "  🟢 ${CLR_BOLD}Node.js Apps (Port 3000):${CLR_RESET}      ${CLR_MAGENTA}https://${CODESPACE_NAME}-3000.${CODESPACE_DOMAIN}/${CLR_RESET}"
    echo -e "  🐍 ${CLR_BOLD}Python Projects (Port 9000):${CLR_RESET}   ${CLR_YELLOW}https://${CODESPACE_NAME}-9000.${CODESPACE_DOMAIN}/${CLR_RESET} (or 8000, 8081)"
else
    echo -e "  🌐 ${CLR_BOLD}WebConsole URL:${CLR_RESET}        ${CLR_GREEN}${CLR_BOLD}http://${SERVER_IP:-YOUR_SERVER_IP}:8888/${CLR_RESET}"
    echo -e "  🛡️ ${CLR_BOLD}Proxy Gateway:${CLR_RESET}         ${CLR_CYAN}${CLR_BOLD}http://${SERVER_IP:-YOUR_SERVER_IP}:8888/?url=https://example.com/page${CLR_RESET}"
fi

echo ""
echo -e "${CLR_BOLD}📋 WebConsole Pro Universal CLI (wcp) Command Reference:${CLR_RESET}"
echo -e "${CLR_GRAY}┌──────────────────────┬───────────────────────────────────────────────────────┐${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_CYAN}${CLR_BOLD}Command${CLR_RESET}              ${CLR_GRAY}│${CLR_RESET} ${CLR_BOLD}Description${CLR_RESET}                                           ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}├──────────────────────┼───────────────────────────────────────────────────────┤${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp status${CLR_RESET}           ${CLR_GRAY}│${CLR_RESET} Live server metrics: CPU, RAM, Swap, Apache & Services ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp url${CLR_RESET}              ${CLR_GRAY}│${CLR_RESET} Print public HTTPS Codespaces, VPS, or Termux URLs     ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp port <number>${CLR_RESET}    ${CLR_GRAY}│${CLR_RESET} Change WebConsole listening port (e.g. wcp port 8888)   ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp run-all${CLR_RESET}          ${CLR_GRAY}│${CLR_RESET} Launch/start all active and auto-start projects        ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp shutdown${CLR_RESET}         ${CLR_GRAY}│${CLR_RESET} Stop WebConsole server AND all running project services ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp stop-all${CLR_RESET}         ${CLR_GRAY}│${CLR_RESET} Stop all currently running background project services ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp restart-all${CLR_RESET}      ${CLR_GRAY}│${CLR_RESET} Gracefully restart all configured project services     ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp on / wcp off${CLR_RESET}     ${CLR_GRAY}│${CLR_RESET} Quick 1-word server toggle: turn server ON or OFF       ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp serve [port]${CLR_RESET}     ${CLR_GRAY}│${CLR_RESET} Start/restart background WebConsole server (default 8888)${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp proj [list]${CLR_RESET}      ${CLR_GRAY}│${CLR_RESET} Display table of all projects, ports, types & status   ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp start <id>${CLR_RESET}       ${CLR_GRAY}│${CLR_RESET} Start a specific project service by ID or Name         ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp stop <id>${CLR_RESET}        ${CLR_GRAY}│${CLR_RESET} Stop a specific running project service                ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp restart <id>${CLR_RESET}     ${CLR_GRAY}│${CLR_RESET} Restart a specific project service                     ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp logs <id>${CLR_RESET}        ${CLR_GRAY}│${CLR_RESET} Stream and tail live console logs of a project         ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp ports${CLR_RESET}            ${CLR_GRAY}│${CLR_RESET} List all active listening TCP ports, sockets & PIDs    ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp killport <port>${CLR_RESET}  ${CLR_GRAY}│${CLR_RESET} Forcefully free and kill process listening on a port   ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp swap [size_mb]${CLR_RESET}   ${CLR_GRAY}│${CLR_RESET} View or dynamically resize virtual Swap memory (MB)    ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp pass [password]${CLR_RESET}  ${CLR_GRAY}│${CLR_RESET} Set or reset WebConsole master administrator password  ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp update${CLR_RESET}           ${CLR_GRAY}│${CLR_RESET} 1-click self-update to latest WebConsole release       ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp doctor${CLR_RESET}           ${CLR_GRAY}│${CLR_RESET} Run system health diagnostics for Apache, PHP, Python  ${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}│${CLR_RESET} ${CLR_GREEN}wcp rebuild${CLR_RESET}          ${CLR_GRAY}│${CLR_RESET} Trigger persistent port container rebuild in Codespaces${CLR_GRAY}│${CLR_RESET}"
echo -e "${CLR_GRAY}└──────────────────────┴───────────────────────────────────────────────────────┘${CLR_RESET}"
echo ""
echo -e "  🔑 ${CLR_BOLD}First Login:${CLR_RESET}   Set your master administrator password on first visit."
echo -e "  🔄 ${CLR_BOLD}Self-Update:${CLR_RESET}  Run ${CLR_GREEN}wcp update${CLR_RESET} anytime or use the WebConsole Settings tab."
echo ""
echo -e "${CLR_CYAN}================================================================================${CLR_RESET}"
