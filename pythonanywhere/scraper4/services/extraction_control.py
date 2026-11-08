"""PHP extract queue status/manual progress adaptation; extraction only.

Never selects sends, retries failed jobs, enables public cron or auto-enqueues.
Shares the exact worker lock and step engine used by CLI/HTTP cron.
"""
import fcntl
import json
import math
import time
from dataclasses import replace

from ..db import utc_now
from .engine import run_entry


def status(db):
    with db.connect() as conn:
        conn.execute('BEGIN')
        counts = {row['status']: row['n'] for row in conn.execute(
            "SELECT status,count(*) n FROM queue_entries WHERE kind='extract' GROUP BY status")}
        rows = conn.execute('''SELECT q.id,q.profile_id,q.status,q.error,q.counters,q.updated_at,
            coalesce(nullif(p.name,''),p.key,'پروفایل حذف‌شده') AS profile_name
            FROM queue_entries q LEFT JOIN profiles p ON p.id=q.profile_id
            WHERE q.kind='extract' ORDER BY q.id DESC LIMIT 10''').fetchall()
    jobs = []
    for row in rows:
        value = dict(row)
        try:
            counters = json.loads(value['counters'] or '{}')
        except (ValueError, TypeError):
            counters = {}
        value['counters'] = counters if isinstance(counters, dict) else {}
        jobs.append(value)
    last = db.checkpoint_read('cron:last')
    return {'ok': True, 'counts': counts, 'jobs': jobs,
            'public_cron': db.checkpoint_read('cron:config').get('public_get') is True,
            'last_cron_at': last.get('started_at'), 'last_cron_status': last.get('status'),
            'last_manual': db.checkpoint_read('extract:manual:last'),
            'note': 'ثبت در صف به‌تنهایی کار را اجرا نمی‌کند. برای پیشرفت از کران/worker یا دکمهٔ اجرای یک مرحله استفاده کنید؛ وضعیت کران، اثبات فعال‌بودن یک زمان‌بندی خارجی نیست.'}


def step(db, settings, *, entry_id=None):
    if (settings.base_dir / '.maintenance.json').exists():
        return {'ok': False, 'error': 'برنامه در حالت نگهداری است.'}, 503
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'ok': True, 'busy': True, 'ran': 0, 'message': 'worker یا کران در حال اجراست؛ کمی بعد بررسی کنید.'}, 200
        previous = db.checkpoint_read('extract:manual:last')
        since = time.time() - previous.get('started_epoch', 0)
        if since < 45:
            return {'ok': True, 'throttled': True, 'ran': 0, 'retry_after_seconds': math.ceil(45 - since),
                    'message': 'برای مرحلهٔ دستی بعدی دست‌کم ۴۵ ثانیه فاصله لازم است.'}, 200
        if entry_id is None:
            entry = db.claim_next(('extract',))
        else:
            # Native Start must run its selected job, never an older unrelated
            # profile or a sender. Shared flock + atomic waiting-only claim.
            with db.connect() as conn:
                conn.execute('BEGIN IMMEDIATE')
                row=conn.execute("SELECT id FROM queue_entries WHERE id=? AND kind='extract' AND status='waiting'",(entry_id,)).fetchone()
                if row:
                    now=utc_now()
                    conn.execute("UPDATE queue_entries SET status='running',started_at=?,heartbeat=?,updated_at=? WHERE id=?",(now,now,now,entry_id))
            entry=db.get_entry(entry_id) if row else None
        if not entry:
            return {'ok': True, 'ran': 0, 'message': 'استخراج در انتظار وجود ندارد؛ کار مکث‌شده/ناموفق را پس از بررسی جداگانه ادامه دهید.'}, 200
        started = {'started_epoch': time.time(), 'started_at': utc_now(), 'job_id': entry['id'], 'status': 'running'}
        db.checkpoint_write('extract:manual:last', started)
        bounded = replace(settings, fetch_timeout=8, connect_timeout=3,
                          net=replace(settings.net, gap_ms=min(settings.net.gap_ms, 500), fallback=False),
                          render=replace(settings.render, timeout_ms=min(settings.render.timeout_ms, 5000)))
        run_entry(db, bounded, entry, time.monotonic()+15, max_steps=1, network_timeout=8)
        job = db.get_entry(entry['id'])
        db.checkpoint_write('extract:manual:last', {**started, 'status': job['status'], 'done_at': utc_now()})
        failed = job['status'] == 'failed'
        return {'ok': not failed, 'ran': 1, 'job_id': job['id'], 'status': job['status'], 'counters': job['counters'],
                'message': job['error'] if failed else job['counters'].get('warning') or 'یک مرحلهٔ استخراج اجرا شد؛ برای صفحات/جزئیات بعدی کران یا مرحلهٔ بعد لازم است.',
                **({'error': job['error']} if failed else {})}, 422 if failed else 200
