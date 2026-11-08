# اسکریپر — پورت PythonAnywhere

> **نصب بدون توکن از نسخهٔ ۱.۲ (در نسخهٔ ۱.۳ نیز حفظ شده):** نصب پیش‌فرض **بدون درخواست یا استفاده از توکن PythonAnywhere** تمام می‌شود.
> پس از ورود با رمز پنل، از لینک «توکن PythonAnywhere» در بالای صفحه، اطلاعات را ذخیره، تست و Task را فعال کنید.
> بخش‌های قدیمی دربارهٔ دریافت توکن در ترمینال فقط حالت اختیاری `S4_AUTO_CONFIGURE=1` را توضیح می‌دهند.
> راهنمای کامل فرم و اندپوینت‌های جدید در بخش «نسخهٔ ۱.۲» در انتهای همین فایل است.

پورت مستقل Python 3.10+ / Flask / SQLite بر مبنای آخرین کامیت بررسی‌شدهٔ شاخهٔ
`arena/01a0ebf7-new`:

```
5aa1012d767a1b9f9a9ca43064c7fc3dc35976d3
```

نسخهٔ مبنا در تاریخ ۲۰۲۶-۱۱-۰۸ با `git ls-remote` بررسی شد؛ مشخصات در `SOURCE.json` است.
تغییرات این پورت روی شاخهٔ کاری `arena/f3d5d2a0-new` قرار دارند؛ فایل‌های قبلی ریشهٔ مخزن دست‌نخورده‌اند.
**نصب‌کنندهٔ ریشهٔ مخزن (`install.sh`) مربوط به WebConsole است؛ برای این برنامه فقط `pythonanywhere/install.sh` را اجرا کنید.**

## وضعیت و دامنهٔ پورت

این نسخه **هستهٔ قابل‌اجرای اسکریپر** را پورت می‌کند، نه تمام امکانات فایل بزرگ `scraper4.php`.

| بخش | وضعیت |
| --- | --- |
| پنل فارسی RTL، ورود با رمز، CSRF، خروج | پیاده‌سازی شده |
| ایجاد/ویرایش/حذف پروفایل، سلکتور CSS | پیاده‌سازی شده |
| صفحه‌بندی query/path/full-pattern/next-selector | پیاده‌سازی و تست شده |
| استخراج عنوان، قیمت، لینک، تصویر، SKU | پیاده‌سازی و تست محلی |
| حالت خودکار | امتیازدهی کارت و پیمایش لینک جزئیات مطابق PHP، سپس JSON-LD و microdata؛ آداپترهای اختصاصی سایت‌ها هنوز کامل نیستند |
| صف، مکث/ادامه/لغو، ذخیرهٔ پیشرفت، بازیابی پس از قطع | پیاده‌سازی شده؛ اجرا با CLI/Tasks نه پردازش پس‌زمینهٔ وب |
| خروجی CSV و JSON، ورود اطلاعات قدیمی | پیاده‌سازی و تست شده |
| ووکامرس | REST client و صف ایجاد/به‌روزرسانی؛ ارسال پیش‌فرض به حالت draft |
| باسلام | REST client و صف پایه؛ تصویر/وزن/موجودی/فیلدهای الزامی بعضی دسته‌ها در صف نگاشت نشده‌اند |
| کلاینت دسته‌ها، بارگذاری تصویر، پیام باسلام | متد سرویس موجود؛ رابط پنل/گردش‌کار کامل ندارد |
| JS rendering | اتصال به renderer بیرونی؛ مرورگر یا سرویس Node در این بسته اجرا نمی‌شود |
| proxy/worker HTTP | پشتیبانی می‌شود؛ تابع محدودیت شبکهٔ حساب |
| DNS pinning / DoH | عمداً پشتیبانی نمی‌شود؛ راه دورزدن محدودیت PythonAnywhere نیست |
| همهٔ ابزارها/ویرایشگرها/اتوماسیون‌های نسخهٔ PHP | کامل پورت نشده‌اند |

تست محلی معادل تست واقعی فروشگاه یا استقرار در حساب PythonAnywhere نیست. اتصال عملی به
ووکامرس، باسلام و سایت مقصد بدون حساب/توکن شما بررسی نشده است. ارسال باسلام ممکن است تا
تکمیل فیلدهای الزامی توسط API مقصد رد شود. مبالغ بدون تبدیل خودکار ریال/تومان ارسال می‌شوند؛
پیش از ارسال انبوه، واحد پول و نگاشت دسته را بررسی کنید.

## نصب مستقیم با curl و bash (پیشنهادی)

در **Bash console** حساب PythonAnywhere اجرا کنید:

```bash
set -o pipefail
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh | bash
```

این دستور کل بستهٔ پورت را از شاخهٔ حاوی نسخهٔ Python دریافت و در
`~/scraper4-python/pythonanywhere` نصب می‌کند؛ آپلود ZIP لازم نیست.
رمز پنل در نصب اول در ترمینال نمایش داده می‌شود. مراحل نهایی **Web / WSGI** و **Tasks**
در انتهای نصب چاپ می‌شوند و در ادامهٔ این راهنما آمده‌اند.

اگر حساب شما Python 3.12 دارد:

```bash
set -o pipefail
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh | PYTHON_BIN=python3.12 bash
```

مسیر دلخواه:

```bash
set -o pipefail
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh | \
  S4_INSTALL_DIR="$HOME/scraper4-python/pythonanywhere" \
  S4_VENV="$HOME/.virtualenvs/scraper4" bash
```

اجرای دوباره فایل‌های کد را به‌روزرسانی می‌کند، `.env` و داده‌ها را حفظ می‌کند و پیش از ارتقا
یک پشتیبان SQLite در `~/scraper4-backups` می‌گیرد. قبل از ارتقا worker/Tasks را متوقف کنید؛
پس از نصب مجدد Web را Reload کنید. نصب‌کننده از بازنویسی پوشهٔ نامرتبط خودداری می‌کند.

این دستور اسکریپت شاخهٔ فعلی GitHub را اجرا می‌کند؛ برای بررسی پیش از اجرا می‌توانید آن را
ابتدا با `curl -fL -o bootstrap.sh URL` دانلود، مطالعه و سپس با `bash bootstrap.sh` اجرا کنید.
دسترسی حساب به `raw.githubusercontent.com`، `codeload.github.com` و مخزن بسته‌های Python لازم است.
اگر شبکهٔ حساب دانلود را مسدود کرد، از روش ZIP زیر استفاده کنید.

## ۱. نصب از بستهٔ دانلودی — روش جایگزین

بستهٔ `scraper4-pythonanywhere.zip` را دانلود کنید. در **Files** حساب PythonAnywhere آن را
در پوشهٔ خانه (`/home/USERNAME`) بارگذاری کنید. سپس یک **Bash console** باز کنید:

```bash
cd "$HOME"
unzip scraper4-pythonanywhere.zip -d scraper4-python
cd "$HOME/scraper4-python/pythonanywhere"
bash install.sh
```

اگر نام پوشه قبلاً وجود دارد، برای نصب تازه پوشهٔ دیگری انتخاب کنید؛ برای ارتقا ابتدا backup بگیرید.

نصب‌کننده:

- virtualenv در `~/.virtualenvs/scraper4` می‌سازد؛ نیازی به sudo یا PHP نیست.
- وابستگی‌ها را نصب و `.env` با مجوز `600` ایجاد می‌کند.
- رمز قوی پنل را **فقط در نصب اول در ترمینال** نمایش می‌دهد و هش آن را ذخیره می‌کند.
- کلید رمزنگاری پایدار تولید می‌کند؛ اجرای دوباره، رمز/دادهٔ موجود را پاک نمی‌کند.
- دیتابیس را می‌سازد، selftest اجرا می‌کند و فایل آمادهٔ WSGI را تولید می‌کند.
- فایل WSGI وب‌سایت‌های دیگر شما را خودکار بازنویسی نمی‌کند.

هلپر اکنون نسخهٔ نصب‌شده را خودکار تشخیص می‌دهد (Python 3.10 یا جدیدتر) و محیط مجازی موجودِ سازگار را حفظ می‌کند. اگر لازم بود، مفسر را صریحاً مشخص کنید:

```bash
PYTHON_BIN=python3.12 bash install.sh
```

همان نسخه را در Web انتخاب کنید. مسیر دلخواه محیط مجازی نیز ممکن است:

```bash
S4_VENV="$HOME/.virtualenvs/scraper4" PYTHON_BIN=python3.11 bash install.sh
```

> بستهٔ دانلودی مستقل است. دستور clone کردن شاخهٔ مبنای PHP این پورت را نصب نمی‌کند.
> اگر تغییرات پورت را در GitHub منتشر کردید، باید شاخهٔ حاوی پوشهٔ `pythonanywhere` را clone کنید،
> نه شاخهٔ مبنای `arena/01a0ebf7-new`.

## ۲. راه‌اندازی Web / WSGI

1. **Web → Add a new web app → Manual configuration**.
2. نسخهٔ Python را مطابق نصب‌کننده انتخاب کنید.
3. در **Virtualenv** مسیر زیر را قرار دهید:
   `/home/USERNAME/.virtualenvs/scraper4`
4. **Source code** و **Working directory**:
   `/home/USERNAME/scraper4-python/pythonanywhere`
5. فایل **WSGI configuration file** معرفی‌شده در Web را باز کنید؛ تمام محتوای پیش‌فرض
   (از جمله `application` نمونه) را با محتوای فایل تولیدشدهٔ زیر جایگزین کنید:
   `/home/USERNAME/scraper4-python/pythonanywhere/pythonanywhere_wsgi.py`
6. **Reload** بزنید، سپس آدرس HTTPS وب‌اپ را باز کنید و با رمز نمایش‌داده‌شده وارد شوید.

فایل تولیدشده از نظر ساختار شبیه این است؛ مسیر واقعی را نصب‌کننده می‌نویسد:

```python
import sys
APP_DIR = '/home/USERNAME/scraper4-python/pythonanywhere'
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
from scraper4 import create_app
application = create_app()
```

CSS و JS توسط Flask سرو می‌شوند؛ تنظیم Static files اختیاری است.
برای استقرار PythonAnywhere به اجرای `flask run`، `serve`، پورت عمومی، Node یا daemon نیازی نیست.

## ۳. اجرای صف — ضروری

افزودن کار از پنل فقط آن را ذخیره می‌کند. برای اجرای صف، این فرمان را در کنسول اجرا کنید:

```bash
cd "$HOME/scraper4-python/pythonanywhere" && \
  "$HOME/.virtualenvs/scraper4/bin/python" -m scraper4 tick --budget 240
```

همین فرمان را در **Tasks** به‌عنوان Scheduled Task با تناوب مجاز حساب خود قرار دهید.
قابلیت و فاصلهٔ اجرای Task را پلن حساب تعیین می‌کند. این بسته نیازمند سرویس دائمی نیست.
در نبود Task، هر بار فرمان بالا را دستی اجرا کنید. Reload وب‌اپ به‌تنهایی صف را اجرا نمی‌کند.

کارهای طولانی پس از پایان بودجهٔ زمانی، در مرز صفحه/محصول ذخیره می‌شوند و اجرای بعدی آن‌ها
را ادامه می‌دهد. بودجه سقف سخت سیستم‌عامل نیست؛ یک درخواست شبکهٔ درحال‌اجرا ممکن است تا timeout
از آن عبور کند. در هر زمان فقط یک worker با قفل فایل مجاز است؛ claim صف نیز تراکنشی است.
مکث/لغو در مرز عملیات اعمال می‌شود، نه وسط درخواست HTTP.

کار استخراج نیمه‌کاره بعد از `S4_WORKER_STALE_SECONDS` بازیابی می‌شود. ارسال نیمه‌کاره به
فروشگاه برای جلوگیری از ایجاد تکراری **مکث می‌شود**: محصول مقصد را بررسی و سپس از پنل ادامه دهید.
اگر فرایند دقیقاً پس از ایجاد محصول در مقصد و پیش از ثبت شناسه قطع شود، تضمین exactly-once
وجود ندارد؛ قبل از ادامه، رکورد مقصد و شناسهٔ محلی را تطبیق دهید. ارسال ناموفق خودکار تکرار نمی‌شود.
محصولات غایب از استخراج جدید خودکار از دیتابیس/فروشگاه حذف نمی‌شوند.

## ۴. انتقال اطلاعات نسخهٔ قبلی

فایل‌های `profiles.json` و `connections.json` را در پوشهٔ جداگانه‌ای مانند `~/scraper-legacy`
بارگذاری کنید. سپس:

```bash
cd "$HOME/scraper4-python/pythonanywhere"
"$HOME/.virtualenvs/scraper4/bin/python" -m scraper4 import-legacy --dir "$HOME/scraper-legacy"
```

ورودی مطابق قرارداد import لاراول است: profiles یک object با کلید پروفایل و مقادیر
`url`, `name`, `selectors`, `pagType`, `pagVal`, `products` است؛ connections یک object
از بخش‌های تنظیمات است. فایل‌های ورودی تغییر نمی‌کنند و تکرار import روی کلیدهای یکسان
رکورد تکراری نمی‌سازد. قالب خاص/سفارشی دیگر باید پیش از ورود تبدیل شود.

مقادیر رمز‌شدهٔ لاراول با `APP_KEY` مستقیماً قابل‌خواندن نیستند؛ اتصال‌ها را از JSON قدیمی خام
وارد یا در پنل دوباره ثبت کنید. نام‌های `woo`/`bsl` به `woocommerce`/`basalam` تبدیل می‌شوند؛
نام فیلدهای مورد انتظار در `.env.example`/فرم اتصال و کد کلاینت مشخص است. صف‌ها و فرایندهای
نیمه‌کارهٔ PHP خودکار وارد نمی‌شوند؛ بعد از تطبیق محصولات مقصد، کار جدید بسازید.

## ۵. محدودیت شبکه و رندر JS

- حساب رایگان PythonAnywhere برای اتصال خروجی به همهٔ سایت‌ها مناسب نیست؛ allowlist/پلن
  حساب تعیین‌کننده است. خطای 403 از proxy ممکن است محدودیت حساب باشد، نه خرابی parser.
- برنامه متغیرهای استاندارد `HTTP_PROXY` / `HTTPS_PROXY` پلتفرم را حفظ می‌کند.
- هیچ تنظیم proxy/DNS در این پورت تضمینی برای رفع محدودیت پلتفرم ندارد.
- TLS verification روشن است. سایت‌های با گواهی نامعتبر پذیرفته نمی‌شوند.
- صفحه‌های Cloudflare challenge/CAPTCHA به سرویس/دسترسی مجاز جدا نیاز دارند؛ تضمین عبور وجود ندارد.
- برای سایت‌های وابسته به JS، یک renderer بیرونیِ در دسترس حساب لازم است:

```dotenv
SCRAPER_RENDER_URL=https://your-renderer.example
SCRAPER_RENDER_TOKEN=your-private-token
```

قرارداد: `POST /render` با JSON شامل `url`, `waitUntil`, `timeout`, `scroll` و پاسخ
`{"ok":true,"html":"...","url":"https://...","code":200}`؛ سلامت اختیاری `GET /health`.
در حالت `auto` ابتدا HTML ایستا بررسی می‌شود. نبود renderer نباید استخراج ایستا را از کار بیندازد؛
اما ممکن است سایت JS بدون renderer محصولی نداشته باشد. مرورگر/Playwright در بسته نیست.

## ۶. داده، امنیت و پشتیبان

پیش‌فرض‌ها: `.env` برای رازها، `data/scraper4.sqlite3` برای داده و صف.
فایل `.env` و دیتابیس را در Git یا مسیر عمومی Static قرار ندهید.
کلید `S4_SECRET_KEY` را همراه پشتیبان، جدا و امن نگه دارید؛ تغییر آن اتصال‌های رمز‌شده را ناخوانا می‌کند.

```bash
cd "$HOME/scraper4-python/pythonanywhere"
"$HOME/.virtualenvs/scraper4/bin/python" -m scraper4 backup \
  --output "$HOME/scraper4-backup-$(date +%Y%m%d-%H%M%S).sqlite3"
```

از SQLite backup API استفاده می‌شود تا WAL نیز درست لحاظ شود. فایل خام دیتابیس زنده را تنها کپی نکنید.
برای ارتقا ابتدا worker را متوقف و backup بگیرید؛ `.env` و `data/` را حفظ کنید، فایل‌های کد را
به‌روزرسانی، `bash install.sh` را دوباره اجرا و Web را Reload کنید.

تغییر رمز بدون نمایش آن در shell history، از پوشهٔ برنامه:

```bash
"$HOME/.virtualenvs/scraper4/bin/python" - <<'PY'
from getpass import getpass
from pathlib import Path
from werkzeug.security import generate_password_hash
password = getpass('New panel password: ')
if len(password) < 12:
    raise SystemExit('Use at least 12 characters')
p = Path('.env')
lines = [line for line in p.read_text().splitlines() if not line.startswith('S4_PASSWORD=')]
p.write_text('\n'.join(lines) + '\nS4_PASSWORD=' + generate_password_hash(password) + '\n')
p.chmod(0o600)
PY
```

پس از تغییر رمز، Web را Reload کنید. نشست‌های قبلی تا انقضا معتبرند؛ برای ابطال فوری همهٔ
نشست‌ها باید مدیریت کلید نشست/ذخیرهٔ نشست جدا اضافه شود؛ `S4_SECRET_KEY` را صرفاً برای خروج کاربران عوض نکنید
چون کلید رمزنگاری اتصال‌ها نیز هست. این پنل تک‌مدیره است، نه سامانهٔ چندکاربره.

## ۷. تست و توسعهٔ محلی

```bash
cd pythonanywhere
python3.11 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q
```

تست‌ها شامل قراردادهای CSS و pagination نسخهٔ مبنا، parser، encryption، ورود/CSRF، صف تراکنشی،
مکث/بازیابی، cursor ارسال و import تکرارپذیرند. HTTP فروشگاه‌ها در تست‌ها mock است.
نصب تازه و نصب دوبارهٔ helper در محیط تمیز محلی همراه import WSGI نیز بررسی شده است.

برای توسعه روی HTTP محلی (نه PythonAnywhere):

```bash
S4_COOKIE_SECURE=0 .venv/bin/python -m scraper4 serve --port 5000
```

ابتدا `.env` با کلید و رمز معتبر بسازید؛ در محیط واقعی از HTTPS و پیش‌فرض cookie امن استفاده کنید.

### API

همهٔ APIها به ورود نیاز دارند. درخواست‌های تغییردهنده باید هدر `X-CSRF-Token` از نشست همان پنل داشته باشند.

- `GET /api/ping`
- `GET /api/pagination/preview?url=...&type=query_page&pages=3`
- `GET/POST /api/profiles` و `DELETE /api/profiles/<id>`
- `GET /api/products?profile_id=1&limit=100&offset=0`
- `GET /api/export/<profile_id>?format=json`؛ بدون format خروجی CSV
- `GET/POST /api/jobs`؛ ساخت کار با `profile_id`, `kind`, `pages`, `render`
- `GET /api/jobs/<id>`؛ polling به‌جای SSE نسخهٔ PHP
- `POST /api/jobs/<id>/pause|resume|cancel`
- `GET/POST /api/connections/woocommerce|basalam`؛ رازها در پاسخ ماسک می‌شوند

برای عیب‌یابی: لاگ error وب‌اپ در Web را بخوانید، مسیر virtualenv/Python را تطبیق دهید و
`python -m scraper4 selftest` را در پوشهٔ برنامه اجرا کنید. اگر صف waiting مانده، Task اجرا نشده است.

## حالت اختیاری نسخهٔ ۱.۱ — تنظیم Web با API ترمینال، اتوآپدیت و API مدیریت

### نصب/ارتقای خودکار

```bash
set -o pipefail
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh | S4_AUTO_CONFIGURE=1 bash
```

**رفتار حالت اختیاری `S4_AUTO_CONFIGURE=1`:** بعد از نصب بسته، Web، virtualenv، فایل WSGI، Reload و یک Scheduled Task
از طریق API رسمی PythonAnywhere تنظیم می‌شوند. مراحل دستی Web که بالاتر آمده‌اند فقط برای
نصب با ZIP/حالت بدون API باقی مانده‌اند.

پیش‌نیاز یک‌باره: در **Account → API Token** حساب PythonAnywhere توکن بسازید. اگر `API_TOKEN`
در محیط کنسول موجود باشد، هلپر خودکار آن را می‌خواند؛ در غیر این صورت فقط در ترمینال محلی
(`/dev/tty`، بدون نمایش توکن) از شما می‌گیرد. توکن را در چت، URL، کد یا Git قرار ندهید.
تنظیمات اتصال به API در دیتابیس به‌صورت رمز‌شده با `S4_SECRET_KEY` نگهداری می‌شود.

- دو API host رسمی `www.pythonanywhere.com` و `eu.pythonanywhere.com` پشتیبانی می‌شوند.
- دامنه و نام کاربری پیش‌فرض از حساب تعیین می‌شوند؛ در ورود تعاملی توکن می‌توانید اصلاحشان کنید.
- نصب‌کننده هیچ وب‌اپ یا Task نامرتبط را حذف نمی‌کند. اگر دامنهٔ موجود متعلق به پوشهٔ دیگری باشد،
  برای جلوگیری از ازکارافتادن سایت دیگر، تنظیم آن متوقف می‌شود. فقط با رضایت صریح، از پوشهٔ برنامه اجرا کنید:
  `~/.virtualenvs/scraper4/bin/python -m scraper4 configure --replace-existing`.
- نسخهٔ Python وب‌اپ موجود باید با virtualenv یکی باشد؛ تغییر مفسر وب‌اپ موجود خودکار انجام نمی‌شود.
- تکرار تنظیمات Task شناخته‌شدهٔ همین برنامه را به‌روزرسانی می‌کند، نه اینکه هر بار Task جدید بسازد.
- Task پیش‌فرض ساعتی در دقیقهٔ ۷ است؛ اگر API زمان‌بندی ساعتی را با HTTP 400 رد کند، روزانه
  ساعت ۰۳:۰۷ UTC امتحان می‌شود. quota یا محدودیت‌های API/پلن قابل دورزدن نیستند.
- اگر account policy/expiry مانع فعال‌سازی Task شود، هلپر خطا می‌دهد؛ بدون Task فعال نمی‌توان
  اجرای دوره‌ای یا حذف کامل کار دستی را تضمین کرد. این کد برای API وب‌اپ‌های کلاسیک WSGI است.

برای حسابی که **قبلاً این برنامه را نصب کرده**، اجرای دوبارهٔ همان دستور curl کافی است؛
پس از یک‌بار تنظیم API، دیگر برای آپدیت معمول به کنسول یا Reload دستی نیاز نیست.
برای نصب محلی یا صرفاً دریافت فایل‌ها بدون API:

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh | S4_AUTO_CONFIGURE=0 bash
```

### اتوآپدیت چگونه اجرا می‌شود؟

فرمان Task جدید:

```bash
cd "$HOME/scraper4-python/pythonanywhere" && \
  "$HOME/.virtualenvs/scraper4/bin/python" -m scraper4 maintain --budget 240
```

در هر نوبت، ابتدا درخواست‌های مدیریت/نسخهٔ جدید بررسی و سپس worker در یک فرایند تازه اجرا می‌شود.
Task قدیمی همین برنامه با فرمان `tick` در تنظیم خودکار به `maintain` تبدیل می‌شود.

- اتوآپدیت پیش‌فرض روشن و فاصلهٔ بررسی حداقل یک ساعت است؛ تناوب عملی به Task حساب بستگی دارد.
- فقط مخزن ثابت `fazilatma/new` و شاخهٔ `arena/f3d5d2a0-new` مجازند؛ API اجازهٔ تغییر مخزن،
  اجرای shell دلخواه، انتخاب مسیر فایل یا نصب URL دلخواه را نمی‌دهد.
- SHA جدید از GitHub خوانده می‌شود و همان کامیت دقیق دانلود می‌شود تا تغییر شاخه وسط دانلود اثر نگذارد.
- قبل از جایگزینی، کد و SQLite پشتیبان گرفته می‌شوند؛ دو snapshot آخر در `data/releases` نگهداری می‌شوند.
- هنگام جایگزینی، وب maintenance/503 می‌دهد. import، syntax و selftest نسخهٔ جدید در فرایند جدا بررسی می‌شوند.
- `.env`، فایل‌های runtime و داده‌ها بازنویسی نمی‌شوند؛ Git checkout/reset در مسیر نصب اجرا نمی‌شود.
- پس از نصب، API پایتون‌انی‌ور Reload می‌زند. در خطای اعتبارسنجی/Reload، کد قبلی برگردانده می‌شود.
- اگر فرایند وسط نصب قطع شود، اجرای بعدی Task تلاش می‌کند snapshot کد را بازیابی کند.
- rollback فقط کد را برمی‌گرداند، نه دیتابیس زنده یا نسخهٔ وابستگی‌های pip را. نصب وابستگی‌ها تراکنشی نیست.
  نسخه‌های آینده باید schema سازگار داشته باشند؛ migration مخرب بدون طراحی جداگانه مجاز نیست.
- بازگشت نسخه، اتوآپدیت را خاموش می‌کند تا در نوبت بعد دوباره همان نسخه نصب نشود؛ پس از رفع مشکل
  آن را از پنل روشن کنید. پشتیبان SQLite برای بازیابی اضطراری موجود است و خودکار روی دادهٔ زنده restore نمی‌شود.
- با روشن بودن اتوآپدیت، به کد و تغییرات آیندهٔ این شاخه اعتماد می‌کنید. دسترسی نوشتن GitHub را محدود نگه دارید.

وضعیت، خطاها، روشن/خاموش کردن اتوآپدیت و دکمه‌های بررسی/آپدیت/Reload/بازتنظیم/rollback در پنل اضافه شده‌اند.
درخواست‌ها **غیرهمزمان** هستند؛ پاسخ ۲۰۲ به معنی ثبت درخواست است، نه پایان آن. اجرا در نوبت بعدی Task
صورت می‌گیرد، نه بلافاصله در WSGI. API نمی‌تواند بدون scheduler/worker از پیش فعال، خودش را زمان‌بندی کند.

### اندپوینت‌های جدید

| روش | مسیر | کاربرد |
| --- | --- | --- |
| GET | `/healthz` | سلامت عمومی ساده؛ در maintenance پاسخ ۵۰۳ |
| GET | `/api/endpoints` | فهرست تمام مسیرهای API و متدها |
| GET | `/api/system/status` | سلامت، آمار، تنظیم Task و وضعیت عملیات |
| GET | `/api/updates/status` | نسخهٔ نصب‌شده/جدید، تنظیمات و درخواست اخیر |
| POST | `/api/updates/check` | صف بررسی نسخه |
| POST | `/api/updates/apply` | صف نصب آخرین نسخهٔ شاخهٔ ثابت |
| POST | `/api/updates/rollback` | صف بازگشت کد و خاموش کردن اتوآپدیت |
| POST | `/api/updates/config` | `{"enabled":true,"interval_seconds":3600}`؛ بازهٔ مجاز ۳۰۰ تا ۶۰۴۸۰۰ ثانیه |
| POST | `/api/system/reload` | صف Reload وب‌اپ با API پلتفرم |
| POST | `/api/system/configure` | صف بازتنظیم Web/WSGI و Task با اطلاعات ذخیره‌شده |
| POST | `/api/auth/token` | ایجاد/تعویض کلید اتوماسیون، فقط با نشست مرورگر و CSRF |
| DELETE | `/api/auth/token` | ابطال کلید اتوماسیون، فقط با نشست مرورگر و CSRF |

تمام مسیرهای `/api/` به نشست ورود همراه CSRF یا **Bearer token** معتبر نیاز دارند؛ هیچ GETای
کد را آپدیت یا Reload نمی‌کند. برای استفادهٔ بدون مرورگر، یک‌بار از پنل کلید API بسازید و امن نگه دارید.
کلید API با توکن PythonAnywhere فرق دارد، دسترسی کامل مدیر دارد و فقط یک‌بار نمایش داده می‌شود؛
هش آن ذخیره می‌شود و با ساخت کلید تازه، قبلی فوراً باطل می‌شود.

مثال (توکن واقعی را در history ترمینال ننویسید):

```bash
read -rsp 'Application API token: ' S4_API_TOKEN; echo
export S4_API_TOKEN
export S4_APP_URL='https://YOUR-USERNAME.pythonanywhere.com'
curl -fsS -H "Authorization: Bearer $S4_API_TOKEN" "$S4_APP_URL/api/endpoints"
curl -fsS -X POST -H "Authorization: Bearer $S4_API_TOKEN" \
  -H 'Content-Type: application/json' -d '{}' "$S4_APP_URL/api/updates/apply"
curl -fsS -H "Authorization: Bearer $S4_API_TOKEN" "$S4_APP_URL/api/updates/status"
unset S4_API_TOKEN
```

قرارداد API پلتفرم با سورس رسمی
[pythonanywhere-core](https://github.com/pythonanywhere/pythonanywhere-core) بررسی شده است.
تست‌ها API پلتفرم، دانلود و Reload را mock می‌کنند؛ بدون حساب/توکن شما استقرار زنده روی PythonAnywhere
بررسی نشده و محدودیت پلن/شبکهٔ حساب همچنان برقرار است.


### رفع خطای «Python 3.11+ لازم است»

هلپر دیگر به وجود فرمان `python3.11` وابسته نیست: ابتدا محیط مجازی معتبر موجود، سپس `python3`
و فرمان‌های نسخه‌دار ۳.۱۰ تا ۳.۱۴ را بررسی می‌کند. حداقل نسخهٔ پورت اکنون ۳.۱۰ است.
پس از انتشار این اصلاح، همان دستور curl را دوباره اجرا کنید؛ برای حسابی که ۳.۱۰ دارد، می‌توانید
به‌صورت صریح نیز انتخاب کنید:

```bash
set -o pipefail
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh | PYTHON_BIN=python3.10 bash
```

اگر تمام مفسرهای نصب‌شده قدیمی‌تر از ۳.۱۰ باشند، هلپر نسخه‌های پیدا‌شده را نمایش می‌دهد و متوقف می‌شود؛
باید از system image سازگار PythonAnywhere استفاده کنید. محیط مجازی قدیمی حذف یا بی‌صدا بازسازی نمی‌شود.
انتخاب نسخهٔ متفاوت با virtualenv موجود نیز با خطای واضح متوقف می‌شود تا تنظیم وب‌اپ خراب نشود.
تست اجرایی این اصلاح در محیط توسعه با Python 3.11 انجام شده؛ برای ۳.۱۰، سازگاری syntax و حل وابستگی‌ها
نیز بررسی شده‌اند، اما اجرای واقعی حساب شما همچنان به مفسرها و محدودیت‌های همان حساب بستگی دارد.

### رفع خطای PythonAnywhere API HTTP 403 — نسخهٔ ۱.۱.۲

HTTP 403 به‌تنهایی ثابت نمی‌کند توکن اشتباه است؛ ممکن است دسترسی یک عملیات، محدودهٔ API،
نام کاربری/ناحیهٔ اشتباه یا محدودیت حساب/Tasks باشد. پیام جدید مرحلهٔ خطا را بدون افشای
توکن/پاسخ خام مشخص می‌کند: `webapp_read`, `webapp_configure`, `wsgi_upload`,
`webapp_reload`, `task_read`, `task_create`, `task_update`.

برای دریافت اصلاح بدون تلاش دوبارهٔ تنظیم خودکار:

```bash
set -o pipefail
curl -fsSL 'https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh?v=1.1.2' | S4_AUTO_CONFIGURE=0 bash
cd "$HOME/scraper4-python/pythonanywhere"
"$HOME/.virtualenvs/scraper4/bin/python" -m scraper4 diagnose-platform
```

این فرمان فقط سه درخواست GET برای خواندن وب‌اپ‌ها، وب‌اپ هدف و Taskها می‌زند و تغییری در حساب
نمی‌دهد. توکن یا هدرهای درخواست چاپ نمی‌شوند. اگر خواندن Web موفق و Tasks ناموفق باشد،
مسئله را صرفاً به توکن نسبت ندهید. اگر خواندن Task موفق باشد ولی ساخت Task ساعتی با
HTTP 400 یا 403 (به‌جز خطای صریح احراز هویت) رد شود، هلپر زمان‌بندی روزانه را نیز امتحان می‌کند.
این fallback تضمینی برای رفع quota/مجوزهای حساب نیست.

برای واردکردن توکن جایگزین، **فقط در ترمینال خودتان**:

```bash
"$HOME/.virtualenvs/scraper4/bin/python" -m scraper4 configure \
  --replace-existing --reset-api \
  --api-site www.pythonanywhere.com \
  --api-username fazilatma \
  --api-domain fazilatma.pythonanywhere.com
```

گزینه‌های account بالا برای دامنهٔ اعلام‌شده در این جلسه‌اند؛ برای حساب دیگر تغییر دهید.
توکن را از **Account → API Token همان حساب و همان ناحیه** بگیرید. `--reset-api` توکن ذخیره‌شده
و متغیر قدیمی `API_TOKEN` را نادیده می‌گیرد و توکن جدید را پنهان می‌پرسد. پیش از جایگزینی
اطلاعات ذخیره‌شده، یک تست GET انجام می‌شود؛ اگر رد شود تنظیم قبلی باقی می‌ماند.
در اجرای معمول، توکن ذخیره‌شده بر متغیر محیطی اولویت دارد تا محیط قدیمی اصلاح را برنگرداند.
هیچ‌گاه توکن، فایل `.env` یا خروجی دارای Authorization را در چت ارسال نکنید؛ خروجی امن
`diagnose-platform` یا پیام جدید شامل نام مرحله برای عیب‌یابی کافی است.


## نسخهٔ ۱.۲ — نصب بدون توکن و واردکردن آن در وب‌اپ

### نصب

```bash
set -o pipefail
curl -fsSL 'https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh?v=1.2.0' | S4_AUTO_CONFIGURE=0 bash
```

این حالت پیش‌فرض است؛ وجود `API_TOKEN` قدیمی در کنسول هم باعث درخواست یا استفاده از توکن
نمی‌شود. توکن قبلی ذخیره‌شده در دیتابیس حذف نمی‌شود؛ می‌توانید بعداً آن را از پنل عوض یا حذف کنید.
نصب بدون API همچنان virtualenv، وابستگی‌ها، دیتابیس، رمز پنل و فایل آمادهٔ WSGI را می‌سازد.

نصب‌کننده metadata محیط مجازی را در `.runtime.json` محلی با مجوز خصوصی می‌نویسد. این فایل رمز
ندارد و از Git/بستهٔ به‌روزرسانی حذف شده است. WSGI ممکن است `sys.executable` را به uWSGI اشاره دهد؛
برای ساخت فرمان Task از مسیر مطمئن ثبت‌شده توسط نصب‌کننده استفاده می‌شود، نه مفسر احتمالی uWSGI.
از HTTP هیچ مسیر مفسر یا فرمان shell دریافت نمی‌شود.

### بازکردن پنل

- اگر همین برنامه از قبل روی دامنه فعال است، پس از نصب **یک‌بار Web → Reload** بزنید تا فرم جدید بار شود.
- اگر دامنه به برنامه/دایرکتوری دیگری وصل است، بار اول تنظیم virtualenv و فایل WSGI تولیدشده را مطابق
  بخش ۲ انجام دهید و Reload بزنید. بدون API/دسترسی پلتفرم نمی‌توان اتصال اولیهٔ دامنه را خودکار عوض کرد.
- با رمز پنل وارد شوید. لینک **«توکن PythonAnywhere»** بالای صفحه، شما را به صفحهٔ مستقل
`/settings/pythonanywhere` می‌برد. فرم اتصال در پایین داشبورد هم وجود دارد.

### ورود توکن در وب‌اپ

۱. نام کاربری، ناحیهٔ API و دامنه را بررسی کنید؛ برای این حساب:

```
site: www.pythonanywhere.com
username: fazilatma
domain: fazilatma.pythonanywhere.com
```

۲. توکن **Account → API Token** را در فیلد رمز وارد و **ذخیرهٔ توکن** را بزنید.
ذخیره فقط اعتبارسنجی محلی و رمزنگاری در SQLite انجام می‌دهد؛ در این مرحله API خارجی فراخوانی نمی‌شود.
فیلد پس از ذخیره خالی می‌شود و توکن در HTML/GET یا وضعیت سیستم برگردانده نمی‌شود.
برای حفظ توکن قبلی، در ذخیرهٔ بعدی فیلد توکن را خالی بگذارید؛ تغییر حساب/ناحیه به توکن تازه نیاز دارد.

۳. **تست دسترسی** را بزنید: فقط GETهای خواندنی به API پلتفرم انجام می‌شود و نتیجهٔ امن نمایش داده می‌شود.
خطای ۴۰۳ به معنی قطعی توکن نامعتبر نیست؛ نام مرحله و دسترسی Task را بررسی کنید.

۴. **فعال‌سازی Task و اتوآپدیت** را بزنید. این مرحله از خود وب‌اپ، Task همین برنامه را به‌شکل محدود
و زمان‌دار می‌سازد/به‌روزرسانی می‌کند؛ به worker یا Task از قبل موجود وابسته نیست.
این مرحله فایل WSGI را عوض نمی‌کند، وب‌اپ دیگری را جایگزین نمی‌کند، برنامه را Reload نمی‌کند
و worker/آپدیت طولانی را در درخواست وب اجرا نمی‌کند. اجرای واقعی از نوبت بعدی Task آغاز می‌شود.
قابلیت API، quota و تناوب Task تابع پلن حساب است؛ در صورت ردشدن فعال‌سازی، خطا در پنل نمایش داده می‌شود.

بدون توکن، پنل و ثبت پروفایل/محصول/صف کار می‌کنند؛ برای اجرای استخراج باید worker دستی یا Task
از قبل فعال داشته باشید. اتوآپدیت در نبود توکن از شبکه استفاده نمی‌کند و بی‌صدا تلاش احراز هویت نمی‌زند.
حذف توکن از فرم، Task موجود را حذف نمی‌کند؛ worker استخراج می‌تواند ادامه دهد اما آپدیت/Reload خودکار
به توکن نیاز دارد. کلید API اتوماسیون خود اسکریپر با توکن حساب PythonAnywhere متفاوت است.

صفحهٔ مستقل تنظیمات هنگام maintenance نیز برای اصلاح توکن در دسترس مدیر می‌ماند؛
فعال‌سازی Task و اجرای عملیات دیگر در این حالت همچنان مسدود است. اگر Task از قبل فعال باشد،
نوبت بعدی با توکن اصلاح‌شده برای بازیابی تلاش می‌کند. نبود Task یا خطای ماندگار همچنان به
بررسی وضعیت نصب نیاز دارد.

### API فرم

- `GET /settings/pythonanywhere`: فرم مستقل، فقط پس از ورود مدیر.

- `GET /api/platform/config`: وضعیت و فیلدهای عمومی؛ بدون توکن.
- `POST /api/platform/config`: ذخیرهٔ رمز‌شدهٔ `site`, `username`, `domain`, `token`.
- `DELETE /api/platform/config`: حذف اطلاعات اتصال ذخیره‌شده، نه حذف Task یا وب‌اپ.
- `POST /api/platform/test`: تست خواندنی با timeout محدود.
- `POST /api/platform/activate`: فعال‌سازی Task همان برنامه با مفسر ثبت‌شدهٔ نصب.

ذخیره، حذف، تست و فعال‌سازی فقط با **نشست مدیرِ واردشده و CSRF** مجازند؛ Bearer token برای
تغییر توکن پلتفرم یا فعال‌سازی اولیه پذیرفته نمی‌شود. توکن را فقط در صفحهٔ HTTPS پنل خودتان وارد کنید.


## نسخهٔ ۱.۳ — شروع همسان‌سازی PHP و کران خارجی دقیقه‌ای

### اولین مرحلهٔ همسان‌سازی

سورس شاخهٔ خواسته‌شده دوباره fetch و بررسی شد:
`arena/01a0ebf7-new`، کامیت `5aa1012d767a1b9f9a9ca43064c7fc3dc35976d3`،
مقدار `APP_VERSION` در فایل فعلی: **10.640**.
این شماره نسخهٔ PHP است؛ نسخهٔ پورت Python اکنون **1.3.0** است.

در این مرحله از `parse_products()` نسخهٔ PHP پورت شد:

- امتیازدهی الگوهای کارت محصول و جلوگیری از انتخاب اشتباه `product_price` به‌جای کارت.
- الگوی `article.product*`، gridهای متداول و مسیرهای جزئیات `/product/`, `/p/`, `~id~`, `/کالا/`.
- پیمایش لینک جزئیات به سمت ظرف واقعی تا عمق شش سطح و حذف تکراری‌ها با کلید پایدار.
- عنوان، قیمت و تصویر lazy از کارت؛ DOM به‌عنوان اولویت اول، JSON-LD/microdata در fallback.
- همسان‌سازی نمایش `extractPrice()` جدید: حفظ تومان/ریال، ارزهایی مانند £/$/€ و اعشار.
  این تغییر عمداً رفتار number-only نسخهٔ قدیمی Laravel را جایگزین می‌کند.

**هنوز همسان‌سازی کامل نشده است.** دفتر وضعیت قابل‌خواندن در `scraper4/parity.json` و
اندپوینت‌های محافظت‌شدهٔ `GET /api/port-status` و `GET /api/parity/status` وجود دارد.
جزئیات محصول، تمام variationها، آداپترهای تخصصی سایت‌ها، ارسال کامل باسلام، انتخابگر بصری و
اتوماسیون‌های AI/پیام/دسته‌ها همچنان در فهرست باقی‌مانده‌اند.
تست‌های DOM/قیمت بر اساس الگوریتم سورس قفل شده‌اند؛ اجرای تطبیقی PHP/Python انجام نشده،
چون PHP CLI در محیط توسعه موجود نبود. آزمون‌ها هیچ محصولی را به فروشگاه زنده ارسال نمی‌کنند.

تغییر نمایش قیمت ممکن است کلید fallback محصولات **بدون لینک** را تغییر دهد، چون قیمت بخشی از آن کلید است؛
محصولات لینک‌دار کلید پایدار قبلی را حفظ می‌کنند. قبل از استخراج انبوه، داده‌ها را پشتیبان بگیرید و
ردیف‌های بدون لینک را از نظر تکراری‌شدن بررسی کنید؛ این نسخه رکوردهای قبلی را خودکار حذف نمی‌کند.

**مهم دربارهٔ ارز:** `price_num` هنوز مثل PHP یک helper مقایسهٔ digits-only است؛
مثلاً `£51.77` به `5177` تبدیل می‌شود. این تبدیل ارز یا واحد minor currency نیست.
قیمت‌های خارجی را بدون نگاشت مالی/ارزی جداگانه به فروشگاه مقصد ارسال نکنید. این بخش از همسان‌سازی
مجوز فرض‌کردن سازگاری کامل قیمت/واحد فروشگاه‌ها نیست.

### Task دقیقه‌ای داخلی

طبق [راهنمای رسمی PythonAnywhere](https://help.pythonanywhere.com/pages/ScheduledTasks/)،
Scheduled Task داخلی روزانه یا ساعتی است، نه هر دقیقه. قابلیت Task به نوع و تاریخ ایجاد حساب بستگی دارد؛
حساب‌های رایگان جدید ممکن است اصلاً Scheduled Task نداشته باشند. Always-on worker نیز تابع پلن است.
کران خارجی زیر برای اجرای صف به Task داخلی یا توکن PythonAnywhere نیاز ندارد.

### آدرس دقیق کران خارجی

```
POST https://fazilatma.pythonanywhere.com/api/cron/run
```

تنظیمات سرویس کران:

- تناوب: هر دقیقه (`* * * * *`).
- Method: **POST**؛ بازکردن URL با GET هیچ کاری اجرا نمی‌کند.
- Header: `Authorization: Bearer YOUR_CRON_KEY`.
- Header: `Content-Type: application/json`.
- Body: `{}` (یا خالی).
- timeout سرویس خارجی: حدود ۴۵ ثانیه یا بیشتر؛ retry فوری توصیه نمی‌شود.

در پنل، بخش **کران خارجی دقیقه‌ای → ساخت / تعویض کلید کران** را بزنید. این کلید فقط یک‌بار
نمایش داده می‌شود، هش آن نگهداری می‌شود و فقط به دو مسیر run/status دسترسی دارد؛
با **توکن PythonAnywhere** و **کلید API مدیر** متفاوت است. از کلید محدود کران استفاده کنید،
نه توکن حساب پلتفرم. سرویس کران باید POST و هدر سفارشی پشتیبانی کند؛ کلید در URL پذیرفته نمی‌شود.

مثال تست در ماشین/سرور کران خودتان (کلید را در history ننویسید):

```bash
read -rsp 'Cron key: ' S4_CRON_KEY; echo
export S4_CRON_KEY
curl --fail-with-body --max-time 45 -X POST \
  -H "Authorization: Bearer $S4_CRON_KEY" \
  -H 'Content-Type: application/json' -d '{}' \
  https://fazilatma.pythonanywhere.com/api/cron/run
unset S4_CRON_KEY
```

برای crontab سرور خارجی، کلید را در secret store یا فایل خصوصی با مجوز ۶۰۰ ذخیره کنید؛
آن را مستقیم در خط crontab یا URL قرار ندهید. اگر سرویس زمان‌بندی شما جای Header دارد،
همان Authorization را در تنظیمات محرمانهٔ Header وارد کنید.

### کران دقیقاً چه می‌کند؟

- هر درخواست معتبر **حداکثر یک صفحهٔ استخراج یا یک محصول ارسال** را از صف پردازش می‌کند.
- ادامهٔ کار در SQLite ذخیره می‌شود؛ درخواست دقیقهٔ بعد از همان محل ادامه می‌دهد.
- پروفایل‌های دوره‌ای فقط وقتی `S4_AUTO_EXTRACT_MINUTES` مثبت باشد خودکار صف‌بندی می‌شوند؛
  در غیر این صورت ابتدا از پنل کار استخراج/ارسال اضافه کنید. کران بدون صف کار جدیدی اختراع نمی‌کند.
- یک قفل مشترک با worker CLI مانع اجرای هم‌زمان است. در حالت busy پاسخ ۲۰۰ با `busy:true` می‌آید.
- فراخوانی مجدد در کمتر از ۴۵ ثانیه پاسخ ۲۰۰ با `throttled:true` می‌دهد؛ صفحه/محصول دیگری اجرا نمی‌شود.
- این یک endpoint واقعی پردازش صف است، نه صرفاً ثبت درخواست برای Task داخلی.
- سقف هدف ۱۵ ثانیه، timeout شبکهٔ کوتاه و حداکثر یک گام است؛ **سقف سخت زمان سیستم‌عامل نیست**.
  DNS، سرور کند، رندر JS یا پاسخ پیوستهٔ غیرعادی می‌تواند طول درخواست را بیشتر کند.
  برای منابع سنگین/JS از worker CLI یا worker مجاز پلتفرم استفاده کنید؛ کران HTTP جایگزین
  کامل یک worker دائمی نیست و timeout بیرونی نباید با retry فوری باعث کارهای هم‌پوشان شود.
- برای کوتاه‌بودن گام، fallback زنجیره‌ای شبکه در حالت HTTP خاموش و timeout رندر کوتاه می‌شود؛
  رفتار کامل fallback در worker CLI همچنان برقرار است.
- عملیات نوشتن باسلام در این حالت پس از خطای شبکه خودکار تکرار نمی‌شود تا ریسک محصول تکراری کم شود.
- **آپدیت کد، pip، نصب فایل، shell یا Reload در این درخواست اجرا نمی‌شوند.**
  اتوآپدیت کد همچنان از `python -m scraper4 maintain` در Task/worker مجاز استفاده می‌کند.
  برای پروژه‌ای که فقط کران HTTP دارد، آپدیت کد را جداگانه با هلپر یا worker انجام دهید.
- پاسخ `ok:true` یعنی چرخهٔ worker اجرا شده؛ موفقیت تک‌تک محصولات را در صف پنل بررسی کنید.

وضعیت کران: `GET https://fazilatma.pythonanywhere.com/api/cron/status` با همان هدر Authorization.
ساخت/ابطال کلید: `POST/DELETE /api/cron/token` فقط با نشست مرورگر مدیر و CSRF.
برنامه پارامتر URL، فرمان، مسیر فایل یا budget دلخواه از کران دریافت نمی‌کند.
در maintenance پاسخ اجرای کران ۵۰۳ است؛ مسیر status برای مشاهده در دسترس می‌ماند.

برای دریافت این نسخه بدون توکن پلتفرم:

```bash
set -o pipefail
curl -fsSL 'https://raw.githubusercontent.com/fazilatma/new/arena/f3d5d2a0-new/pythonanywhere/bootstrap.sh?v=1.3.0' | S4_AUTO_CONFIGURE=0 bash
```

اگر اتوآپدیت فعال نیست، پس از نصب یک‌بار Web → Reload بزنید. تنظیمات و توکن ذخیره‌شده حفظ می‌شوند.
