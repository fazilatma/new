"""Exercise the actual standalone shell detection block without installing anything."""
import ast
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def block(name):
    text=(ROOT/name).read_text()
    return text.split('# BEGIN PYTHON DETECTION',1)[1].split('\n',1)[1].split('# END PYTHON DETECTION',1)[0]


def interpreter(path, version):
    path.parent.mkdir(parents=True,exist_ok=True)
    major,minor=map(int,version.split('.')[:2])
    supported=major>3 or (major==3 and minor>=10)
    path.write_text('#!/bin/sh\n' + f'''case "$2" in
  *sys.exit*) exit {0 if supported else 1} ;;
  *sys.version_info*) echo '{major}.{minor}' ;;
  *) echo '{version}' ;;
esac
''')
    path.chmod(0o700)


def detect(tmp_path, executables, extra=None):
    bindir=tmp_path/'bin'
    bindir.mkdir(exist_ok=True)
    for name,version in executables.items():
        interpreter(bindir/name,version)
    env={**os.environ,'HOME':str(tmp_path),'PATH':str(bindir),'APP_DIR':str(tmp_path/'app')}
    for name in ('PYTHON_BIN','S4_VENV'):
        env.pop(name,None)
    env.update(extra or {})
    return subprocess.run(['/bin/bash','-c','set -euo pipefail\n'+block('bootstrap.sh')],
                          env=env,text=True,capture_output=True)


def test_detection_blocks_match():
    assert block('bootstrap.sh')==block('install.sh')


def test_python310_only(tmp_path):
    result=detect(tmp_path,{'python3.10':'3.10.12'})
    assert result.returncode==0
    assert 'python3.10 (3.10.12)' in result.stdout


def test_python312_without_python311(tmp_path):
    result=detect(tmp_path,{'python3.12':'3.12.4'})
    assert result.returncode==0
    assert 'python3.12' in result.stdout


def test_default_python3_supported(tmp_path):
    result=detect(tmp_path,{'python3':'3.10.12','python3.12':'3.12.4'})
    assert result.returncode==0
    assert 'python3 (3.10.12)' in result.stdout


def test_old_default_falls_back(tmp_path):
    result=detect(tmp_path,{'python3':'3.9.18','python3.12':'3.12.4'})
    assert result.returncode==0
    assert 'python3.12' in result.stdout


def test_explicit_missing_is_clear_error(tmp_path):
    result=detect(tmp_path,{'python3':'3.12.4'},{'PYTHON_BIN':'python3.11'})
    assert result.returncode!=0
    assert "Selected interpreter 'python3.11'" in result.stderr


def test_no_compatible_interpreter(tmp_path):
    result=detect(tmp_path,{'python3':'3.9.18'})
    assert result.returncode!=0
    assert 'No usable Python 3.10+' in result.stderr


def test_existing_venv_preferred(tmp_path):
    venv=tmp_path/'.virtualenvs'/'scraper4'
    interpreter(venv/'bin/python','3.10.12')
    result=detect(tmp_path,{'python3':'3.12.4'})
    assert result.returncode==0
    assert str(venv/'bin/python') in result.stdout


def test_explicit_version_mismatch_does_not_modify_venv(tmp_path):
    venv=tmp_path/'.virtualenvs'/'scraper4'
    interpreter(venv/'bin/python','3.10.12')
    before=(venv/'bin/python').read_bytes()
    result=detect(tmp_path,{'python3.12':'3.12.4'},{'PYTHON_BIN':'python3.12'})
    assert result.returncode!=0
    assert 'differs from existing virtualenv' in result.stderr
    assert (venv/'bin/python').read_bytes()==before


def test_python310_syntax():
    for path in (ROOT/'scraper4').rglob('*.py'):
        ast.parse(path.read_text(),filename=str(path),feature_version=(3,10))
