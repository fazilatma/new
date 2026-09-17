#!/usr/bin/env python3
"""Termux → VPS live relay. Polls GitHub for jobs, runs them over SSH, writes results back."""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

REPO = os.environ.get("REPO", "fazilatma/amphp")
BRANCH = os.environ.get("BRANCH", "arena/01a06ac3-amphp")
JOB_PATH = "tools/vps-live/bus/job.json"
RESULT_PATH = "tools/vps-live/bus/result.json"
SSH_TARGET = os.environ.get("SSH_TARGET", "root@37.32.5.36")
API = "https://api.github.com"


def gh_token() -> str:
    env = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if env:
        return env
    gh = shutil.which("gh")
    if not gh:
        return ""
    try:
        p = subprocess.run([gh, "auth", "token"], capture_output=True, text=True, timeout=10)
        return (p.stdout or "").strip() if p.returncode == 0 else ""
    except Exception:
        return ""


def api(method: str, path: str, data=None, token: str = "", timeout: int = 30):
    url = API + path
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "vps-live-relay")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return json.loads(raw.decode("utf-8")) if raw else {}


def read_json_file(path: str) -> dict | None:
    try:
        meta = api("GET", f"/repos/{REPO}/contents/{path}?ref={BRANCH}&t={int(time.time())}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    raw = base64.b64decode(meta.get("content") or "")
    if not raw.strip():
        return None
    return json.loads(raw.decode("utf-8"))


def put_json_file(path: str, obj: dict, message: str, token: str) -> None:
    content = base64.b64encode(json.dumps(obj, indent=2).encode("utf-8")).decode("ascii")
    sha = None
    try:
        meta = api("GET", f"/repos/{REPO}/contents/{path}?ref={BRANCH}", token=token)
        sha = meta.get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    payload = {"message": message, "content": content, "branch": BRANCH}
    if sha:
        payload["sha"] = sha
    api("PUT", f"/repos/{REPO}/contents/{path}", payload, token=token)


def ssh_run(cmd: str, timeout: int = 180) -> dict:
    p = subprocess.run(
        [
            "ssh",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ConnectTimeout=15",
            "-o",
            "ServerAliveInterval=15",
            SSH_TARGET,
            "bash",
            "-lc",
            cmd,
        ],
        capture_output=True,
        text=True,
        timeout=timeout + 20,
    )
    return {
        "code": p.returncode,
        "stdout": (p.stdout or "")[-400000:],
        "stderr": (p.stderr or "")[-100000:],
    }


def main():
    print(f"[relay] repo={REPO} branch={BRANCH} ssh={SSH_TARGET}", flush=True)
    token = gh_token()
    if not token:
        print(
            "[relay] GitHub login required so I can send results back.\n"
            "  pkg install gh\n"
            "  gh auth login -p https -h github.com -w",
            flush=True,
        )
        sys.exit(2)
    last_id = None
    print("[relay] polling jobs… keep this running", flush=True)
    while True:
        try:
            job = read_json_file(JOB_PATH)
            if job and job.get("id") and job.get("id") != last_id and job.get("id") != "idle":
                jid = job["id"]
                print(f"[relay] job {jid}: {(job.get('cmd') or job.get('type') or '')[:80]}", flush=True)
                typ = job.get("type") or "shell"
                if typ == "shell":
                    result = ssh_run(job.get("cmd") or "true", int(job.get("timeout") or 180))
                else:
                    result = {"code": 2, "stdout": "", "stderr": f"unknown type {typ}"}
                result["id"] = jid
                result["ts"] = int(time.time())
                put_json_file(RESULT_PATH, result, f"vps-live result {jid}", token)
                last_id = jid
                print(f"[relay] done {jid} code={result.get('code')}", flush=True)
        except KeyboardInterrupt:
            print("[relay] stop", flush=True)
            return
        except Exception as e:
            print(f"[relay] {type(e).__name__}: {e}", flush=True)
        time.sleep(4)


if __name__ == "__main__":
    main()
