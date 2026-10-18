# چیدمانِ تولیدیِ مقاوم‌دربرابر سقوط (Multi-Process Crash-Resiliency)

درخواست کاربر: «سرور PHP را **چندپروسه یا چندنخی** اجرا کن و kill شدن و کرشِ
پروسه‌ها به **حداقل** برسد.» سه چیدمان پوشش داده می‌شود؛ از ساده به قوی:

## گزینهٔ ۱ — سرور داخلیِ PHP + سوپروایزر (ساده‌ترین، بدون نصبِ اضافی)

```bash
./server.sh start     # پس‌زمینه با PID/لاگ
```

لایه‌های تاب‌آوری در این حالت:

| لایه | چه چیزی را می‌گیرد | طرف |
|------|---------------------|-----|
| `PHP_CLI_SERVER_WORKERS` (پیش‌فرض ۴) | چندکارگرِ واقعی؛ درخواست‌ها موازی‌اند و قفلِ SSE بقیه را نمی‌بندد | خودِ PHP ≥ 7.4 |
| حلقهٔ نگهبانِ `server.sh` | سقوطِ کاملِ پردازه (خطای مرگبار/OOM/سیگنال) → باز‌راه‌اندازیِ نامحدود با مکثِ تصاعدی ۱→۳۰ ثانیه | `server.sh` |
| **نگهبانِ سلامت** (`SCRAPER_HEALTH_SEC`/`_FAILS`) | پردازه «زنده ولی هنک‌کرده» → بعد از چند شکستِ HTTP متوالی کشته و تازه می‌شود | `server.sh` (این نسخه) |
| `max_execution_time=0` و `ignore_user_abort=1` | خودِ PHP پردازه را برای طولانی‌بودن نمی‌کشد | تنظیماتِ درون `server.sh` |
| تیکِ کرانِ داخلی (`SCRAPER_CRON_TICK`) | کارهای پس‌زمینه بدون کران‌جابِ سیستمی | `server.sh` |
| یونیتِ systemd (نمونه: `scraper4-server.service`) + `Restart=always` | ری‌بوتِ سیستم‌عامل / OOM-killer لینوکسیِ خودِ سوپروایزر | OS |

وقتی سرور پشت یک پروکسی باشد، `SCRAPER_HOST=127.0.0.1` بگذارید.

## گزینهٔ ۲ — PHP-FPM + Nginx (تولیدیِ کلاسیک، پیشنهادی برای بار واقعی)

دو فایل آماده در همین پوشه:

- **`php-fpm-pool.conf`** — استخرِ مستقلِ `scraper4` (dynamic، بازسازیِ هر کارگر
  بعد از ۵۰۰ درخواست = بیمهٔ نشتِ حافظه، `request_terminate_timeout=0` برای SSE).
- **`nginx-scraper4.conf`** — سرور مجازی با `fastcgi_buffering off` و
  `fastcgi_read_timeout 3600s` برای استریمِ SSE.

مراحل:

```bash
sudo cp deploy/php-fpm-pool.conf   /etc/php/8.2/fpm/pool.d/scraper4.conf
sudo cp deploy/nginx-scraper4.conf /etc/nginx/conf.d/scraper4.conf
# مسیرها/دامنه/نسخهٔ PHP را هماهنگ کنید، سپس:
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl restart php8.2-fpm
```

خدمت systemd مربوط به FPM معمولاً از قبل `Restart=always` دارد؛ برای اطمینان:

```ini
# /etc/systemd/system/php8.2-fpm.service.d/restart.conf
[Service]
Restart=always
RestartSec=2
```

## گزینهٔ ۳ — نسخهٔ لاراول: PHP-FPM یا Octane

برای درختِ `laravel/` همان گزینهٔ ۲ کافی است (root را روی `laravel/public` و
روتر را `index.php` بگذارید). اگر TPS بالا لازم شد، Laravel Octane کارگرهای
بلندعمر (`--workers=4 --max-requests=500`) می‌سازد که بازسازیِ دوره‌ای در
همان‌ها، بیمهٔ نشتِ حافظه است.

## سرویس رندرِ جاوااسکریپت (browser/)

در هر سه گزینه، سرویسِ `browser/server.js` (Playwright ← Selenium) را جداگانه
بالا نگه دارید:

```bash
cd browser && ./browser.sh start        # سوپروایزر + سلامت‌سنج + backoff
# یا: docker compose up -d render
```

و در `connections.json` کلید `render` را فعال کنید (فقط برای صفحه‌فهرست‌ها و
حالتِ auto استفاده می‌شود تا رندرِ اضافی نشود).

## جدولِ انتخاب

| سناریو | پیشنهاد |
|--------|---------|
| یک VPS کوچک، یک مدیر، نصبِ حداقلی | گزینهٔ ۱ |
| ترافیکِ واقعی/چندکاربره، شدت‌گرفتنِ SSE | گزینهٔ ۲ |
| مهاجرتِ مرحله‌ای به معماری تمیزتر | گزینهٔ ۲ + `laravel/` (Strangler، فاز ۲+) |

نکتهٔ پایانی: هیچ لایه‌ای جای پایش لاگ را نمی‌گیرد — `server.sh status`،
لاگِ `browser.sh logs` و خودآزمانیِ `scraper4.php?selftest=1` را در چرخهٔ
نگهداری دوره‌ای بگنجانید.
