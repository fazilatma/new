"""Comprehensive Git Integration and Workflow Engine."""
import os
import subprocess
import time
from typing import Dict, Any, List, Optional
from .workspaces import get_workspace_root, safe_path

def run_git_cmd(args: List[str], cwd: Optional[str] = None) -> Dict[str, Any]:
    ws_root = cwd or str(get_workspace_root())
    cmd = ["git"] + args
    try:
        r = subprocess.run(
            cmd,
            cwd=ws_root,
            text=True,
            capture_output=True,
            timeout=60,
            env=os.environ
        )
        return {
            "ok": r.returncode == 0,
            "exitCode": r.returncode,
            "stdout": r.stdout,
            "stderr": r.stderr,
            "cmd": " ".join(cmd)
        }
    except Exception as e:
        return {
            "ok": False,
            "exitCode": -1,
            "stdout": "",
            "stderr": str(e),
            "cmd": " ".join(cmd)
        }

def get_git_status() -> Dict[str, Any]:
    # Check if git repo
    r = run_git_cmd(["status", "--porcelain", "-b"])
    if not r["ok"]:
        return {"isRepo": False, "branch": "", "files": [], "raw": r["stderr"]}

    lines = r["stdout"].splitlines()
    branch_line = lines[0] if lines else ""
    branch_name = "unknown"
    ahead = 0
    behind = 0

    if branch_line.startswith("## "):
        b_info = branch_line[3:]
        if "..." in b_info:
            parts = b_info.split("...")
            branch_name = parts[0]
            if "[" in parts[1]:
                meta = parts[1].split("[")[1].rstrip("]")
                for m in meta.split(","):
                    m = m.strip()
                    if m.startswith("ahead "):
                        ahead = int(m.split()[1])
                    elif m.startswith("behind "):
                        behind = int(m.split()[1])
        else:
            branch_name = b_info.split()[0]

    files = []
    for l in lines[1:]:
        if len(l) >= 4:
            staged_code = l[0]
            unstaged_code = l[1]
            filepath = l[3:].strip()
            files.append({
                "path": filepath,
                "staged": staged_code not in (" ", "?"),
                "status": l[:2].strip()
            })

    return {
        "isRepo": True,
        "branch": branch_name,
        "ahead": ahead,
        "behind": behind,
        "files": files,
        "raw": r["stdout"]
    }

def get_git_diff(staged_only: bool = False, file_path: Optional[str] = None) -> Dict[str, Any]:
    args = ["diff"]
    if staged_only:
        args.append("--staged")
    if file_path:
        args.append("--")
        args.append(file_path)
    res = run_git_cmd(args)
    stat_res = run_git_cmd(["diff", "--stat"] + (["--staged"] if staged_only else []))
    return {
        "diff": res["stdout"],
        "stat": stat_res["stdout"],
        "ok": res["ok"]
    }

def list_branches() -> Dict[str, Any]:
    r = run_git_cmd(["branch", "-a"])
    if not r["ok"]:
        return {"branches": [], "current": ""}
    branches = []
    current = ""
    for line in r["stdout"].splitlines():
        line = line.strip()
        if not line:
            continue
        is_curr = line.startswith("*")
        name = line.lstrip("* ").strip()
        if " -> " in name:
            name = name.split(" -> ")[0]
        branches.append({"name": name, "current": is_curr, "remote": name.startswith("remotes/")})
        if is_curr:
            current = name
    return {"branches": branches, "current": current}

def create_branch(name: str, checkout: bool = True) -> Dict[str, Any]:
    args = ["checkout", "-b", name] if checkout else ["branch", name]
    return run_git_cmd(args)

def switch_branch(name: str) -> Dict[str, Any]:
    # If remote branch, checkout appropriately
    clean_name = name.replace("remotes/origin/", "")
    return run_git_cmd(["checkout", clean_name])

def rename_branch(old_name: str, new_name: str) -> Dict[str, Any]:
    return run_git_cmd(["branch", "-m", old_name, new_name])

def delete_branch(name: str, force: bool = False) -> Dict[str, Any]:
    flag = "-D" if force else "-d"
    return run_git_cmd(["branch", flag, name])

def git_fetch(remote: str = "origin") -> Dict[str, Any]:
    return run_git_cmd(["fetch", remote])

def git_pull(remote: str = "origin", branch: str = "") -> Dict[str, Any]:
    args = ["pull", remote]
    if branch:
        args.append(branch)
    return run_git_cmd(args)

def git_push(remote: str = "origin", branch: str = "", force: bool = False, approved: bool = False) -> Dict[str, Any]:
    if not approved:
        raise ValueError("Git push operations require explicit approval.")
    args = ["push", remote]
    if branch:
        args.append(branch)
    if force:
        args.append("--force")
    return run_git_cmd(args)

def git_commit(message: str, approved: bool = False) -> Dict[str, Any]:
    if not approved:
        raise ValueError("Commit operations require explicit approval.")
    if not message.strip():
        raise ValueError("Commit message cannot be empty.")
    # Stage all and commit
    run_git_cmd(["add", "-A"])
    return run_git_cmd(["commit", "-m", message])

def list_commit_history(limit: int = 50) -> List[Dict[str, Any]]:
    fmt = "%H|%h|%an|%ae|%at|%s"
    r = run_git_cmd(["log", f"-n{limit}", f"--pretty=format:{fmt}"])
    if not r["ok"]:
        return []
    commits = []
    for line in r["stdout"].splitlines():
        parts = line.split("|")
        if len(parts) >= 6:
            commits.append({
                "hash": parts[0],
                "shortHash": parts[1],
                "author": parts[2],
                "email": parts[3],
                "timestamp": int(parts[4]),
                "date": time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(int(parts[4]))),
                "message": parts[5]
            })
    return commits

def get_commit_details(commit_hash: str) -> Dict[str, Any]:
    show_r = run_git_cmd(["show", "--stat", "--patch", commit_hash])
    files_r = run_git_cmd(["diff-tree", "--no-commit-id", "--name-only", "-r", commit_hash])
    return {
        "hash": commit_hash,
        "details": show_r["stdout"],
        "files": [f for f in files_r["stdout"].splitlines() if f]
    }

def git_cherry_pick(commit_hash: str) -> Dict[str, Any]:
    return run_git_cmd(["cherry-pick", commit_hash])

def git_revert(commit_hash: str) -> Dict[str, Any]:
    return run_git_cmd(["revert", "--no-edit", commit_hash])

def git_merge(branch: str) -> Dict[str, Any]:
    return run_git_cmd(["merge", branch])

def list_stashes() -> List[Dict[str, Any]]:
    r = run_git_cmd(["stash", "list"])
    if not r["ok"]:
        return []
    stashes = []
    for line in r["stdout"].splitlines():
        if ":" in line:
            parts = line.split(":", 2)
            stashes.append({
                "id": parts[0].strip(),
                "branch": parts[1].strip() if len(parts) > 1 else "",
                "message": parts[2].strip() if len(parts) > 2 else ""
            })
    return stashes

def git_stash_save(message: str = "") -> Dict[str, Any]:
    args = ["stash", "push"]
    if message:
        args.extend(["-m", message])
    return run_git_cmd(args)

def git_stash_apply(stash_id: str = "stash@{0}") -> Dict[str, Any]:
    return run_git_cmd(["stash", "apply", stash_id])

def list_remotes() -> List[Dict[str, str]]:
    r = run_git_cmd(["remote", "-v"])
    if not r["ok"]:
        return []
    remotes = {}
    for line in r["stdout"].splitlines():
        parts = line.split()
        if len(parts) >= 2:
            remotes[parts[0]] = parts[1]
    return [{"name": k, "url": v} for k, v in remotes.items()]

def get_merge_conflicts() -> List[Dict[str, Any]]:
    st = get_git_status()
    conflicts = []
    ws_root = get_workspace_root()
    for f in st.get("files", []):
        if "U" in f.get("status", ""):
            p = safe_path(f["path"])
            if p.exists():
                content = p.read_text(encoding="utf-8", errors="replace")
                conflicts.append({
                    "path": f["path"],
                    "hasMarkers": "<<<<<<<" in content,
                    "content": content
                })
    return conflicts

def resolve_conflict_file(rel_path: str, resolution_mode: str, custom_content: Optional[str] = None) -> Dict[str, Any]:
    p = safe_path(rel_path)
    if resolution_mode == "ours":
        run_git_cmd(["checkout", "--ours", rel_path])
        run_git_cmd(["add", rel_path])
    elif resolution_mode == "theirs":
        run_git_cmd(["checkout", "--theirs", rel_path])
        run_git_cmd(["add", rel_path])
    elif resolution_mode == "custom" and custom_content is not None:
        p.write_text(custom_content, encoding="utf-8")
        run_git_cmd(["add", rel_path])
    else:
        raise ValueError("Invalid resolution mode")
    return {"ok": True, "path": rel_path, "mode": resolution_mode}
