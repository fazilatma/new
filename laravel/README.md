# scraper4 — نسخهٔ لاراول (مهاجرت فاز‌به‌فاز)

این پوشه بازنویسیِ اپلیکیشن تک‌فایلی `scraper4.php` (~۸۲هزار خط) روی **Laravel 12 / PHP 8.2+**
است. چون بازنویسیِ یک‌جای آن حجم منطقِ در‌حال‌استفاده امن و واقع‌بینانه نیست، مهاجرت با الگوی
**Strangler Fig** انجام می‌شود:

```
                  ┌──────────────────────┐        ┌─────────────────────┐
  کاربر ────────► │  لاراول (پورت 8001)  │ ─────► │ اپ قدیمی (پورت 8000)│
                  │  مسیرهای جدید اینجا  │ پروکسی │  بقیهٔ مسیرها اینجا  │
                  └──────────────────────┘        └─────────────────────┘
```

- اپ قدیمی **دست‌نخورده می‌ماند** و با همان `server.sh` همیشه‌زنده است.
- هر قابلیتی که اینجا «کامل» علامت خورده، از لاراول سرو می‌شود؛ بقیه به قدیمی می‌رود.
- وضعیت (پروفایل‌ها/محصولات/اتصالات) با یک فرمان از JSONهای قدیمی وارد دیتابیس می‌شود:
  ```bash
  php artisan scraper:import-legacy --dir=..
  ```
- کران: `php artisan scraper:tick` فعلاً چرخهٔ اثبات‌شدهٔ قدیمی (`cron_run`) را صدا می‌زند تا
  فازها یکی‌یکی جاب‌های لاراولی شوند.

---

## ✅ چه چیزی پورت شده (فاز ۱ — هستهٔ اسکرپر، تست‌دار)

| تابع/بخشِ قدیمی | مقصدِ لاراولی | وضعیت |
|---|---|---|
| `build_page_url_custom` (v10.172، قالب‌های `~page~{page}`) | `App\Services\Scraping\PaginationUrlBuilder` | ✅ کامل + ۱۳ تست |
| `cssToXpath` / `cssStepToXpath` / `xpClassCond` / `xpLit` | `App\Services\Scraping\CssToXpath` | ✅ کامل + ۱۹ تست |
| `persianToEnglish` / `normalize_text[_html]` / `extractPrice[Num]` | `App\Services\Support\Persian` | ✅ کامل + تست |
| `make_absolute_url` / `url_is_image` / `profileKey` | `App\Services\Support\Url` | ✅ کامل + تست |
| `productKey` | `App\Services\Scraping\ProductKey` | ✅ کامل + تست |
| `load_dom` / `queryInside` (v9.86، v9.87) / `parse_with_selectors` / بازشناسیِ ظرفِ یکتا / fallbackهای JSON-LD | `App\Services\Scraping\ProductParser::withSelectors` | ✅ کامل |
| `extractSmartLink` / `extractImageFromHtml` (og:image + امتیازدهی) | `ProductParser::extractSmartLink` / `::imageFromPage` | ✅ کامل |
| `fetch_html` + srcNet (pace، proxy/dns/doh/worker، توقف روی خطای منطقی) | `App\Services\Scraping\HtmlFetcher` | ✅ کامل |
| `wooReq` + CRUD محصول + batch + تست اتصال | `App\Services\WooCommerce\WooClient` | ✅ کامل |
| `bslReq`/`bslReqRead`/`bslCurlOpts` + محصولات/جست‌وجو/فایل/چت/دسته‌ها | `App\Services\Basalam\BasalamClient` | ✅ کامل |
| `?stream=1` (اسکریپِ زندهٔ SSE با همهٔ رویدادها) | `GET /api/scrape/stream` | ✅ کامل |
| — | `GET /api/pagination/preview` (پیش‌نمایشِ تازهٔ صفحه‌بندی) | ✅ جدید |
| `profiles.json` / `connections.json` | مدل‌های `Profile` `Product` `Connection` + `scraper:import-legacy` | ✅ کامل |
| کرانِ آپ (`php scraper4.php cron_run`) | `php artisan scraper:tick` + `routes/console.php` (هر دقیقه) | ✅ پل |

**قراردادِ وفاداری:** هر کلاسی که «پورت» است باید روی همان ورودی دقیقاً خروجیِ تابعِ قدیمی را
بدهد؛ تست‌های `tests/Unit` همین قرارداد را قفل می‌کنند. اصلاحِ v10.172
(قالب‌های `~page~{page}`) عیناً در هر دو پیاده‌سازی هست.

## 🧭 رندرِ جاوااسکریپت (سایت‌های «جاوی» / SPA)

برای سایت‌هایی که HTML ایستا نمی‌دهند (React/Vue/Next/Nuxt) سرویسِ رندرِ مستقلِ
`browser/` (Node — **Playwright** به‌عنوان موتور اصلی و **Selenium** به‌عنوان
جایگزین خودکار است) با Web APIِ داخلی کار می‌کند:

- `RenderedFetcher` — کلاینتِ /render (قرارداد مشابهِ `HtmlFetcher`، قابل fake با
  `Http::fake`؛ توکن Bearer برای ایمن‌سازی لوکال).
- `SmartFetcher` — لایهٔ تصمیم. حالت‌ها:
  - `static` — مثل فاز ۱ فقط واکشِ معمولی (پیش‌فرضِ امروز)،
  - `auto` — ایستا اول؛ فقط اگر heuristic «پوستهٔ JS» مثبت داد (ظرفِ خالیِ
    `__next`/`root` + متنِ نزدیک‌صفر، نشانهٔ Next/Nuxt/Angular، پیامِ «جاوااسکریپت
    را فعال کنید») یک بار رندر می‌کند؛
  - `js` — رندرِ همیشگی.
- فعال‌سازی در درخواست: استریم `/api/scrape/stream?...&render=auto`
- فعال‌سازیِ پایدار از `.env`: `SCRAPER_RENDER_URL` / `SCRAPER_RENDER_TOKEN` /
  `SCRAPER_RENDER_MODE` (نمونه‌ها در `.env.example`).
- تست‌ها: `tests/Unit/SmartFetcherTest.php` (۶ کیس heuristic + ۵ کیس حالت‌ها) و
  `tests/Unit/RenderedFetcherTest.php` (قراردادِ سرویس، بدون شبکهٔ واقعی).

## 🚧 فازهای بعدی (نقشهٔ راه)

| فاز | بخش در نسخهٔ قدیمی | برنامهٔ لاراولی |
|---|---|---|
| ۲ | `parse_products` (تشخیص خودکارِ ظرفِ تکرارشونده، آنالیز آماریِ DOM) | `ProductParser::auto` را کامل کند؛ فعلاً JSON-LD + microdata |
| ۲ | استخراجِ جزئیات صفحهٔ محصول (detail fields، گالری، تنوع‌ها) | `Jobs\ExtractProductDetails` + TaskCheckpoint |
| ۲ | مدیر وظیفه (resume/watchdog/چک‌پوینت `_progress.json`) | Laravel Queue + `queue_entries`/`task_checkpoints` + نگهبانِ زمان‌بند |
| ۳ | صف‌های ارسال باسلام/ووکامرس (bsl_queue/woo_queue، fan-out، محافظِ حذفِ انبوه) | `Jobs\SendToBasalam` / `Jobs\SendToWooCommerce` • مسیرهای `PATCH` و تطبیق‌گر «در مقصد نیست» |
| ۳ | حذفِ هوشمندِ تکراری‌ها (dedup با گروه‌بندی) | `Services\Dedup` |
| ۳ | چت‌های باسلام/پشتیبانی + فوروارد رسانه | `Events` + `Services\Chat` |
| ۴ | اتصالات AI (ارائه‌دهنده‌ها، تست مدل‌ها، تولید توضیح/دسته‌بندی) | `Services\AI\*` با config چندحسابه |
| ۴ | اعلان‌ها (تلگرام/بله/روبیکا + نبض) | Laravel Notifications |
| ۴ | ویترین (SPA موجود) و صفحهٔ محصول | Vue/React جدا + API |
| ۵ | بررسی نسخه/دپلوی/بکاپ گیت‌هابی + خودآزمایی (`?selftest=1`) | پکیج آپدیتر + suite کامل |

## 🚀 راه‌اندازی

```bash
cd laravel
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate
php artisan test                       # ۴۵+ تستِ قراردادی
php artisan scraper:import-legacy --dir=..

# اجرا — با همان سوپروایزرِ همیشه‌زندهٔ پروژه (دو حالت run/start):
cd ..
SCRAPER_DOCROOT=laravel/public SCRAPER_ROUTER=laravel/public/index.php \
SCRAPER_PORT=8001 SCRAPER_CRON_TICK=0 ./server.sh start

# یا ساده (توسعه):
php artisan serve --host=0.0.0.0 --port=8001
```

زمان‌بند: یا `schedule:run` را در کران‌جاب بگذارید، یا تحتِ سوپروایزر: `php artisan schedule:work`.

## 🧭 اجرای دو نسل کنار هم (توصیه)

```bash
# قدیمی روی 8000 (مثل قبل):
./server.sh start
# لاراول روی 8001:
SCRAPER_DOCROOT=laravel/public SCRAPER_ROUTER=laravel/public/index.php \
SCRAPER_PORT=8001 SCRAPER_RUN_DIR_SUFFIX=-laravel SCRAPER_CRON_TICK=0 ./server.sh start
```

پشت Nginx:
```nginx
location /api/ { proxy_pass http://127.0.0.1:8001; }   # برش‌های مهاجرت‌کرده
location /     { proxy_pass http://127.0.0.1:8000; }   # بقیه → قدیمی
```

## 🗂 ساختار

```
app/
  Services/
    Support/      Persian (متن/قیمت/ارقام)، Url (مطلق‌سازی/کلید)
    Scraping/     PaginationUrlBuilder · CssToXpath · HtmlFetcher · ProductParser · ProductKey
    Basalam/      BasalamClient
    WooCommerce/  WooClient
  Http/Controllers/  Dashboard · Api/ScrapeStream · Api/PaginationPreview
  Console/Commands/  scraper:tick · scraper:import-legacy
  Models/            Profile · Product · Connection · QueueEntry · TaskCheckpoint
database/migrations/ جایگزینِ تمیزِ فایل‌های JSON (profiles/products/connections/queues/checkpoints)
tests/                قراردادهای وفاداری (Unit) + دودِ API (Feature)
```

## نکات امنیتی
- `connections` با cast رمزنگاری‌شده (`encrypted:array`) ذخیره می‌شود — کلیدها مثل
  `connections.json` روی دیسک شفاف نیستند؛ پس `APP_KEY` را پشت‌دارید.
- API فعلاً بدون auth است (مثل فایلِ قدیمی) — پشت پروکسی/f‌ایروال بگذارید؛ auth پنل در فاز ۴ می‌آید.
