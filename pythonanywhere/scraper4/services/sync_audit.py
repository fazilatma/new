"""Paged PHP sync_diagnose parity: all profiles, local checks, NEVER repairs.

No credentials/URLs/raw errors in output. Configuration checks and bounded price
samples are not remote connectivity, stock, media or destination validation.
"""
import math
import time
from ..db import utc_now
from ..config import VERSION
from . import php_ui, php_ui_pipeline, profile_options, worker_runtime
from .basalam import shops
from .scraping.detail import normalize_selectors
from .github_products import config as github_config

PAGE=25


def check(stage,status,code,message,**counts):
    return {'stage':stage,'status':status,'code':code,'message':message,'counts':counts}


def profile(db,settings,p):
    opts=php_ui.start_page.options(p);engine=php_ui.profile_engine(p);checks=[]
    if opts['source']=='github':
        try:github_config(opts['github']);checks.append(check('source','configured','public_file_config','تنظیمات فایل عمومی معتبر است؛ دسترسی فایل آزمایش نشده است.'))
        except (ValueError,TypeError):checks.append(check('source','blocked','invalid_public_file','تنظیمات فایل عمومی ناقص است.'))
    else:
        renderer=bool(db.get_config('render').get('url') or settings.render.url)
        if engine in ('playwright','selenium') and not renderer:
            checks.append(check('source','blocked','renderer_missing','سرویس رندر مورد نیاز پیکربندی نشده است.'))
        else:checks.append(check('source','not_tested','network_not_tested','شبکهٔ مبدأ فقط با آزمایش صریح بررسی می‌شود.'))
        selected=bool(p['selectors'].get('container') and p['selectors'].get('title'))
        checks.append(check('extraction','configured' if selected or engine!='selectors' else 'warning','listing_configuration','موتور و سلکتورها فقط از تنظیمات ذخیره‌شده بررسی شدند؛ موتور ممکن است fallback خودکار داشته باشد.',listing_selectors=int(selected)))
    try:
        details=normalize_selectors(p['settings'].get('detailSelectors') or {})
        state='configured' if opts['with_detail'] and details else 'skipped'
        checks.append(check('detail',state,'detail_configuration','جزئیات بدون سلکتور فعال اجرا نمی‌شود؛ این بررسی تضمین دریافت جزئیات نیست.',selectors=len(details),enabled=int(opts['with_detail'])))
    except (ValueError,TypeError):checks.append(check('detail','blocked','invalid_detail_config','تنظیمات سلکتور جزئیات معتبر نیست.'))
    with db.connect() as conn:
        conn.create_function('s4_detail_checked',1,lambda raw:int(bool(php_ui_pipeline.obj(raw).get('_detail_checked_at'))))
        count=dict(conn.execute("""SELECT COUNT(*) AS total,COALESCE(SUM(price_num<=0),0) AS no_price,
            COALESCE(SUM(image=''),0) AS no_image,COALESCE(SUM(link=''),0) AS no_link,
            COALESCE(SUM(s4_detail_checked(extra)),0) AS detail_checked,
            COALESCE(SUM(woo_id IS NOT NULL),0) AS woo_mapped,COALESCE(SUM(basalam_id IS NOT NULL),0) AS legacy_basalam_mapped
            FROM products WHERE profile_id=?""",(p['id'],)).fetchone())
        samples=conn.execute('SELECT price_num FROM products WHERE profile_id=? ORDER BY id LIMIT 20',(p['id'],)).fetchall()
        queue=[dict(r) for r in conn.execute('SELECT kind,status,COUNT(*) AS count FROM queue_entries WHERE profile_id=? GROUP BY kind,status',(p['id'],))]
        sends=conn.execute("SELECT kind,payload FROM queue_entries WHERE profile_id=? AND kind IN ('woo_send','bsl_send') AND status IN ('waiting','running','paused','failed') ORDER BY id LIMIT 101",(p['id'],)).fetchall()
    for item in queue:
        if item['kind'] not in ('extract','woo_send','bsl_send'):item['kind']='unknown'
        if item['status'] not in ('waiting','running','paused','failed','done','cancelled'):item['status']='unknown'
    checks.append(check('products','warning' if not count['total'] or count['no_price'] or count['no_image'] or count['no_link'] else 'observed','saved_product_quality','شمارش محلیِ فیلدهای خالی است؛ اعتبار URL، موجودی، رسانه و تطبیق مقصد را تأیید نمی‌کند.',**count))
    try:
        profile_options.active(p)
        for row in samples:
            for target in ('woo','basalam'):profile_options.price(p,row['price_num'],target)
        checks.append(check('pricing','configured','price_sample_valid','تنظیمات قیمت و نمونهٔ محدود قابل محاسبه است؛ تبدیل ارز یا قیمت زندهٔ مقصد بررسی نشده است.',sampled=len(samples),sample_limit=20))
    except (ValueError,TypeError,ArithmeticError):checks.append(check('pricing','blocked','invalid_pricing','تنظیمات یا نمونهٔ قیمت قابل محاسبه نیست؛ هیچ قیمتی بازنویسی نشد.'))
    woo=db.get_config('woocommerce');woo_ok=all(woo.get(k) for k in ('store_url','consumer_key','consumer_secret'))
    checks.append(check('woo_connection','configured' if woo_ok else 'warning','woo_saved_connection','وجود تنظیمات ووکامرس، تأیید دسترسی یا اعتبار کلید نیست.',configured=int(woo_ok)))
    try:
        vendors=shops.all_shops(db.get_config('basalam'));ready=sum(bool(v.get('token')) for v in vendors)
        checks.append(check('basalam_connection','configured' if ready and ready==len(vendors) else 'warning','basalam_saved_connections','فقط تعداد اتصال‌های ذخیره‌شده؛ فیلدهای الزامی و اعتبار توکن مقصد آزمایش نشده است.',shops=len(vendors),with_token=ready))
    except (ValueError,TypeError):checks.append(check('basalam_connection','blocked','invalid_shops_config','ساختار اتصال غرفه‌ها معتبر نیست.'))
    missing=0
    for send in sends[:100]:
        if send['kind']=='woo_send':missing+=not woo_ok
        else:
            try:shops.resolve(db.get_config('basalam'),php_ui_pipeline.obj(send['payload']).get('vendor_id') or '')
            except (ValueError,TypeError):missing+=1
    checks.append(check('send_targets','blocked' if missing else 'observed','queued_destinations','اتصالِ مقصدهای صف فعال بررسی شد؛ هیچ درخواست ارسالی یا تلاش مجددی انجام نشد.',invalid=missing,examined=min(len(sends),100),truncated=int(len(sends)>100)))
    failed=sum(r['count'] for r in queue if r['status']=='failed');paused=sum(r['count'] for r in queue if r['status']=='paused')
    checks.append(check('queues','blocked' if failed else 'warning' if paused else 'observed','queue_states','کار ناموفق خودکار ادامه داده نمی‌شود؛ برای ارسال ناموفق ابتدا مقصد و شناسه‌ها را بررسی کنید.',failed=failed,paused=paused))
    pipe=php_ui_pipeline.status(db,{'profile':p['key']})
    issues=sum(r['status'] in ('incomplete','failed','completed_with_errors') for r in pipe['rows'])
    checks.append(check('pipeline','blocked' if issues else 'observed','pipeline_provenance','ارتباط استخراج و صف‌های فرزند بررسی شد؛ صف گمشده خودکار ساخته نمی‌شود.',issues=issues,examined=len(pipe['rows']),truncated=int(pipe['truncated'])))
    return {'id':p['id'],'name':p['name'],'enabled':bool(p['enabled']),'engine':engine,'source':opts['source'],
            'checks':checks,'queue_summary':queue,'pipeline':pipe,'needs_review':any(c['status'] in ('blocked','warning') for c in checks),
            'source_reachability_tested':False,'destination_reachability_tested':False}


def page(db,settings,fields):
    if set(fields)-{'after_id','through_id'}:raise ValueError('فقط after_id و through_id پذیرفته می‌شوند.')
    after=php_ui.integer(fields.get('after_id','0'),minimum=0,maximum=2**63-1)
    with db.connect() as conn:
        maximum=conn.execute('SELECT COALESCE(MAX(id),0) FROM profiles').fetchone()[0]
        through=php_ui.integer(fields.get('through_id',str(maximum)),minimum=0,maximum=2**63-1)
        if after>through:raise ValueError('بازهٔ پروفایل معتبر نیست.')
        ids=[r[0] for r in conn.execute('SELECT id FROM profiles WHERE id>? AND id<=? ORDER BY id LIMIT ?',(after,through,PAGE+1))]
        total=conn.execute('SELECT COUNT(*) FROM profiles WHERE id<=?',(through,)).fetchone()[0]
        orphaned=conn.execute('SELECT COUNT(*) FROM queue_entries WHERE profile_id IS NULL').fetchone()[0]
    rows=[]
    for pid in ids[:PAGE]:
        p=None
        try:
            p=db.get_profile(pid)
            if p:rows.append(profile(db,settings,p))
            else:rows.append({'id':pid,'name':'پروفایل حذف‌شده','checks':[check('profile','warning','deleted_during_audit','پروفایل حین بررسی حذف شد.')],'needs_review':True})
        except (ValueError,TypeError,KeyError,AttributeError):
            rows.append({'id':pid,'name':p.get('name','') if p else '', 'checks':[check('profile','blocked','invalid_saved_configuration','تنظیمات ذخیره‌شده معتبر نیست؛ متن خام برای حفظ اطلاعات محرمانه حذف شد.')],'needs_review':True})
    worker=worker_runtime.status(db,settings);last=db.checkpoint_read('cron:last')
    epoch=last.get('started_epoch');cron_age=max(0,int(time.time()-epoch)) if type(epoch) in (int,float) and math.isfinite(epoch) and epoch>0 else None
    runtime={'cron_last_age_seconds':cron_age,'cron_last_status':last.get('status') if last.get('status') in ('running','done','failed') else 'unknown',
             'continuation_unconfirmed':not worker['observed_running'] and (cron_age is None or cron_age>300),
             'worker_configured':worker['config']['enabled'],'worker_observed_running':worker['observed_running'],
             'worker_heartbeat_age_seconds':worker['heartbeat_age_seconds'],
             'cron_seen':bool(last),'cron_key_configured':bool(db.get_config('cron_auth').get('sha256')),
             'cron_public_get':db.checkpoint_read('cron:config').get('public_get') is True,
             'orphaned_queue_entries':orphaned,
             'note':'worker تنظیم‌شده با اجرای مشاهده‌شده فرق دارد؛ وجود کلید/سابقهٔ کران اثبات زمان‌بندی فعال نیست. هیچ تنظیم یا کلیدی تغییر نکرد.'}
    return {'ok':True,'version':VERSION,'format':'scraper4-all-profile-audit-v1','generated_at':utc_now(),
            'profiles':rows,'runtime':runtime,'limit':PAGE,'total_profiles':total,'through_id':through,
            'next_after_id':ids[PAGE-1] if len(ids)>PAGE else None,'read_only':True,'processed':False,
            'source_reachability_tested':False,'destination_reachability_tested':False,
            'scope':'saved_configuration_local_products_and_queues','point_in_time_snapshot':False,
            'note':'گزارش صفحه‌ای است؛ پروفایل‌های جدید بعد از through_id در اجرای بعد بررسی می‌شوند. تغییر همزمان تنظیمات ممکن است بین صفحات رخ دهد؛ همهٔ توابع PHP منتقل نشده‌اند.'}
