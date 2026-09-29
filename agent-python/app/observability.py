"""Observability, Structured Logging, System Health Metrics, and Request Tracing."""
import os
import sys
import time
import json
import logging
from typing import Dict, Any, List, Optional
from collections import deque
from pathlib import Path
from .config import LOGS_DIR
from .database import get_db

RING_BUFFER_SIZE = 1000
LOG_BUFFER = deque(maxlen=RING_BUFFER_SIZE)

AGENT_LOG_FILE = LOGS_DIR / "agent.log"

def log_event(level: str, category: str, message: str, meta: Optional[Dict[str, Any]] = None):
    entry = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "level": level.upper(),
        "category": category,
        "message": message,
        "meta": meta or {}
    }
    LOG_BUFFER.append(entry)
    try:
        with open(AGENT_LOG_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass

def get_logs(level: Optional[str] = None, search: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    logs = list(LOG_BUFFER)
    if level:
        lvl_up = level.upper()
        logs = [l for l in logs if l["level"] == lvl_up]
    if search:
        s_low = search.lower()
        logs = [l for l in logs if s_low in l["message"].lower() or s_low in l["category"].lower()]
    return list(reversed(logs[-limit:]))

def get_system_metrics() -> Dict[str, Any]:
    disk_total = 0
    disk_free = 0
    try:
        st = os.statvfs("/")
        disk_total = st.f_blocks * st.f_frsize
        disk_free = st.f_bavail * st.f_frsize
    except Exception:
        pass

    # Job counts
    with get_db() as conn:
        active_jobs = conn.execute("SELECT COUNT(*) as c FROM jobs WHERE status IN ('running', 'queued')").fetchone()["c"]
        completed_jobs = conn.execute("SELECT COUNT(*) as c FROM jobs WHERE status = 'done'").fetchone()["c"]
        failed_jobs = conn.execute("SELECT COUNT(*) as c FROM jobs WHERE status = 'failed'").fetchone()["c"]

    return {
        "activeJobs": active_jobs,
        "completedJobs": completed_jobs,
        "failedJobs": failed_jobs,
        "disk": {
            "totalBytes": disk_total,
            "freeBytes": disk_free,
            "usedPercent": round((1 - (disk_free / disk_total)) * 100, 1) if disk_total else 0
        },
        "pythonVersion": sys.version.split()[0],
        "uptimeSeconds": int(time.time() - os.path.getctime(LOGS_DIR))
    }
