# محیط آزمایشگاه (Lab)

> **قانون اول توسعه:** پیش از هر تغییر در کد استخراج، ابتدا آزمایشگاه را اجرا
> کن و رفتار فعلی را ببین؛ بعد اصلاح کن و دوباره روی همان آزمایشگاه راستی‌آزمایی
> کن. این چرخه (`reproduce → fix → verify → gate`) روند توسعه را چند برابر
> سریع‌تر می‌کند چون نیازی به سایت زنده، Termux یا Cloudflare نیست.

آزمایشگاه روی همین repository و کاملاً آفلاین کار می‌کند: صفحه‌های نمونه
(fixture) + باندل واقعی هر دو موتور (Worker و Render) + یک پروب تعاملی که
خروجی هر دو را کنار هم چاپ می‌کند.

## اجرای سریع

```bash
cd cloudflare-scraper4

# ۱. پروب تعاملی: رفتار هر دو موتور روی یک فیکسچر (حدود ۲ ثانیه)
node scripts/lab-probe.mjs patris-cards.html
node scripts/lab-probe.mjs tw-cards.html
node scripts/lab-probe.mjs --file /tmp/shop-page.html --base https://shop.example/

# ۲. آزمایشگاه سرویس: دیپلویر + بیلدها + سیم‌کشی نسخه (زیر ۵ ثانیه)
node scripts/lab-service.mjs

# ۳. تست‌های موتور (سریع، فقط همین فایل)
node --test worker-tests/engine-diagnosis.test.mjs

# ۴. گیت کامل (نسخه + تایپ‌چک + بیلدها + همهٔ تست‌ها) — باید سبز باشد
npm test
```

## اجزا

| جزء | مسیر | نقش |
|---|---|---|
| پروب تعاملی | `scripts/lab-probe.mjs` | باندل هر دو twin، اجرای discovery/heuristic/next_data/script_json/selector/diagnosis و چاپ یک گزارش فشرده |
| آزمایشگاه سرویس | `scripts/lab-service.mjs` | راستی‌آزمایی آفلاین دیپلویر، تازگی بیلدها، نسخه و گیت مرورگر |
| فیکسچرها | `worker-tests/fixtures/*.html` | صفحه‌های نمونهٔ فروشگاه‌ها (جدول زیر) |
| تست موتورها | `worker-tests/engine-diagnosis.test.mjs` | قفل رفتار discovery، استخراج و diagnosis روی هر دو twin |
| تست استخراج | `worker-tests/extraction.test.mjs` | جزئیات استخراج Worker (قیمت فارسی، لینک‌ها، گالری، …) |
| رگرسیون | `worker-tests/regression.test.mjs` | رفتارهای deployer، داشبورد و مسیرهای نصب |
| همگامی نسخه | `worker-tests/version-sync.test.mjs` | تک‌مرجع بودن نسخه + رتبه‌بندی بنچمارک + قراردادهای `server.ts` |
| گیت | `npm test` | `version:check` ← `worker:typecheck` ← `worker:build` ← `render:build` ← همهٔ تست‌ها |

فیکسچرهای موجود:

| فیکسچر | چه چیزی را پوشش می‌دهد |
|---|---|
| `emalls-500-cards.html` | ۵۰۰ محصول یکتا؛ آزمون parser هر دو موتور و پنج دستهٔ صدتایی با تأخیر و DOM مجازی در تست جمع‌آور (بدون Chromium واقعی) |
| `patris-cards.html` | کارت‌های فارسی با قیمت تطویل‌دار (`تومــانـ`)، لینک دسته داخل کارت، نویز سایز/تعداد |
| `tw-cards.html` | کارت‌های obfuscated با کلاس‌های بی‌معنی و جدایی لینک مدیا/عنوان |
| `tw-deep-cards.html` | کارت عمیق که قیمت بیرون زیردرخت مدیا نشسته است |
| `list-fa.html` | گرید ووکامرسی (`li.product`) با تنوع تصویر و لینک |
| `detail-fa.html` | صفحهٔ جزئیات (برند، موجودی، توضیحات، گالری) |
| `jsonld-list.html` | کاتالوگ `ItemList` در JSON-LD |
| `next-data.html` | کاتالوگ داخل `__NEXT_DATA__` |

## آزمایشگاه سرویس (دیپلویر + اسکریپر)

فایل‌های سرویسی هم در آزمایشگاه‌اند و `scripts/lab-service.mjs` (یا
`npm run lab:service`) آن‌ها را آفلاین راستی‌آزمایی می‌کند:

- سلامت نحوی `scripts/local-deployer-ui.mjs` و نگهبان‌هایش (آزادسازی پورت
  stale، نصب‌های Termux-aware، تشخیص بیلد stale روی پورت + دکمهٔ Rebuild
  & restart، جست‌وجوی cmdline هنگام نابینایی جدول سوکت + یک retry روی
  EADDRINUSE؛ هوک آزمایشگاه: `DEPLOYER_PORT_SCAN_BLIND=1`)،
- تازگی بیلد رندر (`render-dist/server.js` نسبت به `render-src/`)،
- هم‌خوانی باندل کامیت‌شدهٔ `scraper4.worker.js` با نسخهٔ `package.json`،
- سبز بودن `version:check` و حضور دارا بودن گیت مرورگر در بنچمارک.

## افزودن فروشگاه جدید به آزمایشگاه (وقتی گزارش میدانی می‌رسد)

1. HTML همان صفحهٔ فهرست را ذخیره کن (view-source در مرورگر کافی است) و یک
   نسخهٔ خلاصه‌شده (چند کارت + اسکریپت‌ها + متاها) در
   `worker-tests/fixtures/<shop>-cards.html` بگذار. برای فروشگاه
   جاوااسکریپتی که view-source پوستهٔ خالی است، با
   `SCRAPER4_DUMP_RENDERED_DIR` رندر مرورگری را روی دستگاه کاربر ذخیره کن
   (لاگ همان‌جا سلکتورهای پیشنهادی روی رندر را هم چاپ می‌کند).
2. `node scripts/lab-probe.mjs <shop>-cards.html` را اجرا کن و خرابی گزارش‌شده
   را بازتولید کن (مثلاً `heuristic: 0 products` یا `priceHints: 0`)؛ با
   `--selectors '{...}'` سلکتورهای پروفایل گزارش‌شده را هم تزریق کن و با
   `--python` خروجی Node را با پایپ‌لاین پایتون (`py-auto-extract`) مقایسه کن.
   سلکتور XPath چسبانده‌شده از DevTools را همان‌طور تزریق کن: هر دو twin
   آن را به CSS تبدیل می‌کنند و پایتون هم با lxml مستقیم می‌خواندش.
3. اصلاح را **روی هر دو twin** انجام بده (`worker-src/scraper.ts` و
   `render-src/scraper.ts`) و دوباره پروب بگیر تا خروجی کامل شود.
4. رفتار درست را در یک فایل تست تازه (`worker-tests/<shop>-report.test.mjs`)
   قفل کن (استخراج + discovery + سیگنال‌های diagnosis، روی هر دو twin)؛
   اگر پایتون+bs4 در دسترس بود، همان فایل کراس‌چک `py-auto-extract` را هم
   اجرا می‌کند وگرنه skip می‌شود.
5. `npm test` را سبز کن، بعد commit و push.

## قراردادهای twinها (خواندن اجباری)

- هر اصلاح استخراج باید آینه‌ای روی هر دو twin اعمال شود؛ تست سطحیِ
  «both twins export the diagnosis surface» همین را قفل می‌کند.
- نام‌ها لزوماً یکسان نیستند: استخراج heuristic در Worker تابع
  `extractHeuristicProducts` (async) و در Render تابع `heuristicProducts`
  (sync) است؛ پروب هر دو را صدا می‌زند.
- خروجی‌ها ممکن است در جزئیات ظاهری فرق کنند (مثلاً نرمال‌سازی ارقام در
  `priceText`) ولی `price` عددی و شمارش‌ها باید برابر باشند.

## محدودیت‌های آفلاین (چرا بعضی چیزها در آزمایشگاه نیستند)

- سندباکس/CI اینترنت خروجی ندارد؛ هرگز برای تست به سایت زنده تکیه نکن —
  فیکسچر تنها ورودی معتبر است.
- twin رندر گارد SSRF دارد و `localhost` را هم رد می‌کند؛ حلقهٔ موتور
  (`scrapeListWithMeta`) فقط با باندل رندر + پلاگین esbuild که `./network.js`
  را با `safeText` استاب عوض می‌کند تست می‌شود (نمونه:
  `barfbox-report.test.mjs`)، نه با سرور محلی.
- گیت موتورهای مرورگر (`browserEngineAvailable`) بدون مرورگر واقعی هم قابل
  پروب است: با `BROWSER_EXECUTABLE_PATH` ساختگی، خطا باید «تلاش برای اجرا»
  باشد نه پیام «مرورگر پیدا نشد».

## دستورالعمل نشست‌های بعدی آرنا

- هر درخواستِ «موتور X روی فروشگاه Y کار نمی‌کند» باید با همین چرخه انجام
  شود: فیکسچر → پروب (خرابی) → اصلاح هر دو twin → پروب (سلامتی) → تست جدید →
  گیت سبز → commit روی همان برنچ نشست.
- اگر سناریوی جدیدی لازم شد، اول فیکسچرش را به همین پوشه اضافه کن تا برای
  همیشه بخشی از آزمایشگاه بماند.
- جزئیات بیشتر قراردادهای ایجنت در فایل `AGENTS.md` در ریشهٔ repository است.

## No-pagination compatibility (1.207.0+)

Compared against release 1.180.0, commit `42e7fd6`. Node uses its normal
engine pipeline with an unchanged URL, the configured page limit and the
existing empty/no-new-products stopping rules. Worker retains its original
single-URL behavior. Explicit `scroll` remains separate. This is not proof
of infinite-scroll completeness; no missing-product retirement is enabled
for Node same-URL repetitions. The legacy browser pipeline does not guarantee
Worker-proxied browser traffic; diagnostics and job logs warn when relevant.
`worker-tests/no-pagination-180.test.mjs` exercises the production Node loop
with five fresh batches of 100, followed by a duplicate batch, and pins the
Worker/UI behavior. The visual-selector blank-page issue is not fixed here.
