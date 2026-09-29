import difflib
from .agent_tools import safe_path

def preview(path, content):
    p=safe_path(path); old=p.read_text(encoding='utf-8') if p.exists() else ''
    diff=''.join(difflib.unified_diff(old.splitlines(True), content.splitlines(True),fromfile=path,tofile=path))
    return {'path':path,'exists':p.exists(),'changed':old!=content,'diff':diff}
