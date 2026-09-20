# راهنمای نصب و اجرا روی سرور

سه روش نصب وجود دارد. اگر VPS دارید (Ubuntu/Debian با دسترسی root)، **روش ۱**
را انتخاب کنید.

> ⚠️ **نکته مهم:** این پروژه حالا سه بخش دارد که **باید کنار هم** کپی شوند:
> `scraper4.py` + `ui_bridge.py` + پوشهٔ `ui/`.
> اگر فقط `scraper4.py` منتقل شود، برنامه بالا می‌آید ولی داشبورد جدید
> (`/ui`) کار نمی‌کند و فقط رابط کلاسیک در دسترس است.

---

## روش ۱ — نصب خودکار روی VPS (پیشنهادی)

اسکریپت همه‌چیز را نصب می‌کند: پکیج‌های سیستمی، venv، سرویس systemd، و
تنظیم Apache به‌صورت reverse proxy روی مسیر `/put/`. سایت PHP موجود شما
روی `/` دست‌نخورده می‌ماند.

روی سرور، **به‌عنوان root**:

```bash
git clone -b arena/01a0bd3f-new https://github.com/fazilatma/new.git
cd new/python-scraper4
bash tools/vps-live/install_scraper4_vps.sh
```

بعد از اتمام:

| آدرس | توضیح |
| --- | --- |
| `http://SERVER/put/ui` | **داشبورد جدید** (ظاهر پروژه Node) |
| `http://SERVER/put/` | رابط کلاسیک پایتون |
| `http://SERVER/put/health` | بررسی سلامت |

اسکریپت در پایان خودش بررسی می‌کند که داشبورد بالا آمده باشد و اگر مشکلی
بود هشدار می‌دهد.

### دستورهای مدیریت سرویس

```bash
systemctl status scraper4      # وضعیت
systemctl restart scraper4     # ری‌استارت
journalctl -u scraper4 -f      # لاگ زنده
```

---

## نصب روی گوشی اندروید (Termux)

برنامهٔ Termux را از **F-Droid** نصب کنید (نسخهٔ Google Play قدیمی و ناسازگار
است)، بعد این یک دستور را اجرا کنید:

```bash
pkg install -y curl && \
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/01a0bd3f-new/python-scraper4/tools/install_termux.sh | bash
```

بعد از نصب:

```bash
scraper4 start      # اجرا
scraper4 status     # وضعیت
scraper4 log        # گزارش خطاها
scraper4 stop       # توقف
scraper4 restart    # شروع دوباره
scraper4 update     # دریافت نسخهٔ جدید
```

همهٔ این دستورهای start/stop/restart/status/log/update داخل خود فایل
`tools/install_termux.sh` تعریف شده‌اند (تابع `write_launcher`). بنابراین
`scraper4 update` اول مخزن را `git pull` می‌کند و بعد همان فایل نصب تازه را
با حالت `--update-local` اجرا می‌کند؛ یعنی هم کد برنامه به‌روز می‌شود و هم
خودِ دستور `scraper4` از نو ساخته می‌شود و تغییرات دستورها خودکار
منتقل می‌شوند. حالت‌های دیگر این فایل:

```bash
bash tools/install_termux.sh            # نصب کامل
bash tools/install_termux.sh --update   # به‌روزکردن سریع (بدون pkg/pip اضافی)
bash tools/install_termux.sh --launcher # فقط ساخت دوبارهٔ دستور scraper4
```

بعد از به‌روزرسانی، `scraper4 restart` نسخهٔ تازه را اجرا می‌کند.

سپس در مرورگر گوشی باز کنید: **http://127.0.0.1:8000/ui**

### نکته‌های مهم اندروید

* **موتورهای مرورگری کار نمی‌کنند.** Playwright و Selenium به کرومیوم
  دسکتاپ نیاز دارند که روی گوشی نصب نمی‌شود. موتورهای HTTP
  (`requests`، `httpx`، `curl_cffi`، `cloudscraper`) کار می‌کنند و برنامه
  خودش سراغ آن‌ها می‌رود. برای سایت‌های جاوااسکریپتی از سرور استفاده کنید.
* **استخراج طولانی:** اندروید برنامه‌های پس‌زمینه را می‌کشد. اسکریپت هنگام
  شروع `termux-wake-lock` را می‌گیرد، ولی بهتر است Termux را باز نگه دارید و
  در تنظیمات گوشی بهینه‌سازی باتری را برایش خاموش کنید.
* **از حافظهٔ داخلی Termux استفاده کنید**، نه `storage/shared`. نصب روی حافظهٔ
  مشترک به‌خاطر محدودیت مجوزهای اندروید خراب می‌شود.
* `lxml` از بستهٔ آمادهٔ Termux نصب می‌شود؛ اگر کامپایل شود روی گوشی خیلی طول
  می‌کشد. اسکریپت این را مدیریت می‌کند.
* اگر `curl_cffi` نصب نشد اشکالی ندارد — اختیاری است و بقیه کار می‌کنند.

### دسترسی از کامپیوتر به گوشی

به‌طور پیش‌فرض فقط روی خود گوشی باز است. برای دسترسی از شبکهٔ محلی:

```bash
scraper4 stop
SCRAPER_BIND=0.0.0.0 scraper4 start   # سپس http://<IP گوشی>:8000/ui
```

> هشدار: در این حالت هرکسی در همان شبکه می‌تواند به داشبورد دسترسی داشته باشد.

## روش ۲ — نصب دستی (هر سروری، بدون root هم ممکن است)

```bash
git clone -b arena/01a0bd3f-new https://github.com/fazilatma/new.git
cd new/python-scraper4

python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

اگر نصب `requirements.txt` به‌خاطر پکیج‌های سنگین (playwright، selenium و …)
خطا داد، حداقل‌های لازم برای بالا آمدن برنامه این‌هاست:

```bash
.venv/bin/pip install flask requests beautifulsoup4 lxml html5lib gunicorn
```

### اجرای آزمایشی

```bash
PORT=8080 .venv/bin/python scraper4.py
```

سپس `http://SERVER:8080/ui` را باز کنید.

### اجرای دائمی با gunicorn

```bash
SCRAPER_RUNTIME=vps PYTHONUNBUFFERED=1 \
  .venv/bin/python -m gunicorn \
  --bind 0.0.0.0:8000 --workers 1 --threads 8 --timeout 0 \
  scraper4:application
```

> `--workers 1` عمدی است: وظایف استخراج در حافظهٔ همان پروسه نگهداری
> می‌شوند، پس چند worker باعث می‌شود صف کارها ناهماهنگ شود. برای هم‌زمانی
> بیشتر `--threads` را زیاد کنید، نه `--workers`.
>
> `--timeout 0` هم عمدی است تا استخراج‌های طولانی وسط کار kill نشوند.

---

## روش ۳ — پشت Apache / Nginx با پیشوند `/put/`

فایل آمادهٔ Apache در `deploy/scraper4.apache.conf` است. آن را داخل vhost
اصلی (نه به‌صورت conf جدا) قرار دهید:

```apache
ProxyPreserveHost On
ProxyRequests Off
ProxyTimeout 3600
RedirectMatch 301 ^/put$ /put/
ProxyPass        /put/ http://127.0.0.1:8000/
ProxyPassReverse /put/ http://127.0.0.1:8000/
```

```bash
a2enmod proxy proxy_http headers rewrite
systemctl reload apache2
```

معادل Nginx:

```nginx
location /put/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

داشبورد مسیر API خودش را از آدرس صفحه تشخیص می‌دهد، بنابراین پشت پیشوند
`/put/` هم بدون تنظیم اضافه کار می‌کند. (این مورد با شبیه‌سازی کامل پراکسی
تست شده است.)

---

## متغیرهای محیطی مهم

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `PORT` | `8000` | پورت، فقط در اجرای مستقیم `scraper4.py` |
| `SCRAPER_RUNTIME` | — | مقدار `vps` سقف صفحات/محصولات را بالا می‌برد |
| `SCRAPER_URL_PREFIX` | `/put` در حالت vps | پیشوند مسیر رابط کلاسیک |
| `SCRAPER_DATA_FILE` | `./scraper4_data.json` | محل ذخیرهٔ داده‌ها |
| `SCRAPER_DEPLOY_PASSWORD` | — | رمز بخش‌های مدیریتی و وظایف |
| `GITHUB_TOKEN` | — | برای به‌روزرسانی از مخزن خصوصی |

نمونه:

```bash
SCRAPER_RUNTIME=vps \
SCRAPER_DATA_FILE=/var/lib/scraper4/data.json \
SCRAPER_DEPLOY_PASSWORD='یک-رمز-قوی' \
  .venv/bin/python -m gunicorn --bind 0.0.0.0:8000 --timeout 0 scraper4:application
```

---

## پشتیبان‌گیری

تمام وضعیت برنامه در **یک فایل** است:

```bash
cp scraper4_data.json scraper4_data.json.bak
```

از داخل داشبورد هم می‌توانید از مسیر کشوی تنظیمات، خروجی/ورودی JSON بگیرید.

---

## نصب مرورگر Chromium از ایران

دستور رسمی پلی‌رایت از داخل ایران کار نمی‌کند:

```bash
venv/bin/python -m playwright install chromium
# Error: Download failure, code=1
```

چون `cdn.playwright.dev` برای IP ایران مسدود است. از نسخهٔ ۱.۵۸ به بعد،
پلی‌رایت کرومیوم را از مسیر `builds/cft/` می‌گیرد که آینهٔ معمول npmmirror
آن را ندارد؛ برای همین فقط تنظیم `PLAYWRIGHT_DOWNLOAD_HOST` هم کافی نیست.

راه‌حل — اسکریپت آینه:

```bash
bash python-scraper4/tools/install_chromium_mirror.sh
systemctl restart scraper4
```

این اسکریپت:

1. نسخهٔ دقیق موردنیاز را از خود پلی‌رایت می‌پرسد (چیزی hardcode نشده، پس
   بعد از ارتقا هم کار می‌کند)
2. همان فایل‌های Chrome for Testing را از `cdn.npmmirror.com` می‌گیرد
3. در مسیر کش پلی‌رایت با ساختار درست باز می‌کند و فایل
   `INSTALLATION_COMPLETE` را می‌سازد
4. کتابخانه‌های سیستمی لازم را نصب می‌کند
5. در پایان یک مرورگر واقعی بالا می‌آورد تا مطمئن شود کار می‌کند

اگر آینه هم در دسترس نبود:

```bash
# گزینهٔ ۱ — مرورگر سیستمی (ساده‌ترین)
apt-get install -y chromium chromium-browser
# برنامه خودش آن را پیدا می‌کند

# گزینهٔ ۲ — آینهٔ دیگر
MIRROR=https://registry.npmmirror.com/-/binary \
  bash python-scraper4/tools/install_chromium_mirror.sh

# گزینهٔ ۳ — دانلود روی سیستم دیگر و کپی به سرور
#   فایل‌ها را در ~/.cache/ms-playwright/chromium-<build>/ بگذارید
```

بررسی نتیجه:

```bash
curl -s http://127.0.0.1:8000/api/engines | python3 -m json.tool | grep -A2 playwright
```

اگر `installed: true` بود، موتور مرورگری آمادهٔ استفاده است.

## وظیفه‌ای که «در حال اجرا» مانده و متوقف نمی‌شود

اگر سرویس هنگام اجرای یک استخراج ری‌استارت شود (نصب، کرش، ریبوت، OOM)، رشتهٔ
کارگر از بین می‌رود ولی فایل وظیفه روی دیسک هنوز می‌گوید «در حال اجرا».
دکمهٔ توقف فقط یک پرچم می‌گذارد که باید یک کارگر زنده آن را بخواند — و برای
چنین وظیفه‌ای هیچ کارگری وجود ندارد، پس تا ابد می‌ماند.

از نسخهٔ ۱۰.۱۷۲ این خودکار حل می‌شود: هر وظیفه شناسهٔ پروسهٔ سازنده‌اش را
ثبت می‌کند و هنگام بالا آمدن سرویس، وظایف بی‌صاحب به «قطع‌شده» تغییر می‌کنند.
دکمهٔ توقف هم چنین وظیفه‌ای را مستقیماً پایان می‌دهد.

اگر با نسخهٔ قدیمی وظیفهٔ گیرکرده دارید، یک ری‌استارت کافی است:

```bash
systemctl restart scraper4
```

در موارد نادر می‌توانید فایل‌ها را دستی پاک کنید:

```bash
ls /opt/scraper4/scraper4-live/
rm /opt/scraper4/scraper4-live/task-<id>.json
systemctl restart scraper4
```

## عیب‌یابی

**داشبورد `/ui` خطای ۴۰۴ می‌دهد**

اول علت را از خود برنامه بپرسید:

```bash
curl -s http://127.0.0.1:8000/health | tr ',' '\n' | grep ui_bridge
```

- `"ui_bridge": true` → پل سالم است؛ مشکل از پراکسی/آدرس است.
- `"ui_bridge": false` → متن `ui_bridge_error` علت دقیق را می‌گوید.
- اگر اصلاً فیلد `ui_bridge` در خروجی نبود → یعنی **فایل `scraper4.py`
  روی سرور اصلاً نسخهٔ این پروژه نیست** (بخش بعدی).

## نصب از صفر روی سرور تازه (یک دستور)

```bash
curl -fsSL https://raw.githubusercontent.com/fazilatma/new/arena/01a0bd3f-new/python-scraper4/tools/vps-live/bootstrap_vps.sh | bash
```

این اسکریپت مخزن را در `/opt/new` کلون می‌کند و بعد نصب‌کنندهٔ اصلی را اجرا
می‌کند. کلون **کامل** است (نه `--depth 1`) تا به‌روزرسانی خودکار بتواند
fast-forward کند.

## اگر وسط نصب، SSH قطع می‌شود

**علت اصلی:** بستهٔ `needrestart`. اسکریپت قبلاً با `NEEDRESTART_MODE=a` اجرا
می‌شد، یعنی «هر سرویسی را که کتابخانه‌اش عوض شده خودکار ری‌استارت کن» — و
یکی از آن سرویس‌ها **خود `ssh`** است. با ری‌استارت شدن ssh ارتباط شما قطع
می‌شود، شل سیگنال `SIGHUP` می‌گیرد و `apt` و `pip` وسط کار می‌میرند؛ گاهی
قفل `dpkg` هم باقی می‌ماند.

**دلیل دوم:** حتی بدون آن، هر قطعی لحظه‌ای شبکه ترمینال را می‌بندد و اسکریپت
هم با آن از بین می‌رود.

**راه‌حل (الان اعمال شده):**

1. `NEEDRESTART_MODE=l` شد (فقط گزارش می‌دهد، ری‌استارت نمی‌کند) و یک فایل
   تنظیمات نصب می‌شود که صریحاً می‌گوید هرگز `ssh` را ری‌استارت نکن.
2. اسکریپت خودش را با `setsid nohup` **جدا از ترمینال** اجرا می‌کند. یعنی
   حتی اگر SSH کاملاً قطع شود، نصب تا آخر ادامه پیدا می‌کند.
3. اگر `apt` قفل باشد (cloud-init یا unattended-upgrades) تا ۵ دقیقه صبر
   می‌کند به‌جای اینکه خطا بدهد.

اجرا مثل قبل است:

```bash
bash python-scraper4/tools/vps-live/install_scraper4_vps.sh
```

خروجی هم‌زمان در `/var/log/scraper4-install.log` ذخیره می‌شود. اگر ارتباط
قطع شد، دوباره وصل شوید و ادامه را ببینید:

```bash
tail -f /var/log/scraper4-install.log
```

فشردن `Ctrl-C` فقط دنبال‌کردن لاگ را متوقف می‌کند، نه خود نصب را.

برای نصب سریع بدون مرورگرها (چند ثانیه‌ای):

```bash
SKIP_ENGINES=1 bash python-scraper4/tools/vps-live/install_scraper4_vps.sh
```

## نصب داشبورد از طریق دیپلویر

حالا دیپلویر می‌تواند **خودش داشبورد را نصب کند** — قبلاً فقط `scraper4.py`
را نصب می‌کرد و چون `ui_bridge.py` و `ui/` همراهش نمی‌رفتند، `/ui` خطای ۴۰۴
می‌داد در حالی که نصب «موفق» گزارش می‌شد.

دو راه:

1. **خودکار:** هر نصب معمولی از پنل دیپلویر، حالا فایل‌های داشبورد را هم از
   همان برنچ می‌آورد.
2. **دکمهٔ جداگانه:** در `http://SERVER/deploy/` دکمهٔ
   **«🖥 نصب/تعمیر داشبورد (/ui)»** فقط داشبورد را نصب می‌کند بدون دست زدن
   به `scraper4.py`. برای وقتی که نسخهٔ برنامه درست است ولی `/ui` کار نمی‌کند.

همچنین مخزن پیش‌فرض دیپلویر از `fazilatma/amphp` به **`fazilatma/new`** تغییر
کرد؛ مخزن قبلی اصلاً داشبورد نداشت و نصب از روی آن باعث همان ۴۰۴ می‌شد.

## به‌روزرسانی خودکار از برنچ (روش جدید و امن)

از این نسخه، برنامه **هر ۶۰ ثانیه** برنچ خودش را روی `origin` بررسی می‌کند و
اگر کامیت تازه‌ای آمده باشد، خودکار به‌روز می‌شود و سرویس را ری‌استارت می‌کند.

این با به‌روزرسان قدیمی که دو بار سایت را خراب کرد **فرق بنیادی** دارد:

| | به‌روزرسان قدیمی | روش جدید |
| --- | --- | --- |
| منبع | مخزن دیگر (`amphp`) | **همین مخزن و همین برنچ** |
| روش | دانلود تک‌فایل `scraper4.py` | `git merge --ff-only` |
| ریسک | فایل‌ها ناهماهنگ می‌شدند و داشبورد پاک می‌شد | همهٔ فایل‌ها با هم جابه‌جا می‌شوند |
| تغییر محلی | بی‌صدا پاک می‌شد | اگر درخت کثیف باشد **اجرا نمی‌شود** |

تنظیمات در `scraper4.service`:

```ini
Environment=SCRAPER_GIT_AUTO_UPDATE=1   # 0 = قفل کردن نسخه
Environment=SCRAPER_UPDATE_INTERVAL=60  # ثانیه
Environment=SCRAPER_REPO_DIR=/root/new  # اگر مسیر کلون پیدا نشد
```

بررسی وضعیت:

```bash
curl -s http://127.0.0.1:8000/api/update/status | python3 -m json.tool
```

`behind` یعنی چند کامیت عقب است. برای به‌روزرسانی فوری بدون انتظار:

```bash
curl -s -X POST http://127.0.0.1:8000/api/update/apply
```

> **نکته:** برنامه باید به کلون گیت دسترسی داشته باشد. اگر با اسکریپت نصب
> راه‌اندازی کرده‌اید، فایل‌ها در `/opt/scraper4` کپی می‌شوند ولی کلون در
> `~/new` می‌ماند؛ برنامه خودش آن را پیدا می‌کند و بعد از هر pull فایل‌های
> تازه را در `/opt/scraper4` کپی می‌کند. اگر مسیر غیرعادی است،
> `SCRAPER_REPO_DIR` را دستی بدهید.

## دیپلویر را از کجا بیاورم؟

دیپلویر **داخل همین مخزن** است؛ چیزی جدا دانلود نمی‌کنید:

| فایل | نقش |
| --- | --- |
| `python-scraper4/deployer4.py` | خود برنامهٔ دیپلویر (روی پورت ۸۰۰۱) |
| `python-scraper4/deploy/deployer4.service` | سرویس systemd آن |
| `python-scraper4/setup_deployer4.sh` | نصب دستی |

اسکریپت نصب اصلی هر دو را با هم نصب می‌کند، پس معمولاً کاری لازم نیست:

```bash
cd ~/new && bash python-scraper4/tools/vps-live/install_scraper4_vps.sh
systemctl status deployer4 --no-pager
```

بعد از نصب روی `http://SERVER/deploy/` در دسترس است.

**توجه مهم:** auto-update خود دیپلویر عمداً خاموش است (`DEPLOYER_AUTO_UPDATE=0`)
چون همان چیزی بود که داشبورد را پاک می‌کرد. برای به‌روزرسانی از روش گیتِ بالا
استفاده کنید. پنل دیپلویر برای نصب **دستی** همچنان کار می‌کند.

### شایع‌ترین علت: خودبه‌روزرسانی فایل را عوض کرده

**دو** به‌روزرسان مستقل وجود دارد و هر دو از `fazilatma/amphp` نصب می‌کنند
که داشبورد جدید را ندارد:

| سرویس | زمان‌بندی | متغیر خاموش‌کننده |
| --- | --- | --- |
| `scraper4` (خودِ برنامه) | ۴۰ ثانیه بعد از استارت | `SCRAPER_AUTO_UPDATE=0` |
| `deployer4` (نصب‌کنندهٔ جدا) | **هر ۵ دقیقه** | `DEPLOYER_AUTO_UPDATE=0` |

اگر فقط اولی را خاموش کنید، `deployer4` چند دقیقه بعد دوباره فایل را
عوض می‌کند و `/ui` و `/api/profiles` باز ۴۰۴ می‌شوند — درحالی‌که رابط
کلاسیک سالم کار می‌کند. هر دو باید خاموش باشند.

نشانه‌ها:

```bash
ls -l /opt/scraper4/scraper4.py.bak          # وجودش یعنی فایل بازنویسی شده
grep -c ui_bridge /opt/scraper4/scraper4.py  # اگر 0 بود، نسخه عوض شده
```

درمان — کافی است نسخهٔ جدید را بکشید و اسکریپت نصب را اجرا کنید؛ خودش هر
دو سرویس را اصلاح می‌کند:

```bash
cd ~/new && git pull
bash python-scraper4/tools/vps-live/install_scraper4_vps.sh
```

اگر ترجیح می‌دهید دستی انجام دهید:

```bash
sed -i 's/^Environment=DEPLOYER_AUTO_UPDATE=1/Environment=DEPLOYER_AUTO_UPDATE=0/' \
  /etc/systemd/system/deployer4.service
grep -q SCRAPER_AUTO_UPDATE /etc/systemd/system/scraper4.service \
  || sed -i '/^Environment=PORT=8000/a Environment=SCRAPER_AUTO_UPDATE=0' \
       /etc/systemd/system/scraper4.service
systemctl daemon-reload && systemctl restart deployer4 scraper4
```

بررسی اینکه دیگر برنمی‌گردد — پنج دقیقه صبر کنید و دوباره بزنید:

```bash
sleep 300; curl -s http://127.0.0.1:8000/health | tr ',' '\n' | grep ui_bridge
```

باید همچنان `true` باشد.

از این به بعد دو لایهٔ محافظ فعال است: هر دو سرویس با auto-update خاموش
نصب می‌شوند، و اگر کسی دوباره روشنشان کند، بلوک داشبورد به‌صورت خودکار به
هر فایل دانلودشده الحاق می‌شود تا `/ui` از بین نرود. پنل `/deploy/` برای
نصب دستی همچنان کار می‌کند.

**بررسی دستی فایل‌ها**

```bash
ls ui_bridge.py ui/dashboard.html ui/dashboard.js   # هر سه باید باشند
.venv/bin/python -c "import scraper4; print(scraper4.UI_BRIDGE_READY)"
```

اگر `False` بود، traceback کامل در لاگ است
(`journalctl -u scraper4 -n 50 --no-pager`). برنامه عمداً crash نمی‌کند تا
رابط کلاسیک از کار نیفتد.

**صفحه باز می‌شود ولی داده‌ای نمی‌آید**
احتمالاً با اسلش آخر (`/ui/`) باز کرده‌اید؛ حالا خودکار به `/ui` ریدایرکت
می‌شود. اگر پشت پراکسی هستید مطمئن شوید `ProxyPassReverse` هم تنظیم شده.

**پورت اشغال است**
```bash
ss -ltnp | grep 8000
```

**بعد از تغییر کد، اعمال نشد**
```bash
systemctl restart scraper4
```
