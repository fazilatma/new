// Detach only optional browser binaries; core npm dependencies remain synchronous.
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,rmSync,renameSync,statSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
function save(file,state){const temp=file+'.'+process.pid+'.tmp';writeFileSync(temp,JSON.stringify(state),{mode:0o600});renameSync(temp,file);}
const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function startBrowserInstall({cwd=project,env=process.env,spawnChild=spawn}={}){
 const folder=resolve(cwd,'data/browser-install'),lock=resolve(folder,'lock'),status=resolve(folder,'status.json');
 mkdirSync(folder,{recursive:true,mode:0o700});
 try{mkdirSync(lock);}catch(error){
  if(error.code!=='EEXIST')throw error;
  let old;try{old=JSON.parse(readFileSync(status,'utf8'));}catch{}
  let alive=false;try{if(old?.pid){process.kill(old.pid,0);alive=true;}}catch(e){alive=e.code==='EPERM';}
  if((!old&&Date.now()-statSync(lock).mtimeMs<30000)||(alive||(old?.running&&Date.now()-old.startedAt<30000)))return {running:true,status,alreadyRunning:true};
  rmSync(lock,{recursive:true,force:true});return startBrowserInstall({cwd,env,spawnChild});
 }
 const state={running:true,phase:'starting',startedAt:Date.now(),pid:process.pid};
 save(status,state);
 const failed=error=>{save(status,{...state,running:false,phase:'failed',error:String(error.message||error)});rmSync(lock,{recursive:true,force:true});};
 try{
  const child=spawnChild(process.execPath,[fileURLToPath(import.meta.url),'--worker',cwd],{cwd,env,detached:true,stdio:'ignore',windowsHide:true});
  if(child.pid)save(status,{...state,pid:child.pid});
  child.once('error',failed);child.unref();
  return {running:true,status};
 }catch(error){failed(error);throw error;}
}
if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='--worker'){
 const cwd=resolve(process.argv[3]),folder=resolve(cwd,'data/browser-install'),status=resolve(folder,'status.json');
 const state={running:true,phase:'installing',startedAt:Date.now(),pid:process.pid};
 save(status,state);
 const {openSync,closeSync}=await import('node:fs');
 const {spawnSync}=await import('node:child_process');
 let fd,result;
 try{
  fd=openSync(resolve(folder,'install.log'),'w',0o600);
  result=spawnSync(process.execPath,[resolve(cwd,'scripts/browsers-install.mjs'),'--foreground','--strict'],{cwd,env:process.env,stdio:['ignore',fd,fd]});
  save(status,{...state,running:false,phase:result.status===0?'ready':'failed',exitCode:result.status,finishedAt:Date.now()});
 }catch(error){save(status,{...state,running:false,phase:'failed',error:String(error.message),finishedAt:Date.now()});}
 finally{if(fd!==undefined)closeSync(fd);rmSync(resolve(folder,'lock'),{recursive:true,force:true});}
}
