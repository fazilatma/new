"""Persistent Job Worker, Concurrent Task Queue, Restart Recovery, and Lifecycle Supervision."""
import os
import asyncio
import json
import time
import uuid
import traceback
from pathlib import Path
from typing import Dict, Any, List, Optional

from .database import get_db
from .config import JOB_OUTPUTS_DIR, get_raw_config
from .chat import complete_chat
from .providers import PROVIDER_STORE

MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "3"))
SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_JOBS)

# In-memory cancellation & pause flags
JOB_CONTROL_FLAGS: Dict[str, str] = {} # jid -> 'cancel' | 'pause' | 'resume'

def save_job_output_artifact(job_id: str, data: Any) -> str:
    path = JOB_OUTPUTS_DIR / f"{job_id}.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(path)

def load_job_output_artifact(job_id: str) -> Optional[Any]:
    path = JOB_OUTPUTS_DIR / f"{job_id}.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None

def log_job_message(job_id: str, level: str, message: str):
    with get_db() as conn:
        conn.execute("INSERT INTO job_logs (job_id, level, message) VALUES (?, ?, ?)", (job_id, level, message))

def record_job_step(job_id: str, step_index: int, tool_name: str, arguments: Dict[str, Any], result: Any, status: str, duration_ms: int):
    with get_db() as conn:
        conn.execute("""
        INSERT INTO job_steps (id, job_id, step_index, tool_name, arguments, result, status, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            f"step-{uuid.uuid4().hex[:8]}",
            job_id,
            step_index,
            tool_name,
            json.dumps(arguments, ensure_ascii=False),
            json.dumps(result, ensure_ascii=False) if not isinstance(result, str) else result,
            status,
            duration_ms
        ))

def recover_orphaned_jobs():
    """Recovers jobs that were stuck in 'running' state when previous server process stopped."""
    with get_db() as conn:
        rows = conn.execute("SELECT id, retry_count, max_retries FROM jobs WHERE status = 'running'").fetchall()
        for r in rows:
            jid = r["id"]
            if r["retry_count"] < r["max_retries"]:
                conn.execute("""
                UPDATE jobs SET status = 'queued', retry_count = retry_count + 1, updated_at = datetime('now')
                WHERE id = ?
                """, (jid,))
                log_job_message(jid, "WARNING", "Recovered job from server restart: re-queued for execution.")
            else:
                conn.execute("""
                UPDATE jobs SET status = 'failed', error = 'Server restarted while job was in progress (max retries reached)', updated_at = datetime('now')
                WHERE id = ?
                """, (jid,))
                log_job_message(jid, "ERROR", "Job marked failed due to server restart.")

def create_job(
    title: str,
    provider_id: str,
    model_id: str,
    payload: Dict[str, Any],
    workspace_id: str = "default",
    user_id: str = "user",
    max_steps: int = 8,
    max_timeout_sec: int = 600
) -> Dict[str, Any]:
    job_id = f"job-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    with get_db() as conn:
        conn.execute("""
        INSERT INTO jobs (id, workspace_id, user_id, title, provider_id, model_id, status, max_steps, max_timeout_sec, payload)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
        """, (job_id, workspace_id, user_id, title, provider_id, model_id, max_steps, max_timeout_sec, json.dumps(payload, ensure_ascii=False)))
    log_job_message(job_id, "INFO", f"Job created and queued: {title}")
    return get_job_details(job_id)

def get_job_details(job_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute("""
        SELECT id, workspace_id, user_id, conversation_id, provider_id, model_id, title, status, progress,
               step_count, max_steps, max_timeout_sec, retry_count, max_retries, error, result_ref, summary,
               payload, created_at, updated_at, started_at, finished_at
        FROM jobs WHERE id = ?
        """, (job_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["payload"] = json.loads(d["payload"]) if d["payload"] else {}
        except Exception:
            pass

        steps = conn.execute("SELECT step_index, tool_name, arguments, result, status, duration_ms, created_at FROM job_steps WHERE job_id = ? ORDER BY step_index ASC", (job_id,)).fetchall()
        d["steps"] = [dict(s) for s in steps]

        logs = conn.execute("SELECT level, message, created_at FROM job_logs WHERE job_id = ? ORDER BY id ASC", (job_id,)).fetchall()
        d["logs"] = [dict(l) for l in logs]

        if d.get("result_ref"):
            d["result"] = load_job_output_artifact(job_id)
        return d

def list_all_jobs(
    status: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    query = """
    SELECT id, workspace_id, user_id, title, provider_id, model_id, status, progress,
           step_count, max_steps, retry_count, error, created_at, updated_at, started_at, finished_at
    FROM jobs WHERE 1=1
    """
    params = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if provider:
        query += " AND provider_id = ?"
        params.append(provider)
    if model:
        query += " AND model_id = ?"
        params.append(model)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, tuple(params)).fetchall()
        return [dict(r) for r in rows]

def cancel_job(job_id: str) -> bool:
    JOB_CONTROL_FLAGS[job_id] = "cancel"
    with get_db() as conn:
        conn.execute("UPDATE jobs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", (job_id,))
    log_job_message(job_id, "WARNING", "Job cancelled by user.")
    return True

def pause_job(job_id: str) -> bool:
    JOB_CONTROL_FLAGS[job_id] = "pause"
    with get_db() as conn:
        conn.execute("UPDATE jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?", (job_id,))
    log_job_message(job_id, "INFO", "Job paused.")
    return True

def resume_job(job_id: str) -> bool:
    JOB_CONTROL_FLAGS.pop(job_id, None)
    with get_db() as conn:
        conn.execute("UPDATE jobs SET status = 'queued', updated_at = datetime('now') WHERE id = ?", (job_id,))
    log_job_message(job_id, "INFO", "Job resumed and re-queued.")
    return True

def retry_job(job_id: str) -> bool:
    JOB_CONTROL_FLAGS.pop(job_id, None)
    with get_db() as conn:
        conn.execute("""
        UPDATE jobs SET status = 'queued', error = '', updated_at = datetime('now')
        WHERE id = ?
        """, (job_id,))
    log_job_message(job_id, "INFO", "Job manually re-queued for retry.")
    return True

def delete_old_jobs(days: int = 7) -> int:
    with get_db() as conn:
        res = conn.execute("DELETE FROM jobs WHERE created_at < datetime('now', '-' || ? || ' days')", (days,))
        return res.rowcount

async def execute_job_task(job_id: str):
    async with SEMAPHORE:
        with get_db() as conn:
            conn.execute("UPDATE jobs SET status = 'running', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (job_id,))
        log_job_message(job_id, "INFO", "Starting job task execution...")

        job = get_job_details(job_id)
        if not job:
            return

        payload = job.get("payload", {})
        messages = payload.get("messages") or [{"role": "user", "content": payload.get("message", job.get("title", ""))}]
        provider_id = job.get("provider_id")
        model_id = job.get("model_id")
        max_steps = job.get("max_steps", 8)
        timeout_sec = job.get("max_timeout_sec", 600)

        started_time = time.time()
        try:
            # Run with timeout
            async with asyncio.timeout(timeout_sec):
                # Execute agent chat loop
                result = await complete_chat(
                    PROVIDER_STORE,
                    provider_id=provider_id,
                    model_id=model_id,
                    messages=messages,
                    max_steps=max_steps,
                    user_id=job.get("user_id", "user")
                )

                # Check if cancelled mid-run
                if JOB_CONTROL_FLAGS.get(job_id) == "cancel":
                    with get_db() as conn:
                        conn.execute("UPDATE jobs SET status = 'cancelled', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (job_id,))
                    return

                # Save result artifact
                artifact_ref = save_job_output_artifact(job_id, result)
                summary_text = result.get("message", {}).get("content", "")[:300]

                with get_db() as conn:
                    conn.execute("""
                    UPDATE jobs SET status = 'done', progress = 100.0, step_count = ?, result_ref = ?, summary = ?, finished_at = datetime('now'), updated_at = datetime('now')
                    WHERE id = ?
                    """, (result.get("steps", 1), artifact_ref, summary_text, job_id))

                log_job_message(job_id, "INFO", f"Job completed successfully in {int(time.time() - started_time)}s.")

        except asyncio.TimeoutError:
            with get_db() as conn:
                conn.execute("UPDATE jobs SET status = 'failed', error = 'Job execution timed out', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (job_id,))
            log_job_message(job_id, "ERROR", f"Job exceeded max execution time ({timeout_sec}s).")

        except Exception as e:
            err_str = str(e)
            with get_db() as conn:
                conn.execute("UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (err_str, job_id))
            log_job_message(job_id, "ERROR", f"Job failed with error: {err_str}")

# Persistent Worker Loop
async def persistent_worker_loop():
    recover_orphaned_jobs()
    while True:
        try:
            # Poll for queued jobs
            with get_db() as conn:
                row = conn.execute("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").fetchone()
            if row:
                jid = row["id"]
                # Launch task
                asyncio.create_task(execute_job_task(jid))
            await asyncio.sleep(1.0)
        except Exception:
            await asyncio.sleep(2.0)
