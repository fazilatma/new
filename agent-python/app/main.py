"""FastAPI Application Main Entrypoint with full feature routers, lifespan, and security."""
import asyncio
import os
import re
import json
import time
import uuid
import base64
import mimetypes
import csv
import io
import threading
import urllib.parse
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Response, Depends
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import read_environment, write_environment, is_auth_enabled, get_raw_config, get_default_workspace, APP_VERSION, UPLOADS_DIR, DEFAULT_PROXY_URL, parse_proxy_setting, get_proxy_config, mask_secret
from .database import (
    get_db, init_db, get_latest_conversation_checkpoint,
    get_conversation_checkpoints, clear_conversation_checkpoints, get_job_events_since
)
from .models import Provider, ModelSpec
from .providers import PROVIDER_STORE, resolve_provider_endpoint_url
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
from .chat import complete_chat, stream_complete_chat, call_provider_api
from .worker import (
    persistent_worker_loop, create_job, get_job_details, list_all_jobs, cancel_job, pause_job, resume_job,
    retry_job, delete_old_jobs, execute_job_task, subscribe_to_job, unsubscribe_from_job, CHAT_JOB_TYPE
)
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
if "*" in origins or not origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://.*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.middleware("http")(auth_middleware)

# Register Authentication and User Management Routes
register_auth_routes(app)

# UI and Static Routes
STATIC_DIR = Path(__file__).parent / "static"

def _serve_spa(request: Request, filename: str = "index.html") -> Response:
    file_path = STATIC_DIR / filename
    html = ""
    if file_path.exists():
        html = file_path.read_text(encoding="utf-8")
    else:
        # Fallback to embedded constants if running in single-file standalone mode
        embedded_map = {
            "index.html": globals().get("EMBEDDED_INDEX_HTML", ""),
            "diag.html": globals().get("EMBEDDED_DIAG_HTML", ""),
        }
        html = embedded_map.get(filename, "")

    if not html:
        return HTMLResponse(f"<h1>Arena Coding Agent</h1><p>{filename} is missing.</p>", status_code=500)
    
    root_path = request.scope.get("root_path", "").rstrip("/")
    if not root_path:
        root_path = request.headers.get("x-forwarded-prefix") or request.headers.get("x-script-name") or ""
        root_path = root_path.rstrip("/")
    
    snippet = f'<script>window.__API_BASE__={json.dumps(root_path)};window.__NO_REWRITE__=false;</script>'
    if "<head>" in html:
        html = html.replace("<head>", f"<head>\n{snippet}", 1)
    else:
        html = f"{snippet}\n{html}"
    
    return HTMLResponse(content=html, media_type="text/html; charset=utf-8")

@app.get("/")
def root(request: Request):
    return _serve_spa(request, "index.html")

@app.get("/chat")
def chat_ui(request: Request):
    return _serve_spa(request, "index.html")

@app.get("/ui")
def ui(request: Request):
    return _serve_spa(request, "index.html")

@app.get("/localai")
def localai_page(request: Request):
    # Local AI used to be a separate standalone static page (static/localai.html)
    # opened in its own tab/window. It is now merged into the single-page app
    # as the "localai" view (index.html handles #/localai via its own router
    # bootstrap), so old bookmarks/links to this path still work by serving
    # the unified app, which auto-navigates to that view on load.
    return _serve_spa(request, "index.html")

@app.get("/diag")
def diag_page(request: Request):
    return _serve_spa(request, "diag.html")

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
def workspace_files(path: str = ".", conversation_id: Optional[str] = None, user: Dict[str, Any] = Depends(require_viewer)):
    if conversation_id:
        try:
            session_ws = get_or_create_session_workspace(conversation_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass
    try:
        return list_workspace_files(path)
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/workspace/file")
def workspace_read(path: str, conversation_id: Optional[str] = None, user: Dict[str, Any] = Depends(require_viewer)):
    if conversation_id:
        try:
            session_ws = get_or_create_session_workspace(conversation_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass
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

def resolve_workspace_file_safe(path: str, conversation_id: Optional[str] = None) -> Optional[Path]:
    """Resolves a file path across conversation session workspace, active workspace, default workspace, and any session workspace."""
    # 1. If conversation_id is passed, try that session workspace
    if conversation_id:
        try:
            session_ws = get_or_create_session_workspace(conversation_id)
            set_active_workspace(session_ws["id"])
            p = safe_path(path)
            if p.exists() and not p.is_dir():
                return p
        except Exception:
            pass

    # 2. Try the currently active workspace
    try:
        p = safe_path(path)
        if p.exists() and not p.is_dir():
            return p
    except Exception:
        pass

    # 3. Try the default workspace
    try:
        def_ws_root = get_default_workspace()
        clean = (path or ".").strip().lstrip("/")
        p = (def_ws_root / clean).resolve()
        if p.exists() and not p.is_dir():
            return p
    except Exception:
        pass

    # 4. Search all session workspaces
    try:
        clean = (path or ".").strip().lstrip("/")
        from .workspaces import WORKSPACES_ROOT
        for session_dir in WORKSPACES_ROOT.glob("session_*"):
            candidate = (session_dir / clean).resolve()
            if candidate.exists() and not candidate.is_dir():
                return candidate
    except Exception:
        pass

    return None

def bundle_html_preview_content(html_content: str, base_dir: Path, conversation_id: Optional[str] = None) -> str:
    """Inlines local stylesheets, scripts, and small images in HTML to prevent 404s when previewed in browser iframes."""
    if not html_content:
        return html_content

    # 1. Inline <link rel="stylesheet" href="..."> or <link href="..." rel="stylesheet">
    def replace_css_link(match):
        full = match.group(0)
        href_match = re.search(r'href=["\']([^"\']+)["\']', full, re.IGNORECASE)
        if not href_match:
            return full
        href = href_match.group(1).strip()
        if href.startswith(('http://', 'https://', '//', 'data:')):
            return full
        clean_rel = href.split('?')[0].split('#')[0].lstrip('/')
        css_file = (base_dir / clean_rel).resolve()
        if css_file.exists() and css_file.is_file():
            try:
                css_code = css_file.read_text(encoding='utf-8', errors='replace')
                return f'<style data-inlined-from="{href}">\n{css_code}\n</style>'
            except Exception:
                pass
        return full

    html_content = re.sub(r'<link\s+[^>]*?rel=["\']stylesheet["\'][^>]*?>', replace_css_link, html_content, flags=re.IGNORECASE)
    html_content = re.sub(r'<link\s+[^>]*?href=["\'][^"\']+\.css(?:\?[^"\']*)?["\'][^>]*?>', replace_css_link, html_content, flags=re.IGNORECASE)

    # 2. Inline <script src="..."></script>
    def replace_js_script(match):
        full = match.group(0)
        src_match = re.search(r'src=["\']([^"\']+)["\']', full, re.IGNORECASE)
        if not src_match:
            return full
        src = src_match.group(1).strip()
        if src.startswith(('http://', 'https://', '//', 'data:')):
            return full
        clean_rel = src.split('?')[0].split('#')[0].lstrip('/')
        js_file = (base_dir / clean_rel).resolve()
        if js_file.exists() and js_file.is_file():
            try:
                js_code = js_file.read_text(encoding='utf-8', errors='replace')
                return f'<script data-inlined-from="{src}">\n{js_code}\n</script>'
            except Exception:
                pass
        return full

    html_content = re.sub(r'<script\s+[^>]*?src=["\']([^"\']+\.(?:js|mjs)(?:\?[^"\']*)?)["\'][^>]*?>\s*</script>', replace_js_script, html_content, flags=re.IGNORECASE)

    # 3. Inline images <img src="..."> if local image file exists
    def replace_img_src(match):
        prefix = match.group(1)
        src = match.group(2).strip()
        suffix = match.group(3)
        if src.startswith(('http://', 'https://', '//', 'data:')):
            return match.group(0)
        clean_rel = src.split('?')[0].split('#')[0].lstrip('/')
        img_file = (base_dir / clean_rel).resolve()
        if img_file.exists() and img_file.is_file() and img_file.stat().st_size < 5 * 1024 * 1024:
            try:
                mime, _ = mimetypes.guess_type(str(img_file))
                mime = mime or 'image/png'
                b64 = base64.b64encode(img_file.read_bytes()).decode('utf-8')
                return f'{prefix}src="data:{mime};base64,{b64}"{suffix}'
            except Exception:
                pass
        return match.group(0)

    html_content = re.sub(r'(<img\s+[^>]*?)src=["\']([^"\']+)["\']([^>]*?>)', replace_img_src, html_content, flags=re.IGNORECASE)

    return html_content

@app.get("/api/workspace/raw")
def workspace_raw_file(path: str, conversation_id: Optional[str] = None, user: Dict[str, Any] = Depends(require_viewer)):
    p = resolve_workspace_file_safe(path, conversation_id)
    if not p or not p.exists() or p.is_dir():
        # Fallback to safe_path to handle standard errors
        try:
            p = safe_path(path)
            if not p.exists() or p.is_dir():
                raise HTTPException(404, f"File not found: {path}")
        except Exception:
            raise HTTPException(404, f"File not found: {path}")

    suffix = p.suffix.lower()
    if suffix in (".html", ".htm"):
        try:
            raw_html = p.read_text(encoding="utf-8", errors="replace")
            bundled = bundle_html_preview_content(raw_html, p.parent, conversation_id)
            return HTMLResponse(content=bundled, status_code=200)
        except Exception:
            pass

    mime, _ = mimetypes.guess_type(str(p))
    if not mime:
        mime = "application/octet-stream"
    return FileResponse(p, media_type=mime)

@app.get("/api/workspace/file-preview")
def workspace_file_preview(path: str, conversation_id: Optional[str] = None, user: Dict[str, Any] = Depends(require_viewer)):
    p = resolve_workspace_file_safe(path, conversation_id)
    if not p or not p.exists():
        try:
            p = safe_path(path)
        except Exception:
            raise HTTPException(404, f"File not found: {path}")

    if not p.exists():
        raise HTTPException(404, f"File not found: {path}")

    try:
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
        is_executable = suffix in (".py", ".sh", ".bash", ".js", ".ts", ".html", ".pyw", ".php")

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
                content_text = bundle_html_preview_content(content_text, p.parent, conversation_id)
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

        raw_qs = f"?path={urllib.parse.quote(path, safe='/')}" + (f"&conversation_id={urllib.parse.quote(conversation_id, safe='')}" if conversation_id else "")

        return {
            "path": path,
            "filename": p.name,
            "size": p.stat().st_size if p.is_file() else 0,
            "type": preview_type,
            "mimeType": mime,
            "isExecutable": is_executable,
            "content": content_text,
            "base64": base64_data,
            "csvData": csv_data,
            "rawUrl": f"/api/workspace/raw{raw_qs}"
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
    conversation_id = payload.get("conversation_id") or payload.get("session_id")
    if not path:
        raise HTTPException(400, "File path is required")

    # If conversation_id is provided, activate session workspace
    if conversation_id:
        try:
            session_ws = get_or_create_session_workspace(conversation_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass

    try:
        # Check if reference path e.g. @chat:conv-xxx/file.py or @project:proj-xxx/file.py
        if path.startswith("@") and ":" in path and "/" in path:
            prefix, rel_file = path.split("/", 1)
            target_type, target_id = prefix[1:].split(":", 1)
            p = safe_reference_path(target_type, target_id, rel_file)
        else:
            p = safe_path(path)

        if not p.exists():
            raise HTTPException(404, f"File not found: {path}")

        suffix = p.suffix.lower()
        cmd = ""
        arg_str = " ".join(f"'{a}'" for a in args) if args else ""

        if suffix in (".py", ".pyw"):
            cmd = f"python3 '{p.name}' {arg_str}".strip()
        elif suffix in (".sh", ".bash"):
            cmd = f"bash '{p.name}' {arg_str}".strip()
        elif suffix in (".js", ".mjs"):
            cmd = f"node '{p.name}' {arg_str}".strip()
        elif suffix == ".ts":
            cmd = f"npx --yes tsx '{p.name}' {arg_str}".strip()
        elif suffix in (".php",):
            cmd = f"php '{p.name}' {arg_str}".strip()
        elif suffix in (".html", ".htm"):
            raw_url = f"/api/workspace/raw?path={path}"
            if conversation_id:
                raw_url += f"&conversation_id={conversation_id}"
            return {
                "ok": True,
                "type": "html",
                "previewUrl": raw_url,
                "exitCode": 0,
                "stdout": f"Live HTML render preview initialized for {p.name}.",
                "stderr": "",
                "message": "HTML file ready for live preview."
            }
        else:
            cmd = f"cat '{p.name}' {arg_str}".strip()

        res = execute_sandboxed_command(cmd, cwd=str(p.parent), confirmed_dangerous=True)
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
    conv_id = payload.get("conversation_id") or payload.get("session_id")
    if conv_id:
        try:
            session_ws = get_or_create_session_workspace(conv_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass
    try:
        return preview(str(payload["path"]), str(payload.get("content", "")))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.put("/api/workspace/file")
def workspace_write(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    conv_id = payload.get("conversation_id") or payload.get("session_id")
    if conv_id:
        try:
            session_ws = get_or_create_session_workspace(conv_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass
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
    conv_id = payload.get("conversation_id") or payload.get("session_id")
    if conv_id:
        try:
            session_ws = get_or_create_session_workspace(conv_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass
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
def workspace_delete(path: str, conversation_id: Optional[str] = None, user: Dict[str, Any] = Depends(require_developer)):
    if conversation_id:
        try:
            session_ws = get_or_create_session_workspace(conversation_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass
    if not path:
        raise HTTPException(400, "Path is required")
    try:
        return delete_workspace_item(path)
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/workspace/rename")
def workspace_rename(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    conv_id = payload.get("conversation_id") or payload.get("session_id")
    if conv_id:
        try:
            session_ws = get_or_create_session_workspace(conv_id)
            set_active_workspace(session_ws["id"])
        except Exception:
            pass
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
    max_steps = int(payload.get("maxSteps") or 30)
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

def _job_sse_headers() -> Dict[str, str]:
    return {
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }


async def _tail_job_events(job_id: str, since_seq: int = 0):
    """Shared SSE tail: replay every persisted event after `since_seq`, then
    keep streaming new ones live until the job reaches a terminal state.

    Subscribing to the live queue *before* draining the backlog (and before
    the caller even schedules the job's execution task, for a brand new job)
    means no event can ever be missed, whichever order things actually run
    in: anything published after we subscribe lands in the queue; anything
    published before is already in `job_events` and gets replayed by the
    backlog drain. Sequence numbers de-duplicate the overlap between the two.

    Because this generator holds no reference to the job's own execution —
    it only *observes* durably-persisted state — a client disconnecting
    here (closed tab, dropped network) has zero effect on the job itself,
    which keeps running server-side regardless.
    """
    queue = subscribe_to_job(job_id)
    last_seq = since_seq
    try:
        while True:
            backlog = get_job_events_since(job_id, since_seq=last_seq)
            for ev in backlog:
                last_seq = ev["seq"]
                out = dict(ev["data"])
                out["seq"] = ev["seq"]
                yield f"event: {ev['type']}\ndata: {json.dumps(out, ensure_ascii=False)}\n\n"
                if ev["type"] in ("done", "error"):
                    return

            try:
                event = await asyncio.wait_for(queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                details = get_job_details(job_id)
                if details and details.get("status") in ("done", "failed", "cancelled"):
                    # Drain once more in case the terminal event was
                    # persisted right before the status flip landed.
                    for ev in get_job_events_since(job_id, since_seq=last_seq):
                        out = dict(ev["data"]); out["seq"] = ev["seq"]
                        yield f"event: {ev['type']}\ndata: {json.dumps(out, ensure_ascii=False)}\n\n"
                    return
                continue

            seq = event.get("seq", 0)
            if seq and seq <= last_seq:
                continue  # already delivered via the backlog drain above
            if seq:
                last_seq = seq
            event_type = event.get("type", "message")
            yield f"event: {event_type}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
            if event_type in ("done", "error"):
                return
    finally:
        unsubscribe_from_job(job_id, queue)


@app.post("/api/chat/stream")
async def chat_stream_endpoint(payload: Dict[str, Any], request: Request, user: Dict[str, Any] = Depends(require_developer)):
    messages = payload.get("messages") or [{"role": "user", "content": str(payload.get("message", ""))}]
    provider_id = str(payload.get("provider", "openrouter"))
    model_id = str(payload.get("model", ""))
    max_steps = int(payload.get("maxSteps") or 30)
    conversation_id = str(payload.get("conversationId") or payload.get("conversation_id") or "")
    references = payload.get("references")
    debug_mode = bool(payload.get("debug"))

    # The agent loop is created as a server-side job and scheduled as a
    # detached asyncio task *before* this request returns anything -- it is
    # not a child of this HTTP connection. Closing the browser tab, losing
    # network, or navigating away only stops *watching*; the job keeps
    # running (and, if the whole server restarts mid-run, resumes from its
    # last checkpoint -- see worker.py's recover_orphaned_jobs()).
    job = create_job(
        title=(str(payload.get("message", "")) or "Chat")[:80],
        provider_id=provider_id,
        model_id=model_id,
        payload={
            "messages": messages,
            "maxSteps": max_steps,
            "conversationId": conversation_id,
            "references": references,
            "debug": debug_mode,
        },
        user_id=user.get("username", "user"),
        max_steps=max_steps,
        max_timeout_sec=int(payload.get("timeoutSec") or 1800),
        conversation_id=conversation_id,
        job_type=CHAT_JOB_TYPE,
    )
    job_id = job["id"]

    async def event_generator():
        yield f"event: job\ndata: {json.dumps({'jobId': job_id, 'conversationId': conversation_id}, ensure_ascii=False)}\n\n"
        # Scheduled *after* the 'job' event above is prepared but the
        # subscriber queue inside _tail_job_events() is created before any
        # events can be published, so nothing emitted by the task is ever
        # lost even if this generator is slow to start iterating.
        asyncio.create_task(execute_job_task(job_id))
        async for chunk in _tail_job_events(job_id, since_seq=0):
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_job_sse_headers())


@app.get("/api/chat/stream/{job_id}")
async def chat_stream_reattach(job_id: str, since: int = 0, user: Dict[str, Any] = Depends(require_viewer)):
    """Re-attach to an already-running (or already-finished) chat job's live
    stream. This is what makes reconnecting after a dropped connection work:
    the frontend remembers the jobId, and on reload/reconnect calls this
    with `since` set to the last event seq it actually rendered."""
    job = get_job_details(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return StreamingResponse(_tail_job_events(job_id, since_seq=int(since or 0)), media_type="text/event-stream", headers=_job_sse_headers())


@app.get("/api/conversations/{conv_id}/active-job")
def get_conversation_active_job(conv_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    """Lets the frontend discover, on page load/reconnect, whether this
    conversation has a chat job still queued/running/paused so it can
    re-attach to the live stream instead of showing an idle composer while
    the agent is actually still working server-side."""
    jobs = list_all_jobs(conversation_id=conv_id, job_type=CHAT_JOB_TYPE, limit=5)
    active = next((j for j in jobs if j.get("status") in ("queued", "running", "paused")), None)
    return {"active": active}

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
    conv_id = f"conv-{int(time.time()*1000)}-{uuid.uuid4().hex[:6]}"
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
    msg_id = f"msg-{int(time.time()*1000)}-{uuid.uuid4().hex[:6]}"
    role = str(payload.get("role", "user"))
    content = str(payload.get("content", ""))
    tool_calls = json.dumps(payload.get("tool_calls")) if payload.get("tool_calls") else None
    with get_db() as conn:
        conn.execute("INSERT INTO messages (id, conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?, ?)", (msg_id, conv_id, role, content, tool_calls))
        conn.execute("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", (conv_id,))
    return {"id": msg_id, "role": role, "content": content}

@app.put("/api/conversations/{conv_id}/messages/sync")
def sync_conversation_messages(conv_id: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    msgs = payload.get("messages") or []
    with get_db() as conn:
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        for idx, m in enumerate(msgs):
            msg_id = f"msg-{int(time.time()*1000)}-{idx}"
            role = str(m.get("role", "user"))
            content = str(m.get("content", ""))
            tool_calls = json.dumps(m.get("tool_calls")) if m.get("tool_calls") else None
            conn.execute("INSERT INTO messages (id, conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?, ?)", (msg_id, conv_id, role, content, tool_calls))
        conn.execute("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", (conv_id,))
    return {"ok": True, "count": len(msgs)}

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
    clear_conversation_checkpoints(conv_id)
    return {"ok": True}

# Conversation Checkpoints API
@app.get("/api/conversations/{conv_id}/checkpoints")
def get_conversation_checkpoints_endpoint(conv_id: str, limit: int = 10, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        checkpoints = get_conversation_checkpoints(conv_id, limit=limit)
        return {"checkpoints": checkpoints}
    except Exception as e:
        raise HTTPException(400, str(e))

@app.get("/api/conversations/{conv_id}/checkpoints/latest")
def get_latest_conversation_checkpoint_endpoint(conv_id: str, user: Dict[str, Any] = Depends(require_viewer)):
    try:
        cp = get_latest_conversation_checkpoint(conv_id)
        if not cp:
            raise HTTPException(404, "No checkpoint found for conversation")
        return {"checkpoint": cp}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))

@app.delete("/api/conversations/{conv_id}/checkpoints")
def clear_conversation_checkpoints_endpoint(conv_id: str, user: Dict[str, Any] = Depends(require_developer)):
    try:
        clear_conversation_checkpoints(conv_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, str(e))

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
        max_timeout_sec=int(payload.get("timeoutSec", 600)),
        conversation_id=str(payload.get("conversationId") or payload.get("conversation_id") or ""),
        job_type=CHAT_JOB_TYPE,
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

async def _execute_model_diagnostic_test(
    p: Provider,
    m: ModelSpec,
    api_key: str,
    timeout_sec: float = 5.0,
    connect_sec: float = 2.5
) -> Dict[str, Any]:
    base_url = p.url.rstrip("/")
    direct_url = resolve_provider_endpoint_url(base_url, p.protocol, m.id)
    
    # 1. Direct Target Endpoint & Headers Construction
    if p.protocol == "anthropic":
        req_headers = {"Content-Type": "application/json"}
        if api_key:
            req_headers["x-api-key"] = mask_secret(api_key)
            req_headers["anthropic-version"] = "2023-06-01"
        req_body = {
            "model": m.id,
            "system": "",
            "messages": [{"role": "user", "content": "Reply with 'OK' only."}],
            "max_tokens": m.maxOutputTokens or 4096,
            "temperature": 0.2
        }
    elif p.protocol == "ollama":
        req_headers = {"Content-Type": "application/json"}
        req_body = {
            "model": m.id,
            "messages": [{"role": "user", "content": "Reply with 'OK' only."}],
            "stream": False
        }
    elif p.protocol == "azure":
        req_headers = {"Content-Type": "application/json"}
        if api_key:
            req_headers["api-key"] = mask_secret(api_key)
        req_body = {
            "model": m.id,
            "messages": [{"role": "user", "content": "Reply with 'OK' only."}],
            "temperature": 0.2
        }
    elif p.protocol == "cloudflare":
        # Native REST API: the model is already a path segment in direct_url
        # above, never a body field — this is what used to make every
        # Cloudflare model test hit the exact same hardcoded endpoint.
        req_headers = {"Content-Type": "application/json"}
        if api_key:
            req_headers["Authorization"] = f"Bearer {mask_secret(api_key)}"
        req_body = {
            "messages": [{"role": "user", "content": "Reply with 'OK' only."}]
        }
    else: # openai-compatible, mistral, openrouter
        req_headers = {"Content-Type": "application/json"}
        if api_key:
            req_headers["Authorization"] = f"Bearer {mask_secret(api_key)}"
        req_body = {
            "model": m.id,
            "messages": [{"role": "user", "content": "Reply with 'OK' only."}],
            "temperature": 0.2
        }

    # 2. Proxy Configuration & Routing
    if p.protocol == "ollama" or "127.0.0.1" in base_url or "localhost" in base_url:
        effective_url = direct_url
        proxy_client = None
        proxy_mode = "Direct (Local / Ollama)"
        is_proxy_active = False
    elif p.proxyUrl:
        effective_url, proxy_client = get_proxy_config(direct_url, custom_proxy_url=p.proxyUrl)
        is_proxy_active = (effective_url != direct_url) or (proxy_client is not None)
        proxy_mode = "Forward Proxy (Client Tunnel)" if proxy_client else ("Gateway (URL Rewrite)" if effective_url != direct_url else "Direct")
    else:
        effective_url, proxy_client = get_proxy_config(direct_url)
        is_proxy_active = (effective_url != direct_url) or (proxy_client is not None)
        proxy_mode = "Forward Proxy (Client Tunnel)" if proxy_client else ("Gateway (URL Rewrite)" if effective_url != direct_url else "Direct")

    request_info = {
        "method": "POST",
        "directEndpoint": direct_url,
        "effectiveEndpoint": effective_url,
        "proxyClient": proxy_client,
        "isProxyActive": is_proxy_active,
        "proxyMode": proxy_mode,
        "headers": req_headers,
        "body": req_body
    }

    if not api_key and p.protocol != "ollama":
        PROVIDER_STORE.record_metric(p.id, m.id, 0, is_error=True)
        return {
            "provider": p.id,
            "providerName": p.name,
            "model": m.id,
            "modelName": m.name,
            "ok": False,
            "latencyMs": 0,
            "protocol": p.protocol,
            "error": f"API key not configured for provider '{p.name}'",
            "request": request_info,
            "response": {
                "statusCode": 401,
                "renderedText": "",
                "reasoningContent": "",
                "rawJson": None,
                "rawError": f"API key not configured for provider '{p.name}'"
            },
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
        }

    started = time.perf_counter()
    try:
        out = await call_provider_api(
            p, m, [{"role": "user", "content": "Reply with 'OK' only."}], api_key,
            custom_timeout_sec=timeout_sec, custom_connect_sec=connect_sec
        )
        latency = round((time.perf_counter() - started) * 1000)
        choice = out.get("choices", [{}])[0]
        msg_dict = choice.get("message", {})
        msg_text = msg_dict.get("content", "")
        reasoning_text = msg_dict.get("reasoning_content", "") or msg_dict.get("thinking", "")
        PROVIDER_STORE.record_metric(p.id, m.id, latency, is_error=False)

        return {
            "provider": p.id,
            "providerName": p.name,
            "model": m.id,
            "modelName": m.name,
            "ok": True,
            "latencyMs": latency,
            "protocol": p.protocol,
            "message": (msg_text[:120] if msg_text else "OK"),
            "request": request_info,
            "response": {
                "statusCode": 200,
                "renderedText": msg_text or "OK",
                "reasoningContent": reasoning_text,
                "rawJson": out,
                "rawError": None
            },
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
        }
    except Exception as e:
        latency = round((time.perf_counter() - started) * 1000)
        # httpx's own Timeout/Connect exceptions (ReadTimeout, ConnectTimeout,
        # PoolTimeout, ConnectError...) very often carry no message at all —
        # str(e) is "" — so matching against str(e) alone silently produced a
        # *blank* error field instead of a helpful one. Fall back to the
        # exception's class name, which always carries the real signal.
        err_str = str(e) or type(e).__name__
        if "ConnectError" in err_str or "Connection refused" in err_str or "All connection attempts failed" in err_str:
            err_str = f"Connection refused/unreachable: {p.url}"
        elif "Timeout" in err_str:
            err_str = f"Connection timeout to {p.url}"
        elif not err_str:
            err_str = f"{type(e).__name__}: request failed for an unknown reason"
        PROVIDER_STORE.record_metric(p.id, m.id, latency, is_error=True)
        return {
            "provider": p.id,
            "providerName": p.name,
            "model": m.id,
            "modelName": m.name,
            "ok": False,
            "latencyMs": latency,
            "protocol": p.protocol,
            "error": err_str,
            "request": request_info,
            "response": {
                "statusCode": 0,
                "renderedText": "",
                "reasoningContent": "",
                "rawJson": None,
                "rawError": str(e)
            },
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
        }

@app.post("/api/providers/test-all")
async def test_all_models(payload: Optional[Dict[str, Any]] = None, user: Dict[str, Any] = Depends(require_developer)):
    payload = payload or {}
    selected_pid = payload.get("provider")

    def _as_exception_result(r: Exception) -> Dict[str, Any]:
        return {
            "provider": "unknown",
            "providerName": "Unknown",
            "model": "unknown",
            "modelName": "Unknown",
            "ok": False,
            "latencyMs": 0,
            "protocol": "unknown",
            "error": str(r),
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
        }

    # Per-provider queues of (provider, model, api_key), in provider display
    # order -- and *round-robin interleaved* across providers below, rather
    # than exhausted one provider at a time. Hammering a single provider
    # with every one of its models back-to-back is exactly what trips most
    # providers' per-key rate limits; testing model #1 of every provider,
    # then model #2 of every provider, and so on naturally spreads repeat
    # hits to the same provider apart by however long a full round across
    # every other provider takes.
    provider_queues: List[List[Tuple[Provider, ModelSpec, str]]] = []
    for pid, p in list(PROVIDER_STORE.data.items()):
        if selected_pid and pid != selected_pid:
            continue
        try:
            api_key = PROVIDER_STORE.get_api_key(p)
        except Exception:
            api_key = ""
        queue = [(p, m, api_key) for m in (p.models or [])]
        if queue:
            provider_queues.append(queue)

    results: List[Dict[str, Any]] = []
    if provider_queues:
        max_models = max(len(q) for q in provider_queues)
        for round_idx in range(max_models):
            round_tasks = [
                _execute_model_diagnostic_test(p, m, api_key, timeout_sec=4.0, connect_sec=2.0)
                for q in provider_queues if round_idx < len(q)
                for (p, m, api_key) in [q[round_idx]]
            ]
            if not round_tasks:
                continue
            round_results = await asyncio.gather(*round_tasks, return_exceptions=True)
            for r in round_results:
                results.append(_as_exception_result(r) if isinstance(r, Exception) else r)

    return {"results": results}

@app.post("/api/providers/{pid}/test")
async def test_provider_models(pid: str, user: Dict[str, Any] = Depends(require_developer)):
    return await test_all_models(payload={"provider": pid}, user=user)

@app.post("/api/providers/{pid}/models/{mid:path}/test")
async def test_single_model(pid: str, mid: str, user: Dict[str, Any] = Depends(require_developer)):
    p = PROVIDER_STORE.data.get(pid)
    if not p:
        raise HTTPException(404, f"Provider '{pid}' not found")
    model = next((m for m in (p.models or []) if m.id == mid), None)
    if not model:
        model = ModelSpec(id=mid, name=mid, toolCalling=True)

    try:
        api_key = PROVIDER_STORE.get_api_key(p)
    except Exception:
        api_key = ""

    return await _execute_model_diagnostic_test(p, model, api_key, timeout_sec=5.0, connect_sec=2.5)

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
        report = PROVIDER_STORE.import_json_report(raw, replace=replace)
        return {
            "ok": True,
            "count": len(PROVIDER_STORE.data),
            "providersInPayload": report["providersInPayload"],
            "created": report.get("created", []),
            "updated": report.get("updated", []),
            "modelsAdded": report.get("modelsAdded", 0),
            "modelsUpdated": report.get("modelsUpdated", 0),
        }
    except Exception as e:
        raise HTTPException(400, f"Import failed: {str(e)}")

@app.post("/api/providers/import")
async def import_providers(file: UploadFile = File(...), replace: bool = False, user: Dict[str, Any] = Depends(require_admin)):
    try:
        content = (await file.read()).decode("utf-8")
        report = PROVIDER_STORE.import_json_report(content, replace=replace)
        return {
            "ok": True,
            "count": len(PROVIDER_STORE.data),
            "providersInPayload": report["providersInPayload"],
            "created": report.get("created", []),
            "updated": report.get("updated", []),
            "modelsAdded": report.get("modelsAdded", 0),
            "modelsUpdated": report.get("modelsUpdated", 0),
        }
    except Exception as e:
        raise HTTPException(400, f"Import failed: {str(e)}")

@app.post("/api/providers/{pid}/import-models")
def import_provider_models(pid: str, payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    raw = payload.get("json") or payload.get("text") or payload.get("data") or payload.get("models") or ""
    replace = bool(payload.get("replace", False))
    try:
        return PROVIDER_STORE.import_models_for_provider(pid, str(raw), replace=replace)
    except Exception as e:
        raise HTTPException(400, f"Model import failed: {str(e)}")

# Local AI Endpoints
@app.get("/api/localai/host")
def get_localai_host(refresh: bool = False, user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    scan = local_ai.host_scan(refresh=refresh)
    host_info = scan.get("host", {}) or {}
    # The Local AI dashboard markup/JS is mirrored verbatim from the PHP
    # edition, whose LocalAI::hostScan() returns a FLAT payload
    # (os/cpu/memory/disk/gpu/suggestedRamBudgetGb/runtime all top-level).
    # local_ai.host_scan() here nests those same fields one level deeper
    # under "host" (kept as-is since recommend()/normalize_profile() already
    # consume that nested shape internally) — returning it unflattened to
    # the HTTP API silently broke every frontend read of HOST.memory/
    # HOST.cpu/HOST.gpu/HOST.disk/HOST.suggestedRamBudgetGb (all undefined),
    # so the hardware panel and the recommend-profile defaults always fell
    # back to hardcoded placeholder values (4GB total / 2GB available / no
    # GPU / 10GB disk / 2GB suggested budget) instead of the real scan.
    return {
        **host_info,
        "suggestedRamBudgetGb": (host_info.get("memory") or {}).get("suggestedBudgetGb", 0.0),
        "runtime": scan.get("runtime", {}),
    }

@app.get("/api/localai/runtime")
def get_localai_runtime(user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    return local_ai.runtime_status()

@app.post("/api/localai/runtime/install")
def post_localai_runtime_install(payload: Optional[Dict[str, Any]] = None, user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    engine = (payload or {}).get("engine") or "ollama"
    try:
        return local_ai.install_runtime(engine=engine)
    except Exception as e:
        raise HTTPException(500, f"Runtime installation failed: {str(e)}")

@app.post("/api/localai/runtime/engine")
def post_localai_runtime_engine(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    from .database import set_state
    engine = str((payload or {}).get("engine") or "ollama")
    if engine not in ("ollama", "llamacpp"):
        raise HTTPException(400, f"Unknown engine: {engine}")
    set_state("localai:engine", engine)
    return local_ai.runtime_status()

@app.post("/api/localai/runtime/start")
def post_localai_runtime_start(payload: Optional[Dict[str, Any]] = None, user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    env_overrides = (payload or {}).get("env")
    try:
        return local_ai.start_server(env_overrides=env_overrides)
    except Exception as e:
        raise HTTPException(500, f"Could not start local runtime: {str(e)}")

@app.post("/api/localai/runtime/stop")
def post_localai_runtime_stop(user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    try:
        return local_ai.stop_server()
    except Exception as e:
        raise HTTPException(500, f"Could not stop local runtime: {str(e)}")

@app.post("/api/localai/runtime/fix-permissions")
def post_localai_runtime_fix_permissions(user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    try:
        return local_ai.fix_permissions()
    except Exception as e:
        raise HTTPException(500, f"Could not fix permissions: {str(e)}")

@app.get("/api/localai/catalog")
def get_localai_catalog(user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    return local_ai.catalog()

@app.post("/api/localai/search")
def post_localai_search(payload: Optional[Dict[str, Any]] = None, user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    query = str((payload or {}).get("query") or (payload or {}).get("q") or "").strip()
    limit = int((payload or {}).get("limit") or 25)
    remote = bool((payload or {}).get("remote", True))
    try:
        return local_ai.search(query=query, limit=limit, remote=remote)
    except Exception as e:
        raise HTTPException(500, f"Search failed: {str(e)}")

@app.get("/api/localai/search")
def get_localai_search(q: str = "", limit: int = 25, remote: bool = True, user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    try:
        return local_ai.search(query=q, limit=limit, remote=remote)
    except Exception as e:
        raise HTTPException(500, f"Search failed: {str(e)}")

@app.get("/api/localai/tags/{name:path}")
def get_localai_tags(name: str, user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    return {"ok": True, "name": name, "installed": [m for m in (local_ai.installed() or {}).get("models", []) if m.get("name") == name]}

@app.post("/api/localai/test")
def post_localai_test(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    model = str(payload.get("model") or payload.get("ref") or "").strip()
    if not model:
        raise HTTPException(400, "Model name is required")
    try:
        return local_ai.benchmark_test(model)
    except Exception as e:
        raise HTTPException(500, f"Model test failed: {str(e)}")

@app.post("/api/localai/install")
def post_localai_install(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    from .database import get_state, set_state
    model_ref = str(payload.get("ref") or payload.get("model") or "").strip()
    if not model_ref:
        raise HTTPException(400, "Model reference is required")
    
    # Create background job in database
    from .worker import log_job_message
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    init_db()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO jobs (id, title, status, progress, summary, job_type, created_at, updated_at)
               VALUES (?, ?, 'running', 0, 'در صف نصب', 'localai_install', datetime('now'), datetime('now'))""",
            (job_id, f"نصب مدل محلی: {model_ref}")
        )
        conn.commit()

    engine = str(payload.get("engine") or get_state("localai:engine") or "ollama")

    def run_install_task():
        def append_log(lvl: str, msg: str):
            log_job_message(job_id, lvl, msg)

        def set_progress(pct: float, summary: str):
            with get_db() as c:
                c.execute("UPDATE jobs SET progress = ?, summary = ? WHERE id = ?", (pct, summary, job_id))
                c.commit()

        try:
            with get_db() as c:
                c.execute("UPDATE jobs SET status = 'running', progress = 10, summary = 'دانلود و بررسی موتور' WHERE id = ?", (job_id,))
                c.commit()
            append_log("INFO", f"بررسی و آماده‌سازی موتور هوش مصنوعی ({engine})…")
            local_ai.install_runtime(engine=engine, log_fn=lambda m: append_log("INFO", m))

            if engine == "llamacpp":
                set_progress(25, f"دانلود فایل GGUF برای {model_ref}")
                append_log("INFO", f"شروع دانلود مدل {model_ref}…")

                def on_dl_progress(status: str, pct: float, done: float, total: float):
                    set_progress(25 + pct * 0.45, f"دانلود مدل — {pct:.0f}٪")

                pulled = local_ai.pull_gguf(model_ref, explicit_file=(payload.get("file") or None), on_progress=on_dl_progress)
                append_log("INFO", f"فایل دانلود شد: {pulled['path']} ({pulled['sizeGb']} GB, {pulled['quant']})")

                set_progress(75, "بارگذاری مدل در llama-server")
                ctx_tokens = int(payload.get("contextTokens") or 8192)
                local_ai.llamacpp_index_add(str(payload.get("displayName") or model_ref), {
                    "path": pulled["path"], "quant": pulled["quant"], "repo": pulled["repo"],
                    "sizeGb": pulled["sizeGb"], "owned": True,
                    "addedAt": datetime.utcnow().isoformat() + "Z",
                })
                local_ai.activate_llamacpp_model(pulled["path"], ctx_tokens, lambda m: append_log("INFO", m))

                display_name = str(payload.get("displayName") or model_ref)
                if payload.get("benchmark", True):
                    set_progress(90, "تست سرعت و بنچمارک")
                    append_log("INFO", "اجرای تست سرعت…")
                    bench = local_ai.benchmark_llamacpp(display_name)
                    append_log("INFO", f"سرعت واقعی: {bench.get('tokensPerSec', 0)} توکن/ثانیه" if bench.get("ok") else f"بنچمارک ناموفق: {bench.get('error')}")

                if payload.get("register", True):
                    set_progress(95, "ثبت در فهرست ارائه‌دهنده‌ها")
                    local_ai.register_llamacpp_provider(display_name, {
                        "name": display_name, "contextTokens": ctx_tokens, "path": pulled["path"],
                        "toolCalling": payload.get("toolCalling", False), "vision": payload.get("vision", False),
                    })
                    if payload.get("setDefault"):
                        set_state("localai:default", display_name)
            else:
                with get_db() as c:
                    c.execute("UPDATE jobs SET progress = 30, summary = 'راه‌اندازی سرویس محلی' WHERE id = ?", (job_id,))
                    c.commit()
                append_log("INFO", "راه‌اندازی سرویس Ollama…")
                local_ai.start_server(log_fn=lambda m: append_log("INFO", m))

                with get_db() as c:
                    c.execute("UPDATE jobs SET progress = 50, summary = ? WHERE id = ?", (f"دانلود مدل {model_ref}", job_id))
                    c.commit()
                append_log("INFO", f"شروع دانلود مدل {model_ref}…")
                local_ai.pull_model(model_ref)

                with get_db() as c:
                    c.execute("UPDATE jobs SET progress = 85, summary = 'ثبت در فهرست ارائه‌دهنده‌ها' WHERE id = ?", (job_id,))
                    c.commit()
                append_log("INFO", f"ثبت مدل {model_ref} در ارائه‌دهنده‌ها…")
                if payload.get("register", True):
                    local_ai.register_provider(model_ref, meta=payload)

                if payload.get("benchmark", True):
                    with get_db() as c:
                        c.execute("UPDATE jobs SET progress = 95, summary = 'تست سرعت و بنچمارک' WHERE id = ?", (job_id,))
                        c.commit()
                    append_log("INFO", "اجرای تست سرعت…")
                    bench = local_ai.benchmark_test(model_ref)
                    append_log("INFO", f"سرعت واقعی: {bench.get('tokensPerSec', 0)} توکن/ثانیه")

            with get_db() as c:
                c.execute("UPDATE jobs SET status = 'done', progress = 100, summary = '✅ پایان موفق نصب مدل', updated_at = datetime('now') WHERE id = ?", (job_id,))
                c.commit()
            append_log("INFO", "نصب مدل با موفقیت پایان یافت.")
        except Exception as e:
            err_msg = str(e)
            append_log("ERROR", f"خطا در نصب: {err_msg}")
            with get_db() as c:
                c.execute("UPDATE jobs SET status = 'failed', error = ?, summary = '❌ نصب ناموفق', updated_at = datetime('now') WHERE id = ?", (err_msg, job_id))
                c.commit()

        # Start thread
    t = threading.Thread(target=run_install_task, daemon=True)
    t.start()

    return {
        "ok": True,
        "job": {"id": job_id, "status": "running", "progress": 0},
        "plan": local_ai.plan(dict(payload, engine=engine)),
    }

@app.post("/api/localai/scan")
def post_localai_scan(payload: Optional[Dict[str, Any]] = None, user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    try:
        return local_ai.scan_drive(payload or {})
    except Exception as e:
        raise HTTPException(500, f"Scan failed: {str(e)}")

@app.post("/api/localai/import")
def post_localai_import(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    from .database import get_state
    path = str(payload.get("path") or "").strip()
    if not path or not os.path.isfile(path):
        raise HTTPException(400, f"فایل انتخاب‌شده روی دیسک پیدا نشد: {path}")
    ext = os.path.splitext(path)[1].lstrip(".").lower()
    if ext not in ("gguf", "ggml"):
        raise HTTPException(400, "فقط فایل‌های gguf/ggml قابل درون‌ریزی مستقیم هستند؛ safetensors ابتدا باید به gguf تبدیل شود.")

    engine = str(payload.get("engine") or get_state("localai:engine") or "ollama")
    name = str(payload.get("name") or "").strip() or local_ai.suggest_name_from_file(path)
    context_tokens = int(payload.get("contextTokens") or 8192)
    register = bool(payload.get("register", True))
    benchmark = bool(payload.get("benchmark", True))
    set_default = bool(payload.get("setDefault", False))

    from .worker import log_job_message
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    init_db()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO jobs (id, title, status, progress, summary, job_type, created_at, updated_at)
               VALUES (?, ?, 'running', 0, 'در صف درون‌ریزی', 'localai_import', datetime('now'), datetime('now'))""",
            (job_id, f"درون‌ریزی مدل محلی: {name}")
        )
        conn.commit()

    def run_import_task():
        def append_log(lvl: str, msg: str):
            log_job_message(job_id, lvl, msg)

        def set_progress(pct: float, summary: str):
            with get_db() as c:
                c.execute("UPDATE jobs SET status = 'running', progress = ?, summary = ? WHERE id = ?", (pct, summary, job_id))
                c.commit()

        try:
            local_ai.run_import_job(job_id, engine, path, name, context_tokens, register, benchmark, set_default, lambda m: append_log("INFO", m), set_progress)
            with get_db() as c:
                c.execute("UPDATE jobs SET status = 'done', progress = 100, summary = '✅ پایان موفق درون‌ریزی', updated_at = datetime('now') WHERE id = ?", (job_id,))
                c.commit()
        except Exception as e:
            err_msg = str(e)
            append_log("ERROR", f"خطا در درون‌ریزی: {err_msg}")
            with get_db() as c:
                c.execute("UPDATE jobs SET status = 'failed', error = ?, summary = '❌ درون‌ریزی ناموفق', updated_at = datetime('now') WHERE id = ?", (err_msg, job_id))
                c.commit()

    t = threading.Thread(target=run_import_task, daemon=True)
    t.start()
    return {"ok": True, "job": {"id": job_id, "status": "running", "progress": 0}}

@app.post("/api/localai/llamacpp/activate")
def post_localai_llamacpp_activate(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    path = str(payload.get("path") or "").strip()
    if not path:
        raise HTTPException(400, "path is required")
    try:
        return local_ai.activate_llamacpp_model(path, int(payload["contextTokens"]) if payload.get("contextTokens") else None)
    except Exception as e:
        raise HTTPException(409, str(e))

@app.get("/api/localai/models")
def get_localai_models(user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    return local_ai.installed()

@app.post("/api/localai/recommend")
def post_localai_recommend(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    try:
        return local_ai.recommend(payload)
    except Exception as e:
        raise HTTPException(500, f"Recommendation failed: {str(e)}")

@app.post("/api/localai/pull")
def post_localai_pull(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    model_name = str(payload.get("model") or "").strip()
    if not model_name:
        raise HTTPException(400, "Model name is required")
    try:
        return local_ai.pull_model(model_name)
    except Exception as e:
        raise HTTPException(500, f"Model pull failed: {str(e)}")

@app.delete("/api/localai/models/{name:path}")
def delete_localai_model(name: str, user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    try:
        return local_ai.remove_model(name)
    except Exception as e:
        raise HTTPException(404, str(e))

@app.post("/api/localai/register")
def post_localai_register(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    from . import local_ai
    model_ref = str(payload.get("model") or "").strip()
    if not model_ref:
        raise HTTPException(400, "Model reference is required")
    meta = payload.get("meta") or {}
    try:
        return local_ai.register_provider(model_ref, meta=meta)
    except Exception as e:
        raise HTTPException(500, f"Registration failed: {str(e)}")

@app.get("/api/localai/profiles")
def get_localai_profiles(user: Dict[str, Any] = Depends(require_viewer)):
    from . import local_ai
    return local_ai.list_profiles()

@app.post("/api/localai/profiles")
def post_localai_profiles(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_developer)):
    from . import local_ai
    name = str(payload.get("name") or "").strip()
    profile_data = payload.get("profile") or {}
    if not name:
        raise HTTPException(400, "Profile name is required")
    try:
        return local_ai.save_profile(name, profile_data)
    except Exception as e:
        raise HTTPException(500, f"Saving profile failed: {str(e)}")

@app.delete("/api/localai/profiles/{name:path}")
def delete_localai_profile(name: str, user: Dict[str, Any] = Depends(require_developer)):
    from . import local_ai
    return local_ai.delete_profile(name)

# Environment & Security Config API (Phase 12)
@app.get("/api/config/environment")
def get_env_config(user: Dict[str, Any] = Depends(require_admin)):
    return read_environment()

@app.put("/api/config/environment")
def put_env_config(payload: Dict[str, Any], user: Dict[str, Any] = Depends(require_admin)):
    return write_environment(payload)

@app.post("/api/config/test-proxy")
async def test_proxy_endpoint(payload: Optional[Dict[str, Any]] = None, user: Dict[str, Any] = Depends(require_admin)):
    payload = payload or {}
    proxy_val = (payload.get("proxy_url") or get_raw_config("AGENT_PROXY_URL", DEFAULT_PROXY_URL)).strip()
    test_target = payload.get("target_url") or "https://httpbin.org/get"
    
    actual_url, proxy_client = parse_proxy_setting(proxy_val, test_target)
    
    started = time.perf_counter()
    try:
        import httpx
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True, verify=False, proxy=proxy_client) as client:
            resp = await client.get(actual_url)
            latency = round((time.perf_counter() - started) * 1000)
            return {
                "ok": resp.status_code < 400 or resp.status_code == 404,
                "status_code": resp.status_code,
                "latency_ms": latency,
                "proxy_url": proxy_val,
                "effective_url": actual_url,
                "proxy_client": proxy_client,
                "message": f"Proxy responded with HTTP {resp.status_code} in {latency}ms"
            }
    except Exception as e:
        latency = round((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "status_code": 0,
            "latency_ms": latency,
            "proxy_url": proxy_val,
            "effective_url": actual_url,
            "proxy_client": proxy_client,
            "error": str(e),
            "message": f"Proxy connection check failed: {str(e)}"
        }

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

