# WebConsole Pro & VPS Server Auto-Installer

Automated setup script for Linux servers (Ubuntu/Debian) configuring **Apache2**, **PHP**, **Python 3**, **Node.js 20 LTS**, **Scraper & Cloudflare Bypass libraries**, headless browser dependencies, and the **WebConsole Pro** management suite.

## 🚀 One-Line Fast Installation (Fresh Server)

Run the following command as `root` (or with `sudo`) on any fresh VPS:

```bash
curl -sSL https://raw.githubusercontent.com/fazilatma/new/main/install.sh | sudo bash
```

---

## ⚡ Quick Update (Existing Server)

To update only WebConsole Pro to the latest version in 2 seconds:

```bash
curl -sSL https://raw.githubusercontent.com/fazilatma/new/main/update.sh | sudo bash
```

---

### 📦 Installed & Preconfigured Components:
- **Apache2 Web Server + PHP:** Rock-solid native PHP execution without fragile socket configurations
- **Node.js 20.x LTS + PM2 + Yarn + PNPM** (Clean install without distro package conflicts)
- **Python 3 + Pip + Build Tools**
- **Advanced Scraping & Automation Packages:** `curl_cffi`, `cloudscraper`, `undetected-chromedriver`, `requests`, `playwright`, `selenium`, `beautifulsoup4`, `lxml`, `fastapi`, `uvicorn`, `aiohttp`
- **Headless Browser Dependencies:** Full Linux libraries for Puppeteer, Playwright & Chrome
- **NOPASSWD Sudo Privileges:** Sudo access for `www-data` for seamless task execution and service restarts
- **WebConsole Pro v1.6.0:** Deployed at `/var/www/html/webconsole.php` and `/var/www/html/index.php`
