"""Browser-admin-only portable settings endpoints. No secrets in previews."""
import hashlib

from flask import Blueprint, abort, jsonify, request, session, render_template

from .db import utc_now
from .config import VERSION
from .services import settings_transfer as transfer


def register_settings_transfer(app, db, settings):
    bp = Blueprint('settings_transfer', __name__)

    @bp.before_request
    def browser_only():
        if not session.get('authenticated') or request.environ.get('s4.bearer'):
            abort(403)

    def body():
        if not request.is_json:
            raise ValueError('Expected application/json')
        value = transfer.parse_json(request.get_data())
        if not isinstance(value, dict):
            raise ValueError('Expected a JSON object')
        return value

    def binding():
        return hashlib.sha256(session['csrf'].encode()).hexdigest()

    @bp.get('/settings/backup')
    def page():
        return render_template('settings_transfer.html', transfer_sections=transfer.SECTIONS)

    @bp.get('/api/settings/sections')
    def sections():
        with db.connect() as conn:
            current = transfer.snapshot(conn, db.secret_key)
            previous = conn.execute('SELECT 1 FROM connections WHERE name=?', (transfer.UNDO,)).fetchone()
        return jsonify(ok=True, sections=[{'id': key, 'title': title, 'system': key == 'pythonanywhere',
                        'count': len(current['sections'][key]) if key == 'profiles' else int(bool(current['sections'][key]))}
                        for key, title in transfer.SECTIONS.items()], undo_available=bool(previous),
                        excluded=transfer.EXCLUDED, max_file_bytes=transfer.MAX_FILE)

    @bp.post('/api/settings/export')
    def export():
        data = body()
        selected = transfer.selection(data.get('sections'), transfer.SECTIONS)
        with db.connect() as conn:
            conn.execute('BEGIN')
            bundle = transfer.snapshot(conn, db.secret_key)
        bundle['sections'] = {key: bundle['sections'][key] for key in selected}
        bundle.update(app_version=VERSION, created_at=utc_now(), excluded=transfer.EXCLUDED)
        transfer.validate(bundle)
        response = jsonify(transfer.encrypt(bundle, data.get('password')))
        stamp = utc_now().replace('-', '').replace(':', '').replace(' ', '-')
        response.headers['Content-Disposition'] = f'attachment; filename="scraper4-settings-{stamp}.json"'
        response.headers['X-Robots-Tag'] = 'noindex, nofollow'
        return response

    @bp.post('/api/settings/inspect')
    def inspect():
        try:
            with db.connect() as conn:
                bundle = transfer.source_for(body(), conn, db.secret_key)
        except transfer.NoImportableSections as exc:
            return jsonify(ok=True, available=[], counts={}, warnings=exc.warnings)
        return jsonify(ok=True, available=list(bundle['sections']), warnings=bundle.get('warnings', []),
                       counts={key: len(value) if key == 'profiles' else int(bool(value))
                               for key, value in bundle['sections'].items()})

    @bp.post('/api/settings/preview')
    def preview():
        try:
            return jsonify(transfer.preview(db, body(), binding()))
        except transfer.Conflict as exc:
            return jsonify(ok=False, error=str(exc)), 409

    @bp.post('/api/settings/import')
    def restore():
        try:
            return jsonify(transfer.apply(db, settings, body(), binding()))
        except transfer.Conflict as exc:
            return jsonify(ok=False, error=str(exc)), 409

    app.register_blueprint(bp)
