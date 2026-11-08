import json
from pathlib import Path

import pytest
from scraper4.services.scraping.pagination import build
from scraper4.services.scraping.css_to_xpath import css_to_xpath
from scraper4.services.scraping.parser import parse_products
from scraper4.services.scraping.smart_fetch import SmartFetcher, looks_like_js_shell
from scraper4.services.support.crypto import seal, unseal
from scraper4.services.support.persian import price_num
from scraper4.services.scraping.fetch import validate_url


@pytest.mark.parametrize('css,strict,expected', json.loads(Path(__file__).with_name('css_contract.json').read_text()))
def test_css_contract(css, strict, expected):
    assert css_to_xpath(css, strict) == expected


@pytest.mark.parametrize('path,page,kind,val,expected', [
 ('/shop',2,'path_pattern','~page~{page}','/shop~page~2'),
 ('/shop~page~2',3,'path_pattern','~page~{page}','/shop~page~3'),
 ('/cat~p~4',5,'path_pattern','~p~{page}','/cat~p~5'),
 ('/cat-page-4',5,'path_pattern','-page-{page}','/cat-page-5'),
 ('/shop~page~2.html',4,'path_pattern','~page~{page}.html','/shop~page~4.html'),
 ('/shop/page/2/',3,'path_pattern','/page/{page}/','/shop/page/3/'),
 ('/shop',2,'path_pattern','/page/{page}/','/shop/page/2/'),
 ('/',2,'path_pattern','~page~{page}','/~page~2'),
 ('/shop',7,'full_pattern','https://t.test/shop~page~{page}','/shop~page~7'),
 ('/shop~PAGE~8',9,'path_pattern','~page~{page}','/shop~page~9'),
 ('/shop/page/9',13,'path_pattern','~page~{page}','/shop~page~13'),
 ('/shop~pro~3',4,'path_pattern','~p~{page}','/shop~pro~3~p~4'),
 ('/search/?page=1',3,'query_custom','page','/search/?page=3'),
 ('/shop/',4,'query_custom','','/shop/?paged=4'),
 ('/shop/',5,'query_page','','/shop/?page=5'),
])
def test_pagination_contract(path,page,kind,val,expected):
    url = 'https://t.test' + path
    assert build(url,url,page,kind,val) == 'https://t.test' + expected


def test_fernet():
    value = {'token':'رمز'}
    ciphertext = seal(value,'secret')
    assert 'رمز' not in ciphertext
    assert unseal(ciphertext, 'secret') == value
    with pytest.raises(ValueError):
        unseal(ciphertext, 'wrong')


def test_price():
    assert price_num('۱۲۳٬۴۵۶ تومان') == 123456


def test_selectors_and_jsonld():
    html = '<div class="product"><h2>محصول تست</h2><span class="price">۱۲۳٬۴۵۶ تومان</span><a href="/p/1">خرید</a><img src="/a.jpg"></div>'
    result = parse_products(html, 'https://example.com/shop', {'container':'.product','title':'h2','price':'.price','link':'a','image':'img'})
    assert len(result) == 1
    row = next(iter(result.values()))
    assert row['title'] == 'محصول تست'
    assert row['link'] == 'https://example.com/p/1'
    html = '<script type="application/ld+json">{"@type":"Product","name":"Test product","url":"/p/2","offers":{"price":"1000"}}</script>'
    assert len(parse_products(html,'https://example.com/shop')) == 1


@pytest.mark.parametrize('url', ['file:///etc/passwd','http://localhost/','http://127.0.0.1/','http://[::1]/','ftp://example.com','https://user:password@example.com','http://169.254.169.254/'])
def test_reject_unsafe_urls(url):
    with pytest.raises(ValueError):
        validate_url(url)


def test_smart_fetcher(settings):
    html = '<div id="root"></div><script>' + 'x'*1600 + '</script>'
    assert looks_like_js_shell(html)
    static = lambda u,t,n: {'ok':True,'html':html, 'mode':'direct'}
    render = lambda u,o: {'ok':False,'error':'not configured'}
    result = SmartFetcher.get('https://example.com',static_fetcher=static,render_fetcher=render,settings=settings)
    assert result['ok'] and result['render_error'] == 'not configured'


def test_env_last_assignment_and_environment_priority(tmp_path,monkeypatch):
    from scraper4.config import load_env_file
    monkeypatch.delenv('TEST_S4_KEY', raising=False)
    monkeypatch.setenv('TEST_S4_EXTERNAL','outside')
    path=tmp_path/'.env'
    path.write_text('TEST_S4_KEY=\nTEST_S4_KEY=actual\nTEST_S4_EXTERNAL=inside\n')
    load_env_file(path)
    import os
    assert os.environ['TEST_S4_KEY']=='actual'
    assert os.environ['TEST_S4_EXTERNAL']=='outside'
