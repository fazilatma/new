import json, os
from pathlib import Path
from .models import Provider, ModelSpec

class ProviderStore:
    def __init__(self, path: str): self.path=Path(os.getenv('PROVIDERS_FILE', str(Path(path).with_name('runtime-providers.json')))); self.path.parent.mkdir(parents=True, exist_ok=True); self.data=self._load()
    def _load(self):
        
        if self.path.exists():
            raw=json.loads(self.path.read_text())
        else:
            seed=Path(__file__).parents[1]/'data/providers.json'
            raw=json.loads(seed.read_text()) if seed.exists() else {}
        return {k:Provider.model_validate(v) for k,v in raw.items()}
    def save(self): tmp=self.path.with_suffix('.tmp'); tmp.write_text(json.dumps({k:v.model_dump(exclude_none=True) for k,v in self.data.items()}, ensure_ascii=False, indent=2)); tmp.replace(self.path)
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
