"""Fixed-repository updater. Only the CLI maintenance runner changes code.

Updates are serialized with scraping using the same worker lock. A maintenance
marker blocks WSGI requests while files are changed. Code + SQLite backups are
kept; failed validation restores code, but dependency installation is not
transactional. No arbitrary repository, command or path is accepted via HTTP.
"""
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
from pathlib import Path, PurePosixPath

import requests

from ..db import utc_now

REPO = 'fazilatma/new'
REF = 'arena/f3d5d2a0-new'
EXCLUDED = {'.env', '.venv', 'data', 'logs', '__pycache__', '.pytest_cache',
            'pythonanywhere_wsgi.py', '.release.json', '.maintenance.json', '.runtime.json'}
SHA = re.compile(r'^[0-9a-f]{40}$')
ROOT_FILES = {'.env.example', '.gitignore', 'README.fa.md', 'SOURCE.json',
              'bootstrap.sh', 'install.sh', 'requirements-dev.txt', 'requirements.txt', 'wsgi.py'}


def read_release(base):
    try:
        value = json.loads((base / '.release.json').read_text())
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def update_config(db):
    return {'enabled': True, 'interval_seconds': 3600, **db.checkpoint_read('updates:config')}


def status(db, settings):
    state = db.checkpoint_read('updates:state')
    return {'current': read_release(settings.base_dir).get('commit'),
            'repository': REPO, 'branch': REF, 'config': update_config(db),
            'state': state, 'operation': db.checkpoint_read('maintenance:request')}


def request_operation(db, action):
    if action not in ('check', 'update', 'reload', 'configure', 'rollback'):
        raise ValueError('Unknown maintenance operation')
    value = {'id': uuid.uuid4().hex, 'action': action, 'status': 'pending', 'created_at': utc_now()}
    with db.connect() as conn:
        conn.execute('BEGIN IMMEDIATE')
        row = conn.execute('SELECT state FROM task_checkpoints WHERE task=?', ('maintenance:request',)).fetchone()
        old = json.loads(row[0]) if row else {}
        if old.get('status') in ('pending', 'running'):
            raise ValueError('A maintenance operation is already queued or running')
        now = utc_now()
        conn.execute('''INSERT INTO task_checkpoints (task,state,created_at,updated_at) VALUES (?,?,?,?)
            ON CONFLICT(task) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at''',
            ('maintenance:request', json.dumps(value), now, now))
    return value


def latest_commit():
    url = f'https://api.github.com/repos/{REPO}/commits/' + requests.utils.quote(REF, safe='')
    try:
        response = requests.get(url, timeout=(10, 30), headers={'Accept': 'application/vnd.github+json'})
        response.raise_for_status()
        sha = response.json()['sha']
    except (requests.RequestException, ValueError, KeyError):
        raise ValueError('GitHub version check failed (network/rate limit/private repository)') from None
    if not isinstance(sha, str) or not SHA.fullmatch(sha):
        raise ValueError('Invalid GitHub commit response')
    return sha


def check(db, settings):
    commit = latest_commit()
    result = {'latest': commit, 'checked_at': utc_now(), 'checked_epoch': time.time(),
              'available': commit != read_release(settings.base_dir).get('commit'), 'error': ''}
    db.checkpoint_write('updates:state', result)
    return result


def download(commit, destination):
    if not SHA.fullmatch(commit):
        raise ValueError('Invalid release commit')
    archive = destination / 'source.tar.gz'
    try:
        with requests.get(f'https://codeload.github.com/{REPO}/tar.gz/{commit}',
                          timeout=(15, 120), stream=True) as response:
            response.raise_for_status()
            size = 0
            with archive.open('wb') as handle:
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 64 * 1024 * 1024:
                        raise ValueError('Release archive exceeds 64 MiB')
                    handle.write(chunk)
    except requests.RequestException:
        raise ValueError('GitHub release download failed') from None
    stage = destination / 'stage'
    stage.mkdir()
    total = 0
    with tarfile.open(archive, 'r:gz') as source:
        for entry in source:
            parts = PurePosixPath(entry.name).parts
            if len(parts) < 3 or parts[1] != 'pythonanywhere':
                continue
            relative = parts[2:]
            if '..' in relative or EXCLUDED.intersection(relative):
                continue
            if entry.isdir():
                continue
            if not entry.isfile() or entry.size > 16 * 1024 * 1024:
                raise ValueError('Unsafe release archive member')
            total += entry.size
            if total > 64 * 1024 * 1024:
                raise ValueError('Extracted release exceeds 64 MiB')
            path = stage.joinpath(*relative)
            path.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(entry) as src, path.open('wb') as dst:
                shutil.copyfileobj(src, dst)
    for required in ('requirements.txt', 'wsgi.py', 'scraper4/__init__.py', 'scraper4/services/updates.py'):
        if not (stage / required).is_file():
            raise ValueError('Incomplete release archive')
    return stage


def code_files(base):
    candidates = [base / name for name in ROOT_FILES]
    for directory in ('scraper4', 'tests'):
        folder = base / directory
        if folder.is_dir() and not folder.is_symlink():
            candidates.extend(folder.rglob('*'))
    return [path for path in candidates if path.is_file() and
            not EXCLUDED.intersection(path.relative_to(base).parts) and path.suffix != '.pyc' and
            not path.is_symlink()]


def install_code(source, base):
    # Never follow a pre-existing symlink when copying managed code.
    for path in code_files(source):
        relative = path.relative_to(source)
        target = base / relative
        if any(parent.is_symlink() for parent in [target, *target.parents] if parent != base.parent):
            raise ValueError('Symlink found in application path')
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_name(target.name + '.s4-new')
        shutil.copyfile(path, temp)
        os.replace(temp, target)
    for directory in ('scraper4', 'tests'):
        for cache in (base / directory).rglob('__pycache__'):
            if cache.is_dir() and not cache.is_symlink():
                shutil.rmtree(cache)


def run_checked(command, cwd, *, env=None):
    # Keep subprocess output private (may include sensitive environment details).
    try:
        process = subprocess.run(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, timeout=300, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise ValueError('Release validation/dependency process failed or timed out') from None
    if process.returncode:
        raise ValueError('Release validation/dependency process failed')


def validate_code(base, settings):
    env = dict(os.environ)
    env['S4_ENV_FILE'] = str(settings.base_dir / '.env')
    env['S4_BASE_DIR'] = str(settings.base_dir)
    # DB is not migrated by the updater. An app requiring future migrations must
    # supply a backwards-compatible release; schema validation runs read-only.
    script = ('import ast, pathlib; '
              '[ast.parse(p.read_text(encoding="utf-8")) for p in pathlib.Path("scraper4").rglob("*.py")]; '
              'from scraper4 import create_app; from scraper4.services.engine import selftest; '
              'from scraper4.services.updates import status; '
              'import tempfile; from pathlib import Path; from scraper4.config import Settings; '
              'tmp = tempfile.TemporaryDirectory(); '
              'cfg = Settings(base_dir=Path(tmp.name), db_path=Path(tmp.name)/"check.sqlite3", '
              'secret_key="release-validation-only", password="validation-only"); '
              'app = create_app(cfg); '
              'assert app.test_client().get("/login").status_code == 200; '
              'assert selftest(app.extensions["s4_db"], cfg)["ok"]; '
              'tmp.cleanup(); print("imports-and-selftest-ok")')
    run_checked([sys.executable, '-c', script], base, env=env)


def apply_update(db, settings, commit):
    base = settings.base_dir.resolve()
    if not db.get_config('pythonanywhere'):
        raise ValueError('Configure PythonAnywhere API before enabling automatic code updates')
    current = read_release(base)
    if current.get('commit') == commit:
        return {'ok': True, 'changed': False, 'commit': commit}
    with tempfile.TemporaryDirectory(prefix='scraper4-update-') as directory:
        stage = download(commit, Path(directory))
        # Validate before changing installed code. All downloads are from the fixed repo.
        run_checked([sys.executable, '-m', 'compileall', '-q', 'scraper4'], stage)
        backup_root = settings.db_path.parent / 'releases'
        backup_root.mkdir(parents=True, exist_ok=True)
        backup = backup_root / (time.strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8])
        (backup / 'code').mkdir(parents=True)
        install_code(base, backup / 'code')
        (backup / 'release.json').write_text(json.dumps(current))
        with sqlite3.connect(str(backup / 'database.sqlite3')) as target, db.connect() as source:
            source.backup(target)
        marker = base / '.maintenance.json'
        marker.write_text(json.dumps({'started': time.time(), 'operation': 'update'}))
        db.checkpoint_write('updates:backup', {'path': str(backup)})
        safe_to_serve = False
        try:
            old_requirements = (base / 'requirements.txt').read_bytes()
            if old_requirements != (stage / 'requirements.txt').read_bytes():
                run_checked([sys.executable, '-m', 'pip', 'install', '-r', str(stage / 'requirements.txt')], stage)
            validate_code(stage, settings)
            install_code(stage, base)
            validate_code(base, settings)
            (base / '.release.json').write_text(json.dumps({'commit': commit, 'installed_at': utc_now()}))
            cfg = db.get_config('pythonanywhere')
            if cfg:
                from .platform import PythonAnywhere
                PythonAnywhere(cfg).reload()
            else:
                raise ValueError('PythonAnywhere API is not configured; cannot activate new code automatically')
            safe_to_serve = True
        except Exception:
            old_files = {p.relative_to(backup / 'code') for p in code_files(backup / 'code')}
            for path in code_files(stage):
                relative = path.relative_to(stage)
                if relative not in old_files:
                    (base / relative).unlink(missing_ok=True)
            install_code(backup / 'code', base)
            (base / '.release.json').write_text(json.dumps(current))
            # Best-effort activation of the restored code; never hide the original error.
            try:
                from .platform import PythonAnywhere
                PythonAnywhere(db.get_config('pythonanywhere')).reload()
                safe_to_serve = True
            except Exception:
                pass
            raise
        finally:
            if safe_to_serve:
                marker.unlink(missing_ok=True)
        # Keep only two completed code/database snapshots, never application data.
        snapshots = sorted(p for p in backup_root.iterdir() if p.is_dir() and
                           re.fullmatch(r'\d{8}T\d{6}-[0-9a-f]{8}', p.name) and
                           (p / 'release.json').is_file() and (p / 'code').is_dir())
        for old in snapshots[:-2]:
            shutil.rmtree(old)
        return {'ok': True, 'changed': True, 'commit': commit}


def rollback(db, settings):
    backup = Path(db.checkpoint_read('updates:backup').get('path', ''))
    root = (settings.db_path.parent / 'releases').resolve()
    if not backup.is_dir() or backup.resolve().parent != root or not (backup / 'code').is_dir():
        raise ValueError('No valid code rollback snapshot')
    validate_code(backup / 'code', settings)
    marker = settings.base_dir / '.maintenance.json'
    marker.write_text(json.dumps({'started': time.time(), 'operation': 'rollback'}))
    old_files = {p.relative_to(backup / 'code') for p in code_files(backup / 'code')}
    for path in code_files(settings.base_dir):
        if path.relative_to(settings.base_dir) not in old_files:
            path.unlink()
    install_code(backup / 'code', settings.base_dir)
    release = json.loads((backup / 'release.json').read_text())
    (settings.base_dir / '.release.json').write_text(json.dumps(release))
    from .platform import PythonAnywhere
    PythonAnywhere(db.get_config('pythonanywhere')).reload()
    marker.unlink(missing_ok=True)
    cfg = update_config(db)
    cfg['enabled'] = False
    db.checkpoint_write('updates:config', cfg)
    return {'ok': True, 'commit': release.get('commit'), 'database_restored': False, 'auto_update_disabled': True}


def maintain(db, settings):
    """Called with the worker lock held; run the worker in a fresh process later."""
    request = db.checkpoint_read('maintenance:request')
    marker = settings.base_dir / '.maintenance.json'
    if marker.exists():
        # The worker lock is held, so no live installer owns this marker.
        try:
            recovered = rollback(db, settings)
        except Exception:
            return {'ok': False, 'error': 'Interrupted update could not be recovered; maintenance mode remains active'}
        request.update(status='failed', error='Interrupted update restored from code snapshot')
        db.checkpoint_write('maintenance:request', request)
        return {'ok': False, 'recovered': recovered, 'error': request['error']}
    # A CLI killed mid-update must never blindly rerun an ambiguous operation.
    if request.get('status') == 'running':
        request.update(status='failed', error='Maintenance interrupted; inspect status and retry explicitly')
        db.checkpoint_write('maintenance:request', request)
        return {'ok': False, 'error': request['error']}
    explicit = request.get('status') == 'pending'
    cfg = update_config(db)
    action = request.get('action') if explicit else 'auto'
    state = db.checkpoint_read('updates:state')
    if not explicit and not db.get_config('pythonanywhere').get('token'):
        return {'ok': True, 'skipped': True, 'reason': 'Enter PythonAnywhere API token in the web panel to enable automatic updates'}
    if not explicit and (not cfg['enabled'] or time.time() - state.get('checked_epoch', 0) < cfg['interval_seconds']):
        return {'ok': True, 'skipped': True}
    if explicit:
        request.update(status='running', started_at=utc_now())
        db.checkpoint_write('maintenance:request', request)
    try:
        if action in ('check', 'update', 'auto'):
            result = check(db, settings)
            if action != 'check' and result['available']:
                result.update(apply_update(db, settings, result['latest']))
                result['available'] = False
                db.checkpoint_write('updates:state', result)
        elif action == 'reload':
            from .platform import PythonAnywhere
            result = PythonAnywhere(db.get_config('pythonanywhere')).reload()
        elif action == 'configure':
            from .platform import PythonAnywhere
            result = PythonAnywhere(db.get_config('pythonanywhere')).provision(db, settings)
        elif action == 'rollback':
            result = rollback(db, settings)
        else:
            raise ValueError('Invalid maintenance action')
        result = {'ok': True, **result}
        if explicit:
            request.update(status='done', result=result, done_at=utc_now())
            db.checkpoint_write('maintenance:request', request)
        return result
    except Exception as exc:
        # Errors generated here/platform are credential-free. Unexpected errors
        # intentionally do not disclose paths, subprocess output or raw responses.
        error = str(exc) if isinstance(exc, ValueError) else 'Maintenance failed; inspect local server configuration'
        state = db.checkpoint_read('updates:state')
        state.update(error=error, checked_epoch=time.time(), checked_at=utc_now())
        db.checkpoint_write('updates:state', state)
        if explicit:
            request.update(status='failed', error=error, done_at=utc_now())
            db.checkpoint_write('maintenance:request', request)
        return {'ok': False, 'error': error}
