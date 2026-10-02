"""Persistent Job Worker, Concurrent Task Queue, Restart Recovery, and Lifecycle Supervision.

Every long-running agent activity (chat/tool-calling loop today; Local AI
installs/imports separately) is modeled as a row in the `jobs` table and
executed server-side, detached from whichever HTTP connection happened to
request it. Closing the browser tab, losing network, or even the whole
server process restarting must never silently abandon work in progress:

  * A chat job's execution lives in `execute_job_task`, which is scheduled
    as a plain `asyncio.create_task` the instant the job is created -- not
    awaited by (and therefore not cancelled by) the request handler that
    created it. The request handler just attaches an SSE tail to watch it.
  * Every event the loop produces is durably persisted (`append_job_event`)
    *before* being fanned out to any live subscribers, so "the browser
    reconnected 10 minutes later" and "the browser was watching the whole
    time" are handled by the exact same replay-from-seq code path.
  * `stream_complete_chat` already checkpoints conversation state after
    every tool execution (`conversation_checkpoints` table). Combined with
    `recover_orphaned_jobs()` re-queuing anything left in 'running' state
    after an unclean shutdown, a chat job resumes from its last completed
    step rather than restarting the whole conversation from scratch.
"""
import os
import asyncio
import json
import time
import uuid
import traceback
from pathlib import Path
from typing import Dict, Any, List, Optional

from .database import get_db, append_job_event, get_job_events_since
from .config import JOB_OUTPUTS_DIR, get_raw_config
from .chat import stream_complete_chat
from .providers import PROVIDER_STORE

MAX_CONCURRENT_JOBS = int(os.getenv("MAX_CONCURRENT_JOBS", "3"))
SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_JOBS)

# In-memory cancellation & pause flags
JOB_CONTROL_FLAGS: Dict[str, str] = {} # jid -> 'cancel' | 'pause' | 'resume'

# Job types this module's execute_job_task() knows how to run. Local AI
# installs/imports use their own daemon-thread execution path (see
# app/main.py) and share only the `jobs` table for status/progress -- they
# must never be picked up by the chat-completion dispatcher below.
CHAT_JOB_TYPE = "chat"

# Live in-memory fan-out: job_id -> subscriber queues. This is purely an
# optimization for "currently connected" clients to get near-instant
# delivery; nothing is ever lost if a subscriber isn't attached when an
# event fires, because every event is also durably persisted via
# append_job_event() and replayable with get_job_events_since().
JOB_SUBSCRIBERS: Dict[str, List["asyncio.Queue[Dict[str, Any]]"]] = {}


def subscribe_to_job(job_id: str) -> "asyncio.Queue[Dict[str, Any]]":
    q: "asyncio.Queue[Dict[str, Any]]" = asyncio.Queue()
    JOB_SUBSCRIBERS.setdefault(job_id, []).append(q)
    return q


def unsubscribe_from_job(job_id: str, q: "asyncio.Queue[Dict[str, Any]]") -> None:
    subs = JOB_SUBSCRIBERS.get(job_id)
    if not subs:
        return
    try:
        subs.remove(q)
    except ValueError:
        pass
    if not subs:
        JOB_SUBSCRIBERS.pop(job_id, None)


def publish_job_event(job_id: str, event: Dict[str, Any]) -> int:
    """Persist an event (so it is never lost) and fan it out to any clients
    currently attached to this job's live stream."""
    seq = append_job_event(job_id, str(event.get("type", "message")), event)
    enriched = {**event, "seq": seq}
    for q in list(JOB_SUBSCRIBERS.get(job_id, [])):
        try:
            q.put_nowait(enriched)
        except Exception:
            pass
    return seq

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
    """Recovers jobs that were stuck in 'running' state when the previous
    server process stopped (crash, redeploy, manual restart, ...).

    Only `chat` jobs are safe to blindly re-queue: their execution state is
    durably checkpointed in `conversation_checkpoints`, so re-running
    `execute_job_task` resumes from the last completed step instead of
    starting the conversation over. Local AI installs/imports keep their
    live state (download handles, subprocess pids) only in the now-gone
    process's memory -- silently re-running them as a *chat* job (the
    pre-existing behaviour, since this function didn't used to look at
    job_type at all) would corrupt them. Fail them clearly instead so the
    user sees an honest status and can retry from the Local AI screen.
    """
    # NOTE: each row's UPDATE and the subsequent log_job_message() call must use
    # *separate, non-overlapping* get_db() transactions. log_job_message() opens
    # its own connection, and holding this function's own write transaction open
    # while calling it causes a self-deadlock ("database is locked") once there
    # is actually at least one orphaned row to process -- i.e. exactly the real
    # server-restart-recovery scenario this function exists for. Collect the
    # rows first (read-only), then close that connection before doing any
    # per-row writes.
    with get_db() as conn:
        rows = conn.execute("SELECT id, job_type, retry_count, max_retries FROM jobs WHERE status = 'running'").fetchall()
        orphaned = [dict(r) for r in rows]

    for r in orphaned:
        jid = r["id"]
        job_type = r["job_type"] or CHAT_JOB_TYPE
        if job_type != CHAT_JOB_TYPE:
            with get_db() as conn:
                conn.execute("""
                UPDATE jobs SET status = 'failed',
                       error = 'Server restarted while this operation was in progress; it is not resumable, please retry.',
                       updated_at = datetime('now')
                WHERE id = ?
                """, (jid,))
            log_job_message(jid, "ERROR", f"Job marked failed: server restarted mid-execution (job_type={job_type!r} is not checkpoint-resumable).")
            continue
        if r["retry_count"] < r["max_retries"]:
            with get_db() as conn:
                conn.execute("""
                UPDATE jobs SET status = 'queued', retry_count = retry_count + 1, updated_at = datetime('now')
                WHERE id = ?
                """, (jid,))
            log_job_message(jid, "WARNING", "Recovered job from server restart: re-queued, will resume from its last checkpoint.")
        else:
            with get_db() as conn:
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
    max_timeout_sec: int = 600,
    conversation_id: str = "",
    job_type: str = CHAT_JOB_TYPE,
) -> Dict[str, Any]:
    job_id = f"job-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    with get_db() as conn:
        conn.execute("""
        INSERT INTO jobs (id, workspace_id, user_id, conversation_id, title, provider_id, model_id, status, max_steps, max_timeout_sec, payload, job_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)
        """, (job_id, workspace_id, user_id, conversation_id or "", title, provider_id, model_id, max_steps, max_timeout_sec, json.dumps(payload, ensure_ascii=False), job_type))
    log_job_message(job_id, "INFO", f"Job created and queued: {title}")
    return get_job_details(job_id)

def get_job_details(job_id: str) -> Optional[Dict[str, Any]]:
    with get_db() as conn:
        row = conn.execute("""
        SELECT id, workspace_id, user_id, conversation_id, provider_id, model_id, title, status, progress,
               step_count, max_steps, max_timeout_sec, retry_count, max_retries, error, result_ref, summary,
               payload, job_type, created_at, updated_at, started_at, finished_at
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
    conversation_id: Optional[str] = None,
    job_type: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    query = """
    SELECT id, workspace_id, user_id, conversation_id, job_type, title, provider_id, model_id, status, progress,
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
    if conversation_id:
        query += " AND conversation_id = ?"
        params.append(conversation_id)
    if job_type:
        query += " AND job_type = ?"
        params.append(job_type)
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
    """Dispatch entry point for the persistent worker loop. Only `chat` jobs
    are handled here -- Local AI installs/imports run via their own
    daemon-thread path (app/main.py) and must never reach this function."""
    job = get_job_details(job_id)
    if not job:
        return
    job_type = job.get("job_type") or CHAT_JOB_TYPE
    if job_type != CHAT_JOB_TYPE:
        log_job_message(job_id, "ERROR", f"execute_job_task cannot run job_type={job_type!r}; marking failed instead of misdispatching.")
        with get_db() as conn:
            conn.execute(
                "UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                (f"Unsupported job_type for the chat worker: {job_type}", job_id)
            )
        return
    async with SEMAPHORE:
        await _run_chat_job(job_id, job)


async def _run_chat_job(job_id: str, job: Dict[str, Any]):
    from .database import persist_chat_message

    with get_db() as conn:
        conn.execute(
            "UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, datetime('now')), updated_at = datetime('now') WHERE id = ?",
            (job_id,)
        )
    log_job_message(job_id, "INFO", "Starting chat job execution...")

    payload = job.get("payload", {}) or {}
    messages = payload.get("messages") or [{"role": "user", "content": payload.get("message", job.get("title", ""))}]
    provider_id = job.get("provider_id")
    model_id = job.get("model_id")
    max_steps = job.get("max_steps") or 30
    timeout_sec = job.get("max_timeout_sec") or 1800
    conversation_id = job.get("conversation_id") or payload.get("conversationId") or payload.get("conversation_id") or ""
    references = payload.get("references")

    accumulated_text: List[str] = []
    final_event: Optional[Dict[str, Any]] = None
    started_time = time.time()
    agen = stream_complete_chat(
        PROVIDER_STORE,
        provider_id=provider_id,
        model_id=model_id,
        messages=messages,
        max_steps=max_steps,
        user_id=job.get("user_id", "user"),
        conversation_id=conversation_id or None,
        references=references,
    )
    try:
        async with asyncio.timeout(timeout_sec):
            async for event in agen:
                publish_job_event(job_id, event)

                ev_type = event.get("type")
                if ev_type == "token":
                    accumulated_text.append(str(event.get("text", "")))
                elif ev_type in ("done", "error"):
                    final_event = event

                flag = JOB_CONTROL_FLAGS.get(job_id)
                if flag == "cancel":
                    log_job_message(job_id, "WARNING", "Job cancellation requested; stopping after the current step.")
                    await agen.aclose()
                    with get_db() as conn:
                        conn.execute("UPDATE jobs SET status = 'cancelled', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (job_id,))
                    return
                if flag == "pause":
                    log_job_message(job_id, "INFO", "Job paused; resuming later will continue from the last saved checkpoint.")
                    await agen.aclose()
                    with get_db() as conn:
                        conn.execute("UPDATE jobs SET status = 'paused', updated_at = datetime('now') WHERE id = ?", (job_id,))
                    return
                if ev_type in ("done", "error"):
                    break

        full_text = "".join(accumulated_text)

        if final_event and final_event.get("type") == "error":
            err = str(final_event.get("error") or "Chat execution failed")
            with get_db() as conn:
                conn.execute("UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (err, job_id))
            log_job_message(job_id, "ERROR", f"Job failed: {err}")
            return

        # Persist the assistant's final answer server-side -- this is what
        # makes "the user closed the tab before the response finished"
        # harmless: the answer is in the conversation's message history
        # whenever they come back, with no client ever needing to be
        # present at completion time.
        if conversation_id and full_text:
            persist_chat_message(conversation_id, "assistant", full_text)

        artifact_ref = save_job_output_artifact(job_id, {"content": full_text, "doneEvent": final_event})
        with get_db() as conn:
            conn.execute("""
                UPDATE jobs SET status = 'done', progress = 100.0, step_count = ?, result_ref = ?, summary = ?, finished_at = datetime('now'), updated_at = datetime('now')
                WHERE id = ?
            """, (int((final_event or {}).get("steps", 1)), artifact_ref, full_text[:300], job_id))
        log_job_message(job_id, "INFO", f"Job completed successfully in {int(time.time() - started_time)}s.")

    except asyncio.TimeoutError:
        err = f"Job execution timed out after {timeout_sec}s"
        publish_job_event(job_id, {"type": "error", "error": err})
        with get_db() as conn:
            conn.execute("UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (err, job_id))
        log_job_message(job_id, "ERROR", err)

    except Exception as e:
        # See chat.py's own httpx-timeout handling: str(e) can be blank for
        # some exception classes, so always fall back to the class name.
        err_str = str(e) or type(e).__name__
        publish_job_event(job_id, {"type": "error", "error": err_str})
        with get_db() as conn:
            conn.execute("UPDATE jobs SET status = 'failed', error = ?, finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", (err_str, job_id))
        log_job_message(job_id, "ERROR", f"Job failed with exception: {err_str}")

    finally:
        JOB_CONTROL_FLAGS.pop(job_id, None)


# Persistent Worker Loop
async def persistent_worker_loop():
    recover_orphaned_jobs()
    while True:
        try:
            # Poll for queued chat jobs. Local AI installs/imports are
            # intentionally excluded -- they run via their own daemon-thread
            # path and must never be picked up by execute_job_task().
            with get_db() as conn:
                row = conn.execute(
                    "SELECT id FROM jobs WHERE status = 'queued' AND job_type = ? ORDER BY created_at ASC LIMIT 1",
                    (CHAT_JOB_TYPE,)
                ).fetchone()
            if row:
                jid = row["id"]
                # Launch task
                asyncio.create_task(execute_job_task(jid))
            await asyncio.sleep(1.0)
        except Exception:
            await asyncio.sleep(2.0)
