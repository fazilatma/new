import json
import time
from unittest.mock import Mock
import pytest
from bs4 import BeautifulSoup
from scraper4.services import profile_options as options
from scraper4.services.scraping import engines
from scraper4.services.engine import run_entry


def setup(app):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com','اول',settings={'opaque':{'keep':'secret'},'legacy_profile_settings':{'titleSuffix':'فروشگاه','priceMode':'percent','priceVal':20}})
    other=db.upsert_profile('two','https://example.org','دوم');return db,p,other


def test_tab_is_profile_only_global_forms_owned_by_menu_without_redirects(app,client):
    setup(app);page=BeautifulSoup(client.get('/').text,'html.parser');tab=page.select_one('#pane-settings');menu=page.select_one('#settings-menu')
    assert tab.select_one('#profile-options-form') and not tab.select('.connection-form,#platform-form,#cron-settings')
    for identifier,key in [('connection-woocommerce','woocommerce'),('connection-basalam','basalam'),('settings-import-form','backup'),('platform-form','general'),('worker-runtime','general'),('update-settings','version'),('connection-render','render'),('app-font','general')]:
        assert menu.select_one(f'[data-menu-key="{key}"] #{identifier}')
    assert not menu.select('[data-menu-target],a[href^="/?section="]')
    ids=[e['id'] for e in page.select('[id]')];assert len(ids)==len(set(ids))
    for path in ('/settings/backup','/settings/pythonanywhere'):
        page=BeautifulSoup(client.get(path).text,'html.parser');assert page.select_one('#settings-menu #settings-export-form') and page.select_one('#settings-menu #platform-form')
        ids=[e['id'] for e in page.select('[id]')];assert len(ids)==len(set(ids))


def test_profile_settings_only_change_selected_profile_not_global_credentials_or_products(app,client,auth_headers):
    db,p,other=setup(app);db.put_config('woocommerce',{'consumer_secret':'KEEP'});db.upsert_product(p['id'],'a',{'title':'A','price_num':100})
    opts={**options.DEFAULTS,'titleSuffix':'فروشگاه','priceMode':'percent','priceVal':20,'wooProfileCatId':12}
    response=client.post(f'/api/profile-settings/{p["id"]}',json=opts,headers=auth_headers)
    assert response.status_code==200 and options.active(db.get_profile(p['id']))==opts
    assert db.get_profile(p['id'])['settings']['opaque']=={'keep':'secret'} and 'profileOptions' not in db.get_profile(other['id'])['settings']
    assert db.get_config('woocommerce')=={'consumer_secret':'KEEP'} and db.list_products()[0]['price_num']==100 and not db.list_entries()


def test_legacy_options_are_review_only_until_explicit_save(app,client):
    db,p,_=setup(app);result=client.get(f'/api/profile-settings/{p["id"]}').json
    assert result['options']['priceVal']==20 and result['active'] is False
    assert options.price(p,100)==100 and options.title(p,'Product')=='Product'


@pytest.mark.parametrize('patch',[{'priceMode':'fake'},{'priceVal':float('inf')},{'priceVal':float('nan')},{'priceVal':'2'},{'priceMode':'percent','priceVal':-101},{'priceMode':'multiplier','priceVal':-1},{'useCustomCol':1},{'minPrice':-1},{'wooProfileCatId':True},{'customColName':'','useCustomCol':True},{'titleSuffix':'x\n'},{'token':'oops'}])
def test_invalid_profile_options_rejected(patch):
    with pytest.raises(ValueError):options.validate(patch)


def test_exact_rounding_title_and_preview_no_mutation(app,client,auth_headers):
    db,p,_=setup(app);opts={**options.DEFAULTS,'priceMode':'percent','priceVal':20,'roundPrice':1000,'titleSuffix':'فروشگاه','wooPriceMode':'multiplier','wooPriceVal':2}
    with db.connect() as conn:before=list(conn.iterdump())
    response=client.post(f'/api/profile-settings/{p["id"]}/preview',json={'options':opts,'price':1250,'title':'کالا'},headers=auth_headers)
    assert response.status_code==200 and response.json['profile_price']==2000 and response.json['woo_price']==4000 and response.json['title']=='کالا فروشگاه'
    with db.connect() as conn:assert list(conn.iterdump())==before


def test_save_blocks_only_alive_jobs_of_that_profile_and_csrf_scope(app,client,auth_headers):
    db,p,other=setup(app);db.enqueue('extract',other['id'])
    assert client.post(f'/api/profile-settings/{p["id"]}',json={},headers=auth_headers).status_code==200
    db.enqueue('woo_send',p['id'],status='paused')
    assert client.post(f'/api/profile-settings/{p["id"]}',json={},headers=auth_headers).status_code==400
    assert client.post(f'/api/profile-settings/{p["id"]}',json={}).status_code==400
    assert app.test_client().get(f'/api/profile-settings/{p["id"]}').status_code==401
    token=client.post('/api/cron/token',json={},headers=auth_headers).json['token']
    assert app.test_client().get(f'/api/profile-settings/{p["id"]}',headers={'Authorization':'Bearer '+token}).status_code==403


def test_cleanup_signed_confirmed_scoped_and_stale_proof_rejected(app,client,auth_headers):
    db,p,other=setup(app);db.upsert_product(p['id'],'low',{'title':'Low','price_num':0});db.upsert_product(p['id'],'high',{'title':'High','price_num':20000});db.upsert_product(other['id'],'other',{'title':'Other','price_num':0})
    base=f'/api/profile-settings/{p["id"]}';preview=client.post(base+'/cleanup-preview',json={'mode':'no_price'},headers=auth_headers).json
    assert preview['count']==1 and db.count_products()==3
    db.upsert_product(p['id'],'low',{'title':'Low','price_num':1})
    assert client.post(base+'/cleanup',json={'proof':preview['proof']},headers=auth_headers).status_code==409
    preview=client.post(base+'/cleanup-preview',json={'mode':'below_min'},headers=auth_headers).json
    assert client.post(base+'/cleanup',json={'proof':preview['proof']},headers=auth_headers).json['removed']==1
    assert db.count_products(p['id'])==1 and db.count_products(other['id'])==1
    assert client.post(base+'/cleanup',json={'proof':'forged'},headers=auth_headers).status_code==400


def test_send_and_export_use_saved_profile_title_price_and_categories_not_raw_rewrite(app,settings,client,auth_headers,monkeypatch):
    db,p,_=setup(app);opts={**options.DEFAULTS,'titleSuffix':'فروشگاه','priceMode':'percent','priceVal':20,'wooProfileCatId':33,'useCustomCol':True,'customColName':'ستون','customColVal':'=formula'};options.save(db,p['id'],opts)
    db.upsert_product(p['id'],'a',{'title':'کالا','price_num':1000});db.put_config('woocommerce',{'store_url':'https://example.org','consumer_key':'k','consumer_secret':'s'})
    calls=[];monkeypatch.setattr('scraper4.services.engine.WooClient.create_product',lambda self,body:(calls.append(body) or {'ok':True,'body':{'id':123}}))
    jid=db.enqueue('woo_send',p['id']);entry=db.claim_next();run_entry(db,settings,entry,time.monotonic()+10,max_steps=1)
    assert calls[0]['name']=='کالا فروشگاه' and calls[0]['regular_price']=='1200' and calls[0]['categories']==[{'id':33}]
    row=db.list_products()[0];assert row['title']=='کالا' and row['price_num']==1000 and row['woo_id']==123
    exported=client.get(f'/api/export/{p["id"]}?format=json').json;assert exported[0]['title']=='کالا فروشگاه' and exported[0]['price_num']==1200 and exported[0]['source_price_num']==1000
    csv=client.get(f'/api/export/{p["id"]}?format=csv').text;assert 'ستون' in csv and "'=formula" in csv


def test_nullable_upstream_optionals_no_longer_crash_entire_engine():
    dk={'data':{'products':[{'id':1,'title_fa':'Product','status':'marketable','default_variant':{'price':{'selling_price':10000}},'brand':[],'review':[],'expert_reviews':[],'images':{'main':[]}}, {'id':2,'default_variant':[]}]}}
    rows,_=engines.digikala_rows(dk);assert len(rows)==1 and next(iter(rows.values()))['price']=='1000 تومان'
    bsl=engines.basalam_rows([{'id':1,'title':'Product','status':{'value':2976},'primary_price':10000,'photos':{},'inventory':{},'variants':[{'id':'bad','primary_price':'bad','properties':[{'property':'oops','value':'x'}]}]}]);assert len(bsl)==1


def test_invalid_api_json_categorized_and_report_never_exposes_raw_secrets(app,settings,client,monkeypatch):
    db,p,_=setup(app);p=db.upsert_profile(p['key'],'https://www.digikala.com/search/',settings={'extractionEngine':'digikala_api'})
    monkeypatch.setattr(engines.HtmlFetcher,'get',lambda *a,**kw:{'ok':True,'code':200,'html':'<html>private-secret-token</html>'})
    db.enqueue('extract',p['id']);entry=db.claim_next();run_entry(db,settings,entry,time.monotonic()+10,max_steps=1)
    assert db.get_entry(entry['id'])['counters']['error_code']=='invalid_api_response'
    db.update_entry(entry['id'],error='RAW-TOKEN URL?secret=foo')
    with db.connect() as conn:before=list(conn.iterdump())
    response=client.get('/api/extraction/diagnostics');assert response.status_code==200 and response.json['source_reachability_tested'] is False
    assert all(value not in response.text for value in ('RAW-TOKEN','private-secret-token','consumer_secret','secret=foo'))
    with db.connect() as conn:assert list(conn.iterdump())==before


def test_local_fonts_real_woff2_and_license_on_login_and_menu(client,app):
    for name in ('Vazirmatn-Regular','Vazirmatn-Bold','Sahel','Sahel-Bold'):
        response=app.test_client().get('/static/fonts/'+name+'.woff2');assert response.status_code==200 and response.data.startswith(b'wOF2') and len(response.data)>10000
    for name in ('Vazirmatn-OFL','Sahel-OFL'):assert b'SIL OPEN FONT LICENSE' in client.get('/static/fonts/'+name+'.txt').data.upper()
    assert 'fonts.js' in app.test_client().get('/login').text and 'id="app-font"' in client.get('/').text


def test_php_rounding_first_rounds_price_then_rounds_to_step():
    assert options.adjust(1000,'percent',49.95,1000)==2000


def test_php_below_min_cleanup_keeps_zero_for_separate_no_price_action(app,client,auth_headers):
    db,p,_=setup(app);db.upsert_product(p['id'],'zero',{'title':'zero','price_num':0});db.upsert_product(p['id'],'small',{'title':'small','price_num':1})
    root=f'/api/profile-settings/{p["id"]}'
    assert client.post(root+'/cleanup-preview',json={'mode':'below_min'},headers=auth_headers).json['count']==1
    assert client.post(root+'/cleanup-preview',json={'mode':'no_price'},headers=auth_headers).json['count']==1
