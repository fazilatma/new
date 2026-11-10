"""PHP apix route/payload adaptation. No browser, Reader, HTML fallback or CDN pins.

Only fixed public Snappshop endpoints; verified TLS, no redirects, bounded JSON.
Guest authorization is obtained automatically from the source, never from panel
credentials and never returned in a product, report, URL or queue checkpoint.
"""
import json
import re
import time
import threading
import hashlib
from urllib.parse import parse_qs, urlsplit, unquote, quote
import requests
from .fetch import validate_url, HtmlFetcher
from .detail import web_url, sanitize_fragment
from ..support.persian import normalize_text


def request_json(endpoint,method,settings,deadline,body=None,token=''):
    from .engines import ExtractionFailure
    from .network_errors import classify,MESSAGES
    if not re.fullmatch(r'(?:guest/v2/token|products/v2/\d+|search/v1|landing/v2)',endpoint):raise ValueError('Unsupported Snappshop API endpoint')
    stage='snappshop_guest' if endpoint=='guest/v2/token' else 'snappshop_detail' if endpoint.startswith('products/') else 'snappshop_listing'
    target='https://apix.snappshop.ir/'+endpoint+'?lat=35.77331&lng=51.418591'
    headers={'Accept':'application/json, text/plain, */*','Accept-Language':'fa-IR,fa;q=0.9,en-US;q=0.8,en;q=0.7','User-Agent':settings.user_agent,'Origin':'https://snappshop.ir','Referer':'https://snappshop.ir/','X-Origin':'https://snappshop.ir','s-device':'DESKTOP','s-device-source':'shop'}
    if token:headers['Authorization']='Bearer '+token
    cfg=settings.net.as_dict();mode=cfg.get('mode','direct')
    hosts=str(cfg.get('hosts','')).replace(',',' ').split()
    if hosts and not any(h in ('snappshop.ir','apix.snappshop.ir') for h in hosts):mode='direct'
    try:
        if mode not in ('direct','proxy'):raise ExtractionFailure('مسیر شبکهٔ انتخابی برای API اسنپ‌شاپ پشتیبانی نشده است؛ مستقیم یا پراکسی HTTP انتخاب کنید.',network_error='configuration',stage=stage)
        proxies=None
        if mode=='proxy':
            proxy=str(cfg.get('proxy') or '')
            if not proxy:raise ExtractionFailure('آدرس پراکسی مبدأ تنظیم نشده است.',network_error='configuration',stage=stage)
            if '://' not in proxy:proxy='http://'+proxy
            if cfg.get('proxy_auth'):
                user,_,password=str(cfg['proxy_auth']).partition(':');proxy=proxy.replace('://','://'+quote(user,safe='')+':'+quote(password,safe='')+'@',1)
            parsed=urlsplit(proxy)
            validate_url(parsed.scheme+'://'+parsed.hostname,resolve=True)
            proxies={'http':proxy,'https':proxy}
        # The only source host is a fixed public endpoint. No source token is
        # ever redirected to a caller-supplied URL/worker/Reader.
        validate_url(target,resolve=True)
        HtmlFetcher.pace('apix.snappshop.ir',min(500,max(200,settings.net.gap_ms)))
        remaining=deadline-time.monotonic()
        if remaining<=0:raise ExtractionFailure('مهلت دریافت API اسنپ‌شاپ تمام شد.',network_error='read_timeout',stage=stage)
        with requests.Session() as session:
            with session.request(method,target,json=body,headers=headers,proxies=proxies,timeout=(min(3,remaining),remaining),verify=True,allow_redirects=False,stream=True) as r:
                if not 200<=r.status_code<300:raise ExtractionFailure(f'دسترسی API اسنپ‌شاپ ناموفق: HTTP {r.status_code}',r.status_code,stage=stage)
                chunks=[];size=0
                for chunk in r.iter_content(65536):
                    size+=len(chunk)
                    if size>2*1024*1024 or time.monotonic()>deadline:raise ExtractionFailure('پاسخ API بیش از سقف اندازه یا زمان است.',stage=stage)
                    chunks.append(chunk)
                try:value=json.loads(b''.join(chunks))
                except (ValueError,UnicodeError):raise ExtractionFailure('پاسخ API اسنپ‌شاپ JSON معتبر نیست.',r.status_code,stage=stage) from None
                if not isinstance(value,dict):raise ExtractionFailure('ساختار پاسخ API اسنپ‌شاپ معتبر نیست.',stage=stage)
                if value.get('status') is False:
                    error=ExtractionFailure('پاسخ API اسنپ‌شاپ وضعیت ناموفق دارد.',r.status_code,stage=stage)
                    error.api_status_false=True
                    raise error
                return value
    except (requests.RequestException,OSError) as exc:
        kind=classify(exc)
        raise ExtractionFailure('اتصال API اسنپ‌شاپ: '+MESSAGES[kind],network_error=kind,stage=stage) from None


_GUEST={};_GUEST_LOCK=threading.Lock()


def guest(settings,deadline):
    from .engines import ExtractionFailure
    body=request_json('guest/v2/token','GET',settings,deadline)
    token=body.get('data',{}).get('token') if isinstance(body.get('data'),dict) else None
    if not isinstance(token,str) or not token or len(token)>16000 or any(ord(c)<32 for c in token):
        raise ExtractionFailure('API اسنپ‌شاپ مجوز مهمان معتبر نداد.',stage='snappshop_guest')
    # Per-process short-lived guest cache; never stored in reports/checkpoints.
    # Key includes transport so a proxy/config change cannot reuse its context.
    key=hashlib.sha256(repr(settings.net.as_dict()).encode()).hexdigest()
    with _GUEST_LOCK:
        for expired in [k for k,v in _GUEST.items() if v[1]<=time.monotonic()]:_GUEST.pop(expired,None)
        if len(_GUEST)>=16:_GUEST.clear()
        _GUEST[key]=(token,time.monotonic()+600)
    return token


def cached_guest(settings):
    with _GUEST_LOCK:
        key=hashlib.sha256(repr(settings.net.as_dict()).encode()).hexdigest();cached=_GUEST.get(key)
        if cached and cached[1]>time.monotonic():return cached[0]
        _GUEST.pop(key,None)
    return ''


def route(url):
    from .engines import on_host
    if not on_host(url,'snappshop.ir'):raise ValueError('موتور اسنپ‌شاپ فقط آدرس snappshop.ir را می‌پذیرد.')
    path=unquote(urlsplit(url).path);q=parse_qs(urlsplit(url).query)
    try:page=int(q.get('page',['1'])[0])
    except ValueError:raise ValueError('شماره صفحهٔ اسنپ‌شاپ معتبر نیست.') from None
    if page<1:raise ValueError('شماره صفحهٔ اسنپ‌شاپ باید مثبت باشد.')
    pid=re.match(r'^/products?/(?:snp-)?(\d+)(?:/|$)',path,re.I)
    if pid:return 'products/v2/'+pid[1],None,1
    payload={'render':4,'skip':page-1}
    search=next((q[k][0].strip() for k in ('query','q','s') if q.get(k)), '')
    if re.match(r'^/search(?:/|$)',path) or (path in ('','/') and search):payload['query']=search;endpoint='search/v1'
    else:
        m=re.match(r'^/(?:product-)?category/([^/]+)(?:/([^/]+))?',path)
        if m:payload.update(page_type='category_brand' if m[2] else 'category',slug=m[1]);payload.update({'slug_2':m[2]} if m[2] else {})
        else:
            m=re.match(r'^/(vendor|vendors|seller|sellers|brand|brands|product-list|campaign|landing)/([^/]+)',path)
            if not m:raise ValueError('مسیر API اسنپ‌شاپ پشتیبانی نمی‌شود؛ آدرس محصول، جست‌وجو، دسته، فروشنده یا برند وارد کنید.')
            kind='vendor' if m[1] in ('vendor','vendors','seller','sellers') else 'brand' if m[1] in ('brand','brands') else m[1].replace('-','_')
            payload.update(page_type=kind,slug=m[2],render=3 if kind=='vendor' else 4)
        payload['exclude_filters']=True;endpoint='landing/v2'
    for key in ('is_available','has_discount','is_express'):
        if key in q:
            v=q[key][0].lower()
            if v in ('1','true','yes','on'):payload[key]=True
            elif key=='is_available' and v in ('0','false','no','off'):payload[key]=False
    if q.get('sort'):payload['sort']=q['sort'][0][:100]
    for key in ('brands','colors'):
        if q.get(key) or q.get(key+'[]'):payload[key]=(q.get(key) or q[key+'[]'])[:100]
    return endpoint,payload,page


def detail_images(data):
    from .engines import obj,arr,on_host
    from ..support.url import is_image
    images=[];visited=0
    def push(value,depth=0):
        nonlocal visited
        visited+=1
        if depth>8 or visited>1000 or len(images)>=30:return
        if isinstance(value,str):
            url=web_url(value,'https://cdn.snappshop.ir')
            if url and 'placeholder' not in url.lower() and (is_image(url) or on_host(url,'cdn.snappshop.ir')) and url not in images:images.append(url)
        elif isinstance(value,dict):
            for key in ('original','large','main','src','url','file','path'):
                if isinstance(value.get(key),str):push(value[key],depth+1);return
            for sub in value.values():push(sub,depth+1)
        elif isinstance(value,list):
            for sub in value:push(sub,depth+1)
    content=obj(data.get('content'))
    for value in (data.get('image'),data.get('images'),content.get('images'),content.get('gallery'),data.get('gallery'),data.get('media')):push(value)
    for variant in arr(data.get('variants')):
        push(obj(variant).get('image'));push(obj(variant).get('images'))
    for meta in arr(obj(data.get('page')).get('extra_meta')):
        meta=obj(meta)
        if str(meta.get('property') or meta.get('name')).lower() in ('og:image','twitter:image'):push(meta.get('content'))
    return images


def rows(body,product_id=None):
    from .engines import obj,arr,integer,indexed
    data=body.get('data',body)
    if not isinstance(data,dict):raise ValueError('ساختار پاسخ API اسنپ‌شاپ معتبر نیست.')
    if product_id:
        content=obj(data.get('content'));page=obj(data.get('page'));vendors=[v for variant in arr(data.get('variants')) for v in arr(obj(variant).get('vendor')) if isinstance(v,dict)]
        available=[v for v in vendors if integer(v.get('stock'))>0 or v.get('is_available_in_vendor_inventory') is True or v.get('is_available_in_shop') is True]
        default=str(obj(data.get('default_variant')).get('vendor_product_info_id') or '')
        def amount(v):
            a=integer(v.get('price'));b=integer(v.get('special_price'));return b if b>0 and (a<=0 or b<=a) else a
        priced=[v for v in available if amount(v)>0]
        chosen=next((v for v in priced if default and str(v.get('vendor_product_info_id'))==default),None) or min(priced,key=amount,default={})
        images=detail_images(data)
        link='https://snappshop.ir/product/snp-'+product_id
        title=normalize_text(content.get('title_fa') or page.get('title') or data.get('title') or '')
        if not title:raise ValueError('عنوان محصول API اسنپ‌شاپ پیدا نشد.')
        n=amount(chosen)
        return indexed([{'title':title,'price':f'{n} تومان' if n>0 else '', 'link':link,'image':images[0] if images else '', 'images':images[:30],'sku':'snp-'+product_id,'in_stock':bool(available),'brand':obj(data.get('brand')).get('title_fa') or obj(data.get('brand')).get('title') or '', 'longDesc':sanitize_fragment(content.get('description') or data.get('description') or page.get('description') or '',link)}],link),1
    sections=[s for s in arr(data.get('structure')) if isinstance(s,dict)]
    sections.sort(key=lambda s:s.get('section_type')!='plp')
    if not sections and isinstance(data.get('items'),list):sections=[{'items':data['items'],'section_type':'plp'}]
    if not sections and isinstance(data.get('structure'),list):return {},0
    if not sections:raise ValueError('ساختار فهرست API اسنپ‌شاپ معتبر نیست؛ خروجی خالی موفق فرض نشد.')
    total=max([integer(obj(data.get('pagination')).get('total_pages') or obj(data.get('pagination')).get('last_page'))]+[integer(obj(s.get('pagination')).get('total_pages') or obj(s.get('pagination')).get('last_page')) for s in sections])
    out=[]
    for section in sections:
        for item in arr(section.get('items')):
            if not isinstance(item,dict):continue
            href=item.get('href') or ('/product/snp-'+str(item['product_id']) if item.get('product_id') else '')
            m=re.search(r'/products?/(?:snp-)?(\d+)(?:/|$)',str(href),re.I)
            if not m:continue
            title=normalize_text(item.get('title') or item.get('fa_title') or '')
            if not title:continue
            price=item.get('price');base=integer(obj(price).get('price') if isinstance(price,dict) else price);sale=integer(obj(price).get('discounted_price') or obj(price).get('special_price') or obj(price).get('selling_price'))
            n=sale if sale>0 and (base<=0 or sale<=base) else base
            image=item.get('image');image=obj(image).get('src') or obj(image).get('url') if isinstance(image,dict) else image
            out.append({'title':title[:240],'price':f'{n} تومان' if n>0 else '', 'link':'https://snappshop.ir/product/snp-'+m[1],'image':web_url(image or '','https://cdn.snappshop.ir'),'sku':'snp-'+m[1]})
        if out and section.get('section_type')=='plp':break
    if not out and any(arr(section.get('items')) for section in sections):raise ValueError('ساختار آیتم‌های API اسنپ‌شاپ قابل تشخیص نیست؛ صفر محصول پایان موفق فرض نشد.')
    return indexed(out,'https://snappshop.ir'),total


def extract(url,settings,deadline):
    endpoint,payload,page=route(url)
    if payload is not None and page>500:return {},True
    from .engines import ExtractionFailure
    # PHP's guest helper is optional (it can return an empty token), not a
    # prerequisite for public landing/search. Do not spend every page's entire
    # HTTP budget on an unnecessary guest request before reaching the catalog.
    token=cached_guest(settings)
    try:body=request_json(endpoint,'GET' if payload is None else 'POST',settings,deadline,payload,token)
    except ExtractionFailure as exc:
        if exc.upstream_status!=401 and not (getattr(exc,'api_status_false',False) and not token):raise
        token=guest(settings,deadline)
        body=request_json(endpoint,'GET' if payload is None else 'POST',settings,deadline,payload,token)
    products,total=rows(body,endpoint.split('/')[-1] if payload is None else None)
    if not products and total and page<total:
        raise ExtractionFailure('پاسخ API اسنپ‌شاپ پیش از پایان اعلام‌شده خالی است؛ همان صفحه باید بررسی شود، نه پایان موفق فهرست.',stage='snappshop_listing')
    if total and page>total:products={}
    return products, payload is None or (bool(total) and page>=total) or not products or page>=500
