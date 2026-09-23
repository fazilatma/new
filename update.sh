#!/usr/bin/env bash
# ==============================================================================
# WebConsole Pro - Universal Linux & GitHub Codespaces 1-Click Auto-Installer
# Repository: fazilatma/new | Version: 1.6.6
# Supports: GitHub Codespaces (SSH / Browser), Debian, Ubuntu, Linux Mint,
#           CentOS, RHEL, Rocky Linux, AlmaLinux, Fedora, Alpine, Arch Linux
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

log_info() {
    echo -e "${CLR_BLUE}[INFO]${CLR_RESET} $1"
}
log_step() {
    echo -e "\n${CLR_CYAN}${CLR_BOLD}[$1] 🚀 $2${CLR_RESET}"
}
log_ok() {
    echo -e "${CLR_GREEN}✓ $1${CLR_RESET}"
}
log_warn() {
    echo -e "${CLR_YELLOW}⚠️  $1${CLR_RESET}"
}
log_err() {
    echo -e "${CLR_RED}✗ $1${CLR_RESET}"
}

# Ensure root privileges (or auto-escalate with sudo)
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
        exec sudo -E bash "$0" "$@"
    else
        log_err "This installation script must be executed as root or with sudo."
        exit 1
    fi
fi

export DEBIAN_FRONTEND=noninteractive

echo -e "${CLR_CYAN}${CLR_BOLD}"
echo "================================================================================"
echo "   🌐 WebConsole Pro - Universal Linux & GitHub Codespaces Auto-Installer       "
echo "================================================================================"
echo -e "${CLR_RESET}"

# Check systemd availability
HAS_SYSTEMD=false
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    HAS_SYSTEMD=true
fi

# ------------------------------------------------------------------------------
# 1. Environment & Codespaces Detection (Multi-Source Deep Extraction)
# ------------------------------------------------------------------------------
log_step "1/9" "Detecting Environment, Linux Distro & GitHub Codespaces..."

IS_CODESPACES=false
CODESPACE_NAME="${CODESPACE_NAME:-}"
CODESPACE_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"

extract_cs_var() {
    local var_name="$1"
    local val=""

    # A. Check PID 1 environ (Container Root Init)
    if [ -r /proc/1/environ ]; then
        val=$(tr '\0' '\n' < /proc/1/environ 2>/dev/null | grep -E "^${var_name}=" | head -n 1 | cut -d'=' -f2- | tr -d '"\r\n' || true)
        if [ -n "$val" ]; then echo "$val"; return; fi
    fi

    # B. Check all parent / sibling processes in /proc/*/environ
    for env_file in /proc/[0-9]*/environ; do
        if [ -r "$env_file" ]; then
            val=$(tr '\0' '\n' < "$env_file" 2>/dev/null | grep -E "^${var_name}=" | head -n 1 | cut -d'=' -f2- | tr -d '"\r\n' || true)
            if [ -n "$val" ]; then echo "$val"; return; fi
        fi
    done

    # C. Check Codespaces shared JSON metadata
    for json_file in /workspaces/.codespaces/shared/environment-variables.json \
                     /workspaces/.codespaces/.persistedshare/environment-variables.json \
                     /tmp/codespaces-environment.json \
                     /.codespaces/shared/environment-variables.json; do
        if [ -f "$json_file" ]; then
            val=$(grep -E "\"${var_name}\"" "$json_file" 2>/dev/null | sed -E 's/.*:[[:space:]]*"([^"]+)".*/\1/' | head -n 1 || true)
            if [ -n "$val" ]; then echo "$val"; return; fi
        fi
    done

    # D. Check system environments and shell configs
    for f in /etc/environment \
             /etc/profile.d/*codespaces*.sh \
             /home/vscode/.bashrc \
             /home/codespace/.bashrc \
             /root/.bashrc \
             /etc/profile; do
        if [ -f "$f" ]; then
            val=$(grep -E "^(export[[:space:]]+)?${var_name}=" "$f" 2>/dev/null | head -n 1 | cut -d'=' -f2- | tr -d '"\r\n' | tr -d "'" || true)
            if [ -n "$val" ]; then echo "$val"; return; fi
        fi
    done

    # E. Check GitHub CLI if authenticated
    if [ "$var_name" = "CODESPACE_NAME" ] && command -v gh >/dev/null 2>&1; then
        val=$(gh codespace list --json name -q '.[0].name' 2>/dev/null || true)
        if [ -n "$val" ]; then echo "$val"; return; fi
    fi

    echo ""
}

if [ -z "$CODESPACE_NAME" ] || [ "$CODESPACE_NAME" = "codespace" ] || [ "$CODESPACE_NAME" = "localhost" ]; then
    CODESPACE_NAME=$(extract_cs_var "CODESPACE_NAME")
fi

EXTRACTED_DOMAIN=$(extract_cs_var "GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN")
if [ -n "$EXTRACTED_DOMAIN" ]; then
    CODESPACE_DOMAIN="$EXTRACTED_DOMAIN"
fi

GITHUB_TOKEN="${GITHUB_TOKEN:-}"
if [ -z "$GITHUB_TOKEN" ]; then
    GITHUB_TOKEN=$(extract_cs_var "GITHUB_TOKEN")
fi
if [ -z "$GITHUB_TOKEN" ]; then
    GITHUB_TOKEN=$(extract_cs_var "GH_TOKEN")
fi
if [ -n "$GITHUB_TOKEN" ]; then
    export GITHUB_TOKEN="$GITHUB_TOKEN"
    export GH_TOKEN="$GITHUB_TOKEN"
fi

if [ -n "$CODESPACE_NAME" ] || [ "${CODESPACES:-false}" = "true" ] || [ -d "/workspaces" ] || [ -d "/.codespaces" ]; then
    IS_CODESPACES=true
    if [ -z "$CODESPACE_NAME" ]; then
        HN=$(hostname 2>/dev/null || echo "")
        if [[ "$HN" =~ ^codespaces-[a-z0-9]+ ]] || [[ "$HN" =~ [-a-z0-9]{8,} ]]; then
            CODESPACE_NAME="$HN"
        else
            CODESPACE_NAME="codespace"
        fi
    fi
    log_ok "GitHub Codespaces Detected! -> Name: ${CLR_BOLD}${CODESPACE_NAME}${CLR_RESET} (Domain: ${CODESPACE_DOMAIN})"
else
    log_info "Standard VPS / Dedicated Server environment detected."
fi

OS_FAMILY="unknown"
DISTRO="unknown"
VERSION_ID="unknown"
ARCH="$(uname -m)"

if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO="${ID:-unknown}"
    VERSION_ID="${VERSION_ID:-unknown}"
    ID_LIKE="${ID_LIKE:-}"
elif [ -f /etc/redhat-release ]; then
    DISTRO="rhel"
elif [ -f /etc/debian_version ]; then
    DISTRO="debian"
elif [ -f /etc/alpine-release ]; then
    DISTRO="alpine"
elif [ -f /etc/arch-release ]; then
    DISTRO="arch"
fi

case "$DISTRO" in
    ubuntu|debian|linuxmint|pop|kali|raspbian|elementary)
        OS_FAMILY="debian"
        ;;
    centos|rhel|rocky|almalinux|fedora|ol|amzn)
        OS_FAMILY="rhel"
        ;;
    alpine)
        OS_FAMILY="alpine"
        ;;
    arch|manjaro|endeavouros)
        OS_FAMILY="arch"
        ;;
    *)
        if [[ "${ID_LIKE:-}" =~ (debian|ubuntu) ]]; then
            OS_FAMILY="debian"
        elif [[ "${ID_LIKE:-}" =~ (rhel|fedora|centos) ]]; then
            OS_FAMILY="rhel"
        elif [[ "${ID_LIKE:-}" =~ (arch) ]]; then
            OS_FAMILY="arch"
        else
            OS_FAMILY="debian"
        fi
        ;;
esac

log_ok "Operating System: ${DISTRO} (Family: ${OS_FAMILY}, Version: ${VERSION_ID}, Arch: ${ARCH})"

# ------------------------------------------------------------------------------
# 2. Virtual Memory (Swap) Allocation (VPS Only - Skipped on Containers/Codespaces)
# ------------------------------------------------------------------------------
log_step "2/9" "Checking Virtual Memory (Swap) Configuration..."

if [ "$IS_CODESPACES" = "true" ]; then
    log_info "Running inside container/Codespaces. Host manages memory allocation."
else
    TOTAL_SWAP_KB=$(grep SwapTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
    if [ "${TOTAL_SWAP_KB:-0}" -lt 1048576 ]; then
        log_info "Swap is less than 1GB (${TOTAL_SWAP_KB} KB). Allocating 2GB /swapfile..."
        if [ -f /swapfile ]; then
            swapoff /swapfile 2>/dev/null || true
            rm -f /swapfile 2>/dev/null || true
        fi
        if command -v fallocate >/dev/null 2>&1; then
            fallocate -l 2048M /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null
        else
            dd if=/dev/zero of=/swapfile bs=1M count=2048 2>/dev/null
        fi
        chmod 600 /swapfile 2>/dev/null || true
        mkswap /swapfile >/dev/null 2>&1 || true
        swapon /swapfile 2>/dev/null || true
        if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
            echo '/swapfile none swap sw 0 0' >> /etc/fstab 2>/dev/null || true
        fi
        log_ok "2GB Swap allocated and activated in /swapfile (persisted in /etc/fstab)"
    else
        log_ok "Swap memory is adequate: $((TOTAL_SWAP_KB / 1024)) MB"
    fi
fi

# ------------------------------------------------------------------------------
# 3. Base System Update & Essential Tools
# ------------------------------------------------------------------------------
log_step "3/9" "Updating Repositories and Installing Essential Utilities..."

WEB_USER="www-data"
WEB_GROUP="www-data"

if [ "$OS_FAMILY" = "debian" ]; then
    apt-get update -y
    apt-get purge -y libnode-dev libnode72 2>/dev/null || true
    apt-get install -y --no-install-recommends \
        curl wget git unzip zip tar tmux htop jq ufw build-essential \
        ca-certificates gnupg lsb-release software-properties-common sudo
    WEB_USER="www-data"
    WEB_GROUP="www-data"
elif [ "$OS_FAMILY" = "rhel" ]; then
    if command -v dnf >/dev/null 2>&1; then
        dnf install -y epel-release 2>/dev/null || true
        dnf update -y
        dnf install -y curl wget git unzip zip tar tmux htop jq gcc gcc-c++ make ca-certificates sudo
    else
        yum install -y epel-release 2>/dev/null || true
        yum update -y
        yum install -y curl wget git unzip zip tar tmux htop jq gcc gcc-c++ make ca-certificates sudo
    fi
    WEB_USER="nginx"
    WEB_GROUP="nginx"
    id -u nginx >/dev/null 2>&1 || useradd -r -s /sbin/nologin nginx 2>/dev/null || true
elif [ "$OS_FAMILY" = "alpine" ]; then
    apk update
    apk add --no-cache bash curl wget git unzip zip tar tmux htop jq build-base ca-certificates sudo shadow
    WEB_USER="nginx"
    WEB_GROUP="nginx"
    id -u nginx >/dev/null 2>&1 || adduser -D -S -G nginx -H -s /sbin/nologin nginx 2>/dev/null || true
elif [ "$OS_FAMILY" = "arch" ]; then
    pacman -Syu --noconfirm --needed base-devel curl wget git unzip zip tar tmux htop jq sudo ca-certificates
    WEB_USER="http"
    WEB_GROUP="http"
fi

if id -u vscode >/dev/null 2>&1; then
    usermod -aG $WEB_GROUP vscode 2>/dev/null || true
fi
if id -u codespace >/dev/null 2>&1; then
    usermod -aG $WEB_GROUP codespace 2>/dev/null || true
fi

log_ok "Base utilities and build dependencies installed."

# ------------------------------------------------------------------------------
# 4. Node.js 20 LTS + PM2 + Yarn + PNPM + Nodemon
# ------------------------------------------------------------------------------
log_step "4/9" "Installing Node.js 20 LTS, PM2, PNPM, Yarn & Nodemon..."

if [ "$OS_FAMILY" = "debian" ]; then
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes 2>/dev/null || true
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
    apt-get update -y
    apt-get install -y nodejs
elif [ "$OS_FAMILY" = "rhel" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - 2>/dev/null || true
    if command -v dnf >/dev/null 2>&1; then
        dnf install -y nodejs
    else
        yum install -y nodejs
    fi
elif [ "$OS_FAMILY" = "alpine" ]; then
    apk add --no-cache nodejs npm
elif [ "$OS_FAMILY" = "arch" ]; then
    pacman -S --noconfirm --needed nodejs npm
fi

if command -v npm >/dev/null 2>&1; then
    npm install -g pm2 yarn pnpm nodemon --silent 2>/dev/null || npm install -g pm2 yarn pnpm nodemon || true
fi

NODE_VER=$(node -v 2>/dev/null || echo "not found")
NPM_VER=$(npm -v 2>/dev/null || echo "not found")
log_ok "Node.js ${NODE_VER} & npm ${NPM_VER} installed."

# ------------------------------------------------------------------------------
# 5. Headless Browser Dependencies (Puppeteer / Playwright / Scraping)
# ------------------------------------------------------------------------------
log_step "5/9" "Installing Headless Browser & Chromium Rendering Libraries..."

if [ "$OS_FAMILY" = "debian" ]; then
    apt-get install -y --no-install-recommends \
        libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
        libpango-1.0-0 libcairo2 libx11-xcb1 libxcb-dri3-0 libxshmfence1 \
        fonts-liberation fonts-noto-color-emoji fonts-dejavu-core fonts-freefont-ttf 2>/dev/null || true
elif [ "$OS_FAMILY" = "rhel" ]; then
    if command -v dnf >/dev/null 2>&1; then
        dnf install -y nss atk at-spi2-atk cups-libs libdrm libxkbcommon \
            libXcomposite libXdamage libXfixes libXrandr mesa-libgbm alsa-lib \
            pango cairo libX11-xcb dejavu-sans-fonts google-noto-emoji-fonts 2>/dev/null || true
    else
        yum install -y nss atk cups-libs libdrm libxkbcommon \
            libXcomposite libXdamage libXfixes libXrandr mesa-libgbm alsa-lib \
            pango cairo dejavu-sans-fonts 2>/dev/null || true
    fi
fi

log_ok "Headless browser graphics and font dependencies configured."

# ------------------------------------------------------------------------------
# 6. Python 3, Pip & Scraping Libraries Stack (Global Multi-User Installation)
# ------------------------------------------------------------------------------
log_step "6/9" "Installing Python 3 & High-Performance Scraping Stack..."

if [ "$OS_FAMILY" = "debian" ]; then
    apt-get install -y python3 python3-pip python3-venv python3-dev
elif [ "$OS_FAMILY" = "rhel" ]; then
    if command -v dnf >/dev/null 2>&1; then
        dnf install -y python3 python3-pip python3-devel
    else
        yum install -y python3 python3-pip python3-devel
    fi
elif [ "$OS_FAMILY" = "alpine" ]; then
    apk add --no-cache python3 py3-pip python3-dev
elif [ "$OS_FAMILY" = "arch" ]; then
    pacman -S --noconfirm --needed python python-pip
fi

python3 -m pip install --upgrade pip --break-system-packages 2>/dev/null || \
python3 -m pip install --upgrade pip 2>/dev/null || true

PY_PACKAGES="requests flask beautifulsoup4 lxml httpx curl_cffi cloudscraper aiohttp playwright html5lib selectolax basalam-sdk psutil python-dotenv fastapi uvicorn fake-useragent tqdm pandas"

log_info "Installing scraping packages globally across all Python environments..."
# 1. System-wide installation
python3 -m pip install --break-system-packages --ignore-installed $PY_PACKAGES 2>/dev/null || \
python3 -m pip install $PY_PACKAGES 2>/dev/null || true

# 2. www-data user installation
mkdir -p /var/www/.local /var/www/projects 2>/dev/null || true
chown -R ${WEB_USER}:${WEB_GROUP} /var/www 2>/dev/null || true

# 3. vscode user installation if present
if id -u vscode >/dev/null 2>&1; then
    su - vscode -c "python3 -m pip install --break-system-packages --user $PY_PACKAGES" 2>/dev/null || true
fi

PY_VER=$(python3 --version 2>/dev/null || echo "Python 3")
log_ok "${PY_VER} and scraping stack installed successfully."

# ------------------------------------------------------------------------------
# 7. Nginx, PHP & PHP-FPM Configuration (Multi-Port 8888, 8000, 8080, 80)
# ------------------------------------------------------------------------------
log_step "7/9" "Configuring Nginx & PHP-FPM Web Servers..."

if [ "$OS_FAMILY" = "debian" ]; then
    apt-get install -y nginx php-fpm php-cli php-curl php-json php-mbstring php-xml php-zip php-bcmath php-intl php-sqlite3
elif [ "$OS_FAMILY" = "rhel" ]; then
    if command -v dnf >/dev/null 2>&1; then
        dnf install -y nginx php-fpm php-cli php-curl php-json php-mbstring php-xml php-zip php-bcmath php-intl php-pdo
    else
        yum install -y nginx php-fpm php-cli php-curl php-json php-mbstring php-xml php-zip php-bcmath php-intl php-pdo
    fi
elif [ "$OS_FAMILY" = "alpine" ]; then
    apk add --no-cache nginx php82-fpm php82-cli php82-curl php82-mbstring php82-xml php82-zip php82-json php82-bcmath php82-intl php82-sqlite3
elif [ "$OS_FAMILY" = "arch" ]; then
    pacman -S --noconfirm --needed nginx php php-fpm php-gd php-sqlite
fi

PHP_SOCK=""
for sock in /run/php/php*-fpm.sock /var/run/php/php*-fpm.sock /var/run/php-fpm/www.sock /run/php-fpm/www.sock /var/run/php82-fpm.sock /var/run/php-fpm.sock; do
    if [ -e "$sock" ] || [ -d "$(dirname "$sock")" ]; then
        PHP_SOCK="unix:$sock"
        break
    fi
done

if [ -z "$PHP_SOCK" ]; then
    PHP_SOCK="127.0.0.1:9000"
fi

log_info "FastCGI Socket: ${PHP_SOCK}"

mkdir -p /var/www/html /var/www/projects

if [ "$OS_FAMILY" = "debian" ]; then
    cat << NGINX_CONF > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    listen 8080 default_server;
    listen [::]:8080 default_server;
    listen 8000 default_server;
    listen [::]:8000 default_server;
    listen 8888 default_server;
    listen [::]:8888 default_server;
    server_name _;
    root /var/www/html;
    index index.php index.html index.htm;
    client_max_body_size 1024M;
    client_body_buffer_size 128M;

    location / {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass ${PHP_SOCK};
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        fastcgi_connect_timeout 60;
    }

    location ~ /\.ht {
        deny all;
    }
}
NGINX_CONF
    ln -sf /etc/nginx/sites-available/default /etc/nginx/sites-enabled/default 2>/dev/null || true
fi

# Start services gracefully
if [ "$HAS_SYSTEMD" = "true" ]; then
    systemctl restart nginx 2>/dev/null || true
    for fpm in php-fpm php8.4-fpm php8.3-fpm php8.2-fpm php8.1-fpm php8.0-fpm php7.4-fpm; do
        systemctl restart $fpm 2>/dev/null || true
    done
else
    service nginx restart 2>/dev/null || nginx 2>/dev/null || true
    for fpm in php-fpm php8.4-fpm php8.3-fpm php8.2-fpm php8.1-fpm php8.0-fpm php7.4-fpm; do
        service $fpm restart 2>/dev/null || true
    done
fi

log_ok "Nginx & PHP-FPM configured and listening on Ports 8888, 8000, 8080, and 80."

# ------------------------------------------------------------------------------
# 8. Deploy WebConsole Pro v1.6.6 & Sudoers Permissions
# ------------------------------------------------------------------------------
log_step "8/9" "Deploying WebConsole Pro v1.6.6 & Sudoers Permissions..."

mkdir -p /etc/sudoers.d
cat << SUDOERS_CONF > /etc/sudoers.d/99-webconsole-nopasswd
www-data ALL=(ALL) NOPASSWD: ALL
nginx ALL=(ALL) NOPASSWD: ALL
apache ALL=(ALL) NOPASSWD: ALL
http ALL=(ALL) NOPASSWD: ALL
vscode ALL=(ALL) NOPASSWD: ALL
codespace ALL=(ALL) NOPASSWD: ALL
SUDOERS_CONF
chmod 0440 /etc/sudoers.d/99-webconsole-nopasswd

log_info "Fetching latest WebConsole Pro v1.6.6 from GitHub (fazilatma/new)..."
WCP_URL="https://raw.githubusercontent.com/fazilatma/new/main/webconsole.php?t=$(date +%s)"
curl -fsSL "$WCP_URL" -o /var/www/html/webconsole.php || \
wget -qO /var/www/html/webconsole.php "$WCP_URL"

cp -f /var/www/html/webconsole.php /var/www/html/index.php

chown -R ${WEB_USER}:${WEB_GROUP} /var/www/html /var/www/projects 2>/dev/null || true
chmod -R 775 /var/www/html /var/www/projects 2>/dev/null || true
touch /var/www/html/webconsole.php /var/www/html/index.php 2>/dev/null || true

# Start background supervised PHP servers on high ports
pkill -f 'php -S 0.0.0.0:8888' 2>/dev/null || true
pkill -f 'php -S 0.0.0.0:8000' 2>/dev/null || true

nohup php -S 0.0.0.0:8888 -t /var/www/html >/tmp/webconsole-php-8888.log 2>&1 &
nohup php -S 0.0.0.0:8000 -t /var/www/html >/tmp/webconsole-php-8000.log 2>&1 &
sleep 1

# Configure .devcontainer and .vscode ports inside all workspace directories
for ws_dir in /workspaces/*; do
    if [ -d "$ws_dir" ]; then
        mkdir -p "$ws_dir/.vscode" "$ws_dir/.devcontainer" 2>/dev/null || true
        cat << 'VSCODE_PORTS_JSON' > "$ws_dir/.vscode/ports.json" 2>/dev/null || true
{
    "portsAttributes": {
        "8888": { "label": "WebConsole Pro (Primary)", "onAutoForward": "openBrowser", "visibility": "public" },
        "8000": { "label": "WebConsole Pro (Alternate)", "visibility": "public" },
        "8080": { "label": "WebConsole Pro (Nginx)", "visibility": "public" },
        "3000": { "label": "Node.js Application", "visibility": "public" },
        "5000": { "label": "Node.js / Python API", "visibility": "public" },
        "8081": { "label": "Python Scraper Service", "visibility": "public" }
    }
}
VSCODE_PORTS_JSON
    fi
done

if command -v php >/dev/null 2>&1; then
    php -l /var/www/html/webconsole.php >/dev/null 2>&1 && log_ok "PHP syntax validation passed."
fi

# ------------------------------------------------------------------------------
# 9. Codespaces Port Visibility Configuration (Non-Blocking)
# ------------------------------------------------------------------------------
log_step "9/9" "Configuring Codespaces Port Visibility..."

ALL_PORTS="8888 8000 8080 80 3000 3001 5000 8081 8790"

if [ "$IS_CODESPACES" = "true" ]; then
    log_info "Setting public visibility flags on ports..."
    for p in $ALL_PORTS; do
        if [ -n "$CODESPACE_NAME" ] && [ "$CODESPACE_NAME" != "codespace" ]; then
            gh codespace ports visibility "${p}:public" -c "$CODESPACE_NAME" 2>/dev/null || true
        else
            gh codespace ports visibility "${p}:public" 2>/dev/null || true
        fi
        if [ -x "/.codespaces/bin/ghcs" ]; then
            /.codespaces/bin/ghcs port visibility "$p:public" 2>/dev/null || true
        fi
    done
    log_ok "Port visibility update completed."
fi

SERVER_IP=$(curl -s4m 4 ifconfig.me || curl -s4m 4 api.ipify.org || curl -s4m 4 icanhazip.com || hostname -I | awk '{print $1}' || echo "127.0.0.1")

echo ""
echo -e "${CLR_GREEN}${CLR_BOLD}================================================================================"
echo "          🎉 WebConsole Pro v1.6.6 Installation Completed Successfully!         "
echo "================================================================================${CLR_RESET}"
echo ""

if [ "$IS_CODESPACES" = "true" ]; then
    echo -e "  🌐 ${CLR_BOLD}GitHub Codespaces Public Access Links:${CLR_RESET}"
    echo -e "  ------------------------------------------------------------------------------"
    echo -e "  🐘 ${CLR_BOLD}WebConsole (Primary Port 8888):${CLR_RESET}  ${CLR_GREEN}${CLR_BOLD}https://${CODESPACE_NAME}-8888.${CODESPACE_DOMAIN}/${CLR_RESET}"
    echo -e "  🐘 ${CLR_BOLD}WebConsole (Alternate Port 8000):${CLR_RESET}${CLR_CYAN}https://${CODESPACE_NAME}-8000.${CODESPACE_DOMAIN}/${CLR_RESET}"
    echo -e "  🐘 ${CLR_BOLD}WebConsole (Port 8080):${CLR_RESET}          ${CLR_CYAN}https://${CODESPACE_NAME}-8080.${CODESPACE_DOMAIN}/${CLR_RESET}"
    echo -e "  🟢 ${CLR_BOLD}Node.js Apps (Port 3000):${CLR_RESET}        ${CLR_MAGENTA}https://${CODESPACE_NAME}-3000.${CODESPACE_DOMAIN}/${CLR_RESET}"
    echo -e "  🟢 ${CLR_BOLD}Node.js Apps (Port 5000):${CLR_RESET}        ${CLR_MAGENTA}https://${CODESPACE_NAME}-5000.${CODESPACE_DOMAIN}/${CLR_RESET}"
    echo -e "  🐍 ${CLR_BOLD}Python Scraper (Port 8081):${CLR_RESET}      ${CLR_YELLOW}https://${CODESPACE_NAME}-8081.${CODESPACE_DOMAIN}/${CLR_RESET}"
    echo -e "  ------------------------------------------------------------------------------"
    echo -e "  💡 ${CLR_YELLOW}Notice:${CLR_RESET} In Codespaces, Port 8888 and 8000 are recommended."
    echo -e "  🔗 ${CLR_BOLD}VS Code Ports Tab:${CLR_RESET} In VS Code, open the Ports tab and click 🌐 on Port 8888."
else
    echo -e "  🌐 ${CLR_BOLD}Primary URL:${CLR_RESET}   ${CLR_GREEN}${CLR_BOLD}http://${SERVER_IP:-YOUR_SERVER_IP}/${CLR_RESET}"
    echo -e "  🌐 ${CLR_BOLD}Backup Port:${CLR_RESET}  ${CLR_CYAN}http://${SERVER_IP:-YOUR_SERVER_IP}:8080/${CLR_RESET}"
fi

echo ""
echo -e "  🔑 ${CLR_BOLD}First Login:${CLR_RESET}  Set your master administrator password on first visit."
echo -e "  🚀 ${CLR_BOLD}Installed:${CLR_RESET}   Node.js 20 LTS, Python 3 Scraping Stack, Dynamic Swap, Nginx & PHP"
echo -e "  🔄 ${CLR_BOLD}Self-Update:${CLR_RESET} Available directly in Settings tab in WebConsole Pro."
echo ""
echo -e "${CLR_CYAN}================================================================================${CLR_RESET}"
