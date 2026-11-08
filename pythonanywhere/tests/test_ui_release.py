import json
from pathlib import Path
from unittest.mock import Mock

import pytest
from bs4 import BeautifulSoup

from scraper4.config import VERSION
from scraper4.services.platform import PlatformError, PythonAnywhere, reload_installed_web

CFG = {'site':'www.pythonanywhere.com','username':'example','domain':'example.pythonanywhere.com','token':'saved-private-token'}


def test_php_like_tabs_forms_and_version_are_rendered(client):
    page = BeautifulSoup(client.get('/').text, 'html.parser')
    assert [b['data-tab'] for b in page.select('.main-tab')] == ['start','settings','selectors','results','send']
    assert len(page.select('[role=tabpanel]')) == 5
    for name in ('profile-form','job-form','send-form','cron-public-get','platform-form','products-refresh'):
        assert page.select_one('#'+name)
    ids = [tag['id'] for tag in page.select('[id]')]
    assert len(ids) == len(set(ids))
    assert 'Python v'+VERSION in page.text
    assert page.select_one('link[rel=stylesheet]')['href'].endswith('v='+VERSION)


def test_health_is_public_and_identifies_the_running_release(app,settings):
    (settings.base_dir/'.release.json').write_text(json.dumps({'commit':'a'*40}))
    remote = app.test_client()
    response = remote.get('/healthz')
    # Updating the file must not let an old WSGI worker impersonate a new build.
    assert response.json == {'ok':True,'version':VERSION,'commit':None}
    from scraper4 import create_app
    fresh = create_app(settings)
    assert fresh.test_client().get('/healthz').json['commit'] == 'a'*40
    assert response.headers['Cache-Control'] == 'no-store'
    assert remote.get('/api/system/status').status_code == 401
    assert VERSION in remote.get('/login').text


def test_reload_without_token_is_noninteractive_and_never_calls_api(db,settings,monkeypatch):
    monkeypatch.setattr(PythonAnywhere,'call',lambda *a,**kw: pytest.fail('No API call without token'))
    assert reload_installed_web(db,settings,if_configured=True)['skipped']
    with pytest.raises(PlatformError):
        reload_installed_web(db,settings)


def setup_reload(db,settings,monkeypatch,live,source=None):
    db.put_config('pythonanywhere',CFG)
    (settings.base_dir/'.release.json').write_text(json.dumps({'commit':'a'*40}))
    calls=[]
    def fake(self,method,path,**kwargs):
        calls.append((method,path))
        if method=='GET': return {'source_directory':source or str(settings.base_dir)}
        if method=='POST' and path.endswith('/reload/'): return {}
        pytest.fail('No provisioning, WSGI upload, Task or shell allowed')
    monkeypatch.setattr(PythonAnywhere,'call',fake)
    monkeypatch.setattr('time.sleep',lambda *_:None)
    def get(url,**kwargs):
        assert url == 'https://example.pythonanywhere.com/healthz'
        assert 'Authorization' not in kwargs['headers']
        assert CFG['token'] not in str(kwargs)
        return Mock(status_code=200,json=lambda:live)
    monkeypatch.setattr('scraper4.services.platform.requests.get',get)
    return calls


def test_reload_verifies_actual_live_commit_not_just_api_success(db,settings,monkeypatch):
    calls=setup_reload(db,settings,monkeypatch,{'ok':True,'version':VERSION,'commit':'a'*40})
    assert reload_installed_web(db,settings)['live_verified'] is True
    assert calls == [('GET','webapps/example.pythonanywhere.com/'),('POST','webapps/example.pythonanywhere.com/reload/')]


@pytest.mark.parametrize('live',[{'ok':True},{'ok':True,'version':'1.3.1','commit':'a'*40}, {'ok':True,'version':VERSION,'commit':'b'*40}])
def test_stale_or_wrong_wsgi_cannot_report_success(db,settings,monkeypatch,live):
    setup_reload(db,settings,monkeypatch,live)
    with pytest.raises(PlatformError,match='could not be verified'):
        reload_installed_web(db,settings)


def test_wrong_source_directory_is_not_reloaded_or_overwritten(db,settings,monkeypatch):
    calls=setup_reload(db,settings,monkeypatch,{},source='/other/app')
    with pytest.raises(PlatformError,match='differs'):
        reload_installed_web(db,settings)
    assert len(calls)==1


def test_bootstrap_reloads_only_after_recording_release():
    script=(Path(__file__).resolve().parents[1]/'bootstrap.sh').read_text()
    assert script.index("PYRELEASE\n",script.index("<<'PYRELEASE'")) < script.index('-m scraper4 reload-web --if-configured')



def test_hamburger_inventory_matches_php_top_to_bottom(client):
    from scraper4.navigation import SETTINGS_MENU
    expected = ['runtime','orders','backup','changelog','version','woocommerce',
                'basalam','ai','notifications','removed','general','guardian','source',
                'render','reconcile','categories','destination-edit','woo-images',
                'auto-reply','manual-reply','nightly','profile-stats']
    assert [item['key'] for item in SETTINGS_MENU] == expected
    page = BeautifulSoup(client.get('/').text, 'html.parser')
    dialog = page.select_one('dialog#settings-menu')
    assert dialog and not dialog.has_attr('open')
    assert [item['data-menu-key'] for item in dialog.select('.menu-group')] == expected
    trigger = page.select_one('#hamburgerBtn')
    assert trigger['aria-expanded'] == 'false'
    assert trigger['aria-controls'] == dialog['id']
    for action in dialog.select('[data-menu-target]'):
        assert page.find(id=action['data-menu-target']), action['data-menu-target']
        assert page.find(id='pane-'+action['data-menu-tab'])
    for item in SETTINGS_MENU:
        if item['state'] == 'pending':
            assert not item.get('actions') and not item.get('command')
            group = dialog.select_one('[data-menu-key="'+item['key']+'"]')
            assert not group.select('a,button,input,form')
            assert 'در حال انتقال' in group.text


def test_menu_available_on_dedicated_settings_page_not_public_login(app,client):
    page = BeautifulSoup(client.get('/settings/pythonanywhere').text, 'html.parser')
    assert page.select_one('#hamburgerBtn') and page.select_one('#settings-menu')
    assert page.select_one('script[src*="menu.js"]')
    assert page.select_one('#settings-menu #cron-settings #cron-public-get')
    assert not page.select('[data-menu-target]')
    assert 'settings-menu' not in app.test_client().get('/login').text
