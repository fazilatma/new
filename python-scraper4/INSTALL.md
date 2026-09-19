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
git clone -b arena/01a0b7db-new https://github.com/fazilatma/new.git
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

## روش ۲ — نصب دستی (هر سروری، بدون root هم ممکن است)

```bash
git clone -b arena/01a0b7db-new https://github.com/fazilatma/new.git
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

### شایع‌ترین علت: خودبه‌روزرسانی فایل را عوض کرده

`scraper4.py` یک به‌روزرسان خودکار دارد که **۴۰ ثانیه بعد از استارت**،
فایل خودش را از مخزن `fazilatma/amphp` دانلود و جایگزین می‌کند. آن نسخه
داشبورد جدید را ندارد، پس `/ui` و `/api/profiles` هر دو ۴۰۴ می‌شوند
درحالی‌که رابط کلاسیک سالم کار می‌کند.

نشانه‌ها:

```bash
ls -l /opt/scraper4/scraper4.py.bak          # وجودش یعنی فایل بازنویسی شده
grep -c ui_bridge /opt/scraper4/scraper4.py  # اگر 0 بود، نسخه عوض شده
```

درمان:

```bash
# ۱) خودبه‌روزرسانی را خاموش کنید
grep SCRAPER_AUTO_UPDATE /etc/systemd/system/scraper4.service \
  || sed -i '/^Environment=PORT=8000/a Environment=SCRAPER_AUTO_UPDATE=0' \
       /etc/systemd/system/scraper4.service

# ۲) نسخهٔ درست را دوباره نصب کنید
cd ~/new && git pull
bash python-scraper4/tools/vps-live/install_scraper4_vps.sh

systemctl daemon-reload && systemctl restart scraper4
```

از این به بعد دو لایهٔ محافظ فعال است: سرویس با
`SCRAPER_AUTO_UPDATE=0` نصب می‌شود، و اگر کسی دوباره روشنش کند، بلوک
داشبورد به‌صورت خودکار به هر فایل دانلودشده الحاق می‌شود تا `/ui` از بین
نرود.

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
