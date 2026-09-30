# سرویس رندرِ JS — Playwright (و پشتیبانِ Selenium)

اسکرپر فقط HTML ایستا می‌فهمد؛ این سرویسِ کناری صفحه را با مرورگر واقعی رندر و
HTML نهایی را برمی‌گرداند تا **سایت‌های جاوااسکریپتی (SPA)** هم اسکرپ شوند.

```
اسکرپر (PHP) ──POST /render──►  این سرویس (Node) ──► Chromium headless
        ◄─────────────── {ok, url, html, title} ────────────────
```

## راه‌اندازی

```bash
cd browser
npm ci
npx playwright install --with-deps chromium   # فقط بار اول (روی اوبونتو/دبیان)
cp env.sample .env 2>/dev/null || true        # اختیاری — متغیرها را env هم می‌شود داد

export RENDER_TOKEN=یک-راز-طولانی
./browser.sh start        # دیمون همیشه‌زنده (حالت دوم) | ./browser.sh run (پیش‌زمینه)
./browser.sh status       # باید health بدهد: {"ok":true,"driver":"playwright",...}
```

تستِ سریع:
```bash
curl -s -X POST http://127.0.0.1:3100/render \
  -H "Authorization: Bearer یک-راز-طولانی" -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","waitUntil":"domcontentloaded"}' | head -c 300
```

بدون Node هم می‌شود — با داکر:
```bash
docker compose up -d render                    # Playwright
docker compose --profile selenium up -d        # پشتیبان: Selenium standalone
```

## اتصال به اسکرپر

| کجا | چی ست شود |
|---|---|
| اپ قدیمی (`scraper4.php`) | کلیدِ `render` در `connections.json`: `{"enabled":true,"url":"http://127.0.0.1:3100","token":"...","mode":"auto","scroll":true}` — از v10.173 به بعد، واکشیِ فهرست‌ا در حالت auto اگر صفحه «پوستهٔ JS» باشد خودش رندر می‌کند |
| نسخهٔ لاراول | در `.env`: `SCRAPER_RENDER_URL=http://127.0.0.1:3100` و `SCRAPER_RENDER_TOKEN=...` و در پارامترِ `render=auto|static|js` اندپوینتِ `/api/scrape/stream` |

## چرا این طور طراحی شده؟ (پایداری)

- **حداقل کرش:** هر رندر در Context جدا و در `finally` بسته می‌شود — صفحه‌ی یتیم جمع‌آوری می‌شود؛ قطع‌شدنِ مرورگر با relaunch خودکار جبران می‌شود (`browser.on('disconnected')` رویدادی، نه کشف تصادفی).
- **حداقل kill:** حافظهٔ کرومیوم محدود به تعداد تب‌های هم‌زمان است (`RENDER_MAX_CONCURRENCY`) نه به تعداد درخواست‌ها؛ پس OOM رخ نمی‌دهد. سوپروایزرِ `browser.sh` همچنان بازراه‌اندازیِ نامحدود دارد و **چک سلامتِ HTTP** دارد: اگر سرویس هنگ کند (زنده ولی بی‌پاسخ به `/health`)، پس از `HEALTH_FAILS` بار پیاپی خودش kill و فوری برمی‌گردد.
- **سرعت:** `blockResources` (عکس/فونت/مدیا) و `RENDER_BLOCK_HOSTS` (ردیاب‌ها) رندر را ۲-۳ برابر سبک می‌کنند؛ optionهای `selector` و `scroll` برای لِیزیلود.
- **توکن** اجباری‌کردنی: سرویس را بدون راز روی پورت عمومی نگذارید.

## پشتیبان Selenium

اگر نصبِ Playwright روی میزبان ممکن نشد (محرمانه/قدیمی)، همان API با درایور Seleniumِ W3C سرو می‌شود — فقط یک WebDriver endpoint لازم است:

```bash
docker run -d --shm-size=1g -p 4444:4444 selenium/standalone-chromium
RENDER_DRIVER=selenium SELENIUM_URL=http://127.0.0.1:4444 ./browser.sh start
```

قراردادِ پاسخ هر دو درایور یکی است؛ PHP فرقی نمی‌فهمد.
