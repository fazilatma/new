from typing import Any
from pydantic import BaseModel, Field

class ModelSpec(BaseModel):
    id: str
    name: str = ""
    toolCalling: bool = False
    vision: bool = False
    free: bool = False
    maxInputTokens: int = 0
    maxOutputTokens: int = 8192
    enabled: bool = True
    extra: dict[str, Any] = Field(default_factory=dict)

class Provider(BaseModel):
    id: str
    name: str
    vendor: str
    url: str
    protocol: str = "openai-compatible"
    enabled: bool = False
    apiKey: str = ""
    apiKeyEnv: str = ""
    models: list[ModelSpec] = Field(default_factory=list)
    extra: dict[str, Any] = Field(default_factory=dict)
