#!/usr/bin/env python3
"""One-command PythonAnywhere staging install, reload, smoke test, and report push.

This only deploys the intentionally gated v10.599 scaffold: the live status API
should answer 200 while `/` should remain 503 until full parity is completed.
The helper never includes API/Git credentials in its report.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

TARGET_BRANCH = "arena/e868e86a-new"
SOURCE_BRANCH = "arena/01a0ebf7-new"
SOURCE_VERSION = "10.599"
HELPER_VERSION = "1.0.2"
REPOSITORY_HTTPS = "https://github.com/Fazilatma/new.git"


def run(args: list[str], *, cwd: Path | None = None, check: bool = True,
        env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, check=check)


def ensure_checkout(repo: Path) -> str:
    if not (repo / ".git").exists():
        if repo.exists() and any(repo.iterdir()):
            raise RuntimeError(f"REPO_DIR exists but is not an empty git checkout: {repo}")
        repo.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "--branch", TARGET_BRANCH, "--single-branch", REPOSITORY_HTTPS, str(repo)])
    if run(["git", "status", "--porcelain"], cwd=repo).stdout.strip():
        raise RuntimeError(f"Refusing to overwrite a dirty checkout: {repo}")
    run(["git", "fetch", "origin", TARGET_BRANCH], cwd=repo)
    current = run(["git", "branch", "--show-current"], cwd=repo).stdout.strip()
    if current != TARGET_BRANCH:
        run(["git", "checkout", TARGET_BRANCH], cwd=repo)
    run(["git", "pull", "--ff-only", "origin", TARGET_BRANCH], cwd=repo)
    return run(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()


def install_environment(repo: Path, venv: Path) -> None:
    if sys.version_info < (3, 10):
        raise RuntimeError(f"Python 3.10+ is required, found {platform.python_version()}")
    app_dir = repo / "pythonanywhere"
    if not (app_dir / "requirements.txt").is_file():
        raise RuntimeError(f"Python port not found under {app_dir}")
    if not (venv / "bin" / "python").is_file():
        run([sys.executable, "-m", "venv", str(venv)])
    venv_python = venv / "bin" / "python"
    venv_version = run([
        str(venv_python), "-c",
        "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
    ]).stdout.strip()
    runtime_version = f"{sys.version_info.major}.{sys.version_info.minor}"
    if venv_version != runtime_version:
        raise RuntimeError(f"Virtualenv uses Python {venv_version}, helper uses {runtime_version}; recreate or select a matching --venv-dir")
    run([str(venv_python), "-m", "pip", "install", "--upgrade", "pip"])
    run([str(venv / "bin" / "pip"), "install", "-r", str(app_dir / "requirements.txt")])


def install_wsgi(repo: Path, venv: Path, wsgi_file: Path) -> str:
    app_dir = repo / "pythonanywhere"
    wsgi_file.parent.mkdir(parents=True, exist_ok=True)
    backup = ""
    if wsgi_file.exists():
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = wsgi_file.with_name(wsgi_file.name + ".backup." + stamp)
        shutil.copy2(wsgi_file, backup_path)
        backup = str(backup_path)
    site_packages = venv / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
    contents = (
        "import sys\n"
        "import site\n"
        f"site.addsitedir({str(site_packages)!r})\n"
        f"sys.path.insert(0, {str(app_dir)!r})\n"
        "from application import app as application\n"
    )
    temp = wsgi_file.with_name(wsgi_file.name + ".new")
    temp.write_text(contents, encoding="utf-8")
    os.chmod(temp, 0o644)
    temp.replace(wsgi_file)
    return backup


def reload_pythonanywhere(username: str, domain: str) -> tuple[int, str]:
    token = os.environ.get("PA_API_TOKEN", "").strip()
    if not token:
        token = getpass.getpass("PythonAnywhere API token (input hidden; never written to report): ").strip()
    if not token:
        raise RuntimeError("PythonAnywhere reload token was empty")
    endpoint = (
        "https://www.pythonanywhere.com/api/v0/user/"
        + urllib.parse.quote(username, safe="")
        + "/webapps/"
        + urllib.parse.quote(domain, safe="")
        + "/reload/"
    )
    req = urllib.request.Request(endpoint, data=b"", method="POST", headers={"Authorization": "Token " + token})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, "reload request accepted"
    except urllib.error.HTTPError as exc:
        # Never include request headers or the token in logs/reports.
        return exc.code, f"reload API returned HTTP {exc.code}"
    except (urllib.error.URLError, TimeoutError):
        return 0, "reload API request failed or timed out"


def request_status(url: str, timeout: int = 25) -> tuple[int, dict | None]:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(1_000_000)
            try:
                return response.status, json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return response.status, None
    except urllib.error.HTTPError as exc:
        # Read no body into the report; an HTML error page might disclose details.
        return exc.code, None
    except (urllib.error.URLError, TimeoutError):
        return 0, None


def live_smoke(domain: str, wait_seconds: int) -> dict:
    base = "https://" + domain.rstrip("/")
    status_code = 0
    payload = None
    deadline = time.monotonic() + wait_seconds
    while time.monotonic() < deadline:
        status_code, payload = request_status(base + "/api/port-status")
        if status_code == 200:
            break
        time.sleep(3)
    version_ok = bool(payload and payload.get("source", {}).get("version") == SOURCE_VERSION)
    branch_ok = bool(payload and payload.get("source", {}).get("branch") == SOURCE_BRANCH)
    gated_ok = bool(payload and payload.get("deployable") is False)
    root_code, _ = request_status(base + "/")
    return {
        "host": domain,
        "port_status_http": status_code,
        "source_version_matches": version_ok,
        "source_branch_matches": branch_ok,
        "port_still_gated": gated_ok,
        "root_http": root_code,
        "root_503_is_expected": root_code == 503,
        "passed": status_code == 200 and version_ok and branch_ok and gated_ok and root_code == 503,
    }


def push_with_github_token(repo: Path) -> None:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        token = getpass.getpass("GitHub token (input hidden; never written to report): ").strip()
    if not token:
        raise RuntimeError("GitHub token was empty")

    # Keep the token out of the URL and process arguments. Git's askpass hook
    # reads it from this child process's environment only for the HTTPS push.
    with tempfile.TemporaryDirectory(prefix="pa-git-askpass-") as temp_dir:
        askpass = Path(temp_dir) / "askpass.sh"
        askpass.write_text(
            '''#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' 'x-access-token' ;;
  *Password*) printf '%s\\n' "$GITHUB_TOKEN" ;;
  *) exit 1 ;;
esac
''',
            encoding="utf-8",
        )
        os.chmod(askpass, 0o700)
        push_env = os.environ.copy()
        push_env["GITHUB_TOKEN"] = token
        push_env["GIT_ASKPASS"] = str(askpass)
        push_env["GIT_TERMINAL_PROMPT"] = "0"
        run(["git", "-c", "credential.helper=", "push", REPOSITORY_HTTPS,
             f"HEAD:refs/heads/{TARGET_BRANCH}"], cwd=repo, env=push_env)


def push_report(repo: Path, report: dict) -> tuple[str, str, dict]:
    reports_dir = repo / "pythonanywhere" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report_path = reports_dir / f"pa-smoke-{stamp}-{os.getpid()}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Rebase on the newest required branch tip before making the report commit.
    run(["git", "fetch", "origin", TARGET_BRANCH], cwd=repo)
    run(["git", "rebase", f"origin/{TARGET_BRANCH}"], cwd=repo)
    run(["git", "add", str(report_path.relative_to(repo))], cwd=repo)
    run([
        "git", "-c", "user.name=PythonAnywhere Smoke Helper",
        "-c", "user.email=pythonanywhere-smoke@users.noreply.github.com",
        "commit", "-m", f"Add PythonAnywhere smoke report {stamp}",
    ], cwd=repo)
    try:
        push_with_github_token(repo)
        commit = run(["git", "rev-parse", "HEAD"], cwd=repo).stdout.strip()
        rel_path = str(report_path.relative_to(repo))
        run(["git", "fetch", "origin", TARGET_BRANCH], cwd=repo)
        raw = run(["git", "show", f"origin/{TARGET_BRANCH}:{rel_path}"], cwd=repo).stdout
        readback = json.loads(raw)
        return rel_path, commit, readback
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("Report was saved locally but push/readback failed; check that the GitHub token has repository write access. " + exc.stdout[-500:]) from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--allow-incomplete-staging", action="store_true",
                        help="explicitly allow deploying the incomplete gated scaffold for smoke testing")
    parser.add_argument("--repo-dir", type=Path, default=Path.home() / "new")
    parser.add_argument("--venv-dir", type=Path, default=Path.home() / ".virtualenvs" / "scraper4-pa")
    parser.add_argument("--wsgi-file", type=Path)
    parser.add_argument("--username", default=os.environ.get("PA_USER", "fazilatma"))
    parser.add_argument("--domain", default=os.environ.get("PA_API_DOMAIN", "fazilatma.pythonanywhere.com"))
    parser.add_argument("--live-host", default=os.environ.get("LIVE_HOST", "Fazilatma.pythonanywhere.com"))
    parser.add_argument("--wait-seconds", type=int, default=60)
    args = parser.parse_args()

    if not args.allow_incomplete_staging:
        parser.error("this port is incomplete; pass --allow-incomplete-staging only for the gated status smoke test")
    wsgi = args.wsgi_file or Path(f"/var/www/{args.username}_pythonanywhere_com_wsgi.py")
    report = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "helper_version": HELPER_VERSION,
        "target_branch": TARGET_BRANCH,
        "source_branch": SOURCE_BRANCH,
        "expected_source_version": SOURCE_VERSION,
        "python_version": platform.python_version(),
        "host": args.live_host,
        "deployable": False,
        "errors": [],
    }
    try:
        report["deployed_commit"] = ensure_checkout(args.repo_dir)
        install_environment(args.repo_dir, args.venv_dir)
        report["wsgi_file"] = str(wsgi)
        report["wsgi_backup"] = install_wsgi(args.repo_dir, args.venv_dir, wsgi)
        reload_code, reload_message = reload_pythonanywhere(args.username, args.domain)
        report["reload_http"] = reload_code
        report["reload_message"] = reload_message
        report["smoke"] = live_smoke(args.live_host, max(10, args.wait_seconds))
        report["passed"] = reload_code in (200, 201, 202) and report["smoke"]["passed"]
    except Exception as exc:  # report a concise error; don't dump env or credentials
        report["passed"] = False
        report["errors"].append(f"{type(exc).__name__}: {str(exc)[:400]}")

    try:
        report_file, report_commit, branch_readback = push_report(args.repo_dir, report)
        report["report_path"] = report_file
        report["report_commit"] = report_commit
        report["report_pushed"] = True
        report["branch_readback_ok"] = branch_readback == {key: value for key, value in report.items() if key not in {
            "report_path", "report_commit", "report_pushed", "branch_readback_ok", "branch_readback"
        }}
        report["branch_readback"] = branch_readback
    except Exception as exc:
        report["report_pushed"] = False
        report["report_push_error"] = f"{type(exc).__name__}: {str(exc)[:400]}"
        local_report = Path(args.repo_dir) / "pythonanywhere" / "reports"
        local_report.mkdir(parents=True, exist_ok=True)
        fallback = local_report / f"pa-smoke-local-{int(time.time())}.json"
        fallback.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        report["local_report_path"] = str(fallback)

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("passed") and report.get("report_pushed") else 1


if __name__ == "__main__":
    raise SystemExit(main())
