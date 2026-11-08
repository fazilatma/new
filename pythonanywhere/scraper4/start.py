"""Browser-only Start controls. Uses existing schema and resumable worker."""
import json
import uuid
from flask import Blueprint, abort, jsonify, request, session
from .db import utc_now
from .services import start_page
from .services.basalam.shops import resolve


def register_start(app,db,settings):
    bp=Blueprint('start',__name__)
    @bp.before_request
    def browser_only():
        if not session.get('authenticated') or request.environ.get('s4.bearer'):abort(403)

    @bp.get('/api/start/overview')
    def overview():return jsonify(start_page.overview(db))

    @bp.post('/api/start/snapshot')
    def snapshot():
        if request.get_json()!={}:raise ValueError('درخواست باید شیء خالی باشد.')
        return jsonify(start_page.snapshot(db))

    @bp.post('/api/start/profile')
    def save():return jsonify(ok=True,profile=start_page.save_profile(db,request.get_json()))

    @bp.post('/api/start/profiles/<int:profile_id>/duplicate')
    def duplicate(profile_id):
        data=request.get_json();source=db.get_profile(profile_id)
        if not source:abort(404)
        if not isinstance(data,dict) or set(data)-{'name','url'}:raise ValueError('فقط نام و آدرس کپی پذیرفته می‌شود.')
        name=data.get('name','');url=data.get('url') or source['url']
        if not isinstance(name,str) or not name.strip() or len(name)>200:raise ValueError('نام معتبر لازم است.')
        if not isinstance(url,str) or len(url)>2000:raise ValueError('آدرس کپی معتبر نیست.')
        start_page.validate_url(url)
        # Deliberately do NOT copy products/remote IDs. The source remains intact.
        profile=db.upsert_profile('copy-'+uuid.uuid4().hex,url,name.strip(),source['selectors'],source['pagination'],source['settings'],source['enabled'])
        return jsonify(ok=True,profile=profile,products_copied=False),201

    @bp.post('/api/start/enqueue')
    def enqueue():
        data=request.get_json()
        if not isinstance(data,dict) or set(data)-{'profile_id','pages','render','send_after'} or type(data.get('profile_id')) is not int:raise ValueError('درخواست صف معتبر نیست.')
        profile=db.get_profile(data['profile_id'])
        if not profile:abort(404)
        pages=data.get('pages',profile['settings'].get('startPages',10));render=data.get('render','static')
        if type(pages) is not int or not 0<=pages<=1000 or render not in ('static','auto','js'):raise ValueError('تعداد صفحه / رندر معتبر نیست.')
        targets=data.get('send_after',[])
        if not isinstance(targets,list) or len(targets)>2:raise ValueError('حداکثر یک ووکامرس و یک غرفهٔ باسلام.')
        sends=[];seen=set()
        for target in targets:
            if not isinstance(target,dict) or set(target)-{'kind','vendor_id','status'}:raise ValueError('مقصد معتبر نیست.')
            kind=target.get('kind');payload={}
            if kind=='woo_send':
                cfg=db.get_config('woocommerce')
                if not all(cfg.get(k) for k in ('store_url','consumer_key','consumer_secret')):raise ValueError('اتصال ووکامرس کامل نیست.')
                status=target.get('status','draft')
                if status not in ('draft','publish','pending'):raise ValueError('وضعیت ووکامرس معتبر نیست.')
                payload['status']=status
            elif kind=='bsl_send':payload['vendor_id']=resolve(db.get_config('basalam'),target.get('vendor_id'))['vendor_id']
            else:raise ValueError('مقصد معتبر نیست.')
            if kind in seen:raise ValueError('مقصد تکراری است.')
            seen.add(kind);sends.append({'kind':kind,'payload':payload})
        opts=start_page.options(profile)
        payload={'pages':pages,'render':render,'with_detail':opts['with_detail'],
                 'detail_mode':opts['detail_mode'],'_send_after':sends}
        # A double click must not start competing extractions or two send chains.
        with db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            if conn.execute("SELECT id FROM queue_entries WHERE profile_id=? AND kind='extract' AND status IN ('waiting','running','paused')",(profile['id'],)).fetchone():
                return jsonify(ok=False,error='همین پروفایل استخراج فعال یا مکث‌شده دارد؛ ابتدا آن را ادامه یا لغو کنید.'),409
            now=utc_now();cursor=conn.execute('''INSERT INTO queue_entries(kind,profile_id,status,payload,counters,created_at,updated_at,heartbeat)
                VALUES ('extract',?,'waiting',?,'{}',?,?,?)''',(profile['id'],json.dumps(payload),now,now,now))
            entry_id=cursor.lastrowid
        return jsonify(ok=True,id=entry_id),202

    @bp.post('/api/start/profiles/<int:profile_id>/pause')
    def pause(profile_id):
        data=request.get_json()
        if not isinstance(data,dict) or set(data)!={'chain'} or type(data['chain']) is not bool:raise ValueError('دامنهٔ مکث باید صریح باشد.')
        if not db.get_profile(profile_id):abort(404)
        with db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            candidates=conn.execute("SELECT id,kind,batch_id FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running')",(profile_id,)).fetchall()
            ids=[r['id'] for r in candidates if r['kind']=='extract' or (data['chain'] and str(r['batch_id'] or '').startswith('extract:'))]
            for entry_id in ids:conn.execute("UPDATE queue_entries SET status='paused',updated_at=? WHERE id=?",(utc_now(),entry_id))
        return jsonify(ok=True,paused=len(ids),remote_request_may_finish=True)

    @bp.post('/api/start/queues/clear-finished')
    def clear():
        if request.get_json()!={}:raise ValueError('درخواست باید شیء خالی باشد.')
        with db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            jobs=[r['id'] for r in conn.execute("SELECT id FROM queue_entries WHERE status IN ('done','cancelled')")]
            for job in jobs:conn.execute('DELETE FROM task_checkpoints WHERE task GLOB ?',(f'start:seen:{job}:*',))
            count=conn.execute("DELETE FROM queue_entries WHERE status IN ('done','cancelled')").rowcount
        return jsonify(ok=True,removed=count,preserved='waiting,running,paused,failed')
    app.register_blueprint(bp)


def finish_extraction(db,entry):
    """Atomically finish source + create children, never sending in this call.

    A pause/cancel racing the network boundary wins. No child on empty/failed
    extraction. Children send ALL saved products in this profile (explicit UI
    confirmation), not an invented source delta. Existing sender ambiguity rules
    and per-vendor identity remain in force.
    """
    now=utc_now()
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        live=conn.execute('SELECT status FROM queue_entries WHERE id=?',(entry['id'],)).fetchone()
        if not live or live['status']!='running':return
        targets=entry['payload'].get('_send_after',[]) if entry['counters'].get('found',0)>0 else []
        children=[]
        for target in targets:
            payload={**target['payload'],'source_extract_job':entry['id']}
            cursor=conn.execute('''INSERT INTO queue_entries(kind,profile_id,status,payload,counters,created_at,updated_at,heartbeat,batch_id)
                VALUES (?,?,'waiting',?,'{}',?,?,?,?)''',(target['kind'],entry['profile_id'],json.dumps(payload),now,now,now,f'extract:{entry["id"]}'))
            children.append(cursor.lastrowid)
        entry['counters']['send_jobs']=children
        entry['counters']['phase']='complete'
        if entry['payload'].get('pages')==0 and entry['counters'].get('source')!='github':entry['counters']['total']=entry['counters'].get('current',0)
        if entry['payload'].get('_send_after') and not children:entry['counters']['warning']='استخراج خالی است؛ هیچ ارسالی صف نشد.'
        conn.execute("UPDATE queue_entries SET status='done',error='',done_at=?,updated_at=?,heartbeat=?,counters=? WHERE id=?",(now,now,now,json.dumps(entry['counters']),entry['id']))
        conn.execute('DELETE FROM task_checkpoints WHERE task GLOB ?',(f'start:seen:{entry["id"]}:*',))
