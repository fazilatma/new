"""Read-only extraction -> send provenance. Never reconcile/enqueue on polling.

Python children use batch extract:<root id> AND payload.source_extract_job;
profile similarity or a newer unrelated send is never sufficient evidence.
"""
import json
from collections import Counter
from ..db import utc_now
from . import php_ui
from .extraction_diagnostics import SAFE_HINTS

LIMIT=20
CHILD_LIMIT=100
KINDS=('woo_send','bsl_send')


def obj(raw):
    try:value=json.loads(raw or '{}')
    except (ValueError,TypeError):return {}
    return value if isinstance(value,dict) else {}


def source_job(raw):
    value=obj(raw).get('source_extract_job')
    return value if type(value) is int and 0<value<2**63 else None


def safe(row):
    c=obj(row['counters']);code=c.get('error_code');code=code if isinstance(code,str) else ''
    return {'id':row['id'],'kind':row['kind'],'status':row['status'],
            'counts':{k:c[k] for k in ('current','total','found','sent','updated','failed','skipped') if type(c.get(k)) is int and c[k]>=0},
            'hint':SAFE_HINTS.get(code,'خطای اجرا؛ پیش از ادامه، گزارش و مقصد را بررسی کنید.') if row['status']=='failed' else '',
            'updated_at':row['updated_at']}


def destination(kind,payload):
    vendor=payload.get('vendor_id')
    return kind,str(vendor) if kind=='bsl_send' and type(vendor) in (str,int) else ''


def status(db,fields):
    if set(fields)-{'profile'}:raise ValueError('فقط پروفایل برای وضعیت زنجیره پذیرفته می‌شود.')
    p=php_ui.find(db,fields['profile']) if fields.get('profile') else None
    rows=[]
    # One DB snapshot for roots, children and names; read-only, bounded results.
    with db.connect() as conn:
        # Connection-local pure parser: no optional SQLite JSON extension required.
        conn.create_function('s4_source_extract_job',1,source_job)
        conn.execute('BEGIN')
        roots=conn.execute("SELECT q.* FROM queue_entries q WHERE q.kind='extract' "+('AND q.profile_id=? ' if p else '')+"""ORDER BY CASE WHEN q.status IN ('waiting','running','paused','failed') OR EXISTS (
            SELECT 1 FROM queue_entries child WHERE child.batch_id='extract:'||q.id
            AND child.profile_id IS q.profile_id AND child.kind IN ('woo_send','bsl_send')
            AND child.status IN ('waiting','running','paused','failed')
            AND s4_source_extract_job(child.payload)=q.id
        ) THEN 0 ELSE 1 END,q.id DESC LIMIT ?""",((p['id'],LIMIT+1) if p else (LIMIT+1,))).fetchall()
        for root in roots[:LIMIT]:
            payload=obj(root['payload']);targets=payload.get('_send_after',[])
            targets=targets if isinstance(targets,list) else []
            expected_targets=Counter(destination(t['kind'],t.get('payload') if isinstance(t.get('payload'),dict) else {}) for t in targets if isinstance(t,dict) and t.get('kind') in KINDS)
            expected=sum(expected_targets.values())
            raw=conn.execute("SELECT * FROM queue_entries WHERE batch_id=? AND profile_id IS ? AND kind IN ('woo_send','bsl_send') ORDER BY id LIMIT ?",(f'extract:{root["id"]}',root['profile_id'],CHILD_LIMIT+1)).fetchall()
            children=[r for r in raw[:CHILD_LIMIT] if source_job(r['payload'])==root['id']]
            actual_targets=Counter(destination(r['kind'],obj(r['payload'])) for r in children)
            entries=[safe(root)]+[safe(r) for r in children];counts=obj(root['counters']);truncated=len(raw)>CHILD_LIMIT
            stage='extract';state=root['status'];message='استخراج در صف است؛ خواندن وضعیت آن را اجرا نمی‌کند.'
            if state=='running':message='استخراج در حال اجراست.'
            elif state in ('failed','paused','cancelled'):message='استخراج ناموفق، مکث‌شده یا لغوشده است؛ ادامه خودکار نیست.'
            elif state=='done':
                stage='done';message='استخراج پایان یافته است؛ برای این کار مقصد ارسالی ثبت نشده است.'
                if expected:
                    if counts.get('found')==0 and not children:
                        message='استخراج خالی است؛ هیچ ارسالی ساخته نشده است.'
                    elif truncated or actual_targets!=expected_targets:
                        stage='send';state='incomplete';message='زنجیرهٔ ارسال ناقص یا مبهم است؛ صف‌های گمشده را خودکار بازسازی نمی‌کنیم.'
                    else:
                        stage='send';states={r['status'] for r in children}
                        state=next((s for s in ('failed','paused','cancelled','running','waiting') if s in states),'done')
                        if state=='done':stage='done';message='کارهای زنجیره پایان یافته‌اند؛ شمارندهٔ خطاهای هر ارسال را هم بررسی کنید.'
                        else:message='وضعیت فقط متعلق به صف‌های فرزند همین استخراج است؛ ارسال با worker/کران انجام می‌شود.'
            if stage=='done' and any(e['counts'].get('failed',0)>0 for e in entries):
                state='completed_with_errors';message='کارها پایان یافته‌اند اما خطای محصول ثبت شده است؛ پایان کار به معنی موفقیت همهٔ ارسال‌ها نیست.'
            name=conn.execute('SELECT name FROM profiles WHERE id=?',(root['profile_id'],)).fetchone()
            rows.append({'id':root['id'],'profile_id':root['profile_id'],'profile_name':name[0] if name else 'پروفایل حذف‌شده',
                         'stage':stage,'status':state,'message':message,'expected_send_jobs':expected,'linked_send_jobs':len(children),
                         'children_truncated':truncated,'entries':entries})
    return {'ok':True,'rows':rows,'limit':LIMIT,'truncated':len(roots)>LIMIT,'child_limit':CHILD_LIMIT,
            'scope':'local_extract_roots_and_verified_send_children','read_only':True,'processed':False,
            'reconciliation_performed':False,'source_reachability_tested':False,'generated_at':utc_now()}
