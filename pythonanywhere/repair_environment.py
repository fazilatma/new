"""Standard-library-only preflight when the virtualenv was accidentally removed.

No imports of the Flask package, no schema writes, no replacement encryption key.
Bootstrap owns the worker lock before invoking backup.
"""
import importlib.util
import os
from pathlib import Path
import sqlite3
import sys


def installed_settings(app):
    app=Path(app).resolve()
    if not (app/'.env').is_file():raise RuntimeError('Existing .env is required; refusing to invent encryption credentials')
    os.chdir(app)
    os.environ['S4_BASE_DIR']=str(app)
    spec=importlib.util.spec_from_file_location('_s4_repair_config',app/'scraper4/config.py')
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    cfg=module.Settings.load(app/'.env')
    if not cfg.secret_key:raise RuntimeError('Existing S4_SECRET_KEY is missing; restore .env before proceeding')
    return cfg


def backup(app,destination):
    cfg=installed_settings(app);source=cfg.db_path.resolve()
    if not source.is_file():raise RuntimeError('Existing database missing; refusing to create an empty replacement')
    target=Path(destination)
    # Exclusive creation, private even when invoked outside bootstrap.
    fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(target) as dst:
        if src.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise RuntimeError('Database quick_check failed')
        src.backup(dst)
    return target


if __name__=='__main__':
    if sys.argv[1]=='lock-path':print(installed_settings(sys.argv[2]).db_path.resolve().with_suffix('.worker.lock'))
    elif sys.argv[1]=='backup':print(backup(sys.argv[2],sys.argv[3]))
    else:raise SystemExit('Unknown repair preflight operation')
