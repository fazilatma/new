"""Profile-only PHP settings. Raw records/remote identities are never rewritten.

Only explicitly saved profileOptions affect sends. Opaque legacy PHP preferences
are shown for review but must be saved before activation, avoiding a price change
on already queued jobs during deployment.
"""
import hashlib
import json
from decimal import Decimal, DecimalException, ROUND_HALF_UP
from ..db import utc_now

DEFAULTS={'titleSuffix':'','priceMode':'none','priceVal':0,'roundPrice':0,'useCustomCol':False,'customColName':'وضعیت','customColVal':'موجود','minPrice':10000,'wooProfileCatId':0,'bslProfileCatId':0,
          'wooPriceMode':'none','wooPriceVal':0,'wooRound':0,'basalamPriceMode':'none','basalamPriceVal':0,'basalamRound':0}


def validate(value):
    if not isinstance(value,dict) or set(value)-set(DEFAULTS):raise ValueError('فیلد تنظیمات پروفایل معتبر نیست.')
    value={**DEFAULTS,**value}
    for key,limit in [('titleSuffix',300),('customColName',100),('customColVal',1000)]:
        if not isinstance(value[key],str) or len(value[key])>limit or any(ord(c)<32 for c in value[key]):raise ValueError('متن تنظیمات پروفایل معتبر نیست.')
    if type(value['useCustomCol']) is not bool:raise ValueError('فعال‌سازی ستون سفارشی باید بله/خیر باشد.')
    if value['useCustomCol'] and value['customColName'].strip().casefold() in ('title','price','price_num','link','image','sku','woo_id','basalam_id'):raise ValueError('نام ستون سفارشی نباید با ستون‌های اصلی تکراری باشد.')
    if value['useCustomCol'] and not value['customColName'].strip():raise ValueError('نام ستون سفارشی لازم است.')
    for mode,amount in [('priceMode','priceVal'),('wooPriceMode','wooPriceVal'),('basalamPriceMode','basalamPriceVal')]:
        if value[mode] not in ('none','percent','multiplier'):raise ValueError('روش قیمت معتبر نیست.')
        if type(value[amount]) not in (int,float):raise ValueError('مقدار قیمت باید عدد باشد.')
        number=Decimal(str(value[amount]))
        if not number.is_finite() or abs(number)>1000000 or (value[mode]=='multiplier' and number<0) or (value[mode]=='percent' and number< -100):raise ValueError('مقدار تعدیل قیمت خارج از محدوده است.')
    for key in ('roundPrice','wooRound','basalamRound','minPrice','wooProfileCatId','bslProfileCatId'):
        if type(value[key]) is not int or not 0<=value[key]<=10**12:raise ValueError('گرد کردن، حداقل قیمت و شناسهٔ دسته باید عدد صحیح نامنفی باشد.')
    return value


def active(profile):return validate((profile.get('settings') or {}).get('profileOptions') or {})


def editor(profile):
    settings=profile.get('settings') or {}
    if 'profileOptions' in settings:return active(profile)
    legacy=settings.get('legacy_profile_settings') or {};legacy=legacy if isinstance(legacy,dict) else {}
    value={k:settings.get(k,legacy.get(k,default)) for k,default in DEFAULTS.items()}
    try:return validate(value)
    except ValueError:return dict(DEFAULTS)


def adjust(amount,mode,value,rounding=0):
    try:
        n=Decimal(str(amount));v=Decimal(str(value or 0));r=Decimal(str(rounding or 0))
        if not n.is_finite() or not v.is_finite() or not r.is_finite() or r<0:raise ValueError()
        if mode=='percent':n*=1+v/100
        elif mode=='multiplier':n*=v
        elif mode!='none':raise ValueError()
        n=n.quantize(Decimal('1'),rounding=ROUND_HALF_UP)
        if r:n=(n/r).quantize(Decimal('1'),rounding=ROUND_HALF_UP)*r
        n=n.quantize(Decimal('1'),rounding=ROUND_HALF_UP)
        if n<0 or n>10**15:raise ValueError()
        return int(n)
    except (DecimalException,TypeError,ValueError):raise ValueError('قیمت محاسبه‌شده معتبر یا در محدودهٔ مجاز نیست.') from None


def price(profile,amount,target=None):
    opts=active(profile);n=adjust(amount,opts['priceMode'],opts['priceVal'],opts['roundPrice'])
    if target:n=adjust(n,opts[target+'PriceMode'],opts[target+'PriceVal'],opts[target+'Round'])
    return n


def title(profile,value):
    suffix=active(profile)['titleSuffix'].strip()
    return str(value or '')+(' '+suffix if suffix else '')


def save(db,profile_id,value):
    opts=validate(value)
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT settings FROM profiles WHERE id=?',(profile_id,)).fetchone()
        if not row:raise ValueError('پروفایل پیدا نشد.')
        if conn.execute("SELECT id FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running','paused') LIMIT 1",(profile_id,)).fetchone():raise ValueError('برای تغییر تنظیمات ارسال ابتدا کارهای فعال همین پروفایل را تمام یا لغو کنید.')
        settings=json.loads(row['settings'] or '{}');settings['profileOptions']=opts
        conn.execute('UPDATE profiles SET settings=?,updated_at=? WHERE id=?',(json.dumps(settings,ensure_ascii=False),utc_now(),profile_id))
    return opts


def cleanup_candidates(conn,profile,mode):
    if mode not in ('no_price','below_min','all'):raise ValueError('روش پاک‌سازی معتبر نیست.')
    minimum=active(profile)['minPrice'];items=[]
    for row in conn.execute('SELECT id,price_num,updated_at,woo_id,basalam_id FROM products WHERE profile_id=? ORDER BY id',(profile['id'],)):
        amount=price(profile,row['price_num'])
        if mode=='all' or (mode=='no_price' and amount<=0) or (mode=='below_min' and 0<amount<minimum):
            items.append(tuple(row))
            if len(items)==1000:break
    digest=hashlib.sha256(json.dumps([items,active(profile)],sort_keys=True).encode()).hexdigest()
    return items,digest
