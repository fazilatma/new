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
