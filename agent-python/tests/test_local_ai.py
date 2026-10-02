"""
Standalone sanity checks for the Local AI quant-resolution and drive-scan
logic (parity with agent-php/tools/tests/localai_quant_check.php and
localai_scan_check.php). Run directly with the project venv:

    python3 tests/test_local_ai.py

Not wired into pytest on purpose — it prints OK/FAIL lines and exits
non-zero on any failure, matching the PHP test harness's style so the two
suites are easy to eyeball side by side.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ.setdefault("AGENT_DATA_DIR", "/tmp/agentpy_test_data")
os.environ.setdefault("AUTH_ENABLED", "0")

from app import local_ai  # noqa: E402

FAILURES = []


def check(label, cond):
    if cond:
        print(f"OK  [{label}]")
    else:
        print(f"FAIL [{label}]")
        FAILURES.append(label)


def check_raises(label, fn):
    try:
        fn()
        print(f"FAIL [{label}] (did not raise)")
        FAILURES.append(label)
    except Exception as e:
        print(f"OK  [{label}]: {e}")


# ---- extract_gguf_quant ----------------------------------------------------
check("extract q4_k_m", local_ai.extract_gguf_quant("model.Q4_K_M.gguf") == "Q4_K_M")
check("extract split q4_k_m", local_ai.extract_gguf_quant("model-Q4_K_M-00001-of-00002.gguf") == "Q4_K_M")
check("extract fp16 -> normalised F16", local_ai.extract_gguf_quant("model.fp16.gguf") == "F16")
check("extract f16", local_ai.extract_gguf_quant("model-f16.gguf") == "F16")
check("extract no quant -> null", local_ai.extract_gguf_quant("README.gguf") is None)
check("extract iq2_m", local_ai.extract_gguf_quant("tiny-IQ2_M.gguf") == "IQ2_M")

# ---- is_split_gguf_filename -------------------------------------------------
check("split detect true", local_ai.is_split_gguf_filename("model-00001-of-00004.gguf") is True)
check("split detect false", local_ai.is_split_gguf_filename("model.gguf") is False)

# ---- quant_map_from_files ---------------------------------------------------
files = [
    "model.Q4_K_M.gguf",
    "model.Q4_K_M-00001-of-00002.gguf",
    "model.Q4_K_M-00002-of-00002.gguf",
    "model.Q8_0.gguf",
    "model.fp16-00001-of-00003.gguf",
    "model.fp16-00002-of-00003.gguf",
    "model.fp16-00003-of-00003.gguf",
    "README.md",
]
qmap = local_ai.quant_map_from_files(files)
print("Quant map keys:", ",".join(sorted(qmap.keys())))
check("map has Q4_K_M", "Q4_K_M" in qmap)
check("map prefers consolidated file over split shards", qmap["Q4_K_M"]["split"] is False)
check("map picks consolidated filename", qmap["Q4_K_M"]["filename"] == "model.Q4_K_M.gguf")
check("map has Q8_0", "Q8_0" in qmap)
check("fp16 is normalised into an F16 quant entry", "F16" in qmap)
check("F16 map prefers consolidated fp16 file over split shards (none exists -> stays split)", qmap["F16"]["split"] is True)

# ---- default_quant -----------------------------------------------------------
check("default quant prefers Q4_K_M", local_ai.default_quant(qmap) == "Q4_K_M")
check("default quant falls back to priority order", local_ai.default_quant({"Q8_0": {"filename": "x", "split": False}}) == "Q8_0")

# ---- resolve_gguf_download (no network: explicit_file / direct URL paths) --
resolved = local_ai.resolve_gguf_download("hf.co/bartowski/Test-GGUF:Q4_K_M", explicit_file="Test-Q4_K_M.gguf")
check("resolve repo", resolved["repo"] == "bartowski/Test-GGUF")
check("resolve quant", resolved["quant"] == "Q4_K_M")
check("resolve url", resolved["url"] == "https://huggingface.co/bartowski/Test-GGUF/resolve/main/Test-Q4_K_M.gguf")

direct = local_ai.resolve_gguf_download("https://example.com/path/model-q5_k_m.gguf")
check("resolve direct url filename", direct["filename"] == "model-q5_k_m.gguf")
check("resolve direct url quant", direct["quant"] == "Q5_K_M")

check_raises("bare ollama-style ref without '/' throws", lambda: local_ai.resolve_gguf_download("qwen2.5-coder:7b"))
check_raises("non-gguf direct url throws", lambda: local_ai.resolve_gguf_download("https://example.com/model.bin"))

# ---- quant_bits --------------------------------------------------------------
check("quant_bits known table hit", local_ai.quant_bits("Q4_K_M") == local_ai.BPW["Q4_K_M"])
check("quant_bits F32", local_ai.quant_bits("F32") == 32.0)
check("quant_bits unknown IQ pattern falls back by leading digit", local_ai.quant_bits("IQ3_XS") == 3.9)

# ---- scan_drive / _scan_dir_find / _scan_dir_walk ---------------------------
fixture = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "agent-php", "tools", "tests", "fixtures", "scan_fixture")
fixture = os.path.abspath(fixture)
check("fixture exists", os.path.isdir(fixture))

find_results = []
local_ai._scan_dir_find(fixture, ["gguf"], 10, find_results, 100)
names_find = sorted(r["name"] for r in find_results)
check("find: exactly 2 results", len(find_results) == 2)
check("find: top-level gguf", "model-q4_k_m.gguf" in names_find)
check("find: nested gguf", "model2-q8_0.gguf" in names_find)
check("find: node_modules excluded", "should-be-excluded.gguf" not in names_find)
quant_by_name = {r["name"]: r["quant"] for r in find_results}
check("find: quant parsed for model-q4_k_m.gguf", quant_by_name.get("model-q4_k_m.gguf") == "Q4_K_M")
check("find: quant parsed for model2-q8_0.gguf", quant_by_name.get("model2-q8_0.gguf") == "Q8_0")

walk_results = []
local_ai._scan_dir_walk(fixture, ["gguf"], walk_results, 100, time.time(), 10)
names_walk = sorted(r["name"] for r in walk_results)
check("walk: exactly 2 results", len(walk_results) == 2)
check("walk: top-level gguf", "model-q4_k_m.gguf" in names_walk)
check("walk: nested gguf", "model2-q8_0.gguf" in names_walk)
check("walk: node_modules excluded", "should-be-excluded.gguf" not in names_walk)

scan = local_ai.scan_drive({"roots": [fixture], "extensions": ["gguf"]})
check("scan_drive: always returns a results array", isinstance(scan["results"], list))
check("scan_drive: finds both files via scan_drive()", scan["count"] == 2)

scan_missing = local_ai.scan_drive({"roots": ["/this/path/does/not/exist"]})
check("scan_drive: missing root is skipped, not fatal", scan_missing["count"] == 0)

# ---- safe_repo_dir_name / suggest_name_from_file ----------------------------
check("safe_repo_dir_name sanitises slashes", local_ai.safe_repo_dir_name("bartowski/Test Repo!") == "bartowski_Test_Repo_")
check("suggest_name_from_file strips extension", local_ai.suggest_name_from_file("/a/b/my-model.Q4_K_M.gguf") == "my-model.Q4_K_M")
check("suggest_name_from_file strips split suffix", local_ai.suggest_name_from_file("/a/model-00001-of-00002.gguf") == "model")

# ---- provider registration (regression test for the old
#      PROVIDER_STORE.get() AttributeError that broke every single install) --
from app.providers import PROVIDER_STORE  # noqa: E402

r1 = local_ai.register_provider("qwen2.5-coder:7b", meta={"name": "Qwen Coder 7B"})
check("register_provider (ollama) returns ok", r1.get("ok") is True)
p_ollama = PROVIDER_STORE.data.get("ollama")
check("ollama provider exists after registration", p_ollama is not None)
check("ollama provider has the new model", any(m.id == "qwen2.5-coder:7b" for m in (p_ollama.models if p_ollama else [])))

r2 = local_ai.register_llamacpp_provider("my-local-model", {"name": "My Local Model", "path": "/tmp/fake.gguf", "contextTokens": 4096})
check("register_llamacpp_provider returns ok", r2.get("ok") is True)
p_llama = PROVIDER_STORE.data.get("llamacpp-local")
check("llamacpp-local provider exists", p_llama is not None)
check("llamacpp-local uses openai-compatible protocol", p_llama.protocol == "openai-compatible")
check("llamacpp-local url ends with /v1", p_llama.url.endswith("/v1"))
check("llamacpp-local has exactly one model", len(p_llama.models) == 1 and p_llama.models[0].id == "my-local-model")

local_ai.register_llamacpp_provider("second-model", {"name": "Second Model", "path": "/tmp/fake2.gguf"})
p_llama2 = PROVIDER_STORE.data.get("llamacpp-local")
check("llamacpp-local model list is replaced, not appended, on re-register", [m.id for m in p_llama2.models] == ["second-model"])

print()
if FAILURES:
    print(f"DONE — {len(FAILURES)} FAILURE(S): {FAILURES}")
    sys.exit(1)
print("DONE — all checks passed")
