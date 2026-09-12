# Scraper 4

نسخهٔ Cloudflare Workers اسکرپر محصولات، همگام‌سازی WooCommerce/Basalam، اتوماسیون، AI، اعلان‌ها و ابزارهای نگهداری.

## استقرار بدون terminal

راهنمای کامل dashboard-only در [CLOUDFLARE-WORKER.md](CLOUDFLARE-WORKER.md) است. در Workers Builds کافی است repository را با نام Worker دقیق `scraper4-cloudflare` متصل کنید و این مقادیر را بگذارید:

```text
Build variable: SKIP_DEPENDENCY_INSTALL=1
Build command:  npm ci && npm run worker:test
Deploy command: npm run worker:deploy
```

این استقرار به R2، subscription یا کارت بانکی نیاز ندارد. deploy نخست D1، Queue اصلی، DLQ، Queue consumer، Cron و schema دیتابیس را خودکار ایجاد و متصل می‌کند؛ ساخت دستی resource یا paste کردن UUID لازم نیست. backup کامل از `/api/backup` به‌صورت فایل JSON دانلود می‌شود. ورود پنل و API فعلاً به `ADMIN_TOKEN` نیاز ندارد. فقط `VAULT_SECRET` باید پس از deploy با حداقل طول ۸ کاراکتر و به‌صورت Secret در Dashboard ثبت شود تا اطلاعات اتصال رمزگذاری شوند.

## توسعهٔ محلی اختیاری

```bash
npm install
npm run worker:test
npm run worker:db:local
npm run worker:dev
```

### محیط آزمایشگاه (اول این را اجرا کن)

پیش از هر تغییر در کد استخراج، رفتار فعلی را روی آزمایشگاه آفلاین ببین و بعد
از اصلاح هم روی همان راستی‌آزمایی کن تا توسعه سریع‌تر شود. راهنمای کامل در
[`LAB.md`](LAB.md) است:

```bash
node scripts/lab-probe.mjs patris-cards.html   # گزارش هر دو موتور روی یک فیکسچر
node --test worker-tests/engine-diagnosis.test.mjs  # تست‌های موتور
npm test                                       # گیت کامل (باید سبز باشد)
```

### شمارهٔ نسخه (تک‌مرجع)

تنها مرجع نسخه، فیلد `version` در `package.json` است. پس از تغییر آن، این دستور همهٔ جاهای دیگر را یکجا هم‌سان می‌کند:

```bash
npm run version:sync    # هدر داشبورد، پاورقی گزارش تغییرات، wrangler.toml، fallbackها و دستورالعمل نصب محیط‌ها
npm run version:check   # فقط بررسی؛ در npm run worker:test هم اجرا می‌شود و در صورت ناهماهنگی تست شکست می‌خورد
```

- source اصلی Worker: `worker-src/`
- entrypoint: `worker-src/main.ts`
- تنظیمات و bindingهای declarative Cloudflare: `wrangler.toml`
- deploy و migration خودکار: `scripts/deploy-cloudflare.mjs`
- migrationهای D1: `migrations/`
- bundle آمادهٔ Direct Upload: `scraper4.worker.js`
- مرجع رفتاری PHP: `scraper4.php`
- گزارش تطبیق 178/178 عملیات و نتیجه تست‌ها: [`CLOUDFLARE-PARITY.md`](CLOUDFLARE-PARITY.md)
- matrix ماشینی تطبیق: `parity-manifest.json` و `parity-audit.json`

Vault با AES-256-GCM و PBKDF2 برابر سقف Cloudflare یعنی 100,000 iteration کار می‌کند. فایل settings قدیمی از مسیر داشبورد وارد می‌شود؛ envelope ناسازگار با iteration بیشتر به‌جای crash با پیام مهاجرت روشن رد می‌شود.
