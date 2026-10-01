#!/usr/bin/env python3
"""Dependency-free contract test for the streaming Profile tester."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

LAB_DIR = Path(__file__).resolve().parent
TESTER = LAB_DIR.parent / "openhands-profile-tester.py"

SETTINGS = """
from types import SimpleNamespace
def load_config():
    return SimpleNamespace(cipher=None)
"""

PERSISTENCE = """
import asyncio

class FakeLlm:
    def __init__(self, name):
        self.name = name
        self.model = {"slow":"openai/slow-model","fast":"mistral/fast-model","bad":"anthropic/bad-model","bare":"gemini-2.5-flash"}[name]
    def uses_responses_api(self):
        return False
    async def acompletion(self, **kwargs):
        await asyncio.sleep({"slow":0.12,"fast":0.02,"bad":0.01}[self.name])
        if self.name == "bad":
            secret_marker = "laboratory" + "-credential-marker"
            raise RuntimeError("authorization=" + secret_marker + " provider rejected the request")
        return {"ok": True}

class Store:
    def load(self, name, cipher=None):
        return FakeLlm(name)

def get_llm_profile_store():
    return Store()
"""

LLM = """
class Message:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
class TextContent:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)
"""

REDACT = """
def redact_text_secrets(text):
    return text
"""


def write(path: Path, content: str = "") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def run_tester(fake_root: Path, payload: dict) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = str(fake_root)
    return subprocess.run(
        [sys.executable, str(TESTER)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env=env,
        timeout=10,
        check=False,
    )


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="openhands-profile-tester-") as temp:
        root = Path(temp)
        for package in [
            "openhands",
            "openhands/agent_server",
            "openhands/sdk",
            "openhands/sdk/utils",
        ]:
            write(root / package / "__init__.py")
        write(root / "openhands/agent_server/config.py", SETTINGS)
        write(root / "openhands/agent_server/persistence.py", PERSISTENCE)
        write(root / "openhands/sdk/llm.py", LLM)
        write(root / "openhands/sdk/utils/redact.py", REDACT)

        streamed = run_tester(root, {"profiles": ["slow", "fast", "bad"], "concurrency": 2, "stream": True})
        assert streamed.returncode == 1, streamed.stderr
        assert not streamed.stderr, streamed.stderr
        secret_marker = "laboratory" + "-credential-marker"
        assert secret_marker not in streamed.stdout
        events = [json.loads(line) for line in streamed.stdout.splitlines() if line.strip()]
        assert events[0] == {"event": "started", "total": 3, "concurrency": 2}
        assert events[-1] == {"event": "summary", "tested": 3}
        started = [event for event in events if event.get("event") == "profile-started"]
        results = [event["result"] for event in events if event.get("event") == "result"]
        assert {event["name"] for event in started} == {"slow", "fast", "bad"}
        assert all(isinstance(event["queueMs"], int) and event["queueMs"] >= 0 for event in started)
        assert [result["name"] for result in results[:2]] == ["fast", "bad"]
        assert results[-1]["name"] == "slow"
        failed = next(result for result in results if result["name"] == "bad")
        assert failed["provider"] == "anthropic"
        assert failed["error"]["type"] == "RuntimeError"
        assert "[REDACTED]" in failed["error"]["message"]
        assert secret_marker not in failed["error"]["message"]
        assert all(isinstance(result["latencyMs"], int) for result in results)
        assert all(isinstance(result["queueMs"], int) for result in results)

        blocking = run_tester(root, {"profiles": ["fast"], "concurrency": 1})
        assert blocking.returncode == 0, blocking.stderr
        parsed = json.loads(blocking.stdout)
        assert parsed["tested"] == 1
        assert parsed["results"][0]["name"] == "fast"
        assert parsed["results"][0]["provider"] == "mistral"

        bare = run_tester(root, {"profiles": ["bare"], "concurrency": 1})
        assert bare.returncode == 1, bare.stderr
        bare_result = json.loads(bare.stdout)["results"][0]
        assert bare_result["ok"] is False
        assert bare_result["error"]["type"] == "ValueError"
        assert "provider prefix" in bare_result["error"]["message"]

        evidence = {
            "status": "passed",
            "assertions": {
                "streamStartedEvent": True,
                "perProfileRunningEvents": True,
                "resultsArrivedAsCompleted": True,
                "latencyAndQueueMetrics": True,
                "providerMetadata": True,
                "credentialRedaction": True,
                "bareProviderDiagnostic": True,
                "blockingCompatibility": True,
            },
            "streamEventCount": len(events),
        }
        print(json.dumps(evidence, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
