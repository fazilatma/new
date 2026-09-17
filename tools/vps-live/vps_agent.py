#!/usr/bin/env python3
"""VPS live agent: GitHub device login, then poll jobs and write results."""
from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = "fazilatma/amphp"
BRANCH = "arena/01a06ac3-amphp"
JOB_PATH = "tools/vps-live/bus/job.json"
RESULT_PATH = "tools/vps-live/bus/result.json"
TOKEN_PATH = os.environ.get("VPS_LIVE_TOKEN_FILE", "/root/.vps-live-github-token")
API = "https://api.github.com"
# Public GitHub CLI OAuth client (device flow). Scope limited to public repos.
CLIENT_ID = "178c6fc778ccc68e1d6a"
SCOPE = "public_repo"


def http_form(url: str, data: dict, headers=None, timeout=30):
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Accept", "application/json")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def api(method: str, path: str, data=None, token: str = "", timeout: int = 30):
    url = API + path if path.startswith("/") else path
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("User-Agent", "vps-live-agent")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        return json.loads(raw.decode()) if raw else {}


def load_token() -> str:
    env = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    if env:
        return env
    if os.path.isfile(TOKEN_PATH):
        return open(TOKEN_PATH).read().strip()
    return ""


def save_token(token: str) -> None:
    os.makedirs(os.path.dirname(TOKEN_PATH) or ".", exist_ok=True)
    fd = os.open(TOKEN_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(token)


def device_login() -> str:
    print("[agent] GitHub device login (one time). Open the URL and enter the code:", flush=True)
    data = http_form(
        "https://github.com/login/device/code",
        {"client_id": CLIENT_ID, "scope": SCOPE},
    )
    print(f"\n    URL:  {data.get('verification_uri') or 'https://github.com/login/device'}", flush=True)
    print(f"    CODE: {data['user_code']}\n", flush=True)
    interval = int(data.get("interval") or 5)
    deadline = time.time() + int(data.get("expires_in") or 900)
    while time.time() < deadline:
        time.sleep(interval)
        try:
            tok = http_form(
                "https://github.com/login/oauth/access_token",
                {
                    "client_id": CLIENT_ID,
                    "device_code": data["device_code"],
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                },
            )
        except Exception as e:
            print(f"[agent] poll error {e}", flush=True)
            continue
        if tok.get("access_token"):
            save_token(tok["access_token"])
            print("[agent] login ok", flush=True)
            return tok["access_token"]
        err = tok.get("error")
        if err == "authorization_pending":
            continue
        if err == "slow_down":
            interval += 5
            continue
        raise SystemExit(f"GitHub login failed: {tok}")
    raise SystemExit("GitHub login timed out")


def read_job():
    try:
        meta = api("GET", f"/repos/{REPO}/contents/{JOB_PATH}?ref={BRANCH}&t={int(time.time())}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    raw = base64.b64decode(meta.get("content") or "")
    if not raw.strip():
        return None
    return json.loads(raw.decode())


def put_result(obj: dict, token: str) -> None:
    content = base64.b64encode(json.dumps(obj, indent=2).encode()).decode()
    sha = None
    try:
        meta = api("GET", f"/repos/{REPO}/contents/{RESULT_PATH}?ref={BRANCH}", token=token)
        sha = meta.get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    payload = {
        "message": f"vps-live result {obj.get('id')}",
        "content": content,
        "branch": BRANCH,
    }
    if sha:
        payload["sha"] = sha
    api("PUT", f"/repos/{REPO}/contents/{RESULT_PATH}", payload, token=token)


def run_cmd(cmd: str, timeout: int) -> dict:
    try:
        p = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            executable="/bin/bash",
        )
        return {
            "code": p.returncode,
            "stdout": (p.stdout or "")[-400000:],
            "stderr": (p.stderr or "")[-100000:],
        }
    except subprocess.TimeoutExpired:
        return {"code": 124, "stdout": "", "stderr": "timeout"}


def hello_payload() -> dict:
    info = {
        "id": "hello",
        "code": 0,
        "ts": int(time.time()),
        "stdout": "",
        "stderr": "",
    }
    try:
        host = socket.gethostname()
        uname = subprocess.check_output(["uname", "-a"], text=True).strip()
        who = subprocess.check_output(["id"], text=True).strip()
        info["stdout"] = f"hostname={host}\n{who}\n{uname}\n"
    except Exception as e:
        info["stderr"] = str(e)
        info["code"] = 1
    return info


def main():
    print("[agent] starting on VPS", flush=True)
    token = load_token()
    if not token:
        token = device_login()
    put_result(hello_payload(), token)
    print("[agent] hello sent; polling jobs. Leave this running.", flush=True)
    last_id = "hello"
    while True:
        try:
            job = read_job()
            if job and job.get("id") and job["id"] not in (last_id, "idle"):
                jid = job["id"]
                print(f"[agent] job {jid}: {(job.get('cmd') or '')[:80]}", flush=True)
                result = run_cmd(job.get("cmd") or "true", int(job.get("timeout") or 180))
                result["id"] = jid
                result["ts"] = int(time.time())
                put_result(result, token)
                last_id = jid
                print(f"[agent] done {jid} code={result.get('code')}", flush=True)
        except KeyboardInterrupt:
            print("[agent] stop", flush=True)
            return
        except Exception as e:
            print(f"[agent] {type(e).__name__}: {e}", flush=True)
        time.sleep(4)


if __name__ == "__main__":
    main()
