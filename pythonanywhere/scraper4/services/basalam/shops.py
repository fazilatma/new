"""PHP bslAllShops, default-wins dedup and per-vendor remote identity.

Uses existing encrypted connections and product extra; no DB migration. A remote
ID from one shop is never used to PATCH another. Legacy owner is pinned before
changing the configured primary vendor, including settings restores.
"""
import json
import math
import re
from ...db import utc_now

MASK='••••'


def normalize_config(cfg):
    cfg=dict(cfg)
    for key in ('vendor_id','category_id'):
        if key in cfg:
            raw=str(cfg[key] or '');cfg[key]=str(int(raw)) if raw.isascii() and raw.isdigit() else raw
    vendors=cfg.get('vendors',[])
    if vendors=={}: vendors=[]  # PHP empty associative array
    if not isinstance(vendors,list) or len(vendors)>50: raise ValueError('حداکثر ۵۰ غرفه و ساختار فهرست معتبر لازم است.')
    seen={cfg.get('vendor_id','')};out=[]
    for item in vendors:
        if not isinstance(item,dict): raise ValueError('ساختار غرفه معتبر نیست.')
        row=dict(item)
        for key in ('vendor_id','category_id'):
            if key in row:
                raw=str(row[key] or '');row[key]=str(int(raw)) if raw.isascii() and raw.isdigit() else raw
        if row.get('vendor_id') in seen: continue  # PHP default wins
        seen.add(row.get('vendor_id'));out.append(row)
    if 'vendors' in cfg: cfg['vendors']=out
    validate_config(cfg)
    return cfg


def validate_config(cfg):
    if not isinstance(cfg.get('vendors',[]),list) or len(cfg.get('vendors',[]))>50 or any(not isinstance(v,dict) for v in cfg.get('vendors',[])):
        raise ValueError('ساختار فهرست غرفه‌ها معتبر نیست.')
    for row in [cfg,*cfg.get('vendors',[])]:
        for field in ('token','vendor_id','category_id','shop_name','name'):
            value=row.get(field,'')
            if not isinstance(value,str) or len(value)>4096 or '\n' in value or '\r' in value: raise ValueError('فیلد غرفه معتبر نیست.')
        for field in ('vendor_id','category_id'):
            if row.get(field) and not re.fullmatch(r'[0-9]{1,20}',row[field]): raise ValueError('شناسهٔ غرفه/دسته باید عددی باشد.')
        if row is not cfg and (not row.get('vendor_id') or int(row['vendor_id'])<=0): raise ValueError('شناسهٔ غرفهٔ اضافی باید مثبت باشد.')
        if row.get('price_mode','none') not in ('none','percent','multiplier'): raise ValueError('روش تغییر قیمت غرفه معتبر نیست.')
        for key in ('price_val','price_round'):
            if key in row:
                try: number=float(row[key])
                except (ValueError,TypeError): raise ValueError('مقدار قیمت غرفه معتبر نیست.') from None
                if not math.isfinite(number) or abs(number)>100000000: raise ValueError('مقدار قیمت غرفه خارج از محدوده است.')


def all_shops(cfg):
    cfg=normalize_config(cfg);out=[]
    for index,row in enumerate([cfg,*cfg.get('vendors',[])]):
        if not row.get('vendor_id') or int(row['vendor_id'])<=0: continue
        out.append({**row,'is_default':index==0,'shop_name':row.get('shop_name') or row.get('name') or ('غرفهٔ پیش‌فرض' if index==0 else 'غرفه '+row['vendor_id']),
                    'category_id':row.get('category_id') or cfg.get('category_id','')})
    return out


def public_shops(cfg):
    return [{k:v for k,v in row.items() if k in ('vendor_id','shop_name','category_id','is_default','price_mode','price_val','price_round')}
            | {'token_configured':bool(row.get('token'))} for row in all_shops(cfg)]


def pin_legacy_owner(conn, old_cfg):
    # Metadata is host-local and not part of portable settings.
    vid=str(old_cfg.get('vendor_id') or '')
    if not vid.isdigit() or int(vid)<=0: return
    now=utc_now()
    conn.execute('''INSERT OR IGNORE INTO task_checkpoints (task,state,created_at,updated_at)
                    VALUES (?,?,?,?)''',('basalam:legacy_owner',json.dumps({'vendor_id':vid}),now,now))


def owner(db,cfg):
    with db.connect() as conn: pin_legacy_owner(conn,cfg)
    return db.checkpoint_read('basalam:legacy_owner').get('vendor_id','')


def resolve(cfg,vendor_id=None):
    vid=str(vendor_id or cfg.get('vendor_id') or '')
    shop=next((row for row in all_shops(cfg) if row['vendor_id']==vid),None)
    if not shop or not shop.get('token') or shop['token']==MASK: raise ValueError('توکن/شناسهٔ غرفهٔ انتخابی کامل نیست؛ اتصال همان غرفه را اصلاح کنید.')
    return shop


def remote_id(product, extra, vendor_id, legacy_owner):
    mapping=extra.get('basalam_targets') or {}
    value=mapping.get(str(vendor_id)) if isinstance(mapping,dict) else None
    return int(value or (product.get('basalam_id') if str(vendor_id)==str(legacy_owner) else 0) or 0)


def mark_remote(db,product_id,vendor_id,remote,legacy_owner):
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT extra,basalam_id FROM products WHERE id=?',(product_id,)).fetchone()
        if not row: raise ValueError('محصول محلی حذف شده؛ مقصد را پیش از تلاش دوباره تطبیق دهید.')
        extra=json.loads(row['extra'] or '{}');mapping=extra.get('basalam_targets') or {};mapping[str(vendor_id)]=int(remote);extra['basalam_targets']=mapping
        legacy=int(remote) if str(vendor_id)==str(legacy_owner) else row['basalam_id']
        now=utc_now()
        conn.execute('UPDATE products SET extra=?,basalam_id=?,updated_at=? WHERE id=?',
                     (json.dumps(extra,ensure_ascii=False),legacy,now,product_id))
        conn.execute('''INSERT INTO task_checkpoints (task,state,created_at,updated_at) VALUES (?,?,?,?)
                        ON CONFLICT(task) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at''',
                     (f'basalam:remote:{product_id}:{vendor_id}',json.dumps({'remote_id':int(remote)}),now,now))


def adjusted_price(amount,cfg,shop):
    value=float(amount)
    for row in [cfg,*([shop] if not shop.get('is_default') else [])]:
        mode=row.get('price_mode','none');n=float(row.get('price_val') or 0)
        if mode=='percent': value*=1+n/100
        elif mode=='multiplier': value*=n
    step=max(0,int(float(cfg.get('price_round') or 0)))
    if step: value=math.floor(value/step+.5)*step
    if value<0 or not math.isfinite(value): raise ValueError('قیمت محاسبه‌شدهٔ غرفه معتبر نیست.')
    return int(math.floor(value+.5))


def merge_vendors(before,patch,credentials,mode):
    """Keep nested credentials associated with vendor identity, never list index."""
    patch=dict(patch)
    if 'vendors' not in patch: return patch
    old={v['vendor_id']:v for v in normalize_config(before).get('vendors',[])}
    incoming=normalize_config(patch).get('vendors',[])
    if not credentials:
        # Existing shops remain byte-for-byte unchanged. No new token is adopted.
        patch.pop('vendors',None)
        return patch
    out=dict(old) if mode=='merge' else {}
    for row in incoming:
        if row.get('token')==MASK: raise ValueError('توکن ماسک‌شدهٔ غرفه قابل درون‌ریزی نیست؛ فایل اصلی را استفاده کنید.')
        out[row['vendor_id']]={**old.get(row['vendor_id'],{}),**row} if mode=='merge' else row
    patch['vendors']=list(out.values())
    return patch
