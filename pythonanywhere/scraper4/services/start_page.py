"""PHP Start Product metrics, detail coverage and durable local-target history.

Counts are saved source records / local destination mappings, NEVER remote stock
or price-discrepancy claims. No outbound calls or product writes in overview.
"""
import json
import math
import uuid
from datetime import datetime, timezone
from urllib.parse import urlsplit

from ..db import utc_now
from .product_browser import extra
from .scraping.detail import text_html, normalize_selectors
from .scraping.engines import profile_engine, ENGINES
from .scraping.fetch import validate_url
from .scraping.pagination import TYPES
from .basalam.shops import public_shops
from .support.url import is_image

METRICS = {
    'all':('📦','کل محصولات'), 'priced':('💰','دارای قیمت'), 'no_price':('⚠️','بدون قیمت'),
    'in_stock':('✅','موجود صریح'), 'out_stock':('⛔','ناموجود صریح'), 'stock_unknown':('❔','موجودی نامشخص'),
    'has_image':('🖼️','دارای تصویر'), 'no_image':('🌫️','بدون تصویر'), 'gallery':('🎞️','دارای گالری'),
    'variations':('🎨','دارای تنوع'), 'web_link':('🔗','دارای لینک'), 'sku':('🏷️','دارای SKU'),
    'description':('📝','دارای توضیحات'), 'category':('📂','دارای دسته'), 'brand':('🏭','دارای برند'),
    'ready':('🚀','آمادهٔ پایهٔ ارسال'),
}
EXTRA_FILTERS = set(METRICS)-{'all','priced','no_price','sku'} | {'detail_present','detail_checked'}


def http_url(value):
    if not isinstance(value,str) or len(value)>4096:return False
    try:
        validate_url(value)
        return bool(urlsplit(value).hostname)
    except (ValueError,TypeError):return False


def flags(row):
    data=extra(row.get('extra')) if isinstance(row.get('extra'),str) else row.get('extra') or {}
    if not isinstance(data,dict):data={}
    images=[]
    for value in [row.get('image'),*(data.get('images') if isinstance(data.get('images'),list) else [])]:
        value=value.strip() if isinstance(value,str) else ''
        if http_url(value) and is_image(value) and value not in images:images.append(value)
    stock=data.get('stock',data.get('inventory',data.get('stock_quantity')))
    status=str(data.get('stock_status') or '').strip().lower()
    # PHP stock/inventory/status rules; API in_stock is also an explicit signal.
    numeric=None
    if type(stock) in (float,int) or isinstance(stock,str):
        try:
            n=float(stock)
            if math.isfinite(n):numeric=n
        except (TypeError,ValueError):pass
    inside=status=='instock' or (numeric is not None and numeric>0) or data.get('in_stock') is True
    outside=status in ('outofstock','out_of_stock') or (numeric is not None and numeric<=0) or data.get('in_stock') is False
    description=any(str(data.get(k) or '').strip() for k in ('shortDesc','short_desc','longDesc','description'))
    price=(row.get('price_num') or 0)>0;image=bool(images);link=http_url(row.get('link'))
    present=lambda value:bool(value.strip()) if isinstance(value,str) else bool(value)
    detail=description or bool(data.get('specs_rows')) or bool(text_html(str(data.get('specs') or '')).strip()) or len(images)>1
    return {'all':True,'priced':price,'no_price':not price,'in_stock':inside,'out_stock':outside,'stock_unknown':not inside and not outside,
            'has_image':image,'no_image':not image,'gallery':len(images)>1,'variations':present(data.get('variations')),
            'web_link':link,'sku':bool(str(row.get('sku') or '').strip()),'description':description,'category':present(data.get('category') or data.get('categories')),
            'brand':bool(str(data.get('brand') or '').strip()),'ready':price and image and link,
            'detail_present':detail,'detail_checked':bool(data.get('_detail_checked_at'))}


def metric_test(image,link,price,sku,raw,key):
    return int(flags({'image':image,'link':link,'price_num':price,'sku':sku,'extra':raw}).get(key,False))


def options(profile):
    s=profile.get('settings') or {};old=s.get('legacy_profile_settings') or {};old=old if isinstance(old,dict) else {}
    source=s.get('productSource',old.get('productSource','direct'))
    github=s.get('sourceGithub') or (source if isinstance(source,dict) else {})
    source=source.get('mode','direct') if isinstance(source,dict) else source
    pages=s.get('startPages',old.get('pages',10))
    return {'pages':pages if type(pages) is int and 0<=pages<=1000 else 10,
            'with_detail':bool(s.get('startWithDetail',old.get('backendExtractWithDetail',True))),
            'detail_mode':'inline' if s.get('detailExtractMode',old.get('detailExtractMode'))=='inline' else 'two_stage',
            'source':source if source in ('github','direct') else 'direct','github':github}


def history_view(value):
    return {'updates':value.get('updates',[])[-60:],'daily':value.get('daily',[])[-30:]}


def overview(db):
    with db.connect() as conn:
        conn.execute('BEGIN')
        profiles=[{**dict(p),'settings':extra(p['settings'])} for p in conn.execute('SELECT * FROM profiles')]
        cfg=db.get_config('basalam')
        shops=public_shops(cfg)
        owner=str(db.checkpoint_read('basalam:legacy_owner').get('vendor_id') or cfg.get('vendor_id') or '')
        if owner.isascii() and owner.isdigit():owner=str(int(owner))
        destinations=[{'key':'woo','label':'ووکامرس','type':'woo'}]+[{'key':'bsl:'+v['vendor_id'],'label':v['shop_name'],'type':'bsl','vendor_id':v['vendor_id']} for v in shops]
        rows={}
        for p in profiles:
            try: detail=normalize_selectors(p['settings'].get('detailSelectors') or {})
            except ValueError: detail={}
            rows[p['id']]={'id':p['id'],'key':p['key'],'name':p['name'] or p['key'],'enabled':p['enabled'],'engine':profile_engine(p),
                'counts':dict.fromkeys(METRICS,0),'detail':{'selectors':len(detail),'present':0,'checked':0},'destinations':dict.fromkeys([d['key'] for d in destinations],0)}
        totals=dict.fromkeys(METRICS,0);dest_totals=dict.fromkeys([d['key'] for d in destinations],0)
        for raw in conn.execute('SELECT id,profile_id,image,link,price_num,sku,extra,woo_id,basalam_id FROM products'):
            product=dict(raw);entry=rows.get(product['profile_id'])
            if not entry:continue
            data=extra(product['extra']);value=flags({**product,'extra':data})
            for key in METRICS:
                if value[key]:totals[key]+=1;entry['counts'][key]+=1
            entry['detail']['present']+=int(value['detail_present']);entry['detail']['checked']+=int(value['detail_checked'])
            mappings=data.get('basalam_targets') or {};mappings=dict(mappings) if isinstance(mappings,dict) else {}
            if product['basalam_id'] and owner:mappings.setdefault(owner,product['basalam_id'])
            for dest in destinations:
                remote=product['woo_id'] if dest['type']=='woo' else mappings.get(dest['vendor_id'])
                count=str(remote or '').isascii() and str(remote or '').isdigit() and int(remote)>0
                if count:entry['destinations'][dest['key']]+=1;dest_totals[dest['key']]+=1
        for job in conn.execute("SELECT id,profile_id,status,counters FROM queue_entries WHERE kind='extract' ORDER BY id"):
            if job['profile_id'] in rows:rows[job['profile_id']]['extraction']={'id':job['id'],'status':job['status'],'counters':json.loads(job['counters'] or '{}')}
    history=db.checkpoint_read('start:history')
    return {'ok':True,'totals':totals,'by_profile':sorted(rows.values(),key=lambda p:(-p['counts']['all'],p['id'])),
            'metrics':[{'id':key,'icon':v[0],'label':v[1]} for key,v in METRICS.items()], 'destinations':destinations,'destination_totals':dest_totals,
            'shop_total':sum(n for k,n in dest_totals.items() if k.startswith('bsl:')),'shop_count':len(shops),'generated_at':utc_now(),
            'history':history_view(history),'source':'local_saved_products_and_remote_ids','remote_inventory':False}


def snapshot(db):
    result=overview(db);now=datetime.now(timezone.utc);day=now.date().isoformat()
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        raw=conn.execute("SELECT state FROM task_checkpoints WHERE task='start:history'").fetchone()
        saved=json.loads(raw['state']) if raw else {}
        updates=saved.get('updates',[]);daily=saved.get('daily',[])
        last=updates[-1].get('epoch',0) if updates else 0
        if now.timestamp()-last<60:return {**result,'history':history_view(saved),'snapshot_recorded':False,'retry_after_seconds':math.ceil(60-now.timestamp()+last)}
        point={'at':now.isoformat(),'epoch':now.timestamp(),'date':day,'total':result['shop_total'],'shops':result['shop_count'],'source':'local_remote_ids'}
        updates=(updates+[point])[-720:];daily=([p for p in daily if p.get('date')!=day]+[point])[-180:]
        value={'updates':updates,'daily':daily};stamp=utc_now()
        conn.execute('''INSERT INTO task_checkpoints (task,state,created_at,updated_at) VALUES (?,?,?,?)
            ON CONFLICT(task) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at''',('start:history',json.dumps(value),stamp,stamp))
    return {**result,'history':history_view(value),'snapshot_recorded':True}


def save_profile(db,data):
    if not isinstance(data,dict) or set(data)-{'id','name','url','engine','pagination','pages','with_detail','detail_mode','source','github'}:raise ValueError('فیلد پروفایل معتبر نیست.')
    previous=db.get_profile(data['id']) if type(data.get('id')) is int else None
    if data.get('id') is not None and not previous:raise ValueError('پروفایل پیدا نشد.')
    name=data.get('name');url=data.get('url');engine=data.get('engine')
    if not isinstance(name,str) or not name.strip() or len(name)>200:raise ValueError('نام پروفایل لازم است؛ حداکثر ۲۰۰ نویسه.')
    if not isinstance(url,str) or len(url)>2000:raise ValueError('آدرس معتبر لازم است.')
    validate_url(url)
    if not isinstance(engine,str) or engine not in ENGINES:raise ValueError('موتور معتبر نیست.')
    pagination=data.get('pagination')
    if not isinstance(pagination,dict) or set(pagination)-{'type','val'} or pagination.get('type') not in TYPES or not isinstance(pagination.get('val',''),str) or len(pagination.get('val',''))>1000:raise ValueError('صفحه‌بندی معتبر نیست.')
    if pagination['type']=='next_selector' and not pagination.get('val'):raise ValueError('سلکتور بعدی لازم است.')
    if pagination['type']=='full_pattern':validate_url(pagination.get('val','').replace('{page}','2'))
    pages=data.get('pages',10)
    if type(pages) is not int or not 0<=pages<=1000:raise ValueError('تعداد صفحه از ۰ تا ۱۰۰۰؛ صفر تشخیص پایان خودکار است.')
    if type(data.get('with_detail',True)) is not bool or data.get('detail_mode','two_stage') not in ('two_stage','inline'):raise ValueError('حالت جزئیات معتبر نیست.')
    source=data.get('source','direct')
    if source not in ('direct','github'):raise ValueError('منبع معتبر نیست.')
    from .github_products import config
    github=config(data.get('github')) if source=='github' else (previous or {}).get('settings',{}).get('sourceGithub',{})
    from .scraping.engines import source_api
    engine=source_api(url) or engine
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if previous:
            raw=conn.execute('SELECT * FROM profiles WHERE id=?',(previous['id'],)).fetchone()
            if not raw:raise ValueError('پروفایل حذف شده است؛ دوباره انتخاب کنید.')
            previous={**dict(raw),'settings':extra(raw['settings']),'pagination':extra(raw['pagination'])}
            alive=conn.execute("SELECT id FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running','paused') LIMIT 1",(previous['id'],)).fetchone()
            old=options(previous)
            if alive and (url!=previous['url'] or engine!=profile_engine(previous) or pagination!=previous['pagination'] or source!=old['source'] or (source=='github' and github!=old['github'])):raise ValueError('برای تغییر منبع/آدرس/موتور پروفایل، ابتدا کارهای فعال آن را لغو کنید؛ مکث به‌تنهایی کافی نیست.')
        cfg=dict((previous or {}).get('settings') or {})
        cfg.update(productSource=source,sourceGithub=github,extractionEngine=engine,startPages=pages,startWithDetail=data.get('with_detail',True),detailExtractMode=data.get('detail_mode','two_stage'))
        now=utc_now()
        if previous:
            conn.execute('UPDATE profiles SET name=?,url=?,pagination=?,settings=?,updated_at=? WHERE id=?',
                         (name.strip(),url,json.dumps(pagination),json.dumps(cfg,ensure_ascii=False),now,previous['id']))
            profile_id=previous['id']
        else:
            cursor=conn.execute("INSERT INTO profiles(key,name,url,selectors,pagination,settings,enabled,created_at,updated_at) VALUES (?,?,?,'{}',?,?,1,?,?)",
                         ('profile-'+uuid.uuid4().hex,name.strip(),url,json.dumps(pagination),json.dumps(cfg,ensure_ascii=False),now,now))
            profile_id=cursor.lastrowid
    return db.get_profile(profile_id)
