"""Safe categorization, not a claim to have reached a private source website."""
import json
from ..db import utc_now
from .scraping.engines import profile_engine


def failure(exc,counts):
    code=counts.get('last_http_status',0);message=str(exc).lower()
    if code in (401,403):return 'source_access_denied','مبدأ یا شبکهٔ میزبان دسترسی را رد کرده است؛ تغییر سلکتور راه‌حل HTTP 401/403 نیست. محدودیت پلن/شبکه و دسترسی همان مبدأ را بررسی کنید.'
    if code==429:return 'source_rate_limit','مبدأ محدودیت تعداد درخواست داده است؛ پس از زمان انتظار و بررسی نرخ، فقط استخراج را دستی ادامه دهید.'
    if code==404:return 'source_not_found','مسیر مبدأ یا API پیدا نشد؛ آدرس و موتور انتخابی را بررسی کنید.'
    if 'پاسخ api' in message or isinstance(exc,json.JSONDecodeError):return 'invalid_api_response','پاسخ API، JSON معتبر نبود؛ ممکن است صفحهٔ خطا/ضدربات یا پاسخ ناقص برگشته باشد. هیچ داده‌ای به‌عنوان محصول فرض نشده است.'
    if 'رندر' in message or 'renderer' in message:return 'renderer_unavailable','سرویس رندر بیرونی یا تأیید driver آماده نیست؛ انتخاب Playwright/Selenium به‌تنهایی مرورگر نصب نمی‌کند.'
    if code==0 and ('http' in message or 'fetch' in message or 'مهلت' in message):return 'source_network','اتصال، DNS یا مهلت دریافت ناموفق بود؛ خروجی ممکن است محدودیت شبکهٔ میزبان باشد. worker طولانی‌تر فقط برای منابع کند است، نه دورزدن ممنوعیت شبکه.'
    if isinstance(exc,(TypeError,AttributeError,KeyError)):return 'source_shape','ساختار دادهٔ مبدأ/فیلدهای اختیاری مطابق انتظار نبود؛ گزارش موتور و صفحهٔ شکست را بررسی کنید.'
    return 'extraction_error','پیکربندی موتور، CSS، صفحه‌بندی یا پاسخ مبدأ نیاز به بررسی دارد. متن خام پاسخ و کلیدهای اتصال در گزارش امن قرار نمی‌گیرند.'


SAFE_HINTS=dict(failure(exc,counts) for exc,counts in [
    (ValueError(''),{'last_http_status':403}),(ValueError(''),{'last_http_status':429}),(ValueError(''),{'last_http_status':404}),
    (ValueError('پاسخ API'),{}),(ValueError('رندر'),{}),(ValueError('fetch'),{}),(TypeError(),{}),(ValueError('other'),{})])


def report(db,settings):
    profiles={p['id']:p for p in db.list_profiles()};items=[]
    with db.connect() as conn:
        rows=conn.execute("SELECT id,profile_id,status,counters,updated_at FROM queue_entries WHERE kind='extract' ORDER BY id DESC LIMIT 100").fetchall()
    for row in rows:
        p=profiles.get(row['profile_id'])
        try:counts=json.loads(row['counters'] or '{}')
        except ValueError:counts={}
        if not isinstance(counts,dict):counts={}
        safe={k:counts[k] for k in ('last_http_status','last_page_products','found','current','total','detail_current','detail_total','last_html_chars') if type(counts.get(k)) is int}
        error_code=counts.get('error_code') if counts.get('error_code') in ('source_access_denied','source_rate_limit','source_not_found','invalid_api_response','renderer_unavailable','source_network','source_shape','extraction_error') else None
        hint=SAFE_HINTS.get(error_code,'')
        # Legacy raw errors/URLs, HTML, selectors, settings, payloads and tokens are deliberately omitted.
        items.append({'job_id':row['id'],'profile_id':row['profile_id'],'status':row['status'],'engine':profile_engine(p) if p else 'profile_deleted','updated_at':row['updated_at'],
                      'counts':safe,'error_code':error_code,'hint':hint if error_code else 'گزارش دسته‌بندی‌شده از این اجرای قدیمی در دسترس نیست؛ متن خام خطا عمداً خارج از گزارش امن است.'})
    return {'ok':True,'generated_at':utc_now(),'jobs':items,'renderer_configured':bool(db.get_config('render').get('url') or settings.render.url),
            'cron_public_get':db.checkpoint_read('cron:config').get('public_get') is True,
            'read_only':True,'source_reachability_tested':False,'note':'این گزارش فقط صف ذخیره‌شده را می‌خواند؛ سایت‌های خصوصی را آزمایش و صف/کلیدها/تنظیم کران را تغییر نمی‌دهد.'}
