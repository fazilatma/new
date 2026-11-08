"""PHP selector-test parity; real parsers and HTTP guards, no live sites/DB writes."""
from pathlib import Path
from unittest.mock import Mock

import pytest
from bs4 import BeautifulSoup

from scraper4.services import selector_preview as service
from scraper4.services.scraping.fetch import HtmlFetcher

SOURCE = (Path(__file__).parent/'fixtures'/'selector_preview.html').read_text()
LIST = dict(container='.product',title='h2',price='.price',image='img',link='h2',sku='.sku')
DETAIL = dict(shortDesc='.short',longDesc='.desc',specs='.specs',images='.product img',brand='.brand',category='.none',tags='.empty')


@pytest.fixture
def upstream(monkeypatch):
    mock = Mock(return_value={'ok':True,'code':200,'url':'https://example.com/shop/page','html':SOURCE})
    monkeypatch.setattr(HtmlFetcher,'get',mock)
    return mock


def post(client, headers, **kwargs):
    return client.post('/api/selectors/preview',json={'mode':'list','url':'https://example.com/shop','selectors':LIST,**kwargs},headers=headers)


def test_list_test_uses_actual_parser_relative_links_and_document_counts(client, auth_headers, upstream):
    response = post(client,auth_headers)
    assert response.status_code == 200
    result = response.json
    assert result['persisted'] is False and result['render'] == 'static_direct'
    assert result['total'] == 2 and result['sample_limit'] == 8
    assert result['products'][0] == {'title':'کتاب اول','price':'۱۲۵٬۰۰۰ تومان','sku':'A','link':'https://example.com/shop/../p/1','image':'https://example.com/a.jpg'}
    fields = {row['field']:row for row in result['fields']}
    assert fields['title']['count'] == 2
    assert fields['link']['value'] == 'https://example.com/shop/../p/1'
    assert fields['price']['value'] == '۱۲۵٬۰۰۰ تومان'
    upstream.assert_called_once()
    args = upstream.call_args.kwargs
    assert args['timeout'] == 8 and args['net'] == {'mode':'direct','_deadline_seconds':8}


def test_detail_reports_missing_vs_empty_sanitized_text_and_gallery(client,auth_headers,upstream):
    result = post(client,auth_headers,mode='detail',selectors=DETAIL).json
    fields = {row['field']:row for row in result['fields']}
    assert fields['shortDesc']['value'] == 'خلاصه'
    assert fields['longDesc']['value'] == 'شرح کامل'
    assert 'رنگ' in fields['specs']['value'] and 'آبی' in fields['specs']['value']
    assert fields['images']['value'].splitlines() == ['https://example.com/a.jpg','https://example.com/b.jpg']
    assert fields['category']['status'] == 'missing' and fields['category']['count'] == 0
    assert fields['tags']['status'] == 'empty' and fields['tags']['count'] == 1
    assert result['products'] == [] and result['mode'] == 'detail'
    assert '<script' not in str(result) and 'onerror' not in str(result)


@pytest.mark.parametrize('selectors',[{}, {'title':'h2'}])
def test_automatic_mode_is_explicit_when_no_container(client,auth_headers,upstream,selectors):
    result = post(client,auth_headers,selectors=selectors).json
    assert result['automatic'] is True and result['total'] >= 1


def test_sample_and_field_values_are_bounded(client,auth_headers,upstream):
    upstream.return_value['html'] = '<body>'+''.join(f'<article class="product"><h2>{i}'+('x'*1600)+'</h2><a href="/p/'+str(i)+'">Link</a></article>' for i in range(12))+'</body>'
    result = post(client,auth_headers,selectors={'container':'.product','title':'h2','link':'a'}).json
    assert result['total'] == 12 and len(result['products']) == 8
    assert max(len(row['title']) for row in result['products']) <= 1500
    assert max(len(row['value']) for row in result['fields']) <= 1500


@pytest.mark.parametrize('changes',[
    {'mode':'bad'}, {'url':'file:///etc/passwd'}, {'url':'http://localhost'}, {'url':'https://127.0.0.1'},
    {'url':'http://169.254.169.254/latest'}, {'url':'https://[::1]/'}, {'url':'https://user:pass@example.com'},
    {'url':'https://example.com:444'}, {'url':'https://example.com\n/hello'}, {'url':42}, {'url':'x'*2049},
    {'selectors':[]}, {'selectors':{'bad':'div'}}, {'selectors':{'title':42}}, {'selectors':{'title':'x'*1001}},
    {'selectors':{'title':'div + span'}}, {'selectors':{'title':'div:has(span)'}},
    {'mode':'detail','selectors':{}}, {'mode':'detail','selectors':{'shortDesc':{'enabled':True,'selector':'p'}}},
    {'extra':'unexpected'},
])
def test_invalid_requests_never_fetch(client,auth_headers,upstream,changes):
    response = post(client,auth_headers,**changes)
    assert response.status_code == 400 and response.json['ok'] is False
    upstream.assert_not_called()


def test_failure_and_large_page_are_local_errors_without_upstream_secret_echo(client,auth_headers,upstream):
    upstream.return_value = {'ok':False,'code':403,'error':'SECRET proxy://user:password','html':'private body'}
    response = post(client,auth_headers)
    assert response.status_code == 502 and response.json['upstream_status'] == 403
    assert 'SECRET' not in response.text and 'password' not in response.text
    upstream.return_value = {'ok':True,'html':'a'*(service.MAX_PARSE_BYTES+1)}
    assert post(client,auth_headers).status_code == 413
    # The permit is released even on error.
    upstream.return_value = {'ok':True,'html':SOURCE}
    assert post(client,auth_headers).status_code == 200


def test_process_gate_prevents_overlapping_preview_fetches(client,auth_headers,upstream):
    assert service._GATE.acquire(blocking=False)
    try:
        assert post(client,auth_headers).status_code == 429
        upstream.assert_not_called()
    finally:
        service._GATE.release()
    assert post(client,auth_headers).status_code == 200


def test_reads_do_not_change_saved_profiles_products_ids_jobs_or_credentials(app,client,auth_headers,upstream):
    db = app.extensions['s4_db'];profile = db.upsert_profile('saved','https://example.com','Saved',selectors={'container':'.old'})
    db.upsert_product(profile['id'],'p',{'title':'old'})
    with db.connect() as conn: conn.execute('UPDATE products SET woo_id=12,basalam_id=34')
    db.enqueue('extract',profile['id']);db.put_config('woocommerce',{'consumer_secret':'keep-private'})
    with db.connect() as conn: before = list(conn.iterdump())
    assert post(client,auth_headers).status_code == 200
    assert post(client,auth_headers,mode='detail',selectors=DETAIL).status_code == 200
    with db.connect() as conn: assert list(conn.iterdump()) == before


def test_auth_csrf_and_post_only(app,client,auth_headers,upstream):
    remote = app.test_client()
    with remote.session_transaction() as session: session['csrf']='test'
    assert post(remote,{'X-CSRF-Token':'test'}).status_code == 401
    assert post(client,{}).status_code == 400
    assert client.get('/api/selectors/preview').status_code == 405
    cron = client.post('/api/cron/token',json={},headers=auth_headers).json['token']
    assert post(remote,{'Authorization':'Bearer '+cron}).status_code == 403
    upstream.assert_not_called()


def test_actual_fetch_path_rejects_private_dns_and_private_redirect(client,auth_headers,monkeypatch):
    import requests
    import socket
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a,**k:[(2,1,6,'',('127.0.0.1',443))])
    request = Mock(side_effect=AssertionError('Must block before request'))
    monkeypatch.setattr(requests.Session,'get',request)
    assert post(client,auth_headers).status_code == 502
    request.assert_not_called()
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a,**k:[(2,1,6,'',('93.184.216.34',443))])
    response = Mock(status_code=302,headers={'Location':'http://169.254.169.254/secret'})
    response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
    request.side_effect=None;request.return_value=response
    assert post(client,auth_headers).status_code == 502
    assert request.call_count == 1 and request.call_args.kwargs['verify'] is True
    assert request.call_args.kwargs['allow_redirects'] is False


def test_dashboard_has_explicit_non_submit_buttons_and_safe_unnamed_sample_input(client):
    page = BeautifulSoup(client.get('/').text,'html.parser')
    for mode in ('list','detail'):
        assert page.select_one('#selector-test-'+mode)['type'] == 'button'
    assert 'name' not in page.select_one('#selector-sample-url').attrs
    assert page.select_one('#selector-test-status')['role'] == 'status'
    assert page.select_one('script[src*="selector-preview.js?v="]')


@pytest.mark.parametrize('raw', ['{"@type":"Product","name":"Bad","offers":42}', '['*1200+'0'+']'*1200])
def test_malformed_upstream_product_structure_is_not_a_server_crash(client,auth_headers,upstream,raw):
    upstream.return_value['html'] = '<script type="application/ld+json">'+raw+'</script>'
    response=post(client,auth_headers,selectors={})
    # Scalar offers no longer crash parsing; a title-only Product is usable.
    assert response.status_code == (200 if raw.startswith('{') else 422)
    if response.status_code==200: assert response.json['products'][0]['price']==''
    upstream.return_value['html'] = SOURCE
    assert post(client,auth_headers).status_code == 200
