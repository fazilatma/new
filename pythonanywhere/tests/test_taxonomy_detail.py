"""PHP 10.641 s4ExtractDetailNodeValue/category,tags + extractMergeDetail.

First-node text contract only, not destination taxonomy resolution.
"""
import json
import time

import pytest

from scraper4.services.engine import http_tick, tick
from scraper4.services.scraping.detail import merge_detail, normalize_selectors, parse_detail


@pytest.mark.parametrize('field', ['category', 'tags'])
def test_taxonomy_selectors_take_first_node_text_without_specs_conversion(field):
    page = '<div class="terms"><table><tr><th>A</th><td>B</td></tr><tr><th>C</th><td>D</td></tr></table></div><div class="terms">Ignored</div>'
    result = parse_detail(page, 'https://example.com/p', {field: '.terms'})
    assert result == {field: 'ABCD'}
    assert parse_detail('<a class="term"> کتاب &amp; <b>خانه</b> </a><a class="term">دوم</a>',
                        'https://example.com/p', {field: '.term'}) == {field: 'کتاب & خانه'}
    assert parse_detail(page, 'https://example.com/p', {field: {'enabled': False, 'selector': '.terms'}}) == {}
    assert normalize_selectors({field: ' .terms '}) == {field: '.terms'}
    assert len(parse_detail('<p>' + 'x' * 2000 + '</p>', 'https://example.com/p', {field: 'p'})[field]) == 1000


def test_empty_taxonomy_results_preserve_previous_terms_and_unrelated_extras():
    previous = {'category': 'کتاب', 'tags': 'خانه، هنر', 'custom': {'keep': True}}
    merged = merge_detail(previous, {'category': '', 'tags': ''})
    assert all(merged[k] == v for k, v in previous.items())
    assert merge_detail(previous, {'category': 'جدید', 'tags': 'نو'})['tags'] == 'نو'
    assert previous['tags'] == 'خانه، هنر'


def test_taxonomy_only_configuration_runs_one_detail_product_step_and_preserves_ids(db, settings, monkeypatch):
    profile = db.upsert_profile('shop', 'https://example.com/shop', '', {'container': '.product', 'title': 'h2'},
                                settings={'detailSelectors': {'category': '.category', 'tags': '.tags'}})
    db.upsert_product(profile['id'], 'existing', {'title': 'Old', 'link': 'https://example.com/p', 'price_num': 123})
    product = db.list_products(profile['id'])[0]
    # Use the real listing key instead of a custom key for the next fixture.
    from scraper4.services.scraping.parser import product_key
    key = product_key({'link': 'https://example.com/p', 'title': 'One'})
    with db.connect() as conn:
        conn.execute('UPDATE products SET key=?,woo_id=77,basalam_id=88 WHERE id=?', (key, product['id']))
    calls = []
    def fetch(url, **kwargs):
        calls.append(url)
        page = '<article class="product"><h2>One</h2><a href="/p">P</a></article>' if url.endswith('/shop') else '<span class="category">کتاب</span><span class="tags">هنر، خانه</span>'
        return {'ok': True, 'url': url, 'html': page}
    monkeypatch.setattr('scraper4.services.engine.SmartFetcher.get', fetch)
    jid = db.enqueue('extract', profile['id'], {'pages': 1})
    http_tick(db, settings)
    assert len(calls) == 1 and db.get_entry(jid)['payload']['_phase'] == 'detail'
    state = db.checkpoint_read('cron:last'); state['started_epoch'] = time.time() - 60
    db.checkpoint_write('cron:last', state)
    http_tick(db, settings)
    assert len(calls) == 2 and db.get_entry(jid)['status'] == 'done'
    saved = db.list_products(profile['id'])
    assert len(saved) == 1 and saved[0]['id'] == product['id']
    assert saved[0]['extra']['category'] == 'کتاب' and saved[0]['extra']['tags'] == 'هنر، خانه'
    assert saved[0]['woo_id'] == 77 and saved[0]['basalam_id'] == 88


def test_taxonomy_selectors_api_import_summary_and_export(app, client, auth_headers, tmp_path):
    from scraper4.__main__ import import_legacy
    db = app.extensions['s4_db']
    selectors = {'category': '.category', 'tags': '.tags'}
    response = client.post('/api/profiles', json={'key': 'shop', 'url': 'https://example.com/shop', 'detailSelectors': selectors}, headers=auth_headers)
    assert response.status_code == 200
    profile = db.get_profile('shop')
    assert profile['settings']['detailSelectors'] == selectors
    db.upsert_product(profile['id'], 'p', {'title': 'Name', 'extra': {'category': 'کتاب', 'tags': '<b>متن</b>'}})
    assert client.get('/api/products?summary=1').json['products'][0]['extra'] == {'category': 'کتاب', 'tags': '<b>متن</b>'}
    exported = client.get(f'/api/export/{profile["id"]}?format=json').json
    assert exported[0]['extra']['category'] == 'کتاب'
    (tmp_path / 'profiles.json').write_text(json.dumps({'legacy': {'url': 'https://example.com/shop', 'detailSelectors': {**selectors, 'weight': '.weight'}}}))
    import_legacy(db, tmp_path)
    imported = db.get_profile('legacy')['settings']
    assert imported['detailSelectors'] == selectors
    assert imported['legacy_detailSelectors']['weight'] == '.weight'


def test_source_taxonomy_text_is_not_guessed_as_woo_destination_ids(db, settings, monkeypatch):
    profile = db.upsert_profile('shop', 'https://example.com/shop')
    db.upsert_product(profile['id'], 'p', {'title': 'Name', 'price_num': 123,
        'extra': {'category': '999', 'tags': '111, 222'}})
    db.put_config('woocommerce', {'store_url': 'https://example.com', 'consumer_key': 'key', 'consumer_secret': 'secret'})
    bodies = []
    monkeypatch.setattr('scraper4.services.engine.WooClient.create_product', lambda self, body: bodies.append(body) or {'ok': True, 'body': {'id': 7}})
    jid = db.enqueue('woo_send', profile['id'], {'category_id': '42'})
    tick(db, settings)
    assert db.get_entry(jid)['status'] == 'done'
    assert bodies[0]['categories'] == [{'id': 42}] and 'tags' not in bodies[0]
