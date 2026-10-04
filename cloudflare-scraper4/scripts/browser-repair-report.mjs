import {browserInstallReport} from './browser-install-report.mjs';
import {cacheRequirements,inspectBrowserCache,legacyBrowserCaches} from './browser-cache-compatibility.mjs';
import {browserDefaultsReport} from './browser-defaults.mjs';
import os from 'node:os';
import {access,readFile,readdir,stat,statfs,lstat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createRequire} from 'node:module';
import {join,dirname} from 'node:path';
import {npmCli} from './browser-repair.mjs';
import {cacheReusePlan} from './browser-cache-reuse.mjs';

export function reportRedactor(env={},network={}){
 const secrets=Object.entries(env).filter(([key,value])=>/token|secret|password|credential|cookie|authorization|api.?key|database_url|node_options/i.test(key)&&!/^(?:true|false)$/i.test(String(value))&&String(value||'').length>=4).map(([,value])=>String(value));
 for(const value of [network.workerUrl,network.proxyUrl])if(value)secrets.push(String(value));
 const privateOrigins=new Set([network.workerUrl,network.proxyUrl].filter(Boolean).map(raw=>{try{return new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw).origin}catch{return ''}}));
 return value=>{
  let text=String(value??'');for(const secret of secrets.sort((a,b)=>b.length-a.length))text=text.split(secret).join('[redacted]');
  return text.replace(/\x1b\[[0-9;]*m/g,'').replace(/https?:\/\/[^\s"'<>]+/gi,raw=>{try{const u=new URL(raw);if(privateOrigins.has(u.origin)&&u.pathname!=='/')return u.origin+'/[redacted endpoint]';return u.origin+u.pathname+(u.search?'?[redacted]':'')+(u.hash?'#[redacted]':'')}catch{return '[redacted URL]'}})
   .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.:-]+/gi,'$1 [redacted]')
   .replace(/((?:token|secret|password|authorization|cookie|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi,'$1[redacted]');
 };
}
function endpoint(raw){try{const url=new URL(/^https?:\/\//i.test(raw)?raw:'https://'+raw);return {configured:true,origin:url.origin,credentialsPresent:!!(url.username||url.password),queryPresent:!!url.search,pathPresent:url.pathname!=='/'}}catch{return {configured:!!raw,valid:false}}}
async function pathInfo(path){
 if(!path)return {configured:false};const result={path};
 try{const s=await stat(path);Object.assign(result,{exists:true,symlink:(await lstat(path)).isSymbolicLink(),resolvedPath:await realpath(path),directory:s.isDirectory(),mode:(s.mode&0o777).toString(8),uid:s.uid,gid:s.gid});for(const [key,flag] of [['readable',constants.R_OK],['writable',constants.W_OK],['executableOrSearchable',constants.X_OK]])result[key]=await access(path,flag).then(()=>true,()=>false)}catch(e){Object.assign(result,{exists:e.code==='ENOENT'?false:null,error:e.code||'unavailable'})}return result;
}
async function diskInfo(path){try{const s=await statfs(path);return {path,availableBytes:s.bavail*s.bsize,totalBytes:s.blocks*s.bsize}}catch(e){return {path,error:e.code||'unavailable'}}}
async function packageInfo(cwd,name,lock){
 const out={name,lockedVersion:lock?.packages?.['node_modules/'+name]?.version||null};
 try{const req=createRequire(join(cwd,'package.json'));let directory;try{directory=dirname(req.resolve(name+'/package.json'))}catch{directory=dirname(req.resolve(name))}
  for(let i=0;i<8;i++){try{const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(pkg.name===name)return {...out,installed:true,installedVersion:pkg.version,nodeRequirement:pkg.engines?.node||null,location:directory}}catch{}const parent=dirname(directory);if(parent===directory)break;directory=parent}
  return {...out,installed:null,error:'Package resolved but version metadata unavailable'};
 }catch(e){return {...out,installed:false,error:e.code||'unavailable'}}
}
export async function browserRepairReport({cwd=process.cwd(),env=process.env,state={},network={},version='',head='',resolveExecutable=()=>undefined}={}){
 const clean=reportRedactor(env,network),warnings=[];
 const readJson=async file=>{try{return JSON.parse(await readFile(join(cwd,file),'utf8'))}catch{return {}}};
 const pkg=await readJson('package.json'),lock=await readJson('package-lock.json');
 let osName='unknown';try{osName=(await readFile('/etc/os-release','utf8')).match(/^PRETTY_NAME=(.*)$/m)?.[1]?.replace(/^"|"$/g,'')||osName}catch{}
 let libc=null;try{libc=process.report?.getReport()?.header?.glibcVersionRuntime||null}catch{}
 let plan=[];try{plan=cacheReusePlan(env)}catch(e){warnings.push(e.message)}
 const caches=[];for(const item of plan){const source=await pathInfo(item.source),target=await pathInfo(item.target);let revisions=[];try{revisions=(await readdir(item.target)).filter(x=>x!=='.links').slice(0,40)}catch{}caches.push({driver:item.driver,source,target,disk:await diskInfo(item.target),revisions,revisionListingLimit:40})}
 const requirements=cacheRequirements(cwd),legacy=legacyBrowserCaches(env);
 for(const cache of caches){cache.compatibility=inspectBrowserCache(cache.target.path,requirements[cache.driver],cache.driver);cache.legacyCandidates=legacy[cache.driver].map(path=>inspectBrowserCache(path,requirements[cache.driver],cache.driver));if(!cache.compatibility.compatible)warnings.push(cache.driver+': selected cache does not contain all expected executable files. This is not proof of a sandbox or memory failure.');}
 const backgroundInstall=await browserInstallReport(cwd);
 if(!backgroundInstall.recorded)warnings.push('No background installation status recorded; the in-memory repair job is separate and idle does not prove installation completed.');
 if(backgroundInstall.interrupted)warnings.push('Background installer is no longer running; its recorded running state is stale. Retry browser setup.');
 const executables={};for(const driver of ['playwright','puppeteer']){try{const path=resolveExecutable(driver);executables[driver]=path?await pathInfo(path):{selection:'library-managed cache (no explicit/system executable resolved)'}}catch(e){executables[driver]={error:e.message}}}
 const proxy={};for(const key of ['HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','https_proxy','http_proxy','all_proxy'])if(env[key])proxy[key]=endpoint(env[key]);
 let browserDefaults;try{browserDefaults=browserDefaultsReport(env)}catch(error){browserDefaults={error:String(error.message||error)}}
 const flags={};for(const key of ['TMPDIR','TMP','TEMP','BROWSER_TMPDIR','PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD','PUPPETEER_SKIP_DOWNLOAD','PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT','VISUAL_BROWSER_NO_SANDBOX'])if(env[key]!==undefined)flags[key]=env[key];
 const overrides={};for(const key of ['PLAYWRIGHT_DOWNLOAD_HOST','PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST','PUPPETEER_DOWNLOAD_BASE_URL'])if(env[key])overrides[key]=endpoint(env[key]);
 let npm;try{const cli=npmCli(env),metadata=JSON.parse(await readFile(join(dirname(dirname(cli)),'package.json'),'utf8'));npm={cli,version:metadata.version,nodeRequirement:metadata.engines?.node||null}}catch(e){npm={available:false,error:e.code||'CLI metadata unavailable'}}
 const report={reportType:'Scraper4 browser install/repair diagnostic',generatedAt:new Date().toISOString(),application:{version:version||pkg.version||'unknown',head,cwd},
  runtime:{node:process.version,npm,requiredNode:pkg.engines?.node||null,nodeExecutable:process.execPath,platform:process.platform,architecture:process.arch,osRelease:os.release(),osName,glibc:libc,uid:process.getuid?.()??null,gid:process.getgid?.()??null,root:process.getuid?.()===0,home:os.homedir(),termux:process.platform==='android'||String(env.PREFIX||'').includes('com.termux'),cpuCount:os.cpus().length,uptimeSeconds:Math.round(process.uptime()),memory:{totalBytes:os.totalmem(),freeBytes:os.freemem(),processRssBytes:process.memoryUsage().rss}},
  disk:await diskInfo(cwd),projectPermissions:await pathInfo(cwd),libraries:await Promise.all(['playwright','playwright-core','puppeteer','puppeteer-core','crawlee','@puppeteer/browsers'].map(name=>packageInfo(cwd,name,lock))),
  executables,caches,backgroundInstall,currentNetwork:{mode:network.mode||'unknown',gateway:endpoint(network.workerUrl||''),proxy:endpoint(network.proxyUrl||''),environmentProxies:proxy,noProxyConfigured:!!(env.NO_PROXY||env.no_proxy),downloadHostOverrides:overrides},
  accessPolicy:{adminTokenConfigured:!!String(env.ADMIN_TOKEN||'').trim(),adminAuthDisabled:env.ADMIN_AUTH_DISABLED==='true'},installerPolicy:{browserDownloadTimeoutMs:180000,libraryInstallTimeoutMs:300000,launchTestTimeoutMs:45000,downloadConnectionTimeoutMs:60000,lifecycleScripts:false,automaticSudo:false,directFallbackFromGateway:false},flags,browserDefaults,customNodeOptionsPresent:!!env.NODE_OPTIONS,job:state,warnings,
  scope:['Read-only report: no installation, launch, download, copy or network probe was performed.','Current configuration may differ from the last run; job.downloadRoute records the route selected for that run when available.','Log is an in-memory tail capped at 24000 characters; logTruncated reports truncation. Restarting the process clears this job history.','OS libraries, target-site access and large Cloudflare transfers are not retested.','Review paths and hostnames before sharing. Credentials, URL queries and sensitive environment values are excluded/redacted.']};
 return clean('SCRAPER4 BROWSER REPAIR REPORT\n'+JSON.stringify(report,null,2));
}
