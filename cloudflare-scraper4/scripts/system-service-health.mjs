#!/usr/bin/env node
// Installed root-owned under /etc, never executed as root from writable app code.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {request} from 'node:http';
import {uptime} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const SERVICE='scraper4-node.service',STATE='/run/scraper4-node-health.json';
export function healthDecision(info,previous,healthy,nowMicros){
 const age=(nowMicros-Number(info.ActiveEnterTimestampMonotonic||nowMicros))/1e6;
 const same=previous?.invocation===info.InvocationID;
 const failures=info.ActiveState!=='active'||age<300||healthy?0:(same?Number(previous.failures)||0:0)+1;
 return {invocation:info.InvocationID||'',failures,restart:info.ActiveState==='active'&&age>=300&&failures>=3};
}
export function probe(port=8790,timeout=5000){return new Promise(resolve=>{const req=request({host:'127.0.0.1',port,path:'/',method:'HEAD',timeout},res=>{res.destroy();resolve(true)});req.on('timeout',()=>req.destroy(new Error('HTTP probe timed out')));req.on('error',()=>resolve(false));req.end();});}
const inspect=()=>Object.fromEntries(execFileSync('systemctl',['show',SERVICE,'-p','ActiveState','-p','ActiveEnterTimestampMonotonic','-p','InvocationID'],{encoding:'utf8'}).trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)]}));
export async function check(){
 const info=inspect();let previous={};try{previous=JSON.parse(readFileSync(STATE,'utf8'))}catch{}
 const result=healthDecision(info,previous,info.ActiveState==='active'?await probe():false,uptime()*1e6);
 writeFileSync(STATE+'.tmp',JSON.stringify(result),{mode:0o600});renameSync(STATE+'.tmp',STATE);
 if(result.restart){const latest=inspect();if(latest.ActiveState==='active'&&latest.InvocationID===info.InvocationID){console.error('Deployer failed three HTTP probes after startup grace; restarting its systemd cgroup.');execFileSync('systemctl',['try-restart',SERVICE],{stdio:'inherit'});}}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))check().catch(e=>{console.error(e.message);process.exitCode=1});
