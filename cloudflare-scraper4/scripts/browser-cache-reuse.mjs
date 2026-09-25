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
async function checkParents(path){for(let p=resolve(path);;p=dirname(p)){try{if((await lstat(p)).isSymbolicLink())throw Error('Refusing symlink in cache path: '+p)}catch(e){if(e.code!=='ENOENT')throw e}if(dirname(p)===p)break;}}
export async function reuseBrowserCaches({env=process.env,log=()=>{},home=homedir()}={}){
 const report=[];
 for(const plan of cacheReusePlan(env,home)){
  const row={...plan,copied:0,existing:0};report.push(row);
  log(plan.driver+': copying '+plan.source+' → '+plan.target+' (originals retained).');
  try{await lstat(plan.source)}catch(error){if(error.code==='ENOENT'){log('No source cache; current runtime installation will still be tested.');continue}throw error}
  if(plan.source===plan.target){log('Source is already the runtime cache; no copy needed.');continue}
  for(const [a,b] of [[plan.source,plan.target],[plan.target,plan.source]]){const r=relative(a,b);if(!r.startsWith('..')&&!isAbsolute(r))throw Error('Source and destination cache folders must not overlap');}
  await checkParents(plan.source);await checkParents(plan.target);
  const root=await realpath(plan.source);
  async function copy(source,target){
   const stat=await lstat(source);
   if(stat.isSymbolicLink())throw Error('Cache symlinks are not copied; use a regular browser cache: '+source);
   try{if((await lstat(target)).isSymbolicLink())throw Error('Refusing a symlink cache destination: '+target)}catch(e){if(e.code!=='ENOENT')throw e}
   const path=relative(root,await realpath(source));if(path.startsWith('..')||isAbsolute(path))throw Error('Cache path escapes source');
   if(stat.isDirectory()){await mkdir(target,{recursive:true,mode:0o755});await chmod(target,0o755);for(const name of await readdir(source))if(name!=='.links')await copy(join(source,name),join(target,name));}
   else if(stat.isFile()){try{await copyFile(source,target,constants.COPYFILE_EXCL);await chmod(target,(stat.mode&0o555)|0o600);row.copied++}catch(e){if(e.code==='EEXIST'){await chmod(target,(stat.mode&0o555)|0o600);row.existing++;}else throw e}}
  }
  await copy(plan.source,plan.target);log(plan.driver+': '+row.copied+' files copied; '+row.existing+' existing files retained.');
 }
 return report;
}
