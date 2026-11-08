"""Flask application factory: WSGI only serves short requests and job polling."""
import csv
import hashlib
import hmac
import io
import json
import os
import secrets
import time
from collections import defaultdict

from flask import Flask, Response, abort, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

from .config import Settings, VERSION
from .db import DB
from .services.scraping.fetch import validate_url
from .services.scraping.pagination import TYPES, build_urls
from .services.support.url import profile_key


def create_app(settings=None):
    settings = settings or Settings.load()
    settings.ensure_dirs()
    settings.ensure_secret()
    if not settings.password:
        raise RuntimeError('S4_PASSWORD is required. Run pythonanywhere/install.sh first.')
    app = Flask(__name__)
    app.config.update(SECRET_KEY=settings.secret_key, MAX_CONTENT_LENGTH=2 * 1024 * 1024,
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax',
                      SESSION_COOKIE_SECURE=os.environ.get('S4_COOKIE_SECURE', '1') != '0',
                      PERMANENT_SESSION_LIFETIME=3600)
    db = DB(settings.db_path, settings.secret_key)
    app.extensions['s4_db'] = db
    app.extensions['s4_settings'] = settings
    failures = defaultdict(list)

    def csrf():
        if 'csrf' not in session:
            session['csrf'] = secrets.token_urlsafe(32)
        return session['csrf']

    app.jinja_env.globals['csrf_token'] = csrf

    @app.before_request
    def protect():
        marker = settings.base_dir / '.maintenance.json'
        if marker.exists() and not request.path.startswith('/static/') and request.path not in (
                '/api/system/status', '/api/updates/status', '/login', '/logout', '/settings/pythonanywhere',
                '/api/platform/config', '/api/platform/test'):
            return jsonify(ok=False, error='Maintenance in progress'), 503, {'Retry-After': '30'}
        if request.endpoint == 'admin.health':
            return
        bearer = request.headers.get('Authorization', '')
        if bearer:
            scheme, _, value = bearer.partition(' ')
            expected = db.get_config('api_auth').get('sha256', '')
            if scheme.lower() != 'bearer' or not value or not expected or not hmac.compare_digest(hashlib.sha256(value.encode()).hexdigest(), expected):
                return jsonify(ok=False, error='Invalid API token'), 401
            request.environ['s4.bearer'] = True
        if request.endpoint == 'static':
            return
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and not request.environ.get('s4.bearer'):
            supplied = request.headers.get('X-CSRF-Token') or request.form.get('csrf', '')
            if not supplied or not hmac.compare_digest(supplied, session.get('csrf', '')):
                abort(400, 'CSRF validation failed. Refresh the page.')
        if request.endpoint != 'login' and not session.get('authenticated') and not request.environ.get('s4.bearer'):
            if request.path.startswith('/api/'):
                return jsonify(ok=False, error='Authentication required'), 401
            return redirect(url_for('login'))

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(ValueError)
    def invalid(exc):
        return jsonify(ok=False, error=str(exc)), 400

    @app.errorhandler(400)
    @app.errorhandler(404)
    def http_error(exc):
        return jsonify(ok=False, error=exc.description), exc.code

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        error = ''
        if request.method == 'POST':
            # WSGI-local throttling; configure platform/WAF rate limits for shared deployments.
            key = request.remote_addr or 'unknown'
            now = time.monotonic()
            failures[key] = [t for t in failures[key] if t > now - 300]
            if len(failures[key]) >= 10:
                return render_template('login.html', error='تلاش‌های زیاد؛ پنج دقیقه بعد امتحان کنید.'), 429
            password = request.form.get('password', '')
            stored = settings.password
            valid = check_password_hash(stored, password) if stored.startswith(('scrypt:', 'pbkdf2:')) else hmac.compare_digest(password.encode(), stored.encode())
            if valid:
                failures.pop(key, None)
                session.clear()
                session['authenticated'] = True
                session.permanent = True
                csrf()
                return redirect(url_for('dashboard'))
            failures[key].append(now)
            error = 'رمز عبور نادرست است.'
        return render_template('login.html', error=error)

    @app.post('/logout')
    def logout():
        session.clear()
        return redirect(url_for('login'))

    @app.get('/')
    def dashboard():
        return render_template('dashboard.html', stats=db.stats(), profiles=db.list_profiles())

    @app.get('/api/ping')
    def ping():
        return jsonify(ok=True, version=VERSION, source_commit='5aa1012d767a1b9f9a9ca43064c7fc3dc35976d3')

    @app.get('/api/pagination/preview')
    def preview():
        url = validate_url(request.args.get('url', ''))
        kind, val = request.args.get('type', 'query_page'), request.args.get('val', '')
        if kind not in TYPES:
            raise ValueError('Unknown pagination type')
        return jsonify(ok=True, type=kind, val=val, urls=build_urls(url, kind, val, min(100, max(1, int(request.args.get('pages', 3))))))

    @app.route('/api/profiles', methods=['GET', 'POST'])
    def profiles():
        if request.method == 'GET':
            return jsonify(ok=True, profiles=db.list_profiles())
        data = request.get_json()
        if not isinstance(data, dict):
            raise ValueError('Expected a JSON object')
        url = validate_url(str(data.get('url', '')))
        selectors = data.get('selectors') or {}
        pagination = data.get('pagination') or {'type': 'query_page', 'val': ''}
        if not isinstance(selectors, dict) or any(not isinstance(v, str) for v in selectors.values()):
            raise ValueError('Selectors must be a JSON object of CSS strings')
        if not isinstance(pagination, dict) or pagination.get('type') not in TYPES:
            raise ValueError('Unknown pagination type')
        if pagination['type'] == 'next_selector' and not pagination.get('val'):
            raise ValueError('Next-link CSS selector is required')
        if pagination['type'] == 'full_pattern':
            validate_url(str(pagination.get('val', '')).replace('{page}', '2'))
        return jsonify(ok=True, profile=db.upsert_profile(str(data.get('key') or profile_key(url)), url,
                       name=str(data.get('name') or ''), selectors=selectors, pagination=pagination,
                       enabled=bool(data.get('enabled', True))))

    @app.delete('/api/profiles/<int:profile_id>')
    def delete_profile(profile_id):
        if any(e['profile_id'] == profile_id for e in db.list_entries(True, 10000)):
            raise ValueError('Cancel active jobs before deleting this profile')
        db.delete_profile(profile_id)
        return jsonify(ok=True)

    @app.get('/api/products')
    def products():
        pid = request.args.get('profile_id', type=int)
        return jsonify(ok=True, total=db.count_products(pid), products=db.list_products(pid,
                       limit=max(1, min(500, int(request.args.get('limit', 100)))), offset=max(0, int(request.args.get('offset', 0)))))

    @app.get('/api/export/<int:profile_id>')
    def export(profile_id):
        if not db.get_profile(profile_id):
            abort(404)
        rows = db.list_products(profile_id, limit=100000)
        if request.args.get('format') == 'json':
            return Response(json.dumps(rows, ensure_ascii=False), mimetype='application/json',
                            headers={'Content-Disposition': f'attachment; filename=products-{profile_id}.json'})
        out = io.StringIO()
        writer = csv.writer(out)
        fields = ['title', 'price', 'price_num', 'link', 'image', 'sku', 'woo_id', 'basalam_id']
        writer.writerow(fields)
        for row in rows:
            values = [str(row.get(f) or '') for f in fields]
            writer.writerow(["'" + v if v.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in values])
        return Response('\ufeff' + out.getvalue(), mimetype='text/csv; charset=utf-8',
                        headers={'Content-Disposition': f'attachment; filename=products-{profile_id}.csv'})

    @app.route('/api/jobs', methods=['GET', 'POST'])
    def jobs():
        if request.method == 'GET':
            return jsonify(ok=True, jobs=db.list_entries(limit=100), stats=db.stats())
        data = request.get_json() or {}
        kind = data.get('kind', 'extract')
        if kind not in ('extract', 'woo_send', 'bsl_send'):
            raise ValueError('Unknown job kind')
        profile = db.get_profile(int(data.get('profile_id', 0)))
        if not profile:
            abort(404, 'Profile not found')
        payload = {k: data[k] for k in ('pages', 'render', 'force', 'category_id', 'status') if k in data}
        payload['pages'] = max(1, min(100, int(payload.get('pages', settings.max_pages))))
        if payload.get('render', 'static') not in ('static', 'auto', 'js'):
            raise ValueError('Unknown render mode')
        if payload.get('status', 'draft') not in ('draft', 'publish', 'pending'):
            raise ValueError('Invalid product status')
        return jsonify(ok=True, id=db.enqueue(kind, profile['id'], payload)), 202

    @app.get('/api/jobs/<int:entry_id>')
    def job(entry_id):
        entry = db.get_entry(entry_id)
        if not entry:
            abort(404)
        return jsonify(ok=True, job=entry)

    @app.post('/api/jobs/<int:entry_id>/<action>')
    def control(entry_id, action):
        entry = db.get_entry(entry_id)
        if not entry:
            abort(404)
        states = {'pause': 'paused', 'resume': 'waiting', 'cancel': 'cancelled'}
        if action not in states:
            abort(404)
        if entry['status'] in ('done', 'cancelled'):
            raise ValueError('Completed/cancelled jobs cannot be resumed; create a new job')
        if action == 'resume' and entry['status'] not in ('paused', 'failed'):
            raise ValueError('Only paused/failed jobs can be resumed')
        db.update_entry(entry_id, status=states[action], error='')
        return jsonify(ok=True)

    @app.route('/api/connections/<name>', methods=['GET', 'POST'])
    def connections(name):
        allowed = {'woocommerce': {'store_url', 'consumer_key', 'consumer_secret'},
                   'basalam': {'token', 'vendor_id', 'category_id'}}
        if name not in allowed:
            abort(404)
        if request.method == 'GET':
            cfg = db.get_config(name)
            return jsonify(ok=True, configured=bool(cfg), fields={k: ('••••' if k in ('token', 'consumer_key', 'consumer_secret') and v else v)
                           for k, v in cfg.items() if k in allowed[name]})
        data = request.get_json() or {}
        cfg = db.get_config(name)
        for key in allowed[name]:
            if key in data and data[key] != '••••':
                cfg[key] = str(data[key])
        if cfg.get('store_url'):
            validate_url(cfg['store_url'])
        db.put_config(name, cfg)
        return jsonify(ok=True)

    from .admin import register_admin
    register_admin(app, db, settings)
    return app
