from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import Response, FileResponse
from .models import Provider, ModelSpec
from .providers import ProviderStore
from .agent_tools import list_files, read_file, write_file, run_command, git_status, git_diff, git_commit
from .chat import complete
from .connectors import github, browse
from .config import read as read_config, write as write_config
from .workflow import preview
from .runtime import submit, get as get_job, list_jobs
from fastapi.responses import StreamingResponse, RedirectResponse
from fastapi import Request
from .auth import middleware as auth_middleware, configured, valid

store=ProviderStore(str(Path(__file__).parents[1]/'data/providers.json'))
APP_VERSION='0.3.0'
app=FastAPI(title='Arena-like Coding Agent', version=APP_VERSION)
app.middleware('http')(auth_middleware)

@app.get('/api/auth/status')
def auth_status():
    return {'enabled':configured()}

@app.post('/api/auth/login')
def auth_login(payload:dict):
    if not configured(): return {'enabled':False}
    if not valid(str(payload.get('token',''))): raise HTTPException(401,'Invalid token')
    r=JSONResponse({'ok':True}); r.set_cookie('arena_session',str(payload['token']),httponly=True,samesite='lax',secure=False); return r

@app.post('/api/auth/logout')
def auth_logout():
    r=JSONResponse({'ok':True}); r.delete_cookie('arena_session'); return r

@app.get('/api/version')
def version():
    return {'name':'Arena Python Agent','version':APP_VERSION,'apiVersion':'v1','status':'ok'}

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

@app.post('/api/workspace/preview')
def workspace_preview(payload: dict):
    try: return preview(str(payload['path']),str(payload.get('content','')))
    except Exception as e: raise HTTPException(400,str(e))

@app.put('/api/workspace/file')
def workspace_write(payload: dict):
    try: return write_file(str(payload['path']), str(payload.get('content','')))
    except Exception as e: raise HTTPException(400, str(e))

@app.get('/api/git/status')
def git_status_api():
    return git_status()

@app.get('/api/git/diff')
def git_diff_api():
    return git_diff()

@app.post('/api/git/commit')
def git_commit_api(payload: dict):
    message=str(payload.get('message','')).strip()
    if not message: raise HTTPException(400, 'Commit message is required')
    if not payload.get('approved'): raise HTTPException(428, 'Explicit approval is required')
    return git_commit(message)

@app.post('/api/terminal/exec')
def terminal_exec(payload: dict):
    try: return run_command(str(payload['command']), str(payload.get('cwd','.')), int(payload.get('timeout',60)))
    except Exception as e: raise HTTPException(400, str(e))

@app.get('/api/config/environment')
def environment_config():
    return read_config()

@app.put('/api/config/environment')
def save_environment(payload: dict):
    return write_config(payload)

@app.get('/api/github/repos')
async def github_repos():
    try: return await github('user/repos?per_page=100&sort=updated')
    except Exception as e: raise HTTPException(400,str(e))

@app.get('/api/github/repo/{owner}/{repo}/contents/{path:path}')
async def github_file(owner:str,repo:str,path:str):
    try: return await github(f'repos/{owner}/{repo}/contents/{path}')
    except Exception as e: raise HTTPException(400,str(e))

@app.post('/api/github/pull-request')
async def github_pr(payload: dict):
    import os, httpx
    token=os.getenv('GITHUB_TOKEN',''); owner=str(payload['owner']); repo=str(payload['repo'])
    if not token: raise HTTPException(400,'GITHUB_TOKEN is not configured')
    body={k:payload[k] for k in ('title','head','base','body') if k in payload}
    async with httpx.AsyncClient(timeout=30) as c:
        r=await c.post(f'https://api.github.com/repos/{owner}/{repo}/pulls',headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'},json=body)
        if r.status_code>=400: raise HTTPException(r.status_code,r.text)
        return r.json()

@app.post('/api/browser/fetch')
async def browser_fetch(payload:dict):
    try: return await browse(str(payload['url']))
    except Exception as e: raise HTTPException(400,str(e))

@app.get('/api/jobs')
def jobs_list(): return {'jobs':list_jobs()}

@app.get('/api/jobs/{job_id}')
def job_status(job_id: str):
    job=get_job(job_id)
    if not job: raise HTTPException(404,'Job not found')
    return job

@app.post('/api/chat/stream')
async def chat_stream(payload: dict):
    async def events():
        yield 'event: status\ndata: {\"status\":\"started\"}\n\n'
        try:
            result=await complete(store,str(payload['provider']),str(payload['model']),payload.get('messages') or [{'role':'user','content':str(payload.get('message',''))}],int(payload.get('maxSteps',8)))
            text=result.get('message',{}).get('content','')
            for part in [text[i:i+120] for i in range(0,len(text),120)]:
                yield 'event: token\ndata: '+json.dumps({'text':part},ensure_ascii=False)+'\n\n'
            yield 'event: done\ndata: '+json.dumps({'steps':result.get('steps',0)})+'\n\n'
        except Exception as e: yield 'event: error\ndata: '+json.dumps({'error':str(e)})+'\n\n'
    return StreamingResponse(events(),media_type='text/event-stream')

@app.post('/api/jobs/chat')
async def chat_job(payload: dict):
    return submit(complete(store,str(payload['provider']),str(payload['model']),payload.get('messages') or [{'role':'user','content':str(payload.get('message',''))}],int(payload.get('maxSteps',8))))

@app.post('/api/chat')
async def chat(payload: dict):
    try:
        messages=payload.get('messages') or [{'role':'user','content':str(payload.get('message',''))}]
        return await complete(store, str(payload['provider']), str(payload['model']), messages, int(payload.get('maxSteps',8)))
    except Exception as e:
        raise HTTPException(400, str(e))

@app.post('/api/providers/test-all')
async def test_all(payload: dict = {}):
    import time
    from .chat import complete
    selected=payload.get('provider')
    results=[]
    for pid,p in store.data.items():
        if selected and pid!=selected: continue
        for m in p.models:
            started=time.perf_counter()
            try:
                out=await complete(store,pid,m.id,[{'role':'user','content':'Reply with OK only.'}],1)
                results.append({'provider':pid,'model':m.id,'ok':True,'latencyMs':round((time.perf_counter()-started)*1000),'message':out['message'].get('content','')[:120]})
            except Exception as e: results.append({'provider':pid,'model':m.id,'ok':False,'latencyMs':round((time.perf_counter()-started)*1000),'error':str(e)})
    return {'results':results}

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
