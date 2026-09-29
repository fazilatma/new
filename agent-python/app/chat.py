import os, json, httpx
from .providers import ProviderStore
from .agent_tools import list_files, read_file, write_file, run_command

TOOLS=[
 {"type":"function","function":{"name":"list_files","description":"List files in the project workspace","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":[]}}},
 {"type":"function","function":{"name":"read_file","description":"Read a text file from the project workspace","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}},
 {"type":"function","function":{"name":"write_file","description":"Write or replace a text file in the project workspace","parameters":{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"}},"required":["path","content"]}}},
 {"type":"function","function":{"name":"run_command","description":"Run a command inside the project workspace","parameters":{"type":"object","properties":{"command":{"type":"string"},"cwd":{"type":"string"}},"required":["command"]}}}
]
async def complete(store:ProviderStore, provider_id:str, model_id:str, messages:list, max_steps=8):
    p=store.data.get(provider_id)
    if not p: raise ValueError('Provider not found')
    m=next((x for x in p.models if x.id==model_id),None)
    if not m: raise ValueError('Model not found')
    key=p.apiKey or (os.getenv(p.apiKeyEnv) if p.apiKeyEnv else '')
    if not key: raise ValueError('No API key configured for this provider')
    base=p.url.rstrip('/')
    url=base if base.endswith('/chat/completions') else base+'/chat/completions'
    proxy=os.getenv('AGENT_PROXY_URL','')
    if proxy: url=proxy.replace('{url}',url)
    headers={'Authorization':f'Bearer {key}','Content-Type':'application/json'}
    async with httpx.AsyncClient(timeout=120) as client:
      for _ in range(max_steps):
        body={'model':m.id,'messages':messages,'temperature':0.2}
        if m.toolCalling: body['tools']=TOOLS
        r=await client.post(url,headers=headers,json=body); r.raise_for_status(); data=r.json()
        msg=data['choices'][0]['message']; messages.append(msg)
        calls=msg.get('tool_calls') or []
        if not calls: return {'message':msg,'steps':len(messages)}
        for call in calls:
          name=call['function']['name']; args=json.loads(call['function'].get('arguments') or '{}')
          try:
            result={'list_files':lambda:list_files(args.get('path','.')),'read_file':lambda:read_file(args['path']),'write_file':lambda:write_file(args['path'],args.get('content','')),'run_command':lambda:run_command(args['command'],args.get('cwd','.'))}[name]()
          except Exception as e: result={'error':str(e)}
          messages.append({'role':'tool','tool_call_id':call['id'],'content':json.dumps(result,ensure_ascii=False)})
      return {'message':{'role':'assistant','content':'Agent stopped after reaching the maximum tool steps.'},'steps':max_steps}
