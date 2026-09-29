#!/usr/bin/env python3
"""Regression tests for 10.253 — the universal service launcher (service.py)
and the old-Python guard, born from a real shared-host failure:

    File "scraper4.py", line 86
        from __future__ import annotations
    SyntaxError: future feature annotations is not defined

(the WebConsole service manager ran the app with Python <= 3.6).

    python3 tools/test_service_launcher.py
"""
from __future__ import annotations

import ast
import importlib.util
import os
import shutil
import stat
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SERVICE = os.path.join(ROOT, "service.py")
SCRAPER = os.path.join(ROOT, "scraper4.py")

FAILURES: list[str] = []


def check(name: str, cond, detail: str = "") -> None:
    if cond:
        print(f"  ✓ {name}")
    else:
        FAILURES.append(name)
        print(f"  ✕ {name}" + (f" — {detail}" if detail else ""))


SHIM = """#!/bin/sh
case "$2" in
  *"sys.exit(0 if sys.version_info"*) exit {modern} ;;
  *"import flask"*) exit {flask} ;;
  *"sys.version_info[:3]"*) echo "{ver}"; exit 0 ;;
esac
echo "$@" > "{log}"
exit 7
"""


def make_shim(directory, name, modern, flask, ver, log):
    path = os.path.join(directory, name)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(SHIM.format(modern=modern, flask=flask, ver=ver, log=log))
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC)
    return path


def load_service():
    import importlib.util
    spec = importlib.util.spec_from_file_location("s4_service", SERVICE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    tmp = tempfile.mkdtemp(prefix="s4-svc-253-")
    bindir = os.path.join(tmp, "bin")
    os.makedirs(bindir)
    exec_log = os.path.join(tmp, "exec.log")

    # an "app dir" copy so candidates() venv logic stays inside the sandbox
    appdir = os.path.join(tmp, "app")
    os.makedirs(appdir)
    shutil.copyfile(SERVICE, os.path.join(appdir, "service.py"))
    with open(os.path.join(appdir, "scraper4.py"), "w", encoding="utf-8") as fh:
        fh.write("# stand-in app\n")

    py36 = make_shim(bindir, "python3", 1, 1, "3.6.8", exec_log)      # old
    py39 = make_shim(bindir, "python39", 0, 1, "3.9.7", exec_log)     # modern, no flask
    py311 = make_shim(bindir, "python311", 0, 0, "3.11.9", exec_log)  # modern + flask
    py313 = make_shim(bindir, "python313", 0, 0, "3.13.1", exec_log)  # modern + flask

    try:
        print("== A: syntax compatible with ancient interpreters ==")
        src = open(SERVICE, encoding="utf-8").read()
        try:
            tree = ast.parse(src, feature_version=(3, 5))
            check("A1 parses at the 3.5 feature level", True)
        except SyntaxError as exc:
            check("A1 parses at the 3.5 feature level", False, str(exc)[:120])
        banned = (ast.JoinedStr, ast.NamedExpr)
        found = [type(n).__name__ for n in ast.walk(tree)
                 if isinstance(n, banned) or type(n).__name__.startswith("Match")]
        check("A2 no f-strings / walrus / match", not found, str(found))
        code_only = ast.unparse(ast.parse(src))  # docstrings/comments gone
        check("A3 no pathlib / subprocess.run / f-string shortcuts",
              "import pathlib" not in code_only and "subprocess.run" not in code_only
              and ".run(" not in code_only and "f'" not in code_only
              and 'f"' not in code_only)

        print("== B: candidate order (env → venv → panel → versioned) ==")
        svc = load_service()
        os.environ["SCRAPER4_PYTHON"] = py36
        try:
            venv_py = os.path.join(appdir, "venv", "bin", "python")
            os.makedirs(os.path.dirname(venv_py), exist_ok=True)
            shutil.copyfile(py39, venv_py)
            os.chmod(venv_py, os.stat(venv_py).st_mode | stat.S_IEXEC)
            spec = importlib.util.spec_from_file_location(
                "s4_service_app", os.path.join(appdir, "service.py"))
            svc_app = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(svc_app)
            cands = svc_app.candidates()
            check("B1 SCRAPER4_PYTHON first", cands and cands[0] == py36, str(cands[:2]))
            check("B2 project venv second", len(cands) > 1 and cands[1] == venv_py,
                  str(cands[:3]))
            check("B3 duplicates removed",
                  len(cands) == len(set(cands)))
        finally:
            os.environ.pop("SCRAPER4_PYTHON", None)

        print("== C: resolution prefers a modern python WITH deps ==")
        svc = load_service()
        real_candidates = svc.candidates()
        svc.candidates = lambda: [py36, py39, py311]
        bin_path, has_flask, tried = svc.resolve()
        check("C1 flask-capable modern interpreter chosen",
              bin_path == py311 and has_flask is True, f"{bin_path} flask={has_flask}")
        check("C2 old interpreter rejected with a reason",
              any(p == py36 for p, _ in tried), str(tried)[:120])
        svc.candidates = lambda: [py36, py39]
        bin_path, has_flask, _ = svc.resolve()
        check("C3 flask-less modern kept as fallback",
              bin_path == py39 and has_flask is False, f"{bin_path} flask={has_flask}")
        svc.candidates = lambda: [py36]
        bin_path, _, tried = svc.resolve()
        check("C4 nothing qualifies without a modern python",
              bin_path == "" and len(tried) == 1, str(tried))

        print("== D: full run — forced interpreter, args and exit code ==")
        if os.path.exists(exec_log):
            os.remove(exec_log)
        proc = subprocess.run(
            [sys.executable, os.path.join(appdir, "service.py"), "--port", "8000"],
            env={**os.environ, "SCRAPER4_PYTHON": py313,
                 "PATH": bindir + os.pathsep + os.environ.get("PATH", "")},
            capture_output=True, text=True, timeout=60)
        check("D1 exec'd the forced interpreter (exit code propagates)",
              proc.returncode == 7, f"rc={proc.returncode} out={proc.stdout[:150]}")
        logged = open(exec_log, encoding="utf-8").read() if os.path.exists(exec_log) else ""
        check("D2 target script forwarded",
              os.path.join(appdir, "scraper4.py") in logged, logged)
        check("D3 extra args forwarded", "--port 8000" in logged, logged)
        check("D4 announces the chosen python",
              "3.13.1" in proc.stdout, proc.stdout[:200])

        print("== E: --check resolves without starting ==")
        if os.path.exists(exec_log):
            os.remove(exec_log)
        proc = subprocess.run(
            [sys.executable, os.path.join(appdir, "service.py"), "--check"],
            env={**os.environ, "SCRAPER4_PYTHON": py311,
                 "PATH": bindir + os.pathsep + os.environ.get("PATH", "")},
            capture_output=True, text=True, timeout=60)
        check("E1 --check exits 0", proc.returncode == 0,
              f"rc={proc.returncode} {proc.stdout[:150]}{proc.stderr[:150]}")
        check("E2 --check does not exec the app", not os.path.exists(exec_log))
        check("E3 --check prints the resolution", "3.11.9" in proc.stdout
              and "--check" in proc.stdout, proc.stdout[:200])

        print("== F: no-python message is actionable ==")
        svc = load_service()
        svc.candidates = lambda: [py36]
        import io as _io
        import contextlib
        buf = _io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = svc.main()
        out = buf.getvalue()
        check("F1 exit code 1 when nothing qualifies", code == 1, str(code))
        check("F2 Persian guidance with the cPanel fix",
              "Setup Python App" in out and "SCRAPER4_PYTHON" in out, out[:200])
        check("F3 mentions the service command change",
              "python3 service.py" in out, out[:300])
        check("F4 lists the rejected interpreter with a reason",
              os.path.basename(py36) in out, out[:300])

        print("== G: missing scraper4.py beside the launcher ==")
        lonely = os.path.join(tmp, "lonely")
        os.makedirs(lonely)
        shutil.copyfile(SERVICE, os.path.join(lonely, "service.py"))
        proc = subprocess.run(
            [sys.executable, os.path.join(lonely, "service.py")],
            env={**os.environ, "SCRAPER4_PYTHON": py311,
                 "PATH": bindir + os.pathsep + os.environ.get("PATH", "")},
            capture_output=True, text=True, timeout=60)
        check("G1 clean error when the app file is missing",
              proc.returncode == 1 and "scraper4.py" in proc.stdout,
              proc.stdout[:150])

        print("== H: old-python guard inside scraper4.py ==")
        s4 = open(SCRAPER, encoding="utf-8").read()
        guard_pos = s4.find("if _startup_sys.version_info < (3, 9):")
        future_pos = s4.find("from __future__ import annotations")
        first_import = s4.find("import asyncio")
        check("H1 guard exists after the future import and before everything",
              0 < future_pos < guard_pos < first_import,
              f"future={future_pos} guard={guard_pos} asyncio={first_import}")
        check("H2 guard message points to service.py",
              "python3 service.py" in s4[guard_pos:guard_pos + 400])
        # and a normal modern import still works
        proc = subprocess.run(
            [sys.executable, "-c",
             "import sys; sys.path.insert(0, %r); import scraper4; "
             "print(scraper4.APP_VERSION)" % ROOT],
            capture_output=True, text=True, timeout=120,
            env={**os.environ, "SCRAPER_DATA_FILE": os.path.join(tmp, "d.json"),
                 "SCRAPER4_AUTO_INSTALL": "0"})
        check("H3 scraper4 still imports cleanly on this python",
              proc.returncode == 0 and "10.253" in proc.stdout,
              (proc.stdout + proc.stderr)[-200:])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if FAILURES:
        print(f"FAILED: {len(FAILURES)} check(s): " + ", ".join(FAILURES))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
