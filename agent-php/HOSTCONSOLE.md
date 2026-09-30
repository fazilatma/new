# اجرای Arena Coding Agent (نسخهٔ PHP) روی هاست‌کنسول

این راهنما مخصوص کنسول شاخهٔ `hostconsole-nvm-node20` (فایل `hostconsole.php`، سوئیت
WebConsole Pro نسخهٔ 2.19.0) است. فایل `hostconsole-project.json` کنار همین سند، یک
«خروجی تنظیمات» آمادهٔ درون‌ریزی است که پروژهٔ `agent-php` را بدون پر کردن دستی فرم
به کنسول اضافه می‌کند.

---

## ۱) درون‌ریزی مستقیم JSON

1. وارد کنسول شوید → تب **⚙️ تنظیمات** → بخش **برون‌ریزی/درون‌ریزی تنظیمات** →
   دکمهٔ **درون‌ریزی (Import)**.
2. محتوای کامل `hostconsole-project.json` را در کادر متن بچسبانید.
3. تیک‌ها:
   - ✅ **پروژه‌ها** (`import_projects`)
   - ❌ تنظیمات عمومی (`import_config`) — تیک نزنید تا تم/دامنهٔ اصلی/توکن‌های
     کنسول دست‌نخورده بمانند.
   - ❌ پروفایل‌های پشتیبان‌گیری.
4. حالت پروژه‌ها را روی **ادغام (merge)** بگذارید، نه جایگزینی؛ در غیر این‌صورت
   پروژه‌های فعلی کنسول پاک می‌شوند.
5. تأیید کنید. پیام «تنظیمات با موفقیت درون‌ریزی شدند» یعنی رکورد پروژه با
   شناسهٔ `agphp` ساخته شد.

معادل همین کار با API کنسول:

```bash
curl -s -X POST 'http://SERVER:8888/hostconsole.php?api=settings.import' \
  -H 'Content-Type: application/json' \
  -b 'wcp_sess=YOUR_SESSION' \
  -d "{\"data\":$(cat hostconsole-project.json),\"import_projects\":true,\"merge_projects\":true}"
```

---

## ۲) بعد از درون‌ریزی

تب **📦 پروژه‌ها** → پروژهٔ «Arena Coding Agent PHP»:

1. **🚀 دیپلوی و به‌روزرسانی** — کلون `fazilatma/new` روی شاخهٔ
   `arena/01a0f16f-new`، کپی فقط پوشهٔ `agent-php`، اجرای `install_cmd`
   (ساخت `data/` و `storage/`، `migrate`، `doctor`).
2. **▶️ شروع سرویس** — `start_cmd` اجرا می‌شود و سرویس ۲۴/۷ زیر نظر کنسول
   می‌ماند (در صورت کرش، خودکار ری‌استارت می‌شود).
3. آدرس: `http://SERVER:8099/` — ورود با `admin` و رمزی که در
   `AGENT_INITIAL_ADMIN_PASSWORD` گذاشته‌اید.

> **حتماً** قبل از اولین دیپلوی، در «ویرایش پروژه» مقدار
> `AGENT_INITIAL_ADMIN_PASSWORD` را عوض کنید و کلید حداقل یک ارائه‌دهنده
> (مثلاً `OPENROUTER_API_KEY`) را وارد کنید. بقیهٔ کلیدها را می‌توانید بعداً از
> خود برنامه در تب «امنیت و تنظیمات» وارد کنید؛ آن‌ها رمزنگاری‌شده در
> `data/environment.json` ذخیره می‌شوند.

---

## ۳) چرا این `start_cmd`؟

```bash
"${PHP_BIN:-php}" bin/console.php migrate
"${PHP_BIN:-php}" bin/worker.php --interval 2 >> storage/worker.log 2>&1 &
exec "${PHP_BIN:-php}" -S "${HOST:-0.0.0.0}:${PORT:-8099}" -t public public/index.php
```

| بخش | دلیل |
|---|---|
| `migrate` در هر استارت | ایدمپوتنت است؛ مهاجرت اسکیمای SQLite بعد از هر به‌روزرسانی خودکار انجام می‌شود. |
| `bin/worker.php &` در پس‌زمینه | کارگر کارهای پس‌زمینه (jobs). چون فرزند همان اسکریپت است، با `توقف سرویس` کنسول (kill روی کل process group) خودش هم می‌میرد. |
| `exec` | سرور PHP جای bash را می‌گیرد تا سیگنال‌های TERM کنسول مستقیم به آن برسد. |
| `${HOST}` و `${PORT}` | کنسول این‌ها را خودش export می‌کند: بدون دامنه `0.0.0.0`، و با دامنهٔ نگاشت‌شده `127.0.0.1`. |
| `PHP_CLI_SERVER_WORKERS=8` | سرور داخلی PHP تک‌نخی است و یک استریم SSE کل سرور را قفل می‌کند. این متغیر (PHP ≥ 7.4) هشت پروسهٔ کارگر fork می‌کند تا چت استریمی و بقیهٔ درخواست‌ها هم‌زمان کار کنند. |
| `PHP_BIN` | اگر `php` پیش‌فرض هاست نسخهٔ قدیمی باشد، فقط همین یک متغیر را به `php8.2` یا مسیر کامل باینری تغییر دهید. برنامه PHP 8.1+ می‌خواهد. |

### اگر Apache/php-fpm ترجیح می‌دهید
به‌جای سرور داخلی، می‌توانید `DocumentRoot` یک ساب‌دامین را مستقیم روی
`<deploy_path>/public` بگذارید و سرویس کنسول را خاموش نگه دارید؛ در آن حالت فقط
کارگر پس‌زمینه را لازم دارید (`is_daemon` را نگه دارید و `start_cmd` را به
`exec "${PHP_BIN:-php}" bin/worker.php --interval 2` تغییر دهید). جزئیات vhost در
`DEPLOYMENT.md` §۲ و §۳ آمده است.

---

## ۴) انتشار روی دامنه (اختیاری)

پورت ۸۰۹۹ از بیرون هاست اشتراکی باز نیست. در «ویرایش پروژه» → بخش دامنه، یا با
تغییر این فیلدها در همان JSON قبل از درون‌ریزی:

```json
"domain_enabled": true,
"domain": "agent.example.com",
"domain_kind": "subdomain",
"domain_mode": "",
"domain_path": "/",
"domain_ws": true,
"domain_https": true,
"domain_timeout": 900
```

یا حالت «پوشه روی دامنهٔ اصلی» (`https://example.com/agent`):

```json
"domain_enabled": true,
"domain": "example.com",
"domain_kind": "path",
"domain_path": "/agent",
"domain_mode": "",
"domain_timeout": 900
```

نکات:

* `domain_timeout: 900` (سقف مجاز کنسول) لازم است؛ پاسخ‌های استریمی عامل ممکن است
  دقایقی طول بکشند و تایم‌اوت پیش‌فرض ۳۰۰ ثانیه وسط کار قطع می‌کند.
* برای SSE بهترین حالت‌ها `htaccess` (mod_proxy) یا `apache`/`nginx`/`cloudflared`
  هستند. حالت `phpproxy` هم چانک‌به‌چانک flush می‌کند و کار می‌کند، ولی کندتر است.
* با فعال‌شدن دامنه، کنسول `HOST` را به `127.0.0.1` تغییر می‌دهد؛ `start_cmd`
  خودش این را می‌خواند و نیازی به دست‌کاری ندارد.
* در حالت «پوشه»، کنسول پیشوند مسیر را حذف و هدر `X-Forwarded-Prefix` را ارسال
  می‌کند. رابط کاربری تک‌صفحه‌ای با مسیرهای نسبی کار می‌کند، اما اگر چیزی ۴۰۴ شد،
  ساب‌دامین را ترجیح دهید.

---

## ۵) ماندگاری داده‌ها هنگام به‌روزرسانی

`preserve_configs: true` باعث می‌شود rsync دیپلوی این‌ها را پاک نکند:

`.git*`, `node_modules`, `.env`, `.env.*`, **`data/`**, **`storage/`**, `uploads/`,
`sessions/`, `logs/`, `db/`, `*.sqlite*`, `*.db`

یعنی `data/agent.db` (گفتگوها، کاربران، چک‌پوینت‌ها)، `data/master.key`،
`data/environment.json` و `storage/workspaces/` سر جای خود می‌مانند. فایل `.env`
هم موقع دیپلوی با مقادیر فعلی + `env` پروژه ادغام و بازنویسی می‌شود، پس هر تغییری
را در فیلد env پروژه بدهید تا پایدار بماند.

اگر `auto_update` را روشن کنید (`proj.toggle_auto_update` یا تیک در فرم)، هر
`auto_update_interval` ثانیه کامیت جدید شاخه چک و خودکار دیپلوی می‌شود.

---

## ۶) پیش‌نیازهای هاست

`php bin/console.php doctor` را از تب ترمینال کنسول در مسیر پروژه بزنید. باید
داشته باشید:

* PHP **8.1+** با اکستنشن‌های `pdo_sqlite`, `curl`, `mbstring`, `json`, `zip`
* `proc_open` **خارج** از `disable_functions` (بدون آن: ترمینال، اجرای کد،
  کارگر پس‌زمینه و Git کار نمی‌کنند)
* `git` روی PATH (برای ابزارهای Git/GitHub عامل)
* `node` — کنسول با `node_version: "20"` مسیر NVM حساب کاربری را به `PATH`
  سرویس اضافه می‌کند (اگر ۲۰ نصب نباشد، جدیدترین نسخهٔ نصب‌شده انتخاب می‌شود)
* `python3` — برای ابزار مرورگر (`scripts/browser_agent.py`) به Playwright هم
  نیاز است: `pip3 install playwright && python3 -m playwright install chromium`

---

## ۷) عیب‌یابی سریع

| نشانه | علت محتمل | راه‌حل |
|---|---|---|
| سرویس مدام ری‌استارت می‌شود | خطای `migrate` یا نبود `pdo_sqlite` | لاگ سرویس در تب پروژه‌ها → دکمهٔ لاگ |
| صفحه باز می‌شود ولی چت استریم نمی‌شود | بافر شدن SSE | `PHP_CLI_SERVER_WORKERS` باید ست باشد؛ در حالت دامنه، mode را `htaccess`/`nginx` کنید و `domain_timeout=900` |
| «Permission denied» روی `data/` | مالکیت پوشهٔ استقرار | تب پروژه‌ها → «ذخیره‌سازی» → اصلاح دسترسی، یا `chmod -R 775 data storage` |
| کارها (jobs) اجرا نمی‌شوند | کارگر بالا نیامده | `storage/worker.log` را ببینید؛ `AGENT_WORKER_AUTOSPAWN=true` به‌عنوان تور ایمنی فعال است |
| پورت ۸۰۹۹ اشغال است | سرویس قبلی | `wcp killport 8099` یا تغییر فیلد `port` پروژه |
