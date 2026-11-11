#!/usr/bin/env python3
"""Owner-local updater preflight for OLD installations; never installs/reloads.

Downloads from the installed fixed-repo updater, validates in a temporary stage,
checks scratch snapshots and permissions under the shared worker lock. The only
persistent DB write is a whitelisted diagnostic in updates:state, readable from
the already-installed status API. No raw exception/traceback/console is exported.
"""
import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
import time

FORMAT='scraper4-update-preflight-v1'


def safe_failure(exc):
    # No str(exc), filenames, source lines, exception args, env or URLs.
    classes={'PermissionError':'permission','FileNotFoundError':'missing_file','NotADirectoryError':'path_type',
             'IsADirectoryError':'path_type','ReadError':'archive_read','CompressionError':'archive_compression',
             'BadGzipFile':'archive_read','EOFError':'archive_truncated','OperationalError':'sqlite',
             'DatabaseError':'sqlite','IntegrityError':'sqlite','TimeoutExpired':'subprocess_timeout',
             'ValueError':'validation_or_network','DeployError':'code_only_compatibility','PlatformError':'platform',
             'TypeError':'type','AttributeError':'attribute','KeyError':'missing_key','RuntimeError':'runtime',
             'SyntaxError':'syntax','ImportError':'import','ModuleNotFoundError':'import'}
    category=classes.get(type(exc).__name__,'unexpected')
    if isinstance(exc,OSError):
        category={errno.ENOSPC:'disk_full',getattr(errno,'EDQUOT',122):'disk_quota',errno.EACCES:'permission',errno.EPERM:'permission',errno.EROFS:'read_only_filesystem'}.get(exc.errno,category if category!='unexpected' else 'filesystem')
    frames=[];tb=exc.__traceback__
    while tb:
        # Only preselected source file identities; never source text/locals.
        file=Path(tb.tb_frame.f_code.co_filename).name
        if file in ('updates.py','webdeploy.py','tarfile.py','gzip.py','shutil.py','pathlib.py','diagnose_update.py'):
            frames.append({'module':file,'line':tb.tb_lineno})
        tb=tb.tb_next
    return {'category':category,'errno':exc.errno if isinstance(exc,OSError) and type(exc.errno) is int else None,'frames':frames[-5:]}


def preflight(db,settings,updates):
    report={'ok':False,'format':FORMAT,'steps':[],'failed_stage':None,
            'installed_code_changed':False,'reload_requested':False,'queues_executed':False,'source_probes_executed':False,
            'raw_errors_included':False,'stage_validation_scope':'temporary_release_and_temporary_database',
            'note':'Updater preflight only; no install/reload/source extraction. One sanitized diagnostic checkpoint is saved; scratch code/DB copies are removed. No raw exception, credentials or server logs.'}
    def step(name,fn):
        report['failed_stage']=name
        value=fn();report['steps'].append({'stage':name,'ok':True});return value
    try:
        with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
            def acquire():fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            step('worker_lock',acquire)
            def idle():
                if (settings.base_dir/'.maintenance.json').exists():raise ValueError('maintenance active')
                if db.checkpoint_read('maintenance:request').get('status') in ('pending','running'):raise ValueError('maintenance queued')
            step('maintenance_idle',idle)
            commit=step('github_lookup',lambda:updates.latest_commit() if not hasattr(updates,'selected_branch') or updates.selected_branch(db)==updates.REF else updates.latest_commit(updates.selected_branch(db)))
            if not isinstance(commit,str) or not re.fullmatch(r'[0-9a-f]{40}',commit):raise ValueError('invalid sha')
            report['target_commit']=commit
            report['failed_stage']='temporary_workspace'
            with tempfile.TemporaryDirectory(prefix='s4-update-preflight-') as folder:
                report['steps'].append({'stage':'temporary_workspace','ok':True})
                stage=step('download_and_unpack',lambda:updates.download(commit,Path(folder),timeout=(5,20),max_bytes=8*1024*1024,budget_seconds=45))
                report['archive_bytes']=int((Path(folder)/'source.tar.gz').stat().st_size)
                report['dependencies_changed']=step('compare_dependencies',lambda:(settings.base_dir/'requirements.txt').read_bytes()!=(stage/'requirements.txt').read_bytes())
                # Do not run pip. Changed dependencies require an installer, not
                # probing code imports with the old environment.
                if report['dependencies_changed']:
                    report['failed_stage']='dependency_change_requires_installer'
                    return report
                step('compile_staged_code',lambda:updates.run_checked([sys.executable,'-m','compileall','-q','scraper4'],stage))
                # Same pre-swap validation as CLI, operating on a TEMP DB.
                step('validate_staged_code',lambda:updates.validate_code(stage,settings))
                backup_root=settings.db_path.parent/'releases'
                step('snapshot_directory',lambda:backup_root.mkdir(parents=True,exist_ok=True))
                report['failed_stage']='snapshot_workspace'
                with tempfile.TemporaryDirectory(prefix='.s4-preflight-',dir=backup_root) as snapshot:
                    report['steps'].append({'stage':'snapshot_workspace','ok':True})
                    target=Path(snapshot)
                    step('snapshot_code_copy',lambda:updates.install_code(settings.base_dir,target/'code'))
                    def copy_database():
                        deadline=time.monotonic()+10
                        with sqlite3.connect(str(target/'probe.sqlite3')) as dest,db.connect() as source:
                            size=source.execute('PRAGMA page_size').fetchone()[0]
                            def progress(status,left,total):
                                if time.monotonic()>deadline or size*total>64*1024*1024:raise ValueError('snapshot limit')
                            source.backup(dest,pages=64,progress=progress,sleep=0.05)
                    step('snapshot_database',copy_database)
                    # Test managed-file access without overwriting any file.
                    def permissions():
                        paths=updates.code_files(settings.base_dir)
                        if any(not os.access(p,os.W_OK) or not os.access(p.parent,os.W_OK) for p in paths):raise PermissionError(errno.EACCES,'managed code not writable')
                        with tempfile.TemporaryFile(dir=settings.base_dir) as out:out.write(b'preflight')
                    step('installed_code_write_access',permissions)
            report.update(ok=True,failed_stage=None)
    except Exception as exc:
        report['failure']=safe_failure(exc)
    return report


def publish(db,report):
    # Merge into the legacy read-only status response without overwriting other
    # update fields, concurrent changes, operation status or scheduling config.
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row=conn.execute("SELECT state FROM task_checkpoints WHERE task='updates:state'").fetchone()
        state=json.loads(row[0]) if row else {}
        state['diagnostic']=report
        stamp=time.strftime('%Y-%m-%d %H:%M:%S',time.gmtime())
        conn.execute('''INSERT INTO task_checkpoints(task,state,created_at,updated_at) VALUES(?,?,?,?)
          ON CONFLICT(task) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at''',('updates:state',json.dumps(state),stamp,stamp))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app-dir',type=Path,default=Path.home()/'scraper4-python/pythonanywhere')
    args=parser.parse_args();base=args.app_dir.expanduser().resolve()
    if not (base/'.env').is_file() or not (base/'scraper4/services/updates.py').is_file():raise ValueError('installed app missing')
    os.chdir(base);os.environ['S4_BASE_DIR']=str(base);os.environ['S4_ENV_FILE']=str(base/'.env');sys.path.insert(0,str(base))
    from scraper4.config import Settings
    from scraper4.db import DB
    from scraper4.services import updates
    settings=Settings.load()
    if not settings.db_path.is_file() or not settings.secret_key:raise ValueError('existing db/key required')
    db=DB(settings.db_path,settings.secret_key)
    report=preflight(db,settings,updates)
    publish(db,report)
    # No raw exception even on an old version. User need only say "done";
    # agent reads the saved diagnostic via /api/updates/status independently.
    print(json.dumps({'ok':report['ok'],'failed_stage':report['failed_stage'],'safe_report_saved':True,'status_url':'/api/updates/status','queues_executed':False}))
    return 0 if report['ok'] else 2


if __name__=='__main__':
    try:raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({'ok':False,'safe_report_saved':False,'failure':safe_failure(exc),'queues_executed':False}))
        raise SystemExit(2)
