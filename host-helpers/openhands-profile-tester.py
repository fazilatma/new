#!/usr/bin/env python3
"""Test persisted OpenHands LLM profiles without exposing stored credentials."""

from __future__ import annotations

import asyncio
import json
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


async def test_profile(name: str, semaphore: asyncio.Semaphore, on_started=None) -> dict[str, Any]:
    queued = time.monotonic()
    model: str | None = None
    async with semaphore:
        started = time.monotonic()
        queue_ms = round((started - queued) * 1000)
        if on_started:
            on_started(name, queue_ms)
        try:
            config = load_config()
            llm = get_llm_profile_store().load(name, cipher=config.cipher)
            model = str(llm.model or "") or None
            messages = [
                Message(role="system", content=[TextContent(text="Reply with exactly: OK")]),
                Message(role="user", content=[TextContent(text="ping")]),
            ]
            if llm.uses_responses_api():
                await asyncio.wait_for(llm.aresponses(messages=messages, max_tokens=2), timeout=90)
            else:
                await asyncio.wait_for(llm.acompletion(messages=messages, max_tokens=2), timeout=90)
            return {
                "name": name,
                "model": model,
                "provider": model.split("/", 1)[0] if model and "/" in model else None,
                "ok": True,
                "latencyMs": round((time.monotonic() - started) * 1000),
                "queueMs": queue_ms,
                "error": None,
            }
        except Exception as error:  # noqa: BLE001 - every profile must report a result
            return {
                "name": name,
                "model": model,
                "provider": model.split("/", 1)[0] if model and "/" in model else None,
                "ok": False,
                "latencyMs": round((time.monotonic() - started) * 1000),
                "queueMs": queue_ms,
                "error": {"type": type(error).__name__, "message": safe_error(error)},
            }


async def main() -> int:
    payload = json.load(sys.stdin)
    names = payload.get("profiles", []) if isinstance(payload, dict) else []
    if not isinstance(names, list) or not all(isinstance(name, str) for name in names):
        raise ValueError("profiles must be a list of names")
    names = list(dict.fromkeys(name for name in names if name))
    concurrency = payload.get("concurrency", 3) if isinstance(payload, dict) else 3
    concurrency = max(1, min(int(concurrency), 5))
    semaphore = asyncio.Semaphore(concurrency)
    stream = payload.get("stream") is True if isinstance(payload, dict) else False

    def emit_profile_started(name: str, queue_ms: int) -> None:
        print(json.dumps({"event": "profile-started", "name": name, "queueMs": queue_ms}, ensure_ascii=False), flush=True)

    tasks = [asyncio.create_task(test_profile(name, semaphore, emit_profile_started if stream else None)) for name in names]
    results: list[dict[str, Any]] = []
    if stream:
        print(json.dumps({"event": "started", "total": len(tasks), "concurrency": concurrency}, ensure_ascii=False), flush=True)
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
