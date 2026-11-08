"""Original Start only: selected extraction steps and safe local diagnostics.

No automatic runner, retry, sender, scheduling changes or arbitrary URLs. Shares
worker ownership and manual-step rate/deadline limits with the existing engine.
"""
from urllib.parse import quote
from . import php_ui, extraction_control, extraction_diagnostics, github_products

READS={'python_start_status','python_github_catalog'}
WRITES={'python_extract_start','python_extract_step'}


def jobs(db,settings,profile=None):
    diagnostics={j['job_id']:j for j in extraction_diagnostics.report(db,settings)['jobs']}
    values=[]
    for e in db.list_entries(limit=100):
        if e['kind']!='extract' or (profile is not None and e['profile_id']!=profile['id']):continue
        d=diagnostics.get(e['id'],{});c=e['counters'] if isinstance(e['counters'],dict) else {}
        values.append({'id':e['id'],'profile_id':e['profile_id'],'status':e['status'],'counts':d.get('counts',{}),
                       'error_code':d.get('error_code'),'hint':d.get('hint','') if e['status']=='failed' else '',
                       'empty':e['status']=='done' and c.get('found',0)==0,
                       'phase':c.get('phase') if c.get('phase') in ('listing','detail','complete') else '',
                       'updated_at':e['updated_at']})
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
    if data['action']=='python_github_catalog':return catalog(data['fields'])
    f=data['fields'];p=php_ui.find(db,f['profile']) if f.get('profile') else None
    return {'ok':True,'jobs':jobs(db,settings,p),'read_only':True,'limit':100,'automatic_execution':False}


def write(db,settings,data):
    f=data['fields'];p=php_ui.find(db,f.get('profile',''))
    if data['action']=='python_extract_start':
        created=php_ui.enqueue(db,data);entry_id=created['id']
    else:
        entry_id=php_ui.integer(f.get('id',''),minimum=1);e=db.get_entry(entry_id)
        if not e or e['kind']!='extract' or e['profile_id']!=p['id']:raise ValueError('این شناسه متعلق به استخراج پروفایل انتخاب‌شده نیست.')
    result,code=extraction_control.step(db,settings,entry_id=entry_id)
    # Never pass through raw exception/error/counters; old jobs may contain keys
    # or private URLs. Diagnostics are categorical and allowlisted.
    value=next((j for j in jobs(db,settings,p) if j['id']==entry_id),None)
    if value and value['status']=='failed':message=value['hint']
    elif code==503:message='برنامه در حالت نگهداری است؛ استخراج هنوز اجرا نشده است.'
    elif result.get('busy'):message='worker یا کران در حال اجراست؛ این کار در صف مانده است.'
    elif result.get('throttled'):message='برای اجرای دستی بعدی دست‌کم ۴۵ ثانیه فاصله لازم است.'
    elif result.get('ran'):
        message='یک مرحلهٔ واقعی اجرا شد؛ برای ادامه، worker/کران یا مرحلهٔ بعد لازم است.'
        if value and value['empty']:message='استخراج صفر محصول داشت؛ موتور، سلکتور و دسترسی مبدأ را بررسی کنید.'
    else:message='این استخراج در انتظار نیست؛ وضعیت مکث، شکست یا پایان را بررسی کنید.'
    out={'ok':result['ok'],'id':entry_id,'job':value,'ran':result.get('ran',0),'message':message,
         'busy':result.get('busy',False),'throttled':result.get('throttled',False),'retry_after_seconds':result.get('retry_after_seconds',0),
         'remote_send_executed':False,'automatic_execution':False}
    if not out['ok']:out['error']=message or 'استخراج اجرا نشد؛ وضعیت و گزارش امن را بررسی کنید.'
    return out,code
