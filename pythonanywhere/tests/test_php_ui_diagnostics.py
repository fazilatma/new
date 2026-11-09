"""Normal authenticated exports, human login return, and honest PHP inventory."""
import hashlib
import json
import runpy
from pathlib import Path
import pytest
from scraper4.services import php_ui


def test_diagnostic_export_is_read_only_safe_and_downloadable(app,client):
    db=app.extensions['s4_db'];p=db.upsert_profile('private-key','https://private.example/path?token=PRIVATE','مانتو پاتریس',selectors={'container':'.product','title':'h2'},settings={'secret':'PRIVATE'})
    db.put_config('woocommerce',{'consumer_secret':'PRIVATE'});job=db.enqueue('extract',p['id'],status='failed');db.update_entry(job,error='PRIVATE',counters={'error_code':'source_access_denied','error_hint':'PRIVATE','last_http_status':403})
    with db.connect() as c:before=list(c.iterdump())
    r=client.get('/api/php-ui/diagnostic-export',query_string={'profile_id':p['id']})
    assert r.status_code==200 and 'attachment;' in r.headers['Content-Disposition'] and r.json['snapshot'] is True
    assert r.json['source_reachability_tested'] is False and r.json['processed'] is False
    assert r.json['profile']['name']=='مانتو پاتریس' and r.json['reason']=='existing_failed'
    assert all(value not in r.text for value in ('PRIVATE','private.example','private-key','consumer_secret','csrf'))
    with db.connect() as c:assert list(c.iterdump())==before
    assert client.get('/api/php-ui/diagnostic-export?profile_id=1&url=https://evil.example').status_code==400
    assert client.get('/api/php-ui/diagnostic-export?profile_id=999').status_code==404


@pytest.mark.parametrize('path',['/api/php-ui/diagnostic-export?profile_id=1','/api/php-ui/endpoint-inventory'])
def test_exports_do_not_make_private_apis_public_or_accept_bearer(app,path,client):
    remote=app.test_client();assert remote.get(path).status_code==401
    db=app.extensions['s4_db'];value='test-only-full-admin-bearer';db.put_config('api_auth',{'sha256':hashlib.sha256(value.encode()).hexdigest()})
    assert remote.get(path,headers={'Authorization':'Bearer '+value}).status_code==403
    assert client.get(path,headers={'Authorization':'Bearer '+value}).status_code==403


def test_human_api_report_link_logs_in_then_returns_to_original_report_without_api_401(app):
    c=app.test_client();r=c.get('/api/php-ui/start-report',query_string={'name':'مانتو پاتریس'},headers={'Accept':'text/html'})
    assert r.status_code==302 and r.headers['Location']=='/login'
    c.get('/login')
    with c.session_transaction() as s:csrf=s['csrf']
    r=c.post('/login',data={'password':'test-password','csrf':csrf})
    assert r.status_code==302 and r.headers['Location'].startswith('/php-ui?report=')
    assert c.get('/api/php-ui/start-report?name=missing',headers={'Accept':'text/html'}).status_code==302
    assert c.get('/api/php-ui/start-report?name=missing',headers={'Accept':'application/json'}).status_code==404


@pytest.mark.parametrize('bad',['https://evil.example','//evil.example','/php-ui.evil.example','/api/cron/run','/php-ui/../api/cron/run'])
def test_login_return_is_not_an_open_redirect_or_job_execution(app,bad):
    c=app.test_client();c.get('/login')
    with c.session_transaction() as s:s['after_login_php_ui']=bad;csrf=s['csrf']
    r=c.post('/login',data={'password':'test-password','csrf':csrf})
    assert r.headers['Location']=='/'


def test_inventory_is_pinned_lexical_not_a_fake_endpoint_implementation(client):
    r=client.get('/api/php-ui/endpoint-inventory');assert r.status_code==200
    d=r.json;i=d['inventory'];assert d['read_only'] and d['source_inventory_is_not_implementation']
    assert i['source_sha256']==php_ui.manifest()['source_sha256'] and i['source_commit']==php_ui.manifest()['source_commit']
    assert i['unique_keys']==len(i['entries'])==671 and i['references']==sum(e['references'] for e in i['entries'])==1690
    assert i['is_endpoint_count'] is False and i['full_php_parity'] is False and not d['connected']['full_php_parity']
    assert 'sync_diagnose' in d['connected']['read_actions']
    assert all(e['review_status']=='requires_semantic_handler_review' for e in i['entries'])


def test_inventory_generator_hash_guard_and_determinism():
    script=Path(__file__).resolve().parents[2]/'tools/inventory_php_requests.py';f=runpy.run_path(str(script))['inventory']
    raw=b"<?php if(isset($_GET['foo'])) echo $_POST['bar']; // $_GET['foo']\n"
    manifest={'source_sha256':hashlib.sha256(raw).hexdigest(),'source_commit':'a'*40,'source_version':'test'}
    d=f(raw,manifest);assert d['unique_keys']==2 and d['references']==3 and d==f(raw,manifest)
    with pytest.raises(ValueError):f(raw+b'changed',manifest)


def test_sync_diagnose_reads_actual_configuration_without_extraction(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];p=db.upsert_profile('one','https://example.com','Name',selectors={})
    monkeypatch.setattr('scraper4.services.scraping.fetch.HtmlFetcher.get',lambda *a,**kw:pytest.fail('diagnose must not fetch'))
    with db.connect() as c:before=list(c.iterdump())
    r=client.post('/api/php-ui/read',json={'action':'sync_diagnose','query':{},'fields':{'profile':'one'}},headers=auth_headers)
    assert r.status_code==200 and r.json['profiles'][0]['ok'] is False and r.json['profiles'][0]['id']==p['id']
    assert r.json['read_only'] and not r.json['processed'] and not r.json['source_reachability_tested']
    with db.connect() as c:assert list(c.iterdump())==before


def test_diagnose_renderer_requirements_respect_product_source(app):
    from scraper4.services.php_ui_start import diagnose
    db=app.extensions['s4_db'];db.upsert_profile('browser','https://example.com','Browser',settings={'extractionEngine':'playwright'})
    db.upsert_profile('file','https://example.com','File',settings={'extractionEngine':'playwright','productSource':'github'})
    assert not diagnose(db,app.extensions['s4_settings'],'browser')['profiles'][0]['ok']
    assert diagnose(db,app.extensions['s4_settings'],'file')['profiles'][0]['ok']
    db.put_config('render',{'url':'https://private-render.example/?token=PRIVATE','token':'PRIVATE'})
    result=diagnose(db,app.extensions['s4_settings'],'browser');assert result['profiles'][0]['ok']
    assert 'PRIVATE' not in json.dumps(result)
