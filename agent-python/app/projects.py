"""Project Management and Configuration Engine."""
import os
import json
import time
import uuid
from pathlib import Path
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field
from fastapi import HTTPException

from .database import get_db
from .config import DATA_DIR, get_default_workspace

ACTIVE_PROJECT_ID = "proj-default"

class ProjectCreateRequest(BaseModel):
    name: str
    description: Optional[str] = ""
    path: Optional[str] = None
    gitUrl: Optional[str] = ""
    defaultBranch: Optional[str] = "main"
    defaultProvider: Optional[str] = "openrouter"
    defaultModel: Optional[str] = ""
    codeGenerationMode: Optional[str] = "smart-auto"
    instructions: Optional[str] = ""
    agentRules: Optional[str] = ""
    envVars: Optional[Dict[str, str]] = Field(default_factory=dict)
    customCommands: Optional[List[Dict[str, str]]] = Field(default_factory=list)

class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    path: Optional[str] = None
    gitUrl: Optional[str] = None
    defaultBranch: Optional[str] = None
    defaultProvider: Optional[str] = None
    defaultModel: Optional[str] = None
    codeGenerationMode: Optional[str] = None
    instructions: Optional[str] = None
    agentRules: Optional[str] = None
    envVars: Optional[Dict[str, str]] = None
    customCommands: Optional[List[Dict[str, str]]] = None

def _format_project_row(r) -> Dict[str, Any]:
    d = dict(r)
    d["code_generation_mode"] = d.get("code_generation_mode") or "smart-auto"
    try:
        d["env_vars"] = json.loads(d.get("env_vars") or "{}")
    except Exception:
        d["env_vars"] = {}
    try:
        d["custom_commands"] = json.loads(d.get("custom_commands") or "[]")
    except Exception:
        d["custom_commands"] = []
    return d

def get_active_project() -> Dict[str, Any]:
    global ACTIVE_PROJECT_ID
    with get_db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (ACTIVE_PROJECT_ID,)).fetchone()
        if not row:
            row = conn.execute("SELECT * FROM projects WHERE is_default = 1").fetchone()
        if not row:
            row = conn.execute("SELECT * FROM projects ORDER BY created_at ASC LIMIT 1").fetchone()
        if row:
            ACTIVE_PROJECT_ID = row["id"]
            return _format_project_row(row)

    # Fallback
    def_path = str(get_default_workspace())
    return {
        "id": "proj-default",
        "name": "Default Project",
        "description": "Primary coding workspace",
        "path": def_path,
        "git_url": "",
        "default_branch": "main",
        "default_provider": "openrouter",
        "default_model": "",
        "code_generation_mode": "smart-auto",
        "instructions": "",
        "agent_rules": "",
        "env_vars": {},
        "custom_commands": [],
        "is_default": 1
    }

def set_active_project(project_id: str) -> Dict[str, Any]:
    global ACTIVE_PROJECT_ID
    with get_db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Project not found")
        # Update is_default flags
        conn.execute("UPDATE projects SET is_default = 0")
        conn.execute("UPDATE projects SET is_default = 1, updated_at = datetime('now') WHERE id = ?", (project_id,))
        ACTIVE_PROJECT_ID = project_id
        return _format_project_row(row)

def list_projects() -> List[Dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM projects ORDER BY is_default DESC, created_at DESC").fetchall()
        return [_format_project_row(r) for r in rows]

def get_project(project_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not row:
            return None
        return _format_project_row(row)

def create_project(data: ProjectCreateRequest) -> Dict[str, Any]:
    proj_id = f"proj-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    proj_path = data.path or str(get_default_workspace())
    code_mode = data.codeGenerationMode or "smart-auto"

    Path(proj_path).mkdir(parents=True, exist_ok=True)

    with get_db() as conn:
        conn.execute("""
        INSERT INTO projects (
            id, name, description, path, git_url, default_branch, default_provider,
            default_model, code_generation_mode, instructions, agent_rules, env_vars, custom_commands, is_default
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        """, (
            proj_id,
            data.name.strip(),
            data.description or "",
            proj_path,
            data.gitUrl or "",
            data.defaultBranch or "main",
            data.defaultProvider or "openrouter",
            data.defaultModel or "",
            code_mode,
            data.instructions or "",
            data.agentRules or "",
            json.dumps(data.envVars or {}, ensure_ascii=False),
            json.dumps(data.customCommands or [], ensure_ascii=False)
        ))
    return get_project(proj_id)

def update_project(project_id: str, data: ProjectUpdateRequest) -> Dict[str, Any]:
    current = get_project(project_id)
    if not current:
        raise HTTPException(status_code=404, detail="Project not found")

    name = data.name if data.name is not None else current["name"]
    description = data.description if data.description is not None else current["description"]
    path = data.path if data.path is not None else current["path"]
    git_url = data.gitUrl if data.gitUrl is not None else current["git_url"]
    default_branch = data.defaultBranch if data.defaultBranch is not None else current["default_branch"]
    default_provider = data.defaultProvider if data.defaultProvider is not None else current["default_provider"]
    default_model = data.defaultModel if data.defaultModel is not None else current["default_model"]
    code_mode = data.codeGenerationMode if data.codeGenerationMode is not None else current.get("code_generation_mode", "smart-auto")
    instructions = data.instructions if data.instructions is not None else current["instructions"]
    agent_rules = data.agentRules if data.agentRules is not None else current["agent_rules"]
    env_vars = json.dumps(data.envVars if data.envVars is not None else current["env_vars"], ensure_ascii=False)
    custom_commands = json.dumps(data.customCommands if data.customCommands is not None else current["custom_commands"], ensure_ascii=False)

    with get_db() as conn:
        conn.execute("""
        UPDATE projects SET
            name = ?, description = ?, path = ?, git_url = ?, default_branch = ?,
            default_provider = ?, default_model = ?, code_generation_mode = ?, instructions = ?, agent_rules = ?,
            env_vars = ?, custom_commands = ?, updated_at = datetime('now')
        WHERE id = ?
        """, (
            name, description, path, git_url, default_branch,
            default_provider, default_model, code_mode, instructions, agent_rules,
            env_vars, custom_commands, project_id
        ))
    return get_project(project_id)

def delete_project(project_id: str) -> bool:
    with get_db() as conn:
        r = conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        return r.rowcount > 0
