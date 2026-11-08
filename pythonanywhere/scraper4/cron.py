"""Single-step HTTP cron: authenticated POST or explicitly enabled public GET."""
import hashlib
import secrets

from flask import Blueprint, abort, jsonify, request, session

from .services.engine import http_tick


def register_cron(app, db, settings):
    bp = Blueprint('cron', __name__)

    @bp.route('/api/cron/config', methods=['GET', 'POST'])
    def config():
        current = {'public_get': False, **db.checkpoint_read('cron:config')}
        if request.method == 'GET':
            return jsonify(ok=True, config=current)
        if not session.get('authenticated') or request.environ.get('s4.bearer'):
            abort(403)
        data = request.get_json()
        if not isinstance(data, dict) or set(data) != {'public_get'} or not isinstance(data['public_get'], bool):
            raise ValueError('Expected {"public_get": true|false}')
        db.checkpoint_write('cron:config', {'public_get': data['public_get']})
        return jsonify(ok=True, config={'public_get': data['public_get']})

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
                       queue_alive=db.stats()['queue_alive'], mode='single_step', code_updates=False,
                       public_get=db.checkpoint_read('cron:config').get('public_get') is True)

    @bp.route('/api/cron/run', methods=['GET', 'POST'])
    def run():
        # GET is a deliberate, opt-in public trigger. Only existing jobs can
        # advance; parameters never select a URL, command, job or file.
        if request.args:
            raise ValueError('Cron query parameters are not accepted; call the bare cron URL')
        if request.content_length:
            data = request.get_json()
            if data != {}:
                raise ValueError('Cron body must be empty or {}')
        result = http_tick(db, settings)
        return jsonify(result), 503 if result.get('maintenance') else 200

    app.register_blueprint(bp)
