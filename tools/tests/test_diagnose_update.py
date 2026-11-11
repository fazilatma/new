import errno
import fcntl
import json
from pathlib import Path
import runpy
from types import SimpleNamespace
import pytest
from scraper4 import create_app
from scraper4.config import Settings
from scraper4.services import updates as real_updates

helper=runpy.run_path(str(Path(__file__).resolve().parents[1]/'diagnose_update.py'))


@pytest.fixture
def fixture(tmp_path):
    s=Settings(base_dir=tmp_path,db_path=tmp_path/'data/test.db',secret_key='local-test-only',password='test')
    app=create_app(s);db=app.extensions['s4_db']
    (tmp_path/'requirements.txt').write_text('same')
    p=db.upsert_profile('one','https://example.com');job=db.enqueue('woo_send',p['id'])
    def download(commit,destination,**kw):
        (destination/'source.tar.gz').write_bytes(b'fixture')
        stage=destination/'stage';stage.mkdir();(stage/'requirements.txt').write_text('same');return stage
    u=SimpleNamespace(REF=real_updates.REF,latest_commit=lambda:'a'*40,download=download,
                      run_checked=lambda *a,**k:None,validate_code=lambda *a:None,
                      install_code=real_updates.install_code,code_files=real_updates.code_files)
    return s,db,u,job,app


def test_preflight_only_scratch_and_one_sanitized_checkpoint(fixture):
    s,db,u,job,app=fixture
    db.checkpoint_write('updates:state',{'latest':'b'*40,'available':True,'error':'previous failure'})
    before={p.relative_to(s.base_dir):p.read_bytes() for p in s.base_dir.rglob('*') if p.is_file() and 'data' not in p.relative_to(s.base_dir).parts}
    r=helper['preflight'](db,s,u)
    assert r['ok'] and r['failed_stage'] is None and not r['queues_executed'] and not r['installed_code_changed']
    assert not (s.base_dir/'.maintenance.json').exists() and not list((s.db_path.parent/'releases').iterdir())
    for p,value in before.items():assert (s.base_dir/p).read_bytes()==value
    helper['publish'](db,r)
    d=db.checkpoint_read('updates:state');assert d['latest']=='b'*40 and d['error']=='previous failure' and d['diagnostic']==r
    assert db.get_entry(job)['status']=='waiting'
    c=app.test_client()
    with c.session_transaction() as session:session['authenticated']=True
    assert c.get('/api/updates/status').json['state']['diagnostic']['ok']


@pytest.mark.parametrize('method,stage',[('latest_commit','github_lookup'),('download','download_and_unpack'),('run_checked','compile_staged_code'),('validate_code','validate_staged_code'),('install_code','snapshot_code_copy')])
def test_failures_record_stage_without_leaking_raw_exception(fixture,method,stage):
    s,db,u,job,app=fixture
    def fail(*a,**k):raise PermissionError(errno.EACCES,'PRIVATE-TOKEN','/home/private/.env')
    setattr(u,method,fail)
    r=helper['preflight'](db,s,u)
    assert not r['ok'] and r['failed_stage']==stage and r['failure']['category']=='permission'
    assert 'PRIVATE' not in json.dumps(r) and '/home/private' not in json.dumps(r)
    assert db.get_entry(job)['status']=='waiting'


@pytest.mark.parametrize('exception,category',[(OSError(errno.ENOSPC,'PRIVATE'),'disk_full'),(OSError(getattr(errno,'EDQUOT',122),'PRIVATE'),'disk_quota'),(ValueError('PRIVATE'),'validation_or_network'),(RuntimeError('PRIVATE'),'runtime')])
def test_category_whitelist(exception,category):
    r=helper['safe_failure'](exception);assert r['category']==category and 'PRIVATE' not in json.dumps(r)


def test_active_marker_and_pending_operation_never_changed(fixture):
    s,db,u,job,app=fixture
    marker=s.base_dir/'.maintenance.json';marker.write_text('keep')
    r=helper['preflight'](db,s,u);assert r['failed_stage']=='maintenance_idle' and marker.read_text()=='keep'
    marker.unlink();db.checkpoint_write('maintenance:request',{'status':'pending','action':'update'})
    r=helper['preflight'](db,s,u);assert r['failed_stage']=='maintenance_idle' and db.checkpoint_read('maintenance:request')['status']=='pending'


def test_busy_lock_no_retries(fixture):
    s,db,u,job,app=fixture
    with s.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        r=helper['preflight'](db,s,u)
    assert r['failed_stage']=='worker_lock' and not r['steps']


def test_changed_dependencies_does_not_install_pip_or_import(fixture):
    s,db,u,job,app=fixture
    def download(commit,dest,**kw):
        (dest/'source.tar.gz').write_bytes(b'x');stage=dest/'stage';stage.mkdir();(stage/'requirements.txt').write_text('different');return stage
    u.download=download;u.run_checked=lambda *a,**k:pytest.fail('No pip/compile/import on changed dependencies')
    r=helper['preflight'](db,s,u);assert r['dependencies_changed'] and r['failed_stage']=='dependency_change_requires_installer' and not r['ok']


def test_selected_branch_from_newer_install_is_honored(fixture):
    s,db,u,job,app=fixture;seen=[]
    u.selected_branch=lambda db:'release/test';u.latest_commit=lambda b:seen.append(b) or 'c'*40
    assert helper['preflight'](db,s,u)['target_commit']=='c'*40 and seen==['release/test']
