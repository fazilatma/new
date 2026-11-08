"""واکشِ هوشمند: ایستا یا رندرِ JS — با heuristicای که تصمیم می‌گیرد صفحه
«پوستهٔ JS» است یا محتوای واقعی دارد.

  mode = static : فقط واکشِ معمولی (رفتارِ فاز ۱)
  mode = js     : رندرِ همیشگی — اگر رندر ناموفق بود به واکشِ ایستا برمی‌گردیم
  mode = auto   : اول ایستا؛ اگر خروجی «پوستهٔ JS» تشخیص داده شد، یک بار رندر
"""
from __future__ import annotations

import re
from typing import Callable

from .fetch import HtmlFetcher
from .render import RenderedFetcher
from ...config import Settings, get_settings

_JS_ENABLE_RE = re.compile(
    r"(you need to enable javascript|javascript is required|please enable javascript"
    r"|جاوااسکریپت را (فعال|روشن)|لطفاً? جاوااسکریپت)",
    re.IGNORECASE | re.UNICODE,
)

_SHELL_CONTAINER_RE = re.compile(
    r"""<(div|main|section)[^>]+(?:id|class)=["'][^"']*(?:__next|__nuxt|app-root|ng-|id="root"|id="app"|\broot\b|\bapp\b)[^"']*["'][^>]*>\s*(?:<[^a/][^>]*>\s*){0,3}</(div|main|section)>""",
    re.IGNORECASE,
)

_SCRIPT_SRC_RE = re.compile(r"<script[^>]+src=", re.IGNORECASE)
_SPA_MARKER_RE = re.compile(
    r"(data-reactroot|window\.__NUXT__|ng-version|__NEXT_DATA__)", re.IGNORECASE
)
_HIDDEN_TAGS_RE = re.compile(
    r"<(script|style|noscript|template)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL
)
_TAG_RE = re.compile(r"<[^>]*>")


def looks_like_js_shell(html: str) -> bool:
    """تشخیصِ «پوستهٔ JS»: صفحه‌ای که فقط اسکلتِ اپ را دارد و محتوایش با
    جاوااسکریپت ساخته می‌شود (محافظ‌کار تا رندرهای اضافیِ ۱۵-۶۰ثانیه‌ای)."""
    if not html:
        return False
    # صفحهٔ واقعاً کوچک: قضاوتِ قطعی نکن (می‌تواند صفحهٔ سادهٔ واقعی باشد)
    if len(html.encode("utf-8")) < 1500:
        return False

    visible = _HIDDEN_TAGS_RE.sub(" ", html)
    visible = _TAG_RE.sub("", visible).strip()
    visible_len = len(re.sub(r"\s+", " ", visible))

    if visible_len >= 400:
        return False

    # نشانهٔ ۱: متنِ راهنمای «جاوااسکریپت را روشن کنید»
    if _JS_ENABLE_RE.search(html):
        return True

    # نشانهٔ ۲: ظرفِ خالیِ رایجِ SPA + متنِ خیلی کم
    if _SHELL_CONTAINER_RE.search(html):
        return True

    # نشانهٔ ۳: نسبتِ اسکریپت به متن — تودهٔ JS با متنِ تقریباً صفر
    if visible_len < 120 and len(_SCRIPT_SRC_RE.findall(html)) >= 2:
        if _SPA_MARKER_RE.search(html):
            return True

    return False


class SmartFetcher:
    @staticmethod
    def get(url: str, timeout: int = 25, net: dict | None = None,
            mode: str = "auto", render_opts: dict | None = None,
            static_fetcher: Callable | None = None,
            render_fetcher: Callable | None = None,
            settings: Settings | None = None) -> dict:
        settings = settings or get_settings()
        net = net if net is not None else settings.net
        render_opts = render_opts or {}

        static_fetcher = static_fetcher or (
            lambda u, t, n: HtmlFetcher.get(u, timeout=t, net=n, settings=settings)
        )
        render_fetcher = render_fetcher or (
            lambda u, o: RenderedFetcher.get(u, o, settings=settings)
        )

        mode = mode or settings.render.default_mode or "auto"

        if mode in ("js", "render"):
            rendered = render_fetcher(url, render_opts)
            if rendered.get("ok"):
                return rendered
            static = static_fetcher(url, timeout, net)
            static["render_error"] = str(rendered.get("error") or "")
            return static

        if mode == "static":
            return static_fetcher(url, timeout, net)

        # auto
        static = static_fetcher(url, timeout, net)
        if static.get("ok") and looks_like_js_shell(str(static.get("html") or "")):
            html_was = len(str(static.get("html") or ""))
            rendered = render_fetcher(url, render_opts)
            if rendered.get("ok") and len(str(rendered.get("html") or "")) > html_was:
                rendered["js_shell_detected"] = True
                return rendered
            static["js_shell_detected"] = True
            static["render_error"] = str(rendered.get("error") or "")
        return static


def get(url: str, timeout: int = 25, net=None, mode: str = "auto",
        render_opts: dict | None = None, settings: Settings | None = None) -> dict:
    return SmartFetcher.get(url, timeout=timeout, net=net, mode=mode,
                            render_opts=render_opts, settings=settings)
