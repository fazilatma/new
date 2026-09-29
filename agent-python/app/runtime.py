import asyncio, uuid
jobs={}
def submit(coro):
    jid=str(uuid.uuid4());jobs[jid]={'id':jid,'status':'queued','result':None,'error':None}
    async def run():
        jobs[jid]['status']='running'
        try: jobs[jid]['result']=await coro;jobs[jid]['status']='done'
        except Exception as e: jobs[jid]['error']=str(e);jobs[jid]['status']='failed'
    asyncio.create_task(run());return jobs[jid]
