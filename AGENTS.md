# قرارداد دائمی نسخه‌بندی و گزارش تغییرات

هر تغییری در این مخزن که رفتار helper، gateway، صفحه مدیریت مدل‌ها، tester یا UI چت را عوض کند،
**باید** هر چهار مورد زیر را با هم داشته باشد. این یک قرارداد همیشگی است و در هیچ تغییری استثنا ندارد.

1. **bump نسخه** در `host-helpers/install-openhands-host.sh` (`SCRIPT_VERSION`)
   - رفع باگ یا بهبود جزئی → patch (`3.8.0` → `3.8.1`)
   - قابلیت جدید → minor (`3.8.0` → `3.9.0`)
   - تغییر ناسازگار → major
2. **ورودی جدید در `CHANGELOG.md`** در بالای فایل با همان شماره نسخه و فهرست فارسی تغییرات.
3. **ورودی جدید در آرایه `CHANGELOG` داخل `host-helpers/openhands-model-manager.mjs`** تا همان فهرست
   در تب «تغییرات» صفحه مدیریت و در خروجی `/status` دیده شود.
4. **اجرای کامل آزمایشگاه**: `LAB_JOBS=2 host-helpers/lab/run-all.sh` و کپی evidence تازه در
   `host-helpers/lab/evidence/`.

## اجبار خودکار

- `host-helpers/lab/run-all.sh` با `version_guard` شروع می‌شود و اگر `SCRIPT_VERSION`،
  بالاترین ورودی `CHANGELOG.md` و اولین ورودی آرایه `CHANGELOG` یکی نباشند، کل اجرا fail می‌شود.
- `host-helpers/lab/check-version-bump.sh` بررسی می‌کند که نسبت به `origin/arena/01a0f230-new`
  نسخه بالاتر رفته و changelog به‌روز شده باشد. قبل از هر commit اجرا شود:
  `host-helpers/lab/check-version-bump.sh`
- gate `host-helpers/lab/test-manager-ui.mjs` وجود badge نسخه، تب «تغییرات» و قرارداد `/status`
  (`version` + `changelog`) را assert می‌کند.

## جایی که کاربر نسخه را می‌بیند

- badge «نسخه x.y.z» در هدر صفحه مدیریت مدل‌ها
- تب «تغییرات» با دکمه «کپی گزارش»
- صفت `data-openhands-helper="x.y.z"` روی `<html>` در خود Canvas
- پاسخ `GET /_openhands/models-api/status` (فیلدهای `version` و `changelog`)
