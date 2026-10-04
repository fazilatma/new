// Read-only upgrade compatibility: never redirect to an arbitrary browser revision.
import {readFileSync,statSync,accessSync,constants} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
export function cacheRequirements(root,{platform=process.platform,arch=process.arch}={}){
 const result={playwright:[],puppeteer:[]};
 const readable=file=>{try{return readFileSync(file,'utf8')}catch{return ''}};
 let browsers=[];try{browsers=JSON.parse(readable(join(root,'node_modules/playwright-core/browsers.json'))).browsers||[]}catch{}
 for(const name of ['chromium','chromium-headless-shell']){
  const item=browsers.find(b=>b.name===name);
  // Overrides require SDK-specific platform logic; fail closed rather than guess.
  if(!item||item.revisionOverrides||!/^\d+$/.test(item.revision))continue;
  const shell=name==='chromium-headless-shell',base=(shell?'chromium_headless_shell-':'chromium-')+item.revision;
  let paths=[];
  if(platform==='linux')paths=shell?['chrome-headless-shell-linux64/chrome-headless-shell','chrome-linux/headless_shell']:['chrome-linux64/chrome','chrome-linux/chrome'];
  if(platform==='win32')paths=shell?['chrome-headless-shell-win64/chrome-headless-shell.exe','chrome-win/headless_shell.exe']:['chrome-win64/chrome.exe','chrome-win/chrome.exe'];
  if(platform==='darwin')paths=shell?[`chrome-headless-shell-mac-${arch==='arm64'?'arm64':'x64'}/chrome-headless-shell`,'chrome-mac/headless_shell']:[`chrome-mac-${arch==='arm64'?'arm64':'x64'}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,'chrome-mac/Chromium.app/Contents/MacOS/Chromium'];
  if(paths.length)result.playwright.push({component:name,revision:item.revision,alternatives:paths.map(p=>join(base,p))});
 }
 const revisions=readable(join(root,'node_modules/puppeteer-core/lib/puppeteer/revisions.js'));
 const version=revisions.match(/\bchrome:\s*['"]([\d.]+)['"]/)?.[1];
 const target=platform==='linux'?(arch==='x64'?'linux':null):platform==='win32'?'win64':platform==='darwin'?(arch==='arm64'?'mac_arm':'mac'):null;
 const executable=platform==='linux'?'chrome-linux64/chrome':platform==='win32'?'chrome-win64/chrome.exe':`chrome-mac-${arch==='arm64'?'arm64':'x64'}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
 if(version&&target)result.puppeteer=[{component:'chrome',revision:version,alternatives:[join('chrome',target+'-'+version,executable)]}];
 return result;
}
export function inspectBrowserCache(folder,requirements,driver){
 const components=requirements.map(item=>({...item,paths:item.alternatives.map(relative=>{
  const path=join(folder,relative);try{if(!statSync(path).isFile())throw Error('not-file');accessSync(path,constants.R_OK|constants.X_OK);return {path,usable:true};}catch(error){return {path,usable:false,error:error.code||error.message};}
 })}));
 return {path:folder,compatible:components.length===(driver==='playwright'?2:1)&&components.every(c=>c.paths.some(p=>p.usable)),components};
}
export function legacyBrowserCaches(env=process.env,{platform=process.platform,uid=process.getuid?.(),home=env.HOME||env.USERPROFILE||homedir()}={}){
 const homes=[home,env.BROWSER_CACHE_SOURCE_HOME,...(platform==='linux'&&uid===0?['/root']:[])].filter(Boolean);
 const playwright=[env.XDG_CACHE_HOME&&join(env.XDG_CACHE_HOME,'ms-playwright'),...homes.map(h=>platform==='win32'?join(env.LOCALAPPDATA||join(h,'AppData/Local'),'ms-playwright'):platform==='darwin'?join(h,'Library/Caches/ms-playwright'):join(h,'.cache/ms-playwright'))].filter(Boolean);
 return {playwright:[...new Set(playwright)],puppeteer:[...new Set(homes.map(h=>join(h,'.cache/puppeteer')))]};
}
export function compatibleCachePath(driver,projectPath,env,root,options={}){
 const requirements=cacheRequirements(root,options)[driver];
 if(inspectBrowserCache(projectPath,requirements,driver).compatible)return projectPath;
 for(const candidate of legacyBrowserCaches(env,options)[driver])if(inspectBrowserCache(candidate,requirements,driver).compatible)return candidate;
 return projectPath;
}
