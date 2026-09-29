"""Change Set Management, Approval Workflow, Diff Parsing, Hunk Selection, and Rollbacks."""
import difflib
import uuid
import time
import shutil
import hashlib
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple

from .database import get_db
from .workspaces import safe_path, get_workspace_root, get_active_workspace
from .config import VERSIONS_DIR, BACKUPS_DIR

def compute_diff(old_content: str, new_content: str, filename: str) -> str:
    old_lines = old_content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)
    diff = difflib.unified_diff(
        old_lines,
        new_lines,
        fromfile=f"a/{filename}",
        tofile=f"b/{filename}",
        n=3
    )
    return "".join(diff)

def parse_diff_hunks(diff_text: str) -> List[Dict[str, Any]]:
    """Breaks down a unified diff into structured hunks for line/hunk level approval."""
    lines = diff_text.splitlines()
    hunks = []
    current_hunk = None
    hunk_index = 0

    for line in lines:
        if line.startswith("@@"):
            if current_hunk:
                hunks.append(current_hunk)
            hunk_index += 1
            current_hunk = {
                "index": hunk_index,
                "header": line,
                "lines": [],
                "status": "pending"
            }
        elif current_hunk is not None:
            kind = "context"
            if line.startswith("+"):
                kind = "add"
            elif line.startswith("-"):
                kind = "del"
            current_hunk["lines"].append({"text": line, "type": kind})

    if current_hunk:
        hunks.append(current_hunk)
    return hunks

def acquire_file_lock(rel_path: str, user_id: str, ttl_seconds: int = 300) -> bool:
    now = time.time()
    expires = now + ttl_seconds
    with get_db() as conn:
        # Check existing lock
        row = conn.execute("SELECT locked_by, expires_at FROM file_locks WHERE path = ?", (rel_path,)).fetchone()
        if row:
            if row["expires_at"] > now and row["locked_by"] != user_id:
                return False  # Locked by someone else
            conn.execute("UPDATE file_locks SET locked_by = ?, locked_at = ?, expires_at = ? WHERE path = ?", (user_id, now, expires, rel_path))
        else:
            conn.execute("INSERT INTO file_locks (path, locked_by, locked_at, expires_at) VALUES (?, ?, ?, ?)", (rel_path, user_id, now, expires))
        return True

def release_file_lock(rel_path: str, user_id: str) -> bool:
    with get_db() as conn:
        conn.execute("DELETE FROM file_locks WHERE path = ? AND (locked_by = ? OR expires_at < ?)", (rel_path, user_id, time.time()))
        return True

def save_file_version_snapshot(workspace_id: str, rel_path: str, content: str, created_by: str = "", changeset_id: Optional[str] = None) -> str:
    ver_id = f"v-{int(time.time()*1000)}-{uuid.uuid4().hex[:6]}"
    with get_db() as conn:
        # Get next version number
        r = conn.execute("SELECT MAX(version_num) as m FROM file_versions WHERE workspace_id = ? AND path = ?", (workspace_id, rel_path)).fetchone()
        next_ver = (r["m"] or 0) + 1
        conn.execute("""
        INSERT INTO file_versions (id, workspace_id, path, version_num, content, created_by, changeset_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (ver_id, workspace_id, rel_path, next_ver, content, created_by, changeset_id))

    # Also save to disk backup for durability
    path_hash = hashlib.sha1(f"{workspace_id}:{rel_path}".encode()).hexdigest()
    target_dir = VERSIONS_DIR / path_hash
    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / f"{ver_id}.bak").write_text(content, encoding="utf-8")

    return ver_id

def create_changeset(title: str, files: List[Dict[str, Any]], created_by: str = "agent") -> Dict[str, Any]:
    ws = get_active_workspace()
    ws_id = ws["id"]
    cs_id = f"cs-{int(time.time())}-{uuid.uuid4().hex[:6]}"

    created_files = []
    with get_db() as conn:
        conn.execute("""
        INSERT INTO changesets (id, workspace_id, title, status, created_by)
        VALUES (?, ?, ?, 'pending', ?)
        """, (cs_id, ws_id, title, created_by))

        for f in files:
            rel_path = f["path"].strip().lstrip("/")
            new_content = f.get("new_content", "")
            target_path = safe_path(rel_path)

            old_content = ""
            if target_path.exists() and target_path.is_file():
                try:
                    old_content = target_path.read_text(encoding="utf-8")
                except Exception:
                    old_content = ""

            change_type = f.get("change_type")
            if not change_type:
                if not target_path.exists():
                    change_type = "added"
                elif f.get("delete"):
                    change_type = "deleted"
                else:
                    change_type = "modified"

            diff = compute_diff(old_content, new_content, rel_path)
            file_id = f"cf-{uuid.uuid4().hex[:8]}"

            conn.execute("""
            INSERT INTO changeset_files (id, changeset_id, path, old_content, new_content, diff, change_type, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
            """, (file_id, cs_id, rel_path, old_content, new_content, diff, change_type))

            created_files.append({
                "id": file_id,
                "path": rel_path,
                "change_type": change_type,
                "diff": diff,
                "old_size": len(old_content),
                "new_size": len(new_content)
            })

    return {
        "id": cs_id,
        "title": title,
        "status": "pending",
        "created_by": created_by,
        "files": created_files,
        "created_at": time.strftime("%Y-%m-%d %H:%M:%S")
    }

def get_changeset(cs_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        cs = conn.execute("SELECT id, workspace_id, title, status, created_by, approved_by, created_at, updated_at FROM changesets WHERE id = ?", (cs_id,)).fetchone()
        if not cs:
            return None
        files = conn.execute("SELECT id, changeset_id, path, old_content, new_content, diff, change_type, status, applied_at FROM changeset_files WHERE changeset_id = ?", (cs_id,)).fetchall()
        cs_dict = dict(cs)
        cs_dict["files"] = [dict(f) for f in files]
        return cs_dict

def list_changesets(workspace_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    ws_id = workspace_id or get_active_workspace()["id"]
    with get_db() as conn:
        rows = conn.execute("""
        SELECT id, workspace_id, title, status, created_by, approved_by, created_at, updated_at
        FROM changesets
        WHERE workspace_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """, (ws_id, limit)).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            f_count = conn.execute("SELECT COUNT(*) as c FROM changeset_files WHERE changeset_id = ?", (d["id"],)).fetchone()["c"]
            d["file_count"] = f_count
            result.append(d)
        return result

def approve_changeset_file(cs_id: str, file_id: str, approved_by: str = "user") -> Dict[str, Any]:
    with get_db() as conn:
        f = conn.execute("SELECT id, changeset_id, path, old_content, new_content, change_type, status FROM changeset_files WHERE id = ? AND changeset_id = ?", (file_id, cs_id)).fetchone()
        if not f:
            raise ValueError("File change not found")

        rel_path = f["path"]
        target = safe_path(rel_path)

        # Save old version snapshot before modifying
        if target.exists():
            save_file_version_snapshot(get_active_workspace()["id"], rel_path, f["old_content"], created_by=f"before-{cs_id}", changeset_id=cs_id)

        # Apply modification
        if f["change_type"] == "deleted":
            if target.exists():
                target.unlink()
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(f["new_content"], encoding="utf-8")

        # Save new version snapshot
        save_file_version_snapshot(get_active_workspace()["id"], rel_path, f["new_content"], created_by=approved_by, changeset_id=cs_id)

        conn.execute("UPDATE changeset_files SET status = 'approved', applied_at = datetime('now') WHERE id = ?", (file_id,))

        # Check if all files in changeset are processed
        all_files = conn.execute("SELECT status FROM changeset_files WHERE changeset_id = ?", (cs_id,)).fetchall()
        statuses = [x["status"] for x in all_files]
        if all(s == "approved" for s in statuses):
            new_cs_status = "approved"
        elif any(s == "approved" for s in statuses):
            new_cs_status = "partially_approved"
        else:
            new_cs_status = "pending"

        conn.execute("UPDATE changesets SET status = ?, approved_by = ?, updated_at = datetime('now') WHERE id = ?", (new_cs_status, approved_by, cs_id))

    return {"ok": True, "file_id": file_id, "path": rel_path, "status": "approved"}

def reject_changeset_file(cs_id: str, file_id: str, rejected_by: str = "user") -> Dict[str, Any]:
    with get_db() as conn:
        conn.execute("UPDATE changeset_files SET status = 'rejected' WHERE id = ? AND changeset_id = ?", (file_id, cs_id))
        all_files = conn.execute("SELECT status FROM changeset_files WHERE changeset_id = ?", (cs_id,)).fetchall()
        statuses = [x["status"] for x in all_files]
        if all(s == "rejected" for s in statuses):
            conn.execute("UPDATE changesets SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", (cs_id,))
    return {"ok": True, "file_id": file_id, "status": "rejected"}

def approve_changeset(cs_id: str, approved_by: str = "user") -> Dict[str, Any]:
    cs = get_changeset(cs_id)
    if not cs:
        raise ValueError("ChangeSet not found")

    applied_files = []
    for f in cs["files"]:
        if f["status"] != "rejected":
            res = approve_changeset_file(cs_id, f["id"], approved_by=approved_by)
            applied_files.append(res["path"])

    with get_db() as conn:
        conn.execute("UPDATE changesets SET status = 'approved', approved_by = ?, updated_at = datetime('now') WHERE id = ?", (approved_by, cs_id))

    return {
        "ok": True,
        "changeset_id": cs_id,
        "status": "approved",
        "applied_files": applied_files
    }

def reject_changeset(cs_id: str, rejected_by: str = "user") -> Dict[str, Any]:
    with get_db() as conn:
        conn.execute("UPDATE changeset_files SET status = 'rejected' WHERE changeset_id = ?", (cs_id,))
        conn.execute("UPDATE changesets SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", (cs_id,))
    return {"ok": True, "changeset_id": cs_id, "status": "rejected"}

def rollback_changeset(cs_id: str, rolled_back_by: str = "user") -> Dict[str, Any]:
    cs = get_changeset(cs_id)
    if not cs:
        raise ValueError("ChangeSet not found")

    reverted_files = []
    for f in cs["files"]:
        if f["status"] == "approved":
            rel_path = f["path"]
            target = safe_path(rel_path)
            # Revert to old content
            if f["change_type"] == "added":
                if target.exists():
                    target.unlink()
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(f["old_content"], encoding="utf-8")

            save_file_version_snapshot(cs["workspace_id"], rel_path, f["old_content"], created_by=f"rollback-{cs_id}")
            reverted_files.append(rel_path)

    with get_db() as conn:
        conn.execute("UPDATE changesets SET status = 'rolled_back', updated_at = datetime('now') WHERE id = ?", (cs_id,))

    return {"ok": True, "changeset_id": cs_id, "status": "rolled_back", "reverted_files": reverted_files}

def list_file_versions(rel_path: str) -> List[Dict[str, Any]]:
    ws_id = get_active_workspace()["id"]
    with get_db() as conn:
        rows = conn.execute("""
        SELECT id, workspace_id, path, version_num, created_by, changeset_id, created_at, length(content) as size
        FROM file_versions
        WHERE workspace_id = ? AND path = ?
        ORDER BY version_num DESC
        """, (ws_id, rel_path)).fetchall()
        return [dict(r) for r in rows]

def compare_file_versions(rel_path: str, v1_id: str, v2_id: str) -> Dict[str, Any]:
    with get_db() as conn:
        r1 = conn.execute("SELECT content, version_num FROM file_versions WHERE id = ?", (v1_id,)).fetchone()
        r2 = conn.execute("SELECT content, version_num FROM file_versions WHERE id = ?", (v2_id,)).fetchone()
        if not r1 or not r2:
            raise ValueError("One or both version records not found")

        diff = compute_diff(r1["content"], r2["content"], f"{rel_path} (v{r1['version_num']} -> v{r2['version_num']})")
        return {
            "path": rel_path,
            "v1": {"id": v1_id, "version_num": r1["version_num"]},
            "v2": {"id": v2_id, "version_num": r2["version_num"]},
            "diff": diff
        }

def rollback_to_version(rel_path: str, version_id: str, user_id: str = "user") -> Dict[str, Any]:
    with get_db() as conn:
        r = conn.execute("SELECT content, version_num, workspace_id FROM file_versions WHERE id = ?", (version_id,)).fetchone()
        if not r:
            raise ValueError("Version record not found")

        target = safe_path(rel_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(r["content"], encoding="utf-8")

        save_file_version_snapshot(r["workspace_id"], rel_path, r["content"], created_by=f"rollback-to-v{r['version_num']}")
        return {"ok": True, "path": rel_path, "restored_version": r["version_num"]}
