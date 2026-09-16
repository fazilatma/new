# Scraper 4 on Render

این نسخه از صفر برای زیرساخت Render طراحی شده و به APIهای Cloudflare وابسته نیست.

## پشته انتخاب‌شده

- Node.js 20 + TypeScript
- Hono برای Web/API
- Cheerio برای استخراج HTML و CSS selector
- PostgreSQL برای پروفایل‌ها، محصولات، صف و گزارش‌ها
- صف تراکنشی PostgreSQL با `FOR UPDATE SKIP LOCKED`
- Worker داخلی در همان Web Service برای راه‌اندازی ساده

## خطای `DATABASE_URL is required`

اگر Web Service را قبلاً به GitHub متصل کرده‌اید، Render فایل `render.yaml` را به‌عنوان Blueprint اجرا نمی‌کند؛ بنابراین PostgreSQL خودکار ساخته نمی‌شود. این مراحل را یک‌بار انجام دهید:

1. در داشبورد Render گزینه **New → PostgreSQL** را بزنید.
2. بعد از آماده‌شدن دیتابیس، **Internal Database URL** را کپی کنید.
3. وارد Web Service اسکریپر شوید و در **Environment** این متغیر را اضافه کنید:
   ```text
   DATABASE_URL=<Internal Database URL>
   ```
4. یک Secret دیگر نیز بسازید:
   ```text
   ADMIN_TOKEN=<a long random value>
   ```
5. روی **Save Changes** بزنید. سرویس Restart می‌شود و جداول به‌صورت خودکار ساخته می‌شوند.

نسخه جدید حتی بدون دیتابیس Crash نمی‌کند و صفحه راه‌اندازی را نشان می‌دهد، ولی استخراج تا زمان تعریف `DATABASE_URL` فعال نخواهد شد.

## استقرار سریع

### روش Blueprint

1. در Render گزینه **New → Blueprint** را انتخاب کنید.
2. مخزن و برنچ مورد نظر را متصل کنید.
3. Render فایل `render.yaml` را تشخیص می‌دهد و Web Service و PostgreSQL را می‌سازد.
4. بعد از ساخت، متغیرهای ووکامرس و باسلام را در Environment وارد کنید.
5. مقدار تولیدشده `ADMIN_TOKEN` را کپی و در صفحه داشبورد وارد کنید.

### تنظیم Web Service موجود

- Runtime: `Node`
- Build Command:
  ```bash
  npm ci && npm run render:build
  ```
- Start Command:
  ```bash
  npm run render:start
  ```
- Health Check Path: `/health`

متغیر اجباری:

```text
DATABASE_URL=<Render PostgreSQL internal connection string>
ADMIN_TOKEN=<long random value>
RUN_WORKER_IN_WEB=true
```

اتصال‌های ووکامرس، باسلام، هوش مصنوعی و پیام‌رسان از داخل منوی همبرگری رابط کاربری ثبت می‌شوند و نیازی به Environment Variable ندارند. مقادیر محرمانه با AES-256-GCM و کلیدی مشتق‌شده از `ADMIN_TOKEN` در PostgreSQL ذخیره می‌شوند.

> پس از ذخیره اطلاعات اتصال، `ADMIN_TOKEN` را تغییر ندهید؛ تغییر آن باعث می‌شود خزانه قبلی قابل رمزگشایی نباشد. برای تغییر توکن مدیریت، ابتدا بکاپ بگیرید و پس از تغییر، اطلاعات اتصال را دوباره ثبت کنید.

## پردازش مستقل برای مقیاس بالاتر

در حالت ساده Web Service هم API و هم صف را اجرا می‌کند. برای حجم بالا:

1. روی Web Service بگذارید `RUN_WORKER_IN_WEB=false`.
2. یک Render Background Worker از همان مخزن بسازید.
3. Build Command همان دستور بالا باشد.
4. Start Command:
   ```bash
   npm run render:worker
   ```
5. همان `DATABASE_URL` و متغیرهای مقصد را به Background Worker بدهید.

چند Worker می‌توانند هم‌زمان اجرا شوند؛ قفل تراکنشی PostgreSQL مانع اجرای تکراری یک Job می‌شود.

## Cron

در حالت `RUN_WORKER_IN_WEB=true` زمان‌بند داخلی هر دقیقه پروفایل‌های سررسیدشده را صف‌بندی می‌کند. برای Cron مستقل Render، فرمان زیر را هر دقیقه اجرا کنید:

```bash
npm run render:cron
```

و روی Web Service مقدار `RUN_WORKER_IN_WEB=false` یا Worker مستقل را فعال کنید.

## درون‌ریزی و برون‌ریزی تنظیمات کامل

در منوی همبرگری، بخش **ذخیره و بازیابی همهٔ تنظیمات** از فرمت `settings_YYYYMMDD_HHMMSS.json` نسخه PHP پشتیبانی می‌کند. فایل شامل نگاشت `files` و محتوای Base64 هر فایل JSON است.

برون‌ریزی نسخه Render فایل سازگار تولید می‌کند و شامل این داده‌هاست:

- `profiles.json` به‌همراه محصولات هر پروفایل
- `connections.json` شامل ووکامرس، باسلام، AI و اعلان‌ها
- حافظه یادگیری دسته‌بندی
- قواعد پاسخ خودکار
- remote map، sync state، تنظیمات گزارش و سایر app stateها

هنگام درون‌ریزی، اطلاعات اتصالِ متن ساده فایل PHP بلافاصله با AES-256-GCM در خزانه PostgreSQL رمزنگاری می‌شود. تصاویر inline base64 از خروجی حذف می‌شوند تا فایل سبک باقی بماند.

## مهاجرت پروفایل‌های PHP

Endpoint زیر JSON فایل `profiles.json` قدیمی را قبول می‌کند:

```http
POST /api/import-php
Authorization: Bearer ADMIN_TOKEN
Content-Type: application/json

{"profiles": { ...محتوای profiles.json... }}
```

## نکات عملیاتی

- فایل‌سیستم Render پایدار فرض نشده؛ تمام داده مهم در PostgreSQL قرار می‌گیرد.
- API Tokenها فقط در Environment Variables تعریف شوند.
- صفحات کاملاً JavaScript-rendered با Cheerio استخراج نمی‌شوند؛ برای آن‌ها API داخلی سایت یا Browserless/Playwright service لازم است.
- Basalam API ممکن است با نسخه یا حساب شما endpoint متفاوتی داشته باشد؛ `BASALAM_API` قابل تنظیم است.
- Web Service رایگان ممکن است در نبود ترافیک Sleep شود. برای زمان‌بندی دقیق از پلن دائمی یا Cron/Background Worker استفاده کنید.

## توسعه محلی

```bash
npm ci
export DATABASE_URL=postgresql://...
export ADMIN_TOKEN=dev-secret
npm run typecheck
npm run render:build
npm start
```

## تازه‌های نسخهٔ ۱.۹۶.۰

- **پیش‌نمایش هماهنگ‌سازی دیگر متن خام نیست؛ یک جدول ماتریسی رنگی است.** هر سطر یک محصول و هر ستون یک مقصد (ووکامرس و تک‌تک غرفه‌های باسلام) است؛ رنگ هر سلول وضعیت همان محصول در همان مقصد را می‌گوید: سبز = هماهنگ، نارنجی = اختلاف قیمت، آبی = در مقصد نیست، قرمز = فقط در مقصد، بنفش = بدون قیمت مبدأ، خاکستری = به آن مقصد ارسال نمی‌شود. علاوه بر رنگ، هر سلول نشانه و برچسب فارسی دارد و با نگه‌داشتن ماوس جزئیات کامل را نشان می‌دهد. پیش‌نمایش هیچ تغییری ثبت نمی‌کند؛ پس از اجرا، همین جدول با وضعیت واقعی دوباره رسم می‌شود.

## تازه‌های نسخهٔ ۱.۹۵.۰

- **رفع «۰ از ۰» در اجرای واقعی پروفایل.** دو علت مستقل: الف) وقتی تعداد صفحات ۰ (خودکار) بود، اجراگر Node هیچ صفحه‌ای را نمی‌پیمود در حالی که Worker تا ۱۰۰ صفحه می‌رفت؛ ب) اگر سلکتور لینک روی تصویر محصول تنظیم شده بود، آدرس محصول خالی می‌ماند و همهٔ محصولات دور ریخته می‌شدند. حالا لینک از خود عنصر، والد آن، یا نزدیک‌ترین `a[href]` داخل کارت پیدا می‌شود. به همین دلیل بود که عیب‌یابی ۲۰ محصول می‌دید ولی اجرا هیچ محصولی ذخیره نمی‌کرد.
- **دکمهٔ جدول مغایرت در محیط‌های غیرابری کار می‌کند.** پیش‌تر روی Termux/VPS/Render خطای `D1 binding DB is not configured` می‌داد، چون کد مشترک به لایهٔ دیتابیس Cloudflare دست می‌زد. اکنون هر اجراگر از دیتابیس خودش می‌خواند.
- **مغایرت‌گیری یکپارچه.** یک جدول پیشرفته که همهٔ پروفایل‌ها را هم‌زمان با ووکامرس و تک‌تک غرفه‌های باسلام مقایسه می‌کند: قیمت (پس از اعمال درصد تعدیل همان غرفه و تبدیل به ریال) و بود/نبود محصول. دکمهٔ «پیش‌نمایش» فهرست اقدامات را بدون تغییر نشان می‌دهد و دکمهٔ «اجرا و هماهنگ‌سازی» قیمت‌ها را اصلاح و محصولات جاافتاده را منتشر می‌کند. محصولی که فقط در مقصد است هرگز خودکار حذف نمی‌شود.
- **موتور `cheerio` در همهٔ فهرست‌های کشویی.** در ۱.۹۴.۰ فقط فهرست تنظیمات اصلاح شده بود و فهرست صفحهٔ شروع همچنان موتور ذخیره‌شده را به `auto` برمی‌گرداند.
- **به‌روزرسانی خودکار در دیپلویر واقعاً انجام می‌شود.** دکمهٔ «اسکن فوری» فقط جدول را تازه می‌کرد، و فایل‌های ساخته‌شده (`scraper4.worker.js`، `scraper4.ts`، `package-lock.json`) به‌اشتباه «کار دستی کاربر» شمرده می‌شدند و به‌روزرسانی خودکار را برای همیشه متوقف می‌کردند.

## تازه‌های نسخهٔ ۱.۹۴.۰

- **موتور `cheerio` در فهرست موتورها.** آزمون سرعت سه‌صفحه‌ای این موتور را می‌سنجید و به‌عنوان برنده در پروفایل ذخیره می‌کرد، اما در فهرست کشویی نبود و هنگام ذخیرهٔ بعدی بی‌صدا به `auto` برمی‌گشت. اکنون در هر دو اجراگر (Node و Cloudflare Worker) هم انتخاب‌شدنی است و هم ماندگار.
- **دکمهٔ «همگام‌سازی دستی» در صفحهٔ شروع.** یک کلیک: استخراج فهرست ← استخراج جزئیات (اگر تنظیم شده باشد) ← ارسال به ووکامرس و همهٔ غرفه‌های فعال باسلام. اگر هیچ مقصدی فعال نباشد، مثل قبل فقط استخراج انجام می‌شود.
- **«توضیح‌ساز» در بخش هوش مصنوعی.** به‌صورت پیش‌فرض روشن است و با **مدل مستر** فقط فیلدهای خالی محصول (توضیح کوتاه، توضیح بلند و تنوع‌ها) را پر می‌کند. متنی که واقعاً از سایت مبدأ استخراج شده هرگز بازنویسی نمی‌شود و هیچ عکسی ساخته نمی‌شود؛ گالری فقط از تصاویر واقعی همان صفحه پر می‌شود. خطای هوش مصنوعی هیچ‌وقت باعث شکست استخراج نمی‌شود.
- متغیر اختیاری `AI_DESCRIPTION_CONCURRENCY` (پیش‌فرض ۲) تعداد محصولات هم‌زمان در توضیح‌ساز را تعیین می‌کند.

## تازه‌های نسخهٔ ۱.۹۷.۰

- **«پیشنهاد خودکار سلکتورها» حالا آخرین راه نجات است.** پیش‌تر فقط زمانی اجرا می‌شد که یکی از موتورها از قبل محصولی پیدا کرده بود، یعنی دقیقاً در بدترین حالت (صفر محصول) بی‌فایده بود. حالا در سه حالت خودکار اجرا می‌شود: سلکتورهای فهرست خالی باشند، اتصال برقرار شود ولی صفر محصول استخراج شود، یا موتور استخراج هیچ کارتی پیدا نکند. سلکتورها دوباره کشف می‌شوند و همان صفحه یک‌بار دیگر استخراج می‌شود.
- **همین مکانیزم در مرحلهٔ جزئیات.** اگر سلکتورهای جزئیات روی یک محصول واقعی هیچ فیلدی را پر نکنند، دوباره کشف و آزمایش می‌شوند تا محصولات با توضیحات خالی ذخیره نشوند.
- **در تب سلکتورها و تب سلکتورهای جزئیات:** دکمه‌های آزمایش، وقتی هیچ فیلدی جواب ندهد، خودشان پیشنهاد خودکار را اجرا می‌کنند.
- هر نجات در هر اجرا فقط یک‌بار انجام می‌شود تا حلقهٔ بی‌پایان ایجاد نشود؛ روی Cloudflare این وضعیت در checkpoint ذخیره می‌شود و بعد از resume تکرار نمی‌شود.
- **به‌روزرسانی خودکار از گیت‌هاب دیگر دستی نیست.** نصب‌کنندهٔ محلی فایل‌های ردیابی‌نشده (`data/`، `storage/`، یادداشت‌های شخصی) را تغییر محلی حساب می‌کرد و متوقف می‌شد؛ حالا فقط تغییرات فایل‌های ردیابی‌شده شمرده می‌شود و یک `.gitignore` ریشه اضافه شده است.

## تازه‌های نسخهٔ ۱.۹۸.۰

- **ضریب تعدیل قیمت برای ووکامرس:** پیش‌تر فقط غرفه‌های اضافی باسلام فیلد «تغییر قیمت ٪» داشتند و ووکامرس و غرفهٔ پیش‌فرض باسلام ثابت روی صفر بودند. حالا هر دو فیلد مخصوص خود را دارند. این ضریب هم روی قیمت ارسالی به مقصد (شامل تنوع‌ها) اعمال می‌شود و هم در مغایرت‌گیری و پیش‌نمایش هماهنگ‌سازی به‌عنوان «قیمت صحیح» در نظر گرفته می‌شود.
- **دکمهٔ پیش‌نمایش هماهنگ‌سازی:** چون داخل یک درخواست اجرا می‌شد، هیچ ردیفی در مدیر وظایف ساخته نمی‌شد و دکمه مرده به نظر می‌رسید. حالا پیام «در حال خواندن مقصدها…» و یک ردیف زنده در مدیر وظایف نمایش داده می‌شود.
- **نتیجهٔ خالی، دلیل مشخص:** «هیچ مقصدی تنظیم نشده»، «هنوز محصولی استخراج نشده» یا «همه‌چیز هماهنگ است».
- **گزارش تغییرات کوتاه شد:** فقط ۱۲ مورد آخر باز است و بقیه در بخش جمع‌شدهٔ «نمایش همهٔ تغییرات قدیمی‌تر» قرار دارند تا رسیدن به بخش‌های پایین منو سریع باشد.

## تازه‌های نسخهٔ ۱.۹۹.۰

- **پروکسی برای خود استخراج هم اعمال می‌شود:** تا پیش از این، مقدار «روش اتصال» (proxy/Worker) فقط در تماس با مدل‌های هوش مصنوعی استفاده می‌شد؛ درخواست صفحات فروشگاه مبدأ مستقیم ارسال می‌شد و به همین دلیل خطای تحریم باقی می‌ماند. حالا `safeFetch()` — که تنها مسیر ترافیک مبدأ است — از همان پروکسی (با `ProxyAgent` از undici) یا Worker واسط عبور می‌کند و تغییر تنظیمات بدون راه‌اندازی مجدد اعمال می‌شود.
- **تشخیص صفحهٔ چالش در Node:** محافظ `ensureTextResponse()` که فقط در Worker بود به اجرای Node هم اضافه شد؛ صفحهٔ ضدربات دیگر به‌جای محصول پردازش نمی‌شود.
- **دکمهٔ عیب‌یابی پروکسی را واقعاً تست می‌کند:** پیش‌تر در حالت `proxy` فقط یک پیام چاپ می‌شد و پروکسی معیوب هم «سالم» دیده می‌شد.
- **استخراج جزئیات:** اول موتور استخراج سلکتورهای گم‌شده را خودکار پیدا می‌کند، سپس توضیح‌ساز هوشمند فقط به‌عنوان فال‌بک.
- **انتخاب دستی موتور محترم است:** موتور انتخاب‌شده اول اجرا می‌شود (پیش‌تر موتورهای کشف خودکار جلوتر اجرا می‌شدند) و اگر چیزی پیدا نکند بقیه فال‌بک می‌شوند.

## تازه‌های نسخهٔ ۱.۱۰۰.۰

- **مغایرت‌گیری و هماهنگ‌سازی فقط برای محصولات دارای پسوند «(کد ایکس)»:** ایکس هر حرف یا عددی می‌تواند باشد — «(کد ۱۲)»، «(کد A5)»، «(کد:ب۳)» و «#77» همگی معتبرند. عنوان‌های بدون این پسوند عنوانِ پایه/پیش‌نویس در نظر گرفته می‌شوند و نه مقایسه و نه به ووکامرس/باسلام ارسال می‌شوند. تعداد نادیده‌گرفته‌شده‌ها زیر جدول («… بدون پسوند کد») نمایش داده می‌شود. فرمت‌ها از همان تنظیم «فرمت پسوند کد» در منوی حذف تکراری‌ها خوانده می‌شود.
- **ستون «تکراری»:** تعداد محصولاتی که با نادیده‌گرفتن پسوند کد عنوان یکسان دارند؛ گروه‌های بزرگ‌تر از یک با رنگ زرد مشخص می‌شوند.
- **جدول تست مدل‌های هوش مصنوعی با ریفرش صفحه باز نمی‌شود** و فقط پس از پایان اجرایی که همان تب دیده، ظاهر می‌گردد.

## 1.101.0 — Basalam multi-stall sending, clickable counters, destination duplicate cleanup

- **Every Basalam stall really receives the product.** The multi-stall loop existed, but the whole
  loop sat inside one `try/catch`: if stall 2 of 3 failed, the send was abandoned and the success
  already achieved on stall 1 was never reported. Each stall is now isolated and reported on its own
  line, so one bad token or one rejected category no longer cancels the rest.
- **The official Basalam SDK is now actually used.** Basalam publishes an SDK for **Python only**
  (`pip install basalam-sdk`); no npm package exists, so the old "SDK first" branch always failed and
  silently fell back to REST. Sending now runs the real SDK through `scripts/basalam-sdk-bridge.py`
  (spawned as `python3`) and falls back to the REST API automatically when Python or the SDK is
  missing. Override the interpreter with `BASALAM_PYTHON`, and the timeout with
  `BASALAM_SDK_TIMEOUT_MS` (default 45000).
- **Counters are clickable and now carry real detail.** Clicking a job counter lists the product
  name, its price and the destination/stall; clicking the error counter shows the full error text.
  The Node runtime previously recorded no per-product detail at all, so this popup was always empty
  outside Cloudflare — both runtimes now log identically (and keep 1500 entries instead of 200).
- **Duplicate cleanup across every destination.** Reconciliation gained
  «پیش‌نمایش تکراری‌های مقصد» and «حذف تکراری‌ها در همهٔ مقصدها». Listings whose titles are identical
  once the «(کد ایکس)» suffix is stripped form a duplicate group; by default the **most expensive**
  copy is kept and the rest are removed (WooCommerce deletes, Basalam archives with status 4184,
  because its API has no permanent delete). Preview first, then confirm. Locally scraped products are
  never touched. `POST /api/maintenance/duplicates` `{confirm:'APPLY'|'', keep:'expensive'|'cheapest', accountKey?, limit}`.
- **Fixed: the duplicate grouper ignored generic code suffixes.** `dedupKey` stripped only the
  *configured* formats, so a shop full of «کیف چرم (کد 11)» / «(کد 12)» titles produced zero groups
  and every duplicate cleanup silently did nothing. It now uses the same stripper reconciliation uses.
- **Fixed: the whole server-side duplicate remover was missing from the Node runtime.** All four
  `dedup-runs` routes existed only on Cloudflare, so those buttons were dead on Termux, VPS, Render
  and Codespaces. `render-src/dedup-run.ts` implements them in-process with the same public shape.
- Termux setup now installs the SDK: `pip install basalam-sdk`.

## 1.102.0 — Basalam HTTP 400 fixed, single-column results with a product modal, Basalam settings autofill

- **Fixed the Basalam `HTTP 400` that blocked every real send.** The reported errors
  (`photo: Input should be a valid integer, unable to parse string as an integer` and
  `status: Field required`) came from three wrong fields in the product payload:
  - `photo` must be the **integer id of a file uploaded to `/v1/files`**, not an image URL.
    Images are now uploaded first (`file_type=product.photo`) and only their numeric ids are sent,
    in `photo` plus `photos[]`. Upload failures are non-fatal: the product still publishes, without
    photos, instead of losing the whole send.
  - `status` is **required**; it is now sent as `2976` (PUBLISHED).
  - the price field is **`primary_price`**, not `price`.
  Verified against the official `basalam-sdk` 1.2.0 `ProductRequestSchema`: the new payload validates
  and the old one reproduces exactly the reported error.
- **The results section is a single-column list.** Each row shows the image, the product name with
  its «(کد ایکس)» code suffix, the **base price struck through** and the **final price in Toman** for
  the default Basalam stall.
- **Clicking a product opens its modal**: image gallery, a table of the final price for **every**
  destination (WooCommerce and each Basalam stall, with the Rial equivalent), product details,
  variations and the full description.
- **Basalam settings autofill.** Entering a token and pressing Test now queries `users/me` and fills
  the vendor id and preparation days automatically; testing an extra stall fills that stall's vendor
  id and name. The Node runtime previously only called `/categories` and returned no vendor data.
- Fixed: `POST /api/profiles/:id/import` threw an unhandled `SyntaxError` in the server log when the
  body was not JSON; it now returns a 400.

## 1.103.0 — AI proxy 404 fixed, reconciliation matrix restored

- **Fixed: a proxy address without a scheme made every AI model return 404.**
  Entering `proxy.example.workers.dev` (exactly as Cloudflare shows it) produced a **relative**
  URL, so the request resolved against the scraper's own origin — e.g.
  `https://your-scraper.workers.dev/api/ai/proxy.example.workers.dev?url=...` — which does not
  exist, hence 404 for every model while direct connections kept working. Proxy addresses are now
  normalised (`https://` added when missing) in **both runtimes**, for AI, WooCommerce and scraping.
  The two address fields also accept a bare hostname now instead of being rejected by the browser.
- **New `scripts/ai-proxy-worker.js`** — a paste-and-deploy Cloudflare Worker. A correct address
  still 404s if the Worker behind it does not implement the expected contract, so this one does:
  it accepts `/?url=<encoded>`, the `x-scraper-target` / `x-target-url` headers **and** the path
  form, forwards method/body/Authorization unchanged, answers CORS preflight, exposes `/health`,
  and keeps an `ALLOWED_HOSTS` allowlist so it cannot be abused as an open relay.
- **The reconciliation preview shows the matrix table again.** Preview used a chips-only renderer
  while apply used the full matrix, so the same data looked completely different before and after
  running. Preview now renders the same table (products × destinations).
- **Fixed: "everything is in sync" was shown when every destination had failed.** Three HTTP 401s
  used to end with a green "all destinations match the source" banner. A red
  "no destination responded" banner with the error list is shown instead, and a green banner is
  never shown while any destination failed.

## 1.104.0 — Basalam `401 invalid authorization header` fixed

- **Fixed the `HTTP 401: invalid authorization header` that blocked Basalam sending.**
  Copying the token the way the documentation prints it — `Bearer eyJ...` — stored the whole string,
  so the request went out as `Authorization: Bearer Bearer eyJ...` with the scheme twice, which
  Basalam rejects. Tokens are now cleaned both when saved and when loaded:
  - a pasted `Bearer` / `Token` / `Authorization:` prefix is removed,
  - surrounding quotes and leading/trailing spaces are dropped,
  - invisible characters (ZWNJ, RTL/LTR marks, non-breaking spaces, smart quotes) are stripped —
    these are not legal HTTP header bytes and made the request throw or be refused outright.
- **Tokens already stored incorrectly heal themselves on load**, so there is nothing to re-enter.
- The same cleaning applies to **extra Basalam stalls** and to the **`BASALAM_TOKEN`** environment
  variable.
- A `401` now explains what to do ("copy the token without the word Bearer…") instead of only
  echoing Basalam's message, and the token field says the same thing.

If sending still returns 401 after this, the token itself is invalid or expired — create a new
personal access token in the Basalam developer panel with the required scopes.

## 1.105.0 — pinpointing the cause of a Basalam 401

- **Verified the request we send is correct.** Driving the real `safeFetch` with a stubbed
  transport shows the outgoing header is exactly `Authorization: Bearer <token>` — no duplicated
  scheme, no stray characters, correct URL. So a remaining
  `401 invalid authorization header` is the token being rejected, not the header format.
- **The token is now diagnosed locally, with no network call.** Basalam personal access tokens are
  JWTs, so the payload is decoded to report the real cause: the token is empty, still carries the
  word `Bearer`, contains a space or newline, has **expired** (the expiry date is printed), or lacks
  the **`vendor.product.write`** scope (the scopes it does have are listed).
- The verdict appears both in the send error and in the Basalam connection test, and it still works
  when Basalam itself is unreachable — previously a network failure returned a bare `fetch failed`
  with no information about the token at all.

If the verdict says the token is structurally fine but Basalam still answers 401, the token has been
revoked or belongs to a different account: create a new personal access token with the
`vendor.product.write` scope at developers.basalam.com/panel/tokens.

## 1.106.0 — cPanel shared-hosting support

- **New `CPANEL-SHARED-HOSTING.md`** — a verified walkthrough for advanced shared plans that offer
  *Setup Node.js App* (CloudLinux Node.js Selector + Phusion Passenger) and *Setup Python App*,
  including exactly which libraries can and cannot be installed there.
- **New `scripts/cpanel-app.js`** — the Passenger entry point. cPanel does not run `npm start`; it
  imports a startup file and assigns the port itself. This wrapper imports the built server (which
  already honours `process.env.PORT`) and logs startup crashes that Passenger would otherwise hide
  behind a bare 503.
- Verified on a clean install: the runtime needs only **6 pure-JS packages (56 modules, 17 MB)** and
  **no compiler** — `playwright`, `puppeteer` and `crawlee` are lazy-loaded and can be omitted
  entirely, and SQLite comes from Node's built-in `node:sqlite` (Node 22.5+), so no `better-sqlite3`
  build is needed. `pip install basalam-sdk` also works, because `pydantic-core` ships a prebuilt
  manylinux wheel.

## 1.107.0 — explaining a Basalam 401 when the token itself looks fine

- **Confirmed our request matches the official SDK exactly.** Reading `basalam-sdk` 1.2.0 shows it
  posts to the same `/v1/vendors/{vendor_id}/products`, with the same JSON body, and builds the same
  `Authorization: Bearer <token>` header. So a 401 whose local verdict says "the token is
  structurally fine" is not a header-format problem, and no purely local check can explain it.
- **The failing token is now probed against the read-only `users/me` endpoint at the moment of the
  error**, which separates the three real causes:
  - `users/me` also returns 401 → the token is revoked or invalid; create a new one.
  - `users/me` returns 200 → the token is valid but lacks **`vendor.product.write`**.
  - `users/me` returns a different vendor → the token belongs to another stall; the real and the
    configured vendor id are both shown.
  The probe is best-effort: if it fails, the original error is still reported unchanged.
- **Fixed a misleading verdict.** A JWT with no scope claim silently passed the scope check and was
  reported as "structurally fine", which dead-ended the user. It now says the scope list is absent
  from the token and what to rebuild it with.

## 1.108.0 — the Basalam indirect-connection switch now works, cPanel card, collapsible menus

- **Fixed: «اتصال غیرمستقیم» for Basalam was stored but never read.** No request looked at the flag,
  so switching it on changed nothing. The evidence that this — not the token — was the problem:
  **two different stall tokens returned 401 at the same time**, and WooCommerce simultaneously
  returned `error code: 522`. A token cannot cause a 522; the destination edge was refusing the
  traffic. Basalam rejects requests from datacenter ranges before the token is ever validated, which
  it reports as `invalid authorization header`.
  With the switch on, **every** Basalam call (`users/me`, photo upload, product create/update,
  vendor product list, status change) is routed through the configured reverse Worker in both
  runtimes, with the `Authorization` header preserved end-to-end. The source product image stays on
  the direct path, because it is fetched from the source shop and not from Basalam. Turning the
  switch on without a Worker address now reports that instead of failing silently.
- `scripts/ai-proxy-worker.js` now allows `openapi.basalam.com`, `auth.basalam.com` and
  `core.basalam.com` — otherwise the proxy itself answered 403.
- **New cPanel card in the install section** with the full step-by-step commands; its download is a
  `scraper4-install-cpanel.sh` shell script.
- **The menu no longer forces an endless scroll.** Only the newest changelog card stays open; the
  previous 14 moved into a «recent changes» fold (the older 108 keep their own fold).
- **Every environment install guide is collapsible** and closed by default; the copy and download
  buttons are unchanged.

## 1.109.0 — the reconciliation table comes back when a destination fails

- **Fixed the regression that made the full comparison table disappear.** In the reconciliation
  loop, a destination whose read threw contributed **no rows at all**. With every destination
  failing (the 401/522 case) the matrix had nothing to draw, and the 1.103.0 guard then replaced it
  with a plain error banner — so the table you used to get was gone.
  A destination that cannot be read now still produces one cell per product, in a new
  **«مقصد پاسخ نداد»** state (⛔, pink). The complete table renders again — every product row, every
  destination column — with the per-destination errors listed above it. Unreachable cells sort to
  the top so they are seen first. Fixed in both runtimes.

## 1.110.0 — Basalam sending matched to the PHP reference (scraper4.php v10.91)

The reference implementation was read from `fazilatma/code` and two decisive differences were
found. Both are now fixed:

- **A product must be created as a draft.** `bslSendProduct()` creates every product with
  `status = 3790` (UNPUBLISHED). We were creating straight into `2976` (PUBLISHED).
- **The create call must not carry photos.** The PHP payload contains no `photo`/`photos` keys at
  all: `['name','brief','description','primary_price','stock','preparation_days','weight',
  'package_weight','is_wholesale','category_id','status']` plus an optional `sku`. Photos are
  uploaded to `/files` and attached **afterwards**, together with `status = 2976`, in a separate
  `PATCH`.

Sending now performs exactly those two steps: create the draft without photos, then PATCH to
publish with the uploaded photo ids. If the second step fails the product is not lost — it already
exists and the next sync completes it.

Also confirmed from the reference: the PHP auth header is plain `Authorization: Bearer <token>`,
identical to ours, so the header format was never the problem.

## 1.111.0 — stop disguising API calls as a browser (the real cause of 401 + 522)

Diffing our HTTP layer against the PHP reference found the cause. `bslCurlOpts()` sends exactly
three headers:

```
Accept: application/json
Authorization: Bearer <token>
Content-Type: application/json
```

We were sending **five**, including a fake desktop-Chrome `user-agent` and a Persian
`accept-language`. A browser user-agent on a JSON API, with none of the other browser signals, is a
standard WAF signature. The edge rejects the request **before** the token is ever read and reports
it as `invalid authorization header` — which is why:

- the read-only `users/me` endpoint also returned 401,
- two different, valid stall tokens failed identically,
- and WooCommerce returned `error code: 522` in the very same run.

Every API call now sends only the caller's own headers, in both runtimes: Basalam (direct and
proxied) and the WooCommerce REST path. Scraping shop pages keeps the browser headers, because some
shops serve a stripped page or a challenge without them — the two paths are now separated by an
explicit, type-checked `apiMode` flag rather than one shared default.

## 1.112.0 — a Basalam doctor you can run on the machine that fails

The 401 cannot be reproduced from the build environment (it has no route to Basalam), so instead of
guessing again, `scripts/basalam-doctor.mjs` runs **on the failing machine** and reports exactly
what Basalam answers.

```bash
node scripts/basalam-doctor.mjs <token>
# or let it read the saved token from a running instance:
SCRAPER_URL=http://127.0.0.1:3000 ADMIN_TOKEN=xxx node scripts/basalam-doctor.mjs
```

It sends the same token four ways and prints the status, body and edge headers of each:

| probe | headers | what it proves |
| --- | --- | --- |
| A | Accept + Authorization + Content-Type (exactly what `scraper4.php` sends) | the token on a clean request |
| B | plus a browser `user-agent` and `accept-language` | whether a WAF is rejecting the browser disguise |
| C | Authorization only | whether any extra header matters |
| D | `vendors/{id}/products` | whether the failure is auth or scope/vendor |

If A returns 200 the token is fine and the problem is in the app; if all of A/B/C return 401 the
token itself is refused. The token is never printed — only its length, shape, expiry, scopes and a
short non-reversible fingerprint, so the output is safe to share.

## 1.113.0 — destination APIs no longer travel through the scraping proxy (the real 401)

The doctor output from the failing Termux device settled it: **all four probes returned HTTP 200** —
token valid to 2027, all 15 scopes present, `vendors/735703/products` readable — while the app still
got 401. The token was never the problem; the app was.

In the Node runtime `safeFetch()` applied `sourceNetwork` **unconditionally**. That is the
*«اتصال به سایت مبدأ»* setting for **scraping**, populated from `ai.network`. With the AI connection
method set to **Worker**, every authenticated Basalam and WooCommerce request was rewritten through
that proxy Worker — which does not forward the `Authorization` header. Basalam therefore received a
request with no token and answered `invalid authorization header`; the WooCommerce edge answered
`522` in the same run. The doctor called `fetch` directly, bypassing all of it — which is exactly
why its probes passed.

Destination APIs now pick their own route:

- **Basalam** follows its own «اتصال غیرمستقیم» switch — Worker when on, direct when off.
- **WooCommerce REST** goes direct.
- **Scraping** still uses the configured proxy, unchanged.

The Cloudflare Worker runtime has no global `sourceNetwork` and was never affected, which matches
the report that this reproduces on Termux.

## 1.114.0 — fix the 422 «شناسه تصویر الزامی است» (correcting my 1.110.0 mistake)

The 401 is gone: authentication now works. The next error was mine.

In 1.110.0 I read `bslSendProduct()` — the helper for **extra shops** — and concluded that `photo`
must not be sent on create. The **main** send path in the same PHP file does the opposite: it sends
`'photo' => $pid` and `'photos' => [...]` in the create request, and Basalam enforces it.

The real rule from `scraper4.php`:

- upload the images first;
- if an upload succeeded, send `photo` + `photos` and set status **2976** (published) when the brief
  and the description are both at least 3 characters;
- otherwise create with status **3790** (draft), so the product still lands instead of being
  rejected.

That is now implemented exactly, in both runtimes, and the redundant publish-PATCH added in 1.110.0
is gone.

**Photo upload failures are no longer silent.** They were swallowed by a bare `catch`, which is why
the 422 arrived with no explanation. A 422 that names `photo` now reports which image failed and
why — for example `آپلود تصویر ناموفق بود … علت: a.jpg: HTTP 413` — or states plainly that the
product has no image at all.

## 1.117.0 — Cloudflare error 1042 on the AI proxy, and Workers-plan quota

- **Diagnosed `error code: 1042`.** Cloudflare does not allow a Worker to fetch **another Worker on
  the same account**; the edge answers 404 *before* the proxy Worker runs, which is why the AI
  diagnostic reported "the proxy replied but did not forward the request". Added the documented fix,
  `compatibility_flags = ["global_fetch_strictly_public"]`, to `wrangler.toml`.
  **You must also enable that flag in the Cloudflare dashboard for BOTH Workers** (this scraper and
  the proxy): *Settings → Runtime → Compatibility flags*, then Deploy. Alternatively, host the proxy
  on a different Cloudflare account, or give it a Custom Domain and use that address. The AI
  diagnostic now recognises 1042 and prints these exact steps instead of a generic message.
- **The quota bar now covers AI work.** AI calls write nothing to D1, so they were invisible. Two
  rows were added: Worker invocations per day (100,000 on Free) and the **peak number of outbound
  requests in a single invocation** (50 on Free) — the limit that actually constrains model testing.
  Invocations are counted in the fetch, queue and scheduled handlers; every outbound `fetch()` is
  counted in one place in `network.ts`.

## 1.118.0 — correct the 1042 hint for Termux, and stop pointless detail fetches

- **Fixed: the `error code: 1042` advice was Cloudflare-specific but only ever appears on Node.**
  That diagnostic lives in `render-src/ai.ts`, which runs on Termux/VPS/cPanel — never on Cloudflare.
  A plain Node client is not a Worker, so the "a Worker may not fetch another Worker on the same
  account" rule cannot apply to its request. Getting 1042 there means something else: **no Worker is
  deployed on that hostname**, so Cloudflare's edge answered instead of your proxy. The hint now
  says that, and tells you to deploy `scripts/ai-proxy-worker.js` and check its `/health` route. The
  `global_fetch_strictly_public` flag remains, but only as a footnote for calling the proxy *from
  another Worker*.
- **Fixed: the detail stage downloaded every product page even with no detail selector configured.**
  Nothing could be filled, so those hundreds of requests were pure waste. Now, when no detail
  selector is set, the selectors are auto-discovered first; if discovery also finds nothing the
  stage is skipped and says so, instead of silently fetching everything. The job log also reports
  how many products were enriched. Applied to both runtimes.

## 1.119.0 — the AI proxy URL was wrapped twice (real cause of 1042 and the 404s)

Your proxy was fine. The bug was ours.

`networkFetch()` wrapped the target in the proxy URL — `proxy/?url=https://api.openai.com/…` — and
then passed the result to `safeFetch()`, which applied the *same* connection setting again and
wrapped it a **second** time. The proxy was therefore asked to fetch **itself**, which is a real
"Worker fetching a Worker on the same zone" — exactly what Cloudflare rejects with `error code:
1042`, returned as 404 for every model.

An already-proxied URL now bypasses the second wrap (`directRoute`), in the live model call as well
as in the diagnostic. Verified: the request is wrapped exactly once.

The previous release's advice to enable `global_fetch_strictly_public` is withdrawn — the problem
was never in your Cloudflare settings.

## 1.120.0 — thousands of scraped products collapsing into a handful, and priceless products

- **Fixed: 1,200 products scraped, only ~20 stored.** A product's identity is a hash of its
  canonical URL, but building that canonical form deleted the **entire query string**. On a shop
  whose product links look like `/product?id=123`, every product therefore produced the *same*
  identity and they all upserted over one another. Only tracking parameters (`utm_*`, `fbclid`, …)
  and paging parameters (`page`, `sort`, …) are stripped now; anything that could identify the
  product is preserved.
- **Products with no price are skipped.** They cannot be published anywhere — WooCommerce requires
  `regular_price` and Basalam rejects `primary_price <= 0` — so storing them only polluted the
  results list and the reconciliation table. They are now skipped during scraping **and** during
  file import, and the number skipped is reported in the job log and in the import response.

## 1.121.0 — the product modal renders like a real product page

- **Descriptions are rendered, not printed as markup.** The modal showed the scraped description
  escaped inside a log box, so a real shop page arrived as unreadable HTML. It is now rendered the
  way a visitor sees it — headings, lists, tables, images and links. Because the string reaches
  `innerHTML`, it is scrubbed first: scripts, iframes, forms, `on*` handlers and `javascript:` URLs
  are removed and links open in a new tab.
- **New "specification table" detail selector.** Point it at the specs block and the rows are
  extracted as name/value pairs. Three common markups are supported: a table (`tr`/`td`), a
  definition list (`dt`/`dd`), and "name: value" bullets. The rows appear as a table in the product
  modal and are stored with the product.
- **The visual picker can pause.** It used to swallow every click, so tabs, accordions and galleries
  on the product page could not be opened to reach the fields inside them. The new **⏸ توقف انتخاب**
  button lets the page behave normally; press **▶ ادامهٔ انتخاب** to resume picking and select the
  newly revealed content. Added to both runtimes.

## 1.122.0 — "1,200 of 20" explained: the site was repeating one page

The two numbers counted different things: the first was every **raw item scanned**, the second the
number of **unique products**. A shop that returns the same 20 products for every page number gives
60 × 20 = 1,200 scanned but only 20 distinct products — so "20 in the results" was correct and
"1,200" was the misleading number. Both now report unique products.

More importantly, the "this page added nothing new" guard only ran in **auto** paging
(`pages = 0`). With an explicit page count the same duplicate page was fetched to the very end. The
guard now applies in every mode: two consecutive pages that add nothing stop the run, with a warning
that pagination is probably not working.

If the shop really has 1,200 products, check the profile's pagination type and pagination value.
The Cloudflare runtime already stopped on a fully duplicate page and was never affected.

## 1.123.0 — the pagination dropdown reverted to the first option

The dashboard offers seven pagination modes, but the Node runtime's whitelist accepted only three
(`query_page`, `path_page`, `none`). Choosing any of the other four was silently rewritten to
`query_page` on save, so the dropdown "jumped back" and only page 1 was ever scraped.

All seven are now accepted **and** implemented in the Node runtime: custom query parameter, path
pattern with `{page}`, full URL pattern, and the next-page button. `next_selector` has no
computable URL, so the next link is read from the page already fetched (no extra request) and
followed; when the link is missing, pagination ends with a clear message instead of silently
re-reading page 1.

For a site whose URLs look like `/page/2/`, the simple **مسیر /page/2/** option is enough — a
next-button selector is not required.

## 1.124.0 — the detail stage now reports progress live

The detail stage was silent: it never updated the job counter and never saved, so the queue card
stayed frozen on the list-phase numbers for the whole stage and there was no way to tell whether it
was working or stuck.

- The stage owns its own counter now (for example "45 of 301") and advances per product.
- Every product whose details are read is written to the live log as a clickable row, and a failure
  is reported per product with its own name.
- The stage ends with how many products were actually enriched.
- Progress is persisted every fifth product rather than on every one, so the reporting itself does
  not add a database write per product.
- Phase names are shown in Persian instead of raw keys such as `details-save-sync`.

## 1.125.0 — Render deploy fixed: "Cannot find package 'esbuild'"

Render, like any host that installs with `NODE_ENV=production`, skips
`devDependencies`. `esbuild` lived there, so `npm run render:build` could never load its own
bundler and the scraper exited with code 1 before serving anything. Reproduced exactly, then fixed:
`esbuild` and `esbuild-wasm` are now normal dependencies, and a production install followed by
`render:build` was verified to succeed.

The loader's error message blamed the operating system ("make sure Node.js LTS is installed…"),
which was misleading here. It now detects `NODE_ENV=production` and says the install skipped
devDependencies.

`render.yaml` also had three deploy-blocking problems, all corrected:

- **no `rootDir`** — `package.json` lives in `cloudflare-scraper4/`, not the repository root;
- **`npm test` in the build command** — the full suite takes minutes on the free plan and one
  failing test blocked deploys of working code;
- **`ADMIN_TOKEN` generated automatically** — the dashboard has no login field, so every `/api/*`
  call returned 401 and the page loaded completely empty. Verified: with the token set the page is
  200 but the API is 401; without it both are 200.

`NODE_VERSION` is also pinned to 22 so the built-in SQLite fallback stays usable.

## 1.126.0 — the browser engines (Playwright / Puppeteer / Crawlee) actually run now

They were in the extraction chain all along, but `.npmrc` deliberately skips the bundled browser
download (~300 MB, which breaks free hosting tiers). Every launch therefore failed with
`Executable doesn't exist`, and in `auto` mode that error was swallowed — so the engines looked as
though they were never used.

- **A browser already on the machine is found automatically.** Common Linux, Termux, macOS and
  Windows paths are checked, so `pkg install chromium` or a normal Chrome install is enough.
  `BROWSER_EXECUTABLE_PATH` still takes priority.
- **When no browser exists the run says so.** Instead of a bare "no products found", the job log
  reports that the browser engines could not start and prints the command that fixes it.
- **The desktop and VPS install guides now install the browsers.** Previously only Termux and
  Windows did, which is why those environments silently never used them.

For a JavaScript-only shop, run `npm run browsers:install` once (or `pkg install chromium` on
Termux). Cloudflare Workers and shared cPanel cannot run a browser at all — use the HTML engines
there.

## 1.131.0 — the browser engines all run on a phone (Termux) now

Playwright and Puppeteer already drove Termux's `chromium` package through the
auto-detected path, but Crawlee ignored it and looked only for Playwright's
bundled downloads — which `.npmrc` skips, and which could never execute on
Android anyway (desktop-Linux glibc binaries vs Android's Bionic libc). Worse,
`npm run browsers:install` downloaded those same unusable binaries on a phone.

- **Crawlee launches the detected browser too.** All three engines now share one
  resolution: `BROWSER_EXECUTABLE_PATH`, then the Termux/desktop paths, then the
  Playwright/Puppeteer caches — always with the sandbox-free flags Android needs.
- **`npm run browsers:install` is Termux-aware.** On a phone it installs and
  verifies the system `chromium` via `pkg` instead of downloading ~170 MB of
  desktop binaries that can never run; everywhere else it downloads as before.
  It still never fails hard, so chained install commands keep working.

On the phone itself the whole setup is: `pkg install -y nodejs-lts git chromium`,
clone, `npm install`, `npm run browsers:install`, then start the scraper and pick
the playwright/puppeteer/crawlee_playwright engine (the Termux guide prints the
exact lines).

## 1.132.0 — the Termux install actually completes (`--ignore-scripts`)

A real phone run proved a bare `npm install` dies on Termux before anything
else: the wrangler devDependency runs workerd's setup script, which has no
Android build (`Unsupported platform: android arm64`), and npm aborts the
whole install — leaving node_modules half-written so even
`npm run browsers:install` fails afterwards.

- **Both Termux guides now install with `--ignore-scripts`.** Nothing the
  scraper runs needs install scripts on a phone: the browser comes from the
  `chromium` system package and the build is covered by the native
  `@esbuild/android-arm64` binary, with the system-esbuild / WebAssembly
  fallback chain from v1.83.0 as backup. Desktop and Windows guides are
  unchanged.
- **Start with the deployer, not `npm start`.** `npm start`/`wrangler dev`
  needs the workerd binary that cannot exist on Android; on Termux the app
  runs through `npm run deployer:ui`, which builds and serves the
  Render-mode server for you.

If an older guide left you with a broken install, update the checkout,
delete `node_modules` once, and reinstall with
`npm install --ignore-scripts --no-audit --prefer-online`.

## 1.133.0 — Playwright actually imports on Termux (`Unsupported platform: android` fixed)

With the install fixed, the extraction diagnostic on a real phone failed one
step later: choosing the Playwright engine reported `Unsupported platform:
android`. The cause is inside Playwright itself — it resolves its browser
registry directory at IMPORT time and only knows linux/darwin/win32, so the
bare `import('playwright')` throws on Android before any launch is attempted
(reproduced here by faking `process.platform`; Puppeteer and Crawlee import
fine without help).

- **The scraper defaults `PLAYWRIGHT_BROWSERS_PATH` on Android.** Playwright
  checks that variable before computing its default, so pointing it at the
  normal cache path (`~/.cache/ms-playwright`) bypasses the throw. We always
  launch an explicit system executable, so the directory is never actually
  used; an explicitly configured value still wins. One module-level default
  covers all three engines, because every browser import in the codebase is
  a lazy import inside `render-src/scraper.ts` (Crawlee pulls Playwright in
  internally, so it is covered too). Desktop behavior is unchanged.
- **Verified past the gate, not just past the import.** With the variable
  set, `chromium.launch({ executablePath })` reaches normal executable
  validation instead of dying on the platform check.

Updating the checkout is enough — no reinstall needed. Restart the deployer
process after pulling so it runs the new code, then re-run the extraction
diagnostic with the Playwright engine.

## 1.134.0 — browser navigation survives shops that redirect mid-load

On a real phone the Playwright engine got one step further and failed with
`page.goto: net::ERR_ABORTED ... waiting until "networkidle"`. That error
means the page itself interrupted the navigation — shops routinely redirect
or reload mid-load (cookie checks, bot screens, framework routers) — while
the follow-up page loads fine. Waiting for network idle inside goto turns
that routine redirect into a total failure, and pages with ever-open
connections (ads, analytics) may never idle anyway.

- **goto waits only for parsed DOM now** (`domcontentloaded`, both drivers).
- **An aborted goto no longer fails the run.** When the error is
  `ERR_ABORTED`, the launcher lets the follow-up navigation settle and reads
  whatever actually landed instead of throwing.
- **Rendering still gets a best-effort idle window** (15 s, failures
  ignored) before the HTML is read, so JavaScript-rendered products appear
  without hanging on never-idle pages.

Same update path: pull, restart the deployer process, re-run the diagnostic.

## 1.135.0 — the extraction diagnostic copies with one click and heals empty selectors

Two requests from the same debugging session. First, the diagnostic report
now has a "copy full report" button: one tap copies every stage, the
evidence, the extracted data and the recommendations as plain text, with a
fallback for browsers where the clipboard API is unavailable. The same
shared dashboard code serves both runtimes, so the button works on Termux
and on Cloudflare.

Second, the diagnostic stops being read-only about discoveries. When a
profile's selectors were never configured (empty, partial or still the
WooCommerce defaults) and auto-discovery finds verified selectors on the
real page, the diagnostic saves them into the profile immediately — the
report gains a `selectors-auto-saved` stage listing what was stored, and
the selectors tab fills itself in. Fully custom selectors are never
overwritten, and testing an overridden URL never rewrites the profile.
Missing detail selectors are suggested from a real product page the same
way. Re-run the diagnostic after a save and the list/detail stages should
go green.

Same update path: pull, restart the deployer process, re-run the diagnostic.

## 1.180.0+ — merged onto your 1.179.0: results list, local AI providers, the `+` marker, redesigned deployer

This release has your `1.179.0` (per-profile enricher switch, Basalam categories inside enrichment,
recon audit) plus your `1.178.0` (extraction timer, background enricher, chat/category test switch)
and `1.177.0` (auto-candidates, searchable green-marked dropdowns, auto-refresh results) as
ancestors; none of that is changed here.
The four fixes below were still missing on the production branch, and all of them are the only
deltas in the shared dashboard besides the changelog — your `combo-list` dropdowns and your
`loadProducts({noActivate:true})` auto-refresh survived the merge (pinned in the tests).

- **Results section renders rows again.** `productSuffixFormats` was `async` while
  `productCodeSuffix` read it synchronously, so `formats[0]` was `undefined` on a Promise and any
  row with a `sku`/`sourceKey` threw inside `rows.map(productRowHtml)`, discarding the whole list
  and breaking `openProductModal` too. The helper is synchronous, the formats result is validated
  with the `(کد:x)` fallback, each row is guarded (a failure becomes one warning card naming the
  error) and the modal says when a row is missing. `worker-tests/results-products-ui.test.mjs`
  drives the real bundle and fails if the stray `async` returns.
- **Local/LAN AI providers on Linux and Termux.** `assertAiEndpointUrl` in
  `render-src/network.ts` plus an explicit `aiEndpoint` opt-in in `safeFetch` (redirect hops and
  the `/models` probe included), used by every Node AI call. http/https only, no URL credentials,
  `169.254.0.0/16` refused; scrape targets keep `assertPublicUrl`.
- **Chat keeps its history** on Node (messages posted with roles, `keyIndex` reported), and
  `LOCAL_SCRAPER_AUTO_UPDATE` also accepts `0` / `no` / `off`.
- **Version marker.** Agent releases are `x.y.z+` (`1.180.0+`); `sync-version` accepts and
  propagates it, the branch comparator still uses the numeric core, and the runtime pin reads
  `packageJson.version` instead of embedding it in a regex.
- **Deployer page rebuilt for a zoomed phone**: rem/em type and em breakpoints everywhere, no
  px layout lengths, overflow-safe `minmax(min(100%,X),1fr)` grids, tables that become labelled
  cards when narrow, a sticky snapping tab rail, 2.85rem tap targets, a pinned bottom dock with
  safe-area padding, collapsible explanations, and dark/light palettes with a persisted switch.
  Same ids, same handlers, same routes.

## 1.181.0+ — deployer round two: a live status rail, a text-size step, badges, filters, and behaviour tests

Only `scripts/local-deployer-ui.mjs` and its tests change. Every `/api/*` route, id, handler and
the token flow (`?token=` plus `x-local-deployer-token`) stay as they were, and the tab order that
`tabByIndex()` and the `#branches` deep link depend on is untouched. The worker bundle picks up
nothing but the changelog lines.

- **Status rail in the header**: database / local scraper / git / newest branch, filled from the
  existing `status()` payload, with an `updated Ns ago` stamp. A stale build served on localhost
  reads `warn` there, so you see it before opening the tab. The rail is deliberately not an ARIA
  live region; the toast (`<output>` at the bottom) is the only announced thing.
- **Text zoom**: four steps 100 / 112.5 / 125 / 137.5 percent on the root font size. Because the
  whole page is rem/em — type, padding, tap targets and every media query — this is real zoom, not
  a text-only hack that breaks the grid. Persisted under `scraper4-deployer-text`; both buttons
  carry `aria-label` and take `min-height:var(--tap)`.
- **Tab badges**: counts for the branch list and the command guides, `running` while a job polls,
  and `!` plus a red dot when the scraper serves a stale build. The dot is added and removed by the
  same `badge()` call that writes the text, so it cannot outlive the condition.
- **Loading, empty and error states**: skeleton metric tiles and library cards (shimmer, stilled
  under `prefers-reduced-motion`) with no interactive markup inside them, and toasts in place of
  `alert()`, including one that mirrors a copied command. An empty filter result says so.
- **Filters and folds**: `#branchFilter` re-renders from the cached payload (no extra request),
  `#guideFilter` hides non-matching environment cards, and every long script folds behind
  `toggleCmd` while keeping its `#cmdN` id for the copy/download handlers.
- **Phone manners**: the 5 second poll is skipped while `document.hidden` and resumes on `focus`;
  the job log only auto-scrolls while `#logFollow` is ticked, while the scraper log follows while
  its process is running.
- **Found in the same review**: the environment filter existed but was never wired to
  `filterGuides()`; `updateRail` labelled the third state `bad` while the stylesheet only knew `err`,
  so a stopped scraper rendered a grey dot; and a status payload without `package` threw inside the
  refresh loop instead of falling back.

Guards: `worker-tests/deployer-ui-mobile.test.mjs` pins the markup and stylesheet contract (no px
type, every queried id present, restated `[hidden]` rules), and the new
`worker-tests/deployer-ui-live.test.mjs` executes the page script itself against a parsed DOM so the
rail, badges, zoom steps, filters, toast and follow-up are checked as behaviour, not as strings.

## 1.182.0+ — rebased onto your 1.180.0 + 1.181.0: the redesigned deployer page, plus four Node deltas

Your tree is the base and stays untouched: per-profile indirect routing on Node with route
reporting and the `reconTable` fix (1.180.0), the results-tab render fix, one-at-a-time browsers and
honest browser availability (1.181.0). Your new tests (`results-tab`, `results-suffix`,
`node-source-route`, `browser-slot`) run on this merge as-is.

### Why the number moved

The deployer redesign was first pushed on this branch as `1.181.0+`, and you then released
`1.180.0`/`1.181.0` on the production branch. `numericCore` in `worker-src/deployer-branches.ts`,
which decides "newest branch" in the deployer, compares the numeric core and ignores the `+`, so both
releases read as the same version. Mine is `1.182.0+` now and carries the same content; the `+`
marker on every agent release stays, propagated by `npm run version:sync`.

### Node deltas this branch adds

- `assertAiEndpointUrl` in `render-src/network.ts` and the `aiEndpoint` opt-in in `ApiRequestInit`
  (both `safeFetch` hops and the `/models` probe): an AI base URL you typed yourself may point at
  Ollama on `127.0.0.1:11434`, `host.docker.internal` or a LAN host, while scrape targets keep
  `assertPublicUrl`; http/https only, no URL credentials, `169.254.0.0/16` refused.
- `/api/ai/chat` on Node posts the messages with their roles instead of one flattened prompt, and
  reports the `keyIndex` the `[K۲]` picker selected.
- `productRowFailureHtml` keeps a single broken result in its own warning card instead of dropping
  the whole list, and `openProductModal` says why it cannot open. Your synchronous
  `productSuffixFormats` fix is the base and is untouched; `worker-tests/results-products-ui.test.mjs
  and your `results-tab.test.mjs` both pass against it.
- `LOCAL_SCRAPER_AUTO_UPDATE` and `LOCAL_DEPLOYER_AUTO_UPDATE` also accept `0` / `no` / `off`.

### Deployer page (`scripts/local-deployer-ui.mjs`)

The second round of the redesign, additive on top of the mobile-first 1.178.0+ work: a header status
rail fed from the existing `status()` payload with an `updated Ns ago` stamp, a four-notch text-size
step (100 to 137.5 percent on the root font size, persisted), per-tab count badges with a red
attention dot, shimmer skeletons for loading state, toasts instead of `alert()`, filters for the branch
and environment lists, foldable command scripts, and polling that stops while the tab is hidden.
No route, id or handler changed, and the rail is deliberately not an ARIA live region. Guards:
`worker-tests/deployer-ui-mobile.test.mjs` (markup and stylesheet contract) and
`worker-tests/deployer-ui-live.test.mjs` (behaviour, executing the page script itself against a parsed
DOM with the real `/api/status` shape).

## 1.183.0+ — a version notice that leaves the process, and the deployer inside the hamburger menu

**Rebased onto your `1.182.0`** (`7f6160b`: the three-tab backup/version panel, the Basalam SDK install on
Node, the new library groups and install commands). Their panel, their `productCodeSuffix`, their library
cards and their tests are kept as-is; this branch re-applies on top of them the new drawer section, the
proxy, the notification module, and the per-row guard around the results list — which is defense in depth,
not a duplicate of your fix: yours makes the suffix helper stop throwing, this one keeps one unrenderable
row from blanking the whole list. Because your release number was already `1.182.0`, mine is `1.183.0+`.

- **The scan now tells the operating system.** `scripts/deployer-notify.mjs` picks whichever notifier the
  platform already has (`termux-notification` → `notify-send` → `osascript` → PowerShell toast, or
  `LOCAL_DEPLOYER_NOTIFY_CMD`), and `announceVersions()` fires it whenever a branch is found whose version
  beats the running one, or the current branch moved. Deduplication is per event (`kind:name:version:sha12`
  in `data/.deployer-notices.json`, read back on boot so a watchdog restart cannot re-announce a release the
  user already saw, and movable with `LOCAL_DEPLOYER_NOTIFY_STATE`), so a scanner that runs every minute
  cannot spam the same notice, and a
  failing notifier is recorded rather than thrown — `scanAllBranches()` stays synchronous and never blocks
  on a desktop binary that does not exist. Version comparison ignores the `+` marker on purpose: it is the
  same numeric core `numericCore()` in `worker-src/deployer-branches.ts` uses, so a notice cannot call a
  version new while the branch table calls it equal. Three routes expose it (`GET /api/notifications`,
  `POST /api/notifications/test`, `POST /api/notifications/scan`); when the machine has no notifier the
  deployer page falls back to the browser Notifications API, with a bell in the header that explains the
  permission state instead of failing silently. A custom command may carry its own arguments
  (`sh hook.sh`); the title and body are appended as argv and never handed to a shell.
- **`🚀 دیپلویر محلی` is now a hamburger section.** The dashboard offers the same jobs as the deployer
  page — status read, immediate scan (which announces), install newest, scraper build/restart/stop,
  `npm install`, database, update from git, test notification, open the deployer page — through
  `GET|POST /api/deployer/local/:action` on the Node server, which forwards to `127.0.0.1` so the browser
  never handles a token or a CORS problem. The address comes from `DEPLOYER_UI_TOKEN` + `DEPLOYER_UI_PORT`
  (the pair the deployer already gives an installed scraper) or from `data/.deployer-token`, and replies
  carry `{ deployer: { base, source } }` with the secret stripped. It is an allow-list, not a proxy: only
  the sixteen named calls exist, the branch name is re-validated more strictly than
  `normalizeInstallBranch()` (which accepts `../../../etc` and `-x`), `/api/job` is limited to
  `install|test|build|localBuild|databaseInstall`, a wedged deployer is cut off at 20s, and an unreachable
  one answers 503 with the reason plus the command to run. On Cloudflare and Render the same route answers
  an honest 501 `NO_DEPLOYER`, because those runtimes cannot see a local process. The GitHub branch table
  stays in the version panel (`worker-tests/version-section.test.mjs` pins it there) and the new section
  cross-references it; adding a section also renumbered the positional `menuGroupAt` headings.
- **Guards.** `worker-tests/deployer-notify.test.mjs` (11 tests) spawns the real deployer against a fake
  notifier in a throwaway git repo — 401 without a token, handshake file contents, dedupe, the ledger
  surviving a restart, the no-origin scan returning `sent: []` (the test grabs a free port, so two suites
  can run at once); `worker-tests/deployer-local-panel.test.mjs` (8 tests) checks the
  allow-list, the argument guards, token leakage, and that every button in the new section maps to a handler
  and to a proxied action. `extraction.test.mjs` gained the new drawer title in its ordered list.
