"""Browser-driven fallback, not a WSGI daemon or a legacy PHP heartbeat.

External cron gets priority for 120 seconds after its last accepted trigger.
The engine rechecks this policy while holding the common worker lock.
"""
import time
from .worker_runtime import status as worker_status

EXTERNAL_FRESH_SECONDS = 120


def config(db):
    return {'enabled': db.checkpoint_read('browser-cron:config').get('enabled', True) is True}


def priority(db, settings):
    if not config(db)['enabled']:
        return {'reason': 'disabled', 'retry_after_seconds': 45}
    external = db.checkpoint_read('cron:external')
    if not external:
        # Before1.26 all http_tick calls were external; honor their last pulse
        # during an upgrade rather than racing a recently active scheduler.
        legacy=db.checkpoint_read('cron:last')
        if legacy.get('source','external')!='browser':external=legacy
    epoch = external.get('started_epoch')
    age = max(0, time.time()-epoch) if isinstance(epoch, (float, int)) else None
    if age is not None and age < EXTERNAL_FRESH_SECONDS:
        return {'reason': 'external_fresh', 'external_age_seconds': int(age),
                'retry_after_seconds': max(1, int(EXTERNAL_FRESH_SECONDS-age)+1)}
    if worker_status(db, settings)['observed_running']:
        return {'reason': 'worker_active', 'retry_after_seconds': 45}
    return None


def status(db, settings):
    return {'ok': True, 'config': config(db), 'priority': priority(db, settings),
            'last': db.checkpoint_read('browser-cron:last'),
            'external': db.checkpoint_read('cron:external'),
            'external_fresh_seconds': EXTERNAL_FRESH_SECONDS,
            'queue_alive': db.stats()['queue_alive'],
            'mode': 'browser_fallback', 'requires_open_browser': True,
            'note': 'وقتی کران بیرونی/worker فعال مشاهده نشود، مرورگر باز صف‌های ثبت‌شدهٔ استخراج و ارسال را مرحله‌ای جلو می‌برد؛ کار مکث‌شده/ناموفق خودکار ادامه نمی‌یابد.'}
