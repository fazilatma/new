import fcntl
from unittest.mock import Mock
import pytest
from scraper4.services import updates,update_branches as branches


def cfg(names=None,selected=None,revision=0):
    names=names or [updates.REF,'main']
    return {'branches':names,'selected':selected or names[-1],'revision':revision}


def test_defaults_and_both_templates(client):
    d=client.get('/api/updates/branches').json
    assert d['config']==cfg([updates.REF]) and d['repository']=='fazilatma/new'
    for path in ('/','/php-ui'):
        text=client.get(path).text
        assert text.count('id="update-branches-form"')==1 and 'update-branches.js' in text
        assert text.index('id="update-branches-form"')>text.index('data-menu-key="version"')


def test_save_add_rename_remove_select_and_reset_stale_status(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db']
    monkeypatch.setattr(updates.requests,'get',lambda *a,**k:pytest.fail('No network while saving'))
    db.checkpoint_write('updates:state',{'latest':'a'*40,'branch':updates.REF,'available':True})
    db.checkpoint_write('updates:config',{'enabled':False,'interval_seconds':600})
    r=client.post('/api/updates/branches',json=cfg(),headers=auth_headers);assert r.status_code==200
    assert r.json['config']['revision']==1 and db.checkpoint_read('updates:state')=={}
    assert client.get('/api/updates/status').json['branch']=='main'
    r=client.post('/api/updates/branches',json=cfg(['main','release/v2'],'release/v2',1),headers=auth_headers);assert r.status_code==200
    r=client.post('/api/updates/branches',json=cfg(['release/v2'],revision=2),headers=auth_headers);assert r.status_code==200
    assert db.checkpoint_read('updates:config')=={'enabled':False,'interval_seconds':600}
    assert not db.checkpoint_read('maintenance:request') and not db.list_entries()


@pytest.mark.parametrize('name',['','../main','-x','a//b','a/.x','a.lock','a/b.lock','a.','a/','a b','https://github.com/a','x?y','x#y','x;pwd','x\n','x\\z','x@{y','a'*161])
def test_invalid_branch_names_rejected(name,client,auth_headers):
    r=client.post('/api/updates/branches',json=cfg([name]),headers=auth_headers)
    assert r.status_code==400


@pytest.mark.parametrize('value',[{'branches':[],'selected':'main','revision':0},cfg(['main','main']),cfg(['main'],'other'),cfg(['main'],revision=True),{**cfg(),'url':'https://other'},cfg(['a'+str(n) for n in range(31)])])
def test_invalid_config_rejected(value,client,auth_headers):
    assert client.post('/api/updates/branches',json=value,headers=auth_headers).status_code==400


def test_conflicts_and_worker_lock(app,client,auth_headers):
    db=app.extensions['s4_db'];settings=app.extensions['s4_settings']
    assert client.post('/api/updates/branches',json=cfg(),headers=auth_headers).status_code==200
    assert client.post('/api/updates/branches',json=cfg(),headers=auth_headers).status_code==400
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert client.post('/api/updates/branches',json=cfg(revision=1),headers=auth_headers).status_code==400
    updates.request_operation(db,'check')
    assert client.post('/api/updates/branches',json=cfg(revision=1),headers=auth_headers).status_code==400
    assert branches.read(db)['revision']==1


def test_auth_csrf(client,app):
    assert client.post('/api/updates/branches',json=cfg()).status_code==400
    assert app.test_client().get('/api/updates/branches').status_code==401
    assert client.get('/api/updates/branches?url=anything').status_code==400


def test_selected_branch_is_resolved_and_queued_target_pinned(db,settings,monkeypatch):
    branches.save(db,settings,cfg())
    calls=[]
    def latest(branch=updates.REF):calls.append(branch);return 'a'*40
    monkeypatch.setattr(updates,'latest_commit',latest)
    op=updates.request_operation(db,'check');assert op['branch']=='main'
    # Even a later out-of-band checkpoint edit cannot retarget this operation.
    db.checkpoint_write(branches.TASK,cfg(['release/v2'],'release/v2',2))
    r=updates.maintain(db,settings);assert r['ok'] and r['branch']=='main' and calls==['main']
    assert updates.check(db,settings)['branch']=='release/v2' and calls[-1]=='release/v2'


def test_github_branch_endpoint_is_fixed_and_escaped(monkeypatch):
    response=Mock();response.json.return_value={'commit':{'sha':'a'*40}}
    get=Mock(return_value=response);monkeypatch.setattr(updates.requests,'get',get)
    assert updates.latest_commit('arena/example')=='a'*40
    assert get.call_args.args==('https://api.github.com/repos/fazilatma/new/branches/arena%2Fexample',)
    response.json.return_value={'commit':{'sha':'bad'}}
    with pytest.raises(ValueError):updates.latest_commit('main')


def test_apply_uses_fresh_commit_from_selected_branch(db,settings,monkeypatch):
    branches.save(db,settings,cfg())
    db.put_config('pythonanywhere',{'token':'not-real'})
    seen=[]
    monkeypatch.setattr(updates,'latest_commit',lambda branch: 'b'*40 if branch=='main' else pytest.fail('wrong branch'))
    monkeypatch.setattr(updates,'apply_update',lambda db,s,commit:seen.append(commit) or {'changed':True})
    updates.request_operation(db,'update')
    assert updates.maintain(db,settings)['ok'] and seen==['b'*40]


def test_signed_agent_cannot_overwrite_selected_different_branch(db,settings,monkeypatch):
    from scraper4.services import webdeploy
    branches.save(db,settings,cfg())
    monkeypatch.setattr(webdeploy,'deploy_locked',lambda *a:pytest.fail('Must not overwrite selected source'))
    result,code=webdeploy.deploy_code(db,settings,{})
    assert code==409 and not result['ok']
    assert not db.checkpoint_read('maintenance:request')


def test_automatic_checker_uses_selected_branch(db,settings,monkeypatch):
    branches.save(db,settings,cfg())
    db.put_config('pythonanywhere',{'token':'not-real'})
    db.checkpoint_write('updates:config',{'enabled':True,'interval_seconds':3600})
    monkeypatch.setattr(updates,'latest_commit',lambda branch: 'c'*40 if branch=='main' else pytest.fail('wrong auto branch'))
    monkeypatch.setattr(updates,'apply_update',lambda *a:{'changed':True})
    assert updates.maintain(db,settings)['branch']=='main'
