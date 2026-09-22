# WebConsole Pro & VPS Server Auto-Installer

Automated setup script for Linux servers (Ubuntu/Debian) configuring **Apache2**, **PHP-FPM**, **Python 3**, **Node.js 20 LTS**, **Scraper & Cloudflare Bypass libraries**, headless browser dependencies, and the **WebConsole Pro** management suite.

## 🚀 One-Line Installation (Supports Full & Minimal Modes)

Run the following command as `root` (or with `sudo`):

```bash
curl -sSL https://raw.githubusercontent.com/fazilatma/new/main/install.sh | sudo bash
```

### 🎯 Installation Modes:
- **[1] Full Setup:** Installs Apache2 + PHP-FPM + WebConsole + Node 20 LTS + PM2 + Python 3 Scraper libraries + Headless browser drivers.
- **[2] Minimal Setup (~10s):** Installs Apache2 + PHP-FPM + WebConsole Pro immediately; all other runtimes (Node 20, Python, Scrapers) can be installed inside the WebConsole UI with 1 click.

---

## ⚡ Quick Update (Existing Server)

To update WebConsole Pro to the latest version in 2 seconds:

```bash
curl -sSL https://raw.githubusercontent.com/fazilatma/new/main/update.sh | sudo bash
```
