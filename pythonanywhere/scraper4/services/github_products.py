"""Bounded public GitHub CSV/XLSX source; one file/request, no code execution.

Reject oversized archives, worksheets and rows BEFORE touching products. Remote
IDs/credentials are never accepted from files. Updates preserve existing extras,
SKU/image fallbacks and destination identities. No new dependencies or schema.
"""
import base64
import csv
import io
import json
import posixpath
import re
import time
import zipfile
from urllib.parse import quote
from xml.etree import ElementTree as ET
import requests
from ..db import utc_now
from .scraping.product_key import product_key
from .scraping.fetch import validate_url
from .support.persian import price_num

MAX_FILE=1024*1024
NS={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def config(value):
    if not isinstance(value,dict) or set(value)-{'repo','branch','path'}:raise ValueError('تنظیم منبع GitHub معتبر نیست.')
    repo=value.get('repo','');branch=value.get('branch','main');path=value.get('path','')
    if not isinstance(repo,str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}',repo):raise ValueError('مخزن باید owner/repo باشد.')
    if not isinstance(branch,str) or not 1<=len(branch)<=200 or any(ord(c)<32 for c in branch):raise ValueError('نام branch معتبر نیست.')
    if not isinstance(path,str) or len(path)>1000 or path.startswith('/') or '..' in path.split('/') or not path.lower().endswith(('.csv','.xlsx')):raise ValueError('مسیر فایل CSV یا XLSX معتبر لازم است؛ XLS قدیمی پشتیبانی نمی‌شود.')
    return {'repo':repo,'branch':branch,'path':path}


def api_read(path,params=None):
    deadline=time.monotonic()+12
    with requests.get('https://api.github.com/'+path,params=params,headers={'Accept':'application/vnd.github+json','User-Agent':'Scraper4-public-products'},
                      stream=True,allow_redirects=False,timeout=(3,8)) as response:
        if response.status_code!=200:raise ValueError(f'GitHub HTTP {response.status_code}؛ مخزن عمومی، branch و مسیر را بررسی کنید.')
        body=bytearray()
        for part in response.iter_content(65536):
            if time.monotonic()>deadline:raise ValueError('مهلت دریافت فایل GitHub تمام شد.')
            body.extend(part)
            if len(body)>2*MAX_FILE:raise ValueError('پاسخ GitHub بزرگ‌تر از حد امن است.')
        try:return json.loads(body)
        except (ValueError,UnicodeError):raise ValueError('پاسخ JSON معتبر GitHub دریافت نشد.') from None


def load_file(value):
    cfg=config(value)
    data=api_read('repos/'+cfg['repo']+'/contents/'+quote(cfg['path'],safe='/'),{'ref':cfg['branch']})
    if not isinstance(data,dict) or data.get('type')!='file' or data.get('encoding')!='base64' or type(data.get('size')) is not int or not 0<=data['size']<=MAX_FILE:raise ValueError('فقط فایل عمومی تا یک مگابایت پذیرفته می‌شود.')
    try:raw=base64.b64decode(re.sub(r'\s','',data['content']),validate=True)
    except (KeyError,ValueError,TypeError):raise ValueError('محتوای فایل GitHub معتبر نیست.') from None
    if len(raw)>MAX_FILE:raise ValueError('حداکثر اندازهٔ فایل یک مگابایت است.')
    return parse(raw,cfg['path'])


def xlsx_rows(raw):
    try:
        archive=zipfile.ZipFile(io.BytesIO(raw));items=archive.infolist()
        if len(items)>200 or sum(i.file_size for i in items)>16*MAX_FILE or any(i.file_size>4*MAX_FILE for i in items) or len({i.filename for i in items})!=len(items):raise ValueError('ساختار/اندازهٔ XLSX خارج از حد امن است.')
        def xml(path):
            body=archive.read(path)
            if b'\x00' in body:raise ValueError('XML برگه باید UTF-8 باشد.')
            if b'<!DOCTYPE' in body.upper() or b'<!ENTITY' in body.upper():raise ValueError('DTD در XLSX پذیرفته نمی‌شود.')
            return ET.fromstring(body)
        book=xml('xl/workbook.xml');sheet=book.find('s:sheets/s:sheet',NS)
        rid=sheet.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id') if sheet is not None else None
        rels=xml('xl/_rels/workbook.xml.rels')
        target=next((r.attrib.get('Target','') for r in rels if r.attrib.get('Id')==rid and not r.attrib.get('TargetMode')), '')
        path=posixpath.normpath('xl/'+target) if not target.startswith('/') else target.lstrip('/')
        if not re.fullmatch(r'xl/worksheets/[^/]+\.xml',path):raise ValueError('برگهٔ اول XLSX معتبر نیست.')
        strings=[]
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings=[''.join(e.itertext()) for e in xml('xl/sharedStrings.xml').findall('s:si',NS)]
            if len(strings)>30000:raise ValueError('تعداد متن‌های XLSX بیش از حد است.')
        rows=[]
        for r in xml(path).findall('s:sheetData/s:row',NS):
            cells=['']*32
            for cell in r.findall('s:c',NS):
                ref=cell.attrib.get('r','');letters=re.match(r'[A-Z]+',ref)
                if not letters or not re.fullmatch(r'[A-Z]{1,3}[0-9]{1,7}',ref):raise ValueError('آدرس سلول XLSX معتبر نیست.')
                column=0
                for c in letters[0]:column=column*26+ord(c)-64
                if column>32:raise ValueError('حداکثر ۳۲ ستون در XLSX.')
                if cell.find('s:f',NS) is not None:raise ValueError('فایل XLSX باید بدون فرمول باشد؛ ابتدا مقادیر ثابت را خروجی بگیرید.')
                value=cell.findtext('s:v',default='',namespaces=NS);kind=cell.attrib.get('t')
                if kind=='s':value=strings[int(value)]
                elif kind=='inlineStr':value=''.join(cell.find('s:is',NS).itertext())
                cells[column-1]=value
            if any(cells):rows.append(cells)
            if len(rows)>1001:raise ValueError('حداکثر ۱۰۰۰ محصول در هر فایل.')
        archive.close();return rows
    except (zipfile.BadZipFile,ET.ParseError,KeyError,IndexError,AttributeError,RuntimeError,NotImplementedError):raise ValueError('ساختار XLSX معتبر نیست.') from None


def parse(raw,path):
    if len(raw)>MAX_FILE:raise ValueError('حداکثر اندازهٔ فایل یک مگابایت.')
    if path.lower().endswith('.xlsx'):rows=xlsx_rows(raw)
    else:
        try:rows=list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
        except (UnicodeError,csv.Error):raise ValueError('CSV باید UTF-8 و دارای سرستون باشد.') from None
    rows=[r for r in rows if any(str(c).strip() for c in r)]
    if not rows or not 1<len(rows)<=1001 or len(rows[0])>32:raise ValueError('فایل باید سرستون و ۱ تا ۱۰۰۰ محصول، حداکثر ۳۲ ستون، داشته باشد.')
    aliases={'name':'title','url':'link','عنوان':'title','نام':'title','قیمت':'price','لینک':'link','تصویر':'image'}
    headers=[aliases.get(str(h).strip().lower(),str(h).strip().lower()) for h in rows[0]]
    if 'title' not in headers or len(set(h for h in headers if h))!=len([h for h in headers if h]):raise ValueError('سرستون title / name لازم است؛ سرستون تکراری مجاز نیست.')
    products={}
    for i,values in enumerate(rows[1:],2):
        if len(values)>32 or any(len(v)>20000 for v in values):raise ValueError(f'ردیف {i} از حد امن بزرگ‌تر است.')
        data=dict(zip(headers,values));title=data.get('title','').strip()
        if not title or len(title)>2000:raise ValueError(f'عنوان ردیف {i} معتبر نیست.')
        product={k:str(data.get(k,'')).strip() for k in ('title','price','link','image','sku')}
        for field in ('link','image'):
            if product[field]:validate_url(product[field])
        product['price_num']=price_num(product['price'])
        if product['price_num']>10**15:raise ValueError('قیمت خارج از حد امن است.')
        product['extra']={k:data[k] for k in ('brand','category','tags','shortDesc','longDesc','shortdesc','longdesc','description') if data.get(k)}
        for lower,camel in (('shortdesc','shortDesc'),('longdesc','longDesc')):
            if lower in product['extra']:product['extra'][camel]=product['extra'].pop(lower)
        for key in ('stock','inventory','stock_quantity','stock_status'):
            if data.get(key,'').strip():product['extra'][key]=data[key].strip()
        if data.get('in_stock','').strip():
            stock=data['in_stock'].strip().lower()
            if stock not in ('true','false','1','0'):raise ValueError('in_stock باید true/false یا 1/0 باشد.')
            product['extra']['in_stock']=stock in ('true','1')
        if data.get('variations','').strip():
            try:variants=json.loads(data['variations'])
            except ValueError:variants=data['variations'].strip()
            if isinstance(variants,(list,dict)) and len(variants)>100:raise ValueError('حداکثر ۱۰۰ تنوع در هر محصول فایل.')
            product['extra']['variations']=variants
        if data.get('images'):
            try:images=json.loads(data['images'])
            except ValueError:images=data['images'].split('|')
            if not isinstance(images,list) or len(images)>30 or any(not isinstance(v,str) for v in images):raise ValueError('گالری باید فهرست JSON یا لینک‌های جداشده با | باشد، حداکثر ۳۰ تصویر.')
            product['extra']['images']=[validate_url(v.strip()) for v in images if v.strip()]
        products[product_key(product)]=product
    return products


def import_products(db,profile,products):
    # All validation/network has completed. Single transaction; no partial file.
    now=utc_now()
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        for key,p in products.items():
            old=conn.execute('SELECT extra FROM products WHERE profile_id=? AND key=?',(profile['id'],key)).fetchone()
            saved=json.loads(old['extra'] or '{}') if old else {};saved=saved if isinstance(saved,dict) else {}
            merged={**saved,**p['extra']}
            old_images=saved.get('images');new_images=p['extra'].get('images')
            if isinstance(old_images,list) and isinstance(new_images,list) and len(old_images)>len(new_images):merged['images']=old_images
            conn.execute('''INSERT INTO products (profile_id,key,title,price,price_num,link,image,sku,extra,last_seen_at,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,key) DO UPDATE SET title=excluded.title,price=excluded.price,price_num=excluded.price_num,
                link=excluded.link,image=CASE WHEN excluded.image='' THEN products.image ELSE excluded.image END,
                sku=CASE WHEN excluded.sku='' THEN products.sku ELSE excluded.sku END,extra=excluded.extra,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at''',
                (profile['id'],key,p['title'],p['price'],p['price_num'],p['link'],p['image'],p['sku'],json.dumps(merged,ensure_ascii=False),now,now,now))
    db.touch_profile(profile['id'],db.sync_profile_count(profile['id']))
    return len(products)
