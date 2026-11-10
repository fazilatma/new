"""Deleted venv repair preflight runs without site-packages, preserves live data."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import pytest

ROOT=Path(__file__).resolve().parents[1]


def installation(tmp_path):
    app=tmp_path/'app';(app/'scraper4').mkdir(parents=True)
    shutil.copyfile(ROOT/'scraper4/config.py',app/'scraper4/config.py')
    (app/'.env').write_text('S4_SECRET_KEY=keep-encrypted-connections\nS4_PASSWORD=keep-password\nS4_ACCESS_MODE=open\nS4_DB='+str(app/'custom.sqlite3')+'\n')
    with sqlite3.connect(app/'custom.sqlite3') as c:c.execute('CREATE TABLE sentinel (value TEXT)');c.execute("INSERT INTO sentinel VALUES ('keep-products-and-remote-ids')")
    return app


def run(app,*args):
    env={k:v for k,v in os.environ.items() if not k.startswith('S4_')}
    return subprocess.run([sys.executable,'-S',str(ROOT/'repair_environment.py'),*args,str(app)] if args==('lock-path',) else [sys.executable,'-S',str(ROOT/'repair_environment.py'),*args],env=env,text=True,capture_output=True)


def test_deleted_venv_preflight_uses_only_stdlib_and_backs_up_custom_database(tmp_path):
    app=installation(tmp_path);before=(app/'.env').read_bytes();db_before=(app/'custom.sqlite3').read_bytes()
    p=run(app,'lock-path');assert p.returncode==0,p.stderr
    assert p.stdout.strip()==str(app/'custom.worker.lock')
    dest=tmp_path/'backup.sqlite3';p=run(app,'backup',str(app),str(dest));assert p.returncode==0,p.stderr
    with sqlite3.connect(dest) as c:assert c.execute('SELECT value FROM sentinel').fetchone()[0]=='keep-products-and-remote-ids'
    assert dest.stat().st_mode&0o777==0o600
    assert (app/'.env').read_bytes()==before and (app/'custom.sqlite3').read_bytes()==db_before
    assert not (tmp_path/'.virtualenvs').exists()


def test_missing_key_or_db_refuses_empty_replacement(tmp_path):
    app=installation(tmp_path);(app/'.env').write_text('S4_DB='+str(app/'custom.sqlite3'))
    p=run(app,'lock-path');assert p.returncode!=0 and 'S4_SECRET_KEY' in p.stderr
    (app/'.env').write_text('S4_SECRET_KEY=keep\n');dest=tmp_path/'backup'
    p=run(app,'backup',str(app),str(dest));assert p.returncode!=0 and not dest.exists()


def test_missing_venv_bootstrap_keeps_lock_before_backup_and_code_copy():
    s=(ROOT/'bootstrap.sh').read_text()
    assert 'Existing .env detected but its virtualenv was not found' not in s
    assert s.index('flock -n 9')<s.index('repair_environment.py" backup')<s.index('cp -R "$STAGE/."')
    assert '"$VENV/bin/python" -m scraper4 backup' not in s


def test_missing_venv_detection_chooses_recorded_web_python_not_new_default(tmp_path):
    from test_python_detection import block
    app=tmp_path/'app';app.mkdir();version=f'{sys.version_info.major}.{sys.version_info.minor}'
    (app/'.runtime.json').write_text(json.dumps({'python_version':version}))
    bindir=tmp_path/'bin';bindir.mkdir()
    (bindir/'python3').symlink_to(sys.executable);(bindir/('python'+version)).symlink_to(sys.executable)
    env={**os.environ,'HOME':str(tmp_path),'APP_DIR':str(app),'PATH':str(bindir)}
    env.pop('PYTHON_BIN',None);env.pop('S4_VENV',None)
    p=subprocess.run(['/bin/bash','-c','set -euo pipefail\n'+block('bootstrap.sh')],env=env,text=True,capture_output=True)
    assert p.returncode==0,p.stderr
    assert 'Using Python: python'+version in p.stdout
    (bindir/('python'+version)).unlink()
    p=subprocess.run(['/bin/bash','-c','set -euo pipefail\n'+block('bootstrap.sh')],env=env,text=True,capture_output=True)
    assert p.returncode!=0 and 'unavailable' in p.stderr
