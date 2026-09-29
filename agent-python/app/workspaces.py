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

