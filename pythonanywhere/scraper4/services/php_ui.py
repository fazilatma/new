"""Pinned original PHP client and an explicitly bounded Python compatibility API.

No PHP interpreter, shell or arbitrary endpoint routing. The original client is
untrusted with respect to admin authority: it runs in an opaque sandbox; only
the trusted parent has CSRF authority. Unknown operations never return success.
"""
import hashlib
import html
import json
import re
import time
import uuid
from datetime import datetime
from pathlib import Path

from ..db import utc_now
from . import profile_options, start_page
from .extraction_diagnostics import SAFE_HINTS
from .basalam.shops import public_shops
from .scraping.engines import ENGINES, profile_engine
from .scraping.fetch import validate_url
from .scraping.pagination import TYPES
from .scraping.detail import normalize_selectors

ROOT=Path(__file__).resolve().parents[1]
READS={'app_ready','load_profile','load_connections','start_product_stats','extract_queue_status','whoami'}
WRITES={'save_profile','python_enqueue'}
UNSUPPORTED='این عملیات رابط PHP هنوز به پایتون متصل نیست؛ هیچ تغییری انجام نشد.'


def manifest():return json.loads((ROOT/'upstream/manifest.json').read_text())


def js(value):
    return json.dumps(value,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c').replace('>','\\u003e').replace('&','\\u0026').replace('\u2028','\\u2028').replace('\u2029','\\u2029')


def revision(p):
    return hashlib.sha256(json.dumps({k:p.get(k) for k in ('id','name','url','settings','selectors','pagination','enabled','updated_at')},sort_keys=True,ensure_ascii=False).encode()).hexdigest()


def stamp(value):
    try:return int(datetime.fromisoformat(value).timestamp())
    except (ValueError,TypeError):return 1


def summaries(db):
    return [{'key':p['key'],'url':p['url'],'name':p['name'],'productCount':p['products_count'],'updatedAt':stamp(p['updated_at'])} for p in db.list_profiles()]


def render(db):
    meta=manifest();raw=(ROOT/'upstream/php-ui.html').read_bytes()
    if hashlib.sha256(raw).hexdigest()!=meta['client_sha256']:raise ValueError('Original PHP client integrity mismatch')
    text=raw.decode()
    fonts={'system':('پیش‌فرض سیستم','Tahoma,system-ui,sans-serif'),'vazirmatn':('وزیرمتن — Vazirmatn','Vazirmatn,Tahoma,sans-serif'),'sahel':('ساحل — Sahel','Sahel,Tahoma,sans-serif')}
    # Server-generated foreach output, not a rewrite of the original client.
    pattern=r'<\?php foreach \(app_fonts_registry\(\).*?<\?php endforeach; \?>'
    text=re.sub(pattern,lambda m:''.join('<option value="'+k+'" data-stack="'+html.escape(stack,quote=True)+'">'+label+'</option>' for k,(label,stack) in fonts.items()),text,flags=re.S)
    pattern=r'<\?php foreach \(app_themes_registry\(\).*?<\?php endforeach; \?>'
    text=re.sub(pattern,lambda m:'<option value="ocean">🌊 اقیانوس شب (پیش‌فرض)</option>' if '$sw =' not in m.group() else '<button type="button" class="theme-swatch" data-theme="ocean">🌊 اقیانوس شب</button>',text,flags=re.S)
    replacements={
      '<?= app_font_boot() ?>':'<script src="/static/php-ui-frame.js"></script><style>@font-face{font-family:Vazirmatn;src:url(/static/fonts/Vazirmatn-Regular.woff2)}@font-face{font-family:Vazirmatn;font-weight:700;src:url(/static/fonts/Vazirmatn-Bold.woff2)}@font-face{font-family:Sahel;src:url(/static/fonts/Sahel.woff2)}@font-face{font-family:Sahel;font-weight:700;src:url(/static/fonts/Sahel-Bold.woff2)}</style>',
      '<?= app_theme_boot() ?>':'','<?= app_fx_boot() ?>':'',
      # PHP/WordPress authority must not cross into this opaque Python client.
      "<?php echo json_encode(function_exists('wp_create_nonce')?wp_create_nonce('s4_code_update'):''); ?>":'""',
      '<?php echo json_encode(s4ThirdPartyExplorerBrowserNonce()); ?>':'""',
      "<?= (int)cronVisualPulseRead()['latest_id'] ?>":'0','<?=APP_VERSION?>':meta['source_version'],
      '<?= (int)RETIRE_LOG_KEEP ?>':'300','<?=h(DEFAULT_URL)?>':'https://example.com/shop/',
      "<?= selagentPromptEditorHtml('list') ?>":'<p>ویرایش پرامپت ایجنت هنوز به پایتون متصل نیست.</p>',
      "<?= selagentPromptEditorHtml('detail') ?>":'<p>ویرایش پرامپت ایجنت هنوز به پایتون متصل نیست.</p>',
      '<?=json_encode($initialProfiles, JSON_UNESCAPED_UNICODE)?>':js(summaries(db)),
      '<?=json_encode(s4GithubDefaultRepo(), JSON_UNESCAPED_UNICODE)?>':js('fazilatma/new'),
      '<?=json_encode(s4GithubDefaultBranch(), JSON_UNESCAPED_UNICODE)?>':js('main'),
      "<?=s4DiskCodeMeta()['sha']?>":meta['source_sha256'],
      '<?= VAPID_PUBLIC_KEY_B64URL ?>':'','<?=APP_VERSION_DATE?>':meta.get('source_version_date',''),'<?= (int)DEDUP_DEL_MAX ?>':'2000',
    }
    def slot(match):
        token=match.group()
        if token.startswith('<?php /* v10.78'):return '' # Never inject arbitrary saved Najva JS.
        if token not in replacements:raise ValueError('Unknown upstream PHP output slot')
        return replacements[token]
    text=re.sub(r'<\?(?:php|=).*?\?>',slot,text,flags=re.S)
    if '<?' in text:raise ValueError('Unresolved PHP slot')
    head,tail=text.rsplit('</body>',1)
    return head+'<script src="/static/php-ui-attach.js"></script><script src="/static/php-ui-start.js"></script></body>'+tail


def find(db,value):
    if not isinstance(value,str) or len(value)>2000:raise ValueError('شناسهٔ پروفایل معتبر نیست.')
    hit=next((p for p in db.list_profiles() if p['key']==value),None)
    if not hit:
        matches=[p for p in db.list_profiles() if p['url']==value]
        if len(matches)==1:hit=matches[0]
    if not hit:raise ValueError('پروفایل پیدا نشد؛ از فهرست همان پروفایل را انتخاب کنید.')
    return hit


def load(db,p):
    opts=start_page.options(p);settings=p['settings'];values=profile_options.editor(p)
    rows=db.list_products(p['id'],limit=1000)
    products=[]
    for row in rows:
        data=json.loads(row.get('extra') or '{}');data=data if isinstance(data,dict) else {}
        # Explicit public product fields only; no opaque profile settings/credentials.
        product={k:row.get(k) for k in ('title','price','price_num','link','image','sku','woo_id','basalam_id')}
        for k in ('images','brand','category','tags','in_stock','stock','stock_status','longDesc','shortDesc','variations'):
            if k in data:product[k]=data[k]
        products.append([row['key'],product])
    return {'id':p['id'],'url':p['url'],'name':p['name'],'updatedAt':stamp(p['updated_at']),'pages':opts['pages'],'extractionEngine':profile_engine(p),
            'pagType':p['pagination'].get('type','query_page'),'pagVal':p['pagination'].get('val',''),'selectors':p['selectors'],
            'detailSelectors':{k:{'enabled':True,'selector':v} for k,v in normalize_selectors(settings.get('detailSelectors',{})).items()},
            **values,'wooCategoryId':values['wooProfileCatId'],'bslCategoryId':values['bslProfileCatId'],
            'backendExtractWithDetail':opts['with_detail'],'detailExtractMode':opts['detail_mode'],
            'productSource':{'mode':opts['source'],**(opts['github'] if opts['source']=='github' else {})},
            'products':products,'productsOrder':[r[0] for r in products],'_python_products_truncated':p['products_count']>len(rows)}


def stats(db):
    value=start_page.overview(db);rename={'all':'total','has_image':'with_image','web_link':'linked'}
    def counts(raw):return {rename.get(k,k):v for k,v in raw.items()}
    rows=[]
    for row in value['by_profile']:
        rows.append({**row,'counts':counts(row['counts']),'detail':{'total':row['counts']['all'],'detailed':row.get('detail',{}).get('present',0),'enabled':bool(row.get('detail',{}).get('selectors',0)),'selector_count':row.get('detail',{}).get('selectors',0)},'price_mismatches':{}})
    return {'ok':True,'profiles':len(rows),'generated_at':int(time.time()),'totals':counts(value['totals']),'by_profile':rows,'samples':{},
            'shop_total':value['shop_total'],'shop_count':value['shop_count'],'daily_shop_history':[], 'update_shop_history':[],
            'matrix':{'destinations':[]},'source':'local_saved_products_and_remote_ids','remote_inventory':False}


def queue(db,settings):
    from .php_ui_start import jobs
    profiles={p['id']:p for p in db.list_profiles()};entries=[]
    for row in jobs(db,settings):
        p=profiles.get(row['profile_id'],{});c=row['counts']
        entries.append({'id':str(row['id']),'profile_key':p.get('key',''),'profile_name':p.get('name',''),'status':row['status'],
                        'current':c.get('current',0),'total':c.get('total',0),'products_count':c.get('found',0),
                        'phase':'detail' if row['phase']=='detail' else 'list','stale':row['stale'],
                        'error':row['hint'],'resumable':bool(p) and row['status'] in ('waiting','paused','failed')})
    return {'ok':True,'entries':entries,'progress':{},'read_only':True,'limit':100}


def read(db,settings,data):
    op=data['action'];q=data['query']
    if op=='app_ready':return {'ok':True,'ready':True,'version':manifest()['source_version']}
    if op=='load_profile':
        p=find(db,q.get('load_profile',''));return {'ok':True,'key':p['key'],'profile':load(db,p),'revision':revision(p)}
    if op=='start_product_stats':return stats(db)
    if op=='load_connections':
        out={}
        for name in ('woocommerce','basalam'):
            cfg=db.get_config(name)
            out[name]={k:('••••' if k in ('token','consumer_key','consumer_secret') and cfg[k] else cfg[k]) for k in ('store_url','vendor_id','category_id','token','consumer_key','consumer_secret','price_mode','price_val','price_round') if k in cfg}
        out['basalam']['vendors']=[{**v,'token':'••••' if v['token_configured'] else ''} for v in public_shops(db.get_config('basalam')) if not v['is_default']]
        return {'ok':True,'connections':out,'read_only':True}
    if op=='extract_queue_status':return queue(db,settings)
    if op=='whoami':return {'ok':True,'version':manifest()['source_version'],'runtime':'Python','source_sha':manifest()['source_sha256']}
    raise ValueError(UNSUPPORTED)


def integer(value,minimum=0,maximum=10**12):
    if not isinstance(value,str) or not re.fullmatch(r'\d{1,16}',value):raise ValueError('عدد صحیح معتبر لازم است.')
    n=int(value)
    if not minimum<=n<=maximum:raise ValueError('عدد خارج از محدوده است.')
    return n


def decoded(fields,key,default):
    raw=fields.get(key)
    if raw is None:return default
    try:return json.loads(raw)
    except (ValueError,TypeError):raise ValueError('ساختار JSON فرم معتبر نیست.') from None


def save(db,data):
    fields=data['fields'];target=fields.get('target_key');previous=find(db,target) if target else None
    if fields.get('autosave')=='1':raise ValueError('ذخیرهٔ خودکار رابط قدیمی مجاز نیست؛ دکمهٔ ذخیره را بزنید.')
    # No browser result write/delete or partial metadata fallback is accepted.
    if decoded(fields,'products',[]) or fields.get('allow_empty_products') or fields.get('allow_shrink_products') or fields.get('partial_meta_only'):raise ValueError('بازنویسی/حذف محصولات از رابط اصلی هنوز متصل نیست؛ داده‌های قبلی دست‌نخورده ماند.')
    if fields.get('net_indirect','0')!='0' or fields.get('fullMode','0')!='0' or decoded(fields,'bslFallbackCatIds',[]):raise ValueError('اتصال غیرمستقیم، fullMode و fallback دسته هنوز متصل نیستند.')
    sync=decoded(fields,'syncConfig',{})
    if not isinstance(sync,dict) or sync.get('enabled') or sync.get('wooAddUpdate') or sync.get('bslAddUpdate'):raise ValueError('همگام‌سازی دوره‌ای و ارسال خودکار این پوسته هنوز متصل نیست.')
    gallery=decoded(fields,'gallery',{});image=decoded(fields,'listImageEdit',{})
    if not isinstance(gallery,dict) or not isinstance(image,dict):raise ValueError('تنظیمات رسانه معتبر نیست.')
    if gallery.get('enabled') or gallery.get('mode','off')!='off' or any(gallery.get(k) for k in ('square_pct','square_px','crop_bottom_pct','crop_bottom_px')) or any(image.get(k) for k in ('square_pct','square_px','crop_bottom_pct','crop_bottom_px')):raise ValueError('تبدیل/استخراج گالری اختصاصی هنوز متصل نیست؛ تنظیم ذخیره نشد.')
    name=fields.get('name','').strip();url=fields.get('url','');engine=fields.get('extractionEngine','selectors')
    if not name or len(name)>200 or len(url)>2000:raise ValueError('نام و آدرس معتبر لازم است.')
    validate_url(url)
    pagination={'type':fields.get('pagType','query_page'),'val':fields.get('pagVal','')}
    if engine not in ENGINES or pagination['type'] not in TYPES or len(pagination['val'])>1000:raise ValueError('موتور/صفحه‌بندی معتبر نیست.')
    if pagination['type']=='next_selector' and not pagination['val']:raise ValueError('سلکتور لینک بعدی لازم است.')
    if pagination['type']=='full_pattern':validate_url(pagination['val'].replace('{page}','2'))
    selectors=decoded(fields,'selectors',{});detail=decoded(fields,'detailSelectors',{})
    if not isinstance(selectors,dict) or set(selectors)-{'container','title','price','link','image','sku'} or any(not isinstance(v,str) or len(v)>1000 for v in selectors.values()):raise ValueError('سلکتورهای فهرست معتبر نیستند.')
    if not isinstance(detail,dict):raise ValueError('سلکتور جزئیات معتبر نیست.')
    supported={'shortDesc','longDesc','specs','images','sku','brand','category','tags'}
    for k,v in detail.items():
        if not isinstance(v,dict) or type(v.get('enabled',False)) is not bool or not isinstance(v.get('selector',''),str) or len(v.get('selector',''))>1000:raise ValueError('سلکتور جزئیات معتبر نیست.')
        if k not in supported and v.get('enabled') and v.get('selector'):raise ValueError('این فیلد جزئیات هنوز در پایتون متصل نیست: '+k)
    detail=normalize_selectors({k:v for k,v in detail.items() if k in supported})
    opts=profile_options.editor(previous or {'settings':{}})
    for key in ('titleSuffix','priceMode','customColName','customColVal'):
        if key in fields:opts[key]=fields[key]
    try:opts['priceVal']=float(fields.get('priceVal','0'))
    except ValueError:raise ValueError('تعدیل قیمت معتبر نیست.') from None
    for key in ('roundPrice','minPrice'):opts[key]=integer(fields.get(key,str(opts[key])))
    opts['useCustomCol']=fields.get('useCustomCol','0')=='1'
    for old,new in [('wooCategoryId','wooProfileCatId'),('bslCategoryId','bslProfileCatId')]:opts[new]=integer(fields.get(old,'0'))
    opts=profile_options.validate(opts);pages=integer(fields.get('pages','10'),maximum=1000)
    mode=fields.get('detailExtractMode','two_stage')
    if mode not in ('two_stage','inline'):raise ValueError('حالت جزئیات معتبر نیست.')
    source=decoded(fields,'productSource',{'mode':'direct'})
    if not isinstance(source,dict) or source.get('mode','direct') not in ('direct','github'):raise ValueError('منبع محصول معتبر نیست.')
    github={}
    if source.get('mode')=='github':
        from .github_products import config
        github=config({k:v for k,v in source.items() if k!='mode'})
    from .scraping.engines import source_api
    engine=source_api(url) or engine
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if previous:
            raw=conn.execute('SELECT * FROM profiles WHERE id=?',(previous['id'],)).fetchone()
            if not raw:raise ValueError('پروفایل حذف شده است.')
            current=dict(raw)
            for key in ('settings','selectors','pagination'):current[key]=json.loads(current[key] or '{}')
            if data.get('revision')!=revision(current):raise ValueError('stale_profile')
            if conn.execute("SELECT id FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running','paused') LIMIT 1",(previous['id'],)).fetchone():raise ValueError('ابتدا کارهای فعال همان پروفایل را تمام یا لغو کنید.')
        cfg=dict(previous['settings']) if previous else {}
        cfg.update(profileOptions=opts,detailSelectors=detail,extractionEngine=engine,startPages=pages,startWithDetail=fields.get('backendExtractWithDetail','1')=='1',detailExtractMode=mode,productSource=source.get('mode','direct'),sourceGithub=github)
        key=previous['key'] if previous else 'profile-'+uuid.uuid4().hex;now=utc_now()
        if previous:
            conn.execute('UPDATE profiles SET name=?,url=?,selectors=?,pagination=?,settings=?,updated_at=? WHERE id=?',(name,url,json.dumps(selectors),json.dumps(pagination),json.dumps(cfg,ensure_ascii=False),now,previous['id']))
        else:
            conn.execute('INSERT INTO profiles(key,name,url,selectors,pagination,settings,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)',(key,name,url,json.dumps(selectors),json.dumps(pagination),json.dumps(cfg,ensure_ascii=False),now,now))
    result=find(db,key)
    return {'ok':True,'key':key,'name':name,'updated_at':stamp(now),'product_count':result['products_count'],'has_selectors':bool(selectors.get('container')),'revision':revision(result),'products_changed':False}


def enqueue(db,data,*,reuse_waiting=False):
    fields=data['fields'];p=find(db,fields.get('profile',''));pages=integer(fields.get('pages','10'),maximum=1000);opts=start_page.options(p)
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        active=conn.execute("SELECT id,status FROM queue_entries WHERE profile_id=? AND kind='extract' AND status IN ('waiting','running','paused','failed') ORDER BY id",(p['id'],)).fetchall()
        if active:
            if reuse_waiting and len(active)==1 and active[0]['status']=='waiting':
                return {'ok':True,'id':active[0]['id'],'queued':True,'remote_send':False,'reused':True}
            names={'waiting':'در انتظار','running':'در حال اجرا','paused':'مکث‌شده','failed':'ناموفق'}
            first=active[0]
            raise ValueError('کار استخراج #'+str(first['id'])+' '+names[first['status']]+' است؛ از کنترل صف همین پروفایل، وضعیت را بررسی و صریحاً ادامه یا لغو کنید. کار تکراری ساخته نشد.')
        now=utc_now();payload={'pages':pages,'render':'static','with_detail':opts['with_detail'],'detail_mode':opts['detail_mode'],'_send_after':[]}
        cursor=conn.execute("INSERT INTO queue_entries(kind,profile_id,status,payload,counters,created_at,updated_at,heartbeat) VALUES ('extract',?,'waiting',?,'{}',?,?,?)",(p['id'],json.dumps(payload),now,now,now))
        job=cursor.lastrowid
    return {'ok':True,'id':job,'queued':True,'remote_send':False}
