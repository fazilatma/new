"""CLI installer finalization only. Never called from an HTTP route.

Bootstrap holds the existing worker lock across installation and this call.
Only clear a stale marker after the complete newly installed tree validates;
do not run maintenance: that CLI would execute queue work after recovery.
"""
import fcntl
import json
import math
import time
from . import updates


def finish_recovery(db,settings,*,lock_fd,clock=time.time):
    # Caller must supply the bootstrap's actual inherited, already-held flock.
    # An arbitrary HTTP request cannot call this operation or nominate a path.
    fcntl.flock(lock_fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    marker=settings.base_dir/'.maintenance.json'
    if not marker.exists():return {'ok':True,'recovered':False,'queue_executed':False}
    if marker.is_symlink():raise ValueError('Symlink maintenance marker; recovery refused')
    value=json.loads(marker.read_text())
    started=value.get('started',marker.stat().st_mtime) if isinstance(value,dict) else None
    if type(started) not in (int,float) or not math.isfinite(started) or clock()-started<120:
        raise ValueError('Maintenance marker is recent or invalid; inspect before retrying')
    # Compiles/imports the installed code and selftests a disposable DB; no
    # mutation or migrations to the production DB, no source/destination HTTP.
    updates.validate_code(settings.base_dir,settings)
    operation=db.checkpoint_read('maintenance:request')
    if operation.get('status') in ('pending','running'):
        db.checkpoint_write('maintenance:request',{**operation,'status':'failed','error':'Owner CLI reinstall recovered interrupted maintenance; no automatic retry'})
    cfg=updates.update_config(db);cfg['enabled']=False
    db.checkpoint_write('updates:config',cfg)
    marker.unlink()
    return {'ok':True,'recovered':True,'queue_executed':False,'database_restored':False,'auto_update_disabled':True}
