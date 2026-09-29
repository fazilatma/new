"""Comprehensive automated test suite for Arena AI Coding Agent."""
import pytest
import os
import shutil
import tempfile
import pathlib
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
from app.observability import log_event, get_logs, get_system_metrics

client = TestClient(app)

def test_version_and_health():
    r = client.get("/api/version")
    assert r.status_code == 200
    assert r.json()["version"] == APP_VERSION

    hr = client.get("/health")
    assert hr.status_code == 200
    assert hr.json()["status"] == "ok"

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
    # Second user cannot acquire while locked
    assert acquire_file_lock(path, "user-2", ttl_seconds=60) is False
    # Same user can re-acquire/extend
    assert acquire_file_lock(path, "user-1", ttl_seconds=60) is True
    # Release lock
    assert release_file_lock(path, "user-1") is True
    # Now user-2 can acquire
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
    assert not p.exists() # Should not be written yet!

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

def test_dangerous_terminal_commands_protection():
    assert is_dangerous_command("rm -rf /") is True
    assert is_dangerous_command("DROP TABLE users") is True
    assert is_dangerous_command("git push --force") is True
    assert is_dangerous_command("ls -la") is False

    # Blocked dangerous execution
    res = execute_sandboxed_command("rm -rf /", confirmed_dangerous=False)
    assert res["requiresApproval"] is True
    assert res["exitCode"] == -1

    # Safe command
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
    r = client.get("/api/workspaces")
    assert r.status_code == 200
    assert "workspaces" in r.json()

    cr = client.get("/api/changesets")
    assert cr.status_code == 200
    assert "changesets" in cr.json()

    pr = client.get("/api/providers")
    assert pr.status_code == 200

    jr = client.get("/api/jobs")
    assert jr.status_code == 200

    lr = client.get("/api/observability/logs")
    assert lr.status_code == 200
