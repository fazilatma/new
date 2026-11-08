"""تنظیماتِ اپ — معادلِ متمرکزِ config/scraper.php در نسخهٔ لاراول.

همهٔ مقادیر از متغیرهای محیطی (و فایلِ .env کنارِ اپ) خوانده می‌شوند؛ روی
PythonAnywhere فقط یک فایلِ .env لازم است و هیچ چیزی نباید در کد هاردکد شود.

اگر python-dotenv نصب نباشد، همین‌جا یک خوانندهٔ سبکِ .env داریم تا اپ
بدونِ وابستگیِ اضافی هم بالا بیاید.
"""
from __future__ import annotations

import json
import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

APP_NAME = "scraper4-pythonanywhere"
VERSION = "1.18.0"

# ریشهٔ پروژه: پوشه‌ای که wsgi.py و .env در آن هستند (pythonanywhere/)
BASE_DIR = Path(os.environ.get("S4_BASE_DIR") or Path(__file__).resolve().parent.parent)


def _truthy(value: str | None, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on", "y"}


def _int(value: str | None, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def load_env_file(path: Path | str) -> dict[str, str]:
    """خواندنِ سادهٔ KEY=VALUE از .env (بدون وابستگی). مقادیرِ موجود در
    محیط اولویت دارند و بازنویسی نمی‌شوند."""
    loaded: dict[str, str] = {}
    p = Path(path)
    if not p.is_file():
        return loaded
    for raw in p.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        if key:
            loaded[key] = value
    # Last assignment in the file wins; the process environment still wins.
    for key, value in loaded.items():
        os.environ.setdefault(key, value)
    return loaded


@dataclass
class FetchNet:
    """پیکربندیِ راه‌عبور — همان رکوردِ src_net در connections.json قدیمی."""

    mode: str = "direct"          # direct | proxy | dns | doh | worker
    fallback: bool = False
    hosts: str = ""               # فیلترِ دامنه؛ خالی = همه
    gap_ms: int = 0               # فاصلهٔ ادب بین درخواست‌ها به یک هاست
    proxy: str = ""
    proxy_type: str = "http"      # http | socks5 | socks4
    proxy_auth: str = ""
    resolve_ip: str = ""
    doh_url: str = ""
    worker_url: str = ""
    ipv4: bool = False

    @classmethod
    def from_dict(cls, data: dict | None) -> "FetchNet":
        data = data or {}
        return cls(
            mode=str(data.get("mode") or "direct"),
            fallback=bool(data.get("fallback")),
            hosts=str(data.get("hosts") or ""),
            gap_ms=_int(data.get("gap_ms"), 0),
            proxy=str(data.get("proxy") or ""),
            proxy_type=str(data.get("proxy_type") or "http"),
            proxy_auth=str(data.get("proxy_auth") or ""),
            resolve_ip=str(data.get("resolve_ip") or ""),
            doh_url=str(data.get("doh_url") or ""),
            worker_url=str(data.get("worker_url") or ""),
            ipv4=bool(data.get("ipv4")),
        )

    def as_dict(self) -> dict:
        return {
            "mode": self.mode, "fallback": self.fallback, "hosts": self.hosts,
            "gap_ms": self.gap_ms, "proxy": self.proxy, "proxy_type": self.proxy_type,
            "proxy_auth": self.proxy_auth, "resolve_ip": self.resolve_ip,
            "doh_url": self.doh_url, "worker_url": self.worker_url, "ipv4": self.ipv4,
        }


@dataclass
class RenderSettings:
    url: str = ""                 # سرویس رندر (browser/ روی Node)
    token: str = ""
    timeout_ms: int = 60000
    wait_until: str = "domcontentloaded"
    scroll: bool = False
    default_mode: str = "static"  # static | auto | js


@dataclass
class Settings:
    base_dir: Path = field(default_factory=lambda: BASE_DIR)
    db_path: Path = field(default_factory=lambda: BASE_DIR / "data" / "scraper4.sqlite3")
    secret_key: str = ""
    password: str = ""            # required; plaintext or Werkzeug password hash
    timezone: str = "Asia/Tehran"

    fetch_timeout: int = 25
    connect_timeout: int = 10
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
    net: FetchNet = field(default_factory=FetchNet)
    render: RenderSettings = field(default_factory=RenderSettings)

    basalam_api_base: str = "https://openapi.basalam.com/v1/"
    basalam_categories_ttl: int = 86400
    woo_verify_ssl: bool = True

    max_pages: int = 20
    auto_extract_minutes: int = 0     # 0 = خاموش (استخراجِ دوره‌ای)
    tick_budget_seconds: int = 240    # سقفِ زمانِ هر تیک
    worker_stale_seconds: int = 900   # ردیفِ running بدونِ نبض → بازگشت به صف

    @classmethod
    def load(cls, env_path: Path | str | None = None) -> "Settings":
        env_path = Path(env_path or os.environ.get("S4_ENV_FILE") or (BASE_DIR / ".env"))
        load_env_file(env_path)
        return cls.from_env()

    @classmethod
    def from_env(cls) -> "Settings":
        base = Path(os.environ.get("S4_BASE_DIR") or BASE_DIR)
        data_dir = Path(os.environ.get("S4_DATA_DIR") or (base / "data"))

        try:
            net_cfg = json.loads(os.environ.get("S4_NET_JSON") or "{}")
            if not isinstance(net_cfg, dict):
                net_cfg = {}
        except json.JSONDecodeError:
            net_cfg = {}

        return cls(
            base_dir=base,
            db_path=Path(os.environ.get("S4_DB") or (data_dir / "scraper4.sqlite3")),
            secret_key=os.environ.get("S4_SECRET_KEY") or "",
            password=os.environ.get("S4_PASSWORD") or "",
            timezone=os.environ.get("S4_TIMEZONE") or "Asia/Tehran",
            fetch_timeout=_int(os.environ.get("SCRAPER_FETCH_TIMEOUT"), 25),
            connect_timeout=_int(os.environ.get("SCRAPER_CONNECT_TIMEOUT"), 10),
            user_agent=os.environ.get("SCRAPER_USER_AGENT")
            or ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
            net=FetchNet(
                mode=os.environ.get("S4_NET_MODE") or net_cfg.get("mode", "direct"),
                fallback=_truthy(os.environ.get("S4_NET_FALLBACK"), bool(net_cfg.get("fallback"))),
                hosts=os.environ.get("S4_NET_HOSTS") or str(net_cfg.get("hosts") or ""),
                gap_ms=_int(os.environ.get("SCRAPER_GAP_MS"), int(net_cfg.get("gap_ms") or 0)),
                proxy=os.environ.get("S4_PROXY") or str(net_cfg.get("proxy") or ""),
                proxy_type=os.environ.get("S4_PROXY_TYPE") or str(net_cfg.get("proxy_type") or "http"),
                proxy_auth=os.environ.get("S4_PROXY_AUTH") or str(net_cfg.get("proxy_auth") or ""),
                resolve_ip=os.environ.get("S4_RESOLVE_IP") or str(net_cfg.get("resolve_ip") or ""),
                doh_url=os.environ.get("S4_DOH_URL") or str(net_cfg.get("doh_url") or ""),
                worker_url=os.environ.get("S4_WORKER_URL") or str(net_cfg.get("worker_url") or ""),
                ipv4=_truthy(os.environ.get("S4_NET_IPV4"), bool(net_cfg.get("ipv4"))),
            ),
            render=RenderSettings(
                url=os.environ.get("SCRAPER_RENDER_URL") or "",
                token=os.environ.get("SCRAPER_RENDER_TOKEN") or "",
                timeout_ms=_int(os.environ.get("SCRAPER_RENDER_TIMEOUT_MS"), 60000),
                wait_until=os.environ.get("SCRAPER_RENDER_WAIT_UNTIL") or "domcontentloaded",
                scroll=_truthy(os.environ.get("SCRAPER_RENDER_SCROLL"), False),
                default_mode=os.environ.get("SCRAPER_RENDER_MODE") or "static",
            ),
            basalam_api_base=os.environ.get("BASALAM_API_BASE") or "https://openapi.basalam.com/v1/",
            basalam_categories_ttl=_int(os.environ.get("BASALAM_CATEGORIES_TTL"), 86400),
            woo_verify_ssl=_truthy(os.environ.get("SCRAPER_VERIFY_SSL"), True),
            max_pages=_int(os.environ.get("S4_MAX_PAGES"), 20),
            auto_extract_minutes=_int(os.environ.get("S4_AUTO_EXTRACT_MINUTES"), 0),
            tick_budget_seconds=_int(os.environ.get("S4_TICK_BUDGET_SECONDS"), 240),
            worker_stale_seconds=_int(os.environ.get("S4_WORKER_STALE_SECONDS"), 900),
        )

    # ------------------------------------------------------------------ کمکی

    def ensure_dirs(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        (self.base_dir / "logs").mkdir(parents=True, exist_ok=True)

    def ensure_secret(self) -> str:
        """اگر S4_SECRET_KEY ست نشده باشد، یک کلید تولید و در .env ذخیره می‌شود
        (تا رازها بینِ ری‌استارت‌ها پایدار بمانند)."""
        if self.secret_key:
            return self.secret_key
        env_file = Path(os.environ.get("S4_ENV_FILE") or self.base_dir / ".env")
        key = secrets.token_urlsafe(48)
        with env_file.open("a", encoding="utf-8") as fh:
            fh.write(f"\nS4_SECRET_KEY={key}\n")
        env_file.chmod(0o600)
        self.secret_key = key
        return key


_settings: Settings | None = None


def get_settings(reload: bool = False) -> Settings:
    global _settings
    if _settings is None or reload:
        _settings = Settings.load()
        _settings.ensure_dirs()
        _settings.ensure_secret()
    return _settings


def set_settings(value: Settings) -> None:
    """برای تست‌ها و CLI."""
    global _settings
    _settings = value
