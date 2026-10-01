"""Provider Store, Multi-protocol Adapters, Key Rotation, Circuit Breaker, and Fallbacks."""
import os
import json
import time
import re
import ast
import httpx
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple

from .models import Provider, ModelSpec
from .config import DATA_DIR, get_raw_config, encrypt_secret, decrypt_secret, mask_secret
from .database import get_db

def resolve_provider_endpoint_url(base_url: str, protocol: str) -> str:
    url = (base_url or "").strip().rstrip("/")
    if not url:
        if protocol == "ollama":
            url = "http://localhost:11434"
        elif protocol == "anthropic":
            url = "https://api.anthropic.com"
        else:
            url = "https://api.openai.com/v1"

    if protocol == "anthropic":
        if url.endswith("/v1/messages") or url.endswith("/messages"):
            return url
        if url.endswith("/v1"):
            return f"{url}/messages"
        return f"{url}/v1/messages"
    elif protocol == "ollama":
        if url.endswith("/api/chat") or url.endswith("/chat"):
            return url
        if url.endswith("/api"):
            return f"{url}/chat"
        return f"{url}/api/chat"
    elif protocol == "azure":
        if url.endswith("/chat/completions"):
            return url
        return f"{url}/chat/completions"
    else: # openai-compatible, mistral, cloudflare, gemini, openrouter, custom
        if url.endswith("/chat/completions"):
            return url
        return f"{url}/chat/completions"

def _clean_json_text(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        lines = t.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        t = "\n".join(lines).strip()
    
    # Replace smart/unicode quotes
    t = t.replace('“', '"').replace('”', '"').replace('„', '"').replace('«', '"').replace('»', '"')
    t = t.replace('’', "'").replace('‘', "'").replace('`', "'")
    return t

def _normalize_model_spec(item: Any) -> Optional[ModelSpec]:
    if not item:
        return None
    if isinstance(item, str):
        mid = item.strip()
        if not mid:
            return None
        return ModelSpec(id=mid, name=mid, enabled=True)
    if isinstance(item, dict):
        mid = str(item.get("id") or item.get("name") or item.get("model_id") or item.get("model") or "").strip()
        if not mid:
            return None
        name = str(item.get("name") or item.get("title") or item.get("label") or mid).strip()
        
        enabled_val = item.get("enabled", True)
        if isinstance(enabled_val, str):
            enabled = enabled_val.lower() in ("true", "1", "yes", "on", "active")
        else:
            enabled = bool(enabled_val)

        toolCalling = bool(item.get("toolCalling") or item.get("tool_calling") or item.get("function_calling") or item.get("tools") or False)
        vision = bool(item.get("vision") or item.get("multimodal") or False)
        free = bool(item.get("free") or False)
        
        try:
            maxInputTokens = int(item.get("maxInputTokens") or item.get("max_input_tokens") or item.get("context_length") or 128000)
        except Exception:
            maxInputTokens = 128000
            
        try:
            maxOutputTokens = int(item.get("maxOutputTokens") or item.get("max_output_tokens") or 8192)
        except Exception:
            maxOutputTokens = 8192
            
        try:
            inputCost = float(item.get("inputCostPer1M") or item.get("input_cost") or item.get("input_price") or 0.0)
        except Exception:
            inputCost = 0.0
            
        try:
            outputCost = float(item.get("outputCostPer1M") or item.get("output_cost") or item.get("output_price") or 0.0)
        except Exception:
            outputCost = 0.0

        known_keys = {
            "id", "name", "title", "label", "model_id", "model",
            "enabled", "toolCalling", "tool_calling", "function_calling", "tools",
            "vision", "multimodal", "free",
            "maxInputTokens", "max_input_tokens", "context_length",
            "maxOutputTokens", "max_output_tokens",
            "inputCostPer1M", "input_cost", "input_price",
            "outputCostPer1M", "output_cost", "output_price",
            "extra"
        }
        extra = item.get("extra") if isinstance(item.get("extra"), dict) else {}
        for k, val in item.items():
            if k not in known_keys and k not in extra:
                extra[k] = val

        return ModelSpec(
            id=mid,
            name=name,
            toolCalling=toolCalling,
            vision=vision,
            free=free,
            maxInputTokens=maxInputTokens,
            maxOutputTokens=maxOutputTokens,
            enabled=enabled,
            inputCostPer1M=inputCost,
            outputCostPer1M=outputCost,
            extra=extra
        )
    return None

def _normalize_provider_item(v: Any, fallback_id: str = "") -> Optional[Provider]:
    if not isinstance(v, dict):
        return None
    
    # 1. Resolve ID
    raw_id = str(v.get("id") or v.get("provider_id") or v.get("slug") or v.get("name") or fallback_id or "").strip()
    if not raw_id:
        raw_id = f"provider-{int(time.time()*1000)}"
    pid = re.sub(r'[^a-zA-Z0-9_\-]', '-', raw_id).strip('-').lower() or f"p-{int(time.time())}"

    # 2. Resolve Name
    name = str(v.get("name") or v.get("title") or v.get("label") or v.get("provider_name") or raw_id or pid).strip()

    # 3. Resolve Protocol
    protocol = str(v.get("protocol") or v.get("type") or v.get("provider_type") or v.get("format") or "openai-compatible").strip().lower()
    if protocol in ("openai", "chatgpt", "openai_compatible", "openai-v1"):
        protocol = "openai-compatible"
    elif protocol in ("claude", "anthropic_v1"):
        protocol = "anthropic"
    elif protocol in ("google", "google_gemini", "gemini_api"):
        protocol = "gemini"
    elif protocol not in ("openai-compatible", "anthropic", "gemini", "ollama", "mistral", "azure", "cloudflare"):
        protocol = "openai-compatible"

    # 4. Resolve URL
    url = str(v.get("url") or v.get("base_url") or v.get("baseUrl") or v.get("endpoint") or v.get("api_base") or v.get("apiUrl") or v.get("address") or v.get("host") or "").strip()
    if not url:
        if protocol == "ollama":
            url = "http://localhost:11434"
        elif protocol == "anthropic":
            url = "https://api.anthropic.com"
        else:
            url = "https://api.openai.com/v1"

    # 5. Resolve API Key & API Keys
    api_key = str(v.get("apiKey") or v.get("api_key") or v.get("key") or v.get("token") or v.get("secret") or v.get("auth_token") or "").strip()
    
    raw_keys = v.get("apiKeys") or v.get("api_keys") or v.get("keys") or v.get("tokens") or []
    api_keys: List[str] = []
    
    if isinstance(raw_keys, list):
        for k in raw_keys:
            if isinstance(k, str) and k.strip():
                k_clean = k.strip()
                if k_clean not in api_keys:
                    api_keys.append(k_clean)
            elif isinstance(k, dict):
                # Handle dictionary items like {"key": "sk-...", "label": "...", "enabled": true}
                dict_key = str(k.get("key") or k.get("apiKey") or k.get("api_key") or k.get("token") or k.get("secret") or "").strip()
                if dict_key and dict_key not in api_keys:
                    api_keys.append(dict_key)
    elif isinstance(raw_keys, str) and raw_keys.strip():
        for k in re.split(r'[,\n;]+', raw_keys):
            k_clean = k.strip()
            if k_clean and k_clean not in api_keys:
                api_keys.append(k_clean)

    if api_key and api_key not in api_keys:
        api_keys.insert(0, api_key)
    elif not api_key and api_keys:
        api_key = api_keys[0]

    # 6. Resolve Enabled
    enabled_val = v.get("enabled", True)
    if isinstance(enabled_val, str):
        enabled = enabled_val.lower() in ("true", "1", "yes", "on", "active")
    else:
        enabled = bool(enabled_val)

    # 7. Resolve Models
    raw_models = v.get("models") or v.get("model_list") or v.get("available_models") or []
    models = []
    if isinstance(raw_models, list):
        for m in raw_models:
            norm_m = _normalize_model_spec(m)
            if norm_m and norm_m.id not in [x.id for x in models]:
                models.append(norm_m)
    elif isinstance(raw_models, str) and raw_models.strip():
        for mstr in re.split(r'[,\n;]+', raw_models):
            norm_m = _normalize_model_spec(mstr)
            if norm_m and norm_m.id not in [x.id for x in models]:
                models.append(norm_m)
    elif isinstance(raw_models, dict):
        for mk, mv in raw_models.items():
            if isinstance(mv, dict) and "id" not in mv:
                mv["id"] = mk
            norm_m = _normalize_model_spec(mv if isinstance(mv, dict) else mk)
            if norm_m and norm_m.id not in [x.id for x in models]:
                models.append(norm_m)

    # If single "model" or "default_model" field exists and models list is empty
    single_model = str(v.get("model") or v.get("default_model") or v.get("model_id") or "").strip()
    if single_model and not models:
        models.append(ModelSpec(id=single_model, name=single_model, enabled=True))

    if not models:
        if protocol == "ollama":
            models.append(ModelSpec(id="llama3.2", name="Llama 3.2 (Local)", toolCalling=True, free=True))
            models.append(ModelSpec(id="qwen2.5-coder:7b", name="Qwen 2.5 Coder 7B (Local)", toolCalling=True, free=True))
            models.append(ModelSpec(id="deepseek-r1:8b", name="DeepSeek R1 8B (Local)", toolCalling=True, free=True))
        elif protocol == "anthropic":
            models.append(ModelSpec(id="claude-3-7-sonnet-20250219", name="Claude 3.7 Sonnet", toolCalling=True, vision=True))
            models.append(ModelSpec(id="claude-3-5-sonnet-20241022", name="Claude 3.5 Sonnet", toolCalling=True, vision=True))
        else:
            models.append(ModelSpec(id="gpt-4o", name="gpt-4o", toolCalling=True, vision=True))

    vendor = str(v.get("vendor") or "custom").strip()
    api_key_env = str(v.get("apiKeyEnv") or v.get("api_key_env") or v.get("env_key") or "").strip()
    proxy_url = str(v.get("proxyUrl") or v.get("proxy_url") or v.get("proxy") or "").strip()
    priority = int(v.get("priority") or 1)
    timeout_sec = int(v.get("timeoutSec") or v.get("timeout_sec") or v.get("timeout") or 120)
    
    known_prov_keys = {
        "id", "provider_id", "slug", "name", "title", "label", "provider_name",
        "url", "base_url", "baseUrl", "endpoint", "api_base", "apiUrl", "address", "host",
        "protocol", "type", "provider_type", "format",
        "apiKey", "api_key", "key", "token", "secret", "auth_token",
        "apiKeys", "api_keys", "keys", "tokens",
        "apiKeyEnv", "api_key_env", "env_key",
        "proxyUrl", "proxy_url", "proxy",
        "priority", "timeoutSec", "timeout_sec", "timeout",
        "models", "model_list", "available_models", "model", "default_model", "model_id",
        "enabled", "vendor", "extra"
    }
    extra = v.get("extra") if isinstance(v.get("extra"), dict) else {}
    for k, val in v.items():
        if k not in known_prov_keys and k not in extra:
            extra[k] = val

    return Provider(
        id=pid,
        name=name,
        vendor=vendor,
        url=url,
        protocol=protocol,
        enabled=enabled,
        apiKey=api_key,
        apiKeys=api_keys,
        apiKeyEnv=api_key_env,
        proxyUrl=proxy_url,
        priority=priority,
        timeoutSec=timeout_sec,
        models=models,
        extra=extra
    )

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
    def __init__(self, path: Optional[str] = None, data_path: Optional[str] = None):
        target_path = path or data_path
        self.path = Path(os.getenv("PROVIDERS_FILE", target_path or DATA_DIR / "providers.json"))
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
        if is_error:
            CIRCUIT_BREAKER.record_failure(provider_id)
        else:
            CIRCUIT_BREAKER.record_success(provider_id)

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

    def get_verified_fallback_candidates(
        self,
        exclude_provider_id: Optional[str] = None,
        exclude_model_id: Optional[str] = None,
        prefer_different_provider: bool = False
    ) -> List[Tuple[Provider, ModelSpec]]:
        """Return a list of (Provider, ModelSpec) that passed diagnostic health checks, ordered by lowest latency and reliability."""
        verified_candidates: List[Tuple[Provider, ModelSpec]] = []
        seen = set()

        try:
            with get_db() as conn:
                rows = conn.execute("""
                    SELECT provider_id, model_id, last_latency_ms
                    FROM provider_metrics
                    WHERE last_status = 'ok'
                    ORDER BY last_latency_ms ASC, updated_at DESC
                """).fetchall()

                for row in rows:
                    pid = row["provider_id"]
                    mid = row["model_id"]
                    if pid == exclude_provider_id and mid == exclude_model_id:
                        continue
                    if (pid, mid) in seen:
                        continue

                    provider = self.data.get(pid)
                    if not provider or not provider.enabled or CIRCUIT_BREAKER.is_tripped(pid):
                        continue

                    # Verify key exists if not ollama
                    api_key = self.get_api_key(provider)
                    if not api_key and provider.protocol != "ollama":
                        continue

                    # Find ModelSpec
                    model = next((m for m in (provider.models or []) if m.id == mid), None)
                    if not model:
                        model = ModelSpec(id=mid, name=mid, toolCalling=True)

                    verified_candidates.append((provider, model))
                    seen.add((pid, mid))
        except Exception:
            pass

        if prefer_different_provider and exclude_provider_id:
            verified_candidates.sort(key=lambda item: 0 if item[0].id != exclude_provider_id else 1)

        return verified_candidates

    def export_json(self) -> str:
        dump = {}
        for k, v in self.data.items():
            d = v.model_dump(exclude_none=True)
            d["apiKey"] = "" # Export without keys for security
            d["apiKeys"] = []
            dump[k] = d
        return json.dumps(dump, ensure_ascii=False, indent=2)

    def import_json(self, text: str, replace: bool = False) -> int:
        clean = _clean_json_text(text)
        if not clean:
            raise ValueError("Input JSON is empty.")
        
        incoming = None
        try:
            incoming = json.loads(clean)
        except Exception:
            try:
                # Try AST eval for Python dictionary format (single quotes, True/False)
                incoming = ast.literal_eval(clean)
            except Exception as e:
                raise ValueError(f"Invalid JSON/format: {str(e)}")

        # Unwrap top-level dictionary wrappers like {"providers": [...]}, {"data": [...]}, {"items": [...]}
        if isinstance(incoming, dict):
            for wrapper_key in ("providers", "data", "items", "provider_list", "custom_providers", "models", "list"):
                if wrapper_key in incoming and isinstance(incoming[wrapper_key], (list, dict)):
                    incoming = incoming[wrapper_key]
                    break

        parsed = {}
        if isinstance(incoming, list):
            for idx, item in enumerate(incoming):
                p = _normalize_provider_item(item, fallback_id=f"provider-{idx+1}")
                if p:
                    parsed[p.id] = p
        elif isinstance(incoming, dict):
            for k, v in incoming.items():
                p = _normalize_provider_item(v, fallback_id=k)
                if p:
                    parsed[p.id] = p
        else:
            raise ValueError("Import data must be a JSON array of providers or an object mapping.")

        if not parsed:
            raise ValueError("No valid providers could be parsed from the provided input.")

        if replace:
            self.data = parsed
        else:
            self.data.update(parsed)
        self.save()
        return len(parsed)

    def import_models_for_provider(self, provider_id: str, text: str, replace: bool = False) -> Dict[str, Any]:
        if provider_id not in self.data:
            raise ValueError(f"Provider '{provider_id}' not found.")
        clean = _clean_json_text(text)
        if not clean:
            raise ValueError("Input JSON is empty.")
        
        incoming = None
        try:
            incoming = json.loads(clean)
        except Exception:
            try:
                incoming = ast.literal_eval(clean)
            except Exception as e:
                raise ValueError(f"Invalid JSON/format: {str(e)}")

        candidates = []
        if isinstance(incoming, dict):
            if "data" in incoming and isinstance(incoming["data"], list):
                candidates = incoming["data"]
            elif "models" in incoming and isinstance(incoming["models"], list):
                candidates = incoming["models"]
            elif "items" in incoming and isinstance(incoming["items"], list):
                candidates = incoming["items"]
            else:
                candidates = [incoming]
        elif isinstance(incoming, list):
            candidates = incoming
        else:
            candidates = [incoming]

        models = []
        for item in candidates:
            m = _normalize_model_spec(item)
            if m:
                models.append(m)

        if not models:
            raise ValueError("No valid models found in the import payload.")

        existing = self.data[provider_id]
        by_id = {}
        if not replace:
            for em in existing.models:
                by_id[em.id] = em

        added = 0
        updated = 0
        for nm in models:
            if nm.id in by_id:
                by_id[nm.id] = nm
                updated += 1
            else:
                by_id[nm.id] = nm
                added += 1

        existing.models = list(by_id.values())
        self.save()
        return {
            "ok": True,
            "provider": provider_id,
            "modelsCount": len(existing.models),
            "added": added,
            "updated": updated,
            "replace": replace
        }

PROVIDER_STORE = ProviderStore()
