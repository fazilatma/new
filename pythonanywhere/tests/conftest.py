import pytest
from scraper4.config import Settings
from scraper4.db import DB
from scraper4 import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(base_dir=tmp_path, db_path=tmp_path/'data'/'test.sqlite3',
                    secret_key='test-secret-only', password='test-password')


@pytest.fixture
def db(settings):
    return DB(settings.db_path, settings.secret_key)


@pytest.fixture
def app(settings):
    app = create_app(settings)
    app.config.update(TESTING=True, SESSION_COOKIE_SECURE=False)
    return app


@pytest.fixture
def client(app):
    client = app.test_client()
    client.get('/login')
    with client.session_transaction() as session:
        token = session['csrf']
    response = client.post('/login', data={'password':'test-password','csrf':token})
    assert response.status_code == 302
    return client


@pytest.fixture
def auth_headers(client):
    with client.session_transaction() as session:
        return {'X-CSRF-Token':session['csrf']}
