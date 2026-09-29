"""Agent Tools execution engine with change set approval enforcement and workspace security."""
import os
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

from .workspaces import (
    safe_path, list_workspace_files, get_workspace_root, get_active_workspace,
    list_reference_files, read_reference_file, copy_reference_file
)
from .config import is_file_approval_required
from .changesets import create_changeset, save_file_version_snapshot, compute_diff
from .terminal_sandbox import execute_sandboxed_command
from .git_manager import get_git_status, get_git_diff, git_commit
from .browser_automation import BROWSER_MANAGER

def _parse_prefixed_reference(path: str):
    raw = path.strip()
    if raw.startswith("@chat:"):
        rest = raw[6:]
        parts = rest.split("/", 1)
        target_id = parts[0]
        subpath = parts[1] if len(parts) > 1 else "."
        return "chat", target_id, subpath
    elif raw.startswith("@project:") or raw.startswith("@proj:"):
        prefix_len = 9 if raw.startswith("@project:") else 6
        rest = raw[prefix_len:]
        parts = rest.split("/", 1)
        target_id = parts[0]
        subpath = parts[1] if len(parts) > 1 else "."
        return "project", target_id, subpath
    return None

def agent_list_files(path: str = ".") -> List[Dict[str, Any]]:
    ref = _parse_prefixed_reference(path)
    if ref:
        target_type, target_id, subpath = ref
        return list_reference_files(target_type, target_id, subpath)
    return list_workspace_files(path)

def agent_read_file(path: str) -> str:
    ref = _parse_prefixed_reference(path)
    if ref:
        target_type, target_id, subpath = ref
        return read_reference_file(target_type, target_id, subpath)

    p = safe_path(path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")
    if p.is_dir():
        raise IsADirectoryError(f"Target is a directory: {path}")
    return p.read_text(encoding="utf-8", errors="replace")

def agent_list_referenced_files(target_type: str, target_id: str, path: str = ".") -> List[Dict[str, Any]]:
    return list_reference_files(target_type, target_id, path)

def agent_read_referenced_file(target_type: str, target_id: str, path: str) -> str:
    return read_reference_file(target_type, target_id, path)

def agent_copy_referenced_file(target_type: str, target_id: str, source_path: str, dest_path: Optional[str] = None) -> Dict[str, Any]:
    return copy_reference_file(target_type, target_id, source_path, dest_path)

def agent_write_file(path: str, content: str, require_approval: Optional[bool] = None) -> Dict[str, Any]:
    rel_path = path.strip().lstrip("/")
    target = safe_path(rel_path)

    approval_needed = is_file_approval_required() if require_approval is None else require_approval

    if approval_needed:
        # Create ChangeSet for User Approval
        cs = create_changeset(
            title=f"Agent edit: {rel_path}",
            files=[{"path": rel_path, "new_content": content, "change_type": "modified" if target.exists() else "added"}],
            created_by="agent"
        )
        return {
            "status": "pending_approval",
            "requiresApproval": True,
            "changesetId": cs["id"],
            "path": rel_path,
            "diff": cs["files"][0]["diff"] if cs["files"] else "",
            "message": f"Change to '{rel_path}' is staged in ChangeSet {cs['id']} and requires user approval before applying."
        }

    # Direct write (with historical snapshot backup)
    ws_id = get_active_workspace()["id"]
    old_content = target.read_text(encoding="utf-8") if target.exists() else ""
    if target.exists():
        save_file_version_snapshot(ws_id, rel_path, old_content, created_by="before-direct-write")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    save_file_version_snapshot(ws_id, rel_path, content, created_by="agent-direct")

    return {
        "status": "applied",
        "path": rel_path,
        "bytes": len(content.encode("utf-8")),
        "message": f"File '{rel_path}' saved successfully."
    }

def agent_run_command(command: str, cwd: str = ".", timeout: int = 60, confirmed_dangerous: bool = False) -> Dict[str, Any]:
    return execute_sandboxed_command(command, cwd=cwd, timeout=timeout, confirmed_dangerous=confirmed_dangerous)

AGENT_TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "list_files",
            "description": "List files and directories in the active project workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Subdirectory to list (defaults to workspace root '.')."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read text content of a workspace file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative file path inside the workspace."}
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write or update a file in the workspace. Staged for diff approval if approval is enabled.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative file path inside the workspace."},
                    "content": {"type": "string", "description": "Complete file content to write."}
                },
                "required": ["path", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "Execute a shell command inside the sandboxed workspace environment.",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to run (e.g. pytest, npm test, python script.py)."},
                    "cwd": {"type": "string", "description": "Working directory relative to workspace root (defaults to '.')."},
                    "timeout": {"type": "integer", "description": "Timeout in seconds (max 300)."}
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": "Navigate to a web page and retrieve its text content and DOM structure.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "HTTP or HTTPS URL to load."}
                },
                "required": ["url"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_status",
            "description": "Get current Git repository status, changed files, and active branch.",
            "parameters": {"type": "object", "properties": {}, "required": []}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "git_diff",
            "description": "Get current Git working tree diff.",
            "parameters": {
                "type": "object",
                "properties": {
                    "staged_only": {"type": "boolean", "description": "Whether to show only staged diff."}
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_referenced_files",
            "description": "List files from another referenced chat session or project workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_type": {"type": "string", "enum": ["chat", "project"], "description": "Type of target to list ('chat' or 'project')."},
                    "target_id": {"type": "string", "description": "Chat session ID/title or Project ID/name."},
                    "path": {"type": "string", "description": "Subdirectory to list (defaults to root '.')."}
                },
                "required": ["target_type", "target_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_referenced_file",
            "description": "Read the complete text content of a file from a referenced chat session or project workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_type": {"type": "string", "enum": ["chat", "project"], "description": "Type of target ('chat' or 'project')."},
                    "target_id": {"type": "string", "description": "Chat session ID/title or Project ID/name."},
                    "path": {"type": "string", "description": "Relative path of file in that referenced workspace."}
                },
                "required": ["target_type", "target_id", "path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "copy_referenced_file",
            "description": "Copy a file or directory from a referenced chat session or project workspace into the active session workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "target_type": {"type": "string", "enum": ["chat", "project"], "description": "Type of target ('chat' or 'project')."},
                    "target_id": {"type": "string", "description": "Chat session ID/title or Project ID/name."},
                    "source_path": {"type": "string", "description": "Path in the referenced workspace to copy from."},
                    "dest_path": {"type": "string", "description": "Optional destination path in active workspace (defaults to same filename)."}
                },
                "required": ["target_type", "target_id", "source_path"]
            }
        }
    }
]

async def execute_agent_tool(name: str, args: Dict[str, Any]) -> Any:
    if name == "list_files":
        return agent_list_files(args.get("path", "."))
    elif name == "read_file":
        return agent_read_file(args["path"])
    elif name == "write_file":
        return agent_write_file(args["path"], args.get("content", ""))
    elif name == "list_referenced_files":
        return agent_list_referenced_files(args["target_type"], args["target_id"], args.get("path", "."))
    elif name == "read_referenced_file":
        return agent_read_referenced_file(args["target_type"], args["target_id"], args["path"])
    elif name == "copy_referenced_file":
        return agent_copy_referenced_file(args["target_type"], args["target_id"], args["source_path"], args.get("dest_path"))
    elif name == "run_command":
        return agent_run_command(args["command"], args.get("cwd", "."), args.get("timeout", 60), args.get("confirmed", False))
    elif name == "browser_navigate":
        return await BROWSER_MANAGER.navigate(args["url"])
    elif name == "git_status":
        return get_git_status()
    elif name == "git_diff":
        return get_git_diff(staged_only=args.get("staged_only", False))
    else:
        raise ValueError(f"Unknown agent tool: {name}")
