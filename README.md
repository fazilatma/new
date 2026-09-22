# WebConsole Pro & VPS Server Auto-Installer

Automated setup script for Linux servers (Ubuntu/Debian) configuring **Nginx**, **PHP-FPM**, **Python 3**, **Node.js 20 LTS**, **Scraper & Cloudflare Bypass libraries**, headless browser dependencies, and the **WebConsole Pro** management suite.

## 🚀 One-Line Fast Installation

Run the following command as `root` (or with `sudo`) on any fresh VPS:

```bash
curl -sSL https://raw.githubusercontent.com/fazilatma/new/main/install.sh | sudo bash
```

---

### 📦 Installed & Preconfigured Components:
- **Node.js 20.x LTS + PM2 + Yarn + PNPM** (Clean install without distro package conflicts)
- **Python 3 + Pip + Build Tools**
- **Advanced Scraping & Automation Packages:** `curl_cffi`, `cloudscraper`, `undetected-chromedriver`, `requests`, `playwright`, `selenium`, `beautifulsoup4`, `lxml`, `fastapi`, `uvicorn`, `aiohttp`
- **Headless Browser Dependencies:** Full Linux libraries for Puppeteer, Playwright & Chrome
- **Nginx Web Server + PHP-FPM:** Configured on port 80 with high timeout (300s) and 100MB upload size
- **NOPASSWD Sudo Privileges:** Sudo access for `www-data` for seamless task execution and service restarts
- **WebConsole Pro v1.5.9:** Deployed at `/var/www/html/webconsole.php` and `/var/www/html/index.php`
