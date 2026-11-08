"""Local saved-record parity: actual HTTP queries, no destination/network calls."""
import json

import pytest
from bs4 import BeautifulSoup

from scraper4.services.product_browser import METRICS


@pytest.fixture
def catalog(app):
    db = app.extensions['s4_db']
    a = db.upsert_profile('a', 'https://example.com/a', 'فروشگاه یک')
    b = db.upsert_profile('b', 'https://example.com/b', 'فروشگاه دو', enabled=False)
    empty = db.upsert_profile('empty', 'https://example.com/empty', 'خالی')
    products = [
        (a, 'one', dict(title='كتاب ۱۲ آبی', price='100 تومان', price_num=100, image='https://example.com/a.jpg', sku='ABC', link='https://example.com/item/one')),
        (a, 'two', dict(title='50%_off', price_num=0, sku='SKU-2', link='https://example.com/item/two')),
        (b, 'three', dict(title='کیف\u200cدستی ٣', price='50 تومان', price_num=50, image='https://example.com/b.jpg')),
        (b, 'four', dict(title='Alpha', price_num=-1)),
    ]
    for profile, key, row in products:
        db.upsert_product(profile['id'], key, row)
    with db.connect() as conn:
        conn.execute("UPDATE products SET woo_id=44 WHERE key='one'")
        conn.execute("UPDATE products SET basalam_id=55 WHERE key='three'")
    return db, a, b, empty


def test_overview_and_clickthrough_use_identical_metrics(catalog, client):
    db, a, b, empty = catalog
    result = client.get('/api/products/overview').json
    assert result['source'] == 'local_saved_products'
    assert result['remote_inventory'] is False
    assert result['totals'] == dict(all=4, priced=2, no_price=2, with_image=2, linked=2,
                                    sku=2, woo_linked=1, bsl_linked=1, woo_missing=3, bsl_missing=3)
    profiles = {row['id']: row for row in result['by_profile']}
    assert profiles[empty['id']]['counts'] == {key: 0 for key in METRICS}
    assert profiles[b['id']]['enabled'] == 0
    for key in METRICS:
        listing = client.get('/api/products', query_string={'filter': key}).json
        assert listing['total'] == result['totals'][key]
        assert len(listing['products']) == listing['total']
        for profile in profiles.values():
            listing = client.get('/api/products', query_string={'filter': key, 'profile_id': profile['id']}).json
            assert listing['total'] == profile['counts'][key]
            assert all(row['profile_id'] == profile['id'] for row in listing['products'])
    # Counts must not trust the cached profiles.products_count.
    with db.connect() as conn:
        conn.execute('UPDATE profiles SET products_count=9999')
    assert client.get('/api/products/overview').json['totals']['all'] == 4


@pytest.mark.parametrize(('query', 'expected'), [('کتاب 12', ['one']), ('کیف دستی ۳', ['three']),
    ('abc', ['one']), ('item/TWO', ['two']), ('%_', ['two']), ("' OR 1=1 --", []), ('_', ['two'])])
def test_literal_normalized_search(catalog, client, query, expected):
    result = client.get('/api/products', query_string={'q': query}).json
    assert [row['key'] for row in result['products']] == expected
    assert result['total'] == len(expected)


def test_search_sort_pagination_across_entire_dataset(catalog, client):
    db, a, *_ = catalog
    for index in range(105):
        db.upsert_product(a['id'], 'bulk-' + str(index), {'title': f'bulk {index}', 'price_num': index})
    found = client.get('/api/products?q=bulk+104&limit=100').json
    assert found['total'] == 1 and found['products'][0]['key'] == 'bulk-104'
    query = {'q': 'bulk', 'profile_id': a['id'], 'filter': 'priced', 'sort': 'price_desc', 'limit': 20}
    seen = []
    for offset in range(0, 104, 20):
        result = client.get('/api/products', query_string={**query, 'offset': offset}).json
        assert result['total'] == 104
        seen += [row['price_num'] for row in result['products']]
    assert seen == list(range(104, 0, -1))
    clamped = client.get('/api/products', query_string={**query, 'offset': 99999}).json
    assert clamped['offset'] == 100 and len(clamped['products']) == 4
    empty = client.get('/api/products?q=nothing&offset=999').json
    assert empty['offset'] == 0 and empty['total'] == 0


@pytest.mark.parametrize(('sort', 'expected'), [('oldest', ['one', 'two', 'three', 'four']),
    ('newest', ['four', 'three', 'two', 'one']), ('price_asc', ['four', 'two', 'three', 'one']),
    ('price_desc', ['one', 'three', 'two', 'four']), ('title', ['two', 'four', 'one', 'three'])])
def test_sort_allowlist(catalog, client, sort, expected):
    assert [row['key'] for row in client.get('/api/products', query_string={'sort': sort}).json['products']] == expected


@pytest.mark.parametrize('query', ['filter=bad', 'sort=price;DROP+TABLE+products', 'profile_id=0',
    'profile_id=-1', 'profile_id=no', 'offset=-1', 'offset=2147483648', 'limit=0', 'limit=501',
    'limit=1.5', 'offset=1e2', 'q=' + 'a' * 201])
def test_bad_arguments_are_400_not_sql_or_500(client, query):
    result = client.get('/api/products?' + query)
    assert result.status_code == 400 and result.json['ok'] is False


def test_details_are_sanitized_bounded_and_do_not_echo_raw_extra(catalog, client):
    db, a, *_ = catalog
    data = dict(longDesc='<p>Long <b>description</b></p><script>evil()</script><iframe src="https://example.com"></iframe>',
                shortDesc='<img src=x onerror=evil()>Short', brand='Brand', category='کتاب', tags='tag one',
                images=['/a.jpg', 'javascript:evil()', 'https://user:pass@example.com/a.jpg', 'http://example.com/b.jpg',
                        'https://127.0.0.1/a.jpg', None, 'https://example.com/a.jpg'],
                specs_rows=[{'k': 'رنگ', 'v': '<b>آبی</b>'}, {'wrong': 'shape'}], private_token='DO-NOT-ECHO')
    db.upsert_product(a['id'], 'detail', {'title': 'Name', 'link': 'https://example.com/item',
        'image': 'https://example.com/a.jpg', 'extra': data})
    row = db.list_products(a['id'])[-1]
    response = client.get(f"/api/products/{row['id']}")
    assert response.status_code == 200
    value = response.json
    assert value['details']['images'] == ['https://example.com/a.jpg']
    assert value['details']['longDesc_text'] == 'Long description'
    assert value['details']['shortDesc_text'] == 'Short'
    assert value['details']['specs'] == [{'k': 'رنگ', 'v': '<b>آبی</b>'}]
    assert 'extra' not in value['product'] and 'DO-NOT-ECHO' not in response.text
    assert value['product']['profile_name'] == a['name']
    assert value['details']['category'] == 'کتاب'
    data.update(images=[f'https://example.com/{i}.jpg' for i in range(60)], longDesc='x'*150000,
                specs_rows=[{'k':'x'*500,'v':'y'*5000}]*150)
    db.upsert_product(a['id'], 'detail', {'extra': data})
    value = client.get(f"/api/products/{row['id']}").json['details']
    assert len(value['images']) == 30 and len(value['longDesc_text']) <= 30000
    assert len(value['specs']) == 100 and len(value['specs'][0]['k']) == 120 and len(value['specs'][0]['v']) == 2000


@pytest.mark.parametrize('stored', ['{broken', '[]', 'null', '{"images":{},"longDesc":[],"specs_rows":[null]}'])
def test_malformed_stored_extra_does_not_break_browser(catalog, client, stored):
    db, *_ = catalog
    with db.connect() as conn:
        conn.execute('UPDATE products SET extra=?', (stored,))
    assert client.get('/api/products?summary=1').status_code == 200
    assert client.get('/api/products/1').status_code == 200


def test_all_reads_preserve_products_ids_credentials_and_queue(catalog, client, monkeypatch):
    db, a, *_ = catalog
    db.put_config('woocommerce', {'consumer_secret': 'private', 'consumer_key': 'key'})
    db.enqueue('woo_send', a['id'])
    import requests
    monkeypatch.setattr(requests.sessions.Session, 'request', lambda *args, **kwargs: pytest.fail('No outbound calls'))
    with db.connect() as conn:
        before = list(conn.iterdump())
    for url in ['/api/products', '/api/products?summary=1&q=کتاب', '/api/products/overview', '/api/products/1', '/api/products/99999']:
        assert client.get(url).status_code in (200, 404)
    with db.connect() as conn:
        assert list(conn.iterdump()) == before
    assert db.get_config('woocommerce')['consumer_secret'] == 'private'


def test_new_routes_require_existing_authentication(app, client):
    remote = app.test_client()
    for path in ['/api/products', '/api/products/overview', '/api/products/1']:
        assert remote.get(path).status_code == 401
    assert client.get('/api/products/999999').status_code == 404
    assert client.post('/api/products/1').status_code in (400, 403, 405)


def test_accessible_dashboard_has_real_controls_and_versioned_asset(client):
    html = BeautifulSoup(client.get('/').text, 'html.parser')
    assert html.select_one('#product-overview')
    assert html.select_one('#overview-profiles')
    assert html.select_one('#products-search')['maxlength'] == '200'
    assert {option['value'] for option in html.select('#products-filter option')} == set(METRICS)
    assert len(html.select('#products-sort option')) == 5
    dialog = html.select_one('dialog#product-detail')
    assert html.select_one('#' + dialog['aria-labelledby'])
    assert html.select_one('#' + dialog['aria-describedby'])
    assert html.select_one('script[src*="product-browser.js?v="]')
