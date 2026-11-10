"""Native shell API integration; only temporary DBs and simulated destinations."""
import json
import hashlib
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from bs4 import BeautifulSoup
from scraper4.services import php_ui_operations as ops
from scraper4.services.engine import run_entry, tick
from test_php_ui import request


def seed(db):
    p=db.upsert_profile('one','https://example.com/shop','اول',selectors={'container':'.product','title':'h2'},settings={'profileOptions':{'titleSuffix':'keep'},'opaque':'private'})
    db.upsert_product(p['id'],'a',{'title':'A','price_num':1000})
    db.put_config('woocommerce',{'store_url':'https://store.example','consumer_key':'woo-private','consumer_secret':'secret-private'})
    db.put_config('basalam',{'vendor_id':'10','token':'default-private','category_id':'3','vendors':[{'vendor_id':'20','token':'second-private','category_id':'4'}]})
    return p


def write(client,h,action,**fields):
    return request(client,h,action,fields={k:str(v) for k,v in fields.items()},write=True)


def test_capabilities_and_host_panels_are_real_unique_dom_and_no_secret_bootstrap(app,client,auth_headers):
    db=app.extensions['s4_db'];seed(db)
    data=client.get('/api/php-ui/capabilities').json
    assert data==request(client,auth_headers,'python_capabilities').json==request(client,auth_headers,'python_contracts').json
    assert not data['full_php_parity'] and not data['heartbeat_can_run_cron']
    host=client.get('/php-ui');soup=BeautifulSoup(host.text,'html.parser')
    ids=[n['id'] for n in soup.select('[id]')];assert len(ids)==len(set(ids))
    for id in ('hamburgerBtn','settings-menu','profile-options-form','profile-form','extraction-audit-form','products-next','php-jobs','settings-inspect'):
        assert soup.select_one('#'+id),id
    for text in (host.text,client.get('/php-ui/frame').text,request(client,auth_headers,'load_connections').text):
        assert 'woo-private' not in text and 'second-private' not in text and 'default-private' not in text
    vendors=request(client,auth_headers,'load_connections').json['connections']['basalam']['vendors']
    assert vendors[0]['vendor_id']=='20' and vendors[0]['token']=='••••'


@pytest.mark.parametrize('action',sorted(ops.READS))
def test_new_reads_never_mutate_or_run_a_worker(app,client,auth_headers,action,monkeypatch):
    db=app.extensions['s4_db'];p=seed(db);db.enqueue('woo_send',p['id'])
    monkeypatch.setattr('scraper4.services.engine.tick',lambda *a,**k:pytest.fail('read must not process'))
    with db.connect() as c:before=list(c.iterdump())
    response=request(client,auth_headers,action,fields={'profile':'one','mode':'no_price'} if action=='python_cleanup_preview' else {});assert response.status_code==200
    assert 'private' not in response.text
    with db.connect() as c:assert list(c.iterdump())==before


@pytest.mark.parametrize('action',sorted(ops.WRITES))
def test_all_new_writes_require_session_csrf_and_reject_bearer_only(app,client,auth_headers,action):
    db=app.extensions['s4_db'];seed(db)
    body={'action':action,'fields':{'profile':'one'},'query':{}}
    assert client.post('/api/php-ui/write',json=body).status_code==400
    assert app.test_client().post('/api/php-ui/write',json=body,headers=auth_headers).status_code in (400,401,403)
    db.put_config('api_auth',{'sha256':hashlib.sha256(b'bearer-private').hexdigest()})
    assert client.post('/api/php-ui/write',json=body,headers={**auth_headers,'Authorization':'Bearer bearer-private'}).status_code in (401,403)
    assert not db.list_entries()


@pytest.mark.parametrize('fields',[
    {'target':'other'},{'target':'none'},{'target':'both','vendor_ids':'[]'},
    {'target':'both','vendor_ids':'["20","020"]'},{'target':'both','vendor_ids':'["999"]'},
    {'target':'bsl','vendor_ids':'[20]'},{'target':'woo','status':'trash'},
    {'target':'woo','pages':'1001'},{'target':'woo','pages':'-1'},
])
def test_send_validation_is_atomic_and_no_destinations_are_partially_enqueued(app,client,auth_headers,fields):
    db=app.extensions['s4_db'];seed(db)
    response=write(client,auth_headers,'python_send_enqueue',profile='one',**fields)
    assert response.status_code==400 and not db.list_entries()


def test_sends_pin_vendors_execute_with_simulated_http_and_preserve_other_remote_ids(app,client,auth_headers,settings,monkeypatch):
    db=app.extensions['s4_db'];p=seed(db);product=db.list_products(p['id'])[0];db.mark_product_target(product['id'],'basalam',111)
    calls=[]
    def woo(self,body):calls.append(('woo',body));return {'ok':True,'body':{'id':222}}
    def bsl(self,vendor,body):calls.append(('bsl',str(vendor),self.token));return {'ok':True,'body':{'id':333}}
    monkeypatch.setattr('scraper4.services.engine.WooClient.create_product',woo)
    monkeypatch.setattr('scraper4.services.engine.BasalamClient.create_product',bsl)
    r=write(client,auth_headers,'python_send_enqueue',profile='one',target='both',vendor_ids='["20"]',status='draft')
    assert r.status_code==200 and not r.json['processed'] and not calls
    assert [db.get_entry(i)['kind'] for i in r.json['ids']]==['woo_send','bsl_send']
    assert write(client,auth_headers,'python_send_enqueue',profile='one',target='both',vendor_ids='["20"]').status_code==400
    tick(db,settings)
    assert calls[0][0]=='woo' and calls[1]==('bsl','20','second-private')
    after=db.list_products(p['id'])[0];assert after['woo_id']==222 and after['basalam_id']==111
    assert after['extra']['basalam_targets']['20']==333
    assert all(db.get_entry(i)['status']=='done' for i in r.json['ids'])
    q=request(client,auth_headers,'woo_queue_status').json;assert q['entries'][0]['sent']==1
    poll=request(client,auth_headers,'poll_basalam').json;assert poll['done'] and poll['sent']==1


def test_manual_chain_is_deferred_nonempty_atomic_and_does_not_duplicate_while_alive(app,client,auth_headers,settings,monkeypatch):
    db=app.extensions['s4_db'];p=seed(db)
    monkeypatch.setattr('scraper4.services.scraping.engines.extract',lambda *a,**kw:{'ok':True,'code':200,'engine':'selectors','used_engine':'selectors','products':{'b':{'title':'B','price':'2000 تومان'}}})
    r=write(client,auth_headers,'python_manual_sync',profile='one',target='both',vendor_ids='["20"]',pages='1')
    assert r.status_code==200 and len(db.list_entries())==1
    e=db.get_entry(r.json['ids'][0]);assert e['payload']['_send_after'][1]['payload']['vendor_id']=='20'
    assert write(client,auth_headers,'python_manual_sync',profile='one',target='none',pages='1').status_code==400
    run_entry(db,settings,db.claim_next(('extract',)),time.monotonic()+10,max_steps=1)
    assert db.get_entry(e['id'])['status']=='done'
    children=[x for x in db.list_entries() if x['kind']!='extract']
    assert len(children)==2 and all(x['batch_id']=='extract:'+str(e['id']) and x['status']=='waiting' for x in children)


def test_failed_send_requires_reconciliation_and_cannot_bypass_with_pause_or_new_enqueue(app,client,auth_headers):
    db=app.extensions['s4_db'];p=seed(db);eid=db.enqueue('woo_send',p['id'],status='failed')
    for control in ('resume','pause','delete'):
        assert write(client,auth_headers,'python_queue_control',id=eid,control=control).status_code==400
    assert write(client,auth_headers,'python_send_enqueue',profile='one',target='woo').status_code==400
    assert write(client,auth_headers,'python_profile_delete',profile='one').status_code==400
    r=write(client,auth_headers,'python_queue_control',id=eid,control='resume',acknowledge_remote_reconciliation='1')
    assert r.status_code==200 and db.get_entry(eid)['status']=='waiting'
    assert write(client,auth_headers,'python_queue_control',id=eid,control='pause').status_code==200
    assert write(client,auth_headers,'python_queue_control',id=eid,control='resume').status_code==200
    assert write(client,auth_headers,'python_queue_control',id=eid,control='cancel').status_code==200
    assert write(client,auth_headers,'python_queue_control',id=eid,control='resume').status_code==400


def test_clear_and_delete_only_terminal_rows_remove_checkpoints_but_not_products(app,client,auth_headers):
    db=app.extensions['s4_db'];p=seed(db);before=db.list_products(p['id'])
    ids={s:db.enqueue('woo_send',p['id'],status=s) for s in ('waiting','paused','failed','done','cancelled')}
    for status,eid in ids.items():db.checkpoint_write('queue:'+status,{'saved':True},eid)
    r=write(client,auth_headers,'python_queue_clear',kind='woo_send');assert r.status_code==200 and r.json['removed']==2
    for status in ('waiting','paused','failed'):
        assert db.get_entry(ids[status]) and db.checkpoint_read('queue:'+status)=={'saved':True}
    assert db.checkpoint_read('queue:done')=={} and db.list_products(p['id'])==before
    assert write(client,auth_headers,'python_queue_control',id=ids['paused'],control='delete').status_code==400
    assert write(client,auth_headers,'python_queue_control',id=ids['paused'],control='cancel').status_code==200
    assert write(client,auth_headers,'python_queue_control',id=ids['paused'],control='delete').status_code==200
    assert db.checkpoint_read('queue:paused')=={}


def test_scoped_pause_never_touches_other_profiles_or_kinds(app,client,auth_headers):
    db=app.extensions['s4_db'];p=seed(db);other=db.upsert_profile('other','https://example.com/other')
    a=db.enqueue('woo_send',p['id']);b=db.enqueue('extract',p['id']);c=db.enqueue('woo_send',other['id'])
    r=write(client,auth_headers,'python_queue_control',profile='one',kind='woo_send',control='pause')
    assert r.status_code==200 and r.json['changed']==1 and db.get_entry(a)['status']=='paused'
    assert db.get_entry(b)['status']==db.get_entry(c)['status']=='waiting'
    assert write(client,auth_headers,'python_queue_control',control='pause',kind='woo_send').status_code==400


def test_profile_copy_excludes_products_delete_requires_idle_and_orphan_log_cannot_resume(app,client,auth_headers):
    db=app.extensions['s4_db'];p=seed(db);product=db.list_products(p['id'])[0];db.mark_product_target(product['id'],'woo',77)
    r=write(client,auth_headers,'python_profile_duplicate',profile='one',name='کپی');assert r.status_code==200
    copy=next(x for x in db.list_profiles() if x['key']==r.json['key'])
    assert copy['settings']==p['settings'] and not db.list_products(copy['id'])
    eid=db.enqueue('extract',p['id']);assert write(client,auth_headers,'python_profile_delete',profile='one').status_code==400
    write(client,auth_headers,'python_queue_control',id=eid,control='cancel')
    assert write(client,auth_headers,'python_profile_delete',profile='one').status_code==200
    assert db.get_profile(p['id']) is None and db.get_entry(eid)['profile_id'] is None
    assert request(client,auth_headers,'tasks_list').status_code==200
    assert write(client,auth_headers,'python_queue_control',id=eid,control='resume').status_code==400


def test_orphan_worker_closes_once_then_valid_profile_runs(app,client,auth_headers,settings,monkeypatch):
    db=app.extensions['s4_db'];seed(db);orphan=db.enqueue('extract');valid=db.enqueue('extract',db.list_profiles()[0]['id'],{'pages':1})
    monkeypatch.setattr('scraper4.services.scraping.engines.extract',lambda *a,**kw:{'ok':True,'code':200,'engine':'selectors','used_engine':'selectors','products':{}})
    tick(db,settings,max_entries=2)
    assert db.get_entry(orphan)['status']=='failed' and db.get_entry(valid)['status']=='done'
    assert write(client,auth_headers,'python_queue_control',id=orphan,control='resume').status_code==400
    assert tick(db,settings,max_entries=2)['ran']==0


def test_concurrent_duplicate_enqueues_create_one_real_job(app):
    db=app.extensions['s4_db'];seed(db)
    def send(_):
        try:return ops.create(db,{'fields':{'profile':'one','target':'woo'}})['ids']
        except ValueError:return []
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(send,range(2)))
    assert sorted(len(r) for r in results)==[0,1] and len(db.list_entries())==1


def test_manual_reserved_destinations_block_independent_send_and_unpinned_legacy_job_blocks_duplicate(app,client,auth_headers):
    db=app.extensions['s4_db'];p=seed(db)
    r=write(client,auth_headers,'python_manual_sync',profile='one',target='both',vendor_ids='["20"]',pages='1');assert r.status_code==200
    assert write(client,auth_headers,'python_send_enqueue',profile='one',target='woo').status_code==400
    assert write(client,auth_headers,'python_send_enqueue',profile='one',target='bsl',vendor_ids='["20"]').status_code==400
    assert len(db.list_entries())==1
    write(client,auth_headers,'python_queue_control',id=r.json['ids'][0],control='cancel')
    db.enqueue('bsl_send',p['id'],status='failed')
    assert write(client,auth_headers,'python_send_enqueue',profile='one',target='bsl',vendor_ids='["10"]').status_code==400


@pytest.mark.parametrize('control',['pause','cancel'])
def test_native_control_during_remote_http_preserves_remote_id_but_does_not_overwrite_stop(app,client,auth_headers,settings,monkeypatch,control):
    db=app.extensions['s4_db'];p=seed(db)
    r=write(client,auth_headers,'python_send_enqueue',profile='one',target='woo');eid=r.json['ids'][0]
    def create(self,body):
        assert write(client,auth_headers,'python_queue_control',id=eid,control=control).status_code==200
        return {'ok':True,'body':{'id':444}}
    monkeypatch.setattr('scraper4.services.engine.WooClient.create_product',create)
    tick(db,settings,max_entries=1)
    assert db.get_entry(eid)['status']=={'pause':'paused','cancel':'cancelled'}[control]
    assert db.list_products(p['id'])[0]['woo_id']==444
    assert db.get_entry(eid)['counters']['sent']==1


def test_runtime_health_is_real_python_version_not_a_fake_php_runtime(app,client,auth_headers):
    from scraper4.config import VERSION
    from scraper4.services.php_ui import manifest
    r=request(client,auth_headers,'runtime_health')
    assert r.status_code==200
    assert r.json=={'ok':True,'runtime':'Python','version':VERSION,'ui_version':manifest()['source_version'],'read_only':True,'processed':False}
    assert not app.extensions['s4_db'].list_entries()
