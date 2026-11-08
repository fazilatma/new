"""PHP 10.641 extractionEngineAllowed/fetch_html_for_engine/parse_list_by_engine.

All nine engine routes execute real fetch/parse code. Browser engines require a
trusted remote renderer; explicit browser/API failures never become static success.
"""
import json
import re
import time
from dataclasses import replace
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit, quote, unquote

from .fetch import HtmlFetcher, validate_url
from .render import RenderedFetcher
from .smart_fetch import SmartFetcher
from .parser import load_dom, parse_products, with_selectors, json_ld_fallback
from .product_key import product_key
from .detail import web_url
from ..support.persian import normalize_text, price

class ExtractionFailure(ValueError):
    def __init__(self,message,code=0):
        super().__init__(message);self.upstream_status=code


ENGINES = {
    'selectors': 'CSS selectors · سلکتورهای ذخیره‌شده',
    'auto': 'Auto · JSON-LD → heuristic → selectors',
    'heuristic': 'Heuristic · ساختار کارت‌ها',
    'jsonld': 'JSON-LD Product',
    'jina': 'Jina Reader',
    'digikala_api': 'Digikala Official API',
    'basalam_api': 'Basalam Public API',
    'playwright': 'Playwright / CDP · رندر بیرونی',
    'selenium': 'Selenium · رندر بیرونی',
}
ALIASES = {**dict.fromkeys(('css','cheerio','htmlrewriter'), 'selectors'),
           **dict.fromkeys(('browser','render','js','cdp','chrome','chromium','puppeteer'), 'playwright'),
           **dict.fromkeys(('reader','jina-reader','jina_reader','rjina','r.jina.ai'), 'jina'),
           **dict.fromkeys(('digikala','digikala-api','dk-api','dk_api'), 'digikala_api'),
           **dict.fromkeys(('basalam','basalam-api','bsl-api','bsl_api'), 'basalam_api'),
           **dict.fromkeys(('webdriver','chromedriver'), 'selenium')}


def normalize(value):
    value = str(value or 'selectors').strip().lower()
    return ALIASES.get(value, value if value in ENGINES else 'selectors')


def profile_engine(profile):
    cfg = profile.get('settings') or {}
    legacy=cfg.get('legacy_profile_settings') or {}
    if not isinstance(legacy,dict): legacy={}
    return normalize(cfg.get('extractionEngine', legacy.get('extractionEngine', 'selectors')))


def for_installation(settings, db):
    cfg = db.get_config('render')
    if not cfg: return settings
    return replace(settings, render=replace(settings.render, url=cfg.get('url', settings.render.url),
                                            token=cfg.get('token', settings.render.token)))


def on_host(url, host):
    name = (urlsplit(url).hostname or '').lower()
    return name == host or name.endswith('.'+host)


def indexed(rows, base):
    out = {}
    for row in rows:
        if not isinstance(row, dict): continue
        row = dict(row)
        row['link'] = web_url(row.get('link', ''), base)
        row['image'] = web_url(row.get('image', ''), base)
        if row.get('images'): row['images'] = [web_url(v, base) for v in row['images'] if isinstance(v, str) and web_url(v, base)][:30]
        if row.get('title') or row['link']: out.setdefault(product_key(row), row)
    return out


def reader_rows(text, base):
    # Markdown product links, including PHP's Emalls ~id~, Snapp snp- and dkp-.
    out = []
    pattern = r'(?<!!)\[((?:!\[[^\]]{0,300}\]\([^)]{1,2048}\)|[^!\]\r\n]|!(?!\[)){1,500})\]\(([^)\s]{1,2048})(?:\s+"[^"]{0,300}")?\)'
    for match in re.finditer(pattern, text):
        label, link = match.group(1,2)
        url = web_url(link, base)
        if not url or not re.search(r'/product(?:/|-)|/p/|dkp-|snp-|~id~', url, re.I): continue
        if (urlsplit(url).hostname or '').removeprefix('www.') != (urlsplit(base).hostname or '').removeprefix('www.'): continue
        image = re.search(r'!\[([^\]]*)\]\(([^)]+)\)', label)
        title = normalize_text(re.sub(r'!\[([^\]]*)\]\([^)]+\)', r'\1', label))
        context = text[match.end():match.end()+700]
        # Do not borrow a following product's price.
        context = re.split(r'\n\s*\[', context, maxsplit=1)[0]
        if title: out.append({'title': title[:240], 'link': url, 'image': image.group(2) if image else '', 'price': price(context), 'sku': ''})
    return indexed(out, base)


def site_rows(source, base):
    root = load_dom(source)
    out = []
    for anchor in root.xpath('//a[@href]'):
        href = anchor.get('href', '')
        if not (('~id~' in href and on_host(base,'emalls.ir')) or ('snp-' in href and on_host(base,'snappshop.ir'))): continue
        parent = anchor.getparent()
        title = normalize_text(anchor.text_content() or anchor.get('title', ''))
        images = anchor.xpath('.//img') or (parent.xpath('.//img') if parent is not None else [])
        if not title and images: title = images[0].get('alt', '')
        context = parent.text_content() if parent is not None else anchor.text_content()
        if title: out.append({'title':title[:240], 'link':href, 'price':price(context), 'image':(images[0].get('data-src') or images[0].get('src','')) if images else '', 'sku':''})
    return indexed(out, base)


def parse(source, base, selectors, engine):
    engine = normalize(engine)
    if engine == 'jsonld': return json_ld_fallback(load_dom(source), base, {}), 'jsonld'
    if engine == 'selectors':
        rows = with_selectors(source, base, selectors) if selectors.get('container') else {}
        # Keep legacy Python auto behavior when no selector was configured.
        if not rows and not selectors.get('container'): return parse_products(source,base), 'heuristic (no container)'
        return rows or site_rows(source,base), 'selectors'
    if engine == 'jina':
        rows = reader_rows(source,base)
        if rows: return rows, 'jina → markdown'
    if engine != 'heuristic':
        rows = json_ld_fallback(load_dom(source), base, {})
        if rows: return rows, engine+' → jsonld'
    rows = parse_products(source, base) or site_rows(source, base)
    if rows: return rows, engine+' → heuristic'
    return (with_selectors(source,base,selectors) if selectors.get('container') else {}), engine+' → selectors'


def digikala_endpoint(url):
    if not on_host(url,'digikala.com'): raise ValueError('موتور دیجی‌کالا فقط آدرس digikala.com را می‌پذیرد.')
    path = unquote(urlsplit(url).path); query = parse_qs(urlsplit(url).query)
    match = re.match(r'^/product/dkp-(\d+)(?:/|$)',path)
    if match: return 'https://api.digikala.com/v2/product/'+match[1]+'/'
    params = {k:v for k,v in query.items() if k.split('[',1)[0] in ('q','sort','has_selling_stock','has_ready_to_ship','brands','price','seller_types','only_original','camCode')}
    params['page'] = [str(max(1,int(query.get('page',['1'])[0]))) ]
    route = ''
    match = re.match(r'^/search/category-([^/]+)(?:/([^/]+))?',path)
    if match:
        route = 'v1/categories/'+quote(match[1],safe='')+'/'
        if match[2]: route += 'brands/'+quote(match[2],safe='')+'/'
        route += 'search/'
    else:
        for pattern, prefix, suffix in ((r'^/main/([^/]+)','v1/categories/','/search/'), (r'^/brand(?:-landing)?/([^/]+)','v1/brands/','/'), (r'^/seller/([^/]+)','v1/sellers/','/'), (r'^/search/([^/]+)','v1/categories/','/search/')):
            match = re.match(pattern,path)
            if match: route=prefix+quote(match[1],safe='')+suffix;break
    if not route:
        route = ('v1/incredible-offers/products/' if path.startswith('/incredible-offers') else
                 'v1/promotion-center/products/' if path.startswith('/promotion-center') else 'v1/search/' if path.rstrip('/')=='/search' or 'q' in params else '')
    if not route: raise ValueError('مسیر عمومی دیجی‌کالا پشتیبانی نمی‌شود؛ آدرس جست‌وجو، دسته، برند، فروشنده یا محصول وارد کنید.')
    return 'https://api.digikala.com/'+route+'?'+urlencode(params,doseq=True)


def obj(value):return value if isinstance(value,dict) else {}
def arr(value):return value if isinstance(value,list) else []
def integer(value,default=0):
    try:
        n=float(value)
        import math
        return int(n) if math.isfinite(n) and abs(n)<=10**15 else default
    except (ValueError,TypeError,OverflowError):return default


def digikala_rows(body):
    data = body.get('data', body)
    if not isinstance(data,dict):raise ValueError('ساختار دادهٔ دیجی‌کالا معتبر نیست.')
    rows = data.get('products')
    if rows is None:
        rows = [data['product']] if isinstance(data.get('product'),dict) else [v for w in arr(data.get('widgets')) if isinstance(w,dict) for v in arr(obj(w.get('data')).get('products'))]
    out=[]
    for row in arr(rows):
        if not isinstance(row,dict): continue
        variant=obj(row.get('default_variant')); prices=obj(variant.get('price'))
        amount=integer(prices.get('selling_price'))//10
        if row.get('status')!='marketable' or amount<=0: continue
        rid=integer(row.get('id')); image=obj(obj(row.get('images')).get('main')).get('url') or obj(obj(row.get('images')).get('main')).get('webp_url') or ''
        if isinstance(image,list): image=image[0] if image else ''
        url=row.get('url') or {}; link=url.get('uri') if isinstance(url,dict) else url
        out.append({'title':normalize_text(row.get('title_fa') or row.get('title_en') or ''), 'price':f'{amount} تومان',
                    'link':link or f'https://www.digikala.com/product/dkp-{rid}/', 'image':image,'sku':f'dkp-{rid}', 'in_stock':True,
                    'brand':obj(row.get('brand')).get('title_fa',''),
                    'shortDesc':str(obj(row.get('review')).get('description') or ''),
                    'longDesc':str(obj(row.get('expert_reviews')).get('description') or '')})
    return indexed(out,'https://www.digikala.com'), data.get('pager') or {}


def basalam_photo(photo):
    if isinstance(photo,str): return photo.strip()
    if not isinstance(photo,dict): return ''
    for key in ('original','lg','md','sm','url','large','medium'):
        value=photo.get(key)
        if isinstance(value,list): value=value[0] if value else ''
        if isinstance(value,str) and value.strip(): return value.strip()
    return ''


def basalam_category(cat):
    parts=[]
    for _ in range(12):
        if not isinstance(cat,dict): break
        title=normalize_text(cat.get('title') or cat.get('name') or '')
        if title and title not in parts: parts.insert(0,title)
        cat=cat.get('parent')
    return ' > '.join(parts)


def basalam_variants(row):
    raw=row.get('variants') or row.get('variations') or row.get('product_variations') or row.get('selectable_variations') or []
    if isinstance(raw,dict): raw=raw.get('data') or []
    if not isinstance(raw,list): return []
    out=[]
    for item in raw[:500]:
        if not isinstance(item,dict): continue
        attrs={}
        for key in ('attributes','properties','attribute_values'):
            for attr in arr(item.get(key)):
                if not isinstance(attr,dict): continue
                label=obj(attr.get('property') or attr.get('attribute')).get('title') or attr.get('title') or attr.get('name') or ''
                value=attr.get('value')
                if isinstance(value,dict): value=value.get('title') or value.get('value') or ''
                value=value or attr.get('value_title') or ''
                if label and value: attrs[normalize_text(str(label))]=normalize_text(str(value))
        for key,label in (('color','رنگ'),('size','سایز')):
            value=item.get(key)
            if isinstance(value,dict) and (value.get('title') or value.get('name')): attrs[label]=normalize_text(value.get('title') or value.get('name'))
        rid=integer(item.get('id'));amount=round(integer(item.get('primary_price') or item.get('price'))/10);stock=max(0,integer(item.get('inventory') or item.get('stock')))
        out.append({'id':rid,'variation_id':rid,'title':normalize_text(item.get('title') or item.get('name') or ' / '.join(attrs.values())),
                    'price':amount,'display_price':amount,'stock':stock,'is_in_stock':stock>0,'attributes':attrs,'sku':str(item.get('sku') or '')})
    return out


def basalam_rows(rows):
    out=[]
    for row in arr(rows):
        if not isinstance(row,dict): continue
        status=row.get('status',0); status=status.get('value') if isinstance(status,dict) else status
        if integer(status)!=2976: continue
        rid=integer(row.get('id'))
        if rid<=0 or not (row.get('title') or row.get('name')): continue
        photos=[]
        for photo in [row.get('photo'),*arr(row.get('photos'))]:
            value=basalam_photo(photo)
            if isinstance(value,str) and value and value not in photos: photos.append(value)
        amount=round(integer(row.get('primary_price') or row.get('price'))/10)
        out.append({'title':normalize_text(row.get('title') or row.get('name') or ''),'price':f'{amount} تومان' if amount else '',
                    'link':row.get('url') or f'https://basalam.com/p/{rid}','image':photos[0] if photos else '', 'images':photos,
                    'sku':str(row.get('sku') or ''),'source_id':rid, 'in_stock':(integer(row.get('inventory',row.get('stock')),None)>0 if integer(row.get('inventory',row.get('stock')),None) is not None else None),
                    'longDesc':str(row.get('description') or ''),'shortDesc':str(row.get('summary') or ''),
                    'category':basalam_category(row.get('category')), 'variations':basalam_variants(row)})
    return indexed(out,'https://basalam.com')


def extract(url, selectors, engine, settings, *, timeout=25, render_mode='static', probe=False):
    engine=normalize(engine);validate_url(url)
    if probe:
        settings=replace(settings,net=replace(settings.net,gap_ms=min(settings.net.gap_ms,500),fallback=False))
    started=time.monotonic();deadline=started+(8 if probe else min(90,max(1,timeout)))
    def fetch(target):
        remaining=max(.1,deadline-time.monotonic())
        if remaining<=.1: raise ValueError('مهلت دریافت موتور تمام شد؛ دوباره در worker آزمایش کنید.')
        cfg=settings.net.as_dict() if hasattr(settings.net,'as_dict') else dict(settings.net)
        cfg['_deadline_seconds']=remaining
        return HtmlFetcher.get(target,timeout=min(timeout,remaining),net=cfg,settings=settings)
    def read(target):
        response=fetch(target)
        if not response.get('ok'): raise ExtractionFailure(f"دسترسی API ناموفق: HTTP {response.get('code',0)}؛ محدودیت شبکه/پلن میزبان را بررسی کنید.",response.get('code',0))
        try:body=json.loads(response.get('html',''))
        except (ValueError,TypeError):raise ExtractionFailure('پاسخ API به‌جای JSON معتبر، HTML/متن یا پاسخ ناقص است؛ وضعیت دسترسی مبدأ را بررسی کنید.',response.get('code',0)) from None
        if not isinstance(body,dict): raise ValueError('ساختار پاسخ API معتبر نیست.')
        return body
    result={};rows=None;used=engine;next_url=None;last_page=False
    if engine=='digikala_api':
        endpoint=digikala_endpoint(url);body=read(endpoint);rows,pager=digikala_rows(body)
        requested=max(1,int(parse_qs(urlsplit(url).query).get('page',['1'])[0]))
        total=integer(obj(pager).get('total_pages'))
        last_page=bool(total and requested>=total) or bool(re.match(r'^/product/',urlsplit(url).path))
        if total and requested>total: rows={}
        result={'ok':True,'code':200,'url':url,'html':''}
    elif engine=='basalam_api':
        if not on_host(url,'basalam.com'): raise ValueError('موتور باسلام فقط آدرس عمومی basalam.com را می‌پذیرد.')
        path=urlsplit(url).path;query=parse_qs(urlsplit(url).query)
        pid=re.match(r'^/(?:product|p)/(\d+)(?:/|$)',path)
        if pid:
            rows=basalam_rows([read('https://core.basalam.com/v4/products/'+pid[1])]);last_page=True
        else:
            vid=query.get('s4_bsl_vendor_id',query.get('vendor_id',['']))[0]
            match=re.match(r'^/vendors?/(\d+)(?:/|$)',path)
            if not vid and match: vid=match[1]
            if not vid:
                identifier=path.strip('/').split('/')[0]
                if not re.fullmatch(r'[a-zA-Z0-9_-]{2,100}',identifier): raise ValueError('آدرس غرفهٔ باسلام معتبر نیست.')
                vendors=read('https://core.basalam.com/v3/vendors?'+urlencode({'identifiers':identifier})).get('data',[])
                vid=next((str(v['id']) for v in vendors if str(v.get('identifier','')).lower()==identifier.lower()),'')
            if not str(vid).isdigit() or int(vid)<=0: raise ValueError('شناسهٔ غرفه از آدرس عمومی پیدا نشد.')
            cursor=query.get('s4_bsl_cursor',['0'])[0]
            if not str(cursor).isdigit(): raise ValueError('cursor باسلام نامعتبر است.')
            body=read('https://core.basalam.com/v4/products?'+urlencode({'vendor_ids':vid,'per_page':20,'status':2976,**({'cursor':cursor} if int(cursor)>0 else {})}))
            rows=basalam_rows(body.get('data',[]));nxt=body.get('next_cursor') or 0
            if not str(nxt).isdigit(): raise ValueError('cursor پاسخ باسلام نامعتبر است.')
            next_url=urlunsplit((*urlsplit(url)[:3],urlencode({'s4_bsl_vendor_id':vid,'s4_bsl_cursor':nxt}),'')) if int(nxt)>0 and rows else ''
            last_page=not next_url
        result={'ok':True,'code':200,'url':url,'html':''}
    elif engine in ('playwright','selenium'):
        # Explicit engines fail explicitly; no silent static fallback.
        validate_url(url,resolve=True)
        bounded=probe or timeout<=8
        opts={'driver':engine,**({'_deadline_seconds':8} if bounded else {}),'timeout_ms':5000 if bounded else min(60000,max(1000,timeout*1000))}
        if selectors.get('container'): opts['selector']=selectors['container']
        result=RenderedFetcher.get(url,opts,settings=settings)
        if result.get('ok') and result.get('driver')!=engine:
            raise ValueError('سرویس رندر، driver انتخاب‌شده را تأیید نکرد؛ موتور دیگری به‌عنوان موفقیت گزارش نمی‌شود.')
    elif engine=='jina':
        # Validate the nested target before sending it to an intermediary.
        validate_url(url,resolve=True)
        if on_host(url,'r.jina.ai'): raise ValueError('آدرس اصلی سایت را وارد کنید، نه آدرس Reader تو در تو.')
        result=fetch('https://r.jina.ai/'+url);result['url']=url
    else:
        net=settings.net.as_dict() if hasattr(settings.net,'as_dict') else dict(settings.net)
        net['_deadline_seconds']=max(.1,deadline-time.monotonic())
        result=SmartFetcher.get(url,timeout=min(timeout,8) if probe else timeout,net=net,mode='static' if probe else render_mode,settings=settings)
    if not result.get('ok'): raise ExtractionFailure(f"دریافت با موتور {engine} ناموفق: HTTP {result.get('code',0)}؛ شبکه، محدودیت میزبان یا تنظیم سرویس رندر را بررسی کنید.",result.get('code',0))
    source=result.get('html','')
    cap=(2 if probe else 12)*1024*1024
    if len(source.encode())>cap: raise ValueError(f'HTML برای پردازش بیش از سقف {cap//1024//1024} MiB است.')
    effective=validate_url(result.get('url') or url)
    if rows is None: rows,used=parse(source,effective,selectors,engine)
    return {**result,'products':rows,'engine':engine,'used_engine':used,'next_url':next_url,'last_page':last_page,'elapsed_ms':round((time.monotonic()-started)*1000)}
