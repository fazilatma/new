import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');
async function compile(s,n,io={}){return new Function(...Object.keys(io),(await transform(s.replaceAll('export ',''),{loader:'ts'})).code+';return '+n)(...Object.values(io))}
test('Node no-pagination keeps the 1.180 same-URL loop and selected pipeline, not forced scroll',async()=>{
 const source=await read('render-src/processor.ts');
 assert.doesNotMatch(source,/pagination==='none'&&\['playwright'/);
 const a=source.indexOf('const before = found.size;'),b=source.indexOf("\n      if (job.status !== 'stopped')",a);
 const loop=source.slice(a,b).trim().replace(/\}\s*$/,'');
 const run=await compile('async function run(){const found=new Map();let repeatedPages=0;const job={};for(let page=1;page<=10;page++){const list=await next();'+loop+'}return [...found.values()]}','run',{
  next:async()=>{const group=Math.min(calls++,4);return Array.from({length:100},(_,i)=>({sourceKey:String(group*100+i)}))},
  profile:{pages:0,pagination:'none'},save:async()=>{},nextSelector:'',followUrl:'',append:()=>{}
 });
 let calls=0;assert.equal((await run()).length,500);assert.equal(calls,6);
});
test('no-pagination diagnostics no longer force the scroll collector',async()=>{
 for(const runtime of ['render','worker']){
  const s=await read(runtime+'-src/scraper.ts');const body=s.slice(s.indexOf('export async function diagnoseExtraction'));
  assert.doesNotMatch(body,/pagination==='none'&&\['playwright'/);
 }
});
test('Worker retains its 1.180 no-pagination stop, and both dropdowns have the original label',async()=>{
 const worker=await read('worker-src/processor.ts'),ui=await read('worker-src/dashboard.ts');
 assert.match(worker,/profile.pagination!=='none'&&profile.pagination!=='scroll'/);
 assert.equal((ui.match(/<option value="none">بدون صفحه‌بندی<\/option>/g)||[]).length,2);
 assert.doesNotMatch(ui,/<option value="none">بدون صفحه‌بندی \(تک‌صفحه‌ای\)/);
});
