#!/usr/bin/env python3
"""Test persisted OpenHands LLM profiles without exposing stored credentials."""

from __future__ import annotations

import asyncio
import json
import random
import re
import sys
import time
from typing import Any

from openhands.agent_server.config import load_config
from openhands.agent_server.persistence import get_llm_profile_store
from openhands.sdk.llm import Message, TextContent
from openhands.sdk.utils.redact import redact_text_secrets

_SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_-]{8,}"),
    re.compile(r"(?i)(api[_ -]?key|authorization|bearer)(\s*[:=]?\s*)[^\s,;]+"),
)


def safe_error(error: BaseException) -> str:
    message = redact_text_secrets(str(error) or type(error).__name__)
    for pattern in _SECRET_PATTERNS:
        if pattern.pattern.startswith("(?i)"):
            message = pattern.sub(r"\1\2[REDACTED]", message)
        else:
            message = pattern.sub("[REDACTED]", message)
    return message[:800]


_RETRYABLE = re.compile(
    r"(?i)(rate[_ -]?limit|ratelimit|429|too many requests|quota|overload|capacity|"
    r"timeout|timed out|temporar|unavailable|try again|503|502|504|500 |internal server|"
    r"connection|reset by peer|eof occurred|broken pipe|handshake|socket|dns|gateway)"
)
_PARAMETER_ISSUE = re.compile(
    r"(?i)(max[_ ]?tokens|max[_ ]?completion[_ ]?tokens|temperature|unsupported|"
    r"not supported|invalid[_ ]?request|system message|developer message|role|"
    r"must be greater|minimum|reasoning)"
)


def classify(message: str) -> str:
    text = message or ""
    if re.search(r"(?i)(401|403|unauthorized|forbidden|invalid api key|authentication)", text):
        return "auth"
    if re.search(r"(?i)(rate[_ -]?limit|ratelimit|429|too many requests|quota)", text):
        return "rate-limit"
    if re.search(r"(?i)(timeout|timed out)", text):
        return "timeout"
    if re.search(r"(?i)(404|not found|no such model|model_not_found|does not exist)", text):
        return "model-missing"
    if _RETRYABLE.search(text):
        return "transient"
    if _PARAMETER_ISSUE.search(text):
        return "parameters"
    return "error"


def is_retryable(message: str) -> bool:
    return classify(message) in {"rate-limit", "timeout", "transient"}


async def one_attempt(llm, timeout: float, minimal: bool) -> None:
    """Send the smallest possible probe request.

    The first attempt keeps a tiny budget; the fallback attempt drops the system
    turn and raises the token budget, because reasoning models reject a 2-token
    completion outright even though the credential and the route are healthy.
    """
    if minimal:
        messages = [
            Message(role="system", content=[TextContent(text="Reply with exactly: OK")]),
            Message(role="user", content=[TextContent(text="ping")]),
        ]
        max_tokens = 2
    else:
        messages = [Message(role="user", content=[TextContent(text="ping")])]
        max_tokens = 64
    if llm.uses_responses_api():
        await asyncio.wait_for(llm.aresponses(messages=messages, max_tokens=max_tokens), timeout=timeout)
    else:
        await asyncio.wait_for(llm.acompletion(messages=messages, max_tokens=max_tokens), timeout=timeout)


async def test_profile(
    name: str,
    semaphore: asyncio.Semaphore,
    on_started=None,
    attempts: int = 3,
    timeout: float = 120.0,
) -> dict[str, Any]:
    queued = time.monotonic()
    model: str | None = None
    async with semaphore:
        started = time.monotonic()
        queue_ms = round((started - queued) * 1000)
        if on_started:
            on_started(name, queue_ms)
        last: dict[str, Any] | None = None
        used = 0
        try:
            config = load_config()
            llm = get_llm_profile_store().load(name, cipher=config.cipher)
            model = str(llm.model or "") or None
            if not model or "/" not in model:
                raise ValueError(
                    "Profile model is missing its LiteLLM provider prefix; "
                    "reconnect it to the correct Provider Connection and retry"
                )
        except Exception as error:  # noqa: BLE001 - configuration problems are real failures
            message = safe_error(error)
            return {
                "name": name, "model": model,
                "provider": model.split("/", 1)[0] if model and "/" in model else None,
                "ok": False, "latencyMs": round((time.monotonic() - started) * 1000),
                "queueMs": queue_ms, "attempts": 0, "errorClass": classify(message),
                "error": {"type": type(error).__name__, "message": message},
            }

        while used < attempts:
            used += 1
            minimal = used == 1
            try:
                await one_attempt(llm, timeout, minimal)
                return {
                    "name": name, "model": model,
                    "provider": model.split("/", 1)[0] if model and "/" in model else None,
                    "ok": True, "latencyMs": round((time.monotonic() - started) * 1000),
                    "queueMs": queue_ms, "attempts": used, "errorClass": None, "error": None,
                }
            except Exception as error:  # noqa: BLE001 - every profile must report a result
                message = safe_error(error)
                kind = classify(message)
                last = {"type": type(error).__name__, "message": message, "kind": kind}
                if used >= attempts:
                    break
                if kind == "parameters":
                    continue  # retry immediately with the roomier fallback request
                if not is_retryable(message):
                    break
                delay = min(20.0, 1.5 * (2 ** (used - 1)))
                await asyncio.sleep(delay + random.uniform(0, 0.75))

        kind = (last or {}).get("kind") or "error"
        return {
            "name": name, "model": model,
            "provider": model.split("/", 1)[0] if model and "/" in model else None,
            "ok": False, "latencyMs": round((time.monotonic() - started) * 1000),
            "queueMs": queue_ms, "attempts": used, "errorClass": kind,
            "error": {"type": (last or {}).get("type", "Error"), "message": (last or {}).get("message", "unknown error")},
        }


async def main() -> int:
    payload = json.load(sys.stdin)
    names = payload.get("profiles", []) if isinstance(payload, dict) else []
    if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
        raise ValueError("profiles must be a list of names")
    names = list(dict.fromkeys(name for name in names if name))
    concurrency = payload.get("concurrency", 3) if isinstance(payload, dict) else 3
    concurrency = max(1, min(int(concurrency), 8))
    attempts = payload.get("attempts", 3) if isinstance(payload, dict) else 3
    attempts = max(1, min(int(attempts), 5))
    timeout = payload.get("timeoutSeconds", 120) if isinstance(payload, dict) else 120
    timeout = float(max(15, min(float(timeout), 300)))
    semaphore = asyncio.Semaphore(concurrency)
    stream = payload.get("stream") is True if isinstance(payload, dict) else False

    def emit_profile_started(name: str, queue_ms: int) -> None:
        print(json.dumps({"event": "profile-started", "name": name, "queueMs": queue_ms}, ensure_ascii=False), flush=True)

    tasks = [asyncio.create_task(test_profile(name, semaphore, emit_profile_started if stream else None, attempts, timeout)) for name in names]
    results: list[dict[str, Any]] = []
    if stream:
        print(json.dumps({"event": "started", "total": len(tasks), "concurrency": concurrency, "attempts": attempts, "timeoutSeconds": timeout}, ensure_ascii=False), flush=True)
        for task in asyncio.as_completed(tasks):
            result = await task
            results.append(result)
            print(json.dumps({"event": "result", "result": result}, ensure_ascii=False), flush=True)
        print(json.dumps({"event": "summary", "tested": len(results)}, ensure_ascii=False), flush=True)
    else:
        results = await asyncio.gather(*tasks)
        json.dump({"tested": len(results), "results": results}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
    return 0 if all(result["ok"] for result in results) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except Exception as error:  # noqa: BLE001
        json.dump(
            {"tested": 0, "results": [], "fatal": {"type": type(error).__name__, "message": safe_error(error)}},
            sys.stdout,
            ensure_ascii=False,
        )
        sys.stdout.write("\n")
        raise SystemExit(2)
