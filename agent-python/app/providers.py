"""Provider Store, Multi-protocol Adapters, Key Rotation, Circuit Breaker, and Fallbacks."""
import os
import json
import time
import httpx
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

from .models import Provider, ModelSpec
from .config import DATA_DIR, get_raw_config, encrypt_secret, decrypt_secret, mask_secret
from .database import get_db

class CircuitBreaker:
    def __init__(self, failure_threshold: int = 5, recovery_timeout: float = 60.0):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_counts: Dict[str, int] = {}
        self.last_failure_time: Dict[str, float] = {}

    def is_tripped(self, provider_id: str) -> bool:
        now = time.time()
        failures = self.failure_counts.get(provider_id, 0)
        last_fail = self.last_failure_time.get(provider_id, 0)
        if failures >= self.failure_threshold:
            if now - last_fail > self.recovery_timeout:
                # Half-open state: allow a retry
                return False
            return True
        return False

    def record_success(self, provider_id: str):
        self.failure_counts[provider_id] = 0

    def record_failure(self, provider_id: str):
        self.failure_counts[provider_id] = self.failure_counts.get(provider_id, 0) + 1
        self.last_failure_time[provider_id] = time.time()

CIRCUIT_BREAKER = CircuitBreaker()

class ProviderStore:
    def __init__(self, path: Optional[str] = None):
        self.path = Path(os.getenv("PROVIDERS_FILE", path or DATA_DIR / "providers.json"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.key_indices: Dict[str, int] = {}
        self.data: Dict[str, Provider] = self._load()

    def _load(self) -> Dict[str, Provider]:
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                return {k: Provider.model_validate(v) for k, v in raw.items()}
            except Exception:
                pass
        seed = Path(__file__).parents[1] / "data" / "providers.json"
        if seed.exists():
            try:
                raw = json.loads(seed.read_text(encoding="utf-8"))
                return {k: Provider.model_validate(v) for k, v in raw.items()}
            except Exception:
                pass
        return {}

    def save(self):
        tmp = self.path.with_suffix(".tmp")
        dump = {}
        for k, v in self.data.items():
            d = v.model_dump(exclude_none=True)
            # Encrypt apiKey if not empty and not already encrypted
            if d.get("apiKey") and not str(d["apiKey"]).startswith("enc:"):
                d["apiKey"] = encrypt_secret(d["apiKey"])
            if d.get("apiKeys"):
                d["apiKeys"] = [encrypt_secret(k) if not str(k).startswith("enc:") else k for k in d["apiKeys"]]
            dump[k] = d

        tmp.write_text(json.dumps(dump, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def get_api_key(self, p: Provider) -> str:
        # 1. Multi-key rotation
        if p.apiKeys:
            idx = self.key_indices.get(p.id, 0)
            key_raw = p.apiKeys[idx % len(p.apiKeys)]
            self.key_indices[p.id] = idx + 1
            if key_raw.startswith("enc:"):
                return decrypt_secret(key_raw)
            return key_raw

        # 2. Single Key
        if p.apiKey:
            if p.apiKey.startswith("enc:"):
                return decrypt_secret(p.apiKey)
            return p.apiKey

        # 3. Environment Variable
        if p.apiKeyEnv:
            env_val = get_raw_config(p.apiKeyEnv)
            if env_val:
                return env_val

        return ""

    def public_view(self, p: Provider) -> Dict[str, Any]:
        d = p.model_dump()
        key = self.get_api_key(p)
        d["hasApiKey"] = bool(key)
        d["apiKey"] = mask_secret(p.apiKey) if p.apiKey else ""
        d["apiKeys"] = [mask_secret(k) for k in p.apiKeys]
        d["circuitBreakerTripped"] = CIRCUIT_BREAKER.is_tripped(p.id)
        return d

    def all(self) -> List[Dict[str, Any]]:
        return [self.public_view(p) for p in sorted(self.data.values(), key=lambda x: x.priority, reverse=True)]

    def upsert(self, p: Provider) -> Dict[str, Any]:
        existing = self.data.get(p.id)
        if existing:
            # Preserve existing secret if placeholder or empty was passed
            if not p.apiKey or "••••" in p.apiKey:
                p.apiKey = existing.apiKey
            if not p.apiKeys:
                p.apiKeys = existing.apiKeys
        self.data[p.id] = p
        self.save()
        return self.public_view(p)

    def delete(self, pid: str):
        self.data.pop(pid, None)
        self.save()

    def add_model(self, pid: str, m: ModelSpec):
        if pid in self.data:
            self.data[pid].models.append(m)
            self.save()

    def update_model(self, pid: str, mid: str, m: ModelSpec):
        if pid in self.data:
            p = self.data[pid]
            p.models = [m if x.id == mid else x for x in p.models]
            self.save()

    def delete_model(self, pid: str, mid: str):
        if pid in self.data:
            p = self.data[pid]
            p.models = [x for x in p.models if x.id != mid]
            self.save()

    def record_metric(self, provider_id: str, model_id: str, latency_ms: float, is_error: bool, tokens: int = 0):
        with get_db() as conn:
            conn.execute("""
            INSERT INTO provider_metrics (provider_id, model_id, request_count, error_count, total_tokens, total_latency_ms, last_latency_ms, last_status, circuit_breaker_tripped, updated_at)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(provider_id, model_id) DO UPDATE SET
                request_count = request_count + 1,
                error_count = error_count + excluded.error_count,
                total_tokens = total_tokens + excluded.total_tokens,
                total_latency_ms = total_latency_ms + excluded.total_latency_ms,
                last_latency_ms = excluded.last_latency_ms,
                last_status = excluded.last_status,
                circuit_breaker_tripped = excluded.circuit_breaker_tripped,
                updated_at = datetime('now')
            """, (
                provider_id,
                model_id,
                1 if is_error else 0,
                tokens,
                latency_ms,
                latency_ms,
                "error" if is_error else "ok",
                1 if CIRCUIT_BREAKER.is_tripped(provider_id) else 0
            ))

    def export_json(self) -> str:
        dump = {}
        for k, v in self.data.items():
            d = v.model_dump(exclude_none=True)
            d["apiKey"] = "" # Export without keys for security
            d["apiKeys"] = []
            dump[k] = d
        return json.dumps(dump, ensure_ascii=False, indent=2)

    def import_json(self, text: str, replace: bool = False):
        incoming = json.loads(text)
        parsed = {}
        if isinstance(incoming, list):
            for item in incoming:
                p = Provider.model_validate(item)
                parsed[p.id] = p
        elif isinstance(incoming, dict):
            for k, v in incoming.items():
                if isinstance(v, dict) and "id" not in v:
                    v["id"] = k
                p = Provider.model_validate(v)
                parsed[p.id] = p
        else:
            raise ValueError("Import JSON must be an array of providers or an object mapping.")

        if replace:
            self.data = parsed
        else:
            self.data.update(parsed)
        self.save()

PROVIDER_STORE = ProviderStore()
