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

def resolve_provider_endpoint_url(base_url: str, protocol: str, model_id: str = "") -> str:
    url = (base_url or "").strip().rstrip("/")
    if not url:
        if protocol == "ollama":
            url = "http://localhost:11434"
        elif protocol == "anthropic":
            url = "https://api.anthropic.com"
        elif protocol in ("cloudflare", "cloudflare-workers-ai", "workers-ai"):
            url = "https://api.cloudflare.com/client/v4"
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
    elif protocol in ("cloudflare", "cloudflare-workers-ai", "workers-ai"):
        # Cloudflare Workers AI's native REST API takes the model as a *path
        # segment* (`/ai/run/{model}`), never a body field. Strip any
        # `/ai/run/...` or `/ai/v1...` suffix a previously-configured base
        # URL may already carry (e.g. copy-pasted from Cloudflare's docs with
        # a sample model baked in) so the account root can be recombined with
        # whichever model is actually selected — this is what used to make
        # every Cloudflare request hit the exact same hardcoded model
        # regardless of which one the caller picked.
        account_root = re.sub(r'/ai/(run|v1)(/.*)?$', '', url)
        model_path = (model_id or "").strip().lstrip("/")
        return f"{account_root}/ai/run/{model_path}" if model_path else f"{account_root}/ai/run"
    else: # openai-compatible, mistral, gemini, openrouter, custom
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

def _repair_truncated_json(text: str) -> Optional[Any]:
    t = text.strip()
    if len(t) < 2:
        return None
    in_str = False
    escape = False
    stack = []
    for ch in t:
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_str = not in_str
            continue
        if not in_str:
            if ch in ('{', '['):
                stack.append(ch)
            elif ch == '}':
                if stack and stack[-1] == '{':
                    stack.pop()
            elif ch == ']':
                if stack and stack[-1] == '[':
                    stack.pop()

    repaired = t
    if in_str:
        repaired += '"'

    repaired = re.sub(r',\s*$', '', repaired)
    repaired = re.sub(r':\s*$', ': null', repaired)
    repaired = re.sub(r',\s*([}\]])', r'\1', repaired)

    while stack:
        open_b = stack.pop()
        repaired = re.sub(r',\s*$', '', repaired)
        if open_b == '{':
            if re.search(r'"[^"]+"\s*:\s*$', repaired):
                repaired += 'null'
            repaired += '}'
        elif open_b == '[':
            repaired += ']'

    try:
        return json.loads(repaired)
    except Exception:
        pass

    last_comma = t.rfind(',')
    if last_comma > 10:
        return _repair_truncated_json(t[:last_comma])
    return None

def _decode_relaxed_json(text: str) -> Any:
    clean = _clean_json_text(text)
    if not clean:
        raise ValueError("Input text is empty.")
    try:
        return json.loads(clean)
    except Exception:
        pass
    
    # Try removing trailing commas
    relaxed = re.sub(r',\s*([}\]])', r'\1', clean)
    try:
        return json.loads(relaxed)
    except Exception:
        pass

    # Try auto-repairing truncated JSON
    repaired = _repair_truncated_json(clean)
    if repaired is not None:
        return repaired

    # Try AST literal eval for Python dict syntax
    try:
        return ast.literal_eval(clean)
    except Exception:
        pass

    # Fallback to plain text line-by-line model list
    lines = [l.strip(" \t\r\n,;\"'") for l in clean.splitlines()]
    plain_models = []
    for l in lines:
        if not l or l.startswith("#") or l.startswith("//"):
            continue
        plain_models.append({"id": l, "name": l})
    if plain_models:
        return {"models": plain_models}

    raise ValueError("Invalid format: input could not be parsed as JSON or a list of models.")

def _normalize_model_spec(item: Any) -> Optional[ModelSpec]:
    if not item:
        return None
    if isinstance(item, str):
        mid = item.strip()
        if not mid:
            return None
        return ModelSpec(id=mid, name=mid, enabled=True)
    if isinstance(item, dict):
        mid = str(item.get("id") or item.get("name") or item.get("model_id") or item.get("modelId") or item.get("model") or item.get("slug") or "").strip()
        name = str(item.get("name") or item.get("title") or item.get("label") or item.get("displayName") or item.get("display_name") or mid).strip()
        if not name:
            name = mid
        if not mid and name:
            mid = name
        if not mid:
            return None
        
        enabled_val = item.get("enabled", True)
        if isinstance(enabled_val, str):
            enabled = enabled_val.lower() in ("true", "1", "yes", "on", "active")
        else:
            enabled = bool(enabled_val)

        toolCalling = bool(item.get("toolCalling") or item.get("tool_calling") or item.get("function_calling") or item.get("tools") or False)
        vision = bool(item.get("vision") or item.get("multimodal") or False)
        free = bool(item.get("free") or False)
        
        try:
            maxInputTokens = int(item.get("maxInputTokens") or item.get("max_input_tokens") or item.get("context_length") or item.get("contextLength") or 128000)
        except Exception:
            maxInputTokens = 128000
            
        try:
            maxOutputTokens = int(item.get("maxOutputTokens") or item.get("max_output_tokens") or item.get("max_tokens") or 8192)
        except Exception:
            maxOutputTokens = 8192
            
        try:
            inputCost = float(item.get("inputCostPer1M") or item.get("input_cost") or item.get("input_cost_per_1m") or item.get("input_price") or 0.0)
        except Exception:
            inputCost = 0.0
            
        try:
            outputCost = float(item.get("outputCostPer1M") or item.get("output_cost") or item.get("output_cost_per_1m") or item.get("output_price") or 0.0)
        except Exception:
            outputCost = 0.0

        known_keys = {
            "id", "name", "title", "label", "model_id", "modelId", "model", "slug", "displayName", "display_name",
            "enabled", "toolCalling", "tool_calling", "function_calling", "tools",
            "vision", "multimodal", "free",
            "maxInputTokens", "max_input_tokens", "context_length", "contextLength",
            "maxOutputTokens", "max_output_tokens", "max_tokens",
            "inputCostPer1M", "input_cost", "input_cost_per_1m", "input_price",
            "outputCostPer1M", "output_cost", "output_cost_per_1m", "output_price",
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
    
    # Avoid parsing a standalone model spec as a provider
    is_provider = any(k in v for k in ("models", "url", "baseUrl", "base_url", "protocol", "apiKey", "api_key", "vendor", "endpoint", "apiKeys", "api_keys"))
    if not is_provider and any(k in v for k in ("maxInputTokens", "max_input_tokens", "maxOutputTokens", "max_output_tokens", "toolCalling", "tool_calling", "vision", "multimodal", "context_length", "contextLength")):
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
    elif protocol in ("cloudflare-workers-ai", "cloudflare_workers_ai", "cf", "cf-ai", "workersai"):
        protocol = "cloudflare"
    elif protocol not in ("openai-compatible", "anthropic", "gemini", "ollama", "mistral", "azure", "cloudflare"):
        protocol = "openai-compatible"

    # 4. Resolve URL
    url = str(v.get("url") or v.get("base_url") or v.get("baseUrl") or v.get("endpoint") or v.get("api_base") or v.get("apiUrl") or v.get("address") or v.get("host") or "").strip()
    if not url:
        if protocol == "ollama":
            url = "http://localhost:11434"
        elif protocol == "anthropic":
            url = "https://api.anthropic.com"
        elif protocol == "cloudflare":
            url = "https://api.cloudflare.com/client/v4"
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
                if raw:
                    return {k: Provider.model_validate(v) for k, v in raw.items()}
            except Exception:
                pass
        seed = Path(__file__).parents[1] / "data" / "providers.json"
        if seed.exists():
            try:
                raw = json.loads(seed.read_text(encoding="utf-8"))
                if raw:
                    return {k: Provider.model_validate(v) for k, v in raw.items()}
            except Exception:
                pass
        return self._default_seed_providers()

    @staticmethod
    def _default_seed_providers() -> Dict[str, Provider]:
        return {
            "openrouter": Provider(
                id="openrouter",
                name="OpenRouter",
                url="https://openrouter.ai/api/v1",
                protocol="openai-compatible",
                apiKeyEnv="OPENROUTER_API_KEY",
                models=[
                    ModelSpec(id="anthropic/claude-3.7-sonnet", name="Claude 3.7 Sonnet", toolCalling=True, vision=True),
                    ModelSpec(id="anthropic/claude-3.5-sonnet", name="Claude 3.5 Sonnet", toolCalling=True, vision=True),
                    ModelSpec(id="openai/gpt-4o", name="GPT-4o", toolCalling=True, vision=True),
                    ModelSpec(id="deepseek/deepseek-r1", name="DeepSeek R1", toolCalling=True),
                    ModelSpec(id="deepseek/deepseek-chat", name="DeepSeek V3", toolCalling=True),
                    ModelSpec(id="meta-llama/llama-3.3-70b-instruct", name="Llama 3.3 70B", toolCalling=True)
                ]
            ),
            "ollama": Provider(
                id="ollama",
                name="Ollama (Local AI)",
                url="http://localhost:11434",
                protocol="ollama",
                enabled=True,
                models=[
                    ModelSpec(id="llama3.2", name="Llama 3.2 (Local)", toolCalling=True, free=True),
                    ModelSpec(id="qwen2.5-coder:7b", name="Qwen 2.5 Coder 7B (Local)", toolCalling=True, free=True),
                    ModelSpec(id="deepseek-r1:8b", name="DeepSeek R1 8B (Local)", toolCalling=True, free=True)
                ]
            ),
            "openai": Provider(
                id="openai",
                name="OpenAI Official",
                url="https://api.openai.com/v1",
                protocol="openai-compatible",
                apiKeyEnv="OPENAI_API_KEY",
                models=[
                    ModelSpec(id="gpt-4o", name="GPT-4o", toolCalling=True, vision=True),
                    ModelSpec(id="gpt-4o-mini", name="GPT-4o Mini", toolCalling=True, vision=True),
                    ModelSpec(id="o3-mini", name="o3-mini", toolCalling=True)
                ]
            ),
            "anthropic": Provider(
                id="anthropic",
                name="Anthropic Claude",
                url="https://api.anthropic.com",
                protocol="anthropic",
                apiKeyEnv="ANTHROPIC_API_KEY",
                models=[
                    ModelSpec(id="claude-3-7-sonnet-20250219", name="Claude 3.7 Sonnet", toolCalling=True, vision=True),
                    ModelSpec(id="claude-3-5-sonnet-20241022", name="Claude 3.5 Sonnet", toolCalling=True, vision=True),
                    ModelSpec(id="claude-3-5-haiku-20241022", name="Claude 3.5 Haiku", toolCalling=True)
                ]
            )
        }

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
        incoming = _decode_relaxed_json(text)

        # Unwrap top-level dictionary wrappers like {"providers": [...]}, {"data": [...]}, {"items": [...]}
        if isinstance(incoming, dict):
            for wrapper_key in ("providers", "data", "items", "provider_list", "custom_providers", "catalog", "config", "result", "list"):
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
                p = _normalize_provider_item(v, fallback_id=str(k))
                if p:
                    parsed[p.id] = p
        else:
            raise ValueError("Import data must be a JSON array of providers or an object mapping.")

        if not parsed:
            # Check if input was a model list and attach to active provider
            if self.data:
                target_pid = next(iter(self.data))
                try:
                    res = self.import_models_for_provider(target_pid, text, replace=replace)
                    return len(self.data)
                except Exception:
                    pass
            raise ValueError("No valid providers could be parsed from the provided input.")

        if replace:
            self.data = parsed
        else:
            self.data.update(parsed)
        self.save()
        return len(parsed)

    def import_models_for_provider(self, provider_id: str, text: str, replace: bool = False) -> Dict[str, Any]:
        if provider_id not in self.data:
            prov_name = provider_id.replace('-', ' ').replace('_', ' ').title()
            default_url = "http://localhost:11434" if provider_id == "ollama" else ("https://api.anthropic.com" if provider_id == "anthropic" else "https://api.openai.com/v1")
            default_protocol = "ollama" if provider_id == "ollama" else ("anthropic" if provider_id == "anthropic" else "openai-compatible")
            self.data[provider_id] = Provider(
                id=provider_id,
                name=prov_name,
                url=default_url,
                protocol=default_protocol,
                models=[]
            )
        incoming = _decode_relaxed_json(text)

        candidates = []
        if isinstance(incoming, dict):
            if provider_id in incoming and isinstance(incoming[provider_id], dict) and "models" in incoming[provider_id] and isinstance(incoming[provider_id]["models"], list):
                candidates = incoming[provider_id]["models"]
            elif "data" in incoming and isinstance(incoming["data"], list):
                candidates = incoming["data"]
            elif "models" in incoming and isinstance(incoming["models"], list):
                candidates = incoming["models"]
            elif "items" in incoming and isinstance(incoming["items"], list):
                candidates = incoming["items"]
            elif "options" in incoming and isinstance(incoming["options"], list):
                candidates = incoming["options"]
            elif "results" in incoming and isinstance(incoming["results"], list):
                candidates = incoming["results"]
            elif "models" in incoming and isinstance(incoming["models"], dict):
                candidates = [{"id": k, **(v if isinstance(v, dict) else {"name": str(v)})} for k, v in incoming["models"].items()]
            else:
                # Check if any sub-dictionary contains a 'models' array (nested provider dictionary)
                found_sub_models = []
                for k, v in incoming.items():
                    if isinstance(v, dict) and "models" in v and isinstance(v["models"], list):
                        found_sub_models.extend(v["models"])
                if found_sub_models:
                    candidates = found_sub_models
                else:
                    is_dict_of_models = all(isinstance(v, (dict, str)) for v in incoming.values()) and ("url" not in incoming and "baseUrl" not in incoming and "base_url" not in incoming)
                    if is_dict_of_models and incoming:
                        candidates = [{"id": k, **(v if isinstance(v, dict) else {"name": str(v)})} for k, v in incoming.items()]
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
