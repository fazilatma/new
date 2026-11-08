"""Bounded HTTP fetching compatible with PythonAnywhere's outbound proxy.

No process-global socket monkey patches. DNS pinning/DoH are deliberately not
implemented: these cannot bypass PythonAnywhere's account network policy.
"""
import ipaddress
import socket
import threading
import time
from urllib.parse import quote, urlsplit, urljoin

import requests

from ...config import FetchNet, get_settings

MAX_BYTES = 12 * 1024 * 1024


def validate_url(url: str, resolve: bool = False) -> str:
    parts = urlsplit(url)
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password:
        raise ValueError('Only HTTP(S) URLs without credentials are accepted')
    if parts.port and parts.port not in (80, 443):
        raise ValueError('Only ports 80 and 443 are accepted')
    host = parts.hostname.lower()
    if host == 'localhost' or host.endswith(('.localhost', '.local')):
        raise ValueError('Private network targets are not accepted')
    try:
        addresses = [ipaddress.ip_address(host)]
    except ValueError:
        addresses = []
        if resolve:
            addresses = [ipaddress.ip_address(r[4][0]) for r in socket.getaddrinfo(host, parts.port or 443)]
    if any(not addr.is_global for addr in addresses):
        raise ValueError('Private network targets are not accepted')
    return url


class HtmlFetcher:
    _last_hit = {}
    _lock = threading.Lock()

    @classmethod
    def pace(cls, host, gap_ms):
        with cls._lock:
            wait = cls._last_hit.get(host, 0) + max(0, gap_ms) / 1000 - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            cls._last_hit[host] = time.monotonic()

    @classmethod
    def get(cls, url, timeout=25, net=None, settings=None):
        settings = settings or get_settings()
        cfg = net.as_dict() if isinstance(net, FetchNet) else dict(net or {})
        mode = cfg.get('mode', 'direct')
        hosts = str(cfg.get('hosts', '')).replace(',', ' ').split()
        host = urlsplit(url).hostname or ''
        if hosts and not any(host == h or host.endswith('.' + h) for h in hosts):
            mode = 'direct'
        modes = [mode]
        if cfg.get('fallback'):
            modes += [m for m, key in [('proxy', 'proxy'), ('worker', 'worker_url')]
                      if cfg.get(key) and m not in modes]
        cls.pace(host, int(cfg.get('gap_ms') or 0))
        result = {}
        for mode in modes:
            result = cls._attempt(url, timeout, cfg, mode, settings)
            if result['ok'] or result['code'] not in (0, 403, 429):
                break
        return result

    @staticmethod
    def _attempt(url, timeout, cfg, mode, settings):
        result = dict(ok=False, code=0, error='', url=url, html='', mode=mode)
        deadline = time.monotonic() + float(cfg['_deadline_seconds']) if cfg.get('_deadline_seconds') else None
        try:
            validate_url(url)
            target, proxies = url, None
            if mode in ('dns', 'doh'):
                raise ValueError('DNS pinning/DoH is not supported on this PythonAnywhere port')
            if mode == 'worker':
                worker = str(cfg.get('worker_url') or '')
                if not worker:
                    raise ValueError('Worker URL is not configured')
                target = worker.replace('{url}', quote(url, safe='')) if '{url}' in worker else worker.rstrip('/') + '/' + url
            elif mode == 'proxy':
                proxy = str(cfg.get('proxy') or '')
                if not proxy:
                    raise ValueError('Proxy URL is not configured')
                if '://' not in proxy:
                    proxy = str(cfg.get('proxy_type') or 'http') + '://' + proxy
                if cfg.get('proxy_auth'):
                    user, _, password = str(cfg['proxy_auth']).partition(':')
                    proxy = proxy.replace('://', '://' + quote(user, safe='') + ':' + quote(password, safe='') + '@', 1)
                proxies = {'http': proxy, 'https': proxy}
            elif mode != 'direct':
                raise ValueError('Unknown fetch mode')
            with requests.Session() as session:
                # trust_env stays enabled: PythonAnywhere free accounts need it.
                for _ in range(6):
                    if deadline and time.monotonic() >= deadline:
                        raise ValueError('HTTP cron fetch budget exceeded')
                    validate_url(target, resolve=True)
                    remaining = max(0.1, deadline - time.monotonic()) if deadline else None
                    timeouts = ((min(settings.connect_timeout, remaining), min(timeout, remaining))
                                if remaining is not None else (settings.connect_timeout, timeout))
                    with session.get(target, timeout=timeouts,
                                     headers={'User-Agent': settings.user_agent, 'Accept-Language': 'fa,en;q=0.8'},
                                     proxies=proxies, verify=True, allow_redirects=False, stream=True) as response:
                        if response.status_code in (301, 302, 303, 307, 308):
                            target = urljoin(target, response.headers.get('Location', ''))
                            continue
                        result.update(code=response.status_code, url=url if mode == 'worker' else response.url)
                        chunks, size = [], 0
                        for chunk in response.iter_content(65536):
                            if deadline and time.monotonic() >= deadline:
                                raise ValueError('HTTP cron fetch budget exceeded')
                            size += len(chunk)
                            if size > MAX_BYTES:
                                raise ValueError('Response exceeds 12 MiB limit')
                            chunks.append(chunk)
                        result['html'] = _decode(b''.join(chunks), response.headers.get('Content-Type', ''))
                        result['ok'] = 200 <= response.status_code < 300 and bool(result['html'])
                        result['error'] = '' if result['ok'] else f'HTTP {response.status_code}'
                        return result
                raise ValueError('Too many redirects')
        except (requests.RequestException, ValueError, OSError) as exc:
            result['error'] = str(exc)
        return result


def _decode(body, content_type):
    import re
    match = re.search(r'charset=([\w-]+)', content_type, re.I)
    enc = match.group(1) if match else ''
    if not enc:
        match = re.search(rb'<meta[^>]+charset=["\x27]?([\w-]+)', body[:4096], re.I)
        enc = match.group(1).decode() if match else ''
    for encoding in (enc, 'utf-8', 'cp1256'):
        if encoding:
            try:
                return body.decode(encoding)
            except (LookupError, UnicodeDecodeError):
                pass
    return body.decode('utf-8', 'replace')


def get(url, timeout=25, net=None, settings=None):
    return HtmlFetcher.get(url, timeout, net, settings)
