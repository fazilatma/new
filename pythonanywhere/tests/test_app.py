import json
import time
from concurrent.futures import ThreadPoolExecutor

from scraper4.services.engine import tick
from scraper4.__main__ import import_legacy


def profile(db):
    return db.upsert_profile('shop','https://example.com/shop','Test',{'container':'.product','title':'h2'}, {'type':'query_page','val':''})


def test_auth_and_csrf(app,client,auth_headers):
    anonymous = app.test_client()
    assert anonymous.get('/api/ping').status_code == 401
    assert anonymous.get('/').status_code == 302
    assert client.get('/api/ping').json['ok']
    assert client.post('/api/profiles',json={'url':'https://example.com'}).status_code == 400
    assert client.post('/api/profiles',json={'url':'https://example.com'},headers=auth_headers).status_code == 200
    assert client.get('/').status_code == 200


def test_jobs_export_connections(app,client,auth_headers):
    db = app.extensions['s4_db']
    p = profile(db)
    db.upsert_product(p['id'],'key',dict(title='=1+1',price='۱۲۳۴',price_num=1234))
    response = client.post('/api/jobs',json={'profile_id':p['id'],'pages':2},headers=auth_headers)
    assert response.status_code == 202
    jid=response.json['id']
    assert client.post(f'/api/jobs/{jid}/pause',json={},headers=auth_headers).json['ok']
    assert db.get_entry(jid)['status'] == 'paused'
    assert client.post(f'/api/jobs/{jid}/resume',json={},headers=auth_headers).json['ok']
    assert client.delete(f'/api/profiles/{p["id"]}',headers=auth_headers).status_code == 400
    assert "'=1+1" in client.get(f'/api/export/{p["id"]}').text
    client.post('/api/connections/basalam',json={'token':'very-secret','vendor_id':'1'},headers=auth_headers)
    assert 'very-secret' not in client.get('/api/connections/basalam').text
    with db.connect() as conn:
        raw=conn.execute('SELECT config FROM connections').fetchone()[0]
    assert 'very-secret' not in raw
    assert db.get_config('basalam')['token'] == 'very-secret'


def test_atomic_claim(db):
    p=profile(db)
    jid=db.enqueue('extract',p['id'])
    with ThreadPoolExecutor(2) as pool:
        results=list(pool.map(lambda _:db.claim_next(),range(2)))
    assert sum(r is not None for r in results) == 1


def test_worker_extract_resume(db,settings,monkeypatch):
    p=profile(db)
    jid=db.enqueue('extract',p['id'],{'pages':2})
    calls=[]
    def fake(url,**kwargs):
        calls.append(url)
        return {'ok':True,'url':url,'html':f'<div class="product"><h2>Product {len(calls)}</h2><a href="/p/{len(calls)}">buy</a></div>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fake)
    tick(db,settings)
    assert db.get_entry(jid)['status'] == 'done'
    assert len(calls) == 2
    assert db.count_products(p['id']) == 2


def test_next_selector(db,settings,monkeypatch):
    p=db.upsert_profile('next','https://example.com/shop',selectors={'container':'.product'},pagination={'type':'next_selector','val':'a.next'})
    jid=db.enqueue('extract',p['id'],{'pages':3})
    calls=[]
    def fake(url,**kwargs):
        calls.append(url)
        link='<a class="next" href="/page-two">Next</a>' if len(calls)==1 else ''
        return {'ok':True,'url':url,'html':'<div class="product"><h2>Product name</h2></div>'+link}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fake)
    tick(db,settings)
    assert calls == ['https://example.com/shop','https://example.com/page-two']
    assert db.get_entry(jid)['status']=='done'


def test_stale_checkpoint_and_cancel(db,settings,monkeypatch):
    p=profile(db)
    jid=db.enqueue('extract',p['id'],{'pages':3,'_page':2})
    db.update_entry(jid,status='running',heartbeat='2000-01-01 00:00:00')
    def fake(url,**kwargs):
        assert 'page=2' in url
        db.update_entry(jid,status='cancelled')
        return {'ok':True,'url':url,'html':'<div class="product"><h2>Example</h2></div>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fake)
    tick(db,settings)
    assert db.get_entry(jid)['status']=='cancelled'
    assert db.get_entry(jid)['payload']['_page']==3


def test_import_idempotent(db,tmp_path):
    (tmp_path/'profiles.json').write_text(json.dumps({'legacy':{'url':'https://example.com','products':[{'title':'test','price':'1234','link':'https://example.com/p/1'}]}}))
    (tmp_path/'connections.json').write_text(json.dumps({'woocommerce':{'consumer_key':'secret'}}))
    import_legacy(db,tmp_path)
    import_legacy(db,tmp_path)
    assert db.stats()['profiles']==1
    assert db.stats()['products']==1
    assert db.get_config('woocommerce')['consumer_key']=='secret'


def test_send_cursor_does_not_skip(db,settings,monkeypatch):
    p=profile(db)
    for i in range(3):
        db.upsert_product(p['id'],str(i),{'title':f'Product {i}','price_num':1000})
    db.put_config('woocommerce',{'store_url':'https://example.com','consumer_key':'ck','consumer_secret':'cs'})
    calls=[]
    def fake(self,body):
        calls.append(body)
        return {'ok':True,'body':{'id':100+len(calls)}}
    monkeypatch.setattr('scraper4.services.engine.WooClient.create_product',fake)
    jid=db.enqueue('woo_send',p['id'])
    tick(db,settings)
    assert len(calls)==3
    assert all(body['status']=='draft' for body in calls)
    assert all(row['woo_id'] for row in db.list_products(p['id']))
    assert db.get_entry(jid)['status']=='done'
    # Re-running only skips already linked products.
    db.enqueue('woo_send',p['id'])
    tick(db,settings)
    assert len(calls)==3


def test_budget_yields_at_page_boundary(db,settings,monkeypatch):
    p=profile(db)
    jid=db.enqueue('extract',p['id'],{'pages':3})
    clock=[0]
    monkeypatch.setattr('scraper4.services.engine.time.monotonic', lambda:clock[0])
    def fake(url,**kwargs):
        clock[0]+=2
        return {'ok':True,'url':url,'html':'<div class="product"><h2>Product name</h2></div>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fake)
    tick(db,settings,budget_seconds=1)
    entry=db.get_entry(jid)
    assert entry['status']=='waiting'
    assert entry['payload']['_page']==2
    tick(db,settings,budget_seconds=1)
    assert db.get_entry(jid)['payload']['_page']==3


def test_api_validation(client,auth_headers):
    assert client.post('/api/profiles',json={'url':'http://127.0.0.1'},headers=auth_headers).status_code==400
    assert client.post('/api/profiles',json={'url':'https://example.com','selectors':[]},headers=auth_headers).status_code==200
    assert client.post('/api/profiles',json={'url':'https://example.com','selectors':{'title':123}},headers=auth_headers).status_code==400


def test_stale_send_requires_reconciliation(db,settings):
    p=profile(db)
    jid=db.enqueue('woo_send',p['id'])
    db.update_entry(jid,status='running',heartbeat='2000-01-01 00:00:00')
    tick(db,settings)
    entry=db.get_entry(jid)
    assert entry['status']=='paused'
    assert 'reconcile' in entry['error']
