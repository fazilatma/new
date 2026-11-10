import json
import time
from dataclasses import replace
from unittest.mock import MagicMock
import pytest
import requests
from scraper4.services.scraping import engines,snappshop_api
from scraper4.services.source_network import effective
from scraper4.services.engine import tick


def mock_transport(monkeypatch):
    response=MagicMock();response.__enter__.return_value=response;response.status_code=200;response.iter_content.return_value=[b'{"status":true,"data":{"items":[]}}']
    session=MagicMock();session.__enter__.return_value=session;session.request.return_value=response
    monkeypatch.setattr(snappshop_api.requests,'Session',lambda:session)
    monkeypatch.setattr(snappshop_api,'validate_url',lambda *a,**k:None)
    monkeypatch.setattr(snappshop_api.HtmlFetcher,'pace',lambda *a,**k:None)
    return session,response


def catalog():return {'status':True,'data':{'items':[{'href':'/product/snp-17/title','title':'fixture','price':2000}],'pagination':{'total_pages':5}}}


def test_snapp_public_api_does_not_require_guest_network_first(settings,monkeypatch):
    snappshop_api._GUEST.clear();calls=[]
    def request(ep,*a,**k):calls.append(ep);assert ep=='landing/v2';return catalog()
    monkeypatch.setattr(snappshop_api,'request_json',request)
    out=engines.extract('https://snappshop.ir/category/a',{},'selenium',settings)
    assert len(out['products'])==1 and calls==['landing/v2'] and 'page=2' in out['next_url']


def test_guest_refresh_only_on_401_bounded_retry_and_cache(settings,monkeypatch):
    snappshop_api._GUEST.clear();calls=[]
    def request(ep,method,settings,deadline,body=None,token=''):
        calls.append((ep,token))
        if ep=='guest/v2/token':return {'data':{'token':'PRIVATE-GUEST'}}
        if not token:raise engines.ExtractionFailure('auth',401)
        return catalog()
    monkeypatch.setattr(snappshop_api,'request_json',request)
    for _ in range(2):assert engines.extract('https://snappshop.ir/category/a',{},'auto',settings)['products']
    assert calls==[('landing/v2',''),('guest/v2/token',''),('landing/v2','PRIVATE-GUEST'),('landing/v2','PRIVATE-GUEST')]
    snappshop_api._GUEST.clear()


@pytest.mark.parametrize('code',[403,404,429,500])
def test_no_token_refresh_on_non_auth_failures(settings,monkeypatch,code):
    snappshop_api._GUEST.clear();calls=[]
    def request(ep,*a,**k):calls.append(ep);raise engines.ExtractionFailure('denied',code)
    monkeypatch.setattr(snappshop_api,'request_json',request)
    with pytest.raises(engines.ExtractionFailure):engines.extract('https://snappshop.ir/category/a',{},'auto',settings)
    assert calls==['landing/v2']


def test_transport_honors_configured_proxy_and_never_echoes_credentials(db,settings,monkeypatch):
    session,r=mock_transport(monkeypatch)
    db.put_config('source_network',{'mode':'proxy','proxy':'http://proxy.example:3128','proxy_auth':'u:PRIVATE-PASS'})
    settings=engines.for_installation(settings,db)
    snappshop_api.request_json('landing/v2','POST',settings,time.monotonic()+5,{'slug':'a'})
    kw=session.request.call_args.kwargs
    assert kw['proxies']=={'http':'http://u:PRIVATE-PASS@proxy.example:3128','https':'http://u:PRIVATE-PASS@proxy.example:3128'}
    assert kw['verify'] is True and kw['allow_redirects'] is False and kw['json']=={'slug':'a'}


@pytest.mark.parametrize('error,kind',[(requests.exceptions.ProxyError,'proxy'),(requests.exceptions.SSLError,'tls'),(requests.exceptions.ConnectTimeout,'connect_timeout'),(requests.exceptions.ReadTimeout,'read_timeout'),(requests.exceptions.ConnectionError,'connection')])
def test_snapp_safe_network_stage_diagnosis(settings,monkeypatch,error,kind):
    session,_=mock_transport(monkeypatch);session.request.side_effect=error('PRIVATE-TOKEN http://u:password@proxy.example')
    with pytest.raises(engines.ExtractionFailure) as exc:snappshop_api.request_json('landing/v2','POST',settings,time.monotonic()+5,{})
    assert exc.value.network_error==kind and exc.value.stage=='snappshop_listing'
    assert 'PRIVATE-TOKEN' not in str(exc.value) and 'password' not in str(exc.value)


def test_api_resume_uses_query_page_not_old_selector_or_path_pagination(db,settings,monkeypatch):
    calls=[]
    def request(ep,method,settings,deadline,body=None,token=''):calls.append(body['skip']);return catalog()
    monkeypatch.setattr(snappshop_api,'request_json',request)
    p=db.upsert_profile('old','https://snappshop.ir/category/mobile?sort=cheap',pagination={'type':'path_pattern','val':'~page~{page}'},settings={'extractionEngine':'jina'})
    j=db.enqueue('extract',p['id'],{'_page':4,'pages':4,'with_detail':False});tick(db,settings)
    assert calls==[3] and db.get_entry(j)['status']=='done'


def test_natural_ceiling_without_network_and_empty_middle_page_not_false_success(settings,monkeypatch):
    def no_request(*a,**kw):pytest.fail('ceiling cannot fetch')
    monkeypatch.setattr(snappshop_api,'request_json',no_request)
    assert engines.extract('https://snappshop.ir/category/a?page=501',{},'auto',settings)['last_page']
    monkeypatch.setattr(snappshop_api,'request_json',lambda *a,**k:{'data':{'items':[],'pagination':{'total_pages':10}}})
    with pytest.raises(engines.ExtractionFailure):engines.extract('https://snappshop.ir/category/a?page=2',{},'auto',settings)
    assert snappshop_api.rows({'data':{'items':[{'href':'/product/19/title','title':'sample','price':1}]}})[0]


def test_config_routes_mask_preserve_and_clear_secret_and_both_ui(client,app,auth_headers):
    r=client.post('/api/source-network/config',json={'mode':'proxy','proxy':'http://proxy.example:3128','proxy_auth':'user:PRIVATE-PASS'},headers=auth_headers)
    assert r.status_code==200 and 'PRIVATE-PASS' not in r.text and r.json['config']['proxy_auth_configured']
    r=client.post('/api/source-network/config',json={'proxy_auth':''},headers=auth_headers)
    assert app.extensions['s4_db'].get_config('source_network')['proxy_auth']=='user:PRIVATE-PASS'
    for path in ('/','/php-ui'):
        text=client.get(path).text;assert text.count('id="source-network-form"')==1 and 'source-network.js' in text and 'PRIVATE-PASS' not in text
    r=client.post('/api/source-network/config',json={'clear_proxy_auth':True},headers=auth_headers)
    assert not r.json['config']['proxy_auth_configured']


@pytest.mark.parametrize('body',[{'mode':'worker'},{'mode':'proxy'},{'proxy':'http://u:pass@proxy.example'},{'proxy':'http://127.0.0.1:3128'},{'gap_ms':True},{'hosts':'example.com/path'},{'tls':False}])
def test_invalid_source_config_never_persists(client,app,auth_headers,body):
    assert client.post('/api/source-network/config',json=body,headers=auth_headers).status_code==400
    assert not app.extensions['s4_db'].get_config('source_network')


def test_failure_probe_classifies_proxy_without_product_or_queue_mutation(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];p=db.upsert_profile('s','https://snappshop.ir/category/a')
    def denied(*a,**kw):raise engines.ExtractionFailure('safe',network_error='proxy',stage='snappshop_listing')
    monkeypatch.setattr(snappshop_api,'request_json',denied)
    r=client.post('/api/extraction/probe',json={'profile_id':p['id']},headers=auth_headers).json['report']
    assert r['network_error']=='proxy' and r['failure_stage']=='snappshop_listing' and r['status']=='failed'
    assert not db.list_entries() and db.count_products(p['id'])==0


def test_static_network_error_is_not_mislabelled_renderer(db,settings,monkeypatch):
    p=db.upsert_profile('p','https://example.com',settings={'extractionEngine':'heuristic'})
    monkeypatch.setattr(engines.SmartFetcher,'get',lambda *a,**k:{'ok':False,'code':0,'error_kind':'proxy'})
    j=db.enqueue('extract',p['id']);tick(db,settings)
    counts=db.get_entry(j)['counters'];assert counts['error_code']=='source_network' and counts['network_error']=='proxy'


def test_json_false_anonymous_response_can_obtain_guest_once(settings,monkeypatch):
    snappshop_api._GUEST.clear();calls=[]
    def request(ep,method,settings,deadline,body=None,token=''):
        calls.append(ep)
        if ep=='guest/v2/token':return {'data':{'token':'PRIVATE-GUEST'}}
        if not token:
            e=engines.ExtractionFailure('API status false',200);e.api_status_false=True;raise e
        return catalog()
    monkeypatch.setattr(snappshop_api,'request_json',request)
    assert engines.extract('https://snappshop.ir/category/a',{},'auto',settings)['products']
    assert calls==['landing/v2','guest/v2/token','landing/v2'];snappshop_api._GUEST.clear()


def test_cron_keeps_bounded_network_even_with_saved_large_gap(db,settings,monkeypatch):
    from scraper4.services.engine import http_tick
    db.put_config('source_network',{'gap_ms':10000,'fallback':True})
    p=db.upsert_profile('s','https://snappshop.ir/category/a');db.enqueue('extract',p['id'],{'pages':1,'with_detail':False})
    def request(ep,method,settings,deadline,body=None,token=''):
        assert settings.net.gap_ms<=500 and settings.net.fallback is False
        return catalog()
    monkeypatch.setattr(snappshop_api,'request_json',request)
    assert http_tick(db,settings)['ran']==1
