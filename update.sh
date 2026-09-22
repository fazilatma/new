#!/usr/bin/env bash
set -e

echo -e "\n\e[34m🔄 Updating WebConsole Pro & repairing web server configuration...\e[0m"

# Ensure Apache2 and PHP-FPM modules are properly configured
a2enmod proxy proxy_fcgi setenvif rewrite headers dir 2>/dev/null || true
a2enconf php*-fpm 2>/dev/null || true

# Find active PHP-FPM socket
PHP_SOCK=$(ls -t /run/php/php*-fpm.sock 2>/dev/null | head -n 1 || echo "")
if [ -n "$PHP_SOCK" ]; then
    cat << EOF > /etc/apache2/conf-available/php-fpm-bridge.conf
<FilesMatch "\.php$">
    SetHandler "proxy:unix:${PHP_SOCK}|fcgi://localhost"
</FilesMatch>
<IfModule mod_dir.c>
    DirectoryIndex index.php index.html
</IfModule>
EOF
    a2enconf php-fpm-bridge 2>/dev/null || true
fi

systemctl restart php*-fpm 2>/dev/null || true
systemctl restart apache2 2>/dev/null || true

# Download latest WebConsole Pro
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/main/webconsole.php -o /var/www/html/webconsole.php
cp /var/www/html/webconsole.php /var/www/html/index.php
rm -f /var/www/html/index.html /var/www/html/index.nginx-debian.html 2>/dev/null || true
chown -R www-data:www-data /var/www/html
chmod -R 775 /var/www/html

# Robust Public IP detection with multiple fallbacks
get_public_ip() {
    local ip=""
    for provider in "https://api.ipify.org" "https://icanhazip.com" "https://ifconfig.io" "https://checkip.amazonaws.com" "https://ip.sb"; do
        ip=$(curl -s -4 --connect-timeout 2 "$provider" 2>/dev/null | tr -d '[:space:]' || echo "")
        if echo "$ip" | grep -Eq '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
            echo "$ip"
            return 0
        fi
    done
    hostname -I 2>/dev/null | awk '{print $1}' | tr -d '[:space:]'
}

SERVER_IP=$(get_public_ip)
if [ -z "$SERVER_IP" ]; then
    SERVER_IP="YOUR_SERVER_IP"
fi

echo -e "\n\e[32m===================================================================\e[0m"
echo -e "\e[32m🎉 WebConsole Pro updated and server bridge repaired successfully!\e[0m"
echo -e "\e[32m===================================================================\e[0m"
echo -e "👉 Open WebConsole in your browser:"
echo -e "   \e[1;36mhttp://${SERVER_IP}/\e[0m"
echo -e "   \e[1;36mhttp://${SERVER_IP}/webconsole.php\e[0m"
echo -e "\e[32m===================================================================\e[0m\n"
