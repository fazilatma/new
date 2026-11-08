import base64
import copy
import json

import pytest

from scraper4.services.basalam import shops
from scraper4.services.engine import tick, http_tick
from scraper4.services import settings_transfer as transfer
from scraper4.services.scraping import engines

PRIMARY={'vendor_id':'10','token':'primary-private','shop_name':'اصلی','category_id':'3'}
SECOND={'vendor_id':'20','token':'secondary-private','shop_name':'دوم','category_id':'4','price_mode':'percent','price_val':10}


def configuration(db):
    cfg={**PRIMARY,'vendors':[SECOND]};db.put_config('basalam',cfg);return cfg


def test_default_wins_over_imported_duplicate_and_ids_are_canonical():
    cfg={**PRIMARY,'vendors':[{**SECOND,'vendor_id':'0010','token':'WRONG'},SECOND,{**SECOND,'vendor_id':'020','token':'DUPLICATE'}]}
    result=shops.all_shops(cfg)
    assert len(result)==2 and result[0]['token']=='primary-private' and result[1]['token']=='secondary-private'
    assert 'private' not in json.dumps(shops.public_shops(cfg))


def test_multi_vendor_remote_ids_are_scoped_and_never_cross_updated(db,settings,monkeypatch):
    configuration(db);p=db.upsert_profile('p','https://example.com')
    db.upsert_product(p['id'],'p',{'title':'P','price_num':1000})
    product=db.list_products(p['id'])[0];db.mark_product_target(product['id'],'basalam',111)
    calls=[]
    def create(self,vendor,body):
        calls.append(('create',str(vendor),self.token,body));return {'ok':True,'body':{'id':222}}
    def update(self,remote,body,vendor):
        calls.append(('update',str(vendor),remote,body));return {'ok':True,'body':{'id':remote}}
    monkeypatch.setattr('scraper4.services.engine.BasalamClient.create_product',create)
    monkeypatch.setattr('scraper4.services.engine.BasalamClient.update_product',update)
    first=db.enqueue('bsl_send',p['id'],{'vendor_id':'10'});second=db.enqueue('bsl_send',p['id'],{'vendor_id':'20'})
    tick(db,settings)
    assert db.get_entry(first)['counters']['skipped']==1 and db.get_entry(second)['status']=='done'
    assert calls[0][:3]==('create','20','secondary-private') and calls[0][3]['primary_price']==11000
    stored=db.list_products(p['id'])[0];assert stored['basalam_id']==111 and stored['extra']['basalam_targets']=={'20':222}
    for vid in ('10','20'):db.enqueue('bsl_send',p['id'],{'vendor_id':vid,'force':True})
    tick(db,settings)
    assert [(v[0],v[1],v[2]) for v in calls[1:]]==[('update','10',111),('update','20',222)]
    assert db.list_products(p['id'])[0]['extra']['basalam_targets']=={'10':111,'20':222}


def test_reextract_preserves_remote_maps_and_old_details(db,settings,monkeypatch):
    p=db.upsert_profile('p','https://example.com',selectors={'container':'.product','title':'h2'},settings={'extractionEngine':'basalam_api'})
    from scraper4.services.scraping.product_key import product_key
    row={'title':'P','link':'https://basalam.com/p/1','price':'1000 تومان','images':['https://images.example/1.jpg']}
    db.upsert_product(p['id'],product_key(row),{**row,'extra':{'basalam_targets':{'20':999},'longDesc':'keep'}})
    monkeypatch.setattr(engines,'extract',lambda *a,**kw:{'ok':True,'code':200,'products':{product_key(row):row},'engine':'basalam_api','used_engine':'basalam_api'})
    jid=db.enqueue('extract',p['id'],{'pages':1});tick(db,settings)
    extra=db.list_products(p['id'])[0]['extra']
    assert extra['basalam_targets']=={'20':999} and extra['longDesc']=='keep' and extra['images']==row['images']
    assert db.get_entry(jid)['status']=='done'


def test_vendor_crud_masks_tokens_preserves_blank_and_does_not_delete_remote_ids(client,app,auth_headers):
    db=app.extensions['s4_db'];configuration(db)
    read=client.get('/api/basalam/vendors');assert 'primary-private' not in read.text and 'secondary-private' not in read.text
    assert read.json['vendors'][1]['token_configured']
    body={'vendor_id':'20','shop_name':'ویرایش','token':''}
    assert client.post('/api/basalam/vendors',json=body,headers=auth_headers).status_code==200
    assert db.get_config('basalam')['vendors'][0]['token']=='secondary-private'
    for invalid in ({'vendor_id':'30'},{'vendor_id':'10','token':'x'},{'vendor_id':'abc','token':'x'}):
        assert client.post('/api/basalam/vendors',json=invalid,headers=auth_headers).status_code==400
    p=db.upsert_profile('p','https://example.com');db.upsert_product(p['id'],'p',{'title':'P','extra':{'basalam_targets':{'20':123}}})
    job=db.enqueue('bsl_send',p['id'],{'vendor_id':'20'})
    assert client.delete('/api/basalam/vendors/20',headers=auth_headers).status_code==400
    db.finish_entry(job,'cancelled')
    assert client.delete('/api/basalam/vendors/20',headers=auth_headers).status_code==200
    assert db.list_products(p['id'])[0]['extra']['basalam_targets']=={'20':123}


def test_new_send_job_pins_selected_vendor_and_contains_no_token(client,app,auth_headers):
    db=app.extensions['s4_db'];configuration(db);p=db.upsert_profile('p','https://example.com')
    result=client.post('/api/jobs',json={'profile_id':p['id'],'kind':'bsl_send','vendor_id':'20'},headers=auth_headers)
    assert result.status_code==202
    entry=db.get_entry(result.json['id']);assert entry['payload']['vendor_id']=='20' and 'private' not in json.dumps(entry)
    assert client.post('/api/jobs',json={'profile_id':p['id'],'kind':'bsl_send','vendor_id':'99'},headers=auth_headers).status_code==400


def test_changing_primary_pins_old_owner_and_keeps_legacy_job_from_drifting(client,app,settings,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];configuration(db);p=db.upsert_profile('p','https://example.com')
    db.upsert_product(p['id'],'p',{'title':'P','price_num':200});product=db.list_products(p['id'])[0];db.mark_product_target(product['id'],'basalam',111)
    legacy=db.enqueue('bsl_send',p['id'],{'force':True})
    assert client.post('/api/connections/basalam',json={'vendor_id':'30','token':'third-private'},headers=auth_headers).status_code==200
    assert db.checkpoint_read('basalam:legacy_owner')['vendor_id']=='10'
    called=[];monkeypatch.setattr('scraper4.services.engine.BasalamClient.create_product',lambda *a:called.append(a))
    tick(db,settings)
    assert db.get_entry(legacy)['status']=='failed' and not called and db.list_products(p['id'])[0]['basalam_id']==111


def php_file(cfg):
    return {'app':'scraper','files':{'connections.json':{'b64':base64.b64encode(json.dumps(cfg).encode()).decode()}}}


def test_php_multi_shop_import_and_encrypted_roundtrip_include_keys_with_explicit_consent(db,settings):
    original={'woocommerce':{'store_url':'https://store.example','consumer_key':'ck-private','consumer_secret':'cs-private'},'basalam':{**PRIMARY,'vendors':[SECOND]}}
    data={'file':php_file(original),'sections':['woocommerce','basalam'],'mode':'merge','credentials':True}
    preview=transfer.preview(db,data,'test')
    assert preview['credential_presence']['basalam']=={'keys_present':1,'vendor_tokens':1}
    assert 'cs-private' not in json.dumps(preview) and 'secondary-private' not in json.dumps(preview)
    transfer.apply(db,settings,{**data,'token':preview['token']},'test')
    assert db.get_config('woocommerce')['consumer_key']=='ck-private' and db.get_config('basalam')['vendors'][0]['token']=='secondary-private'
    with db.connect() as conn:
        snap=transfer.snapshot(conn,db.secret_key)
        encrypted=conn.execute("SELECT config FROM connections WHERE name='basalam'").fetchone()[0]
    assert 'secondary-private' not in encrypted
    decoded=transfer.decode(transfer.encrypt(snap,'long-test-password'),'long-test-password')
    assert decoded['sections']['basalam']['vendors'][0]['token']=='secondary-private'


def test_no_consent_never_imports_nested_tokens_and_existing_shops_remain(db,settings):
    configuration(db);before=copy.deepcopy(db.get_config('basalam'))
    incoming={**PRIMARY,'vendors':[{**SECOND,'token':'new-token'},{'vendor_id':'30','token':'third-token'}]}
    data={'file':php_file({'basalam':incoming}),'sections':['basalam'],'mode':'replace','credentials':False}
    view=transfer.preview(db,data,'test');assert view['credentials_imported'] is False
    transfer.apply(db,settings,{**data,'token':view['token']},'test')
    assert db.get_config('basalam')==before


def test_settings_restore_primary_change_preserves_local_owner_products_and_queue(db,settings):
    configuration(db);p=db.upsert_profile('p','https://example.com');db.upsert_product(p['id'],'p',{'title':'P'})
    pid=db.list_products(p['id'])[0]['id'];db.mark_product_target(pid,'basalam',111)
    job=db.enqueue('bsl_send',p['id'],status='failed');old=db.get_entry(job)
    data={'file':php_file({'basalam':{'vendor_id':'30','token':'third'}}),'sections':['basalam'],'mode':'replace','credentials':True}
    view=transfer.preview(db,data,'test');transfer.apply(db,settings,{**data,'token':view['token']},'test')
    assert db.checkpoint_read('basalam:legacy_owner')['vendor_id']=='10'
    assert db.get_entry(job)==old and db.list_products(p['id'])[0]['basalam_id']==111


def test_price_adjustment_matches_global_then_shop_then_round():
    cfg={'price_mode':'percent','price_val':10,'price_round':50}
    assert shops.adjusted_price(100,cfg,{'price_mode':'multiplier','price_val':2})==200
    with pytest.raises(ValueError):shops.adjusted_price(100,{'price_mode':'percent','price_val':-200},{'is_default':True})


def test_import_preview_and_inspect_tell_whether_keys_will_be_transferred(client,auth_headers):
    file=php_file({'woocommerce':{'store_url':'https://store.example','consumer_key':'ck-private','consumer_secret':'cs-private'},'basalam':{**PRIMARY,'vendors':[SECOND]}})
    inspected=client.post('/api/settings/inspect',json={'file':file},headers=auth_headers)
    assert inspected.json['credential_presence']['woocommerce']['keys_present']==2 and 'cs-private' not in inspected.text
    request={'file':file,'sections':['woocommerce','basalam'],'mode':'merge','credentials':False}
    view=client.post('/api/settings/preview',json=request,headers=auth_headers)
    assert view.json['credentials_imported'] is False and 'کلیدهای فایل وارد نمی‌شوند' in ' '.join(view.json['warnings'])


@pytest.mark.parametrize('value',[{'vendors':'bad'},{'vendors':[None]},{'vendors':[{'vendor_id':'20','token':'x\nSecret'}]},{'vendors':[{'vendor_id':'20','price_val':float('inf')}]}])
def test_invalid_shops_are_rejected(value):
    with pytest.raises(ValueError):shops.normalize_config(value)


def test_secondary_only_remote_is_counted_in_global_overview_and_bsl_filters(client,app):
    db=app.extensions['s4_db'];p=db.upsert_profile('p','https://example.com')
    db.upsert_product(p['id'],'p',{'title':'P'});pid=db.list_products(p['id'])[0]['id']
    shops.mark_remote(db,pid,'20',777,'10')
    assert db.list_products(p['id'])[0]['basalam_id'] is None
    assert client.get('/api/products/overview').json['totals']['bsl_linked']==1
    assert client.get('/api/products?filter=bsl_linked').json['total']==1
    assert client.get('/api/products?filter=bsl_missing').json['total']==0
    assert client.get(f'/api/products/{pid}').json['details']['basalam_targets']=={'20':777}


def test_failed_ambiguous_write_never_records_another_shops_id(db,settings,monkeypatch):
    configuration(db);p=db.upsert_profile('p','https://example.com');db.upsert_product(p['id'],'p',{'title':'P','price_num':100})
    pid=db.list_products(p['id'])[0]['id'];db.mark_product_target(pid,'basalam',111)
    called=[]
    def create(*a):called.append(a);return {'ok':False,'code':502,'body':None}
    monkeypatch.setattr('scraper4.services.engine.BasalamClient.create_product',create)
    jid=db.enqueue('bsl_send',p['id'],{'vendor_id':'20'});tick(db,settings);tick(db,settings)
    assert db.get_entry(jid)['status']=='failed' and len(called)==1
    assert db.list_products(p['id'])[0]['basalam_id']==111 and not db.list_products(p['id'])[0]['extra']
