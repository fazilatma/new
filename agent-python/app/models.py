"""Data models for Providers, Models, Protocols, and Testing."""
from typing import Any, List, Dict, Optional
from pydantic import BaseModel, Field

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
