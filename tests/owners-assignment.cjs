const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const source=fs.readFileSync('src/worker.js','utf8');
const ctx=vm.createContext({Request,Response,URL});
vm.runInContext(source.slice(0,source.indexOf('export default {'))+'\nglobalThis.a={handleApi,d1Store};',ctx);
const {handleApi,d1Store}=ctx.a;
const booths=[{id:1,is_independent:0},{id:2,is_independent:0},{id:3,is_independent:1},{id:4,is_independent:0}];
const integrations=[{id:1,booth_id:1,type:'basalam',token:'TEST-A'},{id:2,booth_id:2,type:'basalam',token:'TEST-B'}];
let assignmentCalls=0,received;
const store={async list(){return integrations;},async findBy(t,k,v){return booths.find(x=>String(x.id)===String(v));},async getSetting(){return '7';},async assignOwners(rows,fee){assignmentCalls++;received={rows,fee};return {assigned:rows.length,orders_moved:2};}};
async function request(body){const url=new URL('https://example.test/api/booths/assign-owners');const response=await handleApi(new Request(url,{method:'POST',body:JSON.stringify(body)}),store,url);return {status:response.status,data:await response.json()};}
(async()=>{
  const valid={confirm_existing:true,booths:[{id:1,owner_name:'One',owner_share_pct:20},{id:2,owner_name:'Two',owner_share_pct:30}]};
  for (const invalid of [
    {...valid,confirm_existing:false},{...valid,booths:[]},{...valid,booths:[valid.booths[0],valid.booths[0]]},
    {...valid,booths:[{id:4,owner_name:'Unconnected',owner_share_pct:20}]},
    {...valid,booths:[{id:1,owner_name:'One',owner_share_pct:101}]},
    {...valid,booths:[valid.booths[0],{id:2,owner_name:'',owner_share_pct:20}]}
  ]) assert.equal((await request(invalid)).status,400);
  assert.equal(assignmentCalls,0,'must validate the entire batch before writing');
  assert.equal((await request({...valid,booths:[{id:3,owner_name:'Already',owner_share_pct:10}]})).status,409);
  const result=await request(valid);assert.equal(result.status,200);assert.equal(result.data.assigned,2);assert.equal(received.fee,7);assert.equal(received.rows[0].owner_share_pct,20);
  let statements;
  const db={prepare(sql){return {bind(...params){return {sql,params};}};},async batch(stmts){statements=stmts;return stmts.map(()=>({meta:{changes:1}}));}};
  const counts=await d1Store(db).assignOwners(received.rows,received.fee);assert.equal(counts.assigned,2);assert.equal(counts.orders_moved,2);
  const py=spawnSync('python3',['-c',`
import sys,json,sqlite3
x=json.load(sys.stdin);c=sqlite3.connect(':memory:');c.row_factory=sqlite3.Row;c.executescript(x['schema'])
for i in [1,2,3]:c.execute('INSERT INTO booths(id,name,is_independent) VALUES (?,?,?)',(i,'Booth'+str(i),int(i==3)))
for i in [1,2]:
 c.execute("INSERT INTO integrations(id,type,booth_id,token) VALUES (?,'basalam',?,?)",(i,i,'TEST'+str(i)))
 c.execute("INSERT INTO orders(id,booth_id,unit_cost,unit_sale,quantity,status) VALUES (?,?,100000,150000,2,'delivered')",(i,i))
c.execute("INSERT INTO orders(id,booth_id,is_independent,owner_share_pct,credit_fee_pct,owner_paid_amount) VALUES (3,1,1,11,4,2000)")
c.commit()
for attempt in range(2):
 changes=[]
 with c:
  for s in x['statements']:
   changes.append(c.execute(s['sql'],s['params']).rowcount)
 assert changes==([1,1,1,1] if attempt==0 else [0,0,0,0]),changes
rows=list(c.execute('SELECT * FROM orders ORDER BY id'))
assert len(rows)==3
for i in [0,1]:
 assert rows[i]['is_independent']==1
 assert rows[i]['owner_share_pct']==[20,30][i]
 assert rows[i]['credit_fee_pct']==7
 assert rows[i]['unit_cost']==100000 and rows[i]['quantity']==2 and rows[i]['status']=='delivered'
assert rows[2]['owner_share_pct']==11 and rows[2]['credit_fee_pct']==4 and rows[2]['owner_paid_amount']==2000
assert c.execute('SELECT count(*) FROM booths').fetchone()[0]==3
assert c.execute("SELECT token FROM integrations WHERE id=1").fetchone()[0]=='TEST1'
print('D1 assignment SQL: existing orders moved once, financial data/tokens/IDs preserved, repeat safely ignored')
`],{input:JSON.stringify({schema:fs.readFileSync('schema.sql','utf8'),statements}),encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);console.log(py.stdout.trim());console.log('Assignment API validation and multi-booth transaction checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
