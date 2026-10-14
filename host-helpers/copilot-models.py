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
import urllib.request
from pathlib import Path
from typing import Any, Iterable

BACKUP_SUFFIX = ".copilot-models-helper.bak"
CREATED_SUFFIX = ".copilot-models-helper.created"
CUSTOM_VENDOR = "customoai"

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
KEY_FIELDS = ("apiKey", "api_key", "key", "token", "accessToken")


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
        source_key = first_value(raw, KEY_FIELDS)
        if not source_key:
            source_key = nested_value(
                raw,
                tuple(
                    (parent, field)
                    for parent in ("config", "configuration", "settings", "credentials")
                    for field in KEY_FIELDS
                ),
            )
        if isinstance(source_key, str) and source_key:
            provider["sourceApiKey"] = source_key
    return provider


def normalize_catalog(
    root: Any,
    *,
    include_non_chat: bool = False,
    import_source_keys: bool = False,
) -> list[dict[str, Any]]:
    providers: list[dict[str, Any]] = []
    for raw in provider_objects(root):
        provider = normalize_provider(
            raw,
            include_non_chat=include_non_chat,
            import_source_keys=import_source_keys,
        )
        if provider:
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
    for name in env_names(provider.get("apiKeyEnv")):
        value = os.environ.get(name)
        if value:
            return value
    source_key = provider.get("sourceApiKey")
    return source_key if isinstance(source_key, str) and source_key else None


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
    key = provider_api_key(provider)
    if key:
        group["apiKey"] = key
    elif existing and isinstance(existing.get("apiKey"), str) and existing["apiKey"]:
        # A catalog-only rerun must not erase a key installed on an earlier run.
        group["apiKey"] = existing["apiKey"]
    return group


def group_key(group: dict[str, Any]) -> tuple[str, str]:
    return str(group.get("vendor", "")), str(group.get("name", ""))


def merge_groups(
    existing: list[Any], providers: list[dict[str, Any]], skip_missing_keys: bool
) -> tuple[list[Any], list[tuple[str, int, bool]]]:
    output = copy.deepcopy(existing)
    positions: dict[tuple[str, str], int] = {}
    for index, item in enumerate(output):
        if isinstance(item, dict):
            positions[group_key(item)] = index

    summary: list[tuple[str, int, bool]] = []
    for provider in providers:
        vendor = "ollama" if provider["slug"] == "ollama" else CUSTOM_VENDOR
        key = (vendor, str(provider["name"]))
        old = output[positions[key]] if key in positions and isinstance(output[positions[key]], dict) else None
        if skip_missing_keys and provider["slug"] != "ollama" and not (
            provider_api_key(provider) or (old and old.get("apiKey"))
        ):
            eprint(f"warning: skipping {provider['name']}: no API key")
            continue
        group = provider_group(provider, old)
        if group is None:
            continue
        existed = key in positions
        if existed:
            output[positions[key]] = group
        else:
            positions[key] = len(output)
            output.append(group)
        summary.append((provider["name"], len(group.get("models", [])), existed))
    return output, summary


def parse_code_server_config() -> Path | None:
    config_home = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    config = config_home / "code-server" / "config.yaml"
    if not config.is_file():
        return None
    try:
        for line in config.read_text(encoding="utf-8").splitlines():
            match = re.match(r"^\s*user-data-dir\s*:\s*(.*?)\s*$", line)
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
    configured = parse_code_server_config()
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
    profile_name = "Termux Bash" if is_termux else "Bash"
    # Do not force a login shell. On Termux, `bash -l` executes user and system
    # login startup files; one failing command there makes code-server report
    # that the terminal exited with status 1. A normal interactive Bash still
    # loads the expected interactive environment without that fragile path.
    profile = {"path": shell_path}

    profiles = settings.get("terminal.integrated.profiles.linux")
    if not isinstance(profiles, dict):
        profiles = {}
    profiles = copy.deepcopy(profiles)
    profiles[profile_name] = profile
    settings["terminal.integrated.profiles.linux"] = profiles
    settings["terminal.integrated.defaultProfile.linux"] = profile_name
    settings["terminal.integrated.automationProfile.linux"] = profile

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

    settings_path: Path | None = None
    merged_settings: dict[str, Any] | None = None
    shell_path: str | None = None
    if args.enable_terminal:
        # Agent mode only exposes run-in-terminal to models advertising tool
        # support. This cannot make a model implement tools, but it lets models
        # with OpenAI-compatible tool calling use the terminal.
        for provider in providers:
            for model in provider.get("models", []):
                model["toolCalling"] = True
        shell_path = terminal_shell_path()
        settings_path = settings_file_path(args)
        merged_settings = terminal_enabled_settings(
            load_settings(settings_path), shell_path
        )

    config_path = config_file_path(args)
    existing = load_existing_groups(config_path)
    merged, summary = merge_groups(existing, providers, args.skip_missing_keys)
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

    print("\nProvider groups:")
    for name, count, existed in summary:
        action = "update" if existed else "add"
        print(f"  {action:<6} {name}: {count} model(s)")
    print(f"\nConfiguration: {config_path}")
    if settings_path and shell_path:
        print(f"Terminal settings: {settings_path}")
        print(f"Terminal shell: {shell_path}")
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
    print("\nDone. After restarting code-server, open Chat and use Manage Models.")
    if missing_keys:
        print("Providers without a key (models are listed but requests may fail):")
        print("  " + ", ".join(missing_keys))
    if args.enable_terminal:
        print(
            "Terminal: integrated and agent terminal profiles are enabled; "
            "trust the workspace before using Agent mode."
        )
        print(
            "Note: only upstream models that truly implement OpenAI tool "
            "calling can run terminal tools."
        )
    print("Security: API keys in chatLanguageModels.json are plaintext; file mode was set to 0600.")
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
