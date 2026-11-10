import base64
import json
from dataclasses import replace
from unittest.mock import Mock

import pytest

from scraper4.services.scraping import engines
from scraper4.services.engine import tick, http_tick
from scraper4.services import settings_transfer as transfer

HTML='''<article class="product"><h2>کالای اول</h2><a href="/p/1">link</a><span class="sku">SKU-1</span><span class="price">1200 تومان</span><img src="/1.jpg"></article>'''
SELECTORS={'container':'.product','title':'h2','price':'.price','sku':'.sku'}
JSONLD='<script type="application/ld+json">'+json.dumps({'@type':'Product','name':'JSON product','image':{'url':'/1.jpg'},'offers':{'lowPrice':'2500','url':'/p/2'},'sku':'LD-2'})+'</script>'
DK={'data':{'products':[{'id':123,'title_fa':'کالای دیجی','url':{'uri':'/product/dkp-123/'},'status':'marketable','default_variant':{'price':{'selling_price':123400,'rrp_price':140000}},'images':{'main':{'url':['https://images.example/d.jpg']}}}], 'pager':{'current_page':1,'total_pages':1}}}
BSL={'data':[{'id':456,'title':'کالای باسلام','primary_price':120000,'inventory':4,'status':{'value':2976},'photo':{'large':'https://images.example/b.jpg'},'description':'<p>شرح</p>'}], 'next_cursor':0}


@pytest.fixture
def network(monkeypatch):
    calls=[]
    def get(url,**kw):
        calls.append((url,kw))
        if 'api.digikala.com' in url: body=json.dumps(DK)
        elif '/v3/vendors?' in url: body=json.dumps({'data':[{'id':7,'identifier':'sample'}]})
        elif 'core.basalam.com' in url: body=json.dumps(BSL)
        elif url.startswith('https://r.jina.ai/'): body='[کتاب Reader](https://example.com/product/reader)\n۳۰۰۰ تومان\n'
        else: body=HTML+JSONLD
        return {'ok':True,'code':200,'url':url,'html':body}
    monkeypatch.setattr(engines.HtmlFetcher,'get',get)
    monkeypatch.setattr(engines.SmartFetcher,'get',get)
    monkeypatch.setattr(engines.RenderedFetcher,'get',lambda url,opts,**kw: {'ok':True,'code':200,'url':url,'html':HTML+JSONLD,'driver':opts['driver']})
    # No live network in fixture tests; public/private validation has separate tests.
    original=engines.validate_url
    monkeypatch.setattr(engines,'validate_url',lambda url,**kw:original(url))
    from scraper4.services.scraping import snappshop_api
    monkeypatch.setattr(snappshop_api,'request_json',lambda endpoint,*a,**kw:{'data':{'token':'fixture-guest'}} if endpoint=='guest/v2/token' else {'data':{'items':[{'href':'/product/snp-1','title':'Fixture Snapp','price':12000}],'pagination':{'total_pages':1}}})
    return calls


@pytest.mark.parametrize('engine',list(engines.ENGINES))
def test_each_php_engine_executes_fetch_parse_and_real_queue_to_completion(db,settings,network,engine):
    url='https://snappshop.ir/search/?q=phone' if engine=='snappshop_api' else 'https://www.digikala.com/search/category-mobile/' if engine=='digikala_api' else 'https://basalam.com/vendor/7' if engine=='basalam_api' else 'https://example.com/shop'
    p=db.upsert_profile(engine,url,selectors=SELECTORS,settings={'extractionEngine':engine})
    jid=db.enqueue('extract',p['id'],{'pages':1});result=tick(db,settings)
    assert result['ok'] and db.get_entry(jid)['status']=='done'
    rows=db.list_products(p['id']);assert rows and rows[0]['price_num']>0
    assert db.get_entry(jid)['counters']['engine']==engine
    if engine=='selectors': assert rows[0]['sku']=='SKU-1'
    if engine=='auto': assert rows[0]['sku']=='LD-2'  # JSON-LD precedes heuristic
    if engine=='digikala_api': assert rows[0]['price_num']==12340
    if engine=='basalam_api': assert rows[0]['price_num']==12000 and rows[0]['extra']['longDesc']=='<p>شرح</p>'
    assert db.get_config('woocommerce')=={} and db.get_config('basalam')=={}


def test_already_imported_php_engine_in_legacy_settings_is_used_without_reimport(db,settings,network):
    p=db.upsert_profile('old','https://basalam.com/sample',settings={'legacy_profile_settings':{'extractionEngine':'basalam_api'}})
    jid=db.enqueue('extract',p['id'],{'pages':5});tick(db,settings)
    assert db.get_entry(jid)['status']=='done' and db.count_products(p['id'])==1
    assert any('/v3/vendors?' in url for url,_ in network)


def test_basalam_cursor_checkpoint_continues_and_does_not_repeat_page_one(db,settings,network,monkeypatch):
    calls=[]
    def fetch(url,**kw):
        calls.append(url);second='cursor=88' in url
        body={**BSL,'data':[{**BSL['data'][0],'id':457 if second else 456}], 'next_cursor':0 if second else 88}
        return {'ok':True,'code':200,'url':url,'html':json.dumps(body)}
    monkeypatch.setattr(engines.HtmlFetcher,'get',fetch)
    p=db.upsert_profile('b','https://basalam.com/vendors/7',settings={'extractionEngine':'basalam_api'})
    jid=db.enqueue('extract',p['id'],{'pages':5})
    http_tick(db,settings);entry=db.get_entry(jid)
    assert entry['status']=='waiting' and 's4_bsl_cursor=88' in entry['payload']['_next_url']
    db.checkpoint_clear('cron:last')
    http_tick(db,settings)
    assert db.get_entry(jid)['status']=='done' and db.count_products(p['id'])==2 and len(calls)==2
    assert 'cursor=88' in calls[1] and 'vendor_ids=7' in calls[1]


@pytest.mark.parametrize('path,route',[
    ('/product/dkp-12/','v2/product/12/'),('/search/category-mobile/samsung/','v1/categories/mobile/brands/samsung/search/'),
    ('/brand/apple/','v1/brands/apple/'),('/seller/abc/','v1/sellers/abc/'),('/incredible-offers/','v1/incredible-offers/products/'),
    ('/promotion-center/','v1/promotion-center/products/'),('/search/?q=phone','v1/search/'),('/main/mobile/','v1/categories/mobile/search/')])
def test_digikala_route_mapping_matches_php_allowlist(path,route):
    result=engines.digikala_endpoint('https://www.digikala.com'+path)
    assert result.startswith('https://api.digikala.com/'+route)


def test_digikala_unmarketable_products_and_exceeded_pager_are_excluded(settings,network,monkeypatch):
    rows,pager=engines.digikala_rows({'data':{'products':[{**DK['data']['products'][0],'status':'out_of_stock'}]}})
    assert rows=={}
    assert engines.extract('https://digikala.com/search/?page=2',{},'digikala_api',settings)['products']=={}


@pytest.mark.parametrize('engine,url',[('basalam_api','https://evil.example/basalam.com'),('digikala_api','https://digikala.com.evil.example/search/'),('jina','http://127.0.0.1/'),('jina','https://r.jina.ai/http://localhost/')])
def test_external_api_and_reader_targets_are_not_arbitrary_ssrf(engine,url,settings,network):
    before=len(network)
    with pytest.raises(ValueError):engines.extract(url,{},engine,settings,probe=True)
    assert len(network)==before


def test_browser_engine_refuses_silent_static_or_wrong_driver_success(settings,network,monkeypatch):
    monkeypatch.setattr(engines.RenderedFetcher,'get',lambda *a,**kw:{'ok':True,'code':200,'html':HTML,'driver':'playwright'})
    with pytest.raises(ValueError,match='driver'):engines.extract('https://example.com',{},'selenium',settings)
    monkeypatch.setattr(engines.RenderedFetcher,'get',lambda *a,**kw:{'ok':False,'code':503})
    with pytest.raises(ValueError,match='selenium'):engines.extract('https://example.com',{},'selenium',settings)
    assert not network


def test_renderer_sends_real_selected_driver_and_rejects_private_target(settings,monkeypatch):
    from scraper4.services.scraping.render import RenderedFetcher
    settings.render.url='https://renderer.example';settings.render.token='render-private'
    monkeypatch.setattr('socket.getaddrinfo',lambda *a,**kw:[(2,1,6,'',('8.8.8.8',443))])
    response=Mock(status_code=200);response.json.return_value={'ok':True,'html':HTML,'driver':'selenium'}
    post=Mock(return_value=response);monkeypatch.setattr('requests.post',post)
    assert RenderedFetcher.get('https://example.com',{'driver':'selenium','timeout_ms':5000,'_deadline_seconds':8},settings)['driver']=='selenium'
    assert post.call_args.kwargs['json']['driver']=='selenium' and post.call_args.kwargs['allow_redirects'] is False
    assert post.call_args.kwargs['headers']['Authorization']=='Bearer render-private'
    assert not RenderedFetcher.get('http://127.0.0.1',{'driver':'selenium'},settings)['ok']
    assert post.call_count==1


def test_php_import_promotes_engine_and_imports_renderer_without_echoing_keys(db,settings):
    files={'profiles.json':{'shop':{'url':'https://basalam.com/sample','extractionEngine':'basalam_api'}},'connections.json':{'render':{'url':'https://renderer.example','token':'private-render','enabled':False}}}
    file={'app':'scraper','files':{name:{'b64':base64.b64encode(json.dumps(value).encode()).decode()} for name,value in files.items()}}
    data={'file':file,'sections':['profiles','render'],'mode':'merge','credentials':True}
    preview=transfer.preview(db,data,'test');transfer.apply(db,settings,{**data,'token':preview['token']},'test')
    assert engines.profile_engine(db.list_profiles()[0])=='basalam_api'
    assert db.get_config('render')['token']=='private-render' and 'private-render' not in json.dumps(preview)


def test_profile_api_engine_roundtrip_and_legacy_fallback(client,auth_headers,app):
    db=app.extensions['s4_db'];p=db.upsert_profile('old','https://example.com',settings={'legacy_profile_settings':{'extractionEngine':'dk-api'}})
    assert client.get('/api/profiles').json['profiles'][0]['extraction_engine']=='digikala_api'
    body={'key':'old','url':p['url'],'extractionEngine':'jsonld'}
    assert client.post('/api/profiles',json=body,headers=auth_headers).status_code==200
    assert engines.profile_engine(db.get_profile('old'))=='jsonld'
    assert client.post('/api/profiles',json={**body,'extractionEngine':'python-script'},headers=auth_headers).status_code==400


def test_probe_records_separate_quality_report_without_touching_products_queue_or_credentials(client,auth_headers,app,network):
    db=app.extensions['s4_db'];p=db.upsert_profile('shop','https://example.com',selectors=SELECTORS)
    job=db.enqueue('woo_send',p['id']);db.put_config('woocommerce',{'consumer_secret':'private-secret'})
    old=db.list_entries();result=client.post('/api/extraction/probe',json={'profile_id':p['id']},headers=auth_headers)
    assert result.status_code==200 and result.json['report']['status']=='passed'
    assert result.json['report']['priced']==1 and result.json['report']['products_changed'] is False
    assert db.count_products()==0 and db.list_entries()==old
    assert 'private-secret' not in result.text and len(client.get('/api/extraction/reports').json['reports'])==1


def test_probe_empty_and_upstream_failure_never_report_passed(client,auth_headers,app,network,monkeypatch):
    db=app.extensions['s4_db'];p=db.upsert_profile('shop','https://example.com')
    monkeypatch.setattr(engines.SmartFetcher,'get',lambda *a,**kw:{'ok':True,'html':'<html></html>','code':200})
    assert client.post('/api/extraction/probe',json={'profile_id':p['id']},headers=auth_headers).json['report']['status']=='empty'
    monkeypatch.setattr(engines.SmartFetcher,'get',lambda *a,**kw:{'ok':False,'error':'password=DO-NOT-ECHO','code':403})
    result=client.post('/api/extraction/probe',json={'profile_id':p['id']},headers=auth_headers)
    assert result.json['report']['status']=='failed' and 'DO-NOT-ECHO' not in result.text


def test_probe_browser_csrf_role_and_parameters_are_guarded(app,client,auth_headers):
    p=app.extensions['s4_db'].upsert_profile('p','https://example.com')
    assert app.test_client().post('/api/extraction/probe',json={'profile_id':p['id']}).status_code in (400,401)
    assert client.post('/api/extraction/probe',json={'profile_id':p['id']}).status_code==400
    for body in ({'url':'http://127.0.0.1'},{'profile_id':True},{'profile_id':p['id'],'command':'x'},{'profile_id':p['id'],'engine':'bad'}):
        assert client.post('/api/extraction/probe',json=body,headers=auth_headers).status_code==400


def test_two_stage_api_detail_uses_same_selected_engine_and_keeps_remote_ids(db,settings,network,monkeypatch):
    calls=[]
    def fetch(url,**kw):
        calls.append(url);body=BSL['data'][0] if '/v4/products/456' in url else BSL
        return {'ok':True,'code':200,'url':url,'html':json.dumps(body)}
    monkeypatch.setattr(engines.HtmlFetcher,'get',fetch)
    p=db.upsert_profile('api','https://basalam.com/vendors/7',settings={'extractionEngine':'basalam_api','detailSelectors':{'longDesc':'.description'}})
    jid=db.enqueue('extract',p['id'],{'pages':1});http_tick(db,settings)
    assert db.get_entry(jid)['payload']['_phase']=='detail'
    product=db.list_products(p['id'])[0];db.mark_product_target(product['id'],'woo',999)
    db.checkpoint_clear('cron:last');http_tick(db,settings)
    assert db.get_entry(jid)['status']=='done' and '/v4/products/456' in calls[-1]
    assert db.list_products(p['id'])[0]['extra']['longDesc']=='<p>شرح</p>' and db.list_products(p['id'])[0]['woo_id']==999


def test_jsonld_image_object_scalar_offer_and_empty_product_are_handled_safely(settings,network):
    rows,_=engines.parse(JSONLD,'https://example.com',{},'jsonld')
    row=next(iter(rows.values()));assert row['image']=='https://example.com/1.jpg' and row['price']=='2500 تومان' and row['sku']=='LD-2'
    assert engines.parse('<script type="application/ld+json">{"@type":"Product"}</script>','https://example.com',{},'jsonld')[0]=={}


@pytest.mark.parametrize('engine',[{},[],True,42])
def test_engine_parameter_requires_a_string_not_arbitrary_json(client,auth_headers,app,engine):
    p=app.extensions['s4_db'].upsert_profile('p','https://example.com')
    assert client.post('/api/extraction/probe',json={'profile_id':p['id'],'engine':engine},headers=auth_headers).status_code==400
    assert client.post('/api/profiles',json={'url':p['url'],'extractionEngine':engine},headers=auth_headers).status_code==400


def test_unrelated_legacy_metadata_does_not_crash_all_profile_listing(client,app):
    app.extensions['s4_db'].upsert_profile('p','https://example.com',settings={'legacy_profile_settings':'unsupported-old-metadata'})
    result=client.get('/api/profiles')
    assert result.status_code==200 and result.json['profiles'][0]['extraction_engine']=='selectors'


def test_basalam_real_php_photo_category_variant_shapes_and_digikala_array_filters():
    item={**BSL['data'][0],'photo':{'original':['https://images.example/original.jpg']},'category':{'title':'فرزند','parent':{'title':'والد'}},
          'variants':{'data':[{'id':9,'primary_price':125000,'inventory':2,'color':{'title':'آبی'},'properties':[{'property':{'title':'سایز'},'value':{'title':'L'}}]}]}}
    row=next(iter(engines.basalam_rows([item]).values()))
    assert row['image']=='https://images.example/original.jpg' and row['category']=='والد > فرزند'
    assert row['variations'][0]['price']==12500 and row['variations'][0]['attributes']=={'سایز':'L','رنگ':'آبی'}
    url=engines.digikala_endpoint('https://digikala.com/search/?brands[]=1&price[min]=1000&page=2')
    assert 'brands%5B%5D=1' in url and 'price%5Bmin%5D=1000' in url and 'page=2' in url
