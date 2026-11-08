"""Browser-admin extraction audit, engine capabilities and multi-shop controls."""
import hashlib
import json
import threading

from flask import Blueprint, abort, jsonify, request, session
from .db import utc_now
from .services.scraping import engines
from .services.scraping.fetch import validate_url
from .services.support.persian import price_num
from .services.basalam import shops
from itsdangerous import URLSafeTimedSerializer, BadSignature
from .services.scraping.pagination import build, NEXT_SELECTOR
from .services.scraping.parser import query_inside, load_dom
from .services.support.url import absolute

_GATE=threading.BoundedSemaphore(1)


def register_extraction_tools(app,db,settings):
    bp=Blueprint('extraction_tools',__name__)
    @bp.before_request
    def browser_only():
        if not session.get('authenticated') or request.environ.get('s4.bearer'): abort(403)

    @bp.get('/api/extraction/diagnostics')
    def diagnostics():
        from .services.extraction_diagnostics import report
        return jsonify(report(db,settings))

    @bp.get('/api/extraction/engines')
    def capabilities():
        cfg=engines.for_installation(settings,db)
        return jsonify(ok=True,engines=[{'id':key,'label':label,'configured':bool(cfg.render.url) if key in ('playwright','selenium') else True,
                                        'needs':'remote_renderer' if key in ('playwright','selenium') else 'public_api' if key.endswith('_api') else 'public_network'} for key,label in engines.ENGINES.items()],
                       render_configured=bool(cfg.render.url),note='وجود موتور، تضمین دسترسی شبکهٔ میزبان یا پاسخ سرویس مقصد نیست.')

    @bp.post('/api/extraction/probe')
    def probe():
        data=request.get_json()
        if not isinstance(data,dict) or set(data)-{'profile_id','engine','continuation'} or type(data.get('profile_id')) is not int: raise ValueError('شناسهٔ پروفایل لازم است؛ URL دلخواه پذیرفته نمی‌شود.')
        profile=db.get_profile(data['profile_id'])
        if not profile: abort(404)
        engine=data.get('engine',engines.profile_engine(profile))
        if not isinstance(engine,str) or engine not in engines.ENGINES: raise ValueError('موتور انتخابی معتبر نیست.')
        digest=hashlib.sha256(json.dumps([profile['url'],profile['selectors'],profile['settings'],profile['pagination']],sort_keys=True).encode()).hexdigest()
        signer=URLSafeTimedSerializer(settings.secret_key,salt='s4-start-five-page-probe')
        state={'page':1,'url':profile['url'],'visited':[],'signatures':[]}
        if 'continuation' in data:
            if not isinstance(data['continuation'],str) or len(data['continuation'])>12000:raise ValueError('ادامهٔ تست معتبر نیست.')
            try:state=signer.loads(data['continuation'],max_age=600)
            except BadSignature:raise ValueError('ادامهٔ تست منقضی یا نامعتبر است؛ دوباره شروع کنید.') from None
            if state.get('profile_id')!=profile['id'] or state.get('engine')!=engine or state.get('fingerprint')!=digest or type(state.get('page')) is not int or not 2<=state['page']<=5:raise ValueError('تنظیمات/موتور عوض شده یا ادامهٔ تست نامعتبر است.')
        if not _GATE.acquire(False): return jsonify(ok=False,error='آزمایش دیگری در این پردازش در حال اجراست.'),429
        try:
            report={'profile_id':profile['id'],'name':profile['name'] or profile['key'],'engine':engine,'tested_at':utc_now(),
                    'fingerprint':digest,'products_changed':False,'queue_changed':False,'scope':'first_listing_page' if state['page']==1 else 'listing_page','page':state['page'],'next':None}
            try:
                result=engines.extract(state['url'],profile['selectors'],engine,engines.for_installation(settings,db),timeout=8,probe=True)
                rows=list(result['products'].values())
                report.update(status='passed' if rows else 'empty',count=len(rows),used_engine=result['used_engine'],elapsed_ms=result['elapsed_ms'],http_status=result.get('code',0),
                              priced=sum(price_num(str(r.get('price') or ''))>0 for r in rows),linked=sum(bool(r.get('link')) for r in rows),imaged=sum(bool(r.get('image')) for r in rows),
                              samples=[{k:str(r.get(k) or '')[:300] for k in ('title','price','sku')} for r in rows[:3]],
                              hint='' if rows else 'صفر محصول: موتور، سلکتور ظرف، صفحه‌بندی، JS و محدودیت دسترسی را بررسی کنید؛ این نتیجه موفقیت استخراج نیست.')
                signature=hashlib.sha256(json.dumps(sorted(result['products'])).encode()).hexdigest()
                if signature in state['signatures']:
                    report.update(repeated=True,hint='نتایج تکراری؛ تست این پروفایل در همین مرز متوقف شد.')
                elif rows and state['page']<5 and not result.get('last_page'):
                    page=state['page']+1;pagination=profile['pagination'];kind=pagination.get('type','query_page');val=pagination.get('val','')
                    nxt=result.get('next_url')
                    if not nxt and kind==NEXT_SELECTOR:
                        nodes=query_inside(load_dom(result.get('html','')),val)
                        nxt=absolute(nodes[0].get('href') or '',result.get('url') or state['url']) if nodes else ''
                    elif not nxt:nxt=build(profile['url'],profile['url'],page,kind,val)
                    if nxt and nxt not in state['visited'] and nxt!=state['url']:
                        validate_url(nxt)
                        report['next']=signer.dumps({'profile_id':profile['id'],'engine':engine,'fingerprint':digest,'page':page,'url':nxt,'visited':state['visited']+[state['url']],'signatures':state['signatures']+[signature]})
            except ValueError as exc:
                # Only engine-authored safe messages. JSON/parser errors may contain source snippets.
                message=str(exc)
                if message.startswith(('دسترسی API','دریافت با موتور','موتور ','مسیر عمومی','شناسهٔ غرفه','آدرس غرفه','مهلت دریافت','HTML برای','سرویس رندر','آدرس اصلی')): hint=message[:500]
                else: hint='ساختار پاسخ/آدرس/JSON قابل پردازش نیست؛ موتور یا صفحهٔ نمونه را بررسی کنید.'
                report.update(status='failed',count=0,hint=hint)
            except Exception:
                report.update(status='failed',count=0,hint='دریافت یا پردازش ناموفق بود؛ شبکه/renderer و موتور را بررسی کنید. هیچ محصولی ارسال نشد.')
            db.checkpoint_write(f"probe:{profile['id']}:{engine}"+(f":{state['page']}" if state['page']>1 else ''),{k:v for k,v in report.items() if k!='next'})
            return jsonify(ok=True,report=report)
        finally: _GATE.release()

    @bp.get('/api/extraction/reports')
    def reports():
        with db.connect() as conn:
            rows=conn.execute("SELECT state FROM task_checkpoints WHERE task LIKE 'probe:%' ORDER BY updated_at DESC LIMIT 10000").fetchall()
        return jsonify(ok=True,reports=[json.loads(row['state']) for row in rows],note='هر گزارش مربوط به یک صفحه (حداکثر پنج صفحه) و تنظیمات زمان آزمایش است؛ محصول یا صف تغییر نمی‌کند.')

    @bp.route('/api/basalam/vendors',methods=['GET','POST'])
    def vendors():
        cfg=db.get_config('basalam')
        if request.method=='GET': return jsonify(ok=True,vendors=shops.public_shops(cfg))
        data=request.get_json()
        if not isinstance(data,dict) or set(data)-{'vendor_id','token','shop_name','category_id','price_mode','price_val'}: raise ValueError('فیلد غرفه معتبر نیست.')
        vid=str(data.get('vendor_id') or '')
        if not vid.isdigit() or int(vid)<=0: raise ValueError('شناسهٔ غرفه باید مثبت باشد.')
        if vid==str(cfg.get('vendor_id')): raise ValueError('غرفهٔ پیش‌فرض را از فرم اتصال اصلی ویرایش کنید.')
        items={r['vendor_id']:r for r in shops.normalize_config(cfg).get('vendors',[])}
        old=items.get(vid,{})
        fresh={**old,**{k:v for k,v in data.items() if k!='token'},'vendor_id':vid}
        token=data.get('token')
        if token and token!=shops.MASK: fresh['token']=token
        elif old.get('token'): fresh['token']=old['token']
        else: raise ValueError('برای غرفهٔ جدید توکن لازم است؛ آن را فقط در همین فرم وارد کنید.')
        items[vid]=fresh;cfg=shops.normalize_config({**cfg,'vendors':list(items.values())});db.put_config('basalam',cfg)
        return jsonify(ok=True,vendors=shops.public_shops(cfg))

    @bp.delete('/api/basalam/vendors/<vendor_id>')
    def remove_vendor(vendor_id):
        cfg=shops.normalize_config(db.get_config('basalam'))
        if vendor_id==cfg.get('vendor_id'): raise ValueError('حذف غرفهٔ پیش‌فرض از این بخش مجاز نیست.')
        if any(e['kind']=='bsl_send' and str(e['payload'].get('vendor_id') or cfg.get('vendor_id'))==vendor_id for e in db.list_entries(True,10000)):
            raise ValueError('ابتدا کارهای فعال این غرفه را تمام یا لغو کنید؛ شناسه‌های محصولات حذف نمی‌شوند.')
        cfg['vendors']=[v for v in cfg.get('vendors',[]) if v['vendor_id']!=vendor_id];db.put_config('basalam',cfg)
        return jsonify(ok=True,vendors=shops.public_shops(cfg))

    app.register_blueprint(bp)
