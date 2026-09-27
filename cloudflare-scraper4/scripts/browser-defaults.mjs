import {applyBrowserPaths,browserPaths} from './browser-paths.mjs';
import os from 'node:os';
import path from 'node:path';
import {accessSync,statSync,constants} from 'node:fs';

/** Portable browser defaults. Never put a deployment ID, cache path or secret here. */
export const BROWSER_DEFAULTS=Object.freeze({linuxTemporaryDirectory:'/tmp',sandbox:'auto',debug:false});
let applied=null;
function findPrivateLibDir(env=process.env){
 const candidates=[];
 if(env.BROWSER_LD_LIBRARY_PATH){
  for(const part of String(env.BROWSER_LD_LIBRARY_PATH).split(':')){
   const trimmed=part.trim();
   if(trimmed)candidates.push(trimmed);
  }
 }
 if(env.HOME)candidates.push(path.posix.join(env.HOME,'browser-libs','lib'));
 try{const hd=os.homedir();if(hd&&hd!==env.HOME)candidates.push(path.posix.join(hd,'browser-libs','lib'));}catch{}
 candidates.push('/home/sabashop/browser-libs/lib');
 for(const candidate of candidates){
  try{if(statSync(candidate).isDirectory())return candidate;}catch{}
 }
 return null;
}
export function resolveBrowserDefaults({env=process.env,platform=process.platform,uid=process.getuid?.(),systemTemp=os.tmpdir()}={}){
 const termux=platform==='android'||String(env.PREFIX||'').includes('com.termux');
 const explicit=String(env.BROWSER_TMPDIR||'').trim();
 const temporaryDirectory=explicit||(termux?(env.PREFIX?path.posix.join(env.PREFIX,'tmp'):env.TMPDIR||systemTemp):platform==='linux'?BROWSER_DEFAULTS.linuxTemporaryDirectory:env.TEMP||env.TMP||env.TMPDIR||systemTemp);
 const paths=platform==='win32'?path.win32:path.posix;
 if(!paths.isAbsolute(temporaryDirectory))throw Error('BROWSER_TMPDIR must be an absolute directory path.');
 const raw=String(env.VISUAL_BROWSER_NO_SANDBOX??'auto').trim().toLowerCase();
 if(!['auto','true','false'].includes(raw))throw Error('VISUAL_BROWSER_NO_SANDBOX must be auto, true or false.');
 const root=platform!=='win32'&&uid===0;
 const noSandbox=raw==='true'||(raw==='auto'&&(root||termux));
 return {temporaryDirectory,temporarySource:explicit?'BROWSER_TMPDIR':termux?'termux':platform==='linux'?'portable-linux-default':'platform-default',noSandbox,sandboxPolicy:raw,root,termux,debugEnabled:!!env.DEBUG,warnings:noSandbox?['Chromium sandbox is disabled for compatibility. Prefer a non-root service with sandboxing; do not expose this service to untrusted users.']:[]};
}
/** Run before SDK launch: Playwright creates its profile via parent os.tmpdir(),
 * so changing only the Chromium child's environment does NOT fix private TMPDIR. */
export function applyBrowserDefaults(env=process.env,options={}){
 const settings=resolveBrowserDefaults({...options,env});
 settings.paths=applyBrowserPaths(env,options);
 try{if(!statSync(settings.temporaryDirectory).isDirectory())throw Error('Not a directory');accessSync(settings.temporaryDirectory,constants.W_OK|constants.X_OK)}catch{settings.warnings.push('Browser temporary directory is not writable/searchable by this process: '+settings.temporaryDirectory+'. Create/fix a suitable directory and set BROWSER_TMPDIR; no permissions were changed.');}
 env.TMPDIR=settings.temporaryDirectory;env.TMP=settings.temporaryDirectory;env.TEMP=settings.temporaryDirectory;
 // Private shared-host libraries (e.g. ~/browser-libs/lib) must be visible to
 // the browser child processes; the helper sets LD_LIBRARY_PATH only for its
 // own ldd checks, so the app has to wire it itself. Detect common locations
 // and prepend them, without overwriting an explicit administrator setting.
 let privateLib=null;
 if(env.BROWSER_LD_LIBRARY_PATH){
  const parts=String(env.BROWSER_LD_LIBRARY_PATH).split(':').map(s=>s.trim()).filter(Boolean);
  for(const part of parts){try{if(statSync(part).isDirectory()){privateLib=part;break;}}catch{}}
  if(!privateLib&&parts.length)privateLib=parts[0];
  const existing=env.LD_LIBRARY_PATH?env.LD_LIBRARY_PATH.split(':').filter(Boolean):[];
  const merged=[...parts,...existing.filter(e=>!parts.includes(e))];
  env.LD_LIBRARY_PATH=merged.join(':');
 }else{
  privateLib=findPrivateLibDir(env);
  if(privateLib){
   const existing=env.LD_LIBRARY_PATH?env.LD_LIBRARY_PATH.split(':').filter(Boolean):[];
   if(!existing.includes(privateLib))env.LD_LIBRARY_PATH=[privateLib,...existing].join(':');
  }
 }
 if(privateLib){
  settings.privateLibDir=privateLib;
  // On the EL8 shared host the sandbox cannot run; when the private libs are
  // present and the policy is still auto, enable no-sandbox automatically.
  if(settings.sandboxPolicy==='auto'&&!settings.noSandbox){
   const platform=options.platform||process.platform;
   if(platform==='linux'||platform==='android'){
    settings.noSandbox=true;
    settings.warnings.push('Private browser libraries detected at '+privateLib+'; Chromium sandbox disabled for compatibility (set VISUAL_BROWSER_NO_SANDBOX=false to override).');
   }
  }
 }
 env.VISUAL_BROWSER_NO_SANDBOX=String(settings.noSandbox);
 // DEBUG is deliberately not enabled; preserve an explicit administrator setting.
 if(env===process.env)applied=settings;
 return settings;
}
export function browserDefaultsReport(env=process.env){return env===process.env&&applied?structuredClone(applied):{...resolveBrowserDefaults({env}),paths:browserPaths(env)}}

/** Shared across extraction, visual snapshots, local tests and installer probes. */
export function browserLaunchArguments(options={},extra=[]){
 const {noSandbox}=resolveBrowserDefaults(options);
 const env=options.env||process.env;
 const privateLib=findPrivateLibDir(env);
 // On shared host with private libs, even --no-sandbox may still SIGTRAP under CloudLinux LVE.
 // Adding --no-zygote --single-process reduces sandbox/namespace requirements.
 const sharedHostExtra=privateLib?['--no-zygote','--single-process']: [];
 return [...(noSandbox?['--no-sandbox','--disable-setuid-sandbox']:[]),'--disable-dev-shm-usage','--disable-gpu',...sharedHostExtra,...extra];
}
export function playwrightSandboxOptions(options={}){
 // Playwright's own default disables the Chromium sandbox. Explicitly set it
 // when our policy calls for sandboxing; omitting --no-sandbox is not enough.
 return {chromiumSandbox:!resolveBrowserDefaults(options).noSandbox};
}
