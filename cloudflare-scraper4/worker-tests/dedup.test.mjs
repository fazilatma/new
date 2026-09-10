import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';

const temporary=await mkdtemp(join(tmpdir(),'scraper4-dedup-'));
await build({entryPoints:{dedup:new URL('../worker-src/dedup.ts',import.meta.url).pathname},bundle:true,format:'esm',platform:'browser',target:'es2022',outdir:temporary,entryNames:'[name]',outExtension:{'.js':'.mjs'}});
const {parseSuffixFormats,suffixPatterns,stripDedupSuffix,dedupKey,buildDedupGroups,normalizeDedupKeep}=await import(pathToFileURL(join(temporary,'dedup.mjs')));

const candidate=(id,name,{price=0,date='',shopId='default',status='publish',sku=''}={})=>({id,shopId,name,price,date,status,sku});

test('suffix formats are user-editable and fall back to the documented defaults',()=>{
  assert.deepEqual(parseSuffixFormats(''),['(کد:x)','#x']);
  assert.deepEqual(parseSuffixFormats('(کد:x)، #x'),['(کد:x)','#x']);
  assert.deepEqual(parseSuffixFormats('[sku:x] , X-x'),['[sku:x]','X-x']);
  // A format without the numeric placeholder must be ignored so plain words are never stripped.
  assert.deepEqual(parseSuffixFormats('تخفیف ویژه'),['(کد:x)','#x']);
});

test('the default formats strip (کد:x) and #x suffixes with multi-digit and Persian numbers',()=>{
  const patterns=suffixPatterns(['(کد:x)','#x']);
  assert.equal(stripDedupSuffix('عطر گل محمدی (کد:12)',patterns),'عطر گل محمدی');
  assert.equal(stripDedupSuffix('عطر گل محمدی (کد:۴۵۶۷)',patterns),'عطر گل محمدی');
  assert.equal(stripDedupSuffix('عطر گل محمدی #345',patterns),'عطر گل محمدی');
  assert.equal(stripDedupSuffix('عطر گل محمدی #۲',patterns),'عطر گل محمدی');
  assert.equal(stripDedupSuffix('عطر گل محمدی (کد:2) (کد:15)',patterns),'عطر گل محمدی');
  // The suffix is only removed at the end of the title.
  assert.equal(stripDedupSuffix('#12 عطر گل محمدی',patterns),'#12 عطر گل محمدی');
});

test('a custom format such as [کد x] is honored after editing',()=>{
  const patterns=suffixPatterns(parseSuffixFormats('[کد x]'));
  assert.equal(stripDedupSuffix('ست هدیه [کد 405]',patterns),'ست هدیه');
  assert.equal(stripDedupSuffix('ست هدیه (کد:405)',patterns),'ست هدیه (کد:405)');
});

test('duplicate keys match same-named products across suffix variants but stay per shop',()=>{
  const patterns=suffixPatterns(['(کد:x)','#x']);
  const a=dedupKey('عطر گل محمدی (کد:12)','100',patterns),b=dedupKey('عطر  گل  محمدی #۹','100',patterns),c=dedupKey('عطر گل محمدی','200',patterns);
  assert.equal(a,b);
  assert.notEqual(a,c);
  assert.equal(dedupKey('   ','100',patterns),'');
});

test('keep=newest keeps the newest by date and removes older copies',()=>{
  const groups=buildDedupGroups([
    candidate(1,'عطر گل محمدی (کد:1)',{date:'2026-01-01T00:00:00Z'}),
    candidate(2,'عطر گل محمدی (کد:2)',{date:'2026-05-01T00:00:00Z'}),
    candidate(3,'عطر گل محمدی',{date:'2026-03-01T00:00:00Z'}),
    candidate(9,'محصول تکی',{date:'2026-03-01T00:00:00Z'}),
  ],'newest',['(کد:x)','#x']);
  assert.equal(groups.length,1);
  assert.equal(groups[0].keep.id,2);
  assert.deepEqual(groups[0].remove.map(x=>x.id).sort(),[1,3]);
});

test('keep=oldest keeps the oldest copy and larger ids count as newer without dates',()=>{
  const withDates=buildDedupGroups([
    candidate(1,'کیف چرم',{date:'2026-01-01T00:00:00Z'}),
    candidate(2,'کیف چرم #77',{date:'2026-05-01T00:00:00Z'}),
  ],'oldest',['(کد:x)','#x']);
  assert.equal(withDates[0].keep.id,1);
  const withoutDates=buildDedupGroups([candidate(10,'کیف چرم'),candidate(44,'کیف چرم #2')],'newest',['(کد:x)','#x']);
  assert.equal(withoutDates[0].keep.id,44);
});

test('keep=cheapest and keep=expensive pick winners by price',()=>{
  const rows=[candidate(1,'شال نخی',{price:100}),candidate(2,'شال نخی (کد:3)',{price:80}),candidate(3,'شال نخی #4',{price:120})];
  assert.equal(buildDedupGroups(rows,'cheapest',['(کد:x)','#x'])[0].keep.id,2);
  assert.equal(buildDedupGroups(rows,'expensive',['(کد:x)','#x'])[0].keep.id,3);
});

test('unknown keep values normalize to newest',()=>{
  assert.equal(normalizeDedupKeep('anything'),'newest');
  assert.equal(normalizeDedupKeep('cheapest'),'cheapest');
});

// --- Request 36b: the duplicate remover must recognise the GENERIC «(کد ایکس)»
// suffix, not only the configured formats. It used to strip configured formats
// only, so a shop full of «کیف چرم (کد 11)» / «(کد 12)» titles produced zero
// groups and the cleanup silently did nothing.
test('dedupKey strips the generic (کد ایکس) suffix as well as configured ones',()=>{
  const patterns=suffixPatterns(['(کد:x)','#x']);
  const a=dedupKey('کیف چرم (کد 11)','default',patterns);
  const b=dedupKey('کیف چرم (کد 12)','default',patterns);
  const c=dedupKey('کیف چرم (code B2)','default',patterns);
  assert.equal(a,b,'numeric generic code suffixes must collapse to one key');
  assert.equal(a,c,'latin generic code suffixes must collapse to the same key');
  // A title without any code suffix stays distinct.
  assert.notEqual(a,dedupKey('کفش راحتی (کد 21)','default',patterns));
  // Shop scoping still applies.
  assert.notEqual(a,dedupKey('کیف چرم (کد 11)','200',patterns));
});

test('buildDedupGroups keeps the most expensive generic-suffix duplicate',()=>{
  const rows=[
    {id:101,shopId:'default',name:'کیف چرم (کد 11)',price:100000,date:'',status:'publish',sku:'a'},
    {id:102,shopId:'default',name:'کیف چرم (کد 12)',price:250000,date:'',status:'publish',sku:'b'},
    {id:103,shopId:'default',name:'کیف چرم (کد 13)',price:180000,date:'',status:'publish',sku:'c'},
    {id:104,shopId:'default',name:'کفش راحتی (کد 21)',price:90000,date:'',status:'publish',sku:'d'},
  ];
  const groups=buildDedupGroups(rows,'expensive',['(کد:x)','#x']);
  assert.equal(groups.length,1,'the three کیف چرم listings form exactly one group');
  assert.equal(groups[0].keep.id,102);
  assert.deepEqual(groups[0].remove.map(x=>x.id).sort((x,y)=>x-y),[101,103]);
});
