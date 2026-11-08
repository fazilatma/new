"""پورتِ وفادارِ توابع متنیِ scraper4.php:
   persianToEnglish() / normalize_text() / normalize_html()
   extractPrice() / extractPriceNum()

هر تابع عیناً همان رفتارِ نسخهٔ v10.172 را دارد تا خروجیِ پارسر در هر دو
پیاده‌سازی یکسان باشد (شرطِ مهاجرتِ امن).
"""
from __future__ import annotations

import html
import re

PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
ENGLISH_DIGITS = "0123456789"

_DIGIT_MAP = {ord(p): e for p, e in zip(PERSIAN_DIGITS, ENGLISH_DIGITS)}
_DIGIT_MAP.update({ord(a): e for a, e in zip(ARABIC_DIGITS, ENGLISH_DIGITS)})

DIGIT = r"0-9۰-۹٠-٩"
_SEP = r"[,،٬\s]"

_UNIT_RE = re.compile(
    rf"([{DIGIT}](?:[{DIGIT}]|{_SEP})*[{DIGIT}])\s*(تومان|تومن|ریال|ر\.ی)"
)
_SEP_GROUP_RE = re.compile(rf"([{DIGIT}]{{1,3}}(?:[,،٬][{DIGIT}]{{3}})+)")
_SEP_ALL_RE = re.compile(rf"[{DIGIT}]+(?:[,،٬][{DIGIT}]{{3}})+")
_PLAIN_RE = re.compile(rf"[{DIGIT}]{{4,}}")
_NON_DIGIT_RE = re.compile(rf"[^{DIGIT}]")
_NON_ASCII_DIGIT_RE = re.compile(r"[^0-9]")


def fa_digits_to_en(text: str) -> str:
    """اعداد فارسی/عربی → انگلیسی"""
    return str(text).translate(_DIGIT_MAP)


def normalize_text(text: str) -> str:
    """decode + فشرده‌سازیِ فاصله‌ها"""
    if not text:
        return ""
    out = html.unescape(str(text))
    out = re.sub(r"\s+", " ", out, flags=re.UNICODE)
    return out.strip()


def normalize_html(source: str) -> str:
    """حذفِ script/style سپس normalize_text"""
    if not source:
        return ""
    out = re.sub(r"<script[^>]*>.*?</script>", "", source, flags=re.IGNORECASE | re.DOTALL)
    out = re.sub(r"<style[^>]*>.*?</style>", "", out, flags=re.IGNORECASE | re.DOTALL)
    out = html.unescape(out)
    out = re.sub(r"\s+", " ", out, flags=re.UNICODE)
    return out.strip()


def price(text: str) -> str:
    """Legacy v10.640 extractPrice: preserve units and foreign decimals.

    This deliberately supersedes the older Laravel phase-1 number-only display
    contract. price_num remains the legacy digits-only integer comparison helper;
    extracting a foreign currency does NOT imply any currency conversion.
    """
    text = normalize_text(text)
    if not text:
        return ""
    best_value, best_len = "", 0
    for match in _UNIT_RE.finditer(text):
        length = len(_NON_DIGIT_RE.sub("", match.group(1)))
        if length > best_len:
            best_len = length
            best_value = (match.group(1) + " " + match.group(2)).strip()
    if best_value:
        return best_value

    currency = r"£|\$|€|¥|₽|₺|₹|﷼|USD|EUR|GBP|AED|TRY|CAD|AUD|CHF|JPY|CNY"
    number = (rf"[{DIGIT}]{{1,3}}(?:[,\s\u202f\u00a0][{DIGIT}]{{3}})+(?:[.٫][{DIGIT}]{{1,2}})?"
              rf"|[{DIGIT}]+(?:[.,٫][{DIGIT}]{{1,2}})?(?![{DIGIT}])")
    pattern = re.compile(rf"(?:({currency})\s*({number}))|(?:({number})\s*({currency}))", re.I)
    best_amount = -1.0
    for match in pattern.finditer(text):
        raw = match.group(2) or match.group(3)
        numeric = fa_digits_to_en(raw).replace('٫', '.')
        if '.' not in numeric and re.search(r',([0-9]{1,2})$', numeric):
            numeric = re.sub(r',([0-9]{1,2})$', r'.\1', numeric)
        numeric = re.sub(r'[,\s\u202f\u00a0]', '', numeric)
        try:
            amount = float(numeric)
        except ValueError:
            continue
        if amount > 0 and amount > best_amount:
            best_amount = amount
            best_value = normalize_text(match.group(0))
    if best_value:
        return best_value

    separated = re.findall(rf"[{DIGIT}]{{1,3}}(?:{_SEP}[{DIGIT}]{{3}})+", text)
    if separated:
        best = max(separated, key=lambda value: len(_NON_DIGIT_RE.sub('', value)))
        return best.strip() + ' تومان'
    plain = [value for value in _PLAIN_RE.findall(text) if int(fa_digits_to_en(value)) >= 1000]
    if plain:
        return max(plain, key=lambda value: int(fa_digits_to_en(value))) + ' تومان'
    return ''


def price_num(value) -> int:
    """extractPriceNum — عددِ خالصِ قیمت (بدونِ جداکننده، رقم‌های انگلیسی)"""
    s = _NON_ASCII_DIGIT_RE.sub("", fa_digits_to_en(str(value or "")))
    return int(s) if s else 0


def jdate(value=None) -> str:
    """تاریخِ شمسیِ کوتاه (معادلِ سبکِ jdate_fa در نسخهٔ قدیمی)."""
    from datetime import datetime, timezone

    dt = value or datetime.now(timezone.utc)
    if isinstance(dt, str):
        try:
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except ValueError:
            return dt
    try:
        import jdatetime  # اختیاری

        return jdatetime.datetime.fromgregorian(datetime=dt).strftime("%Y/%m/%d %H:%M")
    except Exception:
        return dt.strftime("%Y-%m-%d %H:%M")
