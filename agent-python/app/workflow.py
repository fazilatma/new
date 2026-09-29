"""Workflow and diff helpers with ChangeSet integration."""
from .changesets import (
    compute_diff, parse_diff_hunks, create_changeset, approve_changeset,
    reject_changeset, rollback_changeset, list_file_versions, compare_file_versions,
    rollback_to_version, acquire_file_lock, release_file_lock, get_changeset,
    list_changesets, approve_changeset_file, reject_changeset_file
)
from .workspaces import safe_path

def preview(path: str, content: str):
    p = safe_path(path)
    old = p.read_text(encoding="utf-8") if p.exists() else ""
    diff = compute_diff(old, content, path)
    hunks = parse_diff_hunks(diff)
    return {
        "path": path,
        "exists": p.exists(),
        "changed": old != content,
        "diff": diff,
        "hunks": hunks
    }

def backup(path: str) -> str:
    from .changesets import save_file_version_snapshot
    from .workspaces import get_active_workspace
    p = safe_path(path)
    if not p.exists():
        return ""
    content = p.read_text(encoding="utf-8", errors="replace")
    return save_file_version_snapshot(get_active_workspace()["id"], path, content, created_by="backup")

def rollback(path: str, version_id: str):
    return rollback_to_version(path, version_id)
