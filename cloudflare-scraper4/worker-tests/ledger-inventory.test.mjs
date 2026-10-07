import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
async function compile(source,names,io={}){const js=(await transform(source.replace(/^import .*;\s*$/gm,'').replaceAll('export ',''),{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names+'};')(...Object.values(io))}
const visibility=await compile(await read('worker-src/ledger-inventory.ts'),'customerVisible');
const details=await compile(await read('worker-src/job-details.ts'),'extractionDetails');
test('customer-visible policy excludes inactive and hidden but not visible zero-stock products',()=>{
 for(const status of ['draft','private','pending','trash',''])assert.equal(visibility.customerVisible('woo',{status}),false);
 assert.equal(visibility.customerVisible('woo',{status:'publish',raw:{catalog_visibility:'hidden'}}),false);
 for(const catalog_visibility of ['visible','catalog','search'])assert.equal(visibility.customerVisible('woo',{status:'publish',raw:{catalog_visibility,stock_quantity:0}}),true);
 for(const status of ['3790','3567','3568','4184',''])assert.equal(visibility.customerVisible('basalam',{status}),false);
 assert.equal(visibility.customerVisible('basalam',{status:'2976',raw:{stock:0}}),true);
});
for(const runtime of ['worker','render']){
 const source=await read(runtime+'-src/maintenance.ts');
 test(runtime+': scan validates all endpoint rows before visibility filtering and requests active products',async()=>{
  let bad=false,duplicate=false;const a=source.indexOf('async function scanLedgerAccount('),b=source.indexOf('\nasync function remoteForAccount',a);
  const {scanLedgerAccount}=await compile(source.slice(a,b),'scanLedgerAccount',{...visibility,destinationCatalog:async(target,query)=>{assert.equal(query.status,target==='woo'?'publish':'active');return {complete:true,total:bad?3:2,totalPages:1,products:[{id:1,status:target==='woo'?'publish':'2976',priceRaw:100,raw:{}},{id:duplicate?1:2,status:target==='woo'?'publish':'3790',raw:{catalog_visibility:'hidden'}}]}}});
  for(const target of ['woo','basalam'])assert.equal((await scanLedgerAccount({target,accountKey:'1'})).length,1);
  bad=true;await assert.rejects(scanLedgerAccount({target:'woo'}),/تعداد/);bad=false;duplicate=true;await assert.rejects(scanLedgerAccount({target:'woo'}),/تکراری/);
 });
 test(runtime+': full-operation duration persists, counts cached accounts and reports failures',async()=>{
  const a=source.indexOf('export async function refreshDestinationLedger('),b=source.indexOf('\nexport async function destinationLedgerStatus',a);let clock=0,saved,fail=false;const generations={a:0,b:0};class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]))}static now(){return clock}}
  const {refreshDestinationLedger}=await compile(source.slice(a,b),'refreshDestinationLedger',{Date:Clock,reconAccounts:async()=>[{target:'woo',accountKey:'a'},{target:'basalam',accountKey:'b'}],destinationScope:async(_t,k)=>k,destinationLedger:{metadata:async k=>({generation:generations[k]})},remoteForAccount:async(account,force)=>{clock+=60000;if(fail&&account.accountKey==='b')throw Error('timeout');if(force)generations[account.accountKey]++},setState:async(k,r)=>{saved=r}});
  const full=await refreshDestinationLedger(true);assert.equal(full.durationMinutes,2);assert.equal(full.scannedAccounts,2);assert.equal(saved,full);
  const cached=await refreshDestinationLedger(false);assert.equal(cached.cachedAccounts,2);fail=true;const partial=await refreshDestinationLedger(true);assert.equal(partial.ok,false);assert.equal(partial.scannedAccounts,1);assert.equal(partial.items[1].error,'timeout');
 });
 test(runtime+': duplicate preview reads shared ledger; apply refreshes it and failed refresh never deletes',async()=>{
  const a=source.indexOf('export async function destinationDuplicates('),b=source.indexOf('\n}',a)+2;let forced=[],failed=false,deletes=0;const {destinationDuplicates}=await compile(source.slice(a,b),'destinationDuplicates',{reconAccounts:async()=>[{target:'woo',accountKey:'default',name:'Woo'}],getState:async()=>({}),remoteForAccount:async(_a,force)=>{forced.push(force);if(failed)throw Error('scan failed');return[{id:1},{id:2}]},planDuplicateDeletions:rows=>[{target:'woo',remoteId:rows[1].id,accountKey:'default'}],destinationDelete:async()=>{deletes++;return{}}});
  const preview=await destinationDuplicates();assert.equal(preview.source,'ledger');assert.equal(preview.planned,1);assert.equal(deletes,0);await destinationDuplicates(true);assert.deepEqual(forced,[false,true]);assert.equal(deletes,1);failed=true;assert.equal((await destinationDuplicates(true)).ok,false);assert.equal(deletes,1);
 });
}
test('task details sum cache events, distinguish unknown history and show queued continuation',()=>{
 const j={status:'queued',startedAt:'2026-09-17T00:00:00Z',total:10,processed:4,log:[{event:'source-cache',item:{listCount:6,reusedCount:4}},{event:'source-cache',item:{listCount:4,reusedCount:1}},{event:'sync-skipped',at:'now',item:{sourceKey:'s',title:'Shoe'}}]};
 const x=details.extractionDetails(j,Date.parse(j.startedAt)+120000);assert.equal(x.listCount,10);assert.equal(x.reusedCount,5);assert.equal(x.elapsedMs,120000);assert.equal(x.sendSkipped,1);assert.equal(x.lastProduct,'Shoe');assert.match(x.waiting,/ادامه/);assert.equal(details.extractionDetails({}).reusedCount,null);
});
test('Task Manager and ledger timing render bounded escaped details with honest units',async()=>{
 const s=await read('worker-src/dashboard.ts'),a=s.indexOf('function activityExtractionHtml('),b=s.indexOf('function activityJobRow(',a);const esc=x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;');const ui=await compile(s.slice(a,b),'activityExtractionHtml,ledgerTimingHtml',{esc,fa:String,phaseLabel:x=>x});
 const html=ui.activityExtractionHtml({kind:'scrape',profileName:'<script>',phase:'details',extraction:details.extractionDetails({status:'queued',log:[]})});assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.match(html,/ثبت نشده/);assert.match(ui.ledgerTimingHtml({durationMs:120000,scannedAccounts:2}),/2 دقیقه/);assert.match(ui.ledgerTimingHtml({}),/اندازه‌گیری نشده/);
 for(const runtime of ['worker','render']){const src=await read(runtime+'-src/'+(runtime==='worker'?'app':'server')+'.ts');assert.match(src,/extraction:extractionDetails\(j\)/)}assert.match(s,/activityExtractionHtml\(j\)\+/);
});
