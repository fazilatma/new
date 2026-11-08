import json
import time

import pytest
from lxml import html

from scraper4.services.engine import http_tick, tick
from scraper4.services.scraping.detail import clean_html, merge_detail, normalize_selectors, parse_detail, sanitize_fragment


BASE='https://example.com/product/one'
PAGE='''<div id="short"><p onclick="evil()">Short <b>text</b></p></div>
<div id="description"><p class="red">Long <em>description</em> <a href="../info">info</a></p><script>bad()</script></div>
<table id="specs"><tr><th>Color</th><td>Blue</td></tr><tr><td>Size:</td><td>M</td><td>L</td></tr></table>
<div class="gallery"><img data-large_image="/full.jpg" src="/thumb.jpg"><img data-src="/two.jpg"><img src="/full.jpg"></div>
<span class="sku">SKU-1</span><span class="brand">Brand one</span>'''
SELECTORS={'shortDesc':'#short','longDesc':'#description','specs':'#specs','images':'.gallery img','sku':'.sku','brand':'.brand'}


def test_enabled_selector_contract_matches_php():
    assert normalize_selectors({'longDesc':{'enabled':False,'selector':'#bad'},'shortDesc':' .short ','images':{'selector':'.gallery img'}})=={'shortDesc':'.short','images':'.gallery img'}
    assert normalize_selectors({})=={}
    for value in ([],{'longDesc':2},{'weight':'.weight'},{'longDesc':{'enabled':'false','selector':'div'}}):
        with pytest.raises(ValueError): normalize_selectors(value)


def test_detail_html_gallery_specs_and_identity_fields():
    result=parse_detail(PAGE,BASE,SELECTORS)
    assert result['shortDesc']=='<p>Short <b>text</b></p>'
    assert '<em>description</em>' in result['longDesc']
    assert 'https://example.com/info' in result['longDesc']
    assert '<script' not in result['longDesc'] and 'class=' not in result['longDesc']
    assert result['images']==['https://example.com/full.jpg','https://example.com/two.jpg']
    assert result['sku']=='SKU-1' and result['brand']=='Brand one'
    assert result['specs_rows']==[{'k':'Color','v':'Blue'},{'k':'Size','v':'M ، L'}]
    assert '<table' in result['specs']


@pytest.mark.parametrize('attack',[
    '<script>alert(1)</script><iframe src="//evil.test"></iframe>',
    '<svg><a xlink:href="javascript:alert(1)">bad</a></svg>',
    '<form action="//evil.test"><input name="pass"></form>',
    '<math><mtext>bad</mtext></math><object data="x"></object>',
])
def test_dangerous_subtrees_never_survive(attack):
    assert sanitize_fragment(attack,BASE)==''


def test_html_attributes_urls_and_safe_structure():
    result=sanitize_fragment('<p id="x" style="color:red" onmouseover="x()">Hello <a href="java&#10;script:alert(1)">bad</a><img src="data:text/html,x" srcset="https://evil.test/x 1x" onerror="x()"><a href="/safe">OK</a></p>',BASE)
    assert '<p>Hello' in result and 'https://example.com/safe' in result
    assert not any(value in result for value in ('style=','id=','onmouseover','onerror','javascript:','data:','srcset='))
    assert 'http://127.0.0.1' not in sanitize_fragment('<img src="http://127.0.0.1/secret">',BASE)


def test_specs_definition_and_list_forms_dedupe_and_escape():
    result=parse_detail('<div id="specs"><dl><dt>Color</dt><dd>&lt;blue&gt;</dd></dl><ul><li>Size: M</li><li>Size: M</li></ul></div>',BASE,{'specs':'#specs'})
    assert result['specs_rows']==[{'k':'Color','v':'<blue>'},{'k':'Size','v':'M'}]
    assert '&lt;blue&gt;' in result['specs']


def test_empty_detail_and_shorter_gallery_preserve_previous():
    previous={'longDesc':'<p>old</p>','shortDesc':'short','brand':'B','images':['one','two','three'],'custom':'retained'}
    result=merge_detail(previous,{'longDesc':'','images':['new']})
    assert result['longDesc']=='<p>old</p>' and result['images']==previous['images']
    assert result['images_count']==3 and result['custom']=='retained'
    assert merge_detail(previous,{'images':['a','b','c','d']})['images']==['a','b','c','d']


def make_profile(db, selectors=None):
    return db.upsert_profile('shop','https://example.com/shop','Shop',{'container':'.product','title':'h2'},
                            {'type':'query_page','val':''},{'detailSelectors':selectors or {}})


def age_cron(db):
    state=db.checkpoint_read('cron:last');state['started_epoch']=time.time()-60
    db.checkpoint_write('cron:last',state)


def test_http_one_network_page_per_tick_then_detail_checkpoint(db,settings,monkeypatch):
    profile=make_profile(db,SELECTORS)
    # A stale product outside this listing must not be opened.
    db.upsert_product(profile['id'],'stale',{'title':'Old','link':'https://example.com/stale','extra':{'custom':True}})
    job=db.enqueue('extract',profile['id'],{'pages':1})
    calls=[]
    def fetch(url,**kwargs):
        calls.append((url,kwargs))
        content='<article class="product"><h2>One</h2><a href="/product/one">Link</a></article><article class="product"><h2>Two</h2><a href="/product/two">Link</a></article>' if url.endswith('/shop') else PAGE
        return {'ok':True,'url':url,'html':content}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fetch)
    assert http_tick(db,settings)['ran']==1
    entry=db.get_entry(job)
    assert entry['status']=='waiting' and entry['payload']['_phase']=='detail' and len(calls)==1
    assert entry['payload']['_detail_index']==0
    age_cron(db);http_tick(db,settings)
    assert len(calls)==2 and db.get_entry(job)['payload']['_detail_index']==1
    age_cron(db);http_tick(db,settings)
    assert len(calls)==3 and db.get_entry(job)['status']=='done'
    assert all(kw['timeout']==8 and kw['net']['fallback'] is False for _,kw in calls)
    assert not any(url.endswith('/stale') for url,_ in calls)
    enriched=[p for p in db.list_products(profile['id']) if p['key']!='stale']
    assert all(p['extra']['longDesc'] and p['sku']=='SKU-1' for p in enriched)
    assert db.get_entry(job)['counters']['detail_enriched']==2


def test_empty_selectors_do_not_fetch_product_pages(db,settings,monkeypatch):
    p=make_profile(db);jid=db.enqueue('extract',p['id'],{'pages':1});calls=[]
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda url,**kw:calls.append(url) or {'ok':True,'url':url,'html':'<div class="product"><h2>Name</h2><a href="/p">P</a></div>'})
    tick(db,settings)
    assert len(calls)==1 and db.get_entry(jid)['status']=='done'


def test_detail_failure_resumes_same_product_without_erasing_data(db,settings,monkeypatch):
    p=make_profile(db,{'longDesc':'#description'});jid=db.enqueue('extract',p['id'],{'pages':1});calls=[]
    def fetch(url,**kw):
        calls.append(url)
        if url.endswith('/shop'):return {'ok':True,'url':url,'html':'<div class="product"><h2>Name</h2><a href="/p">P</a></div>'}
        return {'ok':False,'error':'temporary detail failure'}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fetch)
    tick(db,settings)
    entry=db.get_entry(jid)
    assert entry['status']=='failed' and entry['payload']['_detail_index']==0
    product=db.list_products(p['id'])[0]
    with db.connect() as conn:
        conn.execute('UPDATE products SET woo_id=77,extra=? WHERE id=?',(json.dumps({'longDesc':'old','images':['a','b'],'custom':True}),product['id']))
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda url,**kw:{'ok':True,'url':url,'html':'<div>No description</div>'})
    db.update_entry(jid,status='waiting');tick(db,settings)
    saved=db.list_products(p['id'])[0]
    assert db.get_entry(jid)['status']=='done' and saved['woo_id']==77
    assert saved['key']==product['key'] and saved['extra']['longDesc']=='old' and saved['extra']['custom']
    assert saved['extra']['_detail_status']=='empty'


def test_interleaves_pages_with_detail_without_skipping_next_link(db,settings,monkeypatch):
    p=db.upsert_profile('next','https://example.com/shop','',{'container':'.product','title':'h2'},
        {'type':'next_selector','val':'a.next'},{'detailSelectors':{'longDesc':'#description'}})
    jid=db.enqueue('extract',p['id'],{'pages':3});calls=[]
    def fetch(url,**kw):
        calls.append(url)
        if '/product/' in url:return {'ok':True,'url':url,'html':PAGE}
        n=1 if url.endswith('/shop') else 2
        return {'ok':True,'url':url,'html':f'<div class="product"><h2>Item {n}</h2><a href="/product/{n}">P</a></div>'+('<a class="next" href="/page-two">Next</a>' if n==1 else '')}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',fetch)
    tick(db,settings)
    assert calls==['https://example.com/shop','https://example.com/product/1','https://example.com/page-two','https://example.com/product/2']
    assert db.get_entry(jid)['status']=='done'


def test_profile_api_preserves_unrelated_settings_and_allows_explicit_clear(app,client,auth_headers):
    db=app.extensions['s4_db'];p=make_profile(db,{'longDesc':'#description'})
    with db.connect() as conn:
        conn.execute('UPDATE profiles SET settings=? WHERE id=?',(json.dumps({'detailSelectors':{'longDesc':'#description'},'custom':'keep'}),p['id']))
    body={'key':'shop','url':'https://example.com/shop'}
    assert client.post('/api/profiles',json=body,headers=auth_headers).status_code==200
    assert db.get_profile(p['id'])['settings']['detailSelectors']
    body['detailSelectors']={}
    assert client.post('/api/profiles',json=body,headers=auth_headers).status_code==200
    assert db.get_profile(p['id'])['settings']=={'detailSelectors':{},'custom':'keep'}
    body['detailSelectors']={'longDesc':True}
    assert client.post('/api/profiles',json=body,headers=auth_headers).status_code==400


def test_enriched_woo_payload_has_safe_descriptions_gallery_and_simple_attributes(db,settings,monkeypatch):
    p=make_profile(db)
    db.upsert_product(p['id'],'p',{'title':'Name','price_num':100,'link':BASE,'image':'https://example.com/main.jpg',
        'extra':{'longDesc':'<p onclick="bad()">Description<script>evil()</script></p>','shortDesc':'<b>Short</b>',
                 'images':['https://example.com/main.jpg','https://example.com/gallery.jpg','http://127.0.0.1/private'],
                 'specs_rows':[{'k':'Color','v':'Blue'}]}})
    db.put_config('woocommerce',{'store_url':'https://example.com','consumer_key':'key','consumer_secret':'secret'})
    bodies=[]
    monkeypatch.setattr('scraper4.services.engine.WooClient.create_product',lambda self,body:bodies.append(body) or {'ok':True,'body':{'id':7}})
    jid=db.enqueue('woo_send',p['id']);tick(db,settings)
    assert db.get_entry(jid)['status']=='done'
    body=bodies[0]
    assert body['description']=='<p>Description</p>' and body['short_description']=='<b>Short</b>'
    assert len(body['images'])==2
    assert body['attributes'][0]['variation'] is False and body['type']=='simple'


def test_listing_refresh_keeps_enriched_sku_gallery_and_remote_identity(db,settings,monkeypatch):
    p=make_profile(db)
    listing='<div class="product"><h2>Name</h2><a href="/p">P</a></div>'
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get',lambda url,**kw:{'ok':True,'url':url,'html':listing})
    db.enqueue('extract',p['id'],{'pages':1});tick(db,settings)
    product=db.list_products(p['id'])[0]
    with db.connect() as conn:
        conn.execute('UPDATE products SET sku=?,woo_id=?,extra=? WHERE id=?',('DETAIL-SKU',77,json.dumps({'images':['one','two'],'longDesc':'old'}),product['id']))
    db.enqueue('extract',p['id'],{'pages':1});tick(db,settings)
    saved=db.list_products(p['id'])[0]
    assert saved['id']==product['id'] and saved['sku']=='DETAIL-SKU' and saved['woo_id']==77
    assert saved['extra']['images']==['one','two'] and saved['extra']['longDesc']=='old'


def test_legacy_import_maps_supported_detail_fields_only(db,tmp_path):
    from scraper4.__main__ import import_legacy
    (tmp_path/'profiles.json').write_text(json.dumps({'old':{'url':'https://example.com/shop','detailSelectors':{'longDesc':'#description','weight':'.weight'}}}))
    import_legacy(db,tmp_path)
    settings=db.get_profile('old')['settings']
    assert settings['detailSelectors']=={'longDesc':'#description'}
    assert settings['legacy_detailSelectors']['weight']=='.weight'


def test_basalam_enriched_description_is_plain_text(db,settings,monkeypatch):
    p=make_profile(db)
    db.upsert_product(p['id'],'p',{'title':'Name','price_num':100,'extra':{'longDesc':'<p>Long <b>text</b></p><script>bad()</script>'}})
    db.put_config('basalam',{'token':'test-private','vendor_id':'1'})
    bodies=[]
    monkeypatch.setattr('scraper4.services.engine.BasalamClient.create_product',lambda self,vendor,body:bodies.append(body) or {'ok':True,'body':{'id':7}})
    jid=db.enqueue('bsl_send',p['id']);tick(db,settings)
    assert db.get_entry(jid)['status']=='done'
    assert bodies[0]['description']=='Long text'


def test_summary_view_keeps_long_html_out_of_grid_but_full_export_retains_it(app,client):
    db=app.extensions['s4_db'];p=make_profile(db)
    db.upsert_product(p['id'],'p',{'title':'Name','extra':{'longDesc':'<p>Long text</p>','_detail_preview':'Long text','brand':'B'}})
    summary=client.get('/api/products?summary=1').json['products'][0]['extra']
    assert summary=={'_detail_preview':'Long text','brand':'B'}
    assert client.get('/api/products').json['products'][0]['extra']['longDesc']=='<p>Long text</p>'
    assert 'longDesc' in client.get(f'/api/export/{p["id"]}?format=json').text


def test_large_description_is_bounded_without_cutting_html_attributes():
    result=sanitize_fragment('<p title="safe">'+('x'*60000)+'</p>',BASE)
    root=html.fragment_fromstring(result,create_parent='div')
    assert len(result)<30000 and result.endswith('</p>')
    assert len(root.xpath('.//p'))==1
