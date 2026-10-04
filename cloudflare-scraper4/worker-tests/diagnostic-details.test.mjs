import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transform,build} from 'esbuild';
import {parseHTML} from 'linkedom';
import vm from 'node:vm';
const read=f=>readFile(new URL('../'+f,import.meta.url),'utf8');
async function compile(source,names,io={}){const js=(await transform(source.replace(/^import .*;\s*$/gm,'').replace(/\bexport /g,''),{loader:'ts'})).code;return new Function(...Object.keys(io),js+';return {'+names+'};')(...Object.values(io))}
const {benchmarkError}=await compile(await read('worker-src/benchmark-pagination.ts'),'benchmarkError');
const {diagnosticDetails,boundedDiagnosticProduct}=await compile(await read('worker-src/diagnostic-details.ts'),'diagnosticDetails,boundedDiagnosticProduct',{benchmarkError});
test('automatic details isolate source/profile, preserve nested failures and skip missing links',async()=>{
 const product={title:'Coat',url:'https://shop.example/p',price:1},profile={selectors:{price:'.list-price'}};
 const result=await diagnosticDetails(product,profile,'puppeteer',async(p,profile,engine)=>{assert.equal(engine,'puppeteer');p.longDesc='Details';profile.selectors.price='.other';return {product:p}});
 assert.equal(result.product.longDesc,'Details');assert.equal(result.loader,'puppeteer');assert.equal(product.longDesc,undefined);assert.equal(profile.selectors.price,'.list-price');
 const error=await diagnosticDetails(product,profile,'crawlee_playwright',async()=>{throw new Error('launch',{cause:new Error('missing libatk')})});assert.equal(error.ok,false);assert.match(error.error,/missing libatk/);assert.deepEqual(error.product,product);
 const skipped=await diagnosticDetails({},profile,'cheerio',()=>assert.fail('must not fetch'));assert.equal(skipped.skipped,true);
});
test('unusually large descriptions and arrays are bounded with an explicit truncation flag',()=>{
 const result=boundedDiagnosticProduct({longDesc:'x'.repeat(200000),images:Array(100).fill('https://shop.example/x.jpg')});assert.equal(result.truncated,true);assert.equal(result.product.longDesc.length,100000);assert.equal(result.product.images.length,60);
});
for(const runtime of ['render','worker'])test(runtime+': automatic extraction reads one document through its real transport and does not mutate selectors',async()=>{
 const src=await read(runtime+'-src/scraper.ts'),a=src.indexOf('export async function extractDiagnosticSample('),page={text:'rendered detail fixture',url:'https://shop.example/p'},calls=[];
 const io={isBrowserSelectorEngine:e=>e==='playwright',requireStaticSelectorEngine:e=>{if(e==='playwright')throw Error('Node only')},selectorToolDocument:async(url,engine)=>{calls.push(engine);return page},safeText:async(url,max,options)=>{calls.push(options.indirect);return page},sourceText:async(url,indirect)=>{calls.push(indirect);return page},suggestSelectors:async(url,mode,engine,document)=>{assert.equal(document,page);assert.equal(mode,'detail');return {selectors:{longDesc:'.description'}}},scrapeDetails:async(...args)=>{assert.equal(args.at(-1),page);return {...args[0],longDesc:'Details'}}};
 const {extractDiagnosticSample}=await compile(src.slice(a),'extractDiagnosticSample',io),profile={selectors:{title:'.title'},networkIndirect:true};
 const result=await extractDiagnosticSample({url:page.url},profile,'cheerio');assert.equal(result.product.longDesc,'Details');assert.deepEqual(calls,[true]);assert.deepEqual(profile.selectors,{title:'.title'});
 calls.length=0;
 if(runtime==='render'){await extractDiagnosticSample({url:page.url},{...profile,networkIndirect:false},'playwright');assert.deepEqual(calls,['playwright']);await assert.rejects(()=>extractDiagnosticSample({url:page.url},profile,'playwright'),/غیرمستقیم/)}else await assert.rejects(()=>extractDiagnosticSample({url:page.url},profile,'playwright'),/Node only/);
});
const bundle=await build({entryPoints:[new URL('../worker-src/dashboard.ts',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node'}),module={exports:{}};new Function('module','exports',bundle.outputFiles[0].text)(module,module.exports);const {DASHBOARD,DASHBOARD_JS}=module.exports;
test('dashboard JS compiles, switches default OFF, and manual commands keep actual newlines and shell quotes',async()=>{
 new vm.Script(DASHBOARD_JS);const {document}=parseHTML(DASHBOARD);for(const id of ['benchmarkAutoDetails','diagnosticAutoDetails']){assert.ok(document.getElementById(id));assert.equal(document.getElementById(id).hasAttribute('checked'),false)}
 const a=DASHBOARD_JS.indexOf('const BROWSER_MANUAL_COMMANDS='),b=DASHBOARD_JS.indexOf('\n',a);const groups=new Function(DASHBOARD_JS.slice(a,b)+';return BROWSER_MANUAL_COMMANDS')();assert.equal(groups.length,6);assert.match(groups[0].command,/\nif \[ "\$\(id -u\)"/);assert.match(groups[3].command,/puppeteer\/lib\/puppeteer\/node\/cli.js/);assert.match(groups[4].command,/pkg install chromium/);assert.ok(groups.every(g=>g.note&&g.command));
});
test('sample viewer shows full description and gallery safely, then returns to the unchanged report',async()=>{
 const {window}=parseHTML('<html><body><div id="resultModal">Original report</div></body></html>'),document=window.document;window.HTMLElement.prototype.focus=()=>{};
 const p={title:'<script>evil</script>',priceText:'1250000 تومان',longDesc:'<p>Full details</p><script>evil()</script>',shortDesc:'Cotton',sku:'PAT-42',brand:'Patris',images:['https://shop.example/a.jpg','javascript:evil()'],url:'javascript:evil()'};
 const a=DASHBOARD_JS.indexOf('function openDiagnosticProduct('),b=DASHBOARD_JS.indexOf('function benchmarkSampleCard(',a);
 const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const {openDiagnosticProduct}=await compile(DASHBOARD_JS.slice(a,b),'openDiagnosticProduct',{document,lastBenchmarkReport:{report:{results:[{sample:p,detail:{ok:true}}]}},lastDiagnosticReport:null,esc,escAttr:esc,pretty:x=>typeof x==='string'?x:JSON.stringify(x)});
 openDiagnosticProduct('benchmark',0);const overlay=document.querySelector('.result-modal');assert.ok(overlay);assert.match(overlay.textContent,/Full details/);assert.match(overlay.textContent,/PAT-42/);assert.equal(overlay.querySelectorAll('script,a').length,0);assert.equal(overlay.querySelectorAll('img').length,1);assert.equal(document.getElementById('resultModal').textContent,'Original report');overlay.onclick({target:overlay.querySelector('[data-sample-close]')});assert.equal(document.querySelector('.result-modal'),null);assert.ok(document.getElementById('resultModal'));
});
test('copy command reports failure truthfully and leaves manual-selection fallback',async()=>{
 const {document}=parseHTML('<section data-browser-command><textarea>node test.js</textarea><button></button></section>');const area=document.querySelector('textarea');let selected=0;area.focus=()=>{};area.select=()=>selected++;document.execCommand=()=>false;const notices=[];
 const a=DASHBOARD_JS.indexOf('async function copyBrowserCommand('),b=DASHBOARD_JS.indexOf('\n',a),{copyBrowserCommand}=await compile(DASHBOARD_JS.slice(a,b),'copyBrowserCommand',{document,navigator:{},window:{isSecureContext:false},notice:(...x)=>notices.push(x)});await copyBrowserCommand(document.querySelector('button'));assert.ok(selected);assert.equal(notices.at(-1)[1],'error');
});
for(const runtime of ['render','worker'])for(const route of ['benchmark-engines','extraction-diagnostic'])for(const flag of [false,true,'true'])test(runtime+' '+route+' passes strict boolean details flag '+JSON.stringify(flag),async()=>{
 const src=await read(runtime==='render'?'render-src/server.ts':'worker-src/app.ts'),line=src.split('\n').find(l=>l.startsWith("app.post('/api/profiles/:id/"+route+"'"));let handler,received;
 const io={app:{post:(url,fn)=>handler=fn},getProfile:async()=>({id:'p',selectors:{}}),jsonBody:async()=>({withDetails:flag}),benchmarkProfileEngines:async(...args)=>{received=args[2];return{}},diagnoseExtraction:async(...args)=>{received=args[3];return{stages:[],selectorsToSave:{}}},saveProfile:async()=>assert.fail('nothing to save')};
 await compile(line,'',io);await handler({req:{param:()=> 'p',query:()=>undefined,json:async()=>({withDetails:flag})},json:r=>r});assert.equal(received,flag===true);
});
