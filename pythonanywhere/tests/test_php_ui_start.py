"""Actual original Start service; temporary SQLite, fixture sources only."""
import fcntl
import pytest
from scraper4.services import php_ui_start


def call(client,headers,action,fields=None,write=False):
    return client.post('/api/php-ui/'+('write' if write else 'read'),json={'action':action,'query':{},'fields':fields or {}},headers=headers)


@pytest.fixture
def native(app,monkeypatch):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com/shop','One',selectors={'container':'.product','title':'h2'},settings={'startWithDetail':False})
    calls=[]
    def fetch(url,**kwargs):
        calls.append((url,kwargs));return {'ok':True,'code':200,'url':url,'html':'<article class="product"><h2>Product '+('two' if 'page=2' in url else 'one')+'</h2></article>'}
    monkeypatch.setattr('scraper4.services.scraping.fetch.HtmlFetcher.get',staticmethod(fetch))
    return db,p,calls


def age(db):
    value=db.checkpoint_read('extract:manual:last');value['started_epoch']=0;db.checkpoint_write('extract:manual:last',value)


def test_start_runs_selected_profile_one_real_page_not_older_extract_or_sender(native,client,auth_headers):
    db,p,network=native;other=db.upsert_profile('other','https://example.com/other');old=db.enqueue('extract',other['id']);send=db.enqueue('woo_send',p['id'])
    r=call(client,auth_headers,'python_extract_start',{'profile':'one','pages':'2'},True)
    assert r.status_code==200 and r.json['ran']==1 and r.json['job']['status']=='waiting'
    assert db.count_products(p['id'])==1 and len(network)==1 and db.get_entry(old)['status']=='waiting' and db.get_entry(send)['status']=='waiting'
    assert r.json['remote_send_executed'] is False and network[0][1]['timeout']<=8
    entry=db.get_entry(r.json['id']);assert entry['payload']['_page']==2
    blocked=call(client,auth_headers,'python_extract_step',{'profile':'one','id':str(entry['id'])},True).json
    assert blocked['throttled'] and blocked['ran']==0 and len(network)==1
    age(db);done=call(client,auth_headers,'python_extract_step',{'profile':'one','id':str(entry['id'])},True).json
    assert done['job']['status']=='done' and db.count_products(p['id'])==2 and len(network)==2


@pytest.mark.parametrize('state',['paused','failed','done','cancelled','running'])
def test_step_never_retries_nonwaiting_job(native,client,auth_headers,state):
    db,p,network=native;job=db.enqueue('extract',p['id'],status=state)
    r=call(client,auth_headers,'python_extract_step',{'profile':'one','id':str(job)},True)
    assert r.status_code==200 and r.json['ran']==0 and not network and db.get_entry(job)['status']==state


@pytest.mark.parametrize('kind,other',[('woo_send',False),('bsl_send',False),('extract',True)])
def test_step_rejects_wrong_profile_or_sender(native,client,auth_headers,kind,other):
    db,p,network=native
    if other:p=db.upsert_profile('other','https://example.com/other')
    job=db.enqueue(kind,p['id']);r=call(client,auth_headers,'python_extract_step',{'profile':'one','id':str(job)},True)
    assert r.status_code==400 and not network and db.get_entry(job)['status']=='waiting'


def test_safe_failure_is_visible_not_success_or_auto_retry(native,client,auth_headers,monkeypatch):
    db,p,_=native
    monkeypatch.setattr('scraper4.services.scraping.fetch.HtmlFetcher.get',staticmethod(lambda *a,**kw:{'ok':False,'code':403,'error':'PRIVATE-TOKEN source secret'}))
    r=call(client,auth_headers,'python_extract_start',{'profile':'one','pages':'1'},True)
    assert r.status_code==422 and r.json['ok'] is False and r.json['job']['status']=='failed'
    assert r.json['job']['error_code']=='source_access_denied' and 'PRIVATE' not in r.text and '403' in r.text
    assert call(client,auth_headers,'python_extract_start',{'profile':'one','pages':'1'},True).status_code==400
    report=call(client,auth_headers,'python_start_status',{'profile':'one'})
    assert report.json['read_only'] and report.json['jobs'][0]['hint'] and 'PRIVATE' not in report.text
    age(db);r=call(client,auth_headers,'python_extract_step',{'profile':'one','id':str(r.json['id'])},True);assert r.json['ran']==0


def test_maintenance_lock_and_global_rate_limit_preserved(native,settings,client,auth_headers):
    db,p,network=native;job=db.enqueue('extract',p['id'])
    fields={'profile':'one','id':str(job)}
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        assert call(client,auth_headers,'python_extract_step',fields,True).json['busy']
    (settings.base_dir/'.maintenance.json').write_text('{}')
    r=call(client,auth_headers,'python_extract_step',fields,True)
    assert r.status_code==503 and r.json['ok'] is False and r.json['error']=='Maintenance in progress'
    assert not network and db.get_entry(job)['status']=='waiting'


def test_boot_status_read_only_and_all_new_writes_require_csrf_browser_session(native,app,client,auth_headers):
    db,p,network=native;db.enqueue('extract',p['id']);db.put_config('woocommerce',{'consumer_secret':'PRIVATE'})
    with db.connect() as conn:before=list(conn.iterdump())
    r=call(client,auth_headers,'python_start_status',{'profile':'one'});assert r.json['ok'] and 'PRIVATE' not in r.text and not network
    with db.connect() as conn:assert list(conn.iterdump())==before
    for op in php_ui_start.WRITES:
        assert call(client,{},op,{'profile':'one','id':'1','pages':'1'},True).status_code==400
        assert call(app.test_client(),{},op,{'profile':'one','id':'1','pages':'1'},True).status_code in (400,401,403)
    contracts=client.get('/api/php-ui/capabilities').json
    assert php_ui_start.WRITES<=set(contracts['write_actions']) and php_ui_start.READS<=set(contracts['read_actions'])


def test_github_catalog_uses_bounded_public_api_and_only_supported_files(native,client,auth_headers,monkeypatch):
    calls=[]
    def api(path,params=None):
        calls.append((path,params))
        if path.endswith('/branches'):return [{'name':'main'},{'name':'feature/x'}]
        return {'tree':[{'path':'a.csv','type':'blob','size':100},{'path':'b.xlsx','type':'blob','size':200},{'path':'no.xls','type':'blob','size':4},{'path':'big.csv','type':'blob','size':9999999}], 'truncated':False}
    monkeypatch.setattr('scraper4.services.github_products.api_read',api)
    assert call(client,auth_headers,'python_github_catalog',{'kind':'branches','repo':'owner/repo'}).json['branches']==['main','feature/x']
    r=call(client,auth_headers,'python_github_catalog',{'kind':'files','repo':'owner/repo','branch':'feature/x'})
    assert r.json['files']==['a.csv','b.xlsx'] and '/feature%2Fx' in calls[-1][0]
    assert call(client,auth_headers,'python_github_catalog',{'kind':'files','repo':'https://evil.test'}).status_code==400 and len(calls)==2


def test_native_steps_resume_detail_without_rewriting_remote_identity(native,client,auth_headers,monkeypatch):
    db,p,network=native
    from scraper4.services.scraping.product_key import product_key
    key=product_key({'title':'Product one','link':'https://example.com/detail'})
    selectors={'container':'.product','title':'h2','link':'a','price':'.price'}
    db.upsert_profile('one',p['url'],'One',selectors=selectors,settings={'startWithDetail':True,'detailSelectors':{'longDesc':'h2'}})
    monkeypatch.setattr('scraper4.services.scraping.fetch.HtmlFetcher.get',staticmethod(lambda url,**kw:{'ok':True,'code':200,'url':url,'html':'<h2>Actual detail body</h2>' if url.endswith('/detail') else '<article class="product"><h2>Product one</h2><a href="https://example.com/detail">Detail</a><span class="price">10000 تومان</span></article>'}))
    db.upsert_product(p['id'],key,{'title':'Product one','price_num':10000,'link':'https://example.com/detail'})
    old=db.list_products(p['id'])[0];db.mark_product_target(old['id'],'woo',77);db.mark_product_target(old['id'],'bsl',88)
    r=call(client,auth_headers,'python_extract_start',{'profile':'one','pages':'1'},True).json
    job=db.get_entry(r['id']);assert r['ran']==1 and job['payload']['_phase']=='detail'
    age(db);r=call(client,auth_headers,'python_extract_step',{'profile':'one','id':str(job['id'])},True).json
    # The saved linked product receives actual detail HTML in its own step.
    assert r['job']['status']=='done';old=next(p for p in db.list_products(p['id']) if p['key']==key)
    assert old['woo_id']==77 and old['basalam_id']==88 and old['price_num']==10000 and old['extra']['longDesc']


def test_no_raw_legacy_error_warning_or_response_in_native_status(native,client,auth_headers):
    db,p,_=native;job=db.enqueue('extract',p['id'],{'pages':1});db.update_entry(job,counters={'warning':'PRIVATE-LEGACY-WARNING','error_hint':'PRIVATE-HTML','found':0})
    r=call(client,auth_headers,'python_extract_step',{'profile':'one','id':str(job)},True)
    assert r.status_code==200 and 'PRIVATE' not in r.text
    assert 'PRIVATE' not in call(client,auth_headers,'python_start_status',{'profile':'one'}).text
