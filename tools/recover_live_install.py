#!/usr/bin/env python3
"""Run ONLY in the owner's PythonAnywhere Bash console, not through HTTP.

Default: inspect. --recover-code restores code under the existing worker lock;
--probe-all additionally runs the installed real source probe for every profile.
Never invokes maintain/tick/worker or sends. No public authentication exception.
"""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time


class RecoveryError(Exception):
    pass


def recover(settings, db, updates, *, apply=False, clock=time.time):
    marker=settings.base_dir/'.maintenance.json'
    if not marker.exists():return {'ok':True,'state':'not_in_maintenance','code_restored':False,'queues_executed':False}
    if marker.is_symlink():raise RecoveryError('Maintenance marker is a symlink; no changes made.')
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RecoveryError('Worker or installer is active; retry when idle. Nothing was stopped.') from None
        if not marker.exists():return {'ok':True,'state':'not_in_maintenance','code_restored':False,'queues_executed':False}
        try:value=json.loads(marker.read_text())
        except (ValueError,OSError):raise RecoveryError('Invalid maintenance marker; inspect it locally. Nothing removed.') from None
        if not isinstance(value,dict):raise RecoveryError('Invalid maintenance marker; nothing removed.')
        started=value.get('started',marker.stat().st_mtime)
        if type(started) not in (float,int) or not math.isfinite(started) or clock()-started<120:
            raise RecoveryError('Maintenance is recent or timestamp invalid; wait at least two minutes, then retry.')
        backup=Path(db.checkpoint_read('updates:backup').get('path',''))
        root=(settings.db_path.parent/'releases').resolve()
        if backup.is_symlink() or not backup.is_dir() or backup.resolve().parent!=root or not (backup/'code').is_dir():
            raise RecoveryError('No valid local code snapshot. A manual CLI installation is required; marker kept.')
        # Do not let recovery rotate the deployment authority or overwrite DB code.
        for name in ('scraper4/deploy_authority.json','scraper4/db.py','requirements.txt'):
            old=settings.base_dir/name;restored=backup/'code'/name
            if not old.is_file() or not restored.is_file() or old.read_bytes()!=restored.read_bytes():
                raise RecoveryError('Snapshot changes authority, DB code or dependencies; manual installer required. Marker kept.')
        if not apply:return {'ok':True,'state':'recoverable_code_snapshot','code_restored':False,'queues_executed':False,'database_restored':False}
        # rollback validates imports/selftest in a TEMP DB and restores code only.
        # Calling maintain CLI would run tick afterwards; intentionally never do it.
        try:result=updates.rollback(db,settings)
        except Exception:raise RecoveryError('Code recovery or Reload failed. Check local platform/log status; no queues were executed. Retry only after inspection.') from None
        if marker.exists():raise RecoveryError('Maintenance marker still exists; recovery not confirmed.')
        request=db.checkpoint_read('maintenance:request')
        if request.get('status') in ('pending','running'):
            db.checkpoint_write('maintenance:request',{**request,'status':'failed','error':'Interrupted maintenance recovered by owner CLI; no automatic retry'})
        commit=result.get('commit')
        return {'ok':True,'state':'code_recovered_reload_requested','code_restored':True,
                'commit':commit if isinstance(commit,str) and len(commit)==40 and all(c in '0123456789abcdef' for c in commit) else None,
                'database_restored':False,'queues_executed':False,'auto_update_disabled':result.get('auto_update_disabled') is True,
                'live_http_verified':False}


def safe_probe(value):
    fields=('profile_id','name','engine','used_engine','tested_at','status','page','count','priced','linked','imaged','elapsed_ms','http_status','network_error','failure_stage','products_changed','queue_changed')
    return {k:value[k] for k in fields if type(value.get(k)) in (str,int,float,bool) and (not isinstance(value[k],float) or math.isfinite(value[k]))}


def audit_on_host(app, db, *, probe=False, emit=lambda _:None):
    """Real installed WSGI + real DB/source, NOT external HTTP and NOT fixtures.

    The owner already has filesystem/admin authority. A fresh ephemeral local
    test client grants no shared browser cookie/token or public endpoint access.
    """
    client=app.test_client()
    with client.session_transaction() as session:
        session['authenticated']=True;session['csrf']='owner-cli-local-process-only'
    health=client.get('/healthz')
    if health.status_code!=200:raise RecoveryError('Installed application is not healthy locally; no source probes performed.')
    identity=health.get_json(silent=True) or {}
    with db.connect() as conn:ids=[r[0] for r in conn.execute('SELECT id FROM profiles ORDER BY id')]
    report={'ok':True,'format':'scraper4-owner-cli-diagnostic-v1','transport':'installed_local_wsgi_on_host_not_external_http',
            'installed_identity':{k:identity[k] for k in ('version','commit') if isinstance(identity.get(k),str)},
            'profiles':[],'complete':False,'profile_count_at_start':len(ids),'source_probes_attempted':0,
            'destination_reachability_tested':False,'queue_execution_requested':False,'database_restored':False,
            'note':'Real installed DB/source, no fixtures. Local WSGI authorization is CLI-only; no cookies/tokens are shared. Probes may store reports but do not change products/queues. External scheduled workers can operate concurrently. Local source attempts are not remote HTTP or destination tests.'}
    try:
        for pid in ids:
            row={'id':pid}
            r=client.get('/api/php-ui/diagnostic-export',query_string={'profile_id':pid})
            d=r.get_json(silent=True)
            if r.status_code==404:row['state']='deleted_during_audit'
            elif r.status_code==200 and isinstance(d,dict) and d.get('format')=='scraper4-safe-diagnostic-v1':
                # The installed route is an explicitly sanitized export. Refuse
                # arbitrary older/raw responses, even if they return HTTP200.
                row['diagnostic']=d
            else:row['state']='sanitized_export_unavailable'
            if probe and row.get('state')!='deleted_during_audit':
                p=db.get_profile(pid)
                from scraper4.services.start_page import options
                if not p or options(p)['source']=='github':row['probe']={'status':'skipped','reason':'not_a_direct_source'}
                else:
                    report['source_probes_attempted']+=1
                    r=client.post('/api/extraction/probe',json={'profile_id':pid},headers={'X-CSRF-Token':'owner-cli-local-process-only'})
                    value=r.get_json(silent=True)
                    if r.status_code!=200 or not isinstance(value,dict) or not isinstance(value.get('report'),dict):
                        row['probe']={'status':'request_failed','http_status':r.status_code};report['profiles'].append(row);raise RecoveryError('Source probe endpoint failed; stopped before the next profile.')
                    row['probe']=safe_probe(value['report'])
            report['profiles'].append(row);emit(report)
        report['complete']=True
    except KeyboardInterrupt:
        report['stopped']=True
    except Exception:
        report['error']='audit_interrupted';emit(report)
        raise RecoveryError('Audit interrupted; private partial report saved. Inspect locally before sharing.') from None
    finally:emit(report)
    return report


def write_private(path, data):
    if path.is_symlink() or path.exists():raise RecoveryError('Report path already exists; choose a NEW private file path.')
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(fd,'w') as out:json.dump(data,out,ensure_ascii=False,indent=2);out.write('\n')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dir',type=Path,default=Path.home()/'scraper4-python/pythonanywhere')
    parser.add_argument('--recover-code',action='store_true')
    parser.add_argument('--probe-all',action='store_true')
    parser.add_argument('--report',type=Path,default=Path.home()/('scraper4-live-'+time.strftime('%Y%m%dT%H%M%S')+'.json'))
    parser.add_argument('--diagnose-only',action='store_true',help=argparse.SUPPRESS)
    args=parser.parse_args()
    if args.probe_all and not (args.recover_code or args.diagnose_only):parser.error('--probe-all requires --recover-code (or owner local --diagnose-only)')
    base=args.app_dir.expanduser().resolve()
    if not (base/'scraper4/config.py').is_file() or not (base/'.env').is_file():raise RecoveryError('Installed application/.env not found; set --app-dir to the existing source directory.')
    # Set paths before importing the installed package; never initialize new keys.
    os.chdir(base);os.environ['S4_BASE_DIR']=str(base);os.environ['S4_ENV_FILE']=str(base/'.env');sys.path.insert(0,str(base))
    from scraper4.config import Settings
    from scraper4.db import DB
    from scraper4.services import updates
    settings=Settings.load()
    if not settings.db_path.is_file() or not settings.secret_key:raise RecoveryError('Existing database/key not found. No fresh installation or key rotation allowed.')
    db=DB(settings.db_path,settings.secret_key)
    if not args.diagnose_only:
        result=recover(settings,db,updates,apply=args.recover_code);print(json.dumps(result))
        if not args.recover_code:return 0
        # Recovery may replace modules; diagnose ONLY in a fresh interpreter.
        return subprocess.run([sys.executable,str(Path(__file__).resolve()),'--diagnose-only','--app-dir',str(base),'--report',str(args.report.expanduser().absolute()),*(['--probe-all'] if args.probe_all else [])],check=False).returncode
    if (base/'.maintenance.json').exists():raise RecoveryError('Maintenance still active; no probes performed.')
    from scraper4 import create_app
    report_path=args.report.expanduser().absolute()
    write_private(report_path,{'complete':False,'state':'starting'})
    # Only overwrite the file exclusively created by this invocation, never an
    # existing user file. Mode600 is preserved and no raw exception is printed.
    def emit(value):
        with report_path.open('w') as out:json.dump(value,out,ensure_ascii=False,indent=2);out.write('\n')
    result=audit_on_host(create_app(settings),db,probe=args.probe_all,emit=emit)
    print(json.dumps({'ok':True,'complete':result['complete'],'source_probes_attempted':result['source_probes_attempted'],'private_report':str(report_path),'live_http_verified':False}))
    return 0 if result['complete'] else 2


if __name__=='__main__':
    try:raise SystemExit(main())
    except RecoveryError as exc:print(json.dumps({'ok':False,'error':str(exc),'queues_executed':False}),file=sys.stderr);raise SystemExit(2)
    except Exception:print(json.dumps({'ok':False,'error':'Local recovery failed. Inspect the host logs privately; no credentials are needed in chat.'}),file=sys.stderr);raise SystemExit(2)
