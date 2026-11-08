"""Resumable, single-worker queue. Run via CLI/Tasks, never inside WSGI.

Checkpoint at page/product boundaries. Outbound writes cannot be exactly-once:
if a process dies after a remote create but before recording its ID, reconcile
that product remotely before resuming. No automatic retries of failed writes.
"""
import fcntl
import time
import math
from dataclasses import replace

from ..db import utc_now
from .scraping.pagination import build, NEXT_SELECTOR
from .scraping.parser import parse_products, load_dom, query_inside
from .scraping.fetch import validate_url
from .scraping.smart_fetch import SmartFetcher
from .support.persian import price_num
from .support.url import absolute
from .woocommerce.client import WooClient
from .basalam.client import BasalamClient


def _extract_step(db, settings, entry, profile, network_timeout=None):
    payload, counts = entry['payload'], entry['counters']
    page = int(payload.get('_page', 1))
    pages = max(1, min(100, int(payload.get('pages', settings.max_pages))))
    pagination = profile['pagination']
    kind, val = pagination.get('type', 'query_page'), pagination.get('val', '')
    url = payload.get('_next_url') or (profile['url'] if page == 1 else build(profile['url'], profile['url'], page, kind, val))
    validate_url(url)
    net = settings.net.as_dict() if network_timeout else settings.net
    if network_timeout:
        net['_deadline_seconds'] = 12
    result = SmartFetcher.get(url, timeout=network_timeout or settings.fetch_timeout, net=net,
                              mode=payload.get('render', 'static'), settings=settings)
    if not result.get('ok'):
        raise ValueError(result.get('error') or 'Fetch failed')
    html, effective = result.get('html', ''), result.get('url') or url
    products = parse_products(html, effective, profile['selectors'])
    for key, product in products.items():
        product['price_num'] = price_num(product.get('price', ''))
        db.upsert_product(profile['id'], key, product)
    counts.update(current=page, total=pages, found=counts.get('found', 0) + len(products))
    payload['_page'] = page + 1
    done = page >= pages or not products
    if kind == NEXT_SELECTOR and not done:
        nodes = query_inside(load_dom(html), val)
        href = nodes[0].get('href') if nodes else ''
        next_url = absolute(href, effective) if href else ''
        visited = payload.setdefault('_visited', [])
        visited.append(url)
        if not next_url or next_url in visited:
            done = True
        else:
            validate_url(next_url)
            payload['_next_url'] = next_url
    count = db.sync_profile_count(profile['id'])
    db.touch_profile(profile['id'], count)
    return done


def _send_step(db, settings, entry, profile, network_timeout=None):
    payload, counts = entry['payload'], entry['counters']
    target = 'woo' if entry['kind'] == 'woo_send' else 'basalam'
    remote_column = 'woo_id' if target == 'woo' else 'basalam_id'
    after = int(payload.get('_after_id', 0))
    # A stable primary-key cursor avoids skipping records as remote IDs change.
    with db.connect() as conn:
        row = conn.execute('SELECT * FROM products WHERE profile_id = ? AND id > ? ORDER BY id LIMIT 1',
                           (profile['id'], after)).fetchone()
    if not row:
        return True
    product = dict(row)
    if product.get(remote_column) and not payload.get('force'):
        counts['skipped'] = counts.get('skipped', 0) + 1
    else:
        if target == 'woo':
            cfg = db.get_config('woocommerce')
            if not all(cfg.get(k) for k in ('store_url', 'consumer_key', 'consumer_secret')):
                raise ValueError('WooCommerce connection is incomplete')
            validate_url(cfg['store_url'])
            client = WooClient.from_connection(cfg, verify=True)
            if network_timeout:
                client.timeout, client.connect_timeout = network_timeout, 3
            body = {'name': product['title'], 'type': 'simple', 'status': payload.get('status', 'draft'),
                    'regular_price': str(product['price_num'])}
            if product.get('sku'):
                body['sku'] = product['sku']
            if product.get('image'):
                body['images'] = [{'src': product['image']}]
            if payload.get('category_id'):
                body['categories'] = [{'id': int(payload['category_id'])}]
            result = client.update_product(product['woo_id'], body) if product.get('woo_id') else client.create_product(body)
        else:
            cfg = db.get_config('basalam')
            if not cfg.get('token') or not cfg.get('vendor_id'):
                raise ValueError('Basalam token/vendor_id are required')
            client = BasalamClient.from_connection(cfg, api_base=settings.basalam_api_base)
            if network_timeout:
                client.timeout, client.connect_timeout, client.max_attempts = network_timeout, 3, 1
            body = {'name': product['title'], 'price': product['price_num'], 'description': product['title']}
            category = payload.get('category_id') or cfg.get('category_id')
            if category:
                body['category_id'] = int(category)
            result = (client.update_product(product['basalam_id'], body, cfg['vendor_id'])
                      if product.get('basalam_id') else client.create_product(cfg['vendor_id'], body))
        remote = result.get('body')
        if not result.get('ok') or not isinstance(remote, dict) or not remote.get('id'):
            # Stop here: operator can inspect the error before attempting again.
            counts['failed'] = counts.get('failed', 0) + 1
            raise ValueError(f"{target}: HTTP {result.get('code', 0)}; verify product {product['id']} remotely before retry")
        db.mark_product_target(product['id'], target, int(remote['id']))
        field = 'updated' if product.get(remote_column) else 'sent'
        counts[field] = counts.get(field, 0) + 1
    payload['_after_id'] = product['id']
    counts['current'] = counts.get('current', 0) + 1
    counts['total'] = db.count_products(profile['id'])
    return False


def run_entry(db, settings, entry, deadline, *, max_steps=None, network_timeout=None):
    profile = db.get_profile(entry['profile_id']) if entry.get('profile_id') else None
    try:
        if not profile:
            raise ValueError('Profile not found')
        steps = 0
        while time.monotonic() < deadline and (max_steps is None or steps < max_steps):
            live = db.get_entry(entry['id'])
            if live['status'] != 'running':
                return
            if entry['kind'] == 'extract':
                done = _extract_step(db, settings, entry, profile, network_timeout)
            elif entry['kind'] in ('woo_send', 'bsl_send'):
                done = _send_step(db, settings, entry, profile, network_timeout)
            else:
                raise ValueError('Unknown queue kind')
            steps += 1
            # Do not overwrite a pause/cancel requested during a network call.
            db.update_entry(entry['id'], payload=entry['payload'], counters=entry['counters'], heartbeat=utc_now())
            if db.get_entry(entry['id'])['status'] != 'running':
                return
            if done:
                db.finish_entry(entry['id'])
                return
        db.update_entry(entry['id'], status='waiting')
    except Exception as exc:
        db.update_entry(entry['id'], payload=entry['payload'], counters=entry['counters'])
        if db.get_entry(entry['id'])['status'] == 'running':
            db.finish_entry(entry['id'], 'failed', str(exc))


def auto_enqueue(db, settings):
    from datetime import datetime, timedelta, timezone
    from ..db import parse_ts
    if settings.auto_extract_minutes <= 0:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.auto_extract_minutes)
    alive = {e['profile_id'] for e in db.list_entries(True, 10000) if e['kind'] == 'extract'}
    count = 0
    for profile in db.list_profiles():
        last = parse_ts(profile['last_scraped_at'])
        if profile['enabled'] and profile['id'] not in alive and (not last or last < cutoff):
            db.enqueue('extract', profile['id'], {'pages': settings.max_pages})
            count += 1
    return count


def tick(db, settings, budget_seconds=None, max_entries=25):
    if (settings.base_dir / '.maintenance.json').exists():
        return {'ok': False, 'error': 'Maintenance recovery required; run maintain first'}
    path = settings.db_path.with_suffix('.worker.lock')
    with path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'ok': True, 'busy': True, 'ran': 0}
        return _tick_locked(db, settings, budget_seconds, max_entries)


def _tick_locked(db, settings, budget_seconds=None, max_entries=25, *, max_steps=None, network_timeout=None):
    recovered = db.recover_stale(settings.worker_stale_seconds)
    enqueued = auto_enqueue(db, settings)
    start = time.monotonic()
    deadline = start + max(1, int(budget_seconds or settings.tick_budget_seconds))
    ran = 0
    while ran < max_entries and time.monotonic() < deadline:
        entry = db.claim_next()
        if not entry:
            break
        run_entry(db, settings, entry, deadline, max_steps=max_steps, network_timeout=network_timeout)
        ran += 1
    return {'ok': True, 'ran': ran, 'recovered': recovered, 'enqueued': enqueued,
            'seconds': round(time.monotonic() - start, 2)}


def http_tick(db, settings):
    """One resumable page/product per authenticated external cron request.

    This is intentionally not maintain(): no pip, code deployment, shell or
    background thread in WSGI. Timeouts/budget are soft request bounds, not an
    OS deadline. Use CLI/always-on workers for slow or JS-heavy sources.
    """
    if (settings.base_dir / '.maintenance.json').exists():
        return {'ok': False, 'maintenance': True}
    with settings.db_path.with_suffix('.worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {'ok': True, 'busy': True, 'ran': 0}
        previous = db.checkpoint_read('cron:last')
        since = time.time() - previous.get('started_epoch', 0)
        if since < 45:
            return {'ok': True, 'throttled': True, 'retry_after_seconds': math.ceil(45 - since), 'ran': 0}
        started = {'started_at': utc_now(), 'started_epoch': time.time(), 'status': 'running'}
        db.checkpoint_write('cron:last', started)
        # Avoid inheriting arbitrarily long pacing / rendering timeouts.
        bounded = replace(settings, fetch_timeout=8, connect_timeout=3,
                          net=replace(settings.net, gap_ms=min(settings.net.gap_ms, 500), fallback=False),
                          render=replace(settings.render, timeout_ms=min(settings.render.timeout_ms, 5000)))
        try:
            result = _tick_locked(db, bounded, 15, 1, max_steps=1, network_timeout=8)
        except Exception:
            db.checkpoint_write('cron:last', {**started, 'status': 'failed', 'done_at': utc_now()})
            raise
        db.checkpoint_write('cron:last', {**started, 'status': 'done', 'done_at': utc_now(), 'result': result})
        return {**result, 'mode': 'single_step', 'code_updates': False}


def selftest(db, settings, network=False):
    from .scraping.css_to_xpath import css_to_xpath
    checks = [dict(name='database', ok=isinstance(db.stats()['products'], int)),
              dict(name='secret', ok=bool(settings.secret_key)),
              dict(name='password', ok=bool(settings.password)),
              dict(name='selectors', ok=bool(css_to_xpath('.product'))),
              dict(name='pagination', ok=build('https://t.test/shop', 'https://t.test/shop', 2,
                   'path_pattern', '~page~{page}') == 'https://t.test/shop~page~2')]
    return {'ok': all(c['ok'] for c in checks), 'checks': checks}
