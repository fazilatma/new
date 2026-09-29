import asyncio, uuid, sqlite3, json
from pathlib import Path
DB=Path(__file__).parents[1]/'data'/'jobs.sqlite3'; DB.parent.mkdir(exist_ok=True)
conn=sqlite3.connect(DB,check_same_thread=False);conn.execute('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,status TEXT,result TEXT,error TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');conn.commit()
def _row(r): return {'id':r[0],'status':r[1],'result':json.loads(r[2]) if r[2] else None,'error':r[3]}
def get(jid):
 r=conn.execute('SELECT id,status,result,error FROM jobs WHERE id=?',(jid,)).fetchone();return _row(r) if r else None
def list_jobs(limit=50): return [_row(r) for r in conn.execute('SELECT id,status,result,error FROM jobs ORDER BY created_at DESC LIMIT ?',(limit,))]
def submit(coro):
 jid=str(uuid.uuid4());conn.execute("INSERT INTO jobs(id,status) VALUES(?,?)",(jid,'queued'));conn.commit()
 async def run():
  conn.execute("UPDATE jobs SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=?",(jid,));conn.commit()
  try:
   result=await coro;conn.execute("UPDATE jobs SET status='done',result=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(json.dumps(result,ensure_ascii=False),jid))
  except Exception as e: conn.execute("UPDATE jobs SET status='failed',error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",(str(e),jid))
  conn.commit()
 asyncio.create_task(run());return get(jid)
