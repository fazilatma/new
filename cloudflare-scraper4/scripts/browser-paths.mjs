import {compatibleCachePath} from './browser-cache-compatibility.mjs';
import {dirname,resolve,join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdirSync,accessSync,statSync,constants} from 'node:fs';
// Both scripts/ and the bundled render-dist/ are one level below the project.
const moduleDirectory=import.meta.url?dirname(fileURLToPath(import.meta.url)):__dirname;
function projectRoot(directory){
 for(let at=directory;;at=dirname(at)){
  try{if(JSON.parse(readFileSync(join(at,'package.json'),'utf8')).name==='scraper4-cloudflare')return at;}catch{}
  if(dirname(at)===at)break;
 }
 return resolve(directory,'..');
}
export const browserProjectRoot=projectRoot(moduleDirectory);
const keys=['PLAYWRIGHT_BROWSERS_PATH','PUPPETEER_CACHE_DIR','BROWSER_EXECUTABLE_PATH','PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH','PUPPETEER_EXECUTABLE_PATH','CHROME_BIN'];
export function browserPaths(env=process.env,root=browserProjectRoot){
 const saved={};
 try{for(const line of readFileSync(join(root,'.env.local'),'utf8').split(/\r?\n/)){
  const at=line.indexOf('=');if(at<0)continue;const key=line.slice(0,at).trim();
  if(keys.includes(key))saved[key]=line.slice(at+1).trim().replace(/^['"]|['"]$/g,'');
 }}catch(error){if(error.code!=='ENOENT')throw Error('Cannot read browser path configuration: '+error.code);}
 const source={...saved,...env},out={};
 for(const key of keys){const value=String(source[key]||'').trim();if(value)out[key]=key==='PLAYWRIGHT_BROWSERS_PATH'&&value==='0'?'0':isAbsolute(value)?value:resolve(root,value);}
 out.PLAYWRIGHT_BROWSERS_PATH??=compatibleCachePath('playwright',join(root,'data/browsers/ms-playwright'),source,root);
 out.PUPPETEER_CACHE_DIR??=compatibleCachePath('puppeteer',join(root,'data/browsers/puppeteer'),source,root);
 return out;
}
export function applyBrowserPaths(env=process.env,{root=browserProjectRoot,create=false}={}){
 const paths=browserPaths(env,root);Object.assign(env,paths);
 if(create)for(const key of ['PLAYWRIGHT_BROWSERS_PATH','PUPPETEER_CACHE_DIR']){
  const folder=paths[key];if(folder==='0')continue;
  try{mkdirSync(folder,{recursive:true,mode:0o755});if(!statSync(folder).isDirectory())throw Error('not a directory');accessSync(folder,constants.R_OK|constants.W_OK|constants.X_OK);}
  catch(error){throw Error(key+' cannot be used by the installer: '+folder+' ('+(error.code||error.message)+'). Run installation as the service user or choose an accessible cache path. No ownership/permissions were changed.');}
 }
 return paths;
}
