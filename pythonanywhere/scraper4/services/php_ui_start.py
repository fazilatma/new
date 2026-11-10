"""Original Start only: selected extraction steps and safe local diagnostics.

No automatic runner, retry, sender, scheduling changes or arbitrary URLs. Shares
worker ownership and manual-step rate/deadline limits with the existing engine.
"""
import json
from urllib.parse import quote
from . import php_ui, extraction_control, extraction_diagnostics, github_products

READS={'python_extract_row','python_start_status','python_github_catalog','sync_diagnose','sync_pipeline_status','python_sync_audit'}
WRITES={'python_detail_start','python_extract_start','python_extract_step','python_extract_resume'}


def jobs(db,settings,profile=None,entry_id=None):
    # Filter before LIMIT: busy send queues/other profiles must not hide this
    # profile's older waiting or failed extraction and its actionable diagnosis.
    with db.connect() as conn:
        query="SELECT id,profile_id,status,counters,updated_at,heartbeat,started_at FROM queue_entries WHERE kind='extract'"
        args=[]
        if profile:query+=' AND profile_id=?';args.append(profile['id'])
        if entry_id is not None:query+=' AND id=?';args.append(entry_id)
        rows=conn.execute(query+" ORDER BY CASE WHEN status IN ('waiting','running','paused','failed') THEN 0 ELSE 1 END, CASE WHEN status IN ('waiting','running','paused','failed') THEN id ELSE -id END LIMIT 100",args).fetchall()
    values=[]
    for e in rows:
        try:c=json.loads(e['counters'] or '{}')
        except (ValueError,TypeError):c={}
        if not isinstance(c,dict):c={}
        counts={k:c[k] for k in ('last_http_status','last_page_products','found','current','total','detail_current','detail_total','detail_enriched','detail_empty','detail_skipped','last_html_chars') if type(c.get(k)) is int}
        error=c.get('error_code') if isinstance(c.get('error_code'),str) and c['error_code'] in extraction_diagnostics.SAFE_HINTS else None
        values.append({'id':e['id'],'profile_id':e['profile_id'],'status':e['status'],'counts':counts,
                       'error_code':error,'hint':extraction_diagnostics.SAFE_HINTS.get(error,'خطای اجرای قدیمی؛ متن خام برای حفظ اطلاعات محرمانه نمایش داده نمی‌شود.') if e['status']=='failed' else '',
                       'empty':e['status']=='done' and counts.get('found',0)==0 and c.get('detail_only') is not True,'detail_only':c.get('detail_only') is True,
                       'phase':c.get('phase') if c.get('phase') in ('listing','detail','complete') else '',
                       'updated_at':e['updated_at'],'stale':e['status']=='running' and extraction_control.stale(dict(e),settings)})
    return values


def catalog(fields):
    cfg=github_products.config({'repo':fields.get('repo',''),'branch':fields.get('branch','main'),'path':'catalog.csv'})
    if fields.get('kind')=='branches':
        raw=github_products.api_read('repos/'+cfg['repo']+'/branches',{'per_page':100})
        if not isinstance(raw,list):raise ValueError('فهرست branch معتبر نیست.')
        return {'ok':True,'branches':[r['name'] for r in raw[:100] if isinstance(r,dict) and isinstance(r.get('name'),str)],'limit':100}
    if fields.get('kind')!='files':raise ValueError('نوع فهرست معتبر نیست.')
    raw=github_products.api_read('repos/'+cfg['repo']+'/git/trees/'+quote(cfg['branch'],safe=''),{'recursive':'1'})
    if not isinstance(raw,dict) or not isinstance(raw.get('tree'),list):raise ValueError('فهرست فایل معتبر نیست.')
    files=[r['path'] for r in raw['tree'] if isinstance(r,dict) and r.get('type')=='blob' and isinstance(r.get('path'),str) and r['path'].lower().endswith(('.csv','.xlsx')) and type(r.get('size')) is int and r['size']<=github_products.MAX_FILE]
    return {'ok':True,'files':files[:1000],'truncated':bool(raw.get('truncated')) or len(files)>1000,'limit':1000,'public_only':True}


def read(db,settings,data):
    if data['action']=='python_extract_row':
        f=data['fields'];p=php_ui.find(db,f.get('profile',''));eid=php_ui.integer(f.get('id',''),minimum=1)
        result=jobs(db,settings,p,entry_id=eid)
        if not result:raise ValueError('استخراج این ردیف پیدا نشد.')
        return {'ok':True,'job':result[0],'read_only':True,'processed':False}
    if data['action']=='python_github_catalog':return catalog(data['fields'])
    if data['action']=='python_sync_audit':
        from .sync_audit import page
        return page(db,settings,{k:v for k,v in data['fields'].items() if k!='action'})
    if data['action']=='sync_pipeline_status':
        from .php_ui_pipeline import status
        return status(db,{k:v for k,v in data['fields'].items() if k!='action'})
    if data['action']=='sync_diagnose':return diagnose(db,settings,data['fields'].get('profile'))
    f=data['fields'];p=php_ui.find(db,f['profile']) if f.get('profile') else None
    return {'ok':True,'jobs':jobs(db,settings,p),'read_only':True,'limit':100,'automatic_execution':False}


def write(db,settings,data):
    f=data['fields'];p=php_ui.find(db,f.get('profile',''))
    if data['action']=='python_detail_start':
        from .detail_extraction import enqueue
        created=enqueue(db,p);entry_id=created['id']
    elif data['action']=='python_extract_start':
        created=php_ui.enqueue(db,data,reuse_waiting=True);entry_id=created['id']
    else:
        entry_id=php_ui.integer(f.get('id',''),minimum=1);e=db.get_entry(entry_id)
        if not e or e['kind']!='extract' or e['profile_id']!=p['id']:raise ValueError('این شناسه متعلق به استخراج پروفایل انتخاب‌شده نیست.')
    result,code=extraction_control.step(db,settings,entry_id=entry_id,resume=data['action']=='python_extract_resume',profile_id=p['id'])
    # Never pass through raw exception/error/counters; old jobs may contain keys
    # or private URLs. Diagnostics are categorical and allowlisted.
    value=next((j for j in jobs(db,settings,p,entry_id=entry_id) if j['id']==entry_id),None)
    if result.get('error') and code==409:message=result['error']
    elif code==503:message='برنامه در حالت نگهداری است؛ استخراج هنوز اجرا نشده است.'
    elif result.get('busy'):message='worker یا کران در حال اجراست؛ این کار در صف مانده است.'
    elif result.get('throttled'):message='برای اجرای دستی بعدی دست‌کم ۴۵ ثانیه فاصله لازم است.'
    elif value and value['status']=='failed':message=value['hint']
    elif result.get('ran'):
        message='یک مرحلهٔ واقعی اجرا شد؛ برای ادامه، worker/کران یا مرحلهٔ بعد لازم است.'
        if value and value['empty']:message='استخراج صفر محصول داشت؛ موتور، سلکتور و دسترسی مبدأ را بررسی کنید.'
        if value and value['detail_only'] and value['counts'].get('detail_empty',0)>0 and not value['counts'].get('detail_enriched',0):message='صفحهٔ جزئیات خوانده شد ولی فیلدی مطابق سلکتورها پیدا نشد؛ دادهٔ قبلی حفظ شد. CSS و مبدأ را بررسی کنید.'
    else:message='این استخراج در انتظار نیست؛ وضعیت مکث، شکست یا پایان را بررسی کنید.'
    out={'ok':result['ok'],'id':entry_id,'job':value,'ran':result.get('ran',0),'message':message,
         'busy':result.get('busy',False),'throttled':result.get('throttled',False),'retry_after_seconds':result.get('retry_after_seconds',0),
         'remote_send_executed':False,'automatic_execution':False,'reused':data['action'] in ('python_extract_start','python_detail_start') and created.get('reused',False)}
    if not out['ok']:out['error']=message or 'استخراج اجرا نشد؛ وضعیت و گزارش امن را بررسی کنید.'
    return out,code



def named_report(db,settings,name):
    """Browser-admin read only: no source fetch, secrets, URL, or job mutation."""
    if not isinstance(name,str) or not name.strip() or len(name)>200:raise ValueError('نام پروفایل لازم است (حداکثر ۲۰۰ نویسه).')
    def normalized(value):return ' '.join(value.replace('ي','ی').replace('ك','ک').replace('\u200c',' ').split())
    matches=[p for p in db.list_profiles() if normalized(p['name'])==normalized(name)]
    if len(matches)!=1:
        return {'ok':False,'error':'پروفایل پیدا نشد.' if not matches else 'نام پروفایل یکتا نیست؛ پروفایل مشخص را در رابط انتخاب کنید.','reason':'not_found' if not matches else 'ambiguous','read_only':True},404 if not matches else 409
    return profile_report(db,settings,matches[0]),200


def profile_report(db,settings,p):
    items=jobs(db,settings,p);active=[j for j in items if j['status'] in ('waiting','running','paused','failed')]
    if not active:reason='no_active_extract';hint='کار فعال ندارد؛ پس از ذخیرهٔ تغییرات دکمهٔ شروع را بزنید.'
    elif len(active)>1:reason='multiple_active_extracts';hint='چند کار قبلی دارد؛ وضعیت هر کدام را بررسی کنید، کار تکراری اجرا نمی‌شود.'
    else:
        state=active[0]['status'];reason='existing_'+state
        hint={'waiting':'دکمهٔ شروع باید یک مرحله از همین کار در انتظار را اجرا کند، نه کار تکراری.','running':'کار در حال اجراست؛ وضعیت/ضربان worker را بررسی کنید؛ قفل یا کار فعال را خودکار آزاد نمی‌کنیم.','paused':'کار مکث شده است؛ ابتدا «ادامه پس از بررسی» و سپس «مرحلهٔ بعد» را بزنید.','failed':'کار قبلی ناموفق است؛ علت را بررسی و سپس صریحاً ادامه یا لغو کنید.'}[state]
    return {'ok':True,'profile':{'id':p['id'],'name':p['name'],'engine':php_ui.profile_engine(p),'listing_selectors_configured':bool(p['selectors'].get('container') and p['selectors'].get('title'))},
            'reason':reason,'hint':hint,'jobs':items,'limit':100,'active_jobs_first':True,'read_only':True,'processed':False,'source_reachability_tested':False}


def diagnose(db,settings,key=None):
    available=[php_ui.find(db,key)] if key else db.list_profiles();profiles=available[:100]
    renderer=bool(db.get_config('render').get('url') or settings.render.url);items=[]
    for p in profiles:
        engine=php_ui.profile_engine(p);opts=php_ui.start_page.options(p)
        configured=bool(p['selectors'].get('container') and p['selectors'].get('title')) if engine=='selectors' and opts['source']=='direct' else True
        if opts['source']=='direct' and engine in ('playwright','selenium') and not renderer:configured=False
        active=[j for j in jobs(db,settings,p) if j['status'] in ('waiting','running','paused','failed')]
        items.append({'id':p['id'],'name':p['name'],'engine':engine,'ok':configured,'active_extracts':len(active),
                      'msg':'پیکربندی پایه موجود است؛ دسترسی مبدأ آزمایش نشده است.' if configured else 'سلکتور ظرف/عنوان یا renderer مورد نیاز کامل نیست.'})
    return {'ok':True,'checks':[{'ok':all(p['ok'] for p in items),'msg':str(len(items))+' پروفایل بررسی شد؛ بررسی پیکربندی ذخیره‌شده است، نه تست زندهٔ سایت.'}],
            'profiles':items,'limit':100,'truncated':len(available)>100,'renderer_configured':renderer,'read_only':True,'processed':False,'source_reachability_tested':False}
