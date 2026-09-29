"""FastAPI Application Main Entrypoint with full feature routers, lifespan, and security."""
import asyncio
import os
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Response, Depends
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

from .config import read_environment, write_environment, is_auth_enabled, get_raw_config, get_default_workspace, APP_VERSION
from .database import get_db, init_db
from .models import Provider, ModelSpec
from .providers import PROVIDER_STORE
from .workspaces import (
    get_active_workspace, set_active_workspace, list_workspace_files,
    safe_path, create_workspace_from_template, get_workspace_metrics
)
from .projects import (
    get_active_project, set_active_project, list_projects,
    get_project, create_project, update_project, delete_project,
    ProjectCreateRequest, ProjectUpdateRequest
)
from .changesets import (
    create_changeset, get_changeset, list_changesets, approve_changeset,
    reject_changeset, rollback_changeset, approve_changeset_file, reject_changeset_file,
    list_file_versions, compare_file_versions, rollback_to_version, acquire_file_lock, release_file_lock
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
    try:
        return await complete_chat(PROVIDER_STORE, provider_id, model_id, messages, max_steps=max_steps, user_id=user.get("username", "user"))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post("/api/chat/stream")
async def chat_stream_endpoint(payload: Dict[str, Any], request: Request, user: Dict[str, Any] = Depends(require_developer)):
    messages = payload.get("messages") or [{"role": "user", "content": str(payload.get("message", ""))}]
    provider_id = str(payload.get("provider", "openrouter"))
    model_id = str(payload.get("model", ""))
    max_steps = int(payload.get("maxSteps", 8))

    async def event_generator():
        yield 'event: status\ndata: {"status": "started", "provider": "' + provider_id + '"}\n\n'
        try:
            res = await complete_chat(PROVIDER_STORE, provider_id, model_id, messages, max_steps=max_steps, user_id=user.get("username", "user"))
            msg = res.get("message", {})
            content = msg.get("content", "")

            # Stream text in chunks
            chunk_size = 30
            for i in range(0, len(content), chunk_size):
                chunk = content[i:i + chunk_size]
                yield 'event: token\ndata: ' + json.dumps({"text": chunk}, ensure_ascii=False) + '\n\n'
                await asyncio.sleep(0.01)

            # Send pending approvals if any
            approvals = res.get("pendingApprovals", [])
            if approvals:
                yield 'event: approvals\ndata: ' + json.dumps({"approvals": approvals}, ensure_ascii=False) + '\n\n'

            yield 'event: done\ndata: ' + json.dumps({"steps": res.get("steps", 1), "provider": res.get("provider"), "model": res.get("model")}, ensure_ascii=False) + '\n\n'
        except Exception as e:
            yield 'event: error\ndata: ' + json.dumps({"error": str(e)}, ensure_ascii=False) + '\n\n'

    return StreamingResponse(event_generator(), media_type="text/event-stream")

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

@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str, user: Dict[str, Any] = Depends(require_developer)):
    with get_db() as conn:
        conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
    return {"ok": True}

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
    results = []

    for pid, p in PROVIDER_STORE.data.items():
        if selected_pid and pid != selected_pid:
            continue
        api_key = PROVIDER_STORE.get_api_key(p)
        if not api_key and p.protocol != "ollama":
            continue

        for m in p.models:
            started = time.perf_counter()
            try:
                out = await call_provider_api(p, m, [{"role": "user", "content": "Reply with 'OK' only."}], api_key)
                latency = round((time.perf_counter() - started) * 1000)
                msg_text = out["choices"][0]["message"].get("content", "")[:100]
                results.append({
                    "provider": pid,
                    "model": m.id,
                    "ok": True,
                    "latencyMs": latency,
                    "protocol": p.protocol,
                    "message": msg_text
                })
            except Exception as e:
                latency = round((time.perf_counter() - started) * 1000)
                results.append({
                    "provider": pid,
                    "model": m.id,
                    "ok": False,
                    "latencyMs": latency,
                    "protocol": p.protocol,
                    "error": str(e)
                })

    return {"results": results}

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
