import os,hmac,hashlib
from fastapi import Request
from fastapi.responses import JSONResponse
TOKEN_ENV='AGENT_AUTH_TOKEN'
def configured(): return bool(os.getenv(TOKEN_ENV,''))
def valid(value): return bool(value) and hmac.compare_digest(value,os.getenv(TOKEN_ENV,''))
def sign(value): return hmac.new(os.getenv(TOKEN_ENV,'').encode(),value.encode(),hashlib.sha256).hexdigest()
async def middleware(request:Request, call_next):
    if not configured() or request.url.path in ('/health','/','/chat','/docs','/openapi.json','/redoc') or request.url.path.startswith('/static') or request.url.path in ('/api/auth/login','/api/auth/status'):
        return await call_next(request)
    token=request.cookies.get('arena_session') or request.headers.get('Authorization','').removeprefix('Bearer ').strip()
    if not valid(token) and not hmac.compare_digest(token,sign(os.getenv(TOKEN_ENV,''))):
        return JSONResponse({'detail':'Authentication required'},status_code=401)
    return await call_next(request)
