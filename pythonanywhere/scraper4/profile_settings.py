"""Browser-admin profile options, non-writing preview, confirmed local cleanup."""
import json
from flask import Blueprint, abort, jsonify, request, session
from itsdangerous import URLSafeTimedSerializer, BadSignature
from .services import profile_options as options
from .services.basalam.shops import all_shops, adjusted_price


def register_profile_settings(app,db,settings):
    bp=Blueprint('profile_settings',__name__)
    signer=URLSafeTimedSerializer(settings.secret_key,salt='s4-profile-cleanup-v1')
    @bp.before_request
    def browser_only():
        if not session.get('authenticated') or request.environ.get('s4.bearer'):abort(403)
    def profile(pid):
        value=db.get_profile(pid)
        if not value:abort(404)
        return value
    @bp.get('/api/profile-settings/<int:pid>')
    def read(pid):
        p=profile(pid)
        return jsonify(ok=True,profile_id=pid,name=p['name'] or p['key'],options=options.editor(p),active='profileOptions' in p['settings'])
    @bp.post('/api/profile-settings/<int:pid>')
    def save(pid):
        profile(pid);return jsonify(ok=True,options=options.save(db,pid,request.get_json()))
    @bp.post('/api/profile-settings/<int:pid>/preview')
    def preview(pid):
        p=profile(pid);data=request.get_json()
        if not isinstance(data,dict) or set(data)!={'options','price','title'} or type(data['price']) is not int or not 0<=data['price']<=10**15 or not isinstance(data['title'],str) or len(data['title'])>2000:raise ValueError('درخواست پیش‌نمایش معتبر نیست.')
        opts=options.validate(data['options']);p['settings']={**p['settings'],'profileOptions':opts}
        woo=db.get_config('woocommerce');bsl=db.get_config('basalam');shops=all_shops(bsl)
        base=options.price(p,data['price']);wc=options.price(p,data['price'],'woo');bs=options.price(p,data['price'],'basalam')
        wc=options.adjust(wc,woo.get('price_mode','none'),woo.get('price_val',0),woo.get('price_round',0))
        return jsonify(ok=True,title=options.title(p,data['title']),source_price=data['price'],profile_price=base,woo_price=wc,
                       basalam_shops=[{'vendor_id':s['vendor_id'],'name':s['shop_name'],'price':adjusted_price(bs,bsl,s)} for s in shops],
                       basalam_profile_price=bs,products_changed=False,queue_changed=False)
    @bp.post('/api/profile-settings/<int:pid>/cleanup-preview')
    def cleanup_preview(pid):
        p=profile(pid);data=request.get_json()
        if not isinstance(data,dict) or set(data)!={'mode'}:raise ValueError('روش پاک‌سازی لازم است.')
        with db.connect() as conn:rows,digest=options.cleanup_candidates(conn,p,data['mode'])
        proof=signer.dumps({'profile_id':pid,'mode':data['mode'],'digest':digest,'csrf':session['csrf']})
        return jsonify(ok=True,count=len(rows),limit=1000,proof=proof,remote_products_deleted=False)
    @bp.post('/api/profile-settings/<int:pid>/cleanup')
    def cleanup(pid):
        data=request.get_json()
        if not isinstance(data,dict) or set(data)!={'proof'} or not isinstance(data['proof'],str) or len(data['proof'])>3000:raise ValueError('پیش‌نمایش معتبر لازم است.')
        try:proof=signer.loads(data['proof'],max_age=300)
        except BadSignature:raise ValueError('پیش‌نمایش منقضی/نامعتبر است؛ دوباره بررسی کنید.') from None
        if proof.get('profile_id')!=pid or proof.get('csrf')!=session['csrf']:abort(403)
        with db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            raw=conn.execute('SELECT * FROM profiles WHERE id=?',(pid,)).fetchone()
            if not raw:abort(404)
            p={**dict(raw),'settings':json.loads(raw['settings'] or '{}')}
            if conn.execute("SELECT id FROM queue_entries WHERE profile_id=? AND status IN ('waiting','running','paused') LIMIT 1",(pid,)).fetchone():raise ValueError('کار فعال همین پروفایل را ابتدا تمام یا لغو کنید.')
            rows,digest=options.cleanup_candidates(conn,p,proof['mode'])
            if digest!=proof['digest']:return jsonify(ok=False,error='محصولات یا تنظیمات تغییر کردند؛ پیش‌نمایش را دوباره بگیرید.'),409
            for row in rows:
                conn.execute('DELETE FROM task_checkpoints WHERE task GLOB ?',(f'basalam:remote:{row[0]}:*',))
                conn.execute('DELETE FROM products WHERE id=? AND profile_id=?',(row[0],pid))
            conn.execute('UPDATE profiles SET products_count=(SELECT count(*) FROM products WHERE profile_id=?) WHERE id=?',(pid,pid))
        return jsonify(ok=True,removed=len(rows),remote_products_deleted=False)
    app.register_blueprint(bp)
