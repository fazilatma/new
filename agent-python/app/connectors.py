import os, httpx
async def github(path='user/repos'):
    token=os.getenv('GITHUB_TOKEN','')
    if not token: raise ValueError('GITHUB_TOKEN is not configured')
    async with httpx.AsyncClient(timeout=30) as c:
        r=await c.get('https://api.github.com/'+path.lstrip('/'),headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json'});r.raise_for_status();return r.json()
async def browse(url):
    if not url.startswith(('http://','https://')): raise ValueError('Only HTTP(S) URLs are allowed')
    async with httpx.AsyncClient(timeout=30,follow_redirects=True,headers={'User-Agent':'Arena-Agent/0.4'}) as c:
        r=await c.get(url);return {'url':str(r.url),'status':r.status_code,'contentType':r.headers.get('content-type',''),'body':r.text[:100000]}
