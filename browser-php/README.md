# سرویس رندرِ خالص‌PHP برای scraper4 (بدون Node/Python/Java)

این پوشه جایگزینِ کاملِ سرویس `browser/` (نیازمند Node) است برای هاست‌هایی که
فقط PHP دارند. API آن **بایت‌به‌بایت سازگار** است، پس خودِ scraper4
(تنظیمات 🧩 رندر جاوااسکریپت، fetch_html_render، ‎/render_probe) بدون هیچ
تغییری با آن کار می‌کند.

## دو موتور

| موتور | فناوری | معادل |
|---|---|---|
| **CDP** (پیش‌فرض) | کرومیوم + `--remote-debugging-port=0` + کلاینت WebSocket/CDP دستیِ PHP (`cdp.php`) | Playwright |
| **WebDriver** (جایگزین) | باینریِ بومیِ `chromedriver` + پروتکل W3C روی HTTP خالص (curl) | Selenium |

هر دو «بدون زبان میانی» هستند: نه Node، نه Python، نه حتی Java.

## اجرا

```bash
cd browser-php
bash bootstrap.sh          # باینری‌های chrome + chromedriver را می‌آورد (curl+unzip)
RENDER_TOKEN=یک-راز-طولانی bash start.sh   # گوش‌دادن روی 127.0.0.1:3100
curl http://127.0.0.1:3100/health
```

در کنسول‌ها (WebConsole/HostConsole) از JSON آمادهٔ
`console/project-render-php.json` استفاده کنید — همان‌ها را با یک کلیک نصب و
اجرا می‌کند.

## API

- `POST /render` (Bearer: RENDER_TOKEN)
  `{url, waitUntil: load|domcontentloaded|networkidle, selector, timeout, scroll, blockResources}`
  → `{ok, code, url, title, html, driver, took_ms}`
- `GET /health` → `{ok, driver, available: {cdp, selenium}, active, max_concurrency, uptime_s}`

## چند همزمانیِ واقعی

`start.sh` مقدار `PHP_CLI_SERVER_WORKERS` را برابر `RENDER_MAX_CONCURRENCY`
(پیش‌فرض ۳) می‌گذارد؛ سرورِ داخلیِ PHP واقعاً چند پردازه می‌سازد و سمافورِ
`flock` جلوی بیشتر از N رندرِ همزمان را می‌گیرد (سرشاری ← `503` + `Retry-After`).

## امنیت

پیش‌فرض loopback است (`127.0.0.1`) — این سرویس قرار نیست روی اینترنت دیده شود.
توکنِ Bearer هم برای جلوگیری از همان دسترسی محلیِ نامعلوم است.
