"""Sandboxed Terminal Execution, Process Supervision, Docker Isolation, and Dangerous Command Protection."""
import os
import sys
import time
import signal
import subprocess
import shlex
from typing import Dict, Any, List, Optional
from pathlib import Path

from .config import get_raw_config
from .workspaces import safe_path, get_workspace_root
from .security import mask_log_tokens

# Dangerous Commands Allowlist/Blocklist
DANGEROUS_PATTERNS = [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    "dd if=",
    ":(){ :|:& };:",
    "> /dev/sda",
    "chmod -R 777 /",
    "chown -R",
    "shutdown",
    "reboot",
    "poweroff",
    "init 0",
    "drop table",
    "truncate table",
    "git push --force",
    "git push -f",
    "git reset --hard origin"
]

def is_dangerous_command(command: str) -> bool:
    cmd_lower = command.lower()
    for p in DANGEROUS_PATTERNS:
        if p in cmd_lower:
            return True
    return False

# Active Process Supervisor
ACTIVE_PROCESSES: Dict[int, Dict[str, Any]] = {}

def get_clean_env() -> Dict[str, str]:
    env = os.environ.copy()
    # Strip sensitive secrets from subprocess execution
    for k in list(env.keys()):
        if any(secret in k for secret in ("KEY", "TOKEN", "SECRET", "AUTH", "PASS")):
            if k not in ("PATH", "HOME", "USER", "LANG", "LC_ALL", "SHELL", "TERM"):
                env.pop(k, None)
    return env

def list_active_processes() -> List[Dict[str, Any]]:
    now = time.time()
    results = []
    dead_pids = []
    for pid, info in ACTIVE_PROCESSES.items():
        proc: subprocess.Popen = info.get("proc")
        if proc and proc.poll() is None:
            results.append({
                "pid": pid,
                "command": info.get("command"),
                "cwd": info.get("cwd"),
                "started_at": info.get("started_at"),
                "running_seconds": round(now - info.get("started_at", now), 1)
            })
        else:
            dead_pids.append(pid)
    for p in dead_pids:
        ACTIVE_PROCESSES.pop(p, None)
    return results

def kill_process(pid: int) -> bool:
    info = ACTIVE_PROCESSES.get(pid)
    if not info:
        return False
    proc: subprocess.Popen = info.get("proc")
    if proc:
        try:
            proc.terminate()
            time.sleep(0.5)
            if proc.poll() is None:
                proc.kill()
            ACTIVE_PROCESSES.pop(pid, None)
            return True
        except Exception:
            return False
    return False

def execute_sandboxed_command(
    command: str,
    cwd: str = ".",
    timeout: int = 60,
    confirmed_dangerous: bool = False,
    user_id: str = "agent"
) -> Dict[str, Any]:
    # Check danger
    if is_dangerous_command(command) and not confirmed_dangerous:
        return {
            "command": command,
            "exitCode": -1,
            "stdout": "",
            "stderr": "BLOCKED: This command is classified as potentially dangerous and requires explicit user confirmation.",
            "durationMs": 0,
            "requiresApproval": True
        }

    target_dir = safe_path(cwd)
    started = time.time()
    env = get_clean_env()

    use_docker = get_raw_config("DOCKER_SANDBOX_ENABLED", "false").lower() in ("1", "true", "yes")

    if use_docker:
        # Run inside temporary isolated Docker container
        ws_root = str(get_workspace_root())
        safe_cmd = command.replace("'", "'\\''")
        docker_cmd = (
            f"docker run --rm -i --net none --memory 512m --cpus 1.0 "
            f"-v '{ws_root}':/workspace -w /workspace "
            f"python:3.11-slim bash -c '{safe_cmd}'"
        )
        try:
            r = subprocess.run(
                docker_cmd,
                shell=True,
                cwd=target_dir,
                text=True,
                capture_output=True,
                timeout=min(int(timeout), 300),
                env=env
            )
            return {
                "command": command,
                "exitCode": r.returncode,
                "stdout": mask_log_tokens(r.stdout[-25000:]),
                "stderr": mask_log_tokens(r.stderr[-25000:]),
                "durationMs": int((time.time() - started) * 1000),
                "sandbox": "docker"
            }
        except subprocess.TimeoutExpired:
            return {
                "command": command,
                "exitCode": 124,
                "stdout": "",
                "stderr": f"Execution timed out after {timeout} seconds.",
                "durationMs": int((time.time() - started) * 1000),
                "sandbox": "docker"
            }
        except Exception as e:
            # Fallback to local sandboxed run
            pass

    # Direct Sandboxed Execution
    try:
        proc = subprocess.Popen(
            command,
            shell=True,
            cwd=target_dir,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            preexec_fn=os.setsid if sys.platform != "win32" else None
        )
        ACTIVE_PROCESSES[proc.pid] = {
            "proc": proc,
            "command": command,
            "cwd": str(target_dir),
            "started_at": started,
            "user_id": user_id
        }

        try:
            stdout, stderr = proc.communicate(timeout=min(int(timeout), 300))
            ACTIVE_PROCESSES.pop(proc.pid, None)
            return {
                "command": command,
                "exitCode": proc.returncode,
                "stdout": mask_log_tokens(stdout[-25000:]),
                "stderr": mask_log_tokens(stderr[-25000:]),
                "durationMs": int((time.time() - started) * 1000),
                "sandbox": "local"
            }
        except subprocess.TimeoutExpired:
            if sys.platform != "win32":
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            else:
                proc.kill()
            ACTIVE_PROCESSES.pop(proc.pid, None)
            return {
                "command": command,
                "exitCode": 124,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds.",
                "durationMs": int((time.time() - started) * 1000),
                "sandbox": "local"
            }
    except Exception as e:
        return {
            "command": command,
            "exitCode": -1,
            "stdout": "",
            "stderr": f"Failed to execute command: {str(e)}",
            "durationMs": int((time.time() - started) * 1000),
            "sandbox": "local"
        }
