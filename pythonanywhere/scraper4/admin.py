"""Authenticated management endpoints. Long operations are queued, never run in WSGI."""
import hashlib
import fcntl
import secrets
import json
from pathlib import Path

from flask import Blueprint, abort, current_app, jsonify, request, session, render_template

from .services import updates
from .services.engine import selftest
from .config import VERSION


def register_admin(app, db, settings):
    bp = Blueprint('admin', __name__)

    @bp.get('/healthz')
    def health():
        return jsonify(ok=True, version=VERSION,
                       commit=updates.read_release(settings.base_dir).get('commit'))

    @bp.get('/api/port-status')
    @bp.get('/api/parity/status')
    def parity_status():
        ledger = json.loads(Path(__file__).with_name('parity.json').read_text(encoding='utf-8'))
        return jsonify(ok=True, **ledger)

    @bp.get('/api/endpoints')
    def endpoints():
        return jsonify(ok=True, endpoints=[{'path': str(rule), 'methods': sorted(rule.methods - {'HEAD', 'OPTIONS'})}
            for rule in current_app.url_map.iter_rules() if str(rule).startswith('/api/')])

    @bp.get('/api/system/status')
    def system_status():
        platform = db.get_config('pythonanywhere')
        return jsonify(ok=True, selftest=selftest(db, settings), updates=updates.status(db, settings),
                       runtime={'version': VERSION, 'source_directory': str(settings.base_dir)},
                       platform={'configured': bool(platform.get('token')), 'domain': platform.get('domain'),
                                 'provisioning': db.checkpoint_read('platform:status')}, stats=db.stats())

    def browser_admin():
        if not session.get('authenticated') or request.environ.get('s4.bearer'):
            abort(403)

    @bp.get('/settings/pythonanywhere')
    def platform_page():
        return render_template('platform.html')

    @bp.route('/api/platform/config', methods=['GET', 'POST', 'DELETE'])
    def platform_config():
        from .services.platform import PythonAnywhere, web_defaults
        cfg = db.get_config('pythonanywhere')
        if request.method == 'GET':
            values = {**web_defaults(), **{k: v for k, v in cfg.items() if k in ('site', 'username', 'domain')}}
            return jsonify(ok=True, configured=bool(cfg.get('token')), fields=values,
                           test=db.checkpoint_read('platform:test'))
        browser_admin()
        if request.method == 'DELETE':
            db.put_config('pythonanywhere', {})
            db.checkpoint_clear('platform:test')
            db.checkpoint_clear('platform:status')
            return jsonify(ok=True)
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValueError('Expected a JSON object')
        candidate = {**web_defaults(), **cfg}
        for key in ('site', 'username', 'domain'):
            if key in data:
                if not isinstance(data[key], str):
                    raise ValueError('Platform fields must be strings')
                candidate[key] = data[key].strip()
        value = data.get('token', '')
        if not isinstance(value, str) or len(value) > 4096 or '\n' in value or '\r' in value:
            raise ValueError('Invalid token format')
        value = value.strip()
        identity_changed = any(candidate.get(k) != cfg.get(k) for k in ('site', 'username'))
        if not value and identity_changed and cfg.get('token'):
            raise ValueError('Enter a new token when changing API site/username')
        candidate['token'] = value or cfg.get('token', '')
        PythonAnywhere(candidate)  # local validation; saving does not call any external API
        db.put_config('pythonanywhere', candidate)
        db.checkpoint_clear('platform:test')
        db.checkpoint_clear('platform:status')
        return jsonify(ok=True, configured=True)

    @bp.post('/api/platform/test')
    def platform_test():
        browser_admin()
        from .services.platform import diagnose
        result = diagnose(db, timeout=(3, 7))
        db.checkpoint_write('platform:test', result)
        return jsonify(result)

    @bp.post('/api/platform/activate')
    def platform_activate():
        browser_admin()
        from .services.platform import PythonAnywhere, installed_python
        cfg = db.get_config('pythonanywhere')
        python = installed_python(settings)
        api = PythonAnywhere(cfg, timeout=(3, 7))
        # Bootstrap the scheduler once, without depending on a scheduler that
        # does not yet exist. No worker, installer, WSGI overwrite or reload here.
        with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return jsonify(ok=False, error='A worker/update is active; retry after it finishes'), 409
            api.call('GET', api.web_path)
            result = {'ok': True, 'domain': api.domain, 'web': 'already_serving'}
            result.update(api.ensure_task(settings, python=python))
            db.checkpoint_write('platform:status', result)
        return jsonify(result)

    @bp.get('/api/updates/status')
    def update_status():
        return jsonify(ok=True, **updates.status(db, settings))

    @bp.post('/api/updates/config')
    def update_config():
        data = request.get_json() or {}
        if not isinstance(data, dict) or not isinstance(data.get('enabled'), bool):
            raise ValueError('enabled must be a JSON boolean')
        interval = int(data.get('interval_seconds', 3600))
        if not 300 <= interval <= 604800:
            raise ValueError('Update interval must be between 300 and 604800 seconds')
        cfg = {'enabled': data['enabled'], 'interval_seconds': interval}
        db.checkpoint_write('updates:config', cfg)
        return jsonify(ok=True, config=cfg)

    @bp.post('/api/updates/check')
    @bp.post('/api/updates/apply')
    @bp.post('/api/updates/rollback')
    @bp.post('/api/system/reload')
    @bp.post('/api/system/configure')
    def maintenance():
        action = {'check': 'check', 'apply': 'update', 'rollback': 'rollback',
                  'reload': 'reload', 'configure': 'configure'}[request.path.rsplit('/', 1)[-1]]
        operation = updates.request_operation(db, action)
        return jsonify(ok=True, operation=operation, note='The scheduled maintenance task will execute this request.'), 202

    @bp.route('/api/auth/token', methods=['POST', 'DELETE'])
    def token():
        # Creating/revoking automation credentials requires a browser login + CSRF.
        if not session.get('authenticated') or request.environ.get('s4.bearer'):
            abort(403)
        if request.method == 'DELETE':
            db.put_config('api_auth', {})
            return jsonify(ok=True)
        value = secrets.token_urlsafe(48)
        db.put_config('api_auth', {'sha256': hashlib.sha256(value.encode()).hexdigest()})
        return jsonify(ok=True, token=value, warning='Save now. Full administrator access; shown only once.'), 201

    app.register_blueprint(bp)
