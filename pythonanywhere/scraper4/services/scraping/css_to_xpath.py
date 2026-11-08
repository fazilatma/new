"""پورتِ وفادارِ cssToXpath() / cssStepToXpath() / xpClassCond() / xpLit()
از scraper4.php (شاملِ اصلاحاتِ v9.85..v9.87 و v8.56).

  • گروهِ کامایی: هر شاخه جدا ترجمه و با | وصل می‌شود
  • ترکیب‌گرِ فرزندی « > » پشتیبانی می‌شود؛ « + » و « ~ » نه (سلکتور باطل)
  • تحلیل‌گرِ گام: tag / .class / #id / [attr] / [attr=val] / [*=] / [^=] / [$=]
    و شبه‌کلاس‌های nth-child(n) / first-child / last-child
  • strict_class: تطبیقِ کلاسِ دقیق (بین دو فاصله) مثل مرورگر، وگرنه contains
"""
from __future__ import annotations

import re

_STEP_TAG_RE = re.compile(r"^([A-Za-z][\w-]*)")
_CLASS_RE = re.compile(r"^\.([\w-]+)")
_ID_RE = re.compile(r"^#([\w:-]+)")
_ATTR_RE = re.compile(r"^\s*([\w:.-]+)\s*(?:([*^$]?=)\s*(.*?))?\s*$", re.DOTALL)
_NTH_RE = re.compile(r"^::?nth-child\((\d+)\)")
_FIRST_RE = re.compile(r"^::?first-child")
_LAST_RE = re.compile(r"^::?last-child")
_WS_GT_RE = re.compile(r"\s*>\s*")


def css_to_xpath(css: str, strict_class: bool = False) -> str:
    css = (css or "").strip()
    if css == "":
        return ""

    # گروه: هر شاخه جدا ترجمه و با | به هم وصل می‌شود
    if "," in css:
        out: list[str] = []
        for branch in css.split(","):
            branch = branch.strip()
            if branch == "":
                continue
            one = css_to_xpath(branch, strict_class)
            if one == "":
                return ""   # یک شاخهٔ نامفهوم کلِ گروه را باطل می‌کند
            out.append(one)
        return " | ".join(out)

    # + و ~ پشتیبانی نمی‌شوند
    if re.search(r"[+~]", css):
        return ""

    norm = _WS_GT_RE.sub(" > ", css)
    tokens = [t for t in re.split(r"\s+", norm.strip()) if t]
    if not tokens:
        return ""

    xpath = ""
    axis = "//"
    for tok in tokens:
        if tok == ">":
            axis = "/"
            continue
        step_xpath = _step(tok, strict_class)
        if step_xpath == "":
            return ""
        xpath += axis + step_xpath
        axis = "//"
    return xpath


def class_cond(class_name: str, strict: bool) -> str:
    """شرطِ تطبیقِ کلاس — دقیق (مرورگری) یا شامل."""
    if strict:
        return ("contains(concat(' ',normalize-space(@class),' '),' "
                + class_name + " ')")
    return "contains(@class,'" + class_name + "')"


def literal(value: str) -> str:
    """لیترالِ امنِ XPath 1.0 (برای ' و " با concat)."""
    if "'" not in value:
        return "'" + value + "'"
    if '"' not in value:
        return '"' + value + '"'
    return "concat('" + value.replace("'", "',\"'\",'") + "')"


def _step(step: str, strict_class: bool) -> str:
    step = (step or "").strip()
    if step == "":
        return ""
    if step == "*":
        return "*"

    tag = "*"
    conds: list[str] = []
    i = 0
    length = len(step)

    m = _STEP_TAG_RE.match(step)
    if m:
        tag = m.group(1).lower()
        i = len(m.group(1))

    while i < length:
        rest = step[i:]
        ch = step[i]

        if ch == ".":
            m = _CLASS_RE.match(rest)
            if not m:
                return ""
            conds.append(class_cond(m.group(1), strict_class))
            i += len(m.group(0))
            continue

        if ch == "#":
            m = _ID_RE.match(rest)
            if not m:
                return ""
            conds.append("@id=" + literal(m.group(1)))
            i += len(m.group(0))
            continue

        if ch == "[":
            close = step.find("]", i)
            if close == -1:
                return ""
            inner = step[i + 1:close]
            i = close + 1
            m = _ATTR_RE.match(inner)
            if not m:
                return ""
            attr = "@" + m.group(1)
            op = m.group(2) or ""
            if op == "":
                conds.append(attr)
                continue
            value = (m.group(3) or "").strip()
            if len(value) >= 2 and value[0] in {'"', "'"} and value[0] == value[-1]:
                value = value[1:-1]
            lit = literal(value)
            if op == "=":
                conds.append(attr + "=" + lit)
            elif op == "*=":
                conds.append("contains(" + attr + "," + lit + ")")
            elif op == "^=":
                conds.append("starts-with(" + attr + "," + lit + ")")
            elif op == "$=":
                # XPath 1.0 ends-with ندارد؛ با substring ساخته می‌شود
                n = len(value)
                conds.append(
                    "substring(" + attr + ",string-length(" + attr + ")-"
                    + str(n - 1) + ")=" + lit
                )
            else:
                return ""
            continue

        if ch == ":":
            m = _NTH_RE.match(rest)
            if m:
                conds.append("count(preceding-sibling::*)=" + str(int(m.group(1)) - 1))
                i += len(m.group(0))
                continue
            m = _FIRST_RE.match(rest)
            if m:
                conds.append("count(preceding-sibling::*)=0")
                i += len(m.group(0))
                continue
            m = _LAST_RE.match(rest)
            if m:
                conds.append("count(following-sibling::*)=0")
                i += len(m.group(0))
                continue
            return ""   # :hover، :not(...) و بقیه — ترجمه نمی‌شوند

        return ""       # کاراکترِ ناشناخته

    return tag + "[" + " and ".join(conds) + "]" if conds else tag


# نامِ لاراولی برای خواناییِ فراخوانی‌ها
CssToXpath = css_to_xpath
