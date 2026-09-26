import {applyBrowserPaths,browserPaths} from './browser-paths.mjs';
import os from 'node:os';
import path from 'node:path';
import {accessSync,statSync,constants} from 'node:fs';

/** Portable browser defaults. Never put a deployment ID, cache path or secret here. */
export const BROWSER_DEFAULTS=Object.freeze({linuxTemporaryDirectory:'/tmp',sandbox:'auto',debug:false});
let applied=null;
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
 env.VISUAL_BROWSER_NO_SANDBOX=String(settings.noSandbox);
 // DEBUG is deliberately not enabled; preserve an explicit administrator setting.
 if(env===process.env)applied=settings;
 return settings;
}
export function browserDefaultsReport(env=process.env){return env===process.env&&applied?structuredClone(applied):{...resolveBrowserDefaults({env}),paths:browserPaths(env)}}

/** Shared across extraction, visual snapshots, local tests and installer probes. */
export function browserLaunchArguments(options={},extra=[]){
 const {noSandbox}=resolveBrowserDefaults(options);
 return [...(noSandbox?['--no-sandbox','--disable-setuid-sandbox']:[]),'--disable-dev-shm-usage','--disable-gpu',...extra];
}
export function playwrightSandboxOptions(options={}){
 // Playwright's own default disables the Chromium sandbox. Explicitly set it
 // when our policy calls for sandboxing; omitting --no-sandbox is not enough.
 return {chromiumSandbox:!resolveBrowserDefaults(options).noSandbox};
}
