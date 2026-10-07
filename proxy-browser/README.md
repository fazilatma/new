# ☁️ Cloudflare Workers — Proxy + Full-Screen Browser

یک ورکر Cloudflare تک‌فایلی که **دو تب** را ارائه می‌دهد:

1. **🌐 مرورگر تمام‌صفحه** — یک iframe با نوار آدرس که صفحات وب را از طریق پروکسی نمایش می‌دهد (لینک‌ها، عکس‌ها، CSS، فرم‌های GET بازنویسی می‌شوند).
2. **⚙️ سرور پروکسی** — یک Forward Proxy کامل با پشتیبانی CORS، تست درخواست زنده، نمایش وضعیت Edge و تاریخچه.

---

## 🚀 استقرار سریع

### پیش‌نیاز
- Node.js 18+
- حساب Cloudflare (پلن رایگان هم کافی است)

### روش ۱: Deploy با Wrangler
```bash
cd proxy-browser
npm install
npx wrangler login       # فقط بار اول
npm run deploy           # یا: npx wrangler deploy src/worker.js --name proxy-browser
```

پس از استقرار آدرس داده‌شده را در مرورگر باز کنید، مثلاً:
```
https://proxy-browser.YOUR_SUBDOMAIN.workers.dev
```

برای توسعه محلی:
```bash
npm run dev    # پیش‌نمایش در localhost
```

### روش ۲: استقرار از طریق داشبورد Cloudflare
1. وارد `dash.cloudflare.com` شوید → Workers & Pages → Create application → Create Worker.
2. محتوای فایل `src/worker.js` را کپی و در ویرایشگر آنلاین جای‌گذاری کنید.
3. Save and Deploy.

---

## 🔧 تنظیمات اختیاری (`wrangler.toml`)
```toml
[vars]
ACCESS_PASSWORD = ""      # رمز عبور (خالی بگذارید = بدون محافظت)
USER_AGENT     = "Mozilla/5.0 ..."
```

---

## 📡 اندپوینت‌ها

| مسیر | توضیح |
|------|-------|
| `/` | رابط کاربری دو تب (مرورگر + پنل پروکسی) |
| `/browse?url=https://...` | پروکسی با بازنویسی HTML/CSS (برای iframe مرورگر) |
| `/go?url=https://...` | نام مستعار برای `/browse` |
| `/proxy?url=https://...` | پروکسی خام + هدر CORS (مناسب API و دانلود) |
| `/api/status` | وضعیت JSON ورکر (موقعیت Edge، IP، …) |

### نمونه استفاده از پروکسی
```bash
# درخواست API ساده
curl "https://YOUR_WORKER.workers.dev/proxy?url=https://httpbin.org/get"

# پروکسی کردن یک عکس
<img src="https://YOUR_WORKER.workers.dev/proxy?url=https://example.com/pic.jpg">
```

---

## ✨ ویژگی‌ها

- ✅ رابط فارسی (RTL) دو تب
- ✅ مرورگر تمام‌صفحه با نوار آدرس، دکمه Fullscreen و میانبر `Ctrl/Cmd+L`
- ✅ پروکسی HTTP با پشتیبانی تمام متدها (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- ✅ بازنویسی لینک‌ها و منابع در HTML/CSS با `HTMLRewriter` بومی Cloudflare
- ✅ بازنویسی `srcset`, `action`, `poster`, `background`, `data-src` و …
- ✅ تزریق `<base href>` و شیم JS برای رهگیری کلیک روی لینک‌ها و submit فرم‌های GET
- ✅ پیروی از Redirect (301/302/303/307/308) از طریق پروکسی
- ✅ حذف هدرهای محدودکننده (CSP, X-Frame-Options, HSTS, Permissions-Policy, …)
- ✅ CORS wildcard روی همه پاسخ‌ها
- ✅ ابزار **تست درخواست** زنده در پنل پروکسی (با انتخاب Method / Header / Body)
- ✅ **تاریخچه درخواست‌ها** در session مرورگر
- ✅ محافظت با **رمز عبور** اختیاری
- ✅ نوار بارگذاری (progress bar) در مرورگر
- ✅ بدنه تک‌فایله — فقط `src/worker.js` + `wrangler.toml`

---

## ⚠️ محدودیت‌ها

- سایت‌های بسیار JS-heavy (مانند جیمیل، توییتر/X، اینستاگرام، فیسبوک) به‌خاطر client-side routing و WebSocket/POST-based navigation ممکن است ناقص بارگذاری شوند. این محدودیت عمومی پروکسی‌های مبتنی بر HTML rewrite در Cloudflare Workers است و برای دور زدن آن نیاز به Headless Browser (مانند Puppeteer) است که در محیط Workers میسر نیست.
- Cloudflare Workers محدودیت زمان‌پاسخ دارد (پلن رایگان ~۱۰ ثانیه برای fetchهای خروجی، پلن پولی ~۳۰ ثانیه). بنابراین برای دانلودهای بسیار حجیم یا استریم طولانی مناسب نیست.
- فایل‌های JavaScript عبور داده می‌شوند اما بازنویسی نمی‌شوند (نیازمند parser کامل JS است)؛ در نتیجه درخواست‌های `fetch()` و `XHR` درون کد JS سایت‌ها همچنان از origin خود سایت زده می‌شوند که ممکن است CORS یا خطای احراز هویت بدهد.

---

## 📁 ساختار
```
proxy-browser/
├── package.json
├── wrangler.toml
├── README.md
└── src/
    └── worker.js     # تمام منطق پروژه در این یک فایل
```

---

## 📝 لایسنس
MIT
