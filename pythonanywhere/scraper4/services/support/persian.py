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
    """extractPrice — بلندترین عددِ دارای واحد (تومان/ریال)، وگرنه عددِ
    جداکننده‌دار، وگرنه بلندترین عددِ ۴+ رقمی. خروجی رشته (مثل نسخهٔ قدیمی)."""
    text = normalize_text(text)
    if not text:
        return ""

    best_value = ""
    best_len = 0
    for match in _UNIT_RE.finditer(text):
        digits = _NON_DIGIT_RE.sub("", match.group(1))
        if len(digits) > best_len:
            best_len = len(digits)
            best_value = match.group(1).strip()
    if best_value:
        return best_value

    m = _SEP_GROUP_RE.search(text)
    if m:
        return m.group(1).strip()

    groups = _SEP_ALL_RE.findall(text)
    if groups:
        groups.sort(key=lambda s: len(_NON_DIGIT_RE.sub("", s)), reverse=True)
        return groups[0]

    plain = _PLAIN_RE.findall(text)
    if plain:
        plain.sort(key=len, reverse=True)
        return plain[0]

    return ""


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
