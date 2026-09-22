# WebConsole Pro & Server Auto-Installer

اسکریپت نصب و راه‌اندازی خودکار سرور لینوکس (اوبونتو / دبیان) به همراه وب‌سرور Nginx، پی‌اچ‌پی، پایتون ۳، نود ۲۰، ابزارهای اسکرپینگ، بای‌پس کلودفلر و پنل مدیریت سرور **WebConsole Pro**.

## 🚀 دستور نصب سریع (تک‌خطی)

کافی است با دسترسی `root` دستور زیر را در ترمینال سرور اجرا کنید:

```bash
curl -sSL https://raw.githubusercontent.com/fazilatma/new/main/install.sh | sudo bash
```

---

### 📦 امکانات و پکیج‌های نصب‌شده خودکار:
- **Node.js 20.x LTS + PM2 + Yarn + PNPM** (بدون تداخل پکیج‌های قدیمی اوبونتو)
- **Python 3 + Pip + Dev tools**
- **پکیج‌های اسکرپینگ پیشرفته پایتون:** `curl_cffi`, `cloudscraper`, `undetected-chromedriver`, `requests`, `playwright`, `selenium`, `beautifulsoup4`, `lxml`, `fastapi`, `uvicorn`, `aiohttp`
- **پیش‌نیازهای مرورگرهای بدون سر (Headless Browsers):** کتابخانه‌های سیستمی کامل برای اجرای بدون خطای Puppeteer و Playwright
- **Nginx + PHP-FPM + ماژول‌های PHP:** پیکربندی کامل وب‌سرور روی پورت 80
- **دسترسی NOPASSWD:** دسترسی روت بدون پسورد برای کاربر `www-data` جهت اجرای دستورات سیستمی، ری‌استارت سرویس‌ها و دیپلوی پروژه‌ها
- **WebConsole Pro v1.5.9:** نصب مستقیم در `/var/www/html/webconsole.php` و `/var/www/html/index.php`
