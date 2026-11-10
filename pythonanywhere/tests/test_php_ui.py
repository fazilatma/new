import hashlib
import json
import re
from pathlib import Path
import pytest
from scraper4.services import php_ui


def request(client,headers,action,fields=None,query=None,revision=None,write=False):
    return client.post('/api/php-ui/'+('write' if write else 'read'),json={'action':action,'fields':fields or {},'query':query or {},'revision':revision},headers=headers)


def form(**kwargs):
    return {'url':'https://example.com/shop','name':'فروشگاه','extractionEngine':'selectors','pages':'2','pagType':'query_page','pagVal':'','selectors':json.dumps({'container':'.product','title':'h2'}),'detailSelectors':json.dumps({'longDesc':{'enabled':True,'selector':'.description'},'weight':{'enabled':False,'selector':''}}),'titleSuffix':'فروشگاه','priceMode':'percent','priceVal':'20','roundPrice':'1000','minPrice':'10000','useCustomCol':'0','productSource':'{"mode":"direct"}',**kwargs}


def test_original_ui_is_pinned_entire_client_not_a_redesign():
    raw=(php_ui.ROOT/'upstream/php-ui.html').read_bytes();m=php_ui.manifest()
    assert len(raw)==m['client_bytes'] and hashlib.sha256(raw).hexdigest()==m['client_sha256']
    assert m['source_commit']=='01e99bfefdea6f5ef73838e4393fc85e22c254b5'
    assert raw.startswith(b'<!DOCTYPE html>') and raw.rstrip().endswith(b'</html>')
    assert len(re.findall(rb'<\?(?:php|=).*?\?>',raw,re.S))==m['php_slot_count']==41
    assert b'function collectProfileData(' in raw and b'function backendExtractFor(' in raw
    assert raw.count(b'<script>')==3


def test_native_host_is_auth_only_opaque_sandbox_with_strict_parent_csp(client,app):
    c=app.test_client();assert c.get('/php-ui').status_code==302 and c.get('/php-ui/frame').status_code==302
    host=client.get('/php-ui');assert host.status_code==200
    assert 'sandbox="allow-scripts allow-modals"' in host.text and 'allow-same-origin' not in host.text
    csp=host.headers['Content-Security-Policy'];assert "script-src 'self'" in csp and 'unsafe-inline' not in csp
    assert 'localhost/php-ui/frame' in csp and "frame-src 'self'" not in csp
    frame=client.get('/php-ui/frame');assert frame.status_code==200
    csp=frame.headers['Content-Security-Policy'];assert "connect-src 'none'" in csp and 'sandbox allow-scripts allow-modals' in csp
    assert "script-src 'self'" not in csp and "font-src 'self'" not in csp and 'allow-same-origin' not in csp
    assert "form-action 'none'" in csp and "frame-src 'none'" in csp and 'img-src data:' in csp
    assert frame.headers['X-Frame-Options']=='SAMEORIGIN'
    assert '<?php' not in frame.text and '<?=' not in frame.text
    assert 'php-ui-attach.js' in frame.text and 'php-ui-frame.js' in frame.text
    assert client.get('/').headers['X-Frame-Options']=='DENY'
    assert client.get('/static/fonts/Sahel.woff2').headers['Access-Control-Allow-Origin']=='*'


def test_native_bootstrap_script_escapes_html_profile_names_and_omits_opaque_secrets(app,client):
    db=app.extensions['s4_db'];db.upsert_profile('x','https://example.com','</script><script>alert(1)</script>',settings={'token':'PRIVATE','legacy_profile_settings':{'password':'SECRET'}})
    text=client.get('/php-ui/frame').text
    assert '</script><script>alert(1)</script>' not in text and '\\u003c/script' in text
    assert 'PRIVATE' not in text and 'SECRET' not in text


def test_native_reads_are_csrf_browser_only_and_never_run_cron_or_queue(app,client,auth_headers):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com','اول');db.put_config('basalam',{'token':'SUPERSECRET','vendor_id':'7'})
    before=db.list_entries();assert client.post('/api/php-ui/read',json={'action':'app_ready'}).status_code==400
    for action in ('app_ready','start_product_stats','load_connections','extract_queue_status','whoami','python_capabilities'):
        response=request(client,auth_headers,action);assert response.status_code==200 and response.json['ok'] is True
        assert 'SUPERSECRET' not in response.text
    loaded=request(client,auth_headers,'load_profile',query={'load_profile':'one'}).json
    assert loaded['profile']['url']==p['url'] and loaded['revision']==php_ui.revision(p)
    assert db.list_entries()==before and db.checkpoint_read('cron:config')=={}


@pytest.mark.parametrize('action',['cron_run','internal_cron_feedback','internal_extract_feedback','manual_sync','save_connections','woo_backend','delete_profile'])
def test_unknown_and_unattached_actions_never_fake_success_or_write(app,client,auth_headers,action):
    db=app.extensions['s4_db']
    with db.connect() as c:before=list(c.iterdump())
    for write in (False,True):
        response=request(client,auth_headers,action,write=write);assert response.status_code==501 and response.json['unsupported']
    with db.connect() as c:assert list(c.iterdump())==before


def test_native_save_real_profile_options_selectors_atomic_and_preserves_raw_products_ids(app,client,auth_headers):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com/shop','اول',settings={'opaque':{'secret':'KEEP'}})
    db.upsert_product(p['id'],'a',{'title':'خام','price_num':1000})
    item=db.list_products(p['id'])[0];db.mark_product_target(item['id'],'woo',77);db.mark_product_target(item['id'],'basalam',88)
    p=db.get_profile(p['id']);raw=db.list_products(p['id'])
    response=request(client,auth_headers,'save_profile',fields=form(target_key='one'),revision=php_ui.revision(p),write=True)
    assert response.status_code==200 and response.json['products_changed'] is False
    after=db.get_profile(p['id']);assert after['settings']['opaque']=={'secret':'KEEP'}
    assert after['selectors']['container']=='.product' and after['settings']['detailSelectors']=={'longDesc':'.description'}
    assert after['settings']['profileOptions']['priceVal']==20 and db.list_products(p['id'])==raw
    assert php_ui.profile_options.price(after,1000)==1000 # nearest 1000 after +20%
    assert not db.list_entries()
    stale=request(client,auth_headers,'save_profile',fields=form(target_key='one'),revision=php_ui.revision(p),write=True)
    assert stale.status_code==400 and stale.json['error']=='stale_profile'


def test_new_native_profile_can_be_saved_and_enqueued_without_implicit_send_or_processing(app,client,auth_headers):
    db=app.extensions['s4_db'];saved=request(client,auth_headers,'save_profile',fields=form(),write=True)
    assert saved.status_code==200
    p=php_ui.find(db,saved.json['key']);result=request(client,auth_headers,'python_enqueue',fields={'profile':p['key'],'pages':'0'},write=True)
    assert result.status_code==200 and result.json['remote_send'] is False
    entry=db.get_entry(result.json['id']);assert entry['status']=='waiting' and entry['payload']['pages']==0 and entry['payload']['_send_after']==[]
    assert request(client,auth_headers,'python_enqueue',fields={'profile':p['key'],'pages':'0'},write=True).status_code==400
    assert len(db.list_entries())==1
    assert request(client,auth_headers,'save_profile',fields=form(target_key=p['key']),revision=php_ui.revision(p),write=True).status_code==400


@pytest.mark.parametrize('patch',[{'autosave':'1'},{'net_indirect':'1'},{'fullMode':'1'},{'products':'[["x",{"title":"overwrite"}]]'},{'allow_empty_products':'1'},{'bslFallbackCatIds':'[1]'},{'gallery':'{"mode":"pattern"}'},{'listImageEdit':'{"square_pct":12}'},{'detailSelectors':'{"price":{"enabled":true,"selector":".price"}}'},{'syncConfig':'{"enabled":true}'},{'priceVal':'nan'},{'pages':'1.5'}])
def test_native_rejects_unsupported_or_invalid_changes_without_partial_write(app,client,auth_headers,patch):
    db=app.extensions['s4_db']
    with db.connect() as c:before=list(c.iterdump())
    response=request(client,auth_headers,'save_profile',fields=form(**patch),write=True);assert response.status_code==400
    with db.connect() as c:assert list(c.iterdump())==before


def test_native_results_are_real_bounded_and_do_not_expose_profile_secrets(app,client,auth_headers):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com','اول',settings={'token':'TOPSECRET'})
    db.upsert_product(p['id'],'x',{'title':'کالا','price':'1000 تومان','price_num':1000,'image':'https://example.com/x.jpg'})
    response=request(client,auth_headers,'load_profile',query={'load_profile':'one'})
    assert response.json['profile']['products'][0][1]['title']=='کالا' and 'TOPSECRET' not in response.text
    stats=request(client,auth_headers,'start_product_stats').json
    assert stats['totals']['total']==1 and stats['totals']['with_image']==1 and stats['remote_inventory'] is False


def test_native_compatibility_rejects_bearer_authority_even_for_logged_in_browser(app,client,auth_headers):
    db=app.extensions['s4_db'];db.put_config('api_auth',{'sha256':hashlib.sha256(b'test-native-token').hexdigest()})
    for path in ('/php-ui','/php-ui/frame'):
        assert client.get(path,headers={'Authorization':'Bearer test-native-token'}).status_code==403
    headers={**auth_headers,'Authorization':'Bearer test-native-token'}
    assert request(client,headers,'app_ready').status_code==403
    assert request(client,headers,'save_profile',fields=form(),write=True).status_code==403
    assert not db.list_profiles()
