import json, os
from pathlib import Path
from .models import Provider, ModelSpec

class ProviderStore:
    def __init__(self, path: str): self.path=Path(path); self.data=self._load()
    def _load(self):
        raw=json.loads(self.path.read_text()) if self.path.exists() else {}
        return {k:Provider.model_validate(v) for k,v in raw.items()}
    def save(self): self.path.write_text(json.dumps({k:v.model_dump(exclude_none=True) for k,v in self.data.items()}, ensure_ascii=False, indent=2))
    def public(self, p):
        x=p.model_dump(); key=x.pop('apiKey',''); x['hasApiKey']=bool(key or os.getenv(p.apiKeyEnv)); return x
    def all(self): return [self.public(p) for p in self.data.values()]
    def upsert(self,p): self.data[p.id]=p; self.save(); return self.public(p)
    def delete(self,pid): self.data.pop(pid, None); self.save()
    def add_model(self,pid,m): self.data[pid].models.append(m); self.save()
    def update_model(self,pid,mid,m):
        p=self.data[pid]; p.models=[m if x.id==mid else x for x in p.models]; self.save()
    def delete_model(self,pid,mid): self.data[pid].models=[x for x in self.data[pid].models if x.id!=mid]; self.save()
    def export_json(self): return json.dumps({k:v.model_dump(exclude_none=True) for k,v in self.data.items()}, ensure_ascii=False, indent=2)
    def import_json(self, text, replace=False):
        incoming=json.loads(text); parsed={k:Provider.model_validate(v) for k,v in incoming.items()}
        if replace: self.data=parsed
        else: self.data.update(parsed)
        self.save()
