"""CLI-only long-running queue supervisor, PHP s4WorkerLoopFromCli adaptation.

No threads/process launch from WSGI. Each child uses the shared worker lock;
short unlocked gaps let HTTP cron/manual progress and deployments coexist.
"""
import fcntl
import os
import signal
import subprocess
import sys
import threading
import time

from ..config import VERSION
from ..db import utc_now
from .updates import read_release

DEFAULTS = {'enabled': False, 'poll_seconds': 5}


def config(db):
    value = db.checkpoint_read('worker:config')
    poll = value.get('poll_seconds', 5)
    return {'enabled': value.get('enabled') is True,
            'poll_seconds': poll if type(poll) is int and 5 <= poll <= 60 else 5}


def validate_config(value):
    if (not isinstance(value, dict) or set(value) != set(DEFAULTS) or type(value['enabled']) is not bool
            or type(value['poll_seconds']) is not int or not 5 <= value['poll_seconds'] <= 60):
        raise ValueError('تنظیم worker باید enabled بولی و poll_seconds عدد صحیح ۵ تا ۶۰ داشته باشد.')
    return value


def status(db, settings):
    held = False
    path = settings.db_path.with_suffix('.daemon.lock')
    try:
        with path.open('r+') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                held = True
    except FileNotFoundError:
        pass
    state = db.checkpoint_read('worker:state')
    epoch = state.get('heartbeat_epoch')
    age = max(0, int(time.time()-epoch)) if isinstance(epoch, (float, int)) else None
    return {'ok': True, 'config': config(db), 'state': state,
            'lock_held': held, 'heartbeat_age_seconds': age,
            'observed_running': held and age is not None and age < 120,
            'native_schedule': db.checkpoint_read('worker:schedule'),
            'note': 'فعال‌بودن تنظیم با اجرای واقعی فرق دارد؛ اجرای مشاهده‌شده به قفل و ضربان تازه نیاز دارد. worker فعال می‌تواند صف‌های ارسالِ قبلاً ثبت‌شده را هم پردازش کند.'}


def run_child(db, settings, command, pulse):
    # Only called from the CLI supervisor. Never return raw child logs to HTTP.
    with subprocess.Popen([sys.executable, '-m', 'scraper4', command, '--budget', '20'],
                          cwd=settings.base_dir) as child:
        while True:
            try:
                return child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                pulse()


def supervise(db, settings, *, max_runtime=0, stop=None, clock=time.monotonic, child=run_child):
    if type(max_runtime) is not int or not 0 <= max_runtime <= 43200:
        raise ValueError('max-runtime must be 0 (always-on) or 1..43200 seconds')
    stop = stop or threading.Event()  # event only, never creates a thread
    start = clock()
    loaded = read_release(settings.base_dir).get('commit')
    cycles = 0
    with settings.db_path.with_suffix('.daemon.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'ok': True, 'busy': True, 'cycles': 0}
        state = {'pid': os.getpid(), 'version': VERSION, 'commit': loaded, 'started_at': utc_now(), 'cycles': 0}
        def pulse(phase=None):
            if phase: state['phase'] = phase
            state.update(heartbeat_at=utc_now(), heartbeat_epoch=time.time(), cycles=cycles)
            db.checkpoint_write('worker:state', state)
        reason = 'stopped'
        next_maintenance = start
        try:
            pulse('starting')
            while not stop.is_set():
                if max_runtime and clock()-start >= max_runtime:
                    reason = 'runtime_limit'; break
                if read_release(settings.base_dir).get('commit') != loaded:
                    reason = 'code_changed'; break
                cfg = config(db)
                wait_seconds = min(cfg['poll_seconds'], max(0, max_runtime-(clock()-start))) if max_runtime else cfg['poll_seconds']
                if not cfg['enabled']:
                    pulse('disabled'); stop.wait(wait_seconds); continue
                command = 'maintain' if clock() >= next_maintenance else 'tick'
                if command == 'tick' and settings.auto_extract_minutes <= 0:
                    with db.connect() as conn:
                        waiting = conn.execute("SELECT 1 FROM queue_entries WHERE status IN ('waiting','running') LIMIT 1").fetchone()
                    if not waiting:
                        pulse('idle'); stop.wait(wait_seconds); continue
                if command == 'maintain': next_maintenance = clock()+300
                pulse('maintenance' if command == 'maintain' else 'processing')
                code = child(db, settings, command, pulse)
                cycles += 1
                state['last_exit_code'] = code
                pulse('idle' if code == 0 else 'child_failed')
                stop.wait(wait_seconds)  # no busy spin; failed writes are never auto-resumed
        finally:
            state.update(stop_reason=reason, stopped_at=utc_now())
            pulse('stopped')
    return {'ok': True, 'cycles': cycles, 'reason': reason}


def cli_worker(db, settings, max_runtime):
    stop = threading.Event()
    old = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    for sig in old: signal.signal(sig, lambda *_: stop.set())
    try:
        return supervise(db, settings, max_runtime=max_runtime, stop=stop)
    finally:
        for sig, handler in old.items(): signal.signal(sig, handler)
