"""Authenticated worker settings; never starts a local process from a request."""
import shlex

from flask import Blueprint, abort, jsonify, request, session

from .services import worker_runtime as runtime
from .services.platform import PythonAnywhere, installed_python, PlatformError
from .db import utc_now


def register_worker(app, db, settings):
    bp = Blueprint('worker', __name__)

    def browser_admin():
        if not session.get('authenticated') or request.environ.get('s4.bearer'): abort(403)

    @bp.get('/api/worker/status')
    def status():
        result = runtime.status(db, settings)
        try:
            python = installed_python(settings)
            command = 'cd '+shlex.quote(str(settings.base_dir.resolve()))+' && '+shlex.quote(str(python))+' -m scraper4 worker'
            result['commands'] = {'always_on': command, 'hourly': command+' --max-runtime 3300', 'daily': command+' --max-runtime 6600'}
        except PlatformError:
            result['commands'] = {}
            result['setup_hint'] = 'برای تولید فرمان معتبر، نصبگر بدون توکن را دوباره اجرا کنید؛ metadata محیط مجازی نصب لازم است.'
        return jsonify(result)

    @bp.post('/api/worker/config')
    def config():
        browser_admin()
        value = runtime.validate_config(request.get_json())
        db.checkpoint_write('worker:config', value)
        return jsonify(ok=True, config=value, process_started=False,
                       note='این فقط تنظیم اجرای worker است؛ پردازش میزبان باید از Tasks یا کنسول شروع شود.')

    @bp.post('/api/worker/schedule')
    def schedule():
        browser_admin()
        if request.args or request.get_json() != {}: raise ValueError('Expected empty JSON object')
        python = installed_python(settings)
        result = PythonAnywhere(db.get_config('pythonanywhere'), timeout=(3, 7)).ensure_task(settings, python=python, long_running=True)
        cfg = runtime.config(db); cfg['enabled'] = True
        db.checkpoint_write('worker:config', cfg)
        safe = {'task_id': result['task_id'], 'interval': result['interval'], 'configured_at': utc_now()}
        db.checkpoint_write('worker:schedule', safe)
        return jsonify(ok=True, native_schedule=safe, process_started=False,
                       note='Task پیکربندی شد؛ اجرا از نوبت بعدی میزبان است. تنها ضربان تازه، اجرای واقعی را تأیید می‌کند.')

    app.register_blueprint(bp)
