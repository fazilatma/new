const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const source = fs.readFileSync('src/worker.js','utf8');
const ctx=vm.createContext({Request,Response,URL,console});
vm.runInContext(source.slice(0,source.indexOf('export default {'))+'\nglobalThis.testAPI={handleApi,ownerSnapshot,upsertExternalOrder,exportData,importData,SCHEMA,MIGRATIONS};',ctx);
const a=ctx.testAPI;
const rows={orders:[],booths:[{id:2,name:'Partner',is_independent:1,owner_share_pct:20,owner_name:'Owner'},{id:1,name:'Owned',is_independent:0}],suppliers:[],integrations:[]};
const settings={};
const store={
  async list(t){return rows[t];}, async findBy(t,k,v){return rows[t].find(x=>String(x[k])===String(v))||null;},
  async insert(t,o){const row={id:Math.max(0,...rows[t].map(x=>+x.id))+1,...o};rows[t].push(row);return row;},
  async update(t,id,o){const row=await this.findBy(t,'id',id);if(row)Object.assign(row,o);return row;},
  async remove(t,id){rows[t]=rows[t].filter(x=>String(x.id)!==String(id));},
  async removeMany(t,ids){rows[t]=rows[t].filter(x=>!ids.includes(String(x.id)));return ids.length;},
  async clear(t){rows[t]=[];},async getSetting(k){return settings[k]??null;},async setSetting(k,v){settings[k]=v;},async allSettings(){return {...settings};}
};
async function request(path,method='GET',body){const url=new URL('https://test.example/api/'+path);const r=await a.handleApi(new Request(url,{method,...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})}),store,url);return {status:r.status,data:await r.json()};}
(async()=>{
  let r=await request('orders','POST',{booth_id:2,order_code:'B1',unit_sale:150000,unit_cost:100000,owner_share_pct:99,credit_fee_pct:99,owner_payment_mode:'credit'});
  assert.equal(r.status,200);assert.equal(r.data.order.owner_share_pct,20);assert.equal(r.data.order.credit_fee_pct,5);assert.equal(r.data.order.is_independent,1);const id=r.data.order.id;
  await request('settings','POST',{owner_credit_fee_pct:10});await request('booths/2','PUT',{owner_share_pct:30});
  r=await request('orders/'+id,'PUT',{owner_paid_amount:500,owner_share_pct:60,credit_fee_pct:40});
  assert.equal(r.data.order.owner_share_pct,20);assert.equal(r.data.order.credit_fee_pct,5);
  await a.upsertExternalOrder(store,{booth_id:2,order_code:'B1',unit_sale:160000,status:'delivered'});
  assert.equal(rows.orders[0].owner_paid_amount,500);assert.equal(rows.orders[0].credit_fee_pct,5);
  await a.upsertExternalOrder(store,{booth_id:2,order_code:'B2',unit_sale:150000,status:'pending'});
  assert.equal(rows.orders[1].owner_share_pct,30);assert.equal(rows.orders[1].credit_fee_pct,10);
  r=await request('orders','POST',{booth_id:1,order_code:'OWN',is_independent:1,owner_share_pct:100});assert.equal(r.data.order.is_independent,0);
  assert.equal((await request('orders/'+id,'PUT',{booth_id:1})).status,400);
  assert.equal((await request('orders/'+id,'PUT',{owner_payment_mode:'invalid'})).status,400);
  assert.equal((await request('orders/'+id,'PUT',{owner_paid_amount:-1})).status,400);
  assert.equal((await request('settings','POST',{owner_credit_fee_pct:101})).status,400);
  assert.equal((await request('booths/2','PUT',{owner_share_pct:-1})).status,400);
  assert.equal((await request('booths/2','PUT',{is_independent:0})).status,400);
  assert.equal((await request('booths/2','DELETE')).status,400);
  assert.equal((await request('booths/bulk-delete','POST',{ids:[2]})).status,400);
  r=await request('integrations','POST',{type:'basalam',booth_id:2,vendor_id:70,token:'TEST-TOKEN'});assert.equal(r.status,200);assert(!('token' in r.data.integration));const integ=r.data.integration.id;
  assert.equal((await request('integrations/'+integ,'PUT',{booth_id:1})).status,400);
  const before=rows.orders.length;await request('integrations/'+integ,'DELETE');assert.equal(rows.orders.length,before);
  const backup=await a.exportData(store);await a.importData(store,backup);
  assert.equal(rows.orders[0].credit_fee_pct,5);assert.equal(rows.orders[0].booth_id,2);assert.equal(rows.booths.find(x=>x.id===2).is_independent,1);assert.equal(rows.booths.find(x=>x.id===2).owner_share_pct,30);
  // Real SQLite verifies fresh schema plus repeatable migration of an older database.
  const py=spawnSync('python3',['-c',`
import sys,json,sqlite3
x=json.load(sys.stdin)
for fresh in [True,False]:
 c=sqlite3.connect(':memory:')
 if fresh:
  c.executescript(x['sql'])
 else:
  c.executescript("CREATE TABLE booths (id INTEGER PRIMARY KEY, name TEXT, description TEXT, created_at TEXT); CREATE TABLE orders (id INTEGER PRIMARY KEY, order_code TEXT, created_at TEXT); CREATE TABLE integrations (id INTEGER PRIMARY KEY);")
 for _ in range(2):
  for t,col,ddl in x['migrations']:
   try:c.execute(f'ALTER TABLE {t} ADD COLUMN {col} {ddl}')
   except sqlite3.OperationalError as e:
    assert 'duplicate column' in str(e),str(e)
 c.execute("INSERT INTO orders (id,order_code) VALUES (1,'LEGACY')")
 assert c.execute('SELECT is_independent,credit_fee_pct FROM orders WHERE id=1').fetchone()==(0,None)
 c.execute('UPDATE orders SET is_independent=1,owner_share_pct=20,credit_fee_pct=5 WHERE id=1')
 assert c.execute('SELECT owner_share_pct,credit_fee_pct FROM orders WHERE id=1').fetchone()==(20,5)
print('SQLite fresh and legacy migrations passed')
`],{input:JSON.stringify({sql:fs.readFileSync('schema.sql','utf8'),migrations:a.MIGRATIONS}),encoding:'utf8'});
  assert.equal(py.status,0,py.stderr);console.log(py.stdout.trim());
  console.log('Owner backend passed: API validation, rate snapshots, sync preservation, token deletion/masking, booth protection, backup restore');
})().catch(e=>{console.error(e);process.exitCode=1;});
