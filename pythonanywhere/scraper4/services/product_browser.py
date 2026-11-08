"""Read-only PHP-like product overview and scoped server-side result browsing.

Aggregates use primary columns, not remote inventory or guessed stock. No schema
migration, JSON1 dependency, outbound fetch, or product mutation is needed.
"""
import json
import re
import unicodedata

from ..db import utc_now
from .scraping.detail import sanitize_fragment, text_html, web_url
from .support.persian import fa_digits_to_en

# Indexed checkpoint range avoids scanning descriptions/JSON blobs for shop IDs.
BSL_LINKED = "(coalesce(p.basalam_id,0)>0 OR EXISTS(SELECT 1 FROM task_checkpoints z WHERE z.task>=('basalam:remote:'||p.id||':') AND z.task<('basalam:remote:'||p.id||';')))"

METRICS = {
    'all': ('کل محصولات', '1'),
    'priced': ('دارای قیمت', 'p.price_num > 0'),
    'no_price': ('بدون قیمت', 'p.price_num <= 0'),
    'with_image': ('دارای تصویر شاخص', "trim(p.image) <> ''"),
    'linked': ('دارای لینک مبدأ', "trim(p.link) <> ''"),
    'sku': ('دارای SKU', "trim(p.sku) <> ''"),
    'woo_linked': ('مرتبط با ووکامرس', 'coalesce(p.woo_id,0) > 0'),
    'bsl_linked': ('مرتبط با باسلام', BSL_LINKED),
    'woo_missing': ('بدون شناسهٔ ووکامرس', 'coalesce(p.woo_id,0) <= 0'),
    'bsl_missing': ('بدون شناسهٔ باسلام', 'NOT '+BSL_LINKED),
}
SORTS = {'oldest': 'p.id ASC', 'newest': 'p.id DESC',
         'price_asc': 'p.price_num ASC,p.id ASC', 'price_desc': 'p.price_num DESC,p.id ASC',
         'title': 'p.title COLLATE NOCASE ASC,p.id ASC'}
SUMMARY_KEYS = ('brand', 'category', 'tags', 'images_count', '_detail_preview', '_detail_status')


def search_text(value):
    value = fa_digits_to_en(unicodedata.normalize('NFKC', str(value or ''))).casefold()
    value = value.translate(str.maketrans({'ي': 'ی', 'ى': 'ی', 'ك': 'ک', '\u200c': ' ', '\u200f': '', '\u200e': ''}))
    return re.sub(r'\s+', ' ', value).strip()


def number(args, key, default=None, *, minimum=0, maximum=2147483647):
    value = args.get(key)
    if value is None:
        return default
    if not re.fullmatch(r'[0-9]{1,10}', str(value)) or not minimum <= int(value) <= maximum:
        raise ValueError('پارامتر عددی مرور محصولات معتبر نیست.')
    return int(value)


def scope(args):
    where, values = ['1'], []
    pid = number(args, 'profile_id', minimum=1)
    if pid is not None:
        where.append('p.profile_id=?'); values.append(pid)
    query = args.get('q', '')
    if not isinstance(query, str) or len(query) > 200:
        raise ValueError('جست‌وجو حداکثر ۲۰۰ نویسه است.')
    query = search_text(query)
    if query:
        # instr treats %, _, backslashes and quotes literally, not as SQL/LIKE.
        where.append("instr(s4_search(p.title || ' ' || p.sku || ' ' || p.link),?) > 0")
        values.append(query)
    return ' AND '.join(where), values


def counts_sql():
    return ','.join(f'coalesce(sum(CASE WHEN {sql} THEN 1 ELSE 0 END),0) AS "{key}"' for key, (_, sql) in METRICS.items())


def extra(value):
    try:
        data = json.loads(value or '{}')
        return data if isinstance(data, dict) else {}
    except (ValueError, TypeError):
        return {}


def list_products(db, args):
    where, values = scope(args)
    metric = args.get('filter', 'all')
    order = args.get('sort', 'oldest')
    from .start_page import EXTRA_FILTERS, metric_test
    extended = metric in EXTRA_FILTERS
    if (metric not in METRICS and not extended) or order not in SORTS:
        raise ValueError('فیلتر یا مرتب‌سازی محصولات معتبر نیست.')
    limit = number(args, 'limit', 100, minimum=1, maximum=500)
    offset = number(args, 'offset', 0)
    with db.connect() as conn:
        conn.create_function('s4_search', 1, search_text, deterministic=True)
        conn.create_function('s4_start_metric',6,metric_test,deterministic=True)
        predicate = f"s4_start_metric(p.image,p.link,p.price_num,p.sku,p.extra,'{metric}')=1" if extended else METRICS[metric][1]
        conn.execute('BEGIN')
        counts = dict(conn.execute(f'SELECT {counts_sql()} FROM products p WHERE {where}', values).fetchone())
        total = conn.execute(f'SELECT count(*) FROM products p WHERE {where} AND ({predicate})',values).fetchone()[0] if extended else counts[metric]
        # Deletions in another tab can invalidate the last requested page.
        if total and offset >= total:
            offset = ((total - 1) // limit) * limit
        elif not total:
            offset = 0
        rows = conn.execute(f'''SELECT p.*,coalesce(nullif(r.name,''),r.key) AS profile_name,r.key AS profile_key,{BSL_LINKED} AS basalam_linked
            FROM products p JOIN profiles r ON r.id=p.profile_id
            WHERE {where} AND ({predicate}) ORDER BY {SORTS[order]} LIMIT ? OFFSET ?''',
            (*values, limit, offset)).fetchall()
    products = []
    for row in rows:
        value = dict(row)
        value['extra'] = extra(value['extra'])
        if args.get('summary') == '1':
            value['extra'] = {key: value['extra'][key] for key in SUMMARY_KEYS if key in value['extra']}
        products.append(value)
    return {'ok': True, 'products': products, 'total': total, 'counts': counts,
            'offset': offset, 'limit': limit, 'filter': metric, 'sort': order}


def overview(db):
    # One consistent read transaction; no N+1 per-profile requests or HTML blobs.
    with db.connect() as conn:
        conn.execute('BEGIN')
        totals = dict(conn.execute(f'SELECT {counts_sql()} FROM products p').fetchone())
        grouped = {row['profile_id']: dict(row) for row in conn.execute(
            f'SELECT p.profile_id,{counts_sql()} FROM products p GROUP BY p.profile_id')}
        profiles = []
        for row in conn.execute('SELECT id,key,name,enabled FROM profiles ORDER BY id DESC'):
            counts = grouped.get(row['id'], {key: 0 for key in METRICS})
            profiles.append({**dict(row), 'name': row['name'] or row['key'], 'counts': {key: counts[key] for key in METRICS}})
    return {'ok': True, 'totals': totals, 'by_profile': profiles, 'generated_at': utc_now(),
            'source': 'local_saved_products', 'remote_inventory': False}


def detail(db, product_id):
    with db.connect() as conn:
        row = conn.execute('''SELECT p.*,coalesce(nullif(r.name,''),r.key) AS profile_name,r.url AS profile_url
            FROM products p JOIN profiles r ON r.id=p.profile_id WHERE p.id=?''', (product_id,)).fetchone()
    if not row:
        return None
    data = dict(row); fields = extra(data.pop('extra'))
    base = data['link'] or data['profile_url']
    images = []
    gallery = fields.get('images') if isinstance(fields.get('images'), list) else []
    for candidate in [data['image'], *gallery[:30]]:
        url = web_url(candidate, base) if isinstance(candidate, str) else ''
        if url.startswith('https://') and url not in images and len(images) < 30:
            images.append(url)
    specs = fields.get('specs_rows') if isinstance(fields.get('specs_rows'), list) else []
    specs = [{'k': str(row['k'])[:120], 'v': str(row['v'])[:2000]} for row in specs[:100]
             if isinstance(row, dict) and isinstance(row.get('k'), str) and isinstance(row.get('v'), str)]
    view = {key: str(fields.get(key) or '')[:1000] for key in ('brand', 'category', 'tags', '_detail_status', '_detail_checked_at')}
    targets=fields.get('basalam_targets') or {}
    view.update(images=images, specs=specs, basalam_targets={str(k):v for k,v in targets.items() if str(k).isdigit() and type(v) is int and v>0} if isinstance(targets,dict) else {})
    for key in ('shortDesc', 'longDesc', 'specs'):
        view[key + '_text'] = text_html(sanitize_fragment(fields.get(key, ''), base))[:30000]
    data['link'] = web_url(data['link'], data['profile_url'])
    return {'ok': True, 'product': data, 'details': view}
