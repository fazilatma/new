"""One shared local-only cleanup implementation for both native and Python UI."""
import fcntl
import json
from itsdangerous import URLSafeTimedSerializer, BadSignature
from . import profile_options as options


def preview(db,settings,pid,mode,binding):
    p=db.get_profile(pid)
    if not p:raise ValueError('پروفایل پیدا نشد.')
    with db.connect() as conn:rows,digest=options.cleanup_candidates(conn,p,mode)
    proof=URLSafeTimedSerializer(settings.secret_key,salt='s4-profile-cleanup-v1').dumps({'profile_id':pid,'mode':mode,'digest':digest,'csrf':binding})
    return dict(ok=True,count=len(rows),limit=1000,proof=proof,remote_products_deleted=False)


def apply(db,settings,pid,proof,binding):
    if not isinstance(proof,str) or len(proof)>3000:raise ValueError('پیش‌نمایش معتبر لازم است.')
    try:value=URLSafeTimedSerializer(settings.secret_key,salt='s4-profile-cleanup-v1').loads(proof,max_age=300)
    except BadSignature:raise ValueError('پیش‌نمایش منقضی/نامعتبر است؛ دوباره بررسی کنید.') from None
    if value.get('profile_id')!=pid or value.get('csrf')!=binding:raise ValueError('پیش‌نمایش متعلق به این پروفایل/نشست نیست.')
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('worker فعال است؛ پس از پایان درخواست جاری دوباره تلاش کنید.') from None
        with db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            raw=conn.execute('SELECT * FROM profiles WHERE id=?',(pid,)).fetchone()
            if not raw:raise ValueError('پروفایل پیدا نشد.')
            p={**dict(raw),'settings':json.loads(raw['settings'] or '{}')}
            if conn.execute("SELECT id FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running','paused','failed') LIMIT 1",(pid,)).fetchone():raise ValueError('کار فعال/ناموفق همین پروفایل را ابتدا تمام یا لغو کنید؛ شناسه‌های مقصد برای بررسی لازم‌اند.')
            rows,digest=options.cleanup_candidates(conn,p,value['mode'])
            if digest!=value['digest']:return dict(ok=False,error='محصولات یا تنظیمات تغییر کردند؛ پیش‌نمایش را دوباره بگیرید.')
            for row in rows:
                conn.execute('DELETE FROM task_checkpoints WHERE task GLOB ?',(f'basalam:remote:{row[0]}:*',))
                conn.execute('DELETE FROM products WHERE id=? AND profile_id=?',(row[0],pid))
            conn.execute('UPDATE profiles SET products_count=(SELECT count(*) FROM products WHERE profile_id=?) WHERE id=?',(pid,pid))
    return dict(ok=True,removed=len(rows),remote_products_deleted=False)
