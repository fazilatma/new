"""Fixtures locked against the inspected PHP parse_products algorithm.

These are algorithm-contract tests, not claimed PHP/Python differential runs.
"""
import json
from scraper4.services.scraping.parser import parse_products


def test_books_grid_scores_cards_not_price_wrappers():
    html='<div class="row">'+''.join(f'''<article class="product_pod">
       <a href="catalogue/{i}.html"><img src="img/{i}.jpg" alt="Book {i}"></a>
       <h3><a href="catalogue/{i}.html" title="Book {i}">Book {i}</a></h3>
       <div class="product_price"><span class="price_color">۱۲۳٬۴۵۶ تومان</span></div>
       </article>''' for i in range(4))+'</div>'
    rows=list(parse_products(html,'https://example.com/').values())
    assert len(rows)==4
    assert rows[0]['title']=='Book 0'
    assert rows[0]['price']=='۱۲۳٬۴۵۶ تومان'
    assert rows[0]['link']=='https://example.com/catalogue/0.html'


def test_persian_detail_href_walk_finds_card_and_lazy_image():
    html='<div>'+''.join(f'''<section class="goods-box"><a href="/کالا/{i}"><span>بازدید</span></a>
      <h2>محصول شماره {i}</h2><img data-src="/images/{i}.jpg" src="placeholder.gif">
      <span>۲۵۰٬۰۰۰ تومان</span></section>''' for i in range(3))+'</div>'
    rows=list(parse_products(html,'https://example.com/shop').values())
    assert len(rows)==3
    assert rows[0]['image']=='https://example.com/images/0.jpg'
    assert rows[0]['title']=='محصول شماره 0'


def test_emalls_href_adds_cards_even_after_first_grid_wins():
    html=''.join(f'<li class="product"><a href="/product/{i}"><img alt="Product {i}" src="/{i}.jpg"></a></li>' for i in (1,2))
    html+='<section><a href="/item~id~3"><img alt="Later product" src="/3.jpg"></a><span>۱۲۳۴۵ تومان</span></section>'
    assert len(parse_products(html,'https://example.com'))==3


def test_multiple_links_on_one_card_do_not_duplicate_products():
    html='<section><h2>Example product</h2><a href="/p/1"><img src="/1.jpg"></a><a href="/p/1?tracking=x">خرید</a><span>۱۲۳۴۵ تومان</span></section>'
    assert len(parse_products(html,'https://example.com'))==1


def test_dom_precedes_stale_structured_data_as_in_php():
    html=''.join(f'<article class="product"><h2>Live item {i}</h2><a href="/p/{i}"><img src="/{i}.jpg"></a></article>' for i in (1,2))
    html+='<script type="application/ld+json">'+json.dumps({'@type':'Product','name':'Stale schema','url':'/p/stale'})+'</script>'
    titles={row['title'] for row in parse_products(html,'https://example.com').values()}
    assert titles=={'Live item 1','Live item 2'}


def test_jsonld_still_works_when_no_usable_dom_cards():
    html='<div class="product_price">۱۲۳۴۵ تومان</div><script type="application/ld+json">'+json.dumps({'@type':'product','name':'Structured item','url':'/p/1','offers':{'price':12345}})+'</script>'
    assert next(iter(parse_products(html,'https://example.com').values()))['title']=='Structured item'


def test_navigation_images_are_not_products():
    html='<nav><a href="/home"><img alt="Home" src="/home.jpg"></a><a href="/about"><img alt="About" src="/about.jpg"></a></nav>'
    assert parse_products(html,'https://example.com')=={}


def test_price_only_nodes_never_win_over_real_grid():
    html=''.join(f'<div class="product_price">۱۲۳۴۵ تومان</div>' for _ in range(20))
    html+=''.join(f'<article class="product"><h2>Product {i}</h2><a href="/p/{i}"><img src="/{i}.jpg"></a></article>' for i in range(3))
    assert len(parse_products(html,'https://example.com'))==3


import pytest
from scraper4.services.support.persian import price, price_num


@pytest.mark.parametrize('text,expected', [
    ('قیمت: ۱۲,۵۰۰ تومان تخفیف: ۱۰۰۰ تومان','۱۲,۵۰۰ تومان'),
    ('1,200,000 ریال','1,200,000 ریال'),
    ('فقط ۵۰۰,۰۰۰','۵۰۰,۰۰۰ تومان'),
    ('1250000','1250000 تومان'),
    ('بدون عدد',''),
    ('£51.77','£51.77'),
    ('$19.99','$19.99'),
    ('€9,99','€9,99'),
    ('51.77 GBP','51.77 GBP'),
    ('£10 £51.77','£51.77'),
    ('$1,299.50','$1,299.50'),
    ('۹۹٫۵۰ EUR','۹۹٫۵۰ EUR'),
    ('£0',''),
])
def test_latest_php_price_display_contract(text,expected):
    assert price(text)==expected


def test_price_num_remains_digits_only_not_currency_conversion():
    assert price_num('£51.77')==5177
    assert price_num('۱۲۳٬۴۵۶ تومان')==123456


def test_parity_status_honestly_reports_partial_scope(client):
    result=client.get('/api/port-status')
    assert result.status_code==200
    assert result.json['source']['version']=='10.640'
    assert result.json['full_php_parity'] is False
    assert result.json['pending']
