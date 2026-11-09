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

from .navigation import SETTINGS_MENU
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
    from .services.updates import read_release
    loaded_release = read_release(settings.base_dir)
    app.config['S4_LOADED_COMMIT'] = loaded_release.get('commit')
    failures = defaultdict(list)

    def csrf():
        if 'csrf' not in session:
            session['csrf'] = secrets.token_urlsafe(32)
        return session['csrf']

    app.jinja_env.globals['csrf_token'] = csrf

    @app.context_processor
    def build_context():
        from .services.scraping.engines import ENGINES, profile_engine
        from .services.settings_transfer import SECTIONS, MAX_FILE
        return {'app_version': VERSION, 'app_commit': str(loaded_release.get('commit') or 'local')[:12],
                'app_build': str(loaded_release.get('commit') or ''), 'settings_menu': SETTINGS_MENU, 'transfer_sections': SECTIONS, 'max_file_bytes': MAX_FILE, 'engine_choices': ENGINES, 'profile_engine': profile_engine}


    @app.before_request
    def protect():
        marker = settings.base_dir / '.maintenance.json'
        if marker.exists() and not request.path.startswith('/static/') and request.path not in (
                '/api/system/status', '/api/updates/status', '/login', '/logout', '/settings/pythonanywhere',
                '/api/platform/config', '/api/platform/test', '/api/cron/status'):
            return jsonify(ok=False, error='Maintenance in progress'), 503, {'Retry-After': '30'}
        if request.endpoint in ('admin.health', 'deploy.run'):
            # deploy.run validates its own Ed25519 release proof, never a public
            # cron key or session/CSRF bypass for any other route.
            return
        if request.endpoint == 'cron.run' and request.method in ('GET', 'HEAD'):
            if db.checkpoint_read('cron:config').get('public_get') is not True:
                return jsonify(ok=False, error='Public GET cron is disabled; enable it in the admin panel'), 403
            # A HEAD check must never advance a job (Flask adds HEAD to GET routes).
            if request.method == 'HEAD':
                return app.response_class(status=200)
            request.environ['s4.public_cron'] = True
            return
        bearer = request.headers.get('Authorization', '')
        if bearer:
            scheme, _, value = bearer.partition(' ')
            digest = hashlib.sha256(value.encode()).hexdigest()
            expected = db.get_config('api_auth').get('sha256', '')
            cron_expected = db.get_config('cron_auth').get('sha256', '')
            if scheme.lower() != 'bearer' or not value:
                return jsonify(ok=False, error='Invalid API token'), 401
            if expected and hmac.compare_digest(digest, expected):
                request.environ['s4.bearer'] = True
            elif cron_expected and hmac.compare_digest(digest, cron_expected):
                if request.endpoint not in ('cron.run', 'cron.status'):
                    return jsonify(ok=False, error='Cron key cannot access this endpoint'), 403
                request.environ['s4.bearer'] = True
                request.environ['s4.cron'] = True
            else:
                return jsonify(ok=False, error='Invalid API token'), 401
        if request.endpoint == 'static':
            return
        if request.endpoint == 'cron.run' and not session.get('authenticated') and not request.environ.get('s4.bearer'):
            return jsonify(ok=False, error='Cron Authorization header required'), 401
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and not request.environ.get('s4.bearer'):
            supplied = request.headers.get('X-CSRF-Token') or request.form.get('csrf', '')
            if not supplied or not hmac.compare_digest(supplied, session.get('csrf', '')):
                abort(400, 'CSRF validation failed. Refresh the page.')
        if request.endpoint != 'login' and not session.get('authenticated') and not request.environ.get('s4.bearer'):
            # Human native-report links go through normal login, never a public
            # API/credential exception. Preserve only the fixed original UI path.
            human_report=request.endpoint=='php_ui.start_report' and request.method=='GET' and ('text/html' in request.headers.get('Accept','').lower() and request.accept_mimetypes.best_match(('text/html','application/json'))=='text/html')
            if request.endpoint=='php_ui.host' or human_report:
                name=request.args.get('name' if human_report else 'report','')
                session['after_login_php_ui']=url_for('php_ui.host',**({'report':name} if 0<len(name)<=200 else {}))
                return redirect(url_for('login'))
            if request.path.startswith('/api/'):
                return jsonify(ok=False, error='Authentication required'), 401
            return redirect(url_for('login'))

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Content-Security-Policy'] = "default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        if request.endpoint == 'php_ui.host':
            response.headers['Content-Security-Policy'] += "; frame-src " + "https://" + request.host + "/php-ui/frame http://" + request.host + "/php-ui/frame"
        elif request.endpoint == 'php_ui.frame':
            # Opaque sandbox: original inline code has NO cookie/CSRF/network authority.
            response.headers['X-Frame-Options'] = 'SAMEORIGIN'
            response.headers['Content-Security-Policy'] = "default-src 'none'; script-src 'unsafe-inline' " + " ".join(scheme + request.host + path for scheme in ('https://','http://') for path in ('/static/php-ui-frame.js','/static/php-ui-attach.js','/static/php-ui-start.js')) + "; style-src 'unsafe-inline'; font-src " + " ".join(scheme + request.host + '/static/fonts/' for scheme in ('https://','http://')) + "; img-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox allow-scripts allow-modals"
        if request.endpoint == 'static' and request.path.startswith('/static/fonts/'):
            response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Cache-Control'] = 'no-store'
        if request.endpoint in ('cron.run', 'deploy.run'):
            response.headers['X-Robots-Tag'] = 'noindex, nofollow'
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
                native_return=session.get('after_login_php_ui','')
                session.clear()
                session['authenticated'] = True
                session.permanent = True
                csrf()
                if isinstance(native_return,str) and (native_return=='/php-ui' or native_return.startswith('/php-ui?report=')):
                    return redirect(native_return)
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
        return jsonify(ok=True, version=VERSION, source_commit='9756c320ff377e46ac9f80676575b757f6383a1d')

    @app.get('/api/pagination/preview')
    def preview():
        url = validate_url(request.args.get('url', ''))
        kind, val = request.args.get('type', 'query_page'), request.args.get('val', '')
        if kind not in TYPES:
            raise ValueError('Unknown pagination type')
        return jsonify(ok=True, type=kind, val=val, urls=build_urls(url, kind, val, min(100, max(1, int(request.args.get('pages', 3))))))

    @app.post('/api/selectors/preview')
    def selector_preview():
        from .services.selector_preview import preview as run_preview
        payload, status = run_preview(request.get_json(), settings)
        return jsonify(payload), status

    @app.route('/api/profiles', methods=['GET', 'POST'])
    def profiles():
        if request.method == 'GET':
            from .services.scraping.engines import profile_engine
            from .services.start_page import options
            return jsonify(ok=True, profiles=[{**p,'extraction_engine':profile_engine(p),'start_options':options(p)} for p in db.list_profiles()])
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
        key = str(data.get('key') or profile_key(url))
        previous = db.get_profile(key)
        profile_settings = dict((previous or {}).get('settings') or {})
        if 'extractionEngine' in data:
            from .services.scraping.engines import ENGINES
            if not isinstance(data['extractionEngine'],str) or data['extractionEngine'] not in ENGINES: raise ValueError('Unknown extraction engine')
            profile_settings['extractionEngine'] = data['extractionEngine']
        if 'detailSelectors' in data:
            from .services.scraping.detail import normalize_selectors
            profile_settings['detailSelectors'] = normalize_selectors(data['detailSelectors'])
        return jsonify(ok=True, profile=db.upsert_profile(key, url,
                       name=str(data.get('name') or ''), selectors=selectors, pagination=pagination,
                       settings=profile_settings, enabled=bool(data.get('enabled', (previous or {}).get('enabled', True)))))

    @app.delete('/api/profiles/<int:profile_id>')
    def delete_profile(profile_id):
        if any(e['profile_id'] == profile_id for e in db.list_entries(True, 10000)):
            raise ValueError('Cancel active jobs before deleting this profile')
        db.delete_profile(profile_id)
        return jsonify(ok=True)

    @app.get('/api/products')
    def products():
        from .services.product_browser import list_products
        return jsonify(list_products(db, request.args))

    @app.get('/api/products/overview')
    def product_overview():
        from .services.product_browser import overview
        return jsonify(overview(db))

    @app.get('/api/products/<int:product_id>')
    def product_detail(product_id):
        from .services.product_browser import detail
        result = detail(db, product_id)
        if result is None:
            abort(404)
        return jsonify(result)

    @app.get('/api/export/<int:profile_id>')
    def export(profile_id):
        if not db.get_profile(profile_id):
            abort(404)
        rows = db.list_products(profile_id, limit=100000)
        from .services import profile_options
        export_profile=db.get_profile(profile_id);opts=profile_options.active(export_profile)
        for row in rows:
            row['source_title']=row['title'];row['source_price_num']=row['price_num']
            row['title']=profile_options.title(export_profile,row['title'])
            row['price_num']=profile_options.price(export_profile,row['price_num'])
            if 'profileOptions' in export_profile['settings']:row['price']=str(row['price_num'])+' تومان'
            if opts['useCustomCol']:row['custom_column']={'name':opts['customColName'],'value':opts['customColVal']}
        if request.args.get('format') == 'json':
            return Response(json.dumps(rows, ensure_ascii=False), mimetype='application/json',
                            headers={'Content-Disposition': f'attachment; filename=products-{profile_id}.json'})
        out = io.StringIO()
        writer = csv.writer(out)
        fields = ['title', 'price', 'price_num', 'link', 'image', 'sku', 'woo_id', 'basalam_id']
        if opts['useCustomCol']:fields.append('custom_column')
        headers=[opts['customColName'] if f=='custom_column' else f for f in fields]
        writer.writerow(["'"+v if v.lstrip().startswith(('=','+','-','@','\t','\r')) else v for v in headers])
        for row in rows:
            values = [opts['customColVal'] if f=='custom_column' else str(row.get(f) or '') for f in fields]
            writer.writerow(["'" + v if v.lstrip().startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in values])
        return Response('\ufeff' + out.getvalue(), mimetype='text/csv; charset=utf-8',
                        headers={'Content-Disposition': f'attachment; filename=products-{profile_id}.csv'})

    @app.get('/api/extraction/status')
    def extraction_status():
        from .services.extraction_control import status
        return jsonify(status(db))

    @app.post('/api/extraction/step')
    def extraction_step():
        if request.args or request.get_json() != {}:
            raise ValueError('درخواست اجرای مرحله فقط یک شیء JSON خالی است؛ کار یا URL دلخواه انتخاب نمی‌شود.')
        from .services.extraction_control import step
        result, code = step(db, settings)
        return jsonify(result), code

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
        if kind == 'bsl_send':
            from .services.basalam.shops import resolve
            cfg = db.get_config('basalam')
            shop = resolve(cfg,data.get('vendor_id'))
            payload['vendor_id'] = shop['vendor_id']  # pin destination, never drift with primary config
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
        allowed = {'woocommerce': {'store_url', 'consumer_key', 'consumer_secret','price_mode','price_val','price_round'},
                   'basalam': {'token', 'vendor_id', 'category_id','price_mode','price_val','price_round'}, 'render': {'url','token'}}
        if name not in allowed:
            abort(404)
        if request.method == 'GET':
            cfg = db.get_config(name)
            return jsonify(ok=True, configured=bool(cfg), credential_status={k:bool(cfg.get(k)) for k in allowed[name] if k in ('token','consumer_key','consumer_secret')}, fields={k: ('••••' if k in ('token', 'consumer_key', 'consumer_secret') and v else v)
                           for k, v in cfg.items() if k in allowed[name]})
        if name == 'render' and (not session.get('authenticated') or request.environ.get('s4.bearer')): abort(403)
        data = request.get_json() or {}
        if not isinstance(data,dict): raise ValueError('Expected connection object')
        cfg = db.get_config(name)
        for key,value in data.items():
            if key not in allowed[name]: continue
            if key in ('vendor_id','category_id','price_val','price_round') and type(value) in (int,float): value=str(value);data[key]=value
            if not isinstance(value,str) or len(value)>4096 or '\r' in value or '\n' in value: raise ValueError('Invalid connection field')
        for key in allowed[name]:
            if key in data and data[key] != '••••':
                cfg[key] = str(data[key])
        if name in ('woocommerce','basalam'):
            from .services.profile_options import validate as validate_pricing
            raw_round=cfg.get('price_round') or 0
            try:validate_pricing({'priceMode':cfg.get('price_mode','none'),'priceVal':float(cfg.get('price_val') or 0),'roundPrice':int(raw_round)})
            except (ValueError,TypeError,OverflowError):raise ValueError('تنظیم قیمت مقصد معتبر نیست.') from None
            if float(raw_round)!=int(raw_round):raise ValueError('گرد کردن باید عدد صحیح باشد.')
        if cfg.get('store_url'):
            validate_url(cfg['store_url'])
        if name == 'render' and cfg.get('url'):
            validate_url(cfg['url'])
        if name == 'basalam':
            from .services.basalam.shops import normalize_config, pin_legacy_owner
            cfg = normalize_config(cfg)
            with db.connect() as conn: pin_legacy_owner(conn,db.get_config(name))
        db.put_config(name, cfg)
        return jsonify(ok=True)

    from .admin import register_admin
    register_admin(app, db, settings)
    from .deploy import register_deploy
    register_deploy(app, db, settings)
    from .cron import register_cron
    register_cron(app, db, settings)
    from .settings_transfer import register_settings_transfer
    register_settings_transfer(app, db, settings)
    from .extraction_tools import register_extraction_tools
    register_extraction_tools(app, db, settings)
    from .profile_settings import register_profile_settings
    register_profile_settings(app, db, settings)
    from .start import register_start
    register_start(app, db, settings)
    from .php_ui import register_php_ui
    register_php_ui(app, db, settings)
    from .worker import register_worker
    register_worker(app, db, settings)
    return app
