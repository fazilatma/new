"""Comprehensive automated test suite for Arena AI Coding Agent."""
import pytest
import os
import json
import shutil
import tempfile
import pathlib
from pathlib import Path
import time
from fastapi.testclient import TestClient

from app.main import app, APP_VERSION
from app.config import (
    encrypt_secret, decrypt_secret, mask_secret,
    get_or_create_master_key
)
from app.security import (
    hash_password, verify_password, create_session,
    validate_session, delete_all_user_sessions,
    ROLE_ADMIN, ROLE_DEVELOPER, ROLE_VIEWER
)
from app.workspaces import safe_path, get_workspace_root, list_workspace_files
from app.projects import (
    get_active_project, set_active_project, list_projects,
    create_project, update_project, delete_project,
    ProjectCreateRequest, ProjectUpdateRequest
)
from app.changesets import (
    compute_diff, parse_diff_hunks, create_changeset, get_changeset,
    approve_changeset, reject_changeset, rollback_changeset,
    save_file_version_snapshot, list_file_versions, compare_file_versions,
    acquire_file_lock, release_file_lock, approve_changeset_file, reject_changeset_file
)
from app.terminal_sandbox import execute_sandboxed_command, is_dangerous_command, list_active_processes
from app.git_manager import get_git_status, get_git_diff, list_branches
from app.providers import ProviderStore, CIRCUIT_BREAKER, PROVIDER_STORE, Provider, ModelSpec
from app.worker import (
    recover_orphaned_jobs, create_job, get_job_details,
    cancel_job, pause_job, resume_job, retry_job
)
from app.browser_automation import BROWSER_MANAGER, validate_url
from app.observability import log_event, get_logs, get_system_metrics
from app.browser_automation import validate_url

# Ensure standard test providers exist in store
PROVIDER_STORE.data["openrouter"] = Provider(
    id="openrouter",
    name="OpenRouter",
    url="https://openrouter.ai/api/v1",
    protocol="openai-compatible",
    enabled=True,
    apiKey="sk-or-v1-mock-key",
    apiKeys=["sk-or-v1-mock-key"],
    priority=10,
    models=[
        ModelSpec(id="anthropic/claude-3.5-sonnet", name="Claude 3.5 Sonnet", toolCalling=True, vision=True),
        ModelSpec(id="google/gemini-2.5-flash", name="Gemini 2.5 Flash", toolCalling=True, vision=True, free=True)
    ]
)

client = TestClient(app)

def test_version_and_health():
    r = client.get("/api/version")
    assert r.status_code == 200
    assert r.json()["version"] == APP_VERSION
    assert APP_VERSION == "3.3.7"

    hr = client.get("/health")
    assert hr.status_code == 200
    assert hr.json()["status"] == "ok"

def test_projects_crud_and_settings():
    # 1. Create a project
    req = ProjectCreateRequest(
        name="Test API Project",
        description="A backend project for testing",
        defaultProvider="openrouter",
        defaultModel="qwen-2.5",
        defaultBranch="main",
        instructions="Always write modular code.",
        agentRules="- Keep functions under 50 lines.",
        envVars={"ENV_TEST": "true"}
    )
    proj = create_project(req)
    assert proj["name"] == "Test API Project"
    assert proj["description"] == "A backend project for testing"
    assert proj["env_vars"] == {"ENV_TEST": "true"}

    # 2. List projects
    projs = list_projects()
    assert any(p["id"] == proj["id"] for p in projs)

    # 3. Update project settings
    upd = ProjectUpdateRequest(
        description="Updated project description",
        defaultModel="claude-3-5"
    )
    updated_proj = update_project(proj["id"], upd)
    assert updated_proj["description"] == "Updated project description"
    assert updated_proj["default_model"] == "claude-3-5"

    # 4. Activate project
    act = set_active_project(proj["id"])
    assert act["id"] == proj["id"]
    active = get_active_project()
    assert active["id"] == proj["id"]

    # 5. Cleanup / switch back
    default_p = next((p for p in projs if p["id"] != proj["id"]), None)
    if default_p:
        set_active_project(default_p["id"])
        delete_project(proj["id"])

def test_secrets_encryption_and_masking():
    raw_secret = "sk-ant-api03-secret1234567890abcdef"
    encrypted = encrypt_secret(raw_secret)
    assert encrypted.startswith("enc:")
    assert encrypted != raw_secret

    decrypted = decrypt_secret(encrypted)
    assert decrypted == raw_secret

    masked = mask_secret(raw_secret)
    assert "••••" in masked
    assert masked.startswith("sk-")
    assert masked.endswith("cdef")

def test_password_hashing_and_sessions():
    pw = "SuperSecurePassword123!"
    pw_hash, salt = hash_password(pw)
    assert verify_password(pw, pw_hash, salt) is True
    assert verify_password("WrongPassword", pw_hash, salt) is False

    # Session test
    token = create_session("test-user-id", ip="127.0.0.1", user_agent="PyTest")
    assert len(token) > 20
    sess = validate_session(token)
    assert sess is not None

    # Delete all sessions
    delete_all_user_sessions("test-user-id")
    assert validate_session(token) is None

def test_file_locking():
    path = "locked_file.txt"
    assert acquire_file_lock(path, "user-1", ttl_seconds=60) is True
    assert acquire_file_lock(path, "user-2", ttl_seconds=60) is False
    assert acquire_file_lock(path, "user-1", ttl_seconds=60) is True
    assert release_file_lock(path, "user-1") is True
    assert acquire_file_lock(path, "user-2", ttl_seconds=60) is True
    release_file_lock(path, "user-2")

def test_workspace_safe_path_and_path_traversal():
    ws_root = get_workspace_root()
    safe = safe_path("test_file.txt")
    assert ws_root in safe.parents or safe == ws_root

    # Path traversal attempt should raise ValueError
    with pytest.raises(ValueError, match="Path traversal detected"):
        safe_path("../../../../../etc/passwd")

def test_diff_and_hunk_parsing():
    old = "def add(a, b):\n    return a + b\n"
    new = "def add(a, b):\n    # Add docstring\n    return a + b\n"
    diff = compute_diff(old, new, "math.py")
    assert "+    # Add docstring" in diff

    hunks = parse_diff_hunks(diff)
    assert len(hunks) >= 1
    assert any(line["type"] == "add" for line in hunks[0]["lines"])

def test_changeset_lifecycle_and_approval():
    test_file_path = "test_changeset_sample.txt"
    p = safe_path(test_file_path)
    if p.exists():
        p.unlink()

    # 1. Stage Changeset
    cs = create_changeset(
        title="Add sample file",
        files=[{"path": test_file_path, "new_content": "Line 1\nLine 2\n", "change_type": "added"}],
        created_by="pytest"
    )
    assert cs["status"] == "pending"
    assert len(cs["files"]) == 1
    assert not p.exists()

    # 2. Approve Changeset
    appr = approve_changeset(cs["id"], approved_by="pytest-admin")
    assert appr["ok"] is True
    assert p.exists()
    assert p.read_text(encoding="utf-8") == "Line 1\nLine 2\n"

    # 3. Modify and Partial/File Approval
    cs2 = create_changeset(
        title="Modify sample file",
        files=[{"path": test_file_path, "new_content": "Line 1 modified\nLine 2\nLine 3\n", "change_type": "modified"}],
        created_by="pytest"
    )
    file_id = cs2["files"][0]["id"]
    approve_changeset_file(cs2["id"], file_id, approved_by="pytest-admin")
    assert "Line 1 modified" in p.read_text(encoding="utf-8")

    # 4. Rollback
    rb = rollback_changeset(cs2["id"], rolled_back_by="pytest-admin")
    assert rb["ok"] is True
    assert p.read_text(encoding="utf-8") == "Line 1\nLine 2\n"

    # Version history verification
    versions = list_file_versions(test_file_path)
    assert len(versions) >= 2

    # Compare arbitrary versions
    if len(versions) >= 2:
        comp = compare_file_versions(test_file_path, versions[1]["id"], versions[0]["id"])
        assert "diff" in comp

    # Cleanup
    if p.exists():
        p.unlink()

@pytest.mark.anyio
async def test_unrestricted_browser_url_validation_and_multi_tier_fallback():
    assert validate_url("https://github.com") == "https://github.com"
    assert validate_url("example.com") == "https://example.com"
    assert validate_url("http://google.com/search?q=test") == "http://google.com/search?q=test"

    # Test Multi-Tier Browser Automation Fallback Pipeline (Playwright -> HTTP-DOM -> Synthetic Wireframe)
    session_id = "test-automated-suite"
    nav = await BROWSER_MANAGER.navigate("https://example.com", session_id=session_id)
    assert nav["status"] in (200, 301, 302)
    assert "title" in nav
    assert "engine" in nav

    shot = await BROWSER_MANAGER.screenshot(session_id=session_id)
    assert shot["mime"] == "image/png"
    assert len(shot["image_base64"]) > 500

    ev = await BROWSER_MANAGER.evaluate_js("document.title", session_id=session_id)
    assert "result" in ev

    fill = await BROWSER_MANAGER.fill("input[name=search]", "test text", session_id=session_id)
    assert fill["ok"] is True

    clk = await BROWSER_MANAGER.click("a.more-info", session_id=session_id)
    assert clk["ok"] is True

    logs = await BROWSER_MANAGER.get_logs(session_id=session_id)
    assert len(logs["console"]) > 0

    await BROWSER_MANAGER.close_session(session_id=session_id)

def test_dangerous_terminal_commands_protection():
    assert is_dangerous_command("rm -rf /") is True
    assert is_dangerous_command("DROP TABLE users") is True
    assert is_dangerous_command("git push --force") is True
    assert is_dangerous_command("ls -la") is False

    # Blocked dangerous execution
    res = execute_sandboxed_command("rm -rf /", confirmed_dangerous=False)
    assert res["requiresApproval"] is True
    assert res["exitCode"] == -1

    # Safe command with full network execution
    safe_res = execute_sandboxed_command("echo 'Hello Arena'")
    assert safe_res["exitCode"] == 0
    assert "Hello Arena" in safe_res["stdout"]

def test_git_status_and_diff():
    st = get_git_status()
    assert "isRepo" in st
    diff = get_git_diff()
    assert "diff" in diff
    branches = list_branches()
    assert "branches" in branches

def test_circuit_breaker():
    pid = "test-failing-provider"
    assert CIRCUIT_BREAKER.is_tripped(pid) is False
    for _ in range(5):
        CIRCUIT_BREAKER.record_failure(pid)
    assert CIRCUIT_BREAKER.is_tripped(pid) is True
    CIRCUIT_BREAKER.record_success(pid)
    assert CIRCUIT_BREAKER.is_tripped(pid) is False

def test_job_worker_and_lifecycle():
    recover_orphaned_jobs()
    job = create_job(
        title="Test Task",
        provider_id="openrouter",
        model_id="qwen",
        payload={"message": "Hello"}
    )
    jid = job["id"]
    assert job["status"] == "queued"

    # Pause & Resume
    pause_job(jid)
    j_paused = get_job_details(jid)
    assert j_paused["status"] == "paused"

    resume_job(jid)
    j_resumed = get_job_details(jid)
    assert j_resumed["status"] == "queued"

    # Cancel & Retry
    cancel_job(jid)
    j_cancelled = get_job_details(jid)
    assert j_cancelled["status"] == "cancelled"

    retry_job(jid)
    j_retry = get_job_details(jid)
    assert j_retry["status"] == "queued"

def test_observability_and_logging():
    log_event("INFO", "TEST", "Testing observability logging mechanism")
    log_event("SECURITY", "AUTH", "Testing security log entry")

    logs = get_logs(level="SECURITY")
    assert any("Testing security log entry" in l["message"] for l in logs)

    metrics = get_system_metrics()
    assert "activeJobs" in metrics
    assert "disk" in metrics

def test_api_routes_integration():
    pr = client.get("/api/projects")
    assert pr.status_code == 200
    assert "projects" in pr.json()

    r = client.get("/api/workspaces")
    assert r.status_code == 200
    assert "workspaces" in r.json()

    cr = client.get("/api/changesets")
    assert cr.status_code == 200
    assert "changesets" in cr.json()

    prov_r = client.get("/api/providers")
    assert prov_r.status_code == 200

    # Provider text import & export testing
    import_json_data = json.dumps([
        {
            "id": "test_imported_provider",
            "name": "Test Imported Provider",
            "url": "https://api.testprovider.com/v1",
            "protocol": "openai",
            "enabled": True,
            "models": [
                {"id": "test-model-1", "name": "Test Model 1", "toolCalling": True}
            ]
        }
    ])
    imp_r = client.post("/api/providers/import-text", json={"json": import_json_data, "replace": False})
    assert imp_r.status_code == 200
    assert imp_r.json()["ok"] is True

    # Test reset circuit
    reset_r = client.post("/api/providers/test_imported_provider/reset-circuit")
    assert reset_r.status_code == 200
    assert reset_r.json()["ok"] is True

    # Test export
    exp_r = client.get("/api/providers/export")
    assert exp_r.status_code == 200
    assert "test_imported_provider" in exp_r.text

    # Clean up test provider
    del_r = client.delete("/api/providers/test_imported_provider")
    assert del_r.status_code == 200

    jr = client.get("/api/jobs")
    assert jr.status_code == 200

    lr = client.get("/api/observability/logs")
    assert lr.status_code == 200

    # Test Observability Export
    obs_exp = client.get("/api/observability/export?format=json")
    assert obs_exp.status_code == 200
    obs_exp_csv = client.get("/api/observability/export?format=csv")
    assert obs_exp_csv.status_code == 200

    # Test Workspace File CRUD & Zip
    cf_r = client.post("/api/workspace/create", json={"path": "test_temp_doc.txt", "content": "Sample content"})
    assert cf_r.status_code == 200
    assert cf_r.json()["ok"] is True

    rn_r = client.post("/api/workspace/rename", json={"oldPath": "test_temp_doc.txt", "newPath": "test_renamed_doc.txt"})
    assert rn_r.status_code == 200
    assert rn_r.json()["ok"] is True

    zip_r = client.get("/api/workspace/export-zip")
    assert zip_r.status_code == 200
    assert len(zip_r.content) > 0

    del_file_r = client.delete("/api/workspace/file?path=test_renamed_doc.txt")
    assert del_file_r.status_code == 200

    # Test Conversation Messages Flow
    conv_r = client.post("/api/conversations", json={"title": "Test Chat Thread", "provider": "openrouter"})
    assert conv_r.status_code == 200
    cid = conv_r.json()["id"]

    add_m_r = client.post(f"/api/conversations/{cid}/messages", json={"role": "user", "content": "Hello agent"})
    assert add_m_r.status_code == 200

    get_m_r = client.get(f"/api/conversations/{cid}/messages")
    assert get_m_r.status_code == 200
    assert len(get_m_r.json()["messages"]) >= 1

    del_c_r = client.delete(f"/api/conversations/{cid}")
    assert del_c_r.status_code == 200

def test_chat_file_and_image_upload():
    # 1. Test text file upload
    text_content = b"def calculate_total(a, b):\n    return a + b\n"
    res = client.post(
        "/api/chat/upload",
        files={"file": ("test_code.py", text_content, "text/x-python")}
    )
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["filename"] == "test_code.py"
    assert data["isImage"] is False
    assert "calculate_total" in data["textSnippet"]
    assert Path(data["savedPath"]).exists()

    # 2. Test image upload (1x1 transparent png)
    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    img_res = client.post(
        "/api/chat/upload",
        files={"file": ("screenshot.png", tiny_png, "image/png")}
    )
    assert img_res.status_code == 200
    img_data = img_res.json()
    assert img_data["ok"] is True
    assert img_data["isImage"] is True
    assert img_data["imageBase64"] is not None
    assert Path(img_data["savedPath"]).exists()

def test_model_endpoint_testing_and_diagnostics():
    # 1. Test test-all models endpoint
    res = client.post("/api/providers/test-all", json={})
    assert res.status_code == 200
    data = res.json()
    assert "results" in data
    assert isinstance(data["results"], list)
    assert len(data["results"]) > 0

    # Every item should have provider, model, latencyMs, ok, timestamp, request, response
    first = data["results"][0]
    assert "provider" in first
    assert "model" in first
    assert "latencyMs" in first
    assert "ok" in first
    assert "timestamp" in first
    assert "request" in first
    assert "directEndpoint" in first["request"]
    assert "effectiveEndpoint" in first["request"]
    assert "response" in first

    # 2. Test single model test endpoint
    single_res = client.post(f"/api/providers/{first['provider']}/models/{first['model']}/test")
    assert single_res.status_code == 200
    single_data = single_res.json()
    assert single_data["provider"] == first["provider"]
    assert single_data["model"] == first["model"]
    assert "ok" in single_data
    assert "latencyMs" in single_data
    assert "request" in single_data
    assert "directEndpoint" in single_data["request"]
    assert "effectiveEndpoint" in single_data["request"]
    assert "response" in single_data

def test_provider_test_all_interleaves_round_robin_not_provider_by_provider(monkeypatch):
    """Regression test: /api/providers/test-all must test model #1 of every
    provider, then model #2 of every provider, and so on -- never every
    model of provider A followed by every model of provider B -- so that
    repeat hits against any single provider (the actual trigger for its
    rate limiting) are spread as far apart in time as possible."""
    from app.models import Provider, ModelSpec
    from app import main as main_module

    call_order = []

    async def fake_diagnostic(p, m, api_key, timeout_sec=4.0, connect_sec=2.0):
        call_order.append((p.id, m.id))
        return {
            "provider": p.id, "providerName": p.name, "model": m.id, "modelName": m.name,
            "ok": True, "latencyMs": 1, "protocol": p.protocol, "message": "OK",
            "timestamp": "now"
        }

    monkeypatch.setattr(main_module, "_execute_model_diagnostic_test", fake_diagnostic)

    fake_providers = {
        "alpha": Provider(id="alpha", name="Alpha", url="https://a.example", protocol="openai-compatible", enabled=True,
                           models=[ModelSpec(id="a1", name="A1"), ModelSpec(id="a2", name="A2"), ModelSpec(id="a3", name="A3")]),
        "beta": Provider(id="beta", name="Beta", url="https://b.example", protocol="openai-compatible", enabled=True,
                          models=[ModelSpec(id="b1", name="B1"), ModelSpec(id="b2", name="B2")]),
        "gamma": Provider(id="gamma", name="Gamma", url="https://c.example", protocol="openai-compatible", enabled=True,
                           models=[ModelSpec(id="c1", name="C1")]),
    }
    monkeypatch.setattr(main_module.PROVIDER_STORE, "data", fake_providers)
    monkeypatch.setattr(main_module.PROVIDER_STORE, "get_api_key", lambda p: "test-key")

    res = client.post("/api/providers/test-all", json={})
    assert res.status_code == 200
    assert len(call_order) == 6

    # Round 0: model #1 of every provider, in provider order.
    assert call_order[0:3] == [("alpha", "a1"), ("beta", "b1"), ("gamma", "c1")]
    # Round 1: model #2 of every provider that still has one (gamma doesn't).
    assert call_order[3:5] == [("alpha", "a2"), ("beta", "b2")]
    # Round 2: model #3 of every provider that still has one (only alpha).
    assert call_order[5:6] == [("alpha", "a3")]

def test_chat_streaming_and_error_diagnostics(monkeypatch):
    async def mock_stream_caller(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        yield {"type": "token", "text": "Hello from mock stream!"}
        yield {"type": "full_message", "message": {"role": "assistant", "content": "Hello from mock stream!"}}

    async def mock_call_caller(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        return {
            "choices": [{
                "message": {"role": "assistant", "content": "Hello from mock non-stream!"}
            }]
        }

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_caller)
    monkeypatch.setattr("app.chat.call_provider_api", mock_call_caller)
    # Test chat streaming endpoint
    res = client.post(
        "/api/chat/stream",
        json={
            "provider": "openrouter",
            "model": "anthropic/claude-3.5-sonnet",
            "messages": [{"role": "user", "content": "Hello agent!"}],
            "maxSteps": 4
        }
    )
    assert res.status_code == 200
    assert "text/event-stream" in res.headers["content-type"]
    text = res.text
    assert "event: status" in text
    assert "event: token" in text or "event: done" in text or "event: error" in text

    # Test non-streaming chat endpoint
    chat_res = client.post(
        "/api/chat",
        json={
            "provider": "openrouter",
            "model": "anthropic/claude-3.5-sonnet",
            "messages": [{"role": "user", "content": "Inspect project structure"}],
            "maxSteps": 4
        }
    )
    assert chat_res.status_code == 200
    chat_data = chat_res.json()
    assert "message" in chat_data
    assert "content" in chat_data["message"]

def test_session_workspace_and_universal_preview_and_execution():
    session_id = f"test_session_{int(time.time())}"
    
    # 1. Activate session workspace
    act_res = client.post(f"/api/workspace/session/{session_id}/activate", json={"title": "Test Chat"})
    assert act_res.status_code == 200
    act_data = act_res.json()
    assert "workspace" in act_data
    assert f"session_{session_id}" == act_data["workspace"]["id"]
    
    # Workspace initially empty
    assert len(act_data["files"]) == 0

    # 2. Create python code file in session workspace
    py_code = 'print("Hello from session runner")\n'
    create_res = client.post("/api/workspace/create", json={"path": "main.py", "content": py_code})
    assert create_res.status_code == 200

    # 3. Create HTML file
    html_code = '<!doctype html><html><body><h1>Interactive Preview</h1></body></html>'
    create_html = client.post("/api/workspace/create", json={"path": "index.html", "content": html_code})
    assert create_html.status_code == 200

    # 4. Create CSV file
    csv_code = 'Name,Age,Role\nAlice,30,Engineer\nBob,25,Designer\n'
    create_csv = client.post("/api/workspace/create", json={"path": "data.csv", "content": csv_code})
    assert create_csv.status_code == 200

    # 5. Test File Preview Metadata API
    prev_py = client.get("/api/workspace/file-preview?path=main.py")
    assert prev_py.status_code == 200
    assert prev_py.json()["isExecutable"] is True
    assert prev_py.json()["type"] == "code"

    prev_html = client.get("/api/workspace/file-preview?path=index.html")
    assert prev_html.status_code == 200
    assert prev_html.json()["type"] == "html"
    assert "/api/workspace/raw?path=index.html" in prev_html.json()["rawUrl"]

    prev_csv = client.get("/api/workspace/file-preview?path=data.csv")
    assert prev_csv.status_code == 200
    assert prev_csv.json()["type"] == "csv"
    assert prev_csv.json()["csvData"]["headers"] == ["Name", "Age", "Role"]
    assert len(prev_csv.json()["csvData"]["rows"]) == 2

    # 6. Test File Execution API
    exec_res = client.post("/api/workspace/execute", json={"path": "main.py"})
    assert exec_res.status_code == 200
    exec_data = exec_res.json()
    assert exec_data["ok"] is True
    assert exec_data["exitCode"] == 0
    assert "Hello from session runner" in exec_data["stdout"]

    # 7. Test Raw File Serve
    raw_res = client.get("/api/workspace/raw?path=index.html")
    assert raw_res.status_code == 200
    assert "text/html" in raw_res.headers["content-type"]
    assert "Interactive Preview" in raw_res.text

    # 8. Reset session workspace
    reset_res = client.post(f"/api/workspace/session/{session_id}/reset")
    assert reset_res.status_code == 200
    assert len(reset_res.json()["files"]) == 0

def test_cross_chat_and_project_references_and_file_access():
    ts = int(time.time() * 1000)
    conv_a_id = f"conv_a_{ts}"
    conv_b_id = f"conv_b_{ts}"

    # 1. Create two conversations in database
    client.post("/api/conversations", json={"title": "Data Analytics Alpha"})
    # Activate Session A workspace and create files
    act_a = client.post(f"/api/workspace/session/{conv_a_id}/activate", json={"title": "Chat Alpha"})
    assert act_a.status_code == 200

    code_a = 'def calculate_metrics(): return {"score": 98.5}\n'
    client.post("/api/workspace/create", json={"path": "metrics.py", "content": code_a})
    csv_a = 'id,value\n1,100\n2,200\n'
    client.post("/api/workspace/create", json={"path": "stats.csv", "content": csv_a})

    # 2. Activate Session B workspace (starts empty)
    act_b = client.post(f"/api/workspace/session/{conv_b_id}/activate", json={"title": "Chat Beta"})
    assert act_b.status_code == 200
    assert len(act_b.json()["files"]) == 0

    # 3. Link Chat A and Project to Chat B as references
    ref_res = client.post(f"/api/conversations/{conv_b_id}/references", json={
        "target_type": "chat",
        "target_id": conv_a_id,
        "title": "Chat Alpha Reference"
    })
    assert ref_res.status_code == 200
    assert ref_res.json()["target_id"] == conv_a_id

    ref_proj = client.post(f"/api/conversations/{conv_b_id}/references", json={
        "target_type": "project",
        "target_id": "proj-default",
        "title": "Default Project Ref"
    })
    assert ref_proj.status_code == 200

    # 4. Fetch references for Chat B
    get_refs = client.get(f"/api/conversations/{conv_b_id}/references")
    assert get_refs.status_code == 200
    refs_data = get_refs.json()
    assert len(refs_data["references"]) >= 2
    alpha_ref = next((r for r in refs_data["references"] if r["target_id"] == conv_a_id), None)
    assert alpha_ref is not None
    assert alpha_ref["file_count"] >= 2
    file_paths = [f["path"] for f in alpha_ref["files"]]
    assert "metrics.py" in file_paths
    assert "stats.csv" in file_paths

    # 5. Test Reference File Listing API
    ref_files = client.get(f"/api/workspace/reference-files?target_type=chat&target_id={conv_a_id}")
    assert ref_files.status_code == 200
    assert len(ref_files.json()["files"]) >= 2

    # 6. Test Reference File Preview API
    prev_ref = client.get(f"/api/workspace/reference-preview?target_type=chat&target_id={conv_a_id}&path=metrics.py")
    assert prev_ref.status_code == 200
    assert prev_ref.json()["type"] == "code"
    assert "calculate_metrics" in prev_ref.json()["content"]
    assert prev_ref.json()["isReferenced"] is True

    prev_csv = client.get(f"/api/workspace/reference-preview?target_type=chat&target_id={conv_a_id}&path=stats.csv")
    assert prev_csv.status_code == 200
    assert prev_csv.json()["type"] == "csv"
    assert prev_csv.json()["csvData"]["headers"] == ["id", "value"]

    # 7. Test Importing/Copying file from Chat A to Chat B workspace
    import_res = client.post("/api/workspace/import-reference-file", json={
        "target_type": "chat",
        "target_id": conv_a_id,
        "source_path": "metrics.py",
        "dest_path": "imported_metrics.py"
    })
    assert import_res.status_code == 200
    assert import_res.json()["ok"] is True

    # Verify Chat B workspace now has imported_metrics.py
    prev_imported = client.get("/api/workspace/file-preview?path=imported_metrics.py")
    assert prev_imported.status_code == 200
    assert "calculate_metrics" in prev_imported.json()["content"]

    # 8. Test Agent Tools with references
    from app.agent_tools import agent_read_file, agent_list_files, agent_copy_referenced_file
    # Reading via prefix @chat:conv_id/file
    text = agent_read_file(f"@chat:{conv_a_id}/metrics.py")
    assert "calculate_metrics" in text

    # Copy via agent tool
    agent_copy_res = agent_copy_referenced_file("chat", conv_a_id, "stats.csv", "agent_stats.csv")
    assert agent_copy_res["ok"] is True

    # 9. Test system prompt enrichment with references
    from app.chat import build_system_prompt
    sys_prompt = build_system_prompt(conversation_id=conv_b_id)
    assert "Referenced Chats & Projects" in sys_prompt
    assert conv_a_id in sys_prompt

    # 10. Test deleting reference
    del_res = client.delete(f"/api/conversations/{conv_b_id}/references/chat/{conv_a_id}")
    assert del_res.status_code == 200
    get_refs_after = client.get(f"/api/conversations/{conv_b_id}/references")
    assert not any(r["target_id"] == conv_a_id for r in get_refs_after.json()["references"])

def test_chat_message_sync_and_edit_lifecycle():
    # 1. Create a conversation
    create_conv = client.post("/api/conversations", json={"title": "Edit Test Conversation"})
    assert create_conv.status_code == 200
    conv_id = create_conv.json()["id"]

    # 2. Add initial user message and assistant response
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "user", "content": "Write a sorting function"})
    client.post(f"/api/conversations/{conv_id}/messages", json={"role": "assistant", "content": "Here is quicksort..."})

    # 3. Simulate message edit & retry by syncing truncated/updated chain
    updated_chain = [
        {"role": "user", "content": "Write a mergesort function instead"},
        {"role": "assistant", "content": "Here is mergesort with O(n log n)..."}
    ]
    sync_res = client.put(f"/api/conversations/{conv_id}/messages/sync", json={"messages": updated_chain})
    assert sync_res.status_code == 200
    assert sync_res.json()["ok"] is True
    assert sync_res.json()["count"] == 2

    # 4. Fetch messages and verify updated contents
    get_msgs = client.get(f"/api/conversations/{conv_id}/messages")
    assert get_msgs.status_code == 200
    msgs = get_msgs.json()["messages"]
    assert len(msgs) == 2
    assert msgs[0]["content"] == "Write a mergesort function instead"
    assert "mergesort with O(n log n)" in msgs[1]["content"]

def test_proxy_configuration_and_routing():
    from app.config import get_proxy_url, get_proxy_config, parse_proxy_setting, DEFAULT_PROXY_URL, read_environment, write_environment

    # 1. Test default proxy constant
    assert DEFAULT_PROXY_URL == "https://proxy.fazilat-ma.workers.dev/?url={url}"

    # 2. Test reading and saving proxy configuration via environment endpoints
    write_environment({
        "AGENT_PROXY_URL": "https://proxy.fazilat-ma.workers.dev/?url={url}",
        "AGENT_PROXY_ENABLED": "true"
    })
    env = read_environment()
    assert env["AGENT_PROXY_URL"] == "https://proxy.fazilat-ma.workers.dev/?url={url}"
    assert env["AGENT_PROXY_ENABLED"] == "true"

    # 3. Test URL rewriting proxy templates
    target = "https://api.openai.com/v1/chat/completions"
    eff_url, p_client = parse_proxy_setting("https://proxy.fazilat-ma.workers.dev/?url={url}", target)
    assert eff_url == f"https://proxy.fazilat-ma.workers.dev/?url={target}"
    assert p_client is None

    # 4. Test Cloudflare Worker prefix without placeholder
    eff_url2, p_client2 = parse_proxy_setting("https://custom-worker.workers.dev", target)
    assert eff_url2 == f"https://custom-worker.workers.dev/?url={target}"
    assert p_client2 is None

    # 5. Test Standard Forward Proxy (HTTP & SOCKS5)
    eff_url3, p_client3 = parse_proxy_setting("http://127.0.0.1:7890", target)
    assert eff_url3 == target
    assert p_client3 == "http://127.0.0.1:7890"

    eff_url4, p_client4 = parse_proxy_setting("socks5://127.0.0.1:1080", target)
    assert eff_url4 == target
    assert p_client4 == "socks5://127.0.0.1:1080"

    # 6. Test Disabled Proxy
    write_environment({"AGENT_PROXY_ENABLED": "false"})
    eff_url5, p_client5 = get_proxy_config(target)
    assert eff_url5 == target
    assert p_client5 is None

    # Re-enable proxy
    write_environment({"AGENT_PROXY_ENABLED": "true", "AGENT_PROXY_URL": "https://proxy.fazilat-ma.workers.dev/?url={url}"})

    # 7. Test proxy test endpoint with URL rewrite
    res = client.post("/api/config/test-proxy", json={
        "proxy_url": "https://proxy.fazilat-ma.workers.dev/?url={url}",
        "target_url": "https://httpbin.org/status/200"
    })
    assert res.status_code == 200
    data = res.json()
    assert "effective_url" in data
    assert "latency_ms" in data
    assert "ok" in data

    # 8. Test proxy test endpoint with forward proxy client
    res_fwd = client.post("/api/config/test-proxy", json={
        "proxy_url": "http://127.0.0.1:9999",
        "target_url": "https://httpbin.org/status/200"
    })
    assert res_fwd.status_code == 200
    data_fwd = res_fwd.json()
    assert data_fwd["effective_url"] == "https://httpbin.org/status/200"
    assert data_fwd["proxy_client"] == "http://127.0.0.1:9999"

def test_verified_model_fallback_mechanism():
    from app.providers import PROVIDER_STORE
    from app.models import Provider, ModelSpec

    # 1. Register two providers (one primary, one backup)
    test_p1 = Provider(
        id="test-primary",
        name="Test Primary",
        url="https://mock-primary.ai/v1",
        protocol="openai-compatible",
        enabled=True,
        apiKey="sk-mock-1",
        models=[ModelSpec(id="model-prime", name="Model Prime", toolCalling=True)]
    )
    test_p2 = Provider(
        id="test-backup",
        name="Test Backup",
        url="https://mock-backup.ai/v1",
        protocol="openai-compatible",
        enabled=True,
        apiKey="sk-mock-2",
        models=[ModelSpec(id="model-verified", name="Model Verified", toolCalling=True)]
    )
    PROVIDER_STORE.upsert(test_p1)
    PROVIDER_STORE.upsert(test_p2)

    # 2. Simulate model diagnostic test: Primary fails, Backup succeeds with 120ms latency
    PROVIDER_STORE.record_metric("test-primary", "model-prime", latency_ms=0, is_error=True)
    PROVIDER_STORE.record_metric("test-backup", "model-verified", latency_ms=120.0, is_error=False)

    # 3. Retrieve verified fallback candidates
    candidates = PROVIDER_STORE.get_verified_fallback_candidates(exclude_provider_id="test-primary", exclude_model_id="model-prime")
    assert len(candidates) > 0
    candidate_pids = [c[0].id for c in candidates]
    assert "test-backup" in candidate_pids

    # Find the backup candidate
    backup_cand = next(c for c in candidates if c[0].id == "test-backup")
    assert backup_cand[1].id == "model-verified"

def test_auto_detect_and_save_code_files_in_workspace():
    from app.chat import auto_detect_and_save_code_files
    from app.workspaces import get_workspace_root, get_or_create_session_workspace, set_active_workspace

    ws = get_or_create_session_workspace("test-code-save-session")
    set_active_workspace(ws["id"])
    ws_root = get_workspace_root()

    sample_ai_response = """
برای ساخت یک ماشین حساب مهندسی، فایل‌های زیر ایجاد شدند:

### index.html
```html
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head><title>ماشین حساب</title></head>
<body><h1>ماشین حساب مهندسی</h1></body>
</html>
```

### style.css
```css
body { background: #1e1e2e; color: #fff; }
```

### calculator.py
```python
import math
def add(a, b): return a + b
```
"""

    auto_detect_and_save_code_files(sample_ai_response)

    # Verify that files were created directly in the session workspace
    html_file = ws_root / "index.html"
    css_file = ws_root / "style.css"
    py_file = ws_root / "calculator.py"

    assert html_file.exists()
    assert "ماشین حساب مهندسی" in html_file.read_text(encoding="utf-8")

    assert css_file.exists()
    assert "#1e1e2e" in css_file.read_text(encoding="utf-8")

    assert py_file.exists()
    assert "def add(a, b)" in py_file.read_text(encoding="utf-8")


def test_workspace_session_folder_view_and_advanced_file_execution():
    """Test folder view listing, advanced file preview, and execution scoped to chat session workspace."""
    session_id = f"test-folder-view-{int(time.time()*1000)}"

    # 1. Activate session workspace
    act_res = client.post(f"/api/workspace/session/{session_id}/activate", json={"title": "Data Analysis Chat"})
    assert act_res.status_code == 200

    # 2. Create Python script file with conversation_id parameter
    script_content = 'print("Executing data analysis pipeline")\nprint("Results: OK")'
    create_res = client.post("/api/workspace/create", json={
        "path": "analysis.py",
        "content": script_content,
        "conversation_id": session_id
    })
    assert create_res.status_code == 200

    # 3. Create helper markdown file
    create_md = client.post("/api/workspace/create", json={
        "path": "README.md",
        "content": "# Pipeline Documentation\nDetailed steps for analysis.",
        "conversation_id": session_id
    })
    assert create_md.status_code == 200

    # 4. List files scoped to conversation_id
    list_res = client.get(f"/api/workspace/files?conversation_id={session_id}")
    assert list_res.status_code == 200
    files = list_res.json()
    paths = [f["path"] for f in files]
    assert "analysis.py" in paths
    assert "README.md" in paths

    # 5. Get file preview for modal with conversation_id
    preview_res = client.get(f"/api/workspace/file-preview?path=analysis.py&conversation_id={session_id}")
    assert preview_res.status_code == 200
    pdata = preview_res.json()
    assert pdata["filename"] == "analysis.py"
    assert pdata["isExecutable"] is True
    assert pdata["type"] == "code"
    assert "Executing data analysis pipeline" in pdata["content"]

    # 6. Execute Python file in session workspace
    exec_res = client.post("/api/workspace/execute", json={
        "path": "analysis.py",
        "conversation_id": session_id
    })
    assert exec_res.status_code == 200
    edata = exec_res.json()
    assert edata["ok"] is True
    assert edata["exitCode"] == 0
    assert "Executing data analysis pipeline" in edata["stdout"]
    assert "Results: OK" in edata["stdout"]

    # 7. Edit file in session workspace
    updated_content = 'print("Updated analysis pipeline v2")'
    write_res = client.put("/api/workspace/file", json={
        "path": "analysis.py",
        "content": updated_content,
        "conversation_id": session_id
    })
    assert write_res.status_code == 200

    # Re-execute to verify updated code runs
    exec_res2 = client.post("/api/workspace/execute", json={
        "path": "analysis.py",
        "conversation_id": session_id
    })
    assert exec_res2.status_code == 200
    assert "Updated analysis pipeline v2" in exec_res2.json()["stdout"]

    # 8. Delete file with conversation_id
    del_res = client.delete(f"/api/workspace/file?path=README.md&conversation_id={session_id}")
    assert del_res.status_code == 200

    # Verify deleted file is no longer in file list
    list_res2 = client.get(f"/api/workspace/files?conversation_id={session_id}")
    paths2 = [f["path"] for f in list_res2.json()]
    assert "README.md" not in paths2
    assert "analysis.py" in paths2


def test_quick_project_creation_with_minimal_fields():
    """Test quick 1-click project creation where only name is supplied and all optional fields use defaults."""
    res = client.post("/api/projects", json={
        "name": "Fast Created Project"
    })
    assert res.status_code == 200
    pdata = res.json()
    assert pdata["name"] == "Fast Created Project"
    assert pdata["default_branch"] in ("main", "arena/01a0ed4c-new")
    assert pdata["id"] is not None


def test_chat_stream_sse_realtime_events(monkeypatch):
    """Test /api/chat/stream returns valid text/event-stream headers and events."""
    async def mock_stream_caller(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        yield {"type": "token", "text": "SSE Event stream response"}
        yield {"type": "full_message", "message": {"role": "assistant", "content": "SSE Event stream response"}}

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_caller)

    res = client.post("/api/chat/stream", json={
        "provider": "openrouter",
        "model": "google/gemini-2.5-flash",
        "messages": [{"role": "user", "content": "Hello"}]
    })
    assert res.status_code == 200
    assert "text/event-stream" in res.headers["content-type"]
    assert "no-cache" in res.headers.get("cache-control", "")
    assert "no" in res.headers.get("x-accel-buffering", "")


def test_auto_detect_and_save_code_files_metadata():
    """Test auto_detect_and_save_code_files parses code blocks and returns accurate file metadata."""
    from app.chat import auto_detect_and_save_code_files

    text = """
Here is the python script to run:
```python:main_test.py
print("Autonomous Code Execution Initialized")
```

And here is the landing page HTML:
```html:index_test.html
<!DOCTYPE html>
<html><body><h1>Live Preview</h1></body></html>
```
"""
    saved = auto_detect_and_save_code_files(text)
    assert len(saved) == 2
    py_file = next(f for f in saved if f["path"] == "main_test.py")
    assert py_file["isExecutable"] is True
    assert py_file["type"] == "python"

    html_file = next(f for f in saved if f["path"] == "index_test.html")
    assert html_file["isHtml"] is True
    assert html_file["type"] == "html"


def test_execute_file_in_workspace():
    """Test execute_file_in_workspace runs scripts and captures stdout, stderr, and exit codes."""
    from app.chat import execute_file_in_workspace
    from app.workspaces import safe_path

    # 1. Python script
    py_path = safe_path("test_calc.py")
    py_path.write_text("print(40 + 2)\n", encoding="utf-8")
    res_py = execute_file_in_workspace("test_calc.py")
    assert res_py["success"] is True
    assert res_py["exitCode"] == 0
    assert "42" in res_py["stdout"]

    # 2. Python script with error
    py_err_path = safe_path("test_broken.py")
    py_err_path.write_text("import non_existent_module_xyz\n", encoding="utf-8")
    res_err = execute_file_in_workspace("test_broken.py")
    assert res_err["success"] is False
    assert res_err["exitCode"] != 0
    assert "non_existent_module_xyz" in res_err["stderr"]

    # 3. HTML Live Preview file
    html_path = safe_path("test_view.html")
    html_path.write_text("<h1>Hello World</h1>", encoding="utf-8")
    res_html = execute_file_in_workspace("test_view.html")
    assert res_html["success"] is True
    assert res_html["fileType"] == "html"
    assert "/api/workspace/raw" in res_html["previewUrl"]


def test_workspace_execute_api_endpoint():
    """Test POST /api/workspace/execute for Python script, Bash, and HTML."""
    # Write Python file
    client.put("/api/workspace/file", json={
        "path": "test_api_script.py",
        "content": "import sys\nsys.stdout.write('API Execution Test OK')\n"
    })

    res = client.post("/api/workspace/execute", json={
        "path": "test_api_script.py"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    assert data["exitCode"] == 0
    assert "API Execution Test OK" in data["stdout"]

    # Write HTML file
    client.put("/api/workspace/file", json={
        "path": "test_api_view.html",
        "content": "<!DOCTYPE html><html><body>Test</body></html>"
    })
    res_html = client.post("/api/workspace/execute", json={
        "path": "test_api_view.html"
    })
    assert res_html.status_code == 200
    data_html = res_html.json()
    assert data_html["ok"] is True
    assert data_html["type"] == "html"
    assert "test_api_view.html" in data_html["previewUrl"]


def test_autonomous_self_healing_chat_loop(monkeypatch):
    """Test that complete_chat automatically detects errors in generated code and self-heals."""
    call_count = 0

    async def mock_call_provider(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First attempt: faulty script
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "Here is the calculation script:\n```python:auto_heal.py\n# faulty script\nimport non_existing_lib\nprint('Done')\n```\n"
                    }
                }]
            }
        else:
            # Second attempt (self-healed): corrected script
            return {
                "choices": [{
                    "message": {
                        "role": "assistant",
                        "content": "I fixed the issue by removing the broken import:\n```python:auto_heal.py\n# corrected script\nprint('Self-Healing Success: 100%')\n```\n"
                    }
                }]
            }

    monkeypatch.setattr("app.chat.call_provider_api", mock_call_provider)
    monkeypatch.setattr("app.providers.ProviderStore.get_api_key", lambda self, p: "sk-mock-key")

    res = client.post("/api/chat", json={
        "provider": "openrouter",
        "model": "google/gemini-2.5-flash",
        "messages": [{"role": "user", "content": "Write a python script to calculate metrics"}]
    })
    assert res.status_code == 200
    body = res.json()
    assert "saved_files" in body
    assert "execution_results" in body
    exec_res = next(r for r in body["execution_results"] if r["path"] == "auto_heal.py")
    assert exec_res["success"] is True
    assert exec_res["exitCode"] == 0
    assert "Self-Healing Success: 100%" in exec_res["stdout"]


@pytest.mark.anyio
async def test_stream_complete_chat_execution_events(monkeypatch):
    """Test stream_complete_chat emits execution_fixing and execution_healed SSE events."""
    from app.chat import stream_complete_chat
    from app.providers import ProviderStore, Provider, ModelSpec

    call_count = 0

    async def mock_stream_provider(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            yield {"type": "token", "text": "Creating broken script:\n```python:stream_heal.py\nimport non_existent_pkg\n```\n"}
            yield {"type": "full_message", "message": {"role": "assistant", "content": "Creating broken script:\n```python:stream_heal.py\nimport non_existent_pkg\n```\n"}}
        else:
            yield {"type": "token", "text": "Fixed script:\n```python:stream_heal.py\nprint('Stream Self-Healing OK')\n```\n"}
            yield {"type": "full_message", "message": {"role": "assistant", "content": "Fixed script:\n```python:stream_heal.py\nprint('Stream Self-Healing OK')\n```\n"}}

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_provider)
    store = ProviderStore()
    monkeypatch.setattr(store, "get_api_key", lambda p: "sk-mock-key")

    events = []
    async for evt in stream_complete_chat(
        store=store,
        provider_id="openrouter",
        model_id="google/gemini-2.5-flash",
        messages=[{"role": "user", "content": "Generate and heal code"}],
        max_steps=5
    ):
        events.append(evt)

    event_types = [e.get("type") for e in events]
    assert "execution_fixing" in event_types
    assert "execution_healed" in event_types
    healed_evt = next(e for e in events if e.get("type") == "execution_healed")
    assert healed_evt["path"] == "stream_heal.py"
    assert healed_evt["exitCode"] == 0
    assert "Stream Self-Healing OK" in healed_evt["stdout"]


def test_php_code_file_auto_detection_and_execution():
    """Test auto-detection and workspace execution command generation for PHP files."""
    from app.chat import auto_detect_and_save_code_files, execute_file_in_workspace
    from app.workspaces import safe_path

    php_markdown = """
Here is the backend API script in PHP:
```php:index.php
<?php
echo "PHP Backend Initialized: OK\n";
```
"""
    saved = auto_detect_and_save_code_files(php_markdown)
    assert len(saved) >= 1
    php_item = next(f for f in saved if f["path"] == "index.php")
    assert php_item["isExecutable"] is True
    assert php_item["type"] == "php"
    assert "PHP Backend Initialized" in php_item["content"]

    # Verify execution runner routing
    res = client.post("/api/workspace/execute", json={
        "path": "index.php"
    })
    assert res.status_code == 200
    exec_data = res.json()
    assert exec_data["ok"] is True
    assert "php" in exec_data["command"]


def test_conversation_checkpoints_crud_and_persistence():
    """Test saving, retrieving, and clearing conversation checkpoints."""
    from app.database import (
        save_conversation_checkpoint,
        get_latest_conversation_checkpoint,
        get_conversation_checkpoints,
        clear_conversation_checkpoints
    )

    conv_id = f"test-cp-{int(time.time()*1000)}"

    # 1. Save step 0 checkpoint
    cp1_id = save_conversation_checkpoint(
        conversation_id=conv_id,
        step_index=0,
        provider_id="openrouter",
        model_id="google/gemini-2.5-flash",
        accumulated_content="Step 1 completed",
        chat_history=[{"role": "user", "content": "build app"}, {"role": "assistant", "content": "Step 1 completed"}],
        status="in_progress"
    )
    assert cp1_id is not None
    assert len(cp1_id) > 0

    # 2. Save step 1 checkpoint
    cp2_id = save_conversation_checkpoint(
        conversation_id=conv_id,
        step_index=1,
        provider_id="groq",
        model_id="llama-3.3-70b",
        accumulated_content="Step 2 completed",
        chat_history=[{"role": "user", "content": "build app"}, {"role": "assistant", "content": "Step 1 completed"}, {"role": "assistant", "content": "Step 2 completed"}],
        saved_files=[{"path": "app.py", "type": "python"}],
        status="completed"
    )
    assert cp2_id is not None

    # 3. Get latest checkpoint
    latest = get_latest_conversation_checkpoint(conv_id)
    assert latest is not None
    assert latest["id"] == cp2_id
    assert latest["stepIndex"] == 1
    assert latest["status"] == "completed"
    assert len(latest["chatHistory"]) == 3
    assert len(latest["savedFiles"]) == 1

    # 4. List all checkpoints
    all_cps = get_conversation_checkpoints(conv_id)
    assert len(all_cps) == 2

    # 5. Clear checkpoints
    clear_conversation_checkpoints(conv_id)
    cleared = get_latest_conversation_checkpoint(conv_id)
    assert cleared is None


def test_conversation_checkpoints_api_endpoints():
    """Test GET /api/conversations/{conv_id}/checkpoints and DELETE endpoint."""
    conv_res = client.post("/api/conversations", json={"title": "Checkpoint Test Chat"})
    conv_id = conv_res.json()["id"]

    from app.database import save_conversation_checkpoint
    save_conversation_checkpoint(
        conversation_id=conv_id,
        step_index=0,
        provider_id="openrouter",
        model_id="google/gemini-2.5-flash",
        chat_history=[{"role": "user", "content": "Hi"}],
        status="in_progress"
    )

    # Fetch via API
    list_res = client.get(f"/api/conversations/{conv_id}/checkpoints")
    assert list_res.status_code == 200
    cps = list_res.json()["checkpoints"]
    assert len(cps) == 1
    assert cps[0]["conversationId"] == conv_id

    # Fetch latest via API
    latest_res = client.get(f"/api/conversations/{conv_id}/checkpoints/latest")
    assert latest_res.status_code == 200
    assert latest_res.json()["checkpoint"]["stepIndex"] == 0

    # Clear via API
    del_res = client.delete(f"/api/conversations/{conv_id}/checkpoints")
    assert del_res.status_code == 200

    latest_res2 = client.get(f"/api/conversations/{conv_id}/checkpoints/latest")
    assert latest_res2.status_code == 404


def test_smart_fallback_candidate_sorting_different_provider():
    """Test get_verified_fallback_candidates prioritizes alternative providers when prefer_different_provider=True."""
    from app.providers import ProviderStore, Provider, ModelSpec

    store = ProviderStore()
    p1 = Provider(id="prov_a", name="Provider A", protocol="openai", url="https://api.a.com/v1", apiKey="sk-a", enabled=True, priority=10, models=[
        ModelSpec(id="model-a1", name="Model A1"),
        ModelSpec(id="model-a2", name="Model A2")
    ])
    p2 = Provider(id="prov_b", name="Provider B", protocol="openai", url="https://api.b.com/v1", apiKey="sk-b", enabled=True, priority=20, models=[
        ModelSpec(id="model-b1", name="Model B1")
    ])

    store.data = {"prov_a": p1, "prov_b": p2}
    # Record successful diagnostic tests
    store.record_metric("prov_a", "model-a1", 100, is_error=False)
    store.record_metric("prov_a", "model-a2", 100, is_error=False)
    store.record_metric("prov_b", "model-b1", 150, is_error=False)

    # If current failed provider is prov_a, candidates should prioritize prov_b first
    candidates = store.get_verified_fallback_candidates(
        exclude_provider_id="prov_a",
        exclude_model_id="model-a1",
        prefer_different_provider=True
    )
    assert len(candidates) >= 1
    assert candidates[0][0].id == "prov_b"


@pytest.mark.anyio
async def test_checkpoint_resumption_in_stream_chat(monkeypatch):
    """Test that stream_complete_chat resumes execution seamlessly from checkpoint."""
    from app.chat import stream_complete_chat
    from app.providers import ProviderStore
    from app.database import save_conversation_checkpoint, clear_conversation_checkpoints

    conv_id = f"test-resume-{int(time.time()*1000)}"
    # Save an initial checkpoint with previous step history
    save_conversation_checkpoint(
        conversation_id=conv_id,
        step_index=0,
        provider_id="openrouter",
        model_id="google/gemini-2.5-flash",
        chat_history=[
            {"role": "user", "content": "Initial prompt"},
            {"role": "assistant", "content": "Step 1 output"}
        ],
        status="in_progress"
    )

    async def mock_stream_provider(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        yield {"type": "token", "text": "Resumed Step 2 Completed"}
        yield {"type": "full_message", "message": {"role": "assistant", "content": "Resumed Step 2 Completed"}}

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_provider)
    store = ProviderStore()
    monkeypatch.setattr(store, "get_api_key", lambda p: "sk-mock-key")

    events = []
    async for evt in stream_complete_chat(
        store=store,
        provider_id="openrouter",
        model_id="google/gemini-2.5-flash",
        messages=[{"role": "user", "content": "Initial prompt"}],
        conversation_id=conv_id
    ):
        events.append(evt)

    event_types = [e.get("type") for e in events]
    assert "checkpoint_resumed" in event_types
    resumed_evt = next(e for e in events if e.get("type") == "checkpoint_resumed")
    assert resumed_evt["stepIndex"] == 0
    clear_conversation_checkpoints(conv_id)


@pytest.mark.anyio
async def test_chat_job_runs_to_completion_with_no_http_connection_alive(monkeypatch):
    """Regression test for 'the agent loop must be server-side': this drives
    a chat job through the exact same worker.execute_job_task() the
    persistent_worker_loop uses, with *no* HTTP request/SSE connection
    involved at all -- proving the agent loop's execution is not a child of,
    or dependent on, any particular browser connection. On completion the
    assistant's answer must be durably saved to the conversation's message
    history (not just handed back over a connection that may never have
    been there to receive it), so a browser that was closed the whole time
    still sees the result when it reopens the conversation.
    """
    from app.worker import create_job, execute_job_task, CHAT_JOB_TYPE
    from app.database import get_job_events_since
    from app.providers import PROVIDER_STORE

    conv_id = f"test-detached-{int(time.time()*1000)}"

    async def mock_stream_provider(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        yield {"type": "token", "text": "Detached job response"}
        yield {"type": "full_message", "message": {"role": "assistant", "content": "Detached job response"}}

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_provider)
    monkeypatch.setattr(PROVIDER_STORE, "get_api_key", lambda p: "sk-mock-key")

    job = create_job(
        title="Detached chat job",
        provider_id="openrouter",
        model_id="google/gemini-2.5-flash",
        payload={"messages": [{"role": "user", "content": "Hello"}]},
        conversation_id=conv_id,
        job_type=CHAT_JOB_TYPE,
    )

    # No fetch(), no StreamingResponse, no browser -- just the worker.
    await execute_job_task(job["id"])

    details = get_job_details(job["id"])
    assert details["status"] == "done"

    events = get_job_events_since(job["id"], since_seq=0)
    assert any(e["type"] == "done" for e in events)

    msgs = client.get(f"/api/conversations/{conv_id}/messages").json()["messages"]
    assert any(m["role"] == "assistant" and "Detached job response" in m["content"] for m in msgs)


def test_conversation_active_job_discovery_endpoint(monkeypatch):
    """The frontend uses this to notice, on page load/reconnect, that a
    conversation already has a chat job running server-side -- so it can
    re-attach to the live stream instead of showing an idle composer while
    the agent is still actually working."""
    from app.worker import create_job, CHAT_JOB_TYPE
    from app.database import get_db

    conv_id = f"test-activejob-{int(time.time()*1000)}"
    res = client.get(f"/api/conversations/{conv_id}/active-job")
    assert res.status_code == 200
    assert res.json()["active"] is None

    job = create_job(
        title="Still running",
        provider_id="openrouter",
        model_id="x",
        payload={"messages": []},
        conversation_id=conv_id,
        job_type=CHAT_JOB_TYPE,
    )
    with get_db() as conn:
        conn.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (job["id"],))

    res2 = client.get(f"/api/conversations/{conv_id}/active-job")
    active = res2.json()["active"]
    assert active is not None
    assert active["id"] == job["id"]

    with get_db() as conn:
        conn.execute("UPDATE jobs SET status = 'done' WHERE id = ?", (job["id"],))
    res3 = client.get(f"/api/conversations/{conv_id}/active-job")
    assert res3.json()["active"] is None


def test_chat_stream_reattach_replays_full_event_history():
    """A client that disconnects and reconnects to the same job (by jobId)
    must see the exact same event sequence it would have seen if it had
    never disconnected -- this is what makes 'closed the tab mid-answer,
    reopened it' safe instead of losing the in-progress response."""
    from app.worker import create_job, publish_job_event, CHAT_JOB_TYPE

    job = create_job(
        title="Reattach test",
        provider_id="openrouter",
        model_id="x",
        payload={"messages": []},
        job_type=CHAT_JOB_TYPE,
    )
    publish_job_event(job["id"], {"type": "status", "status": "started"})
    publish_job_event(job["id"], {"type": "token", "text": "hello "})
    publish_job_event(job["id"], {"type": "token", "text": "world"})
    publish_job_event(job["id"], {"type": "done", "steps": 1})

    res = client.get(f"/api/chat/stream/{job['id']}?since=0")
    assert res.status_code == 200
    text = res.text
    assert "event: status" in text
    assert "event: token" in text
    assert "hello " in text and "world" in text
    assert "event: done" in text

    # Reconnecting with since=2 (already saw status + first token) must only
    # replay what came after.
    res2 = client.get(f"/api/chat/stream/{job['id']}?since=2")
    text2 = res2.text
    assert "hello " not in text2
    assert "world" in text2
    assert "event: done" in text2


def test_recover_orphaned_jobs_resumes_chat_but_fails_non_chat_job_types():
    """A chat job interrupted by a server restart (status still 'running'
    from the previous process) must be re-queued so it resumes from its
    checkpoint. A Local AI install/import job interrupted the same way runs
    in a daemon thread whose state is gone forever -- recover_orphaned_jobs()
    must fail it with a clear message instead of (the old, buggy behaviour)
    silently re-running it through the chat-completion executor."""
    from app.worker import create_job, recover_orphaned_jobs
    from app.database import get_db

    chat_job = create_job(title="Interrupted chat", provider_id="openrouter", model_id="x", payload={}, job_type="chat")
    localai_job = create_job(title="Interrupted install", provider_id="", model_id="", payload={}, job_type="localai-install")
    with get_db() as conn:
        conn.execute("UPDATE jobs SET status = 'running' WHERE id IN (?, ?)", (chat_job["id"], localai_job["id"]))

    recover_orphaned_jobs()

    chat_after = get_job_details(chat_job["id"])
    localai_after = get_job_details(localai_job["id"])

    assert chat_after["status"] == "queued", "chat jobs must be re-queued to resume from their checkpoint"
    assert localai_after["status"] == "failed", "non-chat jobs must not be silently re-run as a chat job"
    assert "retry" in localai_after["error"].lower() or "restart" in localai_after["error"].lower()


@pytest.mark.anyio
async def test_chat_job_resumes_from_checkpoint_after_simulated_server_restart(monkeypatch):
    """End-to-end version of the checkpoint-resume guarantee, driven through
    the actual job system (create_job -> [server restart] -> recover_orphaned_jobs
    -> execute_job_task) rather than calling stream_complete_chat directly,
    so it also exercises the job status transitions a real restart would."""
    from app.worker import create_job, recover_orphaned_jobs, execute_job_task, CHAT_JOB_TYPE
    from app.database import save_conversation_checkpoint, get_job_events_since, get_db, clear_conversation_checkpoints
    from app.providers import PROVIDER_STORE

    conv_id = f"test-restart-resume-{int(time.time()*1000)}"
    save_conversation_checkpoint(
        conversation_id=conv_id,
        step_index=0,
        provider_id="openrouter",
        model_id="google/gemini-2.5-flash",
        chat_history=[
            {"role": "user", "content": "Initial prompt"},
            {"role": "assistant", "content": "Step 1 output"},
        ],
        status="in_progress",
    )

    job = create_job(
        title="Crashed mid-run",
        provider_id="openrouter",
        model_id="google/gemini-2.5-flash",
        payload={"messages": [{"role": "user", "content": "Initial prompt"}]},
        conversation_id=conv_id,
        job_type=CHAT_JOB_TYPE,
    )
    # Simulate: the previous server process died while this job was running.
    with get_db() as conn:
        conn.execute("UPDATE jobs SET status = 'running' WHERE id = ?", (job["id"],))

    # Simulate: the new server process boots and runs its startup recovery.
    recover_orphaned_jobs()
    assert get_job_details(job["id"])["status"] == "queued"

    async def mock_stream_provider(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        yield {"type": "token", "text": "Resumed Step 2 Completed"}
        yield {"type": "full_message", "message": {"role": "assistant", "content": "Resumed Step 2 Completed"}}

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_provider)
    monkeypatch.setattr(PROVIDER_STORE, "get_api_key", lambda p: "sk-mock-key")

    # Simulate: persistent_worker_loop picks the re-queued job back up.
    await execute_job_task(job["id"])

    assert get_job_details(job["id"])["status"] == "done"
    events = get_job_events_since(job["id"], since_seq=0)
    assert any(e["type"] == "checkpoint_resumed" for e in events), "must resume from the checkpoint, not restart the conversation from scratch"
    clear_conversation_checkpoints(conv_id)


@pytest.mark.anyio
async def test_smart_fallback_on_rate_limit_429_in_stream_chat(monkeypatch):
    """Test that a 429 rate limit immediately switches to the next verified candidate and yields model_switched_rate_limit."""
    from app.chat import stream_complete_chat
    from app.providers import ProviderStore, Provider, ModelSpec

    store = ProviderStore()
    p1 = Provider(id="prov_rate_limited", name="Rate Limited Provider", protocol="openai", url="https://api.a.com/v1", apiKey="sk-a", enabled=True, priority=20, models=[
        ModelSpec(id="model-429", name="Model 429")
    ])
    p2 = Provider(id="prov_backup", name="Backup Provider", protocol="openai", url="https://api.b.com/v1", apiKey="sk-b", enabled=True, priority=10, models=[
        ModelSpec(id="model-backup", name="Model Backup")
    ])
    store.data = {"prov_rate_limited": p1, "prov_backup": p2}
    store.record_metric("prov_backup", "model-backup", 120, is_error=False)

    async def mock_stream_provider(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        if p.id == "prov_rate_limited":
            raise Exception("HTTP 429: Rate limit exceeded or quota exhausted")
        else:
            yield {"type": "token", "text": "Backup provider response"}
            yield {"type": "full_message", "message": {"role": "assistant", "content": "Backup provider response"}}

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_provider)

    events = []
    async for evt in stream_complete_chat(
        store=store,
        provider_id="prov_rate_limited",
        model_id="model-429",
        messages=[{"role": "user", "content": "Run task"}]
    ):
        events.append(evt)

    event_types = [e.get("type") for e in events]
    assert "model_switched_rate_limit" in event_types
    switch_evt = next(e for e in events if e.get("type") == "model_switched_rate_limit")
    assert switch_evt["previousProvider"] == "Rate Limited Provider"
    assert switch_evt["newProvider"] == "Backup Provider"
    assert "done" in event_types


@pytest.mark.anyio
async def test_exponential_backoff_retry_loop_in_stream_chat(monkeypatch):
    """Test that transient network timeout triggers retry_countdown and recovers seamlessly."""
    from app.chat import stream_complete_chat
    from app.providers import ProviderStore, Provider, ModelSpec

    store = ProviderStore()
    p = Provider(id="prov_retry", name="Retry Provider", protocol="openai", url="https://api.retry.com/v1", apiKey="sk-r", enabled=True, priority=10, models=[
        ModelSpec(id="model-r", name="Model R")
    ])
    store.data = {"prov_retry": p}

    call_attempt = 0

    async def mock_stream_provider(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        nonlocal call_attempt
        call_attempt += 1
        if call_attempt == 1:
            raise ConnectionError("Network connection reset by peer")
        else:
            yield {"type": "token", "text": "Recovered response after retry"}
            yield {"type": "full_message", "message": {"role": "assistant", "content": "Recovered response after retry"}}

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_provider)

    events = []
    async for evt in stream_complete_chat(
        store=store,
        provider_id="prov_retry",
        model_id="model-r",
        messages=[{"role": "user", "content": "Transient test"}]
    ):
        events.append(evt)

    event_types = [e.get("type") for e in events]
    assert "retry_countdown" in event_types
    retry_evt = next(e for e in events if e.get("type") == "retry_countdown")
    assert retry_evt["attempt"] == 1
    from app.chat import MAX_NETWORK_RETRY_ATTEMPTS
    assert retry_evt["maxAttempts"] == MAX_NETWORK_RETRY_ATTEMPTS
    assert "done" in event_types


@pytest.mark.anyio
async def test_network_retry_fails_fast_not_for_minutes(monkeypatch):
    """Regression test: a persistently unreachable provider (e.g. a local
    Ollama server that never started) used to be retried 10 times with
    delays of 1,2,4,8,16,32,60,60,60s (~4 minutes) before a single error
    was ever surfaced to the user -- which, compounded across any
    configured fallback providers, looked indistinguishable from "the
    model produces no response at all". It must now fail fast (a handful
    of short-delay attempts) and still raise/report a terminal error."""
    import time
    from app.chat import stream_complete_chat, MAX_NETWORK_RETRY_ATTEMPTS, MAX_NETWORK_RETRY_DELAY_SEC
    from app.providers import ProviderStore, Provider, ModelSpec

    store = ProviderStore()
    p = Provider(id="prov_dead", name="Dead Provider", protocol="openai", url="https://api.dead.example/v1", apiKey="sk-d", enabled=True, priority=10, models=[
        ModelSpec(id="model-d", name="Model D")
    ])
    store.data = {"prov_dead": p}

    attempt_count = 0

    async def mock_stream_provider(p, target_model, chat_msgs, api_key, custom_timeout_sec=None, custom_connect_sec=None):
        nonlocal attempt_count
        attempt_count += 1
        raise ConnectionError("Connection refused")
        yield  # pragma: no cover - make this an async generator

    monkeypatch.setattr("app.chat.stream_call_provider_api", mock_stream_provider)

    events = []
    t0 = time.monotonic()
    async for evt in stream_complete_chat(
        store=store,
        provider_id="prov_dead",
        model_id="model-d",
        messages=[{"role": "user", "content": "hi"}]
    ):
        events.append(evt)
    elapsed = time.monotonic() - t0

    # Exactly MAX_NETWORK_RETRY_ATTEMPTS tries, and a terminal error event
    # (no silent death / no infinite hang).
    assert attempt_count == MAX_NETWORK_RETRY_ATTEMPTS
    event_types = [e.get("type") for e in events]
    assert "error" in event_types
    retry_events = [e for e in events if e.get("type") == "retry_countdown"]
    assert len(retry_events) == MAX_NETWORK_RETRY_ATTEMPTS - 1
    for e in retry_events:
        assert e["maxAttempts"] == MAX_NETWORK_RETRY_ATTEMPTS
        assert e["delaySec"] <= MAX_NETWORK_RETRY_DELAY_SEC
    # Worst-case total sleep must stay well under what used to be ~4 minutes.
    assert elapsed < 20, f"retry loop took {elapsed:.1f}s, expected a fast failure"


@pytest.mark.anyio
async def test_stream_call_provider_api_surfaces_real_error_body_not_generic_500(monkeypatch):
    """Regression test for a local llama.cpp/Ollama (or any OpenAI-compatible)
    provider returning a non-2xx with a real diagnostic body: a user reported
    the "Test" button already surfacing the real error after the local_ai.py
    fix (v3.3.5), but chat itself still showed a useless generic message
    ("models produce no response ... as if not even connected to the
    endpoint") because app/chat.py's streaming path used
    `resp.raise_for_status()` directly, whose default message
    ("Server error '500 Internal Server Error' for url ...") discards the
    response body -- exactly where llama-server puts the real, actionable
    diagnosis (e.g. "llama-server process has terminated: signal: killed",
    almost always an OOM kill). stream_call_provider_api() must now surface
    that real body text instead."""
    import httpx
    from app.chat import stream_call_provider_api
    from app.providers import Provider, ModelSpec

    error_body = b'{"error": "llama-server process has terminated: signal: killed"}'

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=error_body, headers={"Content-Type": "application/json"})

    mock_transport = httpx.MockTransport(handler)

    original_async_client = httpx.AsyncClient

    def patched_async_client(*args, **kwargs):
        kwargs.pop("proxy", None)
        kwargs["transport"] = mock_transport
        return original_async_client(*args, **kwargs)

    monkeypatch.setattr("app.chat.httpx.AsyncClient", patched_async_client)

    provider = Provider(id="llamacpp-local", name="llama.cpp (local)", protocol="openai-compatible", url="http://127.0.0.1:8081/v1", apiKey="local-llamacpp", enabled=True)
    model = ModelSpec(id="some-model.gguf", name="Some Model")

    caught = None
    try:
        async for _chunk in stream_call_provider_api(provider, model, [{"role": "user", "content": "hi"}], "local-llamacpp"):
            pass
    except Exception as e:
        caught = e

    assert caught is not None, "a 500 response must raise, not be silently swallowed"
    msg = str(caught)
    assert "llama-server process has terminated: signal: killed" in msg
    assert "Server error '500 Internal Server Error' for url" not in msg
    # OOM-kill-specific guidance should be appended for this exact signature.
    assert "کمبود حافظه" in msg


def test_sanitize_messages_for_request_strips_ui_bookkeeping_fields():
    """Unit test for the sanitizer itself: it must drop every client-side/
    internal bookkeeping field while preserving the fields an actual
    provider API needs."""
    from app.chat import _sanitize_messages_for_request

    messages = [
        {"role": "system", "content": "You are a helpful agent."},
        {"role": "user", "content": "build me an app"},
        {
            "role": "assistant",
            "content": "Done! Here's the app.",
            "isFallback": True,
            "fallbackDetails": {
                "used": True, "originalProvider": "Mistral AI", "originalModel": "mistral-large-latest",
                "activeProvider": "Mistral AI", "activeModel": "codestral-2508",
            },
            "execResults": [{"type": "execution_result", "path": "app.js", "status": "success", "exitCode": 0}],
            "renderPreviews": [{"type": "render_preview_ready", "path": "index.html", "previewType": "html"}],
            "reasoning_content": "thinking about the app...",
        },
        {"role": "tool", "content": '{"ok": true}', "tool_call_id": "call_1"},
        {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "run", "arguments": "{}"}}]},
    ]

    clean = _sanitize_messages_for_request(messages)
    assert len(clean) == len(messages)
    for entry in clean:
        for key in entry:
            assert key in {"role", "content", "tool_calls", "tool_call_id", "name"}

    # The fallback-badge assistant message: UI fields gone, real content intact.
    assistant_msg = clean[2]
    assert assistant_msg == {"role": "assistant", "content": "Done! Here's the app."}
    assert "isFallback" not in assistant_msg
    assert "fallbackDetails" not in assistant_msg
    assert "execResults" not in assistant_msg
    assert "renderPreviews" not in assistant_msg
    assert "reasoning_content" not in assistant_msg

    # The tool-result message keeps its required tool_call_id.
    assert clean[3] == {"role": "tool", "content": '{"ok": true}', "tool_call_id": "call_1"}

    # The tool-calling assistant message keeps its tool_calls and a None content.
    assert clean[4]["tool_calls"][0]["function"]["name"] == "run"
    assert clean[4]["content"] is None


@pytest.mark.anyio
async def test_mistral_422_extra_forbidden_scenario_no_longer_happens(monkeypatch):
    """End-to-end regression test for the exact real-world failure reported:
    a multi-turn conversation whose history (as persisted/resent by the
    frontend) contains an assistant message decorated with isFallback/
    fallbackDetails/execResults/renderPreviews -- resending that full
    history to Mistral used to get the *entire* request rejected with
    HTTP 422 `extra_forbidden` (one violation per extra field), which
    surfaced as "خطا در دریافت پاسخ: HTTP 422 ... extra_forbidden ..." and,
    because conversation history is resent every turn, permanently broke
    that conversation. The outgoing request body must now only contain
    messages with provider-recognized fields."""
    import httpx
    from app.chat import stream_call_provider_api
    from app.providers import Provider, ModelSpec

    captured_body = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_body.update(json.loads(request.content.decode("utf-8")))
        # Simulate Mistral's real strict-schema 422 if any extra message
        # field slips through, so the test fails loudly (not just silently
        # passing) if the sanitizer regresses.
        for m in captured_body.get("messages", []):
            extra = set(m.keys()) - {"role", "content", "tool_calls", "tool_call_id", "name"}
            if extra:
                err_body = json.dumps([{"type": "extra_forbidden", "loc": ["body", "messages", 0, m.get("role"), list(extra)[0]], "msg": "Extra inputs are not permitted"}]).encode()
                return httpx.Response(422, content=err_body, headers={"Content-Type": "application/json"})
        body = json.dumps({"choices": [{"delta": {"content": "ok"}}]}).encode()
        return httpx.Response(200, content=b'data: ' + body + b'\n\ndata: [DONE]\n\n', headers={"Content-Type": "text/event-stream"})

    mock_transport = httpx.MockTransport(handler)
    original_async_client = httpx.AsyncClient

    def patched_async_client(*args, **kwargs):
        kwargs.pop("proxy", None)
        kwargs["transport"] = mock_transport
        return original_async_client(*args, **kwargs)

    monkeypatch.setattr("app.chat.httpx.AsyncClient", patched_async_client)

    provider = Provider(id="mistral", name="Mistral AI", protocol="openai-compatible", url="https://api.mistral.ai/v1", apiKey="sk-m", enabled=True)
    model = ModelSpec(id="codestral-2508", name="Codestral")

    dirty_history = [
        {"role": "user", "content": "build me an app"},
        {
            "role": "assistant",
            "content": "Done! Here's the app.",
            "isFallback": True,
            "fallbackDetails": {"used": True, "originalProvider": "Mistral AI", "originalModel": "mistral-large-latest", "activeProvider": "Mistral AI", "activeModel": "codestral-2508"},
            "execResults": [{"type": "execution_result", "path": "app.js", "status": "success", "exitCode": 0}],
            "renderPreviews": [{"type": "render_preview_ready", "path": "index.html", "previewType": "html"}],
        },
        {"role": "user", "content": "now add a login page"},
    ]

    caught = None
    chunks = []
    try:
        async for chunk in stream_call_provider_api(provider, model, dirty_history, "sk-m"):
            chunks.append(chunk)
    except Exception as e:
        caught = e

    assert caught is None, f"request was rejected: {caught}"
    assert any(c.get("type") == "token" for c in chunks)
    # The actual outgoing body must contain only clean messages.
    for m in captured_body["messages"]:
        assert set(m.keys()) <= {"role", "content", "tool_calls", "tool_call_id", "name"}


def test_flexible_provider_import():
    from app.providers import ProviderStore
    store = ProviderStore(data_path="data/test_import_providers.json")

    # Format 1: List with alternative keys (base_url, api_key, models as string list)
    json_format_1 = """
    [
      {
        "id": "openrouter-test",
        "name": "OpenRouter Custom",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key": "sk-or-12345",
        "models": ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"]
      }
    ]
    """
    count = store.import_json(json_format_1, replace=True)
    assert count == 1
    p = store.data.get("openrouter-test")
    assert p is not None
    assert p.url == "https://openrouter.ai/api/v1"
    assert p.apiKey == "sk-or-12345"
    assert len(p.models) == 2
    assert p.models[0].id == "openai/gpt-4o"

    # Format 2: Wrapped in {"providers": [...]} with markdown fences and single quotes
    json_format_2 = """```json
    {
      "providers": {
        "deepseek": {
          "title": "DeepSeek API",
          "endpoint": "https://api.deepseek.com/v1",
          "token": "sk-ds-9999",
          "models": "deepseek-chat, deepseek-coder"
        }
      }
    }
    ```"""
    count = store.import_json(json_format_2, replace=False)
    assert "deepseek" in store.data
    ds = store.data["deepseek"]
    assert ds.name == "DeepSeek API"
    assert ds.url == "https://api.deepseek.com/v1"
    assert ds.apiKey == "sk-ds-9999"
    assert len(ds.models) == 2
    assert ds.models[0].id == "deepseek-chat"


def test_catalog_reimport_merges_instead_of_wiping_existing_config():
    """Regression test for the exact user-reported bug: re-importing a
    provider catalog (replace=False, the default) said "success" but
    visibly added/changed nothing useful, because a blank re-imported
    apiKey/models wiped the already-configured, working provider. Also
    covers protocol inference for the real-world shape users paste: a
    provider keyed by a well-known id (e.g. "ollama") with a "vendor" hint
    but no explicit "protocol" field."""
    import json as _json
    from app.providers import ProviderStore

    store = ProviderStore(path="data/test_catalog_reimport_merge.json")
    store.data = {}

    # Seed a fully-configured, working ollama provider (as if the user had
    # already set it up through the UI).
    seed_payload = _json.dumps({
        "ollama": {
            "id": "ollama", "name": "Ollama", "protocol": "ollama",
            "url": "http://127.0.0.1:11434", "apiKey": "", "enabled": True,
            "models": [{"id": "llama3.2", "name": "Llama 3.2"}]
        },
        "openrouter": {
            "id": "openrouter", "name": "OpenRouter", "protocol": "openai-compatible",
            "url": "https://openrouter.ai/api/v1", "apiKey": "sk-or-real-working-key",
            "enabled": True,
            "models": [{"id": "anthropic/claude-3.7-sonnet", "name": "Claude 3.7 Sonnet"}]
        }
    }, ensure_ascii=False)
    store.import_json(seed_payload, replace=True)
    assert store.data["openrouter"].apiKey == "sk-or-real-working-key"

    # Now re-import the exact shape a real user pastes: no explicit
    # "protocol" field (only "vendor"), a blank apiKey (exactly what
    # export_json() itself produces), and only a subset of models.
    reimport_payload = _json.dumps({
        "ollama": {
            "id": "ollama", "name": "Ollama", "vendor": "ollama-models",
            "url": "http://127.0.0.1:11434", "apiKey": "", "enabled": False, "models": []
        },
        "openrouter": {
            "id": "openrouter", "name": "OpenRouter", "vendor": "openrouter",
            "url": "https://openrouter.ai/api/v1", "apiKey": "",
            "models": [{"id": "openai/gpt-4o", "name": "GPT-4o"}]
        }
    }, ensure_ascii=False)
    report = store.import_json_report(reimport_payload, replace=False)

    assert "ollama" in report["updated"] and "openrouter" in report["updated"]

    ollama = store.data["ollama"]
    assert ollama.protocol == "ollama", "protocol must be guessed from id/vendor when the field is absent, not default to openai-compatible"
    assert [m.id for m in ollama.models] == ["llama3.2"], "a blank incoming models list must not wipe existing models"

    openrouter = store.data["openrouter"]
    assert openrouter.apiKey == "sk-or-real-working-key", "a blank incoming apiKey must never wipe an already-configured real key"
    assert {m.id for m in openrouter.models} == {"anthropic/claude-3.7-sonnet", "openai/gpt-4o"}, "models must be merged by id, not replaced wholesale"
    assert report["modelsAdded"] == 1
    assert openrouter.enabled is True, "enabled must be preserved when the incoming payload for an EXISTING provider omits the field"


def test_catalog_reimport_without_explicit_id_merges_by_json_key_not_by_name():
    """Regression test for the second half of the exact user-reported bug:
    "fetching the catalog doesn't import any models" even after the merge
    fix above. Root cause: when a catalog entry has no explicit "id" field
    (the overwhelmingly common shape -- {"mistral": {"name": "Mistral AI",
    ...}}, exactly what this app's own import-modal placeholder shows), the
    provider's identity used to be derived from the "name" field instead of
    the dict key, so re-importing into an *existing* "mistral" provider
    silently created a brand-new orphaned "mistral-ai" duplicate instead of
    merging into the one the user was actually looking at -- which, from the
    existing provider's model list, looked exactly like zero models were
    imported. Mirrors PHP's Providers::normalizeProvider(), which resolves
    id as `id ?? slug ?? fallbackId` and never considers "name" at all."""
    import json as _json
    from app.providers import ProviderStore

    store = ProviderStore(path="data/test_catalog_reimport_by_key.json")
    store.data = {}
    store.import_json(_json.dumps({
        "mistral": {"id": "mistral", "name": "Mistral", "url": "https://api.mistral.ai/v1",
                    "models": [{"id": "mistral-small-latest", "name": "Mistral Small"}]}
    }), replace=True)
    assert "mistral" in store.data

    # Real-world re-import shape: no "id" field at all, just the dict key
    # ("mistral") and a human display "name" ("Mistral AI") that does NOT
    # slugify back to the existing provider's id.
    report = store.import_json_report(_json.dumps({
        "mistral": {
            "name": "Mistral AI", "url": "https://api.mistral.ai/v1",
            "models": [
                {"id": "mistral-large-latest", "name": "Mistral Large"},
                {"id": "codestral-latest", "name": "Codestral"}
            ]
        }
    }), replace=False)

    assert "mistral-ai" not in store.data, "must never silently fork a same-content duplicate provider under a name-derived id"
    assert report["updated"] == ["mistral"]
    assert report["created"] == []
    mistral = store.data["mistral"]
    assert {m.id for m in mistral.models} == {"mistral-small-latest", "mistral-large-latest", "codestral-latest"}
    assert report["modelsAdded"] == 2


def test_user_rich_provider_export_import():
    from app.providers import ProviderStore, resolve_provider_endpoint_url
    store = ProviderStore(path="data/test_user_rich_providers.json")

    user_payload = """
    {
      "openai": {
        "id": "openai",
        "name": "OpenAI Official",
        "vendor": "openai",
        "url": "https://api.openai.com/v1",
        "protocol": "openai-compatible",
        "enabled": true,
        "apiKeys": [
          {
            "key": "sk-proj-abc123xyz456",
            "label": "Production Key",
            "enabled": true
          }
        ],
        "models": [
          {
            "id": "gpt-4o",
            "name": "GPT-4o (Omni)",
            "toolCalling": true,
            "vision": true,
            "free": false,
            "maxInputTokens": 128000,
            "maxOutputTokens": 16384,
            "tested": true,
            "available": true,
            "pricingMode": "payg",
            "endpointType": "chat",
            "testDetails": {
              "status": 200,
              "latencyMs": 320
            }
          }
        ]
      },
      "ollama": {
        "id": "ollama",
        "name": "Ollama (Local AI)",
        "vendor": "ollama",
        "url": "http://localhost:11434",
        "protocol": "ollama",
        "enabled": false,
        "apiKeys": [],
        "models": []
      },
      "together": {
        "id": "together",
        "name": "Together AI",
        "url": "https://api.together.xyz/v1/chat/completions",
        "protocol": "openai-compatible",
        "enabled": true,
        "apiKeys": [
          {
            "key": "tog-key-998877",
            "label": "Team Key",
            "enabled": true
          }
        ],
        "models": [
          {
            "id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
            "name": "Llama 3.3 70B Turbo",
            "toolCalling": true,
            "vision": false,
            "tested": true,
            "available": true
          }
        ]
      },
      "cloudflare": {
        "id": "cloudflare",
        "name": "Cloudflare Workers AI",
        "url": "https://api.cloudflare.com/client/v4/accounts/test-acc/ai/v1",
        "protocol": "openai-compatible",
        "enabled": true,
        "apiKeys": [
          {
            "key": "cf-token-554433",
            "label": "CF AI Token",
            "enabled": true
          }
        ],
        "models": [
          {
            "id": "@cf/meta/llama-3.3-70b-instruct",
            "name": "Llama 3.3 70B Instruct",
            "toolCalling": false
          }
        ]
      }
    }
    """

    count = store.import_json(user_payload, replace=True)
    assert count == 4

    # Check OpenAI
    openai = store.data.get("openai")
    assert openai is not None
    assert openai.apiKey == "sk-proj-abc123xyz456"
    assert "sk-proj-abc123xyz456" in openai.apiKeys
    assert len(openai.models) == 1
    assert openai.models[0].id == "gpt-4o"
    assert openai.models[0].extra.get("tested") is True
    assert openai.models[0].extra.get("pricingMode") == "payg"
    assert openai.models[0].extra.get("testDetails", {}).get("latencyMs") == 320

    # Check Ollama (empty models gets sensible local defaults)
    ollama = store.data.get("ollama")
    assert ollama is not None
    assert ollama.protocol == "ollama"
    assert len(ollama.models) > 0
    assert any("llama3.2" in m.id for m in ollama.models)

    # Check Together AI (full completion URL)
    together = store.data.get("together")
    assert together is not None
    assert together.apiKey == "tog-key-998877"
    assert "tog-key-998877" in together.apiKeys
    assert len(together.models) == 1
    assert together.models[0].id == "meta-llama/Llama-3.3-70B-Instruct-Turbo"

    # Check Cloudflare
    cf = store.data.get("cloudflare")
    assert cf is not None
    assert cf.apiKey == "cf-token-554433"
    assert cf.models[0].id == "@cf/meta/llama-3.3-70b-instruct"

    # Check URL resolution
    assert resolve_provider_endpoint_url("https://api.openai.com/v1", "openai-compatible") == "https://api.openai.com/v1/chat/completions"
    assert resolve_provider_endpoint_url("https://api.together.xyz/v1/chat/completions", "openai-compatible") == "https://api.together.xyz/v1/chat/completions"
    assert resolve_provider_endpoint_url("http://localhost:11434", "ollama") == "http://localhost:11434/api/chat"
    assert resolve_provider_endpoint_url("http://localhost:11434/api/chat", "ollama") == "http://localhost:11434/api/chat"
    assert resolve_provider_endpoint_url("https://api.anthropic.com", "anthropic") == "https://api.anthropic.com/v1/messages"
    assert resolve_provider_endpoint_url("https://api.anthropic.com/v1", "anthropic") == "https://api.anthropic.com/v1/messages"
    assert resolve_provider_endpoint_url("https://api.anthropic.com/v1/messages", "anthropic") == "https://api.anthropic.com/v1/messages"


def test_cloudflare_workers_ai_endpoint_uses_selected_model():
    """Regression test: every Cloudflare Workers AI request used to resolve
    to the exact same hardcoded `/ai/run/@cf/meta/llama-3.1-8b-instruct`
    endpoint no matter which model was actually selected, because (1) the
    bundled catalog shipped the unrecognized protocol literal
    "cloudflare-workers-ai" which matched none of the protocol-specific
    branches, and (2) even the "cloudflare" branch didn't exist at all, so
    every Cloudflare request silently fell through to the generic
    openai-compatible builder, which just reused whatever model happened to
    already be baked into the configured base URL and ignored the model the
    caller actually asked for.
    """
    from app.providers import resolve_provider_endpoint_url
    from app.models import Provider

    # 1. Legacy/alias protocol strings self-heal to the canonical "cloudflare"
    #    value both on the Provider pydantic model and through JSON import.
    p = Provider(id="cf", name="Cloudflare", url="https://api.cloudflare.com/client/v4/accounts/abc123", protocol="cloudflare-workers-ai")
    assert p.protocol == "cloudflare"
    for alias in ("cf", "cf-ai", "workersai", "CLOUDFLARE_WORKERS_AI"):
        assert Provider(id="cf", name="Cloudflare", url="x", protocol=alias).protocol == "cloudflare"

    # "workers-ai" is intentionally left as its own distinct recognized
    # literal (not canonicalized away) since request-building code treats it
    # as an alias of "cloudflare" wherever the protocol is branched on.
    assert resolve_provider_endpoint_url(
        "https://api.cloudflare.com/client/v4/accounts/abc123", "workers-ai", "@cf/aura-1"
    ) == "https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/aura-1"

    # 2. The seed catalogs (PHP + Python) no longer use the unrecognized literal.
    import json as _json
    for seed_path in ("data/providers.json", "../agent-php/data/providers.json"):
        try:
            seed = _json.loads(open(seed_path, encoding="utf-8").read())
        except FileNotFoundError:
            continue
        assert seed["cloudflare"]["protocol"] == "cloudflare", seed_path

    # 3. The model actually requested must appear in the resolved URL, and
    #    different models must resolve to *different* URLs — previously
    #    every one of these produced the identical endpoint.
    base = "https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/meta/llama-3.1-8b-instruct"
    urls = {
        model: resolve_provider_endpoint_url(base, "cloudflare", model)
        for model in ("@cf/meta/llama-3.1-8b-instruct", "@cf/aura-1", "@cf/openai/gpt-oss-120b", "@cf/flux")
    }
    assert len(set(urls.values())) == 4, f"expected 4 distinct URLs, got {urls}"
    for model, url in urls.items():
        assert url == f"https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/{model}"

    # 4. A base URL that is already a clean account root, or one that uses
    #    the OpenAI-compatible `/ai/v1` suffix, both resolve correctly too.
    assert resolve_provider_endpoint_url("https://api.cloudflare.com/client/v4/accounts/abc123", "cloudflare", "@cf/aura-1") \
        == "https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/aura-1"
    assert resolve_provider_endpoint_url("https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1", "cloudflare", "@cf/flux") \
        == "https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/flux"


def test_cloudflare_workers_ai_request_and_response_shape():
    """The native Cloudflare Workers AI endpoint takes `{"messages": [...]}`
    (no `model` field — the model is a URL path segment) and returns
    `{"result": {"response": "..."}}`, not the OpenAI `choices[...]` shape.
    """
    import asyncio
    from app.models import Provider, ModelSpec
    from app.chat import _normalize_cloudflare_response

    provider = Provider(
        id="cloudflare", name="Cloudflare", protocol="cloudflare",
        url="https://api.cloudflare.com/client/v4/accounts/abc123",
        apiKey="tok_abc",
    )
    model = ModelSpec(id="@cf/aura-1", name="Aura 1")

    normalized = _normalize_cloudflare_response({"result": {"response": "Hello there"}, "success": True})
    assert normalized == {"choices": [{"message": {"role": "assistant", "content": "Hello there"}}]}

    # Bare-string `result` (seen on some Cloudflare model families) also works.
    normalized2 = _normalize_cloudflare_response({"result": "plain text result"})
    assert normalized2["choices"][0]["message"]["content"] == "plain text result"


@pytest.mark.anyio
async def test_diagnostic_test_never_returns_a_blank_error_on_timeout(monkeypatch):
    """Regression test: httpx's own Timeout/Connect exceptions (ReadTimeout,
    ConnectTimeout, PoolTimeout, ConnectError...) very commonly carry an empty
    message (str(e) == ""). The diagnostic "Test Model" / "Test All" harness
    matched against str(e) alone to produce a friendly error, so whenever the
    real exception had no message the "Timeout"/"ConnectError" substring
    checks both missed and the user was shown a completely blank error field
    — this is exactly the "blank-error timeouts" pattern reported for
    multiple providers (e.g. Gemini) in bulk connectivity tests.
    """
    import httpx
    from app.main import _execute_model_diagnostic_test
    from app.providers import Provider, ModelSpec

    p = Provider(id="prov_blank_timeout", name="Blank Timeout Provider", protocol="openai-compatible",
                 url="https://api.blank-timeout.example/v1", apiKey="sk-x", enabled=True)
    m = ModelSpec(id="model-x", name="Model X")

    async def mock_call_provider_api(*args, **kwargs):
        raise httpx.ReadTimeout("")  # empty message, as httpx frequently raises

    monkeypatch.setattr("app.main.call_provider_api", mock_call_provider_api)

    result = await _execute_model_diagnostic_test(p, m, "sk-x")
    assert result["ok"] is False
    assert result["error"], "error field must never be blank"
    assert result["error"] != ""


def test_truncated_json_repair_and_nested_model_import():
    from app.providers import ProviderStore, _repair_truncated_json, _decode_relaxed_json
    store = ProviderStore(path="data/test_truncated_providers.json")

    # 1. Test truncated JSON string repair
    truncated_json = '{"groq": {"name": "Groq", "url": "https://api.groq.com/openai/v1", "models": [{"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B'
    repaired = _repair_truncated_json(truncated_json)
    assert repaired is not None
    assert "groq" in repaired

    # 2. Test importing truncated JSON
    count = store.import_json(truncated_json, replace=True)
    assert count >= 1
    assert "groq" in store.data

    # 3. Test import_models_for_provider when given a full catalog with nested provider models
    full_catalog_payload = """
    {
      "openrouter": {
        "name": "OpenRouter",
        "url": "https://openrouter.ai/api/v1",
        "models": [
          {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet"},
          {"id": "deepseek/deepseek-r1", "name": "DeepSeek R1"}
        ]
      },
      "groq": {
        "name": "Groq",
        "url": "https://api.groq.com/openai/v1",
        "models": [
          {"id": "llama-3.3-70b-versatile", "name": "Llama 3.3 70B"}
        ]
      }
    }
    """
    res = store.import_models_for_provider("groq", full_catalog_payload, replace=False)
    assert res["ok"] is True
    assert (res["added"] + res["updated"]) >= 1
    groq_model_ids = [m.id for m in store.data["groq"].models]
    assert "llama-3.3-70b-versatile" in groq_model_ids

    # 4. Test plain text lines of model IDs
    plain_text_models = """
    # Popular models
    llama3.3:70b
    qwen2.5-coder:32b
    mistral-large:latest
    """
    res2 = store.import_models_for_provider("groq", plain_text_models, replace=False)
    assert res2["ok"] is True
    groq_model_ids2 = [m.id for m in store.data["groq"].models]
    assert "llama3.3:70b" in groq_model_ids2
    assert "qwen2.5-coder:32b" in groq_model_ids2

def test_code_generation_mode_and_html_bundling():
    """Test project code_generation_mode configuration and smart HTML bundling without 404s."""
    # 1. Test Project code_generation_mode creation & update
    proj_res = client.post("/api/projects", json={
        "name": "Single File Web App",
        "description": "App testing single-file artifact mode",
        "codeGenerationMode": "single-file"
    })
    assert proj_res.status_code == 200
    proj_data = proj_res.json()
    assert proj_data["code_generation_mode"] == "single-file"
    proj_id = proj_data["id"]

    # Update to multi-file
    up_res = client.put(f"/api/projects/{proj_id}", json={
        "codeGenerationMode": "multi-file"
    })
    assert up_res.status_code == 200
    assert up_res.json()["code_generation_mode"] == "multi-file"

    # 2. Test Smart HTML Preview Bundling (Inlining CSS & JS to prevent 404s)
    # Create HTML, CSS, and JS in active workspace
    client.post("/api/workspace/create", json={
        "path": "test_app/style.css",
        "content": "body { background: #000; color: #fff; }"
    })
    client.post("/api/workspace/create", json={
        "path": "test_app/app.js",
        "content": "console.log('App loaded');"
    })
    client.post("/api/workspace/create", json={
        "path": "test_app/index.html",
        "content": """<!doctype html>
<html>
<head>
    <link rel="stylesheet" href="style.css">
    <script src="app.js"></script>
</head>
<body><h1>Hello World</h1></body>
</html>"""
    })

    # Fetch raw HTML preview
    raw_res = client.get("/api/workspace/raw?path=test_app/index.html")
    assert raw_res.status_code == 200
    html_out = raw_res.text
    # Verify CSS and JS were bundled inline
    assert "data-inlined-from=\"style.css\"" in html_out
    assert "body { background: #000; color: #fff; }" in html_out
    assert "data-inlined-from=\"app.js\"" in html_out
    assert "console.log('App loaded');" in html_out

    # 3. Test File Preview endpoint returns bundled HTML and proper rawUrl
    prev_res = client.get("/api/workspace/file-preview?path=test_app/index.html")
    assert prev_res.status_code == 200
    pdata = prev_res.json()
    assert pdata["type"] == "html"
    assert "data-inlined-from=\"style.css\"" in pdata["content"]
    assert "/api/workspace/raw?path=test_app/index.html" in pdata["rawUrl"]


def test_localai_search_and_runtime_resilience():
    """Test local AI catalog search and offline connection error resilience."""
    # 1. Search endpoint returns catalog models
    s_res = client.post("/api/localai/search", json={"query": "qwen", "remote": False})
    assert s_res.status_code == 200
    s_data = s_res.json()
    assert "catalog" in s_data
    assert len(s_data["catalog"]) > 0
    assert any("qwen" in m["id"].lower() for m in s_data["catalog"])

    # 2. Runtime status when server is offline does not throw [Errno 111] error string
    rt_res = client.get("/api/localai/runtime")
    assert rt_res.status_code == 200
    rt_data = rt_res.json()
    assert "modelsDir" in rt_data
    assert "modelsDirWritable" in rt_data
    assert "Connection refused" not in rt_data.get("error", "")

    # 3. Permission auto-fix endpoint
    fix_res = client.post("/api/localai/runtime/fix-permissions")
    assert fix_res.status_code == 200
    assert fix_res.json()["ok"] is True


def test_localai_host_endpoint_returns_flat_shape_for_frontend():
    """Regression test: the Local AI dashboard JS (mirrored from the PHP
    edition, whose LocalAI::hostScan() returns memory/cpu/gpu/disk/
    suggestedRamBudgetGb/runtime as TOP-LEVEL keys) reads
    HOST.memory / HOST.cpu / HOST.gpu / HOST.disk / HOST.suggestedRamBudgetGb
    directly off the /api/localai/host response. The Python backend's
    internal local_ai.host_scan() nests those same fields one level deeper
    under "host", and the route used to return that nested shape verbatim —
    so every one of those frontend reads silently resolved to undefined and
    fell back to hardcoded placeholder values (4GB total RAM, 2GB available,
    no GPU, 10GB disk, ~2GB suggested budget) instead of the real scan,
    which is exactly the "hardware recommendation looks wrong/empty" symptom
    reported for the Local AI section. The HTTP response must be flat.
    """
    res = client.get("/api/localai/host")
    assert res.status_code == 200
    data = res.json()

    # These must be top-level, not nested under a "host" key.
    for key in ("os", "arch", "cpu", "memory", "disk", "gpu", "suggestedRamBudgetGb", "runtime"):
        assert key in data, f"expected top-level '{key}' in /api/localai/host response"
    assert "host" not in data, "/api/localai/host must not nest fields under a 'host' key"

    assert "totalGb" in data["memory"]
    assert "availableGb" in data["memory"]
    assert data["suggestedRamBudgetGb"] == data["memory"].get("suggestedBudgetGb")
    assert "modelsDir" in data["runtime"]


def test_localai_server_env_always_has_a_usable_home(monkeypatch):
    """Regression test: several hosting-panel/process-manager launchers start
    this server with no $HOME at all (or one that doesn't exist / isn't
    writable under the service account actually running it). The ollama/
    llama.cpp binaries are Go/C++ programs that call os.UserHomeDir() during
    startup (e.g. to create ~/.ollama's local identity key) and hard-fail
    with exactly "Error: $HOME is not defined" when it's missing — this was
    reported as every single model install failing with
    "Local AI server did not become ready within 20s. Log: Error: $HOME is
    not defined" repeated several times. server_env() must always inject a
    real, writable HOME regardless of what the parent process's own
    environment looks like.
    """
    from app import local_ai

    # Simulate a launcher that provides no HOME at all.
    monkeypatch.delenv("HOME", raising=False)
    env = local_ai.server_env()
    assert env.get("HOME"), "server_env() must always set a non-empty HOME"
    assert os.path.isdir(env["HOME"]), "the injected HOME must actually exist"
    assert os.access(env["HOME"], os.W_OK), "the injected HOME must be writable"

    # Simulate a launcher that provides a HOME pointing at a non-existent/
    # unwritable path (e.g. a stale value from an unrelated container image).
    monkeypatch.setenv("HOME", "/this/path/does/not/exist/at/all")
    env2 = local_ai.server_env()
    assert os.path.isdir(env2["HOME"])
    assert os.access(env2["HOME"], os.W_OK)

    # A real, writable HOME supplied by the parent process must be preserved
    # as-is (no unnecessary override).
    monkeypatch.setenv("HOME", tempfile.gettempdir())
    env3 = local_ai.server_env()
    assert env3["HOME"] == tempfile.gettempdir()


def test_describe_http_error_surfaces_real_ollama_error_body():
    """Regression test: clicking "Test" on a freshly-installed local model
    (or Install/Delete hitting a failing Ollama/llama.cpp endpoint) reported
    a bare, useless 'HTTP Error 500: Internal Server Error' -- that text is
    just the generic reason phrase for the status code, discarding the real,
    actionable diagnosis Ollama/llama.cpp actually put in the response body
    (e.g. "model requires more system memory than is available", "llama
    runner process has terminated"). _describe_http_error() must read and
    surface that body instead of the generic reason phrase."""
    import urllib.error
    from app import local_ai

    # JSON error body shape, exactly what Ollama sends.
    err = urllib.error.HTTPError(url="http://127.0.0.1:11434/api/generate", code=500, msg="Internal Server Error", hdrs=None, fp=None)
    err.read = lambda: b'{"error":"model requires more system memory (6.2 GiB) than is available (4.1 GiB)"}'
    result = local_ai._describe_http_error(err)
    assert "model requires more system memory" in result
    assert result != "HTTP Error 500: Internal Server Error"

    # Plain-text (non-JSON) error body must still come through.
    err2 = urllib.error.HTTPError(url="http://127.0.0.1:11434/api/generate", code=500, msg="Internal Server Error", hdrs=None, fp=None)
    err2.read = lambda: b"llama runner process has terminated: exit status 2"
    result2 = local_ai._describe_http_error(err2)
    assert "llama runner process has terminated" in result2

    # No body at all must still degrade gracefully (not crash).
    err3 = urllib.error.HTTPError(url="http://127.0.0.1:11434/api/generate", code=404, msg="Not Found", hdrs=None, fp=None)
    err3.read = lambda: b""
    result3 = local_ai._describe_http_error(err3)
    assert "404" in result3

    # Non-HTTPError exceptions still fall back to str(e) unchanged.
    assert local_ai._describe_http_error(ConnectionError("refused")) == "refused"


def test_benchmark_test_surfaces_real_ollama_error_not_generic_500(monkeypatch):
    """End-to-end regression test for the actual 'Test' button flow
    (POST /api/localai/test -> benchmark_test()): a 500 from Ollama's
    /api/generate must bubble up as the real diagnostic message, not the
    bare 'HTTP Error 500: Internal Server Error'."""
    import urllib.error
    from app import local_ai

    monkeypatch.setattr(local_ai, "get_state", lambda key, *a, **kw: "ollama" if key == "localai:engine" else None)
    monkeypatch.setattr(local_ai, "server_up", lambda engine=None: {"up": True})
    monkeypatch.setattr(local_ai, "host_url", lambda: "http://127.0.0.1:11434")

    def fake_urlopen(req, timeout=None):
        err = urllib.error.HTTPError(url=req.full_url, code=500, msg="Internal Server Error", hdrs=None, fp=None)
        err.read = lambda: b'{"error":"model requires more system memory (6.2 GiB) than is available (4.1 GiB)"}'
        raise err

    monkeypatch.setattr(local_ai.urllib.request, "urlopen", fake_urlopen)

    result = local_ai.benchmark_test("some-model:latest")
    assert result["ok"] is False
    assert "model requires more system memory" in result["error"]
    assert result["error"] != "HTTP Error 500: Internal Server Error"
