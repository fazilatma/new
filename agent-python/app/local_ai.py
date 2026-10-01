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
    srv = server_up()
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


def install_runtime(engine: str = "ollama", log_fn: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    engine = engine.strip().lower() if engine else "ollama"
    b = binary(engine)
    if b:
        return {"ok": True, "alreadyInstalled": True, "binary": b, "engine": engine}

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
                    shutil.move(str(candidate), str(target_bin))
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


def start_server(env_overrides: Optional[Dict[str, str]] = None, log_fn: Optional[Callable[[str], None]] = None) -> Dict[str, Any]:
    srv = server_up()
    if srv["up"]:
        return {"ok": True, "alreadyRunning": True, "host": host_url(), "version": srv.get("version", "")}

    active_engine = get_state("localai:engine") or "ollama"
    b = binary(active_engine) or binary()
    if not b:
        install_runtime(active_engine, log_fn)
        b = binary(active_engine) or binary()
        if not b:
            raise RuntimeError(f"{active_engine} binary is not installed.")

    log_path = root_dir() / f"{active_engine}.log"
    env = server_env(env_overrides)

    if active_engine == "llamacpp":
        port = host_url().rsplit(":", 1)[-1] if ":" in host_url().split("//", 1)[-1] else "11434"
        cmd = [b, "--port", port, "--host", "0.0.0.0"]
    else:
        cmd = [b, "serve"]

    with open(log_path, "a", encoding="utf-8") as out:
        subprocess.Popen(cmd, stdout=out, stderr=subprocess.STDOUT, env=env, start_new_session=True)

    # Wait for server to listen
    for _ in range(15):
        time.sleep(0.5)
        srv = server_up()
        if srv["up"]:
            return {"ok": True, "started": True, "host": host_url(), "version": srv.get("version", ""), "engine": active_engine}

    return {"ok": False, "error": f"{active_engine} server did not respond within 8 seconds", "log": str(log_path)}


def stop_server() -> Dict[str, Any]:
    # Kill any local runtime processes (both engines, whichever is active)
    subprocess.run(["pkill", "-f", "ollama serve"], capture_output=True)
    subprocess.run(["pkill", "-f", "llama-server"], capture_output=True)
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
            hf_url = f"{HF_API}?search={urllib.parse.quote(query)}&filter=gguf&sort=downloads&direction=-1&limit={max(1, min(50, limit))}"
            req = urllib.request.Request(hf_url, headers={"User-Agent": "ArenaAgent/3.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if isinstance(data, list):
                    for item in data:
                        if not isinstance(item, dict):
                            continue
                        mid = str(item.get("modelId") or item.get("id") or "")
                        pub = mid.split("/")[0] if "/" in mid else ""
                        m_low = mid.lower()
                        est_disk, est_ram = 4.5, 5.8
                        if "0.5b" in m_low:
                            est_disk, est_ram = 0.6, 1.2
                        elif "1.5b" in m_low or "1b" in m_low or "2b" in m_low:
                            est_disk, est_ram = 1.5, 2.4
                        elif "3b" in m_low or "4b" in m_low:
                            est_disk, est_ram = 2.5, 3.6
                        elif "7b" in m_low or "8b" in m_low:
                            est_disk, est_ram = 4.8, 6.2
                        elif "14b" in m_low or "13b" in m_low:
                            est_disk, est_ram = 9.2, 11.5
                        elif "32b" in m_low or "34b" in m_low:
                            est_disk, est_ram = 20.0, 24.0
                        elif "70b" in m_low or "72b" in m_low:
                            est_disk, est_ram = 42.0, 48.0

                        hf.append({
                            "source": "huggingface",
                            "id": mid,
                            "name": mid,
                            "publisher": pub,
                            "downloads": int(item.get("downloads") or 0),
                            "likes": int(item.get("likes") or 0),
                            "tasks": [t for t in item.get("tags", []) if isinstance(t, str)],
                            "pullRef": f"hf.co/{mid}",
                            "diskGb": est_disk,
                            "ramGb": est_ram,
                            "toolCalling": "tool" in m_low or "function" in m_low,
                            "vision": "vision" in m_low or "-vl" in m_low,
                            "reasoning": "r1" in m_low or "reason" in m_low or "qwq" in m_low,
                            "summary": f"مخزن GGUF در Hugging Face — با «ollama pull hf.co/{mid}» نصب می‌شود.",
                        })
        except Exception as e:
            logger.warning("Hugging Face search skipped: %s", e)

    return {"query": query, "catalog": local, "huggingface": hf[:limit]}


def benchmark_test(model: str) -> Dict[str, Any]:
    srv = server_up()
    if not srv["up"]:
        return {"ok": False, "error": "سرویس Ollama در حال اجرا نیست"}
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
        return {"ok": False, "error": str(e)}


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
