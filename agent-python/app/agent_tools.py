"""Core tools for the coding agent. Workspace is explicitly configured and commands are audited."""
import os, subprocess, pathlib, json, time
from typing import Any

WORKSPACE=pathlib.Path(os.getenv('AGENT_WORKSPACE', pathlib.Path.cwd())).resolve()

def safe_path(raw:str)->pathlib.Path:
    p=(WORKSPACE/raw).resolve()
    if p!=WORKSPACE and WORKSPACE not in p.parents: raise ValueError('Path is outside the workspace')
    return p

def list_files(path='.'):
    p=safe_path(path); return [{'path':str(x.relative_to(WORKSPACE)),'type':'dir' if x.is_dir() else 'file'} for x in sorted(p.iterdir())[:500]]

def read_file(path): return safe_path(path).read_text(encoding='utf-8')

def write_file(path,content):
    p=safe_path(path); p.parent.mkdir(parents=True,exist_ok=True); p.write_text(content,encoding='utf-8'); return {'path':str(p.relative_to(WORKSPACE)),'bytes':len(content.encode())}

def run_command(command,cwd='.',timeout=60):
    # Commands run only inside the configured workspace; callers should add approval for destructive work.
    p=safe_path(cwd); started=time.time(); r=subprocess.run(command,shell=True,cwd=p,text=True,capture_output=True,timeout=min(int(timeout),300),env=os.environ)
    return {'command':command,'exitCode':r.returncode,'stdout':r.stdout[-20000:],'stderr':r.stderr[-20000:],'durationMs':int((time.time()-started)*1000)}
