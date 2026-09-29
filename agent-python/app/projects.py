import json
from pathlib import Path
FILE=Path(__file__).parents[1]/'data'/'projects.json'
def all_projects(): return json.loads(FILE.read_text()) if FILE.exists() else []
def save(items): FILE.parent.mkdir(exist_ok=True);FILE.write_text(json.dumps(items,ensure_ascii=False,indent=2));return items
def create(p):
 items=all_projects();items.append(p);return save(items)
def delete(pid): return save([p for p in all_projects() if p.get('id')!=pid])
