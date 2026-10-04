import http from 'node:http';
import os from 'node:os';
import {readFile} from 'node:fs/promises';

const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
const file = path => readFile(path, 'utf8').catch(() => '');
export function memoryFromProc(text, total, free) {
  const fields = Object.fromEntries([...text.matchAll(/^(\w+):\s+(\d+)\s+kB/gm)].map(m => [m[1], Number(m[2]) * 1024]));
  total = fields.MemTotal || total;
  const available = fields.MemAvailable ?? free;
  if (!(total > 0) || !Number.isFinite(available) || available < 0) return null;
  const used = Math.max(0, Math.min(total, total - available));
  return {total, used, percent: used / total * 100, source: fields.MemAvailable !== undefined ? 'MemAvailable (reclaimable cache excluded)' : 'OS free memory (includes cache in used)'};
}
export function cpuTotals(cpus) {
  if (!cpus?.length) return null;
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    if (!cpu.times || Object.values(cpu.times).some(n => !Number.isFinite(n))) return null;
    idle += cpu.times.idle;
    total += Object.values(cpu.times).reduce((a,b) => a+b, 0);
  }
  return Number.isFinite(idle) && total > 0 ? {idle,total} : null;
}
export async function readResources() {
  const [mem, current, limit] = await Promise.all([file('/proc/meminfo'), file('/sys/fs/cgroup/memory.current'), file('/sys/fs/cgroup/memory.max')]);
  const used = Number(current.trim()), max = Number(limit.trim());
  return {
    at: Date.now(), elapsed: process.uptime() * 1000,
    cpu: cpuTotals(safe(() => os.cpus(), [])),
    memory: memoryFromProc(mem, safe(() => os.totalmem(), 0), safe(() => os.freemem(), NaN)),
    containerMemory: current.trim() && limit.trim() && max > 0 && Number.isFinite(max) && Number.isFinite(used) && used >= 0 ? {used,total:max,percent:Math.min(100,used/max*100)} : null,
    processCpu: process.cpuUsage(), rss: process.memoryUsage().rss,
    platform: process.platform, termux: process.platform === 'android' || /com\.termux/.test(process.env.PREFIX || '')
  };
}
/** One sampler per deployer, bounded in-memory history; no shells, credentials or disk history. */
export function createResourceMonitor(read = readResources, {intervalMs = 2000, maxSamples = 180} = {}) {
  let previous = null, pending = null, timer = null;
  const samples = [];
  async function sample() {
    if (pending) return pending;
    pending = (async () => {
      const next = await read();
      let cpuPercent = null, processCpuPercent = null;
      if (previous?.cpu && next.cpu) {
        const total = next.cpu.total - previous.cpu.total, idle = next.cpu.idle - previous.cpu.idle;
        if (total > 0 && idle >= 0 && idle <= total) cpuPercent = (total-idle)/total*100;
      }
      const elapsed = next.elapsed - (previous?.elapsed ?? next.elapsed);
      if (elapsed > 0 && previous?.processCpu) {
        const micros = next.processCpu.user + next.processCpu.system - previous.processCpu.user - previous.processCpu.system;
        if (micros >= 0) processCpuPercent = micros / (elapsed * 1000) * 100;
      }
      samples.push({at:next.at, cpuPercent, memory:next.memory, containerMemory:next.containerMemory, processCpuPercent, rss:next.rss, scraper:scraperInterval(next.scraper,previous?.scraper)});
      if (samples.length > maxSamples) samples.splice(0,samples.length-maxSamples);
      previous = next;
    })().catch(() => { samples.push({at:Date.now(),cpuPercent:null,memory:null,containerMemory:null,rss:null,processCpuPercent:null}); if(samples.length>maxSamples)samples.shift(); previous=null; }).finally(() => {pending=null;});
    return pending;
  }
  return {
    sample,
    start() { if(!timer){void sample();timer=setInterval(()=>void sample(),intervalMs);timer.unref?.();} },
    close() {clearInterval(timer);timer=null;},
    async snapshot() {if(!samples.length)await sample();return {ok:true,intervalMs,maxSamples,platform:previous?.platform||process.platform,termux:!!previous?.termux,samples:samples.slice()};}
  };
}

/** Fixed loopback endpoint; no caller-controlled target, redirects, cookies or secrets. */
export function readScraperResources(port,timeoutMs=1200){
 return new Promise(resolve=>{
  let done=false;const finish=value=>{if(!done){done=true;clearTimeout(deadline);resolve(value)}};
  const unavailable=reason=>({status:'unavailable',reason});
  const deadline=setTimeout(()=>{request.destroy();finish(unavailable('Scraper did not respond in time'))},timeoutMs);
  const request=http.get({hostname:'127.0.0.1',port,path:'/health',headers:{accept:'application/json'}},response=>{
   if(response.statusCode!==200){response.resume();finish(unavailable('Scraper health endpoint unavailable'));return}
   let body='',bytes=0;
   response.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384){request.destroy();finish(unavailable('Unexpected health response'));return}body+=chunk});
   response.on('error',()=>finish(unavailable('Scraper connection interrupted')));
   response.on('end',()=>{
    try{
     const data=JSON.parse(body),r=data.resources;
     if(data.app!=='scraper4'||r?.scope!=='scraper-node-process'||typeof r.instanceId!=='string'||r.instanceId.length>100||!['pid','uptimeMs','cpuMicros','rss','heapUsed'].every(k=>Number.isFinite(r[k])&&r[k]>=0))throw Error();
     finish({status:'available',instanceId:r.instanceId,pid:r.pid,uptimeMs:r.uptimeMs,cpuMicros:r.cpuMicros,rss:r.rss,heapUsed:r.heapUsed});
    }catch{finish(unavailable('Resource reporting unavailable; update and restart the scraper'))}
   });
  });
  request.on('error',()=>finish(unavailable('Scraper is stopped or unreachable')));
 });
}
export function scraperInterval(current,previous){
 if(current?.status!=='available')return {status:'unavailable',reason:current?.reason||'Scraper resource sample unavailable',cpuPercent:null,rss:null};
 let cpuPercent=null;
 if(previous?.status==='available'&&previous.instanceId===current.instanceId&&previous.pid===current.pid){
  const elapsed=current.uptimeMs-previous.uptimeMs,used=current.cpuMicros-previous.cpuMicros;
  if(elapsed>0&&used>=0)cpuPercent=used/(elapsed*1000)*100;
 }
 return {status:'available',pid:current.pid,rss:current.rss,heapUsed:current.heapUsed,cpuPercent};
}
