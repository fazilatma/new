"""
Local AI runtime manager & Ollama installer for Agent Python.
Parity with agent-php/app/LocalAI.php.
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import tarfile
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .config import DATA_DIR
from .database import get_state, set_state, get_state_json, set_state_json
from .providers import ModelSpec, Provider, PROVIDER_STORE

logger = logging.getLogger("arena.local_ai")

DEFAULT_HOST = "http://127.0.0.1:11434"
REGISTRY = "https://registry.ollama.ai"
HF_API = "https://huggingface.co/api/models"

BPW = {
    "Q2_K": 2.6, "Q3_K_M": 3.9, "Q4_0": 4.5, "Q4_K_M": 4.85,
    "Q5_K_M": 5.7, "Q6_K": 6.6, "Q8_0": 8.5, "F16": 16.0,
}

RUNTIME_OVERHEAD_GB = 0.6
WEIGHT_RAM_FACTOR = 1.08

# Preference order used to pick a sane default quantisation out of whatever
# a Hugging Face repo actually ships (mirrors agent-php/app/LocalAI.php).
QUANT_PRIORITY = [
    "Q4_K_M", "Q4_K_S", "Q4_0", "Q4_1", "Q5_K_M", "Q5_K_S", "Q5_0", "Q5_1",
    "Q6_K", "Q8_0", "Q3_K_M", "Q3_K_S", "Q3_K_L", "Q2_K", "IQ4_XS", "IQ4_NL",
    "IQ3_XS", "F16", "BF16", "F32",
]

# File extensions the drive scanner looks for.
SCAN_EXTENSIONS = ["gguf", "ggml", "safetensors", "bin"]

# Directory names the drive scanner never descends into.
SCAN_EXCLUDE_NAMES = [
    "proc", "sys", "dev", "run", "node_modules", ".git", ".cache", "__pycache__",
    ".venv", "venv", ".npm", ".cargo", ".rustup", ".next", ".nuxt", "dist", "build",
    ".Trash", "$RECYCLE.BIN",
]


def root_dir() -> Path:
    env_dir = os.environ.get("AGENT_LOCALAI_DIR") or str(DATA_DIR / "localai")
    p = Path(env_dir)
    try:
        p.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(str(p), 0o775)
        except Exception:
            pass
    except Exception:
        pass
    return p


def models_dir() -> Path:
    env_dir = os.environ.get("OLLAMA_MODELS") or str(root_dir() / "models")
    p = Path(env_dir)
    try:
        p.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(str(p), 0o775)
        except Exception:
            pass
    except Exception:
        pass
    return p


def is_dir_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    if not probe.exists():
        return False
    try:
        test_file = probe / f".probe_{os.getpid()}_{int(time.time()*1000)}"
        test_file.write_text("1")
        test_file.unlink(missing_ok=True)
        return True
    except Exception:
        try:
            os.chmod(str(probe), 0o775)
            test_file = probe / f".probe_{os.getpid()}_{int(time.time()*1000)}"
            test_file.write_text("1")
            test_file.unlink(missing_ok=True)
            return True
        except Exception:
            return os.access(str(probe), os.W_OK | os.X_OK)


def fix_permissions() -> Dict[str, Any]:
    md = models_dir()
    rd = root_dir()
    errors = []
    for d in [DATA_DIR, rd, md, rd / "bin"]:
        try:
            d.mkdir(parents=True, exist_ok=True)
            try:
                os.chmod(str(d), 0o775)
            except Exception:
                try:
                    os.chmod(str(d), 0o755)
                except Exception as e2:
                    errors.append(f"{d}: {str(e2)}")
        except Exception as e:
            errors.append(f"{d}: {str(e)}")
    writable = is_dir_writable(md)
    return {
        "ok": writable,
        "modelsDir": str(md),
        "modelsDirWritable": writable,
        "errors": errors if not writable else [],
    }


def bin_dir() -> Path:
    p = root_dir() / "bin"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _ldd_output(path: str) -> Optional[str]:
    """Run `ldd` on a binary and return its combined stdout+stderr, or None
    if `ldd` isn't available / the check itself failed to run."""
    ldd = shutil.which("ldd")
    if not ldd:
        return None
    try:
        res = subprocess.run([ldd, path], capture_output=True, text=True, timeout=5)
        return f"{res.stdout}\n{res.stderr}"
    except Exception:
        return None


def _binary_is_healthy(path: str) -> bool:
    """A binary can sit on disk with the executable bit set and still be
    completely unusable -- e.g. llama.cpp's release builds are dynamically
    linked against libllama.so/libggml*.so shipped alongside llama-server in
    the same archive folder (found via the executable's $ORIGIN rpath). If
    only the llama-server file itself ever got copied out of that archive
    (as a previous version of install_runtime() did), every launch fails
    immediately with "error while loading shared libraries: libllama.so:
    cannot open shared object file" -- and because the file is still present
    and +x, callers that only check os.path.isfile()/os.access() keep
    treating it as "already installed" forever, so the breakage never heals
    itself. Use `ldd` (cheap, a few ms) to actually verify every shared
    library the binary depends on can be resolved before trusting it.
    """
    combined = _ldd_output(path)
    if combined is None:
        return True  # can't verify on this system; assume OK rather than loop-reinstalling
    return "not found" not in combined


_GLIBC_VERSION_RE = re.compile(r"version `(GLIBC(?:XX|_[A-Z]+)?_[0-9][0-9.]*)' not found")


def _detect_abi_version_mismatch(combined_text):
    """Scan arbitrary dynamic-linker/`ldd` output -- or a captured crash log,
    e.g. the tail of ollama.log/llamacpp.log -- for the tell-tale

      llama-server: /lib64/libstdc++.so.6: version `GLIBCXX_3.4.29' not
      found (required by .../libggml-rpc.so)

    signature and return the missing symbol version, or None if the text
    doesn't match that pattern. Shared by both the proactive `ldd`-based
    checks (_binary_abi_incompatibility_reason()/_ollama_runner_abi_reason())
    and the reactive scan of a failed Test's engine log in benchmark_test(),
    so a crash is explained the same way everywhere it's detected.
    """
    if not combined_text:
        return None
    m = _GLIBC_VERSION_RE.search(combined_text)
    return m.group(1) if m else None


def _abi_incompatibility_message(missing_version: str, engine: str) -> str:
    """Build the actionable, user-facing Persian explanation for an ABI
    incompatibility -- worded for *which* binary is actually affected.
    Recommending "use Ollama instead" (the llama.cpp-engine wording) would
    be actively wrong/misleading when it's Ollama's own bundled runner that
    turned out to be incompatible, since Ollama ships that exact kind of
    prebuilt llama-server binary too (see _ollama_runner_abi_reason()).
    """
    if engine == "ollama":
        return (
            f"سیستم‌عامل این سرور میزبان نسخه‌ی قدیمی‌تری از کتابخانه‌های پایه (glibc/libstdc++) دارد و "
            f"باینری داخلی llama-server که خودِ Ollama برای اجرای واقعی مدل‌ها استفاده می‌کند، به نسخه‌ی جدیدتری "
            f"({missing_version}) نیاز دارد که روی این سرور موجود نیست. این یک تنظیم اشتباه در این برنامه نیست؛ "
            f"نصب دوباره‌ی Ollama هم این مشکل را حل نمی‌کند، چون نسخه‌ی رسمی Ollama همیشه همین نیاز نسخه را خواهد داشت. "
            f"راه‌حل‌های پیشنهادی: "
            f"۱) از پشتیبانی هاست خود بخواهید سیستم‌عامل/glibc سرور را به‌روزرسانی کند، "
            f"۲) یک نسخه‌ی قدیمی‌تر Ollama را امتحان کنید (برخی نسخه‌های قدیمی‌تر ممکن است با glibc قدیمی‌تری ساخته شده باشند)، "
            f"۳) اگر ابزارهای کامپایل (gcc/g++/cmake) روی سرور موجود است، Ollama را از سورس روی همین سرور بسازید."
        )
    return (
        f"سیستم‌عامل این سرور میزبان نسخه‌ی قدیمی‌تری از کتابخانه‌های پایه (glibc/libstdc++) دارد و "
        f"باینری رسمی llama.cpp به نسخه‌ی جدیدتری ({missing_version}) نیاز دارد که روی این سرور موجود نیست. "
        f"نصب دوباره یا تلاش مجدد این مشکل را حل نمی‌کند، چون باینری دانلودی همیشه همین نیاز نسخه را خواهد داشت. "
        f"راه‌حل‌های پیشنهادی: "
        f"۱) برای این مدل از موتور Ollama استفاده کنید (سازگاری بسیار بیشتری با سیستم‌عامل‌های قدیمی دارد)، "
        f"۲) از پشتیبانی هاست خود بخواهید سیستم‌عامل/glibc سرور را به‌روزرسانی کند، "
        f"۳) اگر ابزارهای کامپایل (gcc/g++/cmake) روی سرور موجود است، یک نسخه‌ی llama-server سفارشی از سورس بسازید و "
        f"مسیر آن را در تنظیمات Local AI (AGENT_LLAMACPP_BIN) وارد کنید."
    )


def _binary_abi_incompatibility_reason(path: str):
    """Detect the specific, unfixable-by-reinstalling failure mode where a
    prebuilt binary needs a newer glibc/libstdc++ symbol version than this
    host's own operating system ships -- very common on older hosting-panel
    environments (e.g. a CentOS/RHEL-based panel) that llama.cpp's official
    Ubuntu release builds were never built to run on.

    Unlike a plain missing shared library (fixed by re-extracting the whole
    archive, see _binary_is_healthy() above), redownloading and
    reinstalling the exact same official binary reproduces this identical
    failure every single time -- it is a fundamental incompatibility
    between that prebuilt binary and the host OS, not a broken/incomplete
    install, so auto-repair-by-reinstalling must never be attempted for it.
    Returns a short, actionable, user-facing explanation if incompatible,
    else None.
    """
    missing_version = _detect_abi_version_mismatch(_ldd_output(path))
    if not missing_version:
        return None
    return _abi_incompatibility_message(missing_version, "llamacpp")


def _ollama_runner_abi_reason(ollama_lib_dir: Path):
    """Same check as _binary_abi_incompatibility_reason(), but for Ollama's
    OWN bundled llama-server-style runner under lib/ollama/ (see
    install_runtime()'s ollama branch) -- Ollama ships a prebuilt binary of
    the exact same kind, so it can be just as incompatible with an old
    host's glibc/libstdc++ as the standalone llama.cpp engine's build,
    independent of any PATH cross-contamination between the two engines.
    """
    if not ollama_lib_dir.is_dir():
        return None
    try:
        candidates = [
            p for p in ollama_lib_dir.rglob("*")
            if p.is_file() and not p.is_symlink() and os.access(str(p), os.X_OK) and "llama" in p.name.lower()
        ]
    except Exception:
        return None
    for candidate in candidates:
        missing_version = _detect_abi_version_mismatch(_ldd_output(str(candidate)))
        if missing_version:
            return _abi_incompatibility_message(missing_version, "ollama")
    return None


def binary(engine: Optional[str] = None) -> Optional[str]:
    active_engine = engine or get_state("localai:engine") or "ollama"

    if active_engine == "llamacpp":
        custom = os.environ.get("AGENT_LLAMACPP_BIN") or get_state("localai:llamacpp_bin")
        if custom and os.path.isfile(custom) and os.access(custom, os.X_OK):
            return custom
        candidates = [
            str(bin_dir() / "llama-server"),
            str(bin_dir() / "llama-cli"),
            str(root_dir() / "llama-server"),
            "/usr/local/bin/llama-server",
            "/usr/bin/llama-server",
            "/opt/llama.cpp/llama-server",
            str(Path.home() / ".local/bin/llama-server"),
        ]
        for p in candidates:
            if os.path.isfile(p) and os.access(p, os.X_OK):
                return p
        system = shutil.which("llama-server") or shutil.which("llama-cli")
        if system and os.path.isfile(system) and os.access(system, os.X_OK):
            return system
        return None

    # Default: Ollama
    custom = os.environ.get("AGENT_OLLAMA_BIN") or get_state("localai:custom_bin")
    if custom and os.path.isfile(custom) and os.access(custom, os.X_OK):
        return custom
    local = str(bin_dir() / "ollama")
    if os.path.isfile(local) and os.access(local, os.X_OK):
        return local
    cand_root = str(root_dir() / "ollama")
    if os.path.isfile(cand_root) and os.access(cand_root, os.X_OK):
        return cand_root
    cand_root_bin = str(root_dir() / "bin" / "ollama")
    if os.path.isfile(cand_root_bin) and os.access(cand_root_bin, os.X_OK):
        return cand_root_bin
    standard = ["/usr/local/bin/ollama", "/usr/bin/ollama", "/opt/ollama/bin/ollama", str(Path.home() / ".local/bin/ollama")]
    for p in standard:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    system = shutil.which("ollama")
    if system and os.path.isfile(system) and os.access(system, os.X_OK):
        return system
    return None


def host_url() -> str:
    custom = (
        os.environ.get("AGENT_LOCALAI_HOST")
        or os.environ.get("OLLAMA_HOST")
        or os.environ.get("OLLAMA_BASE_URL")
        or get_state("localai:custom_host")
    )
    if custom:
        h = str(custom).strip()
        if not h.startswith("http://") and not h.startswith("https://"):
            h = f"http://{h}"
        return h.rstrip("/")
    return DEFAULT_HOST


def _usable_home_dir() -> str:
    """Return a HOME directory guaranteed to exist and be writable.

    Several hosting-panel/process-manager launchers start this server with
    no $HOME at all (or one that doesn't exist / isn't writable under the
    service account actually running it). The ollama/llama.cpp binaries are
    Go/C++ programs that call os.UserHomeDir() during startup (e.g. to create
    ~/.ollama's local identity key) and hard-fail with exactly
    "Error: $HOME is not defined" when it's missing — regardless of whatever
    OLLAMA_MODELS/working directory this app has already configured. Always
    fall back to a real, writable directory under our own data dir so local
    AI model installs never depend on the parent process's environment.
    """
    home_dir = os.environ.get("HOME")
    if home_dir and os.path.isdir(home_dir) and os.access(home_dir, os.W_OK):
        return home_dir
    fallback_home = root_dir() / "home"
    try:
        fallback_home.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(fallback_home)


def server_env(overrides: Optional[Dict[str, str]] = None, engine: Optional[str] = None) -> Dict[str, str]:
    engine = engine or get_state("localai:engine") or "ollama"
    env = os.environ.copy()
    defaults = {
        "HOME": _usable_home_dir(),
        "OLLAMA_MODELS": str(models_dir()),
        "OLLAMA_HOST": host_url().replace("http://", "").replace("https://", ""),
        "OLLAMA_KEEP_ALIVE": os.environ.get("OLLAMA_KEEP_ALIVE", "10m"),
        "OLLAMA_MAX_LOADED_MODELS": os.environ.get("OLLAMA_MAX_LOADED_MODELS", "1"),
        "OLLAMA_NUM_PARALLEL": os.environ.get("OLLAMA_NUM_PARALLEL", "1"),
        "OLLAMA_FLASH_ATTENTION": os.environ.get("OLLAMA_FLASH_ATTENTION", "1"),
        "OLLAMA_KV_CACHE_TYPE": os.environ.get("OLLAMA_KV_CACHE_TYPE", "q8_0"),
    }
    if engine == "llamacpp":
        # Defense-in-depth for llama-server, which is dynamically linked
        # against libllama.so/libggml*.so normally resolved via its own
        # $ORIGIN rpath (same folder as the binary). If that ever doesn't
        # hold -- a different build, a binary moved after extraction, etc. --
        # the dynamic linker still finds the libraries we keep in bin_dir().
        defaults["PATH"] = f"{bin_dir()}:{env.get('PATH', '')}"
        defaults["LD_LIBRARY_PATH"] = f"{bin_dir()}:{env.get('LD_LIBRARY_PATH', '')}".rstrip(":")
    else:
        # Ollama bundles its *own* llama-server-style runner (a separate,
        # matching-glibc-target build) under lib/ollama/ next to its own
        # binary, which it resolves via its own internal, relative-path
        # discovery -- never via PATH. Putting bin_dir() on PATH/
        # LD_LIBRARY_PATH here too (as this used to do unconditionally) is
        # actively harmful on a host where the llama.cpp engine was *also*
        # installed: if Ollama's own runner can't be found for any reason
        # it falls back to whatever "llama-server" it finds on PATH, which
        # would then be the llama.cpp engine's own (differently built, and
        # on older hosts often ABI-incompatible) binary instead of its own
        # -- producing the exact same generic "llama-server process has
        # terminated: exit status 1" crash, just for the wrong reason.
        pass
    env.update(defaults)
    if overrides:
        env.update(overrides)
    return env


def _http_probe(url: str, timeout: float = 4.0) -> bool:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ArenaAgent/3.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _describe_http_error(e: Exception) -> str:
    """Turn a urllib exception into the most useful message we can show the
    user, instead of the bare, generic HTTP reason phrase.

    `str(urllib.error.HTTPError)` renders as e.g. "HTTP Error 500: Internal
    Server Error" -- that "Internal Server Error" is just the generic text
    for the status *code*, not anything Ollama/llama.cpp actually said. Both
    engines put the real, actionable diagnosis (e.g. "model requires more
    system memory than is available", "llama runner process has
    terminated: exit status 2", an out-of-VRAM message, etc.) in the
    response *body*, which str() on the exception silently discards. This
    reads that body (JSON `{"error": ...}` shape if present, else raw text)
    and appends it so the real cause is visible instead of a useless
    generic "Internal Server Error".
    """
    if isinstance(e, urllib.error.HTTPError):
        try:
            raw = e.read()
            body = raw.decode("utf-8", errors="replace").strip() if raw else ""
        except Exception:
            body = ""
        detail = ""
        if body:
            try:
                parsed = json.loads(body)
                if isinstance(parsed, dict):
                    detail = str(parsed.get("error") or parsed.get("message") or parsed.get("detail") or "").strip()
            except Exception:
                pass
            if not detail:
                detail = body[:500]
        if detail:
            return f"HTTP {e.code} {e.reason}: {detail}"
        return f"HTTP {e.code}: {e.reason}"
    return str(e) or type(e).__name__


def server_up(engine: Optional[str] = None) -> Dict[str, Any]:
    engine = engine or get_state("localai:engine") or "ollama"
    if engine == "llamacpp":
        # llama-server exposes /health on recent builds; fall back to the
        # OpenAI-compatible /v1/models route for older ones.
        if _http_probe(f"{host_url()}/health", 4.0) or _http_probe(f"{host_url()}/v1/models", 4.0):
            return {"up": True, "version": "", "host": host_url(), "error": ""}
        return {"up": False, "version": "", "host": host_url(), "error": ""}

    url = f"{host_url()}/api/version"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ArenaAgent/3.0"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {"up": True, "version": data.get("version", ""), "host": host_url(), "error": ""}
    except urllib.error.URLError:
        return {"up": False, "version": "", "host": host_url(), "error": ""}
    except Exception:
        return {"up": False, "version": "", "host": host_url(), "error": ""}


def host_scan(refresh: bool = False) -> Dict[str, Any]:
    total_ram_gb = 8.0
    avail_ram_gb = 4.0
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    total_ram_gb = round(int(line.split()[1]) / (1024 * 1024), 2)
                elif line.startswith("MemAvailable:"):
                    avail_ram_gb = round(int(line.split()[1]) / (1024 * 1024), 2)
    except Exception:
        pass

    cores = os.cpu_count() or 4
    avx2 = False
    try:
        with open("/proc/cpuinfo", "r", encoding="utf-8") as f:
            content = f.read()
            if "avx2" in content or "avx" in content:
                avx2 = True
    except Exception:
        pass

    # Disk
    free_disk_gb = 20.0
    try:
        stat = shutil.disk_usage(str(root_dir()))
        free_disk_gb = round(stat.free / (1024 ** 3), 2)
    except Exception:
        pass

    # GPU
    gpus = []
    nvidia_smi = shutil.which("nvidia-smi")
    if nvidia_smi:
        try:
            res = subprocess.run([nvidia_smi, "--query-gpu=name,memory.total,memory.free", "--format=csv,noheader,nounits"],
                                 capture_output=True, text=True, timeout=3)
            if res.returncode == 0 and res.stdout.strip():
                for line in res.stdout.strip().splitlines():
                    parts = [p.strip() for p in line.split(",")]
                    if len(parts) >= 3:
                        gpus.append({
                            "name": parts[0],
                            "vramTotalGb": round(float(parts[1]) / 1024, 2),
                            "vramFreeGb": round(float(parts[2]) / 1024, 2),
                            "vendor": "nvidia",
                        })
        except Exception:
            pass

    runtime_bin = binary()
    srv = server_up()

    suggested_ram = max(1.0, round(avail_ram_gb * 0.85, 1))

    return {
        "host": {
            "os": platform.system(),
            "arch": platform.machine(),
            "cpu": {
                "cores": cores,
                "avx2": avx2,
            },
            "memory": {
                "totalGb": total_ram_gb,
                "availableGb": avail_ram_gb,
                "suggestedBudgetGb": suggested_ram,
            },
            "disk": {
                "freeGb": free_disk_gb,
                "path": str(root_dir()),
            },
            "gpu": gpus,
        },
        "runtime": {
            "installed": bool(runtime_bin),
            "binary": runtime_bin or "",
            "managed": bool(runtime_bin and str(bin_dir()) in str(runtime_bin)),
            "running": srv["up"],
            "version": srv.get("version", ""),
            "host": host_url(),
            "modelsDir": str(models_dir()),
            "modelsDirWritable": is_dir_writable(models_dir()),
            "error": "" if srv["up"] else str(srv.get("error", "")),
        }
    }


def runtime_status() -> Dict[str, Any]:
    active_engine = get_state("localai:engine") or "ollama"
    ollama_bin = binary("ollama")
    llama_bin = binary("llamacpp")
    current_bin = binary(active_engine) or binary()
    srv = server_up(active_engine)
    md = models_dir()
    return {
        "engine": active_engine,
        "engines": {
            "ollama": {
                "name": "Ollama",
                "installed": bool(ollama_bin),
                "binary": ollama_bin or "",
                "managed": bool(ollama_bin and str(bin_dir()) in str(ollama_bin)),
            },
            "llamacpp": {
                "name": "llama.cpp (llama-server)",
                "installed": bool(llama_bin),
                "binary": llama_bin or "",
                "managed": bool(llama_bin and str(bin_dir()) in str(llama_bin)),
            },
            "custom": {
                "name": "Custom / Remote Host",
                "installed": True,
                "binary": "",
                "managed": False,
            },
        },
        "installed": bool(current_bin),
        "binary": current_bin or "",
        "managed": bool(current_bin and str(bin_dir()) in str(current_bin)),
        "running": srv["up"],
        "version": srv.get("version", ""),
        "host": host_url(),
        "modelsDir": str(md),
        "modelsDirWritable": is_dir_writable(md),
        "error": "" if srv["up"] else str(srv.get("error", "")),
        "env": server_env(),
    }


def ollama_lib_dir() -> Path:
    return root_dir() / "lib" / "ollama"


def _runtime_is_healthy(path: str, engine: str) -> bool:
    """_binary_is_healthy(), extended for the ollama engine: the `ollama`
    executable itself can be perfectly healthy (it's a near-static Go
    binary with minimal deps of its own) while the separate lib/ollama/
    directory holding its *own* bundled llama-server-style runner -- the
    thing that actually loads and serves every model -- is missing (e.g.
    an install made before this directory started being preserved, see
    install_runtime()'s ollama branch). That leaves `ollama serve` running
    and reporting itself as installed/up while every single model load
    fails, so it must count as "unhealthy" too and trigger a repair.
    """
    if not _binary_is_healthy(path):
        return False
    if engine == "ollama":
        lib_dir = ollama_lib_dir()
        try:
            return lib_dir.is_dir() and any(lib_dir.iterdir())
        except Exception:
            return False
    return True


def install_runtime(engine: str = "ollama", log_fn: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    engine = engine.strip().lower() if engine else "ollama"
    b = binary(engine)
    if b and _runtime_is_healthy(b, engine):
        return {"ok": True, "alreadyInstalled": True, "binary": b, "engine": engine}
    if b and not _runtime_is_healthy(b, engine):
        abi_reason = _binary_abi_incompatibility_reason(b)
        if not abi_reason and engine == "ollama":
            abi_reason = _ollama_runner_abi_reason(ollama_lib_dir())
        if abi_reason:
            # Redownloading would just fetch the identical, still-incompatible
            # official binary -- don't loop-reinstall forever on every single
            # activation attempt; surface the real, actionable explanation now.
            raise RuntimeError(abi_reason)
        # Broken leftover install (e.g. missing shared libraries, or --
        # for ollama -- a missing lib/ollama runner directory) -- remove it
        # so the extraction step below is guaranteed to replace it with a
        # working copy instead of silently keeping the broken one in place.
        try:
            Path(b).unlink()
        except Exception:
            pass

    def _log(msg: str):
        if log_fn:
            log_fn(msg)
        logger.info(msg)

    raw_arch = platform.machine().lower()
    if raw_arch in ("x86_64", "amd64"):
        arch_tag = "amd64"
        llama_arch = "x64"
    elif raw_arch in ("aarch64", "arm64"):
        arch_tag = "arm64"
        llama_arch = "arm64"
    else:
        raise RuntimeError(f"Unsupported architecture for Local AI runtime: {raw_arch}")

    rd = root_dir()
    bd = bin_dir()
    md = models_dir()
    rd.mkdir(parents=True, exist_ok=True)
    bd.mkdir(parents=True, exist_ok=True)
    md.mkdir(parents=True, exist_ok=True)

    candidates: List[str] = []

    if engine == "llamacpp":
        try:
            gh_req = urllib.request.Request(
                "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest",
                headers={"User-Agent": "ArenaAgent/3.0", "Accept": "application/vnd.github.v3+json"}
            )
            with urllib.request.urlopen(gh_req, timeout=8) as resp:
                rel_data = json.loads(resp.read().decode("utf-8"))
                for asset in rel_data.get("assets", []):
                    name = asset.get("name", "").lower()
                    durl = asset.get("browser_download_url", "")
                    if "bin-ubuntu" in name and llama_arch in name and name.endswith(".zip"):
                        candidates.append(durl)
        except Exception as e:
            _log(f"llama.cpp GitHub release API probe skipped ({e}), using direct endpoints...")

        candidates.extend([
            f"https://github.com/ggerganov/llama.cpp/releases/latest/download/llama-bin-ubuntu-{llama_arch}.zip",
            f"https://github.com/ggerganov/llama.cpp/releases/download/b4800/llama-b4800-bin-ubuntu-{llama_arch}.zip",
            f"https://huggingface.co/ggerganov/llama.cpp/resolve/main/llama-bin-ubuntu-{llama_arch}.zip",
        ])
    else:
        try:
            gh_req = urllib.request.Request(
                "https://api.github.com/repos/ollama/ollama/releases/latest",
                headers={"User-Agent": "ArenaAgent/3.0", "Accept": "application/vnd.github.v3+json"}
            )
            with urllib.request.urlopen(gh_req, timeout=8) as resp:
                rel_data = json.loads(resp.read().decode("utf-8"))
                for asset in rel_data.get("assets", []):
                    name = asset.get("name", "")
                    durl = asset.get("browser_download_url", "")
                    if f"linux-{arch_tag}.tar.zst" in name or f"linux-{arch_tag}.tgz" in name or f"linux-{arch_tag}.tar.gz" in name:
                        candidates.append(durl)
        except Exception as e:
            _log(f"GitHub release API probe skipped ({e}), using direct release endpoints...")

        candidates.extend([
            f"https://github.com/ollama/ollama/releases/latest/download/ollama-linux-{arch_tag}.tar.zst",
            f"https://github.com/ollama/ollama/releases/download/v0.35.0/ollama-linux-{arch_tag}.tar.zst",
            f"https://ollama.com/download/ollama-linux-{arch_tag}.tar.zst",
            f"https://ollama.com/download/ollama-linux-{arch_tag}.tgz",
        ])

    seen = set()
    unique_candidates = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            unique_candidates.append(c)

    downloaded_file: Optional[Path] = None
    last_error = "No download candidates succeeded"

    for url in unique_candidates:
        _log(f"Downloading {engine} runtime from {url}...")
        raw_name = url.split("?")[0].split("/")[-1]
        ext = ".zip" if url.endswith(".zip") else (".tar.zst" if ".tar.zst" in url else ".tar.gz")
        dest_filename = raw_name if raw_name else f"{engine}-installer-{arch_tag}{ext}"
        dest_path = rd / dest_filename
        try:
            dl_ok = False
            if shutil.which("curl"):
                res = subprocess.run(
                    ["curl", "-fSL", "--connect-timeout", "15", "-m", "300", "-A", "Mozilla/5.0 (ArenaAgent/3.0)", "-o", str(dest_path), url],
                    capture_output=True, text=True
                )
                if res.returncode == 0 and dest_path.is_file() and dest_path.stat().st_size > 1000:
                    dl_ok = True
            if not dl_ok and shutil.which("wget"):
                res = subprocess.run(
                    ["wget", "-q", "-T", "15", "-t", "2", "-U", "Mozilla/5.0 (ArenaAgent/3.0)", "-O", str(dest_path), url],
                    capture_output=True, text=True
                )
                if res.returncode == 0 and dest_path.is_file() and dest_path.stat().st_size > 1000:
                    dl_ok = True
            if not dl_ok:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (ArenaAgent/3.0)"})
                with urllib.request.urlopen(req, timeout=180) as resp, open(dest_path, "wb") as out:
                    shutil.copyfileobj(resp, out)
                if dest_path.is_file() and dest_path.stat().st_size > 1000:
                    dl_ok = True

            if dl_ok:
                _log(f"Downloaded {dest_path.name} ({round(dest_path.stat().st_size / (1024*1024), 2)} MB).")
                downloaded_file = dest_path
                break
        except Exception as dl_err:
            last_error = f"{url}: {dl_err}"
            _log(f"Download candidate failed ({dl_err}), trying next candidate...")
            if dest_path.is_file():
                dest_path.unlink(missing_ok=True)

    if not downloaded_file or not downloaded_file.is_file():
        raise RuntimeError(f"Could not download {engine} runtime: {last_error}")

    try:
        _log(f"Extracting {downloaded_file.name} into {rd}...")
        extracted = False
        fname = downloaded_file.name.lower()

        # ZIP extraction (llama.cpp release assets)
        if fname.endswith(".zip"):
            if shutil.which("unzip"):
                res = subprocess.run(["unzip", "-o", "-q", str(downloaded_file), "-d", str(rd)], capture_output=True, text=True)
                if res.returncode == 0:
                    extracted = True
            if not extracted:
                try:
                    with zipfile.ZipFile(str(downloaded_file), "r") as zip_ref:
                        zip_ref.extractall(str(rd))
                    extracted = True
                except Exception as ze:
                    _log(f"Python zipfile extraction failed: {ze}")

        # Method A: system tar
        if not extracted and shutil.which("tar"):
            tar_cmd = ["tar", "-xf", str(downloaded_file), "-C", str(rd)]
            res = subprocess.run(tar_cmd, capture_output=True, text=True)
            if res.returncode == 0:
                extracted = True

        # Method B: python tarfile (for .tgz / .tar.gz)
        if not extracted and (fname.endswith(".tgz") or fname.endswith(".tar.gz")):
            try:
                with tarfile.open(downloaded_file, "r:*") as tar:
                    tar.extractall(path=str(rd))
                extracted = True
            except Exception as e:
                _log(f"tarfile extraction failed: {e}")

        # Method C: zstandard if python package available, or CLI fallback
        if not extracted and fname.endswith(".zst"):
            try:
                import zstandard as zstd
                dctx = zstd.ZstdDecompressor()
                decompressed_tar = rd / "archive.tar"
                with open(downloaded_file, "rb") as ifh, open(decompressed_tar, "wb") as ofh:
                    dctx.copy_stream(ifh, ofh)
                with tarfile.open(decompressed_tar, "r:*") as tar:
                    tar.extractall(path=str(rd))
                decompressed_tar.unlink(missing_ok=True)
                extracted = True
            except Exception as e:
                _log(f"zstandard python decompression failed ({e}), trying CLI...")
                try:
                    if shutil.which("unzstd"):
                        tar_path = rd / "archive.tar"
                        res = subprocess.run(["unzstd", "-f", str(downloaded_file), "-o", str(tar_path)], capture_output=True, text=True)
                        if res.returncode == 0 and tar_path.is_file():
                            with tarfile.open(tar_path, "r:*") as tar:
                                tar.extractall(path=str(rd))
                            extracted = True
                            tar_path.unlink(missing_ok=True)
                    elif shutil.which("zstd"):
                        tar_path = rd / "archive.tar"
                        res = subprocess.run(["zstd", "-d", "-f", str(downloaded_file), "-o", str(tar_path)], capture_output=True, text=True)
                        if res.returncode == 0 and tar_path.is_file():
                            with tarfile.open(tar_path, "r:*") as tar:
                                tar.extractall(path=str(rd))
                            extracted = True
                            tar_path.unlink(missing_ok=True)
                except Exception as e2:
                    _log(f"zstandard CLI decompression failed: {e2}")

        # Look for extracted binary
        target_name = "llama-server" if engine == "llamacpp" else "ollama"
        target_bin = bd / target_name

        if not target_bin.is_file():
            for candidate in rd.rglob(target_name):
                if candidate.is_file() and not candidate.is_symlink() and candidate != target_bin:
                    target_bin.parent.mkdir(parents=True, exist_ok=True)
                    if engine == "llamacpp":
                        # llama.cpp's Ubuntu release builds are dynamically
                        # linked against libllama.so / libggml*.so / libmtmd.so
                        # shipped in the SAME folder as the executables
                        # (resolved via the binary's $ORIGIN rpath). Moving
                        # only llama-server itself left those shared
                        # libraries behind in the extracted archive and made
                        # every launch fail with "error while loading shared
                        # libraries: libllama.so: cannot open shared object
                        # file". Copy every sibling file next to it instead
                        # of just the one binary.
                        src_dir = candidate.parent
                        copied_any = False
                        for sibling in src_dir.iterdir():
                            if sibling.is_file() and not sibling.is_symlink():
                                try:
                                    shutil.copy2(str(sibling), str(bd / sibling.name))
                                    copied_any = True
                                except Exception as copy_err:
                                    _log(f"Could not copy {sibling.name}: {copy_err}")
                        if copied_any:
                            try:
                                (bd / target_name).chmod(0o755)
                            except Exception:
                                pass
                            # Clean up the now-redundant extracted copy tree
                            # (keep disk usage sane; everything needed now
                            # lives under bin_dir()).
                            try:
                                top_level = candidate.relative_to(rd).parts[0]
                                leftover = rd / top_level
                                if leftover.resolve() != bd.resolve():
                                    shutil.rmtree(str(leftover), ignore_errors=True)
                            except Exception:
                                pass
                    else:
                        # Official Ollama release tarballs are laid out as
                        #   ./bin/ollama
                        #   ./lib/ollama/...   (Ollama's OWN bundled,
                        #     matching-glibc-target llama-server runner +
                        #     its shared libraries, which Ollama resolves
                        #     via a path *relative to its own binary*, not
                        #     via PATH).
                        # Moving only the bare `ollama` executable out of
                        # this tree (as this used to do) orphans that
                        # lib/ollama directory -- Ollama can then no longer
                        # find its own matching runner, so loading *any*
                        # model fails with a generic "llama-server process
                        # has terminated: exit status 1" (and, worse, on a
                        # host where the llama.cpp engine is also
                        # installed, Ollama may fall back to whatever
                        # "llama-server" it finds via PATH instead -- a
                        # *different*, differently-built binary that can be
                        # ABI-incompatible with this host even when
                        # Ollama's own bundled one would have worked fine).
                        extracted_lib_dir = candidate.parent.parent / "lib" / "ollama"
                        if extracted_lib_dir.is_dir():
                            dest_lib_dir = root_dir() / "lib" / "ollama"
                            try:
                                if dest_lib_dir.exists():
                                    shutil.rmtree(str(dest_lib_dir), ignore_errors=True)
                                shutil.copytree(str(extracted_lib_dir), str(dest_lib_dir))
                                _log(f"Preserved Ollama's own runner libraries at {dest_lib_dir}")
                            except Exception as copy_err:
                                _log(f"Could not preserve Ollama's lib/ollama runner directory: {copy_err}")
                        shutil.move(str(candidate), str(target_bin))
                        # Clean up the now-redundant extracted copy tree
                        # (everything needed now lives under bin_dir()/
                        # root_dir()/lib -- keep disk usage sane).
                        try:
                            top_level = candidate.relative_to(rd).parts[0]
                            leftover = rd / top_level
                            if leftover.is_dir() and leftover.resolve() != bd.resolve():
                                shutil.rmtree(str(leftover), ignore_errors=True)
                        except Exception:
                            pass
                    break

        if not target_bin.is_file() and engine == "llamacpp":
            for candidate in rd.rglob("llama-cli"):
                if candidate.is_file() and not candidate.is_symlink():
                    shutil.move(str(candidate), str(bd / "llama-cli"))
                    break

        if target_bin.is_file():
            try:
                target_bin.chmod(0o755)
            except Exception:
                pass
            if engine == "llamacpp":
                abi_reason = _binary_abi_incompatibility_reason(str(target_bin))
            else:
                # Check Ollama's OWN bundled runner too (just preserved
                # above), not just the `ollama` executable itself -- the
                # top-level binary can be perfectly fine while its internal
                # llama-server-style runner is the one that's actually
                # ABI-incompatible with this host.
                abi_reason = _ollama_runner_abi_reason(ollama_lib_dir())
            if abi_reason:
                # The binary extracted fine, but this host's own glibc/
                # libstdc++ is too old to run it -- don't report a false
                # "installed successfully" only for start_server() to hit
                # the exact same raw dynamic-linker error a moment later.
                raise RuntimeError(abi_reason)
            set_state("localai:engine", engine)
            _log(f"\u2713 {engine} runtime installed successfully at {target_bin}")
            return {"ok": True, "binary": str(target_bin), "engine": engine}

        if engine == "llamacpp" and (bd / "llama-cli").is_file():
            try:
                (bd / "llama-cli").chmod(0o755)
            except Exception:
                pass
            set_state("localai:engine", engine)
            _log(f"\u2713 llama.cpp runtime installed successfully at {bd / 'llama-cli'}")
            return {"ok": True, "binary": str(bd / "llama-cli"), "engine": engine}

        raise RuntimeError(f"Extraction completed but '{target_name}' binary was not found under {rd}")
    finally:
        if downloaded_file and downloaded_file.is_file():
            downloaded_file.unlink(missing_ok=True)


def start_server(
    env_overrides: Optional[Dict[str, str]] = None,
    log_fn: Optional[Callable[[str], None]] = None,
    model_path: Optional[str] = None,
    ctx_size: Optional[int] = None,
) -> Dict[str, Any]:
    def _log(msg: str):
        if log_fn:
            log_fn(msg)

    active_engine = get_state("localai:engine") or "ollama"
    if model_path is None and active_engine == "llamacpp":
        model_path = get_state("localai:llamacpp:active_path") or None

    srv = server_up(active_engine)
    if srv["up"]:
        loaded_path = get_state("localai:llamacpp:loaded_path") or ""
        if active_engine != "llamacpp" or not model_path or model_path == loaded_path:
            _log(f"Local AI server already running at {host_url()}")
            return {"ok": True, "running": True, "started": False, "host": host_url(), "version": srv.get("version", ""), "engine": active_engine}
        # llama.cpp can only ever serve the one model it was started with —
        # switching models means restarting it against the new file.
        _log("Switching the loaded model: restarting llama-server…")
        stop_server()

    b = binary(active_engine) or binary()
    if b and not _runtime_is_healthy(b, active_engine):
        abi_reason = _binary_abi_incompatibility_reason(b)
        if not abi_reason and active_engine == "ollama":
            abi_reason = _ollama_runner_abi_reason(ollama_lib_dir())
        if abi_reason:
            # This host's own glibc/libstdc++ is simply too old for the
            # official binary -- reinstalling would just redownload the
            # identical, still-incompatible build. Surface the real,
            # actionable reason now instead of silently "repairing" forever.
            raise RuntimeError(abi_reason)
        # Broken install from before this was fixed (e.g. llama-server
        # copied without its libllama.so/libggml*.so, or -- for ollama --
        # the lib/ollama runner directory is missing) -- repair it instead
        # of handing the user the same cryptic
        # "error while loading shared libraries" failure every single time.
        _log(f"{active_engine} binary is present but broken (missing shared libraries/runner files); repairing...")
        b = None
    if not b:
        install_runtime(active_engine, log_fn)
        b = binary(active_engine) or binary()
        if not b:
            raise RuntimeError(f"{active_engine} binary is not installed. Please click \"Install Engine\" first.")

    if active_engine == "llamacpp" and (not model_path or not os.path.isfile(model_path)):
        raise RuntimeError("No .gguf model is selected for llama.cpp yet. Install or activate one first.")

    models_dir().mkdir(parents=True, exist_ok=True)
    log_path = root_dir() / f"{active_engine}.log"
    env = server_env(env_overrides, engine=active_engine)

    parsed = urllib.parse.urlparse(host_url())
    bind_host = parsed.hostname or "127.0.0.1"
    bind_port = parsed.port or 11434

    if active_engine == "llamacpp":
        ctx = ctx_size or 8192
        cmd = [b, "--host", str(bind_host), "--port", str(bind_port), "--model", str(model_path), "--ctx-size", str(int(ctx)), "--no-webui"]
    else:
        cmd = [b, "serve"]

    with open(log_path, "a", encoding="utf-8") as out:
        proc = subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, env=env, start_new_session=True)
    set_state("localai:server:pid", str(proc.pid))

    # Wait for server to listen
    for _ in range(40):
        time.sleep(0.5)
        srv = server_up(active_engine)
        if srv["up"]:
            _log(f"Local AI server is up (pid {proc.pid})")
            if active_engine == "llamacpp" and model_path:
                set_state("localai:llamacpp:loaded_path", model_path)
            return {"ok": True, "running": True, "started": True, "pid": proc.pid, "host": host_url(), "version": srv.get("version", ""), "logPath": str(log_path), "engine": active_engine}

    tail = ""
    try:
        tail = log_path.read_text(encoding="utf-8", errors="ignore")[-600:]
    except Exception:
        pass
    raise RuntimeError(f"Local AI server did not become ready within 20s. Log: {tail}")


def stop_server() -> Dict[str, Any]:
    pid = int(get_state("localai:server:pid") or 0)
    killed = False
    if pid > 0:
        try:
            os.killpg(os.getpgid(pid), 15)
            killed = True
        except Exception:
            pass
        set_state("localai:server:pid", "0")
    # Best-effort cleanup in case the pid was lost (e.g. after a restart).
    subprocess.run(["pkill", "-f", "ollama serve"], capture_output=True)
    subprocess.run(["pkill", "-f", "llama-server"], capture_output=True)
    set_state("localai:llamacpp:loaded_path", "")
    time.sleep(0.5)
    return {"ok": True, "stopped": killed, "pid": pid, "running": server_up()["up"]}



def catalog_file() -> Path:
    p = DATA_DIR / "model_catalog.json"
    if p.is_file():
        return p
    php_p = Path(__file__).resolve().parent.parent.parent / "agent-php" / "data" / "model_catalog.json"
    if php_p.is_file():
        return php_p
    return p


def catalog() -> Dict[str, Any]:
    cf = catalog_file()
    if cf.is_file():
        try:
            return json.loads(cf.read_text(encoding="utf-8"))
        except Exception:
            pass
    if "EMBEDDED_CATALOG_JSON" in globals() and globals()["EMBEDDED_CATALOG_JSON"]:
        try:
            return json.loads(globals()["EMBEDDED_CATALOG_JSON"])
        except Exception:
            pass
    return {"families": [], "variants": []}


def installed() -> Dict[str, Any]:
    engine = get_state("localai:engine") or "ollama"
    if engine == "llamacpp":
        return installed_llamacpp()

    srv = server_up("ollama")
    if not srv["up"]:
        return {"running": False, "models": [], "loaded": [], "error": str(srv.get("error") or "")}
    try:
        tags_req = urllib.request.Request(f"{host_url()}/api/tags", headers={"User-Agent": "ArenaAgent/1.0"})
        with urllib.request.urlopen(tags_req, timeout=20) as resp:
            tags = json.loads(resp.read().decode("utf-8"))
        ps_data: Dict[str, Any] = {}
        try:
            ps_req = urllib.request.Request(f"{host_url()}/api/ps", headers={"User-Agent": "ArenaAgent/1.0"})
            with urllib.request.urlopen(ps_req, timeout=10) as resp:
                ps_data = json.loads(resp.read().decode("utf-8"))
        except Exception:
            ps_data = {}

        models = []
        for m in tags.get("models", []) or []:
            details = m.get("details") or {}
            models.append({
                "name": str(m.get("name") or ""),
                "sizeGb": round(float(m.get("size") or 0) / 1073741824, 2),
                "modifiedAt": str(m.get("modified_at") or ""),
                "family": str(details.get("family") or ""),
                "parameterSize": str(details.get("parameter_size") or ""),
                "quantization": str(details.get("quantization_level") or ""),
                "digest": str(m.get("digest") or "")[:12],
            })
        loaded = []
        for m in ps_data.get("models", []) or []:
            loaded.append({
                "name": str(m.get("name") or ""),
                "sizeGb": round(float(m.get("size") or 0) / 1073741824, 2),
                "sizeVramGb": round(float(m.get("size_vram") or 0) / 1073741824, 2),
                "expiresAt": str(m.get("expires_at") or ""),
            })
        return {"running": True, "version": str(srv.get("version") or ""), "models": models, "loaded": loaded, "error": ""}
    except Exception as e:
        return {"running": False, "models": [], "loaded": [], "error": str(e)}


def llamacpp_index_file() -> Path:
    return root_dir() / "llamacpp-models.json"


def llamacpp_index() -> Dict[str, Dict[str, Any]]:
    f = llamacpp_index_file()
    if not f.is_file():
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _llamacpp_index_save(index: Dict[str, Dict[str, Any]]) -> None:
    root_dir().mkdir(parents=True, exist_ok=True)
    llamacpp_index_file().write_text(json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8")


def llamacpp_index_add(name: str, entry: Dict[str, Any]) -> None:
    index = llamacpp_index()
    index[name] = {"name": name, **entry}
    _llamacpp_index_save(index)


def llamacpp_index_remove(name: str) -> None:
    index = llamacpp_index()
    index.pop(name, None)
    _llamacpp_index_save(index)


def installed_llamacpp() -> Dict[str, Any]:
    """Same shape as the Ollama branch of installed(), backed by the local file index instead of an API."""
    srv = server_up("llamacpp")
    active_path = get_state("localai:llamacpp:active_path") or ""
    index = llamacpp_index()
    models = []
    loaded = []
    for name, entry in index.items():
        path = str(entry.get("path") or "")
        exists = bool(path) and os.path.isfile(path)
        size_gb = round(os.path.getsize(path) / 1073741824, 2) if exists else float(entry.get("sizeGb") or 0)
        models.append({
            "name": str(name),
            "sizeGb": size_gb,
            "modifiedAt": str(entry.get("addedAt") or ""),
            "family": "",
            "parameterSize": "",
            "quantization": str(entry.get("quant") or ""),
            "digest": "",
            "path": path,
            "missing": not exists,
        })
        if srv["up"] and path == active_path and active_path:
            loaded.append({"name": str(name), "sizeGb": size_gb, "sizeVramGb": 0.0, "expiresAt": ""})
    return {
        "running": srv["up"],
        "version": str(srv.get("version") or ""),
        "models": models,
        "loaded": loaded,
        "error": "" if srv["up"] else str(srv.get("error") or ""),
    }


def activate_llamacpp_model(path: str, ctx_size: Optional[int] = None, log_fn: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    """Point llama-server at a specific .gguf on disk, (re)starting it if a
    different model is currently loaded. This is the only way to "install" a
    second model with this engine without losing the first — llama.cpp
    serves exactly one model per process."""
    if not os.path.isfile(path):
        raise RuntimeError(f"Model file not found on disk: {path}")
    set_state("localai:llamacpp:active_path", path)
    return start_server(log_fn=log_fn, model_path=path, ctx_size=ctx_size)


def remove_model(model_name: str) -> Dict[str, Any]:
    engine = get_state("localai:engine") or "ollama"
    if engine == "llamacpp":
        index = llamacpp_index()
        entry = index.get(model_name)
        if entry is None:
            raise RuntimeError(f"Unknown local model: {model_name}")
        path = str(entry.get("path") or "")
        active_path = get_state("localai:llamacpp:active_path") or ""
        if path and path == active_path:
            stop_server()
            set_state("localai:llamacpp:active_path", "")
        llamacpp_index_remove(model_name)
        if entry.get("owned") and path and os.path.isfile(path):
            try:
                os.remove(path)
            except Exception:
                pass
        return {"ok": True, "model": model_name}

    url = f"{host_url()}/api/delete"
    payload = json.dumps({"name": model_name}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json", "User-Agent": "ArenaAgent/1.0"}, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"ok": resp.status in (200, 204), "model": model_name}
    except Exception as e:
        raise RuntimeError(_describe_http_error(e)) from e


def pull_model(model_name: str, on_progress: Optional[Callable[[Dict[str, Any]], None]] = None, timeout: int = 7200) -> Dict[str, Any]:
    url = f"{host_url()}/api/pull"
    payload = json.dumps({"name": model_name, "stream": True}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json", "User-Agent": "ArenaAgent/1.0"})

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            for line in resp:
                line_str = line.decode("utf-8").strip()
                if not line_str:
                    continue
                try:
                    data = json.loads(line_str)
                except (json.JSONDecodeError, UnicodeDecodeError):
                    continue
                # Ollama often reports a pull failure (e.g. unknown model tag,
                # "pull model manifest: file does not exist") as a normal
                # HTTP 200 stream line containing an "error" field rather
                # than a non-2xx HTTP status, so this must be checked
                # explicitly -- otherwise the loop silently finishes and the
                # caller sees a false "ok": True.
                if data.get("error"):
                    raise RuntimeError(str(data["error"]))
                if on_progress:
                    on_progress(data)
                if data.get("status") == "success":
                    return {"ok": True, "model": model_name}
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        raise RuntimeError(_describe_http_error(e)) from e
    return {"ok": True, "model": model_name}


def pull_gguf(
    ref: str,
    explicit_file: Optional[str] = None,
    on_progress: Optional[Callable[[str, float, float, float], None]] = None,
    timeout: int = 7200,
) -> Dict[str, Any]:
    """llama.cpp equivalent of pull_model(): there is no registry protocol, so
    this downloads one concrete, already-verified GGUF file straight from
    Hugging Face into storage/localai/models/llamacpp/."""
    resolved = resolve_gguf_download(ref, explicit_file)
    sub = safe_repo_dir_name(resolved["repo"]) if resolved["repo"] else "custom"
    dest_dir = models_dir() / "llamacpp" / sub
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / os.path.basename(resolved["filename"])

    req = urllib.request.Request(resolved["url"], headers={"User-Agent": "ArenaAgent/3.0"})
    last_pct = -1.0
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        downloaded = 0
        with open(dest, "wb") as out:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                if on_progress is not None:
                    pct = round(downloaded / total * 100, 1) if total > 0 else -1.0
                    if pct != last_pct:
                        on_progress("downloading", pct if pct >= 0 else 0.0, float(downloaded), float(total))
                        last_pct = pct

    return {
        "ok": True,
        "repo": resolved["repo"],
        "filename": resolved["filename"],
        "quant": resolved["quant"],
        "path": str(dest),
        "sizeGb": round(dest.stat().st_size / 1073741824, 2),
    }


def register_llamacpp_provider(model_ref: str, meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meta = meta or {}
    pid = "llamacpp-local"
    existing = PROVIDER_STORE.data.get(pid)
    provider = existing or Provider(id=pid, name="llama.cpp (local)", vendor="llamacpp", url="")
    provider.url = host_url().rstrip("/") + "/v1"
    provider.enabled = True
    provider.apiKey = "local-llamacpp"
    provider.timeoutSec = max(300, provider.timeoutSec or 120)

    model = ModelSpec(
        id=model_ref,
        name=str(meta.get("name") or model_ref),
        toolCalling=bool(meta.get("toolCalling", False)),
        vision=bool(meta.get("vision", False)),
        free=True,
        maxInputTokens=int(meta.get("contextTokens") or 8192),
        maxOutputTokens=int(meta.get("maxOutputTokens") or 4096),
        enabled=True,
        extra={"local": True, "runtime": "llamacpp", "installedAt": datetime.datetime.utcnow().isoformat() + "Z", "modelPath": str(meta.get("path") or "")},
    )
    # Only one process-resident model → replace the whole list, don't append.
    provider.models = [model]

    PROVIDER_STORE.upsert(provider)
    return {"ok": True, "providerId": pid, "provider": pid, "model": model_ref, "modelId": model_ref, "url": provider.url}


def register_provider(model_ref: str, meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    meta = meta or {}
    engine = str(meta.get("engine") or get_state("localai:engine") or "ollama")
    if engine == "llamacpp":
        return register_llamacpp_provider(model_ref, meta)

    pid = "ollama"
    existing = PROVIDER_STORE.data.get(pid)
    models = list(existing.models) if existing else []

    model_id = model_ref
    m_name = meta.get("name") or model_ref

    # Check if model exists
    found = False
    for m in models:
        if m.id == model_id:
            m.name = m_name
            found = True
            break
    if not found:
        models.append(ModelSpec(
            id=model_id,
            name=m_name,
            toolCalling=True,
            vision=bool(meta.get("vision", False)),
            maxInputTokens=int(meta.get("num_ctx") or 32768),
            maxOutputTokens=8192,
            enabled=True,
            free=True,
        ))

    p = Provider(
        id=pid,
        name="Ollama (Local AI)",
        vendor="ollama",
        url=host_url(),
        protocol="ollama",
        enabled=True,
        priority=100,
        timeoutSec=300,
        models=models,
    )
    PROVIDER_STORE.upsert(p)
    return {"ok": True, "providerId": pid, "modelId": model_id}


def variants() -> List[Dict[str, Any]]:
    rows = []
    for model in catalog().get("models", []):
        for v in model.get("variants", []):
            row = dict(v)
            row["modelId"] = str(model.get("id"))
            row["ref"] = f"{model.get('id')}:{v.get('tag')}"
            row["name"] = f"{model.get('name')} {str(v.get('tag')).upper()}"
            row["model"] = model
            rows.append(row)
    return rows


def normalize_profile(raw: Dict[str, Any]) -> Dict[str, Any]:
    scan = host_scan()
    h = scan.get("host", {})
    mem = h.get("memory", {})
    disk = h.get("disk", {})
    suggested_ram = float(mem.get("suggestedBudgetGb", 4.0))

    tasks = [str(t) for t in raw.get("tasks", ["code", "agent"])]
    priority = str(raw.get("priority", "balanced"))
    if priority not in ("balanced", "speed", "quality"):
        priority = "balanced"

    return {
        "tasks": tasks,
        "ramBudgetGb": round(max(0.5, float(raw.get("ramBudgetGb") or suggested_ram)), 2),
        "vramGb": round(max(0.0, float(raw.get("vramGb") or 0.0)), 2),
        "diskBudgetGb": round(max(0.5, float(raw.get("diskBudgetGb") or max(10.0, disk.get("freeGb", 10.0) * 0.8))), 2),
        "contextTokens": max(1024, min(1048576, int(raw.get("contextTokens") or 8192))),
        "languages": [str(l).lower() for l in raw.get("languages", ["fa", "en"])],
        "priority": priority,
        "concurrency": max(1, min(16, int(raw.get("concurrency") or 1))),
        "requireToolCalling": bool(raw.get("requireToolCalling") if "requireToolCalling" in raw else "agent" in tasks),
        "requireVision": bool(raw.get("requireVision") if "requireVision" in raw else "vision" in tasks),
        "requireEmbedding": bool(raw.get("requireEmbedding") if "requireEmbedding" in raw else "embedding" in tasks),
        "minTokensPerSec": float(raw.get("minTokensPerSec") or 0.0),
        "allowNonCommercial": bool(raw.get("allowNonCommercial", True)),
    }


def estimate(v: Dict[str, Any], profile: Dict[str, Any], host: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    host = host or host_scan().get("host", {})
    disk = float(v.get("diskGb") or 0.0)
    weights = disk * WEIGHT_RAM_FACTOR
    active = float(v.get("activeGb") or disk) * WEIGHT_RAM_FACTOR

    kv_scale = 1.0 if server_env().get("OLLAMA_KV_CACHE_TYPE", "").lower() == "f16" else 0.5
    ctx_k = profile["contextTokens"] / 1024
    kv = float(v.get("kvGbPer1k") or 0.05) * ctx_k * kv_scale * max(1, int(profile["concurrency"]))

    ram_gb = round(weights + kv + RUNTIME_OVERHEAD_GB, 2)
    vram = float(profile["vramGb"])
    gpu_bw = 320.0 if vram > 0 else 0.0
    cpu_bw = 28.0

    offload = max(0.0, min(1.0, (vram - kv - 0.5) / max(0.1, weights))) if (vram > 0 and gpu_bw > 0) else 0.0
    if offload >= 0.999:
        bandwidth = gpu_bw
    elif offload > 0:
        bandwidth = 1.0 / ((offload / max(1.0, gpu_bw)) + ((1.0 - offload) / max(1.0, cpu_bw)))
    else:
        bandwidth = cpu_bw

    tps = (bandwidth / active) * 0.72 if active > 0 else 0.0
    cores = int((host.get("cpu") or {}).get("cores") or 4)
    tps = min(tps, 20.0 * max(1, cores) * (6 if offload > 0.5 else 1))

    return {
        "weightsGb": round(weights, 2),
        "activeGb": round(active, 2),
        "kvCacheGb": round(kv, 2),
        "overheadGb": RUNTIME_OVERHEAD_GB,
        "ramGb": ram_gb,
        "diskGb": round(disk, 2),
        "gpuOffloadRatio": round(offload, 2),
        "effectiveBandwidthGBs": round(bandwidth, 1),
        "tokensPerSec": round(tps, 1),
        "fitsRam": ram_gb <= float(profile["ramBudgetGb"]),
        "fitsDisk": disk <= float(profile["diskBudgetGb"]),
    }


def _speed_score(tps: float) -> float:
    import math
    s = min(1.0, math.log(1 + tps / 2.5) / math.log(1 + 14 / 2.5))
    return s * 0.5 if tps < 1.5 else s


def _task_match(model: Dict[str, Any], tasks: List[str]) -> float:
    have = [str(t) for t in model.get("tasks", [])]
    if not tasks:
        return 0.5
    hits = 0
    for t in tasks:
        if t in have:
            hits += 1
        elif t == "agent" and model.get("toolCalling"):
            hits += 1
        elif t == "vision" and model.get("vision"):
            hits += 1
        elif t == "reasoning" and model.get("reasoning"):
            hits += 1
    return hits / max(1, len(tasks))


def _language_score(model: Dict[str, Any], languages: List[str]) -> float:
    if not languages:
        return 0.7
    have = [str(l).lower() for l in model.get("languages", [])]
    total = 0.0
    for lang in languages:
        if lang == "fa":
            total += float(model.get("faScore") or 0.0) / 100.0
        elif lang in have or "multi" in have:
            total += 1.0
        else:
            total += 0.25
    return total / max(1, len(languages))


def recommend(raw_profile: Dict[str, Any]) -> Dict[str, Any]:
    profile = normalize_profile(raw_profile)
    scan = host_scan()
    host_info = scan.get("host", {})

    weights = {
        "speed": {"quality": 0.18, "speed": 0.42, "task": 0.20, "lang": 0.10, "fit": 0.10},
        "quality": {"quality": 0.48, "speed": 0.08, "task": 0.22, "lang": 0.10, "fit": 0.12},
    }.get(profile["priority"], {"quality": 0.34, "speed": 0.22, "task": 0.22, "lang": 0.10, "fit": 0.12})

    ranked = []
    rejected = []

    for v in variants():
        model = v.get("model", {})
        est = estimate(v, profile, host_info)
        reasons = []
        blockers = []

        if not est["fitsRam"]:
            blockers.append(f"به {est['ramGb']} گیگ رم نیاز دارد (بودجه: {profile['ramBudgetGb']})")
        if not est["fitsDisk"]:
            blockers.append(f"به {est['diskGb']} گیگ دیسک نیاز دارد (آزاد: {profile['diskBudgetGb']})")
        if profile["contextTokens"] > int(model.get("contextMax") or 8192):
            blockers.append(f"حداکثر پنجرهٔ این مدل {model.get('contextMax')} توکن است")
        if profile["requireToolCalling"] and not model.get("toolCalling"):
            blockers.append("ابزارفراخوانی (tool calling) ندارد")
        if profile["requireVision"] and not model.get("vision"):
            blockers.append("قابلیت بینایی ندارد")
        if profile["requireEmbedding"] != bool(model.get("embedding", False)):
            blockers.append("نوع تسک امبدینگ با درخواست همخوانی ندارد")
        if profile["minTokensPerSec"] > 0 and est["tokensPerSec"] < profile["minTokensPerSec"]:
            blockers.append(f"سرعت تخمینی {est['tokensPerSec']} توکن/ثانیه کمتر از حداقل است")
        if not profile["allowNonCommercial"] and "NC" in str(model.get("license", "")).upper():
            blockers.append("لایسنس غیرتجاری است")

        if blockers:
            rejected.append({"ref": v["ref"], "name": v["name"], "reasons": blockers, "estimate": est})
            continue

        raw_quality = float(v.get("quality", 50))
        quality = (raw_quality / 100.0) ** 1.6
        speed = _speed_score(float(est["tokensPerSec"]))
        task = _task_match(model, profile["tasks"])
        lang = _language_score(model, profile["languages"])
        ratio = est["ramGb"] / max(0.1, float(profile["ramBudgetGb"]))
        fit = (ratio / 0.85) if ratio <= 0.85 else max(0.0, 1.0 - (ratio - 0.85) * 4.0)

        score = (
            weights["quality"] * quality
            + weights["speed"] * speed
            + weights["task"] * task
            + weights["lang"] * lang
            + weights["fit"] * fit
        )

        if model.get("toolCalling") and "agent" in profile["tasks"]:
            score += 0.04
            reasons.append("ابزارفراخوانی رسمی دارد و با حلقهٔ عامل این برنامه کاملا سازگار است")
        if est["gpuOffloadRatio"] >= 0.99:
            score += 0.03
            reasons.append("کاملاً روی حافظه گرافیکی VRAM جا می‌شود")
        elif est["gpuOffloadRatio"] > 0.1:
            reasons.append(f"حدود {int(est['gpuOffloadRatio'] * 100)}% روی GPU بارگذاری می‌شود")
        if task >= 0.99:
            reasons.append("دقیقاً برای وظیفه انتخاب‌شده ساخته شده است")
        if "fa" in profile["languages"]:
            reasons.append(f"امتیاز زبان فارسی: {int(model.get('faScore') or 0)} از ۱۰۰")
        reasons.append(f"حدود {est['ramGb']} گیگ رم و {est['diskGb']} گیگ دیسک؛ تقریبا {int(est['tokensPerSec'])} توکن/ثانیه")

        ranked.append({
            "ref": v["ref"],
            "modelId": v["modelId"],
            "tag": str(v.get("tag")),
            "name": v["name"],
            "publisher": str(model.get("publisher", "")),
            "license": str(model.get("license", "")),
            "summary": str(model.get("summary", "")),
            "tasks": model.get("tasks", []),
            "contextMax": int(model.get("contextMax") or 8192),
            "toolCalling": bool(model.get("toolCalling", False)),
            "vision": bool(model.get("vision", False)),
            "embedding": bool(model.get("embedding", False)),
            "reasoning": bool(model.get("reasoning", False)),
            "quant": str(v.get("quant", "")),
            "paramsB": float(v.get("paramsB") or 0.0),
            "rawQuality": raw_quality,
            "score": round(score, 4),
            "scorePct": int(round(min(100.0, score * 100.0))),
            "estimate": est,
            "reasons": reasons,
            "url": str(model.get("url", "")),
        })

    # Soft matching fallback: if strict criteria filtered out everything, relax
    # constraints so the user always gets actionable recommendations instead of
    # an empty list (e.g. an unusually small RAM budget or a rare combination
    # of required features).
    if not ranked:
        for v in variants():
            model = v.get("model", {})
            est = estimate(v, profile, host_info)
            soft_reasons = []
            penalty = 1.0

            if not est["fitsRam"]:
                soft_reasons.append(
                    f"نیازمند {est['ramGb']} گیگابایت رم (بودجه فعلی: {profile['ramBudgetGb']} گیگ)"
                )
                over = max(0.0, est["ramGb"] - profile["ramBudgetGb"])
                penalty *= max(0.2, 1.0 - (over / max(1.0, profile["ramBudgetGb"])))
            if profile["contextTokens"] > int(model.get("contextMax") or 8192):
                soft_reasons.append(f"پنجره کانتکست مدل به {model.get('contextMax')} توکن محدود می‌شود")
                penalty *= 0.9
            if profile["requireToolCalling"] and not model.get("toolCalling"):
                soft_reasons.append("فاقد ابزارفراخوانی رسمی (پاسخ متنی و کدنویسی مستقیم)")
                penalty *= 0.7
            if profile["requireVision"] and not model.get("vision"):
                soft_reasons.append("فاقد قابلیت بینایی")
                penalty *= 0.7
            if profile["requireEmbedding"] != bool(model.get("embedding", False)):
                soft_reasons.append(
                    "مدل امبدینگ نیست" if profile["requireEmbedding"] else "فقط مدل امبدینگ است و برای چت/کدنویسی مناسب نیست"
                )
                penalty *= 0.3

            raw_quality = float(v.get("quality", 50))
            quality = (raw_quality / 100.0) ** 1.6
            speed = _speed_score(float(est["tokensPerSec"]))
            task = _task_match(model, profile["tasks"])
            lang = _language_score(model, profile["languages"])
            fit = 0.5

            score = (
                weights["quality"] * quality
                + weights["speed"] * speed
                + weights["task"] * task
                + weights["lang"] * lang
                + weights["fit"] * fit
            ) * penalty

            soft_reasons.append(
                f"تخمین: {est['ramGb']} گیگ رم · {est['diskGb']} گیگ دیسک · تقریباً {int(est['tokensPerSec'])} توکن بر ثانیه"
            )

            ranked.append({
                "ref": v["ref"],
                "modelId": v["modelId"],
                "tag": str(v.get("tag")),
                "name": v["name"],
                "publisher": str(model.get("publisher", "")),
                "license": str(model.get("license", "")),
                "summary": str(model.get("summary", "")),
                "tasks": model.get("tasks", []),
                "contextMax": int(model.get("contextMax") or 8192),
                "toolCalling": bool(model.get("toolCalling", False)),
                "vision": bool(model.get("vision", False)),
                "embedding": bool(model.get("embedding", False)),
                "reasoning": bool(model.get("reasoning", False)),
                "quant": str(v.get("quant", "")),
                "paramsB": float(v.get("paramsB") or 0.0),
                "rawQuality": raw_quality,
                "score": round(score, 4),
                "scorePct": int(round(min(100.0, score * 100.0))),
                "estimate": est,
                "reasons": soft_reasons,
                "url": str(model.get("url", "")),
            })

    ranked.sort(key=lambda x: x["score"], reverse=True)

    return {
        "profile": profile,
        "host": host_info,
        "recommendations": ranked[:12],
        "rejected": rejected[:12],
    }


def quant_bits(quant: str) -> float:
    """Approximate bits-per-weight for a GGUF quantisation code."""
    q = (quant or "").strip().upper()
    if q in BPW:
        return BPW[q]
    if q.startswith("BF16") or q == "F16":
        return 16.0
    if q == "F32":
        return 32.0
    m = re.match(r"^I?Q(\d)", q)
    if m:
        return {2: 2.6, 3: 3.9, 4: 4.85, 5: 5.7, 6: 6.6, 8: 8.5}.get(int(m.group(1)), 4.85)
    return 4.85


_GGUF_QUANT_RE = re.compile(r"(?:^|[._-])(i?q[0-9](?:_[a-z0-9]+)*|bf16|fp?16|fp?32)$", re.IGNORECASE)
_GGUF_SPLIT_SUFFIX_RE = re.compile(r"-\d{5}-of-\d{5}$", re.IGNORECASE)
_GGUF_SPLIT_FILENAME_RE = re.compile(r"-\d{5}-of-\d{5}\.gguf$", re.IGNORECASE)


def extract_gguf_quant(filename: str) -> Optional[str]:
    """Pull the quantisation code (Q4_K_M, IQ3_XS, F16, …) out of a .gguf file name."""
    base = re.sub(r"\.gguf$", "", (filename or "").strip(), flags=re.IGNORECASE)
    base = _GGUF_SPLIT_SUFFIX_RE.sub("", base)  # drop multi-part suffix
    m = _GGUF_QUANT_RE.search(base)
    if not m:
        return None
    tag = m.group(1).upper()
    return {"FP16": "F16", "FP32": "F32"}.get(tag, tag)


def is_split_gguf_filename(filename: str) -> bool:
    """Multi-part GGUF releases ship as name-00001-of-00004.gguf; those need every shard pulled together."""
    return bool(_GGUF_SPLIT_FILENAME_RE.search(filename or ""))


def safe_repo_dir_name(repo: str) -> str:
    """Safe, filesystem-friendly directory name for a Hugging Face owner/repo id."""
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", (repo or "").strip("/"))
    return safe or "model"


_hf_repo_files_cache: Dict[str, List[str]] = {}


def hf_repo_files(repo: str) -> List[str]:
    """Fetch the live file list of a Hugging Face repo so we only ever offer
    quantisations that actually exist — this is what stops the installer
    from pulling a reference that 404s."""
    if repo in _hf_repo_files_cache:
        return _hf_repo_files_cache[repo]
    url = f"{HF_API}/{repo}?" + urllib.parse.urlencode({"expand[]": "siblings"})
    files: List[str] = []
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ArenaAgent/3.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        for sib in data.get("siblings", []) or []:
            name = str((sib or {}).get("rfilename") or "")
            if name:
                files.append(name)
    except Exception as e:
        logger.warning("Hugging Face repo file listing failed for %s: %s", repo, e)
    _hf_repo_files_cache[repo] = files
    return files


def quant_map_from_files(files: List[str]) -> Dict[str, Dict[str, Any]]:
    """Build the quant -> file map for a Hugging Face repo, preferring the
    single consolidated file over split shards when both exist."""
    out: Dict[str, Dict[str, Any]] = {}
    for fname in files:
        if not fname.lower().endswith(".gguf"):
            continue
        quant = extract_gguf_quant(fname)
        if quant is None:
            continue
        split = is_split_gguf_filename(fname)
        if quant not in out or (out[quant]["split"] and not split):
            out[quant] = {"filename": fname, "split": split}
    return out


def default_quant(quant_map: Dict[str, Dict[str, Any]]) -> Optional[str]:
    """Pick the best default quant out of what a repo actually ships."""
    if not quant_map:
        return None
    for cand in QUANT_PRIORITY:
        if cand in quant_map:
            return cand
    return next(iter(quant_map))


def resolve_gguf_download(ref: str, explicit_file: Optional[str] = None) -> Dict[str, str]:
    """Resolve a "download request" for the llama.cpp engine into an exact,
    verified {repo, filename, quant, url} — llama.cpp has no /api/pull, so
    unlike Ollama it only ever gets a concrete file to fetch, never an
    ambiguous repo reference.

    Accepted `ref` shapes:
      - "hf.co/{owner}/{repo}:{QUANT}"  (as produced by search())
      - "hf.co/{owner}/{repo}"          (no quant -> pick the best default)
      - "{owner}/{repo}"                (bare HF id)
      - a direct "https://.../*.gguf" URL (downloaded verbatim)
    """
    ref = (ref or "").strip()
    if not ref:
        raise ValueError("A model reference is required")

    if re.match(r"^https?://", ref, re.IGNORECASE):
        if not ref.lower().endswith(".gguf"):
            raise ValueError("Direct URLs must point at a .gguf file")
        filename = os.path.basename(urllib.parse.urlparse(ref).path) or "model.gguf"
        return {"repo": "", "filename": filename, "quant": extract_gguf_quant(filename) or "CUSTOM", "url": ref}

    repo = re.sub(r"^hf\.co/", "", ref, flags=re.IGNORECASE)
    quant = None
    if ":" in repo:
        repo, quant = repo.split(":", 1)
        quant = quant.strip().upper()
    repo = repo.strip("/")
    if "/" not in repo:
        raise ValueError(f'Could not understand model reference "{ref}" — expected "owner/repo" or "hf.co/owner/repo:QUANT"')

    filename = explicit_file
    if filename is None:
        files = hf_repo_files(repo)
        quant_map = quant_map_from_files(files)
        if not quant_map:
            raise ValueError(f'No .gguf files were found in Hugging Face repo "{repo}" (it may be a non-GGUF or private repo).')
        quant = quant or default_quant(quant_map)
        if quant not in quant_map:
            available = ", ".join(quant_map.keys())
            raise ValueError(f'Quantisation "{quant}" does not exist in "{repo}". Available: {available}')
        filename = quant_map[quant]["filename"]
    quant = quant or extract_gguf_quant(filename) or "CUSTOM"

    url = "https://huggingface.co/" + repo + "/resolve/main/" + "/".join(
        urllib.parse.quote(part) for part in filename.split("/")
    )
    return {"repo": repo, "filename": filename, "quant": quant, "url": url}


def search(query: str, limit: int = 25, remote: bool = True) -> Dict[str, Any]:
    q = (query or "").strip().lower()
    cat = catalog()
    local = []
    for m in cat.get("models", []):
        hay = " ".join([
            str(m.get("id", "")),
            str(m.get("name", "")),
            str(m.get("publisher", "")),
            str(m.get("summary", "")),
            " ".join(m.get("tasks", []) if isinstance(m.get("tasks"), list) else []),
        ]).lower()
        if not q or q in hay:
            local.append({
                "source": "catalog",
                "id": str(m.get("id", "")),
                "name": str(m.get("name", "")),
                "publisher": str(m.get("publisher", "")),
                "summary": str(m.get("summary", "")),
                "description": str(m.get("summary", "")),
                "license": str(m.get("license", "Open")),
                "tasks": m.get("tasks", []),
                "toolCalling": bool(m.get("toolCalling", False)),
                "vision": bool(m.get("vision", False)),
                "reasoning": bool(m.get("reasoning", False)),
                "contextMax": int(m.get("contextMax") or 8192),
                "variants": [
                    {
                        "tag": str(v.get("tag", "")),
                        "ref": f"{m.get('id')}:{v.get('tag')}",
                        "diskGb": float(v.get("diskGb", 0.0)),
                        "ramGb": round(float(v.get("diskGb", 0.0)) * WEIGHT_RAM_FACTOR + RUNTIME_OVERHEAD_GB + 0.8, 1),
                        "quant": str(v.get("quant", "")),
                        "paramsB": float(v.get("paramsB") or 0.0),
                        "quality": int(v.get("quality") or 50),
                        "contextMax": int(m.get("contextMax") or 8192),
                        "toolCalling": bool(m.get("toolCalling", False)),
                        "vision": bool(m.get("vision", False)),
                        "reasoning": bool(m.get("reasoning", False)),
                    }
                    for v in m.get("variants", [])
                ],
            })

    hf = []
    if remote and q:
        try:
            hf_url = (
                f"{HF_API}?"
                + urllib.parse.urlencode({
                    "search": query, "filter": "gguf", "sort": "downloads", "direction": -1,
                    "limit": max(1, min(50, limit)),
                })
                + "&expand[]=siblings&expand[]=downloads&expand[]=likes"
            )
            req = urllib.request.Request(hf_url, headers={"User-Agent": "ArenaAgent/3.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for item in data if isinstance(data, list) else []:
                if not isinstance(item, dict):
                    continue
                mid = str(item.get("modelId") or item.get("id") or "")
                if not mid:
                    continue
                m_low = mid.lower()

                params_b = 0.0
                pm = re.search(r"(\d+(?:\.\d+)?)\s*b(?:\b|[-_])", m_low, re.IGNORECASE)
                if pm:
                    params_b = float(pm.group(1))

                # Only offer repos whose file list actually contains a usable
                # .gguf — this is what guarantees the "Install" button can
                # never 404.
                siblings = [str((s or {}).get("rfilename") or "") for s in (item.get("siblings") or [])]
                siblings = [s for s in siblings if s]
                quant_map = quant_map_from_files(siblings)
                if not quant_map:
                    continue

                quant_options = []
                for quant, info in quant_map.items():
                    disk = round(params_b * 1e9 * quant_bits(quant) / 8 / 1073741824, 2) if params_b > 0 else 4.5
                    ram = round(disk * WEIGHT_RAM_FACTOR + RUNTIME_OVERHEAD_GB + 0.8, 1)
                    quant_options.append({
                        "quant": quant,
                        "filename": info["filename"],
                        "split": info["split"],
                        "ref": f"hf.co/{mid}:{quant}",
                        "diskGb": disk,
                        "ramGb": ram,
                    })
                quant_options.sort(key=lambda o: o["diskGb"])

                default_q = default_quant(quant_map)
                default = next((o for o in quant_options if o["quant"] == default_q), None) or quant_options[0]

                hf.append({
                    "source": "huggingface",
                    "id": mid,
                    "name": mid,
                    "publisher": mid.split("/")[0] if "/" in mid else "",
                    "downloads": int(item.get("downloads") or 0),
                    "likes": int(item.get("likes") or 0),
                    "tasks": [t for t in item.get("tags", []) if isinstance(t, str)],
                    "pullRef": default["ref"],
                    "diskGb": default["diskGb"],
                    "ramGb": default["ramGb"],
                    "quant": default["quant"],
                    "quantOptions": quant_options,
                    "paramsB": params_b,
                    "toolCalling": "tool" in m_low or "function" in m_low,
                    "vision": "vision" in m_low or "-vl" in m_low,
                    "reasoning": "r1" in m_low or "reason" in m_low or "qwq" in m_low,
                    "summary": "مخزن GGUF در Hugging Face — {} کوانت موجود، پیش‌فرض {} ({:.1f} گیگابایت).".format(
                        len(quant_options), default["quant"], default["diskGb"]
                    ),
                })
        except Exception as e:
            logger.warning("Hugging Face search skipped: %s", e)

    return {"query": query, "catalog": local, "huggingface": hf[:limit]}


def read_engine_log_tail(engine: Optional[str] = None, max_chars: int = 6000) -> Dict[str, Any]:
    """Return the tail of the raw stdout/stderr log file we redirect the
    managed engine subprocess (ollama/llama-server) into, so the UI's
    troubleshooting panel can show -- and let the user copy -- the real
    crash output instead of just the one-line HTTP error summary (which is
    often just a generic "process has terminated: exit status N" with no
    further context).
    """
    engine = engine or get_state("localai:engine") or "ollama"
    log_path = root_dir() / f"{engine}.log"
    text = ""
    if log_path.is_file():
        try:
            text = log_path.read_text(encoding="utf-8", errors="ignore")[-max_chars:]
        except Exception:
            text = ""
    return {"engine": engine, "logPath": str(log_path), "log": text}


def benchmark_llamacpp(model: str, prompt: str = "Say OK.", num_predict: int = 48) -> Dict[str, Any]:
    index = llamacpp_index()
    path = str((index.get(model) or {}).get("path") or "")
    active_path = get_state("localai:llamacpp:active_path") or ""
    if path and path != active_path:
        activate_llamacpp_model(path)
    elif not server_up("llamacpp")["up"]:
        start_server()

    t0 = time.time()
    try:
        payload = json.dumps({"prompt": prompt, "n_predict": num_predict, "stream": False}).encode("utf-8")
        req = urllib.request.Request(f"{host_url()}/completion", data=payload, headers={"Content-Type": "application/json", "User-Agent": "ArenaAgent/3.0"})
        with urllib.request.urlopen(req, timeout=600) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        log_tail = read_engine_log_tail("llamacpp").get("log", "")
        error_msg = _describe_http_error(e)
        missing_version = _detect_abi_version_mismatch(log_tail)
        if missing_version:
            error_msg = _abi_incompatibility_message(missing_version, "llamacpp")
        return {
            "ok": False,
            "model": model,
            "error": error_msg,
            "latencyMs": round((time.time() - t0) * 1000, 1),
            "logTail": log_tail,
        }

    wall_ms = round((time.time() - t0) * 1000, 1)
    timings = data.get("timings") or {}
    tps = float(timings.get("predicted_per_second") or 0)
    tokens = int(timings.get("predicted_n") or 0)
    if tps <= 0 and tokens > 0 and timings.get("predicted_ms"):
        tps = round(tokens / (float(timings["predicted_ms"]) / 1000), 1)
    return {
        "ok": True,
        "model": model,
        "response": str(data.get("content") or "")[:400],
        "tokens": tokens,
        "tokensPerSec": round(tps, 1),
        "firstTokenMs": round(float(timings.get("prompt_ms") or 0), 1),
        "latencyMs": wall_ms,
    }


def benchmark_test(model: str) -> Dict[str, Any]:
    engine = get_state("localai:engine") or "ollama"
    if engine == "llamacpp":
        return benchmark_llamacpp(model)

    srv = server_up("ollama")
    if not srv["up"]:
        return {"ok": False, "error": "سرویس Ollama در حال اجرا نیست", "logTail": read_engine_log_tail("ollama").get("log", "")}
    try:
        t0 = time.time()
        url = f"{host_url()}/api/generate"
        payload = json.dumps({
            "model": model,
            "prompt": "Write a 30-word python function to calculate fibonacci sequence.",
            "stream": False,
        }).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json", "User-Agent": "ArenaAgent/3.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            elapsed = max(0.01, time.time() - t0)
            eval_count = int(data.get("eval_count") or 30)
            eval_duration_ns = int(data.get("eval_duration") or int(elapsed * 1e9))
            eval_sec = max(0.01, eval_duration_ns / 1e9)
            tps = round(eval_count / eval_sec, 2)
            return {
                "ok": True,
                "model": model,
                "tokensPerSec": tps,
                "evalCount": eval_count,
                "durationSec": round(elapsed, 2),
            }
    except Exception as e:
        log_tail = read_engine_log_tail("ollama").get("log", "")
        error_msg = _describe_http_error(e)
        # Ollama's own error for this ("llama runner process has
        # terminated: exit status 1"/"exit status 2") never says *why* the
        # runner actually died -- the real reason (if it's the glibc/
        # libstdc++ ABI mismatch class of failure) is only visible in its
        # own log file, which we already have right here. Surface the
        # clear, actionable diagnosis immediately instead of making the
        # user dig through the raw log themselves.
        missing_version = _detect_abi_version_mismatch(log_tail)
        if missing_version:
            error_msg = _abi_incompatibility_message(missing_version, "ollama")
        return {
            "ok": False,
            "error": error_msg,
            "logTail": log_tail,
        }


def default_scan_roots() -> List[str]:
    roots = []
    home = os.environ.get("HOME") or ""
    if home:
        roots.append(home.rstrip("/"))
    for p in ["/root", "/home", "/opt", "/srv", "/data", "/mnt", "/media", "/var/www", "/workspace"]:
        if os.path.isdir(p):
            roots.append(p)
    roots.append(str(root_dir()))
    seen = set()
    out = []
    for r in roots:
        r = r.rstrip("/") or "/"
        if os.path.isdir(r) and r not in seen:
            seen.add(r)
            out.append(r)
    return out


def _scan_dir_find(root: str, exts: List[str], timeout_sec: int, results: List[Dict[str, Any]], max_results: int) -> None:
    """Fast path: shell out to `find`, pruning noisy directories as it walks."""
    name_expr: List[str] = []
    for i, e in enumerate(exts):
        if i > 0:
            name_expr.append("-o")
        name_expr += ["-iname", f"*.{e}"]
    prune_expr: List[str] = []
    for name in SCAN_EXCLUDE_NAMES:
        prune_expr += ["-name", name, "-prune", "-o"]
    cmd = ["timeout", str(timeout_sec), "find", root, "-xdev"] + prune_expr + ["("] + name_expr + [")"] + ["-type", "f", "-printf", "%s|%T@|%p\\n"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec + 5)
        out = proc.stdout
    except Exception:
        out = ""
    for line in out.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|", 2)
        if len(parts) < 3:
            continue
        size_str, mtime_str, path = parts
        results.append({
            "path": path,
            "sizeGb": round(float(size_str) / 1073741824, 3),
            "ext": os.path.splitext(path)[1].lstrip(".").lower(),
            "mtime": int(float(mtime_str)),
            "name": os.path.basename(path),
            "quant": extract_gguf_quant(os.path.basename(path)),
        })
        if len(results) >= max_results:
            return


def _scan_dir_walk(root: str, exts: List[str], results: List[Dict[str, Any]], max_results: int, started: float, time_budget: int) -> None:
    """Fallback for hosts without a `find` binary: a depth-first walk with a hard time/size budget."""
    for dirpath, dirnames, filenames in os.walk(root, topdown=True, onerror=lambda e: None):
        if time.time() - started > time_budget or len(results) >= max_results:
            return
        dirnames[:] = [d for d in dirnames if d not in SCAN_EXCLUDE_NAMES]
        for fname in filenames:
            if time.time() - started > time_budget or len(results) >= max_results:
                return
            ext = os.path.splitext(fname)[1].lstrip(".").lower()
            if ext not in exts:
                continue
            full = os.path.join(dirpath, fname)
            try:
                st = os.stat(full)
            except Exception:
                continue
            results.append({
                "path": full,
                "sizeGb": round(st.st_size / 1073741824, 3),
                "ext": ext,
                "mtime": int(st.st_mtime),
                "name": fname,
                "quant": extract_gguf_quant(fname),
            })


def scan_drive(opts: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Walk the filesystem looking for model files (.gguf, .ggml, .safetensors,
    …). Uses `find` when available (fast, handles millions of files) and
    falls back to a budgeted os.walk() otherwise. Always bounded by a result
    cap and a wall-clock budget so a "scan the whole drive" request can never
    hang the request indefinitely."""
    opts = opts or {}
    full = bool(opts.get("full", False))
    roots = [str(r) for r in (opts.get("roots") or []) if str(r).strip()]
    if not roots:
        roots = ["/"] if full else default_scan_roots()
    max_results = max(1, min(2000, int(opts.get("maxResults") or 300)))
    time_budget = max(5, min(120, int(opts.get("timeBudgetSec") or 25)))
    exts = [str(e).lower() for e in (opts.get("extensions") or SCAN_EXTENSIONS)] or SCAN_EXTENSIONS

    started = time.time()
    results: List[Dict[str, Any]] = []
    has_find = shutil.which("find") is not None

    for root in roots:
        elapsed = time.time() - started
        if elapsed > time_budget or len(results) >= max_results:
            break
        if not os.path.isdir(root) or not os.access(root, os.R_OK):
            continue
        remaining = int(max(3, min(60, time_budget - elapsed)))
        if has_find:
            _scan_dir_find(root, exts, remaining, results, max_results)
        else:
            _scan_dir_walk(root, exts, results, max_results, started, time_budget)

    results.sort(key=lambda r: r["sizeGb"], reverse=True)
    truncated = len(results) > max_results
    results = results[:max_results]

    return {
        "roots": roots,
        "full": full,
        "count": len(results),
        "truncated": truncated,
        "tookSec": round(time.time() - started, 2),
        "results": results,
    }


def suggest_name_from_file(path: str) -> str:
    base = re.sub(r"\.(gguf|ggml|bin|safetensors)$", "", os.path.basename(path), flags=re.IGNORECASE)
    base = _GGUF_SPLIT_SUFFIX_RE.sub("", base).strip()
    return base or os.path.basename(path)


def run_import_job(job_id: str, engine: str, path: str, name: str, context_tokens: int, register: bool, benchmark: bool, set_default: bool,
                    log_fn: Callable[[str], None], progress_fn: Callable[[float, str], None]) -> Dict[str, Any]:
    """Point the agent at a model file that is already on disk — no network
    involved. Works for both engines:
      - Ollama: `ollama create <name> -f Modelfile` (Modelfile: `FROM <path>`)
      - llama.cpp: the file is referenced in place and loaded directly
    """
    if not os.path.isfile(path):
        raise RuntimeError(f"File no longer exists: {path}")

    if engine == "llamacpp":
        install_runtime("llamacpp", log_fn)
        progress_fn(15, "موتور llama.cpp آماده شد")

        llamacpp_index_add(name, {
            "path": path,
            "quant": extract_gguf_quant(os.path.basename(path)) or "",
            "repo": "",
            "sizeGb": round(os.path.getsize(path) / 1073741824, 2),
            "owned": False,  # the file lives wherever the user put it — never delete it on removal
            "addedAt": datetime.datetime.utcnow().isoformat() + "Z",
        })
        progress_fn(40, "فایل به فهرست اضافه شد")

        activate_llamacpp_model(path, context_tokens, log_fn)
        progress_fn(70, "مدل در llama-server بارگذاری شد")

        if benchmark:
            bench = benchmark_llamacpp(name, "In one short sentence, say that the local model is ready.")
            log_fn(f"Benchmark: {bench.get('tokensPerSec', 0):.1f} tok/s" if bench.get("ok") else f"Benchmark failed: {bench.get('error', '')}")
        progress_fn(85, "تست سلامت انجام شد")

        if register:
            register_llamacpp_provider(name, {"name": name, "contextTokens": context_tokens, "path": path})
            if set_default:
                set_state("localai:default", name)
    else:
        install_runtime("ollama", log_fn)
        progress_fn(15, "موتور Ollama آماده شد")
        start_server(log_fn=log_fn)
        progress_fn(25, "سرویس محلی در حال اجراست")

        safe_name = re.sub(r"[^a-z0-9._-]+", "-", name.strip("-").lower()).strip("-") or "imported-model"
        modelfile = root_dir() / f"Modelfile-{safe_name}-{os.urandom(4).hex()}"
        modelfile.write_text(f"FROM {path}\n", encoding="utf-8")

        b = binary("ollama")
        if not b:
            modelfile.unlink(missing_ok=True)
            raise RuntimeError("Ollama binary not found after install")
        log_fn(f"Importing with `ollama create {safe_name}` (this copies/converts the weights into Ollama's own store) …")
        try:
            out = subprocess.run([b, "create", safe_name, "-f", str(modelfile)], cwd=str(root_dir()), capture_output=True, text=True, timeout=1800, env=server_env(engine="ollama"))
        finally:
            modelfile.unlink(missing_ok=True)
        if out.returncode != 0:
            raise RuntimeError(f"`ollama create` failed: {(out.stderr or out.stdout or '').strip()[-800:]}")
        progress_fn(70, "مدل در Ollama ساخته شد")

        if benchmark:
            bench = benchmark_test(safe_name)
            log_fn(f"Benchmark: {bench.get('tokensPerSec', 0):.1f} tok/s" if bench.get("ok") else f"Benchmark failed: {bench.get('error', '')}")
        progress_fn(85, "تست سلامت انجام شد")

        if register:
            register_provider(safe_name, meta={"name": name, "engine": "ollama"})
            if set_default:
                set_state("localai:default", safe_name)
        name = safe_name

    progress_fn(100, "✅ درون‌ریزی با موفقیت پایان یافت")
    return {"ok": True, "name": name, "path": path, "engine": engine}


def plan(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    ref = str(payload.get("ref") or payload.get("model") or "")
    rt = runtime_status()
    steps = []
    if not rt.get("installed"):
        steps.append({
            "id": "runtime",
            "title": "دانلود و نصب موتور هوش مصنوعی (Ollama)",
            "detail": "دانلود باینری مستقل کاربر بدون نیاز به root",
        })
    else:
        steps.append({
            "id": "runtime",
            "title": "بررسی وضعیت موتور Ollama",
            "detail": f"نسخه {rt.get('version', '')} آماده است",
        })

    steps.append({
        "id": "server",
        "title": "اجرای سرویس هوش مصنوعی محلی",
        "detail": f"سرویس در آدرس {host_url()} فعال می‌شود",
    })
    steps.append({
        "id": "pull",
        "title": f"دانلود وزن‌های مدل {ref}",
        "detail": "دانلود مستقیم لایه‌های GGUF از رجیستری",
    })
    steps.append({
        "id": "register",
        "title": f"ثبت ارائه‌دهندهٔ مدل {ref}",
        "detail": "افزودن خودکار مدل به فهرست مدل‌های چت و کدنویسی",
    })
    if payload.get("benchmark", True):
        steps.append({
            "id": "benchmark",
            "title": "تست سرعت و بنچمارک توکن بر ثانیه",
            "detail": "محاسبه سرعت پاسخگویی واقعی سخت‌افزار",
        })
    return steps


def save_profile(name: str, profile_dict: Dict[str, Any]) -> Dict[str, Any]:
    all_profiles = get_state_json("localai:profiles", {}) or {}
    norm = normalize_profile(profile_dict)
    all_profiles[name] = {
        "name": name,
        "profile": norm,
        "savedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    set_state_json("localai:profiles", all_profiles)
    return {"profiles": list(all_profiles.values())}


def list_profiles() -> Dict[str, Any]:
    all_profiles = get_state_json("localai:profiles", {}) or {}
    default_ref = get_state("localai:default", "") or ""
    return {
        "profiles": list(all_profiles.values()),
        "default": default_ref,
    }


def delete_profile(name: str) -> Dict[str, Any]:
    all_profiles = get_state_json("localai:profiles", {}) or {}
    all_profiles.pop(name, None)
    set_state_json("localai:profiles", all_profiles)
    return {"profiles": list(all_profiles.values())}


import types as _types
local_ai = _types.SimpleNamespace(
    root_dir=root_dir,
    models_dir=models_dir,
    bin_dir=bin_dir,
    binary=binary,
    host_url=host_url,
    server_env=server_env,
    server_up=server_up,
    host_scan=host_scan,
    runtime_status=runtime_status,
    install_runtime=install_runtime,
    start_server=start_server,
    stop_server=stop_server,
    catalog_file=catalog_file,
    catalog=catalog,
    installed=installed,
    remove_model=remove_model,
    pull_model=pull_model,
    search=search,
    benchmark_test=benchmark_test,
    plan=plan,
    register_provider=register_provider,
    recommend=recommend,
    save_profile=save_profile,
    list_profiles=list_profiles,
    delete_profile=delete_profile,
)
