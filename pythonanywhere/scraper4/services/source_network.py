"""PHP srcNetCfg/srcNetTest connection slice for both Python interfaces.

Direct and HTTP(S) proxy transport only. No DNS pinning, TLS relaxation,
arbitrary worker relay contract, proxy discovery or credentials in reports.
"""
from dataclasses import replace
from urllib.parse import urlsplit
from .scraping.fetch import validate_url


def validate(value,previous=None):
    fields={'mode','proxy','proxy_auth','gap_ms','fallback','hosts','clear_proxy_auth'}
    if not isinstance(value,dict) or set(value)-fields:raise ValueError('فیلد تنظیم شبکهٔ مبدأ معتبر نیست.')
    cfg={**(previous or {}),**value};cfg.pop('clear_proxy_auth',None)
    if cfg.get('mode','direct') not in ('direct','proxy'):raise ValueError('در این مرحله فقط اتصال مستقیم یا پراکسی HTTP/HTTPS پشتیبانی می‌شود؛ DNS/worker مرورگر نیست و خودکار فرض نمی‌شود.')
    if type(cfg.get('gap_ms',0)) is not int or not 0<=cfg.get('gap_ms',0)<=10000:raise ValueError('فاصلهٔ درخواست باید ۰ تا ۱۰۰۰۰ میلی‌ثانیه باشد.')
    if type(cfg.get('fallback',False)) is not bool:raise ValueError('fallback باید بولی باشد.')
    if not isinstance(cfg.get('hosts',''),str) or len(cfg.get('hosts',''))>2000:raise ValueError('فیلتر دامنه معتبر نیست.')
    hosts=cfg.get('hosts','').replace(',',' ').split()
    for host in hosts:
        validate_url('https://'+host)
        if urlsplit('https://'+host).hostname!=host.lower() or '/' in host:raise ValueError('فیلتر فقط نام دامنه است.')
    proxy=cfg.get('proxy','')
    if not isinstance(proxy,str) or len(proxy)>2000:raise ValueError('آدرس پراکسی معتبر نیست.')
    if proxy:
        parts=urlsplit(proxy)
        if parts.scheme not in ('http','https') or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment or parts.path not in ('','/'):
            raise ValueError('پراکسی HTTP/HTTPS بدون نام کاربری/رمز داخل URL وارد کنید؛ مجوز در فیلد جداست.')
        if parts.port is not None and not 1<=parts.port<=65535:raise ValueError('پورت پراکسی معتبر نیست.')
        validate_url(parts.scheme+'://'+parts.hostname)
    auth=value.get('proxy_auth')
    if auth in (None,'','••••'):cfg['proxy_auth']=(previous or {}).get('proxy_auth','')
    elif not isinstance(auth,str) or len(auth)>2000 or any(ord(c)<32 for c in auth):raise ValueError('مجوز پراکسی معتبر نیست.')
    if value.get('clear_proxy_auth') is True:cfg['proxy_auth']=''
    elif 'clear_proxy_auth' in value and type(value['clear_proxy_auth']) is not bool:raise ValueError('پاک‌کردن مجوز باید بولی باشد.')
    if cfg.get('mode')=='proxy' and not proxy:raise ValueError('آدرس پراکسی برای حالت proxy لازم است.')
    return {key:cfg.get(key,default) for key,default in {'mode':'direct','proxy':'','proxy_auth':'','gap_ms':0,'fallback':False,'hosts':''}.items()}


def effective(settings,db):
    saved=db.get_config('source_network')
    if not saved:return settings
    cfg=validate(saved,saved)
    return replace(settings,net=replace(settings.net,**cfg,proxy_type='http'))


def public(db,settings):
    saved=db.get_config('source_network')
    cfg=validate(saved,saved) if saved else {k:getattr(settings.net,k) for k in ('mode','proxy','proxy_auth','gap_ms','fallback','hosts')}
    # Old env proxy URLs can contain passwords. Never put such URLs in UI/API.
    proxy=cfg.get('proxy','');parts=urlsplit(proxy if '://' in proxy else 'http://'+proxy)
    if parts.username or parts.password:proxy=''
    return {'ok':True,'config':{**cfg,'proxy':proxy,'proxy_auth':'','proxy_auth_configured':bool(cfg.get('proxy_auth'))},'persisted':bool(saved),
            'supported_modes':['direct','proxy'],'note':'شبکه فقط راه انتقال درخواست API/HTML مبدأ است؛ مجوز مهمان خودکار است. پراکسی محدودیت پلن میزبان را تضمینی دور نمی‌زند و باید از قبل در اختیار شما باشد. TLS همیشه معتبر می‌ماند. relay/DoH/SOCKS در این پنل پشتیبانی نشده‌اند.'}
