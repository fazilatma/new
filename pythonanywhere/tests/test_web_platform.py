import json
from pathlib import Path

import pytest

from scraper4.services.platform import PythonAnywhere, installed_python, PlatformError
from scraper4.services import updates


CFG = {'site':'www.pythonanywhere.com','username':'testuser',
       'domain':'testuser.pythonanywhere.com','token':'test-platform-secret'}


def test_form_visible_and_get_never_reveals_token(app,client):
    db=app.extensions['s4_db']
    db.put_config('pythonanywhere',CFG)
    response=client.get('/api/platform/config')
    assert response.status_code==200 and response.json['configured']
    assert 'token' not in response.json['fields']
    assert CFG['token'] not in response.text
    html=client.get('/').text
    assert 'id="platform-form"' in html
    assert 'id="platform-test"' in html
    assert CFG['token'] not in html
    assert app.test_client().get('/api/platform/config').status_code==401


def test_save_is_encrypted_offline_and_csrf_protected(app,client,auth_headers,monkeypatch):
    def no_network(*args,**kwargs):
        raise AssertionError('Saving credentials must not use the network')
    monkeypatch.setattr(PythonAnywhere,'call',no_network)
    assert client.post('/api/platform/config',json=CFG).status_code==400
    response=client.post('/api/platform/config',json=CFG,headers=auth_headers)
    assert response.status_code==200
    assert CFG['token'] not in response.text
    db=app.extensions['s4_db']
    assert db.get_config('pythonanywhere')['token']==CFG['token']
    with db.connect() as conn:
        raw=conn.execute('SELECT config FROM connections WHERE name=?',('pythonanywhere',)).fetchone()[0]
    assert CFG['token'] not in raw


def test_empty_field_preserves_secret_and_new_identity_requires_token(app,client,auth_headers):
    db=app.extensions['s4_db'];db.put_config('pythonanywhere',CFG)
    assert client.post('/api/platform/config',json={'token':''},headers=auth_headers).status_code==200
    assert db.get_config('pythonanywhere')['token']==CFG['token']
    assert client.post('/api/platform/config',json={'username':'other','token':''},headers=auth_headers).status_code==400
    assert db.get_config('pythonanywhere')['username']=='testuser'


@pytest.mark.parametrize('changes', [{'site':'attacker.example'}, {'domain':'/etc/passwd'},
                                   {'token':'line\nbreak'}, {'token':['invalid']}])
def test_bad_configuration_never_overwrites(app,client,auth_headers,changes):
    db=app.extensions['s4_db'];db.put_config('pythonanywhere',CFG)
    assert client.post('/api/platform/config',json={**CFG,**changes},headers=auth_headers).status_code==400
    assert db.get_config('pythonanywhere')==CFG


def test_platform_mutations_require_browser_not_bearer(client,auth_headers):
    token=client.post('/api/auth/token',json={},headers=auth_headers).json['token']
    headers={'Authorization':'Bearer '+token}
    for route in ('/api/platform/config','/api/platform/test','/api/platform/activate'):
        assert client.post(route,json=CFG,headers=headers).status_code==403


def test_web_test_read_only(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];db.put_config('pythonanywhere',CFG)
    calls=[]
    def fake(self,method,path,**kwargs):
        calls.append((method,path,self.timeout))
        return []
    monkeypatch.setattr(PythonAnywhere,'call',fake)
    result=client.post('/api/platform/test',json={},headers=auth_headers)
    assert result.status_code==200 and result.json['ok']
    assert len(calls)==3
    assert all(m=='GET' and timeout==(3,7) for m,_,timeout in calls)
    assert CFG['token'] not in result.text


def make_runtime(settings):
    venv=settings.base_dir/'venv'
    (venv/'bin').mkdir(parents=True)
    python=venv/'bin'/'python'
    python.write_text('#!/bin/sh\nexit 0\n');python.chmod(0o700)
    (venv/'pyvenv.cfg').write_text('version=3.11')
    (settings.base_dir/'.runtime.json').write_text(json.dumps({'python':str(python),'python_version':'3.11'}))
    return python


def test_activate_bootstraps_scheduler_without_an_existing_worker(app,client,auth_headers,settings,monkeypatch):
    db=app.extensions['s4_db'];db.put_config('pythonanywhere',CFG)
    python=make_runtime(settings)
    calls=[]
    def fake(self,method,path,**kwargs):
        calls.append((method,path,kwargs))
        if method=='GET':
            return [] if path=='schedule/' else {}
        if method=='POST' and path=='schedule/':
            assert str(python) in kwargs['json']['command']
            assert CFG['token'] not in kwargs['json']['command']
            return {'id':17,'enabled':True,'interval':'hourly'}
        raise AssertionError('Web setup must not write WSGI, reload or execute a worker')
    monkeypatch.setattr(PythonAnywhere,'call',fake)
    result=client.post('/api/platform/activate',json={},headers=auth_headers)
    assert result.status_code==200
    assert result.json['task_id']==17
    assert db.checkpoint_read('platform:status')['task']=='configured'


def test_no_runtime_does_not_use_wsgi_executable(app,client,auth_headers):
    app.extensions['s4_db'].put_config('pythonanywhere',CFG)
    result=client.post('/api/platform/activate',json={},headers=auth_headers)
    assert result.status_code==400
    assert 'metadata' in result.json['error']


def test_remove_credential_only(app,client,auth_headers):
    db=app.extensions['s4_db'];db.put_config('pythonanywhere',CFG)
    assert client.delete('/api/platform/config',headers=auth_headers).json['ok']
    assert db.get_config('pythonanywhere')=={}
    assert client.get('/api/platform/config').json['configured'] is False


def test_no_token_maintenance_does_not_fetch_or_prompt(db,settings,monkeypatch):
    def forbidden():
        raise AssertionError('Token-free operation must not attempt auto-updates')
    monkeypatch.setattr(updates,'latest_commit',forbidden)
    assert updates.maintain(db,settings)['skipped']


def test_installers_default_to_no_token():
    root=Path(__file__).resolve().parents[1]
    assert 'S4_AUTO_CONFIGURE="${S4_AUTO_CONFIGURE:-0}"' in (root/'bootstrap.sh').read_text()
    assert 'S4_AUTO_CONFIGURE="${S4_AUTO_CONFIGURE:-1}"' not in (root/'bootstrap.sh').read_text()


def test_dedicated_page_requires_login_and_supports_credential_recovery(app,client,auth_headers,settings):
    assert app.test_client().get('/settings/pythonanywhere').status_code==302
    assert client.get('/settings/pythonanywhere').status_code==200
    (settings.base_dir/'.maintenance.json').write_text('{}')
    assert client.get('/').status_code==503
    assert client.get('/settings/pythonanywhere').status_code==200
    assert client.get('/static/platform.js').status_code==200
    assert client.post('/api/platform/config',json=CFG,headers=auth_headers).status_code==200
    assert client.post('/api/platform/activate',json={},headers=auth_headers).status_code==503
