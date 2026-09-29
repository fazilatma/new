"""FastAPI Application Main Entrypoint with full feature routers, lifespan, and security."""
import asyncio
import os
import json
import time
import base64
import mimetypes
import csv
import io
from pathlib import Path
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Response, Depends
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import read_environment, write_environment, is_auth_enabled, get_raw_config, get_default_workspace, APP_VERSION, UPLOADS_DIR
from .database import get_db, init_db
from .models import Provider, ModelSpec
from .providers import PROVIDER_STORE
from .workspaces import (
    get_active_workspace, set_active_workspace, list_workspace_files,
    safe_path, create_workspace_from_template, get_workspace_metrics,
    create_workspace_item, delete_workspace_item, rename_workspace_item, export_workspace_zip_bytes,
    get_or_create_session_workspace, reset_session_workspace, get_workspace_root,
    resolve_reference_root, safe_reference_path, list_reference_files, read_reference_file, copy_reference_file,
    add_conversation_reference, remove_conversation_reference, get_conversation_references
)
from .projects import (
    get_active_project, set_active_project, list_projects,
    get_project, create_project, update_project, delete_project,
    ProjectCreateRequest, ProjectUpdateRequest
)
from .changesets import (
    create_changeset, get_changeset, list_changesets, approve_changeset,
    reject_changeset, rollback_changeset, approve_changeset_file, reject_changeset_file,
    list_file_versions, compare_file_versions, rollback_to_version, acquire_file_lock, release_file_lock,
    export_changeset_patch, reject_changeset_with_feedback
)
from .workflow import preview, backup
from .terminal_sandbox import execute_sandboxed_command, list_active_processes, kill_process
from .git_manager import (
    get_git_status, get_git_diff, list_branches, create_branch, switch_branch,
    rename_branch, delete_branch, git_fetch, git_pull, git_push, git_commit,
    list_commit_history, get_commit_details, git_cherry_pick, git_revert,
    git_merge, list_stashes, git_stash_save, git_stash_apply, list_remotes,
    get_merge_conflicts, resolve_conflict_file
)
from .github_workspace import (
    get_github_user, list_user_repos, list_repo_branches, get_repo_tree,
    get_repo_file, create_or_update_repo_file, delete_repo_file,
    list_pull_requests, get_pull_request, create_pull_request, merge_pull_request,
    create_pr_review, list_workflow_runs, rerun_workflow_run, list_issues,
    create_issue, add_issue_comment
)
from .browser_automation import BROWSER_MANAGER
from .chat import complete_chat, call_provider_api
from .worker import persistent_worker_loop, create_job, get_job_details, list_all_jobs, cancel_job, pause_job, resume_job, retry_job, delete_old_jobs
from .observability import log_event, get_logs, get_system_metrics
from .auth import auth_middleware, register_auth_routes, get_current_user, require_admin, require_developer, require_viewer

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    worker_task = asyncio.create_task(persistent_worker_loop())
    log_event("INFO", "SYSTEM", f"Arena Agent v{APP_VERSION} started successfully.")
    yield
    worker_task.cancel()

app = FastAPI(title="Arena-like Coding Agent", version=APP_VERSION, lifespan=lifespan)

# CORS Configuration
origins = [o.strip() for o in get_raw_config("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if "*" not in origins else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(auth_middleware)

# Register Authentication and User Management Routes
register_auth_routes(app)

# UI and Static Routes
STATIC_DIR = Path(__file__).parent / "static"

@app.get("/")
def root():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/chat")
def chat_ui():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/ui")
def ui():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/api/version")
def version():
    return {"name": "Arena Coding Agent", "version": APP_VERSION, "apiVersion": "v1", "status": "ok"}

@app.get("/health")
def health():
    return {"status": "ok", "version": APP_VERSION}

# Projects & Definitions API
@app.get("/api/projects")
def projects_list_endpoint(user: Dict[str, Any] = Depends(require_viewer)):
    return {"projects": list_projects(), "active": get_active_project()}

@app.get("/api/projects/{proj_id}")
def project_details_endpoint(proj_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    proj = get_project(proj_id)
    if not proj:
        raise HTTPException(404, "Project not found")
    return proj

@app.post("/api/projects")
def project_create_endpoint(payload: ProjectCreateRequest, user: Dict[str, Any] = Depends(require_developer)):
    return create_project(payload)

@app.put("/api/projects/{proj_id}")
def project_update_endpoint(proj_id: str, payload: ProjectUpdateRequest, user: Dict[str, Any] = Depends(require_developer)):
    return update_project(proj_id, payload)

@app.delete("/api/projects/{proj_id}")
def project_delete_endpoint(proj_id: str, user: Dict[str, Any] = Depends(require_admin)):
    active = get_active_project()
    if active.get("id") == proj_id:
        raise HTTPException(400, "Cannot delete the currently active project. Switch to another project first.")
    ok = delete_project(proj_id)
    return {"ok": ok}

@app.post("/api/projects/{proj_id}/activate")
def project_activate_endpoint(proj_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    return set_active_project(proj_id)

# Workspaces API
@app.get("/api/workspaces")
def workspaces_list(user: Dict[str, Any] = Depends(require_viewer)):
    with get_db() as conn:
        rows = conn.execute("SELECT id, name, path, instructions, agent_rules, is_default, created_at FROM workspaces ORDER BY is_default DESC, created_at DESC").fetchall()
        active = get_active_workspace()
        return {"workspaces": [dict(r) for r in rows], "active": active}

@app.get("/api/workspace/session/{session_id}")
@app.post("/api/workspace/session/{session_id}/activate")
def activate_session_workspace(session_id: str, payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_viewer)):
    title = str(payload.get("title", ""))
    ws = get_or_create_session_workspace(session_id, title)
    files = list_workspace_files(".")
    return {"workspace": ws, "files": files}

@app.post("/api/workspace/session/{session_id}/reset")
def reset_session_ws(session_id: str, user: Dict[str, Any] = Depends(require_developer)):
    ws = reset_session_workspace(session_id)
    return {"ok": True, "workspace": ws, "files": []}

@app.post("/api/workspaces")
def create_workspace(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    name = str(payload.get("name", "New Project"))
    template = str(payload.get("template", "empty"))
    instructions = str(payload.get("instructions", ""))
    agent_rules = str(payload.get("agentRules", ""))
    return create_workspace_from_template(name, template, instructions, agent_rules)

@app.post("/api/workspaces/switch")
def switch_workspace(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_viewer)):
    ws_id = str(payload.get("workspaceId"))
    return set_active_workspace(ws_id)

@app.get("/api/workspaces/metrics")
def workspace_metrics(user: Dict[str, Any] = Depends(require_viewer)):
    return get_workspace_metrics()

# Workspace Files API
@app.get("/api/workspace/files")
def workspace_files(path: str = ".", user: Dict[str, Any] = Depends(require_viewer)):
    try:
        return list_workspace_files(path)
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/file")
def workspace_read(path: str, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        p = safe_path(path)
        if not p.exists():
            raise HTTPException(404, "File not found")
        content = p.read_text(encoding="utf-8", errors="replace")
        return {"path": path, "content": content, "size": p.stat().st_size}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/raw")
def workspace_raw_file(path: str, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        p = safe_path(path)
        if not p.exists() or p.is_dir():
            raise HTTPException(404, "File not found")
        mime, _ = mimetypes.guess_type(str(p))
        if not mime:
            mime = "application/octet-stream"
        return FileResponse(p, media_type=mime)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/file-preview")
def workspace_file_preview(path: str, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        p = safe_path(path)
        if not p.exists():
            raise HTTPException(404, "File not found")
        if p.is_dir():
            return {
                "path": path,
                "filename": p.name,
                "isDir": True,
                "type": "dir",
                "items": list_workspace_files(path)
            }

        suffix = p.suffix.lower()
        mime, _ = mimetypes.guess_type(str(p))
        mime = mime or "application/octet-stream"

        preview_type = "code"
        content_text = None
        csv_data = None
        base64_data = None
        is_executable = suffix in (".py", ".sh", ".bash", ".js", ".ts", ".html", ".pyw")

        if suffix in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"):
            preview_type = "image"
            try:
                base64_data = base64.b64encode(p.read_bytes()).decode("utf-8")
            except Exception:
                pass
        elif suffix == ".pdf":
            preview_type = "pdf"
        elif suffix in (".mp3", ".wav", ".ogg", ".aac", ".flac"):
            preview_type = "audio"
        elif suffix in (".mp4", ".webm", ".ogv"):
            preview_type = "video"
        elif suffix in (".html", ".htm"):
            preview_type = "html"
            try:
                content_text = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                pass
        elif suffix in (".md", ".markdown"):
            preview_type = "markdown"
            try:
                content_text = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                pass
        elif suffix in (".csv", ".tsv"):
            preview_type = "csv"
            try:
                content_text = p.read_text(encoding="utf-8", errors="replace")
                delimiter = "\t" if suffix == ".tsv" else ","
                reader = csv.reader(io.StringIO(content_text), delimiter=delimiter)
                rows = list(reader)
                headers = rows[0] if rows else []
                data_rows = rows[1:101] if len(rows) > 1 else []
                csv_data = {"headers": headers, "rows": data_rows, "totalRows": len(rows)}
            except Exception:
                pass
        else:
            try:
                content_text = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                preview_type = "binary"

        return {
            "path": path,
            "filename": p.name,
            "size": p.stat().st_size,
            "type": preview_type,
            "mimeType": mime,
            "isExecutable": is_executable,
            "content": content_text,
            "base64": base64_data,
            "csvData": csv_data,
            "rawUrl": f"/api/workspace/raw?path={path}"
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/reference-files")
def workspace_reference_files(target_type: str, target_id: str, path: str = ".", user: Dict[str, Any] = Depends(require_viewer)):
    try:
        files = list_reference_files(target_type, target_id, path)
        return {"target_type": target_type, "target_id": target_id, "files": files}
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/reference-raw")
def workspace_reference_raw(target_type: str, target_id: str, path: str, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        p = safe_reference_path(target_type, target_id, path)
        if not p.exists() or p.is_dir():
            raise HTTPException(404, "File not found in reference workspace")
        mime, _ = mimetypes.guess_type(str(p))
        return FileResponse(p, media_type=mime or "application/octet-stream")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/reference-preview")
def workspace_reference_preview(target_type: str, target_id: str, path: str, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        p = safe_reference_path(target_type, target_id, path)
        if not p.exists():
            raise HTTPException(404, "File not found in reference workspace")
        if p.is_dir():
            return {
                "path": path,
                "filename": p.name,
                "isDir": True,
                "type": "dir",
                "items": list_reference_files(target_type, target_id, path)
            }

        suffix = p.suffix.lower()
        mime, _ = mimetypes.guess_type(str(p))
        mime = mime or "application/octet-stream"

        preview_type = "code"
        content_text = None
        csv_data = None
        base64_data = None
        is_executable = suffix in (".py", ".sh", ".bash", ".js", ".ts", ".html", ".pyw")

        if suffix in (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp", ".ico"):
            preview_type = "image"
            try:
                base64_data = base64.b64encode(p.read_bytes()).decode("utf-8")
            except Exception:
                pass
        elif suffix == ".pdf":
            preview_type = "pdf"
        elif suffix in (".mp3", ".wav", ".ogg", ".aac", ".flac"):
            preview_type = "audio"
        elif suffix in (".mp4", ".webm", ".ogv"):
            preview_type = "video"
        elif suffix in (".html", ".htm"):
            preview_type = "html"
            try:
                content_text = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                pass
        elif suffix in (".md", ".markdown"):
            preview_type = "markdown"
            try:
                content_text = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                pass
        elif suffix in (".csv", ".tsv"):
            preview_type = "csv"
            try:
                content_text = p.read_text(encoding="utf-8", errors="replace")
                delimiter = "\t" if suffix == ".tsv" else ","
                reader = csv.reader(io.StringIO(content_text), delimiter=delimiter)
                rows = list(reader)
                headers = rows[0] if rows else []
                data_rows = rows[1:101] if len(rows) > 1 else []
                csv_data = {"headers": headers, "rows": data_rows, "totalRows": len(rows)}
            except Exception:
                pass
        else:
            try:
                content_text = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                preview_type = "binary"

        raw_url = f"/api/workspace/reference-raw?target_type={target_type}&target_id={target_id}&path={path}"
        return {
            "path": path,
            "filename": p.name,
            "size": p.stat().st_size,
            "type": preview_type,
            "mimeType": mime,
            "isExecutable": is_executable,
            "content": content_text,
            "base64": base64_data,
            "csvData": csv_data,
            "rawUrl": raw_url,
            "targetType": target_type,
            "targetId": target_id,
            "isReferenced": True
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/workspace/import-reference-file")
def workspace_import_reference_file(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    target_type = str(payload.get("target_type", "chat"))
    target_id = str(payload.get("target_id", "")).strip()
    source_path = str(payload.get("source_path", "")).strip()
    dest_path = payload.get("dest_path")
    if not target_id or not source_path:
        raise HTTPException(400, "target_id and source_path are required")
    try:
        res = copy_reference_file(target_type, target_id, source_path, dest_path)
        return res
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/workspace/execute")
async def workspace_execute_file(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    path = str(payload.get("path", "")).strip()
    args = payload.get("args") or []
    if not path:
        raise HTTPException(400, "File path is required")
    try:
        p = safe_path(path)
        if not p.exists():
            raise HTTPException(404, "File not found")

        suffix = p.suffix.lower()
        cmd = ""
        arg_str = " ".join(f"'{a}'" for a in args) if args else ""
        ws_root = get_workspace_root()

        try:
            rel_cwd = str(p.parent.relative_to(ws_root))
            if not rel_cwd:
                rel_cwd = "."
        except Exception:
            rel_cwd = "."
        rel_file_path = str(p.relative_to(ws_root))

        if suffix in (".py", ".pyw"):
            cmd = f"python3 '{p.name}' {arg_str}".strip()
        elif suffix in (".sh", ".bash"):
            cmd = f"bash '{p.name}' {arg_str}".strip()
        elif suffix in (".js", ".mjs"):
            cmd = f"node '{p.name}' {arg_str}".strip()
        elif suffix == ".ts":
            cmd = f"npx --yes tsx '{p.name}' {arg_str}".strip()
        elif suffix in (".html", ".htm"):
            return {
                "ok": True,
                "type": "html",
                "previewUrl": f"/api/workspace/raw?path={path}",
                "message": "HTML file ready for live preview."
            }
        else:
            cmd = f"cat '{p.name}' {arg_str}".strip()

        res = execute_sandboxed_command(cmd, cwd=rel_cwd, confirmed_dangerous=True)
        return {
            "ok": True,
            "command": cmd,
            "path": path,
            "exitCode": res.get("exitCode", 0),
            "stdout": res.get("stdout", ""),
            "stderr": res.get("stderr", ""),
            "durationMs": res.get("durationMs", 0)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/workspace/preview")
def workspace_preview(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_viewer)):
    try:
        return preview(str(payload["path"]), str(payload.get("content", "")))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.put("/api/workspace/file")
def workspace_write(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    path = str(payload["path"])
    content = str(payload.get("content", ""))
    require_appr = payload.get("requireApproval", False)

    if require_appr:
        cs = create_changeset(title=f"Manual edit: {path}", files=[{"path": path, "new_content": content}], created_by=user.get("username", "user"))
        return {"requiresApproval": True, "changeset": cs}

    # Direct Save with snapshot backup
    try:
        backup(path)
        target = safe_path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"ok": True, "path": path, "size": len(content.encode("utf-8"))}
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/workspace/create")
def workspace_create(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    path = str(payload.get("path", "")).strip()
    is_dir = bool(payload.get("isDir", False))
    content = str(payload.get("content", ""))
    if not path:
        raise HTTPException(400, "Path is required")
    try:
        return create_workspace_item(path, is_dir=is_dir, content=content)
    except Exception as e:
        raise HTTPException(400, str(e))

@app.delete("/api/workspace/file")
def workspace_delete(path: str, user: Dict[str, Any] = Depends(require_developer)):
    if not path:
        raise HTTPException(400, "Path is required")
    try:
        return delete_workspace_item(path)
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/workspace/rename")
def workspace_rename(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    old_p = str(payload.get("oldPath", "")).strip()
    new_p = str(payload.get("newPath", "")).strip()
    if not old_p or not new_p:
        raise HTTPException(400, "Both oldPath and newPath are required")
    try:
        return rename_workspace_item(old_p, new_p)
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/export-zip")
def workspace_export_zip(user: Dict[str, Any] = Depends(require_viewer)):
    try:
        zip_bytes = export_workspace_zip_bytes()
        return Response(
            content=zip_bytes,
            media_type="application/zip",
            headers={"Content-Disposition": "attachment; filename=workspace.zip"}
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to export zip: {str(e)}")

# Change Sets & Approvals API (Phase 4)
@app.get("/api/changesets")
def get_changesets(limit: int = 50, user: Dict[str, Any] = Depends(require_viewer)):
    return {"changesets": list_changesets(limit=limit)}

@app.get("/api/changesets/{cs_id}")
def get_changeset_by_id(cs_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    cs = get_changeset(cs_id)
    if not cs:
        raise HTTPException(404, "ChangeSet not found")
    return cs

@app.get("/api/changesets/{cs_id}/patch")
def get_changeset_patch(cs_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        patch_text = export_changeset_patch(cs_id)
        return Response(
            content=patch_text,
            media_type="text/plain",
            headers={"Content-Disposition": f"attachment; filename=changeset-{cs_id}.patch"}
        )
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/changesets/{cs_id}/reject-with-feedback")
def reject_cs_with_feedback(cs_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    feedback = str(payload.get("feedback", ""))
    try:
        return reject_changeset_with_feedback(cs_id, feedback=feedback, rejected_by=user.get("username", "user"))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/changesets/{cs_id}/approve")
def approve_cs(cs_id: str, user: Dict[str, Any] = Depends(require_developer)):
    try:
        return approve_changeset(cs_id, approved_by=user.get("username", "user"))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/changesets/{cs_id}/reject")
def reject_cs(cs_id: str, user: Dict[str, Any] = Depends(require_developer)):
    try:
        return reject_changeset(cs_id, rejected_by=user.get("username", "user"))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/changesets/{cs_id}/files/{file_id}/approve")
def approve_file(cs_id: str, file_id: str, user: Dict[str, Any] = Depends(require_developer)):
    try:
        return approve_changeset_file(cs_id, file_id, approved_by=user.get("username", "user"))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/changesets/{cs_id}/files/{file_id}/reject")
def reject_file(cs_id: str, file_id: str, user: Dict[str, Any] = Depends(require_developer)):
    try:
        return reject_changeset_file(cs_id, file_id, rejected_by=user.get("username", "user"))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/changesets/{cs_id}/rollback")
def rollback_cs(cs_id: str, user: Dict[str, Any] = Depends(require_developer)):
    try:
        return rollback_changeset(cs_id, rolled_back_by=user.get("username", "user"))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/versions")
def get_versions(path: str, user: Dict[str, Any] = Depends(require_viewer)):
    return {"versions": list_file_versions(path)}

@app.post("/api/workspace/versions/compare")
def compare_versions(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_viewer)):
    path = str(payload["path"])
    v1 = str(payload["v1"])
    v2 = str(payload["v2"])
    return compare_file_versions(path, v1, v2)

@app.post("/api/workspace/versions/rollback")
def rollback_version(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    path = str(payload["path"])
    version_id = str(payload["versionId"])
    return rollback_to_version(path, version_id, user_id=user.get("username", "user"))

# Terminal Sandboxed Execution API (Phase 5)
@app.post("/api/terminal/exec")
def terminal_exec(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    command = str(payload["command"])
    cwd = str(payload.get("cwd", "."))
    timeout = int(payload.get("timeout", 60))
    confirmed = bool(payload.get("confirmed", False))
    return execute_sandboxed_command(command, cwd=cwd, timeout=timeout, confirmed_dangerous=confirmed, user_id=user.get("username", "user"))

@app.get("/api/terminal/processes")
def terminal_processes(user: Dict[str, Any] = Depends(require_developer)):
    return {"processes": list_active_processes()}

@app.post("/api/terminal/processes/{pid}/kill")
def terminal_kill(pid: int, user: Dict[str, Any] = Depends(require_developer)):
    ok = kill_process(pid)
    return {"ok": ok}

# Git API (Phase 6)
@app.get("/api/git/status")
def git_status_endpoint(user: Dict[str, Any] = Depends(require_viewer)):
    return get_git_status()

@app.get("/api/git/diff")
def git_diff_endpoint(staged_only: bool = False, file_path: Optional[str] = None, user: Dict[str, Any] = Depends(require_viewer)):
    return get_git_diff(staged_only=staged_only, file_path=file_path)

@app.get("/api/git/branches")
def git_branches_endpoint(user: Dict[str, Any] = Depends(require_viewer)):
    return list_branches()

@app.post("/api/git/branch/create")
def git_branch_create(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return create_branch(str(payload["name"]), checkout=bool(payload.get("checkout", True)))

@app.post("/api/git/branch/switch")
def git_branch_switch(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return switch_branch(str(payload["name"]))

@app.post("/api/git/branch/rename")
def git_branch_rename(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return rename_branch(str(payload["oldName"]), str(payload["newName"]))

@app.post("/api/git/branch/delete")
def git_branch_delete(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return delete_branch(str(payload["name"]), force=bool(payload.get("force", False)))

@app.post("/api/git/commit")
def git_commit_endpoint(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    message = str(payload.get("message", "")).strip()
    if not message:
        raise HTTPException(400, "Commit message is required.")
    if not payload.get("approved"):
        raise HTTPException(428, "Explicit approval is required for commit operations.")
    return git_commit(message, approved=True)

@app.get("/api/git/log")
def git_log_endpoint(limit: int = 50, user: Dict[str, Any] = Depends(require_viewer)):
    return {"commits": list_commit_history(limit=limit)}

@app.get("/api/git/commit/{commit_hash}")
def git_commit_details_endpoint(commit_hash: str, user: Dict[str, Any] = Depends(require_viewer)):
    return get_commit_details(commit_hash)

@app.post("/api/git/pull")
def git_pull_endpoint(payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_developer)):
    return git_pull(remote=str(payload.get("remote", "origin")), branch=str(payload.get("branch", "")))

@app.post("/api/git/push")
def git_push_endpoint(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    if not payload.get("approved"):
        raise HTTPException(428, "Explicit approval is required for push operations.")
    return git_push(remote=str(payload.get("remote", "origin")), branch=str(payload.get("branch", "")), force=bool(payload.get("force", False)), approved=True)

@app.post("/api/git/fetch")
def git_fetch_endpoint(payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_developer)):
    return git_fetch(remote=str(payload.get("remote", "origin")))

@app.get("/api/git/stash")
def git_stash_list_endpoint(user: Dict[str, Any] = Depends(require_viewer)):
    return {"stashes": list_stashes()}

@app.post("/api/git/stash")
def git_stash_save_endpoint(payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_developer)):
    return git_stash_save(message=str(payload.get("message", "")))

@app.post("/api/git/stash/apply")
def git_stash_apply_endpoint(payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_developer)):
    return git_stash_apply(stash_id=str(payload.get("stashId", "stash@{0}")))

@app.get("/api/git/remotes")
def git_remotes_endpoint(user: Dict[str, Any] = Depends(require_viewer)):
    return {"remotes": list_remotes()}

@app.get("/api/git/conflicts")
def git_conflicts_endpoint(user: Dict[str, Any] = Depends(require_viewer)):
    return {"conflicts": get_merge_conflicts()}

@app.post("/api/git/resolve-conflict")
def git_resolve_conflict_endpoint(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return resolve_conflict_file(str(payload["path"]), str(payload["mode"]), payload.get("customContent"))

# GitHub API (Phase 7)
@app.get("/api/github/user")
async def github_user(user: Dict[str, Any] = Depends(require_viewer)):
    return await get_github_user()

@app.get("/api/github/repos")
async def github_repos(user: Dict[str, Any] = Depends(require_viewer)):
    return await list_user_repos()

@app.get("/api/github/repo/{owner}/{repo}/branches")
async def github_branches(owner: str, repo: str, user: Dict[str, Any] = Depends(require_viewer)):
    return await list_repo_branches(owner, repo)

@app.get("/api/github/repo/{owner}/{repo}/tree")
async def github_tree(owner: str, repo: str, branch: str = "main", user: Dict[str, Any] = Depends(require_viewer)):
    return await get_repo_tree(owner, repo, branch)

@app.get("/api/github/repo/{owner}/{repo}/contents/{path:path}")
async def github_file_content(owner: str, repo: str, path: str, ref: Optional[str] = None, user: Dict[str, Any] = Depends(require_viewer)):
    return await get_repo_file(owner, repo, path, ref=ref)

@app.put("/api/github/repo/{owner}/{repo}/contents/{path:path}")
async def github_update_file(owner: str, repo: str, path: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return await create_or_update_repo_file(owner, repo, path, str(payload["content"]), str(payload["message"]), branch=str(payload.get("branch", "main")), sha=payload.get("sha"))

@app.get("/api/github/repo/{owner}/{repo}/pulls")
async def github_pulls(owner: str, repo: str, state: str = "open", user: Dict[str, Any] = Depends(require_viewer)):
    return await list_pull_requests(owner, repo, state=state)

@app.post("/api/github/pull-request")
async def github_create_pr(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return await create_pull_request(str(payload["owner"]), str(payload["repo"]), str(payload["title"]), str(payload["head"]), str(payload["base"]), str(payload.get("body", "")))

@app.post("/api/github/repo/{owner}/{repo}/pulls/{pull_number}/merge")
async def github_merge_pr(owner: str, repo: str, pull_number: int, payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_developer)):
    return await merge_pull_request(owner, repo, pull_number, merge_method=str(payload.get("mergeMethod", "merge")), commit_title=str(payload.get("commitTitle", "")))

@app.post("/api/github/repo/{owner}/{repo}/pulls/{pull_number}/review")
async def github_review_pr(owner: str, repo: str, pull_number: int, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return await create_pr_review(owner, repo, pull_number, event=str(payload["event"]), body=str(payload.get("body", "")))

@app.get("/api/github/repo/{owner}/{repo}/actions/runs")
async def github_actions_runs(owner: str, repo: str, user: Dict[str, Any] = Depends(require_viewer)):
    return await list_workflow_runs(owner, repo)

@app.post("/api/github/repo/{owner}/{repo}/actions/runs/{run_id}/rerun")
async def github_actions_rerun(owner: str, repo: str, run_id: int, user: Dict[str, Any] = Depends(require_developer)):
    return await rerun_workflow_run(owner, repo, run_id)

@app.get("/api/github/repo/{owner}/{repo}/issues")
async def github_issues_list(owner: str, repo: str, state: str = "open", user: Dict[str, Any] = Depends(require_viewer)):
    return await list_issues(owner, repo, state=state)

@app.post("/api/github/repo/{owner}/{repo}/issues")
async def github_issue_create(owner: str, repo: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return await create_issue(owner, repo, str(payload["title"]), str(payload.get("body", "")), labels=payload.get("labels"))

# Playwright Browser API (Phase 8)
@app.post("/api/browser/session")
async def browser_create_session(payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_developer)):
    return await BROWSER_MANAGER.create_session(str(payload.get("sessionId", "default")))

@app.post("/api/browser/navigate")
async def browser_navigate_endpoint(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return await BROWSER_MANAGER.navigate(str(payload["url"]), str(payload.get("sessionId", "default")))

@app.post("/api/browser/screenshot")
async def browser_screenshot_endpoint(payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_developer)):
    return await BROWSER_MANAGER.screenshot(str(payload.get("sessionId", "default")), full_page=bool(payload.get("fullPage", False)))

@app.post("/api/browser/click")
async def browser_click_endpoint(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return await BROWSER_MANAGER.click(str(payload["selector"]), str(payload.get("sessionId", "default")))

@app.post("/api/browser/fill")
async def browser_fill_endpoint(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return await BROWSER_MANAGER.fill(str(payload["selector"]), str(payload["text"]), str(payload.get("sessionId", "default")))

@app.get("/api/browser/logs")
async def browser_logs_endpoint(sessionId: str = "default", user: Dict[str, Any] = Depends(require_developer)):
    return await BROWSER_MANAGER.get_logs(sessionId)

@app.post("/api/browser/eval")
async def browser_eval_endpoint(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    expr = str(payload.get("expression", ""))
    session_id = str(payload.get("sessionId", "default"))
    try:
        return await BROWSER_MANAGER.evaluate_js(expr, session_id=session_id)
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/browser/fetch")
async def browser_fetch_compat(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    return await BROWSER_MANAGER.navigate(str(payload["url"]))

# Chat & Streaming API (Phases 9 & 10)
@app.post("/api/chat")
async def chat_endpoint(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    messages = payload.get("messages") or [{"role": "user", "content": str(payload.get("message", ""))}]
    provider_id = str(payload.get("provider", "openrouter"))
    model_id = str(payload.get("model", ""))
    max_steps = int(payload.get("maxSteps", 8))
    conversation_id = payload.get("conversationId") or payload.get("conversation_id")
    references = payload.get("references")
    try:
        return await complete_chat(
            PROVIDER_STORE, provider_id, model_id, messages,
            max_steps=max_steps, user_id=user.get("username", "user"),
            conversation_id=conversation_id, references=references
        )
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/chat/stream")
async def chat_stream_endpoint(payload: Dict[str, Any], request: Request, user: Dict[str, Any] = Depends(require_developer)):
    messages = payload.get("messages") or [{"role": "user", "content": str(payload.get("message", ""))}]
    provider_id = str(payload.get("provider", "openrouter"))
    model_id = str(payload.get("model", ""))
    max_steps = int(payload.get("maxSteps", 8))
    conversation_id = payload.get("conversationId") or payload.get("conversation_id")
    references = payload.get("references")

    async def event_generator():
        yield 'event: status\ndata: ' + json.dumps({"status": "started", "provider": provider_id, "model": model_id}) + '\n\n'
        try:
            res = await complete_chat(
                PROVIDER_STORE, provider_id, model_id, messages,
                max_steps=max_steps, user_id=user.get("username", "user"),
                conversation_id=conversation_id, references=references
            )
            msg = res.get("message", {})
            content = msg.get("content", "")
            err_details = res.get("errorDetails")

            # Stream text in chunks
            chunk_size = 25
            for i in range(0, len(content), chunk_size):
                chunk = content[i:i + chunk_size]
                yield 'event: token\ndata: ' + json.dumps({"text": chunk}, ensure_ascii=False) + '\n\n'
                await asyncio.sleep(0.01)

            # Send pending approvals if any
            approvals = res.get("pendingApprovals", [])
            if approvals:
                yield 'event: approvals\ndata: ' + json.dumps({"approvals": approvals}, ensure_ascii=False) + '\n\n'

            # Send error details if any
            if err_details:
                yield 'event: error_details\ndata: ' + json.dumps({"errorDetails": err_details}, ensure_ascii=False) + '\n\n'

            yield 'event: done\ndata: ' + json.dumps({
                "steps": res.get("steps", 1),
                "provider": res.get("provider"),
                "model": res.get("model"),
                "hasError": bool(err_details)
            }, ensure_ascii=False) + '\n\n'
        except Exception as e:
            err_meta = {
                "provider": provider_id,
                "model": model_id,
                "error": str(e),
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
                "remediation": "Check provider settings, API key, and network connectivity."
            }
            yield 'event: error\ndata: ' + json.dumps({"error": str(e), "errorDetails": err_meta}, ensure_ascii=False) + '\n\n'

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.post("/api/chat/upload")
async def chat_upload_file(file: UploadFile = File(...), user: Dict[str, Any] = Depends(require_developer)):
    filename = file.filename or f"upload_{int(time.time()*1000)}"
    safe_fn = "".join(c for c in filename if c.isalnum() or c in (".", "-", "_")).strip()
    dest_path = UPLOADS_DIR / f"{int(time.time()*1000)}_{safe_fn}"
    content = await file.read()
    dest_path.write_bytes(content)

    content_type = file.content_type or "application/octet-stream"
    is_image = content_type.startswith("image/")
    b64_data = None
    text_snippet = None

    if is_image:
        b64_data = base64.b64encode(content).decode("utf-8")
    else:
        try:
            text_snippet = content.decode("utf-8", errors="replace")[:4000]
        except Exception:
            text_snippet = f"[Binary file: {filename}, size: {len(content)} bytes]"

    return {
        "ok": True,
        "filename": filename,
        "savedPath": str(dest_path),
        "contentType": content_type,
        "isImage": is_image,
        "sizeBytes": len(content),
        "imageBase64": b64_data,
        "textSnippet": text_snippet
    }

# Conversations API (Phase 10)
@app.get("/api/conversations")
def get_conversations(user: Dict[str, Any] = Depends(require_viewer)):
    with get_db() as conn:
        rows = conn.execute("SELECT id, title, provider_id, model_id, created_at, updated_at FROM conversations ORDER BY updated_at DESC").fetchall()
        return {"conversations": [dict(r) for r in rows]}

@app.post("/api/conversations")
def create_conversation(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    conv_id = f"conv-{int(time.time())}"
    title = str(payload.get("title", "New Conversation"))
    provider = str(payload.get("provider", ""))
    model = str(payload.get("model", ""))
    with get_db() as conn:
        conn.execute("INSERT INTO conversations (id, title, provider_id, model_id) VALUES (?, ?, ?, ?)", (conv_id, title, provider, model))
    return {"id": conv_id, "title": title}

@app.get("/api/conversations/{conv_id}/messages")
def get_conversation_messages(conv_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    with get_db() as conn:
        rows = conn.execute("SELECT id, conversation_id, role, content, tool_calls, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC", (conv_id,)).fetchall()
        return {"messages": [dict(r) for r in rows]}

@app.post("/api/conversations/{conv_id}/messages")
def add_conversation_message(conv_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    msg_id = f"msg-{int(time.time()*1000)}"
    role = str(payload.get("role", "user"))
    content = str(payload.get("content", ""))
    tool_calls = json.dumps(payload.get("tool_calls")) if payload.get("tool_calls") else None
    with get_db() as conn:
        conn.execute("INSERT INTO messages (id, conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?, ?)", (msg_id, conv_id, role, content, tool_calls))
        conn.execute("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", (conv_id,))
    return {"id": msg_id, "role": role, "content": content}

@app.put("/api/conversations/{conv_id}")
def update_conversation(conv_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    title = payload.get("title")
    with get_db() as conn:
        if title:
            conn.execute("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?", (str(title), conv_id))
    return {"ok": True, "id": conv_id}

@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str, user: Dict[str, Any] = Depends(require_developer)):
    with get_db() as conn:
        conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
    return {"ok": True}

# Conversation References API
@app.get("/api/conversations/{conv_id}/references")
def get_conversation_references_endpoint(conv_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        refs = get_conversation_references(conv_id)
        with get_db() as conn:
            all_convs = conn.execute("SELECT id, title, created_at FROM conversations WHERE id != ? ORDER BY updated_at DESC", (conv_id,)).fetchall()
            all_projs = conn.execute("SELECT id, name, description FROM projects ORDER BY name ASC").fetchall()
        return {
            "references": refs,
            "available_chats": [dict(c) for c in all_convs],
            "available_projects": [dict(p) for p in all_projs]
        }
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/conversations/{conv_id}/references")
def add_conversation_reference_endpoint(conv_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    target_type = str(payload.get("target_type", "chat")).strip()
    target_id = str(payload.get("target_id", "")).strip()
    title = str(payload.get("title", "")).strip()
    if not target_id:
        raise HTTPException(400, "target_id is required")
    try:
        ref = add_conversation_reference(conv_id, target_type, target_id, title)
        return ref
    except Exception as e:
        raise HTTPException(400, str(e))

@app.delete("/api/conversations/{conv_id}/references/{target_type}/{target_id}")
def remove_conversation_reference_endpoint(conv_id: str, target_type: str, target_id: str, user: Dict[str, Any] = Depends(require_developer)):
    try:
        return remove_conversation_reference(conv_id, target_type, target_id)
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/references/search")
def search_references(q: Optional[str] = "", user: Dict[str, Any] = Depends(require_viewer)):
    term = f"%{(q or '').strip()}%"
    with get_db() as conn:
        convs = conn.execute("SELECT id, title FROM conversations WHERE title LIKE ? OR id LIKE ? LIMIT 10", (term, term)).fetchall()
        projs = conn.execute("SELECT id, name, description FROM projects WHERE name LIKE ? OR id LIKE ? LIMIT 10", (term, term)).fetchall()
    return {
        "chats": [{"id": c["id"], "title": c["title"], "type": "chat"} for c in convs],
        "projects": [{"id": p["id"], "name": p["name"], "type": "project"} for p in projs]
    }

# Jobs & Worker API (Phase 2)
@app.get("/api/jobs")
def jobs_list_endpoint(status: Optional[str] = None, provider: Optional[str] = None, model: Optional[str] = None, limit: int = 50, user: Dict[str, Any] = Depends(require_viewer)):
    return {"jobs": list_all_jobs(status=status, provider=provider, model=model, limit=limit)}

@app.get("/api/jobs/{job_id}")
def job_details_endpoint(job_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    job = get_job_details(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job

@app.post("/api/jobs/chat")
def create_chat_job(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    title = payload.get("title") or payload.get("message", "Chat Task")[:60]
    return create_job(
        title=title,
        provider_id=str(payload.get("provider", "openrouter")),
        model_id=str(payload.get("model", "")),
        payload=payload,
        user_id=user.get("username", "user"),
        max_steps=int(payload.get("maxSteps", 8)),
        max_timeout_sec=int(payload.get("timeoutSec", 600))
    )

@app.post("/api/jobs/{job_id}/cancel")
def job_cancel(job_id: str, user: Dict[str, Any] = Depends(require_developer)):
    return {"ok": cancel_job(job_id)}

@app.post("/api/jobs/{job_id}/pause")
def job_pause(job_id: str, user: Dict[str, Any] = Depends(require_developer)):
    return {"ok": pause_job(job_id)}

@app.post("/api/jobs/{job_id}/resume")
def job_resume(job_id: str, user: Dict[str, Any] = Depends(require_developer)):
    return {"ok": resume_job(job_id)}

@app.post("/api/jobs/{job_id}/retry")
def job_retry(job_id: str, user: Dict[str, Any] = Depends(require_developer)):
    return {"ok": retry_job(job_id)}

@app.delete("/api/jobs/cleanup")
def job_cleanup(days: int = 7, user: Dict[str, Any] = Depends(require_admin)):
    deleted = delete_old_jobs(days)
    return {"ok": True, "deletedCount": deleted}

# Providers & Models API (Phase 11)
@app.get("/api/providers")
def get_providers(user: Dict[str, Any] = Depends(require_viewer)):
    return PROVIDER_STORE.all()

@app.put("/api/providers/{pid}")
def put_provider(pid: str, p: Provider, user: Dict[str, Any] = Depends(require_admin)):
    if p.id != pid:
        raise HTTPException(400, "Provider ID mismatch")
    return PROVIDER_STORE.upsert(p)

@app.delete("/api/providers/{pid}")
def del_provider(pid: str, user: Dict[str, Any] = Depends(require_admin)):
    PROVIDER_STORE.delete(pid)
    return {"ok": True}

@app.post("/api/providers/{pid}/models")
def add_model(pid: str, m: ModelSpec, user: Dict[str, Any] = Depends(require_admin)):
    if pid not in PROVIDER_STORE.data:
        raise HTTPException(404, "Provider not found")
    PROVIDER_STORE.add_model(pid, m)
    return m

@app.put("/api/providers/{pid}/models/{mid}")
def update_model(pid: str, mid: str, m: ModelSpec, user: Dict[str, Any] = Depends(require_admin)):
    if pid not in PROVIDER_STORE.data:
        raise HTTPException(404, "Provider not found")
    PROVIDER_STORE.update_model(pid, mid, m)
    return m

@app.delete("/api/providers/{pid}/models/{mid}")
def delete_model(pid: str, mid: str, user: Dict[str, Any] = Depends(require_admin)):
    if pid not in PROVIDER_STORE.data:
        raise HTTPException(404, "Provider not found")
    PROVIDER_STORE.delete_model(pid, mid)
    return {"ok": True}

@app.post("/api/providers/test-all")
async def test_all_models(payload: Dict[str, Any] = {}, user: Dict[str, Any] = Depends(require_developer)):
    selected_pid = payload.get("provider")
    tasks = []
    sem = asyncio.Semaphore(10)

    async def _test_one(p: Provider, m: ModelSpec, api_key: str) -> Dict[str, Any]:
        async with sem:
            if not api_key and p.protocol != "ollama":
                return {
                    "provider": p.id,
                    "providerName": p.name,
                    "model": m.id,
                    "modelName": m.name,
                    "ok": False,
                    "latencyMs": 0,
                    "protocol": p.protocol,
                    "error": f"API key not configured for provider '{p.name}'",
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
                }

            started = time.perf_counter()
            try:
                out = await call_provider_api(
                    p, m, [{"role": "user", "content": "Reply with 'OK' only."}], api_key,
                    custom_timeout_sec=6.0, custom_connect_sec=3.0
                )
                latency = round((time.perf_counter() - started) * 1000)
                msg_text = out.get("choices", [{}])[0].get("message", {}).get("content", "")[:100]
                return {
                    "provider": p.id,
                    "providerName": p.name,
                    "model": m.id,
                    "modelName": m.name,
                    "ok": True,
                    "latencyMs": latency,
                    "protocol": p.protocol,
                    "message": msg_text or "OK",
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
                }
            except Exception as e:
                latency = round((time.perf_counter() - started) * 1000)
                err_str = str(e)
                if "ConnectError" in err_str or "Connection refused" in err_str:
                    err_str = f"Connection refused to {p.url}"
                elif "Timeout" in err_str:
                    err_str = f"Connection timeout after 6s to {p.url}"
                return {
                    "provider": p.id,
                    "providerName": p.name,
                    "model": m.id,
                    "modelName": m.name,
                    "ok": False,
                    "latencyMs": latency,
                    "protocol": p.protocol,
                    "error": err_str,
                    "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
                }

    for pid, p in PROVIDER_STORE.data.items():
        if selected_pid and pid != selected_pid:
            continue
        api_key = PROVIDER_STORE.get_api_key(p)
        for m in p.models:
            tasks.append(_test_one(p, m, api_key))

    if tasks:
        results = await asyncio.gather(*tasks)
    else:
        results = []

    return {"results": list(results)}

@app.post("/api/providers/{pid}/models/{mid:path}/test")
async def test_single_model(pid: str, mid: str, user: Dict[str, Any] = Depends(require_developer)):
    p = PROVIDER_STORE.data.get(pid)
    if not p:
        raise HTTPException(404, f"Provider '{pid}' not found")
    model = next((m for m in p.models if m.id == mid), None)
    if not model:
        model = ModelSpec(id=mid, name=mid, toolCalling=True)

    api_key = PROVIDER_STORE.get_api_key(p)
    if not api_key and p.protocol != "ollama":
        return {
            "provider": pid,
            "providerName": p.name,
            "model": mid,
            "modelName": model.name,
            "ok": False,
            "latencyMs": 0,
            "protocol": p.protocol,
            "error": f"API key not configured for provider '{p.name}'",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
        }

    started = time.perf_counter()
    try:
        out = await call_provider_api(
            p, model, [{"role": "user", "content": "Reply with 'OK' only."}], api_key,
            custom_timeout_sec=8.0, custom_connect_sec=4.0
        )
        latency = round((time.perf_counter() - started) * 1000)
        msg_text = out.get("choices", [{}])[0].get("message", {}).get("content", "")[:100]
        return {
            "provider": pid,
            "providerName": p.name,
            "model": mid,
            "modelName": model.name,
            "ok": True,
            "latencyMs": latency,
            "protocol": p.protocol,
            "message": msg_text or "OK",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
        }
    except Exception as e:
        latency = round((time.perf_counter() - started) * 1000)
        err_str = str(e)
        if "ConnectError" in err_str or "Connection refused" in err_str:
            err_str = f"Connection refused to {p.url}"
        elif "Timeout" in err_str:
            err_str = f"Connection timeout after 8s to {p.url}"
        return {
            "provider": pid,
            "providerName": p.name,
            "model": mid,
            "modelName": model.name,
            "ok": False,
            "latencyMs": latency,
            "protocol": p.protocol,
            "error": err_str,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
        }

@app.post("/api/providers/{pid}/reset-circuit")
def reset_provider_circuit(pid: str, user: Dict[str, Any] = Depends(require_developer)):
    from .providers import CIRCUIT_BREAKER
    CIRCUIT_BREAKER.record_success(pid)
    return {"ok": True, "message": f"Circuit breaker for provider {pid} reset."}

@app.get("/api/providers/export")
def export_providers(user: Dict[str, Any] = Depends(require_admin)):
    content = PROVIDER_STORE.export_json()
    return Response(content=content, media_type="application/json", headers={"Content-Disposition": "attachment; filename=providers.json"})

@app.post("/api/providers/import-text")
def import_providers_text(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    raw = payload.get("json", "")
    replace = bool(payload.get("replace", False))
    try:
        PROVIDER_STORE.import_json(raw, replace=replace)
        return {"ok": True, "count": len(PROVIDER_STORE.data)}
    except Exception as e:
        raise HTTPException(400, f"Import failed: {str(e)}")

@app.post("/api/providers/import")
async def import_providers(file: UploadFile = File(...), replace: bool = False, user: Dict[str, Any] = Depends(require_admin)):
    try:
        content = (await file.read()).decode("utf-8")
        PROVIDER_STORE.import_json(content, replace=replace)
        return {"ok": True, "count": len(PROVIDER_STORE.data)}
    except Exception as e:
        raise HTTPException(400, f"Import failed: {str(e)}")

# Environment & Security Config API (Phase 12)
@app.get("/api/config/environment")
def get_env_config(user: Dict[str, Any] = Depends(require_admin)):
    return read_environment()

@app.put("/api/config/environment")
def put_env_config(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    return write_environment(payload)

# Observability API (Phase 13)
@app.get("/api/observability/logs")
def observability_logs(level: Optional[str] = None, search: Optional[str] = None, limit: int = 100, user: Dict[str, Any] = Depends(require_viewer)):
    return {"logs": get_logs(level=level, search=search, limit=limit)}

@app.get("/api/observability/metrics")
def observability_metrics(user: Dict[str, Any] = Depends(require_viewer)):
    return get_system_metrics()

@app.get("/api/observability/export")
def observability_export(format: str = "json", user: Dict[str, Any] = Depends(require_viewer)):
    logs = get_logs(limit=1000)
    if format == "csv":
        import csv
        import io
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["ID", "Timestamp", "Level", "Module", "Message", "Details"])
        for l in logs:
            writer.writerow([l.get("id"), l.get("timestamp"), l.get("level"), l.get("module"), l.get("message"), l.get("details")])
        return Response(content=output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=audit-logs.csv"})
    else:
        return Response(content=json.dumps(logs, indent=2), media_type="application/json", headers={"Content-Disposition": "attachment; filename=audit-logs.json"})

