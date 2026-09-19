# Python Scraper 4 — با ظاهر و امکانات پروژهٔ Node.js

این پوشه پروژهٔ **اسکرپر پایتون** است که از مخزن `fazilatma/amphp`، برنچ
`arena/01a06ac3-amphp` آورده شده و ظاهر و امکانات آن با پروژهٔ **Node.js**
(`cloudflare-scraper4` در برنچ `arena/01a0aa17-new`) یکسان شده است.

## منبع فایل‌ها

| فایل | منبع |
| --- | --- |
| `scraper4.py` (نسخه ۱۰.۱۴۹) | `fazilatma/amphp` @ `arena/01a06ac3-amphp` |
| `deployer4.py`, `run_scraper4.sh`, `setup_deployer4.sh` | همان برنچ |
| `install_pythonanywhere.sh`, `deploy/`, `tools/vps-live/` | همان برنچ |
| `requirements.txt` | برنچ `arena/01a0afa2-new` همین مخزن |
| `ui/dashboard.html`, `ui/dashboard.js` | استخراج‌شده از `cloudflare-scraper4/worker-src/dashboard.ts` |
| `ui_bridge.py` | **جدید** — لایهٔ سازگاری بین داشبورد Node و بک‌اند پایتون |

## ظاهر

فایل `worker-src/dashboard.ts` پروژهٔ Node دو رشتهٔ بزرگ دارد: `DASHBOARD`
(کل HTML و CSS) و `DASHBOARD_JS` (اسکریپت کلاینت). این دو **عیناً** و بدون
هیچ تغییری در `ui/dashboard.html` و `ui/dashboard.js` ذخیره شده‌اند. بنابراین
نوار بالا، کشوی تنظیمات (drawer)، شش تب پایین، رنگ‌ها، فونت و همهٔ متن‌های
فارسی دقیقاً مثل پروژهٔ Node است.

| مسیر | توضیح |
| --- | --- |
| `/ui` | داشبورد جدید (ظاهر Node) |
| `/` | رابط کلاسیک پایتون — دست‌نخورده باقی مانده |

## امکانات

`ui_bridge.py` حدود ۹۵ اندپوینتی را که داشبورد Node صدا می‌زند روی Flask ثبت
می‌کند و آن‌ها را به مدل دادهٔ پایتون نگاشت می‌دهد:

* **پروفایل‌ها** — `GET/POST /api/profiles`، حذف، محصولات، خروجی CSV.
  تبدیل دوطرفهٔ بدون تلفات بین `Profile` نود و شمای پایتون انجام می‌شود
  (`detailImage` ↔ `detail_selectors.image`، `query_page` ↔ `query`،
  `priceMode/priceValue` ↔ `profile_rules` و …).
* **اجرا** — `/api/profiles/<id>/scrape|run|extract` همان
  `scrape_live_worker` پایتون را اجرا می‌کند؛ `/sync` به
  `start_profile_dispatch` وصل است.
* **صف و کارها** — وظایف زندهٔ پایتون (`LIVE_TASKS`) به شکل `Job` نود
  ترجمه می‌شوند تا تب «درون‌ریزی» و نوار فعالیت کار کند.
* **اتصال‌ها و تنظیمات** — ووکامرس، باسلام و هوش مصنوعی؛ کلیدهای محرمانه
  به‌صورت `***` برگردانده می‌شوند و فقط در صورت ارسال مقدار تازه بازنویسی
  می‌شوند.
* **ابزار سلکتور** — تست سلکتور، پیشنهاد خودکار، تست منبع.
* **پشتیبان** — خروجی/ورودی تنظیمات و درون‌ریزی پروفایل‌های PHP.

هر دو رابط روی **یک فایل داده** (`scraper4_data.json`) کار می‌کنند و هرکدام
شمای بومی خودش را می‌بیند، پس می‌توان بین `/` و `/ui` جابه‌جا شد.

پنل‌های اختیاری‌ای که بک‌اند پایتون معادلی برایشان ندارد (عامل هوشمند،
جدول امتیاز AI، push نوتیفیکیشن و …) پاسخ خالی معتبر می‌دهند تا رابط بدون
خطا بالا بیاید.

## اجرا

```bash
cd python-scraper4
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
PORT=8080 .venv/bin/python scraper4.py
```

سپس `http://localhost:8080/ui` را باز کنید.

برای نصب روی سرور (VPS، systemd، Apache/Nginx با پیشوند `/put/`) راهنمای
کامل در **[INSTALL.md](INSTALL.md)** است.

> هنگام انتقال به سرور، `scraper4.py` و `ui_bridge.py` و پوشهٔ `ui/` باید
> **کنار هم** کپی شوند؛ در غیر این صورت داشبورد جدید بالا نمی‌آید و فقط
> رابط کلاسیک کار می‌کند.
