import base64
import fcntl
import json
import shutil
import time
import uuid
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from scraper4.services import updates, webdeploy
from scraper4.services.platform import PlatformError, PythonAnywhere


@pytest.fixture
def signer(monkeypatch):
    private=Ed25519PrivateKey.generate()
    public=base64.b64encode(private.public_key().public_bytes(serialization.Encoding.Raw,serialization.PublicFormat.Raw)).decode()
    monkeypatch.setattr(webdeploy,'authority',lambda:{'host':'localhost','public_key':public})
    def sign(**changes):
        now=int(time.time())
        value={'protocol':webdeploy.PROTOCOL,'host':'localhost','tree':'a'*40,
               'nonce':uuid.uuid4().hex,'issued':now,'expires':now+900,**changes}
        value['signature']=base64.b64encode(private.sign(webdeploy.canonical(value))).decode()
        return value
    return sign


def encoded(proof):
    return base64.urlsafe_b64encode(json.dumps(proof).encode()).decode().rstrip('=')


def prepare(base,stage,db,monkeypatch,changed=None):
    files={'requirements.txt':'same dependencies\n','scraper4/db.py':"SCHEMA='unchanged'\n",
           'scraper4/deploy_authority.json':'{"public_key":"unchanged"}',
           'scraper4/config.py':'VERSION="1.5.0"\n','scraper4/deploy.py':'VALUE=1\n',
           'scraper4/__init__.py':'VALUE=1\n','scraper4/templates/login.html':'Hello',
           'scraper4/templates/layout.html':'{% block content %}{% endblock %}'}
    for root in (base,stage):
        for name,content in files.items():
            path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(content)
    (base/'scraper4/removed.py').write_text('OLD=True\n')
    (stage/'scraper4/new.py').write_text('NEW=True\n')
    (stage/'scraper4/deploy.py').write_text('VALUE=2\n')
    if changed:
        (stage/changed).write_text('CHANGED=True\n')
    (base/'.env').write_text('VERY_PRIVATE_ENV=untouched\n')
    (base/'.release.json').write_text(json.dumps({'commit':'b'*40}))
    db.put_config('pythonanywhere',{'site':'www.pythonanywhere.com','username':'example',
                                  'domain':'localhost','token':'private-pa-token'})
    calls=[]
    def api(self,method,path,**kwargs):
        calls.append((method,path))
        if method=='GET': return {'source_directory':str(base)}
        if method=='POST' and path.endswith('/reload/'):
            assert not (base/'.maintenance.json').exists()
            return {}
        pytest.fail('No Task creation/WSGI upload/arbitrary action permitted')
    monkeypatch.setattr(PythonAnywhere,'call',api)
    monkeypatch.setattr(webdeploy,'approved_tip',lambda proof:'c'*40)
    def download(commit,root,**kwargs):
        assert commit=='c'*40 and kwargs['timeout']==(3,8)
        assert kwargs['budget_seconds']==15
        return stage
    monkeypatch.setattr(updates,'download',download)
    monkeypatch.setattr(updates,'run_checked',lambda *a,**kw:pytest.fail('No subprocess in HTTP deploy'))
    return calls


def test_missing_forged_tampered_and_expired_proofs_never_start(app,signer,monkeypatch):
    monkeypatch.setattr(webdeploy,'deploy_code',lambda *a:pytest.fail('Invalid proof must not perform work'))
    client=app.test_client()
    assert client.get('/api/deploy/run').status_code==401
    assert client.head('/api/deploy/run').status_code==405
    proof=signer();proof['tree']='d'*40
    assert client.post('/api/deploy/run',json={'proof':proof}).status_code==401
    assert client.post('/api/deploy/run',json={'proof':signer(issued=1,expires=901)}).status_code==401
    assert client.post('/api/deploy/run',json={'proof':signer(host='other.example')}).status_code==403
    assert client.get('/api/deploy/run?proof=garbage').status_code==401
    assert client.post('/api/deploy/run',json={'command':'sh','proof':signer()}).status_code==401
    extra=signer();extra['repository']='attacker/repo'
    assert client.post('/api/deploy/run',json={'proof':extra}).status_code==401


def test_admin_and_cron_keys_are_not_deployment_authority(app,client,auth_headers,monkeypatch):
    monkeypatch.setattr(webdeploy,'deploy_code',lambda *a:pytest.fail('A proof is always required'))
    key=client.post('/api/auth/token',json={},headers=auth_headers).json['token']
    cron=client.post('/api/cron/token',json={},headers=auth_headers).json['token']
    for token in (key,cron):
        assert app.test_client().post('/api/deploy/run',json={},headers={'Authorization':'Bearer '+token}).status_code==401


def test_admin_can_revoke_and_csrf_is_preserved(app,client,auth_headers,signer,monkeypatch):
    monkeypatch.setattr(webdeploy,'deploy_code',lambda *a:pytest.fail('Disabled'))
    assert client.post('/api/deploy/config',json={'enabled':False}).status_code==400
    assert client.post('/api/deploy/config',json={'enabled':False},headers=auth_headers).status_code==200
    assert app.test_client().post('/api/deploy/run',json={'proof':signer()}).status_code==403
    assert app.test_client().get('/api/deploy/config').status_code==401


def test_signed_get_and_post_deploy_real_files_and_replays_are_idempotent(app,settings,signer,monkeypatch,tmp_path):
    db=app.extensions['s4_db'];stage=tmp_path/'stage'
    calls=prepare(settings.base_dir,stage,db,monkeypatch)
    proof=signer();client=app.test_client()
    response=client.get('/api/deploy/run',query_string={'proof':encoded(proof)})
    assert response.status_code==200 and response.json['state']=='reload_requested'
    assert response.json['live_verified'] is False
    assert response.json['commit']=='c'*40
    assert (settings.base_dir/'scraper4/deploy.py').read_text()=='VALUE=2\n'
    assert not (settings.base_dir/'scraper4/removed.py').exists()
    assert (settings.base_dir/'scraper4/new.py').exists()
    assert 'VERY_PRIVATE_ENV' in (settings.base_dir/'.env').read_text()
    assert db.get_config('pythonanywhere')['token']=='private-pa-token'
    backup=Path(db.checkpoint_read('updates:backup')['path'])
    assert (backup/'database.sqlite3').stat().st_mode & 0o777==0o600
    assert (backup/'code/scraper4/removed.py').exists()
    assert not (backup/'code/.env').exists()
    response=client.post('/api/deploy/run',json={'proof':proof})
    assert response.json['replayed'] and len(calls)==2
    assert 'private-pa-token' not in response.text
    assert response.headers['Cache-Control']=='no-store'


@pytest.mark.parametrize('changed',['requirements.txt','scraper4/db.py','scraper4/deploy_authority.json'])
def test_dependency_schema_and_authority_changes_require_cli(app,settings,signer,monkeypatch,tmp_path,changed):
    db=app.extensions['s4_db'];prepare(settings.base_dir,tmp_path/'stage',db,monkeypatch,changed)
    response=app.test_client().post('/api/deploy/run',json={'proof':signer()})
    assert response.status_code==409
    assert 'CLI' in response.json['error']
    assert (settings.base_dir/'scraper4/deploy.py').read_text()=='VALUE=1\n'
    assert updates.read_release(settings.base_dir)['commit']=='b'*40
    assert not (settings.base_dir/'.maintenance.json').exists()


def test_shared_worker_lock_rejects_deployment_without_network(app,settings,signer,monkeypatch):
    monkeypatch.setattr(webdeploy,'deploy_locked',lambda *a:pytest.fail('Worker owns the lock'))
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        response=app.test_client().post('/api/deploy/run',json={'proof':signer()})
    assert response.status_code==409 and response.json['busy']


def test_stale_approved_tree_cannot_select_a_commit(signer,monkeypatch):
    replies=iter([{'sha':'c'*40,'commit':{'tree':{'sha':'d'*40}}},
                  {'tree':[{'path':'pythonanywhere','type':'tree','sha':'f'*40}]}])
    monkeypatch.setattr(webdeploy,'github_json',lambda _:next(replies))
    with pytest.raises(webdeploy.DeployError,match='branch changed'):
        webdeploy.approved_tip(signer())


def test_copy_failure_restores_managed_code_and_release(app,settings,signer,monkeypatch,tmp_path):
    db=app.extensions['s4_db'];prepare(settings.base_dir,tmp_path/'stage',db,monkeypatch)
    original=webdeploy.replace_code;attempts=[]
    def failing(source,base):
        attempts.append(True)
        original(source,base)
        if len(attempts)==1: raise OSError('simulated filesystem failure')
    monkeypatch.setattr(webdeploy,'replace_code',failing)
    response=app.test_client().post('/api/deploy/run',json={'proof':signer()})
    assert response.status_code==500
    assert (settings.base_dir/'scraper4/deploy.py').read_text()=='VALUE=1\n'
    assert (settings.base_dir/'scraper4/removed.py').exists()
    assert not (settings.base_dir/'scraper4/new.py').exists()
    assert updates.read_release(settings.base_dir)['commit']=='b'*40
    assert not (settings.base_dir/'.maintenance.json').exists()


def test_reload_failure_keeps_valid_code_and_same_proof_retries_only_reload(app,settings,signer,monkeypatch,tmp_path):
    db=app.extensions['s4_db'];calls=prepare(settings.base_dir,tmp_path/'stage',db,monkeypatch)
    original=PythonAnywhere.reload;attempts=[]
    def reload(self):
        attempts.append(True)
        if len(attempts)==1: raise PlatformError('Temporary API network failure',category='network')
        return original(self)
    monkeypatch.setattr(PythonAnywhere,'reload',reload)
    proof=signer();client=app.test_client()
    response=client.post('/api/deploy/run',json={'proof':proof})
    assert response.status_code==202 and response.json['state']=='reload_pending'
    assert updates.read_release(settings.base_dir)['commit']=='c'*40
    assert not (settings.base_dir/'.maintenance.json').exists()
    response=client.post('/api/deploy/run',json={'proof':proof})
    assert response.status_code==202 and len(attempts)==1
    record=db.checkpoint_read('agent-deploy:'+proof['nonce'])
    record['last_reload_epoch']=time.time()-31
    db.checkpoint_write('agent-deploy:'+proof['nonce'],record)
    response=client.post('/api/deploy/run',json={'proof':proof})
    assert response.status_code==200 and response.json['replayed']
    assert response.json['reload_requested']
    assert len(calls)==2


def test_maintenance_blocks_even_a_valid_proof(app,settings,signer):
    (settings.base_dir/'.maintenance.json').write_text('{}')
    assert app.test_client().post('/api/deploy/run',json={'proof':signer()}).status_code==503


def test_valid_approved_tree_resolves_only_fixed_branch(signer,monkeypatch):
    paths=[]
    def response(path):
        paths.append(path)
        if path.startswith('commits/'):
            return {'sha':'c'*40,'commit':{'tree':{'sha':'d'*40}}}
        return {'tree':[{'path':'pythonanywhere','type':'tree','sha':'a'*40}]}
    monkeypatch.setattr(webdeploy,'github_json',response)
    assert webdeploy.approved_tip(signer())=='c'*40
    assert paths==['commits/arena%2Ff3d5d2a0-new','git/trees/'+'d'*40]


def test_no_saved_token_does_not_fetch_or_write_code(app,signer,monkeypatch):
    monkeypatch.setattr(webdeploy,'approved_tip',lambda *a:pytest.fail('No network without saved credentials'))
    response=app.test_client().post('/api/deploy/run',json={'proof':signer()})
    assert response.status_code==409
    assert 'token' in response.json['error']


def test_interrupted_request_does_not_silently_repeat_file_changes(app,signer,monkeypatch):
    proof=signer();db=app.extensions['s4_db']
    db.checkpoint_write('agent-deploy:'+proof['nonce'],{'ok':True,'state':'preparing',
                        'source_tree':proof['tree'],'expires':proof['expires']})
    monkeypatch.setattr(webdeploy,'approved_tip',lambda *a:pytest.fail('Do not repeat ambiguous deployment'))
    response=app.test_client().post('/api/deploy/run',json={'proof':proof})
    assert response.status_code==409 and response.json['state']=='interrupted'


def test_reload_retries_are_bounded_even_for_a_publicly_relayed_proof(app,settings,signer,monkeypatch,tmp_path):
    db=app.extensions['s4_db'];prepare(settings.base_dir,tmp_path/'stage',db,monkeypatch)
    attempts=[]
    def fail(self):
        attempts.append(True)
        raise PlatformError('API unavailable',category='network')
    monkeypatch.setattr(PythonAnywhere,'reload',fail)
    proof=signer();client=app.test_client()
    assert client.post('/api/deploy/run',json={'proof':proof}).status_code==202
    for _ in range(5):
        record=db.checkpoint_read('agent-deploy:'+proof['nonce'])
        record['last_reload_epoch']=time.time()-31
        db.checkpoint_write('agent-deploy:'+proof['nonce'],record)
        assert client.post('/api/deploy/run',json={'proof':proof}).status_code==202
    assert len(attempts)==3


def test_host_configuration_cannot_redirect_deployment_to_another_webapp(app,settings,signer,monkeypatch):
    app.extensions['s4_db'].put_config('pythonanywhere',{'site':'www.pythonanywhere.com',
        'username':'example','domain':'another.example','token':'private'})
    monkeypatch.setattr(PythonAnywhere,'call',lambda *a,**kw:pytest.fail('Wrong host must not call API'))
    assert app.test_client().post('/api/deploy/run',json={'proof':signer()}).status_code==409


def test_failed_public_approval_does_not_repeat_network_lookups(app,settings,signer,monkeypatch):
    db=app.extensions['s4_db']
    db.put_config('pythonanywhere',{'site':'www.pythonanywhere.com','username':'example','domain':'localhost','token':'private'})
    calls=[]
    def fail(self,*args,**kwargs):
        calls.append(True)
        raise PlatformError('API denied',status=403)
    monkeypatch.setattr(PythonAnywhere,'call',fail)
    proof=signer();client=app.test_client()
    assert client.post('/api/deploy/run',json={'proof':proof}).status_code==502
    response=client.post('/api/deploy/run',json={'proof':proof})
    assert response.status_code==502 and response.json['replayed']
    assert len(calls)==1
