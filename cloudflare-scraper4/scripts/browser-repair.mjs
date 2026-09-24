import {spawn} from 'node:child_process';
import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname,join} from 'node:path';
export const MIRROR='https://registry.npmmirror.com/-/binary/playwright';
export const redact=text=>String(text).replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1[redacted]@').replace(/\x1b\[[0-9;]*m/g,'');
export function downloadEnvironment(env,mirror=false){
 const out={...env,PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:'60000'};
 for(const k of ['PLAYWRIGHT_DOWNLOAD_HOST','PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST','PLAYWRIGHT_FIREFOX_DOWNLOAD_HOST','PLAYWRIGHT_WEBKIT_DOWNLOAD_HOST'])delete out[k];
 if(mirror)out.PLAYWRIGHT_DOWNLOAD_HOST=MIRROR;
 return out;
}
export function runBrowserCommand(args,{cwd,env,log,timeout=180000}){
 return new Promise(resolveResult=>{
  const child=spawn(process.execPath,args,{cwd,env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}},timeout);
  // Buffer complete lines so proxy credentials split across chunks are redacted together.
  for(const stream of [child.stdout,child.stderr]){
   let pending='';stream.on('data',d=>{pending+=String(d);let at;while((at=pending.indexOf('\n'))>=0){log(pending.slice(0,at));pending=pending.slice(at+1);}if(pending.length>24000){pending='';log('[oversized output line omitted]');}});
   stream.on('end',()=>{if(pending)log(pending);});
  }
  child.on('error',e=>{clearTimeout(timer);log(e.message);resolveResult(false);});
  child.on('close',code=>{clearTimeout(timer);if(timedOut)log('Step timed out; download/browser process group terminated.');resolveResult(code===0&&!timedOut);});
 });
}
export const LIBRARIES=['playwright','puppeteer','crawlee'];
export const CHROME_MIRROR='https://registry.npmmirror.com/-/binary/chrome-for-testing';
export function libraryPlan(cwd){
 const req=createRequire(resolve(cwd,'package.json'));
 const lock=JSON.parse(readFileSync(resolve(cwd,'package-lock.json'),'utf8'));
 return LIBRARIES.map(name=>{
  const version=lock.packages?.['node_modules/'+name]?.version;
  if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version||''))throw Error('Missing pinned lockfile version: '+name);
  let installed=false;try{req.resolve(name);installed=true;}catch{}
  return {name,version,installed};
 });
}
export function localCli(cwd,name){
 const req=createRequire(resolve(cwd,'package.json'));
 const file=req.resolve(name+'/package.json'),pkg=JSON.parse(readFileSync(file,'utf8'));
 const bin=typeof pkg.bin==='string'?pkg.bin:pkg.bin?.[name];
 if(!bin)throw Error('Local CLI missing for '+name);
 return resolve(dirname(file),bin);
}
export function npmCli(env){
 const candidates=[env.npm_execpath,join(dirname(process.execPath),'npm'),join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...String(env.PATH||'').split(process.platform==='win32'?';':':').map(dir=>join(dir,'npm'))];
 for(const path of candidates){try{if(path){const file=realpathSync(path);if(file.endsWith('.js'))return file;}}catch{}}
 throw Error('A readable npm CLI was not found; install project dependencies through the deployment manager.');
}
export function smokeScript(engine,executable){
 const opts=JSON.stringify({headless:true,timeout:30000,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],...(executable?{executablePath:executable}:{})});
 const launch=engine==='playwright'?`const {chromium}=await import('playwright');b=await chromium.launch(${opts});`:engine==='puppeteer'?`const {default:p}=await import('puppeteer');b=await p.launch(${opts});`:`const c=await import('crawlee');b=await c.${engine==='crawlee-playwright'?'launchPlaywright':'launchPuppeteer'}({launchOptions:${opts}});`;
 return `let b;try{${launch}const page=await b.newPage();await page.setContent('<title>Browser launch OK</title>');if(await page.title()!=='Browser launch OK')throw Error('Page test failed');console.log('Browser launch OK',await b.version());}finally{if(b)await b.close();}`;
}
export function createBrowserRepair({cwd=process.cwd(),env=process.env,uid=process.getuid?.(),run=runBrowserCommand,exists=existsSync,resolveExecutable=driver=>env.BROWSER_EXECUTABLE_PATH||(driver==='playwright'?env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:env.PUPPETEER_EXECUTABLE_PATH)||env.CHROME_BIN,resolveCli=name=>localCli(cwd,name),plan=()=>libraryPlan(cwd),resolveNpm=()=>npmCli(env)}={}){
 const fresh=()=>({running:false,success:null,phase:'idle',log:'',results:{},startedAt:null,finishedAt:null});
 let state=fresh();
 const snapshot=()=>({...state,results:JSON.parse(JSON.stringify(state.results))});
 const log=text=>{state.log=(state.log+redact(text)+'\n').slice(-24000);};
 async function verify(engine,executable){
  state.phase=engine+'-verifying';log('Testing '+engine+' with the current runtime browser configuration.');
  return run(['--input-type=module','-e',smokeScript(engine,executable)],{cwd,env,log,timeout:45000});
 }
 async function repairDriver(driver,executable,options){
  try{
   if(await verify(driver,executable))return true;
   if(executable)throw Error('Configured/system executable failed: fix its OS libraries, permissions or path. Bundled download cannot repair an explicit override. On Termux use pkg install chromium.');
   const cli=resolveCli(driver);if(!exists(cli))throw Error('Local CLI not found for '+driver);
   for(const mirror of options.allowMirror?[false,true]:[false]){
    state.phase=driver+(mirror?'-mirror-download':'-official-download');
    log(driver+': '+(mirror?'trying third-party npmmirror with your consent; this revision may be unavailable.':'trying official download; existing HTTP/HTTPS proxy settings are inherited.'));
    const args=driver==='playwright'?[cli,'install','chromium']:[cli,'browsers','install','chrome','--base-url',mirror?CHROME_MIRROR:'https://storage.googleapis.com/chrome-for-testing-public'];
    if(await run(args,{cwd,env:downloadEnvironment(env,driver==='playwright'&&mirror),log})){
     if(await verify(driver,executable))return true;
     throw Error('Download completed but launch failed. Inspect OS libraries, Node compatibility, permissions and RAM. No system packages were changed.');
    }
   }
   throw Error('Download failed. A reachable proxy or compatible offline transfer may be needed. No version downgrade was performed.');
  }catch(e){log(driver+': '+e.message);return false;}
 }
 async function work(options){
  try{
   state.phase='libraries';
   log('Uses this process user, project and cache. No sudo, OS packages, ownership changes or Node replacement. Browser flags match extraction.');
   if(uid===0)log('WARNING: executing as root with your acknowledgement; a non-root runtime is recommended.');
   const libraries=plan(),missing=libraries.filter(p=>!p.installed);
   for(const lib of libraries)log(lib.name+' pinned '+lib.version+': '+(lib.installed?'present':'missing'));
   if(missing.length){
    let installed=false;
    for(const mirror of options.allowMirror?[false,true]:[false]){
     log('Installing missing locked libraries via '+(mirror?'third-party npmmirror':'official npm registry')+'; lifecycle scripts are disabled.');
     installed=await run([resolveNpm(),'install','--ignore-scripts','--no-save','--package-lock=false','--no-audit','--no-fund','--engine-strict','--registry='+ (mirror?'https://registry.npmmirror.com':'https://registry.npmjs.org'),...missing.map(p=>p.name+'@'+p.version)],{cwd,env:{...env,PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:'1',PUPPETEER_SKIP_DOWNLOAD:'true'},log,timeout:300000});
     if(installed)break;
    }
    if(!installed)log('Library installation failed; still testing any available engines. Check Node engine requirements and network access.');
   }
   const termux=(env.PREFIX||'').includes('com.termux')||exists('/data/data/com.termux/files/usr/bin/pkg');
   const paths=Object.fromEntries(['playwright','puppeteer'].map(driver=>[driver,resolveExecutable(driver)||(termux?'/data/data/com.termux/files/usr/bin/chromium':'')]));
   for(const driver of ['playwright','puppeteer'])state.results[driver]={success:await repairDriver(driver,paths[driver],options)};
   for(const driver of ['playwright','puppeteer']){
    const engine='crawlee-'+driver;
    if(!state.results[driver].success){state.results[engine]={success:false,skipped:true};log(engine+': skipped because its underlying browser failed.');continue;}
    state.results[engine]={success:await verify(engine,paths[driver])};
   }
   state.success=Object.values(state.results).every(r=>r.success);
   log(state.success?'All four browser launch/page tests passed. This does not prove access to any target site.':'Some components failed; see per-engine results and logs. A site HTTP 403 is not fixed by installing browsers.');
  }catch(e){log(e.message);state.success=false;}
  finally{state.running=false;state.phase=state.success?'ready':'failed';state.finishedAt=new Date().toISOString();}
 }
 function start(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['allowMirror','allowRoot'].includes(k))||Object.values(options).some(v=>typeof v!=='boolean'))throw Error('Only boolean allowMirror/allowRoot options are accepted.');
  if(state.running)return snapshot();
  if(uid===0&&options.allowRoot!==true)throw Error('This scraper runs as root. Explicit root-runtime acknowledgement is required. Running a web scraper as root is not recommended.');
  state={...fresh(),running:true,phase:'starting',startedAt:new Date().toISOString()};
  void work(options);return snapshot();
 }
 return {start,status:()=>({...snapshot(),root:uid===0})};
}
