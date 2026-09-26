import test from 'node:test';
import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {readFile,mkdtemp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CheerioHTMLRewriter} from './product-parser-html-rewriter.mjs';
globalThis.HTMLRewriter=CheerioHTMLRewriter;
const root=fileURLToPath(new URL('..',import.meta.url)),read=f=>readFile(join(root,f),'utf8');
const temp=await mkdtemp(join(root,'node_modules/.cache/product-parser-')),req=createRequire(import.meta.url);
let downloads=0;globalThis.__parserDownload=async url=>{downloads++;return{text:globalThis.__parserHtml,url,contentType:'text/html'}};
async function bundle(runtime,before=false){
 const original=before?execFileSync('git',['show',`2a7f7da:cloudflare-scraper4/${runtime}-src/scraper.ts`],{cwd:root,encoding:'utf8'}):null;
 const outfile=join(temp,`${runtime}-${before}.cjs`);
 await build({entryPoints:[join(root,runtime+'-src/scraper.ts')],outfile,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'offline',setup(b){
 b.onResolve({filter:/^\.\/playwright-python\.js$/},()=>({path:'rendered-fixture',namespace:'rendered'}));
 b.onLoad({filter:/.*/,namespace:'rendered'},()=>({contents:`export const renderPythonPlaywright=async(url)=>({html:globalThis.__parserRendered,finalUrl:url,httpStatus:200});`}));
 if(original)b.onLoad({filter:new RegExp(runtime+'-src/scraper.ts$')},()=>({contents:original,loader:'ts',resolveDir:join(root,runtime+'-src')}));
 b.onResolve({filter:/^(\.\/network\.js|\.\/db\.js|\.\/connections\.js)$/},a=>({path:a.path,namespace:'mock'}));
 b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:a.path.includes('network')?`export const safeText=(...a)=>globalThis.__parserDownload(...a),safeTextViaWorker=safeText,sourceRoute=()=> 'direct',assertPublicUrl=async()=>{},safeFetch=async()=>{throw Error('Unexpected network')};`:a.path.includes('connections')?'export const loadConnections=async()=>({ai:{network:{}}});':'export const getState=async(_k,value)=>value;'}));
 }}]});return req(outfile);
}

const html=await read('worker-tests/fixtures/halva-shop/page-1.html');
const selectors={container:'li.product',title:'.product-title',price:'.price',link:'a.product-link',image:'img'};
for(const runtime of ['render','worker']){
 const twin=await bundle(runtime);
 test(runtime+': enabled diagnostics compare all eight parsers on one document without changing profile',async()=>{
  globalThis.__parserHtml=html;downloads=0;
  const profile={id:'lab',url:'https://halva.example/page-1.html',selectors:{...selectors},extractionEngine:runtime==='render'?'cheerio':'htmlrewriter',productParserEnabled:true,productParser:'lxml'};
  const before=structuredClone(profile),report=await twin.diagnoseExtraction(profile);
  assert.equal(report.parserResults.length,8);assert.equal(report.parserResults.find(r=>r.parser==='lxml').count,12);assert.deepEqual(profile,before);assert.ok(downloads<=3,'comparison must not fetch once per parser; existing detail probes are separate');
 });
 test(runtime+': a partial manual selector set is never reclassified as unconfigured',async()=>{
  const manual={container:'.manual-card',title:'.manual-title',price:'',link:'a',image:''};
  assert.equal(twin.listSelectorsStatus(manual),'custom');
  assert.equal((await twin.parseProductDocument(html,'https://halva.example/',manual,'lxml')).length,0);
 });
}

await build({entryPoints:[join(root,'worker-src/product-parser.ts')],outfile:join(temp,'matrix.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const matrix=req(join(temp,'matrix.cjs'));
test('matrix isolates a throwing parser, reports empty results and never suppresses later choices',async()=>{
 const calls=[],rows=await matrix.compareProductParsers(async parser=>{calls.push(parser);if(parser==='lxml')throw Error('bad selector');return parser==='selectolax'?[{title:'Example',price:12,url:'https://shop.example/p',image:''}]:[];});
 assert.deepEqual(calls,matrix.PRODUCT_PARSERS);assert.equal(rows.length,8);assert.equal(rows[1].status,'failed');assert.equal(rows[1].error,'bad selector');assert.equal(rows[2].sample.title,'Example');assert.equal(rows[7].status,'empty');
});
for(const runtime of ['render','worker'])test(runtime+': OFF does not compare, and failed download marks every enabled parser skipped',async()=>{
 const twin=await bundle(runtime),profile={id:'p',url:'https://halva.example/',selectors,extractionEngine:runtime==='render'?'cheerio':'htmlrewriter',productParser:'lxml'};
 globalThis.__parserHtml=html;
 assert.equal((await twin.diagnoseExtraction({...profile,productParserEnabled:false})).parserResults,undefined);
 const prior=globalThis.__parserDownload;globalThis.__parserDownload=async()=>{throw Error('download failed')};
 try{const r=await twin.diagnoseExtraction({...profile,productParserEnabled:true});assert.equal(r.parserResults.length,8);assert.ok(r.parserResults.every(x=>x.status==='skipped'));}finally{globalThis.__parserDownload=prior;}
});

test('Node browser-loader matrix reads the rendered document, never the initial HTML shell',async()=>{
 const twin=await bundle('render');globalThis.__parserHtml='<html><title>Initial empty shell</title></html>';globalThis.__parserRendered=html;
 const report=await twin.diagnoseExtraction({id:'browser',url:'https://halva.example/page-1.html',selectors,extractionEngine:'playwright',productParserEnabled:true,productParser:'lxml'});
 assert.equal(report.parserResults.length,8);assert.equal(report.parserResults.find(x=>x.parser==='lxml').count,12);assert.ok(report.parserResults.every(x=>x.source==='rendered-html'));assert.equal(report.productCount,12);
});
