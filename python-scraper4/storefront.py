"""Public Persian storefront, orders, payments and Basalam webhooks for Scraper4.

The module is deliberately registered from ``scraper4.py`` after the existing
classic application and Node-parity dashboard.  It keeps the public commerce
surface separate from administration and never sends gateway credentials to a
browser.
"""
from __future__ import annotations

import base64
import copy
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from html import escape
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlencode, urlparse

from flask import Response, jsonify, redirect, request, send_from_directory

try:  # Linux production lock; the in-process RLock remains the fallback.
    import fcntl
except ImportError:  # pragma: no cover - Windows development only
    fcntl = None  # type: ignore[assignment]

_CORE: Any = None
_REGISTERED = False
_UI_DIR = Path(__file__).resolve().parent / "ui"
_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: dict[str, list[float]] = {}
_VERIFY_LOCKS: dict[str, threading.Lock] = {}
_VERIFY_LOCKS_GUARD = threading.Lock()
_DIGIPAY_TOKEN_LOCK = threading.Lock()
_DIGIPAY_TOKEN: dict[str, Any] = {"key": "", "token": "", "expires_at": 0.0}
_MASKS = {"••••••••", "********", "********stored", "***", ""}

EVENT_NAMES = {
    1: "CHAT_RECEIVED_MESSAGE",
    2: "ORDER_ITEM_CHANGES",
    3: "VENDOR_ORDER_ITEM_CHANGES",
    4: "CHAT_SEND_MESSAGE",
    5: "VENDOR_NEW_ORDER",
    6: "NEW_ORDER",
    7: "VENDOR_PARCEL_CHANGES",
    8: "PRODUCT_CREATE_CHANGES",
    9: "REVIEW_CREATE_CHANGES",
}

DEFAULT_SETTINGS: dict[str, Any] = {
    "enabled": True,
    "public_url": "",
    "branding": {
        "name": "بازارچه من",
        "tagline": "انتخاب مطمئن، خرید آسان",
        "description": "محصولات منتخب فروشگاه با قیمت به‌روز و ارسال مطمئن",
        "support_phone": "",
        "accent": "#ef4056",
        "announcement": "ارسال سریع و ضمانت اصالت کالا",
    },
    "catalog": {
        "default_stock": 10,
        "page_size": 24,
        "show_profile_names": True,
        "featured_limit": 10,
    },
    "pricing": {"mode": "none", "value": 0, "round": 0},
    "shipping": {
        "flat_fee": 0,
        "free_over": 0,
        "minimum_order": 0,
        "label": "ارسال استاندارد",
        "eta": "۲ تا ۵ روز کاری",
    },
    "gateways": {
        "cod": {"enabled": True, "title": "پرداخت هنگام تحویل"},
        "zarinpal": {
            "enabled": False,
            "title": "پرداخت آنلاین زرین‌پال",
            "sandbox": False,
            "currency": "IRT",
            "merchant_id": "",
        },
        "digipay": {
            "enabled": False,
            "title": "پرداخت دیجی‌پی",
            "sandbox": True,
            "amount_multiplier": 10,
            "preferred_gateway": "",
            "client_id": "",
            "client_secret": "",
            "username": "",
            "password": "",
        },
        "torobpay": {
            "enabled": False,
            "title": "پرداخت اعتباری ترب‌پی",
            "amount_multiplier": 1,
            "request_url": "",
            "verify_url": "",
            "checkout_url_template": "",
            "auth_header": "Authorization",
            "auth_scheme": "Bearer",
            "api_token": "",
            "request_template": {
                "amount": "{amount}",
                "orderId": "{order_id}",
                "callbackUrl": "{callback_url}",
                "mobile": "{mobile}",
            },
            "verify_template": {
                "amount": "{amount}",
                "orderId": "{order_id}",
                "token": "{token}",
            },
            "response_token_path": "token",
            "response_url_path": "redirectUrl",
            "request_success_path": "",
            "request_success_values": [],
            "callback_token_field": "token",
            "callback_status_field": "status",
            "callback_success_values": ["OK", "SUCCESS", "1", "true"],
            "verify_success_path": "status",
            "verify_success_values": ["OK", "SUCCESS", "1", "true", "100"],
            "verify_reference_path": "trackingCode",
            "verify_amount_path": "amount",
            "verify_order_path": "orderId",
        },
        "custom": {
            "enabled": False,
            "title": "درگاه پرداخت دیگر",
            "amount_multiplier": 1,
            "request_url": "",
            "verify_url": "",
            "checkout_url_template": "",
            "auth_header": "Authorization",
            "auth_scheme": "Bearer",
            "api_token": "",
            "request_template": {
                "amount": "{amount}",
                "order_id": "{order_id}",
                "callback_url": "{callback_url}",
                "mobile": "{mobile}",
            },
            "verify_template": {
                "amount": "{amount}",
                "order_id": "{order_id}",
                "token": "{token}",
            },
            "response_token_path": "token",
            "response_url_path": "payment_url",
            "request_success_path": "",
            "request_success_values": [],
            "callback_token_field": "token",
            "callback_status_field": "status",
            "callback_success_values": ["OK", "SUCCESS", "1", "true"],
            "verify_success_path": "status",
            "verify_success_values": ["OK", "SUCCESS", "1", "true", "100"],
            "verify_reference_path": "reference_id",
            "verify_amount_path": "amount",
            "verify_order_path": "order_id",
        },
    },
    "basalam_webhook": {
        "enabled": True,
        "require_header": False,
        "event_ids": [1, 3, 5, 7, 8, 9],
        "token": "",
        "token_hash": "",
        "bearer_secret": "",
        "last_registration": {},
    },
}

SECRET_FIELDS = {
    "zarinpal": ("merchant_id",),
    "digipay": ("client_id", "client_secret", "username", "password"),
    "torobpay": ("api_token",),
    "custom": ("api_token",),
}
ENV_SECRETS = {
    ("zarinpal", "merchant_id"): "SCRAPER_ZARINPAL_MERCHANT_ID",
    ("digipay", "client_id"): "SCRAPER_DIGIPAY_CLIENT_ID",
    ("digipay", "client_secret"): "SCRAPER_DIGIPAY_CLIENT_SECRET",
    ("digipay", "username"): "SCRAPER_DIGIPAY_USERNAME",
    ("digipay", "password"): "SCRAPER_DIGIPAY_PASSWORD",
    ("torobpay", "api_token"): "SCRAPER_TOROBPAY_API_TOKEN",
    ("custom", "api_token"): "SCRAPER_CUSTOM_GATEWAY_TOKEN",
}


class StoreError(RuntimeError):
    """A public-safe storefront error with an HTTP status."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class PaymentError(StoreError):
    pass


class PaymentCancelled(PaymentError):
    pass


def _core() -> Any:
    if _CORE is None:  # pragma: no cover - registration guarantees this
        raise RuntimeError("storefront is not registered")
    return _CORE


def _deep_merge(base: dict[str, Any], incoming: Any) -> dict[str, Any]:
    out = copy.deepcopy(base)
    if not isinstance(incoming, dict):
        return out
    for key, value in incoming.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = copy.deepcopy(value)
    return out


def settings_from(data: dict[str, Any]) -> dict[str, Any]:
    return _deep_merge(DEFAULT_SETTINGS, data.get("store", {}))


def _prefix(path: str) -> str:
    base = str(getattr(_core(), "URL_PREFIX", "") or "").rstrip("/")
    return base + (path if path.startswith("/") else "/" + path)


def _public_base(settings: dict[str, Any]) -> str:
    configured = str(settings.get("public_url", "") or "").strip().rstrip("/")
    if configured:
        return configured
    return request.host_url.rstrip("/") + str(getattr(_core(), "URL_PREFIX", "") or "").rstrip("/")


def _safe_public_url(value: Any, *, allow_empty: bool = True) -> str:
    text = str(value or "").strip().rstrip("/")
    if not text and allow_empty:
        return ""
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise StoreError("آدرس عمومی فروشگاه معتبر نیست")
    host = parsed.hostname.lower()
    local = host in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not local:
        raise StoreError("آدرس عمومی در محیط واقعی باید HTTPS باشد")
    return text


def _asset_response(filename: str) -> Response:
    allowed = {
        "storefront.css", "storefront.js", "store-admin.css", "store-admin.js",
        "storefront-hero.jpg", "app-icon-192.png", "app-icon-512.png",
    }
    if filename not in allowed:
        return Response("Not found", 404)
    response = send_from_directory(_UI_DIR, filename, conditional=True)
    response.headers["Cache-Control"] = (
        "public, max-age=3600"
        if filename.endswith((".png", ".jpg", ".jpeg"))
        else "no-cache, must-revalidate"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


def _render_file(name: str, *, admin: bool = False) -> Response:
    path = _UI_DIR / name
    try:
        html = path.read_text(encoding="utf-8")
    except OSError:
        return Response("Storefront UI is unavailable", 503)
    if "__STOREFRONT_CRITICAL_CSS__" in html:
        try:
            critical_css = (_UI_DIR / "storefront.css").read_text(encoding="utf-8")
        except OSError:
            critical_css = "body{font-family:sans-serif;direction:rtl;margin:0}"
        # Prevent a future CSS string from terminating the raw-text style node.
        critical_css = critical_css.replace("</style", "<\\/style")
        html = html.replace("__STOREFRONT_CRITICAL_CSS__", critical_css)
    if name == "storefront.html":
        # Relative URLs resolve from the URL visible in the browser. This keeps
        # one document valid both at / and behind an Apache /put mount, even
        # when the proxy strips that prefix before forwarding to Flask.
        base = "."
    else:
        base = str(request.script_root or getattr(_core(), "URL_PREFIX", "") or "").rstrip("/")
    html = html.replace("__STORE_BASE__", escape(base, quote=True))
    html = html.replace(
        "__STORE_VERSION__",
        escape(str(getattr(_core(), "APP_VERSION", "0")), quote=True),
    )
    response = Response(html, content_type="text/html; charset=utf-8")
    response.headers["Cache-Control"] = "no-store" if admin else "no-cache"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https: http:; connect-src 'self'; font-src 'self' data:; "
        "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
    )
    return response


def render_storefront() -> Response:
    settings = settings_from(_core().load_data())
    if not settings.get("enabled", True):
        brand = escape(str(settings.get("branding", {}).get("name") or "فروشگاه"))
        css = escape(_prefix("/store-assets/storefront.css"), quote=True)
        html = ("<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><meta charset=\"utf-8\">"
                "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                f"<title>{brand}</title><link rel=\"stylesheet\" href=\"{css}\"></head>"
                "<body class=\"payment-result-page\"><main class=\"payment-result\">"
                f"<span class=\"result-icon\">◇</span><h1>{brand}</h1>"
                "<p>فروشگاه موقتاً غیرفعال است. لطفاً کمی بعد دوباره مراجعه کنید.</p>"
                "</main></body></html>")
        response = Response(html, status=503, content_type="text/html; charset=utf-8")
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self'; object-src 'none'"
        return response
    return _render_file("storefront.html")


def render_admin() -> Response:
    return _render_file("store-admin.html", admin=True)


def _vault_key_file() -> str:
    return os.environ.get("SCRAPER_STORE_KEY_FILE", str(_core().DATA_FILE) + ".store-key")


def _vault_key(create: bool = False) -> bytes | None:
    configured = os.environ.get("SCRAPER_STORE_SECRET_KEY", "")
    if configured:
        return hashlib.sha256(configured.encode("utf-8")).digest()
    path = _vault_key_file()
    try:
        raw = Path(path).read_bytes().strip()
    except FileNotFoundError:
        raw = b""
    except OSError as exc:
        raise StoreError("خواندن کلید امن فروشگاه ممکن نیست", 503) from exc
    if raw:
        try:
            decoded = base64.urlsafe_b64decode(raw + b"=" * (-len(raw) % 4))
        except (ValueError, TypeError) as exc:
            raise StoreError("فایل کلید امن فروشگاه معتبر نیست", 503) from exc
        if len(decoded) != 32:
            raise StoreError("فایل کلید امن فروشگاه معتبر نیست", 503)
        return decoded
    if Path(path).exists():
        raise StoreError("فایل کلید امن فروشگاه خالی است", 503)
    if not create:
        return None
    key = secrets.token_bytes(32)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".store-key-", dir=os.path.dirname(path) or ".")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(base64.urlsafe_b64encode(key).rstrip(b"="))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    finally:
        try:
            if os.path.exists(tmp):
                os.unlink(tmp)
        except OSError:
            pass
    return key


def _seal(value: str) -> str:
    if not value:
        return ""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    except ImportError as exc:  # pragma: no cover - required dependency
        raise StoreError("برای ذخیره امن کلیدها، بسته cryptography را نصب کنید", 503) from exc
    key = _vault_key(create=True)
    if key is None:  # pragma: no cover
        raise StoreError("کلید امن فروشگاه ساخته نشد", 503)
    nonce = secrets.token_bytes(12)
    body = AESGCM(key).encrypt(nonce, value.encode("utf-8"), b"scraper4-store-v1")
    return "enc:v1:" + base64.urlsafe_b64encode(nonce + body).decode("ascii").rstrip("=")


def _unseal(value: Any) -> str:
    text = str(value or "")
    if not text.startswith("enc:v1:"):
        return text  # backward-compatible migration of old plaintext settings
    key = _vault_key(create=False)
    if key is None:
        return ""
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        raw = base64.urlsafe_b64decode(text[7:].encode("ascii") + b"=" * (-len(text[7:]) % 4))
        return AESGCM(key).decrypt(raw[:12], raw[12:], b"scraper4-store-v1").decode("utf-8")
    except Exception:
        return ""


@contextmanager
def _mutate_data() -> Iterator[dict[str, Any]]:
    """Serialize storefront read-modify-write cycles across threads/processes."""
    core = _core()
    lock_path = str(core.DATA_FILE) + ".store.lock"
    os.makedirs(os.path.dirname(lock_path) or ".", exist_ok=True)
    with open(lock_path, "a+b") as file_lock:
        if fcntl is not None:
            fcntl.flock(file_lock.fileno(), fcntl.LOCK_EX)
        try:
            with core.DATA_LOCK:
                data = core.load_data()
                yield data
                core.save_data(data)
        finally:
            if fcntl is not None:
                fcntl.flock(file_lock.fileno(), fcntl.LOCK_UN)


def _gateway_config(settings: dict[str, Any], name: str) -> dict[str, Any]:
    gateway = copy.deepcopy(settings.get("gateways", {}).get(name, {}))
    for field in SECRET_FIELDS.get(name, ()):
        env_name = ENV_SECRETS.get((name, field), "")
        gateway[field] = os.environ.get(env_name, "") if env_name and os.environ.get(env_name) else _unseal(gateway.get(field))
    return gateway


def _order_gateway_config(order: dict[str, Any], settings: dict[str, Any], name: str) -> dict[str, Any]:
    sealed = str(order.get("payment", {}).get("verification_config_enc") or "")
    if sealed:
        try:
            value = json.loads(_unseal(sealed))
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            raise PaymentError("نسخه امن تنظیمات این پرداخت قابل بازیابی نیست", 409) from exc
        if not isinstance(value, dict):
            raise PaymentError("نسخه امن تنظیمات این پرداخت معتبر نیست", 409)
        return value
    # Legacy orders created before 10.221 have no snapshot.
    return _gateway_config(settings, name)


def _gateway_ready(name: str, gateway: dict[str, Any]) -> bool:
    if not gateway.get("enabled"):
        return False
    if name == "cod":
        return True
    if name == "zarinpal":
        return bool(gateway.get("merchant_id"))
    if name == "digipay":
        return all(gateway.get(key) for key in ("client_id", "client_secret", "username", "password"))
    return bool(gateway.get("request_url") and gateway.get("verify_url"))


def _public_gateway_list(settings: dict[str, Any]) -> list[dict[str, Any]]:
    descriptions = {
        "cod": "پرداخت مبلغ سفارش در زمان دریافت",
        "zarinpal": "انتقال امن به صفحه پرداخت زرین‌پال",
        "digipay": "پرداخت آنلاین یا اعتباری از مسیر دیجی‌پی",
        "torobpay": "خرید اعتباری با قرارداد فعال ترب‌پی",
        "custom": "پرداخت امن از درگاه پیکربندی‌شده فروشگاه",
    }
    rows = []
    for name in ("zarinpal", "digipay", "torobpay", "custom", "cod"):
        gateway = _gateway_config(settings, name)
        if _gateway_ready(name, gateway):
            rows.append({
                "id": name,
                "title": str(gateway.get("title") or name)[:80],
                "description": descriptions[name],
                "online": name != "cod",
            })
    return rows


def _digits(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, round(value)) if math.isfinite(value) else 0
    text = _core().clean_text(value)
    # JSON/CSV adapters can serialize an integer amount as "12500.0"; simply
    # deleting punctuation would incorrectly turn that into 125000.
    normalized = text.replace(",", "").strip()
    if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", normalized):
        try:
            return max(0, round(float(normalized)))
        except (ValueError, OverflowError):
            return 0
    found = re.sub(r"[^0-9]", "", text)
    try:
        return int(found or 0)
    except ValueError:
        return 0


def _adjust_price(base: int, rules: dict[str, Any], *, profile_rounding: bool = False) -> tuple[int, bool]:
    if base <= 0:
        return 0, False
    mode = str(rules.get("mode", "none") or "none").lower()
    try:
        value = float(rules.get("value", 0) or 0)
    except (TypeError, ValueError):
        value = 0
    try:
        step = max(0, int(float(rules.get("round", 0) or 0)))
    except (TypeError, ValueError):
        step = 0
    price = float(base)
    changed = False
    if mode == "percent":
        price *= 1 + max(-99.0, min(10000.0, value)) / 100
        changed = bool(value)
    elif mode == "multiplier" and value > 0:
        price *= value
        changed = value != 1
    elif mode == "fixed":
        price += value
        changed = bool(value)
    if step:
        # The existing profile extractor uses Python's round(price / step),
        # while destination/store adjustments historically use half-up.
        price = round(price / step) * step if profile_rounding else int((price + step / 2) // step) * step
        changed = True
    return max(1, round(price)), changed


def _plain(value: Any, limit: int = 500) -> str:
    text = str(value or "")
    if "<" in text and ">" in text:
        try:
            text = _core().BeautifulSoup(text, "html.parser").get_text(" ", strip=True)
        except Exception:
            text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _safe_image(value: Any) -> str:
    text = str(value or "").strip()
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return ""
    host = parsed.hostname.lower()
    try:
        address = ipaddress.ip_address(host)
        if not address.is_global:
            return ""
    except ValueError:
        if (host in {"localhost", "localhost.localdomain"} or "." not in host or
                host.endswith((".localhost", ".local", ".lan", ".internal"))):
            return ""
    return text[:2000]


def _profile_price_from_base(source: int, profile: dict[str, Any], settings: dict[str, Any]) -> tuple[int, bool]:
    rules = profile.get("profile_rules", {}) if isinstance(profile.get("profile_rules"), dict) else {}
    mode = str(rules.get("price_mode", "none") or "none")
    mode = {"multiply": "multiplier", "add": "fixed"}.get(mode, mode)
    price, adjusted = _adjust_price(source, {
        "mode": mode,
        "value": rules.get("price_value", rules.get("price_val", 0)),
        "round": rules.get("price_round", rules.get("round_price", 0)),
    }, profile_rounding=True)
    try:
        minimum = max(0, int(float(rules.get("min_price", 0) or 0)))
    except (TypeError, ValueError):
        minimum = 0
    if source > 0 and price < minimum:
        price, adjusted = minimum, True
    price, store_profile_adjusted = _adjust_price(price, {
        "mode": rules.get("store_price_mode", "none"),
        "value": rules.get("store_price_value", 0),
        "round": rules.get("store_price_round", 0),
    })
    price, global_adjusted = _adjust_price(price, settings.get("pricing", {}))
    return price, adjusted or store_profile_adjusted or global_adjusted


def _profile_price(product: dict[str, Any], profile: dict[str, Any], settings: dict[str, Any]) -> tuple[int, int, bool]:
    source = _digits(product.get("source_price") or product.get("price"))
    price, adjusted = _profile_price_from_base(source, profile, settings)
    return source, price, adjusted


def _stock_value(product: dict[str, Any], profile: dict[str, Any], settings: dict[str, Any]) -> int:
    status = str(product.get("stock_status") or product.get("availability") or "").lower()
    if status in {"outofstock", "out_of_stock", "ناموجود", "false"} or product.get("active") is False:
        return 0
    raw = product.get("stock")
    if raw not in (None, ""):
        return max(0, _digits(raw))
    rules = profile.get("profile_rules", {}) if isinstance(profile.get("profile_rules"), dict) else {}
    fallback = rules.get("default_stock", settings.get("catalog", {}).get("default_stock", 10))
    return max(0, _digits(fallback))


def _catalog(data: dict[str, Any], *, details: bool = False) -> list[dict[str, Any]]:
    settings = settings_from(data)
    profiles = data.get("profiles", {}) if isinstance(data.get("profiles"), dict) else {}
    rows: list[dict[str, Any]] = []
    for profile_id, profile in profiles.items():
        if not isinstance(profile, dict) or profile.get("storefront_enabled") is False:
            continue
        products = profile.get("saved_products", [])
        if not isinstance(products, list):
            continue
        profile_title = _plain(profile.get("display_name") or profile.get("name") or profile_id, 80)
        for index, product in enumerate(products):
            if not isinstance(product, dict) or product.get("active") is False:
                continue
            title = _plain(product.get("title") or product.get("name"), 220)
            _source, price, price_adjusted = _profile_price(product, profile, settings)
            if not title or price <= 0:
                continue
            identity = _core().product_identity_key(product)
            public_id = "prd_" + hashlib.sha256(
                (str(profile_id) + "\x00" + identity).encode("utf-8")
            ).hexdigest()[:22]
            images = product.get("images") if isinstance(product.get("images"), list) else []
            image_candidates = [product.get("image"), *images]
            safe_images: list[str] = []
            for candidate in image_candidates:
                image = _safe_image(candidate)
                if image and image not in safe_images:
                    safe_images.append(image)
            category = _plain(product.get("category") or profile.get("profile_rules", {}).get("default_category"), 100)
            stock = _stock_value(product, profile, settings)
            row: dict[str, Any] = {
                "id": public_id,
                "title": title,
                "price": price,
                "currency": "تومان",
                "image": safe_images[0] if safe_images else "",
                "category": category or "سایر محصولات",
                "profile": profile_title if settings.get("catalog", {}).get("show_profile_names", True) else "",
                "stock": stock,
                "available": stock > 0,
                "sku": _plain(product.get("sku"), 80),
                "short_description": _plain(product.get("short_desc") or product.get("description"), 320),
                "price_adjusted": price_adjusted,
                "position": index,
            }
            compare = _digits(product.get("compare_price") or product.get("old_price") or product.get("regular_price"))
            if compare > 0:
                compare, _ = _profile_price_from_base(compare, profile, settings)
                if compare > price:
                    row["compare_price"] = compare
                    row["discount_percent"] = max(1, round((compare - price) * 100 / compare))
            if details:
                row.update({
                    "images": safe_images[:12],
                    "description": _plain(product.get("long_desc") or product.get("description"), 8000),
                    "brand": _plain(product.get("brand"), 100),
                    "weight": _plain(product.get("weight"), 80),
                    "attributes": [
                        {"name": _plain(item.get("name"), 80), "value": _plain(item.get("value"), 200)}
                        for item in (product.get("attributes") if isinstance(product.get("attributes"), list) else [])[:30]
                        if isinstance(item, dict) and _plain(item.get("name"), 80)
                    ],
                })
            # Server-only identity is removed before API responses but useful to order records.
            row["_profile_id"] = str(profile_id)
            row["_source_key"] = identity
            rows.append(row)
    return rows


def _catalog_public(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if not key.startswith("_") and key != "position"}


def _normalize_search(value: Any) -> str:
    text = _core().clean_text(value).lower()
    return text.replace("ي", "ی").replace("ك", "ک")[:120]


def _reserved_quantities(data: dict[str, Any], *, exclude_order_id: str = "") -> dict[str, int]:
    now = int(time.time())
    reserved: dict[str, int] = {}
    orders = data.get("store_orders", {}) if isinstance(data.get("store_orders"), dict) else {}
    for order in orders.values():
        if not isinstance(order, dict) or (exclude_order_id and str(order.get("id")) == exclude_order_id):
            continue
        status = str(order.get("status", ""))
        if status in {"cancelled", "refunded", "payment_failed", "expired"}:
            continue
        payment = order.get("payment", {}) if isinstance(order.get("payment"), dict) else {}
        if payment.get("status") not in {"paid", "cod"} and int(order.get("reservation_expires_at", 0) or 0) < now:
            continue
        for item in order.get("items", []):
            if isinstance(item, dict):
                product_id = str(item.get("product_id", ""))
                reserved[product_id] = reserved.get(product_id, 0) + int(item.get("quantity", 0) or 0)
    return reserved


def _order_stock_issues(data: dict[str, Any], order: dict[str, Any]) -> list[str]:
    products = {item["id"]: item for item in _catalog(data)}
    reserved = _reserved_quantities(data, exclude_order_id=str(order.get("id") or ""))
    issues: list[str] = []
    for item in order.get("items", []):
        if not isinstance(item, dict):
            continue
        product = products.get(str(item.get("product_id") or ""))
        quantity = int(item.get("quantity", 0) or 0)
        if not product or int(product.get("stock", 0)) - reserved.get(str(item.get("product_id")), 0) < quantity:
            issues.append(_plain(item.get("title"), 120) or str(item.get("product_id") or "کالا"))
    return issues


def _rate_limit(scope: str, identity: str, *, limit: int, seconds: int) -> None:
    now = time.monotonic()
    key = scope + ":" + hashlib.sha256(identity.encode("utf-8", "ignore")).hexdigest()[:24]
    with _RATE_LOCK:
        bucket = [stamp for stamp in _RATE_BUCKETS.get(key, []) if now - stamp < seconds]
        if len(bucket) >= limit:
            raise StoreError("تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید", 429)
        bucket.append(now)
        _RATE_BUCKETS[key] = bucket
        if len(_RATE_BUCKETS) > 4000:
            stale = [old_key for old_key, stamps in _RATE_BUCKETS.items()
                     if not stamps or now - stamps[-1] > 3600]
            for old_key in stale:
                _RATE_BUCKETS.pop(old_key, None)
            while len(_RATE_BUCKETS) > 4000:
                oldest = min(_RATE_BUCKETS, key=lambda item: _RATE_BUCKETS[item][-1])
                _RATE_BUCKETS.pop(oldest, None)


def _check_origin() -> None:
    origin = request.headers.get("Origin", "").strip()
    if not origin:
        return
    parsed = urlparse(origin)
    allowed = {request.host.lower()}
    configured = settings_from(_core().load_data()).get("public_url", "")
    if configured:
        allowed.add(urlparse(str(configured)).netloc.lower())
    if parsed.netloc.lower() not in allowed:
        raise StoreError("مبدأ درخواست معتبر نیست", 403)


def _json_body(max_bytes: int = 65536) -> dict[str, Any]:
    if request.content_length and request.content_length > max_bytes:
        raise StoreError("حجم درخواست بیش از حد مجاز است", 413)
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise StoreError("بدنه JSON معتبر نیست")
    return value


def _normalize_mobile(value: Any) -> str:
    mobile = re.sub(r"\D", "", _core().clean_text(value))
    if mobile.startswith("0098"):
        mobile = "0" + mobile[4:]
    elif mobile.startswith("98"):
        mobile = "0" + mobile[2:]
    if not re.fullmatch(r"09\d{9}", mobile):
        raise StoreError("شماره همراه معتبر وارد کنید")
    return mobile


def _customer(value: Any) -> dict[str, str]:
    source = value if isinstance(value, dict) else {}
    name = _plain(source.get("name"), 100)
    if len(name) < 2:
        raise StoreError("نام و نام خانوادگی را کامل وارد کنید")
    mobile = _normalize_mobile(source.get("mobile"))
    province = _plain(source.get("province"), 80)
    city = _plain(source.get("city"), 80)
    address = _plain(source.get("address"), 700)
    if len(province) < 2 or len(city) < 2 or len(address) < 10:
        raise StoreError("استان، شهر و نشانی کامل الزامی است")
    postal = re.sub(r"\D", "", _core().clean_text(source.get("postal_code") or source.get("postalCode")))
    if postal and not re.fullmatch(r"\d{10}", postal):
        raise StoreError("کد پستی باید ۱۰ رقم باشد")
    email = str(source.get("email") or "").strip().lower()[:160]
    if email and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise StoreError("ایمیل معتبر نیست")
    return {
        "name": name, "mobile": mobile, "province": province, "city": city,
        "address": address, "postal_code": postal, "email": email,
    }


def _new_order_id(existing: dict[str, Any]) -> str:
    for _ in range(20):
        candidate = "SF-" + time.strftime("%Y%m%d") + "-" + secrets.token_hex(3).upper()
        if candidate not in existing:
            return candidate
    raise StoreError("ساخت شناسه سفارش ناموفق بود", 503)


def _history(order: dict[str, Any], status: str, title: str, note: str = "") -> None:
    rows = order.setdefault("history", [])
    rows.append({"status": status, "title": title[:120], "note": note[:300], "at": int(time.time())})
    del rows[:-100]


def _token_matches(order: dict[str, Any], supplied: str) -> bool:
    expected = str(order.get("access_token_hash", ""))
    actual = hashlib.sha256(supplied.encode("utf-8")).hexdigest() if supplied else ""
    return bool(expected and actual and hmac.compare_digest(expected, actual))


def _request_order_token() -> str:
    authorization = request.headers.get("Authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return request.headers.get("X-Order-Token", "").strip() or request.args.get("token", "").strip()


def _public_order(order: dict[str, Any], access_token: str = "") -> dict[str, Any]:
    payment = order.get("payment", {}) if isinstance(order.get("payment"), dict) else {}
    out = {
        "id": order.get("id"),
        "created_at": order.get("created_at"),
        "updated_at": order.get("updated_at"),
        "status": order.get("status"),
        "status_title": _status_title(str(order.get("status", ""))),
        "payment_status": payment.get("status"),
        "payment_method": payment.get("gateway"),
        "items": [
            {key: item.get(key) for key in ("product_id", "title", "image", "quantity", "unit_price", "line_total")}
            for item in order.get("items", []) if isinstance(item, dict)
        ],
        "subtotal": order.get("subtotal", 0),
        "shipping": order.get("shipping", 0),
        "total": order.get("total", 0),
        "currency": order.get("currency", "تومان"),
        "shipping_label": order.get("shipping_label", ""),
        "shipping_eta": order.get("shipping_eta", ""),
        "tracking_code": order.get("tracking_code", ""),
        "history": order.get("history", []),
        "redirect_url": payment.get("redirect_url", ""),
        "reference_id": payment.get("reference_id", ""),
    }
    if access_token:
        out["access_token"] = access_token
    return out


def _status_title(status: str) -> str:
    return {
        "awaiting_payment": "در انتظار پرداخت",
        "payment_failed": "پرداخت ناموفق",
        "confirmed": "ثبت و تأیید شده",
        "processing": "در حال آماده‌سازی",
        "shipped": "ارسال شده",
        "delivered": "تحویل شده",
        "cancelled": "لغو شده",
        "refunded": "بازپرداخت شده",
        "needs_review": "نیازمند بررسی",
        "expired": "منقضی شده",
    }.get(status, "در حال بررسی")


def _safe_admin_order(order: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(order)
    out.pop("access_token_hash", None)
    out.pop("access_token_enc", None)
    payment = out.get("payment")
    if isinstance(payment, dict):
        payment.pop("callback_state_hash", None)
        payment.pop("verification_nonce", None)
        payment.pop("verification_config_enc", None)
    return out


def _response_json(response: Any, provider: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except Exception as exc:
        raise PaymentError(f"پاسخ {provider} JSON معتبر نیست", 502) from exc
    if not getattr(response, "ok", False) or not isinstance(payload, dict):
        message = ""
        if isinstance(payload, dict):
            message = _plain(payload.get("message") or payload.get("error") or payload.get("errors"), 300)
            message = _core()._redact(message)
        raise PaymentError(f"خطای {provider}" + (": " + message if message else ""), 502)
    return payload


def _provider_amount(order: dict[str, Any], gateway: dict[str, Any], name: str) -> int:
    if name == "zarinpal":
        return int(order["total"]) * (10 if str(gateway.get("currency", "IRT")).upper() == "IRR" else 1)
    try:
        multiplier = max(0.0001, float(gateway.get("amount_multiplier", 1) or 1))
    except (TypeError, ValueError):
        multiplier = 1
    return round(int(order["total"]) * multiplier)


def _verification_amount(order: dict[str, Any], gateway: dict[str, Any], name: str) -> int:
    """Use the immutable amount persisted when the gateway session was made."""
    try:
        stored = int(order.get("payment", {}).get("provider_amount", 0) or 0)
    except (TypeError, ValueError):
        stored = 0
    return stored if stored > 0 else _provider_amount(order, gateway, name)


def _callback_url(order: dict[str, Any], gateway_name: str, state: str, settings: dict[str, Any]) -> str:
    base = _public_base(settings)
    query = urlencode({"order_id": order["id"], "state": state})
    return f"{base}/api/store/payments/{quote(gateway_name)}/callback?{query}"


def _zarinpal_request(order: dict[str, Any], gateway: dict[str, Any], callback_url: str) -> dict[str, str]:
    sandbox = bool(gateway.get("sandbox"))
    host = "https://sandbox.zarinpal.com" if sandbox else "https://payment.zarinpal.com"
    amount = _provider_amount(order, gateway, "zarinpal")
    payload = {
        "merchant_id": gateway["merchant_id"],
        "amount": amount,
        "currency": str(gateway.get("currency", "IRT")).upper(),
        "callback_url": callback_url,
        "description": f"پرداخت سفارش {order['id']}",
        "metadata": {"mobile": order["customer"]["mobile"], "email": order["customer"].get("email", "")},
    }
    response = _core().outbound_request(
        "POST", host + "/pg/v4/payment/request.json", json=payload,
        headers={"Accept": "application/json", "Content-Type": "application/json"}, timeout=45,
    )
    body = _response_json(response, "زرین‌پال")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    if int(data.get("code", 0) or 0) != 100 or not data.get("authority"):
        raise PaymentError("زرین‌پال درخواست پرداخت را نپذیرفت", 502)
    authority = str(data["authority"])
    return {
        "redirect_url": host + "/pg/StartPay/" + quote(authority, safe=""),
        "provider_token": authority,
        "provider_amount": str(amount),
    }


def _digipay_base(gateway: dict[str, Any]) -> str:
    return "https://uat.mydigipay.info/digipay/api" if gateway.get("sandbox") else "https://api.mydigipay.com/digipay/api"


def _digipay_access_token(gateway: dict[str, Any]) -> str:
    cache_key = hashlib.sha256("\x00".join(str(gateway.get(k, "")) for k in (
        "sandbox", "client_id", "client_secret", "username", "password"
    )).encode("utf-8")).hexdigest()
    now = time.time()
    with _DIGIPAY_TOKEN_LOCK:
        if _DIGIPAY_TOKEN.get("key") == cache_key and float(_DIGIPAY_TOKEN.get("expires_at", 0)) > now + 30:
            return str(_DIGIPAY_TOKEN["token"])
        basic = base64.b64encode(
            f"{gateway['client_id']}:{gateway['client_secret']}".encode("utf-8")
        ).decode("ascii")
        response = _core().outbound_request(
            "POST", _digipay_base(gateway) + "/oauth/token",
            files={"username": (None, gateway["username"]), "password": (None, gateway["password"]),
                   "grant_type": (None, "password")},
            headers={"Authorization": "Basic " + basic, "Accept": "application/json"}, timeout=45,
        )
        payload = _response_json(response, "دیجی‌پی")
        token = str(payload.get("access_token") or "")
        if not token:
            raise PaymentError("توکن دیجی‌پی دریافت نشد", 502)
        try:
            ttl = max(60, int(payload.get("expires_in", 3599)))
        except (TypeError, ValueError):
            ttl = 3599
        _DIGIPAY_TOKEN.update(key=cache_key, token=token, expires_at=now + ttl)
        return token


def _digipay_request(order: dict[str, Any], gateway: dict[str, Any], callback_url: str) -> dict[str, str]:
    token = _digipay_access_token(gateway)
    amount = _provider_amount(order, gateway, "digipay")
    payload: dict[str, Any] = {
        "cellNumber": order["customer"]["mobile"],
        "amount": amount,
        "providerId": order["id"],
        "callbackUrl": callback_url,
        "basketDetailsDto": {
            "basketId": order["id"],
            "items": [
                {
                    "sellerId": str(item.get("profile_id", "store"))[:80],
                    "supplierId": str(item.get("profile_id", "store"))[:80],
                    "productCode": str(item["product_id"])[:100],
                    "brand": str(item.get("brand") or "Generic")[:100],
                    "productType": 1,
                    "count": int(item["quantity"]),
                    "categoryId": str(item.get("category") or "Other")[:100],
                }
                for item in order["items"]
            ],
        },
    }
    preferred = str(gateway.get("preferred_gateway", "")).strip()
    if preferred in {"0", "2"}:
        payload["additionalInfo"] = {"preferredGateway": int(preferred)}
    response = _core().outbound_request(
        "POST", _digipay_base(gateway) + "/tickets/business?type=11", json=payload,
        headers={
            "Authorization": "Bearer " + token, "Agent": "WEB",
            "Digipay-Version": "2022-02-02", "Content-Type": "application/json",
        }, timeout=45,
    )
    body = _response_json(response, "دیجی‌پی")
    result = body.get("result") if isinstance(body.get("result"), dict) else {}
    try:
        result_status = int(result.get("status", -1))
    except (TypeError, ValueError):
        result_status = -1
    if result_status != 0 or not body.get("redirectUrl") or not body.get("ticket"):
        raise PaymentError("دیجی‌پی درخواست پرداخت را نپذیرفت", 502)
    redirect_url = str(body["redirectUrl"])
    _core().public_http_url(redirect_url)
    return {
        "redirect_url": redirect_url,
        "provider_token": str(body["ticket"]),
        "provider_amount": str(amount),
    }


def _path_get(value: Any, path: Any) -> Any:
    current = value
    for part in str(path or "").split("."):
        if not part:
            continue
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit() and int(part) < len(current):
            current = current[int(part)]
        else:
            return None
    return current


def _success_value(actual: Any, expected: Any, *, empty_is_success: bool = False) -> bool:
    values = expected if isinstance(expected, list) else [expected]
    if not values or values == [None] or values == [""]:
        return empty_is_success
    normalized = str(actual).strip().lower()
    return any(normalized == str(item).strip().lower() for item in values)


def _template(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, dict):
        return {str(key): _template(item, context) for key, item in value.items()}
    if isinstance(value, list):
        return [_template(item, context) for item in value]
    if isinstance(value, str):
        for key, item in context.items():
            if value == "{" + key + "}":
                return item
        result = value
        for key, item in context.items():
            result = result.replace("{" + key + "}", str(item))
        return result
    return value


def _generic_headers(gateway: dict[str, Any]) -> dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    token = str(gateway.get("api_token") or "")
    if token:
        name = str(gateway.get("auth_header") or "Authorization")[:100]
        scheme = str(gateway.get("auth_scheme") or "Bearer").strip()
        headers[name] = (scheme + " " if scheme else "") + token
    return headers


def _generic_request(order: dict[str, Any], gateway: dict[str, Any], callback_url: str, name: str) -> dict[str, str]:
    amount = _provider_amount(order, gateway, name)
    context = {
        "amount": amount, "order_id": str(order["id"]), "callback_url": callback_url,
        "mobile": order["customer"]["mobile"], "email": order["customer"].get("email", ""),
        "description": f"سفارش {order['id']}",
    }
    request_url = _core().public_http_url(str(gateway.get("request_url", "")))
    payload = _template(gateway.get("request_template", {}), context)
    response = _core().outbound_request(
        "POST", request_url, json=payload, headers=_generic_headers(gateway), timeout=45,
    )
    body = _response_json(response, str(gateway.get("title") or name))
    success_path = str(gateway.get("request_success_path") or "")
    if success_path and not _success_value(
        _path_get(body, success_path), gateway.get("request_success_values", []), empty_is_success=False
    ):
        raise PaymentError("درگاه درخواست پرداخت را نپذیرفت", 502)
    token = str(_path_get(body, gateway.get("response_token_path", "token")) or "")
    redirect_url = str(_path_get(body, gateway.get("response_url_path", "redirectUrl")) or "")
    if not redirect_url and gateway.get("checkout_url_template") and token:
        redirect_url = str(gateway["checkout_url_template"]).replace("{token}", quote(token, safe=""))
    if not redirect_url:
        raise PaymentError("نشانی انتقال به درگاه در پاسخ موجود نیست", 502)
    _core().public_http_url(redirect_url)
    return {"redirect_url": redirect_url, "provider_token": token, "provider_amount": str(amount)}


def _request_payment(order: dict[str, Any], settings: dict[str, Any], state: str) -> dict[str, str]:
    name = str(order.get("payment", {}).get("gateway") or "")
    gateway = _order_gateway_config(order, settings, name)
    if not _gateway_ready(name, gateway) or name == "cod":
        raise PaymentError("درگاه انتخاب‌شده آماده نیست")
    callback_url = _callback_url(order, name, state, settings)
    if name == "zarinpal":
        return _zarinpal_request(order, gateway, callback_url)
    if name == "digipay":
        return _digipay_request(order, gateway, callback_url)
    return _generic_request(order, gateway, callback_url, name)


def _init_payment(order_id: str) -> dict[str, Any]:
    state = secrets.token_urlsafe(32)
    now = int(time.time())
    with _mutate_data() as data:
        orders = data.setdefault("store_orders", {})
        order = orders.get(order_id)
        if not isinstance(order, dict):
            raise StoreError("سفارش پیدا نشد", 404)
        payment = order.setdefault("payment", {})
        if payment.get("status") == "paid":
            return copy.deepcopy(order)
        if payment.get("status") == "redirect_ready" and payment.get("redirect_url"):
            return copy.deepcopy(order)
        settings = settings_from(data)
        gateway_name = str(payment.get("gateway") or "")
        gateway_snapshot = _gateway_config(settings, gateway_name)
        if not _gateway_ready(gateway_name, gateway_snapshot) or gateway_name == "cod":
            raise PaymentError("درگاه انتخاب‌شده آماده نیست")
        payment.update({
            "status": "initiating", "callback_state_hash": hashlib.sha256(state.encode()).hexdigest(),
            "initiated_at": now,
            "verification_config_enc": _seal(json.dumps(gateway_snapshot, ensure_ascii=False, separators=(",", ":"))),
        })
        payment.setdefault("attempts", []).append({"kind": "request", "status": "started", "at": now})
        del payment["attempts"][:-30]
        order["updated_at"] = now
        snapshot = copy.deepcopy(order)
    try:
        result = _request_payment(snapshot, settings, state)
    except Exception as exc:
        message = str(exc)[:400]
        with _mutate_data() as data:
            current = data.setdefault("store_orders", {}).get(order_id)
            if isinstance(current, dict) and current.get("payment", {}).get("status") != "paid":
                current["payment"].update(status="initiation_failed", error=message, redirect_url="")
                current["payment"].setdefault("attempts", []).append({
                    "kind": "request", "status": "failed", "error": message, "at": int(time.time()),
                })
                current["status"] = "payment_failed"
                current["updated_at"] = int(time.time())
                _history(current, "payment_failed", "ایجاد پرداخت ناموفق بود", message)
        if isinstance(exc, StoreError):
            raise
        raise PaymentError("ارتباط با درگاه پرداخت ناموفق بود", 502) from exc
    with _mutate_data() as data:
        current = data.setdefault("store_orders", {}).get(order_id)
        if not isinstance(current, dict):
            raise StoreError("سفارش پیدا نشد", 404)
        if current.get("payment", {}).get("status") != "paid":
            current["payment"].update({
                "status": "redirect_ready", "redirect_url": result["redirect_url"],
                "provider_token": result.get("provider_token", ""),
                "provider_amount": int(result.get("provider_amount", 0) or 0), "error": "",
            })
            current["payment"].setdefault("attempts", []).append({
                "kind": "request", "status": "ready", "at": int(time.time()),
            })
            current["status"] = "awaiting_payment"
            current["updated_at"] = int(time.time())
            _history(current, "awaiting_payment", "انتقال به درگاه آماده است")
        return copy.deepcopy(current)


def _callback_values() -> dict[str, Any]:
    values: dict[str, Any] = {key: value for key, value in request.args.items()}
    if request.form:
        values.update({key: value for key, value in request.form.items()})
    body = request.get_json(silent=True)
    if isinstance(body, dict):
        values.update(body)
    return values


def _zarinpal_verify(order: dict[str, Any], gateway: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    if str(values.get("Status") or values.get("status") or "").upper() != "OK":
        raise PaymentCancelled("پرداخت لغو شد یا ناموفق بود", 400)
    authority = str(values.get("Authority") or values.get("authority") or "")
    expected = str(order.get("payment", {}).get("provider_token") or "")
    if not authority or not expected or not hmac.compare_digest(authority, expected):
        raise PaymentError("شناسه پرداخت زرین‌پال با سفارش تطابق ندارد", 400)
    sandbox = bool(gateway.get("sandbox"))
    host = "https://sandbox.zarinpal.com" if sandbox else "https://payment.zarinpal.com"
    amount = _verification_amount(order, gateway, "zarinpal")
    response = _core().outbound_request(
        "POST", host + "/pg/v4/payment/verify.json",
        json={"merchant_id": gateway["merchant_id"], "amount": amount, "authority": authority},
        headers={"Accept": "application/json", "Content-Type": "application/json"}, timeout=45,
    )
    payload = _response_json(response, "زرین‌پال")
    result = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    code = int(result.get("code", 0) or 0)
    if code not in {100, 101}:
        raise PaymentError("تأیید پرداخت زرین‌پال ناموفق بود", 400)
    return {"reference_id": str(result.get("ref_id") or authority), "provider_amount": amount, "code": code}


def _digipay_verify(order: dict[str, Any], gateway: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    callback_result = str(values.get("result") or "").upper()
    if callback_result != "SUCCESS":
        raise PaymentCancelled("پرداخت دیجی‌پی ناموفق یا لغو شد", 400)
    provider_id = str(values.get("providerId") or "")
    if not provider_id or not hmac.compare_digest(provider_id, str(order["id"])):
        raise PaymentError("شناسه سفارش دیجی‌پی تطابق ندارد", 400)
    expected_amount = _verification_amount(order, gateway, "digipay")
    try:
        callback_amount = int(values.get("amount", -1))
    except (TypeError, ValueError):
        callback_amount = -1
    if callback_amount != expected_amount:
        raise PaymentError("مبلغ بازگشتی دیجی‌پی با سفارش تطابق ندارد", 400)
    tracking = str(values.get("trackingCode") or "")
    if not tracking:
        raise PaymentError("کد پیگیری دیجی‌پی موجود نیست", 400)
    try:
        ticket_type = int(values.get("type", 0))
    except (TypeError, ValueError):
        ticket_type = -1
    if ticket_type not in {0, 5, 11, 13, 24}:
        raise PaymentError("نوع پرداخت دیجی‌پی معتبر نیست", 400)
    token = _digipay_access_token(gateway)
    response = _core().outbound_request(
        "POST", _digipay_base(gateway) + f"/purchases/verify?type={ticket_type}",
        json={"trackingCode": tracking, "providerId": order["id"]},
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"}, timeout=45,
    )
    payload = _response_json(response, "دیجی‌پی")
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    try:
        result_status = int(result.get("status", -1))
    except (TypeError, ValueError):
        result_status = -1
    if result_status != 0:
        raise PaymentError("تأیید پرداخت دیجی‌پی ناموفق بود", 400)
    if str(payload.get("providerId") or "") != str(order["id"]):
        raise PaymentError("پاسخ تأیید دیجی‌پی متعلق به این سفارش نیست", 400)
    try:
        verified_amount = int(payload.get("amount", -1))
    except (TypeError, ValueError):
        verified_amount = -1
    if verified_amount != expected_amount:
        raise PaymentError("مبلغ تأییدشده دیجی‌پی تطابق ندارد", 400)
    return {"reference_id": str(payload.get("trackingCode") or tracking), "provider_amount": expected_amount}


def _generic_verify(order: dict[str, Any], gateway: dict[str, Any], values: dict[str, Any], name: str) -> dict[str, Any]:
    status_field = str(gateway.get("callback_status_field") or "status")
    if status_field and not _success_value(values.get(status_field), gateway.get("callback_success_values", [])):
        raise PaymentCancelled("پرداخت در درگاه لغو یا ناموفق شد", 400)
    token_field = str(gateway.get("callback_token_field") or "token")
    token = str(values.get(token_field) or order.get("payment", {}).get("provider_token") or "")
    if not token:
        raise PaymentError("شناسه تراکنش در callback موجود نیست", 400)
    expected_token = str(order.get("payment", {}).get("provider_token") or "")
    if expected_token and values.get(token_field) and not hmac.compare_digest(token, expected_token):
        raise PaymentError("شناسه تراکنش با سفارش تطابق ندارد", 400)
    amount = _verification_amount(order, gateway, name)
    context = {
        "amount": amount, "order_id": str(order["id"]), "token": token,
        "mobile": order["customer"]["mobile"],
    }
    response = _core().outbound_request(
        "POST", _core().public_http_url(str(gateway.get("verify_url", ""))),
        json=_template(gateway.get("verify_template", {}), context),
        headers=_generic_headers(gateway), timeout=45,
    )
    payload = _response_json(response, str(gateway.get("title") or name))
    if not _success_value(
        _path_get(payload, gateway.get("verify_success_path", "status")),
        gateway.get("verify_success_values", []),
    ):
        raise PaymentError("تأیید پرداخت درگاه ناموفق بود", 400)
    response_amount = _path_get(payload, gateway.get("verify_amount_path", "amount"))
    if response_amount not in (None, ""):
        try:
            if int(response_amount) != amount:
                raise PaymentError("مبلغ تأییدشده درگاه تطابق ندارد", 400)
        except (TypeError, ValueError) as exc:
            raise PaymentError("مبلغ پاسخ درگاه معتبر نیست", 400) from exc
    response_order = _path_get(payload, gateway.get("verify_order_path", "orderId"))
    if response_order not in (None, "") and str(response_order) != str(order["id"]):
        raise PaymentError("شناسه سفارش در پاسخ درگاه تطابق ندارد", 400)
    reference = _path_get(payload, gateway.get("verify_reference_path", "trackingCode")) or token
    return {"reference_id": str(reference), "provider_amount": amount}


def _verify_payment(order: dict[str, Any], settings: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    name = str(order.get("payment", {}).get("gateway") or "")
    gateway = _order_gateway_config(order, settings, name)
    if name == "zarinpal":
        return _zarinpal_verify(order, gateway, values)
    if name == "digipay":
        return _digipay_verify(order, gateway, values)
    if name in {"torobpay", "custom"}:
        return _generic_verify(order, gateway, values, name)
    raise PaymentError("درگاه سفارش معتبر نیست", 400)


def _payment_page(order_id: str, ok: bool, message: str, status: int = 200) -> Response:
    title = "پرداخت موفق" if ok else "پرداخت تکمیل نشد"
    icon = "✓" if ok else "!"
    css = _prefix("/store-assets/storefront.css")
    home = _prefix("/") + "#track"
    html = f"""<!doctype html><html lang=\"fa\" dir=\"rtl\"><head><meta charset=\"utf-8\">
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{escape(title)}</title>
<link rel=\"stylesheet\" href=\"{escape(css)}\"></head><body class=\"payment-result-page\">
<main class=\"payment-result {'success' if ok else 'failed'}\"><span class=\"result-icon\">{icon}</span>
<h1>{escape(title)}</h1><p>{escape(message)}</p><div class=\"result-order\">شماره سفارش: <b dir=\"ltr\">{escape(order_id)}</b></div>
<a class=\"primary-button\" href=\"{escape(home)}\">پیگیری سفارش</a></main></body></html>"""
    response = Response(html, status=status, content_type="text/html; charset=utf-8")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = ("default-src 'self'; style-src 'self'; img-src 'self' data:; "
                                                   "object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
    return response


def _verify_lock(order_id: str) -> threading.Lock:
    with _VERIFY_LOCKS_GUARD:
        if order_id not in _VERIFY_LOCKS:
            _VERIFY_LOCKS[order_id] = threading.Lock()
        return _VERIFY_LOCKS[order_id]


def _event_id(payload: Any, raw: bytes) -> str:
    candidates: list[Any] = [
        request.headers.get("X-Webhook-Id"), request.headers.get("X-Event-Id"),
        request.headers.get("Webhook-Id"),
    ]
    if isinstance(payload, dict):
        # event_id/eventId is commonly the event *type* (for example 1 for
        # CHAT_RECEIVED_MESSAGE), so it must never be used as a delivery id.
        candidates.extend([
            payload.get("event_uuid"), payload.get("uuid"),
            payload.get("delivery_id"), payload.get("deliveryId"),
        ])
        event = payload.get("event")
        if isinstance(event, dict):
            candidates.extend([event.get("uuid"), event.get("delivery_id"), event.get("id")])
    explicit = next((str(item) for item in candidates if item not in (None, "")), "")
    digest = hashlib.sha256(raw).hexdigest()
    return hashlib.sha256(("id:" + explicit).encode()).hexdigest()[:32] if explicit else digest[:32]


def _event_type(payload: Any) -> tuple[int, str]:
    if not isinstance(payload, dict):
        return 0, "UNKNOWN"
    raw = payload.get("event_id") or payload.get("eventId") or payload.get("event_type_id")
    if isinstance(raw, dict):
        raw = raw.get("id")
    try:
        event_number = int(raw)
    except (TypeError, ValueError):
        event_number = 0
    name = str(payload.get("event_name") or payload.get("type") or EVENT_NAMES.get(event_number, "UNKNOWN"))[:100]
    return event_number, name


def _event_summary(payload: Any, event_name: str) -> dict[str, str]:
    if not isinstance(payload, dict):
        return {"title": event_name, "message": ""}
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    message = data.get("message") if isinstance(data, dict) else None
    if isinstance(message, dict):
        message = message.get("text") or message.get("content")
    if isinstance(message, dict):
        message = message.get("text")
    chat_id = data.get("chat_id") or data.get("chatId") if isinstance(data, dict) else ""
    order_id = data.get("order_id") or data.get("orderId") if isinstance(data, dict) else ""
    return {
        "title": event_name.replace("_", " "),
        "message": _plain(message, 300),
        "chat_id": _plain(chat_id, 80),
        "order_id": _plain(order_id, 80),
    }


def _webhook_credentials(settings: dict[str, Any]) -> tuple[str, str, bool]:
    cfg = settings.get("basalam_webhook", {})
    token = _unseal(cfg.get("token"))
    bearer = os.environ.get("SCRAPER_BASALAM_WEBHOOK_SECRET", "") or _unseal(cfg.get("bearer_secret"))
    require_header = bool(cfg.get("require_header")) or bool(os.environ.get("SCRAPER_BASALAM_WEBHOOK_SECRET"))
    return token, bearer, require_header


def _ensure_webhook_secret(data: dict[str, Any], *, rotate: bool = False) -> tuple[str, str]:
    store = data.setdefault("store", {})
    webhook = store.setdefault("basalam_webhook", {})
    current = _unseal(webhook.get("token"))
    bearer = _unseal(webhook.get("bearer_secret"))
    if rotate or not current:
        current = secrets.token_urlsafe(32)
    if rotate or not bearer:
        bearer = secrets.token_urlsafe(32)
    if rotate or not str(webhook.get("token") or "").startswith("enc:v1:"):
        webhook["token"] = _seal(current)
    if rotate or not str(webhook.get("bearer_secret") or "").startswith("enc:v1:"):
        webhook["bearer_secret"] = _seal(bearer)
    webhook["token_hash"] = hashlib.sha256(current.encode()).hexdigest()
    return current, bearer


def _admin_settings(data: dict[str, Any]) -> dict[str, Any]:
    settings = settings_from(data)
    gateways: dict[str, Any] = {}
    for name, raw in settings.get("gateways", {}).items():
        gateway = copy.deepcopy(raw)
        for field in SECRET_FIELDS.get(name, ()):
            value = _gateway_config(settings, name).get(field, "")
            gateway.pop(field, None)
            gateway[field + "_configured"] = bool(value)
        gateway["ready"] = _gateway_ready(name, _gateway_config(settings, name))
        gateways[name] = gateway
    settings["gateways"] = gateways
    webhook = settings.get("basalam_webhook", {})
    token, bearer, _ = _webhook_credentials(settings)
    webhook.pop("token", None)
    webhook.pop("bearer_secret", None)
    webhook["token_configured"] = bool(token)
    webhook["bearer_configured"] = bool(bearer)
    return settings


def _update_settings(data: dict[str, Any], body: dict[str, Any]) -> None:
    store = data.setdefault("store", {})
    if "enabled" in body:
        store["enabled"] = bool(body["enabled"])
    if "public_url" in body:
        store["public_url"] = _safe_public_url(body.get("public_url"))
    if isinstance(body.get("branding"), dict):
        target = store.setdefault("branding", {})
        limits = {"name": 80, "tagline": 160, "description": 500, "support_phone": 40, "announcement": 180}
        for key, limit in limits.items():
            if key in body["branding"]:
                target[key] = _plain(body["branding"][key], limit)
        if "accent" in body["branding"]:
            accent = str(body["branding"]["accent"] or "")
            if not re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
                raise StoreError("رنگ اصلی باید در قالب #RRGGBB باشد")
            target["accent"] = accent.lower()
    for section, numeric in {
        "catalog": {"default_stock": (0, 100000), "page_size": (8, 60), "featured_limit": (4, 30)},
        "pricing": {"value": (-99, 1000000000), "round": (0, 1000000000)},
        "shipping": {"flat_fee": (0, 1000000000), "free_over": (0, 100000000000), "minimum_order": (0, 100000000000)},
    }.items():
        incoming = body.get(section)
        if not isinstance(incoming, dict):
            continue
        target = store.setdefault(section, {})
        for key, bounds in numeric.items():
            if key in incoming:
                try:
                    number = float(incoming[key])
                except (TypeError, ValueError) as exc:
                    raise StoreError(f"مقدار {key} عددی نیست") from exc
                target[key] = max(bounds[0], min(bounds[1], int(number) if number.is_integer() else number))
        if section == "catalog" and "show_profile_names" in incoming:
            target["show_profile_names"] = bool(incoming["show_profile_names"])
        if section == "pricing" and "mode" in incoming:
            mode = str(incoming["mode"])
            if mode not in {"none", "percent", "multiplier", "fixed"}:
                raise StoreError("روش قیمت‌گذاری معتبر نیست")
            target["mode"] = mode
        if section == "shipping":
            for key, limit in {"label": 100, "eta": 100}.items():
                if key in incoming:
                    target[key] = _plain(incoming[key], limit)
    gateways = body.get("gateways")
    if isinstance(gateways, dict):
        target_gateways = store.setdefault("gateways", {})
        shared_fields = {
            "enabled", "title", "sandbox", "currency", "amount_multiplier", "preferred_gateway",
            "request_url", "verify_url", "checkout_url_template", "auth_header", "auth_scheme",
            "response_token_path", "response_url_path", "request_success_path", "request_success_values",
            "callback_token_field", "callback_status_field", "callback_success_values", "verify_success_path",
            "verify_success_values", "verify_reference_path", "verify_amount_path", "verify_order_path",
            "request_template", "verify_template",
        }
        for name in ("cod", "zarinpal", "digipay", "torobpay", "custom"):
            incoming = gateways.get(name)
            if not isinstance(incoming, dict):
                continue
            target = target_gateways.setdefault(name, {})
            for key in shared_fields:
                if key not in incoming:
                    continue
                value = incoming[key]
                if key in {"enabled", "sandbox"}:
                    target[key] = bool(value)
                elif key in {"request_template", "verify_template"}:
                    if not isinstance(value, (dict, list)) or len(json.dumps(value, ensure_ascii=False)) > 12000:
                        raise StoreError("قالب درخواست درگاه معتبر نیست")
                    target[key] = value
                elif key.endswith("_values"):
                    if not isinstance(value, list) or len(value) > 30:
                        raise StoreError("فهرست پاسخ‌های موفق معتبر نیست")
                    target[key] = [str(item)[:100] for item in value]
                elif key == "amount_multiplier":
                    try:
                        target[key] = max(0.0001, min(1000, float(value)))
                    except (TypeError, ValueError) as exc:
                        raise StoreError("ضریب مبلغ درگاه معتبر نیست") from exc
                elif key in {"request_url", "verify_url"}:
                    target[key] = _safe_public_url(value) if value else ""
                elif key == "currency":
                    currency = str(value or "").upper()
                    if currency not in {"IRT", "IRR"}:
                        raise StoreError("واحد مبلغ زرین‌پال معتبر نیست")
                    target[key] = currency
                elif key == "preferred_gateway":
                    preferred = str(value or "")
                    if preferred not in {"", "0", "2"}:
                        raise StoreError("درگاه ترجیحی دیجی‌پی معتبر نیست")
                    target[key] = preferred
                elif key == "auth_header":
                    header = str(value or "Authorization")
                    if not re.fullmatch(r"[A-Za-z0-9-]{1,80}", header):
                        raise StoreError("نام هدر احراز هویت معتبر نیست")
                    target[key] = header
                else:
                    target[key] = _plain(value, 2000 if "template" in key or "url" in key else 120)
            for field in SECRET_FIELDS.get(name, ()):
                if incoming.get("clear_" + field):
                    target[field] = ""
                elif field in incoming and str(incoming[field] or "") not in _MASKS:
                    target[field] = _seal(str(incoming[field]).strip())
    webhook = body.get("basalam_webhook")
    if isinstance(webhook, dict):
        target = store.setdefault("basalam_webhook", {})
        for key in ("enabled", "require_header"):
            if key in webhook:
                target[key] = bool(webhook[key])
        if "event_ids" in webhook:
            ids = webhook["event_ids"] if isinstance(webhook["event_ids"], list) else []
            target["event_ids"] = sorted({int(item) for item in ids if str(item).isdigit() and 1 <= int(item) <= 9})


def _public_config(data: dict[str, Any]) -> dict[str, Any]:
    settings = settings_from(data)
    branding = settings.get("branding", {})
    shipping = settings.get("shipping", {})
    profiles = data.get("profiles", {}) if isinstance(data.get("profiles"), dict) else {}
    return {
        "enabled": bool(settings.get("enabled", True)),
        "name": branding.get("name"), "tagline": branding.get("tagline"),
        "description": branding.get("description"), "support_phone": branding.get("support_phone"),
        "accent": branding.get("accent"), "announcement": branding.get("announcement"),
        "shipping": {"label": shipping.get("label"), "eta": shipping.get("eta"),
                     "free_over": shipping.get("free_over", 0), "flat_fee": shipping.get("flat_fee", 0)},
        "payment_methods": _public_gateway_list(settings), "profile_count": len(profiles),
        "version": str(getattr(_core(), "APP_VERSION", "")), "currency": "تومان",
    }


def register(core: Any) -> None:
    """Register storefront routes exactly once on the existing Flask app."""
    global _CORE, _REGISTERED
    _CORE = core
    if _REGISTERED:
        return
    _REGISTERED = True
    app = core.app

    @app.after_request
    def storefront_private_cache_policy(response: Response) -> Response:
        if request.path.startswith("/api/store/admin/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response

    @app.get("/classic")
    def storefront_classic() -> Response:
        return Response(core.render_index(), mimetype="text/html; charset=utf-8")

    @app.get("/admin")
    def storefront_admin_redirect() -> Response:
        return redirect(_prefix("/ui"), code=302)

    @app.get("/store-admin")
    def storefront_admin() -> Response:
        return render_admin()

    @app.get("/store-assets/<path:filename>")
    def storefront_assets(filename: str) -> Response:
        return _asset_response(filename)

    @app.get("/store.webmanifest")
    def storefront_manifest() -> Response:
        data = core.load_data()
        name = str(settings_from(data).get("branding", {}).get("name") or "فروشگاه")
        payload = {
            "name": name, "short_name": name[:24], "lang": "fa", "dir": "rtl",
            "start_url": _prefix("/"), "scope": _prefix("/"), "display": "standalone",
            "theme_color": settings_from(data).get("branding", {}).get("accent", "#ef4056"),
            "background_color": "#ffffff",
            "icons": [
                {"src": _prefix("/store-assets/app-icon-192.png"), "sizes": "192x192", "type": "image/png"},
                {"src": _prefix("/store-assets/app-icon-512.png"), "sizes": "512x512", "type": "image/png"},
            ],
        }
        response = jsonify(payload)
        response.headers["Cache-Control"] = "public, max-age=3600"
        return response

    @app.get("/api/store/config")
    def storefront_config() -> Response:
        response = jsonify(ok=True, store=_public_config(core.load_data()))
        response.headers["Cache-Control"] = "public, max-age=20, stale-while-revalidate=60"
        return response

    @app.get("/api/store/products")
    def storefront_products() -> Response:
        data = core.load_data()
        settings = settings_from(data)
        if not settings.get("enabled", True):
            response = jsonify(ok=False, error="فروشگاه موقتاً غیرفعال است")
            response.headers["Cache-Control"] = "no-store"
            return response, 503
        catalog_rows = _catalog(data)
        reserved = _reserved_quantities(data)
        for row in catalog_rows:
            row["stock"] = max(0, int(row["stock"]) - reserved.get(row["id"], 0))
            row["available"] = row["stock"] > 0
        rows = list(catalog_rows)
        query = _normalize_search(request.args.get("q"))
        category = _normalize_search(request.args.get("category"))
        profile = _normalize_search(request.args.get("profile"))
        if query:
            rows = [row for row in rows if query in _normalize_search(
                " ".join(str(row.get(key, "")) for key in ("title", "category", "profile", "sku", "short_description"))
            )]
        if category:
            rows = [row for row in rows if _normalize_search(row.get("category")) == category]
        if profile:
            rows = [row for row in rows if _normalize_search(row.get("profile")) == profile]
        if str(request.args.get("available") or "").lower() in {"1", "true", "yes"}:
            rows = [row for row in rows if row.get("available")]
        sort = str(request.args.get("sort") or "featured")
        if sort == "price-asc":
            rows.sort(key=lambda item: (int(item["price"]), item["title"]))
        elif sort == "price-desc":
            rows.sort(key=lambda item: (-int(item["price"]), item["title"]))
        elif sort == "title":
            rows.sort(key=lambda item: _normalize_search(item["title"]))
        else:
            rows.sort(key=lambda item: (not item["available"], item["position"]))
        try:
            page = max(1, int(request.args.get("page", 1)))
            per_page = max(8, min(60, int(request.args.get("per_page", settings["catalog"]["page_size"]))))
        except (TypeError, ValueError):
            page, per_page = 1, 24
        total = len(rows)
        start = (page - 1) * per_page
        categories: dict[str, int] = {}
        profiles: dict[str, int] = {}
        for row in catalog_rows:
            categories[row["category"]] = categories.get(row["category"], 0) + 1
            if row.get("profile"):
                profiles[row["profile"]] = profiles.get(row["profile"], 0) + 1
        payload = {
            "ok": True, "items": [_catalog_public(row) for row in rows[start:start + per_page]],
            "page": page, "per_page": per_page, "total": total,
            "total_pages": max(1, (total + per_page - 1) // per_page),
            "categories": [{"name": key, "count": value} for key, value in sorted(categories.items())],
            "profiles": [{"name": key, "count": value} for key, value in sorted(profiles.items())],
        }
        response = jsonify(payload)
        response.headers["Cache-Control"] = "public, max-age=10, stale-while-revalidate=30"
        response.set_etag(hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest())
        return response.make_conditional(request)

    @app.get("/api/store/products/<product_id>")
    def storefront_product(product_id: str) -> Response:
        data = core.load_data()
        if not settings_from(data).get("enabled", True):
            response = jsonify(ok=False, error="فروشگاه موقتاً غیرفعال است")
            response.headers["Cache-Control"] = "no-store"
            return response, 503
        row = next((item for item in _catalog(data, details=True) if item["id"] == product_id), None)
        if not row:
            return jsonify(ok=False, error="محصول پیدا نشد"), 404
        reserved = _reserved_quantities(data).get(product_id, 0)
        row["stock"] = max(0, int(row["stock"]) - reserved)
        row["available"] = row["stock"] > 0
        response = jsonify(ok=True, product=_catalog_public(row))
        response.headers["Cache-Control"] = "public, max-age=10"
        return response

    @app.post("/api/store/orders")
    def storefront_order_create() -> Response:
        try:
            _check_origin()
            body = _json_body()
            customer = _customer(body.get("customer"))
            remote = request.remote_addr or "unknown"
            _rate_limit("order-ip", remote, limit=40, seconds=600)
            _rate_limit("order", remote + ":" + customer["mobile"], limit=8, seconds=600)
            raw_items = body.get("items") if isinstance(body.get("items"), list) else []
            if not raw_items or len(raw_items) > 40:
                raise StoreError("سبد خرید معتبر نیست")
            requested: dict[str, int] = {}
            for item in raw_items:
                if not isinstance(item, dict):
                    raise StoreError("آیتم سبد خرید معتبر نیست")
                product_id = str(item.get("id") or item.get("product_id") or "")
                try:
                    quantity = int(item.get("quantity", 1))
                except (TypeError, ValueError) as exc:
                    raise StoreError("تعداد محصول معتبر نیست") from exc
                if not product_id or not 1 <= quantity <= 20:
                    raise StoreError("تعداد هر محصول باید بین ۱ تا ۲۰ باشد")
                requested[product_id] = requested.get(product_id, 0) + quantity
            if sum(requested.values()) > 80:
                raise StoreError("تعداد اقلام سفارش بیش از حد مجاز است")
            payment_method = str(body.get("payment_method") or "cod")
            idem = str(body.get("idempotency_key") or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_.:-]{16,128}", idem):
                raise StoreError("کلید یکتای سفارش معتبر نیست")
            note = _plain(body.get("note"), 500)
            canonical = json.dumps({
                "customer": customer, "items": sorted(requested.items()),
                "payment": payment_method, "note": note,
            }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            request_hash = hashlib.sha256(canonical.encode()).hexdigest()
            access_token = ""
            existing_order: dict[str, Any] | None = None
            with _mutate_data() as data:
                idempotency = data.setdefault("store_idempotency", {})
                old = idempotency.get(idem)
                if isinstance(old, dict):
                    if not hmac.compare_digest(str(old.get("request_hash", "")), request_hash):
                        raise StoreError("این کلید یکتا برای سفارش دیگری استفاده شده است", 409)
                    existing_order = data.setdefault("store_orders", {}).get(old.get("order_id"))
                    if isinstance(existing_order, dict):
                        access_token = _unseal(existing_order.get("access_token_enc"))
                if existing_order is None:
                    settings = settings_from(data)
                    if not settings.get("enabled", True):
                        raise StoreError("فروشگاه موقتاً غیرفعال است", 503)
                    methods = {item["id"] for item in _public_gateway_list(settings)}
                    if payment_method not in methods:
                        raise StoreError("روش پرداخت انتخاب‌شده فعال نیست")
                    products = {item["id"]: item for item in _catalog(data, details=True)}
                    reserved = _reserved_quantities(data)
                    order_items = []
                    subtotal = 0
                    for product_id, quantity in requested.items():
                        product = products.get(product_id)
                        if not product:
                            raise StoreError("یکی از محصولات دیگر در فروشگاه موجود نیست", 409)
                        available = max(0, int(product["stock"]) - reserved.get(product_id, 0))
                        if quantity > available:
                            raise StoreError(f"موجودی «{product['title']}» کافی نیست", 409)
                        line_total = int(product["price"]) * quantity
                        subtotal += line_total
                        order_items.append({
                            "product_id": product_id, "profile_id": product["_profile_id"],
                            "source_key": product["_source_key"], "title": product["title"],
                            "image": product["image"], "category": product["category"],
                            "brand": product.get("brand", ""), "sku": product.get("sku", ""),
                            "quantity": quantity, "unit_price": int(product["price"]), "line_total": line_total,
                        })
                    shipping_cfg = settings.get("shipping", {})
                    minimum = int(float(shipping_cfg.get("minimum_order", 0) or 0))
                    if subtotal < minimum:
                        raise StoreError(f"حداقل مبلغ سفارش {minimum:,} تومان است")
                    free_over = int(float(shipping_cfg.get("free_over", 0) or 0))
                    shipping = 0 if free_over and subtotal >= free_over else int(float(shipping_cfg.get("flat_fee", 0) or 0))
                    orders = data.setdefault("store_orders", {})
                    order_id = _new_order_id(orders)
                    access_token = secrets.token_urlsafe(32)
                    now = int(time.time())
                    payment_status = "cod" if payment_method == "cod" else "created"
                    status = "confirmed" if payment_method == "cod" else "awaiting_payment"
                    order = {
                        "id": order_id, "created_at": now, "updated_at": now, "status": status,
                        "customer": customer, "note": note, "items": order_items,
                        "subtotal": subtotal, "shipping": shipping, "total": subtotal + shipping,
                        "currency": "تومان", "shipping_label": shipping_cfg.get("label", "ارسال استاندارد"),
                        "shipping_eta": shipping_cfg.get("eta", ""), "tracking_code": "",
                        "reservation_expires_at": now + (30 * 60 if payment_method != "cod" else 365 * 86400),
                        "access_token_hash": hashlib.sha256(access_token.encode()).hexdigest(),
                        "access_token_enc": _seal(access_token),
                        "payment": {"gateway": payment_method, "status": payment_status, "amount": subtotal + shipping,
                                    "currency": "IRT", "attempts": [], "redirect_url": ""},
                        "history": [],
                    }
                    _history(order, status, "سفارش ثبت شد" if payment_method == "cod" else "سفارش در انتظار پرداخت است")
                    orders[order_id] = order
                    idempotency[idem] = {"order_id": order_id, "request_hash": request_hash, "created_at": now}
                    if len(idempotency) > 3000:
                        for key, value in sorted(idempotency.items(), key=lambda row: int(row[1].get("created_at", 0)))[:-2500]:
                            idempotency.pop(key, None)
                    existing_order = copy.deepcopy(order)
            assert existing_order is not None
            if existing_order.get("payment", {}).get("gateway") != "cod" and existing_order.get("payment", {}).get("status") not in {"paid", "redirect_ready"}:
                try:
                    existing_order = _init_payment(str(existing_order["id"]))
                except StoreError as exc:
                    latest = core.load_data().get("store_orders", {}).get(existing_order["id"], existing_order)
                    return jsonify(ok=False, error=str(exc), order=_public_order(latest, access_token), retryable=True), exc.status
            return jsonify(ok=True, order=_public_order(existing_order, access_token)), 201
        except StoreError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status

    @app.post("/api/store/orders/<order_id>/pay")
    def storefront_order_retry(order_id: str) -> Response:
        try:
            _check_origin()
            _rate_limit("payment-retry", (request.remote_addr or "") + ":" + order_id, limit=6, seconds=600)
            token = _request_order_token()
            order = core.load_data().get("store_orders", {}).get(order_id)
            if not isinstance(order, dict) or not _token_matches(order, token):
                raise StoreError("سفارش یا مجوز دسترسی معتبر نیست", 404)
            payment = order.get("payment", {})
            if payment.get("status") == "paid":
                return jsonify(ok=True, order=_public_order(order))
            if payment.get("gateway") == "cod":
                raise StoreError("این سفارش پرداخت اینترنتی ندارد")
            if payment.get("status") == "redirect_ready" and payment.get("redirect_url"):
                return jsonify(ok=True, order=_public_order(order))
            if payment.get("status") in {"verify_failed", "verifying"} or order.get("status") == "needs_review":
                raise StoreError("این پرداخت ممکن است انجام شده باشد و باید پیش از تلاش دوباره بررسی شود", 409)
            # A failed initiation releases its old reservation. Re-check stock
            # atomically before creating a fresh gateway session.
            with _mutate_data() as data:
                current = data.setdefault("store_orders", {}).get(order_id)
                if not isinstance(current, dict):
                    raise StoreError("سفارش پیدا نشد", 404)
                products = {item["id"]: item for item in _catalog(data)}
                reserved = _reserved_quantities(data, exclude_order_id=order_id)
                for item in current.get("items", []):
                    product = products.get(str(item.get("product_id", "")))
                    quantity = int(item.get("quantity", 0) or 0)
                    if not product or int(product.get("stock", 0)) - reserved.get(product["id"], 0) < quantity:
                        raise StoreError("موجودی یکی از کالاها برای تلاش دوباره کافی نیست", 409)
                current["reservation_expires_at"] = int(time.time()) + 30 * 60
                current["status"] = "awaiting_payment"
                current["updated_at"] = int(time.time())
            updated = _init_payment(order_id)
            return jsonify(ok=True, order=_public_order(updated))
        except StoreError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status

    @app.get("/api/store/orders/<order_id>")
    def storefront_order_status(order_id: str) -> Response:
        try:
            remote = request.remote_addr or "unknown"
            _rate_limit("order-status-ip", remote, limit=180, seconds=600)
            _rate_limit("order-status", remote + ":" + order_id, limit=60, seconds=600)
            order = core.load_data().get("store_orders", {}).get(order_id)
            if not isinstance(order, dict) or not _token_matches(order, _request_order_token()):
                raise StoreError("سفارش یا مجوز دسترسی معتبر نیست", 404)
            response = jsonify(ok=True, order=_public_order(order))
            response.headers["Cache-Control"] = "no-store"
            return response
        except StoreError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status

    @app.post("/api/store/orders/track")
    def storefront_order_track() -> Response:
        try:
            _check_origin()
            body = _json_body(8192)
            order_id = str(body.get("order_id") or "").strip().upper()[:40]
            mobile = _normalize_mobile(body.get("mobile"))
            remote = request.remote_addr or "unknown"
            _rate_limit("track-ip", remote, limit=60, seconds=600)
            _rate_limit("track", remote + ":" + mobile, limit=20, seconds=600)
            order = core.load_data().get("store_orders", {}).get(order_id)
            if not isinstance(order, dict) or not hmac.compare_digest(str(order.get("customer", {}).get("mobile", "")), mobile):
                raise StoreError("سفارشی با این مشخصات پیدا نشد", 404)
            safe = _public_order(order)
            safe.pop("redirect_url", None)
            return jsonify(ok=True, order=safe)
        except StoreError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status

    @app.route("/api/store/payments/<gateway_name>/callback", methods=["GET", "POST"])
    def storefront_payment_callback(gateway_name: str) -> Response:
        order_id = str(request.args.get("order_id") or "").strip().upper()
        state = str(request.args.get("state") or "")
        if not order_id or not state or gateway_name not in {"zarinpal", "digipay", "torobpay", "custom"}:
            return _payment_page(order_id or "—", False, "اطلاعات بازگشت از درگاه کامل نیست", 400)
        lock = _verify_lock(order_id)
        with lock:
            nonce = secrets.token_hex(16)
            try:
                with _mutate_data() as data:
                    order = data.setdefault("store_orders", {}).get(order_id)
                    if not isinstance(order, dict) or order.get("payment", {}).get("gateway") != gateway_name:
                        raise PaymentError("سفارش پرداخت پیدا نشد", 404)
                    payment = order["payment"]
                    if payment.get("status") == "paid":
                        return _payment_page(order_id, True, "این پرداخت قبلاً با موفقیت تأیید شده است")
                    expected_state = str(payment.get("callback_state_hash") or "")
                    if not expected_state or not hmac.compare_digest(expected_state, hashlib.sha256(state.encode()).hexdigest()):
                        raise PaymentError("شناسه امنیتی callback معتبر نیست", 403)
                    verifying_at = int(payment.get("verifying_at", 0) or 0)
                    if payment.get("verification_state") == "running" and time.time() - verifying_at < 90:
                        return _payment_page(order_id, False, "تأیید پرداخت در حال انجام است؛ چند لحظه دیگر پیگیری کنید", 202)
                    payment.update(verification_state="running", verification_nonce=nonce, verifying_at=int(time.time()))
                    payment.setdefault("attempts", []).append({"kind": "verify", "status": "started", "at": int(time.time())})
                    snapshot = copy.deepcopy(order)
                    settings = settings_from(data)
                values = _callback_values()
                result = _verify_payment(snapshot, settings, values)
                stock_issues: list[str] = []
                with _mutate_data() as data:
                    order = data.setdefault("store_orders", {}).get(order_id)
                    if not isinstance(order, dict):
                        raise PaymentError("سفارش پرداخت پیدا نشد", 404)
                    payment = order["payment"]
                    if payment.get("status") != "paid":
                        if payment.get("verification_nonce") != nonce:
                            raise PaymentError("تأیید دیگری جایگزین این درخواست شده است", 409)
                        payment.update({
                            "status": "paid", "verification_state": "done", "verified_at": int(time.time()),
                            "reference_id": _plain(result.get("reference_id"), 160), "error": "",
                        })
                        payment.pop("verification_nonce", None)
                        payment.setdefault("attempts", []).append({
                            "kind": "verify", "status": "paid", "reference_id": payment["reference_id"],
                            "at": int(time.time()),
                        })
                        stock_issues = _order_stock_issues(data, order)
                        order["status"] = "needs_review" if stock_issues else "confirmed"
                        order["reservation_expires_at"] = int(time.time()) + 365 * 86400
                        order["updated_at"] = int(time.time())
                        _history(
                            order, order["status"],
                            "پرداخت تأیید شد؛ موجودی نیازمند بررسی است" if stock_issues else "پرداخت با موفقیت تأیید شد",
                            "، ".join(stock_issues) if stock_issues else payment["reference_id"],
                        )
                message = ("پرداخت تأیید شد؛ فروشگاه موجودی سفارش را بررسی خواهد کرد" if stock_issues
                           else "پرداخت شما تأیید و سفارش ثبت نهایی شد")
                return _payment_page(order_id, True, message)
            except PaymentCancelled as exc:
                with _mutate_data() as data:
                    order = data.setdefault("store_orders", {}).get(order_id)
                    if isinstance(order, dict) and order.get("payment", {}).get("status") != "paid":
                        order["payment"].update(status="cancelled", verification_state="done", error=str(exc))
                        order["status"] = "payment_failed"
                        order["updated_at"] = int(time.time())
                        _history(order, "payment_failed", "پرداخت لغو یا ناموفق شد")
                return _payment_page(order_id, False, str(exc), exc.status)
            except StoreError as exc:
                with _mutate_data() as data:
                    order = data.setdefault("store_orders", {}).get(order_id)
                    if isinstance(order, dict) and order.get("payment", {}).get("status") != "paid":
                        payment = order["payment"]
                        if payment.get("verification_nonce") == nonce:
                            payment.update(status="verify_failed", verification_state="failed", error=str(exc))
                            payment.pop("verification_nonce", None)
                            payment.setdefault("attempts", []).append({
                                "kind": "verify", "status": "failed", "error": str(exc)[:300], "at": int(time.time()),
                            })
                            order["status"] = "needs_review"
                            order["updated_at"] = int(time.time())
                            _history(order, "needs_review", "تأیید پرداخت نیازمند بررسی است", str(exc))
                return _payment_page(order_id, False, str(exc), exc.status)
            except Exception as exc:  # noqa: BLE001 - provider failures become a safe payment result
                core.report_error("storefront.payment.callback", exc, extra={"order_id": order_id, "gateway": gateway_name})
                return _payment_page(order_id, False, "خطای موقت در تأیید پرداخت؛ سفارش برای بررسی ثبت شد", 502)

    @app.post("/api/store/webhooks/basalam/<hook_token>")
    def storefront_basalam_webhook(hook_token: str) -> Response:
        if request.content_length and request.content_length > 262144:
            return jsonify(ok=False, error="payload too large"), 413
        raw = request.get_data(cache=True)
        payload = request.get_json(silent=True)
        if not isinstance(payload, (dict, list)):
            return jsonify(ok=False, error="invalid json"), 400
        data = core.load_data()
        settings = settings_from(data)
        webhook_cfg = settings.get("basalam_webhook", {})
        if not webhook_cfg.get("enabled"):
            return jsonify(ok=False, error="webhook disabled"), 503
        token, bearer, require_header = _webhook_credentials(settings)
        expected_hash = str(webhook_cfg.get("token_hash") or "")
        actual_hash = hashlib.sha256(hook_token.encode()).hexdigest()
        if not token or not expected_hash or not hmac.compare_digest(expected_hash, actual_hash):
            return jsonify(ok=False, error="unauthorized"), 401
        if not hmac.compare_digest(token, hook_token):
            return jsonify(ok=False, error="unauthorized"), 401
        if require_header:
            supplied = request.headers.get("Authorization", "")
            expected = "Bearer " + bearer
            if not bearer or not hmac.compare_digest(supplied, expected):
                return jsonify(ok=False, error="unauthorized"), 401
        event_key = _event_id(payload, raw)
        event_number, event_name = _event_type(payload)
        now = int(time.time())
        with _mutate_data() as mutable:
            events = mutable.setdefault("store_webhook_events", {})
            if event_key in events:
                events[event_key]["deliveries"] = int(events[event_key].get("deliveries", 1)) + 1
                events[event_key]["last_received_at"] = now
                duplicate = True
            else:
                events[event_key] = {
                    "id": event_key, "provider": "basalam", "event_id": event_number,
                    "event_name": event_name, "received_at": now, "last_received_at": now,
                    "deliveries": 1, "status": "processed", "summary": _event_summary(payload, event_name),
                    "payload": payload,
                }
                duplicate = False
                if len(events) > 500:
                    for key, value in sorted(events.items(), key=lambda row: int(row[1].get("received_at", 0)))[:-450]:
                        events.pop(key, None)
        return jsonify(ok=True, duplicate=duplicate, event=event_key), (200 if duplicate else 202)

    @app.get("/api/store/admin/overview")
    def storefront_admin_overview() -> Response:
        data = core.load_data()
        orders = [item for item in data.get("store_orders", {}).values() if isinstance(item, dict)]
        events = [item for item in data.get("store_webhook_events", {}).values() if isinstance(item, dict)]
        products = _catalog(data)
        paid = [item for item in orders if item.get("payment", {}).get("status") in {"paid", "cod"}]
        recent = sorted(orders, key=lambda item: int(item.get("created_at", 0)), reverse=True)[:12]
        return jsonify(ok=True, overview={
            "products": len(products), "orders": len(orders), "paid_orders": len(paid),
            "revenue": sum(int(item.get("total", 0) or 0) for item in paid),
            "webhook_events": len(events), "recent_orders": [_safe_admin_order(item) for item in recent],
            "settings": _admin_settings(data),
        })

    @app.route("/api/store/admin/settings", methods=["GET", "PUT"])
    def storefront_admin_settings() -> Response:
        if request.method == "GET":
            return jsonify(ok=True, settings=_admin_settings(core.load_data()))
        try:
            _check_origin()
            body = _json_body(131072)
            with _mutate_data() as data:
                _update_settings(data, body.get("settings") if isinstance(body.get("settings"), dict) else body)
                result = _admin_settings(data)
            return jsonify(ok=True, settings=result)
        except StoreError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status

    @app.get("/api/store/admin/orders")
    def storefront_admin_orders() -> Response:
        data = core.load_data()
        rows = [item for item in data.get("store_orders", {}).values() if isinstance(item, dict)]
        status = str(request.args.get("status") or "")
        query = _normalize_search(request.args.get("q"))
        if status:
            rows = [item for item in rows if item.get("status") == status]
        if query:
            rows = [item for item in rows if query in _normalize_search(
                str(item.get("id", "")) + " " + str(item.get("customer", {}).get("name", "")) + " " +
                str(item.get("customer", {}).get("mobile", ""))
            )]
        rows.sort(key=lambda item: int(item.get("created_at", 0)), reverse=True)
        try:
            page = max(1, int(request.args.get("page", 1)))
            per_page = max(10, min(100, int(request.args.get("per_page", 30))))
        except (TypeError, ValueError):
            page, per_page = 1, 30
        start = (page - 1) * per_page
        return jsonify(ok=True, items=[_safe_admin_order(item) for item in rows[start:start + per_page]],
                       total=len(rows), page=page, total_pages=max(1, (len(rows) + per_page - 1) // per_page))

    @app.route("/api/store/admin/orders/<order_id>", methods=["GET", "PATCH"])
    def storefront_admin_order(order_id: str) -> Response:
        if request.method == "GET":
            order = core.load_data().get("store_orders", {}).get(order_id)
            if not isinstance(order, dict):
                return jsonify(ok=False, error="سفارش پیدا نشد"), 404
            return jsonify(ok=True, order=_safe_admin_order(order))
        try:
            _check_origin()
            body = _json_body(16384)
            allowed = {"confirmed", "processing", "shipped", "delivered", "cancelled", "refunded", "needs_review"}
            status = str(body.get("status") or "")
            tracking = _plain(body.get("tracking_code"), 120)
            if status and status not in allowed:
                raise StoreError("وضعیت سفارش معتبر نیست")
            with _mutate_data() as data:
                order = data.setdefault("store_orders", {}).get(order_id)
                if not isinstance(order, dict):
                    raise StoreError("سفارش پیدا نشد", 404)
                if status and status != order.get("status"):
                    order["status"] = status
                    _history(order, status, _status_title(status), _plain(body.get("note"), 300))
                if "tracking_code" in body:
                    order["tracking_code"] = tracking
                order["updated_at"] = int(time.time())
                result = _safe_admin_order(order)
            return jsonify(ok=True, order=result)
        except StoreError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status

    @app.get("/api/store/admin/webhooks")
    def storefront_admin_webhooks() -> Response:
        data = core.load_data()
        events = [item for item in data.get("store_webhook_events", {}).values() if isinstance(item, dict)]
        events.sort(key=lambda item: int(item.get("received_at", 0)), reverse=True)
        safe = [{key: value for key, value in item.items() if key != "payload"} for item in events[:200]]
        return jsonify(ok=True, events=safe, event_types=EVENT_NAMES)

    @app.get("/api/store/admin/webhooks/<event_id>")
    def storefront_admin_webhook(event_id: str) -> Response:
        event = core.load_data().get("store_webhook_events", {}).get(event_id)
        if not isinstance(event, dict):
            return jsonify(ok=False, error="رخداد پیدا نشد"), 404
        return jsonify(ok=True, event=event)

    @app.post("/api/store/admin/webhooks/rotate")
    def storefront_admin_webhook_rotate() -> Response:
        try:
            _check_origin()
            with _mutate_data() as data:
                token, _stored_bearer = _ensure_webhook_secret(data, rotate=True)
                settings = settings_from(data)
                _effective_token, bearer, _require_header = _webhook_credentials(settings)
                url = _public_base(settings) + "/api/store/webhooks/basalam/" + token
            return jsonify(ok=True, webhook={
                "url": url, "authorization": "Bearer " + bearer,
                "note": "این اطلاعات فقط همین بار کامل نمایش داده می‌شود؛ آن را در پنل باسلام ثبت کنید.",
            })
        except StoreError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status

    @app.get("/api/store/admin/webhooks/setup")
    def storefront_admin_webhook_setup() -> Response:
        with _mutate_data() as data:
            token, _stored_bearer = _ensure_webhook_secret(data)
            settings = settings_from(data)
            _effective_token, bearer, _require_header = _webhook_credentials(settings)
            url = _public_base(settings) + "/api/store/webhooks/basalam/" + token
            cfg = settings.get("basalam_webhook", {})
        return jsonify(ok=True, webhook={
            "url": url, "authorization": "Bearer " + bearer,
            "require_header": _require_header, "event_ids": cfg.get("event_ids", []),
            "event_types": EVENT_NAMES,
            "official_docs": "https://developers.basalam.com/docs/services/webhook",
        })

    @app.post("/api/store/admin/webhooks/register")
    def storefront_admin_webhook_register() -> Response:
        """Register the receiver with Basalam's documented v1 webhook API."""
        try:
            _check_origin()
            with _mutate_data() as data:
                token, _bearer = _ensure_webhook_secret(data)
                settings = settings_from(data)
                cfg = settings.get("basalam_webhook", {})
                _effective_token, _effective_bearer, require_header = _webhook_credentials(settings)
                if require_header:
                    raise StoreError("برای ثبت خودکار، الزام هدر را خاموش کنید یا وب‌هوک را با هدر Authorization در پنل باسلام بسازید")
                basalam = data.get("basalam", {})
                api_token = core.normalize_basalam_token(basalam.get("token"))
                if not api_token:
                    raise StoreError("توکن اتصال باسلام تنظیم نشده است")
                callback = _public_base(settings) + "/api/store/webhooks/basalam/" + token
                event_ids = cfg.get("event_ids", [1, 3, 5, 7, 8, 9])
            response = core.outbound_request(
                "POST", "https://webhook.basalam.com/v1/webhooks",
                json={"event_ids": event_ids, "request_method": "POST", "url": callback,
                      "is_active": True, "register_me": True},
                headers={"Authorization": "Bearer " + api_token, "Accept": "application/json",
                         "Content-Type": "application/json"}, timeout=45,
            )
            payload = _response_json(response, "باسلام")
            payload_data = (payload.get("data") if isinstance(payload, dict) and
                            isinstance(payload.get("data"), dict) else payload)
            with _mutate_data() as data:
                data.setdefault("store", {}).setdefault("basalam_webhook", {})["last_registration"] = {
                    "at": int(time.time()), "registered": True,
                    "webhook_id": _plain(payload_data.get("id") if isinstance(payload_data, dict) else "", 120),
                }
            return jsonify(ok=True, registration=payload, callback_url=callback)
        except StoreError as exc:
            return jsonify(ok=False, error=str(exc)), exc.status
        except Exception as exc:  # noqa: BLE001
            core.report_error("storefront.basalam.register", exc)
            return jsonify(ok=False, error="ثبت وب‌هوک باسلام ناموفق بود: " + str(exc)[:300]), 502
