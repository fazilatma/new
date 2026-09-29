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
from app.providers import ProviderStore, CIRCUIT_BREAKER
from app.worker import (
    recover_orphaned_jobs, create_job, get_job_details,
    cancel_job, pause_job, resume_job, retry_job
)
from app.browser_automation import BROWSER_MANAGER, validate_url
from app.observability import log_event, get_logs, get_system_metrics
from app.browser_automation import validate_url

client = TestClient(app)

def test_version_and_health():
    r = client.get("/api/version")
    assert r.status_code == 200
    assert r.json()["version"] == APP_VERSION
    assert APP_VERSION == "0.9.0"

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

    # Every item should have provider, model, latencyMs, ok, timestamp
    first = data["results"][0]
    assert "provider" in first
    assert "model" in first
    assert "latencyMs" in first
    assert "ok" in first
    assert "timestamp" in first

    # 2. Test single model test endpoint
    single_res = client.post(f"/api/providers/{first['provider']}/models/{first['model']}/test")
    assert single_res.status_code == 200
    single_data = single_res.json()
    assert single_data["provider"] == first["provider"]
    assert single_data["model"] == first["model"]
    assert "ok" in single_data
    assert "latencyMs" in single_data

def test_chat_streaming_and_error_diagnostics():
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




