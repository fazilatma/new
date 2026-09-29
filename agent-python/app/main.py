from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import Response, FileResponse
from .models import Provider, ModelSpec
from .providers import ProviderStore
from .agent_tools import list_files, read_file, write_file, run_command
from .chat import complete

store=ProviderStore(str(Path(__file__).parents[1]/'data/providers.json'))
app=FastAPI(title='Arena-like Coding Agent')

@app.get('/ui')
def ui():
    return FileResponse(Path(__file__).parent / 'static' / 'index.html')

@app.get('/chat')
def chat_ui():
    return FileResponse(Path(__file__).parent / 'static' / 'chat.html')

@app.get('/')
def root():
    return FileResponse(Path(__file__).parent / 'static' / 'index.html')

@app.get('/health')
def health():
    return {'status': 'ok'}

@app.get('/api/workspace/files')
def workspace_files(path: str = '.'):
    try: return list_files(path)
    except Exception as e: raise HTTPException(400, str(e))

@app.get('/api/workspace/file')
def workspace_read(path: str):
    try: return {'path':path,'content':read_file(path)}
    except Exception as e: raise HTTPException(400, str(e))

@app.put('/api/workspace/file')
def workspace_write(payload: dict):
    try: return write_file(str(payload['path']), str(payload.get('content','')))
    except Exception as e: raise HTTPException(400, str(e))

@app.post('/api/terminal/exec')
def terminal_exec(payload: dict):
    try: return run_command(str(payload['command']), str(payload.get('cwd','.')), int(payload.get('timeout',60)))
    except Exception as e: raise HTTPException(400, str(e))

@app.post('/api/chat')
async def chat(payload: dict):
    try:
        messages=payload.get('messages') or [{'role':'user','content':str(payload.get('message',''))}]
        return await complete(store, str(payload['provider']), str(payload['model']), messages, int(payload.get('maxSteps',8)))
    except Exception as e:
        raise HTTPException(400, str(e))

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
