"""Authenticated management endpoints. Long operations are queued, never run in WSGI."""
import hashlib
import secrets

from flask import Blueprint, abort, current_app, jsonify, request, session

from .services import updates
from .services.engine import selftest


def register_admin(app, db, settings):
    bp = Blueprint('admin', __name__)

    @bp.get('/healthz')
    def health():
        return jsonify(ok=True)

    @bp.get('/api/endpoints')
    def endpoints():
        return jsonify(ok=True, endpoints=[{'path': str(rule), 'methods': sorted(rule.methods - {'HEAD', 'OPTIONS'})}
            for rule in current_app.url_map.iter_rules() if str(rule).startswith('/api/')])

    @bp.get('/api/system/status')
    def system_status():
        platform = db.get_config('pythonanywhere')
        return jsonify(ok=True, selftest=selftest(db, settings), updates=updates.status(db, settings),
                       platform={'configured': bool(platform), 'domain': platform.get('domain'),
                                 'provisioning': db.checkpoint_read('platform:status')}, stats=db.stats())

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
