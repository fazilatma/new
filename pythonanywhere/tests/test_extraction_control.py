import fcntl
import time

import pytest

from scraper4.services import extraction_control


@pytest.fixture
def queue(app,monkeypatch):
    db=app.extensions['s4_db'];p=db.upsert_profile('shop','https://example.com/shop',selectors={'container':'.product','title':'h2'})
    calls=[]
    def fetch(url,**options):
        calls.append(options)
        return {'ok':True,'url':url,'code':200,'html':f'<article class="product"><h2>Product {len(calls)}</h2><a href="/p/{len(calls)}">view</a></article>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fetch)
    return db,p,calls


def test_manual_step_runs_one_page_only_and_never_claims_earlier_send(queue,client,auth_headers):
    db,p,calls=queue
    send=db.enqueue('woo_send',p['id']);job=db.enqueue('extract',p['id'],{'pages':2})
    result=client.post('/api/extraction/step',json={},headers=auth_headers)
    assert result.status_code==200 and result.json['ran']==1 and result.json['job_id']==job
    assert db.get_entry(send)['status']=='waiting'
    assert db.get_entry(job)['status']=='waiting' and db.get_entry(job)['payload']['_page']==2
    assert db.count_products(p['id'])==1 and len(calls)==1
    assert calls[0]['timeout']==8 and calls[0]['net']['fallback'] is False
    assert client.post('/api/extraction/step',json={},headers=auth_headers).json['throttled']
    assert len(calls)==1
    previous=db.checkpoint_read('extract:manual:last');previous['started_epoch']=time.time()-60;db.checkpoint_write('extract:manual:last',previous)
    assert client.post('/api/extraction/step',json={},headers=auth_headers).json['ran']==1
    assert db.get_entry(job)['status']=='done' and db.count_products(p['id'])==2
    assert db.get_entry(send)['status']=='waiting'


def test_manual_detail_step_resumes_correctly_without_send(queue,client,auth_headers):
    db,p,calls=queue
    db.upsert_profile('shop',p['url'],selectors=p['selectors'],settings={'detailSelectors':{'longDesc':'h2'}})
    job=db.enqueue('extract',p['id'],{'pages':1})
    client.post('/api/extraction/step',json={},headers=auth_headers)
    assert db.get_entry(job)['payload']['_phase']=='detail'
    previous=db.checkpoint_read('extract:manual:last');previous['started_epoch']=0;db.checkpoint_write('extract:manual:last',previous)
    client.post('/api/extraction/step',json={},headers=auth_headers)
    assert len(calls)==2 and db.get_entry(job)['status']=='done'
    assert db.list_products()[0]['extra']['longDesc']


def test_empty_page_is_visible_warning_not_silent_success(queue,client,auth_headers,monkeypatch):
    db,p,_=queue;job=db.enqueue('extract',p['id'])
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda *a,**k:{'ok':True,'code':200,'html':'<body>Nothing here</body>'})
    result=client.post('/api/extraction/step',json={},headers=auth_headers).json
    assert result['status']=='done' and result['counters']['last_page_products']==0
    assert result['counters']['warning'] and result['message']==result['counters']['warning']
    status=client.get('/api/extraction/status').json
    assert status['jobs'][0]['counters']['warning'] and status['counts']['done']==1


def test_fetch_failure_is_not_reported_as_success_or_retried(queue,client,auth_headers,monkeypatch):
    db,p,_=queue;job=db.enqueue('extract',p['id'])
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda *a,**k:{'ok':False,'code':403,'error':'HTTP 403'})
    result=client.post('/api/extraction/step',json={},headers=auth_headers)
    assert result.status_code==422 and result.json['ok'] is False
    assert result.json['counters']['last_http_status']==403 and db.get_entry(job)['status']=='failed'
    previous=db.checkpoint_read('extract:manual:last');previous['started_epoch']=0;db.checkpoint_write('extract:manual:last',previous)
    assert client.post('/api/extraction/step',json={},headers=auth_headers).json['ran']==0
    assert db.get_entry(job)['status']=='failed'


def test_status_is_read_only_and_does_not_leak_connections(queue,client):
    db,p,_=queue;db.enqueue('extract',p['id']);db.put_config('woocommerce',{'consumer_secret':'private-do-not-echo'})
    with db.connect() as conn: before=list(conn.iterdump())
    response=client.get('/api/extraction/status')
    assert response.status_code==200 and response.json['counts']['waiting']==1
    assert response.json['public_cron'] is False and response.json['last_cron_at'] is None
    assert 'private-do-not-echo' not in response.text
    with db.connect() as conn: assert list(conn.iterdump())==before


def test_shared_worker_lock_blocks_manual_step(queue,settings,client,auth_headers):
    db,p,calls=queue;job=db.enqueue('extract',p['id'])
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert client.post('/api/extraction/step',json={},headers=auth_headers).json['busy']
    assert not calls and db.get_entry(job)['status']=='waiting'


def test_no_auto_enqueue_paused_resume_or_destination_mutation(queue,settings,client,auth_headers):
    db,p,calls=queue
    db.enqueue('extract',p['id'],status='paused');db.enqueue('bsl_send',p['id'])
    assert client.post('/api/extraction/step',json={},headers=auth_headers).json['ran']==0
    assert len(db.list_entries())==2 and not calls
    (settings.base_dir/'.maintenance.json').write_text('{}')
    assert client.post('/api/extraction/step',json={},headers=auth_headers).status_code==503


@pytest.mark.parametrize('body',[{'url':'https://example.com'}, {'job_id':1}, [], None])
def test_step_rejects_target_parameters(client,auth_headers,body):
    assert client.post('/api/extraction/step',json=body,headers=auth_headers).status_code in (400,415)
    assert client.post('/api/extraction/step?job=1',json={},headers=auth_headers).status_code==400


def test_step_has_auth_csrf_and_cron_scope_protection(app,client,auth_headers):
    remote=app.test_client()
    assert remote.get('/api/extraction/status').status_code==401
    assert client.get('/api/extraction/step').status_code==405
    assert client.post('/api/extraction/step',json={}).status_code==400
    cron=client.post('/api/cron/token',json={},headers=auth_headers).json['token']
    for path in ('/api/extraction/status','/api/extraction/step'):
        response=remote.get(path,headers={'Authorization':'Bearer '+cron}) if path.endswith('status') else remote.post(path,json={},headers={'Authorization':'Bearer '+cron})
        assert response.status_code==403


def test_failed_js_renderer_is_visible_even_when_static_products_exist(queue,client,auth_headers,monkeypatch):
    db,p,_=queue;db.enqueue('extract',p['id'],{'pages':1,'render':'js'})
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda *a,**k:{'ok':True,'code':200,'html':'<article class="product"><h2>Product title</h2></article>',
        'render_error':'do-not-echo-render-credential','js_shell_detected':True})
    response=client.post('/api/extraction/step',json={},headers=auth_headers)
    assert response.status_code==200
    assert response.json['counters']['render_failed'] and response.json['counters']['js_shell']
    assert response.json['counters']['last_page_products']==1
    assert 'رندر' in response.json['message'] and 'do-not-echo' not in response.text
