"""PythonAnywhere WSGI entrypoint (not a development server)."""
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
if str(BASE) not in sys.path:
    sys.path.insert(0, str(BASE))
from scraper4 import create_app

application = create_app()
