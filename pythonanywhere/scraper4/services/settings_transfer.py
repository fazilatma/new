"""Portable settings only: authenticated encryption, selective preview and atomic restore.

PHP 10.641 backup sections/inspect + profiles_cfg semantics, not a whole PHP DB
restore. Never writes uploaded paths, products, jobs, auth keys or install files.
"""
import base64
import copy
import fcntl
import hashlib
import json
import os
import re

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from ..config import VERSION
from ..db import utc_now
from .platform import PythonAnywhere
from .scraping.fetch import validate_url as _validate_url
from .scraping.pagination import TYPES
from .scraping.detail import FIELDS, normalize_selectors as _normalize_selectors
from .support.crypto import seal, unseal

FORMAT = 'scraper4-settings'
ENCRYPTED = FORMAT + '-encrypted'
ITERATIONS = 600000
MAX_PLAIN = 6 * 1024 * 1024
MAX_FILE = 10 * 1024 * 1024
# JSON-string transport can expand controls/quotes up to six times.
MAX_REQUEST = MAX_FILE * 6 + 65536
UNDO = 'settings_restore_undo'
SECTIONS = {
    'profiles': 'پروفایل‌ها و سلکتورها (بدون محصولات)',
    'woocommerce': 'اتصال ووکامرس',
    'basalam': 'اتصال باسلام و غرفه‌ها',
    'render': 'سرویس رندر Playwright/Selenium',
    'pythonanywhere': 'میزبانی و توکن PythonAnywhere (انتخاب صریح)',
    'cron': 'کران خارجی و GET عمومی',
    'updates': 'دریافت خودکار نسخه‌ها',
    'deployment': 'پذیرش استقرار امضاشده',
}
CONNECTIONS = {'woocommerce', 'basalam', 'pythonanywhere', 'render'}
CHECKPOINTS = {'cron': 'cron:config', 'updates': 'updates:config', 'deployment': 'deploy:config'}
DEFAULTS = {'cron': {'public_get': False}, 'updates': {'enabled': True, 'interval_seconds': 3600}, 'deployment': {'enabled': True}}
PUBLIC = {'woocommerce': {'store_url'}, 'basalam': {'vendor_id', 'category_id'}, 'pythonanywhere': {'site', 'username', 'domain'}, 'render': {'url'}}
EXCLUDED = ['products', 'remote_ids', 'queue_entries', 'progress/logs', '.env/runtime installation settings',
            'panel password/session/encryption key', 'admin/cron API keys', 'deployment authority and signing keys']


class NoImportableSections(ValueError):
    def __init__(self, warnings):
        self.warnings = warnings
        super().__init__('هیچ بخش پشتیبانی‌شدهٔ دارای تنظیمات در این بسته پیدا نشد. ' + ' '.join(warnings))


class Conflict(ValueError):
    """Preview expired/stale, worker busy or nonterminal jobs exist."""


def validate_url(value):
    try:
        return _validate_url(value)
    except ValueError:
        raise ValueError('آدرس موجود در تنظیمات معتبر یا مجاز نیست.') from None


def normalize_selectors(value):
    try:
        return _normalize_selectors(value)
    except ValueError:
        raise ValueError('ساختار سلکتورهای جزئیات معتبر یا پشتیبانی‌شده نیست.') from None


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def parse_json(raw):
    try:
        def pairs(items):
            out = {}
            for key, value in items:
                if key in out:
                    raise ValueError('Duplicate JSON keys')
                out[key] = value
            return out
        if isinstance(raw, str):
            raw = raw.removeprefix('\ufeff')
        return json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid JSON number')))
    except (ValueError, TypeError, RecursionError, UnicodeError):
        raise ValueError('فایل JSON معتبر نیست؛ کلید تکراری یا ساختار نامعتبر دارد.') from None


def bounded(value, depth=0):
    if depth > 20:
        raise ValueError('ساختار تنظیمات بیش از حد تو در تو است.')
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str) or len(key) > 1000:
                raise ValueError('نام فیلد تنظیمات معتبر نیست.')
            bounded(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            bounded(item, depth + 1)
    elif value is not None and not isinstance(value, (str, bool, int, float)):
        raise ValueError('نوع مقدار تنظیمات معتبر نیست.')


def key_for(password, salt):
    if not isinstance(password, str) or not 12 <= len(password) <= 1024:
        raise ValueError('رمز فایل باید بین ۱۲ تا ۱۰۲۴ نویسه باشد؛ این رمز با رمز پنل مستقل است.')
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS).derive(password.encode())


def encrypt(bundle, password):
    raw = canonical(bundle)
    if len(raw) > MAX_PLAIN:
        raise ValueError('تنظیمات از سقف ۶ MiB دادهٔ رمزگشایی‌شده بیشتر است؛ بخش‌های کمتری را انتخاب کنید.')
    salt, nonce = os.urandom(16), os.urandom(12)
    encrypted = AESGCM(key_for(password, salt)).encrypt(nonce, raw, ENCRYPTED.encode())
    enc = lambda value: base64.b64encode(value).decode('ascii')
    return {'format': ENCRYPTED, 'schema': 1, 'kdf': 'pbkdf2-sha256', 'iterations': ITERATIONS,
            'salt': enc(salt), 'nonce': enc(nonce), 'ciphertext': enc(encrypted)}


def decode(file, password):
    if isinstance(file, str):
        if len(file.encode()) > MAX_FILE:
            raise ValueError('فایل بزرگ‌تر از سقف مجاز است.')
        file = parse_json(file)
    bounded(file)
    if not isinstance(file, dict) or len(canonical(file)) > MAX_FILE:
        raise ValueError('فایل تنظیمات بیش از حد بزرگ یا نامعتبر است.')
    if file.get('format') == ENCRYPTED:
        if type(file.get('schema')) is not int or file['schema'] != 1 or file.get('kdf') != 'pbkdf2-sha256' or file.get('iterations') != ITERATIONS:
            raise ValueError('نسخه یا الگوریتم فایل پشتیبانی نمی‌شود.')
        try:
            salt, nonce, ciphertext = (base64.b64decode(file[k], validate=True) for k in ('salt', 'nonce', 'ciphertext'))
            if len(salt) != 16 or len(nonce) != 12 or len(ciphertext) > MAX_PLAIN + 16:
                raise ValueError()
            raw = AESGCM(key_for(password, salt)).decrypt(nonce, ciphertext, ENCRYPTED.encode())
        except (ValueError, TypeError, KeyError, InvalidTag):
            raise ValueError('رمز فایل نادرست است یا فایل آسیب دیده است.') from None
        bundle = parse_json(raw)
    elif file.get('app') == 'scraper' and isinstance(file.get('files'), dict):
        bundle = from_php(file)
    else:
        raise ValueError('فقط خروجی رمزگذاری‌شدهٔ Python یا بستهٔ تنظیمات PHP پشتیبانی می‌شود.')
    return validate(bundle)


def php_detail_selectors(raw):
    """PHP extractNormalizeDetailSelectors: extra UI metadata and PHP false values.

    Only the already-supported fields execute. The original config is retained
    separately; the stricter native Python API contract remains unchanged.
    """
    if raw == [] or raw is None:
        return {}
    if not isinstance(raw, dict):
        raise ValueError('ساختار سلکتورهای جزئیات PHP معتبر نیست.')
    normalized = {}
    for field, config in raw.items():
        if field not in FIELDS:
            continue
        if isinstance(config, str):
            value = config
        elif isinstance(config, dict):
            enabled = config.get('enabled', True)
            if enabled is None or enabled is False or enabled == 0 or enabled == '' or enabled == '0' or enabled == [] or enabled == {}:
                continue
            value = config.get('selector') if config.get('selector') is not None else ''
        else:
            continue
        if not isinstance(value, str):
            raise ValueError('سلکتور جزئیات PHP باید متنی باشد.')
        if value.strip():
            normalized[field] = value.strip()
    return normalize_selectors(normalized)


def from_php(file):
    """Allowlisted settings slices. A bad/empty section cannot hide valid ones."""
    sections, ignored, warnings = {}, [], []
    declared = file.get('sections')
    if declared is not None and (not isinstance(declared, list) or any(not isinstance(v, str) for v in declared)):
        raise ValueError('فهرست بخش‌های بستهٔ PHP معتبر نیست.')

    def add(section, value):
        # PHP encodes an empty associative array as []; it is not an invalid
        # connection, nor an instruction to clear destination settings.
        if value == [] or value == {}:
            warnings.append(SECTIONS[section] + ': این بخش در فایل خالی است و تغییری اعمال نمی‌کند.')
            return
        try:
            validate({'format': FORMAT, 'schema': 1, 'sections': {section: value}})
        except ValueError:
            warnings.append(SECTIONS[section] + ': تنظیمات این بخش نامعتبر یا هنوز پشتیبانی‌نشده است؛ بخش‌های سالم قابل انتخاب‌اند.')
            return
        sections[section] = value

    for name, meta in file['files'].items():
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', name) or name in ('.', '..'):
            raise ValueError('نام فایل داخل بستهٔ PHP مجاز نیست.')
        if name not in ('profiles.json', 'connections.json'):
            ignored.append(name)
            continue
        try:
            raw = base64.b64decode(meta['b64'], validate=True)
            if len(raw) > MAX_PLAIN:
                raise ValueError()
            data = parse_json(raw)
            if data == []:
                data = {}
            if not isinstance(data, dict):
                raise ValueError()
        except (TypeError, KeyError, ValueError):
            raise ValueError('محتوای فایل پشتیبانی‌شدهٔ PHP معتبر نیست.') from None
        if name == 'profiles.json':
            # PHP profiles_products is a different slice, with no URL/selectors.
            # It must not break inspection of a connection-only settings restore.
            if declared is not None and 'profiles_products' in declared and 'profiles_cfg' not in declared and 'profiles' not in declared:
                warnings.append('فایل profiles.json فقط برش محصولات دارد؛ تنظیمات پروفایل از آن وارد نمی‌شود.')
                continue
            rows, invalid = [], False
            for key, row in data.items():
                try:
                    if not isinstance(row, dict):
                        raise ValueError()
                    config = copy.deepcopy(row.get('settings') or row.get('detail') or {})
                    if not isinstance(config, dict):
                        raise ValueError()
                    unmapped = {k: v for k, v in row.items() if k not in {'key', 'url', 'name', 'selectors', 'pagType', 'pagVal', 'settings', 'detail', 'enabled', 'detailSelectors', 'products', 'productsOrder'}}
                    if unmapped:
                        config['legacy_profile_settings'] = unmapped
                    if 'extractionEngine' in row:
                        from .scraping.engines import normalize
                        config['extractionEngine'] = normalize(row['extractionEngine'])
                    if 'detailSelectors' in row:
                        config['detailSelectors'] = php_detail_selectors(row['detailSelectors'])
                        config['legacy_detailSelectors'] = row['detailSelectors']
                    rows.append({'key': key, 'url': row.get('url', ''), 'name': row.get('name', ''),
                                 'selectors': row.get('selectors') or {}, 'pagination': {'type': row.get('pagType') or 'query_page', 'val': row.get('pagVal') or ''},
                                 'settings': config, 'enabled': row.get('enabled', True) not in (False, 0)})
                except ValueError:
                    invalid = True
                    break
            if invalid:
                warnings.append('تنظیمات پروفایل‌های PHP معتبر نیست؛ برای جلوگیری از ورود ناقص، کل این بخش کنار گذاشته شد.')
            else:
                add('profiles', rows)
        else:
            for name, value in data.items():
                name = {'woo': 'woocommerce', 'bsl': 'basalam'}.get(name, name)
                if name in ('woocommerce', 'basalam', 'render'):
                    if isinstance(value, dict):
                        value = copy.deepcopy(value)
                        for field in ('vendor_id', 'category_id'):
                            if field in value:
                                value[field] = str(value[field] or '')
                    if name == 'basalam' and isinstance(value,dict):
                        try:
                            from .basalam.shops import normalize_config
                            value=normalize_config(value)
                        except ValueError:
                            warnings.append('ساختار غرفه‌های باسلام معتبر نیست؛ این بخش وارد نشد.')
                            continue
                    if name == 'render' and isinstance(value,dict):
                        value={k:v for k,v in value.items() if k in ('url','token')}
                    add(name, value)
                else:
                    ignored.append('connections:' + str(name)[:80])
    warnings.insert(0, 'فقط تنظیمات پروفایل و اتصال‌های پشتیبانی‌شدهٔ PHP منتقل می‌شوند؛ محصولات، صف و فایل‌های دیگر اجرا یا بازیابی نمی‌شوند.')
    if ignored:
        warnings.append('بخش‌های پشتیبانی‌نشده در فایل: ' + '، '.join(ignored))
    if not sections:
        raise NoImportableSections(warnings)
    return {'format': FORMAT, 'schema': 1, 'sections': sections, 'warnings': warnings}


def validate(bundle):
    if not isinstance(bundle, dict) or bundle.get('format') != FORMAT or type(bundle.get('schema')) is not int or bundle['schema'] != 1:
        raise ValueError('ساختار یا نسخهٔ تنظیمات پشتیبانی نمی‌شود.')
    bounded(bundle)
    if len(canonical(bundle)) > MAX_PLAIN:
        raise ValueError('حجم تنظیمات بیش از حد مجاز است.')
    warnings = bundle.get('warnings', [])
    if not isinstance(warnings, list) or any(not isinstance(w, str) for w in warnings):
        raise ValueError('توضیحات فایل تنظیمات معتبر نیست.')
    sections = bundle.get('sections')
    if not isinstance(sections, dict) or not sections or set(sections) - SECTIONS.keys():
        raise ValueError('بخش‌های فایل تنظیمات معتبر نیستند.')
    for section, value in sections.items():
        if section == 'profiles':
            if not isinstance(value, list) or len(value) > 1000:
                raise ValueError('فهرست پروفایل‌ها معتبر نیست؛ حداکثر ۱۰۰۰ پروفایل.')
            seen = set()
            for row in value:
                fields = {'key', 'name', 'url', 'selectors', 'pagination', 'settings', 'enabled'}
                if not isinstance(row, dict) or set(row) != fields:
                    raise ValueError('فیلدهای پروفایل معتبر نیستند.')
                for field in ('key', 'name', 'url'):
                    if not isinstance(row[field], str) or len(row[field]) > (2000 if field == 'url' else 200) or (field != 'name' and not row[field].strip()):
                        raise ValueError('نام، کلید یا آدرس پروفایل معتبر نیست.')
                if row['key'] in seen:
                    raise ValueError('کلید پروفایل تکراری است.')
                seen.add(row['key'])
                validate_url(row['url'])
                if type(row['enabled']) is not bool or not isinstance(row['settings'], dict):
                    raise ValueError('تنظیمات یا وضعیت پروفایل معتبر نیست.')
                if not isinstance(row['selectors'], dict) or any(not isinstance(v, str) or len(v) > 1000 for v in row['selectors'].values()):
                    raise ValueError('سلکتور پروفایل معتبر نیست.')
                pagination = row['pagination']
                if not isinstance(pagination, dict) or set(pagination) - {'type', 'val'} or pagination.get('type', 'query_page') not in TYPES or not isinstance(pagination.get('val', ''), str):
                    raise ValueError('صفحه‌بندی پروفایل معتبر نیست.')
                if pagination.get('type') == 'next_selector' and not pagination.get('val'):
                    raise ValueError('سلکتور صفحهٔ بعد خالی است.')
                if pagination.get('type') == 'full_pattern':
                    validate_url(pagination.get('val', '').replace('{page}', '2'))
                if 'detailSelectors' in row['settings']:
                    normalize_selectors(row['settings']['detailSelectors'])
        elif not isinstance(value, dict):
            raise ValueError('محتوای بخش تنظیمات باید object باشد.')
        elif section in CONNECTIONS:
            for key in PUBLIC[section] | {'token', 'consumer_key', 'consumer_secret'}:
                if key in value and (not isinstance(value[key], str) or len(value[key]) > 4096 or '\r' in value[key] or '\n' in value[key]):
                    raise ValueError('فیلد اتصال معتبر نیست.')
            if section == 'woocommerce' and value.get('store_url'):
                validate_url(value['store_url'])
            if section == 'pythonanywhere' and value:
                PythonAnywhere({**value, 'token': value.get('token') or 'local-validation-only'})
            if section == 'render' and value.get('url'):
                validate_url(value['url'])
            if section == 'basalam':
                from .basalam.shops import validate_config
                validate_config(value)
                for key in ('vendor_id', 'category_id'):
                    if value.get(key) and not re.fullmatch(r'[0-9]+', value[key]):
                        raise ValueError('شناسهٔ غرفه/دسته باید عددی باشد.')
        else:
            fields = set(DEFAULTS[section])
            if set(value) != fields or any(type(value[key]) is not bool for key in fields - {'interval_seconds'}):
                raise ValueError('فیلد کنترل خودکار معتبر نیست.')
            if section == 'updates' and (type(value['interval_seconds']) is not int or not 300 <= value['interval_seconds'] <= 604800):
                raise ValueError('فاصلهٔ بررسی نسخه معتبر نیست.')
    return bundle


def snapshot(conn, secret):
    profiles = []
    for row in conn.execute('SELECT * FROM profiles ORDER BY key'):
        profiles.append({**{key: row[key] for key in ('key', 'name', 'url')}, 'enabled': bool(row['enabled']),
                         **{key: json.loads(row[key] or '{}') for key in ('selectors', 'pagination', 'settings')}})
    sections = {'profiles': profiles}
    for name in CONNECTIONS:
        row = conn.execute('SELECT config FROM connections WHERE name=?', (name,)).fetchone()
        sections[name] = unseal(row['config'], secret) if row else {}
        if name == 'basalam':
            for field in ('vendor_id', 'category_id'):
                if type(sections[name].get(field)) is int:
                    sections[name][field] = str(sections[name][field] or '')
    for section, task in CHECKPOINTS.items():
        row = conn.execute('SELECT state FROM task_checkpoints WHERE task=?', (task,)).fetchone()
        sections[section] = {**DEFAULTS[section], **(json.loads(row['state']) if row else {})}
    return {'format': FORMAT, 'schema': 1, 'sections': sections}


def selection(value, available):
    if not isinstance(value, list) or not value or any(not isinstance(v, str) for v in value) or len(set(value)) != len(value) or set(value) - set(available):
        raise ValueError('حداقل یک بخش موجود و معتبر را صریحاً انتخاب کنید.')
    return value


def deep_merge(old, new):
    result = copy.deepcopy(old)
    for key, value in new.items():
        result[key] = deep_merge(result[key], value) if key in result and isinstance(result[key], dict) and isinstance(value, dict) else copy.deepcopy(value)
    return result


def plan(current, incoming, selected, mode, credentials):
    if mode not in ('merge', 'replace') or type(credentials) is not bool:
        raise ValueError('روش بازیابی یا اجازهٔ انتقال کلیدها معتبر نیست.')
    target = copy.deepcopy(current)
    changes = []
    for section in selected:
        before, patch = current['sections'][section], incoming['sections'][section]
        if section == 'profiles':
            existing = {row['key']: copy.deepcopy(row) for row in before}
            added = updated = disabled = 0
            for row in patch:
                previous = existing.get(row['key'])
                fresh = deep_merge(previous, row) if mode == 'merge' and previous else copy.deepcopy(row)
                added += previous is None
                updated += previous is not None and previous != fresh
                existing[row['key']] = fresh
            if mode == 'replace':
                keys = {row['key'] for row in patch}
                for key, row in existing.items():
                    if key not in keys and row['enabled']:
                        row['enabled'] = False
                        disabled += 1
            target['sections'][section] = sorted(existing.values(), key=lambda row: row['key'])
            changes.append({'section': section, 'added': added, 'updated': updated, 'disabled': disabled})
        else:
            if section in CONNECTIONS:
                identities = {'woocommerce': ('store_url',), 'basalam': ('vendor_id',), 'pythonanywhere': ('site', 'username', 'domain'), 'render': ('url',)}[section]
                secrets = {'woocommerce': ('consumer_key', 'consumer_secret'), 'basalam': ('token',), 'pythonanywhere': ('token',), 'render': ('token',)}[section]
                changed_identity = before and any(key in patch and patch[key] != before.get(key) for key in identities)
                if changed_identity and any(before.get(key) for key in secrets) and (not credentials or not all(patch.get(key) for key in secrets)):
                    raise ValueError('برای تغییر هویت اتصال، کلیدهای کامل همان هویت و تأیید انتقال کلیدها لازم است.')
                if any(patch.get(key) == '••••' for key in secrets):
                    raise ValueError('کلید ماسک‌شده قابل بازیابی نیست؛ از فایل پشتیبان اصلی استفاده کنید.')
            if section == 'basalam':
                from .basalam.shops import merge_vendors
                patch = merge_vendors(before,patch,credentials,mode)
            if section in CONNECTIONS and not credentials:
                patch = {key: value for key, value in patch.items() if key in PUBLIC[section]}
                fresh = deep_merge(before, patch)
            else:
                fresh = deep_merge(before, patch) if mode == 'merge' else copy.deepcopy(patch)
            target['sections'][section] = fresh
            changes.append({'section': section, 'changed': before != fresh})
    validate(target)
    return target, changes


def signer(secret):
    return URLSafeTimedSerializer(secret, salt='scraper4-settings-preview-v1', signer_kwargs={'digest_method': hashlib.sha256})


def source_for(data, conn, secret):
    if data.get('source') == 'previous':
        row = conn.execute('SELECT config FROM connections WHERE name=?', (UNDO,)).fetchone()
        if not row:
            raise ValueError('هنوز نسخهٔ قبل از بازیابی وجود ندارد.')
        return validate(unseal(row['config'], secret))
    if data.get('source', 'file') != 'file':
        raise ValueError('منبع بازیابی معتبر نیست.')
    return decode(data.get('file'), data.get('password', ''))


def preview(db, data, binding):
    with db.connect() as conn:
        conn.execute('BEGIN')
        current = snapshot(conn, db.secret_key)
        incoming = source_for(data, conn, db.secret_key)
        available = list(incoming['sections'])
        selected = selection(data.get('sections'), available) if data.get('sections') is not None else [s for s in available if s != 'pythonanywhere']
        if not selected:
            raise ValueError('بخش موردنظر را انتخاب کنید؛ میزبانی فقط با انتخاب صریح منتقل می‌شود.')
        mode, credentials = data.get('mode', 'merge'), data.get('credentials', False)
        target, changes = plan(current, incoming, selected, mode, credentials)
        state = {'incoming': digest(incoming), 'before': digest(current), 'target': digest(target),
                 'sections': selected, 'mode': mode, 'credentials': credentials, 'binding': binding,
                 'source': data.get('source', 'file')}
        jobs = conn.execute("SELECT count(*) FROM queue_entries WHERE status IN ('waiting','running','paused')").fetchone()[0]
    return {'ok': True, 'token': signer(db.secret_key).dumps(state), 'available': available, 'selected': selected,
            'changes': changes, 'active_jobs': jobs, 'warnings': incoming.get('warnings', []) +
            ['محصولات، شناسه‌های مقصد، صف و تنظیمات نصب/امنیت دست‌نخورده می‌مانند.',
             'در جایگزینی، پروفایل‌های خارج فایل فقط غیرفعال می‌شوند؛ حذف نمی‌شوند.',
             'رمزها و کلیدها منتقل می‌شوند.' if credentials else 'کلیدها و توکن‌های اتصال فعلی حفظ می‌شوند؛ کلیدهای فایل وارد نمی‌شوند.'],
            'credential_presence': credential_presence({s:incoming['sections'][s] for s in selected}),
            'credentials_imported': credentials, 'public_cron': target['sections']['cron']['public_get']}


def write_target(conn, db, target, selected):
    now = utc_now()
    for section in selected:
        value = target['sections'][section]
        if section == 'profiles':
            for row in value:
                conn.execute('''INSERT INTO profiles (key,name,url,selectors,pagination,settings,enabled,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET name=excluded.name,url=excluded.url,
                    selectors=excluded.selectors,pagination=excluded.pagination,settings=excluded.settings,
                    enabled=excluded.enabled,updated_at=excluded.updated_at''',
                    (row['key'], row['name'], row['url'], canonical(row['selectors']).decode(), canonical(row['pagination']).decode(),
                     canonical(row['settings']).decode(), int(row['enabled']), now, now))
        elif section in CONNECTIONS:
            if section == 'basalam':
                from .basalam.shops import pin_legacy_owner
                old = conn.execute('SELECT config FROM connections WHERE name=?',('basalam',)).fetchone()
                if old: pin_legacy_owner(conn,unseal(old['config'],db.secret_key))
            conn.execute('''INSERT INTO connections (name,config,created_at,updated_at) VALUES (?,?,?,?)
                ON CONFLICT(name) DO UPDATE SET config=excluded.config,updated_at=excluded.updated_at''',
                (section, seal(value, db.secret_key), now, now))
            if section == 'pythonanywhere':
                conn.execute("DELETE FROM task_checkpoints WHERE task IN ('platform:test','platform:status')")
        else:
            conn.execute('''INSERT INTO task_checkpoints (task,state,created_at,updated_at) VALUES (?,?,?,?)
                ON CONFLICT(task) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at''',
                (CHECKPOINTS[section], canonical(value).decode(), now, now))


def apply(db, settings, data, binding):
    try:
        state = signer(db.secret_key).loads(data.get('token', ''), max_age=600)
    except (BadSignature, SignatureExpired, TypeError):
        raise Conflict('پیش‌نمایش نامعتبر یا منقضی شده است؛ دوباره پیش‌نمایش بگیرید.') from None
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Conflict('worker یا آپدیت در حال اجرا است؛ پس از پایان آن دوباره تلاش کنید.') from None
        if (settings.base_dir / '.maintenance.json').exists():
            raise Conflict('برنامه در حالت نگهداری است.')
        with db.connect() as conn:
            conn.execute('BEGIN IMMEDIATE')
            current = snapshot(conn, db.secret_key)
            incoming = source_for(data, conn, db.secret_key)
            selected = selection(data.get('sections'), incoming['sections'])
            target, changes = plan(current, incoming, selected, data.get('mode'), data.get('credentials'))
            expected = {'incoming': digest(incoming), 'before': digest(current), 'target': digest(target), 'sections': selected,
                        'mode': data.get('mode'), 'credentials': data.get('credentials'), 'binding': binding,
                        'source': data.get('source', 'file')}
            if state != expected:
                raise Conflict('فایل، انتخاب‌ها یا تنظیمات سایت پس از پیش‌نمایش تغییر کرده‌اند؛ دوباره بررسی کنید.')
            if conn.execute("SELECT 1 FROM queue_entries WHERE status IN ('waiting','running','paused') LIMIT 1").fetchone():
                raise Conflict('ابتدا کارهای در انتظار، در حال اجرا یا مکث‌شده را تمام یا لغو کنید؛ صف حذف نمی‌شود.')
            if digest(current) == digest(target):
                undo = conn.execute('SELECT 1 FROM connections WHERE name=?', (UNDO,)).fetchone()
                return {'ok': True, 'changed': False, 'changes': changes, 'undo_available': bool(undo), 'products_changed': False, 'queue_changed': False, 'credentials_imported':data.get('credentials') is True}
            now = utc_now()
            conn.execute('''INSERT INTO connections (name,config,created_at,updated_at) VALUES (?,?,?,?)
                ON CONFLICT(name) DO UPDATE SET config=excluded.config,updated_at=excluded.updated_at''',
                (UNDO, seal(current, db.secret_key), now, now))
            write_target(conn, db, target, selected)
    return {'ok': True, 'changed': True, 'changes': changes, 'undo_available': True, 'products_changed': False, 'queue_changed': False, 'credentials_imported':data.get('credentials') is True}


def credential_presence(sections):
    """Counts/booleans only; never expose credentials or hashes in reports."""
    out={}
    for name,value in sections.items():
        if name not in CONNECTIONS: continue
        fields=('consumer_key','consumer_secret') if name=='woocommerce' else ('token',)
        count=sum(bool(value.get(k)) for k in fields)
        vendors=sum(bool(v.get('token')) for v in value.get('vendors',[])) if name=='basalam' else 0
        out[name]={'keys_present':count,'vendor_tokens':vendors}
    return out
