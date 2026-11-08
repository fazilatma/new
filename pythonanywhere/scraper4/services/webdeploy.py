"""Signed, code-only deployment inside a bounded HTTP request.

No subprocess/pip/shell/threads, dependency changes or schema migration. The
published proof is an authorization to deploy ONE fixed-repository source tree,
not a secret bearer token. Whoever relays it cannot change the approved code.
The private signer stays on the coding agent's filesystem, never on the host.
"""
import ast
import base64
import fcntl
import json
import re
import sqlite3
import tempfile
import time
import uuid
from pathlib import Path

import requests
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from jinja2 import Environment

from ..db import utc_now
from . import updates
from .platform import PythonAnywhere, PlatformError

PROTOCOL = 'scraper4-code-deploy-v1'
FIELDS = {'protocol', 'host', 'tree', 'nonce', 'issued', 'expires'}
MAX_TTL = 900


class DeployError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def authority():
    return json.loads(Path(__file__).parents[1].joinpath('deploy_authority.json').read_text())


def canonical(proof):
    return json.dumps({key: proof[key] for key in sorted(FIELDS)}, sort_keys=True,
                      separators=(',', ':'), ensure_ascii=True).encode()


def verify_proof(proof, host):
    if not isinstance(proof, dict) or set(proof) != FIELDS | {'signature'}:
        raise DeployError('A signed release proof is required', 401)
    trusted = authority()
    if proof['protocol'] != PROTOCOL or host != trusted['host'] or proof['host'] != trusted['host']:
        raise DeployError('Release proof is not valid for this host', 403)
    if not isinstance(proof['tree'], str) or not updates.SHA.fullmatch(proof['tree']):
        raise DeployError('Invalid source tree', 401)
    if not isinstance(proof['nonce'], str) or not re.fullmatch(r'[0-9a-f]{32}', proof['nonce']):
        raise DeployError('Invalid release nonce', 401)
    issued, expires = proof['issued'], proof['expires']
    if type(issued) is not int or type(expires) is not int or not issued < expires <= issued + MAX_TTL:
        raise DeployError('Invalid release lifetime', 401)
    now = time.time()
    if issued > now + 30 or expires < now:
        raise DeployError('Release proof is expired or not yet valid', 401)
    try:
        signature = base64.b64decode(proof['signature'], validate=True)
        public = base64.b64decode(trusted['public_key'], validate=True)
        Ed25519PublicKey.from_public_bytes(public).verify(signature, canonical(proof))
    except (InvalidSignature, ValueError, TypeError):
        raise DeployError('Invalid release signature', 401) from None
    return proof


def decode_proof(value):
    try:
        if not isinstance(value, str) or len(value) > 2048:
            raise ValueError()
        return json.loads(base64.b64decode(value + '=' * (-len(value) % 4), altchars=b'-_', validate=True))
    except (ValueError, TypeError, UnicodeError):
        raise DeployError('A valid encoded release proof is required', 401) from None


def github_json(path):
    try:
        response = requests.get(f'https://api.github.com/repos/{updates.REPO}/{path}',
            headers={'Accept': 'application/vnd.github+json'}, timeout=(3, 8), allow_redirects=False)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        raise DeployError('GitHub release lookup failed', 502) from None


def approved_tip(proof):
    # A proof names the pythonanywhere subtree, not a caller-supplied SHA/URL.
    # The proof-publishing commit only changes .github/, outside that subtree.
    tip = github_json('commits/' + requests.utils.quote(updates.REF, safe=''))
    try:
        commit = tip['sha']
        root = tip['commit']['tree']['sha']
        if not updates.SHA.fullmatch(commit) or not updates.SHA.fullmatch(root):
            raise KeyError()
        tree = github_json('git/trees/' + root)
        entry = next(row for row in tree['tree'] if row['path'] == 'pythonanywhere' and row['type'] == 'tree')
    except (KeyError, TypeError, StopIteration):
        raise DeployError('Invalid GitHub source-tree response', 502) from None
    if entry['sha'] != proof['tree']:
        raise DeployError('The branch changed after this release was approved; publish a fresh proof', 409)
    return commit


def validate_stage(stage, base):
    # Changes requiring installation/migration must use the existing CLI path.
    for name in ('requirements.txt', 'scraper4/db.py', 'scraper4/deploy_authority.json'):
        old, new = base / name, stage / name
        if not old.is_file() or not new.is_file() or old.read_bytes() != new.read_bytes():
            raise DeployError('Dependencies, database code or deployment authority changed; use the CLI installer', 409)
    for name in ('scraper4/__init__.py', 'scraper4/config.py', 'scraper4/deploy.py',
                 'scraper4/templates/login.html', 'scraper4/templates/layout.html'):
        if not (stage / name).is_file():
            raise DeployError('Incomplete deployable release', 409)
    files = updates.code_files(stage)
    if len(files) > 2000 or sum(path.stat().st_size for path in files) > 16 * 1024 * 1024:
        raise DeployError('HTTP code deployment is too large; use the CLI installer', 409)
    # Parse/compile without importing or executing staged Python code.
    for path in (stage / 'scraper4').rglob('*.py'):
        compile(path.read_text(encoding='utf-8'), str(path), 'exec', dont_inherit=True)
    env = Environment()
    for path in (stage / 'scraper4/templates').rglob('*.html'):
        env.parse(path.read_text(encoding='utf-8'))
    config = ast.parse((stage / 'scraper4/config.py').read_text())
    for node in config.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'VERSION' for t in node.targets):
            if isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
                return node.value.value
    raise DeployError('Release version cannot be determined', 409)


def replace_code(source, base):
    old = {p.relative_to(base) for p in updates.code_files(base)}
    new = {p.relative_to(source) for p in updates.code_files(source)}
    updates.install_code(source, base)
    for relative in old - new:
        target = base / relative
        if target.is_symlink():
            raise DeployError('Symlinks in managed code are not accepted', 409)
        target.unlink(missing_ok=True)


def snapshot(db, settings):
    root = settings.db_path.parent / 'releases'
    root.mkdir(parents=True, exist_ok=True)
    root.chmod(0o700)
    folder = root / (time.strftime('%Y%m%dT%H%M%S') + '-' + uuid.uuid4().hex[:8])
    folder.mkdir(mode=0o700)
    (folder / 'code').mkdir()
    files = updates.code_files(settings.base_dir)
    if len(files) > 2000 or sum(path.stat().st_size for path in files) > 16 * 1024 * 1024:
        raise DeployError('Installed code snapshot is too large; use the CLI installer', 409)
    updates.install_code(settings.base_dir, folder / 'code')
    release = updates.read_release(settings.base_dir)
    (folder / 'release.json').write_text(json.dumps(release))
    backup = folder / 'database.sqlite3'
    deadline = time.monotonic() + 8
    try:
        with sqlite3.connect(str(backup)) as target, db.connect() as source:
            page_size = source.execute('PRAGMA page_size').fetchone()[0]
            def progress(status, remaining, total):
                if time.monotonic() > deadline or total * page_size > 64 * 1024 * 1024:
                    raise DeployError('Database snapshot exceeds HTTP deployment limits; use the CLI installer', 409)
            source.backup(target, pages=64, progress=progress, sleep=0.05)
    except Exception:
        import shutil
        shutil.rmtree(folder)
        raise
    backup.chmod(0o600)
    db.checkpoint_write('updates:backup', {'path': str(folder)})
    return folder, release


def request_reload(api, result, db, task):
    # Clear maintenance BEFORE reload: a recycled WSGI worker cannot strand the
    # maintenance marker if it dies immediately after the API accepts reload.
    now = time.time()
    if result.get('reload_attempts', 0) >= 3 or now - result.get('last_reload_epoch', 0) < 30:
        result['retry_after'] = 30
        return result
    result.update(reload_attempts=result.get('reload_attempts', 0) + 1, last_reload_epoch=now)
    result.pop('retry_after', None)
    db.checkpoint_write(task, result)
    try:
        api.reload()
        result.update(state='reload_requested', reload_requested=True)
        result.pop('error', None)
    except PlatformError as exc:
        # The API may have accepted reload before a network timeout. Keep valid
        # installed code; never roll back a possibly active release blindly.
        result.update(state='reload_pending', reload_requested=False, error=str(exc))
    return result


def deploy_locked(db, settings, proof):
    task = 'agent-deploy:' + proof['nonce']
    previous = db.checkpoint_read(task)
    if previous:
        if previous.get('source_tree') != proof['tree']:
            raise DeployError('This nonce was already used for another source tree', 409)
        if previous.get('state') == 'preparing':
            previous.update(ok=False, state='interrupted', error='An earlier request was interrupted; publish a fresh proof')
            db.checkpoint_write(task, previous)
        if previous.get('state') == 'reload_pending':
            if updates.read_release(settings.base_dir).get('commit') == previous.get('commit'):
                cfg = db.get_config('pythonanywhere')
                if cfg.get('domain') != proof['host']:
                    raise DeployError('Saved deployment host changed; publish a fresh request after fixing configuration', 409)
                api = PythonAnywhere(cfg, timeout=(3, 7))
                previous = request_reload(api, previous, db, task)
                db.checkpoint_write(task, previous)
        return {**previous, 'replayed': True}
    cfg = db.get_config('pythonanywhere')
    if not cfg.get('token'):
        raise DeployError('Save the PythonAnywhere API token in the web panel first', 409)
    if cfg.get('domain') != proof['host']:
        raise DeployError('Saved PythonAnywhere domain differs from the approved deployment host', 409)
    api = PythonAnywhere(cfg, timeout=(3, 7))
    web = api.call('GET', api.web_path)
    source = web.get('source_directory', '') if isinstance(web, dict) else ''
    if source and Path(source).resolve() != settings.base_dir.resolve():
        raise DeployError('Web source directory differs from the installed application; no files changed', 409)
    commit = approved_tip(proof)
    result = {'ok': True, 'state': 'preparing', 'commit': commit, 'source_tree': proof['tree'],
              'nonce': proof['nonce'], 'expires': proof['expires'], 'live_verified': False,
              'verify_url': '/healthz'}
    # Persist before download. A repeated proof does not repeat an ambiguous write.
    db.checkpoint_write(task, result)
    marker = settings.base_dir / '.maintenance.json'
    try:
        with tempfile.TemporaryDirectory(prefix='scraper4-http-deploy-') as folder:
            stage = updates.download(commit, Path(folder), timeout=(3, 8),
                                     max_bytes=8*1024*1024, budget_seconds=15)
            version = validate_stage(stage, settings.base_dir)
            backup, old_release = snapshot(db, settings)
            if not db.checkpoint_read('deploy:config').get('enabled', True):
                raise DeployError('Deployment was disabled during preparation; no code files changed', 403)
            marker.write_text(json.dumps({'operation': 'signed-code-deploy', 'started': time.time()}))
            try:
                replace_code(stage, settings.base_dir)
                (settings.base_dir / '.release.json').write_text(json.dumps({
                    'commit': commit, 'source_tree': proof['tree'], 'installed_at': utc_now()}))
            except Exception:
                # Restore the full managed file set, including deleted/new files.
                replace_code(backup / 'code', settings.base_dir)
                (settings.base_dir / '.release.json').write_text(json.dumps(old_release))
                marker.unlink(missing_ok=True)
                raise
            result.update(changed=True, version=version, state='reload_pending')
            db.checkpoint_write(task, result)
            marker.unlink(missing_ok=True)
            result = request_reload(api, result, db, task)
            db.checkpoint_write(task, result)
        # Keep at most two complete private snapshots, same format as CLI rollback.
        root = backup.parent
        snapshots = sorted(p for p in root.iterdir() if p.is_dir() and
                           re.fullmatch(r'\d{8}T\d{6}-[0-9a-f]{8}', p.name) and
                           (p/'release.json').is_file() and (p/'code').is_dir())
        for old in snapshots[:-2]:
            import shutil
            shutil.rmtree(old)
    except Exception as exc:
        result.update(ok=False, state='failed', error=str(exc) if isinstance(exc, (DeployError, PlatformError)) else
                      'Code deployment failed; inspect the server log or CLI maintenance recovery',
                      http_status=exc.status if isinstance(exc, DeployError) else 500)
        db.checkpoint_write(task, result)
        if not isinstance(exc, (DeployError, PlatformError)):
            raise
    return result


def deploy_code(db, settings, proof):
    lock = settings.db_path.with_suffix('.worker.lock')
    with lock.open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'ok': False, 'busy': True, 'error': 'A worker or updater is active; retry this proof'}, 409
        # Bounded retention: only expired request records are removed.
        with db.connect() as conn:
            rows = conn.execute("SELECT task,state FROM task_checkpoints WHERE task LIKE 'agent-deploy:%'").fetchall()
            active = 0
            for row in rows:
                if json.loads(row['state']).get('expires', 0) < time.time():
                    conn.execute('DELETE FROM task_checkpoints WHERE task=?', (row['task'],))
                else:
                    active += 1
            if active >= 128 and not any(row['task'] == 'agent-deploy:' + proof['nonce'] for row in rows):
                raise DeployError('Too many release requests; wait for expiry', 429)
        try:
            result = deploy_locked(db, settings, proof)
        except (DeployError, PlatformError) as exc:
            # Cache failed approvals too. Relaying a public stale proof must not
            # repeatedly consume GitHub/API requests or permit retry floods.
            result = {'ok': False, 'state': 'failed', 'source_tree': proof['tree'],
                      'nonce': proof['nonce'], 'expires': proof['expires'], 'error': str(exc),
                      'live_verified': False, 'http_status': exc.status if isinstance(exc, DeployError) else 502}
            db.checkpoint_write('agent-deploy:' + proof['nonce'], result)
        status = result.pop('http_status', None) or (202 if result.get('state') == 'reload_pending' else 200)
        if not result.get('ok') and status == 200:
            status = 409
        return result, status
