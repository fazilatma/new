from pathlib import Path
import difflib
from .agent_tools import safe_path

def preview(path, content):
    p=safe_path(path); old=p.read_text(encoding='utf-8') if p.exists() else ''
    diff=''.join(difflib.unified_diff(old.splitlines(True), content.splitlines(True),fromfile=path,tofile=path))
    return {'path':path,'exists':p.exists(),'changed':old!=content,'diff':diff}

BACKUP=Path(__file__).parents[1]/'data'/'backups'; BACKUP.mkdir(exist_ok=True)
def backup(path):
 p=safe_path(path)
 if not p.exists(): return None
 import time, shutil
 target=BACKUP/(str(int(time.time()*1000))+'_'+p.name); shutil.copy2(p,target); return str(target)
def rollback(path, backup_path):
 import shutil
 p=safe_path(path); b=Path(backup_path).resolve()
 if BACKUP not in b.parents: raise ValueError('Invalid backup')
 shutil.copy2(b,p); return {'path':path,'rolledBack':True}
def backups(path):
 import os
 p=safe_path(path); return sorted([str(x) for x in BACKUP.glob('*_'+p.name)], reverse=True)
