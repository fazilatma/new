from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import Response, FileResponse
from .models import Provider, ModelSpec
from .providers import ProviderStore

store=ProviderStore(str(Path(__file__).parents[1]/'data/providers.json'))
app=FastAPI(title='Arena-like Coding Agent')

@app.get('/ui')
def ui():
    return FileResponse(Path(__file__).parent / 'static' / 'index.html')

@app.get('/')
def root():
    return {
        'name': 'Arena Python Agent',
        'status': 'ok',
        'docs': '/docs',
        'providers': '/api/providers'
    }

@app.get('/health')
def health():
    return {'status': 'ok'}

@app.get('/api/providers')
def providers(): return store.all()
@app.put('/api/providers/{pid}')
def put_provider(pid:str,p:Provider):
    if p.id!=pid: raise HTTPException(400,'id mismatch')
    return store.upsert(p)
@app.delete('/api/providers/{pid}')
def del_provider(pid:str): store.delete(pid); return {'ok':True}
@app.post('/api/providers/{pid}/models')
def add_model(pid:str,m:ModelSpec):
    if pid not in store.data: raise HTTPException(404,'provider not found')
    store.add_model(pid,m); return m
@app.put('/api/providers/{pid}/models/{mid}')
def update_model(pid:str,mid:str,m:ModelSpec):
    if pid not in store.data: raise HTTPException(404,'provider not found')
    store.update_model(pid,mid,m); return m
@app.delete('/api/providers/{pid}/models/{mid}')
def del_model(pid:str,mid:str): store.delete_model(pid,mid); return {'ok':True}
@app.get('/api/providers/export')
def export_models(): return Response(store.export_json(),media_type='application/json',headers={'Content-Disposition':'attachment; filename=providers.json'})
@app.post('/api/providers/import')
async def import_models(file:UploadFile=File(...),replace:bool=False):
    store.import_json((await file.read()).decode(),replace); return {'ok':True,'count':len(store.data)}
