"""Authenticated single-step HTTP cron. Not a code updater or shell gateway."""
import hashlib
import secrets

from flask import Blueprint, abort, jsonify, request, session

from .services.engine import http_tick


def register_cron(app, db, settings):
    bp = Blueprint('cron', __name__)

    @bp.route('/api/cron/token', methods=['POST', 'DELETE'])
    def token():
        if not session.get('authenticated') or request.environ.get('s4.bearer'):
            abort(403)
        if request.method == 'DELETE':
            db.put_config('cron_auth', {})
            return jsonify(ok=True)
        value = secrets.token_urlsafe(48)
        db.put_config('cron_auth', {'sha256': hashlib.sha256(value.encode()).hexdigest()})
        return jsonify(ok=True, token=value, scope=['/api/cron/run', '/api/cron/status'],
                       warning='Save this cron-only key now. It is shown once.'), 201

    @bp.get('/api/cron/status')
    def status():
        return jsonify(ok=True, configured=bool(db.get_config('cron_auth').get('sha256')),
                       last=db.checkpoint_read('cron:last'),
                       queue_alive=db.stats()['queue_alive'], mode='single_step', code_updates=False)

    @bp.post('/api/cron/run')
    def run():
        # No URL keys, GET mutations, arbitrary commands, job IDs, paths or budgets.
        if request.args:
            raise ValueError('Cron parameters in the URL are not accepted; use an Authorization header')
        if request.content_length:
            data = request.get_json()
            if data != {}:
                raise ValueError('Cron body must be empty or {}')
        result = http_tick(db, settings)
        return jsonify(result), 503 if result.get('maintenance') else 200

    app.register_blueprint(bp)
