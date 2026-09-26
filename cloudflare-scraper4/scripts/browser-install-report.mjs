import {open,readFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function browserInstallReport(cwd){
 const directory=join(cwd,'data/browser-install'),out={recorded:false,statusPath:join(directory,'status.json'),logPath:join(directory,'install.log')};
 try{const state=JSON.parse(await readFile(out.statusPath,'utf8'));out.recorded=true;out.state=state;
  if(state.running){let alive=false;try{if(state.pid){process.kill(state.pid,0);alive=true;}}catch(error){alive=error.code==='EPERM';}out.processAlive=alive;out.interrupted=!alive;}
 }catch(error){if(error.code!=='ENOENT')out.statusError=error.code||'invalid-status-json';}
 let handle;
 try{handle=await open(out.logPath,'r');const {size}=await handle.stat(),start=Math.max(0,size-24000),buffer=Buffer.alloc(Math.min(size,24000));const {bytesRead}=await handle.read(buffer,0,buffer.length,start);out.log=buffer.subarray(0,bytesRead).toString('utf8');out.logTruncated=start>0;if(start>0)out.log=out.log.includes('\n')?out.log.slice(out.log.indexOf('\n')+1):'';}
 catch(error){if(error.code!=='ENOENT')out.logError=error.code;}
 finally{await handle?.close();}
 return out;
}
