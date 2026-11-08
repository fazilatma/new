"""Deployment request/auth boundary; intentionally separate from public queue cron."""
from flask import Blueprint, abort, jsonify, request, session

from .services import webdeploy


def register_deploy(app, db, settings):
    bp = Blueprint('deploy', __name__)

    @bp.route('/api/deploy/config', methods=['GET', 'POST'])
    def config():
        value = {'enabled': True, **db.checkpoint_read('deploy:config')}
        if request.method == 'GET':
            trusted = webdeploy.authority()
            return jsonify(ok=True, config=value, host=trusted['host'],
                           ready=bool(db.get_config('pythonanywhere').get('token')) and
                                 db.get_config('pythonanywhere').get('domain') == trusted['host'],
                           mode='signed_code_only', code_updates_require_task=False)
        if not session.get('authenticated') or request.environ.get('s4.bearer'):
            abort(403)
        data = request.get_json()
        if not isinstance(data, dict) or set(data) != {'enabled'} or type(data['enabled']) is not bool:
            raise ValueError('Expected {"enabled": true|false}')
        db.checkpoint_write('deploy:config', data)
        return jsonify(ok=True, config=data)

    @bp.route('/api/deploy/run', methods=['GET', 'POST'])
    def run():
        # GET relays a PUBLIC signed release proof (also committed to GitHub).
        # It is not a secret token in a URL. The signature approves one code
        # tree/host for 15 minutes, not caller-chosen commands or repositories.
        if request.method == 'HEAD':
            return jsonify(ok=False, error='HEAD never performs a deployment'), 405
        try:
            if request.method == 'GET':
                if request.content_length or set(request.args) != {'proof'} or len(request.args.getlist('proof')) != 1:
                    raise webdeploy.DeployError('A signed release proof is required', 401)
                proof = webdeploy.decode_proof(request.args['proof'])
            else:
                request.max_content_length = 4096
                if request.args or (request.content_length or 0) > 4096:
                    raise webdeploy.DeployError('Invalid deployment request')
                data = request.get_json(silent=True)
                if not isinstance(data, dict) or set(data) != {'proof'}:
                    raise webdeploy.DeployError('A signed release proof is required', 401)
                proof = data['proof']
            proof = webdeploy.verify_proof(proof, request.host.lower())
            if not db.checkpoint_read('deploy:config').get('enabled', True):
                raise webdeploy.DeployError('Signed agent deployments are disabled by the administrator', 403)
            result, status = webdeploy.deploy_code(db, settings, proof)
            return jsonify(result), status
        except webdeploy.DeployError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status
        except ValueError as exc:
            # PlatformError/our downloader produce credential-free messages.
            return jsonify(ok=False, error=str(exc)), 502
        except Exception:
            app.logger.exception('Signed code deployment failed')
            return jsonify(ok=False, error='Code deployment failed; inspect server logs'), 500

    app.register_blueprint(bp)
