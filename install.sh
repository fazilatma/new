#!/usr/bin/env bash
set -e
export DEBIAN_FRONTEND=noninteractive

echo -e "
\e[34m[1/6] 🔄 به‌روزرسانی مخازن و نصب ابزارهای پایه سیستم...\e[0m"
apt-get update -y
apt-get purge -y libnode-dev libnode72 2>/dev/null || true
apt-get install -y --no-install-recommends     curl wget git unzip zip tar tmux htop jq ufw build-essential     ca-certificates gnupg lsb-release software-properties-common

echo -e "
\e[34m[2/6] 🟢 نصب مخزن و بسته کامل Node.js 20 LTS + PM2...\e[0m"
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes 2>/dev/null || true
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update -y
apt-get install -y nodejs
npm install -g pm2 yarn pnpm nodemon
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo -e "
\e[34m[3/6] 🌐 نصب نیازمندی‌های مرورگرهای بدون سر (Puppeteer / Playwright / Cloudflare Bypass)...\e[0m"
apt-get install -y     libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0     libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2     libpango-1.0-0 libcairo2 libx11-xcb1 libxcb-dri3-0 libxshmfence1     fonts-liberation fonts-noto-color-emoji fonts-dejavu-core fonts-freefont-ttf

echo -e "
\e[34m[4/6] 🐍 نصب Python 3 + Pip + کامل‌ترین پکیج‌های اسکرپینگ و وب...\e[0m"
apt-get install -y python3 python3-pip python3-venv python3-dev
PIP_BREAK="--break-system-packages"
python3 -m pip install --upgrade pip $PIP_BREAK 2>/dev/null || python3 -m pip install --upgrade pip

python3 -m pip install $PIP_BREAK     requests curl_cffi cloudscraper undetected-chromedriver     playwright selenium beautifulsoup4 lxml aiohttp httpx     fastapi uvicorn python-dotenv fake-useragent tqdm pandas psutil 2>/dev/null || python3 -m pip install     requests curl_cffi cloudscraper undetected-chromedriver     playwright selenium beautifulsoup4 lxml aiohttp httpx     fastapi uvicorn python-dotenv fake-useragent tqdm pandas psutil

echo -e "
\e[34m[5/6] 🐘 نصب Nginx + PHP و ماژول‌های ضروری...\e[0m"
apt-get install -y nginx php-fpm php-cli php-curl php-json php-mbstring php-xml php-zip php-bcmath php-intl php-sqlite3
systemctl enable nginx
systemctl start nginx

echo -e "
\e[34m[6/6] 🔐 تنظیم دسترسی sudoers بدون پسورد برای وب‌کنسول (www-data)...\e[0m"
echo "www-data ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/99-webconsole-nopasswd
chmod 0440 /etc/sudoers.d/99-webconsole-nopasswd

mkdir -p /var/www/html

PHP_SOCK=$(find /run/php/ -name "php*-fpm.sock" 2>/dev/null | head -n 1 || echo "")
if [ -z "$PHP_SOCK" ]; then
    PHP_SOCK="/run/php/php-fpm.sock"
fi

cat << 'NGINX_CONF' > /etc/nginx/sites-available/default
server {
    listen 80 default_server;
    listen [::]80 default_server;
    root /var/www/html;
    index index.php index.html;
    server_name _;

    client_max_body_size 100M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:__PHP_SOCK__;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_read_timeout 300;
    }

    location ~ /\.ht {
        deny all;
    }
}
NGINX_CONF

sed -i "s|__PHP_SOCK__|$PHP_SOCK|g" /etc/nginx/sites-available/default
nginx -t && systemctl restart nginx

echo -e "
\e[34m📦 دریافت و نصب خودکار WebConsole Pro v1.5.9...\e[0m"
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/main/webconsole.php -o /var/www/html/webconsole.php
cp /var/www/html/webconsole.php /var/www/html/index.php

chown -R www-data:www-data /var/www/html
chmod -R 775 /var/www/html
usermod -a -G www-data root 2>/dev/null || true

SERVER_IP=$(curl -s -4 ifconfig.me || curl -s -4 icanhazip.com || hostname -I | awk '{print $1}')

echo -e "
\e[32m========================================================\e[0m"
echo -e "\e[32m🎉 نصب و راه‌اندازی کامل WebConsole و تمامی پیش‌نیازها انجام شد!\e[0m"
echo -e "\e[32m========================================================\e[0m"
echo -e "🔹 Node.js:       \e[33m$(node -v 2>/dev/null || echo 'نصب نشد')\e[0m (npm $(npm -v 2>/dev/null))\e[0m"
echo -e "🔹 PM2:           \e[33m$(pm2 -v 2>/dev/null || echo 'نصب نشد')\e[0m"
echo -e "🔹 Python:        \e[33m$(python3 --version 2>/dev/null)\e[0m"
echo -e "🔹 PHP:           \e[33m$(php -r 'echo PHP_VERSION;' 2>/dev/null)\e[0m"
echo -e "🔹 WebConsole:    \e[32mv1.5.9 نصب شد (/var/www/html/webconsole.php)\e[0m"
echo -e "🔹 NOPASSWD:      \e[32mفعال شد (کاربر www-data بدون پسورد روت است)\e[0m"
echo -e "🔹 آدرس وب‌کنسول:  \e[36mhttp://${SERVER_IP}/\e[0m"
echo -e "\e[32m========================================================\e[0m
"
