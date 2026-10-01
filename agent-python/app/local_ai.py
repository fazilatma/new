"""
Local AI runtime manager & Ollama installer for Agent Python.
Parity with agent-php/app/LocalAI.php.
"""

from __future__ import annotations

import json
import logging
import os
import platform
import re
import shutil
import subprocess
import tarfile
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .config import DATA_DIR
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


def binary() -> Optional[str]:
    custom = os.environ.get("AGENT_OLLAMA_BIN")
    if custom and os.path.isfile(custom) and os.access(custom, os.X_OK):
        return custom
    local = str(bin_dir() / "ollama")
    if os.path.isfile(local) and os.access(local, os.X_OK):
        return local
    system = shutil.which("ollama")
    if system and os.path.isfile(system) and os.access(system, os.X_OK):
        return system
    return None


def host_url() -> str:
    return (os.environ.get("AGENT_LOCALAI_HOST") or os.environ.get("OLLAMA_BASE_URL") or DEFAULT_HOST).rstrip("/")


def server_env(overrides: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    env = os.environ.copy()
    defaults = {
        "OLLAMA_MODELS": str(models_dir()),
        "OLLAMA_HOST": host_url().replace("http://", "").replace("https://", ""),
        "OLLAMA_KEEP_ALIVE": os.environ.get("OLLAMA_KEEP_ALIVE", "10m"),
        "OLLAMA_MAX_LOADED_MODELS": os.environ.get("OLLAMA_MAX_LOADED_MODELS", "1"),
        "OLLAMA_NUM_PARALLEL": os.environ.get("OLLAMA_NUM_PARALLEL", "1"),
        "OLLAMA_FLASH_ATTENTION": os.environ.get("OLLAMA_FLASH_ATTENTION", "1"),
        "OLLAMA_KV_CACHE_TYPE": os.environ.get("OLLAMA_KV_CACHE_TYPE", "q8_0"),
        "PATH": f"{bin_dir()}:{env.get('PATH', '')}",
    }
    env.update(defaults)
    if overrides:
        env.update(overrides)
    return env


def server_up() -> Dict[str, Any]:
    url = f"{host_url()}/api/version"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ArenaAgent/1.0"})
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return {"up": True, "version": data.get("version", ""), "host": host_url()}
    except Exception as e:
        return {"up": False, "version": "", "host": host_url(), "error": str(e)}


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
    b = binary()
    srv = server_up()
    md = models_dir()
    return {
        "installed": bool(b),
        "binary": b or "",
        "managed": bool(b and str(bin_dir()) in str(b)),
        "running": srv["up"],
        "version": srv.get("version", ""),
        "host": host_url(),
        "modelsDir": str(md),
        "modelsDirWritable": is_dir_writable(md),
        "error": "" if srv["up"] else str(srv.get("error", "")),
        "env": server_env(),
    }


def install_runtime(log_fn: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    b = binary()
    if b:
        return {"ok": True, "alreadyInstalled": True, "binary": b}

    def _log(msg: str):
        if log_fn:
            log_fn(msg)
        logger.info(msg)

    raw_arch = platform.machine().lower()
    if raw_arch in ("x86_64", "amd64"):
        arch_tag = "amd64"
    elif raw_arch in ("aarch64", "arm64"):
        arch_tag = "arm64"
    else:
        raise RuntimeError(f"Unsupported architecture for direct Ollama install: {raw_arch}")

    rd = root_dir()
    bd = bin_dir()
    md = models_dir()
    rd.mkdir(parents=True, exist_ok=True)
    bd.mkdir(parents=True, exist_ok=True)
    md.mkdir(parents=True, exist_ok=True)

    # 1. Discover candidates from GitHub latest release or fallbacks
    candidates: List[str] = []
    try:
        gh_req = urllib.request.Request(
            "https://api.github.com/repos/ollama/ollama/releases/latest",
            headers={"User-Agent": "ArenaAgent/3.0"}
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

    # Fallback standard endpoints
    candidates.extend([
        f"https://github.com/ollama/ollama/releases/latest/download/ollama-linux-{arch_tag}.tar.zst",
        f"https://github.com/ollama/ollama/releases/download/v0.35.0/ollama-linux-{arch_tag}.tar.zst",
        f"https://ollama.com/download/ollama-linux-{arch_tag}.tar.zst",
        f"https://ollama.com/download/ollama-linux-{arch_tag}.tgz",
    ])

    # De-duplicate while preserving order
    seen = set()
    unique_candidates = []
    for c in candidates:
        if c and c not in seen:
            seen.add(c)
            unique_candidates.append(c)

    downloaded_file: Optional[Path] = None
    last_error = "No download candidates succeeded"

    for url in unique_candidates:
        _log(f"Downloading Ollama runtime for {arch_tag} from {url}...")
        filename = url.split("?")[0].split("/")[-1]
        if not filename or filename == url:
            filename = f"ollama-linux-{arch_tag}.tar.zst"
        dest_path = rd / filename
        try:
            dl_ok = False
            # Try curl CLI first (handles SSL & redirects robustly)
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
        raise RuntimeError(f"Could not download Ollama runtime: {last_error}")

    try:
        _log(f"Extracting {downloaded_file.name} into {rd}...")
        extracted = False
        fname = downloaded_file.name

        # Method A: system tar
        if shutil.which("tar"):
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

        # Method C: zstandard if python package available
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
                _log(f"zstandard decompression failed: {e}")

        # Look for extracted binary
        target_bin = bd / "ollama"
        if not target_bin.is_file():
            # Search anywhere under rd
            for candidate in rd.rglob("ollama"):
                if candidate.is_file() and not candidate.is_symlink() and candidate != target_bin:
                    target_bin.parent.mkdir(parents=True, exist_ok=True)
                    shutil.move(str(candidate), str(target_bin))
                    break

        if target_bin.is_file():
            try:
                target_bin.chmod(0o755)
            except Exception:
                pass
            _log(f"✓ Ollama runtime installed successfully at {target_bin}")
            return {"ok": True, "binary": str(target_bin)}

        raise RuntimeError(f"Extraction completed but 'ollama' binary was not found under {rd}")
    finally:
        if downloaded_file and downloaded_file.is_file():
            downloaded_file.unlink(missing_ok=True)


def start_server(env_overrides: Optional[Dict[str, str]] = None, log_fn: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    srv = server_up()
    if srv["up"]:
        return {"ok": True, "alreadyRunning": True, "host": host_url(), "version": srv.get("version", "")}

    b = binary()
    if not b:
        install_runtime(log_fn)
        b = binary()
        if not b:
            raise RuntimeError("Ollama binary is not installed.")

    log_path = root_dir() / "ollama.log"
    cmd = [b, "serve"]
    env = server_env(env_overrides)

    with open(log_path, "a", encoding="utf-8") as out:
        subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, env=env, start_new_session=True)

    # Wait for server to listen
    for _ in range(15):
        time.sleep(0.5)
        srv = server_up()
        if srv["up"]:
            return {"ok": True, "started": True, "host": host_url(), "version": srv.get("version", "")}

    return {"ok": False, "error": "Server did not respond within 8 seconds", "log": str(log_path)}


def stop_server() -> Dict[str, Any]:
    # Kill any local ollama processes
    subprocess.run(["pkill", "-f", "ollama serve"], capture_output=True)
    time.sleep(0.5)
    return {"ok": True, "running": server_up()["up"]}


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


def installed() -> List[Dict[str, Any]]:
    srv = server_up()
    if not srv["up"]:
        return []
    try:
        url = f"{host_url()}/api/tags"
        req = urllib.request.Request(url, headers={"User-Agent": "ArenaAgent/1.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("models", [])
    except Exception:
        return []


def remove_model(model_name: str) -> Dict[str, Any]:
    url = f"{host_url()}/api/delete"
    payload = json.dumps({"name": model_name}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json", "User-Agent": "ArenaAgent/1.0"}, method="DELETE")
    with urllib.request.urlopen(req, timeout=10) as resp:
        return {"ok": resp.status in (200, 204), "model": model_name}


def pull_model(model_name: str, on_progress: Optional[Callable[[Dict[str, Any]], None]] = None, timeout: int = 7200) -> Dict[str, Any]:
    url = f"{host_url()}/api/pull"
    payload = json.dumps({"name": model_name, "stream": True}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json", "User-Agent": "ArenaAgent/1.0"})
    
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        for line in resp:
            line_str = line.decode("utf-8").strip()
            if not line_str:
                continue
            try:
                data = json.loads(line_str)
                if on_progress:
                    on_progress(data)
                if data.get("status") == "success":
                    return {"ok": True, "model": model_name}
            except Exception:
                pass
    return {"ok": True, "model": model_name}


def register_provider(model_ref: str, meta: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    pid = "ollama"
    existing = PROVIDER_STORE.get(pid)
    models = list(existing.models) if existing else []
    
    model_id = model_ref
    m_name = (meta or {}).get("name") or model_ref
    
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
            vision=bool((meta or {}).get("vision", False)),
            maxInputTokens=int((meta or {}).get("num_ctx") or 32768),
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


def recommend(raw_profile: Dict[str, Any]) -> Dict[str, Any]:
    scan = host_scan()
    host_info = scan["host"]
    
    ram_budget = float(raw_profile.get("ramBudgetGb") or host_info["memory"]["suggestedBudgetGb"])
    tasks = raw_profile.get("tasks") or ["code", "agent"]
    languages = raw_profile.get("languages") or ["fa", "en"]
    priority = raw_profile.get("priority") or "balanced"

    cat = catalog()
    families = {f["id"]: f for f in cat.get("families", [])}
    variants = cat.get("variants", [])

    recommendations = []
    rejected = []

    for v in variants:
        fam = families.get(v.get("familyId", "")) or {}
        size_gb = float(v.get("diskGb") or 4.0)
        req_ram = round((size_gb * WEIGHT_RAM_FACTOR) + RUNTIME_OVERHEAD_GB + 0.5, 2)
        
        if req_ram > ram_budget:
            rejected.append({"id": v.get("id"), "reason": f"Requires {req_ram} GB RAM (budget: {ram_budget} GB)"})
            continue

        score = float(fam.get("qualityScore", 70))
        if "code" in tasks and "coding" in fam.get("tags", []):
            score += 15
        if "fa" in languages and "multilingual" in fam.get("tags", []):
            score += 10
        if priority == "speed":
            score += max(0, 100 - size_gb * 5)
        else:
            score += min(30, size_gb * 2)

        recommendations.append({
            "variant": v,
            "family": fam,
            "score": round(score, 1),
            "requiredRamGb": req_ram,
            "estimatedSpeedTokensSec": max(5, round(25 - size_gb * 1.2, 1)),
            "pullTag": v.get("pullTag") or v.get("id"),
        })

    recommendations.sort(key=lambda x: x["score"], reverse=True)

    return {
        "host": host_info,
        "recommendations": recommendations[:5],
        "rejected": rejected[:10],
    }

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
    register_provider=register_provider,
    recommend=recommend,
)
