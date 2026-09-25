import {homedir} from 'node:os';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {lstat,readdir,mkdir,realpath,copyFile,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
export function cacheReusePlan(env=process.env,home=homedir()){
 const sourceHome=env.BROWSER_CACHE_SOURCE_HOME||'/root';
 const pw=env.PLAYWRIGHT_BROWSERS_PATH;
 if(pw==='0')throw Error('PLAYWRIGHT_BROWSERS_PATH=0 uses a package-local installation; set a shared runtime cache path before copying.');
 return [
  {driver:'playwright',source:join(sourceHome,'.cache/ms-playwright'),target:pw||join(env.XDG_CACHE_HOME||join(home,'.cache'),'ms-playwright')},
  {driver:'puppeteer',source:join(sourceHome,'.cache/puppeteer'),target:env.PUPPETEER_CACHE_DIR||join(home,'.cache/puppeteer')}
 ].map(p=>({...p,source:resolve(p.source),target:resolve(p.target)}));
}
const inside=(root,path)=>{const part=relative(root,path);return part===''||(!part.startsWith('..'+(process.platform==='win32'?'\\':'/'))&&part!=='..'&&!isAbsolute(part));};
/** Resolve existing parent aliases even before the destination directory exists. */
async function canonicalDestination(path){
 try{return await realpath(path)}catch(error){if(error.code!=='ENOENT')throw error;const parent=dirname(path);if(parent===path)throw error;return join(await canonicalDestination(parent),relative(parent,path));}
}
export async function reuseBrowserCaches({env=process.env,log=()=>{},home=homedir(),continueOnError=false}={}){
 const report=[];
 for(const plan of cacheReusePlan(env,home)){
  const row={...plan,copied:0,existing:0};report.push(row);
  try{
   log(plan.driver+': copying '+plan.source+' → '+plan.target+' (originals retained).');
   try{await lstat(plan.source)}catch(error){if(error.code==='ENOENT'){row.status='source-missing';log('No source cache; current runtime installation will still be tested.');continue}throw error}
   const root=await realpath(plan.source),destination=await canonicalDestination(plan.target);
   row.resolvedSource=root;row.resolvedTarget=destination;
   if(root===destination){row.status='already-runtime-cache';log('Source and destination resolve to the same runtime cache; no copy or permission change needed.');continue}
   if(inside(root,destination)||inside(destination,root))throw Error('Source and destination cache folders must not overlap');
   // Root aliases are an explicit deployment configuration, but never interpret a
   // browser-cache symlink to an unrelated system folder as an entire cache.
   if((await lstat(plan.source)).isSymbolicLink()&&!['ms-playwright','puppeteer'].includes(root.split(/[\\/]/).pop()))throw Error('Cache root symlink must resolve to a named browser cache, not an unrelated directory');
   try{if((await lstat(plan.target)).isSymbolicLink()&&!['ms-playwright','puppeteer'].includes(destination.split(/[\\/]/).pop()))throw Error('Cache destination symlink must resolve to a named browser cache, not an unrelated directory');}catch(error){if(error.code!=='ENOENT')throw error}
   if((await lstat(root)).isDirectory()!==true)throw Error('Source browser cache is not a directory');
   const active=new Set();
   async function copy(source,target){
    const actual=await realpath(source);
    if(!inside(root,actual))throw Error('Cache symlink escapes source: '+source+' → '+actual);
    if(active.has(actual))throw Error('Cache symlink cycle: '+source);
    const actualTarget=await canonicalDestination(target);
    if(!inside(destination,actualTarget))throw Error('Cache destination escapes runtime cache: '+target);
    try{if((await lstat(target)).isSymbolicLink())throw Error('Refusing a nested symlink cache destination: '+target)}catch(e){if(e.code!=='ENOENT')throw e}
    const info=await lstat(actual);
    if(info.isDirectory()){
     active.add(actual);try{await mkdir(target,{recursive:true,mode:0o755});await chmod(target,0o755);for(const name of await readdir(actual))if(name!=='.links')await copy(join(actual,name),join(target,name));}finally{active.delete(actual)}
    }else if(info.isFile()){
     try{await copyFile(actual,target,constants.COPYFILE_EXCL);await chmod(target,(info.mode&0o555)|0o600);row.copied++}
     catch(e){if(e.code==='EEXIST'){await chmod(target,(info.mode&0o555)|0o600);row.existing++;}else throw e}
    }else throw Error('Unsupported special file in browser cache: '+source);
   }
   await copy(root,destination);row.status='copied';log(plan.driver+': '+row.copied+' files copied; '+row.existing+' existing files retained.');
  }catch(error){row.status='failed';row.error=String(error.message||error);log(plan.driver+': '+row.error);if(!continueOnError)throw error;}
 }
 return report;
}
