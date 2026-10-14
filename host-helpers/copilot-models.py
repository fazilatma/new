#!/usr/bin/env python3
"""Manage OpenAI-compatible BYOK models for Copilot Chat in code-server.

The helper merges provider groups into the active profile's
User/chatLanguageModels.json file. It can also make the narrowly-scoped manifest
change needed to expose Copilot Chat's `customoai` provider on stable builds.

No third-party Python packages are required.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import termios
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Iterable
from xml.sax.saxutils import escape as xml_escape

BACKUP_SUFFIX = ".copilot-models-helper.bak"
CREATED_SUFFIX = ".copilot-models-helper.created"
CUSTOM_VENDOR = "customoai"
HELPER_VERSION = "0.1.7"
TOOLBOX_PUBLISHER = "fazilatma"
TOOLBOX_NAME = "copilot-models-toolbox"

PROVIDER_ALIASES = {
    "open-router": "openrouter",
    "together-ai": "together",
    "togetherai": "together",
    "hugging-face": "huggingface",
    "hf": "huggingface",
    "cloudflare-workers-ai": "cloudflare",
    "workers-ai": "cloudflare",
    "google": "gemini",
    "google-gemini": "gemini",
    "opencode": "opencode-zen",
    "open-code": "opencode-zen",
    "ollama-cloud": "ollama-cloud",
    "ollama-local": "ollama",
    "local-ollama": "ollama",
    "llm7.io": "llm7",
}
KNOWN_PROVIDER_SLUGS = {
    "openrouter",
    "together",
    "groq",
    "huggingface",
    "cloudflare",
    "gemini",
    "cerebras",
    "mistral",
    "cohere",
    "llm7",
    "opencode-zen",
    "ollama-cloud",
    "ollama",
}

NON_CHAT_HINTS = (
    "embedding",
    "embeddings",
    "embed-",
    "-embed",
    "rerank",
    "whisper",
    "transcription",
    "text-to-speech",
    "speech-to-text",
    "-tts",
    "tts-",
    "moderation",
    "stable-diffusion",
    "text-to-image",
    "image-generation",
    "imagegen",
    "imagen-",
    "flux-",
)

URL_FIELDS = ("baseUrl", "baseURL", "apiBase", "api_base", "endpoint", "url")


def eprint(*values: object) -> None:
    print(*values, file=sys.stderr)


def slugify(value: object) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return PROVIDER_ALIASES.get(text, text)


def first_value(mapping: dict[str, Any], fields: Iterable[str]) -> Any:
    for field in fields:
        value = mapping.get(field)
        if value is not None and value != "":
            return value
    return None


def as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        if value.strip().lower() in {"1", "true", "yes", "on", "supported"}:
            return True
        if value.strip().lower() in {"0", "false", "no", "off", "unsupported"}:
            return False
    return default


def as_positive_int(value: Any, default: int) -> int:
    if isinstance(value, bool):
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def nested_value(mapping: dict[str, Any], paths: Iterable[tuple[str, ...]]) -> Any:
    for path in paths:
        current: Any = mapping
        for part in path:
            if not isinstance(current, dict) or part not in current:
                current = None
                break
            current = current[part]
        if current is not None:
            return current
    return None


SOURCE_KEY_NAMES = {
    "apikey",
    "apikeys",
    "key",
    "keys",
    "token",
    "tokens",
    "accesstoken",
    "authtoken",
    "bearertoken",
    "secret",
    "secretkey",
    "credential",
    "credentials",
    "authorization",
    "auth",
}
SOURCE_KEY_SKIP_CONTAINERS = {"models", "model", "capabilities", "limits", "metadata"}


def normalized_field_name(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def usable_source_key(value: Any) -> tuple[str | None, str | None]:
    if isinstance(value, str):
        key = value.strip()
        if key.lower().startswith("bearer "):
            key = key[7:].strip()
        lowered = key.lower()
        if not key:
            return None, "empty"
        placeholder = (
            re.fullmatch(r"\$\{?[A-Za-z_][A-Za-z0-9_]*\}?", key)
            or lowered in {"none", "null", "undefined", "replace-me", "changeme"}
            or ("your" in lowered and "key" in lowered)
            or re.fullmatch(r"[*.•xX_-]{4,}", key)
            or (key.startswith("<") and key.endswith(">"))
        )
        if placeholder:
            return None, "placeholder-or-masked"
        return key, None
    if isinstance(value, list):
        issue: str | None = None
        # Prefer entries explicitly marked active/enabled before trying the rest.
        ordered = sorted(
            value,
            key=lambda item: not (
                isinstance(item, dict)
                and (as_bool(item.get("active")) or as_bool(item.get("enabled")))
            ),
        )
        for item in ordered:
            key, item_issue = usable_source_key(item)
            if key:
                return key, None
            issue = issue or item_issue
        return None, issue or "empty-list"
    if isinstance(value, dict):
        issue: str | None = None
        for field, nested in value.items():
            if normalized_field_name(field) not in SOURCE_KEY_NAMES:
                continue
            key, nested_issue = usable_source_key(nested)
            if key:
                return key, None
            issue = issue or nested_issue
        # Some exports store key records as {"value": "...", "active": true}.
        for field in ("value", "raw", "secretValue"):
            if field in value:
                key, nested_issue = usable_source_key(value[field])
                if key:
                    return key, None
                issue = issue or nested_issue
        return None, issue or "key-object-has-no-value"
    return None, "unsupported-key-type"


def extract_source_api_key(raw: dict[str, Any]) -> tuple[str | None, str]:
    queue: list[tuple[dict[str, Any], int]] = [(raw, 0)]
    seen: set[int] = set()
    issue: str | None = None
    while queue:
        current, depth = queue.pop(0)
        if id(current) in seen or depth > 5:
            continue
        seen.add(id(current))
        for field, value in current.items():
            if normalized_field_name(field) not in SOURCE_KEY_NAMES:
                continue
            key, value_issue = usable_source_key(value)
            if key:
                return key, "imported"
            issue = issue or value_issue
        for field, value in current.items():
            if normalized_field_name(field) in SOURCE_KEY_SKIP_CONTAINERS:
                continue
            if isinstance(value, dict):
                queue.append((value, depth + 1))
            elif isinstance(value, list):
                queue.extend(
                    (item, depth + 1) for item in value if isinstance(item, dict)
                )
    return None, issue or "not-found"


def source_credential_map(root: Any) -> dict[str, tuple[str | None, str]]:
    if not isinstance(root, dict):
        return {}
    container_names = {
        "apikeys",
        "providerkeys",
        "providercredentials",
        "credentials",
        "secrets",
        "tokens",
    }
    containers: list[Any] = []
    for field, value in root.items():
        if normalized_field_name(field) in container_names:
            containers.append(value)
    for parent in ("settings", "config", "configuration", "data"):
        value = root.get(parent)
        if not isinstance(value, dict):
            continue
        for field, nested in value.items():
            if normalized_field_name(field) in container_names:
                containers.append(nested)

    output: dict[str, tuple[str | None, str]] = {}
    for container in containers:
        if isinstance(container, dict):
            for identity, value in container.items():
                slug = slugify(identity)
                if not slug or normalized_field_name(identity) in SOURCE_KEY_NAMES:
                    continue
                source_key, key_status = usable_source_key(value)
                output[slug] = (
                    source_key,
                    "imported" if source_key else (key_status or "not-found"),
                )
        elif isinstance(container, list):
            for record in container:
                if not isinstance(record, dict):
                    continue
                identity = first_value(
                    record,
                    ("provider", "providerId", "provider_id", "slug", "id", "name"),
                )
                slug = slugify(identity)
                if not slug:
                    continue
                output[slug] = extract_source_api_key(record)
    return output


def has_non_chat_endpoint(model: dict[str, Any]) -> bool:
    if as_bool(model.get("nonChat")) or as_bool(model.get("non_chat")):
        return True
    endpoint_type = str(
        first_value(model, ("endpointType", "endpoint_type", "task", "type")) or ""
    ).lower()
    if endpoint_type and endpoint_type not in {
        "chat",
        "chat-completions",
        "chat_completions",
        "openai-chat",
        "responses",
        "text-generation",
        "text_generation",
        "conversational",
    }:
        return any(
            token in endpoint_type
            for token in (
                "embed",
                "audio",
                "speech",
                "image",
                "video",
                "rerank",
                "moderation",
                "batch",
                "nonchat",
                "non-chat",
            )
        )
    return False


def looks_non_chat(model_id: str) -> bool:
    lowered = model_id.lower()
    return any(hint in lowered for hint in NON_CHAT_HINTS)


def normalize_model(
    raw: Any,
    provider_url: str,
    *,
    include_non_chat: bool = False,
    defaults: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    defaults = defaults or {}
    if isinstance(raw, str):
        raw = {"id": raw, "name": raw}
    if not isinstance(raw, dict):
        return None

    # Exports often carry both an internal database `id` and the actual API
    # model identifier. Prefer the latter or requests are sent with a UUID.
    model_id = first_value(raw, ("modelId", "model_id", "model", "slug", "id"))
    if not isinstance(model_id, str) or not model_id.strip():
        return None
    model_id = model_id.strip()

    if not include_non_chat and (has_non_chat_endpoint(raw) or looks_non_chat(model_id)):
        return None

    capabilities = raw.get("capabilities") if isinstance(raw.get("capabilities"), dict) else {}
    input_modalities = nested_value(
        raw,
        (
            ("modalities", "input"),
            ("architecture", "input_modalities"),
            ("inputModalities",),
        ),
    )
    if not isinstance(input_modalities, list):
        input_modalities = []

    tool_value = nested_value(
        raw,
        (
            ("toolCalling",),
            ("tool_call",),
            ("supportsTools",),
            ("supportsToolCalling",),
            ("capabilities", "toolCalling"),
            ("capabilities", "tools"),
        ),
    )
    vision_value = nested_value(
        raw,
        (
            ("vision",),
            ("supportsVision",),
            ("attachment",),
            ("capabilities", "vision"),
            ("capabilities", "imageInput"),
        ),
    )
    thinking_value = nested_value(
        raw,
        (
            ("thinking",),
            ("reasoning",),
            ("supportsReasoning",),
            ("capabilities", "thinking"),
            ("capabilities", "reasoning"),
        ),
    )
    streaming_value = nested_value(
        raw,
        (
            ("streaming",),
            ("supportsStreaming",),
            ("capabilities", "streaming"),
        ),
    )

    max_input = nested_value(
        raw,
        (
            ("maxInputTokens",),
            ("max_input_tokens",),
            ("contextLength",),
            ("context_length",),
            ("contextWindow",),
            ("inputTokenLimit",),
            ("limit", "input"),
            ("limit", "context"),
        ),
    )
    max_output = nested_value(
        raw,
        (
            ("maxOutputTokens",),
            ("max_output_tokens",),
            ("maxCompletionTokens",),
            ("max_completion_tokens",),
            ("outputTokenLimit",),
            ("limit", "output"),
            ("top_provider", "max_completion_tokens"),
        ),
    )

    model_url = first_value(raw, URL_FIELDS) or provider_url
    if not isinstance(model_url, str) or not model_url.strip():
        return None

    name = first_value(raw, ("name", "displayName", "display_name", "label"))
    model = {
        "id": model_id,
        "name": str(name or model_id),
        "url": normalize_api_url(model_url.strip()),
        # Sending tools to an unknown model commonly causes a 400 response.
        # Opt in only when the export or maintained catalog says it supports them.
        "toolCalling": as_bool(tool_value, as_bool(defaults.get("toolCalling"), False)),
        "vision": as_bool(
            vision_value,
            "image" in input_modalities or as_bool(defaults.get("vision"), False),
        ),
        "maxInputTokens": as_positive_int(
            max_input, as_positive_int(defaults.get("maxInputTokens"), 131072)
        ),
        "maxOutputTokens": as_positive_int(
            max_output, as_positive_int(defaults.get("maxOutputTokens"), 16384)
        ),
        # Copilot adds `stream_options.include_usage` to streamed requests.
        # Several otherwise OpenAI-compatible services reject that field, while
        # all supported chat-completions surfaces accept non-streamed requests.
        "streaming": as_bool(
            streaming_value, as_bool(defaults.get("streaming"), False)
        ),
    }
    if as_bool(thinking_value, as_bool(defaults.get("thinking"), False)):
        model["thinking"] = True
    if isinstance(raw.get("editTools"), list):
        model["editTools"] = [str(item) for item in raw["editTools"]]
    if isinstance(raw.get("requestHeaders"), dict):
        model["requestHeaders"] = {
            str(key): str(value) for key, value in raw["requestHeaders"].items()
        }
    return model


def normalize_models(
    raw_models: Any,
    provider_url: str,
    *,
    include_non_chat: bool = False,
    defaults: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    entries: list[Any]
    if isinstance(raw_models, list):
        entries = raw_models
    elif isinstance(raw_models, dict):
        entries = []
        for model_id, value in raw_models.items():
            if isinstance(value, dict):
                entries.append({"id": model_id, **value})
            else:
                entries.append({"id": model_id, "name": value or model_id})
    else:
        entries = []

    output: list[dict[str, Any]] = []
    index: dict[str, int] = {}
    for entry in entries:
        model = normalize_model(
            entry,
            provider_url,
            include_non_chat=include_non_chat,
            defaults=defaults,
        )
        if model is None:
            continue
        if model["id"] in index:
            output[index[model["id"]]] = model
        else:
            index[model["id"]] = len(output)
            output.append(model)
    return output


def normalize_api_url(url: str) -> str:
    url = url.strip().rstrip("/")
    # A source export may contain a Cloudflare native URL pinned to one model.
    # Copilot's CustomOAI provider needs the OpenAI-compatible account endpoint.
    cloudflare = re.match(
        r"^(https://api\.cloudflare\.com/client/v4/accounts/[^/]+/ai)/run(?:/.*)?$", url
    )
    if cloudflare:
        return cloudflare.group(1) + "/v1"
    return url


def normalize_ollama_url(url: str) -> str:
    """Convert an OpenAI/native Ollama operation URL to the server root."""
    normalized = normalize_api_url(url)
    return re.sub(
        r"/(?:v1(?:/(?:chat/completions|models))?|api/(?:chat|generate|tags))$",
        "",
        normalized,
        flags=re.IGNORECASE,
    ).rstrip("/")


def canonical_provider_url(
    slug: str, maintained_url: str, imported_url: str
) -> str:
    """Use known OpenAI-compatible surfaces instead of native export URLs."""
    if slug == "ollama":
        return normalize_ollama_url(imported_url or maintained_url)
    if slug == "cloudflare":
        # Keep the account id from the export while replacing a native /run URL.
        account = re.search(r"/accounts/([^/]+)/ai(?:/|$)", imported_url)
        if account:
            return maintained_url.replace("${CLOUDFLARE_ACCOUNT_ID}", account.group(1))
    return maintained_url


def provider_objects(root: Any) -> list[dict[str, Any]]:
    if isinstance(root, list):
        return [item for item in root if isinstance(item, dict)]
    if not isinstance(root, dict):
        return []

    for field in (
        "providers",
        "customProviders",
        "modelProviders",
        "providerConfigs",
        "connections",
        "data",
    ):
        value = root.get(field)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            if any(
                nested in value
                for nested in ("providers", "customProviders", "modelProviders", "connections")
            ):
                return provider_objects(value)
            return [
                ({"id": key, **item} if isinstance(item, dict) else {"id": key})
                for key, item in value.items()
            ]

    if "models" in root and first_value(root, URL_FIELDS):
        return [root]

    candidates: list[dict[str, Any]] = []
    for key, value in root.items():
        if isinstance(value, dict) and "models" in value:
            candidates.append({"id": key, **value})
    return candidates


def normalize_provider(
    raw: dict[str, Any],
    *,
    include_non_chat: bool = False,
    import_source_keys: bool = False,
) -> dict[str, Any] | None:
    identity = first_value(raw, ("slug", "id", "providerId", "provider_id", "name"))
    slug = slugify(identity)
    name = first_value(raw, ("displayName", "display_name", "name", "label", "id"))
    name_slug = slugify(name)
    if slug not in KNOWN_PROVIDER_SLUGS and name_slug in KNOWN_PROVIDER_SLUGS:
        slug = name_slug
    url = first_value(raw, URL_FIELDS)
    if not url:
        url = nested_value(
            raw,
            tuple(
                (parent, field)
                for parent in ("config", "configuration", "settings", "connection")
                for field in URL_FIELDS
            ),
        )
    if not slug or not isinstance(url, str) or not url.strip():
        return None

    raw_models = raw.get("models")
    if raw_models is None:
        raw_models = nested_value(
            raw,
            (
                ("config", "models"),
                ("configuration", "models"),
                ("settings", "models"),
            ),
        )
    provider: dict[str, Any] = {
        "slug": slug,
        "name": str(name or slug),
        "baseUrl": normalize_api_url(url),
        "models": normalize_models(
            raw_models,
            normalize_api_url(url),
            include_non_chat=include_non_chat,
            defaults=raw.get("modelDefaults") if isinstance(raw.get("modelDefaults"), dict) else None,
        ),
    }
    for field in ("apiKeyEnv", "requiredEnv", "modelDefaults"):
        if field in raw:
            provider[field] = copy.deepcopy(raw[field])
    provider["enabled"] = raw.get("enabled", True)
    if import_source_keys:
        source_key, key_status = extract_source_api_key(raw)
        provider["sourceKeyStatus"] = key_status
        if source_key:
            provider["sourceApiKey"] = source_key
            provider["sourceKeyFingerprint"] = hashlib.sha256(
                source_key.encode("utf-8")
            ).hexdigest()[:10]
    return provider


def normalize_catalog(
    root: Any,
    *,
    include_non_chat: bool = False,
    import_source_keys: bool = False,
) -> list[dict[str, Any]]:
    providers: list[dict[str, Any]] = []
    shared_credentials = source_credential_map(root) if import_source_keys else {}
    for raw in provider_objects(root):
        provider = normalize_provider(
            raw,
            include_non_chat=include_non_chat,
            import_source_keys=import_source_keys,
        )
        if provider:
            if import_source_keys and not provider.get("sourceApiKey"):
                identities = {
                    provider["slug"],
                    slugify(provider.get("name")),
                    slugify(
                        first_value(
                            raw,
                            ("slug", "id", "providerId", "provider_id", "name"),
                        )
                    ),
                }
                for identity in identities:
                    if identity not in shared_credentials:
                        continue
                    source_key, key_status = shared_credentials[identity]
                    provider["sourceKeyStatus"] = key_status
                    if source_key:
                        provider["sourceApiKey"] = source_key
                        provider["sourceKeyFingerprint"] = hashlib.sha256(
                            source_key.encode("utf-8")
                        ).hexdigest()[:10]
                    break
            providers.append(provider)
    return providers


def load_json_source(location: str) -> Any:
    if location == "-":
        return json.load(sys.stdin)
    if re.match(r"^https?://", location):
        with urllib.request.urlopen(location, timeout=30) as response:
            return json.load(response)
    with Path(location).expanduser().open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_env_file(location: str) -> None:
    path = Path(location).expanduser()
    file_mode = stat.S_IMODE(path.stat().st_mode)
    if file_mode & 0o077:
        eprint(f"warning: {path} is readable by other users; run: chmod 600 {path}")
    for line_number, source_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = source_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if not match:
            raise ValueError(f"{path}:{line_number}: expected NAME=value")
        name, raw_value = match.groups()
        try:
            parts = shlex.split(raw_value, posix=True)
        except ValueError as error:
            raise ValueError(f"{path}:{line_number}: {error}") from error
        if len(parts) > 1:
            raise ValueError(f"{path}:{line_number}: quote values containing spaces")
        value = parts[0] if parts else ""
        os.environ.setdefault(name, value)


def overlay_providers(
    defaults: list[dict[str, Any]], imported: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    output = copy.deepcopy(defaults)
    positions = {provider["slug"]: index for index, provider in enumerate(output)}
    for incoming in imported:
        slug = incoming["slug"]
        if slug not in positions:
            positions[slug] = len(output)
            output.append(copy.deepcopy(incoming))
            continue
        old = output[positions[slug]]
        merged = {**old, **copy.deepcopy(incoming)}
        # An export with an explicitly empty model list should still be able to
        # use the maintained default list.
        if not incoming.get("models") and old.get("models"):
            merged["models"] = old["models"]

        # Known provider exports frequently contain native operation URLs
        # (`generateContent`, `/v2/chat`, Cloudflare `/ai/run/...`) that are not
        # OpenAI Chat Completions endpoints. Rebase every imported model onto
        # the maintained OpenAI-compatible endpoint. Custom/unknown providers
        # keep their exported URLs unchanged.
        if slug in KNOWN_PROVIDER_SLUGS:
            # Keep the maintained provider name stable across imports (for
            # example `Mistral`, not alternating `Mistral AI`). Group identity
            # in chatLanguageModels.json is vendor+name, so name drift otherwise
            # leaves a second keyless group whose colliding model IDs can win in
            # Chat even though Toolbox tests the credentialed group.
            merged["name"] = old["name"]
            canonical_url = canonical_provider_url(
                slug,
                str(old.get("baseUrl") or ""),
                str(incoming.get("baseUrl") or ""),
            )
            merged["baseUrl"] = canonical_url
            if incoming.get("models"):
                for model in merged["models"]:
                    model["url"] = canonical_url
        output[positions[slug]] = merged
    return output


def expand_env_url(url: str) -> tuple[str, list[str]]:
    missing: list[str] = []

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        value = os.environ.get(key)
        if value is None or value == "":
            missing.append(key)
            return match.group(0)
        return value

    return re.sub(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", replace, url), missing


def env_names(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value if str(item)]
    return []


def provider_api_key(provider: dict[str, Any]) -> str | None:
    # An explicit --import-source-keys operation must replace stale exported or
    # inherited environment credentials. Environment values remain the normal
    # source when no usable key was embedded in the imported provider entry.
    source_key = provider.get("sourceApiKey")
    if isinstance(source_key, str) and source_key:
        return source_key
    for name in env_names(provider.get("apiKeyEnv")):
        value = os.environ.get(name)
        if value:
            return value
    return None


def read_from_tty(prompt: str, *, secret: bool) -> str:
    """Read one line from the controlling terminal, independently of stdin.

    The installer is normally executed as ``curl ... | bash``. In that form
    stdin is the script pipe, so input()/getpass() can read EOF or try to seek a
    non-seekable stream on some Termux Python builds. Reading /dev/tty directly
    keeps prompts interactive while leaving the pipe alone.
    """
    try:
        descriptor = os.open("/dev/tty", os.O_RDWR)
    except OSError as error:
        raise RuntimeError(
            "--prompt needs a controlling terminal; use --env-file when running non-interactively"
        ) from error

    original_attributes: list[Any] | None = None
    try:
        os.write(descriptor, prompt.encode("utf-8", errors="replace"))
        if secret:
            original_attributes = termios.tcgetattr(descriptor)
            hidden_attributes = original_attributes.copy()
            hidden_attributes[3] &= ~termios.ECHO
            termios.tcsetattr(descriptor, termios.TCSADRAIN, hidden_attributes)

        data = bytearray()
        while True:
            chunk = os.read(descriptor, 1)
            if not chunk or chunk in {b"\n", b"\r"}:
                break
            data.extend(chunk)
        return data.decode("utf-8").strip()
    finally:
        if original_attributes is not None:
            termios.tcsetattr(descriptor, termios.TCSADRAIN, original_attributes)
            os.write(descriptor, b"\n")
        os.close(descriptor)


def prompt_for_values(providers: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for provider in providers:
        required_names = env_names(provider.get("requiredEnv"))
        key_names = env_names(provider.get("apiKeyEnv"))
        names: list[tuple[str, bool]] = [(name, False) for name in required_names]
        if key_names and not any(os.environ.get(name) for name in key_names):
            # apiKeyEnv may list aliases. Ask once, using the preferred first name.
            names.append((key_names[0], True))
        for env_name, is_secret in names:
            if env_name in seen or os.environ.get(env_name):
                continue
            seen.add(env_name)
            label = provider.get("name", provider["slug"])
            prompt = f"{label} - {env_name} (Enter to skip): "
            value = read_from_tty(prompt, secret=is_secret)
            if value:
                os.environ[env_name] = value


def discovery_models(provider: dict[str, Any], timeout: int) -> list[dict[str, Any]]:
    base_url, missing = expand_env_url(str(provider["baseUrl"]))
    if missing:
        raise RuntimeError("missing " + ", ".join(missing))
    key = provider_api_key(provider)
    discovery_base = re.sub(r"/(?:chat/completions|responses)$", "", base_url.rstrip("/"))
    url = discovery_base + "/models"
    request = urllib.request.Request(url)
    request.add_header("Accept", "application/json")
    if key:
        request.add_header("Authorization", "Bearer " + key)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.load(response)

    if isinstance(payload, dict):
        raw_models = payload.get("data")
        if not isinstance(raw_models, (list, dict)):
            raw_models = payload.get("models")
        if not isinstance(raw_models, (list, dict)):
            result = payload.get("result")
            if isinstance(result, dict):
                raw_models = result.get("data") or result.get("models")
            else:
                raw_models = result
    else:
        raw_models = payload
    return normalize_models(
        raw_models,
        base_url,
        include_non_chat=False,
        defaults=provider.get("modelDefaults") if isinstance(provider.get("modelDefaults"), dict) else None,
    )


def merge_model_lists(
    original: list[dict[str, Any]], discovered: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    output = copy.deepcopy(original)
    positions = {model["id"]: index for index, model in enumerate(output)}
    for model in discovered:
        if model["id"] in positions:
            index = positions[model["id"]]
            output[index] = {**output[index], **model}
        else:
            positions[model["id"]] = len(output)
            output.append(model)
    return output


def provider_group(
    provider: dict[str, Any],
    existing: dict[str, Any] | None,
    preserve_existing_key: bool = False,
) -> dict[str, Any] | None:
    configured_url = str(provider["baseUrl"])
    if provider["slug"] == "ollama" and os.environ.get("OLLAMA_URL"):
        configured_url = os.environ["OLLAMA_URL"]
    if provider["slug"] == "ollama":
        configured_url = normalize_ollama_url(configured_url)
    base_url, missing = expand_env_url(configured_url)
    if missing:
        eprint(
            f"warning: skipping {provider['name']}: missing environment variable(s): "
            + ", ".join(missing)
        )
        return None

    if provider["slug"] == "ollama":
        return {"name": provider["name"], "vendor": "ollama", "url": base_url}

    models = copy.deepcopy(provider.get("models") or [])
    for model in models:
        model_url, model_missing = expand_env_url(str(model.get("url") or base_url))
        if model_missing:
            eprint(
                f"warning: skipping model {model.get('id')}: missing "
                + ", ".join(model_missing)
            )
            model["_skip"] = True
        else:
            model["url"] = model_url
    models = [model for model in models if not model.pop("_skip", False)]
    if not models:
        eprint(f"warning: skipping {provider['name']}: no chat-compatible models")
        return None

    group: dict[str, Any] = {
        "name": provider["name"],
        "vendor": CUSTOM_VENDOR,
        "models": models,
    }
    source_key = provider.get("sourceApiKey")
    existing_key = existing.get("apiKey") if isinstance(existing, dict) else None
    if isinstance(source_key, str) and source_key:
        # Explicit source imports always replace old credentials.
        group["apiKey"] = source_key
    elif preserve_existing_key and isinstance(existing_key, str) and existing_key:
        # GitHub code/catalog updates must never replace a working local key
        # with a stale environment variable inherited by code-server.
        group["apiKey"] = existing_key
    else:
        key = provider_api_key(provider)
        if key:
            group["apiKey"] = key
        elif isinstance(existing_key, str) and existing_key:
            # A catalog-only rerun must not erase a key installed earlier.
            group["apiKey"] = existing_key
    return group


def group_key(group: dict[str, Any]) -> tuple[str, str]:
    return str(group.get("vendor", "")), str(group.get("name", ""))


def provider_name_identity(value: Any) -> str:
    ignored = {"ai", "api", "cloud", "models", "provider", "official"}
    return "-".join(
        part for part in slugify(value).split("-") if part and part not in ignored
    )


def model_group_fingerprints(value: dict[str, Any]) -> set[tuple[str, str, str]]:
    fingerprints: set[tuple[str, str, str]] = set()
    models = value.get("models")
    if not isinstance(models, list):
        return fingerprints
    for model in models:
        if not isinstance(model, dict) or not model.get("id"):
            continue
        raw_url = str(model.get("url") or "").strip()
        parsed = urllib.parse.urlsplit(raw_url)
        operation_free_path = re.sub(
            r"/(?:chat/completions|responses|models)$", "", parsed.path.rstrip("/"),
            flags=re.IGNORECASE,
        )
        fingerprints.add(
            (str(model["id"]), parsed.netloc.lower(), operation_free_path.lower())
        )
    return fingerprints


def equivalent_existing_group(
    provider: dict[str, Any], vendor: str, group: Any
) -> bool:
    if not isinstance(group, dict) or str(group.get("vendor")) != vendor:
        return False
    if str(group.get("name")) == str(provider.get("name")):
        return True
    if vendor != CUSTOM_VENDOR:
        return False
    if provider_name_identity(group.get("name")) != provider_name_identity(
        provider.get("name")
    ):
        return False
    return bool(
        model_group_fingerprints(group)
        & model_group_fingerprints({"models": provider.get("models", [])})
    )


def merge_groups(
    existing: list[Any],
    providers: list[dict[str, Any]],
    skip_missing_keys: bool,
    preserve_existing_keys: bool = False,
) -> tuple[list[Any], list[tuple[str, int, bool]]]:
    output: list[Any | None] = copy.deepcopy(existing)
    summary: list[tuple[str, int, bool]] = []
    for provider in providers:
        vendor = "ollama" if provider["slug"] == "ollama" else CUSTOM_VENDOR
        candidate_indices = [
            index
            for index, item in enumerate(output)
            if item is not None and equivalent_existing_group(provider, vendor, item)
        ]
        candidates = [output[index] for index in candidate_indices]
        old = max(
            (item for item in candidates if isinstance(item, dict)),
            key=lambda item: (
                bool(item.get("apiKey")),
                str(item.get("name")) == str(provider["name"]),
                len(item.get("models", [])) if isinstance(item.get("models"), list) else 0,
            ),
            default=None,
        )
        if skip_missing_keys and provider["slug"] != "ollama" and not (
            provider_api_key(provider) or (old and old.get("apiKey"))
        ):
            eprint(f"warning: skipping {provider['name']}: no API key")
            continue
        group = provider_group(
            provider, old, preserve_existing_key=preserve_existing_keys
        )
        if group is None:
            continue
        existed = bool(candidate_indices)
        if existed:
            target_index = min(candidate_indices)
            output[target_index] = group
            for duplicate_index in candidate_indices:
                if duplicate_index != target_index:
                    output[duplicate_index] = None
        else:
            output.append(group)
        summary.append((provider["name"], len(group.get("models", [])), existed))
    return [item for item in output if item is not None], summary


def parse_code_server_config_path(key: str) -> Path | None:
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    config = config_home / "code-server" / "config.yaml"
    if not config.is_file():
        return None
    try:
        for line in config.read_text(encoding="utf-8").splitlines():
            match = re.match(rf"^\s*{re.escape(key)}\s*:\s*(.*?)\s*$", line)
            if match:
                value = match.group(1).strip().strip("'\"")
                if value:
                    return Path(os.path.expandvars(value)).expanduser()
    except OSError:
        return None
    return None


def user_data_directory(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser()
    env_value = os.environ.get("CODE_SERVER_USER_DATA_DIR")
    if env_value:
        return Path(env_value).expanduser()
    configured = parse_code_server_config_path("user-data-dir")
    if configured:
        return configured
    data_home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return data_home / "code-server"


def config_file_path(args: argparse.Namespace) -> Path:
    if args.config_file:
        return Path(args.config_file).expanduser()
    if args.profile_dir:
        return Path(args.profile_dir).expanduser() / "chatLanguageModels.json"
    return user_data_directory(args.user_data_dir) / "User" / "chatLanguageModels.json"


def settings_file_path(args: argparse.Namespace) -> Path:
    if args.settings_file:
        return Path(args.settings_file).expanduser()
    if args.profile_dir:
        return Path(args.profile_dir).expanduser() / "settings.json"
    return user_data_directory(args.user_data_dir) / "User" / "settings.json"


def strip_jsonc(text: str) -> str:
    """Remove JSONC comments and trailing commas without touching strings."""
    output: list[str] = []
    index = 0
    in_string = False
    escaped = False
    line_comment = False
    block_comment = False
    while index < len(text):
        char = text[index]
        following = text[index + 1] if index + 1 < len(text) else ""
        if line_comment:
            if char in "\r\n":
                line_comment = False
                output.append(char)
            else:
                output.append(" ")
        elif block_comment:
            if char == "*" and following == "/":
                output.extend((" ", " "))
                index += 1
                block_comment = False
            else:
                output.append(char if char in "\r\n" else " ")
        elif in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
            output.append(char)
        elif char == "/" and following == "/":
            output.extend((" ", " "))
            index += 1
            line_comment = True
        elif char == "/" and following == "*":
            output.extend((" ", " "))
            index += 1
            block_comment = True
        else:
            output.append(char)
        index += 1

    uncommented = "".join(output)
    output = []
    in_string = False
    escaped = False
    index = 0
    while index < len(uncommented):
        char = uncommented[index]
        if in_string:
            output.append(char)
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            index += 1
            continue
        if char == '"':
            in_string = True
            output.append(char)
            index += 1
            continue
        if char == ",":
            lookahead = index + 1
            while lookahead < len(uncommented) and uncommented[lookahead].isspace():
                lookahead += 1
            if lookahead < len(uncommented) and uncommented[lookahead] in "}]":
                index += 1
                continue
        output.append(char)
        index += 1
    return "".join(output)


def load_settings(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return {}
    value = json.loads(strip_jsonc(text))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def terminal_shell_path() -> str:
    candidates: list[str] = []
    explicit = os.environ.get("COPILOT_TERMINAL_SHELL")
    if explicit:
        candidates.append(explicit)
    prefix = os.environ.get("PREFIX")
    if prefix:
        candidates.append(str(Path(prefix) / "bin" / "bash"))
    bash = shutil.which("bash")
    if bash:
        candidates.append(bash)
    shell = os.environ.get("SHELL")
    if shell:
        candidates.append(shell)
    for candidate in candidates:
        path = Path(candidate).expanduser()
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
    raise FileNotFoundError(
        "no executable shell found; in Termux run: pkg install bash"
    )


def terminal_enabled_settings(
    existing: dict[str, Any], shell_path: str
) -> dict[str, Any]:
    settings = copy.deepcopy(existing)
    is_termux = bool(os.environ.get("PREFIX")) and "/com.termux/" in shell_path
    profile_name = "Termux Android Shell" if is_termux else "Bash"
    # The user's standalone forkpty test succeeds while code-server exits for
    # both Termux Bash and Termux sh. This isolates the failure to code-server's
    # Android PTY launch path, not the shell itself. Prefer Android's native
    # /system/bin/sh as the PTY entry point and inject the complete Termux
    # environment; Termux executables remain first on PATH. No argv is passed.
    profile: dict[str, Any] = {"path": shell_path}
    terminal_env: dict[str, Any] = {}
    if is_termux:
        prefix = os.environ.get("PREFIX") or str(Path(shell_path).parent.parent)
        explicit_safe_shell = os.environ.get("COPILOT_TERMINAL_SAFE_SHELL")
        safe_shell_candidates = [
            Path(explicit_safe_shell).expanduser() if explicit_safe_shell else None,
            Path("/system/bin/sh"),
            Path(prefix) / "bin" / "sh",
        ]
        safe_shell = next(
            (
                candidate
                for candidate in safe_shell_candidates
                if candidate is not None
                and candidate.is_file()
                and os.access(candidate, os.X_OK)
            ),
            None,
        )
        if safe_shell is None:
            raise FileNotFoundError(
                "no executable Android/Termux safe shell found"
            )
        if str(safe_shell) != "/system/bin/sh":
            profile_name = "Termux Safe Shell"
        profile["path"] = str(safe_shell)
        inherited_path = os.environ.get("PATH", "")
        path_parts = [str(Path(prefix) / "bin"), str(Path(prefix) / "bin" / "applets")]
        path_parts.extend(part for part in inherited_path.split(":") if part)
        deduplicated_path = ":".join(dict.fromkeys(path_parts))
        terminal_env = {
            "PREFIX": prefix,
            "HOME": os.environ.get("HOME", str(Path.home())),
            "PATH": deduplicated_path,
            # Always use Termux's private executable/writable temporary area.
            # An inherited Android/shared-storage TMPDIR can cause EACCES when
            # code-server or a command creates helper scripts.
            "TMPDIR": str(Path(prefix) / "tmp"),
            "SHELL": str(safe_shell),
            "COLORTERM": os.environ.get("COLORTERM", "truecolor"),
            # Empty values avoid startup files without relying on null-valued
            # profile variables, which older code-server PTY hosts mishandle.
            "ENV": "",
            "BASH_ENV": "",
        }
        for name in ("LANG", "LC_ALL", "TERMUX_VERSION"):
            value = os.environ.get(name)
            if value:
                terminal_env[name] = value
        profile["env"] = terminal_env

    profiles = settings.get("terminal.integrated.profiles.linux")
    if not isinstance(profiles, dict):
        profiles = {}
    profiles = copy.deepcopy(profiles)
    if is_termux:
        managed_paths = {shell_path, str(Path(prefix) / "bin" / "sh"), "/system/bin/sh"}
        for previous_name in ("Termux Bash", "Termux Safe Shell", "Termux Android Shell"):
            previous = profiles.get(previous_name)
            if (
                isinstance(previous, dict)
                and previous.get("path") in managed_paths
                and previous.get("args")
                in (None, ["-l"], ["--noprofile", "--norc"])
            ):
                # Remove only profile shapes managed by helper releases.
                profiles.pop(previous_name, None)
    profiles[profile_name] = profile
    settings["terminal.integrated.profiles.linux"] = profiles
    settings["terminal.integrated.defaultProfile.linux"] = profile_name
    settings["terminal.integrated.automationProfile.linux"] = profile
    settings["terminal.integrated.inheritEnv"] = True
    if is_termux:
        # Avoid a workspace/shared-storage cwd and stale terminal revival before
        # the shell starts; both happen inside the code-server PTY host.
        settings["terminal.integrated.cwd"] = terminal_env["HOME"]
        settings["terminal.integrated.enablePersistentSessions"] = False
        settings["terminal.integrated.detectLocale"] = "off"
        # VS Code's terminal sandbox is not supported by Android/Termux.
        settings["chat.tools.terminal.sandbox.enabled"] = False
    # The terminal tool has a no-shell-integration execution strategy. On
    # Termux, reliability is more important than command-decoration support:
    # disabling injection avoids startup-time EACCES before a prompt appears.
    settings["terminal.integrated.shellIntegration.enabled"] = not is_termux
    if terminal_env:
        integrated_env = settings.get("terminal.integrated.env.linux")
        if not isinstance(integrated_env, dict):
            integrated_env = {}
        settings["terminal.integrated.env.linux"] = {
            **copy.deepcopy(integrated_env),
            **terminal_env,
        }

    # This profile is used specifically by Copilot Chat's run-in-terminal tool.
    settings["chat.tools.terminal.terminalProfile.linux"] = profile
    # Enable the feature while retaining VS Code's conservative default command
    # approval rules. We intentionally do not auto-approve every command.
    settings["chat.tools.terminal.enableAutoApprove"] = True
    return settings


def load_existing_groups(path: Path) -> list[Any]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, list):
        raise ValueError(f"{path} must contain a JSON array")
    return value


def backup_once(path: Path, backup_mode: int | None = None) -> None:
    backup = Path(str(path) + BACKUP_SUFFIX)
    marker = Path(str(path) + CREATED_SUFFIX)
    if backup.exists() or marker.exists():
        return
    if path.exists():
        shutil.copy2(path, backup)
        if backup_mode is not None:
            os.chmod(backup, backup_mode)
    else:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("created by copilot-models helper\n", encoding="utf-8")
        os.chmod(marker, stat.S_IRUSR | stat.S_IWUSR)


def atomic_write_json(path: Path, value: Any, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path.parent, 0o700)
    except OSError:
        pass
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def restore_file(path: Path) -> bool:
    backup = Path(str(path) + BACKUP_SUFFIX)
    marker = Path(str(path) + CREATED_SUFFIX)
    changed = False
    if backup.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup, path)
        changed = True
    elif marker.exists() and path.exists():
        path.unlink()
        changed = True
    if marker.exists():
        marker.unlink()
    return changed


def package_has_custom_provider(path: Path) -> bool:
    try:
        package = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    contributions = package.get("contributes") if isinstance(package, dict) else None
    providers = contributions.get("languageModelChatProviders") if isinstance(contributions, dict) else None
    return isinstance(providers, list) and any(
        isinstance(provider, dict) and provider.get("vendor") == CUSTOM_VENDOR
        for provider in providers
    )


def package_looks_like_copilot(path: Path) -> bool:
    try:
        package = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False
    publisher = str(package.get("publisher", "")).lower()
    name = str(package.get("name", "")).lower()
    return "copilot" in name and publisher in {"github", "vscode", "microsoft", ""}


def add_package_candidate(output: list[Path], candidate: Path) -> None:
    package = candidate / "package.json" if candidate.is_dir() else candidate
    if package.is_file() and package not in output:
        output.append(package)


def extension_manifests(args: argparse.Namespace) -> list[Path]:
    candidates: list[Path] = []
    for explicit in args.extension_dir or []:
        add_package_candidate(candidates, Path(explicit).expanduser())

    code_server = shutil.which("code-server")
    if code_server:
        try:
            located = subprocess.run(
                [code_server, "--locate-extension", "GitHub.copilot-chat"],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
            for line in located.stdout.splitlines():
                path = Path(line.strip()).expanduser()
                if path.exists():
                    add_package_candidate(candidates, path)
        except (OSError, subprocess.SubprocessError):
            pass

    data_dir = user_data_directory(args.user_data_dir)
    roots = [data_dir / "extensions", Path.home() / ".vscode" / "extensions"]
    extension_env = os.environ.get("CODE_SERVER_EXTENSIONS_DIR")
    if extension_env:
        roots.insert(0, Path(extension_env).expanduser())
    prefix = os.environ.get("PREFIX")
    if prefix:
        roots.extend(
            [
                Path(prefix) / "lib" / "node_modules" / "code-server" / "lib" / "vscode" / "extensions",
                Path(prefix) / "lib" / "code-server" / "lib" / "vscode" / "extensions",
            ]
        )
    if code_server:
        executable = Path(code_server).resolve()
        for parent in list(executable.parents)[:5]:
            roots.extend(
                [
                    parent / "lib" / "vscode" / "extensions",
                    parent / "lib" / "node_modules" / "code-server" / "lib" / "vscode" / "extensions",
                ]
            )

    patterns = (
        "github.copilot-chat-*/package.json",
        "github.copilot-*/package.json",
        "copilot/package.json",
        "github-copilot-chat/package.json",
    )
    for root in roots:
        if not root.is_dir():
            continue
        for pattern in patterns:
            for package in root.glob(pattern):
                add_package_candidate(candidates, package)

    custom = [path for path in candidates if package_has_custom_provider(path)]
    if custom:
        return custom
    return [path for path in candidates if package_looks_like_copilot(path)]


def patch_manifest(path: Path, dry_run: bool = False) -> str:
    with path.open("r", encoding="utf-8") as handle:
        package = json.load(handle)
    contributions = package.get("contributes")
    providers = contributions.get("languageModelChatProviders") if isinstance(contributions, dict) else None
    if not isinstance(providers, list):
        raise ValueError(f"{path}: no languageModelChatProviders contribution")
    custom = next(
        (
            provider
            for provider in providers
            if isinstance(provider, dict) and provider.get("vendor") == CUSTOM_VENDOR
        ),
        None,
    )
    if custom is None:
        raise ValueError(
            f"{path}: this Copilot Chat version has no customoai provider; update code-server and Copilot Chat"
        )
    condition = custom.get("when")
    if condition is None:
        return "already-visible"
    normalized = re.sub(r"\s+", "", str(condition)).replace('"', "'")
    accepted = {
        "productQualityType!='stable'",
        "'stable'!=productQualityType",
    }
    if normalized not in accepted:
        raise ValueError(
            f"{path}: refusing to remove unexpected customoai condition: {condition!r}"
        )
    if dry_run:
        return "would-patch"
    original_mode = stat.S_IMODE(path.stat().st_mode)
    backup_once(path)
    del custom["when"]
    atomic_write_json(path, package, original_mode)
    return "patched"


def read_catalog(path: str | None, include_non_chat: bool) -> list[dict[str, Any]]:
    if not path:
        sibling = Path(__file__).with_name("copilot-models.catalog.json")
        if not sibling.is_file():
            raise FileNotFoundError("catalog not found; pass --catalog PATH")
        path = str(sibling)
    root = load_json_source(path)
    providers = normalize_catalog(root, include_non_chat=include_non_chat)
    if not providers:
        raise ValueError("catalog does not contain usable providers")
    return providers


def provider_selection(value: str | None) -> set[str] | None:
    if not value:
        return None
    selected = {slugify(item) for item in value.split(",") if item.strip()}
    return selected or None


def filter_providers(
    providers: list[dict[str, Any]], selected: set[str] | None, respect_disabled: bool
) -> list[dict[str, Any]]:
    output = []
    available = {provider["slug"] for provider in providers}
    if selected:
        unknown = selected - available
        if unknown:
            raise ValueError("unknown provider(s): " + ", ".join(sorted(unknown)))
    for provider in providers:
        if selected and provider["slug"] not in selected:
            continue
        if respect_disabled and not as_bool(provider.get("enabled"), True):
            continue
        output.append(provider)
    return output


def toolbox_source_package(source: str) -> tuple[Path, dict[str, Any]]:
    directory = Path(source).expanduser().resolve()
    package_path = directory / "package.json"
    if not package_path.is_file():
        raise FileNotFoundError(f"toolbox package not found: {package_path}")
    package = json.loads(package_path.read_text(encoding="utf-8"))
    if not isinstance(package, dict):
        raise ValueError(f"{package_path} must contain a JSON object")
    if package.get("publisher") != TOOLBOX_PUBLISHER or package.get("name") != TOOLBOX_NAME:
        raise ValueError(f"unexpected toolbox identity in {package_path}")
    version = str(package.get("version", ""))
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version):
        raise ValueError(f"invalid toolbox version in {package_path}: {version!r}")
    if version != HELPER_VERSION:
        raise ValueError(
            f"toolbox version {version} does not match helper version {HELPER_VERSION}"
        )
    for filename in ("extension.js", "core.js"):
        if not (directory / filename).is_file():
            raise FileNotFoundError(f"toolbox file not found: {directory / filename}")
    return directory, package


def toolbox_target_path(args: argparse.Namespace, package: dict[str, Any]) -> Path:
    extension_root = os.environ.get("CODE_SERVER_EXTENSIONS_DIR")
    configured_root = parse_code_server_config_path("extensions-dir")
    if extension_root:
        root = Path(extension_root).expanduser()
    elif configured_root:
        root = configured_root
    else:
        root = user_data_directory(args.user_data_dir) / "extensions"
    dirname = f"{package['publisher']}.{package['name']}-{package['version']}"
    return root / dirname


def populate_toolbox_staging(
    source: Path, staging: Path, catalog_source: str | None
) -> None:
    staging.mkdir(mode=0o700)
    for filename in ("package.json", "extension.js", "core.js"):
        shutil.copy2(source / filename, staging / filename)
    runtime = staging / "runtime"
    runtime.mkdir(mode=0o700)
    helper_target = runtime / "copilot-models.py"
    shutil.copy2(Path(__file__).resolve(), helper_target)
    os.chmod(helper_target, 0o700)

    catalog_target = runtime / "copilot-models.catalog.json"
    if catalog_source and Path(catalog_source).expanduser().is_file():
        shutil.copy2(Path(catalog_source).expanduser(), catalog_target)
        os.chmod(catalog_target, 0o600)
    else:
        catalog_value = load_json_source(catalog_source) if catalog_source else None
        if catalog_value is None:
            raise FileNotFoundError("toolbox installation requires a catalog")
        atomic_write_json(catalog_target, catalog_value, 0o600)


def build_toolbox_vsix(
    staging: Path, package: dict[str, Any], destination: Path
) -> None:
    description = xml_escape(str(package.get("description", "")))
    display_name = xml_escape(str(package.get("displayName", TOOLBOX_NAME)))
    categories = xml_escape(",".join(str(item) for item in package.get("categories", [])))
    engine = xml_escape(str(package.get("engines", {}).get("vscode", "*")))
    extension_kind = package.get("extensionKind", [])
    if isinstance(extension_kind, list):
        extension_kind_value = ",".join(str(item) for item in extension_kind)
    else:
        extension_kind_value = str(extension_kind)
    manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="{TOOLBOX_NAME}" Version="{package['version']}" Publisher="{TOOLBOX_PUBLISHER}" />
    <DisplayName>{display_name}</DisplayName>
    <Description xml:space="preserve">{description}</Description>
    <Tags></Tags>
    <Categories>{categories}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{engine}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="{xml_escape(extension_kind_value)}" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>
'''
    content_types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="py" ContentType="text/x-python" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
'''
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("extension.vsixmanifest", manifest)
        archive.writestr("[Content_Types].xml", content_types)
        for file_path in staging.rglob("*"):
            if file_path.is_file():
                archive.write(file_path, "extension/" + file_path.relative_to(staging).as_posix())


def located_toolbox_path(
    code_server: str, extension_root: Path, package: dict[str, Any]
) -> Path | None:
    extension_id = f"{TOOLBOX_PUBLISHER}.{TOOLBOX_NAME}"
    try:
        located = subprocess.run(
            [
                code_server,
                "--extensions-dir",
                str(extension_root),
                "--locate-extension",
                extension_id,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        candidates = [Path(line.strip()) for line in located.stdout.splitlines()]
    except (OSError, subprocess.SubprocessError):
        candidates = []
    candidates.extend(extension_root.glob(f"{extension_id}-*"))
    for candidate in candidates:
        package_path = candidate / "package.json"
        if not package_path.is_file():
            continue
        try:
            value = json.loads(package_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if (
            isinstance(value, dict)
            and value.get("publisher") == TOOLBOX_PUBLISHER
            and value.get("name") == TOOLBOX_NAME
            and str(value.get("version")) == str(package["version"])
        ):
            return candidate
    return None


def install_toolbox(
    args: argparse.Namespace, catalog_source: str | None, dry_run: bool
) -> tuple[Path, str] | None:
    if args.no_toolbox or not args.toolbox_dir:
        return None
    source, package = toolbox_source_package(args.toolbox_dir)
    expected_target = toolbox_target_path(args, package)
    was_installed = expected_target.exists()
    if dry_run:
        return expected_target, "would-install"

    extension_root = expected_target.parent
    extension_root.mkdir(parents=True, exist_ok=True)
    working = Path(tempfile.mkdtemp(prefix=f".{TOOLBOX_NAME}.", dir=extension_root))
    installed_target = expected_target
    try:
        staging = working / "extension"
        populate_toolbox_staging(source, staging, catalog_source)
        code_server = shutil.which("code-server")
        if code_server:
            vsix = working / f"{TOOLBOX_NAME}-{package['version']}.vsix"
            build_toolbox_vsix(staging, package, vsix)
            installed = subprocess.run(
                [
                    code_server,
                    "--extensions-dir",
                    str(extension_root),
                    "--install-extension",
                    str(vsix),
                    "--force",
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if installed.returncode != 0:
                detail = installed.stderr.strip() or installed.stdout.strip()
                raise RuntimeError(f"code-server could not install the toolbox VSIX: {detail}")
            located = located_toolbox_path(code_server, extension_root, package)
            if located is None:
                raise RuntimeError(
                    "code-server reported a successful toolbox install, but the extension "
                    "was not discoverable afterward"
                )
            installed_target = located
            result = "updated-via-code-server" if was_installed else "installed-via-code-server"
        else:
            if expected_target.exists():
                shutil.rmtree(expected_target)
            os.replace(staging, expected_target)
            result = "updated-directly" if was_installed else "installed-directly"
    finally:
        if working.exists():
            shutil.rmtree(working)

    # Remove only older copies of this helper-owned extension after the new
    # version is safely installed and verified. Unrelated extensions are never
    # touched.
    pattern = f"{TOOLBOX_PUBLISHER}.{TOOLBOX_NAME}-*"
    for old in extension_root.glob(pattern):
        if old != installed_target and old.is_dir():
            try:
                old_package = json.loads((old / "package.json").read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if (
                isinstance(old_package, dict)
                and old_package.get("publisher") == TOOLBOX_PUBLISHER
                and old_package.get("name") == TOOLBOX_NAME
            ):
                shutil.rmtree(old)
    return installed_target, result


def uninstall_toolbox(args: argparse.Namespace) -> Path | None:
    if args.no_toolbox or not args.toolbox_dir:
        return None
    _, package = toolbox_source_package(args.toolbox_dir)
    target = toolbox_target_path(args, package)
    if not target.is_dir():
        return None
    installed_package = target / "package.json"
    try:
        value = json.loads(installed_package.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict) or (
        value.get("publisher"), value.get("name")
    ) != (TOOLBOX_PUBLISHER, TOOLBOX_NAME):
        return None
    shutil.rmtree(target)
    return target


def print_code_server_restart_command() -> None:
    print("\nRestart code-server from a separate Termux session:")
    print("  pkill -f '[c]ode-server' || true")
    print("  sleep 1")
    print('  mkdir -p "$HOME/.local/share/code-server"')
    print(
        '  nohup code-server >>"$HOME/.local/share/code-server/code-server.log" '
        "2>&1 </dev/null &"
    )


def restore(args: argparse.Namespace) -> int:
    config_path = config_file_path(args)
    settings_path = settings_file_path(args)
    restored: list[str] = []
    if restore_file(config_path):
        restored.append(str(config_path))
    if restore_file(settings_path):
        restored.append(str(settings_path))
    for package in extension_manifests(args):
        if restore_file(package):
            restored.append(str(package))
    removed_toolbox = uninstall_toolbox(args)
    if removed_toolbox:
        restored.append(str(removed_toolbox))
    if restored:
        print("Restored original file(s):")
        for path in restored:
            print("  " + path)
        print_code_server_restart_command()
    else:
        print("Nothing to restore.")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Add OpenAI-compatible models and optional terminal tools to "
            "Copilot Chat in code-server."
        )
    )
    parser.add_argument(
        "--version", action="version", version=f"copilot-models {HELPER_VERSION}"
    )
    parser.add_argument("--catalog", help="maintained provider catalog JSON")
    parser.add_argument("--source", help="additional provider export JSON (file, URL, or -)")
    parser.add_argument(
        "--env-file",
        help="NAME=value credential file (or set COPILOT_MODELS_ENV_FILE)",
    )
    parser.add_argument(
        "--providers", help="comma-separated provider slugs; default: all catalog providers"
    )
    parser.add_argument("--prompt", action="store_true", help="prompt for missing keys without echo")
    parser.add_argument(
        "--import-source-keys",
        action="store_true",
        help="use keys found in --source (ignored by default)",
    )
    parser.add_argument(
        "--skip-missing-keys",
        action="store_true",
        help="do not add providers that have no key",
    )
    parser.add_argument(
        "--preserve-existing-keys",
        action="store_true",
        help="never replace configured keys during a code/catalog-only update",
    )
    parser.add_argument(
        "--include-non-chat",
        action="store_true",
        help="include models marked as non-chat (normally unsafe for Copilot Chat)",
    )
    parser.add_argument(
        "--respect-disabled",
        action="store_true",
        help="skip providers whose source export has enabled=false",
    )
    discovery = parser.add_mutually_exclusive_group()
    discovery.add_argument(
        "--discover-all",
        action="store_true",
        help="query every selected provider's /models endpoint and merge the result",
    )
    discovery.add_argument(
        "--no-discover",
        action="store_true",
        help="do not discover models for catalog entries with an empty model list",
    )
    parser.add_argument("--discovery-timeout", type=int, default=20)
    parser.add_argument("--user-data-dir", help="code-server user-data directory")
    parser.add_argument(
        "--profile-dir",
        help="profile directory containing chatLanguageModels.json (for a non-default profile)",
    )
    parser.add_argument("--config-file", help="exact chatLanguageModels.json path")
    parser.add_argument("--settings-file", help="exact code-server settings.json path")
    parser.add_argument(
        "--toolbox-dir",
        help="source directory for the Copilot Chat toolbar companion extension",
    )
    parser.add_argument(
        "--no-toolbox",
        action="store_true",
        help="do not install the Copilot Models Toolbox companion extension",
    )
    parser.add_argument(
        "--enable-terminal",
        action="store_true",
        help="configure the integrated/agent terminal and advertise tool calling",
    )
    parser.add_argument(
        "--extension-dir",
        action="append",
        help="Copilot Chat extension directory or package.json (repeatable)",
    )
    parser.add_argument(
        "--no-patch",
        action="store_true",
        help="do not expose customoai in a stable Copilot Chat manifest",
    )
    parser.add_argument("--dry-run", action="store_true", help="validate and report without writing")
    parser.add_argument("--list", action="store_true", help="list catalog providers and exit")
    parser.add_argument("--restore", action="store_true", help="restore first-run backups and exit")
    return parser


def main(argv: list[str] | None = None) -> int:
    os.umask(0o077)
    parser = build_parser()
    args = parser.parse_args(argv)

    env_file = args.env_file or os.environ.get("COPILOT_MODELS_ENV_FILE")
    if env_file:
        load_env_file(env_file)

    if args.restore:
        return restore(args)

    providers = read_catalog(args.catalog, args.include_non_chat)
    if args.source:
        source = load_json_source(args.source)
        imported = normalize_catalog(
            source,
            include_non_chat=args.include_non_chat,
            import_source_keys=args.import_source_keys,
        )
        if not imported:
            raise ValueError("--source contains no recognizable provider/model entries")
        providers = overlay_providers(providers, imported)
        if args.import_source_keys:
            usable = [provider for provider in imported if provider.get("sourceApiKey")]
            print(
                f"Credential import: {len(usable)}/{len(imported)} provider "
                "entries contained a usable embedded key."
            )
            for provider in imported:
                key = provider.get("sourceApiKey")
                if isinstance(key, str) and key:
                    print(
                        f"  key     {provider['name']}: imported "
                        f"(length {len(key)}, sha256 {provider['sourceKeyFingerprint']})"
                    )
                else:
                    print(
                        f"  no-key  {provider['name']}: "
                        f"{provider.get('sourceKeyStatus', 'not-found')}"
                    )

    selected = provider_selection(args.providers)
    providers = filter_providers(providers, selected, args.respect_disabled)

    if args.list:
        for provider in providers:
            print(f"{provider['slug']:<18} {len(provider.get('models', [])):>4}  {provider['name']}")
        return 0

    if args.prompt:
        prompt_for_values(providers)

    # Entries without maintained models use live OpenAI-compatible discovery by
    # default. --discover-all refreshes every provider instead.
    for provider in providers:
        should_discover = args.discover_all or (
            not args.no_discover and provider["slug"] != "ollama" and not provider.get("models")
        )
        if not should_discover:
            continue
        if env_names(provider.get("apiKeyEnv")) and not provider_api_key(provider):
            eprint(f"warning: cannot discover {provider['name']} models without an API key")
            continue
        try:
            discovered = discovery_models(provider, max(1, args.discovery_timeout))
            if discovered:
                provider["models"] = merge_model_lists(provider.get("models", []), discovered)
                print(f"Discovered {len(discovered)} model(s) from {provider['name']}.")
            else:
                eprint(f"warning: {provider['name']} returned no chat-compatible models")
        except (OSError, ValueError, RuntimeError, urllib.error.URLError) as error:
            eprint(f"warning: model discovery failed for {provider['name']}: {error}")

    config_path = config_file_path(args)
    settings_path: Path | None = None
    merged_settings: dict[str, Any] | None = None
    shell_path: str | None = None
    toolbox_requested = bool(args.toolbox_dir) and not args.no_toolbox
    if args.enable_terminal:
        # Agent mode only exposes run-in-terminal to models advertising tool
        # support. This cannot make a model implement tools, but it lets models
        # with OpenAI-compatible tool calling use the terminal.
        for provider in providers:
            for model in provider.get("models", []):
                model["toolCalling"] = True
        shell_path = terminal_shell_path()

    if args.enable_terminal or toolbox_requested:
        settings_path = settings_file_path(args)
        merged_settings = load_settings(settings_path)
        if shell_path:
            merged_settings = terminal_enabled_settings(merged_settings, shell_path)
        if toolbox_requested:
            # Exact paths keep toolbar commands on the same profile the helper
            # modified, including non-default code-server profiles.
            merged_settings["copilotModels.configFile"] = str(config_path)
            merged_settings["copilotModels.settingsFile"] = str(settings_path)

    existing = load_existing_groups(config_path)
    merged, summary = merge_groups(
        existing,
        providers,
        args.skip_missing_keys,
        preserve_existing_keys=args.preserve_existing_keys,
    )
    if not summary:
        raise RuntimeError("no provider groups were generated")

    manifests: list[Path] = []
    patch_results: list[tuple[Path, str]] = []
    if not args.no_patch and any(provider["slug"] != "ollama" for provider in providers):
        manifests = extension_manifests(args)
        if not manifests:
            raise FileNotFoundError(
                "Copilot Chat extension manifest was not found; install it or pass --extension-dir"
            )
        errors: list[str] = []
        for manifest in manifests:
            try:
                patch_results.append((manifest, patch_manifest(manifest, args.dry_run)))
            except (OSError, ValueError, json.JSONDecodeError) as error:
                errors.append(str(error))
        if errors and not patch_results:
            raise RuntimeError("; ".join(errors))
        for error in errors:
            eprint("warning: " + error)

    catalog_source = args.catalog or str(
        Path(__file__).with_name("copilot-models.catalog.json")
    )
    toolbox_result = install_toolbox(args, catalog_source, args.dry_run)

    print("\nProvider groups:")
    for name, count, existed in summary:
        action = "update" if existed else "add"
        print(f"  {action:<6} {name}: {count} model(s)")
    print(f"\nConfiguration: {config_path}")
    if settings_path:
        print(f"Settings: {settings_path}")
    if shell_path:
        terminal_profile = (
            merged_settings.get("chat.tools.terminal.terminalProfile.linux", {})
            if isinstance(merged_settings, dict)
            else {}
        )
        selected_shell = (
            terminal_profile.get("path")
            if isinstance(terminal_profile, dict)
            else None
        )
        print(f"Terminal shell: {selected_shell or shell_path}")
    if toolbox_result:
        target, result = toolbox_result
        print(f"Copilot Models Toolbox ({result}): {target}")
    for manifest, result in patch_results:
        print(f"Manifest ({result}): {manifest}")

    if args.dry_run:
        print("\nDry run: no files were changed.")
        return 0

    backup_once(config_path, 0o600)
    atomic_write_json(config_path, merged, 0o600)
    if settings_path and merged_settings is not None:
        backup_once(settings_path, 0o600)
        atomic_write_json(settings_path, merged_settings, 0o600)

    missing_keys = [
        provider["name"]
        for provider in providers
        if provider["slug"] != "ollama" and not provider_api_key(provider)
    ]
    print(
        f"\nDone (v{HELPER_VERSION}). After restarting code-server, "
        "open Chat and use Manage Models."
    )
    if missing_keys:
        print("Providers without a key (models are listed but requests may fail):")
        print("  " + ", ".join(missing_keys))
    if toolbox_result:
        print(
            f"Toolbar v{HELPER_VERSION}: Test All AI Models, Import AI JSON, "
            "and Sync GitHub were installed in the Copilot Chat title bar."
        )
        print(
            "Verify: code-server --list-extensions --show-versions | "
            f"grep '^{TOOLBOX_PUBLISHER}\\.{TOOLBOX_NAME}@{HELPER_VERSION}$'"
        )
    if args.enable_terminal:
        print(
            "Terminal: integrated and agent profiles inherit the Termux PREFIX, "
            "HOME, PATH, and private TMPDIR. Android sh launches with no argv, "
            "a HOME cwd, no persisted PTY, and no terminal sandbox/injection; trust "
            "the workspace before using Agent mode."
        )
        print(
            "Note: only upstream models that truly implement OpenAI tool "
            "calling can run terminal tools."
        )
    if toolbox_result:
        print(
            "Security: API keys were staged with file mode 0600. On the next "
            "code-server startup Toolbox moves them into Chat SecretStorage and "
            "replaces plaintext values with secret references."
        )
    else:
        print(
            "Security: without Toolbox, API keys remain plaintext in "
            "chatLanguageModels.json (mode 0600) and current Chat builds may not "
            "resolve them; install Toolbox for automatic secret migration."
        )
    print("Run again after an extension update if OpenAI Compatible disappears.")
    print_code_server_restart_command()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        eprint("\nCancelled.")
        raise SystemExit(130)
    except Exception as error:  # Keep curl | bash failures concise and actionable.
        eprint(f"error: {error}")
        raise SystemExit(1)
