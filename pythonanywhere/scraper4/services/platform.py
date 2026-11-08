"""PythonAnywhere classic WSGI API, following pythonanywhere-core contracts.

Credentials are encrypted in connections, never embedded in task commands.
No endpoint accepts an arbitrary API host, shell command or WSGI path.
"""
import getpass
import json
import os
import re
import shlex
import sys
from pathlib import Path
from urllib.parse import quote

import requests

SITES = {'www.pythonanywhere.com', 'eu.pythonanywhere.com'}


class PlatformError(ValueError):
    def __init__(self, message, *, status=None, operation=None, category=None):
        super().__init__(message)
        self.status = status
        self.operation = operation
        self.category = category


def operation_name(method, path):
    if path.startswith('files/path'):
        return 'wsgi_upload'
    if path.startswith('schedule/'):
        return {'GET': 'task_read', 'POST': 'task_create', 'PATCH': 'task_update'}.get(method.upper(), 'task')
    if path.endswith('/reload/'):
        return 'webapp_reload'
    return {'GET': 'webapp_read', 'POST': 'webapp_create', 'PATCH': 'webapp_configure'}.get(method.upper(), 'webapp')


class PythonAnywhere:
    def __init__(self, config, *, timeout=(10, 60)):
        self.timeout = timeout
        self.config = dict(config)
        self.site = config.get('site', 'www.pythonanywhere.com')
        self.username = config.get('username', '')
        self.domain = config.get('domain', '')
        if self.site not in SITES or not re.fullmatch(r'[A-Za-z0-9_-]+', self.username):
            raise PlatformError('Invalid PythonAnywhere site/username')
        if not re.fullmatch(r'[A-Za-z0-9.-]+', self.domain) or not config.get('token'):
            raise PlatformError('PythonAnywhere domain/token required')
        self.base = f'https://{self.site}/api/v0/user/{quote(self.username)}/'

    def call(self, method, path, *, allow_404=False, **kwargs):
        operation = operation_name(method, path)
        try:
            response = requests.request(method, self.base + path,
                headers={'Authorization': 'Token ' + self.config['token'], 'User-Agent': 'scraper4-pa/1.1'},
                timeout=self.timeout, allow_redirects=False, **kwargs)
        except requests.RequestException:
            raise PlatformError(f'PythonAnywhere API network error during {operation}; check account connectivity', operation=operation, category='network') from None
        if allow_404 and response.status_code == 404:
            return None
        if not 200 <= response.status_code < 300:
            # Classify only known error phrases. Never echo arbitrary response data,
            # URLs, headers, credentials, or the raw exception into public status.
            detail = ''
            try:
                body = response.json()
                if isinstance(body, dict):
                    detail = ' '.join(str(body.get(k, '')) for k in ('detail', 'error', 'message')).lower()
            except ValueError:
                pass
            auth_error = response.status_code == 401 or any(phrase in detail for phrase in
                ('invalid token', 'invalid authentication', 'authentication credentials were not provided'))
            category = 'authentication' if auth_error else 'forbidden' if response.status_code == 403 else 'api'
            if auth_error:
                hint = 'Authentication rejected: verify API token, username and US/EU API site; use configure --reset-api to replace credentials'
            elif response.status_code == 403:
                hint = 'Access denied; this does not by itself prove an invalid token. Run diagnose-platform to distinguish account/API/task permissions'
            else:
                hint = 'Check account quota, API permissions and configuration'
            raise PlatformError(f'PythonAnywhere API HTTP {response.status_code} during {operation}; {hint}',
                                status=response.status_code, operation=operation, category=category)
        try:
            result = response.json()
        except ValueError:
            result = {}
        if isinstance(result, dict) and result.get('status') == 'ERROR':
            raise PlatformError('PythonAnywhere API rejected the operation')
        return result

    @property
    def web_path(self):
        return 'webapps/' + self.domain + '/'

    def reload(self):
        self.call('POST', self.web_path + 'reload/')
        return {'ok': True, 'domain': self.domain}

    def provision(self, db, settings, *, replace_existing=False):
        base = settings.base_dir.resolve()
        python = Path(sys.executable).absolute()
        venv = python.parent.parent
        version = f'python{sys.version_info.major}{sys.version_info.minor}'
        existing = self.call('GET', self.web_path, allow_404=True)
        if existing is not None:
            source = existing.get('source_directory', '')
            if (not source or Path(source).resolve() != base) and not replace_existing:
                raise PlatformError('Existing webapp belongs to another source directory. Explicit --replace-existing consent is required.')
            # Never silently change the interpreter of an existing webapp.
            current_version = str(existing.get('python_version', ''))
            expected = f'{sys.version_info.major}.{sys.version_info.minor}'
            if current_version and current_version not in (version, expected):
                raise PlatformError('Existing webapp Python version differs from this virtualenv; use a matching interpreter')
        else:
            self.call('POST', 'webapps/', data={'domain_name': self.domain, 'python_version': version})
        self.call('PATCH', self.web_path, data={'source_directory': str(base),
                   'working_directory': str(base), 'virtualenv_path': str(venv)})
        # Official helper convention: /var/www/<domain-with-underscores>_wsgi.py
        wsgi_path = '/var/www/' + self.domain.replace('.', '_') + '_wsgi.py'
        content = ('import sys\nAPP_DIR = ' + repr(str(base)) + '\n'
                   'if APP_DIR not in sys.path:\n    sys.path.insert(0, APP_DIR)\n'
                   'from scraper4 import create_app\napplication = create_app()\n')
        if existing is not None:
            # The files API may return non-JSON; use a separate local backup on-platform.
            local = Path(wsgi_path)
            if local.is_file():
                backup = base / 'data' / 'wsgi-before-provision.py.bak'
                if not backup.exists():
                    backup.write_bytes(local.read_bytes())
                    backup.chmod(0o600)
        self.call('POST', 'files/path' + wsgi_path, files={'content': ('wsgi.py', content.encode())})
        self.reload()
        result = {'ok': True, 'domain': self.domain, 'web': 'configured', 'task': 'pending'}
        db.checkpoint_write('platform:status', result)
        result.update(self.ensure_task(settings, python=python))
        db.checkpoint_write('platform:status', result)
        return result

    def ensure_task(self, settings, *, python):
        """Bounded initial scheduler setup; never run a worker inside WSGI."""
        base = settings.base_dir.resolve()
        command = 'cd ' + shlex.quote(str(base)) + ' && ' + shlex.quote(str(python)) + ' -m scraper4 maintain --budget 240'
        tasks = self.call('GET', 'schedule/')
        if not isinstance(tasks, list):
            raise PlatformError('Unexpected PythonAnywhere task list')
        def owns_task(task):
            try:
                parts = shlex.split(task.get('command', ''))
            except ValueError:
                return False
            return (len(parts) >= 7 and parts[:3] == ['cd', str(base), '&&'] and
                    parts[4:6] == ['-m', 'scraper4'] and parts[6] in ('tick', 'maintain'))
        matches = [task for task in tasks if task.get('command') == command or owns_task(task)]
        payload = {'command': command, 'enabled': True, 'interval': 'hourly', 'minute': 7}
        path = 'schedule/' + str(matches[0]['id']) + '/' if matches else 'schedule/'
        method = 'PATCH' if matches else 'POST'
        try:
            task = self.call(method, path, json=payload)
        except PlatformError as exc:
            # An authenticated task-list read already succeeded. A rejected hourly
            # write may be a plan restriction; try daily, not unrelated credentials.
            status = exc.status
            if status is None and 'HTTP 400' in str(exc):
                status = 400  # compatibility with callers raising legacy errors
            if status not in (400, 403) or exc.category == 'authentication':
                raise
            payload.update(interval='daily', hour=3)
            task = self.call(method, path, json=payload)
        if not isinstance(task, dict) or not task.get('id') or task.get('enabled') is False or task.get('can_enable') is False:
            raise PlatformError('Scheduled task could not be enabled; check your account task quota')
        return {'ok': True, 'task': 'configured', 'task_id': task['id'], 'interval': task.get('interval', payload['interval'])}


def prompt_configuration(db, *, reset_api=False, site=None, username=None, domain=None):
    """Read secrets only from the local tty or platform environment, never chat."""
    cfg = db.get_config('pythonanywhere')
    cfg.setdefault('site', os.environ.get('PYTHONANYWHERE_SITE', 'www.pythonanywhere.com'))
    cfg.setdefault('username', os.environ.get('PYTHONANYWHERE_USERNAME', getpass.getuser()))
    suffix = 'eu.pythonanywhere.com' if cfg['site'] == 'eu.pythonanywhere.com' else 'pythonanywhere.com'
    cfg.setdefault('domain', cfg['username'].lower() + '.' + suffix)
    for key, value in (('site', site), ('username', username), ('domain', domain)):
        if value is not None:
            cfg[key] = value
    # An explicit replacement must not be silently undone by a stale API_TOKEN
    # environment variable in the next console/configure invocation.
    cfg['token'] = '' if reset_api else (cfg.get('token') or os.environ.get('API_TOKEN') or '')
    if not cfg['token']:
        try:
            with open('/dev/tty', 'r+') as tty:
                tty.write('PythonAnywhere Account → API Token: create a token once.\n')
                previous_account = (cfg['site'], cfg['username'])
                tty.write(f'API site [{cfg["site"]}]: '); tty.flush()
                cfg['site'] = tty.readline().strip() or cfg['site']
                tty.write(f'Username [{cfg["username"]}]: '); tty.flush()
                cfg['username'] = tty.readline().strip() or cfg['username']
                suffix = 'eu.pythonanywhere.com' if cfg['site'] == 'eu.pythonanywhere.com' else 'pythonanywhere.com'
                if domain is None and previous_account != (cfg['site'], cfg['username']):
                    cfg['domain'] = cfg['username'].lower() + '.' + suffix
                tty.write(f'Web domain [{cfg["domain"]}]: '); tty.flush()
                cfg['domain'] = tty.readline().strip() or cfg['domain']
                cfg['token'] = getpass.getpass('API token (hidden): ', stream=tty)
        except OSError:
            raise PlatformError('No local terminal/API_TOKEN available. Run python -m scraper4 configure on PythonAnywhere.') from None
    cfg['token'] = cfg['token'].strip()
    api = PythonAnywhere(cfg)
    if reset_api:
        # Read-only authentication check before overwriting a stored credential.
        api.call('GET', 'webapps/')
    db.put_config('pythonanywhere', cfg)
    return cfg


def diagnose(db, *, timeout=(5, 10)):
    """Only GET requests. Returns no token, headers, paths or raw API bodies."""
    cfg = db.get_config('pythonanywhere')
    if not cfg:
        return {'ok': False, 'error': 'API not configured; run configure first', 'checks': []}
    api = PythonAnywhere(cfg, timeout=timeout)
    checks = []
    for name, path in (('webapps_read', 'webapps/'), ('webapp_read', api.web_path), ('tasks_read', 'schedule/')):
        try:
            api.call('GET', path)
            checks.append({'name': name, 'ok': True, 'http_status': 200})
        except PlatformError as exc:
            checks.append({'name': name, 'ok': False, 'http_status': exc.status,
                           'category': exc.category, 'error': str(exc)})
    works = any(check['ok'] for check in checks)
    return {'ok': all(check['ok'] for check in checks), 'site': api.site,
            'username': api.username, 'domain': api.domain, 'read_only': True,
            'authentication_confirmed_on_some_routes': works,
            'hint': ('Token worked on at least one route; inspect the failing operation/plan permissions'
                     if works else 'Check token, username, API site and account API access; 403 alone is not conclusive'),
            'checks': checks}


def web_defaults():
    site = os.environ.get('PYTHONANYWHERE_SITE', 'www.pythonanywhere.com')
    if site not in SITES:
        site = 'www.pythonanywhere.com'
    username = os.environ.get('PYTHONANYWHERE_USERNAME', getpass.getuser())
    suffix = 'eu.pythonanywhere.com' if site == 'eu.pythonanywhere.com' else 'pythonanywhere.com'
    return {'site': site, 'username': username, 'domain': username.lower() + '.' + suffix}


def installed_python(settings):
    """WSGI sys.executable may be uWSGI, not the virtualenv's Python.

    Only the local installer may write this metadata; HTTP cannot supply a path.
    """
    try:
        runtime = json.loads((settings.base_dir / '.runtime.json').read_text())
        python = Path(runtime['python'])
        if (not python.is_absolute() or not python.is_file() or
                not os.access(python, os.X_OK) or not (python.parent.parent / 'pyvenv.cfg').is_file()):
            raise ValueError()
    except (OSError, ValueError, KeyError, TypeError):
        raise PlatformError('Installed virtualenv metadata is missing; rerun the token-free installer') from None
    return python


def reload_installed_web(db, settings, *, if_configured=False):
    """CLI-only post-install reload, followed by public version/commit verification.

    No token prompt, scheduler dependency, provisioning or WSGI overwrites.
    The credential never leaves the PythonAnywhere API Authorization header.
    """
    import time
    from ..config import VERSION
    from .updates import read_release

    cfg = db.get_config('pythonanywhere')
    if not cfg.get('token'):
        if if_configured:
            return {'ok': True, 'skipped': True, 'reason': 'No saved PythonAnywhere API token; configure Web and Reload manually'}
        raise PlatformError('Save a PythonAnywhere API token in the web panel first')
    api = PythonAnywhere(cfg, timeout=(3, 10))
    web = api.call('GET', api.web_path)
    source = web.get('source_directory', '') if isinstance(web, dict) else ''
    if source and Path(source).resolve() != settings.base_dir.resolve():
        raise PlatformError('Installed directory differs from the configured Web source directory; no WSGI files were changed. Check Web source/WSGI paths before reloading.')
    api.reload()
    expected = read_release(settings.base_dir).get('commit')
    for attempt in range(6):
        if attempt:
            time.sleep(2)
        try:
            response = requests.get('https://' + api.domain + '/healthz',
                params={'build': expected or VERSION}, timeout=(3, 5),
                headers={'Cache-Control': 'no-cache'}, allow_redirects=False)
            live = response.json() if response.status_code == 200 else {}
            if (isinstance(live, dict) and live.get('ok') is True and live.get('version') == VERSION
                    and (not expected or live.get('commit') == expected)):
                return {'ok': True, 'domain': api.domain, 'version': VERSION,
                        'commit': expected, 'live_verified': True}
        except (requests.RequestException, ValueError):
            pass
    raise PlatformError('Code installed and Reload accepted, but the live version/commit could not be verified. Check Web WSGI/source paths and the error log; do not assume the upgrade is live.')
