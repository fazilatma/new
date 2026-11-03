const {execFileSync} = require('node:child_process');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const php = process.env.PHP_BINARY || 'php';
const html = execFileSync(php, [path.join(__dirname,'render-refresh-script.php')], {encoding:'utf8'});
const js = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
const initial = html.match(/var initial="([a-f0-9]{24})"/)[1];
async function run({version, busySelector=false, paid=false, interacting=false, hidden=false, currentRefresh=''}) {
  let tick, now=1000, reloaded='', requested=''; const handlers={};
  const doc={hidden,activeElement:null,querySelector:()=>busySelector?{}:null,addEventListener:(k,fn)=>{handlers[k]=fn}};
  const location={href:'https://example.test/?q=1'+(paid?'&amphp_paid=1':'')+(currentRefresh?'&amphp_refresh='+currentRefresh:''),replace:u=>{reloaded=u}};
  class FakeDate extends Date { static now(){return now;} }
  const context={window:{},document:doc,location,URL,Date:FakeDate,setInterval:fn=>{tick=fn},fetch:async u=>{requested=u;return {ok:true,json:async()=>({version})}}};
  vm.runInNewContext(js, context);
  now += 30000;
  if(interacting) handlers.input();
  tick(); await new Promise(r=>setTimeout(r,0));
  return {reloaded,requested};
}
(async()=>{
  const next='b'.repeat(24);
  assert.equal((await run({version:initial})).reloaded,'');
  const change=await run({version:next});
  assert.ok(change.reloaded.includes('amphp_refresh='+next));
  assert.ok(change.reloaded.includes('q=1'));
  assert.ok(change.requested.includes('amphp_update_version=1'));
  for(const x of [{busySelector:true},{paid:true},{interacting:true},{hidden:true},{currentRefresh:next}]) assert.equal((await run({version:next,...x})).reloaded,'');
  console.log('Release watcher tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
