#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Universal service launcher for scraper4 (10.253).

WHY THIS EXISTS
---------------
The WebConsole service manager starts this app with whatever ``python3`` is
first on PATH. On shared/cPanel hosts that interpreter is often ancient
(CentOS 7 ships 3.6, some panels even 2.7), and scraper4.py — which needs
Python >= 3.9 — dies with ``SyntaxError: future feature annotations is not
defined`` before a single line of our code can explain the problem.

This file is deliberately written in syntax that even Python 2.7 and 3.5 can
parse (no f-strings, no walrus, no pathlib). Point the service command at it:

    python3 service.py          (any python works — it finds the right one)

Resolution order:
  1. $SCRAPER4_PYTHON           — absolute path, forced, wins over everything
  2. ./venv/bin/python          — a project virtualenv, if present
  3. Panel pythons              — /opt/cpanel/ea-python3*, /opt/alt/python3*
  4. Versioned pythons          — python3.14 … python3.9 in PATH and the
                                  usual bin dirs, newest first
  5. Plain python3 / python

A candidate is accepted when it reports >= 3.9. Among accepted candidates the
first one that can also ``import flask`` (deps installed) is preferred, so
the service uses the interpreter the console's install button installed into.
``service.py --check`` prints the resolution without starting anything.
"""
from __future__ import print_function

import glob
import os
import subprocess
import sys

MIN_VERSION = (3, 9)

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "scraper4.py")

VERSION_CHECK = "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"
FLASK_CHECK = "import flask, requests"


def _decode(data):
    if isinstance(data, bytes):
        return data.decode("utf-8", "replace")
    return data


def _run(bin_path, code):
    """Run ``bin_path -c code``; return (ok, output). Safe on old pythons."""
    try:
        proc = subprocess.Popen([bin_path, "-c", code],
                                stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT)
    except OSError:
        return False, ""
    out = proc.communicate()[0]
    return proc.returncode == 0, _decode(out or "").strip()


def _is_executable(path):
    return bool(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def _which(name):
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        if not directory:
            continue
        candidate = os.path.join(directory, name)
        if _is_executable(candidate):
            return candidate
    return ""


def candidates():
    """Every interpreter worth trying, best-first."""
    out = []

    def add(path):
        paths = path if isinstance(path, (list, tuple)) else [path]
        for one in paths:
            if one and one not in out and _is_executable(one):
                out.append(one)

    add(os.environ.get("SCRAPER4_PYTHON", ""))
    add(os.path.join(HERE, "venv", "bin", "python"))
    add(os.path.join(HERE, ".venv", "bin", "python"))
    # cPanel / CloudLinux panel pythons (newest first)
    for pattern in ("/opt/cpanel/ea-python3*/bin/python3",
                    "/opt/alt/python3*/bin/python3",
                    "/usr/local/lsws/lsphp*/bin/lsphp"):
        add(glob.glob(pattern))
    # Versioned interpreters, newest first
    for minor in (14, 13, 12, 11, 10, 9):
        name = "python3.%d" % minor
        add(_which(name))
        add(glob.glob("/usr/local/bin/%s" % name))
        add(glob.glob("/usr/bin/%s" % name))
        add(glob.glob(os.path.join(os.path.expanduser("~"),
                                   ".local", "bin", name)))
    add(_which("python3"))
    add("/usr/local/bin/python3")
    add("/usr/bin/python3")
    add(_which("python"))
    return out


def resolve(verbose=True):
    """Return (path, has_flask, tried) — path is '' when nothing qualifies."""
    tried = []
    fallback = ""
    for bin_path in candidates():
        ok, out = _run(bin_path, VERSION_CHECK)
        if not ok:
            tried.append((bin_path, out or "قدیمی/غیرقابل اجرا"))
            continue
        flask_ok, _ = _run(bin_path, FLASK_CHECK)
        if flask_ok:
            return bin_path, True, tried
        if not fallback:
            fallback = bin_path
        tried.append((bin_path, "3.9+ اما وابستگی‌ها نصب نیست"))
    return fallback, False, tried


def report_no_python(tried):
    print("=" * 62)
    print("[service] ERROR: هیچ پایتون سازگار (3.9+) برای scraper4 پیدا نشد")
    print("[service] No compatible Python (3.9+) found on this host.")
    print("=" * 62)
    if tried:
        print("[service] مفسرهای امتحان‌شده و دلیل رد:")
        for path, why in tried:
            print("  - %s  →  %s" % (path, why))
    print("[service] راه‌حل‌ها / fixes:")
    print("  1) هاست cPanel: «Setup Python App» یک پایتون 3.11+ می‌سازد")
    print("     (مسیرش معمولاً /opt/cpanel/ea-python311/bin/python3 است)")
    print("     و سپس دکمهٔ نصب/به‌روزرسانی وابستگی‌های WebConsole را بزنید.")
    print("  2) یا پایتون 3.9+ نصب کنید و مسیرش را در متغیر SCRAPER4_PYTHON")
    print("     برای سرویس تنظیم کنید (service.py همان مسیر را اجرا می‌کند).")
    print("  3) دستور سرویس باید «python3 service.py» باشد نه")
    print("     «python3 scraper4.py» — با پایتون قدیمی هم این فایل اجرا می‌شود")
    print("     و خودش مفسر درست را پیدا می‌کند.")
    print("[service] برای آزمایش بدون اجرا:  python3 service.py --check")


def main():
    args = [a for a in sys.argv[1:] if a != "--check"]
    check_only = "--check" in sys.argv[1:]
    if not os.path.isfile(TARGET):
        print("[service] ERROR: scraper4.py کنار service.py پیدا نشد: %s" % TARGET)
        return 1

    bin_path, has_flask, tried = resolve()
    if not bin_path:
        report_no_python(tried)
        return 1

    label = bin_path if has_flask else (bin_path + " (بدون وابستگی‌ها)")
    ver_ok, ver_out = _run(bin_path, "import sys; print('%d.%d.%d' % sys.version_info[:3])")
    print("[service] python %s → %s" % (ver_out or "?", label))
    if not has_flask:
        print("[service] هشدار: این پایتون flask/requests ندارد؛ اگر برنامه")
        print("[service] با خطای کتابخانه بالا آمد، دکمهٔ نصب وابستگی‌های")
        print("[service] WebConsole را با همین پایتون اجرا کنید یا مسیر مفسر")
        print("[service] نصب‌شده را در SCRAPER4_PYTHON بگذارید.")
    if check_only:
        print("[service] --check: اجرا نشد (فقط بررسی)")
        return 0

    sys.stdout.flush()
    sys.stderr.flush()
    os.execv(bin_path, [bin_path, TARGET] + args)
    return 0  # never reached on success


if __name__ == "__main__":
    sys.exit(main())
