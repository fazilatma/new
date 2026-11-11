"""Local update-source choices in a fixed repository, never GitHub mutations.

Separate checkpoint from portable update toggles. Worker lock + transaction keep
an in-flight/pending update's target from being silently changed. No shell/git.
"""
import fcntl
import json
import re
from ..db import utc_now

TASK='updates:branches'


def branch_name(value):
    if (not isinstance(value,str) or not 1<=len(value)<=160 or
        not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_./-]*',value) or
        any(x in value for x in ('..','//','@{')) or value.endswith(('/', '.')) or
        any(part.startswith('.') or part.endswith('.lock') for part in value.split('/'))):
        raise ValueError('نام شاخه معتبر نیست؛ نام سادهٔ Git بدون URL، فاصله یا نویسهٔ فرمان وارد کنید.')
    return value


def validate(value):
    if not isinstance(value,dict) or set(value)!={'branches','selected','revision'}:raise ValueError('ساختار فهرست شاخه‌ها معتبر نیست.')
    names=value['branches']
    if not isinstance(names,list) or not 1<=len(names)<=30:raise ValueError('بین۱ تا۳۰شاخه نگه دارید؛ آخرین شاخه قابل حذف نیست.')
    for name in names:branch_name(name)
    if len(set(names))!=len(names):raise ValueError('نام تکراری شاخه مجاز نیست.')
    if branch_name(value['selected']) not in names:raise ValueError('شاخهٔ فعال باید در فهرست باشد؛ پیش از حذف آن شاخهٔ دیگری انتخاب کنید.')
    if type(value['revision']) is not int or value['revision']<0:raise ValueError('نسخهٔ فهرست معتبر نیست.')
    return {**value,'branches':list(names)}


def read(db):
    from .updates import REF
    value=db.checkpoint_read(TASK)
    return validate(value) if value else {'branches':[REF],'selected':REF,'revision':0}


def save(db,settings,value):
    value=validate(value)
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('worker یا نصب فعال است؛ پس از پایان دوباره ذخیره کنید.') from None
        with db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            old=conn.execute('SELECT state FROM task_checkpoints WHERE task=?',(TASK,)).fetchone()
            previous=validate(json.loads(old[0])) if old else read(db)
            if previous['revision']!=value['revision']:raise ValueError('فهرست در صفحهٔ دیگری تغییر کرده؛ دوباره بارگذاری کنید.')
            op=conn.execute("SELECT state FROM task_checkpoints WHERE task='maintenance:request'").fetchone()
            if op and json.loads(op[0]).get('status') in ('pending','running'):raise ValueError('درخواست نگهداری در صف یا درحال اجراست؛ ابتدا آن را تمام کنید.')
            if (settings.base_dir/'.maintenance.json').exists():raise ValueError('نصب/بازیابی ناتمام است؛ ابتدا آن را برطرف کنید.')
            value['revision']+=1
            now=utc_now()
            conn.execute('''INSERT INTO task_checkpoints(task,state,created_at,updated_at) VALUES(?,?,?,?)
              ON CONFLICT(task) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at''',(TASK,json.dumps(value),now,now))
            if value['selected']!=previous['selected']:
                conn.execute("DELETE FROM task_checkpoints WHERE task='updates:state'")
    return value
