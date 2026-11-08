import json

import pytest
from bs4 import BeautifulSoup

from scraper4 import create_app
from scraper4.config import VERSION


def test_health_separates_running_and_installed_build_and_freezes_page_metadata(settings):
    release = settings.base_dir / '.release.json'
    release.write_text(json.dumps({'commit': 'a' * 40}))
    app = create_app(settings)
    app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
    client = app.test_client()
    release.write_text(json.dumps({'commit': 'b' * 40}))
    response = client.get('/healthz')
    assert response.json == {'ok': True, 'version': VERSION, 'commit': 'a' * 40}
    assert response.headers['X-Scraper-Installed-Commit'] == 'b' * 40
    assert response.headers['Cache-Control'] == 'no-store'
    login = BeautifulSoup(client.get('/login').text, 'html.parser')
    assert login.select_one('meta[name=s4-build]')['content'] == 'a' * 40
    assert login.select_one('meta[name=s4-version]')['content'] == VERSION
    token = login.select_one('input[name=csrf]')['value']
    assert client.post('/login', data={'password': 'test-password', 'csrf': token}).status_code == 302
    for route in ('/', '/settings/pythonanywhere'):
        page = BeautifulSoup(client.get(route).text, 'html.parser')
        assert page.select_one('meta[name=s4-build]')['content'] == 'a' * 40
        scripts = [script['src'].split('?')[0] for script in page.select('script[src]')]
        assert scripts[0] == '/static/auto-refresh.js'
        assert page.select_one('#build-update-notice').has_attr('hidden')
        assert page.select_one('#build-refresh-now')['type'] == 'button'
        assert len(page.select('#build-update-notice')) == 1
    fresh = create_app(settings).test_client().get('/healthz')
    assert fresh.json['commit'] == fresh.headers['X-Scraper-Installed-Commit'] == 'b' * 40


@pytest.mark.parametrize('commit', [None, {}, 7, 'bad\r\nX-Test: injected', 'A' * 40])
def test_invalid_installed_identity_never_becomes_a_response_header(app, settings, commit):
    (settings.base_dir / '.release.json').write_text(json.dumps({'commit': commit}))
    response = app.test_client().get('/healthz')
    assert response.status_code == 200
    assert response.json['commit'] is None
    assert response.headers['X-Scraper-Installed-Commit'] == ''


def test_missing_or_partially_written_release_is_not_ready(app, settings):
    (settings.base_dir / '.release.json').write_text('{')
    assert app.test_client().get('/healthz').headers['X-Scraper-Installed-Commit'] == ''
    (settings.base_dir / '.maintenance.json').write_text('{}')
    assert app.test_client().get('/healthz').status_code == 503
