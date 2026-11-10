"""Explicit owner CLI open mode: no login/token/CSRF, no persistent admin grant."""
from dataclasses import replace
import json
import time
import pytest
from scraper4 import create_app
from scraper4.services import owner_install


def open_app(settings):return create_app(replace(settings,access_mode='open',password=''))


def test_no_password_and_no_cookie_required_for_both_uis_or_working_apis(settings):
    app=open_app(settings);c=app.test_client();db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com','One')
    for path in ('/','/php-ui','/api/php-ui/capabilities','/api/profiles','/api/extraction/diagnostics'):
        r=c.get(path);assert r.status_code==200
    assert 'دسترسی باز' in c.get('/').text and 'action="/logout"' not in c.get('/').text
    assert c.get('/login').status_code==302
    assert c.post('/api/php-ui/read',json={'action':'python_sync_audit','query':{},'fields':{}}).status_code==200
    d=c.post('/api/php-ui/write',json={'action':'python_enqueue','query':{},'fields':{'profile':'one','pages':'1'}})
    assert d.status_code==200 and db.get_entry(d.json['id'])['status']=='waiting'
    assert c.get('/api/php-ui/diagnostic-export?profile_id='+str(p['id'])).status_code==200
    assert c.get('/api/profiles',headers={'Authorization':'Bearer not-needed'}).status_code==200
    assert c.post('/api/auth/token',json={}).status_code==409
    assert c.post('/api/cron/token',json={}).status_code==409
    assert not db.get_config('api_auth') and not db.get_config('cron_auth')
    with c.session_transaction() as s:assert not s.get('authenticated') and not s.get('csrf')


def test_open_session_does_not_grant_admin_after_returning_to_password_mode(settings):
    app=open_app(settings);c=app.test_client();c.get('/');c.get('/php-ui')
    with c.session_transaction() as s:copied=dict(s)
    locked=create_app(settings);lc=locked.test_client()
    with lc.session_transaction() as s:s.update(copied)
    assert lc.get('/api/profiles').status_code==401
    assert lc.post('/api/php-ui/read',json={'action':'python_sync_audit','query':{},'fields':{}}).status_code==400


def test_open_mode_does_not_skip_maintenance_signature_or_queue_validation(settings,monkeypatch):
    app=open_app(settings);c=app.test_client()
    assert c.get('/api/deploy/run').status_code==401
    monkeypatch.setattr('scraper4.services.engine.http_tick',lambda *a:pytest.fail('no automatic tick'))
    assert c.get('/api/cron/run').status_code==403
    assert c.head('/api/cron/run').status_code==403
    assert c.post('/api/php-ui/write',json={'action':'not_a_real_operation','query':{},'fields':{}}).status_code==501
    (settings.base_dir/'.maintenance.json').write_text('{}')
    assert c.get('/api/extraction/diagnostics').status_code==503
    assert c.get('/api/deploy/run').status_code==503


def test_open_head_cron_never_executes_even_when_public_get_enabled(settings,monkeypatch):
    app=open_app(settings);app.extensions['s4_db'].checkpoint_write('cron:config',{'public_get':True})
    monkeypatch.setattr('scraper4.cron.http_tick',lambda *a:pytest.fail('HEAD must never run jobs'))
    assert app.test_client().head('/api/cron/run').status_code==200


def test_invalid_mode_fails_closed(settings):
    with pytest.raises(RuntimeError,match='S4_ACCESS_MODE'):create_app(replace(settings,access_mode='typo',password=''))
    with pytest.raises(RuntimeError,match='S4_PASSWORD'):create_app(replace(settings,password=''))


def test_selftest_accepts_explicit_open_without_password(settings):
    from scraper4.services.engine import selftest
    app=open_app(settings);assert selftest(app.extensions['s4_db'],app.extensions['s4_settings'])['ok']


def test_cli_finish_requires_validated_tree_and_preserves_products_and_jobs(app,settings,monkeypatch):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.org');job=db.enqueue('woo_send',p['id'])
    marker=settings.base_dir/'.maintenance.json';marker.write_text(json.dumps({'started':time.time()-1000}))
    db.checkpoint_write('maintenance:request',{'status':'pending','action':'update'})
    validated=[];monkeypatch.setattr(owner_install.updates,'validate_code',lambda *a:validated.append('validated'))
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        r=owner_install.finish_recovery(db,settings,lock_fd=lock.fileno())
    assert validated==['validated'] and r['recovered'] and not r['queue_executed'] and not marker.exists()
    assert db.get_entry(job)['status']=='waiting' and db.checkpoint_read('maintenance:request')['status']=='failed'


def test_cli_failed_validation_keeps_marker_and_never_advances_work(app,settings,monkeypatch):
    marker=settings.base_dir/'.maintenance.json';marker.write_text(json.dumps({'started':1}))
    def fail(*a):raise ValueError('validation failed')
    monkeypatch.setattr(owner_install.updates,'validate_code',fail)
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock,pytest.raises(ValueError):
        owner_install.finish_recovery(app.extensions['s4_db'],settings,lock_fd=lock.fileno())
    assert marker.exists()


def test_cli_installer_persists_explicit_open_without_replacing_key_or_password(tmp_path):
    import os
    import subprocess
    from pathlib import Path
    root=Path(__file__).resolve().parents[1]
    script=(root/'install.sh').read_text();body=script.split('"$VENV/bin/python" - <<\'PY\'\n',1)[1].split('\nPY\n',1)[0]
    env_file=tmp_path/'.env';env_file.write_text('S4_SECRET_KEY=existing-secret\nS4_PASSWORD=\nS4_ACCESS_MODE=password\n')
    env=dict(os.environ,PYTHONPATH=str(root),S4_ACCESS_MODE='open')
    env.pop('S4_SECRET_KEY',None);env.pop('S4_PASSWORD',None)
    p=subprocess.run(['python3','-c',body],cwd=tmp_path,env=env,text=True,capture_output=True,check=True)
    assert 'Panel password' not in p.stdout
    contents=env_file.read_text();assert contents.count('S4_SECRET_KEY=')==1 and 'existing-secret' in contents
    assert 'S4_ACCESS_MODE=open' in contents and contents.count('S4_PASSWORD=')==1
    assert env_file.stat().st_mode&0o777==0o600


def test_bootstrap_recovery_is_explicit_and_runs_after_install_before_reload():
    from pathlib import Path
    script=(Path(__file__).resolve().parents[1]/'bootstrap.sh').read_text()
    assert 'S4_RECOVER_MAINTENANCE:-0' in script
    assert script.index('bash "$APP_DIR/install.sh"')<script.index('finish_recovery')<script.index('-m scraper4 reload-web')
    recovery=script.split("<<'PYRECOVER'",1)[1].split('PYRECOVER',1)[0]
    assert 'lock_fd=9' in recovery and 'tick' not in recovery and 'maintain(' not in recovery
