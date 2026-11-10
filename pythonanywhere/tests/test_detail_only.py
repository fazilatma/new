"""Detail-only extraction uses saved products, bounded cursor and shared engine."""
import fcntl
from dataclasses import replace
import pytest
from scraper4 import create_app
from scraper4.services import detail_extraction


@pytest.fixture
def detail(settings,monkeypatch):
    app=create_app(replace(settings,access_mode='open',password=''));db=app.extensions['s4_db']
    p=db.upsert_profile('one','https://example.com/LISTING-MUST-NOT-FETCH',settings={'detailSelectors':{'longDesc':'.description','sku':'.sku'}})
    for key in ('a','b'):
        db.upsert_product(p['id'],key,{'title':'keep '+key,'price_num':12345,'link':'https://example.com/detail/'+key,'extra':{'opaque':'keep','longDesc':'old'}})
        row=next(r for r in db.list_products(p['id']) if r['key']==key);db.mark_product_target(row['id'],'woo',77);db.mark_product_target(row['id'],'basalam',88)
    seen=[]
    def fetch(url,**kwargs):
        assert '/detail/' in url;seen.append(url)
        return {'ok':True,'code':200,'url':url,'html':'<div class="description"><b>New description</b><script>bad()</script></div><span class="sku">SKU-new</span>'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fetch)
    return app,app.test_client(),db,p,seen


def action(c,name,**fields):return c.post('/api/php-ui/write',json={'action':name,'query':{},'fields':{k:str(v) for k,v in fields.items()}})


def age(db):db.checkpoint_write('extract:manual:last',{'started_epoch':0})


def test_one_saved_detail_per_step_preserves_ids_prices_and_unrelated_jobs(detail):
    app,c,db,p,seen=detail;other=db.upsert_profile('other','https://example.org');s=db.enqueue('woo_send',other['id']);before=db.list_products(p['id'])
    r=action(c,'python_detail_start',profile='one');assert r.status_code==200 and r.json['ran']==1
    j=r.json['id'];assert r.json['job']['detail_only'] and r.json['job']['counts']['detail_current']==1
    assert db.get_entry(j)['status']=='waiting' and len(seen)==1 and db.get_entry(s)['status']=='waiting'
    # Repeat Start reuses waiting detail job, is throttled, and makes no duplicate.
    r=action(c,'python_detail_start',profile='one');assert r.json['reused'] and r.json['throttled'] and len(seen)==1
    age(db);r=action(c,'python_extract_resume',profile='one',id=j);assert r.json['job']['status']=='done' and len(seen)==2
    for row in db.list_products(p['id']):
        previous=next(x for x in before if x['id']==row['id'])
        for k in ('id','key','title','price_num','price','woo_id','basalam_id','link'):assert row[k]==previous[k]
        assert row['extra']['opaque']=='keep' and 'New description' in row['extra']['longDesc'] and '<script' not in row['extra']['longDesc'] and row['sku']=='SKU-new'
    assert len(db.list_entries())==2 and not db.get_entry(j)['payload']['_send_after']


@pytest.mark.parametrize('kind,status',[('extract','failed'),('extract','paused'),('extract','running'),('woo_send','waiting'),('bsl_send','failed')])
def test_does_not_create_competing_detail_or_sender_work(detail,kind,status):
    app,c,db,p,seen=detail;db.enqueue(kind,p['id'],status=status)
    assert action(c,'python_detail_start',profile='one').status_code==400 and len(db.list_entries())==1 and not seen


def test_rejects_missing_selectors_or_linked_products_without_fetch(detail):
    app,c,db,p,seen=detail
    q=db.upsert_profile('empty','https://example.org',settings={'detailSelectors':{'longDesc':'.description'}})
    assert action(c,'python_detail_start',profile='empty').status_code==400
    db.upsert_profile('no-css','https://example.org');assert action(c,'python_detail_start',profile='no-css').status_code==400
    assert not db.list_entries() and not seen


def test_detail_failure_preserves_cursor_and_explicit_resume_retries_only_that_product(detail,monkeypatch):
    app,c,db,p,seen=detail
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda *a,**k:{'ok':False,'code':403,'error':'PRIVATE-TOKEN'})
    r=action(c,'python_detail_start',profile='one');assert r.status_code==422 and 'PRIVATE-TOKEN' not in r.text
    j=db.get_entry(r.json['id']);assert j['status']=='failed' and j['payload']['_detail_after_id']==0
    assert r.json['job']['error_code']=='source_access_denied'
    assert action(c,'python_detail_start',profile='one').status_code==400
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda url,**k:(seen.append(url) or {'ok':True,'code':200,'url':url,'html':'<div class="description">Recovered</div>'}))
    age(db);r=action(c,'python_extract_resume',profile='one',id=j['id']);assert r.json['ran']==1
    assert seen==['https://example.com/detail/a'] and db.get_entry(j['id'])['payload']['_detail_after_id']>0


def test_detail_cursor_ignores_new_products_and_does_not_reload_github(detail,monkeypatch):
    app,c,db,p,seen=detail
    db.upsert_profile('one',p['url'],settings={**p['settings'],'productSource':'github','sourceGithub':{'repo':'owner/repo','branch':'main','path':'products.csv'}})
    monkeypatch.setattr('scraper4.services.github_products.load_file',lambda *a:pytest.fail('No file import during detail-only'))
    r=action(c,'python_detail_start',profile='one');j=r.json['id']
    db.upsert_product(p['id'],'new-late',{'link':'https://example.com/detail/late'})
    age(db);assert action(c,'python_extract_step',profile='one',id=j).json['job']['status']=='done'
    assert len(seen)==2 and all('late' not in url for url in seen)


def test_detail_cursor_covers_beyond_native_product_limit_without_key_array(detail):
    app,c,db,p,seen=detail
    with db.connect() as conn:
        for n in range(1001):conn.execute("INSERT INTO products(profile_id,key,link,created_at,updated_at) VALUES (?,?,?,'now','now')",(p['id'],f'bulk{n}',f'https://example.com/detail/{n}'))
    created=detail_extraction.enqueue(db,p);j=db.get_entry(created['id']);assert j['counters']['total']==1003
    assert '_detail_keys' not in j['payload']
    with db.connect() as conn:penultimate=conn.execute('SELECT id FROM products WHERE profile_id=? ORDER BY id DESC LIMIT 1 OFFSET 1',(p['id'],)).fetchone()[0]
    j['payload']['_detail_after_id']=penultimate;db.update_entry(j['id'],payload=j['payload'])
    assert action(c,'python_extract_step',profile='one',id=j['id']).json['job']['status']=='done'
    assert seen==['https://example.com/detail/1000']


def test_locked_worker_does_not_fetch_and_reuses_waiting_detail_job(detail,settings):
    app,c,db,p,seen=detail
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        r=action(c,'python_detail_start',profile='one');assert r.json['busy'] and not seen
        r=action(c,'python_detail_start',profile='one');assert r.json['reused'] and r.json['busy'] and len(db.list_entries())==1


def test_empty_detail_preserves_saved_description_and_reports_no_fields(detail,monkeypatch):
    app,c,db,p,seen=detail
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda url,**k:{'ok':True,'code':200,'url':url,'html':'<body>no matching detail fields</body>'})
    r=action(c,'python_detail_start',profile='one')
    assert r.status_code==200 and r.json['job']['counts']['detail_empty']==1
    assert 'فیلدی' in r.json['message']
    assert all(row['extra']['longDesc']=='old' for row in db.list_products(p['id']))
