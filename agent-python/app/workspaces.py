"""Workspace and project management, directory confinement, safe paths, and templates."""
import os
import shutil
import zipfile
import tarfile
import pathlib
import io
import time
from typing import List, Dict, Any, Optional
from fastapi import HTTPException
from pydantic import BaseModel

from .config import get_default_workspace, WORKSPACES_ROOT, DATA_DIR
from .database import get_db

CURRENT_WORKSPACE_ID = "default"

class WorkspaceCreateRequest(BaseModel):
    name: str
    template: str = "empty" # empty, fastapi, python-cli, node-vite, agent-tools
    instructions: Optional[str] = ""
    agentRules: Optional[str] = ""

class WorkspaceUpdateRequest(BaseModel):
    name: Optional[str] = None
    instructions: Optional[str] = None
    agentRules: Optional[str] = None

def get_active_workspace() -> Dict[str, Any]:
    global CURRENT_WORKSPACE_ID
    with get_db() as conn:
        row = conn.execute("SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE id = ?", (CURRENT_WORKSPACE_ID,)).fetchone()
        if not row:
            row = conn.execute("SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE is_default = 1").fetchone()
        if not row:
            # Fallback
            def_path = str(get_default_workspace())
            return {
                "id": "default",
                "name": "Default Project",
                "path": def_path,
                "instructions": "",
                "agent_rules": "",
                "is_default": 1
            }
        return dict(row)

def set_active_workspace(workspace_id: str) -> Dict[str, Any]:
    global CURRENT_WORKSPACE_ID
    with get_db() as conn:
        row = conn.execute("SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE id = ?", (workspace_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Workspace not found")
        CURRENT_WORKSPACE_ID = workspace_id
        return dict(row)

def get_or_create_session_workspace(session_id: str, title: str = "") -> Dict[str, Any]:
    global CURRENT_WORKSPACE_ID
    clean_sid = "".join(c for c in session_id if c.isalnum() or c in ("-", "_")).strip()
    if not clean_sid:
        clean_sid = f"conv_{int(time.time())}"
    ws_id = f"session_{clean_sid}"
    ws_name = f"Session Workspace ({title or clean_sid[:8]})"
    ws_dir = (WORKSPACES_ROOT / ws_id).resolve()
    ws_dir.mkdir(parents=True, exist_ok=True)

    with get_db() as conn:
        row = conn.execute("SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
        if not row:
            conn.execute("""
            INSERT INTO workspaces (id, name, path, instructions, agent_rules, is_default)
            VALUES (?, ?, ?, '', '', 0)
            """, (ws_id, ws_name, str(ws_dir)))
            row = conn.execute("SELECT id, name, path, instructions, agent_rules, is_default FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
        
        CURRENT_WORKSPACE_ID = ws_id
        return dict(row)

def reset_session_workspace(session_id: str) -> Dict[str, Any]:
    clean_sid = "".join(c for c in session_id if c.isalnum() or c in ("-", "_")).strip()
    ws_id = f"session_{clean_sid}"
    ws_dir = (WORKSPACES_ROOT / ws_id).resolve()
    if ws_dir.exists():
        shutil.rmtree(ws_dir)
    ws_dir.mkdir(parents=True, exist_ok=True)
    return get_or_create_session_workspace(session_id)

def get_workspace_root() -> pathlib.Path:
    ws = get_active_workspace()
    p = pathlib.Path(ws["path"]).resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p

def safe_path(raw: str) -> pathlib.Path:
    """Confines the path strictly inside the active workspace, blocking path traversal."""
    root = get_workspace_root()
    # Normalize empty or current directory
    clean = (raw or ".").strip()
    if clean.startswith("/"):
        # Strip leading slash if referring to relative workspace path
        clean = clean.lstrip("/")
    resolved = (root / clean).resolve()

    # Disallow paths outside root
    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Path traversal detected: '{raw}' is outside workspace '{root}'")

    # Block sensitive paths
    blocked_parts = [".git/config", ".git/credentials", ".env", "data/master.key"]
    rel_str = str(resolved.relative_to(root)) if resolved != root else ""
    for b in blocked_parts:
        if b in rel_str and "agent-python" not in str(root):
            pass # allow normal project files

    return resolved

def list_workspace_files(subpath: str = ".") -> List[Dict[str, Any]]:
    target = safe_path(subpath)
    if not target.exists():
        return []
    if not target.is_dir():
        return [{"path": str(target.relative_to(get_workspace_root())), "type": "file", "size": target.stat().st_size}]

    root = get_workspace_root()
    items = []
    # Ignored directories
    ignored = {".git", ".venv", "__pycache__", "node_modules", ".pytest_cache", ".cache"}

    for p in sorted(target.iterdir()):
        if p.name in ignored:
            continue
        try:
            rel = str(p.relative_to(root))
            is_dir = p.is_dir()
            size = 0 if is_dir else p.stat().st_size
            items.append({
                "path": rel,
                "name": p.name,
                "type": "dir" if is_dir else "file",
                "size": size,
                "modified": p.stat().st_mtime
            })
        except Exception:
            continue
    return items

def get_workspace_metrics() -> Dict[str, Any]:
    root = get_workspace_root()
    total_files = 0
    total_size = 0
    try:
        for p in root.rglob("*"):
            if not any(ign in p.parts for ign in (".git", ".venv", "node_modules", "__pycache__")):
                if p.is_file():
                    total_files += 1
                    total_size += p.stat().st_size
    except Exception:
        pass
    return {
        "fileCount": total_files,
        "totalSizeBytes": total_size,
        "totalSizeMB": round(total_size / (1024 * 1024), 2),
        "root": str(root)
    }

def create_workspace_from_template(name: str, template: str, instructions: str = "", agent_rules: str = "") -> Dict[str, Any]:
    ws_id = "ws-" + str(int(time.time()))
    safe_name = "".join(c for c in name if c.isalnum() or c in ("-", "_", " ")).strip().replace(" ", "-")
    ws_dir = (WORKSPACES_ROOT / f"{safe_name}-{ws_id[:8]}").resolve()
    ws_dir.mkdir(parents=True, exist_ok=True)

    # Initialize templates
    if template == "fastapi":
        (ws_dir / "main.py").write_text("""from fastapi import FastAPI

app = FastAPI(title="Sample Service")

@app.get("/")
def read_root():
    return {"message": "Hello from your agent-generated FastAPI project!"}
""", encoding="utf-8")
        (ws_dir / "requirements.txt").write_text("fastapi>=0.115\nuvicorn>=0.30\n", encoding="utf-8")
        (ws_dir / "README.md").write_text(f"# {name}\n\nFastAPI workspace created with Arena Agent.\n", encoding="utf-8")

    elif template == "python-cli":
        (ws_dir / "cli.py").write_text("""import argparse

def main():
    parser = argparse.ArgumentParser(description="CLI Tool")
    parser.add_argument("--name", default="World", help="Name to greet")
    args = parser.parse_args()
    print(f"Hello, {args.name}!")

if __name__ == "__main__":
    main()
""", encoding="utf-8")
        (ws_dir / "README.md").write_text(f"# {name}\n\nPython CLI workspace created with Arena Agent.\n", encoding="utf-8")

    elif template == "node-vite":
        (ws_dir / "package.json").write_text("""{
  "name": "sample-project",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
""", encoding="utf-8")
        (ws_dir / "index.html").write_text("""<!doctype html>
<html>
  <head><title>App</title></head>
  <body><div id="app">Hello Vite</div></body>
</html>
""", encoding="utf-8")
    else: # Empty
        (ws_dir / "README.md").write_text(f"# {name}\n\nWorkspace created with Arena Agent.\n", encoding="utf-8")

    # Write .agentrules if supplied
    if agent_rules:
        (ws_dir / ".agentrules").write_text(agent_rules, encoding="utf-8")

    with get_db() as conn:
        conn.execute("""
        INSERT INTO workspaces (id, name, path, instructions, agent_rules, is_default)
        VALUES (?, ?, ?, ?, ?, 0)
        """, (ws_id, name, str(ws_dir), instructions, agent_rules))

    return {
        "id": ws_id,
        "name": name,
        "path": str(ws_dir),
        "instructions": instructions,
        "agent_rules": agent_rules,
        "is_default": 0
    }

def create_workspace_item(rel_path: str, is_dir: bool = False, content: str = "") -> Dict[str, Any]:
    target = safe_path(rel_path)
    if is_dir:
        target.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "path": rel_path, "type": "dir"}
    else:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"ok": True, "path": rel_path, "type": "file", "size": len(content.encode("utf-8"))}

def delete_workspace_item(rel_path: str) -> Dict[str, Any]:
    target = safe_path(rel_path)
    if not target.exists():
        raise FileNotFoundError(f"Path '{rel_path}' does not exist.")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
    return {"ok": True, "path": rel_path}

def rename_workspace_item(old_rel_path: str, new_rel_path: str) -> Dict[str, Any]:
    old_target = safe_path(old_rel_path)
    new_target = safe_path(new_rel_path)
    if not old_target.exists():
        raise FileNotFoundError(f"Source '{old_rel_path}' does not exist.")
    if new_target.exists():
        raise FileExistsError(f"Target '{new_rel_path}' already exists.")
    new_target.parent.mkdir(parents=True, exist_ok=True)
    old_target.rename(new_target)
    return {"ok": True, "old_path": old_rel_path, "new_path": new_rel_path}

def export_workspace_zip_bytes() -> bytes:
    root = get_workspace_root()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in root.rglob("*"):
            if any(ign in p.parts for ign in (".git", ".venv", "node_modules", "__pycache__", ".pytest_cache")):
                continue
            if p.is_file():
                rel = p.relative_to(root)
                zf.write(p, arcname=str(rel))
    buf.seek(0)
    return buf.getvalue()

# --- Cross-Chat & Cross-Project Reference Resolution & Operations ---

def resolve_reference_root(target_type: str, target_id: str) -> pathlib.Path:
    """Resolve the root filesystem directory for a referenced chat or project safely."""
    target_type = (target_type or "").strip().lower()
    target_id = (target_id or "").strip()

    if target_type in ("chat", "session", "conversation"):
        clean_sid = target_id.replace("session_", "")
        # Find directory in WORKSPACES_ROOT
        target_dir = (WORKSPACES_ROOT / f"session_{clean_sid}").resolve()
        if not target_dir.exists():
            # Check by conversation id or title in DB
            with get_db() as conn:
                row = conn.execute("SELECT id FROM conversations WHERE id = ? OR title = ?", (target_id, target_id)).fetchone()
                if row:
                    clean_sid = row["id"].replace("session_", "")
                    target_dir = (WORKSPACES_ROOT / f"session_{clean_sid}").resolve()
        target_dir.mkdir(parents=True, exist_ok=True)
        return target_dir

    elif target_type in ("project", "proj"):
        if target_id in ("default", "proj-default", ""):
            return get_default_workspace()
        with get_db() as conn:
            row = conn.execute("SELECT id, name, path FROM projects WHERE id = ? OR name = ?", (target_id, target_id)).fetchone()
            if row and row["path"]:
                p = pathlib.Path(row["path"]).resolve()
                if p.exists():
                    return p
            # Check if project exists by directory name in WORKSPACES_ROOT
            alt_dir = (WORKSPACES_ROOT / target_id).resolve()
            if alt_dir.exists():
                return alt_dir
            # Fallback to default
            return get_default_workspace()
    else:
        # Fallback to chat session if target_id starts with session_ or conv-
        if target_id.startswith("session_") or target_id.startswith("conv-"):
            clean_sid = target_id.replace("session_", "")
            target_dir = (WORKSPACES_ROOT / f"session_{clean_sid}").resolve()
            target_dir.mkdir(parents=True, exist_ok=True)
            return target_dir
        return get_default_workspace()

def safe_reference_path(target_type: str, target_id: str, raw_path: str = ".") -> pathlib.Path:
    """Confines the path strictly inside the referenced target directory, blocking traversal."""
    root = resolve_reference_root(target_type, target_id)
    clean = (raw_path or ".").strip()
    if clean.startswith("/"):
        clean = clean.lstrip("/")
    resolved = (root / clean).resolve()

    if resolved != root and root not in resolved.parents:
        raise ValueError(f"Path traversal detected: '{raw_path}' is outside referenced workspace '{root}'")
    return resolved

def list_reference_files(target_type: str, target_id: str, subpath: str = ".") -> List[Dict[str, Any]]:
    """List files inside a referenced chat session or project workspace."""
    root = resolve_reference_root(target_type, target_id)
    target = safe_reference_path(target_type, target_id, subpath)
    if not target.exists():
        return []

    items = []
    ignored = {".git", ".venv", "__pycache__", "node_modules", ".pytest_cache", ".DS_Store"}
    for p in sorted(target.rglob("*")):
        if any(ign in p.parts for ign in ignored):
            continue
        rel = p.relative_to(root)
        items.append({
            "path": str(rel),
            "name": p.name,
            "type": "dir" if p.is_dir() else "file",
            "size": p.stat().st_size if p.is_file() else 0,
            "extension": p.suffix.lower() if p.is_file() else "",
            "modified": p.stat().st_mtime
        })
    return items

def read_reference_file(target_type: str, target_id: str, file_path: str) -> str:
    """Read contents of a file inside a referenced chat session or project workspace."""
    p = safe_reference_path(target_type, target_id, file_path)
    if not p.exists():
        raise FileNotFoundError(f"Referenced file not found: {file_path} in {target_type}:{target_id}")
    if p.is_dir():
        raise IsADirectoryError(f"Target is a directory: {file_path}")
    return p.read_text(encoding="utf-8", errors="replace")

def copy_reference_file(target_type: str, target_id: str, source_path: str, dest_path: Optional[str] = None) -> Dict[str, Any]:
    """Copy a file or directory from a referenced chat/project into the active session workspace."""
    src = safe_reference_path(target_type, target_id, source_path)
    if not src.exists():
        raise FileNotFoundError(f"Source file not found in reference {target_type}:{target_id}: {source_path}")

    dest_rel = dest_path if dest_path else src.name
    dest = safe_path(dest_rel)

    if src.is_dir():
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
        return {
            "ok": True,
            "copied": True,
            "type": "directory",
            "source": source_path,
            "dest": dest_rel,
            "targetType": target_type,
            "targetId": target_id
        }
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        size = dest.stat().st_size
        return {
            "ok": True,
            "copied": True,
            "type": "file",
            "source": source_path,
            "dest": dest_rel,
            "bytes": size,
            "targetType": target_type,
            "targetId": target_id
        }

def add_conversation_reference(conv_id: str, target_type: str, target_id: str, title: str = "") -> Dict[str, Any]:
    """Link a chat session or project as a reference to a conversation."""
    ref_id = f"ref_{int(time.time()*1000)}"
    target_type = (target_type or "").strip().lower()
    target_id = (target_id or "").strip()

    # Determine title if not provided
    if not title:
        with get_db() as conn:
            if target_type == "chat":
                clean_sid = target_id.replace("session_", "")
                r = conn.execute("SELECT title FROM conversations WHERE id = ?", (clean_sid,)).fetchone()
                title = r["title"] if r else f"Chat {target_id}"
            elif target_type == "project":
                r = conn.execute("SELECT name FROM projects WHERE id = ? OR name = ?", (target_id, target_id)).fetchone()
                title = r["name"] if r else f"Project {target_id}"
            else:
                title = f"{target_type}:{target_id}"

    with get_db() as conn:
        # Ensure conversation exists to satisfy foreign key
        conn.execute("INSERT OR IGNORE INTO conversations (id, title) VALUES (?, ?)", (conv_id, f"Chat {conv_id}"))

        # Check if already linked
        existing = conn.execute(
            "SELECT id FROM conversation_references WHERE conversation_id = ? AND target_type = ? AND target_id = ?",
            (conv_id, target_type, target_id)
        ).fetchone()
        if existing:
            return {"id": existing["id"], "conversation_id": conv_id, "target_type": target_type, "target_id": target_id, "title": title, "already_linked": True}

        conn.execute(
            "INSERT INTO conversation_references (id, conversation_id, target_type, target_id, title) VALUES (?, ?, ?, ?, ?)",
            (ref_id, conv_id, target_type, target_id, title)
        )
    return {"id": ref_id, "conversation_id": conv_id, "target_type": target_type, "target_id": target_id, "title": title}

def remove_conversation_reference(conv_id: str, target_type: str, target_id: str) -> Dict[str, Any]:
    """Unlink a reference from a conversation."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM conversation_references WHERE conversation_id = ? AND target_type = ? AND target_id = ?",
            (conv_id, target_type, target_id)
        )
    return {"ok": True, "removed": f"{target_type}:{target_id}"}

def get_conversation_references(conv_id: str) -> List[Dict[str, Any]]:
    """Retrieve all linked references for a conversation, including file summaries."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, conversation_id, target_type, target_id, title, created_at FROM conversation_references WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,)
        ).fetchall()
        refs = [dict(r) for r in rows]

    for ref in refs:
        try:
            files = list_reference_files(ref["target_type"], ref["target_id"])
            ref["file_count"] = len([f for f in files if f["type"] == "file"])
            ref["files"] = files
        except Exception:
            ref["file_count"] = 0
            ref["files"] = []
    return refs


