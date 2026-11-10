"""PHP gallery_test slice: explicit stored product, one bounded source read.

Never writes products/queues or accepts caller-selected remote URLs. Image URLs
are returned, not downloaded or proxied; image editing remains unimplemented.
"""
from threading import BoundedSemaphore
from .scraping.engines import extract,for_installation,source_api,profile_engine
from .scraping.detail import parse_detail,web_url
from .scraping.parser import json_ld_fallback,load_dom
from .scraping.network_errors import KINDS,MESSAGES

_GATE=BoundedSemaphore(1)


def preview(db,settings,data):
    if not isinstance(data,dict) or set(data)-{'profile_id','product_id'} or type(data.get('profile_id')) is not int:raise ValueError('شناسهٔ پروفایل ذخیره‌شده لازم است؛ URL دلخواه پذیرفته نمی‌شود.')
    p=db.get_profile(data['profile_id'])
    if not p:raise ValueError('پروفایل پیدا نشد.')
    if 'product_id' in data and (type(data['product_id']) is not int or data['product_id']<=0):raise ValueError('شناسهٔ محصول معتبر نیست.')
    with db.connect() as conn:
        row=conn.execute("SELECT id,link FROM products WHERE profile_id=? AND trim(link)<>''"+(' AND id=?' if 'product_id' in data else '')+' ORDER BY id LIMIT 1',(p['id'],data['product_id']) if 'product_id' in data else (p['id'],)).fetchone()
    if not row:raise ValueError('محصول ذخیره‌شدهٔ دارای لینک در این پروفایل پیدا نشد؛ ابتدا فهرست را استخراج کنید.')
    if not _GATE.acquire(False):return {'ok':False,'error':'آزمایش گالری دیگری در حال اجراست.'},429
    try:
        engine=source_api(row['link']) or profile_engine(p)
        result=extract(row['link'],{},engine,for_installation(settings,db),timeout=8,probe=True)
        images=[];mode='public_api' if engine.endswith('_api') else 'saved_css_or_product_jsonld'
        def add(value):
            if isinstance(value,str) and len(value)<=2048:
                url=web_url(value,row['link'])
                if url and url not in images and len(images)<30:images.append(url)
        if engine.endswith('_api'):
            for record in result['products'].values():
                for image in record.get('images') or []:add(image)
                add(record.get('image'))
        else:
            selectors=p['settings'].get('detailSelectors') or {}
            css=selectors.get('images') or '.woocommerce-product-gallery, .product-gallery, .gallery'
            if isinstance(css,dict):css=css.get('selector') if css.get('enabled',True) else ''
            if css:
                for image in parse_detail(result.get('html',''),result.get('url') or row['link'],{'images':css}).get('images',[]):add(image)
            for record in json_ld_fallback(load_dom(result.get('html','')),row['link'],{}).values():
                for image in record.get('images') or []:add(image)
                add(record.get('image'))
        return {'ok':True,'profile_id':p['id'],'product_id':row['id'],'engine':result['engine'],'mode':mode,'count':len(images),'images':images,
                'products_changed':False,'queue_changed':False,'image_bytes_downloaded':False,
                'note':'فقط نمونهٔ ذخیره‌شده از مبدأ خوانده شد؛ تصویرها دانلود/ویرایش و محصولات/صف تغییر نکردند. صفر عکس موفقیت استخراج گالری نیست.'},200
    except ValueError as exc:
        kind=getattr(exc,'network_error','')
        return {'ok':False,'error':MESSAGES.get(kind,'دریافت یا پردازش گالری مبدأ ناموفق بود؛ مسیر/API/سلکتور را بررسی کنید.'),'network_error':kind if kind in KINDS else '',
                'http_status':getattr(exc,'upstream_status',0),'products_changed':False,'queue_changed':False},502
    finally:_GATE.release()
