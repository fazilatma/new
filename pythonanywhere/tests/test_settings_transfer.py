import base64
import copy
import fcntl
import json

import pytest
from bs4 import BeautifulSoup

from scraper4.db import DB
from scraper4.config import Settings
from scraper4.services import settings_transfer as transfer
from scraper4.services.support.crypto import unseal

PASSWORD = 'backup-password-for-tests'


def bundle(sections):
    return {'format': transfer.FORMAT, 'schema': 1, 'sections': sections}


def profile(key='shop', **extra):
    return {'key': key, 'name': 'فروشگاه', 'url': 'https://example.com/shop', 'enabled': True,
            'selectors': {'title': 'h2'}, 'pagination': {'type': 'query_page', 'val': ''},
            'settings': {'detailSelectors': {'category': '.category'}, 'custom': {'old': 1}}, **extra}


def request_for(incoming, sections=None, **options):
    return {'file': transfer.encrypt(bundle(incoming), PASSWORD), 'password': PASSWORD,
            'sections': sections if sections is not None else list(incoming), 'mode': 'replace', 'credentials': True, **options}


def execute(db, settings, data):
    preview = transfer.preview(db, data, 'browser-session')
    return transfer.apply(db, settings, {**data, 'token': preview['token']}, 'browser-session')


def state(db):
    with db.connect() as conn:
        return transfer.snapshot(conn, db.secret_key)


def test_encrypted_export_randomized_authenticated_portable_and_hides_secrets():
    original = bundle({'basalam': {'token': 'private-do-not-echo', 'vendor_id': '123'}})
    first, second = transfer.encrypt(original, PASSWORD), transfer.encrypt(original, PASSWORD)
    assert first != second
    assert 'private-do-not-echo' not in json.dumps(first)
    assert transfer.decode(first, PASSWORD) == original
    with pytest.raises(ValueError, match='رمز'):
        transfer.decode(first, 'wrong-password-123')
    damaged = copy.deepcopy(first)
    raw = bytearray(base64.b64decode(damaged['ciphertext'])); raw[0] ^= 1
    damaged['ciphertext'] = base64.b64encode(raw).decode()
    with pytest.raises(ValueError): transfer.decode(damaged, PASSWORD)
    for key, value in [('iterations', 999999999), ('schema', 2), ('nonce', 'bad')]:
        damaged = {**first, key: value}
        with pytest.raises(ValueError): transfer.decode(damaged, PASSWORD)
    with pytest.raises(ValueError): transfer.encrypt(original, 'short')


def test_restore_reencrypts_connections_under_destination_secret_and_preserves_security(db, settings, tmp_path):
    data = request_for({'profiles': [profile()], 'basalam': {'token': 'portable-private', 'vendor_id': '123'},
        'cron': {'public_get': True}, 'updates': {'enabled': False, 'interval_seconds': 900}, 'deployment': {'enabled': False}})
    db.put_config('api_auth', {'sha256': 'unchanged-admin'})
    db.put_config('cron_auth', {'sha256': 'unchanged-cron'})
    result = execute(db, settings, data)
    assert result['changed'] and result['undo_available']
    assert db.get_config('basalam')['token'] == 'portable-private'
    assert db.get_config('api_auth')['sha256'] == 'unchanged-admin'
    assert db.get_config('cron_auth')['sha256'] == 'unchanged-cron'
    assert db.checkpoint_read('cron:config')['public_get'] is True
    assert db.checkpoint_read('updates:config')['interval_seconds'] == 900
    assert db.checkpoint_read('deploy:config')['enabled'] is False
    with db.connect() as conn:
        raw = conn.execute("SELECT config FROM connections WHERE name='basalam'").fetchone()[0]
    assert 'portable-private' not in raw and unseal(raw, settings.secret_key)['token'] == 'portable-private'
    other = Settings(base_dir=tmp_path/'other', db_path=tmp_path/'other'/'data.sqlite', secret_key='different-host-secret', password='new-password')
    other.ensure_dirs(); target = DB(other.db_path, other.secret_key)
    execute(target, other, data)
    assert target.get_config('basalam')['token'] == 'portable-private'


def test_profiles_replace_preserves_products_ids_queues_and_disables_omitted(db, settings):
    one = db.upsert_profile('shop', 'https://example.com/old')
    old = db.upsert_profile('omitted', 'https://example.com/omitted')
    db.upsert_product(one['id'], 'p', {'title': 'Product', 'extra': {'keep': True}})
    with db.connect() as conn:
        conn.execute('UPDATE products SET woo_id=7,basalam_id=8')
    job = db.enqueue('extract', one['id']); db.update_entry(job, status='done')
    before_product = db.list_products(one['id'])[0]
    before_job = db.get_entry(job)
    result = execute(db, settings, request_for({'profiles': [profile()]}))
    assert result['products_changed'] is False and result['queue_changed'] is False
    assert db.get_profile('shop')['id'] == one['id']
    assert db.get_profile(old['id'])['enabled'] == 0
    assert db.list_products(one['id'])[0] == before_product
    assert db.get_entry(job) == before_job


def test_merge_preserves_nested_profile_settings_and_unselected_sections(db, settings):
    db.upsert_profile('shop', 'https://example.com/shop', settings={'custom': {'keep': 3}})
    db.put_config('basalam', {'token': 'keep-token', 'vendor_id': '1'})
    data = request_for({'profiles': [profile()], 'basalam': {'token': 'new-token', 'vendor_id': '1'}}, sections=['profiles'], mode='merge')
    execute(db, settings, data)
    assert db.get_profile('shop')['settings']['custom'] == {'keep': 3, 'old': 1}
    assert db.get_config('basalam')['token'] == 'keep-token'


def test_credentials_opt_in_preserves_existing_and_prevents_cross_account_rebinding(db, settings):
    db.put_config('basalam', {'token': 'old-private', 'vendor_id': '1', 'category_id': '9'})
    data = request_for({'basalam': {'token': 'incoming-private', 'vendor_id': '1', 'category_id': '2'}}, credentials=False)
    execute(db, settings, data)
    assert db.get_config('basalam') == {'token': 'old-private', 'vendor_id': '1', 'category_id': '2'}
    data = request_for({'basalam': {'vendor_id': '2'}}, credentials=True, mode='merge')
    with pytest.raises(ValueError): transfer.preview(db, data, 'browser-session')
    data = request_for({'basalam': {'vendor_id': '2', 'token': 'new-identity-token'}}, credentials=False)
    with pytest.raises(ValueError): transfer.preview(db, data, 'browser-session')
    data['credentials'] = True
    execute(db, settings, data)
    assert db.get_config('basalam')['vendor_id'] == '2'


@pytest.mark.parametrize('status', ['waiting', 'running', 'paused'])
def test_nonterminal_jobs_block_restore_without_mutation(db, settings, status):
    p = db.upsert_profile('shop', 'https://example.com/shop')
    job = db.enqueue('extract', p['id']); db.update_entry(job, status=status)
    data = request_for({'cron': {'public_get': True}})
    before = state(db); preview = transfer.preview(db, data, 'browser-session')
    assert preview['active_jobs'] == 1
    with pytest.raises(transfer.Conflict): transfer.apply(db, settings, {**data, 'token': preview['token']}, 'browser-session')
    assert state(db) == before and db.get_entry(job)['status'] == status


def test_worker_lock_blocks_restore(db, settings):
    data = request_for({'cron': {'public_get': True}})
    token = transfer.preview(db, data, 'browser-session')['token']
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(transfer.Conflict): transfer.apply(db, settings, {**data, 'token': token}, 'browser-session')
    assert db.checkpoint_read('cron:config') == {}


def test_preview_binding_stale_config_changed_options_and_file_rejected(db, settings):
    data = request_for({'cron': {'public_get': True}})
    token = transfer.preview(db, data, 'browser-session')['token']
    for changed, binding in [({'credentials': False}, 'browser-session'), ({'mode': 'merge'}, 'browser-session'), ({}, 'other-session'), ({'token': 'invalid'}, 'browser-session')]:
        with pytest.raises(transfer.Conflict): transfer.apply(db, settings, {**data, 'token': token, **changed}, binding)
    db.checkpoint_write('cron:config', {'public_get': False}) # Same effective default is not a change.
    db.checkpoint_write('updates:config', {'enabled': False, 'interval_seconds': 600})
    with pytest.raises(transfer.Conflict): transfer.apply(db, settings, {**data, 'token': token}, 'browser-session')
    assert not db.checkpoint_read('cron:config')['public_get']


def test_transaction_failure_rolls_back_settings_and_undo(db, settings, monkeypatch):
    data = request_for({'profiles': [profile()], 'cron': {'public_get': True}})
    before = state(db)
    original = transfer.write_target
    def interrupted(conn, db, target, selected):
        original(conn, db, target, selected)
        raise RuntimeError('simulate disk/write failure')
    monkeypatch.setattr(transfer, 'write_target', interrupted)
    with pytest.raises(RuntimeError): execute(db, settings, data)
    assert state(db) == before and db.get_config(transfer.UNDO) == {}


def test_undo_previous_is_encrypted_and_itself_requires_preview(db, settings):
    db.put_config('basalam', {'token': 'before-private', 'vendor_id': '1'})
    before = state(db)
    execute(db, settings, request_for({'basalam': {'token': 'after-private', 'vendor_id': '1'}}))
    data = {'source': 'previous', 'sections': ['basalam'], 'mode': 'replace', 'credentials': True}
    assert execute(db, settings, data)['ok']
    assert state(db) == before
    with db.connect() as conn:
        raw = conn.execute('SELECT config FROM connections WHERE name=?', (transfer.UNDO,)).fetchone()[0]
    assert 'after-private' not in raw


def test_noop_import_does_not_erase_previous_backup(db, settings):
    data = request_for({'cron': {'public_get': True}})
    execute(db, settings, data)
    previous = db.get_config(transfer.UNDO)
    assert execute(db, settings, data)['changed'] is False
    assert db.get_config(transfer.UNDO) == previous


def php_bundle(files):
    return {'app': 'scraper', 'kind': 'settings-export', 'version': '10.641', 'files': {
        key: {'b64': base64.b64encode(json.dumps(value).encode()).decode()} for key, value in files.items()}}


def test_php_profiles_cfg_connections_and_inspection_parity_without_products(db, settings):
    file = php_bundle({'profiles.json': {'legacy': {'name': 'قدیمی', 'url': 'https://example.com/shop', 'pagType': 'next_selector', 'pagVal': '.next',
        'detailSelectors': {'longDesc': '#description', 'weight': '.weight'}, 'products': {'p': {'title': 'Never imported'}}}},
        'connections.json': {'woocommerce': {'store_url': 'https://store.example', 'consumer_key': 'private-key', 'consumer_secret': 'private-secret'},
                             'basalam': {'vendor_id': 12, 'category_id': 34, 'token': 'private-token'}},
        'woo_queue.json': [1, 2], 'ai_providers.json': {'unsupported': True}})
    decoded = transfer.decode(file, '')
    assert decoded['sections']['basalam']['vendor_id'] == '12'
    assert decoded['sections']['profiles'][0]['settings']['detailSelectors'] == {'longDesc': '#description'}
    assert decoded['sections']['profiles'][0]['settings']['legacy_detailSelectors']['weight'] == '.weight'
    assert 'woo_queue.json' in str(decoded['warnings'])
    data = {'file': json.dumps(file), 'sections': ['profiles', 'woocommerce', 'basalam'], 'mode': 'merge', 'credentials': True}
    execute(db, settings, data)
    assert db.get_profile('legacy')['pagination'] == {'type': 'next_selector', 'val': '.next'}
    assert db.list_products() == [] and db.list_entries() == []
    assert db.get_config('woocommerce')['consumer_secret'] == 'private-secret'


@pytest.mark.parametrize('sections', [[], ['missing'], ['profiles', 'profiles'], [1]])
def test_section_selection_must_be_explicit_and_valid(sections):
    with pytest.raises(ValueError): transfer.selection(sections, transfer.SECTIONS)


@pytest.mark.parametrize('bad', [
    {'profiles': [profile(), profile()]}, {'profiles': [profile(url='http://127.0.0.1/private')]},
    {'profiles': [profile(enabled='true')]}, {'cron': {'public_get': 1}},
    {'updates': {'enabled': True, 'interval_seconds': 1}}, {'deployment': {'enabled': False, 'authority': 'bad'}},
    {'unknown': {}}, {'pythonanywhere': {'site': 'evil.example', 'username': 'x', 'domain': 'x', 'token': 'token'}},
    {'basalam': {'token': '••••'}},
])
def test_invalid_file_values_cannot_be_applied(db, bad):
    data = request_for(bad)
    with pytest.raises(ValueError): transfer.preview(db, data, 'browser-session')
    assert db.list_profiles() == []


def test_unsafe_php_paths_duplicate_json_depth_and_oversize_rejected():
    for file in (php_bundle({'../../.env': {}}), php_bundle({'profiles.json': []}), {'app': 'scraper', 'files': {'profiles.json': {'b64': 'broken'}}}):
        with pytest.raises(ValueError): transfer.decode(file, '')
    with pytest.raises(ValueError): transfer.decode('{"app":"scraper","app":"bad"}', '')
    with pytest.raises(ValueError): transfer.decode('x' * (transfer.MAX_FILE + 1), '')
    deeply = {}; root = deeply
    for _ in range(22): root['nested'] = {}; root = root['nested']
    with pytest.raises(ValueError): transfer.decode(deeply, '')


def test_web_export_inspect_preview_apply_and_no_secret_echo(client, auth_headers, app):
    db = app.extensions['s4_db']
    db.put_config('basalam', {'token': 'secret-never-in-preview', 'vendor_id': '1'})
    exported = client.post('/api/settings/export', json={'sections': ['basalam', 'cron'], 'password': PASSWORD}, headers=auth_headers)
    assert exported.status_code == 200 and exported.headers['Content-Disposition'].startswith('attachment;')
    assert exported.headers['Cache-Control'] == 'no-store' and 'secret-never-in-preview' not in exported.text
    file = exported.json
    decoded = transfer.decode(file, PASSWORD); decoded['sections']['cron']['public_get'] = True
    data = {'file': transfer.encrypt(decoded, PASSWORD), 'password': PASSWORD, 'sections': ['cron'], 'mode': 'replace', 'credentials': False}
    inspected = client.post('/api/settings/inspect', json=data, headers=auth_headers)
    assert inspected.status_code == 200 and 'secret-never-in-preview' not in inspected.text
    preview = client.post('/api/settings/preview', json=data, headers=auth_headers)
    assert preview.status_code == 200 and 'secret-never-in-preview' not in preview.text
    applied = client.post('/api/settings/import', json={**data, 'token': preview.json['token']}, headers=auth_headers)
    assert applied.status_code == 200 and applied.json['products_changed'] is False
    assert db.checkpoint_read('cron:config')['public_get'] is True
    assert client.get('/api/settings/sections').json['undo_available'] is True
    page = BeautifulSoup(client.get('/settings/backup').text, 'html.parser')
    assert page.select_one('#settings-import-form') and page.select_one('#settings-export-form')
    assert not page.select_one('#settings-export-form input[value=pythonanywhere]').has_attr('checked')
    assert 'secret-never-in-preview' not in page.text


def test_settings_routes_require_browser_session_and_csrf_not_full_admin_key(app, client, auth_headers):
    assert app.test_client().get('/api/settings/sections').status_code == 401
    assert client.post('/api/settings/export', json={'sections': ['profiles'], 'password': PASSWORD}).status_code == 400
    token = client.post('/api/auth/token', headers=auth_headers).json['token']
    assert app.test_client().get('/api/settings/sections', headers={'Authorization': 'Bearer ' + token}).status_code == 403
    assert client.post('/api/settings/import', json={'token': 'bad'}, headers=auth_headers).status_code == 409


def test_missing_section_not_cleared_and_explicit_empty_profile_list_disables_only(db, settings):
    db.upsert_profile('shop', 'https://example.com/shop')
    data = request_for({'cron': {'public_get': True}}, sections=['profiles'])
    with pytest.raises(ValueError): transfer.preview(db, data, 'browser-session')
    execute(db, settings, request_for({'profiles': []}))
    assert db.get_profile('shop')['enabled'] == 0


def test_expired_preview_is_rejected(db, settings, monkeypatch):
    import time
    from itsdangerous import TimestampSigner
    data = request_for({'cron': {'public_get': True}})
    token = transfer.preview(db, data, 'browser-session')['token']
    now = int(time.time())
    monkeypatch.setattr(TimestampSigner, 'get_timestamp', lambda self: now + 601)
    with pytest.raises(transfer.Conflict):
        transfer.apply(db, settings, {**data, 'token': token}, 'browser-session')
    assert db.checkpoint_read('cron:config') == {}


def test_preview_never_mutates_source_and_undo_preserves_new_profile_products(db, settings):
    db.upsert_profile('old', 'https://example.com/old')
    current = state(db); before = copy.deepcopy(current)
    transfer.plan(current, bundle({'profiles': []}), ['profiles'], 'replace', False)
    assert current == before
    execute(db, settings, request_for({'profiles': [profile()]}))
    new = db.get_profile('shop')
    db.upsert_product(new['id'], 'keep', {'title': 'Keep on undo'})
    data = {'source': 'previous', 'sections': ['profiles'], 'mode': 'replace', 'credentials': True}
    execute(db, settings, data)
    assert db.get_profile('old')['enabled'] == 1
    assert db.get_profile('shop')['id'] == new['id'] and db.get_profile('shop')['enabled'] == 0
    assert db.list_products(new['id'])[0]['title'] == 'Keep on undo'


def test_hosting_is_explicit_and_does_not_reuse_token_for_new_host(db, settings):
    value = {'site': 'www.pythonanywhere.com', 'username': 'target', 'domain': 'target.pythonanywhere.com', 'token': 'pa-private'}
    data = request_for({'pythonanywhere': value})
    assert execute(db, settings, data)['ok']
    assert db.get_config('pythonanywhere') == value
    assert 'pa-private' not in str(transfer.preview(db, data, 'browser-session'))
    before = dict(value)
    data = request_for({'pythonanywhere': {**value, 'username': 'other', 'domain': 'other.pythonanywhere.com', 'token': ''}}, mode='merge')
    with pytest.raises(ValueError): transfer.preview(db, data, 'browser-session')
    assert db.get_config('pythonanywhere') == before
    data = request_for({'pythonanywhere': value})
    data.pop('sections')
    with pytest.raises(ValueError): transfer.preview(db, data, 'browser-session')


def test_numeric_legacy_ids_export_portably_and_runtime_install_identity_excluded(client, auth_headers, app):
    db = app.extensions['s4_db']
    db.put_config('basalam', {'vendor_id': 12, 'category_id': 0, 'token': 'legacy-private'})
    exported = client.post('/api/settings/export', json={'sections': list(transfer.SECTIONS), 'password': PASSWORD}, headers=auth_headers)
    assert exported.status_code == 200
    decoded = transfer.decode(exported.json, PASSWORD)
    assert decoded['sections']['basalam']['vendor_id'] == '12'
    assert decoded['sections']['basalam']['category_id'] == ''
    assert set(decoded['sections']) == set(transfer.SECTIONS)
    assert app.extensions['s4_settings'].secret_key not in exported.text
    assert 'admin/cron API keys' in decoded['excluded']


def test_malformed_metadata_gives_validation_error_not_internal_error():
    encrypted = transfer.encrypt({**bundle({'profiles': []}), 'warnings': 'not a list'}, PASSWORD)
    with pytest.raises(ValueError): transfer.decode(encrypted, PASSWORD)


def test_http_duplicate_keys_and_invalid_json_are_rejected_safely(client, auth_headers):
    for raw in ('{"sections":[],"sections":["profiles"]}', '{"file":NaN}', '[' * 1100 + '0' + ']' * 1100):
        response = client.post('/api/settings/inspect', data=raw, content_type='application/json', headers=auth_headers)
        assert response.status_code == 400
    assert client.post('/api/settings/export', data='{}', content_type='text/plain', headers=auth_headers).status_code == 400
