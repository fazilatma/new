from dataclasses import replace
import fcntl
import pytest
from scraper4 import create_app
from scraper4.services import product_cleanup


def seed(app):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com',settings={'profileOptions':{'minPrice':150,'priceMode':'multiplier','priceVal':2}})
    other=db.upsert_profile('two','https://example.org')
    for key,price in [('zero',0),('low',50),('high',100)]:db.upsert_product(p['id'],key,{'title':key,'price_num':price})
    db.upsert_product(other['id'],'zero',{'price_num':0})
    return db,p


def call(c,action,fields,write=False):return c.post('/api/php-ui/'+('write' if write else 'read'),json={'action':action,'query':{},'fields':fields})


def test_open_no_cookie_preview_cleanup_through_native_broker_and_python_form(settings):
    app=create_app(replace(settings,access_mode='open',password=''));db,p=seed(app);c=app.test_client()
    before=db.count_products();d=call(c,'python_cleanup_preview',{'profile':'one','mode':'below_min'});assert d.status_code==200 and d.json['count']==1
    assert db.count_products()==before
    r=call(c,'python_cleanup_products',{'profile':'one','proof':d.json['proof']},True);assert r.json['removed']==1 and not r.json['remote_products_deleted']
    # Shared Python controller uses the identical service; no session csrf KeyError.
    d=c.post(f"/api/profile-settings/{p['id']}/cleanup-preview",json={'mode':'all'});assert d.status_code==200 and d.json['count']==2
    r=c.post(f"/api/profile-settings/{p['id']}/cleanup",json={'proof':d.json['proof']});assert r.json['removed']==2
    assert db.get_profile('one')['products_count']==0 and db.count_products()==1
    with c.session_transaction() as s:assert not s.get('authenticated') and not s.get('csrf')


@pytest.mark.parametrize('status',['waiting','running','paused','failed'])
def test_cleanup_preserves_jobs_and_mappings_until_explicitly_resolved(app,settings,status):
    db,p=seed(app);j=db.enqueue('woo_send',p['id']);db.update_entry(j,status=status)
    d=product_cleanup.preview(db,settings,p['id'],'all','test')
    with pytest.raises(ValueError):product_cleanup.apply(db,settings,p['id'],d['proof'],'test')
    assert db.count_products(p['id'])==3 and db.get_entry(j)['status']==status


def test_cleanup_rejects_changed_remote_id_wrong_binding_and_active_worker(app,settings):
    db,p=seed(app);d=product_cleanup.preview(db,settings,p['id'],'all','binding')
    with pytest.raises(ValueError):product_cleanup.apply(db,settings,p['id'],d['proof'],'different')
    row=db.list_products(p['id'])[0];db.mark_product_target(row['id'],'woo',99)
    assert product_cleanup.apply(db,settings,p['id'],d['proof'],'binding')['ok'] is False
    d=product_cleanup.preview(db,settings,p['id'],'all','binding')
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        with pytest.raises(ValueError,match='worker'):product_cleanup.apply(db,settings,p['id'],d['proof'],'binding')
    assert db.count_products(p['id'])==3


def test_cleanup_batches_over_full_db_not_native_500_row_view(app,settings):
    db,p=seed(app)
    with db.connect() as c:
        for n in range(1002):c.execute("INSERT INTO products(profile_id,key,title,created_at,updated_at) VALUES (?,?,?,'now','now')",(p['id'],f'bulk{n}','bulk'))
    d=product_cleanup.preview(db,settings,p['id'],'all','b');assert d['count']==1000
    assert product_cleanup.apply(db,settings,p['id'],d['proof'],'b')['removed']==1000
    assert db.count_products(p['id'])==5 and db.count_products()==6
