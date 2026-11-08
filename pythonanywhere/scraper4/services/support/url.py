"""پورتِ وفادارِ make_absolute_url() / url_is_image() / profileKey()"""
from __future__ import annotations

import hashlib
import re
from urllib.parse import urlsplit

_SCHEME_RE = re.compile(r"^https?://", re.IGNORECASE)
_SKIP_RE = re.compile(r"^(data:|javascript:|#)", re.IGNORECASE)
_BAD_IMAGE_RE = re.compile(
    r"(placeholder|spacer|transparent|loading|no-?image|blank\.|1x1)", re.IGNORECASE
)
_PAGE_SEG_RE = re.compile(r"/page/\d+/?$", re.IGNORECASE)
_EXT_RE = re.compile(r"\.(html|htm|php)$", re.IGNORECASE)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+", re.IGNORECASE)


def absolute(url: str, base: str) -> str:
    """آدرسِ نسبی را نسبت به base مطلق می‌کند (رفتارِ عینِ نسخهٔ قدیمی)."""
    from .persian import normalize_text

    url = normalize_text(url or "")
    if not url or _SKIP_RE.match(url):
        return ""
    if _SCHEME_RE.match(url):
        return url
    if url.startswith("//"):
        parts = urlsplit(base)
        return (parts.scheme or "https") + ":" + url

    bp = urlsplit(base)
    if not bp.hostname:
        return url
    root = f"{bp.scheme or 'https'}://{bp.hostname}"
    if bp.port:
        root += f":{bp.port}"
    if url.startswith("/"):
        return root + url
    directory = re.sub(r"/[^/]*$", "/", bp.path or "/")
    return root + directory + url


def is_image(url: str) -> bool:
    """آیا URL به‌دردِ تصویرِ محصول می‌خورد؟ (پلیس‌هولدرها رد می‌شوند)"""
    u = (url or "").strip()
    if not u or re.match(r"^(data:|blob:|javascript:|#)", u, re.IGNORECASE):
        return False
    if _BAD_IMAGE_RE.search(u):
        return False
    return True


def profile_key(url: str) -> str:
    """کلیدِ پایدارِ پروفایل از روی URL (همان profileKey نسخهٔ قدیمی)."""
    parts = urlsplit(url or "")
    if not parts.hostname:
        return hashlib.md5((url or "").encode("utf-8")).hexdigest()
    host = parts.hostname.lower()
    path = (parts.path or "/").strip("/")
    path = _PAGE_SEG_RE.sub("", path)
    path = _EXT_RE.sub("", path)
    if not path:
        return host
    return f"{host}_{_NON_ALNUM_RE.sub('_', path)}"


def host_of(url: str) -> str:
    try:
        return (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
