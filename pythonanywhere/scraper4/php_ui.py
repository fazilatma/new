"""Opaque original-client UI with a narrow CSRF-protected compatibility broker."""
import json
from flask import Blueprint, Response, abort, jsonify, render_template, request, session, redirect, url_for
from .db import utc_now
from .config import VERSION
from .services import php_ui as service
from .services import php_ui_operations as operations
from .services import php_ui_start as start


def register_php_ui(app,db,settings):
    bp=Blueprint('php_ui',__name__)
    @bp.before_request
    def browser_only():
        if not session.get('authenticated') or request.environ.get('s4.bearer'):abort(403)
    @bp.get('/php-ui')
    def host():return render_template('php_ui_host.html',source_version=service.manifest()['source_version'],profiles=db.list_profiles())
    @bp.get('/php-ui/frame')
    def frame():return Response(service.render(db),mimetype='text/html')
    def data():
        value=request.get_json()
        if not isinstance(value,dict) or set(value)-{'action','query','fields','revision'} or not isinstance(value.get('action'),str):raise ValueError('درخواست رابط معتبر نیست.')
        for key in ('query','fields'):
            if not isinstance(value.get(key),dict) or len(value[key])>100 or any(not isinstance(k,str) or not isinstance(v,str) or len(k)>100 or len(v)>1500000 for k,v in value[key].items()):raise ValueError('فرم رابط معتبر نیست.')
        return value
    @bp.get('/api/php-ui/start-report')
    def start_report():
        if set(request.args)-{'name'}:raise ValueError('فقط نام پروفایل پذیرفته می‌شود.')
        if ('text/html' in request.headers.get('Accept','').lower() and request.accept_mimetypes.best_match(('text/html','application/json'))=='text/html'):return redirect(url_for('php_ui.host',report=request.args.get('name','')[:200]))
        payload,code=start.named_report(db,settings,request.args.get('name'));return jsonify(payload),code
    @bp.get('/api/php-ui/diagnostic-export')
    def diagnostic_export():
        if set(request.args)-{'profile_id'}:raise ValueError('فقط شناسهٔ پروفایل پذیرفته می‌شود.')
        pid=service.integer(request.args.get('profile_id',''),minimum=1)
        profile=db.get_profile(pid)
        if not profile:abort(404)
        report=start.profile_report(db,settings,profile)
        report.update(format='scraper4-safe-diagnostic-v1',version=VERSION,generated_at=utc_now(),snapshot=True,
                      contains_credentials=False,scope='selected_profile_local_queue_and_configuration',
                      configuration=start.diagnose(db,settings,profile['key']))
        body=json.dumps(report,ensure_ascii=False,indent=2)+'\n'
        return Response(body,mimetype='application/json',headers={'Content-Disposition':f'attachment; filename="scraper4-diagnostic-{pid}.json"'})
    @bp.get('/api/php-ui/endpoint-inventory')
    def endpoint_inventory():
        inventory=json.loads((service.ROOT/'upstream/request-inventory.json').read_text())
        return jsonify(ok=True,inventory=inventory,connected=operations.contracts(),
                       source_inventory_is_not_implementation=True,read_only=True,
                       note='کلیدهای درخواست شامل پارامترهای فرم و ارجاع داخل توضیحات‌اند؛ تعداد endpoint پیاده‌شده نیستند. عملیات نامتصل هنوز 501 است.')
    @bp.get('/api/php-ui/capabilities')
    def capabilities():return jsonify(operations.contracts())
    @bp.post('/api/php-ui/read')
    def read():
        value=data()
        if value['action'] in start.READS:return jsonify(start.read(db,settings,value))
        if value['action'] not in service.READS|operations.READS:return jsonify(ok=False,error=service.UNSUPPORTED,unsupported=True),501
        return jsonify(operations.read(db,settings,value) if value['action'] in operations.READS else service.read(db,settings,value))
    @bp.post('/api/php-ui/write')
    def write():
        value=data()
        if value['action'] in start.WRITES:
            payload,code=start.write(db,settings,value);return jsonify(payload),code
        if value['action'] not in service.WRITES|operations.WRITES:return jsonify(ok=False,error=service.UNSUPPORTED,unsupported=True),501
        return jsonify(operations.write(db,settings,value) if value['action'] in operations.WRITES else service.save(db,value) if value['action']=='save_profile' else service.enqueue(db,value))
    app.register_blueprint(bp)
