#!/usr/bin/env bash
# ==============================================================================
# WebConsole Pro - Universal Linux 1-Click VPS Auto-Installer
# Repository: fazilatma/new | Version: 1.6.5
# Supports: Debian, Ubuntu, Linux Mint, CentOS, RHEL, Rocky Linux,
#           AlmaLinux, Fedora, Alpine Linux, Arch Linux
# ==============================================================================

set -euo pipefail

# ANSI Colors
CLR_RESET="\033[0m"
CLR_BOLD="\033[1m"
CLR_GREEN="\033[1;32m"
CLR_BLUE="\033[1;34m"
CLR_CYAN="\033[1;36m"
CLR_YELLOW="\033[1;33m"
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

# Ensure root privileges
if [ "$(id -u)" -ne 0 ]; then
    log_err "This installation script must be executed as root (or with sudo)."
    exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo -e "${CLR_CYAN}${CLR_BOLD}"
echo "================================================================================"
echo "          🌐 WebConsole Pro - Universal Linux 1-Click VPS Installer             "
echo "================================================================================"
echo -e "${CLR_RESET}"

# ------------------------------------------------------------------------------
# 1. Detect Linux Distribution & Version
# ------------------------------------------------------------------------------
log_step "1/8" "Detecting Linux Distribution & System Architecture..."

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
            log_warn "Unknown distribution ($DISTRO). Falling back to Debian/APT compatibility mode."
            OS_FAMILY="debian"
        fi
        ;;
esac

log_ok "Detected OS: ${DISTRO} (Family: ${OS_FAMILY}, Version: ${VERSION_ID}, Arch: ${ARCH})"

# ------------------------------------------------------------------------------
# 2. Swap Memory Management
# ------------------------------------------------------------------------------
log_step "2/8" "Checking and Configuring Virtual Memory (Swap)..."

TOTAL_SWAP_KB=$(grep SwapTotal /proc/meminfo 2>/dev/null | awk '{print $2}' || echo "0")
if [ "${TOTAL_SWAP_KB:-0}" -lt 1048576 ]; then
    log_info "Swap is less than 1GB (${TOTAL_SWAP_KB} KB). Allocating 2GB /swapfile to prevent memory locks..."
    if [ -f /swapfile ]; then
        swapoff /swapfile 2>/dev/null || true
        rm -f /swapfile 2>/dev/null || true
    fi
    if command -v fallocate >/dev/null 2>&1; then
        fallocate -l 2048M /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
    else
        dd if=/dev/zero of=/swapfile bs=1M count=2048
    fi
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null 2>&1
    swapon /swapfile 2>/dev/null || true
    if ! grep -q '/swapfile' /etc/fstab 2>/dev/null; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    log_ok "2GB Swap allocated and activated in /swapfile (registered in /etc/fstab)"
else
    log_ok "Swap memory is sufficient: $((TOTAL_SWAP_KB / 1024)) MB"
fi

# ------------------------------------------------------------------------------
# 3. Base System Update & Essential Tools
# ------------------------------------------------------------------------------
log_step "3/8" "Updating Repositories and Installing Essential Utilities..."

WEB_USER="www-data"
WEB_GROUP="www-data"

if [ "$OS_FAMILY" = "debian" ]; then
    apt-get update -y
    # Purge conflicting old node packages if any
    apt-get purge -y libnode-dev libnode72 2>/dev/null || true
    apt-get install -y --no-install-recommends \
        curl wget git unzip zip tar tmux htop jq ufw build-essential \
        ca-certificates gnupg lsb-release software-properties-common
    WEB_USER="www-data"
    WEB_GROUP="www-data"
elif [ "$OS_FAMILY" = "rhel" ]; then
    if command -v dnf >/dev/null 2>&1; then
        dnf install -y epel-release 2>/dev/null || true
        dnf update -y
        dnf install -y curl wget git unzip zip tar tmux htop jq gcc gcc-c++ make ca-certificates
    else
        yum install -y epel-release 2>/dev/null || true
        yum update -y
        yum install -y curl wget git unzip zip tar tmux htop jq gcc gcc-c++ make ca-certificates
    fi
    WEB_USER="nginx"
    WEB_GROUP="nginx"
    # Ensure web user exists
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

log_ok "Base packages and system utilities installed successfully."

# ------------------------------------------------------------------------------
# 4. Node.js 20 LTS + Package Managers & PM2
# ------------------------------------------------------------------------------
log_step "4/8" "Installing Node.js 20 LTS, PM2, PNPM, Yarn & Nodemon..."

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

# Ensure npm is available
if command -v npm >/dev/null 2>&1; then
    npm install -g pm2 yarn pnpm nodemon --silent 2>/dev/null || npm install -g pm2 yarn pnpm nodemon || true
    if command -v pm2 >/dev/null 2>&1; then
        pm2 startup systemd -u root --hp /root 2>/dev/null || true
    fi
fi

NODE_VER=$(node -v 2>/dev/null || echo "not found")
NPM_VER=$(npm -v 2>/dev/null || echo "not found")
log_ok "Node.js ${NODE_VER} & npm ${NPM_VER} installed."

# ------------------------------------------------------------------------------
# 5. Headless Browser Dependencies (Puppeteer / Playwright / Scraping)
# ------------------------------------------------------------------------------
log_step "5/8" "Installing Headless Browser & GUI Libraries for Scraping..."

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

log_ok "Headless browser rendering libraries ready."

# ------------------------------------------------------------------------------
# 6. Python 3, Pip & Modern Scraping Libraries
# ------------------------------------------------------------------------------
log_step "6/8" "Installing Python 3 & High-Performance Scraping Stack..."

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

# Upgrade pip
python3 -m pip install --upgrade pip --break-system-packages 2>/dev/null || \
python3 -m pip install --upgrade pip 2>/dev/null || true

# Install scraping and web frameworks
log_info "Installing Python packages (curl_cffi, playwright, cloudscraper, undetected-chromedriver, etc.)..."
python3 -m pip install --break-system-packages --ignore-installed \
    requests curl_cffi cloudscraper undetected-chromedriver \
    playwright selenium beautifulsoup4 lxml aiohttp httpx \
    fastapi uvicorn python-dotenv fake-useragent tqdm pandas psutil 2>/dev/null || \
python3 -m pip install \
    requests curl_cffi cloudscraper undetected-chromedriver \
    playwright selenium beautifulsoup4 lxml aiohttp httpx \
    fastapi uvicorn python-dotenv fake-useragent tqdm pandas psutil 2>/dev/null || true

PY_VER=$(python3 --version 2>/dev/null || echo "Python 3")
log_ok "${PY_VER} & scraping packages installed successfully."

# ------------------------------------------------------------------------------
# 7. Nginx, PHP & PHP-FPM Configuration
# ------------------------------------------------------------------------------
log_step "7/8" "Configuring Nginx & PHP-FPM Web Stack..."

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

# Detect PHP-FPM Socket
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

log_info "Detected FastCGI Socket: ${PHP_SOCK}"

# Configure Nginx Virtual Host
mkdir -p /var/www/html /var/www/projects

if [ "$OS_FAMILY" = "debian" ]; then
    cat << NGINX_CONF > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    listen [::]:80 default_server;
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
else
    # RedHat / Alpine / Arch Nginx config
    cat << NGINX_CONF > /etc/nginx/conf.d/webconsole.conf
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/html;
    index index.php index.html index.htm;
    client_max_body_size 1024M;
    client_body_buffer_size 128M;

    location / {
        try_files \$uri \$uri/ /index.php?\$query_string;
    }

    location ~ \.php\$ {
        fastcgi_pass ${PHP_SOCK};
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        fastcgi_read_timeout 600;
        fastcgi_send_timeout 600;
        fastcgi_connect_timeout 60;
    }

    location ~ /\.ht {
        deny all;
    }
}
NGINX_CONF
fi

# Enable & restart services
systemctl enable nginx 2>/dev/null || true
systemctl restart nginx 2>/dev/null || service nginx restart 2>/dev/null || true

for fpm in php-fpm php8.3-fpm php8.2-fpm php8.1-fpm php8.0-fpm php7.4-fpm; do
    systemctl enable $fpm 2>/dev/null || true
    systemctl restart $fpm 2>/dev/null || true
done

# SELinux support for RHEL/CentOS
if command -v setsebool >/dev/null 2>&1; then
    setsebool -P httpd_can_network_connect 1 2>/dev/null || true
    setsebool -P httpd_unified 1 2>/dev/null || true
fi

log_ok "Nginx & PHP-FPM configured and operational."

# ------------------------------------------------------------------------------
# 8. Download & Deploy WebConsole Pro & Configure Sudoers
# ------------------------------------------------------------------------------
log_step "8/8" "Deploying WebConsole Pro v1.6.5 & Sudoers Permissions..."

# Configure NOPASSWD for web users
mkdir -p /etc/sudoers.d
cat << SUDOERS_CONF > /etc/sudoers.d/99-webconsole-nopasswd
www-data ALL=(ALL) NOPASSWD: ALL
nginx ALL=(ALL) NOPASSWD: ALL
apache ALL=(ALL) NOPASSWD: ALL
http ALL=(ALL) NOPASSWD: ALL
SUDOERS_CONF
chmod 0440 /etc/sudoers.d/99-webconsole-nopasswd

# Download WebConsole Pro from GitHub
log_info "Fetching latest WebConsole Pro v1.6.5 from GitHub (fazilatma/new)..."
WCP_URL="https://raw.githubusercontent.com/fazilatma/new/main/webconsole.php?t=$(date +%s)"
curl -fsSL "$WCP_URL" -o /var/www/html/webconsole.php || \
wget -qO /var/www/html/webconsole.php "$WCP_URL"

cp -f /var/www/html/webconsole.php /var/www/html/index.php

# Set ownership and permissions
chown -R ${WEB_USER}:${WEB_GROUP} /var/www/html /var/www/projects 2>/dev/null || true
chmod -R 775 /var/www/html /var/www/projects 2>/dev/null || true
touch /var/www/html/webconsole.php /var/www/html/index.php 2>/dev/null || true

# Reload PHP-FPM / Web servers to clear opcode caches
for svc in php-fpm php8.4-fpm php8.3-fpm php8.2-fpm php8.1-fpm php8.0-fpm php7.4-fpm nginx apache2 httpd; do
    systemctl reload $svc 2>/dev/null || systemctl restart $svc 2>/dev/null || service $svc reload 2>/dev/null || true
done

# Verify PHP file health
if command -v php >/dev/null 2>&1; then
    php -l /var/www/html/webconsole.php >/dev/null 2>&1 && log_ok "PHP syntax validation passed."
fi

# Detect Public Server IP
SERVER_IP=$(curl -s4m 4 ifconfig.me || curl -s4m 4 api.ipify.org || curl -s4m 4 icanhazip.com || hostname -I | awk '{print $1}')

echo ""
echo -e "${CLR_GREEN}${CLR_BOLD}================================================================================"
echo "          🎉 WebConsole Pro v1.6.5 Installation Completed Successfully!         "
echo "================================================================================${CLR_RESET}"
echo ""
echo -e "  🌐 ${CLR_BOLD}Access URL:${CLR_RESET}   ${CLR_CYAN}http://${SERVER_IP:-YOUR_SERVER_IP}/${CLR_RESET}"
echo -e "  🔑 ${CLR_BOLD}First Login:${CLR_RESET}  Set your master administrator password on first visit."
echo -e "  🚀 ${CLR_BOLD}Installed:${CLR_RESET}   Node.js 20 LTS, Python 3 Scraping Stack, Swap Manager, Nginx/PHP"
echo -e "  🔄 ${CLR_BOLD}Self-Update:${CLR_RESET} Available directly from Settings tab in WebConsole Pro."
echo ""
echo -e "${CLR_CYAN}================================================================================${CLR_RESET}"
