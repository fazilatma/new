"""PythonAnywhere WSGI configuration template.

In the PythonAnywhere Web tab, add this directory to the virtualenv/source path
and set the WSGI file to this file. The app intentionally returns 503 at `/`
until the full-parity gate in application.py is enabled.
"""
from pathlib import Path
import sys

project_dir = str(Path(__file__).resolve().parent)
if project_dir not in sys.path:
    sys.path.insert(0, project_dir)

from application import app as application  # noqa: E402,F401
