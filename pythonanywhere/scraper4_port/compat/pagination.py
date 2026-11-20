"""Behavior-compatible port of scraper4.php's build_page_url_custom().

The implementation intentionally preserves the legacy URL construction rules,
including its treatment of query strings and path marker templates.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlsplit

QUERY_PAGE = "query_page"
QUERY_CUSTOM = "query_custom"
PATH_PATTERN = "path_pattern"
FULL_PATTERN = "full_pattern"
NEXT_SELECTOR = "next_selector"


def _php_parts(url: str):
    """The subset of PHP parse_url fields used by the original function."""
    try:
        p = urlsplit(url)
    except ValueError:
        return None
    # PHP parse_url returns false only for malformed URLs; this catches the
    # common malformed authority cases while allowing relative paths.
    if any(ch.isspace() for ch in p.netloc):
        return None
    authority = p.netloc.rsplit("@", 1)[-1]
    if authority.startswith("[") and "]" in authority:
        host = authority[: authority.index("]") + 1]
    else:
        host = authority.rsplit(":", 1)[0] if authority.count(":") == 1 and authority.rsplit(":", 1)[1].isdigit() else authority
    return {
        "scheme": p.scheme or None,
        "host": host or None,
        "path": p.path or None,
        "query": p.query or None,
    }


def _php_query(query: str) -> dict[str, str]:
    # parse_str() collapses duplicate scalar keys to the last value. Keep the
    # insertion position of the first occurrence, as PHP arrays do.
    result: dict[str, str] = {}
    for key, value in parse_qsl(query, keep_blank_values=True):
        result[key.replace(".", "_").replace(" ", "_")] = value
    return result


def build_page_url_custom(
    current_url: str,
    base_url: str,
    page: int,
    kind: str = QUERY_PAGE,
    value: str = "",
) -> str:
    page = int(page)
    if kind == QUERY_CUSTOM:
        param = value or "paged"
        parts = _php_parts(current_url)
        if not parts:
            return current_url
        base = f"{parts['scheme'] or 'https'}://{parts['host'] or ''}{parts['path'] or '/'}"
        query = _php_query(parts['query'] or "")
        query[param] = str(page)
        return base + "?" + urlencode(query)

    if kind == PATH_PATTERN:
        pattern = value if value != "" else "/page/{page}/"
        replacement = pattern.replace("{page}", str(page))
        parts = _php_parts(base_url) or {}
        root = f"{parts.get('scheme') or 'https'}://{parts.get('host') or ''}"
        base_path = (parts.get("path") or "/").rstrip("/")
        token_pos = pattern.find("{page}")
        if token_pos >= 0:
            prefix = pattern[:token_pos]
            suffix_raw = pattern[token_pos + 6 :]
            if prefix:
                suffix_trim = suffix_raw.rstrip("/")
                suffix_part = re.escape(suffix_trim) if suffix_trim else ""
                if suffix_raw == "" or suffix_raw.endswith("/"):
                    suffix_part += "/?"
                base_path = re.sub(
                    re.escape(prefix) + r"\d+" + suffix_part + r"$",
                    "",
                    base_path,
                    flags=re.IGNORECASE,
                )
        base_path = re.sub(r"/page/\d+/?$", "", base_path, flags=re.IGNORECASE)
        base_path = base_path.rstrip("/")
        if base_path == "" and replacement and not replacement.startswith("/"):
            base_path = "/"
        return root + base_path + replacement

    if kind == FULL_PATTERN:
        return value.replace("{page}", str(page))

    parts = _php_parts(current_url)
    if not parts:
        return current_url
    base = f"{parts['scheme'] or 'https'}://{parts['host'] or ''}{parts['path'] or '/'}"
    query = _php_query(parts['query'] or "")
    query["page"] = str(page)
    return base + "?" + urlencode(query)
