"""Safe network categories; never serialize raw requests exceptions/URLs."""
import socket
import requests

KINDS={'proxy','tls','connect_timeout','read_timeout','connection','dns','configuration'}
MESSAGES={
    'proxy':'پراکسی خروجی اتصال را نپذیرفت؛ تنظیم پراکسی یا allowlist پلن میزبان را بررسی کنید.',
    'tls':'اعتبار گواهی TLS مبدأ/پراکسی تأیید نشد؛ TLS غیرفعال نمی‌شود.',
    'connect_timeout':'مهلت برقراری اتصال به مبدأ/پراکسی تمام شد.',
    'read_timeout':'اتصال برقرار شد ولی پاسخ مبدأ در مهلت نرسید.',
    'connection':'اتصال شبکه قطع یا رد شد؛ این خطا نیاز به renderer را ثابت نمی‌کند.',
    'dns':'نام دامنهٔ مقصد در میزبان resolve نشد؛ DNS/دسترسی خروجی را بررسی کنید.',
    'configuration':'پیکربندی یا مسیر شبکه قابل استفاده نیست؛ تنظیمات ذخیره‌شده را بررسی کنید.'}


def classify(exc):
    if isinstance(exc,requests.exceptions.ProxyError):return 'proxy'
    if isinstance(exc,requests.exceptions.SSLError):return 'tls'
    if isinstance(exc,requests.exceptions.ConnectTimeout):return 'connect_timeout'
    if isinstance(exc,requests.exceptions.ReadTimeout):return 'read_timeout'
    if isinstance(exc,socket.gaierror):return 'dns'
    if isinstance(exc,requests.exceptions.ConnectionError):return 'connection'
    return 'configuration'
