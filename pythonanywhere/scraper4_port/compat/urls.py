"""URL helpers preserving scraper4.php v10.599's intentionally simple rules."""
from __future__ import annotations

import hashlib
import html
import re
from urllib.parse import quote, urlsplit


def normalize_input_url(value: str) -> str:
    value = str(value).strip()
    # PHP's source first accepts FILTER_VALIDATE_URL, then percent-encodes only
    # non-ASCII/space/control bytes. Printable ASCII, including existing %, is
    # left untouched.
    if not value:
        return ""
    try:
        parts = urlsplit(value)
        port_ok = True
        try:
            _ = parts.port
        except ValueError:
            port_ok = False
        if (
            parts.scheme
            and re.fullmatch(r"[A-Za-z][A-Za-z0-9+.-]*", parts.scheme)
            and parts.hostname
            and port_ok
            and value.isascii()
            and not any(ch.isspace() for ch in value)
        ):
            return value
    except ValueError:
        pass
    return re.sub(r"[^\x21-\x7e]", lambda m: quote(m.group(0), safe=""), value)


def make_absolute_url(value: str, base: str) -> str:
    value = str(value).strip()
    value = html.unescape(value)
    if not value or re.match(r"^(data:|javascript:|#)", value, re.I):
        return ""
    if re.match(r"^https?://", value, re.I):
        return value
    if value.startswith("//"):
        try:
            scheme = urlsplit(base).scheme or "https"
        except ValueError:
            scheme = "https"
        return f"{scheme}:{value}"
    try:
        bp = urlsplit(base)
        authority = bp.netloc.rsplit("@", 1)[-1]
        if authority.startswith("[") and "]" in authority:
            close = authority.index("]")
            host = authority[: close + 1]
            port_suffix = authority[close + 1 :]
        elif authority.count(":") == 1:
            host, _, port_text = authority.rpartition(":")
            port_suffix = ":" + port_text if port_text.isdigit() else ""
            if not port_text.isdigit():
                host = authority
        else:
            host, port_suffix = authority, ""
    except ValueError:
        bp = None
        host = ""
        port_suffix = ""
    if not bp or not host:
        return value
    root = f"{bp.scheme or 'https'}://{host}{port_suffix}"
    if value.startswith("/"):
        return root + value
    path = bp.path or "/"
    directory = re.sub(r"/[^/]*$", "/", path)
    return root + directory + value


def url_is_image(value: str) -> bool:
    value = str(value).strip()
    if not value or re.match(r"^(data:|blob:|javascript:|#)", value, re.I):
        return False
    return not bool(re.search(r"(placeholder|spacer|transparent|loading|no-?image|blank\.|1x1)", value, re.I))


def profile_key(value: str) -> str:
    value = normalize_input_url(value)
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").lower()
        path = parts.path or "/"
    except ValueError:
        host, path = "", ""
    if not host:
        return hashlib.md5(value.encode("utf-8")).hexdigest()
    path = path.strip("/")
    path = re.sub(r"/page/\d+/?$", "", path, flags=re.I)
    path = re.sub(r"\.(html|htm|php)$", "", path, flags=re.I)
    suffix = re.sub(r"[^a-z0-9]+", "_", path, flags=re.I)
    return host + ("_" + suffix if suffix else "")
