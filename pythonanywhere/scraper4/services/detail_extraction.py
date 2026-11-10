"""Explicit saved-product detail enrichment; no listing, imports or sends.

A primary-key high-water cursor bounds a run without loading all product keys
into a WSGI request or limiting coverage to the visible native product view.
"""
import json
from ..db import utc_now
from .scraping.detail import normalize_selectors


def enqueue(db,profile):
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute('SELECT settings FROM profiles WHERE id=?',(profile['id'],)).fetchone()
        if not row:raise ValueError('پروفایل حذف شده است.')
        settings=json.loads(row['settings'] or '{}')
        selectors=normalize_selectors(settings.get('detailSelectors') or {})
        from .scraping.engines import source_api
        if source_api(profile['url']) and not selectors:selectors={k:'@api' for k in ('longDesc','shortDesc','images','sku','brand','category','tags')}
        if not selectors:raise ValueError('ابتدا حداقل یک سلکتور جزئیات را در پروفایل ذخیره کنید.')
        active=conn.execute("SELECT id,kind,status,payload FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running','paused','failed')",(profile['id'],)).fetchall()
        if active:
            if len(active)==1 and active[0]['kind']=='extract' and active[0]['status']=='waiting' and json.loads(active[0]['payload']).get('_detail_only') is True:
                return {'id':active[0]['id'],'reused':True}
            raise ValueError('این پروفایل کار فعال، مکث‌شده یا ناموفق دارد؛ ابتدا همان ردیف را ادامه یا لغو کنید. کار جزئیات تکراری ساخته نشد.')
        snapshot=conn.execute("SELECT count(*) AS n,max(id) AS through_id FROM products WHERE profile_id=? AND trim(link)<>''",(profile['id'],)).fetchone()
        if not snapshot['n']:raise ValueError('این پروفایل محصول ذخیره‌شدهٔ دارای لینک ندارد؛ ابتدا فهرست را استخراج کنید.')
        payload={'_detail_only':True,'_detail_after_id':0,'_detail_through_id':snapshot['through_id'],'_detail_selectors':selectors,'_phase':'detail','with_detail':True,'detail_mode':'inline','render':'static','_send_after':[]}
        counters={'detail_only':True,'phase':'detail','found':snapshot['n'],'total':snapshot['n'],'current':0,'detail_current':0,'detail_total':snapshot['n']}
        now=utc_now()
        cur=conn.execute("INSERT INTO queue_entries(kind,profile_id,status,payload,counters,created_at,updated_at,heartbeat) VALUES ('extract',?,'waiting',?,?,?,?,?)",(profile['id'],json.dumps(payload),json.dumps(counters),now,now,now))
        return {'id':cur.lastrowid,'reused':False}


def step(db,settings,entry,profile,network_timeout=None):
    from .engine import _detail_step
    payload,counts=entry['payload'],entry['counters']
    with db.connect() as conn:
        row=conn.execute("SELECT id,key FROM products WHERE profile_id=? AND id>? AND id<=? AND trim(link)<>'' ORDER BY id LIMIT 1",(profile['id'],payload['_detail_after_id'],payload['_detail_through_id'])).fetchone()
    if not row:
        counts['phase']='complete'
        return True
    # Reuse the established parser, HTML sanitizer and nonempty merge. Failure
    # leaves the durable cursor untouched, so explicit resume retries this row.
    payload.update(_phase='detail',_detail_keys=[row['key']],_detail_index=0,_listing_done=True)
    completed=counts.get('current',0)
    _detail_step(db,settings,entry,profile,network_timeout)
    payload['_detail_after_id']=row['id'];payload['_phase']='detail'
    counts.update(current=completed+1,detail_current=completed+1,phase='detail')
    with db.connect() as conn:
        remaining=conn.execute("SELECT 1 FROM products WHERE profile_id=? AND id>? AND id<=? AND trim(link)<>'' LIMIT 1",(profile['id'],row['id'],payload['_detail_through_id'])).fetchone()
    if not remaining:counts['phase']='complete'
    return remaining is None
