"""Central application configuration, secrets encryption, and environment management."""
import os
import json
import base64
import hashlib
from pathlib import Path
from typing import Dict, Any, Optional
from cryptography.fernet import Fernet

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("AGENT_DATA_DIR", BASE_DIR / "data")).resolve()
DATA_DIR.mkdir(parents=True, exist_ok=True)

LOGS_DIR = DATA_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

BACKUPS_DIR = DATA_DIR / "backups"
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

VERSIONS_DIR = DATA_DIR / "versions"
VERSIONS_DIR.mkdir(parents=True, exist_ok=True)

JOB_OUTPUTS_DIR = DATA_DIR / "job_outputs"
JOB_OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

WORKSPACES_ROOT = DATA_DIR / "workspaces"
WORKSPACES_ROOT.mkdir(parents=True, exist_ok=True)

ENV_FILE = DATA_DIR / "environment.json"
MASTER_KEY_FILE = DATA_DIR / "master.key"

# Version
APP_VERSION = "0.6.0"

# Secret Encryption (Fernet / AES)
def get_or_create_master_key() -> bytes:
    key_env = os.getenv("AGENT_MASTER_KEY", "").strip()
    if key_env:
        # Normalize to 32 url-safe base64 bytes
        k = hashlib.sha256(key_env.encode()).digest()
        return base64.urlsafe_b64encode(k)
    if MASTER_KEY_FILE.exists():
        return MASTER_KEY_FILE.read_bytes().strip()
    key = Fernet.generate_key()
    MASTER_KEY_FILE.write_bytes(key)
    MASTER_KEY_FILE.chmod(0o600)
    return key

FERNET = Fernet(get_or_create_master_key())

def encrypt_secret(plain_text: str) -> str:
    if not plain_text:
        return ""
    if plain_text.startswith("enc:"):
        return plain_text
    encrypted = FERNET.encrypt(plain_text.encode("utf-8")).decode("utf-8")
    return f"enc:{encrypted}"

def decrypt_secret(cipher_text: str) -> str:
    if not cipher_text:
        return ""
    if not cipher_text.startswith("enc:"):
        return cipher_text
    raw = cipher_text[4:]
    try:
        return FERNET.decrypt(raw.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""

def mask_secret(value: str) -> str:
    if not value:
        return ""
    decrypted = decrypt_secret(value) if value.startswith("enc:") else value
    if len(decrypted) <= 8:
        return "••••••••"
    return f"{decrypted[:3]}••••••••{decrypted[-4:]}"

# Configuration Names
CONFIG_KEYS = [
    "OPENROUTER_API_KEY",
    "GROQ_API_KEY",
    "TOGETHER_API_KEY",
    "MISTRAL_API_KEY",
    "GEMINI_API_KEY",
    "DEEPSEEK_API_KEY",
    "ANTHROPIC_API_KEY",
    "CLOUDFLARE_API_TOKEN",
    "GITHUB_TOKEN",
    "OLLAMA_BASE_URL",
    "AGENT_WORKSPACE",
    "PROVIDERS_FILE",
    "AGENT_PROXY_URL",
    "AGENT_AUTH_TOKEN",
    "AUTH_ENABLED",
    "REQUIRE_FILE_APPROVAL",
    "DOCKER_SANDBOX_ENABLED",
    "MAX_CONCURRENT_JOBS",
    "RATE_LIMIT_PER_MINUTE",
    "CORS_ORIGINS"
]

def read_environment() -> Dict[str, str]:
    data = {}
    if ENV_FILE.exists():
        try:
            data = json.loads(ENV_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    res = {}
    for k in CONFIG_KEYS:
        val = data.get(k, os.getenv(k, ""))
        # Mask sensitive keys
        if any(secret_word in k for secret_word in ("KEY", "TOKEN", "SECRET", "AUTH_TOKEN")):
            res[k] = mask_secret(val) if val else ""
        else:
            res[k] = str(val)
    return res

def get_raw_config(key: str, default: str = "") -> str:
    if ENV_FILE.exists():
        try:
            data = json.loads(ENV_FILE.read_text(encoding="utf-8"))
            if key in data and data[key]:
                val = data[key]
                if str(val).startswith("enc:"):
                    return decrypt_secret(val)
                return str(val)
        except Exception:
            pass
    return os.getenv(key, default)

def write_environment(incoming: Dict[str, Any]) -> Dict[str, str]:
    current = {}
    if ENV_FILE.exists():
        try:
            current = json.loads(ENV_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass

    for k, v in incoming.items():
        if k in CONFIG_KEYS:
            val = str(v).strip()
            # If secret and not empty, encrypt it
            if any(secret_word in k for secret_word in ("KEY", "TOKEN", "SECRET", "AUTH_TOKEN")):
                if val and "••••" not in val:  # Only update if user supplied a new plain key
                    current[k] = encrypt_secret(val)
                elif not val and k in current:
                    pass  # leave unchanged if empty / placeholder
            else:
                current[k] = val

    ENV_FILE.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return read_environment()

def get_default_workspace() -> Path:
    ws_env = get_raw_config("AGENT_WORKSPACE")
    if ws_env:
        p = Path(ws_env).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p
    # Default is the repository root
    return BASE_DIR.resolve()

def is_auth_enabled() -> bool:
    val = get_raw_config("AUTH_ENABLED", "").lower()
    token = get_raw_config("AGENT_AUTH_TOKEN", "")
    return val in ("1", "true", "yes") or bool(token)

def is_file_approval_required() -> bool:
    val = get_raw_config("REQUIRE_FILE_APPROVAL", "true").lower()
    return val in ("1", "true", "yes")
