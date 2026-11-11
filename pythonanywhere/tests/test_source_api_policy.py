"""The three requested source sites never use HTML or a browser renderer."""
import json
from dataclasses import replace
import pytest
from scraper4 import create_app
from scraper4.services.scraping import engines,snappshop_api
from scraper4.services.engine import tick

SNAPP={'data':{'structure':[{'section_type':'plp','items':[{'href':'/product/snp-123/title','title':'اسنپ','price':{'price':2000,'discounted_price':1500},'image':{'src':'https://cdn.snappshop.ir/a.jpg'}}],'pagination':{'total_pages':2}}]}}
DK={'data':{'products':[{'id':12,'title_fa':'دیجی','status':'marketable','default_variant':{'price':{'selling_price':20000}}}], 'pager':{'total_pages':1}}}
BS={'data':[{'id':13,'title':'باسلام','status':2976,'primary_price':30000}], 'next_cursor':0}


@pytest.fixture
def api(monkeypatch):
    calls=[]
    def html(url,**kwargs):
        calls.append(url)
        assert url.startswith(('https://api.digikala.com/','https://core.basalam.com/'))
        body=DK if 'digikala' in url else BS
        return {'ok':True,'code':200,'url':url,'html':json.dumps(body)}
    def snapp(ep,method,settings,deadline,body=None,token=''):
        calls.append((ep,method,body,token))
        return {'data':{'token':'PRIVATE-GUEST'}} if ep=='guest/v2/token' else SNAPP
    monkeypatch.setattr(engines.HtmlFetcher,'get',html);monkeypatch.setattr(snappshop_api,'request_json',snapp)
    monkeypatch.setattr(engines.SmartFetcher,'get',lambda *a,**k:pytest.fail('No source HTML fallback'))
    monkeypatch.setattr(engines.RenderedFetcher,'get',lambda *a,**k:pytest.fail('No renderer'))
    return calls


@pytest.mark.parametrize('url,expected',[('https://snappshop.ir/category/mobile','snappshop_api'),('https://www.digikala.com/search/','digikala_api'),('https://basalam.com/vendors/7','basalam_api')])
@pytest.mark.parametrize('old',['selenium','playwright','jina','selectors'])
def test_old_profile_override_extract_and_probe_all_use_api(settings,api,url,expected,old):
    app=create_app(replace(settings,access_mode='open',password=''));db=app.extensions['s4_db'];p=db.upsert_profile('old',url,settings={'extractionEngine':old});c=app.test_client()
    assert engines.profile_engine(p)==expected
    # Direct extraction and explicit probe overrides obey the same policy.
    assert engines.extract(url,{},old,settings)['engine']==expected
    r=c.post('/api/extraction/probe',json={'profile_id':p['id'],'engine':old});assert r.json['report']['engine']==expected and r.json['report']['status']=='passed'
    assert 'PRIVATE-GUEST' not in r.text
    j=db.enqueue('extract',p['id'],{'pages':1,'render':'js'});tick(db,settings)
    assert db.get_entry(j)['status']=='done' and db.get_entry(j)['counters']['engine']==expected and db.count_products(p['id'])==1
    caps=c.get('/api/profiles').json['profiles'][0];assert caps['extraction_engine']==expected
    r=c.post('/api/php-ui/read',json={'action':'sync_diagnose','query':{},'fields':{'profile':'old'}});assert r.json['profiles'][0]['ok']


def test_snapp_route_filter_and_toman_mapping(settings,api):
    r=engines.extract('https://snappshop.ir/category/mobile/samsung?page=2&is_available=true&brands[]=1&sort=cheap',{},'playwright',settings)
    body=api[-1][2];assert body['skip']==1 and body['slug_2']=='samsung' and body['page_type']=='category_brand' and body['brands']==['1']
    assert r['last_page'] and next(iter(r['products'].values()))['price']=='1500 تومان'
    assert 'PRIVATE-GUEST' not in json.dumps(r)


def test_snapp_detail_api_maps_description_without_css(settings,api,monkeypatch):
    def req(ep,*args,**kwargs):
        if ep=='guest/v2/token':return {'data':{'token':'PRIVATE-GUEST'}}
        assert ep=='products/v2/123'
        return {'data':{'content':{'title_fa':'محصول','description':'<p>شرح</p>'},'variants':[{'vendor':[{'stock':2,'price':1500,'special_price':1000}]}],'images':[{'src':'/image.jpg'}]}}
    monkeypatch.setattr(snappshop_api,'request_json',req)
    app=create_app(replace(settings,access_mode='open',password=''));db=app.extensions['s4_db'];p=db.upsert_profile('s','https://snappshop.ir/category/mobile',settings={'extractionEngine':'selenium'})
    db.upsert_product(p['id'],'one',{'title':'keep','price_num':999,'link':'https://snappshop.ir/product/snp-123'})
    c=app.test_client();r=c.post('/api/php-ui/write',json={'action':'python_detail_start','query':{},'fields':{'profile':'s'}})
    assert r.status_code==200 and r.json['job']['status']=='done'
    row=db.list_products(p['id'])[0];assert row['price_num']==999 and 'شرح' in row['extra']['longDesc']
    assert 'PRIVATE-GUEST' not in r.text


def test_snapp_unknown_route_and_lookalike_hosts_do_not_fallback(settings,api):
    with pytest.raises(ValueError):engines.extract('https://snappshop.ir/unsupported',{},'selenium',settings)
    for url in ('https://snappshop.ir.evil.test/category/a','https://notdigikala.com/search','https://basalam.com.evil.test'):
        assert engines.source_api(url) is None
    with pytest.raises(ValueError):snappshop_api.route('https://snappshop.ir/category/a?page=0')


def test_api_failure_never_turns_into_browser_or_static_success(settings,api,monkeypatch):
    def denied(*a,**k):raise engines.ExtractionFailure('دسترسی API ناموفق: HTTP 429',429)
    monkeypatch.setattr(snappshop_api,'request_json',denied)
    with pytest.raises(engines.ExtractionFailure) as exc:engines.extract('https://snappshop.ir/search/?q=x',{},'selenium',settings)
    assert exc.value.upstream_status==429


def test_css_preview_for_api_site_does_not_download_html(settings,api):
    from scraper4.services.selector_preview import preview
    value,status=preview({'mode':'list','url':'https://snappshop.ir/search/?q=x','selectors':{}},settings)
    assert status==200 and value['render']=='public_api' and value['total']==1 and value['fields']==[]


def test_snapp_transport_tls_bound_body_no_redirect_or_token_leak(settings,monkeypatch):
    import time
    from unittest.mock import MagicMock
    response=MagicMock();response.__enter__.return_value=response;response.status_code=302
    session=MagicMock();session.__enter__.return_value=session;session.request.return_value=response
    monkeypatch.setattr(snappshop_api.requests,'Session',lambda:session)
    monkeypatch.setattr(snappshop_api,'validate_url',lambda *a,**k:None)
    monkeypatch.setattr(snappshop_api.HtmlFetcher,'pace',lambda *a:None)
    with pytest.raises(engines.ExtractionFailure) as err:snappshop_api.request_json('search/v1','POST',settings,time.monotonic()+5,{'query':'x'},'PRIVATE-GUEST')
    kw=session.request.call_args.kwargs;assert kw['verify'] is True and kw['allow_redirects'] is False and kw['stream'] is True
    assert 'PRIVATE-GUEST' not in str(err.value)
    response.status_code=200;response.iter_content.return_value=[b'{"data":{"items":[]}}']
    assert snappshop_api.request_json('search/v1','POST',settings,time.monotonic()+5,{},'PRIVATE-GUEST')['data']['items']==[]


def test_probe_explains_requested_engine_is_not_effective_transport(settings,api):
    app=create_app(replace(settings,access_mode='open',password=''));db=app.extensions['s4_db']
    p=db.upsert_profile('snapp-policy','https://snappshop.ir/category/mobile')
    r=app.test_client().post('/api/extraction/probe',json={'profile_id':p['id'],'engine':'jina'}).json['report']
    assert r['requested_engine']=='jina' and r['engine']=='snappshop_api' and r['engine_policy']=='source_api_only'
