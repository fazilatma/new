"""Real bounded native-client operations; no PHP GET heartbeat ever executes work.

Writes are called only by CSRF-protected browser APIs after trusted-parent
confirmation. Sends enqueue pinned destinations; no remote HTTP occurs here.
"""
import json
import uuid
from ..db import utc_now
from . import php_ui
from .basalam.shops import resolve
from .extraction_diagnostics import SAFE_HINTS

READS={'woo_queue_status','bsl_queue_status','tasks_list','poll_woo','poll_basalam','poll_bsl','poll_extract','python_contracts','python_capabilities'}
WRITES={'python_send_enqueue','python_manual_sync','python_queue_control','python_queue_clear','python_profile_duplicate','python_profile_delete'}


def rows(db,kind=None):
    profiles={p['id']:p for p in db.list_profiles()};out=[]
    with db.connect() as conn:
        raw=conn.execute("SELECT * FROM queue_entries "+('WHERE kind=? ' if kind else '')+"ORDER BY id DESC LIMIT 100",(kind,) if kind else ()).fetchall()
    entries=[{**dict(e),'payload':json.loads(e['payload']),'counters':json.loads(e['counters'])} for e in raw]
    for e in entries:
        p=profiles.get(e['profile_id'],{});c=e['counters'];c=c if isinstance(c,dict) else {};total=c.get('total',0)
        out.append({'id':str(e['id']),'kind':e['kind'],'profile_key':p.get('key',''),'profile_name':p.get('name','پروفایل حذف‌شده'),'status':e['status'],
                    'current':c.get('current',0),'total':total,'products_count':c.get('found',0),'sent':c.get('sent',0),'updated':c.get('updated',0),'failed':c.get('failed',0),
                    'phase':c.get('phase',''),'vendor_id':str(e['payload'].get('vendor_id') or ''),'batch_id':e.get('batch_id',''),
                    'error':SAFE_HINTS.get(c.get('error_code'),'خطای اجرا؛ گزارش حساب را پیش از ادامه بررسی کنید.') if e['status']=='failed' else '',
                    'resumable':bool(p) and e['status'] in ('paused','failed'),'updated_at':e['updated_at']})
    return out


def queue(db,kind):
    entries=rows(db,kind)
    return {'ok':True,'entries':entries,'active_send':next((e for e in entries if e['status']=='running'),None),'read_only':True,'limit':100}


def tasks(db):
    values=rows(db);tasks=[]
    for i,e in enumerate(values):
        state={'running':'running','waiting':'idle','paused':'idle','failed':'stale','done':'done','cancelled':'done'}[e['status']]
        tasks.append({'key':'py:'+e['id'],'title':{'extract':'استخراج','woo_send':'ارسال ووکامرس','bsl_send':'ارسال باسلام'}.get(e['kind'],e['kind']),
                      'icon':'📦','tab':'شروع' if e['kind']=='extract' else 'ارسال','pane':'start' if e['kind']=='extract' else 'send',
                      'profile_name':e['profile_name'],'profile_task':True,'rank':i+1,'state':state,'phase':e['phase'] or e['status'],
                      'current':e['current'],'total':e['total'],'percent':round(e['current']*100/e['total']) if e['total'] else -1,
                      'stoppable':e['status'] in ('waiting','running'),'resumable':e['resumable'],'clearable':e['status'] in ('done','cancelled'),
                      'cancelled':e['status']=='cancelled','ts':php_ui.stamp(e['updated_at']),'age':0,'log':[e['error']] if e['error'] else [],'stats':[]})
    return {'ok':True,'tasks':tasks,'jobs':[],'running':sum(e['status']=='running' for e in values),'stale':sum(e['status']=='failed' for e in values),
            'now':php_ui.stamp(utc_now()),'auto_resume_all_enabled':False,'extract_task_concurrency':1,'read_only':True,'limit':100}


def progress(db,kind):
    entries=rows(db,kind);e=next((e for e in entries if e['status']=='running'),entries[0] if entries else {})
    return {'ok':True,'running':e.get('status')=='running','done':e.get('status') in ('done','cancelled','failed'),'queue_id':e.get('id',''),
            'current':e.get('current',0),'total':e.get('total',0),'sent':e.get('sent',0),'updated':e.get('updated',0),'failed':e.get('failed',0),
            'extracted':e.get('products_count',0),'recent_log':[e['error']] if e.get('error') else [],'total_log_count':int(bool(e.get('error'))),
            'cancelled':e.get('status')=='cancelled','read_only':True,'limit':100}


def read(db,settings,data):
    action=data['action']
    if action=='tasks_list':return tasks(db)
    if action in ('woo_queue_status','bsl_queue_status'):return queue(db,'woo_send' if action.startswith('woo') else 'bsl_send')
    if action in ('poll_woo','poll_basalam','poll_bsl','poll_extract'):return progress(db,{'poll_woo':'woo_send','poll_basalam':'bsl_send','poll_bsl':'bsl_send','poll_extract':'extract'}[action])
    if action in ('python_contracts','python_capabilities'):return contracts()
    raise ValueError(php_ui.UNSUPPORTED)


def kinds(value):
    if value not in ('extract','woo_send','bsl_send'):raise ValueError('نوع صف معتبر نیست.')
    return value


def destinations(db,fields):
    target=fields.get('target','none');out=[]
    if target not in ('woo','bsl','both','none'):raise ValueError('مقصد معتبر نیست.')
    if target in ('woo','both'):
        cfg=db.get_config('woocommerce');status=fields.get('status','draft')
        if not all(cfg.get(k) for k in ('store_url','consumer_key','consumer_secret')):raise ValueError('اتصال ووکامرس کامل نیست.')
        if status not in ('draft','publish','pending'):raise ValueError('وضعیت ووکامرس معتبر نیست.')
        out.append({'kind':'woo_send','payload':{'status':status}})
    if target in ('bsl','both'):
        selected=php_ui.decoded(fields,'vendor_ids',None)
        if selected is None:selected=[fields.get('vendor_id') or '']
        if not isinstance(selected,list) or not 1<=len(selected)<=50 or any(not isinstance(v,str) for v in selected):raise ValueError('حداکثر ۵۰ غرفهٔ ذخیره‌شده؛ انتخاب خالی معتبر نیست.')
        seen=set();cfg=db.get_config('basalam')
        for vid in selected:
            shop=resolve(cfg,vid)
            if shop['vendor_id'] in seen:raise ValueError('غرفهٔ تکراری مجاز نیست.')
            seen.add(shop['vendor_id']);out.append({'kind':'bsl_send','payload':{'vendor_id':shop['vendor_id']}})
    return out


def create(db,data,manual=False):
    f=data['fields'];p=php_ui.find(db,f.get('profile',''));targets=destinations(db,f)
    if not manual and not targets:raise ValueError('مقصد ارسال لازم است.')
    pages=php_ui.integer(f.get('pages','10'),maximum=1000);batch='native:'+uuid.uuid4().hex
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        raw=conn.execute('SELECT * FROM profiles WHERE id=?',(p['id'],)).fetchone()
        if not raw:raise ValueError('پروفایل حذف شده است.')
        p={**dict(raw),'settings':json.loads(raw['settings'])};opts=php_ui.start_page.options(p)
        active=conn.execute("SELECT kind,payload FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running','paused','failed')",(p['id'],)).fetchall()
        if manual and any(r['kind']=='extract' for r in active):raise ValueError('پروفایل استخراج فعال یا مکث‌شده دارد.')
        reserved=[]
        for r in active:
            payload=json.loads(r['payload'])
            if r['kind']=='extract':reserved.extend(payload.get('_send_after',[]))
            else:reserved.append({'kind':r['kind'],'payload':payload})
        for t in targets:
            if any(r['kind']==t['kind'] and (t['kind']!='bsl_send' or not r['payload'].get('vendor_id') or str(r['payload']['vendor_id'])==t['payload']['vendor_id']) for r in reserved):raise ValueError('همین مقصد صف فعال/ناموفق یا زنجیرهٔ رزروشده دارد؛ کار تکراری ایجاد نشد.')
        if not manual and not conn.execute('SELECT id FROM products WHERE profile_id=? LIMIT 1',(p['id'],)).fetchone():raise ValueError('پروفایل محصول ذخیره‌شده ندارد.')
        now=utc_now();created=[]
        selected=[{'kind':'extract','payload':{'pages':pages,'render':'static','with_detail':opts['with_detail'],'detail_mode':opts['detail_mode'],'_send_after':targets}}] if manual else targets
        for t in selected:
            cur=conn.execute("INSERT INTO queue_entries(kind,profile_id,status,payload,counters,created_at,updated_at,heartbeat,batch_id) VALUES (?,?,'waiting',?,'{}',?,?,?,?)",(t['kind'],p['id'],json.dumps(t['payload']),now,now,now,batch));created.append(cur.lastrowid)
    return {'ok':True,'ids':created,'queued':True,'processed':False,'remote_http_performed':False,'all_saved_profile_products':True,'send_after':targets if manual else [],'batch_id':batch}


def control(db,data):
    f=data['fields'];action=f.get('control');states={'pause':'paused','resume':'waiting','cancel':'cancelled','delete':'delete'}
    if action not in states:raise ValueError('کنترل صف معتبر نیست.')
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if f.get('id'):
            eid=php_ui.integer(f['id'],minimum=1);entries=conn.execute('SELECT * FROM queue_entries WHERE id=?',(eid,)).fetchall()
            if not entries:raise ValueError('کار پیدا نشد.')
        else:
            if action!='pause':raise ValueError('شناسهٔ صریح کار لازم است.')
            p=php_ui.find(db,f.get('profile',''));kind=kinds(f.get('kind'));entries=conn.execute("SELECT * FROM queue_entries WHERE profile_id=? AND kind=? AND status IN ('waiting','running')",(p['id'],kind)).fetchall()
        changed=0
        for e in entries:
            if action=='delete':
                if e['status'] not in ('done','cancelled'):raise ValueError('ابتدا کار را لغو کنید؛ حذف ردِ کار فعال/ناموفق مجاز نیست.')
                conn.execute('DELETE FROM task_checkpoints WHERE queue_entry_id=?',(e['id'],))
                conn.execute('DELETE FROM queue_entries WHERE id=?',(e['id'],));changed+=1;continue
            if e['status'] in ('done','cancelled'):raise ValueError('کار پایان‌یافته/لغوشده قابل ادامه نیست.')
            if action=='pause' and e['status'] not in ('waiting','running'):raise ValueError('فقط کار در انتظار/در حال اجرا قابل مکث است.')
            if action=='resume' and not conn.execute('SELECT id FROM profiles WHERE id=?',(e['profile_id'],)).fetchone():raise ValueError('پروفایل کار حذف شده است؛ ادامه مجاز نیست.')
            if action=='resume' and e['status'] not in ('paused','failed'):raise ValueError('فقط کار مکث‌شده یا ناموفق قابل ادامه است.')
            if action=='resume' and e['kind']!='extract' and e['status']=='failed' and f.get('acknowledge_remote_reconciliation')!='1':raise ValueError('پاسخ ارسال ممکن است مبهم باشد؛ ابتدا مقصد و شناسهٔ محصول را بررسی و تأیید کنید. ادامهٔ خودکار مجاز نیست.')
            conn.execute('UPDATE queue_entries SET status=?,error=?,updated_at=? WHERE id=?',(states[action],'',utc_now(),e['id']));changed+=1
    return {'ok':True,'changed':changed,'control':action,'remote_request_may_finish':action in ('pause','cancel'),'processed':False}


def clear(db,data):
    f=data['fields'];kind=f.get('kind');kinds(kind)
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        ids=[r[0] for r in conn.execute("SELECT id FROM queue_entries WHERE kind=? AND status IN ('done','cancelled')",(kind,))]
        for eid in ids:
            conn.execute('DELETE FROM task_checkpoints WHERE queue_entry_id=?',(eid,));conn.execute('DELETE FROM queue_entries WHERE id=?',(eid,))
    return {'ok':True,'removed':len(ids),'preserved':'waiting,running,paused,failed'}


def profile_change(db,data):
    f=data['fields'];p=php_ui.find(db,f.get('profile',''))
    if data['action']=='python_profile_duplicate':
        name=f.get('name','').strip()
        if not name or len(name)>200:raise ValueError('نام کپی لازم است.')
        copy=db.upsert_profile('copy-'+uuid.uuid4().hex,p['url'],name,p['selectors'],p['pagination'],p['settings'],p['enabled'])
        return {'ok':True,'key':copy['key'],'name':copy['name'],'url':copy['url'],'updated_at':php_ui.stamp(copy['updated_at']),'product_count':0,'products_copied':False,'revision':php_ui.revision(copy)}
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        if conn.execute("SELECT id FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running','paused','failed') LIMIT 1",(p['id'],)).fetchone():raise ValueError('ابتدا کارهای فعال/ناموفق پروفایل را تمام یا لغو کنید؛ شناسه‌های مقصد را نگه دارید.')
        # Explicit local profile delete: do not touch destination products.
        conn.execute('DELETE FROM profiles WHERE id=?',(p['id'],))
    return {'ok':True,'deleted':True,'remote_products_deleted':False}


def write(db,settings,data):
    op=data['action']
    if op in ('python_send_enqueue','python_manual_sync'):return create(db,data,op=='python_manual_sync')
    if op=='python_queue_control':return control(db,data)
    if op=='python_queue_clear':return clear(db,data)
    if op in ('python_profile_duplicate','python_profile_delete'):return profile_change(db,data)
    raise ValueError(php_ui.UNSUPPORTED)


def contracts():
    return {'ok':True,'read_actions':sorted(php_ui.READS|READS),'write_actions':sorted(php_ui.WRITES|WRITES),
            'ui_actions':['python_open_panel'],'full_php_parity':False,'heartbeat_can_run_cron':False,
            'trusted_panels':['woocommerce','basalam','backup','general','version','render','guardian','profile-stats','profile','selectors','results','audit'],
            'secret_operations':'trusted_parent_only','unknown_action_http_status':501}
