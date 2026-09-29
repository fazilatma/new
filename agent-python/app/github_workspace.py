"""Full GitHub Workspace Connector, Pull Requests, Reviews, Issues, and Actions."""
import os
import httpx
import base64
from typing import Dict, Any, List, Optional
from fastapi import HTTPException
from pydantic import BaseModel
from .config import get_raw_config

GITHUB_API_BASE = "https://api.github.com"

def get_github_token() -> str:
    token = get_raw_config("GITHUB_TOKEN")
    if not token:
        raise HTTPException(status_code=400, detail="GITHUB_TOKEN is not configured in Environment settings.")
    return token

def get_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {get_github_token()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Arena-Agent-Workspace/1.0"
    }

async def github_api_get(path: str, params: Optional[Dict[str, Any]] = None) -> Any:
    url = f"{GITHUB_API_BASE}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=get_headers(), params=params)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.json().get("message", r.text))
        return r.json()

async def github_api_post(path: str, json_data: Dict[str, Any]) -> Any:
    url = f"{GITHUB_API_BASE}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, headers=get_headers(), json=json_data)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.json().get("message", r.text))
        return r.json()

async def github_api_put(path: str, json_data: Dict[str, Any]) -> Any:
    url = f"{GITHUB_API_BASE}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.put(url, headers=get_headers(), json=json_data)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.json().get("message", r.text))
        return r.json()

async def github_api_delete(path: str, json_data: Optional[Dict[str, Any]] = None) -> Any:
    url = f"{GITHUB_API_BASE}/{path.lstrip('/')}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.request("DELETE", url, headers=get_headers(), json=json_data)
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.json().get("message", r.text))
        return {"ok": True}

# GitHub Workspace Operations
async def get_github_user() -> Dict[str, Any]:
    return await github_api_get("user")

async def list_user_repos(per_page: int = 100, sort: str = "updated") -> List[Dict[str, Any]]:
    return await github_api_get("user/repos", params={"per_page": per_page, "sort": sort})

async def list_repo_branches(owner: str, repo: str) -> List[Dict[str, Any]]:
    return await github_api_get(f"repos/{owner}/{repo}/branches")

async def get_repo_tree(owner: str, repo: str, branch: str = "main") -> Dict[str, Any]:
    # Get branch commit tree
    branch_data = await github_api_get(f"repos/{owner}/{repo}/branches/{branch}")
    tree_sha = branch_data["commit"]["commit"]["tree"]["sha"]
    return await github_api_get(f"repos/{owner}/{repo}/git/trees/{tree_sha}?recursive=1")

async def get_repo_file(owner: str, repo: str, path: str, ref: Optional[str] = None) -> Dict[str, Any]:
    params = {"ref": ref} if ref else {}
    data = await github_api_get(f"repos/{owner}/{repo}/contents/{path}", params=params)
    if isinstance(data, dict) and data.get("content"):
        try:
            content = base64.b64decode(data["content"]).decode("utf-8")
        except Exception:
            content = data["content"]
        data["decoded_content"] = content
    return data

async def create_or_update_repo_file(owner: str, repo: str, path: str, content: str, message: str, branch: str = "main", sha: Optional[str] = None) -> Dict[str, Any]:
    b64_content = base64.b64encode(content.encode("utf-8")).decode("utf-8")
    payload = {
        "message": message,
        "content": b64_content,
        "branch": branch
    }
    if sha:
        payload["sha"] = sha
    return await github_api_put(f"repos/{owner}/{repo}/contents/{path}", json_data=payload)

async def delete_repo_file(owner: str, repo: str, path: str, message: str, sha: str, branch: str = "main") -> Dict[str, Any]:
    payload = {
        "message": message,
        "sha": sha,
        "branch": branch
    }
    return await github_api_delete(f"repos/{owner}/{repo}/contents/{path}", json_data=payload)

# Pull Requests
async def list_pull_requests(owner: str, repo: str, state: str = "open") -> List[Dict[str, Any]]:
    return await github_api_get(f"repos/{owner}/{repo}/pulls", params={"state": state})

async def get_pull_request(owner: str, repo: str, pull_number: int) -> Dict[str, Any]:
    return await github_api_get(f"repos/{owner}/{repo}/pulls/{pull_number}")

async def create_pull_request(owner: str, repo: str, title: str, head: str, base: str, body: str = "") -> Dict[str, Any]:
    return await github_api_post(f"repos/{owner}/{repo}/pulls", json_data={"title": title, "head": head, "base": base, "body": body})

async def merge_pull_request(owner: str, repo: str, pull_number: int, merge_method: str = "merge", commit_title: str = "") -> Dict[str, Any]:
    payload = {"merge_method": merge_method}
    if commit_title:
        payload["commit_title"] = commit_title
    return await github_api_put(f"repos/{owner}/{repo}/pulls/{pull_number}/merge", json_data=payload)

async def create_pr_review(owner: str, repo: str, pull_number: int, event: str, body: str = "") -> Dict[str, Any]:
    # event: APPROVE, REQUEST_CHANGES, COMMENT
    return await github_api_post(f"repos/{owner}/{repo}/pulls/{pull_number}/reviews", json_data={"event": event, "body": body})

# Actions & Workflows
async def list_workflow_runs(owner: str, repo: str) -> Dict[str, Any]:
    return await github_api_get(f"repos/{owner}/{repo}/actions/runs?per_page=20")

async def rerun_workflow_run(owner: str, repo: str, run_id: int) -> Dict[str, Any]:
    return await github_api_post(f"repos/{owner}/{repo}/actions/runs/{run_id}/rerun", json_data={})

# Issues
async def list_issues(owner: str, repo: str, state: str = "open") -> List[Dict[str, Any]]:
    return await github_api_get(f"repos/{owner}/{repo}/issues", params={"state": state})

async def create_issue(owner: str, repo: str, title: str, body: str = "", labels: Optional[List[str]] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"title": title, "body": body}
    if labels:
        payload["labels"] = labels
    return await github_api_post(f"repos/{owner}/{repo}/issues", json_data=payload)

async def add_issue_comment(owner: str, repo: str, issue_number: int, body: str) -> Dict[str, Any]:
    return await github_api_post(f"repos/{owner}/{repo}/issues/{issue_number}/comments", json_data={"body": body})
