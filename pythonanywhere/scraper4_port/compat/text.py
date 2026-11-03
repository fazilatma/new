"""Unicode/text/price helpers ported from the v10.599 PHP source."""
from __future__ import annotations

import html
import re

_DIGIT_TRANSLATION = str.maketrans(
    "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩",
    "01234567890123456789",
)
_DIGITS = r"[0-9۰-۹٠-٩]"
_CURRENCIES = r"£|\$|€|¥|₽|₺|₹|﷼|USD|EUR|GBP|AED|TRY|CAD|AUD|CHF|JPY|CNY"


def persian_to_english(value: str) -> str:
    return str(value).translate(_DIGIT_TRANSLATION)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(str(value))).strip()


def normalize_html(value: str) -> str:
    cleaned = re.sub(r"<script[^>]*>.*?</script>", "", str(value), flags=re.I | re.S)
    cleaned = re.sub(r"<style[^>]*>.*?</style>", "", cleaned, flags=re.I | re.S)
    return re.sub(r"\s+", " ", html.unescape(cleaned)).strip()


def extract_price(value: str) -> str:
    """Return the source app's price string, including inferred Toman units."""
    text = normalize_text(value)
    if not text:
        return ""
    sep = r"[,،٬\s]"

    # Iranian currency labels take precedence, and the match with the most
    # numeric digits wins (same rule as the source PHP function).
    local_pattern = re.compile(
        rf"({_DIGITS}(?:{_DIGITS}|{sep})*{_DIGITS})\s*(تومان|تومن|ریال|ر\.ی)"
    )
    local_matches = list(local_pattern.finditer(text))
    if local_matches:
        best = max(local_matches, key=lambda m: len(re.sub(r"[^0-9۰-۹٠-٩]", "", m.group(1))))
        return f"{best.group(1).strip()} {best.group(2)}"

    # Foreign currencies: accept either symbol/code position and decimal
    # comma/point formats. The greatest positive numeric value is returned.
    num = (
        rf"{_DIGITS}{{1,3}}(?:[,\s\u202f\u00a0]{_DIGITS}{{3}})+(?:[.٫]{_DIGITS}{{1,2}})?"
        rf"|{_DIGITS}+(?:[.,٫]{_DIGITS}{{1,2}})?(?!{_DIGITS})"
    )
    currency_pattern = re.compile(
        rf"(?:({_CURRENCIES})\s*({num}))|(?:({num})\s*({_CURRENCIES}))",
        re.IGNORECASE,
    )
    candidates: list[tuple[float, str]] = []
    for match in currency_pattern.finditer(text):
        symbol = match.group(1) or match.group(4) or ""
        raw = match.group(2) or match.group(3) or ""
        if not raw or not symbol:
            continue
        normalized = persian_to_english(raw).replace("٫", ".")
        if "." not in normalized and re.search(r",\d{1,2}$", normalized):
            normalized = re.sub(r",(\d{1,2})$", r".\1", normalized)
        normalized = re.sub(r"[,\s\u202f\u00a0]", "", normalized)
        try:
            amount = float(normalized)
        except ValueError:
            continue
        if amount > 0:
            candidates.append((amount, normalize_text(match.group(0))))
    if candidates:
        return max(candidates, key=lambda item: item[0])[1]

    # Grouped integer candidates default to Toman in the legacy parser.
    grouped_pattern = re.compile(rf"({_DIGITS}{{1,3}}(?:{sep}{_DIGITS}{{3}})+)")
    grouped = []
    for match in grouped_pattern.finditer(text):
        raw = match.group(1)
        digits = re.sub(r"[^0-9۰-۹٠-٩]", "", raw)
        if len(digits) >= 3:
            grouped.append((len(digits), raw))
    if grouped:
        return max(grouped, key=lambda item: item[0])[1].strip() + " تومان"

    plain_pattern = re.compile(rf"({_DIGITS}{{4,}})")
    plain = []
    for match in plain_pattern.finditer(text):
        raw = match.group(1)
        digits = persian_to_english(raw)
        amount = int(digits)
        if amount >= 1000:
            plain.append((amount, len(digits), raw))
    if plain:
        # The source sorts plain candidates by numeric value, not digit count.
        return max(plain, key=lambda item: item[0])[2].strip() + " تومان"
    return ""


def extract_price_num(value: object) -> int:
    digits = re.sub(r"[^0-9]", "", persian_to_english(str(value)))
    return int(digits) if digits else 0
