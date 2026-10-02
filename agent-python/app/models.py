"""Data models for Providers, Models, Protocols, and Testing."""
from typing import Any, List, Dict, Optional
from pydantic import BaseModel, Field, field_validator

# Legacy/alias protocol identifiers that must be canonicalized to the value
# the request-building and response-parsing code actually branches on. A
# previous catalog revision shipped "cloudflare-workers-ai" for the built-in
# Cloudflare Workers AI preset; that string matched none of the protocol
# branches in chat.py/providers.py/main.py, so every such provider silently
# fell through to the generic openai-compatible request builder — ignoring
# the selected model entirely and reusing whatever URL happened to be
# configured. Canonicalizing here means both the bundled seed catalog and
# any already-persisted user `providers.json` self-heal on next load.
_PROTOCOL_ALIASES = {
    "cloudflare-workers-ai": "cloudflare",
    "cloudflare_workers_ai": "cloudflare",
    "cf": "cloudflare",
    "cf-ai": "cloudflare",
    "workersai": "cloudflare",
}

class ModelSpec(BaseModel):
    id: str
    name: str = ""
    toolCalling: bool = False
    vision: bool = False
    free: bool = False
    maxInputTokens: int = 128000
    maxOutputTokens: int = 8192
    enabled: bool = True
    inputCostPer1M: float = 0.0
    outputCostPer1M: float = 0.0
    extra: Dict[str, Any] = Field(default_factory=dict)

class Provider(BaseModel):
    id: str
    name: str
    vendor: str = "custom"
    url: str
    protocol: str = "openai-compatible" # openai-compatible, anthropic, gemini, ollama, mistral, azure, cloudflare
    enabled: bool = False
    apiKey: str = ""
    apiKeys: List[str] = Field(default_factory=list) # Multi-key rotation
    apiKeyEnv: str = ""
    proxyUrl: str = ""
    priority: int = 1 # Higher priority gets used first
    timeoutSec: int = 120
    models: List[ModelSpec] = Field(default_factory=list)
    extra: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("protocol", mode="before")
    @classmethod
    def _canonicalize_protocol(cls, v: Any) -> Any:
        if isinstance(v, str):
            return _PROTOCOL_ALIASES.get(v.strip().lower(), v)
        return v
