import fcntl
import time

from scraper4.services.engine import http_tick


def cron_key(client,headers):
    response=client.post('/api/cron/token',json={},headers=headers)
    assert response.status_code==201
    return {'Authorization':'Bearer '+response.json['token']}


def test_key_scope_and_no_url_credentials(app,client,auth_headers):
    headers=cron_key(client,auth_headers)
    remote=app.test_client()
    assert remote.get('/api/cron/status',headers=headers).status_code==200
    assert remote.get('/api/products',headers=headers).status_code==403
    assert remote.get('/api/platform/config',headers=headers).status_code==403
    assert remote.post('/api/auth/token',json={},headers=headers).status_code==403
    assert remote.post('/api/cron/run?token=secret',json={},headers=headers).status_code==400
    assert remote.post('/api/cron/run',json={'command':'anything'},headers=headers).status_code==400
    assert remote.post('/api/cron/run?token=secret',json={}).status_code in (400,401)


def test_anonymous_and_get_do_not_run(app,client,auth_headers,monkeypatch):
    calls=[]
    monkeypatch.setattr('scraper4.cron.http_tick',lambda *a:calls.append(True) or {'ok':True})
    assert app.test_client().post('/api/cron/run',json={}).status_code in (400,401)
    assert client.get('/api/cron/run').status_code==403
    assert not calls


def test_one_page_checkpoint_each_minute(app,settings,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db']
    profile=db.upsert_profile('cron-test','https://example.com/shop',selectors={'container':'.product','title':'h2'},pagination={'type':'query_page','val':''})
    jid=db.enqueue('extract',profile['id'],{'pages':2})
    calls=[]
    def fake(url,**kwargs):
        calls.append(kwargs)
        return {'ok':True,'url':url,'html':f'<article class="product"><h2>Product {len(calls)}</h2><a href="/p/{len(calls)}">buy</a></article>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fake)
    headers=cron_key(client,auth_headers)
    remote=app.test_client()
    response=remote.post('/api/cron/run',json={},headers=headers)
    assert response.status_code==200 and response.json['mode']=='single_step'
    entry=db.get_entry(jid)
    assert entry['status']=='waiting' and entry['payload']['_page']==2
    assert len(calls)==1 and calls[0]['timeout']==8
    assert calls[0]['net']['fallback'] is False
    assert remote.post('/api/cron/run',json={},headers=headers).json['throttled']
    assert len(calls)==1
    last=db.checkpoint_read('cron:last');last['started_epoch']=time.time()-60
    db.checkpoint_write('cron:last',last)
    assert remote.post('/api/cron/run',headers=headers).json['ran']==1
    assert db.get_entry(jid)['status']=='done'
    assert len(calls)==2


def test_cron_key_is_hashed_rotatable_and_revocable(app,client,auth_headers):
    first=cron_key(client,auth_headers)
    second=cron_key(client,auth_headers)
    assert first!=second
    assert app.test_client().get('/api/cron/status',headers=first).status_code==401
    db=app.extensions['s4_db']
    assert second['Authorization'].split()[1] not in str(db.get_config('cron_auth'))
    assert client.delete('/api/cron/token',headers=auth_headers).json['ok']
    assert app.test_client().get('/api/cron/status',headers=second).status_code==401


def test_shared_lock_prevents_overlap(db,settings):
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert http_tick(db,settings)['busy']
    assert not db.checkpoint_read('cron:last')


def test_updater_is_never_run_by_http_cron(app,client,auth_headers,monkeypatch):
    monkeypatch.setattr('scraper4.services.updates.maintain',lambda *a:(_ for _ in ()).throw(AssertionError('No updates in WSGI')))
    headers=cron_key(client,auth_headers)
    assert app.test_client().post('/api/cron/run',json={},headers=headers).json['code_updates'] is False


def test_maintenance_blocks_cron_but_keeps_status(app,client,auth_headers,settings):
    headers=cron_key(client,auth_headers)
    (settings.base_dir/'.maintenance.json').write_text('{}')
    remote=app.test_client()
    assert remote.post('/api/cron/run',json={},headers=headers).status_code==503
    assert remote.get('/api/cron/status',headers=headers).status_code==200


def test_browser_csrf_required_for_key(client,auth_headers):
    assert client.post('/api/cron/token',json={}).status_code==400
    assert client.post('/api/cron/token',json={},headers=auth_headers).status_code==201


def test_public_get_is_opt_in_and_admin_config_requires_csrf(app,client,auth_headers):
    remote=app.test_client()
    assert remote.get('/api/cron/run').status_code==403
    assert not app.extensions['s4_db'].checkpoint_read('cron:last')
    assert client.post('/api/cron/config',json={'public_get':True}).status_code==400
    assert remote.post('/api/cron/config',json={'public_get':True}).status_code in (400,401)
    assert client.get('/api/cron/config').json['config']['public_get'] is False
    assert client.post('/api/cron/config',json={'public_get':'true'},headers=auth_headers).status_code==400
    assert client.post('/api/cron/config',json={'public_get':True,'command':'bad'},headers=auth_headers).status_code==400
    assert client.post('/api/cron/config',json={'public_get':True},headers=auth_headers).json['config']['public_get'] is True


def test_public_get_without_any_key_advances_one_step_and_is_throttled(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db']
    profile=db.upsert_profile('public','https://example.com/shop',selectors={'container':'.product','title':'h2'})
    jid=db.enqueue('extract',profile['id'],{'pages':3})
    calls=[]
    def fake(url,**kwargs):
        calls.append(url)
        return {'ok':True,'url':url,'html':'<article class="product"><h2>Product name</h2></article>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fake)
    client.post('/api/cron/config',json={'public_get':True},headers=auth_headers)
    remote=app.test_client()
    result=remote.get('/api/cron/run')
    assert result.status_code==200 and result.json['ran']==1
    assert result.headers['Cache-Control']=='no-store'
    assert result.headers['X-Robots-Tag']=='noindex, nofollow'
    assert db.get_entry(jid)['payload']['_page']==2
    assert len(calls)==1
    assert remote.get('/api/cron/run').json['throttled']
    assert len(calls)==1
    assert remote.get('/api/products').status_code==401
    assert remote.get('/api/platform/config').status_code==401
    assert remote.get('/api/cron/status').status_code==401


def test_head_never_advances_public_cron(app,client,auth_headers,monkeypatch):
    calls=[]
    monkeypatch.setattr('scraper4.cron.http_tick',lambda *args:calls.append(True) or {'ok':True})
    client.post('/api/cron/config',json={'public_get':True},headers=auth_headers)
    response=app.test_client().head('/api/cron/run')
    assert response.status_code==200 and response.data==b''
    assert not calls


def test_public_get_rejects_parameters_and_post_stays_protected(app,client,auth_headers,monkeypatch):
    calls=[]
    monkeypatch.setattr('scraper4.cron.http_tick',lambda *args:calls.append(True) or {'ok':True})
    client.post('/api/cron/config',json={'public_get':True},headers=auth_headers)
    remote=app.test_client()
    assert remote.get('/api/cron/run?url=https://example.com').status_code==400
    assert remote.get('/api/cron/run?token=anything').status_code==400
    assert remote.get('/api/cron/run',json={'command':'bad'}).status_code==400
    assert remote.post('/api/cron/run',json={}).status_code==401
    assert not calls


def test_disabling_public_get_is_immediate_and_protected_post_still_works(app,client,auth_headers):
    client.post('/api/cron/config',json={'public_get':True},headers=auth_headers)
    assert app.test_client().get('/api/cron/run').status_code==200
    client.post('/api/cron/config',json={'public_get':False},headers=auth_headers)
    assert app.test_client().get('/api/cron/run').status_code==403
    headers=cron_key(client,auth_headers)
    assert app.test_client().post('/api/cron/run',json={},headers=headers).status_code==200


def test_bearer_cannot_enable_public_access(client,auth_headers):
    key=client.post('/api/auth/token',json={},headers=auth_headers).json['token']
    assert client.post('/api/cron/config',json={'public_get':True},headers={'Authorization':'Bearer '+key}).status_code==403


def test_maintenance_still_blocks_public_get(app,client,auth_headers,settings):
    client.post('/api/cron/config',json={'public_get':True},headers=auth_headers)
    (settings.base_dir/'.maintenance.json').write_text('{}')
    assert app.test_client().get('/api/cron/run').status_code==503
