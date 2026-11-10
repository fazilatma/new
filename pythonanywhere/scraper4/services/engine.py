"""Resumable, single-worker queue. Run via CLI/Tasks, never inside WSGI.

Checkpoint at page/product boundaries. Outbound writes cannot be exactly-once:
if a process dies after a remote create but before recording its ID, reconcile
that product remotely before resuming. No automatic retries of failed writes.
"""
import fcntl
import time
import math
import json
from dataclasses import replace

from ..db import utc_now
from .scraping.pagination import build, NEXT_SELECTOR
from .scraping.parser import parse_products, load_dom, query_inside
from .scraping.detail import normalize_selectors, parse_detail, merge_detail, sanitize_fragment, text_html, web_url
from .scraping.fetch import validate_url
from .scraping.smart_fetch import SmartFetcher, looks_like_js_shell
from .support.persian import price_num
from .support.url import absolute
from .woocommerce.client import WooClient
from .basalam.client import BasalamClient


def _extract_step(db, settings, entry, profile, network_timeout=None):
    payload, counts = entry['payload'], entry['counters']
    if payload.get('_detail_only') is True:
        from .detail_extraction import step
        return step(db,settings,entry,profile,network_timeout)
    from .start_page import options
    opts=options(profile)
    if opts['source']=='github':
        from .github_products import load_file,import_products
        products=load_file(opts['github'])
        count=import_products(db,profile,products)
        counts.update(found=count,current=1,total=1,phase='complete',source='github',warning='')
        return True
    if '_detail_selectors' not in payload:
        payload['_detail_selectors'] = normalize_selectors(profile['settings'].get('detailSelectors', {})) if payload.get('with_detail',True) else {}
    if payload.get('_phase') == 'detail':
        return _detail_step(db, settings, entry, profile, network_timeout)
    page = int(payload.get('_page', 1))
    requested = int(payload.get('pages',settings.max_pages))
    pages = 1000 if requested == 0 else max(1,min(1000,requested))
    pagination = profile['pagination']
    kind, val = pagination.get('type', 'query_page'), pagination.get('val', '')
    url = payload.get('_next_url') or (profile['url'] if page == 1 else build(profile['url'], profile['url'], page, kind, val))
    validate_url(url)
    from .scraping.engines import extract, profile_engine, for_installation
    try:
        result = extract(url, profile['selectors'], profile_engine(profile), for_installation(settings, db),
                         timeout=network_timeout or settings.fetch_timeout, render_mode=payload.get('render', 'static'))
    except ValueError as exc:
        counts.update(last_http_status=getattr(exc,'upstream_status',0),engine=profile_engine(profile))
        raise
    counts.update(last_http_status=result.get('code', 0), last_html_chars=len(result.get('html') or ''),
                  js_shell=bool(result.get('js_shell_detected') or looks_like_js_shell(result.get('html') or '')),
                  render_failed=bool(result.get('render_error')), engine=result['engine'], used_engine=result['used_engine'])
    html, effective = result.get('html', ''), result.get('url') or url
    products = result['products']
    counts['last_page_products'] = len(products)
    counts['warning'] = ('هیچ محصولی در این صفحه تشخیص داده نشد؛ سلکتور کارت، آدرس فهرست و نیاز سایت به JavaScript را بررسی کنید.' if not products
                         else 'رندر JavaScript ناموفق بود؛ نتیجه از HTML ایستا استخراج شد.' if counts['render_failed'] else '')
    if requested == 0 and products:
        import hashlib
        signature=hashlib.sha256(json.dumps(sorted(products)).encode()).hexdigest()
        seen=payload.setdefault('_page_signatures',[])
        if signature in seen:
            counts['warning']='صفحهٔ تکراری شناسایی شد؛ استخراج خودکار در انتهای واقعی/حلقه متوقف شد.'
            if payload.get('detail_mode')=='two_stage' and payload['_detail_selectors']:
                payload.update(_phase='detail',_detail_page=1,_detail_pages=page-1,_detail_keys=[],_detail_index=0,_listing_done=True)
                return _next_detail_page(db,entry)
            return True
        seen.append(signature)
    eligible = [key for key, row in products.items() if row.get('link')]
    if payload['_detail_selectors'] and len(eligible) > 1000:
        raise ValueError('Detail extraction supports at most 1000 linked products per listing page; narrow the selectors')
    for key, product in products.items():
        with db.connect() as conn:
            previous = conn.execute('SELECT sku,image,extra FROM products WHERE profile_id=? AND key=?', (profile['id'], key)).fetchone()
        if previous:
            product['sku'] = product.get('sku') or previous['sku']
            product['image'] = product.get('image') or previous['image']
        saved_extra = json.loads(previous['extra'] or '{}') if previous else {}
        if not isinstance(saved_extra,dict): saved_extra={}
        rich = {k:product[k] for k in ('images','brand','category','tags','in_stock','stock','stock_status','longDesc','shortDesc','source_id','variations') if k in product and product[k] is not None and product[k] != '' and product[k] != [] and product[k] != {}}
        if rich: product['extra'] = {**saved_extra, **rich}
        product['price_num'] = price_num(product.get('price', ''))
        db.upsert_product(profile['id'], key, product)
    counts.update(current=page, total=pages, found=counts.get('found', 0) + len(products))
    payload['_page'] = page + 1
    done = page >= pages or not products or result.get('last_page', False)
    if result.get('next_url'):
        next_url = validate_url(result['next_url'])
        visited = payload.setdefault('_visited', [])
        if next_url in visited or next_url == url: done = True
        visited.append(url)
        payload['_next_url'] = next_url
    elif kind == NEXT_SELECTOR and not done:
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
    counts['phase'] = 'listing'
    if payload.get('detail_mode') == 'two_stage' and payload['_detail_selectors']:
        db.checkpoint_write(f'start:seen:{entry["id"]}:{page}',{'keys':eligible},entry['id'])
        if not done:return False
        payload.update(_phase='detail',_detail_page=1,_detail_pages=page,_detail_keys=[],_detail_index=0,_listing_done=True)
        counts.update(phase='detail',detail_current=0,detail_total=0)
        return _next_detail_page(db,entry)
    if payload['_detail_selectors'] and eligible:
        payload.update(_phase='detail', _detail_keys=eligible, _detail_index=0, _listing_done=done)
        counts.update(phase='detail', detail_current=0, detail_total=len(eligible))
        return False
    return done


def _next_detail_page(db,entry):
    payload,counts=entry['payload'],entry['counters']
    if payload['_detail_page']>payload['_detail_pages']:
        counts['phase']='complete'
        return True
    keys=db.checkpoint_read(f'start:seen:{entry["id"]}:{payload["_detail_page"]}').get('keys',[])
    payload.update(_detail_keys=keys,_detail_index=0)
    counts.update(phase='detail',detail_current=0,detail_total=len(keys),detail_page=payload['_detail_page'])
    if not keys:payload['_detail_page']+=1
    return False


def _detail_step(db, settings, entry, profile, network_timeout=None):
    payload, counts = entry['payload'], entry['counters']
    index, keys = int(payload.get('_detail_index', 0)), payload.get('_detail_keys', [])
    if not keys and payload.get('detail_mode')=='two_stage':return _next_detail_page(db,entry)
    if index >= len(keys):
        raise ValueError('Invalid detail checkpoint')
    with db.connect() as conn:
        row = conn.execute('SELECT * FROM products WHERE profile_id=? AND key=?',
                           (profile['id'], keys[index])).fetchone()
    seen=f'start:seen:{entry["id"]}:detail:{keys[index]}'
    already=payload.get('detail_mode')=='two_stage' and db.checkpoint_read(seen).get('done')
    if row and row['link'] and not already:
        url = validate_url(row['link'])
        from .scraping.engines import extract, profile_engine, for_installation
        engine = profile_engine(profile)
        if engine == 'selectors':
            # Preserve the established static detail contract for legacy profiles.
            net = settings.net.as_dict() if network_timeout else settings.net
            if network_timeout: net['_deadline_seconds'] = 12
            result = SmartFetcher.get(url, timeout=network_timeout or settings.fetch_timeout, net=net,
                                      mode=payload.get('render', 'static'), settings=settings)
            counts['last_http_status']=int(result.get('code') or 0)
            counts['last_html_chars']=len(result.get('html') or '')
            if not result.get('ok'): raise ValueError('Detail fetch failed; check source/network before retry')
            effective = validate_url(result.get('url') or url)
            fresh = parse_detail(result.get('html', ''), effective, payload['_detail_selectors'])
        else:
            result = extract(url, {}, engine, for_installation(settings,db), timeout=network_timeout or settings.fetch_timeout)
            effective = validate_url(result.get('url') or url)
            if engine in ('basalam_api','digikala_api'):
                record = next(iter(result['products'].values()), {})
                fresh = {k:record[k] for k in payload['_detail_selectors'] if record.get(k)}
                for k in ('shortDesc','longDesc','specs'):
                    if k in fresh: fresh[k] = sanitize_fragment(fresh[k],effective)
            else:
                fresh = parse_detail(result.get('html',''),effective,payload['_detail_selectors'])
        # Merge against the latest row, preserving unrelated extra data and all
        # pricing/remote IDs. Never regenerate a product key from enriched data.
        with db.connect() as conn:
            live = conn.execute('SELECT extra,sku,image FROM products WHERE id=?', (row['id'],)).fetchone()
            if live:
                extra = merge_detail(json.loads(live['extra'] or '{}'), fresh)
                extra.update(_detail_status='ok' if fresh else 'empty', _detail_checked_at=utc_now(), _detail_source_url=effective)
                conn.execute('UPDATE products SET extra=?,sku=?,image=?,updated_at=? WHERE id=?',
                    (json.dumps(extra,ensure_ascii=False,separators=(',',':')), fresh.get('sku') or live['sku'],
                     live['image'] or next(iter(extra.get('images') or []), ''), utc_now(), row['id']))
        field = 'detail_enriched' if fresh else 'detail_empty'
        counts[field] = counts.get(field, 0) + 1
        if payload.get('detail_mode')=='two_stage':db.checkpoint_write(seen,{'done':True},entry['id'])
    else:
        counts['detail_skipped'] = counts.get('detail_skipped', 0) + 1
    payload['_detail_index'] = index + 1
    counts['detail_current'] = index + 1
    if index + 1 < len(keys):
        return False
    if payload.get('detail_mode')=='two_stage':
        payload['_detail_page']+=1
        return _next_detail_page(db,entry)
    done = bool(payload.get('_listing_done'))
    for key in ('_phase','_detail_keys','_detail_index','_listing_done'):
        payload.pop(key, None)
    counts['phase'] = 'complete' if done else 'listing'
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
    extra = json.loads(product.get('extra') or '{}')
    if not isinstance(extra, dict):
        extra = {}
    description = sanitize_fragment(extra.get('longDesc', ''), product.get('link') or profile['url'])
    short = sanitize_fragment(extra.get('shortDesc', ''), product.get('link') or profile['url'])
    specs = sanitize_fragment(extra.get('specs', ''), product.get('link') or profile['url'])
    if specs and specs not in description:
        description += '<h4>مشخصات فنی</h4>' + specs
    from . import profile_options
    opts=profile_options.active(profile)
    send_title=profile_options.title(profile,product['title'])
    remote_id = product.get(remote_column)
    shop = None
    if target == 'basalam':
        from .basalam.shops import resolve, owner, remote_id as shop_remote_id
        bsl_cfg = db.get_config('basalam')
        legacy_owner = owner(db,bsl_cfg)
        shop = resolve(bsl_cfg, payload.get('vendor_id') or legacy_owner)
        payload.setdefault('vendor_id',shop['vendor_id'])
        remote_id = shop_remote_id(product,extra,shop['vendor_id'],legacy_owner)
    if remote_id and not payload.get('force'):
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
            body = {'name': send_title, 'type': 'simple', 'status': payload.get('status', 'draft'),
                    'regular_price': str(profile_options.adjust(profile_options.price(profile,product['price_num'],'woo'),cfg.get('price_mode','none'),cfg.get('price_val',0),cfg.get('price_round',0)))}
            if product.get('sku'):
                body['sku'] = product['sku']
            if description:
                body['description'] = description
            if short:
                body['short_description'] = short
            gallery = []
            for value in [product.get('image', ''), *(extra.get('images') if isinstance(extra.get('images'), list) else [])]:
                url = web_url(value, product.get('link') or profile['url']) if isinstance(value, str) else ''
                if url and url not in gallery and len(gallery) < 30:
                    gallery.append(url)
            if gallery:
                body['images'] = [{'src': url} for url in gallery]
            attributes = [r for r in (extra.get('specs_rows') if isinstance(extra.get('specs_rows'), list) else []) if isinstance(r, dict) and r.get('k') and r.get('v')][:100]
            if attributes:
                body['attributes'] = [{'name':str(r['k']), 'visible':True, 'variation':False, 'options':[str(r['v'])]} for r in attributes]
            category=payload.get('category_id') or opts['wooProfileCatId'] or cfg.get('default_category')
            if category:body['categories']=[{'id':int(category)}]
            result = client.update_product(product['woo_id'], body) if product.get('woo_id') else client.create_product(body)
        else:
            cfg = {**bsl_cfg, **shop}
            from .basalam.shops import adjusted_price
            amount = adjusted_price(profile_options.price(profile,product['price_num'],'basalam'),bsl_cfg,shop)
            client = BasalamClient.from_connection(cfg, api_base=settings.basalam_api_base)
            if network_timeout:
                client.timeout, client.connect_timeout, client.max_attempts = network_timeout, 3, 1
            body = {'name': send_title, 'primary_price': amount*10, 'description': text_html(description or short)[:10000] or product['title']}
            category = payload.get('category_id') or opts['bslProfileCatId'] or cfg.get('category_id')
            if category:
                body['category_id'] = int(category)
            result = (client.update_product(remote_id, body, cfg['vendor_id'])
                      if remote_id else client.create_product(cfg['vendor_id'], body))
        remote = result.get('body')
        if not result.get('ok') or not isinstance(remote, dict) or not remote.get('id'):
            # Stop here: operator can inspect the error before attempting again.
            counts['failed'] = counts.get('failed', 0) + 1
            raise ValueError(f"{target}: HTTP {result.get('code', 0)}; verify product {product['id']} remotely before retry")
        if target == 'basalam':
            from .basalam.shops import mark_remote
            mark_remote(db,product['id'],shop['vendor_id'],int(remote['id']),legacy_owner)
        else:
            db.mark_product_target(product['id'], target, int(remote['id']))
        field = 'updated' if remote_id else 'sent'
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
                done = entry['payload'].get('_extraction_complete',False) or _extract_step(db, settings, entry, profile, network_timeout)
                if done: entry['payload']['_extraction_complete']=True
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
                if entry['kind']=='extract':
                    from ..start import finish_extraction
                    finish_extraction(db,entry)
                else:db.finish_entry(entry['id'])
                return
        db.update_entry(entry['id'], status='waiting')
    except Exception as exc:
        if entry['kind']=='extract':
            from .extraction_diagnostics import failure
            code,hint=failure(exc,entry['counters'])
            entry['counters'].update(error_code=code,error_hint=hint)
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
              dict(name='password_or_explicit_open_mode', ok=settings.access_mode=='open' or bool(settings.password)),
              dict(name='selectors', ok=bool(css_to_xpath('.product'))),
              dict(name='pagination', ok=build('https://t.test/shop', 'https://t.test/shop', 2,
                   'path_pattern', '~page~{page}') == 'https://t.test/shop~page~2')]
    return {'ok': all(c['ok'] for c in checks), 'checks': checks}
