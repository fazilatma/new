"""Opaque original-client UI with a narrow CSRF-protected compatibility broker."""
from flask import Blueprint, Response, abort, jsonify, render_template, request, session
from .services import php_ui as service


def register_php_ui(app,db,settings):
    bp=Blueprint('php_ui',__name__)
    @bp.before_request
    def browser_only():
        if not session.get('authenticated') or request.environ.get('s4.bearer'):abort(403)
    @bp.get('/php-ui')
    def host():return render_template('php_ui_host.html',source_version=service.manifest()['source_version'])
    @bp.get('/php-ui/frame')
    def frame():return Response(service.render(db),mimetype='text/html')
    def data():
        value=request.get_json()
        if not isinstance(value,dict) or set(value)-{'action','query','fields','revision'} or not isinstance(value.get('action'),str):raise ValueError('درخواست رابط معتبر نیست.')
        for key in ('query','fields'):
            if not isinstance(value.get(key),dict) or len(value[key])>100 or any(not isinstance(k,str) or not isinstance(v,str) or len(k)>100 or len(v)>1500000 for k,v in value[key].items()):raise ValueError('فرم رابط معتبر نیست.')
        return value
    @bp.post('/api/php-ui/read')
    def read():
        value=data()
        if value['action'] not in service.READS or value['action']=='tasks_list':return jsonify(ok=False,error=service.UNSUPPORTED,unsupported=True),501
        return jsonify(service.read(db,settings,value))
    @bp.post('/api/php-ui/write')
    def write():
        value=data()
        if value['action'] not in service.WRITES:return jsonify(ok=False,error=service.UNSUPPORTED,unsupported=True),501
        return jsonify(service.save(db,value) if value['action']=='save_profile' else service.enqueue(db,value))
    app.register_blueprint(bp)
