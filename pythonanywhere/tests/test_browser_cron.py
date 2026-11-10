import fcntl
import time
from dataclasses import replace
import pytest
from scraper4 import create_app
from scraper4.services.engine import http_tick
from scraper4.services.browser_cron import priority,status


def pending(db, status='waiting'):
    p=db.upsert_profile('browser','https://example.com/shop',selectors={'container':'.p','title':'h2'})
    return db.enqueue('extract',p['id'],{'pages':3,'with_detail':False},status=status)


def fixture_fetch(monkeypatch):
    calls=[]
    def fetch(url,**kwargs):
        calls.append(url)
        return {'ok':True,'code':200,'url':url,'html':'<article class="p"><h2>ok</h2></article>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fetch)
    return calls


def test_default_browser_runs_one_step_and_multiple_tabs_throttle(app,settings,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];jid=pending(db);calls=fixture_fetch(monkeypatch)
    assert client.get('/api/cron/browser/config').json['config']=={'enabled':True}
    r=client.post('/api/cron/browser/run',json={},headers=auth_headers)
    assert r.json['ran']==1 and r.json['mode']=='single_step'
    assert db.get_entry(jid)['status']=='waiting' and db.get_entry(jid)['payload']['_page']==2
    assert db.checkpoint_read('browser-cron:last')['source']=='browser'
    assert not db.checkpoint_read('cron:external')
    assert client.post('/api/cron/browser/run',json={},headers=auth_headers).json['throttled']
    assert len(calls)==1
    last=db.checkpoint_read('cron:last');last['started_epoch']-=46;db.checkpoint_write('cron:last',last)
    assert client.post('/api/cron/browser/run',json={},headers=auth_headers).json['ran']==1
    assert db.get_entry(jid)['payload']['_page']==3 and len(calls)==2


def test_external_priority_then_browser_fallback_then_external_returns(db,settings,monkeypatch):
    pending(db);calls=fixture_fetch(monkeypatch)
    assert http_tick(db,settings)['ran']==1
    assert http_tick(db,settings,source='browser')['reason']=='external_fresh'
    ext=db.checkpoint_read('cron:external');ext['started_epoch']-=121;db.checkpoint_write('cron:external',ext)
    last=db.checkpoint_read('cron:last');last['started_epoch']-=121;db.checkpoint_write('cron:last',last)
    assert http_tick(db,settings,source='browser')['ran']==1
    # External gets observed even in shared throttle window; subsequent browser
    # calls stand down instead of believing its own progress was external.
    assert http_tick(db,settings)['throttled']
    assert http_tick(db,settings,source='browser')['reason']=='external_fresh'
    assert len(calls)==2


def test_saved_disable_is_honored_server_side_across_tabs(app,settings,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];pending(db);calls=fixture_fetch(monkeypatch)
    r=client.post('/api/cron/browser/config',json={'enabled':False},headers=auth_headers)
    assert r.json['priority']['reason']=='disabled'
    assert http_tick(db,settings,source='browser')['reason']=='disabled' and calls==[]
    # Disabling the browser is not permission to disable external scheduling.
    assert http_tick(db,settings)['ran']==1


def test_worker_observation_and_worker_lock_have_priority(db,settings,monkeypatch):
    pending(db);calls=fixture_fetch(monkeypatch)
    db.checkpoint_write('worker:state',{'heartbeat_epoch':time.time()})
    with settings.db_path.with_suffix('.daemon.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert http_tick(db,settings,source='browser')['reason']=='worker_active'
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert http_tick(db,settings,source='browser')['busy']
    assert not calls


@pytest.mark.parametrize('state',['paused','failed','done','cancelled'])
def test_does_not_resume_inactive_jobs_or_create_idle_work(db,settings,monkeypatch,state):
    jid=pending(db,state);calls=fixture_fetch(monkeypatch)
    assert http_tick(db,settings,source='browser')['reason']=='idle'
    assert not db.checkpoint_read('cron:last') and not calls
    assert db.get_entry(jid)['status']==state and len(db.list_entries())==1


def test_get_and_head_status_never_execute(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];pending(db);calls=fixture_fetch(monkeypatch)
    for method in ('get','head'):
        assert getattr(client,method)('/api/cron/browser/run').status_code==405
        assert getattr(client,method)('/api/cron/browser/config').status_code==200
    assert not calls
    assert client.post('/api/cron/browser/run?job=1',json={},headers=auth_headers).status_code==400
    assert client.post('/api/cron/browser/run',json={'job':1},headers=auth_headers).status_code==400
    for value in ({'enabled':1},{'enabled':False,'interval':1},{}):
        assert client.post('/api/cron/browser/config',json=value,headers=auth_headers).status_code==400
    assert not calls


def test_protected_mode_needs_session_and_csrf_not_cron_key(app,client,auth_headers):
    assert app.test_client().post('/api/cron/browser/run',json={}).status_code in (400,401)
    assert client.post('/api/cron/browser/run',json={}).status_code==400
    token=client.post('/api/cron/token',json={},headers=auth_headers).json['token']
    assert app.test_client().post('/api/cron/browser/run',json={},headers={'Authorization':'Bearer '+token}).status_code==403


def test_owner_open_mode_no_new_token_and_maintenance_stops_browser(settings,monkeypatch):
    app=create_app(replace(settings,access_mode='open',password=''));db=app.extensions['s4_db'];pending(db);fixture_fetch(monkeypatch)
    c=app.test_client();assert c.post('/api/cron/browser/run',json={}).json['ran']==1
    (settings.base_dir/'.maintenance.json').write_text('{}')
    assert c.post('/api/cron/browser/run',json={}).status_code==503


def test_both_ui_templates_have_parent_scheduler_only(client):
    for url in ('/','/php-ui'):
        text=client.get(url).text;assert text.count('id="browser-cron"')==1 and 'browser-cron.js' in text
    assert 'browser-cron.js' not in client.get('/php-ui/frame').text
