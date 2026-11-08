"""PythonAnywhere classic WSGI API, following pythonanywhere-core contracts.

Credentials are encrypted in connections, never embedded in task commands.
No endpoint accepts an arbitrary API host, shell command or WSGI path.
"""
import getpass
import os
import re
import shlex
import sys
from pathlib import Path
from urllib.parse import quote

import requests

SITES = {'www.pythonanywhere.com', 'eu.pythonanywhere.com'}


class PlatformError(ValueError):
    pass


class PythonAnywhere:
    def __init__(self, config):
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
        try:
            response = requests.request(method, self.base + path,
                headers={'Authorization': 'Token ' + self.config['token'], 'User-Agent': 'scraper4-pa/1.1'},
                timeout=(10, 60), allow_redirects=False, **kwargs)
        except requests.RequestException:
            raise PlatformError('PythonAnywhere API network error; check account connectivity') from None
        if allow_404 and response.status_code == 404:
            return None
        if not 200 <= response.status_code < 300:
            # Never echo the response, URLs, headers or credentials into public status.
            raise PlatformError(f'PythonAnywhere API HTTP {response.status_code}; check token, account quota and API permissions')
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
            # Some accounts only allow daily schedules. Do not hide auth/server errors.
            if 'HTTP 400' not in str(exc):
                raise
            payload.update(interval='daily', hour=3)
            task = self.call(method, path, json=payload)
        if not isinstance(task, dict) or not task.get('id') or task.get('enabled') is False or task.get('can_enable') is False:
            raise PlatformError('Scheduled task could not be enabled; check your account task quota')
        result.update(task='configured', task_id=task['id'], interval=task.get('interval', payload['interval']))
        db.checkpoint_write('platform:status', result)
        return result


def prompt_configuration(db):
    """Read secrets only from the local tty or platform environment, never chat."""
    cfg = db.get_config('pythonanywhere')
    cfg.setdefault('site', os.environ.get('PYTHONANYWHERE_SITE', 'www.pythonanywhere.com'))
    cfg.setdefault('username', os.environ.get('PYTHONANYWHERE_USERNAME', getpass.getuser()))
    suffix = 'eu.pythonanywhere.com' if cfg['site'] == 'eu.pythonanywhere.com' else 'pythonanywhere.com'
    cfg.setdefault('domain', cfg['username'].lower() + '.' + suffix)
    cfg['token'] = os.environ.get('API_TOKEN') or cfg.get('token') or ''
    if not cfg['token']:
        try:
            with open('/dev/tty', 'r+') as tty:
                tty.write('PythonAnywhere Account → API Token: create a token once.\n')
                tty.write(f'API site [{cfg["site"]}]: '); tty.flush()
                cfg['site'] = tty.readline().strip() or cfg['site']
                tty.write(f'Username [{cfg["username"]}]: '); tty.flush()
                cfg['username'] = tty.readline().strip() or cfg['username']
                suffix = 'eu.pythonanywhere.com' if cfg['site'] == 'eu.pythonanywhere.com' else 'pythonanywhere.com'
                cfg['domain'] = cfg['username'].lower() + '.' + suffix
                tty.write(f'Web domain [{cfg["domain"]}]: '); tty.flush()
                cfg['domain'] = tty.readline().strip() or cfg['domain']
                cfg['token'] = getpass.getpass('API token (hidden): ', stream=tty)
        except OSError:
            raise PlatformError('No local terminal/API_TOKEN available. Run python -m scraper4 configure on PythonAnywhere.') from None
    PythonAnywhere(cfg)  # validate before persisting
    db.put_config('pythonanywhere', cfg)
    return cfg
