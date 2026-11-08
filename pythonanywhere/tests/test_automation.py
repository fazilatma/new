import hashlib
import json
import tarfile
from pathlib import Path
from unittest.mock import Mock

import pytest

from scraper4.services import updates
from scraper4.services.platform import PythonAnywhere, PlatformError


CONFIG = {'username':'testuser', 'domain':'testuser.pythonanywhere.com',
          'site':'www.pythonanywhere.com', 'token':'not-a-real-api-token'}


def test_bearer_auth_and_revoke(app,client,auth_headers):
    response = client.post('/api/auth/token',json={},headers=auth_headers)
    assert response.status_code == 201
    token = response.json['token']
    headers = {'Authorization':'Bearer ' + token}
    anonymous = app.test_client()
    assert anonymous.get('/api/system/status',headers=headers).status_code == 200
    assert anonymous.post('/api/updates/check',json={},headers=headers).status_code == 202
    assert anonymous.post('/api/auth/token',json={},headers=headers).status_code == 403
    assert anonymous.get('/api/system/status',headers={'Authorization':'Bearer wrong'}).status_code == 401
    assert token not in anonymous.get('/api/system/status',headers=headers).text
    assert client.delete('/api/auth/token',headers=auth_headers).status_code == 200
    assert anonymous.get('/api/ping',headers=headers).status_code == 401


def test_endpoints_and_public_health(app,client):
    assert app.test_client().get('/healthz').json == {'ok':True}
    endpoints = client.get('/api/endpoints').json['endpoints']
    assert any(e['path']=='/api/updates/apply' and e['methods']==['POST'] for e in endpoints)


def test_management_endpoints_csrf_queue(client,auth_headers,app):
    assert client.post('/api/updates/apply',json={}).status_code == 400
    assert client.post('/api/updates/config',json={'enabled':'false'},headers=auth_headers).status_code == 400
    assert client.post('/api/updates/config',json={'enabled':False},headers=auth_headers).json['config']['enabled'] is False
    response = client.post('/api/updates/check',json={},headers=auth_headers)
    assert response.status_code == 202
    assert client.post('/api/system/reload',json={},headers=auth_headers).status_code == 400
    assert app.extensions['s4_db'].checkpoint_read('maintenance:request')['status']=='pending'


def test_maintenance_marker(app,client,settings):
    (settings.base_dir/'.maintenance.json').write_text('{}')
    assert client.get('/').status_code==503
    assert app.test_client().get('/healthz').status_code==503
    assert client.get('/api/system/status').status_code==200


def test_update_check_and_interval(db,settings,monkeypatch):
    monkeypatch.setattr(updates,'latest_commit',lambda:'a'*40)
    db.checkpoint_write('updates:config',{'enabled':False,'interval_seconds':3600})
    assert updates.maintain(db,settings)['skipped']
    updates.request_operation(db,'check')
    assert updates.maintain(db,settings)['latest']=='a'*40
    assert db.checkpoint_read('maintenance:request')['status']=='done'
    assert updates.status(db,settings)['state']['available']


def test_platform_idempotent_and_contract(db,settings,monkeypatch):
    calls=[]
    api=PythonAnywhere(CONFIG)
    task_command=[]
    def call(method,path,**kwargs):
        calls.append((method,path,kwargs))
        if method=='GET' and path==api.web_path:
            return {'source_directory':str(settings.base_dir),'python_version':'python311'}
        if method=='GET' and path=='schedule/':
            return [] if not task_command else [{'id':7,'command':task_command[0]}]
        if path.startswith('schedule/') and method in ('POST','PATCH'):
            task_command[:] = [kwargs['json']['command']]
            return {'id':7,'enabled':True,'interval':'hourly'}
        return {}
    monkeypatch.setattr(api,'call',call)
    assert api.provision(db,settings)['task_id']==7
    assert api.provision(db,settings)['task_id']==7
    assert sum(m=='POST' and p=='schedule/' for m,p,_ in calls)==1
    assert any(m=='PATCH' and p=='schedule/7/' for m,p,_ in calls)
    upload=next(k for m,p,k in calls if p.startswith('files/path'))
    assert 'from scraper4 import create_app' in upload['files']['content'][1].decode()
    assert CONFIG['token'] not in task_command[0]


def test_platform_refuses_unrelated_webapp(db,settings,monkeypatch):
    api=PythonAnywhere(CONFIG)
    monkeypatch.setattr(api,'call',lambda *args,**kwargs:{'source_directory':'/other/site'})
    with pytest.raises(PlatformError,match='replace-existing'):
        api.provision(db,settings)


def test_platform_never_leaks_token(monkeypatch):
    response=Mock(status_code=403)
    response.text=CONFIG['token']
    monkeypatch.setattr('scraper4.services.platform.requests.request',lambda *a,**k:response)
    with pytest.raises(PlatformError) as exc:
        PythonAnywhere(CONFIG).reload()
    assert CONFIG['token'] not in str(exc.value)


def make_code(base, version):
    (base/'scraper4').mkdir(parents=True,exist_ok=True)
    (base/'scraper4'/'__init__.py').write_text('VERSION = ' + repr(version))
    (base/'requirements.txt').write_text('flask\n')
    (base/'wsgi.py').write_text('# test')


def test_update_backup_preserve_and_rollback(db,settings,monkeypatch,tmp_path):
    make_code(settings.base_dir,'old')
    (settings.base_dir/'.env').write_text('S4_SECRET_KEY=private')
    db.put_config('pythonanywhere',CONFIG)
    stage=tmp_path/'new-stage'
    make_code(stage,'new')
    (stage/'scraper4'/'new_module.py').write_text('new = True')
    monkeypatch.setattr(updates,'download',lambda *args:stage)
    monkeypatch.setattr(updates,'validate_code',lambda *args:None)
    monkeypatch.setattr(updates,'run_checked',lambda *args,**kwargs:None)
    reloads=[]
    monkeypatch.setattr(PythonAnywhere,'reload',lambda self:reloads.append(True))
    result=updates.apply_update(db,settings,'b'*40)
    assert result['changed']
    assert 'new' in (settings.base_dir/'scraper4'/'__init__.py').read_text()
    assert (settings.base_dir/'.env').read_text()=='S4_SECRET_KEY=private'
    assert db.get_config('pythonanywhere')['token']==CONFIG['token']
    backup=Path(db.checkpoint_read('updates:backup')['path'])
    assert (backup/'database.sqlite3').exists()
    assert not (backup/'code'/'.env').exists()
    updates.rollback(db,settings)
    assert 'old' in (settings.base_dir/'scraper4'/'__init__.py').read_text()
    assert not (settings.base_dir/'scraper4'/'new_module.py').exists()
    assert len(reloads)==2


def test_update_failure_restores_code(db,settings,monkeypatch,tmp_path):
    make_code(settings.base_dir,'old')
    db.put_config('pythonanywhere',CONFIG)
    stage=tmp_path/'new-stage'
    make_code(stage,'new')
    monkeypatch.setattr(updates,'download',lambda *args:stage)
    monkeypatch.setattr(updates,'run_checked',lambda *args,**kwargs:None)
    def validate(base,*args):
        if base==settings.base_dir:
            raise ValueError('validation failed')
    monkeypatch.setattr(updates,'validate_code',validate)
    monkeypatch.setattr(PythonAnywhere,'reload',lambda self:None)
    with pytest.raises(ValueError,match='validation'):
        updates.apply_update(db,settings,'b'*40)
    assert 'old' in (settings.base_dir/'scraper4'/'__init__.py').read_text()
    assert not (settings.base_dir/'.maintenance.json').exists()


def test_fixed_repository_and_sha_validation(tmp_path):
    with pytest.raises(ValueError,match='commit'):
        updates.download('../malicious',tmp_path)


def test_interrupted_operation_is_not_replayed(db,settings):
    db.checkpoint_write('maintenance:request',{'status':'running','action':'update'})
    result=updates.maintain(db,settings)
    assert not result['ok']
    assert db.checkpoint_read('maintenance:request')['status']=='failed'


def test_platform_daily_fallback_does_not_touch_other_tasks(db,settings,monkeypatch):
    api=PythonAnywhere(CONFIG)
    changes=[]
    def call(method,path,**kwargs):
        if method=='GET' and path==api.web_path:
            return None
        if method=='GET' and path=='schedule/':
            return [{'id':55,'command':f'cd {settings.base_dir}-other && python -m scraper4 tick'}]
        if path=='schedule/' and method=='POST':
            changes.append(kwargs['json'].copy())
            if kwargs['json']['interval']=='hourly':
                raise PlatformError('PythonAnywhere API HTTP 400')
            return {'id':56,'enabled':True,'interval':'daily'}
        assert path!='schedule/55/'
        return {}
    monkeypatch.setattr(api,'call',call)
    result=api.provision(db,settings)
    assert result['interval']=='daily'
    assert len(changes)==2
    assert changes[-1]['hour']==3


def test_real_release_selftest(settings):
    updates.validate_code(Path(__file__).resolve().parents[1],settings)


def test_reload_failure_keeps_maintenance_until_recovery(db,settings,monkeypatch,tmp_path):
    make_code(settings.base_dir,'old')
    db.put_config('pythonanywhere',CONFIG)
    stage=tmp_path/'new-stage'
    make_code(stage,'new')
    monkeypatch.setattr(updates,'download',lambda *args:stage)
    monkeypatch.setattr(updates,'run_checked',lambda *args,**kwargs:None)
    monkeypatch.setattr(updates,'validate_code',lambda *args:None)
    def fail(self):
        raise PlatformError('PythonAnywhere API HTTP 503')
    monkeypatch.setattr(PythonAnywhere,'reload',fail)
    with pytest.raises(PlatformError):
        updates.apply_update(db,settings,'c'*40)
    assert (settings.base_dir/'.maintenance.json').exists()
    assert 'old' in (settings.base_dir/'scraper4'/'__init__.py').read_text()
    monkeypatch.setattr(PythonAnywhere,'reload',lambda self:None)
    result=updates.maintain(db,settings)
    assert result['recovered']['ok']
    assert not (settings.base_dir/'.maintenance.json').exists()
    assert updates.update_config(db)['enabled'] is False
