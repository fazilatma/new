#!/usr/bin/env node
// Root-owned /etc copy only. No shell, user-selected paths, arbitrary units, or recursive deletion.
import {openSync,closeSync,fstatSync,readSync,readFileSync,unlinkSync,lstatSync,mkdirSync,renameSync,constants} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const NAME='scraper4-managed',APP='/opt/'+NAME,HOME='/var/lib/'+NAME,CONFIG='/etc/'+NAME,QUEUE=HOME+'/control-request.json';
export function parseControl(text){const p=JSON.parse(text);if(!p||Object.keys(p).some(k=>!['action','confirmation'].includes(k))||!['stop','uninstall'].includes(p.action)||p.confirmation!==NAME)throw Error('Invalid lifecycle request');return p.action;}
export function uninstallUnits(){return [NAME+'.service',NAME+'-health.service',NAME+'-health.timer',NAME+'-control.service',NAME+'-control.timer'];}
const ctl=(...args)=>execFileSync('/usr/bin/systemctl',args,{stdio:'pipe',timeout:90000});
function rootFile(path){const st=lstatSync(path);if(st.isSymbolicLink()||st.uid!==0||(st.mode&0o022))throw Error('Untrusted installation metadata/unit: '+path);}
export async function executeControl(){
 if(process.getuid?.()!==0)throw Error('Control check must run as its root-owned system service');
 rootFile(CONFIG);rootFile(CONFIG+'/installed.json');
 const marker=JSON.parse(readFileSync(CONFIG+'/installed.json','utf8'));if(marker.instance!==NAME||marker.target!==APP||marker.prepared!==true)throw Error('Wrong installation marker');
 const uid=Number(execFileSync('/usr/bin/id',['-u',NAME],{encoding:'utf8'}));
 for(const dir of [APP,HOME]){const st=lstatSync(dir);if(st.isSymbolicLink()||!st.isDirectory()||st.uid!==uid)throw Error('Unexpected managed directory ownership');}
 let fd;try{fd=openSync(QUEUE,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(e){if(e.code==='ENOENT')return;throw e;}
 let action;try{const st=fstatSync(fd);if(!st.isFile()||st.uid!==uid||st.size>512||st.nlink!==1)throw Error('Invalid request file');const buffer=Buffer.alloc(513),length=readSync(fd,buffer,0,513,null);if(length>512)throw Error('Request too large');action=parseControl(buffer.subarray(0,length).toString('utf8'));}finally{closeSync(fd);}
 for(const file of uninstallUnits())rootFile('/etc/systemd/system/'+file);
 unlinkSync(QUEUE);
 performAction(action);
}
function archiveManagedDirectories(){
 // Archive under the SAME parent filesystem; no following symlinks or deleting app data.
 const suffix=Date.now()+'-'+randomBytes(5).toString('hex'),archives=[];
 for(const [base,dir]of [['/opt',APP],['/var/lib',HOME],['/etc',CONFIG]]){
  const archive=base+'/'+NAME+'-removed-'+suffix;mkdirSync(archive,{mode:0o700});renameSync(dir,archive+'/saved');archives.push(archive);
 }
 return archives;
}
export function performAction(action,ops={ctl,archive:archiveManagedDirectories,remove:file=>unlinkSync('/etc/systemd/system/'+file),log:console.log}){
 if(!['stop','uninstall'].includes(action))throw Error('Invalid action');
 if(action==='stop'){ops.ctl('stop',NAME+'.service');ops.log('Stopped only '+NAME+'.service; boot enablement and data retained. Restart through SSH.');return;}
 ops.ctl('disable','--now',NAME+'-health.timer',NAME+'.service');ops.ctl('stop',NAME+'-health.service');
 // A missing transient build unit is normal; an actual failure to stop a loaded build is fatal.
 if(String(ops.ctl('list-units','--all','--plain','--no-legend',NAME+'-build.service')).trim())ops.ctl('stop',NAME+'-build.service');
 ops.ctl('disable','--now',NAME+'-control.timer');
 const archives=ops.archive();
 for(const file of uninstallUnits())ops.remove(file);
 ops.ctl('daemon-reload');
 ops.log('Uninstalled only '+NAME+'. Archived code/data/config: '+archives.join(', ')+'. Non-login account retained to reserve archive UID. WebConsole and scraper4-node were not changed.');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))executeControl().catch(e=>{console.error('Control action failed: '+e.message+'. No automatic deletion; inspect journal and retained paths.');process.exitCode=1});
