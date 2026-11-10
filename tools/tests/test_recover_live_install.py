"""Owner CLI never runs queues; temporary files/DB and fixture source only."""
import fcntl
import json
import os
from pathlib import Path
import runpy
from types import SimpleNamespace
import pytest

helper=runpy.run_path(str(Path(__file__).resolve().parents[1]/'recover_live_install.py'))
recover=helper['recover'];RecoveryError=helper['RecoveryError']


@pytest.fixture
def fixture(tmp_path):
    from scraper4 import create_app
    from scraper4.config import Settings
    settings=Settings(base_dir=tmp_path,db_path=tmp_path/'data/ui.db',secret_key='local-only-test-secret',password='test')
    app=create_app(settings);return settings,app,app.extensions['s4_db']


def stage(settings,db):
    marker=settings.base_dir/'.maintenance.json';marker.write_text(json.dumps({'started':10,'operation':'signed-code-deploy'}))
    backup=settings.db_path.parent/'releases/snapshot';(backup/'code').mkdir(parents=True)
    for name in ('scraper4/deploy_authority.json','scraper4/db.py','requirements.txt'):
        for root in (settings.base_dir,backup/'code'):
            p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('same')
    db.checkpoint_write('updates:backup',{'path':str(backup)});return marker,backup


def test_inspection_does_not_restore_or_run_any_work(fixture):
    settings,app,db=fixture;marker,backup=stage(settings,db)
    result=recover(settings,db,SimpleNamespace(),clock=lambda:1000)
    assert result['state']=='recoverable_code_snapshot' and marker.exists() and not result['queues_executed']


def test_busy_lock_and_recent_marker_are_not_cleared(fixture):
    settings,app,db=fixture;marker,_=stage(settings,db)
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with pytest.raises(RecoveryError,match='active'):recover(settings,db,SimpleNamespace(),apply=True,clock=lambda:1000)
    with pytest.raises(RecoveryError,match='recent'):recover(settings,db,SimpleNamespace(),apply=True,clock=lambda:100)
    assert marker.exists()


def test_recovery_restores_only_code_and_marks_ambiguous_pending_request_failed(fixture):
    settings,app,db=fixture;marker,_=stage(settings,db);db.checkpoint_write('maintenance:request',{'status':'running','action':'update'})
    p=db.upsert_profile('p','https://example.com');job=db.enqueue('woo_send',p['id'],{'SECRET':'SECRET'})
    calls=[]
    def rollback(d,s):calls.append('restore');marker.unlink();return {'commit':'a'*40,'auto_update_disabled':True}
    result=recover(settings,db,SimpleNamespace(rollback=rollback),apply=True,clock=lambda:1000)
    assert calls==['restore'] and result['state']=='code_recovered_reload_requested'
    assert not result['database_restored'] and not result['queues_executed'] and not result['live_http_verified']
    assert db.get_entry(job)['status']=='waiting' and db.checkpoint_read('maintenance:request')['status']=='failed'


def test_failed_reload_and_missing_snapshot_do_not_remove_marker(fixture):
    settings,app,db=fixture;marker,_=stage(settings,db)
    def fail(*a):raise RuntimeError('PRIVATE-TOKEN')
    with pytest.raises(RecoveryError) as e:recover(settings,db,SimpleNamespace(rollback=fail),apply=True,clock=lambda:1000)
    assert marker.exists() and 'PRIVATE-TOKEN' not in str(e.value)
    db.checkpoint_write('updates:backup',{})
    with pytest.raises(RecoveryError,match='snapshot'):recover(settings,db,SimpleNamespace(),apply=True,clock=lambda:1000)
    assert marker.exists()


@pytest.mark.parametrize('name',['scraper4/deploy_authority.json','scraper4/db.py','requirements.txt'])
def test_snapshot_cannot_silently_change_authority_db_or_dependencies(fixture,name):
    settings,app,db=fixture;marker,backup=stage(settings,db);(backup/'code'/name).write_text('changed')
    with pytest.raises(RecoveryError,match='authority'):recover(settings,db,SimpleNamespace(),apply=True,clock=lambda:1000)
    assert marker.exists()


def test_no_marker_is_noop_even_when_apply_requested(fixture):
    settings,app,db=fixture;assert recover(settings,db,SimpleNamespace(),apply=True)['state']=='not_in_maintenance'


def test_live_host_audit_is_real_installed_wsgi_and_no_source_access_without_opt_in(fixture,monkeypatch):
    settings,app,db=fixture;p=db.upsert_profile('p','https://example.com','One');db.enqueue('woo_send',p['id'])
    monkeypatch.setattr('scraper4.services.scraping.fetch.HtmlFetcher.get',lambda *a,**k:pytest.fail('no opt-in'))
    with db.connect() as c:before=list(c.iterdump())
    result=helper['audit_on_host'](app,db)
    assert result['complete'] and result['source_probes_attempted']==0
    assert result['transport']=='installed_local_wsgi_on_host_not_external_http'
    with db.connect() as c:assert list(c.iterdump())==before


def test_real_source_probe_endpoint_preserves_queues_products_and_drops_continuation(fixture,monkeypatch):
    settings,app,db=fixture;p=db.upsert_profile('p','https://example.com','One',selectors={'container':'.product','title':'h2'})
    db.enqueue('woo_send',p['id'],{'token':'PRIVATE'});before=db.list_entries()
    calls=[]
    def fetch(url,**kw):calls.append(url);return {'ok':True,'code':200,'url':url,'html':'<article class="product"><h2>Fixture</h2></article>'}
    monkeypatch.setattr('scraper4.services.scraping.fetch.HtmlFetcher.get',fetch)
    result=helper['audit_on_host'](app,db,probe=True)
    assert calls==['https://example.com'] and result['source_probes_attempted']==1
    assert result['profiles'][0]['probe']['status']=='passed' and 'next' not in result['profiles'][0]['probe']
    assert db.list_entries()==before and db.count_products(p['id'])==0
    assert 'PRIVATE' not in json.dumps(result)


def test_maintenance_prevents_diagnostics_and_source_probes(fixture):
    settings,app,db=fixture;(settings.base_dir/'.maintenance.json').write_text('{}')
    with pytest.raises(RecoveryError,match='healthy'):helper['audit_on_host'](app,db,probe=True)


def test_private_report_file_is_exclusive_and_600(tmp_path):
    path=tmp_path/'report.json';helper['write_private'](path,{'complete':False})
    assert path.stat().st_mode&0o777==0o600
    with pytest.raises(RecoveryError):helper['write_private'](path,{'overwrite':True})
    assert json.loads(path.read_text())=={'complete':False}
