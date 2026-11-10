import json
import pytest
from scraper4.services.scraping import engines,snappshop_api


def test_coverage_is_scoped_families_not_handler_percentage(client):
    d=client.get('/api/operations/coverage').json
    assert d['total']==24 and d['counts']=={'connected':8,'partial':10,'pending':6}
    assert d['families_with_remaining_work']==16 and d['completion_percentage'] is None
    assert len({f['id'] for f in d['families']})==24 and not d['full_php_parity']


def test_safe_support_download_no_console_secrets_or_mutations(app,client):
    db=app.extensions['s4_db'];db.put_config('pythonanywhere',{'token':'PRIVATE-TOKEN'})
    db.checkpoint_write('agent-deploy:secret-nonce',{'state':'failed','error':'PRIVATE-PASSWORD','proof':'PRIVATE-PROOF','commit':'a'*40})
    db.checkpoint_write('maintenance:request',{'action':'update','status':'failed','error':'PRIVATE-PASSWORD'})
    with db.connect() as c:before=list(c.iterdump())
    r=client.get('/api/support/report?download=1');assert r.status_code==200 and 'attachment' in r.headers['Content-Disposition']
    assert 'PRIVATE' not in r.text and 'secret-nonce' not in r.text
    assert r.json['deployments'][0]['error_recorded'] and not r.json['queues_executed'] and not r.json['console_output_included']
    with db.connect() as c:assert before==list(c.iterdump())
    assert client.get('/api/support/report?path=.env').status_code==400


def test_report_not_public_in_protected_mode(app):
    assert app.test_client().get('/api/support/report').status_code==401


def test_both_templates_have_report_and_gallery_controls(client):
    for path in ('/','/php-ui'):
        text=client.get(path).text
        assert text.count('id="support-report-read"')==1 and text.count('id="shared-php-gallery"')==1
        assert 'support-report.js' in text and '/api/support/report?download=1' in text


def product(db,url,settings=None):
    p=db.upsert_profile('p','https://example.com/list',settings=settings or {})
    db.upsert_product(p['id'],'one',{'title':'keep','price_num':800,'link':url})
    return p


def test_gallery_saved_css_and_jsonld_nonpersisting(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];p=product(db,'https://example.com/p/1',{'detailSelectors':{'images':'.gallery img'}})
    def get(*a,**kw):return {'ok':True,'code':200,'url':'https://example.com/p/1','html':'<div class="gallery"><img src="/a.jpg"><img data-large_image="/b.jpg" src="/small.jpg"></div>'}
    monkeypatch.setattr(engines.SmartFetcher,'get',get)
    before=db.list_products(p['id']);r=client.post('/api/extraction/gallery-preview',json={'profile_id':p['id']},headers=auth_headers)
    assert r.status_code==200 and r.json['images']==['https://example.com/a.jpg','https://example.com/b.jpg']
    assert before==db.list_products(p['id']) and not db.list_entries()


def test_snapp_nested_gallery_and_no_renderer(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];p=product(db,'https://snappshop.ir/product/snp-11',{'extractionEngine':'selenium'})
    def req(ep,*a,**kw):
        assert ep=='products/v2/11'
        return {'data':{'content':{'title_fa':'sample','gallery':[{'image':{'original':'/a.jpg'}}]},'media':[{'large':'/b.jpg'},{'src':'javascript:bad'}], 'variants':[{'image':{'main':'/c.jpg'}}], 'page':{'extra_meta':[{'property':'og:image','content':'/d.jpg'}]}}}
    monkeypatch.setattr(snappshop_api,'request_json',req)
    monkeypatch.setattr(engines.RenderedFetcher,'get',lambda *a,**kw:pytest.fail('API only'))
    r=client.post('/api/extraction/gallery-preview',json={'profile_id':p['id']},headers=auth_headers)
    assert r.status_code==200 and r.json['count']==4 and r.json['engine']=='snappshop_api'
    assert r.json['images']==['https://cdn.snappshop.ir/'+c+'.jpg' for c in 'abcd']
    assert db.list_products(p['id'])[0]['price_num']==800 and not db.list_entries()


def test_gallery_failure_safe_and_arbitrary_url_rejected(app,client,auth_headers,monkeypatch):
    db=app.extensions['s4_db'];p=product(db,'https://snappshop.ir/product/snp-11')
    assert client.post('/api/extraction/gallery-preview',json={'profile_id':p['id'],'url':'https://example.com'},headers=auth_headers).status_code==400
    def fail(*a,**k):raise engines.ExtractionFailure('PRIVATE-TOKEN',403,network_error='proxy')
    monkeypatch.setattr(snappshop_api,'request_json',fail)
    r=client.post('/api/extraction/gallery-preview',json={'profile_id':p['id']},headers=auth_headers)
    assert r.status_code==502 and 'PRIVATE' not in r.text and r.json['network_error']=='proxy'
    assert client.get('/api/extraction/gallery-preview').status_code==405


def test_gallery_product_belongs_to_selected_profile(app,client,auth_headers):
    db=app.extensions['s4_db'];p=product(db,'https://example.com/p/1');other=db.upsert_profile('other','https://example.com/2')
    pid=db.list_products(p['id'])[0]['id']
    assert client.post('/api/extraction/gallery-preview',json={'profile_id':other['id'],'product_id':pid},headers=auth_headers).status_code==400
